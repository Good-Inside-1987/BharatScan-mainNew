import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import type { SymbolHistory, Bar } from "@/lib/csv";
import { loadFromFiles, readDirectoryCsvFiles, supportsDirectoryPicker, loadFromBrokerApi, type LoadProgress, type BrokerLoadProgress } from "@/lib/dataLoader";
import {
  parseMasterCsv, getCategories, setCategories,
  getHolidays, setHolidays,
  getQuotes, setQuotes,
  getLotSizes, setLotSizesStore,
  type LotSizeMap, type UniverseCategory, type MarketHoliday, type MarketQuote,
} from "@/lib/universe";
import { parseOptionsCsv, parseOptionsApiRows, indexOptions, type OptionsDataset, type ApiOptionRow, type FuturesBar } from "@/lib/options";
import { toast } from "sonner";
import { get, set, del } from "idb-keyval";

const FOLDER_KEY = "bharatscan:folder-handle";
const FOLDER_NAME_KEY = "bharatscan:folder-name";

export interface ApiStockRow {
  symbol: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  series?: string;
}

export interface MarketTarget {
  date: Date;
  iso: string;
  isWeekend: boolean;
  label: string;
}

interface DataContextValue {
  histories: SymbolHistory[];
  loadedFileNames: string[];
  loading: boolean;
  progress: LoadProgress | null;
  brokerLoading: boolean;
  brokerProgress: BrokerLoadProgress | null;
  folderHandle: FileSystemDirectoryHandle | null;
  folderName: string | null;
  categories: UniverseCategory[];
  holidays: MarketHoliday[];
  quotes: MarketQuote[];
  lotSizes: LotSizeMap;
  optionsData: OptionsDataset | null;
  dateRange: { min: string; max: string } | null;
  asOfDate: string | null;
  asOfOptionsDate: string | null;
  supportsDirectoryPicker: () => boolean;
  pickFolder: () => Promise<void>;
  refreshFolder: () => Promise<void>;
  clearFolder: () => Promise<void>;
  handleFiles: (files: FileList | null) => Promise<void>;
  handleLoadFromBroker: (symbols: string[], fromDate: string, toDate: string) => Promise<void>;
  handleMasterUpload: (files: FileList | null) => Promise<void>;
  handleOptionsUpload: (files: FileList | null) => Promise<void>;
  pickOptionsFolder: () => Promise<void>;
  mergeApiStocks: (rows: ApiStockRow[]) => void;
  mergeApiOptions: (rows: ApiOptionRow[]) => void;
  clearApiData: () => void;
  // Date / market state shared across all pages
  realNow: Date;
  dateMode: "today" | "historical";
  setDateMode: (m: "today" | "historical") => void;
  historicalDate: string;
  setHistoricalDate: (d: string) => void;
  now: Date;
  marketTarget: MarketTarget;
  targetHoliday: MarketHoliday | undefined;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataContextProvider({ children }: { children: ReactNode }) {
  const [histories, setHistories] = useState<SymbolHistory[]>([]);
  const [loadedFileNames, setLoadedFileNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [brokerLoading, setBrokerLoading] = useState(false);
  const [brokerProgress, setBrokerProgress] = useState<BrokerLoadProgress | null>(null);
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [categories, setCategoriesState] = useState<UniverseCategory[]>(() => getCategories());
  const [holidays, setHolidaysState] = useState<MarketHoliday[]>(() => getHolidays());
  const [quotes, setQuotesState] = useState<MarketQuote[]>(() => getQuotes());
  const [lotSizes, setLotSizesState] = useState<LotSizeMap>(() => getLotSizes());
  const [optionsData, setOptionsData] = useState<OptionsDataset | null>(null);

  // ── Date / market shared state ──────────────────────────────────────────────
  const [realNow, setRealNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setRealNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const realTodayIso = useMemo(() => {
    const d = realNow;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [realNow]);

  const [dateMode, setDateMode] = useState<"today" | "historical">("today");
  const [historicalDate, setHistoricalDate] = useState<string>(realTodayIso);

  const now = useMemo(() => {
    if (dateMode === "today") return realNow;
    const [y, m, d] = historicalDate.split("-").map(Number);
    if (!y || !m || !d) return realNow;
    return new Date(y, m - 1, d, 12, 0, 0);
  }, [dateMode, historicalDate, realNow]);

  const marketTarget = useMemo<MarketTarget>(() => {
    const minutesOfDay = now.getHours() * 60 + now.getMinutes();
    const showTomorrow = minutesOfDay > 15 * 60 + 30;
    const target = new Date(now);
    if (showTomorrow) target.setDate(target.getDate() + 1);
    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
    const dow = target.getDay();
    return { date: target, iso, isWeekend: dow === 0 || dow === 6, label: showTomorrow ? "Tomorrow" : "Today" };
  }, [now]);

  const targetHoliday = useMemo(
    () => holidays.find((h) => h.date === marketTarget.iso),
    [holidays, marketTarget.iso],
  );
  // ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const h = await get<FileSystemDirectoryHandle>(FOLDER_KEY);
        const n = await get<string>(FOLDER_NAME_KEY);
        if (h) {
          setFolderHandle(h);
          setFolderName(n ?? h.name);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const dateRange = useMemo(() => {
    if (!histories.length) return null;
    let min = "9999", max = "0";
    for (const h of histories) {
      if (h.bars.length) {
        if (h.bars[0].date < min) min = h.bars[0].date;
        if (h.bars[h.bars.length - 1].date > max) max = h.bars[h.bars.length - 1].date;
      }
    }
    return { min, max };
  }, [histories]);

  // Effective "latest date" for equity data, respecting Live/Past mode.
  // In Live mode → dateRange.max. In Past mode → latest bar date <= historicalDate.
  const asOfDate = useMemo<string | null>(() => {
    if (!histories.length) return null;
    const cap = dateMode === "historical" ? historicalDate : null;
    if (!cap) return dateRange?.max ?? null;
    let best = "";
    for (const h of histories) {
      for (let i = h.bars.length - 1; i >= 0; i--) {
        if (h.bars[i].date <= cap) {
          if (h.bars[i].date > best) best = h.bars[i].date;
          break;
        }
      }
    }
    return best || null;
  }, [histories, dateMode, historicalDate, dateRange]);

  // Effective "latest date" for options data, respecting Live/Past mode.
  const asOfOptionsDate = useMemo<string | null>(() => {
    if (!optionsData?.dates.length) return null;
    const cap = dateMode === "historical" ? historicalDate : null;
    if (!cap) return optionsData.dates[optionsData.dates.length - 1];
    const dates = optionsData.dates;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= cap) return dates[i];
    }
    return null;
  }, [optionsData, dateMode, historicalDate]);

  async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const h = handle as unknown as {
      queryPermission: (o: { mode: "read" }) => Promise<PermissionState>;
      requestPermission: (o: { mode: "read" }) => Promise<PermissionState>;
    };
    if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
    return (await h.requestPermission({ mode: "read" })) === "granted";
  }

  async function loadFromHandle(handle: FileSystemDirectoryHandle) {
    setLoading(true);
    setProgress(null);
    try {
      if (!(await ensurePermission(handle))) {
        toast.error("Permission to read folder was denied");
        return;
      }
      const files = await readDirectoryCsvFiles(handle);
      if (!files.length) { toast.error("No CSV files found in folder"); return; }
      setLoadedFileNames(files.map((f) => f.name));
      const hist = await loadFromFiles(files, setProgress);
      setHistories(hist);
      toast.success(`Loaded ${hist.length} symbols from ${files.length} files`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function pickFolder() {
    const w = window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> };
    try {
      const handle = await w.showDirectoryPicker();
      setFolderHandle(handle);
      setFolderName(handle.name);
      try {
        await set(FOLDER_KEY, handle);
        await set(FOLDER_NAME_KEY, handle.name);
      } catch { /* not all browsers allow persisting handles */ }
      await loadFromHandle(handle);
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") toast.error(err.message);
    }
  }

  async function refreshFolder() {
    if (!folderHandle) { toast.error("No folder selected. Pick a folder first."); return; }
    await loadFromHandle(folderHandle);
  }

  async function clearFolder() {
    setFolderHandle(null);
    setFolderName(null);
    await del(FOLDER_KEY);
    await del(FOLDER_NAME_KEY);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setLoading(true);
    setProgress(null);
    setLoadedFileNames(Array.from(files).map((f) => f.name));
    try {
      const hist = await loadFromFiles(Array.from(files), setProgress);
      setHistories(hist);
      toast.success(`Loaded ${hist.length} symbols across ${files.length} files`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadFromBroker(symbols: string[], fromDate: string, toDate: string) {
    if (!symbols.length) { toast.error("Enter at least one symbol"); return; }
    setBrokerLoading(true);
    setBrokerProgress(null);
    try {
      const hist = await loadFromBrokerApi(symbols, fromDate, toDate, setBrokerProgress);
      if (!hist.length) {
        toast.error("No data returned — check the broker connection and symbols");
        return;
      }
      setHistories(hist);
      const failedCount = symbols.length - hist.length;
      const failedMsg = failedCount > 0 ? ` (${failedCount} failed)` : "";
      toast.success(`Loaded ${hist.length} symbols from connected broker${failedMsg}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBrokerLoading(false);
    }
  }

  async function handleMasterUpload(files: FileList | null) {
    if (!files || !files.length) return;
    try {
      const text = await files[0].text();
      const r = parseMasterCsv(text);
      if (!r.categories.length) {
        toast.error("No category headers found — make sure the first row has names in double-quotes");
        return;
      }
      setCategories(r.categories);
      setCategoriesState(r.categories);
      setHolidays(r.holidays);
      setHolidaysState(r.holidays);
      setQuotes(r.quotes);
      setQuotesState(r.quotes);
      setLotSizesStore(r.lotSizes);
      setLotSizesState(r.lotSizes);
      const summary = r.categories.map((c) => `${c.name} ${c.symbols.length}`).join(" · ");
      const hPart = r.holidays.length ? ` · ${r.holidays.length} holidays` : "";
      const qPart = r.quotes.length ? ` · ${r.quotes.length} quotes` : "";
      const lPart = Object.keys(r.lotSizes).length ? ` · ${Object.keys(r.lotSizes).length} lot sizes` : "";
      toast.success(`All Watchlist CSV loaded · ${r.categories.length} categories${hPart}${qPart}${lPart} · ${summary}`);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function handleOptionsUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setLoading(true);
    try {
      const allOptions: OptionsDataset["bars"] = [];
      const allFutures: FuturesBar[] = [];
      for (const f of Array.from(files)) {
        const text = await f.text();
        const { options, futures } = parseOptionsCsv(text);
        allOptions.push(...options);
        allFutures.push(...futures);
      }
      const mergedOptions = optionsData ? [...optionsData.bars, ...allOptions] : allOptions;
      const mergedFutures = optionsData ? [...optionsData.futures, ...allFutures] : allFutures;
      const idx = indexOptions(mergedOptions, mergedFutures);
      setOptionsData(idx);
      const futMsg = allFutures.length ? ` · ${allFutures.length.toLocaleString()} futures rows` : "";
      toast.success(`Loaded ${allOptions.length.toLocaleString()} option rows${futMsg} · ${idx.expiriesBySymbol.size} symbols`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  async function pickOptionsFolder() {
    const w = window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> };
    try {
      const handle = await w.showDirectoryPicker();
      if (!(await ensurePermission(handle))) { toast.error("Permission denied"); return; }
      const files = await readDirectoryCsvFiles(handle);
      if (!files.length) { toast.error("No CSV files found in folder"); return; }
      const list = { length: files.length, item: (i: number) => files[i] } as unknown as FileList;
      Object.defineProperty(list, "length", { value: files.length });
      for (let i = 0; i < files.length; i++) (list as unknown as Record<number, File>)[i] = files[i];
      await handleOptionsUpload(list);
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") toast.error(err.message);
    }
  }

  function mergeApiStocks(rows: ApiStockRow[]) {
    const bySymbol = new Map<string, { series: string; bars: Bar[] }>();
    for (const row of rows) {
      const sym = (row.symbol ?? "").toUpperCase();
      if (!sym) continue;
      if (!bySymbol.has(sym)) bySymbol.set(sym, { series: row.series ?? "EQ", bars: [] });
      bySymbol.get(sym)!.bars.push({
        date: row.trade_date,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        prevClose: 0,
        trades: 0,
        value: 0,
        volume: Number(row.volume) || 0,
      });
    }
    const newHistories: SymbolHistory[] = [];
    for (const [symbol, { series, bars }] of bySymbol) {
      bars.sort((a, b) => a.date.localeCompare(b.date));
      newHistories.push({ symbol, series, bars });
    }
    setHistories(prev => {
      const existing = new Map(prev.map(h => [h.symbol, h]));
      for (const nh of newHistories) {
        const ex = existing.get(nh.symbol);
        if (ex) {
          const existingDates = new Set(ex.bars.map(b => b.date));
          const merged = [...ex.bars, ...nh.bars.filter(b => !existingDates.has(b.date))];
          merged.sort((a, b) => a.date.localeCompare(b.date));
          existing.set(nh.symbol, { ...ex, bars: merged });
        } else {
          existing.set(nh.symbol, nh);
        }
      }
      return Array.from(existing.values());
    });
  }

  function mergeApiOptions(rows: ApiOptionRow[]) {
    const bars = parseOptionsApiRows(rows);
    setOptionsData(prev => {
      const merged = prev ? [...prev.bars, ...bars] : bars;
      // Preserve existing futures bars so futures-based ATM still works
      const prevFutures = prev?.futures ?? [];
      return indexOptions(merged, prevFutures);
    });
  }

  function clearApiData() {
    setHistories([]);
    setOptionsData(null);
    toast.success("API data cleared");
  }

  return (
    <DataContext.Provider value={{
      histories, loadedFileNames, loading, progress, brokerLoading, brokerProgress, folderHandle, folderName,
      categories, holidays, quotes, lotSizes, optionsData, dateRange,
      supportsDirectoryPicker,
      pickFolder, refreshFolder, clearFolder,
      handleFiles, handleLoadFromBroker, handleMasterUpload, handleOptionsUpload, pickOptionsFolder,
      mergeApiStocks, mergeApiOptions, clearApiData,
      realNow, dateMode, setDateMode, historicalDate, setHistoricalDate,
      now, marketTarget, targetHoliday,
      asOfDate, asOfOptionsDate,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataContextProvider");
  return ctx;
}
