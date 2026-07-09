---
name: Broker-backed history loader parity with CSV loader
description: Constraints for any code that turns broker/API OHLCV bars into SymbolHistory for the scanner
---

When mapping broker/API bar responses into the app's `SymbolHistory`/`Bar` shape (used by screener.ts/indicators.ts), always sort raw bars chronologically **before** computing `prevClose` from the running previous bar, and de-dupe same-day bars (keep last) after sorting — same order `loadFromFiles()` uses for CSV bars.

**Why:** Broker/API responses aren't guaranteed to arrive in date order; computing prevClose before sorting silently attaches the wrong prevClose to a date after the array is later sorted, corrupting change_pct-based scan conditions with no visible error.

**How to apply:** Any new data source feeding SymbolHistory (websocket backfill, REST history endpoints, etc.) must sort→dedupe→then compute derived fields, matching the CSV path's order, or scanner results will silently diverge between data sources.
