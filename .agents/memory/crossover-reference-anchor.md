---
name: Crossover reference anchoring
description: Why crossed_above/below must use current reference b for both bars, not bP for the previous bar.
---

## The rule
In `screener.ts` `evalCondition`, `crossed_above` must be `aP <= b && a > b` (not `aP <= bP && a > b`).

**Why:** When the right side is a higher-timeframe indicator (e.g. Weekly Camarilla R1 vs Daily close), the reference level recalculates at each TF boundary. At the start of a new week, `bP` (last week's R1) can be much higher than `b` (this week's R1). This makes `aP <= bP` trivially true even when price was above last week's R1 all along — so the condition fires falsely even though price actually fell. Anchoring both `aP` and `a` against the **current** `b` ensures the signal fires only when price genuinely moved through today's level.

**How to apply:** Any time `crossed_above` / `crossed_below` logic is touched, keep `bP` removed (it is no longer computed or used). The fix was applied 2026-06-28.
