'use strict';

/**
 * client/renderer/renderer.js
 * Renderer for the detached search client. Talks ONLY through window.scanfinder
 * (preload bridge) — no Node, no token, no direct network. Presentation layer:
 * a real button system (variants + icons + states), connection/role context,
 * search↔preview tie-back, confidence meters, and a legible mailbox.
 */

const $ = (id) => document.getElementById(id);
const api = window.scanfinder;

let role = null;
let workflowEntitled = false; // workflow add-on (mailbox/approvals) — licensed separately from search
let blocked = false;
let currentBox = 'inbox';
let recipientsCache = null;
let myOpenRoutes = {}; // document_id -> open route addressed to me (recipient/claimant)
let searchPrimed = false; // load the Search view's at-rest recent list once, lazily
let reviewBox = 'queue';   // review sub-tab: 'queue' | 'deferred'
let docTypesCache = null;  // [{slug,name,ref_field_key,date_field_key,fields:[...]}] for the type dropdown
let rvCurrentId = null;    // doc open in the Review detail pane
let rvHeartbeat = null;    // presence "I'm viewing this" timer

// ── Theme (mirrors the main app's six named themes; persisted on this device) ──
const THEMES = ['light', 'warm', 'slate', 'dark', 'midnight', 'graphite',
                'spring', 'summer', 'autumn', 'winter', 'festive'];
const DARK_THEMES = new Set(['dark', 'midnight', 'graphite', 'festive']);
const _ls = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
function currentTheme() { const t = _ls.get('sf-client-theme', 'warm'); return THEMES.includes(t) ? t : 'warm'; }
// Real logo path for the current mode; syncLogos swaps every brand img on a theme change.
function _logoSrc() { return DARK_THEMES.has(currentTheme()) ? '../assets/logo-mark-dark.svg' : '../assets/logo-mark.svg'; }
function syncLogos() { document.querySelectorAll('img[data-logo]').forEach((im) => { im.src = _logoSrc(); }); }
function applyTheme(name) {
  const t = THEMES.includes(name) ? name : 'warm';
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  root.setAttribute('data-mode', DARK_THEMES.has(t) ? 'dark' : 'light');
  _ls.set('sf-client-theme', t);
  _ls.set(DARK_THEMES.has(t) ? 'sf-client-dark' : 'sf-client-light', t);   // remember last light/dark pick
  const sel = $('theme-select'); if (sel) sel.value = t;
  const tog = $('side-dark-toggle'); if (tog) tog.checked = DARK_THEMES.has(t);
  syncLogos();
}
function toggleDarkMode() {
  const cur = currentTheme();
  applyTheme(DARK_THEMES.has(cur) ? _ls.get('sf-client-light', 'warm') : _ls.get('sf-client-dark', 'dark'));
}
applyTheme(currentTheme());   // apply as early as possible (script runs after DOM parse)

// ── Sidebar clock (bottom-left, like the main app) ──
function tickClock() {
  const now = new Date();
  const t = $('side-time'), d = $('side-date');
  if (t) t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
tickClock();
setInterval(tickClock, 20000);

// ── Inline SVG icons (CSP-safe: no external icon library) ────────────────────
const ICO = {
  brand:  '<path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8.5 13h7"/><path d="M8.5 16.5h4.5"/>',
  signin: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  signout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  check:  '<path d="M20 6 9 17l-5-5"/>',
  reject: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  claim:  '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  recall: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a6 6 0 0 1 0 12h-3"/>',
  view:   '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  assign: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  inbox:  '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13 6 5h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  doc:    '<path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
  lock:   '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trash:  '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  home:   '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const ico = (name, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[name] || ''}</svg>`;

// Replace every <… data-ic="name"> placeholder in the static HTML with its SVG.
function hydrateIcons() {
  document.querySelectorAll('[data-ic]').forEach((el) => {
    // NB: el.className on an SVGElement is an SVGAnimatedString, not a string —
    // use getAttribute so the size class (e.g. "brandmark") is preserved.
    const cls = el.getAttribute('class') || 'ic';
    const name = el.getAttribute('data-ic');
    if (name === 'brand') {
      // The real Scan Finder logo (img), not a line icon. ONE img; its src is swapped
      // light/dark by syncLogos() so it keeps each spot's own display/centring rules.
      const style = el.getAttribute('style') ? ` style="${el.getAttribute('style')}"` : '';
      el.outerHTML = `<img class="${cls}" data-logo src="${_logoSrc()}" alt="Scan Finder"${style}>`;
      return;
    }
    el.outerHTML = ico(name, cls);
  });
}

const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const canDecide = () => role === 'admin' || role === 'edit';

function mkBtn({ label, icon, variant = 'secondary', sm = true, onClick }) {
  const b = document.createElement('button');
  b.className = `btn btn-${variant}${sm ? ' btn-sm' : ''}`;
  b.innerHTML = (icon ? ico(icon) : '') + `<span>${esc(label)}</span>`;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

async function withBusy(btn, fn) {
  const html = btn.innerHTML;
  btn.classList.add('is-busy');
  btn.innerHTML = ico('refresh', 'ic spin') + '<span>Working…</span>';
  try { return await fn(); } finally { btn.classList.remove('is-busy'); btn.innerHTML = html; }
}

function toast(msg, kind) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
    background: 'var(--surface2)', border: '1px solid var(--border2)',
    color: kind === 'err' ? 'var(--err)' : 'var(--text)', padding: '10px 16px',
    borderRadius: '10px', fontSize: '13px', boxShadow: 'var(--shadow)', zIndex: '50',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function setConn(mode, text, short) {
  const cls = 'dot' + (mode === 'ok' ? ' ok' : mode === 'warn' ? ' warn' : mode === 'block' ? ' err' : '');
  // Login screen indicator → full text; sidebar status pill → short label + coloured pill.
  const ld = $('conn-dot'); if (ld) ld.className = cls;
  const lt = $('conn-text'); if (lt) lt.textContent = text;
  const sd = $('side-conn-dot'); if (sd) sd.className = cls;
  const st = $('side-conn-text'); if (st) st.textContent = short || text;
  const pill = $('side-status');
  if (pill) {
    pill.classList.remove('status-ok', 'status-warn', 'status-err');
    pill.classList.add(mode === 'warn' ? 'status-warn' : mode === 'block' ? 'status-err' : 'status-ok');
    pill.title = text;   // full detail (incl. API version) on hover
  }
}

function showOnly(id) {
  for (const s of ['connecting', 'connect', 'login', 'locked', 'app']) $(s).classList.toggle('hidden', s !== id);
}
function applyConn(h) {
  if (h.mode === 'warn') setConn('warn', h.reason || 'Version drift', 'Drift');
  else if (h.ok) setConn('ok', `Connected · API v${h.serverVersion}`, 'Connected');
  else setConn('block', h.reason || 'Not connected', 'Offline');
}
let _caPem = null; // pinned server certificate (PEM) chosen on the connect screen

function _syncCertRow() {
  $('srv-cert-row').classList.toggle('hidden', !$('srv-tls').checked);
}
function fillServerForm(cfg) {
  $('srv-host').value = cfg.host || '';
  $('srv-port').value = cfg.port || '';
  $('srv-tls').checked = !!cfg.tls;
  _caPem = cfg.caPem || null;
  $('srv-cert-name').textContent = _caPem ? 'certificate pinned' : 'none selected';
  _syncCertRow();
}
function showConnect(reason) { showOnly('connect'); $('connect-err').textContent = reason || ''; }

// ── Connection-lost overlay ──────────────────────────────────────────────────
// Main pushes 'lost'/'restored' (heartbeat while signed in + reactive on a failed
// call). Show a blocking modal with a Retry that forces an immediate re-check;
// the overlay also auto-dismisses when the heartbeat sees the server return.
function showConnLost() { $('conn-lost')?.classList.remove('hidden'); setConn('block', 'Connection lost'); }
function hideConnLost() { $('conn-lost')?.classList.add('hidden'); }
function wireConnLost() {
  api.onConnectionLost?.(showConnLost);
  api.onConnectionRestored?.(() => { hideConnLost(); setConn('ok', 'Reconnected'); });
  const btn = $('conn-lost-retry');
  if (btn) btn.addEventListener('click', async () => {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = ico('refresh', 'ic spin') + '<span>Reconnecting…</span>';   // spinner during the re-check (fast — connect() now times out at 8s)
    let ok = false;
    try { const r = await api.retryConnection(); ok = !!(r && r.ok); } catch { /* stays lost */ }
    btn.disabled = false; btn.innerHTML = orig;
    if (ok) hideConnLost();
    else toast('Still can’t reach the server.', 'err');
  });
}

async function boot() {
  hydrateIcons();
  wireConnLost();
  navActive($('nav-search'), true); navActive($('nav-mailbox'), false);
  const cfg = await api.getServer();
  if (cfg && cfg.host) {
    fillServerForm(cfg);
    // Show the "Connecting…" spinner IMMEDIATELY so the saved-server connect attempt is never a
    // blank screen (the request can take a few seconds, or time out if the core PC is off).
    const sub = $('connecting-sub');
    if (sub) sub.textContent = `Reaching ${cfg.host}${cfg.port ? ':' + cfg.port : ''}…`;
    showOnly('connecting');
    const h = await api.connect();   // client already built from the saved server
    applyConn(h);
    if (h.ok) {
      showOnly('login');
    } else {
      // Couldn't reach it — most often the core app isn't open. Say so plainly and drop to the
      // connection page so they can check the address / retry once the core is running.
      showConnect('Couldn’t reach the main Scan Finder app. Make sure it’s open on the other PC '
        + '(with “Allow search-client connections” switched on), then press Connect.');
    }
  } else {
    showConnect();
  }
}

// ── Connect screen ─────────────────────────────────────────────────────────────
$('connect-btn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
  $('connect-err').textContent = '';
  const host = $('srv-host').value.trim();
  if (!host) { $('connect-err').textContent = 'Enter a server address.'; return; }
  const cfg = { host, port: $('srv-port').value.trim() || 8765, tls: $('srv-tls').checked, caPem: _caPem };
  const h = await api.setServer(cfg);
  applyConn(h);
  if (h.ok) showOnly('login'); else $('connect-err').textContent = h.reason || 'Could not connect to that server.';
}));
$('srv-tls').addEventListener('change', _syncCertRow);
$('srv-cert-btn').addEventListener('click', async () => {
  const r = await api.pickCert();
  if (r && r.ok) { _caPem = r.pem; $('srv-cert-name').textContent = r.name; }
});
$('import-profile-btn').addEventListener('click', async () => {
  $('connect-err').textContent = '';
  const r = await api.importProfile();
  if (!r || !r.ok) { if (r && r.error) $('connect-err').textContent = r.error; return; }
  $('srv-host').value = r.host;
  $('srv-port').value = r.port;
  $('srv-tls').checked = !!r.tls;
  _syncCertRow();
  _caPem = r.caPem;
  $('srv-cert-name').textContent = r.name + (r.caFingerprint ? ' · ' + r.caFingerprint.slice(0, 17) + '…' : '');
  $('connect-btn').click();   // validate via the handshake + proceed to sign-in
});
$('fetch-ca-btn').addEventListener('click', async () => {
  $('connect-err').textContent = '';
  const host = $('srv-host').value.trim();
  if (!host) { $('connect-err').textContent = 'Enter the server address first.'; return; }
  const r = await api.fetchCa({ host, port: $('srv-port').value.trim() || 8765 });
  if (!r || !r.ok) { $('connect-err').textContent = (r && r.error) || 'Could not fetch the certificate.'; return; }
  const confirmed = window.confirm(
    'Server certificate fingerprint (SHA-256):\n\n' + r.fingerprint +
    '\n\nConfirm this EXACTLY matches the fingerprint shown in the core app ' +
    '(Settings → Search client access) before trusting it.\n\n' +
    'A mismatch can mean the connection is being intercepted.');
  if (!confirmed) return;
  $('srv-tls').checked = true; _syncCertRow();
  _caPem = r.caPem;
  $('srv-cert-name').textContent = 'fetched · ' + r.fingerprint.slice(0, 17) + '…';
  $('connect-btn').click();
});
for (const id of ['srv-host', 'srv-port']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('connect-btn').click(); });
}
$('login-change-server').addEventListener('click', () => showConnect());

function navActive(btn, on) { btn.classList.toggle('active', on); }

// ── Login / logout ───────────────────────────────────────────────────────────
$('login-btn').addEventListener('click', async () => {
  if (blocked) return;
  $('login-err').textContent = '';
  const username = $('u').value.trim();
  const password = $('p').value;
  const totp = $('totp').value.trim() || undefined;
  if (!username || !password) { $('login-err').textContent = 'Enter username and password.'; return; }

  let r;
  try { r = await api.login(username, password, totp); }
  catch (e) { $('login-err').textContent = (e && e.message) || 'Could not reach the server.'; return; }
  if (r && r.ok) {
    role = r.user.role;
    $('nav-recycle').style.display = canDecide() ? '' : 'none';   // delete/restore is Admin/Edit
    $('nav-review').style.display  = canDecide() ? '' : 'none';   // review/file is Admin/Edit
    if (canDecide()) refreshReviewCounts();                       // seed the Review nav badge
    const ent = await api.entitlement();
    if (!(ent.json && ent.json.entitled)) {
      $('login').classList.add('hidden');
      $('locked').classList.remove('hidden');
      return;
    }
    // Workflow (mailbox/approvals) is its OWN add-on — only surface the Mailbox nav when
    // it is licensed, so a search-only client shows no mailbox/workflow mention.
    workflowEntitled = !!(ent.json.workflow && ent.json.workflow.entitled);
    $('nav-mailbox').classList.toggle('hidden', !workflowEntitled);
    const nm = r.user.displayName || r.user.username;
    $('who').textContent = nm;
    $('acct-initials').textContent = _initials(nm);   // role now lives in the account popover
    $('unc-wrap').classList.toggle('hidden', !canDecide());
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    setView('home');   // Home dashboard is the default landing view
    renderChips();
    return;
  }
  if (r.mfaRequired) {
    $('totp-label').classList.remove('hidden');
    $('totp').classList.remove('hidden');
    $('login-err').textContent = 'Enter your authentication code.';
    // Defer to rAF: focusing the field the same tick it's un-hidden can be dropped by Chromium.
    requestAnimationFrame(() => $('totp').focus());
    return;
  }
  $('login-err').textContent = r.error || 'Sign in failed.';
});

for (const id of ['u', 'p', 'totp']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !blocked) $('login-btn').click(); });
}

function doLogout() {
  rvLeave();   // release any review presence before the session ends
  api.logout();
  role = null; recipientsCache = null;
  $('app').classList.add('hidden');
  $('locked').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('p').value = ''; $('totp').value = '';
  $('totp').classList.add('hidden'); $('totp-label').classList.add('hidden');
  $('who').textContent = '—'; $('acct-initials').textContent = '–';
}
$('locked-back').addEventListener('click', doLogout);

// ── Account popover (identity · role · Sign out · About) ──────────────────────────
function _initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function closeAccountMenu() { document.getElementById('account-menu')?.remove(); }
function showAccountMenu() {
  closeAccountMenu();
  const btn = $('account-btn'); if (!btn) return;
  const m = document.createElement('div'); m.id = 'account-menu';
  const roleLabel = role ? role[0].toUpperCase() + role.slice(1) : '';
  m.innerHTML =
    `<div class="am-head"><div class="am-name">${esc($('who').textContent)}</div>` +
    (roleLabel ? `<div class="am-role">${esc(roleLabel)}</div>` : '') + `</div>` +
    `<button id="am-signout">${ico('signout', 'ic')}Sign out</button>` +
    `<button id="am-about"><span class="ic"></span>About</button>`;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  let top = r.top - m.offsetHeight - 6;                 // open upward (button is at the foot)
  if (top < 6) top = r.bottom + 6;
  let left = Math.min(r.left, window.innerWidth - m.offsetWidth - 6);
  m.style.top = Math.max(6, top) + 'px';
  m.style.left = Math.max(6, left) + 'px';
  $('am-signout').addEventListener('click', () => { closeAccountMenu(); doLogout(); });
  $('am-about').addEventListener('click', () => { closeAccountMenu(); openAbout(); });
}
$('account-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('account-menu') ? closeAccountMenu() : showAccountMenu();
});
document.addEventListener('click', (e) => {
  const m = document.getElementById('account-menu');
  if (m && !m.contains(e.target) && !$('account-btn').contains(e.target)) closeAccountMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAccountMenu(); });
window.addEventListener('blur', closeAccountMenu);

// ── About dialog ────────────────────────────────────────────────────────────────
let _aboutLoaded = false;
async function openAbout() {
  if (!_aboutLoaded) {
    try {
      const a = await window.scanfinder.about();
      $('about-version').textContent   = a.version ? `Version ${a.version}${a.buildRev ? ` (${a.buildRev})` : ''}` : '';
      $('about-electron').textContent  = a.electron ? `Electron ${a.electron}` : '';
      $('about-copyright').textContent = a.copyright || '';
      _aboutLoaded = true;
    } catch (e) { console.warn('about() failed:', e.message); }
  }
  $('about-overlay').classList.remove('hidden');
}
$('about-close').addEventListener('click', () => $('about-overlay').classList.add('hidden'));
$('about-overlay').addEventListener('click', (e) => {
  if (e.target === $('about-overlay')) $('about-overlay').classList.add('hidden');
});
$('about-licenses').addEventListener('click', async () => {
  const r = await window.scanfinder.openLicenses();
  if (r && !r.ok) console.warn('Could not open the licenses file:', r.error);
});

// ── View switching ─────────────────────────────────────────────────────────────
function setView(view) {
  if (view === 'mailbox' && !workflowEntitled) view = 'search'; // workflow add-on not licensed
  if (view === 'review' && !canDecide()) view = 'search';       // review is Admin/Edit only
  if (view !== 'review') rvLeave();   // leaving Review releases presence on the open doc
  $('view-home').classList.toggle('hidden', view !== 'home');
  $('view-search').classList.toggle('hidden', view !== 'search');
  $('view-mailbox').classList.toggle('hidden', view !== 'mailbox');
  $('view-review').classList.toggle('hidden', view !== 'review');
  $('view-settings').classList.toggle('hidden', view !== 'settings');
  $('view-recycle').classList.toggle('hidden', view !== 'recycle');
  navActive($('nav-home'), view === 'home');
  navActive($('nav-search'), view === 'search');
  navActive($('nav-mailbox'), view === 'mailbox');
  navActive($('nav-review'), view === 'review');
  navActive($('nav-settings'), view === 'settings');
  navActive($('nav-recycle'), view === 'recycle');
  const meta = {
    home:     ['Home', 'Your dashboard'],
    search:   ['Search', 'Find and preview filed documents'],
    mailbox:  ['Mailbox', 'Approvals routed to and from you'],
    review:   ['Review', 'Check and file documents waiting in the queue'],
    settings: ['Settings', 'Appearance and preferences'],
    recycle:  ['Recycle bin', 'Restore or permanently remove deleted documents'],
  }[view] || ['Search', ''];
  $('vh-title').textContent = meta[0];
  $('vh-sub').textContent = meta[1];
  if (view === 'home') loadHome();
  if (view === 'search' && !searchPrimed) { searchPrimed = true; runSearch(); }   // prime once
  if (view === 'mailbox') loadMailbox();
  if (view === 'review') loadReview();
  if (view === 'recycle') loadRecycleBin();
}
$('nav-home').addEventListener('click', () => setView('home'));
$('nav-search').addEventListener('click', () => setView('search'));
$('nav-mailbox').addEventListener('click', () => setView('mailbox'));
$('nav-review').addEventListener('click', () => setView('review'));
$('nav-settings').addEventListener('click', () => setView('settings'));
$('nav-recycle').addEventListener('click', () => setView('recycle'));
$('rv-refresh').addEventListener('click', () => loadReview());
document.querySelectorAll('[data-rbox]').forEach((b) => b.addEventListener('click', () => {
  reviewBox = b.dataset.rbox;
  document.querySelectorAll('[data-rbox]').forEach((x) => x.classList.toggle('active', x === b));
  loadReview();
}));
$('rb-refresh').addEventListener('click', () => loadRecycleBin());
$('theme-select')?.addEventListener('change', (e) => applyTheme(e.target.value));

// ── Review (clear the needs_review queue: edit fields, then file or defer) ──────
function rvLeave() {
  if (rvHeartbeat) { clearInterval(rvHeartbeat); rvHeartbeat = null; }
  if (rvCurrentId != null) { try { api.review.release(rvCurrentId); } catch {} rvCurrentId = null; }
  try { rvDisarmTarget(); } catch {}   // clear any armed targeting when the doc/session changes
}

async function loadDocTypes() {
  if (docTypesCache) return docTypesCache;
  const r = await api.review.docTypes();
  docTypesCache = (r && r.json && r.json.types) || [];
  return docTypesCache;
}

function setRvCount(box, n) {
  const b = document.querySelector(`[data-rcount="${box}"]`);
  if (b) { b.textContent = n > 99 ? '99+' : String(n || 0); b.classList.toggle('hidden', !n); }
}
async function refreshReviewCounts() {
  try {
    const r = await api.review.counts();
    const c = (r && r.json) || {};
    const badge = $('review-badge');
    if (badge) { const n = c.review || 0; badge.textContent = n > 99 ? '99+' : String(n); badge.classList.toggle('hidden', !n); }
    setRvCount('queue', c.review); setRvCount('deferred', c.deferred);
  } catch { /* best-effort */ }
}

async function loadReview() {
  const list = $('review-list');
  list.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading…</div>`;
  const r = reviewBox === 'deferred' ? await api.review.deferred() : await api.review.queue();
  if (r.status === 401) { doLogout(); return; }
  if (r.status === 403) { list.innerHTML = `<div class="empty">You don't have permission to review.</div>`; return; }
  if (r.status === 402) { list.innerHTML = `<div class="empty">Not licensed.</div>`; return; }
  const rows = (r.json && (r.json.queue || r.json.deferred)) || [];
  refreshReviewCounts();
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${reviewBox === 'deferred' ? 'No deferred documents.' : 'Nothing to review — all caught up. 🎉'}</div>`;
    return;
  }
  list.innerHTML = '';
  for (const d of rows) list.appendChild(reviewRow(d));
}

function reviewRow(d) {
  const el = document.createElement('button');
  el.className = 'rv-row';
  el.dataset.id = d.id;
  const title = d.supplier_name || d.original_filename || `Document #${d.id}`;
  const sub = [d.type_name || d.type_slug, d.reference_number, d.doc_date].filter(Boolean).map(esc).join(' · ');
  const viewers = (d.viewers || []).map((v) => v.displayName || v.username).filter(Boolean);
  const lvl = confLevel(d.overall_confidence);
  el.innerHTML = `
    <div class="rr-thumb" data-thumb-id="${d.id}"></div>
    <div class="rr-main">
      <div class="rr-title">${esc(title)}</div>
      <div class="rr-sub">${sub}</div>
      ${viewers.length ? `<div class="rr-viewing">${ico('claim')}${esc(viewers.join(', '))} reviewing</div>` : ''}
      ${d.overall_confidence != null ? `<span class="meter ${lvl}" title="${d.overall_confidence}%"><i style="width:${Math.max(4, Math.min(100, d.overall_confidence))}%"></i></span>` : ''}
    </div>`;
  el.addEventListener('click', () => {
    document.querySelectorAll('.rv-row').forEach((x) => x.classList.toggle('active', x === el));
    openReviewDoc(d.id);
  });
  const thumbEl = el.querySelector('.rr-thumb');
  if (thumbEl && _rvThumbObserver) _rvThumbObserver.observe(thumbEl);   // lazy: load when visible
  return el;
}

// Prioritised, lazy page-1 thumbnails for the review list. The observer only tracks
// which rows are in/near view; a small scheduler then loads with bounded concurrency,
// ALWAYS picking the row closest to the viewport first. So jumping to the bottom of a
// 500-row queue immediately switches loading to the rows now in view instead of
// finishing the top — rows that scroll away are dropped from the queue (re-added if you
// return). Bounded concurrency also shields the host, and loading is paused while a
// preview opens so a click is never stuck behind background thumbnails. Cache persists
// for the session, so a revisited (or re-rendered) row shows instantly.
const _rvThumbCache = new Map();   // id -> dataURL
const _rvThumbWant  = new Map();   // id -> box (rows that want a thumb right now)
const _rvThumbBusy  = new Set();   // ids being fetched
let   _rvThumbPaused = false;      // true while a preview is loading
const _RV_THUMB_MAX = 3;           // in-flight cap (priority + host protection)

function _rvThumbShow(box, src) {
  if (src && box && box.isConnected && !box.firstChild) { const im = document.createElement('img'); im.src = src; box.appendChild(im); }
}
function _rvThumbPump() {
  if (_rvThumbPaused) return;
  while (_rvThumbBusy.size < _RV_THUMB_MAX && _rvThumbWant.size) {
    let pickId = null, pickBox = null, best = Infinity;
    for (const [id, box] of _rvThumbWant) {                 // closest-to-viewport wins → in-view first
      if (!box.isConnected) { _rvThumbWant.delete(id); continue; }
      const d = Math.abs(box.getBoundingClientRect().top);
      if (d < best) { best = d; pickId = id; pickBox = box; }
    }
    if (pickId == null) break;
    _rvThumbWant.delete(pickId);
    if (_rvThumbCache.has(pickId)) { _rvThumbShow(pickBox, _rvThumbCache.get(pickId)); continue; }
    _rvThumbBusy.add(pickId);
    api.getThumbnail(pickId).then((r) => {
      const src = r && r.json && r.json.thumbnail;
      if (src) { _rvThumbCache.set(pickId, src); _rvThumbShow(pickBox, src); }
    }).catch(() => {}).finally(() => { _rvThumbBusy.delete(pickId); _rvThumbPump(); });
  }
}
const _rvThumbObserver = (typeof IntersectionObserver !== 'undefined') ? new IntersectionObserver((entries) => {
  for (const en of entries) {
    const box = en.target, id = box.dataset.thumbId;
    if (en.isIntersecting) {
      if (_rvThumbCache.has(id)) { _rvThumbShow(box, _rvThumbCache.get(id)); _rvThumbObserver.unobserve(box); }
      else if (!box.firstChild) _rvThumbWant.set(id, box);
    } else {
      _rvThumbWant.delete(id);   // scrolled away before loading → drop from the queue
    }
  }
  _rvThumbPump();
}, { rootMargin: '250px' }) : null;
// Pause/resume background thumbnails so an opened preview gets the host's full attention.
function rvThumbsPause(p) { _rvThumbPaused = p; if (!p) _rvThumbPump(); }

async function openReviewDoc(id) {
  rvLeave();
  rvCurrentId = id;
  const prev = $('review-preview');           // middle column: the document pages
  const fpanel = $('review-fields-panel');     // right column: type + fields + actions
  fpanel.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading…</div>`;
  prev.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading preview…</div>`;
  const [docR, types] = await Promise.all([api.getDocument(id), loadDocTypes()]);
  if (rvCurrentId !== id) return;                 // navigated away while loading
  if (docR.status === 401) { doLogout(); return; }
  if (docR.status !== 200 || !docR.json) { fpanel.innerHTML = `<div class="empty">Could not load document.</div>`; prev.innerHTML = ''; return; }
  const doc = docR.json;

  // ── Right column: type + fields + actions ──
  const wrap = document.createElement('div'); wrap.className = 'fade';
  const title = doc.supplier_name || doc.original_filename || `Document #${doc.id}`;
  let html = `<div class="pv-head">${ico('doc')}<h2>${esc(title)}</h2><span class="chip ${esc(doc.status)}">${esc(doc.status)}</span></div>`;
  html += `<div class="rv-banner hidden" id="rv-banner"></div>`;
  if (doc.overall_confidence != null) {
    const lvl = confLevel(doc.overall_confidence);
    html += `<div class="pv-conf"><span>Extraction confidence</span><span class="meter ${lvl}"><i style="width:${Math.max(4, Math.min(100, doc.overall_confidence))}%"></i></span><span class="cval mono">${doc.overall_confidence}%</span></div>`;
  }
  html += `<div class="rv-typebar"><label for="rv-type">Document type</label><select id="rv-type"></select></div>`;
  html += `<div class="rv-fields" id="rv-fields"></div>`;
  html += `<div class="rv-actions" id="rv-actions"></div>`;
  wrap.innerHTML = html;
  fpanel.innerHTML = ''; fpanel.appendChild(wrap);

  const vals = {};
  const exByKey = {};
  for (const e of (doc.extractions || [])) { vals[e.field_key] = e.display_value || ''; exByKey[e.field_key] = e; }
  if (!vals.supplier_name && doc.supplier_name) vals.supplier_name = doc.supplier_name;

  const sel = wrap.querySelector('#rv-type');
  for (const t of types) {
    const o = document.createElement('option'); o.value = t.slug; o.textContent = t.name;
    if (t.slug === doc.type_slug) o.selected = true; sel.appendChild(o);
  }
  const renderFor = (slug) => renderReviewFields(wrap, types.find((t) => t.slug === slug) || null, vals, exByKey);
  sel.addEventListener('change', () => renderFor(sel.value));
  renderFor(sel.value || doc.type_slug);

  const acts = wrap.querySelector('#rv-actions');
  acts.appendChild(mkBtn({ label: 'Confirm & file', icon: 'check', variant: 'primary', onClick: () => rvConfirm(doc, sel) }));
  if (reviewBox === 'deferred') acts.appendChild(mkBtn({ label: 'Back to queue', icon: 'refresh', onClick: () => rvAction('undefer', doc.id) }));
  else acts.appendChild(mkBtn({ label: 'Defer', icon: 'claim', onClick: () => rvAction('defer', doc.id) }));

  rvViewingBeat(id);
  rvHeartbeat = setInterval(() => rvViewingBeat(id), 25000);

  // ── Middle column: the document pages ── (pause background thumbnails so the click
  // isn't stuck behind them; pages are cached host-side, so a revisit is instant).
  rvThumbsPause(true);
  let pg;
  try { pg = await api.getPages(id); } finally { rvThumbsPause(false); }
  if (rvCurrentId !== id) return;
  const imgs = (pg.json && pg.json.pages) || [];
  if (!imgs.length) { prev.innerHTML = `<div class="empty">No preview available.</div>`; return; }
  prev.innerHTML = '<div class="pages"></div>';
  const pagesEl = prev.querySelector('.pages');
  for (const src of imgs) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
}

function renderReviewFields(wrap, type, vals, exByKey = {}) {
  const c = wrap.querySelector('#rv-fields');
  if (!c) return;
  c.innerHTML = '';
  const fields = (type && type.fields) || [];
  if (!fields.length) { c.innerHTML = `<div class="empty" style="padding:12px">This type has no fields.</div>`; return; }
  for (const f of fields) {
    const div = document.createElement('div'); div.className = 'rv-fld';
    const cur = vals[f.key] != null ? vals[f.key] : '';
    const ex  = exByKey[f.key] || null;
    // Surface the SAME per-field signal the Search preview shows (the host DTO already carries
    // confidence + validation_note) so a remote reviewer can see WHICH field triggered review
    // and WHY — not just an unexplained queue entry. A validation_note tints the row + prints a
    // ⚠ line; the confidence pip reuses the shared confPip helper.
    const pip = ex && ex.confidence != null ? confPip(ex.confidence) : '';
    div.innerHTML = `<label>${esc(f.label || f.key)}${f.required ? ' <span class="req">*</span>' : ''}${pip ? ` <span class="rv-fld-conf">${pip}</span>` : ''}</label>`;
    if (ex && ex.validation_note) div.classList.add('fld-warn');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = cur; inp.dataset.key = f.key; inp.dataset.orig = cur;
    if (f.required && !cur) div.classList.add('req-empty');
    inp.addEventListener('input', () => div.classList.toggle('req-empty', !!f.required && !inp.value.trim()));
    const row = document.createElement('div'); row.className = 'rv-fld-row';
    row.appendChild(inp);
    const tbtn = document.createElement('button'); tbtn.type = 'button'; tbtn.className = 'rv-target-btn';
    tbtn.title = 'Read this value from the document — click, then draw a box around it';
    tbtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`;
    tbtn.addEventListener('click', () => rvArmTarget(inp));
    row.appendChild(tbtn);
    div.appendChild(row);
    if (ex && ex.validation_note) {
      const note = document.createElement('div'); note.className = 'note';
      note.textContent = `⚠ ${ex.validation_note}`;
      div.appendChild(note);
    }
    c.appendChild(div);
  }
}

// ── Correction-only targeting: arm a field, draw a box on the page, OCR-fill it ──────
// The page image we draw on is the ~108 DPI preview (from /v1/pages) the host rendered —
// so cropping it client-side and OCR-ing it on the host reads identically to the desktop
// ⊕ tool. We send only the cropped PNG; the host runs region.py and returns text. No
// learning, no anchors — a pure read-and-fill convenience.
let rvTargetInput = null;     // the field input currently armed
let rvDraw = null;            // { img, rect, startX, startY, boxEl } while dragging
let rvDrawWired = false;

function rvArmTarget(input) {
  rvTargetInput = input;
  const prev = $('review-preview');
  if (prev) prev.classList.add('rv-targeting');
  rvWireDrawing();
  toast('Draw a box around the value on the document.', 'ok');
}
function rvDisarmTarget() {
  rvTargetInput = null;
  const prev = $('review-preview');
  if (prev) prev.classList.remove('rv-targeting');
  if (rvDraw && rvDraw.boxEl) rvDraw.boxEl.remove();
  rvDraw = null;
}
function rvUpdateBox(x, y) {
  if (!rvDraw) return;
  const l = Math.min(rvDraw.startX, x), t = Math.min(rvDraw.startY, y);
  const w = Math.abs(x - rvDraw.startX), h = Math.abs(y - rvDraw.startY);
  Object.assign(rvDraw.boxEl.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
}
function rvWireDrawing() {
  if (rvDrawWired) return; rvDrawWired = true;
  const prev = $('review-preview');
  if (!prev) return;
  prev.addEventListener('mousedown', (e) => {
    if (!rvTargetInput) return;
    const img = e.target.closest && e.target.closest('.pages img');
    if (!img) return;
    e.preventDefault();
    const boxEl = document.createElement('div'); boxEl.className = 'rv-drawbox';
    document.body.appendChild(boxEl);
    rvDraw = { img, rect: img.getBoundingClientRect(), startX: e.clientX, startY: e.clientY, boxEl };
    rvUpdateBox(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => { if (rvDraw) rvUpdateBox(e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (rvDraw) rvFinishDraw(e); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rvTargetInput) rvDisarmTarget(); });
}
async function rvFinishDraw(e) {
  const d = rvDraw; const input = rvTargetInput; rvDraw = null;
  if (d.boxEl) d.boxEl.remove();
  if (!d || !input) { rvDisarmTarget(); return; }
  const rect = d.img.getBoundingClientRect();
  const dl = Math.min(d.startX, e.clientX) - rect.left;
  const dt = Math.min(d.startY, e.clientY) - rect.top;
  const dw = Math.abs(e.clientX - d.startX), dh = Math.abs(e.clientY - d.startY);
  if (dw < 5 || dh < 5) { rvDisarmTarget(); return; }   // a click, not a box
  // display → natural image pixels
  const sx = d.img.naturalWidth / rect.width, sy = d.img.naturalHeight / rect.height;
  let nx = dl * sx, ny = dt * sy, nw = dw * sx, nh = dh * sy;
  // Small headroom only: region.py gets a pre-cropped image (it can't re-crop with its own
  // glyph headroom the way the desktop path does), so pad just enough to avoid clipping glyph
  // ascenders/descenders. 50% of the box height grabbed the whole line ABOVE the selection —
  // keep it well under one line so a value line's neighbour is never captured.
  const padY = Math.min(nh * 0.15, 10), padX = Math.max(4, nw * 0.05);
  nx = Math.max(0, nx - padX); ny = Math.max(0, ny - padY);
  nw = Math.min(d.img.naturalWidth - nx, nw + 2 * padX); nh = Math.min(d.img.naturalHeight - ny, nh + 2 * padY);
  // crop the natural-resolution region to a canvas → base64 PNG (data URLs aren't tainted)
  let b64;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(nw)); canvas.height = Math.max(1, Math.round(nh));
    canvas.getContext('2d').drawImage(d.img, nx, ny, nw, nh, 0, 0, canvas.width, canvas.height);
    b64 = canvas.toDataURL('image/png').split(',')[1];
  } catch { rvDisarmTarget(); toast('Could not capture that region.', 'warn'); return; }
  const prevVal = input.value, docId = rvCurrentId;
  input.value = '…'; input.disabled = true;
  try {
    const r = await api.review.ocrRegion(docId, b64);
    if (rvCurrentId !== docId) return;                 // navigated away
    const text = (r && r.json && typeof r.json.text === 'string') ? r.json.text.trim() : '';
    input.value = text || prevVal;
    if (!text) toast('Nothing readable in that box — try again.', 'warn');
    input.dispatchEvent(new Event('input', { bubbles: true }));   // re-run required/validation
  } catch { input.value = prevVal; toast('Could not read that region.', 'warn'); }
  finally { input.disabled = false; rvDisarmTarget(); try { input.focus(); } catch {} }
}

async function rvConfirm(doc, sel) {
  const wrap = $('review-fields-panel');
  const slug = sel.value;
  const type = (docTypesCache || []).find((t) => t.slug === slug);
  const inputs = [...wrap.querySelectorAll('#rv-fields input')];
  const allValues = {}; const corrections = {};
  for (const inp of inputs) {
    const k = inp.dataset.key; const v = inp.value.trim();
    allValues[k] = v;
    if (v !== (inp.dataset.orig || '')) corrections[k] = { original_value: inp.dataset.orig || '', corrected_value: v };
  }
  const missing = inputs.filter((i) => i.closest('.rv-fld').querySelector('.req') && !i.value.trim());
  if (missing.length) { toast('Please fill the required fields (marked *).', 'warn'); missing[0].focus(); return; }
  const supplier = allValues.supplier_name || allValues.customer_name || doc.supplier_name || null;
  const r = await api.review.confirm(doc.id, {
    allValues, corrections, supplier_name: supplier,
    document_type_slug: slug, document_type: type ? type.name : null,
  });
  if (r.status === 200 && r.json && r.json.success) {
    toast(`Filed${r.json.filename ? ' as ' + r.json.filename : ''}.`, 'ok');
    rvLeave();
    $('review-fields-panel').innerHTML = '';
    $('review-preview').innerHTML = `<div class="empty">Filed. Select the next document on the left.</div>`;
    loadReview();
  } else if (r.status === 409) {
    const who = (r.json && r.json.confirmedBy) || 'someone else';
    toast((r.json && r.json.error) || `Already filed by ${who}.`, 'warn');
    rvLeave();
    $('review-fields-panel').innerHTML = '';
    $('review-preview').innerHTML = `<div class="empty">This document was already filed. Refreshing the list…</div>`;
    loadReview();
  } else {
    toast((r.json && r.json.error) || 'Could not file the document.', 'err');
  }
}

async function rvAction(action, id) {
  const r = action === 'undefer' ? await api.review.undefer(id) : await api.review.defer(id);
  if (r.status === 200 && r.json && r.json.ok) {
    toast(action === 'undefer' ? 'Moved back to the review queue.' : 'Deferred.', 'ok');
    rvLeave();
    $('review-fields-panel').innerHTML = '';
    $('review-preview').innerHTML = `<div class="empty">Select a document on the left to review and file it.</div>`;
    loadReview();
  } else {
    toast((r.json && r.json.error) || 'That document has already changed — refreshing.', 'warn');
    loadReview();
  }
}

async function rvViewingBeat(id) {
  try {
    const r = await api.review.viewing(id);
    if (rvCurrentId !== id) return;
    const banner = $('rv-banner'); if (!banner) return;
    const viewers = ((r.json && r.json.viewers) || []).map((v) => v.displayName || v.username).filter(Boolean);
    if (viewers.length) {
      banner.innerHTML = `${ico('claim')}<span>Also being reviewed by <strong>${esc(viewers.join(', '))}</strong> — whoever files first wins.</span>`;
      banner.classList.remove('hidden');
    } else banner.classList.add('hidden');
  } catch { /* advisory only */ }
}

window.addEventListener('beforeunload', () => { if (rvCurrentId != null) { try { api.review.release(rvCurrentId); } catch {} } });

// ── Change password (Settings → Your account) ──────────────────────────────────
$('cp-btn')?.addEventListener('click', async () => {
  const cur = $('cp-current').value, nw = $('cp-new').value, cf = $('cp-confirm').value;
  const msg = $('cp-msg'); msg.textContent = ''; msg.style.color = '';
  if (!cur)            { msg.textContent = 'Enter your current password.'; return; }
  if (nw.length < 8)   { msg.textContent = 'New password must be at least 8 characters.'; return; }
  if (nw !== cf)       { msg.textContent = 'New passwords do not match.'; return; }
  if (nw === cur)      { msg.textContent = 'New password must be different from your current one.'; return; }
  const btn = $('cp-btn'), orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = ico('refresh', 'ic spin') + '<span>Changing…</span>';
  let r; try { r = await api.changePassword(cur, nw); } catch { r = { ok: false, error: 'Could not reach the server.' }; }
  btn.disabled = false; btn.innerHTML = orig;
  if (r && r.ok) {
    msg.style.color = 'var(--ok)'; msg.textContent = 'Password changed.';
    $('cp-current').value = ''; $('cp-new').value = ''; $('cp-confirm').value = '';
  } else {
    msg.textContent = (r && r.error) || 'Could not change your password.';
  }
});
$('side-dark-toggle')?.addEventListener('change', toggleDarkMode);

// ── Home dashboard ───────────────────────────────────────────────────────────────
function homeSearch() {
  $('f-text').value = $('home-search-input').value.trim();
  searchPrimed = true;          // Home drives the run; stop setView from double-running
  setView('search');
  runSearch();
}
$('home-search-btn')?.addEventListener('click', homeSearch);
$('home-search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') homeSearch(); });

function homeCard(title, n, sub) {
  const el = document.createElement('div'); el.className = 'home-card';
  const has = n != null && n > 0;
  el.innerHTML = `<div class="hc-title">${esc(title)}</div>
    <div class="hc-big ${has ? '' : 'muted'}">${n == null ? '—' : n}</div>
    <div class="hc-sub">${has ? esc(sub) : "you're all caught up"}</div>`;
  el.appendChild(mkBtn({ label: 'Open Mailbox', icon: 'inbox', variant: 'ghost', onClick: () => setView('mailbox') }));
  return el;
}

function recentCard(rows) {
  const el = document.createElement('div'); el.className = 'home-card home-card-wide';
  if (!rows.length) { el.innerHTML = `<div class="hc-title">Recently filed</div><div class="hc-empty">No documents filed yet.</div>`; return el; }
  el.innerHTML = `<div class="hc-title">Recently filed</div><div class="hc-list"></div>`;
  const list = el.querySelector('.hc-list');
  for (const d of rows) {
    const row = document.createElement('button'); row.className = 'hc-row';
    row.innerHTML = `<span class="hc-row-nm">${esc(d.supplier_name || d.original_filename || 'Untitled')}</span>
      <span class="hc-row-meta mono">${esc(d.reference_number || '—')} · ${esc(d.doc_date || '')}</span>`;
    row.addEventListener('click', () => { searchPrimed = true; setView('search'); openDocument(d.id); });
    list.appendChild(row);
  }
  return el;
}

// Loads the dashboard cards. Reuses the workflow-count fetch and a recent-docs search;
// each card degrades to "—" on a failed fetch rather than blanking the whole view.
async function loadHome() {
  const grid = $('home-grid'); if (!grid) return;
  const feats = ['Search']; if (workflowEntitled) feats.push('Approvals');
  $('home-strip').innerHTML = `Signed in as <b>${esc($('who').textContent || '')}</b>` +
    (role ? ` &middot; ${esc(role[0].toUpperCase() + role.slice(1))}` : '') +
    ` &nbsp;&middot;&nbsp; ${esc($('side-conn-text').textContent || 'Connected')} &nbsp;&middot;&nbsp; ${feats.join(' · ')}`;
  grid.innerHTML = `<div class="hc-loading">${ico('refresh', 'ic spin')}Loading…</div>`;

  let recent = [], wf = null;
  await Promise.all([
    (async () => { try { const r = await api.search({}); recent = ((r.json && r.json.confirmed) || []).slice(0, 6); } catch { /* card shows empty */ } })(),
    (async () => { if (workflowEntitled) { try { wf = await refreshBadges(); } catch { /* card shows — */ } } })(),
  ]);

  grid.innerHTML = '';
  if (workflowEntitled) {
    const c = (wf && wf.counts) || {};
    grid.appendChild(homeCard('Waiting on you', c.inbox, 'awaiting your decision'));
    if (canDecide()) grid.appendChild(homeCard('Awaiting others', c.sent, 'you sent, not yet actioned'));
  }
  grid.appendChild(recentCard(recent));
}

// ── Search ───────────────────────────────────────────────────────────────────
$('search-btn').addEventListener('click', (e) => withBusy(e.currentTarget, runSearch));
$('f-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

$('filters-toggle').addEventListener('click', () => {
  const open = $('filters').classList.toggle('hidden') === false;
  const b = $('filters-toggle');
  b.classList.toggle('btn-secondary', open); b.classList.toggle('btn-ghost', !open);
});

function clearFilters() {
  for (const id of ['f-company', 'f-reference', 'f-from', 'f-to', 'f-text']) $(id).value = '';
  $('f-unc').checked = false;
}

function renderChips() {
  const c = $('example-chips'); if (!c) return;
  c.innerHTML = '<span class="lbl">Quick views</span>';
  const chip = (label, fn) => {
    const b = document.createElement('button'); b.className = 'chip-btn'; b.textContent = label;
    b.addEventListener('click', fn); c.appendChild(b);
  };
  chip('Recent', () => { clearFilters(); runSearch(); });
  if (canDecide()) chip('Include uncommitted', () => {
    clearFilters(); $('f-unc').checked = true; $('filters').classList.remove('hidden'); runSearch();
  });
}
async function runSearch() {
  const params = {
    company:   $('f-company').value.trim() || undefined,
    reference: $('f-reference').value.trim() || undefined,
    dateFrom:  $('f-from').value || undefined,
    dateTo:    $('f-to').value || undefined,
    fullText:  $('f-text').value.trim() || undefined,
    total:     $('f-total').value.trim() || undefined,
    totalOp:   $('f-total-op').value || undefined,
    includeUncommitted: $('f-unc').checked,
  };
  const r = await api.search(params);
  if (r.status === 401) { doLogout(); return; }
  renderResults((r.json && r.json.confirmed) || [], (r.json && r.json.uncommitted) || [], params);
}

function activeFilterSummary(p) {
  const bits = [];
  if (p.company) bits.push(`Company: ${p.company}`);
  if (p.reference) bits.push(`Ref: ${p.reference}`);
  if (p.dateFrom || p.dateTo) bits.push(`Date: ${p.dateFrom || '…'}–${p.dateTo || '…'}`);
  if (p.fullText) bits.push(`Text: ${p.fullText}`);
  return bits.join(' · ');
}

function renderResults(confirmed, uncommitted, params) {
  const head = $('results-head');
  const total = confirmed.length + uncommitted.length;
  head.classList.remove('hidden');
  const summary = activeFilterSummary(params || {});
  const hasFilters = !!summary;
  head.innerHTML = hasFilters
    ? `<strong style="color:var(--text)">${total}</strong> result${total === 1 ? '' : 's'} · ${esc(summary)}`
    : `<strong style="color:var(--text)">${total}</strong> recent document${total === 1 ? '' : 's'}`;

  const root = $('results'); root.innerHTML = '';
  resetRowSelection();
  const addSection = (title, rows) => {
    if (!rows.length) return;
    const h = document.createElement('div'); h.className = 'section-h';
    h.textContent = `${title} (${rows.length})`; root.appendChild(h);
    for (const d of rows) root.appendChild(rowEl(d));
  };
  addSection('Confirmed', confirmed);
  addSection('Uncommitted', uncommitted);
  if (!total) root.innerHTML = hasFilters
    ? `<div class="empty">No matching documents. Try widening your filters.</div>`
    : `<div class="empty">No documents have been filed yet.</div>`;
}

function confPip(c) {
  if (c == null) return '';
  const lvl = confLevel(c);
  const w = Math.max(4, Math.min(100, c));
  return `<span class="confpip ${lvl}" title="Extraction confidence ${c}%">
    <span class="cmeter"><i style="width:${w}%"></i></span><span class="cval mono">${c}%</span></span>`;
}

// ── Row selection (search results + recycle bin) ─────────────────────────────────
// Plain click = single select + preview. Ctrl/Cmd + Shift multi-select. Right-click acts
// on the selection (Delete in search; Restore / Delete permanently in the bin).
let _csel = new Set();   // selected ids
let _crowOrder = [];     // ids in render order (shift-range)
let _canchor = null;     // shift anchor
function resetRowSelection() { _csel = new Set(); _crowOrder = []; _canchor = null; }
function refreshRowSel() {
  document.querySelectorAll('#results .row, #recycle-list .row').forEach((el) => {
    el.classList.toggle('sel', _csel.has(Number(el.dataset.id)));
  });
}
function onRowClick(e, d) {
  if (e.ctrlKey || e.metaKey) {
    if (_csel.has(d.id)) _csel.delete(d.id); else _csel.add(d.id);
    _canchor = d.id;
  } else if (e.shiftKey && _canchor != null) {
    const a = _crowOrder.indexOf(_canchor), b = _crowOrder.indexOf(d.id);
    if (a >= 0 && b >= 0) { _csel.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) _csel.add(_crowOrder[i]); }
  } else {
    _csel.clear(); _csel.add(d.id); _canchor = d.id;
    openDocument(d.id);
  }
  refreshRowSel();
}

function rowEl(d) {
  const el = document.createElement('div'); el.className = 'row'; el.dataset.id = d.id;
  _crowOrder.push(d.id);
  el.innerHTML = `
    <div class="r1"><span class="nm">${esc(d.supplier_name || d.original_filename || 'Untitled')}</span>
      <span class="chip ${esc(d.status)}">${esc(d.status)}</span><span class="spacer"></span>${confPip(d.overall_confidence)}</div>
    <div class="r2 mono">${esc(d.reference_number || '—')} · ${esc(d.doc_date || '—')} · ${esc(d.type_name || d.type_slug || '')}</div>`;
  el.addEventListener('click', (e) => onRowClick(e, d));
  // Right-click → act on the selection (Delete / Restore / Delete permanently). Edit+Admin.
  el.addEventListener('contextmenu', (e) => {
    if (!canDecide()) return;
    e.preventDefault();
    if (!_csel.has(d.id)) { _csel.clear(); _csel.add(d.id); _canchor = d.id; refreshRowSel(); }
    showRowMenu(e.clientX, e.clientY);
  });
  return el;
}

// ── Preview (+ assign control for admin/edit) ────────────────────────────────
function confLevel(c) { return c == null ? '' : c >= 85 ? '' : c >= 60 ? 'warn' : 'err'; }

// A context banner + decision bar shown when the open document is routed TO me.
function decisionBar(route) {
  const wrap = document.createElement('div'); wrap.className = 'wf decision';
  const kind = route.action_required === 'approve' ? 'Approval requested' : 'Acknowledgement requested';
  const canAct = route.action_required === 'approve' && canDecide();
  wrap.innerHTML = `
    <div class="dec-banner">${ico('inbox')}<span>Routed to you by <strong>${esc(route.from_username)}</strong> — ${kind}${route.comment ? ': “' + esc(route.comment) + '”' : ''}</span></div>
    ${canAct ? `<input class="dec-note" placeholder="Add a note (optional — required to reject)" />` : ''}
    <div class="dec-acts"></div>`;
  const acts = wrap.querySelector('.dec-acts');
  const noteEl = wrap.querySelector('.dec-note');
  const run = async (p) => {
    const r = await p;
    if (r.status === 401) { doLogout(); return; }
    if (r.status !== 200) { toast((r.json && r.json.error) || 'Action failed.', 'err'); return; }
    toast('Done.');
    await refreshBadges();
    openDocument(route.document_id);
  };
  const decide = (decision) => {
    const note = noteEl ? noteEl.value.trim() : '';
    if (decision === 'reject' && !note) { noteEl.focus(); toast('A reason is required to reject.', 'err'); return; }
    run(api.workflow.resolve(route.id, decision, note || null, route.version));
  };
  if (route.action_required === 'acknowledge') {
    acts.appendChild(mkBtn({ label: 'Acknowledge', icon: 'check', variant: 'primary', sm: false, onClick: () => run(api.workflow.resolve(route.id, 'acknowledge', null, route.version)) }));
  } else if (canDecide()) {
    acts.appendChild(mkBtn({ label: 'Approve',   icon: 'check',  variant: 'primary',   sm: false, onClick: () => decide('approve') }));
    acts.appendChild(mkBtn({ label: 'Reject',    icon: 'reject', variant: 'danger',    sm: false, onClick: () => decide('reject') }));
    acts.appendChild(mkBtn({ label: 'Mark Paid', icon: 'check',  variant: 'secondary', sm: false, onClick: () => decide('paid') }));
  }
  // Disposition: route the document back to the sender or on to another user. Admin/edit
  // only (reuses the assign control, which lists the sender for a route-back).
  if (canDecide()) {
    let shown = false;
    acts.appendChild(mkBtn({ label: 'Forward…', icon: 'assign', variant: 'ghost', sm: false, onClick: async () => {
      if (shown) return; shown = true;
      wrap.appendChild(await assignControl(route.document_id, route.from_username));
    } }));
  }
  return wrap;
}

async function openDocument(id, route) {
  const prev = $('preview');
  prev.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading…</div>`;
  const r = await api.getDocument(id);
  if (r.status === 401) { doLogout(); return; }
  if (r.status === 402) { prev.innerHTML = `<div class="empty">Not licensed.</div>`; return; }
  if (r.status !== 200 || !r.json) { prev.innerHTML = `<div class="empty">Could not load document.</div>`; return; }
  const doc = r.json;

  const wrap = document.createElement('div'); wrap.className = 'fade';
  const title = doc.supplier_name || doc.original_filename || `Document #${doc.id}`;
  let html = `
    <div class="pv-head">${ico('doc')}<h2>${esc(title)}</h2><span class="chip ${esc(doc.status)}">${esc(doc.status)}</span><span class="spacer"></span><span class="pv-actions" id="pv-actions"></span></div>`;
  if (doc.overall_confidence != null) {
    const lvl = confLevel(doc.overall_confidence);
    html += `<div class="pv-conf"><span>Extraction confidence</span>
      <span class="meter ${lvl}"><i style="width:${Math.max(4, Math.min(100, doc.overall_confidence))}%"></i></span>
      <span class="cval mono">${doc.overall_confidence}%</span></div>`;
  }

  const meta = [
    ['Reference', doc.reference_number], ['Date', doc.doc_date],
    ['Type', doc.type_name || doc.type_slug],
  ].filter(([, v]) => v != null && v !== '');
  html += '<div class="fields">';
  for (const [k, v] of meta) html += `<div class="field"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  for (const ex of (doc.extractions || [])) {
    const lvl = confLevel(ex.confidence);
    const cls = ex.validation_note ? 'fld-warn' : (lvl === 'err' ? 'fld-err' : lvl === 'warn' ? 'fld-warn' : (ex.confidence != null ? 'fld-ok' : ''));
    const pip = ex.confidence != null ? `<span class="cval mono" style="margin-left:8px">${ex.confidence}%</span>` : '';
    html += `<div class="field ${cls}"><span class="k">${esc(ex.field_key)}</span><span class="v">${esc(ex.display_value || '')}${pip}</span></div>`;
    if (ex.validation_note) html += `<div class="note">⚠ ${esc(ex.validation_note)}</div>`;
  }
  html += '</div><div class="pages"><div class="empty">' + ico('refresh', 'ic spin') + 'Loading preview…</div></div>';
  wrap.innerHTML = html;
  prev.innerHTML = ''; prev.appendChild(wrap);

  // Delete / restore / purge — Admin & Edit (purge is Admin only). Recoverable bin.
  const acts = wrap.querySelector('#pv-actions');
  if (acts && canDecide()) {
    if (doc.status === 'deleted') {
      acts.appendChild(mkBtn({ label: 'Restore', icon: 'refresh', variant: 'primary', onClick: () => binAction('restore', doc.id) }));
      if (role === 'admin') acts.appendChild(mkBtn({ label: 'Delete permanently', icon: 'reject', variant: 'danger', onClick: () => binAction('purge', doc.id) }));
    } else {
      acts.appendChild(mkBtn({ label: 'Delete', icon: 'reject', variant: 'danger', onClick: () => binAction('delete', doc.id) }));
    }
  }

  // Top action bar — ONLY when the workflow/approval add-on is licensed. Without it the
  // client is search-only: no decision bar, no route-onward form.
  const incoming = workflowEntitled ? (route || myOpenRoutes[id]) : null;
  if (incoming) {
    wrap.insertBefore(decisionBar(incoming), wrap.querySelector('.fields'));
  } else if (canDecide() && workflowEntitled) {
    const ac = await assignControl(id); wrap.insertBefore(ac, wrap.querySelector('.fields'));
  }

  const pg = await api.getPages(id);
  const pagesEl = wrap.querySelector('.pages');
  const imgs = (pg.json && pg.json.pages) || [];
  if (!imgs.length) { pagesEl.innerHTML = `<div class="empty">No preview available.</div>`; return; }
  pagesEl.innerHTML = '';
  for (const src of imgs) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
}

// Delete (→ bin) / restore / purge a document over /v1, then refresh the active list.
// Single-doc action (used by the preview buttons) → delegates to the multi handler.
function binAction(kind, id) { return binActionMulti(kind, [id]); }

async function binActionMulti(kind, ids) {
  ids = ids.filter((x) => x != null);
  if (!ids.length) return;
  const noun = ids.length > 1 ? `${ids.length} documents` : 'this document';
  const them = ids.length > 1 ? 'them' : 'it';
  if (kind === 'delete' && !confirm(`Move ${noun} to the recycle bin? You can restore ${them} later.`)) return;
  if (kind === 'purge'  && !confirm(`Permanently delete ${noun} and ${ids.length > 1 ? 'their files' : 'its file'}? This cannot be undone.`)) return;
  const fn = kind === 'delete' ? api.recycle.delete : kind === 'restore' ? api.recycle.restore : api.recycle.purge;
  let ok = 0;
  for (const id of ids) {
    const r = await fn(id);
    if (r && r.status === 401) { doLogout(); return; }
    if (r && r.status === 200) ok++;
  }
  _csel.clear();
  const verb = kind === 'delete' ? 'Moved to recycle bin' : kind === 'restore' ? 'Restored' : 'Deleted permanently';
  toast(ok ? `${verb}${ok > 1 ? ` (${ok})` : ''}` : 'Action failed', ok ? 'ok' : 'err');
  $('preview').innerHTML = `<div class="empty">Select a document on the left to preview it.</div>`;
  const inBin = $('view-recycle') && !$('view-recycle').classList.contains('hidden');
  if (inBin) loadRecycleBin(); else runSearch();
}

async function loadRecycleBin() {
  const root = $('recycle-list');
  if (!root) return;
  root.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading…</div>`;
  const r = await api.recycle.list();
  if (r.status === 401) { doLogout(); return; }
  const rows = (r.json && r.json.deleted) || [];
  root.innerHTML = '';
  resetRowSelection();
  if (!rows.length) { root.innerHTML = '<div class="empty">The recycle bin is empty. Deleted documents appear here and can be restored.</div>'; return; }
  for (const d of rows) root.appendChild(rowEl(d));
}

// Right-click menu — acts on the whole selection. In the bin: Restore / Delete permanently.
// In search results: Delete (→ recycle bin).
function showRowMenu(x, y) {
  closeBinMenu();
  const ids = [..._csel];
  if (!ids.length) return;
  const inBin = $('view-recycle') && !$('view-recycle').classList.contains('hidden');
  const sfx = ids.length > 1 ? ` (${ids.length})` : '';
  const m = document.createElement('div'); m.id = 'bin-menu';
  m.innerHTML = inBin
    ? `<button data-act="restore">Restore${sfx}</button>` +
      (role === 'admin' ? `<button data-act="purge" class="danger">Delete permanently${sfx}</button>` : '')
    : `<button data-act="delete" class="danger">Delete${sfx}</button>`;
  document.body.appendChild(m);
  m.style.left = Math.min(x, window.innerWidth  - m.offsetWidth  - 6) + 'px';
  m.style.top  = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
  m.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { closeBinMenu(); binActionMulti(b.dataset.act, [..._csel]); }));
}
function closeBinMenu() { document.getElementById('bin-menu')?.remove(); }
document.addEventListener('click', closeBinMenu);
document.addEventListener('scroll', closeBinMenu, true);

async function assignControl(docId, senderUsername) {
  const wrap = document.createElement('div'); wrap.className = 'wf';
  if (!recipientsCache) {
    const rr = await api.workflow.recipients();
    recipientsCache = (rr.json && rr.json.recipients) || [];
  }
  // When forwarding a routed doc, pre-select + mark the original sender for a "route back".
  const opts = recipientsCache.map((u) => {
    const isSender = senderUsername && u.username === senderUsername;
    return `<option value="${u.id}"${isSender ? ' selected' : ''}>${esc(u.displayName || u.username)} (${esc(u.role)})${isSender ? ' — sender' : ''}</option>`;
  }).join('');
  wrap.innerHTML = `
    <h3>${ico('assign')}${senderUsername ? 'Forward / route onward' : 'Route for approval / acknowledgement'}</h3>
    <div class="wf-row">
      <select class="a-to">${opts}</select>
      <select class="a-action"><option value="approve">Approve</option><option value="acknowledge">Acknowledge</option></select>
      <input class="a-comment" placeholder="Note (optional)" />
      <span class="msg"></span>
    </div>`;
  const btn = mkBtn({ label: 'Assign', icon: 'assign', variant: 'primary', sm: false, onClick: async () => {
    const toUserId = Number(wrap.querySelector('.a-to').value);
    const action = wrap.querySelector('.a-action').value;
    const comment = wrap.querySelector('.a-comment').value.trim() || undefined;
    const msg = wrap.querySelector('.msg');
    if (!toUserId) { msg.className = 'msg err'; msg.textContent = 'Pick a recipient.'; return; }
    const res = await api.workflow.assign(docId, toUserId, action, comment);
    if (res.status === 200) { msg.className = 'msg ok'; msg.textContent = 'Routed.'; refreshBadges(); }
    else { msg.className = 'msg err'; msg.textContent = (res.json && res.json.error) || 'Could not route.'; }
  } });
  wrap.querySelector('.wf-row').appendChild(btn);
  return wrap;
}

// ── Mailbox ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.segmented .seg').forEach((seg) => {
  seg.addEventListener('click', () => {
    document.querySelectorAll('.segmented .seg').forEach((s) => s.classList.remove('active'));
    seg.classList.add('active');
    currentBox = seg.dataset.box;
    loadMailbox();
  });
});
$('mb-refresh').addEventListener('click', () => { loadMailbox(); refreshBadges(); });

async function loadMailbox() {
  const list = $('mb-list'); list.innerHTML = `<div class="empty">${ico('refresh', 'ic spin')}Loading…</div>`;
  const r = await api.workflow.list(currentBox);
  if (r.status === 401) { doLogout(); return; }
  if (r.status === 402) { list.innerHTML = `<div class="empty">${ico('lock')}Not licensed.</div>`; return; }
  const routes = (r.json && r.json.routes) || [];
  list.innerHTML = '';
  if (!routes.length) { list.innerHTML = `<div class="empty">Nothing in ${currentBox}.</div>`; return; }
  const frag = document.createDocumentFragment();
  for (const rt of routes) frag.appendChild(mbRow(rt));
  list.appendChild(frag);
}

function mbRow(rt) {
  const el = document.createElement('div'); el.className = 'mb-row fade';
  const who = currentBox === 'sent' ? `to ${esc(rt.to_username)}` : `from ${esc(rt.from_username)}`;
  const kind = rt.action_required === 'approve' ? 'Approval request' : 'Acknowledgement request';
  el.innerHTML = `
    <div class="t1"><span class="nm">${esc(rt.supplier_name || ('Document #' + rt.document_id))}</span>
      <span class="chip ${esc(rt.state)}">${esc(rt.state)}</span></div>
    <div class="t2">${ico(rt.action_required === 'approve' ? 'check' : 'inbox')}<span>${kind} · ${who} · ${esc(rt.doc_date || '')}</span></div>
    ${rt.comment ? `<div class="quote">“${esc(rt.comment)}”</div>` : ''}
    ${rt.resolution_comment ? `<div class="quote">Reason: ${esc(rt.resolution_comment)}</div>` : ''}
    <div class="acts"></div>`;
  const acts = el.querySelector('.acts');
  const open = rt.state === 'pending' || rt.state === 'claimed';
  const canActRow = (currentBox === 'inbox' || currentBox === 'assigned') && open && rt.action_required === 'approve' && canDecide();
  let noteEl = null;
  if (canActRow) {
    noteEl = document.createElement('input'); noteEl.className = 'dec-note';
    noteEl.placeholder = 'Add a note (optional — required to reject)';
    el.insertBefore(noteEl, acts);
  }
  const decide = (decision) => {
    const note = noteEl ? noteEl.value.trim() : '';
    if (decision === 'reject' && !note) { noteEl.focus(); toast('A reason is required to reject.', 'err'); return; }
    act(api.workflow.resolve(rt.id, decision, note || null, rt.version));
  };

  if (currentBox === 'sent') {
    if (rt.state === 'pending') acts.appendChild(mkBtn({ label: 'Recall', icon: 'recall', variant: 'ghost', onClick: () => act(api.workflow.recall(rt.id, rt.version)) }));
  } else if (currentBox === 'inbox' || currentBox === 'assigned') {
    if (open) {
      if (rt.action_required === 'acknowledge') {
        acts.appendChild(mkBtn({ label: 'Acknowledge', icon: 'check', variant: 'primary', onClick: () => act(api.workflow.resolve(rt.id, 'acknowledge', null, rt.version)) }));
      } else if (canDecide()) {
        acts.appendChild(mkBtn({ label: 'Approve',   icon: 'check',  variant: 'primary',   onClick: () => decide('approve') }));
        acts.appendChild(mkBtn({ label: 'Reject',    icon: 'reject', variant: 'danger',    onClick: () => decide('reject') }));
        acts.appendChild(mkBtn({ label: 'Mark Paid', icon: 'check',  variant: 'secondary', onClick: () => decide('paid') }));
      }
      if (rt.state === 'pending') acts.appendChild(mkBtn({ label: 'Claim', icon: 'claim', variant: 'secondary', onClick: () => act(api.workflow.claim(rt.id, rt.version)) }));
    }
  }
  const actionable = (currentBox === 'inbox' || currentBox === 'assigned') && open;
  acts.appendChild(mkBtn({ label: 'View doc', icon: 'view', variant: 'ghost', onClick: () => { setView('search'); openDocument(rt.document_id, actionable ? rt : null); } }));
  if (rt.has_stamp) {   // a stamped APPROVED/REJECTED/PAID copy was filed for this decision
    acts.appendChild(mkBtn({ label: 'View stamped copy', icon: 'doc', variant: 'ghost', onClick: () => viewStamped(rt.id) }));
  }
  return el;
}

async function act(promise) {
  const r = await promise;
  if (r.status === 401) { doLogout(); return; }
  if (r.status !== 200) { toast((r.json && r.json.error) || 'Action failed.', 'err'); return; }
  loadMailbox(); refreshBadges();
}

// Fetch + show the stamped decision copy (server renders its pages; no path crosses the wire).
async function viewStamped(routeId) {
  const r = await api.workflow.stamped(routeId);
  if (r.status === 401) { doLogout(); return; }
  const pages = (r.json && r.json.pages) || [];
  if (r.status !== 200 || !pages.length) { toast((r.json && r.json.error) || 'No stamped copy available.', 'err'); return; }
  const ov = document.createElement('div'); ov.className = 'about-overlay'; ov.id = 'stamped-overlay';
  const inner = document.createElement('div'); inner.className = 'stamped-view';
  inner.innerHTML = `<div class="stamped-head"><span>Stamped copy</span><button class="btn btn-ghost btn-sm" id="stamped-close">Close</button></div><div class="stamped-pages"></div>`;
  const pagesEl = inner.querySelector('.stamped-pages');
  for (const src of pages) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
  ov.appendChild(inner); document.body.appendChild(ov);
  const close = () => ov.remove();
  inner.querySelector('#stamped-close').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
}

// Per-tab counts (inbox/sent/assigned/completed) + the nav inbox badge.
async function refreshBadges() {
  const boxes = ['inbox', 'sent', 'assigned', 'completed'];
  const open = {}; const counts = {};
  await Promise.all(boxes.map(async (box) => {
    try {
      const r = await api.workflow.list(box);
      const routes = (r.json && r.json.routes) || [];
      const n = routes.length; counts[box] = n;
      const seg = document.querySelector(`.segmented .seg[data-box="${box}"] [data-count]`);
      if (seg) { seg.textContent = String(n); seg.classList.toggle('hidden', n === 0); }
      if (box === 'inbox') { const b = $('inbox-badge'); b.textContent = String(n); b.classList.toggle('hidden', n === 0); }
      // Routes I can act on (addressed to me, still open) → drive the preview decision bar.
      if (box === 'inbox' || box === 'assigned') {
        for (const rt of routes) if (rt.state === 'pending' || rt.state === 'claimed') open[rt.document_id] = rt;
      }
    } catch { counts[box] = null; }
  }));
  myOpenRoutes = open;
  return { counts, open };   // Home dashboard reuses these instead of re-fetching
}

// Draggable pane dividers — resize the search/review columns. `data-resize="prev"` widens the
// pane to the LEFT of the grip (the list), `"next"` the pane to the RIGHT (the review fields);
// the flex preview between them takes the slack. Width persists per view in localStorage.
function initPaneResizers() {
  const MIN = 150, MAX = 900;
  document.querySelectorAll('.pane-resizer').forEach((grip) => {
    const side = grip.dataset.resize;
    const key  = grip.dataset.key;
    const target = side === 'prev' ? grip.previousElementSibling : grip.nextElementSibling;
    if (!target) return;
    const saved = parseInt(localStorage.getItem(key), 10);
    if (saved >= MIN && saved <= MAX) target.style.width = saved + 'px';
    let dragging = false;
    grip.addEventListener('mousedown', (e) => {
      dragging = true; e.preventDefault();
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const r = target.getBoundingClientRect();
      let w = side === 'prev' ? (e.clientX - r.left) : (r.right - e.clientX);
      w = Math.max(MIN, Math.min(MAX, w));
      target.style.width = w + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      const w = parseInt(target.style.width, 10);
      if (w) localStorage.setItem(key, String(w));
    });
  });
}
initPaneResizers();

boot();
