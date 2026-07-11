import { parseCsvText, rowToBar, type SymbolHistory, type Bar } from "./csv";
import { apiGetMarketHistory, type ApiHistoryBar } from "./api";

// Load multiple CSV bhavcopy files (NSE EOD format) into per-symbol histories.
export interface LoadProgress {
  filesProcessed: number;
  totalFiles: number;
  symbols: number;
  bars: number;
}

/**
 * Try to extract a YYYYMMDD-style date from a filename.
 * Supports: 20260424_NSE.csv, cm24APR2026bhav.csv, EQ_2026-04-24.csv, fallback to lastModified.
 */
function fileDateKey(f: File): string {
  const n = f.name.toUpperCase();
  // 20260424 or 2026-04-24 or 2026_04_24
  let m = n.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  // CM24APR2026 / 24APR2026 / 24-APR-2026
  m = n.match(/(\d{2})[-_]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_]?(20\d{2})/);
  if (m) {
    const months: Record<string, string> = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
    return `${m[3]}${months[m[2]]}${m[1]}`;
  }
  // Fallback: lastModified -> YYYYMMDD
  const d = new Date(f.lastModified);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

export async function loadFromFiles(
  files: File[],
  onProgress?: (p: LoadProgress) => void,
): Promise<SymbolHistory[]> {
  const map = new Map<string, { series: string; bars: Bar[] }>();
  let processed = 0;
  let totalBars = 0;
  let failed = 0;

  // Sort files newest-first by detected date so the most recent days import first.
  // This guarantees the latest trading day is available even if the browser stalls
  // before processing all files.
  const sorted = [...files].sort((a, b) => fileDateKey(b).localeCompare(fileDateKey(a)));

  // Process in chunks to keep UI responsive. Larger chunk = faster overall.
  const CHUNK = 16;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const chunk = sorted.slice(i, i + CHUNK);
    const texts = await Promise.all(
      chunk.map(async (f) => {
        try { return await f.text(); }
        catch { failed++; return ""; }
      }),
    );
    for (const text of texts) {
      if (!text) { processed++; continue; }
      try {
        const { rows } = parseCsvText(text);
        for (const row of rows) {
          const bar = rowToBar(row);
          if (!bar) continue;
          const sym = row.SYMBOL;
          const series = row.SERIES || "EQ";
          const key = `${sym}|${series}`;
          let entry = map.get(key);
          if (!entry) { entry = { series, bars: [] }; map.set(key, entry); }
          entry.bars.push(bar);
          totalBars++;
        }
      } catch { failed++; }
      processed++;
    }
    onProgress?.({ filesProcessed: processed, totalFiles: sorted.length, symbols: map.size, bars: totalBars });
    // Yield to UI
    await new Promise((r) => setTimeout(r, 0));
  }
  if (failed > 0) console.warn(`[dataLoader] ${failed}/${sorted.length} files failed to read/parse`);

  const out: SymbolHistory[] = [];
  for (const [key, v] of map) {
    const [symbol, series] = key.split("|");
    v.bars.sort((a, b) => a.date.localeCompare(b.date));
    // de-dupe same-day rows (keep last)
    const dedup: Bar[] = [];
    for (const b of v.bars) {
      if (dedup.length && dedup[dedup.length - 1].date === b.date) dedup[dedup.length - 1] = b;
      else dedup.push(b);
    }
    out.push({ symbol, series, bars: dedup });
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}

// Recursively read a directory handle and return all .csv files.
export async function readDirectoryCsvFiles(
  handle: FileSystemDirectoryHandle,
): Promise<File[]> {
  const out: File[] = [];
  const dir = handle as unknown as { values: () => AsyncIterable<FileSystemHandle> };
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".csv")) {
      const f = await (entry as FileSystemFileHandle).getFile();
      out.push(f);
    } else if (entry.kind === "directory") {
      const sub = await readDirectoryCsvFiles(entry as FileSystemDirectoryHandle);
      out.push(...sub);
    }
  }
  return out;
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

// ── Broker API loading ──────────────────────────────────────────────────────
//
// Loads OHLCV history from the connected broker (via the backend's
// marketDataService/liveFeedService-backed REST endpoints) instead of
// user-uploaded CSVs. Produces the exact same SymbolHistory[]/Bar shape as
// loadFromFiles() so screener.ts / indicators.ts work identically regardless
// of data source.

export interface BrokerLoadProgress {
  symbolsProcessed: number;
  totalSymbols: number;
  failed: string[];
}

/**
 * Normalizes a plain NSE ticker (e.g. "SBIN") into the Fyers-native symbol
 * format ("NSE:SBIN-EQ") expected by the backend's history endpoint.
 * Symbols that already look Fyers-formatted (contain a colon) pass through
 * unchanged.
 */
function toFyersSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes(":")) return s;
  return `NSE:${s}-EQ`;
}

// For daily bars the date is already YYYY-MM-DD; for intraday it's a full
// ISO timestamp that we must preserve so individual candles aren't collapsed.
function apiBarToBar(bar: ApiHistoryBar, prevClose: number, daily: boolean): Bar {
  return {
    date: daily ? bar.date.slice(0, 10) : bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    prevClose,
    volume: bar.volume,
    trades: 0,
    value: 0,
  };
}

/**
 * Fetches historical OHLCV bars for the given symbols from the connected
 * broker (default resolution: daily) and maps them into SymbolHistory[] —
 * the same shape loadFromFiles() produces. Symbols that fail to fetch are
 * skipped (reported via onProgress) rather than aborting the whole batch.
 */
export async function loadFromBrokerApi(
  symbols: string[],
  fromDate: string,
  toDate: string,
  onProgress?: (p: BrokerLoadProgress) => void,
  resolution: string = "1D",
): Promise<SymbolHistory[]> {
  const out: SymbolHistory[] = [];
  const failed: string[] = [];
  let processed = 0;

  // Fetch with modest concurrency — the backend already rate-limits/paces
  // upstream broker calls, so this just avoids firing hundreds of
  // simultaneous requests from the browser.
  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < symbols.length) {
      const idx = cursor++;
      const rawSymbol = symbols[idx];
      const fyersSymbol = toFyersSymbol(rawSymbol);
      try {
        const res = await apiGetMarketHistory(fyersSymbol, resolution, fromDate, toDate);

        // Sort raw API bars chronologically FIRST so prevClose is computed
        // against the correct preceding bar, then de-dupe duplicate keys
        // (keep last) — mirrors loadFromFiles()'s sort-then-dedupe order.
        // Daily: dedup key = date only (YYYY-MM-DD).
        // Intraday: dedup key = full timestamp — each candle is a distinct row.
        const daily = resolution === "1D";
        const sortedRaw = [...res.bars].sort((a, b) => a.date.localeCompare(b.date));
        const dedupRaw: ApiHistoryBar[] = [];
        for (const b of sortedRaw) {
          const key = daily ? b.date.slice(0, 10) : b.date;
          if (dedupRaw.length) {
            const lastKey = daily
              ? dedupRaw[dedupRaw.length - 1].date.slice(0, 10)
              : dedupRaw[dedupRaw.length - 1].date;
            if (lastKey === key) { dedupRaw[dedupRaw.length - 1] = b; continue; }
          }
          dedupRaw.push(b);
        }

        const bars: Bar[] = [];
        let prevClose = 0;
        for (const b of dedupRaw) {
          bars.push(apiBarToBar(b, prevClose, daily));
          prevClose = b.close;
        }
        out.push({ symbol: rawSymbol.toUpperCase(), series: "EQ", bars });
      } catch (e) {
        failed.push(rawSymbol);
        console.warn(`[dataLoader] Broker fetch failed for ${rawSymbol}: ${(e as Error).message}`);
      } finally {
        processed++;
        onProgress?.({ symbolsProcessed: processed, totalSymbols: symbols.length, failed: [...failed] });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, () => worker()));

  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}
