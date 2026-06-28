'use strict';
// Results list — section headers + result items.
// Normal mode: click selects → SearchPreview.selectDoc.
// Recycle-bin mode: multi-select (ctrl/cmd + shift), a selection toolbar, and a
// right-click menu to Restore / Delete permanently (role-gated).

function _binSel()   { const s = window.SearchState; if (!s.binSelection) s.binSelection = new Set(); return s.binSelection; }
function _isBin()    { return !!(window.SearchState && window.SearchState.binMode); }
function _canEdit()  { const r = window.SearchState && window.SearchState.role; return r === 'admin' || r === 'edit'; }
function _isAdmin()  { return window.SearchState && window.SearchState.role === 'admin'; }
let _binOrder = [];   // ids in render order (for shift-range)
let _anchorId = null; // last single-clicked id (shift-range anchor)

function renderResults({ confirmed = [], uncommitted = [], deleted = [] }) {
  const scroll = document.getElementById('results-scroll');
  const empty  = document.getElementById('results-empty');
  scroll.querySelectorAll('.section-header, .result-item').forEach(el => el.remove());

  if (confirmed.length + uncommitted.length + deleted.length === 0) {
    empty.textContent = _isBin() ? 'The recycle bin is empty.' : 'No documents found. Try different search terms.';
    empty.style.display = '';
    _binOrder = []; _binSel().clear(); _renderBinToolbar();
    return;
  }
  empty.style.display = 'none';

  if (deleted.length > 0) {
    _binOrder = deleted.map(d => d.id);
    // Drop selections for docs no longer present.
    for (const id of [..._binSel()]) if (!_binOrder.includes(id)) _binSel().delete(id);
    scroll.appendChild(_sectionHeader('RECYCLE BIN', deleted.length));
    deleted.forEach(doc => scroll.appendChild(_resultItem(doc)));
  } else {
    _binOrder = []; _binSel().clear();
  }
  if (confirmed.length > 0) {
    scroll.appendChild(_sectionHeader('CONFIRMED', confirmed.length));
    confirmed.forEach(doc => scroll.appendChild(_resultItem(doc)));
  }
  if (uncommitted.length > 0) {
    scroll.appendChild(_sectionHeader('UNCONFIRMED', uncommitted.length));
    uncommitted.forEach(doc => scroll.appendChild(_resultItem(doc)));
  }

  const { selectedDoc } = window.SearchState;
  if (selectedDoc) {
    const el = scroll.querySelector(`[data-id="${selectedDoc.id}"]`);
    if (el) el.classList.add('active');
  }
  _refreshSelStyles();
  _renderBinToolbar();
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
  el._doc       = doc;

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

  el.addEventListener('click', (e) => {
    if (_isBin()) { _onBinClick(e, doc); }
    else          { window.SearchPreview.selectDoc(doc); }
  });
  el.addEventListener('contextmenu', (e) => {
    if (!_isBin()) return;
    e.preventDefault();
    if (!_binSel().has(doc.id)) { _binSel().clear(); _binSel().add(doc.id); _anchorId = doc.id; _refreshSelStyles(); _renderBinToolbar(); }
    _showBinMenu(e.clientX, e.clientY);
  });
  return el;
}

// ── Recycle-bin selection ─────────────────────────────────────────────────────
function _onBinClick(e, doc) {
  const sel = _binSel();
  if (e.ctrlKey || e.metaKey) {
    if (sel.has(doc.id)) sel.delete(doc.id); else sel.add(doc.id);
    _anchorId = doc.id;
  } else if (e.shiftKey && _anchorId != null) {
    const a = _binOrder.indexOf(_anchorId), b = _binOrder.indexOf(doc.id);
    if (a >= 0 && b >= 0) { sel.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(_binOrder[i]); }
  } else {
    sel.clear(); sel.add(doc.id); _anchorId = doc.id;
    window.SearchPreview.selectDoc(doc);   // single click also previews
  }
  _refreshSelStyles();
  _renderBinToolbar();
}

function _refreshSelStyles() {
  const sel = _binSel();
  document.querySelectorAll('#results-scroll .result-item').forEach(el => {
    el.classList.toggle('selected', _isBin() && sel.has(Number(el.dataset.id)));
  });
}

// Selection toolbar in the results header.
function _renderBinToolbar() {
  const head = document.getElementById('results-head');
  if (!head) return;
  const n = _isBin() ? _binSel().size : 0;
  if (!n) { head.classList.add('hidden'); head.innerHTML = ''; return; }
  head.classList.remove('hidden');
  head.innerHTML = `<span class="bin-count">${n} selected</span>
    <span class="bin-actions">
      ${_canEdit() ? '<button class="btn-sm bin-restore">Restore</button>' : ''}
      ${_isAdmin() ? '<button class="btn-sm danger bin-purge">Delete permanently</button>' : ''}
    </span>`;
  head.querySelector('.bin-restore')?.addEventListener('click', () => _act('restore'));
  head.querySelector('.bin-purge')?.addEventListener('click', () => _act('purge'));
}

// Right-click menu (acts on the current selection).
function _showBinMenu(x, y) {
  _closeBinMenu();
  const n = _binSel().size;
  const menu = document.createElement('div');
  menu.id = 'bin-context-menu';
  menu.innerHTML =
    (_canEdit() ? `<button data-act="restore">Restore${n > 1 ? ` (${n})` : ''}</button>` : '') +
    (_isAdmin() ? `<button data-act="purge" class="danger">Delete permanently${n > 1 ? ` (${n})` : ''}</button>` : '');
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth  - mw - 6) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - mh - 6) + 'px';
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { _closeBinMenu(); _act(b.dataset.act); }));
}
function _closeBinMenu() { document.getElementById('bin-context-menu')?.remove(); }
document.addEventListener('click', _closeBinMenu);
document.addEventListener('scroll', _closeBinMenu, true);

// Apply restore / purge to every selected bin item, then refresh the list.
async function _act(kind) {
  const ids = [..._binSel()];
  if (!ids.length) return;
  if (kind === 'purge' && !confirm(`Permanently delete ${ids.length} document${ids.length > 1 ? 's' : ''} and ${ids.length > 1 ? 'their files' : 'its file'}? This cannot be undone.`)) return;
  const call = kind === 'restore' ? window.docusnap.restoreDocument : window.docusnap.purgeDocument;
  try { for (const id of ids) await call(id); } catch (e) { console.error(`${kind} failed:`, e); }
  _binSel().clear();
  if (window.SearchQuery) window.SearchQuery.doSearch();
}

window.SearchResults = { renderResults };
