/*
 * src/modules/processing/test_reconcile_holding.js
 * ------------------------------------------------
 * Unit test for reconcileHolding (Slice 4) — sweeping the inbox holding area
 * back into agreement with the DB (the source of truth) after a crash. Removes
 * .part debris, orphaned copies (no row), and dead copies (CONFIRMED only);
 * keeps live copies (needs_review/deferred/error/pending), SOFT-DELETED copies
 * (recoverable — card 1), and unmanaged files.
 * Pure fs/path/db injected — hermetic.
 *
 * Run with Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     src/modules/processing/test_reconcile_holding.js
 */
'use strict';

const path     = require('path');
const Database = require('better-sqlite3');
const { reconcileHolding } = require('./handler');

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'}  ${name}`);
  if (!cond) failures++;
};

const db = new Database(':memory:');
db.exec('CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT)');
const ins = db.prepare('INSERT INTO documents (id, status) VALUES (?, ?)');
ins.run(1, 'needs_review');   // live      → keep
ins.run(2, 'confirmed');      // dead      → remove (copy already unlinked at confirm; any file is debris)
ins.run(3, 'error');          // live      → keep
// A SOFT-DELETED doc keeps its copy across a restart — softDelete keeps the file and
// its working_path pointer, so Restore must find a readable page (Chris round 5, card 1).
// This is the pin that RED-PROVES the fix: with 'deleted' in DEAD (the bug), 4.pdf was culled.
ins.run(4, 'deleted');        // recoverable → KEEP (only _purgeOne removes it, by deleting the row)

const INBOX = 'C:/inbox';
function makeFs(names) {
  const set = new Set(names.map(n => path.join(INBOX, n)));
  set.add(INBOX);
  const log = { unlinked: [] };
  return {
    _set: set, _log: log,
    existsSync:  (p) => set.has(p),
    readdirSync: (p) => (p === INBOX ? names.slice() : []),
    unlinkSync:  (p) => { if (!set.delete(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); log.unlinked.push(p); },
  };
}

const fs = makeFs(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '9.pdf', 'x.part', 'note.txt']);
const s  = reconcileHolding(fs, path, db, INBOX);

check('scanned all 7 entries',          s.scanned === 7);
check('1 .part debris removed',         s.partsRemoved === 1);
check('1 orphan (no row) removed',      s.orphansRemoved === 1);
check('1 dead (confirmed) removed',     s.deadRemoved === 1);   // NOT 2 — deleted is no longer dead
check('4 kept',                         s.kept === 4);
check('needs_review copy kept',         fs._set.has(path.join(INBOX, '1.pdf')));
check('error copy kept',                fs._set.has(path.join(INBOX, '3.pdf')));
check('DELETED copy KEPT (card 1)',     fs._set.has(path.join(INBOX, '4.pdf')));
check('confirmed copy removed',         !fs._set.has(path.join(INBOX, '2.pdf')));
check('orphan copy removed',            !fs._set.has(path.join(INBOX, '9.pdf')));
check('.part removed',                  !fs._set.has(path.join(INBOX, 'x.part')));
check('unmanaged file left alone',      fs._set.has(path.join(INBOX, 'note.txt')));

// Missing inbox dir → empty summary, never throws
const fsNone = { existsSync: () => false, readdirSync: () => { throw new Error('no'); }, unlinkSync: () => {} };
const s2 = reconcileHolding(fsNone, path, db, 'C:/nope');
check('missing inbox is a clean no-op', s2.scanned === 0 && s2.partsRemoved === 0 && s2.kept === 0);

if (failures) {
  console.log(`\n${failures} check(s) failed — reconcileHolding regressed.`);
  process.exit(1);
}
console.log('\nAll checks passed — reconcileHolding behaves as expected.');
process.exit(0);
