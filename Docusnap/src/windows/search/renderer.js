'use strict';

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

let selectedDoc  = null;
let searchTimer  = null;
let currentPages = [];

// ── Doc types dropdown ────────────────────────────────────────────────────────
async function loadDocTypes() {
  const types = await window.docusnap.getAllDocTypes();
  const sel   = document.getElementById('inp-type');
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value       = t.slug;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
}
loadDocTypes();

// ── Search ────────────────────────────────────────────────────────────────────
function getParams() {
  return {
    company:           document.getElementById('inp-company').value.trim() || undefined,
    reference:         document.getElementById('inp-reference').value.trim() || undefined,
    dateFrom:          document.getElementById('inp-date-from').value || undefined,
    dateTo:            document.getElementById('inp-date-to').value || undefined,
    docType:           document.getElementById('inp-type').value || undefined,
    includeUncommitted: document.getElementById('chk-uncommitted').checked,
  };
}

async function doSearch() {
  const results = await window.docusnap.searchDocuments(getParams());
  renderResults(results);
}

// Trigger on input with debounce
['inp-company', 'inp-reference', 'inp-date-from', 'inp-date-to'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  });
});
document.getElementById('inp-type').addEventListener('change', doSearch);
document.getElementById('chk-uncommitted').addEventListener('change', doSearch);
document.getElementById('btn-search').addEventListener('click', doSearch);

// ── Render results ────────────────────────────────────────────────────────────
function renderResults({ confirmed = [], uncommitted = [] }) {
  const scroll = document.getElementById('results-scroll');
  const empty  = document.getElementById('results-empty');
  scroll.querySelectorAll('.section-header, .result-item').forEach(el => el.remove());

  const total = confirmed.length + uncommitted.length;
  if (total === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  if (confirmed.length > 0) {
    scroll.appendChild(makeSectionHeader('CONFIRMED', confirmed.length));
    confirmed.forEach(doc => scroll.appendChild(makeResultItem(doc)));
  }
  if (uncommitted.length > 0) {
    scroll.appendChild(makeSectionHeader('UNCONFIRMED', uncommitted.length));
    uncommitted.forEach(doc => scroll.appendChild(makeResultItem(doc)));
  }

  // Re-highlight selected if still present
  if (selectedDoc) {
    const el = scroll.querySelector(`[data-id="${selectedDoc.id}"]`);
    if (el) el.classList.add('active');
  }
}

function makeSectionHeader(label, count) {
  const el = document.createElement('div');
  el.className = 'section-header';
  el.innerHTML = `${label} <span class="section-count">${count}</span>`;
  return el;
}

function makeResultItem(doc) {
  const el = document.createElement('div');
  el.className = 'result-item';
  el.dataset.id = doc.id;

  const displayName = doc.stored_filename || doc.original_filename || '—';
  const supplier    = doc.supplier_name || '—';
  const typeName    = doc.type_name || '';
  const date        = doc.doc_date || '';

  let statusBadge = '';
  if (doc.status === 'needs_review') {
    statusBadge = `<span class="result-status-badge review">Needs Review</span>`;
  } else if (doc.status === 'deferred') {
    statusBadge = `<span class="result-status-badge deferred">Deferred</span>`;
  }

  el.innerHTML = `
    <div class="result-header">
      <span class="result-supplier" title="${escHtml(supplier)}">${escHtml(supplier)}</span>
      ${typeName ? `<span class="result-type-badge">${escHtml(typeName)}</span>` : ''}
    </div>
    <div class="result-filename" title="${escHtml(displayName)}">${escHtml(displayName)}</div>
    <div class="result-footer">
      <span class="result-date">${escHtml(date)}</span>
      ${statusBadge}
    </div>
  `;
  el.addEventListener('click', () => selectDoc(doc));
  return el;
}

// ── Select / preview ──────────────────────────────────────────────────────────
async function selectDoc(doc) {
  selectedDoc = doc;

  // Update active state in list
  document.querySelectorAll('.result-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === doc.id);
  });

  document.getElementById('preview-empty').style.display = 'none';
  const previewDoc = document.getElementById('preview-doc');
  previewDoc.style.display = '';

  // Reset image
  const imgEl          = document.getElementById('preview-img');
  const imgPlaceholder = document.getElementById('preview-img-placeholder');
  imgEl.style.display  = 'none';
  imgPlaceholder.style.display = '';
  imgPlaceholder.innerHTML     = '<div class="spinner"></div>';

  // Load fields (may include extractions)
  const full = await window.docusnap.getDocumentWithExtractions(doc.id);
  renderPreviewFields(full || doc);

  // Load image
  const { folderPath, filename } = fileArgs(doc);
  if (folderPath && filename) {
    currentPages = await window.docusnap.getDocumentPages(doc.id, folderPath, filename);
  } else {
    currentPages = [];
  }

  if (currentPages.length > 0) {
    imgEl.src = currentPages[0];
    imgEl.style.display = 'block';
    imgPlaceholder.style.display = 'none';
  } else {
    imgPlaceholder.style.display = '';
    imgPlaceholder.innerHTML = 'No preview available';
  }

  renderPreviewActions(doc);
}

function fileArgs(doc) {
  if (doc.status === 'confirmed' && doc.stored_path && doc.stored_filename) {
    const lastSep = Math.max(doc.stored_path.lastIndexOf('\\'), doc.stored_path.lastIndexOf('/'));
    return {
      folderPath: doc.stored_path.substring(0, lastSep),
      filename:   doc.stored_filename,
    };
  }
  return { folderPath: doc.folder_path, filename: doc.original_filename };
}

function renderPreviewFields(doc) {
  const scroll = document.getElementById('preview-fields-scroll');
  scroll.innerHTML = '';

  const fields = [
    { label: 'Company',   value: doc.supplier_name },
    { label: 'Type',      value: doc.type_name },
    { label: 'Reference', value: doc.reference_number },
    { label: 'Date',      value: doc.doc_date },
  ];

  // Add extractions if available (array → map)
  if (Array.isArray(doc.extractions) && doc.extractions.length) {
    const exMap = {};
    for (const ex of doc.extractions) exMap[ex.field_key] = ex;
    const EX_FIELDS = ['total_amount', 'subtotal', 'vat_tax'];
    const LABELS = { total_amount: 'Total', subtotal: 'Subtotal', vat_tax: 'VAT' };
    for (const key of EX_FIELDS) {
      const ex = exMap[key];
      if (ex?.display_value) {
        fields.push({ label: LABELS[key], value: ex.display_value });
      }
    }
  }

  for (const { label, value } of fields) {
    const row = document.createElement('div');
    row.className = 'pf-row';
    row.innerHTML = `
      <span class="pf-label">${escHtml(label)}</span>
      <span class="pf-value ${value ? '' : 'empty'}">${escHtml(value || '—')}</span>
    `;
    scroll.appendChild(row);
  }
}

function renderPreviewActions(doc) {
  const actions = document.getElementById('preview-actions');
  actions.innerHTML = '';

  if (doc.status === 'confirmed') {
    if (doc.stored_path) {
      addBtn(actions, '📂 Open in Explorer', () => window.docusnap.showInExplorer(doc.stored_path));
      addBtn(actions, '📄 Open File',         () => window.docusnap.openFile(doc.stored_path));
    }
  } else {
    // Unconfirmed — offer to open review window
    addBtn(actions, '✎ Edit in Review', () => window.docusnap.openReviewWindow(), true);
  }
}

function addBtn(container, label, onClick, primary = false) {
  const btn = document.createElement('button');
  btn.className   = primary ? 'action-btn primary' : 'action-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init: run empty search to show all docs ───────────────────────────────────
doSearch();
