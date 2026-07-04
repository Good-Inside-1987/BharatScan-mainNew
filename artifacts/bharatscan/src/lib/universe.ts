// Universe management — a flat list of named symbol "categories" parsed from
// a single Master CSV. Each category gets one column-block in the CSV; the
// first row of the CSV holds the category names (each wrapped in double
// quotes inside its cell, e.g. `"Nifty50" Stocks List`). Categories are
// persisted to browser localStorage so they survive reloads.

export interface UniverseCategory {
  /** Stable id derived from the name (slugified). Used for selection state. */
  id: string;
  /** Friendly display name (the bit that was inside double-quotes in the
   *  first row of the CSV). */
  name: string;
  /** NSE symbols belonging to this category, sorted, deduplicated. */
  symbols: string[];
}

/** A single NSE market holiday parsed from the "Holiday Calender Data"
 *  block on the right of the All Watchlists CSV. */
export interface MarketHoliday {
  /** ISO date — `YYYY-MM-DD`. */
  date: string;
  /** Day name as written in the CSV (e.g. "Friday"). */
  day: string;
  /** Status word — almost always "Close". */
  status: string;
  /** Reason / festival name. */
  occasion: string;
}

const CATS_KEY = "bharatscan:universe-categories";
const HOLIDAYS_KEY = "bharatscan:market-holidays";

/** Parse a CSV file containing one symbol per row. Accepts headerless or
 *  files with a "SYMBOL" column. Comma/semicolon/whitespace-separated. */
export function parseSymbolCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].toUpperCase();
  const hasHeader = /SYMBOL|TICKER|NAME|SCRIP/.test(first);
  let symCol = 0;
  if (hasHeader) {
    const cols = lines[0].split(/[,;\t]/).map((c) => c.trim().toUpperCase());
    const idx = cols.findIndex((c) => /SYMBOL|TICKER|SCRIP/.test(c));
    if (idx >= 0) symCol = idx;
    lines.shift();
  }
  const out = new Set<string>();
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((c) => c.trim());
    const s = (parts[symCol] || parts[0] || "").toUpperCase().replace(/["']/g, "");
    if (s && /^[A-Z0-9&\-_.]+$/.test(s)) out.add(s);
  }
  return Array.from(out).sort();
}

// ---------- Persistence ----------
export function getCategories(): UniverseCategory[] {
  try {
    const raw = localStorage.getItem(CATS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as UniverseCategory[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.symbols));
  } catch { return []; }
}

export function setCategories(cats: UniverseCategory[]): void {
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
}

export function clearCategories(): void {
  localStorage.removeItem(CATS_KEY);
}

export function getHolidays(): MarketHoliday[] {
  try {
    const raw = localStorage.getItem(HOLIDAYS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MarketHoliday[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((h) => h && typeof h.date === "string");
  } catch { return []; }
}

export function setHolidays(hs: MarketHoliday[]): void {
  localStorage.setItem(HOLIDAYS_KEY, JSON.stringify(hs));
}

export function clearHolidays(): void {
  localStorage.removeItem(HOLIDAYS_KEY);
}

const LOT_SIZES_KEY = "bharatscan:lot-sizes";
export function getLotSizes(): LotSizeMap {
  try {
    const raw = localStorage.getItem(LOT_SIZES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LotSizeMap;
  } catch { return {}; }
}
export function setLotSizesStore(ls: LotSizeMap): void {
  localStorage.setItem(LOT_SIZES_KEY, JSON.stringify(ls));
}
export function clearLotSizes(): void {
  localStorage.removeItem(LOT_SIZES_KEY);
}

const QUOTES_KEY = "bharatscan:market-quotes";
export function getQuotes(): MarketQuote[] {
  try {
    const raw = localStorage.getItem(QUOTES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MarketQuote[];
    return Array.isArray(arr) ? arr.filter((q) => q && typeof q.text === "string") : [];
  } catch { return []; }
}
export function setQuotes(qs: MarketQuote[]): void {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(qs));
}
export function clearQuotes(): void {
  localStorage.removeItem(QUOTES_KEY);
}

/** Slugify a category name into a stable id. */
export function categoryId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    || "cat";
}

// ---------- Master "All-in-One" CSV parser ----------
//
// New format (April 2026 onward):
//   Row 0: section header cells. Each non-empty cell contains a category
//          name in double-quotes — e.g.  `"NSE Cash" List`,
//          `"My Favourite"\nWatchlist-1`. Empty separator columns sit
//          between sections.
//   Row 1+: symbol rows. Each section's symbols sit in the same column as
//          its header cell; empty cells just mean "no more symbols in this
//          category yet".
//
// Strike-step / month-header columns from the older format are tolerated
// but ignored — symbols are filtered with `looksLikeSymbol`, so any month
// labels (e.g. "January 2026") are simply skipped.

export interface MarketQuote {
  text: string;
  author: string;
}

/** symbol → { "2026-07": 75, "2026-08": 75, "2026-09": 75, … } */
export type LotSizeMap = Record<string, Record<string, number>>;

export interface MasterCsvParseResult {
  categories: UniverseCategory[];
  holidays: MarketHoliday[];
  quotes: MarketQuote[];
  lotSizes: LotSizeMap;
}

/** Convert a CSV month-header like "Jul-26" or "Aug-2026" → "YYYY-MM".
 *  Returns "" when the label can't be parsed. */
function monthLabelToYearMonth(label: string): string {
  const MON: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{2}|\d{4})$/i.exec(label.trim());
  if (!m) return "";
  const mon = MON[m[1].toLowerCase()];
  const yr = m[2].length === 2 ? "20" + m[2] : m[2];
  return `${yr}-${mon}`;
}

/** Given a symbol and an ISO expiry date (YYYY-MM-DD), return the correct lot size
 *  from the CSV map, or fall back to `fallback` (e.g. hardcoded default).
 *
 *  Backward-compatible: if localStorage still holds the old flat format
 *  ({ "NIFTY": 75 } instead of { "NIFTY": { "2026-07": 75 } }), the numeric
 *  value is returned as-is so users don't need to re-upload just to fix lot sizes. */
export function getLotSizeForExpiry(
  lotSizes: LotSizeMap,
  symbol: string,
  expiryIso: string,
  fallback = 1,
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byMonth = (lotSizes as any)[symbol.toUpperCase()];
  if (byMonth === undefined || byMonth === null) return fallback;

  // Old flat format: value stored directly as a number
  if (typeof byMonth === "number") return byMonth > 0 ? byMonth : fallback;

  if (typeof byMonth !== "object" || !Object.keys(byMonth).length) return fallback;

  // Exact match on YYYY-MM
  const expiryMonth = expiryIso.slice(0, 7); // "2026-07"
  if (byMonth[expiryMonth] !== undefined) return byMonth[expiryMonth];

  // Nearest available month (pick the latest month that is ≤ expiry, else earliest)
  const months = Object.keys(byMonth).sort();
  let best = months[0];
  for (const m of months) {
    if (m <= expiryMonth) best = m;
  }
  return byMonth[best] ?? fallback;
}

/** Convert a CSV holiday-cell date into ISO `YYYY-MM-DD`. Accepts:
 *   - `DD/MM/YY` or `DD/MM/YYYY` (NSE convention used in the new sheet)
 *   - `YYYY-MM-DD`
 *   - Excel serial numbers (when the file was saved as XLSX → CSV with
 *     date cells left as numbers, e.g. `46037`).
 *  Returns "" when the input doesn't look like a valid date. */
function normalizeHolidayDate(cell: string): string {
  const s = (cell || "").trim();
  if (!s) return "";
  // ISO already
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  // DD/MM/YY or DD/MM/YYYY
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    let yyyy = dmy[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) >= 70 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Excel serial (days since 1899-12-30, treating that as the epoch).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = (n - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return "";
}

// Minimal CSV row parser supporting quoted fields with embedded newlines/commas.
function parseCsvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function looksLikeSymbol(s: string): boolean {
  const t = s.trim().toUpperCase().replace(/["']/g, "");
  // NSE symbols: uppercase alphanumerics, may include & - _ .
  // Some symbols START with a digit (e.g. 360ONE, 5PAISA, 3MINDIA), so we allow
  // [A-Z0-9] as first char but require at least one letter in the whole string
  // to exclude pure numeric values (lot sizes, prices, etc.).
  return /^[A-Z0-9][A-Z0-9&\-_.]{0,19}$/.test(t) && /[A-Z]/.test(t);
}

/** Pull the friendly name out of a header cell. Prefers the first chunk
 *  inside double-quotes (e.g. `"NSE Cash" List` → `NSE Cash`). Falls back
 *  to the first non-empty line of the cell. Returns null for empty cells. */
function extractCategoryName(cell: string): string | null {
  const raw = cell ?? "";
  if (!raw.trim()) return null;
  const m = /"([^"]+)"/.exec(raw);
  if (m && m[1].trim()) return m[1].trim();
  const firstLine = raw.split(/[\r\n]/).map((s) => s.trim()).find(Boolean);
  return firstLine || null;
}

/** Detect a top-level meta-header row that groups blocks of columns
 *  (e.g. `Watchlist,,,,Holiday Calender Data 2026,,,`). Real title rows
 *  contain multiple quoted section names like `"NSE Cash" List`, so a row
 *  with zero quoted names but one of those grouping labels is treated as
 *  a meta-header. */
function isGroupHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => (c || "").trim()).filter(Boolean);
  if (cells.length === 0) return false;
  const quoted = cells.filter((c) => /"[^"]+"/.test(c)).length;
  if (quoted > 0) return false;
  return cells.some((c) => /watchlist|holiday/i.test(c));
}

/** Find the first column whose meta-header cell mentions "Holiday" — that's
 *  where the holiday block starts and watchlist columns end. Returns
 *  `row.length` when no holiday block is present. */
function findHolidayBoundaryCol(row: string[]): number {
  for (let c = 0; c < row.length; c++) {
    if (/holiday/i.test(row[c] || "")) return c;
  }
  return row.length;
}

export function parseMasterCsv(text: string): MasterCsvParseResult {
  const rows = parseCsvCells(text);
  if (rows.length < 2) return { categories: [], holidays: [], quotes: [], lotSizes: {} };

  // New format (Apr 2026+ "Watchlists and Holidays" export): row 0 is a
  // meta-header that groups columns into a "Watchlist" block on the left
  // and a "Holiday Calender Data 2026" block on the right; row 1 holds
  // the real section names; data starts at row 2. Columns from the
  // holiday boundary onward must be ignored so we don't mis-read
  // `Status / Date / Day / Occasion` as stock universes.
  let titleRowIdx = 0;
  let firstDataRow = 1;
  let maxCol = Math.max(...rows.map((r) => r.length));
  let holidayStartCol = -1;
  if (isGroupHeaderRow(rows[0])) {
    titleRowIdx = 1;
    firstDataRow = 2;
    holidayStartCol = findHolidayBoundaryCol(rows[0]);
    maxCol = Math.min(maxCol, holidayStartCol);
  }
  const titleRow = rows[titleRowIdx] || [];

  type Section = { col: number; name: string; id: string; symbols: Set<string> };
  const sections: Section[] = [];
  const seenIds = new Set<string>();

  for (let c = 0; c < maxCol; c++) {
    const name = extractCategoryName(titleRow[c] || "");
    if (!name) continue;
    let id = categoryId(name);
    // Disambiguate duplicate slugs by appending the column index.
    if (seenIds.has(id)) id = `${id}-${c}`;
    seenIds.add(id);
    sections.push({ col: c, name, id, symbols: new Set<string>() });
  }

  // Read symbols starting after the title row. Older-format files may have
  // a month header at the first data row — those cells won't pass
  // `looksLikeSymbol`, so they're skipped naturally.
  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    for (const sec of sections) {
      const cell = (row[sec.col] || "").trim().toUpperCase().replace(/["']/g, "");
      if (!cell || !looksLikeSymbol(cell)) continue;
      sec.symbols.add(cell);
    }
  }

  // ---------- Holiday block ----------
  // Locate the four holiday columns by looking for the header words in the
  // title row, scoped to columns at or after the holiday-section start.
  const holidays: MarketHoliday[] = [];
  if (holidayStartCol >= 0) {
    const wantCol = (label: RegExp): number => {
      for (let c = holidayStartCol; c < (titleRow.length || 0); c++) {
        if (label.test((titleRow[c] || "").trim())) return c;
      }
      return -1;
    };
    // "Status (2026)", "Status (2025)" etc. — match the prefix only.
    const statusCol = wantCol(/^status/i);
    const dateCol = wantCol(/^date$/i);
    const dayCol = wantCol(/^day$/i);
    const occasionCol = wantCol(/^occasion$/i);
    // Quotation block — may sit further right in the same header row.
    // Search the FULL title row (not just from holidayStartCol) in case the
    // "Stock Market Investment Quotes" group started in a new cluster.
    const findCol = (label: RegExp): number => {
      for (let c = holidayStartCol; c < titleRow.length; c++) {
        if (label.test((titleRow[c] || "").trim())) return c;
      }
      return -1;
    };
    const quotationCol = findCol(/^quotation$/i);
    const authorCol = findCol(/^author$/i);

    if (dateCol >= 0) {
      const seen = new Set<string>();
      for (let r = firstDataRow; r < rows.length; r++) {
        const row = rows[r];
        const iso = normalizeHolidayDate(row[dateCol] || "");
        if (!iso || seen.has(iso)) continue;
        seen.add(iso);
        holidays.push({
          date: iso,
          day: (dayCol >= 0 ? row[dayCol] : "")?.trim() || "",
          status: (statusCol >= 0 ? row[statusCol] : "")?.trim() || "",
          occasion: (occasionCol >= 0 ? row[occasionCol] : "")?.trim() || "",
        });
      }
      holidays.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Extract quotes — every data row that has non-empty Quotation text.
    // Sub-header rows (which contain "Date", "Occasion" etc.) naturally have
    // empty or non-quote content and are skipped.
    const quotes: MarketQuote[] = [];
    if (quotationCol >= 0) {
      for (let r = firstDataRow; r < rows.length; r++) {
        const row = rows[r];
        const text = (row[quotationCol] || "").trim().replace(/^["']|["']$/g, "");
        if (!text || /^quotation$/i.test(text)) continue;
        const author = (authorCol >= 0 ? row[authorCol] : "")?.trim().replace(/^["']|["']$/g, "") || "Unknown";
        quotes.push({ text, author });
      }
    }
    // ── Lot Size block ──────────────────────────────────────────────────────
    // Row 0 (the group-header row) has a "Lot Size" cell. Find that column,
    // then in the title row locate "Symbol" and ALL month columns
    // (e.g. "Jul-26", "Aug-26", "Sep-26") → store symbol → { "2026-07": n, … }.
    const lotSizes: LotSizeMap = {};
    let lotSizeStartCol = -1;
    const groupRow = rows[0] || [];
    for (let c = 0; c < groupRow.length; c++) {
      if (/lot.?size/i.test(groupRow[c] || "")) { lotSizeStartCol = c; break; }
    }
    if (lotSizeStartCol >= 0) {
      let symCol = -1;
      // Collect all month columns: { col → "YYYY-MM" }
      const monthCols: { col: number; ym: string }[] = [];
      for (let c = lotSizeStartCol; c < titleRow.length; c++) {
        const h = (titleRow[c] || "").trim();
        if (/^symbol$/i.test(h)) { symCol = c; continue; }
        const ym = monthLabelToYearMonth(h);
        if (ym) monthCols.push({ col: c, ym });
      }
      if (symCol >= 0 && monthCols.length > 0) {
        for (let r = firstDataRow; r < rows.length; r++) {
          const row = rows[r];
          const sym = (row[symCol] || "").trim().toUpperCase().replace(/["']/g, "");
          if (!sym || !looksLikeSymbol(sym)) continue;
          const byMonth: Record<string, number> = {};
          for (const { col, ym } of monthCols) {
            const val = Number((row[col] || "").trim().replace(/,/g, ""));
            if (val > 0) byMonth[ym] = val;
          }
          if (Object.keys(byMonth).length > 0) lotSizes[sym] = byMonth;
        }
      }
    }

    return { categories: sections.map((s) => ({ id: s.id, name: s.name, symbols: Array.from(s.symbols).sort() })), holidays, quotes, lotSizes };
  }

  return {
    categories: sections.map((s) => ({
      id: s.id,
      name: s.name,
      symbols: Array.from(s.symbols).sort(),
    })),
    holidays,
    quotes: [],
    lotSizes: {},
  };
}
