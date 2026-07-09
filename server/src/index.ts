import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { statSync } from "fs";
import { timingSafeEqual, createHmac, randomBytes } from "crypto";
import cookieParser from "cookie-parser";
// IMPORTANT: db.ts must be imported first — it runs migration and
// initialises all three databases before any route handlers run.
import { db, appDb, marketDb, liveDb } from "./db.js";
import { config } from "./config/environment.js";
import scansRouter from "./routes/scans.js";
import settingsRouter from "./routes/settings.js";
import portfolioRouter from "./routes/portfolio.js";
import dashboardsRouter from "./routes/dashboards.js";
import scannerDashboardsRouter from "./routes/scannerDashboards.js";
import alertsRouter from "./routes/alerts.js";
import paperTradingRouter from "./routes/paperTrading.js";
import brokerConnectionsRouter from "./routes/brokerConnections.js";

void appDb;
void marketDb;
void liveDb;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function signSession(key: string): string {
  const nonce = randomBytes(16).toString("hex");
  const sig = createHmac("sha256", key).update(nonce).digest("hex");
  return `${nonce}.${sig}`;
}

function verifySession(token: string, key: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  const expected = createHmac("sha256", key).update(nonce).digest("hex");
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

if (!process.env.BROKER_ENCRYPTION_KEY) {
  console.warn(
    "[WARN] BROKER_ENCRYPTION_KEY is not set. " +
    "Broker credential encryption will fail. " +
    "Add BROKER_ENCRYPTION_KEY to your .env file."
  );
}

const app = express();
const port = Number(process.env.SERVER_PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true; // allowed
  }
  if (entry.count >= 10) return false; // blocked
  entry.count++;
  return true; // allowed
}

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }
  const { key } = req.body as { key?: string };
  const requiredKey = process.env.API_KEY;
  if (!requiredKey) {
    res.json({ ok: true }); return;
  }
  if (!key || key.length !== requiredKey.length) {
    res.status(401).json({ error: "Invalid key" }); return;
  }
  if (!timingSafeEqual(Buffer.from(key), Buffer.from(requiredKey))) {
    res.status(401).json({ error: "Invalid key" }); return;
  }
  res.cookie("bs_session", signSession(requiredKey), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  // Skip auth check if no API_KEY is set in environment
  // (allows development without setting up a key)
  const requiredKey = process.env.API_KEY;
  if (!requiredKey) { next(); return; }

  // Allow health check without auth
  if (req.path === "/health") { next(); return; }

  const provided = req.cookies?.bs_session as string | undefined;
  if (!provided || !verifySession(provided, requiredKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.use("/api/scans", scansRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/dashboards", dashboardsRouter);
app.use("/api/scanner-dashboards", scannerDashboardsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/paper-trading", paperTradingRouter);
app.use("/api/broker-connections", brokerConnectionsRouter);

app.get("/api/health", (_req, res) => {
  const meta = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("db_version") as { value: string } | undefined;
  res.json({ status: "ok", db_version: meta?.value ?? "unknown" });
});

app.get("/api/market/status", (_req, res) => {
  function getDbSizeMb(name: string): number {
    try {
      const s = statSync(path.join(config.dbDir, name));
      return Math.round(s.size / 1024 / 1024 * 10) / 10;
    } catch {
      return 0;
    }
  }

  res.json({
    environment: config.envLabel,
    databases: {
      app_db_mb: getDbSizeMb("app.db"),
      market_db_mb: getDbSizeMb("market.db"),
      live_db_mb: getDbSizeMb("live.db"),
    },
    angel_connected: false, // will be updated when Angel API is integrated
    last_sync: null,        // will be populated from sync_log once Angel is running
  });
});

// Serve built frontend in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "../../artifacts/bharatscan/dist/public");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "API route not found" });
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`BharatScan server running on http://localhost:${port}`);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[SERVER ERROR]", new Date().toISOString(), err.message);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }
  if (res.headersSent) return;
  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : err.message || "Internal server error";
  res.status(500).json({ error: message });
});
