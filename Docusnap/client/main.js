'use strict';

/**
 * client/main.js
 * --------------
 * Electron MAIN process for the DETACHED ScanFinder search client — a separate
 * app from the core desktop app. It owns the only apiClient instance, so the
 * SESSION TOKEN lives here and NEVER reaches the renderer: the renderer calls a
 * narrow contextIsolated bridge (preload.js) → IPC → this process → apiClient →
 * the core app's /v1 API.
 *
 * Config via env (set by the launcher / lockstep packaging):
 *   SCANFINDER_CLIENT_API_URL        e.g. https://server-pc.lan:8765  (default loopback)
 *   SCANFINDER_CLIENT_ALLOW_SELF_SIGNED=1  trust an internal-CA / pinned dev cert
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createClient } = require('./apiClient');

const API_URL = process.env.SCANFINDER_CLIENT_API_URL || 'http://127.0.0.1:8765';
const ALLOW_SELF_SIGNED = process.env.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';

const client = createClient({ baseUrl: API_URL, allowSelfSigned: ALLOW_SELF_SIGNED });
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 940, minHeight: 600,
    backgroundColor: '#0c0e14',
    title: 'ScanFinder — Search',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (win.removeMenu) win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Renderer → main → apiClient. The token is never sent to the renderer.
ipcMain.handle('client-config',       () => ({ apiUrl: API_URL }));
ipcMain.handle('client-connect',      () => client.connect());
ipcMain.handle('client-login',        (_e, { username, password, totp }) => client.login(username, password, totp));
ipcMain.handle('client-logout',       () => client.logout());
ipcMain.handle('client-search',       (_e, params) => client.search(params));
ipcMain.handle('client-get-document', (_e, id) => client.getDocument(id));
ipcMain.handle('client-get-pages',    (_e, id) => client.getPages(id));
ipcMain.handle('client-authed',       () => client.isAuthenticated());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
