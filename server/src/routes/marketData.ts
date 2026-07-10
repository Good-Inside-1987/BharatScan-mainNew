import { Router, type Request, type Response } from "express";
import { appDb } from "../db.js";
import { getHistoricalBars, getLiveQuotes, getQuoteCacheStats } from "../services/marketDataService.js";
import { subscribeSymbols, unsubscribeSymbols } from "../services/liveFeedService.js";
import { getSchedulerStatus } from "../services/scheduler.js";
import {
  AuthenticationError,
  SessionExpiredError,
  RateLimitError,
  BrokerUnavailableError,
} from "../errors/brokerErrors.js";

/**
 * REST surface for market data. Every handler below calls ONLY
 * marketDataService / liveFeedService — never a broker adapter directly.
 * Adapters must stay reachable exclusively through those two services.
 */

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function hasConnectedBroker(): boolean {
  const row = appDb
    .prepare("SELECT 1 FROM broker_connections WHERE status = 'connected' LIMIT 1")
    .get();
  return !!row;
}

/**
 * Map typed broker errors to distinct HTTP status codes.
 * Returns true when it handled the response so the caller can return early.
 */
function handleBrokerError(err: unknown, res: Response, context: string): boolean {
  if (err instanceof SessionExpiredError) {
    console.warn("[marketData] %s — session expired: %s", context, err.message);
    res.status(401).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof AuthenticationError) {
    console.warn("[marketData] %s — not authenticated: %s", context, err.message);
    res.status(401).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof RateLimitError) {
    console.warn("[marketData] %s — rate limited: %s", context, err.message);
    res.status(429).json({
      error: err.message,
      code: err.code,
      retryAfterMs: err.retryAfterMs,
    });
    return true;
  }
  if (err instanceof BrokerUnavailableError) {
    console.warn("[marketData] %s — broker unavailable: %s", context, err.message);
    res.status(503).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

router.get("/history", async (req: Request, res: Response) => {
  const { symbol, resolution, from, to } = req.query as Record<string, string | undefined>;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  if (!resolution || typeof resolution !== "string") {
    res.status(400).json({ error: "resolution is required" });
    return;
  }
  if (!from || !DATE_RE.test(from)) {
    res.status(400).json({ error: "from must be a YYYY-MM-DD date" });
    return;
  }
  if (!to || !DATE_RE.test(to)) {
    res.status(400).json({ error: "to must be a YYYY-MM-DD date" });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: "from must not be after to" });
    return;
  }

  if (!hasConnectedBroker()) {
    res.status(503).json({ error: "No broker connected" });
    return;
  }

  try {
    const bars = await getHistoricalBars(symbol, resolution, from, to);
    res.json({ symbol, resolution, bars });
  } catch (err) {
    if (handleBrokerError(err, res, "/history")) return;
    console.error("[marketData] /history error: %s", err instanceof Error ? err.message : String(err));
    res.status(503).json({ error: "Failed to fetch historical data" });
  }
});

router.get("/quotes", async (req: Request, res: Response) => {
  const { symbols } = req.query as Record<string, string | undefined>;

  if (!symbols || typeof symbols !== "string" || symbols.trim().length === 0) {
    res.status(400).json({ error: "symbols is required (comma-separated)" });
    return;
  }

  const symbolList = symbols
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbolList.length === 0) {
    res.status(400).json({ error: "symbols is required (comma-separated)" });
    return;
  }

  if (!hasConnectedBroker()) {
    res.status(503).json({ error: "No broker connected" });
    return;
  }

  try {
    const quotes = await getLiveQuotes(symbolList);
    res.json({ quotes });
  } catch (err) {
    if (handleBrokerError(err, res, "/quotes")) return;
    console.error("[marketData] /quotes error: %s", err instanceof Error ? err.message : String(err));
    res.status(503).json({ error: "Failed to fetch quotes" });
  }
});

function parseSymbolsBody(req: Request, res: Response): string[] | null {
  const { symbols } = req.body as { symbols?: unknown };

  if (!Array.isArray(symbols) || symbols.length === 0) {
    res.status(400).json({ error: "symbols must be a non-empty array of strings" });
    return null;
  }
  if (!symbols.every((s) => typeof s === "string" && s.trim().length > 0)) {
    res.status(400).json({ error: "symbols must be a non-empty array of strings" });
    return null;
  }
  return symbols as string[];
}

router.post("/subscribe", (req: Request, res: Response) => {
  const symbols = parseSymbolsBody(req, res);
  if (!symbols) return;

  if (!hasConnectedBroker()) {
    res.status(503).json({ error: "No broker connected" });
    return;
  }

  try {
    subscribeSymbols(symbols);
    res.json({ ok: true, symbols });
  } catch (err) {
    console.error("[marketData] /subscribe error: %s", err instanceof Error ? err.message : String(err));
    res.status(503).json({ error: "Failed to subscribe" });
  }
});

router.post("/unsubscribe", (req: Request, res: Response) => {
  const symbols = parseSymbolsBody(req, res);
  if (!symbols) return;

  if (!hasConnectedBroker()) {
    res.status(503).json({ error: "No broker connected" });
    return;
  }

  try {
    unsubscribeSymbols(symbols);
    res.json({ ok: true, symbols });
  } catch (err) {
    console.error("[marketData] /unsubscribe error: %s", err instanceof Error ? err.message : String(err));
    res.status(503).json({ error: "Failed to unsubscribe" });
  }
});

router.get("/scheduler-status", (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});

router.get("/quotes/status", (_req: Request, res: Response) => {
  res.json(getQuoteCacheStats());
});

export default router;
