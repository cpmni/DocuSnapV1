'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let selectedFolder = null;
let running        = false;
let results        = [];
let stats          = { total: 0, done: 0, ok: 0, err: 0 };   // cumulative SESSION stats (manual + watch); never reset per run
let batch          = { total: 0, done: 0, ok: 0, err: 0 };   // current manual run only — drives the progress bar + finish message
let _userCanReview = true;   // false for Read Only (gates the "Review your documents" CTA)
let _isAdmin       = false;  // gates admin-only affordances (e.g. trial Activate → Settings)

// ── Element refs ─────────────────────────────────────────────────────────────
const folderBox     = document.getElementById('folder-box');
const folderDisplay = document.getElementById('folder-display');
const btnRun        = document.getElementById('btn-run');
const btnStop       = document.getElementById('btn-stop');
const btnReviewDocs  = document.getElementById('btn-review-docs');
const resultsEmpty  = document.getElementById('results-empty');
const logPanel      = document.getElementById('progress-section');  // the prominent progress strip
const logOutput     = document.getElementById('log-output');
const logStatus     = document.getElementById('log-status');
const progressBar   = document.getElementById('progress-bar');
const progressCount = document.getElementById('progress-count');
const progressText  = document.getElementById('progress-text');
const btnToggleLog  = document.getElementById('btn-toggle-log');
const tableBody     = document.getElementById('table-body');

// Update a button's text without disturbing its leading inline-SVG icon.
function setBtnLabel(btn, text) {
  const lbl = btn && btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  else if (btn) btn.textContent = text;
}

// ── View router (Home dashboard ↔ Import workspace) ──────────────────────────
// The nav rail is the single source of navigation. Home/Import switch the
// in-page view; Review/Search/Teach/Settings open the existing windows (wired
// further down). Selecting Home refreshes the dashboard's live counts.
const VIEWS = ['home', 'import'];
function showView(name) {
  if (!VIEWS.includes(name)) return;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.rail-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'home') refreshDashboard();
}
document.querySelectorAll('.rail-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ── Rail clock (time large, date underneath) ─────────────────────────────────
function tickClock() {
  const now = new Date();
  const t = document.getElementById('rail-time');
  const d = document.getElementById('rail-date');
  if (t) t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
tickClock();
setInterval(tickClock, 1000);

// ── Dashboard (Home) ─────────────────────────────────────────────────────────
let _lastRunSummary = null;                         // {ok,err} of the latest manual run this session
let _reviewCount = 0, _stuckCount = 0, _deferredCount = 0;  // cached so count-change events stay CHEAP
// The need/ready split of the review queue (Chris r2 2026-08-11, verify-list #3: "Home still
// just says 200 waiting"). Fetched ONLY in refreshDashboard (it walks the queue), cached here;
// updateAttention renders it only while its total still matches the live count, so a stale
// split between refreshes silently hides rather than lies.
let _reviewSplit = null;

// CHEAP repaint of the attention card from the cached counts — NO DB query, so it
// is safe to call on every review/stuck/deferred count-change event, even mid-import.
function updateAttention() {
  const reviewEl  = document.getElementById('dash-review-count');
  const defRow    = document.getElementById('dash-deferred-row');
  const defEl     = document.getElementById('dash-deferred-count');
  const stuckRow  = document.getElementById('dash-stuck-row');
  const stuckEl   = document.getElementById('dash-stuck-count');
  const attnBody  = document.getElementById('dash-attn-body');
  const allClear  = document.getElementById('dash-allclear');
  const openRev   = document.getElementById('dash-open-review');
  if (reviewEl) reviewEl.textContent = _reviewCount;
  const splitEl = document.getElementById('dash-review-split');
  if (splitEl) {
    const fresh = _reviewSplit && _reviewSplit.total === _reviewCount && _reviewCount > 0;
    splitEl.style.display = fresh ? '' : 'none';
    if (fresh) {
      splitEl.textContent = _reviewSplit.need > 0
        ? `${_reviewSplit.need} need${_reviewSplit.need === 1 ? 's' : ''} your review`
          + (_reviewSplit.ready > 0 ? ` · ${_reviewSplit.ready} ready to file` : '')
        : 'all ready to file';
    }
  }
  if (defEl)    defEl.textContent    = _deferredCount;
  if (defRow)   defRow.style.display   = _deferredCount > 0 ? '' : 'none';
  if (stuckEl)  stuckEl.textContent  = _stuckCount;
  if (stuckRow) stuckRow.style.display = _stuckCount > 0 ? '' : 'none';
  const clear = (_reviewCount + _stuckCount + _deferredCount) === 0;
  if (attnBody) attnBody.style.display = clear ? 'none' : '';
  if (allClear) allClear.style.display = clear ? '' : 'none';
  // Review is Admin/Edit only — hide the deep-link for read-only.
  if (openRev) openRev.style.display = (!clear && _userCanReview) ? '' : 'none';
}

// FULL refresh — fetches counts + a confirmed-docs query (recent activity +
// throughput) + watch/trial/setup state. Only called on load, after role resolves,
// and when the user opens Home — NEVER per count-change during an import (that would
// flood the main process with synchronous queries and stall processing).
async function refreshDashboard() {
  try { _reviewCount   = await window.docusnap.getReviewCount(); } catch {}
  try { _stuckCount    = await window.docusnap.getStuckCount(); } catch {}
  try { _deferredCount = await window.docusnap.getDeferredCount(); } catch {}
  try { _reviewSplit   = _userCanReview ? await window.docusnap.getReviewSplit() : null; } catch { _reviewSplit = null; }
  updateAttention();

  const dashFolder = document.getElementById('dash-folder');
  if (dashFolder) {
    if (selectedFolder) { dashFolder.textContent = selectedFolder; dashFolder.classList.add('set'); }
    else { dashFolder.textContent = 'No source folder chosen yet.'; dashFolder.classList.remove('set'); }
  }
  const dashLast = document.getElementById('dash-last-run');
  if (dashLast) dashLast.textContent = _lastRunSummary
    ? `Last run: ${_lastRunSummary.ok} processed`
      + (_lastRunSummary.filed != null ? ` — ${_lastRunSummary.filed} filed, ${_lastRunSummary.review} to review` : '')
      + (_lastRunSummary.err ? `, ${_lastRunSummary.err} with errors` : '') + '.'
    : '';

  // One confirmed-docs fetch feeds BOTH recent activity and the throughput strip.
  let confirmed = [];
  try {
    const res = await window.docusnap.searchDocuments({});
    confirmed = (res && res.confirmed) ? res.confirmed : [];
  } catch {}
  renderRecentActivity(confirmed);
  renderThroughput();
  renderLearning(confirmed);
  renderOutput();
  renderSetupChecklist(confirmed);
  refreshWatchCard();
  refreshTrialBanner();
  refreshUpdateBanner();       // advisory "new version available" (pull; hidden unless newer)
  renderDashboardExtra();      // auto-file % · storage · backup · search clients
  applyDashboardCardPrefs();   // re-assert user hide/show after the cards re-render
}

let _lastConfirmed = [];   // cached so "Clear" can re-render without another query
function renderRecentActivity(confirmed) {
  _lastConfirmed = confirmed || [];
  const list = document.getElementById('recent-list');
  if (!list) return;
  // "Clear" hides everything filed up to now; genuinely new activity reappears after.
  const clearedAt = Number(localStorage.getItem('recentClearedAt') || 0);
  const visible = (confirmed || []).filter(d => {
    const t = d.confirmed_at ? Date.parse(d.confirmed_at) : 0;
    return !clearedAt || (t && t > clearedAt);
  });
  const docs = visible.slice(0, 6);
  if (!docs.length) {
    const msg = (confirmed && confirmed.length) ? 'Cleared — new activity will show here.' : 'No documents filed yet.';
    list.innerHTML = `<div class="recent-empty">${msg}</div>`;
    return;
  }
  list.innerHTML = '';
  for (const d of docs) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `
      <span class="recent-co" title="${escHtml(d.supplier_name || '—')}">${escHtml(d.supplier_name || '—')}</span>
      <span class="recent-meta">${escHtml(d.type_name || '')}</span>
      <span class="recent-meta">${escHtml(d.reference_number || '—')}</span>
      <span class="recent-meta">${escHtml(d.doc_date || '')}</span>`;
    list.appendChild(row);
  }
}

// Count confirmed docs filed today / this week / this month from confirmed_at.
async function renderThroughput() {
  // Real counts from SQL (not the capped search list), so they show true volume. The
  // tiles have room for three digits → cap the DISPLAY at "999+".
  let c = { today: 0, week: 0, month: 0 };
  try { const r = await window.docusnap.getFiledCounts?.(); if (r) c = r; } catch {}
  const fmt = (n) => (Number(n) > 999 ? '999+' : String(Number(n) || 0));
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = fmt(n); };
  set('stat-today', c.today);
  set('stat-week',  c.week);
  set('stat-month', c.month);
}

// "Getting smarter" — suppliers now AUTO-FILING + layouts (templates) learned.
async function renderLearning(confirmed) {
  const body = document.getElementById('dash-learning-body');
  if (!body) return;
  let layouts = null;   // null = couldn't read (e.g. non-admin) → omit, don't show a wrong 0
  try { const t = await window.docusnap.getTemplates(); if (Array.isArray(t)) layouts = t.length; } catch {}
  // The truthful "suppliers auto-committing" tally comes from the graduation ROSTER (the same list
  // Settings shows), NOT a distinct-count of a recent CONFIRMED sample — that sample count diverged
  // from the roster (the reported ambiguity). Fall back to the sample only if the tally is missing.
  let na = null, autoFiledEver = null, selfFiling = null;
  try {
    const x = await window.docusnap.getDashboardExtra();
    if (x && x.autoFilingSuppliers) na = x.autoFilingSuppliers.suppliers;
    if (x && x.autoFiled) autoFiledEver = x.autoFiled.auto || 0;
    if (x && x.selfFilingSenders) selfFiling = x.selfFilingSenders.senders;   // Q4b: THE readiness predicate (the Review badge's)
  } catch {}
  if (na == null) {
    const s = new Set();
    for (const d of confirmed) { if (d.supplier_name) s.add(d.supplier_name.trim().toLowerCase()); }
    na = s.size;
  }
  const lay = layouts == null ? ''
    : ` · learned <span class="n">${layouts}</span> ${layouts === 1 ? 'layout' : 'layouts'}`;
  // "N suppliers now file automatically" was FALSE on installs where nothing has ever
  // auto-filed (Chris, both rounds: graduation is ELIGIBILITY; the filing bar decides
  // whether it happens). Say "qualified", and admit when none has actually fired.
  // Q4b (Chris round 14): the headline is the SAME readiness the Review badge shows ("files by
  // itself" — learned formats + a layout), so the number here equals the count of ✓ badges in
  // Review; the graduation roster is the sub-line. Falls back to the old wording when the
  // readiness tally is unavailable.
  if (selfFiling != null) {
    const grad = na > 0 ? `<div class="dash-card-note">${na} ${na === 1 ? 'supplier has' : 'suppliers have'} graduated to fully automatic filing${lay}.</div>`
                        : (lay ? `<div class="dash-card-note">Learned${lay.replace(/^ · learned/, '')}.</div>` : '');
    body.innerHTML = selfFiling > 0
      ? `<span class="n">${selfFiling}</span> ${selfFiling === 1 ? 'sender files' : 'senders file'} by ${selfFiling === 1 ? 'itself' : 'themselves'} after your confirmations.` + grad
        + (autoFiledEver === 0 ? `<div class="dash-card-note">Nothing has filed by itself in the last 7 days yet.</div>` : '')
      : `No senders file by themselves yet — teach a layout and confirm a few of its documents${lay}.`;
    return;
  }
  body.innerHTML = na > 0
    ? `<span class="n">${na}</span> ${na === 1 ? 'supplier has' : 'suppliers have'} qualified for automatic filing${lay}.`
      + (autoFiledEver === 0 ? `<div class="dash-card-note">Nothing filed automatically in the last 7 days — that also depends on the filing bar in Settings → Processing.</div>` : '')
    : `No suppliers file automatically yet — they graduate after a run of clean confirmations${lay}.`;
}

// "Where your files go" — output folder + Open folder.
async function renderOutput() {
  const el = document.getElementById('dash-output-folder');
  if (!el) return;
  let folder = null;
  try { folder = await window.docusnap.getSetting('output_folder'); } catch {}
  el.textContent = (folder && String(folder).trim()) || 'Not set yet — choose one in Settings.';
  el.dataset.folder = folder || '';
}

// Fixed-unit byte formatter for the Storage card.
function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Data cards — Filed automatically · Storage · Backup · Search clients (one best-effort IPC).
async function renderDashboardExtra() {
  let x = {};
  try { x = await window.docusnap.getDashboardExtra(); } catch {}

  const af = document.getElementById('dash-autofile-body');
  if (af) af.innerHTML = (x.autoFiled && x.autoFiled.total > 0)
    ? `<div class="big-num">${x.autoFiled.pct}%</div><div class="dash-card-note">filed automatically in the last 7 days — ${x.autoFiled.auto} of ${x.autoFiled.total} documents.</div>`
    : `<div class="dash-card-note">No documents filed in the last 7 days.</div>`;

  const st = document.getElementById('dash-storage-body');
  if (st) {
    const free = x.storage && x.storage.freeBytes != null ? fmtBytes(x.storage.freeBytes) : '—';
    const docs = x.storage ? (x.storage.docs || 0) : 0;
    st.innerHTML = `<div class="big-num">${free}</div><div class="dash-card-note">free on your files drive · ${docs} document${docs === 1 ? '' : 's'} filed.</div>`;
  }

  const bk = document.getElementById('dash-backup-body');
  if (bk) {
    const last = x.lastBackupAt ? new Date(x.lastBackupAt) : null;
    bk.innerHTML = last
      ? `<div class="dash-card-note">Last backup: <strong>${escHtml(last.toLocaleDateString())}</strong>, ${escHtml(last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}.</div>`
      : `<div class="dash-card-note">No backup yet — protect your settings &amp; learned data.</div>`;
  }

  const clCard = document.getElementById('dash-clients');
  const cl = document.getElementById('dash-clients-body');
  if (clCard && cl) {
    if (x.clients && x.clients.entitled) {
      clCard.style.display = '';
      const names = (x.clients.names || []).map(escHtml).join(', ');
      cl.innerHTML = `<div class="big-num">${x.clients.inUse}<span class="of">/${x.clients.cap}</span></div><div class="dash-card-note">client seat${x.clients.cap === 1 ? '' : 's'} in use${names ? ' · ' + names : ''}.</div>`;
    } else {
      clCard.style.display = 'none';   // not licensed → omit the card
    }
  }
  applyDashboardCardPrefs();   // a user-hide still wins over the entitlement-driven show above
  renderWorkflowCard();        // Slice 1: its own tiny IPC — never part of this heavy pipeline
}

// Workflow "Waiting on you" card (Slice 1). Deliberately fed by the tiny
// get-workflow-counts IPC, NOT get-dashboard-extra — the per-event repaint path must
// never pay fs.statfsSync + five blocks (eric). Hidden entirely while the workflow
// add-on is dark/unlicensed (the dash-clients precedent); a user-hide still wins.
async function renderWorkflowCard() {
  const card = document.getElementById('dash-workflow');
  if (!card) return;
  let c = null;
  try { c = await window.docusnap.workflow?.counts?.(); } catch { /* leave hidden */ }
  if (!c || !c.entitled) { card.style.display = 'none'; applyDashboardCardPrefs(); return; }
  card.style.display = '';
  const body = document.getElementById('dash-workflow-body');
  if (body) body.innerHTML = `
    <div class="dash-attn-row"><span class="dash-attn-num">${c.inbox}</span> waiting for you</div>
    <div class="dash-attn-row"${c.openSent ? '' : ' style="display:none;"'}><span class="dash-attn-num">${c.openSent}</span> sent, awaiting others</div>`;
  applyDashboardCardPrefs();
}
document.getElementById('dash-workflow-open')?.addEventListener('click', () => {
  // The mailbox lives in the Search window — land the user ON the mailbox view, not a cold
  // search (the button promised a place it wasn't taking them to).
  window.docusnap.openSearchWindowAt('mailbox');
});
// Repaint on the workflow invalidation ping, debounced (a bulk /v1 assign of 20 docs
// must coalesce, mirroring the _dashRefreshTimer idiom).
let _wfCardTimer = null;
window.docusnap.onWorkflowCountsChanged?.(() => {
  clearTimeout(_wfCardTimer);
  _wfCardTimer = setTimeout(renderWorkflowCard, 400);
});

// First-run setup checklist — shown only until the core steps are done, then hidden.
async function renderSetupChecklist(confirmed) {
  const card = document.getElementById('dash-setup');
  const list = document.getElementById('setup-list');
  if (!card || !list) return;
  let outputFolder = null;
  try { outputFolder = await window.docusnap.getSetting('output_folder'); } catch {}
  const processedAny = (confirmed.length + _reviewCount + _stuckCount + _deferredCount) > 0;
  const anyConfirmed = confirmed.length > 0;
  const items = [
    { done: !!(outputFolder && String(outputFolder).trim()), label: 'Choose where filed documents are saved', go: 'settings' },
    { done: processedAny, label: 'Process your first batch of documents',           go: 'import' },
    { done: anyConfirmed, label: 'Review &amp; confirm a document',                  go: 'review' },
  ];
  if (items.every((i) => i.done)) { card.style.display = 'none'; return; }   // established user → hide
  card.style.display = '';
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'setup-row' + (it.done ? ' done' : '');
    row.innerHTML = `
      <span class="setup-tick"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>
      <span class="setup-label">${it.label}</span>
      <button class="setup-go" data-go="${it.go}">Do this →</button>`;
    list.appendChild(row);
  }
  list.querySelectorAll('.setup-go').forEach((b) => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'import') showView('import');
    else if (go === 'review') window.docusnap.openReviewWindow();
    else window.docusnap.openSettingsWindow();
  }));
}

// Auto-import (watch-folder) status. Config IPC is admin-only — hide the card on a
// non-admin (or any failure) rather than showing an error.
async function refreshWatchCard() {
  const card = document.getElementById('dash-watch');
  const body = document.getElementById('dash-watch-body');
  const btnLbl = document.getElementById('dash-watch-btn-label');
  const toggle = document.getElementById('dash-watch-toggle');
  if (!card || !body) return;
  let cfg = null;
  try { cfg = await window.docusnap.getWatchFolderConfig(); } catch { card.style.display = 'none'; return; }
  card.style.display = '';
  const hasFolder = !!(cfg && cfg.folder);
  if (toggle) toggle.checked = !!(cfg && cfg.enabled);
  if (cfg && cfg.enabled && hasFolder) {
    body.className = 'dash-watch-body on';
    body.innerHTML = `On — watching<br><span class="wf-path">${escHtml(cfg.folder)}</span>`;
    const lt = document.getElementById('dash-watch-light');
    if (!lt || !lt.classList.contains('processing')) setWatchLight('done');   // green = on & ready
  } else if (hasFolder) {
    body.className = 'dash-watch-body off';
    body.innerHTML = `Paused<br><span class="wf-path">${escHtml(cfg.folder)}</span>`;
    setWatchLight('');
  } else {
    body.className = 'dash-watch-body off';
    body.textContent = 'Pick a folder and new scans dropped into it import automatically.';
    setWatchLight('');
  }
  if (btnLbl) btnLbl.textContent = hasFolder ? 'Change folder' : 'Choose folder';
}

// Pick (and enable) the watch folder straight from the card — no trip to Settings.
async function chooseWatchFolder() {
  let folder = null;
  try { folder = await window.docusnap.pickWatchFolder(); } catch {}
  if (!folder) return;
  try {
    const res = await window.docusnap.setWatchFolder(folder);
    if (res && res.ok === false) { alert(res.error || 'That folder can’t be used for auto-import.'); return; }
    await window.docusnap.setWatchFolderEnabled(true);
  } catch {}
  refreshWatchCard();
}

// Trial banner — driven by the LOCAL cached-token diagnostics (network-free, reliable),
// not the best-effort online status. Shown only on a trial; colour carries urgency.
const TRIAL_TOTAL_DAYS = 14;
async function refreshTrialBanner() {
  const banner = document.getElementById('dash-trial');
  const textEl = document.getElementById('dash-trial-text');
  const fillEl = document.getElementById('dash-trial-fill');
  if (!banner) return;
  let tok = null;
  try { const d = await window.docusnap.licenseGetDiagnostics(); tok = d && d.token; } catch {}
  const isTrial = !!tok && tok.hasToken && tok.kind === 'trial';
  let days = (tok && Number.isFinite(tok.days_remaining)) ? tok.days_remaining : null;
  if (days == null && tok) {
    const end = tok.entitlement_end || tok.not_after;
    const t = end ? Date.parse(end) : NaN;
    if (!Number.isNaN(t)) days = Math.max(0, Math.ceil((t - Date.now()) / 86400000));
  }
  if (!isTrial || days == null) { banner.style.display = 'none'; return; }

  banner.style.display = '';
  const total = Math.max(days, TRIAL_TOTAL_DAYS);   // never show "of N" smaller than days left
  const used  = Math.max(0, Math.min(total, total - days));
  if (textEl) {
    textEl.innerHTML = days <= 0
      ? 'Trial ended — activate to keep filing'
      : `Trial — <span class="n">${days}</span> of ${total} days left`;
  }
  if (fillEl) fillEl.style.width = `${Math.round((used / total) * 100)}%`;
  // Activation lives in Settings (admin-only), so the Activate button would be a dead
  // control for Edit/Read-Only — hide it for them (they still see the countdown).
  const activateBtn = document.getElementById('dash-trial-activate');
  if (activateBtn) activateBtn.style.display = _isAdmin ? '' : 'none';
  // Urgency: calm > 7 days, warn 3–7, crit <= 2 (or expired).
  banner.classList.remove('calm', 'warn', 'crit');
  banner.classList.add(days <= 2 ? 'crit' : days <= 7 ? 'warn' : 'calm');
}

document.getElementById('dash-open-review')?.addEventListener('click', () => window.docusnap.openReviewWindow());
document.getElementById('dash-go-import')?.addEventListener('click', () => showView('import'));
document.getElementById('dash-open-search')?.addEventListener('click', () => window.docusnap.openSearchWindow());

// ── Update-available banner (advisory; PULL model, mirroring refreshTrialBanner) ──────────
// Shows only when the backend advertises a newer version AND it hasn't been dismissed for THAT
// version (a later release re-surfaces the banner). Info tone; the Store (or installer) does the
// actual update. Fully guarded — any failure just hides the banner.
async function refreshUpdateBanner() {
  const el = document.getElementById('dash-update');
  if (!el) return;
  let info = null;
  try { info = await window.docusnap.getUpdateInfo(); } catch { info = null; }
  const dismissed = info && localStorage.getItem('update_dismissed_version') === info.latestVersion;
  const show = !!(info && info.updateAvailable && !dismissed);
  el.style.display = show ? '' : 'none';
  if (show) {
    el.dataset.latest = info.latestVersion;
    const t = document.getElementById('dash-update-text');
    if (t) t.textContent = `Version ${info.latestVersion} is ready — it installs the next time you restart Scan Finder.`;
  }
}
document.getElementById('dash-update-btn')?.addEventListener('click', () => window.docusnap.openUpdateUrl());
document.getElementById('dash-update-dismiss')?.addEventListener('click', () => {
  const el = document.getElementById('dash-update');
  if (el && el.dataset.latest) localStorage.setItem('update_dismissed_version', el.dataset.latest);
  if (el) el.style.display = 'none';
});
refreshUpdateBanner();

// ── Dashboard card customisation (Settings → Home dashboard) ───────────────────
// A user-hidden card gets .card-hidden (display:none !important), which overrides each card's
// OWN show/hide logic — so a hidden card stays hidden, and a card never user-hidden still follows
// its own rules. The trial/setup banners are system-state and aren't user-toggleable.
async function applyDashboardCardPrefs() {
  let hidden = [];
  try { const raw = await window.docusnap.getSetting('dashboard_hidden_cards'); if (raw) hidden = JSON.parse(raw); } catch {}
  if (!Array.isArray(hidden)) hidden = [];
  for (const card of document.querySelectorAll('#view-home .dash-card')) {
    if (card.id) card.classList.toggle('card-hidden', hidden.includes(card.id));
  }
}
window.docusnap.onDashboardCardsChanged?.(() => applyDashboardCardPrefs());

// ── Child-window dock ────────────────────────────────────────────────────────
// Minimised child windows (Review/Settings/Search/Teach/…) carry skipTaskbar, so
// without this they minimise to an unlabelled desktop stub with no taskbar entry to
// click. Main pushes the list; each entry becomes a chip that restores and focuses
// its window. Chips are BUILT, never innerHTML'd from the payload — the title comes
// from a main-side lookup table, but building them as elements keeps it that way even
// if the table ever grows a user-supplied name.
const DOCK_ICONS = {
  'review':        'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'settings':      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'search':        'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  'teach':         'M12 3L2 8l10 5 10-5-10-5zM2 8v6M6 10.5V16c0 1.1 2.7 2 6 2s6-.9 6-2v-5.5',
  'dev-inspector': 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3',
};
const DOCK_FALLBACK_ICON = 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zM3 9h18';

function renderChildDock(list) {
  const dock = document.getElementById('child-dock');
  if (!dock) return;
  dock.textContent = '';
  const items = Array.isArray(list) ? list : [];
  dock.hidden = items.length === 0;
  for (const it of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dock-chip';
    chip.title = `Bring “${it.title}” back`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'dock-ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', DOCK_ICONS[it.name] || DOCK_FALLBACK_ICON);
    svg.appendChild(p);

    const label = document.createElement('span');
    label.textContent = it.title;
    const hint = document.createElement('span');
    hint.className = 'dock-hint';
    hint.textContent = 'minimised';

    chip.append(svg, label, hint);
    chip.addEventListener('click', () => window.docusnap.restoreChildWindow?.(it.name));
    dock.appendChild(chip);
  }
}
window.docusnap.onChildDockChanged?.((list) => renderChildDock(list));
// Pull once on load: a window minimised before this renderer finished booting (or across
// a main-window reopen) would otherwise have no chip and no way back.
window.docusnap.getDockedChildren?.().then(renderChildDock).catch(() => {});

// Quick find — jump to Search (carrying the typed text where supported).
document.getElementById('dash-qf-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = (document.getElementById('dash-qf-input')?.value || '').trim();
  window.docusnap.openSearchWindow(q);
});

// Did you know — rotating one-line tips.
const DASH_TIPS = [
  ['Teach a document', 'Open a tricky scan in Review and use “Teach this document” so Scan Finder files its layout automatically next time.'],
  ['Auto-import', 'Point Scan Finder at a watched folder and new scans process the moment they land — no clicks needed.'],
  ['100% files itself', 'A document read with full confidence is filed automatically — you only review the ones that need a second look.'],
  ['Output structure', 'In Settings → Output Structure you can change how files are named and foldered using simple building blocks.'],
  ['It keeps learning', 'Every correction you confirm teaches Scan Finder — accuracy climbs the more you use it.'],
  ['Search anything', 'The Search “Search anything” box is full-text — it looks through everything on a document (text, references, amounts, dates and codes), not just the company. Numbers ignore commas, so 1137 finds 1,137.'],
];
let _tipIdx = Math.floor(Math.random() * DASH_TIPS.length);
function renderTip() {
  const body = document.getElementById('dash-tips-body');
  if (!body) return;
  const [k, v] = DASH_TIPS[_tipIdx % DASH_TIPS.length];
  body.innerHTML = `<span class="tip-k">${escHtml(k)}:</span> ${escHtml(v)}`;
}
document.getElementById('dash-tip-next')?.addEventListener('click', () => { _tipIdx = (_tipIdx + 1) % DASH_TIPS.length; renderTip(); });
renderTip();
document.getElementById('dash-backup-now')?.addEventListener('click', () => window.docusnap.openSettingsWindow());
applyDashboardCardPrefs();

// ── Home card drag-to-reorder (grab a card's header; smooth FLIP; order persists per section) ──
// Cards stay WITHIN their section grid. Order is a same-window UI preference → localStorage.
const DASH_ORDER_KEY = 'dashboard_card_order';
function _loadDashOrder() { try { return JSON.parse(localStorage.getItem(DASH_ORDER_KEY)) || {}; } catch { return {}; } }
function _saveDashOrder(section, ids) {
  const o = _loadDashOrder(); o[section] = ids;
  try { localStorage.setItem(DASH_ORDER_KEY, JSON.stringify(o)); } catch {}
}
function applyDashCardOrder() {
  const o = _loadDashOrder();
  for (const grid of document.querySelectorAll('#view-home .dash-grid[data-grid]')) {
    const ids = o[grid.dataset.grid];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) { const el = document.getElementById(id); if (el && el.parentElement === grid) grid.appendChild(el); }
  }
}
// FLIP: record positions, mutate the DOM, then animate each moved card from its old spot to 0.
function _dashFlip(grid, mutate) {
  const cards = [...grid.querySelectorAll(':scope > .dash-card')];
  const first = new Map(cards.map(c => [c, c.getBoundingClientRect()]));
  mutate();
  for (const c of cards) {
    if (c.classList.contains('dash-dragging')) continue;
    const f = first.get(c), l = c.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    if (dx || dy) {
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { c.style.transition = 'transform 180ms ease'; c.style.transform = ''; });
    }
  }
}
let _dashDrag = null;
function initDashSortable() {
  applyDashCardOrder();
  for (const grid of document.querySelectorAll('#view-home .dash-grid[data-grid]')) {
    if (grid.dataset.sortWired) continue;
    grid.dataset.sortWired = '1';   // delegate on the grid (survives card content re-renders)
    grid.addEventListener('mousedown', (e) => {
      // Don't start a drag from an interactive control living in the header — e.g. the
      // Auto-import on/off switch is a <label>/.dash-switch (its checkbox is visually
      // hidden), so a plain `input` exclusion missed it and the drag swallowed the toggle.
      if (e.button !== 0 || e.target.closest('button, a, input, select, textarea, label, .dash-switch')) return;
      const head = e.target.closest('.dash-card-head');
      const card = head && head.closest('.dash-card');
      if (!head || !card || card.parentElement !== grid || card.classList.contains('card-hidden')) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const ph = document.createElement('div');
      ph.className = 'dash-ph' + (card.classList.contains('dash-span') ? ' dash-span' : '');
      ph.style.height = rect.height + 'px';
      grid.insertBefore(ph, card.nextSibling);
      Object.assign(card.style, { width: rect.width + 'px', height: rect.height + 'px',
        position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', margin: '0',
        zIndex: '1000', pointerEvents: 'none' });
      card.classList.add('dash-dragging');
      document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing';
      _dashDrag = { card, grid, ph, offX: e.clientX - rect.left, offY: e.clientY - rect.top };
    });
  }
}
window.addEventListener('mousemove', (e) => {
  const d = _dashDrag; if (!d) return;
  d.card.style.left = (e.clientX - d.offX) + 'px';
  d.card.style.top  = (e.clientY - d.offY) + 'px';
  const cards = [...d.grid.querySelectorAll(':scope > .dash-card')].filter(c => c !== d.card && !c.classList.contains('card-hidden'));
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const ref = (e.clientY < r.top + r.height / 2) ? c : c.nextElementSibling;   // insert placeholder before `ref`
      if (ref !== d.ph && d.ph.nextElementSibling !== ref) _dashFlip(d.grid, () => d.grid.insertBefore(d.ph, ref));
      break;
    }
  }
});
window.addEventListener('mouseup', () => {
  const d = _dashDrag; if (!d) return; _dashDrag = null;
  const c = d.card;
  d.grid.insertBefore(c, d.ph); d.ph.remove();
  Object.assign(c.style, { width: '', height: '', position: '', left: '', top: '', margin: '', zIndex: '', pointerEvents: '' });
  c.classList.remove('dash-dragging');
  document.body.style.userSelect = ''; document.body.style.cursor = '';
  _saveDashOrder(d.grid.dataset.grid, [...d.grid.querySelectorAll(':scope > .dash-card')].map(x => x.id).filter(Boolean));
});
initDashSortable();

document.getElementById('dash-clear-recent')?.addEventListener('click', () => {
  localStorage.setItem('recentClearedAt', String(Date.now()));
  renderRecentActivity(_lastConfirmed);   // hide current entries; new ones reappear on refresh
});
document.getElementById('dash-watch-config')?.addEventListener('click', chooseWatchFolder);
document.getElementById('dash-watch-toggle')?.addEventListener('change', async (e) => {
  const on = e.target.checked;
  let cfg = null;
  try { cfg = await window.docusnap.getWatchFolderConfig(); } catch {}
  if (on && !(cfg && cfg.folder)) { e.target.checked = false; return chooseWatchFolder(); }  // need a folder first
  try { await window.docusnap.setWatchFolderEnabled(on); } catch {}
  refreshWatchCard();
});
document.getElementById('dash-trial-activate')?.addEventListener('click', () => window.docusnap.openSettingsWindowAtSection('licensing'));
document.getElementById('dash-trial-buy')?.addEventListener('click', () => window.docusnap.openExternal('https://scanfinder.co.uk'));
document.getElementById('dash-open-output')?.addEventListener('click', () => {
  const folder = document.getElementById('dash-output-folder')?.dataset.folder;
  if (folder) window.docusnap.openFolder(folder);   // dedicated folder-open (the file channel rejects extension-less paths)
  else window.docusnap.openSettingsWindow();
});
document.getElementById('dash-practice-btn')?.addEventListener('click', () => window.docusnap.openTutorial?.());
// Once a practice run has been completed, soften the card's first-run copy (still repeatable).
(async () => {
  try {
    if ((await window.docusnap.getSetting('practice_run_completed')) === 'true') {
      const lbl = document.getElementById('dash-practice-label'); if (lbl) lbl.textContent = 'Practice again';
      const note = document.getElementById('dash-practice-note');
      if (note) note.textContent = 'Run through import, review and confirm again any time — with safe sample documents.';
    }
  } catch {}
})();
refreshDashboard();

// Doc-type → structural field keys, so the results table can show the right
// Reference/Date for ANY type (invoice, sales order, PO, custom), not just the
// invoice_* convenience fields. Keyed by both type name and slug (lowercased).
const docTypeKeys = {};
function loadDocTypeKeys() {
  return window.docusnap.getAllDocTypes?.().then((types) => {
    for (const k in docTypeKeys) delete docTypeKeys[k];
    for (const t of (types || [])) {
      const entry = { ref: t.ref_field_key, date: t.date_field_key };
      if (t.name) docTypeKeys[t.name.toLowerCase()] = entry;
      if (t.slug) docTypeKeys[t.slug.toLowerCase()] = entry;
    }
  }).catch(() => {});
}
loadDocTypeKeys();
window.docusnap.onDocTypesChanged?.(() => loadDocTypeKeys());

// ── Current-file indicator (shown on the progress bar's foot row) ─────────────
// The stage chips were folded into the prominent progress bar; setStage now just
// names the document currently being processed. The `stage` arg is ignored (kept so
// existing call sites are unchanged).
function setStage(filename, _stage) {
  if (!filename) { progressText.textContent = ''; progressText.title = ''; return; }
  progressText.textContent = filename;
  progressText.title = filename;
}

function clearStage() {
  progressText.textContent = '';
  progressText.title = '';
}

// Toggle the (collapsed-by-default) processing log.
btnToggleLog?.addEventListener('click', () => {
  const open = logPanel.classList.toggle('log-open');
  btnToggleLog.textContent = open ? 'Hide log' : 'View log';
  if (open) logOutput.scrollTop = logOutput.scrollHeight;
});

// X / N count under the bar, kept in sync with the batch.
function updateProgressCount() {
  if (batch.total > 0) progressCount.textContent = `${batch.done} / ${batch.total}`;
  else progressCount.textContent = '—';
}

// Window controls (minimise/maximise/close) are provided by the native OS frame
// (main.js frame:true); the old in-page buttons + handlers were dead duplicates.

// ── Folder picker ────────────────────────────────────────────────────────────
async function chooseSourceFolder() {
  if (running) return;
  const folder = await window.docusnap.pickFolder();
  if (!folder) return;
  selectedFolder = folder;
  // Display a shortened path
  const parts = folder.replace(/\\/g, '/').split('/');
  const display = parts.length > 3
    ? '…/' + parts.slice(-2).join('/')
    : folder;
  folderDisplay.textContent = display;
  folderDisplay.title       = folder;
  folderDisplay.classList.add('set');
  folderBox.classList.remove('cue');  // stop the "pick a folder" pulse
  btnRun.disabled = false;
  const dashFolder = document.getElementById('dash-folder');
  if (dashFolder) { dashFolder.textContent = folder; dashFolder.classList.add('set'); }
  showFolderPreview(folder);   // list the docs inside so the operator can SEE the folder has content
}

// The native folder picker can't show files, so list the folder's documents (import is
// non-recursive → matches exactly what "Process" will handle) so the operator confirms content
// before processing. Disables Process for an empty folder (e.g. a parent that only has subfolders).
async function showFolderPreview(folder, opts) {
  const el = document.getElementById('folder-preview');
  if (!el) return;
  el.style.display = '';
  el.className = 'folder-preview loading';
  el.textContent = 'Checking folder…';
  let res = null;
  try { res = await window.docusnap.listImportFolder?.(folder); } catch {}
  if (selectedFolder !== folder) return;   // user re-picked while this was loading
  if (!res || res.count === 0) {
    // An empty folder straight after a successful batch is the app's OWN good behaviour —
    // the originals were moved to Processed/ as promised. Chris (r2 2026-08-11, finding 4)
    // read the generic "pick the folder that contains the scans" alarm as "what has it done
    // with my scans?" at the exact moment everything had worked.
    const justDid = opts && opts.justProcessed > 0 ? opts.justProcessed : 0;
    el.className = 'folder-preview empty';
    el.textContent = justDid
      ? `All ${justDid} scan${justDid === 1 ? '' : 's'} from this folder ${justDid === 1 ? 'has' : 'have'} been brought in and moved to its Processed subfolder. Drop new scans here whenever you like.`
      : 'No documents found directly in this folder — pick the folder that contains the scans (PDFs or images).';
    btnRun.disabled = true;
    return;
  }
  btnRun.disabled = false;
  el.className = 'folder-preview';
  const MAXN = 12;
  const items = res.files.slice(0, MAXN).map(f => `<li>${escHtml(f)}</li>`).join('');
  const more  = res.count > MAXN ? `<li class="more">…and ${res.count - MAXN} more</li>` : '';
  el.innerHTML = `<div class="fp-head">&#128196; ${res.count} document${res.count === 1 ? '' : 's'} ready to import</div>`
               + `<ul class="fp-list">${items}${more}</ul>`;
}
folderBox.addEventListener('click', chooseSourceFolder);

// ── Rail: Teach ───────────────────────────────────────────────────────────────
// Review/Search/Settings rail items reuse their original IDs, so their click
// handlers + role gating (further down) are unchanged.
document.getElementById('btn-teach')?.addEventListener('click', () => window.docusnap.openTeachWindow());

// ── Help: user guide + contextual help mode ───────────────────────────────────
document.getElementById('btn-help-guide')?.addEventListener('click', () => window.docusnap.openHelpWindow('main'));

const HELP_TEXTS = {
  'home':          'Your dashboard: what needs attention, a quick import, and recent activity.',
  'begin-import':  'Pick a folder of scans and process them into the queue.',
  'source-folder': 'The folder Scan Finder imports from. Click to choose a different one.',
  'process':       'Start processing the selected source folder into documents.',
  'review':        'Open the Review window to check, correct and confirm extracted data before filing. The badge shows how many items are waiting.',
  'search':        'Find documents you have already filed — by company, reference, date or type.',
  'settings':      'Document types, fields, folders and preferences (admin).',
  'teach':         'Guide Scan Finder, step by step, to learn a new document layout.',
  'user-guide':    'Open the full user guide.',
  'update':        'A newer version of Scan Finder is available. It installs automatically the next time you restart; this just lets you know. Your documents and settings stay on your PC.',
  'account':       'Your account — change password, switch theme, see About, or sign out.',
  'clock':         'Today’s date and the current time.',
  'local-only':    'Everything runs on this PC — no documents are uploaded or sent anywhere.',
  'dark-mode':     'Switch between light and dark appearance. The full theme choice is in Settings.',
  'trial':         'Your free-trial status and days remaining. “Activate” adds a licence (admin).',
  'buy-licence':   'Open the Scan Finder website to purchase a licence.',
  'setup-checklist':'First-time setup steps still to do — this card disappears once you’re set up.',
  'attention':     'What needs you: documents waiting in Review, set aside (deferred), or that couldn’t be read.',
  'pulse':         'How many documents you’ve filed today, in the last 7 days and this calendar month. (The 7-day count can exceed the month figure just after a new month starts.)',
  'dash-import':   'Your last source folder and a shortcut to the Import screen.',
  'auto-import':   'Watch a folder and import any scans dropped into it automatically (admin).',
  'learning':      'How many suppliers now file automatically (the graduation roster), plus the layouts learned.',
  'output':        'Where your filed documents are saved. “Open folder” opens it in your file explorer.',
  'recent':        'The documents you filed most recently. “Search” opens the full search window.',
  'clear-recent':  'Hide the current recent-activity entries. New documents you file will still appear here.',
  'stop':          'Stop the current import. Documents already finished stay done.',
  'stuck':         'Documents that couldn’t be read. “Try again” re-processes them.',
  'stats':         'This session’s totals — processed, OK and errors.',
  'clear-stats':   'Reset the session counters to zero. This doesn’t delete any documents.',
  'review-docs':   'Open the Review window to check and file the documents just processed.',
  'results':       'Each processed document’s company, date, reference and status. Click a “Filed” or “Needs review” row to open that document in Review.',
  'progress':      'Live progress of the current import, with a log you can open.',
  'log':           'Show or hide the detailed processing log.',
  'help-mode':     'Help mode: click any control to see what it does. Press Esc to leave.',
};
window.initHelpMode?.('help-mode-toggle', HELP_TEXTS);

// ── Run button ───────────────────────────────────────────────────────────────
btnRun.addEventListener('click', async () => {
  if (!selectedFolder || running) return;
  startProcessing();
});

// ── Processing ───────────────────────────────────────────────────────────────
async function startProcessing() {
  running = true;
  btnRun.disabled = true;
  setBtnLabel(btnRun, 'Processing…');
  // Reset the stop button every run: it was left disabled+"Stopping…" after a
  // previous stop, so without this a later run shows a stuck, unclickable
  // "Stopping…" and documents keep processing because stop can't be triggered.
  btnStop.disabled = false;
  setBtnLabel(btnStop, 'Stop Processing');
  btnStop.classList.add('visible');

  // Reset only the per-run BATCH (the progress bar). Session Stats are cumulative
  // across the session (manual + watch), so they are NOT wiped here.
  batch = { total: 0, done: 0, ok: 0, err: 0, review: 0 };
  updateStats();

  // Surface the Import workspace (results table + live progress strip coexist
  // there) so the operator watches this run fill in real time.
  showView('import');
  btnReviewDocs.classList.remove('visible');
  tableBody.innerHTML = '';                // fresh results for this run
  if (resultsEmpty) resultsEmpty.style.display = 'none';
  logPanel.classList.add('visible');
  logPanel.classList.remove('log-open');   // log collapsed by default — bar is the view
  if (btnToggleLog) btnToggleLog.textContent = 'View log';
  logOutput.innerHTML = '';
  progressBar.style.width = '0';
  progressCount.textContent = '—';
  setStage('');                            // clear the current-file name
  logStatus.textContent = 'Starting…';

  // Wire up progress events
  window.docusnap.removeProgress();
  window.docusnap.onProgress((msg) => handleProgress(msg));

  let processResult;
  try {
    processResult = await window.docusnap.processFolder(selectedFolder);
    // Q1 seam (2026-08-22): the handler REFUSES a folder that holds the kept originals of
    // already-filed documents (re-importing = duplicates) but lets the user override it.
    if (processResult && processResult.success === false && processResult.overridable) {
      const again = confirm(`${processResult.error}

Import it anyway?`);
      if (again) processResult = await window.docusnap.processFolder(selectedFolder, { importAnyway: true });
    }
  } catch (e) {
    appendLog(`Fatal error: ${e.message}`, 'err');
    logStatus.textContent = 'Error';
    running = false;
    btnRun.disabled  = false;
    setBtnLabel(btnRun, 'Process Documents');
    btnStop.classList.remove('visible');
    return;
  }

  // The handler REFUSES some imports up front (source folder overlaps the output or
  // "Processed" folder, licence lapsed, a training-setup error) by RESOLVING with
  // {success:false, error} — it does NOT throw — so the catch above never sees it, and
  // the old code fell straight through to "0 processed" with no explanation (the
  // Processed-folder-overlap trap). ONLY these refusals carry an `error` string (a normal
  // batch returns {success,stopped} with none, so a partial worker-exit failure still
  // renders its results below) — so surface it: show the reason, open the collapsed log,
  // and stop.
  if (processResult && processResult.success === false && processResult.error) {
    const why = processResult.error;
    appendLog(why, 'err');
    logStatus.textContent    = 'Couldn’t start';
    progressText.textContent = why;
    logPanel.classList.add('log-open');            // reveal the collapsed log so the reason is visible
    if (btnToggleLog) btnToggleLog.textContent = 'Hide log';
    running = false;
    btnRun.disabled = false;
    setBtnLabel(btnRun, 'Process Documents');
    btnStop.classList.remove('visible');
    return;
  }

  // Done
  running = false;
  btnRun.disabled  = false;
  setBtnLabel(btnRun, 'Process Documents');
  btnStop.classList.remove('visible');
  clearStage();
  // Imported originals have drained to Processed/, so the pick-time
  // "N documents ready to import" count is now stale — re-scan the folder so
  // the preview reflects what's actually left (and disables Process if empty).
  if (selectedFolder) showFolderPreview(selectedFolder, { justProcessed: batch.done });
  if (processResult && processResult.stopped) {
    logStatus.textContent = 'Stopped';
    progressText.textContent = `Stopped — ${batch.done} of ${batch.total} processed`;
    appendLog('Processing stopped.', 'warn');
  } else {
    logStatus.textContent = 'Finished';
    progressBar.style.width = '100%';
    // Be HONEST about the two-step model: a "needs review" doc is NOT filed yet — the user
    // must still open Review and Confirm it. Saying "N filed" for those made people stop early.
    const review = batch.review || 0;
    const filed  = Math.max(0, batch.ok - review);   // processed cleanly / auto-filed (no review needed)
    const errPart = batch.err ? `, ${batch.err} with errors` : '';
    let msg;
    if (review > 0) {
      msg = `✓ ${batch.done} processed — ${review} need${review === 1 ? 's' : ''} your review before filing`
          + (filed ? `, ${filed} ready` : '') + errPart;
    } else {
      msg = `✓ ${filed} processed and ready to file${errPart}`;
    }
    progressText.textContent = msg;
    appendLog(`✓ Finished — ${msg.replace(/^✓ /, '')}`, review > 0 ? 'warn' : 'ok');
    if (review > 0) appendLog('Open "Review your documents" to check and Confirm & File them — processing alone does not file them.', 'warn');
  }
  // If anything was processed, offer the "Review your documents" CTA and remember
  // this run for the dashboard's "last run" line.
  if (batch.done > 0) {
    if (_userCanReview) btnReviewDocs.classList.add('visible');
    // filed/review split kept for the dashboard line — "20 filed" was FALSE when the run
    // only QUEUED them (Chris r5: processing ≠ filing).
    _lastRunSummary = { ok: batch.ok, err: batch.err, filed, review };
  }
}

// 100%-confidence auto-filing now runs in the BACKEND (processing/handler _maybeAutoFile) so it
// covers the WATCH folder and background runs too, not just a manual batch with the window open.
// The main window just REFLECTS it: the backend emits 'doc-auto-filed' per filed doc; we tally
// the current BURST and show the results-list banner. Reset on a new manual run (the 'start'
// case) AND when a burst begins — the first auto-file after a quiet gap — so a long watch
// session doesn't grow the count unbounded (manual import + watch handled uniformly here).
let _autoFiledThisRun = 0;
let _lastAutoFiledAt  = 0;
const _AUTOFILE_BURST_GAP_MS = 60000;
window.docusnap.onDocAutoFiled?.((info) => {
  const now = Date.now();
  if (now - _lastAutoFiledAt > _AUTOFILE_BURST_GAP_MS) _autoFiledThisRun = 0;   // new burst after a quiet gap
  _lastAutoFiledAt = now;
  _autoFiledThisRun += 1;
  showAutoFiledBanner(_autoFiledThisRun);
  if (info && info.docId != null) markRowFiled(info.docId);   // flip its results row to "Filed"
  try { updateAttention(); } catch {}
  try { if (typeof refreshDashboardIfHome === 'function') refreshDashboardIfHome(); } catch {}
  try { checkGraduationAnnounce(); } catch {}
});

// A doc auto-filed after its results row was added (the row first showed "Needs review"): flip
// it to a green "Filed (auto)" that still opens the filed copy in Review.
function markRowFiled(docId) {
  const tr = tableBody.querySelector(`tr[data-doc-id="${docId}"]`);
  if (!tr) return;
  tr.classList.remove('row-review');
  const td = tr.querySelector('td:last-child');
  if (!td) return;
  td.innerHTML = _userCanReview
    ? `<button type="button" class="badge ok row-filed-link" title="Open this filed document in Review to check or correct it">Filed (auto)</button>`
    : `<span class="badge ok">Filed (auto)</span>`;
  const link = td.querySelector('.row-filed-link');
  if (link) link.addEventListener('click', () => window.docusnap.openReviewWindowAt(docId));
}

// Persistent summary at the top of the results list: N docs auto-filed at 100% confidence,
// with a "review them" link (opens Search, where the filed copies live). Cleared on the next run.
function showAutoFiledBanner(n) {
  const b = document.getElementById('autofiled-banner');
  if (!b) return;
  b.innerHTML = `<span class="af-ico">✓</span>`
    + `<span><b>${n} document${n > 1 ? 's' : ''}</b> auto-filed — no review needed.</span>`
    + `<a href="#" class="af-link" id="af-review-link">Click here to review them</a>`;
  b.style.display = 'flex';
  const link = b.querySelector('#af-review-link');
  if (link) link.onclick = (e) => { e.preventDefault(); window.docusnap.openSearchWindow?.(); };
}

// ── Graduation announce (#10) ────────────────────────────────────────────────
// When a (supplier, doc-type) FIRST graduates to auto-filing, tell the user once — so it's never
// a silent behaviour change (bob's "announced, never silent"). Diffs the live roster against a
// remembered set (graduation_announced); on the FIRST ever run it seeds the set silently, so only
// FUTURE graduations announce (existing ones aren't dumped as if they just happened).
const _gaEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function checkGraduationAnnounce() {
  try {
    if ((await window.docusnap.getSetting('supplier_graduation_enabled')) === 'false') return;
    const res = await window.docusnap.getGraduatedSuppliers?.();
    const scopes = ((res && res.scopes) || []).filter(s => s.key && !s.opted_out);
    const raw = await window.docusnap.getSetting('graduation_announced');
    if (raw == null || raw === '') {   // never announced → seed silently, announce only future
      await window.docusnap.setSetting('graduation_announced', JSON.stringify(scopes.map(s => s.key)));
      return;
    }
    let announced = [];
    try { const p = JSON.parse(raw); if (Array.isArray(p)) announced = p; } catch {}
    const set = new Set(announced);
    const fresh = scopes.filter(s => !set.has(s.key));
    if (!fresh.length) return;
    showGradAnnounce(fresh);
    for (const s of fresh) set.add(s.key);
    await window.docusnap.setSetting('graduation_announced', JSON.stringify([...set]));
  } catch { /* best-effort */ }
}

function showGradAnnounce(scopes) {
  const b = document.getElementById('grad-announce');
  if (!b) return;
  // Graduation is PER (supplier, DOCUMENT TYPE) scope — say so (owner 2026-08-01: the old
  // supplier-only wording implied ALL of a supplier's documents would auto-file). One scope
  // names both plainly; a same-supplier pair lists the types; a mixed batch lists
  // "Supplier (Type)" pairs, first two + a count.
  const bySupplier = new Map();
  for (const s of scopes) {
    const list = bySupplier.get(s.supplier) || [];
    list.push(s.doctype || s.slug || 'documents');
    bySupplier.set(s.supplier, list);
  }
  let who, what;
  if (bySupplier.size === 1) {
    const [sup, types] = [...bySupplier.entries()][0];
    who = `<b>${_gaEsc(sup)}</b>`;
    const t = types.map(x => `<b>${_gaEsc(x)}</b>`);
    what = `their clean ${t.length === 1 ? t[0] : t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1]} documents`;
  } else {
    const pairs = scopes.map(s => `<b>${_gaEsc(s.supplier)}</b> (${_gaEsc(s.doctype || s.slug)})`);
    who = pairs.slice(0, 2).join(' and ')
      + (pairs.length > 2 ? ` and ${pairs.length - 2} more` : '');
    what = 'their clean documents of these types';
  }
  b.innerHTML = `<span class="af-ico">★</span>`
    + `<span>Scan Finder has learned ${who} — ${what} will now file automatically. `
    + `You can still open any filed doc, or turn this off in Settings.</span>`
    + `<a href="#" class="af-link" id="grad-manage">Manage</a>`
    + `<span class="grad-dismiss" id="grad-dismiss" title="Dismiss">×</span>`;
  b.style.display = 'flex';
  const mg = b.querySelector('#grad-manage');
  if (mg) mg.onclick = (e) => { e.preventDefault(); window.docusnap.openSettingsWindowAtSection?.('learning'); };
  const dm = b.querySelector('#grad-dismiss');
  if (dm) dm.onclick = () => { b.style.display = 'none'; };
}

// Catch graduations that happened while the window was closed (their first auto-file was in the
// background), once the IPC bridge is ready.
setTimeout(() => { try { checkGraduationAnnounce(); } catch {} }, 1500);

function handleProgress(msg) {
  // Watch-folder events arrive on this shared channel too (tagged source:'watch').
  // They're handled separately by handleWatchProgress (log strip + Session Stats);
  // this manual-batch handler must ignore them, or — since it stays wired after a
  // manual run — it double-counts each watch doc and resets "Found" to the
  // watcher's per-file total of 1.
  if (msg.source === 'watch') return;
  switch (msg.type) {

    case 'start':
      // The pool emits ONE aggregate start with the FULL folder count, so the bar
      // total is accurate from the first frame (X / N, not a growing estimate).
      { const _ab = document.getElementById('autofiled-banner'); if (_ab) _ab.style.display = 'none'; }  // clear last run's auto-filed summary
      _autoFiledThisRun = 0;
      batch.total  = msg.total;     // this run, for the progress bar
      // Session "Found" now counts docs ACTUALLY processed (incremented per
      // file_done below, mirroring the watch path at handleWatchProgress) — NOT
      // this up-front folder total, which re-inflated "Found" by the whole count
      // on every re-run of the same folder and on an early Stop.
      updateStats();
      updateProgressCount();
      logStatus.textContent = 'Processing';
      appendLog(`Found ${msg.total} document(s) in folder.`);
      break;

    case 'file_begin':
      appendLog(`→ ${msg.filename}`);
      // Show clear "Processing X of N — <file>" progress (X = the doc starting now).
      setStage(batch.total > 0
        ? `Processing ${Math.min(batch.done + 1, batch.total)} of ${batch.total} — ${msg.filename}`
        : `Processing — ${msg.filename}`, 'ocr');
      if (batch.total > 0) {
        progressBar.style.width = ((batch.done / batch.total) * 100) + '%';
      }
      break;

    case 'file_pages':
      // Page count arrives after rendering — flag a multi-page document in the live text.
      if (msg.pages > 1) {
        setStage(`${msg.filename} — Multi-page document (${msg.pages} pages)`);
        appendLog(`   ${msg.filename}: ${msg.pages} pages`);
      }
      break;

    case 'file_done':
      batch.done++;
      stats.done++;
      stats.total++;                // Session "Found" = docs actually processed this session (mirrors the watch path)
      if (msg.success) { batch.ok++; stats.ok++; if (msg.needs_review) batch.review++; } else { batch.err++; stats.err++; }
      updateStats();
      updateProgressCount();
      addTableRow(msg);
      if (batch.total > 0) {
        progressBar.style.width = ((batch.done / batch.total) * 100) + '%';
      }
      setStage(msg.original_filename || msg.new_filename, 'save');
      if (resultsEmpty) resultsEmpty.style.display = 'none';
      if (msg.success) {
        appendLog(`  ✓ → ${msg.new_filename}`, 'ok');
      } else {
        appendLog(`  ✗ Error: ${msg.error}`, 'err');
      }
      break;

    case 'log':
      appendLog(msg.text, msg.level || '');
      // Pre-processing phase updates (e.g. the document-separation pre-pass that runs
      // before the first 'start') surface in the headline status + activity line so
      // the user sees real progress instead of a frozen "Starting…".
      if (msg.phase) {
        logStatus.textContent = 'Preparing';
        setStage(msg.text);
      } else if (msg.text && msg.text.includes('OCR:')) {
        setStage(progressText.textContent || '', 'ocr');
      }
      break;
  }
}

// ── Table row ────────────────────────────────────────────────────────────────
function addTableRow(msg) {
  const tr = document.createElement('tr');
  if (msg.db_id != null) tr.dataset.docId = String(msg.db_id);   // so auto-file can flip it to "Filed"
  // The row tint plus a per-row status chip make the outcome plain at a glance,
  // while the table stays compact: Company, Date, Reference, Status.
  if (!msg.success)        tr.classList.add('row-err');
  else if (msg.needs_review) tr.classList.add('row-review');

  // Resolve Date + Reference by the doc type's STRUCTURAL keys (date_field_key /
  // ref_field_key) so sales orders, POs and custom types populate too — not just
  // invoice_*. Fall back to the backend's invoice/SO/PO convenience fields.
  const ex    = msg.extractions || {};
  const keys  = docTypeKeys[(msg.document_type || '').toLowerCase()] || {};
  const exVal = (k) => (k && ex[k] && ex[k].value) ? ex[k].value : null;
  const company = msg.supplier_name || '—';
  const date    = exVal(keys.date) || msg.invoice_date   || '—';
  const ref     = exVal(keys.ref)  || msg.invoice_number || '—';

  // Status chip from the file_done signals: Error / Needs review / Filed. A
  // needs-review chip is clickable (opens Review) for users who can review.
  let statusCell;
  if (!msg.success) {
    statusCell = `<span class="badge err" title="${escHtml(msg.error || 'Processing error')}">Error</span>`;
  } else if (msg.needs_review) {
    statusCell = _userCanReview
      ? `<button type="button" class="badge warn row-review-link" title="Not filed yet — click to open Review, check the details and Confirm & File it">Confirm to file →</button>`
      : `<span class="badge warn" title="This document needs review before it can be filed">Needs review</span>`;
  } else {
    // "READY TO FILE", not "Filed" (Chris round 3, 2026-08-09 — his finding 2, and he was right).
    // Reaching here only means the document needs no review; FILING is a separate, gated step. He
    // read 17 green "Filed" pills, went to his output folder and found two documents — while the
    // bottom bar on the SAME screen said "17 ready", which is the accurate word. "Where is my
    // paper?" is the one question this product cannot afford to answer wrongly.
    // A document that genuinely auto-files flips to "Filed (auto)" via markRowFiled() on the
    // onDocAutoFiled event, which is the ONLY place allowed to claim a document is filed.
    // Still clickable — a green pill can hide a wrong value, so let the operator jump to Review.
    statusCell = _userCanReview
      ? `<button type="button" class="badge ok row-filed-link" title="No review needed — this will file when you confirm it, or automatically if it clears your auto-file setting. Click to open it in Review.">Ready to file</button>`
      : `<span class="badge ok" title="No review needed — not yet filed">Ready to file</span>`;
  }

  tr.innerHTML = `
    <td>${escHtml(company)}</td>
    <td class="mono">${escHtml(date)}</td>
    <td class="mono">${escHtml(ref)}</td>
    <td>${statusCell}</td>
  `;

  const link = tr.querySelector('.row-review-link') || tr.querySelector('.row-filed-link');
  if (link) {
    const docId = msg.db_id;   // set by _handleFileMessage before this message was mirrored
    link.addEventListener('click', () =>
      docId ? window.docusnap.openReviewWindowAt(docId) : window.docusnap.openReviewWindow());
  }

  tableBody.prepend(tr);  // newest at top
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function appendLog(text, cls = '') {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateStats() {
  // Mid-run, "found" must include the KNOWN remainder of this batch (the aggregate 'start'
  // event carries the full folder count) — otherwise the counter reads "132 processed of
  // 132 found", a false "done" signal four minutes into a 200-doc run (Chris r2 2026-08-11,
  // finding 7). Session-cumulative semantics stay: once the run ends the remainder is 0 and
  // the old "docs actually processed this session" number stands.
  const remaining = running && batch.total > 0 ? Math.max(0, batch.total - batch.done) : 0;
  document.getElementById('stat-total').textContent = stats.total + remaining;
  document.getElementById('stat-done').textContent  = stats.done;
  document.getElementById('stat-ok').textContent    = stats.ok;
  document.getElementById('stat-err').textContent   = stats.err;
}

// Print separator sheets (Filing Slips) — creates a numbered PDF pack (default 10,
// duplex pairs) and opens it in the system viewer to print. Errors surface inline
// (no native alert — the focus-repair rule). Settings → Processing has the count field.
document.getElementById('btn-print-slips')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-print-slips');
  const msg = document.getElementById('print-slips-msg');
  btn.disabled = true;
  if (msg) { msg.style.display = ''; msg.textContent = 'Creating sheets…'; }
  try {
    const res = await window.docusnap.generateFilingSlips(10);
    if (res && res.success) {
      window.docusnap.openFile(res.path);
      if (msg) msg.textContent = `Sheets ${String(res.first).padStart(4, '0')}–${String(res.last).padStart(4, '0')} created — print from the viewer.`;
    } else if (msg) {
      msg.textContent = `Couldn't create sheets: ${(res && res.error) || 'unknown error'}`;
    }
  } catch (e) {
    if (msg) msg.textContent = `Couldn't create sheets: ${e.message}`;
  }
  btn.disabled = false;
});

// Clear Stats — reset the cumulative Session Stats (and the per-run batch +
// progress bar) back to zero. Session Stats no longer reset per run, so this is
// the way to start a fresh count without restarting the app.
document.getElementById('btn-clear-stats')?.addEventListener('click', () => {
  stats = { total: 0, done: 0, ok: 0, err: 0 };
  batch = { total: 0, done: 0, ok: 0, err: 0, review: 0 };
  updateStats();
  if (progressBar) progressBar.style.width = '0';
});

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}


// ── Stop button ───────────────────────────────────────────────────────────────
btnStop?.addEventListener('click', async () => {
  btnStop.disabled = true;
  setBtnLabel(btnStop, 'Stopping…');
  await window.docusnap.stopProcessing();
});

// ── Review & settings buttons ─────────────────────────────────────────────────
document.getElementById('btn-review')?.addEventListener('click', () => {
  window.docusnap.openReviewWindow();
});
btnReviewDocs?.addEventListener('click', () => {
  window.docusnap.openReviewWindow();
});
document.getElementById('btn-settings')?.addEventListener('click', () => {
  window.docusnap.openSettingsWindow();
});

// ── Review count badge ────────────────────────────────────────────────────────
function applyReviewCount(count) {
  _reviewCount = count;
  const badge = document.getElementById('review-badge');
  if (badge) { badge.textContent = count; badge.classList.toggle('show', count > 0); }
  updateAttention();   // cheap DOM-only repaint of the dashboard count
}
async function refreshReviewBadge() {
  try { applyReviewCount(await window.docusnap.getReviewCount()); } catch {}
}
refreshReviewBadge();
// A confirm/defer/delete elsewhere broadcasts a count change. Keep the attention card
// cheap always; ALSO refresh the full dashboard (recent activity + throughput) when the
// change happens while Home is showing — so Recent Activity updates the moment a doc is
// confirmed. Gated to the Home view (+ debounced) so it never re-queries during an import.
let _dashRefreshTimer = null;
let _lastWatchActivity = 0;   // set by handleWatchProgress; gates the heavy refresh below
function refreshDashboardIfHome() {
  if (!document.getElementById('view-home')?.classList.contains('active')) return;
  if (running) return;                                   // a manual batch owns the queries
  if (Date.now() - _lastWatchActivity < 2500) return;    // background watch import in flight — don't pile on
  clearTimeout(_dashRefreshTimer);
  _dashRefreshTimer = setTimeout(refreshDashboard, 350);
}
window.docusnap.onReviewCountChanged((count) => { applyReviewCount(count); refreshDashboardIfHome(); });
window.docusnap.onDeferredCountChanged?.((count) => { _deferredCount = count || 0; updateAttention(); refreshDashboardIfHome(); });

// ── Search button ─────────────────────────────────────────────────────────────
document.getElementById('btn-search')?.addEventListener('click', () => {
  window.docusnap.openSearchWindow();
});

// Processing mode (Fast/Smart) was collapsed to a single mode — the two were identical
// after the AI-mode removal — so the topbar mode badge and the "Switch to Fast Mode?"
// suggestion toast are gone. The backend still stores `processing_mode` (default 'smart')
// and honours it for tolerance, but there is no longer a user-facing choice.

// ── Watch-folder activity in the live log strip + Session Stats ──────────────
// The watch folder emits the same per-file progress as a manual run, on its own
// 'watch-progress' channel. Surface it in the SAME bottom log strip AND count it
// in the Session Stats cards (Found/Done/OK/Errors) so background imports are
// reflected there too. It still does NOT drive the manual progress BAR or the
// results table (those are built for one discrete user-initiated batch; the
// watcher streams per-file and runs files in parallel).
// Auto-import card status light: '' hidden, 'processing' red-blink, 'done' steady green.
let _watchIdleTimer = null, _watchBurstDone = 0, _watchBurstActive = false;
function setWatchLight(state) {
  const el = document.getElementById('dash-watch-light');
  if (!el) return;
  el.className = 'watch-light' + (state ? ' ' + state : '');
  el.title = state === 'processing' ? 'Importing a document…' : state === 'done' ? 'Auto-import on — ready' : '';
}
// Live "Processing… (N done)" on the Auto-import card during a watch burst; refreshWatchCard()
// reverts it to "watching <folder>" when the burst goes idle. (Watch has no fixed batch total.)
function setWatchCardProcessing() {
  const body = document.getElementById('dash-watch-body');
  if (!body) return;
  body.className = 'dash-watch-body warn';
  const n = _watchBurstDone;
  body.innerHTML = `Processing…<br><span class="wf-path">${n} document${n === 1 ? '' : 's'} done this run</span>`;
}

function handleWatchProgress(msg) {
  _lastWatchActivity = Date.now();   // gates the dashboard's heavy refresh while a watch import runs
  // ALWAYS count watch docs in the cumulative Session Stats — even while a manual
  // run is active. In-flight watch workers finish DURING a manual run and their
  // file_done still lands here; the old early `if (running) return` dropped those
  // from the count, so Done under-reported vs the review queue (e.g. 28 counted
  // but 36 actually filed). Only the LOG display is suppressed during a manual run
  // so it doesn't fight that run's strip/status.
  if (msg.type === 'file_begin') {
    stats.total++;                // Session Stats "Found"
    updateStats();
  } else if (msg.type === 'file_done') {
    stats.done++;
    if (msg.success) stats.ok++; else stats.err++;
    updateStats();
    addTableRow(msg);   // watch docs show in the results list the same as manual ones
  }

  // Status light + Auto-import card body: live "Processing… (N done)" while a burst is in flight,
  // reverting to "watching <folder>" ~1.5s after the last file. The burst count resets per burst.
  if (msg.type === 'file_begin') {
    clearTimeout(_watchIdleTimer);
    if (!_watchBurstActive) { _watchBurstActive = true; _watchBurstDone = 0; }
    setWatchLight('processing');
    setWatchCardProcessing();
  } else if (msg.type === 'file_done') {
    _watchBurstDone++;
    setWatchCardProcessing();
    clearTimeout(_watchIdleTimer);
    _watchIdleTimer = setTimeout(() => { setWatchLight('done'); _watchBurstActive = false; try { refreshWatchCard(); } catch {} }, 1500);
  }

  if (running) return;            // the manual run owns the log strip + status
  logPanel.classList.add('visible');
  switch (msg.type) {
    case 'file_begin':
      logStatus.textContent = 'Watch folder — processing…';
      appendLog(`[Watch] → ${msg.filename}`);
      break;
    case 'file_done':
      if (msg.success) appendLog(`[Watch]   ✓ ${msg.original_filename || ''} → ${msg.new_filename || 'filed'}`, 'ok');
      else             appendLog(`[Watch]   ✗ ${msg.original_filename || ''}: ${msg.error || 'error'}`, 'err');
      logStatus.textContent = 'Watch folder — idle';
      break;
    case 'log':
      if (msg.text) appendLog(`[Watch] ${msg.text}`, msg.level || '');
      break;
    // per-file 'start' (total:1) is noise for a continuous watcher — ignored
  }
}
window.docusnap.onWatchProgress?.(handleWatchProgress);

// ── Stuck (failed) documents surface ─────────────────────────────────────────
// A doc that fails extraction now holds at status='error' (no longer silently
// dropped). Surface the count with a "Try again" that reprocesses them through
// the existing per-doc reprocess path; on success they become needs_review.
const stuckChip      = document.getElementById('stuck-chip');
const stuckMsg       = document.getElementById('stuck-msg');
const btnStuckRetry  = document.getElementById('btn-stuck-retry');
const stuckList      = document.getElementById('stuck-list');
const btnStuckDetails = document.getElementById('btn-stuck-details');
const btnStuckDismiss = document.getElementById('btn-stuck-dismiss');

// Per-session acknowledge: the count the user last dismissed at. The chip re-surfaces only when
// MORE documents fail (count grows past it), and the dismiss resets when the queue clears — so an
// acknowledge hides today's errors without ever hiding a NEW failure. Errored docs are never lost
// (they hold at status='error' and stay in getStuckDocs); dismiss is display-only.
let _stuckDismissedAt = -1;

function renderStuckChip(n) {
  _stuckCount = n || 0;
  updateAttention();   // keep the dashboard attention card in sync (cheap)
  if (!stuckChip) return;
  if (!n || n < 1) { stuckChip.style.display = 'none'; _stuckDismissedAt = -1; return; }  // cleared → reset ack
  if (n <= _stuckDismissedAt) { stuckChip.style.display = 'none'; return; }                // acknowledged, nothing new
  _stuckDismissedAt = -1;                                                                  // a new/extra failure → re-surface
  stuckMsg.textContent = `${n} document${n === 1 ? "" : "s"} couldn't be read — held for retry (not filed, not lost).`;
  stuckChip.style.display = '';
  if (stuckList) { stuckList.hidden = true; stuckList.innerHTML = ''; }   // collapse stale details on re-render
  // "Try again" runs reprocess (Admin/Edit only) — hide the action for read-only.
  if (btnStuckRetry) btnStuckRetry.style.display = _userCanReview ? '' : 'none';
}
async function refreshStuckCount() {
  try { renderStuckChip(await window.docusnap.getStuckCount()); } catch {}
}
refreshStuckCount();
window.docusnap.onStuckCountChanged?.((n) => renderStuckChip(n));

// "Details" — name each held document + WHY it couldn't be read (documents.error_message), so the
// banner explains itself instead of a bare count. Toggles a collapsible list; values go in via
// textContent (never innerHTML) so an error string can't inject markup.
btnStuckDetails?.addEventListener('click', async () => {
  if (!stuckList) return;
  if (!stuckList.hidden) { stuckList.hidden = true; return; }   // toggle closed
  let docs = [];
  try { docs = await window.docusnap.getStuckDocs(); } catch {}
  stuckList.innerHTML = '';
  if (!docs.length) {
    const li = document.createElement('li'); li.textContent = 'No details available.'; stuckList.appendChild(li);
  } else {
    for (const d of docs) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'stuck-name'; name.textContent = d.original_filename || `Document #${d.id}`;
      const why  = document.createElement('span'); why.className  = 'stuck-why';  why.textContent  = d.error_message ? ` — ${d.error_message}` : ' — couldn’t be read';
      li.append(name, why);
      stuckList.appendChild(li);
    }
  }
  stuckList.hidden = false;
});

// Dismiss (×) — acknowledge the current count for this session (display-only; the docs stay held).
btnStuckDismiss?.addEventListener('click', () => {
  _stuckDismissedAt = _stuckCount;
  if (stuckChip) stuckChip.style.display = 'none';
});

btnStuckRetry?.addEventListener('click', async () => {
  if (running) return;                       // don't fight a manual batch
  let docs = [];
  try { docs = await window.docusnap.getStuckDocs(); } catch {}
  if (!docs.length) { refreshStuckCount(); return; }

  btnStuckRetry.disabled = true;
  const orig = btnStuckRetry.textContent;
  logPanel.classList.add('visible');
  logStatus.textContent = 'Retrying…';
  appendLog(`Reprocessing ${docs.length} stuck document(s)…`);
  let recovered = 0, stillStuck = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    btnStuckRetry.textContent = `Retrying ${i + 1}/${docs.length}…`;
    try {
      const r = await window.docusnap.reprocessDocument({
        docId: d.id, folderPath: d.folder_path, filename: d.original_filename,
      });
      if (r?.success) { recovered++; appendLog(`  ✓ ${d.original_filename}`, 'ok'); }
      else            { stillStuck++; appendLog(`  ✗ ${d.original_filename}: ${r?.error || 'still failing'}`, 'err'); }
    } catch (e) {
      stillStuck++; appendLog(`  ✗ ${d.original_filename}: ${e.message}`, 'err');
    }
  }
  btnStuckRetry.textContent = orig;
  btnStuckRetry.disabled = false;
  logStatus.textContent = 'Finished';
  appendLog(`Reprocess complete — ${recovered} recovered${stillStuck ? `, ${stillStuck} still failing` : ''}.`,
    recovered ? 'ok' : 'warn');
  await refreshStuckCount();
  if (recovered > 0) window.docusnap.notifyReviewComplete?.();
});

// ── Account: current-user chip, role-based nav, sign out, change password ────
const ROLE_LABELS = { admin: 'Admin', edit: 'Edit', readonly: 'Read Only' };

const userChip       = document.getElementById('user-chip');
const userChipName   = document.getElementById('user-chip-name');
const userChipRole   = document.getElementById('user-chip-role');
const userChipAvatar = document.getElementById('user-chip-avatar');
const userMenu       = document.getElementById('user-menu');
const btnChangePassword = document.getElementById('menu-change-password');
const btnSignOut        = document.getElementById('menu-sign-out');
const btnReviewNav      = document.getElementById('btn-review');
const btnSettingsNav    = document.getElementById('btn-settings');

function applyCurrentUser(user) {
  if (!user) return;
  const label = user.displayName || user.username || '?';
  userChipName.textContent = label;
  userChipAvatar.textContent = label.trim().charAt(0).toUpperCase();
  userChipRole.textContent = ROLE_LABELS[user.role] || user.role;
  userChipRole.dataset.role = user.role;

  // Mirrors the IPC-level gates (see main.js open-review-window /
  // open-settings-window and the role checks inside their handler modules):
  // Read Only has no actionable use for Review (every action there is
  // Admin/Edit), and Settings is the Admin-exclusive "access all settings"
  // surface. Hiding the entry points keeps the chrome honest about what a
  // role can actually do — not just relying on the click being rejected.
  if (btnReviewNav)   btnReviewNav.style.display   = (user.role === 'readonly') ? 'none' : '';
  if (btnSettingsNav) btnSettingsNav.style.display = (user.role === 'admin')    ? '' : 'none';
  // The post-processing "Review your documents" CTA follows the same Review gate.
  _userCanReview = (user.role !== 'readonly');
  _isAdmin       = (user.role === 'admin');
  if (!_userCanReview && btnReviewDocs) btnReviewDocs.classList.remove('visible');
  refreshTrialBanner();   // re-evaluate the trial Activate gate now the role is known

  // Teaching writes templates/learning — Admin+Edit (hidden for Read Only).
  const btnTeach = document.getElementById('btn-teach');
  if (btnTeach) btnTeach.style.display = (user.role === 'readonly') ? 'none' : '';
  // Import is Admin/Edit too (the pick-folder + process-folder IPCs require admin/edit).
  // For read-only it was a silent dead control — the folder picker just got rejected with
  // nothing visible (§4a #1). Hide it so the rail reflects what the role can actually do.
  const btnImport = document.getElementById('btn-import');
  if (btnImport) btnImport.style.display = (user.role === 'readonly') ? 'none' : '';
  // "Open folder" on the output card shells into the output tree — now admin/edit only
  // (the main-side open-folder gate refuses readonly; hide the button so it isn't a
  // silent dead control).
  const btnOpenOut = document.getElementById('dash-open-output');
  if (btnOpenOut) btnOpenOut.style.display = (user.role === 'readonly') ? 'none' : '';
  refreshDashboard();   // reflect role in the dashboard's Open Review visibility
}

window.docusnap.authGetCurrentUser().then(applyCurrentUser);
window.docusnap.onAuthSessionChanged((user) => { if (user) applyCurrentUser(user); });

// ── Theme toggle (account menu) — mirrors the Settings → General toggle:
// applyTheme() updates this window instantly, set-setting persists it and
// broadcasts theme-changed so every other open window follows live. The
// Settings toggle stays in place as the canonical control.
const btnThemeToggle = document.getElementById('menu-theme');
// Quick Light⇄Dark flip (mode-aware): the named themes live in Settings → Appearance.
function isDarkMode() { return document.documentElement.getAttribute('data-mode') === 'dark'; }
const railDarkToggle = document.getElementById('rail-dark-toggle');
function refreshThemeMenuLabel() {
  if (btnThemeToggle) btnThemeToggle.textContent =
    isDarkMode() ? 'Switch to light theme' : 'Switch to dark theme';
  if (railDarkToggle) railDarkToggle.checked = isDarkMode();
}
// Resolve which theme a light/dark flip lands on: the remembered theme of that family
// (last one the user actually selected) so the flip round-trips back to their choice —
// e.g. Nordic Slate ⇄ chosen dark ⇄ Nordic Slate — not the base 'light'/'dark'. Falls
// back to the base theme of the family on first use. Anchors are kept current by
// theme.js applyTheme() on every theme change (menu flip, rail toggle, Settings pick).
function _themeForFamily(family) {
  const key = family === 'dark' ? 'docusnap_theme_dark' : 'docusnap_theme_light';
  const fallback = family === 'dark' ? 'dark' : 'warm';
  let t = null; try { t = localStorage.getItem(key); } catch {}
  return t || fallback;
}
async function setLightDark(family) {   // canonical light/dark flip (shared by menu + rail toggle)
  const next = _themeForFamily(family);
  applyTheme(next);
  refreshThemeMenuLabel();
  try { await window.docusnap.setSetting('theme', next); } catch {}
}
refreshThemeMenuLabel();
window.docusnap.onThemeChanged?.(() => refreshThemeMenuLabel());
btnThemeToggle?.addEventListener('click', () => {
  userMenu.classList.remove('open');
  setLightDark(isDarkMode() ? 'light' : 'dark');
});
railDarkToggle?.addEventListener('change', (e) => setLightDark(e.target.checked ? 'dark' : 'light'));

userChip?.addEventListener('click', (e) => {
  e.stopPropagation();
  refreshThemeMenuLabel();        // reflect a theme changed elsewhere since last open
  userMenu.classList.toggle('open');
});
document.addEventListener('click', () => userMenu?.classList.remove('open'));

btnSignOut?.addEventListener('click', async () => {
  userMenu.classList.remove('open');
  await window.docusnap.authLogout();
  window.docusnap.authShowLoginScreen();
});

btnChangePassword?.addEventListener('click', () => {
  userMenu.classList.remove('open');
  showChangePasswordDialog();
});

// ── About dialog ──────────────────────────────────────────────────────────────
const aboutOverlay = document.getElementById('about-overlay');
let _aboutLoaded = false;
async function openAbout() {
  if (!_aboutLoaded) {
    try {
      const a = await window.docusnap.getAppAbout();
      document.getElementById('about-version').textContent   = a.version ? `Version ${a.version}${a.buildRev ? ` (${a.buildRev})` : ''}` : '';
      document.getElementById('about-electron').textContent  = a.electron ? `Electron ${a.electron}` : '';
      document.getElementById('about-copyright').textContent = a.copyright || '';
      _aboutLoaded = true;
    } catch (e) { console.warn('getAppAbout failed:', e.message); }
  }
  aboutOverlay.style.display = 'flex';
}
function closeAbout() { aboutOverlay.style.display = 'none'; }

document.getElementById('menu-about')?.addEventListener('click', () => {
  userMenu.classList.remove('open');
  openAbout();
});
document.getElementById('menu-welcome')?.addEventListener('click', () => {
  userMenu.classList.remove('open');
  window.docusnap.openWelcome?.();
});
document.getElementById('menu-tutorial')?.addEventListener('click', () => {
  userMenu.classList.remove('open');
  window.docusnap.openTutorial?.();
});
// The welcome tour's "Go to Import" jumps the open Home shell to the Import view.
window.docusnap.onWelcomeGotoImport?.(() => showView('import'));
document.getElementById('about-legal')?.addEventListener('click', () => window.docusnap.openLegal?.());
document.getElementById('about-close')?.addEventListener('click', closeAbout);
aboutOverlay?.addEventListener('click', (e) => { if (e.target === aboutOverlay) closeAbout(); });
// Escape closes the About overlay (Chris round 2 — "pressed Escape twice like a man rattling a
// locked door"). Gate POSITIVELY on 'flex' (what openAbout sets): before first open the inline
// style is '' and this must not fire.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && aboutOverlay && aboutOverlay.style.display === 'flex') closeAbout();
});
document.getElementById('about-licenses')?.addEventListener('click', async () => {
  const r = await window.docusnap.openThirdPartyLicenses();
  if (r && !r.ok) console.warn('Could not open the licenses file:', r.error);
});

function showChangePasswordDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9998;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
  `;
  const fieldStyle = 'width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border2);' +
    ' background:var(--bg); color:var(--text); font-family:inherit; font-size:12px; outline:none;';
  overlay.innerHTML = `
    <div style="width:320px; background:var(--surface); border:1px solid var(--border2);
                border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                font-family:var(--sans); color:var(--text);">
      <div style="font-size:13px; font-weight:500;">Change your password</div>
      <div id="cp-msg" style="display:none; font-size:11px; padding:8px 10px; border-radius:6px; line-height:1.5;"></div>
      <div>
        <label style="display:block; font-size:11px; color:var(--muted); margin-bottom:4px;">Current password</label>
        <input type="password" id="cp-current" autocomplete="current-password" style="${fieldStyle}">
      </div>
      <div>
        <label style="display:block; font-size:11px; color:var(--muted); margin-bottom:4px;">New password</label>
        <input type="password" id="cp-new" autocomplete="new-password" style="${fieldStyle}">
      </div>
      <div>
        <label style="display:block; font-size:11px; color:var(--muted); margin-bottom:4px;">Confirm new password</label>
        <input type="password" id="cp-confirm" autocomplete="new-password" style="${fieldStyle}">
      </div>
      <div style="display:flex; gap:8px; margin-top:4px;">
        <button id="cp-cancel" style="flex:1; padding:9px; border-radius:6px; border:1px solid var(--border2);
                background:transparent; color:var(--muted); font-family:inherit; font-size:12px; cursor:pointer;">Cancel</button>
        <button id="cp-save" style="flex:1; padding:9px; border-radius:6px; border:none;
                background:var(--accent); color:#fff; font-family:inherit; font-size:12px; font-weight:500; cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const msg     = overlay.querySelector('#cp-msg');
  const current = overlay.querySelector('#cp-current');
  const next    = overlay.querySelector('#cp-new');
  const confirmInput = overlay.querySelector('#cp-confirm');
  const save    = overlay.querySelector('#cp-save');

  function setMsg(text, ok) {
    if (!text) { msg.style.display = 'none'; return; }
    msg.textContent = text;
    msg.style.display = 'block';
    msg.style.background = ok ? 'var(--ok-bg)' : 'var(--err-bg)';
    msg.style.color      = ok ? 'var(--ok)'    : 'var(--err)';
  }

  overlay.querySelector('#cp-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  save.addEventListener('click', async () => {
    setMsg('');
    const currentPassword = current.value;
    const newPassword     = next.value;
    const confirmPassword = confirmInput.value;
    if (newPassword.length < 8)          { setMsg('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setMsg('New passwords do not match.'); return; }

    save.disabled = true;
    save.textContent = 'Saving…';
    let result;
    try {
      result = await window.docusnap.authChangePassword({ currentPassword, newPassword, confirmPassword });
    } finally {
      save.disabled = false;
      save.textContent = 'Save';
    }

    if (!result || !result.success) {
      setMsg((result && result.error) || 'Could not change your password.');
      return;
    }
    setMsg('Password changed.', true);
    current.value = ''; next.value = ''; confirmInput.value = '';
    setTimeout(() => overlay.remove(), 900);
  });
}

// ── Hidden developer inspector shortcut: Ctrl+Shift+D then M (within ~1s) ──────
// The renderer only DETECTS the sequence and forwards the typed password; the
// main process verifies it (SFDEV) and decides whether to open the window. This
// grants no privilege by itself and never bypasses login/role checks.
(() => {
  let armed = false, armedAt = 0;   // true after Ctrl+Shift+D, expires after 1s
  let modalOpen = false;

  const inField = (el) => !!el && (el.isContentEditable
    || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

  document.addEventListener('keydown', (e) => {
    if (modalOpen) return;
    // Ctrl+Shift held is NEVER text entry, so the chord works even with focus in a field
    // (2026-08-04: the old inField guard silently ate the chord and cost a "SFDEV is
    // broken" diagnosis). Without Ctrl+Shift we disarm and return immediately.
    if (!(e.ctrlKey && e.shiftKey)) { armed = false; return; }
    if (e.code === 'KeyD') { armed = true; armedAt = Date.now(); return; }
    if (e.code === 'KeyM' && armed && (Date.now() - armedAt) < 1000) {
      armed = false;
      e.preventDefault();
      openDevPasswordModal();
    } else if (e.code !== 'KeyD') {
      armed = false;
    }
  });

  function openDevPasswordModal() {
    modalOpen = true;
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      width: '300px', background: '#13161f', border: '1px solid #2f3347',
      borderRadius: '10px', padding: '18px', boxShadow: '0 12px 32px rgba(0,0,0,.5)',
      fontFamily: "'IBM Plex Sans',sans-serif", color: '#e2e6f0',
    });
    const title = document.createElement('div');
    title.textContent = 'Developer Inspector';
    Object.assign(title.style, { fontSize: '13px', fontWeight: '600', marginBottom: '10px' });
    const input = document.createElement('input');
    input.type = 'password'; input.placeholder = 'Password';
    Object.assign(input.style, {
      width: '100%', padding: '8px 10px', borderRadius: '6px', outline: 'none',
      border: '1px solid #2f3347', background: '#0c0e14', color: '#e2e6f0',
      fontFamily: "'IBM Plex Sans',sans-serif", fontSize: '12px',
    });
    const msg = document.createElement('div');
    Object.assign(msg.style, { color: '#f76f6f', fontSize: '11px', minHeight: '14px', margin: '6px 0 10px' });
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.textContent = 'Open';
    for (const b of [cancel, ok]) Object.assign(b.style, {
      padding: '7px 14px', borderRadius: '6px', border: '1px solid #2f3347',
      background: 'transparent', color: '#e2e6f0', cursor: 'pointer', fontSize: '11px',
    });
    Object.assign(ok.style, { background: '#4f8ef7', borderColor: '#4f8ef7', color: '#0c0e14', fontWeight: '500' });

    const close = () => { overlay.remove(); modalOpen = false; };
    const submit = async () => {
      ok.disabled = true;
      const valid = await window.docusnap.devInspectorUnlock(input.value);
      ok.disabled = false;
      if (valid) close();
      else { msg.textContent = 'Incorrect password.'; input.value = ''; input.focus(); }
    };
    cancel.addEventListener('click', close);
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') submit();
      if (ev.key === 'Escape') close();
    });

    row.append(cancel, ok);
    box.append(title, input, msg, row);
    overlay.append(box);
    document.body.append(overlay);
    // Auto-focus + widget-focus repair so the password box takes keystrokes without an alt-tab.
    (window.repairModalInputFocus || ((el) => el.focus()))(input);
  }
})();
