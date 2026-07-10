import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { config } from "../config/environment.js";
import { connect, disconnect } from "./liveFeedService.js";

let schedulerActive = false;

// Only runs the scheduler inside this process on environments where it's
// not handled by a separate PM2 process (see config.runSchedulerInProcess).
export function startScheduler(): void {
  if (!config.runSchedulerInProcess) return;

  cron.schedule(
    config.syncSchedule.liveOpen,
    () => { void connect(); },
    { timezone: config.timezone }
  );

  cron.schedule(
    config.syncSchedule.liveClose,
    () => { disconnect(); },
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
    },
  };
}
