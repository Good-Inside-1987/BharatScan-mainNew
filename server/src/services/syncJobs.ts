/**
 * syncJobs.ts
 *
 * Nightly EOD + intraday sync jobs, triggered by the scheduler at
 * config.syncSchedule.eod (4pm IST) and config.syncSchedule.intraday
 * (4:30pm IST).
 *
 * Both jobs draw from the SAME shared daily request budget enforced in
 * marketDataService.ts (no separate counter) by delegating the actual
 * broker fetch to getHistoricalBars(), which already applies rate-limit
 * pacing, budget consumption, and backfill_progress bookkeeping.
 *
 * Before spending a broker call, each job first checks whether the target
 * date is already present in the local table (ohlcv_daily / ohlcv_intraday)
 * — this is what lets the intraday job skip the ~200 F&O symbols the live
 * feed already captured in real time, backfilling only what's missing.
 */

import { marketDb } from "../db.js";
import { config } from "../config/environment.js";
import { getHistoricalBars, getAuthenticatedAdapter, getServiceStats } from "./marketDataService.js";
import { AuthenticationError, SessionExpiredError } from "../errors/brokerErrors.js";
import { isTradingDay } from "./tradingCalendar.js";

// ── Fyers symbol helper (same convention as dataLoader.ts's toFyersSymbol) ────
function toFyersSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes(":")) return s;
  return `NSE:${s}-EQ`;
}

export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.timezone });
}

// ── sync_log helpers ────────────────────────────────────────────────────────
// Extend the existing sync_log table (idempotent) with per-run symbol counts
// so the Backfill Dashboard can show completed vs. skipped-due-to-budget.
try {
  marketDb.exec(`ALTER TABLE sync_log ADD COLUMN symbols_completed INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }
try {
  marketDb.exec(`ALTER TABLE sync_log ADD COLUMN symbols_skipped_budget INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }
try {
  marketDb.exec(`ALTER TABLE sync_log ADD COLUMN symbols_failed INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }
try {
  marketDb.exec(`ALTER TABLE sync_log ADD COLUMN target_date TEXT`);
} catch { /* column already exists */ }
try {
  marketDb.exec(`CREATE INDEX IF NOT EXISTS idx_sync_log_target_date ON sync_log(job_name, target_date, status)`);
} catch { /* index already exists */ }

interface SyncLogRow {
  id: number;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  rows_processed: number;
  error_message: string | null;
  symbols_completed: number;
  symbols_skipped_budget: number;
  symbols_failed: number;
}

export function startSyncLog(jobName: string, targetDate: string = todayIST()): number {
  const startedAt = new Date().toISOString();
  const result = marketDb
    .prepare(
      `INSERT INTO sync_log (job_name, started_at, status, rows_processed, target_date)
       VALUES (?, ?, 'running', 0, ?)`
    )
    .run(jobName, startedAt, targetDate);
  return Number(result.lastInsertRowid);
}

/**
 * Most recent trading date (YYYY-MM-DD) this job successfully completed,
 * or null if it has never completed successfully. Used by the catch-up
 * orchestrator to find how far behind a job has fallen.
 */
export function getLastSuccessDate(jobName: string): string | null {
  const row = marketDb
    .prepare(
      `SELECT MAX(target_date) AS maxDate FROM sync_log
        WHERE job_name = ? AND status = 'completed' AND target_date IS NOT NULL`
    )
    .get(jobName) as unknown as { maxDate: string | null } | undefined;
  return row?.maxDate ?? null;
}

/** True if `jobName` has a logged successful completion for exactly `date`. */
export function hasSuccessfulRunForDate(jobName: string, date: string): boolean {
  const row = marketDb
    .prepare(
      `SELECT 1 FROM sync_log WHERE job_name = ? AND target_date = ? AND status = 'completed' LIMIT 1`
    )
    .get(jobName, date);
  return !!row;
}

export function finishSyncLog(
  id: number,
  status: "completed" | "failed",
  stats: { completed: number; skippedBudget: number; failed: number },
  errorMessage?: string
): void {
  marketDb
    .prepare(
      `UPDATE sync_log
          SET finished_at = ?, status = ?, rows_processed = ?,
              symbols_completed = ?, symbols_skipped_budget = ?, symbols_failed = ?,
              error_message = ?
        WHERE id = ?`
    )
    .run(
      new Date().toISOString(),
      status,
      stats.completed,
      stats.completed,
      stats.skippedBudget,
      stats.failed,
      errorMessage ?? null,
      id
    );
}

/** Most recent run of a nightly sync job, for the Backfill Dashboard. */
export interface NightlySyncJobStatus {
  jobName: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  symbolsCompleted: number;
  symbolsSkippedBudget: number;
  symbolsFailed: number;
  errorMessage: string | null;
}

export function lastRun(jobName: string): NightlySyncJobStatus {
  const row = marketDb
    .prepare(
      `SELECT * FROM sync_log WHERE job_name = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(jobName) as unknown as SyncLogRow | undefined;

  if (!row) {
    return {
      jobName,
      startedAt: null,
      finishedAt: null,
      status: null,
      symbolsCompleted: 0,
      symbolsSkippedBudget: 0,
      symbolsFailed: 0,
      errorMessage: null,
    };
  }

  return {
    jobName,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    symbolsCompleted: row.symbols_completed,
    symbolsSkippedBudget: row.symbols_skipped_budget,
    symbolsFailed: row.symbols_failed,
    errorMessage: row.error_message,
  };
}

export function getNightlySyncStatus() {
  return {
    eod: lastRun("eod_sync"),
    intraday: lastRun("intraday_sync"),
    options: lastRun("options_sync"),
    symbolMaster: lastRun("symbol_master"),
  };
}

// ── Retention cleanup ─────────────────────────────────────────────────────────

function cleanupOldEodRows(): void {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - config.eodRetentionYears);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const result = marketDb.prepare(`DELETE FROM ohlcv_daily WHERE date < ?`).run(cutoffDate);
  if (Number(result.changes) > 0) {
    console.log(`[syncJobs] EOD cleanup: removed ${result.changes} rows older than ${cutoffDate}`);
  }
}

function cleanupOldIntradayRows(): void {
  if (config.intradayRetentionMonths === null) return; // keep forever
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - config.intradayRetentionMonths);
  const cutoffIso = cutoff.toISOString();
  const result = marketDb.prepare(`DELETE FROM ohlcv_intraday WHERE timestamp < ?`).run(cutoffIso);
  if (Number(result.changes) > 0) {
    console.log(`[syncJobs] Intraday cleanup: removed ${result.changes} rows older than ${cutoffIso}`);
  }
}

// ── Shared symbol loop ──────────────────────────────────────────────────────

interface SymbolRow { symbol: string }

interface JobStats { completed: number; skippedBudget: number; failed: number }

/**
 * Runs the fetch loop for a list of symbols against a single target date,
 * skipping symbols already covered locally (free) and stopping the broker
 * calls cleanly once the shared daily request budget is exhausted (any
 * symbols not yet reached are counted as skippedBudget, not failed).
 */
async function runSymbolLoop(
  symbols: string[],
  resolution: string,
  date: string,
  alreadyCovered: (symbol: string) => boolean
): Promise<JobStats> {
  const stats: JobStats = { completed: 0, skippedBudget: 0, failed: 0 };
  let budgetExhausted = false;

  for (const symbol of symbols) {
    if (alreadyCovered(symbol)) {
      stats.completed++;
      continue;
    }

    if (budgetExhausted) {
      stats.skippedBudget++;
      continue;
    }

    if (getServiceStats().remainingBudgetToday <= 0) {
      budgetExhausted = true;
      stats.skippedBudget++;
      continue;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const bars = await getHistoricalBars(toFyersSymbol(symbol), resolution, date, date);
      if (bars.length > 0) {
        stats.completed++;
      } else {
        // No candle for this date (e.g. symbol didn't trade) — not a failure,
        // but not "completed" data either. Count it alongside failed for
        // visibility without inflating the completed count.
        stats.failed++;
      }
    } catch (err) {
      stats.failed++;
      if (err instanceof AuthenticationError || err instanceof SessionExpiredError) {
        console.error(
          "[syncJobs] Broker session unavailable mid-job (%s) — stopping cleanly",
          err.message
        );
        break;
      }
      console.error(
        "[syncJobs] Failed to sync %s @ %s: %s",
        symbol, date, err instanceof Error ? err.message : String(err)
      );
    }
  }

  return stats;
}

// ── EOD job (4:00 PM IST) ────────────────────────────────────────────────────

function isEodCovered(symbol: string, date: string): boolean {
  const row = marketDb
    .prepare(`SELECT 1 FROM ohlcv_daily WHERE symbol = ? AND date = ?`)
    .get(toFyersSymbol(symbol), date);
  return !!row;
}

/**
 * Pulls today's daily close candle for every symbol in the "symbols" table
 * (full NSE universe), resolution "1D". Applies retention (delete rows older
 * than config.eodRetentionYears) after the fetch loop.
 */
export async function runEodSyncJob(
  targetDate: string = todayIST()
): Promise<JobStats & { skippedNoAdapter?: boolean }> {
  const date = targetDate;
  const logId = startSyncLog("eod_sync", date);

  try {
    if (!isTradingDay(date)) {
      console.log("[syncJobs] %s is not a trading day — skipping EOD sync, 0 budget spent", date);
      finishSyncLog(logId, "completed", { completed: 0, skippedBudget: 0, failed: 0 });
      return { completed: 0, skippedBudget: 0, failed: 0 };
    }

    const adapter = await getAuthenticatedAdapter();
    if (!adapter) {
      console.warn("[syncJobs] EOD sync skipped — no broker connected");
      finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, "No broker connected");
      return { completed: 0, skippedBudget: 0, failed: 0, skippedNoAdapter: true };
    }

    const sql =
      config.eodUniverse === "fo_stocks"
        ? `SELECT symbol FROM symbols WHERE is_delisted = 0 AND is_fo_eligible = 1`
        : `SELECT symbol FROM symbols WHERE is_delisted = 0`;
    const symbolRows = marketDb.prepare(sql).all() as unknown as SymbolRow[];
    const symbols = symbolRows.map((r) => r.symbol);

    console.log(`[syncJobs] EOD sync starting — ${symbols.length} symbols for ${date} (universe: ${config.eodUniverse})`);
    const stats = await runSymbolLoop(symbols, "1D", date, (s) => isEodCovered(s, date));

    // Retention cleanup is handled centrally by cleanupJob.ts (6 PM IST).

    finishSyncLog(logId, "completed", stats);
    console.log(
      "[syncJobs] EOD sync done — completed=%d skippedBudget=%d failed=%d",
      stats.completed, stats.skippedBudget, stats.failed
    );
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[syncJobs] EOD sync crashed:", message);
    throw err;
  }
}

// ── Intraday job (4:30 PM IST) ───────────────────────────────────────────────

function intradayResolutionCode(): string {
  return config.intradayCandleSize === "5min" ? "5" : "1";
}

function isIntradayCovered(symbol: string, date: string): boolean {
  const row = marketDb
    .prepare(
      `SELECT 1 FROM ohlcv_intraday WHERE symbol = ? AND timestamp >= ? AND timestamp < ? LIMIT 1`
    )
    .get(toFyersSymbol(symbol), `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
  return !!row;
}

/**
 * Backfills/tops-up intraday candles for today. Universe and candle size
 * come from config.intradayUniverse / config.intradayCandleSize:
 *   - "fo_stocks" (Replit): only is_fo_eligible symbols, 5-min candles.
 *   - "all_nse" (Oracle/local): every symbol, 1-min candles.
 * Symbols already covered by the live feed's real-time capture (rows already
 * present in ohlcv_intraday for today) are skipped for free. Applies
 * retention (delete rows older than config.intradayRetentionMonths, or
 * never, when null) after the fetch loop.
 */
export async function runIntradaySyncJob(
  targetDate: string = todayIST()
): Promise<JobStats & { skippedNoAdapter?: boolean }> {
  const date = targetDate;
  const logId = startSyncLog("intraday_sync", date);

  try {
    if (!isTradingDay(date)) {
      console.log("[syncJobs] %s is not a trading day — skipping intraday sync, 0 budget spent", date);
      finishSyncLog(logId, "completed", { completed: 0, skippedBudget: 0, failed: 0 });
      return { completed: 0, skippedBudget: 0, failed: 0 };
    }

    const adapter = await getAuthenticatedAdapter();
    if (!adapter) {
      console.warn("[syncJobs] Intraday sync skipped — no broker connected");
      finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, "No broker connected");
      return { completed: 0, skippedBudget: 0, failed: 0, skippedNoAdapter: true };
    }

    const sql =
      config.intradayUniverse === "fo_stocks"
        ? `SELECT symbol FROM symbols WHERE is_delisted = 0 AND is_fo_eligible = 1`
        : `SELECT symbol FROM symbols WHERE is_delisted = 0`;
    const symbolRows = marketDb.prepare(sql).all() as unknown as SymbolRow[];
    const symbols = symbolRows.map((r) => r.symbol);
    const resolution = intradayResolutionCode();

    console.log(
      "[syncJobs] Intraday sync starting — %d symbols (%s universe, %s candles) for %s",
      symbols.length, config.intradayUniverse, config.intradayCandleSize, date
    );
    const stats = await runSymbolLoop(symbols, resolution, date, (s) => isIntradayCovered(s, date));

    // Retention cleanup is handled centrally by cleanupJob.ts (6 PM IST).

    finishSyncLog(logId, "completed", stats);
    console.log(
      "[syncJobs] Intraday sync done — completed=%d skippedBudget=%d failed=%d",
      stats.completed, stats.skippedBudget, stats.failed
    );
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[syncJobs] Intraday sync crashed:", message);
    throw err;
  }
}
