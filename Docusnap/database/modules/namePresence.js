'use strict';
// PER-SUPPLIER NAME-PRESENCE VETO (2026-07-24; owner idea -> gary design -> Oracle SIGN-OFF-WITH-
// CONDITIONS). The JS template-recheck path (templates.identifyByFingerprint) accepts a logo/keyword
// template on HASH evidence with NO page-text corroboration of the matched supplier's identity — the
// un-mirrored twin of the Python TEMPLATE_LOGO_TEXT_GATE. The 64-bit phash's cross-supplier histograms
// have CROSSED on real scans (Larkspur<->Saltmarsh collide), so no distance threshold fixes it. This
// VETOES a template SUGGESTION whose supplier reliably PRINTS its own name (a learned ratio over that
// supplier's confirmed docs) but whose name is ABSENT from the candidate page. Fail-toward-abstain: a
// genuinely name-LESS supplier (ratio < HIGH_RATIO) is NEVER blocked. Removes a wrong suggestion from
// three surfaces (the "Template available" pill, the teach-wizard save-target, and graduation linking).
// Kill switch TEMPLATE_NAME_PRESENCE_VETO (default ON); OFF => byte-identical. Guarded by
// test_name_presence.js. See engine._template_identity_corroborated (the port source) + templates.js
// identifyByFingerprint (the wire site).

// Learning Repair start-fresh predicate (mig 90): a stamped document no longer votes in the ratio
// ('' until stamped; test_learning_excluded_readers.js). machine_vias has no requires — cycle-safe.
const { learningExcludedSql } = require('./machine_vias');

// ── Oracle C2: EXACT port of engine._template_identity_corroborated (python_backend/extraction/
// engine.py:745-766). The Python uses PLAIN value.lower() + re.findall(r"[a-z0-9]+", ...) — NOT
// text_normalise — so parity means the raw regex here too. This generic set is the Python set at
// engine.py:759-760 VERBATIM. Do NOT reuse templates.js's GENERIC_NAME_TOKENS/_nameTokens: that set
// diverges (adds llc/gmbh/of/uk, len>=2) and would silently drift the two predicates apart.
const GENERIC_NAME_TOKENS = new Set([
  'ltd', 'limited', 'plc', 'llp', 'inc', 'incorporated', 'co', 'company', 'corp',
  'group', 'holdings', 'services', 'service', 'the', 'and',
]);

function nameTokens(name) {
  return (String(name || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(t => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t));
}

// True <=> >=60% of `name`'s distinctive tokens appear as WHOLE WORDS in `ocrText`. Parity-pinned to
// the Python (present >= 1 AND present/len >= 0.6). One function, used for BOTH "reliably prints" (the
// ratio) and "absent here" (the candidate) so the two are measured identically.
function nameCorroborated(name, ocrText) {
  if (!name || !ocrText) return false;
  const toks = nameTokens(name);
  if (!toks.length) return false;                       // generic-only / empty -> can't corroborate
  const text = String(ocrText).toLowerCase();
  let present = 0;
  for (const t of toks) if (new RegExp('\\b' + t + '\\b').test(text)) present++;  // toks are [a-z0-9]+, regex-safe
  return present >= 1 && (present / toks.length) >= 0.6;
}

// Env-overridable thresholds (Oracle's defaults).
function _num(envKey, dflt) { const v = parseFloat(process.env[envKey]); return Number.isFinite(v) ? v : dflt; }
const MIN_SAMPLE     = () => _num('TEMPLATE_NAME_PRESENCE_MIN_SAMPLE', 3);
const HIGH_RATIO     = () => _num('TEMPLATE_NAME_PRESENCE_RATIO', 0.80);
const MIN_PAGE_TOKENS = () => _num('TEMPLATE_NAME_PRESENCE_MIN_TOKENS', 50);

// Fraction of `supplier`'s CONFIRMED docs whose ocr_text corroborates its name (Oracle C5: denominator
// is confirmed docs with NON-EMPTY ocr_text, so legacy null-text rows don't dilute a name-bearing
// supplier below the floor). {ratio, count}; count is the (non-empty-text) sample size.
function supplierNamePresenceRatio(db, supplier) {
  if (!supplier) return { ratio: 0, count: 0 };
  try {
    const rows = db.prepare(
      "SELECT ocr_text FROM documents WHERE status = 'confirmed'" + learningExcludedSql(db, '') + " AND supplier_name = @sup " +
      "AND ocr_text IS NOT NULL AND LENGTH(TRIM(ocr_text)) > 0").all({ sup: supplier });
    const count = rows.length;
    if (!count) return { ratio: 0, count: 0 };
    let present = 0;
    for (const r of rows) if (nameCorroborated(supplier, r.ocr_text)) present++;
    return { ratio: present / count, count };
  } catch { return { ratio: 0, count: 0 }; }
}

// The veto predicate. TRUE => refuse this template suggestion (its supplier reliably prints its name,
// but the name is absent from this candidate page). FALSE (abstain) in every doubtful case — Oracle's
// fail-toward-abstain ordering:
//   kill switch off -> false (byte-identical)
//   Oracle C1: identity via establishedIdentity (dominant confirmed issuer / frozen supplier_name),
//              NEVER the cosmetic template name; unjudgeable -> false
//   candidate text too thin (<MIN_PAGE_TOKENS) -> false (never block a failed/short scan)
//   sample < MIN_SAMPLE -> false (young supplier)
//   ratio < HIGH_RATIO -> false (genuinely name-LESS supplier is never blocked)
//   name IS corroborated on the candidate -> false (valid match)
//   else -> TRUE (name-bearing supplier, name absent).
// Lazy require of ./templates breaks the templates<->namePresence cycle (both loaded by call time).
function nameBearingButAbsent(db, templateId, candidateOcr) {
  try {
    if (process.env.TEMPLATE_NAME_PRESENCE_VETO === '0') return false;
    const { establishedIdentity } = require('./templates');
    const supplier = establishedIdentity(db, templateId);
    if (!supplier) return false;
    const candTokens = (String(candidateOcr || '').toLowerCase().match(/[a-z0-9]+/g) || []).length;
    if (candTokens < MIN_PAGE_TOKENS()) return false;
    const { ratio, count } = supplierNamePresenceRatio(db, supplier);
    if (count < MIN_SAMPLE()) return false;
    if (ratio < HIGH_RATIO()) return false;
    if (nameCorroborated(supplier, candidateOcr)) return false;
    return true;
  } catch { return false; }   // fail-open: any error -> abstain (byte-identical to today)
}

module.exports = {
  nameCorroborated, nameTokens, supplierNamePresenceRatio, nameBearingButAbsent, GENERIC_NAME_TOKENS,
};
