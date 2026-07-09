import { useRef, useState } from "react";
import { FolderOpen, Upload, RefreshCw, FileSpreadsheet, Loader2, Radio } from "lucide-react";
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
    histories, loading, progress, brokerLoading, brokerProgress,
    folderHandle, folderName, categories, optionsData,
    dateRange, supportsDirectoryPicker,
    pickFolder, refreshFolder, clearFolder,
    handleFiles, handleLoadFromBroker, handleMasterUpload, handleOptionsUpload, pickOptionsFolder,
  } = useData();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterInputRef = useRef<HTMLInputElement>(null);
  const optionsInputRef = useRef<HTMLInputElement>(null);

  const [useBroker, setUseBroker] = useState(false);
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [brokerFrom, setBrokerFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [brokerTo, setBrokerTo] = useState(todayIso());

  function submitBrokerLoad() {
    const symbols = brokerSymbols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!symbols.length) { toast.error("Enter at least one symbol (comma-separated)"); return; }
    void handleLoadFromBroker(symbols, brokerFrom, brokerTo);
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
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <input
            ref={masterInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { handleMasterUpload(e.target.files); e.target.value = ""; }}
          />
        </div>
        {(folderName || histories.length > 0 || !supportsDirectoryPicker()) && (
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
            {!supportsDirectoryPicker() && (
              <span className="text-[11px]">
                Folder picker requires Chrome / Edge. Use "Stocks CSV" otherwise.
              </span>
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
