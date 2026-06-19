'use strict';

/**
 * client/renderer/renderer.js
 * Renderer for the detached search client. Talks ONLY through window.scanfinder
 * (preload bridge) — no Node, no token, no direct network. Two views: Search
 * (search + secure preview, with an Assign control for admin/edit) and Mailbox
 * (inbox/sent/assigned/completed with role-aware approve/reject/acknowledge/recall).
 */

const $ = (id) => document.getElementById(id);
const api = window.scanfinder;

let role = null;
let blocked = false;
let currentBox = 'inbox';
let recipientsCache = null;

function banner(mode, text) {
  const b = $('banner');
  if (!mode) { b.className = 'hidden'; return; }
  b.className = mode; b.textContent = text;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function canDecide() { return role === 'admin' || role === 'edit'; }

async function boot() {
  const cfg = await api.config();
  $('api-target').textContent = cfg.apiUrl;
  const h = await api.connect();
  if (h.mode === 'block') {
    blocked = true;
    banner('block', `Cannot use this server: ${h.reason}. Update the ScanFinder client.`);
    $('login-btn').disabled = true;
  } else if (h.mode === 'warn') {
    banner('warn', `Heads up: ${h.reason}. Some features may not work until the client is updated.`);
  } else {
    banner('ok', `Connected · API v${h.serverVersion}`);
    setTimeout(() => banner(null), 2500);
  }
}

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
    // Add-on entitlement: the server may have authenticated us but not include the
    // detached-client feature in its license. Gate before showing the app.
    const ent = await api.entitlement();
    if (!(ent.json && ent.json.entitled)) {
      $('login').classList.add('hidden');
      $('locked').classList.remove('hidden');
      return;
    }
    $('who').textContent = `${r.user.displayName || r.user.username} · ${role}`;
    $('unc-wrap').classList.toggle('hidden', !canDecide());
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    refreshInboxBadge();
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

$('logout-btn').addEventListener('click', async () => {
  await api.logout();
  role = null; recipientsCache = null;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('p').value = ''; $('totp').value = '';
  $('totp').classList.add('hidden'); $('totp-label').classList.add('hidden');
});

$('locked-back').addEventListener('click', async () => {
  await api.logout();
  role = null;
  $('locked').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('p').value = '';
});

// ── View switching ─────────────────────────────────────────────────────────────
function setView(view) {
  const search = view === 'search';
  $('view-search').classList.toggle('hidden', !search);
  $('view-mailbox').classList.toggle('hidden', search);
  $('nav-search').classList.toggle('active', search);
  $('nav-mailbox').classList.toggle('active', !search);
  if (!search) loadMailbox();
}
$('nav-search').addEventListener('click', () => setView('search'));
$('nav-mailbox').addEventListener('click', () => setView('mailbox'));

// ── Search ───────────────────────────────────────────────────────────────────
$('search-btn').addEventListener('click', runSearch);
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
  if (r.status === 401) { $('logout-btn').click(); return; }
  renderResults((r.json && r.json.confirmed) || [], (r.json && r.json.uncommitted) || []);
}
function renderResults(confirmed, uncommitted) {
  const root = $('results'); root.innerHTML = '';
  const addSection = (title, rows) => {
    if (!rows.length) return;
    const h = document.createElement('div'); h.className = 'section-h';
    h.textContent = `${title} (${rows.length})`; root.appendChild(h);
    for (const d of rows) root.appendChild(rowEl(d));
  };
  addSection('Confirmed', confirmed);
  addSection('Uncommitted', uncommitted);
  if (!confirmed.length && !uncommitted.length) root.innerHTML = '<div class="empty">No matching documents.</div>';
}
function rowEl(d) {
  const el = document.createElement('div'); el.className = 'row';
  el.innerHTML = `
    <div class="r1">${esc(d.supplier_name || d.original_filename || 'Untitled')}
      <span class="chip ${esc(d.status)}">${esc(d.status)}</span></div>
    <div class="r2 mono">${esc(d.reference_number || '—')} · ${esc(d.doc_date || '—')} · ${esc(d.type_name || d.type_slug || '')}</div>`;
  el.addEventListener('click', () => {
    document.querySelectorAll('.row.sel').forEach(n => n.classList.remove('sel'));
    el.classList.add('sel');
    openDocument(d.id);
  });
  return el;
}

// ── Preview (+ assign control for admin/edit) ────────────────────────────────
async function openDocument(id) {
  const prev = $('preview');
  prev.innerHTML = '<div class="empty">Loading…</div>';
  const r = await api.getDocument(id);
  if (r.status === 401) { $('logout-btn').click(); return; }
  if (r.status !== 200 || !r.json) { prev.innerHTML = '<div class="empty">Could not load document.</div>'; return; }
  const doc = r.json;

  const meta = [
    ['Company', doc.supplier_name], ['Reference', doc.reference_number],
    ['Date', doc.doc_date], ['Type', doc.type_name || doc.type_slug],
    ['Status', doc.status], ['Confidence', doc.overall_confidence != null ? `${doc.overall_confidence}%` : null],
  ].filter(([, v]) => v != null && v !== '');

  let html = '<div class="fields">';
  for (const [k, v] of meta) html += `<div class="field"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>`;
  for (const ex of (doc.extractions || [])) {
    html += `<div class="field"><span class="k">${esc(ex.field_key)}</span><span>${esc(ex.display_value || '')}</span></div>`;
    if (ex.validation_note) html += `<div class="note">⚠ ${esc(ex.validation_note)}</div>`;
  }
  html += '</div><div class="pages"><div class="empty">Loading preview…</div></div>';
  prev.innerHTML = html;

  if (canDecide()) prev.appendChild(await assignControl(id));

  const pg = await api.getPages(id);
  const pagesEl = prev.querySelector('.pages');
  const imgs = (pg.json && pg.json.pages) || [];
  if (!imgs.length) { pagesEl.innerHTML = '<div class="empty">No preview available.</div>'; return; }
  pagesEl.innerHTML = '';
  for (const src of imgs) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
}

async function assignControl(docId) {
  const wrap = document.createElement('div'); wrap.className = 'wf';
  if (!recipientsCache) {
    const rr = await api.workflow.recipients();
    recipientsCache = (rr.json && rr.json.recipients) || [];
  }
  const opts = recipientsCache.map(u => `<option value="${u.id}">${esc(u.displayName || u.username)} (${esc(u.role)})</option>`).join('');
  wrap.innerHTML = `
    <h3>Route for approval / acknowledgement</h3>
    <select class="a-to">${opts}</select>
    <select class="a-action"><option value="approve">Approve</option><option value="acknowledge">Acknowledge</option></select>
    <input class="a-comment" placeholder="Note (optional)" />
    <button class="primary a-send">Assign</button>
    <span class="a-msg"></span>`;
  wrap.querySelector('.a-send').addEventListener('click', async () => {
    const toUserId = Number(wrap.querySelector('.a-to').value);
    const action = wrap.querySelector('.a-action').value;
    const comment = wrap.querySelector('.a-comment').value.trim() || undefined;
    const msg = wrap.querySelector('.a-msg');
    if (!toUserId) { msg.className = 'a-msg err'; msg.textContent = 'Pick a recipient.'; return; }
    const res = await api.workflow.assign(docId, toUserId, action, comment);
    if (res.status === 200) { msg.className = 'a-msg ok'; msg.textContent = 'Routed.'; refreshInboxBadge(); }
    else { msg.className = 'a-msg err'; msg.textContent = (res.json && res.json.error) || 'Could not route.'; }
  });
  return wrap;
}

// ── Mailbox ──────────────────────────────────────────────────────────────────
document.querySelectorAll('#view-mailbox .mb-tabs .navbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#view-mailbox .mb-tabs .navbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBox = btn.dataset.box;
    loadMailbox();
  });
});
$('mb-refresh').addEventListener('click', loadMailbox);

async function loadMailbox() {
  const list = $('mb-list'); list.innerHTML = '<div class="empty">Loading…</div>';
  const r = await api.workflow.list(currentBox);
  if (r.status === 401) { $('logout-btn').click(); return; }
  const routes = (r.json && r.json.routes) || [];
  list.innerHTML = '';
  if (!routes.length) { list.innerHTML = '<div class="empty">Nothing here.</div>'; return; }
  for (const rt of routes) list.appendChild(mbRow(rt));
  refreshInboxBadge();
}

function mbRow(rt) {
  const el = document.createElement('div'); el.className = 'mb-row';
  const who = currentBox === 'sent' ? `to ${esc(rt.to_username)}` : `from ${esc(rt.from_username)}`;
  const bits = [
    `${rt.action_required === 'approve' ? 'Approval' : 'Acknowledgement'} request`,
    who, esc(rt.doc_date || ''),
  ].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="r1">${esc(rt.supplier_name || ('Document #' + rt.document_id))}
      <span class="state ${esc(rt.state)}">${esc(rt.state)}</span></div>
    <div class="r2">${bits}${rt.comment ? ' · “' + esc(rt.comment) + '”' : ''}${rt.resolution_comment ? ' · reason: ' + esc(rt.resolution_comment) : ''}</div>
    <div class="acts"></div>
    <div class="reason hidden"><input placeholder="Reason (required)" /> <button class="primary">Confirm reject</button></div>`;
  const acts = el.querySelector('.acts');
  const reasonBox = el.querySelector('.reason');

  const addBtn = (label, fn, primary) => { const b = document.createElement('button'); if (primary) b.className = 'primary'; b.textContent = label; b.addEventListener('click', fn); acts.appendChild(b); };

  const open = rt.state === 'pending' || rt.state === 'claimed';
  if (currentBox === 'sent') {
    if (rt.state === 'pending') addBtn('Recall', () => act(api.workflow.recall(rt.id, rt.version)));
  } else if (currentBox === 'inbox' || currentBox === 'assigned') {
    if (open) {
      if (rt.action_required === 'acknowledge') {
        addBtn('Acknowledge', () => act(api.workflow.resolve(rt.id, 'acknowledge', null, rt.version)), true);
      } else if (canDecide()) {
        addBtn('Approve', () => act(api.workflow.resolve(rt.id, 'approve', null, rt.version)), true);
        addBtn('Reject', () => { reasonBox.classList.toggle('hidden'); });
      }
      if (rt.state === 'pending') addBtn('Claim', () => act(api.workflow.claim(rt.id, rt.version)));
    }
  }
  addBtn('View doc', () => { setView('search'); openDocument(rt.document_id); });

  reasonBox.querySelector('button').addEventListener('click', () => {
    const reason = reasonBox.querySelector('input').value.trim();
    if (!reason) { reasonBox.querySelector('input').focus(); return; }
    act(api.workflow.resolve(rt.id, 'reject', reason, rt.version));
  });
  return el;
}

// Run a workflow action result then refresh the current box.
async function act(promise) {
  const r = await promise;
  if (r.status === 401) { $('logout-btn').click(); return; }
  if (r.status !== 200) { banner('warn', (r.json && r.json.error) || 'Action failed.'); setTimeout(() => banner(null), 3000); }
  loadMailbox();
}

async function refreshInboxBadge() {
  try {
    const r = await api.workflow.list('inbox');
    const n = ((r.json && r.json.routes) || []).length;
    const badge = $('inbox-badge');
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  } catch { /* ignore */ }
}

boot();
