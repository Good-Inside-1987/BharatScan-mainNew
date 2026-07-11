/**
 * optionsDataService.ts
 *
 * Orchestrates loading of options intraday history from a connected broker
 * into the options_intraday table.
 *
 * Designed to mirror the patterns in marketDataService.ts:
 *  - Uses the same authenticated adapter
 *  - Respects the shared daily request budget
 *  - Applies the same rate-limit throttle
 *  - Upserts with ON CONFLICT DO UPDATE
 */

import { marketDb } from "../db.js";
import { config } from "../config/environment.js";
import { getAuthenticatedAdapter, throttleCall, checkAndConsumeBudget } from "./marketDataService.js";
import type { Bar } from "../adapters/types.js";

// ── Underlying → Fyers index symbol ──────────────────────────────────────────
// Used when calling getOptionChain / getOptionExpiries on the adapter.

const UNDERLYING_TO_FYERS: Record<string, string> = {
  NIFTY:       "NSE:NIFTY50-INDEX",
  BANKNIFTY:   "NSE:NIFTYBANK-INDEX",
  FINNIFTY:    "NSE:FINNIFTY-INDEX",
  SENSEX:      "BSE:SENSEX-INDEX",
  MIDCPNIFTY:  "NSE:MIDCPNIFTY-INDEX",
};

/** Returns true if the underlying is an index (wider strike range). */
function isIndex(underlying: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNDERLYING_TO_FYERS, underlying.toUpperCase());
}

/** ATM ± N strikes to load (matches config values set in environment.ts). */
function strikeRange(underlying: string): number {
  return isIndex(underlying)
    ? config.indexOptionsStrikeRange   // 30 for indices
    : config.stockOptionsStrikeRange;  // 20 for stocks
}

// ── options_intraday upsert ───────────────────────────────────────────────────

function upsertOptionsBars(
  underlying: string,
  expiry: string,
  strike: number,
  optionType: "CE" | "PE",
  bars: Bar[]
): void {
  if (!bars.length) return;

  const stmt = marketDb.prepare(`
    INSERT INTO options_intraday
      (underlying, expiry, strike, option_type, timestamp, open, high, low, close, volume, oi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(underlying, expiry, strike, option_type, timestamp) DO UPDATE SET
      open   = excluded.open,
      high   = excluded.high,
      low    = excluded.low,
      close  = excluded.close,
      volume = excluded.volume,
      oi     = excluded.oi
  `);

  try {
    marketDb.exec("BEGIN");
    for (const b of bars) {
      stmt.run(
        underlying, expiry, strike, optionType,
        b.date,
        b.open, b.high, b.low, b.close, b.volume,
        b.oi ?? null,
      );
    }
    marketDb.exec("COMMIT");
  } catch (e) {
    marketDb.exec("ROLLBACK");
    throw e;
  }
}

// ── Progress callback type ────────────────────────────────────────────────────

export interface OptionsLoadProgress {
  loaded: number;
  total: number;
  current: string;      // symbol currently being fetched
  failed: string[];
}

export type ProgressCallback = (p: OptionsLoadProgress) => void;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return available expiry dates (YYYY-MM-DD) for an underlying from the
 * connected broker.  Relies on the broker's option chain API returning expiry
 * metadata when called without a specific expiry timestamp.
 */
export async function getOptionExpiriesFromBroker(
  underlying: string
): Promise<string[]> {
  const adapter = await getAuthenticatedAdapter();
  if (!adapter) throw new Error("No authenticated broker connected");

  const fyersSymbol = UNDERLYING_TO_FYERS[underlying.toUpperCase()];
  if (!fyersSymbol) throw new Error(`Unknown underlying: ${underlying}`);

  // Check the adapter supports getOptionExpiries (Fyers does, Angel throws)
  const anyAdapter = adapter as unknown as Record<string, unknown>;
  if (typeof anyAdapter.getOptionExpiries !== "function") {
    throw new Error("Connected broker does not support option expiry lookup");
  }
  const getExpiries = anyAdapter.getOptionExpiries as (s: string) => Promise<string[]>;
  return getExpiries.call(adapter, fyersSymbol);
}

export interface LoadOptionsParams {
  underlying: string;
  expiry: string;   // YYYY-MM-DD
  from: string;     // YYYY-MM-DD
  to: string;       // YYYY-MM-DD
}

export interface LoadOptionsResult {
  loaded: number;
  skippedBudget: number;
  failed: string[];
}

/**
 * Main entry point: fetch 1-min option candles for ATM ± N strikes for a
 * given underlying + expiry + date range, and upsert them into options_intraday.
 *
 * Steps:
 *   1. Get option chain for the expiry → spot price + strike symbols
 *   2. Identify ATM strike and select ATM ± range strikes
 *   3. For each (strike, CE/PE): budget-check → throttle → getHistoricalData → upsert
 */
export async function loadOptionsFromBroker(
  params: LoadOptionsParams,
  onProgress: ProgressCallback
): Promise<LoadOptionsResult> {
  const { underlying, expiry, from, to } = params;
  const uName = underlying.toUpperCase();
  const fyersSymbol = UNDERLYING_TO_FYERS[uName];
  if (!fyersSymbol) throw new Error(`Unknown underlying: ${underlying}`);

  const adapter = await getAuthenticatedAdapter();
  if (!adapter) throw new Error("No authenticated broker connected");

  // ── Step 1: Get option chain to find spot price and strike symbols ─────────
  let chain;
  try {
    chain = await adapter.getOptionChain(fyersSymbol, expiry);
  } catch (err) {
    throw new Error(
      `Failed to fetch option chain for ${underlying} expiry ${expiry}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const spot = chain.spotPrice;
  if (!spot || spot <= 0) {
    throw new Error(`Could not determine spot price for ${underlying}. Got: ${spot}`);
  }

  // ── Step 2: Filter to ATM ± N strikes ─────────────────────────────────────
  const range = strikeRange(uName);

  // Find ATM: strike in chain closest to spot
  let atmStrike = chain.strikes[0]?.strike ?? 0;
  let minDist = Infinity;
  for (const s of chain.strikes) {
    const d = Math.abs(s.strike - spot);
    if (d < minDist) { minDist = d; atmStrike = s.strike; }
  }

  const selected = chain.strikes.filter(
    (s) => s.strike >= atmStrike - range * Infinity && // will refine below
      Math.abs(s.strike - atmStrike) <= range * 200    // generous upper bound
  );

  // Select exactly ATM ± range strikes (by position in the sorted list)
  const atmIdx = chain.strikes.findIndex((s) => s.strike === atmStrike);
  const lo = Math.max(0, atmIdx - range);
  const hi = Math.min(chain.strikes.length - 1, atmIdx + range);
  const candidates = chain.strikes.slice(lo, hi + 1);
  void selected; // selected was a rough filter, use candidates instead

  // Build fetch list: (symbol, strike, type) pairs
  interface FetchItem {
    symbol: string;
    strike: number;
    type: "CE" | "PE";
  }
  const items: FetchItem[] = [];
  for (const s of candidates) {
    if (s.ceSymbol) items.push({ symbol: s.ceSymbol, strike: s.strike, type: "CE" });
    if (s.peSymbol) items.push({ symbol: s.peSymbol, strike: s.strike, type: "PE" });
  }

  if (items.length === 0) {
    throw new Error(
      `No option symbols found in chain for ${underlying} expiry ${expiry}. ` +
      `Chain returned ${chain.strikes.length} strikes but none had symbol names. ` +
      "Check that the broker's option chain response includes symbol fields."
    );
  }

  console.log(
    "[optionsDataService] Loading %d option contracts for %s %s ATM=%d spot=%.2f range=±%d",
    items.length, uName, expiry, atmStrike, spot, range
  );

  // ── Step 3: Fetch + upsert each contract ──────────────────────────────────
  const failed: string[] = [];
  let loaded = 0;
  let skippedBudget = 0;

  onProgress({ loaded: 0, total: items.length, current: "", failed: [] });

  for (const item of items) {
    // Budget check
    if (!checkAndConsumeBudget()) {
      console.warn(
        "[optionsDataService] Daily request budget exhausted — stopping options load (%d/%d done)",
        loaded, items.length
      );
      skippedBudget = items.length - loaded - failed.length;
      break;
    }

    onProgress({ loaded, total: items.length, current: item.symbol, failed: [...failed] });

    try {
      const bars = await throttleCall(() =>
        adapter.getHistoricalData(item.symbol, "1", from, to)
      );
      upsertOptionsBars(uName, expiry, item.strike, item.type, bars);
      loaded++;
      console.log(
        "[optionsDataService] ✓ %s %d%s %s→%s (%d bars)",
        item.symbol, item.strike, item.type, from, to, bars.length
      );
    } catch (err) {
      console.error(
        "[optionsDataService] ✗ %s: %s",
        item.symbol, err instanceof Error ? err.message : String(err)
      );
      failed.push(item.symbol);
    }
  }

  onProgress({ loaded, total: items.length, current: "", failed: [...failed] });

  console.log(
    "[optionsDataService] Done: %d loaded, %d failed, %d skipped (budget)",
    loaded, failed.length, skippedBudget
  );

  return { loaded, skippedBudget, failed };
}
