#!/usr/bin/env node
'use strict';
/**
 * test_near_match_siblings.js — Tier C "converging siblings" issuer near-match (Chris 2026-09-24 card 5; gary → Oracle
 * SIGN-OFF-W/COND C1-C8, 2026-09-25; DARK `issuer_sibling_dominant_hold`, mig 218).
 *
 * THE GAP: findNearMatchIdentity sees confirmed history (≥ 3 human confirms) + frozen template identities only, so the
 * batch's OWN pages — 18 "Meadowvale Dairy Wholesale" beside one "Meadowyale…" and one "Dairy Wholesale", all letterhead
 * prefills of the SAME layout — are invisible to it, and the first confirms mint a second/third sender folder.
 * Tier C: among the documents that CONVERGE by LAYOUT (branding fingerprint 0.80 OR logo phash ≤ 13), is the candidate a
 * 1-2-edit / token-sub-run near-miss of the DOMINANT spelling? Ask-only, fold-first, budgeted, fails open.
 *
 * Real migrated :memory: DB; 20 docs sharing a ≥ 3-distinctive-token fingerprint (+ a close phash on most).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_near_match_siblings.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
const FP_MEADOW = JSON.stringify(['Meadowvale', 'Dairy', 'Wholesale', 'CREDIT', 'NOTE', 'Creamery', 'Butterwick', 'VAT', 'Acct', 'enquiries']);
const FP_OTHER  = JSON.stringify(['Harrowgate', 'Timber', 'Supplies', 'INVOICE', 'Sawmill', 'Lane', 'Draymarket', 'VAT']);
const PH_A = '807f8181c37e7f61', PH_A2 = '807f8181c37e7f63' /* 1 bit off */, PH_FAR = '0000ffff0000ffff';
let seq = 0;
const ins = ({ name, fp = FP_MEADOW, ph = PH_A, status = 'needs_review', via = null, intake = null }) => {
  seq += 1;
  db.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash, confirmed_via, intake)
              VALUES (?, '/in', ?, ?, ?, ?, ?, ?)`).run(`d${seq}.pdf`, status, name, fp, ph, via, intake);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
};
const snapshot = (id) => JSON.stringify(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));

// ── The exhibit: 18 × the right spelling, one v→y garble, one truncated head, all converging ──
const good = []; for (let i = 0; i < 18; i++) good.push(ins({ name: 'Meadowvale Dairy Wholesale', ph: i % 2 ? PH_A : PH_A2 }));
const garble = ins({ name: 'Meadowyale Dairy Wholesale' });
const trunc  = ins({ name: 'Dairy Wholesale' });
const other  = ins({ name: 'Harrowgate Timber Supplies', fp: FP_OTHER, ph: PH_FAR });

console.log('\n1. the switch (explicit env, else the setting)');
delete process.env.ISSUER_SIBLING_DOMINANT_HOLD;
check("setting unset → OFF", learning.siblingDominantEnabled(db) === false);
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('issuer_sibling_dominant_hold', 'true')").run();
check("setting 'true' → ON", learning.siblingDominantEnabled(db) === true);
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '0';
check("env '0' kills even with the setting on", learning.siblingDominantEnabled(db) === false);
db.prepare("UPDATE settings SET value = 'false' WHERE key = 'issuer_sibling_dominant_hold'").run();
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '1';
check("env '1' forces even with the setting off", learning.siblingDominantEnabled(db) === true);
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '';
check("env '' is NOT on (the EMPTY-as-ON trap): the setting decides (off)", learning.siblingDominantEnabled(db) === false);
delete process.env.ISSUER_SIBLING_DOMINANT_HOLD;

console.log('\n2. the exhibit');
const before = snapshot(garble);
let r = learning.findDominantSiblingIdentity(db, garble, 'Meadowyale Dairy Wholesale');
check('(a) "Meadowyale…" → near, kind edit, distance 1, existing "Meadowvale Dairy Wholesale", 18 siblings, source siblings',
      r.near === true && r.kind === 'edit' && r.distance === 1 && r.existing === 'Meadowvale Dairy Wholesale' && r.siblings === 18 && r.source === 'siblings', JSON.stringify(r));
check('    …confirms is null (this is NOT the confirmed-history tier) and the tally is reported (own 1, pairTests)', r.confirms === null && r.own === 1 && r.pairTests >= 18);
check('    …the row is byte-unchanged after the call (never writes)', snapshot(garble) === before);
r = learning.findDominantSiblingIdentity(db, trunc, 'Dairy Wholesale');
check('(b) "Dairy Wholesale" → near, kind subrun, existing the full name, 18 siblings', r.near === true && r.kind === 'subrun' && r.existing === 'Meadowvale Dairy Wholesale' && r.siblings === 18, JSON.stringify(r));
r = learning.findDominantSiblingIdentity(db, good[0], 'Meadowvale Dairy Wholesale');
check('(c) any of the 18 → NOT near (its own spelling dominates: own 18 vs the garble 1)', r.near === false && r.reason === 'no-dominant-fold' && r.own === 18, JSON.stringify(r));
r = learning.findDominantSiblingIdentity(db, other, 'Harrowgate Timber Supplies');
check('(d) an unrelated sender exits at the cheap step (no near fold, zero pair tests)', r.near === false && r.reason === 'no-near-fold' && r.pairTests === 0, JSON.stringify(r));

console.log('\n3. the layout witness is load-bearing (NEGATIVE CONTROL: same names, disjoint fingerprints, far phash)');
const db2 = new Database(':memory:'); quiet(() => runMigrations(db2));
const ins2 = (name, fp, ph) => { db2.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash) VALUES ('x.pdf', '/in', 'needs_review', ?, ?, ?)`).run(name, fp, ph); return Number(db2.prepare('SELECT last_insert_rowid() AS id').get().id); };
for (let i = 0; i < 18; i++) ins2('Meadowvale Dairy Wholesale', JSON.stringify(['Alpha' + i, 'Beta' + i, 'Gamma' + i, 'Delta' + i]), PH_FAR);
const g2 = ins2('Meadowyale Dairy Wholesale', FP_MEADOW, PH_A);
r = learning.findDominantSiblingIdentity(db2, g2, 'Meadowyale Dairy Wholesale');
check('(e) same names but NO layout convergence → not near (no dominant fold: converging 0)', r.near === false && r.reason === 'no-dominant-fold', JSON.stringify(r));
const g3 = ins2('Someone Else Ltd', null, null);
r = learning.findDominantSiblingIdentity(db2, g3, 'Someone Else Ltd');
check('(f) a document with NO signature of its own → no-siblings (= today)', r.near === false && r.reason === 'no-siblings', JSON.stringify(r));
db2.close();

console.log('\n4. text proximity budget (the shipped comparators, unchanged)');
r = learning.findDominantSiblingIdentity(db, garble, 'Brambleworth Dairy Wholesale');
check('(g) "Brambleworth…" vs 18 × "Meadowvale…" converging → NOT near (different-company: too many edits)', r.near === false, JSON.stringify(r));
const db3 = new Database(':memory:'); quiet(() => runMigrations(db3));
const ins3 = (name) => { db3.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash) VALUES ('x.pdf', '/in', 'needs_review', ?, ?, ?)`).run(name, FP_MEADOW, PH_A); return Number(db3.prepare('SELECT last_insert_rowid() AS id').get().id); };
for (let i = 0; i < 18; i++) ins3('ABC Ltd');
const abd = ins3('ABD Ltd');
r = learning.findDominantSiblingIdentity(db3, abd, 'ABD Ltd');
check('(h) "ABC Ltd" × 18 vs "ABD Ltd" → NOT near (stored name too short — the comparator\'s floor)', r.near === false, JSON.stringify(r));
for (let i = 0; i < 18; i++) ins3('Acme Trading Ltd');
const lim = ins3('Acme Trading Limited');
r = learning.findDominantSiblingIdentity(db3, lim, 'Acme Trading Limited');
check('(i) Ltd vs Limited → NOT near (different-company by edits; a legal suffix is not a false-hold class)', r.near === false, JSON.stringify(r));
const longer = ins3('Meadowvale Dairy Wholesale Group Holdings');
for (let i = 0; i < 4; i++) ins3('Meadowvale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db3, longer, 'Meadowvale Dairy Wholesale Group Holdings');
check('(j) a candidate LONGER than the dominant never holds via the sub-run arm (directional: only a truncation holds)', r.near === false, JSON.stringify(r));
db3.close();

console.log('\n5. the tie-break (Oracle: direction only — the safety is the two families)');
const db4 = new Database(':memory:'); quiet(() => runMigrations(db4));
const ins4 = (name, status = 'needs_review', via = null) => { db4.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash, confirmed_via) VALUES ('x.pdf', '/in', ?, ?, ?, ?, ?)`).run(status, name, FP_MEADOW, PH_A, via); return Number(db4.prepare('SELECT last_insert_rowid() AS id').get().id); };
const a1 = ins4('Meadowvale Dairy Wholesale'), b1 = ins4('Meadowyale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db4, b1, 'Meadowyale Dairy Wholesale');
check('PINNED TRADE-OFF: a 1-vs-1 cluster → abstain (no majority; a 2-doc split routes nowhere new)', r.near === false && r.reason === 'no-dominant-fold', JSON.stringify(r));
const a2 = ins4('Meadowvale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db4, b1, 'Meadowyale Dairy Wholesale');
check('2-vs-1 → the ask fires (count ≥ 2 AND > own 1)', r.near === true && r.siblings === 2, JSON.stringify(r));
// majority garble: 18 garble + 2 right → confirming a RIGHT one is ASKED with the garble offered (the human Keeps)
const db5 = new Database(':memory:'); quiet(() => runMigrations(db5));
const ins5 = (name) => { db5.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash) VALUES ('x.pdf', '/in', 'needs_review', ?, ?, ?)`).run(name, FP_MEADOW, PH_A); return Number(db5.prepare('SELECT last_insert_rowid() AS id').get().id); };
for (let i = 0; i < 18; i++) ins5('Meadowyale Dairy Wholesale');
const right1 = ins5('Meadowvale Dairy Wholesale'); ins5('Meadowvale Dairy Wholesale');
const snap5 = JSON.stringify(db5.prepare('SELECT * FROM documents ORDER BY id').all());
r = learning.findDominantSiblingIdentity(db5, right1, 'Meadowvale Dairy Wholesale');
check('majority garble: the ask FIRES offering the majority spelling (copy must never assert it is right)', r.near === true && r.existing === 'Meadowyale Dairy Wholesale' && r.siblings === 18, JSON.stringify(r));
check('    …and every row is byte-unchanged (never writes)', JSON.stringify(db5.prepare('SELECT * FROM documents ORDER BY id').all()) === snap5);
db5.close();

console.log('\n6. Oracle C2 — HUMAN-confirmed converging siblings count; machine vias do not');
const db6 = new Database(':memory:'); quiet(() => runMigrations(db6));
const ins6 = (name, status = 'needs_review', via = null) => { db6.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash, confirmed_via) VALUES ('x.pdf', '/in', ?, ?, ?, ?, ?)`).run(status, name, FP_MEADOW, PH_A, via); return Number(db6.prepare('SELECT last_insert_rowid() AS id').get().id); };
// the 3+1 batch: three right, one garble; two of the right ones ALREADY confirmed by a human (< 3 → Tier A silent)
ins6('Meadowvale Dairy Wholesale', 'confirmed', null); ins6('Meadowvale Dairy Wholesale', 'confirmed', null);
ins6('Meadowvale Dairy Wholesale'); const g6 = ins6('Meadowyale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db6, g6, 'Meadowyale Dairy Wholesale');
check('3+1 with two right ones already confirmed → the ask FIRES (queued 1 + confirmed 2 = 3 > own 1); Tier A would have stayed silent (< 3)',
      r.near === true && r.siblings === 3 && r.confirmedSiblings === 2, JSON.stringify(r));
const db7 = new Database(':memory:'); quiet(() => runMigrations(db7));
const ins7 = (name, status = 'needs_review', via = null) => { db7.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash, confirmed_via) VALUES ('x.pdf', '/in', ?, ?, ?, ?, ?)`).run(status, name, FP_MEADOW, PH_A, via); return Number(db7.prepare('SELECT last_insert_rowid() AS id').get().id); };
ins7('Meadowvale Dairy Wholesale', 'confirmed', 'scope_sweep'); ins7('Meadowvale Dairy Wholesale', 'confirmed', 'auto_reprocess');
const g7 = ins7('Meadowyale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db7, g7, 'Meadowyale Dairy Wholesale');
check('MACHINE-confirmed siblings (scope_sweep / auto_reprocess) do NOT count → no ask (consistent with Tier A)', r.near === false, JSON.stringify(r));
// 10/10 stays 10/10 even as docs file
const db8 = new Database(':memory:'); quiet(() => runMigrations(db8));
const ins8 = (name, status = 'needs_review') => { db8.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash) VALUES ('x.pdf', '/in', ?, ?, ?, ?)`).run(status, name, FP_MEADOW, PH_A); return Number(db8.prepare('SELECT last_insert_rowid() AS id').get().id); };
for (let i = 0; i < 9; i++) ins8('Meadowvale Dairy Wholesale'); ins8('Meadowvale Dairy Wholesale', 'confirmed');
for (let i = 0; i < 9; i++) ins8('Meadowyale Dairy Wholesale'); const g8 = ins8('Meadowyale Dairy Wholesale');
r = learning.findDominantSiblingIdentity(db8, g8, 'Meadowyale Dairy Wholesale');
check('10/10 with one filed either way → still no ask (10 vs own 10: no strict majority, no drift as docs file)', r.near === false, JSON.stringify(r));
db6.close(); db7.close(); db8.close();

console.log('\n7. Oracle C3 — budget + perf (synthetic 2,000-row queue, 100 senders)');
const db9 = new Database(':memory:'); quiet(() => runMigrations(db9));
const insMany = db9.prepare(`INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint, logo_phash) VALUES ('x.pdf', '/in', 'needs_review', ?, ?, ?)`);
const tx = db9.transaction(() => { for (let i = 0; i < 2000; i++) { const s = i % 100; insMany.run(`Sender Number ${s} Trading Ltd`, JSON.stringify([`Tok${s}a`, `Tok${s}b`, `Tok${s}c`, 'INVOICE', 'VAT']), `807f8181c37e7f${(s % 256).toString(16).padStart(2, '0')}`); } });
tx();
const odd = (() => { insMany.run('Sender Number 7 Tradlng Ltd', JSON.stringify(['Tok7a', 'Tok7b', 'Tok7c', 'INVOICE', 'VAT']), '807f8181c37e7f07'); return Number(db9.prepare('SELECT last_insert_rowid() AS id').get().id); })();
let t0 = Date.now(); r = learning.findDominantSiblingIdentity(db9, odd, 'Sender Number 7 Tradlng Ltd'); let dt = Date.now() - t0;
check(`a 1-edit odd read in a 2,000-row / 100-sender queue holds (20 siblings) in ${dt} ms (≤ 25 ms budget, generous: ≤ 200)`, r.near === true && r.siblings === 20 && dt <= 200, JSON.stringify(r));
t0 = Date.now(); r = learning.findDominantSiblingIdentity(db9, odd, 'Sender Number 7 Trading Ltd'); dt = Date.now() - t0;
check(`the common case (own spelling dominant) is cheap too: ${dt} ms`, r.near === false && dt <= 200, JSON.stringify(r));
r = learning.findDominantSiblingIdentity(db9, odd, 'Sender Number 7 Tradlng Ltd', { budget: 5 });
check('over the pair budget → fail OPEN with reason budget', r.near === false && r.reason === 'budget', JSON.stringify(r));
// the queue stamp over 2,000 rows once (the display slice) — must stay well under a second
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '1';
t0 = Date.now(); const q = documents.getReviewQueue(db9); dt = Date.now() - t0;
const stamped = q.filter(x => x.issuer_sibling_dominant);
check(`getReviewQueue over 2,001 rows stamps exactly the odd row (${stamped.length}) in ${dt} ms (≤ 100 ms budget, generous: ≤ 1500)`, stamped.length === 1 && stamped[0].id === odd && stamped[0].issuer_sibling_count === 20 && dt <= 1500);
delete process.env.ISSUER_SIBLING_DOMINANT_HOLD;
const q2 = documents.getReviewQueue(db9);
check('OFF: no row carries issuer_sibling_dominant / issuer_sibling_count (byte-identical rows)', q2.every(x => !('issuer_sibling_dominant' in x) && !('issuer_sibling_count' in x)));
db9.close(); db4.close();

console.log('\n8. the exhibit through the QUEUE (display slice, ON): the two odd rows group under the dominant spelling');
process.env.ISSUER_SIBLING_DOMINANT_HOLD = '1';
const qq = documents.getReviewQueue(db);
const gRow = qq.find(x => x.id === garble), tRow = qq.find(x => x.id === trunc), okRow = qq.find(x => x.id === good[0]);
check('the garble row is stamped with the dominant spelling + count 18', gRow && gRow.issuer_sibling_dominant === 'Meadowvale Dairy Wholesale' && gRow.issuer_sibling_count === 18);
check('the truncated row too', tRow && tRow.issuer_sibling_dominant === 'Meadowvale Dairy Wholesale');
check('a correct sibling is NOT stamped', okRow && !('issuer_sibling_dominant' in okRow));
delete process.env.ISSUER_SIBLING_DOMINANT_HOLD;
db.close();

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
