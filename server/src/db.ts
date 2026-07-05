import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { runMigration } from "./db/migrate.js";
import { initMarketDb } from "./db/market-schema.js";
import { initLiveDb } from "./db/live-schema.js";
import { config } from "./config/environment.js";

// Ensure data directory exists
fs.mkdirSync(config.dbDir, { recursive: true });

// Step 1: Run migration (bharatscan.db → app.db) if needed.
// This is idempotent — safe to run on every startup.
runMigration(config.dbDir);

// Step 2: Open app.db (user data — critical, irreplaceable)
export const appDb = new DatabaseSync(path.join(config.dbDir, "app.db"));
appDb.exec("PRAGMA journal_mode=WAL");
appDb.exec("PRAGMA foreign_keys=ON");

// Step 3: Open market.db (price data — large, re-fetchable from Angel)
export const marketDb = new DatabaseSync(path.join(config.dbDir, "market.db"));
initMarketDb(marketDb);

// Step 4: Open live.db (intraday real-time — cleared each evening)
export const liveDb = new DatabaseSync(path.join(config.dbDir, "live.db"));
initLiveDb(liveDb);

// Performance indexes on app.db tables
appDb.exec(`
  CREATE INDEX IF NOT EXISTS idx_holdings_portfolio
    ON holdings(portfolio_id);
  CREATE INDEX IF NOT EXISTS idx_booked_trades_portfolio
    ON booked_trades(portfolio_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts(status);
  CREATE INDEX IF NOT EXISTS idx_alert_triggers_alert
    ON alert_triggers(alert_id);
  CREATE INDEX IF NOT EXISTS idx_paper_positions_account
    ON paper_positions(account_id, status);
  CREATE INDEX IF NOT EXISTS idx_paper_trades_account
    ON paper_trades(account_id);
  CREATE INDEX IF NOT EXISTS idx_scanner_dashboard_scans_dashboard
    ON scanner_dashboard_scans(dashboard_id);
  CREATE INDEX IF NOT EXISTS idx_saved_scans_updated
    ON saved_scans(updated_at);
`);

// Backward-compat alias so any file that still imports { db } keeps working
// during the transition. Remove this once all routes are updated.
export const db = appDb;
