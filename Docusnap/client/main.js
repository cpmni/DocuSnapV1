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
 * The user picks the core app's address on a connect screen; it is validated via
 * the version handshake and persisted in userData. The session token lives here,
 * never in the renderer. TLS uses normal certificate verification (no self-signed
 * bypass in the UI); SCANFINDER_CLIENT_ALLOW_SELF_SIGNED=1 is a dev-only override.
 *   SCANFINDER_CLIENT_API_URL  optional env override of the saved server (dev/launcher).
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('./apiClient');

const ALLOW_SELF_SIGNED = process.env.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';
let win = null;
let serverConfig = null;   // { host, port, tls } | null
let client = null;         // rebuilt whenever the server changes

const configPath = () => path.join(app.getPath('userData'), 'scanfinder-client.json');
const urlOf = (c) => `${c.tls ? 'https' : 'http'}://${c.host}:${c.port}`;

function loadServerConfig() {
  const env = process.env.SCANFINDER_CLIENT_API_URL; // env override wins (dev/launcher)
  if (env) { try { const u = new URL(env); return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), tls: u.protocol === 'https:' }; } catch { /* ignore */ } }
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return null; }
}
function saveServerConfig(c) { try { fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); } catch { /* ignore */ } }
function buildClient(c) { client = createClient({ baseUrl: urlOf(c), allowSelfSigned: ALLOW_SELF_SIGNED, ca: c.caPem || undefined }); }

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
// Server selection: the renderer asks for the saved address, or sets a new one
// (which rebuilds the client, validates via the handshake, and persists on success).
ipcMain.handle('client-get-server', () => serverConfig);
ipcMain.handle('client-set-server', async (_e, cfg) => {
  if (!cfg || !String(cfg.host || '').trim()) return { ok: false, mode: 'block', reason: 'Enter a server address.' };
  const norm = { host: String(cfg.host).trim(), port: Number(cfg.port) || 8765, tls: !!cfg.tls,
                 caPem: (cfg.caPem && String(cfg.caPem)) || null };
  buildClient(norm);
  let h; try { h = await client.connect(); } catch (e) { return { ok: false, mode: 'block', reason: e.message }; }
  if (h.ok) { serverConfig = norm; saveServerConfig(norm); } // persist only when reachable + compatible
  return h;
});
// Let the user pick the server's certificate (PEM) to trust — read in main, pinned
// as the https `ca` so verification stays on (works without the OS trust store).
ipcMain.handle('client-pick-cert', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the ScanFinder server certificate',
    properties: ['openFile'],
    filters: [{ name: 'Certificate', extensions: ['crt', 'pem', 'cer'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  try { return { ok: true, name: path.basename(r.filePaths[0]), pem: fs.readFileSync(r.filePaths[0], 'utf8') }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Import a connection profile (host + port + CA) exported by the core app's wizard —
// one-click enrollment: fills the connect form and pins the CA in one step.
ipcMain.handle('client-import-profile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import connection profile',
    properties: ['openFile'],
    filters: [{ name: 'ScanFinder profile', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  try {
    const p = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!p || !p.host || !p.caPem) return { ok: false, error: 'Not a valid ScanFinder connection profile.' };
    return {
      ok: true, host: String(p.host).trim(), port: Number(p.port) || 8765, tls: p.tls !== false,
      caPem: String(p.caPem), caFingerprint: p.caFingerprintSha256 || null, name: path.basename(r.filePaths[0]),
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('client-config',       () => ({ apiUrl: serverConfig ? urlOf(serverConfig) : null }));
ipcMain.handle('client-connect',      () => client ? client.connect() : { ok: false, mode: 'block', reason: 'No server configured.' });
ipcMain.handle('client-login',        (_e, { username, password, totp }) => client ? client.login(username, password, totp) : { ok: false, error: 'No server configured.' });
ipcMain.handle('client-logout',       () => client ? client.logout() : { ok: true });
ipcMain.handle('client-entitlement',  () => client ? client.entitlement() : { status: 0, json: null });
ipcMain.handle('client-search',       (_e, params) => client.search(params));
ipcMain.handle('client-get-document', (_e, id) => client.getDocument(id));
ipcMain.handle('client-get-pages',    (_e, id) => client.getPages(id));
ipcMain.handle('client-authed',       () => client ? client.isAuthenticated() : false);

// Mailbox / approval workflow.
ipcMain.handle('client-wf-list',       (_e, view) => client.workflow.list(view));
ipcMain.handle('client-wf-recipients', () => client.workflow.recipients());
ipcMain.handle('client-wf-assign',     (_e, { documentId, toUserId, actionRequired, comment }) =>
  client.workflow.assign(documentId, toUserId, actionRequired, comment));
ipcMain.handle('client-wf-claim',      (_e, { id, version }) => client.workflow.claim(id, version));
ipcMain.handle('client-wf-resolve',    (_e, { id, decision, comment, version }) =>
  client.workflow.resolve(id, decision, comment, version));
ipcMain.handle('client-wf-recall',     (_e, { id, version }) => client.workflow.recall(id, version));

app.whenReady().then(() => {
  serverConfig = loadServerConfig();
  if (serverConfig) buildClient(serverConfig);
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
