/**
 * cleanupJob.ts
 *
 * Single nightly cleanup job (6:00 PM IST, after all data jobs) that enforces
 * retention across every market.db table. Retention windows come from config
 * so they differ between Replit (smaller footprint) and Oracle/local (full).
 *
 * Tables covered and their retention sources:
 *   ohlcv_daily       → config.eodRetentionYears
 *   ohlcv_intraday    → config.intradayRetentionMonths   (null = keep forever)
 *   options_intraday  → config.indexOptionsRetentionMonths / stockOptionsRetentionMonths
 *   fo_ban_list       → config.peRatioRetentionYears     (re-used — same order of magnitude)
 *   fii_dii           → config.fiiDiiRetentionYears
 *   pe_ratio          → config.peRatioRetentionYears
 *   mf_holdings       → config.mfHoldingsRetentionYears
 *
 * This is the authoritative place for all retention deletes.
 * The EOD, intraday, and options sync jobs no longer call their own cleanup
 * functions — they delegate here so retention is enforced exactly once per
 * table per day.
 */

import { marketDb } from "../db.js";
import { config } from "../config/environment.js";
import { startSyncLog, finishSyncLog } from "./syncJobs.js";

// All known index underlying names (mirrors UNDERLYING_TO_FYERS in optionsDataService.ts)
const INDEX_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "MIDCPNIFTY"];

// ── Time helpers ──────────────────────────────────────────────────────────────

function yearsAgoDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

function yearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// ── Per-table cleanup functions ───────────────────────────────────────────────

function cleanupEodRows(): number {
  const cutoff = yearsAgoDate(config.eodRetentionYears);
  const r = marketDb.prepare(`DELETE FROM ohlcv_daily WHERE date < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] ohlcv_daily: removed ${n} rows older than ${cutoff}`);
  return n;
}

function cleanupIntradayRows(): number {
  if (config.intradayRetentionMonths === null) return 0; // keep forever
  const cutoff = monthsAgoIso(config.intradayRetentionMonths);
  const r = marketDb.prepare(`DELETE FROM ohlcv_intraday WHERE timestamp < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] ohlcv_intraday: removed ${n} rows older than ${cutoff}`);
  return n;
}

function cleanupOptionsRows(): number {
  const placeholders = INDEX_UNDERLYINGS.map(() => "?").join(",");
  let total = 0;

  // Index options
  if (config.indexOptionsRetentionMonths <= 0) {
    const r = marketDb
      .prepare(`DELETE FROM options_intraday WHERE underlying IN (${placeholders})`)
      .run(...INDEX_UNDERLYINGS);
    const n = Number(r.changes);
    if (n > 0) console.log(`[cleanup] options_intraday (index): removed all ${n} rows (0-month retention)`);
    total += n;
  } else {
    const cutoff = monthsAgoIso(config.indexOptionsRetentionMonths);
    const r = marketDb
      .prepare(`DELETE FROM options_intraday WHERE underlying IN (${placeholders}) AND timestamp < ?`)
      .run(...INDEX_UNDERLYINGS, cutoff);
    const n = Number(r.changes);
    if (n > 0) console.log(`[cleanup] options_intraday (index): removed ${n} rows older than ${cutoff}`);
    total += n;
  }

  // Stock options
  if (config.stockOptionsRetentionMonths <= 0) {
    const r = marketDb
      .prepare(`DELETE FROM options_intraday WHERE underlying NOT IN (${placeholders})`)
      .run(...INDEX_UNDERLYINGS);
    const n = Number(r.changes);
    if (n > 0) console.log(`[cleanup] options_intraday (stocks): removed all ${n} rows (0-month retention)`);
    total += n;
  } else {
    const cutoff = monthsAgoIso(config.stockOptionsRetentionMonths);
    const r = marketDb
      .prepare(`DELETE FROM options_intraday WHERE underlying NOT IN (${placeholders}) AND timestamp < ?`)
      .run(...INDEX_UNDERLYINGS, cutoff);
    const n = Number(r.changes);
    if (n > 0) console.log(`[cleanup] options_intraday (stocks): removed ${n} rows older than ${cutoff}`);
    total += n;
  }

  return total;
}

function cleanupFoBanList(): number {
  // Reuse peRatioRetentionYears — same order of magnitude for point-in-time market data
  const cutoff = yearsAgoIso(config.peRatioRetentionYears);
  const r = marketDb.prepare(`DELETE FROM fo_ban_list WHERE date < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] fo_ban_list: removed ${n} rows older than ${cutoff}`);
  return n;
}

function cleanupFiiDii(): number {
  const cutoff = yearsAgoIso(config.fiiDiiRetentionYears);
  const r = marketDb.prepare(`DELETE FROM fii_dii WHERE date < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] fii_dii: removed ${n} rows older than ${cutoff}`);
  return n;
}

function cleanupPeRatio(): number {
  const cutoff = yearsAgoIso(config.peRatioRetentionYears);
  const r = marketDb.prepare(`DELETE FROM pe_ratio WHERE date < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] pe_ratio: removed ${n} rows older than ${cutoff}`);
  return n;
}

function cleanupMfHoldings(): number {
  // mf_holdings uses month_year (YYYY-MM); compare as text (ISO order preserved)
  const cutoff = yearsAgoIso(config.mfHoldingsRetentionYears).slice(0, 7); // "YYYY-MM"
  const r = marketDb.prepare(`DELETE FROM mf_holdings WHERE month_year < ?`).run(cutoff);
  const n = Number(r.changes);
  if (n > 0) console.log(`[cleanup] mf_holdings: removed ${n} rows older than ${cutoff}`);
  return n;
}

// ── Public job ────────────────────────────────────────────────────────────────

export interface CleanupResult {
  eodRows: number;
  intradayRows: number;
  optionsRows: number;
  foBanRows: number;
  fiiDiiRows: number;
  peRatioRows: number;
  mfHoldingsRows: number;
  totalRows: number;
}

export async function runCleanupJob(): Promise<CleanupResult> {
  const logId = startSyncLog("cleanup");
  console.log("[cleanup] Starting nightly retention cleanup …");

  try {
    const eodRows       = cleanupEodRows();
    const intradayRows  = cleanupIntradayRows();
    const optionsRows   = cleanupOptionsRows();
    const foBanRows     = cleanupFoBanList();
    const fiiDiiRows    = cleanupFiiDii();
    const peRatioRows   = cleanupPeRatio();
    const mfHoldingsRows = cleanupMfHoldings();

    const totalRows =
      eodRows + intradayRows + optionsRows + foBanRows +
      fiiDiiRows + peRatioRows + mfHoldingsRows;

    finishSyncLog(logId, "completed", {
      completed: totalRows,
      skippedBudget: 0,
      failed: 0,
    });

    console.log(
      "[cleanup] Done — total %d rows deleted " +
      "(eod=%d, intraday=%d, options=%d, foBan=%d, fiiDii=%d, pe=%d, mf=%d)",
      totalRows, eodRows, intradayRows, optionsRows, foBanRows,
      fiiDiiRows, peRatioRows, mfHoldingsRows
    );

    return {
      eodRows, intradayRows, optionsRows, foBanRows,
      fiiDiiRows, peRatioRows, mfHoldingsRows, totalRows,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[cleanup] Job failed:", message);
    throw err;
  }
}
