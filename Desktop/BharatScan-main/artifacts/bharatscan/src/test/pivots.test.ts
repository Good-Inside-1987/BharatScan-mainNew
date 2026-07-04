import { describe, it, expect } from "vitest";
import { camarilla, cpr } from "../lib/indicators";
import type { Bar } from "../lib/csv";

const bar = (date: string, o: number, h: number, l: number, c: number): Bar => ({
  date,
  open: o,
  high: h,
  low: l,
  close: c,
  prevClose: 0,
  volume: 0,
  trades: 0,
  value: 0,
});

// Tolerance for float comparison
const APPROX = 1e-9;

describe("camarilla pivots", () => {
  // Standard test case: previous bar H=210, L=180, C=200, R=30
  // Expected (Nick Stott formula):
  //   H1 = 200 + 30 * 1.1/12 = 202.75
  //   H2 = 200 + 30 * 1.1/6  = 205.5
  //   H3 = 200 + 30 * 1.1/4  = 208.25
  //   H4 = 200 + 30 * 1.1/2  = 216.5
  //   L1 = 197.25, L2 = 194.5, L3 = 191.75, L4 = 183.5
  const bars: Bar[] = [
    bar("2026-01-01", 195, 210, 180, 200), // previous bar drives all levels at i=1
    bar("2026-01-02", 200, 215, 195, 205),
  ];

  it("computes H1..H4 correctly from the previous bar", () => {
    expect(camarilla(bars, 1, "R")[1]).toBeCloseTo(202.75, 9);
    expect(camarilla(bars, 2, "R")[1]).toBeCloseTo(205.5, 9);
    expect(camarilla(bars, 3, "R")[1]).toBeCloseTo(208.25, 9);
    expect(camarilla(bars, 4, "R")[1]).toBeCloseTo(216.5, 9);
  });

  it("computes L1..L4 correctly from the previous bar", () => {
    expect(camarilla(bars, 1, "S")[1]).toBeCloseTo(197.25, 9);
    expect(camarilla(bars, 2, "S")[1]).toBeCloseTo(194.5, 9);
    expect(camarilla(bars, 3, "S")[1]).toBeCloseTo(191.75, 9);
    expect(camarilla(bars, 4, "S")[1]).toBeCloseTo(183.5, 9);
  });

  it("returns undefined for the first bar (no previous bar)", () => {
    expect(camarilla(bars, 3, "R")[0]).toBeUndefined();
    expect(camarilla(bars, 3, "S")[0]).toBeUndefined();
  });

  it("L4 < L3 < L2 < L1 < C < H1 < H2 < H3 < H4 in a normal range", () => {
    const c = bars[0].close;
    const l4 = camarilla(bars, 4, "S")[1]!;
    const l3 = camarilla(bars, 3, "S")[1]!;
    const l2 = camarilla(bars, 2, "S")[1]!;
    const l1 = camarilla(bars, 1, "S")[1]!;
    const h1 = camarilla(bars, 1, "R")[1]!;
    const h2 = camarilla(bars, 2, "R")[1]!;
    const h3 = camarilla(bars, 3, "R")[1]!;
    const h4 = camarilla(bars, 4, "R")[1]!;
    expect(l4).toBeLessThan(l3);
    expect(l3).toBeLessThan(l2);
    expect(l2).toBeLessThan(l1);
    expect(l1).toBeLessThan(c);
    expect(c).toBeLessThan(h1);
    expect(h1).toBeLessThan(h2);
    expect(h2).toBeLessThan(h3);
    expect(h3).toBeLessThan(h4);
  });
});

describe("CPR (Central Pivot Range)", () => {
  it("normal range: TC > Pivot > BC", () => {
    // PH=100, PL=80, PC=95
    // Pivot = (100+80+95)/3 = 91.6666...
    // raw BC = (100+80)/2 = 90
    // raw TC = 2*91.6666 - 90 = 93.3333
    // After our top/bottom labeling: TC = 93.3333, BC = 90
    const bars: Bar[] = [
      bar("2026-01-01", 90, 100, 80, 95),
      bar("2026-01-02", 95, 105, 90, 100),
    ];
    expect(cpr(bars, "pivot")[1]).toBeCloseTo(91.6666666667, 9);
    expect(cpr(bars, "tc")[1]).toBeCloseTo(93.3333333333, 9);
    expect(cpr(bars, "bc")[1]).toBeCloseTo(90, 9);
    // Sanity: TC > pivot > BC
    const tc = cpr(bars, "tc")[1]!;
    const piv = cpr(bars, "pivot")[1]!;
    const bc = cpr(bars, "bc")[1]!;
    expect(tc).toBeGreaterThan(piv);
    expect(piv).toBeGreaterThan(bc);
  });

  it("inverted CPR: TC is still labeled as the upper boundary", () => {
    // PH=100, PL=80, PC=82  (close near low → inverted CPR)
    // Pivot = (100+80+82)/3 = 87.3333
    // raw BC = (100+80)/2 = 90
    // raw TC = 2*87.3333 - 90 = 84.6666
    // Because raw TC < raw BC, we swap so:
    //   TC = 90    (always upper)
    //   BC = 84.6666 (always lower)
    const bars: Bar[] = [
      bar("2026-01-01", 90, 100, 80, 82),
      bar("2026-01-02", 82, 90, 78, 85),
    ];
    expect(cpr(bars, "pivot")[1]).toBeCloseTo(87.3333333333, 9);
    expect(cpr(bars, "tc")[1]).toBeCloseTo(90, 9);
    expect(cpr(bars, "bc")[1]).toBeCloseTo(84.6666666667, 9);
    // The rule TC ≥ pivot ≥ BC must always hold for a screener.
    const tc = cpr(bars, "tc")[1]!;
    const piv = cpr(bars, "pivot")[1]!;
    const bc = cpr(bars, "bc")[1]!;
    expect(tc).toBeGreaterThanOrEqual(piv);
    expect(piv).toBeGreaterThanOrEqual(bc);
  });

  it("pivot is always the midpoint of TC and BC", () => {
    const bars: Bar[] = [
      bar("2026-01-01", 100, 120, 90, 95),
      bar("2026-01-02", 95, 110, 92, 100),
    ];
    const tc = cpr(bars, "tc")[1]!;
    const piv = cpr(bars, "pivot")[1]!;
    const bc = cpr(bars, "bc")[1]!;
    expect((tc + bc) / 2).toBeCloseTo(piv, APPROX);
  });

  it("returns undefined for the first bar (no previous bar)", () => {
    const bars: Bar[] = [
      bar("2026-01-01", 100, 110, 90, 100),
      bar("2026-01-02", 100, 110, 90, 100),
    ];
    expect(cpr(bars, "pivot")[0]).toBeUndefined();
    expect(cpr(bars, "tc")[0]).toBeUndefined();
    expect(cpr(bars, "bc")[0]).toBeUndefined();
  });
});
