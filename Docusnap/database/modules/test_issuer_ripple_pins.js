'use strict';
/*
 * test_issuer_ripple_pins.js — the correction-ripple's DB side (Chris round-11 card #1 fix;
 * gary→Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-21).
 *
 * The ripple finds same-sender siblings BY TEXT and pins the operator's resolved company on them so a
 * re-read reads them as that supplier. Two things the round-11 no-op exposed and the fix must honour:
 *   1. DEFERRED siblings must be found + pinnable (findSiblings returns them; the old renderer re-read
 *      only the active queue, so a pinned deferred doc was never re-read).
 *   2. the pin write is guarded to needs_review|deferred — a CONFIRMED/filed doc is NEVER re-pinned by
 *      the ripple (fail-toward-review: the ripple can cost a review click, never touch filed data).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_issuer_ripple_pins.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const { findSiblings } = require(path.join(REPO, 'database', 'modules', 'supplierSiblings.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);

const FP = JSON.stringify(['veltrix', 'automotive', 'parts']);   // shared distinctive fingerprint
const TARGET = 'Veltrix Automotive Parts';
const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Sales Order','sales_order')").run();
function newDoc(status, { supplier = null, fp = FP } = {}) {
  return db.prepare(
    "INSERT INTO documents (document_type_id, original_filename, stored_filename, folder_path, status, supplier_name, keyword_fingerprint) "
    + "VALUES (?, 'm.pdf', 'm.pdf', '', ?, ?, ?)"
  ).run(dt.lastInsertRowid, status, supplier, fp).lastInsertRowid;
}
const pinOf = (id) => db.prepare('SELECT supplier_pin FROM documents WHERE id = ?').get(id).supplier_pin;

// The scene: a source the operator just resolved, one queued sibling, one DEFERRED sibling, and a
// confirmed doc of the same layout that must stay untouched.
const source  = newDoc('needs_review');
const sibQ    = newDoc('needs_review');
const sibDef  = newDoc('deferred');
const filed   = newDoc('confirmed', { supplier: TARGET });

// 1) findSiblings surfaces BOTH the queued and the DEFERRED sibling (the edge the old queue-only
//    re-read dropped), and never the source or the filed doc.
const sibs = findSiblings(db, source, TARGET);
const sibIds = sibs.map(s => s.id).sort((a, b) => a - b);
check('findSiblings returns the queued AND the deferred sibling',
      sibIds.length === 2 && sibIds[0] === Math.min(sibQ, sibDef) && sibIds[1] === Math.max(sibQ, sibDef));
check('findSiblings excludes the source', !sibs.some(s => s.id === source));
check('findSiblings excludes the already-filed (confirmed) doc', !sibs.some(s => s.id === filed));

// 2) the ripple pins the SOURCE + every sibling (the exact apply-issuer-ripple statement), and the
//    status guard leaves the confirmed/filed doc untouched.
const pinIds = [source, ...sibs.map(s => s.id), filed];   // renderer passes [srcDocId, ...siblingIds]; filed added here to prove the guard
const stmt = db.prepare("UPDATE documents SET supplier_pin = ? WHERE id = ? AND status IN ('needs_review','deferred')");
let applied = 0;
for (const id of pinIds) applied += stmt.run(TARGET, id).changes;

check('source is pinned (included in the re-pin so a later reprocess re-derives X)', pinOf(source) === TARGET);
check('queued sibling is pinned', pinOf(sibQ) === TARGET);
check('DEFERRED sibling is pinned', pinOf(sibDef) === TARGET);
check('the CONFIRMED/filed doc is NOT pinned (status guard — fail-toward-review)', pinOf(filed) == null);
check('applied count = the three unfiled docs only', applied === 3);

// 3) once a doc carries a pin it drops out of a subsequent sibling scan (never re-offered / double-pinned)
const sibs2 = findSiblings(db, source, TARGET);
check('a pinned sibling is no longer returned by findSiblings (supplier_pin IS NULL filter)',
      !sibs2.some(s => s.id === sibQ || s.id === sibDef));

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
