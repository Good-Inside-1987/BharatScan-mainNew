// Headless entry point for the Oracle-only PM2 process
// ('bharatscan-scheduler', see ecosystem.config.js and the root
// `start:scheduler` script). This process registers and runs all cron jobs
// but never serves HTTP — the main web-server process (server/src/index.ts)
// handles requests and deliberately skips cron registration on Oracle
// (config.runSchedulerInProcess === false there).
//
// Must be imported first, exactly like index.ts, so .env is loaded before
// config/environment.ts is read (Oracle doesn't use Replit Secrets).
import "../loadEnv.js";

// IMPORTANT: db.ts must be imported first — it runs migration and
// initialises all three databases before any scheduled job runs, same
// "must be imported first" ordering as index.ts.
import { db, appDb, marketDb, liveDb } from "../db.js";
import { config } from "../config/environment.js";
import { registerAllCronJobs } from "../services/scheduler.js";

void db;
void appDb;
void marketDb;
void liveDb;

process.on("unhandledRejection", (reason) => {
  console.error("[scheduler-standalone] Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[scheduler-standalone] Uncaught exception:", err.stack ?? err.message);
  process.exit(1);
});

// Unconditional — ignore config.runSchedulerInProcess entirely here, since
// this file's whole purpose is to be the dedicated process that runs cron
// jobs on Oracle.
await registerAllCronJobs();

const jobCount = Object.keys(config.syncSchedule).length;
console.log(
  `[scheduler-standalone] Started — registered ${jobCount} cron jobs, timezone=${config.timezone}`
);
