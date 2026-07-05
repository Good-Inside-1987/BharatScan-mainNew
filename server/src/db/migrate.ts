import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Project root = two levels up from server/src/db/ (server/src/db -> server/src -> server -> root)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function runMigration(dbDir: string): void {
  const oldPath = path.resolve(projectRoot, "bharatscan.db");
  const appPath = path.join(dbDir, "app.db");
  const backupPath = path.resolve(projectRoot, "bharatscan.db.backup");

  // If old file does not exist, nothing to migrate
  if (!fs.existsSync(oldPath)) {
    console.log("[migrate] No bharatscan.db found — skipping migration");
    return;
  }

  // If app.db already exists, migration already ran
  if (fs.existsSync(appPath)) {
    console.log("[migrate] app.db already exists — skipping migration");
    return;
  }

  console.log("[migrate] Migrating bharatscan.db → app.db ...");

  // Ensure data/ directory exists
  fs.mkdirSync(dbDir, { recursive: true });

  const old = new DatabaseSync(oldPath);
  const app = new DatabaseSync(appPath);

  app.exec("PRAGMA journal_mode=WAL");
  app.exec("PRAGMA foreign_keys=ON");

  // Get all table names from old database
  const tables = old
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  // Copy each table: create it then insert all rows
  for (const { name } of tables) {
    // Get CREATE TABLE statement from old db
    const schema = old
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { sql: string } | undefined;

    if (!schema?.sql) continue;

    // Create table in app.db
    try {
      app.exec(schema.sql);
    } catch {
      // Table already exists — skip
      continue;
    }

    // Copy all rows
    const rows = old.prepare(`SELECT * FROM "${name}"`).all();
    if (rows.length === 0) continue;

    // Build INSERT from first row's keys
    const keys = Object.keys(rows[0] as Record<string, unknown>);
    const placeholders = keys.map(() => "?").join(", ");
    const cols = keys.map(k => `"${k}"`).join(", ");
    const insertStmt = app.prepare(
      `INSERT OR IGNORE INTO "${name}" (${cols}) VALUES (${placeholders})`
    );

    // node:sqlite's DatabaseSync has no .transaction() helper (unlike
    // better-sqlite3) — wrap the batch insert in explicit BEGIN/COMMIT.
    app.exec("BEGIN");
    try {
      for (const row of rows) {
        insertStmt.run(...keys.map(k => (row as Record<string, unknown>)[k] as never));
      }
      app.exec("COMMIT");
    } catch (err) {
      app.exec("ROLLBACK");
      throw err;
    }

    console.log(`[migrate] Copied table "${name}": ${rows.length} rows`);
  }

  old.close();
  app.close();

  // Rename old file to .backup (do NOT delete — safety net)
  fs.renameSync(oldPath, backupPath);
  console.log(`[migrate] Done. Old database renamed to bharatscan.db.backup`);
}
