// Single source of truth for all environment-specific settings.
// Auto-detects Replit (via REPL_ID env var) vs Oracle.
// Angel API sync jobs read all their settings from this object —
// nothing is hardcoded inside the sync jobs themselves.

import path from "path";
import { fileURLToPath } from "url";

// Project root = one level up from server/src/config/ (server/src/config -> server/src -> server -> root)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const isReplit = !!process.env.REPL_ID;

export const config = {
  // Which environment we're running in
  env: isReplit ? "replit" : "oracle" as const,
  isReplit,

  // Where database files are stored
  // In Replit: project root /data/
  // On Oracle: set DB_DIR env var in .env to wherever you want them
  // Resolved relative to the project root (not process.cwd()) so it
  // works regardless of which package directory the process is launched from.
  dbDir: process.env.DB_DIR
    ? path.resolve(process.env.DB_DIR)
    : path.join(projectRoot, "data"),

  // ── EOD stock data ──────────────────────────────────────────────
  // Universe is always all NSE stocks in both environments.
  // Only the retention depth differs.
  eodRetentionYears: isReplit ? 3 : 10,

  // ── Intraday stock data ─────────────────────────────────────────
  // Replit: only F&O stocks (~211), 5-min candles, 3-month rolling window
  // Oracle: all NSE stocks, 1-min candles, kept forever
  intradayUniverse: isReplit ? "fo_stocks" : "all_nse" as const,
  intradayCandleSize: isReplit ? "5min" : "1min" as const,
  intradayRetentionMonths: isReplit ? 3 : null, // null = keep forever

  // ── Options data ────────────────────────────────────────────────
  // Strike ranges: indices get wider range (more liquid far OTM strikes)
  //                stocks get narrower range (far OTM stock options are useless)
  optionsIndices: isReplit
    ? ["NIFTY", "SENSEX"]
    : ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "MIDCPNIFTY"],
  includeStockOptions: !isReplit,     // stock options only on Oracle
  indexOptionsStrikeRange: 30,        // ATM ±30 for all indices — both environments
  stockOptionsStrikeRange: 20,        // ATM ±20 for F&O stocks — Oracle only
  indexOptionsRetentionMonths: isReplit ? 1 : 9,
  stockOptionsRetentionMonths: isReplit ? 0 : 6,

  // ── Supplementary data ──────────────────────────────────────────
  fiiDiiRetentionYears: isReplit ? 3 : 10,
  peRatioRetentionYears: isReplit ? 3 : 5,
  mfHoldingsRetentionYears: isReplit ? 2 : 5,

  // ── Scheduler ───────────────────────────────────────────────────
  // CRITICAL: always use Asia/Kolkata — Oracle server defaults to UTC.
  // Never use system timezone or a hardcoded UTC offset.
  timezone: "Asia/Kolkata" as const,

  // All times in IST (24-hour). Cron expressions use this timezone explicitly.
  syncSchedule: {
    foBanList:    "30 8 * * 1-5",   // 8:30 AM IST — fetch before market opens
    eod:          "0 16 * * 1-5",   // 4:00 PM IST — after market close
    intraday:     "30 16 * * 1-5",  // 4:30 PM IST
    options:      "0 17 * * 1-5",   // 5:00 PM IST
    supplementary:"30 17 * * 1-5",  // 5:30 PM IST — FII/DII, PE, MF
    cleanup:      "0 18 * * 1-5",   // 6:00 PM IST — delete old data
    liveOpen:     "0 9 * * 1-5",    // 9:00 AM IST — start WebSocket
    liveClose:    "35 15 * * 1-5",  // 3:35 PM IST — close WebSocket
    symbolMaster: "0 7 * * 1",      // 7:00 AM IST every Monday
    mfHoldings:   "0 17 5 * *",     // 5th of each month at 5 PM
  },

  // Whether the scheduler runs inside the Express process (Replit)
  // or as a completely separate PM2 process (Oracle).
  // On Oracle, deploy only restarts bharatscan (web server),
  // never bharatscan-scheduler, so a 4 PM sync is never interrupted
  // by a routine code deploy.
  runSchedulerInProcess: isReplit,
};

export type AppConfig = typeof config;
