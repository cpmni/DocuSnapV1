'use strict';

/**
 * database/modules/graduationTemplate.js
 * --------------------------------------
 * Auto-create a Stage-0 template the first time a (supplier, doc-type) scope GRADUATES
 * with no template yet — so a graduated supplier's sub-100 docs can actually auto-file.
 *
 * WHY: `docTrustGate` (trust.js:334) hard-blocks any SUB-100 auto-file without a template
 * match (`no-template`). But templates are only created on an explicit ⊕ teach / "Save as
 * template", never on a plain confirm. So a scope can graduate (>= W clean confirms → a 95
 * floor) on ordinary keyword/logo reads and then NEVER auto-file, because it has no template.
 * This reconnects graduation → template creation, at graduation (the earliest point a sub-100
 * doc can auto-file at all), which is why it defuses the reasons auto-create-on-first-confirm
 * was removed (bad name / poisoning / fragmentation): a graduated scope has W consistent,
 * corrected samples.
 *
 * Designed by gary (trust model) + eric (confirm seam) + Phillip (fingerprinting), then vetted
 * by the Oracle — SIGN OFF WITH CONDITIONS, all applied here:
 *   C1  create-or-pure-LINK only — on an existence MATCH, link the doc; NEVER route into
 *       templates.update() (which would append this doc's logo/fingerprint into a possibly-
 *       COLLIDING foreign template and poison it). apply() only ever creates or links.
 *   C2  auto-create only with a >=K=3 DISTINCTIVE-token identity (doc-type stopwords stripped),
 *       mirroring engine._flag_branding_conflict's own test — so every auto-template is
 *       downstream-judgeable by that guard. A thin-identity (logo-primary/sparse-text) scope is
 *       NOT auto-created (→ stays in review / manual teach); that sub-class is a later slice.
 *   C3  seed a logo_phash only after a cross-supplier COLLISION pre-check; on collision, create a
 *       KEYWORD-ONLY template (logo_phash null). Never plant a colliding logo identity.
 *   C4  skip on a null doc-type slug (never mint a null-slug template a type-scoped lookup can't
 *       find, and never cross-type fold).
 *   C6  seed fields VARIABLE-ONLY (freeze no fixed_value) — closes the "a coincidentally-constant
 *       but actually-variable field freezes a wrong value onto future docs" M-vector.
 *
 * DB-ONLY: decide() reads, apply() creates/links. No ctx/fs/subprocess — the Electron caller
 * (review/handler _maybeGraduationTemplate) does the template-file write + Python landmark/
 * fingerprint enrichment AFTER apply() returns. Keeping decide()+apply() synchronous & side-
 * effect-scoped is what makes the check→create atomic on the single main-loop (Oracle: stronger
 * than a transaction here) and keeps the logic unit-testable with an in-memory DB.
 *
 * Guarded by database/modules/test_graduation_template.js.
 */

const trust     = require('./trust');
const templates = require('./templates');
const learning  = require('./learning');

// Distinctive-branding primitives now live in the shared branding_fingerprint module (ONE source of
// truth, so _upsertTemplate's M2 reuse and this create gate can never disagree about "same supplier" —
// Oracle SEAM condition). BRANDING_STOPWORDS + DISTINCTIVE_MIN + distinctiveTokens are re-exported below
// for backward compatibility (test_graduation_template.js imports them).
const { BRANDING_STOPWORDS, DISTINCTIVE_MIN, distinctiveTokens } = require('./branding_fingerprint');
const COLLISION_DIST  = 10;   // seed-logo cross-supplier danger band (Oracle C3)

function _parseJson(s, fb) { try { const v = JSON.parse(s); return v == null ? fb : v; } catch { return fb; } }

// Cross-supplier collision pre-check (Oracle C3): is the seed logo phash within the danger band
// of ANY same-type template's logo set? ⚠ Since the 2026-07-23 detail-hash veto, create() is
// ALSO reachable when a nearby-phash match (even dist ≤6) was VETOED as a detail-contradicted
// impostor — so "reaching here" no longer implies the nearest same-type logo is >6 away. This
// check is what keeps that composition safe: the vetoed impostor's logo sits well inside
// COLLISION_DIST, so the new template is created KEYWORD-ONLY and no colliding logo identity is
// ever planted (pinned in test_graduation_template.js §detail-veto). Do NOT weaken this check
// on the old ">6 away" assumption. Conservative by design: a doubtful logo becomes keyword-only
// (safe), never a colliding logo identity (a silent misfile).
function seedLogoCollides(db, seedPhash, slug) {
  if (!seedPhash || !slug) return false;
  const rows = db.prepare(
    "SELECT id, logo_phash FROM templates WHERE logo_phash IS NOT NULL AND LOWER(COALESCE(document_type_slug, '')) = LOWER(?)"
  ).all(slug);
  for (const t of rows) {
    let hashes = templates.getLogoHashes(db, t.id);
    if (!hashes.length && t.logo_phash) hashes = [t.logo_phash];
    for (const h of hashes) {
      if (templates.hammingDistance(seedPhash, h) <= COLLISION_DIST) return true;
    }
  }
  return false;
}

// Variable-only field rows (Oracle C6): every valued field is is_variable with fixed_value null,
// so nothing gets frozen. Variable fields are extracted per-doc (anchors/keyword), so this
// template's only job is IDENTITY (satisfying docTrustGate's template_id) — never a fixed value.
function _variableOnlyFields(allValues, dtInfo) {
  const meta = new Map((dtInfo && dtInfo.fields ? dtInfo.fields : []).map(f => [f.key, f]));
  return Object.entries(allValues || {})
    .filter(([k, v]) => v && String(v).trim() && (meta.size === 0 || meta.has(k)))
    .map(([field_key]) => ({ field_key, anchor_label: null, direction: 'right', fixed_value: null, is_variable: true }));
}

function _enabled(db, opts) {
  if (opts && opts.enabled !== undefined) return !!opts.enabled;   // test / explicit override
  const master = learning.getSetting(db, 'supplier_graduation_enabled', 'true') !== 'false';
  const own    = learning.getSetting(db, 'graduation_autotemplate_enabled', 'true') !== 'false';
  return master && own;
}

/**
 * Decide what (if anything) to do for a just-confirmed doc. READ-ONLY. Returns one of:
 *   { action: 'skip',   reason }
 *   { action: 'link',   templateId, name, reason:'exists' }               — Oracle C1
 *   { action: 'create', reason:'create', seed: { name, slug, logo_phash, keyword_fingerprint, fields, keywordOnly } }
 */
function decide(db, docId, info = {}, opts = {}) {
  if (!_enabled(db, opts)) return { action: 'skip', reason: 'disabled' };

  const slug = String(info.document_type_slug || (info.dtInfo && info.dtInfo.slug) || '').toLowerCase().trim();
  if (!slug) return { action: 'skip', reason: 'no-doctype' };            // Oracle C4

  const doc = db.prepare(
    'SELECT id, template_id, supplier_name, logo_phash, logo_detail_hash, keyword_fingerprint, ocr_text FROM documents WHERE id = ?'
  ).get(docId);
  if (!doc) return { action: 'skip', reason: 'no-doc' };
  if (doc.template_id) return { action: 'skip', reason: 'already-linked' };   // e.g. a taught confirm just made one

  const supplier = String(
    doc.supplier_name || info.supplier_name ||
    (info.allValues && (info.allValues.supplier_name || info.allValues.customer_name)) || ''
  ).trim();
  if (!supplier) return { action: 'skip', reason: 'blank-name' };
  if (!learning.isPlausibleSupplierName(supplier)) return { action: 'skip', reason: 'implausible-name' };

  const t = trust.scopeTrust(db, supplier, slug, opts);
  if (!t.trusted) return { action: 'skip', reason: 'not-graduated', detail: t.reason };

  // Existence: is this scope's layout already covered by a SAME-TYPE template (logo OR keyword)?
  // On a match, LINK only — never update-fold (Oracle C1).
  // logo_detail_hash arms the detail-hash veto: 'link' WRITES documents.template_id, and a
  // false cross-supplier link pollutes getDominantSupplier tallies — the establishedIdentity
  // other guards (Part E) consume. A vetoed impostor match falls to the keyword arm or 'create'
  // (whose own C2-C3 gates apply). Fail-open when either side lacks a detail hash.
  const match = templates.identifyByFingerprint(db, {
    logo_phash: doc.logo_phash, ocr_text: doc.ocr_text, document_type_slug: slug,
    logo_detail_hash: doc.logo_detail_hash,
  });
  if (match && match.template) {
    return { action: 'link', templateId: match.template.id, name: match.template.name || null, reason: 'exists' };
  }

  // NAME-PRIMARY REUSE (Lever 1, TEMPLATE_REUSE_BY_NAME default ON, Phillip/Oracle 2026-07-27): the
  // fingerprint existence check above (logo>=60 OR keyword>=75) can MISS a drifted same-supplier template
  // — OR deliberately abstain (name-presence/detail veto) — and fall to CREATE, minting a duplicate. Before
  // creating, reuse a same-type template whose ESTABLISHED (dominant confirmed) identity EXACTLY equals this
  // graduated scope's supplier — the confirmed-identity signal the fingerprint arms lack (Oracle §3c: keyed
  // on confirmed identity, stronger than a logo suggestion; fires even when identifyByFingerprint abstained
  // — intentional, not a veto leak). LINK only (Oracle C1 — never update-fold on graduation). OFF ⇒
  // byte-identical (arm skipped ⇒ falls to the unchanged create).
  if (process.env.TEMPLATE_REUSE_BY_NAME !== '0') {
    const _nmId = templates.reuseByEstablishedName(db, supplier, slug, docId);
    if (_nmId) return { action: 'link', templateId: _nmId, name: null, reason: 'name-reuse' };
  }

  // C2: only auto-create with a >=K distinctive-token identity (downstream-judgeable, and a real
  // "who/what" signal). A thin-identity (logo-primary/sparse-text) scope is left to review.
  const kf   = _parseJson(doc.keyword_fingerprint, []);
  const toks = distinctiveTokens(kf);
  if (toks.length < DISTINCTIVE_MIN) return { action: 'skip', reason: 'thin-identity', tokens: toks.length };

  // C3: seed the logo only when it doesn't collide cross-supplier; else keyword-only.
  const collides = doc.logo_phash ? seedLogoCollides(db, doc.logo_phash, slug) : false;
  const seedLogo = (doc.logo_phash && !collides) ? doc.logo_phash : null;

  return {
    action: 'create', reason: 'create',
    seed: {
      name: supplier, slug,
      logo_phash: seedLogo,
      keyword_fingerprint: kf,
      fields: _variableOnlyFields(info.allValues, info.dtInfo),
      keywordOnly: !seedLogo,
    },
  };
}

/**
 * Apply a decide() decision — the pure DB write (link doc / create template + link). No ctx / fs /
 * subprocess; the Electron caller does the template-file write + Python enrichment afterwards.
 * Returns { created, linked, templateId, name, keywordOnly } or null for a skip.
 */
function apply(db, docId, decision) {
  if (!decision || decision.action === 'skip') return null;

  if (decision.action === 'link') {
    // Pure link — set the doc's template_id only. Do NOT touch the matched template's identity
    // (no addLogoHash / stabiliseFingerprint) — it may be a colliding foreign supplier (Oracle C1).
    db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL')
      .run(decision.templateId, docId);
    return { created: false, linked: true, templateId: decision.templateId, name: decision.name || null, keywordOnly: null };
  }

  const s = decision.seed;
  const templateId = templates.create(db, {
    name: s.name,
    document_type_slug: s.slug,
    logo_phash: s.logo_phash,              // may be null (keyword-only, Oracle C3)
    keyword_fingerprint: s.keyword_fingerprint,
    fields: s.fields,                      // variable-only (Oracle C6)
  });
  db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL')
    .run(templateId, docId);
  return { created: true, linked: false, templateId, name: s.name, keywordOnly: !!s.keywordOnly };
}

module.exports = {
  decide, apply, distinctiveTokens, seedLogoCollides,
  BRANDING_STOPWORDS, DISTINCTIVE_MIN, COLLISION_DIST,
};
