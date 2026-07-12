---
name: Nightly sync jobs share the backfill budget
description: How EOD/intraday nightly jobs in BharatScan's server must interact with the shared daily broker-request budget and existing data tables.
---

Nightly bulk jobs (EOD daily-close sync, intraday sync) must never keep their own request counter — they read the same shared daily budget that `marketDataService.ts` already enforces (via `getServiceStats().remainingBudgetToday`) and stop cleanly once it hits zero, rather than letting `getHistoricalBars()` silently no-op per call.

**Why:** the spec required one shared budget across manual backfill, EOD, and intraday jobs, plus visibility into how many symbols were completed vs. skipped due to budget exhaustion — silently relying on `getHistoricalBars()`'s internal skip-if-budget-exhausted made that indistinguishable from "no data available".

**How to apply:** before spending a broker call on a symbol, check the target table directly (`ohlcv_daily`/`ohlcv_intraday` for that symbol+date) — if a row already exists, treat it as free/completed rather than calling `getHistoricalBars()` again. This matters especially for intraday: the live feed writes ticks directly into `ohlcv_intraday` in real time for its ~200 subscribed symbols, so the nightly intraday job's real job is only to backfill symbols outside that live-feed cap or fill gaps from feed downtime — checking for an existing row first avoids wasting budget re-fetching what the feed already captured. Note `ohlcv_daily`/`ohlcv_intraday` store symbols in Fyers format (`NSE:SYMBOL-EQ`), not the plain ticker from the `symbols` table — convert before querying or inserting.
