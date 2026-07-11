---
name: Live feed F&O auto-subscribe & protected symbols
description: Why the SubscriptionManager rejects ad-hoc adds instead of evicting protected symbols, and how the F&O ranking excludes unpriced symbols.
---

`server/src/services/liveFeedService.ts`'s `SubscriptionManager` supports marking a subset of
subscribed symbols "protected" (used for the auto-subscribed F&O universe). FIFO eviction only
ever considers unprotected symbols as candidates.

**Decision:** if an ad-hoc subscribe (e.g. a user viewing a chart) needs to evict something to
stay under the 200-symbol cap and every unprotected candidate is exhausted, the excess symbols
are rejected (logged) rather than evicting a protected one.

**Why:** the F&O auto-subscribe set is a deliberate prioritization decision made once a day at
market open; a casual chart view should never be able to silently undo it.

**How to apply:** protected flags are cleared (not the subscriptions themselves) at market close
via `clearProtectedSymbols()`, so the next day's `liveOpen` job re-ranks and re-marks a fresh set
from current `ohlcv_daily` prices. Symbols with no `ohlcv_daily` row are excluded from ranking
entirely (never guessed at) — same rule as the option-symbol-parsing decision.
