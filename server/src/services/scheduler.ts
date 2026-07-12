import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { config } from "../config/environment.js";
import { connect, disconnect, autoSubscribeFoSymbols, clearProtectedSymbols } from "./liveFeedService.js";
import { marketDb } from "../db.js";
import { syncSymbolMaster } from "./symbolMasterService.js";
import { runEodSyncJob, runIntradaySyncJob } from "./syncJobs.js";
import { runOptionsSyncJob } from "./optionsDataService.js";
import { runFoBanListJob } from "./foBanListService.js";
import { runSupplementaryJob, runMfHoldingsJob } from "./supplementaryJobs.js";
import { runCleanupJob } from "./cleanupJob.js";

let schedulerActive = false;

// Only runs the scheduler inside this process on environments where it's
// not handled by a separate PM2 process (see config.runSchedulerInProcess).
export function startScheduler(): void {
  if (!config.runSchedulerInProcess) return;

  cron.schedule(
    config.syncSchedule.liveOpen,
    () => {
      void connect().then(() => {
        try {
          autoSubscribeFoSymbols();
        } catch (err) {
          console.error(
            "[scheduler] F&O auto-subscribe failed:",
            err instanceof Error ? err.message : String(err)
          );
        }
      });
    },
    { timezone: config.timezone }
  );

  cron.schedule(
    config.syncSchedule.liveClose,
    () => {
      disconnect();
      // Clear protection flags (not the connection state) so tomorrow's
      // liveOpen job rebuilds the F&O list fresh instead of treating
      // today's ranking as still pinned.
      clearProtectedSymbols();
    },
    { timezone: config.timezone }
  );

  // Symbol master refresh — every Monday at 7 AM IST
  cron.schedule(
    config.syncSchedule.symbolMaster,
    () => {
      console.log("[scheduler] Running scheduled symbol master sync …");
      void syncSymbolMaster(marketDb).then(r => {
        console.log(`[scheduler] Symbol master sync complete: ${r.upserted} rows upserted`);
      }).catch(err => {
        console.error("[scheduler] Symbol master sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // Nightly EOD sync — 4:00 PM IST, full NSE universe, daily candles.
  cron.schedule(
    config.syncSchedule.eod,
    () => {
      console.log("[scheduler] Running scheduled EOD sync …");
      void runEodSyncJob().catch((err) => {
        console.error("[scheduler] EOD sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // Nightly intraday sync — 4:30 PM IST, universe/candle-size per config.
  cron.schedule(
    config.syncSchedule.intraday,
    () => {
      console.log("[scheduler] Running scheduled intraday sync …");
      void runIntradaySyncJob().catch((err) => {
        console.error("[scheduler] Intraday sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // Nightly options sync — 5:00 PM IST, ATM ± range CE/PE for configured
  // indices (and F&O stocks when config.includeStockOptions is true).
  cron.schedule(
    config.syncSchedule.options,
    () => {
      console.log("[scheduler] Running scheduled options sync …");
      void runOptionsSyncJob().catch((err) => {
        console.error("[scheduler] Options sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // F&O ban list — 8:30 AM IST (before market open). Fetches NSE's daily list
  // of securities banned from fresh F&O positions due to MWPL breach.
  cron.schedule(
    config.syncSchedule.foBanList,
    () => {
      console.log("[scheduler] Running scheduled F&O ban list fetch …");
      void runFoBanListJob().catch((err) => {
        console.error("[scheduler] F&O ban list failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // Supplementary data — 5:30 PM IST. FII/DII daily activity + PE/PB/DivYield
  // for major indices, both from NSE.
  cron.schedule(
    config.syncSchedule.supplementary,
    () => {
      console.log("[scheduler] Running scheduled supplementary sync (FII/DII + PE) …");
      void runSupplementaryJob().catch((err) => {
        console.error("[scheduler] Supplementary sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // MF holdings — 5th of each month at 5:00 PM IST. Fetches AMFI's monthly
  // portfolio disclosure for the previous month (idempotent — safe to re-run).
  cron.schedule(
    config.syncSchedule.mfHoldings,
    () => {
      console.log("[scheduler] Running scheduled MF holdings sync …");
      void runMfHoldingsJob().catch((err) => {
        console.error("[scheduler] MF holdings sync failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  // Nightly cleanup — 6:00 PM IST. Single pass that enforces retention windows
  // across all tables. This is the only place retention deletes happen.
  cron.schedule(
    config.syncSchedule.cleanup,
    () => {
      console.log("[scheduler] Running scheduled nightly cleanup …");
      void runCleanupJob().catch((err) => {
        console.error("[scheduler] Cleanup failed:", err instanceof Error ? err.message : String(err));
      });
    },
    { timezone: config.timezone }
  );

  schedulerActive = true;
}

function nextFireTime(expression: string): string | null {
  try {
    const interval = CronExpressionParser.parse(expression, { tz: config.timezone });
    return interval.next().toDate().toISOString();
  } catch {
    return null;
  }
}

export function getSchedulerStatus() {
  return {
    active: schedulerActive,
    runSchedulerInProcess: config.runSchedulerInProcess,
    timezone: config.timezone,
    jobs: {
      liveOpen: {
        expression: config.syncSchedule.liveOpen,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.liveOpen) : null,
      },
      liveClose: {
        expression: config.syncSchedule.liveClose,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.liveClose) : null,
      },
      symbolMaster: {
        expression: config.syncSchedule.symbolMaster,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.symbolMaster) : null,
      },
      eod: {
        expression: config.syncSchedule.eod,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.eod) : null,
      },
      intraday: {
        expression: config.syncSchedule.intraday,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.intraday) : null,
      },
      options: {
        expression: config.syncSchedule.options,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.options) : null,
      },
      foBanList: {
        expression: config.syncSchedule.foBanList,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.foBanList) : null,
      },
      supplementary: {
        expression: config.syncSchedule.supplementary,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.supplementary) : null,
      },
      mfHoldings: {
        expression: config.syncSchedule.mfHoldings,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.mfHoldings) : null,
      },
      cleanup: {
        expression: config.syncSchedule.cleanup,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.cleanup) : null,
      },
    },
  };
}
