import { useRef, useState, useEffect } from "react";
import { FolderOpen, Upload, RefreshCw, FileSpreadsheet, Loader2, Radio, ChevronDown, ChevronUp, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useData } from "@/context/DataContext";
import { toast } from "sonner";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DataSourcePanels() {
  const {
    histories, loadedFileNames, loading, progress, brokerLoading, brokerProgress,
    folderHandle, folderName, categories, optionsData,
    dateRange, supportsDirectoryPicker,
    pickFolder, refreshFolder, clearFolder,
    handleFiles, handleLoadFromBroker, handleMasterUpload, handleOptionsUpload, pickOptionsFolder,
  } = useData();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderDirInputRef = useRef<HTMLInputElement>(null);
  const masterInputRef = useRef<HTMLInputElement>(null);
  const optionsInputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory is non-standard — set it imperatively to avoid TS errors
  useEffect(() => {
    folderDirInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const [useBroker, setUseBroker] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [brokerResolution, setBrokerResolution] = useState("1D");
  const [brokerFrom, setBrokerFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [brokerTo, setBrokerTo] = useState(todayIso());

  const RESOLUTIONS = [
    { value: "1D", label: "Daily"  },
    { value: "1",  label: "1 min"  },
    { value: "5",  label: "5 min"  },
    { value: "15", label: "15 min" },
  ];

  function parseSymbols() {
    return brokerSymbols.split(",").map((s) => s.trim()).filter(Boolean);
  }

  function submitBrokerLoad() {
    const symbols = parseSymbols();
    if (!symbols.length) { toast.error("Enter at least one symbol (comma-separated)"); return; }
    void handleLoadFromBroker(symbols, brokerFrom, brokerTo, brokerResolution);
  }

  function submitTodayOnly() {
    const symbols = parseSymbols();
    if (!symbols.length) { toast.error("Enter at least one symbol (comma-separated)"); return; }
    const today = todayIso();
    setBrokerFrom(today);
    setBrokerTo(today);
    void handleLoadFromBroker(symbols, today, today, brokerResolution);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Stocks Data Source */}
      <Card className="p-3 shadow-card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Stocks Data Source
          </h2>
          <div className="flex items-center gap-2">
            {loading && progress && (
              <span className="text-xs text-muted-foreground">
                {progress.filesProcessed}/{progress.totalFiles} · {progress.symbols} sym
              </span>
            )}
            {brokerLoading && brokerProgress && (
              <span className="text-xs text-muted-foreground">
                {brokerProgress.symbolsProcessed}/{brokerProgress.totalSymbols} sym
              </span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useBroker}
                onChange={(e) => setUseBroker(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary cursor-pointer"
              />
              <Radio className="h-3 w-3" />
              Load from connected broker
            </label>
          </div>
        </div>

        {useBroker ? (
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              value={brokerSymbols}
              onChange={(e) => setBrokerSymbols(e.target.value)}
              placeholder="Symbols, comma-separated (e.g. SBIN, RELIANCE, TCS)"
              disabled={brokerLoading}
              className="h-7 text-xs flex-1 min-w-[220px]"
            />
            {/* Resolution dropdown */}
            <select
              value={brokerResolution}
              onChange={(e) => setBrokerResolution(e.target.value)}
              disabled={brokerLoading}
              className="h-7 text-xs px-2 rounded-md border border-input bg-background text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <Input
              type="date"
              value={brokerFrom}
              onChange={(e) => setBrokerFrom(e.target.value)}
              disabled={brokerLoading}
              className="h-7 text-xs w-[130px]"
            />
            <Input
              type="date"
              value={brokerTo}
              onChange={(e) => setBrokerTo(e.target.value)}
              disabled={brokerLoading}
              className="h-7 text-xs w-[130px]"
            />
            <Button
              size="sm"
              onClick={submitBrokerLoad}
              disabled={brokerLoading}
              className="h-7 px-3 text-xs bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow"
            >
              {brokerLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
              Load
            </Button>
            {/* Load Today Only — fast end-of-day top-up for a symbol list */}
            <Button
              size="sm"
              variant="outline"
              onClick={submitTodayOnly}
              disabled={brokerLoading}
              className="h-7 px-3 text-xs"
              title="Set From/To to today and load — ideal for a fast end-of-day top-up"
            >
              <CalendarDays className="h-3 w-3" />
              Today Only
            </Button>
            {brokerProgress?.failed.length ? (
              <span className="text-[11px] text-destructive-bright w-full">
                Failed: {brokerProgress.failed.join(", ")}
              </span>
            ) : null}
          </div>
        ) : (
        <>
        <div className="flex flex-wrap gap-2 items-center">
          {supportsDirectoryPicker() && (
            <Button
              size="sm"
              onClick={pickFolder}
              disabled={loading}
              className="h-7 px-3 text-xs bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
              {folderHandle ? "Change Folder" : "Stocks Folder"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={refreshFolder}
            disabled={loading || !folderHandle}
            title={folderHandle ? `Re-scan ${folderName}` : "Pick a folder first"}
            className="h-7 px-2"
            aria-label="Refresh"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => folderDirInputRef.current?.click()}
            disabled={loading}
            className="h-7 px-3 text-xs"
            title="Select a folder — works in all modern browsers. Includes files in subfolders."
          >
            <FolderOpen className="h-3 w-3" /> Select Folder
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="h-7 px-3 text-xs"
          >
            <Upload className="h-3 w-3" /> Stocks CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => masterInputRef.current?.click()}
            disabled={loading}
            className="h-7 px-3 text-xs"
            title="One CSV with all named symbol categories (Nifty50, Futures, NSE Cash, ETFs, Watchlists, …)."
          >
            <FileSpreadsheet className="h-3 w-3" /> All Watchlist
            {categories.length ? ` (${categories.length})` : ""}
          </Button>
          <input
            ref={folderDirInputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv"
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={masterInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { handleMasterUpload(e.target.files); e.target.value = ""; }}
          />
        </div>
        {/* Status row: folder name + symbol/date summary */}
        {(folderName || histories.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
            {folderName && (
              <span className="flex items-center gap-1.5 min-w-0">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono text-foreground truncate max-w-[180px]">{folderName}</span>
                <button onClick={clearFolder} className="text-destructive-bright hover:underline">
                  clear
                </button>
              </span>
            )}
            {histories.length > 0 && (
              <span>
                <span className="text-foreground font-semibold">{histories.length.toLocaleString()}</span> symbols
                {dateRange && <span className="ml-2">{dateRange.min} → {dateRange.max}</span>}
              </span>
            )}
          </div>
        )}

        {/* File load summary — shown after any CSV load (folder picker, webkitdirectory, or manual) */}
        {loadedFileNames.length > 0 && !loading && (
          <div className="mt-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground">
                {loadedFileNames.length} {loadedFileNames.length === 1 ? "file" : "files"} loaded
              </span>
              {dateRange && (
                <span className="text-muted-foreground">· {dateRange.min} → {dateRange.max}</span>
              )}
              <button
                onClick={() => setShowFiles((v) => !v)}
                className="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showFiles ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showFiles ? "hide" : "show"} files
              </button>
            </div>
            {showFiles && (
              <div className="mt-1.5 max-h-36 overflow-y-auto flex flex-col gap-0.5 pr-1">
                {[...loadedFileNames].sort().map((name) => (
                  <span key={name} className="text-[11px] font-mono text-muted-foreground leading-tight truncate">
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </Card>

      {/* Options Data Source */}
      <Card className="p-3 shadow-card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Options Data Source
          </h2>
          {optionsData && (
            <span className="text-xs text-muted-foreground">
              {optionsData.bars.length.toLocaleString()} rows · {optionsData.expiriesBySymbol.size} sym
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {supportsDirectoryPicker() && (
            <Button
              size="sm"
              onClick={pickOptionsFolder}
              disabled={loading}
              className="h-7 px-3 text-xs bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow whitespace-nowrap"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
              Options Folder
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !optionsData}
            onClick={() => toast.message("Re-pick the options folder to refresh")}
            className="h-7 px-3 text-xs whitespace-nowrap"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => optionsInputRef.current?.click()}
            disabled={loading}
            className="h-7 px-3 text-xs whitespace-nowrap"
          >
            <Upload className="h-3 w-3" /> Options CSV
          </Button>
          <input
            ref={optionsInputRef}
            type="file"
            multiple
            accept=".csv"
            className="hidden"
            onChange={(e) => { handleOptionsUpload(e.target.files); e.target.value = ""; }}
          />
        </div>
        {!optionsData && (
          <p
            className="text-[11px] text-muted-foreground mt-2 truncate"
            title="Pick a folder of NSE FO bhavcopy CSVs, or upload them manually. Toggle Universe → Options to scan CE/PE legs."
          >
            Pick an NSE FO folder or upload CSVs · Universe → Options for CE/PE.
          </p>
        )}
      </Card>
    </div>
  );
}
