import { useState, useRef, useEffect } from "react";
import { Wifi, WifiOff, Download, RefreshCw, Trash2, Eye, EyeOff, CheckCircle, XCircle, Loader2, Save, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useData, type ApiStockRow } from "@/context/DataContext";
import type { ApiOptionRow } from "@/lib/options";
import { toast } from "sonner";

const LS_URL      = "bs:api-url";
const LS_KEY      = "bs:api-key";
const LS_LAST_SYNC = "bs:api-last-sync";

type ConnStatus = "idle" | "checking" | "ok" | "fail";

export function MarketApiPanel() {
  const { mergeApiStocks, mergeApiOptions, clearApiData, histories, optionsData } = useData();

  const [apiUrl, setApiUrl]     = useState(() => localStorage.getItem(LS_URL) ?? "");
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(LS_KEY) ?? "");
  const [showKey, setShowKey]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [log, setLog]           = useState<string[]>([]);
  const [lastSync, setLastSync] = useState(() => localStorage.getItem(LS_LAST_SYNC) ?? "");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const stocksCount  = histories.length;
  const optionsCount = optionsData?.bars.length ?? 0;

  function addLog(msg: string) {
    setLog(prev => [...prev, msg]);
  }

  function saveSettings() {
    localStorage.setItem(LS_URL, apiUrl.trim());
    localStorage.setItem(LS_KEY, apiKey);
    toast.success("API settings saved");
  }

  function baseUrl() {
    return apiUrl.trim().replace(/\/$/, "");
  }

  function headers(): Record<string, string> {
    return apiKey ? { "X-API-Key": apiKey } : {};
  }

  async function testConnection() {
    const base = baseUrl();
    if (!base) { toast.error("Enter API URL first"); return; }
    setBusy(true);
    setConnStatus("checking");
    setLog([]);
    try {
      addLog("Checking /health...");
      const h = await fetch(`${base}/health`, { headers: headers() });
      if (!h.ok) throw new Error(`/health returned HTTP ${h.status}`);
      addLog("✓ Server healthy");

      addLog("Checking /stocks/all?offset=0&limit=1...");
      const s = await fetch(`${base}/stocks/all?offset=0&limit=1`, { headers: headers() });
      if (!s.ok) throw new Error(`/stocks/all returned HTTP ${s.status}`);
      addLog("✓ Stocks endpoint OK");

      addLog("Checking /options/all?offset=0&limit=1...");
      const o = await fetch(`${base}/options/all?offset=0&limit=1`, { headers: headers() });
      if (!o.ok) throw new Error(`/options/all returned HTTP ${o.status}`);
      addLog("✓ Options endpoint OK");

      addLog("✓ All checks passed — Connected");
      setConnStatus("ok");
      toast.success("Connection successful");
    } catch (e) {
      addLog(`✗ ${(e as Error).message}`);
      setConnStatus("fail");
      toast.error(`Connection failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchPaginated<T>(endpoint: string): Promise<T[]> {
    const base = baseUrl();
    const hdrs = headers();
    const all: T[] = [];
    let offset = 0;
    const limit = 5000;
    while (true) {
      const res = await fetch(`${base}${endpoint}?offset=${offset}&limit=${limit}`, { headers: hdrs });
      if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
      const data = await res.json();
      const rows: T[] = Array.isArray(data) ? data : (data.data ?? data.rows ?? []);
      all.push(...rows);
      if (rows.length < limit) break;
      offset += limit;
      addLog(`  …${all.length.toLocaleString()} rows fetched`);
    }
    return all;
  }

  async function downloadAll() {
    const base = baseUrl();
    if (!base) { toast.error("Enter API URL first"); return; }
    setBusy(true);
    setLog([]);
    try {
      addLog("Downloading stocks...");
      const stocks = await fetchPaginated<ApiStockRow>("/stocks/all");
      addLog(`✓ ${stocks.length.toLocaleString()} stock rows received`);
      mergeApiStocks(stocks);
      addLog(`✓ Stocks merged into scanner`);

      addLog("Downloading options...");
      const options = await fetchPaginated<ApiOptionRow>("/options/all");
      addLog(`✓ ${options.length.toLocaleString()} option rows received`);
      mergeApiOptions(options);
      addLog(`✓ Options complete`);

      const now = new Date().toISOString().slice(0, 10);
      setLastSync(now);
      localStorage.setItem(LS_LAST_SYNC, now);
      addLog("✓ Download complete");
      toast.success("All data downloaded");
    } catch (e) {
      addLog(`✗ ${(e as Error).message}`);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function syncLatest() {
    const base = baseUrl();
    if (!base) { toast.error("Enter API URL first"); return; }
    const sinceDate = lastSync || new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    setBusy(true);
    setLog([]);
    try {
      addLog(`Syncing stocks since ${sinceDate}...`);
      const stocks = await fetchPaginated<ApiStockRow>(`/stocks/since/${sinceDate}`);
      addLog(`✓ ${stocks.length.toLocaleString()} new stock rows`);
      if (stocks.length) mergeApiStocks(stocks);

      addLog(`Syncing options since ${sinceDate}...`);
      const options = await fetchPaginated<ApiOptionRow>(`/options/since/${sinceDate}`);
      addLog(`✓ ${options.length.toLocaleString()} new option rows`);
      if (options.length) mergeApiOptions(options);

      const now = new Date().toISOString().slice(0, 10);
      setLastSync(now);
      localStorage.setItem(LS_LAST_SYNC, now);
      addLog("✓ Sync successful");
      toast.success("Sync complete");
    } catch (e) {
      addLog(`✗ ${(e as Error).message}`);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connIcon =
    connStatus === "checking" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> :
    connStatus === "ok"       ? <CheckCircle className="h-3.5 w-3.5 text-success" /> :
    connStatus === "fail"     ? <XCircle className="h-3.5 w-3.5 text-destructive-bright" /> :
                                <WifiOff className="h-3.5 w-3.5 text-muted-foreground/50" />;

  return (
    <Card className="shadow-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">My Market API</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {connIcon}
          {connStatus === "ok" && <span className="text-[10px] font-semibold text-success">Connected</span>}
          {connStatus === "fail" && <span className="text-[10px] font-semibold text-destructive-bright">Failed</span>}
          {connStatus === "idle" && <span className="text-[10px] text-muted-foreground/60">Not tested</span>}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* API URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">API URL</label>
          <Input
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            placeholder="https://abc.trycloudflare.com"
            className="h-8 text-xs bg-input font-mono"
          />
          <p className="text-[10px] text-muted-foreground">Cloudflare tunnel or local network URL of your data backend</p>
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">API Key</label>
          <div className="flex items-center gap-2">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="••••••••••••••••"
              className="h-8 text-xs bg-input flex-1 font-mono"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 shrink-0"
              onClick={() => setShowKey(v => !v)}
              type="button"
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Sent as X-API-Key header. Leave blank if no auth required.</p>
        </div>

        {/* Save + Test row */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-gradient-primary text-primary-foreground hover:opacity-90"
            onClick={saveSettings}
            disabled={busy}
          >
            <Save className="h-3 w-3" /> Save Settings
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            onClick={testConnection}
            disabled={busy || !apiUrl.trim()}
          >
            {busy && connStatus === "checking"
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Wifi className="h-3 w-3" />
            }
            Test Connection
          </Button>
        </div>

        {/* Download + Sync row */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-3 text-xs"
            onClick={downloadAll}
            disabled={busy || !apiUrl.trim()}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Connect &amp; Download All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            onClick={syncLatest}
            disabled={busy || !apiUrl.trim()}
            title={lastSync ? `Fetch data since ${lastSync}` : "Fetch last 7 days"}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Sync Latest
          </Button>
        </div>

        {/* Progress log */}
        {log.length > 0 && (
          <div
            ref={logRef}
            className="rounded-md border border-border bg-muted/30 p-2.5 max-h-36 overflow-y-auto space-y-0.5"
          >
            {log.map((line, i) => (
              <p key={i} className={`text-[11px] font-mono leading-snug ${
                line.startsWith("✓") ? "text-success" :
                line.startsWith("✗") ? "text-destructive-bright" :
                "text-muted-foreground"
              }`}>
                {line}
              </p>
            ))}
          </div>
        )}

        {/* Status cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-muted/20 p-2.5 text-center">
            <Database className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-base font-bold text-foreground leading-none">
              {stocksCount.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Symbols</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-2.5 text-center">
            <Database className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-base font-bold text-foreground leading-none">
              {optionsCount.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Option Rows</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-2.5 text-center">
            <RefreshCw className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-[11px] font-bold text-foreground leading-none">
              {lastSync || "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Last Sync</p>
          </div>
        </div>

        {/* Clear API data */}
        <div className="pt-1 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">Clear API Data</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Removes API-loaded stocks &amp; options from memory. Does not affect saved scans, watchlists, or portfolios.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 px-3 ml-4 shrink-0 text-destructive-bright border-destructive-bright/40 hover:bg-destructive-bright/10"
              onClick={() => {
                clearApiData();
                setLastSync("");
                localStorage.removeItem(LS_LAST_SYNC);
              }}
              disabled={busy}
            >
              <Trash2 className="h-3 w-3" /> Clear API Data
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
