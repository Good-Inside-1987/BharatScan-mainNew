import type { Bar, SymbolHistory } from "./csv";

// Heikin-Ashi conversion
// HA_Close = (O+H+L+C)/4
// HA_Open  = (prev HA_Open + prev HA_Close) / 2  (seed: (O0+C0)/2)
// HA_High  = max(H, HA_Open, HA_Close)
// HA_Low   = min(L, HA_Open, HA_Close)
export function toHeikinAshi(bars: Bar[]): Bar[] {
  if (!bars.length) return [];
  const out: Bar[] = new Array(bars.length);
  let prevHaOpen = (bars[0].open + bars[0].close) / 2;
  let prevHaClose = (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;
  out[0] = {
    ...bars[0],
    open: prevHaOpen,
    close: prevHaClose,
    high: Math.max(bars[0].high, prevHaOpen, prevHaClose),
    low: Math.min(bars[0].low, prevHaOpen, prevHaClose),
  };
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    out[i] = { ...b, open: haOpen, high: haHigh, low: haLow, close: haClose };
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return out;
}

export type CandleMode = "regular" | "heikin_ashi";

export function applyCandleMode(histories: SymbolHistory[], mode: CandleMode): SymbolHistory[] {
  if (mode === "regular") return histories;
  return histories.map((h) => ({ ...h, bars: toHeikinAshi(h.bars) }));
}
