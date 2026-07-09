/**
 * marketDataService.ts
 *
 * THE single gateway between the rest of the backend and any broker adapter.
 * Routes and scanner code must call this service; they must never import
 * adapter modules directly.
 *
 * Responsibilities
 * ─────────────────
 * 1. getHistoricalBars  — cache-first OHLCV access; fetches & upserts missing
 *                         ranges from the connected broker, chunk by chunk.
 * 2. getLiveQuotes      — thin proxy to the connected adapter's getQuotes().
 *                         (WebSocket-based live cache is wired in the next step.)
 * 3. Rate-limit pacing  — hard cap of MAX_RPS requests/second (stays safely
 *                         below Fyers' 10/sec ceiling).
 * 4. Daily budget       — configurable via config.backfillDailyRequestBudget;
 *                         resets at midnight IST; backfill pauses when exhausted.
 * 5. backfill_progress  — every completed chunk writes its coverage immediately
 *                         so progress survives process restarts.  Coverage is
 *                         stored as a JSON array of {from,to} intervals so that
 *                         holes left by failed chunks remain detectable after
 *                         later chunks succeed.
 */

import { marketDb, appDb } from "../db.js";
import { getAdapter } from "../adapters/index.js";
import type { BrokerAdapter, Bar, Quote } from "../adapters/types.js";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config/environment.js";

// ── Internal row types ────────────────────────────────────────────────────────

interface BrokerConnectionRow {
  id: string;
  broker_name: string;
  api_key: string;
  access_token: string | null;
  token_generated_at: string | null;
  status: string;
}

// ── Interval helpers ──────────────────────────────────────────────────────────

type DateRange = { from: string; to: string };

/**
 * Merge a new interval into a sorted, non-overlapping list.
 * Both inputs and output are sorted by `from`.
 */
function mergeIntervals(ranges: DateRange[], newRange: DateRange): DateRange[] {
  const all = [...ranges, newRange].sort((a, b) => a.from.localeCompare(b.from));
  const merged: DateRange[] = [];
  for (const r of all) {
    if (!merged.length) {
      merged.push({ ...r });
      continue;
    }
    const last = merged[merged.length - 1];
    if (r.from <= last.to) {
      // Overlapping or touching — extend the current interval
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Return the sub-ranges of [from, to] NOT covered by any interval in the list.
 */
function computeGaps(covered: DateRange[], from: string, to: string): DateRange[] {
  if (!covered.length) return [{ from, to }];

  const gaps: DateRange[] = [];
  let cursor = from;

  for (const interval of covered) {
    if (cursor >= to) break;
    if (interval.to < cursor) continue;         // entirely before cursor — skip
    if (interval.from > cursor) {
      // Gap between cursor and the start of this covered interval
      const gapTo = interval.from < to ? interval.from : to;
      if (cursor < gapTo) gaps.push({ from: cursor, to: gapTo });
    }
    if (interval.to > cursor) cursor = interval.to;
  }

  if (cursor < to) gaps.push({ from: cursor, to });
  return gaps;
}

// ── Rate-limit pacing ─────────────────────────────────────────────────────────

const MAX_RPS = 8;                                    // Fyers cap = 10; stay 20 % under
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_RPS);   // 125 ms between calls

let lastCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  return fn();
}

// ── Daily request budget ──────────────────────────────────────────────────────

let dailyCount = 0;
let budgetDate = todayIST();

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.timezone });
}

/** Increments the daily counter and returns true when budget is still available. */
function consumeBudget(): boolean {
  const today = todayIST();
  if (today !== budgetDate) {
    dailyCount = 0;
    budgetDate = today;
  }
  if (dailyCount >= config.backfillDailyRequestBudget) return false;
  dailyCount++;
  return true;
}

// ── Authenticated adapter cache ───────────────────────────────────────────────
// Keyed by broker_connections.id.  Populated either via registerAdapter()
// (called immediately after a successful login in the broker-connections route)
// or reconstructed from the DB using configureSession() on next access.

const adapterCache = new Map<string, { adapter: BrokerAdapter; expiresAt: number }>();

/**
 * Register a pre-authenticated adapter so the service can use it immediately.
 * Call this right after adapter.login() succeeds in the broker-connections route
 * to avoid re-authentication on the first backfill request.
 */
export function registerAdapter(
  connectionId: string,
  adapter: BrokerAdapter,
  tokenGeneratedAt: string
): void {
  const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
  const expiresAt = new Date(tokenGeneratedAt).getTime() + TOKEN_TTL_MS;
  adapterCache.set(connectionId, { adapter, expiresAt });
  console.log("[marketDataService] Adapter registered for connection %s", connectionId);
}

/**
 * Looks up the most-recently-connected broker, decrypts its credentials,
 * and configures the adapter's internal session state using configureSession()
 * (both current adapters expose this for stored-token reuse without TOTP).
 * Returns null — without throwing — when no usable session exists.
 */
async function getAuthenticatedAdapter(): Promise<BrokerAdapter | null> {
  const row = appDb
    .prepare(
      `SELECT id, broker_name, api_key, access_token, token_generated_at, status
         FROM broker_connections
        WHERE status = 'connected'
        ORDER BY token_generated_at DESC
        LIMIT 1`
    )
    .get() as unknown as BrokerConnectionRow | undefined;

  if (!row?.access_token || !row.token_generated_at) return null;

  // Treat tokens older than 23 h as stale (broker TTL is 24 h)
  const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
  const tokenAge = Date.now() - new Date(row.token_generated_at).getTime();
  if (tokenAge > TOKEN_TTL_MS) {
    adapterCache.delete(row.id);
    return null;
  }

  // Return the cached instance if it has not expired
  const hit = adapterCache.get(row.id);
  if (hit && Date.now() < hit.expiresAt) return hit.adapter;

  // Build a fresh adapter and configure its session from the stored token.
  // Both current adapters (Fyers, Angel One) expose configureSession(apiKey, token)
  // for exactly this purpose — reusing a valid session without re-authentication.
  try {
    const adapter = getAdapter(row.broker_name);
    const apiKey      = decrypt(row.api_key);
    const accessToken = decrypt(row.access_token);

    // Duck-type check: prefer configureSession() over refreshSession()
    const anyAdapter = adapter as unknown as Record<string, unknown>;
    if (typeof anyAdapter.configureSession === "function") {
      (anyAdapter.configureSession as (k: string, t: string) => void)(apiKey, accessToken);
    } else {
      // Fallback for adapters with a token-refresh flow (e.g. OAuth refresh tokens)
      await adapter.refreshSession(accessToken);
    }

    const expiresAt = new Date(row.token_generated_at).getTime() + TOKEN_TTL_MS;
    adapterCache.set(row.id, { adapter, expiresAt });
    return adapter;
  } catch (err) {
    adapterCache.delete(row.id);
    console.warn(
      "[marketDataService] Could not configure adapter for %s: %s",
      row.broker_name,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function isDaily(resolution: string): boolean {
  return resolution === "1D";
}

/** Upsert a batch of bars in a single transaction (daily or intraday). */
function upsertBars(symbol: string, resolution: string, bars: Bar[]): void {
  if (!bars.length) return;

  if (isDaily(resolution)) {
    const stmt = marketDb.prepare(`
      INSERT INTO ohlcv_daily (symbol, date, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, date) DO UPDATE SET
        open = excluded.open, high = excluded.high,
        low  = excluded.low,  close = excluded.close,
        volume = excluded.volume
    `);
    try {
      marketDb.exec("BEGIN");
      for (const b of bars) stmt.run(symbol, b.date, b.open, b.high, b.low, b.close, b.volume);
      marketDb.exec("COMMIT");
    } catch (e) { marketDb.exec("ROLLBACK"); throw e; }
  } else {
    const stmt = marketDb.prepare(`
      INSERT INTO ohlcv_intraday (symbol, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, timestamp) DO UPDATE SET
        open = excluded.open, high = excluded.high,
        low  = excluded.low,  close = excluded.close,
        volume = excluded.volume
    `);
    try {
      marketDb.exec("BEGIN");
      for (const b of bars) stmt.run(symbol, b.date, b.open, b.high, b.low, b.close, b.volume);
      marketDb.exec("COMMIT");
    } catch (e) { marketDb.exec("ROLLBACK"); throw e; }
  }
}

/** Read cached bars for a date range. */
function queryBars(symbol: string, resolution: string, from: string, to: string): Bar[] {
  if (isDaily(resolution)) {
    return marketDb
      .prepare(
        `SELECT date, open, high, low, close, volume
           FROM ohlcv_daily
          WHERE symbol = ? AND date BETWEEN ? AND ?
          ORDER BY date`
      )
      .all(symbol, from, to) as unknown as Bar[];
  }
  return marketDb
    .prepare(
      `SELECT timestamp AS date, open, high, low, close, volume
         FROM ohlcv_intraday
        WHERE symbol = ? AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp`
    )
    .all(symbol, from, to) as unknown as Bar[];
}

/**
 * Merge the newly covered [from, to] interval into the persistent coverage
 * list for (symbol, resolution).  Called immediately after every successful
 * chunk so progress is durable across restarts.
 */
function updateProgress(symbol: string, resolution: string, from: string, to: string): void {
  const now = new Date().toISOString();

  const row = marketDb
    .prepare(
      "SELECT covered_ranges FROM backfill_progress WHERE symbol = ? AND resolution = ?"
    )
    .get(symbol, resolution) as unknown as { covered_ranges: string } | undefined;

  const existing: DateRange[] = JSON.parse(row?.covered_ranges ?? "[]") as DateRange[];
  const merged = mergeIntervals(existing, { from, to });

  marketDb.prepare(`
    INSERT INTO backfill_progress (symbol, resolution, covered_ranges, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(symbol, resolution) DO UPDATE SET
      covered_ranges = excluded.covered_ranges,
      updated_at     = excluded.updated_at
  `).run(symbol, resolution, JSON.stringify(merged), now);
}

/**
 * Return the sub-ranges of [from, to] not yet covered in backfill_progress
 * for this (symbol, resolution) pair.  Uses the full interval list — not just
 * a min/max window — so holes left by failed chunks remain visible.
 */
function gapsFor(
  symbol: string,
  resolution: string,
  from: string,
  to: string
): DateRange[] {
  const row = marketDb
    .prepare(
      "SELECT covered_ranges FROM backfill_progress WHERE symbol = ? AND resolution = ?"
    )
    .get(symbol, resolution) as unknown as { covered_ranges: string } | undefined;

  const covered: DateRange[] = JSON.parse(row?.covered_ranges ?? "[]") as DateRange[];
  return computeGaps(covered, from, to);
}

// ── Chunk sizing ──────────────────────────────────────────────────────────────
// Conservative per-request windows to stay inside broker API limits.

const CHUNK_DAYS: Record<string, number> = {
  "1D":  365,
  "240":  90,
  "120":  60,
  "60":   30,
  "30":   15,
  "15":   10,
  "10":    7,
  "5":     7,
  "3":     5,
  "1":     3,
};

function chunkRange(from: string, to: string, resolution: string): DateRange[] {
  const days = CHUNK_DAYS[resolution] ?? 30;
  const chunks: DateRange[] = [];
  let cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    const tail = new Date(cur);
    tail.setDate(tail.getDate() + days - 1);
    if (tail > end) tail.setTime(end.getTime());
    chunks.push({ from: cur.toISOString().slice(0, 10), to: tail.toISOString().slice(0, 10) });
    cur = new Date(tail);
    cur.setDate(cur.getDate() + 1);
  }
  return chunks;
}

// ── Backfill queue ────────────────────────────────────────────────────────────

interface BackfillTask {
  symbol:     string;
  resolution: string;
  from:       string;
  to:         string;
}

const queue: BackfillTask[] = [];
let workerRunning = false;

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;

  try {
    while (queue.length) {
      // ── 1. Check adapter FIRST — do not burn budget if none is available ──
      const adapter = await getAuthenticatedAdapter();
      if (!adapter) {
        console.warn("[marketDataService] No authenticated adapter — halting backfill worker");
        break; // leave tasks in queue; next getHistoricalBars call will retry
      }

      // ── 2. Check daily budget ─────────────────────────────────────────────
      if (!consumeBudget()) {
        console.warn(
          "[marketDataService] Daily request budget (%d) exhausted — backfill paused until %s IST",
          config.backfillDailyRequestBudget,
          budgetDate
        );
        break; // tasks remain in queue; worker exits until budget resets
      }

      const task = queue.shift()!;

      try {
        await throttle(async () => {
          const bars = await adapter.getHistoricalData(
            task.symbol, task.resolution, task.from, task.to
          );
          upsertBars(task.symbol, task.resolution, bars);
          updateProgress(task.symbol, task.resolution, task.from, task.to);
          console.log(
            "[marketDataService] ✓ backfill %s %s %s→%s  (%d bars)",
            task.symbol, task.resolution, task.from, task.to, bars.length
          );
        });
      } catch (err) {
        // Log but do not re-queue to prevent runaway loops on persistent errors.
        // The gap will remain in backfill_progress and be retried on next call.
        console.error(
          "[marketDataService] Chunk failed %s %s %s→%s: %s",
          task.symbol, task.resolution, task.from, task.to,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  } finally {
    workerRunning = false;
  }
}

function enqueue(tasks: BackfillTask[]): void {
  queue.push(...tasks);
  void runWorker();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch OHLCV bars for a symbol between fromDate and toDate (ISO date strings
 * "YYYY-MM-DD").  Returns cached data immediately; any uncovered sub-ranges are
 * fetched from the connected broker — first chunk inline for a fresh response,
 * remaining chunks queued for background processing.
 */
export async function getHistoricalBars(
  symbol: string,
  resolution: string,
  fromDate: string,
  toDate: string
): Promise<Bar[]> {
  const gaps = gapsFor(symbol, resolution, fromDate, toDate);

  if (gaps.length > 0) {
    const adapter = await getAuthenticatedAdapter();
    if (adapter) {
      const allChunks = gaps.flatMap((g) => chunkRange(g.from, g.to, resolution));
      const [first, ...rest] = allChunks;

      // Fetch the first chunk synchronously so the caller gets fresh data now
      if (first && consumeBudget()) {
        try {
          await throttle(async () => {
            const bars = await adapter.getHistoricalData(
              symbol, resolution, first.from, first.to
            );
            upsertBars(symbol, resolution, bars);
            updateProgress(symbol, resolution, first.from, first.to);
            console.log(
              "[marketDataService] ✓ inline fetch %s %s %s→%s  (%d bars)",
              symbol, resolution, first.from, first.to, bars.length
            );
          });
        } catch (err) {
          console.error(
            "[marketDataService] Inline fetch failed for %s: %s",
            symbol,
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // Enqueue remaining chunks for background processing
      if (rest.length) {
        enqueue(rest.map((c) => ({ symbol, resolution, from: c.from, to: c.to })));
      }
    }
  }

  // Always serve from cache — reflects whatever was just upserted
  return queryBars(symbol, resolution, fromDate, toDate);
}

/**
 * Fetch live quotes from the connected broker adapter.
 * Returns an empty array (without throwing) when no broker session is active.
 * A WebSocket-based live cache will replace this proxy in the next iteration.
 */
export async function getLiveQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return [];

  const adapter = await getAuthenticatedAdapter();
  if (!adapter) {
    console.warn("[marketDataService] getLiveQuotes: no authenticated adapter");
    return [];
  }

  try {
    return await adapter.getQuotes(symbols);
  } catch (err) {
    console.error(
      "[marketDataService] getLiveQuotes error: %s",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/**
 * Diagnostic snapshot — daily budget usage, queue depth, adapter cache state.
 * Exposed through GET /api/market/status for operator monitoring.
 */
export function getServiceStats() {
  return {
    dailyRequestsUsed:  dailyCount,
    dailyRequestBudget: config.backfillDailyRequestBudget,
    budgetResetDate:    budgetDate,
    queueDepth:         queue.length,
    workerRunning,
    adaptersCached:     adapterCache.size,
  };
}
