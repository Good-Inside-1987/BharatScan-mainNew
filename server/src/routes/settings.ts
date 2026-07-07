import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

const router = Router();

const BLOCKED_KEYS = ['angel_', 'totp_', 'mpin', 'api_key', 'client_code', 'secret', 'password', 'token'];

router.get("/", (_req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT key, value FROM app_settings")
    .all() as { key: string; value: string }[];
  const obj: Record<string, string> = {};
  for (const row of rows) {
    if (BLOCKED_KEYS.some(b => row.key.toLowerCase().startsWith(b))) continue;
    obj[row.key] = row.value;
  }
  res.json(obj);
});

router.post("/", (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };

  if (!key || value === undefined) {
    res.status(400).json({ error: "key and value are required" });
    return;
  }

  // Key must be alphanumeric with underscores/hyphens only
  if (!/^[a-zA-Z0-9_\-:]+$/.test(key)) {
    res.status(400).json({ error: "key must contain only letters, numbers, underscores, hyphens, or colons" });
    return;
  }

  // Key max 100 chars, value max 10KB
  if (key.length > 100) {
    res.status(400).json({ error: "key too long (max 100 characters)" });
    return;
  }
  if (String(value).length > 10240) {
    res.status(400).json({ error: "value too large (max 10KB)" });
    return;
  }

  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));

  res.json({ key, value: String(value) });
});

export default router;
