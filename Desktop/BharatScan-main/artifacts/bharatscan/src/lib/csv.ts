// CSV parser for NSE bhavcopy files
// Format: SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN

export interface Bar {
  date: string; // ISO yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  volume: number;
  trades: number;
  value: number;
  strike?: number; // option strike price (options mode only)
  oi?: number;     // open interest (options mode only)
}

export interface SymbolHistory {
  symbol: string;
  series: string;
  bars: Bar[]; // sorted ascending by date
  expiry?: string; // YYYY-MM-DD — set for option histories
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** Parse common NSE date encodings into ISO YYYY-MM-DD. Returns "" if unparseable. */
export function parseNseDate(s: string): string {
  if (!s) return "";
  const t = s.trim();
  // Already ISO: 2026-04-24
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 24-Apr-2026 / 24-APR-2026
  m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[2].toUpperCase()];
    if (!mm) return "";
    return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  // 24/04/2026 or 24-04-2026
  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // 2026/04/24
  m = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 20260424
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

export function parseCsvText(text: string): { rows: Array<Record<string, string>>; date: string | null } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], date: null };
  const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const rows: Array<Record<string, string>> = [];
  let date: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < header.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
    if (!date && row.TIMESTAMP) date = parseNseDate(row.TIMESTAMP);
  }
  return { rows, date };
}

export function rowToBar(row: Record<string, string>): Bar | null {
  const ts = row.TIMESTAMP;
  if (!ts) return null;
  const close = parseFloat(row.CLOSE);
  if (!isFinite(close)) return null;
  const date = parseNseDate(ts);
  if (!date) return null; // skip rows with unparseable dates (avoids "undefined" min/max)
  const open   = parseFloat(row.OPEN);
  const high   = parseFloat(row.HIGH);
  const low    = parseFloat(row.LOW);
  const volume = parseFloat(row.TOTTRDQTY);

  if (!isFinite(open) || !isFinite(high) || !isFinite(low)) return null;
  if (high < low)   return null;
  // NSE uses a closing-auction WAP for CLOSE which can legitimately fall
  // slightly outside the intraday HIGH/LOW — do NOT reject those rows.
  if (high < open)  return null;
  if (low  > open)  return null;
  if (volume < 0)   return null;

  return {
    date,
    open,
    high,
    low,
    close,
    prevClose: parseFloat(row.PREVCLOSE),
    volume: isFinite(volume) ? volume : 0,
    trades: parseFloat(row.TOTALTRADES),
    value: parseFloat(row.TOTTRDVAL),
  };
}
