'use strict';

// Fallback fields shown when no doc type is selected
const FALLBACK_FIELD_KEYS = ['supplier_name', 'invoice_number', 'invoice_date'];

// ── On-blur field validation (shared source of truth with extraction) ───────────
// The Review window validates an edited field on focus-out using the SAME
// validation_patterns the Python extraction qualification uses (fetched once via
// get-validation-patterns), so UI and pipeline can never drift apart. Field
// `type` → validation key mirrors engine.py's _TYPE2VAL exactly. text /
// multiline_text have no regex constraint (free-text) — left unvalidated.
const TYPE_TO_VALIDATION = {
  date: 'date', currency: 'currency', number: 'currency', amount: 'currency',
  alphanumeric: 'alphanumeric', job_reference: 'job_reference', currency_code: 'currency_code',
  // Explicit "Reference number" field type -> code (alphanumeric) gate, mirroring
  // engine.py _TYPE2VAL. So the on-blur validator accepts NNNN-NNNN-N refs.
  reference: 'alphanumeric',
  // Supplementary structured types — MUST stay in lockstep with engine.py _TYPE2VAL
  // and config validation_patterns (the same anchored patterns drive both the on-blur
  // check and the dev-inspector rx% score). email/percentage/postcode_uk/vat_gb/iban/
  // website are flag-only (UI warn, not engine-withheld); reference_code also gates in
  // the engine (_TYPE2VAL).
  email: 'email', percentage: 'percentage', postcode_uk: 'postcode_uk', vat_gb: 'vat_gb',
  reference_code: 'reference_code', iban: 'iban', website: 'website',
  // MAC / IP addresses — colon-bearing codes. Flag-only (kept, surfaced for review),
  // with their own patterns/charsets in config so a value like D4:F0:C9:25:9B:64 or
  // 192.168.1.200 is type-VALID (the ':' isn't flagged as an unexpected character).
  mac_address: 'mac_address', ip_address: 'ip_address',
};
// Mirror engine.py _is_ref_field: a reference/ticket field (key ends _number /
// _no or contains "reference").
function isRefFieldKey(key) {
  const k = (key || '').toLowerCase();
  return k.endsWith('_number') || k.endsWith('_no') || k.includes('reference');
}
// Field → validation key, mirroring engine.py's _TYPE2VAL + the ref-field
// coercion: a reference field typed Number/Currency is validated as a CODE
// (alphanumeric), not as money. Without this a valid ref "2602-0926-1" failed
// the currency pattern (rx 0% / a false on-blur warning).
function validationKeyFor(def) {
  if (!def) return null;
  const type = (def.type || '').toLowerCase();
  let mapped = TYPE_TO_VALIDATION[type] || null;
  if ((mapped === 'currency' || mapped === 'currency_code') && isRefFieldKey(def.key)) {
    mapped = 'alphanumeric';
  }
  // The doc-type REFERENCE role is created as plain "text", so it would be left
  // free-text (no constraint). It holds a CODE — gate it as alphanumeric, mirroring
  // engine.py's _seed_field_patterns ref-role coercion, so the on-blur validator and
  // the backend agree for text-typed ref fields.
  if (!mapped && isRefFieldKey(def.key)) mapped = 'alphanumeric';
  return mapped;
}
let validationPatterns = null;   // { date:[RegExp,…], … } compiled once from config

async function ensureValidationPatterns() {
  if (validationPatterns) return validationPatterns;
  validationPatterns = {};
  try {
    const raw = await window.docusnap.getValidationPatterns();
    for (const [key, arr] of Object.entries(raw || {})) {
      // currency_code is the only anchored pattern (^…$); the rest use search
      // semantics with IGNORECASE, mirroring the Python re.search/re.IGNORECASE.
      const flags = key === 'currency_code' ? '' : 'i';
      validationPatterns[key] = (arr || [])
        .map(p => { try { return new RegExp(p, flags); } catch { return null; } })
        .filter(Boolean);
    }
  } catch { /* degrade gracefully — no patterns means no blur validation */ }
  return validationPatterns;
}

// Returns a short error message when `value` fails the field's regex/type (or its
// learned digits-only shape), or null when valid / unconstrained. Pure + sync so
// it can run on blur with no perceptible pause and never blocks Confirm.
function fieldValidationError(key, value) {
  const v = (value || '').trim();
  if (!v) return null;   // empty is handled by the required-presence gate, not here
  // Learned digits-only shape (reuses the existing per-(supplier,type,field)
  // signal already attached to the document) — "unlike other entries".
  if ((currentDoc?.digit_only_fields || []).includes(key) && /\D/.test(v.replace(/[\s,]/g, ''))) {
    return 'Usually all digits for this field';
  }
  const def  = (fieldDefs || []).find(f => f.key === key);
  const valKey = validationKeyFor(def);
  if (!valKey) return null;                      // free-text / untyped → no constraint
  const pats = validationPatterns && validationPatterns[valKey];
  if (!pats || !pats.length) return null;
  // Date/currency: a substring match is fine (the value legitimately sits inside
  // formatting, and salvage handles the rest). Other typed fields (codes/refs):
  // require >=80% COVERAGE — the longest matching span over the value — the SAME
  // metric the backend credibility gate (anchor._pattern_coverage) and the dev-
  // inspector "rx %" badge use, so the on-blur warning, the badge and extraction
  // stay one definition (a colon-laden MAC scores ~18% → warns, never silently OK).
  if (valKey === 'date' || valKey === 'currency' || valKey === 'currency_code') {
    if (pats.some(re => re.test(v))) return null;
  } else {
    let best = 0;
    for (const re of pats) {
      let m = null; try { m = v.match(re); } catch { m = null; }
      if (m && m[0]) best = Math.max(best, m[0].length / v.length);
    }
    if (best >= 0.8) return null;
  }
  return valKey === 'date'          ? 'Not a valid date'
       : valKey === 'currency'      ? 'Not a valid amount'
       : valKey === 'currency_code' ? 'Not a valid currency code'
       :                              'Unexpected format for this field';
}

// Inline warning UI for a field row — a dedicated amber note + red input border.
// Kept separate from extraction's own .field-note (validation_note/corrected_to)
// so refreshing the document never wipes a standing live-edit warning, and vice
// versa. Pure DOM, scoped to the one row — no re-render, no focus change.
function setFieldWarning(row, input, msg) {
  if (input) input.classList.add('invalid');
  let el = row.querySelector('.field-validation-warn');
  if (!el) {
    el = document.createElement('div');
    el.className = 'field-note field-validation-warn';
    row.appendChild(el);
  }
  el.textContent = msg;
}

function clearFieldWarning(row, input) {
  const i = input || row.querySelector('.field-input');
  if (i) i.classList.remove('invalid');
  const el = row.querySelector('.field-validation-warn');
  if (el) el.remove();
}

// ── State ─────────────────────────────────────────────────────────────────────
let queue            = [];
// Review-queue view: group rows by sender (default) vs raw newest-first. A same-window
// UI preference (persisted in localStorage, not a DB setting), like the queue splitter.
let queueGrouped     = (localStorage.getItem('review_queue_grouped') || 'true') !== 'false';
let deferredQueue    = [];
let bulkFiling       = false; // true while File All Ready runs; suppresses the auto-refresh listener so its per-doc confirm broadcasts can't clobber the loop's local queue mid-run
let allDocTypes      = [];
let currentDoc       = null;
let currentPage      = 0;
let pageImages       = [];
let fieldDefs        = [];
let corrections      = {};
let anchorTaughtFields = new Set(); // field_keys taught via the ⊕ highlight/zone-OCR tool this cycle
// Anchors drawn with ⊕ this cycle, STAGED in memory and persisted only on Confirm
// & File (mirrors `corrections`). An un-confirmed teach (skip/defer/doc-change)
// leaves NO learned trace, so an accidental wrong pick can't poison the corpus.
// Keyed by field_key → the saveFieldAnchor payload computed at draw time.
let pendingAnchors   = {};
// When set, the next box drawn on the preview is a MANUAL ANCHOR (a label to point at,
// e.g. "Invoice Total") for this field — not a value read. Armed by the readout's
// "Draw the anchor" button; consumed on mouseup by runAnchorDraw.
let anchorDrawField  = null;
// Field cleanup rules taught via the right-click menu this cycle, STAGED in memory
// and persisted only on Confirm (mirrors pendingAnchors). Keyed field_key → array of
// saveFieldRule payloads. An un-confirmed teach (skip/defer/doc-change) leaves no trace.
let pendingFieldRules = {};
// SAVED field rules (read-only cache) so the right-click menu can reflect a persisted rule
// (e.g. show "wrapping is on" after a confirm cleared pendingFieldRules). Refreshed on load
// and after each confirm.
let _savedFieldRules = [];
async function _loadSavedFieldRules() {
  try { _savedFieldRules = (await window.docusnap.getFieldRules?.()) || []; } catch { _savedFieldRules = []; }
}
_loadSavedFieldRules();
// The draw context of the most recent ⊕ teach, so the readout's Left/Above toggle can
// re-run label detection in the chosen direction without redrawing the box.
let lastTeachCtx     = null;   // { fieldKey, rect, imgW, imgH, scaleX, scaleY, value }
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
  drafts: {},                  // in-session per-field draft cache: unsaved boxes/fixed text survive field switches
  fixedByKey: null,            // Map(field_key -> saved fixed_value) from template_fields, for rehydration
  _loadedKey: null,            // field currently shown (so its draft is captured before switching)
  resolved: null,              // {anchor_box, target_box} — where the mapping ACTUALLY resolves on this page (amber overlay)
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
const selCanvas    = document.getElementById('sel-canvas');
const wizCanvas    = document.getElementById('wiz-canvas');
const traceCanvas  = document.getElementById('trace-canvas');
const ocrOverlay   = document.getElementById('ocr-overlay');
const selectHint   = document.getElementById('select-hint');
const hintField    = document.getElementById('hint-field-name');
const hintCancel   = document.getElementById('hint-cancel');
const ctx          = selCanvas.getContext('2d');
const wizCtx       = wizCanvas.getContext('2d');
const traceCtx     = traceCanvas.getContext('2d');

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Help: user guide + contextual help mode ───────────────────────────────────
document.getElementById('btn-help-guide')?.addEventListener('click', () => window.docusnap.openHelpWindow('review'));
// Template Wizard "What's this?" → the Templates & Learning guide (explains ⊕ vs Wizard vs Teach).
document.getElementById('wiz-help-link')?.addEventListener('click', () => window.docusnap.openHelpWindow('which-tool'));

const HELP_TEXTS = {
  'review-tab':    'Documents waiting to be checked and confirmed.',
  'deferred-tab':  'Documents you set aside to deal with later.',
  'nav-prev':      'Go to the previous document in the list.',
  'nav-next':      'Go to the next document in the list.',
  'split':         'Split a multi-page PDF — by page range, every page, or every N pages.',
  'anchor-wizard': 'Teach this layout (admin): if a supplier keeps misreading, map where each field sits so future documents from them read correctly.',
  'enhance':       'If the scan is faint or noisy, re-read it with stronger image cleanup, then re-extract.',
  'template-manager': 'If this supplier/layout keeps misdetecting, save the reviewed values as a managed template so the next document is recognised automatically.',
  'reprocess':     'If you changed the document type or fixed settings, run extraction again on this document to refresh the values.',
  'zoom':          'Zoom and pan the document preview; Reset returns to fit.',
  'confirm':       'Accept the values shown and file this document.',
  'skip':          'Move to the next document without filing this one.',
  'defer':         'Set this document aside in the Deferred tab to handle later.',
  'file-all':      'File every queued document whose type and required fields are complete. Incomplete ones are left for manual review.',
  'delete-all':    'Move every document in this tab to the recycle bin (you can restore them from Search → Recycle bin).',
  'queue-list':    'The documents in this tab. Click one to open it; the ↑/↓ buttons (and arrow keys) also move between them.',
  'fields-panel':  'The details read from this document. Click any value to edit it; a note appears if a value looks wrong for its field.',
  'doctype-select':'The document type for this document. Change it if it was detected wrong — the field list updates to match.',
  'new-doctype':   'Create a new document type here, without leaving Review.',
  'advanced':      'Admin tools for a field’s learning history — view every value Scan Finder has learned for it, fix a likely OCR slip, or remove a value that shouldn’t be there.',
  'preview-ocr':   'Overlay the text Scan Finder read on top of the page, so you can see where each value came from.',
  'pages':         'Move between the pages of a multi-page document.',
  'acknowledge':   'Mark this flagged document as checked, so it can be filed.',
  'delete':        'Move this document to the recycle bin — recoverable from Search → Recycle bin.',
  'reprocess-all': 'Re-run extraction on every document in the queue — useful after teaching or changing settings.',
  'stop-file-all': 'Stop filing the rest. Documents already filed stay filed.',
  'stop-reprocess':'Stop reprocessing the rest. Already-done documents keep their new values.',
  'draw-anchor':   'Draw a box around a fixed label on the page (e.g. “Date:”) for the wizard to track.',
  'draw-target':   'Draw a box around the value to read, next to the anchor label.',
  'wiz-save':      'Save this field mapping for the layout, so future documents read it automatically.',
  'show-resolved': 'Show where the saved mapping actually reads on this page (highlighted in amber).',
  'open-manager':  'Open the full Template Manager (in Settings) for this layout.',
  'wiz-field':     'Pick which field you’re mapping in the wizard.',
  'help-mode':     'Help mode: click any control to see what it does. Press Esc to leave.',
};
window.initHelpMode?.('help-mode-toggle', HELP_TEXTS);

// ── Document open/close audit signalling ──────────────────────────────────────
// The server logs document_open on each fetch; here we pair it with a close when
// the viewer moves to a different document or the window is closed.
let _lastOpenedDocId = null;
function noteDocOpened(id) {
  if (id == null) return;
  if (_lastOpenedDocId != null && _lastOpenedDocId !== id) {
    try { window.docusnap.notifyDocClosed(_lastOpenedDocId); } catch {}
  }
  _lastOpenedDocId = id;
}
window.addEventListener('beforeunload', () => {
  if (_lastOpenedDocId != null) { try { window.docusnap.notifyDocClosed(_lastOpenedDocId); } catch {} }
});

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
  // "+ New type" header launcher — admin only (the create IPC is admin-gated server-side).
  const _newTypeBtn = document.getElementById('btn-new-doctype');
  if (_newTypeBtn) { _newTypeBtn.style.display = isAdmin ? '' : 'none'; _newTypeBtn.onclick = openNewTypeModal; }
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  allDocTypes   = await window.docusnap.getAllDocTypes();
  ensureValidationPatterns();   // fire-and-forget; ready well before any field blur
  fieldDefs     = allDocTypes.length ? allDocTypes[0].fields : [];
  populateTypeDropdown();
  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);
  refreshAutoCommittedBar();   // surface recently auto-filed docs for re-checking

  // If opened via "Edit in Review" from Search, navigate to the requested doc.
  const targetId = await window.docusnap.getReviewTarget();
  if (targetId) _navigateToDoc(targetId);
}

// ── "Auto-committed" re-surface ──────────────────────────────────────────────
// Recently auto-filed (100%) docs can still be checked/edited: a bar offers them, and clicking
// loads them (now confirmed) into the queue LIST so the operator can open, change and re-file
// any that need it. The auto-refresh listener is suppressed while this view is active.
let _viewingAutoFiled = false;
let _autoFiledDocs    = [];

async function refreshAutoCommittedBar() {
  const bar = document.getElementById('auto-committed-bar');
  if (!bar) return;
  if (_viewingAutoFiled) {
    bar.innerHTML = `Showing <b>${_autoFiledDocs.length}</b> auto-filed document${_autoFiledDocs.length === 1 ? '' : 's'} — `
      + `<span class="acb-back">← Back to the review queue</span>`;
    bar.style.display = 'block';
    return;
  }
  let res = { docs: [] };
  try { res = (await window.docusnap.getRecentAutoFiled?.()) || res; } catch {}
  _autoFiledDocs = res.docs || [];
  if (_autoFiledDocs.length) {
    bar.innerHTML = `<b>✓ ${_autoFiledDocs.length}</b> document${_autoFiledDocs.length === 1 ? '' : 's'} auto-committed on the last pass — `
      + `<span class="acb-back">click here to review them</span>`;
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

document.getElementById('auto-committed-bar')?.addEventListener('click', async () => {
  if (_viewingAutoFiled) { await exitAutoFiledView(); return; }
  if (!_autoFiledDocs.length) return;
  _viewingAutoFiled = true;
  queue = _autoFiledDocs.slice();
  renderQueueList();
  if (queue.length) selectDoc(queue[0]);
  refreshAutoCommittedBar();
});

async function exitAutoFiledView() {
  _viewingAutoFiled = false;
  queue = await window.docusnap.getReviewQueue() || [];
  updateTabCounts();
  renderQueueList();
  if (queue.length) selectDoc(queue[0]);
  refreshAutoCommittedBar();
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
const NEW_TYPE_SENTINEL = '__new_type__';   // dropdown launcher value; intercepted, never a real type
function populateTypeDropdown() {
  const sel = document.getElementById('doctype-select');
  sel.innerHTML = '<option value="">— Select document type —</option>';
  for (const t of allDocTypes) {
    const opt = document.createElement('option');
    opt.value       = t.slug;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  // Admin-only "create a new type" launcher, discovered exactly when choosing a type.
  // The sentinel value is intercepted in the change handler below and never sticks.
  if (isAdmin) {
    const div = document.createElement('option');
    div.disabled = true; div.textContent = '──────────';
    sel.appendChild(div);
    const add = document.createElement('option');
    add.value = NEW_TYPE_SENTINEL; add.textContent = '＋ Create new type…';
    sel.appendChild(add);
  }
}

document.getElementById('doctype-select').addEventListener('change', (e) => {
  if (e.target.value === NEW_TYPE_SENTINEL) {
    e.target.value = selectedTypeSlug || '';   // revert — the sentinel never becomes a chosen type
    openNewTypeModal();
    return;
  }
  const prevSlug = selectedTypeSlug;
  selectedTypeSlug = e.target.value || null;
  // A type change invalidates any in-progress ⊕ teaching: each staged draw was captured
  // under the PREVIOUS type (and is keyed to it), so committing it under the new type
  // would leak boxes into the wrong layout. Discard staged teaching on a real type
  // change — mirrors what changing DOCUMENTS already does (see loadDocument).
  if (prevSlug !== selectedTypeSlug &&
      (Object.keys(pendingAnchors).length || Object.keys(pendingFieldRules).length)) {
    pendingAnchors = {};
    pendingFieldRules = {};
    anchorTaughtFields = new Set();
    try { hideAnchorReadout(); } catch {}
    try { showToast('Your in-progress field drawings were cleared because the document type changed — please re-draw them for the new type.', 'warn'); } catch {}
  }
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

// ── Create-a-new-type modal (in-page; reuses the shared DocTypeEditor) ─────────
// Launched from the "+ New type" header button OR the "＋ Create new type…" dropdown
// entry. No new window / no new IPC: the editor commits via createDocTypeWithFields and
// returns the new type, which we splice into the dropdown and auto-select for this doc.
let _newTypeModalOpen = false;
function openNewTypeModal() {
  if (_newTypeModalOpen || !isAdmin) return;
  if (!window.DocTypeEditor || typeof window.DocTypeEditor.create !== 'function') {
    _newTypeToast('The document-type editor didn’t load. Try reopening the Review window.');
    return;
  }
  _newTypeModalOpen = true;
  let closed = false, committing = false, ctl = null;

  const ov = document.createElement('div');
  ov.setAttribute('data-help-ignore', '');   // help-mode must not swallow clicks inside the modal
  Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999', padding: '24px' });
  const box = document.createElement('div');
  Object.assign(box.style, { width: 'min(560px,94vw)', maxHeight: '88vh', overflowY: 'auto',
    background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px',
    padding: '20px', boxShadow: '0 18px 50px rgba(0,0,0,.5)', color: 'var(--text)' });
  const title = document.createElement('div');
  title.textContent = 'Create a new document type';
  Object.assign(title.style, { fontSize: '15px', fontWeight: '600', marginBottom: '14px' });
  const host = document.createElement('div');
  const footer = document.createElement('div');
  Object.assign(footer.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' });
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const create = document.createElement('button'); create.className = 'btn'; create.textContent = 'Create type'; create.disabled = true;
  Object.assign(create.style, { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)', fontWeight: '500' });

  const close = () => {
    if (closed) return; closed = true; _newTypeModalOpen = false;
    document.removeEventListener('keydown', onKey, true);
    try { ctl && ctl.destroy(); } catch {}
    ov.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !committing) { e.stopPropagation(); close(); } };

  // Attach the overlay BEFORE mounting the editor, so it renders into a host that's in
  // the document (Teach/Settings mount it attached; a detached host can break render).
  footer.append(cancel, create);
  box.append(title, host, footer);
  ov.append(box);
  document.body.append(ov);

  try {
    ctl = window.DocTypeEditor.create(host, {
      mode: 'create', api: window.docusnap,
      // Use the `ready` arg the editor passes — it fires onValidityChange SYNCHRONOUSLY
      // during create(), before `ctl` is assigned, so `ctl.isReady()` here would NPE.
      onValidityChange: (ready) => { create.disabled = committing || !ready; },
    });
  } catch (err) {
    close();
    _newTypeToast('Could not open the type editor: ' + (err && err.message ? err.message : String(err)));
    return;
  }

  cancel.addEventListener('click', close);
  create.addEventListener('click', async () => {
    if (committing || !ctl.isReady()) return;
    committing = true; create.disabled = true; create.textContent = 'Creating…';
    let res; try { res = await ctl.commit(); } catch (e) { res = { success: false, error: e && e.message }; }
    committing = false; create.textContent = 'Create type';
    if (closed) return;                          // cancelled mid-flight → ignore the resolved result
    if (res && res.success && res.type) {
      const newSlug = res.type.slug;
      close();
      try { allDocTypes = await window.docusnap.getAllDocTypes(); } catch {}
      populateTypeDropdown();
      const sel = document.getElementById('doctype-select');
      sel.value = newSlug;
      sel.dispatchEvent(new Event('change'));    // reuse the existing handler: select + rebuild field rows
      showNewTypeNudge(res.type);
    } else {
      create.disabled = !ctl.isReady();          // failure: the editor already showed the error inline
    }
  });

  document.addEventListener('keydown', onKey, true);
  // Chromium drops focus on a just-appended element — defer to the next frame.
  requestAnimationFrame(() => { const inp = host.querySelector('input, select'); if (inp) inp.focus(); });
}

// Minimal visible toast (no deps) — used for create-modal failures/diagnostics.
function _newTypeToast(msg) {
  const t = document.createElement('div');
  t.setAttribute('data-help-ignore', '');
  t.textContent = msg;
  Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '72px', transform: 'translateX(-50%)',
    maxWidth: 'min(90vw,480px)', background: '#1f2d3d', color: '#eaf1f5', padding: '10px 14px',
    borderRadius: '10px', borderLeft: '3px solid var(--accent)', fontSize: '12px', zIndex: '100000',
    boxShadow: '0 12px 32px rgba(0,0,0,.5)' });
  document.body.append(t);
  setTimeout(() => { t.remove(); }, 6000);
}

// Calm, opt-in nudge after a type is created: confirm now, or teach where the fields sit.
function showNewTypeNudge(type) {
  const scroll = document.getElementById('fields-scroll');
  if (!scroll) return;
  document.querySelector('.new-type-nudge')?.remove();
  const banner = document.createElement('div');
  banner.className = 'new-type-nudge';
  banner.setAttribute('data-help-ignore', '');
  Object.assign(banner.style, { display: 'flex', flexDirection: 'column', gap: '8px',
    background: 'var(--surface2)', border: '1px solid var(--border2)', borderLeft: '3px solid var(--accent)',
    borderRadius: '8px', padding: '10px 12px', margin: '0 0 10px', fontSize: '12px', color: 'var(--text)' });
  const msg = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = '“' + type.name + '” created. ';
  msg.append(strong, document.createTextNode('Confirm this document now — or teach Scan Finder where each field sits so it auto-fills next time.'));
  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '8px' });
  const teach = document.createElement('button'); teach.className = 'btn'; teach.textContent = 'Teach where the fields are';
  const dismiss = document.createElement('button'); dismiss.className = 'btn'; dismiss.textContent = 'Dismiss';
  for (const b of [teach, dismiss]) Object.assign(b.style, { fontSize: '11px', padding: '4px 10px' });
  actions.append(teach, dismiss);
  banner.append(msg, actions);
  scroll.prepend(banner);
  dismiss.addEventListener('click', () => banner.remove());
  teach.addEventListener('click', () => {
    banner.remove();
    if (currentDoc && window.docusnap.openTeachWindowAt) window.docusnap.openTeachWindowAt(currentDoc.id);
  });
}

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
    const vb0 = document.getElementById('queue-view-bar');
    if (vb0) vb0.style.display = 'none';
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

  // View toggle: grouped by sender (default) vs newest-first. Grouping turns a long
  // chronological scatter into a few named sender piles, so a batch from one sender —
  // and its shared blocker — is obvious. The ↑/↓ nav follows the SAME order
  // (reviewDisplayOrder), so the arrows and the visible list never disagree.
  const viewBar = document.getElementById('queue-view-bar');
  if (viewBar) viewBar.style.display = '';
  const viewLbl = document.getElementById('queue-view-label');
  if (viewLbl) viewLbl.textContent = queueGrouped ? 'Grouped by sender' : 'Newest first';

  if (queueGrouped) {
    for (const g of reviewDisplayGroups()) {
      const head = document.createElement('div');
      head.className = 'queue-group-head';
      const attn = g.need ? ` · <span class="qgh-attn">${g.need} need${g.need > 1 ? '' : 's'} a look</span>` : '';
      head.innerHTML = `<span class="qgh-name" title="${escHtml(g.supplier)}">${escHtml(g.supplier)}</span>`
                     + `<span class="qgh-meta">${g.docs.length} document${g.docs.length > 1 ? 's' : ''}${attn}</span>`;
      list.appendChild(head);
      for (const doc of g.docs) list.appendChild(buildQueueItem(doc));
    }
  } else {
    for (const doc of queue) list.appendChild(buildQueueItem(doc));
  }
}

// The review queue's DISPLAY grouping: sender -> its docs, most attention-needing /
// largest piles first (stable WITHIN a sender, so the processed_at order holds). Shared
// by renderQueueList (DOM) and reviewDisplayOrder (the ↑/↓ nav) so they always agree.
function reviewDisplayGroups() {
  const groups = new Map();
  for (const doc of queue) {
    const key = (doc.supplier_name || '').trim() || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  const entries = [...groups.entries()].map(([supplier, docs]) => ({
    supplier, docs,
    need: docs.filter(d => isFlagged(d) || (d.missing_required_labels || '').trim()).length,
  }));
  entries.sort((a, b) => b.need - a.need || b.docs.length - a.docs.length || a.supplier.localeCompare(b.supplier));
  return entries;
}

// The flat doc order the queue is actually SHOWN in (grouped or chronological). The nav
// (cycleDocument / updateDocNavButtons) uses this so ↑/↓ track the visible order.
function reviewDisplayOrder() {
  return queueGrouped ? reviewDisplayGroups().flatMap(g => g.docs) : queue;
}

// One queue row (thumbnail · name · sender · badges · blocker · delete). Shared by the
// grouped and flat rendering paths.
function buildQueueItem(doc) {
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
  // A required field (the Date/Reference role, or a custom Required field) that read
  // EMPTY blocks Confirm even at high confidence — so a row must NOT wear a green
  // "Looks good" while being un-fileable. missing_required_labels (from
  // getReviewQueue) mirrors the confirm gate; we lead the row with that blocker.
  const missingReq = (doc.missing_required_labels || '').split(',').map(s => s.trim()).filter(Boolean);
  const blocked    = missingReq.length > 0;
  let sev = '';   // '', 'high'(green), 'mid'(orange), 'low'(red)
  if (conf != null) {
    if (conf < 40)               sev = 'low';
    else if (flagged || blocked) sev = 'mid';
    else                         sev = 'high';
  } else if (blocked || flagged) {
    sev = 'mid';   // no overall score yet, but we already know it needs attention
  }
  if (sev === 'low')      el.classList.add('qi-conf-low');
  else if (sev === 'mid') el.classList.add('qi-conf-mid');
  if (currentDoc && doc.id === currentDoc.id) el.classList.add('active');
  // Human-readable reason on hover: green = clean, orange = needs a check
  // (low confidence and/or a format flag), red = critically low confidence.
  const sevWord = sev === 'low'  ? 'Low confidence'
                : blocked        ? 'Missing a required field — can’t file yet'
                : sev === 'mid'  ? 'Needs a quick check'
                :                  'Looks good';
  const confBadge = conf == null ? '' :
    `<span class="conf-badge ${sev}" style="flex-shrink:0;" title="${sevWord} — ${conf}% confidence">${conf}%</span>`;
  // Lead with the actual blocker (the missing field), not the reassuring score.
  const blockerLine = blocked
    ? `<div class="qi-blocker" title="Can’t be filed until this is filled in"
           style="color:var(--warn); font-size:11px; font-weight:600; margin-top:2px; display:flex; align-items:center; gap:4px;">`
      + `<span aria-hidden="true">⚠</span>Needs: ${escHtml(missingReq[0])}`
      + `${missingReq.length > 1 ? ` +${missingReq.length - 1} more` : ''}</div>`
    : '';
  el.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:8px;">
      <img class="qi-thumb" alt="">
      <div style="flex:1; min-width:0;">
        <span class="qi-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="qi-supplier" style="flex:1; min-width:0;">${escHtml(doc.supplier_name || '—')}</span>
          ${doc.page_count > 1 ? `<span class="qi-multipage" title="Multi-page document (${doc.page_count} pages)" style="flex-shrink:0;display:inline-flex;color:var(--muted)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg></span>` : ''}
          ${confBadge}
        </div>
        ${blockerLine}
      </div>
      ${canEdit ? `<button class="qi-btn danger qi-delete" title="Delete document" aria-label="Delete document" style="flex-shrink:0; padding:2px 7px; font-size:13px;">&#215;</button>` : ''}
    </div>
  `;
  if (window.Thumbs) window.Thumbs.lazy(el.querySelector('.qi-thumb'), doc);
  // During a File All Ready run, user selection/delete must NOT reassign the
  // module-global currentDoc mid-file (QA audit #5) — ignore row clicks + the
  // per-row × until the bulk run finishes (the loop drives selectDoc itself).
  el.addEventListener('click', () => { if (bulkFiling) return; selectDoc(doc); });
  const delBtn = el.querySelector('.qi-delete');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); if (bulkFiling) return; deleteFromQueue(doc); });
  return el;
}

// ── Deferred list (deferred tab) ─────────────────────────────────────────────
function renderDeferredList() {
  document.getElementById('review-actions').style.display = 'none';   // review-only block; not for Deferred
  const vbD = document.getElementById('queue-view-bar');
  if (vbD) vbD.style.display = 'none';   // sender-grouping toggle is review-only
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
async function selectDoc(doc, opts) {
  try { await _selectDoc(doc, opts); } catch(err) {
    console.error('selectDoc failed:', err);
    showToast('Error loading doc: ' + err.message, 'err');
  }
  // Keep the prev/next rail in sync with the new position and ensure the chosen
  // item is visible (matters when cycling to an off-screen document).
  updateDocNavButtons();
  scrollActiveItemIntoView();
}
// fieldsOnly: bulk "File All Ready" needs only the field VALUES + readiness, so
// it skips the PDF→PNG preview render (the dominant per-doc cost) and the
// display-only template recheck. Single-document review passes nothing → full path.
async function _selectDoc(doc, { fieldsOnly = false } = {}) {
  _clearPreviewState();
  cancelZoneMode();
  currentDoc  = doc;
  currentPage = 0;
  corrections = {};
  anchorTaughtFields = new Set();
  pendingAnchors = {};   // discard any un-confirmed ⊕ teach when the doc changes
  pendingFieldRules = {}; // ...and any un-confirmed field cleanup rule
  lastTeachCtx = null; hideAnchorReadout();
  { const c = document.getElementById('teach-cta'); if (c) { c.style.display = 'none'; c.innerHTML = ''; } }  // clear prior doc's CTA until this doc's recheck answers

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

  // Load pages and fields independently — a missing file must not block field
  // rendering. fieldsOnly skips the preview render entirely (bulk filing reads
  // only the field values, never the image).
  if (fieldsOnly) {
    pageImages = [];
  } else {
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
  }

  noteDocOpened(doc.id);
  let full = null;
  try {
    full = await window.docusnap.getDocumentWithExtractions(doc.id);
  } catch (e) {
    console.warn('getDocumentWithExtractions failed:', e.message);
  }
  if (currentDoc?.id !== doc.id) return;   // superseded while extractions loaded — leave the newer doc's fields intact
  const renderedDoc = full || doc;
  // The detailed `full` record doesn't carry the queue's review-reason counts;
  // bring them over so the "why review" banner matches the queue colouring.
  if (full && full !== doc) {
    full.below_threshold_count = doc.below_threshold_count;
    full.review_flag_count     = doc.review_flag_count;
  }
  renderFields(renderedDoc);

  // Lightweight current-template recheck — this doc had no template match at
  // processing time, but a template covering its layout may have been added
  // since (e.g. via "Add to Template Manager" on another document from the
  // same supplier). Read-only UI refresh: does not reprocess, does not write
  // template_id, and is skipped entirely once a template_id is already set.
  // Skipped in fieldsOnly (bulk) — it's a display-only refresh and adds an IPC/doc.
  if (!fieldsOnly && !doc.template_id) {
    window.docusnap.checkTemplateMatch(doc.id).then(result => {
      if (currentDoc?.id !== doc.id) return; // user switched docs while pending
      // Record the recheck OUTCOME (matched or not) + a done flag, then re-render —
      // the "Teach this document" CTA holds until this de-dupe check has answered, so it
      // can't flash then flip to "Update existing" (see renderTeachCta).
      renderedDoc._templateRecheck     = result || { matched: false };
      renderedDoc._templateRecheckDone = true;
      renderExtractionStatus(renderedDoc);
    }).catch(e => {
      console.warn('checkTemplateMatch failed:', e.message);
      renderedDoc._templateRecheckDone = true;
      renderExtractionStatus(renderedDoc);
    });
  }
}

// ── Page rendering ────────────────────────────────────────────────────────────
function renderPage() {
  hideAnchorReadout();   // a stale readout/box doesn't belong on a freshly rendered page
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
    selCanvas.width    = docImg.offsetWidth;
    selCanvas.height   = docImg.offsetHeight;
    wizCanvas.width    = docImg.offsetWidth;
    wizCanvas.height   = docImg.offsetHeight;
    traceCanvas.width  = docImg.offsetWidth;
    traceCanvas.height = docImg.offsetHeight;
    clearCanvas();
    clearTraceHighlight();
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
    const wrap = document.createElement('div');   // stack the pills vertically, not side by side
    wrap.className = 'ext-status-pills';
    pills.forEach(p => wrap.appendChild(p));
    d.appendChild(wrap);
    return d;
  };

  el.appendChild(row('ID:', pill(idLabel, idCls)));
  const extPills = [pill(extLabel, extCls)];
  if (mappingN > 0) extPills.push(pill(`${mappingN} mapping${mappingN === 1 ? '' : 's'}`, 'ok'));
  el.appendChild(row('Extraction:', ...extPills));

  renderTeachCta(doc);   // the "Teach this document" CTA above the preview keys off the SAME id state
}

// "Teach this document" CTA above the preview pane. Gated so a SEEN document can't be
// re-taught into a duplicate (Bob's tiers): on a template → nothing; a template exists
// but drifted → "Update existing" instead; truly unseen → Teach (with a one-time confirm
// only when the sender is recognised). Held until the template recheck has answered.
function renderTeachCta(doc) {
  const cta = document.getElementById('teach-cta');
  if (!cta) return;
  cta.style.display = 'none';
  cta.innerHTML = '';
  cta.className = 'teach-cta';
  if (!doc || !canEdit) return;          // teaching is Admin/Edit only
  if (doc.template_id) return;           // Tier A — already on a template

  const done    = !!doc._templateRecheckDone;
  const matched = !!(doc._templateRecheck && doc._templateRecheck.matched);
  if (!done) return;                     // recheck pending — show nothing (anti-flash)

  // A template for this layout EXISTS but didn't match this scan (drift). Show NOTHING:
  // teaching would duplicate it, and a reprocess (once a few similar docs are confirmed)
  // usually makes it match — so there's no action the operator needs to take here.
  if (matched) return;

  // If the doc is already being read by a LEARNED method (keyword patterns, learned
  // anchors, or template mappings), it isn't "unseen" — don't offer to teach it. A doc
  // taught with field targets can extract via patterns/anchors without a template_id.
  const learned = (doc.extractions || [])
    .map(e => (e.extraction_method || '').split('+')[0].trim().toLowerCase())
    .some(m => m.startsWith('keyword') || m.startsWith('anchor') || m.startsWith('template_mapping'));
  if (learned) return;

  // Tier C/D — no template, recheck clean, nothing learned read it → offer to teach.
  const hasLogo = !!doc.logo_phash;
  const hasKw   = !!(doc.keyword_fingerprint && doc.keyword_fingerprint !== 'null');
  const known   = hasLogo || hasKw;      // Tier C (recognised sender) vs D (cold)
  cta.innerHTML =
    `<button class="teach-cta-btn primary" id="teach-cta-go">` +
      `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5"/></svg> Teach this document` +
    `</button>` +
    `<div class="teach-cta-hint">${known
      ? 'We recognise this sender but haven&rsquo;t learned this layout yet — teach it once and we&rsquo;ll handle it next time.'
      : 'Scan Finder hasn&rsquo;t seen this layout — show it where each field is, just once.'}</div>` +
    // "…or it's like one you've already set up" — link to an existing template + group
    // them, so this layout reads automatically without teaching it from scratch.
    `<div class="teach-cta-like" id="teach-cta-like" style="display:none;">` +
      `<span class="teach-cta-like-lbl">&hellip;or is it like a document you&rsquo;ve already set up?</span>` +
      `<div class="teach-cta-like-row">` +
        `<select class="teach-cta-like-select" id="teach-cta-like-select"><option value="">Loading&hellip;</option></select>` +
        `<button class="teach-cta-btn ghost" id="teach-cta-like-go" disabled>Link &amp; reprocess</button>` +
      `</div>` +
    `</div>`;
  cta.style.display = '';

  // Populate the "like another document" picker with existing templates (same doc type
  // first). Hidden entirely when there are no templates yet.
  const likeWrap = document.getElementById('teach-cta-like');
  const likeSel  = document.getElementById('teach-cta-like-select');
  const likeGo   = document.getElementById('teach-cta-like-go');
  if (likeSel && likeGo) {
    window.docusnap.getTemplates?.().then(list => {
      const tmpls = Array.isArray(list) ? list : (list && list.templates) || [];
      if (!tmpls.length) return;                       // nothing to link to yet
      const slug = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null;
      tmpls.sort((a, b) =>
        ((b.document_type_slug === slug) - (a.document_type_slug === slug)) ||
        String(a.name || '').localeCompare(String(b.name || '')));
      likeSel.innerHTML = '<option value="">Choose a document it&rsquo;s like&hellip;</option>' +
        tmpls.map(t => `<option value="${t.id}">${escHtml(t.name || 'Untitled')}` +
          `${t.document_type_slug ? ' · ' + escHtml(String(t.document_type_slug).replace(/_/g, ' ')) : ''}</option>`).join('');
      if (likeWrap) likeWrap.style.display = '';
    }).catch(() => {});
    likeSel.addEventListener('change', () => { likeGo.disabled = !likeSel.value; });
    likeGo.addEventListener('click', () => linkCurrentDocToTemplate(likeSel.value, likeGo));
  }

  document.getElementById('teach-cta-go')?.addEventListener('click', () => {
    const id = currentDoc?.id;
    if (!id) return;
    // Tier C guardrail: the recheck is best-effort, so on a recognised sender confirm once
    // before teaching, in case a badly-drifted template slipped past it. Tier D = no nag.
    if (known && !confirm(
      'Teach this as a NEW document?\n\n' +
      'We don\'t have a template for this layout. If you have taught a similar document ' +
      'before, click Cancel and update that one in Template Manager instead, so we don\'t ' +
      'create a duplicate.')) return;
    window.docusnap.openTeachWindowAt(id);
  });
}

// Link the current (unmatched) document to an EXISTING template: create a template for
// this doc, group it with the chosen one, then reprocess so it reads via the shared
// group immediately. Reuses the same field-gathering as "Add to Template Manager".
async function linkCurrentDocToTemplate(targetId, btn) {
  if (!targetId || !currentDoc) return;
  const docTypeSlug = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null;
  if (!docTypeSlug) { showToast('Select a document type before linking.', 'warn'); return; }
  const allValues = {};
  document.querySelectorAll('#fields-scroll .field-input').forEach(i => { allValues[i.dataset.key] = i.value; });
  const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
  const supplierName  = supplierInput?.value?.trim() || currentDoc?.supplier_name || null;
  if (btn) { btn.disabled = true; btn.textContent = 'Linking…'; }
  let res;
  try {
    res = await window.docusnap.linkDocumentToTemplate({
      document_id: currentDoc.id, allValues, document_type_slug: docTypeSlug,
      supplier_name: supplierName, target_template_id: Number(targetId),
    });
  } catch (e) { res = { success: false, error: e.message }; }
  if (res && res.success) {
    showToast(`Linked to “${res.targetName || 'template'}” — reprocessing…`, 'ok');
    document.getElementById('btn-reprocess')?.click();   // re-extract; now matches the grouped template
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Link & reprocess'; }
    showToast((res && res.error) || 'Could not link this document.', 'err');
  }
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
  const btn  = document.getElementById('btn-acknowledge');
  const hint = document.getElementById('ack-hint');
  if (!btn) return;
  if (!currentDoc || !isFlagged(currentDoc)) {
    btn.style.display = 'none';
    if (hint) hint.style.display = 'none';
    return;
  }
  btn.style.display = '';
  if (currentDoc.review_acknowledged_at) {
    btn.disabled    = true;
    btn.innerHTML   = '✓ Reviewed';
    btn.style.color = 'var(--ok)';
    if (hint) hint.style.display = 'none';       // already reviewed — no prompt
  } else {
    btn.disabled    = false;
    btn.innerHTML   = '✓ Mark Reviewed';
    btn.style.color = 'var(--warn)';
    if (hint) {                                    // actionable — show the Space hint (CSS default is none)
      hint.style.width   = btn.offsetWidth + 'px'; // match the button width → wraps to two lines
      hint.style.display = 'block';
    }
  }
}

// ── "Why this needs review" summary ─────────────────────────────────────────
// Plain-language explanation of why a document is in the queue, composed from
// the SAME signals the queue colouring uses: below_threshold_count (fields under
// their per-field confidence threshold) and review_flag_count (values a
// processing check flagged), plus the verbatim per-field notes already produced
// during processing. Keeps the two "orange" causes — low confidence vs a format
// flag — distinguishable as two labelled cues.
function renderReviewReason(doc) {
  const el = document.getElementById('review-reason');
  if (!el) return;
  el.innerHTML = '';
  el.hidden    = true;
  if (!doc) return;

  const lowN = doc.below_threshold_count || 0;
  // Only surface flags for fields that belong to THIS document's CURRENT type — a stale
  // extraction left over from a previous type (e.g. an old "invoice_number" note after the
  // doc was re-typed to Print Tracker) must not appear as a phantom flag the user can't see
  // or fix. When the detailed extractions are loaded, derive the count from them (filtered);
  // fall back to the server review_flag_count only before they arrive.
  const _typeKeys = new Set(reviewFields());
  const _relevant = (doc.extractions || []).filter(e => _typeKeys.has(e.field_key));
  const flagN = (doc.extractions && doc.extractions.length)
    ? _relevant.filter(e => e.validation_note || e.corrected_to).length
    : (doc.review_flag_count || 0);

  if (lowN === 0 && flagN === 0) return;   // clean — no banner

  const parts = [];
  if (lowN)  parts.push(`${lowN} field${lowN === 1 ? ' was' : 's were'} read with low confidence`);
  if (flagN) parts.push(`${flagN} field${flagN === 1 ? ' was' : 's were'} flagged by a formatting check`);
  const lead = `Needs a quick check — ${parts.join(', and ')}.`;

  const cues = [];
  if (lowN)  cues.push(`<span class="rr-cue low" title="These fields scored below the confidence threshold set in Settings. Compare the value with the document.">Low confidence · ${lowN}</span>`);
  if (flagN) cues.push(`<span class="rr-cue flag" title="A formatting check found these values look different from what's usual for this field. They may still be correct — just confirm them.">Format check · ${flagN}</span>`);

  const notes = _relevant
    .filter(e => e.validation_note)
    .map(e => ({ key: e.field_key, note: e.validation_note }));
  const MAX = 4;
  const noteList = notes.length
    ? `<ul class="rr-notes">${notes.slice(0, MAX).map(n =>
         `<li><strong>${escHtml(labelFor(n.key))}:</strong> ${escHtml(n.note)}</li>`).join('')}${
         notes.length > MAX ? `<li class="rr-more">+${notes.length - MAX} more</li>` : ''}</ul>`
    : '';

  el.innerHTML = `<div class="rr-lead">${escHtml(lead)}</div>` +
                 `<div class="rr-cues">${cues.join('')}</div>` + noteList;
  el.hidden = false;
}

// ── Totals reconciliation (positive "mathematically verified" badge) ───────────
// Mirrors the backend guardrail's CLOSE case (validator.py total-reconciliation):
// total ≈ subtotal + tax + shipping − discount within 2% / 5p. Computed here from the
// ON-SCREEN field values so it LIVE-UPDATES as the operator edits the total/components,
// and needs no stored flag. Purely a reassurance label — never gates Confirm.
function _parseAmount(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/([\d,]+\.?\d*)/);   // twin of validator.CURRENCY_RE capture
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isNaN(v) ? null : v;
}
// Map a field (key + human label) to its amount ROLE. Order matters: the more specific
// component roles are tested BEFORE 'total' so "Subtotal" is never mistaken for the total.
function _amountRole(key, label) {
  // Underscore is a WORD char, so a snake_case key like 'vat_tax' has NO \b boundary
  // around 'vat'/'tax' — the \b-anchored tax/total rules below then silently miss it and
  // the shadow VAT component maps to no role (breaking the "mathematically verified" badge
  // on a genuinely balanced invoice). Fold '_' to a space so the boundaries fire; the
  // separator-tolerant patterns ('sub[\s_-]?total') are unaffected.
  const s = `${key || ''} ${label || ''}`.toLowerCase().replace(/_/g, ' ');
  // Kept in sync with the backend keyword.ROLE_KEY_ALIASES + keyword_patterns.json labels.
  if (/sub[\s_-]?total|net[\s_-]?(total|amount)|goods[\s_-]?total|\bnett?\b|ex[\s_-]?vat/.test(s))
    return 'subtotal';
  if (/discount|reduction|deduction|rebate|markdown|concession|allowance|promo|promotion|voucher|savings|\bcredit\b/.test(s))
    return 'discount';
  if (/shipping|postage|carriage|freight|freightage|handling|courier|mailing|franking|dispatch|despatch|forwarding|consignment|p\s*&\s*p|p\s+and\s+p|delivery[\s_-]?(charge|cost|fee)|transport[\s_-]?cost/.test(s))
    return 'shipping';
  if (/\b(vat|tax|gst|hst|pst|qst)\b/.test(s)) return 'tax';
  if (key === 'total_amount' ||
      (/\b(grand[\s_-]?total|total|amount[\s_-]?due|balance[\s_-]?due|amount[\s_-]?payable|total[\s_-]?due|total[\s_-]?payable|invoice[\s_-]?total)\b/.test(s)
       && !/sub/.test(s)))                                    return 'total';
  return null;
}
// Read the live role amounts from the rendered inputs and decide whether the total
// reconciles. Returns {verified, totalKey}; verified is only true when BOTH a total and a
// subtotal are present and the arithmetic checks out (NEUTRAL "only a subtotal" is not a
// claim of verification).
function _totalsReconcileState() {
  const roles = {};
  const setRole = (role, key, amount) => {
    if (!role) return;
    if (role === 'total') { if (key === 'total_amount' || !roles.total) roles.total = { key, amount }; }
    else if (!roles[role]) roles[role] = { key, amount };
  };
  // 1) VISIBLE currency fields (live DOM values, so the badge updates as the user edits).
  //    A currency-type gate stops a "Delivery Date" (date) or "Credit Note No" (text) from
  //    being read as a money component.
  document.querySelectorAll('#fields-scroll .field-row[data-key]').forEach(row => {
    const key = row.dataset.key;
    const input = row.querySelector('input.field-input');
    if (!input) return;
    const fdef = (fieldDefs || []).find(f => f.key === key);
    if (fdef && fdef.type && fdef.type !== 'currency') return;
    setRole(_amountRole(key, labelFor(key)), key, _parseAmount(input.value));
  });
  // 2) SHADOW components — subtotal/VAT/shipping/discount read in the BACKGROUND (not shown
  //    as fields). Only fill a role the visible fields didn't already provide, so the maths
  //    reconciles without the user having to add those fields.
  for (const e of ((currentDoc && currentDoc.extractions) || [])) {
    if (e.extraction_method !== 'shadow_reconcile') continue;
    setRole(_amountRole(e.field_key, e.field_key), e.field_key,
            _parseAmount(e.display_value != null ? e.display_value : (e.raw_value || '')));
  }
  const total = roles.total;
  if (!total) return { verified: false, totalKey: null };
  const sub = roles.subtotal ? roles.subtotal.amount : null;
  if (total.amount == null || total.amount <= 0 || sub == null || sub <= 0)
    return { verified: false, totalKey: total.key };
  const tax  = (roles.tax && roles.tax.amount) || 0;
  const ship = (roles.shipping && roles.shipping.amount) || 0;
  const disc = (roles.discount && roles.discount.amount) || 0;
  const tol  = Math.max(total.amount * 0.02, 0.05);
  // Shipping/discount may be separate additions OR line items already inside the subtotal —
  // verified if ANY plausible composition matches (mirrors validator.py reconciliation).
  let verified = false;
  for (const s of [0, 1]) for (const d of [0, 1])
    if (Math.abs(total.amount - (sub + tax + s * ship - d * disc)) <= tol) verified = true;
  return { verified, totalKey: total.key };
}
function updateTotalsVerifiedBadge() {
  document.querySelectorAll('#fields-scroll .field-note.verified').forEach(n => n.remove());
  let st; try { st = _totalsReconcileState(); } catch { return; }
  if (!st || !st.verified || !st.totalKey) return;
  const row = document.querySelector(`#fields-scroll .field-row[data-key="${CSS.escape(st.totalKey)}"]`);
  if (!row) return;
  const div = document.createElement('div');
  div.className = 'field-note verified';
  div.innerHTML = `<span class="corrected-badge" title="This total reconciles against the subtotal and any tax, shipping and discount on the document">✓ Value mathematically verified</span>`;
  const wrap = row.querySelector('.field-input-wrap');
  if (wrap) wrap.insertAdjacentElement('afterend', div); else row.appendChild(div);
}

// ── Drawn-value normalisation (⊕ teach) ───────────────────────────────────────
// When a target box is drawn, tidy the OCR read to match the FIELD TYPE so the input
// shows the clean value: strip the currency symbol from a currency field; parse a date
// field to the app's canonical DD-MM-YYYY, disambiguating day/month order via the region
// setting (region_date_order). Never blanks a read — an unparseable date keeps the raw text.
function _stripCurrencySymbol(s) {
  return String(s)
    .replace(/[£$€¥₹]/g, '')
    .replace(/\b(?:GBP|USD|EUR|JPY|AUD|CAD|CHF|INR|NZD|CNY|ZAR)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const _DRAWN_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function _fmtDMY(d, mo, y) { const p = n => String(n).padStart(2, '0'); return `${p(d)}-${p(mo)}-${y}`; }
function _parseDrawnDate(raw, order) {
  const t = String(raw).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);   // a/b/yyyy — order-dependent
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    let day, mon;
    if (a > 12)               { day = a; mon = b; }   // first > 12 → must be the day
    else if (b > 12)          { mon = a; day = b; }   // second > 12 → must be the day
    else if (order === 'mdy') { mon = a; day = b; }   // US
    else                      { day = a; mon = b; }   // dmy (default) / ymd fallback
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return _fmtDMY(day, mon, y);
    return null;
  }
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);       // ISO yyyy-mm-dd (unambiguous)
  if (m) { const mo = +m[2], day = +m[3]; if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) return _fmtDMY(day, mo, +m[1]); }
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);        // MMM DD YYYY (unambiguous)
  if (m) { const mo = _DRAWN_MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) return _fmtDMY(+m[2], mo, +m[3]); }
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);        // DD MMM YYYY (unambiguous)
  if (m) { const mo = _DRAWN_MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return _fmtDMY(+m[1], mo, +m[3]); }
  return null;
}
let _regionDateOrder = null;
async function _getRegionDateOrder() {
  if (_regionDateOrder) return _regionDateOrder;
  let v = 'dmy';
  try { v = ((await window.docusnap.getSetting('region_date_order')) || 'dmy').toLowerCase(); } catch {}
  _regionDateOrder = ['dmy', 'mdy', 'ymd', 'auto'].includes(v) ? v : 'dmy';
  return _regionDateOrder;
}
async function normalizeDrawnValue(fieldKey, text) {
  const fdef = (fieldDefs || []).find(f => f.key === fieldKey);
  const type = ((fdef && fdef.type) || '').toLowerCase();
  if (type === 'currency') return _stripCurrencySymbol(text) || text;
  if (type === 'date')     return _parseDrawnDate(text, await _getRegionDateOrder()) || text;
  return text;
}

// ── Fields panel ──────────────────────────────────────────────────────────────
function renderFields(doc) {
  const scroll = document.getElementById('fields-scroll');
  scroll.innerHTML = '';
  // The ⊕ "wrong value?" prompt only makes sense with a document loaded — show it
  // for a real doc, hide it on the empty state (clearDocPanel also hides it).
  const sub = document.querySelector('.fields-header-sub');
  if (sub) sub.style.display = doc ? '' : 'none';
  renderExtractionStatus(doc);
  renderReviewReason(doc);
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
  updateTotalsVerifiedBadge();
}

function appendFieldRow(scroll, key, val, conf, note, correctedTo, anchorLabel, method) {
  const low      = conf !== null && conf < 70;
  const confClass = conf === null ? '' : conf >= 70 ? 'high' : conf >= 40 ? 'mid' : 'low';
  // Pair the % with a plain word so non-technical users read it at a glance.
  const confWord = conf === null ? '' : conf >= 70 ? 'High' : conf >= 40 ? 'Check' : 'Low';
  const confLabel = conf !== null
    ? `<span class="conf-badge ${confClass}" title="${confWord} confidence — the app is ${conf}% sure of this reading">${confWord} · ${conf}%</span>`
    : '';
  // A correction that was ALREADY APPLIED to the value (Stage 4.5 strong auto-fix:
  // an OCR misread of a near-universal learned token, e.g. "Lid"→"Ltd") shows as a
  // calm "auto-corrected" badge — the value in the input IS the fix, so there is no
  // Accept button. A SUGGESTION (corrected_to differs from the current value) keeps
  // the amber note + Accept button. The applied case is detected by value equality,
  // which the engine guarantees (value/display_value/corrected_to all set to the
  // repair on auto-apply).
  const isApplied = !!correctedTo && val === correctedTo;
  // An "Accept" button is shown ONLY for unapplied correction CANDIDATES. The button
  // copies the suggestion into the input; it never confirms or persists.
  const acceptHtml = (correctedTo && !isApplied)
    ? ` <button type="button" class="accept-btn" data-key="${key}">Accept</button>`
    : '';
  const noteHtml = isApplied
    ? `<div class="field-note corrected"><span class="corrected-badge" title="An OCR misread was auto-corrected to the spelling that recurs in your confirmed data">✓ auto-corrected</span> ${escHtml(note || '')}</div>`
    : (note || correctedTo)
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
  // Plain-language gloss for the identity field — "Document Issuer" reads as ambiguous to
  // non-technical / non-native users (own company vs the other party). Spell out it's the SENDER.
  const _issuerHint = (key === 'supplier_name' || key === 'customer_name')
    ? ' title="The company the document is FROM — the sender who issued it (e.g. the supplier on an invoice). Not your own company."'
    : '';
  row.innerHTML = `
    <div class="field-row-header">
      <span class="field-row-label" data-key="${key}"${_issuerHint}>${escHtml(labelFor(key))}</span>
      ${confLabel}
    </div>
    <div class="field-input-wrap">
      <input type="text" class="field-input ${low ? 'low-conf' : ''}"
             data-key="${key}" data-original="${escHtml(val)}"
             value="${escHtml(val)}" placeholder="Not found">
      <button class="pick-btn" data-key="${key}" title="Teach this field — draw a box round its value; Scan Finder learns where it sits and reads it on every future document from this supplier">&#8853;</button>
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
    // Eagerly CLEAR any standing warning the moment the user starts fixing the
    // value — only re-evaluate (and possibly re-flag) on blur, so the error never
    // flashes mid-type (e.g. an unfinished "12-05" looks invalid until complete).
    clearFieldWarning(row);
    validateConfirm();
    updateTotalsVerifiedBadge();   // live-update the "mathematically verified" total badge
  });

  // Immediate regex/type validation on focus-out. Synchronous + warn-only: it sets
  // a lightweight inline error state but NEVER disables Confirm (an operator can
  // still file an OCR edge-case value, mirroring extraction's review-not-reject
  // philosophy) and never re-renders or moves focus — so clicking Confirm (which
  // blurs the field) can't race or be hijacked. No reprocess, no IPC, no pause.
  input.addEventListener('blur', () => {
    const msg = fieldValidationError(key, input.value);
    if (msg) setFieldWarning(row, input, msg);
    else clearFieldWarning(row, input);
  });

  // Right-click → field cleanup-rule toolkit (strip a leaked heading/column). Gated
  // to admin/edit (the save is also role-checked server-side). Read-only users get
  // the native menu.
  input.addEventListener('contextmenu', (e) => {
    if (!canEdit) return;
    showFieldRuleMenu(e, input, key);
  });

  // ── Date shortcut + free-text type-ahead ──────────────────────────────────────
  const fdef  = (fieldDefs || []).find(f => f.key === key);
  const ftype = ((fdef && fdef.type) || '').toLowerCase();
  // 't' / 'T' in a DATE field fills today's date (DD-MM-YYYY — the canonical format).
  if (ftype === 'date') {
    input.addEventListener('keydown', (e) => {
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        input.value = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));  // update corrections + clear warning
      }
    });
  }
  // Type-ahead for FREE-TEXT fields (names / generic text — no structured pattern):
  // after 3 chars, suggest values already confirmed for this field on this doc type.
  // Native <datalist> (browser handles matching + keyboard); options lazy-loaded once,
  // and the list is only attached at >= 3 chars so it stays quiet for short input.
  if (!validationKeyFor(fdef) && currentDoc && currentDoc.id != null) {
    const dlId = `field-sugg-${key}`;
    const dl = document.createElement('datalist');
    dl.id = dlId;
    row.appendChild(dl);
    let loaded = false;
    const ensureLoaded = async () => {
      if (loaded) return;
      loaded = true;
      try {
        const vals = (await window.docusnap.getFieldSuggestions(currentDoc.id, key)) || [];
        dl.innerHTML = vals.map(v => `<option value="${escHtml(v)}"></option>`).join('');
      } catch { /* suggestions are best-effort */ }
    };
    // Force-close the native popup. Removing `list` alone does NOT dismiss an already-
    // open Chromium datalist — only blur does — so blur, then refocus (with `list` gone)
    // to keep the cursor in the field without the popup reopening.
    const closeSuggest = () => {
      input.removeAttribute('list');
      input.blur();
      requestAnimationFrame(() => input.focus());
    };
    let lastArrowAt = 0;
    input.addEventListener('input', (e) => {
      if (e && e.inputType === 'insertReplacementText') {
        // A datalist value was inserted. Arrow NAVIGATION fires this right after an
        // Arrow keydown (keep the popup open); a MOUSE PICK fires it with no recent
        // arrow (that's a commit → close). Enter is handled in keydown below.
        if (Date.now() - lastArrowAt > 150) setTimeout(closeSuggest, 0);
        return;
      }
      if (input.value.trim().length >= 3) { ensureLoaded(); input.setAttribute('list', dlId); }
      else input.removeAttribute('list');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') lastArrowAt = Date.now();
      else if (e.key === 'Enter' && input.hasAttribute('list')) setTimeout(closeSuggest, 0);
    });
  }

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
  // A role is either ASSIGNED (points at a real field key) or legitimately UNSET.
  // Do NOT fall back to the literal invoice_number/invoice_date — a custom type
  // keyed only by a date (delivery note, worksheet), or a type whose ref role was
  // self-healed to NULL, then gates on a phantom field that can never be filled,
  // permanently disabling Confirm (QA audit #2). Honour the type: require only the
  // roles it actually designates. This matches the backend, which deliberately
  // refuses to force a reference role.
  const dateKey  = dt?.date_field_key || null;
  const refKey   = dt?.ref_field_key  || null;
  const note     = document.getElementById('confirm-config-note');

  // A role that IS ASSIGNED but points at a field that no longer exists on the type
  // (a dangling pointer — e.g. the Reference field was deleted) can never be
  // satisfied, so say so plainly. An UNSET role is fine and is skipped.
  const fieldExists = (key) => !!document.querySelector(`.field-input[data-key="${key}"]`);
  const dangling = [
    dateKey ? { key: dateKey, role: 'Date' } : null,
    refKey  ? { key: refKey,  role: 'Reference' } : null,
  ].filter(r => r && !fieldExists(r.key));
  if (note) {
    if (dangling.length) {
      note.textContent = `This document type’s ${dangling.map(d => d.role).join(' and ')} field `
        + `${dangling.length > 1 ? 'aren’t' : 'isn’t'} set up. `
        + `Choose ${dangling.length > 1 ? 'them' : 'it'} in Settings → Document Types, then reopen this document.`;
      Object.assign(note.style, { display: '', color: 'var(--warn)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    } else {
      note.style.display = 'none';
    }
  }
  if (dangling.length) { btn.disabled = true; markRequiredMissing([]); return; }

  // Required = the assigned date/ref roles PLUS any CUSTOM field flagged Required in the
  // Type Manager (fields.required) — minus the Document-Issuer identity, which is warn-only
  // (handled below). Only fields actually present on screen are gated.
  const ISSUER_KEYS = ['supplier_name', 'customer_name'];
  const requiredKeys = new Set([dateKey, refKey]);
  for (const f of (dt?.fields || [])) {
    if (f.required && f.enabled !== 0 && !ISSUER_KEYS.includes(f.key)) requiredKeys.add(f.key);
  }
  const required = [...requiredKeys].filter(k => k && fieldExists(k));
  const missing = required.filter(key => {
    const input = document.querySelector(`.field-input[data-key="${key}"]`);
    return !input || !input.value.trim();
  });

  const issuerNote = document.getElementById('confirm-issuer-note');
  const issuerKey  = issuerBlankKey();

  if (missing.length) {
    // These roles are needed to file (the filename is built from them), so Confirm stays
    // disabled — but say plainly WHAT to add and WHY, instead of a silent greyed-out button.
    if (note) {
      const labels = missing.map(k => `<b>${escHtml(labelFor(k))}</b>`);
      const list = labels.length > 1
        ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1]
        : labels[0];
      note.innerHTML = `To file this document, please fill in ${list} — `
        + `${missing.length > 1 ? 'these fields are' : 'this field is'} needed to file it.`
        + (issuerKey ? ' The Document Issuer is empty too — add it so the app can learn this sender.' : '');
      Object.assign(note.style, { display: '', color: 'var(--warn)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    }
    if (issuerNote) issuerNote.style.display = 'none';
    markRequiredMissing(missing);
    btn.disabled = true;
    return;
  }

  // Required roles are all present. A blank Document Issuer is a WARN, not a block (the
  // app's review-not-reject posture) — name the consequence and let the user file anyway.
  if (note) note.style.display = 'none';
  if (issuerNote) {
    if (issuerKey) {
      issuerNote.textContent = 'No Document Issuer yet — if you file now it will be saved under '
        + '“Unknown Company” and the app won’t learn this sender. Add the issuer above, or file anyway.';
      Object.assign(issuerNote.style, { display: '', color: 'var(--warn)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    } else {
      issuerNote.style.display = 'none';
    }
  }

  markRequiredMissing([]);
  btn.disabled = false;
}

// The identity/Document-Issuer field key (supplier_name | customer_name) on screen
// when it is BLANK; null when present-and-filled or the type has no issuer field.
function issuerBlankKey() {
  for (const key of ['supplier_name', 'customer_name']) {
    const input = document.querySelector(`.field-input[data-key="${key}"]`);
    if (input) return input.value.trim() ? null : key;
  }
  return null;
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
  anchorDrawField = null;
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

// ── Trace-highlight overlay ───────────────────────────────────────────────────
// Draws an amber bbox from a slice trace event onto the dedicated traceCanvas.
// Clears automatically after a short dwell; also cleared on page/doc change.
let _traceHighlightTimer = null;
function clearTraceHighlight() {
  if (_traceHighlightTimer) { clearTimeout(_traceHighlightTimer); _traceHighlightTimer = null; }
  traceCtx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
}
// Slice stages whose bbox is [cx, cy, w, h] CENTRE-based — the anchor.py crop
// reads (_crop_and_ocr crops cx±half). Everything else (template_mapping, the
// inline harvest's inline_box) is [x_tl, y_tl, w, h] TOP-LEFT-based.
const _CENTRE_BASED_SLICE_STAGES = new Set(['anchor_crop', 'anchor_relocate', 'anchor_registration']);
// `keep` = draw ON TOP of the current highlight without clearing it first — used to
// overlay the anchor (label) box together with the value box from one click.
function drawTraceBbox(bbox, kind, stage, keep) {
  if (!bbox || bbox.length < 4 || !traceCanvas.width) return;
  if (!keep) clearTraceHighlight();
  const w = traceCanvas.width, h = traceCanvas.height;
  const bw = Math.round(bbox[2] * w), bh = Math.round(bbox[3] * h);
  const isCenterBased = _CENTRE_BASED_SLICE_STAGES.has(stage);
  const x = isCenterBased ? Math.round(bbox[0] * w - bw / 2) : Math.round(bbox[0] * w);
  const y = isCenterBased ? Math.round(bbox[1] * h - bh / 2) : Math.round(bbox[1] * h);
  // target = amber (value region), anchor = blue (label region)
  const color = kind === 'anchor' ? '#4f8ef7' : '#d4820a';
  traceCtx.save();
  traceCtx.setLineDash([3, 3]);
  traceCtx.lineWidth = 2;
  traceCtx.strokeStyle = color;
  traceCtx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  traceCtx.setLineDash([]);
  traceCtx.fillStyle = color + '28';
  traceCtx.fillRect(x, y, bw, bh);
  traceCtx.restore();
  if (_traceHighlightTimer) clearTimeout(_traceHighlightTimer);   // single shared dwell for both boxes
  // Long idle dwell so you can actually study the box; it still clears immediately on
  // the next row click, page change, or doc change (clearTraceHighlight callers).
  _traceHighlightTimer = setTimeout(clearTraceHighlight, 30000);
}

selCanvas.addEventListener('mousedown', (e) => {
  if (!activeField && !anchorDrawField) return;
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
  if (!isDragging || !dragRect || (!activeField && !anchorDrawField)) return;
  isDragging = false;
  if (dragRect.w < 10 || dragRect.h < 10) { clearCanvas(); return; }
  if (anchorDrawField) { const f = anchorDrawField; await runAnchorDraw(dragRect, f); }
  else await runZoneOcr(dragRect, activeField);
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

    // Read via the --boxes path so we also learn the line COUNT (for the tall-box auto-rule).
    // result.text is the same cleaned, multi-line-aware value the plain path returns.
    const boxes  = await window.docusnap.ocrRegionBoxes?.(base64);
    const rawText = ((boxes && boxes.text) || (await window.docusnap.ocrRegion(base64)) || '').trim();
    // Tidy to the field type — strip a currency symbol, parse a date to canonical DD-MM-YYYY
    // (region-aware). Used for the input value, the correction, and the learned anchor value.
    const text   = rawText ? await normalizeDrawnValue(fieldKey, rawText) : rawText;

    if (text) {
      const input = document.querySelector(`.field-input[data-key="${fieldKey}"]`);
      if (input) {
        const orig = input.dataset.original;
        input.value = text;
        input.classList.add('corrected');
        corrections[fieldKey] = { original_value: orig, corrected_value: text };
        validateConfirm();
      }
      // TALL-BOX teach method: the drawn box read 2+ lines, so this value WRAPS — auto-stage a
      // multiline_continue rule (silent) for free-text/name-like fields, so future wrapping
      // scans are joined. The right-click "This field can wrap" toggle is the explicit alternative.
      if (boxes && boxes.lines >= 2 && _isNameLikeField(fieldKey)) {
        _stageMultilineRule(fieldKey, { silent: true });
        try { showToast('Looks like this value wraps onto the next line — wrapping enabled, saved on Confirm.', 'ok'); } catch {}
      }
      lastTeachCtx = { fieldKey, rect, imgW, imgH, scaleX, scaleY, value: text };
      const detected = await captureAnchorContext(rect, fieldKey, text, imgW, imgH, scaleX, scaleY);
      if (detected) {
        anchorTaughtFields.add(fieldKey);
        showAnchorReadout(detected, text);   // show which anchor was picked + the Left/Above toggle
      }
    }
  } catch (err) {
    console.error('Zone OCR error:', err);
  }

  ocrOverlay.classList.remove('visible');
  cancelZoneMode();
}

// ── Field cleanup rules — right-click menu ──────────────────────────────────
// Teach Scan Finder to strip an adjacent heading/column OCR bled into a field.
// Mirrors the ⊕ model: the field VALUE is fixed immediately; the learned RULE is
// staged in pendingFieldRules and committed on confirm. Three tooltipped options.
let _fieldRuleMenuEl = null;

function _frTruncate(s, n = 40) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function closeFieldRuleMenu() {
  if (_fieldRuleMenuEl) { _fieldRuleMenuEl.remove(); _fieldRuleMenuEl = null; }
  document.removeEventListener('mousedown', _onFieldRuleMenuOutside, true);
}
function _onFieldRuleMenuOutside(e) {
  if (_fieldRuleMenuEl && !_fieldRuleMenuEl.contains(e.target)) closeFieldRuleMenu();
}

// Snap [start,end) to whole words within `value`. First SHRINK off any selected
// whitespace at the edges (so a stray trailing/leading space in the drag doesn't pull
// in the next word — "7 " must stay "7", not grow into "7 Beaumont"), THEN grow each
// edge out to the full word it sits inside (so a partial word becomes whole).
function _snapToWords(value, start, end) {
  while (start < end && /\s/.test(value[start]))     start++;
  while (end > start && /\s/.test(value[end - 1]))   end--;
  if (start >= end) return [start, end];
  while (start > 0 && /\S/.test(value[start - 1]))   start--;
  while (end < value.length && /\S/.test(value[end])) end++;
  return [start, end];
}

// Name-like / naturally-multi-word fields (names, addresses, companies) must NOT be
// offered "Keep only the main value": that keeps a single code-shaped token, which is
// catastrophic when the junk is a stray digit and the value is a name ("7 Beaumont…"
// → "7"). Mirrors the spirit of python value_quality.is_name_like_field.
function _isNameLikeField(key) {
  const s = (String(key || '') + ' ' + String(labelFor(key) || '')).toLowerCase();
  return /name|address|company|customer|supplier|contact/.test(s);
}

// Learning scope (supplier + doctype) for a staged rule — same resolution the ⊕
// teach uses so a rule isn't keyed to a stale identity.
function _fieldRuleScope() {
  const docType = currentDoc?.type_slug || currentDoc?.document_type_slug || null;
  const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
  const supplier = supplierInput?.value?.trim() || currentDoc?.supplier_name || null;
  return { document_type: docType, supplier_name: cleanSupplierName(supplier) };
}

// The single code-shaped (digit-bearing) token, mirroring the engine's keep_block
// tie-break — or null when 0 / >1 such tokens (ambiguous).
function _keepBlockResult(value) {
  const toks = (value || '').trim().split(/\s+/);
  if (toks.length < 2) return null;
  const digit = toks.filter(t => /\d/.test(t));
  return digit.length === 1 ? digit[0] : null;
}

// Apply a value change through the normal 'input' path (records corrections + runs
// validation), optionally staging a learned rule (committed on confirm).
function _applyFieldRule(input, key, newValue, rule) {
  input.value = newValue;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (rule) {
    (pendingFieldRules[key] = pendingFieldRules[key] || []).push(rule);
    try { showToast('Saved for this document — the rule applies when you Confirm.', 'ok'); } catch {}
  }
  closeFieldRuleMenu();
}

// Stage a multiline_continue rule (no value change) so a value that WRAPS onto the next line
// is joined on future scans. Idempotent per field; committed on Confirm via saveFieldRule.
function _stageMultilineRule(key, { silent = false } = {}) {
  pendingFieldRules[key] = pendingFieldRules[key] || [];
  if (!pendingFieldRules[key].some(r => r.rule_type === 'multiline_continue')) {
    pendingFieldRules[key].push({ ..._fieldRuleScope(), field_key: key, rule_type: 'multiline_continue', token: '-' });
    if (!silent) { try { showToast('This field will read values that wrap onto the next line — saved when you Confirm.', 'ok'); } catch {} }
  }
  closeFieldRuleMenu();
}
function _hasMultilineRule(key) {
  if ((pendingFieldRules[key] || []).some(r => r.rule_type === 'multiline_continue')) return true;
  // Also reflect a SAVED rule in scope for this doc (supplier+doctype, or global/doctype-only).
  const scope    = _fieldRuleScope();
  const supplier = (scope.supplier_name || '').toLowerCase();
  const doctype  = (scope.document_type || '').toLowerCase();
  return _savedFieldRules.some(r =>
    r.rule_type === 'multiline_continue' && r.field_key === key
    && (r.document_type || '').toLowerCase() === doctype
    && ['__global__', '', supplier].includes((r.supplier_name || '').toLowerCase()));
}

function showFieldRuleMenu(e, input, key) {
  e.preventDefault();
  closeFieldRuleMenu();
  const value = input.value || '';
  if (!value.trim()) return;

  // Selection → leading/trailing trim (whole-value selection is blocked).
  let s = input.selectionStart, en = input.selectionEnd;
  let selected = '', side = null, removeResult = null;
  if (s != null && en != null && s !== en) {
    [s, en] = _snapToWords(value, s, en);
    selected = value.slice(s, en).trim();
    const touchesStart = !value.slice(0, s).trim();
    const touchesEnd   = !value.slice(en).trim();
    if (touchesStart && touchesEnd) { selected = ''; }            // whole value → nothing to trim
    else if (touchesEnd)  { side = 'trailing'; removeResult = value.slice(0, s).replace(/\s+$/, ''); }
    else if (touchesStart) { side = 'leading';  removeResult = value.slice(en).replace(/^\s+/, ''); }
    else { selected = ''; }                                        // interior → not a leak (edit directly)
  }
  const trimOk = selected && (side === 'leading' || side === 'trailing')
              && removeResult && removeResult.trim() && removeResult.trim() !== value.trim();

  const items = [];
  // "Keep only the main value" is for single-value CODE fields only — never name-like
  // fields (a name is naturally multi-word; keeping one digit token would gut it).
  const kb = _isNameLikeField(key) ? null : _keepBlockResult(value);
  if (kb && kb !== value.trim()) {
    items.push({
      label: 'Keep only the main value',
      sub: `${_frTruncate(value)}  →  ${_frTruncate(kb)}`,
      tip: 'This field holds one value (e.g. a code). On future scans we keep the value and drop extra words that leak in from a neighbouring heading or column — on either side.',
      onClick: () => _applyFieldRule(input, key, kb, { ..._fieldRuleScope(), field_key: key, rule_type: 'keep_block' }),
    });
  }
  if (trimOk) {
    items.push({
      label: 'Remove this text from future scans',
      sub: `${_frTruncate(value)}  →  ${_frTruncate(removeResult)}`,
      tip: `We'll remove "${_frTruncate(selected, 28)}" (and close OCR variants) from this field on future scans, where it ${side === 'leading' ? 'leads' : 'trails'} the value.`,
      onClick: () => _applyFieldRule(input, key, removeResult, { ..._fieldRuleScope(), field_key: key, rule_type: 'remove_text', token: selected, side }),
    });
    items.push({
      label: 'Just fix this one',
      sub: `${_frTruncate(value)}  →  ${_frTruncate(removeResult)}`,
      tip: "Fix only this document. Scan Finder won't change how it reads future scans.",
      onClick: () => _applyFieldRule(input, key, removeResult, null),
    });
  }
  // "This field can wrap to the next line" — free-text / name-like fields only. Teaches a
  // multiline_continue rule so a value that wraps (first line ends with "-") is read + joined
  // on future scans; single-line values are unaffected. Available with no selection.
  if (_isNameLikeField(key)) {
    const on = _hasMultilineRule(key);
    items.push({
      label: on ? '✓ Wrapping is on for this field' : 'This field can wrap to the next line',
      sub: on
        ? 'Saved when you tap Confirm.'
        : 'When the value runs onto a second line (the first line ends with “-”), Scan Finder reads the line below and joins them on future scans. Single-line values are unaffected.',
      wrap: true,   // a descriptive sentence — wrap it instead of the native tooltip
      onClick: on ? () => closeFieldRuleMenu() : () => _stageMultilineRule(key),
    });
  }
  if (!items.length) return;

  const menu = document.createElement('div');
  menu.className = 'field-rule-menu';
  menu.setAttribute('data-help-ignore', '');
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'frm-item';
    if (it.tip) b.title = it.tip;   // native tooltip only when set (a wrapping sub needs none)
    b.innerHTML = `<span class="frm-label">${escHtml(it.label)}</span>`
                + `<span class="frm-sub${it.wrap ? ' frm-wrap' : ''}">${escHtml(it.sub)}</span>`;
    b.addEventListener('click', it.onClick);
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  _fieldRuleMenuEl = menu;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth)  x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top  = `${Math.max(8, y)}px`;
  setTimeout(() => document.addEventListener('mousedown', _onFieldRuleMenuOutside, true), 0);
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

// From the OCR word boxes of a left-of-value strip (one line tall), return the
// RIGHTMOST contiguous block — the caption nearest the value — split from any other
// column on a wide horizontal gap. Returns { text, box:[l,t,w,h] } in the words' own
// px space, or null when there are no usable words. This is what stops a wide
// two-column key/value row ("Ticket No. … Work Address") merging BOTH captions into
// one bogus anchor: we keep only the caption adjacent to the value. Reusable for any
// multi-column layout, not one document.
function nearestLeftCluster(words) {
  const ws = (words || [])
    .filter(w => w && Array.isArray(w.box) && w.box.length >= 4 && (w.text || '').trim())
    .map(w => ({ text: w.text.trim(), l: +w.box[0], t: +w.box[1], w: +w.box[2], h: +w.box[3] }))
    .filter(w => isFinite(w.l) && isFinite(w.w))
    .sort((a, b) => a.l - b.l);
  if (!ws.length) return null;
  // A real inter-COLUMN gap is several text-heights wide — far larger than the
  // inter-word space inside one caption. Tie the threshold to the median word height
  // so it scales with DPI/zoom rather than a brittle pixel constant.
  const heights = ws.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 0;
  const gapThresh = Math.max(medH * 1.2, 8);
  // Walk left→right; a gap past the threshold starts a new column, discarding
  // everything to its left. The surviving block is the rightmost (nearest) column.
  let block = [ws[0]];
  for (let i = 1; i < ws.length; i++) {
    const prev = ws[i - 1];
    const gap = ws[i].l - (prev.l + prev.w);
    if (gap > gapThresh) block = [ws[i]];
    else block.push(ws[i]);
  }
  const l = Math.min(...block.map(w => w.l));
  const t = Math.min(...block.map(w => w.t));
  const r = Math.max(...block.map(w => w.l + w.w));
  const b = Math.max(...block.map(w => w.t + w.h));
  return { text: block.map(w => w.text).join(' '), box: [l, t, r - l, b - t] };
}

// The located label's box as page-normalised [x,y,w,h] (top-left), for the
// "show the detected anchor" overlay. Same crop-origin math as labelOffsetFromBox.
function labelNormBox(box, originDX, originDY, imgW, imgH) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const nW = docImg.naturalWidth || imgW, nH = docImg.naturalHeight || imgH;
  if (!nW || !nH || !imgW || !imgH) return null;
  return [(originDX / imgW) + (box[0] / nW), (originDY / imgH) + (box[1] / nH),
          box[2] / nW, box[3] / nH];
}

async function captureAnchorContext(rect, fieldKey, value, imgW, imgH, scaleX, scaleY, forceDir = null) {
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
  // Search the WHOLE row to the LEFT of the value (not a fixed 300px window): on wide
  // two-column key/value layouts the label ("Make", "IP address") sits far left of its
  // value — beyond a narrow window — so a TIGHT value box would find nothing to the
  // left and wrongly fall through to the row ABOVE (grabbing the line above, e.g. the
  // customer name). The strip stays ONE line tall (rect.h), so it only reads THIS row;
  // extractLabel takes the token nearest the value. Each attempt is independently
  // guarded — a failure here (bad crop, OCR error) must NOT prevent the guaranteed
  // fallback save below, otherwise nothing gets learned at all.
  // forceDir (from the readout's Left/Above toggle) pins ONE direction: 'right' = label
  // to the left only, 'below' = label above only; null = auto (left then above).
  if (forceDir !== 'below') try {
    const leftPad    = rect.x;   // full span from the page's left edge to the value box
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
      // Keep only the column nearest the value, not the whole row to the left — a wide
      // key/value row OCRs as "label1 …gap… label2" and the far-left caption must not
      // be glued onto the real adjacent one. Falls back to the full strip when word
      // boxes aren't available (legacy region.py output).
      const cluster   = nearestLeftCluster(leftRes && leftRes.words);
      const leftText  = (cluster ? cluster.text
                          : ((leftRes && leftRes.text) || (await window.docusnap.ocrRegion(leftB64)) || '')).trim();
      const leftBox   = cluster ? cluster.box : (leftRes && leftRes.box);
      const leftLabel = sanitizeAnchorLabel(extractLabel(leftText) || '');
      if (leftLabel) {
        // Drift-invariant offset: the located label's page position → value centre.
        // Origin of the left crop in DISPLAY px is (rect.x - leftPad, rect.y).
        const off = labelOffsetFromBox(leftBox, rect.x - leftPad, rect.y, xNorm, yNorm, imgW, imgH);
        // label_detected: this caption was OCR'd from the PAGE (not the field-name
        // fallback), so the backend must NOT drop it even if it equals the field key
        // (a "Make" field whose on-page label is literally "Make").
        pendingAnchors[fieldKey] = { ...anchorBase, anchor_label: leftLabel, direction: 'right', ...off, label_detected: true };
        return { anchor_label: leftLabel, direction: 'right',
                 normBox: labelNormBox(leftBox, rect.x - leftPad, rect.y, imgW, imgH) };
      }
    }
  } catch (err) {
    console.warn('Anchor capture: left-label lookup failed (non-critical):', err);
  }

  if (forceDir !== 'right') try {
    // Read ONLY the single line directly above the value, not a fixed 60px band that
    // bled into ~2 rows (capturing the line above AND the one above that → garbled).
    // Tie the strip height to the value box's own line height (rect.h), floored so a
    // very thin draw still reads.
    const abovePad    = Math.min(rect.y, Math.max(rect.h, 20));
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
      // "A value ABOVE is not a label": sanitizeAnchorLabel strips code/serial/number
      // tokens (a MAC, an IP, a reference, a date), so the above-strip yields a label
      // ONLY when it's a real caption — never the value sitting in the row above. This
      // stops the snap latching onto the MAC above instead of the label to the left.
      const aboveLabel = sanitizeAnchorLabel(extractLabel(aboveText) || '');
      if (aboveLabel) {
        // Origin of the above crop in DISPLAY px is (rect.x, rect.y - abovePad).
        const off = labelOffsetFromBox(aboveRes && aboveRes.box, rect.x, rect.y - abovePad, xNorm, yNorm, imgW, imgH);
        pendingAnchors[fieldKey] = { ...anchorBase, anchor_label: aboveLabel, direction: 'below', ...off, label_detected: true };
        return { anchor_label: aboveLabel, direction: 'below',
                 normBox: labelNormBox(aboveRes && aboveRes.box, rect.x, rect.y - abovePad, imgW, imgH) };
      }
    }
  } catch (err) {
    console.warn('Anchor capture: above-label lookup failed (non-critical):', err);
  }

  // Guaranteed fallback — always STAGE SOMETHING so the position is learned on
  // commit even when no nearby label text could be read. The actual persistence
  // (and its admin-role / DB-error handling) happens in confirmCurrentDoc, so an
  // un-confirmed teach leaves no trace.
  const fallbackLabel = labelFor(fieldKey) || fieldKey.replace(/_/g, ' ');
  pendingAnchors[fieldKey] = { ...anchorBase, anchor_label: fallbackLabel, direction: 'right' };
  return { anchor_label: fallbackLabel, direction: 'right', normBox: null, fallback: true };
}

// Surface WHICH anchor the ⊕ teach auto-detected (its label + where it sits) and the
// value it read, so a wrong snap — onto the value in the row ABOVE instead of the
// label to the LEFT — is VISIBLE and the operator can simply draw again. The detected
// anchor box flashes on the preview; the message warns on the weak cases (anchored
// from above, or by position with no label found).
let _anchorReadoutTimer = null;
function hideAnchorReadout() {
  const bar = document.getElementById('anchor-readout');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  if (_anchorReadoutTimer) { clearTimeout(_anchorReadoutTimer); _anchorReadoutTimer = null; }
}
function showAnchorReadout(detected, value) {
  try { if (detected.normBox) drawTraceBbox(detected.normBox, 'anchor', 'manual'); } catch {}
  const bar = document.getElementById('anchor-readout');
  if (!bar) return;
  const val   = escHtml((value || '').trim());
  const isLeft  = detected.direction === 'right';
  const isAbove = detected.direction === 'below';
  const suspicious = !detected.fallback && labelLooksSuspicious(detected.anchor_label);
  const warn = detected.fallback || suspicious;
  let msg;
  if (detected.fallback) {
    msg = `<span class="ar-msg">&#9888; No label found — anchored by position. Read: "${val}"</span>`;
  } else {
    // The label is EDITABLE — an auto-detect off a noisy scan can be misread ("verial No."),
    // and a wrong label never re-locates. The operator can correct it here before Confirm.
    const lead = suspicious
      ? '&#9888; This label looks misread — check it matches the caption on the page:'
      : `&#10003; Anchor (label ${isAbove ? 'above' : 'to the left'}):`;
    msg = `<span class="ar-msg">${lead} `
      + `<input class="ar-label-edit" spellcheck="false" title="The caption this field sits beside — edit if it was misread" `
      + `style="font:inherit;font-weight:600;padding:1px 5px;min-width:90px;border:1px solid var(--border2);border-radius:5px;background:var(--surface)"> `
      + `&rarr; "${val}"</span>`;
  }
  bar.className = 'anchor-readout' + (warn ? ' warn' : '');
  bar.innerHTML = msg
    + `<span class="ar-dir"><span class="ar-lbl">Label is:</span>`
    + `<button class="ar-btn ${isLeft ? 'on' : ''}" data-dir="right">&larr; Left</button>`
    + `<button class="ar-btn ${isAbove ? 'on' : ''}" data-dir="below">&uarr; Above</button>`
    + `<button class="ar-btn ar-draw" title="Draw a box around the exact label to anchor on (e.g. &quot;Invoice Total&quot;) — useful when the value sits beside a repeating word like GBP">&#9998; Draw the anchor</button></span>`
    + `<span class="ar-x" title="Dismiss">&times;</span>`;
  bar.style.display = '';
  // Populate + wire the editable label (value set via JS to avoid attribute-escaping issues).
  const lblInput = bar.querySelector('.ar-label-edit');
  if (lblInput) {
    lblInput.value = detected.anchor_label || '';
    lblInput.addEventListener('change', () => {
      const fk = lastTeachCtx?.fieldKey;
      const cleaned = sanitizeAnchorLabel(lblInput.value);
      if (fk && pendingAnchors[fk]) {
        pendingAnchors[fk].anchor_label = cleaned || (labelFor(fk) || fk.replace(/_/g, ' '));
        pendingAnchors[fk].label_detected = !!cleaned;   // a typed caption is a real label
      }
      lblInput.classList.toggle('bad', labelLooksSuspicious(cleaned));
    });
  }
  bar.querySelectorAll('.ar-btn[data-dir]').forEach(b => b.addEventListener('click', () => reDetectAnchor(b.dataset.dir)));
  bar.querySelector('.ar-draw')?.addEventListener('click', () => enterAnchorDrawMode(lastTeachCtx?.fieldKey));
  bar.querySelector('.ar-x')?.addEventListener('click', hideAnchorReadout);
  if (_anchorReadoutTimer) clearTimeout(_anchorReadoutTimer);
  _anchorReadoutTimer = setTimeout(hideAnchorReadout, 30000);   // stay long enough to read + act; matches the box dwell
}
// Re-run label detection forcing a direction (the Left/Above toggle), reusing the
// cached draw context — so when auto-detect grabs the wrong neighbour the operator
// just flips it instead of redrawing. Re-stages pendingAnchors + redraws the box.
async function reDetectAnchor(dir) {
  if (!lastTeachCtx) return;
  const c = lastTeachCtx;
  try {
    const detected = await captureAnchorContext(c.rect, c.fieldKey, c.value, c.imgW, c.imgH, c.scaleX, c.scaleY, dir);
    if (detected) { anchorTaughtFields.add(c.fieldKey); showAnchorReadout(detected, c.value); }
  } catch (err) { console.warn('Anchor re-detect failed:', err); }
}

// ── Manual anchor draw ────────────────────────────────────────────────────────
// The operator draws a box around the EXACT label to anchor on (e.g. "Invoice Total")
// when auto-detect found nothing usable or grabbed a repeating word (GBP, a column
// header). Arms the same draw canvas; the next box is read as the anchor, not a value.
function enterAnchorDrawMode(fieldKey) {
  if (!fieldKey || !lastTeachCtx || lastTeachCtx.fieldKey !== fieldKey) {
    try { showToast('Draw the value box first, then draw its anchor.', 'warn'); } catch {}
    return;
  }
  cancelZoneMode();
  anchorDrawField = fieldKey;
  hintField.textContent = `Draw a box around the label for “${labelFor(fieldKey) || fieldKey}” (e.g. Invoice Total)`;
  selectHint.classList.add('visible');
  selCanvas.classList.add('active');
}

// OCR the drawn anchor box, derive the label + a drift-invariant offset to the value,
// and stage it as the field's anchor (authoritative, like a normal ⊕ teach).
async function runAnchorDraw(aRect, fieldKey) {
  const c = lastTeachCtx;
  anchorDrawField = null;
  selectHint.classList.remove('visible');
  selCanvas.classList.remove('active');
  clearCanvas();
  if (!c || c.fieldKey !== fieldKey) return;
  ocrOverlay.classList.add('visible');
  try {
    const { imgW, imgH, scaleX, scaleY, rect } = c;
    const crop = document.createElement('canvas');
    crop.width  = Math.round(aRect.w * scaleX);
    crop.height = Math.round(aRect.h * scaleY);
    if (crop.width > 6 && crop.height > 6) {
      crop.getContext('2d').drawImage(
        docImg,
        Math.round(aRect.x * scaleX), Math.round(aRect.y * scaleY),
        crop.width, crop.height, 0, 0, crop.width, crop.height);
      const b64  = crop.toDataURL('image/png').split(',')[1];
      const res  = await window.docusnap.ocrRegionBoxes?.(b64);
      const raw  = ((res && res.text) || (await window.docusnap.ocrRegion(b64)) || '').trim();
      const label = sanitizeAnchorLabel(raw) || raw;
      // Value centre (normalised) from the value box; anchor box top-left (normalised).
      const xNorm = (rect.x + rect.w / 2) / imgW, yNorm = (rect.y + rect.h / 2) / imgH;
      const off = labelOffsetFromBox([0, 0], aRect.x, aRect.y, xNorm, yNorm, imgW, imgH);
      // Direction: the anchor sits ABOVE the value (label-above) when the vertical gap
      // dominates the horizontal one; otherwise it's to the LEFT (label-left).
      const dcx = (rect.x + rect.w / 2) - (aRect.x + aRect.w / 2);
      const dcy = (rect.y + rect.h / 2) - (aRect.y + aRect.h / 2);
      const direction = (dcy > 0 && Math.abs(dcy) > Math.abs(dcx)) ? 'below' : 'right';
      const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
      const liveSupplier  = supplierInput?.value?.trim() || currentDoc?.supplier_name;
      pendingAnchors[fieldKey] = {
        supplier_name: cleanSupplierName(liveSupplier),
        document_type: currentDoc?.type_slug || currentDoc?.document_type_slug || null,
        field_key: fieldKey,
        page_zone: yNorm < 0.33 ? 'top' : yNorm < 0.66 ? 'middle' : 'bottom',
        x_norm: xNorm, y_norm: yNorm, w_norm: rect.w / imgW, h_norm: rect.h / imgH,
        authoritative: true,
        anchor_label: label || (labelFor(fieldKey) || fieldKey.replace(/_/g, ' ')),
        direction, ...off,
        label_detected: !!label,   // a hand-drawn, OCR'd caption is a real page label
      };
      anchorTaughtFields.add(fieldKey);
      // Overlay the drawn anchor box + show the readout with the caption for review/edit.
      showAnchorReadout({
        anchor_label: pendingAnchors[fieldKey].anchor_label, direction, fallback: false,
        normBox: [aRect.x / imgW, aRect.y / imgH, aRect.w / imgW, aRect.h / imgH],
      }, c.value);
    }
  } catch (err) {
    console.warn('Manual anchor draw failed:', err);
  } finally {
    ocrOverlay.classList.remove('visible');
  }
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
async function confirmCurrentDoc({ bulk = false, expectId = null } = {}) {
  if (!currentDoc) return { error: 'No document selected.' };
  // Bulk-race guard: the caller (File All Ready) captures the doc it intends to
  // file; if a delete / row-click reassigned the module-global `currentDoc` in an
  // await gap, bail instead of filing the WRONG document (QA audit #5).
  if (expectId != null && currentDoc.id !== expectId) return { skipped: true, reason: 'selection changed' };

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

  // Empty Document Issuer (supplier/customer identity): files under "Unknown Company"
  // and can't learn this sender. Warn-and-allow — a deliberate confirm in single mode;
  // in bulk it's "not cleanly ready", so the doc is left in the queue for review.
  {
    const issuerKey = ['supplier_name', 'customer_name'].find(k => k in allValues);
    if (issuerKey && !(allValues[issuerKey] || '').trim()) {
      if (bulk) return { skipped: true, reason: 'issuer blank' };
      if (!confirm('Document Issuer is blank.\n\nThis document will be filed under "Unknown Company" and '
                 + 'the app won’t learn this sender. File it anyway?')) {
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
    // RE-FILE intent: only a doc opened while ALREADY confirmed ("Edit in Review" on a filed /
    // auto-filed doc) may re-file. A doc opened from the review queue (needs_review/deferred) must
    // NOT — so if another reviewer filed it first, this confirm loses cleanly (ALREADY_FILED)
    // rather than silently overwriting them. See reviewService.confirm.
    allowRefile:        currentDoc?.status === 'confirmed',
    // In bulk the fields-only path never loaded the preview image, so there is
    // no img.src file handle to wait on — let the backend skip its 150ms release.
    bulk,
  });

  if (!result?.success) {
    if (!bulk && pageImages?.length) {
      docImgWrap.style.display = '';
      docImg.src = pageImages[currentPage];
    }
    // Pass the backend code through so bulk filing can tell a license lapse
    // (abort the whole run once) from an ordinary per-doc failure (skip + continue).
    return { error: result?.error || 'Confirm failed. Check settings.', code: result?.code || null };
  }

  // Persist anchors taught with ⊕ this cycle — DEFERRED to commit so an un-confirmed
  // teach (skip/defer/doc-change) leaves no learned trace. Re-key to the supplier the
  // user actually confirmed (the live field may have been edited after the draw);
  // saveAnchor's authoritative branch makes each the single anchor for its
  // (field, doc-type), sweeping stale ones. Best-effort per field — a save failure is
  // surfaced but does not un-file the already-filed document.
  const taughtKeys = Object.keys(pendingAnchors);
  if (taughtKeys.length) {
    const taughtSupplier = cleanSupplierName(allValues.supplier_name || currentDoc?.supplier_name);
    for (const fk of taughtKeys) {
      try {
        await window.docusnap.saveFieldAnchor({ ...pendingAnchors[fk], supplier_name: taughtSupplier });
      } catch (err) {
        console.error(`Anchor save failed for "${fk}":`, err);
        if (!bulk) {
          const msg = /FORBIDDEN|permission/i.test(err?.message || '')
            ? 'Document filed, but saving the taught anchor needs an admin account.'
            : 'Document filed, but a taught anchor could not be saved (see console).';
          try { showToast(msg, 'err'); } catch {}
        }
      }
    }
    pendingAnchors = {};
  }

  // Flush staged FIELD CLEANUP RULES (right-click menu) — same commit-on-confirm
  // model as anchors, re-keyed to the confirmed supplier. Best-effort per rule.
  const ruleKeys = Object.keys(pendingFieldRules);
  if (ruleKeys.length) {
    const ruleSupplier = cleanSupplierName(allValues.supplier_name || currentDoc?.supplier_name);
    for (const fk of ruleKeys) {
      for (const rule of (pendingFieldRules[fk] || [])) {
        try {
          await window.docusnap.saveFieldRule({ ...rule, supplier_name: ruleSupplier });
        } catch (err) {
          console.error(`Field rule save failed for "${fk}":`, err);
          if (!bulk) { try { showToast('Document filed, but a field cleanup rule could not be saved.', 'err'); } catch {} }
        }
      }
    }
    pendingFieldRules = {};
    _loadSavedFieldRules();   // refresh the cache so the menu reflects the just-saved rule
  }

  queue         = queue.filter(d => d.id !== currentDoc.id);
  deferredQueue = deferredQueue.filter(d => d.id !== currentDoc.id);
  return { filed: true };
}

document.getElementById('btn-confirm').addEventListener('click', async () => {
  // Remember where the doc sits BEFORE confirmCurrentDoc removes it from the list,
  // so we can advance to the NEXT doc (the one that shifts into this slot) rather
  // than snapping back to the top — the operator has already worked down the list.
  const list = activeTab === 'deferred' ? deferredQueue : queue;
  const idx  = list.findIndex(d => d.id === currentDoc?.id);
  const r = await confirmCurrentDoc();
  if (r.cancelled) return;
  if (r.error) { showToast(r.error, 'err'); return; }
  updateTabCounts();
  advanceAfterAction(idx);
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
let _bulkFileStopped = false;   // cooperative-stop flag for File All Ready

async function fileAllReady() {
  if (activeTab !== 'review') return;                 // only the review queue
  const btn = document.getElementById('btn-file-all-review');
  if (!btn || btn.disabled) return;
  if (bulkFiling) return;                             // a run is already in progress
  const docs = [...queue];                            // snapshot before it mutates
  if (docs.length === 0) return;
  if (!confirm(
        `File all ready documents in the Review queue?\n\n` +
        `Every document with its type and required fields filled in will be filed, ` +
        `exactly as if you confirmed it one by one. Documents still missing required ` +
        `details are left in the queue for you to review.`)) return;

  const confirmBtn = document.getElementById('btn-confirm');
  const banner   = document.getElementById('bulk-file-progress');
  const barFill  = banner.querySelector('.bfp-bar-fill');
  const countEl  = banner.querySelector('.bfp-count');
  const fileEl   = banner.querySelector('.bfp-file');
  const stopBtn  = document.getElementById('btn-stop-file-all');
  // These act on currentDoc, which the loop reassigns rapidly — disable for the run.
  // btn-delete (single Delete) is included: without it a mid-run delete reassigns
  // currentDoc in an await gap and could file the wrong doc (QA audit #5). Per-row ×
  // and queue-row clicks are separately gated on `bulkFiling`.
  const lockBtns = ['btn-file-all-review', 'btn-skip', 'btn-defer', 'btn-delete-all-review', 'btn-delete']
    .map(id => document.getElementById(id)).filter(Boolean);

  // Release any preview image handle held from a doc the user was viewing — ONCE,
  // up front (the per-doc backend 150ms release-wait is skipped in bulk, and the
  // fields-only path never opens a new one).
  try { docImg.src = ''; docImgWrap.style.display = 'none'; } catch {}
  await new Promise(r => setTimeout(r, 150));

  bulkFiling       = true;   // hold off auto-refresh; each confirm broadcasts review-count-changed back to this window
  _bulkFileStopped = false;
  lockBtns.forEach(b => b.disabled = true);
  stopBtn.disabled  = false;
  stopBtn.innerHTML = '&#9632; Stop';
  banner.classList.remove('done');
  banner.classList.add('show');
  barFill.style.width = '0';

  let filed = 0, skipped = 0, noType = 0, aborted = false;

  try {
    for (let i = 0; i < docs.length; i++) {
      if (_bulkFileStopped) break;                     // cooperative: in-flight doc already finished
      const doc = docs[i];
      countEl.textContent = `Filing ${i + 1} of ${docs.length}` + (skipped ? ` · ${skipped} skipped` : '');
      fileEl.textContent  = doc.original_filename || '';
      barFill.style.width = `${Math.round(((i + 1) / docs.length) * 100)}%`;
      // Yield to the browser between docs so the window stays responsive (paints the
      // progress, handles Stop/input) over a big batch instead of showing "Not Responding".
      await new Promise(r => setTimeout(r, 0));

      if (!queue.some(d => d.id === doc.id)) continue; // already handled elsewhere
      // Flagged docs (validation note / correction candidate / below-threshold
      // field) are excluded from bulk filing until a human clicks Mark Reviewed.
      if (isFlagged(doc) && !doc.review_acknowledged_at) { skipped++; continue; }

      try {
        await selectDoc(doc, { fieldsOnly: true });    // loads fields (no preview render); runs validateConfirm()
        if (confirmBtn.disabled) {                     // not ready — leave for review
          skipped++;
          if (!doc.type_slug) noType++;                // dominant reason: no document type detected
          continue;
        }
        const r = await confirmCurrentDoc({ bulk: true, expectId: doc.id });
        if (r.filed) {
          filed++;
          // Drop the row the moment it's filed, so the queue shrinks live.
          document.querySelector(`.queue-item[data-id="${doc.id}"]`)?.remove();
        } else if (r.code === 'license_required') {
          aborted = true; break;                       // license lapsed mid-run — stop once, don't spam failures
        } else {
          skipped++;                                   // ordinary per-doc failure — leave it queued
        }
      } catch (err) {
        // A locked doc (open approval route) throws from requireUnlocked — SKIP it,
        // never let one locked doc abort the whole run. A permission lapse (role
        // changed) aborts the run once.
        if (/FORBIDDEN|permission/i.test(err?.message || '')) { aborted = true; break; }
        console.warn(`[File All] ${doc.original_filename}:`, err?.message || err);
        skipped++;
      }
    }
  } finally {
    bulkFiling = false;   // re-enable auto-refresh before the post-run refresh below
    lockBtns.forEach(b => b.disabled = false);
  }

  updateTabCounts();
  renderQueueList();
  if (queue.length > 0) selectDoc(queue[0]);
  else { currentDoc = null; clearDocPanel(); }
  if (filed) window.docusnap.notifyReviewComplete();

  // Banner done-state, then auto-dismiss. Already-filed docs stay filed.
  const stoppedNote = _bulkFileStopped ? ' (stopped)' : '';
  // Spell out the dominant skip reason — a doc with no detected type can't be filed
  // (filing needs a type for the folder path). Tells the operator what to do next.
  const noTypeNote = noType ? ` (${noType} have no document type — reprocess to detect it, or set a type)` : '';
  const skipNote   = skipped ? ` · ${skipped} left for review${noTypeNote}` : '';
  banner.classList.add('done');
  stopBtn.disabled    = true;
  fileEl.textContent  = '';
  countEl.textContent = aborted
    ? `Stopped — a valid license is required. Filed ${filed} first.`
    : `Filed ${filed}` + skipNote + stoppedNote;
  setTimeout(() => banner.classList.remove('show', 'done'), (aborted || noType) ? 7000 : 3500);

  showToast(
    aborted
      ? `Filing stopped — a valid license is required. Filed ${filed} document${filed === 1 ? '' : 's'}.`
      : `Filed ${filed} document${filed === 1 ? '' : 's'}` + skipNote + stoppedNote,
    (aborted || !filed) ? 'warn' : 'ok');
}
document.getElementById('btn-file-all-review')?.addEventListener('click', fileAllReady);

// After Reprocess All, auto-commit any document that came back at 100% confidence (all
// required fields present + high confidence, never a flagged doc) — the SAME setting + gate
// as the import-batch auto-file, reusing the bulk confirm path. Best-effort per doc (a
// failure just leaves it queued). Skips entirely when the setting is off or a manual
// File-All is already running.
async function autoCommitFullConfidence() {
  try {
    if (bulkFiling) return;
    if ((await window.docusnap.getSetting('auto_file_full_confidence')) === 'false') return;
    // Configurable threshold (default 100). The type + un-flagged (!review_flag_count) gates
    // are the safety: only a fully-typed doc with NO field flagged for review auto-files.
    const thr = parseInt((await window.docusnap.getSetting('auto_file_threshold')) || '100', 10) || 100;
    const ready = (queue || []).filter(d => (d.overall_confidence || 0) >= thr && d.type_slug && !d.review_flag_count);
    if (!ready.length) return;
    bulkFiling = true;
    let filed = 0;
    try {
      for (const doc of ready) {
        if (!queue.some(d => d.id === doc.id)) continue;
        try {
          await selectDoc(doc, { fieldsOnly: true });
          if (document.getElementById('btn-confirm').disabled) continue;   // not actually ready
          const r = await confirmCurrentDoc({ bulk: true, expectId: doc.id });
          if (r && r.filed) { filed++; document.querySelector(`.queue-item[data-id="${doc.id}"]`)?.remove(); }
        } catch { /* leave it for manual review */ }
        await new Promise(res => setTimeout(res, 0));   // keep the window responsive
      }
    } finally { bulkFiling = false; }
    if (filed > 0) {
      queue         = await window.docusnap.getReviewQueue();
      deferredQueue = await window.docusnap.getDeferredQueue();
      updateTabCounts();
      renderQueueList();
      showToast(`Auto-filed ${filed} document${filed > 1 ? 's' : ''} that scored 100% — no review needed.`, 'ok');
    }
  } catch (e) { console.warn('auto-commit 100% failed:', e.message); }
}

// Cooperative Stop: the in-flight document finishes filing, no new one starts,
// everything already filed stays filed (this is not an undo). Mirrors Reprocess-All.
document.getElementById('btn-stop-file-all')?.addEventListener('click', () => {
  if (!bulkFiling) return;
  _bulkFileStopped = true;
  const s = document.getElementById('btn-stop-file-all');
  s.disabled  = true;
  s.innerHTML = 'Stopping…';
});

// ── Document cycling (prev/next rail beside the queue) ────────────────────────
// The up/down rail moves the SELECTED document one step earlier/later within the
// ACTIVE list (Review queue or the Deferred tab), reusing selectDoc — the exact
// same selection path clicking a list item uses. It clamps at the ends (no wrap)
// so navigation is predictable, and keeps the chosen item scrolled into view.
// Native list scrolling (wheel / scrollbar) is unaffected.
function cycleDocument(direction) {
  const list = activeTab === 'deferred' ? deferredQueue : reviewDisplayOrder();
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
  const list = activeTab === 'deferred' ? deferredQueue : reviewDisplayOrder();
  const idx  = currentDoc ? list.findIndex(d => d.id === currentDoc.id) : -1;
  prev.disabled = idx <= 0;
  next.disabled = idx === -1 || idx >= list.length - 1;
}

document.getElementById('btn-doc-prev')?.addEventListener('click', () => cycleDocument(-1));
document.getElementById('btn-doc-next')?.addEventListener('click', () => cycleDocument(1));

// Sender-grouping toggle (grouped ⇄ newest-first); persists the choice per-window.
document.getElementById('btn-group-toggle')?.addEventListener('click', () => {
  queueGrouped = !queueGrouped;
  localStorage.setItem('review_queue_grouped', String(queueGrouped));
  renderQueueList();
  updateDocNavButtons();   // the active doc's position changed in the new order
});

// Expandable file column — drag the splitter to widen/narrow the queue panel.
// Width persists in localStorage so a chosen width survives reopening. Clamped so
// the panel can't be dragged uselessly small or eat the whole window.
(function initQueueResizer() {
  const panel = document.getElementById('queue-panel');
  const grip  = document.getElementById('queue-resizer');
  if (!panel || !grip) return;
  const MIN = 170, MAX = 560;
  const saved = parseInt(localStorage.getItem('review_queue_width'), 10);
  if (saved >= MIN && saved <= MAX) panel.style.width = saved + 'px';
  let dragging = false;
  grip.addEventListener('mousedown', (e) => {
    dragging = true; e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let w = e.clientX - panel.getBoundingClientRect().left;
    w = Math.max(MIN, Math.min(MAX, w));
    panel.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('review_queue_width', String(parseInt(panel.style.width, 10) || 220));
  });
})();

// Ctrl+Enter (Cmd+Enter on Mac) commits the current document — the same as clicking
// Confirm. Using a modifier (not plain Enter) means it works from ANY field, including
// multi-line ones and dropdowns, without clashing with Enter's normal in-field behaviour;
// the value is applied first via blur. Ignored while a modal/dialog is open, and only fires
// when Confirm is actually enabled and visible, so it never files an incomplete doc.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.repeat || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  // A modal/dialog is actually OPEN — count only DISPLAYED help-mode-opt-out elements, not the
  // static, permanently-present learning-history overlay (which carries data-help-ignore while
  // hidden). A bare querySelector matched that hidden overlay and silently broke Ctrl+Enter.
  if ([...document.querySelectorAll('[data-help-ignore]')].some(el => getComputedStyle(el).display !== 'none')) return;
  const btn = document.getElementById('btn-confirm');
  if (!btn || btn.disabled || btn.offsetParent === null) return;   // not ready / not visible
  e.preventDefault();
  const t = e.target;
  if (t && typeof t.blur === 'function') t.blur();            // apply any in-progress field edit
  btn.click();
});

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

  let res;
  try { res = await window.docusnap.deleteAllReview(); }
  catch (e) { showToast(`Delete failed: ${e?.message || e}`, 'err'); return; }
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

  let res;
  try { res = await window.docusnap.deleteAllDeferred(); }
  catch (e) { showToast(`Delete failed: ${e?.message || e}`, 'err'); return; }
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
// After filing/removing the current doc, advance to the NEXT one in the list.
// `removedIdx` is the just-removed doc's old position; because the list has
// already shifted up, the element now AT that index is the next doc (clamped to
// the last entry if we filed the bottom one). Defaults to 0 (top) when unknown.
function advanceAfterAction(removedIdx = 0) {
  const at = Math.max(0, removedIdx);
  if (activeTab === 'deferred') {
    renderDeferredList();
    if (deferredQueue.length > 0) selectDoc(deferredQueue[Math.min(at, deferredQueue.length - 1)]);
    else { currentDoc = null; clearDocPanel(); }
  } else {
    renderQueueList();
    if (queue.length > 0) selectDoc(queue[Math.min(at, queue.length - 1)]);
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
  const advBar = document.getElementById('advanced-bar');
  const advBtn = document.getElementById('btn-advanced');
  if (advBar && advBar.style.display === 'block' &&
      !advBar.contains(e.target) && !advBtn.contains(e.target)) {
    advBar.style.display = 'none';
  }
});

// ── Advanced → View learning history ──────────────────────────────────────────
// Track the field the operator last clicked into. The modal is NON-blocking (no backdrop),
// so while it's open the right fields pane stays lit and clickable — clicking a field
// live-reloads the table for THAT field.
let lastFocusedFieldKey = null;
document.getElementById('fields-scroll')?.addEventListener('focusin', (e) => {
  const inp = e.target.closest?.('.field-input');
  if (inp && inp.dataset.key) {
    lastFocusedFieldKey = inp.dataset.key;
    if (isLhOpen()) loadLearningHistoryFor(inp.dataset.key);
  }
});

document.getElementById('btn-advanced').addEventListener('click', () => {
  const bar = document.getElementById('advanced-bar');
  bar.style.display = (bar.style.display === 'block') ? 'none' : 'block';
});

let _lhData = [];                          // unsorted rows from the backend
let _lhRendered = [];                       // current sorted view (row buttons key off the index)
let _lhSort = { key: 'count', dir: -1 };    // default: most-seen first
let _lhField = null;                        // { key, label, supplier, slug }
let _lhPending = null;                       // value awaiting inline delete-confirm
let _lhEditing = null;                       // value currently being inline-edited
let _lhProposals = [];                       // pending "fix likely slips" proposals
let _lhExpanded = new Set();                  // values whose source-doc submenu is open
let _lhDocs = {};                             // value -> source docs (lazy) | 'loading'

const isLhOpen = () => document.getElementById('lh-overlay').style.display === 'block';

function highlightActiveField(key) {
  document.querySelectorAll('.field-row-label.lh-active-field').forEach(el => el.classList.remove('lh-active-field'));
  if (isLhOpen()) document.querySelector(`.field-row-label[data-key="${key}"]`)?.classList.add('lh-active-field');
}

// Make the (non-blocking) learning-history modal DRAGGABLE by its header, so it can be moved
// off whatever field/preview the operator wants to see. Idempotent (wired once).
function makeLhDraggable() {
  const modal = document.querySelector('#lh-overlay .lh-modal');
  const head  = document.querySelector('#lh-overlay .lh-head');
  if (!modal || !head || head._lhDragWired) return;
  head._lhDragWired = true;
  head.style.cursor = 'move';
  let dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;            // ignore the close (×) button
    const r = modal.getBoundingClientRect();
    modal.style.transform = 'none';                    // drop the CSS vertical-centring
    modal.style.left = r.left + 'px'; modal.style.top = r.top + 'px';
    startLeft = r.left; startTop = r.top; sx = e.clientX; sy = e.clientY; dragging = true;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const nl = Math.max(0, Math.min(window.innerWidth  - 80, startLeft + (e.clientX - sx)));
    const nt = Math.max(0, Math.min(window.innerHeight - 40, startTop  + (e.clientY - sy)));
    modal.style.left = nl + 'px'; modal.style.top = nt + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

document.getElementById('btn-view-learning').addEventListener('click', async () => {
  document.getElementById('advanced-bar').style.display = 'none';
  document.getElementById('lh-overlay').style.display = 'block';
  makeLhDraggable();
  // Open regardless of focus. With a field already selected, load it; otherwise show an empty
  // prompt — the modal is non-blocking, so clicking a field then populates it live.
  if (lastFocusedFieldKey) await loadLearningHistoryFor(lastFocusedFieldKey);
  else showLearningHistoryEmpty();
});

function showLearningHistoryEmpty() {
  _lhField = null; _lhData = []; _lhRendered = [];
  _lhPending = null; _lhEditing = null; _lhProposals = [];
  document.getElementById('lh-field').textContent = '(no field selected)';
  document.getElementById('lh-scope').textContent = 'Click a field on the right to see and tidy its learned values.';
  document.getElementById('lh-proposals').style.display = 'none';
  document.getElementById('lh-body').innerHTML =
    `<tr><td colspan="4" class="lh-empty">👉 Click a field on the right to load its learned values.</td></tr>`;
  document.querySelectorAll('.field-row-label.lh-active-field').forEach(el => el.classList.remove('lh-active-field'));
}

async function loadLearningHistoryFor(key) {
  if (!key) return;
  const label    = (typeof labelFor === 'function') ? labelFor(key) : key.replace(/_/g, ' ');
  const slug     = selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null;
  const supplier = document.querySelector('.field-input[data-key="supplier_name"]')?.value?.trim()
                   || currentDoc?.supplier_name || '';
  _lhField   = { key, label, supplier, slug };
  _lhPending = null; _lhEditing = null; _lhProposals = [];
  _lhExpanded = new Set(); _lhDocs = {};   // drop any prior field's source-doc submenus
  _lhSort    = { key: 'count', dir: -1 };
  document.getElementById('lh-field').textContent = label;
  document.getElementById('lh-scope').textContent =
    `Sender: ${supplier || 'any'} · Type: ${slug ? String(slug).replace(/_/g, ' ') : 'this document type'}`;
  document.getElementById('lh-proposals').style.display = 'none';
  try {
    _lhData = await window.docusnap.getFieldValueHistory(
      { supplier_name: supplier, document_type: slug, field_key: key }) || [];
  } catch { _lhData = []; }
  renderLearningHistory();
  highlightActiveField(key);
}

// The source-doc submenu for one learned value (lazy-loaded into _lhDocs).
function renderLhDocs(value) {
  const docs = _lhDocs[value];
  if (docs === 'loading') return `<div class="lh-docs-list lh-docs-empty">Loading documents…</div>`;
  if (!Array.isArray(docs)) return '';
  if (!docs.length) return `<div class="lh-docs-list lh-docs-empty">No filed documents carry this exact value.</div>`;
  return `<div class="lh-docs-list">` + docs.map(d => {
    const when = d.confirmed_at ? escHtml(String(d.confirmed_at).slice(0, 10)) : '';
    const name = escHtml(d.original_filename || ('#' + d.id));
    return `<div class="lh-doc"><span class="lh-doc-name" title="${name}">${name}</span>`
      + `<span class="lh-doc-when">${when}</span>`
      + `<button class="lh-open-doc" data-docid="${d.id}" title="Open this document in Review to re-check it">Open in Review</button></div>`;
  }).join('') + `</div>`;
}

function renderLearningHistory() {
  _lhRendered = [..._lhData].sort((a, b) => {
    const k = _lhSort.key;
    if (k === 'count') return ((a.count || 0) - (b.count || 0)) * _lhSort.dir;
    const av = String(a[k] || '').toLowerCase(), bv = String(b[k] || '').toLowerCase();
    return (av < bv ? -1 : av > bv ? 1 : 0) * _lhSort.dir;
  });
  const body = document.getElementById('lh-body');
  body.innerHTML = _lhRendered.length ? _lhRendered.map((r, i) => {
    const last = r.last_seen ? escHtml(String(r.last_seen).slice(0, 10)) : '—';
    let valueCell, actionCell;
    if (_lhEditing === r.value) {
      valueCell  = `<input class="lh-edit-input" id="lh-edit-input" data-idx="${i}">`;
      actionCell = `<button class="lh-save" data-idx="${i}" title="Save">✓</button><button class="lh-ecancel" title="Cancel">✗</button>`;
    } else {
      valueCell = `<span class="lh-val">${escHtml(r.value)}</span>`;
      const on = _lhExpanded.has(r.value) ? ' lh-docs-on' : '';
      actionCell = (_lhPending === r.value)
        ? `<span class="lh-confirm">Delete?<button class="lh-yes" data-idx="${i}">Yes</button><button class="lh-no">No</button></span>`
        : `<button class="lh-docs${on}" data-idx="${i}" title="Show the documents that have this value">&#128196;</button>`
          + `<button class="lh-edit" data-idx="${i}" title="Fix this value">&#9998;</button>`
          + `<button class="lh-del" data-idx="${i}" title="Delete this value from learning">🗑</button>`;
    }
    let row = `<tr><td>${valueCell}</td><td>${r.count}</td><td>${last}</td><td style="text-align:right; white-space:nowrap;">${actionCell}</td></tr>`;
    if (_lhExpanded.has(r.value) && _lhEditing !== r.value) {
      row += `<tr class="lh-docs-row"><td colspan="4">${renderLhDocs(r.value)}</td></tr>`;
    }
    return row;
  }).join('') : `<tr><td colspan="4" class="lh-empty">No learned values yet for this field.</td></tr>`;
  document.querySelectorAll('.lh-table th[data-sort]').forEach(th => {
    const base = th.dataset.sort === 'value' ? 'Value' : th.dataset.sort === 'count' ? 'Times seen' : 'Last seen';
    th.textContent = base + (th.dataset.sort === _lhSort.key ? (_lhSort.dir > 0 ? ' ▲' : ' ▼') : '');
  });
  if (_lhEditing !== null) {
    const inp = document.getElementById('lh-edit-input');
    if (inp) {
      inp.value = _lhEditing; inp.focus(); inp.select();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitLhEdit(inp); }
        else if (e.key === 'Escape') { e.preventDefault(); _lhEditing = null; renderLearningHistory(); }
      });
    }
  }
}

// Rename a learned value (oldVal → newVal) via the backend, then reflect it locally
// (merge counts if the new value already exists, else rename in place).
async function applyLhRename(oldVal, newVal) {
  if (!newVal || newVal === oldVal) return;
  try {
    await window.docusnap.renameFieldValue(
      { supplier_name: _lhField.supplier, document_type: _lhField.slug, field_key: _lhField.key, oldValue: oldVal, newValue: newVal });
    const old      = _lhData.find(x => x.value === oldVal);
    const existing  = _lhData.find(x => x.value === newVal);
    if (old && existing) { existing.count += old.count; _lhData = _lhData.filter(x => x.value !== oldVal); }
    else if (old)        { old.value = newVal; }
  } catch (e) { console.warn('rename-field-value failed:', e); }
}

async function commitLhEdit(inp) {
  const oldVal = _lhEditing, newVal = inp.value.trim();
  _lhEditing = null;
  await applyLhRename(oldVal, newVal);
  renderLearningHistory();
}

// "Fix likely slips": find values that differ from a strong per-position column consensus at
// exactly ONE character, where that character is a likely OCR slip (a symbol where alnum is
// expected, or a known confusion like $↔S / 0↔O / 1↔I) and the corrected value matches the
// column's dominant shape or an existing value. Pure/data-driven — proposes, never auto-applies.
const _OCR_PAIRS = new Set(['$S','5S','S5','0O','O0','0Q','Q0','1I','I1','1L','L1','8B','B8','6G','G6','2Z','Z2','7/','/7','€E','£E']);
const _shapeSig = (s) => s.replace(/[0-9]/g, '#').replace(/[A-Za-z]/g, '@');
function _likelySlip(from, to) {
  if (!/[A-Za-z0-9]/.test(from)) return true;                 // a symbol where alnum is expected
  return _OCR_PAIRS.has((from + to).toUpperCase());
}
function computeSlipFixes() {
  const values = _lhData.map(r => r.value).filter(v => typeof v === 'string' && v.length);
  if (values.length < 4) return [];                            // need a real column to vote
  const shapeCount = {};
  values.forEach(v => { const s = _shapeSig(v); shapeCount[s] = (shapeCount[s] || 0) + 1; });
  const domShape = Object.entries(shapeCount).sort((a, b) => b[1] - a[1])[0][0];
  const valueSet = new Set(values);
  const out = [];
  for (const v of values) {
    const diffs = [];
    for (let i = 0; i < v.length; i++) {
      const tally = {}; let total = 0;
      for (const w of values) {
        if (w === v || w.length <= i) continue;
        tally[w[i]] = (tally[w[i]] || 0) + 1; total++;
      }
      if (total < 3) continue;
      const [domChar, domN] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (domN / total >= 0.8 && v[i] !== domChar && _likelySlip(v[i], domChar)) diffs.push({ i, to: domChar });
    }
    if (diffs.length === 1) {
      const d = diffs[0], fixed = v.slice(0, d.i) + d.to + v.slice(d.i + 1);
      if (fixed !== v && (_shapeSig(fixed) === domShape || valueSet.has(fixed))) out.push({ from: v, to: fixed });
    }
  }
  return out;
}

document.querySelectorAll('.lh-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  if (_lhSort.key === k) _lhSort.dir *= -1; else _lhSort = { key: k, dir: k === 'value' ? 1 : -1 };
  _lhPending = null; _lhEditing = null;
  renderLearningHistory();
}));

document.getElementById('lh-body').addEventListener('click', async (e) => {
  // Toggle the source-doc submenu for a learned value (lazy-load on first open).
  const docsBtn = e.target.closest('.lh-docs');
  if (docsBtn) {
    const val = _lhRendered[+docsBtn.dataset.idx]?.value;
    if (val == null) return;
    if (_lhExpanded.has(val)) { _lhExpanded.delete(val); renderLearningHistory(); return; }
    _lhExpanded.add(val);
    if (!(val in _lhDocs)) {
      _lhDocs[val] = 'loading'; renderLearningHistory();
      try {
        _lhDocs[val] = await window.docusnap.getDocumentsForFieldValue(
          { supplier_name: _lhField.supplier, document_type: _lhField.slug, field_key: _lhField.key, value: val }) || [];
      } catch (err) { console.warn('get-documents-for-field-value failed:', err); _lhDocs[val] = []; }
    }
    renderLearningHistory();
    return;
  }
  // Open a source document in Review (Edit-in-place; stays Filed) for re-checking.
  const openBtn = e.target.closest('.lh-open-doc');
  if (openBtn) {
    const docId = parseInt(openBtn.dataset.docid, 10);
    if (docId) { closeLearningHistory(); _navigateToDoc(docId); }
    return;
  }
  const edit = e.target.closest('.lh-edit');
  if (edit) { _lhEditing = _lhRendered[+edit.dataset.idx]?.value ?? null; _lhPending = null; renderLearningHistory(); return; }
  if (e.target.closest('.lh-ecancel')) { _lhEditing = null; renderLearningHistory(); return; }
  const save = e.target.closest('.lh-save');
  if (save) { const inp = document.getElementById('lh-edit-input'); if (inp) await commitLhEdit(inp); return; }
  const del = e.target.closest('.lh-del');
  if (del) { _lhPending = _lhRendered[+del.dataset.idx]?.value ?? null; renderLearningHistory(); return; }
  if (e.target.closest('.lh-no')) { _lhPending = null; renderLearningHistory(); return; }
  const yes = e.target.closest('.lh-yes');
  if (yes) {
    const val = _lhRendered[+yes.dataset.idx]?.value;
    if (val == null) return;
    yes.disabled = true;
    try {
      await window.docusnap.purgeFieldValue(
        { supplier_name: _lhField.supplier, document_type: _lhField.slug, field_key: _lhField.key, value: val });
      _lhData = _lhData.filter(x => x.value !== val);
    } catch (err) { console.warn('purge-field-value failed:', err); }
    _lhPending = null;
    renderLearningHistory();
  }
});

document.getElementById('lh-fix').addEventListener('click', () => {
  const banner = document.getElementById('lh-proposals');
  _lhProposals = computeSlipFixes();
  banner.style.display = 'block';
  if (!_lhProposals.length) {
    banner.innerHTML = 'No likely single-character slips found in this column.';
    setTimeout(() => { if (banner.innerHTML.startsWith('No likely')) banner.style.display = 'none'; }, 3500);
    return;
  }
  const shown = _lhProposals.slice(0, 6).map(p => `<b>${escHtml(p.from)} → ${escHtml(p.to)}</b>`).join(', ');
  banner.innerHTML = `Fix ${_lhProposals.length} likely slip${_lhProposals.length > 1 ? 's' : ''}: ${shown}`
    + (_lhProposals.length > 6 ? `, +${_lhProposals.length - 6} more` : '')
    + `<button class="lh-fix lh-apply" id="lh-apply-fixes">Apply</button>`
    + `<button class="lh-cancel" id="lh-cancel-fixes">Cancel</button>`;
});

document.getElementById('lh-proposals').addEventListener('click', async (e) => {
  if (e.target.id === 'lh-cancel-fixes') {
    _lhProposals = []; document.getElementById('lh-proposals').style.display = 'none'; return;
  }
  if (e.target.id === 'lh-apply-fixes') {
    e.target.disabled = true;
    for (const p of _lhProposals) await applyLhRename(p.from, p.to);
    _lhProposals = [];
    document.getElementById('lh-proposals').style.display = 'none';
    renderLearningHistory();
  }
});

function closeLearningHistory() {
  document.getElementById('lh-overlay').style.display = 'none';
  _lhPending = null; _lhEditing = null; _lhProposals = [];
  document.getElementById('lh-proposals').style.display = 'none';
  document.querySelectorAll('.field-row-label.lh-active-field').forEach(el => el.classList.remove('lh-active-field'));
}
document.getElementById('lh-close').addEventListener('click', closeLearningHistory);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isLhOpen()) closeLearningHistory(); });

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

// Does the OPEN document carry un-committed review work that a reprocess would
// silently discard (hand-typed corrections, a manual type override, or a staged ⊕
// teach / field rule)? Used to warn before reprocessing (QA audit #3).
function hasPendingReviewEdits() {
  if (corrections && Object.keys(corrections).length) return true;
  if (typeof pendingAnchors === 'object' && pendingAnchors && Object.keys(pendingAnchors).length) return true;
  if (typeof pendingFieldRules === 'object' && pendingFieldRules && Object.keys(pendingFieldRules).length) return true;
  const detected = currentDoc && currentDoc.type_slug;
  if (selectedTypeSlug && detected && selectedTypeSlug !== detected) return true;   // manual type override
  return false;
}
const REPROCESS_DISCARD_WARNING =
  'Reprocessing re-reads this document with the latest learned data and REPLACES the '
  + 'fields on screen — your unsaved edits and type choice for this document will be lost.\n\nContinue?';

document.getElementById('btn-reprocess').addEventListener('click', async (e) => {
  if (!currentDoc) return;
  // Warn only on a genuine user click (programmatic .click() re-extracts are trusted).
  if (e?.isTrusted && hasPendingReviewEdits() && !confirm(REPROCESS_DISCARD_WARNING)) return;
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
      pendingAnchors = {};   // ...and any un-committed ⊕ teach (coords now stale)
      pendingFieldRules = {};
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
    // Surface WHY (e.g. "A reprocess is already running") instead of a silent red flash.
    if (result && result.error) showToast(result.error, result.busy ? 'warn' : 'err');
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
  // Batched Reprocess All runs in server-side Python workers, so cooperative
  // flag-flipping can't halt it — kill the worker pool (same path folder-import Stop
  // uses). The in-flight reprocessBatch promise then resolves and the finally runs.
  try { window.docusnap.stopProcessing(); } catch {}
  const btnStop = document.getElementById('btn-stop-reprocess');
  btnStop.disabled = true;
  btnStop.innerHTML = 'Stopping…';
});

document.getElementById('btn-reprocess-all').addEventListener('click', async () => {
  if (queue.length === 0) { showToast('No documents in queue', 'warn'); return; }
  if (_batchActive) return;
  // The open document's unsaved edits/type choice are re-rendered away too (QA audit #3).
  if (hasPendingReviewEdits() && !confirm(REPROCESS_DISCARD_WARNING)) return;

  const btnAll  = document.getElementById('btn-reprocess-all');
  const btnOne  = document.getElementById('btn-reprocess');
  const btnStop = document.getElementById('btn-stop-reprocess');
  const banner  = document.getElementById('reprocess-progress');

  _batchActive  = true;
  _batchStopped = false;
  btnAll.disabled      = true;
  btnOne.disabled      = true;
  btnStop.disabled     = false;
  btnStop.innerHTML    = '&#9632; Stop';
  btnStop.style.display = '';
  // Progress shows in the banner above the buttons — the button label stays put.
  btnAll.innerHTML     = '<span class="btn-spinner"></span> Reprocessing…';
  banner.classList.remove('done');
  banner.classList.add('show');
  banner.textContent   = `Reprocessing 0 of ${queue.length}…`;

  const docs  = [...queue];   // snapshot; queue is refetched in finally
  const total = docs.length;
  let done = 0, failed = 0;

  // Batched reprocess: ONE bounded pool of Python workers (server-side, honouring
  // processing_concurrency) reprocesses the whole queue — each worker handles a
  // SHARD of docs in a single process, so Python/Tesseract startup is paid per
  // worker, not per document (the old per-doc reprocess-document spawn is what made
  // a large Reprocess All slow to start). Each doc keeps its own template/doc-slug/
  // enhance via the manifest, so accuracy is unchanged. Progress streams on
  // reprocess-progress; Stop kills the workers (see the stop handler).
  window.docusnap.removeReprocessProgress();
  window.docusnap.onReprocessProgress((msg) => {
    if (msg.type === 'file_done')  banner.textContent = `Reprocessing ${msg.done || 0} of ${msg.total || total}…`;
    else if (msg.type === 'log')   console.log('[Reprocess All]', msg.text);
  });

  try {
    const res = await window.docusnap.reprocessBatch(
      docs.map(d => ({ docId: d.id, folderPath: d.folder_path, filename: d.original_filename }))
    );
    done   = (res && res.done)   || 0;
    failed = (res && res.failed) || 0;
    // Refused because a single reprocess (or another batch) is already running — clear the
    // just-shown banner and explain, rather than leaving "Reprocessing 0 of N…" stuck.
    if (res && res.success === false) {
      banner.classList.remove('show');
      if (res.error) showToast(res.error, res.busy ? 'warn' : 'err');
    }
  } catch (e) {
    console.warn('[Reprocess All]', e.message);
  } finally {
    window.docusnap.removeReprocessProgress();
    // Refresh the open document's panel (it may have been reprocessed).
    if (currentDoc) {
      try {
        const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
        if (full && currentDoc && currentDoc.id === full.id) {
          currentDoc  = full;
          corrections = {};
          pendingAnchors = {};   // drop any un-committed ⊕ teach (coords now stale)
          pendingFieldRules = {};
          syncDocTypeFromRecord(full);
          renderFields(full);
        }
      } catch { /* panel refresh is best-effort */ }
    }
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts();
    renderQueueList();

    _batchActive         = false;
    btnAll.disabled      = false;
    btnOne.disabled      = false;
    btnStop.style.display = 'none';
    btnAll.innerHTML     = 'Reprocess all in queue';
    // Auto-commit any docs that reprocessed to 100% (setting-gated) + toast.
    await autoCommitFullConfidence();
  }

  const stopped = _batchStopped;
  const summary = stopped
    ? `Stopped — ${done} reprocessed`
    : (failed ? `Completed — ${done} OK, ${failed} failed`
              : `Completed ${done} of ${total}`);
  banner.classList.add('done');
  banner.textContent = summary;
  setTimeout(() => {
    if (!_batchActive) { banner.classList.remove('show', 'done'); banner.textContent = ''; }
  }, 4000);

  showToast(
    stopped ? `Stopped — ${done} reprocessed, ${queue.length} remaining`
            : (failed ? `Reprocessed ${done} — ${failed} failed`
                      : `Reprocessed ${done} document${done !== 1 ? 's' : ''}`),
    (failed || stopped) ? 'warn' : 'ok'
  );
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
  // Blank the per-document review aids too, so an empty queue ("All documents
  // reviewed") doesn't leave the last doc's prompts behind:
  renderReviewReason(null);                                  // the "needs a quick check" message
  const sub = document.querySelector('.fields-header-sub');
  if (sub) sub.style.display = 'none';                       // the ⊕ "wrong value?" prompt
  updateAcknowledgeButton();                                 // currentDoc is null → hides "Mark Reviewed"
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
  selCanvas.width    = w; selCanvas.height    = h;
  wizCanvas.width    = w; wizCanvas.height    = h;
  traceCanvas.width  = w; traceCanvas.height  = h;
  clearCanvas();
  clearTraceHighlight();
  redrawWizard();
}).observe(docImg);

// Navigate to a specific doc when Review is already open (e.g. second "Edit in Review" click).
window.docusnap.onNavigateToDoc((docId) => _navigateToDoc(docId));

async function _navigateToDoc(docId) {
  const inReview   = queue.find(d => d.id === docId);
  const inDeferred = deferredQueue.find(d => d.id === docId);
  let doc          = inReview || inDeferred;

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

  // Not in a queue (e.g. an already-FILED doc opened from the processed list or Search's
  // "Edit in Review") — load it directly so it can still be checked/corrected.
  if (!doc) {
    try { doc = await window.docusnap.getDocumentWithExtractions(docId); } catch {}
    if (!doc) return;
  }

  selectDoc(doc);
}

// A doc type was created/changed in another window (e.g. the Teach wizard) — reload the
// type list so the dropdown shows it, preserving the current selection.
window.docusnap.onDocTypesChanged?.(async () => {
  try { allDocTypes = await window.docusnap.getAllDocTypes(); } catch {}
  const sel = document.getElementById('doctype-select');
  const cur = sel ? sel.value : '';
  populateTypeDropdown();
  if (sel) sel.value = cur || sel.value;
});

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
// Scroll-wheel zoom (same step as the +/− buttons; matches the Template Manager preview).
_docViewer.addEventListener('wheel', (e) => {
  if (!pageImages.length) return;
  e.preventDefault();
  setPreviewZoom(previewZoom + (e.deltaY < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP));
}, { passive: false });
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
  wizard.drafts = {};            // fresh in-session draft cache each time the wizard opens
  wizard._loadedKey = null;
  const openMgr = document.getElementById('wiz-open-manager');
  if (openMgr) openMgr.style.display = 'none';

  // The field dropdown — with "• fixed" / "• boxes" markers so you can see at a
  // glance what each field already has — is (re)built by loadWizardField ->
  // populateWizardFieldOptions, once resolveWizardTemplate has cached saved state.
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
  wizard.fixedByKey = new Map();
  if (wizard.templateId) {
    try {
      const detail = await window.docusnap.getTemplateDetail(wizard.templateId);
      for (const mp of (detail?.field_mappings || [])) wizard.mappingsByKey.set(mp.field_key, mp);
      // Saved FIXED values live in template_fields (separate from the drawn-box
      // mappings) — cache them so the wizard can show "this field is fixed text".
      for (const tf of (detail?.fields || [])) {
        if (!tf.is_variable && tf.fixed_value != null && String(tf.fixed_value).trim() !== '')
          wizard.fixedByKey.set(tf.field_key, String(tf.fixed_value));
      }
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

// Snapshot the CURRENTLY-shown field's in-progress state into the session draft
// cache, so switching away and back never loses unsaved boxes / fixed text.
function captureWizardDraft(key) {
  if (!key) return;
  wizard.drafts[key] = {
    fixedMode:   !!wizard.fixedMode,
    fixedValue:  document.getElementById('wiz-fixed-value')?.value || '',
    anchorText:  document.getElementById('wiz-anchor-text')?.value || '',
    ocrType:     document.getElementById('wiz-ocr-type')?.value || 'text',
    draftAnchor: wizard.draftAnchor ? { ...wizard.draftAnchor } : null,
    draftTarget: wizard.draftTarget ? { ...wizard.draftTarget } : null,
  };
}

// Rebuild the field dropdown with an at-a-glance marker per field: "• fixed" when
// it has fixed text, "• boxes" when it has a drawn anchor+target — from the live
// draft cache first, else the saved template state. Programmatic value set never
// re-fires the 'change' handler.
function populateWizardFieldOptions() {
  const sel = document.getElementById('wiz-field-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const f of wizard.fields) {
    const d = wizard.drafts[f.key];
    const hasFixed = d ? (d.fixedMode && d.fixedValue.trim() !== '')
                       : !!(wizard.fixedByKey && wizard.fixedByKey.get(f.key));
    const hasBoxes = d ? !!(d.draftAnchor && d.draftTarget)
                       : !!(wizard.mappingsByKey && wizard.mappingsByKey.get(f.key)?.anchor_x_norm != null);
    const mark = hasFixed ? ' • fixed' : hasBoxes ? ' • boxes' : '';
    const o = document.createElement('option');
    o.value = f.key; o.textContent = `${f.label} (${f.key})${mark}`;
    sel.appendChild(o);
  }
  const cur = wizard.fields[wizard.index];
  if (cur) sel.value = cur.key;
}

function loadWizardField(i) {
  if (!wizard.fields.length) return;
  // Remember the OUTGOING field's draft before we switch (the reported bug: data
  // was lost on field change). No-op on first load (_loadedKey is null).
  if (wizard._loadedKey) captureWizardDraft(wizard._loadedKey);

  wizard.index = Math.max(0, Math.min(wizard.fields.length - 1, i));
  wizard.step = 'field';
  wizard.draftAnchor = wizard.draftTarget = null;
  wizard.resolved = null;              // stale once the field changes
  const _rmsg = document.getElementById('wiz-resolved-msg'); if (_rmsg) _rmsg.textContent = '';
  wizard.selectedBox = null;
  wizard.moveStart = null;
  wizard.drawMode = null;
  wizCanvas.classList.remove('drawing');

  const f = wizard.fields[wizard.index];
  const fixedInput  = document.getElementById('wiz-fixed-value');
  const anchorInput = document.getElementById('wiz-anchor-text');
  const ocrInput    = document.getElementById('wiz-ocr-type');

  // Restore priority: in-session DRAFT (unsaved edits) > saved FIXED value >
  // saved BOXES (this page) > empty. So you always see what's there + don't lose
  // work in progress.
  const draft = wizard.drafts[f.key];
  const saved = wizard.mappingsByKey && wizard.mappingsByKey.get(f.key);
  const savedFixed = wizard.fixedByKey && wizard.fixedByKey.get(f.key);
  if (draft) {
    wizard.fixedMode    = draft.fixedMode;
    fixedInput.value    = draft.fixedValue;
    anchorInput.value   = draft.anchorText;
    ocrInput.value      = draft.ocrType;
    wizard.draftAnchor  = draft.draftAnchor ? { ...draft.draftAnchor } : null;
    wizard.draftTarget  = draft.draftTarget ? { ...draft.draftTarget } : null;
  } else if (savedFixed != null && savedFixed !== '') {
    wizard.fixedMode = true; fixedInput.value = savedFixed;
    anchorInput.value = ''; ocrInput.value = 'text';
  } else if (saved && saved.anchor_x_norm != null && saved.target_x_norm != null
             && (saved.page_number || 0) === currentPage) {   // box belongs to this page
    wizard.fixedMode = false; fixedInput.value = '';
    wizard.draftAnchor = { x_norm: saved.anchor_x_norm, y_norm: saved.anchor_y_norm,
                           w_norm: saved.anchor_w_norm, h_norm: saved.anchor_h_norm };
    wizard.draftTarget = { x_norm: saved.target_x_norm, y_norm: saved.target_y_norm,
                           w_norm: saved.target_w_norm, h_norm: saved.target_h_norm };
    anchorInput.value = saved.anchor_text || ''; ocrInput.value = saved.ocr_type || 'text';
  } else {
    wizard.fixedMode = false; fixedInput.value = '';
    anchorInput.value = ''; ocrInput.value = 'text';
  }

  wizard._loadedKey = f.key;
  populateWizardFieldOptions();        // refresh the fixed/boxes markers
  updateWizardUI();
  redrawWizard();
}

function updateWizardUI() {
  const f = wizard.fields[wizard.index];
  document.getElementById('wiz-step').textContent =
    `Field ${wizard.index + 1} of ${wizard.fields.length}${f ? ' — ' + f.label : ''}`;
  document.getElementById('wiz-anchor-block').style.display = wizard.fixedMode ? 'none' : '';
  document.getElementById('wiz-fixed-block').style.display  = wizard.fixedMode ? '' : 'none';

  // Reflect the active mode on the segmented toggle. Done here (not only in the click
  // handler) so a field-switch restore — loadWizardField sets wizard.fixedMode then
  // calls updateWizardUI — shows the correct segment.
  document.querySelectorAll('#wiz-mode .wiz-seg-btn').forEach(b =>
    b.classList.toggle('armed', (b.dataset.mode === 'fixed') === wizard.fixedMode));

  const st = document.getElementById('wiz-status');
  if (wizard.fixedMode) {
    const fv = document.getElementById('wiz-fixed-value').value.trim();
    st.textContent = fv ? `Will file: ${fv}` : 'Type the value to file';
    st.className = 'wiz-status' + (fv ? ' ok' : '');
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

// Resolved-position box (amber, tight dash) drawn from a [x,y,w,h] normalised
// array returned by test-template-mapping — distinct from the drawn blue/green so
// the operator can compare "where I drew" vs "where it actually read".
function drawWizResolved(arr, color) {
  if (!arr || arr.length < 4) return;
  const w = wizCanvas.width, h = wizCanvas.height;
  const x = Math.round(arr[0] * w), y = Math.round(arr[1] * h);
  const bw = Math.round(arr[2] * w), bh = Math.round(arr[3] * h);
  wizCtx.setLineDash([2, 3]); wizCtx.lineWidth = 2; wizCtx.strokeStyle = color;
  wizCtx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  wizCtx.setLineDash([]); wizCtx.fillStyle = color + '22'; wizCtx.fillRect(x, y, bw, bh);
}

function redrawWizard() {
  if (!wizCanvas.width) return;
  wizCtx.clearRect(0, 0, wizCanvas.width, wizCanvas.height);
  if (!wizard.active) return;
  if (wizard.draftAnchor) drawWizBox(wizard.draftAnchor, '#4f8ef7', wizard.selectedBox === 'anchor');
  if (wizard.draftTarget) drawWizBox(wizard.draftTarget, '#3ecf8e', wizard.selectedBox === 'target');
  // Resolved-position overlay (amber): where the mapping ACTUALLY reads on THIS
  // page after relocation — so the operator sees it track a shifted scan, vs the
  // static drawn boxes above. Anchor = where the label was located; target = the
  // crop the value was read from.
  if (wizard.resolved) {
    if (wizard.resolved.anchor_box) drawWizResolved(wizard.resolved.anchor_box, '#f7b84f');
    if (wizard.resolved.target_box) drawWizResolved(wizard.resolved.target_box, '#f7b84f');
  }
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
    if (wizard.drawMode === 'anchor') {
      wizard.draftAnchor = norm; wizard.step = 'target';
      maybeAutofillAnchorLabel(norm);   // fill the (editable) label from the box if blank
    } else                              { wizard.draftTarget = norm; wizard.step = 'review'; }
    wizard.drawMode = null;
    wizard.resolved = null;             // a re-draw invalidates the previous "reads here" overlay
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

// "Show where it reads": run the REAL Stage 0.5 extractor on the current page and
// overlay (amber) where the anchor located + the value was actually read, so the
// operator sees the mapping track a shifted document instead of trusting the
// static drawn boxes. Uses the same test-template-mapping IPC the Template
// Manager test uses (now also returning resolved geometry).
document.getElementById('wiz-show-resolved')?.addEventListener('click', async () => {
  if (!wizard.active || wizard.fixedMode || !wizard.draftAnchor || !wizard.draftTarget) return;
  const f = wizard.fields[wizard.index];
  const msg = document.getElementById('wiz-resolved-msg');
  msg.textContent = 'Reading…'; msg.className = 'wiz-status';
  // Build the mapping EXACTLY as Save does, so the preview matches reprocess.
  const mapping = {
    field_key:      f.key, page_number: currentPage,
    anchor_text:    document.getElementById('wiz-anchor-text').value.trim() || null,
    anchor_x_norm: wizard.draftAnchor.x_norm, anchor_y_norm: wizard.draftAnchor.y_norm,
    anchor_w_norm: wizard.draftAnchor.w_norm, anchor_h_norm: wizard.draftAnchor.h_norm,
    target_x_norm: wizard.draftTarget.x_norm, target_y_norm: wizard.draftTarget.y_norm,
    target_w_norm: wizard.draftTarget.w_norm, target_h_norm: wizard.draftTarget.h_norm,
    offset_dx_norm: wizard.draftTarget.x_norm - wizard.draftAnchor.x_norm,
    offset_dy_norm: wizard.draftTarget.y_norm - wizard.draftAnchor.y_norm,
    ocr_type:       document.getElementById('wiz-ocr-type').value,
    search_expansion: 0.04, enabled: true,
  };
  let out = {};
  try {
    const c = document.createElement('canvas');
    c.width = docImg.naturalWidth; c.height = docImg.naturalHeight;
    c.getContext('2d').drawImage(docImg, 0, 0);
    const b64 = c.toDataURL('image/png').split(',')[1];
    out = (await window.docusnap.testTemplateMapping(b64, mapping)) || {};
  } catch (e) {
    msg.textContent = 'Read failed: ' + (e?.message || e); msg.className = 'wiz-status err';
    return;
  }
  wizard.resolved = { anchor_box: out.anchor_box || null, target_box: out.target_box || null };
  redrawWizard();
  if (out.value) {
    msg.textContent = `Reads “${out.value}” — amber shows where it resolved`;
    msg.className = 'wiz-status ok';
  } else {
    msg.textContent = 'Anchor not located / nothing read on this page.';
    msg.className = 'wiz-status err';
  }
});
document.getElementById('wiz-prev')?.addEventListener('click', () => loadWizardField(wizard.index - 1));
document.getElementById('wiz-next')?.addEventListener('click', () => loadWizardField(wizard.index + 1));
// Mode toggle (segmented): "Read it from the document" (anchor + target) vs "Always
// use the same value" (a constant). Mirrors the Settings Template Manager mode; the
// active segment is reflected by updateWizardUI so a field-switch restore stays right.
document.getElementById('wiz-mode')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.wiz-seg-btn');
  if (!btn) return;
  const fixed = btn.dataset.mode === 'fixed';
  if (fixed === wizard.fixedMode) return;   // already in this mode
  wizard.fixedMode = fixed;
  wizard.drawMode = null;
  wizCanvas.classList.remove('drawing');
  updateWizardUI();
});

// Make the Template Wizard panel draggable by its title bar. The panel is
// absolutely positioned (default: anchored top-right); on the first drag we switch
// to explicit left/top and then clamp inside its container so it can't be lost
// off-screen. The close button inside the bar never starts a drag.
(() => {
  const panel  = document.getElementById('wizard-panel');
  const handle = panel?.querySelector('.wiz-title');
  if (!panel || !handle) return;
  let drag = null;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.wiz-close')) return;
    const r  = panel.getBoundingClientRect();
    const pr = (panel.offsetParent || document.body).getBoundingClientRect();
    panel.style.left  = (r.left - pr.left) + 'px';
    panel.style.top   = (r.top  - pr.top)  + 'px';
    panel.style.right = 'auto';
    drag = { x: e.clientX, y: e.clientY, left: r.left - pr.left, top: r.top - pr.top };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const par  = panel.offsetParent || document.documentElement;
    const maxL = Math.max(0, par.clientWidth  - panel.offsetWidth);
    const maxT = Math.max(0, par.clientHeight - panel.offsetHeight);
    panel.style.left = Math.max(0, Math.min(maxL, drag.left + (e.clientX - drag.x))) + 'px';
    panel.style.top  = Math.max(0, Math.min(maxT, drag.top  + (e.clientY - drag.y))) + 'px';
  });
  window.addEventListener('mouseup', () => { drag = null; });
})();
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

// Mirror of database/modules/learning.js::sanitizeAnchorLabel — keep only stable
// caption tokens, dropping bare numbers / refs / dates / code-like serials so an
// auto-derived label GENERALISES across documents (e.g. "2605-0769-1 Work Address"
// -> "Work Address"). Same rule both ends so a wizard-captured label matches what
// extraction re-locates.
function sanitizeAnchorLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label.trim().split(/\s+/).filter(tok => {
    if (!/[a-zA-Z]/.test(tok)) return false;                 // bare number / ref / date
    if ((tok.match(/\d/g) || []).length >= 3) return false;  // code-like serial
    return true;
  }).join(' ').trim();
}

// An auto-detected label captured off a NOISY scan can be garbled ("Serial No." read
// as "verial No.", "Description" as "�escription"). A garbled label never re-locates on
// future pages, so the taught anchor silently reads nothing forever. Flag the obvious
// garble so the ⊕ readout can warn + let the operator fix the label before it's saved.
function labelLooksSuspicious(label) {
  if (!label || !label.trim()) return true;
  if (/�/.test(label)) return true;                                 // OCR replacement char �
  if (/[^\p{L}\p{N}\s.,'&()/:#%\-]/u.test(label)) return true;           // junk symbols real captions don't carry
  // a long alphabetic token with NO vowel reads as garble ("brtnz", "vrntx")
  const toks = label.split(/\s+/).map(t => t.replace(/[^a-zA-Z]/g, '')).filter(t => t.length >= 4);
  if (toks.some(t => !/[aeiouy]/i.test(t))) return true;
  return false;
}

// OCR a NORMALISED box on the current page image (docImg) via the existing
// ocr-region IPC (same light-first region.py recipe the target read-back uses).
// Returns trimmed text, or '' on failure. Used to auto-derive the anchor label.
async function ocrWizardBox(box) {
  try {
    if (!docImg || !docImg.naturalWidth) return '';
    const nw = docImg.naturalWidth, nh = docImg.naturalHeight;
    const c = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(box.w_norm * nw));
    c.height = Math.max(1, Math.round(box.h_norm * nh));
    const ctx = c.getContext('2d');
    ctx.drawImage(docImg, Math.round(box.x_norm * nw), Math.round(box.y_norm * nh),
                  c.width, c.height, 0, 0, c.width, c.height);
    const b64 = c.toDataURL('image/png').split(',')[1];
    return ((await window.docusnap.ocrRegion(b64)) || '').trim();
  } catch { return ''; }
}

// Auto-derive the anchor LABEL from the drawn anchor box when the operator left
// the field blank — so EVERY mapping carries a label, which the extraction-time
// drift guard re-locates to follow a shifted page (a mapping with no label can't
// track drift). Populates the VISIBLE, editable input so the operator can correct
// it before Save. Never overwrites a label the operator typed; an empty/failed
// OCR leaves it blank (-> null on save, today's behaviour).
async function maybeAutofillAnchorLabel(box) {
  const input = document.getElementById('wiz-anchor-text');
  if (!input || input.value.trim()) return;
  const clean = sanitizeAnchorLabel(await ocrWizardBox(box));
  if (clean && !input.value.trim()) input.value = clean;
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
    if (fixed) {
      wizard.fixedByKey.set(field.key, fixedVal);
      // Populate the document's field in the review panel IMMEDIATELY — the operator
      // shouldn't have to reprocess to see a fixed value they just set. Dispatching
      // 'input' marks the field edited so the normal Confirm path persists it.
      const inp = document.querySelector(`.field-input[data-key="${field.key}"]`);
      if (inp) { inp.value = fixedVal; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }
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

// ── Hidden developer extraction-precedence console (Ctrl+Shift+D then M) ───────
// Read-only debugging aid: shows, per field, the candidate each stage produced,
// its value/confidence/method, whether it won or was rejected (and why), and the
// final winning value. Reuses the existing engine trace stream (process-trace);
// the main process gates --trace + the route to this window behind reviewTraceSet
// (password SFDEV, verified in main). Opens NO extra window — just this panel.
(() => {
  const STAGE_LABEL = { '0_template': 'template', '0.5_mapping': 'mapping',
                        '1_keyword': 'keyword', '2_anchor': 'anchor', '4_validate': 'validate' };
  const STAGE_ORDER = { '0_template': 0, '0.5_mapping': 1, '1_keyword': 2, '2_anchor': 3, '4_validate': 4 };

  const panel = document.getElementById('rdc');
  if (!panel) return;
  const elDoc    = document.getElementById('rdc-doc');
  const elEmpty  = document.getElementById('rdc-empty');
  const elFields = document.getElementById('rdc-fields');

  let active   = false;     // console open
  let armed    = false, armedAt = 0;
  let modalOpen = false;
  let traceBuf = [];        // events for the run currently being shown
  let renderTimer = null;

  const inField = (el) => !!el && (el.isContentEditable
    || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

  // Subscribe ONCE. Events only arrive while reviewTraceActive is set in main, so
  // this is inert until the console is unlocked. During a single-doc reprocess the
  // stream belongs to the doc the user just acted on, so we buffer it as-is rather
  // than filtering on filename (a reprocess runs under a temp filename — the known
  // trace-orphan case — so a filename filter would drop its events).
  window.docusnap.onProcessTrace((ev) => {
    if (!active || !ev) return;
    traceBuf.push(ev);
    scheduleRender();
  });

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(traceBuf); }, 120);
  }

  function render(events) {
    const byField = new Map();
    // sliceMap[field][stage] = [ {kind, bbox, page}, ... ] — links candidates to page regions
    const sliceMap = {};
    const get = (f) => {
      if (!byField.has(f)) byField.set(f, { merges: [], rejects: [], transforms: [], validations: [], final: null });
      return byField.get(f);
    };
    for (const ev of events) {
      if (!ev || ev.field == null) continue;
      if (ev.event === 'merge') get(ev.field).merges.push(ev);
      else if (ev.event === 'anchor_reject') get(ev.field).rejects.push(ev);
      else if (ev.event === 'transform') get(ev.field).transforms.push(ev);   // Stage 2.5 denoise/correct
      else if (ev.event === 'validation') get(ev.field).validations.push(ev);  // Stage 4/4.5 normalise/flag/withhold
      else if (ev.event === 'final') get(ev.field).final = ev;
      else if (ev.event === 'slice' && ev.bbox) {
        const f = ev.field;
        if (!sliceMap[f]) sliceMap[f] = {};
        const key = ev.stage || '_';
        if (!sliceMap[f][key]) sliceMap[f][key] = [];
        sliceMap[f][key].push({ kind: ev.kind || 'target', bbox: ev.bbox, page: ev.page ?? 0, stage: ev.stage || '_' });
      }
    }
    // Map a candidate's METHOD to the slice-event stage it produced. The slice
    // events are keyed by the OCR METHOD ("anchor_crop", "anchor_relocate",
    // "anchor_registration", "template_mapping", "anchor_inline") — NOT the coarse
    // merge stage ("2_anchor"). A method with NO captured region (text-fallback
    // "anchor" / "keyword" / "template_fixed_locked") is intentionally absent here
    // → no highlight box (honest: there is no region to point at, rather than a
    // misleading box from an unrelated rejected rung). Note anchor_inline DOES have
    // a region now — the harvested value's inline_box (see anchor.py).
    const METHOD_TO_SLICE = {
      anchor_crop: 'anchor_crop',
      anchor_inline: 'anchor_inline',
      anchor_registration: 'anchor_registration',
      anchor_crop_relocated: 'anchor_relocate',
      template_mapping: 'template_mapping',
      template_mapping_expanded: 'template_mapping',
      template_mapping_salvaged: 'template_mapping',
      template_mapping_expanded_salvaged: 'template_mapping',
    };
    // Pick the slice that the candidate's METHOD actually produced — never a
    // fallback to "any slice for the field" (that was the wrong-box bug: a winning
    // inline read borrowed the rejected rigid crop's stale coordinates).
    function pickSlice(field, method) {
      const m = sliceMap[field];
      if (!m || !method) return null;
      const key = METHOD_TO_SLICE[method];
      if (!key) return null;                  // text/inline read — no crop region
      const arr = m[key];
      if (!arr || !arr.length) return null;
      return arr.find(s => s.kind === 'target') || arr[0];
    }
    // The field's located LABEL box (kind="anchor") — the diagnostic anchor_label
    // slice (Stage 2 ⊕ anchors) or a template_mapping anchor (Stage 0.5). Attached to
    // every candidate row so clicking a value ALSO reveals where its anchor resolved
    // (or, if absent, that the label didn't locate on this document).
    function anchorSlice(field) {
      const m = sliceMap[field];
      if (!m) return null;
      const pref = m['anchor_label'];
      if (pref) { const hit = pref.find(s => s.kind === 'anchor'); if (hit) return hit; }
      for (const k of Object.keys(m)) { const hit = m[k].find(s => s.kind === 'anchor'); if (hit) return hit; }
      return null;
    }
    if (!byField.size) {
      elEmpty.hidden = false; elFields.innerHTML = '';
      return;
    }
    elEmpty.hidden = true;
    const blocks = [];
    for (const [field, m] of byField) {
      const finalVal = m.final ? m.final.value : null;
      const emptyCls = (finalVal == null || finalVal === '') ? ' empty' : '';
      const winLine  = m.final
        ? `${escHtml(shown(finalVal))}${m.final.method ? ` · ${escHtml(m.final.method)}` : ''}${rxBadge(field, finalVal)}`
        : '—';

      const rows = [];
      for (const c of [...m.merges].sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9))) {
        const won = c.decision === 'win';
        let reason = '';
        if (!won) {
          const wc = c.vs ? c.vs.confidence : null;
          reason = (wc != null && c.confidence != null && c.confidence < wc)
            ? `lost — lower confidence (${c.confidence}% < ${wc}%)`
            : (c.vs && c.vs.value != null ? `lost — superseded by "${shown(c.vs.value)}"` : 'lost — superseded');
        }
        rows.push(cand(STAGE_LABEL[c.stage] || c.stage, c.value, c.confidence, c.method, won ? 'won' : 'lost', won ? '' : reason, pickSlice(field, c.method), rxBadge(field, c.value), anchorSlice(field)));
      }
      for (const r of m.rejects) {
        // A rejected rung IS keyed by its method (e.g. "anchor_crop") — show the
        // exact crop it read so the operator sees WHERE the garbage came from. The
        // rx score explains a format-based rejection at a glance (e.g. rx 0%).
        rows.push(cand(r.method || 'anchor', r.value, null, null, 'rej', `rejected — ${r.reason || 'failed gate'}`, pickSlice(field, r.method), rxBadge(field, r.value), anchorSlice(field)));
      }
      // Stage 2.5 transforms (denoise / OCR-correct): value rewritten in place.
      for (const t of m.transforms) {
        const lbl = t.stage === '2.5_denoise' ? 'denoise'
                  : t.stage === '2.5_correct' ? 'correct' : (t.stage || 'transform');
        rows.push(noteRow(lbl, `${escHtml(shown(t.from))} → ${escHtml(shown(t.to))}`, 'xform'));
      }
      // Stage 4 / 4.5 validation: the answer to "why is this held / flagged /
      // emptied" — shows the note, any value change, and a correction candidate.
      for (const v of m.validations) {
        if (!v.note && !v.corrected_to && v.was === v.value) continue;   // no-op normalise
        let txt = (v.was !== undefined && v.was !== v.value)
          ? `${escHtml(shown(v.was))} → ${escHtml(shown(v.value))}`
          : escHtml(shown(v.value));
        if (v.corrected_to) txt += ` · candidate: ${escHtml(v.corrected_to)}`;
        txt += rxBadge(field, v.value);
        if (v.note) txt += ` — ${escHtml(v.note)}`;
        // Plain-English reasoning sub-line (what the validation did + why).
        const why = validationWhy(v);
        if (why) txt += `<div class="rdc-why">${why}</div>`;
        rows.push(noteRow('validate', txt, 'valid'));
      }
      if (!rows.length) rows.push(`<div class="rdc-cand"><span class="rdc-reason" style="padding-left:0">matched on the OCR text layer (no per-stage crop trace)</span></div>`);

      blocks.push(
        `<div class="rdc-field" data-f="${escHtml(field)}">`
        + `<div class="rdc-fhead"><span class="rdc-fname">${escHtml(field)}</span>`
        + `<span class="rdc-fwin${emptyCls}">${winLine}</span></div>`
        + `<div class="rdc-cands">${rows.join('')}</div></div>`);
    }
    elFields.innerHTML = blocks.join('');
    elFields.querySelectorAll('.rdc-fhead').forEach((h) => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });
    // Click a candidate row that has slice data → highlight the region on the page.
    elFields.querySelectorAll('.rdc-cand[data-bbox],.rdc-cand[data-anchor-bbox]').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();   // don't toggle the field block open/closed
        try {
          const page = parseInt(row.dataset.page || row.dataset.anchorPage, 10) || 0;
          // If the document is showing a different page, navigate to the correct one first.
          if (page !== currentPage) {
            currentPage = page;
            renderPage();
          }
          // Draw the value box (amber) first, then OVERLAY the anchor/label box (blue)
          // without clearing — so a click shows both where the value was read AND where
          // its anchor resolved (or just one if the other wasn't captured).
          let drew = false;
          if (row.dataset.bbox) {
            drawTraceBbox(JSON.parse(row.dataset.bbox), row.dataset.kind || 'target', row.dataset.stage || '_');
            drew = true;
          }
          if (row.dataset.anchorBbox) {
            drawTraceBbox(JSON.parse(row.dataset.anchorBbox), 'anchor', row.dataset.anchorStage || 'anchor_label', drew);
          }
        } catch (_) {}
      });
    });
  }

  function cand(stage, value, conf, method, tag, reason, slice, rx, aslice) {
    const tagTxt = tag === 'rej' ? 'rejected' : tag;
    const tAttr = slice ? ` data-bbox="${escHtml(JSON.stringify(slice.bbox))}" data-kind="${escHtml(slice.kind || 'target')}" data-page="${slice.page ?? 0}" data-stage="${escHtml(slice.stage || '_')}"` : '';
    const aAttr = aslice ? ` data-anchor-bbox="${escHtml(JSON.stringify(aslice.bbox))}" data-anchor-page="${aslice.page ?? 0}" data-anchor-stage="${escHtml(aslice.stage || 'anchor_label')}"` : '';
    const clickAttr = (slice || aslice) ? ` style="cursor:pointer" title="Click to highlight the value box (amber)${aslice ? ' + anchor box (blue)' : ''} on the page"` : '';
    const bboxAttr = tAttr + aAttr + clickAttr;
    return `<div class="rdc-cand"${bboxAttr}>`
      + `<span class="rdc-stage">${escHtml(stage)}</span>`
      + `<span class="rdc-val">${escHtml(shown(value))}${method ? ` <span class="rdc-conf">${escHtml(method)}</span>` : ''}${rx || ''}</span>`
      + (conf != null ? `<span class="rdc-conf">${conf}%</span>` : '')
      + `<span class="rdc-tag ${tag}">${tagTxt}</span>`
      + (reason ? `<span class="rdc-reason">${escHtml(reason)}</span>` : '')
      + (slice ? `<span class="rdc-pin" title="Click row to highlight on page">◎</span>` : '')
      + `</div>`;
  }

  function noteRow(label, html, cls) {
    return `<div class="rdc-cand rdc-note ${cls}">`
      + `<span class="rdc-stage">${escHtml(label)}</span>`
      + `<span class="rdc-val">${html}</span></div>`;
  }

  function shown(v) { return v == null || v === '' ? '∅' : String(v); }

  // ── Regex/format score + validation explanation (this window only) ────────────
  // Reuses the SAME validation_patterns the extraction credibility gate uses
  // (fetched once via ensureValidationPatterns) and the SAME field type→key map,
  // so the score the trace shows is the score extraction actually checked against.
  function traceValKey(field) {
    return validationKeyFor((fieldDefs || []).find(f => f.key === field));
  }
  // % of the value covered by the best matching pattern: 100 = the whole value
  // fits the expected shape; <100 = trailing/leading chars fall outside it; 0 =
  // no match. null when the field has no pattern (free-text → no regex check ran).
  function regexScore(field, value) {
    const v = (value == null ? '' : String(value)).trim();
    if (!v) return null;
    const valKey = traceValKey(field);
    if (!valKey) return null;
    const pats = validationPatterns && validationPatterns[valKey];
    if (!pats || !pats.length) return null;
    let best = 0;
    for (const re of pats) {
      let m = null; try { m = v.match(re); } catch { m = null; }
      if (m && m[0]) best = Math.max(best, m[0].length / v.length);
    }
    return { pct: Math.round(best * 100), valKey };
  }
  function rxBadge(field, value) {
    const s = regexScore(field, value);
    if (!s) return '';
    const cls = s.pct >= 100 ? 'rx-full' : s.pct >= 60 ? 'rx-part' : 'rx-low';
    return ` <span class="rdc-rx ${cls}" title="Regex/format check (${escHtml(s.valKey)}): ${s.pct}% of this value fits the expected pattern">rx ${s.pct}%</span>`;
  }
  // Plain-English reasoning for a Stage 4/4.5 validation event, from the structural
  // signals (value change / correction candidate / kept-and-flagged) PLUS a reading
  // of the note text. Returns '' when there's nothing extra to explain.
  function validationWhy(v) {
    const changed = (v.was !== undefined && v.was !== v.value);
    const bits = [];
    if (changed) bits.push('Stage 4/4.5 rewrote the value (normalised or OCR-corrected during validation).');
    if (v.corrected_to) bits.push(`A correction "${escHtml(v.corrected_to)}" was suggested but NOT auto-applied — confirm to accept it.`);
    if (!changed && !v.corrected_to) bits.push('The value was kept but flagged for review (confidence capped).');
    const n = (v.note ? String(v.note) : '').toLowerCase();
    if (n.includes('format differs from the usual'))
      bits.push("Why: the value's shape differs from the format learned from this field's confirmed history.");
    else if (n.includes('candidate') || n.includes('correction'))
      bits.push('Why: a likely OCR fix was found in learned data and offered as a suggestion.');
    else if (n.includes('character') || n.includes('charset') || n.includes('symbol'))
      bits.push("Why: the value contains characters not expected for this field type (likely an OCR symbol misread).");
    else if (n.includes('date'))
      bits.push('Why: the date was recovered/normalised from a noisy read; confidence capped pending review.');
    return bits.join(' ');
  }

  async function pullExisting() {
    // Already-processed (fresh-scan) docs are keyed in the session registry by
    // their original filename; reprocess runs stream live into traceBuf instead.
    if (!currentDoc) { traceBuf = []; clearTraceHighlight(); render(traceBuf); return; }
    let evs = [];
    try { evs = (await window.docusnap.devGetSessionDoc(currentDoc.original_filename)) || []; } catch {}
    traceBuf = evs;
    render(traceBuf);
  }

  async function open() {
    if (active) return;
    const ok = await openPasswordModal();
    if (!ok) return;
    active = true;
    panel.hidden = false;
    elDoc.textContent = currentDoc ? currentDoc.original_filename : '(no document selected)';
    // Load the shared validation_patterns so rxBadge() can score values against
    // the SAME regexes extraction used (no-op if already loaded; degrades to no
    // badge if unavailable). Awaited before the first render.
    try { await ensureValidationPatterns(); } catch {}
    pullExisting();
  }

  async function close() {
    if (!active) return;
    active = false;
    panel.hidden = true;
    try { await window.docusnap.reviewTraceSet(false); } catch {}
  }

  // Refresh when the selected document changes (doc-name is set by selectDoc).
  const nameEl = document.getElementById('doc-name');
  if (nameEl) {
    new MutationObserver(() => {
      if (!active) return;
      elDoc.textContent = nameEl.textContent || '(no document selected)';
      pullExisting();
    }).observe(nameEl, { childList: true, characterData: true, subtree: true });
  }

  // Draggable by its title bar so it never traps the review action buttons
  // underneath it. Grab the header (not its buttons) and move freely; clamped so
  // the title bar always stays on-screen.
  const head = document.getElementById('rdc-head');
  let drag = null;
  head?.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;        // let header buttons click normally
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.style.left = r.left + 'px';              // switch from right-anchored to left/top
    panel.style.top  = r.top + 'px';
    panel.style.right = 'auto';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const maxL = Math.max(0, window.innerWidth  - panel.offsetWidth);
    const maxT = Math.max(0, window.innerHeight - 36);   // keep the title bar reachable
    panel.style.left = Math.min(Math.max(0, e.clientX - drag.dx), maxL) + 'px';
    panel.style.top  = Math.min(Math.max(0, e.clientY - drag.dy), maxT) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (drag) { drag = null; document.body.style.userSelect = ''; }
  });

  document.getElementById('rdc-close')?.addEventListener('click', close);
  document.getElementById('rdc-reprocess')?.addEventListener('click', () => {
    traceBuf = [];                       // fresh run — drop the previous trace
    clearTraceHighlight();
    render(traceBuf);
    document.getElementById('btn-reprocess')?.click();   // reuse the full reprocess flow
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active && !modalOpen) { close(); return; }
    if (modalOpen || inField(e.target)) return;
    if (!(e.ctrlKey && e.shiftKey)) { armed = false; return; }
    if (e.code === 'KeyD') { armed = true; armedAt = Date.now(); return; }
    if (e.code === 'KeyM' && armed && (Date.now() - armedAt) < 1000) {
      armed = false; e.preventDefault();
      active ? close() : open();
    } else if (e.code !== 'KeyD') { armed = false; }
  });

  // Minimal password prompt → enable tracing in main (verified there). Resolves
  // true on success. Mirrors the main-window dev-inspector unlock UX.
  function openPasswordModal() {
    return new Promise((resolve) => {
      modalOpen = true;
      const ov = document.createElement('div');
      Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999' });
      const box = document.createElement('div');
      Object.assign(box.style, { width: '280px', background: 'var(--surface)',
        border: '1px solid var(--border2)', borderRadius: '10px', padding: '18px',
        boxShadow: '0 12px 32px rgba(0,0,0,.5)', color: 'var(--text)' });
      const title = document.createElement('div');
      title.textContent = 'Extraction trace console';
      Object.assign(title.style, { fontSize: '13px', fontWeight: '600', marginBottom: '10px' });
      const input = document.createElement('input');
      input.type = 'password'; input.placeholder = 'Password';
      Object.assign(input.style, { width: '100%', padding: '8px 10px', borderRadius: '6px',
        outline: 'none', border: '1px solid var(--border2)', background: 'var(--bg)',
        color: 'var(--text)', fontSize: '12px', boxSizing: 'border-box' });
      const msg = document.createElement('div');
      Object.assign(msg.style, { color: 'var(--err)', fontSize: '11px', minHeight: '14px', margin: '6px 0 10px' });
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
      const okBtn = document.createElement('button'); okBtn.textContent = 'Open';
      for (const b of [cancel, okBtn]) Object.assign(b.style, { padding: '7px 14px',
        borderRadius: '6px', border: '1px solid var(--border2)', background: 'transparent',
        color: 'var(--text)', cursor: 'pointer', fontSize: '11px' });
      Object.assign(okBtn.style, { background: 'var(--accent)', borderColor: 'var(--accent)',
        color: 'var(--bg)', fontWeight: '500' });
      const done = (v) => { ov.remove(); modalOpen = false; resolve(v); };
      const submit = async () => {
        okBtn.disabled = true;
        let valid = false;
        try { valid = await window.docusnap.reviewTraceSet(true, input.value); } catch {}
        okBtn.disabled = false;
        if (valid) done(true);
        else { msg.textContent = 'Incorrect password.'; input.value = ''; input.focus(); }
      };
      cancel.addEventListener('click', () => done(false));
      okBtn.addEventListener('click', submit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') submit();
        if (ev.key === 'Escape') done(false);
      });
      row.append(cancel, okBtn);
      box.append(title, input, msg, row);
      ov.append(box);
      document.body.append(ov);
      input.focus();
    });
  }
})();

// ── Init ──────────────────────────────────────────────────────────────────────
loadQueue();
