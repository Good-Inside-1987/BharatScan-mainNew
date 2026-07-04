import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

const router = Router();

interface ScanRow {
  id: string;
  name: string;
  scan_json: string;
  folder: string | null;
  is_favorite: number;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
}

const all = () =>
  db
    .prepare("SELECT * FROM saved_scans ORDER BY updated_at DESC")
    .all() as ScanRow[];

const one = (id: string) =>
  db
    .prepare("SELECT * FROM saved_scans WHERE id = ?")
    .get(id) as ScanRow | undefined;

router.get("/", (_req: Request, res: Response) => {
  res.json(all());
});

router.post("/", (req: Request, res: Response) => {
  const { name, scan_json, folder } = req.body as {
    name: string;
    scan_json: string;
    folder?: string;
  };
  if (!name || !scan_json) {
    res.status(400).json({ error: "name and scan_json are required" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO saved_scans (id, name, scan_json, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, scan_json, folder ?? null, now, now);
  res.status(201).json(one(id));
});

router.get("/:id", (req: Request, res: Response) => {
  const scan = one(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(scan);
});

router.put("/:id", (req: Request, res: Response) => {
  const existing = one(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { name, scan_json, folder } = req.body as {
    name?: string;
    scan_json?: string;
    folder?: string;
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE saved_scans SET name = ?, scan_json = ?, folder = ?, updated_at = ? WHERE id = ?"
  ).run(
    name ?? existing.name,
    scan_json ?? existing.scan_json,
    folder !== undefined ? folder || null : existing.folder,
    now,
    req.params.id
  );
  res.json(one(req.params.id));
});

router.delete("/:id", (req: Request, res: Response) => {
  const result = db
    .prepare("DELETE FROM saved_scans WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/:id/favorite", (req: Request, res: Response) => {
  const scan = one(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const newVal = scan.is_favorite ? 0 : 1;
  db.prepare("UPDATE saved_scans SET is_favorite = ? WHERE id = ?").run(
    newVal,
    req.params.id
  );
  res.json({ ...scan, is_favorite: newVal });
});

router.post("/:id/duplicate", (req: Request, res: Response) => {
  const scan = one(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO saved_scans (id, name, scan_json, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId, `Copy of ${scan.name}`, scan.scan_json, scan.folder, now, now);
  res.status(201).json(one(newId));
});

export default router;
