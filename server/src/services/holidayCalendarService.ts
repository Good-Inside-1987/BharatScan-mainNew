/**
 * holidayCalendarService.ts
 *
 * Fetches NSE's official trading holiday calendar and persists it into
 * nse_holidays, so tradingCalendar.ts's isHoliday()/isTradingDay() have
 * real data to consult instead of silently degrading to "never a holiday".
 *
 * Source: https://www.nseindia.com/api/holiday-master?type=trading — same
 * nseindia.com API family (and session-cookie handshake) already used by
 * supplementaryJobs.ts's FII/DII and PE/PB/DivYield jobs. Best current
 * understanding of the response shape: a top-level object keyed by segment
 * ("CM" for equity/cash market, "FO" for derivatives, plus others), each
 * segment an array of objects with fields resembling `tradingDate`
 * (e.g. "26-Jan-2026") and `description`. This has not been verified
 * against a live call in this environment — the raw JSON is logged on the
 * first real run so field names can be corrected if NSE's shape has drifted.
 */

import { marketDb } from "../db.js";
import { getNseSessionCookies, nseApiGet } from "./nseSession.js";

interface HolidayEntry {
  tradingDate?: string;   // e.g. "26-Jan-2026"
  date?: string;          // alternate field name NSE has used
  description?: string;
  holidayDate?: string;   // another alternate field name seen in some NSE responses
}

type HolidayMasterResponse = Record<string, HolidayEntry[] | undefined>;

/** Parses NSE's "26-Jan-2026" (or similar) date strings into ISO YYYY-MM-DD. */
function parseNseDate(raw: string): string | null {
  const d = new Date(raw.replace(/-/g, " "));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

let loggedRawShapeOnce = false;

/**
 * Fetches the NSE trading holiday calendar (equity + F&O segments unioned)
 * and upserts each date into nse_holidays. Returns the number of rows upserted.
 */
export async function syncNseHolidayCalendar(): Promise<{ upserted: number }> {
  const cookies = await getNseSessionCookies();
  const raw = await nseApiGet<HolidayMasterResponse>("/api/holiday-master?type=trading", cookies);

  // Log the raw shape once per process on the first real run — NSE's API
  // responses have drifted before, and this project has no way to test
  // against the live endpoint ahead of time.
  if (!loggedRawShapeOnce) {
    loggedRawShapeOnce = true;
    console.log("[holidayCalendar] Raw NSE holiday-master response (first run, for shape verification):",
      JSON.stringify(raw).slice(0, 4000));
  }

  // Union CM (equity/cash market) and FO (derivatives) segments — in practice
  // these are effectively identical, but union rather than assume that.
  const segments = ["CM", "FO"] as const;
  const byDate = new Map<string, string>(); // isoDate -> description

  for (const seg of segments) {
    const entries = raw[seg];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const rawDate = entry.tradingDate ?? entry.date ?? entry.holidayDate;
      if (!rawDate) continue;
      const iso = parseNseDate(rawDate);
      if (!iso) continue;
      if (!byDate.has(iso)) {
        byDate.set(iso, entry.description ?? "");
      }
    }
  }

  const upsert = marketDb.prepare(
    `INSERT INTO nse_holidays (date, description) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET description = excluded.description`
  );

  let upserted = 0;
  for (const [date, description] of byDate) {
    upsert.run(date, description);
    upserted++;
  }

  return { upserted };
}
