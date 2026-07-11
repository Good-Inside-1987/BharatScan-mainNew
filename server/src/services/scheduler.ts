import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { config } from "../config/environment.js";
import { connect, disconnect, autoSubscribeFoSymbols, clearProtectedSymbols } from "./liveFeedService.js";
import { marketDb } from "../db.js";
import { syncSymbolMaster } from "./symbolMasterService.js";

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
    },
  };
}
