'use strict';

/**
 * database/modules/trust.js
 * -------------------------
 * SUPPLIER GRADUATION — the safety core for "eventual auto-file" (advisory design by
 * bob + gary). A (supplier, doc-type) scope EARNS the right to auto-file clean docs at
 * the learned-read ceiling of 98 (instead of the flat 100), once the system has enough
 * clean history to trust it — WITHOUT ever auto-filing a value that could be silently
 * wrong. Nothing here files anything; it only DECIDES. Wiring lives at the two auto-file
 * sites (backend _autoFileDoc + renderer autoCommitFullConfidence).
 *
 * Two independent gates, both required for a trusted sub-100 auto-file:
 *   1. scopeTrust(db, supplier, slug)  — is this SCOPE graduated? (volume + cleanliness +
 *      every required field verifiable). Live-computed, never stored, so a new correction
 *      self-revokes it.
 *   2. docTrustGate(db, docId, …)      — is THIS doc structurally safe? (matched a template +
 *      every valued field is strictly-typed-and-clean, or matches a non-freetext learned
 *      shape, or empty). This is what structurally blocks the item="Information" class:
 *      an untyped, valued field with a FREE-TEXT learned shape can never be verified, so it
 *      routes the doc to Review regardless of confidence, flags, or poisoned history.
 *
 * The "supported shape" idea generalises learning.getDigitsOnlyFields / _isDigitsOnlyFormat:
 * a field is verifiable only when its confirmed values form a consistent NON-freetext class
 * (constant / digits / date / currency / code). A messy or poisoned free-text field is not.
 *
 * Guarded by database/modules/test_scope_trust.js.
 */

// ── Tunable parameters (gary's recommended defaults) ──────────────────────────
// A scope graduates at W clean confirmations; a conservative install can raise W.
const TRUST_WINDOW           = 10;   // confirmed docs in scope, and the correction window
const TRUST_MAX_CORRECTIONS  = 0;    // corrections tolerated within the last-W window
const TRUSTED_FLOOR          = 98;   // auto-file floor once graduated (the learned-read ceiling)
const UNTRUSTED_FLOOR        = 100;  // ungraduated scopes keep today's full-confidence-only bar

// Types whose validation pattern genuinely CONSTRAINS the value, so a clean read (no
// validation_note) is trustworthy on the type alone. Deliberately EXCLUDES 'alphanumeric'
// (too loose — matches a dictionary word like "Information") and free text, which must fall
// through to the learned-shape check.
// TRIMMED per reggie's validation review (2026-07-06): removed 'integer'/'decimal' (not
// selectable types, NO backing validation pattern → they'd be trusted on nothing if a field
// of that type were ever created off the UI path), and 'iban'/'vat_gb' (validated on SHAPE
// with no checksum → a transposed-digit IBAN or a bare 9-digit "VAT" number would auto-file;
// now CHECKSUM-validated in docTrustGate (mod-97 / HMRC), not shape alone). 'date' additionally carries a
// CALENDAR re-check in docTrustGate because the shared date pattern itself is unbounded.
const STRICT_TYPES = new Set([
  'date', 'currency', 'number', 'reference_code', 'email', 'postcode_uk', 'percentage',
  'iban', 'vat_gb',
]);

// ── Pure shape helpers (unit-tested directly, no DB) ──────────────────────────
const _norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');

const _digits     = v => /^\d+$/.test(String(v).trim());
const _currencyish = v => /^[£$€]?\s?-?\d[\d,]*(?:\.\d+)?$/.test(String(v).trim());
const _codeish    = v => {
  const s = String(v).trim();
  return /^[A-Za-z0-9][A-Za-z0-9\-\/.]*$/.test(s) && /\d/.test(s);   // single token, has a digit
};
const _MONTHS = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const _dateish = v => {
  const s = String(v).trim();
  if (/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(s)) return true;   // 03-06-2026, 2026/06/03
  return _MONTHS.test(s) && /\d/.test(s);                           // 6 Aug 2026
};

// Calendar-bounded date validity (reggie T1). The shared date PATTERN is unbounded, so a
// STRICT date field could auto-file "45/67/8901", "13/13/2026" or "31/02/2026" with no flag.
// This bounds day/month; leap-lenient (Feb 29 allowed in any year) so it never false-rejects
// a genuinely valid date. It CANNOT catch a wrong-but-valid date (a mis-read month that is
// still a real date) — that residual needs cross-field/parse consistency, not a shape check.
const _MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const _MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function _validDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  const num = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (num) {
    const day = num[1].length === 4 ? +num[3] : +num[1];   // YYYY-MM-DD vs DD-MM-YYYY
    const mon = +num[2];
    return mon >= 1 && mon <= 12 && day >= 1 && day <= _MONTH_DAYS[mon - 1];
  }
  const mon = _MONTH_NUM[(s.match(/[A-Za-z]{3,}/) || [''])[0].slice(0, 3).toLowerCase()];
  const dayTok = s.match(/\b(\d{1,2})\b/);
  if (mon && dayTok) { const d = +dayTok[1]; return d >= 1 && d <= _MONTH_DAYS[mon - 1]; }
  return false;
}

// IBAN mod-97 checksum (reggie T2): rearrange (move the first 4 chars to the end), map letters
// to numbers (A=10 … Z=35), and the whole number mod 97 must equal 1. Computed incrementally so
// the big integer never overflows.
function _validIban(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const chunk = (ch >= '0' && ch <= '9') ? ch : String(ch.charCodeAt(0) - 55);   // 'A' → 10
    for (let i = 0; i < chunk.length; i++) rem = (rem * 10 + (chunk.charCodeAt(i) - 48)) % 97;
  }
  return rem === 1;
}

// GB VAT modulus-97 checksum (reggie T3): first 7 digits weighted 8,7,6,5,4,3,2, plus the 2 check
// digits, must be a multiple of 97 (classic method) or with +55 added (post-2010 "9755" method).
// Accepts a 9-digit number or a 12-digit branch-trader number (checksum uses the first 9).
function _validVatGb(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (!/^\d{9}(\d{3})?$/.test(s)) return false;
  const d = s.slice(0, 9).split('').map(Number);
  const w = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += d[i] * w[i];
  const check = d[7] * 10 + d[8];
  return (sum + check) % 97 === 0 || (sum + check + 55) % 97 === 0;
}

/**
 * Classify a scope's confirmed values for one field into a coarse learned shape.
 * 'constant' (≤2 distinct — a fixed value like a company name), 'digits', 'date',
 * 'currency', 'code', or 'freetext' (mixed/wordy — NOT safely verifiable). 'none' = no
 * samples. Every non-empty sample must share the class, so one odd value collapses the
 * field to 'freetext' (conservative — an inconsistent field is treated as unverifiable).
 */
function classifyLearnedShape(sampleValues) {
  const vals = (sampleValues || []).map(v => String(v == null ? '' : v).trim()).filter(Boolean);
  if (vals.length === 0) return 'none';
  const distinct = new Set(vals.map(_norm));
  if (distinct.size <= 2)          return 'constant';   // fixed / near-fixed value
  if (vals.every(_digits))         return 'digits';
  if (vals.every(_dateish))        return 'date';
  if (vals.every(_currencyish))    return 'currency';
  if (vals.every(_codeish))        return 'code';
  return 'freetext';                                     // mixed / wordy → cannot auto-verify
}

/** Does a value match a learned shape class? Empty is the caller's concern; 'freetext'/'none' never match. */
function valueMatchesShape(value, cls, sampleValues) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return true;
  switch (cls) {
    case 'constant': return (sampleValues || []).some(s => _norm(s) === _norm(v));
    case 'digits':   return _digits(v);
    case 'date':     return _dateish(v);
    case 'currency': return _currencyish(v);
    case 'code':     return _codeish(v);
    default:         return false;   // 'freetext' | 'none'
  }
}

/** A field is verifiable when its declared type strictly constrains it, OR it has a non-freetext learned shape. */
function fieldVerifiable(type, cls) {
  if (STRICT_TYPES.has(String(type || '').toLowerCase())) return true;
  return cls !== 'freetext' && cls !== 'none';
}

// ── DB-backed scope + doc gates ───────────────────────────────────────────────

/** Map field_key -> {cls, sampleValues} for a scope, preferring the supplier-scoped format over the doc-type-scoped one. */
function _scopeFormats(db, normSupplier, slug, cachedFormats) {
  const all = cachedFormats || require('./learning').getFieldFormats(db);   // single source; cache for batch
  const out = new Map();
  for (const g of all) {
    if (String(g.document_type || '').toLowerCase().trim() !== slug) continue;
    const gs = _norm(g.supplier_name);
    if (gs !== normSupplier && gs !== '') continue;          // supplier-scoped OR doc-type-scoped
    if (!out.has(g.field_key) || gs === normSupplier) {      // supplier-scoped wins
      out.set(g.field_key, { cls: classifyLearnedShape(g.sample_values), sampleValues: g.sample_values });
    }
  }
  return out;
}

/**
 * Is a (supplier, slug) scope graduated? Live-computed — never stored — so it self-revokes
 * the moment a correction lands. Returns {trusted, floor, reason, confirmedCount, ...}.
 */
function scopeTrust(db, supplier, slug, opts = {}) {
  const W    = opts.window ?? TRUST_WINDOW;
  const MAXC = opts.maxCorrections ?? TRUST_MAX_CORRECTIONS;
  const sup  = _norm(supplier);
  const sl   = String(slug || '').toLowerCase().trim();
  const no = (reason, extra = {}) => ({ trusted: false, floor: UNTRUSTED_FLOOR, reason, ...extra });

  if (!sup) return no('no-supplier');
  if (!sl)  return no('no-doctype');

  const dt = db.prepare('SELECT id FROM document_types WHERE LOWER(slug) = ?').get(sl);
  if (!dt) return no('unknown-doctype');
  const reqFields = db.prepare(
    'SELECT key, type FROM fields WHERE document_type_id = ? AND required = 1 AND COALESCE(enabled, 1) = 1'
  ).all(dt.id);

  const confirmed = db.prepare(`
    SELECT d.id FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'confirmed' AND LOWER(TRIM(d.supplier_name)) = ? AND LOWER(dt.slug) = ?
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all(sup, sl).map(r => r.id);
  const confirmedCount = confirmed.length;
  if (confirmedCount < W) return no('volume', { confirmedCount, needed: W - confirmedCount });

  const windowIds = confirmed.slice(0, W);
  const ph = windowIds.map(() => '?').join(',');
  const corrections = db.prepare(
    `SELECT COUNT(*) c FROM corrections WHERE document_id IN (${ph})
       AND COALESCE(original_value, '') <> COALESCE(corrected_value, '')`
  ).get(...windowIds).c;
  if (corrections > MAXC) return no('recent-correction', { confirmedCount, corrections });

  const fmts = _scopeFormats(db, sup, sl, opts.formats);
  for (const rf of reqFields) {
    const cls = (fmts.get(rf.key) || {}).cls || 'none';
    if (!fieldVerifiable(rf.type, cls)) {
      return no('unverifiable-required-field', { confirmedCount, field: rf.key, cls });
    }
  }
  return { trusted: true, floor: TRUSTED_FLOOR, reason: 'ok', confirmedCount };
}

/**
 * Is THIS document structurally safe to auto-file on a trusted scope? Requires a template
 * match and that every VALUED field be either strictly-typed-and-unflagged, or match a
 * non-freetext learned shape, or empty. This is the diligence-independent block for the
 * untyped-confidently-wrong class (item="Information"): freetext learned shape → no match →
 * doc routed to Review. requireTemplate:false is only for tests without a template store.
 */
function docTrustGate(db, docId, supplier, slug, opts = {}) {
  const doc = db.prepare('SELECT id, template_id, document_type_id FROM documents WHERE id = ?').get(docId);
  if (!doc) return { ok: false, reason: 'no-doc' };
  if (opts.requireTemplate !== false && !doc.template_id) return { ok: false, reason: 'no-template' };

  const sup  = _norm(supplier);
  const sl   = String(slug || '').toLowerCase().trim();
  const fmts = _scopeFormats(db, sup, sl, opts.formats);
  const fieldTypes = new Map(
    db.prepare('SELECT key, type FROM fields WHERE document_type_id = ?').all(doc.document_type_id)
      .map(r => [r.key, r.type])
  );
  const exs = db.prepare(
    'SELECT field_key, display_value, raw_value, validation_note FROM extractions WHERE document_id = ?'
  ).all(docId);

  for (const e of exs) {
    const v = String(e.display_value ?? e.raw_value ?? '').trim();
    if (!v) continue;                                                    // empty → safe
    if (e.validation_note && String(e.validation_note).trim())           // any flag → not safe
      return { ok: false, reason: `flagged:${e.field_key}` };
    const _t = String(fieldTypes.get(e.field_key) || '').toLowerCase();
    if (STRICT_TYPES.has(_t)) {
      // Defence-in-depth for strict types whose pattern doesn't fully validate the value: a date
      // must be a real CALENDAR date; an IBAN / GB VAT must pass its CHECKSUM. Others keep
      // note-absence trust — their patterns are adequate and re-checking risks false-blocking
      // legit values (e.g. "1250.00 GBP").
      if (_t === 'date'   && !_validDate(v))   return { ok: false, reason: `invalid-date:${e.field_key}` };
      if (_t === 'iban'   && !_validIban(v))   return { ok: false, reason: `invalid-iban:${e.field_key}` };
      if (_t === 'vat_gb' && !_validVatGb(v))  return { ok: false, reason: `invalid-vat:${e.field_key}` };
      continue;
    }
    const f = fmts.get(e.field_key);
    if (!f || !valueMatchesShape(v, f.cls, f.sampleValues))
      return { ok: false, reason: `unverifiable-value:${e.field_key}` };
  }
  return { ok: true };
}

// ── Graduation master switch + per-scope opt-out (the visible controls, Slice 5) ────────────
function _graduationEnabled(db) {
  return require('./learning').getSetting(db, 'supplier_graduation_enabled', 'true') !== 'false';
}
function _optedOutScopes(db) {
  try { const a = JSON.parse(require('./learning').getSetting(db, 'graduation_optout', '[]') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function _scopeKey(supplier, slug) { return `${_norm(supplier)}|${String(slug || '').toLowerCase().trim()}`; }

/**
 * THE SINGLE auto-file eligibility predicate — the one both auto-file sites consult (backend
 * `_autoFileDoc` now; the renderer queue annotation in Slice 4) so they can never drift (the
 * pre-existing divergence: backend counted only `validation_note`, renderer also blocked on
 * `corrected_to`; backend counted empty-string notes). Composes:
 *   • the EFFECTIVE FLOOR — graduation lowers a TRUSTED scope to 98; otherwise the user's
 *     `auto_file_threshold` (default 100). A trusted scope never files ABOVE the user's own bar.
 *   • the flagged-field refusal (a non-empty `validation_note` → never).
 *   • for ANY sub-100 auto-file (graduation OR a manually-lowered slider) → the structural
 *     safety gate (`docTrustGate`: template match + every valued field verifiable). At floor
 *     100 the structural gate is NOT required — preserves today's behaviour (Slice 7 optional).
 * `doc` is a documents row ({id, document_type_id, overall_confidence, supplier_name}).
 */
function isAutoFileEligible(db, doc, opts = {}) {
  if (!doc || !doc.id || !doc.document_type_id)
    return { eligible: false, floor: UNTRUSTED_FLOOR, reason: 'no-type' };
  const learning = require('./learning');
  const userThr = parseInt(learning.getSetting(db, 'auto_file_threshold', '100'), 10) || 100;
  const dtRow = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
  const slug = dtRow && dtRow.slug;
  const t = scopeTrust(db, doc.supplier_name, slug, opts);
  // Graduation is gated by the master switch + a per-scope opt-out (the visible controls). If
  // either is off, a trusted scope keeps the user's threshold — no 98 floor.
  const gradOn   = (opts.gradOn !== undefined) ? opts.gradOn : _graduationEnabled(db);
  const optedOut = (opts.optOut || _optedOutScopes(db)).includes(_scopeKey(doc.supplier_name, slug));
  const graduated = t.trusted && gradOn && !optedOut;
  const floor = graduated ? Math.min(userThr, TRUSTED_FLOOR) : userThr;
  if ((doc.overall_confidence || 0) < floor)
    return { eligible: false, floor, trusted: t.trusted, reason: 'below-floor' };
  // Flagged = a real validation note OR a pending Stage-4.5 correction candidate (corrected_to).
  // Unifying both auto-file sites on note-OR-corrected_to resolves the two-site divergence on the
  // SAFER side (the backend previously filed corrected_to docs that the renderer held).
  const flagged = db.prepare(
    "SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND ((validation_note IS NOT NULL AND TRIM(validation_note) <> '') OR (corrected_to IS NOT NULL AND TRIM(corrected_to) <> ''))"
  ).get(doc.id).c;
  if (flagged) return { eligible: false, floor, trusted: t.trusted, reason: 'flagged' };
  if (floor < 100) {
    const g = docTrustGate(db, doc.id, doc.supplier_name, slug, opts);
    if (!g.ok) return { eligible: false, floor, trusted: t.trusted, reason: g.reason };
  }
  return { eligible: true, floor, trusted: t.trusted, reason: 'ok' };
}

/**
 * Batch eligibility for the renderer Reprocess-All path (Slice 4): computes getFieldFormats
 * ONCE and reuses it across every doc, so evaluating a whole queue isn't N full scans. Same
 * per-doc decision the backend uses — one predicate, the two sites cannot drift.
 */
function autoFileEligibleIds(db, docs, opts = {}) {
  const formats = opts.formats || require('./learning').getFieldFormats(db);
  const gradOn  = _graduationEnabled(db);
  const optOut  = _optedOutScopes(db);
  const ids = [];
  for (const d of (docs || [])) {
    if (isAutoFileEligible(db, d, { ...opts, formats, gradOn, optOut }).eligible) ids.push(d.id);
  }
  return ids;
}

/**
 * The graduation ROSTER (Slice 5 UX): every (supplier, doc-type) that has graduated, with its
 * confirmed count + opt-out state — for the "Suppliers handled automatically" list. One shared
 * getFieldFormats scan across all scopes.
 */
function listGraduatedScopes(db) {
  const rows = db.prepare(`
    SELECT d.supplier_name AS supplier, dt.slug AS slug, dt.name AS doctype, COUNT(*) AS n
    FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'confirmed' AND TRIM(COALESCE(d.supplier_name, '')) <> ''
    GROUP BY LOWER(TRIM(d.supplier_name)), LOWER(dt.slug)
    HAVING n >= ?
  `).all(TRUST_WINDOW);
  const formats = require('./learning').getFieldFormats(db);
  const optOut = _optedOutScopes(db);
  const out = [];
  for (const r of rows) {
    const t = scopeTrust(db, r.supplier, r.slug, { formats });
    if (t.trusted) out.push({
      supplier: r.supplier, slug: r.slug, doctype: r.doctype,
      confirmed_count: t.confirmedCount, opted_out: optOut.includes(_scopeKey(r.supplier, r.slug)),
    });
  }
  return out;
}

/** Toggle a scope's graduation opt-out (per-supplier off switch). Returns the updated list. */
function setScopeOptOut(db, supplier, slug, optedOut) {
  const key = _scopeKey(supplier, slug);
  const cur = _optedOutScopes(db).filter(k => k !== key);
  if (optedOut) cur.push(key);
  require('./learning').setSetting(db, 'graduation_optout', JSON.stringify(cur));
  return cur;
}

module.exports = {
  TRUST_WINDOW, TRUST_MAX_CORRECTIONS, TRUSTED_FLOOR, UNTRUSTED_FLOOR, STRICT_TYPES,
  classifyLearnedShape, valueMatchesShape, fieldVerifiable,
  validDate: _validDate, validIban: _validIban, validVatGb: _validVatGb,
  scopeTrust, docTrustGate, isAutoFileEligible, autoFileEligibleIds,
  listGraduatedScopes, setScopeOptOut,
};
