/**
 * liveOptionsTracker.ts
 *
 * Dynamically follows the ATM strike as the underlying spot price moves
 * during the trading day, maintaining a live-feed subscription window of
 * ATM ± ATM_WINDOW strikes (both CE and PE) for each configured index.
 *
 * Budget split (from the shared 200-symbol Fyers live feed cap):
 *   • OPTIONS_LIVE_BUDGET: reserved for index spot symbols + ATM window contracts
 *   • FO_STOCKS_BUDGET:    the remainder, passed to autoSubscribeFoSymbols()
 *
 * Lifecycle (called from scheduler.ts):
 *   liveOpen  → initAtmOptionSubscriptions()  +  startAtmRollTracking()
 *   liveClose → stopAtmRollTracking()  (disconnect + clearProtectedSymbols still called separately)
 *
 * Roll detection (every ATM_ROLL_INTERVAL_MS):
 *   Reads the cached live quote for each index spot symbol — no broker API
 *   calls during trading hours. If the ATM strike has shifted, the delta set
 *   of contracts is unsubscribed/subscribed and the shift is logged.
 *
 * Persistence:
 *   Ticks for the subscribed option contracts flow straight into the existing
 *   liveFeedService handleMessage → recordTick → upsertOptionsCandle pipeline.
 *   Nothing extra is needed here.
 */

import { config } from "../config/environment.js";
import {
  subscribeSymbols,
  unsubscribeSymbols,
  getLiveQuote,
  MAX_SUBSCRIBED_SYMBOLS,
} from "./liveFeedService.js";
import { getAuthenticatedAdapter } from "./marketDataService.js";
import type { BrokerAdapter } from "../adapters/types.js";
import { marketDb } from "../db.js";

// ── Per-day expiry cache ─────────────────────────────────────────────────────
//
// The nearest expiry for a given underlying does not change within a trading
// day, but initAtmOptionSubscriptions() now runs on every reconcileLiveFeedState()
// restart during market hours (not just once at a fixed 9 AM), so a day with
// several restarts (Replit sleep/wake, redeploys, manual testing) would
// otherwise re-call getOptionExpiries() redundantly each time. Cached here,
// one row per (underlying, date), in the same one-row-per-day style as
// request_budget in marketDataService.ts.

/** Cached expiry for `underlying` on `date`, or null if not yet resolved today. */
function getCachedExpiry(underlying: string, date: string): string | null {
  const row = marketDb
    .prepare(`SELECT expiry FROM atm_expiry_cache WHERE underlying = ? AND date = ?`)
    .get(underlying, date) as { expiry: string } | undefined;
  return row?.expiry ?? null;
}

/** Persists the resolved expiry for `underlying` on `date`. */
function setCachedExpiry(underlying: string, date: string, expiry: string): void {
  marketDb
    .prepare(
      `INSERT INTO atm_expiry_cache (underlying, date, expiry) VALUES (?, ?, ?)
       ON CONFLICT(underlying, date) DO UPDATE SET expiry = excluded.expiry`
    )
    .run(underlying, date, expiry);
}

// ── Budget constants ──────────────────────────────────────────────────────────

/**
 * How many strikes on each side of ATM to track live.
 * ATM ± 5 = 11 strikes × 2 (CE + PE) = 22 contracts per index.
 * Change this constant to tune the window without touching any logic.
 */
export const ATM_WINDOW = 5;

/** Contracts per index: (2 × ATM_WINDOW + 1) strikes × 2 option types. */
const CONTRACTS_PER_INDEX = (2 * ATM_WINDOW + 1) * 2; // 22

/**
 * Live-feed slots reserved for options:
 *   each index uses CONTRACTS_PER_INDEX contract slots + 1 for the index spot
 *   symbol itself (needed to receive live price ticks for roll detection).
 *
 *   Replit (2 indices) : 2 × 23 = 46
 *   Oracle  (5 indices): 5 × 23 = 115
 */
export const OPTIONS_LIVE_BUDGET = config.optionsIndices.length * (CONTRACTS_PER_INDEX + 1);

/** Remaining budget available for F&O stock auto-subscriptions. */
export const FO_STOCKS_BUDGET = Math.max(0, MAX_SUBSCRIBED_SYMBOLS - OPTIONS_LIVE_BUDGET);

// ── Index → Fyers symbol map ──────────────────────────────────────────────────
// Mirrors UNDERLYING_TO_FYERS in optionsDataService.ts; kept local to avoid a
// cross-service import cycle (liveFeedService → optionsDataService is fine, but
// this file already imports from liveFeedService).

const UNDERLYING_TO_FYERS: Record<string, string> = {
  NIFTY:      "NSE:NIFTY50-INDEX",
  BANKNIFTY:  "NSE:NIFTYBANK-INDEX",
  FINNIFTY:   "NSE:FINNIFTY-INDEX",
  SENSEX:     "BSE:SENSEX-INDEX",
  MIDCPNIFTY: "NSE:MIDCPNIFTY-INDEX",
};

// ── Per-index state ───────────────────────────────────────────────────────────

interface StrikeEntry {
  strike: number;
  ceSymbol?: string | null;
  peSymbol?: string | null;
}

interface IndexAtmState {
  /** e.g. "NSE:NIFTY50-INDEX" — also subscribed for live spot ticks. */
  fyersSymbol: string;
  /** YYYY-MM-DD of the nearest expiry fetched at open. */
  expiry: string;
  /** Full sorted strike list from the chain, cached at open. */
  chain: StrikeEntry[];
  /** ATM strike as of the most recent roll check. */
  currentAtmStrike: number;
  /** Fyers option symbols currently subscribed for this index. */
  subscribedContracts: Set<string>;
}

/** Live state per underlying (keyed by UPPER-CASE underlying name, e.g. "NIFTY"). */
const indexStates = new Map<string, IndexAtmState>();

let rollTimer: ReturnType<typeof setInterval> | null = null;

/** How often to check whether the ATM has moved. */
const ATM_ROLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Nearest expiry on/after `date`; falls back to the last known expiry. */
function pickNearestExpiry(expiries: string[], date: string): string | null {
  if (expiries.length === 0) return null;
  const sorted = [...expiries].sort();
  return sorted.find((e) => e >= date) ?? sorted[sorted.length - 1];
}

/**
 * Given a sorted strike chain and a spot price, finds the ATM strike and
 * computes all option symbols in the ATM ± ATM_WINDOW window.
 * Returns { atmStrike, symbols[] } where symbols is all non-null
 * ceSymbol/peSymbol values for strikes in the window.
 */
function computeWindowSymbols(
  chain: StrikeEntry[],
  spot: number
): { atmStrike: number; symbols: string[] } {
  let atmIdx = 0;
  let minDist = Infinity;
  chain.forEach((s, i) => {
    const d = Math.abs(s.strike - spot);
    if (d < minDist) {
      minDist = d;
      atmIdx = i;
    }
  });

  const atmStrike = chain[atmIdx].strike;
  const lo = Math.max(0, atmIdx - ATM_WINDOW);
  const hi = Math.min(chain.length - 1, atmIdx + ATM_WINDOW);

  const symbols: string[] = [];
  for (let i = lo; i <= hi; i++) {
    if (chain[i].ceSymbol) symbols.push(chain[i].ceSymbol!);
    if (chain[i].peSymbol) symbols.push(chain[i].peSymbol!);
  }

  return { atmStrike, symbols };
}

// ── ATM roll logic ────────────────────────────────────────────────────────────

/**
 * Checks whether the ATM strike has moved for one index and, if so,
 * unsubscribes the contracts that left the window and subscribes the ones
 * that entered it. Uses the cached live quote — no broker API call.
 */
function rollAtmForUnderlying(underlying: string, state: IndexAtmState): void {
  const quote = getLiveQuote(state.fyersSymbol);
  if (!quote) {
    // No live tick received for the index yet — skip this cycle.
    return;
  }

  const spot = quote.ltp;
  const { atmStrike: newAtm, symbols: newSymbols } = computeWindowSymbols(state.chain, spot);

  if (newAtm === state.currentAtmStrike) return; // no change needed

  const newSet = new Set(newSymbols);
  const toUnsub = [...state.subscribedContracts].filter((s) => !newSet.has(s));
  const toSub = newSymbols.filter((s) => !state.subscribedContracts.has(s));

  console.log(
    "[liveOptionsTracker] %s ATM roll: %d → %d (spot=%.2f)  +%d -%d contracts",
    underlying,
    state.currentAtmStrike,
    newAtm,
    spot,
    toSub.length,
    toUnsub.length
  );

  if (toUnsub.length > 0) {
    unsubscribeSymbols(toUnsub);
    for (const s of toUnsub) state.subscribedContracts.delete(s);
    console.log("[liveOptionsTracker] %s: unsubscribed %s", underlying, toUnsub.join(", "));
  }

  if (toSub.length > 0) {
    const result = subscribeSymbols(toSub, { protect: true });
    for (const s of result.added) state.subscribedContracts.add(s);

    if (result.rejected.length > 0) {
      console.warn(
        "[liveOptionsTracker] %s: %d new contract(s) rejected (at 200 cap) — subscribed %d/%d",
        underlying,
        result.rejected.length,
        result.added.length,
        toSub.length
      );
    } else {
      console.log(
        "[liveOptionsTracker] %s: subscribed %s",
        underlying,
        result.added.join(", ")
      );
    }
  }

  state.currentAtmStrike = newAtm;
}

function rollAllIndices(): void {
  for (const [underlying, state] of indexStates) {
    try {
      rollAtmForUnderlying(underlying, state);
    } catch (err) {
      console.warn(
        "[liveOptionsTracker] Roll check error for %s: %s",
        underlying,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called at market open (after autoSubscribeFoSymbols).
 * For each configured index:
 *   1. Subscribes the index spot symbol to the live feed (for roll detection).
 *   2. Fetches the nearest expiry + option chain (two broker API calls).
 *   3. Subscribes ATM ± ATM_WINDOW CE/PE contracts as protected.
 *
 * Stores the chain in memory so no broker calls are needed during rolling.
 * Skips silently if no broker is connected or the broker doesn't support
 * option chains (graceful degradation).
 */
export async function initAtmOptionSubscriptions(): Promise<void> {
  const adapter = await getAuthenticatedAdapter();
  if (!adapter) {
    console.warn(
      "[liveOptionsTracker] No broker connected — ATM option subscriptions skipped"
    );
    return;
  }

  const anyAdapter = adapter as unknown as Record<string, unknown>;
  if (typeof anyAdapter.getOptionExpiries !== "function") {
    console.warn(
      "[liveOptionsTracker] Connected broker does not support getOptionExpiries — ATM subscriptions skipped"
    );
    return;
  }

  const getExpiries = anyAdapter.getOptionExpiries as (
    s: string
  ) => Promise<string[]>;

  // Clear stale state from a previous session if stopAtmRollTracking wasn't
  // called (e.g. server restart during market hours).
  indexStates.clear();

  const today = new Date().toISOString().slice(0, 10);

  console.log(
    "[liveOptionsTracker] Initialising ATM option subscriptions for %d index/indices (window ±%d, budget %d/%d slots)",
    config.optionsIndices.length,
    ATM_WINDOW,
    OPTIONS_LIVE_BUDGET,
    MAX_SUBSCRIBED_SYMBOLS
  );

  for (const underlying of config.optionsIndices) {
    const uName = underlying.toUpperCase();
    const fyersSymbol = UNDERLYING_TO_FYERS[uName];
    if (!fyersSymbol) {
      console.warn("[liveOptionsTracker] Unknown underlying %s — skipping", uName);
      continue;
    }

    try {
      // Subscribe the index spot symbol first so we get live price ticks for
      // roll detection. Protected so it's never FIFO-evicted.
      const spotResult = subscribeSymbols([fyersSymbol], { protect: true });
      if (spotResult.rejected.length > 0) {
        console.warn(
          "[liveOptionsTracker] Index spot symbol %s rejected by subscription cap — rolling will be blind for %s",
          fyersSymbol,
          uName
        );
      }

      // Resolve nearest expiry — reuse today's cached value if this underlying
      // was already resolved earlier today (e.g. an earlier restart), since
      // the correct expiry doesn't change within a trading day.
      let expiry: string | null = getCachedExpiry(uName, today);
      if (expiry) {
        console.log(
          "[liveOptionsTracker] Using cached expiry %s for %s (already resolved today)",
          expiry,
          uName
        );
      } else {
        let expiries: string[];
        try {
          expiries = await getExpiries.call(adapter as BrokerAdapter, fyersSymbol);
        } catch (err) {
          console.error(
            "[liveOptionsTracker] Failed to fetch expiries for %s: %s",
            uName,
            err instanceof Error ? err.message : String(err)
          );
          continue;
        }

        expiry = pickNearestExpiry(expiries, today);
        if (!expiry) {
          console.warn("[liveOptionsTracker] No expiries returned for %s — skipping", uName);
          continue;
        }

        setCachedExpiry(uName, today, expiry);
      }

      // Fetch option chain
      let chain;
      try {
        chain = await (adapter as BrokerAdapter).getOptionChain(fyersSymbol, expiry);
      } catch (err) {
        console.error(
          "[liveOptionsTracker] Failed to fetch option chain for %s expiry %s: %s",
          uName,
          expiry,
          err instanceof Error ? err.message : String(err)
        );
        continue;
      }

      const spot = chain.spotPrice;
      if (!spot || spot <= 0) {
        console.warn("[liveOptionsTracker] No spot price in chain for %s — skipping", uName);
        continue;
      }

      if (chain.strikes.length === 0) {
        console.warn("[liveOptionsTracker] Empty strike list for %s expiry %s — skipping", uName, expiry);
        continue;
      }

      const { atmStrike, symbols } = computeWindowSymbols(chain.strikes, spot);

      // Subscribe contracts as protected
      const result = subscribeSymbols(symbols, { protect: true });

      indexStates.set(uName, {
        fyersSymbol,
        expiry,
        chain: chain.strikes,
        currentAtmStrike: atmStrike,
        subscribedContracts: new Set(result.added),
      });

      console.log(
        "[liveOptionsTracker] %s: ATM=%d spot=%.2f expiry=%s — subscribed %d/%d contracts%s",
        uName,
        atmStrike,
        spot,
        expiry,
        result.added.length,
        symbols.length,
        result.rejected.length > 0
          ? ` (${result.rejected.length} rejected — cap reached)`
          : ""
      );
    } catch (err) {
      console.error(
        "[liveOptionsTracker] Unexpected error initialising %s: %s",
        uName,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const totalContracts = [...indexStates.values()].reduce(
    (sum, s) => sum + s.subscribedContracts.size,
    0
  );
  console.log(
    "[liveOptionsTracker] Init complete — %d indices tracked, %d contracts + %d index spots subscribed",
    indexStates.size,
    totalContracts,
    indexStates.size
  );
}

/**
 * Starts the periodic ATM roll check. Call immediately after
 * initAtmOptionSubscriptions() succeeds. Safe to call when no indices were
 * initialised (the timer just becomes a no-op).
 */
export function startAtmRollTracking(): void {
  if (rollTimer) clearInterval(rollTimer); // defensive: don't double-start
  rollTimer = setInterval(rollAllIndices, ATM_ROLL_INTERVAL_MS);
  console.log(
    "[liveOptionsTracker] ATM roll tracking started (interval %ds)",
    ATM_ROLL_INTERVAL_MS / 1000
  );
}

/**
 * Stops the roll timer and unsubscribes all tracked option contracts and
 * index spot symbols. Called at market close so tomorrow's liveOpen builds
 * a completely fresh subscription list from the current ATM.
 */
export function stopAtmRollTracking(): void {
  if (rollTimer) {
    clearInterval(rollTimer);
    rollTimer = null;
  }

  const contractsToUnsub: string[] = [];
  const spotsToUnsub: string[] = [];

  for (const [, state] of indexStates) {
    contractsToUnsub.push(...state.subscribedContracts);
    spotsToUnsub.push(state.fyersSymbol);
  }

  if (contractsToUnsub.length > 0) unsubscribeSymbols(contractsToUnsub);
  if (spotsToUnsub.length > 0) unsubscribeSymbols(spotsToUnsub);

  console.log(
    "[liveOptionsTracker] ATM tracking stopped — cleared %d contracts + %d index spot subscription(s)",
    contractsToUnsub.length,
    spotsToUnsub.length
  );

  indexStates.clear();
}

/** Status snapshot for the diagnostics / scheduler-status endpoint. */
export interface AtmTrackerStatus {
  active: boolean;
  atmWindow: number;
  optionsLiveBudget: number;
  foStocksBudget: number;
  indices: Array<{
    underlying: string;
    fyersSymbol: string;
    expiry: string;
    atmStrike: number;
    subscribedContracts: number;
    spotPrice: number | null;
  }>;
}

export function getAtmTrackerStatus(): AtmTrackerStatus {
  const indices = [...indexStates.entries()].map(([underlying, state]) => ({
    underlying,
    fyersSymbol: state.fyersSymbol,
    expiry: state.expiry,
    atmStrike: state.currentAtmStrike,
    subscribedContracts: state.subscribedContracts.size,
    spotPrice: getLiveQuote(state.fyersSymbol)?.ltp ?? null,
  }));

  return {
    active: rollTimer !== null,
    atmWindow: ATM_WINDOW,
    optionsLiveBudget: OPTIONS_LIVE_BUDGET,
    foStocksBudget: FO_STOCKS_BUDGET,
    indices,
  };
}
