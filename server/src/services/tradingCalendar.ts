/**
 * tradingCalendar.ts
 *
 * Shared NSE trading-day helpers (IST, string-based dates to avoid UTC
 * day-shift bugs). Extracted from catchUpScheduler.ts so any job that needs
 * to know "is this date actually a trading day" — before spending broker
 * request budget on it — can reuse the exact same weekend/holiday logic
 * instead of duplicating (and risking drift from) it.
 */

import { marketDb } from "../db.js";
import { config } from "../config/environment.js";

/** Noon IST anchor avoids DST/UTC-midnight edge cases when adding days. */
export function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00+05:30`);
}

export function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: config.timezone });
}

export function addDays(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function isWeekend(dateStr: string): boolean {
  const day = toDate(dateStr).getDay(); // 0=Sun..6=Sat, stable regardless of local TZ since anchored at noon IST
  return day === 0 || day === 6;
}

/**
 * True if `dateStr` is a logged NSE trading holiday. Queries directly with no
 * "is the table populated" cache — nse_holidays only ever holds a few dozen
 * rows, so there's no performance concern, and a cache here previously
 * risked permanently caching a stale "empty table" result for the rest of
 * the process's lifetime even after holidayCalendarService populated it.
 */
export function isHoliday(dateStr: string): boolean {
  const row = marketDb.prepare(`SELECT 1 FROM nse_holidays WHERE date = ?`).get(dateStr);
  return !!row;
}

/** True for ordinary NSE trading weekdays. A genuine holiday with an empty
 *  nse_holidays table just fails gracefully with no data later, same as today. */
export function isTradingDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

/** Walks backward from `dateStr` (inclusive) to the nearest actual trading day. */
export function mostRecentTradingDay(dateStr: string): string {
  let d = dateStr;
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}
