import { useRef, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { User, Palette, Bell, ScanSearch, Database, FileInput, Shield, HardDrive, ChevronRight, Moon, Sun, Monitor, Check, Download, Upload, Loader2, Trash2, Plug, PlugZap, RefreshCw, LogOut, Plus, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type AccentColor } from "@/hooks/useTheme";
import { DataSourcePanels } from "@/components/DataSourcePanels";
import { MarketApiPanel } from "@/components/MarketApiPanel";
import { createBackup, restoreBackup, getLastBackupTime } from "@/lib/backup";
import {
  apiGetSettings, apiSaveSetting,
  apiListScans, apiCreateScan, apiDeleteScan, apiToggleFavorite,
  apiListAlerts, apiCreateAlert, apiDeleteAlert, apiToggleAlert,
  apiListDashboards, apiDeleteDashboard,
  apiListPortfolios, apiDeletePortfolio,
  apiListScannerDashboards, apiDeleteScannerDashboard,
  type ApiScan,
} from "@/lib/api";
import { toast } from "sonner";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "scanner", label: "Scanner Preferences", icon: ScanSearch },
  { id: "data", label: "API / Data Source", icon: Database },
  { id: "import", label: "Import / Export", icon: FileInput },
  { id: "security", label: "Security", icon: Shield },
  { id: "backup", label: "Backup / Restore", icon: HardDrive },
  { id: "broker", label: "Broker Connect", icon: Plug },
];

const ACCENT_OPTIONS: { id: AccentColor; label: string; cls: string }[] = [
  { id: "sky",     label: "Sky Blue",  cls: "bg-sky-500" },
  { id: "violet",  label: "Violet",    cls: "bg-violet-500" },
  { id: "emerald", label: "Emerald",   cls: "bg-emerald-500" },
  { id: "orange",  label: "Orange",    cls: "bg-orange-500" },
];

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <div className="min-w-0 pr-4">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="shadow-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{title}</h3>
      </div>
      <div className="px-4">{children}</div>
    </Card>
  );
}

// ── Broker Connection types & helpers ─────────────────────────────────────────

interface BrokerConnection {
  id: string;
  broker_name: string;
  display_name: string;
  status: "connected" | "expired" | "disconnected";
  token_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

async function brokerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Settings() {
  const { themeMode, setTheme, compactMode, setCompactMode, accentColor, setAccentColor } = useTheme();
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState(() => {
    const tab = searchParams.get("tab");
    return SECTIONS.some(s => s.id === tab) ? tab! : "profile";
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState("Trader");
  const [profileEmail, setProfileEmail] = useState("trader@example.com");
  const [profileSaving, setProfileSaving] = useState(false);

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState({
    email: true, push: false, sms: true, scanComplete: true, alertTrigger: true, weeklyReport: false,
  });

  // ── Scanner prefs ──────────────────────────────────────────────────────────
  const [scanner, setScanner] = useState({
    defaultSeries: "EQ", defaultBacktest: "60", autoRefresh: false, showVolume: true,
    showSavedScans: localStorage.getItem("bharatscan:show-saved-scans") === "true",
    homeIndexSource: (localStorage.getItem("bharatscan:home-index-source") ?? "futures") as "futures" | "spot",
  });

  // ── Clear all state ────────────────────────────────────────────────────────
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // ── Export all scans ───────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  // ── Import scans pack ──────────────────────────────────────────────────────
  const importScansRef = useRef<HTMLInputElement>(null);
  const [importingScans, setImportingScans] = useState(false);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreLog, setRestoreLog] = useState<string[]>([]);
  const [lastBackup, setLastBackup] = useState<string | null>(getLastBackupTime);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // ── Broker connections ─────────────────────────────────────────────────────
  const [brokers, setBrokers] = useState<BrokerConnection[]>([]);
  const [brokersLoading, setBrokersLoading] = useState(false);
  const [showAddBroker, setShowAddBroker] = useState(false);
  const [addBrokerType, setAddBrokerType] = useState<"angel_one" | "fyers">("angel_one");
  const [addBrokerForm, setAddBrokerForm] = useState({ display_name: "Angel One", api_key: "", client_code: "", pin: "" });
  const [addBrokerSaving, setAddBrokerSaving] = useState(false);
  const [brokerTotps, setBrokerTotps] = useState<Record<string, string>>({});
  const [brokerBusy, setBrokerBusy] = useState<Record<string, boolean>>({});

  // ── Load all settings from backend on mount ────────────────────────────────
  useEffect(() => {
    apiGetSettings().then((s) => {
      if (s["profile:name"])          setProfileName(s["profile:name"]);
      if (s["profile:email"])         setProfileEmail(s["profile:email"]);
      if (s["scanner:defaultSeries"]) setScanner(p => ({ ...p, defaultSeries: s["scanner:defaultSeries"] }));
      if (s["scanner:defaultBacktest"]) setScanner(p => ({ ...p, defaultBacktest: s["scanner:defaultBacktest"] }));
      if (s["scanner:autoRefresh"])   setScanner(p => ({ ...p, autoRefresh: s["scanner:autoRefresh"] === "true" }));
      if (s["scanner:showVolume"])    setScanner(p => ({ ...p, showVolume: s["scanner:showVolume"] !== "false" }));
      if (s["notif:email"])           setNotifs(p => ({ ...p, email: s["notif:email"] !== "false" }));
      if (s["notif:push"])            setNotifs(p => ({ ...p, push: s["notif:push"] === "true" }));
      if (s["notif:sms"])             setNotifs(p => ({ ...p, sms: s["notif:sms"] !== "false" }));
      if (s["notif:scanComplete"])    setNotifs(p => ({ ...p, scanComplete: s["notif:scanComplete"] !== "false" }));
      if (s["notif:alertTrigger"])    setNotifs(p => ({ ...p, alertTrigger: s["notif:alertTrigger"] !== "false" }));
      if (s["notif:weeklyReport"])    setNotifs(p => ({ ...p, weeklyReport: s["notif:weeklyReport"] === "true" }));
    }).catch(() => {});
  }, []);

  // ── Save profile ──────────────────────────────────────────────────────────
  const saveProfile = useCallback(async () => {
    setProfileSaving(true);
    try {
      await Promise.all([
        apiSaveSetting("profile:name", profileName.trim() || "Trader"),
        apiSaveSetting("profile:email", profileEmail.trim()),
      ]);
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }, [profileName, profileEmail]);

  // ── Toggle notification (auto-saves) ──────────────────────────────────────
  const toggleNotif = useCallback((key: keyof typeof notifs) => {
    setNotifs((p) => {
      const next = { ...p, [key]: !p[key] };
      apiSaveSetting(`notif:${key}`, String(next[key])).catch(() => {});
      return next;
    });
  }, []);

  // ── Update scanner pref (auto-saves) ─────────────────────────────────────
  const updateScanner = useCallback(<K extends keyof typeof scanner>(key: K, value: typeof scanner[K]) => {
    setScanner(p => {
      const next = { ...p, [key]: value };
      if (key !== "showSavedScans") {
        apiSaveSetting(`scanner:${key}`, String(value)).catch(() => {});
      }
      return next;
    });
  }, []);

  // ── Export all saved scans ─────────────────────────────────────────────────
  const handleExportAllScans = useCallback(async () => {
    setExporting(true);
    try {
      const scans = await apiListScans();
      if (!scans.length) { toast.error("No saved scans to export"); return; }
      const blob = new Blob([JSON.stringify({ version: 1, scans }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bharatscan-scans-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${scans.length} scan${scans.length !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  // ── Import scan pack ──────────────────────────────────────────────────────
  const handleImportScansFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportingScans(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const scans: ApiScan[] = Array.isArray(json) ? json : (json.scans ?? []);
      if (!scans.length) { toast.error("No scans found in file"); return; }
      let imported = 0;
      for (const scan of scans) {
        if (!scan.name || !scan.scan_json) continue;
        const created = await apiCreateScan({ name: scan.name, scan_json: scan.scan_json, folder: scan.folder ?? undefined });
        if (scan.is_favorite) await apiToggleFavorite(created.id).catch(() => {});
        imported++;
      }
      toast.success(`Imported ${imported} scan${imported !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Import failed — invalid JSON file");
    } finally {
      setImportingScans(false);
    }
  }, []);

  // ── Clear all data ────────────────────────────────────────────────────────
  const handleClearAll = useCallback(async () => {
    setClearing(true);
    try {
      const [scans, alerts, dashboards, portfolios, scannerDashboards] = await Promise.all([
        apiListScans(),
        apiListAlerts(),
        apiListDashboards(),
        apiListPortfolios(),
        apiListScannerDashboards(),
      ]);
      await Promise.all([
        ...scans.map(s => apiDeleteScan(s.id).catch(() => {})),
        ...alerts.map(a => apiDeleteAlert(a.id).catch(() => {})),
        ...dashboards.map(d => apiDeleteDashboard(d.id).catch(() => {})),
        ...portfolios.map(p => apiDeletePortfolio(p.id).catch(() => {})),
        ...scannerDashboards.map(sd => apiDeleteScannerDashboard(sd.id).catch(() => {})),
      ]);
      const lsKeys = Object.keys(localStorage).filter(k => k.startsWith("bharatscan") || k.startsWith("bs:"));
      lsKeys.forEach(k => { try { localStorage.removeItem(k); } catch {} });
      toast.success("All data cleared");
      setClearDialogOpen(false);
    } catch {
      toast.error("Failed to clear all data");
    } finally {
      setClearing(false);
    }
  }, []);

  // ── Broker: load when section becomes active ──────────────────────────────
  useEffect(() => {
    if (activeSection !== "broker") return;
    setBrokersLoading(true);
    brokerFetch<BrokerConnection[]>("/api/broker-connections")
      .then(setBrokers)
      .catch(() => {})
      .finally(() => setBrokersLoading(false));
  }, [activeSection]);

  // ── Broker: add ───────────────────────────────────────────────────────────
  const handleAddBroker = useCallback(async () => {
    setAddBrokerSaving(true);
    const defaultName = addBrokerType === "fyers" ? "Fyers" : "Angel One";
    try {
      const created = await brokerFetch<BrokerConnection>("/api/broker-connections", {
        method: "POST",
        body: JSON.stringify({
          broker_name: addBrokerType,
          display_name: addBrokerForm.display_name || defaultName,
          api_key: addBrokerForm.api_key,
          client_code: addBrokerForm.client_code,
          pin: addBrokerForm.pin,
        }),
      });
      setBrokers(prev => [created, ...prev]);
      setAddBrokerForm({ display_name: defaultName, api_key: "", client_code: "", pin: "" });
      setShowAddBroker(false);
      const hint = addBrokerType === "fyers"
        ? "Fyers saved. Click 'Open Auth Page' to generate an auth code, then connect."
        : "Broker saved. Enter a TOTP to connect.";
      toast.success(hint);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save broker");
    } finally {
      setAddBrokerSaving(false);
    }
  }, [addBrokerForm, addBrokerType]);

  // ── Broker: connect ───────────────────────────────────────────────────────
  const handleBrokerConnect = useCallback(async (id: string) => {
    const totp = brokerTotps[id] ?? "";
    const isFyers = brokers.find(b => b.id === id)?.broker_name === "fyers";
    if (isFyers ? !totp : totp.length < 6) return;
    setBrokerBusy(prev => ({ ...prev, [`connect:${id}`]: true }));
    try {
      await brokerFetch(`/api/broker-connections/${id}/connect`, {
        method: "POST",
        body: JSON.stringify({ totp_code: totp }),
      });
      setBrokerTotps(prev => { const n = { ...prev }; delete n[id]; return n; });
      const list = await brokerFetch<BrokerConnection[]>("/api/broker-connections");
      setBrokers(list);
      toast.success("Connected successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBrokerBusy(prev => { const n = { ...prev }; delete n[`connect:${id}`]; return n; });
    }
  }, [brokerTotps]);

  // ── Broker: disconnect ────────────────────────────────────────────────────
  const handleBrokerDisconnect = useCallback(async (id: string) => {
    setBrokerBusy(prev => ({ ...prev, [`disconnect:${id}`]: true }));
    try {
      await brokerFetch(`/api/broker-connections/${id}/disconnect`, { method: "POST" });
      setBrokers(prev => prev.map(b =>
        b.id === id ? { ...b, status: "disconnected" as const, token_generated_at: null } : b
      ));
      toast.info("Broker disconnected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBrokerBusy(prev => { const n = { ...prev }; delete n[`disconnect:${id}`]; return n; });
    }
  }, []);

  // ── Broker: open Fyers auth page ─────────────────────────────────────────
  const handleGetFyersAuthUrl = useCallback(async (id: string) => {
    setBrokerBusy(prev => ({ ...prev, [`authurl:${id}`]: true }));
    try {
      const { url } = await brokerFetch<{ url: string }>(`/api/broker-connections/${id}/auth-url`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate auth URL");
    } finally {
      setBrokerBusy(prev => { const n = { ...prev }; delete n[`authurl:${id}`]; return n; });
    }
  }, []);

  // ── Broker: delete ────────────────────────────────────────────────────────
  const handleBrokerDelete = useCallback(async (id: string) => {
    setBrokerBusy(prev => ({ ...prev, [`delete:${id}`]: true }));
    try {
      await brokerFetch(`/api/broker-connections/${id}`, { method: "DELETE" });
      setBrokers(prev => prev.filter(b => b.id !== id));
      toast.success("Broker removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove broker");
    } finally {
      setBrokerBusy(prev => { const n = { ...prev }; delete n[`delete:${id}`]; return n; });
    }
  }, []);

  async function handleBackup() {
    setBackupBusy(true);
    try {
      await createBackup();
      const now = new Date().toISOString();
      setLastBackup(now);
      toast.success("Backup downloaded successfully!");
    } catch (e) {
      toast.error(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setRestoreBusy(true);
    setRestoreLog([]);
    try {
      await restoreBackup(file, (msg) => setRestoreLog((prev) => [...prev, msg]));
      setLastBackup(new Date().toISOString());
      toast.success("Restore complete! Refresh the page to see all changes.");
    } catch (err) {
      toast.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <div className="bg-background">
      <main className="container py-2 flex gap-3 items-start">
        {/* Sidebar nav */}
        <Card className="shadow-card w-48 shrink-0 overflow-hidden">
          <div className="py-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                  activeSection === s.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="flex items-center gap-2.5 text-xs font-medium">
                  <s.icon className="h-3.5 w-3.5 shrink-0" />
                  {s.label}
                </span>
                <ChevronRight className={`h-3 w-3 transition-transform ${activeSection === s.id ? "text-primary" : "opacity-40"}`} />
              </button>
            ))}
          </div>
        </Card>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Profile */}
          {activeSection === "profile" && (
            <SectionCard title="Profile Settings" icon={User}>
              <SettingRow label="Display Name" description="Name shown across the app">
                <Input className="h-8 w-48 text-xs bg-input" value={profileName}
                  onChange={(e) => setProfileName(e.target.value)} />
              </SettingRow>
              <SettingRow label="Email Address" description="Used for alert notifications">
                <Input className="h-8 w-48 text-xs bg-input" value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)} />
              </SettingRow>
              <SettingRow label="Timezone" description="For market status display">
                <span className="text-xs text-foreground bg-muted px-2 py-1 rounded">IST (UTC+5:30)</span>
              </SettingRow>
              <div className="py-2">
                <Button size="sm" className="bg-gradient-primary text-primary-foreground hover:opacity-90 text-xs h-7 px-3"
                  onClick={saveProfile} disabled={profileSaving}>
                  {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Changes
                </Button>
              </div>
            </SectionCard>
          )}

          {/* Theme */}
          {activeSection === "theme" && (
            <SectionCard title="Theme Settings" icon={Palette}>
              <SettingRow label="App Theme" description="Switch between dark, light, or follow your OS setting">
                <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-input">
                  {([
                    { mode: "dark" as const,   icon: Moon,    label: "Dark" },
                    { mode: "light" as const,  icon: Sun,     label: "Light" },
                    { mode: "system" as const, icon: Monitor, label: "System" },
                  ]).map((t) => (
                    <button
                      key={t.mode}
                      type="button"
                      onClick={() => setTheme(t.mode)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        themeMode === t.mode
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <t.icon className="h-3 w-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Compact Mode" description="Reduce padding for denser data display">
                <ToggleSwitch checked={compactMode} onChange={() => setCompactMode(!compactMode)} />
              </SettingRow>

              <SettingRow label="Colour Scheme" description="Accent colour for the interface">
                <div className="flex items-center gap-2">
                  {ACCENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.label}
                      onClick={() => setAccentColor(opt.id)}
                      className={`h-5 w-5 rounded-full ${opt.cls} ring-offset-background transition-all ${
                        accentColor === opt.id
                          ? "ring-2 ring-foreground ring-offset-1 scale-110"
                          : "ring-2 ring-transparent hover:scale-110"
                      }`}
                    />
                  ))}
                </div>
              </SettingRow>
            </SectionCard>
          )}

          {/* Notifications */}
          {activeSection === "notifications" && (
            <SectionCard title="Notification Settings" icon={Bell}>
              <SettingRow label="Email Notifications" description="Receive alerts via email">
                <ToggleSwitch checked={notifs.email} onChange={() => toggleNotif("email")} />
              </SettingRow>
              <SettingRow label="Push Notifications" description="Browser push notifications">
                <ToggleSwitch checked={notifs.push} onChange={() => toggleNotif("push")} />
              </SettingRow>
              <SettingRow label="SMS Alerts" description="Critical price alerts via SMS">
                <ToggleSwitch checked={notifs.sms} onChange={() => toggleNotif("sms")} />
              </SettingRow>
              <SettingRow label="Scan Complete" description="Notify when a scan finishes">
                <ToggleSwitch checked={notifs.scanComplete} onChange={() => toggleNotif("scanComplete")} />
              </SettingRow>
              <SettingRow label="Alert Triggered" description="Notify when a price alert fires">
                <ToggleSwitch checked={notifs.alertTrigger} onChange={() => toggleNotif("alertTrigger")} />
              </SettingRow>
              <SettingRow label="Weekly Report" description="Weekly portfolio and scan summary">
                <ToggleSwitch checked={notifs.weeklyReport} onChange={() => toggleNotif("weeklyReport")} />
              </SettingRow>
            </SectionCard>
          )}

          {/* Scanner Preferences */}
          {activeSection === "scanner" && (
            <SectionCard title="Scanner Preferences" icon={ScanSearch}>
              <SettingRow label="Default Series" description="Default equity series for scans">
                <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-input">
                  {["EQ", "ETF", "ALL"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => updateScanner("defaultSeries", s)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                        scanner.defaultSeries === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label="Default Backtest Days" description="Default lookback period for backtests">
                <Input className="h-8 w-20 text-xs bg-input text-center" value={scanner.defaultBacktest}
                  onChange={(e) => updateScanner("defaultBacktest", e.target.value)}
                  onBlur={(e) => apiSaveSetting("scanner:defaultBacktest", e.target.value).catch(() => {})} />
              </SettingRow>
              <SettingRow label="Auto-Refresh Folder" description="Automatically reload CSV folder on launch">
                <ToggleSwitch checked={scanner.autoRefresh} onChange={() => updateScanner("autoRefresh", !scanner.autoRefresh)} />
              </SettingRow>
              <SettingRow label="Show Volume Column" description="Display volume in scan results">
                <ToggleSwitch checked={scanner.showVolume} onChange={() => updateScanner("showVolume", !scanner.showVolume)} />
              </SettingRow>
              <SettingRow label="Show Saved Scans Bar" description="Display the quick-access saved scans strip in Create Scan and Strategies Backtest pages">
                <ToggleSwitch
                  checked={scanner.showSavedScans}
                  onChange={() => {
                    const next = !scanner.showSavedScans;
                    localStorage.setItem("bharatscan:show-saved-scans", String(next));
                    setScanner(p => ({ ...p, showSavedScans: next }));
                  }}
                />
              </SettingRow>
              <SettingRow label="Home Index Price Source" description="Choose whether Nifty 50, Bank Nifty & Fin Nifty cards show Futures or Spot prices">
                <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-input">
                  {(["Futures", "Spot"] as const).map((opt) => {
                    const val = opt.toLowerCase() as "futures" | "spot";
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          localStorage.setItem("bharatscan:home-index-source", val);
                          setScanner(p => ({ ...p, homeIndexSource: val }));
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                          scanner.homeIndexSource === val
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </SectionCard>
          )}

          {/* API / Data Source */}
          {activeSection === "data" && (
            <div className="space-y-4">
              <MarketApiPanel />
              <DataSourcePanels />
              <SectionCard title="CSV Format Settings" icon={Database}>
                <SettingRow label="CSV Date Format" description="Date format in your NSE CSV files">
                  <span className="text-xs text-foreground bg-muted px-2 py-1 rounded font-mono">YYYY-MM-DD</span>
                </SettingRow>
                <SettingRow label="Symbol Column" description="Column name for stock ticker">
                  <span className="text-xs text-foreground bg-muted px-2 py-1 rounded font-mono">SYMBOL</span>
                </SettingRow>
                <SettingRow label="Volume Column" description="Column name for trade volume">
                  <span className="text-xs text-foreground bg-muted px-2 py-1 rounded font-mono">TOTTRDQTY</span>
                </SettingRow>
                <SettingRow label="Max Symbols to Load" description="Cap on number of symbols loaded from CSV">
                  <span className="text-xs text-foreground bg-muted px-2 py-1 rounded font-mono">5000</span>
                </SettingRow>
                <div className="py-2">
                  <p className="text-[10px] text-muted-foreground">
                    BharatScan processes all data locally — no API keys required. Your CSV files never leave your device.
                  </p>
                </div>
              </SectionCard>
            </div>
          )}

          {/* Import / Export */}
          {activeSection === "import" && (
            <SectionCard title="Import / Export Settings" icon={FileInput}>
              <SettingRow label="Export All Saved Scans" description="Download all scan configurations as a JSON file">
                <Button size="sm" variant="outline" className="text-xs h-7 px-3" onClick={handleExportAllScans} disabled={exporting}>
                  {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Export All
                </Button>
              </SettingRow>
              <SettingRow label="Import Scan Pack" description="Load multiple scan configurations from a JSON file">
                <Button size="sm" variant="outline" className="text-xs h-7 px-3" onClick={() => importScansRef.current?.click()} disabled={importingScans}>
                  {importingScans ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  Import Pack
                </Button>
                <input ref={importScansRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportScansFile} />
              </SettingRow>
              <SettingRow label="Export Results as CSV" description="Default format for scan result exports">
                <span className="text-xs text-foreground bg-muted px-2 py-1 rounded">CSV (comma-separated)</span>
              </SettingRow>
              <SettingRow label="Clear All Data" description="Wipe all saved scans, alerts, portfolios and localStorage">
                <Button size="sm" variant="outline" className="text-xs h-7 px-3 text-destructive-bright border-destructive-bright/40 hover:bg-destructive-bright/10"
                  onClick={() => setClearDialogOpen(true)}>
                  <Trash2 className="h-3 w-3" /> Clear All
                </Button>
              </SettingRow>
            </SectionCard>
          )}

          {/* Clear All confirmation dialog */}
          {clearDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <Card className="w-96 p-4 space-y-3 shadow-xl border-destructive/30">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                    <Trash2 className="h-5 w-5 text-destructive-bright" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Clear All Data</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      This will permanently delete all saved scans, alerts, portfolios, holdings, scanner dashboards, and local preferences. This action cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" className="text-xs h-7 px-3" onClick={() => setClearDialogOpen(false)} disabled={clearing}>
                    Cancel
                  </Button>
                  <Button size="sm" className="text-xs h-7 px-3 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleClearAll} disabled={clearing}>
                    {clearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Yes, Clear Everything
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Security */}
          {activeSection === "security" && (
            <SectionCard title="Security Settings" icon={Shield}>
              <SettingRow label="Data Privacy" description="All computation runs 100% in your browser">
                <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded border border-success/20">Fully Local</span>
              </SettingRow>
              <SettingRow label="Network Requests" description="BharatScan never makes external API calls">
                <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded border border-success/20">Offline Ready</span>
              </SettingRow>
              <SettingRow label="Session Timeout" description="Automatically clear state after inactivity">
                <ToggleSwitch checked={false} onChange={() => {}} />
              </SettingRow>
              <div className="py-2 text-[10px] text-muted-foreground">
                Your bhavcopy data, scan configurations, and portfolio details are stored only in your browser's localStorage and local SQLite database. Nothing is transmitted to any external server.
              </div>
            </SectionCard>
          )}

          {/* Backup / Restore */}
          {activeSection === "backup" && (
            <div className="space-y-4">
              {/* Backup */}
              <SectionCard title="Create Backup" icon={Download}>
                <div className="py-3 space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Downloads a complete <span className="text-foreground font-medium">.json</span> file containing all your saved scans, portfolios, dashboards, alerts, scanner dashboards, app settings, and local preferences. Keep it safe — you can restore everything from this file.
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    {[
                      "Saved scans", "Portfolio dashboards", "Holdings & trades",
                      "Price alerts", "Scanner dashboards", "App settings & preferences",
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-1.5 text-muted-foreground">
                        <Check className="h-3 w-3 text-success shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Last backup</p>
                      <p className="text-xs font-medium text-foreground">{formatDate(lastBackup)}</p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-gradient-primary text-primary-foreground hover:opacity-90 text-xs gap-1.5 h-7 px-3"
                      onClick={handleBackup}
                      disabled={backupBusy}
                    >
                      {backupBusy
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Backing up…</>
                        : <><Download className="h-3.5 w-3.5" /> Download Backup</>
                      }
                    </Button>
                  </div>
                </div>
              </SectionCard>

              {/* Restore */}
              <SectionCard title="Restore from Backup" icon={Upload}>
                <div className="py-3 space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Select a previously downloaded <span className="text-foreground font-medium">bharatscan-backup-*.json</span> file to restore. This will <span className="text-destructive font-medium">replace all existing data</span> — scans, portfolios, alerts, and settings — with the backup contents.
                  </p>

                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[11px] text-destructive flex items-start gap-2">
                    <span className="shrink-0 mt-0.5">⚠️</span>
                    <span>All current data will be cleared before restoring. Create a fresh backup first if you want to keep your current data.</span>
                  </div>

                  {restoreLog.length > 0 && (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                      {restoreLog.map((msg, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground font-mono">
                          {i === restoreLog.length - 1 && restoreBusy
                            ? <><Loader2 className="inline h-2.5 w-2.5 animate-spin mr-1" />{msg}</>
                            : <><Check className="inline h-2.5 w-2.5 text-success mr-1" />{msg}</>
                          }
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <input
                      ref={restoreInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleRestoreFile}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1.5 h-7 px-3 border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => restoreInputRef.current?.click()}
                      disabled={restoreBusy}
                    >
                      {restoreBusy
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Restoring…</>
                        : <><Upload className="h-3.5 w-3.5" /> Choose Backup File</>
                      }
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* Broker Connect */}
          {activeSection === "broker" && (
            <SectionCard title="Broker Connections" icon={Plug}>
              <div className="py-3 space-y-3">

                {/* Loading */}
                {brokersLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Broker rows */}
                {!brokersLoading && brokers.map(broker => {
                  const totp = brokerTotps[broker.id] ?? "";
                  const connecting    = brokerBusy[`connect:${broker.id}`]    ?? false;
                  const disconnecting = brokerBusy[`disconnect:${broker.id}`] ?? false;
                  const deleting      = brokerBusy[`delete:${broker.id}`]     ?? false;
                  const needsTotp     = broker.status !== "connected";
                  const dotCls        = broker.status === "connected"
                    ? "bg-emerald-400"
                    : broker.status === "expired"
                    ? "bg-amber-400"
                    : "bg-muted-foreground/30";
                  const statusLabel   = broker.status === "connected"
                    ? "Connected"
                    : broker.status === "expired"
                    ? "Session Expired"
                    : "Disconnected";

                  return (
                    <div key={broker.id} className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                      {/* Header row */}
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
                          <span className="text-xs font-semibold truncate">{broker.display_name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{statusLabel}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {broker.status === "connected" && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Disconnect" disabled={disconnecting}
                              onClick={() => handleBrokerDisconnect(broker.id)}>
                              {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" title="Remove" disabled={deleting}
                            onClick={() => handleBrokerDelete(broker.id)}>
                            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>

                      {/* Details + TOTP */}
                      <div className="px-3 py-2 space-y-2">
                        {broker.token_generated_at && (
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                            <div>
                              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-0.5">Last Connected</span>
                              {formatDate(broker.token_generated_at)}
                            </div>
                            <div>
                              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-0.5">Session Valid Until</span>
                              {(() => {
                                const d = new Date(broker.token_generated_at);
                                d.setHours(d.getHours() + 24);
                                return formatDate(d.toISOString());
                              })()}
                            </div>
                          </div>
                        )}
                        {needsTotp && broker.broker_name === "fyers" && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="bg-muted rounded-full h-4 w-4 flex items-center justify-center text-[9px] font-bold shrink-0">1</span>
                              Open the Fyers auth page and log in, then copy the auth code from the redirect URL.
                            </div>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 px-3 w-full"
                              disabled={brokerBusy[`authurl:${broker.id}`] ?? false}
                              onClick={() => handleGetFyersAuthUrl(broker.id)}>
                              {brokerBusy[`authurl:${broker.id}`]
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <ExternalLink className="h-3 w-3" />}
                              Open Fyers Auth Page
                            </Button>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-0.5">
                              <span className="bg-muted rounded-full h-4 w-4 flex items-center justify-center text-[9px] font-bold shrink-0">2</span>
                              Paste the <code className="font-mono">auth_code</code> from the redirect URL below.
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                value={totp}
                                onChange={e => setBrokerTotps(prev => ({ ...prev, [broker.id]: e.target.value.trim() }))}
                                placeholder="Paste auth_code here"
                                className="h-7 text-xs font-mono bg-input flex-1 min-w-0"
                              />
                              <Button size="sm" className="h-7 text-xs gap-1 px-3 shrink-0"
                                disabled={!totp || connecting}
                                onClick={() => handleBrokerConnect(broker.id)}>
                                {connecting
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : broker.status === "expired"
                                  ? <><RefreshCw className="h-3 w-3" />Reconnect</>
                                  : <><PlugZap className="h-3 w-3" />Connect</>}
                              </Button>
                            </div>
                          </div>
                        )}
                        {needsTotp && broker.broker_name !== "fyers" && (
                          <div className="flex items-center gap-2">
                            <Input
                              value={totp}
                              onChange={e => setBrokerTotps(prev => ({ ...prev, [broker.id]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                              placeholder="6-digit TOTP"
                              maxLength={6}
                              className="h-7 text-xs font-mono w-28 shrink-0 bg-input"
                            />
                            <Button size="sm" className="h-7 text-xs gap-1 px-3" disabled={totp.length < 6 || connecting}
                              onClick={() => handleBrokerConnect(broker.id)}>
                              {connecting
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : broker.status === "expired"
                                ? <><RefreshCw className="h-3 w-3" />Reconnect</>
                                : <><PlugZap className="h-3 w-3" />Connect</>}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Empty state */}
                {!brokersLoading && brokers.length === 0 && !showAddBroker && (
                  <p className="py-3 text-center text-xs text-muted-foreground/60">No brokers added yet.</p>
                )}

                {/* Add broker form */}
                {showAddBroker && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
                    {/* Broker type selector */}
                    <div className="flex gap-1 p-0.5 rounded-md bg-muted/50 border border-border/50">
                      {([["angel_one", "Angel One"], ["fyers", "Fyers"]] as const).map(([val, label]) => (
                        <button key={val} type="button"
                          className={`flex-1 text-[10px] font-semibold py-1 rounded transition-colors ${addBrokerType === val ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => {
                            setAddBrokerType(val);
                            setAddBrokerForm({ display_name: val === "fyers" ? "Fyers" : "Angel One", api_key: "", client_code: "", pin: "" });
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Angel One fields */}
                    {addBrokerType === "angel_one" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Display Name</p>
                          <Input value={addBrokerForm.display_name}
                            onChange={e => setAddBrokerForm(f => ({ ...f, display_name: e.target.value }))}
                            placeholder="Angel One" className="h-7 text-xs bg-input" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Client Code</p>
                          <Input value={addBrokerForm.client_code}
                            onChange={e => setAddBrokerForm(f => ({ ...f, client_code: e.target.value }))}
                            placeholder="e.g. A123456" autoComplete="off" className="h-7 text-xs font-mono bg-input" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <p className="text-[10px] text-muted-foreground">API Key (SmartAPI)</p>
                          <Input value={addBrokerForm.api_key}
                            onChange={e => setAddBrokerForm(f => ({ ...f, api_key: e.target.value }))}
                            placeholder="SmartAPI key" autoComplete="off" className="h-7 text-xs font-mono bg-input" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <p className="text-[10px] text-muted-foreground">PIN</p>
                          <Input type="password" value={addBrokerForm.pin}
                            onChange={e => setAddBrokerForm(f => ({ ...f, pin: e.target.value }))}
                            placeholder="4-digit login PIN" autoComplete="new-password" className="h-7 text-xs bg-input" />
                        </div>
                      </div>
                    )}

                    {/* Fyers fields */}
                    {addBrokerType === "fyers" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Display Name</p>
                          <Input value={addBrokerForm.display_name}
                            onChange={e => setAddBrokerForm(f => ({ ...f, display_name: e.target.value }))}
                            placeholder="Fyers" className="h-7 text-xs bg-input" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">App ID</p>
                          <Input value={addBrokerForm.api_key}
                            onChange={e => setAddBrokerForm(f => ({ ...f, api_key: e.target.value }))}
                            placeholder="e.g. XY1234-100" autoComplete="off" className="h-7 text-xs font-mono bg-input" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <p className="text-[10px] text-muted-foreground">Secret Key</p>
                          <Input type="password" value={addBrokerForm.client_code}
                            onChange={e => setAddBrokerForm(f => ({ ...f, client_code: e.target.value }))}
                            placeholder="App secret from Fyers API dashboard" autoComplete="new-password" className="h-7 text-xs font-mono bg-input" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <p className="text-[10px] text-muted-foreground">Redirect URI</p>
                          <Input value={addBrokerForm.pin}
                            onChange={e => setAddBrokerForm(f => ({ ...f, pin: e.target.value }))}
                            placeholder="https://your-redirect-uri" autoComplete="off" className="h-7 text-xs font-mono bg-input" />
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground/60">Credentials are encrypted with AES-256-GCM before storage and never leave the server.</p>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-3"
                        onClick={() => setShowAddBroker(false)}>Cancel</Button>
                      <Button size="sm" className="h-7 text-xs gap-1 px-3"
                        disabled={!addBrokerForm.api_key || !addBrokerForm.client_code || !addBrokerForm.pin || addBrokerSaving}
                        onClick={handleAddBroker}>
                        {addBrokerSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                        Save Credentials
                      </Button>
                    </div>
                  </div>
                )}

                {/* Add button */}
                {!showAddBroker && (
                  <div className="pt-1 flex justify-end border-t border-border/30">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 px-3 mt-2"
                      onClick={() => setShowAddBroker(true)}>
                      <Plus className="h-3 w-3" /> Add Broker
                    </Button>
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      </main>
    </div>
  );
}
