/**
 * nseSession.ts
 *
 * Shared session-cookie handshake for calling nseindia.com's public JSON
 * APIs. NSE requires a browser-like session cookie (obtained by first
 * fetching the home page) before its /api/* endpoints will respond instead
 * of blocking the request. Extracted from supplementaryJobs.ts so any other
 * job that needs an NSE API session (e.g. holidayCalendarService.ts) can
 * reuse the exact same handshake instead of duplicating it.
 */

const NSE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Fetches the NSE home page to obtain session cookies required by NSE APIs. */
export async function getNseSessionCookies(): Promise<string> {
  const res = await fetch("https://www.nseindia.com/", {
    headers: {
      "User-Agent": NSE_UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NSE home page fetch failed: HTTP ${res.status}`);

  // Collapse all Set-Cookie headers into a single Cookie string
  const setCookies: string[] = res.headers.getSetCookie?.() ?? [];
  return setCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

export async function nseApiGet<T>(path: string, cookies: string): Promise<T> {
  const url = `https://www.nseindia.com${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": NSE_UA,
      "Accept": "application/json, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/",
      "Cookie": cookies,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NSE API ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const NSE_MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parses NSE's date strings — either "DD-Mon-YYYY" (e.g. "26-Jan-2026")
 * or "DD/MM/YYYY" (e.g. "01/07/2026") — into ISO YYYY-MM-DD using pure
 * string manipulation. Deliberately does NOT go through a Date object:
 * `new Date(...).toISOString()` silently shifts the date backward by a
 * day whenever the process's system timezone is ahead of UTC (IST
 * always is) and local midnight rounds down to the previous UTC
 * calendar day. Returns null if the string doesn't match either format.
 */
export function parseNseDate(raw: string): string | null {
  const trimmed = raw.trim();

  const withMonthName = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (withMonthName) {
    const [, day, mon, year] = withMonthName;
    const month = NSE_MONTHS[mon.toLowerCase()];
    if (!month) return null;
    return `${year}-${month}-${day.padStart(2, "0")}`;
  }

  const numeric = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    const [, day, month, year] = numeric;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}
