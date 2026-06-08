'use strict';

// Fallback fields shown when no doc type is selected
const FALLBACK_FIELD_KEYS = ['supplier_name', 'invoice_number', 'invoice_date'];

// ── State ─────────────────────────────────────────────────────────────────────
let queue            = [];
let deferredQueue    = [];
let allDocTypes      = [];
let currentDoc       = null;
let currentPage      = 0;
let pageImages       = [];
let fieldDefs        = [];
let corrections      = {};
let anchorTaughtFields = new Set(); // field_keys taught via the ⊕ highlight/zone-OCR tool this cycle
let activeTab        = 'review';
let selectedTypeSlug = null;   // tracks dropdown selection independently

// Zone selection state
let activeField = null;
let isDragging  = false;
let dragStart   = { x: 0, y: 0 };
let dragRect    = null;

// ── Element refs ──────────────────────────────────────────────────────────────
const docImg     = document.getElementById('doc-img');
const docImgWrap = document.getElementById('doc-img-wrap');
const selCanvas  = document.getElementById('sel-canvas');
const ocrOverlay = document.getElementById('ocr-overlay');
const selectHint = document.getElementById('select-hint');
const hintField  = document.getElementById('hint-field-name');
const hintCancel = document.getElementById('hint-cancel');
const ctx        = selCanvas.getContext('2d');

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Load queue ────────────────────────────────────────────────────────────────
async function loadQueue() {
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  allDocTypes   = await window.docusnap.getAllDocTypes();
  fieldDefs     = allDocTypes.length ? allDocTypes[0].fields : [];
  populateTypeDropdown();
  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);
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
});

document.getElementById('tab-deferred').addEventListener('click', () => {
  activeTab = 'deferred';
  document.getElementById('tab-deferred').classList.add('active');
  document.getElementById('tab-review').classList.remove('active');
  renderDeferredList();
});

function updateTabCounts() {
  document.getElementById('tab-review-count').textContent   = queue.length;
  document.getElementById('tab-deferred-count').textContent = deferredQueue.length;
}

// ── Queue list (review tab) ───────────────────────────────────────────────────
function renderQueueList() {
  document.getElementById('deferred-footer').style.display = 'none';
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  list.innerHTML = '';

  if (queue.length === 0) {
    empty.style.display = '';
    if (!currentDoc) clearDocPanel();
    return;
  }
  empty.style.display = 'none';

  for (const doc of queue) {
    const el = document.createElement('div');
    el.className  = 'queue-item';
    el.dataset.id = doc.id;
    if (currentDoc && doc.id === currentDoc.id) el.classList.add('active');
    el.innerHTML = `
      <span class="qi-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
      <span class="qi-supplier">${escHtml(doc.supplier_name || '—')}</span>
    `;
    el.addEventListener('click', () => selectDoc(doc));
    list.appendChild(el);
  }
}

// ── Deferred list (deferred tab) ─────────────────────────────────────────────
function renderDeferredList() {
  const list   = document.getElementById('queue-list');
  const empty  = document.getElementById('queue-empty');
  const footer = document.getElementById('deferred-footer');
  list.innerHTML = '';

  if (deferredQueue.length === 0) {
    empty.style.display = '';
    empty.textContent = 'No deferred documents';
    footer.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  footer.style.display = 'block';

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
}
async function _selectDoc(doc) {
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
  renderPage();

  let full = null;
  try {
    full = await window.docusnap.getDocumentWithExtractions(doc.id);
  } catch (e) {
    console.warn('getDocumentWithExtractions failed:', e.message);
  }
  renderFields(full || doc);
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

  docImg.onload = () => {
    selCanvas.width  = docImg.offsetWidth;
    selCanvas.height = docImg.offsetHeight;
    clearCanvas();
    if (currentPage === 0) attemptLogoMatch();
  };
  docImg.src = pageImages[currentPage];
  indicator.textContent = `Page ${currentPage + 1} / ${pageImages.length}`;
}

document.getElementById('btn-page-prev').addEventListener('click', () => {
  if (currentPage > 0) { cancelZoneMode(); currentPage--; renderPage(); }
});
document.getElementById('btn-page-next').addEventListener('click', () => {
  if (currentPage < pageImages.length - 1) { cancelZoneMode(); currentPage++; renderPage(); }
});

// ── Fields panel ──────────────────────────────────────────────────────────────
function renderFields(doc) {
  const scroll = document.getElementById('fields-scroll');
  scroll.innerHTML = '';
  if (!doc) { validateConfirm(); return; }

  const extMap = {};
  for (const e of (doc.extractions || [])) extMap[e.field_key] = e;

  for (const key of reviewFields()) {
    const ext = extMap[key] || {};
    const val = ext.display_value ?? ext.raw_value ?? '';
    appendFieldRow(scroll, key, val, ext.confidence ?? null);
  }
  validateConfirm();
}

function appendFieldRow(scroll, key, val, conf) {
  const low      = conf !== null && conf < 70;
  const confClass = conf === null ? '' : conf >= 70 ? 'high' : conf >= 40 ? 'mid' : 'low';
  const confLabel = conf !== null
    ? `<span class="conf-badge ${confClass}">${conf}%</span>`
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
  ctx.strokeStyle = '#FFE000';
  ctx.lineWidth   = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(255,224,0,0.08)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

selCanvas.addEventListener('mousedown', (e) => {
  if (!activeField) return;
  isDragging = true;
  const r    = selCanvas.getBoundingClientRect();
  dragStart  = { x: e.clientX - r.left, y: e.clientY - r.top };
  dragRect   = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
});

selCanvas.addEventListener('mousemove', (e) => {
  if (!isDragging || !dragRect) return;
  const r  = selCanvas.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  dragRect = {
    x: Math.min(dragStart.x, cx),
    y: Math.min(dragStart.y, cy),
    w: Math.abs(cx - dragStart.x),
    h: Math.abs(cy - dragStart.y),
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

async function captureAnchorContext(rect, fieldKey, value, imgW, imgH, scaleX, scaleY) {
  const xNorm    = (rect.x + rect.w / 2) / imgW;
  const yNorm    = (rect.y + rect.h / 2) / imgH;
  const pageZone = yNorm < 0.33 ? 'top' : yNorm < 0.66 ? 'middle' : 'bottom';
  const docType  = currentDoc?.type_slug || currentDoc?.document_type_slug || null;

  const anchorBase = {
    supplier_name: cleanSupplierName(currentDoc?.supplier_name),
    document_type: docType,
    field_key:     fieldKey,
    page_zone:     pageZone,
    x_norm:        xNorm,
    y_norm:        yNorm,
    w_norm:        rect.w / imgW,
    h_norm:        rect.h / imgH,
  };

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
      const leftText  = (await window.docusnap.ocrRegion(leftCanvas.toDataURL('image/png').split(',')[1]) || '').trim();
      const leftLabel = extractLabel(leftText);
      if (leftLabel) {
        await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: leftLabel, direction: 'right' });
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
      const aboveText  = (await window.docusnap.ocrRegion(aboveCanvas.toDataURL('image/png').split(',')[1]) || '').trim();
      const aboveLabel = extractLabel(aboveText);
      if (aboveLabel) {
        await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: aboveLabel, direction: 'below' });
        return true;
      }
    }
  } catch (err) {
    console.warn('Anchor capture: above-label lookup failed (non-critical):', err);
  }

  // Guaranteed fallback — always save SOMETHING so the position is learned
  // even when no nearby label text could be read.
  try {
    const fallbackLabel = labelFor(fieldKey) || fieldKey.replace(/_/g, ' ');
    await window.docusnap.saveFieldAnchor({ ...anchorBase, anchor_label: fallbackLabel, direction: 'right' });
    return true;
  } catch (err) {
    console.warn('Anchor capture: fallback save failed:', err);
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
document.getElementById('btn-confirm').addEventListener('click', async () => {
  if (!currentDoc) return;

  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(input => {
    allValues[input.dataset.key] = input.value;
  });

  const supplierForLogo = allValues.supplier_name || currentDoc?.supplier_name;
  if (supplierForLogo) await saveLogoOnConfirm(supplierForLogo);

  docImg.src = '';
  docImgWrap.style.display = 'none';
  selCanvas.width  = 0;
  selCanvas.height = 0;
  await new Promise(r => setTimeout(r, 150));

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
    if (pageImages?.length) {
      docImgWrap.style.display = '';
      docImg.src = pageImages[currentPage];
    }
    showToast(result?.error || 'Confirm failed. Check settings.', 'err');
    return;
  }

  queue         = queue.filter(d => d.id !== currentDoc.id);
  deferredQueue = deferredQueue.filter(d => d.id !== currentDoc.id);
  updateTabCounts();
  advanceAfterAction();
  window.docusnap.notifyReviewComplete();
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

// ── Delete All Deferred ───────────────────────────────────────────────────────
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (deferredQueue.length === 0) return;
  if (!confirm(`Delete all ${deferredQueue.length} deferred document(s)? This cannot be undone.`)) return;

  const toDelete = [...deferredQueue];
  for (const doc of toDelete) {
    const filePath = doc.folder_path ? `${doc.folder_path}\\${doc.original_filename}` : null;
    await window.docusnap.deleteDocument(doc.id, filePath);
  }

  const hadCurrent = toDelete.some(d => d.id === currentDoc?.id);
  deferredQueue = [];
  if (hadCurrent) { currentDoc = null; clearDocPanel(); }
  updateTabCounts();
  renderDeferredList();
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

  const result = await window.docusnap.reprocessDocument({
    docId:      currentDoc.id,
    folderPath: currentDoc.folder_path,
    filename:   currentDoc.original_filename,
  });

  window.docusnap.removeReprocessProgress();

  if (result.success && result.extractions) {
    const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
    renderFields(full);
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

  const total = queue.length;
  let done    = 0;
  let failed  = 0;

  try {
    for (const doc of [...queue]) {
      if (_batchStopped) break;   // cooperative stop — never mid-document

      btnAll.innerHTML = `<span class="btn-spinner"></span> ${done + 1}/${total}`;
      try {
        const result = await window.docusnap.reprocessDocument({
          docId:      doc.id,
          folderPath: doc.folder_path,
          filename:   doc.original_filename,
        });
        if (!result?.success) failed++;
        if (currentDoc && doc.id === currentDoc.id && result?.success) {
          const full = await window.docusnap.getDocumentWithExtractions(doc.id);
          if (full) renderFields(full);
        }
      } catch (e) {
        console.warn(`[Reprocess All] ${doc.original_filename}:`, e.message);
        failed++;
      }
      done++;
    }
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
    btnAll.innerHTML     = '&#9654;&#9654; All';
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function clearDocPanel() {
  docImgWrap.style.display = 'none';
  const ph = document.getElementById('doc-placeholder');
  ph.style.display = '';
  ph.textContent   = 'All documents reviewed ✓';
  document.getElementById('doc-name').textContent = '—';
  document.getElementById('fields-scroll').innerHTML = '';
  document.getElementById('doctype-select').value = '';
  selectedTypeSlug = null;
  document.getElementById('btn-confirm').disabled = true;
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

window.addEventListener('resize', () => {
  if (docImg.complete && docImg.naturalWidth) {
    selCanvas.width  = docImg.offsetWidth;
    selCanvas.height = docImg.offsetHeight;
  }
});

// Auto-refresh queue when main process signals new docs were added
window.docusnap.onReviewCountChanged(async (n) => {
  const prevId  = currentDoc?.id;
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  updateTabCounts();
  if (activeTab === 'review')   renderQueueList();
  if (activeTab === 'deferred') renderDeferredList();
  // Auto-select first doc if nothing is currently loaded
  if (!prevId && queue.length > 0 && activeTab === 'review') selectDoc(queue[0]);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadQueue();
