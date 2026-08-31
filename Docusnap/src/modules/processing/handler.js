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
    // Review-bound whole-page STRAIGHTEN + REREAD (DESKEW_SLICE_REREAD_2026-08-30, revised). DARK / default
    // OFF: a doc that would land in review AND whose page is skewed beyond DESKEW_REVIEW_MIN_ANGLE (default
    // 0.3 deg) is re-OCR'd straightened; the straightened read is adopted WHOLE only if it scores a higher
    // overall confidence, and it stays needs_review (never silently auto-filed). Only ever touches a doc
    // already review-bound, so it cannot demote a clean auto-file. Unset => off => byte-identical. Measured
    // to heal 6/8 skew-garbled supplier names on the Nordwind corpus at 200 DPI.
    if (learning.getSetting(db, 'deskew_review_retry_enabled', 'false') === 'true') env.DESKEW_REVIEW_RETRY = '1';
    { const a = learning.getSetting(db, 'deskew_review_min_angle', ''); if (a) env.DESKEW_REVIEW_MIN_ANGLE = String(a); }
    // Reconcile shadow-attribution (gary → Oracle W/COND ×5, 2026-08-12): a corroborated total is
    // no longer capped when the ONLY disagreeing operands are invisible shadow reads.
    if (learning.getSetting(db, 'reconcile_shadow_attribution', 'false') === 'true') env.RECONCILE_SHADOW_ATTRIBUTION = '1';
    // VAT rate-annotation segment skip widening ('VAT @ 20% | £77.55' — reggie 2026-08-12).
    if (learning.getSetting(db, 'vat_rate_at_skip', 'false') === 'true') env.VAT_RATE_AT_SKIP = '1';
    // Self-discharging operator pins (gary → Oracle W/COND 2026-08-12): a pin whose value the
    // pipeline now reads independently is released on reprocess — natural row kept, pin cleared.
    if (learning.getSetting(db, 'supplier_pin_self_discharge', 'false') === 'true') env.SUPPLIER_PIN_SELF_DISCHARGE = '1';
    // Confirmed-dominant adoption (Oracle B1-B5, 2026-08-12): a junk-flagged name read is replaced
    // by the scope's single ≥5×-confirmed literal read on-page — no picker, no confirm demand.
    if (learning.getSetting(db, 'confirmed_dominant_adopt', 'false') === 'true') env.CONFIRMED_DOMINANT_ADOPT = '1';
    // Raw-crop witness (Oracle C1-C6, built 2026-08-12): one untouched read of a code crop may
    // flag (or, per census-evidenced pair, adopt) a one-glyph confusable difference — the serif
    // I→1 / l→i / ACC-229] recipe-ladder class. NEVER flip CODE_SEPARATOR_STRUCTURE_GUARD alone;
    // together, sep-guard AFTER the witness (Oracle C4).
    if (learning.getSetting(db, 'raw_crop_witness_flag', 'false') === 'true') env.RAW_CROP_WITNESS_FLAG = '1';
    if (learning.getSetting(db, 'raw_crop_witness_adopt', 'false') === 'true') env.RAW_CROP_WITNESS_ADOPT = '1';
    // Detail-veto single-supplier immunity (2026-08-23, iris → Oracle W/COND). Placed in this SHARED env
    // helper (spread at the import, watch-batch AND reprocess spawns) — not only buildTrainingArgs — so the
    // switch reaches the REPROCESS path too (a stuck doc is fixed by Reprocess, which does not run the
    // buildTrainingArgs inline block). Default OFF. See template_matcher._detail_veto_single_supplier_immune.
    if (learning.getSetting(db, 'logo_detail_veto_single_supplier_immune', 'false') === 'true') env.LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE = '1';
    // Filing-identity coherence (2026-08-14): `documents.supplier_name` — the FILING FOLDER and
    // the universal LEARNING SCOPE KEY — is taken from engine `_supplier_name`, which is captured
    // BEFORE Stage 4.5, `_adopt_identity_variant` and the late supplier writers can heal the
    // issuer. So a repaired name reaches the extraction row while the document still files and
    // learns under the unrepaired string. Adds a late re-derivation only; every existing consumer
    // of the pre-repair local is untouched. Flip needs the corpus arm (every moved document must
    // move TOWARD the corroborated value, M=0).
    if (learning.getSetting(db, 'identity_scope_post_repair', 'false') === 'true') env.IDENTITY_SCOPE_POST_REPAIR = '1';
    // Hold the siblings (owner decision 4, 2026-08-13). ONE setting, read on BOTH sides: templates.js
    // marks a template pending when a teach replaces its frozen identity with a genuinely different
    // company, and this bridge is what makes the Python stamp yield for it. Bridging only one side
    // would mark templates nothing ever acted on — the dead-toggle failure test_settings_wiring.js
    // exists to catch.
    if (learning.getSetting(db, 'template_identity_hold_siblings', 'false') === 'true') env.TEMPLATE_IDENTITY_HOLD_SIBLINGS = '1';
    // Buyer-issued type scope (slice 2, 2026-08-13): a template taught on a PO the business ISSUED
    // carries the owner's own company, and the owner's name is printed on everything the business
    // RECEIVES — so it claims inbound documents from other suppliers at 95. Marked in JS
    // (templates.markBuyerIssued), refused here in the TEXT arm only, and only against a trusted
    // title of a different type.
    if (learning.getSetting(db, 'template_buyer_issued_type_scope', 'false') === 'true') env.TEMPLATE_BUYER_ISSUED_TYPE_SCOPE = '1';
    // Buyer-issued LETTERHEAD scope (2026-08-27, Chris r6 card 1): a marked template's text arms score the
    // letterhead band only (template_matcher; the JS mirror in templates.js reads the same key directly).
    if (learning.getSetting(db, 'template_buyer_issued_letterhead_scope', 'false') === 'true') env.TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '1';
    // Name lexicon from a LOW-DISTINCT scope (B5, 2026-08-13). format_anomaly_checker discarded
    // every name scope whose confirmed history is one or two DISTINCT values — measured as 33 of
    // 36 scopes on this install — so the shipped name repair was structurally inert exactly where
    // the evidence is strongest. WEAK-ONLY by construction: such a lexicon can suggest and force a
    // review, never silently rewrite.
    if (learning.getSetting(db, 'name_lexicon_low_distinct', 'false') === 'true') env.NAME_LEXICON_LOW_DISTINCT = '1';
    // Name suffix-SNAP (2026-08-24, Oracle SIGN-OFF-W/COND): a solid single-value scope's one-glyph
    // legal-suffix issuer/customer slip ("…Lid"→"…Ltd") silently adopts the confirmed spelling + auto-
    // files, instead of holding a "Suggested … [Resolve]". DARK. It reads the low-distinct name lexicon,
    // so the switch IMPLIES it (turning the snap on can never be inert for want of the lexicon).
    if (learning.getSetting(db, 'name_dominant_snap', 'false') === 'true') {
      env.NAME_DOMINANT_SNAP = '1';
      env.NAME_LEXICON_LOW_DISTINCT = '1';
    }
    // UK company-registration boilerplate strip (iris/gary → Oracle, 2026-08-24). {vat, reg, …} leak
    // into a supplier's branding fingerprint and hand a WRONG logo-collision supplier free own_ratio
    // hits on any "VAT Reg …" line — defeating the logo-text abstain gate (doc 732 Oakhaven→Castellan
    // @94). Stripped from _distinctive_tokens (banks + the Stage-0 tie-break, ONE rule). DARK; OFF is a
    // byte-identical spawn.
    if (learning.getSetting(db, 'branding_strip_reg_boilerplate', 'false') === 'true') env.BRANDING_STRIP_REG_BOILERPLATE = '1';
    // Graduation-licensed fuzzy geometry shed (gary → Oracle W/COND 2026-08-14). The owner's
    // Silverbeck class: a layout confirmed 91×/91 to one issuer whose scanned letterhead reads
    // garbled still carries "Company inferred… please confirm" on every sibling, because the strict
    // geometry shed needs an exact letterhead match. Armed, the note sheds when the recipient-excluded
    // geometry pick reads the graduated issuer FUZZILY (short tokens exact). GRADUATION_WINDOW is
    // threaded ONLY when this is armed, so OFF stays byte-identical. Flip needs the corpus arm +
    // Oracle's flip conditions (owner query on buyer-issued templates; a non-vacuous recipient census).
    if (learning.getSetting(db, 'template_identity_geom_fuzzy_graduate', 'false') === 'true') {
      env.TEMPLATE_IDENTITY_GEOM_FUZZY_GRADUATE = '1';
      env.GRADUATION_WINDOW = String(parseInt(learning.getSetting(db, 'graduation_window', '10'), 10) || 10);
    }
    // ── Corroboration-driven auto-file resolution (2026-08-15, gary → Oracle SIGN-OFF-W/COND) ──
    // The owner's held-queue arc: the DB already carries the correct value (the persisted
    // corroboration record + the scope's dominant confirmed value/format), yet a spurious note or a
    // vacuous corrected_to holds the doc. Each arm reads the SAME licensed-corroboration primitive,
    // is DEFAULT OFF (absent key → byte-identical spawn), and fails toward Review. Extraction-side:
    //   B) ref_dominant_format_note_demote — a rawwitness 1/I note is dropped when the committed ref
    //      already matches the scope's ≥0.90-dominant learned prefix (the note held a RIGHT value).
    //   A) template_identity_corrob_note_shed — a "Company inferred… please confirm" FILL note sheds
    //      from the PERSISTED corroboration (geometry-free, so a cached reprocess still heals) when a
    //      licensed record + graduated dominant issuer agree. Needs GRADUATION_WINDOW threaded.
    //   C) recon_shadow_attrib_note_demote — a doubly-corroborated total's shadow-attribution note is
    //      dropped on a penny-exact VAT re-verify (never changes the total value).
    //   D) snap_confusable_clean_autofile — a symbol-misread of a single-canonical confirmed constant
    //      (']'→'1' → ACC-2291) is snapped-and-adopted when an independent hint family corroborates.
    //   E) name_corrob_suggestion_adopt — a Stage-4.5 name SUGGESTION is ADOPTED (non-identity fields
    //      only) when it equals the scope's dominant confirmed literal AND the page's own keyword read.
    if (learning.getSetting(db, 'ref_dominant_format_note_demote', 'false') === 'true') env.REF_DOMINANT_FORMAT_NOTE_DEMOTE = '1';
    if (learning.getSetting(db, 'template_identity_corrob_note_shed', 'false') === 'true') {
      env.TEMPLATE_IDENTITY_CORROB_NOTE_SHED = '1';
      if (!env.GRADUATION_WINDOW) env.GRADUATION_WINDOW = String(parseInt(learning.getSetting(db, 'graduation_window', '10'), 10) || 10);
    }
    if (learning.getSetting(db, 'recon_shadow_attrib_note_demote', 'false') === 'true') env.RECON_SHADOW_ATTRIB_NOTE_DEMOTE = '1';
    if (learning.getSetting(db, 'snap_confusable_clean_autofile', 'false') === 'true') env.SNAP_CONFUSABLE_CLEAN_AUTOFILE = '1';
    if (learning.getSetting(db, 'name_corrob_suggestion_adopt', 'false') === 'true') env.NAME_CORROB_SUGGESTION_ADOPT = '1';
    // Lever E (2026-08-20, Oracle SIGN-OFF-W/COND): whitespace-normalise the Stage-2.5a issuer-band
    // presence test so a CONFIRMED hint whose letterhead is column-broken ("Silverbeck    Cleaning
    // Supplies") still matches and the "Company inferred… please confirm" note sheds via the
    // graduated confirmed value. Strongest safety path (usage>=3 + no-swap + recipient-truncated
    // band). OFF = byte-identical. Releases the 16 live Silverbeck docs; makes the Review recovery
    // copy honest. Flip needs the live counterfactual (release + no recipient re-admission).
    if (learning.getSetting(db, 'hint_band_ws_normalize', 'false') === 'true') env.HINT_BAND_WS_NORMALIZE = '1';
    // Lever D (2026-08-20, gary → Oracle SIGN-OFF-W/COND, DARK): the geom-witness note shed can't fire
    // on a wide letter-spaced letterhead because reconstruct_page_text column-breaks the name and the
    // strict pick returns one word. This arm re-joins the letterhead-sized name run and sheds when it
    // norm-equals the confirmed fill value (verify-not-assert, fixed-target no-swap). NOT in the shared
    // picker. OFF = byte-identical. Default-ON flip is SEND BACK pending a recipient-collision fixture.
    if (learning.getSetting(db, 'template_identity_geom_fragment_shed', 'false') === 'true') env.TEMPLATE_IDENTITY_GEOM_FRAGMENT_SHED = '1';
    //   P) ref_prefix_confusable_adopt — (2026-08-16, owner-directed PI/P1 class; Oracle S-O-W/C)
    //      adopt the scope's ≥0.90-dominant ref prefix over a single-confusable read head, ONLY with
    //      a page witness (wider read / keyword) + both-forms refusal + learned-shape pass.
    if (learning.getSetting(db, 'ref_prefix_confusable_adopt', 'false') === 'true') env.REF_PREFIX_CONFUSABLE_ADOPT = '1';
    //   Fix #1 (2026-08-28, Oracle S-O-W/C): route the ref-LENGTH-guard note into the P adopt arm
    //   too (the 08-19 widening missed it; invoice_0016-14 held P1/26/1150 with PI/26/1150 already
    //   in corrected_to). Dedicated sub-flag AND-ed with P_on in-engine; DARK until the owner flip.
    if (learning.getSetting(db, 'ref_prefix_confusable_adopt_length_note', 'false') === 'true') env.REF_PREFIX_CONFUSABLE_ADOPT_LENGTH_NOTE = '1';
    //   vacuous-witness suppression (2026-08-16, Chris card 2 → Oracle: SWITCHED, seeded OFF):
    //      a raw-witness "repair landed on the witness" pair no longer emits the unanswerable
    //      self-compare flag when armed (template_mapper._witness_note).
    if (learning.getSetting(db, 'raw_witness_vacuous_suppress', 'false') === 'true') env.RAW_WITNESS_VACUOUS_SUPPRESS = '1';
    // ── Chris round-7 card-1/card-3 switches (2026-08-16, gary → Oracle S-O-W/C; all seeded OFF
    //    by migration 72). Page-match v2: Gate C re-tests "not on this page" against same-line
    //    joins + a prefix-region backed-confusable form before flagging. Vat-reg symfold: a
    //    '$'-mid-run witness (the reg's own misread '5') folds instead of disarming the guard.
    //    Money sign capture: a '-' immediately before a matched amount is kept at the mint.
    if (learning.getSetting(db, 'filing_sanity_page_match_v2', 'false') === 'true') env.FILING_SANITY_PAGE_MATCH_V2 = '1';
    if (learning.getSetting(db, 'vat_reg_symbol_confusable', 'false') === 'true') env.VAT_REG_SYMBOL_CONFUSABLE = '1';
    if (learning.getSetting(db, 'money_sign_capture', 'false') === 'true') env.MONEY_SIGN_CAPTURE = '1';
    // The linchpin (2026-08-15): a demoted note is no longer a format mismatch, so its -12
    // format-consistency penalty must be recomputed off the POST-demote results — else every
    // note-demoter (these arms AND the shipped recon/name/xcheck slices) is cosmetic: the note
    // clears but overall_confidence keeps the penalty and the doc parks below-floor. DEFAULT OFF.
    if (learning.getSetting(db, 'corrob_note_recompute_fc', 'false') === 'true') env.CORROB_NOTE_RECOMPUTE_FC = '1';
    if (learning.getSetting(db, 'crosscheck_outlier_reconcile', 'false') === 'true') env.CROSSCHECK_OUTLIER_RECONCILE = '1';
    if (learning.getSetting(db, 'universal_verify_restore', 'false') === 'true') env.UNIVERSAL_VERIFY_RESTORE = '1';
    if (learning.getSetting(db, 'universal_verify_flag', 'false') === 'true') env.UNIVERSAL_VERIFY_FLAG = '1';
    if (learning.getSetting(db, 'universal_verify_numeric', 'false') === 'true') env.UNIVERSAL_VERIFY_NUMERIC = '1';
    // Slice A edge-debris heal (Oracle 2026-08-03 evening; label-tail '. DN-60902' class).
    if (learning.getSetting(db, 'template_code_edge_clean', 'false') === 'true') env.TEMPLATE_CODE_EDGE_CLEAN = '1';
    // Slice B target word-snap (gated GREEN + flipped ON 2026-08-03 night; Oracle B-F1 met).
    if (learning.getSetting(db, 'template_target_word_snap', 'false') === 'true') env.TEMPLATE_TARGET_WORD_SNAP = '1';
    // NIGHT round (Oracle 2026-08-03): A2/C1 alnum label-tail fragment strip + C2a right-clip
    // clean commit (both dark until their composed gate).
    if (learning.getSetting(db, 'template_code_frag_clean', 'false') === 'true') env.TEMPLATE_CODE_FRAG_CLEAN = '1';
    if (learning.getSetting(db, 'template_clip_commit', 'false') === 'true') env.TEMPLATE_CLIP_COMMIT = '1';
    // Name-unclip reconcile (Oracle 2026-08-04 — DARK until the customer-corpus name gate).
    if (learning.getSetting(db, 'name_unclip_reconcile', 'false') === 'true') env.NAME_UNCLIP_RECONCILE = '1';
    // Jitter-crater arc (Oracle 2026-08-05, all gates green — docs/oracle_log.md): the abs-rung
    // word-edge guard (grow a cut taught box's READ to the full word, witness-corroborated), the
    // date-clip fragment gate + the locate digit-exactness guard. Dark until the owner flip.
    if (learning.getSetting(db, 'template_abs_edge_guard', 'false') === 'true') env.TEMPLATE_ABS_EDGE_GUARD = '1';
    if (learning.getSetting(db, 'template_date_clip_gate', 'false') === 'true') env.TEMPLATE_DATE_CLIP_GATE = '1';
    if (learning.getSetting(db, 'template_label_digit_exact', 'false') === 'true') env.TEMPLATE_LABEL_DIGIT_EXACT = '1';
    // Straighten pivot (Oracle 2026-08-05 late; corpus + Chris-vet GREEN): the level-frame
    // composition — taught boxes rotated to the straightened frame by the teach sample's tilt.
    if (learning.getSetting(db, 'teach_angle_compose', 'false') === 'true') env.TEACH_ANGLE_COMPOSE = '1';
    // Placement pivot (Oracle 2026-08-06, NF gate +1/0-regress): when the edge-guard can't clean-heal
    // a cut taught box, re-seat the value off the LOCAL located label + word-snap and prefer it over
    // the garble (FLAGGED pre-fill for review). Co-requires template_target_word_snap (the y-cure).
    if (learning.getSetting(db, 'template_edge_cut_relocate', 'false') === 'true') env.TEMPLATE_EDGE_CUT_RELOCATE = '1';
    // Clip-commit trailing-glyph slack (Oracle 2026-08-06): a CLIP-misread FINAL glyph no longer
    // false-flags a correct, double-witnessed, shape-confirmed inline read (WS-1493S vs WS-14939).
    if (learning.getSetting(db, 'template_clip_commit_edge_slack', 'false') === 'true') env.TEMPLATE_CLIP_COMMIT_EDGE_SLACK = '1';
    // Invalid taught date yields (Oracle 2026-08-06): an IMPOSSIBLE taught date ('33/04/2026') no
    // longer wins over a valid, confident keyword date — the valid read is kept, flagged for review.
    if (learning.getSetting(db, 'template_date_invalid_yield', 'false') === 'true') env.TEMPLATE_DATE_INVALID_YIELD = '1';
    // Far-future taught date yields (Oracle 2026-08-06): a taught date OCR-misread into an absurdly
    // future year ('2026'->'2096') no longer wins over a valid non-future keyword date; kept flagged.
    if (learning.getSetting(db, 'template_date_future_yield', 'false') === 'true') env.TEMPLATE_DATE_FUTURE_YIELD = '1';
    //   Fix #2 (2026-08-28, Oracle S-O-W/C): the AUTHORITATIVE-side sibling of Lever Z — an
    //   authoritative date anchor OCR-misread into an implausible date (a date-shaped confusable
    //   ref, PI/26/2361->1/26/2361->year 2361) no longer wins Tier-A outright over a valid mapping
    //   date. Separate flag (NOT folded into the date-yield pair, whose Z-2 pin governs them). DARK.
    if (learning.getSetting(db, 'tier_a_date_plausibility', 'false') === 'true') env.TIER_A_DATE_PLAUSIBILITY = '1';
    // Pad-window date read (Oracle 2026-08-06 — the date-crop read ROOT fix). A taught DATE box that
    // clips the value's leading glyph commits a silent still-parses misread; a wider row-bounded read
    // cross-checks it and FLAGS a confident disagreement (keeps the value, routes to review). Dates
    // only (Slice 1); geometric neighbour guard; never silent-swaps. Default OFF, byte-identical off.
    if (learning.getSetting(db, 'template_pad_window_read', 'false') === 'true') env.TEMPLATE_PAD_WINDOW_READ = '1';
    // Pad-window CODE read — the code sibling of the date slice above. A taught CODE box too tight for
    // its value clips the leading glyphs ('PO-48009' -> '-48009') or garbles it; a wider row-bounded
    // re-read of the SAME box either recovers the fuller code (consented strict-suffix SWAP) or FLAGS
    // the disagreement for review. TWO settings, and the LABELLED one is a STRICT SUBSET — it does
    // nothing unless the parent is also on:
    //   • template_pad_window_code          — LABEL-LESS taught boxes (Oracle 2026-08-09). Commits at
    //     78, below the 88 auto-file floor, so it only makes an existing review correct + explained.
    //   • template_pad_window_code_labelled — LABELLED taught boxes (Oracle 2026-08-06 C1..C7). This
    //     one CAN auto-file (labelled tier = 90), which is the point: it replaces a silently
    //     auto-filed CLIPPED value with the full one. Guarded by two-sided consent, a consent-strength
    //     tier cap, a label-glue reject, and suppression whenever the inline reconcile actually formed
    //     an opinion or the read was expanded / already edge-healed.
    // Both default OFF and are byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_pad_window_code', 'false') === 'true') {
      env.TEMPLATE_PAD_WINDOW_CODE = '1';
      if (learning.getSetting(db, 'template_pad_window_code_labelled', 'false') === 'true') {
        env.TEMPLATE_PAD_WINDOW_CODE_LABELLED = '1';
      }
    }
    // CURATED SUPPLIER vs a MISREAD LETTERHEAD (Oracle 2026-08-06). A taught template stores the
    // supplier as a non-variable `fixed_value`, seeded at conf 95 (method `template_fixed`). The
    // Stage-0.5 merge lets a mapping READ of the letterhead displace that seed on authority, so an
    // edge-glyph misread ('Castellan Security Systems' -> 'tastellan Security Systems', or debris
    // like 'ba)') committed a WRONG supplier — a wrong output folder AND a wrong learning scope.
    // Worse, the more corrupted the string the more completely it evaded the branding cross-check,
    // so the worst case was the silent one. These two decline such a read and KEEP the curated seed:
    //   • template_fixed_near_match — the read is the SAME name merely misread (alnum-fold, <=1 edit)
    //   • template_fixed_fragment   — the read is debris (<3 chars) against a real curated name
    // A genuinely DIFFERENT company still wins, so a stale fixed value can still be corrected by
    // re-teaching. Both default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_fixed_near_match', 'false') === 'true') env.TEMPLATE_FIXED_NEAR_MATCH_RECONCILE = '1';
    if (learning.getSetting(db, 'template_fixed_fragment', 'false') === 'true') env.TEMPLATE_FIXED_FRAGMENT_DECLINE = '1';
    // LARGE-TITLE TYPE RECOGNITION (Oracle/herald 2026-08-07). One owner switch enables the whole
    // credit-note-typed-Invoice fix family (all type-changing → default OFF): rung-3 absent-title
    // pixel re-read (the --dpi pass DROPPED the title), the wide-spaced-title gap collapse (a
    // letter-tracked 'CREDIT    NOTE' split at the column-break marker), and the reprocess page-0
    // geometry pass (so the heading rungs fire on a cached reprocess, not just fresh import). App
    // RESTART to load the bridge.
    if (learning.getSetting(db, 'heading_absent_reread', 'false') === 'true') {
      env.HEADING_ABSENT_REREAD = '1';
      env.HEADING_TITLE_GAP_COLLAPSE = '1';
      env.REPROCESS_HEADING_GEOM = '1';
    }
    // TYPE-ELECTION TITLE-FIRST (herald design 2026-08-12 NIGHT — the Meadowvale credit-note-typed-
    // Invoice election defect). One owner switch, three keyword.py kill switches (independent
    // ablation/revert axes): address captions ('bill to') mention-only · strong-heading test may
    // match a top-band non-left column segment · exact-tie prefers the heading-backed candidate.
    // The heading re-read rungs receive detect_document_type as a callable, so the recovered-band
    // election obeys the same flags — one implementation, no split-brain. Default OFF,
    // byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'type_election_title_first', 'false') === 'true') {
      env.TYPE_CAPTION_MENTION_ONLY = '1';
      env.TYPE_HEADING_ANY_SEGMENT = '1';
      env.TYPE_TIE_HEADING_PREF = '1';
    }
    // CORROBORATION STEP 3, slice 1 (gary → Oracle W/COND 2026-08-12 NIGHT): a crosscheck
    // disagreement note on a DATE is released when a crop-side ledger witness corroborates the
    // committed value (the "please verify" on a triple-verified date). Dates only; the dissent
    // survives in the corroboration record. Default OFF, byte-identical off. App RESTART to load.
    if (learning.getSetting(db, 'xcheck_corrob_note_demote', 'false') === 'true') {
      env.XCHECK_CORROB_NOTE_DEMOTE = '1';
    }
    // CORROBORATION STEP 3, slice 2 (gary → Oracle W/COND 2026-08-13): the reconciliation pick's
    // "adjusted to the total that balances" note is released when a crop-side ledger witness reads
    // the SAME total (penny-exact, sign-agreeing) AND the arithmetic re-verifies. Money only; no
    // confidence minted (deliberately below slice 1's E2 posture — money has no shape rail).
    // Dissent survives in the corroboration record. Default OFF, byte-identical off.
    if (learning.getSetting(db, 'recon_total_note_demote', 'false') === 'true') {
      env.RECON_TOTAL_NOTE_DEMOTE = '1';
    }
    // CORROBORATION STEP 3, slice 3 (gary → Oracle W/COND B1-B3, 2026-08-13): the Layer-A
    // name-guard caption-disagreement note is released when a crop-side ledger witness AND a
    // keyword-family read both corroborate the kept name, the dissenters were guard-REJECTED,
    // and no surviving read disagrees. Non-identity name fields only (supplier_name never);
    // no confidence minted. Default OFF, byte-identical off.
    if (learning.getSetting(db, 'name_corrob_note_demote', 'false') === 'true') {
      env.NAME_CORROB_NOTE_DEMOTE = '1';
    }
    // CLASS F — verification-doubt note clear (gary audit 2026-08-26, owner exhibit SuperStore 31901):
    // ONE general rule for the "please check/verify" doubt-note family (taught-box edge cut, read-from-
    // the-surrounding-line, Stage-4.5 trim/re-read). Cleared + the FIELD lifted to 90 iff two DISTINCT
    // page families agree with an un-noted witness AND the value passes the learned shape; deny-by-
    // default allowlist of write-site constants. Default OFF, byte-identical off. Env wins both ways
    // for harness arms.
    // Oracle C4 (flip order): F may only arm where the fc recompute is ON — otherwise the field
    // lifts to 90 but the stale −12 format penalty keeps the doc below-floor with NO note (the
    // "mysterious empty hold"). Enforced here rather than documented: a switch that needs another
    // switch is a switch that silently does the wrong thing.
    if (env.CORROB_VERIFICATION_DOUBT_CLEAR == null
        && learning.getSetting(db, 'corrob_verification_doubt_clear', 'false') === 'true'
        && learning.getSetting(db, 'corrob_note_recompute_fc', 'false') === 'true') {
      env.CORROB_VERIFICATION_DOUBT_CLEAR = '1';
    }
    // LIGHT-TEXT RECOVERY (2026-08-27, oscar recipe + 007 geometry → Oracle; DARK, byte-identical off):
    //   a third supplementary full-page OCR source in ocr/tesseract.py reconstruct_page_text — grayscale →
    //   global threshold (measured: 200) → PSM 3 — merged ONLY into regions the PSM-3 + PSM-6 passes left
    //   empty, so small light-grey print (serial sub-lines, footers, reg strips) Tesseract's own binarisation
    //   drops on scans reaches the page text. Scanned pages only; one extra tesseract call per page.
    //   Env wins both ways for harness arms.
    if (env.OCR_LIGHT_TEXT_RECOVERY == null && learning.getSetting(db, 'ocr_light_text_recovery', 'false') === 'true') {
      env.OCR_LIGHT_TEXT_RECOVERY = '1';
    }
    // RE-SLICE WITNESS SWEEP (2026-08-30, owner arc; oscar recipe + 007 geometry + reggie STOP → Oracle; DARK):
    //   engine stage 4.7, TOTALS only — a noted total whose committed value penny-reconciles but whose taught
    //   zone read disagrees gets the zone RE-READ (pad, no upscale, white border, PSM 6, in-band line pick);
    //   an AGREEING re-read is injected into the per-run ledger as a crop-side witness so the signed
    //   `_demote_recon_total_corroborated_note` can release the "adjusted to the total that balances" note.
    //   Commits nothing; a disagreeing re-read is never injected. Env wins both ways for harness arms.
    if (env.RESLICE_WITNESS_SWEEP == null && learning.getSetting(db, 'reslice_witness_sweep', 'false') === 'true') {
      env.RESLICE_WITNESS_SWEEP = '1';
    }
    // FORMAT-INVALID WITNESS DISCOUNT (2026-08-30, reggie; DARK): a deterministically unreadable amount/date
    //   candidate lands in the record's additive `discounted` list instead of `disagree` (the JS readers
    //   `_corrobLicensed` / `_pageFamilyDisagrees` read the same record unchanged).
    if (env.CORROB_DISCOUNT_INVALID_WITNESS == null && learning.getSetting(db, 'corrob_discount_invalid_witness', 'false') === 'true') {
      env.CORROB_DISCOUNT_INVALID_WITNESS = '1';
    }
    // CELL-BELOW keyword association (2026-08-31, oscar design; DARK): a boxed label-above-value
    //   cell (the caption stands ALONE in its column segment) reads the SAME column segment of the
    //   next line — five precision guards, confidence capped 85 (under the 88 critical floor so a
    //   cell-below ref/date FILLS but never auto-files alone). The Hard Set boxed classes' cold
    //   fill gap (multicol_money/table_total/logo_siblings/credit_sign/multipage/buyer_large read
    //   0-15% cold). Env wins both ways for harness arms.
    if (env.KEYWORD_CELL_BELOW == null && learning.getSetting(db, 'keyword_cell_below', 'false') === 'true') {
      env.KEYWORD_CELL_BELOW = '1';
    }
    // ACCOUNTING-NEGATIVE money captures (2026-08-31, reggie design; both DARK): a whole-segment
    //   "(£908.16)" (parens) or "£908.16 CR" keeps its minus at BOTH mints (keyword _clean_value +
    //   anchor _clean_text_fallback — the twin is what keeps corroboration's money_cents sign
    //   agreement alive). Bare leading/trailing minus stays note-only; the credit_sign_note arms
    //   keep flagging what stays uncaptured. Env wins both ways for harness arms.
    if (env.MONEY_SIGN_PARENS == null && learning.getSetting(db, 'money_sign_parens', 'false') === 'true') {
      env.MONEY_SIGN_PARENS = '1';
    }
    if (env.MONEY_SIGN_CR == null && learning.getSetting(db, 'money_sign_cr', 'false') === 'true') {
      env.MONEY_SIGN_CR = '1';
    }
    // Oracle C1 (2026-08-31, BLOCKING co-residency — the vat_reg_not_amount pattern): a capture
    //   armed without the credit-sign coherence arms leaves the manufactured-minus class (a table
    //   rule OCR'd as '(', a column-bled 'CR' token) SILENTLY negative on an invoice. Arm 3
    //   (validator: negative total on a non-credit type → note) must ride along whenever either
    //   capture is on. Co-residency, not flip order — parens and CR still flip independently of
    //   each other. Pinned in test_money_sign_coupling.js.
    if (env.MONEY_SIGN_PARENS === '1' || env.MONEY_SIGN_CR === '1') {
      env.CREDIT_SIGN_COHERENCE = '1';
    }
    // BUYER-ISSUED CONVENTION NOTE (2026-08-31, gary lever 1; DARK): a buyer-issued PO whose
    //   issuer resolved via a LEARNED machine path (template_fixed / hint_text_match) stays
    //   SILENT only when a same-type supplier_name hint (usage >= 3) backs the convention;
    //   otherwise the field carries a both-parties note and the doc is review-bound. Value
    //   never rewritten; the 07-12 vendor drop untouched. Env wins both ways for harness arms.
    if (env.BUYER_ISSUED_CONVENTION_NOTE == null && learning.getSetting(db, 'buyer_issued_convention_note', 'false') === 'true') {
      env.BUYER_ISSUED_CONVENTION_NOTE = '1';
    }
    // LOCATE ROLE-QUALIFIER (2026-08-31, reggie stop-vocabulary + 007 placement → Oracle; DARK): a taught
    //   bare "Total" mapping's locate (template_mapper._locate_anchor + anchor._locate_in_text_lines) DEMOTES
    //   role-qualified "Total" occurrences (Net/Sub/Goods Total, Total VAT…) using keyword._total_role_collision,
    //   preferring a clean grand total so a floated totals block can't steal the Net line onto the invoice
    //   total. An all-qualified LOCAL window falls through to the page-wide leg; an all-qualified page keeps
    //   today's pick. Env wins both ways for harness arms.
    if (env.TEMPLATE_LOCATE_ROLE_QUALIFIER == null && learning.getSetting(db, 'template_locate_role_qualifier', 'false') === 'true') {
      env.TEMPLATE_LOCATE_ROLE_QUALIFIER = '1';
    }
    // FRAGMENT-CONTAINMENT YIELD (2026-08-31, the CAD8 ⊂ CAD832694 exhibit → Oracle; DARK): at the Stage-1
    //   merge, a taught template_mapping reference read that is a STRICT alphanumeric-prefix FRAGMENT of a
    //   confident (≥85), format-passing keyword read of the SAME code (the _read_inline_box split() truncation)
    //   yields to the fuller keyword value + a neutral both-values note, capped 88 (review-bound). REF-FAMILY
    //   only, NEVER currency/total; the note is never a verification-doubt mark. Env wins both ways for arms.
    if (env.TEMPLATE_FRAGMENT_CONTAINMENT_YIELD == null && learning.getSetting(db, 'template_fragment_containment_yield', 'false') === 'true') {
      env.TEMPLATE_FRAGMENT_CONTAINMENT_YIELD = '1';
    }
    // STRICT MONEY sub-flag of TEMPLATE_FORMAT_FAIL_YIELD (2026-08-30, reggie; DARK): the yield's currency
    //   leg becomes the whole-string `money_strict_shape` (the legacy leg passes '£9 32632.76' as 9.0).
    //   AND-ed with the parent HERE — a sub-flag armed without its parent bridges nothing.
    if (env.TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY == null
        && learning.getSetting(db, 'template_format_fail_yield_strict_money', 'false') === 'true'
        && learning.getSetting(db, 'template_format_fail_yield', 'false') === 'true') {
      env.TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY = '1';
    }
    // BARCODES (2026-08-26, barry → gary design; both DEFAULT OFF, byte-identical off):
    //   barcode_inventory — decode every symbol on the OCR-rendered pages (ocr/barcodes.py) and
    //     persist them (document_barcodes, mig 91) for full-text search; no customer UI.
    //   barcode_field — a field typed 'barcode' is filled from the decode alone (Stage 1.5; every
    //     OCR rung skips it), held with a confirm-once note (no learning yet).
    // Env wins both ways for harness arms.
    if (env.BARCODE_INVENTORY == null && learning.getSetting(db, 'barcode_inventory', 'false') === 'true') {
      env.BARCODE_INVENTORY = '1';
    }
    if (env.BARCODE_FIELD == null && learning.getSetting(db, 'barcode_field', 'false') === 'true') {
      env.BARCODE_FIELD = '1';
    }
    // CREDIT-NOTE SIGN COHERENCE (Oracle 2026-08-07, slice C — DETECTION only). The app has no
    // representation of a signed money value: the readers strip a leading '-' at BOTH sites
    // (anchor.py + keyword.py), so a -£160.32 CREDIT commits as a +£160.32 CHARGE and files silently.
    // This flag adds a pure note-only predicate (validator.credit_sign_note) — it NEVER negates or
    // swaps a value; it flags the incoherence so the doc routes to Review (trust.js:466 blocks
    // auto-file on any noted field) and the operator types the minus. Arms: a credit-typed doc read
    // POSITIVE, an invoice-typed doc read NEGATIVE, and a negative marker in the RAW text the reader
    // did not commit. Slice A (preserve the sign at READ) is NOT built — until it is, this is the only
    // thing standing between a credit note and a sign-inverted filing.
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'credit_sign_coherence', 'false') === 'true') env.CREDIT_SIGN_COHERENCE = '1';
    // VAT REGISTRATION NUMBER read as a TAX AMOUNT (Oracle 2026-08-07, gate green). A letterhead
    // prints "... VAT Reg GB 651 0027 84"; the bare "VAT" label matches it, the scan is top-down, and
    // number_format rule 3 mints "651 0027 84" into "651 0027.84" (a UK VAT number is grouped 3-4-2,
    // so its last group is always two digits) — which then passes currency validation. Measured: an
    // identical '0027.84' on all 13 documents of one supplier, poisoning subtotal+tax so ~12 CORRECT
    // documents carried "the total doesn't add up" and were capped at conf 50.
    //
    // FLIP ORDER IS BLOCKING: credit_sign_coherence must be ON first. The poisoned-VAT note is the
    // accidental checkpoint currently holding the sign-wrong credit notes; clearing it with the sign
    // detector off would recreate the 2026-08-06 incident (a credit filed as a charge).
    //
    // PAIRED WITH net_misread_total_flag ON PURPOSE. Removing the phantom tax also disarms the
    // "total looks like the subtotal (tax not included)" arm, which needs a tax to be present — so a
    // NET-as-gross total would lose a TRUE flag. Measured over 288 corpus docs: false alarms 39 -> 0,
    // true flags 16 -> 12 with the guard alone, restored to 15 by the net flag, which adds ZERO false
    // flags. Flip them together; flipping vat_reg alone trades false alarms for four silent wrong
    // totals. App RESTART to load the bridge.
    // ORACLE C2 (BLOCKING): this is a CO-RESIDENCY condition, not merely a flip ORDER — the sign
    // detector must be on WHENEVER this guard is, at every point in time. The two sit on separate
    // Settings rows, so an operator could switch credit-sign off next month and silently recreate
    // the incident. Arming this guard therefore FORCES the sign detector on for the run rather than
    // trusting the rows to stay in step.
    if (learning.getSetting(db, 'vat_reg_not_amount', 'false') === 'true') {
      env.VAT_REG_NOT_AMOUNT = '1';
      env.CREDIT_SIGN_COHERENCE = '1';
    }
    if (learning.getSetting(db, 'net_misread_total_flag', 'false') === 'true') env.NET_MISREAD_TOTAL_FLAG = '1';
    // TAUGHT LABEL-ABOVE MAPPING read the caption instead of the value (007 rounds 1+2, `d3cca7c`).
    // `_target_inline_with_anchor` answers "did the operator teach this value on the label's OWN
    // ROW?" and answered it with max(anchor_h, target_h, _DRIFT_FLOOR). _DRIFT_FLOOR (0.02) is a
    // DRIFT constant — "has the page moved a row?" — not a same-row tolerance: on an A4 render it is
    // ~70px, i.e. 1.5-3 line pitches, so boxes one to three lines apart were called "inline" and the
    // rung admitted exactly the label-ABOVE layouts its own docstring excludes. The caption then
    // outscored the code on LSTM confidence and committed ('Delivery' as a delivery_number).
    // Fix is the DEFINITION, not a constant: tol = (anchor_h + target_h) / 2. DPI-invariant.
    // ONE PREDICATE GATES BOTH `_inline_code_reconcile` call sites (the drift rung and the absolute
    // rung), which is why isolating one of them healed 1 of 5 and looked like a refutation.
    // NAMED SEAM (what this DISABLES): a label-above mapping whose geometric read fails no longer
    // gets a same-row second chance — it falls to the registration fallback and then omits the field,
    // i.e. to REVIEW. A recall trade in the safe direction, not a free win.
    // Gate: Pelican A/B 5 healed / 0 regressed with both reconciles still ARMED; the two other
    // label-above mappings on that template (delivery_date, customer_name) 0 moved / 0 emptied;
    // realdoc 714 docs report AND per-doc jsonl byte-identical; cross-template census 38 taught
    // mappings, 35 already inline, 3 change and all 3 on one template. Default OFF. App RESTART.
    if (learning.getSetting(db, 'template_inline_row_overlap', 'false') === 'true') env.TEMPLATE_INLINE_ROW_OVERLAP = '1';
    // A CAPTION IS NOT A REFERENCE (reggie slice 1, `7a02422`). PO_REF_DIGIT_GATE encodes a
    // corpus-proven fact — an order-family reference is a CODE, a spaceless run bearing >=2 digits,
    // never a caption or footer prose. The PREDICATE was right; its ARMING was the literal pair
    // ('po_number','sales_order_number'), so every OTHER reference field on every type had no
    // value-side gate at all. Widened to the REF ROLE via _infer_validation(key) == 'alphanumeric',
    // the same role inference Stage 1 already trusts to seed a custom field's format gate — so a
    // CUSTOM type's reference field is covered on the same footing as a built-in one.
    // Newly armed on this install: credit_note_number, delivery_number, invoice_number,
    // reference_number. STRICT SUBSET: PO_REF_DIGIT_GATE=0 still disables both tiers.
    // Recall measured BEFORE building: across all 713 CONFIRMED values of those fields, ZERO fail
    // the digit predicate ('PD/26/6680', 'PO 22954', 'DN-98447' all still read).
    // Gate: customer corpus 0 true->false, 7 false->true (ref 45.4% -> 47.9%), every other lane
    // byte-identical; realdoc 714 byte-identical. The heals FALL THROUGH to the correct value —
    // the gate's `continue` moves to the next label, which finds the real code.
    // EXPECT A THROUGHPUT CHANGE, NOT AN ACCURACY ONE: a document that used to commit a caption may
    // now arrive EMPTY and route to review. Default OFF. App RESTART to load the bridge.
    if (learning.getSetting(db, 'ref_role_digit_gate', 'false') === 'true') env.REF_ROLE_DIGIT_GATE = '1';
    // A ⊕ TAUGHT ANCHOR HARVESTED THE NEXT BLOCK'S HEADING (2026-08-08, live defect). The label
    // locate searches a FULL-PAGE-WIDTH strip at the label's row on purpose — a key/value value can
    // sit in a far column — and cluster_value_words only splits the post-label words into gap-runs
    // and keeps the run nearest the label; a SINGLE run is returned unchanged. So on a two-block
    // address layout ("CUSTOMER …" left, "SHIP TO …" right, printed on ONE OCR row) the neighbour's
    // HEADING is the only thing after the label and became the value: 9 live Pelican documents
    // committed 'sui'/'sup'/'sup to' at conf 70-82 from 0.45 of a page away, while each one's ledger
    // also held the correct 'Bramblewood Joinery Ltd' at conf 90. NO absolute label→value distance
    // test existed on this path — the gap clustering is RELATIVE, so it cannot reject a far column
    // that is the only thing there.
    // The anchor already carries the answer: expected value CENTRE = located label + TAUGHT OFFSET
    // (migration 21), which is what the crop rung already computes. The veto compares the harvest to
    // it with the label veto's OWN tolerances, and can only ever DROP the harvest — the crop read
    // seated at that same taught offset then runs, which on this class lands on the name, so the
    // expected outcome is a HEAL rather than a fall to review.
    // Unverifiable => ACCEPT: no usable offset (legacy pre-migration-21 anchors) or no per-word
    // geometry stays byte-identical, as does OFF.
    // NAMED SEAM (what this does NOT cover): the third inline consumer, the ref/date crosscheck, is
    // deliberately unguarded — it never commits the harvest, only flags a disagreement, so a
    // wrong-column harvest there costs a needless review rather than a wrong value.
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'anchor_inline_taught_offset_veto', 'false') === 'true') env.ANCHOR_INLINE_TAUGHT_OFFSET_VETO = '1';
    // ── THE MONEY SLICE (2026-08-09; Oracle SIGN-OFF-WITH-CONDITIONS, C1-C7 closed `c027d86`) ──
    // Measured on the owner's LIVE taught state over 145 corpus siblings, at the app's own render
    // DPI: totals 87 ok / 32 wrong / 1 empty -> 119 / 1 / 0. +32 healed, 0 regressed, and all eight
    // other lanes byte-identical between the two arms. Two independent mechanisms:
    //
    //  • TEMPLATE_DRIFT_ROW_PITCH — `_label_drifted` floors its VERTICAL tolerance at
    //    _DRIFT_FLOOR = 0.02 page-height while body text runs ~0.013 per row, so a genuine ONE-ROW
    //    label move measures as "not drifted", the stationary taught box stands, and it reads the
    //    VAT row. On money that value is type-valid and nothing downstream can see it: 19 of 23
    //    wrong totals were EXACTLY the truth / 6 — the arithmetic fingerprint of a 20% VAT row.
    //    ARMED ONLY FOR AN EXACTLY-MATCHED LABEL, and that narrowing is measured, not cautious: a
    //    blanket floor drop regressed 14 non-money fields in a second taught state, because the
    //    floor was ALSO shielding fuzzy label mis-matches ('Credit Ref' answered by 'Credit Date').
    //
    //  • TEMPLATE_CURRENCY_EDGE_GROW — money is RIGHT-ALIGNED, so a value longer than the taught
    //    sample overflows LEFT ('£10,603.44' read as '0,603.44') and currency was absent from the
    //    frozenset scoping the repair. DEPENDENCY, record it or a flip looks like a bug: this flag
    //    is INERT unless `template_target_word_snap` (snap leg) or `template_abs_edge_guard` (guard
    //    leg) is also on. Both are already true on this install.
    //    Its adopt is gated by `_money_snap_proof` (Oracle C3): a snapped money read is refused when
    //    the un-snapped box read is a well-formed amount and the snapped read is that amount with
    //    LEADING digits dropped — money's only failure direction.
    //
    // EXPECT A CONFIDENCE CHANGE, NOT ONLY A VALUE ONE: five documents move from template_mapping
    // (90, auto-file eligible) to template_mapping_edgecut (70 + a review note) with the value
    // unchanged. That is the safe direction — 0 fields GAINED auto-file eligibility, 5 lost it.
    // Default OFF, byte-identical off (proven: OFF arm md5-identical to the pre-edit baseline,
    // n=145). App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_drift_row_pitch', 'false') === 'true') env.TEMPLATE_DRIFT_ROW_PITCH = '1';
    if (learning.getSetting(db, 'template_currency_edge_grow', 'false') === 'true') env.TEMPLATE_CURRENCY_EDGE_GROW = '1';
    //  • TEMPLATE_NAME_EDGE_GROW — NAME leg of the edge guard (2026-08-11 flush-edge clip class):
    //    the teach snap's trailing pad is thinner than sibling drift, so a stored name box sits
    //    flush against its last glyph and a drifted sibling shears it ('Ltd' reads 'Ltc').
    //    Right-edge cut only, last-token-only repair, page-present witness, FLAG-ONLY commit
    //    (<=70 + note) — never a clean heal, declines silent. INERT unless template_abs_edge_guard
    //    is also on (nested like the currency leg).
    if (learning.getSetting(db, 'template_name_edge_grow', 'false') === 'true') env.TEMPLATE_NAME_EDGE_GROW = '1';
    // ── THE TEACH-SIDE PAIR (2026-08-09 morning arc; bridged 2026-08-09 evening) ──
    // Both were measured on 140 unseen siblings of 10 taught documents and then left env-only, so
    // neither could be reached from the app at all: `npm start` is a plain `electron .` with no env
    // injection, which is how the two headline wins of that arc ended up unreachable in the product.
    //
    //  • TEACH_ANGLE_COMPOSE_SCAN — a taught box is stored in the TEACH page's frame, and a sibling
    //    scan sits at its own slight tilt, so the box lands rotated relative to the value: about
    //    half a line of shear, which is exactly enough to drop a 2-row free-text box onto the
    //    caption or the address row. This composes the taught box onto THIS page's measured tilt.
    //    NOT A DESKEW — `detect_skew_angle` only measures; no pixel is rotated, so the page,
    //    ocr_text, page-0 geometry, the logo phash and every learning write stay in one frame.
    //    Oracle ruled AGAINST straightening the pixels for this: the +213-cell gain came entirely
    //    from a tilt band Tesseract already self-tolerates and which this project measured making a
    //    REAL scan worse; re-run at a 2.0 degree floor the whole heal vanished.
    //    RELATION TO THE EXISTING `teach_angle_compose` TOGGLE: siblings, mutually exclusive BY
    //    CONSTRUCTION (engine.py — that branch requires `raw_pages`, this one requires their
    //    absence). `raw_pages` exists only when the document was deskewed at import, and
    //    `deskew_on_import` is off, so on the ordinary import path the older toggle never reaches
    //    its own gate and THIS is the one that does the work. Turning both on is safe.
    //
    //  • TEMPLATE_FIXED_ISSUER_REPAIR — 42 of 135 documents read something other than the curated
    //    issuer: 15 an OCR garble of it, 27 not a company name at all (a date line, a registration
    //    code, a page heading). The app already prints "Letterhead may read 'X' — detected 'DATE
    //    14-03-2026 Job Ref JB-8887'" and then asks the operator to confirm what it has itself
    //    worked out; this lets it act on that. NOT an authority flip: both branches only DECLINE a
    //    read and keep the curated seed, so a genuinely different company still displaces it and a
    //    stale seed is still fixed by re-teaching.
    //
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'teach_angle_compose_scan', 'false') === 'true') env.TEACH_ANGLE_COMPOSE_SCAN = '1';
    if (learning.getSetting(db, 'template_fixed_issuer_repair', 'false') === 'true') env.TEMPLATE_FIXED_ISSUER_REPAIR = '1';
    // ── THE ISSUER CURE (2026-08-09 NIGHT; Oracle FINAL RULING "the layer MOVED") ──
    //  • TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE — the Stage-0.5 registration arbiter treats ABSENT
    //    anchor evidence as REFUTED anchor evidence. `anchor_stable == False` is meant to say "this
    //    field's own caption was looked for and could not prove the page is stable"; for a mapping
    //    with no caption it only says "nothing was ever looked for". The arbiter then overrides a
    //    perfectly good taught-box read on a GLOBAL page-transform divergence, with no local
    //    evidence that this particular box moved.
    //    ONLY THE ISSUER SUFFERS, and structurally: `template_field_mappings.anchor_text` is NULL
    //    for `supplier_name` on all seven templates on this install (a letterhead company name has
    //    no printed caption to search for), while every other field carries one ('BILL TO',
    //    'Balance Due', 'VAT Reg No') and can therefore shut this door itself.
    //    MEASURED: the issuer lane is 118 ok / 22 wrong; all 22 were won by `template_registration`
    //    at conf 78-84, committing document titles, address lines and VAT lines. A diagnostic arm
    //    with registration switched off entirely scores 140 / 0 / 0 on the same documents — the
    //    taught boxes were right on all 22 and the arbiter was discarding their answers.
    //    NOT "turn registration off": it earns its place elsewhere (vat_no 100/40 on vs 92/48 off).
    //    PINNED TRADE-OFF: a mapping WITH a caption that simply failed to locate still takes the
    //    registration branch — "looked for and not found" is evidence about the page.
    //    Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_reg_arbiter_anchor_evidence', 'false') === 'true') env.TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE = '1';
    //  • TEMPLATE_ISSUER_REGION_PRESENCE — the standing guard behind that cure. With the arbiter
    //    silenced for a caption-less mapping, an issuer box on a genuinely drifted page has no
    //    drift compensation left, and whatever garble it reads can still displace the confirmed
    //    company name. This checks the page instead of the layout: is the confirmed name actually
    //    printed where the operator drew the box (region padded to 150%)? Found -> keep the
    //    confirmed name. Not found, or the region could not be read -> today's behaviour exactly.
    //    It can only ever KEEP what was already there — it never raises a confidence and never
    //    overrides a genuinely different company. Off by default. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_issuer_region_presence', 'false') === 'true') env.TEMPLATE_ISSUER_REGION_PRESENCE = '1';
    //  • TEMPLATE_FIXED_SEED_AGREEMENT_KEEP — when the taught box reads EXACTLY the company name
    //    the operator confirmed, that reading is CORROBORATION, not a correction. Today the reading
    //    replaces the confirmed name with itself at a lower certainty (95 -> 78), which pushes four
    //    measured documents below the band where Scan Finder will file without asking. With this on
    //    the confirmed name simply stands. A document from a genuinely different company still comes
    //    through, and re-teaching still replaces a name that has gone out of date.
    //    SEAM, and the reason this is its own switch: keeping the confirmed name also keeps it under
    //    the letterhead cross-checks, one of which can BLANK a sender it cannot find on the page.
    //    Off by default. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_fixed_seed_agreement_keep', 'false') === 'true') env.TEMPLATE_FIXED_SEED_AGREEMENT_KEEP = '1';
    // P4 (2026-08-22, the owner's stacked wordmark): a taught issuer box that reads ONE line of a
    // two-line logotype is a PARTIAL read of the curated name, not a different company — keep the
    // template_fixed seed when the read is a whole-token sub-run of it and the issuer band prints
    // the whole name as a stack. Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_fixed_seed_fragment_keep', 'false') === 'true') env.TEMPLATE_FIXED_SEED_FRAGMENT_KEEP = '1';
    // The garbled-issuer arc (2026-08-22 evening; gary → Oracle SIGN-OFF-W/COND, all DARK):
    //  • TEMPLATE_FIXED_SEED_FRAGMENT_GARBLE — slice 1: the P4 keep above tolerates ONE edit per
    //    ≥6-char read token ('NOCUMENT' for DOCUMENT) — the same per-token rule as the graduated
    //    geometry arm — with the band leg untouched and a sister-company exclusion. Needs P4 ON.
    //  • IDENTITY_SUGGEST_CANONICAL — slice 2: beside the "Letterhead may read X" note the engine
    //    carries X in `suggested_supplier` (the branding-resolve button: fill + pin + ripple) and
    //    clears the Stage-4.5 token repair from corrected_to — only when the read is a GARBLE of X.
    //  (slice 3 `review_group_by_letterhead` is read by the Review window + reviewService directly.)
    if (learning.getSetting(db, 'template_fixed_seed_fragment_garble', 'false') === 'true') env.TEMPLATE_FIXED_SEED_FRAGMENT_GARBLE = '1';
    if (learning.getSetting(db, 'identity_suggest_canonical', 'false') === 'true') env.IDENTITY_SUGGEST_CANONICAL = '1';
    // Chris round 17 card 2(a): the WIDE debris leg ('Gay' / 'MENT' never displace a curated seed; needs the
    // on-page guard, which the Python side checks itself). Default OFF.
    if (learning.getSetting(db, 'template_fixed_debris_wide', 'false') === 'true') env.TEMPLATE_FIXED_DEBRIS_WIDE = '1';
    // A2 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND, DARK): Fix A's
    // "letterhead used for several document types" hold is WAIVED when every rival type on the
    // letterhead has <2 confirmed docs (counts live) AND the document's OWN reference, read by a
    // located method, carries this sender's usual prefix. Delays the hold from a rival's 1st to its
    // 2nd confirm; never widens the class. Kill: setting off / env =0.
    if (learning.getSetting(db, 'type_ambiguity_unsupported_waiver', 'false') === 'true') env.TYPE_AMBIG_UNSUPPORTED_WAIVER = '1';
    // P1 (2026-08-22): the cold letterhead pick abstains on one line of a stacked wordmark
    // ("TIONS" under "DOCUMENT") and never takes a single word deeper than the text arm's band
    // cap ("Patrick", an address tail). Default OFF, byte-identical off.
    if (learning.getSetting(db, 'letterhead_stack_abstain', 'false') === 'true') env.LETTERHEAD_STACK_ABSTAIN = '1';
    if (learning.getSetting(db, 'letterhead_depth_guard', 'false') === 'true') env.LETTERHEAD_DEPTH_GUARD = '1';
    // -- THE 2026-08-08 TEACH-SIDE TRIO + THE FILING SANITY FLAGS (bridged 2026-08-09 NIGHT) --
    // All four were built, MEASURED and then left env-only, which in this app means unreachable:
    // `npm start` is a plain `electron .` and injects no environment. They have been dark in the
    // product ever since, and the corpus numbers quoted for them describe a configuration no
    // install could actually run. Bridging is not approval - each still ships OFF.
    //
    //  - STAGE05_REF_CODE_GATE: a taught box that reads its own printed caption ('Ref', 'Account',
    //    'Delivery') commits that caption as the reference. A reference-role value is a CODE, so a
    //    value carrying no digit at all is refused and the field falls through to review.
    //  - KEYWORD_GENERIC_CAPTION_EXCLUSIVE: every reference-role field is seeded the same generic
    //    caption bank, so ONE printed code could be captured into THREE different fields. When a
    //    field owns the caption by its own label, the generic captures of the same value lose.
    //  - TYPE_TITLE_OWNER_PRECEDENCE: document-type election is a bucket SUM, so a type the install
    //    created that owns one phrase loses to a built-in type owning a whole vocabulary. A template
    //    taught against the losing type then binds to a slug its own siblings can never be detected
    //    as: 35 documents matched no template at all and the operator got no signal. Re-ranks only
    //    when exactly ONE installed type prints its own name as a standalone heading in the top band.
    //  - FILING_VALUE_SANITY_FLAGS: FLAG ONLY, never edits or replaces a value. A reference whose
    //    shape is OCR noise (mixed case inside a token AND no run of 3+ digits), or a date whose
    //    year appears nowhere on the page, gets a note - and a noted field cannot auto-file.
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'stage05_ref_code_gate', 'false') === 'true') env.STAGE05_REF_CODE_GATE = '1';
    if (learning.getSetting(db, 'keyword_generic_caption_exclusive', 'false') === 'true') env.KEYWORD_GENERIC_CAPTION_EXCLUSIVE = '1';
    if (learning.getSetting(db, 'type_title_owner_precedence', 'false') === 'true') env.TYPE_TITLE_OWNER_PRECEDENCE = '1';
    if (learning.getSetting(db, 'filing_value_sanity_flags', 'false') === 'true') env.FILING_VALUE_SANITY_FLAGS = '1';
    // LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE (2026-08-23, iris → Oracle SIGN-OFF-W/COND): the detail-hash
    // veto crops the top-LEFT quadrant, so a CENTRE-top logo is clipped and it hashes a wordmark LETTER —
    // colourway-unstable + collides with other suppliers' round glyphs, so a doc's own mark "disagrees with
    // itself" and a rival lands marginally, false-abstaining a dist-2 single-supplier lock (the Oakhaven
    // class). When on, a corroborated single-supplier lock tripped by a MARGINAL rival (detail dist >48) is
    // immune; a DECISIVE rival (≤48, the doc-193/buyer-issued class) still vetoes. Default OFF, byte-identical
    // off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'logo_detail_veto_single_supplier_immune', 'false') === 'true') env.LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE = '1';
    // -- THE COLD-START ISSUER READER (bridged 2026-08-09 NIGHT) --
    // LETTERHEAD_ISSUER: on a document from a supplier the app has NEVER SEEN, there is no logo,
    // no hint, no anchor and no template, so every identity path abstains and the sender comes out
    // EMPTY - on a page whose first printed line is the company's own name. Measured on a fresh
    // install with 200 documents: 60 of them, three suppliers, sender blank on every one, while the
    // letterhead reads 'Harrowgate Timber Supplies' at the top of the page.
    // The reader for this is BUILT, pinned (src/windows/review/test_letterhead_note_contract.js)
    // and has been unreachable since the day it shipped, because it is read from the environment
    // and `npm start` injects none.
    // IT SUGGESTS, IT NEVER ASSERTS: the value stays empty and the operator gets the name plus a
    // one-click "Use 'X'" button, because a wrong assert here would plant a poisoned learning
    // SCOPE that future documents are then attracted to. After one confirm the supplier has a
    // hint, a logo and a template, and every later document resolves without this.
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'letterhead_issuer', 'false') === 'true') env.LETTERHEAD_ISSUER = '1';
    // -- COLD-START ISSUER PREFILL (slice 0, Chris round-11 card #4; gary->Oracle
    // SIGN-OFF-WITH-CONDITIONS 2026-08-21, DEFAULT OFF) --
    // LETTERHEAD_PREFILL: when LETTERHEAD_ISSUER read a cold-start letterhead name, land it IN the
    // Document Issuer box (confidence 69, review-bound by that AND a note) instead of leaving it
    // blank behind a "Use 'X'" button - one Confirm instead of a per-document click on a 200-doc
    // first batch. Plants NO learning (the row is needs_review; only a human confirm writes a
    // scope) and can never auto-file (the note is the block). Requires letterhead_issuer ON.
    // Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'letterhead_prefill', 'false') === 'true') env.LETTERHEAD_PREFILL = '1';
    // -- LETTERHEAD FRAGMENT ABSTAIN (Slice 0 of the teach->file arc, Chris round-12 card #2;
    // gary->Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-21, DEFAULT OFF, mig 79) --
    // LETTERHEAD_FRAGMENT_ABSTAIN: the geometry letterhead pick abstains instead of returning a lone
    // word ('Cleaning') when a letterhead-sized, name-shaped segment sits beside it on the same row
    // ('Silverbeck    Cleaning    Supplies' reconstructs as three column segments and the generic
    // tail fails the distinctive-core gate, so the middle word won on height alone and was
    // PRE-FILLED as the company). Empty beats a guess; the text arm still runs. Never re-joins in
    // the assert path (Oracle). Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'letterhead_fragment_abstain', 'false') === 'true') env.LETTERHEAD_FRAGMENT_ABSTAIN = '1';
    // -- THE WRONG-COMPANY MISFILE (2026-08-10) --
    // TEMPLATE_IDENTITY_ON_PAGE: a layout may only claim a document that actually names its company.
    // Confirming ONE purchase order created a template for that supplier - and on a document the
    // business ISSUES ITSELF the letterhead is its OWN, so the layout's recognition fingerprint was
    // the OWNER's address block, which is printed on EVERY document the business RECEIVES as the
    // delivery address. It matched 8 words out of 10 on every supplier in the test set, and the
    // keyword matcher has no minimum score - a layout need only BEAT the others, never be good. 18
    // delivery notes from a different company were claimed and stamped with the wrong sender at 95%,
    // and one was confirmed by a user and FILED INTO THE WRONG COMPANY'S FOLDER.
    // Measured on a fresh import: wrong senders 18 -> 1, wrong account numbers 36 -> 19, and 17
    // references, dates and order numbers RECOVERED (they had been read off the wrong layout's
    // geometry). Nothing regressed. Default OFF, byte-identical off. App RESTART to load the bridge.
    if (learning.getSetting(db, 'template_identity_on_page', 'false') === 'true') env.TEMPLATE_IDENTITY_ON_PAGE = '1';
    // -- THE TWO 08-09 FLAGS THAT WERE NEVER REACHABLE (bridged 2026-08-10) --
    // Both were built, measured and recorded as "awaiting the owner's flip" — but neither had a
    // bridge, and `npm start` injects no env, so THERE WAS NOTHING TO FLIP: the only way to reach
    // them was a harness arm. This is the same class as the five flags bridged on 08-09 NIGHT;
    // measuring a flag and shipping a flag are two different things, and a flag with no bridge is
    // shipped OFF for ever. Both remain DEFAULT OFF and byte-identical off. App RESTART to load.
    //
    // TEMPLATE_FORMAT_FAIL_YIELD: a taught box whose read FAILS its own field's format yields to
    // the next rung instead of committing the malformed value ('Account', 'L922.14').
    if (learning.getSetting(db, 'template_format_fail_yield', 'false') === 'true') env.TEMPLATE_FORMAT_FAIL_YIELD = '1';
    // CUSTOMER_PO_LABELS: on a document a SELLER issues, "Your Order" / "Your PO" names the
    // CUSTOMER's purchase-order number, which is a different field from the seller's own po_number.
    if (learning.getSetting(db, 'customer_po_labels', 'false') === 'true') env.CUSTOMER_PO_LABELS = '1';
    // CODE_SEPARATOR_STRUCTURE_GUARD: the single-token separator repair assumes any '/' inside a
    // spaceless code is an OCR artefact, so a reference that PRINTS its separators ('PI/26/6000')
    // is re-read with a whitelist that cannot emit '/' and committed as 'PI266000'. Measured on the
    // live install: 36 committed invoice_numbers had lost a separator their own page still prints.
    if (learning.getSetting(db, 'code_separator_structure_guard', 'false') === 'true') env.CODE_SEPARATOR_STRUCTURE_GUARD = '1';
    // VAT_EU_FORMATS: `vat_no`'s shipped format is UK ONLY, so a supplier in Ireland, Germany or
    // France reads empty and an operator who types the correct number is warned it is wrong. Adds
    // per-country structures with exact element counts (never a generic two-letters rule, which
    // would readmit the measured OCR garbles). The renderer's twin lives in review/handler.js
    // `get-validation-patterns` — the two MUST be flipped by the same setting or UI and pipeline
    // disagree about the same value. A THIRD reader, `database/modules/trust.js`
    // `_sharedValidationPatterns` (freeze_guard + the auto-file checksum), deliberately does NOT
    // widen; the reasoning is recorded there.
    if (learning.getSetting(db, 'vat_eu_formats', 'false') === 'true') env.VAT_EU_FORMATS = '1';
    // LIST_FIELD_SCAN (2026-08-11, gary + Oracle): a field typed 'list' is collected by the label
    // scan — EVERY occurrence of its caption on the page, deduped, joined '; ' (owner: "scans the
    // whole doc for the label and pulls all occurrences"). Also arms the ownership skips (a list
    // field is never written by the mapping/anchor/hint rungs — one box cannot hold N values; the
    // live serials teach committed its own caption 24 times proving it). OFF -> byte-identical,
    // and the 'list' type is hidden from the field-type dropdown.
    if (learning.getSetting(db, 'list_field_scan', 'false') === 'true') env.LIST_FIELD_SCAN = '1';
    // TEMPLATE_HIDDEN_FIELD_DROP (gary 2026-08-11): a field the operator declared absent for a
    // layout ("Field visibility") is never FILLED by extraction — one choke point before Stage 4
    // — and the reprocess merge stops resurrecting stored fills (JS side reads this same setting).
    // Without it a wrong fill returned on every reprocess: "when I remove them they return again."
    if (learning.getSetting(db, 'template_hidden_field_drop', 'false') === 'true') env.TEMPLATE_HIDDEN_FIELD_DROP = '1';
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
// Q3 (2026-08-22, Oracle C3.1): the quiet lane's LAYOUT arm — an authoritative anchor / template
// mapping write re-reads the scope's TEMPLATE-CARRYING held siblings (the manual "Reprocess N"
// population, press removed). DARK: env QUIET_REREAD_ON_LAYOUT wins both ways, else the setting.
function _layoutRereadEnabled(db) {
  const env = process.env.QUIET_REREAD_ON_LAYOUT;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('../../../database/modules/learning').getSetting(db, 'quiet_reread_on_layout', 'false') === 'true'; }
  catch { return false; }
}
// Chris r18 A1 (2026-08-23): the first-fill reliability hold (DARK). K is a NAMED constant: one witness
// (an S3-C5 disagreement, a valued→empty loss or an engine taught-box yield) on a role field in one lane
// job holds that field's uncorroborated first-fills in the job — a first-fill is single-witness by
// definition. The audit-replay census (TESTING/_measure/first_fill_reliability_census.js) is the only
// evidence for raising K; do not raise it on a guess.
const FIRST_FILL_UNRELIABLE_K = 1;
function _firstFillReliabilityEnabled(db) {
  const env = process.env.QUIET_REREAD_FF_RELIABILITY;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('../../../database/modules/learning').getSetting(db, 'quiet_reread_first_fill_reliability_hold', 'false') === 'true'; }
  catch { return false; }
}
// Chris r19 N1 (Oracle P1, 2026-08-23): the MANUAL "Reprocess N" / single-doc Reprocess road writes the
// SAME holds the quiet lane writes (S3-C5 with the C1 baseline, the first-fill hold, the reliability
// release) — four wrong dates filed through this road at 93 % "Nothing looks wrong" while the lane held
// the same slip on Larkspur. A behaviour change for a shipped, owner-ON feature → its own DARK switch.
function _reprocessHoldsEnabled(db) {
  const env = process.env.REPROCESS_HOLDS_AS_LANE;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('../../../database/modules/learning').getSetting(db, 'reprocess_holds_as_lane', 'false') === 'true'; }
  catch { return false; }
}
function _rereadHolds() {
  return require('./rereadHolds').create({ corroborated: (rec) => require('../../../database/modules/trust')._corrobLicensed(rec), k: FIRST_FILL_UNRELIABLE_K });
}
// Owner card 1 (2026-08-23): the ready arm's own switch (DARK). Rides quiet_reread_on_ready, which is
// what schedules the 'ready' job in the first place — this only widens THAT job's population.
function _readyTemplatedEnabled(db) {
  const env = process.env.QUIET_REREAD_ON_READY_TEMPLATED;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('../../../database/modules/learning').getSetting(db, 'quiet_reread_on_ready_templated', 'false') === 'true'; }
  catch { return false; }
}

// JS MIRROR of template_matcher._name_arm_tokens (Oracle C3.2): the distinctive tokens of a
// supplier display name — lowercase, ≥3 chars, not a generic company / type / stop word. The
// Python arm is JUDGEABLE only when ≥2 survive; with fewer, _identity_refuses ABSTAINS and a
// stored binding is re-imposed untested — so the layout arm must not run there. MIRROR PAIR: the
// generic set below must equal template_matcher._GENERIC_NAME_TOKENS (pinned by reading the .py).
const NAME_ARM_GENERIC = new Set([
  'ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'gmbh', 'corp', 'company', 'group',
  'holdings', 'office', 'offices', 'services', 'service', 'supplies', 'systems',
  'solutions', 'trading', 'registered', 'enterprises', 'international', 'the', 'and',
  'document', 'documents',
]);
const NAME_ARM_TYPEWORDS = new Set(['invoice', 'invoices', 'order', 'orders', 'purchase', 'sales', 'delivery', 'note', 'notes',
  'statement', 'receipt', 'quote', 'quotation', 'credit', 'worksheet', 'remittance', 'advice', 'for', 'with', 'from']);
function nameArmTokens(name) {
  const out = new Set();
  for (const w of String(name || '').toLowerCase().normalize('NFKC').match(/[a-z0-9]{2,}/g) || []) {
    if (w.length < 3 || NAME_ARM_GENERIC.has(w) || NAME_ARM_TYPEWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

function scheduleQuietReread(db, info) { return _quietLaneImpl ? _quietLaneImpl.schedule(db, info) : false; }

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
let _reprocessStatus = { running: false, total: 0, done: 0, failed: 0, pendingCompletion: false, docIds: [] };
// The post-reprocess consent OFFER: candidate doc ids computed at consume time from the finished
// batch's own docIds ∩ the shared auto-file predicate. Server-authoritative — the accept IPC takes
// NO payload; a renderer can accept or ignore the offer, never widen it (Oracle 2026-08-12 C1).
let _reprocessOffer = null;
// ANY OCR/extraction work is in flight — a batch (import / reprocess-all) OR a single reprocess.
// Used to SERIALISE heavy work: starting a second reprocess while one is running oversubscribes
// the CPU (every worker + the single proc OCR at once) and can race two merges into the same doc,
// which presents as the app "freezing". Reprocess entry points refuse when busy; the watch folder
// already defers on this signal.
function _anyProcessingBusy() { return _currentBatchProcs.length > 0 || _singleReprocessActive; }

// Scopes ('supplier|slug') with a QUIET-LANE re-read in flight (Slice 3, quietLane.js). The lane is
// deliberately invisible to _anyProcessingBusy() — the foreground must never be refused or greyed
// by it — so the sweep offer/accept carries its own per-scope check (Oracle 2026-08-21 S1-C5).
const _quietLaneActiveScopes = new Set();
// Slice 1 (scope-local auto-accept) entry points, bound inside register() where the IPC closures
// live; module-level so reviewService's onAfterConfirm hook can reach them by a lazy require.
let _scheduleScopeAutoAcceptImpl = null;
let _autoAcceptInflightProbe = () => false;
let _quietLaneImpl = null;                 // Slice 3: the quiet re-read lane (bound in register())
let _readyProbeImpl = null;                // P2 'ready' trigger (bound in register())
let _scheduleReadyRereadImpl = null;
let _scheduleTypeSplitRereadImpl = null;   // A6
const _typeSplitRippleOn = (db) => process.env.TYPE_AMBIGUITY_RIPPLE === '1'
  || (process.env.TYPE_AMBIGUITY_RIPPLE !== '0' && require('../../../database/modules/learning').getSetting(db, 'type_ambiguity_ripple', 'false') === 'true');
let _setReprocessStatusForTestImpl = null; // test seam: drive consume-reprocess-completion without a spawn
let _reprocessOfferProbe = () => null;
let _debugAutoAcceptPreImpl = null;
let _applyReprocessResultImpl = null;      // test seam for the applyReprocessResult(expect) guard (S3-C1 pins)

// ── Processing-activity signal for OTHER windows (esp. Review) ─────────────────────────
// A single-doc reprocess is REFUSED while an import/watch batch is running (heavy work is
// serialised). Broadcast a lightweight activity state to ALL windows so the Review window can
// show WHY reprocess is unavailable + a progress indicator. Import and watch both route file
// completions through _handleFileMessage, so one bump there drives the count for either source.
let _activity  = null;   // null | { source:'import'|'watch', done, total }
let _notifyAll = null;   // ctx.notifyAllWindows, set in register()
// ── REVIEW ACTIVITY LEDGER (B1 of the activity-strip arc, 2026-08-22; barry + eric → Oracle
// SIGN-OFF-W/COND). src/lib/reviewEvents — a ring of what the app filed and when, merged per BATCH,
// broadcast as `review-event` (throttled). PRESENTATION only: recorded best-effort AFTER a filing
// succeeded (the _recordAutoFiled idiom), never inside the filing path, never the source of undo
// validity (re-checked server-side at click). Four doors feed it: the import auto-file, the scope
// auto-accept AND the human "File N" (both via _sweepAcceptCore, once per call), the reprocess
// accept, and the class fix (via reviewService). The strip that reads it is slice B2 (dark).
let _reviewEvents = null;
function recordReviewEvent(db, ev) {
  try { return _reviewEvents ? _reviewEvents.record(db, ev) : null; } catch { return null; }
}
// Read one ledger event (the AUTHORITATIVE id set for the batch-audit grid). Same instance/persisted
// ring as get-review-event-docs; review/handler resolves ev.ids through this so a renderer id-list is
// never trusted (the C5 rule). Null if the ledger is unavailable or the id is unknown.
function getReviewEvent(db, id) {
  try { return _reviewEvents ? _reviewEvents.get(db, id) : null; } catch { return null; }
}
let _templatesDirFn = null;   // ctx.templatesDir, set in register() — the auto-file door's template-file sync (Chris r15 card 2)
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

// ── SFDEV bulk debug-table (dev-only, read-only) ────────────────────────────
// Build a queue-wide field grid: rows = the review queue (needs_review + deferred),
// columns = the union of the present types' declared fields (structural-first, then
// each type's own order), cells = the extracted value + confidence + method from the
// DB. PURE given `db` (no IPC, no fs) so it can be pinned with a fixture DB. The owner
// uses this to see the CLASS of a detection failure across the whole queue at once,
// not one screenshot at a time. Zero production/customer/auto-file/learning impact.
function _buildDebugTable(db) {
  const docTypes = require('../../../database/modules/document_types');
  const typesAll = docTypes.getAllWithFieldsAll(db);
  const bySlug = new Map();
  const labels = {};
  for (const t of typesAll) {
    bySlug.set(t.slug, t);
    for (const f of (t.fields || [])) if (!(f.key in labels)) labels[f.key] = f.label || f.key;
  }

  const docs = db.prepare(`
    SELECT d.id, d.original_filename, d.supplier_name, d.status,
           d.overall_confidence, dt.name AS type_name, dt.slug AS type_slug
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status IN ('needs_review','deferred')
    ORDER BY d.id
  `).all();

  const exStmt = db.prepare(
    'SELECT field_key, raw_value, display_value, confidence, extraction_method FROM extractions WHERE document_id = ?'
  );

  // Columns: for each present type in queue order, structural fields first then the
  // rest — deduped, so a shared field (supplier_name) appears once, near the front.
  const columns = [];
  const seenCol = new Set();
  const pushCol = (k) => { if (k && !seenCol.has(k)) { seenCol.add(k); columns.push(k); } };
  const orderTypeCols = (t) => {
    if (!t) return;
    const fs2 = (t.fields || []);
    for (const f of fs2) if (f.is_structural) pushCol(f.key);
    for (const f of fs2) if (!f.is_structural) pushCol(f.key);
  };

  const rows = [];
  for (const d of docs) {
    const t = bySlug.get(d.type_slug);
    orderTypeCols(t);
    const fields = {};
    for (const e of exStmt.all(d.id)) {
      const dv = (e.display_value != null && String(e.display_value).trim() !== '') ? e.display_value : e.raw_value;
      fields[e.field_key] = {
        value: (dv == null || dv === '') ? null : String(dv),
        confidence: e.confidence ?? null,
        method: e.extraction_method || null,
        // `caption` (the printed line the winning rung matched) is NOT in the DB — the column
        // that would hold it is a dead write (see applyReprocessResult). The renderer fills it
        // from the dev SESSION TRACE, which is where the engine records it, so the grid stays a
        // dev-only view of dev-only data. Null here means "this session has no trace for that
        // document", never "the read matched no caption".
        caption: null,
      };
    }
    rows.push({
      id: d.id, filename: d.original_filename, supplier: d.supplier_name || null,
      typeName: d.type_name || null, typeSlug: d.type_slug || null,
      status: d.status, confidence: d.overall_confidence ?? null, fields,
    });
  }
  return { columns, labels, rows };
}

// Debug-table output dir: <project>/Debug in dev, <userData>/debug when packaged —
// mirrors modules/diaglog.js so the two dev artefacts sit together. __dirname is
// src/modules/processing, so three levels up is the repo root.
function _debugTableDir(app, path) {
  const base = (app && app.isPackaged)
    ? path.join(app.getPath('userData'), 'debug')
    : path.join(__dirname, '..', '..', '..', 'Debug');
  return path.join(base, 'debug_table');
}

// Persist the owner-assembled table to debug_values.json (+ copy any winning-crop
// slices the renderer resolved). Only copies a slice PATH that resolves INSIDE the
// dev slice dir (same path-validation as dev-get-slice) so the renderer can never
// make this read an arbitrary file. Returns a summary the console shows as a toast.
function _saveDebugTable(ctx, payload) {
  const { path, fs } = ctx;
  const app = require('electron').app;
  const outDir = _debugTableDir(app, path);
  const sliceOutDir = path.join(outDir, 'slices');
  fs.mkdirSync(sliceOutDir, { recursive: true });

  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const sliceRoot = path.resolve(ctx.devSliceDir || '');
  let slices = 0, flags = 0;
  const out = { generated_at: new Date().toISOString(), doc_count: rows.length, rows: [] };

  for (const r of rows) {
    const fieldsOut = {};
    for (const [k, cell] of Object.entries((r && r.fields) || {})) {
      let sliceRel = null;
      const sp = cell && cell.slicePath;
      if (sp && sliceRoot) {
        try {
          const abs = path.resolve(String(sp));
          if (abs.startsWith(sliceRoot + path.sep) && fs.existsSync(abs)) {
            const rel = path.join('slices', `${r.id}__${k}.png`);
            fs.copyFileSync(abs, path.join(outDir, rel));
            sliceRel = rel; slices++;
          }
        } catch {}
      }
      const wrong = !!(cell && cell.wrong);
      if (wrong) flags++;
      const correct = (cell && cell.correct != null && String(cell.correct).trim() !== '')
        ? String(cell.correct).trim() : null;
      fieldsOut[k] = {
        value: cell ? (cell.value ?? null) : null,
        method: cell ? (cell.method ?? null) : null,
        caption: cell ? (cell.caption ?? null) : null,
        confidence: cell ? (cell.confidence ?? null) : null,
        wrong, correct, slice: sliceRel,
      };
    }
    out.rows.push({
      id: r.id, filename: r.filename, supplier: r.supplier || null,
      type: r.typeName || null, type_slug: r.typeSlug || null, status: r.status || null,
      fields: fieldsOut,
    });
  }

  const file = path.join(outDir, 'debug_values.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { ok: true, file, doc_count: rows.length, flags, slices };
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
// C5 read pattern (trust.js _shadowRowSkipEnabled precedent): env wins both directions for
// harness arms; the setting is the product truth; no DB handle here so the setting is read
// through the module-scoped db at call time by the wrapper below (mergeReprocessRows is a PURE
// function — it must stay DB-free for its unit battery, so the flag resolves via env or the
// injected global).
function _shadowStaleDropEnabled() {
  const env = process.env.REPROCESS_SHADOW_STALE_DROP;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    const learning = require('../../../database/modules/learning');
    const db = _mergeFlagDb;
    return !!db && learning.getSetting(db, 'reprocess_shadow_stale_drop', 'false') === 'true';
  } catch { return false; }
}
let _mergeFlagDb = null;   // set by applyReprocessResult before merging; pure tests leave it null

function mergeReprocessRows(existing, newRows, flip = null, onTrace = null, hiddenKeys = null) {
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
        // Oracle C2 (2026-08-11): the kept VALUE keeps its corroboration record — dropping it
        // here made the Review badge vanish on every reprocess-that-kept, which reads as
        // "no longer corroborated" for an unchanged value.
        corroboration: ex.corroboration || null,
      };
    }
    // CLASS-FIX SURVIVAL (Oracle C3, blocking, 2026-08-19). This line takes the fresh row WHOLESALE
    // whenever it has a value. The operator-grade protection above lives only in the annotated-empty
    // branch, so without a guard here a Reprocess All silently reverts every value the human-licensed
    // class fix propagated — and, because the marker goes with it, the undo's "still carries the
    // marker" integrity check then refuses too: the feature unwinds AND becomes un-undoable, with
    // nothing said. A row carrying the marker is operator-grade — the human licensed that
    // substitution on a document they were looking at — so re-apply it over an unchanged fresh read.
    //   • fresh read == the original wrong value  → the page still reads the same way, the human's
    //     answer still applies: keep the fix, keep the marker.
    //   • fresh read == anything else             → the page now says something new, which OUTRANKS
    //     a propagated guess: take it, DROP the marker (so learning re-admits the row and the undo
    //     correctly refuses), and trace it so the class stays observable.
    // The realdoc harness runs FRESH extraction and is structurally blind to this merge — the unit
    // battery is the gate (the REPROCESS_ANNOTATED_EMPTY_WINS precedent).
    if (ex.display_value && String(ex.extraction_method || '').endsWith('+prefix_class_fix')) {
      if (String(row.display_value || '') === String(ex.raw_value || '')) {
        // THE NOTE MUST FOLLOW THE VALUE (Chris round 10, card 6). The fresh row's note was
        // computed against the read we are about to discard, so it can NAME that read — he found
        // "'PL/26/6000' doesn't appear on this page as written" sitting on a row that now displays
        // PI/26/6000. The sentence is then false twice over: it quotes a value the operator cannot
        // see, and it judges a value that is no longer there. Re-point it at what was actually
        // kept, and KEEP THE HOLD — nothing re-verified this page, so the document still waits.
        // A note about anything else (a shape warning, a relocation flag) is left alone.
        let _note = row.validation_note || null;
        const _gone = String(row.display_value || '');
        if (_note && _gone && _note.includes(_gone) && !_note.includes(String(ex.display_value))) {
          _note = require('../../services/classFixService').APPLIED_HOLD_NOTE
            .replace('{}', String(ex.display_value));
        }
        trace(row.field_key, 'kept_class_fix', ex.display_value, row.display_value);
        return { ...row, display_value: ex.display_value, extraction_method: ex.extraction_method,
                 validation_note: _note };
      }
      trace(row.field_key, 'class_fix_dropped', ex.display_value, row.display_value);
      return row;
    }
    // LANE HOLD SURVIVAL (Oracle 2026-08-23, A1 seam, blocking). A note the quiet lane wrote to HOLD a
    // document ("Read differently after learning …", "… — confirm once.") must survive a re-read that
    // comes back with the SAME value — the same box reproducing the same misread is not a re-verification
    // (the READY arm and "Reprocess N" both re-read held docs; `used_new` shed every such hold, after
    // which the sweep filed the doc). A DIFFERENT fresh value outranks the hold and drops it.
    if (ex.display_value && _isLaneHoldNote(ex.validation_note)
        && String(row.display_value || '').trim() === String(ex.display_value || '').trim()
        && process.env.REPROCESS_CARRY_LANE_HOLD !== '0') {
      const keep = String(ex.validation_note || '').trim();
      const fresh = String(row.validation_note || '').trim();
      trace(row.field_key, 'kept_lane_hold', ex.display_value, row.display_value);
      return { ...row, validation_note: fresh && !keep.includes(fresh) ? `${keep} ${fresh}` : keep,
               corrected_to: row.corrected_to || ex.corrected_to || null };
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
      // REPROCESS_SHADOW_STALE_DROP (designed 2026-08-07, built 2026-08-12 NIGHT off the live
      // Pelican exhibit; DEFAULT OFF + toggle). A shadow_reconcile row is MACHINE WORKING DATA
      // (excluded from learning, deleted at confirm, never a filing input) minted purely to back
      // the totals check. When a reprocess produces NO row for that role — e.g. the vat_reg
      // guard now correctly refuses the letterhead registration number the old run minted as a
      // 2093.55 tax — carrying the stale row forward re-poisons the reconciliation forever: the
      // fix can never reach an already-poisoned doc through reprocess. Armed, the stale shadow
      // row is DROPPED so the doc's maths reflect THIS run's reads. A row the operator corrected
      // (corrected_to) is human data and is NEVER dropped. The realdoc harness runs fresh
      // extraction and is structurally blind to this merge — the unit battery is the gate
      // (the REPROCESS_ANNOTATED_EMPTY_WINS precedent, Oracle 2026-08-08).
      if (String(ex.extraction_method || '') === 'shadow_reconcile'
          && !String(ex.corrected_to || '').trim()
          && _shadowStaleDropEnabled()) {
        trace(ex.field_key, 'dropped_stale_shadow', ex.display_value, null);
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
        corroboration:     ex.corroboration || null,   // Oracle C2: the record rides with the kept value
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
  // DECLARED-ABSENT keys (TEMPLATE_HIDDEN_FIELD_DROP, gary 2026-08-11): without this clause the
  // kept_existing carry-over RESURRECTED a stored wrong fill on every reprocess, so the engine-side
  // drop appeared to do nothing on exactly the documents the operator was looking at. A hidden-key
  // row is dropped from the merge UNLESS the operator corrected it (corrected_to — the human's
  // answer is never lost; same convention as the annotated-empty Oracle-C1 exclusion above).
  // hiddenKeys=null (flag off / no declarations) ⇒ byte-identical.
  if (hiddenKeys && hiddenKeys.size) {
    return mergedRows.filter(r => {
      if (!hiddenKeys.has(r.field_key)) return true;
      if (String(r.corrected_to || '').trim()) return true;
      trace(r.field_key, 'dropped_hidden', r.display_value, null);
      return false;
    });
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

// TEACH_ANGLE_COMPOSE lazy sample-angle heal (Oracle C4). Fire-and-forget: detects the pinned
// sample's skew ONCE per template and stores it (0.0 = level, so level samples never re-spawn).
// Session-scoped attempt cache: a gone/unreadable sample file never spawns twice per app run.
const _angleHealTried = new Set();
function _healSampleAngles(db, allTemplates, logger) {
  if (!_pyHelpers || !_pyHelpers.pythonExe) { logger?.warn?.('[training] angle heal: _pyHelpers unset'); return; }
  const { spawn } = require('child_process');
  const fs = require('fs');
  for (const t of allTemplates) {
    if (!t || t.sample_deskew_angle != null || !t.sample_document_id) continue;
    if (_angleHealTried.has(t.id)) continue;
    _angleHealTried.add(t.id);
    let file = null;
    try {
      const d = db.prepare('SELECT working_path, stored_path FROM documents WHERE id = ?')
                  .get(t.sample_document_id);
      file = (d && (d.working_path || d.stored_path)) || null;
    } catch (eq) { logger?.warn?.(`[training] angle heal (template ${t.id}): sample query failed: ${eq && eq.message}`); file = null; }
    if (!file || !fs.existsSync(file)) {
      logger?.warn?.(`[training] angle heal (template ${t.id}): sample file missing (${file || 'no path'})`);
      continue;
    }
    logger?.log?.(`[training] angle heal: detecting sample tilt for template ${t.id} (${file})`);
    try {
      const script = _pyHelpers.resourcePath('python_backend', 'ocr', 'detect_angle.py');
      // ctx.pythonExe / ctx.pythonArgs are FUNCTIONS in main.js (resolved per call —
      // dev 'py -3.12' vs packaged vendor python). Spawning the function object throws
      // silently — the 2026-08-05 live-heal no-op bug. Call them like every other site.
      const exe = typeof _pyHelpers.pythonExe === 'function' ? _pyHelpers.pythonExe() : _pyHelpers.pythonExe;
      const pargs = typeof _pyHelpers.pythonArgs === 'function' ? _pyHelpers.pythonArgs() : (_pyHelpers.pythonArgs || []);
      const p = spawn(exe, [...pargs, script, '--file', file], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d2) => { out += d2; });
      p.on('close', (code) => {
        try {
          const r = JSON.parse(out.trim());
          if (r && typeof r.angle === 'number' && isFinite(r.angle)) {
            db.prepare('UPDATE templates SET sample_deskew_angle = ? WHERE id = ?')
              .run(r.angle, t.id);
            logger?.log?.(`[training] sample angle healed: template ${t.id} = ${r.angle.toFixed(2)} deg`);
          } else {
            logger?.warn?.(`[training] angle heal (template ${t.id}): detector returned no angle (exit ${code}, out=${(out || '').trim().slice(0, 120)})`);
          }
        } catch (ep) {
          logger?.warn?.(`[training] angle heal (template ${t.id}): unparseable detector output (exit ${code}, out=${(out || '').trim().slice(0, 120)}): ${ep && ep.message}`);
        }
      });
      p.on('error', (e2) => { logger?.warn?.(`[training] angle-heal spawn failed (template ${t.id}): ${e2 && e2.message}`); });
    } catch (e3) { logger?.warn?.(`[training] angle heal (template ${t.id}): ${e3 && e3.message}`); }
  }
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
  // TEACH_ANGLE_COMPOSE lazy heal (Oracle C4, 2026-08-05 late): templates with a pinned
  // sample but no detected sample_deskew_angle get it detected ONCE (fire-and-forget spawn,
  // never blocks the batch — THIS run serves the NULL and composes nothing, the NEXT run has
  // the healed angle). Gated on the kill switch so the dark slice is byte-identical incl.
  // zero spawns/writes. Renders the WORKING file (post-auto-rotate — the frame every teach
  // surface drew on). Stores 0.0 for a level sample (NULL = only never/failed detection).
  // Oracle C4 (2026-08-11 backfill slice): the heal used to arm ONLY on teach_angle_compose,
  // while the live install's consumer is teach_angle_compose_scan — so on the owner's real
  // config a NULL-angle template was never healed, and the scan path then read NULL as 0.0
  // (engine.py treats absence-of-measurement as measurement-of-zero; changing THAT is a
  // separate owner decision, named in pendingfeatures.md). Either compose flag now arms it.
  let _composeOn = process.env.TEACH_ANGLE_COMPOSE === '1'
                || process.env.TEACH_ANGLE_COMPOSE_SCAN === '1';
  if (!_composeOn) {
    try {
      _composeOn = learning.getSetting(db, 'teach_angle_compose', 'false') === 'true'
                || learning.getSetting(db, 'teach_angle_compose_scan', 'false') === 'true';
    } catch { _composeOn = false; }
  }
  if (_composeOn) {
    try { _healSampleAngles(db, allTemplates, logger); } catch (e) { logger?.warn?.(`[training] angle heal: ${e && e.message}`); }
  }
  // Format model is the source of the qualification gate. The catch was SILENT,
  // which hid the cause when 0 formats reach the extractor despite many confirms
  // — log a throw (so a real failure is visible) and the resulting group count.
  let allFormats = [];
  try { allFormats = learning.getFieldFormats(db, { includeProvisional: true }); }   // Python consent channel only
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
  // Supplier hard-identifier registry (slice 1b MATCH, DARK `identifier_registry`): the learned
  // {supplier,kind,value_norm} rows the engine reverse-looks-up to SUGGEST an issuer from a matched
  // VAT/company number. Loaded ONLY when armed — an un-armed install writes [] → the engine no-ops
  // (byte-identical). Table-guarded for older DBs.
  let allIdentifiers = [];
  try {
    const _idOn = process.env.IDENTIFIER_REGISTRY === '1'
      || (process.env.IDENTIFIER_REGISTRY !== '0' && learning.getSetting(db, 'identifier_registry', 'false') === 'true');
    if (_idOn) allIdentifiers = learning.getAllSupplierIdentifiers(db);
  } catch (e) { logger?.warn?.(`[training] identifier registry load failed: ${e && e.message}`); }
  const identifiersFile = writeTempJson('identifiers', allIdentifiers);
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
    '--identifiers-file', identifiersFile,
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
    tempFiles: [fieldsFile, hintsFile, anchorsFile, logosFile, dtFile, formatsFile, templatesFile, overridesFile, fieldRulesFile, acceptedNamesFile, acceptedIssuersFile, identifiersFile],
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

// SEC-17 — REPARSE POINTS DEFEAT A TEXTUAL CONTAINMENT CHECK.
// `path.resolve` collapses `..` but does NOT follow a Windows junction or symlink, so a reparse
// point created INSIDE an approved root (output folder, inbox, filing-slips) produced a string that
// passed `startsWith` while addressing anywhere on disk. `realpath` appeared nowhere in src/ before
// this. Resolve BOTH sides so the comparison is between real locations.
//
// BOTH sides matters: a root that is ITSELF a junction is the common, legitimate case (a redirected
// or OneDrive-backed Documents folder), and realpathing only the target would start refusing those
// users' own files. Canonicalising both keeps every ordinary path behaving exactly as before — the
// behaviour differs only where a reparse point actually redirects out of the root.
//
// FAIL CLOSED for a path that EXISTS and cannot be canonicalised.
//
// A MISSING path is the subtle case, and the first version of this function got it wrong (Oracle
// B1, 2026-08-08). It returned the RAW resolved path on ENOENT while `_withinAnyRoot` canonicalises
// the ROOT — two different frames in one comparison, which left the very hole SEC-17 exists to
// close: with `Output\peek` a junction to somewhere else, `Output\peek\nope.pdf` does not exist, so
// realpath threw, the raw string was returned, and `startsWith(Output\)` passed. The original
// comment reasoned that a missing file "is refused later anyway (openPath would fail)" — true of
// `open-file`, but NOT of `show-in-explorer`, whose shell call falls back to revealing the
// CONTAINING directory, i.e. the junction's target. Containment must not depend on what the shell
// happens to do with the string afterwards.
//
// So on ENOENT, walk up to the nearest ancestor that DOES exist, canonicalise that, and re-append
// the unresolved tail. Both sides of the comparison then live in the same frame: a missing leaf
// under a junction resolves through the junction and is refused, while a missing leaf genuinely
// under the root still resolves inside it and is still allowed (a not-yet-created path must not be
// refused wholesale — the caller's own existence check is what rejects it). Bounded by the path's
// own depth; `path.dirname` is a fixed point at a drive/UNC root, which terminates the walk.
// An ancestor that exists but cannot be canonicalised refuses, exactly like a target that can't.
//
// `SF_REALPATH_CONTAINMENT=0` reverts to returning the input unresolved. NOTE, and it is a real
// limitation rather than a nicety: that switch does NOT restore the pre-SEC-17 comparison, because
// the case-insensitive compare in `_withinAnyRoot` sits outside it. OFF is "no reparse-point
// resolution", not "the old code". Pinned in test_path_containment.js so nobody re-reads the switch
// as a full revert. Default ON, deliberately: the OFF state here is the vulnerable state, so a dark
// default would ship no protection at all.
const _app = (() => { try { return require('electron').app || { isPackaged: false }; }
                      catch { return { isPackaged: false }; } })();

function _realCanonical(p) {
  // DEV-ONLY (2026-08-09 NIGHT, pre-release audit): same rule as the licence key pinning —
  // a containment boundary must not be switchable off by an environment variable on a
  // customer's machine. Unpackaged, the switch still works, which is what lets the pin below
  // prove the guard can actually fail.
  if (!_app.isPackaged && process.env.SF_REALPATH_CONTAINMENT === '0') return p;
  try {
    return fs.realpathSync.native(p);
  } catch (e) {
    // Anything other than "it isn't there" (EPERM/EBUSY/ELOOP/…) is a path we cannot vouch for.
    if (!e || e.code !== 'ENOENT') return null;
  }
  const tail = [path.basename(p)];
  let dir = path.dirname(p);
  while (dir && dir !== path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync.native(dir), ...tail.slice().reverse());
    } catch (e2) {
      if (!e2 || e2.code !== 'ENOENT') return null;   // ancestor exists but is unverifiable → refuse
      tail.push(path.basename(dir));
      dir = path.dirname(dir);
    }
  }
  // No existing ancestor at all (a missing drive, an unmounted share): there is nothing to follow,
  // so the textual form is as canonical as it gets. It cannot match a canonicalised root by
  // accident — a root that does not exist is itself refused above.
  return p;
}

function _withinAnyRoot(resolved, roots) {
  const target = _realCanonical(resolved);
  if (target === null) return false;                       // exists but unverifiable → refuse
  // Case-insensitive on Windows is PART of this fix, not a separate loosening: realpathSync.native
  // returns the filesystem's own casing, which routinely differs from the casing the user typed into
  // the output-folder setting. Comparing case-sensitively would turn that difference into a false
  // REFUSAL of the user's own files. It admits nothing new — on Windows those are the same directory.
  const cmp = (a, b) => (process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b);
  const under = (a, b) => (process.platform === 'win32'
    ? a.toLowerCase().startsWith(b.toLowerCase() + path.sep)
    : a.startsWith(b + path.sep));
  return roots.some(r => {
    const root = _realCanonical(r);
    if (root === null) return false;
    return cmp(target, root) || under(target, root);
  });
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

// ONE Tesseract thread cap for EVERY reprocess read (owner-approved "option 1", 2026-08-11).
// Tesseract's LSTM scores differ slightly with OpenMP thread count (float accumulation order —
// upstream-documented; OMP_THREAD_LIMIT=1 is their reproducibility advice), so a boundary glyph
// can read differently under different caps: the owner watched a single reprocess read
// 'ACC-2291' and Reprocess-All read 'ACC-229]' on the SAME document — single ran UNCAPPED
// while each batch worker ran at cores/shards. The cap is now derived from the CONFIGURED
// concurrency (never the per-run shard count), so single-doc, small-batch and full-queue
// reprocess all read under identical threading on a given machine + settings. Small batches
// (docs < concurrency) run mildly under-threaded rather than differently-read — the safe
// direction. NOT full determinism (that is OMP_THREAD_LIMIT=1 everywhere — the declined
// "option 2"), and first-IMPORT workers keep their own cap (a known, recorded residual).
function _reprocessThreadCap(db) {
  const cores = os.cpus().length || 1;
  let conc = parseInt(require('../../../database/modules/learning')
    .getSetting(db, 'processing_concurrency', String(defaultConcurrency())), 10);
  if (!Number.isFinite(conc)) conc = 1;
  conc = Math.max(1, Math.min(10, conc));
  return Math.max(1, Math.floor(cores / conc));
}

// How many concurrent Python workers the QUIET background re-read lane may use. The lane was ONE
// worker by design (invisible-by-design), and on a 16-core box configured at concurrency 10 that is
// one process at OMP_THREAD_LIMIT=1 — a single core crawling a 40-doc chunk (owner: "it is quite
// slow"). The ONLY safe speed lever is the shard COUNT: the per-shard OMP cap stays
// _reprocessThreadCap UNCHANGED (the S3-C4 identity rule — every doc reads under the identical
// threading whether the lane runs 1 worker or several, so no boundary glyph flips and no phantom
// "read differently" holds). The count is bounded by the configured processing_concurrency so total
// threads (nShards * cap) stay ≈ cores — never oversubscribed past a foreground batch — and every
// shard is still demoted BELOW_NORMAL and pre-empted together. Default 2; env QUIET_REREAD_WORKERS
// wins (pins); setting quiet_reread_workers is the product truth.
function _quietLaneWorkers(db) {
  const env = process.env.QUIET_REREAD_WORKERS;
  let want = env != null ? parseInt(env, 10) : NaN;
  const learning = require('../../../database/modules/learning');
  if (!Number.isFinite(want)) {
    try { want = parseInt(learning.getSetting(db, 'quiet_reread_workers', '2'), 10); } catch { want = 2; }
  }
  if (!Number.isFinite(want)) want = 2;
  const cores = os.cpus().length || 1;
  let conc = parseInt(learning.getSetting(db, 'processing_concurrency', String(defaultConcurrency())), 10);
  if (!Number.isFinite(conc)) conc = 1;
  conc = Math.max(1, Math.min(10, conc));
  return Math.max(1, Math.min(want, conc, cores));
}

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          backendScript, configPath, notifyMainWindow, notifyDevInspector,
          notifyReview, safeSend, spawn, path, fs, logger } = ctx;
  _pyHelpers = { pythonExe, pythonArgs, backendScript, resourcePath: ctx.resourcePath };
  _notifyAll = ctx.notifyAllWindows;   // broadcast import/watch activity to Review (see _broadcastActivity)
  try {
    _reviewEvents = require('../../lib/reviewEvents').create({
      notify: (ev) => { try { if (_notifyAll) _notifyAll('review-event', ev); } catch { /* best-effort */ } },
    });
  } catch (e) { _reviewEvents = null; logger?.warn?.('review-events ledger unavailable: ' + (e && e.message)); }
  _templatesDirFn = typeof ctx.templatesDir === 'function' ? ctx.templatesDir : null;

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

  // SFDEV bulk debug-table (dev-only, admin/edit-gated like the sibling dev IPCs). READ
  // builds the queue-wide field grid from the DB; SAVE writes debug_values.json (+ copies
  // the winning-crop slices the renderer resolved) to the Debug dir. No DB writes, no learning.
  ipcMain.handle('dev-debug-table-data', () => { requireRole('admin', 'edit'); return _buildDebugTable(getDb()); });
  ipcMain.handle('dev-debug-table-save', (_e, payload) => { requireRole('admin', 'edit'); return _saveDebugTable(ctx, payload); });

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
    try { _quietLaneImpl && _quietLaneImpl.preempt('import'); } catch {}   // Slice 3: the foreground always wins
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
      // Q1 seam (Oracle C1.6, 2026-08-22): under keep_processed_originals the DEFAULT
      // `<source>/Processed` folder becomes a permanent archive of FILED originals, and there is
      // no content-hash dedupe — "I'll just re-import that folder" would re-queue every filed
      // document as a new row (`-DUPLICATE` files). DB-driven, no folder-name heuristic: refuse a
      // folder that is the `folder_path` of ≥1 CONFIRMED document, unless the caller passes
      // {importAnyway:true} (the renderer asks). Env IMPORT_FILED_FOLDER_GUARD=0 disables.
      if (process.env.IMPORT_FILED_FOLDER_GUARD !== '0' && !(opts && opts.importAnyway === true)) {
        const filedHere = _filedDocsInFolder(db, folderPath);
        if (filedHere > 0) {
          return { success: false, overridable: true, reason: 'filed-originals-folder', count: filedHere,
                   error: `This folder holds the original scans of ${filedHere} document${filedHere === 1 ? '' : 's'} you have already filed. Importing it again would create duplicates.` };
        }
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
      // STRAIGHTEN ON IMPORT (setting `deskew_on_import`, DEFAULT OFF — owner-observed 2026-08-09).
      // The operator noticed that values wrong on import come back CORRECT after "Straighten +
      // Reprocess", and the measurement backed it: 140 scanned documents, identical flags, the only
      // difference being this argument —
      //     customer 88 ok/52 wrong -> 140/0     date 116/21 -> 140/0      po_ref 17/3 -> 20/0
      //     issuer   88/49 -> 112/28             ref  107/29 -> 120/20     total 81/33 -> 96/24
      // ZERO lanes regressed. That matters because detection-time deskew was PARKED on the grounds
      // that it is not monotone; on this corpus it was strictly monotone.
      // ⚠ IT IS STILL DEFAULT OFF AND UNRULED. Deskew changes the coordinate frame every taught box
      // and anchor is read in, and at IMPORT (unlike reprocess) a read can AUTO-FILE — so a
      // non-monotone case here files a wrong value silently rather than routing to review. The
      // measured corpus is deliberately jittered and may overstate the gain. Do not flip this
      // without the Oracle pass and a realdoc arm.
      // Python skips born-digital and confident-upright pages, so it is inert where it cannot help.
      try {
        if (learning.getSetting(db, 'deskew_on_import', 'false') === 'true') {
          const floor = parseFloat(learning.getSetting(db, 'deskew_on_import_min_angle', '0.2'));
          scriptArgs.push('--deskew-pages', '--deskew-min-angle',
                          String(Number.isFinite(floor) ? Math.min(5, Math.max(0.2, floor)) : 0.2));
        }
      } catch { /* setting unreadable -> off, import unchanged */ }
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
      try { _quietLaneImpl && _quietLaneImpl.preempt('import'); } catch {}   // Slice 3: the foreground always wins
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
  ipcMain.handle('get-processing-activity', () => {
    requireLogin();
    // Chris round 17 card 6: self-heal — a stale `_activity` with no batch running (the end-of-batch
    // clear is the only writer that nulls it; a dropped send to a window is not its fault) reads as idle.
    // Only nulls the presentation state; never spawns or kills. Guarded by the batch/single-reprocess
    // liveness the rest of this module trusts (_anyProcessingBusy).
    if (_activity && _activity.source === 'import' && !_anyProcessingBusy()) { _activity = null; _broadcastActivity(); }
    return _activity
      ? { active: true, source: _activity.source, done: _activity.done, total: _activity.total }
      : { active: false };
  });

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
  // opts (2026-08-21, Oracle S3-C1/C2 — the quiet lane's defence in depth; foreground callers pass
  // nothing and are byte-identical):
  //   expect: { status, fingerprint } — the merge is REFUSED (returns { dropped: reason }) unless the
  //     document's CURRENT status equals `status` and the CURRENT extraction rows still fingerprint to
  //     `fingerprint`. Checked INSIDE the same transaction that deletes/inserts the rows AND updates
  //     the document — the old shape ran the UPDATE outside the row transaction, so a check-then-apply
  //     from a background lane could interleave with a confirm and revert a just-filed document to
  //     needs_review with stale rows.
  //   preserveAck: keep review_acknowledged_at (a background re-read that did not change the
  //     operator's acknowledged document must not un-acknowledge it).
  function applyReprocessResult(db, docId, existing, result, filename, diagOn, opts = {}) {
    const newRows = Object.entries(result.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
      validation_note:   data.validation_note || null,
      corrected_to:      data.corrected_to || null,
      // NOTE (verified 2026-08-10): this is a DEAD WRITE. `file_done` PROJECTS a fixed field
      // set in process_docs.py (value/confidence/method + four conditional keys) and `anchor`
      // is not among them, so `data.anchor` is always undefined — `extractions.anchor_label`
      // is NULL on all 3262 rows of the live install and Review's "From anchor:" line has
      // never rendered from it. Left AS IS deliberately: feeding it would switch on a
      // customer-facing provenance line for the first time, which is an owner decision, not
      // a side effect of a dev tool. Filed in pendingfeatures.md.
      anchor_label:      data.anchor || null,
      candidates:        data.candidates ? JSON.stringify(data.candidates) : null,   // disambiguation picker
      corroboration:     data.corroboration ? JSON.stringify(data.corroboration) : null, // independent method-family agreement (owner principle 2026-08-11)
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

    // DECLARED-ABSENT keys for this doc's scope (TEMPLATE_HIDDEN_FIELD_DROP, gary 2026-08-11):
    // resolved by the doc's own template when bound, else by (supplier, type) — the same cold
    // path the Review detail view uses. Structural roles + identity keys are protected at the
    // source (setHiddenField refuses them). null when the flag is off ⇒ merge byte-identical.
    let _hiddenKeys = null;
    try {
      const learningMod = require('../../../database/modules/learning');
      if (learningMod.getSetting(db, 'template_hidden_field_drop', 'false') === 'true') {
        const templatesMod = require('../../../database/modules/templates');
        const _drow = db.prepare('SELECT template_id, supplier_name FROM documents WHERE id = ?').get(docId) || {};
        let hk = [];
        if (_drow.template_id) hk = templatesMod.getHiddenFields(db, _drow.template_id) || [];
        if (!hk.length && _drow.supplier_name && reprocType) {
          hk = templatesMod.getHiddenFieldsForSupplierType(db, {
            supplier_name: _drow.supplier_name, document_type_slug: reprocType.slug }) || [];
        }
        if (hk.length) _hiddenKeys = new Set(hk.map(x => (typeof x === 'string' ? x : x.field_key)));
      }
    } catch { /* resolver failure ⇒ no drop ⇒ today's behaviour */ }

    _mergeFlagDb = db;    // stale-shadow-drop flag resolves against THIS db (pure tests leave it null)
    const mergedRows = mergeReprocessRows(existing, newRows, flip, _emitMerge, _hiddenKeys);

    const learning = require('../../../database/modules/learning');
    const _supBlanked = supplierColumnBlanked(mergedRows);
    const _expect = opts && opts.expect;
    const _preserveAck = !!(opts && opts.preserveAck);
    const _updateDoc = () => db.prepare(
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
         review_acknowledged_at = CASE WHEN ? THEN review_acknowledged_at ELSE NULL END
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
      _preserveAck ? 1 : 0,
      docId
    );
    // BARCODE INVENTORY (2026-08-26, DARK `barcode_inventory`): the emit key is TRI-STATE — absent
    // (dark / no pages rendered) keeps the doc's existing rows; a list (possibly []) replaces them.
    // Inside the SAME transaction as the extraction rows so a rollback never leaves half a doc.
    const _bcRows = Object.prototype.hasOwnProperty.call(result || {}, 'barcodes') ? result.barcodes : undefined;
    const _replaceBarcodes = () => {
      if (_bcRows === undefined) return;
      try { require('../../../database/modules/barcodes').replaceDocumentBarcodes(db, docId, _bcRows); }
      catch (e) { try { ctx.logger?.warn?.(`[barcodes] replace failed for doc ${docId}: ${e.message}`); } catch {} }
    };
    if (_expect) {
      // The lane's guarded merge: status + fingerprint re-checked and the rows + document written in
      // ONE transaction, so nothing can land between the check and the write (S3-C1).
      const { extractionsFingerprint } = require('../../services/sweepPredicate');
      const _verdict = db.transaction(() => {
        const cur = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId);
        if (!cur) return { dropped: 'missing' };
        if (_expect.status && cur.status !== _expect.status) return { dropped: 'status-changed' };
        if (_expect.fingerprint != null) {
          const rowsNow = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId);
          if (extractionsFingerprint(rowsNow) !== String(_expect.fingerprint)) return { dropped: 'rows-changed' };
        }
        learning.deleteExtractions(db, docId);
        learning.insertExtractions(db, docId, mergedRows);
        _replaceBarcodes();
        _updateDoc();
        return null;
      })();
      if (_verdict) return _verdict;
    } else {
      // ONE transaction (2026-08-11, found live): the un-wrapped pair stranded a document with
      // ZERO extraction rows when the insert threw after the delete (the missing-column incident).
      // better-sqlite3 nests the insert's own transaction as a savepoint.
      db.transaction(() => {
        learning.deleteExtractions(db, docId);
        learning.insertExtractions(db, docId, mergedRows);
        _replaceBarcodes();
      })();
      _updateDoc();
    }

    // SELF-DISCHARGED PIN clear (SUPPLIER_PIN_SELF_DISCHARGE, Oracle W/COND 2026-08-12): the engine
    // proved the natural read independently equals the pin and kept the natural row — release the
    // batch-applied obligation here, AFTER the merge committed. Pure helper carries the race guard
    // (exact match on the CURRENT stored pin — a mid-run re-resolve to a different name keeps the
    // NEW pin). Audited. Absent signal (the dark default) ⇒ byte-identical.
    try {
      const { shouldClearSupplierPin } = require('../../../database/modules/supplier_pin_discharge');
      const _pinRow = db.prepare('SELECT supplier_pin FROM documents WHERE id = ?').get(docId);
      if (shouldClearSupplierPin(_pinRow && _pinRow.supplier_pin, result.supplier_pin_discharged)) {
        db.prepare('UPDATE documents SET supplier_pin = NULL WHERE id = ?').run(docId);
        try {
          require('../auth/handler').logAudit(db, {
            action: 'supplier_pin_discharged', action_category: 'learning', target_type: 'document',
            target_id: String(docId), document_id: docId, outcome: 'success',
            metadata: { pin: result.supplier_pin_discharged.pin,
                        value: result.supplier_pin_discharged.value,
                        method: result.supplier_pin_discharged.method } });
        } catch {}
        logger?.log?.(`  Pin discharged on doc ${docId}: natural read equals the pin — cleared`);
      }
    } catch { /* best-effort — a clear failure must never affect the reprocess result */ }

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
    try { _quietLaneImpl && _quietLaneImpl.preempt('single-reprocess'); } catch {}   // Slice 3: the foreground always wins
    return new Promise((resolve) => {
      const py   = pythonExe();
      // Single-doc reprocess MAY use several cores (parallel full-page OCR = Option B; parallel
      // field reads = Option C) so ONE document finishes faster on a slow CPU. Output is
      // byte-identical (scheduling only) — see docs/designs/REPROCESS_PARALLELISM_BC_2026-07-17.md.
      // Gated by a setting, DEFAULT OFF; passed ONLY here on the single-reprocess spawn, NEVER the
      // batch/import/shard path (those already parallelise ACROSS docs with their own OMP cap, so
      // nesting a per-doc pool inside them would oversubscribe). The python side caps OMP to 1.
      let spawnEnv = { ...process.env, ..._ocrDpiEnv(db), ..._anchorCropEnv(db), ..._reconcileEnv(db),
        // Same Tesseract thread cap as every Reprocess-All worker (owner "option 1", 2026-08-11):
        // an uncapped single reprocess read boundary glyphs DIFFERENTLY from the capped batch
        // (LSTM thread-count nondeterminism — 'ACC-2291' vs 'ACC-229]' on one document).
        OMP_THREAD_LIMIT: String(_reprocessThreadCap(db)) };
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
        // r19 N1 (P1 C5): the single-document Reprocess — S3-C5 against the last independent value and
        // an UNCONDITIONAL "confirm once" on a required role the re-read first-fills (no batch, no
        // witnesses, no release: the person is on the document; one click they were making anyway).
        if (_reprocessHoldsEnabled(db)) {
          try { const h = _rereadHolds(); h.onDocMerged(db, h.newBatch(), { docId, existing, via: 'manual-single' }); }
          catch (e) { logger?.warn?.(`reprocess holds (single) ${filename}: ${e && e.message}`); }
        }
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
    // Consent-trail. Oracle C8/C9: RECORD the offer server-side (the accept may only file what is
    // in it), and log it UNCONDITIONALLY — the old `>= 2` audit gate mirrored a renderer display
    // threshold, so a single-document offer could be accepted with no `scope_sweep_offered` row to
    // pair against the `scope_sweep_accepted` one. What the renderer chooses to DISPLAY is a
    // display decision; what the server OFFERED is a fact, and the audit records facts.
    _sweepOffers.set(_sweepOfferKey(sup, slug), new Set(candidates.map(c => c.docId)));
    if (candidates.length) {
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

  // ── QUEUE-WIDE TIER-1 RE-ASK (gary design → Oracle SIGN-OFF-W/COND, 2026-08-18) ─────────────
  // THE PROBLEM IT SOLVES, in the owner's words: "I don't see the point in having to Reprocess All
  // when the taught document is already confirmed. If I confirm one or two, can we take the
  // EXISTING reads from the other docs and check them against the database?" Proven live the same
  // day: one further confirm made 17 already-correct documents eligible — and only a Reprocess All
  // (three minutes of re-reading pages that produced identical answers) made the app NOTICE.
  //
  // Tier 1 IS that check, and it costs a sub-second database pass: `trust.autoFileEligibleIds` —
  // the SAME primitive the DEFAULT-ON post-reprocess consent bar already uses — re-asks the one
  // shared predicate against the STORED rows with live scope trust and live learned formats. No
  // OCR, no page render, no re-extract, no new decision logic.
  //
  // THE DISTINCTION FROM THE 2026-08-12 SCAR, stated here because "queue-wide sweep REMOVED, no
  // restore door" is on the record: what was banned is a silent queue-wide COMMIT attributed as a
  // HUMAN confirm (the renderer's autoCommitFullConfidence filed 101 docs across six suppliers,
  // inflating the graduation window). THIS is queue-wide EVALUATION: read-only, server-owned
  // offer, per-doc untick, machine `confirmed_via` excluded from the human graduation window, and
  // Undo-all live. Evaluation is not commit — but the accept below is the only writer, and it may
  // only file what this offer recorded.
  //
  // Scope-grouped so the existing per-scope accept/undo work unchanged. Tier 1 ONLY: no spawn, so
  // it is safe to run eagerly after a confirm; Tier 2 stays request-only and is held.
  ipcMain.handle('sweep-queue-candidates', () => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (process.env.SCOPE_SWEEP === '0') return { ok: false, reason: 'disabled' };
    const learning = require('../../../database/modules/learning');
    if (!(process.env.SCOPE_SWEEP === '1'
          || learning.getSetting(db, 'scope_sweep_enabled', 'false') === 'true')) return { ok: false, reason: 'disabled' };
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { ok: false, reason: 'license' };
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };   // never mid-batch
    // A scope-local auto-accept pass is filing right now: an offer computed mid-pass would show the
    // renderer docs the server is about to file (a bar whose File button drops every row as
    // 'not-queued'). The renderer re-asks when the pass's scope-auto-filed broadcast lands.
    if (_autoAcceptInflightProbe()) return { ok: false, reason: 'auto-accept-running' };

    const trust = require('../../../database/modules/trust');
    const { extractionsFingerprint } = require('../../services/sweepPredicate');
    const presence = require('../../services/presenceService').shared();
    // A blank-supplier doc is excluded EXPLICITLY, not by luck: the per-scope SQL happened to omit
    // it, and `scopeTrust` would refuse it anyway ('no-supplier') — but the queue-wide SELECT must
    // not rely on a coincidence (Oracle).
    const rows = db.prepare(`
      SELECT d.* FROM documents d
       WHERE d.status = 'needs_review'
         AND TRIM(COALESCE(d.supplier_name, '')) <> ''
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
       ORDER BY d.id LIMIT 500`).all()
      .filter(d => !presence.viewers(d.id).length);          // never sweep a doc someone has open
    if (!rows.length) return { ok: true, scopes: [], evaluated: 0 };

    const eligibleIds = new Set(trust.autoFileEligibleIds(db, rows) || []);   // ONE formats scan
    const fpStmt = db.prepare('SELECT * FROM extractions WHERE document_id = ?');
    const byScope = new Map();
    for (const d of rows) {
      if (!eligibleIds.has(d.id)) continue;
      const dt = db.prepare('SELECT slug, name FROM document_types WHERE id = ?').get(d.document_type_id);
      if (!dt || !dt.slug) continue;
      const key = _sweepOfferKey(d.supplier_name, dt.slug);
      if (!byScope.has(key)) {
        byScope.set(key, { supplier: String(d.supplier_name).trim(), typeSlug: dt.slug,
                           typeName: dt.name, candidates: [] });
      }
      const g = byScope.get(key);
      if (g.candidates.length >= SWEEP_CAP) continue;        // the cap the accept enforces too
      g.candidates.push({ docId: d.id, tier: 1, fingerprint: extractionsFingerprint(fpStmt.all(d.id)) });
    }
    const scopes = [...byScope.values()].filter(g => g.candidates.length);
    for (const g of scopes) {
      _sweepOffers.set(_sweepOfferKey(g.supplier, g.typeSlug), new Set(g.candidates.map(c => c.docId)));
      try {
        logAudit(db, { action: 'scope_sweep_offered', target_type: 'scope', outcome: 'offered',
          metadata: { supplier: g.supplier, type_slug: g.typeSlug, queue_wide: true,
                      doc_ids: g.candidates.map(c => c.docId).join(','),
                      tiers: g.candidates.map(() => 1).join(',') } });
      } catch { /* audit is best-effort */ }
    }
    return { ok: true, scopes, evaluated: rows.length };
  });

  // One doc's sweep evaluation (candidates IPC + the accept path's server-side RE-CHECK share
  // this — the design's "accept re-runs the gate server-side" is literally the same code).
  // ctx carries hoisted trainingArgs/tempFiles across a loop; caller owns cleanupFiles.
  // SERVER-REMEMBERED SWEEP OFFER (Oracle C8, BLOCKING, 2026-08-18). The shipped precedent for a
  // machine-filing consent bar is `_reprocessOffer`: a PAYLOAD-LESS accept against an offer the
  // SERVER recorded, so "a renderer can accept or ignore the offer, never widen it" (Oracle C1 of
  // the 2026-08-12 sign-off). `sweep-scope-accept` instead took a renderer-supplied docId list.
  // The per-doc re-check meant it could not file something INELIGIBLE — but it could file a
  // document that was never OFFERED, producing an `scope_sweep_accepted` audit row with no
  // matching `scope_sweep_offered`. Queue-wide, that gap is how "the machine filed something I
  // never saw" becomes unprovable in either direction. Keyed by scope; replaced on each new offer.
  const _sweepOffers = new Map();          // 'supplier|slug' -> Set(docId)
  const _sweepOfferKey = (sup, slug) => `${String(sup || '').trim().toLowerCase()}|${String(slug || '').trim().toLowerCase()}`;
  // ONE cap for the offer AND the accept (Oracle C10): they were separate literals, so a bar
  // offering more than the accept can file would silently file a subset — "File 184" filing 25 is
  // worse than no button. Pinned.
  const SWEEP_CAP = 25;

  async function _evaluateSweepDoc(db, doc, roleKeys, ctx) {
    const trust = require('../../../database/modules/trust');
    const { evaluateSweepConsistency, extractionsFingerprint } = require('../../services/sweepPredicate');
    const presence = require('../../services/presenceService').shared();
    // A document someone has open is never filed under them. When that someone is the ACTOR (the owner had
    // #1742 open in Review while the pass ran — 2026-08-27) the receipt must say so instead of "someone":
    // reason 'being-viewed-by-you' → "you have it open in Review — confirm it from there".
    const _viewers = presence.viewers(doc.id);
    if (_viewers.length) {
      const _me = String((getCurrentUser() || {}).username || '').trim().toLowerCase();
      const _onlyMe = !!_me && _viewers.every(v => String(v.username || '').trim().toLowerCase() === _me);
      return { excluded: { docId: doc.id, reason: _onlyMe ? 'being-viewed-by-you' : 'being-viewed' } };
    }
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(doc.id);
    const fingerprint = extractionsFingerprint(rows);

    // Tier 1 — stored rows pass the live gate as-is.
    const t1 = trust.isAutoFileEligible(db, doc);
    if (t1.eligible) return { candidate: { docId: doc.id, tier: 1, fingerprint } };

    // TIER-1-ONLY (Oracle C7, BLOCKING, 2026-08-18). The queue-wide offer is Tier 1 by
    // construction — it re-asks the SAME predicate on the SAME stored rows, which is why it
    // satisfies the governing invariant: *the sweep may only file what the import path would
    // itself have filed, had today's learning existed at import time*. Tier 2 does NOT satisfy it
    // (it substitutes a fresh, imageless-degraded doc-level confidence, and is structurally
    // near-inert on taught layouts because Stage 0.5 needs pixels), so it is deliberately HELD.
    // Without this early return the ACCEPT path silently promoted a doc that passed Tier 1 at
    // offer time and lost eligibility before accept (a correction landed, graduation revoked)
    // into the very tier we are holding — and filed it. A "Tier 1 only" feature whose accept can
    // spawn Tier 2 is mislabelled.
    if (ctx && ctx.tier1Only) return { excluded: { docId: doc.id, reason: t1.reason || 'not-eligible' } };

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
                    put_back_at: doc.put_back_at || null,            // r18 A3: the stamp rides the synth row too
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
    // S1-C5 (Oracle 2026-08-21): a scope with a quiet re-read in flight is not accepted — the lane is
    // invisible to _anyProcessingBusy() by design, so the sweep carries its own check.
    if (_quietLaneActiveScopes.has(_sweepOfferKey(sup, slug))) return { ok: false, reason: 'quiet-lane-active' };
    return _sweepAcceptCore(db, { sup, slug, accepts, untickedIds, actor: getCurrentUser() || {} });
  });

  // The accept loop proper — shared by the consent-bar IPC above and the scope-local AUTO-ACCEPT
  // below (Slice 1, Oracle 2026-08-21). ONE writer: every path that files a sweep candidate runs
  // this exact loop (server-recorded offer, fingerprint, Tier-1-only re-check, machine via).
  async function _sweepAcceptCore(db, { sup, slug, accepts, untickedIds, actor, auto = false }) {
    const documents = require('../../../database/modules/documents');
    const { extractionsFingerprint } = require('../../services/sweepPredicate');
    const reviewService = require('../review/handler').getReviewService();
    if (!reviewService) return { ok: false, reason: 'not-ready' };
    const dtRow = db.prepare('SELECT * FROM document_types WHERE LOWER(slug) = ?').get(slug);
    if (!dtRow) return { ok: false, reason: 'unknown-type' };
    const roleKeys = new Set(['supplier_name', dtRow.ref_field_key, dtRow.date_field_key].filter(Boolean));

    const filed = [], dropped = [];
    const _offered = _sweepOffers.get(_sweepOfferKey(sup, slug));
    // Tier-1-only at accept (Oracle C7): the queue-wide offer is Tier 1 by construction, so its
    // re-check must be too — otherwise a doc that lost Tier-1 eligibility between offer and
    // accept gets silently promoted into the held tier and filed.
    const ctx = { trainingArgs: null, tempFiles: [], tier1Only: true };
    try {
      for (const a of accepts.slice(0, SWEEP_CAP)) {
        const docId = Number(a && a.docId);
        const doc = docId ? documents.getById(db, docId) : null;
        if (!doc || doc.status !== 'needs_review') { dropped.push({ docId, reason: 'not-queued' }); continue; }
        if (['pending', 'claimed'].includes(String(doc.workflow_status || ''))) { dropped.push({ docId, reason: 'workflow-locked' }); continue; }
        if (String(doc.supplier_name || '').trim().toLowerCase() !== sup.toLowerCase()
            || Number(doc.document_type_id) !== Number(dtRow.id)) { dropped.push({ docId, reason: 'scope-mismatch' }); continue; }
        // Oracle C8: it must have been OFFERED. The renderer may narrow the server's offer
        // (unticking) but can never widen it.
        if (!_offered || !_offered.has(docId)) { dropped.push({ docId, reason: 'not-offered' }); continue; }
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
                    unticked_ids: (Array.isArray(untickedIds) ? untickedIds : []).join(','),
                    ...(auto ? { auto_accept: true } : {}) } });
    } catch { /* audit is best-effort */ }
    // B1: ONE receipt per accept call — the human "File N" click (approved) or the scope auto-accept
    // (self_filed) — carrying what was kept back and why. Both are sweep-undoable (confirmed_via
    // scope_sweep), re-checked at click.
    if (filed.length || dropped.length) {
      recordReviewEvent(db, { kind: auto ? 'self_filed' : 'approved', ids: filed, dropped, approved: !auto,
                              scope: { supplier: sup, typeSlug: slug }, undo: { type: 'sweep' } });
    }
    return { ok: true, filed, dropped };
  }

  // ── Slice 1 (2026-08-21, Oracle SIGN-OFF-W/COND S1-C1..C6): SCOPE-LOCAL AUTO-ACCEPT ───────
  // The owner's "confirm a couple more and that sender files itself" — without the remembered
  // ritual. After a HUMAN confirm on (supplier, type), the server computes the sweep offer for
  // THAT SCOPE ONLY and runs the same accept loop on it; every other sender's offer stays a bar.
  // Why scope-local (S1-C1): the queue-wide offer after one Pelican confirm would also file
  // Oakhaven — the 08-12 incident's SHAPE with better plumbing. Why no glance is lost (Oracle):
  // the accept files only what `isAutoFileEligible` passes on STORED rows — the SAME predicate the
  // import path files with no click — so the bar added surprise control, not safety; the receipt
  // bar + Put back (S1-C4) keep the surprise control. DARK: `scope_sweep_auto_accept` (default
  // off) and, checked AT ACCEPT TIME server-side (S1-C2), `scope_sweep_enabled` +
  // `learning_exclude_machine_confirms` + `autofile_gate_unify` — the last because a gate-unify-OFF
  // import stamps via NULL (:4730), which the graduation window and the exclusion count as HUMAN,
  // re-opening the self-licensing loop this feature must never close by itself.
  const _autoAcceptTimers = new Map();          // scopeKey -> timeout (server debounce, 1.5 s)
  let _autoAcceptInflight = false;              // single-flight: one pass at a time, app-wide
  const AUTO_ACCEPT_MAX_PASSES = 8;             // S1-C6: ≤8 × SWEEP_CAP per trigger
  function _autoAcceptPreconditions(db) {
    if (process.env.SCOPE_SWEEP_AUTO_ACCEPT === '0') return 'disabled';
    const learning = require('../../../database/modules/learning');
    const trust = require('../../../database/modules/trust');
    const on = process.env.SCOPE_SWEEP_AUTO_ACCEPT === '1'
      || learning.getSetting(db, 'scope_sweep_auto_accept', 'false') === 'true';
    if (!on) return 'disabled';
    if (process.env.SCOPE_SWEEP === '0') return 'sweep-disabled';
    if (!(process.env.SCOPE_SWEEP === '1' || learning.getSetting(db, 'scope_sweep_enabled', 'false') === 'true')) return 'sweep-disabled';
    if (learning.getSetting(db, 'learning_exclude_machine_confirms', 'false') !== 'true') return 'machine-confirms-not-excluded';
    if (!trust._gateUnifyEnabled(db)) return 'gate-unify-off';
    try { if (require('../licensing/handler').licenseDenied(db)) return 'license'; } catch { return 'license'; }
    return null;
  }
  // Scope-local offer: the queue-wide SELECT narrowed to one (supplier, type). Same exclusions
  // (blank supplier impossible here, workflow-locked, being viewed), same ONE formats scan, same
  // cap, same server-recorded offer + audit row (C8/C9 hold for the automatic path too).
  function _sweepOfferForScope(db, sup, dtRow) {
    const trust = require('../../../database/modules/trust');
    const { extractionsFingerprint } = require('../../services/sweepPredicate');
    const presence = require('../../services/presenceService').shared();
    const rows = db.prepare(`
      SELECT d.* FROM documents d
       WHERE d.status = 'needs_review'
         AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
         AND d.document_type_id = ?
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
       ORDER BY d.id LIMIT 500`).all(sup.toLowerCase(), dtRow.id)
      .filter(d => !presence.viewers(d.id).length);
    if (!rows.length) return [];
    const eligibleIds = new Set(trust.autoFileEligibleIds(db, rows) || []);
    const fpStmt = db.prepare('SELECT * FROM extractions WHERE document_id = ?');
    const candidates = [];
    for (const d of rows) {
      if (!eligibleIds.has(d.id)) continue;
      if (candidates.length >= SWEEP_CAP) break;
      candidates.push({ docId: d.id, tier: 1, fingerprint: extractionsFingerprint(fpStmt.all(d.id)) });
    }
    if (candidates.length) {
      _sweepOffers.set(_sweepOfferKey(sup, dtRow.slug), new Set(candidates.map(c => c.docId)));
      try {
        logAudit(db, { action: 'scope_sweep_offered', target_type: 'scope', outcome: 'offered',
          metadata: { supplier: sup, type_slug: dtRow.slug, scope_local: true, auto_accept: true,
                      doc_ids: candidates.map(c => c.docId).join(','),
                      tiers: candidates.map(() => 1).join(',') } });
      } catch { /* audit is best-effort */ }
    }
    return candidates;
  }
  async function _autoAcceptScope(db, supplier, typeSlug, actor) {
    const sup = String(supplier || '').trim();
    const slug = String(typeSlug || '').toLowerCase().trim();
    if (!sup || !slug) return { ok: false, reason: 'bad-scope' };
    const pre = _autoAcceptPreconditions(db);
    if (pre) return { ok: false, reason: pre };
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };                       // never mid-batch
    if (_quietLaneActiveScopes.has(_sweepOfferKey(sup, slug))) return { ok: false, reason: 'quiet-lane-active' };
    const dtRow = db.prepare('SELECT * FROM document_types WHERE LOWER(slug) = ?').get(slug);
    if (!dtRow) return { ok: false, reason: 'unknown-type' };
    const filedAll = [], droppedAll = [];
    let passes = 0;
    while (passes < AUTO_ACCEPT_MAX_PASSES) {
      if (_anyProcessingBusy()) break;                                                  // a batch started: yield
      const candidates = _sweepOfferForScope(db, sup, dtRow);
      if (!candidates.length) break;
      passes++;
      // r18 A3 (Oracle): the AUTO accept is not a consented File N — stamp a machine name, never the
      // person whose confirm merely triggered it ("the records say I confirmed them"). Trust keys on
      // confirmed_via, never the name; the Home tally + the tile match 'Auto-filed%'.
      const _autoActor = { ...(actor || {}), username: 'Auto-filed (after your confirms)' };   // r19 N5: the audit row's user_id is nulled by reviewService for a machine via
      const r = await _sweepAcceptCore(db, { sup, slug, accepts: candidates, untickedIds: [], actor: _autoActor, auto: true });
      if (!r || !r.ok) break;
      filedAll.push(...r.filed); droppedAll.push(...r.dropped);
      for (const id of r.filed) { try { _recordAutoFiled(db, id, false); } catch {} }   // S1-C4: the receipt
      if (r.filed.length < SWEEP_CAP) break;                                            // the scope is drained
      await new Promise(res => setImmediate(res));                                       // S1-C6: yield between passes
    }
    if (filedAll.length) {
      try {
        logAudit(db, { action: 'scope_sweep_auto_accepted', target_type: 'scope', outcome: 'success',
          metadata: { supplier: sup, type_slug: slug, filed_ids: filedAll.join(','), passes,
                      dropped: droppedAll.map(d => `${d.docId}:${d.reason}`).join(',') } });
      } catch { /* audit is best-effort */ }
      try {
        const documents = require('../../../database/modules/documents');
        notifyMainWindow('doc-auto-filed', { docId: filedAll[filedAll.length - 1], count: getAutoFiledIds(db).length });
        notifyMainWindow('scope-auto-filed', { supplier: sup, typeSlug: slug, filed: filedAll.slice() });
        notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
        notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
      } catch { /* broadcast is best-effort */ }
    }
    return { ok: true, filed: filedAll, dropped: droppedAll, passes };
  }
  // The trigger: reviewService fires this for HUMAN confirms only (S1-C3 — the accept's own
  // confirms carry via='scope_sweep' and never re-enter). Debounced per scope so File-All's burst
  // of confirms on one sender becomes one pass after the burst; single-flight so two senders'
  // passes never interleave with each other (or with a consent-bar accept).
  function scheduleScopeAutoAccept(db, { supplier, typeSlug, via } = {}) {
    if (via) return false;                                                            // machine confirm: never a trigger
    const sup = String(supplier || '').trim(), slug = String(typeSlug || '').toLowerCase().trim();
    if (!sup || !slug) return false;
    if (_autoAcceptPreconditions(db)) return false;                                   // cheap early exit while dark
    const key = _sweepOfferKey(sup, slug);
    clearTimeout(_autoAcceptTimers.get(key));
    _autoAcceptTimers.set(key, setTimeout(() => {
      _autoAcceptTimers.delete(key);
      if (_autoAcceptInflight) { scheduleScopeAutoAccept(db, { supplier: sup, typeSlug: slug }); return; }   // re-queue behind the running pass
      _autoAcceptInflight = true;
      _autoAcceptScope(getDb(), sup, slug, getCurrentUser() || {})
        .catch(e => { try { logger?.warn?.(`[auto-accept] ${sup}|${slug}: ${e && e.message}`); } catch {} })
        .finally(() => { _autoAcceptInflight = false; });
    }, 1500));
    return true;
  }
  _scheduleScopeAutoAcceptImpl = scheduleScopeAutoAccept;
  _autoAcceptInflightProbe = () => _autoAcceptInflight;
  _setReprocessStatusForTestImpl = (st) => { _reprocessStatus = { ..._reprocessStatus, ...st }; };
  _debugAutoAcceptPreImpl = (d) => ({ pre: _autoAcceptPreconditions(d), busy: _anyProcessingBusy(), inflight: _autoAcceptInflight });
  _reprocessOfferProbe = () => _reprocessOffer;

  // ── Slice 3 (2026-08-21, eric+gary → Oracle S3-C1..C6): the QUIET BACKGROUND RE-READ LANE ─────
  // See quietLane.js for the design. Everything the lane touches is injected here, and every piece
  // of it is the SAME code the foreground reprocess runs (_stageReprocessDocs / _runReprocessShard /
  // applyReprocessResult) — the lane adds only its own proc list, its own env (the below-normal
  // priority marker) and its merge gate. DARK: `quiet_reread_enabled` (mig 79, OFF) / QUIET_REREAD.
  const _quietEnabled = (db) => {
    if (process.env.QUIET_REREAD === '0') return false;
    const learning = require('../../../database/modules/learning');
    const on = process.env.QUIET_REREAD === '1' || learning.getSetting(db, 'quiet_reread_enabled', 'false') === 'true';
    if (!on) return false;
    try { if (require('../licensing/handler').licenseDenied(db)) return false; } catch { return false; }
    return true;
  };
  const _quietLane = require('./quietLane').create({
    getDb,
    enabled: _quietEnabled,
    isForegroundBusy: _anyProcessingBusy,
    stageDocs: (db, chunk, { auditMeta } = {}) => {
      const learning2 = require('../../../database/modules/learning');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-qb-'));
      const { args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath, logger);
      const staged = _stageReprocessDocs(db, chunk, tmpDir, { auditMeta });
      for (const [name, nd] of Object.entries(staged.nameToDoc)) {
        const src = chunk.find(c => c.docId === nd.docId);
        if (src) nd.folderPath = src.folderPath;
      }
      const manifestFile = writeTempJson('qbmanifest', staged.manifest);
      return {
        tmpDir, manifestFile, trainingArgs, tmpNames: staged.tmpNames, nameToDoc: staged.nameToDoc,
        reprMode: _validMode(learning2.getSetting(db, 'processing_mode', 'smart')), diagOn: _diagEnabled(db),
        cleanup: () => { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} cleanupFiles([manifestFile, ...tempFiles]); },
      };
    },
    runShard: ({ db, staged, label, extraEnv, track, onFileDone }) => {
      // Split the chunk across a few concurrent workers (owner: the 1-worker lane "is quite slow").
      // The per-shard OMP cap is _reprocessThreadCap UNCHANGED — every doc reads under the identical
      // threading whether the lane runs 1 worker or several (S3-C4: no boundary glyph flips → no
      // phantom "read differently" holds). Shard COUNT is the only lever, bounded by
      // _quietLaneWorkers so nShards * cap stays ≈ cores. Every shard is track()ed → demoted
      // BELOW_NORMAL and killed together by preempt(); Promise.all resolves only when ALL finish, so
      // the caller's cleanup/defer logic is unchanged. Round-robin partition ⇒ no doc in two shards,
      // and the synchronous per-doc merge gate serialises the two streams on the event loop.
      const cap = _reprocessThreadCap(db);         // S3-C4: identical cap on every shard
      const nShards = Math.min(_quietLaneWorkers(db), staged.tmpNames.length);
      const shards = nShards > 1 ? partitionRoundRobin(staged.tmpNames, nShards) : [staged.tmpNames];
      return Promise.all(shards.map(shard => _runReprocessShard({
        db, tmpDir: staged.tmpDir, shard, manifestFile: staged.manifestFile,
        trainingArgs: staged.trainingArgs, reprMode: staged.reprMode, diagOn: staged.diagOn,
        deskewAll: false, deskewMinAngle: 0.2,
        threadCap: cap,
        label, extraEnv, track, onFileDone,
        onMsg: () => {},                           // never the reprocess-progress channel
      })));
    },
    applyResult: (db, docId, existing, msg, filename, opts) => applyReprocessResult(db, docId, existing, msg, filename, _diagEnabled(db), opts),
    presence: require('../../services/presenceService').shared(),
    extractionsFingerprint: require('../../services/sweepPredicate').extractionsFingerprint,
    notify: (evt) => { notifyMainWindow('quiet-reprocess', evt); try { notifyDevInspector?.('quiet-reprocess', evt); } catch {} },
    logAudit, logger,
    setPriority: (pid, prio) => os.setPriority(pid, prio),
    taskkill: (pid) => require('child_process').spawnSync(TASKKILL_EXE, ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }),
    markScopeActive: (key, on) => { if (on) _quietLaneActiveScopes.add(key); else _quietLaneActiveScopes.delete(key); },
    findSiblings: (db, seedId, value, opts) => require('../../../database/modules/supplierSiblings').findSiblings(db, seedId, value, opts),
    // (c′) keyword-fingerprint selection (2026-08-22): the matcher's JS mirror at its named threshold.
    kwSelect: (db, ocrText, slug) => {
      const T = require('../../../database/modules/templates');
      const m = T.findByKeywordFingerprint(db, ocrText, T.KEYWORD_THRESHOLD, slug);
      return m && m.template ? m.template.id : null;
    },
    kwSelectEnabled: (db) => process.env.QUIET_REREAD_KW_SELECT === '1'
      || (process.env.QUIET_REREAD_KW_SELECT !== '0' && require('../../../database/modules/learning').getSetting(db, 'quiet_reread_kw_select', 'false') === 'true'),
    scopeTemplateIds: (db, sup, slug) => require('../../../database/modules/scopeReadiness').templateIds(db, sup, slug),
    // Q3 (2026-08-22): the LAYOUT arm's preconditions + the first-fill corroboration licence.
    layoutArm: {
      enabled: (db) => _layoutRereadEnabled(db),
      onPage: (db) => require('../../../database/modules/learning').getSetting(db, 'template_identity_on_page', 'false') === 'true',
      nameTokens: (name) => nameArmTokens(name),
    },
    corroborated: (rec) => require('../../../database/modules/trust')._corrobLicensed(rec),
    typeSplitArm: { enabled: (db) => _typeSplitRippleOn(db) },   // A6
    // Owner card 1 (2026-08-23): the READY arm — DARK behind `quiet_reread_on_ready_templated`, riding
    // `quiet_reread_on_ready` (the crossing itself). The floor is the scope's LIVE trust floor.
    // Chris r18 A1 (Oracle 2026-08-23): the per-job FIELD-RELIABILITY hold on first-fills. DARK.
    firstFillReliability: { enabled: (db) => _firstFillReliabilityEnabled(db), k: FIRST_FILL_UNRELIABLE_K },
    readyArm: {
      enabled: (db) => _readyTemplatedEnabled(db),
      floor: (db, supplier, slug) => { const t = require('../../../database/modules/trust').scopeTrust(db, supplier, slug); return t && Number.isFinite(t.floor) ? t.floor : null; },
    },
    // S3-(c): the lane's re-read docs reach filing ONLY via the sweep — a re-ask for the scope (the
    // renderer also re-runs the consent sweep on job_done, so the bar path is covered when
    // auto-accept is off).
    onJobDone: (db, { supplier, typeSlug }) => scheduleScopeAutoAccept(db, { supplier, typeSlug }),
  });
  _quietLaneImpl = _quietLane;

  // ── THE 'READY' CROSSING (P2 trigger, 2026-08-22, gary → Oracle C2.4) ─────────────────────────
  // A TAUGHT sender's held siblings keep a stale hold after the confirm that makes the scope READY
  // (Chris 13b card 1; the owner's run): the lane fired on a teach and on a graduation MINT, not on
  // the 3rd confirm. Now: reviewService asks `readyProbe` for the scope BEFORE the claim and passes
  // `readyBefore`; after the confirm lands, `scheduleReadyReread` computes readyAfter and schedules
  // the lane with reason 'ready' exactly when !before && after — one fire per crossing, no memo
  // persisted, the 4th confirm sees before=true. COST BOUND: the probe memoises per scope for 10 s
  // (a File-All burst asks once per scope), and readyAfter is computed only when before was false —
  // a READY scope costs zero extra format scans per confirm. DARK behind `quiet_reread_on_ready`.
  const _readyMemo = new Map();           // scopeKey -> { ready, at }
  const READY_MEMO_MS = 10000;
  const _readyOn = (db) => process.env.QUIET_REREAD_ON_READY === '1'
    || (process.env.QUIET_REREAD_ON_READY !== '0' && require('../../../database/modules/learning').getSetting(db, 'quiet_reread_on_ready', 'false') === 'true');
  function readyProbe(db, supplier, typeSlug) {
    if (!_quietEnabled(db) || !_readyOn(db)) return null;
    const key = _sweepOfferKey(supplier, typeSlug);
    if (!supplier || !typeSlug) return null;
    const m = _readyMemo.get(key);
    if (m && (Date.now() - m.at) < READY_MEMO_MS) return m.ready;
    let ready = false;
    try { ready = !!require('../../../database/modules/scopeReadiness').isReady(db, supplier, typeSlug).ready; } catch { ready = false; }
    _readyMemo.set(key, { ready, at: Date.now() });
    return ready;
  }
  function scheduleReadyReread(db, { supplier, typeSlug, readyBefore, seedDocId, via } = {}) {
    if (via) return false;                                   // machine confirms never trigger
    if (readyBefore !== false) return false;                 // null = probe off/unknown; true = already ready
    if (!_quietEnabled(db) || !_readyOn(db)) return false;
    let after = false;
    try { after = !!require('../../../database/modules/scopeReadiness').isReady(db, supplier, typeSlug).ready; } catch { after = false; }
    const key = _sweepOfferKey(supplier, typeSlug);
    _readyMemo.set(key, { ready: after, at: Date.now() });
    if (!after) return false;
    return _quietLane.schedule(db, { supplier, typeSlug, reason: 'ready', seedDocId });
  }
  // ── A6 (type-split arc): the confirm-once ripple's scheduler. Fires from reviewService via the
  // review handler after a HUMAN confirm of a doc that carried the Fix A note. JS PRE-CHECK (Oracle
  // S1): the waiver switch (A2) must be ON and every OTHER-type template the sender owns must be
  // UNSUPPORTED (<2 confirmed docs) — otherwise the re-read would only re-plant the note, so skip
  // with an audit row. DARK behind `type_ambiguity_ripple`; rides `quiet_reread_enabled`.
  function scheduleTypeSplitReread(db, { supplier, typeSlug, templateId, seedDocId, via } = {}) {
    if (via) return false;
    if (!_quietEnabled(db) || !_typeSplitRippleOn(db)) return false;
    const sup = String(supplier || '').trim(), slug = String(typeSlug || '').trim().toLowerCase();
    if (!sup || !slug || !templateId) return false;
    let skip = null;
    if (!(process.env.TYPE_AMBIG_UNSUPPORTED_WAIVER === '1'
          || require('../../../database/modules/learning').getSetting(db, 'type_ambiguity_unsupported_waiver', 'false') === 'true')) skip = 'waiver_off';
    if (!skip) {
      try {
        // the sender's OTHER-type templates (owned: frozen supplier or sample doc is the sender's) and
        // their LIVE confirmed counts — the same "unsupported" the matcher judges (<2, any via)
        // Learning-excluded docs (Learning Repair "start fresh", mig 90) never count as SUPPORT for a
        // rival-type template — the same shared predicate every learning reader carries.
        const _lex = require('../../../database/modules/machine_vias').learningExcludedSql;
        const rivals = db.prepare(`
          SELECT t.id, t.document_type_slug AS slug,
                 (SELECT COUNT(*) FROM documents d WHERE d.template_id = t.id AND d.status = 'confirmed'${_lex(db, 'd')}) AS n
            FROM templates t
           WHERE LOWER(COALESCE(t.document_type_slug, '')) <> ?
             AND (EXISTS (SELECT 1 FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name'
                            AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = ?)
                  OR EXISTS (SELECT 1 FROM documents sd WHERE sd.id = t.sample_document_id
                            AND LOWER(TRIM(COALESCE(sd.supplier_name, ''))) = ?)
                  OR EXISTS (SELECT 1 FROM documents cd WHERE cd.template_id = t.id AND cd.status = 'confirmed'${_lex(db, 'cd')}
                            AND LOWER(TRIM(COALESCE(cd.supplier_name, ''))) = ?))`).all(slug, sup.toLowerCase(), sup.toLowerCase(), sup.toLowerCase());
        const bySlug = new Map();
        for (const r of rivals) bySlug.set(r.slug, Math.max(bySlug.get(r.slug) || 0, Number(r.n) || 0));
        const supported = [...bySlug.entries()].filter(([, n]) => n >= 2).map(([s]) => s);
        if (supported.length) skip = `rival_supported:${supported.join(',')}`;
      } catch (e) { skip = 'precheck_failed'; }
    }
    if (skip) {
      try { logAudit(db, { action: 'type_split_ripple_skipped', action_category: 'learning', target_type: 'template', target_id: templateId,
                           document_id: seedDocId || null, outcome: 'skipped', details: JSON.stringify({ supplier: sup, typeSlug: slug, why: skip }) }); } catch {}
      return false;
    }
    return _quietLane.schedule(db, { supplier: sup, typeSlug: slug, reason: 'typesplit', seedDocId, typeSplitTemplateId: templateId });
  }
  _scheduleTypeSplitRereadImpl = scheduleTypeSplitReread;
  _readyProbeImpl = readyProbe;
  _scheduleReadyRereadImpl = scheduleReadyReread;
  _applyReprocessResultImpl = applyReprocessResult;
  // ── B1: the activity ledger's IPC (event-id addressed — the renderer never sends a doc-id list) ──
  ipcMain.handle('get-review-events', () => { requireRole('admin', 'edit'); return _reviewEvents ? _reviewEvents.list(getDb()) : []; });
  ipcMain.handle('review-events-seen', (_e, { uptoId } = {}) => { requireRole('admin', 'edit'); return { ok: true, marked: _reviewEvents ? _reviewEvents.markSeen(getDb(), uptoId) : 0 }; });
  ipcMain.handle('get-review-event-docs', (_e, { eventId } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const ev = _reviewEvents ? _reviewEvents.get(db, eventId) : null;
    if (!ev) return { ok: false, reason: 'unknown-event', docs: [] };
    const documents = require('../../../database/modules/documents');
    return { ok: true, docs: documents.getByIds(db, ev.ids || []) };
  });
  // File All Ready kept-back receipt: the renderer sends only the DROPPED set (docId + reason code) — never
  // filed ids (those were recorded per-doc as approved|bulk). The ledger merges the reasons into this run's
  // approved|bulk chip, or — when nothing filed — creates a zero-count chip so the strip is never silent
  // after a File All (the record() null at zero ids/zero dropped was the "no chip appeared" bug). Best-effort;
  // undo:null (a human via, never sweep-undoable). Presentation only — cannot affect any filing.
  ipcMain.handle('record-file-all-outcome', (_e, { dropped } = {}) => {
    requireRole('admin', 'edit');
    if (!Array.isArray(dropped) || !dropped.length) return { ok: false, reason: 'nothing-to-record' };
    const ev = recordReviewEvent(getDb(), { kind: 'approved', bulk: true, ids: [], dropped,
      scope: { supplier: null, typeSlug: null }, undo: null });
    return { ok: !!ev };
  });
  // Undo by EVENT: sweep → the same checks as sweep-scope-undo (confirmed + confirmed_via scope_sweep),
  // CHUNKED in 25s with a yield between chunks, {undone, refused} honest (Oracle C7 — the legacy door's
  // silent .slice(0,25) undid 25 of 125 with no message); classfix → classFixService.undoBatch; any other
  // kind, or an event past the undo window → refused.
  ipcMain.handle('review-event-undo', async (_e, { eventId } = {}) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const ev = _reviewEvents ? _reviewEvents.get(db, eventId) : null;
    if (!ev) return { ok: false, reason: 'unknown-event', undone: [], refused: [] };
    if (ev.put_back_at) return { ok: false, reason: 'already-put-back', undone: [], refused: [] };   // card 7: a stale render pressed Put back twice
    if (!_reviewEvents._undoable(ev)) return { ok: false, reason: 'not-undoable', undone: [], refused: (ev.ids || []).slice() };
    const documents = require('../../../database/modules/documents');
    const undone = [], refused = [];
    if (ev.undo.type === 'sweep') {
      const ids = (ev.ids || []).map(Number).filter(Boolean);
      for (let i = 0; i < ids.length; i += 25) {
        for (const id of ids.slice(i, i + 25)) {
          const row = db.prepare('SELECT id, status, confirmed_via FROM documents WHERE id = ?').get(id);
          if (!row || row.status !== 'confirmed' || row.confirmed_via !== 'scope_sweep') { refused.push(id); continue; }
          const r = documents.deconfirmDocument(db, id);
          if (r && r.changes) { undone.push(id); try { documents.markPutBack(db, id); } catch {} }   // A3: put back must STICK
          else refused.push(id);
        }
        await new Promise(res => setImmediate(res));
      }
    } else if (ev.undo.type === 'classfix' && ev.undo.batchId) {
      let r = null;
      try { r = require('../../services/classFixService').undoBatch(db, String(ev.undo.batchId), { actorName: (getCurrentUser() || {}).username || null, audit: logAudit, logger }); } catch (e) { r = { ok: false, reason: 'failed', message: e && e.message }; }
      if (r && r.ok) undone.push(...(ev.ids || [])); else refused.push(...(ev.ids || []));
      if (!(r && r.ok)) return { ok: false, reason: (r && r.reason) || 'failed', undone, refused };
    } else if (ev.undo.type === 'issuerfill' && ev.undo.batchId) {
      // #1 first-batch letterhead sibling-fill undo (2026-08-25). Restores the held state (note back,
      // conf back, marker gone) on every still-queued filled sibling; a sibling filed since is left alone.
      let r = null;
      try { r = require('../../services/issuerSiblingFillService').undoBatch(db, String(ev.undo.batchId), { actorName: (getCurrentUser() || {}).username || null, audit: logAudit, logger }); } catch (e) { r = { ok: false, reason: 'failed', message: e && e.message }; }
      if (r && r.ok) undone.push(...(ev.ids || [])); else refused.push(...(ev.ids || []));
      if (!(r && r.ok)) return { ok: false, reason: (r && r.reason) || 'failed', undone, refused };
    } else {
      return { ok: false, reason: 'not-undoable', undone: [], refused: (ev.ids || []).slice() };
    }
    try {
      if (undone.length) logAudit(db, { action: ev.undo.type === 'sweep' ? 'scope_sweep_undone' : ev.undo.type === 'issuerfill' ? 'issuer_sibling_fill_undone' : 'class_fix_undone', target_type: 'scope', outcome: 'success',
        metadata: { doc_ids: undone.join(','), refused_ids: refused.join(','), event_id: ev.id } });
    } catch { /* audit is best-effort */ }
    // card 7: the event stops offering Put back (full AND partial — the refused rows are non-sweep rows a
    // retry would refuse again); the updated event rides back so the renderer replaces its copy.
    const updated = undone.length ? _reviewEvents.markUndone(db, ev.id, { undone, refused }) : null;
    if (undone.length) recordReviewEvent(db, { kind: 'put_back', ids: undone, scope: ev.scope || { supplier: null, typeSlug: null }, undo: null });
    try {
      notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
      notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
    } catch { /* count broadcast is best-effort */ }
    return { ok: true, undone, refused, event: updated };
  });
  ipcMain.handle('get-quiet-reread-status', () => _quietLane.status());
  ipcMain.handle('cancel-quiet-reread', (_e, { jobId } = {}) => { requireRole('admin', 'edit'); return { ok: _quietLane.cancel(String(jobId || '')) }; });

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
      if (r && r.changes) { undone.push(id); try { documents.markPutBack(db, id); } catch {} }   // A3: put back must STICK
      else refused.push(id);
    }
    try {
      if (undone.length) logAudit(db, { action: 'scope_sweep_undone', target_type: 'scope', outcome: 'success',
        metadata: { doc_ids: undone.join(','), refused_ids: refused.join(',') } });
    } catch { /* audit is best-effort */ }
    if (undone.length) recordReviewEvent(db, { kind: 'put_back', ids: undone, scope: { supplier: null, typeSlug: null }, undo: null });   // B1: an undo is a receipt too
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
  // ── SHARED STAGING + SHARD RUNNER (2026-08-21, eric → Oracle S3) ───────────────────────────
  // The foreground `reprocess-batch` below and the QUIET LANE (quietLane.js) run the SAME staging
  // (lock check, working-copy staging, existing-rows snapshot, per-doc manifest overrides, audit
  // row) and the SAME shard spawn (args, env, thread cap, stdout contract, watchdog). Extracted
  // statement-for-statement from the handler so the two paths cannot drift — the thread-cap
  // identity rule (`_reprocessThreadCap`) and every manifest override are read from ONE place. The
  // handler's observable behaviour is unchanged; the lane differs only in what it passes in (its
  // own proc list, its own env, its own file_done handler).
  function _stageReprocessDocs(db, docs, tmpDir, { auditMeta } = {}) {
    const templates2 = require('../../../database/modules/templates');
    const manifest  = {};   // tmpName -> { known_template_id, known_doc_slug, enhance_params }
    const nameToDoc = {};   // tmpName -> { docId, filename, existing }
    const tmpNames  = [];
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
        nameToDoc[tmpName] = { docId: d.docId, filename: d.filename, existing, via: d.via || null };   // via: which lane arm selected it (Q3: 'layout')
        tmpNames.push(tmpName);
        logAudit(db, { action: 'reprocess', target_type: 'document', target_id: d.docId,
          document_id: d.docId, outcome: 'success', metadata: { batch: true, ...(auditMeta || {}) } });
      } catch (e) { logger?.warn(`reprocess-batch stage ${d.filename}: ${e.message}`); }
    }
    return { manifest, nameToDoc, tmpNames, lockedSkipped };
  }
  function _runReprocessShard({ db, tmpDir, shard, manifestFile, trainingArgs, reprMode, diagOn, deskewAll, deskewMinAngle,
                                threadCap, label, extraEnv, track, onFileDone, onMsg }) {
    return new Promise((resolve) => {
      const filesFile = writeTempJson('rbfiles', shard);
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
        ...(extraEnv || {}),
      };
      const proc = spawn(pythonExe(), pythonArgs(backendScript(), ...scriptArgs), { windowsHide: true, env });
      if (track) track(proc);
      let buf = '', settled = false, watchdog = null;
      const fin = () => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); try { fs.unlinkSync(filesFile); } catch {} resolve(); };
      watchdog = setTimeout(() => {
        logger?.err(`${label} shard timed out`);
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
          if (msg.type === 'file_done') { _recordDevDoc(msg); onFileDone(msg); }
          else if (msg.type !== 'start') { if (onMsg) onMsg(msg); }   // file_begin / log
        }
      });
      proc.stderr.on('data', d => { const tx = d.toString().trim(); if (tx) logger?.warn(`${label} stderr: ${tx}`); });
      proc.on('error', (e) => { logger?.err(`${label} spawn: ${e.message}`); fin(); });
      proc.on('close', fin);
    });
  }

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
    const _staged = _stageReprocessDocs(db, docs, tmpDir);
    Object.assign(manifest, _staged.manifest); Object.assign(nameToDoc, _staged.nameToDoc);
    tmpNames.push(..._staged.tmpNames);
    const lockedSkipped = _staged.lockedSkipped;
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
    // Per-worker thread cap — from the CONFIGURED concurrency, never the per-run shard count
    // (see _reprocessThreadCap: identical Tesseract threading across single/small/full
    // reprocess is what keeps a boundary glyph reading the SAME on every path). Still bounds
    // total threads ≈ cores when the pool is full; a smaller batch runs mildly under-threaded
    // rather than differently-read. Applied to EVERY shard incl. a single-shard run (an
    // uncapped 1-shard batch was the old single-vs-batch disparity in miniature).
    const threadCap = _reprocessThreadCap(db);

    // docIds: the batch's own docs (post-lock-filter — nameToDoc holds only staged docs), recorded
    // so the post-reprocess consent offer is SERVER-scoped (Oracle 2026-08-12 C1: no renderer-fed
    // id list). A new batch starting overwrites any unconsumed prior offer — fail-safe: those docs
    // simply stay queued (pinned in test_reprocess_autocommit.js).
    _reprocessOffer = null;
    _reprocessStatus = { running: true, total: tmpNames.length, done: 0, failed: 0, pendingCompletion: false,
                         docIds: Object.values(nameToDoc).map(n => n.docId) };
    mirrorReprocess({ type: 'start', total: tmpNames.length });
    let done = 0, failed = 0;
    const shardFiles = [];
    _currentBatchProcs = [];
    try { _quietLaneImpl && _quietLaneImpl.preempt('reprocess-batch'); } catch {}   // Slice 3: the foreground always wins
    // r19 N1 (P1): the batch's holds — one object keyed per (supplier|slug|field) so a queue-wide
    // Reprocess never lets one sender's bad box hold another sender's first-fills (C3).
    const _holdsOn = _reprocessHoldsEnabled(db);
    const _holds = _holdsOn ? _rereadHolds() : null;
    const _holdsBatch = _holdsOn ? _holds.newBatch() : null;
    let _holdsRel = { released: [], held: [] };

    const runShard = (shard) => _runReprocessShard({
      db, tmpDir, shard, manifestFile, trainingArgs, reprMode, diagOn, deskewAll, deskewMinAngle, threadCap,
      label: 'reprocess-batch',
      track: (p) => _currentBatchProcs.push(p),
      onFileDone: (msg) => {
        const nd = nameToDoc[msg.original_filename] || nameToDoc[msg.filename];
        if (nd && msg.success && msg.extractions) {
          try {
            applyReprocessResult(db, nd.docId, nd.existing, msg, nd.filename, diagOn); done++;
            // r19 N1 (P1): the same holds the lane writes — S3-C5 (C1 baseline) + a PROVISIONAL first-fill
            // hold released at batch end unless the field proved unreliable in this batch.
            if (_holdsOn) { try { _holds.onDocMerged(db, _holdsBatch, { docId: nd.docId, existing: nd.existing, via: 'manual', reliability: true }); } catch (e) { logger?.warn?.(`reprocess holds ${nd.filename}: ${e && e.message}`); } }
          }
          catch (e) { failed++; logger?.err(`reprocess-batch merge ${nd.filename}: ${e.message}`); }
        } else if (nd) { failed++; }
        _reprocessStatus.done = done; _reprocessStatus.failed = failed;
        mirrorReprocess({ type: 'file_done', done, failed, total: tmpNames.length, docId: nd ? nd.docId : null });
      },
      onMsg: (msg) => mirrorReprocess(msg),
    });

    try {
      await Promise.all(shards.map(runShard));
    } finally {
      // r19 N1 (P1 C4): release the reliable first-fills BEFORE the batch stops counting as busy — a
      // confirm-debounce sweep or the F2b offer must see the final rows, never the provisional ones.
      if (_holdsOn) {
        try { _holdsRel = _holds.release(db, _holdsBatch); } catch (e) { logger?.warn?.(`reprocess holds release: ${e && e.message}`); }
        try { logAudit(db, { action: 'reprocess_holds', target_type: 'batch', outcome: 'success',
                             metadata: { field_unreliable: _holds.statsSummary(_holdsBatch), held_ids: _holdsRel.held.map(h => h.docId).join(','), released_ids: _holdsRel.released.map(h => h.docId).join(',') } }); } catch {}
      }
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

  // Consume-once: a batch's window-side completion (summary counts + the post-reprocess consent
  // OFFER). Returns the final counts the FIRST time it is called after a batch finishes, then null.
  // Both the fresh-start window (which already ran its own completion) and a reopened window call it
  // — so the completion runs exactly once, whether or not a window was open at the finish line.
  // GATED (Oracle 2026-08-12 C3): this used to be a benign read; it now computes a filing OFFER, so
  // it requires admin/edit + a valid license — and the gates run BEFORE the once-flag flips, so a
  // refused consume never swallows the completion (it stays pending for a permitted caller).
  // The queue-wide autoCommitFullConfidence sweep this replaces filed 101 docs across every supplier
  // after a 14-doc group reprocess (2026-08-12) — the offer is scoped to the batch's OWN docs and
  // nothing files without the operator accepting the bar (reprocess-autocommit-accept below).
  ipcMain.handle('consume-reprocess-completion', async () => {
    requireRole('admin', 'edit');
    if (!_reprocessStatus.pendingCompletion) return null;
    const db = getDb();
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return null;   // completion stays pending — no flip, no offer
    // C2: flip synchronously before any other work; the offer computation below is sync better-sqlite3.
    _reprocessStatus.pendingCompletion = false;
    const out = { done: _reprocessStatus.done, failed: _reprocessStatus.failed, total: _reprocessStatus.total };
    // F2b (Chris r13 card 1 → Oracle C2b.1, 2026-08-22): with the scope-local auto-accept ON, a
    // human-initiated "Reprocess N from <sender>" is itself the trigger — run the SAME scope-local
    // pass for every scope the batch touched (scopes read from the POST-merge rows, C2b.2) BEFORE the
    // consent offer is built, so the bar below can only ever offer the REMAINDER. Two doors from one
    // trigger was refused: a bar that offers already-filed documents is the silent-revert UX class
    // ("File 14" → filed 0). Preconditions + receipt + Put back are the pass's own. Fail-quiet.
    try {
      if (!_autoAcceptPreconditions(db) && !_anyProcessingBusy() && !_autoAcceptInflight) {
        const scopes = new Map();
        const scopeStmt = db.prepare(`SELECT d.status, d.supplier_name, dt.slug AS type_slug FROM documents d
                                        LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`);
        for (const id of (_reprocessStatus.docIds || [])) {
          const d = scopeStmt.get(id);
          if (!d || d.status !== 'needs_review' || !String(d.supplier_name || '').trim() || !d.type_slug) continue;
          const key = _sweepOfferKey(d.supplier_name, d.type_slug);
          if (!scopes.has(key)) scopes.set(key, { supplier: String(d.supplier_name).trim(), slug: d.type_slug });
        }
        if (scopes.size) {
          _autoAcceptInflight = true;
          try {
            const actor = getCurrentUser() || {};
            for (const sc of scopes.values()) {
              const r = await _autoAcceptScope(db, sc.supplier, sc.slug, actor);
              if (r && r.filed && r.filed.length) out.autoFiled = (out.autoFiled || 0) + r.filed.length;
            }
          } finally { _autoAcceptInflight = false; }
        }
      }
    } catch (e) { logger?.warn(`reprocess auto-accept: ${e && e.message}`); }
    // Consent offer: batch docIds ∩ the shared predicate — the SAME trust.isAutoFileEligible the
    // import auto-file uses, so the two sites can't diverge. Setting-gated; OFF ⇒ byte-identical
    // to the legacy counts-only return.
    try {
      const learningMod = require('../../../database/modules/learning');
      if (learningMod.getSetting(db, 'reprocess_autocommit_offer', 'true') === 'true') {
        const trust = require('../../../database/modules/trust');
        const documents = require('../../../database/modules/documents');
        // Batch docs still queued + not workflow-locked, then the ONE shared batch predicate
        // (getFieldFormats scanned once — same call the retired get-auto-file-eligible IPC made).
        const rows = (_reprocessStatus.docIds || [])
          .map(id => documents.getById(db, id))
          .filter(d => d && d.status === 'needs_review'
                    && !['pending', 'claimed'].includes(String(d.workflow_status || '')));
        const candidates = trust.autoFileEligibleIds(db, rows);
        if (candidates.length) {
          _reprocessOffer = { docIds: candidates };
          out.offerIds = candidates;   // display only — accept takes NO payload
        }
      }
    } catch (e) { logger?.warn(`reprocess offer: ${e.message}`); }
    return out;
  });

  // Post-reprocess consent-bar ACCEPT (Oracle 2026-08-12, SIGN-OFF-W/COND — the consent-bar ruling).
  // Payload-less: files the server-recorded offer, re-checking status/workflow/eligibility per doc
  // at accept time, through the ONE shared confirm with the INTERNAL via='auto_reprocess' (machine
  // attribution: confirmed_via + 'Auto-filed (reprocess)' username; excluded from the human
  // graduation window in trust.js; hint/template learning self-skip via the sentinel).
  ipcMain.handle('reprocess-autocommit-accept', async () => {
    requireRole('admin', 'edit');
    const db = getDb();
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { ok: false, reason: 'license' };
    if (_anyProcessingBusy()) return { ok: false, reason: 'busy' };
    const offer = _reprocessOffer;
    _reprocessOffer = null;   // consume-once — a second accept files nothing
    if (!offer || !Array.isArray(offer.docIds) || !offer.docIds.length) return { ok: false, reason: 'no-offer' };
    const trust = require('../../../database/modules/trust');
    const documents = require('../../../database/modules/documents');
    const reviewService = require('../review/handler').getReviewService();
    if (!reviewService) return { ok: false, reason: 'not-ready' };
    const actor = getCurrentUser() || {};
    const filed = [], dropped = [];
    for (const docId of offer.docIds) {
      const doc = documents.getById(db, docId);
      if (!doc || doc.status !== 'needs_review') { dropped.push({ docId, reason: 'not-queued' }); continue; }
      if (['pending', 'claimed'].includes(String(doc.workflow_status || ''))) { dropped.push({ docId, reason: 'workflow-locked' }); continue; }
      const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId);
      const elig = trust.isAutoFileEligible(db, doc, { extractions: rows.map(r => ({ ...r, value: r.display_value })) });
      if (!elig || !elig.eligible) { dropped.push({ docId, reason: (elig && elig.reason) || 'no-longer-eligible' }); continue; }
      const allValues = {};
      for (const r of rows) allValues[r.field_key] = r.display_value ?? r.raw_value;
      const dtRow = doc.document_type_id
        ? db.prepare('SELECT * FROM document_types WHERE id = ?').get(doc.document_type_id) : null;
      let res;
      try {
        res = await reviewService.confirm(db, actor, {
          document_id: docId,
          allValues,
          corrections: {},
          taught_fields: [],
          supplier_name: doc.supplier_name,
          document_type: dtRow ? dtRow.name : null,
          document_type_slug: dtRow ? dtRow.slug : null,
          bulk: true,
        }, { via: 'auto_reprocess' });
      } catch (e) { res = { ok: false, code: 'ERROR', error: e && e.message }; }
      if (res && res.ok) {
        filed.push(docId);
        // the re-surface banner is a review checkpoint (Oracle C6); approved=true — the operator
        // clicked File N, so the banner must not call this one "automatic" (Chris r7 card 2)
        try { _recordAutoFiled(db, docId, true); } catch {}
      } else {
        dropped.push({ docId, reason: (res && res.code) || 'confirm-failed' });
      }
      await new Promise(r => setImmediate(r));   // main-process loop — keep the event loop breathing
    }
    try {
      logAudit(db, { action: 'reprocess_autofiled', target_type: 'scope', outcome: 'success',
        metadata: { filed_ids: filed.join(','), dropped: dropped.map(d => `${d.docId}:${d.reason}`).join(',') } });
    } catch { /* audit is best-effort */ }
    // B1: the post-reprocess "File N" click — approved, queue-wide (no single sender), not sweep-undoable
    if (filed.length || dropped.length) {
      recordReviewEvent(db, { kind: 'approved', ids: filed, dropped, approved: true, scope: { supplier: null, typeSlug: null }, undo: null });
    }
    return { ok: true, filed, dropped };
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

  // Every word on the page with its geometry: {w, h, words:[{t, b:[l,t,w,h], c}]} in the submitted
  // image's own pixels. Used by the teach wizard to find a TYPED value on the page and store the box
  // it was found at, so a manual entry still teaches a position (2026-08-10). Runs the PIPELINE's
  // full-page recipe, not the zone ladder — see region.py --page-words for why that matters. Always
  // resolves (never rejects): a failure comes back as an empty word list, i.e. "not found".
  ipcMain.handle('ocr-page-words', async (_e, base64png) => {
    requireRole('admin', 'edit');
    const tmpFile = path.join(os.tmpdir(), `ds_pw_${Date.now()}_${_ocrTmpSeq++}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
    const py = pythonExe();
    // Same OCR configuration as the pipeline (Oracle C3, light-text arc 2026-08-27): the render DPI and the
    // reconcile switches (incl. OCR_LIGHT_TEXT_RECOVERY) ride the spawn env exactly as on an import, so a
    // typed value printed in faint grey is findable here on the same scans the pipeline reads it from.
    let _pwEnv = {};
    try { const _db = getDb(); _pwEnv = { ..._ocrDpiEnv(_db), ..._reconcileEnv(_db) }; } catch { _pwEnv = {}; }
    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script,
        '--image-file', tmpFile, '--tesseract', tesseractPath(), '--page-words'),
        { windowsHide: true, env: { ...process.env, ..._pwEnv } });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      const done = (v) => { try { fs.unlinkSync(tmpFile); } catch {} resolve(v); };
      proc.on('error', () => done({ w: 0, h: 0, words: [] }));
      proc.on('close', () => {
        if (err) console.error('ocr_page_words stderr:', err);
        try { done(JSON.parse(out.trim())); } catch { done({ w: 0, h: 0, words: [] }); }
      });
    });
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
    // Q3: snapshot the authoritative row BEFORE the write so a no-op re-save never triggers a re-read.
    const _authSnap = () => {
      try {
        return JSON.stringify(db.prepare(`SELECT anchor_label, direction, x_norm, y_norm, w_norm, h_norm, offset_dx_norm, offset_dy_norm
                                             FROM field_anchors WHERE field_key = ? AND supplier_name IS ? AND document_type IS ?
                                              AND last_authoritative_at IS NOT NULL ORDER BY id`).all(data.field_key, data.supplier_name || null, data.document_type || null));
      } catch { return null; }
    };
    const _before = data && data.authoritative ? _authSnap() : null;
    learning.saveAnchor(db, data);
    // Q3 (Oracle C3.5): an AUTHORITATIVE anchor write that CHANGED the scope's layout schedules the
    // lane's 'layout' re-read for (supplier, type) — never a plain confirm, never an identical re-save.
    try {
      if (data && data.authoritative && data.supplier_name && data.document_type && _before !== null && _authSnap() !== _before) {
        scheduleQuietReread(db, { supplier: data.supplier_name, typeSlug: data.document_type, reason: 'layout', seedDocId: data.document_id || null });
      }
    } catch (e) { logger?.warn?.(`layout re-read (anchor): ${e && e.message}`); }

    // TAUGHT LABEL BECOMES THE KEYWORD (owner decision 2026-08-11).
    // A ⊕ teach persists `anchor_label` into `field_anchors`, which drives STAGE 2 anchoring —
    // and Stage 1 keyword carried on using the shipped caption bank. That is why a correct taught
    // `po_number` mapping coexisted with a keyword still hunting the generic 'ref': the operator
    // told the app the caption and the app only half-listened. The store that fixes it
    // (`field_label_overrides`) already existed and was already threaded into extraction; the only
    // writers were the admin Settings screen and the preset seeder. This is the missing WRITE.
    //
    // EXCLUSIVE, per the owner: the confirmed label REPLACES the shipped labels for that
    // (doc type, field) rather than being prepended to them (migration 61 + keyword.
    // merge_label_overrides). Additive was the old behaviour and is what let 'ref' keep winning.
    //
    // SCOPE (migration 62, owner decision 2026-08-11): "per doc type for each supplier — set at
    // the template level." The override row carries the template the taught document matched, and
    // Python applies it only when that template matches again — so a caption taught on one
    // supplier's statement can never become the keyword for every supplier's statements (the
    // doc-type-wide bleed that kept the mig-61 version of this flag OFF). A ⊕ teach on a document
    // with NO matched template has no template to scope to, and the write is SKIPPED — the anchor
    // itself (Stage 2) still carries the teach; the wizard path always has a template and is where
    // 38 of the 44 live taught captions come from anyway.
    //
    // Three guards, each earning its place:
    //   * an EMPTY label is the issuer's position-only sentinel (Oracle-signed 2026-07-10 — a
    //     phantom label makes the teach silently do nothing), so it must never become a keyword;
    //   * no doc-type slug means the override could not be scoped, so there is nothing to write;
    //   * a label that did not LOCATE on the page is a guess, and Chris's round produced exactly
    //     that ('Statement Re', missing the f) — learning it would poison every future document
    //     of the type.
    // DEFAULT OFF — this changes what Stage 1 reads. Arm: setting `teach_label_becomes_keyword`.
    try {
      if (learning.getSetting(db, 'teach_label_becomes_keyword', 'false') === 'true') {
        const label = String(data.anchor_label || '').trim();
        const slug  = String(data.document_type || '').trim();
        // REQUIRE a positive located signal, not merely the absence of a negative one. The
        // issuer's position-only teach sets label_detected=false explicitly, but a caller that
        // simply omits the field would otherwise sail through `!== false` and learn a caption
        // nobody confirmed was on the page. Owner-requested tightening 2026-08-11.
        const located = data.label_detected === true;
        const tplId = Number.isInteger(data.template_id) && data.template_id > 0 ? data.template_id : 0;
        if (label && slug && located && data.field_key && tplId > 0) {
          require('../../../database/modules/label_overrides')
            .addLabelOverride(db, { doc_type_slug: slug, field_key: data.field_key,
                                    label, exclusive: 1, template_id: tplId });
        }
      }
    } catch (e) {
      // A learning nicety must never fail the teach that has already been persisted above.
      logger?.warn?.(`teach label -> keyword: ${e.message}`);
    }
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
    // LIST ownership (Oracle cond 5, 2026-08-27): a field rule on a LIST key is a poison — `remove_text`
    // on one serial truncates every future list at it, `keep_block` collapses the list to one token.
    // Refused HERE by the field's TYPE (the same classifier the renderer menu and the engine skip use),
    // so a renderer that forgets the menu guard can't mint one. Fail-open on a lookup error (a rule on
    // a scalar key must keep working).
    try {
      const d = data || {};
      if (d.document_type && d.field_key) {
        const dt = require('../../../database/modules/document_types').getWithFields(getDb(), String(d.document_type));
        const f = dt && (dt.fields || []).find(x => x.key === d.field_key);
        if (f && String(f.type || '').toLowerCase() === 'list') {
          logger?.warn?.(`save-field-rule: refused on LIST field ${d.field_key} (${d.document_type}) — the caption scan owns it`);
          return { refused: 'list-field' };
        }
      }
    } catch (e) { logger?.warn?.(`save-field-rule: type check failed (rule saved as before): ${e && e.message}`); }
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
/** Q1 seam (2026-08-22): how many CONFIRMED documents name `folder` as their folder_path (i.e. it
 *  holds their kept originals). Path-normalised compare over the distinct folder_paths. */
function _filedDocsInFolder(db, folder) {
  let key = '';
  try { key = path.resolve(String(folder || '')).toLowerCase(); } catch { return 0; }
  if (!key) return 0;
  let n = 0;
  try {
    for (const r of db.prepare("SELECT folder_path, COUNT(*) n FROM documents WHERE status = 'confirmed' AND folder_path IS NOT NULL GROUP BY folder_path").all()) {
      let k = '';
      try { k = path.resolve(String(r.folder_path)).toLowerCase(); } catch { continue; }
      if (k === key) n += r.n;
    }
  } catch { return 0; }
  return n;
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
      db.prepare("UPDATE documents SET folder_path = ?, drained_at = datetime('now') WHERE id = ?").run(moved.folder, item.docId);
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
        db.prepare("UPDATE documents SET folder_path = ?, drained_at = datetime('now') WHERE id = ?").run(moved.folder, item.docId);
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
//   • dead working copies      (the doc is already CONFIRMED — its copy was
//                               unlinked + working_path nulled at confirm time,
//                               so any file left is crash debris)
// Keeps copies for live docs (needs_review/deferred/error/pending) AND for
// SOFT-DELETED docs. A deleted doc is RECOVERABLE — softDelete keeps the file and
// its working_path pointer intact (its own promise: "the file(s) are KEPT"), so
// culling it here left a restored row pointing at a file that startup had already
// deleted (Chris round 5, card 1 — a restored document with no page, and
// Confirm & File still offered). A deleted doc's copy is only removed once the bin
// is EMPTIED (_purgeOne deletes the row too → next reconcile sees a true orphan).
// A crash can only ever leave EXTRA files (cleaned here) — never lose a document,
// because an original is only removed after a verified copy. Pure: fs/path/db
// injected for hermetic testing. Returns a summary of what it did.
function reconcileHolding(fs, path, db, inboxDir) {
  const summary = { scanned: 0, partsRemoved: 0, orphansRemoved: 0, deadRemoved: 0, kept: 0 };
  if (!fs.existsSync(inboxDir)) return summary;
  let entries;
  try { entries = fs.readdirSync(inboxDir); } catch { return summary; }

  const statusById = new Map(
    db.prepare('SELECT id, status FROM documents').all().map(r => [r.id, r.status])
  );
  // 'deleted' is DELIBERATELY NOT here: a soft-deleted doc is recoverable and its
  // copy must survive a restart so Restore can bring back a readable page (card 1).
  const DEAD = new Set(['confirmed']);

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
      // NOTE (verified 2026-08-10): this is a DEAD WRITE. `file_done` PROJECTS a fixed field
      // set in process_docs.py (value/confidence/method + four conditional keys) and `anchor`
      // is not among them, so `data.anchor` is always undefined — `extractions.anchor_label`
      // is NULL on all 3262 rows of the live install and Review's "From anchor:" line has
      // never rendered from it. Left AS IS deliberately: feeding it would switch on a
      // customer-facing provenance line for the first time, which is an owner decision, not
      // a side effect of a dev tool. Filed in pendingfeatures.md.
      anchor_label:      data.anchor || null,
      candidates:        data.candidates ? JSON.stringify(data.candidates) : null,   // disambiguation picker
      corroboration:     data.corroboration ? JSON.stringify(data.corroboration) : null, // independent method-family agreement (owner principle 2026-08-11)
      suggested_supplier: data.suggested_supplier || null,   // branding cross-check → "Use '<name>'" button
    }));
    learning.insertExtractions(db, docId, rows);
  }
  // BARCODE INVENTORY (2026-08-26, DARK `barcode_inventory`): persist the page decodes the emit
  // carried (tri-state: key absent ⇒ nothing written). Best-effort — a barcode row must never fail
  // an import.
  if (docId && Object.prototype.hasOwnProperty.call(msg || {}, 'barcodes')) {
    try { require('../../../database/modules/barcodes').replaceDocumentBarcodes(db, docId, msg.barcodes); }
    catch (e) { try { logger?.warn?.(`[barcodes] persist failed for doc ${docId}: ${e.message}`); } catch {} }
  }

  // ONE CLASSIFIER FOR THE IMPORT TABLE (Chris round 6 card 3, 2026-08-27). The results row used
  // to key its chip on the ENGINE's `needs_review` alone (validator.needs_review = a required field
  // empty OR any field under its per-field threshold) — a NARROWER question than the filing
  // predicate Review and File All ask (`trust.isAutoFileEligible`: a validation note, a pending
  // corrected_to, the floor, put-back…). So 13 Pelican rows whose reference read as the word
  // "Date" @70 with a "please verify" note said "Ready to file" while Review held every one of
  // them ('flagged'). Ask the predicate over the rows just persisted and carry its verdict as a
  // SEPARATE field: `needs_review` is left untouched (the T1 gate-unify seam above reads it), so
  // this can only ever move a chip toward "Confirm to file", never toward "Ready". Best-effort —
  // the row must never fail an import.
  msg.review_hold = null;
  try {
    const trust = require('../../../database/modules/trust');
    const row = documents.getById(db, docId);
    const v = row ? trust.isAutoFileEligible(db, row) : null;
    if (v && !v.eligible) msg.review_hold = v.reason || 'held';
  } catch {}

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

// Auto-file dispatches run through ONE sequential promise chain (Oracle C6, gate-unify slice):
// commitDocument does SYNCHRONOUS file I/O (multi-MB copyFileSync), and the gate-unify flip can
// raise auto-file volume from ~zero to 50-90 per import — unbounded parallel setImmediate
// dispatches would run those copies back-to-back in one tick and stall the main thread. The
// chain serialises them with event-loop yields between docs; the per-doc catch keeps one failed
// commit from aborting the rest (each doc still rolls itself back inside _autoFileDoc).
let _autoFileChain = Promise.resolve();

// The quiet lane's hold family (S3-C5 + every "— confirm once." note). Shared by mergeReprocessRows.
function _isLaneHoldNote(note) {
  const n = String(note || '');
  return n.includes('Read differently after learning') || n.includes('— confirm once.');
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
    // GATE UNIFY T1 (flag OFF = today): the legacy bail refuses EVERY doc whose Python file_done
    // said needs_review — a BROADER signal than the predicate (it fires on an empty/below-
    // threshold non-required field, which the predicate deliberately leaves to Review). Since
    // preFloor is always min(userThr, 95) it parks docs at ANY confidence, including 100, and
    // the authoritative isAutoFileEligible in _autoFileDoc never gets asked (the live 08-12
    // measure: 49 eligible docs parked for an empty optional vat_no/po_ref/account_no @0).
    // Flag ON: defer to the predicate — every note-backed hold is already persisted to
    // extractions BEFORE this runs (insertExtractions is synchronous in the file_done handler,
    // ordering pinned in test_import_autofile_gate.js), and the predicate's T2 missing-required
    // refusal (trust.js) owns the one safety this bail uniquely provided. ONE shared flag read
    // (trust._gateUnifyEnabled) so T1 and T2 cannot drift.
    if (!trust._gateUnifyEnabled(db)) {
      // Any sub-100 auto-file (graduation or a lowered slider) must be a CLEAN doc — never one
      // that processing flagged for review.
      if (preFloor < 100 && msg.needs_review) return;
    }
    _autoFileChain = _autoFileChain.then(() =>
      _autoFileDoc(db, msg.db_id, folderPath, notifyMainWindow, logger)
        .catch(e => { try { logger?.warn?.(`auto-file ${msg.db_id}: ${e.message}`); } catch {} })
    );
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
  const _elig = trust.isAutoFileEligible(db, doc);
  if (!_elig.eligible) return;
  const dtRow  = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
  const dtInfo = dtRow && dtRow.slug ? doctypes.getWithFields(db, dtRow.slug) : null;
  if (!dtInfo) return;
  const outputRoot = learning.getSetting(db, 'output_folder', null);
  if (!outputRoot) return;   // can't file without a destination
  const allValues = {};
  for (const e of db.prepare('SELECT field_key, display_value, raw_value FROM extractions WHERE document_id = ?').all(docId)) {
    allValues[e.field_key] = e.display_value ?? e.raw_value;
  }
  // SILENT-MISFILE GUARD (Chris 2026-08-25 Card 1; gary + Oracle). isAutoFileEligible does NOT parse
  // the date, and at overall_confidence === 100 with strict_100_autofile off docTrustGate is skipped
  // entirely — so a present-but-unparseable DATE-ROLE value (e.g. a clipped taught date, conf 100, no
  // note) would auto-file to Company/Unknown Year/Unknown Month with no signal. Gate on the EXACT
  // parser the folder builder uses (filing.normaliseDate), BEFORE the claim: hold the doc in Review
  // with a note (which also FLAGS it, so it can't auto-file on a later pass either) rather than filing
  // it to Unknown. Not switch-gated — a value the folder builder cannot render is never auto-fileable.
  if (dtInfo.date_field_key) {
    const _dv = allValues[dtInfo.date_field_key];
    if (_dv != null && String(_dv).trim() !== '' && filing.normaliseDate(_dv) === null) {
      try {
        db.prepare('UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?')
          .run('This date can’t be read as a real calendar date, so the document can’t be filed automatically — please correct it in Review.',
               docId, dtInfo.date_field_key);
      } catch (e) { logger?.warn?.(`[auto-file] date-hold note failed for docId=${docId}: ${e && e.message}`); }
      return;   // stays needs_review (unclaimed) — surfaces in Review, never files to Unknown
    }
  }
  // Claim the doc BEFORE filing (atomic compare-and-set) so the 100% auto-file can't
  // double-file a doc a human confirmed in the gap since the status check above, and so it's
  // honestly attributed. If the claim doesn't land, someone else already took it — don't file.
  // Oracle C2 (corroborated auto-file): a corroborated machine file stamps
  // confirmed_via='auto_corroborated' so scopeTrust's HUMAN graduation window excludes it —
  // the route must never manufacture the trust it substitutes for (the scope_sweep precedent).
  // C5: the claim username says what actually happened instead of the false '(100%)'.
  // GATE UNIFY T3 (Oracle 2026-08-12: stamp BOTH machine bases): a graduated OR threshold
  // machine file must never count as a HUMAN confirm in the graduation window — via-NULL machine
  // rows filling W-slots is the sweep-incident mechanism (101-doc remediation, 08-12). The
  // trust.js:538 window exclusion for these values ships unconditionally; the stamp itself rides
  // the flag so OFF stays byte-identical. Usernames stay honest per Oracle C5 (graduated files
  // at the 95 discount, so '(100%)' would be a false claim on them).
  const _unify = trust._gateUnifyEnabled(db);
  const _viaStamp  = _elig.basis === 'corroborated' ? 'auto_corroborated'
    : (_unify ? (_elig.basis === 'graduated' ? 'auto_graduated' : 'auto_threshold') : null);
  const _userStamp = _elig.basis === 'corroborated' ? 'Auto-filed (corroborated)'
    : (_unify && _elig.basis === 'graduated' ? 'Auto-filed (graduated)' : 'Auto-filed (100%)');
  const claim = documents.confirmIfReviewable(db, docId, {
    confirmed_by_username: _userStamp, confirmed_via: _viaStamp });
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
  // B1: the import door fires per document 3–10 s apart; the ledger MERGES the batch into one event
  // keyed by kind with a per-sender breakdown (Oracle C1). 100 %-matched → not undoable (today's rule).
  recordReviewEvent(db, { kind: 'auto_filed', ids: [docId], approved: false,
                          scope: { supplier: allValues.supplier_name || doc.supplier_name || null, typeSlug: dtInfo.slug || null }, undo: null });
  logger?.log(`Auto-filed (100%): ${doc.original_filename} → ${fr.filename}`);
  try {
    notifyMainWindow?.('doc-auto-filed', { docId, count: getAutoFiledIds(db).length });
    notifyMainWindow?.('review-count-changed', documents.getReviewCount(db));
  } catch {}
  // Slice 1 (learn-on-commit): auto-file is the THIRD commit route — keep the matched template's
  // identity converging on it too, or a supplier whose docs all auto-file would never converge past
  // its first frozen sample. Self-gated on the kill switch (DEFAULT OFF ⇒ byte-identical) + a
  // resolvable same-type/same-supplier template. fail-open — the doc is already filed above.
  try {
    const tid = require('../../../database/modules/templates').learnTemplateOnCommit(db, docId, { document_type_slug: dtInfo.slug, supplier_name: allValues.supplier_name || doc.supplier_name || null });
    // Chris round 15 card 2: mirror the DB intersection into the template FILE the matcher reads.
    if (tid && process.env.TEMPLATE_FILE_SYNC_ON_COMMIT !== '0' && _templatesDirFn) {
      try { require('../review/handler')._writeTemplateFileForSync(db, tid, _templatesDirFn()); } catch (e) { logger?.warn?.(`[auto-file] template file sync: ${e && e.message}`); }
    }
  }
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
// `approved` marks a doc the OPERATOR consented to (the reprocess consent bar's File N) — it rides
// the same rolling list so the re-surface checkpoint still covers it, but the Review banner counts
// it separately: "filed with your approval" is the operator's decision on the record, not the
// machine's (Chris round-7 card 2 — the counter called his 8 approved filings "automatic").
function _recordAutoFiled(db, docId, approved = false) {
  const learning = require('../../../database/modules/learning');
  try {
    const ids = getAutoFiledIds(db);
    if (!ids.includes(docId)) ids.push(docId);
    let appr = [];
    try {
      const o = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '') || 'null');
      if (o && Array.isArray(o.approved)) appr = o.approved;
    } catch {}
    if (approved && !appr.includes(docId)) appr.push(docId);
    appr = appr.filter(id => ids.includes(id));
    learning.setSetting(db, 'recent_auto_filed',
      JSON.stringify({ ids: ids.slice(-300), approved: appr.slice(-300), at: Date.now() }));
  } catch {}
}

// Quit-time teardown: tree-kill every running manual-batch worker (the same
// taskkill /T as the stop-processing IPC) so the app exits clean with no orphaned
// python.exe. Called from main.js before-quit.
function killAll() {
  try { _quietLaneImpl && _quietLaneImpl.shutdown(); } catch {}   // Slice 3: no orphaned quiet worker at quit
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
  recordReviewEvent,   // B1: the activity ledger's one writer (reviewService's class-fix door reaches it through review/handler)
  getReviewEvent,      // batch-audit grid: resolve an event's authoritative id set from review/handler
  // Exposed so other entry points into the same pipeline (e.g. the
  // watch-folder handler) can reuse this setup/dispatch machinery instead
  // of duplicating it on a parallel import path.
  buildTrainingArgs,
  killAll,
  cleanupTempFiles: cleanupFiles,
  handleFileMessage: _handleFileMessage,
  flushPendingDrains: _flushPendingDrains,
  // Slice 1 (2026-08-21): the human-confirm trigger for the scope-local auto-accept. A no-op until
  // register() has bound it (and while `scope_sweep_auto_accept` is dark).
  scheduleScopeAutoAccept: (db, info) => (_scheduleScopeAutoAcceptImpl ? _scheduleScopeAutoAcceptImpl(db, info) : false),
  _quietLaneActiveScopes,    // Slice 3 marks a scope here while its quiet re-read is in flight (S1-C5)
  scheduleQuietReread,   // Slice 3 trigger (a taught confirm / a layout write)
  _layoutRereadEnabled, _readyTemplatedEnabled, _firstFillReliabilityEnabled, FIRST_FILL_UNRELIABLE_K, _reprocessHoldsEnabled, nameArmTokens, NAME_ARM_GENERIC,
  readyProbe: (db, sup, slug) => (_readyProbeImpl ? _readyProbeImpl(db, sup, slug) : null),              // P2: scope readiness BEFORE a confirm (memoised)
  scheduleReadyReread: (db, info) => (_scheduleReadyRereadImpl ? _scheduleReadyRereadImpl(db, info) : false),   // P2: fire the lane on the ready crossing
  scheduleTypeSplitReread: (db, info) => (_scheduleTypeSplitRereadImpl ? _scheduleTypeSplitRereadImpl(db, info) : false),   // A6: the confirm-once ripple
  quietLane: () => _quietLaneImpl,
  _applyReprocessResultForTest: (...a) => (_applyReprocessResultImpl ? _applyReprocessResultImpl(...a) : null),
  _setReprocessStatusForTest: (st) => (_setReprocessStatusForTestImpl ? _setReprocessStatusForTestImpl(st) : null),
  _reprocessOfferForTest: () => _reprocessOfferProbe(),
  _debugAutoAcceptPre: (d) => (_debugAutoAcceptPreImpl ? _debugAutoAcceptPreImpl(d) : null),
  _withinAnyRoot,            // SEC-17 reparse-point containment pins (test_path_containment.js)
  _realCanonical,            // ditto — exported so the pin asserts the shipped predicate, not a copy
  _genericFallbackId,        // Generic Document fallback pins (test_generic_fallback_mapping.js)
  _resolveDetectedType,      // mig-51 detected-type-nudge pins (test_detected_type_nudge.js)
  _reprocessGenericAdopt,
  _autoTitleEnv,             // Auto-Title spawn env (shared with the watch batch)
  _anchorCropEnv,            // crop opt-in spawn env: right-grow + label left-clamp (shared with the watch batch)
  _reconcileEnv,             // extraction-reconcile opt-in spawn env: prefix-garble adopt (shared with the watch batch)
  drainOriginalToFolder,
  _filedDocsInFolder,
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
  // Exposed for the SFDEV debug-table builder pin (test_debug_table.js).
  _buildDebugTable, _saveDebugTable, _debugTableDir,
};
