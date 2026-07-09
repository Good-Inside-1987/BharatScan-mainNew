/**
 * liveFeedService.ts
 *
 * WebSocket-based live tick streaming from Fyers' Data WebSocket
 * (wss://api.fyers.in/socket/v2/data/). This is intentionally separate
 * from marketDataService.ts, which owns historical-bar backfill and the
 * REST-based getQuotes() fallback — this file must never be used to
 * implement polling loops against the REST quotes endpoint.
 *
 * Responsibilities
 * ─────────────────
 * 1. Maintain a single WebSocket connection to the Fyers data feed, opened
 *    once a Fyers session (appId + accessToken) is available.
 * 2. SubscriptionManager — tracks the currently-subscribed symbol set,
 *    enforcing Fyers' hard cap of 200 symbols across all instrument types.
 *    Adding symbols beyond the cap unsubscribes the least-recently-added
 *    ("oldest") symbols first (simple FIFO rotation).
 * 3. Quote cache — every incoming tick updates an in-memory
 *    Map<symbol, Quote>. No per-tick database writes.
 * 4. getLiveQuote()/getLiveQuotes() — read-only accessors over the cache.
 * 5. Reconnect with exponential backoff on any disconnect/error; a feed
 *    failure must never crash the server process.
 *
 * NOTE on the Fyers wire protocol: Fyers' official client libraries speak
 * a specific binary/JSON hybrid protocol that changes between SDK versions.
 * This implementation targets the documented JSON subscribe/unsubscribe
 * envelope and the common `{ symbol, ltp, ... }` tick shape. If Fyers
 * changes their message format, only `buildSubscribeMessage`,
 * `buildUnsubscribeMessage`, and `parseTickMessage` need to change — the
 * subscription manager, cache, and reconnect logic are protocol-agnostic.
 */

import WebSocket from "ws";
import { appDb } from "../db.js";
import { decrypt } from "../lib/encryption.js";
import type { Quote } from "../adapters/types.js";

const FYERS_DATA_WS_URL = "wss://api.fyers.in/socket/v2/data/";
const MAX_SUBSCRIBED_SYMBOLS = 200;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60_000;

// ── Session lookup ──────────────────────────────────────────────────────────

interface BrokerConnectionRow {
  id: string;
  broker_name: string;
  api_key: string;
  access_token: string | null;
  token_generated_at: string | null;
  status: string;
}

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * Reads the most-recently-connected Fyers session directly from
 * broker_connections and decrypts it. Kept independent of
 * marketDataService's adapter cache since the live feed needs the raw
 * appId/accessToken pair to build the WS auth token, not a BrokerAdapter
 * instance.
 */
function getFyersSession(): { appId: string; accessToken: string } | null {
  const row = appDb
    .prepare(
      `SELECT id, broker_name, api_key, access_token, token_generated_at, status
         FROM broker_connections
        WHERE broker_name = 'fyers' AND status = 'connected'
        ORDER BY token_generated_at DESC
        LIMIT 1`
    )
    .get() as unknown as BrokerConnectionRow | undefined;

  if (!row?.access_token || !row.token_generated_at) return null;

  const tokenAge = Date.now() - new Date(row.token_generated_at).getTime();
  if (tokenAge > TOKEN_TTL_MS) return null;

  try {
    return {
      appId: decrypt(row.api_key),
      accessToken: decrypt(row.access_token),
    };
  } catch (err) {
    console.warn(
      "[liveFeedService] Could not decrypt stored Fyers session: %s",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Quote cache ──────────────────────────────────────────────────────────────

const quoteCache = new Map<string, Quote>();

export function getLiveQuote(symbol: string): Quote | undefined {
  return quoteCache.get(symbol);
}

export function getLiveQuotes(symbols: string[]): Quote[] {
  const results: Quote[] = [];
  for (const symbol of symbols) {
    const quote = quoteCache.get(symbol);
    if (quote) results.push(quote);
  }
  return results;
}

// ── Subscription manager ────────────────────────────────────────────────────
//
// `order` tracks insertion order for FIFO rotation: index 0 is the
// least-recently-added (and therefore first to be evicted) symbol.
// `subscribed` mirrors the same set for O(1) membership checks.

class SubscriptionManager {
  private order: string[] = [];
  private subscribed = new Set<string>();

  get size(): number {
    return this.subscribed.size;
  }

  has(symbol: string): boolean {
    return this.subscribed.has(symbol);
  }

  list(): string[] {
    return [...this.order];
  }

  /**
   * Adds symbols to the subscribed set, evicting the oldest symbols first
   * (FIFO) if the addition would exceed MAX_SUBSCRIBED_SYMBOLS. Returns the
   * symbols actually added and the symbols evicted as a side effect, so the
   * caller can send the corresponding SUB/UNSUB frames.
   */
  add(symbols: string[]): { added: string[]; evicted: string[] } {
    const toAdd = symbols.filter((s) => !this.subscribed.has(s));
    // De-dupe while preserving order, in case the caller passed duplicates.
    const uniqueToAdd = [...new Set(toAdd)];

    const evicted: string[] = [];
    const projectedSize = this.subscribed.size + uniqueToAdd.length;
    const overflow = projectedSize - MAX_SUBSCRIBED_SYMBOLS;
    if (overflow > 0) {
      // Evict the oldest currently-subscribed symbols to make room.
      // Never evict a symbol we're about to add in the same call.
      for (let i = 0; i < this.order.length && evicted.length < overflow; i++) {
        const candidate = this.order[i];
        if (!uniqueToAdd.includes(candidate)) evicted.push(candidate);
      }
      for (const symbol of evicted) this.remove(symbol);
    }

    // If a single add() call itself exceeds the cap (e.g. 250 brand-new
    // symbols at once), only keep the most recent MAX_SUBSCRIBED_SYMBOLS —
    // still simple FIFO, just applied within the same batch.
    const capped =
      uniqueToAdd.length > MAX_SUBSCRIBED_SYMBOLS
        ? uniqueToAdd.slice(uniqueToAdd.length - MAX_SUBSCRIBED_SYMBOLS)
        : uniqueToAdd;

    for (const symbol of capped) {
      this.subscribed.add(symbol);
      this.order.push(symbol);
    }

    return { added: capped, evicted };
  }

  remove(symbols: string[] | string): void {
    const list = Array.isArray(symbols) ? symbols : [symbols];
    for (const symbol of list) {
      if (!this.subscribed.delete(symbol)) continue;
      const idx = this.order.indexOf(symbol);
      if (idx !== -1) this.order.splice(idx, 1);
      quoteCache.delete(symbol);
    }
  }

  clear(): void {
    this.order = [];
    this.subscribed.clear();
  }
}

const subscriptions = new SubscriptionManager();

// ── WebSocket connection lifecycle ──────────────────────────────────────────

let ws: WebSocket | null = null;
let connecting = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionallyClosed = false;

function buildSubscribeMessage(symbols: string[]): string {
  return JSON.stringify({ T: "SUB_L1", L1: 1, SLIST: symbols });
}

function buildUnsubscribeMessage(symbols: string[]): string {
  return JSON.stringify({ T: "UNSUB_L1", L1: 1, SLIST: symbols });
}

/**
 * Normalizes a single tick payload from Fyers into our internal Quote
 * shape. Returns null for messages that aren't tick data (e.g. ack/heartbeat
 * frames) so callers can skip them silently.
 */
function parseTickMessage(raw: unknown): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;

  // Fyers tick frames carry the symbol under `symbol` or `n`, and LTP under
  // `ltp` or `lp` depending on feed mode. Accept either.
  const symbol = (msg.symbol ?? msg.n) as string | undefined;
  const ltp = (msg.ltp ?? msg.lp) as number | undefined;
  if (!symbol || typeof ltp !== "number") return null;

  const open = (msg.open_price ?? msg.open ?? msg.o) as number | undefined;
  const high = (msg.high_price ?? msg.high ?? msg.h) as number | undefined;
  const low = (msg.low_price ?? msg.low ?? msg.l) as number | undefined;
  const close = (msg.prev_close_price ?? msg.close ?? msg.c) as number | undefined;
  const volume = (msg.volume ?? msg.vol_traded_today ?? msg.v) as number | undefined;
  const tt = (msg.tt ?? msg.last_traded_time) as number | undefined;

  return {
    symbol,
    ltp,
    open: open ?? 0,
    high: high ?? 0,
    low: low ?? 0,
    close: close ?? 0,
    volume: volume ?? 0,
    timestamp: tt ? new Date(tt * 1000).toISOString() : new Date().toISOString(),
  };
}

function handleMessage(data: WebSocket.RawData): void {
  let parsed: unknown;
  try {
    const text = typeof data === "string" ? data : data.toString("utf8");
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON frames (e.g. binary heartbeats) are ignored — never crash the
    // feed over a message we don't understand.
    return;
  }

  const quote = parseTickMessage(parsed);
  if (quote) quoteCache.set(quote.symbol, quote);
}

function scheduleReconnect(): void {
  if (intentionallyClosed || reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
    RECONNECT_MAX_DELAY_MS
  );
  reconnectAttempt++;
  console.warn(`[liveFeedService] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => {
      console.warn(
        "[liveFeedService] Reconnect attempt failed: %s",
        err instanceof Error ? err.message : String(err)
      );
    });
  }, delay);
}

/**
 * Opens the WebSocket connection if a Fyers session is available and no
 * connection/attempt is already in flight. Safe to call repeatedly (e.g.
 * from a periodic check) — it's a no-op when already connected/connecting.
 * Never throws; failures are logged and trigger a backoff retry instead.
 */
export async function connect(): Promise<void> {
  if (
    connecting ||
    (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
  ) {
    return;
  }

  const session = getFyersSession();
  if (!session) {
    // No active session yet — try again later rather than failing hard.
    scheduleReconnect();
    return;
  }

  connecting = true;
  intentionallyClosed = false;

  try {
    const authToken = `${session.appId}:${session.accessToken}`;
    const url = `${FYERS_DATA_WS_URL}?type=symbolData&access_token=${encodeURIComponent(authToken)}`;
    const socket = new WebSocket(url);

    socket.on("open", () => {
      if (ws !== socket) return; // stale socket superseded by a newer attempt
      connecting = false;
      reconnectAttempt = 0;
      console.log("[liveFeedService] Connected to Fyers data feed");
      // Re-subscribe to everything we were tracking (e.g. after a reconnect).
      const symbols = subscriptions.list();
      if (symbols.length > 0) socket.send(buildSubscribeMessage(symbols));
    });

    socket.on("message", (data) => {
      if (ws !== socket) return; // ignore stray messages from a superseded socket
      handleMessage(data);
    });

    socket.on("error", (err) => {
      if (ws !== socket) return;
      console.warn("[liveFeedService] Feed error: %s", err instanceof Error ? err.message : String(err));
      // "close" will also fire and drive the reconnect; avoid double-scheduling here.
    });

    socket.on("close", () => {
      if (ws !== socket) return; // a newer socket has already replaced this one
      connecting = false;
      ws = null;
      console.warn("[liveFeedService] Feed connection closed");
      scheduleReconnect();
    });

    ws = socket;
  } catch (err) {
    connecting = false;
    console.warn(
      "[liveFeedService] Failed to open feed connection: %s",
      err instanceof Error ? err.message : String(err)
    );
    scheduleReconnect();
  }
}

/** Closes the connection and stops any pending reconnect attempts. */
export function disconnect(): void {
  intentionallyClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
}

function sendIfOpen(message: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
  // If not open yet, the next successful `open` handler re-subscribes from
  // subscriptions.list(), so pending adds are not lost.
}

// ── Public subscription API ─────────────────────────────────────────────────

/**
 * Subscribes to the given symbols, enforcing the 200-symbol cap via FIFO
 * eviction of the oldest subscriptions. Triggers a connection attempt if
 * one isn't already established. Symbols already subscribed are no-ops.
 */
export function subscribeSymbols(symbols: string[]): void {
  if (symbols.length === 0) return;

  const { added, evicted } = subscriptions.add(symbols);

  if (evicted.length > 0) {
    console.log(`[liveFeedService] Evicting ${evicted.length} oldest symbol(s) to stay under the 200 cap`);
    sendIfOpen(buildUnsubscribeMessage(evicted));
  }
  if (added.length > 0) {
    sendIfOpen(buildSubscribeMessage(added));
  }

  void connect();
}

/** Unsubscribes the given symbols and drops their cached quotes. */
export function unsubscribeSymbols(symbols: string[]): void {
  if (symbols.length === 0) return;
  const stillTracked = symbols.filter((s) => subscriptions.has(s));
  if (stillTracked.length === 0) return;

  subscriptions.remove(stillTracked);
  sendIfOpen(buildUnsubscribeMessage(stillTracked));
}

/** Current subscribed symbols, for diagnostics/tests. */
export function getSubscribedSymbols(): string[] {
  return subscriptions.list();
}
