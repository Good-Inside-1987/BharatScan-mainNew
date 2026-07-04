import type { Condition, ConditionGroup, FilterItem, Operator } from "./screener";
import type { Expr, LeafIndicator } from "./screener";

function leaf(ind: LeafIndicator): Expr {
  return { type: "leaf", tf: "daily", candle: "regular", daysAgo: 0, ind };
}

function num(value: number): Expr {
  return leaf({ kind: "number", value });
}

function cond(left: Expr, op: Operator, right: Expr): Condition {
  return { id: crypto.randomUUID(), left, op, right, enabled: true };
}

export interface ScanTemplate {
  name: string;
  icon: string;
  items: FilterItem[];
}

export const SCAN_TEMPLATES: ScanTemplate[] = [
  {
    name: "RSI Oversold",
    icon: "🟢",
    items: [
      cond(leaf({ kind: "rsi", period: 14 }), "<", num(30)),
    ],
  },
  {
    name: "RSI Overbought",
    icon: "🔴",
    items: [
      cond(leaf({ kind: "rsi", period: 14 }), ">", num(70)),
    ],
  },
  {
    name: "RSI Mid Cross Up",
    icon: "⚡",
    items: [
      cond(leaf({ kind: "rsi", period: 14 }), "crossed_above", num(50)),
    ],
  },
  {
    name: "Golden Cross",
    icon: "✨",
    items: [
      cond(
        leaf({ kind: "sma", period: 50 }),
        "crossed_above",
        leaf({ kind: "sma", period: 200 }),
      ),
    ],
  },
  {
    name: "Death Cross",
    icon: "💀",
    items: [
      cond(
        leaf({ kind: "sma", period: 50 }),
        "crossed_below",
        leaf({ kind: "sma", period: 200 }),
      ),
    ],
  },
  {
    name: "MACD Bullish",
    icon: "📈",
    items: [
      cond(
        leaf({ kind: "macd", fast: 12, slow: 26, signal: 9, part: "line" }),
        "crossed_above",
        leaf({ kind: "macd", fast: 12, slow: 26, signal: 9, part: "signal" }),
      ),
    ],
  },
  {
    name: "MACD Bearish",
    icon: "📉",
    items: [
      cond(
        leaf({ kind: "macd", fast: 12, slow: 26, signal: 9, part: "line" }),
        "crossed_below",
        leaf({ kind: "macd", fast: 12, slow: 26, signal: 9, part: "signal" }),
      ),
    ],
  },
  {
    name: "Supertrend Buy",
    icon: "🟩",
    items: [
      cond(
        leaf({ kind: "close" }),
        "crossed_above",
        leaf({ kind: "supertrend", period: 10, mult: 3 }),
      ),
    ],
  },
  {
    name: "Above 200 EMA",
    icon: "🔵",
    items: [
      cond(leaf({ kind: "close" }), ">", leaf({ kind: "ema", period: 200 })),
    ],
  },
  {
    name: "Williams %R OS",
    icon: "🌊",
    items: [
      cond(leaf({ kind: "williams_r", period: 14 }), "<", num(-80)),
    ],
  },
  {
    name: "52W High Break",
    icon: "🏔️",
    items: [
      cond(leaf({ kind: "close" }), ">=", leaf({ kind: "high_n", period: 252 })),
    ],
  },
  {
    name: "Bollinger Upper",
    icon: "💥",
    items: [
      cond(
        leaf({ kind: "close" }),
        ">",
        leaf({ kind: "bbands", period: 20, mult: 2, part: "upper" }),
      ),
    ],
  },
  {
    name: "ADX Trending",
    icon: "💪",
    items: [
      cond(leaf({ kind: "adx", period: 14 }), ">", num(25)),
    ],
  },
  {
    name: "Stoch Oversold",
    icon: "📊",
    items: [
      cond(
        leaf({ kind: "stoch", period: 14, smoothK: 3, smooth: 3, part: "k" }),
        "<",
        num(20),
      ),
    ],
  },
  {
    name: "Above VWAP",
    icon: "🎯",
    items: [
      cond(leaf({ kind: "close" }), ">", leaf({ kind: "vwap", period: 14 })),
    ],
  },
  {
    name: "CCI Oversold",
    icon: "📉",
    items: [
      cond(leaf({ kind: "cci", period: 20 }), "<", num(-100)),
    ],
  },
];

/** Deep-clone template items with fresh IDs so each insertion is independent. */
export function cloneTemplateItems(items: FilterItem[]): FilterItem[] {
  return items.map(item => {
    if ((item as ConditionGroup).type === "group") {
      const g = item as ConditionGroup;
      return { ...g, id: crypto.randomUUID(), conditions: cloneTemplateItems(g.conditions) };
    }
    return { ...item, id: crypto.randomUUID() };
  });
}
