import { Router, type Request, type Response } from "express";
import { marketDb } from "../db.js";
import { syncSymbolMaster } from "../services/symbolMasterService.js";

const router = Router();

// GET /api/symbols
// Query params:
//   index=NIFTY50   — filter by index membership (partial match on comma-separated field)
//   fo_only=true    — only F&O eligible symbols
//   limit=N         — max results (default 1000, max 5000)
//
// Returns { symbols: [...], count: N }
router.get("/", (req: Request, res: Response) => {
  const index   = req.query.index as string | undefined;
  const foOnly  = req.query.fo_only === "true";
  const limit   = Math.min(
    Math.max(1, parseInt((req.query.limit as string) ?? "1000", 10) || 1000),
    5000,
  );

  try {
    const conditions: string[] = ["is_delisted = 0"];
    const params: (string | number)[] = [];

    if (index) {
      // Match exact word in comma-separated list:
      //   "NIFTY50"           exact equality
      //   "NIFTY50,..."       at the start
      //   "...,NIFTY50"       at the end
      //   "...,NIFTY50,..."   in the middle
      conditions.push(
        "(index_membership = ? OR index_membership LIKE ? OR index_membership LIKE ? OR index_membership LIKE ?)"
      );
      params.push(index, `${index},%`, `%,${index}`, `%,${index},%`);
    }
    if (foOnly) {
      conditions.push("is_fo_eligible = 1");
    }
    params.push(limit);

    const sql = `
      SELECT token, symbol, exchange, isin, name, sector, industry,
             lot_size, tick_size, instrument_type, is_fo_eligible,
             index_membership, listing_date, is_delisted
      FROM   symbols
      WHERE  ${conditions.join(" AND ")}
      ORDER  BY symbol
      LIMIT  ?
    `;

    const rows = marketDb.prepare(sql).all(...params) as unknown[];
    res.json({ symbols: rows, count: rows.length });
  } catch (err) {
    console.error("[GET /api/symbols]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

// POST /api/symbols/refresh — manual trigger for symbol master sync
// Returns { ok: true, upserted: N, timestamp: "..." }
router.post("/refresh", (req: Request, res: Response) => {
  void (async () => {
    try {
      const result = await syncSymbolMaster(marketDb);
      res.json({ ok: true, upserted: result.upserted, timestamp: result.timestamp });
    } catch (err) {
      console.error("[POST /api/symbols/refresh]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Symbol master sync failed",
      });
    }
  })();
});

export default router;
