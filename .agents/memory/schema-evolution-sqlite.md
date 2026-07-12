---
name: SQLite schema evolution — column added via ALTER, not initial CREATE
description: Adding a new column to an existing table needs the ALTER to run before any CREATE INDEX referencing it; don't add the same index to the initial CREATE-TABLE-IF-NOT-EXISTS block.
---

When a table already exists in deployed DBs (CREATE TABLE IF NOT EXISTS is a no-op on it), a new column must be
added via an idempotent `ALTER TABLE ... ADD COLUMN` guarded by try/catch, run at import time in the module that
owns the table's write logic.

**Why:** Adding `CREATE INDEX ... ON table(new_column)` to the *initial* schema-init block (the one that only
creates fresh tables) executes unconditionally against pre-existing DBs that don't have the column yet, throwing
"no such column" and crashing startup — even though the surrounding CREATE TABLE IF NOT EXISTS silently no-ops.

**How to apply:** Put the new index creation next to (after) the ALTER TABLE ADD COLUMN that introduces the
column, in the module that runs that migration — not in the schema-init file that only handles brand-new DBs.
