'use strict';

/**
 * client/renderer/renderer.js
 * Renderer for the detached search client. Talks ONLY through window.scanfinder
 * (preload bridge) — no Node, no token, no direct network. Drives: version
 * handshake banner, login (+ optional TOTP), role-aware search, and secure
 * preview (projected fields + page images served as bytes by the API).
 */

const $ = (id) => document.getElementById(id);
const api = window.scanfinder;

let role = null;
let blocked = false;

function banner(mode, text) {
  const b = $('banner');
  if (!mode) { b.className = 'hidden'; return; }
  b.className = mode; b.textContent = text;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

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

// ── Login ──────────────────────────────────────────────────────────────────────
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
    $('who').textContent = `${r.user.displayName || r.user.username} · ${role}`;
    $('unc-wrap').classList.toggle('hidden', !(role === 'admin' || role === 'edit'));
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
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
  role = null;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('p').value = ''; $('totp').value = '';
  $('totp').classList.add('hidden'); $('totp-label').classList.add('hidden');
});

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
  const root = $('results');
  root.innerHTML = '';
  const addSection = (title, rows) => {
    if (!rows.length) return;
    const h = document.createElement('div'); h.className = 'section-h';
    h.textContent = `${title} (${rows.length})`; root.appendChild(h);
    for (const d of rows) root.appendChild(rowEl(d));
  };
  addSection('Confirmed', confirmed);
  addSection('Uncommitted', uncommitted);
  if (!confirmed.length && !uncommitted.length) {
    root.innerHTML = '<div class="empty">No matching documents.</div>';
  }
}

function rowEl(d) {
  const el = document.createElement('div');
  el.className = 'row';
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

// ── Preview ──────────────────────────────────────────────────────────────────
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

  const pg = await api.getPages(id);
  const pagesEl = prev.querySelector('.pages');
  const imgs = (pg.json && pg.json.pages) || [];
  if (!imgs.length) { pagesEl.innerHTML = '<div class="empty">No preview available.</div>'; return; }
  pagesEl.innerHTML = '';
  for (const src of imgs) { const im = document.createElement('img'); im.src = src; pagesEl.appendChild(im); }
}

boot();
