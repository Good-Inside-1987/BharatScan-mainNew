import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { encrypt, decrypt } from "../lib/encryption.js";

const router = Router();

// ── Connect rate limiter ───────────────────────────────────────────────────────

const connectAttempts = new Map<string,
  { count: number; resetAt: number }>();

function checkConnectLimit(ip: string): boolean {
  const now = Date.now();
  const entry = connectAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    connectAttempts.set(ip,
      { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface BrokerRow {
  id: string;
  broker_name: string;
  display_name: string;
  api_key: string;
  client_code: string;
  pin: string;
  access_token: string | null;
  token_generated_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Return public-safe fields only — never expose encrypted values. */
function publicRow(row: BrokerRow) {
  return {
    id: row.id,
    broker_name: row.broker_name,
    display_name: row.display_name,
    status: row.status,
    token_generated_at: row.token_generated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const allRows = () =>
  db
    .prepare("SELECT * FROM broker_connections ORDER BY created_at DESC")
    .all() as unknown as BrokerRow[];

const oneRow = (id: string) =>
  db
    .prepare("SELECT * FROM broker_connections WHERE id = ?")
    .get(id) as unknown as BrokerRow | undefined;

// ── GET /api/broker-connections ────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  res.json(allRows().map(publicRow));
});

// ── POST /api/broker-connections ───────────────────────────────────────────────

router.post("/", (req: Request, res: Response) => {
  const { broker_name, display_name, api_key, client_code, pin } = req.body as {
    broker_name?: string;
    display_name?: string;
    api_key?: string;
    client_code?: string;
    pin?: string;
  };

  if (!broker_name || !display_name || !api_key || !client_code || !pin) {
    res.status(400).json({ error: "broker_name, display_name, api_key, client_code and pin are required" });
    return;
  }

  const ALLOWED_BROKERS = [
    "angel_one", "fyers", "upstox", "shoonya", "dhan", "zerodha"
  ];
  if (!ALLOWED_BROKERS.includes(broker_name)) {
    res.status(400).json({
      error: `Unsupported broker. Allowed values: ${ALLOWED_BROKERS.join(", ")}`
    });
    return;
  }

  let encKey: string, encCode: string, encPin: string;
  try {
    encKey  = encrypt(api_key);
    encCode = encrypt(client_code);
    encPin  = encrypt(pin);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Encryption failed";
    res.status(500).json({ error: msg });
    return;
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO broker_connections
      (id, broker_name, display_name, api_key, client_code, pin, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?, ?)
  `).run(id, broker_name, display_name, encKey, encCode, encPin, now, now);

  res.status(201).json(publicRow(oneRow(id)!));
});

// ── PUT /api/broker-connections/:id ───────────────────────────────────────────

router.put("/:id", (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const { display_name, api_key, client_code, pin } = req.body as {
    display_name?: string;
    api_key?: string;
    client_code?: string;
    pin?: string;
  };

  const now = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE broker_connections SET
        display_name = ?,
        api_key      = ?,
        client_code  = ?,
        pin          = ?,
        updated_at   = ?
      WHERE id = ?
    `).run(
      display_name  ?? row.display_name,
      api_key       ? encrypt(api_key)      : row.api_key,
      client_code   ? encrypt(client_code)  : row.client_code,
      pin           ? encrypt(pin)          : row.pin,
      now,
      row.id,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Encryption failed";
    res.status(500).json({ error: msg });
    return;
  }

  res.json(publicRow(oneRow(row.id)!));
});

// ── DELETE /api/broker-connections/:id ────────────────────────────────────────

router.delete("/:id", (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  db.prepare("DELETE FROM broker_connections WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// ── GET /api/broker-connections/:id/status ────────────────────────────────────

router.get("/:id/status", (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let sessionValidUntil: string | null = null;
  if (row.token_generated_at) {
    const d = new Date(row.token_generated_at);
    d.setHours(d.getHours() + 24);
    sessionValidUntil = d.toISOString();
    // Auto-expire if the stored status is still 'connected' but token is stale
    if (row.status === "connected" && new Date() > d) {
      const now = new Date().toISOString();
      db.prepare("UPDATE broker_connections SET status = 'expired', updated_at = ? WHERE id = ?")
        .run(now, row.id);
      row.status = "expired";
    }
  }

  res.json({
    id: row.id,
    status: row.status,
    token_generated_at: row.token_generated_at,
    session_valid_until: sessionValidUntil,
  });
});

// ── GET /api/broker-connections/:id/auth-url (Fyers only) ────────────────────

router.get("/:id/auth-url", (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.broker_name !== "fyers") {
    res.status(400).json({ error: "auth-url is only available for Fyers connections" });
    return;
  }

  let appId: string, redirectUri: string;
  try {
    appId       = decrypt(row.api_key);   // api_key stores App ID for Fyers
    redirectUri = decrypt(row.pin);       // pin stores Redirect URI for Fyers
  } catch {
    res.status(500).json({ error: "Failed to decrypt credentials" });
    return;
  }

  const url =
    `https://api-t1.fyers.in/api/v3/generate-authcode` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=bharatscan`;

  res.json({ url });
});

// ── POST /api/broker-connections/:id/connect ──────────────────────────────────

router.post("/:id/connect", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!checkConnectLimit(ip)) {
    res.status(429).json({
      error: "Too many connection attempts. Try again in 15 minutes."
    });
    return;
  }

  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const { totp_code } = req.body as { totp_code?: string };
  if (!totp_code || !/^\d{6}$/.test(totp_code.trim())) {
    res.status(400).json({ error: "totp_code must be exactly 6 digits" });
    return;
  }

  // Decrypt stored credentials
  let apiKey: string, clientCode: string, pin: string;
  try {
    apiKey     = decrypt(row.api_key);
    clientCode = decrypt(row.client_code);
    pin        = decrypt(row.pin);
  } catch (err) {
    res.status(500).json({ error: "Failed to decrypt credentials" });
    return;
  }

  let accessToken: string;

  // ── Angel One SmartAPI ────────────────────────────────────────────────────
  if (row.broker_name === "angel_one") {
    try {
      const response = await fetch(
        "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": req.ip ?? "127.0.0.1",
            "X-ClientPublicIP": req.ip ?? "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": apiKey,
          },
          body: JSON.stringify({
            clientcode: clientCode,
            password: pin,
            totp: totp_code.trim(),
          }),
        }
      );

      const data = (await response.json()) as { status: boolean; message: string; data?: { jwtToken?: string } };

      if (!data.status || !data.data?.jwtToken) {
        res.status(401).json({ error: data.message ?? "Angel One login failed" });
        return;
      }

      accessToken = data.data.jwtToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error contacting Angel One";
      res.status(502).json({ error: msg });
      return;
    }

  // ── Fyers v3 ──────────────────────────────────────────────────────────────
  } else if (row.broker_name === "fyers") {
    // apiKey = App ID, clientCode = Secret Key, pin = Redirect URI (unused here)
    const appIdHash = createHash("sha256")
      .update(`${apiKey}:${clientCode}`)
      .digest("hex");

    try {
      const response = await fetch(
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            appIdHash,
            code: totp_code.trim(),
          }),
        }
      );

      const data = (await response.json()) as { s: string; message?: string; access_token?: string };

      if (data.s !== "ok" || !data.access_token) {
        res.status(401).json({ error: data.message ?? "Fyers authentication failed" });
        return;
      }

      accessToken = data.access_token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error contacting Fyers";
      res.status(502).json({ error: msg });
      return;
    }

  } else {
    res.status(400).json({ error: `Unsupported broker: ${row.broker_name}` });
    return;
  }

  // Store encrypted access token
  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE broker_connections SET
        access_token       = ?,
        token_generated_at = ?,
        status             = 'connected',
        updated_at         = ?
      WHERE id = ?
    `).run(encrypt(accessToken), now, now, row.id);
  } catch (err) {
    res.status(500).json({ error: "Failed to store access token" });
    return;
  }

  res.json({ ok: true, token_generated_at: now });
});

// ── POST /api/broker-connections/:id/disconnect ───────────────────────────────

router.post("/:id/disconnect", (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE broker_connections SET
      access_token       = NULL,
      token_generated_at = NULL,
      status             = 'disconnected',
      updated_at         = ?
    WHERE id = ?
  `).run(now, row.id);

  res.json({ ok: true });
});

export default router;
