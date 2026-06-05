'use strict';

// ── Constants: which fields to show in review ─────────────────────────────────
const REVIEW_FIELD_KEYS = ['supplier_name', 'invoice_number', 'invoice_date'];

// ── State ─────────────────────────────────────────────────────────────────────
let queue        = [];
let currentDoc   = null;
let currentPage  = 0;
let pageImages   = [];   // base64 data URIs
let fieldDefs    = [];
let corrections  = {};

// Zone selection state
let activeField  = null;  // key of field being picked
let isDragging   = false;
let dragStart    = { x: 0, y: 0 };
let dragRect     = null;

// ── Element refs ──────────────────────────────────────────────────────────────
const docImg      = document.getElementById('doc-img');
const docImgWrap  = document.getElementById('doc-img-wrap');
const selCanvas   = document.getElementById('sel-canvas');
const ocrOverlay  = document.getElementById('ocr-overlay');
const selectHint  = document.getElementById('select-hint');
const hintField   = document.getElementById('hint-field-name');
const hintCancel  = document.getElementById('hint-cancel');
const ctx         = selCanvas.getContext('2d');

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Load queue ────────────────────────────────────────────────────────────────
async function loadQueue() {
  queue     = await window.docusnap.getReviewQueue();
  const docTypes = await window.docusnap.getAllDocTypes();
  // Use first doc type fields as default — will be updated per document
  fieldDefs = docTypes.length ? docTypes[0].fields : [];
  renderQueueBar();
  if (queue.length > 0) selectDoc(queue[0]);
  refreshDeferredPanel();
}

function reviewFields() {
  const customKeys = fieldDefs
    .filter(f => !f.built_in && f.enabled)
    .map(f => f.key);
  return [...REVIEW_FIELD_KEYS, ...customKeys];
}

function labelFor(key) {
  const f = fieldDefs.find(f => f.key === key);
  if (f) return f.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Queue bar ─────────────────────────────────────────────────────────────────
function renderQueueBar() {
  const bar   = document.getElementById('queue-bar');
  const empty = document.getElementById('queue-empty');
  bar.querySelectorAll('.queue-item').forEach(el => el.remove());

  if (queue.length === 0) {
    empty.style.display = '';
    clearDocPanel();
    return;
  }
  empty.style.display = 'none';

  for (const doc of queue) {
    const btn = document.createElement('button');
    btn.className   = 'queue-item';
    btn.textContent = doc.original_filename;
    btn.dataset.id  = doc.id;
    if (currentDoc && doc.id === currentDoc.id) btn.classList.add('active');
    btn.addEventListener('click', () => selectDoc(doc));
    bar.appendChild(btn);
  }
}

// ── Select document ───────────────────────────────────────────────────────────
async function selectDoc(doc) {
  cancelZoneMode();
  currentDoc  = doc;
  currentPage = 0;
  corrections = {};

  document.querySelectorAll('.queue-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === doc.id);
  });
  document.getElementById('doc-name').textContent = doc.original_filename;

  pageImages = await window.docusnap.getDocumentPages(doc.id, doc.folder_path, doc.original_filename);
  renderPage();

  const full = await window.docusnap.getDocumentWithExtractions(doc.id);
  renderFields(full);
}

// ── Page rendering ────────────────────────────────────────────────────────────
function renderPage() {
  const placeholder = document.getElementById('doc-placeholder');
  const indicator   = document.getElementById('page-indicator');

  if (!pageImages || pageImages.length === 0) {
    docImgWrap.style.display  = 'none';
    placeholder.style.display = '';
    indicator.textContent     = '—';
    return;
  }

  placeholder.style.display = 'none';
  docImgWrap.style.display  = 'inline-block';

  docImg.onload = () => {
    selCanvas.width  = docImg.offsetWidth;
    selCanvas.height = docImg.offsetHeight;
    clearCanvas();
    // Try logo match on first page load
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

  if (!doc) return;

  const extMap = {};
  for (const e of (doc.extractions || [])) extMap[e.field_key] = e;

  const keys = reviewFields();

  for (const key of keys) {
    const ext  = extMap[key] || {};
    const conf = ext.confidence ?? null;
    const val  = ext.display_value ?? ext.raw_value ?? '';
    const low  = conf !== null && conf < 70;

    const row = document.createElement('div');
    row.className    = 'field-row';
    row.dataset.key  = key;

    const confClass = conf === null ? '' : conf >= 70 ? 'high' : conf >= 40 ? 'mid' : 'low';
    const confLabel = conf !== null
      ? `<span class="conf-badge ${confClass}">${conf}%</span>`
      : '';

    row.innerHTML = `
      <div class="field-row-header">
        <span class="field-row-label">${escHtml(labelFor(key))}</span>
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
    });

    // Pick-zone button
    const pickBtn = row.querySelector('.pick-btn');
    pickBtn.addEventListener('click', () => {
      if (activeField === key) {
        cancelZoneMode();
      } else {
        enterZoneMode(key, labelFor(key));
      }
    });

    scroll.appendChild(row);
  }
}

// ── Zone selection mode ───────────────────────────────────────────────────────
function enterZoneMode(key, label) {
  cancelZoneMode();
  activeField = key;

  // Highlight the pick button and input
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('picking'));
  document.querySelectorAll('.field-input').forEach(i => i.classList.remove('zone-active'));
  const pickBtn = document.querySelector(`.pick-btn[data-key="${key}"]`);
  const input   = document.querySelector(`.field-input[data-key="${key}"]`);
  if (pickBtn) pickBtn.classList.add('picking');
  if (input)   input.classList.add('zone-active');

  // Show hint bar
  hintField.textContent = label;
  selectHint.classList.add('visible');

  // Activate canvas
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
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth   = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(79,142,247,0.08)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

// Canvas mouse events
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

  // Ignore tiny accidental clicks
  if (dragRect.w < 10 || dragRect.h < 10) {
    clearCanvas();
    return;
  }

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

    // ── 1. Crop the selected region ──────────────────────────────────────────
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

    // ── 2. OCR the crop ──────────────────────────────────────────────────────
    const result = await window.docusnap.ocrRegion(base64);
    const text   = (result || '').trim();

    if (text) {
      const input = document.querySelector(`.field-input[data-key="${fieldKey}"]`);
      if (input) {
        const orig = input.dataset.original;
        input.value = text;
        input.classList.add('corrected');
        corrections[fieldKey] = { original_value: orig, corrected_value: text };
      }

      // ── 3. Capture anchor context ─────────────────────────────────────────
      // Also OCR a wider strip to the LEFT and ABOVE the selection
      // to find the label text that identifies this field
      await captureAnchorContext(rect, fieldKey, text, imgW, imgH, scaleX, scaleY);
    }
  } catch (err) {
    console.error('Zone OCR error:', err);
  }

  ocrOverlay.classList.remove('visible');
  cancelZoneMode();
}

async function captureAnchorContext(rect, fieldKey, value, imgW, imgH, scaleX, scaleY) {
  try {
    // Normalised position of the selection centre on the page
    const xNorm = (rect.x + rect.w / 2) / imgW;
    const yNorm = (rect.y + rect.h / 2) / imgH;
    const pageZone = yNorm < 0.33 ? 'top' : yNorm < 0.66 ? 'middle' : 'bottom';

    // OCR a strip to the LEFT of the selection (looking for inline label)
    const leftPad  = Math.min(rect.x, 300);
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
      const leftText  = (await window.docusnap.ocrRegion(leftB64) || '').trim();
      const leftLabel = extractLabel(leftText);
      if (leftLabel) {
        await window.docusnap.saveFieldAnchor({
          supplier_name: currentDoc?.supplier_name || null,
          field_key:     fieldKey,
          anchor_label:  leftLabel,
          direction:     'right',
          page_zone:     pageZone,
          x_norm:        xNorm,
          y_norm:        yNorm,
        });
        console.log(`Anchor saved: "${leftLabel}" → right → ${fieldKey}`);
        return;
      }
    }

    // OCR a strip ABOVE the selection (looking for label on line above)
    const abovePad = Math.min(rect.y, 60);
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
      const aboveText  = (await window.docusnap.ocrRegion(aboveB64) || '').trim();
      const aboveLabel = extractLabel(aboveText);
      if (aboveLabel) {
        await window.docusnap.saveFieldAnchor({
          supplier_name: currentDoc?.supplier_name || null,
          field_key:     fieldKey,
          anchor_label:  aboveLabel,
          direction:     'below',
          page_zone:     pageZone,
          x_norm:        xNorm,
          y_norm:        yNorm,
        });
        console.log(`Anchor saved: "${aboveLabel}" ↓ below → ${fieldKey}`);
      }
    }
  } catch (err) {
    console.warn('Anchor capture failed (non-critical):', err);
  }
}

function extractLabel(text) {
  // Clean up OCR noise and extract a meaningful label
  // Label is typically the last meaningful phrase before the value
  const cleaned = text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Take the last 40 chars — that's where the label closest to the value will be
  const tail = cleaned.slice(-40).trim();

  // Must contain at least one letter and be reasonably short
  if (tail.length > 3 && /[a-zA-Z]/.test(tail)) {
    return tail;
  }
  return null;
}

// ── Confirm ───────────────────────────────────────────────────────────────────
document.getElementById('btn-confirm').addEventListener('click', async () => {
  if (!currentDoc) return;

  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(input => {
    allValues[input.dataset.key] = input.value;
  });

  // Save logo fingerprint before releasing the image
  const supplierForLogo = allValues.supplier_name || currentDoc?.supplier_name;
  if (supplierForLogo) await saveLogoOnConfirm(supplierForLogo);

  // Release the PDF image so Electron frees the file handle before we rename/delete
  docImg.src = '';
  docImgWrap.style.display = 'none';
  selCanvas.width  = 0;
  selCanvas.height = 0;
  // Give the renderer a tick to release the handle
  await new Promise(r => setTimeout(r, 150));

  const docType = currentDoc?.type_slug || currentDoc?.document_type_slug || null;
  await window.docusnap.confirmReview({
    document_id:       currentDoc.id,
    folder_path:       currentDoc.folder_path,
    original_filename: currentDoc.original_filename,
    corrections,
    allValues,
    supplier_name:     currentDoc.supplier_name,
  });

  queue = queue.filter(d => d.id !== currentDoc.id);
  renderQueueBar();
  if (queue.length > 0) selectDoc(queue[0]);
  else { currentDoc = null; clearDocPanel(); }
  window.docusnap.notifyReviewComplete();
});

// ── Skip ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-skip').addEventListener('click', () => {
  const idx  = queue.findIndex(d => d.id === currentDoc?.id);
  const next = queue[(idx + 1) % queue.length];
  if (next && next.id !== currentDoc?.id) selectDoc(next);
});




// ── Logo fingerprinting ───────────────────────────────────────────────────────

async function getPageBase64() {
  // Render current doc image to base64 PNG
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
      // Auto-fill supplier name if field is empty or low confidence
      const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
      if (supplierInput && !supplierInput.value.trim()) {
        supplierInput.value = match.supplier_name;
        supplierInput.classList.add('corrected');
        corrections['supplier_name'] = {
          original_value:   '',
          corrected_value:  match.supplier_name,
        };
        // Show a subtle indicator
        const header = document.getElementById('fields-header');
        const note = document.createElement('div');
        note.style.cssText = 'font-size:10px; color:var(--ok); margin-top:3px;';
        note.textContent = `Logo matched: ${match.supplier_name} (${match.confidence}% confidence)`;
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
      console.log(`Logo fingerprint saved for: ${supplierName}`);
    }
  } catch (err) {
    console.warn('Logo save failed (non-critical):', err);
  }
}

// ── Reprocess button ──────────────────────────────────────────────────────────
document.getElementById('btn-reprocess').addEventListener('click', async () => {
  if (!currentDoc) return;

  const btn = document.getElementById('btn-reprocess');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Reprocessing…';

  // Wire progress to log
  window.docusnap.removeReprocessProgress();
  window.docusnap.onReprocessProgress((msg) => {
    if (msg.type === 'log') {
      console.log('[Reprocess]', msg.text);
    }
  });

  const result = await window.docusnap.reprocessDocument({
    docId:      currentDoc.id,
    folderPath: currentDoc.folder_path,
    filename:   currentDoc.original_filename,
  });

  window.docusnap.removeReprocessProgress();

  if (result.success && result.extractions) {
    // Reload the document with fresh extractions and re-render fields
    const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
    renderFields(full);
    btn.innerHTML = '✓ Reprocessed — check fields above';
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

// ── Defer (move to To Be Reviewed) ───────────────────────────────────────────
document.getElementById('btn-defer').addEventListener('click', async () => {
  if (!currentDoc) return;
  await window.docusnap.deferDocument(currentDoc.id);
  queue = queue.filter(d => d.id !== currentDoc.id);
  renderQueueBar();
  refreshDeferredPanel();
  if (queue.length > 0) selectDoc(queue[0]);
  else { currentDoc = null; clearDocPanel(); }
  window.docusnap.notifyReviewComplete();
});

// ── Deferred panel ────────────────────────────────────────────────────────────
async function refreshDeferredPanel() {
  const deferred = await window.docusnap.getDeferredQueue();
  const panel    = document.getElementById('deferred-panel');
  const list     = document.getElementById('deferred-list');
  const count    = document.getElementById('deferred-count');

  count.textContent = deferred.length;
  panel.classList.toggle('visible', deferred.length > 0);
  list.innerHTML = '';

  for (const doc of deferred) {
    const row = document.createElement('div');
    row.className = 'deferred-item';
    row.innerHTML = `
      <span class="deferred-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
      <button class="deferred-review-btn" data-id="${doc.id}">Review now</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      // Move back to needs_review and reload queue
      await window.docusnap.restoreDeferred(doc.id);
      queue = await window.docusnap.getReviewQueue();
      renderQueueBar();
      refreshDeferredPanel();
      const restored = queue.find(d => d.id === doc.id);
      if (restored) selectDoc(restored);
    });
    list.appendChild(row);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function clearDocPanel() {
  docImgWrap.style.display  = 'none';
  document.getElementById('doc-placeholder').style.display = '';
  document.getElementById('doc-placeholder').textContent   = 'All documents reviewed ✓';
  document.getElementById('doc-name').textContent = '—';
  document.getElementById('fields-scroll').innerHTML = '';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Resize canvas when window resizes
window.addEventListener('resize', () => {
  if (docImg.complete && docImg.naturalWidth) {
    selCanvas.width  = docImg.offsetWidth;
    selCanvas.height = docImg.offsetHeight;
  }
});

loadQueue();
refreshDeferredPanel();
