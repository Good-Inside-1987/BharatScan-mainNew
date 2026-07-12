import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { config } from "../config/environment.js";
import { connect, disconnect, autoSubscribeFoSymbols, clearProtectedSymbols } from "./liveFeedService.js";
import {
  initAtmOptionSubscriptions,
  startAtmRollTracking,
  stopAtmRollTracking,
  getAtmTrackerStatus,
  FO_STOCKS_BUDGET,
  OPTIONS_LIVE_BUDGET,
  ATM_WINDOW,
} from "./liveOptionsTracker.js";
import { marketDb } from "../db.js";
import { syncSymbolMaster } from "./symbolMasterService.js";
import { syncNseHolidayCalendar } from "./holidayCalendarService.js";
import { runEodSyncJob, runIntradaySyncJob } from "./syncJobs.js";
import { runOptionsSyncJob } from "./optionsDataService.js";
import { runFoBanListJob } from "./foBanListService.js";
import { runSupplementaryJob, runMfHoldingsJob } from "./supplementaryJobs.js";
import { runCleanupJob } from "./cleanupJob.js";
import { runStartupCatchUp, startPeriodicCatchUpCheck, getCatchUpStatus } from "./catchUpScheduler.js";

let schedulerActive = false;

// One-time bootstrap: if the symbols table is completely empty (fresh
// deployment, or any day other than Monday morning before the weekly cron
// has ever fired), download the symbol master immediately instead of
// leaving every downstream job (EOD/intraday sync, F&O auto-subscribe, ATM
// option tracking) silently idle for up to 6 days. No-op once symbols has
// at least one row, so it never fights the Monday cron or duplicates work.
// syncSymbolMaster() hits only Fyers' public static files + NSE's public
// index pages — no authenticated broker session required — so this is safe
// to run unconditionally at every server start.
async function bootstrapSymbolMasterIfEmpty(): Promise<void> {
  const row = marketDb.prepare(`SELECT COUNT(*) as c FROM symbols`).get() as { c: number };
  if (row.c > 0) return;

  console.log(
    "[scheduler] symbols table is empty — running one-time bootstrap symbol master sync before registering cron jobs …"
  );
  try {
    const r = await syncSymbolMaster(marketDb);
    console.log(`[scheduler] Symbol master sync complete: ${r.upserted} rows upserted`);
  } catch (err) {
    console.error(
      "[scheduler] Bootstrap symbol master sync failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// One-time bootstrap: if nse_holidays is completely empty (fresh deployment,
// or any day other than Monday morning before the weekly cron has ever
// fired), download the holiday calendar immediately instead of leaving
// isTradingDay() blind to real holidays for up to a week. No-op once
// nse_holidays has at least one row. syncNseHolidayCalendar() hits only
// NSE's public holiday-master API — no authenticated broker session
// required — so this is safe to run unconditionally at every server start.
async function bootstrapHolidayCalendarIfEmpty(): Promise<void> {
  const row = marketDb.prepare(`SELECT COUNT(*) as c FROM nse_holidays`).get() as { c: number };
  if (row.c > 0) return;

  console.log(
    "[scheduler] nse_holidays table is empty — running one-time bootstrap holiday calendar sync before registering cron jobs …"
  );
  try {
    const r = await syncNseHolidayCalendar();
    console.log(`[scheduler] Holiday calendar sync complete: ${r.upserted} rows upserted`);
  } catch (err) {
    console.error(
      "[scheduler] Bootstrap holiday calendar sync failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// Only runs the scheduler inside this process on environments where it's
// not handled by a separate PM2 process (see config.runSchedulerInProcess).
export function startScheduler(): void {
  if (!config.runSchedulerInProcess) return;
  void registerAllCronJobs();
}

// Registers the startup catch-up run and all cron.schedule(...) jobs.
// Called by startScheduler() (guarded by config.runSchedulerInProcess, for
// Replit/local/Electron) and unconditionally by the standalone Oracle
// scheduler process (server/src/scheduler/standalone.ts).
export async function registerAllCronJobs(): Promise<void> {
  // Bootstrap symbols if the table is completely empty — must happen before
  // catch-up and cron registration below so downstream jobs have data to
  // work with as soon as possible on a fresh deployment.
  await bootstrapSymbolMasterIfEmpty();
  // Must also run before catch-up/cron registration below: catch-up's
  // isTradingDay() checks depend on the holiday calendar being current as
  // early as possible in a fresh deployment.
  await bootstrapHolidayCalendarIfEmpty();

  // Catch up on any missed trading days (server was asleep/offline, or a job
  // silently failed) BEFORE the normal cron jobs are registered below, so a
  // startup catch-up run never overlaps one about to fire at its normal time.
  // Runs async — cron registration below does not wait on it.
  void runStartupCatchUp().catch((err) => {
    console.error("[scheduler] Startup catch-up failed:", err instanceof Error ? err.message : String(err));
  });
  startPeriodicCatchUpCheck();

  cron.schedule(
    config.syncSchedule.liveOpen,
    () => {
      console.log(
        "[scheduler] Market open — live feed budget: %d F&O stocks + %d options slots (ATM ±%d, %d indices)",
        FO_STOCKS_BUDGET, OPTIONS_LIVE_BUDGET, ATM_WINDOW, config.optionsIndices.length
      );
      void connect().then(async () => {
        // ── Step 1: F&O stock auto-subscribe (reduced limit to make room for options) ──
        try {
          autoSubscribeFoSymbols(FO_STOCKS_BUDGET);
        } catch (err) {
          console.error(
            "[scheduler] F&O auto-subscribe failed:",
            err instanceof Error ? err.message : String(err)
          );
        }

        // ── Step 2: ATM option subscriptions (per configured index, ±ATM_WINDOW) ──
        try {
          await initAtmOptionSubscriptions();
          startAtmRollTracking();
        } catch (err) {
          console.error(
            "[scheduler] ATM option subscriptions failed:",
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
      // Stop ATM roll timer and unsubscribe all tracked option contracts +
      // index spot symbols first, then disconnect and clear protection flags.
      // This gives each option contract's partial candle a chance to be
      // finalised (SubscriptionManager.remove() calls finalizeCandle) before
      // the WS connection drops.
      stopAtmRollTracking();
      disconnect();
      // Clear protection flags so tomorrow's liveOpen rebuilds fresh.
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

  // Holiday calendar refresh — every Monday at 7:15 AM IST, right after symbolMaster.
  cron.schedule(
    config.syncSchedule.holidayCalendar,
    () => {
      console.log("[scheduler] Running scheduled holiday calendar sync …");
      void syncNseHolidayCalendar().then(r => {
        console.log(`[scheduler] Holiday calendar sync complete: ${r.upserted} rows upserted`);
      }).catch(err => {
        console.error("[scheduler] Holiday calendar sync failed:", err instanceof Error ? err.message : String(err));
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
    // On Oracle, cron jobs are registered by a separate PM2 process
    // (server/src/scheduler/standalone.ts), not this one. `active` stays
    // false here by design — this flag tells the dashboard why, so it can
    // render "Running in separate scheduler process" instead of implying
    // jobs aren't running at all.
    runsInSeparateProcess: config.envLabel === "oracle",
    timezone: config.timezone,
    liveOptions: getAtmTrackerStatus(),
    catchUp: getCatchUpStatus(),
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
      holidayCalendar: {
        expression: config.syncSchedule.holidayCalendar,
        nextRun: schedulerActive ? nextFireTime(config.syncSchedule.holidayCalendar) : null,
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
