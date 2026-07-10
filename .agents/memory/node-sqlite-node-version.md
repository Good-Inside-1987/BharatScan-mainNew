---
name: node:sqlite Node version requirement
description: node:sqlite requires Node.js v22.5+; imported repls often default to an older nodejs module that fails at runtime.
---

Importing a project that uses `node:sqlite` (e.g. `DatabaseSync`) can fail with
`ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` if the
workspace's Node module is older than v22.5.

**Why:** `node:sqlite` is a newer built-in (stabilized around Node 22.5+). The
`.replit` import process doesn't infer this from source, so it may leave the
default `nodejs-20` module in place.

**How to apply:** If a server using `node:sqlite` fails to start with that
error, use `installProgrammingLanguage({ language: "nodejs-22" })` (or newer)
to switch the workspace's Node module, then restart the workflow.
