'use strict';
/*
 * scopeReadiness.js — THE ONE readiness predicate for a (supplier, doc-type) scope.
 * (P2 of the two-line wordmark slice, 2026-08-22; gary → Oracle SIGN-OFF-W/COND C2.4: "two
 *  readiness notions is the forbidden class" — the queue badge, the teach card's countdown and the
 *  quiet lane's 'ready' trigger must all ask this function.)
 *
 * A scope is READY when the sweep could actually file its clean documents:
 *   role-complete: scopeTrust says graduated, OR every ROLE field the type carries (supplier_name +
 *                  the type's ref_field_key + date_field_key) has a non-provisional SUPPLIER-scoped
 *                  learned format group (the groups the gate verifies against — supplier-only solid
 *                  is NOT ready, the sweep would still refuse `unverifiable-value` on the reference);
 *   hasTemplate:   a taught/graduation layout exists for the scope (a sub-100 document is refused
 *                  `no-template` however solid the formats — Oracle F3, 2026-08-22).
 */

function _norm(s) { return String(s || '').trim().toLowerCase(); }

/** Does a taught / graduation template exist for (supplier, slug)? Two arms, either suffices:
 *  a document of the scope carries a template_id, or a template's frozen supplier_name equals the
 *  supplier for that type. */
function hasTemplate(db, supplier, slug) {
  const supN = _norm(supplier), slugN = _norm(slug);
  if (!supN || !slugN) return false;
  try {
    const byDoc = db.prepare(`SELECT 1 FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
                               WHERE LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ? AND LOWER(dt.slug) = ?
                                 AND d.template_id IS NOT NULL LIMIT 1`).get(supN, slugN);
    if (byDoc) return true;
    const byFixed = db.prepare(`SELECT 1 FROM template_fields tf JOIN templates t ON t.id = tf.template_id
                                 WHERE tf.field_key = 'supplier_name' AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = ?
                                   AND LOWER(COALESCE(t.document_type_slug, '')) = ? LIMIT 1`).get(supN, slugN);
    return !!byFixed;
  } catch { return false; }
}

/** The scope's templates (ids) — the lane's keyword-selection arm matches held docs against these. */
function templateIds(db, supplier, slug) {
  const supN = _norm(supplier), slugN = _norm(slug);
  const ids = new Set();
  if (!supN || !slugN) return ids;
  try {
    for (const r of db.prepare(`SELECT DISTINCT d.template_id AS id FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
                                 WHERE LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ? AND LOWER(dt.slug) = ? AND d.template_id IS NOT NULL`).all(supN, slugN)) ids.add(r.id);
    for (const r of db.prepare(`SELECT DISTINCT t.id AS id FROM template_fields tf JOIN templates t ON t.id = tf.template_id
                                 WHERE tf.field_key = 'supplier_name' AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = ?
                                   AND LOWER(COALESCE(t.document_type_slug, '')) = ?`).all(supN, slugN)) ids.add(r.id);
  } catch { /* empty */ }
  return ids;
}

/** Role-complete learned formats: every role field of the type has a NON-provisional, SUPPLIER-scoped
 *  group (getFieldFormats without includeProvisional emits solid groups only). */
function rolesSolid(db, supplier, slug, opts = {}) {
  const supN = _norm(supplier), slugN = _norm(slug);
  if (!supN || !slugN) return { ok: false, missing: ['supplier_name'] };
  const learning = require('./learning');
  const dt = db.prepare('SELECT ref_field_key, date_field_key FROM document_types WHERE LOWER(slug) = ?').get(slugN);
  const roles = ['supplier_name', dt && dt.ref_field_key, dt && dt.date_field_key].filter(Boolean);
  const formats = opts.formats || learning.getFieldFormats(db);
  const have = new Set(formats
    .filter(f => !f.provisional && _norm(f.supplier_name) === supN && _norm(f.document_type) === slugN)
    .map(f => f.field_key));
  const missing = roles.filter(k => !have.has(k));
  return { ok: missing.length === 0, missing, roles };
}

/** The predicate. opts.formats lets a batch caller reuse one getFieldFormats scan. */
function isReady(db, supplier, slug, opts = {}) {
  const supN = _norm(supplier), slugN = _norm(slug);
  if (!supN || !slugN) return { ready: false, reason: 'no-scope' };
  const trust = require('./trust');
  let graduated = false;
  try { graduated = !!(trust.scopeTrust(db, supplier, slugN, { formats: opts.formats }) || {}).trusted; } catch { graduated = false; }
  const tpl = hasTemplate(db, supplier, slugN);
  const roles = graduated ? { ok: true, missing: [] } : rolesSolid(db, supplier, slugN, opts);
  const ready = (graduated || roles.ok) && tpl;
  return { ready, graduated, rolesSolid: roles.ok, missing: roles.missing, hasTemplate: tpl,
           reason: ready ? 'ready' : (!tpl ? 'no-template' : `unverifiable:${roles.missing.join(',')}`) };
}

module.exports = { isReady, hasTemplate, templateIds, rolesSolid };
