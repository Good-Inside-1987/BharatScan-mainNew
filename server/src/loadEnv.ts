// Loads environment variables from a local .env file — but only when NOT
// running on Replit. Replit injects Secrets directly into process.env, so
// dotenv is unnecessary (and must not override those values) there.
//
// This must be the very first import in src/index.ts so API_KEY,
// BROKER_ENCRYPTION_KEY, etc. are available before config/environment.ts
// and any other module reads process.env.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const isReplit = !!process.env.REPL_ID;

if (!isReplit) {
  // server/src/loadEnv.ts -> server/src -> server -> project root
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  dotenv.config({ path: path.join(projectRoot, ".env") });
}
