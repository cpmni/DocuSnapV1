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

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('./apiClient');

const ALLOW_SELF_SIGNED = process.env.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';
let win = null;
let serverConfig = null;   // { host, port, tls } | null
let client = null;         // rebuilt whenever the server changes

const configPath = () => path.join(app.getPath('userData'), 'scanfinder-client.json');
const clientIdPath = () => path.join(app.getPath('userData'), 'scanfinder-client-id');
const urlOf = (c) => `${c.tls ? 'https' : 'http'}://${c.host}:${c.port}`;

// A stable per-install id, generated ONCE and reused, so a returning client keeps its
// sticky seat across DHCP/IP changes (the server keys seats on client_id, else
// username@ip — an IP change otherwise looks like a brand-new client).
function getClientId() {
  try { const id = fs.readFileSync(clientIdPath(), 'utf8').trim(); if (id) return id; } catch { /* generate below */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(clientIdPath(), id); } catch { /* best-effort; falls back to username@ip server-side */ }
  return id;
}

function loadServerConfig() {
  const env = process.env.SCANFINDER_CLIENT_API_URL; // env override wins (dev/launcher)
  if (env) { try { const u = new URL(env); return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), tls: u.protocol === 'https:' }; } catch { /* ignore */ } }
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return null; }
}
function saveServerConfig(c) { try { fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); } catch { /* ignore */ } }
function buildClient(c) {
  client = createClient({
    baseUrl: urlOf(c), allowSelfSigned: ALLOW_SELF_SIGNED, ca: c.caPem || undefined,
    clientId: getClientId(), hostname: os.hostname(),
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 940, minHeight: 600,
    backgroundColor: '#0c0e14',
    title: 'ScanFinder — Search',
    icon: path.join(__dirname, 'assets', 'icon.ico'),   // app/window/taskbar icon (mirrors the core app)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (win.removeMenu) win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // KEYBOARD-FOCUS FIX (window-level — cures EVERY text field, current and future).
  // Without this, Electron can leave the web page without KEYBOARD focus on Windows, so a
  // click into a text field shows no cursor / won't type until you click out of the window and
  // back in (which re-activates keyboard focus). Buttons still work because they respond to the
  // mouse; only typing breaks. The CORE app already does this (src/main.js grabFocus →
  // win.webContents.focus()); the client did not. Give the web page keyboard focus on load and
  // whenever the window regains OS focus. NOTE: this is why NO per-field fix is needed — any
  // new <input>/<textarea> is covered automatically. (For a field you AUTO-focus when a view or
  // dialog opens, still defer the .focus() to requestAnimationFrame so Chromium doesn't drop a
  // focus issued the same tick the element is shown.)
  const grabFocus = () => { try { if (win && !win.isDestroyed()) win.webContents.focus(); } catch {} };
  win.webContents.on('did-finish-load', grabFocus);
  win.on('focus', grabFocus);
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

// One-shot CA bootstrap from the server (TOFU). The renderer confirms the returned
// fingerprint out-of-band before pinning it.
ipcMain.handle('client-fetch-ca', async (_e, { host, port, code } = {}) => {
  const h = String(host || '').trim();
  if (!h) return { ok: false, error: 'Enter a server address.' };
  const tmp = createClient({ baseUrl: `https://${h}:${Number(port) || 8765}`, allowSelfSigned: ALLOW_SELF_SIGNED });
  try { return await tmp.fetchCa(code); } catch (e) { return { ok: false, error: e.message }; }
});

// ── Page cache ────────────────────────────────────────────────────────────────
// Rendering a document's pages is the slow path (the host renders PDF→PNG on
// demand + base64-transfers them, ~1s). Cache successful page payloads by docId
// so re-clicking a document is instant. Bounded LRU; held in the MAIN process
// (out of the renderer, like the auth token) and cleared on logout — these are
// authenticated document images.
const PAGE_CACHE_MAX = 20;
const pageCache = new Map();   // id -> { status, json }
function _pageCacheGet(id) {
  if (!pageCache.has(id)) return undefined;
  const v = pageCache.get(id);
  pageCache.delete(id); pageCache.set(id, v);   // bump to most-recently-used
  return v;
}
function _pageCacheSet(id, v) {
  pageCache.set(id, v);
  while (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
}

// ── Connection watch ──────────────────────────────────────────────────────────
// Detect when the server (the core app) becomes unreachable — proactively via a
// heartbeat while signed in, and reactively when any authed call hits a network
// error — and tell the renderer so it can show a "connection lost" overlay with a
// Retry. Reachability only: a server that's UP but returns an error status counts
// as connected (session/permission handling stays in the existing 401 path).
let connAlive = true;
let heartbeatTimer = null;
const HEARTBEAT_MS = 5000;

function markConnection(alive) {
  if (alive === connAlive) return;                 // edge-triggered: only on change
  connAlive = alive;
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(alive ? 'client-connection-restored' : 'client-connection-lost'); } catch { /* window gone */ }
  }
}
function isNetworkError(e) {
  const code = e && e.code;
  if (code && ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH','EHOSTDOWN','ENETUNREACH','EPIPE','ECONNABORTED','EAI_AGAIN'].includes(code)) return true;
  return /socket hang up|network|ECONN|timed?\s*out|getaddrinfo/i.test((e && e.message) || '');
}
// Wrap an authed IPC handler so a NETWORK failure flips the connection state (a
// real network success clears it). Re-throws so the renderer's own handling runs.
function guarded(fn) {
  return async (...args) => {
    try { const r = await fn(...args); markConnection(true); return r; }
    catch (e) { if (isNetworkError(e)) markConnection(false); throw e; }
  };
}
async function pingServer() {
  if (!client) return false;
  try { return await client.ping(); } catch { return false; }
}
function startHeartbeat() {
  stopHeartbeat();
  connAlive = true;
  heartbeatTimer = setInterval(async () => { markConnection(await pingServer()); }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  connAlive = true;
}
// Manual retry from the "connection lost" overlay — force an immediate re-check.
ipcMain.handle('client-retry-connection', async () => {
  const ok = await pingServer();
  markConnection(ok);
  return { ok };
});

ipcMain.handle('client-config',       () => ({ apiUrl: serverConfig ? urlOf(serverConfig) : null }));
ipcMain.handle('client-connect',      () => client ? client.connect() : { ok: false, mode: 'block', reason: 'No server configured.' });
ipcMain.handle('client-login',        async (_e, { username, password, totp }) => {
  if (!client) return { ok: false, error: 'No server configured.' };
  const r = await client.login(username, password, totp);
  if (client.isAuthenticated()) startHeartbeat();   // watch the connection for this session
  return r;
});
ipcMain.handle('client-logout',       () => { stopHeartbeat(); pageCache.clear(); return client ? client.logout() : { ok: true }; });
ipcMain.handle('client-entitlement',  () => client ? client.entitlement() : { status: 0, json: null });
ipcMain.handle('client-search',       guarded((_e, params) => client.search(params)));
ipcMain.handle('client-get-document', guarded((_e, id) => client.getDocument(id)));
ipcMain.handle('client-recycle-list',      guarded(()       => client.recycle.list()));
ipcMain.handle('client-recycle-delete',    guarded((_e, id) => client.recycle.delete(id)));
ipcMain.handle('client-recycle-restore',   guarded((_e, id) => client.recycle.restore(id)));
ipcMain.handle('client-recycle-purge',     guarded((_e, id) => client.recycle.purge(id)));
ipcMain.handle('client-recycle-purge-all', guarded(()       => client.recycle.purgeAll()));
ipcMain.handle('client-get-pages',    async (_e, id) => {
  const hit = _pageCacheGet(id);
  if (hit !== undefined) return hit;                 // instant re-click (no network → don't touch conn state)
  try {
    const res = await client.getPages(id);
    markConnection(true);
    if (res && res.status === 200 && res.json) _pageCacheSet(id, res);   // cache only successful payloads
    return res;
  } catch (e) { if (isNetworkError(e)) markConnection(false); throw e; }
});
ipcMain.handle('client-authed',       () => client ? client.isAuthenticated() : false);

// Mailbox / approval workflow.
ipcMain.handle('client-wf-list',       guarded((_e, view) => client.workflow.list(view)));
ipcMain.handle('client-wf-recipients', guarded(() => client.workflow.recipients()));
ipcMain.handle('client-wf-assign',     guarded((_e, { documentId, toUserId, actionRequired, comment }) =>
  client.workflow.assign(documentId, toUserId, actionRequired, comment)));
ipcMain.handle('client-wf-claim',      guarded((_e, { id, version }) => client.workflow.claim(id, version)));
ipcMain.handle('client-wf-resolve',    guarded((_e, { id, decision, comment, version }) =>
  client.workflow.resolve(id, decision, comment, version)));
ipcMain.handle('client-wf-recall',     guarded((_e, { id, version }) => client.workflow.recall(id, version)));
ipcMain.handle('client-wf-stamped',    guarded((_e, id) => client.workflow.stamped(id)));

// About box: version details + open the bundled third-party notice.
ipcMain.handle('client-about', () => {
  let copyright = '', buildRev = null;
  try { copyright = require('./package.json').build.copyright || ''; } catch { /* ignore */ }
  // Build stamp: baked into the packaged package.json by electron-builder
  // (extraMetadata.buildRev = BUILD_REV); in unpackaged dev, read the live git sha.
  try { buildRev = require('./package.json').buildRev || null; } catch { /* not baked */ }
  if (!buildRev && !app.isPackaged) {
    try { buildRev = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { /* no git */ }
  }
  return { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, buildRev, copyright };
});
ipcMain.handle('client-open-licenses', async () => {
  // Dev: file sits beside main.js; packaged: extraResources drops it in resources/.
  const p = app.isPackaged
    ? path.join(process.resourcesPath, 'THIRD-PARTY-LICENSES.txt')
    : path.join(__dirname, 'THIRD-PARTY-LICENSES.txt');
  if (!fs.existsSync(p)) return { ok: false, error: 'notice file not found' };
  const err = await shell.openPath(p);   // '' on success
  return { ok: err === '', error: err || undefined };
});

app.whenReady().then(() => {
  serverConfig = loadServerConfig();
  if (serverConfig) buildClient(serverConfig);
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
