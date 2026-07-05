import { DatabaseSync } from "node:sqlite";

export function initLiveDb(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode=WAL");

  db.exec(`
    -- 1-min candles building during market hours (9:15 AM – 3:30 PM IST).
    -- This table is cleared every evening at ~5:30 PM after the permanent
    -- sync has completed. Starts fresh each trading day.
    CREATE TABLE IF NOT EXISTS live_candles (
      symbol    TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      open      REAL,
      high      REAL,
      low       REAL,
      close     REAL,
      volume    INTEGER,
      PRIMARY KEY (symbol, timestamp)
    );

    -- Latest tick per option contract (LTP + OI only — not full candle history).
    -- Storing full 1-min candle history for all F&O stock option strikes
    -- throughout the day would be 500+ MB just for a temp file.
    -- Latest tick is sufficient for live option chain scanning.
    CREATE TABLE IF NOT EXISTS live_options (
      underlying   TEXT NOT NULL,
      expiry       TEXT NOT NULL,
      strike       REAL NOT NULL,
      option_type  TEXT NOT NULL,
      last_price   REAL,
      oi           INTEGER,
      last_updated TEXT,
      PRIMARY KEY (underlying, expiry, strike, option_type)
    );
  `);
}
