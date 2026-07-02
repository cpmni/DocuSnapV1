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
    band.innerHTML = `<span class="pf-label">Extraction confidence</span>
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

function _syncPageNav() {
  const s   = window.SearchState;
  const nav = document.getElementById('page-nav');
  if (s.currentPages.length <= 1) { nav.style.display = 'none'; return; }
  nav.style.display = '';
  document.getElementById('page-label').textContent =
    `${s.currentPage + 1} / ${s.currentPages.length}`;
  document.getElementById('btn-page-prev').disabled = s.currentPage === 0;
  document.getElementById('btn-page-next').disabled = s.currentPage === s.currentPages.length - 1;
}

function _showPage(idx) {
  const s = window.SearchState;
  if (idx < 0 || idx >= s.currentPages.length) return;
  s.currentPage = idx;
  const img = document.getElementById('preview-img');
  img.src          = s.currentPages[idx];
  img.style.display = 'block';
  document.getElementById('preview-img-placeholder').style.display = 'none';
  _syncPageNav();
}

function initPageNav() {
  document.getElementById('btn-page-prev').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage - 1));
  document.getElementById('btn-page-next').addEventListener('click', () =>
    _showPage(window.SearchState.currentPage + 1));
}

// ── Document selection ────────────────────────────────────────────────────────

async function selectDoc(doc) {
  const s = window.SearchState;
  s.selectedDoc = doc;

  document.querySelectorAll('.result-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === doc.id));

  document.getElementById('preview-empty').style.display = 'none';
  document.getElementById('preview-doc').style.display   = '';

  const img = document.getElementById('preview-img');
  const ph  = document.getElementById('preview-img-placeholder');
  img.style.display = 'none';
  ph.style.display  = '';
  ph.innerHTML      = '<div class="spinner"></div>';

  const full = await window.docusnap.getDocumentWithExtractions(doc.id);
  // `full` (getWithExtractions → getById) carries the extractions but NOT type_name (no
  // join to document_types), while the search-result `doc` DOES — so merge, keeping doc's
  // type_name/type_slug (otherwise the preview "Type" always shows "-").
  renderPreviewFields({ ...doc, ...(full || {}) });
  window.SearchActions.renderActions(doc);

  const { folderPath, filename } = _fileArgs(doc);
  s.currentPages = (folderPath && filename)
    ? await window.docusnap.getDocumentPages(doc.id, folderPath, filename)
    : [];
  s.currentPage = 0;

  if (s.currentPages.length > 0) {
    _showPage(0);
  } else {
    ph.style.display = '';
    ph.innerHTML = 'No preview available';
    document.getElementById('page-nav').style.display = 'none';
  }
}

function _fileArgs(doc) {
  if (doc.status === 'confirmed' && doc.stored_path && doc.stored_filename) {
    const sep = Math.max(doc.stored_path.lastIndexOf('\\'), doc.stored_path.lastIndexOf('/'));
    return { folderPath: doc.stored_path.substring(0, sep), filename: doc.stored_filename };
  }
  return { folderPath: doc.folder_path, filename: doc.original_filename };
}

window.SearchPreview = { selectDoc, renderPreviewFields, initPageNav, fileArgs: _fileArgs };
