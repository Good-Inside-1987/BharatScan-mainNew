/**
 * foBanListService.ts
 *
 * Fetches the NSE F&O ban list (securities exceeding 95% of MWPL) from the
 * NSE archives and stores it in the fo_ban_list table. Runs daily at 8:30 AM
 * IST (before market open) so Scanner and Options Analysis pages can flag or
 * exclude banned securities.
 *
 * Source: https://nsearchives.nseindia.com/content/fo/fobansec{DDMONYYYY}.htm
 * 404 → no ban list for that date (holiday / weekend / genuinely no bans).
 */

import { marketDb } from "../db.js";
import { config } from "../config/environment.js";
import { startSyncLog, finishSyncLog, todayIST } from "./syncJobs.js";

const NSE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Date formatting ───────────────────────────────────────────────────────────

/** "2026-07-12" → "12JUL2026" (NSE archive filename convention) */
function toNseArchiveDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  return `${String(d.getDate()).padStart(2, "0")}${months[d.getMonth()]}${d.getFullYear()}`;
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

interface BanEntry {
  symbol: string;
  mwpl_percentage: number | null;
}

/**
 * Parses the NSE ban list HTML table.
 * The file typically has 2 header rows followed by data rows with cells:
 *   Sr.No | Security | ... | % to MWPL (optional)
 */
function parseBanListHtml(html: string): BanEntry[] {
  const entries: BanEntry[] = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowIdx = 0;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    rowIdx++;
    if (rowIdx <= 2) continue; // skip the two header rows

    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    if (cells.length < 2) continue;

    // Column 1 is security name / symbol
    const raw = cells[1].trim().toUpperCase().replace(/\s+/g, "");
    if (!raw || !/^[A-Z0-9&_-]+$/.test(raw)) continue;

    // Optional: last numeric cell may be MWPL %
    let mwpl: number | null = null;
    for (let i = cells.length - 1; i >= 2; i--) {
      const num = parseFloat(cells[i]);
      if (!isNaN(num)) {
        mwpl = num;
        break;
      }
    }

    entries.push({ symbol: raw, mwpl_percentage: mwpl });
  }

  return entries;
}

// ── NSE fetch ─────────────────────────────────────────────────────────────────

async function fetchBanListForDate(date: string): Promise<BanEntry[]> {
  const nseDate = toNseArchiveDate(date);
  const url = `https://nsearchives.nseindia.com/content/fo/fobansec${nseDate}.htm`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": NSE_UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 404) {
    // Holiday, weekend, or genuinely no bans — not an error
    return [];
  }
  if (!res.ok) {
    throw new Error(`NSE ban list HTTP ${res.status} for date ${nseDate}`);
  }

  const html = await res.text();
  return parseBanListHtml(html);
}

// ── Public job ────────────────────────────────────────────────────────────────

export interface FoBanListResult {
  date: string;
  inserted: number;
  skipped?: boolean;
}

export async function runFoBanListJob(
  targetDate: string = todayIST()
): Promise<FoBanListResult> {
  const date = targetDate;
  const logId = startSyncLog("fo_ban_list", date);

  try {
    const entries = await fetchBanListForDate(date);

    if (entries.length === 0) {
      finishSyncLog(logId, "completed", { completed: 0, skippedBudget: 0, failed: 0 });
      console.log(`[foBanList] No ban list for ${date} — holiday, weekend, or no bans`);
      return { date, inserted: 0, skipped: true };
    }

    const upsert = marketDb.prepare(
      `INSERT INTO fo_ban_list (date, symbol, mwpl_percentage)
       VALUES (?, ?, ?)
       ON CONFLICT(date, symbol) DO UPDATE SET mwpl_percentage = excluded.mwpl_percentage`
    );

    for (const entry of entries) {
      upsert.run(date, entry.symbol, entry.mwpl_percentage ?? null);
    }

    finishSyncLog(logId, "completed", {
      completed: entries.length,
      skippedBudget: 0,
      failed: 0,
    });
    console.log(`[foBanList] Stored ${entries.length} ban entries for ${date}`);
    return { date, inserted: entries.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncLog(logId, "failed", { completed: 0, skippedBudget: 0, failed: 0 }, message);
    console.error("[foBanList] Job failed:", message);
    throw err;
  }
}

// ── Query helpers (for Scanner / Options Analysis pages) ──────────────────────

/** Returns the set of symbols on today's F&O ban list. */
export function getTodayBanList(): string[] {
  const date = todayIST();
  const rows = marketDb
    .prepare(`SELECT symbol FROM fo_ban_list WHERE date = ?`)
    .all(date) as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol);
}

/** Returns the most recent ban list regardless of today's date. */
export function getLatestBanList(): { date: string; symbols: string[] } | null {
  const row = marketDb
    .prepare(`SELECT date FROM fo_ban_list ORDER BY date DESC LIMIT 1`)
    .get() as { date: string } | undefined;
  if (!row) return null;
  const symbols = (
    marketDb
      .prepare(`SELECT symbol FROM fo_ban_list WHERE date = ?`)
      .all(row.date) as Array<{ symbol: string }>
  ).map((r) => r.symbol);
  return { date: row.date, symbols };
}
