'use strict';
// Preview panel: document image viewer with page navigation + fields sidebar.

// ── Fields sidebar ────────────────────────────────────────────────────────────

function renderPreviewFields(doc) {
  const scroll = document.getElementById('preview-fields-scroll');
  scroll.innerHTML = '';

  // Confidence band (enhanced Search only) — UNCOMMITTED docs only; a confirmed doc is
  // already checked + committed, so a detection % against it would mislead.
  if (window.SearchState.entitled && doc.overall_confidence != null && doc.status !== 'confirmed') {
    const lvl = confLevel(doc.overall_confidence);
    const w   = Math.max(4, Math.min(100, doc.overall_confidence));
    const band = document.createElement('div');
    band.className = `pf-confband ${lvl}`;
    band.innerHTML = `<span class="pf-label">Reading confidence</span>
      <span class="cb-meter"><i style="width:${w}%"></i></span><span class="cb-val">${doc.overall_confidence}%</span>`;
    scroll.appendChild(band);
  }

  _field(scroll, 'Company',   doc.supplier_name);
  _field(scroll, 'Type',      doc.type_name);
  _field(scroll, 'Reference', doc.reference_number);
  _field(scroll, 'Date',      doc.doc_date);
  _field(scroll, 'Status',    doc.status);

  if (Array.isArray(doc.extractions) && doc.extractions.length) {
    // Skip keys surfaced as core fields above; show all others with a value.
    const coreKeys = new Set(['supplier_name', 'invoice_number', 'invoice_date',
                               'po_number', 'po_date', 'sales_order_number', 'order_date']);
    const extras = doc.extractions
      .filter(ex => !coreKeys.has(ex.field_key) && ex.display_value)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    if (extras.length) {
      const div = document.createElement('div');
      div.className = 'pf-divider';
      scroll.appendChild(div);
      for (const ex of extras) _field(scroll, _keyLabel(ex.field_key), ex.display_value, ex.confidence, ex.validation_note);
    }
  }
}

function _field(container, label, value, confidence, note) {
  const row = document.createElement('div');
  row.className = 'pf-row';
  // Per-field confidence tint (enhanced Search only): warn if a validation note,
  // otherwise by confidence level. Basic Search is left byte-for-byte unchanged.
  if (window.SearchState.entitled) {
    const lvl = note ? 'warn' : confLevel(confidence);
    if (lvl) row.classList.add('pf-tint', 'pf-' + lvl);
  }
  const confSpan = confidence != null ? `<span class="pf-conf">${confidence}%</span>` : '';
  row.innerHTML = `
    <span class="pf-label">${escHtml(label)}</span>
    <span class="pf-value${value ? '' : ' empty'}">${escHtml(value || '—')}${confSpan}</span>
    ${window.SearchState.entitled && note ? `<span class="pf-note">⚠ ${escHtml(note)}</span>` : ''}
  `;
  container.appendChild(row);
}

function _keyLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Page navigation ───────────────────────────────────────────────────────────

// The bottom bar carries the zoom controls (always shown while a doc is up) and the
// page controls (`.pn-pages`, shown only for multi-page docs).
function _syncPageNav() {
  const s   = window.SearchState;
  const nav = document.getElementById('page-nav');
  if (!s.currentPages.length) { nav.style.display = 'none'; return; }
  nav.style.display = '';                                    // reverts to the CSS flex row
  const multi = s.currentPages.length > 1;
  document.querySelectorAll('#page-nav .pn-pages').forEach(el => { el.style.display = multi ? '' : 'none'; });
  if (multi) {
    document.getElementById('page-label').textContent = `${s.currentPage + 1} / ${s.currentPages.length}`;
    document.getElementById('btn-page-prev').disabled = s.currentPage === 0;
    document.getElementById('btn-page-next').disabled = s.currentPage === s.currentPages.length - 1;
  }
}

function _showPage(idx) {
  const s = window.SearchState;
  if (idx < 0 || idx >= s.currentPages.length) return;
  s.currentPage = idx;
  document.getElementById('preview-img').src = s.currentPages[idx];
  document.getElementById('preview-img-wrap').style.display = '';   // reverts to the CSS flex
  document.getElementById('preview-img-placeholder').style.display = 'none';
  _syncPageNav();
}

// ── Zoom / pan (mirrors the Review viewer: buttons + wheel zoom, right-drag pan) ─
let previewZoom = 1, panX = 0, panY = 0;
const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 0.25;

function _applyTransform() {
  const wrap = document.getElementById('preview-img-wrap');
  if (wrap) wrap.style.transform = `translate(${panX}px, ${panY}px) scale(${previewZoom})`;
  const lvl = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(previewZoom * 100) + '%';
}
function setPreviewZoom(z) { previewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); _applyTransform(); }
function resetPreviewView() { previewZoom = 1; panX = 0; panY = 0; _applyTransform(); }

function initPageNav() {
  document.getElementById('btn-page-prev').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage - 1));
  document.getElementById('btn-page-next').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage + 1));

  document.getElementById('btn-zoom-in') ?.addEventListener('click', () => setPreviewZoom(previewZoom + ZOOM_STEP));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => setPreviewZoom(previewZoom - ZOOM_STEP));
  document.getElementById('btn-zoom-reset')?.addEventListener('click', resetPreviewView);

  const area   = document.getElementById('preview-img-area');
  const hasDoc = () => window.SearchState.currentPages.length > 0;
  // Suppress the context menu (so right-drag can pan) + block native image dragging.
  area.addEventListener('contextmenu', (e) => { if (hasDoc()) e.preventDefault(); });
  area.addEventListener('dragstart',   (e) => e.preventDefault());
  // Scroll-wheel zoom (same step as the +/− buttons).
  area.addEventListener('wheel', (e) => {
    if (!hasDoc()) return;
    e.preventDefault();
    setPreviewZoom(previewZoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });
  // Right-click drag pans (left-click is left untouched).
  let panStart = null;
  area.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || !hasDoc()) return;
    panStart = { x: e.clientX, y: e.clientY, panX, panY };
    area.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!panStart) return;
    panX = panStart.panX + (e.clientX - panStart.x);
    panY = panStart.panY + (e.clientY - panStart.y);
    _applyTransform();
  });
  window.addEventListener('mouseup', () => { if (panStart) { panStart = null; area.style.cursor = ''; } });
}

// ── Document selection ────────────────────────────────────────────────────────

async function selectDoc(doc) {
  const s = window.SearchState;
  s.selectedDoc = doc;
  const mine = doc;   // stale-selection guard: a newer click reassigns s.selectedDoc, so a
                      // late-resolving fetch for THIS doc must not clobber the newer render.

  document.querySelectorAll('.result-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === doc.id));

  document.getElementById('preview-empty').style.display = 'none';
  document.getElementById('preview-doc').style.display   = '';

  const wrap = document.getElementById('preview-img-wrap');
  const ph   = document.getElementById('preview-img-placeholder');
  wrap.style.display = 'none';
  ph.style.display   = '';
  ph.innerHTML       = '<div class="spinner"></div>';
  resetPreviewView();                        // each new document opens at 100%, un-panned

  // The fetch sequence is wrapped so ANY failure (a missing IPC handler after a stale-main
  // update, a DB hiccup, the doc deleted mid-click, an IPC error) shows an honest state
  // instead of leaving the spinner forever — the silent-failure class Chris keeps catching.
  try {
    const full = await window.docusnap.getDocumentDetail(doc.id);   // PROJECTED — no paths/ocr_text (Document-detail DTO)
    if (s.selectedDoc !== mine) return;   // a newer selection now owns the preview pane
    // `full` (getWithExtractions → getById) carries the extractions but NOT type_name (no
    // join to document_types), while the search-result `doc` DOES — so merge, keeping doc's
    // type_name/type_slug (otherwise the preview "Type" always shows "-").
    renderPreviewFields({ ...doc, ...(full || {}) });
    window.SearchActions.renderActions(doc);

    // DE-PATHED (owner 2026-08-02): rows no longer carry paths; the pages handler always
    // resolved server-side from the doc row anyway (client args were decorative), so fetch
    // by docId alone — an unresolvable file simply yields [].
    s.currentPages = await window.docusnap.getDocumentPages(doc.id, null, null);
    if (s.selectedDoc !== mine) return;
    s.currentPage = 0;

    if (s.currentPages.length > 0) {
      _showPage(0);
    } else {
      ph.style.display = '';
      ph.innerHTML = 'No preview available';
      document.getElementById('page-nav').style.display = 'none';
    }
  } catch (err) {
    if (s.selectedDoc !== mine) return;   // don't overwrite a newer selection's state
    _showPreviewLoadError(ph, doc, err);
  }
}

// Honest, recoverable failure state in place of the eternal spinner. A missing IPC handler
// is the stale-main class (main-process code updated, app not yet restarted) — say so
// plainly; everything else gets a generic retry. Always falls back to the generic message
// so a changed Electron error string can never reintroduce a blank/misleading pane.
function _showPreviewLoadError(ph, doc, err) {
  const msg = String((err && err.message) || err || '');
  const staleMain = /No handler registered/i.test(msg);
  const title  = staleMain ? 'The app was updated — restart to finish'
                           : "Couldn't load this document";
  const detail = staleMain ? 'Close and reopen Scan Finder to load the latest update.'
                           : (msg || 'Try again, or reopen Search.');
  ph.style.display = '';
  ph.innerHTML = `<div class="pv-load-error">
      <div class="pe-title">${escHtml(title)}</div>
      <div class="pe-detail">${escHtml(detail)}</div>
      <button type="button" class="pe-retry">Try again</button>
    </div>`;
  document.getElementById('preview-img-wrap').style.display = 'none';
  document.getElementById('page-nav').style.display = 'none';
  const retry = ph.querySelector('.pe-retry');
  if (retry) retry.addEventListener('click', () => selectDoc(doc));
}

window.SearchPreview = { selectDoc, renderPreviewFields, initPageNav };
