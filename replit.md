# BharatScan

A Chartink-inspired stock screener and backtesting tool for Indian markets — users upload NSE bhavcopy CSVs, define scan conditions using technical indicators, and run backtests entirely in the browser.

## Run & Operate

- `pnpm install` — install all workspace dependencies
- Start **"Start application"** workflow — Vite frontend on port 5000
- Start **"Backend API server"** workflow — Express API on port 3001
- For local dev: `pnpm dev` — starts both frontend + backend via concurrently
- Requires Node.js 22+ (uses `node:sqlite`, stable since Node 22.5). The Replit environment module is set to `nodejs-22`.
- Optional: set `BROKER_ENCRYPTION_KEY` secret to enable broker credential encryption (live broker integration). Not required for core scanning/backtesting/paper trading features — the server runs fine without it and just logs a warning.

## Stack

- **Monorepo**: pnpm workspaces (`artifacts/*`, `server/`, `scripts/`)
- **Frontend**: React 19, TypeScript, Vite 7
- **Styling**: Tailwind CSS v4, shadcn/ui (Radix-based components)
- **Routing**: react-router-dom
- **Data**: @tanstack/react-query, localStorage
- **Charts**: recharts
- **Animation**: framer-motion
- **Validation**: zod
- **Backend**: Express 4, Node.js built-in `node:sqlite` (no native compilation)

## Where things live

- `artifacts/bharatscan/` — main React app
  - `src/pages/Index.tsx` — main UI and workflow
  - `src/pages/PaperTrading.tsx` — virtual paper trading (stocks & options): accounts, positions, trade history
  - `src/lib/indicators.ts` — all technical indicators (SMA, EMA, RSI, MACD, Bollinger, Supertrend, CPR, Camarilla, Ichimoku, etc.)
  - `src/lib/screener.ts` — scan/backtest engine
  - `src/lib/dataLoader.ts` — CSV/folder parsing
  - `src/lib/universe.ts` — localStorage persistence for universe/holidays/quotes
  - `src/lib/savedScans.ts` — API-backed persistence for saved scans
  - `src/lib/api.ts` — typed fetch helpers for all REST endpoints
  - `src/lib/timeframe.ts` — bar resampling (daily → weekly/monthly/quarterly/yearly)
  - `src/components/` — UI components
  - `src/test/` — unit tests for pivots and timeframe resampling
- `server/` — Express backend
  - `src/index.ts` — server entry point (port 3001)
  - `src/db.ts` — SQLite setup via `node:sqlite`
  - `src/routes/scans.ts` — saved scan CRUD + favorite/duplicate endpoints
  - `src/routes/settings.ts` — app settings endpoints
  - `src/routes/paperTrading.ts` — paper trading accounts, positions, trades CRUD
- `bharatscan.db` — SQLite database (auto-created, gitignored)
- `pnpm-workspace.yaml` — workspace config and catalog versions

## Architecture decisions

- **Client-side computation**: all CSV parsing, indicator computation, and scanning runs in the browser
- **SQLite backend for saved scans**: Express + `node:sqlite` replaces the old IndexedDB approach; scan config stored as JSON in `scan_json` column
- **Vite proxy**: `/api` requests in dev mode are forwarded to `http://localhost:3001`
- **File System Access API**: uses `window.showDirectoryPicker()` for folder-based CSV loading; single CSVs also supported via file input
- **CPR label convention**: TC = max(rawTC, rawBC), BC = min — matches Chartink/Indian platform convention so TC is always the upper boundary
- **Heikin-Ashi**: `screener.ts` swaps in HA bars per-leaf, so every indicator automatically respects the HA toggle
- **node:sqlite**: chosen over better-sqlite3 to avoid native compilation; available in Node.js v22.5+
- **Paper trading margin model**: simplified — both long and short positions block full notional (qty × lot_size × price) as margin, no leverage/SPAN margin calc; closing releases margin + realized P&L back to cash_balance
- **Paper trading P&L cadence**: recomputes every 60s against the currently loaded CSV LTP (no live feed yet); designed so an Angel One SmartAPI feed can be swapped in later without UI changes

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check + db version |
| GET | /api/scans | List all scans (newest first) |
| POST | /api/scans | Create a scan |
| GET | /api/scans/:id | Get one scan |
| PUT | /api/scans/:id | Update a scan |
| DELETE | /api/scans/:id | Delete a scan |
| PATCH | /api/scans/:id/favorite | Toggle favorite |
| POST | /api/scans/:id/duplicate | Duplicate with "Copy of" prefix |
| GET | /api/settings | Get all settings |
| POST | /api/settings | Upsert a setting |
| GET | /api/paper-trading/accounts | List paper trading accounts |
| POST | /api/paper-trading/accounts | Create a paper trading account |
| PUT | /api/paper-trading/accounts/:id | Rename / add funds to an account |
| DELETE | /api/paper-trading/accounts/:id | Delete an account |
| POST | /api/paper-trading/accounts/:id/reset | Reset account to starting balance, wipe positions/trades |
| GET | /api/paper-trading/accounts/:id/positions | List open positions |
| POST | /api/paper-trading/accounts/:id/positions | Open a position (stock or option) |
| POST | /api/paper-trading/accounts/:id/positions/:posId/close | Close (fully/partially) a position |
| GET | /api/paper-trading/accounts/:id/trades | List closed trade history |

## Product

- Upload NSE EOD bhavcopy CSVs (folder or single file) and optional watchlist/options CSVs
- Build scan conditions using 20+ technical indicators with a visual condition editor
- Run scans to filter stocks matching all conditions
- Run backtests over configurable lookback periods
- Save, export, and import scan configurations
- Live/Past mode toggle; market status display
- Saved scans with favorite toggle, duplicate, and delete — backed by SQLite
- Paper trading: multiple virtual accounts, stock & option positions, margin blocking (full notional, no leverage), live P&L (refreshes every minute against currently loaded CSV data), trade history

## User preferences

_None recorded yet_

## Setup status

- Re-imported project verified again on 2026-07-12: ran `pnpm install` (node_modules was missing after re-import) and confirmed the `Backend API server` and `Start application` workflows both come up cleanly; frontend loads correctly in the preview.
- Re-imported project set up on 2026-07-12: `pnpm install` run; `Backend API server` (port 3001) and `artifacts/bharatscan: web` (the frontend, managed as a Replit artifact) workflows verified running. The old standalone "Start application" workflow was removed in favor of the artifact-managed one.
- Node.js module upgraded from `nodejs-20` to `nodejs-22` (via `.replit`) — required for `node:sqlite`, which needs Node.js v22.5+.
- `electron/package.json`: `electron` devDependency bumped from `^31.7.7` to `^40.0.0` — Electron 31 bundles Node 20 (no `node:sqlite`); Electron 40 bundles Node 24. Fixed a stale `node_modules/.bin/tsx` path in `electron/main.js` (tsx only hoists into `server/node_modules/.bin`, not the root) while verifying this.
- **Packaged Electron builds need `server/node_modules` bundled too** (2026-07-12 fix): `electron/main.js` spawns the packaged server as `resources/server-dist/index.js` with `cwd` set to `resources/server-dist`, so Node's module resolution never finds a `node_modules` folder unless one is placed there. `electron/package.json`'s `build` script now runs `predeploy-server` first — `pnpm --filter @workspace/server deploy --prod --legacy server-deploy` — which uses pnpm's own "deploy" command to materialize a **production-only** `node_modules` for the server package (devDependencies like `tsx`/`typescript` excluded) into `electron/server-deploy/` (gitignored). `extraResources` then copies `server-deploy/node_modules` to `server-dist/node_modules` in the packaged app, alongside the existing `server/dist` copy. Running `electron-builder` directly (bypassing `pnpm run build` in `electron/`) will skip this step and produce a broken package — always package via `pnpm --dir electron run build` (or the root `electron:build` script).
- Running Electron locally in this container requires extra system libs (glib, nss, gtk3, dbus, libgbm, etc., installed via Nix) since Electron ships its own Chromium; there is no display server here so the window itself can't render, but the spawned Express backend (and thus `node:sqlite`) starts and serves correctly.
- `API_KEY` and `BROKER_ENCRYPTION_KEY` are optional — the server warns but runs fine without them in dev. Set them (plus rotate for prod) if you want auth/broker-credential encryption enabled.

## Options broker-load feature

The Options Data Source card (Settings → API / Data Source) now has a **"Load from connected broker"** toggle that:

1. **Underlying dropdown** — NIFTY, BANKNIFTY, FINNIFTY, SENSEX, MIDCPNIFTY
2. **Expiry picker** — fetches available expiries from the broker via `GET /api/market-data/options/expiries?underlying=NIFTY`
3. **Date range + Load** — fetches 1-min candles for ATM ± 30 strikes (index) or ATM ± 20 strikes (stock), both CE and PE, saving into `options_intraday` via upsert
4. **Progress indicator** — shows X/Y contracts as they load
5. **Budget-aware** — respects `config.backfillDailyRequestBudget` (same as stock backfill)

New files:
- `server/src/services/optionsDataService.ts` — orchestrates the load
- New routes in `server/src/routes/marketData.ts`: `GET /options/expiries`, `POST /options/load` (SSE stream)
- New API helpers in `artifacts/bharatscan/src/lib/api.ts`: `apiGetOptionExpiries`, `apiLoadOptionsFromBroker` (async generator)
- `artifacts/bharatscan/src/components/DataSourcePanels.tsx` — Options panel extended with broker-load mode

Adapter changes:
- `Bar` type gained optional `oi?: number` (Fyers returns OI as 7th candle value for options/futures)
- `OptionChainData.strikes` now includes `ceSymbol?` / `peSymbol?` (full Fyers trading symbols extracted from chain rows)
- `FyersAdapter.getOptionChain` now captures `expiryData` (available expiries) and `underlying_ltp` (spot price) from the response
- `FyersAdapter.getOptionExpiries(underlying)` added — calls chain API without timestamp to get expiry list
- `AngelAdapter.getOptionExpiries` stub added (throws — not yet implemented)

Underlying → Fyers symbol mapping (in optionsDataService.ts):
- NIFTY → NSE:NIFTY50-INDEX · BANKNIFTY → NSE:NIFTYBANK-INDEX · FINNIFTY → NSE:FINNIFTY-INDEX
- SENSEX → BSE:SENSEX-INDEX · MIDCPNIFTY → NSE:MIDCPNIFTY-INDEX

## Gotchas

- `PORT` and `BASE_PATH` default to `5173` and `/` if not set (safe for local dev)
- `SERVER_PORT` defaults to `3001` if not set
- `window.showDirectoryPicker()` is only available in Chromium-based browsers (Chrome/Edge); Firefox users must use single-CSV upload
- CPR TC/BC labels are intentionally swapped from raw formula to match Indian platform conventions
- `node:sqlite` requires Node.js v22.5 or later (Node 24 recommended)
- `bharatscan.db` is gitignored — it will be created fresh on each machine on first startup

## Pointers

- [Vite config](artifacts/bharatscan/vite.config.ts)
- [Server entry](server/src/index.ts)
- [DB setup](server/src/db.ts)
- [API helpers](artifacts/bharatscan/src/lib/api.ts)
- [pnpm workspace](pnpm-workspace.yaml)
