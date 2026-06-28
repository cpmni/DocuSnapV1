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
  scroll.querySelectorAll('.section-header, .result-item').forEach(el => el.remove());

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
  if (uncommitted.length) { scroll.appendChild(_sectionHeader('UNCONFIRMED', uncommitted.length)); uncommitted.forEach(d => scroll.appendChild(_resultItem(d))); }

  const { selectedDoc } = window.SearchState;
  if (selectedDoc) {
    const el = scroll.querySelector(`[data-id="${selectedDoc.id}"]`);
    if (el) el.classList.add('active');
  }
  _refreshSelStyles();
  _renderToolbar();
}

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

  const name     = doc.stored_filename || doc.original_filename || '—';
  const supplier = doc.supplier_name || '—';
  const typeName = doc.type_name || '';
  const date     = doc.doc_date || '';

  let statusBadge = '';
  if      (doc.status === 'needs_review') statusBadge = `<span class="result-status-badge review">Needs Review</span>`;
  else if (doc.status === 'deferred')     statusBadge = `<span class="result-status-badge deferred">Deferred</span>`;

  let confPip = '';
  if (window.SearchState.entitled && doc.overall_confidence != null && doc.status !== 'confirmed') {
    const w = Math.max(4, Math.min(100, doc.overall_confidence));
    confPip = `<span class="result-conf ${confLevel(doc.overall_confidence)}" title="Extraction confidence ${doc.overall_confidence}%">
      <span class="rc-meter"><i style="width:${w}%"></i></span><span class="rc-val">${doc.overall_confidence}%</span></span>`;
  }

  el.innerHTML = `
    <div class="result-row">
      <img class="result-thumb" alt="">
      <div class="result-main">
        <div class="result-header">
          <span class="result-supplier" title="${escHtml(supplier)}">${escHtml(supplier)}</span>
          ${typeName ? `<span class="result-type-badge">${escHtml(typeName)}</span>` : ''}
        </div>
        <div class="result-filename" title="${escHtml(name)}">${escHtml(name)}</div>
        <div class="result-footer">
          <span class="result-date">${escHtml(date)}</span>
          <span class="result-footer-right">${statusBadge}${confPip}</span>
        </div>
      </div>
    </div>
  `;
  if (window.Thumbs && window.SearchPreview && window.SearchPreview.fileArgs) {
    const { folderPath, filename } = window.SearchPreview.fileArgs(doc);
    window.Thumbs.lazy(el.querySelector('.result-thumb'),
      { id: doc.id, folder_path: folderPath, original_filename: filename });
  }

  el.addEventListener('click', (e) => _onRowClick(e, doc));
  el.addEventListener('contextmenu', (e) => {
    if (!_canEdit()) return;
    e.preventDefault();
    if (!_sel().has(doc.id)) { _sel().clear(); _sel().add(doc.id); _anchorId = doc.id; _refreshSelStyles(); _renderToolbar(); }
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
    : `<button data-act="delete" class="danger">Delete${sfx}</button>`;
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
  if (kind === 'purge'  && !confirm(`Permanently delete ${noun} and ${ids.length > 1 ? 'their files' : 'its file'}? This cannot be undone.`)) return;
  const call = kind === 'delete' ? window.docusnap.deleteDocument
             : kind === 'restore' ? window.docusnap.restoreDocument
             : window.docusnap.purgeDocument;
  try { for (const id of ids) await call(id); } catch (e) { console.error(`${kind} failed:`, e); }
  _sel().clear();
  if (window.SearchQuery) window.SearchQuery.doSearch();
}

window.SearchResults = { renderResults };
