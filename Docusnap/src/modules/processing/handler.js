'use strict';

/**
 * modules/processing/handler.js
 * Handles folder import, single-file reprocess, OCR region, logo ops.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const diaglog = require('../diaglog');
const { buildSegmentArgs, buildSplitPlan } = require('./split_plan');
const { clampSlipCount, nextSlipRange, slipPackName } = require('./slip_pack');

// SECURITY (Stage 2 — M11): call Windows system binaries by ABSOLUTE path. A bare image name is
// resolved by CreateProcess from the CALLING process's directory FIRST — user-writable under a
// per-user install — so a planted taskkill.exe there would execute in-app. %SystemRoot%\System32 is
// not user-writable.
const TASKKILL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');

// ── Generic Document fallback (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §3) ──────────
// Map a NO-MATCH import (detection returned None ⇒ msg.document_type null) to the
// "General Document" type — ONLY when the switch is on AND the preset exists+enabled.
// PIN 1: a doc ANY real type matched is untouched (the fallback fires only on None);
// the trust.js 'generic-type' refusal keeps every mapped doc review-bound (PIN 2).
// Exported for test_generic_fallback_mapping.js.
function _genericFallbackId(db, msgDocumentType) {
  if (msgDocumentType) return null;                        // a detected type always wins
  if (process.env.GENERIC_FALLBACK === '0') return null;   // env hard-kill
  try {
    const learning = require('../../../database/modules/learning');
    if (learning.getSetting(db, 'generic_fallback_enabled', 'false') !== 'true') return null;
    const g = require('../../../database/modules/document_types').getGenericType(db);
    return g ? g.id : null;
  } catch { return null; }
}
// The SECOND insert seam (Oracle C1): reprocess. A pre-existing NULL-type doc whose
// reprocess detection ALSO returns None adopts the generic type (the designed
// go-forward backlog path). DIRECTION-GUARDED: a TYPED doc whose reprocess detection
// returns None is NEVER dragged to generic (priorTypeId must be null), and a detected
// type always wins. Exported for the C1 both-direction pins.
// Resolve a DETECTED type NAME to an installed type, and say so when it isn't one.
// Detection scores types from the SHIPPED document_type_keywords buckets, which exist
// independently of the types an install actually HAS, so "Delivery Note" can be detected at 93%
// by an install that never added it (Delivery Note is a PRESET, not a built-in — the 2026-07-20
// delivery-docket report). Both insert seams treated name->id as a TOTAL function and dropped the
// input on failure, so nothing downstream knew the pipeline had ever named a type.
//
// EXACT lowercase name match ONLY, deliberately. A slug-level fallback was proposed and dropped:
// it would newly RESOLVE types that exact matching misses today, which is a live behaviour change
// to document_type_id on real installs, smuggled into a slice whose kill switch is supposed to
// make OFF byte-identical. If it's worth having it's worth measuring on its own.
//
// Returns { id, unmatchedName }. unmatchedName is set ONLY when a name was detected and matched
// nothing — never for a detection that returned nothing at all (there is no name to offer).
// Kill switch DETECTED_TYPE_NUDGE=0 ⇒ unmatchedName always null ⇒ column stays NULL ⇒ inert.
function _resolveDetectedType(db, name) {
  const out = { id: null, unmatchedName: null };
  const detected = (name == null ? '' : String(name)).trim();
  if (!detected) return out;
  try {
    const docTypes = require('../../../database/modules/document_types');
    const match = docTypes.getAllWithFields(db).find(
      dt => dt.name.toLowerCase() === detected.toLowerCase()
    );
    if (match) { out.id = match.id; return out; }
  } catch { return out; }        // a lookup failure must never invent a suggestion
  if (process.env.DETECTED_TYPE_NUDGE === '0') return out;
  out.unmatchedName = detected;
  return out;
}

function _reprocessGenericAdopt(db, priorTypeId, resultDocumentType) {
  if (priorTypeId != null || resultDocumentType) return null;
  return _genericFallbackId(db, null);
}
// Auto-Title spawn env (slice 4): AUTO_TITLE=1 reaches process_docs only when the
// setting is on; the engine seam additionally fires only for detection-None docs.
function _autoTitleEnv(db) {
  try {
    const learning = require('../../../database/modules/learning');
    return learning.getSetting(db, 'auto_title_enabled', 'false') === 'true' ? { AUTO_TITLE: '1' } : {};
  } catch { return {}; }
}

// OCR render-DPI spawn env: the extraction OCR renders each page at this DPI (ocr/tesseract.py
// _RENDER_DPI). DEFAULT 300 (returns {} → byte-identical env); a lower 'ocr_dpi' setting (150/200)
// is a large speed win — the OCR cost scales ~DPI^2 and smaller images parallelise far better — at
// the cost of small-text accuracy on genuine high-res scans, so it is an operator opt-in. Coerced
// to the same [100,600] band tesseract.py enforces; anything else falls back to the 300 default.
function _ocrDpiEnv(db) {
  try {
    const learning = require('../../../database/modules/learning');
    const raw = parseInt(learning.getSetting(db, 'ocr_dpi', '300'), 10);
    const dpi = (Number.isFinite(raw) && raw >= 100 && raw <= 600) ? raw : 300;
    return dpi === 300 ? {} : { OCR_RENDER_DPI: String(dpi) };
  } catch { return {}; }
}

// Anchor-crop opt-in spawn env — two independent, owner-flippable crop fixes, each DEFAULT OFF so
// an unset install yields {} → byte-identical spawn env. Both proven to heal their class with 0
// collateral on the demo set (stress_test/demo_rightgrow_ab.js). Owner opt-ins like ocr_dpi.
//  • ANCHOR_VALUE_RIGHT_GROW — the crop sizes from the TAUGHT box width + a fixed pad, so a ref
//    value LONGER than the taught sample chops on the RIGHT (PO-58987 read as PO-5898). On →
//    the crop's right edge extends to the value's MEASURED inline_box edge (anchor.py
//    _label_right_limit); grow-only, ref-like keys with a validation pattern.
//  • ANCHOR_LABEL_LEFT_CLAMP — a label-blind rigid crop intrudes the label tail on jittered scans,
//    so debris prepends the value (PO-27425 read as PO9974A9C). On → clamp the crop's LEFT edge to
//    the LOCATED label's expected-value-left (anchor.py); reverts to unclamped on a degenerate box.
function _anchorCropEnv(db) {
  try {
    const learning = require('../../../database/modules/learning');
    const env = {};
    if (learning.getSetting(db, 'anchor_value_right_grow', 'false') === 'true') env.ANCHOR_VALUE_RIGHT_GROW = '1';
    if (learning.getSetting(db, 'anchor_label_left_clamp', 'false') === 'true') env.ANCHOR_LABEL_LEFT_CLAMP = '1';
    // STRUCT_CODE_READ (slice 1, prep-only): read tight code/date crops cleaner (cap-height upscale
    // + quiet-zone + no-sharpen) so 'PO-17039' stops garbling to '»0-17039'. Default OFF; a
    // sub-floor struct read falls through to today's rungs, so it heals where it can, never worse.
    if (learning.getSetting(db, 'struct_code_read', 'false') === 'true') env.STRUCT_CODE_READ = '1';
    return env;
  } catch { return {}; }
}

// Extraction-reconcile opt-in spawn env. Two independent kill-switched fixes, each DEFAULT OFF (absent
// key -> byte-identical), owner opt-in after its realdoc M=0 gate:
//  • PREFIX_GARBLE_ADOPT (the Northgate PO-17039 class): a garbled leading code-prefix (a tight
//    Stage-0.5 crop reads 'PO-17039' as '»0-17039') is healed from a confirmed-prefix distinct-stage
//    peer in the S-B length-witness arm.
//  • CROSSCHECK_OUTLIER_RECONCILE (the doc-09 PO-83150->PO-83160 class): the authoritative-crop cross-
//    check's fresh full-page locate can ITSELF garble and flip a correct value to a lone outlier;
//    post-merge, an uncorroborated flip is restored to a >=2-independent-family + page-present
//    alternative (arms anchor.py's pre-flip stash + engine._reconcile_crosscheck_outlier together).
//  • UNIVERSAL_VERIFY_RESTORE / UNIVERSAL_VERIFY_FLAG (Slice-2, Oracle SIGN-OFF-W/COND 2026-08-03):
//    the universal post-merge verify over every field's winner — RESTORE tier (ref/date/whole-number
//    numeric/percentage) and FLAG tier (text/structured, note-only), each independently gated.
function _reconcileEnv(db) {
  try {
    const learning = require('../../../database/modules/learning');
    const env = {};
    if (learning.getSetting(db, 'prefix_garble_adopt', 'false') === 'true') env.PREFIX_GARBLE_ADOPT = '1';
    if (learning.getSetting(db, 'crosscheck_outlier_reconcile', 'false') === 'true') env.CROSSCHECK_OUTLIER_RECONCILE = '1';
    if (learning.getSetting(db, 'universal_verify_restore', 'false') === 'true') env.UNIVERSAL_VERIFY_RESTORE = '1';
    if (learning.getSetting(db, 'universal_verify_flag', 'false') === 'true') env.UNIVERSAL_VERIFY_FLAG = '1';
    if (learning.getSetting(db, 'universal_verify_numeric', 'false') === 'true') env.UNIVERSAL_VERIFY_NUMERIC = '1';
    // Slice A edge-debris heal (Oracle 2026-08-03 evening; label-tail '. DN-60902' class).
    if (learning.getSetting(db, 'template_code_edge_clean', 'false') === 'true') env.TEMPLATE_CODE_EDGE_CLEAN = '1';
    // Slice B target word-snap (BUILT DARK — own gate + flip window per Oracle; no UI toggle yet).
    if (learning.getSetting(db, 'template_target_word_snap', 'false') === 'true') env.TEMPLATE_TARGET_WORD_SNAP = '1';
    return env;
  } catch { return {}; }
}

// Coerce the stored processing_mode to a value the backend accepts. A stale/legacy value
// (e.g. an old "light", or one from a restored settings backup) must never reach
// process_docs.py's --mode and break the whole batch on an arg-parse error.
const _validMode = (m) => (m === 'fast' || m === 'smart') ? m : 'smart';

// Deep diagnostic logging is ON when the env override says so, or the admin
// setting is 'true'. When on we (a) ask the extractor for the full --trace +
// --slice-dir even with no inspector window open, and (b) tee every trace event
// to the JSONL diagnostic file. Off by default → no --trace → byte-identical
// pipeline. Env mirrors the licensing escape-hatch convention.
function _diagEnabled(db) {
  const env = (process.env.DOCUSNAP_DIAGNOSTIC_LOG || '').toLowerCase();
  if (env === 'on'  || env === 'true'  || env === '1') return true;
  if (env === 'off' || env === 'false' || env === '0') return false;
  try {
    return require('../../../database/modules/learning').getSetting(db, 'diagnostic_logging') === 'true';
  } catch { return false; }
}

let _currentBatchProcs = [];     // all running Python worker processes for the active batch (bounded pool)
let _singleReprocessActive = false;  // a single reprocess-document is in flight (NOT in the pool array)
// Live "Reprocess All" status, so a Review window that was CLOSED mid-batch can reconnect on reopen
// (the batch runs in this main process and survives the window). Read via get-reprocess-status.
// pendingCompletion: a batch FINISHED and its window-side completion (auto-file the reprocessed-to-100
// docs + summary) has not yet been run by any window — consumed once via consume-reprocess-completion.
let _reprocessStatus = { running: false, total: 0, done: 0, failed: 0, pendingCompletion: false };
// ANY OCR/extraction work is in flight — a batch (import / reprocess-all) OR a single reprocess.
// Used to SERIALISE heavy work: starting a second reprocess while one is running oversubscribes
// the CPU (every worker + the single proc OCR at once) and can race two merges into the same doc,
// which presents as the app "freezing". Reprocess entry points refuse when busy; the watch folder
// already defers on this signal.
function _anyProcessingBusy() { return _currentBatchProcs.length > 0 || _singleReprocessActive; }

// ── Processing-activity signal for OTHER windows (esp. Review) ─────────────────────────
// A single-doc reprocess is REFUSED while an import/watch batch is running (heavy work is
// serialised). Broadcast a lightweight activity state to ALL windows so the Review window can
// show WHY reprocess is unavailable + a progress indicator. Import and watch both route file
// completions through _handleFileMessage, so one bump there drives the count for either source.
let _activity  = null;   // null | { source:'import'|'watch', done, total }
let _notifyAll = null;   // ctx.notifyAllWindows, set in register()
function _broadcastActivity() {
  try {
    _notifyAll?.('processing-activity', _activity
      ? { active: true, source: _activity.source, done: _activity.done, total: _activity.total }
      : { active: false });
  } catch { /* never let a UI signal break processing */ }
}
function _beginActivity(source, total) { _activity = { source, done: 0, total: total || 0 }; _broadcastActivity(); }
function _bumpActivity()               { if (_activity) { _activity.done++; _broadcastActivity(); } }
function _endActivity(source)          { if (_activity && _activity.source === source) { _activity = null; _broadcastActivity(); } }
let _cancelRequested   = false;  // set true when stop is requested; suppresses buffered stdout
let _pendingDrains     = [];     // originals to move to Processed/Errors AFTER the worker exits (pdfium holds the PDF open mid-run, so a mid-batch rename is locked)

// Dev-inspector ONLY: in-memory, session-scoped registry of docs processed while
// the app runs, plus their captured trace events. Never persisted (no SQLite, no
// settings); starts empty on every app launch (module load).
const _devSession = { docs: [], traceByDoc: new Map() };
function _recordDevDoc(msg) {
  const key = msg && (msg.original_filename || msg.filename);
  if (!key) return;
  const meta = { key, filename: key, supplier: msg.supplier_name || null,
                 docType: msg.document_type || null, status: msg.status || null,
                 confidence: msg.overall_confidence ?? null, ts: Date.now() };
  const existing = _devSession.docs.find(d => d.key === key);
  if (existing) Object.assign(existing, meta); else _devSession.docs.push(meta);
}
function _recordDevTrace(ev) {
  const key = ev && ev.doc;
  if (!key) return;
  let arr = _devSession.traceByDoc.get(key);
  if (!arr) { arr = []; _devSession.traceByDoc.set(key, arr); }
  arr.push(ev);
  if (arr.length > 4000) arr.shift();   // bound per-doc memory
}

// Supported input extensions — mirrors python_backend ocr.tesseract.SUPPORTED_EXTENSIONS
// and watch/handler.js. Used only to enumerate + shard files for the parallel
// worker pool; the per-document pipeline (and its file detection) is unchanged.
const BATCH_SUPPORTED_EXTS = new Set(
  ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']
);

// Round-robin split so worker file counts stay balanced regardless of order.
function partitionRoundRobin(items, n) {
  const parts = Array.from({ length: n }, () => []);
  items.forEach((it, i) => parts[i % n].push(it));
  return parts.filter(p => p.length > 0);
}

// ── Write temp JSON files ─────────────────────────────────────────────────────
// Module-level (not register()-scoped closures) so other modules — e.g. the
// watch-folder handler — can reuse the exact same pipeline-setup machinery
// instead of duplicating it on a parallel import path.
let _tmpSeq = 0;
function writeTempJson(name, data) {
  // Process-unique suffix (pid + monotonic counter) so concurrent callers — the
  // bounded import pool and parallel Reprocess All — never collide on the same
  // temp filename within a single millisecond (Date.now() alone is not enough).
  const file = path.join(os.tmpdir(), `ds_${name}_${Date.now()}_${process.pid}_${_tmpSeq++}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}

// Pure merge of a reprocess result's extraction rows with the doc's EXISTING rows —
// factored out of applyReprocessResult so the type-flip persistence is unit-testable
// (test_reprocess_type_flip.js). `flip` is null when the reprocess kept the doc's type
// (the merge is then byte-identical to the legacy behaviour), or — when the type
// CHANGED — { newTypeKeys:Set, refKey, noteText }:
//   - a carried-forward OLD row whose field_key is NOT in the new type's field set is
//     DROPPED: Review renders only the current type's fields so the user could never
//     see or fix it, but the trust gate and auto-file would still read it (Oracle
//     condition 4, 2026-07-09);
//   - noteText is planted on the new type's ref-field row (fallback: first row with a
//     value, then first row) so the flip is explained in Review AND blocks auto-file
//     (isAutoFileEligible refuses any doc carrying a validation_note — condition 3).
function mergeReprocessRows(existing, newRows, flip = null, onTrace = null) {
  const existingMap = {};
  for (const e of existing) existingMap[e.field_key] = e;
  const trace = (field, decision, oldV, newV) => { if (onTrace) onTrace(field, decision, oldV, newV); };

  const mergedRows = newRows.map(row => {
    const ex = existingMap[row.field_key];
    if (!ex) return row;
    if (ex.display_value && !row.display_value) {
      // REPROCESS_ANNOTATED_EMPTY_WINS (2026-07-31; Oracle SIGN-OFF-W/COND): an ANNOTATED
      // empty — no value but a non-empty validation_note — is a DECISION the engine explains
      // (the abstain-speak class: the un-named/named branding blanks, logo-abstain,
      // positional-read drop, shape/date withholds), NOT a failed read. kept_existing here
      // silently UNDID every such arm on the reprocess path — the Ironbridge-as-Copperfield
      // rows survived their own veto (live 2026-07-31). The new row wins: null value + its
      // own note + its own method/suggested_supplier (so the named-blank "Use '<name>'"
      // button now works on reprocess too). EXCLUSION (Oracle C1, blocking): a row the
      // OPERATOR corrected (ex.corrected_to) keeps the human's answer unconditionally — an
      // engine abstain never displaces it. An UN-annotated empty (the validator normaliser
      // placeholder {value:None, conf:0, method:'unknown'}) keeps today's kept_existing
      // byte-identically — that is THE shape this carry-over exists for (PINNED in
      // test_reprocess_annotated_empty.js). NOTE: the realdoc M=0 harness runs FRESH
      // extraction and is structurally blind to this merge — the unit battery is the gate.
      if (String(row.validation_note || '').trim()
          && !String(ex.corrected_to || '').trim()
          && process.env.REPROCESS_ANNOTATED_EMPTY_WINS !== '0') {
        trace(row.field_key, 'used_new_annotated', ex.display_value, row.display_value);
        return row;
      }
      trace(row.field_key, 'kept_existing', ex.display_value, row.display_value);
      return {
        ...row, raw_value: ex.raw_value,
        display_value: ex.display_value, confidence: ex.confidence,
        validation_note: ex.validation_note || null,
        corrected_to: ex.corrected_to || null,
      };
    }
    if (ex.display_value) trace(row.field_key, 'used_new', ex.display_value, row.display_value);
    return row;
  });

  const newFieldKeys = new Set(newRows.map(r => r.field_key));
  for (const ex of existing) {
    if (!newFieldKeys.has(ex.field_key) && ex.display_value) {
      if (flip && !flip.newTypeKeys.has(ex.field_key)) {
        trace(ex.field_key, 'dropped_stale_type', ex.display_value, null);
        continue;
      }
      mergedRows.push({
        field_key:         ex.field_key,
        raw_value:         ex.raw_value,
        display_value:     ex.display_value,
        confidence:        ex.confidence,
        extraction_method: ex.extraction_method,
        validation_note:   ex.validation_note || null,
        corrected_to:      ex.corrected_to || null,
        candidates:        ex.candidates || null,   // preserve the stored picker JSON on carry-over
        suggested_supplier: ex.suggested_supplier || null,   // preserve the branding-detected name on carry-over
      });
    }
  }

  if (flip && flip.noteText && mergedRows.length) {
    const target = mergedRows.find(r => r.field_key === flip.refKey)
                || mergedRows.find(r => r.display_value)
                || mergedRows[0];
    target.validation_note = target.validation_note
      ? `${flip.noteText} ${target.validation_note}`
      : flip.noteText;
  }
  return mergedRows;
}

// Column-mirror predicate (Oracle C2; module-level so the unit test can pin it): TRUE when
// the MERGED supplier_name row is an ANNOTATED empty — the doc-level supplier column (queue
// grouping / filing + learning scope) must not outlive the blanked field, so the caller
// writes an explicit NULL instead of the COALESCE keep. Same kill switch as the merge rule
// (REPROCESS_ANNOTATED_EMPTY_WINS) — one seam, never split (Oracle C2).
function supplierColumnBlanked(mergedRows) {
  if (process.env.REPROCESS_ANNOTATED_EMPTY_WINS === '0') return false;
  const r = (mergedRows || []).find(x => x && x.field_key === 'supplier_name');
  return !!r && !r.display_value && !!String(r.validation_note || '').trim();
}

// Fill-only merge for the fast text-only re-extract (Slice B, DARK). Unlike
// mergeReprocessRows — which CLOBBERS a stored value with a fresh read — this NEVER
// overwrites and NEVER writes the DB: it returns ONLY additive suggestions for fields the
// operator has no value for AND the system isn't already positioned to read. The renderer
// surfaces these as dismissable pills that persist only on the operator's own confirm.
//
// A field becomes a suggestion ONLY when ALL hold (Oracle C4/C6):
//   (a) the fast run produced a non-empty value with NO validation_note (Stage-4 clean);
//   (b) the STORED field is genuinely empty — no display_value AND no validation_note
//       (a flagged empty is a deliberate review state, not a hole to fill);
//   (c) the field has NO learned anchor in (supplier,type) scope — an anchored empty means
//       the taught position read nothing on purpose; a text-fallback must not override it.
// `anchoredKeys` = Set<field_key> the caller built from learning.getTaughtFieldKeys.
// Admission rule for the fast re-extract's known-template pick (module-level so the unit
// test can pin it). Non-blank docs: any guarded identifyByFingerprint pick is admissible
// (unchanged pre-2026-08-01 behaviour). Blank-supplier (unpinned collision-class) docs: the
// pick is admissible ONLY when it differs from the stale stored link — the same id is the
// collision re-arriving (the 930842e anti-recollision ruling), a different id is a template
// born since (the just-confirmed-sibling case).
function admitReextractPick(unpinBlank, storedTemplateId, pickId) {
  if (pickId == null) return false;
  if (!unpinBlank) return true;
  return pickId !== (storedTemplateId || null);
}

function mergeReextractRows(existing, newExtractions, anchoredKeys = new Set(), opts = {}) {
  const exMap = {};
  for (const e of (existing || [])) exMap[e.field_key] = e;
  const suggestions = [];
  for (const [key, data] of Object.entries(newExtractions || {})) {
    if (!data || typeof data !== 'object') continue;
    const value = data.value != null ? String(data.value) : '';
    if (!value.trim()) continue;                                   // (a) non-empty
    const ex = exMap[key];
    // BRANDING-BLANK LIVE FILL exception (owner + bob 2026-08-01; kill
    // REEXTRACT_UNPIN_BLANK_SUPPLIER=0 upstream — the caller threads it as
    // opts.brandingBlankSupplier). The one legitimate crack in the two "flagged" walls
    // below: a VETO-BLANKED issuer (stored supplier_name EMPTY + the branding note whose
    // '(confirm|set) the correct company' tail is the pinned marker, BOTH veto-class copies —
    // the no-name blank ends 'confirm…', the logo-conflict blank ends 'set…'; one-copy
    // matchers have broken twice before, cea79ef) re-checked against NOW-warmer
    // learning that resolves the sender ('Company inferred from previously filed documents…'
    // — or a clean read). Without this, the live ⟳ pill could never suggest the true sender
    // on the collision class: the stored flag blocked (b) and the inferred note blocked (a).
    // Suggestion-only as ever — nothing fills until the operator clicks; the stored flag
    // stays until they accept.
    const _bbException = opts.brandingBlankSupplier === true
      && key === 'supplier_name'
      && !!ex && !String(ex.display_value || '').trim()
      && /(confirm|set) the correct company/i.test(String(ex.validation_note || ''))
      && (!data.validation_note || /company inferred/i.test(String(data.validation_note)));
    if (data.validation_note && !_bbException) continue;           // (a) Stage-4 clean
    if (ex && ex.display_value && String(ex.display_value).trim()) continue;  // (b) stored has a value
    if (ex && ex.validation_note && !_bbException) continue;       // (b) flagged empty — keep the flag
    // (c) anchor-abstain — EXCEPT for the branding-blank issuer (2026-08-01 evening, the
    // Saltmarsh sibling-batch measurement): EVERY confirm writes an authoritative
    // supplier_name anchor for its scope, so after the FIRST sibling confirm the scope is
    // always "anchored" and the wall killed the exception's one target case by
    // construction. The abstain rationale ("the taught position read nothing on purpose")
    // does not apply here: the imageless run never attempts anchors, the suggestion comes
    // from template_identity (Stage 0), and the stored blank PREDATES the scope's anchor
    // (it is the import-time collision veto, proven by the note marker the exception
    // already requires). An anchored INTENTIONAL empty never carries that marker, so the
    // marker keeps ordinary anchor-abstains intact.
    if (anchoredKeys && anchoredKeys.has(key) && !_bbException) continue;
    suggestions.push({
      field_key:  key,
      value,
      confidence: data.confidence ?? null,
      method:     data.method || null,
    });
  }
  return suggestions;
}

function buildTrainingArgs(db, configPath, logger = null) {
  const docTypes  = require('../../../database/modules/document_types');
  const learning  = require('../../../database/modules/learning');
  const templates = require('../../../database/modules/templates');

  const allDocTypes  = docTypes.getAllWithFields(db);
  // getAllHints, NOT getHints(db): the bare form's default LIMIT 100 silently starved
  // the engine of every new supplier's low-usage hints once the corpus grew (2026-07-10).
  const allHints     = learning.getAllHints(db);
  const allAnchors   = learning.getAllAnchors(db);
  const allLogos     = learning.getAllLogos(db);
  const allTemplates = templates.getAll(db);
  // Format model is the source of the qualification gate. The catch was SILENT,
  // which hid the cause when 0 formats reach the extractor despite many confirms
  // — log a throw (so a real failure is visible) and the resulting group count.
  let allFormats = [];
  try { allFormats = learning.getFieldFormats(db); }
  catch (e) { logger?.warn?.(`[training] getFieldFormats failed: ${e && e.message}`); }
  // Admin keyword label overrides (per-installation; merged onto the shipped
  // patterns at processing time, scoped to the doc-type slug). Guarded so an
  // older DB without migration 19 still processes (just with no overrides).
  let allLabelOverrides = [];
  try { allLabelOverrides = require('../../../database/modules/label_overrides').getForExtraction(db); }
  catch (e) { logger?.warn?.(`[training] label overrides load failed: ${e && e.message}`); }

  // Operator-taught field cleanup rules (Review right-click toolkit). Guarded so an
  // older DB without migration 36 still processes (just with no rules).
  let allFieldRules = [];
  try { allFieldRules = learning.getFieldRules(db); }
  catch (e) { logger?.warn?.(`[training] field rules load failed: ${e && e.message}`); }

  // Visible in processing.log so "0 formats loaded" can be traced to its source
  // (a throw above vs genuinely no qualifying confirmed history yet).
  logger?.log?.(`[training] ${allTemplates.length} templates, ${allFormats.length} format groups, ` +
                `${allAnchors.length} anchors, ${allHints.length} hints, ${allLabelOverrides.length} label overrides`);
  // Enumerate the learned format groups (key = supplier|doctype|field, with the
  // distinct-value count). This is the fastest way to see whether a given field
  // (e.g. 'date') is being learned at all — a field with no group here can't be
  // qualified/recovered, no matter what the anchor reads.
  if (allFormats.length) {
    const groups = allFormats
      .map(g => `${g.supplier_name || '∅'}|${g.document_type}|${g.field_key}(${(g.sample_values || []).length})`)
      .join(', ');
    logger?.log?.(`[training] format groups: ${groups}`);
  }
  diaglog.write({ ev: 'training_load',
    templates: allTemplates.length, anchors: allAnchors.length, hints: allHints.length,
    label_overrides: allLabelOverrides.length,
    format_groups: allFormats.map(g => ({
      key: `${g.supplier_name || ''}|${g.document_type}|${g.field_key}`,
      distinct: (g.sample_values || []).length,
      samples: (g.sample_values || []).slice(0, 5),
    })),
  });

  const fieldsFile    = writeTempJson('fields',    allDocTypes.flatMap(dt => dt.fields));
  const hintsFile     = writeTempJson('hints',     allHints);
  const anchorsFile   = writeTempJson('anchors',   allAnchors);
  const logosFile     = writeTempJson('logos',     allLogos);
  const dtFile        = writeTempJson('doctypes',  allDocTypes);
  const formatsFile   = writeTempJson('formats',   allFormats);
  const templatesFile = writeTempJson('templates', allTemplates);
  const overridesFile = writeTempJson('labeloverrides', allLabelOverrides);
  const fieldRulesFile = writeTempJson('fieldrules', allFieldRules);
  // Operator-accepted NAME allowlist (Review "This name is correct" button): exempts these
  // exact values from the wordness/truncation flags. Empty by default. Guarded so an older DB
  // still processes.
  let allAcceptedNames = [];
  try { allAcceptedNames = learning.getAcceptedNames(db); }
  catch (e) { logger?.warn?.(`[training] accepted names load failed: ${e && e.message}`); }
  const acceptedNamesFile = writeTempJson('acceptednames', allAcceptedNames);
  // Operator-accepted ISSUER allowlist — resolved suppliers marked a valid issuer via the
  // identity-conflict button (skips the conflict flag). Empty by default; guarded for older DBs.
  let allAcceptedIssuers = [];
  try { allAcceptedIssuers = learning.getAcceptedIssuers(db); }
  catch (e) { logger?.warn?.(`[training] accepted issuers load failed: ${e && e.message}`); }
  const acceptedIssuersFile = writeTempJson('acceptedissuers', allAcceptedIssuers);
  const cfgFile       = configPath();

  // Registration-invariant anchoring ("register, then read"): ON unless an admin
  // explicitly disables it (setting 'registration_enabled' = 'false'). It is inert
  // until a template actually has taught landmarks (template_landmarks), so the
  // default-on is safe — templates without landmarks behave exactly as before.
  let registrationOn = true;
  try { registrationOn = learning.getSetting(db, 'registration_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Born-digital text-layer extraction: ON unless an admin disables it
  // ('born_digital_enabled' = 'false'). Inert for image-only/scanned PDFs (no
  // text layer), so the default-on is safe — those pages still go through OCR.
  let bornDigitalOn = true;
  try { bornDigitalOn = learning.getSetting(db, 'born_digital_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Free-text NAME wordness review flag: ON unless an admin disables it
  // ('name_wordness_flag' = 'false'). FLAG-ONLY — flags supplier/customer reads that
  // don't read like a name (document chrome / ref-code bleed / OCR garble / truncation)
  // so they surface for review; never rejects or rewrites a value. Inert unless the
  // char-trigram table ships (extraction/data/char_trigrams.json). See extraction/wordness.py.
  let nameWordnessOn = true;
  try { nameWordnessOn = learning.getSetting(db, 'name_wordness_flag') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Multi-line continuation reads (default ON; disabled by 'multiline_enabled' = 'false').
  // Inert without a multiline_continue field rule, so single-line reads stay byte-identical.
  let multilineOn = true;
  try { multilineOn = learning.getSetting(db, 'multiline_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Auto-rotate a sideways/upside-down scanned page (default ON; disabled by
  // 'auto_rotate_enabled' = 'false'). Inert for born-digital + confident-upright pages; the
  // per-page angles come back in file_done.page_rotations and the working copy is rotated to match.
  let autoRotateOn = true;
  try { autoRotateOn = learning.getSetting(db, 'auto_rotate_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Text-led supplier-identity CONFLICT flag: ON by default (disable by setting
  // 'identity_conflict_flag' = 'false'). FLAG-ONLY — when the issuer-band letterhead reads a
  // DIFFERENT known supplier than the pipeline resolved, the doc goes to Review with a note;
  // never overrides/fills. Inert unless identity_fusion imports (needs the bundled rapidfuzz) —
  // validated 99.4% precision / 0 false-alarms on 166 real confirmed docs (live-DB shadow).
  let identityConflictOn = true;
  try { identityConflictOn = learning.getSetting(db, 'identity_conflict_flag') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  const args = [
    '--fields-file',    fieldsFile,
    '--hints-file',     hintsFile,
    '--anchors-file',   anchorsFile,
    '--logos-file',     logosFile,
    '--doc-types-file', dtFile,
    '--formats-file',   formatsFile,
    '--templates-file', templatesFile,
    '--label-overrides-file', overridesFile,
    '--field-rules-file', fieldRulesFile,
    '--accepted-names-file', acceptedNamesFile,
    '--accepted-issuers-file', acceptedIssuersFile,
    '--config-file',    cfgFile,
  ];
  if (registrationOn) args.push('--registration');
  if (bornDigitalOn) args.push('--born-digital');
  if (nameWordnessOn) args.push('--name-wordness');
  if (multilineOn) args.push('--multiline');
  if (autoRotateOn) args.push('--auto-rotate');
  if (identityConflictOn) args.push('--identity-conflict');

  // Region date ordering for AMBIGUOUS numeric dates (default 'dmy' = UK/EU, byte-identical
  // to before). 'mdy' = US, 'ymd' = ISO-first. A day-value >12 and month-name/ISO dates are
  // unambiguous in any mode. See REGION_SETTINGS_PLAN.md.
  let dateOrder = 'dmy';
  try { const v = (learning.getSetting(db, 'region_date_order', 'dmy') || 'dmy').toLowerCase();
        if (['dmy', 'mdy', 'ymd', 'auto'].includes(v)) dateOrder = v; } catch { /* default */ }
  args.push('--date-order', dateOrder);

  // Region number format for money amounts (default 'anglo' = byte-identical). See Phase 2.
  let numFmt = 'anglo';
  try { const v = (learning.getSetting(db, 'region_number_format', 'anglo') || 'anglo').toLowerCase();
        if (['anglo', 'continental', 'french', 'swiss', 'indian'].includes(v)) numFmt = v; } catch { /* default */ }
  args.push('--number-format', numFmt);

  // Per-file watchdog: force-terminates a worker wedged on a single pathological page
  // (a native Tesseract/pdfium hang no Python try/except can catch) after emitting an
  // error for that doc, so one bad file can't stall the whole batch. Generous default so
  // a legitimately large multi-page scan never false-trips; 0 disables. Setting in seconds.
  let fileTimeout = 300;
  try { const v = parseInt(learning.getSetting(db, 'file_timeout_seconds', '300'), 10); if (Number.isFinite(v) && v >= 0) fileTimeout = v; }
  catch { /* older DB -> default */ }
  if (fileTimeout > 0) args.push('--file-timeout', String(fileTimeout));

  return {
    args,
    tempFiles: [fieldsFile, hintsFile, anchorsFile, logosFile, dtFile, formatsFile, templatesFile, overridesFile, fieldRulesFile, acceptedNamesFile, acceptedIssuersFile],
  };
}

// ── Safe path policy for "open in default app / reveal in Explorer" (F-06) ────
// shell.openPath launches a path with its OS handler — for an .exe/.lnk/UNC path
// that means code execution. The open-file / show-in-explorer IPC channels accept
// a renderer-supplied path, so it is constrained to (a) a known document/preview
// file type, (b) no UNC path, and (c) located inside an app-managed root OR a path
// recorded against a document row. Uses the module-level `path`/`fs` (Node core).
const ALLOWED_OPEN_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.xml']);

function _allowedOpenRoots(db) {
  const roots = [];
  try {
    const out = require('../../../database/modules/learning').getSetting(db, 'output_folder', null);
    if (out) roots.push(path.resolve(out));
  } catch { /* ignore */ }
  try {
    const { app } = require('electron');
    roots.push(path.resolve(path.join(app.getPath('userData'), 'inbox')));
    // Separator-sheet packs (Filing Slips): written ONLY by the generate-filing-slips
    // IPC into this app-managed dir; the renderer round-trips the path through
    // open-file/show-in-explorer to open the pack for printing.
    roots.push(path.resolve(path.join(app.getPath('userData'), 'filing-slips')));
  } catch { /* ignore (e.g. unit tests without an electron app) */ }
  return roots;
}

function _withinAnyRoot(resolved, roots) {
  return roots.some(r => resolved === r || resolved.startsWith(r + path.sep));
}

// True only when `rawPath` is safe to hand to shell.openPath / showItemInFolder.
function _isOpenablePath(db, rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  if (/^[\\/]{2}/.test(rawPath)) return false;                  // reject UNC (\\host or //host)
  let resolved;
  try { resolved = path.resolve(rawPath); } catch { return false; }
  if (/^[\\/]{2}/.test(resolved)) return false;                 // UNC after resolution too
  if (!ALLOWED_OPEN_EXTS.has(path.extname(resolved).toLowerCase())) return false;
  if (_withinAnyRoot(resolved, _allowedOpenRoots(db))) return true;
  // Otherwise allow only an exact path the app itself recorded for a document
  // (covers an original source file that legitimately lives outside the roots).
  try {
    const base = path.basename(resolved);
    const rows = db.prepare(
      `SELECT working_path, stored_path, folder_path, original_filename FROM documents
        WHERE working_path = ? OR stored_path = ? OR original_filename = ?`
    ).all(resolved, resolved, base);
    for (const row of rows) {
      if (row.working_path && path.resolve(row.working_path) === resolved) return true;
      if (row.stored_path && path.resolve(row.stored_path) === resolved) return true;
      if (row.folder_path && row.original_filename &&
          path.resolve(path.join(row.folder_path, row.original_filename)) === resolved) return true;
    }
  } catch { /* ignore */ }
  return false;
}

// Captured at register() so the module-level _handleFileMessage can spawn standalone helper
// scripts (e.g. pdf_rotate.py) without threading ctx through every caller.
let _pyHelpers = null;

// Core-aware ceiling for cross-document parallelism (the `processing_concurrency` setting).
// Parallelism only helps up to ~the machine's CPU cores — beyond that the per-worker
// Tesseract/threadCap split floors to 1 and the extra processes just thrash the CPU + RAM
// (each worker holds 300-DPI page images). So the cap tracks the detected core count, with a
// hard ceiling of 10 (past which the single-threaded JS persistence step is the bottleneck
// regardless of CPU). A modest PC therefore can't oversubscribe; a powerful one can go higher.
function maxConcurrency() {
  const cores = os.cpus().length || 1;
  return Math.max(1, Math.min(10, cores));
}

// A sensible DEFAULT parallelism for a fresh install / unset setting: scale with the CPU
// cores but leave ~2 cores of headroom for the OS/UI and each worker's Tesseract threads +
// 300-DPI page images. The old hardcoded defaults (runtime 1, wizard 2) left multi-core PCs
// idle; a user can still pick anything up to maxConcurrency() in Settings.
// e.g. 2-core -> 1, 4-core -> 2, 6-core -> 4, 8-core -> 6.
function defaultConcurrency() {
  const cores = os.cpus().length || 1;
  return Math.max(1, Math.min(maxConcurrency(), cores - 2));
}

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          backendScript, configPath, notifyMainWindow, notifyDevInspector,
          notifyReview, safeSend, spawn, path, fs, logger } = ctx;
  _pyHelpers = { pythonExe, pythonArgs, backendScript };
  _notifyAll = ctx.notifyAllWindows;   // broadcast import/watch activity to Review (see _broadcastActivity)

  // Warm OCR worker POOL (draw-tool UX plan Slice 2) — configured once; the ocr-region(-boxes)
  // handlers route through it when ENABLED (default OFF: env OCR_WARM_WORKER=1 or setting
  // ocr_warm_worker_enabled), falling back to a cold region.py spawn on any worker failure so a
  // read never fails toward empty. See src/modules/processing/regionWorker.js.
  const regionWorker = require('./regionWorker');
  regionWorker.configure({
    pythonExe, pythonArgs,
    workerScript: ctx.resourcePath('python_backend', 'ocr', 'region_worker.py'),
    tesseract: tesseractPath,
    isEnabled: () => {
      try {
        const env = process.env.OCR_WARM_WORKER;      // explicit override wins: '1' on, '0' off
        if (env === '1') return true;
        if (env === '0') return false;
        // DEFAULT ON (owner-enabled 2026-07-16 after validating the ~4.6x draw speedup); the
        // Settings → Processing toggle sets 'false' to disable. Idle-kill (3 min) + crash-fallback
        // bound the risk. Setting missing → on.
        return require('../../../database/modules/learning')
          .getSetting(getDb(), 'ocr_warm_worker_enabled', 'true') !== 'false';
      } catch { return false; }
    },
  });
  try { require('electron').app.on('before-quit', () => regionWorker.shutdown()); } catch {}

  // Startup holding-area reconciliation — GC crash debris (.part / orphaned /
  // already-confirmed inbox copies) so the holding queue agrees with the DB on
  // launch. Deferred so it never blocks module registration; best-effort.
  setImmediate(() => {
    try {
      const db = getDb();
      runHoldingReconcile(db, logger);
      notifyMainWindow?.('stuck-count-changed',
        require('../../../database/modules/documents').getStuckCount(db));
    } catch (e) { logger?.warn(`[reconcile] startup sweep skipped: ${e.message}`); }
  });

  // Additive read-only telemetry mirror: send a progress message to the invoking
  // renderer exactly as before, then ALSO to the hidden dev inspector if it is
  // open (no-op otherwise). Does not change message shape, ordering, or any
  // processing logic — it is a pure tee.
  // `sender` is event.sender (a webContents) captured at invoke time; it can be
  // DESTROYED while the Python child still streams after its window closed, so it
  // MUST go through safeSend (was a raw sender.send → uncaught "Object has been
  // destroyed" crash on closing the window mid-run). notifyDevInspector already
  // routes through safeSend in main.js.
  const mirror = (sender, channel, msg) => {
    safeSend(sender, channel, msg);
    notifyDevInspector?.(channel, msg);
  };

  // Reprocess-All progress goes to the LIVE Review window (looked up fresh on every send), NOT the
  // window that STARTED the batch — so the batch survives closing + reopening Review and the reopened
  // window reconnects (see _reprocessStatus + get-reprocess-status). Plus the dev inspector.
  const mirrorReprocess = (msg) => {
    notifyReview?.('reprocess-progress', msg);
    notifyDevInspector?.('reprocess-progress', msg);
  };

  // Should the Python child emit the dev trace stream this run? True when the
  // hidden inspector window is open, OR diagnostic logging is on (passed in, since
  // it's computed per-handler), OR the in-Review dev console requested it
  // (ctx.reviewTraceActive, set by review-trace-set).
  const traceWanted = (diagOn) => !!(ctx.windows && ctx.windows['dev-inspector'])
    || !!diagOn || !!ctx.reviewTraceActive;

  // Route a trace event to every active sink: the session registry (so the
  // inspector/Review console can PULL it via dev-get-session-doc), the inspector
  // window, the Review window (only when its console is active), and the diag log.
  // Each sink self-gates (notify* are no-ops when their window is absent), so this
  // is safe to call unconditionally on any received trace message.
  const routeTrace = (msg) => {
    _recordDevTrace(msg);
    notifyDevInspector?.('process-trace', msg);
    if (ctx.reviewTraceActive) notifyReview?.('process-trace', msg);
    diaglog.write(msg);
  };

  const { requireRole, requireLogin, getCurrentUser, hasRole, logAudit } = require('../auth/handler');

  // ── Folder picker ───────────────────────────────────────────────────────────
  const { dialog, shell } = require('electron');

  // Dev-inspector read-only session getters (no mutation; in-memory only). Role-gated to
  // admin/edit (defence-in-depth, §4a #3): the trace payload carries in-review document
  // metadata a read-only user is otherwise denied, and these IPCs are reachable via devtools
  // even in packaged builds where the inspector WINDOW is disabled.
  ipcMain.handle('dev-get-session-docs', () => { requireRole('admin', 'edit'); return _devSession.docs.slice().reverse(); });
  ipcMain.handle('dev-get-session-doc',  (_e, key) => { requireRole('admin', 'edit'); return _devSession.traceByDoc.get(key) || []; });

  // Source folder for "Process Documents" — part of the daily Admin/Edit workflow. A native folder
  // picker can't show the files inside (Windows: folders-only), so the Import view lists the folder's
  // documents right after picking (see 'list-import-folder') — the operator picks the folder here,
  // then SEES what's in it before processing.
  ipcMain.handle('pick-folder', async (e) => {
    requireRole('admin', 'edit');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select the folder of scanned documents to import',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // List the documents the import will actually process in a chosen folder (non-recursive, SAME
  // extension set as the batch enumerator above) so the Import view can show "N documents ready" +
  // the filenames before processing. Read-only; returns { count, files, error? }.
  ipcMain.handle('list-import-folder', async (_e, folderPath) => {
    requireRole('admin', 'edit');
    if (!folderPath) return { count: 0, files: [] };
    try {
      const files = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(en => en.isFile() && BATCH_SUPPORTED_EXTS.has(path.extname(en.name).toLowerCase()))
        .map(en => en.name)
        .sort();
      return { count: files.length, files };
    } catch (err) {
      return { count: 0, files: [], error: err.message };
    }
  });

  // Single-file import for the Teach wizard: pick ONE PDF and stage it in a FRESH temp folder
  // so the existing process-folder path imports just that one file into the review queue
  // (so a doc can be taught even when the queue is empty). Returns {folder, filename} for the
  // renderer to processFolder() then select; null if cancelled, {error} on a copy failure.
  ipcMain.handle('stage-pdf-for-teach', async (e) => {
    requireRole('admin', 'edit');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Select a PDF to teach',
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      // Sweep leftover staging folders from previous teaches first (teach-imports are
      // sequential, so any prior sf-teach-* is finished) — bounds the temp clutter to ≤1.
      try {
        const tmpRoot = os.tmpdir();
        for (const name of fs.readdirSync(tmpRoot)) {
          if (name.startsWith('sf-teach-')) {
            try { fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true }); } catch {}
          }
        }
      } catch {}
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teach-'));
      const base   = path.basename(r.filePaths[0]);
      fs.copyFileSync(r.filePaths[0], path.join(tmpDir, base));
      return { folder: tmpDir, filename: base };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Output folder is an app-wide filing-destination setting — "access all
  // settings" is the Admin-exclusive line drawn for Settings, and this picker
  // only ever appears inside that Admin-gated window.
  ipcMain.handle('pick-output-folder', async (e) => {
    requireRole('admin');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select output folder for processed documents',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // ROLE-GATED admin/edit (owner 2026-08-02, supersedes the old "every signed-in role"
  // rule): a shell hand-out is uncontrolled access to the file — Read Only keeps the
  // in-app preview and loses the hatch. NON-THROWING guard (these are send channels —
  // a requireRole throw here would be an uncaught main-process exception).
  // AUDITED: once a file leaves through the shell there is no control over what happens
  // to it — so the act of handing it out is itself the audit event.
  ipcMain.on('show-in-explorer', (_e, filePath) => {
    if (!hasRole('admin', 'edit')) { logger?.warn?.('[security] show-in-explorer refused for role'); return; }
    if (!_isOpenablePath(getDb(), filePath)) {
      logger?.warn?.('[security] blocked show-in-explorer for a disallowed path');
      return;
    }
    try {
      logAudit(getDb(), { action: 'file_shown_in_explorer', action_category: 'document',
        target_type: 'file', outcome: 'success', metadata: { file: path.basename(String(filePath || '')) } });
    } catch { /* audit best-effort */ }
    shell.showItemInFolder(filePath);
  });
  ipcMain.on('open-file', (_e, filePath) => {
    if (!hasRole('admin', 'edit')) { logger?.warn?.('[security] open-file refused for role'); return; }
    if (!_isOpenablePath(getDb(), filePath)) {
      logger?.warn?.('[security] blocked open-file for a disallowed path');
      return;
    }
    try {
      logAudit(getDb(), { action: 'file_opened_externally', action_category: 'document',
        target_type: 'file', outcome: 'success', metadata: { file: path.basename(String(filePath || '')) } });
    } catch { /* audit best-effort */ }
    shell.openPath(filePath);
  });
  // ── DOC-ID-RESOLVED opens (the de-pathing slice, owner 2026-08-02) ─────────────────
  // The Search renderer no longer holds ANY filesystem path; these resolve the filed
  // copy SERVER-SIDE from the doc row (stored_path only — the same semantics the old
  // renderer guard had), re-run the containment policy, audit with the document id, and
  // return {success,error} so a refusal is visible instead of a silently dropped send.
  const _openResolvedDoc = (docId, mode) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const row = db.prepare('SELECT id, stored_path FROM documents WHERE id = ?').get(Number(docId));
    if (!row) return { success: false, error: 'Document not found.' };
    if (!row.stored_path || !fs.existsSync(row.stored_path)) return { success: false, error: 'This document has no filed copy on disk.' };
    if (!_isOpenablePath(db, row.stored_path)) {
      logger?.warn?.(`[security] blocked ${mode} for a disallowed resolved path`);
      return { success: false, error: 'This file sits outside the app’s allowed folders.' };
    }
    try {
      logAudit(db, { action: mode === 'open' ? 'file_opened_externally' : 'file_shown_in_explorer',
        action_category: 'document', target_type: 'document', target_id: row.id, document_id: row.id,
        outcome: 'success', metadata: { file: path.basename(row.stored_path) } });
    } catch { /* audit best-effort */ }
    if (mode === 'open') shell.openPath(row.stored_path);
    else shell.showItemInFolder(row.stored_path);
    return { success: true };
  };
  ipcMain.handle('open-document-file',        (_e, docId) => _openResolvedDoc(docId, 'open'));
  ipcMain.handle('show-document-in-explorer', (_e, docId) => _openResolvedDoc(docId, 'show'));

  // Open a FOLDER (not a file) — the file allowlist requires an extension, so folders
  // need their own check: must be an app-managed root (e.g. the output folder), no UNC.
  ipcMain.on('open-folder', (_e, dir) => {
    // Same admin/edit gate: shell-browsing the output tree is uncontrolled access to EVERY
    // filed document — strictly worse than the per-doc buttons Read Only already lost.
    if (!hasRole('admin', 'edit')) { logger?.warn?.('[security] open-folder refused for role'); return; }
    let resolved;
    try { resolved = path.resolve(dir); } catch { return; }
    if (!dir || typeof dir !== 'string' || /^[\\/]{2}/.test(dir) || /^[\\/]{2}/.test(resolved)) return;
    if (!_withinAnyRoot(resolved, _allowedOpenRoots(getDb()))) {
      logger?.warn?.('[security] blocked open-folder for a disallowed path');
      return;
    }
    try {
      logAudit(getDb(), { action: 'folder_opened_externally', action_category: 'document',
        target_type: 'folder', outcome: 'success', metadata: { folder: path.basename(resolved) } });
    } catch { /* audit best-effort */ }
    shell.openPath(resolved);
  });

  // Diagnostic-only: record a ⊕ teach action — the box coordinates STORED for the
  // anchor plus the value the live zone-OCR read at teach time, and the preview
  // image dimensions used. Comparing this "teach-time read at coords X" against
  // the extraction-time read at the same coords pinpoints a review-preview vs
  // extraction-render coordinate-space mismatch. No-op unless diagnostic logging
  // is on. Fire-and-forget from the review renderer.
  ipcMain.on('diag-teach', (_e, data) => {
    try {
      if (!_diagEnabled(getDb())) return;
      diaglog.enable();
      diaglog.write({ ev: 'teach_anchor', ...(data || {}) });
    } catch { /* diagnostics never disrupt */ }
  });

  // ── Stop processing ─────────────────────────────────────────────────────────
  ipcMain.handle('stop-processing', () => {
    requireRole('admin', 'edit');
    // ALWAYS set the cancel flag, even if no child is running this instant — a stop
    // pressed in the gap between two pre-pass detection spawns must still take, or the
    // loop keeps going and "Stopping…" hangs.
    _cancelRequested = true;
    if (_currentBatchProcs.length) {
      // Kill every worker's full process tree: in dev mode `py.exe` (Python
      // Launcher) is spawned and proc.kill() only kills the launcher, leaving
      // python.exe alive and writing to the inherited pipe. taskkill /T kills
      // all descendants so the pipe closes and proc.on('close') fires promptly.
      for (const proc of _currentBatchProcs) {
        try {
          require('child_process').spawnSync(
            TASKKILL_EXE, ['/F', '/T', '/PID', String(proc.pid)],
            { windowsHide: true, stdio: 'ignore' }
          );
        } catch {}
        try { proc.kill(); } catch {}
      }
      _currentBatchProcs = [];
    }
    return true;
  });

  // ── Batch document SEPARATION (Stage 1) ───────────────────────────────────────
  // Split a multi-DOCUMENT PDF (e.g. ten one-page alerts generated into one file) into
  // separate documents BEFORE the worker pool runs, so each is OCR'd/extracted/filed on
  // its own instead of as a single document. Conservative + fail-safe: the detector
  // (segment_docs.py → ocr/segmentation.py) only proposes a split for a confident multi-
  // first-page batch; a normal multi-page invoice (or any error/timeout) yields ONE
  // segment and nothing changes. Splits in place (reusing pdf_splitter.py) and moves the
  // original into a recoverable subfolder the NON-recursive folder scan ignores.
  const SEPARATED_DIR = '.sf_separated_originals';
  const runPyJson = (script, args, env) => new Promise((resolve) => {
    let out = '';
    let proc;
    try { proc = spawn(pythonExe(), pythonArgs(script, ...args), { windowsHide: true, env: env || process.env }); }
    catch { return resolve(null); }
    // Track the pre-pass child in the shared batch list so Stop kills it IMMEDIATELY
    // (otherwise stop only takes effect after the current detection finishes).
    _currentBatchProcs.push(proc);
    const done = (val) => { _currentBatchProcs = _currentBatchProcs.filter(p => p !== proc); resolve(val); };
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => { try { done(JSON.parse(out.trim())); } catch { done(null); } });
    proc.on('error', () => done(null));
  });

  async function _separateBatchDocuments(folderPath, templatesFile, log, onPhase, parallelism, slipsOn, trace) {
    let pdfs = [];
    try {
      pdfs = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.pdf')
        .map(e => e.name);
    } catch { return 0; }
    if (!pdfs.length) return 0;

    const segScript   = path.join(path.dirname(backendScript()), 'segment_docs.py');
    const splitScript = path.join(path.dirname(backendScript()), 'pdf_splitter.py');
    let separated = 0, done = 0, next = 0;

    // Bounded parallelism for the detection pre-pass. Each detection spawns Tesseract
    // (itself multithreaded), so cap each worker's OpenMP threads to cores/P to keep
    // total threads ≈ cores rather than P×cores of thrash. Each PDF is independent
    // (detection reads its own file; split writes its own basenames + moves its own
    // original), so this is safe to run concurrently.
    const P = Math.max(1, parallelism || 1);
    const cores = os.cpus().length || 1;
    const threadCap = Math.max(1, Math.floor(cores / P));
    const env = P > 1 ? { ...process.env, OMP_THREAD_LIMIT: String(threadCap) } : process.env;

    onPhase?.(`Preparing — scanning ${pdfs.length} document(s) for multi-page splits…`);

    async function worker() {
      while (!_cancelRequested) {
        const i = next++;
        if (i >= pdfs.length) return;
        const name = pdfs[i];
        const filePath = path.join(folderPath, name);
        const det = await runPyJson(segScript,
          buildSegmentArgs({ filePath, templatesFile, tesseract: tesseractPath(), slips: slipsOn }), env);
        done += 1;
        onPhase?.(`Preparing ${done}/${pdfs.length}…`);
        if (_cancelRequested) return;
        // Decision logic (incl. the Filing-Slips exclusion/rewrite rules) lives in the
        // pure split_plan.js so it is pinned by test_split_plan.js.
        const plan = buildSplitPlan(det);
        if (plan.action === 'skip') continue;   // one document, no sheets → leave it untouched

        if (plan.action === 'consume') {
          // The file is ONLY separator sheets — nothing to import. Keep it recoverable.
          try {
            const keepDir = path.join(folderPath, SEPARATED_DIR);
            fs.mkdirSync(keepDir, { recursive: true });
            fs.renameSync(filePath, path.join(keepDir, name));
            log?.(`${name} contained only separator sheets — nothing to import (kept in ${SEPARATED_DIR})`);
          } catch {
            // Not movable → it imports as a normal (junk) doc and lands in Review — visible, never silent.
            log?.(`${name} contains only separator sheets but could not be set aside — left in place`, 'warn');
          }
          continue;
        }

        // plan.action === 'split' — ranges already EXCLUDE separator-sheet pages; with
        // sheets present ONE output is legal (the REWRITE case: doc + trailing sheet).
        const split  = await runPyJson(splitScript,
          ['--file', filePath, '--ranges', plan.ranges, '--outdir', folderPath], env);
        const made   = (split && split.success && Array.isArray(split.files))
          ? split.files.filter(f => fs.existsSync(f)) : [];
        if (made.length < plan.minFiles) continue;   // splitter failed → leave the original as one doc

        // Move the original OUT of the (non-recursive) scan so it isn't ALSO processed,
        // while keeping it recoverable.
        try {
          const keepDir = path.join(folderPath, SEPARATED_DIR);
          fs.mkdirSync(keepDir, { recursive: true });
          fs.renameSync(filePath, path.join(keepDir, name));
        } catch (e) {
          // Original not movable → delete the new segments so we never process BOTH the
          // original and its parts (duplicates). Leave it as a single document.
          for (const f of made) { try { fs.unlinkSync(f); } catch {} }
          log?.(`Could not separate ${name} (original locked) — left as one document`, 'warn');
          continue;
        }
        separated += 1;
        if (plan.separators) {
          log?.(`${name} — ${plan.separators} separator sheet(s) found · ${made.length} document(s) imported · sheets removed · original kept safe`);
          trace?.({ ev: 'slip_split', file: name, separators: plan.separators, payloads: plan.payloads, made: made.length });
        } else {
          log?.(`Detected ${made.length} documents in ${name} — separated`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(P, pdfs.length) }, worker));
    return separated;
  }

  // ── Process folder ──────────────────────────────────────────────────────────
  ipcMain.handle('process-folder', async (event, folderPath, opts) => {
    requireRole('admin', 'edit');
    // The Teach wizard imports a single PDF with {autoFile:false} so a 100%-confidence doc is
    // NOT auto-filed out of the review queue before the teach picker can select it.
    const autoFileRun = !opts || opts.autoFile !== false;
    const db = getDb();
    // Refuse importing the OUTPUT tree (or the drain "Processed" folder): filed docs
    // would be re-processed, and with a flat output pattern re-imported in a loop (QA
    // audit #8). The teach/single-file path imports from a temp staging folder, so it
    // never trips this.
    {
      const learning = require('../../../database/modules/learning');
      const { foldersOverlap } = require('../path_overlap');
      const out = learning.getSetting(db, 'output_folder', null);
      const processed = learning.getSetting(db, 'processed_folder', null);
      if (out && foldersOverlap(folderPath, out)) {
        return { success: false, error: 'This is your output folder (or a folder inside it). Importing it would re-process already-filed documents. Please choose a different folder.' };
      }
      if (processed && foldersOverlap(folderPath, processed)) {
        return { success: false, error: 'This is your “Processed” folder. Importing it would re-process already-filed documents. Please choose a different folder.' };
      }
    }
    // Multi-point licensing enforcement (F-01): bulk import is the highest-value
    // extraction write path. Network-free cached-license re-check before any work.
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to process documents. Please re-activate ScanFinder.', ...licenseDenial };
    logAudit(db, { action: 'import_run', action_category: 'processing', target_type: 'folder',
      outcome: 'success', metadata: { folder: folderPath } });
    const diagOn = _diagEnabled(db);
    if (diagOn) { diaglog.enable(); diaglog.write({ ev: 'batch_start', folder: folderPath }); }
    _takeDrainTally(folderPath);   // clear any stale tally for THIS folder (prior runs); watch folders untouched
    let trainingArgs, tempFiles;
    try {
      ({ args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath, logger));
    } catch (e) {
      console.error('[process-folder] buildTrainingArgs failed:', e);
      mirror(event.sender, 'process-progress', {
        type: 'log', text: `Setup error: ${e.message}`, level: 'err'
      });
      return { success: false, error: e.message };
    }

    const learning  = require('../../../database/modules/learning');
    const procMode  = _validMode(learning.getSetting(db, 'processing_mode', 'smart'));

    // Bounded cross-document parallelism. Each worker is a separate Python
    // process handling a disjoint slice of the folder; ALL DB writes still flow
    // through _handleFileMessage on the single-threaded JS event loop (better-
    // sqlite3 is synchronous), so concurrency only parallelizes the CPU-bound
    // OCR/extraction, never DB/learning state. Default is core-aware (defaultConcurrency).
    let concurrency = parseInt(learning.getSetting(db, 'processing_concurrency', String(defaultConcurrency())), 10);
    if (!Number.isFinite(concurrency)) concurrency = 1;
    // Core-aware ceiling (see maxConcurrency): cross-document parallelism only helps up to
    // ~the CPU core count; above that the per-worker Tesseract/threadCap split starves and the
    // batch thrashes rather than speeds up. Default is 1.
    concurrency = Math.max(1, Math.min(maxConcurrency(), concurrency));

    _cancelRequested   = false;
    _currentBatchProcs = [];
    let fileCount   = 0;
    const shardFiles = [];   // per-worker --files-file temp paths to clean up
    const pendingFileIo = [];   // deferred per-file working-copy/rotate/drain/auto-file promises

    // Spawn one Python worker. filesFile=null → it scans the whole folder (the
    // original single-process behaviour). suppressStart hides the worker's own
    // {type:'start'} so a pool can emit ONE aggregate total to the renderer
    // instead of N competing ones (the renderer keys its progress bar off it).
    const runWorker = (filesFile, suppressStart, threadCap = 0) => new Promise((resolve) => {
      const py = pythonExe();
      const scriptArgs = [
        '--folder',    folderPath,
        '--tesseract', tesseractPath(),
        '--mode',      procMode,
        ...trainingArgs,
      ];
      if (filesFile) scriptArgs.push('--files-file', filesFile);
      // Emit the dev trace stream + capture OCR slices while the hidden inspector
      // is open OR diagnostic logging is on (so the diagnostic file gets the full
      // per-stage trace + crop bboxes even with no window). Slice dir is created
      // on demand and cleaned by main.
      if (traceWanted(diagOn)) {
        scriptArgs.push('--trace');
        try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
      }

      // Cap Tesseract's OpenMP threads per worker. Tesseract IS internally
      // multithreaded (OpenMP) and by default grabs ~all cores PER PROCESS — so N
      // parallel workers each spawn ~cores threads (≈ N×cores) and thrash an
      // oversubscribed CPU (the real reason a 10-worker Reprocess All crawled). The
      // worker POOL is the parallelism; per-process OMP threading fights it. Capping
      // to cores/workers (threadCap) keeps total threads ≈ cores. threadCap=0 (the
      // single-worker path) leaves Tesseract free to use every core for the one proc.
      const env = {
        ...process.env,
        ...(threadCap > 0 ? { OMP_THREAD_LIMIT: String(threadCap) } : {}),
        ..._autoTitleEnv(db),
        ..._ocrDpiEnv(db),
        ..._anchorCropEnv(db),
        ..._reconcileEnv(db),
      };
      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true, env });
      _currentBatchProcs.push(proc);
      let buf = '';

      proc.stdout.on('data', (data) => {
        if (_cancelRequested) return;
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            // Dev-only trace stream: retain for the session registry, route to the
            // inspector and (when its console is active) the Review window — never
            // to user-facing progress or the DB handler.
            if (msg.type === 'trace') { routeTrace(msg); continue; }
            if (suppressStart && msg.type === 'start') continue;
            if (msg.type === 'file_done') {
              // Persist SYNCHRONOUSLY (better-sqlite3 is sync anyway) so msg.db_id is set
              // BEFORE we mirror — the renderer's results table needs the doc id to open
              // THAT document in Review (not the first in the queue). Guard the call so a
              // per-doc DB error can't skip the progress mirror + count below (which would
              // stall the bar and drop the doc from the results table); db_id just stays
              // unset → the row link falls back to opening Review at the first doc.
              _recordDevDoc(msg);
              try {
                const io = _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger, autoFileRun);
                if (io && typeof io.then === 'function') pendingFileIo.push(io);
              }
              catch (e) { logger?.err?.(`_handleFileMessage failed: ${msg.original_filename || '?'} — ${e && e.message}`); }
              fileCount++;
            } else {
              setImmediate(() => _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger));
            }
            if (msg.type === 'log') {
              if      (msg.level === 'err')  logger?.err(`Python: ${msg.text}`);
              else if (msg.level === 'warn') logger?.warn(`Python: ${msg.text}`);
              else                           logger?.log(`Python: ${msg.text}`);
            }
            mirror(event.sender, 'process-progress', msg);
          } catch {
            mirror(event.sender, 'process-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        if (_cancelRequested) return;
        const text = d.toString().trim();
        if (text) logger?.warn(`Python stderr: ${text}`);
        mirror(event.sender, 'process-progress', { type: 'log', text });
      });

      proc.on('close', (code) => {
        _currentBatchProcs = _currentBatchProcs.filter(p => p !== proc);
        resolve(code);
      });
    });

    // ── Auto document separation (Stage 1) ── runs BEFORE the worker set is built, so
    // both the single-worker (scans the folder) and multi-worker (enumerates it) paths
    // pick up the per-document segments. Fail-safe: a detector/splitter failure just
    // leaves the folder unchanged. See _separateBatchDocuments. TWO independent arms
    // (Oracle C2, docs/designs/FILING_SLIPS_2026-07-18.md): the template-signature
    // heuristic needs `auto_separate_enabled` (default on) AND taught templates; the
    // Filing-Slips separator-sheet scan (`filing_slips_enabled`, default OFF, env
    // FILING_SLIPS=0 hard-kill) is explicit operator intent and must work on a
    // zero-template install with the heuristic toggle off — it never re-arms template
    // segmentation (its templates-file stays gated on the heuristic arm).
    {
      const tIdx = trainingArgs.indexOf('--templates-file');
      const templatesFileRaw = tIdx >= 0 ? trainingArgs[tIdx + 1] : null;
      const autoSep = learning.getSetting(db, 'auto_separate_enabled', 'true') === 'true';
      const slipsOn = process.env.FILING_SLIPS !== '0'
        && learning.getSetting(db, 'filing_slips_enabled', 'false') === 'true';
      const templatesFile = (autoSep && templatesFileRaw) ? templatesFileRaw : null;
      if (templatesFile || slipsOn) {
        // Run detection concurrently (each PDF is independent) so the pre-pass doesn't
        // serialise a Python cold-start per document. Cap at the CPU core count (≤6).
        const sepP = Math.max(1, Math.min(os.cpus().length || 1, 6));
        try {
          const n = await _separateBatchDocuments(folderPath, templatesFile,
            (text, level) => mirror(event.sender, 'process-progress', { type: 'log', text, level: level || '' }),
            (text) => mirror(event.sender, 'process-progress', { type: 'log', text, phase: true }),
            sepP, slipsOn,
            (ev) => mirror(event.sender, 'process-trace', ev));
          if (n) logger?.log(`[separation] separated ${n} multi-document PDF(s) before processing`);
        } catch (e) {
          logger?.warn(`[separation] pre-pass failed (continuing without split): ${e.message}`);
        }
      }
    }

    // Stop pressed DURING the pre-pass → bail before spawning processing workers,
    // otherwise the worker would launch and "Stopping…" would hang until it finished.
    if (_cancelRequested) {
      _cancelRequested = false;
      _currentBatchProcs = [];
      cleanupFiles(tempFiles);
      cleanupFiles(shardFiles);
      mirror(event.sender, 'process-progress', { type: 'log', text: 'Stopped before processing.', level: 'warn' });
      return { success: true, stopped: true };
    }

    // Build the worker set. concurrency<=1 keeps the EXACT original path (one
    // worker scans the folder; its own start/total flows straight through).
    let workerPromises;
    let batchTotal = 0;              // # files to import (for the Review activity bar; 0 = unknown)
    if (concurrency <= 1) {
      logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=1`);
      workerPromises = [runWorker(null, false)];
    } else {
      let allFiles = [];
      try {
        allFiles = fs.readdirSync(folderPath, { withFileTypes: true })
          .filter(e => e.isFile() && BATCH_SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase()))
          .map(e => e.name)
          .sort();
      } catch (e) {
        logger?.warn(`Could not enumerate folder for parallel split: ${e.message}`);
      }
      if (allFiles.length <= 1) {
        // Nothing to parallelize — fall back to the single-worker path.
        logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=1 (only ${allFiles.length} file)`);
        workerPromises = [runWorker(null, false)];
      } else {
        batchTotal = allFiles.length;
        const shards = partitionRoundRobin(allFiles, Math.min(concurrency, allFiles.length));
        logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=${concurrency} → ${shards.length} workers, ${allFiles.length} files`);
        // Per-worker thread cap = cores / workers, so the pool never oversubscribes the
        // CPU. Caps Tesseract's OpenMP threads (via OMP_THREAD_LIMIT in runWorker —
        // previously UNCAPPED and the cause of N×cores thread thrash). Single-worker path
        // passes 0 (no cap → use all cores).
        const threadCap = Math.max(1, Math.floor((os.cpus().length || 1) / shards.length));
        // One aggregate start for the whole batch; per-worker starts suppressed.
        mirror(event.sender, 'process-progress', { type: 'start', total: allFiles.length });
        workerPromises = shards.map(shard => {
          const f = writeTempJson('files', shard);
          shardFiles.push(f);
          return runWorker(f, true, threadCap);
        });
      }
    }

    // Signal Review an import is running (reprocess paused) — placed AFTER worker setup so a setup
    // throw can't leave the bar stuck; the workers resolve (never reject), so _endActivity always fires.
    _beginActivity('import', batchTotal);
    const codes   = await Promise.all(workerPromises);
    const stopped = _cancelRequested;
    _cancelRequested   = false;
    _currentBatchProcs = [];
    _endActivity('import');   // import finished — clear the Review activity bar + re-enable reprocess
    // Wait for every deferred per-file IO (async working-copy/rotate/drain/auto-file)
    // to finish so their drains are queued/attempted, THEN flush — the workers have
    // exited, so the source PDFs are unlocked and the moves into Processed/ now succeed.
    await Promise.allSettled(pendingFileIo.splice(0));
    _flushPendingDrains(db, logger);
    // Truthful post-run line (Chris r5 card 2): originals move at IMPORT, and the emptied
    // source folder then looked like a mistake ("No documents found directly in this
    // folder…"). Say what actually happened, once, where the run's log lines render.
    {
      const _drained = _takeDrainTally(folderPath);   // THIS folder's drains only (Oracle C1)
      if (_drained > 0) {
        mirror(event.sender, 'process-progress', {
          type: 'log',
          text: `✓ ${_drained} original scan${_drained === 1 ? '' : 's'} moved out of the source folder — Scan Finder now works from its own copies.`,
        });
      }
    }
    cleanupFiles(tempFiles);
    cleanupFiles(shardFiles);
    // Remove any *_ocr.txt plaintext artifacts left by earlier versions of the
    // pipeline that wrote raw OCR text to the source folder as an audit file.
    // The current pipeline no longer creates these; this sweep cleans up
    // residual files from prior runs so none linger in user-visible paths.
    try {
      for (const entry of fs.readdirSync(folderPath)) {
        if (entry.endsWith('_ocr.txt')) {
          try { fs.unlinkSync(path.join(folderPath, entry)); } catch {}
        }
      }
    } catch {}
    // Tidy the holding area after each batch (dead/confirmed copies + .part debris)
    // and refresh the stuck-doc count for the launchpad surface.
    runHoldingReconcile(db, logger);
    try {
      notifyMainWindow?.('stuck-count-changed',
        require('../../../database/modules/documents').getStuckCount(db));
    } catch {}
    const success = !stopped && codes.every(c => c === 0);
    logger?.log(`Batch ${stopped ? 'stopped' : 'complete'}: ${fileCount} files, exit=${codes.join(',')}`);
    return { success, stopped };
  });

  // ── Stuck (failed) documents — the launchpad "couldn't be read" surface ──────
  // SECURITY (Stage 2 — M13): require a signed-in session. get-stuck-docs returns document ROWS
  // (filenames, which routinely carry supplier + reference numbers), so it was an unauthenticated
  // metadata-disclosure surface; gate all four launchpad reads to any logged-in user. The "Try
  // again" action reuses the role-gated reprocess-document IPC below.
  ipcMain.handle('get-processing-activity', () => { requireLogin(); return _activity
    ? { active: true, source: _activity.source, done: _activity.done, total: _activity.total }
    : { active: false }; });

  ipcMain.handle('get-concurrency-info', () => { requireLogin(); return {
    cores: os.cpus().length || 1,
    maxConcurrency: maxConcurrency(),
    recommended: defaultConcurrency(),
  }; });

  ipcMain.handle('get-stuck-count', () => { requireLogin();
    return require('../../../database/modules/documents').getStuckCount(getDb()); });
  ipcMain.handle('get-stuck-docs', () => { requireLogin();
    return require('../../../database/modules/documents').getStuckQueue(getDb()); });

  // ── Reprocess single document ───────────────────────────────────────────────
  // Merge a fresh reprocess result into a document's stored extractions + identity,
  // then persist. Shared by single-doc reprocess AND batched Reprocess All (one
  // process_docs spawn → many file_done events, each applied here by docId). The
  // freshly-recomputed value WINS whenever present; a prior value is preserved only
  // when the new run found nothing for that field, and a field the new run didn't
  // return at all is kept (so reprocess never silently drops a good first-pass read).
  function applyReprocessResult(db, docId, existing, result, filename, diagOn) {
    const newRows = Object.entries(result.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
      validation_note:   data.validation_note || null,
      corrected_to:      data.corrected_to || null,
      anchor_label:      data.anchor || null,
      candidates:        data.candidates ? JSON.stringify(data.candidates) : null,   // disambiguation picker
      suggested_supplier: data.suggested_supplier || null,   // branding cross-check → "Use '<name>'" button
    }));

    const _emitMerge = (field, decision, oldV, newV) => {
      if (!traceWanted(diagOn)) return;
      routeTrace({ type: 'trace', doc: filename, event: 'reprocess_merge',
                   field, decision, old: oldV ?? null, new: newV ?? null });
    };

    // Resolve the reprocessed doc type BEFORE merging: a reprocess that CHANGES the
    // doc's type (the machine-authority title override in process_docs, or a live
    // template match resolving differently) must (a) DROP carried-forward rows from
    // the OLD type's field set — Review hides them (it renders only the current
    // type's fields) but the trust gate / auto-file still READ them — and (b) plant
    // an explanation note so the flip lands in Review and can never silently
    // auto-file (isAutoFileEligible refuses any doc carrying a validation_note).
    // Oracle conditions 3+4, 2026-07-09. Type unchanged → merge byte-identical.
    const _prior = db.prepare('SELECT document_type_id FROM documents WHERE id = ?').get(docId);
    const priorTypeId = _prior ? _prior.document_type_id : null;
    let reprocDocTypeId = null, reprocType = null;
    // Re-derived on EVERY reprocess, both directions (mig 51). Go-forward: a doc whose fresh
    // detection names an uninstalled type gets the stamp; a doc that NOW resolves to a real type
    // gets it CLEARED. The clear is what stops a stale suggestion outliving the type being added.
    let reprocDetectedName = null;
    if (result.document_type) {
      const docTypesMod = require('../../../database/modules/document_types');
      reprocType = docTypesMod.getAllWithFields(db).find(
        dt => dt.name.toLowerCase() === result.document_type.toLowerCase()
      ) || null;
      if (reprocType) reprocDocTypeId = reprocType.id;
      reprocDetectedName = _resolveDetectedType(db, result.document_type).unmatchedName;
    }
    let flip = null;
    if (reprocDocTypeId != null && priorTypeId != null && reprocDocTypeId !== priorTypeId) {
      const _old = db.prepare('SELECT name FROM document_types WHERE id = ?').get(priorTypeId);
      const oldName = (_old && _old.name) || 'previous type';
      flip = {
        newTypeKeys: new Set((reprocType.fields || []).map(f => f.key)),
        refKey:      reprocType.ref_field_key || null,
        noteText:    `Document type changed from '${oldName}' to '${reprocType.name}' on reprocess — please check the fields.`,
      };
      if (logger) logger.log(`Reprocess TYPE CHANGE: ${filename} '${oldName}' -> '${reprocType.name}'`
        + (result.type_overridden ? " (machine-assigned type overridden by the doc's own title)" : ''));
      if (traceWanted(diagOn)) {
        routeTrace({ type: 'trace', doc: filename, event: 'reprocess_type_change',
                     from: oldName, to: reprocType.name, overridden: !!result.type_overridden });
      }
    }

    // Generic fallback on reprocess (Oracle C1, direction-guarded — never drags a typed
    // doc): only a NULL-type doc whose fresh detection is ALSO None adopts the generic id.
    // Not a "flip" (priorTypeId is null), so no flip note — the trust refusal keeps it
    // review-bound regardless.
    if (reprocDocTypeId == null) {
      const gid = _reprocessGenericAdopt(db, priorTypeId, result.document_type || null);
      if (gid) reprocDocTypeId = gid;
    }

    const mergedRows = mergeReprocessRows(existing, newRows, flip, _emitMerge);

    const learning = require('../../../database/modules/learning');
    learning.deleteExtractions(db, docId);
    learning.insertExtractions(db, docId, mergedRows);

    const _supBlanked = supplierColumnBlanked(mergedRows);
    db.prepare(
      `UPDATE documents SET
         overall_confidence  = ?,
         status              = 'needs_review',
         document_type_id    = COALESCE(?, document_type_id),
         template_id         = ?,
         logo_phash          = ?,
         logo_detail_hash    = ?,
         keyword_fingerprint = ?,
         supplier_name       = CASE WHEN ? THEN NULL ELSE COALESCE(?, supplier_name) END,
         ocr_text            = COALESCE(?, ocr_text),
         detected_type_name  = ?,
         review_acknowledged_at = NULL
       WHERE id = ?`
    ).run(
      result.overall_confidence || null,
      reprocDocTypeId,
      result.template_id        || null,
      result.logo_phash         || null,
      result.logo_detail_hash   || null,
      result.keyword_fingerprint ? JSON.stringify(result.keyword_fingerprint) : null,
      _supBlanked ? 1 : 0,
      result.supplier_name      || null,
      result.ocr_text           || null,
      // Plain assignment, NOT COALESCE: null must actually CLEAR the stamp. COALESCE here would
      // make the suggestion permanent — it would survive the very act of adding the type.
      reprocDetectedName,
      docId
    );

    const mergedMap = {};
    for (const r of mergedRows) mergedMap[r.field_key] = { value: r.display_value, confidence: r.confidence };

    if (logger) {
      logger.log(`Reprocess done: ${filename}`);
      for (const r of mergedRows) {
        if (r.display_value) logger.log(`  FOUND   ${r.field_key}: ${JSON.stringify(r.display_value)} (${r.confidence}% via ${r.extraction_method || '?'})`);
        else                 logger.log(`  MISSED  ${r.field_key}`);
      }
    }

    return { extractions: mergedMap, overall_confidence: result.overall_confidence };
  }

  ipcMain.handle('reprocess-document', async (event, { docId, folderPath, filename, enhanceParams, deskewOnce, forcedTypeSlug }) => {
    const sess    = requireRole('admin', 'edit');
    const db      = getDb();
    // Multi-point licensing enforcement (F-01): reprocess re-runs the extraction
    // pipeline — same network-free cached-license re-check as bulk import.
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to reprocess documents. Please re-activate ScanFinder.', ...licenseDenial };
    // Serialise heavy work: refuse if a batch (import / reprocess-all) OR another single reprocess
    // is already running — running both at once oversubscribes the CPU and can race two merges into
    // the same document, which presents as the app freezing.
    if (_anyProcessingBusy()) {
      return { success: false, busy: true, error: 'A reprocess is already running — please wait for it to finish.' };
    }
    // WORKFLOW_LOCK (Slice 1 Stage E): a document under an OPEN approval route must not be
    // rewritten beneath its approver — the same rule confirm/defer/delete already enforce
    // (review/handler requireUnlocked). Admin may override, audited (the same seam). Sits
    // BEFORE the success audit below so a refusal never records outcome 'success'. Inert
    // wherever no routes exist (every current install — the feature is dark).
    {
      const guard = require('../../services/workflowService').editGuard(db, docId, sess.role);
      if (!guard.ok) return { success: false, error: guard.error, code: guard.code };
      if (guard.overridden) {
        logAudit(db, { action: 'workflow_lock_overridden', action_category: 'workflow',
          target_type: 'document', target_id: docId, document_id: docId, outcome: 'success',
          metadata: { action: 'reprocess' } });
      }
    }
    logAudit(db, { action: 'reprocess', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', metadata: { enhanced: !!enhanceParams } });
    // Resolve the source file with the SAME robust recovery the PREVIEW uses
    // (previewService._resolveDocFile): app working copy → filed stored_path →
    // any surviving sibling copy of the same document. The previous inline chain
    // (working_path → confirmed stored_path → folderPath/filename) gave up the
    // moment folder_path had gone stale — e.g. an auto-filed doc whose original
    // was drained into a nested `Processed\Processed` — and reported "File not
    // found" on a doc the preview could still render. Using one resolver keeps
    // reprocess able to find the file exactly wherever the preview can show it.
    const previewService = require('../../services/previewService');
    // SECURITY (Stage 1 — H3 class, Oracle C1): resolve the on-disk location SERVER-SIDE from the doc
    // row BEFORE handing it to the shared resolver. The client-supplied folderPath/filename are NOT
    // trusted — via _resolveDocFile's sourcePath fallback (previewService.js) a compromised renderer
    // could otherwise point reprocess's existsSync/copyFileSync at a UNC host (outbound SMB/NTLM) or any
    // readable file, which reprocess would then OCR into the doc's own fields. `confirm` nulls
    // working_path on filing, so for a confirmed/auto-filed doc the resolver would fall straight to the
    // renderer path. Mirrors get-document-pages (review/handler.js); the resolver still prefers the
    // working copy and recovers a moved source from the row.
    const _row = db.prepare(
      'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(docId);
    const _pick = _row ? (_row.working_path || _row.stored_path
      || (_row.folder_path && _row.original_filename ? path.join(_row.folder_path, _row.original_filename) : null)) : null;
    const _rFolder = _pick ? path.dirname(_pick) : null;
    const _rFile   = _pick ? path.basename(_pick) : null;
    if (!_rFolder || !_rFile) {
      return { success: false, error: 'File not found for this document.' };
    }
    const srcFile = previewService.resolveDocFile(
      db, { docId, folderPath: _rFolder, filename: _rFile }, { fs, path, log: (m) => logger?.log?.(m) }
    );
    if (!srcFile || !fs.existsSync(srcFile)) {
      return { success: false, error: 'File not found: ' + (srcFile || path.join(_rFolder, _rFile)) };
    }

    // Snapshot existing extractions
    const existing = db.prepare(
      'SELECT * FROM extractions WHERE document_id = ?'
    ).all(docId);

    // Copy to temp dir with unique name (extension from the RESOLVED source, not the renderer arg)
    const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-'));
    const ext         = path.extname(srcFile);
    const tmpFilename = `reprocess_${Date.now()}${ext}`;
    fs.copyFileSync(srcFile, path.join(tmpDir, tmpFilename));

    const diagOn = _diagEnabled(db);
    if (diagOn) { diaglog.enable(); diaglog.write({ ev: 'reprocess_start', filename, doc_id: docId }); }
    const { args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath, logger);
    const learning2  = require('../../../database/modules/learning');
    const templates2 = require('../../../database/modules/templates');
    const reprMode   = _validMode(learning2.getSetting(db, 'processing_mode', 'smart'));

    // Resolve the OCR preprocessing params to actually use:
    //  - manual params (sent only while OCR Preview is active for this
    //    document, see review/renderer.js) are a one-shot override for THIS
    //    reprocess and — if the document has a known template — become that
    //    template's learned auto-processing baseline going forward;
    //  - otherwise, fall back to the matched template's own learned baseline
    //    (if any and enabled), so recurring templates benefit automatically
    //    even when preview is off.
    const docRow     = db.prepare('SELECT template_id FROM documents WHERE id = ?').get(docId);
    const templateId = docRow ? docRow.template_id : null;
    let effectiveEnhanceParams = null;
    let ruleCreatedFor          = null;
    if (enhanceParams && typeof enhanceParams === 'object') {
      effectiveEnhanceParams = enhanceParams;
      // A one-shot "Straighten + Reprocess" must NEVER become the template's permanent OCR
      // baseline — deskew is a per-doc recovery, not a learned enhance. So skip setOcrAutoParams
      // when deskewOnce (the enhance still applies to THIS reprocess via --enhance-file below).
      if (templateId && !deskewOnce) {
        const updated = templates2.setOcrAutoParams(db, templateId, enhanceParams);
        ruleCreatedFor = updated ? updated.name : null;
      }
    } else if (templateId) {
      const tmpl = templates2.getById(db, templateId);
      if (tmpl && tmpl.ocr_auto_enabled && tmpl.ocr_auto_params) {
        effectiveEnhanceParams = tmpl.ocr_auto_params;
      }
    }

    const scriptArgs    = [
      '--folder',     tmpDir,
      '--tesseract',  tesseractPath(),
      '--mode',       reprMode,
      ...trainingArgs,
    ];
    // Doc-TYPE args (pure decision in resolveReprocessTypeArgs). Default: pin the doc's ALREADY-ASSIGNED
    // type as document_slug (so the format/qualification gates stay armed even on a clipped scan whose
    // identifying band is cut off), mark it 'machine' authority ONLY when never human-confirmed (a trusted
    // contradicting title may then re-type it), and pass the linked template as a Stage-0 mapping fallback.
    // OVERRIDE: an operator's explicit dropdown pick (forcedTypeSlug, sent only when it DIFFERS from the
    // doc's current type) forces that type as HUMAN authority — no machine title re-type / no snap-back —
    // and suppresses the linked (rejected-type) template; the engine's live re-match recovers the
    // correct-type template. Byte-identical when forcedTypeSlug is null.
    const { resolveReprocessTypeArgs } = require('./reprocessTypeArgs');
    let _knownSlugs = null;
    try { _knownSlugs = new Set(db.prepare('SELECT slug FROM document_types WHERE slug IS NOT NULL').all().map(r => r.slug)); } catch {}
    let _dtRow = null;
    try {
      _dtRow = db.prepare(
        `SELECT dt.slug AS slug, d.status AS status, d.confirmed_at AS confirmed_at
         FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
         WHERE d.id = ?`).get(docId);
    } catch {}
    const _typeArgs = resolveReprocessTypeArgs({
      storedSlug:  _dtRow ? _dtRow.slug : null,
      status:      _dtRow ? _dtRow.status : null,
      confirmedAt: _dtRow ? _dtRow.confirmed_at : null,
      forcedTypeSlug, templateId, knownSlugs: _knownSlugs,
    });
    // Operator supplier PIN (Part B) + B2 re-scope (Oracle C1): read the doc's pin; when it DIFFERS from
    // the doc's current supplier, the linked template + assigned type belong to the OLD (wrong) supplier
    // — SUPPRESS them so the engine re-detects the type and re-matches the template for the pinned
    // supplier. Kill switch SUPPLIER_PIN; off → byte-identical (pin ignored, type args pushed as before).
    let _supplierPin = null, _pinDiffers = false;
    try {
      const _sr = db.prepare('SELECT supplier_pin, supplier_name FROM documents WHERE id = ?').get(docId);
      _supplierPin = _sr && _sr.supplier_pin ? String(_sr.supplier_pin).trim() : null;
      _pinDiffers = !!_supplierPin
        && _supplierPin.toLowerCase() !== String((_sr && _sr.supplier_name) || '').trim().toLowerCase();
    } catch {}
    const _pinOn = !!_supplierPin && process.env.SUPPLIER_PIN !== '0';
    const _suppressTypeForPin = _pinOn && _pinDiffers;   // B2: drop stale template/type on a supplier change
    if (_typeArgs.knownTemplateId && !_suppressTypeForPin) {
      scriptArgs.push('--known-template-id', String(_typeArgs.knownTemplateId));
    }
    if (_typeArgs.knownDocSlug && !_suppressTypeForPin) {
      scriptArgs.push('--known-doc-slug', String(_typeArgs.knownDocSlug));
      if (_typeArgs.authority) scriptArgs.push('--known-doc-slug-authority', _typeArgs.authority);
    }
    if (_pinOn) scriptArgs.push('--known-supplier', _supplierPin);
    // Dev trace stream + OCR slice capture while the inspector is open OR
    // diagnostic logging is on (so the diagnostic file captures reprocess too).
    if (traceWanted(diagOn)) {
      scriptArgs.push('--trace');
      try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
    }
    // "Straighten + Reprocess": deskew each scanned page before OCR. The filed file is untouched;
    // the logo phash uses the raw frame (engine.extract raw_page0). Review-bound (reprocess never
    // auto-files). Re-OCRs fresh ONLY if the page is actually tilted past the floor (DESKEW×CACHE
    // fast path — a level page reuses the stored text); the cache is passed below regardless.
    if (deskewOnce) scriptArgs.push('--deskew-pages');

    const allTempFiles = [...tempFiles];
    if (effectiveEnhanceParams) {
      const enhanceFile = writeTempJson('enhance', effectiveEnhanceParams);
      allTempFiles.push(enhanceFile);
      scriptArgs.push('--enhance-file', enhanceFile);
    } else {
      // Reprocess optimisation: reuse this doc's already-stored full-page OCR text so
      // the ~1.9s/page full-page OCR is skipped (the pixels don't change on reprocess —
      // only the learned data — and per-field crop reads still re-run, so accuracy is
      // unchanged). ONLY when no manual/template ENHANCE is active (that would change
      // the read) and the stored text is non-empty. Written into tmpDir (cleaned with it).
      // PASSED EVEN ON deskewOnce now (DESKEW×CACHE fast path): extract_text_and_images detects skew
      // first and re-OCRs fresh straightened ONLY if this page is tilted past the floor; a level page
      // reuses the cache (its straighten is a no-op). Kill switch DESKEW_CACHE_FAST=0.
      try {
        const otRow = db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(docId);
        if (otRow && otRow.ocr_text && otRow.ocr_text.trim()) {
          const cachedFile = path.join(tmpDir, 'cached_ocr.txt');
          fs.writeFileSync(cachedFile, otRow.ocr_text, 'utf8');
          scriptArgs.push('--cached-ocr-file', cachedFile);
        }
      } catch { /* fall back to full OCR */ }
    }

    _singleReprocessActive = true;   // mark busy now we're committed to spawning (cleared in finish())
    return new Promise((resolve) => {
      const py   = pythonExe();
      // Single-doc reprocess MAY use several cores (parallel full-page OCR = Option B; parallel
      // field reads = Option C) so ONE document finishes faster on a slow CPU. Output is
      // byte-identical (scheduling only) — see docs/designs/REPROCESS_PARALLELISM_BC_2026-07-17.md.
      // Gated by a setting, DEFAULT OFF; passed ONLY here on the single-reprocess spawn, NEVER the
      // batch/import/shard path (those already parallelise ACROSS docs with their own OMP cap, so
      // nesting a per-doc pool inside them would oversubscribe). The python side caps OMP to 1.
      let spawnEnv = { ...process.env, ..._ocrDpiEnv(db), ..._anchorCropEnv(db), ..._reconcileEnv(db) };   // ocr_dpi + crop + reconcile opt-ins on reprocess (all default = byte-identical)
      try {
        if (require('../../../database/modules/learning').getSetting(db, 'ocr_parallel_reprocess_enabled', 'false') === 'true') {
          // B = parallel full-page OCR passes (straighten/enhance/first-import); C = parallel per-field
          // crop reads (every reprocess). Both byte-identical, single-reprocess spawn only.
          spawnEnv = { ...spawnEnv, DS_OCR_PARALLEL_FULLPAGE: '1', DS_OCR_PARALLEL_FIELDS: '1' };
        }
      } catch { /* setting read failed → sequential (default) */ }
      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true, env: spawnEnv });
      let buf = '', result = null;
      let settled  = false;
      let watchdog = null;

      // Settle exactly once and clean temp artefacts no matter which event
      // fires (close / spawn error / watchdog). Without this a spawn failure or
      // a stalled Python worker would never resolve, deadlocking Reprocess and
      // Reprocess All until the app is restarted.
      const finish = (value) => {
        if (settled) return;
        settled = true;
        _singleReprocessActive = false;   // release the serialise lock
        if (watchdog) clearTimeout(watchdog);
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        cleanupFiles(allTempFiles);
        resolve(value);
      };

      // A single document should never take this long; if it does the worker
      // has hung. Kill its whole process tree (in dev py.exe launches a child
      // python.exe — proc.kill() alone leaves it alive) and fail this doc so the
      // caller's batch can continue rather than deadlocking on Promise.all.
      const REPROCESS_TIMEOUT_MS = 5 * 60 * 1000;
      watchdog = setTimeout(() => {
        logger?.err(`Reprocess timed out: ${filename}`);
        try {
          require('child_process').spawnSync(
            TASKKILL_EXE, ['/F', '/T', '/PID', String(proc.pid)],
            { windowsHide: true, stdio: 'ignore' }
          );
        } catch {}
        try { proc.kill(); } catch {}
        finish({ success: false, error: 'Reprocess timed out' });
      }, REPROCESS_TIMEOUT_MS);

      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'trace') { routeTrace(msg); continue; }
            if (msg.type === 'file_done') _recordDevDoc(msg);
            // Single-doc reprocess stays on event.sender (short, window-bound). NOTE the asymmetry:
            // Reprocess-ALL uses mirrorReprocess (the LIVE review window) so it survives close+reopen.
            // The two share the 'reprocess-progress' channel but the busy guard keeps them mutually
            // exclusive — don't naively "unify" them without handling concurrent addressing.
            mirror(event.sender, 'reprocess-progress', msg);
            if (msg.type === 'file_done') result = msg;
          } catch {
            mirror(event.sender, 'reprocess-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        const text = d.toString().trim();
        if (text) logger?.warn(`Reprocess stderr: ${text}`);
        mirror(event.sender, 'reprocess-progress', { type: 'log', text });
      });

      proc.on('error', (err) => {
        logger?.err(`Reprocess spawn error: ${filename} — ${err.message}`);
        finish({ success: false, error: err.message });
      });

      proc.on('close', () => {
        if (settled) return;          // error/timeout already settled it
        if (!result?.success || !result?.extractions) {
          logger?.err(`Reprocess failed: ${filename} — no data returned`);
          return finish({ success: false, error: 'No data returned' });
        }

        const applied = applyReprocessResult(db, docId, existing, result, filename, diagOn);
        finish({ success: true, ...applied, ruleCreated: ruleCreatedFor });
      });
    });
  });

  // ── Fast on-open text-only re-extract (Slice B, DARK) ───────────────────────
  // Refresh a document's EMPTY fields from its already-cached full-page OCR WITHOUT a full
  // reprocess — skips the full-page OCR (cached) AND the per-field crop OCR AND all image
  // rendering (`--reextract`, process_docs.py). Read-only: returns fill-only SUGGESTIONS,
  // writes NOTHING to the DB (persist happens on the operator's confirm). No renderer trigger
  // yet — nothing invokes this channel until Slice B-2 wires _selectDoc, so it is inert.
  // Oracle conditions honoured: C1 known-id honour (imageless → the engine applies the known
  // template text-only), C4 (suggestion, no phantom human-correction), C6 (anchor-abstain,
  // no 2nd auto-file site, no type/status mutation — this path never writes).
  // ── Fast imageless re-extract CORE (Catch-up slice 2 refactor — byte-identical move) ──
  // The body of `reextract-fields-fast` hoisted into a callable so the scope sweep can run
  // it per candidate with buildTrainingArgs HOISTED ONCE (opts.trainingArgs). Behaviour is
  // the IPC's, unchanged; the caller owns role/enable/license/busy gating. ZERO DB WRITES —
  // temp files under os.tmpdir only. When opts.trainingArgs is provided the caller owns its
  // temp-file cleanup; otherwise the core builds and cleans its own.
  async function _reextractFastCore(db, docId, opts = {}) {
    const learning  = require('../../../database/modules/learning');
    const templates = require('../../../database/modules/templates');

    const doc = db.prepare(`
      SELECT d.id, d.ocr_text, d.template_id, d.supplier_name, d.original_filename,
             d.logo_phash, d.logo_detail_hash, dt.slug AS document_type_slug
        FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.id = ?`).get(docId);
    if (!doc) return { ok: false, reason: 'no-doc' };
    // Cached OCR is the whole premise — no cache, no fast path (fall back to a real reprocess).
    if (!doc.ocr_text || !doc.ocr_text.trim()) return { ok: false, reason: 'no-cache' };

    // Known template: the doc's own link, else a NOW-available same-type template (the
    // "newly-found template" gain case) via the SAME type-scoped fingerprint recheck the
    // Teach-this-document CTA uses. Null is fine — a text-only re-extract still re-reads
    // keyword fields from the cached OCR.
    // STALE-COLLISION UNPIN (owner + bob 2026-08-01; kill REEXTRACT_UNPIN_BLANK_SUPPLIER=0):
    // a stored template link with NO resolved supplier is the branding-blank collision class
    // — the veto blanked a wrong fixed-name stamp (doc 218: a Vellum doc pinned to the
    // Ridgeway template). Re-pinning that template re-runs the identical collision, so the
    // stale stored id must never be honoured for this class.
    // BLANK RE-IDENTIFY (owner 2026-08-01 evening; kill REEXTRACT_BLANK_REIDENTIFY=0): the
    // unpin's original "let the engine's Stage-0 choose" expectation was DEAD imageless —
    // the engine deliberately SKIPS live Stage-0 with no page image (Oracle C1: the text
    // arms lack the logo-guard family), so an unpinned blank-supplier doc could never gain
    // a supplier from the fast path at all (measured: Saltmarsh doc 400, 18-doc batch,
    // zero suggestions with the sibling template present). Fix at the CALLER, with the
    // guarded JS identifier this same path already trusts for non-blank docs
    // (identifyByFingerprint: detail-hash veto + name-presence veto on BOTH arms,
    // type-scoped): re-identify, and admit the pick as known-id ONLY when it differs from
    // the stale stored link — a DIFFERENT pick is new information (a sibling template born
    // since the collision, e.g. the operator just confirmed one of the batch); the SAME id
    // is the collision re-arriving and stays unpinned. The engine's known-id honour path is
    // the already-sanctioned imageless route (suggestion-only downstream: fill-only merge +
    // operator confirm; reextract never auto-files).
    const _unpinBlank = process.env.REEXTRACT_UNPIN_BLANK_SUPPLIER !== '0'
      && !String(doc.supplier_name || '').trim();
    let knownTemplateId = _unpinBlank ? null : (doc.template_id || null);
    if (!knownTemplateId && (!_unpinBlank || process.env.REEXTRACT_BLANK_REIDENTIFY !== '0')) {
      try {
        const m = templates.identifyByFingerprint(db, {
          logo_phash: doc.logo_phash, ocr_text: doc.ocr_text,
          document_type_slug: doc.document_type_slug, logo_detail_hash: doc.logo_detail_hash,
        });
        if (m && admitReextractPick(_unpinBlank, doc.template_id, m.template.id)) {
          knownTemplateId = m.template.id;
        }
      } catch { /* no match → keyword-only re-extract */ }
    }

    const existing = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId);

    // reextract NEVER reads the file bytes (process_docs.py:492) — so we do NOT resolve/copy
    // the (possibly missing) source. A zero-byte placeholder with the right extension is all
    // the folder-enumeration needs; this also works for a filed doc whose working copy was nulled.
    const ext    = (doc.original_filename && path.extname(doc.original_filename)) || '.pdf';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-rx-'));
    const cachedFile = path.join(tmpDir, 'cached_ocr.txt');
    // Sweep callers pass HOISTED trainingArgs (built once per sweep) and own their cleanup;
    // the solo path builds + cleans its own — byte-identical to the pre-refactor IPC body.
    const _hoisted = Array.isArray(opts.trainingArgs);
    let trainingArgs = _hoisted ? opts.trainingArgs : [], tempFiles = [];
    try {
      fs.writeFileSync(path.join(tmpDir, `reextract_${Date.now()}${ext}`), '');
      fs.writeFileSync(cachedFile, doc.ocr_text, 'utf8');
      if (!_hoisted) ({ args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath, logger));
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      return { ok: false, reason: 'setup' };
    }

    const reprMode = _validMode(learning.getSetting(db, 'processing_mode', 'smart'));
    const scriptArgs = [
      '--folder',        tmpDir,
      '--tesseract',     tesseractPath(),
      '--mode',          reprMode,
      ...trainingArgs,
      '--reextract',
      '--cached-ocr-file', cachedFile,
    ];
    if (knownTemplateId)        scriptArgs.push('--known-template-id', String(knownTemplateId));
    if (doc.document_type_slug) scriptArgs.push('--known-doc-slug', doc.document_type_slug);   // honour the doc's own type

    return new Promise((resolve) => {
      let settled = false, watchdog = null, proc = null;
      const finish = (v) => {
        if (settled) return; settled = true;
        if (watchdog) clearTimeout(watchdog);
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        cleanupFiles(tempFiles);
        resolve(v);
      };
      try {
        proc = spawn(pythonExe(), pythonArgs(backendScript(), ...scriptArgs),
          { windowsHide: true, env: { ...process.env, ..._ocrDpiEnv(db) } });
      } catch (e) { return finish({ ok: false, reason: 'spawn' }); }

      // Imageless + cached → seconds at most; a short watchdog keeps a hung child from leaking.
      watchdog = setTimeout(() => { try { proc.kill(); } catch {} finish({ ok: false, reason: 'timeout' }); }, 60 * 1000);

      let buf = '', result = null;
      proc.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          try { const msg = JSON.parse(t); if (msg.type === 'file_done') result = msg; } catch { /* non-JSON log line */ }
        }
      });
      proc.on('error', () => finish({ ok: false, reason: 'spawn' }));
      proc.on('close', () => {
        if (!result || !result.extractions) return finish({ ok: false, reason: 'no-result' });
        let anchoredKeys = new Set();
        try {
          anchoredKeys = new Set(learning.getTaughtFieldKeys(db, {
            supplier_name: doc.supplier_name || result.supplier_name || '',
            document_type: doc.document_type_slug || null,
          }).map(r => r.field_key));
        } catch { /* no anchors → none abstained */ }
        const suggestions = mergeReextractRows(existing, result.extractions, anchoredKeys,
          { brandingBlankSupplier: process.env.REEXTRACT_UNPIN_BLANK_SUPPLIER !== '0' });
        // `result`/`doc`/`existing` ride along for the scope sweep's consistency predicate;
        // the reextract-fields-fast IPC return shape below is built from the same fields it
        // always returned (byte-identical to the pre-refactor channel).
        finish({ ok: true, docId, suggestions, templateId: knownTemplateId || null,
                 result, doc, existing });
      });
    });
  }

  ipcMain.handle('reextract-fields-fast', async (_event, { docId } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    // DARK by default (Slice B). The whole fast path is inert unless EXPLICITLY enabled —
    // setting `reextract_fast_enabled` = 'true', OR env REEXTRACT_TEXT_ONLY=1. OFF → the
    // channel returns 'disabled' and nothing spawns, so wiring a renderer trigger (B-2) can
    // never go live by accident. Byte-identical to the feature not existing.
    const _fastOn = process.env.REEXTRACT_TEXT_ONLY === '1'
      || require('../../../database/modules/learning').getSetting(db, 'reextract_fast_enabled', 'false') === 'true';
    if (!_fastOn) return { ok: false, reason: 'disabled' };
    // Same network-free cached-license re-check as reprocess (this re-runs the engine).
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { ok: false, reason: 'license' };
    // Never add load while a batch / single reprocess is running (shares the CPU + busy model).
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };
    const r = await _reextractFastCore(db, docId);
    return r.ok ? { ok: true, docId, suggestions: r.suggestions, templateId: r.templateId }
                : { ok: false, reason: r.reason };
  });

  // ── Catch-up Filing slice 2: scope-sweep candidate evaluation (READ-ONLY) ──────────
  // docs/designs/CATCHUP_FILING_2026-07-31.md. After same-scope confirms, re-ask the NORMAL
  // auto-file trust gate on fresher data for the scope's still-queued docs. Tier 1: the stored
  // rows pass trust.isAutoFileEligible NOW (scopeTrust is live — "stored 96, floor just
  // graduated to 95" qualifies with zero machinery). Tier 2: fast imageless re-extract of the
  // SAME stored ocr_text, then the pure consistency predicate (sweepPredicate.js — values the
  // operator can SEE unchanged, both sides note-free) + isAutoFileEligible re-asked on the
  // fresh-confidence overlay. NOTHING IS PERSISTED — evaluation only; the accept path is
  // slice 3 (unbuilt). Kill: setting `scope_sweep_enabled` default OFF + env SCOPE_SWEEP=0
  // hard-off / =1 force-on (test harnesses); OFF ⇒ {ok:false, reason:'disabled'}, zero spawns.
  // Framing (Oracle): Tier 2 is a warmer-learning CONSISTENCY check on the same stored text,
  // never corroboration or a re-read of the page.
  ipcMain.handle('sweep-scope-candidates', async (_event, { supplier, typeSlug } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (process.env.SCOPE_SWEEP === '0') return { ok: false, reason: 'disabled' };
    const _sweepOn = process.env.SCOPE_SWEEP === '1'
      || require('../../../database/modules/learning').getSetting(db, 'scope_sweep_enabled', 'false') === 'true';
    if (!_sweepOn) return { ok: false, reason: 'disabled' };
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { ok: false, reason: 'license' };
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };
    const sup = String(supplier || '').trim();
    const slug = String(typeSlug || '').toLowerCase().trim();
    if (!sup || !slug) return { ok: false, reason: 'bad-scope' };

    const trust = require('../../../database/modules/trust');
    const { evaluateSweepConsistency, extractionsFingerprint } = require('../../services/sweepPredicate');
    const presence = require('../../services/presenceService').shared();

    const dtRow = db.prepare('SELECT * FROM document_types WHERE LOWER(slug) = ?').get(slug);
    if (!dtRow) return { ok: false, reason: 'unknown-type' };
    const roleKeys = new Set(['supplier_name', dtRow.ref_field_key, dtRow.date_field_key].filter(Boolean));

    // Candidates: still-queued docs of the scope, no workflow lock, capped (~25 by design).
    const SWEEP_CAP = 25;
    const docs = db.prepare(`
      SELECT d.* FROM documents d
       WHERE d.status = 'needs_review' AND d.document_type_id = ?
         AND LOWER(TRIM(d.supplier_name)) = LOWER(TRIM(?))
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
       ORDER BY d.id LIMIT ?`).all(dtRow.id, sup, SWEEP_CAP);

    const candidates = [], excluded = [];
    let aborted = false;
    const ctx = { trainingArgs: null, tempFiles: [] };
    try {
      for (const doc of docs) {
        // A batch/import starting mid-sweep aborts the remainder (never compete for CPU).
        if (_anyProcessingBusy()) { aborted = true; break; }
        const v = await _evaluateSweepDoc(db, doc, roleKeys, ctx);
        if (v.candidate) candidates.push(v.candidate);
        else excluded.push(v.excluded);
      }
    } finally {
      cleanupFiles(ctx.tempFiles);
    }
    // Consent-trail (design audit): an OFFER only exists at the renderer's ≥2 threshold — log it
    // here (server-side, same threshold) so the consent flow is reconstructable end-to-end.
    if (candidates.length >= 2) {
      try {
        logAudit(db, { action: 'scope_sweep_offered', target_type: 'scope', outcome: 'offered',
          metadata: { supplier: sup, type_slug: slug,
                      doc_ids: candidates.map(c => c.docId).join(','),
                      tiers: candidates.map(c => c.tier).join(',') } });
      } catch { /* audit is best-effort */ }
    }
    return { ok: true, scope: { supplier: sup, typeSlug: slug }, aborted,
             candidates, excluded, evaluated: candidates.length + excluded.length };
  });

  // One doc's sweep evaluation (candidates IPC + the accept path's server-side RE-CHECK share
  // this — the design's "accept re-runs the gate server-side" is literally the same code).
  // ctx carries hoisted trainingArgs/tempFiles across a loop; caller owns cleanupFiles.
  async function _evaluateSweepDoc(db, doc, roleKeys, ctx) {
    const trust = require('../../../database/modules/trust');
    const { evaluateSweepConsistency, extractionsFingerprint } = require('../../services/sweepPredicate');
    const presence = require('../../services/presenceService').shared();
    if (presence.viewers(doc.id).length) return { excluded: { docId: doc.id, reason: 'being-viewed' } };
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(doc.id);
    const fingerprint = extractionsFingerprint(rows);

    // Tier 1 — stored rows pass the live gate as-is.
    const t1 = trust.isAutoFileEligible(db, doc);
    if (t1.eligible) return { candidate: { docId: doc.id, tier: 1, fingerprint } };

    // Tier 2 — imageless re-extract consistency + the gate re-asked on the overlay.
    if (!ctx.trainingArgs) {
      const built = buildTrainingArgs(db, configPath, logger);
      ctx.trainingArgs = built.args; ctx.tempFiles = built.tempFiles;
    }
    const r = await _reextractFastCore(db, doc.id, { trainingArgs: ctx.trainingArgs });
    if (!r.ok) return { excluded: { docId: doc.id, reason: `recheck-${r.reason}` } };
    // Type pinned via --known-doc-slug: assert the echo matches (design: type flip = out).
    const freshTypeName = String(r.result.document_type || '');
    const storedTypeName = String(db.prepare('SELECT name FROM document_types WHERE id = ?').get(doc.document_type_id)?.name || '');
    const verdict = evaluateSweepConsistency({
      storedRows: rows,
      freshFields: r.result.extractions || {},
      roleKeys,
      storedSlug: storedTypeName,
      freshSlug: freshTypeName || storedTypeName,
    });
    if (!verdict.pass) return { excluded: { docId: doc.id, reason: verdict.reason, field: verdict.field } };
    const synth = { id: doc.id, document_type_id: doc.document_type_id,
                    supplier_name: doc.supplier_name,
                    overall_confidence: Number(r.result.overall_confidence) || 0 };
    const gate = trust.isAutoFileEligible(db, synth, {
      extractions: verdict.overlay,
      templateMatched: !!r.templateId,
    });
    if (gate.eligible) return { candidate: { docId: doc.id, tier: 2, fingerprint } };
    return { excluded: { docId: doc.id, reason: gate.reason } };
  }

  // ── Catch-up Filing slice 3: consent-gated ACCEPT (the only writer) ─────────────────
  // Renderer sends the accepted subset of a candidates result: [{docId, fingerprint}] +
  // untickedIds (audit only). Per doc, server-side: still queued/unlocked, the extraction
  // FINGERPRINT unchanged since candidacy (SEAM 2 — a pill fill / OCR-enhance / edit between
  // consent and accept drops the doc with a reason chip), the SAME evaluation re-run and
  // passing NOW, then reviewService.confirm (bulk) with the INTERNAL via='scope_sweep' —
  // confirmed_via is stamped server-side at claim; hint/template learning self-skip.
  // NO second auto-file site: filing goes through the one shared confirm.
  ipcMain.handle('sweep-scope-accept', async (_event, { supplier, typeSlug, accepts, untickedIds } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (process.env.SCOPE_SWEEP === '0') return { ok: false, reason: 'disabled' };
    const _sweepOn = process.env.SCOPE_SWEEP === '1'
      || require('../../../database/modules/learning').getSetting(db, 'scope_sweep_enabled', 'false') === 'true';
    if (!_sweepOn) return { ok: false, reason: 'disabled' };
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { ok: false, reason: 'license' };
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };
    const sup = String(supplier || '').trim();
    const slug = String(typeSlug || '').toLowerCase().trim();
    if (!sup || !slug || !Array.isArray(accepts) || !accepts.length) return { ok: false, reason: 'bad-args' };

    const documents = require('../../../database/modules/documents');
    const { extractionsFingerprint } = require('../../services/sweepPredicate');
    const reviewService = require('../review/handler').getReviewService();
    if (!reviewService) return { ok: false, reason: 'not-ready' };
    const actor = getCurrentUser() || {};
    const dtRow = db.prepare('SELECT * FROM document_types WHERE LOWER(slug) = ?').get(slug);
    if (!dtRow) return { ok: false, reason: 'unknown-type' };
    const roleKeys = new Set(['supplier_name', dtRow.ref_field_key, dtRow.date_field_key].filter(Boolean));

    const filed = [], dropped = [];
    const ctx = { trainingArgs: null, tempFiles: [] };
    try {
      for (const a of accepts.slice(0, 25)) {
        const docId = Number(a && a.docId);
        const doc = docId ? documents.getById(db, docId) : null;
        if (!doc || doc.status !== 'needs_review') { dropped.push({ docId, reason: 'not-queued' }); continue; }
        if (['pending', 'claimed'].includes(String(doc.workflow_status || ''))) { dropped.push({ docId, reason: 'workflow-locked' }); continue; }
        if (String(doc.supplier_name || '').trim().toLowerCase() !== sup.toLowerCase()
            || Number(doc.document_type_id) !== Number(dtRow.id)) { dropped.push({ docId, reason: 'scope-mismatch' }); continue; }
        // SEAM 2 — candidacy→accept mutation: any extraction change since the consent list drops it.
        const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId);
        if (extractionsFingerprint(rows) !== String(a.fingerprint || '')) { dropped.push({ docId, reason: 'changed' }); continue; }
        // Re-run the SAME evaluation — must still pass at accept time.
        const v = await _evaluateSweepDoc(db, doc, roleKeys, ctx);
        if (!v.candidate) { dropped.push({ docId, reason: (v.excluded && v.excluded.reason) || 'no-longer-eligible' }); continue; }
        // File through the one shared confirm — stored values verbatim, machine via.
        const allValues = {};
        for (const r of rows) allValues[r.field_key] = r.display_value ?? r.raw_value;
        let res;
        try {
          res = await reviewService.confirm(db, actor, {
            document_id: docId,
            allValues,
            corrections: {},
            taught_fields: [],
            supplier_name: doc.supplier_name,
            document_type: dtRow.name,
            document_type_slug: dtRow.slug,
            bulk: true,
          }, { via: 'scope_sweep' });
        } catch (e) { res = { ok: false, code: 'ERROR', error: e && e.message }; }
        if (res && res.ok) filed.push(docId);
        else dropped.push({ docId, reason: (res && res.code) || 'confirm-failed' });
      }
    } finally {
      cleanupFiles(ctx.tempFiles);
    }
    try {
      logAudit(db, { action: 'scope_sweep_accepted', target_type: 'scope', outcome: 'success',
        metadata: { supplier: sup, type_slug: slug, filed_ids: filed.join(','),
                    dropped: dropped.map(d => `${d.docId}:${d.reason}`).join(','),
                    unticked_ids: (Array.isArray(untickedIds) ? untickedIds : []).join(',') } });
    } catch { /* audit is best-effort */ }
    return { ok: true, filed, dropped };
  });

  // ── Catch-up Filing slice 3: Undo all (clean by construction) ───────────────────────
  // Only docs whose row says confirmed_via='scope_sweep' can be undone here (server-verified —
  // a human confirm can never be mass-reverted by this path). deconfirmDocument reverses the
  // live-derived learning by construction (formats/shapes/prefix recompute from confirmed
  // status) and the sweep skipped hints/template learning, so the undo copy is true. Filed
  // copies stay on disk; stored_path is kept, so a later re-confirm replaces IN PLACE.
  ipcMain.handle('sweep-scope-undo', (_event, { docIds } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const ids = (Array.isArray(docIds) ? docIds : []).map(Number).filter(Boolean).slice(0, 25);
    const undone = [], refused = [];
    for (const id of ids) {
      const row = db.prepare('SELECT id, status, confirmed_via FROM documents WHERE id = ?').get(id);
      if (!row || row.status !== 'confirmed' || row.confirmed_via !== 'scope_sweep') { refused.push(id); continue; }
      const r = documents.deconfirmDocument(db, id);
      if (r && r.changes) undone.push(id); else refused.push(id);
    }
    try {
      if (undone.length) logAudit(db, { action: 'scope_sweep_undone', target_type: 'scope', outcome: 'success',
        metadata: { doc_ids: undone.join(','), refused_ids: refused.join(',') } });
    } catch { /* audit is best-effort */ }
    try {
      notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
      notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    } catch { /* count broadcast is best-effort */ }
    return { ok: true, undone, refused };
  });

  // ── Reprocess All (batched) ───────────────────────────────────────────────
  // Reprocess many queued documents through a BOUNDED POOL of Python workers, each
  // handling a SHARD of docs in ONE process — so the Python/Tesseract startup cost is
  // paid once per worker, not once per document (the per-doc reprocess-document spawn
  // is what made a large Reprocess All "slow to start"). Accuracy is preserved: each
  // doc carries its OWN overrides (template / doc-slug / enhance) via the
  // --reprocess-manifest, exactly as single-doc reprocess passes them. All DB writes
  // stay on the single-threaded JS event loop (applyReprocessResult), so there is no
  // SQLite contention. Stop kills every worker tree (shared _currentBatchProcs).
  ipcMain.handle('reprocess-batch', async (event, docs, opts) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const deskewAll = !!(opts && opts.deskewAll);   // C3/C4: force a straightened READ for every doc in this batch (session "Straighten all")
    const deskewMinAngle = Math.max(0.2, Math.min(5.0, Number(opts && opts.deskewMinAngle) || 0.2));   // clamp the operator's floor (oscar: hard 0.2° min, 5° max)
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to reprocess documents. Please re-activate ScanFinder.', ...licenseDenial };
    // Serialise: refuse Reprocess All while a single reprocess (or another batch/import) is running —
    // running both at once oversubscribes the CPU and races merges, which presents as a freeze.
    if (_anyProcessingBusy()) {
      return { success: false, busy: true, error: 'A reprocess is already running — please wait for it to finish.' };
    }
    if (!Array.isArray(docs) || !docs.length) return { success: true, done: 0, failed: 0 };

    const learning2  = require('../../../database/modules/learning');
    const templates2 = require('../../../database/modules/templates');
    const reprMode   = _validMode(learning2.getSetting(db, 'processing_mode', 'smart'));
    const diagOn     = _diagEnabled(db);
    if (diagOn) diaglog.enable();
    const { args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath, logger);

    // Stage every doc into ONE temp folder under a unique name, snapshot its existing
    // extractions, and build its per-doc manifest overrides (mirrors single-doc
    // reprocess: template baseline enhance + known template-id + known doc-slug).
    const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-rb-'));
    const manifest  = {};   // tmpName -> { known_template_id, known_doc_slug, enhance_params }
    const nameToDoc = {};   // tmpName -> { docId, filename, existing }
    const tmpNames  = [];
    // WORKFLOW_LOCK (Slice 1 Stage E): SKIP-AND-REPORT, never abort — a locked doc is under
    // an approver and must not be rewritten by a bulk pass (this is the second reprocess
    // door; without it the batch silently sails past the single-doc guard). DELIBERATELY no
    // admin auto-override here (PINNED in test_reprocess_lock.js): bulk mutation under an
    // approver is exactly the class the lock exists for — the override stays a per-doc act
    // via single-doc reprocess. Skipped count is surfaced in the summary.
    // FYI slice (2026-07-19): the skip uses the shared LOCK predicate (workflowService.
    // hasActiveWorkflowLock = approval routes only, WORKFLOW_ACK_LOCKS-aware) — a doc with
    // only an open acknowledge/FYI route IS reprocessed (an FYI is a postcard, not a gate;
    // the recipient's view always joins live fields). Same authority as editGuard, so the
    // two reprocess doors can never disagree.
    const wfLockSvc = require('../../services/workflowService');
    let lockedSkipped = 0;
    for (const d of docs) {
      try {
        if (wfLockSvc.hasActiveWorkflowLock(db, d.docId)) { lockedSkipped++; continue; }
        const row = db.prepare('SELECT working_path, template_id, ocr_text, status, confirmed_at, supplier_pin, supplier_name FROM documents WHERE id = ?').get(d.docId);
        const srcFile = (row && row.working_path && fs.existsSync(row.working_path))
          ? row.working_path
          : path.join(d.folderPath || '', d.filename || '');
        if (!srcFile || !fs.existsSync(srcFile)) { continue; }
        const ext     = path.extname(d.filename || '') || '.pdf';
        const tmpName = `rb_${d.docId}${ext}`;
        fs.copyFileSync(srcFile, path.join(tmpDir, tmpName));
        const existing = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(d.docId);
        const tmpl = row && row.template_id ? templates2.getById(db, row.template_id) : null;
        const enh  = (tmpl && tmpl.ocr_auto_enabled && tmpl.ocr_auto_params) ? tmpl.ocr_auto_params : null;
        const dtRow = db.prepare(
          `SELECT dt.slug AS slug FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`
        ).get(d.docId);
        // Operator supplier PIN (Part B3, per-doc, no global leak): carry the pin so batch reprocess
        // forces the supplier, and — when it DIFFERS from the doc's current supplier — suppress the stale
        // template/type (B2) so the type re-detects for the new supplier. Byte-identical when no pin
        // (SUPPLIER_PIN off/unset): known_supplier absent, template/type unchanged.
        const _pin = (row && row.supplier_pin) ? String(row.supplier_pin).trim() : null;
        const _pinOn = !!_pin && process.env.SUPPLIER_PIN !== '0';
        const _pinDiff = _pinOn && _pin.toLowerCase() !== String((row && row.supplier_name) || '').trim().toLowerCase();
        manifest[tmpName]  = {
          known_template_id: _pinDiff ? null : ((row && row.template_id) || null),
          known_doc_slug:    _pinDiff ? null : ((dtRow && dtRow.slug) || null),
          // Per-doc type authority (statuses differ across a batch — a global flag must
          // never leak, so this is manifest-only): a NEVER-confirmed doc's type is the
          // machine's own guess and a trusted contradicting title may re-type it on
          // reprocess; a confirmed doc stays pinned (human checkpoint). Key present only
          // when 'machine' — absent = pinned, today's behaviour.
          ...(!_pinDiff && row && row.status !== 'confirmed' && !row.confirmed_at
              ? { known_doc_slug_authority: 'machine' } : {}),
          ...(_pinOn ? { known_supplier: _pin } : {}),
          enhance_params:    enh,
          // Reuse stored full-page OCR text → skip the ~1.9s/page re-OCR (only when no
          // enhance is active and the text is non-empty; crop reads still re-run).
          // PASS THE CACHE EVEN WHEN STRAIGHTENING (DESKEW×CACHE fast path — oscar/Oracle): the Python
          // side (tesseract.extract_text_and_images) now DETECTS skew first and only re-OCRs docs with a
          // page tilted past the floor; an all-level doc reuses this cache exactly like a normal
          // reprocess (a below-floor page's straighten is a no-op → identical pixels → identical read).
          // MUST land atomically with that Python change — against the old code, passing the cache under
          // deskew would gate deskew OFF and serve raw text (silent no-op). Kill switch DESKEW_CACHE_FAST=0.
          ...(!enh && row && row.ocr_text && row.ocr_text.trim() ? { ocr_text: row.ocr_text } : {}),
        };
        nameToDoc[tmpName] = { docId: d.docId, filename: d.filename, existing };
        tmpNames.push(tmpName);
        logAudit(db, { action: 'reprocess', target_type: 'document', target_id: d.docId,
          document_id: d.docId, outcome: 'success', metadata: { batch: true } });
      } catch (e) { logger?.warn(`reprocess-batch stage ${d.filename}: ${e.message}`); }
    }
    if (!tmpNames.length) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      cleanupFiles(tempFiles);
      return { success: true, done: 0, failed: 0, lockedSkipped };
    }

    const manifestFile = writeTempJson('rbmanifest', manifest);
    let concurrency = parseInt(learning2.getSetting(db, 'processing_concurrency', String(defaultConcurrency())), 10);
    if (!Number.isFinite(concurrency)) concurrency = 1;
    // Reprocess All is pure cross-document parallelism (each doc's pipeline is unchanged); the
    // threadCap below keeps total OMP/onnx threads ≈ cores, so more workers don't oversubscribe.
    // Cap at 10 (raised from 5, owner request 2026-07-14): the effective count is still bounded by
    // min(cap, processing_concurrency, files), and processing_concurrency defaults core-aware — so a
    // low-core machine never actually reaches 10; a high-core box with a high concurrency setting now
    // uses it (was throttled to 5). threadCap = cores/shards keeps the pool from thrashing.
    concurrency = Math.max(1, Math.min(10, concurrency));
    const shards  = partitionRoundRobin(tmpNames, Math.min(concurrency, tmpNames.length));
    // Per-worker thread cap = cores / workers, so the pool doesn't oversubscribe the
    // CPU. Caps Tesseract's OpenMP threads (OMP_THREAD_LIMIT in the spawn env — without
    // it N workers each grab ~all cores ≈ N×cores threads and thrash, making a parallel
    // run crawl as if it were serial). >1 shard only.
    const threadCap = shards.length > 1
      ? Math.max(1, Math.floor((os.cpus().length || 1) / shards.length)) : 0;

    _reprocessStatus = { running: true, total: tmpNames.length, done: 0, failed: 0, pendingCompletion: false };
    mirrorReprocess({ type: 'start', total: tmpNames.length });
    let done = 0, failed = 0;
    const shardFiles = [];
    _currentBatchProcs = [];

    const runShard = (shard) => new Promise((resolve) => {
      const filesFile = writeTempJson('rbfiles', shard);
      shardFiles.push(filesFile);
      const scriptArgs = ['--folder', tmpDir, '--tesseract', tesseractPath(), '--mode', reprMode,
        '--files-file', filesFile, '--reprocess-manifest', manifestFile, ...trainingArgs];
      if (deskewAll) scriptArgs.push('--deskew-pages', '--deskew-min-angle', String(deskewMinAngle));   // C3: straighten pages tilted past the operator's floor before reading (Python no-ops below it / on born-digital)
      if (traceWanted(diagOn)) {
        scriptArgs.push('--trace');
        try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
      }
      const env = {
        ...process.env,
        ...(threadCap > 0 ? { OMP_THREAD_LIMIT: String(threadCap) } : {}),
        ..._autoTitleEnv(db),
        ..._ocrDpiEnv(db),
        ..._anchorCropEnv(db),
        ..._reconcileEnv(db),
      };
      const proc = spawn(pythonExe(), pythonArgs(backendScript(), ...scriptArgs), { windowsHide: true, env });
      _currentBatchProcs.push(proc);
      let buf = '', settled = false, watchdog = null;
      const fin = () => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); resolve(); };
      watchdog = setTimeout(() => {
        logger?.err('reprocess-batch shard timed out');
        try { require('child_process').spawnSync(TASKKILL_EXE, ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true, stdio: 'ignore' }); } catch {}
        try { proc.kill(); } catch {}
        fin();   // settle directly — a kill that fails to fire proc.on('close') must not hang Promise.all
      }, 30 * 60 * 1000);
      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          let msg = null; try { msg = JSON.parse(t); } catch { continue; }
          if (msg.type === 'trace') { routeTrace(msg); continue; }
          if (msg.type === 'file_done') {
            _recordDevDoc(msg);
            const nd = nameToDoc[msg.original_filename] || nameToDoc[msg.filename];
            if (nd && msg.success && msg.extractions) {
              try { applyReprocessResult(db, nd.docId, nd.existing, msg, nd.filename, diagOn); done++; }
              catch (e) { failed++; logger?.err(`reprocess-batch merge ${nd.filename}: ${e.message}`); }
            } else if (nd) { failed++; }
            _reprocessStatus.done = done; _reprocessStatus.failed = failed;
            mirrorReprocess({ type: 'file_done', done, failed, total: tmpNames.length, docId: nd ? nd.docId : null });
          } else if (msg.type !== 'start') {
            mirrorReprocess(msg);   // file_begin / log
          }
        }
      });
      proc.stderr.on('data', d => { const tx = d.toString().trim(); if (tx) logger?.warn(`reprocess-batch stderr: ${tx}`); });
      proc.on('error', (e) => { logger?.err(`reprocess-batch spawn: ${e.message}`); fin(); });
      proc.on('close', fin);
    });

    try {
      await Promise.all(shards.map(runShard));
    } finally {
      _currentBatchProcs = [];
      // Mark the batch finished + tell the LIVE Review window (which may be a REOPENED window that
      // reconnected mid-run) so it can refresh the queue + re-enable its buttons. The window that
      // STARTED the batch also resolves via this handler's return; a reopened one relies on this event.
      _reprocessStatus = { ..._reprocessStatus, running: false, pendingCompletion: true };
      mirrorReprocess({ type: 'batch_done', done, failed, total: _reprocessStatus.total });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      cleanupFiles([manifestFile, ...shardFiles, ...tempFiles]);
    }
    return { success: true, done, failed, lockedSkipped };
  });

  // Live "Reprocess All" status — a Review window that was closed mid-batch reads this on reopen to
  // reconnect (show progress + disable the reprocess buttons) instead of looking idle over a batch
  // that is still running in this process. Any signed-in principal may read it (display-only).
  ipcMain.handle('get-reprocess-status', () => ({ ..._reprocessStatus }));

  // Consume-once: a batch's window-side completion (auto-file reprocessed-to-100 docs + summary).
  // Returns the final counts the FIRST time it is called after a batch finishes, then null. Both the
  // fresh-start window (which already ran its own completion) and a reopened window call it — so the
  // completion runs exactly once, whether or not a window was open at the finish line.
  ipcMain.handle('consume-reprocess-completion', () => {
    if (!_reprocessStatus.pendingCompletion) return null;
    _reprocessStatus.pendingCompletion = false;
    return { done: _reprocessStatus.done, failed: _reprocessStatus.failed, total: _reprocessStatus.total };
  });

  // ── OCR region ──────────────────────────────────────────────────────────────
  // Zone-OCR + anchor/logo teaching tools — all part of the Review window's
  // "teach the system" workflow, so Admin/Edit (the same set that can confirm
  // and correct extractions there).
  let _ocrTmpSeq = 0;   // disambiguates same-ms tmpFile names for the 3 parallel reads of one draw
  // COLD region.py spawn (the always-available fallback; also the sole path when the pool is OFF).
  // Does NOT unlink — the caller (_runRegion) owns the tmpFile lifecycle via its finally.
  const _coldRegion = (tmpFile, boxes) => new Promise((resolve) => {
    const extra = boxes ? ['--boxes'] : [];
    const proc = spawn(pythonExe(), pythonArgs(ctx.resourcePath('python_backend', 'ocr', 'region.py'),
      '--image-file', tmpFile, '--tesseract', tesseractPath(), ...extra), { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', () => {
      if (err) console.error(`ocr_region${boxes ? '_boxes' : ''} stderr:`, err);
      if (boxes) { try { resolve(JSON.parse(out.trim())); } catch { resolve(null); } }
      else resolve(out.trim());
    });
    proc.on('error', () => resolve(boxes ? null : ''));   // spawn failure -> empty (never hang)
  });
  // Shared read path. Writes the tmpFile ONCE, routes through the warm worker pool when enabled
  // (fallback to a cold spawn on ANY worker failure), and unlinks the tmpFile ONCE in finally —
  // regardless of path (Oracle: single unlink point, no per-request close race under the pool). The
  // seq suffix keeps the 3 PARALLEL reads of one draw from colliding on the same-ms filename.
  const _runRegion = async (base64png, boxes) => {
    const tmpFile = path.join(os.tmpdir(), `ds_ocr${boxes ? 'b' : ''}_${Date.now()}_${_ocrTmpSeq++}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    try {
      if (regionWorker.enabled()) {
        try {
          const r = await regionWorker.run({ imageFile: tmpFile, boxes });
          return boxes ? { text: r.text, box: r.box, words: r.words, lines: r.lines } : (r.text || '');
        } catch (e) {
          console.error('ocr-region warm-worker fallback:', e && e.message);   // -> cold spawn below
        }
      }
      return await _coldRegion(tmpFile, boxes);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  };

  // Zone-OCR + anchor teaching tools — Admin/Edit (the set that can confirm/correct in Review).
  ipcMain.handle('ocr-region', async (_e, base64png) => {
    requireRole('admin', 'edit');
    return _runRegion(base64png, false);
  });

  // Like ocr-region but returns {text, box:[l,t,w,h], words, lines} where box is the union of
  // detected word boxes in the crop's ORIGINAL pixels. The ⊕ tool uses this to capture the taught
  // LABEL's position so a drift-invariant label→value offset can be stored (see review/renderer.js
  // captureAnchorContext, learning.saveAnchor).
  ipcMain.handle('ocr-region-boxes', async (_e, base64png) => {
    requireRole('admin', 'edit');
    return _runRegion(base64png, true);
  });

  // Straighten a rendered page for the Review DISPLAY: returns {angle, image} where image is a
  // base64 PNG of the deskewed page (SAME pixel dims as the input — region.py rotates with
  // expand=False) and angle is the applied straightening angle (PIL CCW-positive, 0 when the page
  // is already level). Display-only + non-destructive (the filed original is never touched); the
  // renderer swaps the shown page to this so drawn ⊕ boxes land on level text, then rotates the
  // saved anchor coords back to the raw frame by the SAME angle. Mirrors the ocr-region spawn.
  ipcMain.handle('get-page-deskew', async (_e, base64png, minAngle) => {
    requireRole('admin', 'edit');
    const tmpFile = path.join(os.tmpdir(), `ds_deskew_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
    const py = pythonExe();
    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script,
        '--image-file', tmpFile, '--tesseract', tesseractPath(), '--deskew',
        '--min-angle', String(Math.max(0.2, Math.min(5.0, Number(minAngle) || 0.2)))),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) console.error('get_page_deskew stderr:', err);
        try { resolve(JSON.parse(out.trim())); } catch { resolve({ angle: 0, image: null }); }
      });
    });
  });

  // ── Template-mapping test (shared path with reprocess) ───────────────────────
  // Runs the SAME Stage 0.5 extraction (template_mapper.extract_with_mappings)
  // the real reprocess uses, against the full sample page, for one draft/saved
  // mapping. The Template Editor calls this instead of cropping the absolute
  // drawn target itself, so the test result matches reprocess exactly (same
  // anchor relocation + offset + crop + normalisation). Mirrors the ocr-region
  // spawn pattern above.
  ipcMain.handle('test-template-mapping', async (_e, pageBase64, mapping, landmarks) => {
    requireRole('admin');
    if (!pageBase64 || !mapping) return {};
    const imgFile = path.join(os.tmpdir(), `ds_tmap_img_${Date.now()}.png`);
    const mapFile = path.join(os.tmpdir(), `ds_tmap_${Date.now()}.json`);
    // Optional template landmarks -> the Python resolver runs the SAME registration
    // transform reprocess uses, so the admin "preview across docs" overlay tracks a
    // shifted page. Absent -> the per-field anchor path (unchanged Test behaviour).
    const lmFile = (Array.isArray(landmarks) && landmarks.length)
      ? path.join(os.tmpdir(), `ds_tmap_lm_${Date.now()}.json`) : null;
    try {
      fs.writeFileSync(imgFile, Buffer.from(pageBase64, 'base64'));
      fs.writeFileSync(mapFile, JSON.stringify(mapping));
      if (lmFile) fs.writeFileSync(lmFile, JSON.stringify(landmarks));
    } catch (e) {
      try { fs.unlinkSync(imgFile); } catch {}
      try { fs.unlinkSync(mapFile); } catch {}
      if (lmFile) { try { fs.unlinkSync(lmFile); } catch {} }
      return { error: e.message };
    }
    const script = ctx.resourcePath('python_backend', 'test_mapping.py');
    return new Promise((resolve) => {
      const targs = ['--image-file', imgFile, '--mapping-file', mapFile, '--tesseract', tesseractPath()];
      if (lmFile) targs.push('--landmarks-file', lmFile);
      const proc = spawn(pythonExe(), pythonArgs(script, ...targs),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(imgFile); } catch {}
        try { fs.unlinkSync(mapFile); } catch {}
        if (lmFile) { try { fs.unlinkSync(lmFile); } catch {} }
        if (err) console.error('test_mapping stderr:', err);
        try { resolve(JSON.parse(out.trim() || '{}')); }
        catch { resolve({}); }
      });
    });
  });

  // ── Logo operations ──────────────────────────────────────────────────────────
  function runLogoScript(base64png, extraArgs) {
    const tmpFile = path.join(os.tmpdir(), `ds_logo_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'logo', 'fingerprint.py');
    const py = pythonExe();

    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script, '--image-file', tmpFile, ...extraArgs),
        { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        try { resolve(JSON.parse(out)); } catch { resolve(null); }
      });
    });
  }

  ipcMain.handle('extract-logo-hash', (_e, b64) => {
    requireRole('admin', 'edit');
    return runLogoScript(b64, ['--mode', 'extract']);
  });

  ipcMain.handle('match-logo-hash', async (_e, b64) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    const logos = learning.getAllLogos(getDb());
    if (!logos.length) return null;
    const fpFile = path.join(os.tmpdir(), `ds_fp_${Date.now()}.json`);
    fs.writeFileSync(fpFile, JSON.stringify(logos));
    const result = await runLogoScript(b64, ['--mode', 'match',
      '--stored-file', fpFile, '--threshold', '12']);
    try { fs.unlinkSync(fpFile); } catch {}
    return result?.match || null;
  });

  ipcMain.handle('save-logo-fingerprint', (_e, { supplier_name, phash, ahash, detail_hash, document_id }) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    const db = getDb();
    // CONFIRM-TIME PLANT GATE (identity text-first, Oracle C4). The text-agreement gate stops the
    // ENGINE asserting a contradicted identity, but a human can still rubber-stamp a plausible
    // wrong prefill — and this plant would then teach the wrong company that page's logo, making
    // the next batch worse (the measured anti-healing loop: cross-supplier min hamming 2). So a
    // plant now requires the confirmed issuer to be corroborated by the DOCUMENT'S OWN text.
    // Gated on positive corroboration, NOT on "the field carries a note" — every template-less
    // new supplier carries one, and that shape would starve legitimate first-contact enrolment.
    // FAILS OPEN (no doc id, no ocr_text, nothing distinctive ⇒ plant) and can only ever skip a
    // LEARNING write — never a filed value. Kill switch LOGO_PLANT_TEXT_GATE=0.
    if (document_id != null && process.env.LOGO_PLANT_TEXT_GATE !== '0') {
      try {
        const bf = require('../../../database/modules/branding_fingerprint');
        const doc = db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(Number(document_id));
        const fps = db.prepare(
          `SELECT t.keyword_fingerprint FROM templates t
             WHERE t.keyword_fingerprint IS NOT NULL AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))`
        ).all(String(supplier_name || '')).map(r => { try { return JSON.parse(r.keyword_fingerprint) || []; } catch { return []; } });
        const verdict = bf.nameCorroboratedByText(supplier_name, fps, doc && doc.ocr_text);
        if (verdict.judgeable && !verdict.corroborated) {
          logger?.warn?.(`[identity] logo plant SKIPPED for '${supplier_name}' — doc ${document_id} text does not corroborate it`);
          try {
            logAudit(db, { action: 'logo_plant_skipped', action_category: 'processing',
              target_type: 'document', target_id: Number(document_id), document_id: Number(document_id),
              outcome: 'success', details: `supplier=${supplier_name} reason=text_not_corroborated` });
          } catch { /* audit must never break the confirm */ }
          return false;
        }
      } catch (e) { logger?.warn?.(`[identity] plant gate check failed (planting anyway): ${e.message}`); }
    }
    // DETAIL-HASH ENROLMENT THREAD (Phillip R2 / Oracle C5, 2026-07-23; LOGO_DETAIL_ENROL=1 arms).
    // ⚠ SHIPS DARK (default OFF) — the C5 activation A/B (starved copy vs backfilled copy,
    // 390 docs, stress_test/out/act_{base,on}.md) measured what population does: M 9→3 (real
    // healing — six poisoned-GT wrong-auto-files die) BUT would-auto-file 268→131, because with
    // SPARSE detail sets (one reference per row) the anchor-path detail-primary picker
    // (LOGO_DETAIL_PRIMARY, default ON in anchor.py, inert only while this table is starved)
    // abstains across the same-supplier drift tail (histogram: 27% of genuine pairs exceed the
    // veto distance; multi-reference sets are the load-bearing structure). Populating detail_hash
    // by ANY route — this thread or scripts/logo-detail-backfill.js — ARMS that picker, so
    // neither may default-ON until a minimum-set-size guard lands on the Python side (its own
    // design round). The mechanics below are correct and gated for that day.
    // The renderer's confirm-time caller never sends detail_hash (why the table sat 0/N). Thread
    // it SERVER-side from the doc's processing-time hash (documents.logo_detail_hash, mig 47) —
    // never renderer-computed: the canvas image varies with render resolution/enhancement.
    // saveLogoFingerprint's guards apply unchanged (COALESCE fills empty rows only;
    // _detailCrossPlantCloser refuses rival-matching marks). No doc id / no hash ⇒ exactly today.
    let _detail = detail_hash;
    if (!_detail && document_id != null && process.env.LOGO_DETAIL_ENROL === '1') {
      try {
        const _dr = db.prepare('SELECT logo_detail_hash FROM documents WHERE id = ?').get(Number(document_id));
        _detail = (_dr && _dr.logo_detail_hash) || null;
      } catch { _detail = detail_hash; }
    }
    learning.saveLogoFingerprint(db, { supplier_name, phash, ahash, detail_hash: _detail });
    return true;
  });

  ipcMain.handle('save-field-anchor', (_e, data) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    const db = getDb();
    learning.saveAnchor(db, data);
    // Recording verification (diagnostic only): record exactly what now sits in
    // field_anchors for this (supplier, doc_type, field) after the save, so a
    // diagnostic log shows whether the ⊕ teach actually persisted the drawn
    // coordinates — and that an authoritative re-teach collapsed stale siblings.
    // No-op unless diagnostic logging is enabled (never logs in normal use).
    try {
      if (_diagEnabled(db)) {
        const rows = db.prepare(`
          SELECT id, anchor_label, direction, x_norm, y_norm, w_norm, h_norm,
                 offset_dx_norm, offset_dy_norm,
                 usage_count, confidence, last_authoritative_at
          FROM field_anchors
          WHERE field_key = ?
            AND ((supplier_name IS ?) OR supplier_name = ?)
            AND ((document_type IS ?) OR document_type = ?)
        `).all(data.field_key,
               data.supplier_name || null, data.supplier_name || '__unknown__',
               data.document_type || null, data.document_type || null);
        diaglog.enable();
        diaglog.write({ ev: 'anchor_saved', field_key: data.field_key,
          supplier_name: data.supplier_name, document_type: data.document_type,
          authoritative: !!data.authoritative, persisted_rows: rows });
      }
    } catch {}
    return true;
  });

  // Operator-taught field cleanup rule (Review right-click toolkit). Same role gate
  // as the ⊕ teach; learning.saveFieldRule normalizes + upserts. Returns true so the
  // renderer can flush staged rules on confirm without a result shape to parse.
  ipcMain.handle('save-field-rule', (_e, data) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    try { learning.saveFieldRule(getDb(), data || {}); } catch (e) { logger?.warn?.(`save-field-rule: ${e && e.message}`); }
    return true;
  });

  // ── PDF splitting ───────────────────────────────────────────────────────────
  // Thin wrapper around pdf_splitter.py (pypdf). Splits a single PDF into
  // page-range sub-documents that can then be dropped into the normal process-
  // folder pipeline. outDir is optional (defaults to a safe system-temp path).
  // ── Filing Slips: generate a printable separator-sheet pack ─────────────────
  // docs/designs/FILING_SLIPS_2026-07-18.md §5. Writes the PDF into userData/
  // filing-slips/ (never a caller-supplied path — no path-taking IPC surface); the
  // renderer opens it via the existing open-file/show-in-explorer bridges and the
  // user prints from their PDF viewer. The numbering counter advances ONLY on a
  // successful generation. requireRole holds the read-only wall (mutating IPC).
  ipcMain.handle('generate-filing-slips', async (_e, count) => {
    requireRole('admin', 'edit');
    const { app } = require('electron');
    const learning = require('../../../database/modules/learning');   // per-function require, matching this file's convention
    const db = getDb();
    const n = clampSlipCount(count);
    const cur = parseInt(learning.getSetting(db, 'filing_slip_next_number', '1'), 10);
    const { first, last, next } = nextSlipRange(cur, n);
    const outDir = path.join(app.getPath('userData'), 'filing-slips');
    try { fs.mkdirSync(outDir, { recursive: true }); }
    catch (err) { return { success: false, error: `Could not create the output folder: ${err.message}` }; }
    const outPath = path.join(outDir, slipPackName(first, last));

    const script = path.join(path.dirname(backendScript()), 'filing_slips.py');
    const res = await new Promise((resolve) => {
      let stdout = '';
      let proc;
      try {
        proc = spawn(pythonExe(),
          pythonArgs(script, '--count', String(n), '--start', String(first), '--out', outPath),
          { windowsHide: true });
      } catch (err) { return resolve({ success: false, error: err.message }); }
      // Deliberately NOT in the batch Stop/kill registry — pack generation is
      // independent of any import; a 30 s timer guards a leaked child instead.
      const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch { resolve({ success: false, error: 'slip generator returned non-JSON output' }); }
      });
      proc.on('error', (err) => { clearTimeout(timer); resolve({ success: false, error: err.message }); });
    });
    if (!res || !res.success || !fs.existsSync(outPath)) {
      return { success: false, error: (res && res.error) || 'Sheet generation failed' };
    }
    learning.setSetting(db, 'filing_slip_next_number', String(next));
    // Sweep old packs (keep the newest 5) so the folder never grows unbounded.
    try {
      const packs = fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const p of packs.slice(5)) { try { fs.unlinkSync(path.join(outDir, p.f)); } catch {} }
    } catch { /* best-effort */ }
    return { success: true, path: outPath, first, last };
  });

  ipcMain.handle('split-pdf', async (_e, filePath, ranges, outDir, docId, every) => {
    requireRole('admin', 'edit');
    // `every` (split every N pages, 1 = every page) is an alternative to an
    // explicit range string; exactly one is required.
    const everyN = Number(every) > 0 ? Math.floor(Number(every)) : null;
    if (docId == null || (!ranges && !everyN)) {
      return { success: false, error: 'docId and ranges or every are required' };
    }

    // SECURITY (Stage 1 — H2): resolve the source PDF, the output directory, AND the delete target
    // SERVER-SIDE from the doc row. The renderer-supplied `filePath`/`outDir` are NOT trusted for any
    // filesystem operation — a compromised/replaced renderer could otherwise write split PDFs to an
    // arbitrary directory and unlink an arbitrary host file (the read swapped to the working copy while
    // the delete still hit the caller's path). All three now derive from paths the app itself recorded
    // for this document.
    const db = getDb();
    const documents = require('../../../database/modules/documents');
    const row = db.prepare(
      'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(docId);
    if (!row) return { success: false, error: 'document not found' };
    const recordedOriginal = (row.folder_path && row.original_filename)
      ? path.join(row.folder_path, row.original_filename) : null;
    // Read source: prefer the app-managed working copy (stable + app-owned); then the filed copy; then
    // the recorded original. `folder_path`/`original_filename` track the CURRENT recorded location — they
    // are updated to the Processed/ folder when the source is drained after a normal import — so
    // recordedOriginal stays valid; the working copy is preferred only because it's the reliable
    // app-owned path that doesn't depend on the user's folder.
    const srcFile = [row.working_path, row.stored_path, recordedOriginal].find(p => p && fs.existsSync(p)) || null;
    if (!srcFile || !fs.existsSync(srcFile)) {
      return { success: false, error: 'Source PDF not found — the original may have been moved into the Processed folder after processing.' };
    }
    // Write the split pages next to the doc's own RECORDED location (a real user folder the app already
    // recorded for it), never the hidden inbox where the working copy lives, and never a renderer-chosen
    // directory.
    const splitOutDir = recordedOriginal ? path.dirname(recordedOriginal)
                      : row.stored_path ? path.dirname(row.stored_path)
                      : path.dirname(srcFile);

    const py             = pythonExe();
    const splitterScript = path.join(path.dirname(backendScript()), 'pdf_splitter.py');
    const splitArgs      = everyN ? ['--every', String(everyN)] : ['--ranges', ranges];
    const args           = pythonArgs(splitterScript, '--file', srcFile, ...splitArgs, '--outdir', splitOutDir);

    const raw = await new Promise((resolve) => {
      let stdout = '';
      const proc = spawn(py, args, { windowsHide: true });
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        try { resolve(JSON.parse(stdout.trim())); }
        catch { resolve({ success: false, error: 'pdf_splitter returned non-JSON output', raw: stdout.trim() }); }
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });

    if (!raw.success) return raw;

    const createdFiles = (raw.files || []).filter(f => fs.existsSync(f));
    if (createdFiles.length === 0) {
      return { success: false, error: 'Splitter reported success but no output files were found on disk.' };
    }

    const docIds = [];
    for (const outFile of createdFiles) {
      const info = documents.insert(db, {
        original_filename: path.basename(outFile),
        folder_path:       path.dirname(outFile),
        status:            'needs_review',
      });
      docIds.push(info.lastInsertRowid);
    }

    // Remove the original from DB + disk — only after outputs are confirmed. The delete target is the
    // doc's RECORDED original location (resolved above), never a renderer-supplied path.
    documents.deleteDoc(db, docId);
    if (recordedOriginal && fs.existsSync(recordedOriginal)) {
      try { fs.unlinkSync(recordedOriginal); } catch (e) { logger?.warn('Could not delete original after split:', e.message); }
    }

    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));

    return { success: true, files: createdFiles, docIds };
  });
}

// Move a processed original out of the intake folder into `destDir` (a managed
// "Processed"/"Errors" subfolder) so it can't be re-pulled by a later scan. All
// fs is via the injected module so it's hermetically testable. Collisions get a
// `-N` suffix; a cross-volume rename (EXDEV) falls back to copy+unlink. Returns
// the new { folder, filename }, or null if the source no longer exists.
// CALLER must verify a durable copy exists before calling — this DOES remove the
// original from the intake folder.
// Best-effort blocking sleep — only ever hit on the drain lock-retry path below.
function _sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

// opts.retry (default true): retry briefly on a transient lock. The INLINE caller
// (_drainNowOrDefer, on the main thread per file_done) passes retry:false so it never
// blocks on Atomics.wait — a locked file is simply deferred to the post-worker flush,
// which retries (handles are released by then).
function drainOriginalToFolder(fs, path, srcPath, destDir, originalFilename, opts = {}) {
  if (!fs.existsSync(srcPath)) return null;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const ext  = path.extname(originalFilename);
  const base = path.basename(originalFilename, ext);
  let destPath = path.join(destDir, originalFilename);
  let counter  = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(destDir, `${base}-${counter}${ext}`);
    counter++;
  }
  const maxAttempts = opts.retry === false ? 1 : 5;
  // The OCR worker can still hold a transient handle on the PDF for a moment after it
  // emits file_done, so an immediate rename fails with a LOCK error (EBUSY/EPERM/
  // EACCES) — NOT a cross-volume error. The previous code assumed EVERY failure was
  // cross-volume and did copy+unlink, which on a lock left the copy (a DUPLICATE in
  // Processed/) but failed the unlink — so the original stayed in the source AND a
  // duplicate appeared. Now: a genuine EXDEV uses copy+unlink; a lock is retried
  // briefly; if still locked we leave the original in place (it drains on the next
  // run) and never create a duplicate.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(srcPath, destPath);
      return { folder: destDir, filename: path.basename(destPath) };
    } catch (e) {
      if (e && e.code === 'EXDEV') {           // genuine cross-volume → copy + remove
        fs.copyFileSync(srcPath, destPath);
        try {
          fs.unlinkSync(srcPath);
        } catch {
          // Copy landed but the source is locked — remove the copy so we never leave a
          // DUPLICATE; the original drains on a later flush/run.
          try { fs.unlinkSync(destPath); } catch {}
          return null;
        }
        return { folder: destDir, filename: path.basename(destPath) };
      }
      if (attempt >= maxAttempts - 1) return null;   // still locked → leave it, no duplicate
      _sleepMs(80);
    }
  }
  return null;
}

// Flush the deferred-drain queue: move each processed/failed original into its
// Processed/Errors subfolder now that the worker PROCESS has exited and released the
// file handle. Called from the manual batch (after Promise.all) and the watch worker's
// close handler. Items still locked are re-queued for a later flush (never lost, never
// duplicated — see drainOriginalToFolder). Best-effort; failures are logged, not fatal.
// Try to move an original NOW (the worker closes each PDF as it finishes it, so the
// handle is usually free by file_done → the file moves live, "as processed"). If it is
// still momentarily locked, queue it for the post-worker flush instead of blocking.
// Per-SOURCE-FOLDER drain tally for the truthful post-run line (Chris r5 card 2; Oracle C1):
// a plain per-batch counter was contaminated by concurrent WATCH drains (watch messages run
// through the same _drainNowOrDefer while a manual import is mid-flight — watch defers its
// batch behind a manual one, but not the reverse). Keying on the item's source folder means
// the manual emit reads ONLY its own folder's tally; watch drains sit under the watch
// folder's key and never leak into the manual line. Pure helpers exported for the pin test.
const _drainTally = new Map();   // lower-cased source folder -> drains completed
function _drainTallyKey(p) { try { return path.dirname(path.resolve(p)).toLowerCase(); } catch { return ''; } }
function _recordDrain(srcPath) {
  const k = _drainTallyKey(srcPath);
  if (k) _drainTally.set(k, (_drainTally.get(k) || 0) + 1);
}
function _takeDrainTally(folder) {
  let k = '';
  try { k = path.resolve(folder).toLowerCase(); } catch { return 0; }
  const n = _drainTally.get(k) || 0;
  _drainTally.delete(k);
  return n;
}

function _drainNowOrDefer(db, logger, item) {
  try {
    // retry:false → a single non-blocking attempt on the main thread; a locked file is
    // deferred to _flushPendingDrains (after the worker exits), which DOES retry.
    const moved = drainOriginalToFolder(fs, path, item.srcPath, item.destDir, item.originalFilename, { retry: false });
    if (moved) {
      db.prepare('UPDATE documents SET folder_path = ? WHERE id = ?').run(moved.folder, item.docId);
      if (moved.filename !== item.originalFilename) {
        db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?').run(moved.filename, item.docId);
      }
      logger?.log(`Drained to ${item.kind}: ${item.originalFilename} → ${moved.folder}`);
      _recordDrain(item.srcPath);
      return;
    }
  } catch (e) {
    logger?.warn(`Inline drain deferred for ${item.originalFilename}: ${e.message}`);
  }
  if (fs.existsSync(item.srcPath)) _pendingDrains.push(item);   // still locked → flush after the worker exits
}

function _flushPendingDrains(db, logger) {
  if (!_pendingDrains.length) return;
  const queue = _pendingDrains;
  _pendingDrains = [];
  const keep = [];
  for (const item of queue) {
    try {
      const moved = drainOriginalToFolder(fs, path, item.srcPath, item.destDir, item.originalFilename);
      if (moved) {
        db.prepare('UPDATE documents SET folder_path = ? WHERE id = ?').run(moved.folder, item.docId);
        if (moved.filename !== item.originalFilename) {
          db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?').run(moved.filename, item.docId);
        }
        logger?.log(`Drained to ${item.kind}: ${item.originalFilename} → ${moved.folder}`);
        _recordDrain(item.srcPath);
      } else if (fs.existsSync(item.srcPath)) {
        keep.push(item);   // still locked → retry on the next flush
      }
    } catch (e) {
      logger?.warn(`Could not drain ${item.originalFilename} to ${item.kind}: ${e.message}`);
    }
  }
  if (keep.length) _pendingDrains.push(...keep);
}

// Make/refresh the app-managed working copy of an intake file at
// inboxDir/<docId><ext>. ATOMIC: copy to a `.part` temp then rename onto the
// final name, so a crash mid-copy never leaves a half-written <docId><ext> that
// looks valid (a later reconcile sweep GCs stray `.part` files). fs/path injected
// for testability; the inbox dir is resolved by the caller (keeps electron out of
// the helper). Returns the working_path on success, else null (best-effort).
function ensureWorkingCopy(fs, path, inboxDir, srcPath, docId, originalFilename) {
  if (!fs.existsSync(srcPath)) return null;
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  const rawExt = path.extname(originalFilename || '');
  const ext    = /^\.[A-Za-z0-9]+$/.test(rawExt) ? rawExt : '';   // sanitise extension
  const dest   = path.join(inboxDir, `${docId}${ext}`);
  const part   = `${dest}.part`;
  try {
    fs.copyFileSync(srcPath, part);
    fs.renameSync(part, dest);   // atomic publish
    return dest;
  } catch (e) {
    try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch {}
    try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
    return null;
  }
}

// Reconcile the inbox holding area to the DB (the source of truth). The DB is
// authoritative; every inbox file must map to a live document row, else it's
// debris from a crash and is collected. Removes:
//   • interrupted-copy debris  (*.part)
//   • orphaned working copies  (no documents row for that id)
//   • dead working copies      (the doc is already confirmed/deleted)
// Keeps copies for live docs (needs_review/deferred/error/pending). A crash can
// only ever leave EXTRA files (cleaned here) — never lose a document, because an
// original is only removed after a verified copy. Pure: fs/path/db injected for
// hermetic testing. Returns a summary of what it did.
function reconcileHolding(fs, path, db, inboxDir) {
  const summary = { scanned: 0, partsRemoved: 0, orphansRemoved: 0, deadRemoved: 0, kept: 0 };
  if (!fs.existsSync(inboxDir)) return summary;
  let entries;
  try { entries = fs.readdirSync(inboxDir); } catch { return summary; }

  const statusById = new Map(
    db.prepare('SELECT id, status FROM documents').all().map(r => [r.id, r.status])
  );
  const DEAD = new Set(['confirmed', 'deleted']);

  for (const name of entries) {
    summary.scanned++;
    const full = path.join(inboxDir, name);
    if (name.endsWith('.part')) {
      try { fs.unlinkSync(full); summary.partsRemoved++; } catch {}
      continue;
    }
    // Managed copies are named exactly <docId><ext> (a plain integer id). Anything
    // else (a stray user file) is left untouched.
    const idStr = path.basename(name, path.extname(name));
    const id    = parseInt(idStr, 10);
    if (!Number.isInteger(id) || String(id) !== idStr) { summary.kept++; continue; }

    const status = statusById.get(id);
    if (status === undefined) {
      try { fs.unlinkSync(full); summary.orphansRemoved++; } catch {}
    } else if (DEAD.has(status)) {
      try { fs.unlinkSync(full); summary.deadRemoved++; } catch {}
    } else {
      summary.kept++;
    }
  }
  return summary;
}

// Thin wrapper: resolve the inbox dir (electron userData) and run the sweep,
// logging a one-line summary. Called on startup and after each batch.
function runHoldingReconcile(db, logger) {
  try {
    const { app } = require('electron');
    const inboxDir = path.join(app.getPath('userData'), 'inbox');
    const s = reconcileHolding(fs, path, db, inboxDir);
    const removed = s.partsRemoved + s.orphansRemoved + s.deadRemoved;
    if (removed > 0) {
      logger?.log(`[reconcile] holding swept: ${removed} removed ` +
        `(${s.partsRemoved} .part, ${s.orphansRemoved} orphan, ${s.deadRemoved} confirmed) · ${s.kept} kept`);
    }
    return s;
  } catch (e) {
    logger?.warn(`[reconcile] holding sweep failed: ${e.message}`);
    return null;
  }
}

// Rotate the inbox working copy in place (pypdf via pdf_rotate.py) to match the per-page
// orientation OSD detected on this import. PDF only, only when a non-zero rotation exists.
// ASYNC (non-blocking child_process.spawn) so the synchronous Python cold-start never
// freezes the main thread on the file_done path (QA audit #4). Best-effort; resolves after
// the rotate finishes (or is skipped) — a failure just leaves the copy unrotated (logged).
function _rotateWorkingCopyIfNeededAsync(msg, docId, logger) {
  return new Promise((resolve) => {
    try {
      const rots = msg.page_rotations;
      if (!_pyHelpers || !msg.working_path || !Array.isArray(rots) || !rots.some(r => r)) return resolve();
      if (!/\.pdf$/i.test(msg.working_path)) return resolve();
      const script = path.join(path.dirname(_pyHelpers.backendScript()), 'pdf_rotate.py');
      const child = require('child_process').spawn(
        _pyHelpers.pythonExe(),
        _pyHelpers.pythonArgs(script, '--file', msg.working_path, '--rotations', rots.join(',')),
        { windowsHide: true });
      let stderr = '';
      const timer = setTimeout(() => { try { child.kill(); } catch {} }, 30000);
      child.stderr?.on('data', d => { stderr += d.toString(); });
      child.on('error', (e) => { clearTimeout(timer); logger?.warn?.(`[auto-rotate] ${e && e.message}`); resolve(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) logger?.log?.(`Auto-rotated working copy (docId=${docId}): ${rots.filter(x => x).length} page(s)`);
        else logger?.warn?.(`[auto-rotate] pdf_rotate failed (docId=${docId}): ${stderr.slice(0, 200)}`);
        resolve();
      });
    } catch (e) { logger?.warn?.(`[auto-rotate] ${e && e.message}`); resolve(); }
  });
}

// ASYNC twin of ensureWorkingCopy — the multi-MB copyFileSync is what froze windows
// during a batch (QA audit #4). Same atomic .part→rename, resolves to the working_path.
async function ensureWorkingCopyAsync(fs, path, inboxDir, srcPath, docId, originalFilename) {
  if (!fs.existsSync(srcPath)) return null;
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  const rawExt = path.extname(originalFilename || '');
  const ext    = /^\.[A-Za-z0-9]+$/.test(rawExt) ? rawExt : '';
  const dest   = path.join(inboxDir, `${docId}${ext}`);
  const part   = `${dest}.part`;
  try {
    await fs.promises.copyFile(srcPath, part);
    await fs.promises.rename(part, dest);   // atomic publish
    return dest;
  } catch (e) {
    try { if (fs.existsSync(part)) await fs.promises.unlink(part); } catch {}
    try { if (fs.existsSync(dest)) await fs.promises.unlink(dest); } catch {}
    return null;
  }
}

function _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger, autoFileRun = true) {
  if (msg.type === 'file_begin') {
    logger?.log(`File begin: ${msg.filename}`);
    return;
  }
  if (msg.type !== 'file_done') return;
  _bumpActivity();   // one document finished (import or watch) — advance the Review activity bar

  if (!msg.success) {
    logger?.err(`File failed: ${msg.original_filename || '?'} — ${msg.error || 'unknown error'}`);
    // Persist a "stuck" record instead of silently dropping the failure, so the
    // doc is VISIBLE (a launchpad surface) and reprocessable — previously a failed
    // file left no DB row at all.
    const documents = require('../../../database/modules/documents');
    const learning  = require('../../../database/modules/learning');
    let docId = null;
    try {
      const ins = documents.insert(db, {
        original_filename: msg.original_filename || 'unknown',
        folder_path:       folderPath,
        status:            'error',
      });
      docId = ins.lastInsertRowid;
      documents.update(db, docId, { error_message: msg.error || 'unknown error' });
      msg.db_id = docId;
    } catch (e) {
      logger?.warn(`Could not record failed document ${msg.original_filename || '?'}: ${e.message}`);
    }
    // Give the stuck doc a VERIFIED working copy (so it's reprocessable even if the
    // source later vanishes) and drain its original into an Errors/ subfolder —
    // same model as success → Processed/ — so it isn't re-pulled on the next run.
    // Best-effort and INDEPENDENT of the row insert above: a copy/move failure must
    // never lose the error record.
    if (docId != null) {
      try {
        const { app }    = require('electron');
        const inboxDir   = path.join(app.getPath('userData'), 'inbox');
        const srcForCopy = msg.original_filename ? path.join(folderPath, msg.original_filename) : null;
        const wp = srcForCopy
          ? ensureWorkingCopy(fs, path, inboxDir, srcForCopy, docId, msg.original_filename)
          : null;
        if (wp) { documents.update(db, docId, { working_path: wp }); msg.working_path = wp; }
        const drainEnabled = learning.getSetting(db, 'drain_processed', 'true') !== 'false';
        if (drainEnabled && wp && fs.existsSync(wp) && srcForCopy) {
          _drainNowOrDefer(db, logger, {
            docId, destDir: path.join(folderPath, 'Errors'), kind: 'Errors',
            srcPath: srcForCopy, originalFilename: msg.original_filename,
          });
        }
      } catch (e) {
        logger?.warn(`Could not stow failed original ${msg.original_filename || '?'}: ${e.message}`);
      }
      try { notifyMainWindow?.('stuck-count-changed', documents.getStuckCount(db)); } catch {}
    }
    return;
  }

  const documents = require('../../../database/modules/documents');
  const learning  = require('../../../database/modules/learning');
  const docTypes  = require('../../../database/modules/document_types');

  // Resolve document_type_id from the detected type name so the review queue
  // has type_slug populated and anchors/hints are tagged correctly.
  let document_type_id = null;
  let detectedTypeName = null;
  if (msg.document_type) {
    const res = _resolveDetectedType(db, msg.document_type);
    document_type_id = res.id;
    // The type was NAMED but this install doesn't have it. Keep the name so Review can offer to
    // add it. The doc deliberately stays UNTYPED rather than adopting the generic type: generic is
    // equally unfilable (trust.js refuses 'generic-type' as flatly as 'no-type'), but it would
    // overwrite the type with one we KNOW is wrong when a better answer is one admin click away,
    // and it would move the filing {docType} token and the learning scope onto general_document.
    // Generic remains the answer for detection == None only — do not move it out of the else.
    detectedTypeName = res.unmatchedName;
  } else {
    // Generic Document fallback: detection returned None → adopt the General Document
    // type when enabled (kill-switched; review-bound via the trust.js refusal).
    const gid = _genericFallbackId(db, msg.document_type);
    if (gid) document_type_id = gid;
  }

  // _supplier_name metadata is only populated via logo/hint matching, which is
  // empty on a fresh install — fall back to the extracted field value so the
  // queue/DB don't show null or a stale supplier name.
  const supplierName = msg.supplier_name || msg.extractions?.supplier_name?.value || null;

  const docResult = documents.insert(db, {
    original_filename:  msg.original_filename,
    folder_path:        folderPath,
    document_type_id,
    supplier_name:      supplierName,
    overall_confidence: msg.overall_confidence || null,
    status:             msg.status || 'needs_review',
    template_id:        msg.template_id   || null,
    logo_phash:         msg.logo_phash    || null,
    logo_detail_hash:   msg.logo_detail_hash || null,
    keyword_fingerprint: msg.keyword_fingerprint
      ? JSON.stringify(msg.keyword_fingerprint) : null,
    ocr_text:           msg.ocr_text      || null,
    page_count:         msg.page_count    || null,
    detected_type_name: detectedTypeName,
  });

  const docId = docResult.lastInsertRowid;

  if (msg.extractions) {
    const rows = Object.entries(msg.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
      validation_note:   data.validation_note || null,
      corrected_to:      data.corrected_to || null,
      anchor_label:      data.anchor || null,
      candidates:        data.candidates ? JSON.stringify(data.candidates) : null,   // disambiguation picker
      suggested_supplier: data.suggested_supplier || null,   // branding cross-check → "Use '<name>'" button
    }));
    learning.insertExtractions(db, docId, rows);
  }

  msg.db_id = docId;

  // Log extraction result (cheap, synchronous — no file IO).
  if (logger) {
    const exFields = msg.extractions
      ? Object.entries(msg.extractions)
          .map(([k, v]) => `${k}=${JSON.stringify(v?.value ?? null)}(${v?.confidence ?? '?'}%)`)
          .join(' | ')
      : 'none';
    const tmpl = msg.template_id ? ` template=${msg.template_id}` : '';
    logger.log(
      `File done: ${msg.original_filename} → status=${msg.status}` +
      ` type=${msg.document_type || '?'} supplier=${supplierName || '?'}` +
      ` conf=${msg.overall_confidence || '?'}%${tmpl}`
    );
    if (exFields) logger.log(`  Fields: ${exFields}`);
  }

  notifyMainWindow('review-count-changed', documents.getReviewCount(db));
  notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));

  // ── Deferred FILE IO (QA audit #4) ───────────────────────────────────────────
  // Everything above is fast, indexed DB work that MUST stay on the synchronous
  // file_done path (so msg.db_id is set before the message is mirrored). Everything
  // BELOW is heavy file/process work — a multi-MB copy and a synchronous Python
  // cold-start for auto-rotate — which used to run inline and froze Review/Settings/
  // main for hundreds of ms to seconds during a batch. It's deferred to a setImmediate
  // and uses ASYNC copy + spawn, so the event loop keeps painting and handling IPC.
  // The returned promise lets the batch await all per-file IO before flushing drains.
  return new Promise((resolve) => {
    setImmediate(async () => {
      // Copy-on-import: an app-managed working copy so preview/reprocess/confirm never
      // depend on the source folder surviving. Best-effort → leave working_path NULL on
      // failure. Runs BEFORE the drain so it copies the file in place, and BEFORE
      // auto-file so the (rotated) working copy is what gets filed.
      try {
        const { app }    = require('electron');
        const inboxDir   = path.join(app.getPath('userData'), 'inbox');
        const srcForCopy = path.join(folderPath, msg.original_filename);
        const wp = await ensureWorkingCopyAsync(fs, path, inboxDir, srcForCopy, docId, msg.original_filename);
        if (wp) {
          documents.update(db, docId, { working_path: wp });
          msg.working_path = wp;
          // Auto-rotate to the orientation OSD detected this import (async, non-blocking),
          // so the FILED copy + every future reprocess are upright from one detection.
          await _rotateWorkingCopyIfNeededAsync(msg, docId, logger);
        }
      } catch (e) {
        console.warn(`[import] working copy failed for docId=${docId}: ${e.message}`);
      }

      // Drain the original out of the intake folder once a VERIFIED working copy exists
      // (move, never delete). Gated on drain_processed + the copy existing on disk.
      try {
        const drainEnabled = learning.getSetting(db, 'drain_processed', 'true') !== 'false';
        if (drainEnabled && msg.working_path && fs.existsSync(msg.working_path)) {
          const explicit = learning.getSetting(db, 'processed_folder', null);
          const destDir  = (explicit && explicit.trim()) || path.join(folderPath, 'Processed');
          _drainNowOrDefer(db, logger, {
            docId, destDir, kind: 'Processed',
            srcPath: path.join(folderPath, msg.original_filename),
            originalFilename: msg.original_filename,
          });
        }
      } catch (e) { logger?.warn?.(`[drain] docId=${docId}: ${e && e.message}`); }

      // AUTO-FILE: a 100%-confidence, fully-typed, un-flagged doc files itself (the single
      // backend decision point — works even with the window closed). Skipped when the run
      // opted out (Teach-wizard single-file import keeps the doc in Review).
      if (autoFileRun) _maybeAutoFile(db, msg, folderPath, notifyMainWindow, logger);

      resolve();
    });
  });
}

function _maybeAutoFile(db, msg, folderPath, notifyMainWindow, logger) {
  try {
    const learning = require('../../../database/modules/learning');
    const trust    = require('../../../database/modules/trust');
    if (learning.getSetting(db, 'auto_file_full_confidence', 'true') === 'false') return;
    // Cheap pre-filter off the file_done msg; the AUTHORITATIVE decision (scope graduation floor
    // + structural gate) is in _autoFileDoc via trust.isAutoFileEligible. The lowest an effective
    // floor can be is min(userThreshold, graduation 98) — below that a doc can never auto-file.
    const userThr = parseInt(learning.getSetting(db, 'auto_file_threshold', '100'), 10) || 100;
    const preFloor = Math.min(userThr, trust.TRUSTED_FLOOR);
    if (!msg.db_id || (msg.overall_confidence || 0) < preFloor) return;
    // Any sub-100 auto-file (graduation or a lowered slider) must be a CLEAN doc — never one
    // that processing flagged for review.
    if (preFloor < 100 && msg.needs_review) return;
    setImmediate(() => {
      _autoFileDoc(db, msg.db_id, folderPath, notifyMainWindow, logger)
        .catch(e => { try { logger?.warn?.(`auto-file ${msg.db_id}: ${e.message}`); } catch {} });
    });
  } catch {}
}

async function _autoFileDoc(db, docId, folderPath, notifyMainWindow, logger) {
  const documents = require('../../../database/modules/documents');
  const learning  = require('../../../database/modules/learning');
  const doctypes  = require('../../../database/modules/document_types');
  const filing    = require('../filing/handler');
  const trust     = require('../../../database/modules/trust');
  const doc = documents.getById(db, docId);
  if (!doc || doc.status !== 'needs_review') return;   // status / claim guard
  // Authoritative auto-file decision via the SHARED predicate: the scope graduation floor (a
  // trusted supplier files at 98, else the user's auto_file_threshold), the flagged-field
  // refusal, and — for any sub-100 file — the structural safety gate. Re-checked here against
  // the DB (not the stale file_done msg) so a doc a human touched in the gap can't slip through.
  if (!trust.isAutoFileEligible(db, doc).eligible) return;
  const dtRow  = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
  const dtInfo = dtRow && dtRow.slug ? doctypes.getWithFields(db, dtRow.slug) : null;
  if (!dtInfo) return;
  const outputRoot = learning.getSetting(db, 'output_folder', null);
  if (!outputRoot) return;   // can't file without a destination
  const allValues = {};
  for (const e of db.prepare('SELECT field_key, display_value, raw_value FROM extractions WHERE document_id = ?').all(docId)) {
    allValues[e.field_key] = e.display_value ?? e.raw_value;
  }
  // Claim the doc BEFORE filing (atomic compare-and-set) so the 100% auto-file can't
  // double-file a doc a human confirmed in the gap since the status check above, and so it's
  // honestly attributed. If the claim doesn't land, someone else already took it — don't file.
  const claim = documents.confirmIfReviewable(db, docId, { confirmed_by_username: 'Auto-filed (100%)' });
  if (!claim || claim.changes === 0) return;
  let fr;
  try {
    fr = await filing.commitDocument({
      db, fs, path, outputRoot,
      folderPath:       doc.folder_path || folderPath,
      originalFilename: doc.original_filename,
      workingPath:      doc.working_path,
      allValues, documentType: dtInfo.name, dtInfo, logger,
    });
  } catch (e) { fr = null; logger?.warn?.(`[auto-file] commit failed for docId=${docId}: ${e && e.message}`); }
  if (!fr || !fr.success) {
    // Filing failed after the claim — roll the doc back into the review queue so it isn't
    // stranded as "confirmed" with no stored file.
    try { documents.update(db, docId, { status: 'needs_review', confirmed_at: null, confirmed_by_username: null }); } catch {}
    return;
  }
  documents.update(db, docId, { stored_filename: fr.filename, stored_path: fr.filePath });
  // Routing slice (SEAM A): capture the total's trust context BEFORE the note-clear below (Oracle A1).
  // Kill-switch-gated ⇒ OFF = no DB read = byte-identical. corrections={} ⇒ wasCorrected=false (a pure
  // machine read — the doc already passed isAutoFileEligible).
  const amountRouting = require('../../services/amountRouting');
  const _routeCtx = amountRouting.amountRoutingEnabled()
    ? amountRouting.captureTotalContext(db, docId, {}, { getExtractedTotalContext: documents.getExtractedTotalContext })
    : null;
  try { db.prepare('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?').run(docId); } catch {}
  // P2 — drop FOREIGN extraction rows (keys not on this doc's type) AFTER the auto-file gate at
  // isAutoFileEligible above has already run on the FULL row set, so a garbled foreign field still
  // HELD this doc exactly as today (the drop can never open the gate — ordering is load-bearing).
  // Kill switch FOREIGN_FIELD_DROP=0. Shared predicate with reviewService + _buildTemplateFields.
  try { require('../../lib/foreignFields').dropForeignExtractions(db, docId, dtInfo); } catch (e) { logger?.warn?.(`foreign-field drop skipped for docId=${docId}: ${e && e.message}`); }
  if (doc.working_path) {
    try { if (fs.existsSync(doc.working_path)) fs.unlinkSync(doc.working_path); } catch {}
    try { documents.update(db, docId, { working_path: null }); } catch {}
  }
  const refField = dtInfo.ref_field_key || 'invoice_number';
  const dateField = dtInfo.date_field_key || 'invoice_date';
  try {
    documents.update(db, docId, {
      supplier_name:    allValues.supplier_name || doc.supplier_name || null,
      doc_date:         allValues[dateField]    || null,
      reference_number: allValues[refField]     || null,
    });
  } catch {}
  _recordAutoFiled(db, docId);
  logger?.log(`Auto-filed (100%): ${doc.original_filename} → ${fr.filename}`);
  try {
    notifyMainWindow?.('doc-auto-filed', { docId, count: getAutoFiledIds(db).length });
    notifyMainWindow?.('review-count-changed', documents.getReviewCount(db));
  } catch {}
  // Slice 1 (learn-on-commit): auto-file is the THIRD commit route — keep the matched template's
  // identity converging on it too, or a supplier whose docs all auto-file would never converge past
  // its first frozen sample. Self-gated on the kill switch (DEFAULT OFF ⇒ byte-identical) + a
  // resolvable same-type/same-supplier template. fail-open — the doc is already filed above.
  try { require('../../../database/modules/templates').learnTemplateOnCommit(db, docId, { document_type_slug: dtInfo.slug, supplier_name: allValues.supplier_name || doc.supplier_name || null }); }
  catch (e) { logger?.warn?.(`[auto-file] learn-on-commit skipped for docId=${docId}: ${e && e.message}`); }

  // Routing slice (SEAM A): auto-create an approval route from the extracted total/type — detached +
  // fail-open (can NEVER disturb the already-completed file). System sender via assignSystem (no human
  // confirmer on auto-file). Self-gated on the kill switch + REAL entitlement (master const, false
  // today) + hasActiveRoute, so a dark build never routes and a running build never strands a locked doc.
  if (amountRouting.amountRoutingEnabled()) {
    Promise.resolve().then(() => amountRouting.startDefaultRoute(db, docId, _routeCtx, {
      supplierName: allValues.supplier_name || doc.supplier_name || null,
      slug: dtInfo.slug, documentTypeId: doc.document_type_id,
    }, _autoFileRouteDeps(db))).catch(() => {});
  }
}

// Deps for the auto-file routing engine (Oracle C2 — the SAME gates as the confirm path, incl. the REAL
// entitlement, not merely the kill switch). assign → assignSystem (NULL "Auto-filed" sender: auto-file
// has no human confirmer). A throwing dep is swallowed by the detached .catch above (fail-open).
function _autoFileRouteDeps(db) {
  const wfDb     = require('../../../database/modules/workflow');
  const trust    = require('../../../database/modules/trust');
  const authDb   = require('../../../database/modules/auth');
  const learning = require('../../../database/modules/learning');
  const { logAudit } = require('../auth/handler');
  const svc = require('../../services/workflowService').createWorkflowService({ audit: (e) => logAudit(db, e) });
  return {
    entitled: (d) => { try { return !!require('../../services/entitlementService').checkClientEntitlement(d).workflow.entitled; } catch { return false; } },
    hasActiveRoute: (d, id) => wfDb.hasActiveRoute(d, id),
    currencyConsistent: (d, sup, slug, fk, v) => trust.currencyConsistentForField(d, sup, slug, fk, v),
    floor: (d) => parseInt(learning.getSetting(d, 'critical_field_conf_floor', '88'), 10) || 0,
    listActiveRules: (d) => wfDb.listActiveRouteRules(d),
    usersByRole: (d, role) => authDb.getAllUsers(d).filter(u => u.role === role),
    assign: (_actor, opts) => svc.assignSystem(db, opts),   // NULL sender — auto-file has no human confirmer
    audit: (e) => logAudit(db, e),
    summarizeRule: (rule) => wfDb.summarizeRule(db, rule),
  };
}

// Rolling list of recently auto-filed doc ids (the "auto-committed" set the Review window
// re-surfaces). Settings JSON {ids, at}; capped at 300, time-bounded to ~7 days.
function getAutoFiledIds(db) {
  const learning = require('../../../database/modules/learning');
  try {
    const o = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '') || 'null');
    if (!o || !Array.isArray(o.ids)) return [];
    if (o.at && (Date.now() - o.at) > 7 * 864e5) return [];
    return o.ids;
  } catch { return []; }
}
function _recordAutoFiled(db, docId) {
  const learning = require('../../../database/modules/learning');
  try {
    const ids = getAutoFiledIds(db);
    if (!ids.includes(docId)) ids.push(docId);
    learning.setSetting(db, 'recent_auto_filed', JSON.stringify({ ids: ids.slice(-300), at: Date.now() }));
  } catch {}
}

// Quit-time teardown: tree-kill every running manual-batch worker (the same
// taskkill /T as the stop-processing IPC) so the app exits clean with no orphaned
// python.exe. Called from main.js before-quit.
function killAll() {
  if (!_currentBatchProcs.length) return;
  _cancelRequested = true;
  for (const proc of _currentBatchProcs) {
    try {
      require('child_process').spawnSync(
        TASKKILL_EXE, ['/F', '/T', '/PID', String(proc.pid)],
        { windowsHide: true, stdio: 'ignore' });
    } catch {}
    try { proc.kill(); } catch {}
  }
  _currentBatchProcs = [];
}

module.exports = {
  register,
  // Exposed so other entry points into the same pipeline (e.g. the
  // watch-folder handler) can reuse this setup/dispatch machinery instead
  // of duplicating it on a parallel import path.
  buildTrainingArgs,
  killAll,
  cleanupTempFiles: cleanupFiles,
  handleFileMessage: _handleFileMessage,
  flushPendingDrains: _flushPendingDrains,
  _genericFallbackId,        // Generic Document fallback pins (test_generic_fallback_mapping.js)
  _resolveDetectedType,      // mig-51 detected-type-nudge pins (test_detected_type_nudge.js)
  _reprocessGenericAdopt,
  _autoTitleEnv,             // Auto-Title spawn env (shared with the watch batch)
  _anchorCropEnv,            // crop opt-in spawn env: right-grow + label left-clamp (shared with the watch batch)
  _reconcileEnv,             // extraction-reconcile opt-in spawn env: prefix-garble adopt (shared with the watch batch)
  drainOriginalToFolder,
  _recordDrain, _takeDrainTally,   // drain-tally pins (test_drain_tally.js — Oracle C1)
  ensureWorkingCopy,
  ensureWorkingCopyAsync,
  reconcileHolding,
  runHoldingReconcile,
  isBatchRunning: () => _anyProcessingBusy(),
  // Watch-folder activity → the Review "documents are being imported" bar (file bumps happen
  // automatically via handleFileMessage). beginWatchActivity(total) on drain, endWatchActivity() when idle.
  beginWatchActivity: (total) => _beginActivity('watch', total),
  endWatchActivity:   ()      => _endActivity('watch'),
  // Shared with the watch-folder handler so it can batch + shard its queue exactly like a
  // manual import (one Python process per shard of MANY files, not one process per file).
  maxConcurrency,
  defaultConcurrency,
  partitionRoundRobin,
  // Exposed for the F-06 path-policy unit test (test_open_path_policy.js).
  _isOpenablePath,
  // Exposed for the reprocess type-flip persistence unit test (test_reprocess_type_flip.js).
  _mergeReprocessRows: mergeReprocessRows,
  _supplierColumnBlanked: supplierColumnBlanked,
  // Exposed for the fast re-extract fill-only merge unit test (test_reextract_merge.js).
  _mergeReextractRows: mergeReextractRows,
  _admitReextractPick: admitReextractPick,
};
