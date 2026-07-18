'use strict';

// Keyboard-focus repair (Windows): a native confirm()/alert() drops Blink's render-widget
// keyboard focus while the window still reports focused, so the NEXT text-field click shows no
// caret until you alt-tab out and back. Wrap the native dialogs once so that whenever one
// returns we flag this window "focus suspect" in main; the pointerdown repair (preload →
// ensure-window-focus → focusRepair.blurWebView) then does the real transition on the next field
// press. Single point, no call-site changes, no async refactor. Guarded so it never breaks a dialog.
(function instrumentNativeDialogsForFocusRepair() {
  const mark = () => { try { window.docusnap?.markFocusSuspect?.(); } catch {} };
  const _confirm = window.confirm.bind(window);
  const _alert = window.alert.bind(window);
  window.confirm = (...a) => { try { return _confirm(...a); } finally { mark(); } };
  window.alert = (...a) => { try { return _alert(...a); } finally { mark(); } };
})();

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

// Dismiss the EXTRACTION advisory note (the wordness "looks like a code, not a name" / format-check /
// issuer note + its Accept button) once the operator has supplied a value themselves (typed or
// ⊕-drawn). Human input is authoritative, so the machine's "please verify" — which describes the OLD
// machine-read value — is satisfied and stale. Removes ONLY that advisory element via an explicit
// exclusion selector: never the inline live-regex warning (.field-validation-warn), the
// totals-verified badge (.verified) or the applied auto-fix badge (.corrected). Nulls the in-memory
// flags so renderReviewReason's tally drops the field on any later re-render. Does NOT touch
// review_flag_count / Confirm-gating / auto-file (those read the server count) and never teaches a
// global allowlist (that stays the explicit "✓ This name/issuer is correct" buttons). Callers gate on
// value-actually-changed; the same edit re-runs fieldValidationError so a bad structured value re-flags.
function dismissServerNote(row, key) {
  if (!row) return;
  const note = row.querySelector('.field-note:not(.field-validation-warn):not(.verified):not(.corrected)');
  if (note) note.remove();
  const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
  if (ex) { ex.validation_note = null; ex.corrected_to = null; }
}

// ── State ─────────────────────────────────────────────────────────────────────
let queue            = [];
// Review-queue view: group rows by sender (default) vs raw newest-first. A same-window
// UI preference (persisted in localStorage, not a DB setting), like the queue splitter.
let queueGrouped     = (localStorage.getItem('review_queue_grouped') || 'true') !== 'false';
// Which sender groups are EXPANDED in the grouped list. Default: none (all collapsed).
// Same-session UI state (not persisted) — each window open starts fully collapsed;
// selecting a doc auto-expands its group so the review flow stays visible.
let expandedSuppliers = new Set();
let deferredQueue    = [];
let bulkFiling       = false; // true while File All Ready runs; suppresses the auto-refresh listener so its per-doc confirm broadcasts can't clobber the loop's local queue mid-run
let allDocTypes      = [];
let currentDoc       = null;
let currentPage      = 0;
let pageImages       = [];
let fieldDefs        = [];
let corrections      = {};
let anchorTaughtFields = new Set(); // field_keys taught via the ⊕ highlight/zone-OCR tool this cycle
// field_keys with a SAVED learned anchor for the current supplier+doc-type scope (get-taught-field-keys),
// for the per-field "position taught" dot. OR'd with pendingAnchors (this-session ⊕ teaches) at render.
let taughtFieldKeys = new Set();
// Anchors drawn with ⊕ this cycle, STAGED in memory and persisted only on Confirm
// & File (mirrors `corrections`). An un-confirmed teach (skip/defer/doc-change)
// leaves NO learned trace, so an accidental wrong pick can't poison the corpus.
// Keyed by field_key → the saveFieldAnchor payload computed at draw time.
let pendingAnchors   = {};
// When set, the next box drawn on the preview is a MANUAL ANCHOR (a label to point at,
// e.g. "Invoice Total") for this field — not a value read. Armed by the readout's
// "Draw the anchor" button; consumed on mouseup by runAnchorDraw.
let anchorDrawField  = null;
// DESKEW DISPLAY (per-doc, opt-in, default OFF). When on, the shown page is the STRAIGHTENED
// render (region.py --deskew) so drawn ⊕ boxes land on level text — the immediate crop read is
// then a pure win (see==read). `deskewPageAngle` is the angle CURRENTLY applied to docImg (0 =
// showing the raw page); it drives the coord back-transform on save (_deskewFixPending). Cache
// keyed by page index so re-visiting a page doesn't re-run OCR. Reset on doc change.
let deskewEnabled    = false;
let deskewByPage     = {};   // page index → { angle, uri } (uri null / angle 0 = page already level)
let deskewPageAngle  = 0;
// SESSION-WIDE straighten (rail toggle `#btn-deskew-all`). When ON, every doc that opens starts with
// deskewEnabled=true and Reprocess All / Reprocess-this-sender force a straightened READ. Persisted in
// localStorage (UI pref, mirrors review_queue_grouped) and written ONLY in the rail button handler
// (Oracle C2) — never by the per-doc toggle, the doc-open reset, or the wizard's deskew suppression.
let deskewSessionOn  = (localStorage.getItem('review_deskew_session') === 'true');
// Minimum skew angle (deg) for the session straighten — only docs tilted MORE than this straighten
// (display + reprocess reads). Default 1.0° (oscar: above the sub-degree noise band, catches typical
// feeder skew, and where straightening starts helping the READ); clamped [0.2, 5.0]. Set in the rail
// flyout, persisted alongside the flag; written ONLY by applyDeskewSession/turnOffDeskewSession (C2).
let deskewMinAngle   = (() => { const v = parseFloat(localStorage.getItem('review_deskew_min_angle')); return (Number.isFinite(v) && v >= 0.2 && v <= 5.0) ? v : 1.0; })();
// The HARD floor the backend can never undercut (max(0.2,user) in detect_skew_angle). The per-doc
// Straighten BUTTON reads at this floor — so it can straighten a doc the SESSION floor intentionally
// skips ("do its job even though the main option is on"); it also matches the single-doc reprocess
// read, which passes --deskew-pages with no --deskew-min-angle (i.e. the 0.2° floor). The session
// batch keeps its own deskewMinAngle floor.
const DESKEW_HARD_FLOOR = 0.2;
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
  'reprocess-supplier': 'Re-run extraction on just the queued documents from the open document’s sender — fix one supplier’s batch after teaching it, without reprocessing the whole queue.',
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
  // "Save as template" (promote-to-template) is an ADVANCED admin tool — gate it like
  // "+ New type" and the Template Wizard so it stops leaking to operators (it was the only
  // advanced template control with no role gate). Learning is unaffected either way.
  const _promoteBtn = document.getElementById('btn-add-template');
  if (_promoteBtn) _promoteBtn.style.display = isAdmin ? '' : 'none';
  // Admin-only "Edit type" shortcut: deep-links to Settings -> Document Types to edit the
  // CURRENT type's fields/roles (fixes the dangling-role dead-end where Confirm is blocked
  // and the field to fix isn't on screen). Deep-link only — no in-place editing here.
  const _editTypeBtn = document.getElementById('btn-edit-doctype');
  if (_editTypeBtn) {
    _editTypeBtn.style.display = isAdmin ? '' : 'none';
    // Open Settings → Document Types focused on the CURRENTLY-selected type (if one is), so the
    // operator lands on the fields/roles they were looking at — not the first type in the list.
    _editTypeBtn.onclick = () => window.docusnap.openSettingsWindowAtSection(
      selectedTypeSlug ? { section: 'doctypes', docTypeSlug: selectedTypeSlug } : 'doctypes');
  }
  updateEditTypeBtn();
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  allDocTypes   = await window.docusnap.getAllDocTypes();
  ensureValidationPatterns();   // fire-and-forget; ready well before any field blur
  fieldDefs     = allDocTypes.length ? allDocTypes[0].fields : [];
  populateTypeDropdown();
  updateTabCounts();
  renderQueueList();
  if (queue.length > 0 && !queueGrouped) selectDoc(queue[0]);   // grouped starts all-collapsed; user picks a group
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
    bar.innerHTML = `<span class="acb-dismiss" title="Dismiss this notice" aria-label="Dismiss">×</span>`
      + `<b>✓ ${_autoFiledDocs.length}</b> document${_autoFiledDocs.length === 1 ? '' : 's'} auto-committed on the last pass — `
      + `<span class="acb-back">click here to review them</span>`;
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

document.getElementById('auto-committed-bar')?.addEventListener('click', async (e) => {
  // "×" dismiss: clear the recent-auto-filed batch so this notice stays gone until the
  // NEXT auto-file pass repopulates it (clearRecentAutoFiled resets the rolling setting).
  if (e.target.closest('.acb-dismiss')) {
    e.stopPropagation();
    try { await window.docusnap.clearRecentAutoFiled?.(); } catch {}
    _autoFiledDocs = [];
    const bar = document.getElementById('auto-committed-bar');
    if (bar) bar.style.display = 'none';
    return;
  }
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

// The admin "Edit type" shortcut is only meaningful with a type selected — it opens
// Settings -> Document Types to edit the current type's fields/roles (e.g. to fix a
// dangling Reference/Date role that is blocking Confirm). Enabled state tracks the
// dropdown selection.
function updateEditTypeBtn() {
  const b = document.getElementById('btn-edit-doctype');
  if (b) b.disabled = !selectedTypeSlug;
}

// Generic Document chip: one click = pick the General Document type via the normal
// change path (field list updates, staged teaching rules apply — no side channel).
window.__genericFallbackOn = false;
(async () => {
  try { window.__genericFallbackOn = (await window.docusnap.getSetting('generic_fallback_enabled')) === 'true'; }
  catch { /* stays false — chip hidden */ }
})();
document.getElementById('generic-chip')?.addEventListener('click', () => {
  const sel = document.getElementById('doctype-select');
  sel.value = 'general_document';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('generic-chip').style.display = 'none';
});

document.getElementById('doctype-select').addEventListener('change', (e) => {
  if (e.target.value === NEW_TYPE_SENTINEL) {
    e.target.value = selectedTypeSlug || '';   // revert — the sentinel never becomes a chosen type
    openNewTypeModal();
    return;
  }
  const prevSlug = selectedTypeSlug;
  selectedTypeSlug = e.target.value || null;
  updateEditTypeBtn();
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
  _refreshTaughtForType();   // dots are type-scoped — re-query for the newly-chosen type
});

// ── Create-a-new-type modal (in-page; reuses the shared DocTypeEditor) ─────────
// Launched from the "+ New type" header button OR the "＋ Create new type…" dropdown
// entry. No new window / no new IPC: the editor commits via createDocTypeWithFields and
// returns the new type, which we splice into the dropdown and auto-select for this doc.
let _newTypeModalOpen = false;
let _catalogPickerOpen = false;   // catalog picker stacked OVER the new-type modal; gates its Esc handler
let _catalogOpening   = false;    // set SYNCHRONOUSLY on launch so a double-click can't stack two pickers
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
  // Secondary launcher for the ready-made preset catalog — pushed to the far left of the footer.
  const catalogBtn = document.createElement('button'); catalogBtn.className = 'btn';
  catalogBtn.textContent = '📋 Choose from catalog'; catalogBtn.style.marginRight = 'auto';

  const close = () => {
    if (closed) return; closed = true; _newTypeModalOpen = false;
    _catalogPickerOpen = false;   // defensive: can't happen today (catalog covers this modal), but a future
                                  // refactor that closed this under the catalog would otherwise strand the flag
    document.removeEventListener('keydown', onKey, true);
    try { ctl && ctl.destroy(); } catch {}
    ov.remove();
  };
  // While the catalog picker is stacked on top, Esc must close only IT (its own handler), not this
  // modal — both listen on document, and stopPropagation doesn't stop same-target listeners.
  const onKey = (e) => { if (e.key === 'Escape' && !committing && !_catalogPickerOpen) { e.stopPropagation(); close(); } };

  // Attach the overlay BEFORE mounting the editor, so it renders into a host that's in
  // the document (Teach/Settings mount it attached; a detached host can break render).
  footer.append(catalogBtn, cancel, create);
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
  catalogBtn.addEventListener('click', () => {
    if (committing) return;
    openTypeCatalogModal(async (addedSlug) => {
      // A preset was added: close this modal, refresh the dropdown, and auto-select the new type
      // for the current doc (same tail as the manual create path above).
      close();
      try { allDocTypes = await window.docusnap.getAllDocTypes(); } catch {}
      populateTypeDropdown();
      if (addedSlug) {
        const sel = document.getElementById('doctype-select');
        if (sel) { sel.value = addedSlug; sel.dispatchEvent(new Event('change')); }
        const t = (allDocTypes || []).find(d => d.slug === addedSlug);
        if (t) showNewTypeNudge(t);
      }
    });
  });
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
  requestAnimationFrame(() => {
    const inp = host.querySelector('input, select');
    if (!inp) return;
    inp.focus();
    // Programmatic focus bypasses the text-field pointerdown chokepoint that normally triggers the
    // page-focus repair, so on a desynced page (e.g. just after a Confirm/native dialog) the modal
    // shows a caret but keystrokes don't route ("caret but no text input"). Arm + run the repair
    // edge, then re-assert the caret past the cross-process transition — the proven pattern used for
    // the reconcile input (~line 2731). The edge is the gated blurWebView→wc.focus restore, safe here.
    try {
      window.docusnap.markFocusSuspect?.();
      window.docusnap.ensureWindowFocus?.();
      window.repairModalInputFocus?.(inp);
    } catch {}
  });
}

// Catalog picker STACKED over the new-type modal: tick a shipped preset type, add it (fields +
// labels seeded), then hand its slug back so the caller can select it for the current doc. Mirrors
// Settings' openCatalogModal + this file's own modal conventions. `onAdded(firstNewSlug)` fires on
// a successful add. No new IPC — reuses get-doctype-catalog / add-doctype-presets (admin-gated).
async function openTypeCatalogModal(onAdded) {
  // _catalogOpening is set SYNCHRONOUSLY (before the await) so a double-click can't pass the guard
  // twice and stack two overlays; _catalogPickerOpen is set only once the overlay exists, so the
  // parent modal's Esc stays live during the (brief) catalog LOAD. Restore focus to the launcher on
  // a cancel/Esc close so the re-exposed editor isn't left caret-less (the app's focus history).
  if (_catalogPickerOpen || _catalogOpening || !isAdmin) return;
  _catalogOpening = true;
  const returnFocus = document.activeElement;
  let catalog;
  try { catalog = await window.docusnap.getDoctypeCatalog(); }
  catch (e) { _catalogOpening = false; _newTypeToast('Could not load the catalog: ' + (e && e.message || e)); return; }
  if (!Array.isArray(catalog) || !catalog.length) { _catalogOpening = false; _newTypeToast('The catalog is empty.'); return; }
  _catalogPickerOpen = true; _catalogOpening = false;

  const rows = catalog.map((p) => {
    const fieldList = (p.fields || []).map(f => escHtml(f.label)).join(', ');
    const tag = p.already_present
      ? '<span style="font-size:10px; color:var(--ok); border:1px solid var(--ok); border-radius:999px; padding:1px 7px;">Already added</span>'
      : '';
    return `
      <label style="display:flex; gap:10px; align-items:flex-start; padding:8px 6px; border-radius:8px; cursor:pointer;">
        <input type="checkbox" data-slug="${escHtml(p.slug)}" ${p.already_present ? 'checked disabled' : ''} style="margin-top:3px;">
        <div style="flex:1;">
          <div style="font-size:12px; font-weight:500;">${escHtml(p.name)} ${tag}</div>
          <div style="font-size:11px; color:var(--muted); line-height:1.5;">${fieldList}</div>
        </div>
      </label>`;
  }).join('');

  const ov = document.createElement('div');
  ov.setAttribute('data-help-ignore', '');
  Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: '100001', padding: '24px' });   // above the 99999 modal
  const box = document.createElement('div');
  Object.assign(box.style, { width: 'min(480px,94vw)', maxHeight: '84vh', display: 'flex', flexDirection: 'column',
    gap: '12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px',
    padding: '18px', boxShadow: '0 18px 50px rgba(0,0,0,.5)', color: 'var(--text)' });
  box.innerHTML = `
    <div style="font-size:14px; font-weight:600;">Add a document type from the catalog</div>
    <div style="font-size:11px; color:var(--muted); line-height:1.6;">Tick the type this document is —
      it's added with its fields and likely labels, then selected here.</div>
    <div id="rev-cat-rows" style="overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:4px; flex:1; min-height:120px;">${rows}</div>
    <div id="rev-cat-err" style="display:none; font-size:11px; color:var(--err);"></div>
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="rev-cat-cancel" class="btn">Cancel</button>
      <button id="rev-cat-add" class="btn" style="background:var(--accent); border-color:var(--accent); color:var(--bg); font-weight:500;">Add selected</button>
    </div>`;
  ov.append(box);
  document.body.append(ov);

  let done = false, adding = false;
  const closeCat = () => {
    if (done) return; done = true; _catalogPickerOpen = false;
    document.removeEventListener('keydown', onCatKey, true);
    ov.remove();
    // restore focus to whatever launched the picker (the catalog button); on the SUCCESS path that
    // button is inside the now-closing parent modal, so re-check contains() and no-op if it's gone.
    if (returnFocus) requestAnimationFrame(() => { if (document.contains(returnFocus)) { try { returnFocus.focus(); } catch {} } });
  };
  // Ignore Esc / backdrop / Cancel WHILE the add IPC is in flight, so an accidental dismiss can't
  // race the resolved success into an unexpected auto-add+select (mirrors the parent's `committing`).
  const onCatKey = (e) => { if (e.key === 'Escape' && !adding) { e.stopImmediatePropagation(); closeCat(); } };
  document.addEventListener('keydown', onCatKey, true);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !adding) closeCat(); });
  box.querySelector('#rev-cat-cancel').addEventListener('click', () => { if (!adding) closeCat(); });

  box.querySelector('#rev-cat-add').addEventListener('click', async () => {
    if (adding) return;
    const slugs = Array.from(box.querySelectorAll('input[type=checkbox]:checked:not(:disabled)'))
      .map(cb => cb.getAttribute('data-slug'));
    if (!slugs.length) { closeCat(); return; }
    const btn = box.querySelector('#rev-cat-add'); adding = true; btn.disabled = true; btn.textContent = 'Adding…';
    let res; try { res = await window.docusnap.addDoctypePresets(slugs); }
    catch (e) { res = { success: false, error: e && e.message }; }
    if (res && res.success) { adding = false; closeCat(); if (typeof onAdded === 'function') onAdded(slugs[0]); }
    else {
      adding = false; btn.disabled = false; btn.textContent = 'Add selected';   // inline (a toast would sit behind this overlay)
      const err = box.querySelector('#rev-cat-err');
      err.textContent = 'Could not add types: ' + ((res && res.error) || 'unknown error'); err.style.display = '';
    }
  });

  requestAnimationFrame(() => { const f = box.querySelector('input:not([disabled]), button'); if (f) f.focus(); });
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
      const open = expandedSuppliers.has(g.supplier);
      const head = document.createElement('div');
      head.className = 'queue-group-head' + (open ? ' open' : '');
      const attn = g.need ? ` · <span class="qgh-attn">${g.need} need${g.need > 1 ? '' : 's'} a look</span>` : '';
      head.innerHTML = `<span class="qgh-caret" aria-hidden="true"></span>`
                     + `<span class="qgh-name" title="${escHtml(g.supplier)}">${escHtml(g.supplier)}</span>`
                     + `<span class="qgh-meta">${g.docs.length} document${g.docs.length > 1 ? 's' : ''}${attn}</span>`;
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.addEventListener('click', () => {
        if (expandedSuppliers.has(g.supplier)) expandedSuppliers.delete(g.supplier);
        else expandedSuppliers.add(g.supplier);
        renderQueueList();
      });
      list.appendChild(head);
      if (open) for (const doc of g.docs) list.appendChild(buildQueueItem(doc));
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
  // STABLE within a review session: order by HAS-attention (a boolean that only flips
  // when a group's LAST flagged doc clears) rather than the raw count, which would
  // reshuffle the list on every confirm. Then biggest batch first, then name.
  entries.sort((a, b) => (b.need > 0) - (a.need > 0) || b.docs.length - a.docs.length || a.supplier.localeCompare(b.supplier));
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
  // HONEST BADGE: a flagged / un-fileable doc must NOT wear a reassuring "100%" — the overall
  // score ignores the flagged field (e.g. a branding-conflict issuer capped at 69), so a bare
  // "100%" contradicts the warning beside it. For the orange (mid) state show the review word,
  // not the number; genuinely-low (red) keeps its honest number; clean (green) is unchanged.
  const confBadge = conf == null ? '' :
    sev === 'mid'
      ? `<span class="conf-badge mid" style="flex-shrink:0;" title="${sevWord} — overall ${conf}%, but a field needs a look">Check</span>`
      : `<span class="conf-badge ${sev}" style="flex-shrink:0;" title="${sevWord} — ${conf}% confidence">${conf}%</span>`;
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
  // Grouped mode: make sure the doc's sender group is EXPANDED before we select — the
  // active-row highlight is toggled on the rendered element (_selectDoc), so a doc in a
  // collapsed group would have no row to light up. Covers confirm-advance / keyboard nav
  // stepping into the next group.
  if (queueGrouped && doc) {
    const key = (doc.supplier_name || '').trim() || '—';
    if (!expandedSuppliers.has(key)) { expandedSuppliers.add(key); renderQueueList(); }
  }
  try { await _selectDoc(doc, opts); } catch(err) {
    console.error('selectDoc failed:', err);
    showToast('Error loading doc: ' + err.message, 'err');
  }
  // Keep the prev/next rail in sync with the new position and ensure the chosen
  // item is visible (matters when cycling to an off-screen document).
  updateDocNavButtons();
  scrollActiveItemIntoView();
  updateReprocessSupplierButton();   // relabel the per-sender reprocess for this doc's supplier
}
// fieldsOnly: bulk "File All Ready" needs only the field VALUES + readiness, so
// it skips the PDF→PNG preview render (the dominant per-doc cost) and the
// display-only template recheck. Single-document review passes nothing → full path.
async function _selectDoc(doc, { fieldsOnly = false } = {}) {
  _clearPreviewState();
  cancelZoneMode();
  try { closeResolveOverlay(); } catch {}   // never leave a ⑂ Resolve popup open across a doc switch
  currentDoc  = doc;
  currentPage = 0;
  corrections = {};
  anchorTaughtFields = new Set();
  pendingAnchors = {};   // discard any un-confirmed ⊕ teach when the doc changes
  taughtFieldKeys = new Set();   // re-fetched for the new doc's scope before renderFields
  pendingFieldRules = {}; // ...and any un-confirmed field cleanup rule
  // Straighten default FOLLOWS the session toggle; deskewByPage MUST still reset per doc ({} is
  // page-indexed). RELIES ON this reset + renderPage() being the SOLE deskew-fetch trigger (Oracle
  // C2 / eric): if a future change ever renders a page off that path or reuses deskewByPage across
  // docs, the session flag would leak a stale straightened frame.
  deskewEnabled = deskewSessionOn; deskewByPage = {}; deskewPageAngle = 0; updateDeskewBtn();
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
  // Print button — PDFs only, and only when the printing feature is on (Print-Slice 1).
  { const pb = document.getElementById('btn-print-doc'); if (pb) pb.style.display = (isPdf && _printAvailable) ? '' : 'none'; }

  // Set doc type dropdown
  selectedTypeSlug = doc.type_slug || null;
  const sel = document.getElementById('doctype-select');
  sel.value = selectedTypeSlug || '';
  updateEditTypeBtn();
  // Generic Document chip (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §6): a one-click
  // "file it as General" affordance for docs that arrived with NO type — shown only when
  // the fallback feature is on and the General Document type exists (pre-enable backlog
  // docs and any doc the operator prefers to hand-route).
  const _genericChip = document.getElementById('generic-chip');
  if (_genericChip) {
    _genericChip.style.display =
      (!selectedTypeSlug && window.__genericFallbackOn && allDocTypes.some(t => t.slug === 'general_document'))
        ? '' : 'none';
  }
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
  // Which of this supplier+type's fields already have a learned anchor — drives the per-field
  // "position taught" dot. Best-effort + doc-guarded so a slow query can't dot the wrong doc.
  taughtFieldKeys = new Set();
  try {
    const _tk = await window.docusnap.getTaughtFieldKeys?.({
      supplier_name: currentDoc?.supplier_name, document_type: selectedTypeSlug });
    if (currentDoc?.id === doc.id) for (const r of (_tk || [])) taughtFieldKeys.add(r.field_key);
  } catch {}
  // LIVE suppression of the STALE type-mismatch note. The engine plants "the heading names a type
  // that doesn't match this supplier's saved layout" when the supplier had no saved template of the
  // detected type AT PROCESSING TIME. Once ONE doc of that type is confirmed for the supplier, the
  // type is valid for them and that (already-stored) note is out of date — so strip it on load before
  // rendering, so it neither displays nor counts toward "needs a quick check". The engine already
  // self-heals on the next import (a template of the type now exists); this clears docs processed
  // BEFORE the confirm without a reprocess. Best-effort + doc-guarded (a slow query can't clobber a
  // newer doc); only removes THIS note, never a value.
  try {
    const _exs = renderedDoc.extractions || [];
    const _STALE_TYPE_NOTE = /doesn't match this supplier's saved layout/i;
    if (_exs.some(e => e.validation_note && _STALE_TYPE_NOTE.test(e.validation_note))
        && currentDoc?.supplier_name && selectedTypeSlug) {
      const _n = await window.docusnap.scopeConfirmedCount?.({
        supplier_name: currentDoc.supplier_name, document_type_slug: selectedTypeSlug });
      if (currentDoc?.id === doc.id && (_n || 0) > 0) {
        for (const e of _exs) {
          if (e.validation_note && _STALE_TYPE_NOTE.test(e.validation_note)) e.validation_note = null;
        }
      }
    }
  } catch {}
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
  // DESKEW takes precedence over the raw/preview source when it's ON, this page is skewed and its
  // straightened render is already cached (synchronous swap = no flash on revisit). The Template
  // Wizard always draws on the RAW page (its coord math isn't deskew-aware), so deskew is suppressed
  // while the wizard is active. A per-page angle of 0 means "show raw" (page already level).
  const _canDeskew = deskewEnabled && !wizard.active;
  const _dsk = _canDeskew ? deskewByPage[currentPage] : null;
  deskewPageAngle = (_dsk && _dsk.uri) ? _dsk.angle : 0;
  docImg.src = (_dsk && _dsk.uri)
    ? _dsk.uri
    : (previewActive && previewCache.has(currentPage))
      ? previewCache.get(currentPage)
      : pageImages[currentPage];
  indicator.textContent = `Page ${currentPage + 1} / ${pageImages.length}`;
  if (_canDeskew && deskewByPage[currentPage] === undefined) applyDeskewToCurrentPage();  // not yet fetched
  updateDeskewBtn();
}

document.getElementById('btn-page-prev').addEventListener('click', () => {
  if (currentPage > 0) { cancelZoneMode(); currentPage--; renderPage(); if (previewActive) refreshPreviewNow(); }
});
document.getElementById('btn-page-next').addEventListener('click', () => {
  if (currentPage < pageImages.length - 1) { cancelZoneMode(); currentPage++; renderPage(); if (previewActive) refreshPreviewNow(); }
});

// ── Deskew (straighten a tilted scan for accurate ⊕ box drawing) ─────────────────
// Fetch (once, cached) the straightened render of the current page and swap it in. Guarded
// against doc/page changes racing the async OCR, exactly like the OCR-preview refresh.
// `minAngle` = the floor sent to the backend detector; SESSION auto-straighten uses deskewMinAngle,
// the per-doc BUTTON uses DESKEW_HARD_FLOOR (so it can catch a tilt the session floor skips). `manual`
// = an explicit per-doc request → toast "already straight" when nothing is above the floor; a session
// auto pass stays silent (no toast on every below-floor doc opened).
async function applyDeskewToCurrentPage(minAngle = deskewMinAngle, manual = false) {
  if (!deskewEnabled || wizard.active || !pageImages || !pageImages.length) return;
  const page = currentPage, docId = currentDoc?.id;
  if (deskewByPage[page] !== undefined) return;   // already fetched (or in flight — set below)
  deskewByPage[page] = null;                       // in-flight marker (renderPage treats null uri as "no swap yet")
  let entry = { angle: 0, uri: null };
  try {
    const src = String(pageImages[page] || '');
    const b64 = src.includes(',') ? src.split(',')[1] : src;
    const res = await window.docusnap.getPageDeskew?.(b64, minAngle);
    if (res && res.image && res.angle) entry = { angle: res.angle, uri: `data:image/png;base64,${res.image}` };
  } catch (e) {
    console.warn('deskew failed:', e.message);
  }
  if (currentDoc?.id !== docId) return;            // doc changed while OCR ran — drop (state was reset)
  deskewByPage[page] = entry;
  if (deskewEnabled && !wizard.active && currentPage === page) {
    if (entry.uri) renderPage();                              // swap the now-cached straightened image in (renderPage refreshes the button)
    else if (manual) { showToast('This page already looks straight.', 'ok'); updateDeskewBtn(); }   // explicit request, nothing to do
    else updateDeskewBtn();                                   // session auto-straighten: silently show raw (no per-doc toast on every below-floor doc)
  } else updateDeskewBtn();
}

// The per-doc Straighten BUTTON. It acts on the SHOWN frame, not the session intent, so it keeps
// working while session straighten is on: a page currently shown STRAIGHTENED reverts to raw; a page
// shown RAW (session off, OR session on but this page fell below the session floor) is straightened
// at the hard 0.2° floor. deskewEnabled tracks the shown state (drives the reprocess READ); this never
// writes the session flag (Oracle C2 — only the rail apply/off handlers do).
async function toggleDeskew() {
  if (!pageImages || !pageImages.length) { showToast('Open a document first', 'warn'); return; }
  if (wizard.active) { showToast('Close the Template Wizard to straighten the page', 'warn'); return; }
  const shownStraightened = deskewEnabled && !!deskewPageAngle;
  if (shownStraightened) {                 // currently straightened → revert to raw
    deskewEnabled = false; deskewPageAngle = 0; renderPage();
    return;
  }
  // Shown raw → force-straighten THIS page at the hard floor (below the session floor if need be).
  deskewEnabled = true;
  delete deskewByPage[currentPage];        // drop any below-session-floor "angle 0" cache so we re-read at the hard floor
  await applyDeskewToCurrentPage(DESKEW_HARD_FLOOR, true);
}

// Reflect the ACTUAL shown frame in the toolbar button. "Straightened" means this page was really
// rotated (a non-zero applied angle) — NOT merely that straighten mode is on. So a below-threshold
// doc under session straighten reads "Straighten" (honest) and the button still works to straighten it.
function updateDeskewBtn() {
  const btn = document.getElementById('btn-deskew');
  const lbl = document.getElementById('deskew-angle');
  if (!btn) return;
  const straightened = deskewEnabled && !wizard.active && !!deskewPageAngle;
  btn.classList.toggle('active', straightened);
  btn.innerHTML = straightened ? '&#8734; Straightened' : '&#8734; Straighten';
  if (lbl) lbl.textContent = straightened ? `${deskewPageAngle > 0 ? '+' : ''}${deskewPageAngle.toFixed(1)}°` : '';
}

// SESSION straighten (rail button `#btn-deskew-all` → `#deskew-all-bar` flyout). The flyout carries the
// minimum-angle input; "Turn on"/"Update" applies it. deskewSessionOn + deskewMinAngle are PERSISTED
// ONLY in applyDeskewSession/turnOffDeskewSession (the ONLY writers of review_deskew_* — Oracle C2), so
// the per-doc `#btn-deskew` and openWizard can't silently change the session default.
function openDeskewAllFlyout() {
  const bar = document.getElementById('deskew-all-bar');
  if (!bar) return;
  const showing = bar.style.display === 'block';
  bar.style.display = showing ? 'none' : 'block';
  if (!showing) {   // opening → sync the input + button labels to the live state
    const inp = document.getElementById('deskew-min-input');
    if (inp) inp.value = String(deskewMinAngle);
    const off   = document.getElementById('btn-deskew-all-off');
    const apply = document.getElementById('btn-deskew-all-apply');
    if (off)   off.style.display = deskewSessionOn ? '' : 'none';
    if (apply) apply.textContent = deskewSessionOn ? 'Update' : 'Turn on';
  }
}
function _readDeskewMinInput() {
  const inp = document.getElementById('deskew-min-input');
  const v = inp ? parseFloat(inp.value) : NaN;
  return Number.isFinite(v) ? Math.max(0.2, Math.min(5.0, v)) : 1.0;   // clamp [0.2, 5.0] (server re-clamps too)
}
function applyDeskewSession() {
  deskewMinAngle  = _readDeskewMinInput();
  deskewSessionOn = true;
  localStorage.setItem('review_deskew_min_angle', String(deskewMinAngle));
  localStorage.setItem('review_deskew_session', 'true');
  const bar = document.getElementById('deskew-all-bar'); if (bar) bar.style.display = 'none';
  updateDeskewAllBtn();
  if (wizard.active) return;   // wizard draws on the raw page — the flag applies from the next doc
  deskewByPage = {};           // re-evaluate the current page against the new floor
  if (pageImages && pageImages.length) { deskewEnabled = true; applyDeskewToCurrentPage(); updateDeskewBtn(); }
}
function turnOffDeskewSession() {
  deskewSessionOn = false;
  localStorage.setItem('review_deskew_session', 'false');
  const bar = document.getElementById('deskew-all-bar'); if (bar) bar.style.display = 'none';
  updateDeskewAllBtn();
  if (!wizard.active && deskewEnabled) { deskewEnabled = false; deskewPageAngle = 0; renderPage(); updateDeskewBtn(); }
}

// Reflect the session toggle on the rail button (shared `.open` pressed style, like split/advanced).
function updateDeskewAllBtn() {
  const b = document.getElementById('btn-deskew-all');
  if (b) b.classList.toggle('open', deskewSessionOn);
}

// Snapshot the deskew frame the operator is drawing on — taken SYNCHRONOUSLY before any OCR await,
// so it records the frame the box was actually drawn against. `_deskewFixPending` back-transforms
// with THIS frame's angle and drops the teach if the live frame no longer matches it (Oracle C1).
function _captureDeskewSnap() {
  return { angle: deskewPageAngle, docId: currentDoc?.id, page: currentPage,
           W: docImg.naturalWidth, H: docImg.naturalHeight };
}

// Rotate a just-staged anchor's coords from the STRAIGHTENED display frame back to the RAW page
// frame extraction reads, using the frame SNAPSHOT taken when the box was drawn (`snap`). No-op
// when deskew was off at draw AND is off now (staged coords byte-identical to pre-deskew).
//
// FRAME-CONSISTENCY (Oracle C1 — the load-bearing safety): the value box + the label strips were
// captured on the snapshot frame, so the back-transform is ONLY valid against that frame. Between
// the draw and here there are OCR awaits; if the displayed frame changed in that window — Straighten
// toggled, page/doc navigated, or an async src-swap left the image undecoded — the staged coords and
// the strip-read label belong to a different frame. NEVER persist a straightened coord as raw: drop
// the staged teach and tell the operator to redraw (fail toward NO anchor + a visible reason, never
// a silent wrong authoritative anchor). The value point AND the label point (value − offset) are
// transformed independently then the offset recomputed in the raw frame (a page-centre rotation
// can't be applied to a normalised offset directly — x,y scale by W,H differently). page_zone is
// re-derived from the raw y. w_norm/h_norm (a coarse crop zone) are left as-is (007-A deferred).
function _deskewFixPending(fieldKey, snap) {
  const a = pendingAnchors[fieldKey];
  if (!a) return;
  // Fast path — deskew never involved (drawn raw AND still raw): byte-identical, no dependency.
  if (!(snap && snap.angle) && !deskewPageAngle) return;
  const live = { angle: deskewPageAngle, docId: currentDoc?.id, page: currentPage,
                 W: docImg.naturalWidth, H: docImg.naturalHeight };
  const d = window.AnchorLabel?.deskewFinalizeAnchor?.(a, snap, live);
  if (d && d.action === 'keep') return;
  if (d && d.action === 'transform') {
    a.x_norm = d.x; a.y_norm = d.y; a.page_zone = d.page_zone;
    if (d.offset_dx != null) { a.offset_dx_norm = d.offset_dx; a.offset_dy_norm = d.offset_dy; }
    return;
  }
  // 'drop' — or the helper is unavailable while deskew IS involved. Never persist a straightened
  // coord as raw: discard the staged teach and tell the operator to redraw (Oracle C1).
  delete pendingAnchors[fieldKey];
  anchorTaughtFields.delete(fieldKey);
  hideAnchorReadout();
  try { showToast('Straighten changed while reading — please draw the box again.', 'warn'); } catch {}
}

// ── Print (option a, owner-directed 2026-07-18) ─────────────────────────────────
// A custom modal (the owner liked the preview) carrying the options Electron's silent
// print genuinely honours — printer / copies / duplex / colour / range / pages-per-sheet
// (N-up). "Print" = silent:true to the CHOSEN device (its saved driver preferences +
// these overrides). "Full printer dialog…" = silent:false → the printer's OWN dialog,
// the ONLY place for BOOKLET / trays / stapling / quality (the driver owns those; Electron
// exposes no way to load them back into this modal — eric). The REAL vector PDF spools;
// the preview images never print. NOTE: the preview pane INSIDE the Windows dialog shows
// "This app doesn't support print preview" — a hard Electron platform limitation.
let _printAvailable = false;
(async () => { try { _printAvailable = await window.docusnap.printAvailable?.(); } catch { _printAvailable = false; } })();

// Parse a 1-based "1-3, 5" range into Electron 0-based pageRanges [{from,to}]. Empty/All ⇒ null.
function _parsePageRanges(text, pageCount) {
  const s = String(text || '').trim();
  if (!s) return null;
  const out = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/) || part.trim().match(/^(\d+)$/);
    if (!m) continue;
    let a = parseInt(m[1], 10), b = parseInt(m[2] || m[1], 10);
    if (isNaN(a) || isNaN(b)) continue;
    a = Math.max(1, a); b = Math.min(pageCount || b, Math.max(a, b));
    out.push({ from: a - 1, to: b - 1 });
  }
  return out.length ? out : null;
}

const _printModal = document.getElementById('print-modal');
function _closePrintModal() { if (_printModal) _printModal.style.display = 'none'; }

async function _openPrintModal() {
  if (!currentDoc?.id || !_printModal) return;
  const msg = document.getElementById('print-modal-msg');
  if (msg) msg.textContent = '';
  // Preview pane: the page images we already rendered for this doc.
  const pane = document.getElementById('print-preview-pane');
  if (pane) {
    pane.innerHTML = '';
    if (pageImages && pageImages.length) {
      pageImages.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src; img.alt = `Page ${i + 1}`;
        img.style.cssText = 'max-width:100%; box-shadow:0 2px 10px rgba(0,0,0,.2); background:#fff;';
        pane.appendChild(img);
      });
    } else {
      const d = document.createElement('div');
      d.style.cssText = 'color:var(--muted); font-size:12px; padding:24px;';
      d.textContent = 'Preview unavailable — you can still print the document.';
      pane.appendChild(d);
    }
  }
  // Printer list.
  const sel = document.getElementById('print-printer');
  if (sel) {
    sel.innerHTML = '<option>Loading printers…</option>';
    try {
      const printers = await window.docusnap.listPrinters?.() || [];
      sel.innerHTML = '';
      if (!printers.length) { sel.innerHTML = '<option value="">(no printers found)</option>'; }
      for (const p of printers) {
        const o = document.createElement('option');
        o.value = p.name; o.textContent = p.displayName || p.name;
        if (p.isDefault) o.selected = true;
        sel.appendChild(o);
      }
    } catch { sel.innerHTML = '<option value="">(couldn\'t list printers)</option>'; }
  }
  _printModal.style.display = 'flex';
}

// silent=true  → quick print to the chosen device with the modal's options.
// silent=false → the printer's own full dialog (booklet/trays/quality live there).
async function _doModalPrint(silent) {
  const msg = document.getElementById('print-modal-msg');
  const go = document.getElementById('print-modal-go');
  const dlg = document.getElementById('print-modal-dialog');
  const deviceName = document.getElementById('print-printer')?.value || undefined;
  // Safety invariant (eric): a silent print MUST target an explicit device — never let it
  // fall through to a silent spool on the default printer. No printer picked ⇒ steer to the
  // full dialog instead of quietly printing somewhere unexpected.
  if (silent && !deviceName) {
    if (msg) msg.textContent = 'Choose a printer above, or use the full printer dialog.';
    return;
  }
  if (go) go.disabled = true; if (dlg) dlg.disabled = true;
  if (msg) msg.textContent = silent ? 'Sending to printer…' : 'Opening your printer’s dialog…';
  const copies = parseInt(document.getElementById('print-copies')?.value, 10) || 1;
  const pagesMode = document.getElementById('print-pages-mode')?.value;
  const pageRanges = pagesMode === 'range'
    ? _parsePageRanges(document.getElementById('print-pages-range')?.value, pageImages.length) : null;
  const duplexMode = document.getElementById('print-duplex')?.value || undefined;
  const colorVal = document.getElementById('print-color')?.value;
  const color = colorVal === '' ? undefined : (colorVal === 'true');
  const pagesPerSheet = parseInt(document.getElementById('print-nup')?.value, 10) || 1;
  try {
    const res = await window.docusnap.printDocument({
      docId: currentDoc.id, source: 'original', silent,
      deviceName, copies, pageRanges, duplexMode, color, pagesPerSheet,
    });
    if (res && res.ok) { _closePrintModal(); showToast?.('Sent to your printer.'); }
    else if (res && res.outcome === 'cancelled') { if (msg) msg.textContent = 'Cancelled.'; }
    else if (res && res.reason === 'file_missing') { if (msg) msg.textContent = "Couldn't find this document's file."; }
    else if (res && res.reason === 'disabled') { if (msg) msg.textContent = 'Printing is turned off in Settings.'; }
    else { if (msg) msg.textContent = "Couldn't print this document."; }
  } catch { if (msg) msg.textContent = "Couldn't print this document."; }
  if (go) go.disabled = false; if (dlg) dlg.disabled = false;
}

document.getElementById('btn-print-doc')?.addEventListener('click', _openPrintModal);
document.getElementById('print-modal-close')?.addEventListener('click', _closePrintModal);
document.getElementById('print-modal-go')?.addEventListener('click', () => _doModalPrint(true));
document.getElementById('print-modal-dialog')?.addEventListener('click', () => _doModalPrint(false));
document.getElementById('print-pages-mode')?.addEventListener('change', (e) => {
  const r = document.getElementById('print-pages-range');
  if (r) r.style.display = e.target.value === 'range' ? '' : 'none';
});
_printModal?.addEventListener('click', (e) => { if (e.target === _printModal) _closePrintModal(); });

document.getElementById('btn-deskew')?.addEventListener('click', toggleDeskew);
document.getElementById('btn-deskew-all')?.addEventListener('click', openDeskewAllFlyout);
document.getElementById('btn-deskew-all-apply')?.addEventListener('click', applyDeskewSession);
document.getElementById('btn-deskew-all-off')?.addEventListener('click', turnOffDeskewSession);
updateDeskewAllBtn();   // reflect the persisted session-straighten state on load

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
  const knownN    = baseMethods.filter(m => m && m !== 'unknown').length;

  let extLabel, extCls;
  if (knownN === 0)                              { extLabel = 'Unknown';          extCls = 'muted'; }
  else if (mappingN > 0 && mappingN >= Math.max(anchorN, keywordN)) {
                                                   extLabel = 'Template mappings'; extCls = 'ok'; }
  else if (anchorN > 0 && anchorN >= keywordN)  { extLabel = 'Learned anchors';   extCls = 'info'; }
  else if (keywordN > 0)                         { extLabel = 'Keyword patterns';  extCls = 'info'; }
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
// OCR date pre-clean — TWIN of validator._date_preclean (python_backend/extraction/validator.py);
// keep the three aligned (this + filing/handler.js). Rejoin an OCR-split number ("1 5" -> "15",
// "2 0 2 6" -> "2026") without touching a digit/letter boundary ("15 Jun" stays), then collapse
// whitespace around date separators. Lookbehind is zero-width + REQUIRED (a /(\d)\s+(\d)/ replace
// consumes the trailing digit and misses the next split space); V8 (Electron 31) supports it.
// A month NAME lets a space legitimately separate a day from a year ("Aug 3 2024"), where the
// digit-join would wrongly fuse "3 2024" -> "32024" — so gate the join on the ABSENCE of a month
// name (numeric dates never contain a month token).
function _datePreclean(text) {
  let s = String(text);
  if (!/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) {
    s = s.replace(/(?<=\d)\s+(?=\d)/g, '');   // numeric-only: "1 5/06/2026" -> "15/06/2026"
  }
  return s
    .replace(/\s*([/.\-])\s*/g, '$1')         // "16 / 03 / 2026" -> "16/03/2026"
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function _parseDrawnDate(raw, order) {
  // Preclean (rejoin split digits) then edge-trim a leading "Date:" label + edge punctuation, so a
  // drawn box that captured a bit of the caption or a stray char still parses instead of surfacing
  // raw junk via normalizeDrawnValue's `|| text`. The colon requirement means a month-first date
  // ("Jun 15 2026") is never mistaken for a label; the non-alnum strips never touch a leading day
  // digit or a trailing year digit. The strict ^…$ matchers + their day/month gates stay unchanged.
  const t = _datePreclean(raw)
    .replace(/^[A-Za-z][A-Za-z ]*?:\s*/, '')   // drop a leading "Date:" / "Invoice Date:" label (colon required)
    .replace(/^[^0-9A-Za-z]+/, '')             // leading "(", "#", …
    .replace(/[^0-9A-Za-z]+$/, '');            // trailing ".", ")", …
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
  _renderDocSnippet(doc);
  if (!doc) { validateConfirm(); return; }

  const extMap = {};
  for (const e of (doc.extractions || [])) extMap[e.field_key] = e;

  for (const key of reviewFields()) {
    const ext = extMap[key] || {};
    const val = ext.display_value ?? ext.raw_value ?? '';
    appendFieldRow(scroll, key, val, ext.confidence ?? null, ext.validation_note || null, ext.corrected_to || null, ext.anchor_label || null, ext.extraction_method || null, ext.candidates || null, ext.suggested_supplier || null);
  }
  _prefillGenericScanDate(doc, scroll);
  validateConfirm();
  updateAcknowledgeButton();
  updateTotalsVerifiedBadge();
}

// ── Generic Document glance aids (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §4/§6) ────
// Provenance strip + 2-line ocr_text snippet for generic/untyped docs — client-side only.
function _renderDocSnippet(doc) {
  const box = document.getElementById('doc-snippet');
  if (!box) return;
  const strip = box.querySelector('.snippet-strip');
  const body  = box.querySelector('.snippet-text');
  const generic = selectedTypeSlug === 'general_document';
  const untyped = !selectedTypeSlug;
  if (!doc || !(generic || untyped) || !doc.ocr_text) { box.hidden = true; return; }
  if (strip) {
    strip.hidden = !generic;
    if (generic) strip.textContent = "ScanFinder didn't recognise this document, so it's set to file as a "
      + 'General Document — change the type above if that\'s wrong.';
  }
  if (body) body.textContent = String(doc.ocr_text).replace(/\s+/g, ' ').trim().slice(0, 260);
  box.hidden = false;
}

// Scan-date PREFILL (owner Q4: prefill-with-provenance): a General Document that read no
// date gets the LOCAL import date pre-filled and recorded as a correction — it flows
// through the normal confirm → normaliseDate path, zero new IPC. Review-time only, so it
// is human-gated by construction (auto-file eligibility was decided at import). The
// cosmetic UTC→local conversion is deliberate: an overnight off-by-one must be visible
// and editable, never silent.
function _prefillGenericScanDate(doc, scroll) {
  if (selectedTypeSlug !== 'general_document' || !doc || !doc.processed_at) return;
  const gdt = allDocTypes.find(t => t.slug === 'general_document');
  const dateKey = (gdt && gdt.date_field_key) || 'date';
  const inp = scroll.querySelector(`.field-input[data-key="${dateKey}"]`);
  if (!inp || String(inp.value || '').trim()) return;
  const d = new Date(String(doc.processed_at).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return;
  const pad = (n) => String(n).padStart(2, '0');
  inp.value = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  corrections[dateKey] = { original_value: '', corrected_value: inp.value };
  const row = inp.closest('.field-row');
  if (row && !row.querySelector('.scan-date-note')) {
    const note = document.createElement('div');
    note.className = 'field-note scan-date-note';
    note.textContent = 'Scan date — edit if the document shows its own date.';
    Object.assign(note.style, { fontSize: '11px', color: 'var(--muted)', marginTop: '3px' });
    row.appendChild(note);
  }
}

// ── Per-field "position taught" dot ────────────────────────────────────────────
// A field is "taught" when a learned anchor exists for the current supplier+doc-type scope (SAVED,
// from get-taught-field-keys) OR one is staged this session (a ⊕ teach not yet confirmed).
function _fieldIsTaught(key) { return taughtFieldKeys.has(key) || !!pendingAnchors[key]; }
function _taughtDotTitle(taught) {
  return taught
    ? 'Taught — a learned position is saved for this field on this supplier + document type'
    : 'Not taught for this document type yet — click ⊕ to teach it (a position taught on a different type doesn’t apply here)';
}
// Re-fetch the taught-field set for the CURRENT supplier + selected type and repaint every dot.
// The dots are TYPE-scoped, so changing the document type must re-query — a field taught on the
// OLD type must not stay green under the new one (and vice-versa). Doc-guarded against races.
// The LIVE Document-Issuer value: the current (possibly operator-edited) issuer input, else the
// stored supplier. The taught dots are (supplier + type)-scoped, so a correction to the issuer must
// re-scope them to the NEW supplier — reading the input keeps them honest the moment it changes.
function _currentIssuerValue() {
  const inp = document.querySelector('#fields-scroll .field-input[data-key="supplier_name"]');
  const live = inp ? (inp.value || '').trim() : '';
  return live || (currentDoc?.supplier_name || '');
}

// Debounced taught-dot re-query for an ISSUER edit (a re-key fires many input events). A NEW/untaught
// issuer -> dots go off (honest "not learned for this supplier yet"); an existing issuer with taught
// fields for this type -> they light. Mirrors the type-change re-query.
let _issuerTaughtTimer = null;
function _scheduleTaughtRefreshForIssuer() {
  clearTimeout(_issuerTaughtTimer);
  _issuerTaughtTimer = setTimeout(() => { _refreshTaughtForType().catch(() => {}); }, 300);
}

// A field VALUE read from a supplier-SCOPED learned source (a taught anchor, a template mapping /
// fixed value, or a supplier hint) is INVALID once the issuer is corrected to a DIFFERENT supplier —
// that position/mapping/value belonged to the previous supplier. Keyword/pattern reads and typed
// (manual) values are supplier-INDEPENDENT and are kept. (Owner's "clear only suspect reads" choice.)
function _isSupplierScopedRead(method) {
  const m = String(method || '');
  return /^anchor/.test(m) || /^template/.test(m) || m === 'hint' || m === 'late_rescue';
}
// After the issuer settles on a different supplier, clear the suspect (old-supplier-scoped) reads so
// they aren't mistaken for valid values. Fires only on a settled change (⊕ teach / blur), never
// mid-type. No-op when the issuer is unchanged/blank. The issuer field itself is never cleared.
function _clearSuspectReadsForNewIssuer() {
  const issuer = _currentIssuerValue().trim();
  const orig   = (currentDoc?.supplier_name || '').trim();
  if (!issuer || issuer.toLowerCase() === orig.toLowerCase()) return;   // unchanged / same supplier
  let cleared = 0;
  document.querySelectorAll('#fields-scroll .field-input[data-key]').forEach(input => {
    const key = input.dataset.key;
    if (key === 'supplier_name') return;                          // never the issuer being corrected
    if (!input.value.trim()) return;                              // already empty
    if (!_isSupplierScopedRead(input.dataset.method)) return;     // keyword / manual / logo -> keep
    const o = input.dataset.original;
    input.value = '';
    input.classList.remove('corrected');
    corrections[key] = { original_value: o, corrected_value: '' };   // persist the clear on Confirm
    const row = input.closest('.field-row');
    if (row) { try { dismissServerNote(row, key); } catch {} try { clearFieldWarning(row, input); } catch {} }
    cleared++;
  });
  if (cleared) { validateConfirm(); try { showToast(`Cleared ${cleared} field${cleared > 1 ? 's' : ''} that were read from the previous supplier — teach them for ${issuer}.`, 'ok'); } catch {} }
}

async function _refreshTaughtForType() {
  const forDoc = currentDoc?.id;
  taughtFieldKeys = new Set();
  try {
    // Live issuer value (not currentDoc.supplier_name) so an operator's issuer CORRECTION re-scopes
    // the dots to the new supplier — a new supplier has no learned positions, so the dots go off.
    const _tk = await window.docusnap.getTaughtFieldKeys?.({
      supplier_name: _currentIssuerValue(), document_type: selectedTypeSlug });
    if (currentDoc?.id !== forDoc) return;
    for (const r of (_tk || [])) taughtFieldKeys.add(r.field_key);
  } catch {}
  if (currentDoc?.id !== forDoc) return;
  document.querySelectorAll('#fields-scroll .taught-dot[data-key]').forEach(dot => _refreshTaughtDot(dot.dataset.key));
}

// Flip one field's dot live after a ⊕ teach stages or is C1-dropped (no full re-render).
function _refreshTaughtDot(key) {
  const dot = document.querySelector(`.taught-dot[data-key="${key}"]`);
  if (!dot) return;
  const taught = _fieldIsTaught(key);
  dot.classList.toggle('on', taught);
  dot.title = _taughtDotTitle(taught);
}

function appendFieldRow(scroll, key, val, conf, note, correctedTo, anchorLabel, method, candidates, suggestedSupplier) {
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
  // "This name is correct" — for a NAME field flagged by the wordness/truncation signal
  // (a legitimate acronym-bearing company like "Cloud VPS" reads low on the character
  // model). One click marks the exact value as an accepted name so the flag never fires
  // for it again (on this or any future document); see accept-name-value IPC.
  const isNameFlag = !!note && !isApplied && _isNameLikeField(key)
    && /read like a name|not a name|document heading|truncat|cut off/i.test(note);
  const nameAcceptHtml = isNameFlag
    ? ` <button type="button" class="name-accept-btn" data-key="${key}" title="Tell Scan Finder this really is a valid name, so it stops flagging it for review on future documents">✓ This name is correct</button>`
    : '';
  // "Issuer is correct" — for the identity field when the identity-CONFLICT flag fired (the
  // letterhead reads a different known name than the resolved issuer, e.g. a customer/printer
  // name in the header). One click marks the resolved supplier as a valid issuer so the conflict
  // flag never fires for it again — the explicit complement to the automatic "established after a
  // few confirmations" fallback. Only on the identity field; see accept-issuer IPC.
  const isIssuerFlag = !!note && !isApplied
    && key === 'supplier_name'          // RC2 (2026-07-10): identity = supplier_name ONLY; customer_name is a recipient
    && /letterhead may read|confirm the issuer/i.test(note);
  const issuerAcceptHtml = isIssuerFlag
    ? ` <button type="button" class="issuer-accept-btn" data-key="${key}" title="Confirm this really is the correct issuer, so Scan Finder stops flagging it — even though a different name appears in the letterhead. Applies to future documents from this issuer too.">✓ Issuer is correct</button>`
    : '';
  // "Use '<name>'" — the branding cross-check DETECTED the true issuer (the page branding reads a
  // different known name than the resolved supplier). One click accepts the detected name for the
  // Document Issuer — it fills the value (persisted on Confirm, like a typed correction). The regex is
  // DISJOINT from the issuer-accept regex above, so the two buttons can never double-render on one note.
  const isBrandingFlag = !!note && !isApplied
    && key === 'supplier_name' && !!suggestedSupplier
    && /page branding reads|confirm the correct company/i.test(note);
  const brandingResolveHtml = isBrandingFlag
    ? ` <button type="button" class="branding-resolve-btn" data-key="${key}" data-name="${escHtml(suggestedSupplier)}" title="Set the Document Issuer to the company the letterhead reads. Saved when you confirm this document.">Use “${escHtml(suggestedSupplier)}”</button>`
    : '';
  // "⑂ Resolve" — when the engine emitted >=2 distinct candidate readings for a flagged NAME field,
  // offer a one-click picker (openResolveOverlay) instead of leaving the operator to retype. v1 scope:
  // name-like fields only (the backend already excludes supplier_name + non-name fields).
  const resolvable = Array.isArray(candidates) && candidates.filter(c => c && c.value).length >= 2 && _isNameLikeField(key);
  const resolveHtml = resolvable
    ? ` <button type="button" class="resolve-btn" data-key="${key}" title="See the readings the app found and click the correct one"><svg class="resolve-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h5M9 12l9-6M18 6h-4M18 6v4M9 12l9 6M18 18h-4M18 18v-4"/></svg>Resolve</button>`
    : '';
  const noteHtml = isApplied
    ? `<div class="field-note corrected"><span class="corrected-badge" title="An OCR misread was auto-corrected to the spelling that recurs in your confirmed data">✓ auto-corrected</span> ${escHtml(note || '')}</div>`
    : (note || correctedTo)
      ? `<div class="field-note">${escHtml(note || '')}${acceptHtml}${nameAcceptHtml}${issuerAcceptHtml}${brandingResolveHtml}${resolveHtml}</div>`
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
  const _issuerHint = (key === 'supplier_name')   // RC2: only the issuer gets the "sender" gloss; customer_name is the recipient
    ? ' title="The company the document is FROM — the sender who issued it (e.g. the supplier on an invoice). Not your own company."'
    : '';
  // The Document Issuer (supplier_name) has NO "position taught" dot: it's identified by its NAME
  // (logo / letterhead / hint / typed value), never by a taught POSITION — a positional teach only
  // applies to captioned value fields. A hidden spacer keeps the label aligned with the other rows;
  // no data-key, so the dot refresh / re-scope logic skips it entirely.
  const _dotSpan = (key === 'supplier_name')
    ? `<span class="taught-dot" style="visibility:hidden" aria-hidden="true"></span>`
    : `<span class="taught-dot ${_fieldIsTaught(key) ? 'on' : ''}" data-key="${key}" title="${escHtml(_taughtDotTitle(_fieldIsTaught(key)))}"></span>`;
  row.innerHTML = `
    <div class="field-row-header">
      ${_dotSpan}
      <span class="field-row-label" data-key="${key}"${_issuerHint}>${escHtml(labelFor(key))}</span>
      ${confLabel}
    </div>
    <div class="field-input-wrap">
      <input type="text" class="field-input ${low ? 'low-conf' : ''}"
             data-key="${key}" data-original="${escHtml(val)}" data-method="${escHtml(method || '')}"
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
    // A value the operator TYPED supersedes the machine's advisory note (wordness / format / issuer);
    // dismiss it once the value actually differs from the flagged original (trimmed — Oracle C3).
    if (input.value.trim() !== (orig || '').trim()) dismissServerNote(row, key);
    validateConfirm();
    updateTotalsVerifiedBadge();   // live-update the "mathematically verified" total badge
    // Re-scope the "position taught" dots when the ISSUER is corrected — they're (supplier + type)-
    // scoped, so a new/other supplier changes which learned positions apply (debounced re-query).
    if (key === 'supplier_name') _scheduleTaughtRefreshForIssuer();
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
    // The ISSUER settled on a (possibly new) supplier -> re-scope the taught dots and clear the
    // old-supplier-scoped reads (anchor/template/hint); keyword/typed values are kept. No-op if
    // unchanged or the same supplier.
    if (key === 'supplier_name') { _refreshTaughtForType().catch(() => {}); _clearSuspectReadsForNewIssuer(); }
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

  // "This name is correct" — persist the value to the accepted-names allowlist (so the
  // wordness flag never fires for it again) and clear the flag on this doc immediately.
  const nameAcceptBtn = row.querySelector('.name-accept-btn');
  if (nameAcceptBtn) {
    nameAcceptBtn.addEventListener('click', async () => {
      nameAcceptBtn.disabled = true;
      try {
        const res = await window.docusnap.acceptNameValue({
          docId: currentDoc?.id, fieldKey: key, value: input.value,
        });
        if (res && res.ok) {
          nameAcceptBtn.textContent = "✓ Saved — won't flag this again";
          const noteEl = row.querySelector('.field-note');
          if (noteEl) noteEl.remove();
          clearFieldWarning(row);
          // Drop this field from the in-memory review-reason DISPLAY tally (renderReviewReason) so it
          // doesn't re-list on a later re-render. Does NOT change Confirm-gating or auto-file
          // eligibility — those read the server review_flag_count, not these in-memory notes (Oracle C6).
          const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
          if (ex) ex.validation_note = null;
          validateConfirm();
        } else {
          nameAcceptBtn.disabled = false;
        }
      } catch { nameAcceptBtn.disabled = false; }
    });
  }

  // "Issuer is correct" — persist the resolved supplier to the accepted-issuers allowlist (so the
  // identity-conflict flag never fires for it again) and clear the flag on this doc immediately.
  const issuerAcceptBtn = row.querySelector('.issuer-accept-btn');
  if (issuerAcceptBtn) {
    issuerAcceptBtn.addEventListener('click', async () => {
      issuerAcceptBtn.disabled = true;
      try {
        const res = await window.docusnap.acceptIssuer({
          docId: currentDoc?.id, fieldKey: key, value: input.value,
        });
        if (res && res.ok) {
          issuerAcceptBtn.textContent = "✓ Saved — won't flag this issuer again";
          const noteEl = row.querySelector('.field-note');
          if (noteEl) noteEl.remove();
          clearFieldWarning(row);
          // Drop the identity-conflict flag from the in-memory review-reason DISPLAY tally so it
          // doesn't re-list on a later re-render. Does NOT change Confirm-gating or auto-file
          // eligibility — those read the server review_flag_count, not these in-memory notes (Oracle C6).
          const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
          if (ex) ex.validation_note = null;
          validateConfirm();
        } else {
          issuerAcceptBtn.disabled = false;
        }
      } catch { issuerAcceptBtn.disabled = false; }
    });
  }

  // "⑂ Resolve" — open the disambiguation picker for this field's candidate readings.
  const resolveBtn = row.querySelector('.resolve-btn');
  if (resolveBtn) {
    resolveBtn.addEventListener('click', () => openResolveOverlay(key, candidates, row, input));
  }

  // "Use '<name>'" — accept the branding-detected issuer. (A) Fills the value via the SAME path as the
  // customer picker / Accept (synthetic 'input' → corrections + validateConfirm + the issuer-changed
  // hooks) and clears the branding note in-memory (DOM only — Oracle C6, never touches the server
  // review_flag_count, so it can't file). No page box → no position teach. Persists on Confirm.
  // (B) Writes the per-doc supplier PIN so a REPROCESS forces this supplier instead of reverting to the
  // coarse-logo pick. The pin is local to the doc, cleared on confirm; the engine keeps it review-bound.
  const brandingBtn = row.querySelector('.branding-resolve-btn');
  if (brandingBtn) {
    brandingBtn.addEventListener('click', async () => {
      const name = brandingBtn.dataset.name || '';
      if (!name) return;
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const noteEl = row.querySelector('.field-note');
      if (noteEl) noteEl.remove();
      clearFieldWarning(row);
      const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
      if (ex) ex.validation_note = null;
      validateConfirm();
      // Best-effort: the value fill above already sticks on Confirm even if this pin write fails.
      try { await window.docusnap.resolveIssuer?.({ docId: currentDoc?.id, value: name }); } catch {}
    });
  }

  scroll.appendChild(row);
}

// ── Disambiguation picker (⑂ Resolve) ─────────────────────────────────────────
// An in-page popup (NOT a child window — Oracle/eric) showing the RAW page with the
// candidate readings marked ①②③ + a clickable list. Click → fill the value + (if the
// candidate carries a page box) stage a position-only anchor so this sender's next doc
// reads from there. A pick NEVER files — the operator still presses Confirm.
let _resolveEscHandler = null;

function _ensureResolveStyles() {
  if (document.getElementById('resolve-styles')) return;
  const s = document.createElement('style');
  s.id = 'resolve-styles';
  s.textContent = `
    #resolve-overlay { position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center; }
    #resolve-overlay .resolve-panel { background:var(--surface,#fff); color:var(--text,#1b1f2a);
      border:1px solid var(--border2,#d2d8e4); border-radius:var(--r,12px); width:min(1080px,94vw);
      max-height:92vh; display:flex; overflow:hidden; box-shadow:0 14px 50px rgba(0,0,0,.45); }
    #resolve-overlay .resolve-doc { flex:1 1 58%; background:var(--doc-bg,#eef1f7); overflow:auto;
      display:flex; align-items:flex-start; justify-content:center; padding:12px; }
    #resolve-overlay .rd-wrap { position:relative; }
    #resolve-overlay .rd-img { max-width:100%; display:block; }
    #resolve-overlay .rd-canvas { position:absolute; left:0; top:0; pointer-events:none; }
    #resolve-overlay .resolve-side { flex:0 0 42%; max-width:430px; padding:16px 20px 18px; display:flex;
      flex-direction:column; gap:9px; overflow:auto; }
    #resolve-overlay .rs-close { align-self:flex-end; background:none; border:none; font-size:24px;
      line-height:1; cursor:pointer; color:var(--muted,#69728a); padding:0 4px; }
    #resolve-overlay .resolve-side h3 { margin:0; font-size:16px; }
    #resolve-overlay .rs-sub { color:var(--muted,#69728a); font-size:13px; margin-bottom:4px; }
    #resolve-overlay .resolve-cand { display:flex; gap:10px; align-items:flex-start; text-align:left;
      width:100%; padding:11px 12px; border:1px solid var(--border2,#d2d8e4); border-radius:var(--r-sm,9px);
      background:var(--surface2,#eef1f7); cursor:pointer; font:inherit; color:inherit; }
    #resolve-overlay .resolve-cand:hover, #resolve-overlay .resolve-cand:focus-visible {
      border-color:var(--accent,#3b7df0); background:var(--accent-bg,#e7f0ff); outline:none; }
    #resolve-overlay .rc-num { flex:0 0 auto; width:22px; height:22px; border-radius:50%;
      background:var(--accent,#3b7df0); color:var(--on-accent,#fff); display:flex; align-items:center;
      justify-content:center; font-weight:700; font-size:13px; }
    #resolve-overlay .rc-val { font-weight:600; word-break:break-word; }
    #resolve-overlay .rc-src { color:var(--muted,#69728a); font-size:12px; }
    #resolve-overlay .rs-foot { color:var(--muted,#69728a); font-size:12px; margin-top:auto; }
  `;
  document.head.appendChild(s);
}

function closeResolveOverlay() {
  const ov = document.getElementById('resolve-overlay');
  if (ov) ov.remove();
  if (_resolveEscHandler) { document.removeEventListener('keydown', _resolveEscHandler); _resolveEscHandler = null; }
}

function openResolveOverlay(key, candidates, row, input) {
  _ensureResolveStyles();
  closeResolveOverlay();
  const openDocId = currentDoc?.id;
  const cands = (candidates || []).filter(c => c && c.value).slice(0, 3);
  if (cands.length < 2) return;
  const pageSrc = pageImages[currentPage];
  const fieldLabel = (typeof labelFor === 'function' ? labelFor(key) : null) || key;

  const ov = document.createElement('div');
  ov.id = 'resolve-overlay';
  ov.setAttribute('data-help-ignore', '');   // help-mode must not swallow the pick clicks
  ov.innerHTML = `
    <div class="resolve-panel">
      <div class="resolve-doc"><div class="rd-wrap">
        ${pageSrc ? '<img class="rd-img" alt="">' : '<div class="rs-sub" style="padding:24px">Preview unavailable — pick from the list.</div>'}
        <canvas class="rd-canvas"></canvas>
      </div></div>
      <div class="resolve-side">
        <button class="rs-close" title="Close">×</button>
        <h3>Which is correct?</h3>
        <div class="rs-sub">Two different readings were found for “${escHtml(fieldLabel)}”. Click the right one — the ① markers show where each was read on the page.</div>
        <div class="rs-list"></div>
        <div class="rs-foot">Picking fills the field and, where a spot is marked, remembers it for this sender. You still press Confirm to file.</div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const img = ov.querySelector('.rd-img');
  const canvas = ov.querySelector('.rd-canvas');
  const drawMarkers = () => {
    if (!img || !canvas || !img.clientWidth) return;
    canvas.width = img.clientWidth; canvas.height = img.clientHeight;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    cands.forEach((c, i) => {
      const b = c.box; if (!b) return;   // no page box (e.g. a keyword read in v1) → list-only
      const x = b.x_norm * canvas.width, y = b.y_norm * canvas.height;
      ctx.strokeStyle = '#3b7df0'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, b.w_norm * canvas.width, b.h_norm * canvas.height);
      ctx.fillStyle = '#3b7df0'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
  };
  if (img) { img.onload = drawMarkers; img.src = pageSrc; if (img.complete) drawMarkers(); }

  const list = ov.querySelector('.rs-list');
  cands.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'resolve-cand';
    b.innerHTML = `<span class="rc-num">${i + 1}</span><span><span class="rc-val">${escHtml(c.value)}</span><br>` +
      `<span class="rc-src">${escHtml(c.source_label || 'read from the page')}${c.box ? '' : ' · position not marked'}</span></span>`;
    b.addEventListener('click', () => {
      if (currentDoc?.id !== openDocId) { closeResolveOverlay(); return; }   // doc switched under the overlay — abort
      resolveCandidatePick(key, c, row, input);
      closeResolveOverlay();
    });
    list.appendChild(b);
  });

  ov.querySelector('.rs-close').addEventListener('click', closeResolveOverlay);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeResolveOverlay(); });   // scrim click
  _resolveEscHandler = (e) => { if (e.key === 'Escape') closeResolveOverlay(); };
  document.addEventListener('keydown', _resolveEscHandler);
  requestAnimationFrame(() => ov.querySelector('.rs-close')?.focus());
}

function resolveCandidatePick(key, cand, row, input) {
  // (a) fill the value — same path as the Accept button (flows through corrections + validateConfirm).
  if (input) {
    input.value = cand.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // (b) teach the position — ONLY when the candidate carries a page box. Direct position-only stage
  // (Oracle: NOT captureAnchorContext, whose label-OCR reads the possibly-DESKEWED preview and would
  // mis-register). The contract box is TOP-LEFT; field_anchors stores CENTRE → convert ONCE here.
  const centre = (typeof PickBox !== 'undefined') ? PickBox.pickBoxToAnchorCentre(cand.box) : null;
  if (centre) {
    const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
    const liveSupplier = supplierInput?.value?.trim() || currentDoc?.supplier_name;
    pendingAnchors[key] = {
      supplier_name: cleanSupplierName(liveSupplier),
      document_type: currentDoc?.type_slug || currentDoc?.document_type_slug || null,
      field_key:     key,
      page_zone:     centre.y_norm < 0.33 ? 'top' : centre.y_norm < 0.66 ? 'middle' : 'bottom',
      x_norm: centre.x_norm, y_norm: centre.y_norm, w_norm: centre.w_norm, h_norm: centre.h_norm,
      authoritative: true,
      anchor_label:  '',        // position-only sentinel (no label OCR — frame-safe)
      direction:     'right',
    };
    try { anchorTaughtFields.add(key); _refreshTaughtDot(key); } catch {}
  }
  // (c) clear the flag in-memory (DOM only — the SERVER review_flag_count still gates auto-file, so a
  // pick can never itself file; Oracle C6). Mirrors the accept-btn note dismissal.
  const noteEl = row?.querySelector('.field-note');
  if (noteEl) noteEl.remove();
  if (row) clearFieldWarning(row);
  const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
  if (ex) ex.validation_note = null;
  try { validateConfirm(); } catch {}
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
  // Identity = supplier_name ONLY (RC2 unlink, 2026-07-10). customer_name is now an ordinary optional
  // RECIPIENT field — do NOT re-add it here or the recipient re-couples to the issuer (it would mirror
  // the issuer + teach position-only, the exact bug RC2 fixed). Pinned by test_focus_repair.js's sibling
  // structural pins / the RC2 tests.
  const ISSUER_KEYS = ['supplier_name'];
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
    if (issuerKey && selectedTypeSlug === 'general_document') {
      // Generic Document: a blank issuer is DESIGNED, not a failure — calm-informational.
      issuerNote.textContent = 'No Document Issuer — that\'s fine for a General Document; it will be '
        + 'filed under “General”. Add the sender above if you want the app to learn it.';
      Object.assign(issuerNote.style, { display: '', color: 'var(--muted)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    } else if (issuerKey) {
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
  for (const key of ['supplier_name']) {   // RC2: identity = supplier_name only
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
  hideAnchorReadout();   // starting a new teach clears any previous field's readout
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
    const deskewSnap = _captureDeskewSnap();   // the frame the box is drawn on (Oracle C1 — checked at commit)
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
        // The operator supplied this value by DRAWING — clear the stale extraction advisory note,
        // then re-validate the NEW value exactly as the blur handler does (a bad structured value
        // still re-flags). Gated on an actual change; before the focus block so the DOM is settled.
        // NOT a synthetic 'input' event (that would pop the type-ahead datalist — reggie). Oracle C5.
        const _row = input.closest('.field-row');
        if (_row && input.value.trim() !== (orig || '').trim()) {
          dismissServerNote(_row, fieldKey);
          const _msg = fieldValidationError(fieldKey, input.value);
          if (_msg) setFieldWarning(_row, input, _msg); else clearFieldWarning(_row, input);
        }
        // FOCUS (eric, 2026-07-10): the hidden Python OCR spawn during the await above
        // desyncs the render widget's keyboard focus (page-focus false while the window
        // still claims focus), so the user's next click into this field gets NO caret and
        // the click's own repair races the transition and loses. Cure the desync HERE,
        // deterministically: focus the input SYNCHRONOUSLY (so it's the activeElement when
        // the main-side page-focus edge runs → the caret lands on the input, not <body>),
        // drive that edge proactively (blurWebView→wc.focus; no OS activation, <select>
        // untouched), then re-assert the caret past the cross-process transition with the
        // double-rAF belt. Additive — the pointerdown repair stays as the fallback.
        try {
          input.focus();
          window.docusnap.markFocusSuspect?.();   // arm suspect so the proactive edge does the real blurWebView (the pageHasFocus OR-fallback was removed — focusRepair.js)
          window.docusnap.ensureWindowFocus?.();
          window.repairModalInputFocus?.(input);
        } catch {}
      }
      // TALL-BOX teach method: the drawn box read 2+ lines, so this value WRAPS — auto-stage a
      // multiline_continue rule (silent) for free-text/name-like fields, so future wrapping
      // scans are joined. The right-click "This field can wrap" toggle is the explicit alternative.
      if (boxes && boxes.lines >= 2 && _isNameLikeField(fieldKey)) {
        _stageMultilineRule(fieldKey, { silent: true });
        try { showToast('Looks like this value wraps onto the next line — wrapping enabled, saved on Confirm.', 'ok'); } catch {}
      }
      lastTeachCtx = { fieldKey, rect, imgW, imgH, scaleX, scaleY, value: text, deskewSnap };
      const detected = await captureAnchorContext(rect, fieldKey, text, imgW, imgH, scaleX, scaleY, null, deskewSnap);
      if (detected) {
        anchorTaughtFields.add(fieldKey);
        // The Document Issuer (company/supplier name) is usually a top-corner logo/letterhead
        // with NO caption beside it, so the auto-label search only reads garbled logo/noise to its
        // left. Don't keep that as a LOCATED label (it's meaningless and could mis-locate on a
        // future doc) — downgrade to a clean position-only anchor, and skip the garbled readout.
        // The value correction still feeds learning; the supplier is identified by its logo /
        // keywords too. Reusable for every supplier/layout (not a one-document rule).
        if (fieldKey === 'supplier_name') {   // RC2: only the ISSUER is a logo/position-only field; customer_name teaches like a normal captioned field
          if (pendingAnchors[fieldKey]) {
            // POSITION-ONLY means an EMPTY label (Oracle-signed, 2026-07-10) — staging the
            // field's DISPLAY NAME ("Document Issuer") here manufactured a PHANTOM label:
            // the page never prints it, so the anchor engine treated the read as a
            // teaching artifact and silently dropped it on every doc — the user's issuer
            // teach never fired ("SO #" kept winning). '' is the real positional sentinel
            // (saveAnchor precedent); offsets are label-relative, so clear them too.
            pendingAnchors[fieldKey].anchor_label   = '';
            pendingAnchors[fieldKey].label_detected = false;
            pendingAnchors[fieldKey].offset_dx_norm = null;
            pendingAnchors[fieldKey].offset_dy_norm = null;
          }
          try { showToast('Captured the ' + (labelFor(fieldKey) || 'company name') + ' position from this layout.', 'ok'); } catch {}
        } else {
          showAnchorReadout(detected, text);   // show which anchor was picked + the Left/Above toggle
        }
      }
      _refreshTaughtDot(fieldKey);   // reflect the staged (or C1-dropped) teach on the field's dot
      // If the ISSUER was just taught, its value IS the resolved supplier for this doc — re-scope
      // EVERY field's taught dot to the new supplier (a new/untaught supplier -> the other fields'
      // dots go off). A DIRECT re-query, not the datalist-popping synthetic 'input' avoided above.
      if (fieldKey === 'supplier_name') { _refreshTaughtForType().catch(() => {}); _clearSuspectReadsForNewIssuer(); }
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

// nearestLeftCluster / extractLabel / sanitizeAnchorLabel / labelLooksSuspicious now live in the
// SHARED module src/windows/shared/anchorLabel.js (loaded before this script) so the Teach wizard
// uses the exact same label-quality logic — they can no longer diverge. Thin delegates keep the
// existing call sites unchanged.
function nearestLeftCluster(words) { return window.AnchorLabel.nearestLeftCluster(words); }
function nearestAboveRow(words) { return window.AnchorLabel.nearestAboveRow(words); }
function nearestRowTo(words, centreY) { return window.AnchorLabel.nearestRowTo(words, centreY); }
function pickLabelCandidate(leftLabel, aboveLabel, fieldCaptions) { return window.AnchorLabel.pickLabelCandidate(leftLabel, aboveLabel, fieldCaptions); }

// The located label's box as page-normalised [x,y,w,h] (top-left), for the
// "show the detected anchor" overlay. Same crop-origin math as labelOffsetFromBox.
function labelNormBox(box, originDX, originDY, imgW, imgH) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const nW = docImg.naturalWidth || imgW, nH = docImg.naturalHeight || imgH;
  if (!nW || !nH || !imgW || !imgH) return null;
  return [(originDX / imgW) + (box[0] / nW), (originDY / imgH) + (box[1] / nH),
          box[2] / nW, box[3] / nH];
}

async function captureAnchorContext(rect, fieldKey, value, imgW, imgH, scaleX, scaleY, forceDir = null, deskewSnap = null) {
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
  // to the left only, 'below' = label above only; null = auto (D1: capture BOTH, then pick).
  // D1 (2026-07-11): capture the left AND above captions, THEN pick via pickLabelCandidate — no
  // left-first EARLY RETURN (which let a garbled left strip 'esha, i' beat a clean 'Customer'
  // above). The field-scoped caption bank = this field's display label (NOT a global bank, which
  // would let a neighbouring row's caption outscore the true left one — Oracle).
  const fieldCaptions = [];
  try { const _fl = (typeof labelFor === 'function') ? labelFor(fieldKey) : null; if (_fl) fieldCaptions.push(_fl); } catch {}
  // Draw-tool UX Slice 2b: read the LEFT and ABOVE captions CONCURRENTLY. They're independent (each
  // yields its own candidate; neither needs the other or the value text), so the two OCR round-trips
  // OVERLAP instead of running back-to-back — one fewer read of wall-clock per draw. Each is wrapped
  // in a self-guarded closure returning its candidate (or null); the per-strip logic is unchanged.
  const _readLeftCand = async () => {
   if (forceDir === 'below') return null;
   try {
    const leftPad    = rect.x;   // full span from the page's left edge to the value box
    // VERTICAL EXPANSION (oscar+007, 2026-07-10): the strip was exactly rect.h tall at the
    // VALUE's y, so a bolder/slightly-higher caption ("SO #") had its ascenders DECAPITATED
    // → OCR garble ('sok') → no label → position-only anchor. Centre-expand to 1.8× the box
    // height (0.4h above + below, page-clamped); nearestRowTo below then keeps only the row
    // nearest the value's centre, so a neighbouring row can't hijack the column pick.
    const lVPad      = Math.round(rect.h * 0.4);
    const lTop       = Math.max(0, rect.y - lVPad);
    const lH         = Math.min(imgH - lTop, rect.h + 2 * lVPad);
    const leftCanvas = document.createElement('canvas');
    leftCanvas.width  = Math.round(leftPad * scaleX);
    leftCanvas.height = Math.round(lH * scaleY);
    if (leftCanvas.width > 10 && leftCanvas.height > 10) {
      const lCtx = leftCanvas.getContext('2d');
      lCtx.drawImage(
        docImg,
        Math.round((rect.x - leftPad) * scaleX), Math.round(lTop * scaleY),
        leftCanvas.width, leftCanvas.height,
        0, 0, leftCanvas.width, leftCanvas.height
      );
      const leftB64   = leftCanvas.toDataURL('image/png').split(',')[1];
      const leftRes   = await window.docusnap.ocrRegionBoxes?.(leftB64);
      // Row nearest the VALUE's centre first (crop px space), THEN the column nearest the
      // value — a wide key/value row OCRs as "label1 …gap… label2" and the far-left caption
      // must not be glued onto the real adjacent one. Falls back to the full strip when word
      // boxes aren't available (legacy region.py output).
      const lRowWords = nearestRowTo(leftRes && leftRes.words,
                                     (rect.y + rect.h / 2 - lTop) * scaleY);
      const cluster   = nearestLeftCluster(lRowWords || (leftRes && leftRes.words));
      const leftText  = (cluster ? cluster.text
                          : ((leftRes && leftRes.text) || (await window.docusnap.ocrRegion(leftB64)) || '')).trim();
      const leftBox   = cluster ? cluster.box : (leftRes && leftRes.box);
      const leftLabel = sanitizeAnchorLabel(extractLabel(leftText) || '');
      if (leftLabel) {
        // Drift-invariant offset: the located label's page position → value centre.
        // Origin of the left crop in DISPLAY px is (rect.x - leftPad, lTop).
        const off = labelOffsetFromBox(leftBox, rect.x - leftPad, lTop, xNorm, yNorm, imgW, imgH);
        return { label: leftLabel, direction: 'right', off,
                 normBox: labelNormBox(leftBox, rect.x - leftPad, lTop, imgW, imgH) };
      }
    }
    return null;
   } catch (err) {
    console.warn('Anchor capture: left-label lookup failed (non-critical):', err);
    return null;
   }
  };

  const _readAboveCand = async () => {
   if (forceDir === 'right') return null;
   try {
    // The strip must be TALL ENOUGH TO CONTAIN the caption line above: line spacing routinely
    // exceeds the value box's own height (a spaced address block, a section heading), so the
    // old one-line strip (max(rect.h,20)) caught only the caption's bottom pixel-tips + its
    // underline — a sliver OCR hallucinated into junk ("Site / Customer" → "eee F WS CwE ewe",
    // 2026-07-10). ~2.5 line-heights reaches a caption a full blank half-line away. The old
    // fear of a tall band — gluing the row ABOVE the caption onto it — is handled downstream:
    // nearestAboveRow keeps only the BOTTOM visual row of words (nearest the value).
    // 0.1×h BOTTOM STANDOFF (oscar, 2026-07-10): the band ends just ABOVE the drawn box, so a
    // draw whose top edge clips the value's ascenders can't leak ascender-tip junk into the
    // band's bottom rows — nearestAboveRow would prefer exactly that lowest "row" over the real
    // caption. Mirrors the teach wizard's standoff.
    const standoff    = Math.max(1, Math.round(rect.h * 0.1));
    const abovePad    = Math.max(0, Math.min(rect.y - standoff, Math.max(Math.round(rect.h * 2.5), 34)));
    const aboveTop    = rect.y - standoff - abovePad;   // crop origin (display px) — used below for offsets
    const aboveCanvas = document.createElement('canvas');
    aboveCanvas.width  = Math.round(rect.w * scaleX);
    aboveCanvas.height = Math.round(abovePad * scaleY);
    if (aboveCanvas.width > 10 && aboveCanvas.height > 10) {
      const aCtx = aboveCanvas.getContext('2d');
      aCtx.drawImage(
        docImg,
        Math.round(rect.x * scaleX), Math.round(aboveTop * scaleY),
        aboveCanvas.width, aboveCanvas.height,
        0, 0, aboveCanvas.width, aboveCanvas.height
      );
      const aboveB64   = aboveCanvas.toDataURL('image/png').split(',')[1];
      const aboveRes   = await window.docusnap.ocrRegionBoxes?.(aboveB64);
      // Keep only the BOTTOM row of words — the caption nearest the value — so the taller
      // band can't glue the row above the caption onto it. Falls back to the full strip
      // text when word boxes aren't available (legacy region.py output).
      const aboveRow   = nearestAboveRow(aboveRes && aboveRes.words);
      const aboveText  = (aboveRow ? aboveRow.text
                          : ((aboveRes && aboveRes.text) || (await window.docusnap.ocrRegion(aboveB64)) || '')).trim();
      const aboveBox   = aboveRow ? aboveRow.box : (aboveRes && aboveRes.box);
      // "A value ABOVE is not a label": sanitizeAnchorLabel strips code/serial/number
      // tokens (a MAC, an IP, a reference, a date), so the above-strip yields a label
      // ONLY when it's a real caption — never the value sitting in the row above. This
      // stops the snap latching onto the MAC above instead of the label to the left.
      const aboveLabel = sanitizeAnchorLabel(extractLabel(aboveText) || '');
      if (aboveLabel) {
        // Origin of the above crop in DISPLAY px is (rect.x, aboveTop).
        const off = labelOffsetFromBox(aboveBox, rect.x, aboveTop, xNorm, yNorm, imgW, imgH);
        return { label: aboveLabel, direction: 'below', off,
                 normBox: labelNormBox(aboveBox, rect.x, aboveTop, imgW, imgH) };
      }
    }
    return null;
   } catch (err) {
    console.warn('Anchor capture: above-label lookup failed (non-critical):', err);
    return null;
   }
  };

  // Both caption reads run CONCURRENTLY (Slice 2b): the two OCR round-trips OVERLAP instead of
  // back-to-back. Independent, self-guarded → order-free; the pick logic below is unchanged.
  const [leftCand, aboveCand] = await Promise.all([_readLeftCand(), _readAboveCand()]);

  // D1 — PICK between the left and above captions. forceDir pins one side; else pickLabelCandidate
  // scores each (2 = matches this field's caption · 1 = clean · 0 = suspicious/empty), higher wins,
  // a TIE goes to LEFT (status quo), BOTH 0 → position-only (fall through to the empty-label save
  // below). This is where a clean 'Customer' above beats a garbled 'esha, i' left (the incident).
  let chosen = null;
  if (forceDir === 'right')      chosen = leftCand;
  else if (forceDir === 'below') chosen = aboveCand;
  else {
    const pick = pickLabelCandidate(leftCand ? leftCand.label : '',
                                    aboveCand ? aboveCand.label : '', fieldCaptions);
    chosen = pick.direction === 'above' ? aboveCand
           : pick.direction === 'left'  ? leftCand : null;
  }
  if (chosen) {
    // label_detected: this caption was OCR'd from the PAGE (not the field-name fallback), so the
    // backend must NOT drop it even if it equals the field key ("Make" field labelled "Make").
    pendingAnchors[fieldKey] = { ...anchorBase, anchor_label: chosen.label,
                                 direction: chosen.direction, ...chosen.off, label_detected: true };
    _deskewFixPending(fieldKey, deskewSnap);   // straighten→raw on the DRAW frame; drops the teach if the frame changed
    if (!pendingAnchors[fieldKey]) return null;   // frame changed mid-read → teach dropped, nothing to surface
    return { anchor_label: chosen.label, direction: chosen.direction, normBox: chosen.normBox };
  }

  // Guaranteed fallback — always STAGE SOMETHING so the position is learned on
  // commit even when no nearby label text could be read. The actual persistence
  // (and its admin-role / DB-error handling) happens in confirmCurrentDoc, so an
  // un-confirmed teach leaves no trace. POSITION-ONLY = EMPTY label (Oracle-signed
  // 2026-07-10): the field's display name is never printed on the page, so staging
  // it here manufactured a phantom label the anchor engine rightly distrusts.
  pendingAnchors[fieldKey] = { ...anchorBase, anchor_label: '', direction: 'right' };
  _deskewFixPending(fieldKey, deskewSnap);    // straighten→raw on the DRAW frame (no-op when deskew is off)
  if (!pendingAnchors[fieldKey]) return null;   // frame changed mid-read → teach dropped
  return { anchor_label: '', direction: 'right', normBox: null, fallback: true };
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
// The readout is transient — dismiss it the moment the operator moves on: a click into ANY value
// field (its own editable-label / direction buttons aren't .field-inputs, so they keep it open).
// Switching documents already clears it via renderPage → hideAnchorReadout.
document.addEventListener('pointerdown', (e) => {
  if (e.target?.closest?.('.field-input')) hideAnchorReadout();
}, true);
function showAnchorReadout(detected, value) {
  try { if (detected.normBox) drawTraceBbox(detected.normBox, 'anchor', 'manual'); } catch {}
  const bar = document.getElementById('anchor-readout');
  if (!bar) return;
  const val   = escHtml((value || '').trim());
  const isLeft  = detected.direction === 'right';
  const isAbove = detected.direction === 'below';
  const suspicious = !detected.fallback && labelLooksSuspicious(detected.anchor_label);
  const warn = detected.fallback || suspicious;
  // Garble verdict → never keep the misread caption staged: fall back to a POSITION-ONLY anchor
  // (empty label + registration/position relocation), the same safe fallback used for a cleared
  // label. The garble stays VISIBLE in the editable input so the operator can type the real
  // caption (the change handler re-stages a good one). So Confirm-without-fixing saves position-
  // only, never gibberish that would never re-locate. (reggie/Oracle-signed fallback, 2026-07-10)
  if (suspicious) {
    const _sfk = lastTeachCtx?.fieldKey;
    if (_sfk && pendingAnchors[_sfk]) {
      pendingAnchors[_sfk].anchor_label   = '';
      pendingAnchors[_sfk].label_detected = false;
    }
  }
  let msg;
  if (detected.fallback) {
    msg = `<span class="ar-msg">&#10003; No caption nearby — anchored by its position. This spot will be read on future documents from this supplier. Read: <span class="ar-val">${val}</span></span>`;
  } else {
    // The label is EDITABLE — an auto-detect off a noisy scan can be misread ("verial No."),
    // and a wrong label never re-locates. The operator can correct it here before Confirm.
    // GARBLE is never displayed (product rule: never ask the user to vouch for junk they
    // can't find on the page) — the input starts EMPTY (= position-only, already staged
    // below) and the message says so plainly; typing the printed caption upgrades it.
    const lead = suspicious
      ? '&#9888; Couldn&#39;t read the caption beside this value &mdash; anchored by position. Type it to anchor on text:'
      : `&#10003; Anchor (label ${isAbove ? 'above' : 'to the left'}):`;
    msg = `<span class="ar-msg">${lead} `
      + `<input class="ar-label-edit" spellcheck="false" title="The caption this field sits beside — edit if it was misread" `
      + `style="font:inherit;font-weight:600;padding:1px 5px;min-width:90px;border:1px solid var(--border2);border-radius:5px;background:var(--surface)"> `
      + `&rarr; <span class="ar-val">${val}</span></span>`;
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
  // A SUSPICIOUS (garbled) read is never shown: the input starts EMPTY — a valid state that
  // matches the position-only anchor staged above, not an error to fix — with a placeholder
  // inviting the real caption. Typing one re-stages it via the change handler below.
  const lblInput = bar.querySelector('.ar-label-edit');
  if (lblInput) {
    lblInput.value = suspicious ? '' : (detected.anchor_label || '');
    if (suspicious) lblInput.placeholder = 'caption as printed (optional)';
    lblInput.addEventListener('change', () => {
      const fk = lastTeachCtx?.fieldKey;
      const cleaned = sanitizeAnchorLabel(lblInput.value);
      if (fk && pendingAnchors[fk]) {
        // Cleared/garbage caption → POSITION-ONLY ('' — never the field's display name,
        // which the page doesn't print; Oracle-signed 2026-07-10).
        pendingAnchors[fk].anchor_label = cleaned || '';
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
    const detected = await captureAnchorContext(c.rect, c.fieldKey, c.value, c.imgW, c.imgH, c.scaleX, c.scaleY, dir, c?.deskewSnap);
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
      _deskewFixPending(fieldKey, c?.deskewSnap);   // straighten→raw on the DRAW frame (no-op when deskew is off)
      if (!pendingAnchors[fieldKey]) { _refreshTaughtDot(fieldKey); return; }   // frame changed mid-read → teach dropped
      anchorTaughtFields.add(fieldKey);
      _refreshTaughtDot(fieldKey);
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

function extractLabel(text) { return window.AnchorLabel.extractLabel(text); }

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
    const issuerKey = ['supplier_name'].find(k => k in allValues);   // RC2: identity = supplier_name only
    if (issuerKey && !(allValues[issuerKey] || '').trim()) {
      if (bulk) return { skipped: true, reason: 'issuer blank' };
      // Generic Document: blank issuer is DESIGNED (files under 'General') — no dialog in
      // single mode, or the one-keystroke promise dies on every generic doc. The inline
      // issuer note already names the consequence. Bulk stays unchanged (fails toward review).
      if (selectedTypeSlug !== 'general_document'
          && !confirm('Document Issuer is blank.\n\nThis document will be filed under "Unknown Company" and '
                 + 'the app won’t learn this sender. File it anyway?')) {
        return { cancelled: true };
      }
    }
  }

  if (!bulk) {
    // Fingerprint the logo in the BACKGROUND: capture the page image NOW (docImg is still the
    // confirmed doc), then fire the save fire-and-forget — the logo-hash Python spawn was a
    // blocking slice of the confirm pause and filing doesn't depend on it (Oracle B+). The old
    // docImg.src='' + 150ms "release the preview handle" ritual was vestigial (the preview is an
    // in-memory data URL, not a file handle; the source delete is deferred + retry-guarded), so
    // it's removed — advanceAfterAction swaps the preview to the next doc a moment later.
    const supplierForLogo = allValues.supplier_name || currentDoc?.supplier_name;
    if (supplierForLogo) {
      // Capture the RAW page image (not the possibly-straightened/enhanced docImg) so a
      // "Straighten + Reprocess" or OCR-Preview session can't write a drifted fingerprint that
      // poisons this supplier's identity for future raw imports (Oracle C1).
      const logoB64 = getRawPageBase64(currentPage);
      saveLogoOnConfirm(supplierForLogo, logoB64).catch(() => {});
    }
    selCanvas.width = 0; selCanvas.height = 0;   // clear any ⊕ selection overlay for the next doc
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
  // Advance within the VISIBLE (grouped) order, not the raw chronological queue — else
  // confirming "City Office doc 1" jumps to whatever chronological doc lands in this slot
  // instead of "City Office doc 2".
  const list = activeTab === 'deferred' ? deferredQueue : reviewDisplayOrder();
  const idx  = list.findIndex(d => d.id === currentDoc?.id);
  const supplier = (currentDoc?.supplier_name || '').trim();   // finish this sender's docs before moving on
  const r = await confirmCurrentDoc();
  if (r.cancelled) return;
  if (r.error) { showToast(r.error, 'err'); return; }
  updateTabCounts();
  advanceAfterAction(idx, supplier);
  // FOCUS (eric, 2026-07-10): Confirm & File can desync the RenderWidget's keyboard
  // focus (post-confirm teardown/rebuild of the sidebar + fields pane, snappier since
  // the detached-learning change) WITHOUT a native dialog — and the repair's
  // blurWebView transition only runs when the window is marked focus-SUSPECT (the
  // renderer's document.hasFocus() reports stale-TRUE in exactly this broken state,
  // so the pageHasFocus fallback never fires). Arm the flag after every single-doc
  // confirm: it sits inert until the operator's next TEXT-control press, then runs
  // the proven widget-level repair (never an OS activation; <select> excluded by the
  // preload, so dropdowns are untouched — the two pinned prior regressions hold).
  try { window.docusnap.markFocusSuspect?.(); } catch {}
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
  if (queue.length > 0 && !queueGrouped) selectDoc(queue[0]);   // grouped starts all-collapsed; user picks a group
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

// After Reprocess All, auto-commit any document the SHARED server-side predicate deems
// eligible (a trusted supplier's clean docs at the graduation floor, or a full-confidence doc)
// — the SAME predicate the import-batch auto-file uses, so the two paths can't diverge.
// Best-effort per doc (a failure just leaves it queued). Skips when the setting is off or a
// manual File-All is already running.
async function autoCommitFullConfidence() {
  try {
    if (bulkFiling) return;
    if ((await window.docusnap.getSetting('auto_file_full_confidence')) === 'false') return;
    // Eligibility is decided SERVER-SIDE by the shared predicate (scope graduation floor +
    // structural safety gate), the SAME one the backend import path uses — so the two auto-file
    // sites can't diverge. One IPC, getFieldFormats scanned once for the whole queue.
    let eligibleIds = new Set();
    try {
      const res = await window.docusnap.getAutoFileEligible((queue || []).map(d => d.id));
      eligibleIds = new Set((res && res.ids) || []);
    } catch { return; }
    const ready = (queue || []).filter(d => eligibleIds.has(d.id));
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
      showToast(`✓ Auto-filed ${filed} document${filed > 1 ? 's' : ''} — no review needed.`, 'ok');
      // Skip straight to the next document that still needs a look (the top of the queue), so the
      // operator isn't left on an auto-filed doc that's no longer in the list.
      if (queue.length) {
        // Some docs still need a look — jump to the top of the remaining queue if the doc
        // we were on just got filed (otherwise stay put).
        if (!currentDoc || !queue.some(d => d.id === currentDoc.id)) selectDoc(queue[0]);
      } else if (currentDoc && !queue.some(d => d.id === currentDoc.id)) {
        // Every queued doc auto-filed — the open document is now filed and gone from the
        // queue. Close it so the viewer shows the "All documents reviewed ✓" placeholder
        // instead of leaving the last filed doc on screen. (renderQueueList only clears the
        // panel when NO doc is open, to preserve intentional "view a filed doc" navigation,
        // so we must null currentDoc + clear here.)
        currentDoc = null;
        clearDocPanel();
      }
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
  if (queue.length > 0 && !queueGrouped) selectDoc(queue[0]);   // grouped starts all-collapsed; user picks a group
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
function advanceAfterAction(removedIdx = 0, preferSupplier = null) {
  const at = Math.max(0, removedIdx);
  const order = activeTab === 'deferred' ? (renderDeferredList(), deferredQueue)
                                         : (renderQueueList(), reviewDisplayOrder());
  const next = _pickNextDoc(order, at, preferSupplier);
  if (next) selectDoc(next);
  else { currentDoc = null; clearDocPanel(); }
}

// Choose the doc to open after filing/removing one. When preferSupplier is given, FINISH that
// sender's remaining docs first (the operator asked to work a sender at a time) — scan forward
// from the vacated slot, then backward — before falling back to the doc now occupying that slot
// (the prior "next in the visible order" behaviour). Works in grouped AND chronological views.
function _pickNextDoc(order, at, preferSupplier) {
  if (!order || order.length === 0) return null;
  if (preferSupplier) {
    const norm = s => (s || '').trim();
    for (let i = at; i < order.length; i++) if (norm(order[i].supplier_name) === preferSupplier) return order[i];
    for (let i = Math.min(at, order.length) - 1; i >= 0; i--) if (norm(order[i].supplier_name) === preferSupplier) return order[i];
  }
  return order[Math.min(at, order.length - 1)];
}

// ── Logo fingerprinting ───────────────────────────────────────────────────────
// The logo image is ALWAYS the RAW page render (pageImages), never the on-screen docImg — a
// deskewed (straighten) or enhanced (preview) docImg has a drifted phash that fails to match a
// known supplier and, if fingerprinted on confirm, poisons supplier identity for every future raw
// import (Oracle C1). Delegated to the pure shared/logoSource selector so it stays testable. The
// old docImg→canvas capture (getPageBase64) was removed so the leak cannot be re-introduced.
function getRawPageBase64(page = currentPage) {
  return LogoSource.rawPageBase64(pageImages, page);
}

async function attemptLogoMatch() {
  if (!docImg.complete || !docImg.naturalWidth) return;
  try {
    const b64   = getRawPageBase64(currentPage);
    if (!b64) return;
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

// b64: an optional page image captured by the caller. The OPTIMISTIC confirm path
// advances (swapping docImg) before this runs in the background, so it must pass the
// snapshot image — reading the live docImg here would fingerprint the NEXT doc against
// the previous supplier (eric R1). With no b64 we fall back to the live docImg (the
// legacy bulk/confirmCurrentDoc callers, which run before any advance).
async function saveLogoOnConfirm(supplierName, b64 = null) {
  if (!supplierName) return;
  try {
    if (!b64) {
      b64 = getRawPageBase64(currentPage);   // RAW page — never the deskewed/enhanced docImg (Oracle C1)
      if (!b64) return;
    }
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
    // (Re)load only when focusing a DIFFERENT field. Re-focusing the field the modal already shows
    // — e.g. clicking into it to fix a doc opened from that value's source-doc list — must NOT
    // reload, or it wipes the expanded doc list the operator is working through.
    if (isLhOpen() && (!_lhField || _lhField.key !== inp.dataset.key)) loadLearningHistoryFor(inp.dataset.key);
  }
});

// DIRECT Learning-History button (2026-07-15, bob): the ⚙ Advanced flyout held only "View learning
// history", so a gear (which reads as Settings) + an extra click for one action was pure friction.
// This button now opens the learning-history modal DIRECTLY (same as #btn-view-learning). The
// #advanced-bar flyout markup + its #btn-view-learning handler stay dormant (display:none), so a
// future 2nd advanced item can re-enable the flyout cheaply.
document.getElementById('btn-advanced').addEventListener('click', async (ev) => {
  try { ev.currentTarget.blur(); } catch {}   // keep Blink's page-focus flag (dead-caret guard)
  document.getElementById('advanced-bar').style.display = 'none';
  document.getElementById('lh-overlay').style.display = 'block';
  makeLhDraggable();
  if (lastFocusedFieldKey) await loadLearningHistoryFor(lastFocusedFieldKey);
  else showLearningHistoryEmpty();
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

document.getElementById('btn-view-learning').addEventListener('click', async (ev) => {
  // Blur the trigger BEFORE hiding its container: this button lives INSIDE #advanced-bar, so
  // hiding the bar removes document.activeElement with no handoff, which drops Blink's page-focus
  // flag (the Learning-History dead-caret source). A clean blur first keeps the flag intact.
  try { ev.currentTarget.blur(); } catch {}
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
  _lhAnchorPending = null;
  try {
    _lhAnchors = await window.docusnap.getAnchorsForScope(
      { supplier_name: supplier, document_type: slug, field_key: key }) || [];
  } catch { _lhAnchors = []; }
  renderLearningHistory();
  renderLearningAnchors();
  highlightActiveField(key);
}

// The learned-anchors panel: WHERE this field is read from, so a mis-drawn anchor can be spotted +
// deleted (delete + re-teach is the clean fix). Read-only display + per-anchor delete-confirm.
let _lhAnchors = [];
let _lhAnchorPending = null;
function renderLearningAnchors() {
  const el = document.getElementById('lh-anchors');
  if (!el) return;
  const supNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const selSup = supNorm(_lhField && _lhField.supplier);
  const rows = (_lhAnchors || []).map(a => {
    const drawn = !!a.last_authoritative_at;
    const xpct = Math.round((a.x_norm || 0) * 100), ypct = Math.round((a.y_norm || 0) * 100);
    const aSup = supNorm(a.supplier_name);
    const isCross = aSup && aSup !== selSup && !['  global  ', 'global', 'unknown'].includes(aSup);
    const badge = drawn
      ? `<span class="lh-a-badge" title="You drew this box (⊕ teach)">✎ drawn</span>`
      : `<span class="lh-a-badge auto" title="Learned automatically from confirmations">auto · used ${a.usage_count || 1}×</span>`;
    const crossBadge = isCross
      ? `<span class="lh-a-badge cross" title="Stored under a DIFFERENT sender (${escHtml(a.supplier_name || '')}) — likely mis-scoped">${escHtml(a.supplier_name || '?')}</span>` : '';
    const meta = `<span class="lh-a-meta" title="label direction · position on the page">→ ${escHtml(a.direction || '?')} @ ${xpct}%,${ypct}%</span>`;
    const action = (_lhAnchorPending === a.id)
      ? `<span class="lh-a-confirm">Delete this anchor?<button class="lh-a-yes" data-id="${a.id}">Yes</button><button class="lh-a-no">No</button></span>`
      : `<button class="lh-a-del" data-id="${a.id}" title="Delete this learned position (re-teach with ⊕ to replace it)">🗑 delete</button>`;
    return `<div class="lh-anchor"><span class="lh-a-label">${escHtml(a.anchor_label || '(no label)')}</span>`
      + `${meta} ${badge} ${crossBadge}<span class="lh-a-spacer"></span>${action}</div>`;
  }).join('');
  el.innerHTML = `<h4>Learned position (anchors)</h4>` + (rows
    || `<div class="lh-a-empty">No learned anchor for this field — it's read by keyword/logo, or hasn't been taught. Use ⊕ on the field to teach a position.</div>`);
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
      inp.value = _lhEditing;
      // Defer focus to the next frame: focusing an element the SAME tick its parent innerHTML was
      // just set is dropped by Chromium (no caret), and the just-removed ✎ button leaves the render
      // widget's keyboard focus unrouted — which also froze typing in the MAIN review fields until
      // the window was re-activated. The rAF defer lands the caret and keeps the widget focused.
      requestAnimationFrame(() => { try { inp.focus(); inp.select(); } catch {} });
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

// "Fix likely slips" proposer — moved to the shared pure module src/windows/shared/slipFix.js
// (2026-07-11), which also carries the ORIENTATION VETO added after the live inversion incident
// (a poisoned in-scope majority made the old majority-ward code rename the LEGIT values into
// the poison). Loaded via <script> in index.html before this file; tested by
// src/windows/shared/test_slip_fix.js.

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
    // Keep the (non-blocking) learning-history modal OPEN so the operator can work down the source
    // -doc list — open a doc, fix it, then click the next one — without reopening the list each time.
    if (docId) _navigateToDoc(docId);
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

// Learned-anchors panel: per-anchor delete with a Yes/No confirm (delete + re-teach is the fix).
document.getElementById('lh-anchors')?.addEventListener('click', async (e) => {
  const del = e.target.closest('.lh-a-del');
  if (del) { _lhAnchorPending = parseInt(del.dataset.id, 10) || null; renderLearningAnchors(); return; }
  if (e.target.closest('.lh-a-no')) { _lhAnchorPending = null; renderLearningAnchors(); return; }
  const yes = e.target.closest('.lh-a-yes');
  if (yes) {
    const id = parseInt(yes.dataset.id, 10);
    if (!id) return;
    yes.disabled = true;
    try {
      await window.docusnap.deleteFieldAnchor({ id, supplier_name: _lhField && _lhField.supplier,
        document_type: _lhField && _lhField.slug, field_key: _lhField && _lhField.key });
      _lhAnchors = _lhAnchors.filter(a => a.id !== id);
    } catch (err) { console.warn('delete-field-anchor failed:', err); }
    _lhAnchorPending = null;
    renderLearningAnchors();
  }
});

document.getElementById('lh-fix').addEventListener('click', () => {
  const banner = document.getElementById('lh-proposals');
  _lhProposals = window.SlipFix.computeSlipFixes(_lhData);
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
  if (sel) sel.value = selectedTypeSlug;   // programmatic set → NO 'change' event, so the dropdown
                                           // handler's _refreshTaughtForType never fires — do it here.
  const dt = allDocTypes.find(t => t.slug === selectedTypeSlug);
  if (dt) fieldDefs = dt.fields;
  // The "position taught" dots are supplier+type scoped. When a reprocess re-types the doc in place
  // (e.g. a delivery docket first opened with no type, then matched on reprocess), the dots were
  // fetched at open time under the OLD/empty type and would stay red despite saved ⊕ anchors. Re-query
  // for the now-correct scope (mirrors the manual dropdown-change path). Fire-and-forget: it repaints
  // the dots once its async fetch returns, after renderFields has (re)built them.
  _refreshTaughtForType();
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

// ── Import/watch activity → "why reprocess is paused" bar + reprocess-button disable ──────
// A single-doc / batch reprocess is REFUSED while an import or watch-folder batch is running
// (heavy work is serialised). Previously a click just flashed the button red + toasted; now a
// persistent bar explains it and the reprocess buttons are disabled so the click can't flash.
// Synced on load (getProcessingActivity) + live via the processing-activity broadcast.
let _processingActive = false;
function applyProcessingActivity(s) {
  _processingActive = !!(s && s.active);
  const bar = document.getElementById('processing-activity');
  if (bar) {
    if (_processingActive) {
      const where = s.source === 'watch' ? 'the watch folder' : 'import';
      const prog  = s.total ? ` — ${Math.min(s.done || 0, s.total)} of ${s.total}` : '';
      bar.innerHTML = `<span class="pa-spinner"></span><span>Processing new documents from ${where}${prog}. Reprocess is paused until this finishes.</span>`;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }
  // Import/watch and a manual reprocess never run at the same time (heavy work is serialised),
  // so toggling these here can't clash with a reprocess-in-progress's own disabled state.
  for (const id of ['btn-reprocess', 'btn-reprocess-supplier', 'btn-reprocess-all']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.disabled = _processingActive;
    if (_processingActive) b.title = 'Documents are being imported — reprocess will be available once it finishes.';
    else b.removeAttribute('title');
  }
}
try {
  window.docusnap.onProcessingActivity?.(applyProcessingActivity);
  window.docusnap.getProcessingActivity?.().then(applyProcessingActivity).catch(() => {});
} catch { /* older main without the activity signal — bar simply never shows */ }

document.getElementById('btn-reprocess').addEventListener('click', async (e) => {
  if (!currentDoc) return;
  if (_processingActive) { showToast('Documents are being imported — please wait, then reprocess.', 'warn'); return; }
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
  // "Straighten + Reprocess": when the display-deskew toggle is ON, ask the backend to read the
  // STRAIGHTENED page (taught labels relocate in a level frame → the skew misreads recover). The
  // filed file is never touched; the logo phash still uses the raw frame. Review-bound.
  const _deskewedRead = !!deskewEnabled;
  // Manual type override: send the CURRENT dropdown pick and let the backend force it as HUMAN
  // authority ONLY when it differs from the doc's STORED type (resolveReprocessTypeArgs compares
  // against the DB — the ground truth). We must NOT compare here against currentDoc.type_slug: the
  // dropdown-change handler mutates currentDoc.type_slug to the pick, so a local "differs" check is
  // always false and the pick never reaches reprocess (the snap-back bug). An un-touched reprocess
  // sends the stored type -> the backend no-ops -> byte-identical.
  const _forcedTypeSlug = selectedTypeSlug || null;
  const result = await window.docusnap.reprocessDocument({
    docId:          currentDoc.id,
    folderPath:     currentDoc.folder_path,
    filename:       currentDoc.original_filename,
    enhanceParams:  previewActive ? getEnhanceParams() : null,
    deskewOnce:     _deskewedRead,
    forcedTypeSlug: _forcedTypeSlug,
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
    // Straightening can shift EVERY field's read, not just the one you're fixing — a rubber-stamped
    // shifted value would feed learning. Prompt the operator to eyeball the whole doc.
    if (_deskewedRead) {
      showToast('Read from the straightened page — please check all fields before confirming.', 'warn');
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

// Reprocess a set of documents (the whole queue, or just one sender's) through the shared
// batched-worker path. scopeLabel is shown in the progress banner + toast.
async function runReprocessBatch(docs, scopeLabel) {
  if (!docs || docs.length === 0) { showToast('No documents to reprocess', 'warn'); return; }
  if (_batchActive) return;
  // The open document's unsaved edits/type choice are re-rendered away too (QA audit #3).
  if (hasPendingReviewEdits() && !confirm(REPROCESS_DISCARD_WARNING)) return;

  const btnAll  = document.getElementById('btn-reprocess-all');
  const btnSup  = document.getElementById('btn-reprocess-supplier');
  const btnOne  = document.getElementById('btn-reprocess');
  const btnStop = document.getElementById('btn-stop-reprocess');
  const banner  = document.getElementById('reprocess-progress');

  _batchActive  = true;
  _batchStopped = false;
  btnAll.disabled      = true;
  if (btnSup) btnSup.disabled = true;
  btnOne.disabled      = true;
  btnStop.disabled     = false;
  btnStop.innerHTML    = '&#9632; Stop';
  btnStop.style.display = '';
  banner.classList.remove('done');
  banner.classList.add('show');
  banner.textContent   = `Reprocessing 0 of ${docs.length} · ${scopeLabel}…`;

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
    if (msg.type === 'file_done')  banner.textContent = `Reprocessing ${msg.done || 0} of ${msg.total || total} · ${scopeLabel}…`;
    else if (msg.type === 'log')   console.log('[Reprocess]', msg.text);
  });

  let lockedSkipped = 0;   // Slice 1 Stage E: docs skipped because they sit in an approval workflow
  try {
    const res = await window.docusnap.reprocessBatch(
      docs.map(d => ({ docId: d.id, folderPath: d.folder_path, filename: d.original_filename })),
      { deskewAll: !!deskewSessionOn, deskewMinAngle }   // C4: force straightened READS (past the operator's angle floor) for the whole batch when the session toggle is on (covers Reprocess All + Reprocess-this-sender, which both route here)
    );
    done   = (res && res.done)   || 0;
    failed = (res && res.failed) || 0;
    lockedSkipped = (res && res.lockedSkipped) || 0;
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
    updateReprocessSupplierButton();   // re-enable + relabel the per-sender button for the open doc
    // Auto-commit any docs that reprocessed to 100% (setting-gated) + toast.
    await autoCommitFullConfidence();
  }

  const stopped = _batchStopped;
  // Slice 1 Stage E: locked docs are skipped (never silently rewritten under an approver) —
  // say so, or the skip reads as a miscount.
  const lockedText = lockedSkipped ? ` · ${lockedSkipped} skipped (in an approval workflow)` : '';
  const summary = (stopped
    ? `Stopped — ${done} reprocessed`
    : (failed ? `Completed — ${done} OK, ${failed} failed`
              : `Completed ${done} of ${total}`)) + lockedText;
  banner.classList.add('done');
  banner.textContent = summary;
  setTimeout(() => {
    if (!_batchActive) { banner.classList.remove('show', 'done'); banner.textContent = ''; }
  }, 4000);

  showToast(
    (stopped ? `Stopped — ${done} reprocessed, ${queue.length} remaining`
             : (failed ? `Reprocessed ${done} — ${failed} failed`
                       : `Reprocessed ${done} document${done !== 1 ? 's' : ''}`)) + lockedText,
    (failed || stopped || lockedSkipped) ? 'warn' : 'ok'
  );
}

document.getElementById('btn-reprocess-all').addEventListener('click', () => runReprocessBatch([...queue], 'all in queue'));

// Reprocess only the documents from the OPEN document's sender — for fixing one supplier's
// batch after teaching/settings changes without re-running the whole queue.
document.getElementById('btn-reprocess-supplier').addEventListener('click', () => {
  const sup = (currentDoc?.supplier_name || '').trim();
  if (!sup) { showToast('Open a document first', 'warn'); return; }
  const docs = queue.filter(d => (d.supplier_name || '').trim() === sup);
  if (docs.length === 0) { showToast('No queued documents from this sender', 'warn'); return; }
  runReprocessBatch(docs, sup);
});

// Show + label the per-sender reprocess button for the OPEN document's supplier (queue tab only;
// hidden when there's no sender or no other queued docs from it). Called on doc select + batch end.
function updateReprocessSupplierButton() {
  const btn = document.getElementById('btn-reprocess-supplier');
  if (!btn) return;
  const sup = (currentDoc?.supplier_name || '').trim();
  const n = (sup && activeTab !== 'deferred') ? queue.filter(d => (d.supplier_name || '').trim() === sup).length : 0;
  if (n > 0) {
    const shown = sup.length > 20 ? sup.slice(0, 19) + '…' : sup;
    btn.textContent = `Reprocess ${n} from “${shown}”`;
    btn.title = `Reprocess the ${n} queued document${n > 1 ? 's' : ''} from ${sup}`;
    btn.disabled = _batchActive;
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}

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
  const _rsBtn = document.getElementById('btn-reprocess-supplier');
  if (_rsBtn) _rsBtn.style.display = 'none';   // cleared panel → no open doc → hide per-sender reprocess
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
  { const pb = document.getElementById('btn-print-doc'); if (pb) pb.style.display = 'none'; }
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

// Auto-refresh the queue when the main process signals the review count changed. DEBOUNCED: as a
// batch processes, each doc first lands as needs_review (a count-change) and — when it qualifies —
// AUTO-FILES a moment later (another count-change), so an immediate re-render made those docs FLASH
// into the queue and straight back out. Coalescing a burst into ONE refresh shortly after it settles
// skips the transient states: by then an auto-filed doc is already confirmed (never in the queue), so
// only genuine needs_review docs remain, and the "N auto-committed" tally ticks up ONCE instead of
// the list churning per doc. A single isolated change still lands in well under a second.
let _reviewRefreshTimer = null;
async function _refreshQueueFromBroadcast() {
  // File All Ready does its own clean refresh when it finishes; the auto-filed VIEW owns the list
  // while active (a background count-change must not clobber it — see refreshAutoCommittedBar).
  if (bulkFiling || _viewingAutoFiled) return;
  const prevId  = currentDoc?.id;
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  updateTabCounts();
  if (activeTab === 'review')   renderQueueList();
  if (activeTab === 'deferred') renderDeferredList();
  refreshAutoCommittedBar();   // tick the auto-committed tally up after the burst (fetches fresh)
  if (!prevId && queue.length > 0 && activeTab === 'review') selectDoc(queue[0]);
}
window.docusnap.onReviewCountChanged(() => {
  // Ignore File All Ready's interim per-doc broadcasts — its own clean refresh follows the run.
  if (bulkFiling) return;
  if (_reviewRefreshTimer) clearTimeout(_reviewRefreshTimer);
  _reviewRefreshTimer = setTimeout(() => { _reviewRefreshTimer = null; _refreshQueueFromBroadcast(); }, 800);
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
  // The Template Wizard's coord math isn't deskew-aware, so it must draw on the RAW page —
  // cancel Straighten when it opens (revert the shown image if a straightened one is up).
  if (deskewEnabled) {
    const wasDeskewed = !!deskewPageAngle;
    deskewEnabled = false; deskewPageAngle = 0; updateDeskewBtn();
    if (wasDeskewed) renderPage();
  }
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
function sanitizeAnchorLabel(label) { return window.AnchorLabel.sanitizeAnchorLabel(label); }
function labelLooksSuspicious(label) { return window.AnchorLabel.labelLooksSuspicious(label); }

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
  // Don't autofill a GARBLED auto-read — leave it blank (→ position-only on save) so a misread
  // caption can't be silently promoted to a real anchor label (mirrors the ⊕ readout guard).
  if (clean && !labelLooksSuspicious(clean) && !input.value.trim()) input.value = clean;
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
      if (!byField.has(f)) byField.set(f, { merges: [], rejects: [], transforms: [], validations: [], final: null, reconcile: null });
      return byField.get(f);
    };
    for (const ev of events) {
      if (!ev) continue;
      // reconcile is a CROSS-field TOTAL calc (keyed by total_key, carries no `field`) — attach it
      // to the total field's block before the per-field guard below.
      if (ev.event === 'reconcile') { if (ev.total_key) get(ev.total_key).reconcile = ev; continue; }
      if (ev.field == null) continue;
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
      // Stage 4 TOTAL reconciliation maths (SFDEV): the exact sum it balanced against, so a
      // "doesn't add up" flag on correct-looking figures is explained — most often a MISSING
      // component (e.g. an un-captured "Discount (10%)") the total legitimately reflects.
      if (m.reconcile) {
        const rc = m.reconcile;
        const comp = (lbl, v) => v === 'MISSING'
          ? `<span style="color:var(--warn)">MISSING</span>(${lbl})`
          : `${escHtml(String(v))}(${lbl})`;
        const calc = `${escHtml(String(rc.subtotal))} + ${comp('tax', rc.tax)} + ${comp('ship', rc.shipping)} − ${comp('disc', rc.discount)} = <b>${escHtml(String(rc.computed))}</b>`
          + ` &nbsp;vs total <b>${escHtml(String(rc.total))}</b> &nbsp;(Δ ${escHtml(String(rc.delta))}, tol ${escHtml(String(rc.tol))}) → ${rc.reconciles ? 'reconciles' : "doesn't reconcile"}`;
        rows.push(noteRow('reconcile', calc + (rc.verdict ? `<div class="rdc-why">${escHtml(String(rc.verdict))}</div>` : ''), 'valid'));
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
      // Auto-focus + widget-focus repair so the password box takes keystrokes without an alt-tab.
      (window.repairModalInputFocus || ((el) => el.focus()))(input);
    });
  }
})();

// ── Init ──────────────────────────────────────────────────────────────────────
loadQueue();
