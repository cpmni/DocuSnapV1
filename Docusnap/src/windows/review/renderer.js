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
// A VAT REGISTRATION NUMBER, by key or by display label — a REGISTRATION field, never the VAT
// AMOUNT. The amount is typed currency, so `TYPE_TO_VALIDATION` has already mapped it before this
// is consulted; the guard on 'tax'/'amount'/'total' is a second belt for a custom field keyed
// 'vat_amount' that somebody typed as text.
function isVatFieldKey(key, label) {
  const s = ((key || '') + ' ' + (label || '')).toLowerCase();
  if (!/\bvat\b|\bv\.a\.t/.test(s)) return false;
  if (/amount|total|tax\b|\bdue\b/.test(s)) return false;
  return /\bno\b|number|reg|registration|\bid\b/.test(s) || /^vat_no$/.test((key || '').toLowerCase());
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
  // A VAT REGISTRATION NUMBER is its own format, and this line must sit ABOVE the ref-role
  // fallback below or the `_no` suffix claims it first. `vat_no` is typed plain "text" on every
  // shipped and preset type, so without this the on-blur validator would keep accepting 'VAT' or
  // '3PL' by the loose alphanumeric rule while the backend (which now ships
  // field_patterns.vat_no -> vat_gb) refuses them — the UI telling the operator a value is fine
  // that the reader will not keep. Mirrors the backend exactly.
  if (!mapped && isVatFieldKey(def.key, def.label)) mapped = 'vat_gb';
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
  // LIST fields (2026-08-11): the value is 'A; B; C' — validated PER ELEMENT (the whole-value
  // >=0.8 coverage rule below would fail on the separators; that is the exact defect the
  // reverted 2026-08-10 serial_list field-level pattern had). Warn-only, like every check here.
  if (def && String(def.type || '').toLowerCase() === 'list') {
    // Split on the STORE separator only (reggie 2026-08-26): a comma inside an element ("Unit 4, Bay 2")
    // is data, not a separator — the old `[;,]` was wider than the store and flagged it as an empty entry.
    const parts = v.split(/;/).map(s => s.trim());
    if (parts.some(s => !s)) return 'This list has an empty entry — remove a stray separator';
    if (parts.some(s => !/[A-Za-z0-9]/.test(s))) return 'A list entry has no letters or digits';
    return null;
  }
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
  if (valKey === 'date') {
    // Accept if EITHER the substring pattern matches OR the strict preclean parser accepts it. The
    // latter clears the note for an OCR-spaced "15 / 12 / 2025" that files cleanly (the folder builder
    // and the Confirm gate both preclean), so the field note AGREES with the button instead of showing
    // a spurious "Not a valid date" while the doc still files (Chris 2026-08-25 re-verify Card A — the
    // predicate-drift Oracle warned of). Only ADDS acceptance → never introduces a new false warning.
    if (pats.some(re => re.test(v)) || _parseDrawnDate(v, _regionDateOrder || 'dmy') !== null) return null;
  } else if (valKey === 'currency' || valKey === 'currency_code') {
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
  const note = row.querySelector('.field-note:not(.field-validation-warn):not(.verified):not(.corrected):not(.corroborated)');
  if (note) note.remove();
  const ex = (currentDoc?.extractions || []).find(e => e.field_key === key);
  if (ex) { ex.validation_note = null; ex.corrected_to = null; }
}

// ── State ─────────────────────────────────────────────────────────────────────
let queue            = [];
// Review-queue view: group rows by sender (default) vs raw newest-first. A same-window
// UI preference (persisted in localStorage, not a DB setting), like the queue splitter.
let queueGrouped     = (localStorage.getItem('review_queue_grouped') || 'true') !== 'false';
// Slice 3 of the garbled-issuer arc (2026-08-22 evening; Oracle C3.1/C3.2): a held document whose
// issuer is a GARBLE of a known company (the engine carried the letterhead canonical in
// `issuer_suggested` beside the still-standing identity note) groups UNDER that company in the
// sender list — never as a sender of its own ("NOCUMENT · 2 documents" beside DOCUMENT SOLUTIONS).
// Display only: the document's supplier_name is untouched (the per-sender Reprocess, the catch-up
// sweep scope and Home's sender count all keep reading the real value). A whole-token disagreement
// (a buyer-issued PO on another letterhead) carries no suggestion, so it stays where it is.
// `review_group_by_letterhead` setting, read once per window; OFF → plain supplier_name key.
let reviewGroupByLetterhead = false;
(async () => {
  try { reviewGroupByLetterhead = (await window.docusnap.getSetting('review_group_by_letterhead')) === 'true'; }
  catch { /* stays false — legacy grouping */ }
})();
function reviewGroupKey(doc) {
  if (reviewGroupByLetterhead) {
    const sug = String(doc?.issuer_suggested || '').trim();
    if (sug) return sug;
  }
  return String(doc?.supplier_name || '').trim() || '—';
}
// A row whose group is the letterhead company while its own read still differs → "check sender".
function reviewGroupChip(doc) {
  if (!reviewGroupByLetterhead) return '';
  const sug = String(doc?.issuer_suggested || '').trim();
  const own = String(doc?.supplier_name || '').trim();
  if (!sug || sug === own) return '';
  return ` <span class="qi-check-sender" title="The letterhead reads “${escHtml(sug)}” but this document's issuer box read “${escHtml(own)}”. Open it to use the letterhead name.">check sender</span>`;
}
// Which sender groups are EXPANDED in the grouped list. Default: none (all collapsed).
// Same-session UI state (not persisted) — each window open starts fully collapsed;
// selecting a doc auto-expands its group so the review flow stays visible.
let expandedSuppliers = new Set();
let deferredQueue    = [];
let bulkFiling       = false; // true while File All Ready runs; suppresses the auto-refresh listener so its per-doc confirm broadcasts can't clobber the loop's local queue mid-run
let allDocTypes      = [];
let currentDoc       = null;
let _lastRenderedDoc = null;   // the FULL doc object renderFields last drew (≠ currentDoc, which is the queue stub) — the live field-visibility re-resolve mutates + re-renders THIS one
let currentPage      = 0;
let pageImages       = [];
let _currentPageMissing = false;   // card 1: the interactive doc SHOULD have a page but none rendered (file gone) — gates Confirm
let fieldDefs        = [];
let corrections      = {};
// Field keys emptied by _clearSuspectReadsForNewIssuer because the ISSUER changed — a
// MACHINE-initiated clear, not an operator correction, and the distinction is load-bearing.
//
// This used to be recorded as `corrections[key] = {corrected_value:''}`, which made a machine
// clear indistinguishable from an operator deleting a value by hand. saveCorrections then wrote
// it straight through — `UPDATE extractions SET display_value='', was_corrected=1`
// (database/modules/learning.js:325) — blanking a stored row and stamping it as human-corrected,
// and writing a corrections audit row asserting an edit the operator never made. Where the panel
// happened to re-render (via _resolveFieldVisibility) the operator saw the CORRECT values while
// the stored row was emptied underneath them: screen and database diverged silently and search
// then missed a document the operator could see was right.
//
// The backend cannot separate the two cases — both stage a byte-identical entry — and it cannot
// be given a marker without a payload-suppliable field, which the internal-`via` convention
// forbids. So the impersonation is fixed here, at its source: the clear is recorded as a RENDER
// fact, never as a correction. Filing is unaffected because `allValues` is scraped from the live
// DOM, and an operator's own clear still stages a real `corrections` entry and still behaves
// exactly as before.
//
// ACCEPTED TRADE-OFF, pinned — do NOT "fix" this by restoring the corrections entry: the stored
// extraction row keeps the previous supplier's value until the document is reprocessed. That is
// the normal state of every field the operator did not touch, it is visible and correctable,
// whereas a false corrections row and a blanked value are neither. The right home for "this
// field has no value on this document for this sender" is the declared-absent / hidden-field
// mechanism, not `corrections`.
//
// Doc-scoped: reset wherever `corrections` is reset.
let clearedByIssuerChange = new Set();
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
  'draw-target':   'Draw a box around the value to read, next to its label.',
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
// Decide what the Review window lands on when it opens — PURE and side-effect-free so it can be
// unit-pinned (test_review_initial_selection.js). Returns exactly one of:
//   { navigate: <docId> } — an "Edit in Review" target was requested → go there, ONLY
//   { select: <doc> }     — auto-land on this document
//   { none: true }        — land on nothing (empty queue, or 2+ sender piles that deliberately
//                           start collapsed → the pick-a-doc CTA shows instead of a dead pane)
// The navigate and select outcomes are MUTUALLY EXCLUSIVE by construction, so the window can never
// fire two selectDoc calls at once — this removes the pre-existing double-select race where the
// un-awaited init auto-select and the "Edit in Review" navigation both selected a document.
function decideInitialSelection({ targetId, queueGrouped, queue, groups }) {
  if (targetId) return { navigate: targetId };
  if (!queue || queue.length === 0) return { none: true };
  if (!queueGrouped) return { select: queue[0] };   // flat "Newest first" — land on the top row (unchanged)
  // Grouped view: only auto-land when there is a SINGLE sender pile. That is exactly the cold-DB /
  // single-sender case where an all-collapsed list would strand a first-time user on an empty pane
  // with just a "—" bar. With 2+ piles, keep the deliberate "pick a group" landing so the
  // many-senders overview is preserved (widening this is what would revive the double-select race).
  if (groups && groups.length === 1 && groups[0].docs && groups[0].docs.length) {
    return { select: groups[0].docs[0] };
  }
  return { none: true };
}
/* __PIN_END:decideInitialSelection__ */

async function loadQueue() {
  // Resolve role first so the admin-only bulk-delete footers render correctly
  // (visibility is a convenience — the delete IPCs are admin-gated server-side).
  try {
    const me = await window.docusnap.authGetCurrentUser();
    isAdmin = !!(me && me.role === 'admin');
    canEdit = !!(me && (me.role === 'admin' || me.role === 'edit'));
  } catch { isAdmin = false; canEdit = false; }
  loadAutoFileConfig();      // for the "nothing flagged — just below your auto-file setting" panel
  applyAnchorWizardGate();   // Template Wizard is admin-only (mapping IPC is admin-gated server-side)
  // "+ New type" header launcher — admin only (the create IPC is admin-gated server-side).
  const _newTypeBtn = document.getElementById('btn-new-doctype');
  if (_newTypeBtn) { _newTypeBtn.style.display = isAdmin ? '' : 'none'; _newTypeBtn.onclick = openNewTypeModal; }
  // Sender-field editor (2026-08-12, replaces "Save as template" + the "✏ Edit type" deep-link —
  // Oracle SIGN-OFF-W/COND ×5, Chris cards 1-7 owner-approved). Review is admin/edit-only at the
  // window opener (main.js), so admin+edit here means "everyone who can be in this window". The
  // whole-type editor (every sender at once) lives in Settings → Document Types only — the editor
  // modal carries a pointer line for the rare legit case.
  const _senderBtn = document.getElementById('btn-sender-fields');
  if (_senderBtn) { _senderBtn.style.display = canEdit ? '' : 'none'; _senderBtn.onclick = () => openSenderFieldEditor(); }
  _updateSenderFieldsBtn();
  queue         = await window.docusnap.getReviewQueue();
  deferredQueue = await window.docusnap.getDeferredQueue();
  allDocTypes   = await window.docusnap.getAllDocTypes();
  ensureValidationPatterns();   // fire-and-forget; ready well before any field blur
  fieldDefs     = allDocTypes.length ? allDocTypes[0].fields : [];
  populateTypeDropdown();
  updateTabCounts();
  renderQueueList();
  // Per-sender finish line: fetch once, then re-render the list so each sender header carries it.
  // Deliberately AFTER the first paint — the queue must never wait on an advisory number.
  refreshScopeReadiness().then(() => { if (Array.isArray(_scopeReadiness)) renderQueueList(); }).catch(() => {});
  refreshAutoCommittedBar();   // surface recently auto-filed docs for re-checking (independent of the selection below)

  // Reconnect to a "Reprocess All" that Review was closed during. If it's STILL running, show
  // progress + lock the buttons (reconnectRunningBatch). If it FINISHED while Review was closed, its
  // window-side completion (auto-file the reprocessed-to-100 docs + summary) never ran — consume it
  // once here so those docs still auto-file. Best-effort; never blocks the queue load.
  try {
    const _rs = await window.docusnap.getReprocessStatus();
    if (_rs && _rs.running) {
      reconnectRunningBatch(_rs);
    } else {
      const _c = await window.docusnap.consumeReprocessCompletion();
      if (_c) {
        if (_c.offerIds) { try { showReprocessAutofileOffer(_c.offerIds); } catch {} }
        showToast(`Reprocess finished — ${_c.done} document${_c.done !== 1 ? 's' : ''} updated${_c.failed ? `, ${_c.failed} failed` : ''}`, _c.failed ? 'warn' : 'ok');
      }
    }
  } catch { /* non-fatal */ }

  // Decide what to land on ONCE. getReviewTarget is consume-once, so read it first, then let
  // decideInitialSelection choose target-nav XOR auto-land — the two can never both fire selectDoc
  // (removes the old double-select race). The single-group branch is the cold-start fix: a first
  // import (no learned senders yet) is one "—" pile, so we auto-expand it and open the first
  // document instead of leaving the user on a collapsed bar over an empty pane.
  const targetId = await window.docusnap.getReviewTarget();
  const decision = decideInitialSelection({
    targetId, queueGrouped, queue, groups: reviewDisplayGroups(),
  });
  if (decision.navigate)    _navigateToDoc(decision.navigate);   // "Edit in Review" target
  else if (decision.select) selectDoc(decision.select);          // flat top row, or the sole sender pile's first doc
  else if (queue.length)    showPreviewCta();                    // docs waiting but nothing auto-landed (2+ piles) → offer a next step, not a dead pane
}

// ── "Auto-committed" re-surface ──────────────────────────────────────────────
// Recently auto-filed (100%) docs can still be checked/edited: a bar offers them, and clicking
// loads them (now confirmed) into the queue LIST so the operator can open, change and re-file
// any that need it. The auto-refresh listener is suppressed while this view is active.
let _viewingAutoFiled = false;
let _autoFiledDocs    = [];
// Authoritative needs_review count for the tab badge (bug fix 2026-08-23): the badge used to read
// `queue.length`, which is a SUBSET in the filtered "See them" / auto-filed view — so after a bulk put-back
// the badge read "1" while 18 sat in the queue. Kept fresh from the review-count-changed event and every
// full-queue load; the badge shows it (not the filtered length) whenever a filtered view is active.
let _authReviewCount  = null;

async function refreshAutoCommittedBar() {
  const bar = document.getElementById('auto-committed-bar');
  if (!bar) return;
  if (_viewingAutoFiled) {
    bar.innerHTML = `Showing <b>${_autoFiledDocs.length}</b> auto-filed document${_autoFiledDocs.length === 1 ? '' : 's'} — `
      + `<span class="acb-back">← Back to the review queue</span>`;
    bar.style.display = 'block';
    return;
  }
  // Chris round 17 card 4: under the activity strip the strip owns the receipts — the tile said "39 filed
  // automatically" about 35 documents sitting in the queue. Placed AFTER the viewing branch above ("See
  // them" renders its "← Back" into this bar). The B2 precedent (the sweep done-phase already defers).
  if (typeof _asOn !== 'undefined' && _asOn) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  let res = { docs: [] };
  try { res = (await window.docusnap.getRecentAutoFiled?.()) || res; } catch {}
  _autoFiledDocs = res.docs || [];
  if (_autoFiledDocs.length) {
    // Approved (the consent bar's File N) counted SEPARATELY from automatic — the operator's
    // decision must not be recorded on screen as the machine's (Chris r7 card 2).
    const nAppr = Array.isArray(res.approvedIds)
      ? _autoFiledDocs.filter(d => res.approvedIds.includes(d.id)).length : 0;
    // Slice 1 (scope-local auto-accept): documents the app filed BY ITSELF after the operator
    // confirmed a few from that sender carry via='scope_sweep'. Counted separately — the receipt
    // must say what happened in the operator's words — and they get a one-click Put back (Oracle
    // S1-C4: the bar is the surprise control the consent glance used to be).
    const selfDocs = _autoFiledDocs.filter(d => d.confirmed_via === 'scope_sweep'
                                              && !(Array.isArray(res.approvedIds) && res.approvedIds.includes(d.id)));
    const nSelf = selfDocs.length;
    const nAuto = _autoFiledDocs.length - nAppr - nSelf;
    const parts = [];
    if (nAuto) parts.push(`<b>✓ ${nAuto}</b> document${nAuto === 1 ? '' : 's'} filed automatically`);
    if (nSelf) {
      const senders = [...new Set(selfDocs.map(d => String(d.supplier_name || '').trim()).filter(Boolean))];
      const who = senders.length === 1 ? ` from ${escHtml(senders[0])}` : (senders.length ? ` from ${senders.length} senders you've confirmed` : '');
      parts.push(`<b>✓ ${nSelf}</b> document${nSelf === 1 ? '' : 's'}${who} filed by itself after your confirms`);
    }
    if (nAppr) parts.push(`<b>${nAppr}</b> filed with your approval`);
    bar.innerHTML = `<span class="acb-dismiss" title="Dismiss this notice" aria-label="Dismiss">×</span>`
      + parts.join(' · ') + ` — `
      + `<span class="acb-back">click to see the list — they stay filed; nothing is changed</span>`
      + (nSelf ? ` · <span class="acb-putback" title="Return these to the Review queue — nothing is lost; the filed copies stay on disk until you re-file">Put back</span>` : '');
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
  // Put back (Slice 1): return the self-filed documents of THIS receipt to the queue. Server-verified
  // — sweep-scope-undo refuses anything not confirmed_via='scope_sweep', so a human confirm can
  // never be mass-reverted from here. deconfirm keeps rows + stored_path (re-confirm replaces in place).
  if (e.target.closest('.acb-putback')) {
    e.stopPropagation();
    const ids = _autoFiledDocs.filter(d => d.confirmed_via === 'scope_sweep').map(d => d.id);
    if (!ids.length) return;
    let r = null;
    try { r = await window.docusnap.sweepScopeUndo?.(ids); } catch {}
    const n = (r && Array.isArray(r.undone)) ? r.undone.length : 0;
    showToast(n ? `Put ${n} document${n === 1 ? '' : 's'} back in the Review queue.` : 'Nothing to put back.', n ? 'info' : 'warn');
    try { await window.docusnap.clearRecentAutoFiled?.(); } catch {}
    _autoFiledDocs = [];
    await _refreshQueueFromBroadcast();
    refreshAutoCommittedBar();
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

// "Start reviewing →" in the empty-pane CTA: land on the first document in the visible order
// (selectDoc expands its group). Same landing the ↑/↓ nav treats as first.
// ═══ B2 — THE ACTIVITY STRIP (2026-08-22; barry + eric → Oracle SIGN-OFF-W/COND C2/C5/C6/C7/C9) ═══
// One 28 px row of CHIPS above the toolbar — newest on the left, ≤ AS_MAX on the strip, scroll ‹ › when
// they overflow. A chip = `✓ Just now · 23 filed themselves ▾`; clicking it opens the PANEL (an overlay,
// never a reflow) with the full sentence, the per-sender breakdown, the kept-back reasons (C6) and the
// actions (See them / Put back). CLICK ANYWHERE closes the PANEL ONLY — the chip stays and can be
// reopened while in view (the owner's clarification); a chip leaves the strip on AGE (AS_TTL_MS) or when
// AS_MAX newer arrive; while any event with live undo remains, the band shows a quiet "Recent activity ▾"
// rather than going blank. Fed by the main-process ledger (B1): `getReviewEvents()` on load,
// `onReviewEvent` re-renders the strip ONLY (C2 — the doors already broadcast the queue refresh).
// Relative time is computed from the EVENT's `at`, re-labelled every 30 s, so "47 min ago" after lunch is
// truthful. The renderer never sends a document-id list (C5): "See them" and "Put back" take the event id.
// Armed by `review_activity_strip` (read once per window); OFF → no markup change, `--doc-head-h` stays 46.
const AS_MAX = 10, AS_TTL_MS = 15 * 60 * 1000;
let _asOn = false, _asEvents = [], _asOpenId = null, _asTick = null;
function _asRelTime(at) {
  const d = Math.max(0, Date.now() - Number(at || 0));
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} hr ago`;
  const dt = new Date(Number(at)); const hh = String(dt.getHours()).padStart(2, '0'), mm = String(dt.getMinutes()).padStart(2, '0');
  return d < 2 * 86_400_000 ? `Yesterday ${hh}:${mm}` : `${dt.toLocaleDateString()} ${hh}:${mm}`;
}
function _asIcon(ev) { return ev.kind === 'put_back' ? '↩' : (ev.kind === 'class_fix' || ev.kind === 'issuer_fill') ? '✎' : '✓'; }
// Kind → an icon COLOUR class (green filed · amber put-back · accent fix) so the line reads at a glance
// without painting the whole chip (bob: reserve colour, don't nag). A zero-filed approved is "kept back",
// which reads as put-back tone (amber), not a green tick.
function _asIconClass(ev) {
  if (ev.kind === 'put_back') return 'putback';
  if (ev.kind === 'class_fix' || ev.kind === 'issuer_fill') return 'fix';
  if (ev.kind === 'approved' && (Number(ev.count) || 0) === 0) return 'putback';
  return 'filed';
}
function _asShort(ev) {
  const n = Number(ev.count) || 0, s = n === 1 ? '' : 's';
  const kept = Array.isArray(ev.dropped) ? ev.dropped.length : 0;
  switch (ev.kind) {
    case 'auto_filed': return `${n} filed automatically`;
    case 'self_filed': return `${n} filed themselves`;
    // A zero-filed File All is the run that most needs a receipt (Chris r5 card 2) — say "kept back", not "you filed 0".
    case 'approved':   return n === 0 && kept ? `Nothing filed — ${kept} kept back` : `You filed ${n}`;
    case 'class_fix':  return `${n} corrected`;
    case 'issuer_fill': return `${n} more ready to file`;
    case 'put_back':   return `${n} put back`;
    default:           return `${n} document${s}`;
  }
}
// Line 2 of a chip — the WHEN plus one short detail, kept calm (senders + the full sentence live in the
// panel). Named senders on filed runs; kept-back count on a held run; the put-back tag once reverted.
function _asChipDetail(ev) {
  const bits = [];
  const kept = Array.isArray(ev.dropped) ? ev.dropped.length : 0;
  if ((Number(ev.count) || 0) > 0 && kept) bits.push(`${kept} kept back`);
  else if ((Number(ev.count) || 0) === 0 && kept && ev.kind !== 'approved') bits.push(`${kept} kept back`);
  const senders = ev.bySender ? Object.entries(ev.bySender).filter(([k, v]) => k && k !== '—' && Number(v) > 0) : [];
  if ((Number(ev.count) || 0) > 0 && senders.length) {
    const top = senders.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k).join(', ');
    bits.push(senders.length > 2 ? `${top} +${senders.length - 2}` : top);
  }
  if (ev.put_back_at) bits.push('put back');
  return bits.join(' · ');
}
// Chris r18 card 7: after a Put back the chip must SAY so (the button vanished but the chip read as if
// nothing happened, then dropped off). Now carried on the chip's line 2 by _asChipDetail ('put back') and
// in the panel by _asLineFull.
// C9: "filed themselves" is reserved for self_filed (after your confirms); a 100 %-import is "filed automatically".
function _asLine(ev) {
  const n = Number(ev.count) || 0, s = n === 1 ? '' : 's', sup = ev.scope && ev.scope.supplier ? escHtml(ev.scope.supplier) : '';
  switch (ev.kind) {
    case 'auto_filed': return `${n} document${s} filed automatically — every field read clean (matched 100 %)`;
    case 'self_filed': return `${n} document${s}${sup ? ` from <b>${sup}</b>` : ''} filed themselves — they matched what you've confirmed`;
    case 'approved':   return ev.bulk ? `You filed ${n} in one go` : `You filed ${n}${sup ? ` from <b>${sup}</b>` : ''} in one go`;
    case 'class_fix':  return `${n} ${sup ? `<b>${sup}</b> ` : ''}document${s} ${n === 1 ? 'was' : 'were'} corrected to match your fix`;
    case 'issuer_fill': return `${sup ? `<b>${sup}</b> filled in on ` : 'The sender was filled in on '}${n} more document${s} with this same letterhead — File All Ready now offers ${n === 1 ? 'it' : 'them'}`;
    case 'put_back':   return `${n} ${sup ? `<b>${sup}</b> ` : ''}document${s} ${n === 1 ? 'was' : 'were'} put back in Review — the filed copies stay in your folder until you file them again`;
    default:           return `${n} document${s}`;
  }
}
function _asLineFull(ev) {
  const base = _asLine(ev);
  if (!ev || !ev.put_back_at) return base;
  const pb = Array.isArray(ev.put_back_ids) ? ev.put_back_ids.length : null;
  return `${base} — <b>put back</b> by you${pb != null && pb !== Number(ev.count) ? ` (${pb} of ${ev.count})` : ''}; they wait in Review until you confirm them`;
}
function _asVisible(now = Date.now()) {
  return _asEvents.filter(e => (now - Number(e.at || 0)) <= AS_TTL_MS).slice(0, AS_MAX);
}
function renderActivityStrip() {
  const panel = document.getElementById('doc-panel'), strip = document.getElementById('activity-strip'), track = document.getElementById('as-track');
  if (!panel || !strip || !track) return;
  panel.classList.toggle('has-activity-strip', _asOn);
  if (!_asOn) { track.innerHTML = ''; return; }
  const vis = _asVisible();
  const anyUndo = _asEvents.some(e => e.undoable);
  if (!vis.length) {
    track.innerHTML = anyUndo || _asEvents.length
      ? `<span class="as-chip as-recent" data-as="recent" title="Show what the app did recently">Recent activity <span class="as-caret">▾</span></span>`
      : '';
  } else {
    track.innerHTML = vis.map(ev => {
      const detail = _asChipDetail(ev);
      return `<span class="as-chip${ev.seen ? '' : ' unseen'}${_asOpenId === ev.id ? ' open' : ''}" data-as="${ev.id}" title="${escHtml(_asLine(ev).replace(/<[^>]+>/g, ''))}">`
        + `<span class="as-l1"><span class="as-ico ${_asIconClass(ev)}">${_asIcon(ev)}</span><span class="as-act">${escHtml(_asShort(ev))}</span></span>`
        + `<span class="as-l2"><span class="as-when">${escHtml(_asRelTime(ev.at))}</span>${detail ? ` · ${escHtml(detail)}` : ''}<span class="as-caret">▾</span></span>`
        + `</span>`;
    }).join('');
  }
  _asUpdateNav();
  if (_asOpenId != null) _asRenderPanel();
}
function _asUpdateNav() {
  const track = document.getElementById('as-track'); if (!track) return;
  const over = track.scrollWidth > track.clientWidth + 2;
  const prev = document.getElementById('as-prev'), next = document.getElementById('as-next');
  if (prev) prev.hidden = !over || track.scrollLeft <= 0;
  if (next) next.hidden = !over || track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
}
function _asRenderPanel() {
  const panel = document.getElementById('activity-panel'); if (!panel) return;
  const rows = _asOpenId === 'recent' ? _asEvents : _asEvents.filter(e => e.id === _asOpenId);
  if (!rows.length) { _asClosePanel(); return; }
  // A visible X (data-ap="close") + a click on the panel body both close via the ONE delegated listener.
  const closeX = `<button type="button" class="ap-close" data-ap="close" aria-label="Close" title="Close">&#10005;</button>`;
  panel.innerHTML = closeX + rows.map(ev => {
    // r18 card 5: a bulk "you filed N" names its senders even when there is only one — that IS the receipt.
    // A zero-filed File All merges a placeholder ('—': 0) sender: drop empty/placeholder rows so the
    // breakdown only ever names real recipients.
    const senders = ev.bySender ? Object.entries(ev.bySender).filter(([k, v]) => k && k !== '—' && Number(v) > 0) : [];
    const by = senders.length
      ? `<div class="ap-sub">${senders.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${escHtml(k)} ${v}`).join(' · ')}</div>` : '';
    const kept = (ev.dropped || []).length
      ? `<div class="ap-kept">${(ev.dropped || []).slice(0, 8).map(d => `kept back — ${escHtml(typeof _sweepReason === 'function' ? _sweepReason(d.reason) : d.reason)} (#${d.docId})`).join('<br>')}${(ev.dropped || []).length > 8 ? `<br>… and ${(ev.dropped || []).length - 8} more` : ''}</div>` : '';
    // THREE FIXED SLOTS (owner 2026-08-27): [Put back | See them | Quick check]. A slot the row lacks renders an
    // INVISIBLE placeholder of the SAME element and label (so the same width) — the permanent two never slide and
    // every row's columns line up (index.html .ap-actions grid / .ap-ghost).
    const _apGhost = (label) => `<button type="button" class="ap-btn ap-ghost" disabled tabindex="-1" aria-hidden="true">${label}</button>`;
    const undo = ev.undoable ? `<button type="button" class="ap-btn" data-ap="undo" data-ev="${ev.id}" title="Puts these documents back in Review. ${_putBackBody(ev)}">Put back</button>` : _apGhost('Put back');
    const see = Number(ev.count) ? `<button type="button" class="ap-btn primary" data-ap="see" data-ev="${ev.id}">See them</button>` : _apGhost('See them');
    // Batch-audit "Quick check" (2026-08-24, DARK batch_audit_enabled): on any FILED batch — auto-filed,
    // self-filed, OR human-approved (File All / File N / a run of individual Confirm & File, which the
    // ledger merges into one approved|bulk chip). Catching a wrong value right after rapid confirming is
    // the point (owner). Only while a doc is still around to check; opens the grid at THIS event id.
    const qcheck = (_baOn && (ev.kind === 'auto_filed' || ev.kind === 'self_filed' || ev.kind === 'approved') && Number(ev.count))
      ? `<button type="button" class="ap-btn" data-ap="qcheck" data-ev="${ev.id}" title="Open these filed documents in a grid to spot-check the read values and correct any mistakes.">Quick check</button>` : _apGhost('Quick check');
    return `<div class="ap-row"><div class="ap-head"><span class="ap-when">${escHtml(_asRelTime(ev.at))}</span><span class="ap-line">${_asIcon(ev)} ${_asLineFull(ev)}</span><span class="ap-actions">${undo}${see}${qcheck}</span></div>${by}${kept}</div>`;
  }).join('');
  panel.classList.add('open');
}
function _asOpenPanel(id) {
  _asOpenId = id;
  _asRenderPanel();
  document.querySelectorAll('#as-track .as-chip').forEach(c => c.classList.toggle('open', c.dataset.as === String(id)));
  try { const top = _asVisible()[0]; if (top && !top.seen) window.docusnap.markReviewEventsSeen?.(top.id).then(() => { _asEvents.forEach(e => { if (e.id <= top.id) e.seen = true; }); renderActivityStrip(); }).catch(() => {}); } catch {}
}
function _asClosePanel() {
  _asOpenId = null;
  const panel = document.getElementById('activity-panel'); if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  document.querySelectorAll('#as-track .as-chip.open').forEach(c => c.classList.remove('open'));
}
// End-of-File-All reconcile: (1) record the kept-back set so a zero-filed run still leaves a chip and a
// run that filed some carries its "N kept back" reasons (merged into the run's approved|bulk event by the
// ledger); (2) REFETCH the authoritative ledger so the bulk count is correct despite the 1/s emit throttle
// coalescing interleaved self_filed/approved records mid-run (eric's count-staleness fix). Best-effort:
// wrapped so the receipt can never affect the filing that already happened.
async function _asFileAllReconcile(dropped) {
  try {
    if (Array.isArray(dropped) && dropped.length) await window.docusnap.recordFileAllOutcome?.({ dropped });
  } catch { /* the receipt must never affect filing */ }
  if (_asOn) { try { _asEvents = (await window.docusnap.getReviewEvents?.()) || _asEvents; renderActivityStrip(); } catch {} }
}
async function _asSeeThem(evId) {
  let r = null;
  try { r = await window.docusnap.getReviewEventDocs?.(evId); } catch {}
  const docs = (r && r.ok && Array.isArray(r.docs)) ? r.docs : [];
  if (!docs.length) { showToast('Those documents are no longer available to show.', 'warn'); return; }
  _asClosePanel();
  _viewingAutoFiled = true;                        // the existing "filed list owns the queue" mode (exitAutoFiledView returns)
  queue = docs.slice();
  renderQueueList();
  if (queue.length) selectDoc(queue[0]);
  refreshAutoCommittedBar();
}
// Card 6 (Chris 2026-08-25): the Put-back copy must match what actually happened. A FILED batch
// (auto/self/approved) wrote copies to the filing folder, so those stay until you re-file. An in-Review
// edit — the issuer sender-sweep (issuer_fill) or a class fix — filed NOTHING to disk, so telling the user
// "the copies already written to your filing folder" there made Chris fear stray files from an undo.
const _FILED_KINDS = new Set(['auto_filed', 'self_filed', 'approved']);
function _putBackBody(ev) {
  return _FILED_KINDS.has(ev && ev.kind)
    ? 'The copies already written to your filing folder stay there and are replaced when you file them again.'
    : 'Nothing has been filed to your folders yet — this only returns them to Review.';
}
async function _asPutBack(evId) {
  const ev = _asEvents.find(e => e.id === evId); if (!ev) return;
  const n = Number(ev.count) || 0;
  // C7: a big revert is a one-click action — name the number before it happens
  if (n > 25 && !confirm(`Put ${n} documents back in Review?

${_putBackBody(ev)}`)) return;
  let r = null;
  try { r = await window.docusnap.undoReviewEvent?.(evId); } catch {}
  const undone = (r && Array.isArray(r.undone)) ? r.undone.length : 0, refused = (r && Array.isArray(r.refused)) ? r.refused.length : 0;
  if (!r || !r.ok) showToast(r && r.reason === 'already-put-back' ? 'Already back in Review.'
    : r && r.reason === 'not-undoable' ? 'These can no longer be put back from here — open them from Search instead.'
    : (r && r.reason === 'expired' ? 'That correction can no longer be undone — fix the field by hand.' : 'Nothing was put back.'), 'warn');
  else showToast(refused ? `Put ${undone} back in Review — ${refused} couldn't be (filed another way since).` : `Put ${undone} document${undone === 1 ? '' : 's'} back in the Review queue.`, undone ? 'info' : 'warn');
  // card 7: the server hands back the updated event (undo gone) — replace our copy rather than wait for the
  // throttled broadcast, so the chip stops offering Put back immediately
  if (r && r.event && r.event.id != null) { const i = _asEvents.findIndex(e => e.id === r.event.id); if (i >= 0) _asEvents[i] = r.event; }
  _asClosePanel();
  await _refreshQueueFromBroadcast();
}
async function initActivityStrip() {
  try { _asOn = (await window.docusnap.getSetting('review_activity_strip')) === 'true'; } catch { _asOn = false; }
  if (!_asOn) { renderActivityStrip(); return; }
  try { _asEvents = (await window.docusnap.getReviewEvents?.()) || []; } catch { _asEvents = []; }
  renderActivityStrip();
  try {
    window.docusnap.onReviewEvent?.((ev) => {          // C2: the strip ONLY — the doors already refresh the queue
      if (!ev || ev.id == null) return;
      const i = _asEvents.findIndex(e => e.id === ev.id);
      if (i >= 0) _asEvents[i] = ev; else _asEvents.unshift(ev);
      _asEvents.sort((a, b) => Number(b.at) - Number(a.at));
      renderActivityStrip();
    });
  } catch {}
  if (_asTick) clearInterval(_asTick);
  _asTick = setInterval(() => { if (_asOn) renderActivityStrip(); }, 30_000);   // re-label only (no refetch)
  window.addEventListener('beforeunload', () => { if (_asTick) clearInterval(_asTick); });
  const track = document.getElementById('as-track');
  track?.addEventListener('scroll', _asUpdateNav);
  document.getElementById('as-prev')?.addEventListener('click', () => { track.scrollBy({ left: -200 }); });
  document.getElementById('as-next')?.addEventListener('click', () => { track.scrollBy({ left: 200 }); });
  track?.addEventListener('click', (e) => {
    const chip = e.target.closest('.as-chip'); if (!chip) return;
    const key = chip.dataset.as === 'recent' ? 'recent' : Number(chip.dataset.as);
    if (_asOpenId === key) _asClosePanel(); else _asOpenPanel(key);
  });
  // ONE delegated listener owns every panel click (survives _asRenderPanel's full re-render). See-them and
  // Put-back run and self-close (each calls _asClosePanel); the X and ANY other click on the panel body
  // close it. C5-safe: non-capture, no stopPropagation/preventDefault — and because the panel overlays the
  // document the click never reaches the page beneath, so no teach/drag-select interceptor is disturbed.
  document.getElementById('activity-panel')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ap]');
    if (b && b.dataset.ap === 'see')  { _asSeeThem(Number(b.dataset.ev)); return; }
    if (b && b.dataset.ap === 'undo') { _asPutBack(Number(b.dataset.ev)); return; }
    if (b && b.dataset.ap === 'qcheck') { _baOpen(Number(b.dataset.ev)); return; }   // batch-audit grid
    _asClosePanel();   // the X (data-ap="close") or a bare click on the panel body
  });
  // C5: OBSERVE-ONLY click-outside (never stopPropagation/preventDefault — the ⊕ pick, drag-select and
  // help-mode interceptors must see every click); Esc is consumed only while the panel is open.
  document.addEventListener('click', (e) => {
    if (_asOpenId == null) return;
    if (e.target.closest('#activity-panel') || e.target.closest('#activity-strip')) return;
    _asClosePanel();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _asOpenId != null) { _asClosePanel(); e.stopPropagation(); }
  }, true);
}
initActivityStrip();

// ══════════════════════════════════════════════════════════════════════════════
// Batch-audit "Quick check" grid — the FRONT-END for the auto-filed batch review
// (2026-08-24). Backend: src/services/batchAuditService.js (Oracle SIGN-OFF-W/COND).
// Lays a filed BATCH out as editable doc cards (values) beside a page preview; a
// corrected value re-files + re-learns via the batch-audit-correct IPC. DARK: the
// whole surface only arms when `batch_audit_enabled` is true (the IPCs ALSO refuse
// when off, so a stale renderer can't reach the backend). Issuer + document type are
// READ-ONLY here and routed to full Review (Oracle C1) — this fixes VALUE/date/ref
// single-character misreads (I/1, O/0, slash-drop), never the identity/type.
// ══════════════════════════════════════════════════════════════════════════════
let _baOn = false, _baEvId = null, _baOrig = {}, _baEdits = {}, _baValPats = null, _baPrevDoc = null, _baBusy = false;
let _baRows = [], _baView = 'cards', _baFType = '', _baFSup = '', _baColW = {}, _baResz = null;
let _baZoom = 1, _baPanX = 0, _baPanY = 0, _baPan = null;
const _BA_ROUTED = new Set(['supplier_name', 'document_type', 'document_type_slug']);

(async function _baInit() {
  try { _baOn = (await window.docusnap.getSetting('batch_audit_enabled')) === 'true'; } catch { _baOn = false; }
})();

function _baHumanize(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function _baIsDateKey(key) { return /(^|_)date($|_)/.test(String(key || '')); }
function _baDateOk(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return true;   // emptiness is the server's structural call (C3), not a format failure
  const pats = (_baValPats && _baValPats.date) || [];
  if (!pats.length) return true;
  return pats.some(p => { try { return new RegExp(p, 'i').test(t); } catch { return false; } });
}
// Edits survive filter + view changes: the input's VALUE and dirty flag are always derived from
// (edit ?? original), never from what a prior render left in the DOM.
function _baVal(docId, key) {
  const e = _baEdits[docId];
  if (e && Object.prototype.hasOwnProperty.call(e, key)) return e[key];
  const o = _baOrig[docId]; return o && o[key] != null ? o[key] : '';
}
function _baIsDirty(docId, key) {
  const e = _baEdits[docId]; return !!(e && Object.prototype.hasOwnProperty.call(e, key));
}
function _baFieldMeta(f) {
  // Customer-facing: confidence + any human-readable validation note ONLY. The internal method code
  // ("anchor_inline", "keyword") is dev jargon that means nothing to a normal user and leaked into the
  // Cards view under every value (Chris 2026-08-25 Card 5) — dropped from both the card meta and the
  // table cell's hover title, which share this helper.
  const conf = f.confidence == null ? '' : `${Math.round(f.confidence)}%`;
  return [conf, f.note ? String(f.note).slice(0, 48) : ''].filter(Boolean).join(' · ');
}
function _baConf(v) { return v == null ? '' : `${Math.round(v)}%`; }
function _baVisibleRows() {
  return (_baRows || []).filter(r =>
    (!_baFType || r.type_slug === _baFType) && (!_baFSup || (r.supplier_name || '') === _baFSup));
}

function _baEnsureStyle() {
  if (document.getElementById('ba-style')) return;
  const s = document.createElement('style'); s.id = 'ba-style';
  s.textContent = [
    '#ba-overlay{position:fixed;inset:0;z-index:9000;display:none;background:rgba(0,0,0,.45)}',
    '#ba-overlay.open{display:flex}',
    '.ba-modal{margin:auto;width:96vw;height:94vh;max-width:2200px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.35)}',
    '.ba-modal.resizing{cursor:col-resize;user-select:none}',
    '.ba-header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}',
    '.ba-header h2{margin:0;font-size:16px;font-weight:600;color:var(--text)}',
    '.ba-sub{color:var(--muted);font-size:12.5px}',
    '.ba-x{margin-left:auto;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;border-radius:var(--r-sm);padding:4px 9px;line-height:1}',
    '.ba-x:hover{background:var(--surface2);color:var(--text)}',
    // filter bar
    '.ba-filters{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--surface2)}',
    '.ba-fl{color:var(--muted);font-size:12px}',
    '.ba-sel{padding:6px 10px;border:1px solid var(--border2);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font-size:12.5px;max-width:230px}',
    '.ba-count{color:var(--muted);font-size:11.5px}',
    '.ba-view-toggle{margin-left:auto;display:inline-flex;border:1px solid var(--border2);border-radius:var(--r-pill);overflow:hidden;background:var(--surface)}',
    '.ba-vseg{padding:6px 14px;font-size:12.5px;color:var(--muted);cursor:pointer;background:none;border:none;line-height:1.4}',
    '.ba-vseg.on{background:var(--accent);color:var(--on-accent,#fff)}',
    '.ba-body{flex:1;display:flex;min-height:0}',
    '.ba-grid{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px}',
    // table mode: the GRID stops scrolling and the table WRAP fills it + scrolls both ways, so the
    // horizontal scrollbar docks at the bottom of the visible pane (not the bottom of a tall table) and
    // the sticky header/first-column ride the wrap's own scroll.
    '.ba-grid.as-table{display:block;overflow:hidden;padding:14px}',
    '.ba-preview{position:relative;width:40%;min-width:320px;border-left:1px solid var(--border);background:var(--doc-bg);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:12px}',
    '.ba-preview img{max-width:100%;max-height:100%;height:auto;border:1px solid var(--border2);background:#fff;border-radius:6px;transform-origin:center center;cursor:grab;will-change:transform}',
    '.ba-preview.grabbing img{cursor:grabbing}',
    '.ba-prev-empty{color:var(--muted);font-size:13px;margin:auto;text-align:center}',
    '.ba-prev-hint{position:absolute;left:12px;bottom:12px;font-size:10.5px;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pill);padding:3px 10px;opacity:.75;pointer-events:none}',
    '.ba-empty{color:var(--muted);font-size:13px;padding:24px;text-align:center}',
    // cards
    '.ba-card{border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;background:var(--surface)}',
    '.ba-card.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}',
    '.ba-card-head{display:flex;align-items:baseline;gap:10px;cursor:pointer;margin-bottom:9px}',
    '.ba-fname{font-weight:600;color:var(--text);font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%}',
    '.ba-issuer{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ba-issuer small{opacity:.7}',
    '.ba-conf{margin-left:auto;color:var(--muted);font-size:11.5px;font-family:var(--mono,monospace);white-space:nowrap}',
    '.ba-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}',
    '.ba-field{display:flex;flex-direction:column;gap:3px;min-width:0}',
    '.ba-flabel{font-size:11px;color:var(--muted)}',
    '.ba-input{padding:6px 8px;border:1px solid var(--border2);border-radius:var(--r-sm);background:var(--surface2);color:var(--text);font-size:13px;font-family:var(--mono,monospace);min-width:0}',
    '.ba-input:focus{outline:none;border-color:var(--accent);background:var(--surface)}',
    '.ba-input.dirty{border-color:var(--warn);background:var(--accent-bg)}',
    '.ba-input.bad{border-color:var(--err)}',
    '.ba-fmeta{font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ba-ferr{font-size:11px;color:var(--err);min-height:0}',
    '.ba-card-result{margin-top:9px;font-size:12px}',
    '.ba-card-result[data-state=ok],.ba-tstatus[data-state=ok]{color:var(--ok)}',
    '.ba-card-result[data-state=bad],.ba-tstatus[data-state=bad]{color:var(--err)}',
    '.ba-card-result[data-state=warn],.ba-tstatus[data-state=warn]{color:var(--warn)}',
    // table (stylish: borderless-until-hover value cells, sticky head + first col, zebra, hover, selected accent)
    '.ba-tablewrap{height:100%;overflow:auto;border:1px solid var(--border2);border-radius:var(--r-sm);background:var(--surface)}',
    '.ba-table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:13px;color:var(--text)}',
    '.ba-table th{position:sticky;top:0;z-index:2;background:var(--surface3);text-align:left;font-weight:600;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:var(--muted);padding:9px 12px;border-bottom:1px solid var(--border2);white-space:nowrap}',
    '.ba-tvcol{min-width:150px}',
    '.ba-col-resize{position:absolute;top:0;right:-3px;width:8px;height:100%;cursor:col-resize;z-index:5;touch-action:none;user-select:none}',
    '.ba-col-resize:hover,.ba-col-resize.on{background:var(--accent);opacity:.35}',
    '.ba-table td{padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:middle}',
    '.ba-table tbody tr:last-child td{border-bottom:none}',
    '.ba-table tbody tr{background:var(--surface)}',
    '.ba-table tbody tr:nth-child(even){background:var(--surface2)}',
    '.ba-table tbody tr:hover{background:var(--accent-bg)}',
    '.ba-table tbody tr.sel{background:var(--accent-bg);box-shadow:inset 3px 0 0 var(--accent)}',
    '.ba-tsticky{position:sticky;left:0;z-index:1;background:inherit;min-width:180px;max-width:250px;box-shadow:1px 0 0 var(--border)}',
    '.ba-table th.ba-tsticky{z-index:3;background:var(--surface3)}',
    '.ba-tfname{display:block;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}',
    '.ba-tissuer{color:var(--muted);font-size:12px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}',
    '.ba-tinput{width:100%;box-sizing:border-box;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;color:var(--text);font-size:13px;font-family:var(--mono,monospace);padding:5px 7px}',
    '.ba-tinput:hover{border-color:var(--border2);background:var(--surface)}',
    '.ba-tinput:focus{outline:none;border-color:var(--accent);background:var(--surface)}',
    '.ba-tinput.dirty{border-color:var(--warn);background:var(--accent-bg)}',
    '.ba-tinput.bad{border-color:var(--err)}',
    '.ba-tempty{color:var(--muted);text-align:center}',
    '.ba-cchip{display:block;font-size:10px;color:var(--muted);margin-top:2px;font-family:var(--mono,monospace)}',
    '.ba-tstatus{font-size:11px;white-space:nowrap;min-width:120px}',
    // footer + buttons
    '.ba-footer{display:flex;align-items:center;gap:14px;padding:12px 18px;border-top:1px solid var(--border)}',
    '.ba-note{color:var(--muted);font-size:12px}',
    '.ba-actions{margin-left:auto;display:flex;gap:10px;align-items:center}',
    '.ba-btn{padding:8px 16px;border:1px solid var(--border2);border-radius:var(--r-sm);background:var(--surface2);color:var(--text);font-size:13px;cursor:pointer}',
    '.ba-btn:hover{background:var(--surface3)}',
    '.ba-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}',
    '.ba-btn.primary:hover{background:var(--accent2)}',
    '.ba-btn:disabled{opacity:.5;cursor:default}',
  ].join('\n');
  document.head.appendChild(s);
}

function _baBuildOverlay() {
  let ov = document.getElementById('ba-overlay');
  if (ov) return ov;
  _baEnsureStyle();
  ov = document.createElement('div'); ov.id = 'ba-overlay';
  ov.innerHTML = ''
    + '<div class="ba-modal" role="dialog" aria-modal="true" aria-label="Quick check">'
    +   '<div class="ba-header"><h2>Quick check</h2><span class="ba-sub" id="ba-sub"></span>'
    +     '<button type="button" class="ba-x" id="ba-x" title="Close" aria-label="Close">&#10005;</button></div>'
    +   '<div class="ba-filters">'
    +     '<span class="ba-fl">Show</span>'
    +     '<select class="ba-sel" id="ba-ftype" aria-label="Filter by document type"><option value="">All types</option></select>'
    +     '<select class="ba-sel" id="ba-fsup" aria-label="Filter by sender"><option value="">All senders</option></select>'
    +     '<span class="ba-count" id="ba-count"></span>'
    +     '<span class="ba-view-toggle" role="group" aria-label="View">'
    +       '<button type="button" class="ba-vseg" id="ba-vcards" data-view="cards">Cards</button>'
    +       '<button type="button" class="ba-vseg" id="ba-vtable" data-view="table">Table</button>'
    +     '</span>'
    +   '</div>'
    +   '<div class="ba-body"><div class="ba-grid" id="ba-grid"></div>'
    +     '<div class="ba-preview" id="ba-preview"><span class="ba-prev-empty">Select a document to preview it here.</span></div></div>'
    +   '<div class="ba-footer">'
    +     '<span class="ba-note">Issuer and document type are read-only here — open the document in Review to change those.</span>'
    +     '<span class="ba-actions"><span class="ba-note" id="ba-dirty">No changes</span>'
    +       '<button type="button" class="ba-btn" id="ba-cancel">Close</button>'
    +       '<button type="button" class="ba-btn primary" id="ba-apply" disabled>Apply corrections</button></span>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) _baClose(); });
  ov.querySelector('#ba-x').addEventListener('click', _baClose);
  ov.querySelector('#ba-cancel').addEventListener('click', _baClose);
  ov.querySelector('#ba-apply').addEventListener('click', _baApply);
  ov.querySelector('#ba-ftype').addEventListener('change', (e) => { _baFType = e.target.value; _baRender(); });
  ov.querySelector('#ba-fsup').addEventListener('change', (e) => { _baFSup = e.target.value; _baRender(); });
  ov.querySelector('.ba-view-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]'); if (!b || b.dataset.view === _baView) return;
    _baView = b.dataset.view; try { localStorage.setItem('ba_view', _baView); } catch {}
    _baRender();
  });
  const grid = ov.querySelector('#ba-grid');
  grid.addEventListener('input', _baOnInput);
  // select the doc (preview) on focus/click of its card OR table row — both carry data-doc.
  grid.addEventListener('focusin', (e) => { const el = e.target.closest('[data-doc]'); if (el) _baSelect(Number(el.dataset.doc)); });
  grid.addEventListener('click', (e) => { if (e.target.closest('.ba-input') || e.target.closest('.ba-col-resize')) return; const el = e.target.closest('[data-doc]'); if (el) _baSelect(Number(el.dataset.doc)); });
  grid.addEventListener('blur', _baOnBlur, true);
  grid.addEventListener('pointerdown', _baReszStart);   // draggable column resizers (table view)
  const pv = ov.querySelector('#ba-preview');
  pv.addEventListener('wheel', _baPrevWheel, { passive: false });   // scroll to zoom
  pv.addEventListener('pointerdown', _baPrevDown);                  // drag to pan
  pv.addEventListener('dblclick', _baResetPrev);                    // double-click to reset
  document.addEventListener('keydown', _baEsc, true);
  return ov;
}

// ── Preview pan + zoom (mirrors the Review window's cursor-anchored zoom) ──
function _baApplyPrevTransform() {
  const img = document.querySelector('#ba-preview img'); if (!img) return;
  img.style.transform = `translate(${_baPanX}px, ${_baPanY}px) scale(${_baZoom})`;
}
function _baResetPrev() { _baZoom = 1; _baPanX = 0; _baPanY = 0; _baApplyPrevTransform(); }
function _baPrevWheel(e) {
  const pv = document.getElementById('ba-preview'); if (!pv || !pv.querySelector('img')) return;
  e.preventDefault();
  const rect = pv.getBoundingClientRect();
  const cx = e.clientX - rect.left - rect.width / 2 - _baPanX;   // cursor offset from the img's transform centre
  const cy = e.clientY - rect.top - rect.height / 2 - _baPanY;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const nz = Math.min(8, Math.max(1, _baZoom * factor));
  const ratio = nz / _baZoom;
  _baPanX -= cx * (ratio - 1); _baPanY -= cy * (ratio - 1); _baZoom = nz;
  if (_baZoom <= 1.001) { _baZoom = 1; _baPanX = 0; _baPanY = 0; }   // snap back to fit
  _baApplyPrevTransform();
}
function _baPrevDown(e) {
  const pv = document.getElementById('ba-preview'); if (!pv || !pv.querySelector('img') || _baZoom <= 1) return;
  e.preventDefault();
  _baPan = { x: e.clientX, y: e.clientY, px: _baPanX, py: _baPanY };
  pv.classList.add('grabbing');
  document.addEventListener('pointermove', _baPrevMove);
  document.addEventListener('pointerup', _baPrevUp, { once: true });
}
function _baPrevMove(e) {
  if (!_baPan) return;
  _baPanX = _baPan.px + (e.clientX - _baPan.x);
  _baPanY = _baPan.py + (e.clientY - _baPan.y);
  _baApplyPrevTransform();
}
function _baPrevUp() {
  _baPan = null;
  document.removeEventListener('pointermove', _baPrevMove);
  document.getElementById('ba-preview')?.classList.remove('grabbing');
}
function _baEsc(e) {
  if (e.key === 'Escape' && document.getElementById('ba-overlay')?.classList.contains('open') && !_baBusy) { _baClose(); e.stopPropagation(); }
}

// ── Draggable table columns — widths persist per field key across filter/view re-renders ──
function _baReszStart(e) {
  const grip = e.target.closest('.ba-col-resize'); if (!grip) return;
  const th = grip.closest('th'); if (!th) return;
  e.preventDefault();
  _baResz = { key: grip.dataset.colkey, th, x: e.clientX, w: th.offsetWidth };
  grip.classList.add('on');
  document.querySelector('.ba-modal')?.classList.add('resizing');
  document.addEventListener('pointermove', _baReszMove);
  document.addEventListener('pointerup', _baReszEnd, { once: true });
}
function _baReszMove(e) {
  if (!_baResz) return;
  const w = Math.max(70, _baResz.w + (e.clientX - _baResz.x));
  _baResz.th.style.width = w + 'px';
  _baColW[_baResz.key] = w;
}
function _baReszEnd() {
  document.removeEventListener('pointermove', _baReszMove);
  document.querySelectorAll('.ba-col-resize.on').forEach(g => g.classList.remove('on'));
  document.querySelector('.ba-modal')?.classList.remove('resizing');
  _baResz = null;
}

// Build _baOrig for every fetched row (all keys, all rows) so edits are compared/preserved
// regardless of the current filter or view.
function _baIngest(rows) {
  _baRows = rows || [];
  _baOrig = {};
  for (const r of _baRows) {
    _baOrig[r.id] = {};
    for (const f of (r.fields || [])) if (f.key && !_BA_ROUTED.has(f.key)) _baOrig[r.id][f.key] = f.value == null ? '' : String(f.value);
  }
}
function _baPopulateFilters() {
  const tsel = document.getElementById('ba-ftype'), ssel = document.getElementById('ba-fsup');
  if (!tsel || !ssel) return;
  const types = [...new Map(_baRows.filter(r => r.type_slug).map(r => [r.type_slug, r.type_name || r.type_slug])).entries()];
  const sups = [...new Set(_baRows.map(r => r.supplier_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  tsel.innerHTML = '<option value="">All types</option>' + types.map(([slug, name]) => `<option value="${escHtml(slug)}">${escHtml(name)}</option>`).join('');
  ssel.innerHTML = '<option value="">All senders</option>' + sups.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  tsel.value = _baFType; ssel.value = _baFSup;
}

async function _baOpen(evId) {
  if (!_baOn) { showToast('Quick check is turned off.', 'warn'); return; }
  let res = null;
  try { res = await window.docusnap.getAutofiledGrid(evId); } catch { res = null; }
  if (!res || !res.ok) {
    showToast(res && res.reason === 'disabled' ? 'Quick check is turned off.'
      : res && res.reason === 'unknown-event' ? 'That batch is no longer available to check.'
      : 'Could not open Quick check.', 'warn');
    return;
  }
  if (!res.rows || !res.rows.length) { showToast('Nothing left to check in that batch.', 'info'); return; }
  if (!_baValPats) { try { _baValPats = await window.docusnap.getValidationPatterns(); } catch { _baValPats = {}; } }
  _baEvId = evId; _baEdits = {}; _baPrevDoc = null; _baFType = ''; _baFSup = ''; _baColW = {};
  try { _baView = localStorage.getItem('ba_view') === 'cards' ? 'cards' : 'table'; } catch { _baView = 'table'; }   // table is the default view
  try { _asClosePanel(); } catch {}
  const ov = _baBuildOverlay();
  const _filedWord = res.event && res.event.kind === 'approved' ? 'you filed' : 'filed automatically';
  ov.querySelector('#ba-sub').textContent = `${res.rows.length} document${res.rows.length === 1 ? '' : 's'} ${_filedWord} — correct any wrong reads, then re-file.`;
  _baIngest(res.rows);
  _baPopulateFilters();
  ov.classList.add('open');
  _baRender();
  const vis = _baVisibleRows();
  if (vis[0]) _baSelect(vis[0].id);
}

// Master render — reads the current filter + view and lays the visible rows into #ba-grid.
function _baRender() {
  const grid = document.getElementById('ba-grid'); if (!grid) return;
  const rows = _baVisibleRows();
  grid.classList.toggle('as-table', _baView === 'table');
  document.getElementById('ba-vcards')?.classList.toggle('on', _baView === 'cards');
  document.getElementById('ba-vtable')?.classList.toggle('on', _baView === 'table');
  if (_baView === 'table') _baRenderTable(rows); else _baRenderCards(rows);
  const cnt = document.getElementById('ba-count');
  if (cnt) cnt.textContent = rows.length === _baRows.length ? `${rows.length} document${rows.length === 1 ? '' : 's'}` : `${rows.length} of ${_baRows.length}`;
  // keep the preview on the selected doc if it's still visible, else move to the first visible one
  if (_baPrevDoc && rows.some(r => r.id === _baPrevDoc)) _baSyncSel();
  else if (rows[0]) { _baPrevDoc = null; _baSelect(rows[0].id); }
  _baUpdateDirty();
}

function _baRenderCards(rows) {
  const grid = document.getElementById('ba-grid'); if (!grid) return;
  if (!rows.length) { grid.innerHTML = '<div class="ba-empty">No documents match these filters.</div>'; return; }
  grid.innerHTML = rows.map(r => {
    const fields = (r.fields || []).filter(f => f.key && !_BA_ROUTED.has(f.key));
    const cells = fields.map(f => {
      const dirty = _baIsDirty(r.id, f.key) ? ' dirty' : '';
      const meta = _baFieldMeta(f);
      return '<label class="ba-field">'
        + `<span class="ba-flabel">${escHtml(_baHumanize(f.key))}</span>`
        + `<input class="ba-input${dirty}" type="text" spellcheck="false" data-doc="${r.id}" data-key="${escHtml(f.key)}" value="${escHtml(String(_baVal(r.id, f.key)))}">`
        + `<span class="ba-fmeta" title="${escHtml(meta)}">${escHtml(meta)}</span>`
        + '<span class="ba-ferr"></span></label>';
    }).join('');
    return `<div class="ba-card" data-doc="${r.id}">`
      + '<div class="ba-card-head">'
      +   `<span class="ba-fname" title="${escHtml(r.filename || '')}">${escHtml(r.filename || ('#' + r.id))}</span>`
      +   `<span class="ba-issuer">${escHtml(r.supplier_name || '—')} <small>(issuer — edit in Review)</small></span>`
      +   `<span class="ba-conf">${escHtml(_baConf(r.overall_confidence))}</span>`
      + '</div>'
      + `<div class="ba-fields">${cells || '<span class="ba-note">No editable fields on this document.</span>'}</div>`
      + `<div class="ba-card-result" data-res="${r.id}"></div>`
      + '</div>';
  }).join('');
}

function _baRenderTable(rows) {
  const grid = document.getElementById('ba-grid'); if (!grid) return;
  if (!rows.length) { grid.innerHTML = '<div class="ba-empty">No documents match these filters.</div>'; return; }
  // Columns = the union of non-routed field keys across the VISIBLE rows (first-appearance order).
  const cols = [], seen = new Set(), fmap = {};
  for (const r of rows) {
    fmap[r.id] = {};
    for (const f of (r.fields || [])) {
      if (!f.key || _BA_ROUTED.has(f.key)) continue;
      fmap[r.id][f.key] = f;
      if (!seen.has(f.key)) { seen.add(f.key); cols.push(f.key); }
    }
  }
  const thead = '<thead><tr><th class="ba-tsticky">Document</th><th>Issuer</th>'
    + cols.map(k => {
        const w = _baColW[k] ? ` style="width:${_baColW[k]}px"` : '';
        return `<th class="ba-tvcol"${w}>${escHtml(_baHumanize(k))}<span class="ba-col-resize" data-colkey="${escHtml(k)}" title="Drag to resize this column"></span></th>`;
      }).join('') + '<th>Status</th></tr></thead>';
  const body = rows.map(r => {
    const cells = cols.map(k => {
      const f = fmap[r.id][k];
      if (!f) return '<td class="ba-tempty ba-tvcol">—</td>';
      const dirty = _baIsDirty(r.id, k) ? ' dirty' : '';
      const conf = _baConf(f.confidence);
      return `<td class="ba-tvcol"><input class="ba-input ba-tinput${dirty}" type="text" spellcheck="false" data-doc="${r.id}" data-key="${escHtml(k)}" value="${escHtml(String(_baVal(r.id, k)))}" title="${escHtml(_baFieldMeta(f))}">`
        + `<span class="ba-ferr"></span>${conf ? `<span class="ba-cchip">${escHtml(conf)}</span>` : ''}</td>`;
    }).join('');
    return `<tr class="ba-trow" data-doc="${r.id}">`
      + `<td class="ba-tsticky"><span class="ba-tfname" title="${escHtml(r.filename || '')}">${escHtml(r.filename || ('#' + r.id))}</span>${_baConf(r.overall_confidence) ? `<span class="ba-cchip">${escHtml(_baConf(r.overall_confidence))} confidence</span>` : ''}</td>`
      + `<td class="ba-tissuer" title="Issuer — edit in Review">${escHtml(r.supplier_name || '—')}</td>`
      + cells
      + `<td class="ba-tstatus" data-res="${r.id}"></td>`
      + '</tr>';
  }).join('');
  grid.innerHTML = `<div class="ba-tablewrap"><table class="ba-table">${thead}<tbody>${body}</tbody></table></div>`;
}

function _baOnInput(e) {
  const inp = e.target.closest('.ba-input'); if (!inp) return;
  const docId = Number(inp.dataset.doc), key = inp.dataset.key;
  const val = inp.value;
  const orig = (_baOrig[docId] || {})[key];
  if (String(val) === String(orig == null ? '' : orig)) {
    if (_baEdits[docId]) { delete _baEdits[docId][key]; if (!Object.keys(_baEdits[docId]).length) delete _baEdits[docId]; }
    inp.classList.remove('dirty');
  } else {
    (_baEdits[docId] || (_baEdits[docId] = {}))[key] = val;
    inp.classList.add('dirty');
  }
  _baUpdateDirty();
}
function _baOnBlur(e) {
  const inp = e.target.closest && e.target.closest('.ba-input'); if (!inp) return;
  const err = inp.parentElement.querySelector('.ba-ferr'); if (!err) return;
  if (_baIsDateKey(inp.dataset.key) && !_baDateOk(inp.value)) {
    inp.classList.add('bad'); err.textContent = 'Not a valid date — this will be refused.';
  } else { inp.classList.remove('bad'); err.textContent = ''; }
}

function _baUpdateDirty() {
  const n = Object.values(_baEdits).reduce((a, m) => a + Object.keys(m).length, 0);
  const dirty = document.getElementById('ba-dirty'), apply = document.getElementById('ba-apply');
  if (dirty) dirty.textContent = n ? `${n} change${n === 1 ? '' : 's'}` : 'No changes';
  if (apply) apply.disabled = _baBusy || n === 0;
}

// Highlight the selected doc's card/row (no preview reload) — used after a re-render.
function _baSyncSel() {
  document.querySelectorAll('#ba-grid .ba-card, #ba-grid .ba-trow').forEach(el =>
    el.classList.toggle('sel', Number(el.dataset.doc) === _baPrevDoc));
}

async function _baSelect(docId) {
  if (!docId) return;
  _baPrevDoc = docId;
  _baSyncSel();
  const pv = document.getElementById('ba-preview'); if (!pv) return;
  pv.innerHTML = '<span class="ba-prev-empty">Loading preview…</span>';
  let pages = [];
  try { pages = await window.docusnap.getDocumentPages(docId, null, null); } catch { pages = []; }
  if (_baPrevDoc !== docId) return;   // selection moved on while pages loaded
  const src = Array.isArray(pages) && pages.length ? pages[0] : null;
  _baZoom = 1; _baPanX = 0; _baPanY = 0;   // reset zoom/pan for the new document
  pv.innerHTML = src
    ? `<img src="${escHtml(String(src))}" alt="document preview"><span class="ba-prev-hint">Scroll to zoom · drag to pan · double-click to reset</span>`
    : '<span class="ba-prev-empty">No preview available for this document.</span>';
}

async function _baApply() {
  if (_baBusy) return;
  const edits = Object.entries(_baEdits)
    .map(([docId, fields]) => ({ docId: Number(docId), fields }))
    .filter(e => e.docId && Object.keys(e.fields).length);
  if (!edits.length) return;
  _baBusy = true;
  const apply = document.getElementById('ba-apply');
  if (apply) { apply.disabled = true; apply.textContent = 'Filing…'; }
  let r = null;
  try { r = await window.docusnap.batchAuditCorrect({ eventId: _baEvId, edits }); } catch (e) { r = { ok: false, error: (e && e.message) || 'error' }; }
  if (apply) apply.textContent = 'Apply corrections';
  _baBusy = false;
  if (!r || !r.ok) {
    showToast('Nothing was re-filed — ' + ((r && (r.error || r.reason)) || 'the batch could not be reached') + '.', 'warn');
    _baUpdateDirty();
    return;
  }
  const filed = Number(r.filed) || 0;
  const bad = (r.results || []).filter(x => !x.ok).length;
  showToast(bad ? `Re-filed ${filed}; ${bad} need a look.` : `Re-filed ${filed} correction${filed === 1 ? '' : 's'}.`, bad ? 'warn' : 'info');
  // Re-fetch the authoritative grid so successes show their new value and clear; problems stay visible.
  try {
    const fresh = await window.docusnap.getAutofiledGrid(_baEvId);
    if (fresh && fresh.ok && fresh.rows && fresh.rows.length) {
      _baEdits = {}; _baIngest(fresh.rows); _baPopulateFilters(); _baRender();
      _baShowResults(r.results || []);   // stamp problem/success rows on the fresh markup
    } else if (fresh && fresh.ok) {
      showToast('All documents checked.', 'info'); _baClose(); return;   // batch emptied
    } else {
      _baShowResults(r.results || []);
    }
  } catch { _baShowResults(r.results || []); }
  _baUpdateDirty();
}

function _baResultState(res) {
  if (res.ok && res.reason !== 'no-change') return { s: 'ok', t: `✓ Re-filed${res.filed ? ' as ' + res.filed : ''}.` };
  if (res.ok) return { s: '', t: '' };
  if (res.reason === 'route-to-review') return { s: 'warn', t: 'Change the issuer or type in Review — not here.' };
  if (res.reason === 'invalid-value') return { s: 'bad', t: `“${_baHumanize(res.field || '')}” is not valid (${res.detail || 'bad value'}) — fix it and apply again.` };
  if (res.reason === 'not-in-batch' || res.reason === 'not-confirmed' || res.reason === 'not-found') return { s: 'warn', t: 'This document is no longer part of the batch.' };
  return { s: 'bad', t: 'Could not re-file — ' + (res.reason || 'unknown') + '.' };
}
function _baShowResults(results) {
  for (const res of (results || [])) {
    const el = document.querySelector(`#ba-grid [data-res="${res.docId}"]`); if (!el) continue;
    const { s, t } = _baResultState(res);
    el.dataset.state = s; el.textContent = t;
  }
}

function _baClose() {
  const ov = document.getElementById('ba-overlay'); if (ov) ov.classList.remove('open');
  // _baEsc stays bound (self-guards on .open) so Esc still works after a reopen.
  _baEvId = null; _baEdits = {}; _baOrig = {}; _baRows = []; _baPrevDoc = null; _baFType = ''; _baFSup = ''; _baColW = {}; _baResz = null;
  _baZoom = 1; _baPanX = 0; _baPanY = 0; _baPan = null;
}

document.getElementById('btn-start-reviewing')?.addEventListener('click', () => {
  const order = reviewDisplayOrder();
  if (order.length) selectDoc(order[0]);
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

// Sender-field-editor button state + dynamic label ("Change what's read from Nordwind's documents"
// when the sender is known and short enough — recognition beats a pronoun, Chris card 2). Enabled
// only with a doc + a real (non-generic) type selected; General Documents have no per-sender fields.
function _updateSenderFieldsBtn() {
  const b = document.getElementById('btn-sender-fields');
  if (!b) return;
  b.style.display = canEdit ? '' : 'none';
  const generic = selectedTypeSlug === 'general_document';
  b.disabled = !currentDoc || !selectedTypeSlug || generic;
  b.title = generic
    ? 'General Documents are filed by their text — there are no per-sender fields to change'
    : !selectedTypeSlug
      ? 'Select a document type first'
      : "Choose which fields Scan Finder looks for on this sender's documents — e.g. switch off a field their paperwork never carries";
  const name = String((typeof _currentIssuerValue === 'function' && _currentIssuerValue()) || '').trim();
  const lbl = document.getElementById('btn-sender-fields-lbl');
  if (lbl) lbl.textContent = (name && name.length <= 26)
    ? `Change what's read from ${name}'s documents`
    : `Change what's read from this sender's documents`;
}

// Generic Document chip: one click = pick the General Document type via the normal
// change path (field list updates, staged teaching rules apply — no side channel).
window.__genericFallbackOn = false;
(async () => {
  try { window.__genericFallbackOn = (await window.docusnap.getSetting('generic_fallback_enabled')) === 'true'; }
  catch { /* stays false — chip hidden */ }
})();

// Draw-tool perf (lever 1) — overlap the anchor-LABEL OCR reads with the VALUE read so a drawn box
// costs ~ONE OCR wall-time on the warm worker pool instead of TWO serial waves (value fills, THEN
// the left/above label reads run — the visible post-fill wait). DEFAULT OFF = byte-identical: the
// label reads run serially after the value, exactly as before. Flip via the
// draw_concurrent_anchor_reads setting AFTER an eric/Oracle review of the focus-repair seam + a live
// draw smoke (concurrent OCR spawns can re-fire the page-focus edge).
window.__drawConcurrentAnchor = false;
(async () => {
  try { window.__drawConcurrentAnchor = (await window.docusnap.getSetting('draw_concurrent_anchor_reads')) === 'true'; }
  catch { /* stays false — serial path */ }
})();

// LIST field type (2026-08-11): when armed, a ⊕ teach on a list-typed field is refused with the
// reason (the scan owns the field; a stored box would be dead). OFF = the ⊕ behaves as ever.
window.__listFieldScanOn = false;
window.__barcodeFieldOn = false;   // BARCODE field type (2026-08-26): ⊕ refused on barcode-typed fields when armed
(async () => {
  try { window.__listFieldScanOn = (await window.docusnap.getSetting('list_field_scan')) === 'true'; }
  catch { /* stays false */ }
  try { window.__barcodeFieldOn = (await window.docusnap.getSetting('barcode_field')) === 'true'; }
  catch { /* stays false */ }
})();

// FAR two-tier rule (far_lowconf_valued_only, gate-unify slice, Oracle option (i) 2026-08-12):
// when ON, isFlagged keys its below-threshold tier on VALUED low-confidence reads only — an
// attempted-but-empty optional field @0 no longer flags. ALL five consumers (queue colouring,
// tab need-count, Mark Reviewed, File All Ready, and the getReviewSplit DB twin) move together
// through isFlagged/the twin's own read of the SAME setting, so the banner, the colours and the
// bulk-file behaviour can never disagree. OFF = byte-identical to today.
window.__farValuedOnly = false;
(async () => {
  try { window.__farValuedOnly = (await window.docusnap.getSetting('far_lowconf_valued_only')) === 'true'; }
  catch { /* stays false — legacy tier */ }
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
  _updateSenderFieldsBtn();
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
    // Q4a (Chris round 14 card 5, Oracle C4a.5): the "This looks like a <type> — Add it" card keys on
    // document_type_id and stayed on screen after a type was chosen. Follow the choice and re-render.
    currentDoc.document_type_id      = dt ? (dt.id ?? null) : null;
    // Chris round 6 card 7: the fetched hold verdict described the document as it was LOADED
    // (its old type + sender) — re-rendering with it after a type change kept "Nothing looks
    // wrong — this is only the second document from Bramblewood…" on a delivery note the user
    // had just re-typed. The verdict is stale by definition once the type changes; drop it, and
    // (Chris r7 card A) mark the change so the panel shows a NEUTRAL lead instead of re-deriving
    // "Ready to file" from the old type's confidence while the new type's fields sit empty.
    _holdVerdict = null;
    _typeChangedUnsaved = true;
    try { renderReviewReason(currentDoc); } catch {}
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
// _onCreated: optional override for what happens AFTER a type is created/added. Default (and every
// pre-existing caller) keeps the auto-select tail. The untyped-document notice passes its own,
// because auto-selecting a brand-new type on a doc that was extracted without it blanks every field
// on screen — see _addDetectedType (Oracle C3).
function openNewTypeModal(_onCreated, _initialName) {
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
      initialName: _initialName || '',   // Chris R5 card 5: pre-fill the name when we know the type (e.g. "Add 'Quotation'")
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
      if (typeof _onCreated === 'function') { _onCreated(newSlug); return; }
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
// _preselectName: tick the catalog row whose NAME matches a type the pipeline DETECTED but this
// install doesn't have, so "Add 'Delivery Note'" opens with Delivery Note already ticked. Matched
// on NAME, not slug, deliberately — the renderer has no safeSlug and duplicating the slug rules
// here would be a second source of truth that silently drifts from database/modules/slug.js.
async function openTypeCatalogModal(onAdded, _preselectName) {
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
        <input type="checkbox" data-slug="${escHtml(p.slug)}" data-name="${escHtml(p.name)}"
               ${p.already_present ? 'checked disabled'
                 : (_preselectName && p.name.toLowerCase() === _preselectName.toLowerCase() ? 'checked' : '')}
               style="margin-top:3px;">
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
  const rc = document.getElementById('tab-review-count');
  if (rc) {
    if (_viewingAutoFiled) {
      // Filtered view: `queue` is a subset — show the TRUE needs_review count, not the filtered length.
      if (_authReviewCount != null) rc.textContent = _authReviewCount;
      window.docusnap.getReviewCount?.().then(n => {
        if (typeof n === 'number') { _authReviewCount = n; if (_viewingAutoFiled) rc.textContent = n; }
      }).catch(() => {});
    } else {
      _authReviewCount = queue.length;   // normal view: the full queue IS the needs_review set
      rc.textContent = queue.length;
    }
  }
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
    // 'block', NOT '' — clearing the inline style falls back to the stylesheet's
    // `#queue-empty { display:none }`, so this message NEVER showed (Chris card 2;
    // verified live). The text is re-set per tab because the deferred branch
    // overwrites the shared element (the latent copy-clobber both advisors named).
    // Cause-aware (Chris r6 card 7, r7 "NOT FIXED as seen"): a Delete All empties the queue without
    // reviewing anything — `_queueEmptyMsg` says so. STICKY, not one-shot: the delete's IPC
    // `review-count-changed` refresh re-renders this branch again AFTER the handler's own render, so a
    // one-shot was consumed by the first paint and the default came back on the second. The message
    // holds until the queue is non-empty again (the branch below resets it — a restore refills the queue).
    empty.style.display = 'block';
    empty.textContent = _queueEmptyMsg || '✓ All reviewed';
    reviewActions.style.display = 'none';
    const vb0 = document.getElementById('queue-view-bar');
    if (vb0) vb0.style.display = 'none';
    setQueueWrapVisible(false);
    if (!currentDoc) clearDocPanel();
    return;
  }
  empty.style.display = 'none';
  _queueEmptyMsg  = null;   // the queue is non-empty again — the cause-aware empty messages retire here
  _placeholderMsg = null;
  setQueueWrapVisible(true);
  // The whole left action block (Skip/Defer · File All · Delete All) is shown on
  // the review tab; the destructive "Delete All Review" stays admin-only (also
  // enforced server-side). HIDDEN in the auto-filed view (Oracle A1): there `queue`
  // holds CONFIRMED docs, so "Delete All Review" would show the wrong count over the
  // wrong list while the server deletes the real needs_review set it re-derives.
  reviewActions.style.display = _viewingAutoFiled ? 'none' : 'flex';
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
    const groups = reviewDisplayGroups();
    for (const g of groups) {
      const open = expandedSuppliers.has(g.supplier);
      const head = document.createElement('div');
      head.className = 'queue-group-head' + (open ? ' open' : '');
      const attn = g.need ? ` · <span class="qgh-attn">${g.need} need${g.need > 1 ? '' : 's'} a look</span>` : '';
      const title = groupTitle(g.supplier, groups.length);   // '—' pile → readable copy; the expand/nav KEY stays g.supplier
      const ready = _senderReadinessLabel(g.supplier);       // the finish line for this sender (advisory)
      // Name ABOVE the counts (Chris finding 3): side by side, the counts never shrank and the
      // sender name collapsed to one character. See the .qgh-text block in index.html.
      head.innerHTML = `<span class="qgh-caret" aria-hidden="true"></span>`
                     + `<span class="qgh-text">`
                     +   `<span class="qgh-name" title="${escHtml(title)}">${escHtml(title)}</span>`
                     +   `<span class="qgh-meta">${g.docs.length} document${g.docs.length > 1 ? 's' : ''}${attn}</span>`
                     +   ready
                     + `</span>`;
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
    for (const doc of _sweepVisibleQueue()) list.appendChild(buildQueueItem(doc));
  }
}

// ── PER-SENDER FINISH LINE (owner design, 2026-08-18) ────────────────────────────────────────
// The queue counted documents; what actually gates them is the SENDER. A sender whose scope has
// enough confirmed documents files the rest by itself — so say which senders are nearly there,
// and which already are, on the group header where the customer is already looking.
//
// Rules of the copy, learned the hard way in this project:
//   • report a FACT about the app ("files by itself from now on"), never assign homework
//     ("you owe 3 more") — a visible quota invites careless confirming to hit the number, which
//     poisons the learning it measures (barry + Chris, independently);
//   • never claim a finish line we cannot keep: a sender queued under SEVERAL document types has
//     one countdown per type, so we name the type when they disagree rather than average them;
//   • advisory only — `trust.js` remains the sole filing predicate. If the data hasn't loaded, or
//     anything is unclear, we render NOTHING rather than a guess.
let _scopeReadiness = null;          // [{supplier, slug, typeName, confirms, needed, graduated, ready}]

async function refreshScopeReadiness() {
  try { _scopeReadiness = (await window.docusnap.getScopeReadiness?.()) || null; }
  catch { _scopeReadiness = null; }
}

function _senderReadinessLabel(supplier) {
  if (!Array.isArray(_scopeReadiness)) return '';
  const norm = s => String(s || '').trim().toLowerCase();
  const mine = _scopeReadiness.filter(r => norm(r.supplier) === norm(supplier));
  if (!mine.length) return '';
  const pending = mine.filter(r => !r.ready);
  if (!pending.length) {
    return `<span class="qgh-ready done" title="Documents from this sender that read cleanly can file themselves — you'll still see anything that needs a look.">`
         + `✓ files by itself</span>`;
  }
  // Oracle F3 (2026-08-22): learned, but no taught/graduation layout exists yet — a distinct state,
  // never "files by itself" and never a confirm countdown (more confirms won't make a layout).
  if (pending.every(r => r.needsTemplate)) {
    return `<span class="qgh-ready" title="This sender is learned, but no layout has been saved for it yet — teach one of its documents (or wait for the next confirm to re-read them) and they can file themselves.">`
         + `learned · needs a layout</span>`;
  }
  // Chris round 6 card 6: a sender NOBODY has confirmed yet is a machine GUESS ("Ticket Type",
  // "DOCUMENT OLUTIONS") — a countdown under it reads as "on its way to filing under that name".
  // `confirms` is the gate's own count (the learned issuer group), so 0 across every pending scope
  // means no human has ever vouched for this sender: render nothing rather than a promise.
  if (pending.every(r => !(Number(r.confirms) > 0))) return '';
  // One countdown per (sender, type). Name the type only when this sender has more than one
  // pending — otherwise the sender's own name is context enough.
  const bits = pending
    .map(r => ({ ...r, left: Math.max(1, (r.needed || 0) - (r.confirms || 0)) }))
    .sort((a, b) => a.left - b.left)
    .map(r => (mine.length > 1 && r.typeName)
      ? `${r.left} more ${escHtml(r.typeName).toLowerCase()}`
      : `${r.left} more`);
  const label = bits.length === 1 ? `${bits[0]} to file by itself` : `${bits.join(' · ')} to file by themselves`;
  return `<span class="qgh-ready near" title="Once this sender has enough confirmed documents, the rest that read cleanly file themselves. Confirming these counts towards that.">`
       + `${label}</span>`;
}

// Catch-up "Review them" filter: when armed, the queue list (grouped AND flat — both paths
// route through here) shows only the consent bar's candidates; the bar's own button clears it.
function _sweepVisibleQueue() {
  return _sweepFilterIds ? queue.filter(d => _sweepFilterIds.has(d.id)) : queue;
}

// The review queue's DISPLAY grouping: sender -> its docs, most attention-needing /
// largest piles first (stable WITHIN a sender, so the processed_at order holds). Shared
// by renderQueueList (DOM) and reviewDisplayOrder (the ↑/↓ nav) so they always agree.
function reviewDisplayGroups() {
  const groups = new Map();
  for (const doc of _sweepVisibleQueue()) {
    const key = reviewGroupKey(doc);     // slice 3: a garble groups under the company it is a garble of
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  const entries = [...groups.entries()].map(([supplier, docs]) => ({
    supplier, docs,
    need: docs.filter(d => isFlagged(d) || (d.missing_required_labels || '').trim()).length,
  }));
  // STABLE within a review session: order by HAS-attention (a boolean that only flips
  // when a group's LAST flagged doc clears) rather than the raw count, which would
  // reshuffle the list on every confirm. Then push the "not yet identified" (—) pile DOWN —
  // but only BELOW the attention term, so a FLAGGED unidentified batch still surfaces above
  // clean named piles and is never buried. Then biggest batch first, then name. This sort is
  // shared with reviewDisplayOrder (the ↑/↓ nav), so the list and the arrows stay in lockstep.
  entries.sort((a, b) =>
       (b.need > 0) - (a.need > 0)
    || (a.supplier === '—') - (b.supplier === '—')
    || b.docs.length - a.docs.length
    || a.supplier.localeCompare(b.supplier));
  return entries;
}

// Human display title for a sender group. The null-supplier pile's KEY stays '—' (shared by
// reviewDisplayGroups/reviewDisplayOrder + selectDoc's expand branch, so it MUST NOT change), but
// a bare "—" reads as broken to a first-time user. Show real copy instead, chosen by whether the
// pile stands alone (a whole cold-DB batch, no senders learned yet) or sits among named piles.
function groupTitle(supplier, groupCount) {
  if (supplier !== '—') return supplier;
  return groupCount <= 1 ? 'Your scanned documents' : 'Sender not identified';
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
  // ONE readiness verdict — the SAME window.ReviewReadiness.classify() that Home's "N ready to file"
  // and the File All dialog use. A row must NEVER wear a green "Looks good" while classify() would HOLD
  // it: an untyped doc ('noType'), a blank required detail — Date/Reference/Issuer — ('missing'), or a
  // flagged read ('flagged') are all "not ready" and colour as attention, not clean. Before this, the
  // badge computed its own severity from local signals and had NO type/issuer-blank leg, so an untyped
  // or blank-issuer doc could show green — the two-readiness-notions class reviewReadiness.js was built
  // to kill (the Home split + File All were unified; this row badge was the one surface left behind).
  // valuedOnly mirrors the File All / Home call so all three agree. Defensive fallback to the old local
  // signals if the classifier script isn't loaded (it always is in Review).
  const _cls = (window.ReviewReadiness && window.ReviewReadiness.classify)
    ? window.ReviewReadiness.classify(doc, { valuedOnly: !!window.__farValuedOnly })
    : (isFlagged(doc) ? 'flagged' : ((doc.missing_required_labels || '').trim() ? 'missing' : 'ready'));
  const noType     = _cls === 'noType';
  const blocked    = _cls === 'missing';   // a required detail (Date / Reference / Issuer) read empty
  const notReady   = _cls !== 'ready';
  const missingReq = (doc.missing_required_labels || '').split(',').map(s => s.trim()).filter(Boolean);
  let sev = '';   // '', 'high'(green), 'mid'(orange), 'low'(red)
  if (conf != null && conf < 40)  sev = 'low';     // critically low overall — independent top-priority signal
  else if (notReady)              sev = 'mid';      // any not-ready reason → attention (orange), never green
  else if (conf != null)          sev = 'high';     // truly ready + scored → clean green (ready-but-unscored → no badge)
  if (sev === 'low')      el.classList.add('qi-conf-low');
  else if (sev === 'mid') el.classList.add('qi-conf-mid');
  if (currentDoc && doc.id === currentDoc.id) el.classList.add('active');
  // Human-readable reason on hover: green = clean/ready, orange = held (no type / missing detail /
  // flagged), red = critically low confidence.
  const sevWord = sev === 'low'  ? 'Low confidence'
                : noType         ? 'No document type — can’t file yet'
                : blocked        ? 'Missing a required field — can’t file yet'
                : sev === 'mid'  ? 'Needs a quick check'
                :                  'Looks good';
  // HONEST BADGE: a held / un-fileable doc must NOT wear a reassuring "100%" — the overall score can
  // ignore the held reason (e.g. a branding-conflict issuer capped at 69, or an empty required role),
  // so a bare "100%" would contradict the warning beside it. For the orange (mid) state show the review
  // word, not the number; genuinely-low (red) keeps its honest number; clean (green) is unchanged.
  const confBadge = conf == null ? '' :
    sev === 'mid'
      ? `<span class="conf-badge mid" style="flex-shrink:0;" title="${sevWord} — overall ${conf}%, but this can’t file yet">Check</span>`
      : `<span class="conf-badge ${sev}" style="flex-shrink:0;" title="${sevWord} — ${conf}% confidence${sev === 'high' && doc.status !== 'confirmed' ? ' · waiting for your OK' : ''}">${conf}%</span>`;
  // Lead with the concrete blocker: the missing type, the missing field(s), or a blank issuer.
  const _blockerText = noType
    ? 'Needs: a document type'
    : blocked
      ? (missingReq.length
          ? `Needs: ${missingReq[0]}${missingReq.length > 1 ? ` +${missingReq.length - 1} more` : ''}`
          : 'Needs: Document Issuer')   // classify()='missing' via issuer_blank with no required-label list
      : '';
  const blockerLine = _blockerText
    ? `<div class="qi-blocker" title="Can’t be filed until this is filled in"
           style="color:var(--warn); font-size:11px; font-weight:600; margin-top:2px; display:flex; align-items:center; gap:4px;">`
      + `<span aria-hidden="true">⚠</span>${escHtml(_blockerText)}</div>`
    : '';
  // Put-back marker (mig 87, Oracle W/COND cond 4): a put-back doc is a visible class BEFORE any File All
  // click. A refileable one (still clears the strict predicate) says it WILL re-file; a held one says it
  // waits for the user. OFF → putback_refileable is never set, so a put-back doc shows the plain "put back".
  const putBackChip = doc.put_back_at
    ? (doc.putback_refileable
        ? `<span class="qi-putback refiling" title="You put this back to look at it. It still reads clean, so File All Ready will file it again — you can undo that from the activity strip.">↩ will re-file</span>`
        : `<span class="qi-putback" title="You put this back — confirm it yourself to file it.">↩ put back</span>`)
    : '';
  el.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:8px;">
      <img class="qi-thumb" alt="">
      <div style="flex:1; min-width:0;">
        <span class="qi-name" title="${escHtml(doc.original_filename)}">${escHtml(doc.original_filename)}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="qi-supplier" style="flex:1; min-width:0;">${escHtml(doc.supplier_name || 'Sender not identified')}${reviewGroupChip(doc)}</span>
          ${putBackChip}
          ${doc.page_count > 1 ? `<span class="qi-multipage" title="Multi-page document (${doc.page_count} pages)" style="flex-shrink:0;display:inline-flex;color:var(--muted)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg></span>` : ''}
          ${confBadge}
        </div>
        ${blockerLine}
      </div>
      ${canEdit ? `<button class="qi-btn danger qi-delete" title="Delete this row's document" aria-label="Delete this row's document" style="flex-shrink:0; padding:2px 7px; font-size:13px;">&#215;</button>` : ''}
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
    empty.style.display = 'block';   // 'block', not '' — see renderQueueList's empty branch
    empty.textContent = 'Nothing set aside. Documents you press "↻ Defer" on wait here until you come back to them.';
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
          <span class="qi-supplier">${escHtml(doc.supplier_name || 'Sender not identified')}</span>
        </div>
        <div style="display:flex; gap:3px; flex-shrink:0;" onclick="event.stopPropagation()">
          <button class="qi-btn qi-review-now" title="Move back to review queue" style="padding:2px 6px; font-size:10px;">Review</button>
          <button class="qi-btn danger qi-delete" title="Delete this row's document" aria-label="Delete this row's document" style="padding:2px 7px; font-size:13px;">&#215;</button>
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
      // Same mismatch-aware copy as deleteFromQueue (Chris round-8 card 1) — a deferred row's ×
      // deletes that row's doc, which need not be the one open on the right.
      const _other = (currentDoc && currentDoc.id !== doc.id)
        ? `\n\nNote: this is the document in the row you clicked — NOT "${currentDoc.original_filename}", the document open on the right.`
        : '';
      if (!confirm(`Delete "${doc.original_filename}"?${_other}\n\nIt goes to the app's recycle bin — you can restore it from Search.`)) return;
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
  // Dismiss a lingering class-fix RECEIPT when the operator moves to another document (bug fix 2026-08-23:
  // it had no close and lingered long after the doc left). The 'ask' phase is a pending decision — leave it;
  // during a File All run (bulkFiling) selectDoc churns, so skip.
  if (_classFixState && _classFixState.phase !== 'ask' && doc && _classFixState.documentId !== doc.id && !bulkFiling) {
    _classFixState = null; renderClassFixBar();
  }
  // Grouped mode: make sure the doc's sender group is EXPANDED before we select — the
  // active-row highlight is toggled on the rendered element (_selectDoc), so a doc in a
  // collapsed group would have no row to light up. Covers confirm-advance / keyboard nav
  // stepping into the next group.
  if (queueGrouped && doc) {
    const key = reviewGroupKey(doc);     // slice 3: same key as reviewDisplayGroups (lockstep)
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
  clearedByIssuerChange = new Set();   // doc-scoped, like corrections
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
  _updateSenderFieldsBtn();
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
    _currentPageMissing = false;   // bulk never loads the preview — the SERVER no-page guard covers it
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
    // card 1: a review-queue doc always has a backing file (working_path, or its original in
    // folder_path). If none rendered, the page is genuinely GONE — flag it so Confirm is blocked
    // and the placeholder says so (not just "No preview available"). doc.has_page, when the queue
    // read provides it, avoids flagging a doc that legitimately never had an image.
    const _shouldHavePage = !!(doc.working_path || (doc.folder_path && doc.original_filename));
    _currentPageMissing = _shouldHavePage && pageImages.length === 0;
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
    // ONE shared refuse-class matcher (Oracle cond 2, 2026-08-01): covers the LEGACY copy
    // ("…doesn't match this supplier's saved layout") AND the reworded copy shipped with the
    // R1 deadlock cure ("Couldn't match this document to the supplier's saved <Type> layout…").
    // The reword silently broke this live suppressor for an hour (matcher knew only the old
    // wording) — keep the two in lockstep with the gate matchers (demo_notes_gate et al).
    // Class-scoped by design: this must never widen into a generic "hide notes the re-check
    // disagrees with" mechanism (that would be the SENT-BACK Option B one note at a time).
    const _STALE_TYPE_NOTE = /doesn't match this supplier's saved layout|match this document to (?:the supplier's|a) saved/i;
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

  // (LIVE field visibility for a "No template match" doc is resolved SERVER-SIDE in
  // get-document-with-extractions, so renderedDoc.hidden_fields is already correct here. The renderer
  // only re-resolves on a LIVE issuer edit — see _resolveFieldVisibility on the issuer blur/teach hooks.)

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

  // Fast on-open re-extract (Slice B, DARK — inert unless `reextract_fast_enabled`). Fire-and-forget
  // AFTER the fields are painted: refresh the EMPTY, non-anchored fields from this doc's already-cached
  // OCR without a reprocess, surfacing each as an unconfirmed PILL suggestion. Skipped in fieldsOnly
  // (bulk). See _scheduleReextractFast — debounced, doc-guarded, edit-guarded; the kill-switch OFF path
  // returns {ok:false} so this is a no-op end-to-end.
  if (!fieldsOnly) _scheduleReextractFast(doc.id);
}

// ── Page rendering ────────────────────────────────────────────────────────────
function renderPage() {
  hideAnchorReadout();   // a stale readout/box doesn't belong on a freshly rendered page
  const placeholder = document.getElementById('doc-placeholder');
  const indicator   = document.getElementById('page-indicator');

  if (!pageImages || pageImages.length === 0) {
    docImgWrap.style.display  = 'none';
    placeholder.style.display = '';
    placeholder.textContent   = !currentDoc ? 'Select a document from the queue'
      : _currentPageMissing ? 'The scanned page for this document is no longer available. Its details are still here, but there is nothing to file.'
      : 'No preview available';
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
    // All-boxes is a MODE: re-draw it for the page just rendered (the canvas was resized and
    // cleared above), so paging through a document keeps showing each page's own crop regions.
    if (typeof _allBoxesOn !== 'undefined' && _allBoxesOn) { try { drawAllTraceBoxes(); } catch (_) {} }
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
  // The word rides a <span class="lbl"> so the narrow-window container query (index.html #doc-toolbar) can
  // collapse the button to its glyph — this rewrite must keep the wrapper the markup ships with.
  btn.innerHTML = straightened ? '&#8734; <span class="lbl">Straightened</span>' : '&#8734; <span class="lbl">Straighten</span>';
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

// The 0-based page indices the preview should show, honouring the Range selection
// (empty/invalid range ⇒ all pages, matching the print behaviour where null = all).
function _selectedPageIndices() {
  const n = (pageImages && pageImages.length) || 0;
  const all = Array.from({ length: n }, (_, i) => i);
  if (document.getElementById('print-pages-mode')?.value !== 'range') return all;
  const ranges = _parsePageRanges(document.getElementById('print-pages-range')?.value, n);
  if (!ranges) return all;
  const set = new Set();
  for (const r of ranges) for (let i = r.from; i <= r.to; i++) if (i >= 0 && i < n) set.add(i);
  return [...set].sort((a, b) => a - b);
}

// Re-render the preview to REFLECT the modal's settings — mono (greyscale), page range
// (only those pages), and pages-per-sheet (N-up grid). Copies/Sides have no visual, so
// they're not shown. Purely visual: the real print still sends the vector PDF + options.
// Default (colour / all / 1-up) renders identically to the plain page images.
function _renderPrintPreview() {
  const pane = document.getElementById('print-preview-pane');
  if (!pane) return;
  pane.innerHTML = '';
  const note = (txt) => {
    const d = document.createElement('div');
    d.style.cssText = 'color:var(--muted); font-size:12px; padding:24px;';
    d.textContent = txt; pane.appendChild(d);
  };
  if (!pageImages || !pageImages.length) return note('Preview unavailable — you can still print the document.');
  const mono = document.getElementById('print-color')?.value === 'false';
  const nup  = Math.max(1, parseInt(document.getElementById('print-nup')?.value, 10) || 1);
  const pages = _selectedPageIndices();
  if (!pages.length) return note('No pages in that range.');
  const monoCss = mono ? 'filter:grayscale(1);' : '';
  if (nup === 1) {
    for (const i of pages) {
      const img = document.createElement('img');
      img.src = pageImages[i]; img.alt = `Page ${i + 1}`;
      img.style.cssText = 'max-width:100%; box-shadow:0 2px 10px rgba(0,0,0,.2); background:#fff;' + monoCss;
      pane.appendChild(img);
    }
    return;
  }
  // N-up: group pages into page-shaped "sheets", each a grid in reading order.
  const cols = Math.ceil(Math.sqrt(nup));
  for (let s = 0; s < pages.length; s += nup) {
    const sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%; max-width:100%; box-sizing:border-box; background:#fff; '
      + 'box-shadow:0 2px 10px rgba(0,0,0,.2); padding:6px; display:grid; gap:6px; '
      + `grid-template-columns:repeat(${cols},1fr);`;
    for (const i of pages.slice(s, s + nup)) {
      const img = document.createElement('img');
      img.src = pageImages[i]; img.alt = `Page ${i + 1}`;
      img.style.cssText = 'width:100%; height:auto; display:block; background:#fff;' + monoCss;
      sheet.appendChild(img);
    }
    pane.appendChild(sheet);
  }
}

const _printModal = document.getElementById('print-modal');
function _closePrintModal() { if (_printModal) _printModal.style.display = 'none'; }

async function _openPrintModal() {
  if (!currentDoc?.id || !_printModal) return;
  const msg = document.getElementById('print-modal-msg');
  if (msg) msg.textContent = '';
  // Always re-enable the action buttons on (re)open — an in-flight print may have left them disabled.
  { const g = document.getElementById('print-modal-go'); if (g) g.disabled = false;
    const d = document.getElementById('print-modal-dialog'); if (d) d.disabled = false; }
  // Preview pane — reflects the current settings (mono / range / N-up).
  _renderPrintPreview();
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
  const payload = { docId: currentDoc.id, source: 'original', silent, deviceName, copies, pageRanges, duplexMode, color, pagesPerSheet };
  const reenable = () => { if (go) go.disabled = false; if (dlg) dlg.disabled = false; };

  if (!silent) {
    // "Advanced printing": hand off ENTIRELY to Windows' own driver dialog. CLOSE our modal so that
    // dialog is the SOLE print surface (owner-directed 2026-07-18) — no competing overlay to fight it
    // for z-order. The main process forces that dialog TOPMOST so it stays above the app when clicked
    // (modules/print/handler.js). The print callback is unreliable (fires on a successful print but not
    // always on cancel / virtual-printer prompts), so we don't await a result to keep any UI alive;
    // feedback + errors surface as a toast since the modal is gone. A cancel is silent (the dialog handled it).
    reenable();               // clear the disabled state before closing so a later reopen isn't stuck
    _closePrintModal();
    showToast?.('Opening your printer’s dialog…');
    window.docusnap.printDocument(payload).then((res) => {
      if (res && res.ok) showToast?.('Sent to your printer.');
      else if (res && res.reason === 'disabled') showToast?.('Printing is turned off in Settings.', 'warn');
      else if (res && res.reason === 'file_missing') showToast?.("Couldn't find this document's file.", 'err');
      // cancelled / closed / no callback: nothing to report — the dialog handled it.
    }).catch(() => {});
    return;
  }

  // Silent quick-print. Electron's print callback is UNRELIABLE — it may not fire on a user
  // cancel, on a virtual printer's "Save as…" prompt (Microsoft Print to PDF), or even on a
  // normal real-printer job (owner saw it hang on the Ricoh). So NEVER lock the modal waiting
  // on it: report the outcome IF/WHEN the callback lands, but a watchdog re-enables the modal
  // so a slow/absent callback can't freeze it. The vector PDF still spools regardless.
  let settled = false;
  const done = (apply) => { if (settled) return; settled = true; reenable(); if (apply) apply(); };
  window.docusnap.printDocument(payload).then((res) => {
    done(() => {
      if (res && res.ok) { _closePrintModal(); showToast?.('Sent to your printer.'); }
      else if (res && res.outcome === 'cancelled') { if (msg) msg.textContent = 'Cancelled.'; }
      else if (res && res.reason === 'file_missing') { if (msg) msg.textContent = "Couldn't find this document's file."; }
      else if (res && res.reason === 'disabled') { if (msg) msg.textContent = 'Printing is turned off in Settings.'; }
      else { if (msg) msg.textContent = "Couldn't print this document."; }
    });
  }).catch(() => done(() => { if (msg) msg.textContent = "Couldn't print this document."; }));
  setTimeout(() => done(() => { if (msg) msg.textContent = 'Sent to your printer — complete any prompt it shows.'; }), 4000);
}

document.getElementById('btn-print-doc')?.addEventListener('click', _openPrintModal);
document.getElementById('print-modal-close')?.addEventListener('click', _closePrintModal);
document.getElementById('print-modal-go')?.addEventListener('click', () => _doModalPrint(true));
document.getElementById('print-modal-dialog')?.addEventListener('click', () => _doModalPrint(false));
document.getElementById('print-pages-mode')?.addEventListener('change', (e) => {
  const r = document.getElementById('print-pages-range');
  if (r) r.style.display = e.target.value === 'range' ? '' : 'none';
  _renderPrintPreview();   // All ⇄ Range changes which pages show
});
// Live-update the preview as the visual settings change (mono / range text / N-up).
document.getElementById('print-color')?.addEventListener('change', _renderPrintPreview);
document.getElementById('print-nup')?.addEventListener('change', _renderPrintPreview);
document.getElementById('print-pages-range')?.addEventListener('input', _renderPrintPreview);
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

  // Plain words on the chip, technical term in the tooltip (Chris, card 4): a standard
  // user reads "Recognised by: its logo and wording"; the hover keeps the admin detail.
  let idLabel, idCls, idTip;
  if (hasTemplate && hasLogo && hasKw)  { idLabel = 'Its logo and wording'; idCls = 'ok';   idTip = 'Matched a saved template by logo & keyword fingerprint'; }
  else if (hasTemplate && hasLogo)      { idLabel = 'Its logo';             idCls = 'info'; idTip = 'Matched a saved template by its logo'; }
  else if (hasTemplate && hasKw)        { idLabel = 'Its wording';          idCls = 'info'; idTip = 'Matched a saved template by its keyword fingerprint'; }
  else if (hasTemplate)                 { idLabel = 'A saved layout';       idCls = 'info'; idTip = 'Matched a saved template'; }
  else if (recheck?.matched)            { idLabel = `Layout available: ${recheck.templateName}`; idCls = 'info'; idTip = 'A saved template matches this layout — reprocess to apply it'; }
  else                                  { idLabel = 'Not seen before';      idCls = 'warn'; idTip = 'No saved template matched this document'; }

  // ── Extraction method summary ──────────────────────────────────────────────
  // Strip +corrected/+denoised suffixes, then categorise each field's method.
  const baseMethods = (doc.extractions || [])
    .map(e => (e.extraction_method || '').split('+')[0].trim().toLowerCase())
    .filter(Boolean);

  const mappingN  = baseMethods.filter(m => m.startsWith('template_mapping')).length;
  const anchorN   = baseMethods.filter(m => m.startsWith('anchor')).length;
  const keywordN  = baseMethods.filter(m => m === 'keyword').length;
  const knownN    = baseMethods.filter(m => m && m !== 'unknown').length;

  let extLabel, extCls, extTip;
  if (knownN === 0)                              { extLabel = 'Unknown';              extCls = 'muted'; extTip = ''; }
  else if (mappingN > 0 && mappingN >= Math.max(anchorN, keywordN)) {
                                                   extLabel = 'Taught positions';     extCls = 'ok';   extTip = 'Template mappings — the boxes drawn when this layout was taught'; }
  else if (anchorN > 0 && anchorN >= keywordN)  { extLabel = 'Remembered positions'; extCls = 'info'; extTip = 'Learned anchors — positions learned from your confirmations'; }
  else if (keywordN > 0)                         { extLabel = 'Printed labels';       extCls = 'info'; extTip = 'Keyword patterns — values found beside their printed labels'; }
  else                                           { extLabel = 'A mix of methods';     extCls = 'info'; extTip = ''; }

  // ── Render ─────────────────────────────────────────────────────────────────
  const pill = (text, cls, tip) => {
    const s = document.createElement('span');
    s.className   = `method-pill ${cls}`;
    s.textContent = text;
    if (tip) s.title = tip;
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

  el.appendChild(row('Recognised by:', pill(idLabel, idCls, idTip)));
  const extPills = [pill(extLabel, extCls, extTip)];
  if (mappingN > 0) extPills.push(pill(`${mappingN} taught field${mappingN === 1 ? '' : 's'}`, 'ok', 'Fields read from the taught template mapping'));
  el.appendChild(row('Fields read by:', ...extPills));

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
  // Chris r13 card 5: the first-ever teach raised "Teach this as a NEW document? … Template Manager"
  // because `known` only means "the page has a fingerprint". The duplicate guard is about a sender
  // you have ALREADY taught — so remember whether any template carries this sender's name, and ask
  // only then, in plain words.
  let _senderHasTemplate = false;
  const _docSupplierNorm = String(doc.supplier_name || '').trim().toLowerCase();
  if (likeSel && likeGo) {
    window.docusnap.getTemplates?.().then(list => {
      const tmpls = Array.isArray(list) ? list : (list && list.templates) || [];
      _senderHasTemplate = !!_docSupplierNorm && tmpls.some(t => String(t.supplier_name || '').trim().toLowerCase() === _docSupplierNorm);
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
    if (known && _senderHasTemplate && !confirm(
      `You've taught ${String(doc.supplier_name || 'this sender').trim()} before.\n\n` +
      'Teach this as ANOTHER layout from them? If it is really the same layout, press Cancel ' +
      'and check Settings → Templates instead, so a duplicate isn\'t created.')) return;
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
  // review_flag_count (notes / correction candidates) ALWAYS flags — pinned; the two-tier rule
  // only narrows the below-threshold leg to VALUED reads (see window.__farValuedOnly above).
  const below = window.__farValuedOnly ? doc?.below_threshold_valued_count : doc?.below_threshold_count;
  return (doc?.review_flag_count || 0) > 0 || (below || 0) > 0;
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
// Auto-file config, cached for the "why is this clean doc waiting?" explanation below.
// Defaults MIRROR the backend (_maybeAutoFile): auto_file_full_confidence 'true',
// auto_file_threshold 100. Read once per window; the panel is advisory, so a stale value
// after a settings change costs nothing but a reopen.
let _autoFileCfg = { enabled: true, threshold: 100 };
// Card 4 (Chris R5), DARK: the blank-issuer "these look like X?" offer at Confirm & File. Default OFF
// (setting issuer_suggest_on_blank_confirm) — needs the corpus census (does the suggested name match
// the confirmed supplier on the owner's backup?) + Oracle ratify before any flip. OFF ⇒ the confirm
// door is byte-identical (the bare "file anyway → Unknown Company" dialog).
let _issuerBlankOfferOn = false;
async function loadAutoFileConfig() {
  try {
    const [en, thr, blankOffer] = await Promise.all([
      window.docusnap.getSetting('auto_file_full_confidence'),
      window.docusnap.getSetting('auto_file_threshold'),
      window.docusnap.getSetting('issuer_suggest_on_blank_confirm'),
    ]);
    _autoFileCfg.enabled = String(en ?? 'true') !== 'false';
    const n = parseInt(thr ?? '100', 10);
    _autoFileCfg.threshold = Number.isFinite(n) && n >= 1 ? n : 100;
    _issuerBlankOfferOn = String(blankOffer ?? 'false') === 'true';
  } catch { /* keep the backend-mirroring defaults */ }
}

// A document with NOTHING flagged still sits in Review when it didn't reach the auto-file
// threshold — and until now the panel said nothing at all, so a clean 98% doc looked stuck for
// no reason while its 100% siblings filed themselves (owner report, 2026-07-20: 9 of 20 filed,
// the rest waited silently). Say why, in the user's own numbers, and point at the setting.
// ⚠ This used to claim "truthful by construction: a clean doc that is WAITING always sits below the
// user's threshold". That is FALSE whenever graduation is active — a trusted scope's effective floor
// is min(user threshold, 95), so a doc at 97 can sit ABOVE its floor and still be held by the
// structural gate. The threshold-derived copy below is therefore only correct for a genuine
// below-floor hold; every other case is answered by the real verdict at the top of the function.
// The REAL verdict for the doc on screen, fetched alongside it (null until it arrives, and null
// for a doc the predicate can't judge). Populated by loadHoldReason below.
let _holdVerdict = null;
// Chris r7 new card A: after a TYPE change the fetched verdict is stale AND the readiness copy below can't
// be re-derived honestly from the old type's confidence (a 91% worksheet re-typed to Invoice read "Ready to
// file" over "please fill in Invoice Date and Invoice Number"). While this is set the panel shows a neutral
// "type changed — check the fields" lead; the next document load (or a saved confirm) clears it.
let _typeChangedUnsaved = false;

// Plain-English name for the field a gate refused on, using the on-screen label where we have one.
function _holdFieldLabel(key) {
  if (!key) return null;
  const f = (fieldDefs || []).find(x => x.key === key);
  return (f && f.label) || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderCleanHoldReason(el, doc) {
  const conf = Number(doc.overall_confidence);
  const thr  = _autoFileCfg.threshold;
  let lead, cue, hint = '';
  // THE REAL REASON FIRST (Oracle, 2026-07-20). Everything below re-derives a reason from the
  // confidence threshold, which is only correct when the threshold is genuinely what is holding
  // the doc. It was wrong in BOTH directions: a doc refused by the structural gate was told to
  // lower a threshold that cannot help it, and a graduated doc sitting ABOVE its floor was told
  // "Ready to file" — asserting readiness for a document the predicate had refused. Never invent
  // a reason when the authoritative one is available.
  const v = _holdVerdict;
  // Chris r7 card A: an UNSAVED type change — say so, name what the new type needs, promise nothing.
  if (_typeChangedUnsaved) {
    const _typeName = (allDocTypes.find(t => t.slug === selectedTypeSlug) || {}).name || 'the new type';
    el.classList.add('rr-calm');
    el.innerHTML = `<div class="rr-lead">Type changed to <strong>${escHtml(_typeName)}</strong> — check the fields below; a field the new type needs may be empty. The app re-checks this document when you confirm.</div>`
                 + `<div class="rr-cues"><span class="rr-cue info">Waiting for your check</span></div>`
                 + `<div class="rr-hint">Switching the type back restores what was read under it.</div>`;
    el.hidden = false;
    return;
  }
  // Chris round 18 A3: the user put this one back — say so, and say what ends the hold.
  if (v && !v.eligible && v.kind === 'put-back') {
    el.classList.add('rr-calm');
    el.innerHTML = `<div class="rr-lead">You put this document back — it won't file itself until you confirm it.</div>`
                 + `<div class="rr-cues"><span class="rr-cue info">Put back by you</span></div>`
                 + `<div class="rr-hint">Check the values and press Confirm to file it; Reprocess re-reads it but still waits for you.</div>`;
    el.hidden = false;
    return;
  }
  if (v && !v.eligible && v.kind && v.kind !== 'below-floor') {
    const fieldName = _holdFieldLabel(v.field);
    // COLD-START COUNTDOWN (2026-08-18): when the honest reason is "I have not confirmed enough
    // documents from this sender yet", say THAT and say what clears it. "Couldn't be checked
    // automatically" is true but useless — it reads as a defect, and the customer's only visible
    // lever becomes Reprocess All, which re-reads 200 pages and changes nothing (measured: the
    // same answer ~92% of the time). Nothing here is a gate; the counts come from the same
    // predicate's advisory payload.
    const _need = Number.isFinite(v.confirmsNeeded) ? v.confirmsNeeded : null;
    const _have = Number.isFinite(v.scopeConfirms)  ? v.scopeConfirms  : null;
    const _left = (_need != null && _have != null) ? Math.max(1, _need - _have) : null;
    const _sender = String(doc.supplier_name || '').trim();
    // Chris round 18 A6: the field the gate refused on may be FOREIGN to this type — read at import
    // against every installed type's keys, invisible on this panel, dropped only at confirm (the
    // 07-22 foreignFields rule: a foreign row still holds at gate time). Naming a field the user
    // can't see ("Customer Name couldn't be checked" on a worksheet) reads as a defect — say what it
    // is and what clears it instead.
    const _foreign = !!(v.field && Array.isArray(fieldDefs) && fieldDefs.length && !fieldDefs.some(x => x.key === v.field));
    const why = {
      'unverifiable-value': _foreign
        ? `the app also read a <strong>${escHtml(fieldName)}</strong> on the page — a detail this document type doesn't use — `
          + `and couldn't check it. It isn't shown here and won't be filed; confirming the document clears it.`
        : _left != null
        ? `this is only the ${['first', 'second', 'third', 'fourth', 'fifth'][_have] || `${_have + 1}th`} document `
          + `${_sender ? `from <strong>${escHtml(_sender)}</strong>` : 'from this sender'}, so there isn't `
          + `enough confirmed history yet to check <strong>${escHtml(fieldName || 'its details')}</strong> `
          + `on its own. Confirm ${_left === 1 ? 'this one' : `${_left} more`} and the rest from this sender `
          + `can start filing themselves.`
        : fieldName
          ? `<strong>${escHtml(fieldName)}</strong> couldn't be checked automatically, so this one is waiting for your eye.`
          : 'one of the values couldn\'t be checked automatically, so this one is waiting for your eye.',
      'flagged': fieldName
        ? `<strong>${escHtml(fieldName)}</strong> was flagged by a formatting check.`
        : 'a value was flagged by a formatting check.',
      // The note is OBSOLETE and the app knows it (Review already hides it) — but the stored row
      // still holds the document, so say so plainly and point at the one-document re-read that
      // clears it. Never at "Reprocess all": re-reading 200 pages to clear one stale note is the
      // loop the owner asked us to kill.
      'stale-layout-note': 'it was read before this sender\'s layout was taught, and that old note '
        + 'is still attached to it. The note is out of date — <strong>Reprocess</strong> just this '
        + 'document (the button below) to clear it, or confirm it and it files anyway.',
      'no-template': 'this layout hasn\'t been matched to a template yet.',
      // r19 (d): the box and the page's own text disagree on a filing-critical value
      'disagreeing-read': fieldName
        ? `the page reads <strong>${escHtml(fieldName)}</strong> two ways — the taught box and the page's own text don't agree — so this one waits for your eye.`
        : 'the page reads a filing detail two ways, so this one waits for your eye.',
      'no-type': 'it has no document type yet.',
      'generic-type': 'General Documents are always checked by a person before filing.',
      // The critical-floor hold (trust.js weak-critical-field): a filing-critical field was read
      // below the automatic-filing bar. Copy names the FIELD from the real verdict and gives NO
      // threshold advice (the floor applies at every threshold — Oracle C7); the shared hint
      // below already says the confidence setting can't file it.
      'weak-critical-field': fieldName
        ? `<strong>${escHtml(fieldName)}</strong> wasn't read certainly enough for automatic `
          + `filing, so this one is waiting for your eye. If the value is wrong, `
          + `teaching it (&#8853;) usually fixes it for good — if it's right, just confirm.`
        : "a filing field wasn't read certainly enough for automatic filing.",
    }[v.kind] || 'an automatic check didn\'t pass.';
    el.classList.add('rr-calm');
    // On the cold-start countdown the closing hint would otherwise contradict the lead: the lead
    // explains that confirming a couple more unlocks the sender, so the cue reports PROGRESS
    // rather than repeating "waiting for your check".
    const _cue = (_left != null && _need)
      ? `${_have} of ${_need} confirmed from this sender`
      : (Number.isFinite(conf) ? `Overall ${conf}% · waiting for your check` : 'Waiting for your check');
    const _tail = (_left != null)
      ? `Confirm it and it files — and it counts towards this sender filing on its own.`
      : `Confirm it and it files. This isn't the confidence setting — changing that won't file this one.`;
    el.innerHTML = `<div class="rr-lead">Nothing looks wrong — ${why}</div>`
                 + `<div class="rr-cues"><span class="rr-cue info">${_cue}</span></div>`
                 + `<div class="rr-hint">${_tail}</div>`;
    el.hidden = false;
    return;
  }
  if (!_autoFileCfg.enabled) {
    lead = 'Nothing was flagged on this document — it\'s waiting because automatic filing is turned off.';
    cue  = 'Ready to file';
    hint = 'Turn it on in Settings → Processing to let clean documents file themselves.';
  } else if (Number.isFinite(conf) && conf < thr) {
    // Chris r5 card 4: "just below" only when it IS (gap ≤5); and when the identity field
    // is empty, SAY SO — an empty required box dragging the overall down while every visible
    // field reads High was the confusing case. "Pulls the score down", never "so it scores
    // N%" — we don't compute the counterfactual, so we don't claim the arithmetic (bob).
    const _issuerEmpty = !String(doc.supplier_name || '').trim();
    lead = _issuerEmpty
      ? `The Document Issuer box is still empty — an empty box pulls the overall score down. `
        // "you've set" blamed the operator for a DEFAULT they never chose (Chris round 9).
        + `Read at ${conf}%, below the ${thr}% needed to file without a check, so it's waiting for you.`
      : `Nothing was flagged — this was read at ${conf}%, ${thr - conf <= 5 ? 'just below' : 'below'} the ${thr}% you've set for `
        + 'filing without a check, so it\'s waiting for you.';
    cue  = `Read at ${conf}% · your setting ${thr}%`;
    // Chris r13 card 6: a doc with an EMPTY required field (date/reference) can't be filed by
    // any bar — pointing at the threshold sends the user to a setting that cannot help.
    const _missingReq = (doc.missing_required_labels || '').split(',').map(x => x.trim()).filter(Boolean);
    hint = _issuerEmpty
      ? 'Filling it in usually fixes this — type the company name, or use ⊕ to teach where it sits.'
      : (_missingReq.length
          ? `Fill in ${_missingReq.join(' and ')} — a document can't file until its required details are in, whatever the bar.`
          : `If documents like this are consistently right, lower the auto-file bar in Settings → Processing.`);
    // D (Chris night-round #3, Oracle SIGN-OFF-W/COND): the ORPHAN — this doc read below the bar while
    // its SENDER has since graduated (its siblings now file themselves). It was read BEFORE the layout
    // was learned, so a re-read lifts it — "lower the bar" is the wrong advice here. Point at Reprocess
    // (the fix Chris found only by luck). Fails safe: no scope-readiness / not graduated → generic hint
    // stands. Kept off the empty-issuer / missing-required cases (their own hint is the real fix).
    const _nrm = s => String(s || '').trim().toLowerCase();
    const _senderGraduated = Array.isArray(_scopeReadiness) && _scopeReadiness.some(r =>
      r && r.graduated && _nrm(r.supplier) === _nrm(doc.supplier_name)
      && (!doc.type_slug || !r.slug || r.slug === doc.type_slug));
    if (_senderGraduated && !_issuerEmpty && !_missingReq.length) {
      hint = 'Other documents from this sender now file themselves — this one was read before that. '
           + 'Press Reprocess (below, under “This document”) to re-read it, and it should file too.';
    }
  } else {
    lead = 'Nothing was flagged on this document — check the values and confirm to file it.';
    cue  = 'Ready to file';
  }
  el.classList.add('rr-calm');
  el.innerHTML = `<div class="rr-lead">${escHtml(lead)}</div>`
               + `<div class="rr-cues"><span class="rr-cue info">${escHtml(cue)}</span></div>`
               + (hint ? `<div class="rr-hint">${escHtml(hint)}</div>` : '');
  el.hidden = false;
}

// "Add '<detected type>'" from the untyped-document notice. Opens the PRESET catalog with that
// type pre-ticked (most missing types are presets — Delivery Note, Statement, Remittance), falling
// back to the full type builder with the name prefilled when it isn't one.
//
// THEN REPROCESSES, and that is the load-bearing part (Oracle C3). The extraction ran against the
// union of ALL installed types' field keys, so the new type's own fields (delivery_note_number…)
// were never extracted. The existing add-a-type tail auto-SELECTS the new slug, and the dropdown
// handler rebuilds the rows by matching key — which for a freshly-added type matches nothing, so
// every field on screen goes BLANK with Confirm still disabled. The user clicks a helpful-looking
// button and lands somewhere that looks worse. Re-reading the document with the type installed is
// the only thing that actually fills those fields.
//
// Safe by construction: reprocess forces status='needs_review' (processing/handler.js) and
// _maybeAutoFile has exactly ONE call site — the import file_done path — so nothing here can file
// a document. The human checkpoint stays put.
async function _addDetectedType(detName) {
  if (!detName || !isAdmin) return;
  const afterAdd = () => {
    showToast(`“${detName}” added — reading this document again…`, 'ok');
    // Reuse the existing Reprocess button rather than calling reprocessDocument directly, so this
    // inherits its in-flight guards, progress wiring and post-reprocess refresh (same pattern as
    // the grouped-template path).
    document.getElementById('btn-reprocess')?.click();
  };
  let catalog = [];
  try { catalog = await window.docusnap.getDoctypeCatalog(); } catch { catalog = []; }
  const preset = (Array.isArray(catalog) ? catalog : [])
    .find(p => p && p.name && p.name.toLowerCase() === detName.toLowerCase() && !p.already_present);
  if (preset) openTypeCatalogModal(afterAdd, detName);
  else {
    _newTypeToast(`“${detName}” isn't one of the ready-made types — create it here, then the `
                + `document will be read again.`);
    openNewTypeModal(afterAdd, detName);   // card 5: pre-fill the name we already detected
  }
}

// Lever A (2026-08-20, Chris round-10 card #3): the template-identity FILL note is NOT a
// "formatting check" — it means the company was INFERRED (no clean letterhead read), and it holds
// the doc out of auto-file. Surface it as ACTIONABLE guidance (check + confirm + the per-sender
// reprocess) instead of the opaque generic bucket, and COMPOSE with any other genuine flags rather
// than hiding them (Oracle condition 2). These two strings are PINNED EQUAL to engine.py
// _TEMPLATE_IDENTITY_FILL_NOTE_{SINGLE,MAJORITY} (test_review_inferred_identity_reason.js reads
// engine.py and asserts equality) — a reword there without updating here would re-bury the note.
const INFERRED_IDENTITY_NOTES = [
  'Company inferred from one previously filed document — please confirm before filing.',
  'Company inferred from previously filed documents on this layout — please confirm before filing.',
];
function isInferredIdentityNote(note) {
  const t = String(note || '').trim();
  return INFERRED_IDENTITY_NOTES.some(c => t === c);
}

function renderReviewReason(doc) {
  const el = document.getElementById('review-reason');
  if (!el) return;
  el.innerHTML = '';
  el.hidden    = true;
  el.classList.remove('rr-calm');
  if (!doc) return;

  // NO TYPE = the whole reason it's here, and it must be said FIRST (Oracle C1, 2026-07-20).
  // Everything below this branch is wrong for an untyped document:
  //   • below_threshold_count JOINs fields ON f.document_type_id = d.document_type_id
  //     (documents.js getReviewQueue), so with a NULL type it is STRUCTURALLY always 0;
  //   • flagN is 0 too, so the doc fell through to renderCleanHoldReason, which told the user
  //     "read at 93%, just below the 100% you've set — lower the threshold in Settings".
  // That advice is FALSE for every null-type doc: trust.js isAutoFileEligible refuses with
  // 'no-type' at ANY confidence and ANY threshold, so lowering the slider to 0 changes nothing.
  // Sending a user to a setting that cannot possibly help is worse than saying nothing.
  // Deliberately gated on the TYPE, not on any detected-name enrichment — the advice is wrong
  // for EVERY untyped doc, including the ones where detection returned nothing at all.
  if (!doc.document_type_id && (doc.status === 'needs_review' || doc.status === 'deferred')) {
    // ENRICHMENT ONLY (mig 51): when the pipeline named a type this install doesn't have, say so
    // and offer to add it. The BRANCH above does not depend on this — an untyped doc with no
    // detected name still gets the correction, which is the common case.
    const detName = (doc.detected_type_name || '').trim();
    el.classList.add('rr-calm');
    el.innerHTML =
        `<div class="rr-lead">`
      + (detName
          ? `This looks like a <strong>${escHtml(detName)}</strong>, but you don't have that `
            + `document type yet — so it can't be filed, and it will never file itself `
            + `automatically, whatever the confidence setting.`
          : `This document doesn't have a document type yet, so it can't be filed — and it will `
            + `never file itself automatically, whatever the confidence setting.`)
      + `</div>`
      + `<div class="rr-cues"><span class="rr-cue info">`
      + (detName ? `${escHtml(detName)} · not set up` : 'No document type')
      + `</span></div>`
      + (detName && isAdmin
          ? `<div class="rr-hint"><button type="button" class="btn btn-sm" id="rr-add-type">`
            + `Add “${escHtml(detName)}”</button> — or choose an existing type above.</div>`
          : detName
            ? `<div class="rr-hint">Ask an administrator to add “${escHtml(detName)}”, or choose an `
              + `existing type above.</div>`
            : `<div class="rr-hint">Choose a type above. If the right one isn't in the list, an `
              + `administrator can add it from that same menu.</div>`);
    el.hidden = false;
    const addBtn = document.getElementById('rr-add-type');
    if (addBtn) addBtn.addEventListener('click', () => _addDetectedType(detName));
    return;
  }

  const lowN = doc.below_threshold_count || 0;
  // Only surface flags for fields that belong to THIS document's CURRENT type — a stale
  // extraction left over from a previous type (e.g. an old "invoice_number" note after the
  // doc was re-typed to Print Tracker) must not appear as a phantom flag the user can't see
  // or fix. When the detailed extractions are loaded, derive the count from them (filtered);
  // fall back to the server review_flag_count only before they arrive.
  const _typeKeys = new Set(reviewFields());
  const _relevant = (doc.extractions || []).filter(e => _typeKeys.has(e.field_key));
  // The server's review_flag_count still counts a note this window has DECIDED is stale and
  // stripped from the display (the layout-match class, renderer ~1406) — which is how a document
  // came to say "1 field was flagged" with no flag visible anywhere on it (owner, 2026-08-18).
  // When the detailed extractions are loaded they are the post-strip truth, so prefer them; the
  // server count is only the pre-load placeholder. Fall back to 0 rather than a count we know can
  // be phantom once the strip has run.
  const flagN = (doc.extractions && doc.extractions.length)
    ? _relevant.filter(e => e.validation_note || e.corrected_to).length
    : (doc.review_flag_count || 0);

  // Clean: nothing flagged, nothing low. It's still HERE, so explain why rather than sitting
  // mute (the auto-file threshold is the usual answer). Confirmed docs being re-opened for
  // editing aren't waiting on anything, so they keep the silent treatment.
  if (lowN === 0 && flagN === 0) {
    if (doc.status === 'needs_review' || doc.status === 'deferred') renderCleanHoldReason(el, doc);
    return;
  }

  // Lever A: split the inferred-identity FILL note out of the generic "formatting check" bucket. It
  // gets its OWN actionable block; the generic parts still render for any OTHER flagged/low field
  // (compose, do not blanket-replace — Oracle condition 2). idNotes are computed AFTER the clean
  // early-return above so an identity-only doc (flagN>=1) still reaches this block. They are excluded
  // from the format-check COUNT (an inferred identity is not a format check) and the generic note list.
  const idNotes = _relevant.filter(e => isInferredIdentityNote(e.validation_note));
  const otherFlagN = Math.max(0, flagN - idNotes.length);

  const parts = [];
  if (lowN)       parts.push(`${lowN} field${lowN === 1 ? ' was' : 's were'} read with low confidence`);
  if (otherFlagN) parts.push(`${otherFlagN} field${otherFlagN === 1 ? ' was' : 's were'} flagged by a formatting check`);

  const cues = [];
  if (lowN)       cues.push(`<span class="rr-cue low" title="These fields scored below the confidence threshold set in Settings. Compare the value with the document.">Low confidence · ${lowN}</span>`);
  if (otherFlagN) cues.push(`<span class="rr-cue flag" title="A formatting check found these values look different from what's usual for this field. They may still be correct — just confirm them.">Format check · ${otherFlagN}</span>`);

  const notes = _relevant
    .filter(e => e.validation_note && !isInferredIdentityNote(e.validation_note))
    .map(e => ({ key: e.field_key, note: e.validation_note }));
  const MAX = 4;
  const noteList = notes.length
    ? `<ul class="rr-notes">${notes.slice(0, MAX).map(n =>
         `<li><strong>${escHtml(labelFor(n.key))}:</strong> ${escHtml(n.note)}</li>`).join('')}${
         notes.length > MAX ? `<li class="rr-more">+${notes.length - MAX} more</li>` : ''}</ul>`
    : '';

  // The inferred-identity guidance block (primary hold reason → rendered first). Honest in EVERY
  // flag state: confirming files THIS doc, and confirming a few from the sender lets the layout
  // establish so the rest stop being held. No UNCONDITIONAL auto-file promise (Oracle condition 3:
  // the reliable auto-release depends on the confirmed-hint release path / a clean sender read).
  // Reuses the existing rr-lead / rr-notes styling — no new CSS.
  let idBlock = '';
  if (idNotes.length) {
    const sender = String(doc.supplier_name || '').trim();
    const who = sender ? `“${sender}”` : 'this sender';
    const idLead = `The company on this document was inferred from earlier documents on this layout — `
                 + `Scan Finder couldn’t read it cleanly from the letterhead. Check it names the right `
                 + `company, then Confirm.`;
    const idHow = `Confirming a few documents from ${who} helps Scan Finder recognise it and stop asking. `
                + `Use “Reprocess ${sender || 'this sender'}” (in the tools rail) to re-check the rest once you have.`;
    idBlock = `<div class="rr-lead">${escHtml(idLead)}</div>`
            + `<ul class="rr-notes"><li>${escHtml(idHow)}</li></ul>`;
  }

  // Generic block (wording unchanged) — only when something OTHER than the identity note holds.
  const genericBlock = parts.length
    ? `<div class="rr-lead">${escHtml(`Needs a quick check — ${parts.join(', and ')}.`)}</div>`
      + `<div class="rr-cues">${cues.join('')}</div>` + noteList
    : '';

  el.innerHTML = idBlock + genericBlock;
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
// Locators for the SEARCH pass (Lever X, 2026-08-20, reggie → Oracle SIGN OFF). Verbatim ports of the
// Python finder already in the repo (validator._NUMERIC_DATE_RE / _MONTH_NAME_DATE_RE). GLOBAL
// (matchAll). Numeric requires TWO real /.- separators, so a time "14:32" (colon) or a bare digit run
// is NEVER located; month-name requires a spelled month + optional ordinal. The located span is only a
// PROPOSAL — _matchStrictDate (the four ^…$ matchers, day 1..31 / month 1..12 / region order) DISPOSES.
const _NUMERIC_DRAWN_DATE_RE = /\d{1,4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{1,4}/g;
const _DRAWN_MONTH_ALT = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const _MONTH_NAME_DRAWN_DATE_RE = new RegExp(
  '\\d{1,2}(?:st|nd|rd|th)?\\s*[-/ ]\\s*' + _DRAWN_MONTH_ALT + '\\s*[-/ ,]?\\s*\\d{2,4}' +   // 6th May 2024 / 1-May-24
  '|' + _DRAWN_MONTH_ALT + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}',                      // May 6th, 2024
  'gi');
const _DRAWN_ORDINAL_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;   // "1st" -> "1"

// The four STRICT ^…$ matchers — the ONLY judge of what is a real date. Extracted VERBATIM from the
// old _parseDrawnDate so the whole-string (Attempt 1) and the search (Attempt 2) share the exact gate.
function _matchStrictDate(t, order) {
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

function _parseDrawnDate(raw, order) {
  const base = _datePreclean(raw);
  // Attempt 1 — WHOLE-STRING (existing behaviour, BYTE-IDENTICAL; Oracle X-1). Edge-trim a leading
  // "Date:" label + edge punctuation, then the strict gate. Runs FIRST so every input that parses
  // today parses identically; only a previously-null input gets Attempt 2.
  const trimmed = base
    .replace(/^[A-Za-z][A-Za-z ]*?:\s*/, '')   // drop a leading "Date:" / "Invoice Date:" label (colon required)
    .replace(/^[^0-9A-Za-z]+/, '')             // leading "(", "#", …
    .replace(/[^0-9A-Za-z]+$/, '');            // trailing ".", ")", …
  let out = _matchStrictDate(trimmed, order);
  if (out) return out;
  // Attempt 2 — SEARCH (Lever X): a drawn box that captured a longer line ("Sent: 12 June 2026 21:29",
  // "1st may 2026 14:32pm") — locate date-shaped substrings and validate the LEFTMOST that passes the
  // strict gate. Leftmost = reading order (a drawn box is a positional act; deliberately DIFFERENT
  // from the Python salvage's closest-to-today — do NOT "align" them). Fail-safe: return null →
  // normalizeDrawnValue keeps the raw text via `|| text` (never blank), exactly as today.
  // Search the RAW text, NOT `base`: _datePreclean's OCR-split digit-join ("2 0 2 6"->"2026") also
  // fuses a date's day into a trailing time ("2026-06-12 14:30" -> "…1214:30"), corrupting the very
  // longer-capture case Attempt 2 exists for. The locators already tolerate `\s*` around separators,
  // and each candidate is separator-ws-collapsed below, so the OCR-split-WITHIN-a-drawn-date case is
  // still covered by Attempt 1 (whole-string on `base`); only that rare case inside a LONGER line is
  // out of reach, an acceptable edge.
  const searchText = String(raw == null ? '' : raw);
  const spans = [];
  for (const rx of [_NUMERIC_DRAWN_DATE_RE, _MONTH_NAME_DRAWN_DATE_RE])
    for (const mm of searchText.matchAll(rx)) spans.push({ i: mm.index, s: mm[0] });
  spans.sort((a, b) => a.i - b.i);
  for (const { s } of spans) {
    const cand = s
      .replace(/\s*([/.\-])\s*/g, '$1')       // collapse OCR ws around separators
      .replace(_DRAWN_ORDINAL_RE, '$1')       // "1st may" -> "1 may"
      .trim();
    out = _matchStrictDate(cand, order);      // SAME gate: day 1..31, month 1..12, dmy/mdy/ymd order
    if (out) return out;
  }
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
  _lastRenderedDoc = doc;   // capture the FULL doc object so the live field-visibility re-resolve re-renders THIS one (not the currentDoc queue stub)
  const scroll = document.getElementById('fields-scroll');
  scroll.innerHTML = '';
  // The ⊕ "wrong value?" prompt only makes sense with a document loaded — show it
  // for a real doc, hide it on the empty state (clearDocPanel also hides it).
  const sub = document.querySelector('.fields-header-sub');
  if (sub) sub.style.display = doc ? '' : 'none';
  renderExtractionStatus(doc);
  renderReviewReason(doc);
  // Fetch the AUTHORITATIVE hold verdict and re-render the reason once it lands. Deliberately
  // async-after-paint: the panel must never block on an IPC, and the threshold-derived copy is a
  // safe interim for the fraction of a second before the real answer arrives. The verdict is
  // cleared first so a stale one from the previous document can't be shown against this one.
  _holdVerdict = null;
  _typeChangedUnsaved = false;   // a (re)load shows the saved state — the unsaved-type-change lead retires
  if (doc && doc.id && (doc.status === 'needs_review' || doc.status === 'deferred')) {
    const _forDoc = doc.id;
    Promise.resolve(window.docusnap.getAutoFileReason?.(doc.id)).then((v) => {
      if (!v || !currentDoc || currentDoc.id !== _forDoc) return;   // user moved on → drop it
      _holdVerdict = v;
      renderReviewReason(currentDoc);
    }).catch(() => {});
  }
  _renderDocSnippet(doc);
  if (!doc) { validateConfirm(); return; }

  const extMap = {};
  for (const e of (doc.extractions || [])) extMap[e.field_key] = e;

  // Per-template field HIDING (migration 54): fields hidden for this doc's matched template.
  // Structural roles are never in this set (the backend refuses to hide them), so roles always show.
  const hiddenKeys = new Set(doc.hidden_fields || []);
  for (const key of reviewFields()) {
    const ext = extMap[key] || {};
    // A field emptied because the ISSUER changed stays empty across a repaint. renderFields
    // rebuilds every row from doc.extractions, and _resolveFieldVisibility calls it mid-edit —
    // so without this the previous supplier's value is resurrected into the input and the
    // allValues DOM scrape then FILES it, which is the exact outcome the clear exists to
    // prevent. Previously masked because the clear also blanked the stored row; now that it
    // correctly leaves the row alone, the suppression has to live here.
    const val = clearedByIssuerChange.has(key) ? '' : (ext.display_value ?? ext.raw_value ?? '');
    // Skip a hidden field WHEN it read empty (the layout lacks it — the noise the owner asked to
    // remove). A hidden field that unexpectedly HAS a value is still shown: hiding is a display
    // mask, never a way to lose real data. Inert when nothing is hidden (empty set).
    if (hiddenKeys.has(key) && String(val).trim() === '') continue;
    appendFieldRow(scroll, key, val, ext.confidence ?? null, ext.validation_note || null, ext.corrected_to || null, ext.anchor_label || null, ext.extraction_method || null, ext.candidates || null, ext.suggested_supplier || null, ext.corroboration || null, ext.raw_value || null);
  }
  _prefillGenericScanDate(doc, scroll);
  validateConfirm();
  updateAcknowledgeButton();
  updateTotalsVerifiedBadge();
  _updateSenderFieldsBtn();   // dynamic sender-name label + enabled state track every repaint
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
  if (body) {
    // Tidy the raw OCR preview: collapse whitespace, drop lone symbol/punctuation noise (e.g. "\ \"),
    // and when the page scanned too poorly to read, show a calm note instead of a wall of garble.
    const toks = String(doc.ocr_text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const wordish = t => (t.length >= 3 && (t.match(/[A-Za-z]/g) || []).length >= t.length * 0.6)
                      || (t.match(/[0-9]/g) || []).length >= 2;
    const legible = toks.length ? toks.filter(wordish).length / toks.length : 0;
    const cleaned = toks.filter(t => /[A-Za-z0-9]/.test(t)).join(' ').slice(0, 260);
    body.textContent = (legible >= 0.5 && cleaned)
      ? cleaned
      : "The text on this page didn't scan clearly enough to preview.";
  }
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
    ? 'Taught — Scan Finder knows where this field sits on this supplier’s documents of this type'
    : 'Not taught for this document type yet — click ⊕ and draw a box to show Scan Finder where it lives (a spot taught on a different document type doesn’t apply here)';
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
  const cleared = [];                                             // {key, label, value} — for the undo
  document.querySelectorAll('#fields-scroll .field-input[data-key]').forEach(input => {
    const key = input.dataset.key;
    if (key === 'supplier_name') return;                          // never the issuer being corrected
    if (!input.value.trim()) return;                              // already empty
    if (!_isSupplierScopedRead(input.dataset.method)) return;     // keyword / manual / logo -> keep
    cleared.push({ key, label: labelFor(key) || key, value: input.value });
    input.value = '';
    input.classList.remove('corrected');
    // Record as a RENDER fact, never as a correction — see clearedByIssuerChange. Staging a
    // corrections entry here made a machine clear impersonate an operator edit and blanked the
    // stored extraction row. Filing still sees the empty input via the allValues DOM scrape.
    clearedByIssuerChange.add(key);
    const row = input.closest('.field-row');
    if (row) { try { dismissServerNote(row, key); } catch {} try { clearFieldWarning(row, input); } catch {} }
  });
  if (!cleared.length) return;
  validateConfirm();
  // NAME THE FIELDS AND OFFER THE WAY BACK (Chris round 4, card 3: "I fixed one field and two
  // correct fields I never touched went blank, with no message"). A count alone does not tell the
  // operator WHICH values left the screen, and this is a destructive edit with no database trace —
  // 98d4fbb deliberately stopped it writing a corrections row, so this message is the only record.
  // It goes on the PERSISTENT bar, appended rather than replacing, because on the ⊕ path the
  // read-back for the name that CAUSED the clear is already on screen and both matter.
  const names = cleared.map(c => `<strong>${escHtml(c.label)}</strong>`);
  const list  = names.length === 1 ? names[0]
              : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  appendTeachMessage(
    `&#9888; ${list} ${cleared.length === 1 ? 'was' : 'were'} read using the previous supplier's learned positions, `
    + `so ${cleared.length === 1 ? 'it has' : 'they have'} been cleared. Check ${cleared.length === 1 ? 'it' : 'them'} before you confirm.`,
    { actions: [{ label: 'Undo — put them back', onClick: () => {
        for (const c of cleared) {
          const input = document.querySelector(`.field-input[data-key="${c.key}"]`);
          if (!input) continue;
          input.value = c.value;
          clearedByIssuerChange.delete(c.key);
        }
        validateConfirm();
        appendTeachMessage(`&#10003; Put ${cleared.length === 1 ? 'that value' : 'those values'} back. `
          + `They were read for <em>${escHtml(orig || 'the previous supplier')}</em> &mdash; check ${cleared.length === 1 ? 'it' : 'them'} against this page.`);
      } }] });
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

// LIVE field visibility (2026-07-25, owner request): resolve which of the ENTERED supplier+type's fields
// the layout hides, and re-render — so a doc that matched NO template still honours the supplier's
// hidden-field config, and typing/correcting the issuer re-scopes the visible fields ("enter Thornbury →
// its fields appear"). FAIL-SAFE: nothing resolves ⇒ hidden [] ⇒ ALL fields show (the owner's rule).
// Async-after-paint (never blocks render), doc-guarded, no-op when unchanged or the kill switch is off
// (the IPC returns {disabled:true}). The Confirm gate follows automatically — validateConfirm requires
// only fields actually on screen (fieldExists), and structural roles are never hideable.
async function _resolveFieldVisibility() {
  const doc = _lastRenderedDoc;   // the FULL rendered doc (has extractions); currentDoc is the queue stub
  if (!doc || !currentDoc || currentDoc.id !== doc.id || !selectedTypeSlug) return;
  const forDoc = doc.id;
  let r;
  try {
    r = await window.docusnap.resolveFieldVisibility?.({
      supplier_name: _currentIssuerValue(), document_type_slug: selectedTypeSlug, doc_id: doc.id });
  } catch { return; }
  if (!r || r.disabled) return;
  if (currentDoc?.id !== forDoc || _lastRenderedDoc?.id !== forDoc) return;   // user moved on → drop it
  const next = Array.isArray(r.hidden) ? r.hidden : [];
  const cur  = doc.hidden_fields || [];
  const same = next.length === cur.length && next.every(k => cur.includes(k));
  if (same) return;                                       // no change → no churn
  doc.hidden_fields = next;
  renderFields(doc);
}

// ── Sender-field editor (2026-08-12, Oracle SIGN-OFF-W/COND ×5; Chris cards 1-7 owner-approved) ──
// ONE door for "this sender's documents never carry field X". Resolution-first: if the display
// resolver finds the sender's layout, the editor opens bound to it with NO prompt; only a genuinely
// first-time sender gets the name-confirm prompt, and the mint is IDENTITY-ONLY (Oracle C1 — the
// promote payload carries the confirmed issuer and NOTHING else, so no field rule is ever frozen
// from an unreviewed sample; pinned in test_editor_mint_identity_only.js).
let _senderEditorOpen = false;

async function openSenderFieldEditor(focusKey) {
  if (_senderEditorOpen || !canEdit || !currentDoc) return;
  if (!selectedTypeSlug) { showToast('Select a document type first.', 'warn'); return; }
  if (selectedTypeSlug === 'general_document') {
    showToast('General Documents are filed by their text — there are no per-sender fields to change.', 'warn');
    return;
  }
  const issuer = String(_currentIssuerValue() || '').trim();
  let state;
  try {
    state = await window.docusnap.getSenderFieldEditor({
      supplier_name: issuer, document_type_slug: selectedTypeSlug, doc_id: currentDoc.id });
  } catch { showToast('Could not load the field list — try again.', 'err'); return; }
  if (!state || !state.resolved) { _openSenderNamePrompt(issuer, focusKey); return; }
  _openSenderEditorModal(state, focusKey);
}

// The first-time-sender name prompt (Chris card 1): an EDITABLE pre-filled name field, never a
// Yes/No — a garbled read gets fixed with a pen right here, which is the whole defence against the
// "Reg No GB 903" class (a garble becoming a layout identity on a click-through). Cancel = zero writes.
function _openSenderNamePrompt(prefill, focusKey) {
  if (_senderEditorOpen) return;
  _senderEditorOpen = true;
  const forDoc = currentDoc?.id;
  const ov = document.createElement('div');
  ov.setAttribute('data-help-ignore', '');
  Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999', padding: '24px' });
  const box = document.createElement('div');
  Object.assign(box.style, { width: 'min(480px,94vw)', background: 'var(--surface)',
    border: '1px solid var(--border2)', borderRadius: '12px', padding: '20px',
    boxShadow: '0 18px 50px rgba(0,0,0,.5)', color: 'var(--text)' });
  box.innerHTML = `
    <div style="font-size:15px; font-weight:600; margin-bottom:10px;">Check the sender's name first</div>
    <input type="text" id="sfe-name-input" class="field-input" style="width:100%; box-sizing:border-box; font-size:14px; padding:8px 10px;">
    <div style="font-size:12px; color:var(--muted); margin-top:10px; line-height:1.5;">
      Scan Finder will use this name to recognise their documents and to file them.
      You can change it later in Settings.</div>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
      <button class="btn" id="sfe-name-cancel">Cancel</button>
      <button class="btn confirm" id="sfe-name-go">That's right — continue</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector('#sfe-name-input');
  input.value = prefill || '';
  requestAnimationFrame(() => { try { input.focus(); input.select(); } catch {} });
  let closed = false;
  const close = () => { if (closed) return; closed = true; _senderEditorOpen = false;
    document.removeEventListener('keydown', onKey, true); ov.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.querySelector('#sfe-name-cancel').onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  box.querySelector('#sfe-name-go').onclick = async () => {
    const name = String(input.value || '').trim();
    if (!name) { try { input.focus(); } catch {} return; }
    if (!currentDoc || currentDoc.id !== forDoc) { close(); return; }
    const go = box.querySelector('#sfe-name-go'); go.disabled = true;
    // IDENTITY-ONLY mint (Oracle C1): allValues carries the confirmed issuer and nothing else, so
    // _buildTemplateFields can freeze no other field from this unreviewed sample. The promote path
    // still runs the full birth machinery (reuse bands, sample pin, landmarks, fingerprint).
    const result = await window.docusnap.promoteToTemplate({
      document_id:        forDoc,
      allValues:          { supplier_name: name },
      document_type_slug: selectedTypeSlug,
      supplier_name:      name,
    });
    if (!result?.success) {
      go.disabled = false;
      showToast(result?.error || 'Could not set this sender up — try again.', 'err');
      return;
    }
    // Land the confirmed name in the on-screen issuer field through the ordinary typed-correction
    // path (Oracle C5): _currentIssuerValue() then resolves the SAME scope the editor is bound to,
    // so the first toggle visibly repaints the open doc.
    const issuerInput = document.querySelector('.field-input[data-key="supplier_name"]');
    if (issuerInput && issuerInput.value.trim() !== name) {
      issuerInput.value = name;
      issuerInput.dispatchEvent(new Event('input', { bubbles: true }));
      issuerInput.dispatchEvent(new Event('blur'));
    }
    close();
    let state;
    try {
      state = await window.docusnap.getSenderFieldEditor({
        supplier_name: name, document_type_slug: selectedTypeSlug, doc_id: forDoc });
    } catch { state = null; }
    if (state && state.resolved) _openSenderEditorModal(state, focusKey);
    else showToast('Sender saved — reopen the editor to change its fields.', 'warn');
  };
}

function _openSenderEditorModal(state, focusKey) {
  if (_senderEditorOpen) return;
  _senderEditorOpen = true;
  const forDoc = currentDoc?.id;
  const typeName = (allDocTypes.find(t => t.slug === selectedTypeSlug) || {}).name
    || String(selectedTypeSlug || '').replace(/_/g, ' ');
  const ov = document.createElement('div');
  ov.setAttribute('data-help-ignore', '');
  Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999', padding: '24px' });
  const box = document.createElement('div');
  Object.assign(box.style, { width: 'min(520px,94vw)', maxHeight: '86vh', overflowY: 'auto',
    background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px',
    padding: '20px', boxShadow: '0 18px 50px rgba(0,0,0,.5)', color: 'var(--text)' });
  // Scope header names EXACTLY what this edits (Chris card 3) — sender + this one document type.
  const rowsHtml = (state.fields || []).map(f => {
    const lock = f.structural;
    return `
      <div class="sfe-row" data-key="${escHtml(f.key)}" style="display:flex; align-items:center; gap:10px; padding:7px 2px; border-bottom:1px solid var(--border); ${f.hidden ? 'opacity:.55;' : ''}">
        <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:${lock ? 'default' : 'pointer'};">
          <input type="checkbox" class="sfe-toggle" data-key="${escHtml(f.key)}" ${f.hidden ? '' : 'checked'} ${lock ? 'disabled' : ''}>
          <span style="flex:1;">${escHtml(f.label || f.key)}</span>
        </label>
        ${lock
          ? '<span style="font-size:11px; color:var(--muted);" title="Needed for recognising and filing every document — it can\'t be switched off">🔒 always shown</span>'
          : `<span class="sfe-state" style="font-size:11px; color:var(--muted);">${f.hidden ? 'hidden — tick to show again' : 'shown'}</span>`}
      </div>`;
  }).join('');
  box.innerHTML = `
    <div style="font-size:15px; font-weight:600;">${escHtml(state.senderName || 'This sender')} — ${escHtml(typeName)}</div>
    <div style="font-size:12px; color:var(--muted); margin:4px 0 12px;">Other document types from this sender aren't affected.</div>
    <div id="sfe-rows">${rowsHtml}</div>
    <div style="font-size:12px; color:var(--muted); margin-top:12px; line-height:1.5;">
      Applies to all of this sender's documents, including the ones waiting. Values already read
      aren't changed — a field you switch back on shows whatever was last read; use Reprocess on a
      document to read it again.</div>
    <div style="font-size:11px; color:var(--muted); margin-top:8px;">
      To change these fields for every sender, go to Settings → Document Types.</div>
    <div style="display:flex; justify-content:flex-end; margin-top:14px;">
      <button class="btn confirm" id="sfe-done">Done</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  let closed = false;
  const close = () => { if (closed) return; closed = true; _senderEditorOpen = false;
    document.removeEventListener('keydown', onKey, true); ov.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.querySelector('#sfe-done').onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  box.querySelectorAll('.sfe-toggle:not([disabled])').forEach(cb => {
    cb.addEventListener('change', async () => {
      const key = cb.dataset.key;
      const wantHidden = !cb.checked;
      cb.disabled = true;
      let r;
      try {
        r = await window.docusnap.setSenderFieldHidden({
          doc_id: forDoc, supplier_name: String(_currentIssuerValue() || '').trim(),
          document_type_slug: selectedTypeSlug, field_key: key, hidden: wantHidden,
          template_id: state.templateId });
      } catch { r = null; }
      cb.disabled = false;
      if (!r || r.ok === false) {
        cb.checked = !cb.checked;   // revert — nothing was written
        showToast(r && r.reason === 'structural-role'
          ? 'That field is always shown — it\'s needed for filing.'
          : 'Could not change that field — try again.', 'err');
        return;
      }
      const row = cb.closest('.sfe-row');
      if (row) {
        row.style.opacity = wantHidden ? '.55' : '';
        const st = row.querySelector('.sfe-state');
        if (st) st.textContent = wantHidden ? 'hidden — tick to show again' : 'shown';
      }
      // LIVE update of the doc on screen (owner requirement 2026-08-12 + Oracle C5): repaint from
      // the union the server JUST computed over the bound scope — no dependence on the issuer-name
      // re-resolution or the template-id-keyed broadcast.
      if (Array.isArray(r.hidden) && _lastRenderedDoc && currentDoc
          && currentDoc.id === forDoc && _lastRenderedDoc.id === forDoc) {
        _lastRenderedDoc.hidden_fields = r.hidden;
        renderFields(_lastRenderedDoc);
      }
    });
  });
  if (focusKey) {
    const row = box.querySelector(`.sfe-row[data-key="${CSS.escape(focusKey)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.style.background = 'var(--accent-bg)';
      setTimeout(() => { try { row.style.background = ''; } catch {} }, 1600);
    }
  }
}

// Flip one field's dot live after a ⊕ teach stages or is C1-dropped (no full re-render).
function _refreshTaughtDot(key) {
  const dot = document.querySelector(`.taught-dot[data-key="${key}"]`);
  if (!dot) return;
  const taught = _fieldIsTaught(key);
  dot.classList.toggle('on', taught);
  dot.title = _taughtDotTitle(taught);
}

function appendFieldRow(scroll, key, val, conf, note, correctedTo, anchorLabel, method, candidates, suggestedSupplier, corroboration, rawValue) {
  const low      = conf !== null && conf < 70;
  const confClass = conf === null ? '' : conf >= 70 ? 'high' : conf >= 40 ? 'mid' : 'low';
  // Pair the % with a plain word so non-technical users read it at a glance.
  const confWord = conf === null ? '' : conf >= 70 ? 'High' : conf >= 40 ? 'Check' : 'Low';
  // Demystify the amber/red dot so a CORRECT-but-not-High read doesn't push people to teach an
  // anchor they don't need (which is how a fragile taught position gets created). "Check" ≠ broken.
  const confTitle = confWord === 'High'
    ? `High confidence — the app is ${conf}% sure of this reading`
    : confWord === 'Check'
      ? `Read at ${conf}% — worth a glance, but the value may well be right. Only teach this field (⊕) if the value shown is actually WRONG.`
      : `Low confidence (${conf}%) — please check this value and correct it if it's wrong. Teaching (⊕) only helps if the app can't read the value here.`;
  // No badge on an EMPTY field: the % describes a read that put nothing in the box —
  // "High · 87%" beside a "Not found" placeholder (or "Low · 0%" under a later ⟳
  // suggestion fill) reads as nonsense to a non-technical reviewer (Chris, card 3).
  const confLabel = (conf !== null && String(val ?? '').trim())
    ? `<span class="conf-badge ${confClass}" title="${confTitle}">${confWord} · ${conf}%</span>`
    : '';
  // A correction that was ALREADY APPLIED to the value (Stage 4.5 strong auto-fix:
  // an OCR misread of a near-universal learned token, e.g. "Lid"→"Ltd") shows as a
  // calm "auto-corrected" badge — the value in the input IS the fix, so there is no
  // Accept button. A SUGGESTION (corrected_to differs from the current value) keeps
  // the amber note + Accept button. The applied case is detected by value equality,
  // which the engine guarantees (value/display_value/corrected_to all set to the
  // repair on auto-apply).
  // …EXCEPT when the note still ASKS a question ("one character differs" — the raw-witness ask
  // class): a green "auto-corrected" badge over a please-check note reads as a contradiction
  // (Chris card 2, all 7 Pelican). Legacy stored rows carry corrected_to == value WITH that ask
  // note forever, so the badge must key off the note text too, not equality alone.
  const isApplied = !!correctedTo && val === correctedTo
    && !/one character differs/i.test(String(note || ''));
  // Correction CANDIDATES get two value-labelled buttons (explicit consent — the operator
  // sees exactly what each click keeps; Chris, card 1): "Use <suggestion>" copies it into
  // the input; "Keep <current>" hides the note display-side. Neither confirms or persists.
  // correctedTo !== val: a vacuous pair (legacy rows) must not offer "Use X" / "Keep X" with the
  // SAME string on both buttons — it renders as a plain note instead.
  const _btnVal = (s) => { const t = String(s ?? ''); return escHtml(t.length > 18 ? t.slice(0, 17) + '…' : t); };
  // Chris round 6 card 5: after a re-teach the siblings re-read themselves and offered
  // `Use "ss-oo9e275" · Keep "ss-onnea275"` under a note that ALSO said the current value
  // "doesn't appear on this page as written" — two garbles, and a Use button for a value the
  // page-check never vouched for. When the page-check has refused the CURRENT value and the
  // OFFERED value is not printed either (sepless projection over the stored page text), neither
  // button is an answer: say so and point at the box. Fail-open — no page text, or the offered
  // value IS on the page, keeps today's buttons.
  const _neitherOnPage = !!correctedTo && correctedTo !== val && !isApplied
    && /doesn't appear on this page as written/i.test(String(note || ''))
    && !_valueOnPageSepless(correctedTo, currentDoc && currentDoc.ocr_text);
  const acceptHtml = (correctedTo && correctedTo !== val && !isApplied && !_neitherOnPage)
    ? ` <button type="button" class="accept-btn" data-key="${key}" title="Replace the value with ${escHtml(correctedTo)} — saved when you confirm">Use “${_btnVal(correctedTo)}”</button>`
      + ` <button type="button" class="keep-btn" data-key="${key}" title="Keep the value as it is and hide this note">${String(val ?? '').trim() ? `Keep “${_btnVal(val)}”` : 'Leave as is'}</button>`
    : (_neitherOnPage
        ? ` <span class="field-note-hint">Neither reading appears on this page — draw the box again (⊕) or type the value from the page.</span>`
        : '');
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
  // The label NAMES the value it affirms (Chris 16 card 1 convention; slice 2 of the garbled-issuer
  // arc, 2026-08-22): "✓ Issuer is correct" beside a garble like “NOCUMENT” read as a rubber stamp —
  // clicking it allowlists the garble forever. Nobody should affirm a value blind.
  const issuerAcceptHtml = isIssuerFlag
    ? ` <button type="button" class="issuer-accept-btn" data-key="${key}" title="Confirm this really is the correct issuer, so Scan Finder stops flagging it — even though a different name appears in the letterhead. Applies to future documents from this issuer too.">${String(val ?? '').trim() ? `✓ Keep “${_btnVal(val)}” as the issuer` : '✓ Issuer is correct'}</button>`
    : '';
  // "Use '<name>'" — the branding cross-check DETECTED the true issuer (the page branding reads a
  // different known name than the resolved supplier). One click accepts the detected name for the
  // Document Issuer — it fills the value (persisted on Confirm, like a typed correction), PINS the
  // document's issuer and offers the sibling ripple (see the branding-resolve click handler).
  // Slice 2 of the garbled-issuer arc (2026-08-22, Oracle C2.3): the identity-conflict note
  // ("Letterhead may read …") ALSO qualifies — the engine now carries the letterhead canonical in
  // `suggested_supplier` when the resolved read is a GARBLE of it (and only then; a whole-token
  // disagreement such as a buyer-issued PO carries no suggestion, so this button never offers the
  // wrong company with a ripple). On that note the row renders TWO honest answers to one question:
  // this `Use “<letterhead name>”` and the issuer-accept `✓ Keep “<read>” as the issuer` above. The
  // two regexes overlap ON PURPOSE now; the accept-btn (`Use` off corrected_to) cannot double-render
  // because the engine clears corrected_to whenever it writes the suggestion (pinned).
  const isBrandingFlag = !!note && !isApplied
    && key === 'supplier_name' && !!suggestedSupplier
    && /page branding reads|confirm the correct company|letterhead may read/i.test(note);
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
  // CLASS FIX (2026-08-19) — a value this document did NOT get from its own page: it was corrected
  // because the operator made the same one-character correction on another document from this
  // sender. The badge is keyed on the METHOD MARKER, not on corrected_to: the marker is durable
  // (it survives confirm, where corrected_to is nulled) and it touches no gate, where corrected_to
  // is read by both the auto-file predicate and the flag summary (Oracle C1). Naming the previous
  // reading matters — nobody should have to guess what changed on a document they never opened.
  const isClassFix = String(method || '').endsWith('+prefix_class_fix');
  const classFixHtml = isClassFix
    ? `<div class="field-note corrected"><span class="corrected-badge" title="You corrected this same misreading on another document from this sender, so it was applied here too. Nothing has been filed — check it and confirm as usual.">✓ corrected by an earlier fix</span>`
      + (rawValue && String(rawValue) !== String(val ?? '') ? ` was “${escHtml(rawValue)}”` : '')
      + `</div>`
    : '';
  const noteHtml = isApplied
    ? `<div class="field-note corrected"><span class="corrected-badge" title="An OCR misread was auto-corrected to the spelling that recurs in your confirmed data">✓ auto-corrected</span> ${escHtml(note || '')}</div>`
    : (note || correctedTo)
      // When a ⑂ Resolve picker is available for this field, it is the ONLY answer offered (owner,
      // 2026-08-24): the inline "Use …"/"Keep …" accept buttons truncate to unreadable stubs, and the
      // picker shows every reading in full (with the suggestion merged in — see the click handler). So
      // suppress the inline accept/keep pair on a resolvable field and render only Resolve.
      ? `<div class="field-note">${escHtml(note || '')}${resolvable ? resolveHtml : `${acceptHtml}${nameAcceptHtml}${issuerAcceptHtml}${brandingResolveHtml}`}</div>`
      : '';
  // Anchor provenance: only for anchor-based extraction sources, and only when a
  // label was captured. Other methods (keyword, template, llm, manual) show nothing.
  const isAnchorMethod = method === 'anchor' || method === 'anchor_crop';
  const anchorHtml = (isAnchorMethod && anchorLabel)
    ? `<div class="field-anchor-note">From anchor: ${escHtml(anchorLabel)}</div>`
    : '';
  // CORROBORATION (owner principle 2026-08-11: "the rungs should corroborate, not merely
  // compete"). The record is live (extractions.corroboration) and DECISION-BEARING in the
  // corroborated auto-file route; SFDEV surfaces agreement AND the amber disagreement.
  // The Review-facing "✓ Two independent readings agree" line was REMOVED the same evening,
  // OWNER DECISION: a positive-only badge trains the customer to expect it, and its absence
  // on a perfectly correct value then reads as alarm ("it worked before — is this one
  // wrong?"). Structural absence is common (label-above layouts are invisible to the keyword
  // family — see pendingfeatures), so the badge would be missing on correct docs routinely.
  // Do not resurrect it as a positive-only line; if corroboration ever surfaces in Review
  // again it must be a state that is MEANINGFUL in both directions.
  const corrobHtml = '';

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
  // "Never on these documents?" (Chris card 4, 2026-08-12): the empty box is where the user actually
  // looks when a field never applies to this sender — a small link there opens the sender-field
  // editor with this field pre-focused. Client-side structural check is best-effort cosmetics only
  // (the backend refuses structural hides regardless); shown only to edit-capable users on a
  // real-typed doc with a blank value.
  const _typeFields = (allDocTypes.find(t => t.slug === selectedTypeSlug) || {}).fields || [];
  const _fDef = _typeFields.find(f => f.key === key);
  const neverHtml = (canEdit && selectedTypeSlug && selectedTypeSlug !== 'general_document'
      && !String(val ?? '').trim() && _fDef && !_fDef.is_structural)
    ? `<div class="field-never-row"><button type="button" class="never-here-btn" data-key="${key}"
         style="background:none; border:none; padding:0; font-size:11px; color:var(--muted); text-decoration:underline; cursor:pointer;"
         title="If this sender's documents never carry this field, switch it off so it stops showing here">Never on these documents?</button></div>`
    : '';
  // LIST field (2026-08-27, panel + Oracle): the store input stays (hidden) as the ONE value confirm
  // reads and the ONE `corrections` writer; a pills view sits over it with per-element edit / remove
  // (+ put back), "+ One it missed" (= the ⊕ teach) and an "Edit as text" escape. Learning from a pill
  // edit is THIS DOCUMENT ONLY — the caption teach is the only future-facing lever (Oracle cond 8/9).
  const _isList = _isListFieldKey(key);
  const _pickTitle = _isList
    ? 'Point to a value the list missed — draw a box round it (with its caption just left of or above it). Scan Finder adds it here and learns the caption for every future document of this type.'
    : 'Teach this field — only if it\'s showing the WRONG value. Draw a box round the correct value; Scan Finder pins that position and reads it on every future document from this supplier. A field already reading correctly doesn\'t need teaching.';
  row.innerHTML = `
    <div class="field-row-header">
      ${_dotSpan}
      <span class="field-row-label" data-key="${key}"${_issuerHint}>${escHtml(labelFor(key))}</span>
      ${confLabel}
    </div>
    <div class="field-input-wrap${_isList ? ' list-mode' : ''}">
      <input type="text" class="field-input ${low ? 'low-conf' : ''}${_isList ? ' list-store' : ''}"
             data-key="${key}" data-original="${escHtml(val)}" data-method="${escHtml(method || '')}"
             value="${escHtml(val)}" placeholder="Not found">${_isList ? `
      <div class="list-chips" data-key="${key}" title="Each entry read for this list — click one to edit it, ✕ to drop one that isn't on this document"></div>` : ''}
      <button class="pick-btn" data-key="${key}" title="${escHtml(_pickTitle)}">&#8853;</button>
    </div>${_isList ? `
    <div class="list-tools" data-key="${key}">
      <span class="list-receipt"></span>
      <button type="button" class="list-tool-btn list-add-btn" title="Draw a box round a value the list missed">+ One it missed</button>
      <button type="button" class="list-tool-btn list-text-btn" title="Edit the whole list as text — entries separated by ;">Edit as text</button>
      <button type="button" class="list-tool-btn list-undo-btn" hidden title="Put the list back exactly as it was read">Undo changes</button>
    </div>` : ''}
    ${classFixHtml}${noteHtml}${anchorHtml}${corrobHtml}${neverHtml}
  `;
  row.querySelector('.never-here-btn')?.addEventListener('click', () => openSenderFieldEditor(key));

  const input = row.querySelector('input');
  input.addEventListener('input', () => {
    const orig = input.dataset.original;
    input.classList.toggle('corrected', input.value !== orig);
    if (input.value !== orig) {
      corrections[key] = { original_value: orig, corrected_value: input.value };
    } else {
      delete corrections[key];
    }
    if (_isList) _renderListChips(row);   // the pills are a view over the store — repaint on every write
    // The operator has taken this field over, so the issuer-change suppression must let go —
    // otherwise the next repaint would blank what they just typed. Their edit is now recorded
    // in `corrections` in the ordinary way, including a deliberate clear back to empty.
    clearedByIssuerChange.delete(key);
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
    if (key === 'supplier_name') { _refreshTaughtForType().catch(() => {}); _clearSuspectReadsForNewIssuer(); _resolveFieldVisibility(); }
    // Chris r6 card 7: a settled DIFFERENT issuer makes the loaded hold verdict stale (it named the
    // old sender: "…only the second document from Bramblewood…") and the "Change what's read from
    // X's documents" label — drop the verdict, repaint the reason panel + the label. Same-value
    // blur: no-op (the verdict still describes this document).
    if (key === 'supplier_name' && currentDoc
        && input.value.trim().toLowerCase() !== String(currentDoc.supplier_name || '').trim().toLowerCase()) {
      _holdVerdict = null;
      try { renderReviewReason(currentDoc); } catch {}
      try { _updateSenderFieldsBtn(); } catch {}
    }
    // TYPED-CORRECTION DOORWAY (Chris r12 #1): the correction ripple used to open ONLY from the
    // "Use 'X'" branding button — but the cold-start prefill note replaced the branding note, so the
    // natural fix (typing the real name over "Cleaning" and pressing Enter) never offered "Apply to
    // N & re-read" even though the siblings were findable. Offer it on a settled TYPED issuer that
    // differs from the read. Same bar, same apply path (pins → review-bound re-read), nothing happens
    // without a click; once per distinct typed name so a blur/refocus loop can't nag.
    if (key === 'supplier_name' && !bulkFiling && !_batchActive) {
      const typed = input.value.trim();
      const orig  = (input.dataset.original || '').trim();
      if (typed && typed !== orig && typed !== row.dataset.rippleOffered) {
        row.dataset.rippleOffered = typed;
        offerIssuerRipple(currentDoc?.id, typed, row).catch(() => { /* advisory — never disturb the edit */ });
      }
    }
  });

  // Chris r13 card 3: Enter in the Document Issuer box settles it exactly like clicking away —
  // validation + the correction-ripple doorway — instead of doing nothing.
  if (key === 'supplier_name') {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); input.blur(); }
    });
  }

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
    // TYPING MUST NEVER FIGHT THE POPUP (owner-found 2026-08-18, on the Document Issuer field:
    // caret visible, Backspace worked, typed characters vanished — long mistaken for the
    // "third focus failure mode" OS desync). Two hostile behaviours lived here: the datalist was
    // re-attached on EVERY keystroke, so the operator typed with a native popup open and
    // competing for the keyboard (the same Windows popup class that caused the documented
    // <select> regression); and closeSuggest BLURRED the very input being typed into, so any
    // character landing in the blur→rAF-refocus gap was lost while deletions — which never take
    // the replacement path — sailed through. Now:
    //   • the list attaches only after typing PAUSES (idle debounce), never mid-keystroke;
    //   • a printable keydown detaches it first, so a character is never typed into an open popup;
    //   • closeSuggest blurs ONLY for a genuine pick while the field still holds focus (that
    //     blur is the sole way to dismiss Chromium's popup — keep it, but never mid-typing).
    let lastArrowAt = 0;
    let suggestTimer = null;
    const detachList = () => {
      if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
      input.removeAttribute('list');
    };
    const armList = () => {
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => {
        suggestTimer = null;
        if (document.activeElement !== input) return;      // moved on — do not pop up behind them
        if (input.value.trim().length < 3) return;
        ensureLoaded();
        input.setAttribute('list', dlId);
      }, 400);
    };
    const closeSuggest = () => {
      const wasFocused = document.activeElement === input;
      detachList();
      if (!wasFocused) return;
      input.blur();
      requestAnimationFrame(() => input.focus());
    };
    input.addEventListener('input', (e) => {
      if (e && e.inputType === 'insertReplacementText') {
        // A datalist value was inserted. Arrow NAVIGATION fires this right after an
        // Arrow keydown (keep the popup open); a MOUSE PICK fires it with no recent
        // arrow (that's a commit → close). Enter is handled in keydown below.
        if (Date.now() - lastArrowAt > 150) setTimeout(closeSuggest, 0);
        return;
      }
      if (input.value.trim().length >= 3) armList();
      else detachList();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { lastArrowAt = Date.now(); return; }
      if (e.key === 'Enter' && input.hasAttribute('list')) { setTimeout(closeSuggest, 0); return; }
      // A printable keystroke belongs to the FIELD — never to an open suggestion popup.
      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) detachList();
    });
    input.addEventListener('blur', () => {
      if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
    });
  }

  row.querySelector('.pick-btn').addEventListener('click', () => {
    // A LIST field is caption-collected (Oracle C1, 2026-08-11): a taught box would be stored and
    // never consulted — a dead operator instruction. Refuse AT TEACH TIME with the reason, rather
    // than accept the draw and silently ignore it.
    const _def = (fieldDefs || []).find(f => f.key === key);
    // A LIST field IS teachable since 2026-08-27 — by its CAPTION, not a position (owner spec): the
    // drawn box finds the caption; see _stageListCaption. (The old refusal toast is gone.)
    // A BARCODE field is read from the decoded symbol (2026-08-26): a taught box would never be
    // consulted either — same refusal, same reason, at teach time.
    if (_def && String(_def.type || '').toLowerCase() === 'barcode' && window.__barcodeFieldOn) {
      showToast(`${labelFor(key)} is a Barcode field — it's read from the barcode printed on the page, so there's no position to teach. Edit the value directly if the read is wrong.`, 'warn');
      return;
    }
    if (activeField === key) cancelZoneMode();
    else enterZoneMode(key, labelFor(key));
  });
  if (_isList) _wireListRow(row, key);   // pills view + tools over the (hidden) store input

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
      row.querySelector('.keep-btn')?.remove();   // the choice is made — drop the alternative
    });
  }

  // "Keep <current>" — explicit dismissal of the suggestion. Display-only: hides the note
  // (the DB note is untouched; Confirm keeps the on-screen value and clears it server-side).
  const keepBtn = row.querySelector('.keep-btn');
  if (keepBtn) {
    keepBtn.addEventListener('click', () => {
      const note = keepBtn.closest('.field-note');
      if (note) note.style.display = 'none';
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
    // Resolve is now the ONLY answer on a resolvable field (the inline Use/Keep buttons were dropped —
    // they truncate). So the suggested correction must be OFFERED INSIDE the picker: merge correctedTo
    // (the suggestion) into the candidate list when the readings don't already carry it, at the top so
    // it survives the overlay's top-3 slice. No page box → it renders as a list-only choice.
    const merged = Array.isArray(candidates) ? candidates.slice() : [];
    const _hasVal = (v) => merged.some(c => c && String(c.value).trim() === String(v).trim());
    if (correctedTo && String(correctedTo).trim() && !_hasVal(correctedTo)) merged.unshift({ value: correctedTo, suggested: true });
    resolveBtn.addEventListener('click', () => openResolveOverlay(key, merged, row, input));
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
      const _srcDocId = currentDoc?.id;
      try { await window.docusnap.resolveIssuer?.({ docId: _srcDocId, value: name }); } catch {}
      // (C) CORRECTION RIPPLE (slice 2): one fix should heal the batch — offer the siblings that
      // look like the same sender BY TEXT. Advisory + non-blocking; nothing happens without a click.
      try { await offerIssuerRipple(_srcDocId, name, row); } catch { /* never disturb the correction */ }
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
    // History discriminator: a candidate the operator has already confirmed (≥3 times in this
    // scope) says so — that count is the only evidence separating a one-glyph garble from the
    // real value when both are well-formed. Engine-supplied; absent on older extractions.
    const histN = Number(c.confirmed_count) || 0;
    const hist = histN >= 3
      ? `<br><span class="rc-hist" style="color:var(--ok);font-weight:600">✓ you've confirmed this ${histN === 1 ? 'once' : histN + ' times'}</span>` : '';
    b.innerHTML = `<span class="rc-num">${i + 1}</span><span><span class="rc-val">${escHtml(c.value)}</span><br>` +
      `<span class="rc-src">${escHtml(c.source_label || 'read from the page')}${c.box ? '' : ' · position not marked'}</span>${hist}</span>`;
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

  // NO-PAGE gate (card 1): a document whose scanned page is gone cannot be filed — the server
  // refuses it, so never present an enabled Confirm & File that will only fail. Trumps every other
  // check below. Only the interactive view sets this; bulk relies on the server guard.
  if (_currentPageMissing) {
    const _n = document.getElementById('confirm-config-note');
    if (_n) {
      _n.textContent = 'The scanned page for this document is no longer available, so it can’t be filed. '
        + 'Its details stay in Search — you can delete this entry from the queue.';
      Object.assign(_n.style, { display: '', color: 'var(--warn)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    }
    btn.disabled = true;
    markRequiredMissing([]);
    return;
  }

  const _note0 = document.getElementById('confirm-config-note');
  // Need a doc type selected. SAY SO (Oracle C1, 2026-07-20): this used to disable Confirm and
  // write no note at all, so an untyped document showed a greyed-out button with nothing on
  // screen explaining it — the same dead-end class as the dangling-role trap below, which we
  // already talk about. An untyped doc reaches this state on a FRESH INSTALL whenever detection
  // names a type the install doesn't have (delivery dockets, 2026-07-20), so it is not an edge case.
  if (!selectedTypeSlug) {
    if (_note0) {
      _note0.textContent = 'Choose a document type above before filing this document.';
      Object.assign(_note0.style, { display: '', color: 'var(--warn)', fontSize: '12px',
        lineHeight: '1.4', padding: '6px 14px' });
    }
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

  // INVALID-DATE guard (Chris 2026-08-25 Card 1) — the interactive twin of the server refusal in
  // reviewService.confirm. A present-but-unreadable DATE-ROLE value passes the empty-required check
  // above (it is non-empty) yet the folder builder can't parse it, so it would file to
  // "Unknown Year / Unknown Month" with no signal. Block confirm and say how to fix it — the same
  // treatment an EMPTY required date already gets. Predicate = _parseDrawnDate (precleans + requires a
  // 4-digit year, so it AGREES with filing.normaliseDate and never false-blocks an OCR-spaced
  // "15 / 12 / 2025"); deliberately NOT fieldValidationError (that loose pattern misses the clipped
  // "15/12/202"). The SERVER refusal is the authoritative class fix (covers File All and a stale
  // renderer); this is early feedback so the button doesn't invite a click that would only be refused.
  if (dateKey && fieldExists(dateKey)) {
    const dInput = document.querySelector(`.field-input[data-key="${dateKey}"]`);
    const dVal = dInput ? dInput.value.trim() : '';
    if (dVal && _parseDrawnDate(dVal, _regionDateOrder || 'dmy') === null) {
      if (note) {
        note.innerHTML = `The <b>${escHtml(labelFor(dateKey))}</b> can’t be read as a real date, so this `
          + 'document would be filed under an unknown date. Please correct it before filing.';
        Object.assign(note.style, { display: '', color: 'var(--warn)', fontSize: '12px',
          lineHeight: '1.4', padding: '6px 14px' });
      }
      if (issuerNote) issuerNote.style.display = 'none';
      markRequiredMissing([dateKey]);
      btn.disabled = true;
      return;
    }
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
function drawTraceBbox(bbox, kind, stage, keep, label, persist) {
  if (!bbox || bbox.length < 4 || !traceCanvas.width) return;
  if (!keep) clearTraceHighlight();
  const w = traceCanvas.width, h = traceCanvas.height;
  const bw = Math.round(bbox[2] * w), bh = Math.round(bbox[3] * h);
  const isCenterBased = _CENTRE_BASED_SLICE_STAGES.has(stage);
  const x = isCenterBased ? Math.round(bbox[0] * w - bw / 2) : Math.round(bbox[0] * w);
  const y = isCenterBased ? Math.round(bbox[1] * h - bh / 2) : Math.round(bbox[1] * h);
  if (label) _drawBoxLabel(x, y, bw, bh, label, kind === 'anchor' ? '#4f8ef7' : '#d4820a');
  // target = amber (value region), anchor = blue (label region)
  const color = kind === 'anchor' ? '#4f8ef7' : '#d4820a';
  traceCtx.save();
  traceCtx.setLineDash([3, 3]);
  // 1px hairline (owner 2026-08-09): at 2px the stroke straddles the glyphs it is meant to bound,
  // so you cannot see whether an edge cuts through a character — which is the whole diagnostic.
  traceCtx.lineWidth = 1;
  traceCtx.strokeStyle = color;
  traceCtx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  traceCtx.setLineDash([]);
  traceCtx.fillStyle = color + '28';
  traceCtx.fillRect(x, y, bw, bh);
  traceCtx.restore();
  if (_traceHighlightTimer) clearTimeout(_traceHighlightTimer);   // single shared dwell for both boxes
  // Long idle dwell so you can actually study the box; it still clears immediately on
  // the next row click, page change, or doc change (clearTraceHighlight callers).
  // `persist` (All-boxes mode) opts out of the dwell entirely — that overlay is a MODE the
  // operator turns off, not a flash.
  if (!persist) _traceHighlightTimer = setTimeout(clearTraceHighlight, 30000);
}

// ── Box label + detection note ────────────────────────────────────────────────
// A chip pinned to the box's top-left carrying the field and how the value got there. Placed
// ABOVE the box when there is room and INSIDE it when there isn't, so a box at the very top of
// the page never loses its label off-canvas. Drawn on the same traceCanvas, so it clears with it.
function _drawBoxLabel(x, y, bw, bh, text, color) {
  const c = traceCtx;
  c.save();
  c.font = '400 9px "IBM Plex Sans", system-ui, sans-serif';   // finer — the label must not out-shout the page
  const padX = 3, tw = Math.ceil(c.measureText(text).width);
  const lh = 12;
  const above = y - lh - 1 >= 0;
  const lx = Math.max(0, Math.min(x, traceCanvas.width - tw - padX * 2));
  const ly = above ? y - lh - 1 : y + 1;
  c.fillStyle = color;
  c.fillRect(lx, ly, tw + padX * 2, lh);
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.fillText(text, lx + padX, ly + lh / 2 + 0.5);
  c.restore();
}

// ── "All boxes": every WINNING field's crop region, at once, labelled ─────────
// Owner request 2026-08-09. The per-row click answers "where did THIS value come from"; while
// judging a teach you need "where did EVERYTHING come from" in one look — which box drifted, which
// two overlap, which one is sitting on a caption.
// ACCURACY IS THE WHOLE POINT: it draws the SAME bbox the row click draws, through the SAME
// drawTraceBbox (so the centre-vs-top-left convention per stage is applied once, in one place),
// sourced from the trace's winning-rung crop. It never derives or re-computes a box of its own.
// Winners only — drawing every rejected candidate would be unreadable and would show regions no
// value came from. Current page only, for the same reason.
let _allBoxesOn = false;
function drawAllTraceBoxes() {
  clearTraceHighlight();
  if (!_allBoxesOn) return;
  const host = document.getElementById('rdc-fields');
  if (!host || !traceCanvas.width) return;
  let drawn = 0;
  host.querySelectorAll('.rdc-cand[data-bbox],.rdc-cand[data-anchor-bbox]').forEach((row) => {
    if (row.dataset.tag !== 'won') return;                       // winners only
    const page = parseInt(row.dataset.page || row.dataset.anchorPage, 10) || 0;
    if (page !== currentPage) return;                            // this page only
    const fld  = row.dataset.field || '?';
    const meth = row.dataset.method || row.dataset.stage || '';
    const conf = row.dataset.conf;
    try {
      if (row.dataset.bbox) {
        const note = `${fld}${meth ? ' · ' + meth : ''}${conf ? ' · ' + conf + '%' : ''}`;
        drawTraceBbox(JSON.parse(row.dataset.bbox), row.dataset.kind || 'target',
                      row.dataset.stage || '_', true, note, true);
        drawn++;
      }
      if (row.dataset.anchorBbox) {
        drawTraceBbox(JSON.parse(row.dataset.anchorBbox), 'anchor',
                      row.dataset.anchorStage || 'anchor_label', true, `${fld} — label`, true);
        drawn++;
      }
    } catch (_) {}
  });
  return drawn;
}

selCanvas.addEventListener('mousedown', (e) => {
  if (!activeField && !anchorDrawField) return;
  hideAnchorReadout();   // card 7: a new draw starts — clear the previous box's read-back so the next message is unambiguous
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
    // Lever 1 (kill switch): start the value read as a PROMISE so the anchor-LABEL reads (inside
    // captureAnchorContext — geometry-only, independent of the value text) can OVERLAP it on the warm
    // worker pool instead of running as a second serial wave. supplier_name is excluded: its anchor
    // scope reads the just-populated issuer input, so it must stay serial to see the new value.
    const _valueReadP = window.docusnap.ocrRegionBoxes?.(base64);
    let _anchorP = null;
    if (window.__drawConcurrentAnchor && fieldKey !== 'supplier_name') {
      const _valTextP = (async () => {
        const _b  = await _valueReadP;
        const _rt = ((_b && _b.text) || (await window.docusnap.ocrRegion(base64)) || '').trim();
        return _rt ? await normalizeDrawnValue(fieldKey, _rt) : _rt;
      })();
      // Start the label reads NOW, concurrent with the value read. captureAnchorContext consumes the
      // value only for its diagnostic tee + an empty-guard (both AFTER its own reads; the anchor
      // record carries no value), so feeding it a promise is safe. .catch keeps an abandoned start
      // (empty read → the if(text) block below is skipped, _anchorP never awaited) quiet.
      _anchorP = captureAnchorContext(rect, fieldKey, _valTextP, imgW, imgH, scaleX, scaleY, null, deskewSnap)
                   .catch(() => null);
    }
    const boxes  = await _valueReadP;
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
      // Lever 1: if the concurrent capture was started above, await it; else run the serial call.
      const detected = _anchorP ? await _anchorP
                                : await captureAnchorContext(rect, fieldKey, text, imgW, imgH, scaleX, scaleY, null, deskewSnap);
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
          // PLAUSIBILITY *and* PROXIMITY (Chris rounds 2 and 4). The old line congratulated the
          // operator whatever came back — a teach that read '@a eens Ee' showed a green toast,
          // flagged nothing, and became two output folders; round 4's `B8ramblewood Joinery Ltd`
          // passes any shape check by construction and still cost twelve filed files. Both
          // questions are now asked, and the answer goes on the PERSISTENT bar rather than a toast
          // the next call destroys. Warning only: the teach stays staged and nothing is blocked.
          await speakIssuerTeach(fieldKey, text);
        } else if (_isListFieldKey(fieldKey)) {
          // LIST field ⊕ (owner 2026-08-27): the box's job was to find the CAPTION. Stage the caption
          // (a doc-type-wide keyword at confirm — never a dead box), fill the field with EVERY value
          // that caption collects on this page, and say so on the bar so the user sees it working.
          _stageListCaption(fieldKey, detected, text);
        } else {
          showAnchorReadout(detected, text);   // show which anchor was picked + the Left/Above toggle
        }
      } else if (_isListFieldKey(fieldKey)) {
        delete pendingAnchors[fieldKey];   // no caption read → nothing to teach for a list (a box would be dead)
        showTeachMessage(`&#9888; I read <span class="ar-val">${escHtml(text)}</span> but no caption beside it — a list is taught by its `
                       + `<strong>caption</strong> (e.g. "Serial No"). Draw again with the caption just left of or above the value, `
                       + `or add the caption in Settings → Learning → Keyword label overrides.`, { warn: true });
      } else {
        // NO ANCHOR CONTEXT — previously silent. The value WAS read and staged, so say so; only the
        // label capture came back empty, which is a weaker outcome, not a failure.
        showTeachMessage(`&#10003; I read <span class="ar-val">${escHtml(text)}</span> from your box, and I'll `
                       + `remember this exact spot on future documents from this sender.`);
      }
      _refreshTaughtDot(fieldKey);   // reflect the staged (or C1-dropped) teach on the field's dot
      // If the ISSUER was just taught, its value IS the resolved supplier for this doc — re-scope
      // EVERY field's taught dot to the new supplier (a new/untaught supplier -> the other fields'
      // dots go off). A DIRECT re-query, not the datalist-popping synthetic 'input' avoided above.
      if (fieldKey === 'supplier_name') { _refreshTaughtForType().catch(() => {}); _clearSuspectReadsForNewIssuer(); _resolveFieldVisibility(); }
    } else {
      // AN EMPTY READ USED TO PRODUCE NOTHING AT ALL (Chris rounds 3 + 4: "four draws, four
      // silences"). Everything above is nested inside `if (text)`, so the one outcome where the
      // operator most needs telling — I looked and found no text — was the one that said least.
      // Nothing is staged in this branch, and the message says exactly that, so the operator is
      // not left believing a teach was saved.
      showTeachMessage(`&#9888; I couldn't read any text in that box, so nothing was saved for `
                     + `<strong>${escHtml(labelFor(fieldKey) || fieldKey)}</strong>. Try drawing it a little wider, `
                     + `or type the value into the field yourself.`, { warn: true });
    }
  } catch (err) {
    console.error('Zone OCR error:', err);
    // A THROWN teach was silent too — the catch only logged to a console the customer never opens.
    showTeachMessage(`&#9888; Something went wrong reading that box, so nothing was saved. Try again, `
                   + `or type the value into the field yourself.`, { warn: true });
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
  // LIST fields (Oracle cond 5, 2026-08-27): the cleanup-rule toolkit is a SCALAR tool — "keep only the
  // main value" / a leading-trailing strip rule would gut an 'A; B; C' store (and the rule would then
  // apply to every future list read of this sender). The pills carry per-element edit/remove instead;
  // the native menu (copy/paste) is left alone. The server (`save-field-rule`) and the engine's
  // field_rules loop refuse a list key too, so this early return is not the only guard.
  if (_isListFieldKey(key)) { closeFieldRuleMenu(); return; }
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
  // `value` may be a string (serial caller) or a Promise (lever 1 concurrent caller). The diag tee
  // is a best-effort no-op unless diagnostic logging is on — fire it with the RESOLVED value, and
  // do NOT block the label reads below on it. A string caller takes the sync branch = byte-identical.
  const _fireDiag = (v) => { try {
    window.docusnap.diagTeach?.({
      field_key: fieldKey, value: v, x_norm: xNorm, y_norm: yNorm,
      w_norm: rect.w / imgW, h_norm: rect.h / imgH,
      rect, imgW, imgH, scaleX, scaleY,
      naturalW: docImg.naturalWidth, naturalH: docImg.naturalHeight,
      page: currentPage, preview_active: !!previewActive,
    });
  } catch {} };
  if (value && typeof value.then === 'function') value.then(_fireDiag); else _fireDiag(value);

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

  // Lever 1: a concurrent caller passes a value PROMISE and starts this before the drawn box has
  // been read. If the read yielded nothing, teach nothing — matching the serial caller, which is
  // gated on a truthy value upstream (so this is inert for it → byte-identical).
  if (value && typeof value.then === 'function') { if (!(await value)) return null; }

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
// ── The teach speaks, on every path ──────────────────────────────────────────────────────────
// Chris has reported the same thing four rounds running, and in round 4 it cost twelve filed
// files: "four draws, four silences, including a near-perfect read." The practice run answers
// every draw with `Read "INV-1042" from your box.` (tutorial/renderer.js) — the real teach had
// never said it once.
//
// WHY THE BAR AND NOT A TOAST (Oracle, 2026-08-13): `#anchor-readout` is persistent, dismissible,
// already renders a read value, and already hosts controls. A toast is destroyed by the next call
// and cannot carry a button. The issuer branch was the one case that skipped this bar entirely and
// used a toast — which is why the loudest failure had the weakest surface.
//
// `actions` are optional [{label, kind, onClick}] rendered after the message, so the near-match
// challenge can offer the incumbent name as a one-click choice rather than an instruction.
function showTeachMessage(html, { warn = false, actions = [] } = {}) {
  const bar = document.getElementById('anchor-readout');
  if (!bar) return null;
  bar.className = 'anchor-readout' + (warn ? ' warn' : '');
  bar.innerHTML = `<span class="ar-msg">${html}</span>`
    + (actions.length
        ? `<span class="ar-dir">${actions.map((a, i) =>
             `<button class="ar-btn ${a.kind === 'primary' ? 'on' : ''}" data-teach-act="${i}">${escHtml(a.label)}</button>`).join('')}</span>`
        : '')
    + `<span class="ar-x" title="Dismiss">&times;</span>`;
  bar.style.display = '';
  actions.forEach((a, i) => {
    bar.querySelector(`[data-teach-act="${i}"]`)?.addEventListener('click', () => { try { a.onClick(); } catch (e) { console.error(e); } });
  });
  bar.querySelector('.ar-x')?.addEventListener('click', hideAnchorReadout);
  if (_anchorReadoutTimer) clearTimeout(_anchorReadoutTimer);
  // A warning that needs a DECISION does not time out; a plain read-back matches the readout dwell.
  if (!warn) _anchorReadoutTimer = setTimeout(hideAnchorReadout, 30000);
  return bar;
}

// Add a SECOND line to the bar without destroying the first. The ⊕ path produces two things the
// operator needs at once — "here is what I read from your box" and "here is what that changed" —
// and a surface where the second erases the first is how the teach came to look silent.
function appendTeachMessage(html, { actions = [] } = {}) {
  const bar = document.getElementById('anchor-readout');
  if (!bar || bar.style.display === 'none' || !bar.innerHTML) return showTeachMessage(html, { warn: true, actions });
  const line = document.createElement('span');
  line.className = 'ar-msg';
  line.style.cssText = 'display:block;margin-top:6px';
  line.innerHTML = html;
  // Explicit if/else: `before()` returns undefined, so `?? appendChild` would ALWAYS also run.
  const _x = bar.querySelector('.ar-x');
  if (_x) _x.before(line); else bar.appendChild(line);
  actions.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'ar-btn';
    b.textContent = a.label;
    b.style.marginLeft = '8px';
    b.addEventListener('click', () => { try { a.onClick(); } catch (e) { console.error(e); } });
    line.appendChild(b);
  });
  // A bar carrying a decision must not vanish under the operator.
  if (_anchorReadoutTimer) { clearTimeout(_anchorReadoutTimer); _anchorReadoutTimer = null; }
  bar.classList.add('warn');
  return bar;
}

// Put a value into a field the same way the ⊕ read does — value + correction + validation, with no
// synthetic 'input' event (that pops the Chromium datalist; reggie, Oracle C5).
function _applyTeachValue(fieldKey, value) {
  const input = document.querySelector(`.field-input[data-key="${fieldKey}"]`);
  if (!input) return false;
  const orig = input.dataset.original;
  input.value = value;
  input.classList.add('corrected');
  corrections[fieldKey] = { original_value: orig, corrected_value: value };
  validateConfirm();
  const row = input.closest('.field-row');
  if (row) {
    dismissServerNote(row, fieldKey);
    const msg = fieldValidationError(fieldKey, input.value);
    if (msg) setFieldWarning(row, input, msg); else clearFieldWarning(row, input);
  }
  if (lastTeachCtx && lastTeachCtx.fieldKey === fieldKey) lastTeachCtx.value = value;
  return true;
}

// The issuer read-back: what was read, whether it looks like a company at all, and — the signal
// that actually catches the round-4 exhibit — whether it is one or two characters off a company
// this customer already files under. Shape can never catch `B8ramblewood Joinery Ltd`; proximity
// to a known name can. Asked of the ONE shared comparison the write guard uses, so the sentence on
// screen and the decision in the database cannot disagree.
async function speakIssuerTeach(fieldKey, text) {
  let implausible = false, nm = null;
  try { const r = await window.docusnap.checkIssuerRead(text); implausible = !!(r && r.implausible); } catch {}
  try { nm = await window.docusnap.checkIdentityNearMatch({ value: text, templateId: currentDoc?.template_id || null }); } catch {}
  const read = `I read <span class="ar-val">${escHtml(text)}</span> from your box.`;
  if (nm && nm.near) {
    // Tier A names how many documents already use the name; Tier B (a fresh install, where the only
    // record of the correct spelling is the sender's own frozen layout) names the layout instead.
    const _known = nm.source === 'template'
      ? `<span class="ar-val">${escHtml(nm.existing)}</span>, the name this sender's saved layout already uses`
      : `<span class="ar-val">${escHtml(nm.existing)}</span>, which you already use on ${nm.confirms} document${nm.confirms === 1 ? '' : 's'}`;
    showTeachMessage(
      (nm.kind === 'subrun'
        ? `&#9888; ${read} That is part of `
        : `&#9888; ${read} That is <strong>${nm.distance === 1 ? 'one character' : nm.distance + ' characters'}</strong> different from `)
      + `${_known}. `
      + `Two spellings would file this sender into two folders.`,
      { warn: true, actions: [
        { label: `Use "${nm.existing}"`, kind: 'primary', onClick: () => {
            if (_applyTeachValue(fieldKey, nm.existing)) {
              showTeachMessage(`&#10003; Using <span class="ar-val">${escHtml(nm.existing)}</span> &mdash; the name you already file under.`);
              _refreshTaughtForType().catch(() => {});
            }
          } },
        { label: 'Keep what I read', onClick: () => {
            showTeachMessage(`${read} Kept as read &mdash; this sender will file separately from `
              + `<span class="ar-val">${escHtml(nm.existing)}</span>.`, { warn: true });
          } },
      ] });
    return;
  }
  if (implausible) {
    showTeachMessage(`&#9888; ${read} That doesn't look like a company name. Draw it again, or type the name in the field yourself.`,
                     { warn: true });
    return;
  }
  showTeachMessage(`&#10003; ${read} Saved as this layout's company name when you confirm.`);
}

function showAnchorReadout(detected, value) {
  // Own the overlay exclusively: wipe any PRIOR anchor highlight first, so a stale box from an
  // earlier field/teach can't be mistaken for the anchor of THIS draw. Then show where THIS teach
  // anchors: the label box (blue) when a caption was found, else the VALUE spot (amber) for a
  // position-only anchor — so "anchored by position" always has a visible spot on the page.
  try {
    clearTraceHighlight();
    if (detected.normBox) {
      drawTraceBbox(detected.normBox, 'anchor', 'manual');
    } else if (lastTeachCtx?.rect && lastTeachCtx.imgW && lastTeachCtx.imgH) {
      const r = lastTeachCtx.rect;
      drawTraceBbox([r.x / lastTeachCtx.imgW, r.y / lastTeachCtx.imgH,
                     r.w / lastTeachCtx.imgW, r.h / lastTeachCtx.imgH], 'target', 'manual');
    }
  } catch {}
  const bar = document.getElementById('anchor-readout');
  if (!bar) return;
  const val   = escHtml((value || '').trim());
  const isLeft  = detected.direction === 'right';
  const isAbove = detected.direction === 'below';
  const typeHeading = !detected.fallback && labelIsTypeHeading(detected.anchor_label);
  const suspicious = !detected.fallback && (labelLooksSuspicious(detected.anchor_label) || typeHeading);
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
    msg = `<span class="ar-msg">&#10003; No label word sits next to this value, so Scan Finder will <strong>remember this exact spot</strong> (highlighted on the page) and read whatever prints here on future documents from this supplier. Read: <span class="ar-val">${val}</span></span>`;
  } else {
    // The label is EDITABLE — an auto-detect off a noisy scan can be misread ("verial No."),
    // and a wrong label never re-locates. The operator can correct it here before Confirm.
    // GARBLE is never displayed (product rule: never ask the user to vouch for junk they
    // can't find on the page) — the input starts EMPTY (= position-only, already staged
    // below) and the message says so plainly; typing the printed caption upgrades it.
    const lead = typeHeading
      ? '&#9888; That&#39;s the document&#39;s <strong>title</strong>, not a label for this field &mdash; so Scan Finder will <strong>remember this spot</strong> (highlighted) and read whatever prints here on future documents. If a real label word sits beside the value, type it below to anchor on the word instead:'
      : suspicious
        ? '&#9888; Couldn&#39;t read the label beside this value &mdash; so Scan Finder will <strong>remember this spot</strong> (highlighted) and read whatever prints here on future documents. Type the label as printed to anchor on the word instead:'
        : `&#10003; The label ${isAbove ? 'above' : 'to the left'}:`;
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
    + `<button class="ar-btn ar-draw" title="Draw a box around the exact label to read from (e.g. &quot;Invoice Total&quot;) — useful when the value sits beside a repeating word like GBP">&#9998; Point out the label</button></span>`
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

// Card 4 (Chris R5, DARK): a 3-way choice at the blank-issuer Confirm & File door — file under the
// engine's corroborated letterhead name, keep it Unknown, or go back. Native confirm() can only do
// two, and the honest "Unknown Company" must stay a first-class choice (never a silent auto-fill —
// the safety that HELD a wrong badge-only name stays). Returns 'adopt' | 'unknown' | 'cancel'.
function showIssuerBlankChoice(name) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
    const ov = document.createElement('div');
    ov.setAttribute('data-help-ignore', '');   // help-mode must not swallow clicks inside the modal
    Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(8,10,15,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '99999', padding: '24px' });
    const box = document.createElement('div');
    Object.assign(box.style, { width: 'min(460px,94vw)', background: 'var(--surface)', border: '1px solid var(--border2)',
      borderRadius: '12px', padding: '20px', boxShadow: '0 18px 50px rgba(0,0,0,.5)', color: 'var(--text)' });
    const h = document.createElement('div');
    h.textContent = 'This document has no Document Issuer';
    Object.assign(h.style, { fontSize: '15px', fontWeight: '600', marginBottom: '10px' });
    const p = document.createElement('div');
    p.style.cssText = 'font-size:13px;line-height:1.5;color:var(--muted);margin-bottom:16px';
    p.innerHTML = `The page looks like it's from <strong></strong>. File it under that company so this `
                + `sender is learned — or file it under “Unknown Company”.`;
    p.querySelector('strong').textContent = name;   // textContent = XSS-safe for the detected name
    const foot = document.createElement('div');
    Object.assign(foot.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });
    const back = document.createElement('button'); back.className = 'btn'; back.textContent = 'Go back'; back.style.marginRight = 'auto';
    const unknown = document.createElement('button'); unknown.className = 'btn'; unknown.textContent = 'File as Unknown Company';
    const adopt = document.createElement('button'); adopt.className = 'btn'; adopt.textContent = `File under “${name}”`;
    Object.assign(adopt.style, { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)', fontWeight: '500' });
    back.onclick = () => finish('cancel');
    unknown.onclick = () => finish('unknown');
    adopt.onclick = () => finish('adopt');
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish('cancel'); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', (e) => { if (e.target === ov) finish('cancel'); });
    foot.append(back, unknown, adopt);
    box.append(h, p, foot);
    ov.append(box);
    document.body.append(ov);
    adopt.focus();
  });
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
async function confirmCurrentDoc({ bulk = false, expectId = null, acknowledgePrefixOutlier = null, acknowledgeIssuerNearMatch = null, acknowledgeTypeSplit = null } = {}) {
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
      if (selectedTypeSlug !== 'general_document') {
        // Card 4 (DARK): if the engine carried a corroborated letterhead name it couldn't safely
        // adopt (a branding-provenance suggestion — the seam), offer to file under it instead of
        // scattering to "Unknown Company". A non-branding suggestion (or none — Path B) never fires,
        // so the honest Unknown Company stays the outcome there. Never a silent auto-fill.
        let _offer = { offer: false };
        if (_issuerBlankOfferOn && window.IssuerBlankOffer) {
          // The suggestion AND its provenance note live on the FULL doc (getDocumentWithExtractions),
          // which renderFields captured as `_lastRenderedDoc`. `currentDoc` is the QUEUE STUB — it has
          // no `extractions` array, only the `issuer_suggested` SCALAR (which carries no note, so it
          // can't clear the branding-provenance gate — Oracle's seam). Read the full doc when it is the
          // doc being confirmed; otherwise make no offer (falls through to the plain dialog — safe).
          // Card 4 is single-mode only (bulk returned above), where the doc is open ⇒ _lastRenderedDoc
          // matches. [Fixed 2026-08-26 after the Chris round found the offer read the empty stub.]
          const _fullDoc = (_lastRenderedDoc && currentDoc && _lastRenderedDoc.id === currentDoc.id) ? _lastRenderedDoc : null;
          const _ext = (_fullDoc?.extractions || []).find(e => e.field_key === issuerKey);
          _offer = window.IssuerBlankOffer.issuerOfferForBlank({
            issuerValue: allValues[issuerKey], suggestedSupplier: _ext?.suggested_supplier, note: _ext?.validation_note });
        }
        if (_offer.offer) {
          const choice = await showIssuerBlankChoice(_offer.name);
          if (choice === 'cancel') return { cancelled: true };
          if (choice === 'adopt') {
            // Adopt for BOTH filing and learning: this doc files under <name>, and the confirm keys
            // hints/anchors/logo on it so the next document from this sender resolves by learned
            // identity. Mirror a typed correction (empty → value) so reviewService.saveCorrections runs.
            allValues[issuerKey] = _offer.name;
            corrections[issuerKey] = { original_value: '', corrected_value: _offer.name };
          }
          // choice === 'unknown' → fall through and file blank under "Unknown Company" (unchanged).
        } else if (!confirm('Document Issuer is blank.\n\nThis document will be filed under "Unknown Company" and '
                 + 'the app won’t learn this sender. File it anyway?')) {
          return { cancelled: true };
        }
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
      // Pass the doc id so the main process can apply the confirm-time plant gate (Oracle C4):
      // a plant is skipped when the confirmed issuer isn't corroborated by THIS document's text.
      saveLogoOnConfirm(supplierForLogo, logoB64, currentDoc?.id).catch(() => {});
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
    // Slice 1: ref field(s) the operator explicitly "Confirm anyway"-ed past the prefix-outlier hold.
    acknowledgePrefixOutlier,
    // Chris round 6: "Keep what I typed" past the issuer near-match hold (a deliberate second company).
    acknowledgeIssuerNearMatch,
    // A3 (type-split arc): "Keep as <type>" past the type-split ask (a deliberate second type).
    acknowledgeTypeSplit,
  });

  if (!result?.success) {
    if (!bulk && pageImages?.length) {
      docImgWrap.style.display = '';
      docImg.src = pageImages[currentPage];
    }
    // Pass the backend code through so bulk filing can tell a license lapse
    // (abort the whole run once) from an ordinary per-doc failure (skip + continue).
    // Every HOLD payload the click handlers dispatch on must ride along — Chris round 17 card 1: the
    // type-split ask (and the round-6 issuer near-match hold before it) fell to their toast branches
    // because only prefixOutlier came back here. Pinned: test_confirm_hold_payloads.js.
    return { error: result?.error || 'Confirm failed. Check settings.', code: result?.code || null,
             prefixOutlier: result?.prefixOutlier || null,
             nearMatch: result?.nearMatch || null,
             typeSplit: result?.typeSplit || null };
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
        // LIST field ⊕ (owner 2026-08-27): the staged record is a CAPTION, not a box — it becomes an
        // additive doc-type-wide keyword for the field ("if it isn't already there"); no anchor is saved.
        if (pendingAnchors[fk] && pendingAnchors[fk].listCaption) {
          const _lc = pendingAnchors[fk];
          const _res = await window.docusnap.teachListCaption?.({
            document_type_slug: _lc.document_type || selectedTypeSlug || currentDoc?.type_slug || null,
            field_key: fk, label: _lc.listCaption });
          if (!bulk && (!_res || !_res.success)) {
            try { showToast(`Filed, but "${_lc.listCaption}" wasn't saved as a keyword for ${labelFor(fk)}${_res && _res.error ? ' — ' + _res.error : ''}. Add it in Settings → Learning → Keyword label overrides.`, 'err'); } catch {}
          }
          continue;
        }
        // template_id: lets the taught-label→keyword write scope to the TEMPLATE the doc matched
        // (migration 62) — null when the doc has none, and the handler then skips that write.
        await window.docusnap.saveFieldAnchor({ ...pendingAnchors[fk], supplier_name: taughtSupplier,
                                                template_id: currentDoc?.template_id ?? null });
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
  // SAY WHERE IT WENT (Chris rounds 3 + 4, verify-list item 6: "Confirming never says where the
  // file went — queue ticked 200→199, silence"). The backend has always returned the filed name and
  // path (reviewService spreads filingResult), and the renderer threw them away. The practice run
  // names every destination and is the clearest thing in the product; this is the same sentence on
  // the real path. Bulk stays silent — File All Ready reports once at the end instead of N times.
  if (!bulk) {
    try {
      const _fn  = result.filename || '';
      const _dir = _filedFolderLabel(result.filePath, _fn);
      if (_fn) showToast(_dir ? `Filed as ${_fn} in ${_dir}.` : `Filed as ${_fn}.`, 'ok');
    } catch { /* naming the destination must never affect the filing that already happened */ }
    // The class fix reports itself here — AFTER the filing message, because what happened to the
    // document in front of them comes first. A bar rather than a toast: it carries the undo, and a
    // 4-second toast is not long enough to decide whether you meant it.
    try {
      if (result.classFix) {
        _classFixState = { ...result.classFix, documentId: currentDoc.id,
                           phase: result.classFix.ask ? 'ask' : 'applied', listOpen: false };
        renderClassFixBar();
      }
    } catch { /* the report must never affect the filing that already happened */ }
    // #1 (issuer sibling-fill): tell the operator the identical siblings are now ready — a toast (the
    // undo lives on the activity-strip chip that the confirm just recorded). The queue is refetched by
    // the click handler AFTER it advances, so File All Ready sees the newly-ready siblings.
    try {
      const _if = result.issuerFill;
      if (_if && Array.isArray(_if.docs) && _if.docs.length) {
        const n = _if.docs.length;
        showToast(`Filled the sender on ${n} more document${n === 1 ? '' : 's'} with this letterhead — `
          + `File All Ready now offers ${n === 1 ? 'it' : 'them'}. You can undo from the activity strip.`, 'ok');
      }
    } catch { /* the report must never affect the filing that already happened */ }
    // Card 1 (DARK): the operator TYPED a field the app couldn't read, and typing teaches the value,
    // not WHERE it sits — so the next documents from this sender read it blank too. Nudge (once per
    // sender) to DRAW a box, which teaches the position. Soft/optional wording: a value typed from
    // memory may not be on the page at all, and the nudge must never read as "you did it wrong".
    try {
      const _ph = result.positionHint;
      if (_ph && Array.isArray(_ph.fields) && _ph.fields.length) {
        const _labels = _ph.fields.map(f => f.label).filter(Boolean);
        const _one = _labels.length === 1;
        const _list = _labels.length > 2 ? `${_labels.slice(0, 2).join(', ')} and more` : _labels.join(' and ');
        const _who = _ph.supplier ? ` from ${_ph.supplier}` : '';
        showToast(`Filed. Typing fixed ${_one ? 'this' : 'these'} on this document only — future documents${_who} `
          + `will read ${_list} blank too. If ${_one ? 'it sits' : 'they sit'} in the same place each time, draw a box `
          + `(⊕) around ${_one ? 'it' : 'one'} to teach Scan Finder where, and it reads ${_one ? 'it' : 'them'} automatically.`, 'info');
      }
    } catch { /* the report must never affect the filing that already happened */ }
  }
  const _issuerFilled = (result.issuerFill && Array.isArray(result.issuerFill.docs)) ? result.issuerFill.docs.length : 0;
  return { filed: true, filename: result.filename || null, filePath: result.filePath || null, issuerFilled: _issuerFilled };
}

// The human-readable tail of a filed path: the folders the operator's own Output Structure made
// ("Bramblewood Joinery Ltd / 2026 / June"), never the absolute path — Search and the detached
// client are de-pathed by design and a toast is not the place to reintroduce one.
function _filedFolderLabel(filePath, filename) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[\\/]+/).filter(Boolean);
  if (filename && parts[parts.length - 1] === filename) parts.pop();
  return parts.slice(-3).join(' / ');
}

// Slice 1: render the prefix-outlier HOLD inline on the reference field — a plain-language note + a
// "Confirm anyway" button that re-confirms with the field acknowledged. Reuses the `.field-note`
// class so editing the field (a correction) auto-dismisses it (dismissServerNote) AND exempts the
// value on the backend, mirroring the accept-btn wiring in appendFieldRow.
function showPrefixOutlierHold(detail, idx, supplier) {
  const field = detail && detail.field;
  const row = field ? document.querySelector(`#fields-scroll .field-row[data-key="${field}"]`) : null;
  if (!row) { showToast('This reference looks unusual for this sender - please check it.', 'err'); return; }
  row.querySelector('.field-note.prefix-hold')?.remove();
  const dom = detail.dominant ? escHtml(detail.dominant) : 'the usual';
  const pfx = detail.prefix ? escHtml(detail.prefix) : '';
  const note = document.createElement('div');
  note.className = 'field-note prefix-hold';
  note.innerHTML = `Starts "${pfx}-" but this sender's references usually start "${dom}-". Fix it above, or `
    + `<button type="button" class="prefix-ack-btn">Confirm anyway</button>`;
  row.appendChild(note);
  const inp = row.querySelector('.field-input'); if (inp) { try { inp.focus(); inp.select?.(); } catch {} }
  note.querySelector('.prefix-ack-btn')?.addEventListener('click', async () => {
    const r2 = await confirmCurrentDoc({ acknowledgePrefixOutlier: [field] });
    if (r2.cancelled) return;
    if (r2.error || r2.code) { showToast(r2.error || 'Confirm failed.', 'err'); return; }
    updateTabCounts();
    advanceAfterAction(idx, supplier);
    _scheduleScopeSweep(supplier, selectedTypeSlug || '');   // catch-up offer after the acknowledged confirm
    try { window.docusnap.markFocusSuspect?.(); } catch {}
    window.docusnap.notifyReviewComplete();
  });
}

// Chris round 6: the typed/read Document Issuer is a near-miss of a company already in use. Render an
// inline hold on the issuer field with two honest choices — swap to the known spelling (which then
// files under one folder), or keep what was typed as a genuinely separate company (acknowledged, so
// the gate lets it through). Mirrors showPrefixOutlierHold; reuses the .field-note + .prefix-ack-btn
// styling so it looks and dismisses like the reference hold.
// A3 (type-split arc, 2026-08-22; Oracle S2-js-a): the TYPE-SPLIT hold. reviewService refused the
// confirm because this issuer's history (N confirmed docs) is 100 % one other type. Two honest
// answers, inline under the type select: change the type (focus the select — the field list follows
// it, the operator confirms again as usual) or keep the chosen type (acknowledge → files; once filed,
// the history is no longer 100 % one type and the ask never fires again for this sender).
function showTypeSplitHold(ts, idx, groupKey) {
  const sel = document.getElementById('doctype-select');
  const host = sel?.closest('.field-row, .type-row, .doctype-row') || sel?.parentElement;
  if (!host || !ts || !ts.established_name) {
    showToast(ts && ts.message ? ts.message : 'This sender has only ever filed as one document type — check the type before filing.', 'warn');
    return;
  }
  host.querySelector('.field-note.type-split-hold')?.remove();
  const note = document.createElement('div');
  note.className = 'field-note type-split-hold';
  const est = escHtml(ts.established_name), typed = escHtml(ts.typed_name || ts.typed_slug || 'this type');
  note.innerHTML = `<strong>${escHtml(ts.supplier || '')}</strong> files as <strong>${est}</strong> (${Number(ts.count) || 0} so far). `
    + `File this one as <strong>${typed}</strong>? `
    + `<button type="button" class="prefix-ack-btn tsh-change-btn">Change the type</button> `
    + `<button type="button" class="prefix-ack-btn tsh-keep-btn">Keep ${typed}</button>`;
  host.appendChild(note);
  note.querySelector('.tsh-change-btn')?.addEventListener('click', () => {
    note.remove();
    try { sel.focus(); if (typeof sel.showPicker === 'function') sel.showPicker(); } catch {}
  });
  note.querySelector('.tsh-keep-btn')?.addEventListener('click', async () => {
    note.remove();
    const r2 = await confirmCurrentDoc({ acknowledgeTypeSplit: true });
    if (r2.cancelled) return;
    if (r2.code === 'PREFIX_OUTLIER') { showPrefixOutlierHold(r2.prefixOutlier, idx, ts.supplier); return; }
    if (r2.code === 'ISSUER_NEAR_MATCH') { showIssuerNearMatchHold(r2.nearMatch, idx, ts.supplier); return; }
    if (r2.error || r2.code) { showToast(r2.error || 'Confirm failed.', 'err'); return; }
    updateTabCounts();
    advanceAfterAction(idx, groupKey);
    refreshScopeReadiness().then(() => renderQueueList()).catch(() => {});
    try { window.docusnap.markFocusSuspect?.(); } catch {}
    window.docusnap.notifyReviewComplete();
  });
}

function showIssuerNearMatchHold(nm, idx, supplier) {
  const row = document.querySelector('#fields-scroll .field-row[data-key="supplier_name"]');
  const input = row?.querySelector('.field-input');
  const cur = (input?.value || '').trim();
  if (!row || !nm || !nm.existing) {
    // NEVER a dead end (owner-found 2026-08-18): the inline note carries the only two ways past
    // this hold, so when it cannot be rendered the toast must say what to DO — the old copy
    // printed the placeholder as if it were the company's name and offered nothing.
    showToast(nm && nm.existing
      ? `This issuer is close to "${nm.existing}", a company you already use — open the Document Issuer field and correct it, or confirm again to keep what you typed.`
      : 'This issuer looks like a company you already use under a slightly different spelling — check the Document Issuer field before filing.',
      'warn');
    return;
  }
  row.querySelector('.field-note.issuer-nm-hold')?.remove();
  const known = escHtml(nm.existing);
  // r18 copy bug: a sub-run hit carries distance:null — never print "null characters". The branch below
  // routes on kind; this fallback covers any payload that lost its kind on the way here.
  const _dist = Number(nm.distance);
  const diff  = _dist === 1 ? 'one character' : (Number.isFinite(_dist) && _dist > 0 ? `${_dist} characters` : 'a few characters');
  const note = document.createElement('div');
  note.className = 'field-note issuer-nm-hold';
  // source 'letterhead' (slice 3 of the garbled-issuer arc, Oracle C3.3): not a near-miss of a
  // company you use — the letterhead on THIS page reads the company; the issuer box read a garble.
  const lead = nm.source === 'letterhead'
    ? `The letterhead on this page reads <strong>${known}</strong> — the issuer box read "${escHtml(cur)}". `
      + `Filing as "${escHtml(cur)}" would start a new sender folder. `
    : nm.kind === 'subrun'
    ? `"${escHtml(cur)}" is part of <strong>${known}</strong>${nm.source === 'prefix-template' ? ', the name this layout already uses' : ''} — `
      + `a box over a two-line name often catches one line. Filing as "${escHtml(cur)}" would start a second folder. `
    : `"${escHtml(cur)}" is <strong>${diff}</strong> off <strong>${known}</strong>, which you already use — `
      + `two spellings would file this sender into two folders. `;
  note.innerHTML = lead
    + `<button type="button" class="prefix-ack-btn inm-use-btn">Use "${known}"</button> `
    + `<button type="button" class="prefix-ack-btn inm-keep-btn">Keep "${escHtml(cur)}"</button>`;
  row.appendChild(note);
  if (input) { try { input.focus(); input.select?.(); } catch {} }
  const finish = (r2) => {
    if (r2.cancelled) return;
    if (r2.error || r2.code) {
      if (r2.code === 'ISSUER_NEAR_MATCH') { showIssuerNearMatchHold(r2.nearMatch, idx, supplier); return; }  // still a near-miss
      showToast(r2.error || 'Confirm failed.', 'err'); return;
    }
    updateTabCounts();
    advanceAfterAction(idx, supplier);
    _scheduleScopeSweep(supplier, selectedTypeSlug || '');
    try { window.docusnap.markFocusSuspect?.(); } catch {}
    window.docusnap.notifyReviewComplete();
  };
  note.querySelector('.inm-use-btn')?.addEventListener('click', async () => {
    // Swap the field to the known name (records the correction), then re-confirm — the value now
    // EXACTLY matches the known company, so the gate passes without an acknowledge.
    note.remove();
    if (!_applyTeachValue('supplier_name', nm.existing) && input) {
      input.value = nm.existing; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    finish(await confirmCurrentDoc());
  });
  note.querySelector('.inm-keep-btn')?.addEventListener('click', async () => {
    note.remove();
    finish(await confirmCurrentDoc({ acknowledgeIssuerNearMatch: true }));
  });
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
  const _groupKey = reviewGroupKey(currentDoc);                 // slice 3: the VISIBLE pile, not the raw value
  // Catch-up: capture the scope BEFORE confirm mutates/advances the selection. The confirmed
  // supplier may differ from the row (operator typed/accepted one) — prefer the on-screen value.
  const _sweepSupplier = (document.querySelector('#fields-scroll .field-input[data-key="supplier_name"]')?.value || supplier || '').trim();
  const _sweepSlug     = selectedTypeSlug || currentDoc?.type_slug || '';
  const r = await confirmCurrentDoc();
  if (r.cancelled) return;
  // Slice 1: a suspicious-reference HOLD — surface the note + a "Confirm anyway" affordance on the
  // ref field instead of a transient error toast (editing the field also clears it and exempts it).
  if (r.code === 'PREFIX_OUTLIER') { showPrefixOutlierHold(r.prefixOutlier, idx, supplier); return; }
  // Chris round 6: the typed issuer is one/two characters off a company already in use — offer the
  // known spelling or an explicit "keep what I typed", inline on the issuer field, before filing.
  if (r.code === 'ISSUER_NEAR_MATCH') { showIssuerNearMatchHold(r.nearMatch, idx, supplier); return; }
  // A3 (type-split arc): this issuer has only ever filed as ONE other type — ask once, inline on the
  // type select, before a mistyped confirm plants a rival template on the letterhead.
  if (r.code === 'TYPE_SPLIT') { showTypeSplitHold(r.typeSplit, idx, _groupKey); return; }
  if (r.error) { showToast(r.error, 'err'); return; }
  updateTabCounts();
  advanceAfterAction(idx, _groupKey);
  // #1 (issuer sibling-fill): the identical siblings were just pre-filled server-side, so their queue
  // rows (below_threshold / issuer_blank / flag counts) are stale in memory — refetch so File All Ready
  // and the queue colours reflect the newly-ready siblings immediately.
  if (r.issuerFilled) { try { _refreshQueueFromBroadcast?.().catch(() => {}); } catch {} }
  // The finish line must MOVE as the operator works — a countdown that only updates on reopen is
  // worse than none (it reads as "nothing I did counted"). One cheap read-only call per confirm.
  refreshScopeReadiness().then(() => renderQueueList()).catch(() => {});
  _scheduleScopeSweep(_sweepSupplier, _sweepSlug);   // consent-gated catch-up offer (dark unless enabled)
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
  // SAY HOW MANY (Chris round 4: "File All Ready warned … no count", and it filed 19 — twelve of
  // them under a misspelled company). The number uses the loop's OWN skip rule below
  // (`isFlagged(doc) && !doc.review_acknowledged_at`), so the dialog cannot promise a different
  // population from the one that runs. It is stated as "up to", honestly: a document can still be
  // held back by a missing type or required field, which is only knowable once its fields load.
  // Chris r12 #5: "File up to 14" filed 3 — the count included documents with NO type or an EMPTY
  // required field, which the loop below then skips. Count with the SAME three reasons the loop
  // skips on (flag-not-acknowledged · no type · missing required, the latter from the queue row's
  // missing_required_labels — the DB twin of validateConfirm), and name each held group, so the
  // number on the button is the number that files.
  // Q4b (2026-08-22): THE ONE classifier (shared/reviewReadiness.js) — the same partition Home's
  // "N ready to file" is computed from (documents.getReviewSplit), so the two never disagree.
  const _parts     = window.ReviewReadiness.partition(docs, { valuedOnly: !!window.__farValuedOnly });
  const _flagged   = _parts.flagged;
  const _noType    = _parts.noType;
  const _missing   = _parts.missing;
  const _eligible  = _parts.ready.length;
  // Chris r19 N6: put-back documents are waiting on YOU, not on a check — say so, and count them out
  // of the flagged line (the classifier files them under 'flagged' so File All never sweeps them).
  const _putBack   = _flagged.filter(d => d && d.put_back_at);
  const _flaggedOnly = _flagged.length - _putBack.length;
  // Put-back re-file (mig 87, Oracle W/COND cond 4): the put-back docs that will RE-FILE on this click —
  // they are in `ready` because they still clear the strict auto-file predicate (putback_refileable). They
  // must be NAMED as a distinct, undoable line in the dialog so the re-file is never a silent surprise. OFF
  // → no put-back doc is ever 'ready', so this set is always empty and the line never shows.
  const _putBackRefiling = _parts.ready.filter(d => d && d.put_back_at);
  // THE KEPT-BACK SET for the strip receipt — built from THE ONE classifier so the chip names exactly the
  // population the dialog named. A zero-filed File All then still leaves a chip ("Nothing filed — N kept
  // back", each reason spelled out in the panel), instead of the strip staying silent (the record() null
  // at zero ids/zero dropped). Merged into the run's approved|bulk chip when some do file.
  const _dropped = [
    ..._putBack.map(d => ({ docId: d.id, reason: 'put-back' })),
    ..._flagged.filter(d => d && !d.put_back_at).map(d => ({ docId: d.id, reason: 'stored-flagged' })),
    ..._noType.map(d => ({ docId: d.id, reason: 'no-type' })),
    ..._missing.map(d => ({ docId: d.id, reason: 'missing-required' })),
  ].filter(d => d.docId);
  if (_eligible <= 0) {
    showToast(_putBack.length
      ? `Nothing is ready to file by itself — ${_putBack.length} you put back ${_putBack.length === 1 ? 'is' : 'are'} waiting for your Confirm, and the rest are waiting on a check or a missing detail.`
      : 'Nothing is ready to file yet — every document in the queue is waiting on a check or a missing detail.', 'warn');
    await _asFileAllReconcile(_dropped);   // leave a strip receipt even though nothing filed
    return;
  }
  const _heldLines = [];
  if (_putBack.length) _heldLines.push(`${_putBack.length} you put back — each waits for your own Confirm`);
  if (_flaggedOnly > 0) _heldLines.push(`${_flaggedOnly} flagged — waiting for you to check a value`);
  if (_noType.length)  _heldLines.push(`${_noType.length} with no document type yet`);
  if (_missing.length) _heldLines.push(`${_missing.length} missing a required detail (date, reference or sender)`);
  if (!confirm(
        `File ${_eligible} ready document${_eligible === 1 ? '' : 's'} (of ${docs.length} in the Review queue)?\n\n` +
        (_putBackRefiling.length
          ? `Includes ${_putBackRefiling.length} you put back and looked at — ${_putBackRefiling.length === 1 ? 'it' : 'they'} will be filed again (you can undo this from the activity strip).\n\n`
          : '') +
        (_heldLines.length ? `Not included — they stay in the queue:\n  • ${_heldLines.join('\n  • ')}\n\n` : '') +
        `Each one is filed exactly as if you confirmed it yourself. ` +
        `Anything that turns out to need a detail is left in the queue for you.`)) return;

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

  let filed = 0, skipped = 0, noType = 0, missingReq = 0, aborted = false;
  const missingReqFields = new Set();   // labels of required fields that held docs back (card 2 summary)
  const _fileAllScopes = new Map();   // JSON([supplier, slug]) -> filed count (catch-up trigger)

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
      // Chris round 20 card 1: the loop must skip EXACTLY what the dialog said it would — THE ONE
      // classifier (shared/reviewReadiness.js). A put-back document carries no note, so the note-only
      // check above let "File 2" file 11: the nine the dialog had listed under "Not included".
      if (window.ReviewReadiness && window.ReviewReadiness.classify(doc, { valuedOnly: !!window.__farValuedOnly }) !== 'ready') { skipped++; continue; }

      try {
        await selectDoc(doc, { fieldsOnly: true });    // loads fields (no preview render); runs validateConfirm()
        if (confirmBtn.disabled) {                     // not ready — leave for review
          skipped++;
          if (!doc.type_slug) {
            noType++;                                   // dominant reason: no document type detected
          } else {
            // typed but held — a required field is empty (or a dangling role). Name the fields
            // validateConfirm just marked, so the zero-filed summary can explain itself (card 2).
            missingReq++;
            document.querySelectorAll('.field-row-label.required-missing').forEach(el => {
              const lab = (el.textContent || '').trim();
              if (lab) missingReqFields.add(lab);
            });
          }
          continue;
        }
        const r = await confirmCurrentDoc({ bulk: true, expectId: doc.id });
        if (r.filed) {
          filed++;
          const _sup = (doc.supplier_name || '').trim(), _slug = doc.type_slug || '';
          if (_sup && _slug) {
            const k = JSON.stringify([_sup, _slug]);
            _fileAllScopes.set(k, (_fileAllScopes.get(k) || 0) + 1);
          }
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
  // Batch done: keep the operator moving — land on the first document still in the visible order
  // (grouped view included), or clear to the "all reviewed" done-state when none remain, instead of
  // showing "All documents reviewed ✓" over a queue that still has skipped docs. (advanceAfterAction
  // re-renders the list itself, so the explicit renderQueueList above is folded in.)
  // AWAITED (Chris round 6, card 2): selectDoc→renderPage calls hideAnchorReadout; awaiting it here
  // means the persistent File-All summary below is painted AFTER that, so it is not wiped instantly.
  await advanceAfterAction(0, null);
  if (filed) window.docusnap.notifyReviewComplete();
  // Catch-up: after a File-All run, offer the sweep for the run's dominant scope (the docs it
  // just filed are exactly the "you just confirmed" evidence the sweep re-checks against).
  if (filed && _fileAllScopes.size) {
    const top = [..._fileAllScopes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) { try { const [sup, slug] = JSON.parse(top[0]); _scheduleScopeSweep(sup, slug); } catch {} }
  }
  // Strip receipt: merge the kept-back reasons into this run's chip (or leave a 0-filed chip) and refetch
  // the ledger so the bulk count is accurate — the activity strip must never be silent after a File All.
  await _asFileAllReconcile(_dropped);

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

  // A SUMMARY THAT SURVIVES (Chris round 4: "File All Ready … no summary after"; it filed 19, and
  // twelve went into a misspelled company folder he only found on disk). The banner auto-dismisses
  // in 3.5s and the toast in 4 — neither is a record. This names WHICH senders received documents,
  // built from `_fileAllScopes`, which the run already collects for the catch-up sweep, and it sits
  // on the persistent bar until dismissed. Naming the companies is the point: a wrong one is
  // recognisable at a glance, which is exactly what nobody got the chance to do.
  // ALWAYS fires (Chris round 5, card 2): "filed 0, said nothing" — the run that most needs an
  // explanation is exactly a zero-filed run, so the summary must NOT be gated on `filed`.
  try {
    // Spell out the dominant HELD reason so "Filed 0 of 40" is never a silent dead end.
    const _reasons = [];
    if (missingReq) {
      const _f = [...missingReqFields].slice(0, 3);
      _reasons.push(`${missingReq} still ${missingReq === 1 ? 'needs' : 'need'} a required field`
        + (_f.length ? ` (${_f.map(escHtml).join(', ')})` : ''));
    }
    if (noType) _reasons.push(`${noType} ${noType === 1 ? 'has' : 'have'} no document type detected`);
    const _other = skipped - missingReq - noType;
    if (_other > 0) _reasons.push(`${_other} not ready to file`);
    const _heldNote = _reasons.length ? ` — ${_reasons.join('; ')}. They stay in the queue for you to check.` : '';

    if (filed) {
      const _byCo = [..._fileAllScopes.entries()]
        .map(([k, n]) => { try { return { name: JSON.parse(k)[0], n }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.n - a.n);
      const _list = _byCo.slice(0, 6).map(c => `<strong>${escHtml(c.name)}</strong> (${c.n})`).join(', ');
      const _more = _byCo.length > 6 ? ` and ${_byCo.length - 6} more` : '';
      showTeachMessage(
        `&#10003; Filed ${filed} document${filed === 1 ? '' : 's'}`
        + (_list ? ` &mdash; ${_list}${_more}` : '')
        + (skipped ? `.${_heldNote || ` ${skipped} left in the queue for you to check.`}` : '.'),
        { warn: !!skipped });
    } else {
      // ZERO filed — say so plainly, with the reason (card 2).
      showTeachMessage(
        `Filed 0 of ${_eligible} document${_eligible === 1 ? '' : 's'}${_heldNote || '.'}`,
        { warn: true });
    }
  } catch { /* the summary must never affect the filing that already happened */ }
  // Card 3 (Chris R5): the FIRST File All on a fresh install can correctly file 0 — new senders need a
  // few confirms before they graduate — and that reads as "broken." Say why ONCE, only when the holds
  // are genuine COLD-START (senders queued, below the confirm bar, not merely missing a field / a
  // template). Two independent brakes stop it nagging: a persisted one-shot flag, and the cold-start
  // content gate itself (inert the moment any sender graduates → _scopeReadiness reports ready). This
  // is an EXPECTATION line, not a filing change — it never touches the auto-file predicate.
  try {
    if (skipped > 0) {
      const _seen = await window.docusnap.getSetting?.('fileall_coldstart_hint_seen');
      if (!_seen) {
        try { await refreshScopeReadiness(); } catch { /* read the state we have */ }
        const _coldStart = Array.isArray(_scopeReadiness) && _scopeReadiness.some(s =>
          s && !s.ready && !s.needsTemplate && Number(s.queued || 0) > 0
            && Number(s.confirms || 0) < Number(s.needed || 0));
        if (_coldStart) {
          appendTeachMessage('New senders need a few confirms before they file themselves — the '
            + 'next batch will file more on its own.');
          try { await window.docusnap.setSetting?.('fileall_coldstart_hint_seen', '1'); } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* advisory — never affect the filing that already happened */ }
}
document.getElementById('btn-file-all-review')?.addEventListener('click', fileAllReady);

// Post-reprocess CONSENT BAR (Oracle-signed 2026-08-12; replaces the queue-wide
// autoCommitFullConfidence sweep, which filed 101 docs across every supplier after a 14-doc
// group reprocess — silently, attributed to the human). The offer is computed SERVER-SIDE from
// the finished batch's OWN docs ∩ the shared auto-file predicate and arrives on the consumed
// completion as `offerIds` (display only). Nothing files until the operator clicks File N; the
// accept IPC takes NO payload — the server files its own recorded offer, so this window can
// accept or ignore the offer but never widen it.
let _rabOfferIds = null;   // Q4c: the reprocess-offer bar's live candidate ids (pruned on every queue refresh)
function showReprocessAutofileOffer(offerIds) {
  const bar = document.getElementById('reprocess-autofile-bar');
  if (!bar || !Array.isArray(offerIds) || !offerIds.length) return;
  _rabOfferIds = offerIds.slice();
  const n = offerIds.length;
  bar.innerHTML =
    `<b>${n}</b> reprocessed document${n === 1 ? '' : 's'} read clean and ${n === 1 ? 'is' : 'are'} ready to file — `
    + `<button class="btn" id="rab-file">✓ File ${n}</button> `
    + `<button class="btn" id="rab-review">Review them</button> `
    + `<button class="btn" id="rab-dismiss">Not now</button>`;
  bar.style.display = 'block';
  document.getElementById('rab-file')?.addEventListener('click', async () => {
    bar.style.display = 'none'; _rabOfferIds = null;
    let r = null;
    try { r = await window.docusnap.reprocessAutocommitAccept(); } catch {}
    if (r && r.ok) {
      const dropped = (r.dropped || []).length;
      // "you approved", not "automatically" — the operator just clicked "File N" (Chris card 4).
      showToast(`✓ Filed ${r.filed.length} document${r.filed.length === 1 ? '' : 's'} you approved`
        + (dropped ? ` · ${dropped} left for review` : ''), r.filed.length ? 'ok' : 'warn');
    } else {
      showToast('Nothing was filed' + (r && r.reason ? ` (${r.reason})` : '') + ' — the documents stay in the queue.', 'warn');
    }
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts();
    renderQueueList();
    refreshAutoCommittedBar();
    if (currentDoc && !queue.some(d => d.id === currentDoc.id)) {
      if (queue.length) selectDoc(queue[0]);
      else { currentDoc = null; clearDocPanel(); }
    }
  }, { once: true });
  document.getElementById('rab-review')?.addEventListener('click', () => {
    bar.style.display = 'none'; _rabOfferIds = null;
    _sweepFilterIds = new Set(offerIds);   // reuse the existing "Review them" queue filter
    renderQueueList();
  }, { once: true });
  document.getElementById('rab-dismiss')?.addEventListener('click', () => {
    bar.style.display = 'none'; _rabOfferIds = null;   // offer stays server-side; a new batch overwrites it
  }, { once: true });
}

// ── Catch-up Filing slice 3 (design 2026-07-31, dark unless scope_sweep_enabled) ──────
// After a HUMAN confirm, ask the server whether the same scope's still-queued docs now pass
// the normal auto-file gate ("checked against the documents you just confirmed") and offer a
// consent bar: File N · Review them · Not now, with a per-doc untick list. The accept path
// re-validates EVERYTHING server-side (fingerprint + the same gate) and files through the one
// shared confirm with confirmed_via='scope_sweep'; Undo all reverses cleanly.
let _sweepTimer = null, _sweepState = null;
const _sweepDismissed = new Set();          // per-scope "Not now" (session-only)
let _sweepFilterIds = null;                 // "Review them" queue filter (Set<docId> | null)

const _SWEEP_REASON_COPY = {
  'being-viewed':        'being viewed by someone',
  'changed':             'its fields changed after the offer',
  'not-queued':          'it was handled in the meantime',
  'workflow-locked':     'it is in an approval workflow',
  'scope-mismatch':      'its sender or type changed',
  'role-empty-fresh':    'a key field read empty on re-check',
  'role-empty-stored':   'a key field is empty',
  'role-mismatch':       'a key field read differently on re-check',
  'contradiction':       'a field read differently on re-check',
  'fresh-value-on-empty': 'found a new value on re-check',
  'stored-flagged':      'it is flagged for review',
  'fresh-flagged':       'the re-check flagged it',
  'type-flip':           'the document type read differently on re-check',
  // File All Ready kept-back reasons (the strip receipt names why a document did not file)
  'no-type':             'it has no document type yet',
  'missing-required':    'it is missing a required detail (date, reference or sender)',
  'put-back':            'you put it back — it waits for your own Confirm',
};
function _sweepReason(r) {
  if (!r) return 'it did not pass the checks';
  if (_SWEEP_REASON_COPY[r]) return _SWEEP_REASON_COPY[r];
  if (String(r).startsWith('recheck-')) return 'it needs a full re-read';
  return 'it did not pass the checks';
}
const _sweepScopeKey = (s, t) => `${String(s || '').trim().toLowerCase()}|${String(t || '').toLowerCase()}`;

// QUEUE-WIDE, TIER-1 ONLY (gary → Oracle, 2026-08-18). The per-scope sweep only ever looked at the
// sender just confirmed, so on a ten-sender batch nine senders went unswept — and a confirm that
// unlocked a DIFFERENT sender's documents (they share a learned corpus) went unnoticed until the
// customer reached for Reprocess All. This asks the whole queue at once, on stored rows only.
//
// gary's three trigger defects, all fixed here:
//   • ONE shared `_sweepTimer` was cleared on every schedule, so confirming two senders inside the
//     debounce silently cancelled the first sweep — on a ten-sender queue that lost most triggers.
//     A queue-wide pass has nothing to race: one timer is now correct rather than lossy.
//   • `candidates.length < 2` discarded a single liftable document with no trace. One document
//     ready to file is worth saying so.
//   • `_sweepDismissed` was permanent for the session. Oracle: auto-resurrecting a dismissed bar is
//     nagware, so the dismissal STANDS — but it is now re-summonable by hand (see the rail button),
//     which also makes the whole feature discoverable instead of ambush-triggered.
// (Dismissal is per-SCOPE — `_sweepDismissed` — never session-wide: see the 'later' handler.)

// Q4c (2026-08-22): a fresh server answer SUPERSEDES a stale offer. The bar Chris pressed ("File up
// to 12" → "Filed 0") was an offer-phase snapshot left standing after auto-accept filed those 12 —
// the re-asked sweep returned nothing and the old code simply returned, leaving the bar. An
// offer-phase bar is retired on a "nothing" / "auto-accept-running" answer; a 'filing' or 'done'
// bar is never touched (the receipt belongs to scope-auto-filed / the accept path).
function _retireStaleOffer() {
  if (_sweepState && _sweepState.phase === 'offer') { _sweepState = null; renderSweepConsentBar(); }
}
async function _runQueueSweep({ manual = false, via = null } = {}) {
  if (bulkFiling || _batchActive) return false;
  let res = null;
  try { res = await window.docusnap.sweepQueueCandidates?.(); } catch { return false; }
  if (res && res.ok === false && res.reason === 'auto-accept-running') {
    // Slice 1: the server is filing a sender's ready documents right now; it will broadcast
    // scope-auto-filed when done and this sweep re-runs then. Never show a bar over those docs.
    _retireStaleOffer();
    if (manual) showToast('Filing a sender’s ready documents now — check again in a moment.', 'info');
    return false;
  }
  if (!res || !res.ok || !Array.isArray(res.scopes) || !res.scopes.length) {
    // SAY THE NEGATIVE RESULT OUT LOUD (Chris): silence after a confirm is ambiguous between
    // "checked, nothing changed" and "didn't check" — and that ambiguity is exactly what sends
    // people back to Reprocess All. Only on an explicit ask, so it never becomes chatter.
    _retireStaleOffer();
    if (manual) showToast('Checked everything still waiting — nothing new is ready to file yet.', 'info');
    return false;
  }
  const byId = new Map(queue.map(d => [d.id, d]));
  // The offer is per-scope server-side (accept/undo are scope-keyed); present the LARGEST scope the
  // operator has NOT already dismissed this session — otherwise one "Not now" on the biggest sender
  // would hide every other sender's ready documents behind it.
  const live = res.scopes.filter(x => !_sweepDismissed.has(_sweepScopeKey(x.supplier, x.typeSlug)));
  const pool = (manual && !live.length) ? res.scopes : live;   // an explicit ask overrides a dismissal
  if (!pool.length) {
    if (manual) showToast('Checked everything still waiting — nothing new is ready to file yet.', 'info');
    return false;
  }
  const g = pool.slice().sort((a, b) => b.candidates.length - a.candidates.length)[0];
  const others = pool.length - 1;
  _sweepState = {
    phase: 'offer', supplier: g.supplier, typeSlug: g.typeSlug,
    candidates: g.candidates.filter(c => byId.has(c.docId))
      .map(c => ({ ...c, filename: byId.get(c.docId)?.original_filename || `#${c.docId}` })),
    excluded: [], unticked: new Set(), listOpen: false,
    otherScopes: others > 0 ? others : 0,
    via,   // 'quiet' when the quiet re-read's job_done asked — the bar then says "re-read just now"
  };
  if (!_sweepState.candidates.length) { _sweepState = null; renderSweepConsentBar(); return false; }
  renderSweepConsentBar();
  return true;
}

function _scheduleScopeSweep(supplier, typeSlug) {
  // The scope arguments are now advisory — a confirm can unlock ANY sender, so the sweep asks the
  // whole queue. Kept in the signature so every existing call site works unchanged.
  clearTimeout(_sweepTimer);
  _sweepTimer = setTimeout(() => { _runQueueSweep().catch(() => {}); }, 2500);
}

// The manual re-summon (Oracle C11). Shown only when the sweep is enabled — a button that always
// answers "nothing to do" on an install where the feature is off would be a lie of omission.
(async () => {
  const btn = document.getElementById('btn-sweep-check');
  if (!btn) return;
  try {
    const on = await window.docusnap.getSetting?.('scope_sweep_enabled');
    if (String(on) !== 'true') return;                    // stays hidden while the feature is dark
  } catch { return; }
  btn.style.display = '';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await _runQueueSweep({ manual: true }); }       // manual: says so even when the answer is "nothing"
    finally { btn.disabled = false; }
  });
})();

// ── THE CLASS-FIX BAR ───────────────────────────────────────────────────────────────────────────
// Two states, and only ever one of them at a time.
//  • APPLIED — the fix already happened. Say what was done, to how many, and offer a way back.
//    This is the owner's instruction taken literally: act, then tell, no dialog beforehand and no
//    second dialog after. The undo is what makes acting-first honest.
//  • ASK — the sender's confirmed history holds BOTH forms, so this may be a second convention
//    rather than a misread and the app genuinely does not know. Ask ONCE, name the documents, and
//    remember the answer for that class so the next correction of it is silent (Oracle C6). Asking
//    every time is the thing the owner banned.
let _classFixState = null;

function renderClassFixBar() {
  const bar = document.getElementById('class-fix-bar');
  if (!bar) return;
  const s = _classFixState;
  if (!s) { bar.style.display = 'none'; bar.innerHTML = ''; return; }

  const list = (rows, valueOf) => `<div class="scb-list">` + rows.map(r =>
      `<div class="scb-row"><span class="scb-muted">•</span>`
      + `<label title="${escHtml(r.filename || '')}">${escHtml(r.filename || `Document ${r.id}`)}`
      + ` — <b>${escHtml(valueOf(r))}</b></label></div>`).join('') + `</div>`;

  if (s.phase === 'ask') {
    const n = s.candidates.length;
    bar.innerHTML =
      `<div>You corrected <b>${escHtml(s.from)}</b> to <b>${escHtml(s.to)}</b>. `
      + `${n} other document${n === 1 ? '' : 's'} waiting from this sender read <b>${escHtml(s.from)}</b> too — `
      + `but this sender has confirmed <b>${escHtml(s.from)}</b> in the past, so it may be a genuine second series. `
      + `Fix ${n === 1 ? 'it' : 'them'} as well?</div>`
      + (s.listOpen ? list(s.candidates, r => `${r.was} → ${r.now}`) : '')
      + `<div class="scb-actions">`
      + `<button class="scb-btn primary" data-cf="yes">Yes, fix ${n === 1 ? 'it' : `all ${n}`}</button>`
      + `<button class="scb-btn" data-cf="no">No, leave them</button>`
      + `<span class="scb-toggle" data-cf="list">${s.listOpen ? 'Hide' : 'Show'} the documents</span>`
      + `</div><div class="scb-muted">Asked once for this correction — whichever you choose is `
      + `remembered, so you will not be asked about ${escHtml(s.from)} again.</div>`;
    bar.style.display = '';
    return;
  }

  const n = s.docs.length;
  const cleared = s.docs.filter(d => d.noteCleared).length;
  const held = n - cleared;
  // The RESULT phase (not the 'ask', which needs a decision) is a RECEIPT — it must be dismissible.
  // A close X (data-cf="close") + it also clears when the operator moves to another document (selectDoc).
  bar.innerHTML =
    `<span class="scb-x" data-cf="close" title="Dismiss">&times;</span>`
    + `<div>Also corrected <b>${escHtml(s.from)}</b> to <b>${escHtml(s.to)}</b> on `
    + `<b>${n}</b> other document${n === 1 ? '' : 's'} waiting from this sender.</div>`
    + (held
        ? `<div class="scb-muted">${cleared ? `${cleared} now read cleanly. ` : ''}`
          + `${held} still need${held === 1 ? 's' : ''} a look — their pages could not be re-checked, `
          + `so they stay in Review.</div>`
        : `<div class="scb-muted">Nothing has been filed — they are still in Review for you to confirm.</div>`)
    + (s.remaining ? `<div class="scb-muted">${s.remaining} more matched but were left alone (25 at a time).</div>` : '')
    + (s.listOpen ? list(s.docs, r => `${r.was} → ${r.now}`) : '')
    + `<div class="scb-actions">`
    + `<span class="scb-toggle" data-cf="list">${s.listOpen ? 'Hide' : 'Show'} what changed</span>`
    + `<span class="scb-undo" data-cf="undo">Undo</span>`
    + `</div>`;
  bar.style.display = '';
}

document.getElementById('class-fix-bar')?.addEventListener('click', async (e) => {
  const act = e.target?.dataset?.cf;
  if (!act || !_classFixState) return;
  if (act === 'close') { _classFixState = null; renderClassFixBar(); return; }   // dismiss the receipt
  if (act === 'list') { _classFixState.listOpen = !_classFixState.listOpen; renderClassFixBar(); return; }
  if (act === 'undo') {
    const id = _classFixState.batchId;
    _classFixState = null; renderClassFixBar();
    try {
      const r = await window.docusnap.classFixUndo(id);
      showToast(r?.ok
        ? (r.skipped ? `Put back ${r.restored}. ${r.skipped} had changed since and were left alone.`
                     : `Put back ${r.restored} document${r.restored === 1 ? '' : 's'}.`)
        : 'That change can no longer be undone.', r?.ok ? 'ok' : 'warn');
      await loadQueue();
    } catch { showToast('Undo failed.', 'err'); }
    return;
  }
  if (act === 'yes' || act === 'no') {
    const s = _classFixState;
    _classFixState = null; renderClassFixBar();
    try {
      const r = await window.docusnap.classFixResolveAsk({ askKey: s.askKey, yes: act === 'yes',
                                                           documentId: s.documentId });
      if (act === 'yes' && r && r.batchId) { _classFixState = { ...r, phase: 'applied', listOpen: false }; renderClassFixBar(); }
      else if (act === 'yes') showToast('Nothing left to correct — those documents have changed since.', 'warn');
      await loadQueue();
    } catch { showToast('Could not apply that correction.', 'err'); }
  }
});

function renderSweepConsentBar() {
  const bar = document.getElementById('sweep-consent-bar');
  if (!bar) return;
  const s = _sweepState;
  if (!s) {
    bar.style.display = 'none'; bar.innerHTML = '';
    if (_sweepFilterIds) { _sweepFilterIds = null; renderQueueList(); }
    return;
  }
  const typeName = (allDocTypes.find(t => t.slug === s.typeSlug)?.name) || s.typeSlug;
  if (s.phase === 'offer' || s.phase === 'filing') {
    const n = s.candidates.length - s.unticked.size;
    const held = (s.excluded || []).length;
    const heldLine = held
      ? `<div class="scb-muted">${held} more from this sender need a closer look — they stay in Review.</div>` : '';
    const rows = s.listOpen ? `<div class="scb-list">` + s.candidates.map(c =>
        `<div class="scb-row"><input type="checkbox" data-scb-doc="${c.docId}" ${s.unticked.has(c.docId) ? '' : 'checked'}>`
      + `<label title="${escHtml(c.filename)}">${escHtml(c.filename)}</label></div>`).join('') + `</div>` : '';
    // HONEST REACH (Oracle C10). The old sentence — "match what you've confirmed" — was written when
    // the sweep only ever looked at the sender just confirmed. Queue-wide it would be FALSE for a
    // sender the operator never touched, and an untrue sentence on a bulk-filing button is the one
    // thing that must never ship. Say what was actually checked, and name the other senders rather
    // than implying this is all of them.
    const otherLine = s.otherScopes
      ? `<div class="scb-muted">${s.otherScopes} other sender${s.otherScopes === 1 ? ' is' : 's are'} also ready — `
        + `file these first and the next offer follows.</div>`
      : '';
    // "UP TO", and the hedge is load-bearing (Chris round 10, card 5). The offer is a snapshot: the
    // documents behind it can be filed by anything else — File All Ready, another sweep, a plain
    // confirm — while the bar sits on screen waiting to be read. He came back to "File 18", pressed
    // it, and got 0. The DELIVERY was faultless: it re-checked every document, filed the ones still
    // eligible, and named each one it kept back. Only the PROMISE was out of date, and after being
    // told 18 twice and getting 0 he stopped believing the counts.
    // Re-counting on every queue change is the expensive fix; hedging is the honest one, and it is
    // the wording of the File All Ready dialog he explicitly DID trust — because it said "up to
    // 146 of 195" and then filed exactly 146. Say no more than you can guarantee.
    // Q4c: after the quiet re-read the documents WERE re-read — say so instead of "nothing was re-read".
    const readLine = s.via === 'quiet'
      ? `were re-read just now and pass every check.`
      : `already read cleanly and now pass every check — nothing was re-read.`;
    bar.innerHTML =
        `<b>${n}</b> <b>${escHtml(s.supplier)}</b> ${escHtml(typeName)} document${n === 1 ? '' : 's'} `
      + readLine
      + heldLine + otherLine + rows
      + `<div class="scb-actions">`
      + `<button class="scb-btn primary" data-scb="file" ${n === 0 || s.phase === 'filing' ? 'disabled' : ''}>`
      + (s.phase === 'filing' ? 'Filing…' : `✓ File up to ${n}`) + `</button>`
      + `<button class="scb-btn" data-scb="review" ${s.phase === 'filing' ? 'disabled' : ''}>Review them</button>`
      + `<button class="scb-btn" data-scb="later" ${s.phase === 'filing' ? 'disabled' : ''}>Not now</button>`
      + `<span class="scb-toggle" data-scb="toggle">${s.listOpen ? 'Hide list' : 'Choose which…'}</span>`
      + `</div>`;
    bar.style.display = 'block';
    return;
  }
  if (s.phase === 'done' && _asOn) {
    // B2: the receipt lives in the activity strip (server-emitted by the accept door, with the kept-back
    // reasons — Oracle C6) and keeps its undo for 7 days; the 20 s self-destruct goes with it.
    _sweepState = null; bar.style.display = 'none'; bar.innerHTML = '';
    return;
  }
  if (s.phase === 'done') {
    const kept = (s.dropped || []).map(d =>
      `<div class="scb-row scb-muted">kept back — ${escHtml(_sweepReason(d.reason))} (${escHtml((s.candidates.find(c => c.docId === d.docId) || {}).filename || ('#' + d.docId))})</div>`).join('');
    bar.innerHTML =
        `<b>✓ Filed ${s.filed.length}</b> from <b>${escHtml(s.supplier)}</b> — checked against the documents you just confirmed. `
      // HONEST LABEL (Chris round 9, card 1 — his worst finding, and the code is RIGHT while the
      // word was wrong). "Undo all" reads as "put everything back the way it was", but the filed
      // PDFs deliberately STAY on disk: the working copy is deleted at confirm, so removing the
      // filed copy would leave the document with no file at all (the "no page" class from round 5).
      // A later re-confirm overwrites the same filename in place, so nothing duplicates. Say that,
      // rather than letting the operator discover a copy still sitting in their filing cabinet.
      // Q4c: no "Put back" link when nothing was filed — there is nothing to put back.
      + (s.filed.length ? `<span class="scb-undo" data-scb="undo" title="Puts these documents back in Review. The copies already written to your filing folder stay there and are replaced when you file them again.">Put back in Review</span>` : '')
      + (kept ? `<div class="scb-list">${kept}</div>` : '');
    bar.style.display = 'block';
    clearTimeout(s._doneTimer);
    s._doneTimer = setTimeout(() => { if (_sweepState === s) { _sweepState = null; renderSweepConsentBar(); } }, 20000);
  }
}

document.getElementById('sweep-consent-bar')?.addEventListener('click', async (e) => {
  const s = _sweepState;
  if (!s) return;
  const cb = e.target.closest('input[data-scb-doc]');
  if (cb) {
    const id = Number(cb.dataset.scbDoc);
    if (cb.checked) s.unticked.delete(id); else s.unticked.add(id);
    renderSweepConsentBar();
    return;
  }
  const act = e.target.closest('[data-scb]')?.dataset.scb;
  if (!act) return;
  if (act === 'toggle') { s.listOpen = !s.listOpen; renderSweepConsentBar(); return; }
  // "Not now" STANDS for the session (Oracle C11: auto-resurrecting a dismissed bar is nagware) —
  // the rail's "Check what's ready to file" button is the way back, which also makes the whole
  // feature discoverable instead of only ever appearing unbidden.
  // "Not now" dismisses THIS offer (this sender + type), not the whole session. Oracle asked that a
  // dismissal stand rather than auto-resurrect — it does, for that scope — but making it
  // session-wide silenced the headline feature after a single press: Chris pressed it twice and
  // then made ~24 further confirms, every one of which had documents waiting, and never saw an
  // offer again. A dismissal is an answer about THESE documents, not a request to stop working.
  if (act === 'later')  { _sweepDismissed.add(_sweepScopeKey(s.supplier, s.typeSlug)); _sweepState = null; renderSweepConsentBar(); return; }
  if (act === 'review') {
    _sweepFilterIds = _sweepFilterIds ? null : new Set(s.candidates.map(c => c.docId));
    renderQueueList();
    return;
  }
  if (act === 'file' && s.phase === 'offer') {
    const accepts = s.candidates.filter(c => !s.unticked.has(c.docId))
      .map(c => ({ docId: c.docId, fingerprint: c.fingerprint }));
    if (!accepts.length) return;
    s.phase = 'filing'; renderSweepConsentBar();
    let res = null;
    try { res = await window.docusnap.sweepScopeAccept?.(s.supplier, s.typeSlug, accepts, [...s.unticked]); } catch {}
    if (!res || !res.ok) {
      s.phase = 'offer'; renderSweepConsentBar();
      showToast('Couldn\'t file those documents — please try again.', 'warn');
      return;
    }
    s.phase = 'done'; s.filed = res.filed || []; s.dropped = res.dropped || [];
    _sweepFilterIds = null;
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts(); renderQueueList();
    if (currentDoc && !queue.some(d => d.id === currentDoc.id)) { currentDoc = null; clearDocPanel(); if (queue.length) selectDoc(queue[0]); }
    renderSweepConsentBar();
    if (s.filed.length) window.docusnap.notifyReviewComplete();
    return;
  }
  if (act === 'undo' && s.phase === 'done') {
    let res = null;
    try { res = await window.docusnap.sweepScopeUndo?.(s.filed); } catch {}
    _sweepState = null;
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts(); renderQueueList(); renderSweepConsentBar();
    showToast(res && res.ok ? `Sent ${res.undone.length} document${res.undone.length === 1 ? '' : 's'} back to Review.`
                            : 'Undo failed — check the queue.', res && res.ok ? 'ok' : 'warn');
  }
});

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
  // Remember the slot + sender BEFORE removing, so we advance to the NEXT doc (finishing this
  // sender first) instead of snapping to the top or clearing the pane — mirrors single-doc Confirm.
  const idx      = reviewDisplayOrder().findIndex(d => d.id === currentDoc.id);
  const supplier = reviewGroupKey(currentDoc);   // slice 3: finish the VISIBLE pile (== supplier_name unless a garble is grouped under its company)
  await window.docusnap.deferDocument(currentDoc.id);
  deferredQueue = await window.docusnap.getDeferredQueue();
  queue         = queue.filter(d => d.id !== currentDoc.id);
  updateTabCounts();
  advanceAfterAction(idx, supplier);   // re-renders + lands on the next doc (or clears if none remain)
  window.docusnap.notifyReviewComplete();
});

// ── Delete All Review (admin only) ────────────────────────────────────────────
document.getElementById('btn-delete-all-review').addEventListener('click', async () => {
  if (!isAdmin || queue.length === 0) return;
  // Truthful copy (Chris card 1 + bob): _deleteQueue SOFT-deletes — recycle bin, restorable,
  // files kept. The old "permanently removed / cannot be undone" was FALSE and devalued the
  // app's real cannot-be-undone warnings (purge/restore/template-delete, which stay accurate).
  if (!confirm(`Delete ALL ${queue.length} document(s) in the Review queue?\n\n` +
               `They go to the app's recycle bin — you can restore them any time from ` +
               `Search → Show the recycle bin. Files on disk are kept. Confirmed and ` +
               `deferred documents are NOT affected.`)) return;

  let res;
  try { res = await window.docusnap.deleteAllReview(); }
  catch (e) { showToast(`Delete failed: ${e?.message || e}`, 'err'); return; }
  if (!res?.success) { showToast(res?.error || 'Delete failed.', 'err'); return; }
  const hadCurrent = queue.some(d => d.id === currentDoc?.id);
  queue = [];
  // A delete is not a review — the emptied panel AND the emptied list say what actually happened
  // (Chris r5 card 6, r6 card 7: "✓ All reviewed — All documents reviewed ✓" after binning 167).
  // Both one-shots are set BEFORE renderQueueList (its empty branch consumes them), and set
  // whether or not the open document was in the queue — the LIST text is about the queue, and
  // the panel is cleared whenever nothing is left open.
  const _clearedMsg = `Queue cleared — ${res.deleted} document${res.deleted === 1 ? '' : 's'} moved to the recycle bin. You can bring them back from Search → Recycle bin.`;
  _queueEmptyMsg = `Queue cleared — ${res.deleted} in the recycle bin`;
  if (hadCurrent) currentDoc = null;
  if (!currentDoc) _placeholderMsg = _clearedMsg;
  updateTabCounts();
  renderQueueList();
  window.docusnap.notifyReviewComplete();
  showToast(`Deleted ${res.deleted} review document(s).`, 'ok');
});

// ── Delete All Deferred (admin only) ──────────────────────────────────────────
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (!isAdmin || deferredQueue.length === 0) return;
  if (!confirm(`Delete ALL ${deferredQueue.length} deferred document(s)?\n\n` +
               `They go to the app's recycle bin — you can restore them any time from ` +
               `Search → Show the recycle bin. Files on disk are kept.`)) return;

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
  if (!confirm(`Delete "${currentDoc.original_filename}"?\n\nIt goes to the app's recycle bin — you can restore it from Search.`)) return;

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
  // MISMATCH-AWARE dialog (Chris round-8 card 1). A row's × legitimately deletes THAT row's
  // document — which need not be the one open on the right. All three delete surfaces used to
  // share identical copy, so neither an operator nor a test driver could tell WHICH delete they
  // had triggered, and a pattern-reading user one habit-click past the dialog bins the wrong
  // file. When the row's doc differs from the open doc, the dialog now says so explicitly.
  const _other = (currentDoc && currentDoc.id !== doc.id)
    ? `\n\nNote: this is the document in the row you clicked — NOT "${currentDoc.original_filename}", the document open on the right.`
    : '';
  if (!confirm(`Delete "${doc.original_filename}"?${_other}\n\nIt goes to the app's recycle bin — you can restore it from Search.`)) return;
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
  // Return selectDoc's promise so a caller can AWAIT the doc-open before painting something on the
  // #anchor-readout bar — selectDoc→renderPage calls hideAnchorReadout, which otherwise clobbers a
  // File-All summary shown synchronously right after this call (Chris round 6, card 2).
  if (next) return selectDoc(next);
  currentDoc = null; clearDocPanel();
}

// Choose the doc to open after filing/removing one. When preferSupplier is given, FINISH that
// sender's remaining docs first (the operator asked to work a sender at a time) — scan forward
// from the vacated slot, then backward — before falling back to the doc now occupying that slot
// (the prior "next in the visible order" behaviour). Works in grouped AND chronological views.
function _pickNextDoc(order, at, preferSupplier) {
  if (!order || order.length === 0) return null;
  if (preferSupplier) {
    // slice 3: compare on the GROUP key (== supplier_name unless a garbled issuer is grouped under
    // its letterhead company), so "finish this sender" never jumps out of the visible pile.
    for (let i = at; i < order.length; i++) if (reviewGroupKey(order[i]) === preferSupplier) return order[i];
    for (let i = Math.min(at, order.length) - 1; i >= 0; i--) if (reviewGroupKey(order[i]) === preferSupplier) return order[i];
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

// CORRECTION RIPPLE (identity text-first slice 2) — after the operator resolves the issuer on one
// document, offer to apply it to the unfiled documents that look like the SAME SENDER by page text.
// Why text and not the logo: the owner corrected one Larkspur docket and the other 19 still didn't
// match — nearest-neighbour keeps favouring the bigger WRONG pool (and the hint path needs three
// confirms before it upgrades). Applying goes through the per-doc supplier PIN, so every rippled
// document comes back REVIEW-BOUND and plants no learning: a wrong ripple costs a click, never a
// wrong filed value.
async function offerIssuerRipple(srcDocId, name, row) {
  if (!srcDocId || !name || !window.docusnap.findIssuerSiblings) return;
  document.querySelector('.ripple-bar')?.remove();
  const res = await window.docusnap.findIssuerSiblings(srcDocId, name);
  const siblings = (res && res.siblings) || [];
  if (!siblings.length) return;
  const bar = document.createElement('div');
  bar.className = 'field-note ripple-bar';
  const label = document.createElement('div');
  label.textContent = `${siblings.length} more unfiled document${siblings.length === 1 ? '' : 's'} `
    + `look${siblings.length === 1 ? 's' : ''} like the same sender.`;
  bar.appendChild(label);
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'branding-resolve-btn';
  apply.textContent = `Apply “${name}” to ${siblings.length} & re-read`;
  apply.title = 'Sets the sender on those documents and re-reads them. They stay in Review for you to check.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'accept-btn';
  dismiss.textContent = 'Not now';
  dismiss.addEventListener('click', () => bar.remove());
  apply.addEventListener('click', async () => {
    apply.disabled = dismiss.disabled = true;
    apply.textContent = 'Applying…';
    try {
      const siblingIds = siblings.map(s => s.id);
      // Pin the SOURCE too (idempotent — resolve-issuer already pinned it): the pin persists on every
      // pinned doc, so a later reprocess re-derives X even for a doc we choose not to re-read now.
      const pinIds = [srcDocId, ...siblingIds];
      const out = await window.docusnap.applyIssuerRipple(pinIds, name);
      if (!out || out.ok !== true) { apply.textContent = 'Could not apply'; return; }
      bar.remove();
      // Re-read the siblings through the SAME batched rail Reprocess-this-sender uses; the pins make
      // the engine read them as this supplier (operator_pin @75 + "confirm to file" note — never
      // auto-files) instead of reverting to the value-less letterhead suggest. Include the SOURCE in
      // the re-read ONLY when its sole pending edit is the supplier just applied (Oracle seam ruling):
      // re-reading a source that also carries a typed date / staged ⊕ teach / manual type would
      // silently discard it. Cover DEFERRED siblings too (findSiblings returns them, so they were
      // pinned but the old queue-only filter never re-read them). Kill switch SUPPLIER_RIPPLE=0 makes
      // findSiblings return [] upstream, so this whole path is unreachable.
      const rereadIds = _sourceOnlySupplierDirty() ? pinIds : siblingIds;
      const pool = [...(queue || []), ...(deferredQueue || [])];
      const docs = pool.filter(d => rereadIds.includes(d.id));
      if (docs.length) {
        // Preserve the open source's panel UNLESS it is actually in this batch (only then does a
        // refetch show its freshly-persisted value; otherwise a refetch would wipe the in-memory X).
        const preserveOpenDoc = !docs.some(d => d.id === srcDocId);
        await runReprocessBatch(docs, `${docs.length} from “${name}”`, { preConfirmed: true, preserveOpenDoc });
      }
    } catch {
      apply.disabled = dismiss.disabled = false;
      apply.textContent = `Apply “${name}” to ${siblings.length} & re-read`;
    }
  });
  bar.append(apply, dismiss);
  row.appendChild(bar);
}

// LOGO SUGGESTION — OFFERED, never auto-applied (identity text-first slice 1c, Oracle C5).
// This used to SILENTLY fill the empty issuer field, mark it `.corrected` AND write
// corrections['supplier_name'] — so a Confirm rubber-stamped a guess from the 64-bit logo hash,
// which is MEASURED to have zero separating power on scans (cross-supplier min hamming 2). That
// was the renderer half of the poison loop: the engine's text-agreement gate would abstain, and
// this would put the wrong name straight back in. Now it renders a CLICK affordance in the same
// style as the branding "Use '<name>'" button: the app shows what the logo saw and says why it
// isn't sure; the human decides. Nothing is written until they click.
// Does the matched supplier's NAME actually appear in the page text? The 64-bit logo phash
// collides across suppliers (a red mark ≈ another red mark), so a logo match alone suggested e.g.
// "Saltmarsh Seafoods" on a Copperfield invoice. Mirrors the engine's identity text-first rule:
// abstain ONLY on POSITIVE disagreement — require a real body of page text, then check the name's
// distinctive tokens; too little text (or a name with no distinctive token) → fail-open (show).
// Card 5 (Chris round 6): is a CODE-like value printed on the page, judged the lenient way — casefold
// and drop every non-alphanumeric character on both sides (the engine's "sepless" projection), then
// substring. STRICTER than the engine's Gate-C page-check (which also tolerates one OCR-confusable
// glyph), so it can only ever HIDE a shortcut button for a value Gate C might still accept — never
// show one for a value Gate C refused. Fail-open on missing text or an empty value.
// ── LIST field ⊕ = teach its CAPTION (owner 2026-08-27) ──────────────────────────────────────────
// "the review ⊕ button should also teach a list caption … when I highlighted the 1st serial no it only
// displayed that serial, not the other detected values. I would like it to show them all so the user can
// see it is doing its job." A List field is collected by its caption (keyword.py collect=True), so the
// drawn box's job is to FIND the caption; the caption is staged as a doc-type-wide keyword (written at
// confirm through teach-list-caption, Admin+Edit, list-typed only) and the field is filled with every
// value the caption collects on THIS page (shared/listCaption.js — the inline-collector twin).
function _isListFieldKey(key) {
  const d = (fieldDefs || []).find(f => f.key === key);
  return !!d && String(d.type || '').toLowerCase() === 'list' && !!window.__listFieldScanOn;
}
function _stageListCaption(fieldKey, detected, text) {
  const LC = window.ListCaption || {};
  const _clean = LC.cleanCaption || ((s) => String(s || '').trim());
  // The label picker returns the token NEAREST the value ("No" out of "Serial No:") — right for an
  // anchor, wrong for a caption keyword. Chris r8 card 1: "No" stored doc-type-wide matched "JOB SHEET NO
  // CJB-9791" on the next worksheet and filed the job number as the serial at "1 found". So: normalise
  // exactly as the IPC will store it, extend a generic tail to the phrase printed left of the value on
  // THIS page ("Serial No"), and refuse to stage a caption that is still generic — with the reason.
  let caption = _clean((detected && !detected.fallback) ? sanitizeAnchorLabel(detected.anchor_label || '') : '');
  const _generic = (s) => !!(LC.isGenericCaption && LC.isGenericCaption(s));
  if (caption && _generic(caption) && LC.extendCaption) {
    const ext = LC.extendCaption(caption, text, (currentDoc && currentDoc.ocr_text) || '');
    if (ext) caption = ext;
  }
  if (caption && _generic(caption)) {
    delete pendingAnchors[fieldKey];
    showTeachMessage(`&#9888; I read <span class="ar-val">${escHtml(text)}</span> but the caption beside it reads only `
                   + `<strong>"${escHtml(caption)}"</strong> — on its own that would match every "${escHtml(caption)}" on the page `
                   + `(a job sheet number, a VAT reg no…). Draw the box so the full caption (e.g. "Serial ${escHtml(caption)}") sits just `
                   + `left of the value, or add the full caption in Settings → Learning → Keyword label overrides.`, { warn: true });
    return;
  }
  const clean = caption && !labelLooksSuspicious(caption) && !labelIsTypeHeading(caption);
  if (!clean) {
    delete pendingAnchors[fieldKey];
    showTeachMessage(`&#9888; I read <span class="ar-val">${escHtml(text)}</span> but couldn't read a clean caption beside it — a list is taught by its `
                   + `<strong>caption</strong> (e.g. "Serial No"). Draw again with the caption just left of or above the value, `
                   + `or add the caption in Settings → Learning → Keyword label overrides.`, { warn: true });
    return;
  }
  pendingAnchors[fieldKey] = { listCaption: caption, field_key: fieldKey,
                               document_type: selectedTypeSlug || currentDoc?.type_slug || currentDoc?.document_type_slug || null };
  const vals = (window.ListCaption && window.ListCaption.previewValues)
    ? window.ListCaption.previewValues(caption, (currentDoc && currentDoc.ocr_text) || '') : [];
  // The drawn value is explicit evidence — it joins the preview even when the caption regex missed
  // its line (a "+ One it missed" click must always land the value the user pointed at).
  const drawn = String(text || '').trim();
  const preview = _listUnion(vals, (drawn && !drawn.includes(';')) ? [drawn] : []);
  const input = document.querySelector(`.field-input[data-key="${fieldKey}"]`);
  let list = preview;
  if (input && preview.length) {
    // MERGE RULE (panel consensus + Oracle cond 4, 2026-08-27): current ∪ (preview − (original − current)).
    // A ⊕ teach ADDS what the caption collects; it never resurrects an element the user already
    // removed on this document (original − current), and never drops an element they typed or kept.
    const original = _splitListValue(input.dataset.original);
    const current  = _splitListValue(input.value);
    const removed  = _listMinus(original, current);
    list = _listUnion(current, _listMinus(preview, removed));
    input.value = list.join('; ');
    // The row's `input` listener is the ONE writer of `corrections` (+ clears warnings, re-validates,
    // repaints the pills) — never write corrections here.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const typeName = (allDocTypes.find(t => t.slug === (selectedTypeSlug || currentDoc?.type_slug)) || {}).name || 'this document type';
  // Chris r8 card 4: the old promise ("every X … fills this" on every future document) claimed more than
  // the next worksheet delivered — say what will be TRIED and keep the eye on the row.
  showTeachMessage(`&#10003; Caption <strong>${escHtml(caption)}</strong> collects <strong>${preview.length}</strong> value${preview.length === 1 ? '' : 's'} on this page: `
                 + `<span class="ar-val">${escHtml(preview.slice(0, 12).join('; '))}${preview.length > 12 ? ' …' : ''}</span>. `
                 + `Saved as a caption for <strong>${escHtml(labelFor(fieldKey))}</strong> on every ${escHtml(typeName)} when you confirm — `
                 + `I'll look for "${escHtml(caption)}" on future ${escHtml(typeName)}s and fill this list from it. Always glance at it before filing.`);
}
// LIST value helpers — the store is 'A; B; C' (split on the store separator ONLY; a comma inside an
// element is data). Set operations casefold, keep first-seen order and the first-seen spelling.
function _splitListValue(s) {
  return String(s ?? '').split(';').map(x => x.trim()).filter(Boolean);
}
function _listUnion(a, b) {
  const out = [], seen = new Set();
  for (const v of [...(a || []), ...(b || [])]) {
    const k = String(v).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(String(v).trim());
  }
  return out;
}
function _listMinus(a, b) {
  const drop = new Set((b || []).map(v => String(v).trim().toLowerCase()));
  return (a || []).filter(v => !drop.has(String(v).trim().toLowerCase()));
}

// ── LIST pills — a VIEW over the hidden store input (appendFieldRow, list rows) ─────────────────
// Every mutation goes through _setListValue → the store's `input` event → the row listener (the ONE
// `corrections` writer) → _renderListChips. Removed entries stay visible greyed with a put-back so a
// mis-click is one click to undo; "Undo changes" restores data-original. Nothing here persists —
// confirm reads the store like any other field; a pill edit teaches nothing beyond this document.
function _setListValue(row, vals) {
  const input = row.querySelector('.field-input');
  if (!input) return;
  input.value = _listUnion(vals, []).join('; ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function _listRowState(row) {
  return row._listState || (row._listState = { removed: [], editing: null });
}
function _renderListChips(row) {
  const input = row.querySelector('.field-input');
  const box   = row.querySelector('.list-chips');
  if (!input || !box) return;
  const st   = _listRowState(row);
  const vals = _splitListValue(input.value);
  const origSet = new Set(_splitListValue(input.dataset.original).map(v => v.toLowerCase()));
  // A value the user typed back in (or put back) is no longer "removed".
  st.removed = st.removed.filter(r => !vals.some(v => v.toLowerCase() === r.v.toLowerCase()));
  box.innerHTML = '';
  if (!vals.length && !st.removed.length) {
    const e = document.createElement('span');
    e.className = 'list-empty';
    e.textContent = (input.dataset.method === 'keyword_list') ? 'Nothing found for this list' : 'No entries';
    box.appendChild(e);
  }
  vals.forEach((v, i) => {
    const chip = document.createElement('span');
    chip.className = 'list-chip' + (origSet.has(v.toLowerCase()) ? '' : ' edited');
    const valEl = document.createElement('span');
    valEl.className = 'list-chip-val';
    valEl.textContent = v;
    valEl.title = origSet.has(v.toLowerCase()) ? `${v} — click to edit` : `${v} — edited on this document; click to edit again`;
    valEl.addEventListener('click', () => _editListChip(row, i));
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'list-chip-x'; x.textContent = '✕';
    x.title = 'Remove this entry — it is not on this document (you can put it back)';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      st.removed.push({ v, idx: i });
      const next = vals.slice(); next.splice(i, 1);
      _setListValue(row, next);
    });
    chip.append(valEl, x);
    box.appendChild(chip);
  });
  st.removed.forEach((r, ri) => {
    const chip = document.createElement('span');
    chip.className = 'list-chip removed';
    const valEl = document.createElement('span');
    valEl.className = 'list-chip-val'; valEl.textContent = r.v; valEl.title = `${r.v} — removed`;
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'list-chip-back'; back.textContent = '↺';
    back.title = 'Put this entry back';
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      st.removed.splice(ri, 1);
      const cur = _splitListValue(input.value);
      cur.splice(Math.min(r.idx, cur.length), 0, r.v);
      _setListValue(row, cur);
    });
    chip.append(valEl, back);
    box.appendChild(chip);
  });
  // Receipt + undo. The caption is NOT named here: the stored row carries no verified caption
  // (extractions.anchor_label is never set for a keyword read) — "N found" is what we can vouch for.
  const receipt = row.querySelector('.list-receipt');
  if (receipt) {
    const n = vals.length;
    const found = (input.dataset.method === 'keyword_list')
      ? `${n} found on this document` : `${n} ${n === 1 ? 'entry' : 'entries'}`;
    receipt.textContent = found + (st.removed.length ? ` · ${st.removed.length} removed` : '');
  }
  // Chris r8 card 3: on a list that STARTED EMPTY, "Undo changes" = wipe everything the user pointed out —
  // there is nothing to undo back TO, so the link is not offered (✕ + ↺ cover a single entry). When there
  // was a read, the label says what it restores and how many.
  const undo = row.querySelector('.list-undo-btn');
  if (undo) {
    const origVals = _splitListValue(input.dataset.original);
    undo.hidden = (input.value === input.dataset.original) || !origVals.length;
    undo.textContent = `Undo all my changes (back to the ${origVals.length} read)`;
    undo.title = `Put the list back exactly as it was read — ${origVals.length} ${origVals.length === 1 ? 'entry' : 'entries'}; your edits and removals on this document are dropped`;
  }
}
function _editListChip(row, i) {
  const input = row.querySelector('.field-input');
  const box   = row.querySelector('.list-chips');
  if (!input || !box) return;
  const st = _listRowState(row);
  if (st.editing) return;                       // one editor at a time
  const vals = _splitListValue(input.value);
  const chip = box.querySelectorAll('.list-chip:not(.removed)')[i];
  if (!chip || vals[i] == null) return;
  const was = vals[i];
  const ed = document.createElement('input');
  ed.type = 'text'; ed.className = 'list-chip-edit'; ed.value = was;
  ed.setAttribute('data-help-ignore', '');
  ed.style.width = Math.max(110, Math.min(360, was.length * 8 + 24)) + 'px';
  chip.replaceWith(ed);
  st.editing = ed;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true; st.editing = null;
    const nv = ed.value.trim();
    if (!commit || nv === was) { _renderListChips(row); return; }
    if (nv.includes(';')) {
      // The store separator can never live inside an entry (reggie 2026-08-26) — same refusal as the
      // collector; keep the value as it was and say why.
      // Chris r8 card 6: warn without marking the STORE invalid — the red would spread to every pill
      // through the sibling combinator and read as "you've broken both of these".
      setFieldWarning(row, null, 'An entry can\'t contain ";" — that\'s the separator between entries');
      _renderListChips(row); return;
    }
    clearFieldWarning(row, input);
    const next = vals.slice();
    if (!nv) next.splice(i, 1); else next[i] = nv;
    _setListValue(row, next);
  };
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  ed.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => { try { ed.focus(); ed.select(); } catch {} });
}
function _wireListRow(row, key) {
  const wrap  = row.querySelector('.field-input-wrap');
  const input = row.querySelector('.field-input');
  if (!wrap || !input) return;
  row.classList.add('list-row');
  row.querySelector('.list-add-btn')?.addEventListener('click', () => {
    // Same door as the ⊕ — the caption is detected beside the drawn value and staged as a teach.
    row.querySelector('.pick-btn')?.click();
  });
  const textBtn = row.querySelector('.list-text-btn');
  textBtn?.addEventListener('click', () => {
    const on = wrap.classList.toggle('list-text-mode');
    textBtn.textContent = on ? 'Show as list' : 'Edit as text';
    if (on) { try { input.focus(); } catch {} }
    else _renderListChips(row);
  });
  row.querySelector('.list-undo-btn')?.addEventListener('click', () => {
    _listRowState(row).removed = [];
    clearFieldWarning(row, input);
    input.value = input.dataset.original;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  _renderListChips(row);
}

function _valueOnPageSepless(value, pageText) {
  const proj = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const v = proj(value), p = proj(pageText);
  if (!v || !p) return true;
  return p.includes(v);
}

function _supplierNameOnPage(name, pageText) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const page = norm(pageText);
  if (page.split(' ').filter(Boolean).length < 8) return true;      // too little text to judge → fail-open
  const STOP = new Set(['ltd','limited','plc','llp','inc','co','company','corp','the','and','group',
                        'holdings','services','solutions','trading','uk','gmbh','llc','sa','bv','ag']);
  const toks = norm(name).split(' ').filter(t => t.length >= 2 && !STOP.has(t));
  if (!toks.length) return true;                                    // nothing distinctive to judge → fail-open
  const padded = ' ' + page + ' ';
  return toks.some(t => padded.includes(' ' + t + ' '));            // any distinctive token present as a whole word
}

async function attemptLogoMatch() {
  if (!docImg.complete || !docImg.naturalWidth) return;
  try {
    const b64   = getRawPageBase64(currentPage);
    if (!b64) return;
    const match = await window.docusnap.matchLogoHash(b64);
    if (!match || match.confidence < 60 || !match.supplier_name) return;
    // NAME-PRESENCE VETO (owner 2026-07-31): the logo alone is not enough — only offer the name when
    // it actually appears on the page, so a phash collision can't suggest an off-page company.
    if (!_supplierNameOnPage(match.supplier_name, (currentDoc && currentDoc.ocr_text) || '')) return;
    const supplierInput = document.querySelector('.field-input[data-key="supplier_name"]');
    if (!supplierInput || supplierInput.value.trim()) return;      // never overwrite a read/typed value
    if (document.querySelector('.logo-suggest-btn')) return;        // one offer at a time
    const wrap = supplierInput.closest('.field-input-wrap') || supplierInput.parentElement;
    if (!wrap || !wrap.parentElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'branding-resolve-btn logo-suggest-btn';
    btn.textContent = `Use “${match.supplier_name}” — the logo looks similar`;
    btn.title = 'The logo resembles this company, but the page text didn’t confirm it. '
              + 'Click to use this name, or type the correct one.';
    btn.addEventListener('click', () => {
      supplierInput.value = match.supplier_name;
      supplierInput.classList.add('corrected');
      corrections['supplier_name'] = { original_value: '', corrected_value: match.supplier_name };
      validateConfirm();
      btn.remove();
    });
    wrap.parentElement.insertBefore(btn, wrap.nextSibling);
  } catch (err) {
    console.warn('Logo match failed (non-critical):', err);
  }
}

// b64: an optional page image captured by the caller. The OPTIMISTIC confirm path
// advances (swapping docImg) before this runs in the background, so it must pass the
// snapshot image — reading the live docImg here would fingerprint the NEXT doc against
// the previous supplier (eric R1). With no b64 we fall back to the live docImg (the
// legacy bulk/confirmCurrentDoc callers, which run before any advance).
async function saveLogoOnConfirm(supplierName, b64 = null, documentId = null) {
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
        // The main process gates the plant on this document's own text (Oracle C4); absent id
        // ⇒ the gate fails open, so older callers keep working unchanged.
        document_id:   documentId ?? currentDoc?.id ?? null,
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
  if (btn) { btn.innerHTML = '&#9658; Preview the read'; btn.classList.remove('active'); }
  hidePreviewCta();   // a real doc is being shown (or the panel cleared) → drop the pick-a-doc CTA
}

// The "pick a document to start" call-to-action shown in the empty preview pane when the queue
// HAS documents but none is auto-selected (the returning-user case: 2+ sender piles that start
// collapsed). It replaces a bland/dead pane with a clear next step and doubles as insurance for
// any other "nothing selected" moment. Hidden the instant any doc is selected or the panel is
// cleared — both routes run through _clearPreviewState above. The button lands on the first
// document in the CURRENT display order (reviewDisplayOrder — what the ↑/↓ nav treats as first);
// selectDoc then expands that doc's group.
function showPreviewCta() {
  const cta = document.getElementById('preview-cta');
  if (!cta) return;
  const ph = document.getElementById('doc-placeholder');
  if (ph) ph.style.display = 'none';   // don't stack the plain placeholder behind the CTA
  cta.style.display = 'flex';
}
function hidePreviewCta() {
  const cta = document.getElementById('preview-cta');
  if (cta) cta.style.display = 'none';
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
      docId:         currentDoc.id,
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

// Is the OPEN document dirty ONLY with the supplier the operator just resolved (the ripple case),
// so re-reading it would discard nothing they typed? Mirrors hasPendingReviewEdits but tolerates a
// lone supplier_name correction. Oracle seam ruling (2026-08-21): the correction-ripple may re-read
// the SOURCE only when this is true; if the source also carries a hand-typed date, a staged ⊕ teach
// or a manual type override, the ripple leaves the source panel untouched (its pin still persists).
function _sourceOnlySupplierDirty() {
  const corrKeys = corrections ? Object.keys(corrections) : [];
  if (corrKeys.some(k => k !== 'supplier_name')) return false;
  if (typeof pendingAnchors === 'object' && pendingAnchors && Object.keys(pendingAnchors).length) return false;
  if (typeof pendingFieldRules === 'object' && pendingFieldRules && Object.keys(pendingFieldRules).length) return false;
  const detected = currentDoc && currentDoc.type_slug;
  if (selectedTypeSlug && detected && selectedTypeSlug !== detected) return false;   // manual type override
  return true;
}

// ── Fast on-open re-extract (Slice B, DARK) ─────────────────────────────────────
// Debounced, doc-guarded trigger for the text-only re-extract. Rapid ↑/↓ cycling must NOT spawn a
// worker per selection, so it waits for the operator to settle on a doc; it never fires while there
// are unsaved edits (a suggestion must never fight a human), and it skips the IPC entirely unless
// there's an EMPTY non-anchored field to gain (fill-only can't touch a filled or taught field, so a
// fully-populated doc has nothing to add). The kill switch (server-side) OFF path returns
// {ok:false,reason:'disabled'} — so even when this fires, nothing spawns until the feature is enabled.
let _reextractTimer = null;
function _scheduleReextractFast(docId) {
  clearTimeout(_reextractTimer);
  _reextractTimer = setTimeout(() => {
    if (!currentDoc || currentDoc.id !== docId) return;        // moved on during the debounce
    if (hasPendingReviewEdits()) return;                        // don't fight a human
    // Only-when-gain (client pre-check): at least one EMPTY, non-taught field. Saves a spawn on a
    // fully-read doc; the server re-checks the anchor scope authoritatively.
    const inputs = Array.from(document.querySelectorAll('#fields-scroll .field-input'));
    const hasGain = inputs.some(i => !String(i.value || '').trim() && !taughtFieldKeys.has(i.dataset.key));
    if (!hasGain) return;
    Promise.resolve(window.docusnap.reextractFieldsFast?.(docId)).then(res => {
      if (!res || !res.ok || !Array.isArray(res.suggestions) || !res.suggestions.length) return;
      if (!currentDoc || currentDoc.id !== docId) return;      // moved on during the spawn
      if (hasPendingReviewEdits()) return;                      // started editing while it ran
      _applyReextractSuggestions(res.suggestions);
    }).catch(() => {});
  }, 450);
}

// Paint the fill-only suggestions into the still-empty field inputs. Sets .value DIRECTLY (no input
// event, no `corrections` entry) so a confirmed-untouched suggestion is treated as an ordinary
// extracted value, NOT a human correction (Oracle C4). Each filled field gets a subtle marker + a
// pill note; the operator's Confirm reads the input value and persists/learns it normally.
function _applyReextractSuggestions(suggestions) {
  const scroll = document.getElementById('fields-scroll');
  if (!scroll) return;
  let applied = 0;
  for (const s of (suggestions || [])) {
    if (!s || !s.field_key || !String(s.value ?? '').trim()) continue;
    let inp = null;
    try { inp = scroll.querySelector(`.field-input[data-key="${CSS.escape(s.field_key)}"]`); } catch { inp = null; }
    if (!inp) continue;
    if (String(inp.value || '').trim()) continue;              // only ever fill a STILL-empty input
    inp.value = s.value;                                        // NO input event, NO corrections[] (Oracle C4)
    inp.classList.add('reextract-suggested');
    inp.title = 'Scan Finder took another look at this document and suggests this value — check it, then Confirm to keep.';
    inp.style.borderColor = 'var(--accent2)';                  // subtle "this is a suggestion" cue
    const row = inp.closest('.field-row');
    // DISPLAY-ONLY supersede (owner 2026-08-01: "why am I still seeing the messages"): a
    // stale stored flag ("couldn't confirm which company…") above a field the suggestion
    // just filled reads as a contradiction. Hide the note element while the suggestion is
    // showing — the DB note is untouched (the flag legally stays until the operator's
    // Confirm clears it server-side; any re-render without a suggestion brings it back).
    // Oracle precedent: display-only note handling SIGNED, persisted clears SENT BACK.
    row?.querySelectorAll('.field-note:not(.reextract-pill)')?.forEach(n => { n.style.display = 'none'; });
    if (row && !row.querySelector('.reextract-pill')) {
      const pill = document.createElement('div');
      pill.className = 'field-note reextract-pill';
      pill.textContent = '⟳ Found on a second look — check it, then Confirm to keep.';
      Object.assign(pill.style, { fontSize: '11px', color: 'var(--accent2)', marginTop: '3px' });
      row.appendChild(pill);
    }
    applied++;
  }
  if (applied) validateConfirm();   // a required empty field may have just gained a value — re-eval the gate
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
  // Chris round 17 card 6: the banner is ONE boolean fed by a fire-and-forget {active:false}; a lost send
  // left "Processing new documents from import — 200 of 200" up for 15 minutes. Self-heal: re-pull the
  // main process's truth every 30 s while the banner shows (and on every queue broadcast, below).
  setInterval(() => { if (_processingActive) window.docusnap.getProcessingActivity?.().then(applyProcessingActivity).catch(() => {}); }, 30_000);
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
      clearedByIssuerChange = new Set();   // the reprocessed reads are new — nothing is suppressed
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
      btn.innerHTML = '&#9654;&#9654; Reprocess';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 3000);
  } else {
    btn.disabled = false;
    btn.innerHTML = '&#9654;&#9654; Reprocess';
    btn.style.color = 'var(--err)';
    setTimeout(() => { btn.style.color = ''; }, 2000);
    // Surface WHY (e.g. "A reprocess is already running") instead of a silent red flash.
    if (result && result.error) showToast(result.error, result.busy ? 'warn' : 'err');
  }
});

// ── Add to Template Manager (RETIRED 2026-08-12) ─────────────────────────────
// The "Save as template" button + this handler are replaced by the sender-field editor
// (openSenderFieldEditor) — the admin's re-pin-sample path lives in Settings → Templates
// (set-template-sample), and the teach wizard's commit still uses promote-to-template.

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

// RECONNECT to a "Reprocess All" that is still running in the main process after Review was closed
// and reopened (Option A — the batch is never interrupted). Enters the same in-progress UI as a
// fresh start (banner + locked buttons + Stop) and drives it from the broadcast progress events; the
// batch's 'batch_done' event (emitted to the LIVE Review window) triggers the same refresh + re-enable
// the fresh path does in its finally. Called once from loadQueue when get-reprocess-status says running.
async function reconnectRunningBatch(status) {
  if (_batchActive || !status || !status.running) return;
  const btnAll  = document.getElementById('btn-reprocess-all');
  const btnSup  = document.getElementById('btn-reprocess-supplier');
  const btnOne  = document.getElementById('btn-reprocess');
  const btnStop = document.getElementById('btn-stop-reprocess');
  const banner  = document.getElementById('reprocess-progress');
  if (!btnAll || !btnStop || !banner) return;

  _batchActive  = true;
  _batchStopped = false;
  btnAll.disabled = true;
  if (btnSup) btnSup.disabled = true;
  if (btnOne) btnOne.disabled = true;
  btnStop.disabled = false;
  btnStop.innerHTML = '&#9632; Stop';
  btnStop.style.display = '';
  banner.classList.remove('done');
  banner.classList.add('show');
  const total = status.total || 0;
  banner.textContent = `Reprocessing ${status.done || 0} of ${total} · the queue (already running)…`;

  // Completion — the same refresh the fresh-start path runs in its finally. Guarded so the batch_done
  // event and the race-recheck below can't both fire it.
  let finished = false;
  const finish = async (done, failed) => {
    if (finished) return; finished = true;
    window.docusnap.removeReprocessProgress();
    try {
      if (currentDoc) {
        const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
        if (full && currentDoc && currentDoc.id === full.id) {
          currentDoc = full; corrections = {}; clearedByIssuerChange = new Set(); pendingAnchors = {}; pendingFieldRules = {};
          syncDocTypeFromRecord(full); renderFields(full);
        }
      }
    } catch { /* panel refresh is best-effort */ }
    queue         = await window.docusnap.getReviewQueue();
    deferredQueue = await window.docusnap.getDeferredQueue();
    updateTabCounts();
    renderQueueList();
    _batchActive          = false;
    btnAll.disabled       = false;
    if (btnOne) btnOne.disabled = false;
    btnStop.style.display = 'none';
    updateReprocessSupplierButton();
    try {
      const _c = await window.docusnap.consumeReprocessCompletion();   // this window runs the completion — consume the once-flag + take the offer
      if (_c && _c.offerIds) showReprocessAutofileOffer(_c.offerIds);
    } catch { /* best-effort */ }
    banner.classList.add('done');
    banner.textContent = _batchStopped ? `Stopped — ${done} reprocessed`
      : (failed ? `Completed — ${done} OK, ${failed} failed` : `Completed ${done} of ${total}`);
    setTimeout(() => { if (!_batchActive) { banner.classList.remove('show', 'done'); banner.textContent = ''; } }, 4000);
    showToast(_batchStopped ? `Stopped — ${done} reprocessed`
      : (failed ? `Reprocessed ${done} — ${failed} failed` : `Reprocessed ${done} document${done !== 1 ? 's' : ''}`),
      (failed || _batchStopped) ? 'warn' : 'ok');
  };

  window.docusnap.removeReprocessProgress();
  window.docusnap.onReprocessProgress((msg) => {
    if (msg.type === 'file_done') banner.textContent = `Reprocessing ${msg.done || 0} of ${msg.total || total} · the queue…`;
    else if (msg.type === 'batch_done') finish(msg.done || 0, msg.failed || 0);
  });
  // RACE GUARD: the batch may have finished between get-reprocess-status (in loadQueue) and this
  // subscription — in which case batch_done already fired and was missed. Re-read and finalise now.
  try { const st2 = await window.docusnap.getReprocessStatus(); if (!st2 || !st2.running) await finish((st2 && st2.done) || 0, (st2 && st2.failed) || 0); } catch { /* leave the batch subscription in place */ }
}

// Reprocess a set of documents (the whole queue, or just one sender's) through the shared
// batched-worker path. scopeLabel is shown in the progress banner + toast.
async function runReprocessBatch(docs, scopeLabel, opts = {}) {
  if (!docs || docs.length === 0) { showToast('No documents to reprocess', 'warn'); return; }
  if (_batchActive) return;
  // A batch reprocess always confirms first (Chris, both rounds: "Reprocess all warns you not
  // at all — it re-read 160 documents on one click"). The harmless-sounding button is the one
  // that changes the most documents; the count makes the scale visible before it runs.
  // EXCEPTION — opts.preConfirmed (the correction-ripple, Chris round-11 card #1): the operator
  // ALREADY consented by clicking "Apply 'X' to N & re-read" (same count on the button), so re-asking
  // here would only give a dialog to dismiss — which silently swallowed the whole re-read. When
  // preConfirmed, both confirms are skipped; the source's OTHER edits are protected instead by
  // opts.preserveOpenDoc below (Oracle seam ruling 2026-08-21). Do NOT globalise preConfirmed —
  // Reprocess-All / Reprocess-this-sender must keep their warnings.
  // Chris round 17 card 6: when the sender already files by itself, a re-read that comes out clean WILL
  // file (the scope auto-accept) — say so, with where to look and how to undo.
  const _selfFiles = (() => { try { return Array.isArray(_scopeReadiness) && _scopeReadiness.some(s => s && s.ready && docs.some(d => String(d.supplier_name || '').trim().toLowerCase() === String(s.supplier || '').trim().toLowerCase())); } catch { return false; } })();
  // r19 N1 (Oracle C6): say what "clean" means when the re-read holds like the lane does.
  let _holdsLine = '';
  try { if ((await window.docusnap.getSetting('reprocess_holds_as_lane')) === 'true') _holdsLine = ` A value that reads differently from before is kept for you to check — the previous value is one click away.`; } catch {}
  const _fileLine = _selfFiles
    ? `Re-reading updates the details. Because this sender already files by itself, anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back.${_holdsLine}`
    : `Re-reading updates the details; it doesn't file anything by itself — documents that come out ready still file through Confirm, File All Ready, or the sender's own auto-file once it's learned.${_holdsLine}`;
  if (!opts.preConfirmed
      && !confirm(`Re-read all ${docs.length} document${docs.length === 1 ? '' : 's'} (${scopeLabel}) from their pages? `
             + `Values the documents re-read may replace what's shown now, and this can take a while. `
             + `Documents you've already confirmed and filed are not touched.\n\n`
             + _fileLine)) return;
  // The open document's unsaved edits/type choice are re-rendered away too (QA audit #3).
  if (!opts.preConfirmed && hasPendingReviewEdits() && !confirm(REPROCESS_DISCARD_WARNING)) return;

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
    // Refresh the open document's panel (it may have been reprocessed). SKIP when
    // opts.preserveOpenDoc — the correction-ripple sets it when the open SOURCE was NOT in the
    // re-read batch (it had other unsaved edits), so a refetch here would wipe the in-memory value
    // the operator just set and the edits they typed (Oracle seam ruling 2026-08-21). The queue
    // refresh below still runs, so the rippled siblings repaint.
    if (currentDoc && !opts.preserveOpenDoc) {
      try {
        const full = await window.docusnap.getDocumentWithExtractions(currentDoc.id);
        if (full && currentDoc && currentDoc.id === full.id) {
          currentDoc  = full;
          corrections = {};
          clearedByIssuerChange = new Set();   // fresh reads — nothing is suppressed
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
    // This window ran the completion — consume the main-side once-flag (so a later reopen doesn't
    // re-fire a stale summary) and surface the batch-scoped consent offer, if any.
    try {
      const _c = await window.docusnap.consumeReprocessCompletion();
      if (_c && _c.offerIds) showReprocessAutofileOffer(_c.offerIds);
    } catch { /* best-effort */ }
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
  // 1-page guard (Chris r5 card 7): a valid split of a 1-pager "succeeds" — it deletes the
  // original and re-imports an identical doc behind the "permanently removed" warning.
  // STRICT === 1: pages array is authoritative when loaded; page_count fallback is
  // NULL-tolerant (pre-mig-37 unknown must never block).
  const _pc = (Array.isArray(pageImages) && pageImages.length) ? pageImages.length : currentDoc?.page_count;
  if (_pc === 1) { showToast('This document is only one page — there\'s nothing to split.', 'warn'); return; }
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
    if (!ranges) {
      // Never a silent no-op after a destructive-sounding warning (Chris r5 card 7).
      showToast('Type a page range first — e.g. 1-2,3.', 'warn');
      input.focus();
      return;
    }
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
let _placeholderMsg = null;   // one-shot override for the cleared-panel message (cause-aware)
let _queueEmptyMsg  = null;   // one-shot override for the emptied-LIST message (renderQueueList)
function clearDocPanel() {
  _clearPreviewState();
  // Chris r6 card 7 (shot77): after the last document filed, the empty panel still carried the
  // previous document's ⊕ read-back bar ("✓ The label to the left: Balance Due → 4,142.35") and
  // its "Teach this document" card. Both are per-document aids — clear them with the panel.
  try { hideAnchorReadout(); } catch {}
  try { renderTeachCta(null); } catch {}
  const _rsBtn = document.getElementById('btn-reprocess-supplier');
  if (_rsBtn) _rsBtn.style.display = 'none';   // cleared panel → no open doc → hide per-sender reprocess
  docImgWrap.style.display = 'none';
  const ph = document.getElementById('doc-placeholder');
  ph.style.display = '';
  // Per-cause placeholder (Chris r5 card 6): "All documents reviewed ✓" was shown for EVERY
  // road to an empty queue — including a Delete All, which is not a review. Callers with a
  // different truth pass it; the reviewed-it-all default stays for everyone else.
  // STICKY (Chris r7): the delete road's message must survive the IPC-driven re-render that follows
  // the handler's own render; renderQueueList's non-empty branch retires it when the queue refills.
  ph.textContent   = _placeholderMsg || 'All documents reviewed ✓';
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
// STICKY LEVEL (Chris round 4 → Oracle, 2026-08-13): a warning must not be erased by a reassuring
// message raised in the SAME TICK. That is how the teach came to say nothing useful — two calls,
// last one wins, and the last one was the cheerful one. The fix is a level guard, deliberately NOT
// a toast QUEUE: a queue would show the warning seconds later, after the operator has already
// clicked on, and would serialise ~63 call sites into a backlog on a bulk run. An `ok` may not
// overwrite a live `warn`/`err`; an equal-or-higher level always may, so nothing can be lost for
// longer than the toast's own lifetime.
let _toastLevel = null;
const _TOAST_RANK = { ok: 0, warn: 1, err: 2 };
function showToast(msg, level = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  const live = el.style.display === 'block' && _toastLevel;
  if (live && (_TOAST_RANK[level] ?? 0) < (_TOAST_RANK[_toastLevel] ?? 0)) return;
  el.textContent = msg;
  el.className   = level;
  el.style.display = 'block';
  _toastLevel = level;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; _toastLevel = null; }, 4000);
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

// LIVE field-visibility (migration 54): an admin changed which fields a layout shows in
// Settings → Field visibility. If the doc on screen belongs to that template, refresh its hidden
// set and re-render the fields immediately — no close/reopen. The payload carries the fresh array
// so we don't re-fetch. Ignored when the change is for a different template (or nothing is open).
window.docusnap.onReviewVisibilityChanged?.(({ templateId, hidden } = {}) => {
  if (!currentDoc || currentDoc.template_id !== templateId) return;
  currentDoc.hidden_fields = hidden || [];
  renderFields(currentDoc);
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
  // Q4d (Chris round 14): the per-sender "N more to file by itself" badge is rendered by
  // renderQueueList from _scopeReadiness, which was refreshed only at load and after THIS window's
  // own confirm — a send-back from the Search window (or any other window's confirm) left it
  // stale ("4 more" after the mis-confirm was undone). Refresh it before the list renders.
  try { await refreshScopeReadiness(); } catch {}
  updateTabCounts();
  // Q4c: every offer is a snapshot — prune it to the documents STILL queued, retire it when empty.
  {
    const liveIds = new Set(queue.map(d => d.id));
    const before = _sweepState;
    _sweepState = window.OfferPrune ? window.OfferPrune.pruneOffer(_sweepState, liveIds) : _sweepState;
    if (_sweepState !== before || (_sweepState && _sweepState.phase === 'offer')) renderSweepConsentBar();
    if (_rabOfferIds) {
      _rabOfferIds = window.OfferPrune ? window.OfferPrune.pruneIds(_rabOfferIds, liveIds) : _rabOfferIds;
      if (!_rabOfferIds.length) { _rabOfferIds = null; const rb = document.getElementById('reprocess-autofile-bar'); if (rb) rb.style.display = 'none'; }
    }
  }
  if (activeTab === 'review')   renderQueueList();
  if (activeTab === 'deferred') renderDeferredList();
  refreshAutoCommittedBar();   // tick the auto-committed tally up after the burst (fetches fresh)
  updateReprocessSupplierButton();   // Q4c: "Reprocess N from X" follows the live queue
  if (!prevId && queue.length > 0 && activeTab === 'review') selectDoc(queue[0]);
  // Chris r13 card 4: the open document was filed ELSEWHERE (the teach wizard's own confirm, a
  // sweep, another window) — it is no longer in the queue but the pane still shows it with a live
  // "Confirm & File". Move on, exactly as after Review's own Confirm — but ONLY when nothing the
  // operator typed here would be lost (pending edits keep the pane; a wizard-filed doc has none).
  else if (prevId && activeTab === 'review' && !queue.some(d => d.id === prevId)
           && !deferredQueue.some(d => d.id === prevId) && !hasPendingReviewEdits() && !_batchActive) {
    currentDoc = null; clearDocPanel();
    if (queue.length) selectDoc(queue[0]);
  }
}
// Slice 1: the server filed a sender's ready documents by itself after a human confirm. Refresh the
// LIST + receipt bar (never the open document — the pass skipped anything being viewed), then re-ask
// the queue sweep so OTHER senders' offers still surface as a bar (the pass answered
// 'auto-accept-running' to any sweep that landed mid-filing).
window.docusnap.onScopeAutoFiled?.(async () => {
  if (bulkFiling || _batchActive) return;
  try { await _refreshQueueFromBroadcast(); } catch {}
  try { await refreshAutoCommittedBar(); } catch {}
  try { await _runQueueSweep(); } catch {}
});
// Slice 3: the QUIET RE-READ lane (quiet-reprocess channel — never reprocess-progress, so none of
// the batch banner / _batchActive / button-lock handlers fire). A small hint above the list while a
// sender's held documents are re-read in the background; the LIST refreshes (throttled), the open
// document is never touched (the lane skips anything being viewed). On job_done the consent sweep
// re-asks so a now-ready sender surfaces as a bar — or files by itself when auto-accept is on.
const _quietJobs = new Map();
let _quietRefreshTimer = null;
function _renderQuietHint() {
  const el = document.getElementById('quiet-reread-hint');
  if (!el) return;
  const live = [..._quietJobs.values()].filter(j => j.state !== 'done');
  if (!live.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const j = live[0];
  const extra = live.length > 1 ? ` · ${live.length - 1} more sender${live.length > 2 ? 's' : ''} queued` : '';
  const state = j.state === 'deferred' ? 'paused while you work — resumes on its own' : `${j.done} of ${j.total} done`;
  // r18 copy: name the real trigger — the lane also fires on the READY crossing (after a confirm, not a
  // teach), on a box change (layout) and on a type confirm (typesplit).
  const why = j.reason === 'ready' ? 'now that this sender files by itself'
            : j.reason === 'layout' ? 'after your box change'
            : j.reason === 'typesplit' ? 'after your type confirm'
            : 'now that you have taught its layout';
  el.innerHTML = `<span class="qrh-cancel" title="Stop re-reading this sender's documents">Stop</span>`
    + `Quietly re-reading <b>${escHtml(j.supplier)}</b> documents you haven't opened, ${why} — ${state}${extra}. `
    + `Review stays fully usable.`;
  el.style.display = 'block';
  el.querySelector('.qrh-cancel')?.addEventListener('click', async () => { try { await window.docusnap.cancelQuietReread?.(j.id); } catch {} });
}
function _quietRefreshList() {
  if (_quietRefreshTimer) return;
  _quietRefreshTimer = setTimeout(async () => { _quietRefreshTimer = null; try { await _refreshQueueFromBroadcast(); } catch {} }, 1000);
}
window.docusnap.onQuietReprocess?.(async (ev) => {
  if (!ev || !ev.jobId) return;
  const j = _quietJobs.get(ev.jobId) || { id: ev.jobId, supplier: ev.supplier || '', total: 0, done: 0, state: 'running' };
  if (ev.type === 'job_start')    { j.supplier = ev.supplier || j.supplier; j.total = ev.total || 0; j.done = ev.done || 0; j.state = 'running'; if (ev.reason) j.reason = ev.reason; }   // r20 card 5: the hint names the real trigger
  if (ev.type === 'doc_done')     { j.done = ev.done ?? (j.done + 1); j.total = ev.total || j.total; _quietRefreshList(); }
  if (ev.type === 'job_deferred') { j.state = 'deferred'; }
  if (ev.type === 'job_done')     { j.state = 'done'; _quietJobs.delete(ev.jobId); _renderQuietHint(); try { await _refreshQueueFromBroadcast(); } catch {} try { await _runQueueSweep({ via: 'quiet' }); } catch {} return; }
  _quietJobs.set(ev.jobId, j);
  _renderQuietHint();
});
(async () => {   // a window opened mid-job reconnects to the hint
  try {
    const st = await window.docusnap.getQuietRereadStatus?.();
    if (st && st.running) { _quietJobs.set(st.running.id, { ...st.running, state: st.running.state || 'running' }); _renderQuietHint(); }
  } catch {}
})();
window.docusnap.onReviewCountChanged((n) => {
  // Keep the authoritative badge count fresh even while a filtered view is active (bug fix 2026-08-23):
  // a bulk put-back fires this with the true count, so the badge is right the moment the user returns.
  if (typeof n === 'number') {
    _authReviewCount = n;
    if (_viewingAutoFiled) { const rc = document.getElementById('tab-review-count'); if (rc) rc.textContent = n; }
  }
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
    wizard.draftAnchor  = draft.draftAnchor ? { ...draft.draftAnchor } : null;
    wizard.draftTarget  = draft.draftTarget ? { ...draft.draftTarget } : null;
  } else if (savedFixed != null && savedFixed !== '') {
    wizard.fixedMode = true; fixedInput.value = savedFixed;
    anchorInput.value = '';
  } else if (saved && saved.anchor_x_norm != null && saved.target_x_norm != null
             && (saved.page_number || 0) === currentPage) {   // box belongs to this page
    wizard.fixedMode = false; fixedInput.value = '';
    wizard.draftAnchor = { x_norm: saved.anchor_x_norm, y_norm: saved.anchor_y_norm,
                           w_norm: saved.anchor_w_norm, h_norm: saved.anchor_h_norm };
    wizard.draftTarget = { x_norm: saved.target_x_norm, y_norm: saved.target_y_norm,
                           w_norm: saved.target_w_norm, h_norm: saved.target_h_norm };
    anchorInput.value = saved.anchor_text || '';
  } else {
    wizard.fixedMode = false; fixedInput.value = '';
    anchorInput.value = '';
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

// A caption that is actually the document's TYPE HEADING ("INVOICE", "PURCHASE ORDER") — not a
// field label — must NOT become an anchor label. The heading is large/ambiguous and relocating off
// it is fragile: it is exactly what made every SuperStore invoice hold at 69% (a taught invoice_number
// anchor whose auto-label grabbed the "INVOICE" title, which then never re-located, tripping the
// taught-ownership guard on the correct keyword read). Treat it like a garbled caption → fall back to
// a POSITION-ONLY anchor (registration-relocated, robust). EXACT-match against the install's type
// names + their printed-title aliases, so a real caption that merely CONTAINS a type word
// ("Invoice No", "Order Date") is never caught.
function labelIsTypeHeading(label) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const n = norm(label);
  if (!n) return false;
  for (const t of (allDocTypes || [])) {
    if (norm(t.name) === n) return true;
    let aliases = t.title_aliases;
    if (typeof aliases === 'string') { try { aliases = JSON.parse(aliases); } catch { aliases = []; } }
    for (const a of (aliases || [])) if (norm(a) === n) return true;
  }
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
      if (!byField.has(f)) byField.set(f, { merges: [], rejects: [], transforms: [], validations: [], final: null, reconcile: null, steps: [] });
      return byField.get(f);
    };
    for (const ev of events) {
      if (!ev) continue;
      // reconcile is a CROSS-field TOTAL calc (keyed by total_key, carries no `field`) — attach it
      // to the total field's block before the per-field guard below.
      if (ev.event === 'reconcile') { if (ev.total_key) get(ev.total_key).reconcile = ev; continue; }
      if (ev.field == null) continue;
      if (ev.event === 'merge') get(ev.field).merges.push(ev);
      // Every-step ladder rows (owner demand 2026-08-12: "I need to ALWAYS see keyword with
      // either the keyword or a reason it wasn't used"). The engine already emits ONE `step`
      // event per configured field per read stage (won/lost/no_candidate/already_resolved/
      // skipped — engine.py _trace_steps); the dev-inspector consumed them but THIS console
      // dropped them, so a field whose keyword rung found nothing showed no keyword row at all.
      else if (ev.event === 'step') get(ev.field).steps.push(ev);
      else if (ev.event === 'anchor_reject') get(ev.field).rejects.push(ev);
      else if (ev.event === 'transform') get(ev.field).transforms.push(ev);   // Stage 2.5 denoise/correct
      else if (ev.event === 'validation') get(ev.field).validations.push(ev);  // Stage 4/4.5 normalise/flag/withhold
      else if (ev.event === 'final') get(ev.field).final = ev;
      else if (ev.event === 'slice' && (ev.bbox || ev.path)) {
        // Keep the saved crop PATH too (served by devGetSlice) so the panel can SHOW the
        // exact image OCR'd — and capture a path-only slice (no bbox) as well, so a read
        // with no located box still shows its crop.
        const f = ev.field;
        if (!sliceMap[f]) sliceMap[f] = {};
        const key = ev.stage || '_';
        if (!sliceMap[f][key]) sliceMap[f][key] = [];
        sliceMap[f][key].push({ kind: ev.kind || 'target', bbox: ev.bbox || null, page: ev.page ?? 0, stage: ev.stage || '_', method: ev.method || null, path: ev.path || null, tag: ev.tag || null });
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
    function pickSlice(field, method, geom) {
      const m = sliceMap[field];
      if (!m) return null;
      // PRIMARY: match the captured crop whose box == the winning value's ACTUAL read box
      // (target_geom, emitted on the merge event). A relocate / registration / edge / footer
      // rung carries its OWN box, so this shows the crop the value was TRULY read from — not
      // the first same-stage (abs) capture, which mislabelled a relocated read (the "slice
      // shows PO-90621 but the value is IM.ANKI1" bug). Tolerance ~2% of the page per axis.
      if (Array.isArray(geom) && geom.length === 4) {
        let best = null, bestD = 0.02;
        for (const k of Object.keys(m)) for (const s of m[k]) {
          if (s.kind !== 'target' || !Array.isArray(s.bbox) || s.bbox.length !== 4) continue;
          const d = Math.max(...s.bbox.map((v, i) => Math.abs(v - geom[i])));
          if (d <= bestD) { best = s; bestD = d; }
        }
        if (best) return best;
      }
      // FALLBACK (no geom, e.g. a rejected rung): the method's own captured crop.
      if (!method) return null;
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
    // Every field's captured crops (path-bearing slices), flattened across stages — shown as
    // thumbnails at the bottom of the field so you can SEE exactly what was OCR'd for each read.
    function allSlices(field) {
      const mm = sliceMap[field];
      if (!mm) return [];
      const out = [];
      for (const k of Object.keys(mm)) for (const s of mm[k]) if (s.path) out.push(s);
      return out;
    }

    // Show a block for EVERY field, not only those that produced a merge/final event: union the
    // type's declared fields (in their own order) with any traced field and any field that
    // produced ONLY a crop. A flagged-but-vanished field (e.g. a date whose taught + full-page
    // reads disagreed) now ALWAYS appears — with its crops — instead of silently dropping out.
    const orderedFields = [];
    const seenF = new Set();
    const pushF = (k) => { if (k && !seenF.has(k)) { seenF.add(k); orderedFields.push(k); } };
    for (const f of (fieldDefs || [])) pushF(f.key);   // declared order first
    for (const k of byField.keys()) pushF(k);           // then any traced extras
    for (const k of Object.keys(sliceMap)) pushF(k);    // then crop-only fields
    if (!orderedFields.length) {
      elEmpty.hidden = false; elFields.innerHTML = '';
      return;
    }
    elEmpty.hidden = true;
    const EMPTY_M = { merges: [], rejects: [], transforms: [], validations: [], final: null, reconcile: null, steps: [] };
    const blocks = [];
    for (const field of orderedFields) {
      const m = byField.get(field) || EMPTY_M;
      const hadEvents = byField.has(field);
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
        rows.push(cand(STAGE_LABEL[c.stage] || c.stage, c.value, c.confidence, c.method, won ? 'won' : 'lost', won ? '' : reason, pickSlice(field, c.method, c.geom), rxBadge(field, c.value), anchorSlice(field), field, c.caption));
      }
      // EVERY READ STAGE IS VISIBLE (owner demand 2026-08-12): a stage with no merge row still
      // gets a line — the engine-declared `step` outcome with its reason ("no keyword pattern
      // matched this field" / "skipped: no anchors learned…" / "already resolved by X"). won/lost
      // steps are skipped here — the merge rows above already carry them with full detail.
      {
        const mergedStages = new Set(m.merges.map(c => c.stage));
        const stepRows = [];
        for (const st of (m.steps || [])) {
          if (!st.stage || mergedStages.has(st.stage)) continue;
          if (st.outcome === 'won' || st.outcome === 'lost') continue;   // merge rows own these
          if (stepRows.some(x => x.stage === st.stage)) continue;        // one line per stage
          stepRows.push(st);
        }
        for (const st of stepRows.sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9))) {
          const lbl = STAGE_LABEL[st.stage] || st.stage;
          const txt = st.outcome === 'already_resolved'
            ? `already resolved${st.value != null ? ` — kept ${escHtml(shown(st.value))}` : ''}${st.reason ? ` (${escHtml(st.reason)})` : ''}${st.by ? ` by ${escHtml(st.by)}` : ''}`
            : `${st.outcome === 'skipped' ? 'skipped' : 'no candidate'} — ${escHtml(st.reason || 'this stage produced nothing for this field')}`;
          rows.push(noteRow(lbl, txt, 'skip'));
        }
      }
      for (const r of m.rejects) {
        // A rejected rung IS keyed by its method (e.g. "anchor_crop") — show the
        // exact crop it read so the operator sees WHERE the garbage came from. The
        // rx score explains a format-based rejection at a glance (e.g. rx 0%).
        rows.push(cand(r.method || 'anchor', r.value, null, null, 'rej', `rejected — ${r.reason || 'failed gate'}`, pickSlice(field, r.method), rxBadge(field, r.value), anchorSlice(field), field, r.caption));
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
      if (!rows.length) rows.push(hadEvents
        ? `<div class="rdc-cand"><span class="rdc-reason" style="padding-left:0">matched on the OCR text layer (no per-stage crop trace)</span></div>`
        : `<div class="rdc-cand"><span class="rdc-reason" style="padding-left:0">no candidate reached this field on the last trace run${allSlices(field).length ? ' — see the crops below for what was read' : ''}</span></div>`);

      // Bottom strip: every crop this field was OCR'd from (lazy-loaded via devGetSlice), so you
      // can see the exact image behind each read — incl. a disagreeing taught crop vs full-page.
      // The crop the WINNING value was actually read from is badged "← read" (bbox-matched to the
      // winning merge's target_geom) and its vertical page position is shown, so two same-stage
      // captures (e.g. the abs box vs a relocated footer read) are no longer indistinguishable.
      const winGeoms = (m.merges || []).filter(x => x.decision === 'win' && Array.isArray(x.geom)).map(x => x.geom);
      const bboxMatch = (bb, g) => Array.isArray(bb) && bb.length === 4 && Math.max(...bb.map((v, i) => Math.abs(v - g[i]))) <= 0.02;
      const slices = allSlices(field);
      const sliceStrip = slices.length
        ? `<div class="rdc-slices">` + slices.map(s => {
            const isRead = winGeoms.some(g => bboxMatch(s.bbox, g));
            const pos = (Array.isArray(s.bbox) && s.bbox.length === 4) ? ` @${Math.round(s.bbox[1] * 100)}%` : '';
            // Name the crop by the READ that produced it (engine `tag`) so two same-kind
            // crops of one field are distinguishable — e.g. "target · absolute box" vs
            // "target · derived offset". Untagged (older traces) falls back to kind alone.
            const nm = s.tag ? `${s.kind || 'crop'} · ${s.tag}` : (s.method || s.kind || 'crop');
            return `<figure class="rdc-slice${isRead ? ' read' : ''}"><img data-slice-path="${escHtml(s.path)}" alt="crop" loading="lazy">`
            + `<figcaption>${escHtml(nm)}${escHtml(pos)}${isRead ? ' · ← read' : ''}</figcaption></figure>`; }).join('')
          + `</div>`
        : '';

      blocks.push(
        `<div class="rdc-field${hadEvents ? '' : ' noevents'}" data-f="${escHtml(field)}">`
        + `<div class="rdc-fhead"><span class="rdc-fname">${escHtml(field)}</span>`
        + `<span class="rdc-fwin${emptyCls}">${winLine}</span></div>`
        + `<div class="rdc-cands">${rows.join('')}${sliceStrip}</div></div>`);
    }
    elFields.innerHTML = blocks.join('');
    // Lazy-load the crop images (dev-only; devGetSlice returns a data: URL under devSliceDir, or null).
    elFields.querySelectorAll('img[data-slice-path]').forEach(async (img) => {
      try {
        const url = await window.docusnap.devGetSlice(img.dataset.slicePath);
        if (url) img.src = url; else img.closest('.rdc-slice')?.classList.add('missing');
      } catch { img.closest('.rdc-slice')?.classList.add('missing'); }
    });
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

  function cand(stage, value, conf, method, tag, reason, slice, rx, aslice, fieldKey, caption) {
    const tagTxt = tag === 'rej' ? 'rejected' : tag;
    // The overlay ("All boxes") reads its label + detection note from these attributes rather than
    // scraping the rendered text, so what it draws is the SAME data the row was built from.
    const dAttr = ` data-field="${escHtml(fieldKey || '')}" data-method="${escHtml(method || '')}"`
                + ` data-conf="${conf != null ? conf : ''}" data-tag="${escHtml(tag)}"`
                + ` data-value="${escHtml(shown(value))}"`;
    const tAttr = (slice && slice.bbox) ? ` data-bbox="${escHtml(JSON.stringify(slice.bbox))}" data-kind="${escHtml(slice.kind || 'target')}" data-page="${slice.page ?? 0}" data-stage="${escHtml(slice.stage || '_')}"` : '';
    const aAttr = (aslice && aslice.bbox) ? ` data-anchor-bbox="${escHtml(JSON.stringify(aslice.bbox))}" data-anchor-page="${aslice.page ?? 0}" data-anchor-stage="${escHtml(aslice.stage || 'anchor_label')}"` : '';
    // A rung with NO crop of its own (e.g. keyword — it matches on the reconstructed text
    // layer, nothing is cropped) still gets the field's TAUGHT-ANCHOR overlay for context.
    // Say so plainly: the blue box is NOT where this rung read, and implying it was is how
    // "clicking keyword highlighted the taught label" gets misread as agreement.
    const clickAttr = slice
      ? ` style="cursor:pointer" title="Click to highlight the value box (amber)${aslice ? ' + anchor box (blue)' : ''} on the page"`
      : (aslice ? ` style="cursor:pointer" title="This rung matched on the page text — no crop of its own. Click shows the field's TAUGHT ANCHOR (blue) for context only."` : '');
    const bboxAttr = tAttr + aAttr + dAttr + clickAttr;
    return `<div class="rdc-cand"${bboxAttr}>`
      + `<span class="rdc-stage">${escHtml(stage)}</span>`
      + `<span class="rdc-val">${escHtml(shown(value))}${method ? ` <span class="rdc-conf">${escHtml(method)}</span>` : ''}${rx || ''}</span>`
      // The PRINTED CAPTION this rung matched (engine-supplied `caption`; the Stage-0.5
      // field-key fallback is already suppressed there). Absent = matched nothing by name.
      + (caption ? `<span class="rdc-cap" title="the printed caption this rung matched">matched “${escHtml(caption)}”</span>` : '')
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
  // ALL BOXES toggle (owner 2026-08-09). Pressed state mirrors the shared .open style the rail
  // buttons use, so it reads as a mode rather than an action.
  document.getElementById('rdc-allboxes')?.addEventListener('click', (e) => {
    _allBoxesOn = !_allBoxesOn;
    e.currentTarget.classList.toggle('open', _allBoxesOn);
    const note = document.getElementById('rdc-allboxes-note');
    const n = drawAllTraceBoxes();
    // SAY WHAT HAPPENED. The first cut only flipped a class and set a title, so with no captured
    // crops the button was indistinguishable from a dead control — which is exactly the failure
    // class this console exists to expose. Now it always reports, in words, on screen.
    if (!note) return;
    if (!_allBoxesOn) { note.textContent = ''; return; }
    if (!traceCanvas || !traceCanvas.width) {
      note.textContent = 'no page rendered yet';
    } else if (n) {
      note.textContent = `${n} region${n > 1 ? 's' : ''} on this page`;
    } else {
      const anyRows = document.querySelectorAll('#rdc-fields .rdc-cand[data-bbox]').length;
      note.textContent = anyRows
        ? 'no captured crop on this page — try another page'
        : 'no crops captured — run ↻ Reprocess (trace) first';
    }
  });
  document.getElementById('rdc-reprocess')?.addEventListener('click', () => {
    traceBuf = [];                       // fresh run — drop the previous trace
    clearTraceHighlight();
    render(traceBuf);
    document.getElementById('btn-reprocess')?.click();   // reuse the full reprocess flow
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active && !modalOpen) { close(); return; }
    if (modalOpen) return;
    // Ctrl+Shift held is NEVER text entry, so the chord works even with focus in a field
    // box (2026-08-04: the old inField guard here silently ate the chord after a reprocess
    // left focus in a field — diagnosed as "SFDEV is broken". inField still guards nothing
    // else: without Ctrl+Shift we disarm and return immediately.)
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
      // Auto-focus, the FULL proven pattern (owner-reported "quite common" no-caret on this
      // dialog, 2026-08-12). The old one-liner focused on the SAME TICK as the append — Chromium
      // drops that — and never armed the page-focus repair, so on a desynced page (the Review
      // window right after an OCR spawn / native dialog — the usual state when someone reaches
      // for SFDEV) the box showed no caret and keystrokes went to <body> until an alt-tab.
      // Mirrors the two proven sites (:781 new-type modal, :3825 draw-commit input): defer to the
      // next frame, focus synchronously, arm + drive the page-focus edge, then re-assert the
      // caret past the cross-process transition. Click-to-focus stays as the manual fallback.
      requestAnimationFrame(() => {
        try {
          input.focus();
          window.docusnap.markFocusSuspect?.();
          window.docusnap.ensureWindowFocus?.();
          window.repairModalInputFocus?.(input);
        } catch { try { input.focus(); } catch {} }
      });
      input.addEventListener('mousedown', () => { try { input.focus(); } catch {} });
    });
  }
})();

// ── SFDEV bulk debug-table (dev-only) — queue-wide field grid ──────────────────
// Rows = the review queue (needs_review + deferred), columns = the union of the
// present types' fields, cells = the extracted value + method + confidence. Click a
// cell to flag it wrong (toggle) and optionally type the CORRECT value; Submit writes
// debug_values.json to the Debug dir so the main session sees the CLASS of a detection
// failure across the whole queue, not one screenshot at a time. Reachable only once the
// trace console (#rdc) is unlocked. All state is in-renderer — no DB writes, no learning.
(() => {
  const overlay  = document.getElementById('rdt');
  if (!overlay) return;
  const elTable   = document.getElementById('rdt-table');
  const elScroll  = document.getElementById('rdt-scroll');
  const elEmpty   = document.getElementById('rdt-empty');
  const elStats   = document.getElementById('rdt-stats');
  const elToast   = document.getElementById('rdt-toast');
  const btnOpen   = document.getElementById('rdc-table');
  const btnClose  = document.getElementById('rdt-close');
  const btnSubmit = document.getElementById('rdt-submit');

  let open = false;
  let data = null;                      // { columns, labels, rows }
  const flagged = new Set();            // `${id}::${field}` for cells the owner marked wrong
  const skey = (id, f) => `${id}::${f}`;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg) {
    elToast.textContent = msg; elToast.classList.add('show');
    setTimeout(() => elToast.classList.remove('show'), 3200);
  }
  function updateStats() {
    elStats.textContent = data
      ? `${data.rows.length} docs · ${data.columns.length} fields · ${flagged.size} flagged`
      : '';
  }

  function cellHtml(row, f) {
    const cell = (row.fields || {})[f];
    const val    = cell && cell.value != null ? cell.value : '';
    const method = cell && cell.method ? cell.method : '';
    const conf   = cell && cell.confidence != null ? `${cell.confidence}%` : '';
    const cls = 'rdt-cell' + (val === '' ? ' empty' : '') + (flagged.has(skey(row.id, f)) ? ' wrong' : '');
    let inner = `<span class="cv">${val === '' ? '—' : esc(val)}</span>`;
    const meta = [method, conf].filter(Boolean).join(' ');
    if (meta) inner += ` <span class="cm">${esc(meta)}</span>`;
    // The printed CAPTION the winning rung matched. Shown on its own line because the whole
    // point of the grid is spotting a SYSTEMIC mis-caption — one column of "Your PO" with three
    // stray "Account No" reads down it is the diagnosis, and it has to be scannable to see that.
    const cap = cell && cell.caption ? cell.caption : '';
    if (cap) inner += `<span class="ccap" title="the printed caption this read matched">“${esc(cap)}”</span>`;
    return `<td class="${cls}" data-id="${row.id}" data-f="${esc(f)}">${inner}</td>`;
  }

  // ── SORTING (owner request, 2026-08-09) — click a header to sort ALPHABETICALLY, click again to
  // reverse. `sortCol` is the field key, or '__doc' for the document column, or null for the
  // queue's own order. EMPTY CELLS ALWAYS SINK, in both directions: a debug grid is read to find
  // the rows that HAVE a suspicious value, and a descending sort that floats 60 blank cells to the
  // top buries exactly what you opened the table for.
  // Alphabetical by explicit instruction, so '10' sorts before '9'. Do not "improve" this into a
  // numeric-aware compare without asking — on this grid the columns are reference codes and
  // methods far more often than they are quantities.
  let sortCol = null, sortDir = 1;
  const sortVal = (row, f) => (f === '__doc'
    ? String(row.filename || '')
    : String(((row.fields || {})[f] || {}).value ?? '')).trim();

  function applySort() {
    if (!data) return;
    if (!data._orig) data._orig = data.rows.slice();       // the queue's own order, for the reset
    if (!sortCol) { data.rows = data._orig.slice(); return; }
    const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
    data.rows = data._orig.slice().sort((a, b) => {
      const va = sortVal(a, sortCol), vb = sortVal(b, sortCol);
      if (!va && !vb) return 0;
      if (!va) return 1;                                   // blanks last regardless of direction
      if (!vb) return -1;
      return coll.compare(va, vb) * sortDir;
    });
  }

  function renderTable() {
    if (!data || !data.rows.length) {
      elEmpty.hidden = false; elEmpty.textContent = 'Review queue is empty.'; elTable.innerHTML = ''; updateStats(); return;
    }
    elEmpty.hidden = true;
    const mark = (col) => (sortCol === col
      ? `<span class="rdt-sortmark">${sortDir > 0 ? '▲' : '▼'}</span>`
      : '<span class="rdt-sortmark">▲</span>');
    const grip = '<span class="rdt-colgrip" title="Drag to resize this column"></span>';
    const th = (col, label, cls) =>
      `<th class="${cls}${sortCol === col ? ' sorted' : ''}" data-col="${esc(col)}" `
      + `title="${esc(col === '__doc' ? 'Document' : col)} — click to sort">${esc(label)}${mark(col)}${grip}</th>`;
    const head = `<thead><tr>${th('__doc', 'Document', 'doc-col')}`
      + data.columns.map(f => th(f, data.labels[f] || f, '')).join('') + `</tr></thead>`;
    const body = data.rows.map(row => {
      const docCell = `<td class="doc-col" data-id="${row.id}"><div class="rdt-fname" title="${esc(row.filename)}">${esc(row.filename || '(' + row.id + ')')}</div>`
        + `<div class="rdt-dmeta"><span class="type">${esc(row.typeName || 'untyped')}</span>${row.supplier ? ' · ' + esc(row.supplier) : ''}</div></td>`;
      return `<tr data-id="${row.id}">${docCell}${data.columns.map(f => cellHtml(row, f)).join('')}</tr>`;
    }).join('');
    elTable.innerHTML = head + `<tbody>${body}</tbody>`;
    // innerHTML replaces the <th> nodes, so any widths the owner dragged are gone with them —
    // re-apply after every render or a single sort click silently undoes all their sizing.
    applyColWidths();
    updateStats();
  }

  // ── Header click → sort. Bound on the TABLE (it is re-rendered wholesale, so per-th listeners
  // would be lost every render). A click that began on a resize grip is not a sort: the drag
  // handler stops propagation, and this guard is the second line of defence.
  elTable.addEventListener('click', (e) => {
    if (e.target.closest('.rdt-colgrip')) return;
    const h = e.target.closest('thead th'); if (!h) return;
    const col = h.dataset.col;
    if (sortCol === col) {
      // asc → desc → back to the queue's own order. The third state matters: once sorted there is
      // otherwise no way back to the order the queue itself uses without reopening the panel.
      if (sortDir > 0) sortDir = -1; else { sortCol = null; sortDir = 1; }
    } else { sortCol = col; sortDir = 1; }
    const keepLeft = elScroll ? elScroll.scrollLeft : 0;
    applySort(); renderTable();
    if (elScroll) { elScroll.scrollTop = 0; elScroll.scrollLeft = keepLeft; }
  });

  // ── Column resize. The table is auto-layout so a column cannot be made NARROWER than its
  // content; on the first drag we freeze every column at its measured width and switch to
  // table-layout:fixed, which is what makes shrinking possible at all. Widths are inline on the
  // <th>, so a re-render (sorting, reload) would drop them — they are re-applied afterwards.
  const colW = new Map();                       // col key -> px, once the owner has sized it
  function applyColWidths() {
    if (!colW.size) return;
    elTable.classList.add('sized');
    elTable.querySelectorAll('thead th').forEach(h => {
      const w = colW.get(h.dataset.col);
      if (w) h.style.width = w + 'px';
    });
  }
  function freezeCurrentWidths() {
    if (colW.size) return;                      // already frozen by an earlier drag
    elTable.querySelectorAll('thead th').forEach(h => colW.set(h.dataset.col, h.offsetWidth));
    elTable.classList.add('sized');
    applyColWidths();
  }
  elTable.addEventListener('mousedown', (e) => {
    const g = e.target.closest('.rdt-colgrip'); if (!g) return;
    e.preventDefault(); e.stopPropagation();    // never start a sort or a panel drag from the grip
    const h = g.closest('th'); if (!h) return;
    freezeCurrentWidths();
    const col = h.dataset.col, x0 = e.clientX, w0 = h.offsetWidth;
    g.classList.add('dragging'); document.body.classList.add('rdt-resizing');
    const move = (ev) => {
      const w = Math.max(48, w0 + (ev.clientX - x0));   // 48px floor: never drag a column to nothing
      colW.set(col, w); h.style.width = w + 'px';
    };
    const up = () => {
      g.classList.remove('dragging'); document.body.classList.remove('rdt-resizing');
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });

  // ── Maximise / restore. Drag and CSS-resize both write INLINE styles on #rdt, which would beat
  // the .maxed class, so the inline set is stashed and cleared on maximise and restored verbatim
  // on the way back — otherwise "restore" leaves the panel wherever the maximise happened to put
  // it, which reads as the button being broken.
  const btnMax = document.getElementById('rdt-max');
  let stashed = null;
  function setMaxed(on) {
    if (on === !!stashed) return;
    if (on) {
      stashed = { top: overlay.style.top, left: overlay.style.left,
                  width: overlay.style.width, height: overlay.style.height };
      overlay.style.top = overlay.style.left = overlay.style.width = overlay.style.height = '';
      overlay.classList.add('maxed');
    } else {
      overlay.classList.remove('maxed');
      Object.assign(overlay.style, stashed);
      stashed = null;
    }
    btnMax.classList.toggle('on', !!stashed);
    btnMax.setAttribute('aria-pressed', stashed ? 'true' : 'false');
    btnMax.title = stashed ? 'Restore' : 'Maximise / restore (F11)';
  }
  btnMax?.addEventListener('click', () => setMaxed(!stashed));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'F11') { e.preventDefault(); setMaxed(!stashed); }
  });

  // Click a VALUE cell → toggle its wrong flag. That is ALL the owner does — the main
  // session reads the flagged doc to work out the correct value (owner rule: don't make
  // me populate 77 correct values for one test round). Click the DOCUMENT cell → select
  // that doc in the queue so the preview BEHIND this movable panel shows it.
  elTable.addEventListener('click', (e) => {
    const docTd = e.target.closest('.doc-col');
    if (docTd) {
      const id = Number(docTd.dataset.id);
      const doc = (typeof queue !== 'undefined' && queue && queue.find) ? queue.find(d => d.id === id) : null;
      if (doc && typeof selectDoc === 'function') { try { selectDoc(doc); } catch {} }
      elTable.querySelectorAll('tr.sel').forEach(tr => tr.classList.remove('sel'));
      docTd.closest('tr')?.classList.add('sel');
      return;
    }
    const td = e.target.closest('.rdt-cell'); if (!td) return;
    if (suppressClick) { suppressClick = false; return; }   // the mouseup that ended a drag
    const k = skey(Number(td.dataset.id), td.dataset.f);
    if (flagged.has(k)) { flagged.delete(k); td.classList.remove('wrong'); }
    else { flagged.add(k); td.classList.add('wrong'); }
    updateStats();
  });

  // ── CLICK-AND-DRAG RECTANGLE SELECT (owner request, 2026-08-09) — flagging a 3x10 block one
  // cell at a time is 30 clicks. Drag across a rectangle and every cell in it takes the SAME
  // action, decided by the cell you started on: if that cell was unflagged the whole rectangle is
  // flagged, if it was flagged the whole rectangle is cleared. One rule, so a drag is predictable
  // and is its own undo — drag the same block again to reverse it.
  //
  // ADDITIVE, not a replacement: a plain click still toggles one cell (the drag only takes over
  // once the pointer actually enters a second cell, so a click that jitters by a pixel is still a
  // click). The existing click handler is suppressed for exactly the mouseup that ends a drag.
  let dragAnchor = null, dragAdd = true, suppressClick = false;
  const cellPos = (td) => {
    const tr = td.parentElement;
    return { r: tr.sectionRowIndex, c: td.cellIndex };
  };
  function paintRect(toTd) {
    if (!dragAnchor) return;
    const a = dragAnchor.pos, b = cellPos(toTd);
    const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r);
    const c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
    const body = elTable.tBodies[0]; if (!body) return;
    for (let r = r0; r <= r1; r++) {
      const tr = body.rows[r]; if (!tr) continue;
      for (let c = c0; c <= c1; c++) {
        const td = tr.cells[c];
        if (!td || !td.classList.contains('rdt-cell')) continue;   // never the sticky doc column
        const k = skey(Number(td.dataset.id), td.dataset.f);
        if (dragAdd) { flagged.add(k); td.classList.add('wrong'); }
        else { flagged.delete(k); td.classList.remove('wrong'); }
      }
    }
    updateStats();
  }
  elTable.addEventListener('mousedown', (e) => {
    // Cleared on EVERY interaction, not on the click that consumes it: a drag released outside a
    // cell fires no cell click, so a flag left standing would silently swallow the next real one.
    suppressClick = false;
    if (e.button !== 0 || e.target.closest('.rdt-colgrip')) return;
    const td = e.target.closest('.rdt-cell'); if (!td) return;
    e.preventDefault();                                   // no text selection while dragging
    dragAnchor = { td, pos: cellPos(td) };
    dragAdd = !flagged.has(skey(Number(td.dataset.id), td.dataset.f));
  });
  elTable.addEventListener('mouseover', (e) => {
    if (!dragAnchor) return;
    const td = e.target.closest('.rdt-cell'); if (!td || td === dragAnchor.td) return;
    if (!suppressClick) {
      // First cell entered: this is a drag, not a click. Apply the anchor cell too — the click
      // handler will never run for it now.
      suppressClick = true;
      paintRect(dragAnchor.td);
    }
    paintRect(td);
  });
  window.addEventListener('mouseup', () => { dragAnchor = null; });

  async function openTable() {
    if (open) return;
    if (document.getElementById('rdc').hidden) return;   // console must be unlocked first
    open = true; overlay.hidden = false;
    elEmpty.hidden = false; elEmpty.textContent = 'Loading queue…'; elTable.innerHTML = '';
    let err = null;
    try {
      if (typeof window.docusnap.devDebugTableData !== 'function')
        throw new Error('bridge missing — reopen the Review window');
      data = await window.docusnap.devDebugTableData();
    } catch (e) { data = null; err = e; }
    if (!data) {
      // Surface WHY. "no handler registered" ⇒ the main process is stale (restart the whole
      // app so the new IPC registers); any other message is the real builder/DB error.
      const m = (err && err.message) ? err.message : 'returned no data';
      elEmpty.textContent = /no handler|not.*registered|not a function|bridge missing/i.test(m)
        ? 'Failed to load: the app’s main process is stale — fully QUIT and relaunch (reprocessed data is kept). Details: ' + m
        : 'Failed to load the queue: ' + m;
      return;
    }
    await mergeCaptions();
    renderTable();
  }

  // ── The matched CAPTION per cell (owner request 2026-08-09: "show the winning keyword") ──
  // The engine records the caption a rung matched on its trace events; nothing persists it (the
  // `extractions.anchor_label` column that would is a dead write — see processing/handler.js), so
  // it is read back from the DEV SESSION TRACE, the same store the crop slices come from. That
  // makes it session-scoped BY CONSTRUCTION: a document processed with the console open has a
  // caption, one imported last week does not. The grid must never IMPLY the second case matched
  // nothing, which is why an absent caption renders as nothing at all rather than a dash.
  //
  // Only the WINNING rung's caption is taken (the `final` event's method, matched against the
  // winning `merge`), because the grid answers "what did this value come from" — the losing
  // rungs' captions are a per-document question and belong in the ladder, not a queue-wide cell.
  async function mergeCaptions() {
    if (!data || !data.rows.length) return;
    if (typeof window.docusnap.devGetSessionDoc !== 'function') return;
    await Promise.all(data.rows.map(async (row) => {
      let evs = null;
      try { evs = await window.docusnap.devGetSessionDoc(row.filename); } catch {}
      if (!Array.isArray(evs) || !evs.length) return;
      const finalMethod = new Map();     // field -> the method that actually committed
      const caps = new Map();            // `${field}::${method}` -> caption
      for (const ev of evs) {
        if (!ev || ev.field == null) continue;
        if (ev.event === 'final') finalMethod.set(ev.field, ev.method || null);
        else if (ev.event === 'merge' && ev.caption) caps.set(`${ev.field}::${ev.method}`, ev.caption);
      }
      for (const [f, cell] of Object.entries(row.fields || {})) {
        // Prefer the caption of the rung the FINAL value came from; fall back to the cell's own
        // stored method, which is the same thing for every value the pipeline committed directly.
        const meth = finalMethod.get(f) || (cell && cell.method) || null;
        const cap = caps.get(`${f}::${meth}`);
        if (cap) cell.caption = cap;
      }
    }));
  }

  function closeTable() { if (!open) return; open = false; overlay.hidden = true; }

  async function submit() {
    if (!data) return;
    btnSubmit.disabled = true;
    const rows = data.rows.map(row => ({
      id: row.id, filename: row.filename, supplier: row.supplier,
      typeName: row.typeName, typeSlug: row.typeSlug, status: row.status,
      // Emit only fields that HAVE a value or were flagged — keeps the JSON to the
      // signal (present reads + the owner's wrong-marks), not one empty cell per column.
      fields: Object.fromEntries(data.columns
        .filter(f => (row.fields || {})[f] || flagged.has(skey(row.id, f)))
        .map(f => {
          const cell = (row.fields || {})[f] || {};
          return [f, { value: cell.value ?? null, method: cell.method ?? null, caption: cell.caption ?? null,
                       confidence: cell.confidence ?? null,
                       wrong: flagged.has(skey(row.id, f)), correct: null, slicePath: null }];
        })),
    }));
    let res = null;
    try { res = await window.docusnap.devDebugTableSave({ rows }); } catch {}
    btnSubmit.disabled = false;
    if (res && res.ok) toast(`Saved ${res.doc_count} docs · ${res.flags} flagged · ${res.slices} slices → ${res.file}`);
    else toast('Save failed.');
  }

  btnOpen?.addEventListener('click', openTable);
  btnClose?.addEventListener('click', closeTable);
  btnSubmit?.addEventListener('click', submit);
  // Esc closes the table FIRST (capture phase + stop) so it doesn't also close the console underneath.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); e.preventDefault(); closeTable(); }
  }, true);

  // Drag the panel by its header (buttons excluded) so it can be shoved aside to read
  // the document preview behind it. Resizing is native (CSS resize:both on #rdt).
  const head = document.getElementById('rdt-head');
  let drag = null;
  head?.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    const r = overlay.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    overlay.style.left = r.left + 'px'; overlay.style.top = r.top + 'px';
    overlay.style.right = 'auto'; document.body.style.userSelect = 'none'; e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const maxL = Math.max(0, window.innerWidth  - overlay.offsetWidth);
    const maxT = Math.max(0, window.innerHeight - 40);
    overlay.style.left = Math.min(Math.max(0, e.clientX - drag.dx), maxL) + 'px';
    overlay.style.top  = Math.min(Math.max(0, e.clientY - drag.dy), maxT) + 'px';
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; document.body.style.userSelect = ''; } });
})();

// ── Init ──────────────────────────────────────────────────────────────────────
loadQueue();
