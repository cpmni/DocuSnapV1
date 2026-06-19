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
let blocked = false;
let currentBox = 'inbox';
let recipientsCache = null;
let myOpenRoutes = {}; // document_id -> open route addressed to me (recipient/claimant)

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
};
const ico = (name, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[name] || ''}</svg>`;

// Replace every <… data-ic="name"> placeholder in the static HTML with its SVG.
function hydrateIcons() {
  document.querySelectorAll('[data-ic]').forEach((el) => {
    // NB: el.className on an SVGElement is an SVGAnimatedString, not a string —
    // use getAttribute so the size class (e.g. "brandmark") is preserved.
    const cls = el.getAttribute('class') || 'ic';
    el.outerHTML = ico(el.getAttribute('data-ic'), cls);
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

function setConn(mode, text) {
  const cls = 'dot' + (mode === 'ok' ? ' ok' : mode === 'warn' ? ' warn' : mode === 'block' ? ' err' : '');
  for (const [dotId, txtId] of [['conn-dot', 'conn-text'], ['side-conn-dot', 'side-conn-text']]) {
    const d = $(dotId); if (d) d.className = cls;
    const t = $(txtId); if (t) t.textContent = text;
  }
}

function showOnly(id) {
  for (const s of ['connect', 'login', 'locked', 'app']) $(s).classList.toggle('hidden', s !== id);
}
function applyConn(h) {
  if (h.mode === 'warn') setConn('warn', h.reason || 'Version drift');
  else if (h.ok) setConn('ok', `Connected · API v${h.serverVersion}`);
  else setConn('block', h.reason || 'Not connected');
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

async function boot() {
  hydrateIcons();
  navActive($('nav-search'), true); navActive($('nav-mailbox'), false);
  const cfg = await api.getServer();
  if (cfg && cfg.host) {
    fillServerForm(cfg);
    const h = await api.connect();   // client already built from the saved server
    applyConn(h);
    if (h.ok) showOnly('login'); else showConnect(h.reason || 'Could not reach the saved server.');
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

  const r = await api.login(username, password, totp);
  if (r.ok) {
    role = r.user.role;
    const ent = await api.entitlement();
    if (!(ent.json && ent.json.entitled)) {
      $('login').classList.add('hidden');
      $('locked').classList.remove('hidden');
      return;
    }
    $('who').textContent = r.user.displayName || r.user.username;
    const rc = $('role-chip'); rc.textContent = role; rc.classList.remove('hidden');
    $('unc-wrap').classList.toggle('hidden', !canDecide());
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    setView('search');
    renderChips();
    refreshBadges();
    runSearch(); // load recent documents at rest instead of an empty form
    return;
  }
  if (r.mfaRequired) {
    $('totp-label').classList.remove('hidden');
    $('totp').classList.remove('hidden');
    $('login-err').textContent = 'Enter your authentication code.';
    $('totp').focus();
    return;
  }
  $('login-err').textContent = r.error || 'Sign in failed.';
});

for (const id of ['u', 'p', 'totp']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !blocked) $('login-btn').click(); });
}

function doLogout() {
  api.logout();
  role = null; recipientsCache = null;
  $('app').classList.add('hidden');
  $('locked').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('p').value = ''; $('totp').value = '';
  $('totp').classList.add('hidden'); $('totp-label').classList.add('hidden');
  $('role-chip').classList.add('hidden');
}
$('logout-btn').addEventListener('click', doLogout);
$('locked-back').addEventListener('click', doLogout);

// ── View switching ─────────────────────────────────────────────────────────────
function setView(view) {
  const search = view === 'search';
  $('view-search').classList.toggle('hidden', !search);
  $('view-mailbox').classList.toggle('hidden', search);
  navActive($('nav-search'), search);
  navActive($('nav-mailbox'), !search);
  $('vh-title').textContent = search ? 'Search' : 'Mailbox';
  $('vh-sub').textContent = search ? 'Find and preview filed documents' : 'Approvals routed to and from you';
  if (!search) loadMailbox();
}
$('nav-search').addEventListener('click', () => setView('search'));
$('nav-mailbox').addEventListener('click', () => setView('mailbox'));

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

function rowEl(d) {
  const el = document.createElement('div'); el.className = 'row';
  el.innerHTML = `
    <div class="r1"><span class="nm">${esc(d.supplier_name || d.original_filename || 'Untitled')}</span>
      <span class="chip ${esc(d.status)}">${esc(d.status)}</span><span class="spacer"></span>${confPip(d.overall_confidence)}</div>
    <div class="r2 mono">${esc(d.reference_number || '—')} · ${esc(d.doc_date || '—')} · ${esc(d.type_name || d.type_slug || '')}</div>`;
  el.addEventListener('click', () => {
    document.querySelectorAll('.row.sel').forEach((n) => n.classList.remove('sel'));
    el.classList.add('sel');
    openDocument(d.id);
  });
  return el;
}

// ── Preview (+ assign control for admin/edit) ────────────────────────────────
function confLevel(c) { return c == null ? '' : c >= 85 ? '' : c >= 60 ? 'warn' : 'err'; }

// A context banner + decision bar shown when the open document is routed TO me.
function decisionBar(route) {
  const wrap = document.createElement('div'); wrap.className = 'wf decision';
  const kind = route.action_required === 'approve' ? 'Approval requested' : 'Acknowledgement requested';
  wrap.innerHTML = `
    <div class="dec-banner">${ico('inbox')}<span>Routed to you by <strong>${esc(route.from_username)}</strong> — ${kind}${route.comment ? ': “' + esc(route.comment) + '”' : ''}</span></div>
    <div class="dec-acts"></div>
    <div class="reason hidden"><input placeholder="Reason for rejecting (required)" /></div>`;
  const acts = wrap.querySelector('.dec-acts');
  const reasonBox = wrap.querySelector('.reason');
  const run = async (p) => {
    const r = await p;
    if (r.status === 401) { doLogout(); return; }
    if (r.status !== 200) { toast((r.json && r.json.error) || 'Action failed.', 'err'); return; }
    toast('Done.');
    await refreshBadges();
    openDocument(route.document_id);
  };
  if (route.action_required === 'acknowledge') {
    acts.appendChild(mkBtn({ label: 'Acknowledge', icon: 'check', variant: 'primary', sm: false, onClick: () => run(api.workflow.resolve(route.id, 'acknowledge', null, route.version)) }));
  } else if (canDecide()) {
    acts.appendChild(mkBtn({ label: 'Approve', icon: 'check', variant: 'primary', sm: false, onClick: () => run(api.workflow.resolve(route.id, 'approve', null, route.version)) }));
    acts.appendChild(mkBtn({ label: 'Reject', icon: 'reject', variant: 'danger', sm: false, onClick: () => reasonBox.classList.toggle('hidden') }));
  }
  reasonBox.appendChild(mkBtn({ label: 'Confirm reject', icon: 'reject', variant: 'danger', onClick: () => {
    const reason = reasonBox.querySelector('input').value.trim();
    if (!reason) { reasonBox.querySelector('input').focus(); return; }
    run(api.workflow.resolve(route.id, 'reject', reason, route.version));
  } }));
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
    <div class="pv-head">${ico('doc')}<h2>${esc(title)}</h2><span class="chip ${esc(doc.status)}">${esc(doc.status)}</span></div>`;
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

  // Top action bar: if this document is routed TO me, lead with the decision bar;
  // otherwise admin/edit get the route-onward form.
  const incoming = route || myOpenRoutes[id];
  if (incoming) {
    wrap.insertBefore(decisionBar(incoming), wrap.querySelector('.fields'));
  } else if (canDecide()) {
    const ac = await assignControl(id); wrap.insertBefore(ac, wrap.querySelector('.fields'));
  }

  const pg = await api.getPages(id);
  const pagesEl = wrap.querySelector('.pages');
  const imgs = (pg.json && pg.json.pages) || [];
  if (!imgs.length) { pagesEl.innerHTML = `<div class="empty">No preview available.</div>`; return; }
  pagesEl.innerHTML = '';
  for (const src of imgs) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
}

async function assignControl(docId) {
  const wrap = document.createElement('div'); wrap.className = 'wf';
  if (!recipientsCache) {
    const rr = await api.workflow.recipients();
    recipientsCache = (rr.json && rr.json.recipients) || [];
  }
  const opts = recipientsCache.map((u) => `<option value="${u.id}">${esc(u.displayName || u.username)} (${esc(u.role)})</option>`).join('');
  wrap.innerHTML = `
    <h3>${ico('assign')}Route for approval / acknowledgement</h3>
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
    <div class="acts"></div>
    <div class="reason hidden"><input placeholder="Reason for rejecting (required)" /></div>`;
  const acts = el.querySelector('.acts');
  const reasonBox = el.querySelector('.reason');
  const open = rt.state === 'pending' || rt.state === 'claimed';

  if (currentBox === 'sent') {
    if (rt.state === 'pending') acts.appendChild(mkBtn({ label: 'Recall', icon: 'recall', variant: 'ghost', onClick: () => act(api.workflow.recall(rt.id, rt.version)) }));
  } else if (currentBox === 'inbox' || currentBox === 'assigned') {
    if (open) {
      if (rt.action_required === 'acknowledge') {
        acts.appendChild(mkBtn({ label: 'Acknowledge', icon: 'check', variant: 'primary', onClick: () => act(api.workflow.resolve(rt.id, 'acknowledge', null, rt.version)) }));
      } else if (canDecide()) {
        acts.appendChild(mkBtn({ label: 'Approve', icon: 'check', variant: 'primary', onClick: () => act(api.workflow.resolve(rt.id, 'approve', null, rt.version)) }));
        acts.appendChild(mkBtn({ label: 'Reject', icon: 'reject', variant: 'danger', onClick: () => reasonBox.classList.toggle('hidden') }));
      }
      if (rt.state === 'pending') acts.appendChild(mkBtn({ label: 'Claim', icon: 'claim', variant: 'secondary', onClick: () => act(api.workflow.claim(rt.id, rt.version)) }));
    }
  }
  const actionable = (currentBox === 'inbox' || currentBox === 'assigned') && open;
  acts.appendChild(mkBtn({ label: 'View doc', icon: 'view', variant: 'ghost', onClick: () => { setView('search'); openDocument(rt.document_id, actionable ? rt : null); } }));

  reasonBox.appendChild(mkBtn({ label: 'Confirm reject', icon: 'reject', variant: 'danger', onClick: () => {
    const reason = reasonBox.querySelector('input').value.trim();
    if (!reason) { reasonBox.querySelector('input').focus(); return; }
    act(api.workflow.resolve(rt.id, 'reject', reason, rt.version));
  } }));
  return el;
}

async function act(promise) {
  const r = await promise;
  if (r.status === 401) { doLogout(); return; }
  if (r.status !== 200) { toast((r.json && r.json.error) || 'Action failed.', 'err'); return; }
  loadMailbox(); refreshBadges();
}

// Per-tab counts (inbox/sent/assigned/completed) + the nav inbox badge.
async function refreshBadges() {
  const boxes = ['inbox', 'sent', 'assigned', 'completed'];
  const open = {};
  await Promise.all(boxes.map(async (box) => {
    try {
      const r = await api.workflow.list(box);
      const routes = (r.json && r.json.routes) || [];
      const n = routes.length;
      const seg = document.querySelector(`.segmented .seg[data-box="${box}"] [data-count]`);
      if (seg) { seg.textContent = String(n); seg.classList.toggle('hidden', n === 0); }
      if (box === 'inbox') { const b = $('inbox-badge'); b.textContent = String(n); b.classList.toggle('hidden', n === 0); }
      // Routes I can act on (addressed to me, still open) → drive the preview decision bar.
      if (box === 'inbox' || box === 'assigned') {
        for (const rt of routes) if (rt.state === 'pending' || rt.state === 'claimed') open[rt.document_id] = rt;
      }
    } catch { /* ignore */ }
  }));
  myOpenRoutes = open;
}

boot();
