import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.env.DB_PATH ?? path.resolve(__dirname, "../../bharatscan.db");

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_scans (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    scan_json   TEXT NOT NULL,
    folder      TEXT,
    is_favorite INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    last_run_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portfolio_dashboards (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portfolios (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    notes        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id           TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    qty          REAL NOT NULL,
    buy_price    REAL NOT NULL,
    buy_date     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'holding',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS booked_trades (
    id           TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    holding_id   TEXT,
    symbol       TEXT NOT NULL,
    qty          REAL NOT NULL,
    buy_price    REAL NOT NULL,
    sell_price   REAL NOT NULL,
    buy_date     TEXT NOT NULL,
    sell_date    TEXT NOT NULL,
    realized_pnl REAL NOT NULL,
    created_at   TEXT NOT NULL
  );
`);

// ── Migration: add dashboard_id column to portfolios ──────────────────────────
try {
  db.exec("ALTER TABLE portfolios ADD COLUMN dashboard_id TEXT");
} catch { /* column already exists — safe to ignore */ }

// ── Migration: add broker_account column to holdings ─────────────────────────
try {
  db.exec("ALTER TABLE holdings ADD COLUMN broker_account TEXT");
} catch { /* column already exists — safe to ignore */ }

// ── Migration: seed default "Family Portfolio" dashboard ──────────────────────
const dashboardCount = (
  db.prepare("SELECT COUNT(*) as c FROM portfolio_dashboards").get() as { c: number }
).c;

if (dashboardCount === 0) {
  const defaultId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO portfolio_dashboards (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(defaultId, "Family Portfolio", "#6366f1", now, now);
  // Assign all existing portfolios (those with no dashboard yet) to this default
  db.prepare("UPDATE portfolios SET dashboard_id = ? WHERE dashboard_id IS NULL").run(defaultId);
}

// ── Scanner Dashboard tables ───────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS scanner_dashboards (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scanner_dashboard_scans (
    id           TEXT PRIMARY KEY,
    dashboard_id TEXT NOT NULL REFERENCES scanner_dashboards(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    filter_json  TEXT NOT NULL DEFAULT '{}',
    series       TEXT NOT NULL DEFAULT 'EQ',
    order_idx    INTEGER NOT NULL DEFAULT 0,
    last_run_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
`);

// ── Alerts tables ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id                  TEXT PRIMARY KEY,
    symbol              TEXT NOT NULL,
    condition_type      TEXT NOT NULL,
    target_price        REAL NOT NULL,
    note                TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'active',
    priority            TEXT NOT NULL DEFAULT 'medium',
    side                TEXT NOT NULL DEFAULT 'buy',
    trigger_count       INTEGER NOT NULL DEFAULT 0,
    last_checked_price  REAL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    last_triggered_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_triggers (
    id              TEXT PRIMARY KEY,
    alert_id        TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    condition_type  TEXT NOT NULL,
    target_price    REAL NOT NULL,
    triggered_price REAL NOT NULL,
    triggered_at    TEXT NOT NULL
  );
`);

// ── Migration: add color column to scanner_dashboards ─────────────────────────
try {
  db.exec("ALTER TABLE scanner_dashboards ADD COLUMN color TEXT NOT NULL DEFAULT '#6366f1'");
} catch { /* column already exists — safe to ignore */ }

// ── Migration: add side column to alerts ──────────────────────────────────────
try {
  db.exec("ALTER TABLE alerts ADD COLUMN side TEXT NOT NULL DEFAULT 'buy'");
} catch { /* column already exists — safe to ignore */ }

// ── Paper Trading tables ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_accounts (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    starting_balance  REAL NOT NULL,
    cash_balance      REAL NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS paper_positions (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
    instrument_type TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    underlying      TEXT,
    strike          REAL,
    option_type     TEXT,
    expiry          TEXT,
    side            TEXT NOT NULL,
    qty             REAL NOT NULL,
    lot_size        REAL NOT NULL DEFAULT 1,
    entry_price     REAL NOT NULL,
    entry_date      TEXT NOT NULL,
    margin_blocked  REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS paper_trades (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
    position_id     TEXT,
    instrument_type TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    underlying      TEXT,
    strike          REAL,
    option_type     TEXT,
    expiry          TEXT,
    side            TEXT NOT NULL,
    qty             REAL NOT NULL,
    lot_size        REAL NOT NULL DEFAULT 1,
    entry_price     REAL NOT NULL,
    exit_price      REAL NOT NULL,
    entry_date      TEXT NOT NULL,
    exit_date       TEXT NOT NULL,
    realized_pnl    REAL NOT NULL,
    created_at      TEXT NOT NULL
  );
`);

// ── Migration: seed a default paper trading account ───────────────────────────
const paperAccountCount = (
  db.prepare("SELECT COUNT(*) as c FROM paper_accounts").get() as { c: number }
).c;

if (paperAccountCount === 0) {
  const defaultId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO paper_accounts (id, name, starting_balance, cash_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(defaultId, "My Paper Account", 1000000, 1000000, now, now);
}

// Performance indexes — safe to add; CREATE INDEX IF NOT EXISTS is idempotent
db.exec(`
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

// ── DB version ────────────────────────────────────────────────────────────────
const existingVersion = db
  .prepare("SELECT value FROM app_meta WHERE key = ?")
  .get("db_version") as { value: string } | undefined;

if (!existingVersion) {
  db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run("db_version", "2");
} else if (existingVersion.value === "1") {
  db.prepare("UPDATE app_meta SET value = ? WHERE key = ?").run("2", "db_version");
}
