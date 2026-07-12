import { Router, type Request, type Response } from "express";
import { appDb, marketDb } from "../db.js";
import { getHistoricalBars, getLiveQuotes, getQuoteCacheStats, resetQuoteCacheStats } from "../services/marketDataService.js";
import { getOptionExpiriesFromBroker, loadOptionsFromBroker } from "../services/optionsDataService.js";
import {
  subscribeSymbols,
  unsubscribeSymbols,
  getSubscribedSymbols,
  getProtectedSymbols,
  autoSubscribeFoSymbols,
} from "../services/liveFeedService.js";
import { getSchedulerStatus } from "../services/scheduler.js";
import { runEodSyncJob, runIntradaySyncJob, todayIST } from "../services/syncJobs.js";
import { runOptionsSyncJob } from "../services/optionsDataService.js";
import { runPeriodicCatchUpCheck, runStartupCatchUp, getCatchUpStatus } from "../services/catchUpScheduler.js";
import { isTradingDay } from "../services/tradingCalendar.js";
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

// ── Options data load routes ──────────────────────────────────────────────────

/**
 * GET /options/expiries?underlying=NIFTY
 * Returns available expiry dates from the connected broker for the given underlying.
 */
router.get("/options/expiries", async (req: Request, res: Response) => {
  const { underlying } = req.query as Record<string, string | undefined>;
  if (!underlying || typeof underlying !== "string" || !underlying.trim()) {
    res.status(400).json({ error: "underlying is required" });
    return;
  }
  if (!hasConnectedBroker()) {
    res.status(503).json({ error: "No broker connected" });
    return;
  }
  try {
    const expiries = await getOptionExpiriesFromBroker(underlying.trim().toUpperCase());
    res.json({ underlying: underlying.trim().toUpperCase(), expiries });
  } catch (err) {
    if (handleBrokerError(err, res, "/options/expiries")) return;
    console.error("[marketData] /options/expiries error:", err instanceof Error ? err.message : err);
    res.status(503).json({ error: err instanceof Error ? err.message : "Failed to fetch expiries" });
  }
});

/**
 * POST /options/load
 * Body: { underlying, expiry, from, to }
 * Streams SSE progress: data: {"type":"start"|"progress"|"done", ...}
 *
 * Fetches 1-min intraday candles for ATM ± N strikes (CE + PE) and
 * upserts them into options_intraday. Respects daily request budget.
 */
router.post("/options/load", async (req: Request, res: Response) => {
  const { underlying, expiry, from, to } = req.body as {
    underlying?: string;
    expiry?: string;
    from?: string;
    to?: string;
  };

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  if (!underlying || typeof underlying !== "string" || !underlying.trim()) {
    res.status(400).json({ error: "underlying is required" });
    return;
  }
  if (!expiry || !DATE_RE.test(expiry)) {
    res.status(400).json({ error: "expiry must be a YYYY-MM-DD date" });
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

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await loadOptionsFromBroker(
      { underlying: underlying.trim().toUpperCase(), expiry, from, to },
      (progress) => {
        send({
          type: "progress",
          loaded: progress.loaded,
          total: progress.total,
          current: progress.current,
          failed: progress.failed,
        });
      }
    );
    send({
      type: "done",
      loaded: result.loaded,
      skippedBudget: result.skippedBudget,
      failed: result.failed,
    });
  } catch (err) {
    console.error("[marketData] /options/load error:", err instanceof Error ? err.message : err);
    send({
      type: "error",
      error: err instanceof Error ? err.message : "Failed to load options data",
    });
  }

  res.end();
});

/**
 * GET /scanner/universe-data?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Read-only endpoint that queries ohlcv_daily directly — NO broker calls, NO
 * budget consumption, no interaction with marketDataService whatsoever.
 * Returns every symbol that has at least one row in the requested date range,
 * shaped as SymbolHistory[] so the Scanner can call setHistories() directly.
 *
 * prevClose is computed server-side with a LAG window function using a 10-day
 * lookback buffer (covers weekends + public holidays) so the first bar in the
 * range has correct prevClose even when no prior bar exists in the range.
 *
 * Symbols stored in ohlcv_daily use Fyers format ("NSE:SBIN-EQ"); we strip
 * the exchange prefix and instrument suffix to return the plain ticker ("SBIN")
 * that matches what CSV loads and broker loads put in SymbolHistory.symbol.
 */
router.get("/scanner/universe-data", (req: Request, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  })();

  const rawFrom = req.query.from;
  const rawTo   = req.query.to;
  const from = (typeof rawFrom === "string" && DATE_RE.test(rawFrom)) ? rawFrom : twoYearsAgo;
  const to   = (typeof rawTo   === "string" && DATE_RE.test(rawTo))   ? rawTo   : today;

  if (from > to) {
    res.status(400).json({ error: "from must not be after to" });
    return;
  }

  try {
    // CTE + LAG: the 10-day buffer before `from` ensures the first in-range bar
    // for every symbol gets a correct prevClose from the nearest prior trading day.
    interface RawRow {
      symbol:     string;
      date:       string;
      open:       number;
      high:       number;
      low:        number;
      close:      number;
      volume:     number;
      prev_close: number;
    }

    const rows = marketDb.prepare(`
      WITH context AS (
        SELECT symbol, date, open, high, low, close, volume,
               LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close
          FROM ohlcv_daily
         WHERE date BETWEEN date(?, '-10 days') AND ?
      )
      SELECT symbol, date, open, high, low, close, volume,
             COALESCE(prev_close, 0.0) AS prev_close
        FROM context
       WHERE date >= ?
       ORDER BY symbol, date
    `).all(from, to, from) as unknown as RawRow[];

    if (rows.length === 0) {
      res.json({ symbols: 0, bars: 0, data: [] });
      return;
    }

    // Strip Fyers exchange/instrument wrapping: "NSE:SBIN-EQ" → symbol="SBIN", series="EQ"
    // "NSE:NIFTY50-INDEX" → symbol="NIFTY50", series="INDEX"
    // "BSE:SENSEX-INDEX"  → symbol="SENSEX",  series="INDEX"
    // Anything that doesn't match the pattern is kept as-is with series="EQ".
    function stripFyers(raw: string): { symbol: string; series: string } {
      const colonIdx = raw.indexOf(":");
      const base = colonIdx >= 0 ? raw.slice(colonIdx + 1) : raw;
      const dashIdx = base.lastIndexOf("-");
      if (dashIdx > 0) {
        return { symbol: base.slice(0, dashIdx), series: base.slice(dashIdx + 1) };
      }
      return { symbol: base, series: "EQ" };
    }

    interface HistEntry { series: string; bars: Bar[] }
    interface Bar {
      date: string; open: number; high: number; low: number; close: number;
      prevClose: number; volume: number; trades: number; value: number;
    }

    const bySymbol = new Map<string, HistEntry>();

    for (const row of rows) {
      const { symbol, series } = stripFyers(row.symbol);
      if (!bySymbol.has(symbol)) {
        bySymbol.set(symbol, { series, bars: [] });
      }
      bySymbol.get(symbol)!.bars.push({
        date:      row.date,
        open:      row.open,
        high:      row.high,
        low:       row.low,
        close:     row.close,
        prevClose: row.prev_close,
        volume:    row.volume ?? 0,
        trades:    0,
        value:     0,
      });
    }

    const data = Array.from(bySymbol.entries()).map(([symbol, { series, bars }]) => ({
      symbol,
      series,
      bars,
    }));

    console.log(
      "[marketData] /scanner/universe-data — %d symbols, %d bars (%s → %s)",
      data.length, rows.length, from, to
    );

    res.json({ symbols: data.length, bars: rows.length, data });
  } catch (err) {
    console.error(
      "[marketData] /scanner/universe-data error:",
      err instanceof Error ? err.message : err
    );
    res.status(500).json({ error: "Failed to query local ohlcv_daily table" });
  }
});

router.get("/scheduler-status", (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});

/**
 * Read-only view of the live feed's subscription state, in particular which
 * symbols are currently "protected" (auto-subscribed F&O) vs. ad-hoc.
 */
router.get("/live/subscriptions", (_req: Request, res: Response) => {
  const subscribed = getSubscribedSymbols();
  const protectedSymbols = getProtectedSymbols();
  const protectedSet = new Set(protectedSymbols);
  res.json({
    totalSubscribed: subscribed.length,
    protectedCount: protectedSymbols.length,
    adHocCount: subscribed.length - protectedSet.size,
    protectedSymbols,
    adHocSymbols: subscribed.filter((s) => !protectedSet.has(s)),
  });
});

/**
 * TEMPORARY test route — manually runs the same F&O auto-subscribe logic the
 * liveOpen cron job triggers, for verifying behavior outside market hours.
 * Safe to remove once the liveOpen job itself has been verified live.
 */
router.post("/live/auto-subscribe-fo/test", (_req: Request, res: Response) => {
  try {
    const result = autoSubscribeFoSymbols();
    res.json(result);
  } catch (err) {
    console.error("[marketData] /live/auto-subscribe-fo/test error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to run F&O auto-subscribe" });
  }
});

/**
 * TEMPORARY test routes — manually run the nightly EOD / intraday sync jobs
 * the scheduler triggers at 4pm / 4:30pm IST, for verifying behavior outside
 * that window. Safe to remove once both jobs have been verified live.
 */
router.post("/sync/eod/test", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIST();
  if (!isTradingDay(date)) {
    res.status(409).json({ error: `${date} is not a trading day, nothing to sync` });
    return;
  }
  try {
    const result = await runEodSyncJob(date);
    res.json(result);
  } catch (err) {
    console.error("[marketData] /sync/eod/test error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: err instanceof Error ? err.message : "EOD sync failed" });
  }
});

router.post("/sync/intraday/test", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIST();
  if (!isTradingDay(date)) {
    res.status(409).json({ error: `${date} is not a trading day, nothing to sync` });
    return;
  }
  try {
    const result = await runIntradaySyncJob(date);
    res.json(result);
  } catch (err) {
    console.error("[marketData] /sync/intraday/test error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Intraday sync failed" });
  }
});

router.post("/sync/options/test", async (_req: Request, res: Response) => {
  try {
    const result = await runOptionsSyncJob();
    res.json(result);
  } catch (err) {
    console.error("[marketData] /sync/options/test error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Options sync failed" });
  }
});

/**
 * TEMPORARY test routes for the catch-up/retry orchestrator — trigger either
 * pass on demand instead of waiting for a restart or the 30-minute timer.
 * Safe to remove once both triggers have been verified live.
 */
router.post("/sync/catch-up/check-now", async (_req: Request, res: Response) => {
  try {
    await runPeriodicCatchUpCheck();
    res.json(getCatchUpStatus());
  } catch (err) {
    console.error("[marketData] /sync/catch-up/check-now error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Periodic catch-up check failed" });
  }
});

router.post("/sync/catch-up/run-now", async (_req: Request, res: Response) => {
  try {
    await runStartupCatchUp();
    res.json(getCatchUpStatus());
  } catch (err) {
    console.error("[marketData] /sync/catch-up/run-now error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Startup catch-up failed" });
  }
});

router.get("/quotes/status", (_req: Request, res: Response) => {
  res.json(getQuoteCacheStats());
});

router.post("/quotes/status/reset", (_req: Request, res: Response) => {
  resetQuoteCacheStats();
  res.json(getQuoteCacheStats());
});

export default router;
