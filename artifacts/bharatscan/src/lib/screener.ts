import type { Bar, SymbolHistory } from "./csv";
import {
  ema, macd, rollingMax, rollingMin, rsi, sma, williamsR, wma,
  cci, donchianMiddle, donchianUpper, donchianLower, bollinger, atr, supertrend, halftrend, halftrendBull, halftrendBear, camarilla, patterns,
  alma, hma, kama, hammingMa, jma, mac, smma, lsma, vwap, mfi, adx, dmi, aroon, stochRsi, ladderAtr, chandelier, atrTrailingStop, ichimoku, psar, cpr,
  vwma, keltner, stochastic, obv, cmf, dpo, pivot,
  type PivotFamily, type PivotPart,
} from "./indicators";
import { resampleBars, TF_UNIT, isIntradayTf, type Timeframe } from "./timeframe";
import { toHeikinAshi } from "./heikinAshi";

export type CandleKind = "regular" | "ha";

export type Operator =
  | "" | ">" | "<" | ">=" | "<=" | "==" | "!="
  | "crossed_above" | "crossed_below";

// Indicator/leaf types
export type LeafIndicator =
  | { kind: "price"; field: "open" | "high" | "low" | "close" | "volume" | "prev_close" | "change_pct" }
  | { kind: "open" }
  | { kind: "high" }
  | { kind: "low" }
  | { kind: "close" }
  | { kind: "volume" }
  | { kind: "prev_close" }
  | { kind: "change_pct" }
  | { kind: "hl2" }
  | { kind: "hlc3" }
  | { kind: "ohlc4" }
  | { kind: "sma"; period: number; source?: SrcExpr }
  | { kind: "ema"; period: number; source?: SrcExpr }
  | { kind: "wma"; period: number; source?: SrcExpr }
  | { kind: "rsi"; period: number }
  | { kind: "williams_r"; period: number }
  | { kind: "cci"; period: number }
  | { kind: "atr"; period: number }
  | { kind: "high_n"; period: number }
  | { kind: "low_n"; period: number }
  | { kind: "macd"; fast: number; slow: number; signal: number; part: "line" | "signal" | "hist" }
  | { kind: "bbands"; period: number; mult: number; part: "upper" | "mid" | "lower" }
  | { kind: "bb_pctb"; period: number; mult: number }
  | { kind: "donchian"; period: number; part: "upper" | "mid" | "lower" }
  | { kind: "supertrend"; period: number; mult: number }
  | { kind: "halftrend"; amplitude: number; channel: number }
  | { kind: "halftrend_bull"; amplitude: number; channel: number }
  | { kind: "halftrend_bear"; amplitude: number; channel: number }
  | { kind: "camarilla"; level: 1 | 2 | 3 | 4; side: "R" | "S" | "P" }
  | { kind: "alma"; period: number; offset: number; sigma: number; source?: SrcExpr }
  | { kind: "hma"; period: number; source?: SrcExpr }
  | { kind: "kama"; period: number; source?: SrcExpr }
  | { kind: "smma"; period: number; source?: SrcExpr }
  | { kind: "lsma"; length: number; offset: number; source?: SrcExpr }
  | { kind: "hamming"; period: number; source?: SrcExpr }
  | { kind: "jma"; length: number; phase: number; power: number; source?: SrcExpr }
  | { kind: "mac"; upperLen: number; lowerLen: number; upperOffset: number; lowerOffset: number; part: "upper" | "lower" }
  | { kind: "vwap"; period: number }
  | { kind: "mfi"; period: number }
  | { kind: "adx"; period: number }
  | { kind: "dmi"; diLen: number; adxSmooth: number; part: "+di" | "-di" | "dx" | "adx" | "adxr" }
  | { kind: "aroon"; period: number; part: "up" | "down" }
  | { kind: "stoch_rsi"; rsiLen: number; stochLen: number; smoothK: number; smoothD: number; part: "k" | "d" }
  | { kind: "ladder_atr"; maType: "sma" | "ema" | "wma" | "hma" | "rma"; maLen: number; mult: number; part: "upper" | "lower" }
  | { kind: "chandelier"; length: number; atrLen: number; mult: number; part: "long" | "short" }
  | { kind: "atr_ts"; atrPeriod: number; hhvPeriod: number; mult: number }
  | { kind: "psar"; start: number; increment: number; max: number }
  | { kind: "cpr"; part: "pivot" | "tc" | "bc" }
  | { kind: "ichimoku"; tenkan: number; kijun: number; senkouB: number; displacement: number; part: "tenkan" | "kijun" | "senkou_a" | "senkou_b" | "chikou" }
  | { kind: "vwma"; period: number }
  | { kind: "keltner"; period: number; mult: number; part: "upper" | "mid" | "lower" }
  | { kind: "stoch"; period: number; smoothK: number; smooth: number; part: "k" | "d" }
  | { kind: "obv"; smoothType: "SMA" | "EMA" | "SMMA" | "WMA"; smoothLen: number; part: "obv" | "signal" }
  | { kind: "cmf"; period: number }
  | { kind: "dpo"; period: number }
  | { kind: "trad_pivot"; part: PivotPart }
  | { kind: "fib_pivot"; part: PivotPart }
  | { kind: "woodie_pivot"; part: PivotPart }
  | { kind: "classic_pivot"; part: PivotPart }
  | { kind: "pattern"; name: "doji" | "hammer" | "inverted_hammer" | "gravestone" | "bullish_engulfing" | "bearish_engulfing" }
  | { kind: "number"; value: number }
  | { kind: "bracket"; expr: Expr };

// Expression tree: a leaf indicator (with timeframe, candle source & daysAgo) OR an arithmetic combination
export type Expr =
  | { type: "leaf"; tf: Timeframe; candle: CandleKind; daysAgo: number; ind: LeafIndicator }
  | { type: "binop"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr };

// Simplified source expression for MA inputs: a plain leaf OR a binary combination of two leaves.
// No timeframe/candle/daysAgo needed here — those are inherited from the enclosing Expr.
export type SrcExpr =
  | LeafIndicator
  | { type: "srcBinop"; op: string; a: LeafIndicator; b: SrcExpr };

export interface Condition {
  id: string;
  left: Expr;
  op: Operator;
  right: Expr;
  enabled?: boolean;
  logicOp?: "and" | "or";
}

export interface ScanResult {
  symbol: string;
  close: number;
  changePct: number;
  volume: number;
  date: string;
  weeklyBars: number;
  dailyBars: number;
  strike?: number;  // option strike for the matched bar (options mode only)
  expiry?: string;  // YYYY-MM-DD expiry of the option contract (options mode only)
  oi?: number;      // open interest for the matched bar (options mode only)
}

// ===== Sub-Filter / Group types =====

export type LogicMode = "all" | "any1" | "any2" | "any3" | "any4" | "any5";

export interface ConditionGroup {
  id: string;
  type: "group";
  logicMode: LogicMode;
  conditions: FilterItem[];
  enabled?: boolean;
}

/** A top-level filter item is either a plain Condition or a ConditionGroup */
export type FilterItem = Condition | ConditionGroup;

export function isGroup(item: FilterItem | undefined | null): item is ConditionGroup {
  return item != null && (item as ConditionGroup).type === "group";
}

export function newGroup(overrides?: Partial<ConditionGroup>): ConditionGroup {
  return {
    id: crypto.randomUUID(),
    type: "group",
    logicMode: "any1",
    conditions: [],
    ...overrides,
  };
}

/** Flatten a FilterItem[] into a plain Condition[] recursively (used for bar-count checks, etc.) */
export function flattenItems(items: FilterItem[]): Condition[] {
  return items.flatMap(item => isGroup(item) ? flattenItems(item.conditions) : [item]);
}

/** Returns true if a FilterItem[] has at least one active (enabled) leaf condition */
function hasActiveLeaf(items: FilterItem[]): boolean {
  return items.some(item =>
    isGroup(item)
      ? (item.enabled !== false && hasActiveLeaf(item.conditions))
      : item.enabled !== false
  );
}

function evaluateWithLogicMode(
  items: FilterItem[],
  logicMode: LogicMode,
  evaluate: (c: Condition) => boolean,
): boolean {
  const active = items.filter(item =>
    isGroup(item) ? (item.enabled !== false && hasActiveLeaf(item.conditions)) : item.enabled !== false,
  );
  if (!active.length) return false;
  const n = logicMode === "all" ? active.length : parseInt(logicMode.replace("any", ""));
  const clampedN = Math.min(n, active.length);
  let passed = 0;
  for (const item of active) {
    const itemPassed = isGroup(item)
      ? evaluateWithLogicMode(item.conditions, item.logicMode, evaluate)
      : evaluate(item);
    if (itemPassed) passed++;
    if (logicMode !== "all" && passed >= clampedN) return true;
  }
  return logicMode === "all" ? passed === active.length : passed >= clampedN;
}

/**
 * Evaluate a FilterItem[] using the given top-level LogicMode.
 * Empty groups and disabled conditions are ignored. Returns false if no active items.
 */
export function evaluateFilterItems(
  items: FilterItem[],
  topLogicMode: LogicMode,
  evaluate: (c: Condition) => boolean,
): boolean {
  // Exclude disabled plain conditions AND groups with no active leaves — same
  // filter as evaluateWithLogicMode so the active set is consistent.
  const active = items.filter(item =>
    isGroup(item) ? (item.enabled !== false && hasActiveLeaf(item.conditions)) : item.enabled !== false,
  );
  if (!active.length) return false;

  const n = topLogicMode === "all" ? active.length : parseInt(topLogicMode.replace("any", ""));
  const clampedN = Math.min(n, active.length);
  let passed = 0;

  for (const item of active) {
    // active already excludes disabled conditions, so no extra guard needed here.
    const itemPassed = isGroup(item)
      ? evaluateWithLogicMode(item.conditions, item.logicMode, evaluate)
      : evaluate(item);
    if (itemPassed) passed++;
    if (topLogicMode !== "all" && passed >= clampedN) return true;
  }
  return topLogicMode === "all" ? passed === active.length : passed >= clampedN;
}

// ===== Per-symbol evaluator with caching =====
class SymbolEval {
  // Cache: key = tf|candle|JSON(LeafIndicator) -> series aligned to its tf bar indices
  private cache = new Map<string, Array<number | undefined> | boolean[]>();
  // Cache bars per (tf,candle); dayMap is shared per tf (independent of candle)
  private tfBars = new Map<string, Bar[]>();
  private dayToTfIdx = new Map<string, number[]>();

  constructor(public hist: SymbolHistory) {
    this.tfBars.set("daily|regular", hist.bars);
    const map = new Array(hist.bars.length);
    for (let i = 0; i < hist.bars.length; i++) map[i] = i;
    this.dayToTfIdx.set("daily", map);
  }

  private getTf(tf: Timeframe, candle: CandleKind): { bars: Bar[]; dayMap: number[] } {
    if (isIntradayTf(tf as string)) {
      return { bars: [], dayMap: new Array(this.hist.bars.length).fill(0) };
    }
    const key = `${tf}|${candle}`;
    if (!this.tfBars.has(key)) {
      // Ensure regular tf bars + dayMap exist first.
      // dayMap is authored by resampleBars (it sees every daily bar's bucket
      // assignment as it builds the buckets), so each daily index correctly
      // points at its containing bucket — including mid-bucket days.
      const regKey = `${tf}|regular`;
      if (!this.tfBars.has(regKey)) {
        const { bars: rb, dayMap } = resampleBars(this.hist.bars, tf);
        this.tfBars.set(regKey, rb);
        if (!this.dayToTfIdx.has(tf)) this.dayToTfIdx.set(tf, dayMap);
      }
      if (candle === "ha") {
        this.tfBars.set(key, toHeikinAshi(this.tfBars.get(regKey)!));
      }
    }
    return { bars: this.tfBars.get(key)!, dayMap: this.dayToTfIdx.get(tf)! };
  }

  private leafSeries(ind: LeafIndicator, tf: Timeframe, candle: CandleKind): Array<number | undefined> | boolean[] {
    const key = tf + "|" + candle + "|" + JSON.stringify(ind);
    const c = this.cache.get(key);
    if (c) return c;
    const { bars } = this.getTf(tf, candle);
    // Volume-weighted indicators (VWAP, VWMA, MFI, OBV, CMF) must use the
    // *real* traded prices — feeding them Heikin-Ashi (smoothed/synthesized)
    // OHLC alongside actual traded volume produces meaningless numbers,
    // because HA prices aren't prices anything actually traded at. Always
    // resolve them against the regular-candle bars at this timeframe.
    const volBars = candle === "ha" ? this.getTf(tf, "regular").bars : bars;
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    // Resolve a LeafIndicator to a number series, mapping undefined → 0.
    // Used by srcArr for arithmetic binop chains where we need a concrete number.
    const resolveLeaf = (leaf: LeafIndicator): number[] => {
      if (leaf.kind === "close") return closes;
      const s = this.leafSeries(leaf, tf, candle) as Array<number | undefined>;
      return s.map((v) => v ?? 0);
    };
    // Resolve a SrcExpr (plain leaf OR recursive srcBinop chain) to a number[].
    // undefined values become 0 here — used only where a concrete number[] is
    // required (e.g. arithmetic binop operands).  MA cases use rawSrcArr instead.
    const srcArr = (src?: SrcExpr): number[] => {
      if (!src) return closes;
      if ("type" in src && src.type === "srcBinop") {
        const a = resolveLeaf(src.a);
        const b = srcArr(src.b); // recursive — supports unlimited chain depth
        return a.map((v, i) => {
          const bv = b[i] ?? 0;
          switch (src.op) {
            case "+": return v + bv;
            case "-": return v - bv;
            case "*": return v * bv;
            case "/": return bv === 0 ? 0 : v / bv;
            default: return v;
          }
        });
      }
      return resolveLeaf(src as LeafIndicator);
    };
    // Like srcArr but preserves `undefined` (indicator warm-up) instead of
    // replacing with 0.  MA cases (ema, sma, …) use this so the moving average
    // only starts computing from the first bar where the source is defined —
    // matching TradingView / Chartink: EMA(RSI(14),14) on weekly produces its
    // first output at bar 27 (14 RSI warm-up + 14 EMA warm-up), not at bar 13.
    const rawSrcArr = (src?: SrcExpr): (number | undefined)[] => {
      if (!src) return closes;
      if ("type" in src && src.type === "srcBinop") {
        const a = this.leafSeries(src.a, tf, candle) as (number | undefined)[];
        const b = rawSrcArr(src.b);
        return a.map((v, i) => {
          const bv = b[i];
          if (v === undefined || bv === undefined) return undefined;
          switch (src.op) {
            case "+": return v + bv;
            case "-": return v - bv;
            case "*": return v * bv;
            case "/": return bv === 0 ? undefined : v / bv;
            default: return v;
          }
        });
      }
      return this.leafSeries(src as LeafIndicator, tf, candle) as (number | undefined)[];
    };
    // Compute a moving-average function starting only from the first bar where
    // the source series becomes defined.  Pads the beginning with `undefined`.
    const maFromStart = (
      raw: (number | undefined)[],
      fn: (src: number[]) => (number | undefined)[]
    ): (number | undefined)[] => {
      const firstValid = raw.findIndex(v => v !== undefined);
      if (firstValid < 0) return new Array(raw.length).fill(undefined);
      const slice = raw.slice(firstValid).map(v => v ?? 0);
      const result = fn(slice);
      return firstValid === 0 ? result : [...new Array(firstValid).fill(undefined), ...result];
    };
    let v: Array<number | undefined> | boolean[];
    switch (ind.kind) {
      case "open": v = bars.map((b) => b.open); break;
      case "high": v = highs; break;
      case "low": v = lows; break;
      case "close": v = closes; break;
      case "volume": v = bars.map((b) => b.volume); break;
      case "prev_close": v = bars.map((b) => b.prevClose); break;
      case "change_pct": v = bars.map((b) => (b.prevClose ? ((b.close - b.prevClose) / b.prevClose) * 100 : 0)); break;
      case "hl2":   v = bars.map((b) => (b.high + b.low) / 2); break;
      case "hlc3":  v = bars.map((b) => (b.high + b.low + b.close) / 3); break;
      case "ohlc4": v = bars.map((b) => (b.open + b.high + b.low + b.close) / 4); break;
      case "price":
        if (ind.field === "open") v = bars.map((b) => b.open);
        else if (ind.field === "high") v = highs;
        else if (ind.field === "low") v = lows;
        else if (ind.field === "close") v = closes;
        else if (ind.field === "volume") v = bars.map((b) => b.volume);
        else if (ind.field === "prev_close") v = bars.map((b) => b.prevClose);
        else v = bars.map((b) => (b.prevClose ? ((b.close - b.prevClose) / b.prevClose) * 100 : 0));
        break;
      case "sma": v = maFromStart(rawSrcArr(ind.source), s => sma(s, ind.period)); break;
      case "ema": v = maFromStart(rawSrcArr(ind.source), s => ema(s, ind.period)); break;
      case "wma": v = maFromStart(rawSrcArr(ind.source), s => wma(s, ind.period)); break;
      case "rsi": v = rsi(closes, ind.period); break;
      case "williams_r": v = williamsR(bars, ind.period); break;
      case "cci": v = cci(bars, ind.period); break;
      case "atr": v = atr(bars, ind.period); break;
      case "high_n": v = rollingMax(highs, ind.period); break;
      case "low_n": v = rollingMin(lows, ind.period); break;
      case "macd": { const m = macd(closes, ind.fast, ind.slow, ind.signal); v = m[ind.part]; break; }
      case "bbands": {
        const b = bollinger(closes, ind.period, ind.mult);
        v = ind.part === "upper" ? b.upper : ind.part === "lower" ? b.lower : b.mid;
        break;
      }
      case "bb_pctb": {
        const b = bollinger(closes, ind.period, ind.mult);
        v = closes.map((c, i) => {
          const u = b.upper[i], l = b.lower[i];
          if (u === undefined || l === undefined) return undefined;
          const denom = (u as number) - (l as number);
          return denom === 0 ? 0 : (c - (l as number)) / denom;
        });
        break;
      }
      case "donchian": {
        if (ind.part === "upper") v = donchianUpper(bars, ind.period);
        else if (ind.part === "lower") v = donchianLower(bars, ind.period);
        else v = donchianMiddle(bars, ind.period);
        break;
      }
      case "supertrend": v = supertrend(bars, ind.period, ind.mult); break;
      case "halftrend": v = halftrend(bars, ind.amplitude, ind.channel); break;
      case "halftrend_bull": v = halftrendBull(bars, ind.amplitude, ind.channel); break;
      case "halftrend_bear": v = halftrendBear(bars, ind.amplitude, ind.channel); break;
      case "camarilla": v = camarilla(bars, ind.level, ind.side); break;
      case "alma": v = maFromStart(rawSrcArr(ind.source), s => alma(s, ind.period, ind.offset, ind.sigma)); break;
      case "hma": v = maFromStart(rawSrcArr(ind.source), s => hma(s, ind.period)); break;
      case "vwap": v = vwap(volBars, ind.period); break;
      case "mfi": v = mfi(volBars, ind.period); break;
      case "adx": v = adx(bars, ind.period); break;
      case "dmi": {
        const d = dmi(bars, ind.diLen, ind.adxSmooth);
        if (ind.part === "+di") v = d.plusDI;
        else if (ind.part === "-di") v = d.minusDI;
        else if (ind.part === "dx") v = d.dxSeries;
        else if (ind.part === "adxr") v = d.adxr;
        else v = d.adxSeries;
        break;
      }
      case "kama": v = maFromStart(rawSrcArr(ind.source), s => kama(s, ind.period)); break;
      case "smma": v = maFromStart(rawSrcArr(ind.source), s => smma(s, ind.period)); break;
      case "lsma": v = maFromStart(rawSrcArr(ind.source), s => lsma(s, ind.length, ind.offset)); break;
      case "hamming": v = maFromStart(rawSrcArr(ind.source), s => hammingMa(s, ind.period)); break;
      case "jma": v = maFromStart(rawSrcArr(ind.source), s => jma(s, ind.length, ind.phase, ind.power)); break;
      case "mac": { const m = mac(bars, ind.upperLen, ind.lowerLen, ind.upperOffset, ind.lowerOffset); v = ind.part === "lower" ? m.lower : m.upper; break; }
      case "aroon": { const a = aroon(bars, ind.period); v = ind.part === "down" ? a.down : a.up; break; }
      case "ladder_atr": { const la = ladderAtr(bars, ind.maType, ind.maLen, ind.mult); v = ind.part === "lower" ? la.lower : la.upper; break; }
      case "chandelier": { const c = chandelier(bars, ind.length, ind.atrLen, ind.mult); v = ind.part === "short" ? c.short : c.long; break; }
      case "atr_ts": v = atrTrailingStop(bars, ind.atrPeriod, ind.hhvPeriod, ind.mult); break;
      case "stoch_rsi": { const sr = stochRsi(bars, ind.rsiLen, ind.stochLen, ind.smoothK, ind.smoothD); v = ind.part === "d" ? sr.d : sr.k; break; }
      case "psar": v = psar(bars, ind.start, ind.increment, ind.max); break;
      case "cpr": v = cpr(bars, ind.part); break;
      case "ichimoku": v = ichimoku(bars, ind.part, ind.tenkan, ind.kijun, ind.senkouB, ind.displacement); break;
      case "vwma": v = vwma(volBars, ind.period); break;
      case "keltner": {
        const k = keltner(bars, ind.period, ind.mult);
        v = ind.part === "upper" ? k.upper : ind.part === "lower" ? k.lower : k.mid;
        break;
      }
      case "stoch": {
        const s = stochastic(bars, ind.period, ind.smoothK, ind.smooth);
        v = ind.part === "d" ? s.d : s.k;
        break;
      }
      case "obv": { const o = obv(volBars, ind.smoothType, ind.smoothLen); v = ind.part === "signal" ? o.signal : o.obvSeries; break; }
      case "cmf": v = cmf(volBars, ind.period); break;
      case "dpo": v = dpo(closes, ind.period); break;
      case "trad_pivot": v = pivot(bars, "traditional" as PivotFamily, ind.part); break;
      case "fib_pivot": v = pivot(bars, "fibonacci" as PivotFamily, ind.part); break;
      case "woodie_pivot": v = pivot(bars, "woodie" as PivotFamily, ind.part); break;
      case "classic_pivot": v = pivot(bars, "classic" as PivotFamily, ind.part); break;
      case "pattern": {
        const arr: boolean[] = new Array(bars.length).fill(false);
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i];
          const p = i > 0 ? bars[i - 1] : null;
          if (ind.name === "doji") arr[i] = patterns.doji(b);
          else if (ind.name === "hammer") arr[i] = patterns.hammer(b);
          else if (ind.name === "inverted_hammer") arr[i] = patterns.invertedHammer(b);
          else if (ind.name === "gravestone") arr[i] = patterns.gravestoneDoji(b);
          else if (ind.name === "bullish_engulfing") arr[i] = !!p && patterns.bullishEngulfing(p, b);
          else if (ind.name === "bearish_engulfing") arr[i] = !!p && patterns.bearishEngulfing(p, b);
        }
        v = arr;
        break;
      }
      case "number": v = new Array(bars.length).fill(ind.value); break;
      case "bracket": {
        // `bars` is the TF-resampled bar array (e.g. 52 weekly bars).
        // `i` here is a TF bar index, NOT a daily bar index.
        // evalExpr expects a daily bar index, so we must convert: build a
        // reverse map from each TF bar index to the last daily bar that falls
        // in that bucket.  "Last" = the bar at which the TF candle closes,
        // which is how every other series in leafSeries represents the value.
        // For daily TF dayMap[di] === di, so tfToDailyLast[i] === i —
        // identical to the old behaviour, fully backward-compatible.
        const { dayMap } = this.getTf(tf, candle);
        const tfToDailyLast = new Array<number>(bars.length).fill(-1);
        for (let di = 0; di < dayMap.length; di++) {
          tfToDailyLast[dayMap[di]] = di; // last assignment wins → last daily bar in bucket
        }
        const bArr: (number | undefined)[] = new Array(bars.length).fill(undefined);
        for (let i = 0; i < bars.length; i++) {
          const di = tfToDailyLast[i];
          if (di >= 0) bArr[i] = this.evalExpr(ind.expr, di);
        }
        v = bArr;
        break;
      }
    }
    this.cache.set(key, v);
    return v;
  }

  // Evaluate an expression at a given DAILY bar index. Returns scalar or undefined.
  // dayShift  = additional offset applied in DAILY bar space (legacy, kept for compatibility).
  // tfShift   = additional offset applied in TIMEFRAME bar space AFTER the dayMap lookup.
  //             Use tfShift = -1 for crossover "previous" comparisons so that higher
  //             timeframes (Weekly/Monthly/etc.) correctly step back one TF bar rather than
  //             one daily bar.  For Daily, dayMap[i] === i, so tfShift = -1 is identical
  //             to dayShift = -1 — fully backward-compatible.
  evalExpr(expr: Expr, dailyIdx: number, dayShift = 0, tfShift = 0): number | undefined {
    if (expr.type === "leaf") {
      const { dayMap } = this.getTf(expr.tf, expr.candle);
      // For non-daily timeframes, "daysAgo" means N timeframe-units ago.
      const di = dailyIdx + dayShift;
      if (di < 0 || di >= dayMap.length) return undefined;
      const tfIdx = dayMap[di] - expr.daysAgo + tfShift;
      if (tfIdx < 0) return undefined;
      const series = this.leafSeries(expr.ind, expr.tf, expr.candle);
      const v = (series as Array<number | undefined>)[tfIdx];
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    }
    const a = this.evalExpr(expr.a, dailyIdx, dayShift, tfShift);
    const b = this.evalExpr(expr.b, dailyIdx, dayShift, tfShift);
    if (a === undefined || b === undefined) return undefined;
    switch (expr.op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b === 0 ? undefined : a / b;
    }
  }

  // Pattern shortcut: if left is a leaf pattern + op == / != / >= true, treat as boolean
  evalCondition(c: Condition, atDailyIdx: number): boolean {
    if (c.op === "") return true;
    if (c.left.type === "leaf" && c.left.ind.kind === "pattern") {
      const v = this.evalExpr(c.left, atDailyIdx);
      const want = c.op === "==" || c.op === ">=" || c.op === ">" || c.op === "!=" ? (c.op === "!=" ? 0 : 1) : 1;
      return v === want;
    }
    const a = this.evalExpr(c.left, atDailyIdx);
    const b = this.evalExpr(c.right, atDailyIdx);
    if (c.op === "crossed_above" || c.op === "crossed_below") {
      // Use tfShift = -1 (not dayShift = -1) so the "previous" sample always steps
      // back one *timeframe* bar.  With dayShift = -1, two daily bars inside the
      // same Weekly/Monthly bucket would resolve to the identical weekly bar index,
      // making crossed_above / crossed_below impossible to detect mid-week.
      const aP = this.evalExpr(c.left, atDailyIdx, 0, -1);
      // Always compare both bars against the *current* reference value (b).
      // Using bP (previous TF bar's reference) causes false cross signals at
      // timeframe boundaries: e.g. when a weekly pivot drops significantly on
      // the new week, the price can appear to "cross above" it even though
      // price actually fell — because aP <= bP (old high pivot) && a > b (new
      // low pivot) is trivially true. Anchoring both sides to b ensures the
      // signal only fires when price genuinely moved through the current level.
      if (a === undefined || b === undefined || aP === undefined) return false;
      if (c.op === "crossed_above") return aP <= b && a > b;
      return aP >= b && a < b;
    }
    if (a === undefined || b === undefined) return false;
    switch (c.op) {
      case ">": return a > b;
      case "<": return a < b;
      case ">=": return a >= b;
      case "<=": return a <= b;
      case "==": return a === b;
      case "!=": return a !== b;
    }
  }
}

// ── Minimum-bars helpers ─────────────────────────────────────────────────────
// These are exported so the UI can warn when a stock doesn't have enough
// timeframe-bars for a condition's indicators to be reliable.

function _minBarsForSrc(src?: SrcExpr): number {
  if (!src) return 1;
  if ("type" in src && src.type === "srcBinop")
    return Math.max(minBarsForLeaf(src.a), _minBarsForSrc(src.b));
  return minBarsForLeaf(src as LeafIndicator);
}

export function minBarsForLeaf(ind: LeafIndicator): number {
  switch (ind.kind) {
    case "sma": case "ema": case "wma": case "smma":
    case "alma": case "hma": case "kama": case "hamming":
      return _minBarsForSrc((ind as {source?:SrcExpr}).source) + ind.period - 1;
    case "lsma": return _minBarsForSrc((ind as {source?:SrcExpr}).source) + ind.length - 1;
    case "jma":  return _minBarsForSrc((ind as {source?:SrcExpr}).source) + ind.length - 1;
    case "rsi":  return ind.period + 1;
    case "macd": return ind.slow + ind.signal;
    case "cci": case "williams_r": return ind.period + 1;
    case "atr":  return ind.period + 1;
    case "bbands": case "bb_pctb": return ind.period;
    case "donchian": case "high_n": case "low_n": return ind.period;
    case "supertrend": return ind.period * 3;
    case "halftrend": case "halftrend_bull": case "halftrend_bear": return ind.amplitude * 3;
    case "adx":  return ind.period * 3;
    case "dmi":  return ind.diLen + ind.adxSmooth;
    case "stoch_rsi": return ind.rsiLen + ind.stochLen + ind.smoothK + ind.smoothD;
    case "ichimoku": return Math.max(ind.senkouB, ind.kijun) + ind.displacement;
    case "psar": return 3;
    case "vwap": case "mfi": case "vwma": case "cmf": return ind.period + 1;
    case "obv":  return ind.smoothLen * 2;
    case "aroon": return ind.period + 1;
    case "stoch": return ind.period + ind.smoothK + ind.smooth;
    case "ladder_atr": return ind.maLen * 2;
    case "chandelier": return Math.max(ind.length, ind.atrLen) * 2;
    case "atr_ts": return Math.max(ind.atrPeriod, ind.hhvPeriod) * 2;
    case "keltner": return ind.period * 2;
    case "dpo":  return ind.period + 1;
    case "mac":  return Math.max(ind.upperLen, ind.lowerLen) * 2;
    case "bracket": return minBarsForExpr(ind.expr);
    default: return 1;
  }
}

export function minBarsForExpr(expr: Expr): number {
  if (expr.type === "binop") return Math.max(minBarsForExpr(expr.a), minBarsForExpr(expr.b));
  // Bracket: recurse into inner expression, add the bracket's own daysAgo offset.
  if (expr.ind.kind === "bracket") return minBarsForExpr(expr.ind.expr) + expr.daysAgo;
  // Plain leaf: warmup bars for the indicator + any lookback offset.
  return minBarsForLeaf(expr.ind) + expr.daysAgo;
}

/** Returns the minimum TF-bars required across all enabled conditions that
 *  use the given timeframe.  Returns 0 if no condition uses that TF. */
export function requiredBarsForTf(items: FilterItem[], tf: Timeframe): number {
  const conditions = flattenItems(items);
  let max = 0;
  let hasCrossover = false;
  for (const c of conditions) {
    if (c.enabled === false) continue;
    const walk = (expr: Expr): void => {
      if (expr.type === "binop") { walk(expr.a); walk(expr.b); return; }
      // Recurse into bracket's inner expression (the bracket's own tf/daysAgo
      // are effectively the outer frame; the inner leaves carry their own tf).
      if (expr.ind.kind === "bracket") { walk(expr.ind.expr); return; }
      if (expr.tf === tf) max = Math.max(max, minBarsForLeaf(expr.ind) + expr.daysAgo);
    };
    walk(c.left);
    walk(c.right);
    if (c.op === "crossed_above" || c.op === "crossed_below") hasCrossover = true;
  }
  return max > 0 ? max + (hasCrossover ? 1 : 0) : 0;
}
// ─────────────────────────────────────────────────────────────────────────────

export function runScan(
  histories: SymbolHistory[],
  items: FilterItem[],
  opts: { series?: string[]; minVolume?: number; atDailyIdxFromEnd?: number; asOfDate?: string; logicMode?: LogicMode } = {},
): ScanResult[] {
  const seriesFilter = opts.series && opts.series.length ? new Set(opts.series) : null;
  const offset = opts.atDailyIdxFromEnd ?? 0;

  // Determine the global "as of" date: the most common "last bar date" across all symbols,
  // shifted back by `offset` distinct trading days. Using the mode (not absolute max) makes
  // this robust to stray future-dated rows or single bad files.
  let asOf = opts.asOfDate;
  if (!asOf) {
    const lastDateCounts = new Map<string, number>();
    for (const h of histories) {
      if (!h.bars.length) continue;
      const d = h.bars[h.bars.length - 1].date;
      lastDateCounts.set(d, (lastDateCounts.get(d) ?? 0) + 1);
    }
    if (!lastDateCounts.size) return [];
    // Pick the date with the highest count (mode). Ties: most recent wins.
    let bestDate = "";
    let bestCount = -1;
    for (const [d, c] of lastDateCounts) {
      if (c > bestCount || (c === bestCount && d > bestDate)) {
        bestDate = d;
        bestCount = c;
      }
    }
    if (offset > 0) {
      // Walk back `offset` distinct trading days using the union of all bar dates.
      const dates = new Set<string>();
      for (const h of histories) for (const b of h.bars) dates.add(b.date);
      const sorted = Array.from(dates).sort();
      const i = sorted.indexOf(bestDate);
      const target = i - offset;
      if (target < 0) return [];
      bestDate = sorted[target];
    }
    asOf = bestDate;
  }

  const out: ScanResult[] = [];
  for (const h of histories) {
    if (seriesFilter && !seriesFilter.has(h.series)) continue;
    if (h.bars.length < 2) continue;
    // Find the bar matching the as-of date. For offset === 0 this is the
    // symbol's most recent bar; for past dates we binary-search so historical
    // pillars in the backtest chart resolve to the correct day's results
    // (instead of always comparing against the symbol's latest bar).
    let idx: number;
    // Fast-path: no explicit asOfDate and no offset means we just want the
    // symbol's very last bar. When an explicit asOfDate is given (e.g.
    // Historical mode), we must binary-search so older bars are matched.
    if (offset === 0 && !opts.asOfDate) {
      idx = h.bars.length - 1;
      if (h.bars[idx].date !== asOf) continue;
    } else {
      let lo = 0, hi = h.bars.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const md = h.bars[mid].date;
        if (md === asOf) { found = mid; break; }
        if (md < asOf) lo = mid + 1; else hi = mid - 1;
      }
      if (found < 1) continue;
      idx = found;
    }
    const last = h.bars[idx];
    if (opts.minVolume !== undefined && last.volume < opts.minVolume) continue;
    // When scanning a historical date, truncate bars to [0..idx] so that higher-
    // timeframe resampled bars (weekly/monthly/quarterly) are built only from data
    // that existed on the scan date — preventing lookahead bias.
    const histForEval = opts.asOfDate ? { ...h, bars: h.bars.slice(0, idx + 1) } : h;
    const ev = new SymbolEval(histForEval);
    const pass = evaluateFilterItems(items, opts.logicMode ?? "all", (c) => {
      try { return ev.evalCondition(c, idx); } catch { return false; }
    });
    if (pass) {
      out.push({
        symbol: h.symbol,
        close: last.close,
        changePct: last.prevClose ? ((last.close - last.prevClose) / last.prevClose) * 100 : 0,
        volume: last.volume,
        date: last.date,
        // Approximate weekly-bar count (daily bars ÷ 5) — used by the UI to
        // warn when a stock may not have enough history for weekly indicators.
        weeklyBars: Math.round(h.bars.length / 5),
        dailyBars: h.bars.length,
        strike: last.strike,
        expiry: h.expiry,
        oi: last.oi,
      });
    }
  }
  return out;
}

// Run the same scan across the last N daily bars; return matches per day.
export function runBacktest(
  histories: SymbolHistory[],
  items: FilterItem[],
  days: number,
  opts: { series?: string[]; asOfDate?: string; logicMode?: LogicMode } = {},
): { date: string; matches: number }[] {
  // Collect distinct trading dates from longest history
  const dates = new Set<string>();
  for (const h of histories) for (const b of h.bars) dates.add(b.date);
  let sortedDates = Array.from(dates).sort();
  // When running in historical mode, cap the timeline to dates ≤ asOfDate so
  // the backtest window ends at (or before) the chosen historical date.
  if (opts.asOfDate) sortedDates = sortedDates.filter((d) => d <= opts.asOfDate!);
  const recent = sortedDates.slice(-days);
  const out: { date: string; matches: number }[] = [];
  for (const d of recent) {
    let matches = 0;
    const seriesFilter = opts.series && opts.series.length ? new Set(opts.series) : null;
    for (const h of histories) {
      if (seriesFilter && !seriesFilter.has(h.series)) continue;
      // Exact-date binary search; skip symbols that didn't trade on this date.
      let lo = 0, hi = h.bars.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (h.bars[mid].date === d) { idx = mid; break; }
        if (h.bars[mid].date < d) lo = mid + 1; else hi = mid - 1;
      }
      if (idx < 1) continue;
      // Truncate bars to [0..idx] to prevent lookahead bias in higher-timeframe bars.
      const histForEval = { ...h, bars: h.bars.slice(0, idx + 1) };
      const ev = new SymbolEval(histForEval);
      const pass = evaluateFilterItems(items, opts.logicMode ?? "all", (c) => {
        try { return ev.evalCondition(c, idx); } catch { return false; }
      });
      if (pass) matches++;
    }
    out.push({ date: d, matches });
  }
  return out;
}

// ===== Helpers =====
export function leafLabel(ind: LeafIndicator): string {
  switch (ind.kind) {
    case "price": return ind.field;
    case "open": return "Open";
    case "high": return "High";
    case "low": return "Low";
    case "close": return "Close";
    case "volume": return "Volume";
    case "prev_close": return "Prev Close";
    case "change_pct": return "% Change";
    case "hl2":   return "HL2";
    case "hlc3":  return "HLC3";
    case "ohlc4": return "OHLC4";
    case "sma": return `SMA(${ind.period})`;
    case "ema": return `EMA(${ind.period})`;
    case "wma": return `WMA(${ind.period})`;
    case "rsi": return `RSI(${ind.period})`;
    case "williams_r": return `Williams%R(${ind.period})`;
    case "cci": return `CCI(${ind.period})`;
    case "atr": return `ATR(${ind.period})`;
    case "high_n": return `High(${ind.period})`;
    case "low_n": return `Low(${ind.period})`;
    case "macd": return `MACD(${ind.fast},${ind.slow},${ind.signal}) ${ind.part}`;
    case "bbands": return `BB(${ind.period},${ind.mult}) ${ind.part}`;
    case "bb_pctb": return `BB %B(${ind.period},${ind.mult})`;
    case "donchian": return `Donchian(${ind.period}) ${ind.part}`;
    case "supertrend": return `Supertrend(${ind.period},${ind.mult})`;
    case "halftrend": return `Halftrend(${ind.amplitude},${ind.channel})`;
    case "halftrend_bull": return `Halftrend Bull(${ind.amplitude},${ind.channel})`;
    case "halftrend_bear": return `Halftrend Bear(${ind.amplitude},${ind.channel})`;
    case "camarilla": return ind.side === "P" ? "Camarilla P" : `Camarilla ${ind.side}${ind.level}`;
    case "alma": return `ALMA(${ind.period},${ind.offset},${ind.sigma})`;
    case "hma": return `HMA(${ind.period})`;
    case "kama": return `KAMA(${ind.period})`;
    case "smma": return `SMMA(${ind.period})`;
    case "lsma": return `LSMA(${ind.length},${ind.offset})`;
    case "hamming": return `HammingMA(${ind.period})`;
    case "jma": return `JMA(${ind.length},${ind.phase},${ind.power})`;
    case "mac": return `MAC(${ind.upperLen},${ind.lowerLen}) ${ind.part === "upper" ? "Upper" : "Lower"}`;
    case "vwap": return `Rolling VWAP(${ind.period})`;
    case "mfi": return `MFI(${ind.period})`;
    case "adx": return `ADX(${ind.period})`;
    case "dmi": return `DMI(${ind.diLen},${ind.adxSmooth}) ${ind.part.toUpperCase()}`;
    case "aroon": return `Aroon(${ind.period}) ${ind.part === "up" ? "Up" : "Down"}`;
    case "ladder_atr": return `LadderATR(${ind.maType.toUpperCase()},${ind.maLen},${ind.mult}) ${ind.part === "upper" ? "Upper" : "Lower"}`;
    case "chandelier": return `Chandelier(${ind.length},${ind.atrLen},${ind.mult}) ${ind.part === "long" ? "Long" : "Short"}`;
    case "atr_ts": return `ATR TS(${ind.atrPeriod},${ind.hhvPeriod},${ind.mult})`;
    case "stoch_rsi": return `StochRSI(${ind.rsiLen},${ind.stochLen},${ind.smoothK},${ind.smoothD}) ${ind.part === "k" ? "%K" : "%D"}`;
    case "psar": return `PSAR(${ind.start},${ind.increment},${ind.max})`;
    case "cpr": return `CPR ${ind.part}`;
    case "ichimoku": return `Ichimoku ${ind.part}`;
    case "vwma": return `VWMA(${ind.period})`;
    case "keltner": return `Keltner(${ind.period},${ind.mult}) ${ind.part}`;
    case "stoch": return `Stoch(${ind.period},${ind.smoothK},${ind.smooth}) %${ind.part.toUpperCase()}`;
    case "obv": return ind.part === "signal" ? `OBV Signal(${ind.smoothType},${ind.smoothLen})` : `OBV`;
    case "cmf": return `CMF(${ind.period})`;
    case "dpo": return `DPO(${ind.period})`;
    case "trad_pivot": return `Pivot ${ind.part}`;
    case "fib_pivot": return `Fib Pivot ${ind.part}`;
    case "woodie_pivot": return `Woodie ${ind.part}`;
    case "classic_pivot": return `Classic Pivot ${ind.part}`;
    case "pattern": return `Pattern: ${ind.name}`;
    case "number": return String(ind.value);
    case "bracket": return `(${exprLabel(ind.expr)})`;
    default: return (ind as { kind: string }).kind;
  }
}

export function exprLabel(e: Expr): string {
  if (e.type === "leaf") {
    const intraday = isIntradayTf(e.tf as string);
    const candlePrefix = e.candle === "ha" ? "(H-A) " : "(Reg) ";
    let offsetPart = "";
    if (intraday) {
      offsetPart = e.daysAgo === 0 ? " [0]" : ` [-${e.daysAgo}]`;
    } else {
      const unit = TF_UNIT[e.tf] ?? e.tf;
      offsetPart = e.daysAgo > 0 ? ` [${e.daysAgo} ${unit}${e.daysAgo > 1 ? "s" : ""} ago]` : "";
    }
    const tfPrefix = e.tf === "daily" ? "" : e.tf[0].toUpperCase() + e.tf.slice(1) + " ";
    return `${candlePrefix}${tfPrefix}${leafLabel(e.ind)}${offsetPart}`;
  }
  return `(${exprLabel(e.a)} ${e.op} ${exprLabel(e.b)})`;
}

export function newLeafExpr(ind?: LeafIndicator, tf: Timeframe = "daily", candle: CandleKind = "regular"): Expr {
  return { type: "leaf", tf, candle, daysAgo: 0, ind: ind ?? { kind: "close" } };
}

// Backward-compat: ensure any leaf has a candle field (older saved scans).
export function normalizeExpr(e: Expr): Expr {
  if (e.type === "leaf") {
    return { ...e, candle: (e as { candle?: CandleKind }).candle ?? "regular" };
  }
  return { ...e, a: normalizeExpr(e.a), b: normalizeExpr(e.b) };
}
export function normalizeCondition(c: Condition): Condition {
  return { ...c, left: normalizeExpr(c.left), right: normalizeExpr(c.right) };
}

