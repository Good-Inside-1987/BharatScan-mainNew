---
name: Backfill progress intervals
description: Why backfill_progress uses a JSON interval list instead of a single min/max window, and how to maintain it.
---

## Rule
`backfill_progress.covered_ranges` stores a JSON array of `{from, to}` date-range objects, sorted and non-overlapping.  Never collapse it to a single `(earliest, latest)` pair.

## Why
A min/max window hides holes: if chunk B [Apr–Jun] fails and is not re-queued, a later successful chunk C [Jul–Sep] would advance `latest` to Sep, making `gapsFor()` report no gap for Apr–Jun.  The interval list keeps each covered segment independent, so failed chunks remain detectable gaps on every subsequent request.

## How to apply

**Merging on success:**
```ts
const existing: {from:string;to:string}[] = JSON.parse(row.covered_ranges ?? '[]');
const merged = mergeIntervals(existing, {from, to});
// upsert merged JSON back into the row
```
`mergeIntervals` sorts all intervals by `from`, then coalesces overlapping/touching entries.

**Gap detection:**
```ts
const covered = JSON.parse(row.covered_ranges ?? '[]');
const gaps = computeGaps(covered, requestedFrom, requestedTo);
```
`computeGaps` walks sorted intervals with a `cursor` and emits sub-ranges of `[requestedFrom, requestedTo]` that fall outside every covered interval.

## Schema note
The CREATE TABLE uses `covered_ranges TEXT NOT NULL DEFAULT '[]'`.  An ALTER TABLE guard handles existing rows from an older `(earliest_date_covered, latest_date_covered)` schema:
```ts
try { db.exec("ALTER TABLE backfill_progress ADD COLUMN covered_ranges TEXT NOT NULL DEFAULT '[]'"); }
catch { /* already exists */ }
```
