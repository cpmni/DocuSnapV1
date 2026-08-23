'use strict';

const path = require('path');

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
// Auto-file floor once graduated. Set to 95 (not the old 98) because clean, correct,
// template-matched learned reads genuinely PLATEAU at 95-97 in practice — a template_fixed
// supplier read caps ~95, an anchor read ~92-95 — so a 98 floor sat just ABOVE where a
// graduated supplier's reads actually land and made graduation a dead letter (SuperStore:
// 228 clean confirmations, reads 96-97, never auto-filed). The numeric floor is only a
// coarse gate; the REAL safety for any sub-100 auto-file is docTrustGate (template match +
// every valued field strict-typed-clean or matching its learned non-freetext shape + zero
// flags), which every one of these plateau docs already passes. Lowering to 95 admits the
// clean plateau without widening the silent-miss surface (a wrong-but-regex-valid read keeps
// HIGH confidence regardless of this floor; a genuinely uncertain field drags overall <95 and
// is still held). A field dropping to ~85 (overall <95) still routes to Review.
const TRUSTED_FLOOR          = 95;
const UNTRUSTED_FLOOR        = 100;  // ungraduated scopes keep today's full-confidence-only bar

// FILING-CRITICAL per-field confidence floor. Auto-file must NOT rest on a BLENDED overall
// confidence that can hide a weak read of a field that DECIDES THE FILENAME (the type's reference
// and date). A logo@98 + date@98 can lift a reference read@84 to overall 93 — or even 100 — and a
// wrong reference then files SILENTLY and can't be un-filed. So a PRESENT reference/date value must
// itself clear this floor (checked at EVERY floor, including 100, because overall is a weighted
// average that can sit above a genuinely uncertain critical field). Only ever HOLDS a doc for Review
// — it never files one that wouldn't already — so it cannot cause a wrong auto-file. Reusable across
// every supplier/layout: it catches the cross-supplier anchor-bleed class (a false-located crop that
// reads a wrong-but-type-valid neighbour at a visibly lower per-field confidence) even when the
// learned data itself is mis-taught. Tunable / reversible via the `critical_field_conf_floor`
// setting (0 = disabled).
//   Value = 88 (reggie-calibrated). It must be ABOVE the bleed (which reprocesses at conf 87) yet
//   NOT above the by-design base confidence of a clean critical read: config base_confidence is 90
//   for invoice_number and 88 for invoice_date (85 for due/po/order dates, which are rarely a ROLE
//   field). A floor of 90 would over-HOLD a clean, boosted-only-to-88 date read on any supplier
//   without strong date learning (a real-world usability regression — whole clean batches sent to
//   Review); 88 catches the 87 bleed while letting the 88/90 base reads through. Raise toward 90 for
//   extra margin at the cost of more review, or set 0 to disable.
const CRITICAL_FIELD_FLOOR   = 88;

// SECURITY (Stage 2 — M6): parse a percent-valued SETTING and coerce anything outside [min,100]
// (negative, non-numeric, >100) back to the safe default. Closes the `parseInt(...) || N` trap
// where a stored '-1' set an auto-file floor below 0 and silently auto-filed every document.
function _settingPct(raw, dflt, min) {
  const n = parseInt(raw, 10);
  return (Number.isFinite(n) && n >= min && n <= 100) ? n : dflt;
}

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

// SHARED validation patterns (config/keyword_patterns.json `validation_patterns`) — the single
// source of truth the renderer + Python both validate against. Loaded once, guarded so a test
// harness without the config file (or an older layout) simply gets no re-check. `_matchesTypePattern`
// returns TRUE (don't block) when the type has no shipped pattern, so it can never over-refuse a
// type it can't judge. Compiled RegExps are cached per pattern string.
// WHERE THE SHIPPED CONFIG ACTUALLY LIVES (2026-08-10, Oracle C1 — this was a DEAD GUARD).
// `config/` is NOT in `build.files`; it ships as extraResources, i.e. at
// `resources/config/keyword_patterns.json` NEXT TO the asar. A repo-relative require() resolves to
// `resources/app.asar/config/keyword_patterns.json`, which does not exist — so in every packaged
// build the require threw, the cache went null, and the type re-check below answered "can't judge"
// for every value. It passed in-repo, where the relative path works, which is exactly why nobody
// caught it: the tests cannot fail on the shipped behaviour.
// Resolve the same way main.js's `resourcePath()` does, and keep ONE path for both, so a support
// edit to the shipped file changes what Python, the renderer AND this module see. (Adding
// `config/**` to `build.files` would "fix" it while creating a split brain: two copies, one edited.)
function _configDir() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) return path.join(process.resourcesPath, 'config');
  } catch { /* not in an Electron main process (harness, or a plain-node consumer) */ }
  return path.join(__dirname, '..', '..', 'config');
}
// THE THIRD CONSUMER OF validation_patterns, AND THE ONE THAT DELIBERATELY DOES NOT WIDEN.
// The other two are `keyword.load_patterns` (every Python stage, via self.patterns) and
// `get-validation-patterns` in review/handler.js (the renderer's on-blur check); both merge the
// `vat_eu` list when `vat_eu_formats` is armed. This loader does NOT, so with the flag on, a
// correct German or Irish VAT number still fails `vat_gb` here. Recorded rather than "fixed"
// because both of this loader's consumers fail TOWARD REVIEW, which is the safe direction:
//   * freeze_guard arm B declines to FREEZE the value into a template (it stays variable, and the
//     stated reason 'format' is then misleading — that is the known cost, pinned in the
//     freeze-guard tests);
//   * `_validVatGb` below runs the UK HMRC mod-97 checksum, so a widened non-UK value cannot
//     auto-file.
// Widening this loader would change what gets FROZEN and what AUTO-FILES, which is a different
// decision from what gets read and what the operator is warned about. Do not merge it here
// without measuring those two paths. (Oracle C3, 2026-08-10.)
let _sharedPatternsCache;   // undefined = not loaded yet; null = unavailable
function _sharedValidationPatterns() {
  if (_sharedPatternsCache !== undefined) return _sharedPatternsCache;
  try {
    _sharedPatternsCache = require(path.join(_configDir(), 'keyword_patterns.json')).validation_patterns || null;
  } catch { _sharedPatternsCache = null; }
  return _sharedPatternsCache;
}
const _reCache = new Map();
function _compile(p) {
  if (_reCache.has(p)) return _reCache.get(p);
  let re = null; try { re = new RegExp(p); } catch { re = null; }
  _reCache.set(p, re); return re;
}
function _matchesTypePattern(type, value) {
  const pats = _sharedValidationPatterns();
  const arr = pats && pats[type];
  if (!Array.isArray(arr) || !arr.length) return true;     // no pattern for this type → can't judge
  return arr.some(p => { const re = _compile(p); return re ? re.test(String(value)) : true; });
}

// documents.confirmed_via presence (mig 57) — cached per DB handle so older fixture DBs
// (and pre-migration installs) keep the legacy single-query trust computation untouched.
const _viaCache = new WeakMap();
function _hasConfirmedVia(db) {
  if (_viaCache.has(db)) return _viaCache.get(db);
  let ok = false;
  try { db.prepare('SELECT confirmed_via FROM documents LIMIT 0'); ok = true; } catch { ok = false; }
  _viaCache.set(db, ok);
  return ok;
}

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

// Currency decimal-place-count consistency (reggie T4). A dropped decimal turns "1234.56"
// into "123456" — a 100× mis-file that keeps a valid currency SHAPE (so no note fires) and
// would auto-file. Tightening the regex is wrong (whole-pound / ¥ amounts are legitimately
// 0-dp). Instead: learn the field's decimal-place habit and block a 0-dp value ONLY when the
// scope's confirmed history is OVERWHELMINGLY 2-dp — i.e. this supplier always prints pence,
// so a sudden large round number is a probable dropped decimal. Conservative by construction:
// needs ≥5 samples that are ≥90% two-dp before it will judge at all, and it never false-blocks
// a value that itself carries 2 dp. Values are the app's canonical money form (symbol stripped,
// '.' decimal — thousands separators already normalised out), so only '.' marks the decimal.
function _currencyDp(v) {
  const m = String(v == null ? '' : v).trim().match(/\.(\d+)\s*$/);   // canonical decimal is '.'
  return m ? m[1].length : 0;
}
function _currencyDpConsistent(value, sampleValues) {
  const vals = (sampleValues || []).map(x => String(x == null ? '' : x).trim())
    .filter(x => x && _currencyish(x));
  if (vals.length < 5) return true;                              // too little history to judge
  const twoDp = vals.filter(x => _currencyDp(x) === 2).length;
  if (twoDp / vals.length < 0.9) return true;                    // mixed/whole-pound supplier → don't judge
  if (_currencyDp(value) === 2) return true;                     // value matches the learned 2-dp habit
  // 0/1-dp value against an all-2-dp history: suspicious only when the number is sizeable. Trigger
  // at ≥4 integer digits (reggie) — this shrinks the whole-pound false-block (a legit round £150–£999
  // from a normally-penced supplier no longer trips) while still catching the common dropped-decimal
  // 100× error (e.g. 38774 ← 387.74, 123456 ← 1234.56).
  const intDigits = String(value).replace(/[^\d]/g, '').length - _currencyDp(value);
  return intDigits < 4;
}

// GB VAT modulus-97 checksum (reggie T3): first 7 digits weighted 8,7,6,5,4,3,2, plus the 2 check
// digits, must be a multiple of 97 (classic method) or with +55 added (post-2010 "9755" method).
// Accepts a 9-digit number or a 12-digit branch-trader number (checksum uses the first 9).
function _validVatGb(v) {
  // Government departments (GD000–GD499) and health authorities (HA500–HA999) use the non-checksum
  // GBGD###/GBHA### form (mirrors the shared validation pattern) — accept it before the digit strip,
  // else a legit GD/HA number strips to 3 digits and false-fails the checksum (reggie).
  const up = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  if (/^GB(GD|HA)\d{3}$/.test(up)) return true;
  const s = up.replace(/[^0-9]/g, '');
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

/**
 * The DOMINANT structured class of a scope's confirmed samples, or null when the field is
 * genuinely free text (Oracle, 2026-07-20).
 *
 * WHY THIS EXISTS. `classifyLearnedShape` above is all-or-nothing — "every non-empty sample must
 * share the class" — so it CONFLATES two completely different fields:
 *   • 15 distinct customer names  → freetext, correctly: there is nothing to verify against;
 *   • 14 product codes + 1 misread word ("Information") → ALSO freetext, wrongly: 14 samples say
 *     exactly what this field looks like.
 * That conflation is what forced a false choice between a dead-end gate (block the customer name
 * forever, unclearable by any user action) and an open door (exempt every freetext field, which
 * un-guards the contaminated code field). Distinguishing them dissolves it.
 *
 * THE INVERSION THIS CLOSES. The item="Information" class is a misread that gets CONFIRMED — by a
 * hurried operator, or by an auto-file at 100 where the gate is off by default. The moment one is
 * confirmed it joins the scope history and collapses the field to freetext. Under a blanket
 * freetext exemption, the very event that poisons a field is the event that disables the guard
 * against it. Under this rule the 14 codes still outvote the intruder and the guard holds.
 *
 * Requires ≥5 non-empty samples and ≥75% agreement, so it can only ever FIRE on real evidence;
 * below that it returns null and the caller falls back to its own (stricter) handling.
 *
 * DELIBERATELY SEPARATE from classifyLearnedShape, which must NOT change (it stays byte-identical).
 * 2026-07-20 ruled that reclassifying a contaminated REQUIRED field here would SILENTLY widen
 * graduation, because the role branch of docTrustGate would still refuse 'freetext' — a widening
 * with no verification leg. SUPERSEDED 2026-08-22 for ONE PAIRED change only (Oracle, Chris round
 * 13, `role_field_dominant_class`): `_effectiveClass` applies this SAME dominant rule to ROLE fields
 * at BOTH halves in one commit — scopeTrust's required-field check (graduation) AND docTrustGate's
 * role branch (verification) AND the corroboration probe — so a scope un-bricked by one confirmed
 * outlier ('VX$22033' among eleven 'VXS…' codes) graduates WITH its values still verified against
 * the dominant shape. Bounded by construction: only a ≥75%-structured required field can widen; a
 * wobbling issuer (3+ distinct names → freetext, names are never _codeish) still blocks graduation,
 * so the graduation-licensed issuer freeze and the fuzzy-geom shed are not reachable through it.
 */
/**
 * Is the non-role shape leniency ON? DEFAULT ON since 2026-07-20; `TRUST_NONROLE_SHAPE_LENIENT=0`
 * restores the old blanket block. Defined ONCE and exported so the tests assert against the same
 * default the product uses — a test that hard-codes its own copy of a default silently stops
 * testing the shipped behaviour the moment the default moves, which is how a pin quietly dies.
 *
 * Flipped ON after both gate conditions were met, not on the strength of the argument:
 *   • corpus A/B (realdoc_regression, 156 docs, OFF vs ON): would-auto-file 50 → 82, silent
 *     would-auto-file-WRONG (M) UNCHANGED at 1 (the pre-existing #108), M_type 0, and per-field
 *     accuracy byte-identical on all six scored fields;
 *   • live-DB re-judge under this exact rule: 29 documents flip, 0 with a ROLE blocking key,
 *     0 whose blocking field had any dominant structure.
 */
function _nonRoleLenientEnabled() {
  return process.env.TRUST_NONROLE_SHAPE_LENIENT !== '0';
}

// TRUST_SHADOW_ROW_SKIP (gary design, 2026-08-07; Oracle SIGN-OFF-W/COND 2026-08-08) — the
// SHADOW-ROW AUTO-FILE DEADLOCK.
// `_shadow_reconcile_components` (engine.py:2800,2820-2828) writes extraction rows with
// extraction_method='shadow_reconcile' purely to back the "totals add up" check. It writes ONLY
// the four money roles ('subtotal','vat_tax','shipping','discount') and only for a role the
// document's type does NOT cover — so a shadow key is FOREIGN TO THE TYPE BY CONSTRUCTION, at
// write time. Those rows are EXCLUDED from learning (learning.js:1237) and DELETED at confirm
// (reviewService.js:251, processing/handler.js:3749, both AFTER their filing decision), and they
// are not filing inputs — but docTrustGate judged filability on them anyway. With no learned
// format for a key the type does not define, `_scopeFormats` can never hold one, so the gate
// returns `unverifiable-value:<field>` permanently. The document can NEVER auto-file and the
// operator can never see, let alone clear, the row that blocked it. SEALED TWICE. Live proof:
// three documents at conf 97 on a graduated scope (floor 95), no note, `unverifiable-value:subtotal`.
//
// WHY THE ROW IS INVISIBLE (Oracle C6 — the original citation here was BACKWARDS): Review renders
// `for (const key of reviewFields())` (review/renderer.js:2456; reviewFields() at :506-509 returns
// the TYPE's field keys, never extraction keys), so a foreign key has no row to render. Note that
// review/renderer.js:2313 does the OPPOSITE of skipping — it CONSUMES shadow rows to drive the
// "✓ mathematically verified" badge. So a shadow row IS user-facing, as a badge and not as a value.
// (There is NO at100 precedent for this skip, contrary to an earlier draft of this comment: the
// at100 arm ignores such rows only as a side effect of being history-blind, it is method-blind, and
// it is `strict_100_autofile`-gated, DEFAULT OFF because it over-blocked in the field.)
//
// SKIP ONLY when the row is genuinely inert: shadow method AND not a defined field of this type AND
// not a structural role key. FAIL-OPEN means THE GATE STAYS SHUT: a type carrying no field metadata
// skips nothing, so every row is judged and the document routes to review.
// PLACED AFTER the validation_note check, so a FLAGGED shadow row still blocks — the note is real
// information about the page even when the row itself is invisible.
// Default OFF; OFF = byte-identical.
//
// FLIP MECHANISM (Oracle C5): a SETTING read here, not `process.env` set at startup — an
// env-at-startup toggle silently does nothing until the app is restarted, and this codebase has
// been bitten by the stale-main-process class repeatedly. The env var is retained as the
// dev/harness escape and WINS IN BOTH DIRECTIONS so an A/B arm is unambiguous. try/catch defaults
// OFF so a fixture DB with no settings table cannot throw inside the auto-file gate. Hoisted to
// ONE read per docTrustGate call and threadable via `opts.shadowRowSkip` (Oracle C4) — the
// per-row call site would otherwise be N indexed queries per document.
function _shadowRowSkipEnabled(db) {
  const env = process.env.TRUST_SHADOW_ROW_SKIP;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'trust_shadow_row_skip', 'false') === 'true';
  } catch { return false; }
}

// ROLE-FIELD DOMINANT CLASS (2026-08-22, Chris round 13 → Oracle SIGN-OFF-W/COND C1.1–C1.4; DARK).
// Setting `role_field_dominant_class`, env ROLE_FIELD_DOMINANT_CLASS wins in both directions; hoisted
// to ONE read per call and threadable via `opts.roleDominant` (the _shadowRowSkipEnabled idiom).
function _roleDominantEnabled(db) {
  const env = process.env.ROLE_FIELD_DOMINANT_CLASS;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'role_field_dominant_class', 'false') === 'true';
  } catch { return false; }
}
// The ONE class a required/role field is judged by, at all three sites (scopeTrust's required-field
// loop, its corroboration probe, docTrustGate's role branch — C1.1). Strict class when it is
// structured; when the strict classifier gave up ('freetext' — one confirmed outlier among many
// codes), the DOMINANT structured class (≥5 DISTINCT samples, ≥75% agreement) if there is one;
// else the strict answer stands. OFF ⇒ the strict class, byte-identical.
function _effectiveClass(f, on) {
  const cls = (f && f.cls) || 'none';
  if (!on || cls !== 'freetext') return cls;
  const dom = _dominantStructuredClass(f && f.sampleValues);
  return dom || cls;
}

// ── Auto-file gate unification (2026-08-12 NIGHT slice; gary+eric → Oracle SIGN-OFF-W/COND) ──
// ONE flag covers three coupled changes that must never ship apart: (T1) the import pre-gate in
// processing/handler.js stops bailing on the Python `needs_review` summary and defers to THIS
// predicate; (T2) the predicate gains the `missing-required` refusal below — the pre-gate's one
// unique safety, moved to the authoritative layer; (T3) machine auto-files stamp a basis-derived
// confirmed_via so they can never fill the human graduation window. Same C5 read pattern as the
// shadow-row switch: env wins both directions for harness arms, setting is the product truth.
function _gateUnifyEnabled(db) {
  const env = process.env.AUTOFILE_GATE_UNIFY;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'autofile_gate_unify', 'false') === 'true';
  } catch { return false; }
}

// T2 — the missing-required refusal: the ref role, date role, or a required non-identity custom
// field with NO non-empty value refuses `missing-required:<key>`. EXACT mirror of the
// missing_required_labels SQL in documents.js getReviewQueue (which itself mirrors the Review
// window's validateConfirm): identity keys excluded (Document-Issuer is warn-only there), and a
// field HIDDEN for the doc's matched template (template_hidden_fields, the per-sender editor's
// "Never — stop looking") is excluded — Oracle C1: a declared-absent field must never become a
// permanent auto-file blocker on exactly the scopes the owner said stop asking about.
// Data paths mirror the critical floor: opts.extractions (batch/harness) else the DB rows.
// try/catch fail-open per leg matches the fixture-resilience style of the critical floor — a
// minimal fixture without a fields table simply has no required roles to refuse on.
function _missingRequiredKey(db, doc, dtRow, opts) {
  let fields;
  try {
    fields = db.prepare(
      'SELECT key FROM fields WHERE document_type_id = ? AND COALESCE(enabled, 1) = 1 AND (' +
      ' key = ? OR key = ? OR (required = 1 AND key NOT IN (\'supplier_name\', \'customer_name\')))'
    ).all(doc.document_type_id, dtRow.ref_field_key || '', dtRow.date_field_key || '');
  } catch { return null; }
  if (!fields.length) return null;
  let hidden = new Set();
  if (doc.template_id != null) {
    try {
      hidden = new Set(db.prepare(
        'SELECT field_key FROM template_hidden_fields WHERE template_id = ?'
      ).all(doc.template_id).map(r => r.field_key));
    } catch { hidden = new Set(); }
  }
  const valued = new Set();
  const rows = opts.extractions
    ? opts.extractions
    : db.prepare('SELECT field_key, display_value, raw_value FROM extractions WHERE document_id = ?').all(doc.id);
  for (const e of rows) {
    if (e && e.field_key && String(e.display_value ?? e.raw_value ?? '').trim()) valued.add(e.field_key);
  }
  for (const f of fields) {
    if (hidden.has(f.key)) continue;
    if (!valued.has(f.key)) return f.key;
  }
  return null;
}

// ── Corroborated auto-file (owner order 2026-08-11, step 3 of the record→surface→decide plan;
//    Oracle SIGN-OFF-W/COND — C1 volume-only substitution, C2 window exclusion, both applied) ──
// A doc on a scope that fails graduation ONLY on volume may file at the TRUSTED_FLOOR when the
// page independently corroborates every filename-deciding role. Same C5 read pattern as the
// shadow-row switch: env wins both directions for harness arms, setting is the product truth.
function _corrobAutofileEnabled(db) {
  const env = process.env.CORROB_AUTOFILE;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'corroboration_autofile', 'false') === 'true';
  } catch { return false; }
}

// Critical-field floor relax by corroboration (2026-08-15, Oracle SIGN-OFF-W/COND). The 88 critical
// per-field floor holds a ref/date read whose confidence is sub-floor even when TWO independent page
// families read the SAME normalised string. This lets a LICENSED record (see _corrobLicensed) clear
// the floor for that field — BUT ONLY when the value ALSO matches the scope's dominant learned SHAPE.
// Oracle seam: crop+mapping are both box-crops (common-mode on a value that appears once), so the
// licensed-record test alone is not enough — the learned-shape agreement is the load-bearing second
// leg (a common-mode misread that produced a well-formed value is far rarer than either read alone,
// and a malformed common-mode misread is caught by the shape gate). DEFAULT OFF ⇒ byte-identical.
// Nested under the corroboration_autofile master so it can never outlive it.
function _critFieldCorrobRelaxEnabled(db) {
  const env = process.env.CRITFIELD_CORROB_FLOOR_RELAX;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'critfield_corrob_floor_relax', 'false') === 'true'
        && _corrobAutofileEnabled(db);
  } catch { return false; }
}

// Vacuous corrected_to ignore (2026-08-15, Oracle SIGN-OFF-W/COND). The `flagged` refusal counts a
// non-empty corrected_to even when it EQUALS display_value — a no-op "correction" (the rawwitness
// class stamps corrected_to == the committed value). Such a row carries no pending correction and
// must not hold a doc. When ON, corrected_to is treated as flagging only when it DIFFERS from a
// NON-EMPTY display_value (a NULL/empty display_value must NOT un-flag a real pending correction —
// fail closed). DEFAULT OFF ⇒ byte-identical.
function _vacuousCorrectedToIgnore(db) {
  const env = process.env.VACUOUS_CORRECTED_TO_IGNORE;
  if (env === '1') return true;
  if (env === '0') return false;
  try {
    return require('./learning').getSetting(db, 'vacuous_corrected_to_ignore', 'false') === 'true';
  } catch { return false; }
}

// Method families that READ THIS PAGE'S PIXELS (engine `_build_corroboration_emit` vocabulary —
// pinned cross-language in python_backend/tests/test_corroboration_emit.py; a rename there must
// break a test, because an unknown name here silently fails closed).
const _CORROB_PAGE_FAMILIES = new Set(['mapping', 'crop', 'keyword']);

// One field's corroboration record licenses filing iff: independent agreement is RECORDED, no
// independent family DISAGREES, and the agreeing set contains at least one PAGE family.
// LOAD-BEARING REFUSAL (Oracle C7): memory+hint never licenses — `template_fixed` (memory) and
// `supplier_hints` both DESCEND FROM PAST CONFIRMS, so under a wrong template binding both echo
// the same wrong name (the Quillstone class); their agreement is near-circular, not independence.
// This refusal also backstops the DAY2 young-identity analysis (machine confirms must not mature
// a frozen-issuer template) — relaxing it needs BOTH analyses re-run, not just this table.
// Unknown/future family names count toward set size but never toward the page requirement —
// fails closed. Malformed/missing records (incl. every pre-migration-63 row) → not licensed.
// Chris round 19 (2026-08-23, Oracle gate item (d)): a ROLE field (the type's ref/date) whose
// corroboration record says an independent PAGE family read a DIFFERENT value is refused on EVERY
// road (import auto-file, the scope sweep, the reprocess accept) — the four wrong Copperfield dates
// each carried `disagree: [{family:'keyword', value:<the right date>}]` while the box's read sat at
// 94 % "Nothing looks wrong". Memory/hint disagreements do not count (near-circular). Fail-open when
// the record is absent (an un-threaded harness overlay never refuses). DARK:
// `trust_role_disagreement_refuse` / TRUST_ROLE_DISAGREEMENT_REFUSE. Depends on the engine's date fold
// (FIELD_CORROBORATION_DATE_FOLD): before it every correct date also read as a disagreement.
function _roleDisagreementRefuseEnabled(db) {
  const env = process.env.TRUST_ROLE_DISAGREEMENT_REFUSE;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('./learning').getSetting(db, 'trust_role_disagreement_refuse', 'false') === 'true'; }
  catch { return false; }
}
function _pageFamilyDisagrees(record) {
  let rec = record;
  if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { return null; } }
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.disagree)) return null;
  const hit = rec.disagree.find(d => d && _CORROB_PAGE_FAMILIES.has(String(d.family || '')));
  return hit ? { family: String(hit.family), value: String(hit.value ?? '') } : null;
}
function _corrobLicensed(record) {
  let rec = record;
  if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { return false; } }
  if (!rec || typeof rec !== 'object') return false;
  if (rec.independent_agree !== true) return false;
  if (Array.isArray(rec.disagree) && rec.disagree.length) return false;
  const fams = new Set([rec.winner_family, ...(Array.isArray(rec.agree) ? rec.agree : [])].filter(Boolean));
  if (fams.size < 2) return false;
  for (const f of fams) if (_CORROB_PAGE_FAMILIES.has(f)) return true;
  return false;
}

// Every FILENAME-DECIDING role (issuer + ref + date — the same roleKeys set docTrustGate builds)
// must carry a non-empty value AND a licensed record. Both role keys must exist on the type
// (a dangling role → route off). Rows come from opts.extractions when supplied (harness /
// batch) — those rows must carry `corroboration` or this fails closed (the vacuous-green trap:
// an un-threaded overlay disables the route, never widens it).
function _docFullyCorroborated(db, doc, dtRow, opts = {}) {
  if (!dtRow || !dtRow.ref_field_key || !dtRow.date_field_key) return false;
  const roles = [...new Set([...require('./document_types').COMPANY_KEYS,
                             dtRow.ref_field_key, dtRow.date_field_key])];
  const byKey = new Map();
  if (opts.extractions) {
    for (const e of opts.extractions) if (e && e.field_key) byKey.set(e.field_key, e);
  } else {
    for (const e of db.prepare(
      'SELECT field_key, display_value, raw_value, corroboration FROM extractions WHERE document_id = ?'
    ).all(doc.id)) byKey.set(e.field_key, e);
  }
  for (const k of roles) {
    const e = byKey.get(k);
    if (!e) return false;
    const v = String(e.display_value ?? e.raw_value ?? '').trim();
    if (!v) return false;                       // stricter than graduation (empty-ref docs never corroborate-file)
    if (!_corrobLicensed(e.corroboration)) return false;
  }
  return true;
}

const _DOMINANT_MIN_SAMPLES = 5;
const _DOMINANT_MIN_SHARE   = 0.75;
function _dominantStructuredClass(sampleValues) {
  const vals = (sampleValues || []).map(v => String(v == null ? '' : v).trim()).filter(Boolean);
  if (vals.length < _DOMINANT_MIN_SAMPLES) return null;
  const tests = [['digits', _digits], ['date', _dateish], ['currency', _currencyish], ['code', _codeish]];
  let best = null, bestShare = 0;
  for (const [cls, fn] of tests) {
    const share = vals.filter(v => { try { return fn(v); } catch { return false; } }).length / vals.length;
    if (share > bestShare) { bestShare = share; best = cls; }
  }
  return bestShare >= _DOMINANT_MIN_SHARE ? best : null;
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

// Chris round 19 N2 (Oracle WRONG LAYER → here, 2026-08-23): Ironbridge filed 18 invoices on ZERO hand
// confirms. The doc-TYPE-scoped `supplier_name` group held exactly two distinct names (Copperfield ×7 +
// Ironbridge's OWN wizard confirm ×1) → classifyLearnedShape says `constant` at ≤2 distinct →
// valueMatchesShape is set membership → every Ironbridge sibling "matched" the identity it had just
// taught. One confirm self-licensed a whole pile through the `gs === ''` fallback; the badge (supplier-
// scoped solid formats) said "2 more to file by itself". A COMPANY key is an IDENTITY, not a shape:
// with this on it verifies ONLY against its supplier-scoped group (the type-wide fallback stays for
// every other field). DARK: `trust_company_key_own_scope` / TRUST_COMPANY_KEY_OWN_SCOPE.
function _companyKeyOwnScopeEnabled(db) {
  const env = process.env.TRUST_COMPANY_KEY_OWN_SCOPE;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return require('./learning').getSetting(db, 'trust_company_key_own_scope', 'false') === 'true'; }
  catch { return false; }
}
/** Map field_key -> {cls, sampleValues} for a scope, preferring the supplier-scoped format over the doc-type-scoped one. */
function _scopeFormats(db, normSupplier, slug, cachedFormats, opts = {}) {
  const all = cachedFormats || require('./learning').getFieldFormats(db);   // single source; cache for batch
  const ownScope = (opts.companyKeyOwnScope !== undefined) ? !!opts.companyKeyOwnScope : _companyKeyOwnScopeEnabled(db);
  const companyKeys = ownScope ? new Set(require('./document_types').COMPANY_KEYS || ['supplier_name']) : null;
  const out = new Map();
  for (const g of all) {
    if (String(g.document_type || '').toLowerCase().trim() !== slug) continue;
    const gs = _norm(g.supplier_name);
    if (gs !== normSupplier && gs !== '') continue;          // supplier-scoped OR doc-type-scoped
    if (gs === '' && companyKeys && companyKeys.has(g.field_key)) continue;   // r19 N2: an identity never borrows the type's names
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
// ── Graduation-window override (owner dial, 2026-08-12) ─────────────────────────────────────────
// TRUST_WINDOW becomes a per-install setting: settings.graduation_window (integer). Default stays
// 10 — zero behaviour change until the owner sets it (the comment above always said "a conservative
// install can raise W"; this also lets a fast-moving install lower it). Clamped 3..50: below 3 a
// single File-All-Ready burst of poison could graduate a scope before any human looks twice (the
// sandbox's 21-doc poison class). Clamp pinned in test_scope_trust.js.
function _configuredWindow(db) {
  try {
    const v = parseInt(require('./learning').getSetting(db, 'graduation_window', ''), 10);
    if (Number.isFinite(v)) return Math.min(50, Math.max(3, v));
  } catch { /* fall through to the constant */ }
  return TRUST_WINDOW;
}

function scopeTrust(db, supplier, slug, opts = {}) {
  const _roleDomOn = (opts.roleDominant !== undefined) ? !!opts.roleDominant : _roleDominantEnabled(db);
  const W    = opts.window ?? _configuredWindow(db);
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

  // ── Catch-up Filing slice 1 (mig 57 confirmed_via; docs/designs/CATCHUP_FILING_2026-07-31.md) ──
  // The graduation WINDOW counts HUMAN confirms only (confirmed_via NULL = human/legacy): a
  // 'scope_sweep' machine confirm must never fill the trust window — a 25-doc sweep could
  // otherwise fill all W slots with machine echoes whose wrongs never get corrected (they left
  // the review surface). The corrections SPAN, by contrast, covers ALL in-scope confirmed docs
  // (any confirmed_via) at-or-after the OLDEST of those W human confirms, in the SAME
  // (confirmed_at DESC, id DESC) total order as the window cut — so a correction on a
  // sweep-FILED doc still revokes trust (Oracle SEAM 1: a naive human-only window would disarm
  // self-revocation). With ZERO machine rows — every DB today — the span set is EXACTLY the
  // naive last-W window (same total-order cut, timestamp ties land the same side on both), so
  // behaviour is byte-identical by construction; pinned in test_scope_trust.js. An unmigrated
  // DB (no confirmed_via column — older fixtures/harnesses) keeps the legacy single query.
  const hasVia = _hasConfirmedVia(db);
  const _confirmedSql = (viaFilter) => `
    SELECT d.id, COALESCE(d.confirmed_at, '') AS ts FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'confirmed' AND LOWER(TRIM(d.supplier_name)) = ? AND LOWER(dt.slug) = ?
      ${viaFilter ? `AND COALESCE(d.confirmed_via, '') NOT IN (${require('./machine_vias').MACHINE_VIAS_SQL})` : ''}
    ORDER BY d.confirmed_at DESC, d.id DESC
  `;
  // NOTE (Oracle 2026-08-11, corroborated auto-file C2): 'auto_corroborated' machine files are
  // excluded from the HUMAN window above exactly like 'scope_sweep' — a corroborated file must
  // never advance the graduation window it was allowed to bypass (the route would otherwise
  // manufacture the trust it substitutes for). The corrections SPAN below still covers them.
  // 'auto_graduated'/'auto_threshold' (gate-unify slice, Oracle 2026-08-12 T3: BOTH machine
  // bases stamp) join the exclusion for the same reason — a graduated OR conf-100 machine file
  // is still a machine file and must never fill a human W-slot (the sweep-incident mechanism).
  // The exclusion itself is unconditional (no historic rows carry these values → byte-identical
  // until the stamp ships under the flag); the stamps ride `autofile_gate_unify` in handler.js.
  const human = db.prepare(_confirmedSql(hasVia)).all(sup, sl);
  const confirmedCount = human.length;
  if (confirmedCount < W) {
    const extra = { confirmedCount, needed: W - confirmedCount };
    // Corroborated-auto-file probe (Oracle C1): `reason === 'volume'` is a SHORT-CIRCUIT label —
    // the corrections and verifiability checks below never ran, so the caller must not read
    // "volume" as "clean but for volume". When asked (opts.corrobProbe, set only when the
    // corroboration_autofile route is on), continue the checks here and report the stricter
    // verdict: >=3 HUMAN confirms, ZERO corrections over ALL in-scope confirmed docs (any
    // confirmed_via — machine files count toward dirt, never toward volume), and every required
    // field verifiable on the available history. Only a scope failing NOTHING BUT volume may be
    // bridged by per-document corroboration.
    if (opts.corrobProbe && confirmedCount >= 3) {
      try {
        const allIds = db.prepare(_confirmedSql(false)).all(sup, sl).map(r => r.id);
        const ph0 = allIds.map(() => '?').join(',');
        const corr = allIds.length ? db.prepare(
          `SELECT COUNT(*) c FROM corrections WHERE document_id IN (${ph0})
             AND COALESCE(original_value, '') <> COALESCE(corrected_value, '')`
        ).get(...allIds).c : 0;
        let verifiable = true;
        if (corr === 0) {
          const fmts0 = _scopeFormats(db, sup, sl, opts.formats);
          for (const rf of reqFields) {
            const cls = _effectiveClass(fmts0.get(rf.key), _roleDomOn);   // C1.1: same class as the main loop
            if (!fieldVerifiable(rf.type, cls)) { verifiable = false; break; }
          }
        }
        extra.cleanButForVolume = corr === 0 && verifiable;
      } catch { extra.cleanButForVolume = false; }
    }
    return no('volume', extra);
  }

  const windowRows = human.slice(0, W);
  const windowIds = windowRows.map(r => r.id);
  let spanIds = windowIds;
  if (hasVia) {
    const b = windowRows[windowRows.length - 1];             // the OLDEST of the W human confirms
    spanIds = db.prepare(_confirmedSql(false)).all(sup, sl)
      .filter(r => r.ts > b.ts || (r.ts === b.ts && r.id >= b.id))
      .map(r => r.id);
  }
  const ph = spanIds.map(() => '?').join(',');
  const corrections = db.prepare(
    `SELECT COUNT(*) c FROM corrections WHERE document_id IN (${ph})
       AND COALESCE(original_value, '') <> COALESCE(corrected_value, '')`
  ).get(...spanIds).c;
  if (corrections > MAXC) return no('recent-correction', { confirmedCount, corrections });

  const fmts = _scopeFormats(db, sup, sl, opts.formats);
  for (const rf of reqFields) {
    const cls = _effectiveClass(fmts.get(rf.key), _roleDomOn);   // C1.1: dominant class when strict gave up
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
 *
 * opts.at100 = the LENIENT variant used on the full-100 auto-file path (Slice 7). A 100% read
 * is trusted, so we DON'T require a template and DON'T block a genuinely-unverifiable field
 * (freetext / no-history / the ambiguous 'constant' shape). We STILL block: (a) a strict-typed
 * value that fails its DETERMINISTIC re-check (date calendar, IBAN/VAT checksum, currency dp —
 * never the loose shared regex, which false-blocks legit values at 100%), and (b) a value that
 * violates a STRUCTURED learned shape (digits/date/currency/code) — e.g. a code field learned as
 * "xxxx-xxxx-x" reading the word "Information". That closes the untyped-confidently-wrong class at
 * 100% without touching a legitimately-variable free-text field (a per-doc customer name).
 */
function docTrustGate(db, docId, supplier, slug, opts = {}) {
  const doc = db.prepare('SELECT id, template_id, document_type_id FROM documents WHERE id = ?').get(docId);
  if (!doc) return { ok: false, reason: 'no-doc' };
  // opts.templateMatched / opts.extractions let a caller evaluate a REPROCESSED result (not the
  // stored row) — the reliability harness uses this to ask "would THIS reprocessed read auto-file".
  const templateMatched = (opts.templateMatched !== undefined) ? opts.templateMatched : !!doc.template_id;
  // at100 trusts the full read → no template requirement (else logo-only 100% suppliers regress).
  if (!opts.at100 && opts.requireTemplate !== false && !templateMatched) return { ok: false, reason: 'no-template' };

  const sup  = _norm(supplier);
  const sl   = String(slug || '').toLowerCase().trim();
  const fmts = _scopeFormats(db, sup, sl, opts.formats);
  const fieldTypes = new Map(
    db.prepare('SELECT key, type FROM fields WHERE document_type_id = ?').all(doc.document_type_id)
      .map(r => [r.key, r.type])
  );
  // extraction_method is selected for the SHADOW-ROW skip below. It is also the field the two
  // harness overlays (stress_test/realdoc_regression.js, services/sweepPredicate.js) were missing,
  // which would have made the gate for that skip VACUOUSLY GREEN — they now thread it too.
  const _roleDisagreeOn = (opts.roleDisagreementRefuse !== undefined) ? !!opts.roleDisagreementRefuse : _roleDisagreementRefuseEnabled(db);
  const exs = opts.extractions || db.prepare(
    _roleDisagreeOn
      ? 'SELECT field_key, display_value, raw_value, validation_note, extraction_method, corroboration FROM extractions WHERE document_id = ?'
      : 'SELECT field_key, display_value, raw_value, validation_note, extraction_method FROM extractions WHERE document_id = ?'
  ).all(docId);

  // STRUCTURAL ROLE keys — the issuer plus the type's ref/date roles. These decide the folder path
  // and the filename and cannot be corrected after filing without a re-file, so they keep the FULL
  // verifiability requirement on the sub-100 path.
  const _dtRow = opts.dtRow
    || db.prepare('SELECT ref_field_key, date_field_key FROM document_types WHERE id = ?').get(doc.document_type_id)
    || {};
  // COMPANY_KEYS, not a hardcoded 'supplier_name' (Oracle C3). foreignFields.ownFieldPredicate —
  // the CONFIRM-TIME drop that decides the same "is this row visible to the operator" question —
  // builds its role set from COMPANY_KEYS ∪ {ref,date}. Sharing the constant makes the two sets
  // unable to drift: COMPANY_KEYS held customer_name before migration 44 and could grow again, and
  // if it did, a row foreignFields keeps VISIBLE would have become skippable here.
  const roleKeys = new Set([
    ...require('./document_types').COMPANY_KEYS,
    _dtRow.ref_field_key, _dtRow.date_field_key,
  ].filter(Boolean));
  // NULL-ROLE GUARD (Oracle). An earlier draft of this claimed a dangling role key "falls back to
  // the strict treatment". That was FALSE and backwards: if ref_field_key is NULL, the document's
  // real reference field is still an ordinary field, is NOT in roleKeys, and would become the most
  // LENIENT field on the document — while the 88 critical-field floor is ALREADY a no-op there
  // (it filters on the same two role keys). Two guards off at once, on a class the codebase knows
  // happens: repairStructuralRoles() deliberately CLEARS a dangling role to NULL. So when either
  // role is unset, no leniency applies to this document at all.
  const _rolesComplete = !!(_dtRow.ref_field_key && _dtRow.date_field_key);
  const _nonRoleLenientOn = _nonRoleLenientEnabled() && _rolesComplete;
  // ONE read per document, not one per row (Oracle C4) — mirrors how formats/gradOn/optOut are
  // hoisted through opts by autoFileEligibleIds so a whole queue costs one lookup, not N×rows.
  const _roleDomOn = (opts.roleDominant !== undefined) ? !!opts.roleDominant : _roleDominantEnabled(db);
  const _shadowSkipOn = (opts.shadowRowSkip !== undefined)
    ? !!opts.shadowRowSkip : _shadowRowSkipEnabled(db);

  for (const e of exs) {
    const v = String(e.display_value ?? e.raw_value ?? '').trim();
    if (!v) continue;                                                    // empty → safe
    if (e.validation_note && String(e.validation_note).trim())           // any flag → not safe
      return { ok: false, reason: `flagged:${e.field_key}` };
    // r19 (d): a filing-critical role read that an independent page family contradicts never files
    // by itself — the page said something else; a person decides which.
    if (_roleDisagreeOn && (e.field_key === _dtRow.ref_field_key || e.field_key === _dtRow.date_field_key)
        && 'corroboration' in e && _pageFamilyDisagrees(e.corroboration))
      return { ok: false, reason: `disagreeing-read:${e.field_key}` };
    // SHADOW-ROW SKIP (see _shadowRowSkipEnabled). Deliberately AFTER the note check above: a
    // flagged shadow row still blocks. A row that is VISIBLE to the operator — a defined field of
    // this type, or a structural role — is never skipped, whatever its method, which preserves the
    // 2026-07-22 foreignFields condition that a visible foreign row must still block.
    if (_shadowSkipOn
        && String(e.extraction_method || '') === 'shadow_reconcile'
        && fieldTypes.size > 0                        // no field metadata → skip nothing → gate shut
        && !fieldTypes.has(e.field_key)
        && !roleKeys.has(e.field_key)) {
      continue;
    }
    const _t = String(fieldTypes.get(e.field_key) || '').toLowerCase();
    if (STRICT_TYPES.has(_t)) {
      // Defence-in-depth for strict types (reggie T1/T2/T3/T5): don't trust note-absence alone —
      // re-validate the VALUE at the gate. Each type is routed EXACTLY once (else-if on `_t`):
      //   • date → real CALENDAR date; iban / vat_gb → CHECKSUM; currency → decimal-place
      //     consistency vs learned history. These are STRICTER than the shared regex.
      //   • every OTHER strict type (number / reference_code / email / postcode_uk / percentage)
      //     must match its own SHARED validation pattern — the single source of truth the rest of
      //     the app uses — instead of the note-absence trust that let an off-pattern value through.
      //     A type with no shipped pattern (e.g. 'number') can't be judged, so it stays trusted.
      // Values reach here already normalised (dates → DD-MM-YYYY, money → symbol-stripped), so a
      // legit value matches its pattern; a mismatch routes to Review (fail-safe), never rejects.
      if (_t === 'date') {
        if (!_validDate(v)) return { ok: false, reason: `invalid-date:${e.field_key}` };
      } else if (_t === 'iban') {
        if (!_validIban(v)) return { ok: false, reason: `invalid-iban:${e.field_key}` };
      } else if (_t === 'vat_gb') {
        if (!_validVatGb(v)) return { ok: false, reason: `invalid-vat:${e.field_key}` };
      } else if (_t === 'currency') {
        const f = fmts.get(e.field_key);
        if (f && !_currencyDpConsistent(v, f.sampleValues)) return { ok: false, reason: `currency-dp:${e.field_key}` };
      } else if (!opts.at100 && !_matchesTypePattern(_t, v)) {
        // The loose shared-regex re-check (number/reference_code/email/postcode_uk/percentage) is
        // applied on the sub-100 discount path but SKIPPED at 100% (reggie): at full confidence it
        // false-blocks legit edge values more than it catches silent-wrong.
        return { ok: false, reason: `invalid-type:${e.field_key}` };
      }
      continue;
    }
    const f = fmts.get(e.field_key);
    if (opts.at100) {
      // At 100% only an UNAMBIGUOUS structured-shape violation blocks. 'constant' is excluded
      // because ≤2 distinct values can't distinguish a truly-fixed field from a sparse variable
      // one; 'freetext'/'none' are unverifiable by design. A code/digits/date/currency-shaped
      // field reading an off-shape value (the "Information" vs xxxx-xxxx-x case) is still caught.
      const structured = f && ['digits', 'date', 'currency', 'code'].includes(f.cls);
      if (structured && !valueMatchesShape(v, f.cls, f.sampleValues))
        return { ok: false, reason: `unverifiable-value:${e.field_key}` };
      continue;
    }
    // A field with NO confirmed history at all still blocks, role or not — a graduated scope has
    // ≥10 confirms, so a value appearing in a field nothing has ever confirmed is genuinely odd.
    // (Deliberately TIGHTER than the at100 arm, which tolerates it.)
    // No history at all still blocks, role or not — a graduated scope has ≥10 confirms, so a value
    // in a field nothing has ever confirmed is genuinely odd. 'none' (a format row with no usable
    // samples) is the same thing wearing a different hat, so it blocks identically.
    if (!f || f.cls === 'none') return { ok: false, reason: `unverifiable-value:${e.field_key}` };
    if (_nonRoleLenientOn && !roleKeys.has(e.field_key)) {
      // NON-ROLE field. Exempt ONLY when the scope's confirmed history offers nothing to verify
      // against. A field whose history is genuinely free text (a per-document recipient name,
      // address, description) is UNVERIFIABLE BY CONSTRUCTION — valueMatchesShape returns false for
      // 'freetext' by design — so requiring it to verify made graduation PERMANENTLY unreachable
      // for every type carrying one: no confirm, correction or teach could ever clear it. Measured
      // on the live DB: 29 documents held by exactly this, every one on customer_name, which is NOT
      // a filing input (COMPANY_KEYS is ['supplier_name'] alone since migration 44), so the doc
      // still lands in the right folder under the right name.
      //
      // But 'freetext' ALSO covers a field of codes with ONE misread word confirmed into it, and
      // exempting that would disarm the guard exactly when the field has been poisoned. So a
      // DOMINANT structured class (≥5 samples, ≥75% agreement) is enforced even though the strict
      // classifier gave up on the field. 'constant' stays enforced as-is: a ≤2-distinct-value field
      // reading a third value is evidence, not an abstention.
      const dom = ['constant', 'digits', 'date', 'currency', 'code'].includes(f.cls)
        ? f.cls                                        // strict classifier already agreed
        : _dominantStructuredClass(f.sampleValues);    // …else does the history still vote?
      if (dom && !valueMatchesShape(v, dom, f.sampleValues))
        return { ok: false, reason: `unverifiable-value:${e.field_key}` };
    } else {
      // ROLE field (or a non-role field on a dangling-role doc, which keeps strict refusal — C1.2):
      // verify against the effective class. With the switch on, a role field whose strict class
      // collapsed to 'freetext' under ONE confirmed outlier is judged by its DOMINANT structured
      // class instead of refused forever — verification, never exemption (the outlier itself fails).
      const _cls = (_roleDomOn && _rolesComplete && roleKeys.has(e.field_key)) ? _effectiveClass(f, true) : f.cls;
      if (!valueMatchesShape(v, _cls, f.sampleValues)) {
        return { ok: false, reason: `unverifiable-value:${e.field_key}` };
      }
    }
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
 *   • the EFFECTIVE FLOOR — graduation lowers a TRUSTED scope to TRUSTED_FLOOR (95 — the comment
 *     said 98 until 2026-08-18; the constant has been 95 since the "98 sat just ABOVE where
 *     graduated suppliers actually land" fix, so the stale number described a dead letter);
 *     otherwise the user's `auto_file_threshold` (100 unless set; fresh installs seed 90 at
 *     migration 71). A trusted scope never files ABOVE the user's own bar.
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
  // SECURITY (Stage 2 — M6): coerce an out-of-range / garbage settings value back to the safe
  // default. The old `parseInt(...) || N` let a NEGATIVE through (`-1 || 100` is -1), which set the
  // auto-file floor to -1 so `overall_confidence < -1` was never true and EVERY doc auto-filed
  // unreviewed. A valid threshold is 1..100; anything else (negative, 0, >100, non-numeric) falls
  // back to 100 (the "only perfect docs auto-file" default the `|| 100` intended but only gave for 0).
  const userThr = _settingPct(learning.getSetting(db, 'auto_file_threshold', '100'), 100, 1);
  // SELECT * (not named role columns) so this is resilient to a minimal test fixture whose
  // document_types omits ref_field_key/date_field_key — absent → undefined → the critical-field
  // floor below simply finds no keys and is a no-op.
  const dtRow = db.prepare('SELECT * FROM document_types WHERE id = ?').get(doc.document_type_id);
  const slug = dtRow && dtRow.slug;
  // Generic Document refusal (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §3, Oracle C4):
  // the "General Document" fallback type is REVIEW-BOUND BY CONSTRUCTION. With a type
  // assigned, the 'no-type' refusal above no longer covers these docs — and at overall
  // confidence 100 the structural gate below is GATE-FREE by default (strict_100_autofile
  // is opt-in), so this refusal is the ENTIRE wall between a generic doc and auto-file.
  // Unconditional: any confidence, any slider, any graduation. PINNED by
  // test_generic_autofile_refusal.js — do not weaken or move below the floor logic.
  if (slug === require('./document_types').GENERIC_SLUG)
    return { eligible: false, floor: UNTRUSTED_FLOOR, reason: 'generic-type' };
  // REFILE DECLINED (mig 87, Oracle 2026-08-23 undo-loop closure — BLOCKING cond 2): the user pulled
  // this doc BACK again AFTER it had been re-filed out of a put-back — the strongest "no, this one needs
  // me" signal, and the illusory-undo class the A3 incident was about. HARD-HELD: refused unconditionally
  // and the put-back bypass below can NEVER clear it; only a per-doc human confirm clears it (at claim).
  if (doc.refile_declined_at)
    return { eligible: false, floor: UNTRUSTED_FLOOR, reason: 'refile-declined' };
  // PUT BACK (Chris round 18 A3, mig 86): the user returned this document to the queue to LOOK at it.
  // Unconditional until a human confirm clears the stamp at claim — any confidence, any slider, any
  // graduation; every machine door (scope sweep, reprocess accept, class-fix siblings) shares this
  // predicate. A row without the column / an import-time doc object carries no stamp → unchanged.
  // BYPASS (mig 87, Oracle W/COND): opts.bypassPutBack is set ONLY by the File-All readiness recompute
  // (documents.getReviewQueue → putback_refileable), so an EXPLICIT File All can offer a put-back doc
  // that still clears every OTHER gate below. NO machine door (import auto-file, scope sweep, quiet +
  // manual reprocess, class-fix) ever passes it, so they all keep refusing 'put-back'. The refile-declined
  // refusal ABOVE runs first, so the bypass can never resurrect a hard-held doc.
  if (doc.put_back_at && !opts.bypassPutBack)
    return { eligible: false, floor: UNTRUSTED_FLOOR, reason: 'put-back' };
  const corrobOn = (opts.corrobAutoFile !== undefined) ? !!opts.corrobAutoFile : _corrobAutofileEnabled(db);
  const t = scopeTrust(db, doc.supplier_name, slug, { ...opts, corrobProbe: corrobOn });
  // Graduation is gated by the master switch + a per-scope opt-out (the visible controls). If
  // either is off, a trusted scope keeps the user's threshold — no 98 floor.
  const gradOn   = (opts.gradOn !== undefined) ? opts.gradOn : _graduationEnabled(db);
  const optedOut = (opts.optOut || _optedOutScopes(db)).includes(_scopeKey(doc.supplier_name, slug));
  const graduated = t.trusted && gradOn && !optedOut;
  // Corroborated route (owner order 2026-08-11, Oracle-signed): per-doc corroboration may
  // substitute for missing history VOLUME ONLY — never cleanliness, verifiability, or a human
  // correction (scopeTrust's corrobProbe reports exactly that verdict). Same master switch and
  // per-scope opt-out as graduation; evaluated only when it could change the outcome (the doc
  // sits in [TRUSTED_FLOOR, userThr) and the scope is not already graduated). Every safety
  // below this floor decision — the flagged refusal, the 88 critical per-field floor, the full
  // sub-100 docTrustGate, the generic-type refusal above — runs regardless of which route
  // lowered the floor and cannot be bypassed. Floors compose by min with the CONSTANT 95, so
  // no stacking exists (owner at 90 → identical with or without this route).
  const _conf0 = doc.overall_confidence || 0;
  let corroborated = false;
  if (corrobOn && !graduated && gradOn && !optedOut
      && t.reason === 'volume' && t.cleanButForVolume === true
      && userThr > TRUSTED_FLOOR && _conf0 >= TRUSTED_FLOOR && _conf0 < userThr) {
    corroborated = _docFullyCorroborated(db, doc, dtRow, opts);
  }
  const floor = (graduated || corroborated) ? Math.min(userThr, TRUSTED_FLOOR) : userThr;
  if ((doc.overall_confidence || 0) < floor)
    return { eligible: false, floor, trusted: t.trusted, reason: 'below-floor' };
  // Flagged = a real validation note OR a pending Stage-4.5 correction candidate (corrected_to).
  // Unifying both auto-file sites on note-OR-corrected_to resolves the two-site divergence on the
  // SAFER side (the backend previously filed corrected_to docs that the renderer held).
  // A corrected_to that EQUALS a non-empty display_value is a vacuous no-op correction (the
  // rawwitness class); when the ignore switch is on it does NOT flag. A NULL/empty display_value
  // keeps the corrected_to flagging (fail closed — a real pending correction must still hold).
  const vacuousIgnore = (opts.vacuousCorrectedToIgnore !== undefined)
    ? !!opts.vacuousCorrectedToIgnore : _vacuousCorrectedToIgnore(db);
  const _ctFlags = (ct, dv) => {
    const c = String(ct || '').trim();
    if (!c) return false;
    if (!vacuousIgnore) return true;
    const d = String(dv ?? '').trim();
    return !(d && c === d);                                    // ignore only a non-empty exact-equal corrected_to
  };
  const flagged = opts.extractions
    ? opts.extractions.filter(e => String(e.validation_note || '').trim() || _ctFlags(e.corrected_to, e.display_value)).length
    : (vacuousIgnore
        ? db.prepare(
            "SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND ((validation_note IS NOT NULL AND TRIM(validation_note) <> '') OR (corrected_to IS NOT NULL AND TRIM(corrected_to) <> '' AND NOT (display_value IS NOT NULL AND TRIM(display_value) <> '' AND TRIM(corrected_to) = TRIM(display_value))))"
          ).get(doc.id).c
        : db.prepare(
            "SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND ((validation_note IS NOT NULL AND TRIM(validation_note) <> '') OR (corrected_to IS NOT NULL AND TRIM(corrected_to) <> ''))"
          ).get(doc.id).c);
  if (flagged) return { eligible: false, floor, trusted: t.trusted, reason: 'flagged' };
  // T2 (gate-unify slice): an EMPTY ref role / date role / required non-identity field refuses
  // with a reason instead of relying on the import pre-gate's blanket needs_review bail (which
  // the flag retires in handler.js). Flag-gated so OFF is byte-identical; also reachable via
  // opts.gateUnify for batch hoisting (autoFileEligibleIds) and harness arms. Runs at EVERY
  // floor — an empty filename-deciding role must hold at conf 100 too (it would file as
  // 'Unknown'). Placement AFTER `flagged` so refusal reasons stay stable for existing consumers.
  const gateUnify = (opts.gateUnify !== undefined) ? !!opts.gateUnify : _gateUnifyEnabled(db);
  if (gateUnify && dtRow) {
    const mk = _missingRequiredKey(db, doc, dtRow, opts);
    if (mk) return { eligible: false, floor, trusted: t.trusted, reason: `missing-required:${mk}` };
  }
  // Filing-critical per-field confidence floor (see CRITICAL_FIELD_FLOOR). A PRESENT reference/date
  // value must itself clear the floor — a blended overall can hide a weak critical read, and the
  // reference/date decide the filename, so they can't ride an average into a silent auto-file. Applies
  // at EVERY floor (incl. 100). Empty/absent critical fields are the concern of other gates + Review,
  // not this one. Data source: opts.extractions (batch/harness) else the DB row.
  const critFloor = (opts.criticalFieldFloor !== undefined) ? opts.criticalFieldFloor
    : _settingPct(learning.getSetting(db, 'critical_field_conf_floor', String(CRITICAL_FIELD_FLOOR)), CRITICAL_FIELD_FLOOR, 0);
  if (critFloor > 0 && dtRow) {
    const critKeys = [dtRow.ref_field_key, dtRow.date_field_key].filter(Boolean);
    if (critKeys.length) {
      const critRelax = (opts.critFieldCorrobRelax !== undefined)
        ? !!opts.critFieldCorrobRelax : _critFieldCorrobRelaxEnabled(db);
      // Scope's learned shape per field — the load-bearing second leg of the relax (Oracle seam).
      const scopeFmts = critRelax
        ? _scopeFormats(db, _norm(doc.supplier_name), String(slug || '').toLowerCase().trim(), opts.formats)
        : null;
      const byKey = new Map();
      if (opts.extractions) {
        for (const e of opts.extractions) if (e && e.field_key) byKey.set(e.field_key, e);
      } else {
        // `corroboration` selected ONLY when the relax is armed — keeps the OFF path byte-identical
        // and resilient to a minimal fixture / pre-mig-63 DB that has no such column.
        const sql = critRelax
          ? 'SELECT field_key, display_value, raw_value, confidence, corroboration FROM extractions WHERE document_id = ?'
          : 'SELECT field_key, display_value, raw_value, confidence FROM extractions WHERE document_id = ?';
        for (const e of db.prepare(sql).all(doc.id))
          byKey.set(e.field_key, e);
      }
      for (const k of critKeys) {
        const e = byKey.get(k);
        if (!e) continue;                                          // field absent → not this gate's concern
        const v = String(e.display_value ?? e.raw_value ?? '').trim();
        if (!v) continue;                                          // empty → handled by Review / other gates
        const c = (e.confidence == null || e.confidence === '') ? null : Number(e.confidence);
        if (c != null && !Number.isNaN(c) && c < critFloor) {
          // Corroboration relax: a licensed record (≥2 independent page families read the SAME
          // string) AND the value matches the scope's dominant learned shape clears the floor for
          // this field. opts.extractions rows without a `corroboration` field fail closed
          // (_corrobLicensed(undefined) === false) — an un-threaded overlay never widens.
          if (critRelax && _corrobLicensed(e.corroboration)) {
            const fmt = scopeFmts && scopeFmts.get(k);
            if (fmt && valueMatchesShape(v, fmt.cls, fmt.sampleValues)) continue;
          }
          return { eligible: false, floor, trusted: t.trusted, reason: `weak-critical-field:${k}` };
        }
      }
    }
  }
  // Structural safety gate.
  //  • sub-100 (a graduated read filing at the 95 discount) → the FULL gate ALWAYS runs (template +
  //    every valued field verifiable), since the discount is where confidence is lowest.
  //  • at 100 → the read met the original full-confidence bar, so it files GATE-FREE by default
  //    (the pre-"Slice 7" behaviour): type + un-flagged is the safety, exactly as it was before.
  //    The stricter lenient `at100` gate (deterministic strict re-checks + structured-shape block)
  //    is OPT-IN via `strict_100_autofile` (default off) — it over-blocked legit 100% docs in the
  //    field (a supplier's whole batch stopped auto-filing), and the `item="Information"` class it
  //    targeted is now covered by the flagged check above + the Stage-2.5d dominant snap. The
  //    `flagged` check (validation_note / corrected_to) STILL applies at 100% regardless.
  const conf = doc.overall_confidence || 0;
  if (conf < 100) {
    const g = docTrustGate(db, doc.id, doc.supplier_name, slug, opts);
    if (!g.ok) return { eligible: false, floor, trusted: t.trusted, reason: g.reason };
  } else if ((opts.strict100 !== undefined ? opts.strict100
              : learning.getSetting(db, 'strict_100_autofile', 'false') === 'true')) {
    const g = docTrustGate(db, doc.id, doc.supplier_name, slug, { ...opts, at100: true });
    if (!g.ok) return { eligible: false, floor, trusted: t.trusted, reason: g.reason };
  }
  // `basis` names WHICH route lowered the floor (or none) — the auto-file claim stamps
  // confirmed_via from it (Oracle C2: 'auto_corroborated' is excluded from the graduation
  // window) and the claim username stays honest (Oracle C5).
  return { eligible: true, floor, trusted: t.trusted, reason: 'ok',
           basis: graduated ? 'graduated' : (corroborated ? 'corroborated' : 'threshold') };
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
  // Same hoist as the three above (Oracle C4): the shadow-row switch is a settings read, so
  // resolving it once per BATCH keeps a whole-queue evaluation at one lookup instead of one per
  // document. An explicit opts.shadowRowSkip from the caller still wins.
  const shadowRowSkip = (opts.shadowRowSkip !== undefined)
    ? !!opts.shadowRowSkip : _shadowRowSkipEnabled(db);
  // Same hoist for the corroborated-route switch (Oracle C6) — one settings read per batch.
  const corrobAutoFile = (opts.corrobAutoFile !== undefined)
    ? !!opts.corrobAutoFile : _corrobAutofileEnabled(db);
  // And for the gate-unify switch (T2 missing-required refusal) — one settings read per batch.
  const gateUnify = (opts.gateUnify !== undefined)
    ? !!opts.gateUnify : _gateUnifyEnabled(db);
  // 2026-08-15 corroboration-resolve switches — one settings read per batch each.
  const critFieldCorrobRelax = (opts.critFieldCorrobRelax !== undefined)
    ? !!opts.critFieldCorrobRelax : _critFieldCorrobRelaxEnabled(db);
  const vacuousCorrectedToIgnore = (opts.vacuousCorrectedToIgnore !== undefined)
    ? !!opts.vacuousCorrectedToIgnore : _vacuousCorrectedToIgnore(db);
  // 2026-08-22 role-field dominant class (C1.3) — one settings read per batch.
  const roleDominant = (opts.roleDominant !== undefined) ? !!opts.roleDominant : _roleDominantEnabled(db);
  const roleDisagreementRefuse = (opts.roleDisagreementRefuse !== undefined) ? !!opts.roleDisagreementRefuse : _roleDisagreementRefuseEnabled(db);   // r19 (d)
  const ids = [];
  for (const d of (docs || [])) {
    if (isAutoFileEligible(db, d, { ...opts, formats, gradOn, optOut, shadowRowSkip, corrobAutoFile, gateUnify, critFieldCorrobRelax, vacuousCorrectedToIgnore, roleDominant, roleDisagreementRefuse }).eligible) ids.push(d.id);
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
  `).all(_configuredWindow(db));   // roster prefilter follows the same dial; scopeTrust re-checks each hit
  const formats = require('./learning').getFieldFormats(db);
  const optOut = _optedOutScopes(db);
  const out = [];
  for (const r of rows) {
    const t = scopeTrust(db, r.supplier, r.slug, { formats });
    if (t.trusted) out.push({
      supplier: r.supplier, slug: r.slug, doctype: r.doctype, key: _scopeKey(r.supplier, r.slug),
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

// Slice-3 amount-routing helper: is `value` dp-consistent with the confirmed history for this
// (supplier, doc-type, field) scope? Reuses the SAME sample source + rule the auto-file currency gate
// uses (_scopeFormats -> _currencyDpConsistent), so routing and auto-file agree. No history for the
// field ⇒ true (can't judge — mirrors _currencyDpConsistent's <5-sample behaviour). Additive/inert
// until amountRouting (Slice 3) calls it, so it changes no existing trust/auto-file decision.
function _currencyConsistentForField(db, supplier, slug, fieldKey, value) {
  const fmts = _scopeFormats(db, _norm(supplier), String(slug || '').toLowerCase().trim());
  const f = fmts.get(fieldKey);
  return f ? _currencyDpConsistent(value, f.sampleValues) : true;
}

module.exports = {
  TRUST_WINDOW, TRUST_MAX_CORRECTIONS, TRUSTED_FLOOR, UNTRUSTED_FLOOR, STRICT_TYPES, _configuredWindow,
  classifyLearnedShape, valueMatchesShape, fieldVerifiable,
  _dominantStructuredClass,        // exported for the contaminated-history pin (test_scope_trust.js §18b)
  _effectiveClass, _roleDominantEnabled,   // role-field dominant class (2026-08-22) — pinned in test_role_dominant_class.js
  _nonRoleLenientEnabled,          // single source of the default, so tests can't drift from it
  _shadowRowSkipEnabled,           // ditto for the shadow-row skip (TRUST_SHADOW_ROW_SKIP)
  _gateUnifyEnabled,               // ditto for gate-unify — handler.js T1 and the T2 refusal share ONE read
  _missingRequiredKey,             // exported for the T2 pins (test_scope_trust.js)
  _corrobLicensed,                 // exported for the declined census + pins — decision logic stays HERE
  _critFieldCorrobRelaxEnabled, _vacuousCorrectedToIgnore,   // exported so pins can't drift from the default
  _roleDisagreementRefuseEnabled, _pageFamilyDisagrees,      // r19 (d): the role-field disagreement refusal
  _companyKeyOwnScopeEnabled, _scopeFormats,                 // r19 N2: a company key verifies only against its own scope
  validDate: _validDate, validIban: _validIban, validVatGb: _validVatGb,
  currencyDpConsistent: _currencyDpConsistent, currencyConsistentForField: _currencyConsistentForField, matchesTypePattern: _matchesTypePattern,
  scopeTrust, docTrustGate, isAutoFileEligible, autoFileEligibleIds,
  listGraduatedScopes, setScopeOptOut,
};
