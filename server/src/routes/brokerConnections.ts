import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { encrypt, decrypt } from "../lib/encryption.js";

const router = Router();

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

// ── POST /api/broker-connections/:id/connect ──────────────────────────────────

router.post("/:id/connect", async (req: Request, res: Response) => {
  const row = oneRow(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const { totp_code } = req.body as { totp_code?: string };
  if (!totp_code || totp_code.trim().length === 0) {
    res.status(400).json({ error: "totp_code is required" });
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

  // Call Angel One SmartAPI
  let accessToken: string;
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
          "X-ClientLocalIP": "CLIENT_LOCAL_IP",
          "X-ClientPublicIP": "CLIENT_PUBLIC_IP",
          "X-MACAddress": "MAC_ADDRESS",
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
