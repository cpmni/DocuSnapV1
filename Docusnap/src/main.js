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

// ── App-data directory (brand-rename safety) ──────────────────────────────────
// The product is shown to users as "ScanFinder", but its on-disk data lives in
// %APPDATA%\DocuSnap (SQLite DB, users, cached license tokens, inbox, templates,
// processing.log). Electron derives userData from productName, so renaming
// productName alone would repoint userData at a NEW empty %APPDATA%\ScanFinder
// folder and orphan every existing install's data. Pin userData to the original
// folder so the rename stays purely cosmetic — no data migration. Must run
// before app 'ready' / first DB open.
app.setPath('userData', path.join(app.getPath('appData'), 'DocuSnap'));

// ── Module imports ────────────────────────────────────────────────────────────
const logger           = require('./modules/logger');
const { makeSafeSend } = require('./lib/safe-send');
const diaglog          = require('./modules/diaglog');
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
const apiModule            = require('./modules/api/handler');
const workflowModule       = require('./modules/workflow/handler');

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
// Same pattern for the teaching wizard opened targeted at a just-scanned doc.
let pendingTeachDocId = null;

const MAIN_WINDOW_OPTIONS    = { width: 1100, height: 750, minWidth: 800, minHeight: 560 };
const LOGIN_WINDOW_OPTIONS   = { width: 460, height: 660, resizable: false, minimizable: false, maximizable: false };
const LICENSE_WINDOW_OPTIONS = { width: 460, height: 560, resizable: false, minimizable: false, maximizable: false };
const ONBOARDING_WINDOW_OPTIONS = { width: 720, height: 640, resizable: false, minimizable: false, maximizable: false };
const HELP_WINDOW_OPTIONS = { width: 940, height: 700, minWidth: 640, minHeight: 460 };

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
  windows['onboarding']?.close();
}

// First-run setup wizard. Shows ONLY when `first_run_completed` !== 'true' (a
// genuine clean install — migration 24 stamps the flag on already-configured
// DBs so existing users are never re-onboarded). Runs AFTER the licensing gate
// allows, so a locked user never sees it. Reads fail-open: a read error must
// never block entry to the app.
function needsOnboarding() {
  try {
    return require('../database/modules/learning').getSetting(getDb(), 'first_run_completed') !== 'true';
  } catch { return false; }
}

function showOnboarding() {
  createWindow('onboarding', ONBOARDING_WINDOW_OPTIONS, 'index.html');
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
  if (gate.decision === 'allow') {
    if (needsOnboarding()) { showOnboarding(); return; }
    openMainShell();
    return;
  }
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
let splashCreatedAt = 0;
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
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { delete windows['splash']; });
  windows['splash'] = splash;
  splashCreatedAt = Date.now();
  return splash;
}

// Minimum time the splash is the ONLY window on screen before anything else.
const SPLASH_MS = 2000;

// Serialized startup: splash alone for SPLASH_MS, then exactly ONE follow-on
// window. The follow-on is the login window (which itself handles first-run
// setup vs. sign-in; the main shell is only ever opened later via the auth/
// license gate). It is PRELOADED HIDDEN so it can be revealed instantly but is
// never visible alongside the splash — no overlap, no flash, no duplicate
// window. We reveal only once BOTH the 2s minimum has elapsed AND the follow-on
// has finished loading, closing the splash in the same step. An 8s backstop
// ensures we never get stuck on the splash.
function launchStartupWindow() {
  const win = createWindow('login', { ...LOGIN_WINDOW_OPTIONS, show: false }, 'index.html');
  let loginReady = false, minElapsed = false, revealed = false;

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    const splash = windows['splash'];
    if (splash && !splash.isDestroyed()) splash.close();   // splash closes first…
    if (win && !win.isDestroyed()) win.show();              // …then the single follow-on appears
  };
  const maybeReveal = () => { if (minElapsed && loginReady) reveal(); };

  win.webContents.once('did-finish-load', () => { loginReady = true; maybeReveal(); });
  const elapsed = splashCreatedAt ? Date.now() - splashCreatedAt : 0;
  setTimeout(() => { minElapsed = true; maybeReveal(); }, Math.max(0, SPLASH_MS - elapsed));
  setTimeout(reveal, 8000);   // safety backstop — never hang on the splash
}

// Child windows opened from the main shell are parented + kept off the taskbar so
// the whole suite shares ONE taskbar entry and feels self-contained. Most also
// lock their opener (modal), like a regular Windows app; the dev inspector stays
// non-modal so you can watch live processing while using the main window.
const CHILD_WINDOWS   = new Set(['review', 'settings', 'search', 'teach', 'dev-inspector']);
const NON_MODAL_CHILD = new Set(['dev-inspector']);

const winStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinStates() { try { return JSON.parse(fs.readFileSync(winStateFile(), 'utf8')); } catch { return {}; } }
function saveWinStates(s) { try { fs.writeFileSync(winStateFile(), JSON.stringify(s, null, 2)); } catch { /* ignore */ } }

// Open maximized by default ("fullscreen"); once the user restores/resizes a
// window, remember that and honour it next time. Fixed dialogs (resizable:false,
// e.g. login/licence/onboarding) are left exactly as defined.
function applyWindowState(win, name, options) {
  if (options.resizable === false) return;
  const st = loadWinStates()[name];
  if (st && st.userSized && !st.maximized && st.bounds) win.setBounds(st.bounds);
  else win.maximize();

  let ready = false, t;
  win.once('ready-to-show', () => { ready = true; });   // ignore the programmatic default-maximize
  const persist = () => {
    if (!ready || win.isDestroyed()) return;
    const all = loadWinStates();
    all[name] = win.isMaximized()
      ? { userSized: true, maximized: true }
      : { userSized: true, maximized: false, bounds: win.getBounds() };
    saveWinStates(all);
  };
  const debounced = () => { clearTimeout(t); t = setTimeout(persist, 400); };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
}

function createWindow(name, options, htmlFile) {
  if (windows[name]) { windows[name].focus(); return windows[name]; }

  options = options || {};
  // Create HIDDEN and reveal on first paint (ready-to-show) so a panel never
  // flashes its empty dark background ("black box") while the renderer loads —
  // the window appears already styled. We only auto-manage this when the caller
  // didn't pass `show` itself (the startup/login flow at launchStartupWindow
  // passes show:false and reveals manually — leave that untouched).
  const manageShow = options.show === undefined;

  // Parent/modal/taskbar wiring for child windows of the main shell.
  let parentWin, modal = false, skipTaskbar = false;
  if (CHILD_WINDOWS.has(name)) {
    const focused = BrowserWindow.getFocusedWindow();
    parentWin = (focused && !focused.isDestroyed()) ? focused
              : (windows['main'] && !windows['main'].isDestroyed() ? windows['main'] : undefined);
    if (parentWin) { skipTaskbar = true; modal = !NON_MODAL_CHILD.has(name); }
  }

  const win = new BrowserWindow({
    ...options,
    ...(parentWin ? { parent: parentWin } : {}),
    modal,
    skipTaskbar,
    show:           manageShow ? false : options.show,
    frame:          true,            // native OS title bar / window controls (proper Windows app chrome)
    backgroundColor: '#f4f6fa',      // light pre-paint background (matches the light default theme)
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
  });
  if (win.removeMenu) win.removeMenu();   // no native menu bar (File/Edit/View/Window/Help)
  applyWindowState(win, name, options);   // maximize by default / restore the user's last size

  if (manageShow) {
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    // Backstop: never leave a window stuck hidden if ready-to-show never fires
    // (e.g. a renderer error) — reveal anyway after a short grace period.
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 2000);
  }

  win.loadFile(path.join(__dirname, 'windows', name, 'index.html'));
  win.on('closed', () => { delete windows[name]; });
  windows[name] = win;
  return win;
}

// Best-effort startup integrity sweep of the managed import inbox. Copy-on-
// import writes userData/inbox/<docId><ext> and then sets documents.working_path;
// a crash between those two steps would leave a stray file with no DB reference.
// This removes such orphans. It is strictly bounded to the inbox directory,
// matches on normalised absolute paths (so a live working copy is never deleted),
// treats a missing inbox as a no-op, and never throws into startup.
function sweepInboxOrphans() {
  try {
    const inbox = path.join(app.getPath('userData'), 'inbox');
    if (!fs.existsSync(inbox)) return;                         // nothing imported yet
    const documents = require('../database/modules/documents');
    const live = new Set(
      documents.getWorkingPaths(getDb())
        .map(p => { try { return path.resolve(p); } catch { return null; } })
        .filter(Boolean)
    );
    let removed = 0;
    for (const name of fs.readdirSync(inbox)) {
      const full = path.resolve(path.join(inbox, name));       // always inside the inbox
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;                              // never recurse / touch dirs
      if (live.has(full)) continue;                            // referenced by a live row — keep
      try { fs.unlinkSync(full); removed++; }
      catch (e) { logger?.warn?.(`[inbox-sweep] could not remove orphan ${full}: ${e.message}`); }
    }
    if (removed) logger?.log?.(`[inbox-sweep] removed ${removed} orphaned working-copy file(s)`);
  } catch (e) {
    try { logger?.warn?.(`[inbox-sweep] skipped: ${e.message}`); } catch {}
  }
}

function getMainWindow()   { return windows['main'];     }

// Crash-safe webContents.send (see src/lib/safe-send.js). A captured webContents
// (e.g. event.sender frozen in a Python-stdout closure) can be DESTROYED while a
// child still streams after its window closed; a raw send then throws an uncaught
// "Object has been destroyed" (native crash dialog). Every webContents.send in
// the main process funnels through this guard.
const safeSend = makeSafeSend(logger);

function notifyMainWindow(channel, ...args) {
  safeSend(windows['main']?.webContents, channel, ...args);
  safeSend(windows['review']?.webContents, channel, ...args);
}

function notifyAllWindows(channel, ...args) {
  Object.values(windows).forEach(w => safeSend(w?.webContents, channel, ...args));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Frameless windows shown via show()/swap don't reliably take OS keyboard focus
  // on Windows — especially after the alwaysOnTop splash closes and the next
  // window is show()'d in the same step. The result is a visible window whose
  // clicked text fields receive no keystrokes ("I clicked the box but can't
  // type"), intermittently, on first-run/packaged machines. Focus every window —
  // and crucially its webContents, so the web page (and the focused input) gets
  // key events, not just the window frame — whenever it is actually shown.
  // Registered before any window is created so it covers the splash, the
  // login/main/license swap, child windows (settings/review/search), and any
  // window added later. Re-fires on every show so restore-from-minimise re-focuses.
  app.on('browser-window-created', (_e, win) => {
    const grabFocus = () => { try { win.focus(); win.webContents.focus(); } catch {} };
    win.on('show', grabFocus);
    if (win.isVisible()) grabFocus();
  });

  // Splash first, before any other startup work, so it appears immediately.
  createSplash();

  const logFile = app.isPackaged
    ? path.join(app.getPath('userData'), 'processing.log')
    : path.join(__dirname, '..', 'processing.log');
  logger.init(logFile, fs);
  diaglog.init(app);   // deep diagnostic log target (enabled lazily when the flag is on)

  // Best-effort: clean up any crash-orphaned managed import copies. Never blocks
  // startup (fully guarded inside the helper).
  sweepInboxOrphans();

  // Best-effort audit-log retention: archive audit_log rows older than the window
  // (settings `audit_retention_days`, default 180; 0 disables) into monthly files
  // under userData/audit-archive — MOVE, never delete-without-archive. Throttled to
  // once/day; fully guarded inside the helper (never throws). Stage A: archived rows
  // are preserved on disk but not yet surfaced in the admin Audit search (Stage B).
  try {
    require('../database/modules/audit_archive').runMaintenance(getDb(), {
      archiveDir: path.join(app.getPath('userData'), 'audit-archive'),
      logger,
    });
  } catch (e) { try { logger?.warn?.(`[audit-archive] startup hook skipped: ${e.message}`); } catch {} }

  // The login window (first-run setup, sign-in, forced password change, admin
  // recovery) is created and revealed by launchStartupWindow() AFTER the splash,
  // once all IPC handlers below are registered. The main shell only appears later
  // once auth-handler confirms a session is established (see 'auth-enter-app').

  // Register all module IPC handlers
  const ctx = {
    ipcMain, getDb,
    resourcePath, pythonExe, pythonArgs, tesseractPath,
    backendScript, configPath, templatesDir,
    createWindow, getMainWindow, notifyMainWindow, notifyAllWindows, safeSend,
    // Read-only telemetry mirror target for the hidden dev inspector (no-op when closed).
    // safeSend guards a destroyed/missing webContents, not just a missing window.
    notifyDevInspector: (channel, ...args) => safeSend(windows['dev-inspector']?.webContents, channel, ...args),
    // Same read-only telemetry tee, aimed at the REVIEW window — used only by the
    // in-Review dev console (Ctrl+Shift+D→M). No-op unless that window exists.
    notifyReview: (channel, ...args) => safeSend(windows['review']?.webContents, channel, ...args),
    // Set true while the in-Review dev console is open; gates --trace + the
    // process-trace route to the Review window (see processing/handler.js).
    reviewTraceActive: false,
    // Dev-only temp dir for OCR crop slices (cleaned on inspector close + app exit).
    devSliceDir: path.join(app.getPath('temp'), 'ds-devslices'),
    windows,
    app, fs, logger,
    spawn: require('child_process').spawn,
    path,
    // Detached-client auth sessions + the concurrent (sticky) seat pool, owned by
    // main so the /v1 API and the admin Licensing IPC share one instance.
    sessionStore: require('./services/sessionService').createSessionStore(),
    seatPool:     require('./services/seatPool').createSeatPool({ getDb }),
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

  // Detached-client read-only API. OFF unless SCANFINDER_API=1 or the admin
  // `client_api_enabled` setting; loopback-only unless TLS set. See modules/api/handler.js.
  apiModule.register(ctx);

  // In-process mailbox/approval workflow for the core app's enhanced Search
  // (entitlement + role gated; reuses workflowService). See modules/workflow/handler.js.
  workflowModule.register(ctx);

  // ── Hidden developer processing inspector (read-only) ───────────────────────
  // Password is verified HERE in the main process; the renderer can only REQUEST
  // unlock and can never self-grant. The inspector window only subscribes to
  // mirrored process telemetry — it invokes no role-protected handler, so existing
  // requireLogin/requireRole boundaries are untouched. Available in dev and
  // packaged builds, gated solely by this password.
  const devSliceDir = ctx.devSliceDir;
  const clearDevSlices = () => {
    try {
      if (!fs.existsSync(devSliceDir)) return;
      for (const f of fs.readdirSync(devSliceDir)) {
        try { fs.unlinkSync(path.join(devSliceDir, f)); } catch {}
      }
    } catch {}
  };
  ipcMain.handle('dev-inspector-unlock', (_e, password) => {
    if (password !== 'SFDEV') return false;         // never log the password
    const win = createWindow('dev-inspector', {
      width: 960, height: 720, minWidth: 640, minHeight: 480,
    });
    // Closing the inspector removes the session's temp OCR slice files.
    win.on('closed', clearDevSlices);
    win.focus();
    return true;
  });
  // In-Review dev console: enable/disable the per-field extraction trace for the
  // Review window. Enabling requires the same SFDEV password (verified HERE, never
  // logged); disabling is unconditional. Sets ctx.reviewTraceActive, which gates
  // --trace and the process-trace route in processing/handler.js. Opens NO window
  // — the console is just a hidden panel inside the existing Review window.
  ipcMain.handle('review-trace-set', (_e, on, password) => {
    if (on) {
      if (password !== 'SFDEV') return false;
      ctx.reviewTraceActive = true;
      return true;
    }
    ctx.reviewTraceActive = false;
    return true;
  });
  // Read-only state getter (boolean) — no mutation, safe to expose.
  ipcMain.handle('dev-inspector-running', () => {
    try { return processingModule.isBatchRunning(); } catch { return false; }
  });
  // Serve a captured OCR slice as a base64 data URI — path MUST resolve inside the
  // dev slice dir (prevents the renderer reading arbitrary files). Dev-only.
  ipcMain.handle('dev-get-slice', (_e, slicePath) => {
    try {
      const root = path.resolve(devSliceDir);
      const abs  = path.resolve(String(slicePath || ''));
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return null;
      return 'data:image/png;base64,' + fs.readFileSync(abs).toString('base64');
    } catch { return null; }
  });
  // Fallback cleanup on clean exit.
  app.on('before-quit', () => {
    try { fs.rmSync(devSliceDir, { recursive: true, force: true }); } catch {}
    try { diaglog.close(); } catch {}
  });

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
      safeSend(windows['review']?.webContents, 'navigate-to-doc', docId);
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

  // ── First-run setup wizard ───────────────────────────────────────────────────
  // The wizard writes individual settings through the existing set-setting path;
  // these signals only own the FLAG + the window/shell swap (main is the decider).
  ipcMain.on('onboarding-complete', () => {
    try { require('../database/modules/learning').setSetting(getDb(), 'first_run_completed', 'true'); }
    catch (e) { logger.warn?.('onboarding flag write failed: ' + e.message); }
    openMainShell();
  });
  // Re-run setup from Settings → General. Admin only (it changes app-wide config).
  ipcMain.on('open-onboarding', () => {
    if (!authModule.hasRole('admin')) return;
    showOnboarding();
  });
  // A sensible pre-fillable default so the only required step is one click —
  // Documents\Scan Finder (created on accept, not here).
  ipcMain.handle('onboarding-suggested-folder', () => {
    try { return path.join(app.getPath('documents'), 'Scan Finder'); } catch { return ''; }
  });
  // Confirm the chosen output folder is actually writable BEFORE the wizard
  // accepts it — otherwise onboarding "finishes" into a path nothing can file to.
  // Creates the folder if missing (so the suggested default works one-click), then
  // round-trips a probe file to prove writability.
  ipcMain.handle('onboarding-validate-folder', (_e, folder) => {
    try {
      if (!folder || !String(folder).trim()) return { ok: false, reason: 'empty' };
      fs.mkdirSync(folder, { recursive: true });
      const probe = path.join(folder, '.scanfinder_write_test');
      fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
      return { ok: true };
    } catch { return { ok: false, reason: 'not_writable' }; }
  });

  // ── User-guide / help window ─────────────────────────────────────────────────
  // Read-only docs; any role may open it. `section` (e.g. 'review') scrolls the
  // guide straight to that section. Mirrors the license window's open/re-open
  // push: send once the page has loaded, or immediately if it's already open.
  ipcMain.on('open-help-window', (_e, section) => {
    const alreadyOpen = !!windows['help'];
    const win = createWindow('help', HELP_WINDOW_OPTIONS, 'index.html');
    if (!win) return;
    const sec = String(section || 'overview');
    const push = () => { try { win.webContents.send('help-section', sec); } catch {} };
    if (alreadyOpen && !win.webContents.isLoading()) { win.focus(); push(); }
    else win.webContents.once('did-finish-load', push);
  });

  // ── Teach-a-new-document wizard (guided, non-technical) ──────────────────────
  // Writes templates/learning, so Admin+Edit like Review. Mirrors the review
  // opener pattern: open cold, or open targeted at a just-scanned document.
  ipcMain.on('open-teach-window', () => {
    if (!authModule.hasRole('admin', 'edit')) return;
    createWindow('teach', { width: 1200, height: 820, minWidth: 960, minHeight: 640 });
  });
  ipcMain.on('open-teach-window-at', (_e, docId) => {
    if (!authModule.hasRole('admin', 'edit')) return;
    const alreadyOpen = !!windows['teach'];
    pendingTeachDocId = docId;
    createWindow('teach', { width: 1200, height: 820, minWidth: 960, minHeight: 640 });
    if (alreadyOpen) {
      safeSend(windows['teach']?.webContents, 'teach-load-doc', docId);
      pendingTeachDocId = null;
    }
  });
  ipcMain.handle('get-teach-target', () => {
    const id = pendingTeachDocId;
    pendingTeachDocId = null;
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
      safeSend(windows['settings']?.webContents, 'navigate-to-template', templateId);
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

  // All IPC handlers are registered — now serialize the startup windows: the
  // splash stays alone for ~2s, then the (preloaded, hidden) login window is
  // revealed as the single follow-on. No overlap with the splash.
  launchStartupWindow();
});

app.on('window-all-closed', () => { app.quit(); });
