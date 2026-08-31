'use strict';
/**
 * teachFollowup.js — the post-teach "check a few more and this sender files itself" computation.
 *
 * After a teach, the wizard shows how close the taught sender is to auto-filing and whether confirming
 * a few queued siblings now would get it there. This module is the TRUTH behind that card. It is PURE
 * given `db` (no IPC, no fs) so it can be pinned with a fixture DB, and it NEVER writes or confirms
 * anything — the card only navigates to Review, where every confirm passes the full guard set.
 *
 * gary + barry → Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-21:
 *   C1 — `needed` is the MAX over the scope's role fields (issuer / ref / date) of
 *        (FORMAT_SOLID_MIN − the format group's confirmed_count). It reads the SAME getFieldFormats
 *        output the auto-file gate (trust.docTrustGate) verifies against — never a raw confirmed-
 *        document count, because a taught document is committed with few or no extraction rows.
 *   C2 — we only PROMISE ("and it files itself") when enough same-scope siblings are queued AND they
 *        bring at least `needed` DISTINCT reference values; otherwise the ref group would classify
 *        'constant' and a genuinely-new reference would still be refused. Conservative by design:
 *        any doubt drops the promise to a plain reward, never over-promises.
 */

/**
 * @returns {{ok:true, supplier:string|null, typeName?:string, needed?:number, ready?:boolean,
 *             graduated?:boolean, siblingCount?:number, canPromise?:boolean, firstSibling?:number|null}
 *          | {ok:false}}
 */
function computeTeachFollowup(db, docId) {
  if (!db || !docId) return { ok: false };
  const learning = require('../../database/modules/learning');
  const trust = require('../../database/modules/trust');
  const NEED = learning.FORMAT_SOLID_MIN;

  const doc = db.prepare(`
    SELECT d.supplier_name AS supplier, d.document_type_id AS typeId, dt.slug AS slug, dt.name AS typeName,
           dt.ref_field_key AS refKey, dt.date_field_key AS dateKey
      FROM documents d JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`).get(docId);
  if (!doc || !String(doc.supplier || '').trim()) return { ok: true, supplier: null };

  const supN  = String(doc.supplier).toLowerCase().trim();
  const slugN = String(doc.slug || '').toLowerCase().trim();

  // Per-role contributing counts, from the SAME format-group output the gate verifies against (C1).
  const fmts = learning.getFieldFormats(db, { includeProvisional: true }) || [];
  const countFor = (key) => {
    if (!key) return NEED;    // a type without this role can never be blocked by it
    const f = fmts.find(x => x.field_key === key
      && String(x.supplier_name || '').toLowerCase().trim() === supN
      && String(x.document_type || '').toLowerCase().trim() === slugN);
    return f ? (Number(f.confirmed_count) || 0) : 0;
  };
  let needed = 0;
  for (const k of ['supplier_name', doc.refKey, doc.dateKey]) {
    needed = Math.max(needed, Math.max(0, NEED - countFor(k)));
  }

  let graduated = false;
  try { graduated = !!(trust.scopeTrust(db, doc.supplier, doc.slug) || {}).trusted; } catch { /* advisory */ }
  const ready = needed === 0 || graduated;

  // Same-scope queued siblings + how many DISTINCT reference values they can contribute (C2).
  const sibs = db.prepare(`
    SELECT d.id AS id, e.display_value AS refv
      FROM documents d
      LEFT JOIN extractions e ON e.document_id = d.id AND e.field_key = ?
     WHERE d.status = 'needs_review' AND d.document_type_id = ?
       AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ? AND d.id != ?`)
    .all(doc.refKey || '', doc.typeId, supN, docId);
  const siblingCount = sibs.length;
  const distinctRefs = new Set(sibs.map(s => String(s.refv || '').trim()).filter(Boolean)).size;

  // Promise only when confirming what's queued can actually reach the bar. A ref field with too few
  // distinct values among the queued siblings means the ref group would stay 'constant' — so a
  // genuinely-new reference on a future import would still be refused; don't promise that.
  const canPromise = !ready && needed > 0 && siblingCount >= needed
    && (!doc.refKey || distinctRefs >= needed);

  // Chris r12 #4 ("it will start filing itself" over-promised for docs ALREADY queued): whether the
  // queued siblings will file BY THEMSELVES after the confirms (Slice 1 scope-local auto-accept ON)
  // or merely become one-click ready (the consent bar), so the card's promise matches the install.
  let autoAccept = false;
  try {
    autoAccept = learning.getSetting(db, 'scope_sweep_auto_accept', 'false') === 'true'
              && learning.getSetting(db, 'scope_sweep_enabled', 'false') === 'true';
  } catch { /* advisory */ }
  // Chris r12 #3: the siblings' reference values are often still BLANK here (imported before the
  // teach, not yet re-read), which is why canPromise stays false while the number is real. Say so.
  const siblingsUnread = siblingCount > 0 && distinctRefs === 0 && !!doc.refKey;

  return {
    ok: true, supplier: doc.supplier, typeName: doc.typeName, needed, ready, graduated,
    siblingCount, canPromise, firstSibling: sibs.length ? sibs[0].id : null,
    autoAccept, siblingsUnread,
  };
}

module.exports = { computeTeachFollowup };
