import cron from "node-cron";
import { config } from "../config/environment.js";
import { connect, disconnect } from "./liveFeedService.js";

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
}
