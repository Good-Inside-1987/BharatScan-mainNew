'use strict';

/**
 * electron/main.js
 *
 * Electron main process — thin wrapper around the existing Express backend
 * and React frontend. No server or frontend logic lives here; this file only:
 *
 *  1. Sets APP_ENV=local and DB_DIR to the OS user-data folder BEFORE the
 *     server child process starts, so environment.ts picks them up correctly.
 *  2. Spawns the Express server as a child process (tsx in dev, compiled JS
 *     in a packaged build).
 *  3. Polls the health endpoint until the server is ready, then (in dev mode)
 *     also waits for the Vite dev server before opening the BrowserWindow.
 *  4. Kills the Express child process cleanly when all windows are closed.
 *
 * Dev mode  (isDev = true):  BrowserWindow loads http://localhost:<VITE_PORT>
 *                             Vite proxy forwards /api/* to Express.
 * Prod mode (app.isPackaged): Express serves the built frontend from its
 *                             dist/ folder; BrowserWindow loads Express directly.
 */

const { app, BrowserWindow, dialog } = require('electron');
const { spawn }                       = require('child_process');
const path                            = require('path');
const http                            = require('http');
const fs                              = require('fs');

// ── Port configuration ────────────────────────────────────────────────────────

const SERVER_PORT = parseInt(process.env.SERVER_PORT ?? '3001', 10);
const VITE_PORT   = parseInt(process.env.VITE_PORT   ?? '5000', 10);

const HEALTH_URL  = `http://localhost:${SERVER_PORT}/api/health`;

// Dev:  load the Vite dev server (which proxies /api/* to Express)
// Prod: load Express directly (it serves the built frontend under NODE_ENV=production)
const isDev  = !app.isPackaged;
const APP_URL = isDev
  ? `http://localhost:${VITE_PORT}`
  : `http://localhost:${SERVER_PORT}`;

// ── State ─────────────────────────────────────────────────────────────────────

let serverProcess = null;
let mainWindow    = null;

// ── Start Express backend ─────────────────────────────────────────────────────
// Called after app.whenReady() so app.getPath() is available.

function startServer(dataDir) {
  // Project root is one level up from this electron/ folder
  const projectRoot = path.resolve(__dirname, '..');

  let cmd, args, cwd;
  const extraEnv = {};

  if (isDev) {
    // Dev: run server source directly via tsx (no pre-build required)
    cmd  = path.join(projectRoot, 'server', 'node_modules', '.bin', 'tsx');
    args = [path.join(projectRoot, 'server', 'src', 'index.ts')];
    cwd  = projectRoot;
  } else {
    // Packaged: server dist is in extraResources alongside the app bundle.
    // process.resourcesPath = <app>.app/Contents/Resources on macOS,
    //                         resources/ on Windows/Linux.
    cmd  = process.execPath;   // node bundled inside Electron
    args = [path.join(process.resourcesPath, 'server-dist', 'index.js')];
    cwd  = path.join(process.resourcesPath, 'server-dist');
    // Tell Electron's bundled binary to run this script as plain Node.js
    // instead of launching a second Electron app instance.
    extraEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  const childEnv = {
    ...process.env,
    APP_ENV:     'local',
    DB_DIR:      dataDir,
    SERVER_PORT: String(SERVER_PORT),
    NODE_ENV:    isDev ? 'development' : 'production',
    ...extraEnv,
  };

  serverProcess = spawn(cmd, args, {
    env:   childEnv,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));

  serverProcess.on('error', (err) => {
    console.error('[electron] Server spawn failed:', err.message);
  });

  serverProcess.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0 && code !== null) {
      console.error('[electron] Server exited unexpectedly — code:', code);
    }
    serverProcess = null;
  });
}

// ── Poll until a URL returns 2xx ──────────────────────────────────────────────
// Resolves when the URL is reachable; rejects after maxAttempts.

function waitForUrl(url, { maxAttempts = 40, intervalMs = 500 } = {}) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function tryOnce() {
      attempts++;
      const req = http.get(url, (res) => {
        res.resume();   // drain body so the socket can be reused
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          schedule();
        }
      });
      req.on('error', schedule);
      req.setTimeout(400, () => { req.destroy(); schedule(); });
    }

    function schedule() {
      if (attempts >= maxAttempts) {
        reject(new Error(
          `Timed out waiting for ${url} after ${attempts} attempts (~${Math.round(attempts * intervalMs / 1000)}s)`
        ));
      } else {
        setTimeout(tryOnce, intervalMs);
      }
    }

    tryOnce();
  });
}

// ── Create BrowserWindow ──────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:   1440,
    height:  900,
    minWidth:  960,
    minHeight: 640,
    title: 'BharatScan',
    backgroundColor: '#0f1117',   // matches the dark theme so no white flash on load
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    },
  });

  mainWindow.loadURL(APP_URL);

  if (isDev) {
    // Open DevTools detached so they don't resize the main window
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Graceful server shutdown ───────────────────────────────────────────────────

function stopServer() {
  if (serverProcess) {
    console.log('[electron] Sending SIGTERM to server process…');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // ── 1. Determine per-user data directory ─────────────────────────────────
  //
  // app.getPath('userData') returns the OS-appropriate location:
  //   macOS  → ~/Library/Application Support/BharatScan
  //   Windows → %APPDATA%\BharatScan
  //   Linux   → ~/.config/BharatScan
  //
  // We create a 'bharatscan-data' subfolder inside that to hold .db files.
  // This is NEVER inside the project/git-tracked folder.
  const dataDir = path.join(app.getPath('userData'), 'bharatscan-data');
  fs.mkdirSync(dataDir, { recursive: true });

  console.log('[electron] Data directory:', dataDir);
  console.log('[electron] isDev:', isDev, '— loading from', APP_URL);

  // Propagate so any sibling code that reads process.env also sees them
  process.env.APP_ENV = 'local';
  process.env.DB_DIR  = dataDir;

  // ── 2. Start Express server ───────────────────────────────────────────────
  startServer(dataDir);

  // ── 3. Wait for server + (in dev) Vite dev server ────────────────────────
  try {
    await waitForUrl(HEALTH_URL, { maxAttempts: 40, intervalMs: 500 });
    console.log('[electron] ✓ Express server ready at', HEALTH_URL);

    if (isDev) {
      await waitForUrl(`http://localhost:${VITE_PORT}`, { maxAttempts: 30, intervalMs: 500 });
      console.log('[electron] ✓ Vite dev server ready at localhost:', VITE_PORT);
    }

    // ── 4. Open the window ────────────────────────────────────────────────
    createWindow();

  } catch (err) {
    console.error('[electron] Startup failed:', err.message);
    dialog.showErrorBox(
      'BharatScan — Startup Error',
      `The application could not start.\n\n${err.message}\n\nCheck the terminal for details.`
    );
    stopServer();
    app.quit();
  }
});

// Kill the Express child process when all windows are closed
app.on('window-all-closed', () => {
  stopServer();
  // macOS convention: keep the app in the dock even when all windows are closed.
  // Clicking the dock icon will re-create the window via 'activate'.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: re-open window when dock icon is clicked and no windows exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Also stop the server when the whole app is about to quit (e.g. Cmd+Q)
app.on('before-quit', stopServer);
