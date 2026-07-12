/**
 * supplementaryJobs.ts
 *
 * Three supplementary data jobs, all scheduled after market close:
 *
 * 1. FII/DII daily trading activity  ┐
 * 2. PE/PB/DivYield for major indices┤ run together at 5:30 PM IST
 * 3. Mutual fund monthly holdings     ┘ runs separately on 5th of each month at 5:00 PM IST
 *
 * Data sources:
 *   FII/DII  — NSE two-step session → /api/fiidiiTradeReact
 *   PE/PB/DY — NSE two-step session → /api/allIndices
 *   MF       — AMFI monthly portfolio disclosure file
 *
 * Retention is applied by the centralised cleanup job (cleanupJob.ts), not here.
 */

import { marketDb } from "../db.js";
import { startSyncLog, finishSyncLog, todayIST } from "./syncJobs.js";

// ── NSE session helper ────────────────────────────────────────────────────────

const NSE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Fetches the NSE home page to obtain session cookies required by NSE APIs. */
async function getNseSessionCookies(): Promise<string> {
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

async function nseApiGet<T>(path: string, cookies: string): Promise<T> {
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

// ── FII / DII ─────────────────────────────────────────────────────────────────

interface FiiDiiApiRow {
  date?: string;
  category?: string;
  series?: string;         // "Equity" / "Debt"
  buyValue?: number | string;
  sellValue?: number | string;
  net?: number | string;
  // alternate field names NSE has used in different periods
  grossPurchase?: number | string;
  grossSales?: number | string;
  netPurchase?: number | string;
}

function parseNum(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : v;
  return isNaN(n) ? null : n;
}

/**
 * Fetches today's FII and DII trading data from NSE and upserts into fii_dii.
 * Returns the number of rows upserted.
 */
async function fetchAndStoreFiiDii(date: string, cookies: string): Promise<number> {
  type ApiResponse = FiiDiiApiRow[] | { data: FiiDiiApiRow[] };
  const raw = await nseApiGet<ApiResponse>("/api/fiidiiTradeReact", cookies);
  const rows: FiiDiiApiRow[] = Array.isArray(raw) ? raw : (raw as { data: FiiDiiApiRow[] }).data ?? [];

  const upsert = marketDb.prepare(
    `INSERT INTO fii_dii (date, category, segment, buy_value, sell_value, net_value)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, category, segment) DO UPDATE
       SET buy_value  = excluded.buy_value,
           sell_value = excluded.sell_value,
           net_value  = excluded.net_value`
  );

  let count = 0;
  for (const row of rows) {
    // Normalise category: "FII/FPI" → "FII", "DII" stays "DII"
    const rawCat = (row.category ?? "").trim().toUpperCase();
    const category = rawCat.startsWith("FII") ? "FII" : rawCat.startsWith("DII") ? "DII" : rawCat;
    if (!category) continue;

    const segment = (row.series ?? "EQUITY").trim().toUpperCase().replace(/\s+/g, "");

    const buyValue  = parseNum(row.buyValue  ?? row.grossPurchase);
    const sellValue = parseNum(row.sellValue ?? row.grossSales);
    const netValue  = parseNum(row.net       ?? row.netPurchase);

    // Use the API's date field if it carries a date string; otherwise fall back to today
    const rowDate = row.date
      ? (() => {
          // NSE dates arrive as "01-Jul-2026" or "01/07/2026" — normalise to YYYY-MM-DD
          const d = new Date(row.date.replace(/-/g, " "));
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
          return date;
        })()
      : date;

    upsert.run(rowDate, category, segment, buyValue, sellValue, netValue);
    count++;
  }

  return count;
}

// ── PE / PB / Div Yield ───────────────────────────────────────────────────────

interface AllIndicesRow {
  index?: string;
  pe?: number | string;
  pb?: number | string;
  dy?: number | string;    // dividend yield — NSE field name
  divYield?: number | string;
}

interface AllIndicesResponse {
  data?: AllIndicesRow[];
}

/**
 * Fetches PE/PB/DivYield for all major indices from NSE and upserts into pe_ratio.
 * Returns the number of rows upserted.
 */
async function fetchAndStorePeRatios(date: string, cookies: string): Promise<number> {
  const raw = await nseApiGet<AllIndicesResponse>("/api/allIndices", cookies);
  const rows: AllIndicesRow[] = raw.data ?? [];

  const upsert = marketDb.prepare(
    `INSERT INTO pe_ratio (symbol_or_index, date, pe, pb, div_yield)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(symbol_or_index, date) DO UPDATE
       SET pe        = excluded.pe,
           pb        = excluded.pb,
           div_yield = excluded.div_yield`
  );

  let count = 0;
  for (const row of rows) {
    const name = (row.index ?? "").trim();
    if (!name) continue;

    const pe = parseNum(row.pe);
    const pb = parseNum(row.pb);
    const dy = parseNum(row.dy ?? row.divYield);

    // Only store rows that have at least a P/E value
    if (pe === null && pb === null && dy === null) continue;

    upsert.run(name, date, pe, pb, dy);
    count++;
  }

  return count;
}

// ── Mutual fund holdings ──────────────────────────────────────────────────────

/**
 * Fetches AMFI's monthly portfolio disclosure file and upserts into mf_holdings.
 *
 * Source: https://mf.amfiindia.com/modules/data/downloadMFPortfolioDisclosure.aspx
 * The file is semicolon-delimited with sections per scheme. Header row within
 * each scheme section provides the scheme name/code; subsequent rows are holdings.
 *
 * SEBI-mandated portfolio disclosure format (simplified):
 *   Section header:  Scheme Name;Net Assets;...
 *   Holdings rows:   Issuer;Rating;ISIN;Instrument;Quantity;MktValue;% to NA;...
 */
async function fetchAndStoreMfHoldings(monthYear: string): Promise<number> {
  // monthYear is "YYYY-MM" (e.g. "2026-07")
  const [year, month] = monthYear.split("-");

  const url =
    `https://mf.amfiindia.com/modules/data/downloadMFPortfolioDisclosure.aspx` +
    `?AMCCode=0&Month=${month}&Year=${year}&SchType=ALL`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": NSE_UA,
      "Accept": "text/plain, */*",
      "Referer": "https://www.amfiindia.com/",
    },
    signal: AbortSignal.timeout(60_000), // large file — allow extra time
  });

  if (!res.ok) {
    throw new Error(`AMFI MF holdings fetch failed: HTTP ${res.status} for ${monthYear}`);
  }

  const text = await res.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    console.warn(`[supplementary] AMFI response too short for ${monthYear} (${lines.length} lines) — no data?`);
    return 0;
  }

  const upsert = marketDb.prepare(
    `INSERT INTO mf_holdings
       (fund_name, scheme_code, month_year, symbol, isin, shares_held, percentage)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scheme_code, month_year, symbol) DO UPDATE
       SET shares_held = excluded.shares_held,
           percentage  = excluded.percentage`
  );

  let count = 0;
  let currentFundName = "";
  let currentSchemeCode: string | null = null;

  for (const line of lines) {
    const cols = line.split(";").map((c) => c.trim());

    // Detect scheme header: first cell is not numeric and second is a number-like net assets
    // Pattern: the scheme header row has scheme code in col[0] or scheme name spans col[3]+
    // Standard AMFI format: col[0]=scheme_code, col[1]=isin_div, col[2]=isin_growth, col[3]=scheme_name
    if (cols.length >= 4 && /^\d{6,}$/.test(cols[0])) {
      // This is a scheme header row
      currentSchemeCode = cols[0];
      currentFundName = cols[3] ?? cols[0];
      continue;
    }

    // Holdings row: col[0]=issuer name, col[2]=ISIN, col[4]=quantity, col[6]=% to net assets
    if (!currentSchemeCode) continue;
    if (cols.length < 5) continue;

    const issuerName = cols[0];
    const isin = cols[2] && /^[A-Z]{2}[A-Z0-9]{10}$/.test(cols[2]) ? cols[2] : null;
    const sharesHeld = parseInt(cols[4], 10);
    const pct = parseFloat(cols[6] ?? "");

    if (!issuerName || issuerName.toLowerCase() === "issuer") continue;
    if (isNaN(sharesHeld) && isNaN(pct)) continue;

    // Use ISIN as symbol if we don't have a cleaner ticker; the holding's
    // instrument name (col[0]) is the most consistent identifier in this file
    const symbol = isin ?? issuerName.slice(0, 20);

    upsert.run(
      currentFundName,
      currentSchemeCode,
      monthYear,
      symbol,
      isin,
      isNaN(sharesHeld) ? null : sharesHeld,
      isNaN(pct) ? null : pct
    );
    count++;
  }

  return count;
}

// ── Public jobs ───────────────────────────────────────────────────────────────

export interface SupplementaryResult {
  date: string;
  fiiDiiRows: number;
  peRatioRows: number;
}

/**
 * Fetches FII/DII activity and PE ratios for today. Both use the same NSE
 * session, so we obtain cookies once and reuse them for both calls.
 */
/**
 * targetDate lets the catch-up orchestrator re-run this job for a specific
 * missed date. Note: the underlying NSE endpoints (fiidiiTradeReact,
 * allIndices) only ever expose the current trading session's figures — they
 * have no historical-date parameter — so a catch-up run still fetches
 * "today's" live values from NSE, not a true historical value for
 * `targetDate`. What catch-up buys here is retrying a same-day failure (the
 * app stayed open, the job crashed, and we want another attempt at *today's*
 * data) rather than reconstructing genuinely missed historical days, which
 * this data source cannot provide. Rows are still logged/stored against
 * `targetDate` so sync_log accurately reflects which date the attempt was for.
 */
export async function runSupplementaryJob(
  targetDate: string = todayIST()
): Promise<SupplementaryResult> {
  const date = targetDate;
  const logId = startSyncLog("supplementary", date);

  try {
    console.log("[supplementary] Obtaining NSE session …");
    const cookies = await getNseSessionCookies();

    const [fiiDiiRows, peRatioRows] = await Promise.all([
      fetchAndStoreFiiDii(date, cookies).catch((err) => {
        console.error("[supplementary] FII/DII fetch failed:", err instanceof Error ? err.message : err);
        return 0;
      }),
      fetchAndStorePeRatios(date, cookies).catch((err) => {
        console.error("[supplementary] PE ratio fetch failed:", err instanceof Error ? err.message : err);
        return 0;
      }),
    ]);

    finishSyncLog(logId, "completed", {
      completed: fiiDiiRows + peRatioRows,
      skippedBudget: 0,
      failed: 0,
    });
    console.log(
      "[supplementary] Done — fii_dii=%d rows, pe_ratio=%d rows for %s",
      fiiDiiRows, peRatioRows, date
    );
    return { date, fiiDiiRows, peRatioRows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[supplementary] Job failed:", message);
    throw err;
  }
}

export interface MfHoldingsResult {
  monthYear: string;
  rows: number;
}

/**
 * Fetches AMFI mutual fund monthly holdings for the current month and stores
 * them in mf_holdings. Runs on the 5th of each month at 5:00 PM IST after
 * AMCs have had time to publish their previous month's disclosures.
 */
export async function runMfHoldingsJob(): Promise<MfHoldingsResult> {
  const logId = startSyncLog("mf_holdings");
  // Use the current month — AMFI publishes the previous month's data by the 10th,
  // but the job fires on the 5th to pick up any early disclosures; it is idempotent
  // (ON CONFLICT DO UPDATE) so re-running is safe.
  const now = new Date();
  // Target the previous month's disclosure (published within first 10 days of this month)
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthYear = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  try {
    console.log(`[mfHoldings] Fetching AMFI portfolio disclosure for ${monthYear} …`);
    const rows = await fetchAndStoreMfHoldings(monthYear);
    finishSyncLog(logId, "completed", { completed: rows, skippedBudget: 0, failed: 0 });
    console.log(`[mfHoldings] Stored ${rows} MF holding rows for ${monthYear}`);
    return { monthYear, rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[mfHoldings] Job failed:", message);
    throw err;
  }
}
