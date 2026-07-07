import { Router } from "express";
import { db } from "../db.js";

const router = Router();

interface AlertRow {
  id: string;
  symbol: string;
  condition_type: string;
  target_price: number;
  note: string;
  status: string;
  priority: string;
  side: string;
  trigger_count: number;
  last_triggered_at: string | null;
  last_checked_price: number | null;
  created_at: string;
  updated_at: string;
}

// ── List all alerts ────────────────────────────────────────────────────────────
router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM alerts ORDER BY created_at DESC").all();
  res.json(rows);
});

// ── Create alert ───────────────────────────────────────────────────────────────
router.post("/", (req, res) => {
  const { symbol, condition_type, target_price, note, priority, side } = req.body as {
    symbol: string;
    condition_type: string;
    target_price: number;
    note?: string;
    priority?: string;
    side?: string;
  };
  if (!symbol?.trim()) return res.status(400).json({ error: "symbol required" });
  if (!condition_type) return res.status(400).json({ error: "condition_type required" });
  if (target_price == null || isNaN(Number(target_price))) return res.status(400).json({ error: "target_price required" });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO alerts (id, symbol, condition_type, target_price, note, status, priority, side, trigger_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)
  `).run(id, symbol.trim().toUpperCase(), condition_type, Number(target_price), note?.trim() ?? "", priority ?? "medium", side ?? "buy", now, now);
  res.status(201).json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(id));
});

// ── Update alert ───────────────────────────────────────────────────────────────
router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id) as unknown as AlertRow | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { symbol, condition_type, target_price, note, priority, side } = req.body as {
    symbol?: string; condition_type?: string; target_price?: number;
    note?: string; priority?: string; side?: string;
  };
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE alerts SET symbol=?, condition_type=?, target_price=?, note=?, priority=?, side=?, updated_at=? WHERE id=?
  `).run(
    symbol?.trim().toUpperCase() ?? existing.symbol,
    condition_type ?? existing.condition_type,
    target_price != null ? Number(target_price) : existing.target_price,
    note != null ? note.trim() : existing.note,
    priority ?? existing.priority,
    side ?? existing.side ?? "buy",
    now, req.params.id
  );
  res.json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id));
});

// ── Toggle status ──────────────────────────────────────────────────────────────
router.patch("/:id/toggle", (req, res) => {
  const existing = db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id) as unknown as AlertRow | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const newStatus = existing.status === "active" ? "paused" : "active";
  db.prepare("UPDATE alerts SET status=?, updated_at=? WHERE id=?").run(newStatus, new Date().toISOString(), req.params.id);
  res.json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id));
});

// ── Delete alert ───────────────────────────────────────────────────────────────
router.delete("/:id", (req, res) => {
  if (!db.prepare("SELECT id FROM alerts WHERE id=?").get(req.params.id)) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM alerts WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── Trigger history ────────────────────────────────────────────────────────────
router.get("/history/all", (_req, res) => {
  const rows = db.prepare("SELECT * FROM alert_triggers ORDER BY triggered_at DESC LIMIT 100").all();
  res.json(rows);
});

// ── Record a trigger ──────────────────────────────────────────────────────────
router.post("/:id/trigger", (req, res) => {
  const existing = db.prepare("SELECT * FROM alerts WHERE id=?").get(req.params.id) as unknown as AlertRow | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { triggered_price } = req.body as { triggered_price: number };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO alert_triggers (id, alert_id, symbol, condition_type, target_price, triggered_price, triggered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, existing.symbol, existing.condition_type, existing.target_price, Number(triggered_price), now);
  db.prepare("UPDATE alerts SET trigger_count=trigger_count+1, last_triggered_at=?, last_checked_price=?, updated_at=? WHERE id=?")
    .run(now, Number(triggered_price), now, req.params.id);
  res.status(201).json(db.prepare("SELECT * FROM alert_triggers WHERE id=?").get(id));
});

// ── Update last checked price (after a run that didn't fire) ──────────────────
router.patch("/:id/checked", (req, res) => {
  const { price } = req.body as { price: number };
  db.prepare("UPDATE alerts SET last_checked_price=?, updated_at=? WHERE id=?")
    .run(Number(price), new Date().toISOString(), req.params.id);
  res.json(db.prepare("SELECT * FROM alerts WHERE id=?").get(req.params.id));
});

export default router;
