import type { FilterItem, LogicMode } from "./screener";
import type { CandleMode } from "./heikinAshi";
import {
  apiListScans,
  apiGetScan,
  apiCreateScan,
  apiUpdateScan,
  apiDeleteScan,
  type ApiScan,
} from "./api";

export interface SavedScan {
  id: string;
  name: string;
  /** Hierarchical filter format */
  filterItems?: FilterItem[];
  topLogicMode?: LogicMode;
  /** Legacy flat format — kept for backward compatibility with imported .json files */
  conditions?: FilterItem[];
  candleMode?: CandleMode;
  series: string;
  /** Visual-only tag indicating the intended trade direction for this scan */
  direction?: "long" | "short";
  savedAt: number;
  /** API-sourced metadata */
  folder?: string | null;
  is_favorite?: number;
  created_at?: string;
  updated_at?: string;
  last_run_at?: string | null;
}

/** Parse an API row into a SavedScan by expanding scan_json. */
function parseApiScan(row: ApiScan): SavedScan {
  let parsed: Partial<SavedScan> = {};
  try {
    parsed = JSON.parse(row.scan_json) as Partial<SavedScan>;
  } catch {
    /* ignore malformed json */
  }
  return {
    ...parsed,
    id: row.id,
    name: row.name,
    folder: row.folder,
    is_favorite: row.is_favorite,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_run_at: row.last_run_at,
    savedAt: new Date(row.updated_at).getTime(),
    series: (parsed as SavedScan).series ?? "EQ",
  };
}

/** Normalises a SavedScan to the filterItems/topLogicMode format,
 *  transparently upgrading old `conditions` arrays and API rows. */
export function migrateSavedScan(
  scan: SavedScan
): { filterItems: FilterItem[]; topLogicMode: LogicMode } {
  if (scan.filterItems) {
    return {
      filterItems: scan.filterItems,
      topLogicMode: scan.topLogicMode ?? "all",
    };
  }
  return { filterItems: scan.conditions ?? [], topLogicMode: "all" };
}

export async function listScans(): Promise<SavedScan[]> {
  try {
    const rows = await apiListScans();
    return rows.map(parseApiScan);
  } catch {
    return [];
  }
}

export async function getScan(id: string): Promise<SavedScan | null> {
  try {
    const row = await apiGetScan(id);
    return parseApiScan(row);
  } catch {
    return null;
  }
}

export async function saveScan(
  scan: Omit<SavedScan, "id" | "savedAt"> & { id?: string }
): Promise<SavedScan> {
  const scan_json = JSON.stringify({
    filterItems: scan.filterItems,
    topLogicMode: scan.topLogicMode,
    series: scan.series,
    candleMode: scan.candleMode,
    direction: scan.direction,
  });

  let row: ApiScan;
  if (scan.id) {
    row = await apiUpdateScan(scan.id, {
      name: scan.name,
      scan_json,
      folder: scan.folder ?? undefined,
    });
  } else {
    row = await apiCreateScan({
      name: scan.name,
      scan_json,
      folder: scan.folder ?? undefined,
    });
  }
  return parseApiScan(row);
}

export async function deleteScan(id: string): Promise<void> {
  await apiDeleteScan(id);
}

export async function clearScans(): Promise<void> {
  const all = await listScans();
  await Promise.all(all.map((s) => apiDeleteScan(s.id)));
}
