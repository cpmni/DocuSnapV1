'use strict';
/*
 * src/windows/split/renderer.js — the graphical page-split popout (2026-09-20).
 * Click the first page of each sub-document (boundary), optionally drop blank/unwanted pages, then Create.
 * The window PULLS its docId once (get-split-target) and sends marks+removed to the hardened
 * split-pdf-marks IPC; ALL validation, the delete guard and the recoverable move-aside live in main.
 * Page numbers shown are 1-based; the render index is (pageNo - 1) — one helper keeps them in step.
 */
const D = window.docusnap;
const $ = (id) => document.getElementById(id);
const renderIndex = (pageNo) => pageNo - 1;   // 1-based page label ↔ 0-based render index (Oracle C4)

let docId = null, N = 0;
const boundaries = new Set();   // 1-based pages that START a new document (page 1 is always implicit)
const removed = new Set();      // 1-based pages to drop
let blanks = {};                // page → {verdict, coverage_pct, occupied_cells}
const loaded = new Set();       // pages whose thumbnail is loaded
const requested = new Set();    // pages whose thumbnail render was requested
let io = null;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4200); }

// ── group mirror (display only — main re-derives authoritatively) ────────────────
function computeGroups() {
  const bs = [...new Set([1, ...boundaries])].filter(p => p >= 1 && p <= N).sort((a, b) => a - b);
  const groups = [];
  for (let i = 0; i < bs.length; i++) {
    const lo = bs[i], hi = (i + 1 < bs.length) ? bs[i + 1] - 1 : N;
    const pages = [];
    for (let p = lo; p <= hi; p++) if (!removed.has(p)) pages.push(p);
    if (pages.length) groups.push(pages);
  }
  return groups;
}
function compress(pages) {
  const out = []; let i = 0;
  while (i < pages.length) {
    let j = i; while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

function recompute() {
  const groups = computeGroups();
  const outputPages = N - [...removed].filter(p => p >= 1 && p <= N).length;
  const allowed = groups.length >= 1 && outputPages >= 1 && (groups.length >= 2 || outputPages < N);
  // paint ribbons + card state
  for (let p = 1; p <= N; p++) {
    const card = $(`card-${p}`); if (!card) continue;
    card.classList.toggle('boundary', p === 1 || boundaries.has(p));
    card.classList.toggle('removed', removed.has(p));
  }
  // number each document on its first surviving page
  document.querySelectorAll('.ribbon').forEach(r => (r.textContent = ''));
  groups.forEach((g, k) => {
    const first = g[0];
    const card = $(`card-${first}`);
    if (card) { const rb = card.querySelector('.ribbon'); if (rb) rb.textContent = `Document ${k + 1} starts here`; }
  });
  // summary
  const sum = $('summary');
  if (!allowed) {
    sum.innerHTML = removed.size >= N
      ? 'Every page is marked for removal.<small>Un-remove at least one page.</small>'
      : `This will create 1 document<small>Click the first page of each new document, or drop a blank page, to make a change.</small>`;
  } else {
    const list = groups.map(g => compress(g)).join('  ·  ');
    const rem = removed.size ? ` · ${removed.size} page${removed.size > 1 ? 's' : ''} removed` : '';
    sum.innerHTML = `This will create ${groups.length} document${groups.length > 1 ? 's' : ''}${rem}<small>${list}</small>`;
  }
  $('btn-create').disabled = !allowed;
}

// ── blank flagging (advisory highlight; never auto-removes — Oracle C-d) ─────────
function tierFor(b, stop) {
  if (!b || stop === 'off') return 'none';
  const cov = b.coverage_pct, occ = b.occupied_cells;
  if (stop === 'standard') {
    if (cov < 0.20 && occ <= 8) return 'very';
    if (cov < 0.5 && occ <= 16) return 'maybe';
    return 'none';
  }
  // conservative (default)
  if (cov < 0.05 && occ <= 2) return 'very';
  if (cov < 0.20 && occ <= 8) return 'maybe';
  return 'none';
}
function applyBlankFlags() {
  const stop = $('blank-stop').value;
  let veryCount = 0;
  for (let p = 1; p <= N; p++) {
    const card = $(`card-${p}`); if (!card) continue;
    const tier = tierFor(blanks[p], stop);
    card.classList.toggle('blank-very', tier === 'very');
    card.classList.toggle('blank-maybe', tier === 'maybe');
    const flag = card.querySelector('.blankflag');
    if (flag) flag.textContent = tier === 'very' ? 'Looks blank' : tier === 'maybe' ? 'Might be blank' : '';
    if (tier === 'very') veryCount++;
  }
  const btn = $('btn-remove-blanks');
  if (btn) { btn.style.display = veryCount ? '' : 'none'; btn.textContent = `Remove ${veryCount} blank page${veryCount > 1 ? 's' : ''}`; }
}

// ── thumbnails: lazy + batched via get-document-page-info ─────────────────────────
async function loadBatch(startPage) {
  const want = [];
  for (let p = startPage; p <= N && want.length < 9; p++) {
    if (!loaded.has(p) && !requested.has(p)) { want.push(p); requested.add(p); }
  }
  if (!want.length) return;
  const first = want[0];
  const also = want.slice(1).map(renderIndex);
  try {
    const res = await D.getDocumentPageInfo(docId, renderIndex(first), also, 0.55, 'jpeg');
    const imgs = (res && res.images) || {};
    for (const p of want) {
      const uri = imgs[String(renderIndex(p))];
      const holder = $(`thumb-${p}`);
      if (uri && holder) { holder.innerHTML = `<img src="${uri}" alt="Page ${p}">`; loaded.add(p); }
      else { requested.delete(p); }   // allow a retry on next scroll
    }
  } catch { for (const p of want) requested.delete(p); }
}

function buildGrid() {
  const grid = $('grid'); grid.innerHTML = '';
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { const p = Number(e.target.dataset.page); loadBatch(p); }
  }, { root: null, rootMargin: '300px' });
  for (let p = 1; p <= N; p++) {
    const card = document.createElement('div');
    card.className = 'card'; card.id = `card-${p}`; card.dataset.page = String(p);
    card.innerHTML =
      `<div class="ribbon"></div>` +
      `<button class="corner btn-peek" title="Look closely">🔍</button>` +
      `<button class="corner btn-remove" title="Remove this page">✕</button>` +
      `<span class="blankflag"></span>` +
      `<div class="thumb" id="thumb-${p}"><span class="ph">Page ${p}</span></div>` +
      `<div class="pnum">Page ${p}</div>`;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-peek')) { openPreview(p); return; }
      if (ev.target.closest('.btn-remove')) { toggleRemove(p); return; }
      toggleBoundary(p);
    });
    grid.appendChild(card);
    io.observe(card);
  }
}

function toggleBoundary(p) {
  if (p === 1) { toast('Page 1 always starts the first document.'); return; }
  if (boundaries.has(p)) boundaries.delete(p); else boundaries.add(p);
  const sel = $('split-pattern'); if (sel) sel.value = 'custom';   // a hand-adjust is no longer a pure pattern
  recompute();
}
function toggleRemove(p) {
  if (removed.has(p)) removed.delete(p); else removed.add(p);
  recompute();
}

// ── split-pattern presets (restores the old "every page / every N pages" options) ──────────────────
// A preset just SEEDS the boundary marks (page 1 is always the first document); the grid then highlights
// where each new document starts, exactly as if the user had clicked those first pages. They can tweak by
// clicking (which flips the dropdown back to Custom). Everything still flows through the marks→groups→split
// path — no separate backend mode.
function applyPattern() {
  const mode = $('split-pattern').value;
  const nBox = $('every-n');
  if (nBox) nBox.style.display = mode === 'everyn' ? '' : 'none';
  if (mode === 'custom') { recompute(); return; }   // manual — leave the current marks alone
  boundaries.clear();
  if (mode === 'each') {
    for (let p = 2; p <= N; p++) boundaries.add(p);   // every page starts its own document
  } else if (mode === 'everyn') {
    const n = Math.max(2, parseInt(nBox && nBox.value, 10) || 2);
    for (let p = 1 + n; p <= N; p += n) boundaries.add(p);   // groups of n: boundaries at 1, 1+n, 1+2n…
  }
  recompute();
}

// ── preview lightbox ─────────────────────────────────────────────────────────────
let previewPage = 1;
async function openPreview(p) {
  previewPage = p;
  $('lightbox').classList.add('open');
  await paintPreview();
}
async function paintPreview() {
  const p = previewPage;
  $('lb-label').textContent = `Page ${p} of ${N}`;
  $('lb-boundary').textContent = p === 1 ? 'Page 1 starts document 1' : (boundaries.has(p) ? 'Don’t start a new document here' : 'Start a new document here');
  $('lb-boundary').disabled = (p === 1);
  $('lb-remove').textContent = removed.has(p) ? 'Keep this page' : 'Remove this page';
  $('lb-prev').disabled = p <= 1; $('lb-next').disabled = p >= N;
  try {
    const res = await D.getDocumentPageInfo(docId, renderIndex(p), [], 1.6, 'jpeg');
    const uri = res && res.images && res.images[String(renderIndex(p))];
    if (uri) $('lb-img').src = uri;
  } catch {}
}
function closePreview() { $('lightbox').classList.remove('open'); }

// ── create flow ────────────────────────────────────────────────────────────────
function askCreate() {
  const groups = computeGroups();
  const rem = removed.size;
  $('confirm-title').textContent = `Create ${groups.length} document${groups.length > 1 ? 's' : ''}?`;
  $('confirm-body').innerHTML =
    `This makes <b>${groups.length}</b> document${groups.length > 1 ? 's' : ''} from these ${N} pages` +
    (rem ? `, removing <b>${rem}</b> page${rem > 1 ? 's' : ''}` : '') + `.<br><br>` +
    `Nothing is deleted: your original combined scan is moved into a <b>.sf_separated_originals</b> folder ` +
    `beside where it came from, and the new documents go to Review to be checked.`;
  $('confirm').classList.add('open');
}
async function doCreate() {
  $('confirm').classList.remove('open');
  $('btn-create').disabled = true;
  try {
    const res = await D.splitPdfMarks({ docId, marks: [...boundaries], removed: [...removed] });
    if (res && res.success) { D.windowClose(); return; }
    toast((res && res.error) || 'Could not split the document.');
    recompute();
  } catch (e) { toast('Could not split the document.'); recompute(); }
}

// ── init ─────────────────────────────────────────────────────────────────────────
async function init() {
  boundaries.clear(); removed.clear(); loaded.clear(); requested.clear(); blanks = {};
  { const sp = $('split-pattern'); if (sp) sp.value = 'custom'; const en = $('every-n'); if (en) en.style.display = 'none'; }
  docId = await D.getSplitTarget();
  if (docId == null) { $('status').textContent = 'No document to split.'; return; }
  N = await D.getDocumentPageCount(docId);
  if (!N || N < 2) {
    $('grid').innerHTML = `<div class="status">This document is only one page — there’s nothing to split.</div>`;
    $('summary').textContent = ''; $('btn-create').disabled = true; return;
  }
  buildGrid();
  recompute();
  loadBatch(1);
  // blank scan (advisory) — flags appear when ready; never blocks
  D.blankScan(docId).then((r) => {
    if (r && Array.isArray(r.blanks)) { for (const b of r.blanks) blanks[b.page] = b; applyBlankFlags(); }
  }).catch(() => {});
}

// wiring
window.addEventListener('DOMContentLoaded', () => {
  $('win-min').addEventListener('click', () => D.windowMinimise());
  $('win-close').addEventListener('click', () => D.windowClose());
  $('btn-cancel').addEventListener('click', () => D.windowClose());
  $('btn-create').addEventListener('click', askCreate);
  $('confirm-cancel').addEventListener('click', () => $('confirm').classList.remove('open'));
  $('confirm-ok').addEventListener('click', doCreate);
  $('blank-stop').addEventListener('change', applyBlankFlags);
  $('split-pattern').addEventListener('change', applyPattern);
  $('every-n').addEventListener('input', () => { if ($('split-pattern').value === 'everyn') applyPattern(); });
  $('lb-close').addEventListener('click', closePreview);
  $('lb-prev').addEventListener('click', async () => { if (previewPage > 1) { previewPage--; await paintPreview(); } });
  $('lb-next').addEventListener('click', async () => { if (previewPage < N) { previewPage++; await paintPreview(); } });
  $('lb-boundary').addEventListener('click', () => { toggleBoundary(previewPage); paintPreview(); });
  $('lb-remove').addEventListener('click', () => { toggleRemove(previewPage); paintPreview(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('lightbox').classList.contains('open')) closePreview(); else if ($('confirm').classList.contains('open')) $('confirm').classList.remove('open'); } });
  // a "Remove N blank pages" convenience — explicit click, result visible before Create (Oracle C-d)
  const rb = document.createElement('button');
  rb.className = 'btn'; rb.id = 'btn-remove-blanks'; rb.style.display = 'none';
  rb.addEventListener('click', () => {
    const stop = $('blank-stop').value;
    for (let p = 1; p <= N; p++) if (tierFor(blanks[p], stop) === 'very') removed.add(p);
    recompute();
  });
  $('btn-cancel').parentNode.insertBefore(rb, $('btn-cancel'));
  init();
  if (D.onSplitLoadDoc) D.onSplitLoadDoc(() => init());
});
