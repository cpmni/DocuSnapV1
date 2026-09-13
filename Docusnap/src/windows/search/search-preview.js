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

  // Fields render as one bordered TABLE — label left, value right (owner 2026-08-03: match
  // the client's tabular field panel). The .pf-fields container gives the table its frame; the
  // per-row layout is CSS. Core identity/role fields first, then any extra extracted fields.
  const fields = document.createElement('div');
  fields.className = 'pf-fields';
  _field(fields, 'Company',   doc.supplier_name);
  _field(fields, 'Type',      doc.type_name);
  _field(fields, 'Reference', doc.reference_number);
  _field(fields, 'Date',      doc.doc_date);
  _field(fields, 'Status',    doc.status);

  if (Array.isArray(doc.extractions) && doc.extractions.length) {
    // Skip keys surfaced as core fields above; show all others with a value.
    const coreKeys = new Set(['supplier_name', 'invoice_number', 'invoice_date',
                               'po_number', 'po_date', 'sales_order_number', 'order_date']);
    const extras = doc.extractions
      .filter(ex => !coreKeys.has(ex.field_key) && ex.display_value)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    for (const ex of extras) _field(fields, _keyLabel(ex.field_key), ex.display_value, ex.confidence, ex.validation_note);
  }
  scroll.appendChild(fields);
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

// ── Zoom / scroll / pan (owner control model 2026-09-13) ───────────────────────
//   • mouse WHEEL  = scroll the document up/down (native overflow scroll — NOT zoom)
//   • RIGHT-drag   = pan (grab-scroll the pane; left-click untouched)
//   • ZOOM         = the +/−/Reset buttons ONLY
// Zoom is LAYOUT-based (we set the image WIDTH), not a CSS transform: a transform doesn't change the
// element's layout box, so the scroll container never gains anything to scroll. Sizing the image so it
// truly overflows the pane is what lets the wheel scroll it and the right-drag pan it.
let previewZoom = 1;
const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 0.25;
// Render the preview at ~216 DPI (scale 3). The pane rasterises the page and CSS-zooms it, so more source
// pixels = crisper zoom — but scale 6 (432 DPI) rendered EVERY page up front (~2.5s + 15 MB over IPC for a
// 5-page doc = a slow open). 216 DPI is crisp on screen and to ~2x zoom; it only softens near max zoom, an
// acceptable trade for a ~4x faster open (fine detail is a click away via "open externally"). If deep-zoom
// sharpness is needed later, re-render the CURRENT page on zoom-in rather than raising this for all pages.
const SEARCH_RENDER_SCALE = 3;

// Size the page image to (fit-width × zoom). At zoom 1 this equals the old max-width:100% fit; above 1 the
// image exceeds the pane so the pane scrolls. Called on every image load and on each zoom change.
function _applyZoom() {
  const img  = document.getElementById('preview-img');
  const area = document.getElementById('preview-img-area');
  const lvl  = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(previewZoom * 100) + '%';
  if (!img || !area || !img.naturalWidth) return;
  const areaW = Math.max(50, area.clientWidth - 32);      // minus the 16px padding each side
  const fitW  = Math.min(img.naturalWidth, areaW);
  img.style.maxWidth = 'none';                            // override the CSS max-width:100% so it can grow
  img.style.width    = Math.round(fitW * previewZoom) + 'px';
}
function setPreviewZoom(z) {
  const area = document.getElementById('preview-img-area');
  // Keep the pane's centre point stable across a zoom step (so + / − feels anchored, not jumpy).
  let ax = 0.5, ay = 0.5;
  if (area && area.scrollWidth > area.clientWidth)  ax = (area.scrollLeft + area.clientWidth  / 2) / area.scrollWidth;
  if (area && area.scrollHeight > area.clientHeight) ay = (area.scrollTop  + area.clientHeight / 2) / area.scrollHeight;
  previewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  _applyZoom();
  if (area) {
    if (area.scrollWidth  > area.clientWidth)  area.scrollLeft = ax * area.scrollWidth  - area.clientWidth  / 2;
    if (area.scrollHeight > area.clientHeight) area.scrollTop  = ay * area.scrollHeight - area.clientHeight / 2;
  }
}
function resetPreviewView() {
  previewZoom = 1;
  _applyZoom();
  const area = document.getElementById('preview-img-area');
  if (area) { area.scrollLeft = 0; area.scrollTop = 0; }
}

function initPageNav() {
  document.getElementById('btn-page-prev').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage - 1));
  document.getElementById('btn-page-next').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage + 1));

  document.getElementById('btn-zoom-in') ?.addEventListener('click', () => setPreviewZoom(previewZoom + ZOOM_STEP));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => setPreviewZoom(previewZoom - ZOOM_STEP));
  document.getElementById('btn-zoom-reset')?.addEventListener('click', resetPreviewView);

  const img  = document.getElementById('preview-img');
  const area = document.getElementById('preview-img-area');
  const hasDoc = () => window.SearchState.currentPages.length > 0;
  // Re-fit whenever a page image loads (natural size known only then) — preserves the current zoom.
  if (img) img.addEventListener('load', _applyZoom);
  // The wheel now scrolls natively (no handler) — we only block native image drag + the context menu so
  // right-drag can pan without popping a menu.
  area.addEventListener('contextmenu', (e) => { if (hasDoc()) e.preventDefault(); });
  area.addEventListener('dragstart',   (e) => e.preventDefault());
  // Right-click drag = grab-scroll (pan). Drag the page the way your hand pushes it.
  let panStart = null;
  area.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || !hasDoc()) return;
    panStart = { x: e.clientX, y: e.clientY, sl: area.scrollLeft, st: area.scrollTop };
    area.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!panStart) return;
    area.scrollLeft = panStart.sl - (e.clientX - panStart.x);
    area.scrollTop  = panStart.st - (e.clientY - panStart.y);
  });
  window.addEventListener('mouseup', () => { if (panStart) { panStart = null; area.style.cursor = ''; } });
}

// ── Document selection ────────────────────────────────────────────────────────

async function selectDoc(doc) {
  const s = window.SearchState;
  s.selectedDoc = doc;
  let mine = doc;     // stale-selection guard: a newer click reassigns s.selectedDoc, so a
                      // late-resolving fetch for THIS doc must not clobber the newer render.
                      // (let, not const: after the fetch we upgrade both s.selectedDoc AND mine to
                      // the merged doc in lockstep, so the guard still fires on a genuinely newer click.)

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
    // `full` (getDocumentDetail) now carries type_name (previewService resolves it) alongside the
    // extractions; the passed `doc` may be a BARE {id} from a mailbox/workflow row. Merge ONCE and use
    // it for ALL sub-renders — passing the bare doc to renderActions/onDocShown was why the mailbox
    // preview showed status "Unknown" and subtitle "Document —" (Chris r2 vet item A).
    const merged = { ...doc, ...(full || {}) };
    s.selectedDoc = merged;   // upgrade the live selection AND the guard token together, so a
    mine = merged;            // genuinely newer click still trips the `!== mine` stale guards below.
    renderPreviewFields(merged);
    window.SearchActions.renderActions(merged);

    // DE-PATHED (owner 2026-08-02): rows no longer carry paths; the pages handler always
    // resolved server-side from the doc row anyway (client args were decorative), so fetch
    // by docId alone — an unresolvable file simply yields [].
    s.currentPages = await window.docusnap.getDocumentPages(doc.id, null, null, SEARCH_RENDER_SCALE);
    if (s.selectedDoc !== mine) return;
    s.currentPage = 0;

    if (s.currentPages.length > 0) {
      _showPage(0);
    } else {
      ph.style.display = '';
      ph.innerHTML = 'No preview available';
      document.getElementById('page-nav').style.display = 'none';
    }
    // Stamped/original toggle (Workflow+Stamping redesign): shows when the doc carries ≥1 stamp and
    // defaults the preview to the stamped version. Non-fatal + staleness-guarded inside.
    if (window.SearchStamp) { try { window.SearchStamp.onDocShown(merged); } catch (e) { console.error('stamp toggle:', e); } }
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
