import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

const router = Router();

interface PortfolioRow {
  id: string;
  name: string;
  notes: string | null;
  dashboard_id: string | null;
  created_at: string;
  updated_at: string;
}

interface HoldingRow {
  id: string;
  portfolio_id: string;
  symbol: string;
  qty: number;
  buy_price: number;
  buy_date: string;
  broker_account: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface BookedTradeRow {
  id: string;
  portfolio_id: string;
  holding_id: string | null;
  symbol: string;
  qty: number;
  buy_price: number;
  sell_price: number;
  buy_date: string;
  sell_date: string;
  realized_pnl: number;
  created_at: string;
}

// ── Portfolios ──────────────────────────────────────────────────────────────

router.get("/", (req: Request, res: Response) => {
  const { dashboard_id } = req.query as { dashboard_id?: string };
  const rows = dashboard_id
    ? (db.prepare("SELECT * FROM portfolios WHERE dashboard_id = ? ORDER BY created_at ASC").all(dashboard_id) as unknown as PortfolioRow[])
    : (db.prepare("SELECT * FROM portfolios ORDER BY created_at ASC").all() as unknown as PortfolioRow[]);
  res.json(rows);
});

router.post("/", (req: Request, res: Response) => {
  const { name, notes, dashboard_id } = req.body as { name?: string; notes?: string; dashboard_id?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO portfolios (id, name, notes, dashboard_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name.trim(), notes?.trim() ?? null, dashboard_id ?? null, now, now);
  res.status(201).json(
    db.prepare("SELECT * FROM portfolios WHERE id = ?").get(id) as unknown as PortfolioRow
  );
});

router.put("/:id", (req: Request, res: Response) => {
  const { name, notes } = req.body as { name?: string; notes?: string };
  const existing = db
    .prepare("SELECT * FROM portfolios WHERE id = ?")
    .get(req.params.id) as unknown as PortfolioRow | undefined;
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE portfolios SET name = ?, notes = ?, updated_at = ? WHERE id = ?"
  ).run(name ?? existing.name, notes !== undefined ? (notes?.trim() ?? null) : existing.notes, now, req.params.id);
  res.json(
    db.prepare("SELECT * FROM portfolios WHERE id = ?").get(req.params.id) as unknown as PortfolioRow
  );
});

router.delete("/:id", (req: Request, res: Response) => {
  const result = db
    .prepare("DELETE FROM portfolios WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

// ── All active holdings (optionally scoped to a dashboard) ────────────────────

router.get("/all/holdings", (req: Request, res: Response) => {
  const { dashboard_id } = req.query as { dashboard_id?: string };
  const rows = dashboard_id
    ? (db.prepare(
        `SELECT h.*, p.name as portfolio_name
         FROM holdings h
         JOIN portfolios p ON h.portfolio_id = p.id
         WHERE h.status != 'squaredoff' AND p.dashboard_id = ?
         ORDER BY h.created_at ASC`
      ).all(dashboard_id) as unknown as (HoldingRow & { portfolio_name: string })[])
    : (db.prepare(
        `SELECT h.*, p.name as portfolio_name
         FROM holdings h
         JOIN portfolios p ON h.portfolio_id = p.id
         WHERE h.status != 'squaredoff'
         ORDER BY h.created_at ASC`
      ).all() as unknown as (HoldingRow & { portfolio_name: string })[]);
  res.json(rows);
});

// ── All booked trades (optionally scoped to a dashboard) ──────────────────────

router.get("/all/booked", (req: Request, res: Response) => {
  const { dashboard_id } = req.query as { dashboard_id?: string };
  const rows = dashboard_id
    ? (db.prepare(
        `SELECT bt.*, p.name as portfolio_name
         FROM booked_trades bt
         JOIN portfolios p ON bt.portfolio_id = p.id
         WHERE p.dashboard_id = ?
         ORDER BY bt.created_at ASC`
      ).all(dashboard_id) as unknown as (BookedTradeRow & { portfolio_name: string })[])
    : (db.prepare(
        `SELECT bt.*, p.name as portfolio_name
         FROM booked_trades bt
         JOIN portfolios p ON bt.portfolio_id = p.id
         ORDER BY bt.created_at ASC`
      ).all() as unknown as (BookedTradeRow & { portfolio_name: string })[]);
  res.json(rows);
});

// ── Holdings ─────────────────────────────────────────────────────────────────

router.get("/:id/holdings", (req: Request, res: Response) => {
  const rows = db
    .prepare(
      "SELECT * FROM holdings WHERE portfolio_id = ? AND status != 'squaredoff' ORDER BY created_at ASC"
    )
    .all(req.params.id) as unknown as HoldingRow[];
  res.json(rows);
});

router.post("/:id/holdings", (req: Request, res: Response) => {
  const { symbol, qty, buy_price, buy_date, broker_account } = req.body as {
    symbol?: string;
    qty?: number;
    buy_price?: number;
    buy_date?: string;
    broker_account?: string;
  };
  if (!symbol?.trim() || !qty || !buy_price || !buy_date) {
    res.status(400).json({ error: "symbol, qty, buy_price, buy_date are required" });
    return;
  }
  const portfolio = db.prepare("SELECT id FROM portfolios WHERE id = ?").get(req.params.id);
  if (!portfolio) { res.status(404).json({ error: "Portfolio not found" }); return; }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO holdings (id, portfolio_id, symbol, qty, buy_price, buy_date, broker_account, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'holding', ?, ?)"
  ).run(id, req.params.id, symbol.trim().toUpperCase(), Number(qty), Number(buy_price), buy_date, broker_account?.trim() || null, now, now);
  res.status(201).json(
    db.prepare("SELECT * FROM holdings WHERE id = ?").get(id) as unknown as HoldingRow
  );
});

router.put("/:id/holdings/:holdingId", (req: Request, res: Response) => {
  const holding = db
    .prepare("SELECT * FROM holdings WHERE id = ? AND portfolio_id = ?")
    .get(req.params.holdingId, req.params.id) as unknown as HoldingRow | undefined;
  if (!holding) { res.status(404).json({ error: "Not found" }); return; }
  const { symbol, qty, buy_price, buy_date, broker_account } = req.body as {
    symbol?: string; qty?: number; buy_price?: number; buy_date?: string; broker_account?: string;
  };
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE holdings SET symbol = ?, qty = ?, buy_price = ?, buy_date = ?, broker_account = ?, updated_at = ? WHERE id = ?"
  ).run(
    symbol?.trim().toUpperCase() ?? holding.symbol,
    qty !== undefined ? Number(qty) : holding.qty,
    buy_price !== undefined ? Number(buy_price) : holding.buy_price,
    buy_date ?? holding.buy_date,
    broker_account !== undefined ? (broker_account.trim() || null) : holding.broker_account,
    now,
    holding.id
  );
  res.json(db.prepare("SELECT * FROM holdings WHERE id = ?").get(holding.id) as unknown as HoldingRow);
});

router.delete("/:id/holdings/:holdingId", (req: Request, res: Response) => {
  const result = db
    .prepare("DELETE FROM holdings WHERE id = ? AND portfolio_id = ?")
    .run(req.params.holdingId, req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

// ── Square Off ────────────────────────────────────────────────────────────────

router.post("/:id/holdings/:holdingId/squareoff", (req: Request, res: Response) => {
  const { qty_sold, sell_price, sell_date } = req.body as {
    qty_sold?: number;
    sell_price?: number;
    sell_date?: string;
  };
  if (!qty_sold || !sell_price || !sell_date) {
    res.status(400).json({ error: "qty_sold, sell_price, sell_date are required" });
    return;
  }
  const holding = db
    .prepare("SELECT * FROM holdings WHERE id = ?")
    .get(req.params.holdingId) as unknown as HoldingRow | undefined;
  if (!holding) { res.status(404).json({ error: "Holding not found" }); return; }
  if (holding.portfolio_id !== req.params.id) {
    res.status(403).json({ error: "Holding does not belong to this portfolio" });
    return;
  }
  const soldQty = Number(qty_sold);
  if (soldQty <= 0 || soldQty > holding.qty) {
    res.status(400).json({ error: `qty_sold must be between 1 and ${holding.qty}` });
    return;
  }

  const now = new Date().toISOString();
  const realizedPnl = (Number(sell_price) - holding.buy_price) * soldQty;

  const bookedId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO booked_trades (id, portfolio_id, holding_id, symbol, qty, buy_price, sell_price, buy_date, sell_date, realized_pnl, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bookedId, holding.portfolio_id, holding.id, holding.symbol,
    soldQty, holding.buy_price, Number(sell_price),
    holding.buy_date, sell_date, realizedPnl, now
  );

  const remainingQty = holding.qty - soldQty;
  if (remainingQty <= 0) {
    db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
    res.json({ action: "squaredoff", booked_id: bookedId });
  } else {
    db.prepare("UPDATE holdings SET qty = ?, status = 'partial', updated_at = ? WHERE id = ?").run(remainingQty, now, holding.id);
    res.json({
      action: "partial",
      booked_id: bookedId,
      remaining_qty: remainingQty,
      holding: db.prepare("SELECT * FROM holdings WHERE id = ?").get(holding.id) as unknown as HoldingRow,
    });
  }
});

// ── Booked Trades ─────────────────────────────────────────────────────────────

router.get("/:id/booked", (req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM booked_trades WHERE portfolio_id = ? ORDER BY created_at ASC")
    .all(req.params.id) as unknown as BookedTradeRow[];
  res.json(rows);
});

// ── Batch Import ─────────────────────────────────────────────────────────────

router.post("/import", (req: Request, res: Response) => {
  const { portfolios: importData, replace, dashboard_id } = req.body as {
    replace?: boolean;
    dashboard_id?: string;
    portfolios?: Array<{
      name: string;
      notes?: string;
      holdings?: Array<{ symbol: string; qty: number; buy_price: number; buy_date: string; broker_account?: string; status?: string }>;
      booked_trades?: Array<{ symbol: string; qty: number; buy_price: number; sell_price: number; buy_date: string; sell_date: string; realized_pnl: number }>;
    }>;
  };
  if (!Array.isArray(importData) || importData.length === 0) {
    res.status(400).json({ error: "portfolios array is required" });
    return;
  }
  if (replace) {
    if (dashboard_id) {
      db.prepare("DELETE FROM portfolios WHERE dashboard_id = ?").run(dashboard_id);
    } else {
      db.prepare("DELETE FROM portfolios").run();
    }
  }
  const created: string[] = [];
  const now = new Date().toISOString();
  for (const p of importData) {
    if (!p.name?.trim()) continue;
    const portfolioId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO portfolios (id, name, notes, dashboard_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(portfolioId, p.name.trim(), p.notes?.trim() ?? null, dashboard_id ?? null, now, now);
    for (const h of p.holdings ?? []) {
      if (!h.symbol || !h.qty || !h.buy_price || !h.buy_date) continue;
      db.prepare(
        "INSERT INTO holdings (id, portfolio_id, symbol, qty, buy_price, buy_date, broker_account, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), portfolioId, h.symbol.trim().toUpperCase(), Number(h.qty), Number(h.buy_price), h.buy_date, h.broker_account?.trim() || null, h.status ?? "holding", now, now);
    }
    for (const b of p.booked_trades ?? []) {
      if (!b.symbol || !b.qty || !b.buy_price || !b.sell_price || !b.buy_date || !b.sell_date) continue;
      db.prepare(
        "INSERT INTO booked_trades (id, portfolio_id, holding_id, symbol, qty, buy_price, sell_price, buy_date, sell_date, realized_pnl, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), portfolioId, null, b.symbol.trim().toUpperCase(), Number(b.qty), Number(b.buy_price), Number(b.sell_price), b.buy_date, b.sell_date, Number(b.realized_pnl), now);
    }
    created.push(portfolioId);
  }
  res.status(201).json({ imported: created.length, portfolio_ids: created });
});

export default router;
