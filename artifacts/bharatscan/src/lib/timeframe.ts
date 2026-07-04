import type { Bar } from "./csv";

export type Timeframe =
  | "daily" | "weekly" | "monthly" | "quarterly" | "yearly"
  | "m5" | "m10" | "m15" | "m30" | "m45"
  | "h1" | "h2" | "h3";

export function parseIntradayTf(tf: string): { type: "min" | "hr"; n: number } | null {
  const m = tf.match(/^m(\d+)$/);
  if (m) return { type: "min", n: parseInt(m[1]) };
  const h = tf.match(/^h(\d+)$/);
  if (h) return { type: "hr", n: parseInt(h[1]) };
  return null;
}

export function isIntradayTf(tf: string): boolean {
  return parseIntradayTf(tf) !== null;
}

export function intradayTfLabel(tf: string): string {
  const p = parseIntradayTf(tf);
  if (!p) return tf;
  return p.type === "hr" ? `${p.n} hour` : `${p.n} minute`;
}

function bucketKey(date: string, tf: Timeframe): string {
  if (tf === "daily" || isIntradayTf(tf)) return date;
  const [y, m, d] = date.split("-").map((s) => parseInt(s));
  if (tf === "yearly") return `${y}`;
  if (tf === "quarterly") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (tf === "monthly") return `${y}-${String(m).padStart(2, "0")}`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function resampleBars(
  bars: Bar[],
  tf: Timeframe,
): { bars: Bar[]; dayMap: number[] } {
  if (bars.length === 0) return { bars: [], dayMap: [] };
  if (isIntradayTf(tf)) {
    return { bars: [], dayMap: new Array(bars.length).fill(0) };
  }
  if (tf === "daily") {
    const dayMap = new Array<number>(bars.length);
    for (let i = 0; i < bars.length; i++) dayMap[i] = i;
    return { bars, dayMap };
  }
  const out: Bar[] = [];
  const dayMap = new Array<number>(bars.length);
  let cur: Bar | null = null;
  let curKey = "";
  let curIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = bucketKey(b.date, tf);
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b, prevClose: out.length ? out[out.length - 1].close : b.prevClose };
      curKey = k;
      curIdx = out.length;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      cur.value += b.value;
      cur.trades += b.trades;
      cur.date = b.date;
    }
    dayMap[i] = curIdx;
  }
  if (cur) out.push(cur);
  return { bars: out, dayMap };
}

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "daily",     label: "Daily" },
  { value: "weekly",    label: "Weekly" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly",    label: "Yearly" },
];

export const TF_UNIT: Record<Timeframe, string> = {
  daily: "Day", weekly: "Week", monthly: "Month", quarterly: "Quarter", yearly: "Year",
  m5: "5 Min", m10: "10 Min", m15: "15 Min", m30: "30 Min", m45: "45 Min",
  h1: "1 Hour", h2: "2 Hour", h3: "3 Hour",
};
