/**
 * Broker + government charge model for Paper Trading.
 *
 * These are illustrative, approximate figures based on standard NSE retail
 * charge structures (as commonly published by discount brokers). They are
 * NOT a substitute for a real brokerage's charge sheet, but give paper
 * traders a realistic feel for how charges eat into P&L.
 *
 * Equity (stock) trading — ₹0 brokerage, government charges apply:
 *   - STT (Securities Transaction Tax): 0.1% of turnover, both buy & sell
 *   - Exchange transaction charges: 0.00297% of turnover, both buy & sell
 *   - SEBI charges: ₹10 per crore (0.0001%) of turnover, both buy & sell
 *   - Stamp duty: 0.015% of turnover, buy side only
 *   - GST: 18% on (brokerage + exchange txn charges + SEBI charges)
 *
 * Options trading — ₹20 flat brokerage per order (leg):
 *   - Brokerage: ₹20 per order — so a full round-trip (entry + exit) costs ₹40
 *   - STT: 0.1% of premium turnover, sell side only
 *   - Exchange transaction charges: 0.03503% of premium turnover, both sides
 *   - SEBI charges: ₹10 per crore (0.0001%) of premium turnover, both sides
 *   - Stamp duty: 0.003% of premium turnover, buy side only
 *   - GST: 18% on (brokerage + exchange txn charges + SEBI charges)
 */

export type PaperInstrumentType = "stock" | "option";
export type ChargeDirection = "buy" | "sell";

export interface ChargeBreakdown {
  direction: ChargeDirection;
  turnover: number;
  brokerage: number;
  stt: number;
  exchangeTxnCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  total: number;
}

const GST_RATE = 0.18;

export function computeLegCharges(
  instrumentType: PaperInstrumentType,
  direction: ChargeDirection,
  turnover: number
): ChargeBreakdown {
  if (turnover <= 0) {
    return { direction, turnover: 0, brokerage: 0, stt: 0, exchangeTxnCharges: 0, sebiCharges: 0, stampDuty: 0, gst: 0, total: 0 };
  }

  let brokerage = 0;
  let stt = 0;
  let exchangeTxnCharges = 0;
  let sebiCharges = 0;
  let stampDuty = 0;

  if (instrumentType === "stock") {
    brokerage = 0;
    stt = turnover * 0.001; // 0.1% both sides
    exchangeTxnCharges = turnover * 0.0000297; // 0.00297% both sides
    sebiCharges = turnover * 0.000001; // ₹10/crore both sides
    stampDuty = direction === "buy" ? turnover * 0.00015 : 0; // 0.015% buy side only
  } else {
    brokerage = 20; // flat ₹20 per order (leg)
    stt = direction === "sell" ? turnover * 0.001 : 0; // 0.1% sell side only
    exchangeTxnCharges = turnover * 0.0003503; // 0.03503% both sides
    sebiCharges = turnover * 0.000001; // ₹10/crore both sides
    stampDuty = direction === "buy" ? turnover * 0.00003 : 0; // 0.003% buy side only
  }

  const gst = GST_RATE * (brokerage + exchangeTxnCharges + sebiCharges);
  const total = brokerage + stt + exchangeTxnCharges + sebiCharges + stampDuty + gst;

  return {
    direction,
    turnover,
    brokerage: round2(brokerage),
    stt: round2(stt),
    exchangeTxnCharges: round2(exchangeTxnCharges),
    sebiCharges: round2(sebiCharges),
    stampDuty: round2(stampDuty),
    gst: round2(gst),
    total: round2(total),
  };
}

export function directionForOpen(side: "long" | "short"): ChargeDirection {
  return side === "long" ? "buy" : "sell";
}

export function directionForClose(side: "long" | "short"): ChargeDirection {
  return side === "long" ? "sell" : "buy";
}

export function emptyChargeBreakdown(direction: ChargeDirection): ChargeBreakdown {
  return { direction, turnover: 0, brokerage: 0, stt: 0, exchangeTxnCharges: 0, sebiCharges: 0, stampDuty: 0, gst: 0, total: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
