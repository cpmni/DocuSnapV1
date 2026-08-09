'use strict';

/**
 * main.js — Electron main process
 *
 * Thin IPC router. All business logic lives in src/modules/.
 * Each module registers its own IPC handlers via module.register(ipcMain, getDb, ...).
 */

const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const { repairKeyboardFocus } = require('./lib/focusRepair');
const { closeCoverWindows, scheduleCoverTeardown } = require('./lib/coverTeardown');

// ── App-data directory (brand rename: DocuSnap → ScanFinder) ──────────────────
// On-disk data lives under userData (SQLite DB, users, cached license tokens,
// inbox, templates, certs, processing.log). The folder is now %APPDATA%\ScanFinder
// (matching productName), but legacy installs kept it in %APPDATA%\DocuSnap. The
// first launch of a renamed build performs a ONE-TIME migration: if the new folder
// doesn't exist yet but the legacy one does, the whole folder is renamed across —
// preserving every existing install's data (DB, settings, license tokens, learned
// templates). If that rename fails (a file is busy), fall back to the legacy folder
// so data is never orphaned. Must run before app 'ready' / first DB open.
const _appDataDir    = app.getPath('appData');
const _userDataDir   = path.join(_appDataDir, 'ScanFinder');
const _legacyDataDir = path.join(_appDataDir, 'DocuSnap');
let   _resolvedUserData = _userDataDir;
try {
  if (!fs.existsSync(_userDataDir) && fs.existsSync(_legacyDataDir)) {
    fs.renameSync(_legacyDataDir, _userDataDir);
  }
} catch (e) {
  if (fs.existsSync(_legacyDataDir)) _resolvedUserData = _legacyDataDir;
}
const { isForbiddenArgv } = require('./lib/forbiddenArgv');

app.setPath('userData', _resolvedUserData);
// REMOTE-DEBUGGING LOCKOUT (2026-08-09 NIGHT, pre-release audit). Anyone could start the shipped
// ScanFinder.exe with `--remote-debugging-port=9222` and attach a full DevTools session to the
// running app: read every window's code, set breakpoints, and call the ~200 privileged bridge
// functions from a console. It is not a privilege escalation — every channel is re-authorised in
// MAIN against the signed-in session — but it is a reverse-engineering harness handed to the
// attacker, and there is no legitimate customer use for it. The sanctioned on-site diagnostic is
// the SFDEV trace console inside Review, which deliberately survives packaging.
// Dev builds are untouched, so the Playwright/CDP driver and the sandbox instances still work.
if (app.isPackaged && isForbiddenArgv(process.argv)) {
  console.error('Scan Finder does not run with remote debugging enabled.');
  app.exit(1);
}
// DEV-ONLY SANDBOX OVERRIDE (owner 2026-08-02): DOCUSNAP_USERDATA points the WHOLE data
// world (DB, inbox copies, debug logs, window-state) at an isolated folder, so a second,
// fully-sandboxed instance can run beside the real app without touching its data. Ignored
// in packaged builds — a customer install can never be re-pointed by an env var.
if (!app.isPackaged && process.env.DOCUSNAP_USERDATA) {
  try {
    fs.mkdirSync(process.env.DOCUSNAP_USERDATA, { recursive: true });
    app.setPath('userData', process.env.DOCUSNAP_USERDATA);
  } catch { /* fall through to the normal userData */ }
}
// Brand the app name so native JS dialogs (confirm/alert) are headed "ScanFinder", not the
// package name "docusnap". Safe: userData is explicitly setPath'd above, so this never
// moves the on-disk data folder.
app.setName('ScanFinder');

// ── GPU compositing fix (windowed-mode ghosting/stutter) ──────────────────────
// Some GPU/driver + window-size combinations tore/blended stale frames in the
// renderer when a window was non-maximized — visible on the physical panel but NOT in
// a screenshot (the renderer buffer was always correct; the glitch was GPU→display
// compositing). Disabling hardware acceleration forces software compositing and
// resolves it. Confirmed by A/B test. The perf cost is negligible here — the UI is
// static panels + still document images, no WebGL/video — so software rendering is a
// safe, stable default. Must be called before app 'ready'.
// (If reclaiming GPU acceleration is ever wanted, try the narrower
//  commandLine.appendSwitch('disable-gpu-compositing') instead and re-test.)
app.disableHardwareAcceleration();
// NOTE: `disable-print-preview` was TRIED 2026-07-18 to get the native Windows print dialog
// out of webContents.print({silent:false}) — it did NOT reroute the programmatic print path
// on Electron 31 (still Chromium's stubbed preview WebUI, physically verified). There is no
// working way to raise the classic native Windows print dialog from webContents.print; do
// not re-add the switch expecting it to.

// Windows toast attribution: without an explicit AppUserModelID, notifications are
// labelled "Electron". Match the installer's shortcut AUMID (build.appId in
// package.json) so toasts show the registered name ("ScanFinder") in the packaged
// app. No-op on non-Windows; in unpackaged dev there's no registered shortcut, so
// the name may still fall back to "Electron" — only the packaged app is affected.
app.setAppUserModelId('com.scanfinder.app');

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
const tutorialModule       = require('./modules/tutorial/handler');
const printModule          = require('./modules/print/handler');

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
let isQuitting = false;   // true only when a real quit is underway (tray Exit / OS) — lets the main window actually close instead of hiding to tray
let tray = null;          // system-tray icon; kept referenced so it isn't garbage-collected

// Doc id to focus when the review window opens via "Edit in Review" from Search.
// Cleared by get-review-target (pulled by the renderer after loadQueue) or
// consumed immediately if the review window is already open.
let pendingReviewDocId = null;
// Full-text query to pre-fill when the Search window opens via the Home "Quick find" card.
// Pulled by the search renderer via get-search-target, or pushed if the window is already open.
let pendingSearchQuery = null;
let pendingSearchView = null;   // Search window's initial view target (e.g. 'mailbox' from Home)
// Same pattern for "open Settings focused on a template" (from Review's "Add to
// Template Manager") — pulled by the settings renderer after loadTemplates(), or
// delivered immediately if the settings window is already open.
let pendingSettingsTemplateId = null;
let pendingSettingsSection = null;
// Same pattern for the teaching wizard opened targeted at a just-scanned doc.
let pendingTeachDocId = null;

const MAIN_WINDOW_OPTIONS    = { width: 1100, height: 750, minWidth: 800, minHeight: 560 };
const LOGIN_WINDOW_OPTIONS   = { width: 460, height: 660, resizable: false, minimizable: false, maximizable: false };
const LICENSE_WINDOW_OPTIONS = { width: 460, height: 560, resizable: false, minimizable: false, maximizable: false };
// The wizard is a FIXED-SIZE window (resizable:false), so its height must fit its TALLEST
// step, not its average one. Step 1 grows by ~95px the moment "Choose a folder" reveals the
// processed-scans path row — at 720 that tipped the panel into its own overflow, so a
// scrollbar appeared and vanished as the card was toggled. Sized for that tallest state.
// The panel keeps its internal overflow-y as the backstop for an unusual theme/font metric.
const ONBOARDING_WINDOW_OPTIONS = { width: 720, height: 820, resizable: false, minimizable: false, maximizable: false };

// …but a fixed 820 must never exceed the screen, or on a 768-high laptop the footer's
// Next button would sit below the taskbar with no way to resize the window. Clamp to the
// work area at open time (screen isn't available at module load).
function onboardingWindowOptions() {
  const opts = { ...ONBOARDING_WINDOW_OPTIONS };
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    if (wa && wa.height > 0) opts.height = Math.max(600, Math.min(opts.height, wa.height - 40));
  } catch { /* screen unavailable — keep the nominal height */ }
  return opts;
}
const LEGAL_WINDOW_OPTIONS = { width: 720, height: 680, resizable: false, minimizable: false, maximizable: false };
// Bump this (and LEGAL.txt's "Version:" header) to re-prompt everyone for acceptance.
const LEGAL_VERSION = '2026-07-01';
const WELCOME_WINDOW_OPTIONS = { width: 720, height: 640, resizable: false, minimizable: false, maximizable: false };
const TUTORIAL_WINDOW_OPTIONS = { width: 980, height: 720, minWidth: 760, minHeight: 560, minimizable: false, maximizable: false };
const HELP_WINDOW_OPTIONS = { width: 940, height: 700, minWidth: 640, minHeight: 460 };

// Programmatic window close that DESTROYS the window even with the tray
// close-interceptor active. Primary windows hide to tray on a USER close; the
// app's own transitions (login↔shell, onboarding) must instead destroy them, or
// a re-shown hidden window would pile up and could leak the previous user's
// session. _allowClose tells the interceptor to let this close through.
function destroyWindow(name) {
  const w = windows[name];
  if (w && !w.isDestroyed()) { w._allowClose = true; w.close(); }
}

// Swap the whole app shell between "logged out" and "in the app". The login
// window is always created BEFORE the others are closed, so the app never
// passes through a zero-window moment.
function showLoginScreen() {
  createWindow('login', LOGIN_WINDOW_OPTIONS, 'index.html');
  // Destroy (not hide) every other window — especially the main shell, so logging
  // out can't leave a hidden previous-user session reachable from the tray.
  Object.keys(windows).forEach((name) => { if (name !== 'login') destroyWindow(name); });
  _wfDigestShown = false;   // re-arm the at-login workflow digest for the NEXT login (Slice 1)
  refreshTrayMenu();   // reflect logged-out state (disable Review/Settings)
}

// Raw shell open — only ever reached AFTER the licensing gate has allowed it.
function openMainShell() {
  // P3 fix (kill switch WIZARD_TEARDOWN_FIX=0 restores the exact legacy path below).
  // Was `main` already alive BEFORE this call? Capture it BEFORE createWindow, because
  // createWindow('main') returns the EXISTING window on its reuse branch (a "Re-run setup"
  // → finish/skip re-enters here). On reuse the shell is already painted, so
  // 'ready-to-show' will NEVER re-fire and the old 12s backstop would be the ONLY teardown
  // — leaving the wizard on screen and clickable until it vanished mid-interaction.
  const P3 = process.env.WIZARD_TEARDOWN_FIX !== '0';
  const mainExisted = !!windows['main'] && !windows['main'].isDestroyed();
  const main = createWindow('main', MAIN_WINDOW_OPTIONS, 'index.html');

  if (!P3) {
    // ── legacy behaviour (byte-identical to pre-P3) ──
    const teardown = () => {
      destroyWindow('login');
      destroyWindow('license');
      destroyWindow('onboarding');
    };
    if (main && !main.isDestroyed()) {
      main.once('ready-to-show', teardown);
      setTimeout(teardown, 12000);
    } else {
      teardown();
    }
  } else {
    // Keep the current cover window (login / license / onboarding) on screen until the main
    // shell has actually PAINTED, so a slow first run never flashes a blank / naked swap (the
    // "loaded with icons but no text" report). Identity-scope the teardown: capture the ACTUAL
    // cover-window instances NOW so a later fire closes only what was on screen at THIS call —
    // never a newer wizard that reused the same slot. scheduleCoverTeardown does the arm/cancel
    // (reuse ⇒ tear down now; fresh ⇒ on ready-to-show with a stored, cleared 12s backstop).
    const covers = [windows['login'], windows['license'], windows['onboarding']];
    scheduleCoverTeardown({ main, mainExisted, teardown: () => closeCoverWindows(covers) });
  }

  refreshTrayMenu();   // reflect logged-in state (enable Review/Settings)
  startLicenseRevalidation();   // P0: catch a server-side revoke WHILE running, not only at launch
  maybeShowWorkflowDigest();    // Slice 1: one-shot at-login "N waiting for your approval" (latched)
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
  createWindow('onboarding', onboardingWindowOptions(), 'index.html');
  destroyWindow('login');
  destroyWindow('license');
}

// Legal/Terms acceptance is recorded LOCALLY as { version, accepted_at } — no personal
// data, no telemetry. A mismatch with the current LEGAL_VERSION re-prompts (so a terms
// update is handled predictably). Read fail-open only to a "not accepted" state, never
// to "accepted", so a read error can never silently skip the gate.
function termsAccepted() {
  try {
    const raw = require('../database/modules/learning').getSetting(getDb(), 'terms_accepted');
    if (!raw) return false;
    return JSON.parse(raw).version === LEGAL_VERSION;
  } catch { return false; }
}

function showLegalGate() {
  const w = createWindow('legal', LEGAL_WINDOW_OPTIONS, 'index.html');
  destroyWindow('login');
  destroyWindow('license');
  // NOT a PRIMARY_WINDOW (so it never hides-to-tray into a headless, unrecoverable
  // state with terms unaccepted). Closing the gate with the X = Decline & Quit.
  // destroyWindow sets _allowClose for the accept/programmatic path, so those close cleanly.
  try {
    w?.on('close', () => { if (!isQuitting && !w._allowClose) { isQuitting = true; app.quit(); } });
    w?.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
  } catch {}
}

// First-run familiarisation tour (concepts), shown once AFTER the setup wizard.
// Gated by its own `welcome_seen` flag (separate from first_run_completed) and
// reopenable from the user menu. Reads fail-closed so an error never re-shows it.
function welcomeSeen() {
  try { return require('../database/modules/learning').getSetting(getDb(), 'welcome_seen') === 'true'; }
  catch { return true; }
}
function showWelcome() {
  const w = createWindow('welcome', WELCOME_WINDOW_OPTIONS, 'index.html');
  // Owned child of the main shell (stays above it) + pull focus on first paint so
  // it can't open behind the main window that was created just before it.
  try { w?.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } }); } catch {}
}

// Wipe the practice run's throwaway temp tree. Backstop teardown so closing the
// window with the X (not just the Done buttons) never leaves sample copies behind.
function wipeTutorialTemp() {
  try { fs.rmSync(tutorialModule.practiceRoot({ app }), { recursive: true, force: true }); } catch {}
}

// Sandboxed beginner "practice run" (Import → Review → Confirm on a bundled sample).
// Owned non-modal child, focus on first paint — same pattern as the welcome tour.
function showTutorial() {
  const w = createWindow('tutorial', TUTORIAL_WINDOW_OPTIONS, 'index.html');
  try {
    w?.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
    w?.on('closed', wipeTutorialTemp);
  } catch {}
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
    // Forced-update floor (slice 2): a REACHABLE backend reported this build below the channel's
    // min_supported_version. Fail-open — gate.forceUpdate is only ever true on a live verdict, so
    // an offline app never lands here. Its own lock window (NOT the licence one).
    if (gate.forceUpdate) { showUpdateLockWindow(); return; }
    // Terms acceptance is enforced HERE, in the main process (never renderer-only),
    // after the licence gate and before onboarding/shell — so it can't be bypassed.
    if (!termsAccepted()) { showLegalGate(); return; }
    if (needsOnboarding()) { showOnboarding(); return; }
    openMainShell();
    return;
  }
  showLicenseWindow(gate);
}

// The forced-update lock — shown ONLY when a reachable backend declared this build older than the
// channel's min_supported_version. A DISTINCT window/verdict from the licence lock (different copy +
// recovery: Update or Quit, never "activate"). Mirrors showLicenseWindow's teardown.
function showUpdateLockWindow() {
  stopLicenseRevalidation();
  const win = createWindow('update-lock', LICENSE_WINDOW_OPTIONS, 'index.html');
  // DESTROY every other window (not .close() — closeToTray would intercept that into a hidden but
  // still-reachable main shell, letting the forced-update lock be defeated by "Open ScanFinder"
  // from the tray). update-lock is deliberately NOT a PRIMARY_WINDOW: like the legal gate, closing
  // it with the X quits — there is no path forward without updating.
  Object.keys(windows).forEach((name) => { if (name !== 'update-lock') destroyWindow(name); });
  try {
    win?.on('close', () => { if (!isQuitting && !win._allowClose) { isQuitting = true; app.quit(); } });
  } catch {}
  return win;
}

function showLicenseWindow(gate) {
  stopLicenseRevalidation();   // we're leaving the main shell — no periodic re-check while locked
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

// Periodic licence re-validation (P0). decideAccess() only runs at startup; without this,
// a licence revoked or expired SERVER-SIDE while the app is already running would not be
// noticed until the next launch. This re-runs the SAME authoritative gate on a timer and,
// on any non-'allow' verdict, locks the running app to the license window. It never locks
// on a transient offline blip: decideAccess() falls back to the cached token within the
// offline grace (returns 'allow'); only a REACHABLE backend with no grant (revoked /
// released) — or grace genuinely expired — yields a lock, so offline grace is preserved.
const LICENSE_REVALIDATE_MS = 6 * 60 * 60 * 1000; // 6h
let _revalTimer = null;
function startLicenseRevalidation() {
  if (_revalTimer) return;                          // already running
  _revalTimer = setInterval(async () => {
    if (!windows['main']) return;                   // only meaningful while the main shell is open
    let gate;
    try { gate = await licensingModule.decideAccess(); }
    catch (e) { logger?.warn?.('periodic licence re-check errored (ignored): ' + e.message); return; }
    if (gate && gate.decision !== 'allow') {
      logger?.warn?.(`periodic licence re-check: ${gate.decision} (${gate.reason}) — locking`);
      showLicenseWindow(gate);                       // stops the timer + swaps to the license window
    } else if (gate && gate.forceUpdate) {
      logger?.warn?.('periodic re-check: build below the supported floor — locking to update');
      showUpdateLockWindow();                         // reachable backend said this version is too old
    }
  }, LICENSE_REVALIDATE_MS);
  if (_revalTimer.unref) _revalTimer.unref();        // don't keep the event loop alive on its own
}
function stopLicenseRevalidation() {
  if (_revalTimer) { clearInterval(_revalTimer); _revalTimer = null; }
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
    // SEC-18: stated, not inherited. These are already the Electron 31 defaults, so this is a
    // zero-behaviour-change assertion of intent — the point is that the safety of every renderer
    // no longer rests on a default a future webPreferences edit could flip silently.
    // The splash has no preload at all, so `sandbox` costs it nothing.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
// share ONE taskbar entry and feel self-contained. They are all NON-MODAL: a modal panel
// LOCKS the main window, so once it's minimised (a tiny skipTaskbar corner box) you can't
// click its toolbar button to bring it back. Non-modal keeps the main window usable, and
// createWindow() already restores + focuses the existing window when its button is clicked
// again. (A future window can still opt INTO modal by being a CHILD_WINDOW not listed here.)
const CHILD_WINDOWS   = new Set(['review', 'settings', 'search', 'teach', 'dev-inspector', 'welcome', 'tutorial', 'stamped-viewer']);
const NON_MODAL_CHILD = new Set(['dev-inspector', 'review', 'settings', 'search', 'teach', 'welcome', 'tutorial', 'stamped-viewer']);
// Top-level "primary" windows that hide to the tray on a user close (the app then
// fully quits ONLY via tray Exit). Their programmatic transitions destroy them
// via destroyWindow(). Child windows close normally.
// update-lock is intentionally NOT here: a forced-update lock must never hide-to-tray into a
// headless, unrecoverable-yet-still-running state (and it manages its own close=quit handler,
// like the legal gate). The rest hide-to-tray so the core keeps running for watch/clients.
const PRIMARY_WINDOWS = new Set(['login', 'license', 'onboarding', 'main']);

const winStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinStates() { try { return JSON.parse(fs.readFileSync(winStateFile(), 'utf8')); } catch { return {}; } }
function saveWinStates(s) { try { fs.writeFileSync(winStateFile(), JSON.stringify(s, null, 2)); } catch { /* ignore */ } }

// True when a saved window rect still falls on a CONNECTED display, so a stale
// position (an unplugged monitor / changed layout) can't restore a window
// off-screen where it looks like it "won't open". Needs a usable overlap.
function _boundsVisible(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  try {
    return screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      const ox = Math.min(b.x + (b.width  || 0), wa.x + wa.width)  - Math.max(b.x, wa.x);
      const oy = Math.min(b.y + (b.height || 0), wa.y + wa.height) - Math.max(b.y, wa.y);
      return ox >= 120 && oy >= 80;   // enough of the window is reachable to drag/use
    });
  } catch { return true; }   // screen unavailable (very early) — don't block restore
}

// Open maximized by default ("fullscreen"); once the user restores/resizes a
// window, remember that and honour it next time. Fixed dialogs (resizable:false,
// e.g. login/licence/onboarding) are left exactly as defined.
// Windows that should ALWAYS open maximized ("fullscreen"), ignoring any remembered
// smaller size — the work surfaces the user asked to default to fullscreen.
const FORCE_MAXIMIZE = new Set(['settings', 'teach', 'review', 'search']);

function applyWindowState(win, name, options) {
  if (options.resizable === false) return;
  if (FORCE_MAXIMIZE.has(name)) { win.maximize(); return; }   // always open maximized; don't restore a smaller size
  const st = loadWinStates()[name];
  if (st && st.userSized && !st.maximized && st.bounds && _boundsVisible(st.bounds)) win.setBounds(st.bounds);
  else win.maximize();   // no saved size, or it would land off-screen → maximize

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
  if (windows[name]) {
    // Reuse a LIVE window. But a window destroyed abnormally (render-process-gone,
    // a parent cascade, GPU crash) may never fire 'closed', leaving a STALE ref
    // whose .focus() throws "Object has been destroyed" — which silently kills the
    // opener (e.g. the Review button does nothing). Drop the corpse and recreate.
    if (!windows[name].isDestroyed()) {
      const w = windows[name];
      // Re-opening a window that's MINIMISED (or hidden) must bring it BACK, not
      // just .focus() it — on Windows focus() alone leaves a minimised window in the
      // taskbar/corner, so the toolbar button "did nothing". Restore then reveal.
      try {
        if (w.isMinimized()) w.restore();
        if (!w.isVisible()) w.show();
        w.focus();
      } catch { /* fall through to recreate if the ref turned out stale */ }
      return w;
    }
    delete windows[name];
  }

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
    // Popout child windows (Review/Settings/Search/Teach/…) get only restore + close —
    // no minimise (a minimised modal child is an easy way to "lose" the window behind the
    // locked main shell). Maximise/restore stays. Standalone windows keep their own option.
    ...(parentWin ? { minimizable: false } : {}),
    modal,
    skipTaskbar,
    show:           manageShow ? false : options.show,
    frame:          true,            // native OS title bar / window controls (proper Windows app chrome)
    backgroundColor: '#f4f6fa',      // light pre-paint background (matches the light default theme)
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // SEC-18: stated, not inherited (see the splash window above). Verified safe before setting
      // `sandbox`: preload.js requires ONLY `electron` (contextBridge + ipcRenderer), both of which
      // are available to a sandboxed preload — it touches no fs/path/os module.
      nodeIntegration:  false,
      sandbox:          true,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),   // src/../assets (was '..','..' — off-by-one that silently dropped the window icon)
  });
  if (win.removeMenu) win.removeMenu();   // no native menu bar (File/Edit/View/Window/Help)
  applyWindowState(win, name, options);   // maximize by default / restore the user's last size

  if (manageShow) {
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    // Backstop: never leave a window stuck hidden if ready-to-show never fires
    // (e.g. a renderer error) — reveal anyway after a grace period. Kept GENEROUS
    // (12s, was 2s): the 2s window was measured from construction (before loadFile),
    // so on a slow-but-fine FIRST run (Windows Defender scanning the unsigned payload +
    // cold disk cache) it pre-empted ready-to-show and revealed a not-yet-painted,
    // text-less shell. ready-to-show still reveals promptly on a normal run; this only
    // extends how long we wait before force-showing a genuinely-wedged renderer.
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 12000);
  }

  win.loadFile(path.join(__dirname, 'windows', name, 'index.html'));
  win.on('closed', () => { delete windows[name]; });
  // Minimise-to-tray: closing ANY primary window (login/license/onboarding/main)
  // hides it so the core keeps running for watch/processing/remote clients. The
  // app fully quits ONLY via tray Exit (which sets isQuitting). The app's own
  // transitions destroy windows via destroyWindow() (sets win._allowClose) — so a
  // logout/swap can't leave a hidden previous-user shell reachable from the tray.
  if (PRIMARY_WINDOWS.has(name)) {
    win.on('close', (e) => {
      if (!isQuitting && !win._allowClose && closeToTrayEnabled()) {
        e.preventDefault();
        win.hide();
        maybeShowTrayHint();
      }
    });
  }
  windows[name] = win;
  return win;
}

// ── System tray (minimise-to-background; Stage 1) ─────────────────────────────
// Re-show whichever primary window exists — the main shell when logged in, else
// the login window — reusing createWindow's restore-if-hidden/minimised path.
function showPrimaryWindow() {
  const name = (windows['main']  && !windows['main'].isDestroyed())  ? 'main'
             : (windows['login'] && !windows['login'].isDestroyed()) ? 'login' : null;
  if (!name) return;
  const w = windows[name];
  try { if (w.isMinimized()) w.restore(); if (!w.isVisible()) w.show(); w.focus(); } catch { /* stale ref */ }
}

// LICENCE GATE for tray reveals: a window hidden to the tray must NOT be re-openable
// after the licence lapses/is revoked. When the user is already in the main shell, re-run
// the gate; if it no longer allows, route to the license window instead and report blocked.
// (Pre-login / license states have no main shell to gate, so they pass through.)
async function trayGateAllows() {
  if (!(windows['main'] && !windows['main'].isDestroyed())) return true;
  let gate;
  try { gate = await licensingModule.decideAccess(); }
  catch { gate = { decision: 'locked_needs_online', reason: 'gate_error' }; }
  // A forced-update verdict must lock even when the LICENCE itself is fine (fail-open leaves
  // decision 'allow' but forceUpdate true) — check it FIRST so a tray reveal can't slip past.
  if (gate && gate.forceUpdate) { showUpdateLockWindow(); return false; }
  if (gate && gate.decision === 'allow') return true;
  showLicenseWindow(gate || { decision: 'locked' });
  return false;
}
async function revealAppGated() { if (await trayGateAllows()) showPrimaryWindow(); }
// True only when the main shell is up — the app is fully entered (past login + all gates).
function inShell() { return !!(windows['main'] && !windows['main'].isDestroyed()); }

// Tray menu — auth-gated items are explicitly DISABLED when the role is absent
// (not silent no-ops). Rebuilt on login/logout via refreshTrayMenu().
function buildTrayMenu() {
  const canReview   = !!(authModule.hasRole && authModule.hasRole('admin', 'edit'));
  const canSettings = !!(authModule.hasRole && authModule.hasRole('admin'));
  return Menu.buildFromTemplate([
    { label: 'Open ScanFinder', click: () => revealAppGated() },
    { type: 'separator' },
    // inShell(): the privileged openers must NEVER open a functional window unless the
    // MAIN shell is up — so a pre-shell gate (legal/onboarding/license) can't be bypassed
    // from the tray regardless of the menu's enabled state or refreshTrayMenu timing.
    { label: 'Open Review',   enabled: canReview,
      click: async () => { if (inShell() && await trayGateAllows() && authModule.hasRole('admin', 'edit')) createWindow('review',   { width: 1200, height: 800, minWidth: 900, minHeight: 600 }); } },
    { label: 'Open Settings', enabled: canSettings,
      click: async () => { if (inShell() && await trayGateAllows() && authModule.hasRole('admin'))         createWindow('settings', { width: 1320, height: 820, minWidth: 1280, minHeight: 660 }); } },
    { type: 'separator' },
    { label: 'Exit ScanFinder', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function refreshTrayMenu() {
  try { if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu()); } catch { /* tray gone */ }
}

function setupTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.ico'));   // ../assets — consistent with the splash + createWindow icon paths (Tray throws on a bad path, unlike BrowserWindow which silently drops it)
    tray.setToolTip('ScanFinder');
    tray.on('double-click', () => revealAppGated());
    refreshTrayMenu();
  } catch (e) {
    logger.warn?.('[tray] could not create tray icon: ' + (e && e.message));
  }
}

// Stage 2: "Close button minimises to tray" setting (default ON). When OFF, the
// close-interceptor lets primary windows close and window-all-closed quits — the
// pre-tray behaviour. Fail-open to the tray behaviour on any read error.
function closeToTrayEnabled() {
  try { return require('../database/modules/learning').getSetting(getDb(), 'close_to_tray', 'true') !== 'false'; }
  catch { return true; }
}

// Show a ONE-TIME notification the first time the app hides to the tray, so the
// user isn't left wondering where the window went. Tracked by a setting so it
// never repeats. Best-effort — a notification failure must not break hide-to-tray.
function maybeShowTrayHint() {
  try {
    const learning = require('../database/modules/learning');
    if (learning.getSetting(getDb(), 'tray_hint_shown', 'false') === 'true') return;
    learning.setSetting(getDb(), 'tray_hint_shown', 'true');
    if (Notification.isSupported && Notification.isSupported()) {
      new Notification({
        title: 'Still running in the background',
        body: 'Minimised to the notification area — watch-folder import and remote search clients keep working. Right-click the tray icon to open it or exit.',
        icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      }).show();
    }
  } catch { /* best-effort */ }
}

// ── Workflow notifications (Slice 1) — ONE shared sink for BOTH transports ─────
// Wired as the workflowService `notifyWorkflow` hook by the desktop workflow handler
// AND the /v1 API handler, so the toast policy + debounce state live in exactly one
// place (eric: two sinks = double toasts under mixed transports). Fan-out MUST use
// notifyAllWindows — notifyMainWindow reaches main+review only and would starve the
// SEARCH window's open mailbox (the cross-user /v1 case is the headline fix; pinned
// in test_workflow_ipc.js). Pull model: the event carries no data; renderers re-pull.
// Decision logic is pure + tested in src/lib/workflowNotify.js; guards run at FIRE
// time (Oracle condition 3 — a toast queued just before logout must not show).
const workflowNotify = require('./lib/workflowNotify');
let _wfToastAgg = null;
let _wfToastTimer = null;
let _wfDigestShown = false;   // per-login latch; showLoginScreen re-arms it
function notifyWorkflowEvent(ev) {
  try {
    // ORDERING IS LOAD-BEARING (Oracle C4): the badge broadcast fires BEFORE the aggregate
    // early-return below, so an unlisted event ('auto_closed' — route closed by doc delete)
    // still refreshes every window's counts. A refactor that hoists the early-return above
    // this line kills the badge for exactly those events. Pinned in test_workflow.js.
    notifyAllWindows('workflow-counts-changed');
    const next = workflowNotify.aggregate(_wfToastAgg, ev || {});
    if (next === _wfToastAgg) return;         // badge-ping-only event (claim/recall/auto_closed)
    _wfToastAgg = next;
    clearTimeout(_wfToastTimer);
    _wfToastTimer = setTimeout(_fireWorkflowToast, 2000);   // trailing debounce: bulk = ONE toast
  } catch { /* notifications are best-effort — never disturb the action */ }
}
function _fireWorkflowToast() {
  const agg = _wfToastAgg; _wfToastAgg = null;
  try {
    let settingEnabled = true;
    try { settingEnabled = require('../database/modules/learning').getSetting(getDb(), 'workflow_toasts_enabled', 'true') !== 'false'; } catch { /* fail-open */ }
    const { getCurrentUser } = require('./modules/auth/handler');
    const toast = workflowNotify.decideToast(agg, {
      isQuitting,
      notificationsSupported: !!(Notification.isSupported && Notification.isSupported()),
      settingEnabled,
      currentUser: getCurrentUser ? getCurrentUser() : null,
    });
    if (toast) new Notification({ ...toast, icon: path.join(__dirname, '..', 'assets', 'icon.ico') }).show();
  } catch { /* best-effort */ }
}
// At-login digest (Slice 1): ONE toast when items await the signing-in user. Flat delay —
// never coupled to ready-to-show (documented can-never-fire mode; openMainShell carries its
// own 12s backstop for exactly that). Latched per login; showLoginScreen clears the latch,
// so a license-revalidation re-entry of openMainShell can never re-fire it (eric).
function maybeShowWorkflowDigest() {
  if (_wfDigestShown) return;
  _wfDigestShown = true;
  setTimeout(() => {
    try {
      if (isQuitting) return;
      if (!(Notification.isSupported && Notification.isSupported())) return;
      const learning = require('../database/modules/learning');
      if (learning.getSetting(getDb(), 'workflow_toasts_enabled', 'true') === 'false') return;
      const ent = require('./services/entitlementService').checkClientEntitlement(getDb());
      if (!ent.workflow || !ent.workflow.entitled) return;   // dark / unlicensed ⇒ silent
      const { getCurrentUser } = require('./modules/auth/handler');
      const me = getCurrentUser && getCurrentUser();
      if (!me) return;
      const n = require('../database/modules/workflow').countInbox(getDb(), me.id);
      if (!n) return;
      new Notification({
        title: n === 1 ? '1 document waiting for your approval' : `${n} documents waiting for your approval`,
        body: 'Open the Mailbox in Search to act.',
        icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      }).show();
    } catch { /* best-effort */ }
  }, 3000);
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
// Single instance: relaunching (e.g. the shortcut while the app is hidden in the
// tray) must re-show the running instance, NOT spawn a second core that would
// double-bind the API/watch. The loser quits; the winner re-shows on 'second-instance'.
// NOTE: this lock is naturally PER-userData-dir (Electron keys it on the userData path,
// which the sandbox override above re-points before we get here) — so a DOCUSNAP_USERDATA
// sandbox instance runs beside the real app without fighting over one lock.
const _gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!_gotSingleInstanceLock) app.quit();
app.on('second-instance', () => revealAppGated());

app.whenReady().then(() => {
  if (!_gotSingleInstanceLock) return;   // a second instance: don't build anything, just quit
  // Frameless windows shown via show()/swap don't reliably take OS keyboard focus
  // on Windows — especially after the alwaysOnTop splash closes and the next
  // window is show()'d in the same step. The result is a visible window whose
  // clicked text fields receive no keystrokes ("I clicked the box but can't
  // type"), intermittently, on first-run/packaged machines. Focus every window —
  // and crucially its webContents, so the web page (and the focused input) gets
  // key events, not just the window frame — whenever it is actually shown.
  // Registered before any window is created so it covers the splash, the
  // login/main/license swap, child windows (settings/review/search), and any
  // ── Navigation / new-window / drop lockdown (audit M4, defence-in-depth) ─────
  // Every app window is a local file:// page under src/windows/. Nothing legitimately
  // navigates off that tree — the Help window navigates BETWEEN its own local pages,
  // which the dir check permits; every EXTERNAL open goes through main-process shell.*
  // via IPC, which these guards never touch. A dropped local .html or a
  // window.open('file://…') would otherwise load a page that KEEPS the preload
  // (privileged IPC) but LOSES the per-page <meta> CSP. Deny all of it. Registered here,
  // before any window is created, so it covers the splash/login/print-ghost too.
  // Kill switch: NAV_GUARD_DISABLED=1. (eric-designed, code-verified against every
  // shell.openExternal/openPath and the Help window's inter-page links.)
  const _appWindowsRoot = (path.join(__dirname, 'windows') + path.sep).toLowerCase();
  const _isInAppWindow = (targetUrl) => require('./lib/navGuard').isInAppWindow(targetUrl, _appWindowsRoot);
  // SECURITY (Stage 2 — M9): the navigation lockdown is ALWAYS on — a security boundary must not
  // have an environment kill switch (the old NAV_GUARD_DISABLED=1 let a local attacker who can edit
  // the shortcut / set a user env var disable the whole guard, and — since the CSP is meta-only —
  // re-open the drop-a-local-HTML → privileged-preload-with-no-CSP path).
  app.on('web-contents-created', (_e, contents) => {
    // No renderer opens a new window (external links go via the open-external IPC →
    // shell.openExternal). Still hand a genuine http(s) URL to the OS browser so a
    // future <a target="_blank"> keeps working; deny the in-app new window either way.
    contents.setWindowOpenHandler(({ url }) => {
      try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch { /* noop */ }
      return { action: 'deny' };
    });
    // The initial loadFile is NOT a "navigation" and never reaches here; only
    // page/user-driven navigations (links, location=, a dropped file) do.
    contents.on('will-navigate', (e, url) => { if (!_isInAppWindow(url)) e.preventDefault(); });
    contents.on('will-redirect', (e, url) => { if (!_isInAppWindow(url)) e.preventDefault(); });
    contents.on('will-attach-webview', (e) => e.preventDefault());   // no <webview> anywhere
  });

  // window added later. Re-fires on every show so restore-from-minimise re-focuses.
  app.on('browser-window-created', (_e, win) => {
    const grabFocus = () => {
      try { win.focus(); win.webContents.focus(); } catch {}
    };
    win.on('show', grabFocus);
    // Do NOT re-issue win.focus() on the window's OWN focus event — on Windows that is a
    // redundant SetForegroundWindow (denied when the process lacks foreground rights) and
    // just adds thrash during the splash→login→shell handoff. Route keys into the web
    // widget only; the OS focus event itself already made this the key window. (eric)
    win.on('focus', () => { try { win.webContents.focus(); } catch {} });
    // NOTE: do NOT mark the window "focus suspect" on win.on('blur') — that fires far too
    // broadly on Windows (a native <select> dropdown OPENING its popup blurs the owning
    // BrowserWindow), so every dropdown-open flagged the window suspect and the next pointer
    // press ran blurWebView() and CLOSED the just-opened dropdown (the "dropdown flashes open
    // and shut" + "no caret" regression). The suspect flag is now set ONLY by the precise
    // armed triggers (dialog wrap / post-Confirm / draw-OCR / the child-close arming below) +
    // the preload's VERIFIED one-shot forceEdge (see focusRepair.js).
    // CHILD-CLOSE ARMING (eric Q4', 2026-07-10; Oracle C1 correction): closing a PARENTED
    // child window (the CHILD_WINDOWS set — review/settings/search/teach/dev-inspector/
    // welcome/tutorial) yanks widget focus from its parent the same way a native dialog
    // does — the known unarmed desync trigger behind the "no caret but typing works" runs.
    // Parentless windows (help/license/splash/login/onboarding) never arm here — their
    // close desyncs are the truthful-FALSE polarity, which the preload's (C) forceEdge
    // one-shot covers on the next press.
    // Arm the PARENT's suspect flag on 'close' (both windows still alive) so the parent's
    // next text-field press runs the full repair edge. This CANNOT re-trip the dropdown pin:
    // native <select> popups are Chromium-internal, never BrowserWindows, so this hook never
    // sees them; and a spurious arm costs exactly one benign full-cycle edge.
    win.on('close', () => {
      try {
        const p = typeof win.getParentWindow === 'function' ? win.getParentWindow() : null;
        if (p && !p.isDestroyed()) p.__focusSuspect = true;
      } catch {}
    });
    if (win.isVisible()) grabFocus();
  });

  // Renderer-driven keyboard-focus repair (Windows): the preload asks for this when a
  // click enters a text field while the render widget lacks OS keyboard focus (the
  // "click a box, no caret until I alt-tab out and back" bug). Re-focusing the sending
  // webContents re-syncs it without an OS window-focus change. Sender-scoped + guarded.
  //
  // ONE shared body, registered on BOTH ipcMain.on (legacy fire-and-forget `send` callers:
  // the proactive draw-fix bridge + any others) AND ipcMain.handle (the pointerdown path
  // uses `invoke` so it can order the input re-focus AFTER this edge is issued — the fix for
  // the cross-trigger dead caret; the two dispatch tables don't collide). Widget-level repair
  // only (blurWebView + wc.focus) — NEVER win.blur()/win.focus() (the title-bar-flash storm;
  // src/lib/focusRepair.js). Suspect flag (mark-focus-suspect) still forces the edge for the
  // stale-TRUE-hasFocus case. eric-designed, 2026-07-10.
  const runEnsureFocus = (wc, info) => {
    try {
      if (!wc || wc.isDestroyed()) return;
      const win = BrowserWindow.fromWebContents(wc);
      const suspect = !!(win && win.__focusSuspect);
      // Diagnostic: one line per text-control press (dev terminal; inert packaged). The new
      // [focus] after: line lives in the preload and reports whether the caret actually landed.
      try {
        console.log(`[focus] press: suspect=${suspect} forceEdge=${!!(info || {}).forceEdge} `
          + `pageHasFocus=${(info || {}).pageHasFocus} `
          + `winFocused=${win && !win.isDestroyed() ? win.isFocused() : '?'} wcFocused=${wc.isFocused ? wc.isFocused() : '?'}`);
      } catch {}
      const res = repairKeyboardFocus(win, wc, { ...(info || {}), suspect });
      if (win && !win.isDestroyed()) win.__focusSuspect = false;
      return res || { edgeRan: false };
    } catch {}
    return { edgeRan: false };
  };
  ipcMain.on('ensure-window-focus', (e, info) => runEnsureFocus(e.sender, info));
  // invoke variant — returns AFTER the repair edge is issued so the preload can deterministically
  // re-assert the input focus in its .then (fixes the single-rAF race that made every re-click
  // re-lose). Body is synchronous; blurWebView/wc.focus queue their messages and this returns.
  ipcMain.handle('ensure-window-focus', (e, info) => runEnsureFocus(e.sender, info) || { edgeRan: false });

  // A renderer signals that a native confirm()/alert() just returned — mark that window's
  // widget focus SUSPECT so the next text-field press repairs it. Deterministic for the dialog
  // case (no dependence on win.on('blur') firing for the native dialog). Sender-scoped.
  ipcMain.on('mark-focus-suspect', (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.__focusSuspect = true;
    } catch {}
  });


  // Splash first, before any other startup work, so it appears immediately.
  createSplash();

  const logFile = app.isPackaged
    ? path.join(app.getPath('userData'), 'processing.log')
    : path.join(__dirname, '..', 'processing.log');
  logger.init(logFile, fs);
  diaglog.init(app);   // deep diagnostic log target (enabled lazily when the flag is on)

  // ── Diagnostic completeness (owner ask 2026-08-02: "check log → know the problem") ──────
  // Four always-on, zero-behaviour-change taps. Everything below is log-only and guarded.
  // 1. STARTUP CONTEXT BLOCK — versions, armed kill-switch envs, key settings — so every
  //    later line has its context without asking the owner what state the app was in.
  try {
    const pkg = require('../package.json');
    logger.log(`startup: ScanFinder ${pkg.version}${pkg.buildRev ? ` (${pkg.buildRev})` : ''} · electron ${process.versions.electron} · node ${process.versions.node} · packaged=${app.isPackaged}`);
    const armed = Object.keys(process.env)
      .filter(k => /^(ANCHOR_|SCOPE_|DIGIT_|REEXTRACT_|CANDIDATE_|REG_|TEMPLATE_|PREFIX_|DATE_IN_|REF_LENGTH|BLIND_|DOCUSNAP_|SNAP_|NAME_|TYPE_|HEADING_|GATE_|CROSSCHECK_|SUPPLIER_|LETTERHEAD_|WORKFLOW_)/.test(k))
      .map(k => `${k}=${process.env[k]}`);
    if (armed.length) logger.log(`startup: armed env switches: ${armed.join(' ')}`);
    try {
      const learning = require('../database/modules/learning');
      const db = getDb();
      const snap = ['processing_mode', 'ocr_dpi', 'auto_file_threshold', 'critical_field_conf_floor',
                    'scope_sweep_enabled', 'auto_rotate_enabled', 'registration_enabled',
                    'born_digital_enabled', 'diagnostic_logging', 'auto_file_enabled']
        .map(k => `${k}=${learning.getSetting(db, k, '(default)')}`).join(' ');
      const mig = db.prepare('SELECT MAX(version) v FROM migrations').get();
      logger.log(`startup: settings: ${snap} · migrations=${mig && mig.v}`);
    } catch (e) { logger.warn(`startup settings snapshot failed: ${e.message}`); }
  } catch { /* context block is best-effort */ }
  // 2. MAIN-PROCESS crash visibility — MONITOR hooks only (default exit/warning semantics
  //    are preserved exactly; these never swallow anything).
  process.on('uncaughtExceptionMonitor', (e) => { try { logger.err(`uncaughtException: ${e && (e.stack || e.message || e)}`); } catch {} });
  process.on('unhandledRejection', (r) => { try { logger.err(`unhandledRejection: ${r && (r.stack || r.message || r)}`); } catch {} });
  // 3. IPC failure visibility — every ipcMain.handle registered after this point logs its
  //    thrown errors (message the renderer already received, now also in the log) and
  //    RETHROWS unchanged, so behaviour is byte-identical.
  try {
    const _origHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, fn) => _origHandle(channel, async (...args) => {
      try { return await fn(...args); }
      catch (e) { try { logger.err(`ipc ${channel}: ${e && (e.stack || e.message || e)}`); } catch {} throw e; }
    });
  } catch { /* wrap is best-effort */ }
  // 4. RENDERER error sink — preload forwards window errors/unhandled rejections here (the
  //    "screenshot the red text" class now lands in the log by itself). Per-sender cap so a
  //    render-loop error can't flood the file.
  const _rendererErrCount = new Map();
  ipcMain.on('renderer-error', (e, info) => {
    try {
      const id = e.sender.id;
      const n = (_rendererErrCount.get(id) || 0) + 1;
      _rendererErrCount.set(id, n);
      if (n > 50) return;                                   // cap per window per session
      const where = (info && info.href ? String(info.href).split('/').slice(-2).join('/') : 'unknown');
      logger.err(`renderer[${where}]: ${info && info.message}${info && info.stack ? `\n${String(info.stack).slice(0, 1200)}` : ''}${n === 50 ? ' (further errors from this window suppressed)' : ''}`);
    } catch { /* sink must never throw */ }
  });

  // Best-effort: clean up any crash-orphaned managed import copies. Never blocks
  // startup (fully guarded inside the helper).
  sweepInboxOrphans();

  // Best-effort: mirror the chosen output/documents folder into the registry so the
  // uninstaller can refuse to delete an app-data folder that contains it (belt-and-braces
  // against a data-wipe ever touching the user's processed documents). Refreshed each launch;
  // also re-written whenever the folder changes (set-setting 'output_folder'). Fully guarded.
  try {
    const { recordOutputPath } = require('./lib/outputPathRegistry');
    recordOutputPath(require('../database/modules/learning').getSetting(getDb(), 'output_folder', null));
  } catch (e) { try { logger?.warn?.(`[output-path-registry] startup hook skipped: ${e.message}`); } catch {} }

  // ── Tamper-evident audit chain (Stage 5b) ──────────────────────────────────────
  // Inject the per-install HMAC key (userData/.audit-key, DPAPI-wrapped) into the key-agnostic
  // DB layer, so every subsequent audit row is hash-chained. Set BEFORE the archive run and
  // before any startup audit write. Fully guarded — a missing/undecryptable key leaves the chain
  // INERT (older behaviour, NULL hmac), never blocks launch.
  try {
    require('../database/modules/auth').setAuditKey(require('./lib/auditKey').getAuditKey(logger));
  } catch (e) { try { logger?.warn?.(`[audit-chain] key wiring skipped: ${e.message}`); } catch {} }

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

  // ── Opt-in diagnostics collector (document-data-FREE; see DIAGNOSTICS_PLAN.md).
  //    OFF by default → fully inert until the user consents. Best-effort init. ────
  let telemetry;
  try {
    const { createTelemetry } = require('./modules/telemetry');
    const { defaultTransport } = require('./lib/license/client');
    const { computeFpHash }    = require('./lib/license/fingerprint');
    const { getSetting }       = require('../database/modules/learning');
    const os = require('os');
    let licCfg = {};
    try { licCfg = JSON.parse(fs.readFileSync(resourcePath('config', 'license.json'), 'utf8')); } catch {}
    telemetry = createTelemetry({
      db: getDb(),
      getSetting,
      post: (url, body) => defaultTransport('POST', url, body, 2500),
      config: { base_url: licCfg.base_url, product_id: licCfg.product_id },
      fpHash: (() => { try { return computeFpHash(licCfg.product_id); } catch { return null; } })(),
      appInfo: {
        app_version:      app.getVersion(),
        build_rev:        (() => { try { return require('../package.json').buildRev || ''; } catch { return ''; } })(),
        os_version:       `${os.type()} ${os.release()}`.trim().slice(0, 48),
        electron_version: process.versions.electron,
        arch:             process.arch,
      },
      logger,
    });
  } catch (e) { try { logger?.warn?.('telemetry init skipped: ' + e.message); } catch {} }

  // Register all module IPC handlers
  const ctx = {
    ipcMain, getDb, telemetry,
    resourcePath, pythonExe, pythonArgs, tesseractPath,
    backendScript, configPath, templatesDir,
    createWindow, getMainWindow, notifyMainWindow, notifyAllWindows, safeSend,
    // Slice 1: the ONE workflow-notification sink shared by the desktop + /v1 transports
    // (fan-out to ALL windows + debounced toast policy — see notifyWorkflowEvent above).
    notifyWorkflowEvent,
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
    // main so the /v1 API and the admin Licensing IPC share one instance. Uses the
    // shared() singleton so the admin auth handlers can REVOKE a user's /v1 sessions
    // (disable / role change / password reset) against the very store the API uses.
    sessionStore: require('./services/sessionService').shared(),
    seatPool:     require('./services/seatPool').createSeatPool({ getDb }),
  };

  authModule.register(ctx);
  // The login window owns these transitions but has no window-management
  // powers of its own (by design — preload only exposes auth IPC there);
  // it just signals "I'm done" and main.js performs the swap.
  // SECURITY (Stage 2 — M2): only the LOGIN window, with a live session, may swap into the main
  // shell. Without this a compromised pre-auth renderer could send 'auth-enter-app' and land in the
  // main shell unauthenticated (the data IPCs would still refuse individually, but "login is the
  // door" would be defeated). Sender-scoped like legal-accept (fromLegalWindow, below).
  ipcMain.on('auth-enter-app',   (e) => {
    if (BrowserWindow.fromWebContents(e.sender) !== windows['login']) return;
    if (!authModule.getCurrentUser()) return;
    enterMainApp();
  });
  ipcMain.on('auth-show-login',  () => showLoginScreen());
  // Licensing gate signal (Phase 2): the renderer can only REQUEST entry; the
  // main process re-runs decideAccess() and refuses unless the state allows.
  // The renderer can never self-grant access into the main shell. Sender+session
  // scoped (Stage 2 — M2): only the LICENCE window (shown post-login) may signal.
  ipcMain.on('license-enter-app', (e) => {
    if (BrowserWindow.fromWebContents(e.sender) !== windows['license']) return;
    if (!authModule.getCurrentUser()) return;
    enterMainApp();
  });

  // Manual "re-check licence now" (Settings → Licensing "Refresh"). Runs the SAME
  // authoritative gate as startup/periodic, so a server-side revoke or expiry takes effect
  // ON DEMAND: it re-validates and, on any non-'allow' verdict, locks the running app to
  // the license window. On 'allow' the cached token + per-feature counts were just
  // refreshed by decideAccess, so the Settings display reflects the latest state. Never
  // throws into the renderer; an unexpected error leaves the app running (the startup +
  // 6h periodic checks still apply), so a transient glitch can't lock a working user out.
  ipcMain.handle('license-recheck', async () => {
    let gate;
    try { gate = await licensingModule.decideAccess(); }
    catch (e) { logger?.warn?.('manual licence re-check errored: ' + e.message); return { decision: 'error', reason: 'recheck_error' }; }
    if (gate && gate.decision !== 'allow') {
      stopLicenseRevalidation();
      showLicenseWindow(gate);
    }
    return gate;
  });

  // Runtime flag for renderer dev-gating (e.g. the dev-only "Erase ALL data" button
  // in Settings → Learning Recovery). True only in an unpackaged/dev build; the
  // renderer keeps the control hidden in packaged/production builds.
  ipcMain.handle('app-is-dev', () => !app.isPackaged);

  // ── About box: version details + third-party attribution ───────────────────
  ipcMain.handle('get-app-about', () => {
    let copyright = '', buildRev = null;
    try { copyright = require('../package.json').build.copyright || ''; } catch { /* ignore */ }
    // Build stamp: baked into the packaged package.json by electron-builder
    // (extraMetadata.buildRev = BUILD_REV); in unpackaged dev, read the live git sha.
    try { buildRev = require('../package.json').buildRev || null; } catch { /* not baked */ }
    if (!buildRev && !app.isPackaged) {
      try { buildRev = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { /* no git */ }
    }
    return { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, buildRev, copyright };
  });
  // Opens the bundled THIRD-PARTY-LICENSES.txt in the OS default viewer.
  // resourcePath resolves it in BOTH dev (repo root) and packaged (extraResources).
  ipcMain.handle('open-third-party-licenses', async () => {
    const p = resourcePath('THIRD-PARTY-LICENSES.txt');
    if (!fs.existsSync(p)) return { ok: false, error: 'notice file not found' };
    const err = await shell.openPath(p);   // '' on success
    return { ok: err === '', error: err || undefined };
  });

  // ── Legal / Terms ──────────────────────────────────────────────────────────
  // Single source of truth: bundled LEGAL.txt (also the installer's licence page).
  // resourcePath resolves it in dev (repo root) AND packaged (extraResources).
  const legalPath = () => resourcePath('LEGAL.txt');
  // SHA-256 of the exact LEGAL.txt bytes accepted — recorded WITH the acceptance so we can
  // prove WHICH text was agreed (not just "the July version"). '' if the file can't be read.
  const legalTextHash = () => {
    try { return require('crypto').createHash('sha256').update(fs.readFileSync(legalPath())).digest('hex'); }
    catch { return ''; }
  };
  ipcMain.handle('get-legal-text', () => {
    try { return { version: LEGAL_VERSION, text: fs.readFileSync(legalPath(), 'utf8') }; }
    catch { return { version: LEGAL_VERSION, text: '' }; }
  });
  ipcMain.on('open-legal', async () => { try { await shell.openPath(legalPath()); } catch {} });
  // The mutating handlers are the gate's authority — only the legal window may call them,
  // so a first-party (or compromised) renderer can't self-accept or quit the app.
  const fromLegalWindow = (e) => BrowserWindow.fromWebContents(e.sender) === windows['legal'];
  // Record acceptance LOCALLY only — { version, hash, app_version, accepted_at }. No personal
  // data, no telemetry. The hash is evidence of the exact text; re-prompting still keys on
  // LEGAL_VERSION (a material bump), so an editorial typo fix won't eject everyone.
  ipcMain.on('legal-accept', (e) => {
    if (!fromLegalWindow(e)) return;
    // Never record acceptance of terms that failed to load (empty text) — the user can't
    // have read them; leave unaccepted so the gate re-shows.
    if (!legalTextHash()) { logger.warn?.('terms acceptance refused: LEGAL.txt unreadable'); return; }
    try {
      require('../database/modules/learning').setSetting(getDb(), 'terms_accepted',
        JSON.stringify({ version: LEGAL_VERSION, hash: legalTextHash(),
                         app_version: app.getVersion(), accepted_at: new Date().toISOString() }));
    } catch (err) { logger.warn?.('terms acceptance write failed: ' + err.message); }
    destroyWindow('legal');
    if (needsOnboarding()) { showOnboarding(); return; }
    openMainShell();
  });
  ipcMain.on('legal-decline', (e) => { if (!fromLegalWindow(e)) return; isQuitting = true; app.quit(); });

  // Forced-update lock: Quit closes the app. Guarded to the update-lock window's own webContents.
  // (The "Update" button uses the existing scheme-allowlisted open-update-url IPC.)
  ipcMain.on('update-lock-quit', (e) => {
    if (BrowserWindow.fromWebContents(e.sender) !== windows['update-lock']) return;
    isQuitting = true; app.quit();
  });

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

  // Document printing through the customer's printer driver (print-document /
  // print-available). Kill switch: setting printing_enabled (default OFF). See
  // modules/print/handler.js.
  printModule.register(ctx);
  tutorialModule.register(ctx);

  // Diagnostics lifecycle (all gated on consent INSIDE telemetry → inert until opt-in;
  // never blocks startup): one app_start event, a deferred + periodic best-effort flush,
  // and the SAFE renderer-crash signal (render-process-gone changes no exit semantics).
  try {
    telemetry?.recordAppStart();
    setTimeout(() => { try { telemetry?.flush(); } catch {} }, 60000 + Math.floor(Math.random() * 30000));
    setInterval(() => { try { telemetry?.flush(); } catch {} }, 30 * 60 * 1000);
    app.on('render-process-gone', (_e, wc, details) => {
      // Identify WHICH window died (by its HTML file basename — 'review'/'settings'/'main'/…,
      // no document data) + the exit code, and LOG it locally too — "reason: crashed" alone
      // (telemetry-only) can't be diagnosed. reason is one of crashed|oom|killed|
      // abnormal-exit|launch-failed|integrity-failure.
      let winName = 'unknown';
      try {
        const u = wc && !wc.isDestroyed() ? wc.getURL() : '';
        const m = /([^/\\]+)\.html/i.exec(u || '');
        if (m) winName = m[1];
      } catch {}
      const reason   = details && details.reason;
      const exitCode = details && details.exitCode;
      try { logger?.err?.(`[renderer-crash] window=${winName} reason=${reason} exitCode=${exitCode}`); } catch {}
      try { telemetry?.record('renderer_crash', { reason, window: winName, exit_code: exitCode }); } catch {}
    });
  } catch {}

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
    // DEV-ONLY: the standalone main-window inspector is removed from packaged/customer builds
    // (kept for `npm start` development). The in-REVIEW trace console below stays available in
    // packaged builds for on-site diagnosis. Neither is documented in the help files.
    if (app.isPackaged) return false;
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
    // SECURITY (Stage 2 — L2): role-gate as well as the SFDEV password. The password ships in the
    // asar (not a secret under the local threat model); the trace it arms dumps cropped document
    // imagery to a temp dir, so keep it behind the same admin/edit boundary as the rest of the dev
    // surface (dev-inspector-running / dev-get-slice above).
    if (!(authModule.hasRole && authModule.hasRole('admin', 'edit'))) return false;
    if (on) {
      if (password !== 'SFDEV') return false;
      ctx.reviewTraceActive = true;
      return true;
    }
    ctx.reviewTraceActive = false;
    return true;
  });
  // Read-only state getter (boolean) — no mutation. Login/role-gated (§4a #3) to keep the
  // devtools-reachable dev IPCs behind the same admin/edit boundary as the review surface.
  ipcMain.handle('dev-inspector-running', () => {
    if (!(authModule.hasRole && authModule.hasRole('admin', 'edit'))) return false;
    try { return processingModule.isBatchRunning(); } catch { return false; }
  });
  // Serve a captured OCR slice as a base64 data URI — path MUST resolve inside the
  // dev slice dir (prevents the renderer reading arbitrary files). Dev-only + role-gated:
  // a slice is cropped document imagery, so keep it off a read-only user (§4a #3).
  ipcMain.handle('dev-get-slice', (_e, slicePath) => {
    if (!(authModule.hasRole && authModule.hasRole('admin', 'edit'))) return null;
    try {
      const root = path.resolve(devSliceDir);
      const abs  = path.resolve(String(slicePath || ''));
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return null;
      return 'data:image/png;base64,' + fs.readFileSync(abs).toString('base64');
    } catch { return null; }
  });
  // Fallback cleanup on clean exit.
  app.on('before-quit', () => {
    // Any quit path (tray Exit, OS shutdown, app.quit) → allow the main window to
    // actually close instead of hiding to tray.
    isQuitting = true;
    try { telemetry?.record('app_exit'); telemetry?.flush(); } catch {}   // best-effort, consent-gated
    // Stop background work so Exit leaves no orphaned python.exe: clear the watch
    // poll timer + kill in-flight watch Python, and tree-kill the manual batch.
    try { watchModule.stopForQuit(); } catch (e) { logger.warn?.('[quit] watch cleanup: ' + (e && e.message)); }
    try { processingModule.killAll(); } catch (e) { logger.warn?.('[quit] processing cleanup: ' + (e && e.message)); }
    try { fs.rmSync(devSliceDir, { recursive: true, force: true }); } catch {}
    try { wipeTutorialTemp(); } catch {}
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
    if (!authModule.hasRole('admin', 'edit')) {
      logger?.warn?.('[open-review] blocked: caller lacks admin/edit role');
      return;
    }
    try {
      const win = createWindow('review', { width: 1200, height: 800, minWidth: 900, minHeight: 600 });
      const bounds = (win && !win.isDestroyed()) ? win.getBounds() : null;
      logger?.log?.(`[open-review] window created (destroyed=${win?.isDestroyed?.()}, bounds=${JSON.stringify(bounds)})`);
    } catch (e) {
      // A corrupt registry entry must never permanently brick Review — log + heal.
      logger?.warn?.(`[open-review] createWindow THREW: ${e && e.message}`);
      try { delete windows['review']; } catch {}
    }
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
  ipcMain.on('onboarding-complete', (e) => {
    // SECURITY (Stage 2 — M2): only the onboarding window may retire first-run setup and open the
    // main shell. Without this any renderer could permanently set first_run_completed + openMainShell.
    if (BrowserWindow.fromWebContents(e.sender) !== windows['onboarding']) return;
    try {
      const learning = require('../database/modules/learning');
      learning.setSetting(getDb(), 'first_run_completed', 'true');
      // First-run dashboard default: show the essentials, hide the extra cards
      // (Quick find, Filed automatically, Storage, Backup, Search clients). Only
      // seed when unset so a user's own card choices are never overwritten.
      if (!learning.getSetting(getDb(), 'dashboard_hidden_cards')) {
        learning.setSetting(getDb(), 'dashboard_hidden_cards',
          JSON.stringify(['dash-quickfind', 'dash-autofile', 'dash-storage', 'dash-backup', 'dash-clients']));
      }
    } catch (e) { logger.warn?.('onboarding flag write failed: ' + e.message); }
    openMainShell();
    if (!welcomeSeen()) showWelcome();   // first-run concepts tour, on top of Home
  });
  // First-run familiarisation tour: close (set the flag) and optionally jump to Import.
  ipcMain.on('welcome-done', (_e, action) => {
    try { require('../database/modules/learning').setSetting(getDb(), 'welcome_seen', 'true'); }
    catch (e) { logger.warn?.('welcome flag write failed: ' + e.message); }
    const wl = windows['welcome'];
    destroyWindow('welcome');
    if (action === 'import') { try { windows['main']?.webContents.send('welcome-goto-import'); } catch {} }
    // Open the practice run only AFTER the welcome window has fully closed — otherwise
    // createWindow parents the tutorial to the still-focused (closing) welcome window,
    // so it dies with it. Deferring to 'closed' lets it parent to the main shell.
    else if (action === 'practice') {
      if (wl && !wl.isDestroyed()) wl.once('closed', () => showTutorial());
      else showTutorial();
    }
  });
  // Reopen the tour from the user menu (no first-run gate — explicit request).
  ipcMain.on('open-welcome', () => showWelcome());
  // Sandboxed practice run — open from the user menu (Slice 3 adds the other entry points).
  ipcMain.on('open-tutorial', () => showTutorial());
  // Close the practice run and optionally jump the Home shell to Import.
  ipcMain.on('tutorial-done', (_e, action) => {
    try { require('../database/modules/learning').setSetting(getDb(), 'practice_run_completed', 'true'); } catch {}
    destroyWindow('tutorial');   // fires 'closed' → wipeTutorialTemp
    if (action === 'import') { try { windows['main']?.webContents.send('welcome-goto-import'); } catch {} }
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
  ipcMain.handle('onboarding-validate-folder', (e, folder) => {
    // SECURITY (Stage 2 — E-5): only the onboarding window may drive this mkdir + probe-write.
    // Otherwise any renderer could create arbitrary directories on disk pre-auth.
    if (BrowserWindow.fromWebContents(e.sender) !== windows['onboarding']) return { ok: false, reason: 'forbidden' };
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

  // Open an external link (e.g. "Purchase licence" → the Scan Finder website) in the
  // user's default browser. Hardened: only http(s) URLs are ever passed to the OS, so a
  // renderer can't smuggle a file:// or app-protocol URL through this channel.
  ipcMain.on('open-external', (_e, url) => {
    try {
      const u = new URL(String(url || ''));
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
    } catch { /* malformed URL — ignore */ }
  });

  // ── Teach-a-new-document wizard (guided, non-technical) ──────────────────────
  // Writes templates/learning, so Admin+Edit like Review. Mirrors the review
  // opener pattern: open cold, or open targeted at a just-scanned document.
  ipcMain.on('open-teach-window', () => {
    if (!authModule.hasRole('admin', 'edit')) return;
    createWindow('teach', { width: 1200, height: 820, minWidth: 960, minHeight: 640 });
  });
  // Secure stamped-copy viewer (owner 2026-08-02): in-app page-image viewing of a workflow
  // decision copy — no shell open, no path in any renderer. Any logged-in user may OPEN the
  // window; the pages IPC enforces the real party-or-admin + entitlement gate server-side.
  let pendingStampedRouteId = null;
  ipcMain.on('open-stamped-viewer', (_e, routeId) => {
    if (!authModule.hasRole('admin', 'edit', 'readonly')) return;   // any signed-in role; the pages IPC re-gates for real
    const alreadyOpen = !!windows['stamped-viewer'] && !windows['stamped-viewer'].isDestroyed();
    pendingStampedRouteId = Number(routeId) || null;
    createWindow('stamped-viewer', { width: 900, height: 950, minWidth: 640, minHeight: 480 });
    if (alreadyOpen) safeSend(windows['stamped-viewer']?.webContents, 'stamped-viewer-load', pendingStampedRouteId);
  });
  ipcMain.handle('get-stamped-viewer-target', () => {
    const id = pendingStampedRouteId;
    return id;
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
    createWindow('settings', { width: 1320, height: 820, minWidth: 1280, minHeight: 660 });
  });

  // Open Settings focused on a specific template (from Review → "Add to
  // Template Manager"), so its sample loads in the editor preview automatically.
  ipcMain.on('open-settings-window-at-template', (_e, templateId) => {
    if (!authModule.hasRole('admin')) return;
    const alreadyOpen = !!windows['settings'];
    pendingSettingsTemplateId = templateId;
    createWindow('settings', { width: 1320, height: 820, minWidth: 1280, minHeight: 660 });
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

  // Open Settings focused on a specific section/tab (e.g. Activate → 'licensing').
  ipcMain.on('open-settings-window-at-section', (_e, section) => {
    if (!authModule.hasRole('admin')) return;
    const alreadyOpen = !!windows['settings'];
    pendingSettingsSection = section;
    createWindow('settings', { width: 1320, height: 820, minWidth: 1280, minHeight: 660 });
    if (alreadyOpen) {
      safeSend(windows['settings']?.webContents, 'navigate-to-section', section);
      pendingSettingsSection = null;
    }
  });
  ipcMain.handle('get-settings-section-target', () => {
    const s = pendingSettingsSection;
    pendingSettingsSection = null;
    return s;
  });
  ipcMain.on('open-search-window', (_e, q) => {
    if (!authModule.getCurrentUser()) return;
    const query = (typeof q === 'string' && q.trim()) ? q.trim() : null;
    const alreadyOpen = !!windows['search'];
    pendingSearchQuery = query;
    createWindow('search', { width: 1200, height: 780, minWidth: 1000, minHeight: 600 });
    if (alreadyOpen && query) {
      // Window already loaded — push the query directly (no get-search-target poll).
      safeSend(windows['search']?.webContents, 'search-set-query', query);
      pendingSearchQuery = null;
    }
  });
  // The search renderer pulls this once on load to pre-fill the Quick-find query (else null).
  ipcMain.handle('get-search-target', () => {
    const q = pendingSearchQuery;
    pendingSearchQuery = null;
    return q;
  });

  // Open the Search window LANDED on a named view (Home "Open Mailbox" → 'mailbox').
  // Independent of the Quick-find query channel above (do NOT overload get-search-target).
  // A view toggle carries no privileged mutation, so it matches open-search-window's trust
  // level; the mailbox view itself is entitlement-gated in the renderer (a no-op if the
  // add-on is off), and the Home card is hidden unless licensed.
  ipcMain.on('open-search-window-at', (_e, view) => {
    if (!authModule.getCurrentUser()) return;
    const alreadyOpen = !!windows['search'];
    pendingSearchView = (view === 'mailbox') ? 'mailbox' : null;
    createWindow('search', { width: 1200, height: 780, minWidth: 1000, minHeight: 600 });
    if (alreadyOpen && pendingSearchView) {
      safeSend(windows['search']?.webContents, 'search-goto', pendingSearchView);
      pendingSearchView = null;
    }
  });
  // The search renderer pulls this once on load to land on its initial view (else null).
  ipcMain.handle('get-search-view-target', () => {
    const v = pendingSearchView;
    pendingSearchView = null;
    return v;
  });

  // All IPC handlers are registered — now serialize the startup windows: the
  // splash stays alone for ~2s, then the (preloaded, hidden) login window is
  // revealed as the single follow-on. No overlap with the splash.
  setupTray();          // system-tray icon, present for the life of the app
  launchStartupWindow();
});

// With "close to tray" ON, primary windows hide (kept alive) so this never fires
// during normal use, and a real quit comes via tray Exit (isQuitting). With the
// setting OFF, windows close normally and this restores the plain quit-on-close
// behaviour. Either way the app never lingers headless.
app.on('window-all-closed', () => { if (isQuitting || !closeToTrayEnabled()) app.quit(); });
