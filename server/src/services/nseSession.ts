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
