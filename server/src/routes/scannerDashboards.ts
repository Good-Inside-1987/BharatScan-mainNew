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

interface ScanRow {
  id: string;
  dashboard_id: string;
  name: string;
  filter_json: string;
  series: string;
  order_idx: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

const allDashboards = () =>
  db.prepare("SELECT * FROM scanner_dashboards ORDER BY created_at ASC").all() as unknown as DashboardRow[];

const oneDashboard = (id: string) =>
  db.prepare("SELECT * FROM scanner_dashboards WHERE id = ?").get(id) as unknown as DashboardRow | undefined;

const scansForDashboard = (dashboardId: string) =>
  db
    .prepare("SELECT * FROM scanner_dashboard_scans WHERE dashboard_id = ? ORDER BY order_idx ASC, created_at ASC")
    .all(dashboardId) as unknown as ScanRow[];

const oneScan = (id: string) =>
  db.prepare("SELECT * FROM scanner_dashboard_scans WHERE id = ?").get(id) as unknown as ScanRow | undefined;

// ── Dashboard CRUD ─────────────────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  const dashboards = allDashboards();
  const result = dashboards.map((d) => ({
    ...d,
    scans: scansForDashboard(d.id),
  }));
  res.json(result);
});

router.post("/", (req: Request, res: Response) => {
  const { name, color } = req.body as { name: string; color?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO scanner_dashboards (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name.trim(), color ?? "#6366f1", now, now);
  res.status(201).json({ ...oneDashboard(id)!, scans: [] });
});

router.put("/:id", (req: Request, res: Response) => {
  const d = oneDashboard(req.params.id);
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  const { name, color } = req.body as { name?: string; color?: string };
  const now = new Date().toISOString();
  db.prepare("UPDATE scanner_dashboards SET name = ?, color = ?, updated_at = ? WHERE id = ?")
    .run(name ?? d.name, color ?? d.color, now, d.id);
  res.json({ ...oneDashboard(d.id)!, scans: scansForDashboard(d.id) });
});

router.delete("/:id", (req: Request, res: Response) => {
  const result = db.prepare("DELETE FROM scanner_dashboards WHERE id = ?").run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

// ── Scan CRUD within a dashboard ───────────────────────────────────────────────

router.get("/:id/scans", (req: Request, res: Response) => {
  const d = oneDashboard(req.params.id);
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  res.json(scansForDashboard(d.id));
});

router.post("/:id/scans", (req: Request, res: Response) => {
  const d = oneDashboard(req.params.id);
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  const { name, filter_json, series, order_idx } = req.body as {
    name: string;
    filter_json?: string;
    series?: string;
    order_idx?: number;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO scanner_dashboard_scans (id, dashboard_id, name, filter_json, series, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, d.id, name.trim(), filter_json ?? "{}", series ?? "EQ", order_idx ?? 0, now, now);
  res.status(201).json(oneScan(id));
});

router.put("/:id/scans/:scanId", (req: Request, res: Response) => {
  const s = oneScan(req.params.scanId);
  if (!s || s.dashboard_id !== req.params.id) { res.status(404).json({ error: "Not found" }); return; }
  const { name, filter_json, series, order_idx } = req.body as {
    name?: string;
    filter_json?: string;
    series?: string;
    order_idx?: number;
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE scanner_dashboard_scans SET name = ?, filter_json = ?, series = ?, order_idx = ?, updated_at = ? WHERE id = ?"
  ).run(
    name ?? s.name,
    filter_json ?? s.filter_json,
    series ?? s.series,
    order_idx ?? s.order_idx,
    now,
    s.id
  );
  res.json(oneScan(s.id));
});

router.delete("/:id/scans/:scanId", (req: Request, res: Response) => {
  const s = oneScan(req.params.scanId);
  if (!s || s.dashboard_id !== req.params.id) { res.status(404).json({ error: "Not found" }); return; }
  db.prepare("DELETE FROM scanner_dashboard_scans WHERE id = ?").run(s.id);
  res.status(204).send();
});

router.patch("/:id/scans/:scanId/ran", (req: Request, res: Response) => {
  const s = oneScan(req.params.scanId);
  if (!s || s.dashboard_id !== req.params.id) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date().toISOString();
  db.prepare("UPDATE scanner_dashboard_scans SET last_run_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, s.id);
  res.json(oneScan(s.id));
});

export default router;
