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

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cv = require('./lib/certVerify');        // pure trust-decision helpers (verified-connect + cert-change)
const isCertError = cv.isCertError;            // a TLS-verify failure (a trust event, not unreachability)
const { createClient } = require('./apiClient');
const { sanitizeBounds } = require('./windowBounds');

// TLS-verification escape hatch — dev ONLY. SECURITY (2026-09-01 pre-release audit, eric C-4): this must
// be IGNORED in a packaged customer build, the same discipline the core app applies to its own security
// env-switches (src/main.js remote-debug lockout, processing/handler.js SF_REALPATH_CONTAINMENT — both
// gated on !isPackaged so a boundary can't be turned off by an env var a launcher/GPO/attacker can set).
// Without the `!app.isPackaged` gate this env disabled CA verification (rejectUnauthorized:false) on real
// customer traffic → MITM of the session token + document images. The one-shot TOFU CA bootstrap
// (apiClient `insecure`) is a SEPARATE, intended path and is unaffected.
const ALLOW_SELF_SIGNED = !app.isPackaged && process.env.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';
// The app NAME titles every native alert()/confirm() box. Packaged builds carry productName ("ScanFinder Search
// Client"); a dev run showed the package name "scanfinder-client" (Chris 2026-09-14 card 8). Set the display
// name WITHOUT moving userData (app.getPath('userData') derives from the name — pin the current path first).
{ const ud = app.getPath('userData'); app.setName('ScanFinder Search Client'); app.setPath('userData', ud); }
let win = null;
let serverConfig = null;   // { host, port, tls } | null
let client = null;         // rebuilt whenever the server changes
// Search pop-out (client search parity S1, 2026-09-13; Oracle-vetted): a SECOND top-level window that runs the
// SHARED search UI (client/renderer/shared/search-ui — generated from the core's src/windows/shared/search-ui).
// Single instance; bounds persisted; closed on logout and when the main window closes (no zombie pop-out with
// no sign-in surface). The session token never reaches it — it calls the same IPC bridge as the main window.
let searchWin = null;
let pendingSearch = null;  // { query, docId } handed to the pop-out once on load (client-search-target)
let currentUser = null;    // { role, username, displayName } from the login response — the pop-out cannot learn
                           // the role any other way (no /v1/auth/me); null when signed out → the shared UI is read-only
let lastHandshake = null;  // the last /v1/health verdict ({ serverVersion, mode }) — the pop-out's capability gate

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

// SECURITY (2026-09-01 pre-release audit, eric C-3): app-level navigation lockdown, mirroring the core app
// (src/main.js web-contents-created + lib/navGuard). The client had NONE, so a compromised / HTML-injected
// renderer could window.open('file://…') or set location off-tree — keeping the privileged preload but
// losing the per-page CSP. Deny every new window (hand a genuine http(s) link to the OS browser instead),
// block any navigation/redirect whose target is not a file:// under the client's own renderer dir, and
// refuse <webview>. Self-contained (src/lib/navGuard is not bundled in the client's asar). No env kill
// switch — a security boundary must not be switchable off. The initial loadFile is not a "navigation".
const _clientAppRoot = path.normalize(path.join(__dirname, 'renderer')).toLowerCase();
function _isClientInApp(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'file:') return false;                          // http(s)/data/etc. never in-app
    const fsPath = require('url').fileURLToPath(u);                    // decodes %20 etc.
    return path.normalize(fsPath).toLowerCase().startsWith(_clientAppRoot);
  } catch { return false; }                                            // unparseable → deny
}
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch { /* noop */ }
    return { action: 'deny' };
  });
  contents.on('will-navigate',  (e, url) => { if (!_isClientInApp(url)) e.preventDefault(); });
  contents.on('will-redirect',  (e, url) => { if (!_isClientInApp(url)) e.preventDefault(); });
  contents.on('will-attach-webview', (e) => e.preventDefault());       // no <webview> anywhere
});

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 940, minHeight: 600,
    backgroundColor: '#0c0e14',
    title: 'ScanFinder Client',   // the search POP-OUT is "ScanFinder — Search"; two windows must not share one name (card 8)
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
  win.on('show', grabFocus);
  // The main window is the sign-in surface: when it goes, the search pop-out goes with it (Oracle seam 7).
  win.on('closed', () => { win = null; closeSearchWindow('main-window-closed'); closeTeachWindow('main-window-closed'); });
}

// ── Search pop-out window ──────────────────────────────────────────────────────
const searchStatePath = () => path.join(app.getPath('userData'), 'search-window-state.json');
function loadSearchState() { try { return JSON.parse(fs.readFileSync(searchStatePath(), 'utf8')); } catch { return null; } }
function saveSearchState(w) {
  try {
    if (!w || w.isDestroyed()) return;
    const b = w.getNormalBounds();
    fs.writeFileSync(searchStatePath(), JSON.stringify({ ...b, maximized: w.isMaximized() }));
  } catch { /* best-effort */ }
}
function closeSearchWindow(reason = 'main') {
  if (searchWin && !searchWin.isDestroyed()) { try { console.error('[search-popout] closed by main: ' + reason); } catch {} }
  try { if (searchWin && !searchWin.isDestroyed()) searchWin.destroy(); } catch {}
  searchWin = null;
  pendingSearch = null;
}
// Open (or focus) the pop-out. `opts` = { query, docId }: a term to pre-fill / a document to open. When the
// pop-out is ALREADY up the request is pushed to it live (mirrors the core's search-set-query / search-goto).
function openSearchWindow(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (searchWin && !searchWin.isDestroyed()) {
    try {
      if (o.query != null) searchWin.webContents.send('client-search-set-query', String(o.query));
      if (o.docId != null) searchWin.webContents.send('client-search-goto-doc', Number(o.docId));
      if (searchWin.isMinimized()) searchWin.restore();
      searchWin.show(); searchWin.focus();
    } catch {}
    return;
  }
  pendingSearch = { query: o.query != null ? String(o.query) : null, docId: o.docId != null ? Number(o.docId) : null };
  const st = loadSearchState() || {};
  // A remembered position is honoured ONLY if it is still on a connected screen — a position saved on a monitor that
  // is gone (undocked laptop, second screen off) would create the window OFF-SCREEN: it runs, nobody sees it, and it
  // reads as "the search window doesn't open" (owner 2026-09-13/14). Otherwise Electron centres it.
  let displays = []; try { displays = screen.getAllDisplays(); } catch { displays = []; }
  const b = sanitizeBounds(st, displays);
  const w = new BrowserWindow({
    width: b.width, height: b.height, minWidth: 900, minHeight: 560,
    x: b.x, y: b.y,
    show: false, backgroundColor: '#0c0e14',
    title: 'ScanFinder — Search',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {                       // SAME posture as the main window — the bridge is the only door
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  searchWin = w;
  if (w.removeMenu) w.removeMenu();
  const dbg = (m) => { try { console.error('[search-popout] ' + m); } catch {} };   // stderr — a launcher's log captures it
  dbg(`created (state ${JSON.stringify(st)} → bounds ${JSON.stringify(b)}${(Number.isFinite(st.x) && b.x == null) ? ' — saved position OFF-SCREEN, dropped' : ''})`);
  w.webContents.on('did-fail-load', (_e, code, desc) => dbg(`did-fail-load ${code} ${desc}`));
  w.webContents.on('render-process-gone', (_e, d) => dbg(`render-process-gone ${d && d.reason}`));
  w.webContents.on('preload-error', (_e, p, err) => dbg(`preload-error ${err && err.message}`));
  w.loadFile(path.join(__dirname, 'renderer', 'search', 'index.html')).catch((e) => dbg(`loadFile failed: ${e && e.message}`));   // inside the navGuard root
  let shown = false;
  const reveal = (why) => {
    if (shown || w.isDestroyed()) return;
    shown = true;
    try { if (st.maximized) w.maximize(); w.show(); w.focus(); dbg(`shown (${why})`); } catch (e) { dbg(`show failed: ${e && e.message}`); }
  };
  w.once('ready-to-show', () => reveal('ready-to-show'));
  // Safety net: a renderer that never reports ready-to-show (a paint that never happens) must not leave the
  // user with a window that "doesn't open" — show it anyway after a moment; the page is loading behind it.
  setTimeout(() => reveal('fallback-timer'), 2500);
  const grabFocus = () => { try { if (w && !w.isDestroyed()) w.webContents.focus(); } catch {} };
  w.webContents.on('did-finish-load', grabFocus);
  w.on('focus', grabFocus);
  w.on('show', grabFocus);
  w.on('close', () => saveSearchState(w));
  w.on('closed', () => { dbg('closed'); if (searchWin === w) searchWin = null; });
}
ipcMain.handle('client-open-search', (_e, opts) => {
  if (!client || !client.isAuthenticated()) {
    try { console.error('[search-popout] refused: not signed in (client ' + (client ? 'built' : 'absent') + ')'); } catch {}
    return { ok: false, error: 'not signed in' };
  }
  try { openSearchWindow(opts); }
  catch (e) { try { console.error('[search-popout] open failed: ' + (e && e.stack || e)); } catch {} return { ok: false, error: (e && e.message) || 'open failed' }; }
  return { ok: true };
});
// Pulled ONCE by the pop-out on load: the deep-link it was opened with (then cleared).
ipcMain.handle('client-search-target', () => { const t = pendingSearch; pendingSearch = null; return t; });
// The signed-in user's role/name for the pop-out (null = signed out → the shared UI shows read-only actions).
ipcMain.handle('client-current-user', () => (client && client.isAuthenticated()) ? currentUser : null);
// What the pop-out may expect of the server (its capability gate) + what this client was built for.
ipcMain.handle('client-server-info', () => ({
  serverVersion: lastHandshake ? lastHandshake.serverVersion : null,
  clientContract: require('./apiClient').CLIENT_CONTRACT,
  mode: lastHandshake ? lastHandshake.mode : null,
}));
// The pop-out saw a 401: the session is gone. Close it and let the main window sign out.
ipcMain.on('client-popout-session-expired', (e) => {
  const fromSearch = searchWin && !searchWin.isDestroyed() && e.sender === searchWin.webContents;
  const fromTeach  = teachWin  && !teachWin.isDestroyed()  && e.sender === teachWin.webContents;
  if (!fromSearch && !fromTeach) return;   // sender-scoped — either pop-out
  closeSearchWindow('session-expired (a pop-out saw a 401) — signing the main window out');
  closeTeachWindow('session-expired (a pop-out saw a 401)');
  try { if (win && !win.isDestroyed()) win.webContents.send('client-session-expired'); } catch {}
});

// ── Teach pop-out (teach-over-client S1) — mirrors the search pop-out: a second top-level window, the
// session token stays in main, CLOSED on logout and when the main window closes (no write-surface window
// outliving the session). Opens maximised; deep-links to a doc via client-teach-goto-doc. ────────────────
let teachWin = null;
let pendingTeach = null;
function closeTeachWindow(reason = 'main') {
  try { if (teachWin && !teachWin.isDestroyed()) { console.error('[teach-popout] closed by main: ' + reason); teachWin.destroy(); } } catch {}
  teachWin = null;
}
function openTeachWindow(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (teachWin && !teachWin.isDestroyed()) {
    try { if (o.docId != null) teachWin.webContents.send('client-teach-goto-doc', Number(o.docId)); if (teachWin.isMinimized()) teachWin.restore(); teachWin.show(); teachWin.focus(); } catch {}
    return;
  }
  pendingTeach = { docId: o.docId != null ? Number(o.docId) : null };
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 600, show: false, backgroundColor: '#0c0e14',
    title: 'ScanFinder — Teach a document', icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  teachWin = w;
  if (w.removeMenu) w.removeMenu();
  const dbg = (m) => { try { console.error('[teach-popout] ' + m); } catch {} };
  w.webContents.on('did-fail-load', (_e, code, desc) => dbg(`did-fail-load ${code} ${desc}`));
  w.webContents.on('render-process-gone', (_e, d) => dbg(`render-process-gone ${d && d.reason}`));
  w.loadFile(path.join(__dirname, 'renderer', 'teach', 'index.html')).catch((e) => dbg(`loadFile failed: ${e && e.message}`));   // inside the navGuard root
  let shown = false;
  const reveal = (why) => { if (shown || w.isDestroyed()) return; shown = true; try { w.maximize(); w.show(); w.focus(); dbg('shown (' + why + ')'); } catch (e) { dbg('show failed: ' + (e && e.message)); } };
  w.once('ready-to-show', () => reveal('ready-to-show'));
  setTimeout(() => reveal('fallback-timer'), 2500);
  w.on('closed', () => { dbg('closed'); if (teachWin === w) teachWin = null; });
}
ipcMain.handle('client-open-teach', (_e, opts) => {
  if (!client || !client.isAuthenticated()) { try { console.error('[teach-popout] refused: not signed in'); } catch {} return { ok: false, error: 'not signed in' }; }
  try { openTeachWindow(opts); } catch (e) { try { console.error('[teach-popout] open failed: ' + (e && e.stack || e)); } catch {} return { ok: false, error: (e && e.message) || 'open failed' }; }
  return { ok: true };
});
ipcMain.handle('client-teach-target', () => { const t = pendingTeach; pendingTeach = null; return t; });

// Renderer-driven keyboard-focus repair (Windows): the preload requests this when a
// click enters a text field while the render widget lacks OS keyboard focus (the
// "click a box, no caret until I alt-tab out and back" bug). Re-focusing the sending
// webContents re-syncs it without an OS window-focus change. Sender-scoped + guarded.
ipcMain.on('ensure-window-focus', (e) => {
  try { const wc = e.sender; if (wc && !wc.isDestroyed()) wc.focus(); } catch {}
});

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
  lastHandshake = h;
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
    const host = String(p.host).trim(), port = Number(p.port) || 8765, tls = p.tls !== false;
    // Oracle C1: the profile's CA (a trusted OFF-network file) is pinned in MAIN — stash it + return only the
    // fingerprint. The renderer fills the form + calls client-connect-accept, which pins these exact bytes.
    const fingerprint = cv.computeFingerprint(String(p.caPem));
    if (!fingerprint) return { ok: false, error: 'The profile contains an unreadable certificate.' };
    _pendingCa = { key: `${host}:${port}`, caPem: String(p.caPem), fingerprint, host, port, tls, ts: Date.now() };
    return { ok: true, host, port, tls, fingerprint, name: path.basename(r.filePaths[0]) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Pick a QR image file (the "Connect a client" QR photographed/saved) → return a data-URI the renderer decodes
// with jsQR (S3). No network; the decoded fingerprint is verified in MAIN via client-connect-verified.
ipcMain.handle('client-pick-qr-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a photo or image of the connection QR code',
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  try {
    const buf = fs.readFileSync(r.filePaths[0]);
    let ext = path.extname(r.filePaths[0]).slice(1).toLowerCase(); if (ext === 'jpg') ext = 'jpeg';
    return { ok: true, dataUrl: `data:image/${ext};base64,${buf.toString('base64')}` };
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

// ── Verified connect (Oracle C1/C2, 2026-09-14): the fetch → compute-fingerprint → compare → pin ALL happen in
//    MAIN; the CA PEM NEVER round-trips through the renderer. Two shapes:
//    · with an expectedFingerprint (from a QR/profile): main auto-compares + pins silently on a match, refuses
//      on a mismatch (no bad cert is ever pinned — C2);
//    · without one (typed address): main STASHES the fetched CA + returns only the FINGERPRINT for the renderer's
//      accept dialog, and pins the stashed bytes only when the renderer calls client-connect-accept.
let _pendingCa = null;   // { key, caPem, fingerprint, host, port, tls, ts } — held in MAIN between preview + accept
async function _fetchAndHash({ host, port, code }) {
  const h = String(host || '').trim(); const p = Number(port) || 8765;
  const tmp = createClient({ baseUrl: `https://${h}:${p}`, allowSelfSigned: ALLOW_SELF_SIGNED });
  let fetched; try { fetched = await tmp.fetchCa(code); } catch (e) { return { ok: false, error: e.message }; }
  if (!fetched || !fetched.ok || !fetched.caPem) return { ok: false, error: (fetched && fetched.error) || 'Could not fetch the certificate.', status: fetched && fetched.status };
  // C2: compute the fingerprint of the EXACT bytes we will pin, in MAIN — NEVER the server-reported value; an
  // unparseable certificate is a failure (never "fail closed by luck").
  const fp = cv.computeFingerprint(fetched.caPem);
  if (!fp) return { ok: false, error: 'The server sent an unreadable certificate.' };
  return { ok: true, caPem: fetched.caPem, fingerprint: fp };
}
async function _pinAndConnect({ host, port, tls, caPem, fingerprint, verified }) {
  const cfg = { host, port, tls: tls !== false, caPem };
  buildClient(cfg);
  let hs; try { hs = await client.connect(); }
  catch (e) {
    if (isCertError(e)) return { ok: false, mode: e.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ? 'addr-mismatch' : 'cert', reason: e.message, certCode: e.code || null, host, port };
    return { ok: false, mode: 'block', reason: e.message };
  }
  lastHandshake = hs;
  if (hs.ok) { serverConfig = cfg; saveServerConfig(cfg); }
  return { ...hs, fingerprint, verified: !!verified };
}
ipcMain.handle('client-connect-verified', async (_e, { host, port, tls, expectedFingerprint, code } = {}) => {
  const h = String(host || '').trim(); if (!h) return { ok: false, mode: 'block', reason: 'Enter a server address.' };
  const p = Number(port) || 8765;
  const fetched = await _fetchAndHash({ host: h, port: p, code });
  if (!fetched.ok) return { ok: false, mode: 'block', reason: fetched.error };
  if (expectedFingerprint) {
    // C2: compare the LOCALLY-computed fingerprint of the exact fetched bytes to the QR/profile's expected value.
    if (cv.normFp(fetched.fingerprint) !== cv.normFp(expectedFingerprint)) {
      return { ok: false, mode: 'mismatch', reason: 'The certificate does NOT match the code/QR from the server — do not continue; someone may be impersonating it.', fingerprint: fetched.fingerprint };
    }
    return await _pinAndConnect({ host: h, port: p, tls, caPem: fetched.caPem, fingerprint: fetched.fingerprint, verified: true });
  }
  // No expected fingerprint → stash the fetched CA in MAIN, return only the fingerprint for the accept dialog.
  _pendingCa = { key: `${h}:${p}`, caPem: fetched.caPem, fingerprint: fetched.fingerprint, host: h, port: p, tls: tls !== false, ts: Date.now() };
  return { ok: true, mode: 'confirm', fingerprint: fetched.fingerprint, host: h, port: p };
});
ipcMain.handle('client-connect-accept', async (_e, { host, port } = {}) => {
  const key = `${String(host || '').trim()}:${Number(port) || 8765}`;
  if (!_pendingCa || _pendingCa.key !== key || (Date.now() - _pendingCa.ts) > 120000) {
    _pendingCa = null; return { ok: false, mode: 'block', reason: 'The connection attempt expired — start again.' };
  }
  const pend = _pendingCa; _pendingCa = null;
  return await _pinAndConnect({ host: pend.host, port: pend.port, tls: pend.tls, caPem: pend.caPem, fingerprint: pend.fingerprint, verified: false });
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
  // EVERY live window (the main window AND the search pop-out) — a pop-out that misses the overlay would
  // keep offering controls against a dead server (Oracle 2026-09-13 seam 7).
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try { w.webContents.send(alive ? 'client-connection-restored' : 'client-connection-lost'); } catch { /* window gone */ }
  }
}
function isNetworkError(e) {
  const code = e && e.code;
  if (code && ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH','EHOSTDOWN','ENETUNREACH','EPIPE','ECONNABORTED','EAI_AGAIN'].includes(code)) return true;
  return /socket hang up|network|ECONN|timed?\s*out|getaddrinfo/i.test((e && e.message) || '');
}
// On a cert-verify failure against the SAVED server, re-fetch the current CA and CLASSIFY (Oracle C3):
//   · same CA fingerprint as the pin → a SAN/address-coverage gap (ALTNAME), NOT an identity change → an
//     "address not covered" state, no re-pin offered;
//   · different CA fingerprint → a genuine identity change → stash the fresh CA + emit the refuse-is-default
//     re-accept alert (the ONLY re-pin path is an explicit human confirm → client-connect-accept).
let _certAlertPending = false;
async function handleCertError() {
  if (_certAlertPending || !serverConfig || !serverConfig.caPem) return;
  _certAlertPending = true;
  try {
    const fresh = await _fetchAndHash({ host: serverConfig.host, port: serverConfig.port });
    if (!fresh.ok) return;   // couldn't re-fetch — leave it to the network watch, never guess a change
    const cls = cv.classifyCertChange(serverConfig.caPem, fresh.caPem);
    if (cls.kind === 'unreadable') return;
    let payload;
    if (cls.kind === 'addr-mismatch') {
      payload = { kind: 'addr-mismatch', host: serverConfig.host, port: serverConfig.port };
    } else {
      // A genuine identity change → stash the fresh CA so the ONLY re-pin path is an explicit human accept.
      _pendingCa = { key: `${serverConfig.host}:${serverConfig.port}`, caPem: fresh.caPem, fingerprint: fresh.fingerprint,
                     host: serverConfig.host, port: serverConfig.port, tls: serverConfig.tls, ts: Date.now() };
      payload = { kind: 'changed', host: serverConfig.host, port: serverConfig.port, oldFingerprint: cls.oldFingerprint, newFingerprint: cls.newFingerprint };
    }
    for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) try { w.webContents.send('client-cert-alert', payload); } catch {} }
  } finally { _certAlertPending = false; }
}
// Wrap an authed IPC handler so a NETWORK failure flips the connection state (a real network success clears it).
// A CERT-verify failure is classified FIRST (C3) — it fires the trust alert, never the connection-lost overlay.
// Re-throws so the renderer's own handling runs.
function guarded(fn) {
  return async (...args) => {
    try { const r = await fn(...args); markConnection(true); return r; }
    catch (e) {
      if (isCertError(e)) { handleCertError().catch(() => {}); throw e; }
      if (isNetworkError(e)) markConnection(false);
      throw e;
    }
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
ipcMain.handle('client-connect',      async () => {
  if (!client) return { ok: false, mode: 'block', reason: 'No server configured.' };
  const h = await client.connect();
  lastHandshake = h;
  return h;
});
ipcMain.handle('client-login',        async (_e, { username, password, totp }) => {
  if (!client) return { ok: false, error: 'No server configured.' };
  // A network hiccup at login (DNS/TLS/timeout) used to REJECT the invoke, leaving the
  // Sign-in button doing nothing with no message. Mirror client-set-server: turn a thrown
  // transport error into a normal { ok:false, error } the renderer already renders.
  let r;
  try { r = await client.login(username, password, totp); }
  catch (e) { return { ok: false, error: (e && e.message) || 'Could not reach the server.' }; }
  if (client.isAuthenticated()) {
    startHeartbeat();   // watch the connection for this session
    // Cache the signed-in identity for the search pop-out (no token — role + names only).
    const u = (r && r.user) || {};
    currentUser = { role: u.role || null, username: u.username || null, displayName: u.displayName || u.username || null };
  }
  return r;
});
ipcMain.handle('client-logout',       () => {
  stopHeartbeat(); pageCache.clear();
  currentUser = null;
  closeSearchWindow('logout');   // the pop-out must not outlive the session (Oracle seam 7)
  closeTeachWindow('logout');    // …and neither may the teach write-surface pop-out
  return client ? client.logout() : { ok: true };
});
ipcMain.handle('client-change-password', async (_e, { currentPassword, newPassword } = {}) => {
  if (!client) return { ok: false, error: 'Not connected to a server.' };
  try { return await client.changePassword(currentPassword, newPassword); }
  catch (e) { return { ok: false, error: (e && e.message) || 'Could not reach the server.' }; }
});
ipcMain.handle('client-entitlement',  () => client ? client.entitlement() : { status: 0, json: null });
ipcMain.handle('client-search',       guarded((_e, params) => client.search(params)));
ipcMain.handle('client-get-document', guarded((_e, id) => client.getDocument(id)));
ipcMain.handle('client-recycle-list',      guarded(()       => client.recycle.list()));
ipcMain.handle('client-recycle-delete',    guarded((_e, id) => client.recycle.delete(id)));
ipcMain.handle('client-recycle-restore',   guarded((_e, id) => client.recycle.restore(id)));
ipcMain.handle('client-recycle-purge',     guarded((_e, id) => client.recycle.purge(id)));
ipcMain.handle('client-recycle-purge-all', guarded(()       => client.recycle.purgeAll()));
ipcMain.handle('client-review-queue',    guarded(()                => client.review.queue()));
ipcMain.handle('client-review-deferred', guarded(()                => client.review.deferred()));
ipcMain.handle('client-review-counts',   guarded(()                => client.review.counts()));
ipcMain.handle('client-doc-types',       guarded(()                => client.review.docTypes()));
ipcMain.handle('client-review-confirm',  guarded((_e, id, payload) => client.review.confirm(id, payload)));
ipcMain.handle('client-review-defer',    guarded((_e, id)          => client.review.defer(id)));
ipcMain.handle('client-review-undefer',  guarded((_e, id)          => client.review.undefer(id)));
ipcMain.handle('client-review-viewing',  guarded((_e, id)          => client.review.viewing(id)));
ipcMain.handle('client-review-release',  guarded((_e, id)          => client.review.release(id)));
ipcMain.handle('client-review-ocr-region', guarded((_e, id, imageBase64) => client.review.ocrRegion(id, imageBase64)));
// Teach-over-client S1: the teach pop-out's OCR/geometry reads over /v1 (guarded — a lost connection is a
// clean envelope, not an unhandled reject). The text read reuses client-review-ocr-region.
ipcMain.handle('client-teach-region-boxes', guarded((_e, id, imageBase64)           => client.teach.ocrRegionBoxes(id, imageBase64)));
ipcMain.handle('client-teach-page-words',   guarded((_e, id, imageBase64)           => client.teach.ocrPageWords(id, imageBase64)));
ipcMain.handle('client-teach-page-deskew',  guarded((_e, id, imageBase64, minAngle) => client.teach.pageDeskew(id, imageBase64, minAngle)));
ipcMain.handle('client-teach-config',       guarded(()                              => client.teach.config()));
// Teach-over-client S2: create a document type / add catalog presets over /v1 (admin-only server-side).
ipcMain.handle('client-teach-create-doctype',  guarded((_e, draft) => client.teach.createDocType(draft)));
ipcMain.handle('client-teach-doctype-catalog', guarded(()          => client.teach.docTypeCatalog()));
ipcMain.handle('client-teach-doctype-presets', guarded((_e, slugs) => client.teach.addDocTypePresets(slugs)));
// S3: the transactional teach commit over /v1 (admin + entitlement + license + server switch, all server-side).
ipcMain.handle('client-teach-commit',          guarded((_e, payload) => client.teach.commit(payload)));

// ── Quick File (non-OCR upload) ─────────────────────────────────────────────────────────────────────
// Paths NEVER cross to the renderer: the picked file lives in a MAIN-side token map; the renderer sends a
// token back to submit, and main reads the bytes + base64s them for the /v1 upload. The SAFE upload-ext
// subset mirrors the server's fileKinds.isUploadIntake (the server re-validates — this is the picker + a
// friendly pre-check). The server also re-checks size/ext/enabled/role, so this is convenience, not trust.
const INTAKE_UPLOAD_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif'];
const INTAKE_TTL_MS = 15 * 60 * 1000;
const _intakeStaged = new Map();   // token -> { path, name, size, expires }
function _intakeSweep() { const now = Date.now(); for (const [k, v] of _intakeStaged) if (v.expires < now) _intakeStaged.delete(k); }
function _mintIntakeToken() { return 'cqf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

ipcMain.handle('client-intake-doctypes', guarded(() => client.intakeDocTypes()));

ipcMain.handle('client-intake-pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Quick File — choose documents',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: INTAKE_UPLOAD_EXTS }, { name: 'All files', extensions: ['*'] }],
  });
  if (!r || r.canceled) return { ok: true, files: [] };
  _intakeSweep();
  const files = [];
  for (const p of (r.filePaths || [])) {
    const name = path.basename(String(p));
    const ext = path.extname(name).toLowerCase().replace(/^\./, '');
    if (!INTAKE_UPLOAD_EXTS.includes(ext)) { files.push({ name, refused: 'unsupported_type' }); continue; }
    let st; try { st = fs.statSync(p); } catch { files.push({ name, refused: 'unreadable' }); continue; }
    if (!st.isFile()) { files.push({ name, refused: 'not_a_file' }); continue; }
    const token = _mintIntakeToken();
    _intakeStaged.set(token, { path: String(p), name, size: st.size, expires: Date.now() + INTAKE_TTL_MS });
    files.push({ token, name, size: st.size });
  }
  return { ok: true, files };
});

// Submit ONE staged file: read bytes in MAIN, base64, POST /v1/documents/intake. token → the staged path.
ipcMain.handle('client-intake-submit', guarded(async (_e, token, meta) => {
  _intakeSweep();
  const staged = token && _intakeStaged.get(token);
  if (!staged) return { ok: false, error: 'expired' };
  let bytes; try { bytes = fs.readFileSync(staged.path); } catch { return { ok: false, error: 'unreadable' }; }
  const res = await client.intakeSubmit({ ...(meta || {}), filename: staged.name, contentBase64: bytes.toString('base64') });
  if (res && res.status === 200 && res.json && res.json.ok) { _intakeStaged.delete(token); return { ok: true, docId: res.json.docId }; }
  return { ok: false, status: res && res.status, error: (res && res.json && (res.json.error || res.json.code)) || 'failed' };
}));

// ── Teach-over-client S4 (upload-to-teach) ─────────────────────────────────────────────────────────────
// Pick ONE PDF/image on THIS PC, stage it in a MAIN-side token map (the path NEVER crosses to the renderer),
// then read bytes + base64 → POST /v1/teach/stage which runs the core's OCR import WITHOUT filing and returns
// { docId, filename } — the review-queue doc to teach. Mirrors the Quick File plumbing; only OCR-able formats
// (PDF + image) are teachable (no docx/txt/csv). The server re-checks ext/size/pages/role/switch, so this is
// the picker + a friendly pre-check, not trust.
const TEACH_STAGE_UPLOAD_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'];
const _teachStaged = new Map();   // token -> { path, name, size, expires }
function _teachStageSweep() { const now = Date.now(); for (const [k, v] of _teachStaged) if (v.expires < now) _teachStaged.delete(k); }

ipcMain.handle('client-teach-stage-pick', async () => {
  const parent = (teachWin && !teachWin.isDestroyed()) ? teachWin : win;
  const r = await dialog.showOpenDialog(parent, {
    title: 'Teach a document — choose a scan',
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: TEACH_STAGE_UPLOAD_EXTS }, { name: 'All files', extensions: ['*'] }],
  });
  if (!r || r.canceled || !(r.filePaths || []).length) return { ok: false };   // cancelled
  const p = r.filePaths[0];
  const name = path.basename(String(p));
  const ext = path.extname(name).toLowerCase().replace(/^\./, '');
  if (!TEACH_STAGE_UPLOAD_EXTS.includes(ext)) return { ok: false, error: 'unsupported_type' };
  let st; try { st = fs.statSync(p); } catch { return { ok: false, error: 'unreadable' }; }
  if (!st.isFile()) return { ok: false, error: 'not_a_file' };
  _teachStageSweep();
  const token = 'cts_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  _teachStaged.set(token, { path: String(p), name, size: st.size, expires: Date.now() + INTAKE_TTL_MS });
  return { ok: true, token, name, size: st.size };
});

// Submit ONE staged file: read bytes in MAIN, base64, POST /v1/teach/stage (the ~30s core OCR import).
ipcMain.handle('client-teach-stage-submit', guarded(async (_e, token) => {
  _teachStageSweep();
  const staged = token && _teachStaged.get(token);
  if (!staged) return { ok: false, error: 'expired' };
  let bytes; try { bytes = fs.readFileSync(staged.path); } catch { return { ok: false, error: 'unreadable' }; }
  const res = await client.teach.stage({ filename: staged.name, contentBase64: bytes.toString('base64') });
  if (res && res.status === 200 && res.json && res.json.ok) { _teachStaged.delete(token); return { ok: true, docId: res.json.docId, filename: res.json.filename }; }
  return { ok: false, status: res && res.status, error: (res && res.json && (res.json.error || res.json.code)) || 'failed' };
}));
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
ipcMain.handle('client-get-thumbnail', async (_e, id) => {
  try {
    const res = await client.getThumbnail(id);
    markConnection(true);
    return res;
  } catch (e) { if (isNetworkError(e)) markConnection(false); throw e; }
});
// The four preview READS for the search pop-out (contract 1.3.0; client search parity S2). page / page-count /
// spreadsheet are ordinary guarded reads. `find` is deliberately NOT `guarded()`: the core may OCR a scanned
// document to answer it (bounded server-side, but seconds to a minute), and apiClient's idle timeout rejects
// with "connection timed out" — which isNetworkError would read as a LOST CONNECTION and throw the whole client
// into the "Connection lost" overlay for a merely slow find (Oracle 2026-09-13 seam 8). A timeout here is
// returned as a normal envelope the pop-out shows as "took too long"; real outages are still caught by the
// heartbeat within seconds.
ipcMain.handle('client-get-page',    guarded((_e, id, index, scale, fmt) => client.getPage(id, index, scale, fmt)));
ipcMain.handle('client-outline',     guarded((_e, id) => client.getOutline(id)));   // 1.5.0: the PDF's bookmarks (Contents panel)
ipcMain.handle('client-page-info',   guarded((_e, id, page, also, scale, fmt) => client.getPageInfo(id, page, also, scale, fmt)));   // 1.6.0: first paint + read-ahead in one request
ipcMain.handle('client-page-count',  guarded((_e, id) => client.getPageCount(id)));
ipcMain.handle('client-spreadsheet', guarded((_e, id) => client.getSpreadsheet(id)));
ipcMain.handle('client-find', async (_e, id, query) => {
  try { const r = await client.find(id, query); markConnection(true); return r; }
  catch (e) {
    const timedOut = /timed?\s*out/i.test((e && e.message) || '');
    return { status: 0, json: { kind: timedOut ? 'timeout' : 'error', pages: 0, matches: [] } };
  }
});
ipcMain.handle('client-authed',       () => client ? client.isAuthenticated() : false);

// Mailbox / approval workflow.
ipcMain.handle('client-wf-list',       guarded((_e, view) => client.workflow.list(view)));
ipcMain.handle('client-wf-recipients', guarded(() => client.workflow.recipients()));
ipcMain.handle('client-wf-assign',     guarded((_e, { documentId, toUserId, actionRequired, comment, resubmitOf }) =>
  client.workflow.assign(documentId, toUserId, actionRequired, comment, resubmitOf)));   // resubmitOf = "Send again" lineage (was dropped here)
ipcMain.handle('client-wf-claim',      guarded((_e, { id, version }) => client.workflow.claim(id, version)));
ipcMain.handle('client-wf-resolve',    guarded((_e, { id, decision, comment, version }) =>
  client.workflow.resolve(id, decision, comment, version)));
ipcMain.handle('client-wf-recall',     guarded((_e, { id, version }) => client.workflow.recall(id, version)));
ipcMain.handle('client-wf-stamped',    guarded((_e, id) => client.workflow.stamped(id)));
// Stamping (Workflow+Stamping redesign 2026-08-28) — thin pass-throughs to the /v1 stamp routes.
ipcMain.handle('client-wf-stamp-types', guarded(() => client.workflow.stampTypes()));
ipcMain.handle('client-wf-can-stamp',   guarded(() => client.workflow.canStamp()));
ipcMain.handle('client-wf-stamp-list',  guarded((_e, id) => client.workflow.stampList(id)));
ipcMain.handle('client-wf-stamp-place', guarded((_e, { id, body }) => client.workflow.stampPlace(id, body)));
ipcMain.handle('client-wf-stamped-doc', guarded((_e, id) => client.workflow.stampedDoc(id)));
// Contract 1.4.0 (2026-09-14): per-document open routes / decision history, admin cancel, new stamp type — thin
// pass-throughs; every gate (role, document access, entitlement, CAS version) is the core's.
ipcMain.handle('client-wf-doc-routes',        guarded((_e, id) => client.workflow.docRoutes(id)));
ipcMain.handle('client-wf-doc-history',       guarded((_e, id) => client.workflow.docHistory(id)));
ipcMain.handle('client-wf-admin-cancel',      guarded((_e, { id, version, reason } = {}) => client.workflow.adminCancel(id, version, reason)));
ipcMain.handle('client-wf-stamp-type-create', guarded((_e, body) => client.workflow.stampTypeCreate(body)));

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
