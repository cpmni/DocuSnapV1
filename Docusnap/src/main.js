'use strict';

/**
 * main.js — Electron main process
 *
 * Thin IPC router. All business logic lives in src/modules/.
 * Each module registers its own IPC handlers via module.register(ipcMain, getDb, ...).
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Module imports ────────────────────────────────────────────────────────────
const logger           = require('./modules/logger');
const authModule       = require('./modules/auth/handler');
const processingModule = require('./modules/processing/handler');
const reviewModule     = require('./modules/review/handler');
const settingsModule   = require('./modules/settings/handler');
const filingModule     = require('./modules/filing/handler');
const searchModule     = require('./modules/search/handler');
const processingModeModule = require('./modules/processing/processing_mode_handler');
const watchModule          = require('./modules/watch/handler');
const templatesModule      = require('./modules/templates/handler');
const licensingModule      = require('./modules/licensing/handler');

// ── DB ────────────────────────────────────────────────────────────────────────
let _db = null;
function getDb() {
  if (!_db) _db = require('../database/index').open();
  return _db;
}

// ── Resource paths ────────────────────────────────────────────────────────────
function resourcePath(...parts) {
  // In dev: __dirname = .../docusnap2/src  → go up one level to project root
  // In packaged: use process.resourcesPath
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..');
  return path.join(base, ...parts);
}

function pythonExe() {
  return app.isPackaged
    ? resourcePath('vendor', 'python', 'python.exe')
    : 'py';
}

function pythonArgs(script, ...args) {
  return app.isPackaged ? [script, ...args] : ['-3.12', script, ...args];
}

function tesseractPath() {
  return app.isPackaged
    ? resourcePath('vendor', 'tesseract', 'tesseract.exe')
    : 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
}

function backendScript() {
  return resourcePath('python_backend', 'process_docs.py');
}

function configPath() {
  return resourcePath('config', 'keyword_patterns.json');
}

function templatesDir() {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'templates')
    : resourcePath('templates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Window management ─────────────────────────────────────────────────────────
const windows = {};

// Doc id to focus when the review window opens via "Edit in Review" from Search.
// Cleared by get-review-target (pulled by the renderer after loadQueue) or
// consumed immediately if the review window is already open.
let pendingReviewDocId = null;
// Same pattern for "open Settings focused on a template" (from Review's "Add to
// Template Manager") — pulled by the settings renderer after loadTemplates(), or
// delivered immediately if the settings window is already open.
let pendingSettingsTemplateId = null;

const MAIN_WINDOW_OPTIONS    = { width: 1100, height: 750, minWidth: 800, minHeight: 560 };
const LOGIN_WINDOW_OPTIONS   = { width: 460, height: 660, resizable: false, minimizable: false, maximizable: false };
const LICENSE_WINDOW_OPTIONS = { width: 460, height: 560, resizable: false, minimizable: false, maximizable: false };

// Swap the whole app shell between "logged out" and "in the app". The login
// window is always created BEFORE the others are closed, so the app never
// passes through a zero-window moment that would trip window-all-closed.
function showLoginScreen() {
  createWindow('login', LOGIN_WINDOW_OPTIONS, 'index.html');
  Object.keys(windows).forEach((name) => {
    if (name !== 'login') windows[name]?.close();
  });
}

// Raw shell open — only ever reached AFTER the licensing gate has allowed it.
function openMainShell() {
  createWindow('main', MAIN_WINDOW_OPTIONS, 'index.html');
  windows['login']?.close();
  windows['license']?.close();
}

// Licensing gate (Phase 2). The MAIN process is the sole decider; the renderer
// only signals intent. With enforcement OFF (default) decideAccess() returns
// 'allow', so this is behaviourally identical to before. When enforcement is
// ON and access cannot continue, route to the license window instead of main.
async function enterMainApp() {
  let gate = { decision: 'allow', enforcement: false };
  try { gate = await licensingModule.decideAccess(); }
  catch (e) { logger.err('licensing gate error (failing closed): ' + e.message); gate = { decision: 'locked_needs_online', reason: 'gate_error' }; }
  if (gate.decision === 'allow') { openMainShell(); return; }
  showLicenseWindow(gate);
}

function showLicenseWindow(gate) {
  const alreadyOpen = !!windows['license'];
  const win = createWindow('license', LICENSE_WINDOW_OPTIONS, 'index.html');
  Object.keys(windows).forEach((name) => {
    if (name !== 'license') windows[name]?.close();
  });
  if (!win) return;
  const pushState = () => { try { win.webContents.send('license-state', gate); } catch {} };
  // Fresh window: push the blocked reason once it has loaded. Re-entry — the gate
  // bounced access back to an ALREADY-open license window (e.g. a trial the backend
  // reported active but the gate denied as expired): did-finish-load won't fire
  // again, so push immediately so the renderer can replace any optimistic
  // "Opening…" with the real denial reason instead of appearing stuck.
  if (alreadyOpen && !win.webContents.isLoading()) pushState();
  else win.webContents.once('did-finish-load', pushState);
}

// Lightweight startup splash — purely cosmetic, no IPC, no preload. Shown
// immediately in app.whenReady() and torn down once the first window (login)
// has finished loading. It never participates in the login/license/main swap
// logic below, so it cannot interfere with the gate or the launchpad.
let splashShownAt = 0;
function createSplash() {
  const pkg = require('../package.json');
  const splash = new BrowserWindow({
    width: 420, height: 300,
    frame: false, resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, center: true,
    backgroundColor: '#0c0e14',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { contextIsolation: true },
  });
  const query = {
    version:   app.getVersion(),
    copyright: (pkg.build && pkg.build.copyright) || '',
  };
  splash.loadFile(path.join(__dirname, 'windows', 'splash', 'index.html'), { query });
  splash.once('ready-to-show', () => { splash.show(); splashShownAt = Date.now(); });
  splash.on('closed', () => { delete windows['splash']; });
  windows['splash'] = splash;
  return splash;
}

// Close the splash once the app is ready, but hold it on screen for a fixed
// minimum so it reads as a real splash rather than flashing on and off. The
// window is shown on 'ready-to-show' and the timer is measured from THAT moment
// (splashShownAt), so the 3 seconds is 3 seconds of actual visibility, not of
// load time. closeSplash() is only called once the next window is ready (login
// 'did-finish-load', plus an 8s safety backstop), so the splash also never
// disappears before there's something to transition to. The setTimeout keeps
// this non-blocking — the login window loads underneath while the splash waits.
const SPLASH_MIN_VISIBLE_MS = 3000;
function closeSplash() {
  const s = windows['splash'];
  if (!s || s.isDestroyed()) return;
  const elapsed = splashShownAt ? Date.now() - splashShownAt : 0;
  const wait    = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
  setTimeout(() => { const w = windows['splash']; if (w && !w.isDestroyed()) w.close(); }, wait);
}

function createWindow(name, options, htmlFile) {
  if (windows[name]) { windows[name].focus(); return windows[name]; }

  const win = new BrowserWindow({
    ...options,
    frame:          false,
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
  });

  win.loadFile(path.join(__dirname, 'windows', name, 'index.html'));
  win.on('closed', () => { delete windows[name]; });
  windows[name] = win;
  return win;
}

function getMainWindow()   { return windows['main'];     }
function notifyMainWindow(channel, ...args) {
  windows['main']?.webContents.send(channel, ...args);
  windows['review']?.webContents.send(channel, ...args);
}

function notifyAllWindows(channel, ...args) {
  Object.values(windows).forEach(w => w?.webContents.send(channel, ...args));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Splash first, before any other startup work, so it appears immediately.
  createSplash();

  const logFile = app.isPackaged
    ? path.join(app.getPath('userData'), 'processing.log')
    : path.join(__dirname, '..', 'processing.log');
  logger.init(logFile, fs);

  // App opens to the login screen — first-run setup, sign-in, forced password
  // change and admin recovery all live there. The main shell only appears
  // once auth-handler confirms a session is established (see 'auth-enter-app').
  const loginWin = createWindow('login', LOGIN_WINDOW_OPTIONS, 'index.html');
  // Tear the splash down once the login window has rendered. Safety timeout
  // guarantees it never lingers even if did-finish-load somehow doesn't fire.
  loginWin?.webContents.once('did-finish-load', closeSplash);
  setTimeout(closeSplash, 8000);

  // Register all module IPC handlers
  const ctx = {
    ipcMain, getDb,
    resourcePath, pythonExe, pythonArgs, tesseractPath,
    backendScript, configPath, templatesDir,
    createWindow, getMainWindow, notifyMainWindow, notifyAllWindows,
    windows,
    app, fs, logger,
    spawn: require('child_process').spawn,
    path,
  };

  authModule.register(ctx);
  // The login window owns these transitions but has no window-management
  // powers of its own (by design — preload only exposes auth IPC there);
  // it just signals "I'm done" and main.js performs the swap.
  ipcMain.on('auth-enter-app',   () => enterMainApp());
  ipcMain.on('auth-show-login',  () => showLoginScreen());
  // Licensing gate signal (Phase 2): the renderer can only REQUEST entry; the
  // main process re-runs decideAccess() and refuses unless the state allows.
  // The renderer can never self-grant access into the main shell.
  ipcMain.on('license-enter-app', () => enterMainApp());

  processingModule.register(ctx);
  reviewModule.register(ctx);
  settingsModule.register(ctx);
  filingModule.register(ctx);
  searchModule.register(ctx);
  processingModeModule.register(ctx);
  watchModule.register(ctx);
  templatesModule.register(ctx);
  // Licensing — Phase 1: registers read-only status/trial-start IPC only.
  // NO gate and NO denial path (enforcement OFF); the enterMainApp() flow below
  // is untouched, so app launch behavior is unchanged.
  licensingModule.register(ctx);

  // Window controls (shared across all windows)
  ipcMain.on('window-minimise', e =>
    BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on('window-maximise', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w?.isMaximized() ? w.unmaximize() : w?.maximize();
  });
  ipcMain.on('window-close', e =>
    BrowserWindow.fromWebContents(e.sender)?.close());

  // Window openers
  ipcMain.on('open-review-window', () => {
    // Every action inside Review — view queue, edit, confirm, defer, delete,
    // reprocess — is Admin/Edit territory (see review/handler.js). Read Only
    // has nothing to do there; their "search/view documents" surface is Search.
    if (!authModule.hasRole('admin', 'edit')) return;
    createWindow('review', { width: 1200, height: 800, minWidth: 900, minHeight: 600 });
  });

  // Open Review focused on a specific document (e.g. from "Edit in Review" in Search).
  ipcMain.on('open-review-window-at', (_e, docId) => {
    if (!authModule.hasRole('admin', 'edit')) return;
    authModule.logAudit(getDb(), {
      action: 'search_open_review', target_type: 'document',
      target_id: docId, details: 'source:search',
    });
    const alreadyOpen = !!windows['review'];
    pendingReviewDocId = docId;
    createWindow('review', { width: 1200, height: 800, minWidth: 900, minHeight: 600 });
    if (alreadyOpen) {
      // Window is loaded — send event directly; no need to poll via get-review-target.
      windows['review'].webContents.send('navigate-to-doc', docId);
      pendingReviewDocId = null;
    }
    // else: new window — renderer calls get-review-target after loadQueue() completes.
  });

  // Renderer pulls this once after loadQueue() to get its initial navigation target.
  ipcMain.handle('get-review-target', () => {
    const id = pendingReviewDocId;
    pendingReviewDocId = null;
    return id;
  });
  ipcMain.on('open-settings-window', () => {
    // Settings (output folder, processing mode, document types/fields, file
    // naming, user management) is the "access all settings" surface called
    // out as Admin-exclusive — Edit/Read Only are not meant to reach it at
    // all, not just see it with options greyed out.
    if (!authModule.hasRole('admin')) return;
    createWindow('settings', { width: 1100, height: 680, minWidth: 900, minHeight: 520 });
  });

  // Open Settings focused on a specific template (from Review → "Add to
  // Template Manager"), so its sample loads in the editor preview automatically.
  ipcMain.on('open-settings-window-at-template', (_e, templateId) => {
    if (!authModule.hasRole('admin')) return;
    const alreadyOpen = !!windows['settings'];
    pendingSettingsTemplateId = templateId;
    createWindow('settings', { width: 1100, height: 680, minWidth: 900, minHeight: 520 });
    if (alreadyOpen) {
      windows['settings'].webContents.send('navigate-to-template', templateId);
      pendingSettingsTemplateId = null;
    }
  });

  ipcMain.handle('get-settings-template-target', () => {
    const id = pendingSettingsTemplateId;
    pendingSettingsTemplateId = null;
    return id;
  });
  ipcMain.on('open-search-window', () => {
    if (!authModule.getCurrentUser()) return;
    createWindow('search', { width: 1200, height: 780, minWidth: 1000, minHeight: 600 });
  });
});

app.on('window-all-closed', () => { app.quit(); });
