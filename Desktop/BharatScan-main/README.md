# BharatScan

A Chartink-inspired stock screener and backtester for Indian markets. Upload NSE bhavcopy CSVs, define scan conditions using 20+ technical indicators, and run backtests entirely in the browser. All CSV parsing and computation happens client-side — your data never leaves your machine.

## Running locally (Mac / Windows / Linux)

### Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- pnpm — install once with `npm install -g pnpm`

### Setup

```bash
# 1. Install all dependencies
pnpm install

# 2. (Optional) Copy the example env file and adjust if needed
cp .env.example .env

# 3. Start both the frontend and backend together
pnpm dev
```

Then open **http://localhost:5173** in your browser.

The backend API server starts on **http://localhost:3001** by default.

### Environment variables

| Variable      | Default            | Description                         |
|---------------|--------------------|-------------------------------------|
| `PORT`        | `5173`             | Vite dev server port                |
| `BASE_PATH`   | `/`                | Vite base path                      |
| `SERVER_PORT` | `3001`             | Express API server port             |
| `DB_PATH`     | `./bharatscan.db`  | Path to the SQLite database file    |

### Note for first-time local setup

The `pnpm-workspace.yaml` was originally configured for Replit's Linux-only environment, which excluded platform-specific optional binaries (esbuild darwin/win32 builds, etc.) to save space. When running locally on **Mac or Windows**, you may need to remove the `overrides` block in `pnpm-workspace.yaml` that sets platform-specific packages to `"-"`, then re-run `pnpm install`. Those packages are optional and pnpm handles platform filtering automatically.

## Project structure

```
artifacts/bharatscan/   React + Vite frontend
server/                 Express + SQLite backend API
scripts/                Replit proxy helpers
```

## Data

- **Scan configurations** are stored in `bharatscan.db` (SQLite, created automatically on first run).
- **CSV bhavcopy data** is loaded directly in the browser — nothing is sent to the server.
- `bharatscan.db` is in `.gitignore` and will not be committed to version control.

## SQLite engine

The backend uses Node.js's built-in `node:sqlite` module (available in Node.js v22.5+). No native compilation or extra packages are needed — it works out of the box on Mac, Windows, and Linux.

## Running on Replit

Replit runs the frontend via the "Start application" workflow and the backend via the "Backend API server" workflow. Start both workflows from the Replit UI to use the full feature set.
