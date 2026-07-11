---
name: Fyers option symbol parsing limitation
description: Why live-feed option-symbol classification skips compact weekly-expiry contracts instead of guessing.
---

Fyers trading symbols pack underlying + expiry + strike + option type into one delimiter-free
token (e.g. `NIFTY24DEC25000CE`). Monthly-expiry codes (3-letter month) are unambiguous to split
from the strike, but compact weekly-expiry codes are digit-only and can fuse with the strike's
digits with no reliable way to tell where one ends and the other begins from the string alone —
that would require an exchange symbol master lookup, which the live feed doesn't have.

**Decision:** in `server/src/services/liveFeedService.ts`, `parseOptionSymbol()` only classifies
a subset of option symbols (monthly-style, ≤6-digit strikes) and returns `null` otherwise. Candles
for symbols that *look* like options (no hyphen, ends in CE/PE) but fail parsing are logged and
dropped — never misfiled into the equity `ohlcv_intraday` table under a wrong identity.

**Why:** storing a candle under a wrong strike/expiry silently corrupts backtests reading that
data; skipping with a warning is safer than guessing.

**How to apply:** if weekly-expiry option persistence becomes a real requirement, the fix is to
resolve the underlying/expiry/strike from the `symbols` master table (populated by
`symbolMasterService.ts`) instead of parsing the tick's raw symbol string.
