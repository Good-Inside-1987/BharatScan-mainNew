import { describe, it, expect } from "vitest";
import { resampleBars } from "../lib/timeframe";
import { camarilla, cpr } from "../lib/indicators";
import type { Bar, SymbolHistory } from "../lib/csv";

// Build a single daily bar
const bar = (date: string, o: number, h: number, l: number, c: number, vol = 1000): Bar => ({
  date,
  open: o,
  high: h,
  low: l,
  close: c,
  prevClose: 0,
  volume: vol,
  trades: 1,
  value: c * vol,
});

// Synthetic dataset: 4 months of daily bars (Jan, Feb, Mar, Apr 2026), trading days only.
// Bars are constructed so each month has DISTINCT and predictable H/L/C.
function buildHistory(): SymbolHistory {
  const bars: Bar[] = [];
  // January 2026: H=110, L=90, C=100 across the month, last day = Jan 30 (Fri)
  // We'll seed individual days so the aggregate matches.
  const janDays = ["2026-01-02", "2026-01-05", "2026-01-15", "2026-01-30"];
  bars.push(bar(janDays[0], 95, 105, 90, 100)); // sets low=90
  bars.push(bar(janDays[1], 100, 110, 95, 105)); // sets high=110
  bars.push(bar(janDays[2], 105, 108, 95, 102));
  bars.push(bar(janDays[3], 102, 109, 99, 100)); // close = 100 (last day's close)
  // Aggregated: H=110, L=90, C=100

  // February 2026: H=130, L=95, C=120, last day = Feb 27
  const febDays = ["2026-02-02", "2026-02-10", "2026-02-20", "2026-02-27"];
  bars.push(bar(febDays[0], 100, 115, 95, 110)); // sets low=95
  bars.push(bar(febDays[1], 110, 130, 105, 125)); // sets high=130
  bars.push(bar(febDays[2], 125, 128, 115, 122));
  bars.push(bar(febDays[3], 122, 125, 118, 120)); // close = 120
  // Aggregated: H=130, L=95, C=120

  // March 2026: H=140, L=100, C=115, last day = Mar 31
  const marDays = ["2026-03-02", "2026-03-10", "2026-03-20", "2026-03-31"];
  bars.push(bar(marDays[0], 120, 130, 110, 125));
  bars.push(bar(marDays[1], 125, 140, 115, 135)); // sets high=140
  bars.push(bar(marDays[2], 135, 138, 100, 105)); // sets low=100
  bars.push(bar(marDays[3], 105, 120, 100, 115)); // close = 115
  // Aggregated: H=140, L=100, C=115

  // April 2026: H=125, L=105, C=118, last day = Apr 29 (today, partial month)
  const aprDays = ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-29"];
  bars.push(bar(aprDays[0], 115, 120, 110, 118));
  bars.push(bar(aprDays[1], 118, 125, 112, 122)); // sets high=125
  bars.push(bar(aprDays[2], 122, 124, 105, 110)); // sets low=105
  bars.push(bar(aprDays[3], 110, 122, 108, 118)); // close = 118
  // Aggregated: H=125, L=105, C=118

  return { symbol: "TEST", series: "EQ", bars };
}

describe("monthly resampling produces correct OHLC buckets", () => {
  const hist = buildHistory();
  const { bars: monthly } = resampleBars(hist.bars, "monthly");

  it("produces 4 monthly bars (Jan, Feb, Mar, Apr)", () => {
    expect(monthly.length).toBe(4);
  });

  it("January monthly bar: H=110, L=90, C=100", () => {
    const j = monthly[0];
    expect(j.high).toBe(110);
    expect(j.low).toBe(90);
    expect(j.close).toBe(100);
    expect(j.date).toBe("2026-01-30"); // last day in bucket
  });

  it("February monthly bar: H=130, L=95, C=120", () => {
    const f = monthly[1];
    expect(f.high).toBe(130);
    expect(f.low).toBe(95);
    expect(f.close).toBe(120);
    expect(f.date).toBe("2026-02-27");
  });

  it("March monthly bar: H=140, L=100, C=115", () => {
    const m = monthly[2];
    expect(m.high).toBe(140);
    expect(m.low).toBe(100);
    expect(m.close).toBe(115);
    expect(m.date).toBe("2026-03-31");
  });

  it("April monthly bar (in-progress): H=125, L=105, C=118", () => {
    const a = monthly[3];
    expect(a.high).toBe(125);
    expect(a.low).toBe(105);
    expect(a.close).toBe(118);
    expect(a.date).toBe("2026-04-29");
  });
});

describe("monthly camarilla via screener-style lookup", () => {
  const hist = buildHistory();
  const { bars: monthly, dayMap } = resampleBars(hist.bars, "monthly");
  const lastDailyIdx = hist.bars.length - 1; // Apr 29 (the simulated 'today')

  it("dayMap[lastDailyIdx] points to April monthly bar (index 3)", () => {
    expect(dayMap[lastDailyIdx]).toBe(3);
  });

  it("Monthly Camarilla H3 on Apr 29 uses March's HLC (H=140, L=100, C=115)", () => {
    // Standard Camarilla H3 = C + (H-L) * 1.1/4 = 115 + 40 * 0.275 = 115 + 11 = 126
    const series = camarilla(monthly, 3, "R");
    const tfIdx = dayMap[lastDailyIdx];
    expect(series[tfIdx]).toBeCloseTo(126, 9);
  });

  it("Monthly Camarilla L3 on Apr 29 uses March's HLC", () => {
    // L3 = 115 - 11 = 104
    const series = camarilla(monthly, 3, "S");
    const tfIdx = dayMap[lastDailyIdx];
    expect(series[tfIdx]).toBeCloseTo(104, 9);
  });

  it("Monthly Camarilla H3 '1 month ago' uses February's HLC (H=130, L=95, C=120)", () => {
    // For March bar, prev = Feb. H3 = 120 + (130-95)*1.1/4 = 120 + 35*0.275 = 120 + 9.625 = 129.625
    const series = camarilla(monthly, 3, "R");
    const tfIdx = dayMap[lastDailyIdx] - 1;
    expect(series[tfIdx]).toBeCloseTo(129.625, 9);
  });
});

describe("monthly CPR via screener-style lookup", () => {
  const hist = buildHistory();
  const { bars: monthly, dayMap } = resampleBars(hist.bars, "monthly");
  const lastDailyIdx = hist.bars.length - 1;

  it("Monthly CPR Pivot on Apr 29 uses March's HLC (H=140, L=100, C=115)", () => {
    // Pivot = (140 + 100 + 115)/3 = 355/3 = 118.333...
    const series = cpr(monthly, "pivot");
    const tfIdx = dayMap[lastDailyIdx];
    expect(series[tfIdx]).toBeCloseTo(118.3333333333, 9);
  });

  it("Monthly CPR TC on Apr 29 (March HLC: TC should be the upper boundary)", () => {
    // raw BC = (140+100)/2 = 120, raw TC = 2*118.333 - 120 = 116.666
    // After labeling: TC = max(116.666, 120) = 120, BC = min(116.666, 120) = 116.666
    // (Inverted CPR on this bar — close near low.)
    const tc = cpr(monthly, "tc");
    const tfIdx = dayMap[lastDailyIdx];
    expect(tc[tfIdx]).toBeCloseTo(120, 9);
  });

  it("Monthly CPR BC on Apr 29 (the lower boundary)", () => {
    const bc = cpr(monthly, "bc");
    const tfIdx = dayMap[lastDailyIdx];
    expect(bc[tfIdx]).toBeCloseTo(116.6666666667, 9);
  });

  it("TC ≥ pivot ≥ BC invariant holds for every monthly bar", () => {
    const tc = cpr(monthly, "tc");
    const piv = cpr(monthly, "pivot");
    const bc = cpr(monthly, "bc");
    for (let i = 1; i < monthly.length; i++) {
      expect(tc[i]!).toBeGreaterThanOrEqual(piv[i]!);
      expect(piv[i]!).toBeGreaterThanOrEqual(bc[i]!);
    }
  });
});

describe("dayMap correctly maps EVERY daily bar to its containing bucket", () => {
  const hist = buildHistory();
  const { dayMap } = resampleBars(hist.bars, "monthly");

  // Daily indices: 0..3 = Jan, 4..7 = Feb, 8..11 = Mar, 12..15 = Apr.

  it("Jan days (0..3) → bucket 0", () => {
    for (let i = 0; i <= 3; i++) expect(dayMap[i]).toBe(0);
  });

  it("Feb days (4..7) → bucket 1 (mid-month days included)", () => {
    for (let i = 4; i <= 7; i++) expect(dayMap[i]).toBe(1);
  });

  it("Mar days (8..11) → bucket 2", () => {
    for (let i = 8; i <= 11; i++) expect(dayMap[i]).toBe(2);
  });

  it("Apr days (12..15, in-progress month) → bucket 3", () => {
    for (let i = 12; i <= 15; i++) expect(dayMap[i]).toBe(3);
  });
});

describe("dayMap is correct for quarterly and yearly too", () => {
  const hist = buildHistory();

  it("quarterly: all Jan-Mar days → Q1 bucket (0), Apr days → Q2 bucket (1)", () => {
    const { bars: q, dayMap } = resampleBars(hist.bars, "quarterly");
    expect(q.length).toBe(2);
    for (let i = 0; i <= 11; i++) expect(dayMap[i]).toBe(0); // Jan-Mar = Q1
    for (let i = 12; i <= 15; i++) expect(dayMap[i]).toBe(1); // Apr = Q2
  });

  it("yearly: every day → bucket 0 (single year of data)", () => {
    const { bars: y, dayMap } = resampleBars(hist.bars, "yearly");
    expect(y.length).toBe(1);
    for (let i = 0; i < dayMap.length; i++) expect(dayMap[i]).toBe(0);
  });
});
