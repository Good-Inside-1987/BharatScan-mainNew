import { Router, type Request, type Response } from "express";
import { appDb } from "../db.js";
import { getHistoricalBars, getLiveQuotes } from "../services/marketDataService.js";
import { subscribeSymbols, unsubscribeSymbols } from "../services/liveFeedService.js";

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

export default router;
