import { Router, type Request, type Response } from "express";
import { db } from "../db.js";

const router = Router();

interface PaperAccountRow {
  id: string;
  name: string;
  starting_balance: number;
  cash_balance: number;
  created_at: string;
  updated_at: string;
}

interface PaperPositionRow {
  id: string;
  account_id: string;
  instrument_type: "stock" | "option";
  symbol: string;
  underlying: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  expiry: string | null;
  side: "long" | "short";
  qty: number;
  lot_size: number;
  entry_price: number;
  entry_date: string;
  margin_blocked: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PaperTradeRow {
  id: string;
  account_id: string;
  position_id: string | null;
  instrument_type: "stock" | "option";
  symbol: string;
  underlying: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  expiry: string | null;
  side: "long" | "short";
  qty: number;
  lot_size: number;
  entry_price: number;
  exit_price: number;
  entry_date: string;
  exit_date: string;
  realized_pnl: number;
  created_at: string;
}

function computeAccountStats(accountId: string) {
  const positions = db
    .prepare("SELECT * FROM paper_positions WHERE account_id = ? AND status = 'open'")
    .all(accountId) as PaperPositionRow[];
  const invested = positions.reduce((sum, p) => sum + p.margin_blocked, 0);
  const trades = db
    .prepare("SELECT COALESCE(SUM(realized_pnl), 0) as total FROM paper_trades WHERE account_id = ?")
    .get(accountId) as { total: number };
  return { invested, realizedPnl: trades.total, openPositions: positions.length };
}

// ── Accounts ─────────────────────────────────────────────────────────────────

router.get("/accounts", (_req: Request, res: Response) => {
  const rows = db.prepare("SELECT * FROM paper_accounts ORDER BY created_at ASC").all() as PaperAccountRow[];
  const withStats = rows.map((a) => ({ ...a, ...computeAccountStats(a.id) }));
  res.json(withStats);
});

router.post("/accounts", (req: Request, res: Response) => {
  const { name, starting_balance } = req.body as { name?: string; starting_balance?: number };
  if (!name?.trim() || !starting_balance || starting_balance <= 0) {
    res.status(400).json({ error: "name and starting_balance are required" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO paper_accounts (id, name, starting_balance, cash_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name.trim(), Number(starting_balance), Number(starting_balance), now, now);
  res.status(201).json({ ...(db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(id) as PaperAccountRow), ...computeAccountStats(id) });
});

router.put("/accounts/:id", (req: Request, res: Response) => {
  const existing = db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow | undefined;
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const { name, add_funds } = req.body as { name?: string; add_funds?: number };
  const now = new Date().toISOString();
  const newBalance = add_funds ? existing.cash_balance + Number(add_funds) : existing.cash_balance;
  const newStarting = add_funds ? existing.starting_balance + Number(add_funds) : existing.starting_balance;
  db.prepare(
    "UPDATE paper_accounts SET name = ?, starting_balance = ?, cash_balance = ?, updated_at = ? WHERE id = ?"
  ).run(name?.trim() || existing.name, newStarting, newBalance, now, req.params.id);
  res.json({ ...(db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow), ...computeAccountStats(req.params.id) });
});

router.delete("/accounts/:id", (req: Request, res: Response) => {
  const result = db.prepare("DELETE FROM paper_accounts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

router.post("/accounts/:id/reset", (req: Request, res: Response) => {
  const existing = db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow | undefined;
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date().toISOString();
  db.prepare("DELETE FROM paper_positions WHERE account_id = ?").run(req.params.id);
  db.prepare("DELETE FROM paper_trades WHERE account_id = ?").run(req.params.id);
  db.prepare("UPDATE paper_accounts SET cash_balance = starting_balance, updated_at = ? WHERE id = ?").run(now, req.params.id);
  res.json({ ...(db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow), ...computeAccountStats(req.params.id) });
});

// ── Positions ────────────────────────────────────────────────────────────────

router.get("/accounts/:id/positions", (req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM paper_positions WHERE account_id = ? AND status = 'open' ORDER BY created_at DESC")
    .all(req.params.id) as PaperPositionRow[];
  res.json(rows);
});

router.post("/accounts/:id/positions", (req: Request, res: Response) => {
  const account = db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow | undefined;
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }

  const {
    instrument_type, symbol, underlying, strike, option_type, expiry,
    side, qty, lot_size, entry_price, entry_date,
  } = req.body as {
    instrument_type?: "stock" | "option";
    symbol?: string;
    underlying?: string;
    strike?: number;
    option_type?: "CE" | "PE";
    expiry?: string;
    side?: "long" | "short";
    qty?: number;
    lot_size?: number;
    entry_price?: number;
    entry_date?: string;
  };

  if (!instrument_type || !symbol?.trim() || !side || !qty || qty <= 0 || !entry_price || entry_price <= 0 || !entry_date) {
    res.status(400).json({ error: "instrument_type, symbol, side, qty, entry_price, entry_date are required" });
    return;
  }
  if (instrument_type === "option" && (!underlying?.trim() || !strike || !option_type || !expiry)) {
    res.status(400).json({ error: "underlying, strike, option_type, expiry are required for options" });
    return;
  }

  const effectiveLotSize = Number(lot_size) > 0 ? Number(lot_size) : 1;
  const notional = Number(qty) * effectiveLotSize * Number(entry_price);
  if (notional > account.cash_balance) {
    res.status(400).json({ error: `Insufficient virtual balance. Required ₹${notional.toFixed(2)}, available ₹${account.cash_balance.toFixed(2)}` });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO paper_positions
      (id, account_id, instrument_type, symbol, underlying, strike, option_type, expiry, side, qty, lot_size, entry_price, entry_date, margin_blocked, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    id, req.params.id, instrument_type, symbol.trim().toUpperCase(),
    underlying?.trim().toUpperCase() || null, strike ?? null, option_type ?? null, expiry ?? null,
    side, Number(qty), effectiveLotSize, Number(entry_price), entry_date, notional, now, now
  );
  db.prepare("UPDATE paper_accounts SET cash_balance = cash_balance - ?, updated_at = ? WHERE id = ?").run(notional, now, req.params.id);

  res.status(201).json(db.prepare("SELECT * FROM paper_positions WHERE id = ?").get(id) as PaperPositionRow);
});

router.post("/accounts/:id/positions/:posId/close", (req: Request, res: Response) => {
  const account = db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(req.params.id) as PaperAccountRow | undefined;
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  const position = db.prepare("SELECT * FROM paper_positions WHERE id = ? AND account_id = ?").get(req.params.posId, req.params.id) as PaperPositionRow | undefined;
  if (!position) { res.status(404).json({ error: "Position not found" }); return; }

  const { qty_closed, exit_price, exit_date } = req.body as { qty_closed?: number; exit_price?: number; exit_date?: string };
  if (!qty_closed || qty_closed <= 0 || qty_closed > position.qty || !exit_price || exit_price <= 0 || !exit_date) {
    res.status(400).json({ error: `qty_closed (1-${position.qty}), exit_price, exit_date are required` });
    return;
  }

  const closedQty = Number(qty_closed);
  const marginReleased = closedQty * position.lot_size * position.entry_price;
  const realizedPnl = position.side === "long"
    ? (Number(exit_price) - position.entry_price) * closedQty * position.lot_size
    : (position.entry_price - Number(exit_price)) * closedQty * position.lot_size;

  const now = new Date().toISOString();
  const tradeId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO paper_trades
      (id, account_id, position_id, instrument_type, symbol, underlying, strike, option_type, expiry, side, qty, lot_size, entry_price, exit_price, entry_date, exit_date, realized_pnl, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tradeId, position.account_id, position.id, position.instrument_type, position.symbol,
    position.underlying, position.strike, position.option_type, position.expiry,
    position.side, closedQty, position.lot_size, position.entry_price, Number(exit_price),
    position.entry_date, exit_date, realizedPnl, now
  );

  db.prepare("UPDATE paper_accounts SET cash_balance = cash_balance + ?, updated_at = ? WHERE id = ?")
    .run(marginReleased + realizedPnl, now, position.account_id);

  const remainingQty = position.qty - closedQty;
  if (remainingQty <= 0) {
    db.prepare("DELETE FROM paper_positions WHERE id = ?").run(position.id);
    res.json({ action: "closed", trade_id: tradeId, realized_pnl: realizedPnl });
  } else {
    const newMargin = position.margin_blocked - marginReleased;
    db.prepare("UPDATE paper_positions SET qty = ?, margin_blocked = ?, updated_at = ? WHERE id = ?")
      .run(remainingQty, newMargin, now, position.id);
    res.json({
      action: "partial",
      trade_id: tradeId,
      realized_pnl: realizedPnl,
      remaining_qty: remainingQty,
      position: db.prepare("SELECT * FROM paper_positions WHERE id = ?").get(position.id) as PaperPositionRow,
    });
  }
});

// ── Trades (history) ────────────────────────────────────────────────────────

router.get("/accounts/:id/trades", (req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM paper_trades WHERE account_id = ? ORDER BY created_at DESC")
    .all(req.params.id) as PaperTradeRow[];
  res.json(rows);
});

export default router;
