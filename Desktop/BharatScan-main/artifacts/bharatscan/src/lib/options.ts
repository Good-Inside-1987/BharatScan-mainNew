// Options data — parses NSE FO bhavcopy CSVs (OPTSTK / OPTIDX / FUTSTK / FUTIDX rows).
// Format: INSTRUMENT,SYMBOL,EXPIRY_DT,STRIKE_PR,OPTION_TYP,OPEN,HIGH,LOW,CLOSE,
// SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT,CHG_IN_OI,TIMESTAMP

import { parseNseDate } from "./csv";

export interface OptionBar {
  date: string;        // YYYY-MM-DD
  symbol: string;      // underlying
  expiry: string;      // YYYY-MM-DD
  strike: number;
  type: "CE" | "PE";
  open: number;
  high: number;
  low: number;
  close: number;
  oi: number;
  changeInOI: number;  // CHG_IN_OI — daily change in open interest
  volume: number;      // contracts
  instrument: "OPTIDX" | "OPTSTK"; // index vs stock option
}

export interface FuturesBar {
  date: string;    // YYYY-MM-DD
  symbol: string;  // underlying
  expiry: string;  // YYYY-MM-DD
  close: number;
}

export interface OptionsDataset {
  bars: OptionBar[];
  futures: FuturesBar[];
  /** symbol -> sorted unique expiries (YYYY-MM-DD) */
  expiriesBySymbol: Map<string, string[]>;
  /** symbol+expiry -> sorted unique strikes */
  strikesByKey: Map<string, number[]>;
  /** all distinct trading dates, sorted */
  dates: string[];
  /**
   * "SYMBOL|DATE" -> front-month futures close price.
   * Front-month = futures contract with smallest expiry >= date on that date.
   * Used to determine ATM dynamically per symbol per day.
   */
  futuresCloseByKey: Map<string, number>;
}

function parseFoDate(s: string): string {
  // "26-May-2026" -> "2026-05-26" (also handles full dates like "2026-05-26")
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return parseNseDate(s);
}

export interface ParsedFoData {
  options: OptionBar[];
  futures: FuturesBar[];
}

export function parseOptionsCsv(text: string): ParsedFoData {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { options: [], futures: [] };
  const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const idx = (n: string) => header.indexOf(n);
  const iInst = idx("INSTRUMENT");
  const iSym = idx("SYMBOL");
  const iExp = idx("EXPIRY_DT");
  const iStrike = idx("STRIKE_PR");
  const iType = idx("OPTION_TYP");
  const iOpen = idx("OPEN"), iHigh = idx("HIGH"), iLow = idx("LOW"), iClose = idx("CLOSE");
  const iSettle = idx("SETTLE_PR"); // fallback when CLOSE = 0 (no trades that day)
  const iVol = idx("CONTRACTS");
  const iOi = idx("OPEN_INT");
  const iChgOi = idx("CHG_IN_OI");
  const iTs = idx("TIMESTAMP");
  const options: OptionBar[] = [];
  const futures: FuturesBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const inst = (c[iInst] ?? "").trim();
    // NSE FO bhavcopy: CLOSE = last traded price (0 when no intraday trades),
    // SETTLE_PR = theoretical settlement price (always valid). Use settle as fallback.
    const rawClose = parseFloat(c[iClose]);
    const settle = iSettle >= 0 ? parseFloat(c[iSettle]) : NaN;
    const close = (isFinite(rawClose) && rawClose > 0) ? rawClose
                : (isFinite(settle)   && settle   > 0) ? settle
                : NaN;
    if (!isFinite(close) || close <= 0) continue;
    if (inst === "OPTSTK" || inst === "OPTIDX") {
      const type = (c[iType] ?? "").trim() as "CE" | "PE";
      if (type !== "CE" && type !== "PE") continue;
      // NSE FO bhavcopy often has OPEN=HIGH=LOW=0 when no trades occurred for that
      // contract (settlement-only row). Fall back to close so bars stay valid for
      // indicators (a doji at the settle price is better than NaN OHLC).
      const rawO = parseFloat(c[iOpen]);
      const rawH = parseFloat(c[iHigh]);
      const rawL = parseFloat(c[iLow]);
      const open  = isFinite(rawO) && rawO > 0 ? rawO : close;
      const high  = isFinite(rawH) && rawH >= close ? rawH : close;
      const low   = isFinite(rawL) && rawL > 0 && rawL <= close ? rawL : close;
      const date  = parseFoDate(c[iTs]);
      if (!date) continue; // unparseable trading date — skip row
      options.push({
        date,
        symbol: (c[iSym] ?? "").trim(),
        expiry: parseFoDate(c[iExp]),
        strike: parseFloat(c[iStrike]),
        type,
        open, high, low, close,
        oi: parseFloat(c[iOi]) || 0,
        changeInOI: iChgOi >= 0 ? (parseFloat(c[iChgOi]) || 0) : 0,
        volume: parseFloat(c[iVol]) || 0,
        instrument: inst as "OPTIDX" | "OPTSTK",
      });
    } else if (inst === "FUTSTK" || inst === "FUTIDX") {
      if (close <= 0) continue;
      const fdate = parseFoDate(c[iTs]);
      if (!fdate) continue;
      futures.push({
        date: fdate,
        symbol: (c[iSym] ?? "").trim(),
        expiry: parseFoDate(c[iExp]),
        close,
      });
    }
  }
  return { options, futures };
}

export function indexOptions(bars: OptionBar[], futures: FuturesBar[] = []): OptionsDataset {
  const expiriesBySymbol = new Map<string, Set<string>>();
  const strikesByKey = new Map<string, Set<number>>();
  const dates = new Set<string>();
  for (const b of bars) {
    dates.add(b.date);
    let es = expiriesBySymbol.get(b.symbol);
    if (!es) { es = new Set(); expiriesBySymbol.set(b.symbol, es); }
    es.add(b.expiry);
    const k = `${b.symbol}|${b.expiry}`;
    let ss = strikesByKey.get(k);
    if (!ss) { ss = new Set(); strikesByKey.set(k, ss); }
    ss.add(b.strike);
  }
  const eOut = new Map<string, string[]>();
  for (const [s, set] of expiriesBySymbol) eOut.set(s, Array.from(set).sort());
  const sOut = new Map<string, number[]>();
  for (const [k, set] of strikesByKey) sOut.set(k, Array.from(set).sort((a, b) => a - b));

  // Build futures close lookup: "SYMBOL|DATE" -> front-month futures close
  // Front-month = contract with the smallest expiry that is >= date for that symbol on that date.
  // This avoids hardcoded strike steps and gives the most liquid/relevant price.
  const futuresCloseByKey = new Map<string, number>();
  if (futures.length > 0) {
    // Group by symbol|date -> list of (expiry, close)
    const symDateMap = new Map<string, { expiry: string; close: number }[]>();
    for (const fb of futures) {
      if (!isFinite(fb.close) || fb.close <= 0) continue;
      const k = `${fb.symbol}|${fb.date}`;
      let list = symDateMap.get(k);
      if (!list) { list = []; symDateMap.set(k, list); }
      list.push({ expiry: fb.expiry, close: fb.close });
    }
    // For each symbol+date, pick front-month (nearest expiry >= date, else nearest overall)
    for (const [k, list] of symDateMap) {
      const date = k.split("|")[1];
      list.sort((a, b) => a.expiry.localeCompare(b.expiry));
      const frontMonth = list.find((f) => f.expiry >= date) ?? list[0];
      futuresCloseByKey.set(k, frontMonth.close);
    }
  }

  return {
    bars,
    futures,
    expiriesBySymbol: eOut,
    strikesByKey: sOut,
    dates: Array.from(dates).sort(),
    futuresCloseByKey,
  };
}

// ── API row mapper ─────────────────────────────────────────────────────────────
// Converts JSON rows returned by the NSE options API (lowercase field names)
// into OptionBar objects — bypasses the CSV parser entirely.

export interface ApiOptionRow {
  symbol: string;
  trade_date: string;    // "YYYY-MM-DD"
  expiry_date: string;   // "YYYY-MM-DD"
  strike_price: number;
  option_type: string;   // "CE" | "PE"
  open: number;
  high: number;
  low: number;
  close: number;
  open_interest: number;
  change_in_oi: number;
  volume: number;
}

export function parseOptionsApiRows(rows: ApiOptionRow[]): OptionBar[] {
  const out: OptionBar[] = [];
  for (const row of rows) {
    const type = (row.option_type ?? "").toUpperCase() as "CE" | "PE";
    if (type !== "CE" && type !== "PE") continue;
    if (!isFinite(row.close)) continue;
    out.push({
      date: row.trade_date,
      symbol: (row.symbol ?? "").toUpperCase(),
      expiry: row.expiry_date,
      strike: Number(row.strike_price),
      type,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      oi: Number(row.open_interest) || 0,
      volume: Number(row.volume) || 0,
    });
  }
  return out;
}

/**
 * Pick the ATM strike given a reference price and the available strikes for
 * that symbol+expiry. Always picks the closest available strike — no hardcoded
 * step intervals. The optional `step` param is kept for backward-compat but
 * is ignored when `available` is provided (which is always the case here).
 */
export function atmStrike(spot: number, step: number | undefined, available: number[]): number | null {
  if (!available.length) return null;
  // Always find the nearest available strike regardless of step.
  // This correctly handles varying strike intervals (₹10 / ₹25 / ₹50 / ₹100 etc.)
  let best = available[0]; let bestDiff = Math.abs(available[0] - spot);
  for (const s of available) {
    const d = Math.abs(s - spot);
    if (d < bestDiff) { best = s; bestDiff = d; }
  }
  return best;
}

/**
 * Apply ITM/OTM offset (in sorted strike steps) from ATM.
 * offsetSteps > 0 → move to higher strikes (OTM for CE, ITM for PE)
 * offsetSteps < 0 → move to lower strikes (ITM for CE, OTM for PE)
 * Returns null if the requested offset goes out of bounds (edge case handling).
 */
export function offsetStrike(atm: number, offsetSteps: number, available: number[]): number | null {
  if (!available.length) return null;
  const i = available.indexOf(atm);
  if (i < 0) return null;
  const t = i + offsetSteps;
  if (t < 0 || t >= available.length) return null; // out of bounds — skip symbol
  return available[t];
}

/**
 * Build per-symbol option SymbolHistory objects for a given expiry & side.
 *
 * ATM is determined dynamically for every symbol on every day:
 *   1. Use the Futures close price from the options CSV (if available) as the
 *      reference price — this is the correct NSE convention.
 *   2. Fall back to the equity spot close only if futures data is absent.
 *   3. Find the nearest available strike to that reference price (no hardcoded
 *      step intervals — uses actual strikes from the CSV).
 *   4. Apply the signed offsetSteps to move up/down the sorted strike list:
 *        CE: negative = ITM (below ATM), positive = OTM (above ATM)
 *        PE: positive = ITM (above ATM), negative = OTM (below ATM)
 *   5. If the requested offset goes out of bounds, skip that bar gracefully.
 *
 * The resulting bars use the OPTION leg's OHLCV — indicators run against CE/PE
 * candles, not the underlying.
 */
import type { SymbolHistory, Bar } from "./csv";

export function buildOptionHistories(
  ds: OptionsDataset,
  spot: SymbolHistory[],
  expiry: string,
  side: "CE" | "PE",
  resolveStep: (symbol: string, expiry: string) => number | undefined,
  offsetSteps: number,
  useSpotPrice = false,
  /** Optional universe filter — only process these underlying symbols */
  universe: Set<string> | null = null,
): SymbolHistory[] {
  // index spot by symbol for fast date→close lookup
  const spotCloseBySymDate = new Map<string, number>();
  for (const h of spot) {
    for (const b of h.bars) {
      spotCloseBySymDate.set(`${h.symbol}|${b.date}`, b.close);
    }
  }

  // group option bars by symbol → date → Map(strike → bar of `side`)
  // Apply universe filter here so FUT mode works even without equity data
  const bySym = new Map<string, Map<string, Map<number, OptionBar>>>();
  for (const b of ds.bars) {
    if (b.expiry !== expiry || b.type !== side) continue;
    if (universe && !universe.has(b.symbol)) continue;
    let dm = bySym.get(b.symbol);
    if (!dm) { dm = new Map(); bySym.set(b.symbol, dm); }
    let sm = dm.get(b.date);
    if (!sm) { sm = new Map(); dm.set(b.date, sm); }
    sm.set(b.strike, b);
  }

  const out: SymbolHistory[] = [];

  for (const [symbol, dm] of bySym) {
    const availableAll = (ds.strikesByKey.get(`${symbol}|${expiry}`) ?? []).slice();
    if (!availableAll.length) continue; // no option chain — skip

    const sortedDates = Array.from(dm.keys()).sort();

    // ── Fixed-strike approach ──────────────────────────────────────────────
    // Determine ATM once from the MOST RECENT date that has a valid reference
    // price, then use that SAME strike for every historical bar.
    //
    // Why: computing ATM daily produces a rolling series where each bar may
    // come from a different strike. Weekly resampling + pivot/indicator
    // calculations on a mixed-strike series produce levels that don't match
    // any real option chain, making scan signals inconsistent with what
    // traders see on fixed-strike charts (TradingView, Chartink, etc.).
    // A fixed strike gives a coherent OHLCV series for the entire lookback.
    let fixedStrike: number | null = null;
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      const date = sortedDates[i];
      const futKey = `${symbol}|${date}`;
      const futClose = ds.futuresCloseByKey.get(futKey);
      const spotClose = spotCloseBySymDate.get(futKey);
      const refPrice = useSpotPrice ? spotClose : (futClose ?? spotClose);
      if (refPrice === undefined || !isFinite(refPrice) || refPrice <= 0) continue;
      const atm = atmStrike(refPrice, undefined, availableAll);
      if (atm === null) continue;
      fixedStrike = offsetStrike(atm, offsetSteps, availableAll);
      break; // found the most recent valid reference date — stop
    }
    if (fixedStrike === null) continue; // no valid reference price found at all

    // Build bars using the fixed strike across all available dates.
    // Days where this specific strike has no traded data are skipped gracefully.
    const bars: Bar[] = [];
    for (const date of sortedDates) {
      const sm = dm.get(date);
      if (!sm) continue;
      const ob = sm.get(fixedStrike);
      if (!ob) continue; // strike not traded on this date — skip

      bars.push({
        date,
        open: ob.open,
        high: ob.high,
        low: ob.low,
        close: ob.close,
        prevClose: 0,
        volume: ob.volume,
        trades: 0,
        value: 0,
        strike: fixedStrike,
        oi: ob.oi,
      });
    }

    if (bars.length < 2) continue;
    // fill prevClose from the same-strike series (now consistent)
    for (let i = 1; i < bars.length; i++) bars[i] = { ...bars[i], prevClose: bars[i - 1].close };
    out.push({ symbol: `${symbol} ${side}`, series: "OPT", bars, expiry });
  }
  return out;
}
