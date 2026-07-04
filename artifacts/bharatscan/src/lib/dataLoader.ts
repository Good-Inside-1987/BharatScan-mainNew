import { parseCsvText, rowToBar, type SymbolHistory, type Bar } from "./csv";

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
