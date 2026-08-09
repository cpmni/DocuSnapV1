'use strict';
/*
 * freeze_guard.js — should this value be allowed to become a template's PERMANENT value?
 *
 * THE DEFECT THIS EXISTS FOR (measured 2026-08-09 NIGHT). `_buildTemplateFields`
 * (src/modules/review/handler.js) decides `is_variable` from four inputs, none of which look at the
 * VALUE's form: schema role, confirmed-history variability, name-like recipient, and the
 * issuer-only switch. So whatever the teach wizard's draw-box OCR read is written verbatim as
 * `fixed_value` and re-emitted forever at confidence 95 with method `template_fixed`.
 *
 * On the live install that produced: a template whose `vat_no` fixed_value is the literal string
 * 'VAT' — the printed CAPTION, not the number. It is stamped on 21 of 145 documents at 95, and
 * NOTHING downstream can catch it: `template_fixed` is on the exempt list of essentially every
 * credibility rail in engine.py, by design, because it is meant to be a human-set literal. The
 * freeze is the LAST point of control. Same generator produced a template NAMED
 * 'Pelican Office Interiors -' and another named 'Reg No GB 903'.
 *
 * The freeze happens at TEACH time, from ONE document — twice over, in fact (the wizard calls
 * promote-to-template and then confirm-with-taught_fields, and both rebuild the fields). The only
 * cross-document input, `_fieldsWithMultipleConfirmedValues`, is scoped by document TYPE, cannot
 * fire on a cold type, and is afterwards fed by the stamp's own re-confirmations — the code says so
 * itself: "the freeze manufactures its own proof".
 *
 * WHAT THIS DOES: a pure predicate. It never edits a value and never picks a different one. It
 * answers one question — may this value be FROZEN? — and a decline simply leaves the field
 * variable, i.e. re-extracted per document, exactly as an unfrozen field always was.
 *
 * THREE ARMS, each independently defensible:
 *   A CAPTION   — the value is a printed field LABEL. Vocabulary is the shipped label banks in
 *                 config/keyword_patterns.json plus the type's own field display labels. 'VAT' is
 *                 literally in `field_patterns.vat_tax.labels`, so the system already knows it is a
 *                 caption; it simply never asked at freeze time.
 *   B FORMAT    — the value fails its own field TYPE's shipped pattern (trust.matchesTypePattern,
 *                 the same validation_patterns Python and the Review on-blur check use). Inert for
 *                 a type with no shipped pattern, so it can never over-refuse.
 *   C CODE-ROLE — the field key's role is a CODE (_no / _number / _num / _ref / reference) and the
 *                 value carries no digit at all. JS twin of keyword.ref_value_is_codeless; measured
 *                 on the reference install, 0 of 713 confirmed ref-role values carry no digit.
 *
 * TWO HARD EXCLUSIONS, both load-bearing — do not "simplify" them away:
 *   • The ISSUER (companyKeys, i.e. supplier_name) is NEVER governed, in either direction. A
 *     company name is legitimately all-alpha, and five shipped guards
 *     (TEMPLATE_FIXED_ISSUER_REPAIR, TEMPLATE_FIXED_NEAR_MATCH_RECONCILE,
 *     TEMPLATE_FIXED_SEED_AGREEMENT_KEEP, BRANDING_NAMED_BLANK,
 *     TEMPLATE_FIXED_NAME_PRESENCE_VETO) all require the seed to EXIST with method
 *     `template_fixed`. Governing the issuer here would silently disarm all five at once.
 *   • `fixed_locked` rows are never touched — an admin who deliberately sets a literal through
 *     Template Manager, caption or not, keeps it.
 *
 * THE MEASUREMENT THAT BOUNDS THIS (2026-08-08): unfreezing everything except the issuer moved
 * `vat_no` from 51% to 16% — a VAT number IS a genuine per-supplier constant and the stamp was
 * carrying it. So a wide predicate is not cautious, it is destructive. Every arm here judges the
 * FROZEN VALUE's form, never the per-document reads.
 */

const path = require('path');
const { normaliseForTokens, tokenise } = require('./text_normalise');

// ── caption vocabulary ────────────────────────────────────────────────────────────────────────
// The shipped label banks, read the same way trust.js reads this file. Cached: the freeze runs
// inside a confirm, and re-reading + re-parsing the config per field would be silly.
let _shippedCaptions = null;
function _shippedCaptionSet() {
  if (_shippedCaptions) return _shippedCaptions;
  const set = new Set();
  try {
    const cfg = require(path.join(__dirname, '..', '..', 'config', 'keyword_patterns.json'));
    for (const entry of Object.values(cfg.field_patterns || {})) {
      for (const label of (entry && entry.labels) || []) set.add(_captionKey(label));
    }
  } catch { /* no config → arm A simply has no vocabulary; the other arms still run */ }
  set.delete('');
  _shippedCaptions = set;
  return set;
}

/** The validation key the READER gates this field with, from the shipped config (or null). */
let _shippedValidation = null;
function _shippedValidationFor(key) {
  if (!_shippedValidation) {
    _shippedValidation = new Map();
    try {
      const cfg = require(path.join(__dirname, '..', '..', 'config', 'keyword_patterns.json'));
      for (const [k, entry] of Object.entries(cfg.field_patterns || {})) {
        if (entry && entry.validation) _shippedValidation.set(k, String(entry.validation));
      }
    } catch { /* no config → arm B falls back to the DB type */ }
  }
  return _shippedValidation.get(key) || null;
}

/** The comparison form of a caption: alphanumeric-only, lowercased ("V.A.T No." → "vatno"). */
function _captionKey(s) {
  return tokenise(normaliseForTokens(String(s == null ? '' : s)))
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

const _CODE_ROLE_KEY = /(_no|_number|_num|_ref)$/;
const _HAS_DIGIT = /\d/;

/**
 * Why this value must NOT be frozen — or null when freezing is fine.
 *
 * @param {string} fieldKey  the field's key ('vat_no')
 * @param {string} value     the value the teach produced
 * @param {object} meta      {type, label} from the field row; either may be null/absent
 * @param {object} [ctx]     {companyKeys: string[], extraCaptions: string[]}
 * @returns {null|'caption'|'format'|'codeless_code_role'}
 *
 * FAILS SAFE IN BOTH DIRECTIONS: an unknown type, a missing label or a missing config yields null
 * (freeze allowed, today's behaviour), and an empty value yields null because the caller already
 * treats empty as nothing to freeze.
 */
function freezeDeclineReason(fieldKey, value, meta, ctx) {
  const key = String(fieldKey || '').trim().toLowerCase();
  const val = String(value == null ? '' : value).trim();
  if (!key || !val) return null;

  const companyKeys = (ctx && ctx.companyKeys) || ['supplier_name'];
  if (companyKeys.includes(key)) return null;          // the issuer is never governed — see above

  // ── A. the value IS a printed caption ────────────────────────────────────────────────────────
  const vk = _captionKey(val);
  if (vk) {
    const vocab = _shippedCaptionSet();
    if (vocab.has(vk)) return 'caption';
    for (const extra of (ctx && ctx.extraCaptions) || []) {
      if (_captionKey(extra) === vk) return 'caption';
    }
  }

  // ── B. the value fails the format this FIELD is actually read with ───────────────────────────
  // Two sources, in this order, because the DB type is the weaker of the two: `vat_no` is typed
  // plain 'text' on every shipped and preset document type, so a DB-type-only check is inert for
  // the very field that produced this defect. The shipped `field_patterns[key].validation` is what
  // the reader itself gates on, so it is the honest question to ask here.
  // Inert when neither source names a pattern — a custom type can never be refused on format.
  const validation = _shippedValidationFor(key) || (meta && meta.type ? String(meta.type) : null);
  if (validation) {
    try {
      if (!require('./trust').matchesTypePattern(validation, val)) return 'format';
    } catch { /* trust unavailable (fixture DB / harness) → skip arm B */ }
  }

  // ── C. a CODE-role field whose value carries no digit ────────────────────────────────────────
  // 'reference' anywhere in the key, or one of the code suffixes. A code always carries a digit;
  // a value with none is a caption or prose that happened to be under the drawn box.
  if ((_CODE_ROLE_KEY.test(key) || key === 'reference' || key.includes('reference'))
      && !_HAS_DIGIT.test(val)) {
    return 'codeless_code_role';
  }

  return null;
}

module.exports = { freezeDeclineReason, _captionKey };
