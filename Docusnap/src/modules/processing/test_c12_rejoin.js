'use strict';
/*
 * test_c12_rejoin.js — C12 "undo a bad automatic split" (Rejoin), the DB half (2026-09-19; barry+eric+gary
 * → Oracle SIGN-OFF-W/COND C1-C6, DARK belt mig 180 `segment_pair_hold`). Drives the SHIPPED module-scope
 * code (H._resolvePairPartner / H._rejoinPairSurgery), never a replica.
 *
 * Pins:
 *   - reconstruction: clicking EITHER half resolves the same (survivor=earlier, removed=later) + partnerPage;
 *   - reciprocal guard: a candidate whose note names a DIFFERENT page is NOT a partner (no cross-bind);
 *   - cross-folder: two identical-<stem> imports in different folders never bind to each other;
 *   - a CONFIRMED (filed) partner is not a candidate — the join cannot target a filed doc (Oracle C4);
 *   - surgery (Oracle C1): survivor page_count summed, BOTH pair sentences cleared, mig-176 note stamped,
 *     partner soft-deleted, and the survivor NEVER auto-files (the trade-off pin);
 *   - 3-segment chain: joining (p1,p2) leaves p3 live, and the orphaned p3 then refuses cleanly (partner_gone).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/modules/processing/test_c12_rejoin.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust'));
const H = require('./handler.js');
const SP = require('./split_plan');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '1');            // laxest bar — only a note can refuse
learning.setSetting(db, 'auto_file_full_confidence', 'false');

const notesOf = (id) => db.prepare('SELECT validation_note FROM extractions WHERE document_id = ?').all(id).map(r => r.validation_note).filter(Boolean);
const hasPair = (id) => notesOf(id).some(n => SP.hasPairSegmentHold(n));
const hasMerged = (id) => notesOf(id).some(n => SP.hasMergedSegmentHold(n));
const doc = (id) => documents.getById(db, id);

// Seed a segment doc with a value row + a pair sentence stamped on it.
function seed(name, folder, sentence, { supplier = 'Acme Widgets', ref = 'INV-1' } = {}) {
  const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id, page_count, working_path) VALUES (?,?,'needs_review',?,1,1,?)")
    .run(name, folder, supplier, path.join(folder, name)).lastInsertRowid;
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method) VALUES (?, 'invoice_number', ?, ?, 95, 'keyword')").run(id, ref, ref);
  H._stampSegmentHold(db, id, 1, null, sentence);   // stamp the exact pair sentence
  return id;
}
// The two sentences of an adjacent pair (predPages < succPages).
const sents = (pf, pt, sf, st) => SP.pairSentences({ predPages: { from: pf, to: pt }, succPages: { from: sf, to: st } });

(async () => {
  // ── reconstruction: either half → same survivor/removed ────────────────────────────────────────
  console.log('§1 reconstruction — clicking either half resolves the same pair (survivor = earlier page)');
  {
    const s = sents(1, 1, 2, 2);
    const p1 = seed('stack_split_p1.pdf', '/in', s.pred);
    const p2 = seed('stack_split_p2.pdf', '/in', s.succ);
    const fromP2 = H._resolvePairPartner(db, p2, 1);
    check('from the later page: ok', fromP2.ok, JSON.stringify(fromP2));
    check('survivor is the earlier page (p1)', fromP2.ok && fromP2.survivor.id === p1);
    check('removed is the later page (p2)', fromP2.ok && fromP2.removed.id === p2);
    check('partnerPage = 1', fromP2.ok && fromP2.partnerPage === 1);
    const fromP1 = H._resolvePairPartner(db, p1, 2);
    check('from the earlier page: survivor still p1, removed still p2', fromP1.ok && fromP1.survivor.id === p1 && fromP1.removed.id === p2);
  }

  // ── surgery ──────────────────────────────────────────────────────────────────────────────────
  console.log('§2 surgery — page_count summed, both pair sentences cleared, mig-176 stamped, partner soft-deleted');
  {
    const s = sents(1, 1, 2, 2);
    const p1 = seed('rej_split_p1.pdf', '/in', s.pred);
    const p2 = seed('rej_split_p2.pdf', '/in', s.succ);
    check('p1 carries a pair sentence before', hasPair(p1));
    const r = H._resolvePairPartner(db, p1, 2);
    H._rejoinPairSurgery(db, r.survivor, r.removed, 2);
    check('survivor page_count = 2', doc(p1).page_count === 2, String(doc(p1).page_count));
    check('survivor pair sentence CLEARED', !hasPair(p1));
    check('survivor mig-176 "look first" note stamped', hasMerged(p1));
    check('removed doc soft-deleted', doc(p2).status === 'deleted', doc(p2).status);
    // never auto-files (the trade-off pin: a future dev cannot clear the note and let it file)
    const elig = trust.isAutoFileEligible(db, doc(p1)) || {};
    check('survivor NEVER auto-files (flagged/held)', elig.eligible === false, JSON.stringify(elig));
  }

  // ── reciprocal guard: a candidate that names a DIFFERENT page is not a partner ──────────────────
  console.log('§3 reciprocal guard — a non-reciprocal same-page candidate does NOT bind');
  {
    const p1 = seed('recip_split_p1.pdf', '/in', sents(1, 1, 2, 2).pred);   // names page 2
    // a doc AT page 2 but whose note names page 7 (a different pair) — must NOT match
    seed('recip_split_p2.pdf', '/in', sents(7, 7, 2, 2).succ);              // succ names "previous page (7)"
    const r = H._resolvePairPartner(db, p1, 2);
    check('non-reciprocal candidate rejected → partner_gone', !r.ok && r.blocked === 'partner_gone', JSON.stringify(r));
  }

  // ── cross-folder: identical <stem> in another folder never binds ────────────────────────────────
  console.log('§4 cross-folder — two identical-stem imports never cross-bind');
  {
    const a1 = seed('dup_split_p1.pdf', '/inA', sents(1, 1, 2, 2).pred);
    const a2 = seed('dup_split_p2.pdf', '/inA', sents(1, 1, 2, 2).succ);
    const b1 = seed('dup_split_p1.pdf', '/inB', sents(1, 1, 2, 2).pred);
    seed('dup_split_p2.pdf', '/inB', sents(1, 1, 2, 2).succ);
    const r = H._resolvePairPartner(db, a1, 2);
    check('resolves within the SAME folder only', r.ok && r.survivor.id === a1 && r.removed.id === a2);
    check('does NOT bind to the other folder', r.ok && r.removed.id !== b1);
  }

  // ── a CONFIRMED partner is not a candidate — the join cannot target a filed doc ─────────────────
  console.log('§5 a filed (confirmed) partner is never a join target (Oracle C4)');
  {
    const p1 = seed('filed_split_p1.pdf', '/in', sents(1, 1, 2, 2).pred);
    const p2 = seed('filed_split_p2.pdf', '/in', sents(1, 1, 2, 2).succ);
    db.prepare("UPDATE documents SET status = 'confirmed' WHERE id = ?").run(p2);
    const r = H._resolvePairPartner(db, p1, 2);
    check('confirmed partner → not resolvable (partner_gone)', !r.ok && r.blocked === 'partner_gone', JSON.stringify(r));
  }

  // ── 3-segment chain: join (p1,p2), then the orphaned p3 refuses cleanly ─────────────────────────
  console.log('§6 3-segment chain — joins only the named pair; the orphan then refuses cleanly');
  {
    const p1 = seed('chain_split_p1.pdf', '/in', sents(1, 1, 2, 2).pred);       // names 2
    // p2 is the middle page: succ of (1,2) AND pred of (2,3) → two pair sentences
    const p2 = seed('chain_split_p2.pdf', '/in', sents(1, 1, 2, 2).succ);       // names 1
    H._stampSegmentHold(db, p2, 1, null, sents(2, 2, 3, 3).pred);               // ALSO names 3
    const p3 = seed('chain_split_p3.pdf', '/in', sents(2, 2, 3, 3).succ);       // names 2
    const r12 = H._resolvePairPartner(db, p1, 2);
    check('(p1,p2) resolves: survivor p1, removed p2', r12.ok && r12.survivor.id === p1 && r12.removed.id === p2);
    H._rejoinPairSurgery(db, r12.survivor, r12.removed, 2);
    check('p2 soft-deleted, p3 still live', doc(p2).status === 'deleted' && doc(p3).status === 'needs_review');
    // p3 still names page 2, but no live page-2 segment remains → refuse cleanly (iterative limitation, documented)
    const r3 = H._resolvePairPartner(db, p3, 2);
    check('orphaned p3 refuses cleanly (partner_gone)', !r3.ok && r3.blocked === 'partner_gone', JSON.stringify(r3));
  }

  console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
