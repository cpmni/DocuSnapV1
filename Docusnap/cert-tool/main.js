'use strict';

/**
 * cert-tool/main.js
 * -----------------
 * Electron MAIN process for the ScanFinder Cert Tool — a small desktop utility
 * that generates a per-customer TLS certificate set (isolated CA + server cert)
 * for the detached-client API. Cert generation is pure JS (node-forge); the
 * renderer never touches the filesystem or crypto directly (contextIsolation).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { generateCustomerCerts } = require('./certgen');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 780, height: 760, minWidth: 640, minHeight: 620,
    backgroundColor: '#0c0e14',
    title: 'ScanFinder Cert Tool',
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

ipcMain.handle('cert-pick-outdir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return (r.canceled || !r.filePaths[0]) ? null : r.filePaths[0];
});

ipcMain.handle('cert-generate', async (_e, opts) => {
  try { return { ok: true, result: generateCustomerCerts(opts || {}) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle('cert-open-folder', async (_e, dir) => { if (dir) await shell.openPath(dir); return true; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
