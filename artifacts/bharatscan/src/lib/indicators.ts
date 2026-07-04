import type { Bar } from "./csv";

// All indicators return an array the same length as the input series, with
// `undefined` in slots where there isn't enough lookback to compute a value.
// `bars` is whichever timeframe + candle source (regular or Heikin-Ashi) the
// caller chose — these functions are completely candle-mode agnostic.

// ---------- Moving averages ----------

export function sma(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Weighted MA — linear weights 1..n (most-recent gets the highest weight).
export function wma(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - period + 1 + j] * (j + 1);
    out[i] = s / denom;
  }
  return out;
}

// Smoothed Moving Average (RMA / Wilder MA) — used by ATR, RSI internally
export function smma(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = ((out[i - 1] as number) * (period - 1) + values[i]) / period;
  }
  return out;
}

export function hma(values: number[], period: number): Array<number | undefined> {
  if (period < 2) return new Array(values.length).fill(undefined);
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtN = Math.max(1, Math.floor(Math.sqrt(period)));
  const w1 = wma(values, half);
  const w2 = wma(values, period);
  const raw: number[] = new Array(values.length).fill(0);
  const ready: boolean[] = new Array(values.length).fill(false);
  for (let i = 0; i < values.length; i++) {
    if (w1[i] !== undefined && w2[i] !== undefined) {
      raw[i] = 2 * (w1[i] as number) - (w2[i] as number);
      ready[i] = true;
    }
  }
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  // Need `sqrtN` consecutive ready samples to start emitting HMA values.
  for (let i = sqrtN - 1; i < values.length; i++) {
    let ok = true;
    let s = 0;
    let denom = 0;
    for (let j = 0; j < sqrtN; j++) {
      const k = i - sqrtN + 1 + j;
      if (!ready[k]) { ok = false; break; }
      const w = j + 1;
      s += raw[k] * w;
      denom += w;
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

// Arnaud Legoux MA. Defaults: period=9, offset=0.85, sigma=6.
//   m = offset * (p - 1);  s = p / sigma
//   w_j = exp(-((j - m)^2) / (2 s^2))
export function alma(values: number[], period: number, offset = 0.85, sigma = 6): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights = new Array(period);
  let wSum = 0;
  for (let j = 0; j < period; j++) {
    const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s));
    weights[j] = w;
    wSum += w;
  }
  if (wSum === 0) return out;
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += weights[j] * values[i - period + 1 + j];
    out[i] = acc / wSum;
  }
  return out;
}

// ---------- Oscillators ----------

// Wilder's RSI (Welles Wilder smoothing).
export function rsi(values: number[], period = 14): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function williamsR(bars: Bar[], period = 14): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    const denom = hh - ll;
    out[i] = denom === 0 ? 0 : ((hh - bars[i].close) / denom) * -100;
  }
  return out;
}

// Commodity Channel Index — uses mean absolute deviation (the standard).
export function cci(bars: Bar[], period = 20): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const smaTp = sma(tp, period);
  for (let i = period - 1; i < bars.length; i++) {
    const m = smaTp[i] as number;
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - m);
    const md = dev / period;
    out[i] = md === 0 ? 0 : (tp[i] - m) / (0.015 * md);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalP = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: Array<number | undefined> = values.map((_, i) =>
    emaFast[i] !== undefined && emaSlow[i] !== undefined ? (emaFast[i] as number) - (emaSlow[i] as number) : undefined,
  );
  const startIdx = line.findIndex((v) => v !== undefined);
  const sig: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (startIdx !== -1) {
    const lineSlice = line.slice(startIdx).map((v) => v as number);
    const sigSlice = ema(lineSlice, signalP);
    for (let i = 0; i < sigSlice.length; i++) sig[startIdx + i] = sigSlice[i];
  }
  const hist = line.map((v, i) => (v !== undefined && sig[i] !== undefined ? v - (sig[i] as number) : undefined));
  return { line, signal: sig, hist };
}

export function rollingMax(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}
export function rollingMin(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

// ---------- Bands & volatility ----------

export function donchianMiddle(bars: Bar[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    out[i] = (hh + ll) / 2;
  }
  return out;
}
export function donchianUpper(bars: Bar[], period: number): Array<number | undefined> {
  return rollingMax(bars.map((b) => b.high), period);
}
export function donchianLower(bars: Bar[], period: number): Array<number | undefined> {
  return rollingMin(bars.map((b) => b.low), period);
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: Array<number | undefined> = new Array(values.length).fill(undefined);
  const lower: Array<number | undefined> = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i] as number;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      s += d * d;
    }
    const sd = Math.sqrt(s / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

// True Range and ATR (Wilder smoothing).
export function trueRange(bars: Bar[]): number[] {
  const tr: number[] = new Array(bars.length).fill(0);
  if (!bars.length) return tr;
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return tr;
}

export function atr(bars: Bar[], period = 14): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  if (bars.length < period + 1) return out;
  const tr = trueRange(bars);
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// ---------- Least Squares Moving Average (LSMA) ----------
// Linear regression value (endpoint) over `length` bars, shifted by `offset`.
// linreg formula: fitted value at bar i = slope*(length-1) + intercept
export function lsma(values: number[], length = 25, offset = 0): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = length - 1; i < n; i++) {
    const src = i - offset;
    if (src < length - 1 || src >= n) continue;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let k = 0; k < length; k++) {
      const x = k;
      const y = values[src - (length - 1 - k)];
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
    }
    const denom = length * sumX2 - sumX * sumX;
    if (denom === 0) { out[i] = values[src]; continue; }
    const slope = (length * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / length;
    out[i] = slope * (length - 1) + intercept;
  }
  return out;
}

// ---------- Moving Average Channel (MAC) ----------
// upper = SMA(high, upperLen) + upperOffset
// lower = SMA(low,  lowerLen) - lowerOffset
export function mac(
  bars: Bar[],
  upperLen = 20,
  lowerLen = 20,
  upperOffset = 0,
  lowerOffset = 0,
): { upper: Array<number | undefined>; lower: Array<number | undefined> } {
  const n = bars.length;
  const upper: Array<number | undefined> = new Array(n).fill(undefined);
  const lower: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = upperLen - 1; i < n; i++) {
    let s = 0;
    for (let j = i - upperLen + 1; j <= i; j++) s += bars[j].high;
    upper[i] = s / upperLen + upperOffset;
  }
  for (let i = lowerLen - 1; i < n; i++) {
    let s = 0;
    for (let j = i - lowerLen + 1; j <= i; j++) s += bars[j].low;
    lower[i] = s / lowerLen - lowerOffset;
  }
  return { upper, lower };
}

// ---------- Jurik Moving Average (JMA) ----------
// Open-source approximation of Jurik's proprietary filter.
//   phaseRatio = clamp(phase, -100, 100) / 100 + 1.5
//   beta  = 0.45*(len-1) / (0.45*(len-1)+2)
//   alpha = beta^power
//   e0[i] = (1-alpha)*src + alpha*e0[i-1]
//   e1[i] = (src-e0[i])*(1-beta) + beta*e1[i-1]
//   e2[i] = (e0[i] + phaseRatio*e1[i] - jma[i-1]) * (1-alpha)^2 + alpha^2 * e2[i-1]
//   jma[i] = e2[i] + jma[i-1]
export function jma(values: number[], length = 7, phase = 50, power = 2): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n === 0) return out;
  const phaseRatio = (Math.max(-100, Math.min(100, phase)) / 100) + 1.5;
  const beta = (0.45 * (length - 1)) / (0.45 * (length - 1) + 2);
  const alpha = Math.pow(beta, power);
  const a2 = alpha * alpha;
  const oa = (1 - alpha);
  const oa2 = oa * oa;
  let e0 = values[0], e1 = 0, e2 = 0, jmaVal = values[0];
  out[0] = jmaVal;
  for (let i = 1; i < n; i++) {
    const src = values[i];
    e0 = (1 - alpha) * src + alpha * e0;
    e1 = (src - e0) * (1 - beta) + beta * e1;
    e2 = (e0 + phaseRatio * e1 - jmaVal) * oa2 + a2 * e2;
    jmaVal = e2 + jmaVal;
    out[i] = jmaVal;
  }
  return out;
}

// ---------- Moving Average Hamming ----------
// Weighted MA using a Hamming window: w[k] = 0.54 − 0.46·cos(2π·k/(N−1))
export function hammingMa(values: number[], period = 10): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n < period) return out;
  const weights: number[] = new Array(period);
  let wSum = 0;
  for (let k = 0; k < period; k++) {
    weights[k] = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (period - 1));
    wSum += weights[k];
  }
  for (let i = period - 1; i < n; i++) {
    let s = 0;
    for (let k = 0; k < period; k++) s += weights[k] * values[i - k];
    out[i] = s / wSum;
  }
  return out;
}

// ---------- Moving Average Adaptive (KAMA) ----------
// Kaufman's Adaptive Moving Average — adapts speed based on Efficiency Ratio
//   ER = |close - close[n]| / Σ|close[i] - close[i-1]|   (n = period)
//   fastSC = 2/(2+1), slowSC = 2/(30+1)
//   SC = (ER*(fastSC-slowSC)+slowSC)²
//   KAMA[i] = KAMA[i-1] + SC*(close[i] - KAMA[i-1])
export function kama(values: number[], period = 10): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n < period + 1) return out;
  const fastSC = 2 / (2 + 1);
  const slowSC = 2 / (30 + 1);
  let prev = values[period - 1];
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    let noise = 0;
    for (let j = i - period + 1; j <= i; j++) noise += Math.abs(values[j] - values[j - 1]);
    const signal = Math.abs(values[i] - values[i - period]);
    const er = noise === 0 ? 0 : signal / noise;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    prev = prev + sc * (values[i] - prev);
    out[i] = prev;
  }
  return out;
}

// ---------- ATR Trailing Stop ----------
// stop[i] = HighestHigh(hhvPeriod)[i] - mult * ATR(atrPeriod)[i]
export function atrTrailingStop(
  bars: Bar[],
  atrPeriod = 5,
  hhvPeriod = 10,
  mult = 2.5,
): Array<number | undefined> {
  const n = bars.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  const atrArr = atr(bars, atrPeriod);
  const lookback = Math.max(atrPeriod, hhvPeriod);
  for (let i = lookback - 1; i < n; i++) {
    const a = atrArr[i];
    if (a === undefined) continue;
    let hh = -Infinity;
    for (let j = i - hhvPeriod + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
    }
    out[i] = hh - mult * a;
  }
  return out;
}

// ---------- Chandelier Exit ----------
// Long stop  = Highest High(length) − mult × ATR(atrLen)
// Short stop = Lowest Low(length)   + mult × ATR(atrLen)
export function chandelier(
  bars: Bar[],
  length = 22,
  atrLen = 22,
  mult = 3,
): { long: Array<number | undefined>; short: Array<number | undefined> } {
  const n = bars.length;
  const atrArr = atr(bars, atrLen);
  const long: Array<number | undefined> = new Array(n).fill(undefined);
  const short: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = length - 1; i < n; i++) {
    const a = atrArr[i];
    if (a === undefined) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low  < ll) ll = bars[j].low;
    }
    long[i]  = hh - mult * a;
    short[i] = ll + mult * a;
  }
  return { long, short };
}

// ---------- Ladder ATR ----------
// MA(close, maLen) ± mult * ATR(maLen) → sticky upper/lower bands
// MA types: sma | ema | wma | hma | rma
export function ladderAtr(
  bars: Bar[],
  maType: "sma" | "ema" | "wma" | "hma" | "rma" = "hma",
  maLen = 7,
  mult = 4,
): { upper: Array<number | undefined>; lower: Array<number | undefined> } {
  const n = bars.length;
  const empty = () => new Array(n).fill(undefined) as Array<number | undefined>;
  const closes = bars.map((b) => b.close);
  let maArr: Array<number | undefined>;
  if (maType === "ema")      maArr = ema(closes, maLen);
  else if (maType === "wma") maArr = wma(closes, maLen);
  else if (maType === "hma") maArr = hma(closes, maLen);
  else if (maType === "rma") maArr = smma(closes, maLen);
  else                        maArr = sma(closes, maLen);
  const atrArr = atr(bars, maLen);
  const upper = empty();
  const lower = empty();
  for (let i = 1; i < n; i++) {
    const m = maArr[i], a = atrArr[i];
    if (m === undefined || a === undefined) continue;
    const bu = m + mult * a;
    const bl = m - mult * a;
    const prevU = (upper[i - 1] ?? bu) as number;
    const prevL = (lower[i - 1] ?? bl) as number;
    const prevC = bars[i - 1].close;
    upper[i] = bu < prevU || prevC > prevU ? bu : prevU;
    lower[i] = bl > prevL || prevC < prevL ? bl : prevL;
  }
  return { upper, lower };
}

// ---------- Supertrend (rewritten — fixes prev-band lookup bug) ----------
// Standard pinescript-equivalent algorithm. Returns the trailing stop line.
//   basicUpper = hl2 + mult * ATR
//   basicLower = hl2 - mult * ATR
//   finalUpper[i] = basicUpper[i] < finalUpper[i-1] OR close[i-1] > finalUpper[i-1]
//                   ? basicUpper[i] : finalUpper[i-1]
//   finalLower[i] = basicLower[i] > finalLower[i-1] OR close[i-1] < finalLower[i-1]
//                   ? basicLower[i] : finalLower[i-1]
//   ST[i] = (was_in_downtrend AND close[i] <= finalUpper[i]) ? finalUpper[i]
//         : (was_in_downtrend AND close[i]  > finalUpper[i]) ? finalLower[i]
//         : (was_in_uptrend   AND close[i] >= finalLower[i]) ? finalLower[i]
//         : finalUpper[i]
export function supertrend(bars: Bar[], period = 10, mult = 3): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  if (bars.length < period + 1) return out;
  const a = atr(bars, period);
  const finalUpper: number[] = new Array(bars.length).fill(NaN);
  const finalLower: number[] = new Array(bars.length).fill(NaN);
  const st: number[] = new Array(bars.length).fill(NaN);
  // First valid index = first i where atr[i] is defined.
  const start = a.findIndex((v) => v !== undefined);
  if (start === -1) return out;
  for (let i = start; i < bars.length; i++) {
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const atrI = a[i] as number;
    const basicU = hl2 + mult * atrI;
    const basicL = hl2 - mult * atrI;
    if (i === start) {
      finalUpper[i] = basicU;
      finalLower[i] = basicL;
      // Seed trend from where the close sits relative to hl2.
      st[i] = bars[i].close <= basicU ? basicU : basicL;
    } else {
      const prevFU = finalUpper[i - 1];
      const prevFL = finalLower[i - 1];
      finalUpper[i] = basicU < prevFU || bars[i - 1].close > prevFU ? basicU : prevFU;
      finalLower[i] = basicL > prevFL || bars[i - 1].close < prevFL ? basicL : prevFL;
      const prevST = st[i - 1];
      const close = bars[i].close;
      // Compare against the **previous** finalUpper/finalLower, not the just-
      // updated ones — this was the original bug.
      if (prevST === prevFU) {
        // Was in downtrend (line above price)
        st[i] = close <= finalUpper[i] ? finalUpper[i] : finalLower[i];
      } else {
        // Was in uptrend (line below price)
        st[i] = close >= finalLower[i] ? finalLower[i] : finalUpper[i];
      }
    }
    out[i] = st[i];
  }
  return out;
}

// ── Halftrend core (shared) ──────────────────────────────────────────────────
// Halftrend by Alex Orekhov. `amplitude` controls the lookback for the
// high/low channel; `channel` is the ATR multiplier for a visual band only
// (has no effect on the line value used by the screener).
//
// Returns both the line series and the trend-state series so that the three
// public wrappers (halftrend / halftrendBull / halftrendBear) share one
// implementation without duplicating logic.
//
// trendState[i]: 0 = bullish (green in TradingView), 1 = bearish (red).
function _halftrendCompute(bars: Bar[], amplitude: number): {
  line: Array<number | undefined>;
  trendState: Array<0 | 1 | undefined>;
} {
  const n = bars.length;
  const line: Array<number | undefined> = new Array(n).fill(undefined);
  const trendState: Array<0 | 1 | undefined> = new Array(n).fill(undefined);
  if (n < amplitude + 2) return { line, trendState };

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);
  const highMA = sma(highs, amplitude);
  const lowMA = sma(lows, amplitude);
  const hh = rollingMax(highs, amplitude);
  const ll = rollingMin(lows, amplitude);

  let trend: 0 | 1 = 0;   // 0 = uptrend (bull), 1 = downtrend (bear)
  let nextTrend = 0;
  const hl2_0 = (bars[0].high + bars[0].low) / 2;
  let maxLowPrice = hl2_0;
  let minHighPrice = hl2_0;
  let up = 0;
  let down = 0;
  let prevTrend: 0 | 1 = 0;

  for (let i = 1; i < n; i++) {
    const hma = highMA[i];
    const lma = lowMA[i];
    const highPrice = hh[i];
    const lowPrice = ll[i];
    if (hma === undefined || lma === undefined ||
        highPrice === undefined || lowPrice === undefined) {
      continue;
    }

    if (nextTrend === 1) {
      maxLowPrice = Math.max(lowPrice, maxLowPrice);
      if (hma < maxLowPrice && closes[i] < lows[i - 1]) {
        trend = 1;
        nextTrend = 0;
        minHighPrice = highPrice;
      }
    } else {
      minHighPrice = Math.min(highPrice, minHighPrice);
      if (lma > minHighPrice && closes[i] > highs[i - 1]) {
        trend = 0;
        nextTrend = 1;
        maxLowPrice = lowPrice;
      }
    }

    if (trend === 0) {
      if (prevTrend !== 0) up = down;
      up = Math.max(maxLowPrice, up);
      line[i] = up;
    } else {
      if (prevTrend !== 1) down = up;
      down = Math.min(minHighPrice, down);
      line[i] = down;
    }
    trendState[i] = trend;
    prevTrend = trend;
  }
  return { line, trendState };
}

// Public: returns the halftrend line value for every bar (same as before).
export function halftrend(
  bars: Bar[],
  amplitude = 2,
  channel = 2,
): Array<number | undefined> {
  void channel;
  return _halftrendCompute(bars, amplitude).line;
}

// Public: returns the line value ONLY on bullish (green) bars; undefined on
// bearish bars. A scan condition like "Close > Halftrend Bull" therefore
// requires BOTH that the line is green AND that close is above it.
export function halftrendBull(
  bars: Bar[],
  amplitude = 2,
  channel = 2,
): Array<number | undefined> {
  void channel;
  const { line, trendState } = _halftrendCompute(bars, amplitude);
  return line.map((v, i) => (trendState[i] === 0 ? v : undefined));
}

// Public: returns the line value ONLY on bearish (red) bars; undefined on
// bullish bars. A scan condition like "Close < Halftrend Bear" requires BOTH
// that the line is red AND that close is below it.
export function halftrendBear(
  bars: Bar[],
  amplitude = 2,
  channel = 2,
): Array<number | undefined> {
  void channel;
  const { line, trendState } = _halftrendCompute(bars, amplitude);
  return line.map((v, i) => (trendState[i] === 1 ? v : undefined));
}

// ---------- Pivots ----------

// Camarilla pivot levels — calculated from the PREVIOUS bar's H/L/C and
// projected onto the current bar (classic Camarilla, used by Chartink and
// most Indian-market screeners).
//
// Standard Nick Stott formulas, range R = PH − PL:
//   H1 = PC + R × 1.1/12      L1 = PC − R × 1.1/12
//   H2 = PC + R × 1.1/6       L2 = PC − R × 1.1/6
//   H3 = PC + R × 1.1/4       L3 = PC − R × 1.1/4
//   H4 = PC + R × 1.1/2       L4 = PC − R × 1.1/2
// `side === "R"` returns H{level}; `side === "S"` returns L{level}.
export function camarilla(bars: Bar[], level: 1 | 2 | 3 | 4, side: "R" | "S" | "P"): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  if (side === "P") {
    for (let i = 1; i < bars.length; i++) {
      const p = bars[i - 1];
      out[i] = (p.high + p.low + p.close) / 3;
    }
    return out;
  }
  // Divisor table per the standard Camarilla formula.
  const div = level === 1 ? 12 : level === 2 ? 6 : level === 3 ? 4 : 2;
  const k = 1.1 / div;
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    const off = (p.high - p.low) * k;
    out[i] = side === "R" ? p.close + off : p.close - off;
  }
  return out;
}

// Central Pivot Range — calculated from the PREVIOUS bar's H/L/C and held
// for the current bar (classic intraday CPR).
//   pivot = (PH + PL + PC) / 3
//   raw BC = (PH + PL) / 2
//   raw TC = 2*pivot − BC      (i.e. pivot + (pivot − BC))
//
// Note on labeling: when (PH+PL)/2 > pivot, the raw formula yields an
// "inverted CPR" where the mathematically-named TC sits BELOW BC. Most
// charting platforms (and what users intuitively expect from a screener
// filter like "Close > CPR TC") always treat TC as the UPPER boundary and
// BC as the LOWER boundary. We therefore swap the two so that:
//   tc = max(raw_tc, raw_bc)   — always the top central
//   bc = min(raw_tc, raw_bc)   — always the bottom central
// Pivot is always the midpoint of (TC, BC) regardless.
export function cpr(bars: Bar[], part: "pivot" | "tc" | "bc"): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    const pivot = (p.high + p.low + p.close) / 3;
    const rawBc = (p.high + p.low) / 2;
    const rawTc = 2 * pivot - rawBc;
    const tc = Math.max(rawTc, rawBc);
    const bc = Math.min(rawTc, rawBc);
    out[i] = part === "pivot" ? pivot : part === "tc" ? tc : bc;
  }
  return out;
}

// ---------- Volume / flow ----------

// Rolling VWAP over the last `period` bars.
//   vwap[i] = sum(typical_price * volume) / sum(volume) over the window
// WARNING: This is a rolling window VWAP, NOT the session-resetting VWAP
// on Chartink, Zerodha Kite, or TradingView. Results will differ.
export function vwap(bars: Bar[], period = 20): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  let sumPV = 0;
  let sumV = 0;
  const tp: number[] = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) tp[i] = (bars[i].high + bars[i].low + bars[i].close) / 3;
  for (let i = 0; i < bars.length; i++) {
    sumPV += tp[i] * bars[i].volume;
    sumV += bars[i].volume;
    if (i >= period) {
      sumPV -= tp[i - period] * bars[i - period].volume;
      sumV -= bars[i - period].volume;
    }
    if (i >= period - 1 && sumV > 0) out[i] = sumPV / sumV;
  }
  return out;
}

// Money Flow Index (volume-weighted RSI on typical price).
export function mfi(bars: Bar[], period = 14): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  if (bars.length < period + 1) return out;
  const tp: number[] = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) tp[i] = (bars[i].high + bars[i].low + bars[i].close) / 3;
  const rmf: number[] = new Array(bars.length);
  const sign: number[] = new Array(bars.length).fill(0); // +1 / -1 / 0
  for (let i = 0; i < bars.length; i++) {
    rmf[i] = tp[i] * bars[i].volume;
    if (i > 0) sign[i] = tp[i] > tp[i - 1] ? 1 : tp[i] < tp[i - 1] ? -1 : 0;
  }
  for (let i = period; i < bars.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (sign[j] > 0) pos += rmf[j];
      else if (sign[j] < 0) neg += rmf[j];
    }
    if (neg === 0) out[i] = 100;
    else out[i] = 100 - 100 / (1 + pos / neg);
  }
  return out;
}

// ---------- Trend strength ----------

// Average Directional Index (legacy single-output wrapper).
export function adx(bars: Bar[], period = 14): Array<number | undefined> {
  return dmi(bars, period, period).adxSeries;
}

// DMI — Directional Movement Index.
// Returns +DI, -DI, DX, ADX, and ADXR series.
export function dmi(bars: Bar[], diLen = 14, adxSmooth = 14): {
  plusDI: Array<number | undefined>;
  minusDI: Array<number | undefined>;
  dxSeries: Array<number | undefined>;
  adxSeries: Array<number | undefined>;
  adxr: Array<number | undefined>;
} {
  const n = bars.length;
  const fill = (): Array<number | undefined> => new Array(n).fill(undefined);
  const plusDI = fill(), minusDI = fill(), dxOut = fill(), adxOut = fill(), adxrOut = fill();
  if (n < diLen + adxSmooth + 1) return { plusDI, minusDI, dxSeries: dxOut, adxSeries: adxOut, adxr: adxrOut };
  const tr = trueRange(bars);
  const pDM: number[] = new Array(n).fill(0);
  const mDM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    if (up > dn && up > 0) pDM[i] = up;
    if (dn > up && dn > 0) mDM[i] = dn;
  }
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 1; i <= diLen; i++) { sTR += tr[i]; sP += pDM[i]; sM += mDM[i]; }
  const dxVals: number[] = new Array(n).fill(NaN);
  const step = (smP: number, smM: number, smTR: number, i: number): number => {
    if (smTR === 0) { plusDI[i] = 0; minusDI[i] = 0; dxOut[i] = 0; return 0; }
    const p = 100 * smP / smTR, m = 100 * smM / smTR;
    plusDI[i] = p; minusDI[i] = m;
    const s = p + m;
    const dx = s === 0 ? 0 : 100 * Math.abs(p - m) / s;
    dxOut[i] = dx; return dx;
  };
  dxVals[diLen] = step(sP, sM, sTR, diLen);
  for (let i = diLen + 1; i < n; i++) {
    sTR = sTR - sTR / diLen + tr[i];
    sP  = sP  - sP  / diLen + pDM[i];
    sM  = sM  - sM  / diLen + mDM[i];
    dxVals[i] = step(sP, sM, sTR, i);
  }
  // ADX = Wilder smoothing of DX.
  const adxStart = diLen + adxSmooth - 1;
  if (adxStart < n) {
    let av = 0;
    for (let i = diLen; i < adxStart; i++) av += isNaN(dxVals[i]) ? 0 : dxVals[i];
    av /= adxSmooth;
    adxOut[adxStart] = av;
    for (let i = adxStart + 1; i < n; i++) {
      av = (av * (adxSmooth - 1) + (isNaN(dxVals[i]) ? 0 : dxVals[i])) / adxSmooth;
      adxOut[i] = av;
    }
    // ADXR = (ADX[i] + ADX[i - diLen]) / 2.
    for (let i = adxStart + diLen; i < n; i++) {
      const a = adxOut[i], b = adxOut[i - diLen];
      if (a !== undefined && b !== undefined) adxrOut[i] = ((a as number) + (b as number)) / 2;
    }
  }
  return { plusDI, minusDI, dxSeries: dxOut, adxSeries: adxOut, adxr: adxrOut };
}

// ---------- Aroon ----------
// Aroon Up   = ((period - bars since highest high) / period) * 100
// Aroon Down = ((period - bars since lowest low)  / period) * 100
export function aroon(bars: Bar[], period = 14): {
  up: Array<number | undefined>;
  down: Array<number | undefined>;
} {
  const n = bars.length;
  const up: Array<number | undefined> = new Array(n).fill(undefined);
  const down: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = period; i < n; i++) {
    let hiIdx = i, loIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (bars[j].high >= bars[hiIdx].high) hiIdx = j;
      if (bars[j].low  <= bars[loIdx].low)  loIdx = j;
    }
    up[i]   = ((period - (i - hiIdx)) / period) * 100;
    down[i] = ((period - (i - loIdx)) / period) * 100;
  }
  return { up, down };
}

// ---------- Stochastic RSI ----------
// 1. Compute RSI with rsiLen
// 2. Apply rolling Stochastic on RSI with stochLen → raw %K
// 3. SMA(rawK, smoothK) → %K
// 4. SMA(%K,  smoothD)  → %D
export function stochRsi(
  bars: Bar[],
  rsiLen = 14,
  stochLen = 14,
  smoothK = 3,
  smoothD = 3,
): { k: Array<number | undefined>; d: Array<number | undefined> } {
  const closes = bars.map((b) => b.close);
  const rsiVals = rsi(closes, rsiLen);
  const n = bars.length;
  const rawK: Array<number | undefined> = new Array(n).fill(undefined);

  for (let i = rsiLen + stochLen - 1; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - stochLen + 1; j <= i; j++) {
      const v = rsiVals[j];
      if (v === undefined) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const cur = rsiVals[i];
    rawK[i] = hi !== lo && cur !== undefined ? ((cur - lo) / (hi - lo)) * 100 : 50;
  }

  // Find first valid index in rawK before passing to sma,
  // so undefined warm-up values don't produce NaN.
  const firstRawK = rawK.findIndex((v) => v !== undefined);
  const k: Array<number | undefined> = new Array(n).fill(undefined);
  if (firstRawK !== -1) {
    const rawSlice = rawK.slice(firstRawK).map((v) => v as number);
    const kSlice = sma(rawSlice, smoothK);
    for (let i = 0; i < kSlice.length; i++) k[firstRawK + i] = kSlice[i];
  }

  const firstK = k.findIndex((v) => v !== undefined);
  const d: Array<number | undefined> = new Array(n).fill(undefined);
  if (firstK !== -1) {
    const kSlice = k.slice(firstK).map((v) => v as number);
    const dSlice = sma(kSlice, smoothD);
    for (let i = 0; i < dSlice.length; i++) d[firstK + i] = dSlice[i];
  }

  return { k, d };
}

// ---------- Ichimoku Cloud ----------
//   Tenkan (Conversion, default 9): mid of highest-high & lowest-low
//   Kijun  (Base,       default 26): same, longer window
//   Senkou A (Leading Span A): (Tenkan + Kijun) / 2, plotted 26 bars ahead
//   Senkou B (Leading Span B): mid of 52-bar HH/LL, plotted 26 bars ahead
//   Chikou (Lagging Span):     current close, plotted 26 bars BACK
//
// For *scanning* purposes we shift the leading spans into the present (so at
// index `i` the value already incorporates the displacement) and Chikou as
// the close from `disp` bars ago.
export function ichimoku(
  bars: Bar[],
  part: "tenkan" | "kijun" | "senkou_a" | "senkou_b" | "chikou",
  tenkanP = 9, kijunP = 26, senkouBP = 52, displacement = 26,
): Array<number | undefined> {
  const n = bars.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  const midOver = (period: number): Array<number | undefined> => {
    const arr: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = period - 1; i < n; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (bars[j].high > hh) hh = bars[j].high;
        if (bars[j].low < ll) ll = bars[j].low;
      }
      arr[i] = (hh + ll) / 2;
    }
    return arr;
  };
  if (part === "tenkan") return midOver(tenkanP);
  if (part === "kijun") return midOver(kijunP);
  if (part === "chikou") {
    // close shifted `displacement` bars back: at index i, return close[i - displacement].
    for (let i = displacement; i < n; i++) out[i] = bars[i - displacement].close;
    return out;
  }
  // Leading spans: compute span at index i then plot it `displacement` bars
  // forward — i.e. at scan index `i`, the published value comes from index
  // `i - displacement`.
  if (part === "senkou_a") {
    const t = midOver(tenkanP);
    const k = midOver(kijunP);
    for (let i = 0; i < n; i++) {
      const src = i - displacement;
      if (src >= 0 && t[src] !== undefined && k[src] !== undefined) {
        out[i] = ((t[src] as number) + (k[src] as number)) / 2;
      }
    }
    return out;
  }
  // senkou_b
  const b = midOver(senkouBP);
  for (let i = 0; i < n; i++) {
    const src = i - displacement;
    if (src >= 0 && b[src] !== undefined) out[i] = b[src];
  }
  return out;
}

// ---------- Parabolic SAR ----------
//   step = initial AF (default 0.02), max = AF cap (default 0.2)
//   Returns the SAR value (price level) per bar. When SAR flips, the new
//   value is the highest high (or lowest low) reached during the prior trend.
export function psar(bars: Bar[], start = 0.02, increment = 0.02, maxAF = 0.2): Array<number | undefined> {
  const n = bars.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n < 2) return out;
  // Seed direction from the first two bars.
  let uptrend = bars[1].close >= bars[0].close;
  let af = start;
  let ep = uptrend ? bars[0].high : bars[0].low;
  let sar = uptrend ? bars[0].low : bars[0].high;
  out[0] = sar;
  for (let i = 1; i < n; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);
    // SAR cannot penetrate the prior two bars' extremes.
    if (uptrend) {
      const minLow = i >= 2 ? Math.min(bars[i - 1].low, bars[i - 2].low) : bars[i - 1].low;
      if (sar > minLow) sar = minLow;
    } else {
      const maxHigh = i >= 2 ? Math.max(bars[i - 1].high, bars[i - 2].high) : bars[i - 1].high;
      if (sar < maxHigh) sar = maxHigh;
    }
    let flipped = false;
    if (uptrend && bars[i].low < sar) {
      uptrend = false;
      sar = ep;
      ep = bars[i].low;
      af = start;
      flipped = true;
    } else if (!uptrend && bars[i].high > sar) {
      uptrend = true;
      sar = ep;
      ep = bars[i].high;
      af = start;
      flipped = true;
    }
    if (!flipped) {
      if (uptrend && bars[i].high > ep) {
        ep = bars[i].high;
        af = Math.min(maxAF, af + increment);
      } else if (!uptrend && bars[i].low < ep) {
        ep = bars[i].low;
        af = Math.min(maxAF, af + increment);
      }
    }
    out[i] = sar;
  }
  return out;
}

// ---------- New: Volume-Weighted Moving Average ----------
// VWMA = Σ(close * volume) / Σ(volume) over the last `period` bars.
export function vwma(bars: Bar[], period = 20): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  let sumPV = 0;
  let sumV = 0;
  for (let i = 0; i < bars.length; i++) {
    sumPV += bars[i].close * bars[i].volume;
    sumV += bars[i].volume;
    if (i >= period) {
      sumPV -= bars[i - period].close * bars[i - period].volume;
      sumV -= bars[i - period].volume;
    }
    if (i >= period - 1 && sumV > 0) out[i] = sumPV / sumV;
  }
  return out;
}

// ---------- New: Keltner Channels ----------
// middle = EMA(close, period); bands = middle ± mult * ATR(period)
export function keltner(
  bars: Bar[],
  period = 20,
  mult = 2,
): { mid: Array<number | undefined>; upper: Array<number | undefined>; lower: Array<number | undefined> } {
  const closes = bars.map((b) => b.close);
  const mid = ema(closes, period);
  const a = atr(bars, period);
  const upper: Array<number | undefined> = new Array(bars.length).fill(undefined);
  const lower: Array<number | undefined> = new Array(bars.length).fill(undefined);
  for (let i = 0; i < bars.length; i++) {
    if (mid[i] !== undefined && a[i] !== undefined) {
      upper[i] = (mid[i] as number) + mult * (a[i] as number);
      lower[i] = (mid[i] as number) - mult * (a[i] as number);
    }
  }
  return { mid, upper, lower };
}

// ---------- New: Stochastic Oscillator ----------
// %K = 100 * (close - lowestLow_n) / (highestHigh_n - lowestLow_n)
// %D = SMA(%K, smoothD)   — typically smoothD = 3.
export function stochastic(
  bars: Bar[],
  period = 14,
  smoothK = 1,
  smoothD = 3,
): { k: Array<number | undefined>; d: Array<number | undefined> } {
  const n = bars.length;
  const rawK: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    const denom = hh - ll;
    rawK[i] = denom === 0 ? 0 : ((bars[i].close - ll) / denom) * 100;
  }
  // Apply %K smoothing (SMA of raw %K).
  let k: Array<number | undefined> = rawK;
  if (smoothK > 1) {
    const firstRaw = rawK.findIndex((v) => v !== undefined);
    k = new Array(n).fill(undefined);
    if (firstRaw !== -1) {
      const slice = rawK.slice(firstRaw).map((v) => v as number);
      const ks = sma(slice, smoothK);
      for (let i = 0; i < ks.length; i++) k[firstRaw + i] = ks[i];
    }
  }
  // %D = SMA of smoothed %K.
  const firstK = k.findIndex((v) => v !== undefined);
  const d: Array<number | undefined> = new Array(n).fill(undefined);
  if (firstK !== -1) {
    const slice = k.slice(firstK).map((v) => v as number);
    const ds = sma(slice, smoothD);
    for (let i = 0; i < ds.length; i++) d[firstK + i] = ds[i];
  }
  return { k, d };
}

// ---------- New: On-Balance Volume ----------
// Cumulative running total. Up day: +volume. Down day: -volume. Flat: 0.
export function obv(
  bars: Bar[],
  smoothType: "SMA" | "EMA" | "SMMA" | "WMA" = "SMA",
  smoothLen = 9,
): { obvSeries: Array<number | undefined>; signal: Array<number | undefined> } {
  const obvSeries: Array<number | undefined> = new Array(bars.length).fill(undefined);
  if (!bars.length) return { obvSeries, signal: [] };
  let acc = 0;
  obvSeries[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) acc += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) acc -= bars[i].volume;
    obvSeries[i] = acc;
  }
  let signal: Array<number | undefined>;
  const raw = obvSeries as number[];
  if (smoothType === "EMA") signal = ema(raw, smoothLen);
  else if (smoothType === "SMMA") signal = smma(raw, smoothLen);
  else if (smoothType === "WMA") signal = wma(raw, smoothLen);
  else signal = sma(raw, smoothLen);
  return { obvSeries, signal };
}

// ---------- New: Chaikin Money Flow ----------
// MFM = ((C-L)-(H-C)) / (H-L);  MFV = MFM * V
// CMF = Σ MFV(period) / Σ V(period)
export function cmf(bars: Bar[], period = 20): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  const mfv: number[] = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    const range = bars[i].high - bars[i].low;
    const mfm = range === 0 ? 0 : (((bars[i].close - bars[i].low) - (bars[i].high - bars[i].close)) / range);
    mfv[i] = mfm * bars[i].volume;
  }
  let sumMFV = 0;
  let sumV = 0;
  for (let i = 0; i < bars.length; i++) {
    sumMFV += mfv[i];
    sumV += bars[i].volume;
    if (i >= period) {
      sumMFV -= mfv[i - period];
      sumV -= bars[i - period].volume;
    }
    if (i >= period - 1 && sumV > 0) out[i] = sumMFV / sumV;
  }
  return out;
}

// ---------- New: Detrended Price Oscillator ----------
// DPO[i] = close[i - (period/2 + 1)] - SMA(close, period)[i]
// Default period = 20.
export function dpo(values: number[], period = 20): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  const m = sma(values, period);
  const shift = Math.floor(period / 2) + 1;
  for (let i = 0; i < values.length; i++) {
    const src = i - shift;
    if (src >= 0 && m[i] !== undefined) out[i] = values[src] - (m[i] as number);
  }
  return out;
}

// ---------- New: Floor / Fibonacci / Woodie / Classic Pivots ----------
// All projected from the PREVIOUS bar's H/L/C onto the current bar (same
// projection convention as our CPR & Camarilla helpers above).
//
// Levels supported per family: P, R1..R3, S1..S3.
//   Traditional ("Floor"): P=(H+L+C)/3, R1=2P-L, S1=2P-H, R2=P+(H-L),
//     S2=P-(H-L), R3=H+2(P-L), S3=L-2(H-P)
//   Classic: same R1/R2/S1/S2 as Traditional, but R3=P+2(H-L), S3=P-2(H-L)
//   Fibonacci: P=(H+L+C)/3, Rk = P + fib_k*(H-L), Sk = P - fib_k*(H-L)
//     where fib_1=0.382, fib_2=0.618, fib_3=1.000
//   Woodie: P=(H+L+2C)/4, R1=2P-L, S1=2P-H, R2=P+(H-L), S2=P-(H-L),
//     R3=H+2(P-L), S3=L-2(H-P)
export type PivotFamily = "traditional" | "classic" | "fibonacci" | "woodie";
export type PivotPart = "P" | "R1" | "R2" | "R3" | "S1" | "S2" | "S3";

function computePivot(family: PivotFamily, part: PivotPart, ph: number, pl: number, pc: number): number {
  const range = ph - pl;
  const P = family === "woodie" ? (ph + pl + 2 * pc) / 4 : (ph + pl + pc) / 3;
  if (part === "P") return P;
  if (family === "fibonacci") {
    const k = part === "R1" || part === "S1" ? 0.382
            : part === "R2" || part === "S2" ? 0.618
            : 1.000;
    return part.startsWith("R") ? P + k * range : P - k * range;
  }
  // traditional / classic / woodie share R1/S1/R2/S2
  if (part === "R1") return 2 * P - pl;
  if (part === "S1") return 2 * P - ph;
  if (part === "R2") return P + range;
  if (part === "S2") return P - range;
  // R3 / S3 differ between Classic and the Traditional/Woodie pair
  if (family === "classic") {
    if (part === "R3") return P + 2 * range;
    return P - 2 * range; // S3
  }
  if (part === "R3") return ph + 2 * (P - pl);
  return pl - 2 * (ph - P); // S3
}

export function pivot(
  bars: Bar[],
  family: PivotFamily,
  part: PivotPart,
): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(bars.length).fill(undefined);
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    out[i] = computePivot(family, part, p.high, p.low, p.close);
  }
  return out;
}

// ---------- Candlestick patterns ----------

export const patterns = {
  doji: (b: Bar) => {
    const range = b.high - b.low;
    if (range <= 0) return false;
    return Math.abs(b.close - b.open) <= range * 0.1;
  },
  hammer: (b: Bar) => {
    const body = Math.abs(b.close - b.open);
    const lower = Math.min(b.open, b.close) - b.low;
    const upper = b.high - Math.max(b.open, b.close);
    const range = b.high - b.low;
    if (range <= 0) return false;
    return body <= range * 0.35 && lower >= body * 2 && upper <= body * 0.5;
  },
  invertedHammer: (b: Bar) => {
    const body = Math.abs(b.close - b.open);
    const lower = Math.min(b.open, b.close) - b.low;
    const upper = b.high - Math.max(b.open, b.close);
    const range = b.high - b.low;
    if (range <= 0) return false;
    return body <= range * 0.35 && upper >= body * 2 && lower <= body * 0.5;
  },
  gravestoneDoji: (b: Bar) => {
    const range = b.high - b.low;
    if (range <= 0) return false;
    const body = Math.abs(b.close - b.open);
    const lower = Math.min(b.open, b.close) - b.low;
    return body <= range * 0.1 && lower <= range * 0.05;
  },
  bullishEngulfing: (prev: Bar, cur: Bar) =>
    prev.close < prev.open && cur.close > cur.open && cur.open <= prev.close && cur.close >= prev.open,
  bearishEngulfing: (prev: Bar, cur: Bar) =>
    prev.close > prev.open && cur.close < cur.open && cur.open >= prev.close && cur.close <= prev.open,
};
