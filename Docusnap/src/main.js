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

const MAIN_WINDOW_OPTIONS  = { width: 1100, height: 750, minWidth: 800, minHeight: 560 };
const LOGIN_WINDOW_OPTIONS = { width: 460, height: 660, resizable: false, minimizable: false, maximizable: false };

// Swap the whole app shell between "logged out" and "in the app". The login
// window is always created BEFORE the others are closed, so the app never
// passes through a zero-window moment that would trip window-all-closed.
function showLoginScreen() {
  createWindow('login', LOGIN_WINDOW_OPTIONS, 'index.html');
  Object.keys(windows).forEach((name) => {
    if (name !== 'login') windows[name]?.close();
  });
}
function enterMainApp() {
  createWindow('main', MAIN_WINDOW_OPTIONS, 'index.html');
  windows['login']?.close();
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
  const logFile = app.isPackaged
    ? path.join(app.getPath('userData'), 'processing.log')
    : path.join(__dirname, '..', 'processing.log');
  logger.init(logFile, fs);

  // App opens to the login screen — first-run setup, sign-in, forced password
  // change and admin recovery all live there. The main shell only appears
  // once auth-handler confirms a session is established (see 'auth-enter-app').
  createWindow('login', LOGIN_WINDOW_OPTIONS, 'index.html');

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

  processingModule.register(ctx);
  reviewModule.register(ctx);
  settingsModule.register(ctx);
  filingModule.register(ctx);
  searchModule.register(ctx);
  processingModeModule.register(ctx);
  watchModule.register(ctx);
  templatesModule.register(ctx);

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
  ipcMain.on('open-search-window', () => {
    if (!authModule.getCurrentUser()) return;
    createWindow('search', { width: 1200, height: 780, minWidth: 1000, minHeight: 600 });
  });
});

app.on('window-all-closed', () => { app.quit(); });
