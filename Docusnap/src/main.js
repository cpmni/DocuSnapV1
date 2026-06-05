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
const processingModule = require('./modules/processing/handler');
const reviewModule     = require('./modules/review/handler');
const settingsModule   = require('./modules/settings/handler');
const filingModule     = require('./modules/filing/handler');
const searchModule     = require('./modules/search/handler');
const ollamaModule     = require('./modules/processing/ollama_handler');

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
    ? resourcePath('vendor', 'python', 'Scripts', 'python.exe')
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

// ── Ollama ────────────────────────────────────────────────────────────────────
let ollamaProcess = null;

function startOllama() {
  const exe = resourcePath('vendor', 'ollama', 'ollama.exe');
  if (!fs.existsSync(exe)) return;
  const { spawn } = require('child_process');
  ollamaProcess = spawn(exe, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_MODELS: resourcePath('vendor', 'ollama_models'),
      OLLAMA_HOST:   '127.0.0.1:11434',
    },
    windowsHide: true,
  });
}

function stopOllama() {
  if (ollamaProcess) { ollamaProcess.kill(); ollamaProcess = null; }
}

// ── Window management ─────────────────────────────────────────────────────────
const windows = {};

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
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startOllama();

  // Create main window
  createWindow('main', { width: 1100, height: 750, minWidth: 800, minHeight: 560 },
    'index.html');

  // Register all module IPC handlers
  const ctx = {
    ipcMain, getDb,
    resourcePath, pythonExe, pythonArgs, tesseractPath,
    backendScript, configPath,
    createWindow, getMainWindow, notifyMainWindow,
    windows,
    app, fs,
    spawn: require('child_process').spawn,
    path,
  };

  processingModule.register(ctx);
  reviewModule.register(ctx);
  settingsModule.register(ctx);
  filingModule.register(ctx);
  searchModule.register(ctx);
  ollamaModule.register(ctx);

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
  ipcMain.on('open-review-window', () =>
    createWindow('review', { width: 1200, height: 800, minWidth: 900, minHeight: 600 }));
  ipcMain.on('open-settings-window', () =>
    createWindow('settings', { width: 760, height: 640, minWidth: 640, minHeight: 480 }));
  ipcMain.on('open-search-window', () =>
    createWindow('search', { width: 1200, height: 780, minWidth: 1000, minHeight: 600 }));
});

app.on('window-all-closed', () => { stopOllama(); app.quit(); });
