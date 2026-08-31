'use strict';
// Results list — section headers + result items.
// Plain click selects + previews. Ctrl/Cmd and Shift multi-select. Right-click (or the
// selection toolbar) acts on the selection: in normal results → Delete (→ recycle bin);
// in the recycle bin → Restore / Delete permanently. All role-gated.

function _sel()      { const s = window.SearchState; if (!s.selection) s.selection = new Set(); return s.selection; }
function _isBin()    { return !!(window.SearchState && window.SearchState.binMode); }
function _canEdit()  { const r = window.SearchState && window.SearchState.role; return r === 'admin' || r === 'edit'; }
function _isAdmin()  { return window.SearchState && window.SearchState.role === 'admin'; }
let _rowOrder = [];   // ids in render order (for shift-range)
let _anchorId = null; // last single-clicked id (shift anchor)
let _docById  = {};   // id → doc (for preview on single click)

function renderResults({ confirmed = [], uncommitted = [], deleted = [] }) {
  const scroll = document.getElementById('results-scroll');
  const empty  = document.getElementById('results-empty');
  // The capped-note MUST be in this removal selector: the clear is selective, so any class
  // rendered into the scroll and left off this list STACKS across searches and goes stale
  // (Chris round 3 — five copies of "Showing the first 200" over an 80-row list).
  scroll.querySelectorAll('.section-header, .result-item, .section-capped-note').forEach(el => el.remove());

  const all = [...deleted, ...confirmed, ...uncommitted];
  _rowOrder = all.map(d => d.id);
  _docById  = {}; all.forEach(d => { _docById[d.id] = d; });
  for (const id of [..._sel()]) if (!_rowOrder.includes(id)) _sel().delete(id);   // drop gone selections

  if (all.length === 0) {
    empty.textContent = _isBin() ? 'The recycle bin is empty.' : 'No documents found. Try different search terms.';
    empty.style.display = '';
    _sel().clear(); _renderToolbar();
    return;
  }
  empty.style.display = 'none';

  if (deleted.length)     { scroll.appendChild(_sectionHeader('RECYCLE BIN', deleted.length)); deleted.forEach(d => scroll.appendChild(_resultItem(d))); }
  if (confirmed.length)   { scroll.appendChild(_sectionHeader('CONFIRMED', confirmed.length));  confirmed.forEach(d => scroll.appendChild(_resultItem(d))); }
  // The server caps each search at 200 rows (database/modules/documents.js search `limit = 200`).
  // Without this line, a user whose home screen says "481 filed this week" sees "CONFIRMED 200"
  // and concludes 281 documents are MISSING (Chris card 3 — "that five minutes is the whole
  // ballgame for a filing app"). Renderer-side heuristic on >= cap by design: threading the cap
  // through the response would break the frozen {confirmed, uncommitted} shape pinned by
  // test_search_contract.js (eric). Known benign edges: exactly-200-total shows the note; a
  // missing-file filter can hide it on a truncated set.
  if (confirmed.length >= _SEARCH_CAP) {
    const cap = document.createElement('div');
    cap.className = 'section-capped-note';
    cap.style.cssText = 'padding:4px 14px 8px; font-size:11px; color:var(--muted);';
    cap.textContent = `Showing the first ${_SEARCH_CAP} matches — narrow the search (a word, a date range, a type) to see the rest.`;
    scroll.appendChild(cap);
  }
  if (uncommitted.length) { scroll.appendChild(_sectionHeader('UNCONFIRMED', uncommitted.length)); uncommitted.forEach(d => scroll.appendChild(_resultItem(d))); }

  const { selectedDoc } = window.SearchState;
  if (selectedDoc) {
    const el = scroll.querySelector(`[data-id="${selectedDoc.id}"]`);
    if (el) el.classList.add('active');
  }
  _refreshSelStyles();
  _renderToolbar();
}

const _SEARCH_CAP = 200;   // mirrors database/modules/documents.js search() `limit = 200`

function _sectionHeader(label, count) {
  const el = document.createElement('div');
  el.className = 'section-header';
  el.innerHTML = `${label} <span class="section-count">${count}</span>`;
  return el;
}

function _resultItem(doc) {
  const el      = document.createElement('div');
  el.className  = 'result-item';
  el.dataset.id = doc.id;

  const name     = doc.stored_filename || doc.original_filename || '—';   // thumb alt; also bin detail
  const supplier = doc.supplier_name || '—';
  const typeName = doc.type_name || '';
  const date     = doc.doc_date || '';
  const ref      = doc.reference_number || '';
  // The row shows the FIELD DATA (reference · date · type) in monospace — not the raw
  // filename (owner 2026-08-03: match the client's row; the filename is noise to a reader).
  // EXCEPT in the recycle bin: a deleted doc often has no supplier/ref, so a row read
  // "— / Sales Order" and the user couldn't tell which document they'd deleted (Chris r2
  // 2026-08-11, finding 8) — the delete dialog names the file, so the bin must too.
  const detailParts = doc.status === 'deleted' ? [name, ref, date, typeName] : [ref, date, typeName];
  const detail   = detailParts.filter(Boolean).map(escHtml).join('  ·  ') || '—';

  let statusBadge = '';
  if      (doc.status === 'confirmed')    statusBadge = `<span class="result-status-badge confirmed">Confirmed</span>`;
  else if (doc.status === 'needs_review') statusBadge = `<span class="result-status-badge review">Needs Review</span>`;
  else if (doc.status === 'deferred')     statusBadge = `<span class="result-status-badge deferred">Deferred</span>`;

  let confPip = '';
  if (window.SearchState.entitled && doc.overall_confidence != null && doc.status !== 'confirmed') {
    const w = Math.max(4, Math.min(100, doc.overall_confidence));
    confPip = `<span class="result-conf ${confLevel(doc.overall_confidence)}" title="Read at ${doc.overall_confidence}% confidence">
      <span class="rc-meter"><i style="width:${w}%"></i></span><span class="rc-val">${doc.overall_confidence}%</span></span>`;
  }
  const footer = confPip ? `<div class="result-footer"><span class="result-footer-right">${confPip}</span></div>` : '';

  el.innerHTML = `
    <div class="result-row">
      <img class="result-thumb" alt="${escHtml(name)}">
      <div class="result-main">
        <div class="result-header">
          <span class="result-supplier" title="${escHtml(supplier)}">${escHtml(supplier)}</span>
          ${statusBadge}
        </div>
        <div class="result-detail" title="${escHtml(detailParts.filter(Boolean).join(' · '))}">${detail}</div>
        ${footer}
      </div>
    </div>
  `;
  if (window.Thumbs) {
    // DE-PATHED: the thumbnail handler resolves the file server-side by docId; rows no
    // longer carry paths at all.
    window.Thumbs.lazy(el.querySelector('.result-thumb'), { id: doc.id });
  }

  el.addEventListener('click', (e) => _onRowClick(e, doc));
  el.addEventListener('contextmenu', (e) => {
    if (!_canEdit()) return;
    e.preventDefault();
    // Right-clicking a row that's NOT already in the selection makes it the SOLE target,
    // and moves the preview/.active highlight to it — so no previously-clicked row stays lit.
    if (!_sel().has(doc.id)) {
      _sel().clear(); _sel().add(doc.id); _anchorId = doc.id;
      window.SearchPreview.selectDoc(doc);
      _refreshSelStyles(); _renderToolbar();
    }
    _showMenu(e.clientX, e.clientY);
  });
  return el;
}

// ── Selection ─────────────────────────────────────────────────────────────────
function _onRowClick(e, doc) {
  const sel = _sel();
  if (e.ctrlKey || e.metaKey) {
    if (sel.has(doc.id)) sel.delete(doc.id); else sel.add(doc.id);
    _anchorId = doc.id;
  } else if (e.shiftKey && _anchorId != null) {
    const a = _rowOrder.indexOf(_anchorId), b = _rowOrder.indexOf(doc.id);
    if (a >= 0 && b >= 0) { sel.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(_rowOrder[i]); }
  } else {
    sel.clear(); sel.add(doc.id); _anchorId = doc.id;
    window.SearchPreview.selectDoc(doc);   // single click previews
  }
  _refreshSelStyles();
  _renderToolbar();
}

function _refreshSelStyles() {
  const sel = _sel();
  document.querySelectorAll('#results-scroll .result-item').forEach(el => {
    el.classList.toggle('selected', sel.has(Number(el.dataset.id)));
  });
}

// Selection toolbar in the results header.
function _renderToolbar() {
  _syncRail();   // keep the vertical rail (nav + tools) in step wherever the toolbar refreshes
  const head = document.getElementById('results-head');
  if (!head) return;
  const n = _sel().size;
  if (!n || !_canEdit()) { head.classList.add('hidden'); head.innerHTML = ''; return; }
  head.classList.remove('hidden');
  const actions = _isBin()
    ? `${_canEdit() ? '<button class="btn-sm bin-restore">Restore</button>' : ''}${_isAdmin() ? '<button class="btn-sm danger bin-purge">Delete permanently</button>' : ''}`
    : `<button class="btn-sm danger bin-delete">Delete</button>`;
  head.innerHTML = `<span class="bin-count">${n} selected</span><span class="bin-actions">${actions}</span>`;
  head.querySelector('.bin-restore')?.addEventListener('click', () => _act('restore'));
  head.querySelector('.bin-purge')?.addEventListener('click', () => _act('purge'));
  head.querySelector('.bin-delete')?.addEventListener('click', () => _act('delete'));
}

// ── Vertical tool rail (mirrors the Review window) ──────────────────────────────
// Keeps the rail's document-cycle arrows + tool buttons in sync with the current
// selection, recycle-bin mode and role. Called wherever the selection changes.
function _syncRail() { _updateRailNav(); _renderRail(); }

// Cycle the SELECTED document up/down through the flat render order — the same list
// the ↑/↓ keys walk. Single-selects + previews the next row and scrolls it into view.
function cycleSelection(dir) {
  if (!_rowOrder.length) return;
  const cur = window.SearchState.selectedDoc;
  const idx = cur ? _rowOrder.indexOf(cur.id) : -1;
  const nextIdx = idx === -1 ? 0 : idx + dir;         // up = -1 (prev), down = +1 (next)
  if (nextIdx < 0 || nextIdx >= _rowOrder.length) return;   // clamp at the ends
  const doc = _docById[_rowOrder[nextIdx]];
  if (!doc) return;
  _sel().clear(); _sel().add(doc.id); _anchorId = doc.id;
  window.SearchPreview.selectDoc(doc);
  _refreshSelStyles();
  const el = document.querySelector(`#results-scroll [data-id="${doc.id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
  _syncRail();
}

// Disable the up arrow on the first row and the down arrow on the last.
function _updateRailNav() {
  const prev = document.getElementById('btn-doc-prev');
  const next = document.getElementById('btn-doc-next');
  if (!prev || !next) return;
  const cur = window.SearchState.selectedDoc;
  const idx = cur ? _rowOrder.indexOf(cur.id) : -1;
  prev.disabled = idx <= 0;
  next.disabled = idx === -1 || idx >= _rowOrder.length - 1;
}

// Reveal the rail's tools by role + recycle-bin mode, and enable them only when
// something is selected. Normal view: Delete + Send-back (admin). Bin view: Restore +
// Delete-permanently (admin). The Recycle-bin toggle shows for anyone who can edit.
function _renderRail() {
  const del = document.getElementById('rail-delete');
  if (!del) return;
  const back = document.getElementById('rail-sendback');
  const restore = document.getElementById('rail-restore');
  const recycle = document.getElementById('rail-recycle');
  const n = _sel().size, canEdit = _canEdit(), isAdmin = _isAdmin(), bin = _isBin();
  if (recycle) { recycle.style.display = canEdit ? '' : 'none'; recycle.classList.toggle('active', bin); }
  if (bin) {
    del.style.display = isAdmin ? '' : 'none'; del.title = 'Delete permanently'; del.disabled = !n;
    if (restore) { restore.style.display = canEdit ? '' : 'none'; restore.disabled = !n; }
    if (back) back.style.display = 'none';
  } else {
    del.style.display = canEdit ? '' : 'none'; del.title = 'Delete (move to recycle bin)'; del.disabled = !n;
    if (restore) restore.style.display = 'none';
    if (back) { back.style.display = isAdmin ? '' : 'none'; back.disabled = !n; }
  }
}

// Wire the rail once (called from renderer after the DOM is ready). Delete dispatches
// to purge in the bin, delete otherwise — mirroring the right-click menu.
function initRail() {
  document.getElementById('btn-doc-prev')?.addEventListener('click', () => cycleSelection(-1));
  document.getElementById('btn-doc-next')?.addEventListener('click', () => cycleSelection(1));
  document.getElementById('rail-delete')  ?.addEventListener('click', () => _act(_isBin() ? 'purge' : 'delete'));
  document.getElementById('rail-restore') ?.addEventListener('click', () => _act('restore'));
  document.getElementById('rail-sendback')?.addEventListener('click', () => _act('sendback'));
  document.getElementById('rail-recycle') ?.addEventListener('click', () => window.SearchQuery.toggleBin());
  _syncRail();
}

// Right-click menu (acts on the current selection).
function _showMenu(x, y) {
  _closeMenu();
  const n = _sel().size;
  const sfx = n > 1 ? ` (${n})` : '';
  const menu = document.createElement('div');
  menu.id = 'bin-context-menu';
  menu.innerHTML = _isBin()
    ? (_canEdit() ? `<button data-act="restore">Restore${sfx}</button>` : '') +
      (_isAdmin() ? `<button data-act="purge" class="danger">Delete permanently${sfx}</button>` : '')
    // Send back to Review (Admin): de-confirms a filed doc so it re-enters the queue. Status-guarded
    // server-side (only currently-confirmed docs move), so a mixed/non-confirmed selection is a no-op.
    : (_isAdmin() ? `<button data-act="sendback">Send back to Review${sfx}</button>` : '') +
      `<button data-act="delete" class="danger">Delete${sfx}</button>`;
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth  - mw - 6) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - mh - 6) + 'px';
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { _closeMenu(); _act(b.dataset.act); }));
}
function _closeMenu() { document.getElementById('bin-context-menu')?.remove(); }
document.addEventListener('click', _closeMenu);
document.addEventListener('scroll', _closeMenu, true);

// Apply the action to every selected row, then refresh.
async function _act(kind) {
  const ids = [..._sel()];
  if (!ids.length) return;
  const noun = ids.length > 1 ? `${ids.length} documents` : 'this document';
  if (kind === 'delete' && !confirm(`Move ${noun} to the recycle bin? You can restore ${ids.length > 1 ? 'them' : 'it'} later.`)) return;
  if (kind === 'purge'  && !confirm(`Permanently delete ${noun} and ${ids.length > 1 ? 'their files' : 'its file'}? This cannot be undone.${await window.SearchState.purgeSuffix()}`)) return;
  if (kind === 'sendback' && !confirm(`Send ${noun} back to the Review queue? ${ids.length > 1 ? 'They stay' : 'It stays'} filed until re-confirmed.`)) return;
  const call = kind === 'delete' ? window.docusnap.deleteDocument
             : kind === 'restore' ? window.docusnap.restoreDocument
             : kind === 'sendback' ? window.docusnap.repairDeconfirm
             : window.docusnap.purgeDocument;
  try { for (const id of ids) await call(id); } catch (e) { console.error(`${kind} failed:`, e); }
  _sel().clear();
  if (window.SearchQuery) window.SearchQuery.doSearch();
}

window.SearchResults = { renderResults, cycleSelection, initRail };
