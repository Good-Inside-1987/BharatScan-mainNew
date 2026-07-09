import {
  apiListScans, apiCreateScan, apiDeleteScan, apiToggleFavorite,
  apiGetSettings, apiSaveSetting,
  apiListDashboards, apiCreateDashboard, apiDeleteDashboard,
  apiListPortfolios, apiDeletePortfolio,
  apiListHoldings, apiAddHolding,
  apiListBookedTrades, apiImportPortfolios,
  apiListAlerts, apiCreateAlert, apiDeleteAlert, apiToggleAlert,
  apiListScannerDashboards, apiCreateScannerDashboard, apiDeleteScannerDashboard,
  apiCreateScannerScan,
  apiExportPaperAccounts, apiImportPaperAccounts,
  type ApiScan, type ApiDashboard, type ApiPortfolio, type ApiHolding,
  type ApiBookedTrade, type ApiAlert, type ApiScannerDashboard,
  type ApiPaperAccountExport,
} from "./api";

const LS_BACKUP_KEYS = [
  "bharatscan-theme",
  "bharatscan-compact",
  "bharatscan-accent",
  "bharatscan:universe-categories",
  "bharatscan:market-holidays",
  "bharatscan:market-quotes",
  "bharatscan:show-saved-scans",
  "bharatscan:home-index-source",
  "bs:api-url",
  "bs:api-last-sync",
];

// Prefixes for dynamically-keyed localStorage entries (one per dashboard/portfolio
// etc.) that can't be enumerated as fixed keys up front.
const LS_BACKUP_PREFIXES = ["pnl_visible_"];

const LAST_BACKUP_KEY = "bharatscan:last-backup";

export interface PortfolioBackup extends ApiPortfolio {
  holdings: ApiHolding[];
  booked_trades: ApiBookedTrade[];
}

export interface BackupFile {
  version: 3;
  createdAt: string;
  scans: ApiScan[];
  settings: Record<string, string>;
  dashboards: ApiDashboard[];
  portfolios: PortfolioBackup[];
  alerts: ApiAlert[];
  scannerDashboards: ApiScannerDashboard[];
  paperAccounts: ApiPaperAccountExport[];
  localStorage: Record<string, string>;
}

export function getLastBackupTime(): string | null {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

export async function createBackup(): Promise<void> {
  const [scans, settings, dashboards, portfolios, alerts, scannerDashboards, paperAccounts] =
    await Promise.all([
      apiListScans(),
      apiGetSettings(),
      apiListDashboards(),
      apiListPortfolios(),
      apiListAlerts(),
      apiListScannerDashboards(),
      apiExportPaperAccounts(),
    ]);

  const portfolioData: PortfolioBackup[] = await Promise.all(
    portfolios.map(async (p) => ({
      ...p,
      holdings: await apiListHoldings(p.id),
      booked_trades: await apiListBookedTrades(p.id),
    }))
  );

  const lsData: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) {
    const matchesFixed = LS_BACKUP_KEYS.includes(key);
    const matchesPrefix = LS_BACKUP_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!matchesFixed && !matchesPrefix) continue;
    const val = localStorage.getItem(key);
    if (val !== null) lsData[key] = val;
  }

  const backup: BackupFile = {
    version: 3,
    createdAt: new Date().toISOString(),
    scans,
    settings,
    dashboards,
    portfolios: portfolioData,
    alerts,
    scannerDashboards,
    paperAccounts,
    localStorage: lsData,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bharatscan-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const now = new Date().toISOString();
  localStorage.setItem(LAST_BACKUP_KEY, now);
}

export interface BackupSummary {
  createdAt: string;
  version: number;
  scans: number;
  favoriteScans: number;
  dashboards: number;
  portfolios: number;
  holdings: number;
  bookedTrades: number;
  alerts: number;
  scannerDashboards: number;
  scannerScans: number;
  paperAccounts: number;
  paperPositions: number;
  paperTrades: number;
  settings: number;
  localPreferences: number;
}

export async function parseBackupFile(file: File): Promise<BackupFile> {
  const text = await file.text();
  let backup: BackupFile;
  try {
    backup = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error("Invalid backup file — could not parse JSON.");
  }
  if (!backup.version || !backup.createdAt) {
    throw new Error("Invalid backup file — missing version or createdAt.");
  }
  return backup;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  return {
    createdAt: backup.createdAt,
    version: backup.version,
    scans: backup.scans?.length ?? 0,
    favoriteScans: backup.scans?.filter((s) => s.is_favorite).length ?? 0,
    dashboards: backup.dashboards?.length ?? 0,
    portfolios: backup.portfolios?.length ?? 0,
    holdings: backup.portfolios?.reduce((sum, p) => sum + (p.holdings?.length ?? 0), 0) ?? 0,
    bookedTrades: backup.portfolios?.reduce((sum, p) => sum + (p.booked_trades?.length ?? 0), 0) ?? 0,
    alerts: backup.alerts?.length ?? 0,
    scannerDashboards: backup.scannerDashboards?.length ?? 0,
    scannerScans: backup.scannerDashboards?.reduce((sum, sd) => sum + (sd.scans?.length ?? 0), 0) ?? 0,
    paperAccounts: backup.paperAccounts?.length ?? 0,
    paperPositions: backup.paperAccounts?.reduce((sum, a) => sum + (a.positions?.length ?? 0), 0) ?? 0,
    paperTrades: backup.paperAccounts?.reduce((sum, a) => sum + (a.trades?.length ?? 0), 0) ?? 0,
    settings: Object.keys(backup.settings ?? {}).length,
    localPreferences: Object.keys(backup.localStorage ?? {}).length,
  };
}

export async function restoreBackup(
  file: File,
  onProgress?: (msg: string) => void
): Promise<void> {
  const log = (msg: string) => onProgress?.(msg);

  const backup = await parseBackupFile(file);

  log("Clearing existing data…");

  const [existingScans, existingDashboards, existingPortfolios,
         existingAlerts, existingScannerDashboards] = await Promise.all([
    apiListScans(),
    apiListDashboards(),
    apiListPortfolios(),
    apiListAlerts(),
    apiListScannerDashboards(),
  ]);

  await Promise.all([
    ...existingScans.map((s) => apiDeleteScan(s.id).catch(() => {})),
    ...existingDashboards.map((d) => apiDeleteDashboard(d.id).catch(() => {})),
    ...existingPortfolios.map((p) => apiDeletePortfolio(p.id).catch(() => {})),
    ...existingAlerts.map((a) => apiDeleteAlert(a.id).catch(() => {})),
    ...existingScannerDashboards.map((sd) => apiDeleteScannerDashboard(sd.id).catch(() => {})),
  ]);

  log("Restoring saved scans…");
  for (const scan of backup.scans ?? []) {
    try {
      const created = await apiCreateScan({
        name: scan.name,
        scan_json: scan.scan_json,
        folder: scan.folder ?? undefined,
      });
      if (scan.is_favorite) await apiToggleFavorite(created.id).catch(() => {});
    } catch {}
  }

  log("Restoring settings…");
  for (const [key, value] of Object.entries(backup.settings ?? {})) {
    await apiSaveSetting(key, value).catch(() => {});
  }

  log("Restoring portfolio dashboards…");
  const dashboardIdMap = new Map<string, string>();
  for (const d of backup.dashboards ?? []) {
    try {
      const created = await apiCreateDashboard({ name: d.name, color: d.color });
      dashboardIdMap.set(d.id, created.id);
    } catch {}
  }

  log("Restoring portfolios, holdings & booked trades…");
  // Group portfolios by dashboard so we can bulk-import per dashboard
  const byDashboard = new Map<string, typeof backup.portfolios>();
  for (const p of backup.portfolios ?? []) {
    const key = p.dashboard_id ?? "__none__";
    if (!byDashboard.has(key)) byDashboard.set(key, []);
    byDashboard.get(key)!.push(p);
  }
  for (const [origDashKey, portfolios] of byDashboard) {
    const newDashId = origDashKey !== "__none__" ? dashboardIdMap.get(origDashKey) : undefined;
    await apiImportPortfolios({
      portfolios: portfolios.map(p => ({
        name: p.name,
        notes: p.notes ?? undefined,
        holdings: (p.holdings ?? []).map(h => ({
          symbol: h.symbol,
          qty: h.qty,
          buy_price: h.buy_price,
          buy_date: h.buy_date,
          broker_account: h.broker_account ?? undefined,
          status: h.status,
        })),
        booked_trades: (p.booked_trades ?? []).map(b => ({
          symbol: b.symbol,
          qty: b.qty,
          buy_price: b.buy_price,
          sell_price: b.sell_price,
          buy_date: b.buy_date,
          sell_date: b.sell_date,
          realized_pnl: b.realized_pnl,
        })),
      })),
      dashboard_id: newDashId,
    }).catch(() => {});
  }

  log("Restoring alerts…");
  for (const a of backup.alerts ?? []) {
    try {
      const created = await apiCreateAlert({
        symbol: a.symbol,
        condition_type: a.condition_type,
        target_price: a.target_price,
        note: a.note,
        priority: a.priority,
        side: a.side ?? "buy",
      });
      if (a.status === "paused") await apiToggleAlert(created.id).catch(() => {});
    } catch {}
  }

  log("Restoring scanner dashboards…");
  for (const sd of backup.scannerDashboards ?? []) {
    try {
      const created = await apiCreateScannerDashboard({ name: sd.name, color: sd.color });
      for (const sc of sd.scans ?? []) {
        await apiCreateScannerScan(created.id, {
          name: sc.name,
          filter_json: sc.filter_json,
          series: sc.series,
          order_idx: sc.order_idx,
        }).catch(() => {});
      }
    } catch {}
  }

  log("Restoring paper trading accounts…");
  if (backup.paperAccounts?.length) {
    await apiImportPaperAccounts({
      accounts: backup.paperAccounts.map((a) => ({
        name: a.name,
        starting_balance: a.starting_balance,
        cash_balance: a.cash_balance,
        positions: (a.positions ?? []).map(({ id: _id, account_id: _accountId, ...rest }) => rest),
        trades: (a.trades ?? []).map(({ id: _id, account_id: _accountId, position_id: _positionId, ...rest }) => rest),
      })),
    }).catch(() => {});
  }

  log("Restoring local preferences…");
  for (const [key, value] of Object.entries(backup.localStorage ?? {})) {
    try { localStorage.setItem(key, value); } catch {}
  }

  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  log("Restore complete!");
}
