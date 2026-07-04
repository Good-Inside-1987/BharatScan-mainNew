import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

const router = Router();

interface DashboardRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

// ── List dashboards with portfolio + holdings counts ──────────────────────────
router.get("/", (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT d.*,
         COUNT(DISTINCT p.id) as portfolio_count,
         COUNT(DISTINCT h.id) as holdings_count
       FROM portfolio_dashboards d
       LEFT JOIN portfolios p ON p.dashboard_id = d.id
       LEFT JOIN holdings h ON h.portfolio_id = p.id AND h.status != 'squaredoff'
       GROUP BY d.id
       ORDER BY d.created_at ASC`
    )
    .all() as (DashboardRow & { portfolio_count: number; holdings_count: number })[];
  res.json(rows);
});

// ── Create dashboard ──────────────────────────────────────────────────────────
router.post("/", (req: Request, res: Response) => {
  const { name, color } = req.body as { name?: string; color?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO portfolio_dashboards (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name.trim(), color ?? "#6366f1", now, now);
  const row = db
    .prepare("SELECT * FROM portfolio_dashboards WHERE id = ?")
    .get(id) as DashboardRow;
  res.status(201).json({ ...row, portfolio_count: 0, holdings_count: 0 });
});

// ── Update dashboard ──────────────────────────────────────────────────────────
router.put("/:id", (req: Request, res: Response) => {
  const existing = db
    .prepare("SELECT * FROM portfolio_dashboards WHERE id = ?")
    .get(req.params.id) as DashboardRow | undefined;
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const { name, color } = req.body as { name?: string; color?: string };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE portfolio_dashboards SET name = ?, color = ?, updated_at = ? WHERE id = ?"
  ).run(
    name?.trim() ?? existing.name,
    color ?? existing.color,
    now,
    req.params.id
  );
  const updated = db
    .prepare("SELECT * FROM portfolio_dashboards WHERE id = ?")
    .get(req.params.id) as DashboardRow;
  const counts = db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) as portfolio_count, COUNT(DISTINCT h.id) as holdings_count
       FROM portfolios p
       LEFT JOIN holdings h ON h.portfolio_id = p.id AND h.status != 'squaredoff'
       WHERE p.dashboard_id = ?`
    )
    .get(req.params.id) as { portfolio_count: number; holdings_count: number };
  res.json({ ...updated, ...counts });
});

// ── Delete dashboard (cascades portfolios manually) ───────────────────────────
router.delete("/:id", (req: Request, res: Response) => {
  const existing = db
    .prepare("SELECT id FROM portfolio_dashboards WHERE id = ?")
    .get(req.params.id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Holdings + booked_trades auto-cascade via FK on portfolio_id
  db.prepare("DELETE FROM portfolios WHERE dashboard_id = ?").run(req.params.id);
  db.prepare("DELETE FROM portfolio_dashboards WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

export default router;
