'use strict';

// Fallback fields shown when no doc type is selected
const FALLBACK_FIELD_KEYS = ['supplier_name', 'invoice_number', 'invoice_date'];

// ── State ─────────────────────────────────────────────────────────────────────
let queue            = [];
let deferredQueue    = [];
let bulkFiling       = false; // true while File All Ready runs; suppresses the auto-refresh listener so its per-doc confirm broadcasts can't clobber the loop's local queue mid-run
let allDocTypes      = [];
let currentDoc       = null;
let currentPage      = 0;
let pageImages       = [];
let fieldDefs        = [];
let corrections      = {};
let anchorTaughtFields = new Set(); // field_keys taught via the ⊕ highlight/zone-OCR tool this cycle
let activeTab        = 'review';
let isAdmin          = false;   // gates the destructive bulk-delete actions (also enforced server-side)
let canEdit          = false;   // admin OR edit — gates per-row delete (also enforced server-side)

// OCR preview state
let previewActive    = false;
let previewCache     = new Map(); // page index → data URI
let _previewDebounce = null;
let selectedTypeSlug = null;   // tracks dropdown selection independently

// Zone selection state
let activeField = null;
let isDragging  = false;
let dragStart   = { x: 0, y: 0 };
let dragRect    = null;

// Preview zoom/pan + Template Wizard (Stage 1 — shell/preview only, no persistence)
let previewZoom = 1, previewPanX = 0, previewPanY = 0;
let _viewDocId  = null;            // resets zoom/pan when the displayed doc changes
const PREVIEW_ZOOM_MIN = 1, PREVIEW_ZOOM_MAX = 4, PREVIEW_ZOOM_STEP = 0.25;
const wizard = {
  active: false, fields: [], index: 0, step: 'field',
  draftAnchor: null, draftTarget: null, fixedMode: false,
  drawMode: null, isDragging: false, dragStart: { x: 0, y: 0 }, dragRect: null,
  selectedBox: null,           // 'anchor' | 'target' | null — click-selected box (Delete removes / drag moves it)
  moveStart: null,             // { pt, orig } while dragging a selected box to reposition it
  templateId: null,            // resolved existing template (rehydrate) or set on first save
  mappingsByKey: new Map(),    // field_key -> persisted mapping (cached for rehydration on reopen)
  savedKeys: new Set(),        // field keys saved during this wizard session (drives auto-advance)
};

// ── Element refs ──────────────────────────────────────────────────────────────
const docImg     = document.getElementById('doc-img');
const docImgWrap = document.getElementById('doc-img-wrap');
const selCanvas  = document.getElementById('sel-canvas');
const wizCanvas  = document.getElementById('wiz-canvas');
const ocrOverlay = document.getElementById('ocr-overlay');
const selectHint = document.getElementById('select-hint');
const hintField  = document.getElementById('hint-field-name');
const hintCancel = document.getElementById('hint-cancel');
const ctx        = selCanvas.getContext('2d');
const wizCtx     = wizCanvas.getContext('2d');

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Load queue ────────────────────────────────────────────────────────────────
async function loadQueue() {
  // Resolve role first so the admin-only bulk-delete footers render correctly
  // (visibility is a convenience — the delete IPCs are admin-gated server-side).
  try {
    const me = await window.docusnap.authGetCurrentUser();
    isAdmin = !!(me && me.role === 'admin');
    canEdit = !!(me && (me.role === 'admin' || me.role === 'edit'));
  } catch { isAdmin = false; canEdit = false; }
  applyAnchorWizardGate();   // Template Wizard is admin-only (mapping IPC is admin-gated server-side)
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  allDocTypes   = await window.docusnap.getAllDocTypes();
  fieldDefs     = allDocTypes.length ? allDocTypes[0].fields : [];
  populateTypeDropdown();
  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);

  // If opened via "Edit in Review" from Search, navigate to the requested doc.
  const targetId = await window.docusnap.getReviewTarget();
  if (targetId) _navigateToDoc(targetId);
}

function reviewFields() {
  if (fieldDefs && fieldDefs.length) return fieldDefs.map(f => f.key);
  return FALLBACK_FIELD_KEYS;
}

function labelFor(key) {
  const f = fieldDefs.find(f => f.key === key);
  if (f) return f.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Doc type dropdown ─────────────────────────────────────────────────────────
function populateTypeDropdown() {
  const sel = document.getElementById('doctype-select');
  sel.innerHTML = '<option value="">— Select document type —</option>';
  for (const t of allDocTypes) {
    const opt = document.createElement('option');
    opt.value       = t.slug;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
}

document.getElementById('doctype-select').addEventListener('change', (e) => {
  selectedTypeSlug = e.target.value || null;
  const dt = allDocTypes.find(t => t.slug === selectedTypeSlug);
  fieldDefs = dt ? dt.fields : (allDocTypes[0]?.fields || []);
  if (currentDoc) {
    currentDoc.type_slug             = selectedTypeSlug;
    currentDoc.document_type_slug    = selectedTypeSlug;
  }
  // Re-render fields preserving current input values
  const existing = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(inp => {
    existing[inp.dataset.key] = inp.value;
  });
  const scroll = document.getElementById('fields-scroll');
  scroll.innerHTML = '';
  // Rebuild field rows with saved values
  const keys = reviewFields();
  for (const key of keys) {
    const val = existing[key] ?? '';
    appendFieldRow(scroll, key, val, null);
  }
  validateConfirm();
});

// ── Tab switching ─────────────────────────────────────────────────────────────
document.getElementById('tab-review').addEventListener('click', () => {
  activeTab = 'review';
  document.getElementById('tab-review').classList.add('active');
  document.getElementById('tab-deferred').classList.remove('active');
  renderQueueList();
  updateDocNavButtons();
});

document.getElementById('tab-deferred').addEventListener('click', () => {
  activeTab = 'deferred';
  document.getElementById('tab-deferred').classList.add('active');
  document.getElementById('tab-review').classList.remove('active');
  renderDeferredList();
  updateDocNavButtons();
});

function updateTabCounts() {
  document.getElementById('tab-review-count').textContent   = queue.length;
  document.getElementById('tab-deferred-count').textContent = deferredQueue.length;
}

// Show/hide the list+arrow-rail container (hidden when the active list is empty,
// so the "all reviewed" / "no deferred" message shows in its place).
function setQueueWrapVisible(visible) {
  const w = document.getElementById('queue-scroll-wrap');
  if (w) w.style.display = visible ? 'flex' : 'none';
}

// ── Queue list (review tab) ───────────────────────────────────────────────────
function renderQueueList() {
  document.getElementById('deferred-footer').style.display = 'none';
  const reviewActions = document.getElementById('review-actions');
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  list.innerHTML = '';

  if (queue.length === 0) {
    empty.style.display = '';
    reviewActions.style.display = 'none';
    setQueueWrapVisible(false);
    if (!currentDoc) clearDocPanel();
    return;
  }
  empty.style.display = 'none';
  setQueueWrapVisible(true);
  // The whole left action block (Skip/Defer · File All · Delete All) is shown on
  // the review tab; the destructive "Delete All Review" stays admin-only (also
  // enforced server-side).
  reviewActions.style.display = 'flex';
  document.getElementById('btn-delete-all-review').style.display = isAdmin ? '' : 'none';

  for (const doc of queue) {
    const el = document.createElement('div');
    el.className  = 'queue-item';
    el.dataset.id = doc.id;
    // Row colour reflects actual review reasons (not raw confidence or missing
    // doc-row fields, which are only set on confirm):
    //   orange = a field is below its per-field threshold set in Settings, OR a
    //            value was flagged for review during processing (validation note
    //            / correction candidate).
    //   red    = critically low overall confidence (<40) — existing critical state.
    //   green  = otherwise clean.
    const conf    = doc.overall_confidence;
    const flagged = isFlagged(doc);
    let sev = '';   // '', 'high'(green), 'mid'(orange), 'low'(red)
    if (conf != null) {
      if (conf < 40)    sev = 'low';
      else if (flagged) sev = 'mid';
      else              sev = 'high';
    }
    if (sev === 'low')      el.classList.add('qi-conf-low');
    else if (sev === 'mid') el.classList.add('qi-conf-mid');
    if (currentDoc && doc.id === currentDoc.id) el.classList.add('active');
    const confBadge = conf == null ? '' :
      `<span class="conf-badge ${sev}" style="flex-shrink:0;">${conf}%</span>`;
    el.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:4px;">
        <div style="flex:1; min-width:0;">
          <span class="qi-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="qi-supplier" style="flex:1; min-width:0;">${escHtml(doc.supplier_name || '—')}</span>
            ${confBadge}
          </div>
        </div>
        ${canEdit ? `<button class="qi-btn danger qi-delete" title="Delete document" aria-label="Delete document" style="flex-shrink:0; padding:2px 7px; font-size:13px;">&#215;</button>` : ''}
      </div>
    `;
    el.addEventListener('click', () => selectDoc(doc));
    const delBtn = el.querySelector('.qi-delete');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteFromQueue(doc); });
    list.appendChild(el);
  }
}

// ── Deferred list (deferred tab) ─────────────────────────────────────────────
function renderDeferredList() {
  document.getElementById('review-actions').style.display = 'none';   // review-only block; not for Deferred
  const list   = document.getElementById('queue-list');
  const empty  = document.getElementById('queue-empty');
  const footer = document.getElementById('deferred-footer');
  list.innerHTML = '';

  if (deferredQueue.length === 0) {
    empty.style.display = '';
    empty.textContent = 'No deferred documents';
    footer.style.display = 'none';
    setQueueWrapVisible(false);
    return;
  }
  empty.style.display = 'none';
  setQueueWrapVisible(true);
  // Admin-only "Delete All Deferred" footer
  footer.style.display = isAdmin ? 'block' : 'none';

  for (const doc of deferredQueue) {
    const el = document.createElement('div');
    el.className  = 'queue-item';
    el.dataset.id = doc.id;
    if (currentDoc && doc.id === currentDoc.id) el.classList.add('active');
    el.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:4px;">
        <div style="flex:1; min-width:0;">
          <span class="qi-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
          <span class="qi-supplier">${escHtml(doc.supplier_name || '—')}</span>
        </div>
        <div style="display:flex; gap:3px; flex-shrink:0;" onclick="event.stopPropagation()">
          <button class="qi-btn qi-review-now" title="Move back to review queue" style="padding:2px 6px; font-size:10px;">Review</button>
          <button class="qi-btn danger qi-delete" title="Delete" style="padding:2px 7px; font-size:13px;">&#215;</button>
        </div>
      </div>
    `;
    el.querySelector('.qi-review-now').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.docusnap.restoreDeferred(doc.id);
      deferredQueue = deferredQueue.filter(d => d.id !== doc.id);
      queue = await window.docusnap.getReviewQueue();
      updateTabCounts();
      // Switch to review tab and load the doc
      activeTab = 'review';
      document.getElementById('tab-review').classList.add('active');
      document.getElementById('tab-deferred').classList.remove('active');
      renderQueueList();
      const restored = queue.find(d => d.id === doc.id);
      if (restored) selectDoc(restored);
    });
    el.querySelector('.qi-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${doc.original_filename}"? This cannot be undone.`)) return;
      const filePath = doc.folder_path ? `${doc.folder_path}\\${doc.original_filename}` : null;
      await window.docusnap.deleteDocument(doc.id, filePath);
      deferredQueue = deferredQueue.filter(d => d.id !== doc.id);
      if (currentDoc?.id === doc.id) { currentDoc = null; clearDocPanel(); }
      updateTabCounts();
      renderDeferredList();
    });
    el.addEventListener('click', () => selectDoc(doc));
    list.appendChild(el);
  }
}

// ── Select document ───────────────────────────────────────────────────────────
async function selectDoc(doc) {
  try { await _selectDoc(doc); } catch(err) {
    console.error('selectDoc failed:', err);
    showToast('Error loading doc: ' + err.message, 'err');
  }
  // Keep the prev/next rail in sync with the new position and ensure the chosen
  // item is visible (matters when cycling to an off-screen document).
  updateDocNavButtons();
  scrollActiveItemIntoView();
}
async function _selectDoc(doc) {
  _clearPreviewState();
  cancelZoneMode();
  currentDoc  = doc;
  currentPage = 0;
  corrections = {};
  anchorTaughtFields = new Set();

  document.querySelectorAll('.queue-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === doc.id);
  });

  // Disable defer button if the doc is already deferred
  document.getElementById('btn-defer').disabled = doc.status === 'deferred';
  document.getElementById('doc-name').textContent = doc.original_filename;

  // Show split button for PDF files only; hide the split panel when switching docs
  const isPdf = doc.original_filename?.toLowerCase().endsWith('.pdf');
  document.getElementById('btn-split-pdf').style.display  = isPdf ? '' : 'none';
  document.getElementById('split-bar').style.display      = 'none';
  document.getElementById('split-ranges-input').value     = '';

  // Set doc type dropdown
  selectedTypeSlug = doc.type_slug || null;
  const sel = document.getElementById('doctype-select');
  sel.value = selectedTypeSlug || '';
  const dt = allDocTypes.find(t => t.slug === selectedTypeSlug);
  fieldDefs = dt ? dt.fields : (allDocTypes[0]?.fields || []);

  // Load pages and fields independently — a missing file must not block field rendering
  try {
    pageImages = (doc.folder_path && doc.original_filename)
      ? await window.docusnap.getDocumentPages(doc.id, doc.folder_path, doc.original_filename)
      : [];
  } catch (e) {
    console.warn('getDocumentPages failed:', e.message);
    pageImages = [];
  }
  if (currentDoc?.id !== doc.id) return;   // a newer doc was selected while pages loaded — don't clobber its preview (this same _selectDoc set currentDoc=doc at the top, so the latest selection always passes)
  renderPage();

  let full = null;
  try {
    full = await window.docusnap.getDocumentWithExtractions(doc.id);
  } catch (e) {
    console.warn('getDocumentWithExtractions failed:', e.message);
  }
  if (currentDoc?.id !== doc.id) return;   // superseded while extractions loaded — leave the newer doc's fields intact
  const renderedDoc = full || doc;
  renderFields(renderedDoc);

  // Lightweight current-template recheck — this doc had no template match at
  // processing time, but a template covering its layout may have been added
  // since (e.g. via "Add to Template Manager" on another document from the
  // same supplier). Read-only UI refresh: does not reprocess, does not write
  // template_id, and is skipped entirely once a template_id is already set.
  if (!doc.template_id) {
    window.docusnap.checkTemplateMatch(doc.id).then(result => {
      if (currentDoc?.id !== doc.id) return; // user switched docs while pending
      if (result?.matched) {
        renderedDoc._templateRecheck = result;
        renderExtractionStatus(renderedDoc);
      }
    }).catch(e => console.warn('checkTemplateMatch failed:', e.message));
  }
}

// ── Page rendering ────────────────────────────────────────────────────────────
function renderPage() {
  const placeholder = document.getElementById('doc-placeholder');
  const indicator   = document.getElementById('page-indicator');

  if (!pageImages || pageImages.length === 0) {
    docImgWrap.style.display  = 'none';
    placeholder.style.display = '';
    placeholder.textContent   = currentDoc ? 'No preview available' : 'Select a document from the queue';
    indicator.textContent     = '—';
    return;
  }

  placeholder.style.display = 'none';
  docImgWrap.style.display  = 'inline-block';

  // Reset zoom/pan (and close the wizard) when a different document is shown —
  // page-to-page navigation within the same doc keeps the current view.
  if (currentDoc && currentDoc.id !== _viewDocId) {
    _viewDocId = currentDoc.id;
    resetPreviewView();
    if (wizard.active) exitWizard();
  }

  docImg.onload = () => {
    selCanvas.width  = docImg.offsetWidth;
    selCanvas.height = docImg.offsetHeight;
    wizCanvas.width  = docImg.offsetWidth;
    wizCanvas.height = docImg.offsetHeight;
    clearCanvas();
    redrawWizard();
    if (currentPage === 0) attemptLogoMatch();
  };
  docImg.src = (previewActive && previewCache.has(currentPage))
    ? previewCache.get(currentPage)
    : pageImages[currentPage];
  indicator.textContent = `Page ${currentPage + 1} / ${pageImages.length}`;
}

document.getElementById('btn-page-prev').addEventListener('click', () => {
  if (currentPage > 0) { cancelZoneMode(); currentPage--; renderPage(); if (previewActive) refreshPreviewNow(); }
});
document.getElementById('btn-page-next').addEventListener('click', () => {
  if (currentPage < pageImages.length - 1) { cancelZoneMode(); currentPage++; renderPage(); if (previewActive) refreshPreviewNow(); }
});

// ── Extraction status pills ────────────────────────────────────────────────────
function renderExtractionStatus(doc) {
  const el = document.getElementById('extraction-status');
  if (!el) return;
  el.innerHTML = '';
  if (!doc) return;

  // ── Identification ─────────────────────────────────────────────────────────
  const hasTemplate = !!doc.template_id;
  const hasLogo     = !!doc.logo_phash;
  const hasKw       = !!(doc.keyword_fingerprint && doc.keyword_fingerprint !== 'null');

  const recheck = doc._templateRecheck;

  let idLabel, idCls;
  if (hasTemplate && hasLogo && hasKw)  { idLabel = 'Logo & keyword';    idCls = 'ok'; }
  else if (hasTemplate && hasLogo)      { idLabel = 'Logo match';         idCls = 'info'; }
  else if (hasTemplate && hasKw)        { idLabel = 'Keyword match';      idCls = 'info'; }
  else if (hasTemplate)                 { idLabel = 'Template match';     idCls = 'info'; }
  else if (recheck?.matched)            { idLabel = `Template available: ${recheck.templateName}`; idCls = 'info'; }
  else                                  { idLabel = 'No template match';  idCls = 'warn'; }

  // ── Extraction method summary ──────────────────────────────────────────────
  // Strip +corrected/+denoised suffixes, then categorise each field's method.
  const baseMethods = (doc.extractions || [])
    .map(e => (e.extraction_method || '').split('+')[0].trim().toLowerCase())
    .filter(Boolean);

  const mappingN  = baseMethods.filter(m => m.startsWith('template_mapping')).length;
  const anchorN   = baseMethods.filter(m => m.startsWith('anchor')).length;
  const keywordN  = baseMethods.filter(m => m === 'keyword').length;
  const aiN       = baseMethods.filter(m => m.startsWith('llm')).length;
  const knownN    = baseMethods.filter(m => m && m !== 'unknown').length;

  let extLabel, extCls;
  if (knownN === 0)                              { extLabel = 'Unknown';          extCls = 'muted'; }
  else if (mappingN > 0 && mappingN >= Math.max(anchorN, keywordN)) {
                                                   extLabel = 'Template mappings'; extCls = 'ok'; }
  else if (anchorN > 0 && anchorN >= keywordN)  { extLabel = 'Learned anchors';   extCls = 'info'; }
  else if (keywordN > 0)                         { extLabel = 'Keyword patterns';  extCls = 'info'; }
  else if (aiN > 0)                              { extLabel = 'AI fallback';       extCls = 'warn'; }
  else                                           { extLabel = 'Mixed methods';     extCls = 'info'; }

  // ── Render ─────────────────────────────────────────────────────────────────
  const pill = (text, cls) => {
    const s = document.createElement('span');
    s.className   = `method-pill ${cls}`;
    s.textContent = text;
    return s;
  };
  const row = (labelText, ...pills) => {
    const d = document.createElement('div');
    d.className = 'ext-status-row';
    const lbl = document.createElement('span');
    lbl.className   = 'ext-status-lbl';
    lbl.textContent = labelText;
    d.appendChild(lbl);
    pills.forEach(p => d.appendChild(p));
    return d;
  };

  el.appendChild(row('ID:', pill(idLabel, idCls)));
  const extPills = [pill(extLabel, extCls)];
  if (mappingN > 0) extPills.push(pill(`${mappingN} mapping${mappingN === 1 ? '' : 's'}`, 'ok'));
  el.appendChild(row('Extraction:', ...extPills));
}

// A document is "flagged" when processing surfaced questionable data on it: a
// field carries a validation note or correction candidate (review_flag_count),
// or a field came in under its confidence threshold (below_threshold_count).
// SINGLE source of truth for queue severity colouring, File All Ready
// eligibility, and the Mark Reviewed button. Counts come from getReviewQueue()
// and live on the in-memory queue object (currentDoc is that same object).
function isFlagged(doc) {
  return (doc?.review_flag_count || 0) > 0 || (doc?.below_threshold_count || 0) > 0;
}

// Show Mark Reviewed only for the flagged current document. A flagged doc is
// excluded from File All until acknowledged; once acknowledged the button shows
// a static "Reviewed" state. Unflagged docs never show it. Reads currentDoc so
// it reflects the live queue object (which carries the flag counts + ack stamp).
function updateAcknowledgeButton() {
  const btn = document.getElementById('btn-acknowledge');
  if (!btn) return;
  if (!currentDoc || !isFlagged(currentDoc)) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  if (currentDoc.review_acknowledged_at) {
    btn.disabled    = true;
    btn.innerHTML   = '✓ Reviewed';
    btn.style.color = 'var(--ok)';
  } else {
    btn.disabled    = false;
    btn.innerHTML   = '✓ Mark Reviewed';
    btn.style.color = 'var(--warn)';
  }
}

// ── Fields panel ──────────────────────────────────────────────────────────────
function renderFields(doc) {
  const scroll = document.getElementById('fields-scroll');
  scroll.innerHTML = '';
  renderExtractionStatus(doc);
  if (!doc) { validateConfirm(); return; }

  const extMap = {};
  for (const e of (doc.extractions || [])) extMap[e.field_key] = e;

  for (const key of reviewFields()) {
    const ext = extMap[key] || {};
    const val = ext.display_value ?? ext.raw_value ?? '';
    appendFieldRow(scroll, key, val, ext.confidence ?? null, ext.validation_note || null, ext.corrected_to || null, ext.anchor_label || null, ext.extraction_method || null);
  }
  validateConfirm();
  updateAcknowledgeButton();
}

function appendFieldRow(scroll, key, val, conf, note, correctedTo, anchorLabel, method) {
  const low      = conf !== null && conf < 70;
  const confClass = conf === null ? '' : conf >= 70 ? 'high' : conf >= 40 ? 'mid' : 'low';
  const confLabel = conf !== null
    ? `<span class="conf-badge ${confClass}">${conf}%</span>`
    : '';
  // An "Accept" button is shown ONLY for correction CANDIDATES — i.e. when a
  // corrected_to value is present (set by Stage 4.5's non-confident proposal).
  // Plain validation notes (no corrected_to) get no button. The button only
  // copies the suggestion into the input; it never confirms or persists.
  const acceptHtml = correctedTo
    ? ` <button type="button" class="accept-btn" data-key="${key}">Accept</button>`
    : '';
  const noteHtml = (note || correctedTo)
    ? `<div class="field-note">${escHtml(note || '')}${acceptHtml}</div>`
    : '';
  // Anchor provenance: only for anchor-based extraction sources, and only when a
  // label was captured. Other methods (keyword, template, llm, manual) show nothing.
  const isAnchorMethod = method === 'anchor' || method === 'anchor_crop';
  const anchorHtml = (isAnchorMethod && anchorLabel)
    ? `<div class="field-anchor-note">From anchor: ${escHtml(anchorLabel)}</div>`
    : '';

  const row = document.createElement('div');
  row.className   = 'field-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="field-row-header">
      <span class="field-row-label" data-key="${key}">${escHtml(labelFor(key))}</span>
      ${confLabel}
    </div>
    <div class="field-input-wrap">
      <input type="text" class="field-input ${low ? 'low-conf' : ''}"
             data-key="${key}" data-original="${escHtml(val)}"
             value="${escHtml(val)}" placeholder="Not found">
      <button class="pick-btn" data-key="${key}" title="Pick from document">&#8853;</button>
    </div>
    ${noteHtml}${anchorHtml}
  `;

  const input = row.querySelector('input');
  input.addEventListener('input', () => {
    const orig = input.dataset.original;
    input.classList.toggle('corrected', input.value !== orig);
    if (input.value !== orig) {
      corrections[key] = { original_value: orig, corrected_value: input.value };
    } else {
      delete corrections[key];
    }
    validateConfirm();
  });

  row.querySelector('.pick-btn').addEventListener('click', () => {
    if (activeField === key) cancelZoneMode();
    else enterZoneMode(key, labelFor(key));
  });

  // Accept the suggested correction: copy it into the editable input and fire
  // the normal 'input' event so it flows through the SAME path as a manual edit
  // (records corrections[key], runs validateConfirm). No auto-confirm, no DB
  // write — the value is learned only if/when the user confirms the document.
  const acceptBtn = row.querySelector('.accept-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      input.value = correctedTo;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Applied';
    });
  }

  scroll.appendChild(row);
}

// ── Confirm validation ────────────────────────────────────────────────────────
function validateConfirm() {
  const btn = document.getElementById('btn-confirm');

  // Need a doc type selected
  if (!selectedTypeSlug) {
    btn.disabled = true;
    markRequiredMissing([]);
    return;
  }

  const dt       = allDocTypes.find(t => t.slug === selectedTypeSlug);
  const dateKey  = dt?.date_field_key  || 'invoice_date';
  const refKey   = dt?.ref_field_key   || 'invoice_number';
  const required = [dateKey, refKey];

  const missing = required.filter(key => {
    const input = document.querySelector(`.field-input[data-key="${key}"]`);
    return !input || !input.value.trim();
  });

  markRequiredMissing(missing);
  btn.disabled = missing.length > 0;
}

function markRequiredMissing(missingKeys) {
  document.querySelectorAll('.field-row-label').forEach(el => {
    const key     = el.dataset.key;
    const isMissing = missingKeys.includes(key);
    el.classList.toggle('required-missing', isMissing);
    const input = document.querySelector(`.field-input[data-key="${key}"]`);
    if (input) input.classList.toggle('required-missing', isMissing && !input.value.trim());
  });
}

// ── Zone selection mode ───────────────────────────────────────────────────────
function enterZoneMode(key, label) {
  cancelZoneMode();
  activeField = key;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('picking'));
  document.querySelectorAll('.field-input').forEach(i => i.classList.remove('zone-active'));
  const pickBtn = document.querySelector(`.pick-btn[data-key="${key}"]`);
  const input   = document.querySelector(`.field-input[data-key="${key}"]`);
  if (pickBtn) pickBtn.classList.add('picking');
  if (input)   input.classList.add('zone-active');
  hintField.textContent = label;
  selectHint.classList.add('visible');
  selCanvas.classList.add('active');
}

function cancelZoneMode() {
  activeField = null;
  isDragging  = false;
  dragRect    = null;
  selCanvas.classList.remove('active');
  selectHint.classList.remove('visible');
  clearCanvas();
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('picking'));
  document.querySelectorAll('.field-input').forEach(i => i.classList.remove('zone-active'));
}

hintCancel.addEventListener('click', cancelZoneMode);

// ── Canvas drawing ────────────────────────────────────────────────────────────
function clearCanvas() {
  ctx.clearRect(0, 0, selCanvas.width, selCanvas.height);
}

function drawRect(r) {
  clearCanvas();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth   = 4;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth   = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);
  ctx.fillStyle   = 'rgba(79,142,247,0.09)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

selCanvas.addEventListener('mousedown', (e) => {
  if (!activeField) return;
  isDragging = true;
  const p    = canvasPoint(e, selCanvas);   // zoom/pan-compensated canvas-buffer px
  dragStart  = { x: p.x, y: p.y };
  dragRect   = { x: p.x, y: p.y, w: 0, h: 0 };
});

selCanvas.addEventListener('mousemove', (e) => {
  if (!isDragging || !dragRect) return;
  const p  = canvasPoint(e, selCanvas);
  dragRect = {
    x: Math.min(dragStart.x, p.x),
    y: Math.min(dragStart.y, p.y),
    w: Math.abs(p.x - dragStart.x),
    h: Math.abs(p.y - dragStart.y),
  };
  drawRect(dragRect);
});

selCanvas.addEventListener('mouseup', async (e) => {
  if (!isDragging || !dragRect || !activeField) return;
  isDragging = false;
  if (dragRect.w < 10 || dragRect.h < 10) { clearCanvas(); return; }
  await runZoneOcr(dragRect, activeField);
});

// ── Zone OCR ──────────────────────────────────────────────────────────────────
async function runZoneOcr(rect, fieldKey) {
  ocrOverlay.classList.add('visible');

  try {
    const scaleX = docImg.naturalWidth  / docImg.offsetWidth;
    const scaleY = docImg.naturalHeight / docImg.offsetHeight;
    const imgW   = docImg.offsetWidth;
    const imgH   = docImg.offsetHeight;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width  = Math.round(rect.w * scaleX);
    cropCanvas.height = Math.round(rect.h * scaleY);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(
      docImg,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
      cropCanvas.width, cropCanvas.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );
    const base64 = cropCanvas.toDataURL('image/png').split(',')[1];

    const result = await window.docusnap.ocrRegion(base64);
    const text   = (result || '').trim();

    if (text) {
      const input = document.querySelector(`.field-input[data-key="${fieldKey}"]`);
      if (input) {
        const orig = input.dataset.original;
        input.value = text;
        input.classList.add('corrected');
        corrections[fieldKey] = { original_value: orig, corrected_value: text };
        validateConfirm();
      }
      const anchorSaved = await captureAnchorContext(rect, fieldKey, text, imgW, imgH, scaleX, scaleY);
      if (anchorSaved) anchorTaughtFields.add(fieldKey);
    }
  } catch (err) {
    console.error('Zone OCR error:', err);
  }

  ocrOverlay.classList.remove('visible');
  cancelZoneMode();
}

// Compute the DRIFT-INVARIANT label→value offset to store with a ⊕ teach.
// `box` is the label's [left, top, w, h] in the crop's ORIGINAL (natural) pixels
// (from ocrRegionBoxes). `originDX/DY` are the crop's top-left in DISPLAY px.
// Returns {offset_dx_norm, offset_dy_norm} = (value-centre − label-top-left),
// page-normalised — or {} when no/implausible box (→ anchor stores null offset,
// extraction falls back to its geometric guess). Normalised throughout so it is
// immune to the preview-vs-render pixel-scale difference.
function labelOffsetFromBox(box, originDX, originDY, xNorm, yNorm, imgW, imgH) {
  if (!Array.isArray(box) || box.length < 2) return {};
  const nW = docImg.naturalWidth || imgW, nH = docImg.naturalHeight || imgH;
  if (!nW || !nH || !imgW || !imgH) return {};
  const labelXNorm = (originDX / imgW) + (box[0] / nW);
  const labelYNorm = (originDY / imgH) + (box[1] / nH);
  const dx = xNorm - labelXNorm, dy = yNorm - labelYNorm;
  // Sanity: a real label sits near its value. Reject implausible offsets so a
  // mis-read box never stores a wild vector (extraction then uses the fallback).
  if (!isFinite(dx) || !isFinite(dy) || Math.abs(dx) > 0.6 || Math.abs(dy) > 0.3) return {};
  return { offset_dx_norm: dx, offset_dy_norm: dy };
}

async function captureAnchorContext(rect, fieldKey, value, imgW, imgH, scaleX, scaleY) {
  const xNorm    = (rect.x + rect.w / 2) / imgW;
  const yNorm    = (rect.y + rect.h / 2) / imgH;
  const pageZone = yNorm < 0.33 ? 'top' : yNorm < 0.66 ? 'middle' : 'bottom';
  const docType  = currentDoc?.type_slug || currentDoc?.document_type_slug || null;

  // Use the live supplier_name field value (what the user has reviewed/
  // corrected in this session and will send as allValues.supplier_name on
  // confirm) rather than currentDoc.supplier_name (the pre-confirm extracted
  // identity). Anchors taught here must share the same supplier scope that
  // saveCorrections now keys hints/corrections to — otherwise a corrected
  // supplier name leaves this anchor saved under the old, stale identity and
  // it never gets found again on the next document.
  const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
  const liveSupplier  = supplierInput?.value?.trim() || currentDoc?.supplier_name;

  const anchorBase = {
    supplier_name: cleanSupplierName(liveSupplier),
    document_type: docType,
    field_key:     fieldKey,
    page_zone:     pageZone,
    x_norm:        xNorm,
    y_norm:        yNorm,
    w_norm:        rect.w / imgW,
    h_norm:        rect.h / imgH,
    // This is an EXPLICIT operator re-teach: trust the drawn box outright and let
    // it override any stale/auto-learned anchor for this field (see
    // learning.saveAnchor's authoritative branch). Without this an established
    // wrong anchor can't be corrected — the user's redraw gets blended away.
    authoritative: true,
  };

  // Diagnostic: record what the ⊕ tool STORED (normalised coords) alongside the
  // value the live zone-OCR read at teach time, and the preview image dimensions.
  // If extraction later reads something else at these same coords, the review
  // preview and the extraction render aren't the same pixels. No-op unless
  // diagnostic logging is on (main checks the flag).
  try {
    window.docusnap.diagTeach?.({
      field_key: fieldKey, value, x_norm: xNorm, y_norm: yNorm,
      w_norm: rect.w / imgW, h_norm: rect.h / imgH,
      rect, imgW, imgH, scaleX, scaleY,
      naturalW: docImg.naturalWidth, naturalH: docImg.naturalHeight,
      page: currentPage, preview_active: !!previewActive,
    });
  } catch {}

  // Best-effort: try to find a real label to the left of the box, then above.
  // Each attempt is independently guarded — a failure here (bad crop, OCR
  // error) must NOT prevent the guaranteed fallback save below, otherwise
  // nothing gets learned at all.
  try {
    const leftPad    = Math.min(rect.x, 300);
    const leftCanvas = document.createElement('canvas');
    leftCanvas.width  = Math.round(leftPad * scaleX);
    leftCanvas.height = Math.round(rect.h * scaleY);
    if (leftCanvas.width > 10 && leftCanvas.height > 10) {
      const lCtx = leftCanvas.getContext('2d');
      lCtx.drawImage(
        docImg,
        Math.round((rect.x - leftPad) * scaleX), Math.round(rect.y * scaleY),
        leftCanvas.width, leftCanvas.height,
        0, 0, leftCanvas.width, leftCanvas.height
      );
      const leftB64   = leftCanvas.toDataURL('image/png').split(',')[1];
      const leftRes   = await window.docusnap.ocrRegionBoxes?.(leftB64);
      const leftText  = ((leftRes && leftRes.text) || (await window.docusnap.ocrRegion(leftB64)) || '').trim();
      const leftLabel = extractLabel(leftText);
      if (leftLabel) {
        // Drift-invariant offset: the located label's page position → value centre.
        // Origin of the left crop in DISPLAY px is (rect.x - leftPad, rect.y).
        const off = labelOffsetFromBox(leftRes && leftRes.box, rect.x - leftPad, rect.y, xNorm, yNorm, imgW, imgH);
        await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: leftLabel, direction: 'right', ...off });
        return true;
      }
    }
  } catch (err) {
    console.warn('Anchor capture: left-label lookup failed (non-critical):', err);
  }

  try {
    const abovePad    = Math.min(rect.y, 60);
    const aboveCanvas = document.createElement('canvas');
    aboveCanvas.width  = Math.round(rect.w * scaleX);
    aboveCanvas.height = Math.round(abovePad * scaleY);
    if (aboveCanvas.width > 10 && aboveCanvas.height > 10) {
      const aCtx = aboveCanvas.getContext('2d');
      aCtx.drawImage(
        docImg,
        Math.round(rect.x * scaleX), Math.round((rect.y - abovePad) * scaleY),
        aboveCanvas.width, aboveCanvas.height,
        0, 0, aboveCanvas.width, aboveCanvas.height
      );
      const aboveB64   = aboveCanvas.toDataURL('image/png').split(',')[1];
      const aboveRes   = await window.docusnap.ocrRegionBoxes?.(aboveB64);
      const aboveText  = ((aboveRes && aboveRes.text) || (await window.docusnap.ocrRegion(aboveB64)) || '').trim();
      const aboveLabel = extractLabel(aboveText);
      if (aboveLabel) {
        // Origin of the above crop in DISPLAY px is (rect.x, rect.y - abovePad).
        const off = labelOffsetFromBox(aboveRes && aboveRes.box, rect.x, rect.y - abovePad, xNorm, yNorm, imgW, imgH);
        await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: aboveLabel, direction: 'below', ...off });
        return true;
      }
    }
  } catch (err) {
    console.warn('Anchor capture: above-label lookup failed (non-critical):', err);
  }

  // Guaranteed fallback — always save SOMETHING so the position is learned
  // even when no nearby label text could be read. A failure HERE is NOT
  // "non-critical": it means NOTHING was recorded for this teach (e.g. the save
  // is admin-gated and the current user lacks the role, or a DB error). Surface
  // it so the operator isn't misled into thinking the ⊕ tool worked when the
  // anchor never persisted.
  try {
    const fallbackLabel = labelFor(fieldKey) || fieldKey.replace(/_/g, ' ');
    await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: fallbackLabel, direction: 'right' });
    return true;
  } catch (err) {
    console.error('Anchor capture: save FAILED — nothing recorded:', err);
    try {
      const msg = /FORBIDDEN|permission/i.test(err?.message || '')
        ? 'Could not save anchor: this account lacks permission (admin required).'
        : 'Could not save anchor — it was not recorded. See console for details.';
      showToast(msg, 'err');
    } catch {}
  }
  return false;
}

function cleanSupplierName(name) {
  if (!name || name.length > 60) return null;
  const lower = name.toLowerCase();
  if (lower.includes('invoice') || lower.includes('bill to') ||
      lower.includes('number:') || /\d{1,2}[/\-.]\d{1,2}[/\-.]/.test(name)) return null;
  return name;
}

function extractLabel(text) {
  const cleaned = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const tail    = cleaned.slice(-40).trim();
  if (tail.length > 3 && /[a-zA-Z]/.test(tail)) return tail;
  return null;
}

// ── Confirm ───────────────────────────────────────────────────────────────────
// Confirm + file the CURRENT document. Shared by the single Confirm button and
// the bulk "File All Ready" action so both go through the exact same path.
// Returns one of: { filed:true } | { skipped, reason } | { cancelled } | { error }.
// In BULK mode it never opens a modal — the digit-only soft prompt the single
// path shows becomes a "skip this one for manual review" instead of filing it
// blindly — and the on-screen-image steps (logo-fingerprint save + image-clear
// animation) are skipped, since File All cycles documents itself. The file-by-
// file behaviour is otherwise unchanged.
async function confirmCurrentDoc({ bulk = false } = {}) {
  if (!currentDoc) return { error: 'No document selected.' };

  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(input => {
    allValues[input.dataset.key] = input.value;
  });

  // Warn before confirming a non-digit value on a field whose learned format is
  // digits-only. Cancelable in single-doc mode; in bulk a mismatch means "not
  // cleanly ready", so the document is skipped (left in the queue).
  for (const key of (currentDoc.digit_only_fields || [])) {
    const v = (allValues[key] || '').trim();
    if (v && !/^\d+$/.test(v)) {
      if (bulk) return { skipped: true, reason: 'needs check' };
      if (!confirm(`"${labelFor(key)}" — Are you sure this is correct? This field usually contains only digits.`)) {
        return { cancelled: true };
      }
    }
  }

  if (!bulk) {
    const supplierForLogo = allValues.supplier_name || currentDoc?.supplier_name;
    if (supplierForLogo) await saveLogoOnConfirm(supplierForLogo);
    docImg.src = '';
    docImgWrap.style.display = 'none';
    selCanvas.width  = 0;
    selCanvas.height = 0;
    await new Promise(r => setTimeout(r, 150));
  }

  const result = await window.docusnap.confirmReview({
    document_id:        currentDoc.id,
    folder_path:        currentDoc.folder_path,
    original_filename:  currentDoc.original_filename,
    corrections,
    allValues,
    supplier_name:      currentDoc.supplier_name,
    document_type_slug: selectedTypeSlug || currentDoc?.type_slug || null,
    taught_fields:      [...anchorTaughtFields],
  });

  if (!result?.success) {
    if (!bulk && pageImages?.length) {
      docImgWrap.style.display = '';
      docImg.src = pageImages[currentPage];
    }
    return { error: result?.error || 'Confirm failed. Check settings.' };
  }

  queue         = queue.filter(d => d.id !== currentDoc.id);
  deferredQueue = deferredQueue.filter(d => d.id !== currentDoc.id);
  return { filed: true };
}

document.getElementById('btn-confirm').addEventListener('click', async () => {
  const r = await confirmCurrentDoc();
  if (r.cancelled) return;
  if (r.error) { showToast(r.error, 'err'); return; }
  updateTabCounts();
  advanceAfterAction();
  window.docusnap.notifyReviewComplete();
});

// Mark Reviewed: the only way a flagged doc becomes File-All eligible. Stamps
// review_acknowledged_at server-side, then updates BOTH the current doc and its
// in-memory queue entry (same object in practice, set explicitly to be safe) so
// eligibility flips immediately — no reload. Does not file or advance.
document.getElementById('btn-acknowledge')?.addEventListener('click', async () => {
  if (!currentDoc) return;
  const id = currentDoc.id;
  try {
    const at = await window.docusnap.acknowledgeReview(id);
    if (currentDoc && currentDoc.id === id) currentDoc.review_acknowledged_at = at;
    const q = queue.find(d => d.id === id);
    if (q) q.review_acknowledged_at = at;
    updateAcknowledgeButton();
    renderQueueList();
    showToast('Marked as reviewed', 'ok');
  } catch (e) {
    showToast('Could not mark reviewed: ' + e.message, 'err');
  }
});

// ── File All Ready (bulk) ─────────────────────────────────────────────────────
// Files every document in the Review queue that is individually ready — i.e.
// whose single Confirm button would be enabled (type + required fields present).
// Each is filed through confirmCurrentDoc({bulk:true}), exactly the per-document
// path; not-ready or digit-mismatch documents are left in the queue for review.
async function fileAllReady() {
  if (activeTab !== 'review') return;                 // only the review queue
  const btn = document.getElementById('btn-file-all-review');
  if (!btn || btn.disabled) return;
  const docs = [...queue];                            // snapshot before it mutates
  if (docs.length === 0) return;
  if (!confirm(
        `File all ready documents in the Review queue?\n\n` +
        `Every document with its type and required fields filled in will be filed, ` +
        `exactly as if you confirmed it one by one. Documents still missing required ` +
        `details are left in the queue for you to review.`)) return;

  const confirmBtn = document.getElementById('btn-confirm');
  const original   = btn.textContent;
  btn.disabled = true;
  bulkFiling   = true; // hold off auto-refresh; each confirm broadcasts review-count-changed back to this window
  let filed = 0, skipped = 0;

  try {
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!queue.some(d => d.id === doc.id)) continue; // already handled elsewhere
      // Flagged docs (validation note / correction candidate / below-threshold
      // field) are excluded from bulk filing until a human clicks Mark Reviewed.
      // Checked off the queue object directly — no need to load the doc.
      if (isFlagged(doc) && !doc.review_acknowledged_at) { skipped++; continue; }
      btn.textContent = `Filing… ${i + 1}/${docs.length}`;
      await selectDoc(doc);                            // loads fields; runs validateConfirm()
      if (confirmBtn.disabled) { skipped++; continue; } // not ready — leave for review
      const r = await confirmCurrentDoc({ bulk: true });
      if (r.filed) filed++; else skipped++;
    }
  } finally {
    btn.textContent = original;
    btn.disabled = false;
    bulkFiling   = false; // re-enable auto-refresh before the post-run refresh below
  }

  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);
  else { currentDoc = null; clearDocPanel(); }
  if (filed) window.docusnap.notifyReviewComplete();

  showToast(
    `Filed ${filed} document${filed === 1 ? '' : 's'}` +
      (skipped ? ` · ${skipped} left for review` : ''),
    filed ? 'ok' : 'warn');
}
document.getElementById('btn-file-all-review')?.addEventListener('click', fileAllReady);

// ── Document cycling (prev/next rail beside the queue) ────────────────────────
// The up/down rail moves the SELECTED document one step earlier/later within the
// ACTIVE list (Review queue or the Deferred tab), reusing selectDoc — the exact
// same selection path clicking a list item uses. It clamps at the ends (no wrap)
// so navigation is predictable, and keeps the chosen item scrolled into view.
// Native list scrolling (wheel / scrollbar) is unaffected.
function cycleDocument(direction) {
  const list = activeTab === 'deferred' ? deferredQueue : queue;
  if (!list.length) return;
  const idx     = currentDoc ? list.findIndex(d => d.id === currentDoc.id) : -1;
  const nextIdx = idx === -1 ? 0 : idx + direction;   // up = -1 (prev), down = +1 (next)
  if (nextIdx < 0 || nextIdx >= list.length) return;  // clamp at the ends
  selectDoc(list[nextIdx]);                           // updateDocNavButtons + scroll run inside selectDoc
}

function scrollActiveItemIntoView() {
  const el = document.querySelector('#queue-list .queue-item.active');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// Disable the up arrow on the first item and the down arrow on the last, so the
// rail clearly shows where the current document sits in the active list.
function updateDocNavButtons() {
  const prev = document.getElementById('btn-doc-prev');
  const next = document.getElementById('btn-doc-next');
  if (!prev || !next) return;
  const list = activeTab === 'deferred' ? deferredQueue : queue;
  const idx  = currentDoc ? list.findIndex(d => d.id === currentDoc.id) : -1;
  prev.disabled = idx <= 0;
  next.disabled = idx === -1 || idx >= list.length - 1;
}

document.getElementById('btn-doc-prev')?.addEventListener('click', () => cycleDocument(-1));
document.getElementById('btn-doc-next')?.addEventListener('click', () => cycleDocument(1));

// Keyboard triage shortcuts (single document-level listener; reuses the exact
// handlers the on-screen controls use — no second nav/acknowledge path):
//   ArrowUp/ArrowDown → cycleDocument() (same as the prev/next rail; respects the
//                       active Review/Deferred list and its end clamping)
//   Space            → the #btn-acknowledge button's own click handler
// Guard: only true text-entry/selection controls are excluded, so a focused
// button never swallows Space. preventDefault stops page scroll and stops a
// focused button from also activating. e.repeat blocks key-repeat storms.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.isContentEditable || t.tagName === 'INPUT'
            || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.repeat) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowUp':   e.preventDefault(); cycleDocument(-1); break;
    case 'ArrowDown': e.preventDefault(); cycleDocument(1);  break;
    case ' ': {
      e.preventDefault();
      const btn = document.getElementById('btn-acknowledge');
      if (btn && btn.style.display !== 'none' && !btn.disabled) btn.click();
      break;
    }
  }
});

// ── Skip ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-skip').addEventListener('click', () => {
  const activeList = activeTab === 'deferred' ? deferredQueue : queue;
  const idx  = activeList.findIndex(d => d.id === currentDoc?.id);
  const next = activeList[(idx + 1) % activeList.length];
  if (next && next.id !== currentDoc?.id) selectDoc(next);
});

// ── Defer ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-defer').addEventListener('click', async () => {
  if (!currentDoc || currentDoc.status === 'deferred') return;
  await window.docusnap.deferDocument(currentDoc.id);
  deferredQueue = await window.docusnap.getDeferredQueue();
  queue         = queue.filter(d => d.id !== currentDoc.id);
  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);
  else { currentDoc = null; clearDocPanel(); }
  window.docusnap.notifyReviewComplete();
});

// ── Delete All Review (admin only) ────────────────────────────────────────────
document.getElementById('btn-delete-all-review').addEventListener('click', async () => {
  if (!isAdmin || queue.length === 0) return;
  if (!confirm(`Delete ALL ${queue.length} document(s) in the Review queue?\n\n` +
               `Their files and extracted data are permanently removed. Confirmed and deferred ` +
               `documents are NOT affected. This cannot be undone.`)) return;

  const res = await window.docusnap.deleteAllReview();
  if (!res?.success) { showToast(res?.error || 'Delete failed.', 'err'); return; }
  const hadCurrent = queue.some(d => d.id === currentDoc?.id);
  queue = [];
  if (hadCurrent) { currentDoc = null; clearDocPanel(); }
  updateTabCounts();
  renderQueueList();
  window.docusnap.notifyReviewComplete();
  showToast(`Deleted ${res.deleted} review document(s).`, 'ok');
});

// ── Delete All Deferred (admin only) ──────────────────────────────────────────
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (!isAdmin || deferredQueue.length === 0) return;
  if (!confirm(`Delete ALL ${deferredQueue.length} deferred document(s)?\n\n` +
               `Their files and extracted data are permanently removed. This cannot be undone.`)) return;

  const res = await window.docusnap.deleteAllDeferred();
  if (!res?.success) { showToast(res?.error || 'Delete failed.', 'err'); return; }
  const hadCurrent = deferredQueue.some(d => d.id === currentDoc?.id);
  deferredQueue = [];
  if (hadCurrent) { currentDoc = null; clearDocPanel(); }
  updateTabCounts();
  renderDeferredList();
  window.docusnap.notifyReviewComplete();
  showToast(`Deleted ${res.deleted} deferred document(s).`, 'ok');
});

// ── Delete ────────────────────────────────────────────────────────────────────
document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!currentDoc) return;
  if (!confirm(`Delete "${currentDoc.original_filename}"? This cannot be undone.`)) return;

  const filePath = currentDoc.folder_path
    ? `${currentDoc.folder_path}\\${currentDoc.original_filename}`
    : null;

  docImg.src = '';
  docImgWrap.style.display = 'none';
  await new Promise(r => setTimeout(r, 100));

  await window.docusnap.deleteDocument(currentDoc.id, filePath);
  queue         = queue.filter(d => d.id !== currentDoc.id);
  deferredQueue = deferredQueue.filter(d => d.id !== currentDoc.id);
  updateTabCounts();
  advanceAfterAction();
  window.docusnap.notifyReviewComplete();
});

// Delete a queued document straight from its row's "×" (Edit/Admin only — the
// control is rendered only for those roles, and delete-document is role-gated
// server-side). Reuses the same delete flow as the action-bar Delete button.
async function deleteFromQueue(doc) {
  if (!doc) return;
  if (!confirm(`Delete "${doc.original_filename}"? This cannot be undone.`)) return;
  const filePath = doc.folder_path ? `${doc.folder_path}\\${doc.original_filename}` : null;
  await window.docusnap.deleteDocument(doc.id, filePath);
  queue         = queue.filter(d => d.id !== doc.id);
  deferredQueue = deferredQueue.filter(d => d.id !== doc.id);
  updateTabCounts();
  if (currentDoc?.id === doc.id) advanceAfterAction();  // deleted the open doc → load next / clear panel
  else                          renderQueueList();      // keep current selection, just refresh the list
  window.docusnap.notifyReviewComplete();
}

// ── After confirm/delete: load next doc in the active tab's list ──────────────
function advanceAfterAction() {
  if (activeTab === 'deferred') {
    renderDeferredList();
    if (deferredQueue.length > 0) selectDoc(deferredQueue[0]);
    else { currentDoc = null; clearDocPanel(); }
  } else {
    renderQueueList();
    if (queue.length > 0) selectDoc(queue[0]);
    else { currentDoc = null; clearDocPanel(); }
  }
}

// ── Logo fingerprinting ───────────────────────────────────────────────────────
async function getPageBase64() {
  const canvas = document.createElement('canvas');
  canvas.width  = docImg.naturalWidth;
  canvas.height = docImg.naturalHeight;
  canvas.getContext('2d').drawImage(docImg, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

async function attemptLogoMatch() {
  if (!docImg.complete || !docImg.naturalWidth) return;
  try {
    const b64   = await getPageBase64();
    const match = await window.docusnap.matchLogoHash(b64);
    if (match && match.confidence >= 60) {
      const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
      if (supplierInput && !supplierInput.value.trim()) {
        supplierInput.value = match.supplier_name;
        supplierInput.classList.add('corrected');
        corrections['supplier_name'] = { original_value: '', corrected_value: match.supplier_name };
        validateConfirm();
        const header = document.getElementById('fields-header');
        const note = document.createElement('div');
        note.style.cssText = 'font-size:10px; color:var(--ok); margin-top:3px;';
        note.textContent = `Logo matched: ${match.supplier_name} (${match.confidence}%)`;
        header.appendChild(note);
        setTimeout(() => note.remove(), 4000);
      }
    }
  } catch (err) {
    console.warn('Logo match failed (non-critical):', err);
  }
}

async function saveLogoOnConfirm(supplierName) {
  if (!supplierName || !docImg.complete || !docImg.naturalWidth) return;
  try {
    const b64    = await getPageBase64();
    const hashes = await window.docusnap.extractLogoHash(b64);
    if (hashes && hashes.phash) {
      await window.docusnap.saveLogoFingerprint({
        supplier_name: supplierName,
        phash:         hashes.phash,
        ahash:         hashes.ahash || hashes.phash,
      });
    }
  } catch (err) {
    console.warn('Logo save failed (non-critical):', err);
  }
}

// ── OCR Enhancement controls ──────────────────────────────────────────────────
document.getElementById('btn-enhance-toggle').addEventListener('click', () => {
  const controls = document.getElementById('enhance-controls');
  const btn      = document.getElementById('btn-enhance-toggle');
  const open     = controls.classList.toggle('open');
  // The toggle is now an icon button in the side rail — reflect open state with
  // a class instead of rewriting the label (which would clobber the icon).
  btn.classList.toggle('open', open);
});

// Click-away: close an open rail flyout (OCR enhancement / Split PDF) when the
// user clicks anywhere outside it and its trigger — not only by toggling again.
// The trigger's own handler runs first on a toggle click and the trigger is
// excluded here, so opening/closing via the button is unaffected; clicks inside
// the flyout (adjusting controls) are excluded too.
document.addEventListener('click', (e) => {
  const enhControls = document.getElementById('enhance-controls');
  const enhToggle   = document.getElementById('btn-enhance-toggle');
  if (enhControls?.classList.contains('open') &&
      !enhControls.contains(e.target) && !enhToggle.contains(e.target)) {
    enhControls.classList.remove('open');
    enhToggle.classList.remove('open');
  }
  const splitBar = document.getElementById('split-bar');
  const splitBtn = document.getElementById('btn-split-pdf');
  if (splitBar && splitBar.style.display !== 'none' && splitBar.style.display !== '' &&
      !splitBar.contains(e.target) && !splitBtn.contains(e.target)) {
    splitBar.style.display = 'none';
  }
});

document.getElementById('enh-threshold').addEventListener('change', function () {
  const slider = document.getElementById('enh-threshold-level');
  const label  = document.getElementById('enh-threshold-value');
  slider.style.display = this.checked ? '' : 'none';
  label.style.display  = this.checked ? '' : 'none';
  schedulePreviewRefresh();
});

document.getElementById('enh-threshold-level').addEventListener('input', function () {
  document.getElementById('enh-threshold-value').textContent = this.value;
  schedulePreviewRefresh();
});

['enh-grayscale', 'enh-autocontrast', 'enh-deskew'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => schedulePreviewRefresh());
});

const NOISE_LEVEL_LABELS = ['Off', 'Low', 'Medium', 'High'];
document.getElementById('enh-noise').addEventListener('input', function () {
  document.getElementById('enh-noise-value').textContent = NOISE_LEVEL_LABELS[parseInt(this.value, 10)] || 'Off';
  schedulePreviewRefresh();
});

function getEnhanceParams() {
  const grayscale    = document.getElementById('enh-grayscale').checked;
  const autocontrast = document.getElementById('enh-autocontrast').checked;
  const deskew       = document.getElementById('enh-deskew').checked;
  const threshold    = document.getElementById('enh-threshold').checked;
  const noiseLevel   = parseInt(document.getElementById('enh-noise').value, 10) || 0;
  if (!grayscale && !autocontrast && !deskew && !threshold && !noiseLevel) return null;
  return {
    grayscale,
    autocontrast,
    deskew,
    threshold,
    threshold_level: parseInt(document.getElementById('enh-threshold-level').value, 10),
    noise_level: noiseLevel,
  };
}

// ── OCR preview ───────────────────────────────────────────────────────────────
function _clearPreviewState() {
  previewActive = false;
  previewCache.clear();
  clearTimeout(_previewDebounce);
  const banner = document.getElementById('preview-banner');
  if (banner) banner.classList.remove('visible');
  const btn = document.getElementById('btn-preview-ocr');
  if (btn) { btn.innerHTML = '&#9658; Preview OCR'; btn.classList.remove('active'); }
}

function deactivatePreview() {
  _clearPreviewState();
  renderPage();
}

async function generateEnhancedPreview(page) {
  if (!currentDoc) return null;
  const params = getEnhanceParams();
  if (!params) return null;
  try {
    return await window.docusnap.getEnhancedPreview({
      folderPath:    currentDoc.folder_path,
      filename:      currentDoc.original_filename,
      page,
      enhanceParams: params,
    });
  } catch (e) {
    console.warn('[preview]', e.message);
    return null;
  }
}

async function refreshPreviewNow() {
  if (!previewActive) return;
  clearTimeout(_previewDebounce);
  const page = currentPage;
  if (previewCache.has(page)) { renderPage(); return; }
  ocrOverlay.classList.add('visible');
  const uri = await generateEnhancedPreview(page);
  ocrOverlay.classList.remove('visible');
  if (previewActive && uri && currentPage === page) {
    previewCache.set(page, uri);
    renderPage();
  }
}

function schedulePreviewRefresh() {
  if (!previewActive) return;
  previewCache.clear();
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(() => refreshPreviewNow(), 600);
}

async function activatePreview() {
  if (!currentDoc) return;
  const params = getEnhanceParams();
  if (!params) { showToast('Enable at least one enhancement option first', 'warn'); return; }
  previewActive = true;
  previewCache.clear();
  document.getElementById('preview-banner').classList.add('visible');
  const btn = document.getElementById('btn-preview-ocr');
  btn.innerHTML = '&#9632; Hide Preview';
  btn.classList.add('active');
  await refreshPreviewNow();
  if (!previewCache.has(currentPage)) {
    deactivatePreview();
    showToast('Preview generation failed', 'err');
  }
}

document.getElementById('btn-preview-ocr').addEventListener('click', () => {
  if (previewActive) deactivatePreview();
  else activatePreview();
});

document.getElementById('btn-preview-exit').addEventListener('click', () => {
  deactivatePreview();
});

// After a reprocess re-identifies the document type, sync the dropdown,
// selectedTypeSlug and fieldDefs to the freshly persisted type so the correct
// field set renders and the detected type is pre-selected — the same dropdown
// sync _selectDoc performs on load. No-op when the record carries no type, so a
// borderline reprocess leaves the user's current selection untouched.
function syncDocTypeFromRecord(doc) {
  if (!doc || !doc.type_slug) return;
  selectedTypeSlug = doc.type_slug;
  const sel = document.getElementById('doctype-select');
  if (sel) sel.value = selectedTypeSlug;
  const dt = allDocTypes.find(t => t.slug === selectedTypeSlug);
  if (dt) fieldDefs = dt.fields;
}

// ── Reprocess ─────────────────────────────────────────────────────────────────
document.getElementById('btn-reprocess').addEventListener('click', async () => {
  if (!currentDoc) return;
  const btn = document.getElementById('btn-reprocess');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Reprocessing…';

  window.docusnap.removeReprocessProgress();
  window.docusnap.onReprocessProgress((msg) => {
    if (msg.type === 'log') console.log('[Reprocess]', msg.text);
  });

  // Manual OCR Enhancement controls only affect this reprocess while OCR
  // Preview is active for this document — preview-off means inactive, not
  // hidden-active. (A template-level auto-processing rule, if any, is
  // applied on the main process side regardless of preview state.)
  const result = await window.docusnap.reprocessDocument({
    docId:         currentDoc.id,
    folderPath:    currentDoc.folder_path,
    filename:      currentDoc.original_filename,
    enhanceParams: previewActive ? getEnhanceParams() : null,
  });

  window.docusnap.removeReprocessProgress();

  if (result.success && result.extractions) {
    const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
    if (full) {
      currentDoc  = full;    // sync in-memory state to fresh DB record
      corrections = {};      // drop stale corrections; fields are now fresh
      syncDocTypeFromRecord(full); // auto-select the newly detected type
    }
    renderFields(full || currentDoc);
    if (result.ruleCreated) {
      showToast(`OCR auto-processing enabled for template "${result.ruleCreated}"`, 'ok');
    }
    btn.innerHTML = '✓ Reprocessed';
    btn.style.color = 'var(--ok)';
    btn.style.borderColor = 'var(--ok)';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '&#9654;&#9654; Reprocess with Learned Data';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 3000);
  } else {
    btn.disabled = false;
    btn.innerHTML = '&#9654;&#9654; Reprocess with Learned Data';
    btn.style.color = 'var(--err)';
    setTimeout(() => { btn.style.color = ''; }, 2000);
  }
});

// ── Add to Template Manager (explicit promotion) ──────────────────────────────
// Templates are no longer auto-created/refreshed on every confirm — this is
// the deliberate escalation path for a recurring layout that keeps
// misdetecting. It snapshots the currently reviewed/edited field values
// (same shape confirm-review sends) into a managed template, independent of
// confirming this document. Automatic learning (anchors/hints/corrections)
// is unaffected and keeps happening on every confirm regardless.
document.getElementById('btn-add-template').addEventListener('click', async () => {
  if (!currentDoc) return;
  const btn = document.getElementById('btn-add-template');

  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(input => {
    allValues[input.dataset.key] = input.value;
  });

  const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
  const supplierName  = supplierInput?.value?.trim() || currentDoc?.supplier_name || null;
  const docTypeSlug   = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null;

  // A template must be tied to a real document type, or it's created with a null
  // type and the Template Manager shows no fields to map (the custom-type bug).
  // Block until one is selected — the backend enforces this too.
  if (!docTypeSlug) {
    showToast('Select a document type before adding to Template Manager.', 'warn');
    return;
  }

  btn.disabled = true;
  const result = await window.docusnap.promoteToTemplate({
    document_id:        currentDoc.id,
    allValues,
    document_type_slug: docTypeSlug,
    supplier_name:      supplierName,
  });
  btn.disabled = false;

  if (result?.success) {
    const verb = result.created ? 'Created' : 'Updated';
    showToast(`${verb} managed template "${result.name}" — opening editor…`, 'ok');
    // Hand off to the template editor with this document already pinned as the
    // sample (set server-side in promote-to-template), so its preview loads
    // automatically — no second manual browse for the same document.
    if (result.templateId) window.docusnap.openSettingsWindowAtTemplate(result.templateId);
  } else {
    showToast(result?.error || 'Could not save template', 'err');
  }
});

// ── Reprocess All (with cooperative Stop) ─────────────────────────────────────
let _batchActive  = false;
let _batchStopped = false;

document.getElementById('btn-stop-reprocess').addEventListener('click', () => {
  if (!_batchActive) return;
  _batchStopped = true;
  const btnStop = document.getElementById('btn-stop-reprocess');
  btnStop.disabled = true;
  btnStop.innerHTML = 'Stopping…';
});

document.getElementById('btn-reprocess-all').addEventListener('click', async () => {
  if (queue.length === 0) { showToast('No documents in queue', 'warn'); return; }
  if (_batchActive) return;

  const btnAll  = document.getElementById('btn-reprocess-all');
  const btnOne  = document.getElementById('btn-reprocess');
  const btnStop = document.getElementById('btn-stop-reprocess');

  _batchActive  = true;
  _batchStopped = false;
  btnAll.disabled      = true;
  btnOne.disabled      = true;
  btnStop.disabled     = false;
  btnStop.innerHTML    = '&#9632; Stop';
  btnStop.style.display = '';

  const docs  = [...queue];   // snapshot; queue is refetched in finally
  const total = docs.length;
  let done    = 0;
  let failed  = 0;
  let nextIdx = 0;            // shared cursor handed out to the worker pool

  // Bounded parallel reprocess: run up to `processing_concurrency` reprocess
  // calls at once (default 1 = the original serial behaviour). Each call is the
  // SAME reprocess-document IPC the single-doc Reprocess button uses; the heavy
  // OCR/extraction runs in parallel Python processes, while every DB write stays
  // serialized on the single-threaded JS event loop (better-sqlite3 is
  // synchronous) — so there is no SQLite contention or lost updates. Stop is
  // cooperative: in-flight documents finish, no new ones start.
  let concurrency = parseInt(await window.docusnap.getSetting('processing_concurrency'), 10);
  if (!Number.isFinite(concurrency)) concurrency = 1;
  concurrency = Math.max(1, Math.min(5, concurrency));

  const runOne = async (doc) => {
    try {
      const result = await window.docusnap.reprocessDocument({
        docId:      doc.id,
        folderPath: doc.folder_path,
        filename:   doc.original_filename,
      });
      if (!result?.success) failed++;
      // Refresh the open document's panel only if IT was reprocessed AND is
      // still the open doc when its result lands (the user may have navigated
      // away while other workers were running).
      if (result?.success && currentDoc && doc.id === currentDoc.id) {
        const full = await window.docusnap.getDocumentWithExtractions(doc.id);
        if (full && currentDoc && currentDoc.id === doc.id) {
          currentDoc  = full;
          corrections = {};
          syncDocTypeFromRecord(full); // auto-select the newly detected type
          renderFields(full);
        }
      }
    } catch (e) {
      console.warn(`[Reprocess All] ${doc.original_filename}:`, e.message);
      failed++;
    }
    done++;
    btnAll.innerHTML = `<span class="btn-spinner"></span> ${done}/${total}`;
  };

  // One worker pulls the next index off the shared cursor until the list is
  // exhausted or Stop is requested. `nextIdx++` is safe without locking — there
  // is no await between read and increment, so each index is handed out once.
  const worker = async () => {
    while (!_batchStopped) {
      const i = nextIdx++;
      if (i >= docs.length) return;
      await runOne(docs[i]);
    }
  };

  try {
    const poolSize = Math.max(1, Math.min(concurrency, docs.length));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } finally {
    // Always runs — covers normal completion, stop, and unexpected throws
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts();
    renderQueueList();

    _batchActive         = false;
    btnAll.disabled      = false;
    btnOne.disabled      = false;
    btnStop.style.display = 'none';
    btnAll.innerHTML     = '&#9654;&#9654; Reprocess All';
  }

  const ok = done - failed;
  if (_batchStopped) {
    const remaining = queue.length;
    showToast(
      `Stopped after ${done} — ${remaining} remaining in queue`,
      'warn'
    );
  } else {
    showToast(
      failed ? `Reprocessed ${ok}/${done} — ${failed} failed` : `Reprocessed ${done} document${done !== 1 ? 's' : ''}`,
      failed ? 'warn' : 'ok'
    );
  }
});

// ── Split PDF ─────────────────────────────────────────────────────────────────
// Split mode: show the range input only for "by range", the N field only for
// "every N pages"; "every page" needs no extra input.
function applySplitMode() {
  const mode = document.getElementById('split-mode').value;
  document.getElementById('split-ranges-input').style.display = mode === 'ranges' ? '' : 'none';
  document.getElementById('split-everyn-wrap').style.display  = mode === 'everyn' ? 'flex' : 'none';
}
document.getElementById('split-mode').addEventListener('change', () => {
  applySplitMode();
  const mode = document.getElementById('split-mode').value;
  (mode === 'ranges' ? document.getElementById('split-ranges-input')
   : mode === 'everyn' ? document.getElementById('split-every-n') : null)?.focus();
});

document.getElementById('btn-split-pdf').addEventListener('click', () => {
  const bar = document.getElementById('split-bar');
  bar.style.display = 'flex';
  document.getElementById('split-mode').value = 'ranges';
  document.getElementById('split-ranges-input').value = '';
  applySplitMode();
  document.getElementById('split-ranges-input').focus();
});

document.getElementById('btn-split-cancel').addEventListener('click', () => {
  document.getElementById('split-bar').style.display = 'none';
  document.getElementById('split-ranges-input').value = '';
});

async function doSplitPdf() {
  if (!currentDoc) return;
  const mode  = document.getElementById('split-mode').value;
  let ranges, every;
  if (mode === 'each') {
    every = 1;
  } else if (mode === 'everyn') {
    every = parseInt(document.getElementById('split-every-n').value, 10);
    if (!(every >= 1)) { document.getElementById('split-every-n').focus(); return; }
  } else {
    const input = document.getElementById('split-ranges-input');
    ranges = input.value.trim();
    if (!ranges) { input.focus(); return; }
  }

  const filePath  = currentDoc.folder_path + '\\' + currentDoc.original_filename;
  const docId     = currentDoc.id;
  const btnSplit  = document.getElementById('btn-split-confirm');
  btnSplit.disabled = true;
  btnSplit.innerHTML = '<span class="btn-spinner"></span>';

  try {
    const result = await window.docusnap.splitPdf(filePath, ranges, undefined, docId, every);
    if (result?.success) {
      const count = result.files?.length ?? 0;
      // Remove original from local queue state — it has been deleted from DB + disk.
      queue = queue.filter(d => d.id !== docId);
      currentDoc = null;
      clearDocPanel();
      renderQueueList();
      showToast(`Split into ${count} file${count !== 1 ? 's' : ''}`, 'ok');
      // review-count-changed event (fired by IPC handler) will reload the full
      // queue and surface the newly registered split files.
    } else {
      showToast('Split failed: ' + (result?.error || 'unknown error'), 'err');
    }
  } catch (err) {
    showToast('Split failed: ' + err.message, 'err');
  } finally {
    btnSplit.disabled = false;
    btnSplit.innerHTML = '&#9986; Split';
  }
}

document.getElementById('btn-split-confirm').addEventListener('click', doSplitPdf);
document.getElementById('split-ranges-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  doSplitPdf();
  if (e.key === 'Escape') {
    document.getElementById('split-bar').style.display = 'none';
    document.getElementById('split-ranges-input').value = '';
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function clearDocPanel() {
  _clearPreviewState();
  docImgWrap.style.display = 'none';
  const ph = document.getElementById('doc-placeholder');
  ph.style.display = '';
  ph.textContent   = 'All documents reviewed ✓';
  document.getElementById('doc-name').textContent = '—';
  document.getElementById('fields-scroll').innerHTML = '';
  document.getElementById('doctype-select').value = '';
  selectedTypeSlug = null;
  document.getElementById('btn-confirm').disabled = true;
  document.getElementById('btn-split-pdf').style.display  = 'none';
  document.getElementById('split-bar').style.display      = 'none';
  const extStatus = document.getElementById('extraction-status');
  if (extStatus) extStatus.innerHTML = '';
  updateDocNavButtons();   // no current document → both arrows disabled
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(msg, level = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = level;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Keep both overlay canvases' pixel buffers exactly equal to the DISPLAYED image
// size — the single source of truth for normalized<->screen mapping (Template
// Manager's model). This makes boxes stay aligned and fully drawable across image
// load (incl. cached), window/pane resize, and zoom, and removes the right-edge
// "barrier" a stale/undersized buffer caused. Transform-based zoom does not change
// offsetWidth, so this never loops on zoom; canvasPoint() handles the scaled rect.
new ResizeObserver(() => {
  if (!pageImages.length) return;
  const w = docImg.offsetWidth, h = docImg.offsetHeight;
  if (!w || !h || (w === selCanvas.width && h === selCanvas.height)) return;
  selCanvas.width = w; selCanvas.height = h;
  wizCanvas.width = w; wizCanvas.height = h;
  clearCanvas();
  redrawWizard();
}).observe(docImg);

// Navigate to a specific doc when Review is already open (e.g. second "Edit in Review" click).
window.docusnap.onNavigateToDoc((docId) => _navigateToDoc(docId));

function _navigateToDoc(docId) {
  const inReview   = queue.find(d => d.id === docId);
  const inDeferred = deferredQueue.find(d => d.id === docId);
  const doc        = inReview || inDeferred;
  if (!doc) return;

  if (inDeferred && activeTab !== 'deferred') {
    activeTab = 'deferred';
    document.getElementById('tab-deferred').classList.add('active');
    document.getElementById('tab-review').classList.remove('active');
    renderDeferredList();
  } else if (inReview && activeTab !== 'review') {
    activeTab = 'review';
    document.getElementById('tab-review').classList.add('active');
    document.getElementById('tab-deferred').classList.remove('active');
    renderQueueList();
  }

  selectDoc(doc);
}

// Auto-refresh queue when main process signals new docs were added
window.docusnap.onReviewCountChanged(async (n) => {
  // While File All Ready is running, each per-doc confirm broadcasts this event
  // back to us; re-fetching here would clobber the loop's local queue mid-run and
  // leave just-filed docs as ghosts in the list. fileAllReady does one clean
  // refresh once it finishes, so it's safe to ignore these interim signals.
  if (bulkFiling) return;
  const prevId  = currentDoc?.id;
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  updateTabCounts();
  if (activeTab === 'review')   renderQueueList();
  if (activeTab === 'deferred') renderDeferredList();
  // Auto-select first doc if nothing is currently loaded
  if (!prevId && queue.length > 0 && activeTab === 'review') selectDoc(queue[0]);
});

// ── Preview zoom / pan ────────────────────────────────────────────────────────
// Mirrors the Template Manager interaction model: a CSS transform on the image
// wrapper (scale + translate), with a coordinate-compensation helper so canvas
// drags map back to unscaled canvas-buffer pixels at any zoom/pan. At zoom 1 the
// transform is the identity and canvasPoint() returns the same value the old
// `clientX - rect.left` math did — so existing zone-OCR is byte-for-byte unchanged.
function applyPreviewTransform() {
  docImgWrap.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewZoom})`;
  const lvl = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(previewZoom * 100) + '%';
}
function setPreviewZoom(z) {
  previewZoom = Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, z));
  applyPreviewTransform();
}
function resetPreviewView() {
  previewZoom = 1; previewPanX = 0; previewPanY = 0;
  applyPreviewTransform();
}

// Convert a mouse event to canvas-BUFFER pixels, compensating for the wrapper's
// scale (getBoundingClientRect reports the scaled/panned rect; the buffer stays
// at the unscaled rendered-image size). rect.left/top already include the pan.
function canvasPoint(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width  / r.width),
    y: (e.clientY - r.top)  * (canvas.height / r.height),
  };
}

document.getElementById('btn-zoom-in') ?.addEventListener('click', () => setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP));
document.getElementById('btn-zoom-out')?.addEventListener('click', () => setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP));
document.getElementById('btn-zoom-reset')?.addEventListener('click', resetPreviewView);

// Right-click drag pans the preview (same as Template Manager). Left-click is
// left untouched so zone-OCR / wizard drawing keep working.
let _panStart = null;
const _docViewer = document.getElementById('doc-viewer');
// Mirror Template Manager: suppress the context menu (so right-drag can pan) only
// when a document is shown, and block native image/file dragging on the preview so
// neither left- nor right-drag grabs a file/icon ghost. (#doc-img also has
// draggable="false"; this catches any bubbled dragstart from its children.)
_docViewer.addEventListener('contextmenu', (e) => { if (pageImages.length) e.preventDefault(); });
_docViewer.addEventListener('dragstart', (e) => e.preventDefault());
_docViewer.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;
  _panStart = { x: e.clientX, y: e.clientY, panX: previewPanX, panY: previewPanY };
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!_panStart) return;
  previewPanX = _panStart.panX + (e.clientX - _panStart.x);
  previewPanY = _panStart.panY + (e.clientY - _panStart.y);
  applyPreviewTransform();
});
window.addEventListener('mouseup', () => { _panStart = null; });

// ── Template Wizard (Stage 1: admin-only shell + draft drawing, NO persistence) ─
// Reuses existing template CONCEPTS only as UI state; it does not call
// promote-to-template / save-template-mapping / set-template-field-fixed yet —
// that wiring lands in Stage 2. Field order = the current document type's fields
// (same source the Template Manager mapping editor uses).
function applyAnchorWizardGate() {
  const btn = document.getElementById('btn-anchor-wizard');
  if (btn) btn.style.display = isAdmin ? '' : 'none';
}

function wizardFieldList() {
  const slug = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug;
  const dt = allDocTypes.find(t => t.slug === slug);
  const fields = (dt?.fields && dt.fields.length) ? dt.fields : (fieldDefs || []);
  return fields.map(f => ({ key: f.key, label: f.label || f.key }));
}

async function openWizard() {
  if (!isAdmin) return;                       // defence-in-depth; button is hidden for non-admins
  if (!pageImages.length) { showToast('Open a document first', 'warn'); return; }
  cancelZoneMode();                           // don't fight the zone-OCR tool
  wizard.active = true;
  wizard.fields = wizardFieldList();
  wizard.fixedMode = false;
  wizard.savedKeys = new Set();
  const openMgr = document.getElementById('wiz-open-manager');
  if (openMgr) openMgr.style.display = 'none';

  const sel = document.getElementById('wiz-field-select');
  sel.innerHTML = '';
  for (const f of wizard.fields) {
    const o = document.createElement('option');
    o.value = f.key; o.textContent = `${f.label} (${f.key})`;
    sel.appendChild(o);
  }
  document.getElementById('wizard-panel').classList.add('visible');
  document.getElementById('btn-anchor-wizard').classList.add('open');
  wizCanvas.classList.add('active');

  await resolveWizardTemplate();              // resolve existing template + cache saved mappings
  if (!wizard.active) return;                 // wizard was closed while awaiting
  if (wizard.templateId) document.getElementById('wiz-open-manager').style.display = '';
  loadWizardField(0);                         // rehydrates this field's saved boxes (if any)
}

// Resolve the document's template (its own template_id, else a current
// fingerprint match) and cache its persisted field mappings so saved boxes can
// be rehydrated. Leaves templateId null when the document has no template yet —
// the first save then promotes/creates one (Stage 2 behaviour, unchanged).
async function resolveWizardTemplate() {
  wizard.templateId   = currentDoc?.template_id || null;
  wizard.mappingsByKey = new Map();
  if (!wizard.templateId && currentDoc) {
    try {
      const m = await window.docusnap.checkTemplateMatch(currentDoc.id);
      if (m?.matched && m.templateId) wizard.templateId = m.templateId;
    } catch (e) { /* no match — first save will promote */ }
  }
  if (wizard.templateId) {
    try {
      const detail = await window.docusnap.getTemplateDetail(wizard.templateId);
      for (const mp of (detail?.field_mappings || [])) wizard.mappingsByKey.set(mp.field_key, mp);
    } catch (e) { console.warn('wizard rehydrate failed:', e.message); }
  }
}

function exitWizard() {
  wizard.active = false;
  wizard.drawMode = null;
  wizard.isDragging = false;
  wizard.dragRect = null;
  wizard.draftAnchor = wizard.draftTarget = null;
  wizard.selectedBox = null;
  wizard.moveStart = null;
  document.getElementById('wizard-panel').classList.remove('visible');
  document.getElementById('btn-anchor-wizard')?.classList.remove('open');
  document.getElementById('wiz-open-manager').style.display = 'none';
  wizCanvas.classList.remove('active', 'drawing');
  wizCanvas.style.cursor = 'default';
  wizCtx.clearRect(0, 0, wizCanvas.width, wizCanvas.height);
}

function loadWizardField(i) {
  if (!wizard.fields.length) return;
  wizard.index = Math.max(0, Math.min(wizard.fields.length - 1, i));
  wizard.step = 'field';
  wizard.draftAnchor = wizard.draftTarget = null;
  wizard.selectedBox = null;
  wizard.moveStart = null;
  wizard.drawMode = null;
  wizCanvas.classList.remove('drawing');

  const f = wizard.fields[wizard.index];
  document.getElementById('wiz-field-select').value = f.key;
  document.getElementById('wiz-fixed-value').value = '';
  document.getElementById('wiz-fixed-toggle').checked = false;
  wizard.fixedMode = false;

  // Rehydrate a previously-saved mapping for this field so its boxes are visible
  // and editable on reopen. Stored normalized, so it re-renders correctly at the
  // current preview scale (no stored pixels).
  const saved = wizard.mappingsByKey && wizard.mappingsByKey.get(f.key);
  if (saved && saved.anchor_x_norm != null && saved.target_x_norm != null
      && (saved.page_number || 0) === currentPage) {   // only show a box that belongs to this page
    wizard.draftAnchor = { x_norm: saved.anchor_x_norm, y_norm: saved.anchor_y_norm,
                           w_norm: saved.anchor_w_norm, h_norm: saved.anchor_h_norm };
    wizard.draftTarget = { x_norm: saved.target_x_norm, y_norm: saved.target_y_norm,
                           w_norm: saved.target_w_norm, h_norm: saved.target_h_norm };
    document.getElementById('wiz-anchor-text').value = saved.anchor_text || '';
    document.getElementById('wiz-ocr-type').value    = saved.ocr_type || 'text';
  } else {
    document.getElementById('wiz-anchor-text').value = '';
    document.getElementById('wiz-ocr-type').value    = 'text';
  }

  updateWizardUI();
  redrawWizard();
}

function updateWizardUI() {
  const f = wizard.fields[wizard.index];
  document.getElementById('wiz-step').textContent =
    `Field ${wizard.index + 1} of ${wizard.fields.length}${f ? ' — ' + f.label : ''}`;
  document.getElementById('wiz-anchor-block').style.display = wizard.fixedMode ? 'none' : '';
  document.getElementById('wiz-fixed-block').style.display  = wizard.fixedMode ? '' : 'none';

  const st = document.getElementById('wiz-status');
  if (wizard.fixedMode) {
    const hasVal = !!document.getElementById('wiz-fixed-value').value.trim();
    st.textContent = hasVal ? 'Fixed value ready ✓' : 'Enter a fixed value';
    st.className = 'wiz-status' + (hasVal ? ' ok' : '');
  } else {
    const a = !!wizard.draftAnchor, t = !!wizard.draftTarget;
    st.textContent = `Anchor: ${a ? 'drawn ✓' : '—'} · Target: ${t ? 'drawn ✓' : '—'}`;
    st.className = 'wiz-status' + (a && t ? ' ok' : '');
  }

  document.getElementById('wiz-draw-anchor').classList.toggle('armed', wizard.drawMode === 'anchor');
  document.getElementById('wiz-draw-target').classList.toggle('armed', wizard.drawMode === 'target');

  // Save enablement: mapping mode needs both boxes; fixed mode needs a value.
  const ready = wizard.fixedMode
    ? !!document.getElementById('wiz-fixed-value').value.trim()
    : (!!wizard.draftAnchor && !!wizard.draftTarget);
  const saveBtn = document.getElementById('wiz-save');
  if (saveBtn) saveBtn.disabled = !ready;
}

function armWizardDraw(mode) {
  if (!wizard.active || wizard.fixedMode) return;
  wizard.drawMode = wizard.drawMode === mode ? null : mode;
  wizCanvas.classList.toggle('drawing', !!wizard.drawMode);
  updateWizardUI();
}

// Which drawn box (if any) is under a canvas-buffer point. Target is drawn on
// top, so it is hit-tested first.
function wizHitTest(p) {
  const w = wizCanvas.width, h = wizCanvas.height;
  const inside = (n) => n && p.x >= n.x_norm * w && p.x <= (n.x_norm + n.w_norm) * w
                          && p.y >= n.y_norm * h && p.y <= (n.y_norm + n.h_norm) * h;
  if (inside(wizard.draftTarget)) return 'target';
  if (inside(wizard.draftAnchor)) return 'anchor';
  return null;
}

function drawWizBox(n, color, selected) {
  const w = wizCanvas.width, h = wizCanvas.height;
  const x = Math.round(n.x_norm * w), y = Math.round(n.y_norm * h);
  const bw = Math.round(n.w_norm * w), bh = Math.round(n.h_norm * h);
  wizCtx.setLineDash(selected ? [] : [5, 4]);    // solid when selected (mirrors Template Manager)
  wizCtx.lineWidth = selected ? 2 : 1.5; wizCtx.strokeStyle = color;
  wizCtx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  wizCtx.setLineDash([]);
  wizCtx.fillStyle = color + (selected ? '33' : '22'); wizCtx.fillRect(x, y, bw, bh);
}

function redrawWizard() {
  if (!wizCanvas.width) return;
  wizCtx.clearRect(0, 0, wizCanvas.width, wizCanvas.height);
  if (!wizard.active) return;
  if (wizard.draftAnchor) drawWizBox(wizard.draftAnchor, '#4f8ef7', wizard.selectedBox === 'anchor');
  if (wizard.draftTarget) drawWizBox(wizard.draftTarget, '#3ecf8e', wizard.selectedBox === 'target');
  if (wizard.dragRect) {
    const c = wizard.drawMode === 'target' ? '#3ecf8e' : '#4f8ef7';
    const r = wizard.dragRect;
    wizCtx.setLineDash([5, 4]); wizCtx.strokeStyle = c; wizCtx.lineWidth = 1;
    wizCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    wizCtx.setLineDash([]); wizCtx.fillStyle = c + '18'; wizCtx.fillRect(r.x, r.y, r.w, r.h);
  }
}

// Left-click model mirrors Template Manager: armed → draw a fresh box; not armed →
// click selects a box and drag repositions it. Right-button is ignored here so it
// bubbles to the doc-viewer pan handler.
wizCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !wizard.active) return;
  const p = canvasPoint(e, wizCanvas);
  if (wizard.drawMode) {
    wizard.isDragging = true;
    wizard.dragStart = { x: p.x, y: p.y };
    wizard.dragRect = { x: p.x, y: p.y, w: 0, h: 0 };
    wizard.selectedBox = null;
    wizard.moveStart = null;
    return;
  }
  // Not armed: select the box under the point (if any) and arm a move from here.
  const hit = wizHitTest(p);
  wizard.selectedBox = hit;
  wizard.moveStart = hit
    ? { pt: p, orig: { ...(hit === 'anchor' ? wizard.draftAnchor : wizard.draftTarget) } }
    : null;
  redrawWizard();
});
wizCanvas.addEventListener('mousemove', (e) => {
  // Drawing a new box.
  if (wizard.isDragging && wizard.dragRect) {
    const p = canvasPoint(e, wizCanvas);
    wizard.dragRect = {
      x: Math.min(wizard.dragStart.x, p.x), y: Math.min(wizard.dragStart.y, p.y),
      w: Math.abs(p.x - wizard.dragStart.x), h: Math.abs(p.y - wizard.dragStart.y),
    };
    redrawWizard();
    return;
  }
  // Repositioning the selected box — delta computed in normalized space so it is
  // correct at any zoom/scale, clamped so the box stays on-page.
  if (wizard.moveStart && wizard.selectedBox) {
    const p  = canvasPoint(e, wizCanvas);
    const dx = (p.x - wizard.moveStart.pt.x) / wizCanvas.width;
    const dy = (p.y - wizard.moveStart.pt.y) / wizCanvas.height;
    const o  = wizard.moveStart.orig;
    const moved = { ...o,
      x_norm: Math.max(0, Math.min(1 - o.w_norm, o.x_norm + dx)),
      y_norm: Math.max(0, Math.min(1 - o.h_norm, o.y_norm + dy)) };
    if (wizard.selectedBox === 'anchor') wizard.draftAnchor = moved; else wizard.draftTarget = moved;
    redrawWizard();
    return;
  }
  // Idle hover: show a move cursor over an existing box.
  if (!wizard.drawMode) {
    wizCanvas.style.cursor = wizHitTest(canvasPoint(e, wizCanvas)) ? 'move' : 'default';
  }
});
wizCanvas.addEventListener('mouseup', () => {
  if (wizard.isDragging) {
    wizard.isDragging = false;
    const r = wizard.dragRect; wizard.dragRect = null;
    if (!r || r.w < 8 || r.h < 8) { redrawWizard(); return; }
    const norm = {
      x_norm: r.x / wizCanvas.width,  y_norm: r.y / wizCanvas.height,
      w_norm: r.w / wizCanvas.width,  h_norm: r.h / wizCanvas.height,
    };
    if (wizard.drawMode === 'anchor') { wizard.draftAnchor = norm; wizard.step = 'target'; }
    else                              { wizard.draftTarget = norm; wizard.step = 'review'; }
    wizard.drawMode = null;
    wizCanvas.classList.remove('drawing');
    updateWizardUI();
    redrawWizard();
    return;
  }
  if (wizard.moveStart) {
    wizard.moveStart = null;       // finalize reposition
    updateWizardUI();
    redrawWizard();
  }
});

document.getElementById('btn-anchor-wizard')?.addEventListener('click', () => {
  if (wizard.active) exitWizard(); else openWizard();
});
document.getElementById('wiz-close')?.addEventListener('click', exitWizard);
document.getElementById('wiz-field-select')?.addEventListener('change', (e) => {
  const idx = wizard.fields.findIndex(f => f.key === e.target.value);
  if (idx >= 0) loadWizardField(idx);
});
document.getElementById('wiz-draw-anchor')?.addEventListener('click', () => armWizardDraw('anchor'));
document.getElementById('wiz-draw-target')?.addEventListener('click', () => armWizardDraw('target'));
document.getElementById('wiz-prev')?.addEventListener('click', () => loadWizardField(wizard.index - 1));
document.getElementById('wiz-next')?.addEventListener('click', () => loadWizardField(wizard.index + 1));
document.getElementById('wiz-fixed-toggle')?.addEventListener('change', (e) => {
  wizard.fixedMode = e.target.checked;
  wizard.drawMode = null;
  wizCanvas.classList.remove('drawing');
  updateWizardUI();
});
// Re-evaluate Save enablement as the user types a fixed value.
document.getElementById('wiz-fixed-value')?.addEventListener('input', updateWizardUI);

// Delete / Backspace removes the currently selected drawn box so the user can
// redraw. Scoped: only fires while the wizard is open AND a box is selected, and
// never while typing in a text-entry control (so it can't disturb field edits).
document.addEventListener('keydown', (e) => {
  if (!wizard.active || !wizard.selectedBox) return;
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  e.preventDefault();
  if (wizard.selectedBox === 'anchor')      wizard.draftAnchor = null;
  else if (wizard.selectedBox === 'target') wizard.draftTarget = null;
  wizard.selectedBox = null;
  updateWizardUI();
  redrawWizard();
});

// ── Template Wizard — Stage 2 persistence (existing IPC only) ─────────────────
function setWizStatus(text, kind) {
  const st = document.getElementById('wiz-status');
  st.textContent = text;
  st.className = 'wiz-status' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
}

// Create-or-reuse the template for the current document. Delegates entirely to
// promote-to-template, which already reuses doc.template_id / a logo match (so an
// already-templated document is edited in place, never duplicated) and pins this
// document as the sample. Returns the templateId, or null on failure (status set).
async function ensureWizardTemplate() {
  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(i => { allValues[i.dataset.key] = i.value; });
  const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
  const supplierName  = supplierInput?.value?.trim() || currentDoc?.supplier_name || null;
  const docTypeSlug   = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null;
  if (!docTypeSlug) {
    setWizStatus('Select a document type first', 'err');
    showToast('Select a document type before mapping.', 'warn');
    return null;
  }
  const result = await window.docusnap.promoteToTemplate({
    document_id: currentDoc.id, allValues, document_type_slug: docTypeSlug, supplier_name: supplierName,
  });
  if (!result?.success) { setWizStatus(result?.error || 'Could not create template', 'err'); return null; }
  return result.templateId || null;
}

// Advance to the next field not yet saved in this session; otherwise report done.
function advanceWizardField() {
  const n = wizard.fields.length;
  for (let s = 1; s <= n; s++) {
    const idx = (wizard.index + s) % n;
    if (!wizard.savedKeys.has(wizard.fields[idx].key)) { loadWizardField(idx); return; }
  }
  setWizStatus('All fields mapped ✓', 'ok');
}

async function wizardSave() {
  if (!wizard.active || !isAdmin) return;                // defence-in-depth; IPC is admin-gated too
  const field = wizard.fields[wizard.index];
  if (!field) return;

  const fixed    = wizard.fixedMode;
  const fixedVal = document.getElementById('wiz-fixed-value').value.trim();
  if (fixed ? !fixedVal : (!wizard.draftAnchor || !wizard.draftTarget)) return;  // validation guard

  const saveBtn = document.getElementById('wiz-save');
  saveBtn.disabled = true;
  setWizStatus('Saving…', '');

  // First save resolves (creates/reuses) the template.
  if (!wizard.templateId) {
    const tid = await ensureWizardTemplate();
    if (!tid) { saveBtn.disabled = false; return; }
    wizard.templateId = tid;
    document.getElementById('wiz-open-manager').style.display = '';   // reveal handoff affordance
  }

  try {
    let res, savedMapping = null;
    if (fixed) {
      res = await window.docusnap.setTemplateFieldFixed(wizard.templateId, field.key, fixedVal);
    } else {
      // Normalized coordinates only — saveMapping derives offset_dx/dy_norm server-side.
      savedMapping = {
        field_key:        field.key,
        page_number:      currentPage,
        anchor_text:      document.getElementById('wiz-anchor-text').value.trim() || null,
        anchor_x_norm: wizard.draftAnchor.x_norm, anchor_y_norm: wizard.draftAnchor.y_norm,
        anchor_w_norm: wizard.draftAnchor.w_norm, anchor_h_norm: wizard.draftAnchor.h_norm,
        target_x_norm: wizard.draftTarget.x_norm, target_y_norm: wizard.draftTarget.y_norm,
        target_w_norm: wizard.draftTarget.w_norm, target_h_norm: wizard.draftTarget.h_norm,
        ocr_type:         document.getElementById('wiz-ocr-type').value,
        search_expansion: 0.04,
        enabled:          true,
      };
      res = await window.docusnap.saveTemplateMapping(wizard.templateId, savedMapping);
    }
    if (!res || res.success === false) {
      setWizStatus(res?.error || 'Save failed', 'err');
      saveBtn.disabled = false;
      return;
    }
    // Keep the in-session rehydration cache current so navigating back to this
    // field (or reopening) shows the box without a round-trip.
    if (savedMapping) wizard.mappingsByKey.set(field.key, savedMapping);
    wizard.savedKeys.add(field.key);
    showToast(`Saved ${field.label} to template`, 'ok');
    advanceWizardField();
  } catch (e) {
    setWizStatus('Save failed: ' + e.message, 'err');
    saveBtn.disabled = false;
  }
}

document.getElementById('wiz-save')?.addEventListener('click', wizardSave);
document.getElementById('wiz-open-manager')?.addEventListener('click', () => {
  if (wizard.templateId) window.docusnap.openSettingsWindowAtTemplate(wizard.templateId);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadQueue();
