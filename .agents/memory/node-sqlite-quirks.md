---
name: node:sqlite API differences from better-sqlite3
description: Gotchas when using Node's built-in node:sqlite (DatabaseSync) instead of the better-sqlite3 package
---

`node:sqlite`'s `DatabaseSync` does not implement a `.transaction()` helper like
`better-sqlite3` does. Code ported from a better-sqlite3 codebase (or specs/snippets
that assume better-sqlite3 semantics) will fail at runtime with
`TypeError: app.transaction is not a function`.

**Why:** `node:sqlite` is a much smaller experimental API surface; it only exposes
`.exec()`, `.prepare()`, `.close()`, etc. Batch/transactional writes must be done
manually.

**How to apply:** For bulk inserts or multi-statement atomicity, wrap with explicit
`db.exec("BEGIN")` / `db.exec("COMMIT")` (and `ROLLBACK` in a catch), instead of a
`.transaction(fn)` wrapper. Verify this kind of migration/bulk-write logic by running
it standalone (not just via the dev server) since errors thrown during module-level
side effects (e.g. inside `db.ts` at import time) can silently abort only part of a
multi-table loop, leaving a database in a partially-migrated state that then looks
"already done" on the next run.
