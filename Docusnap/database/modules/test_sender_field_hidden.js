#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_sender_field_hidden.js
 * --------------------------------------------
 * ORACLE C3 PIN (2026-08-12, sender-field editor sign-off): the hidden-field WRITE set is computed
 * by the SAME exported resolver as the display READ (resolveVisibilityTemplateIds — single scope
 * authority), PLUS the doc's matched template id (the display union seeds doc.template_id OUTSIDE
 * the resolver — review/handler.js get-document-with-extractions — so a resolver-only un-hide would
 * visibly no-op on a garble-named matched sibling, exactly the doc the user is looking at).
 *
 * Pins:
 *  1. Resolver includes the exact-name template AND the containment sibling ("Office Interiors" ⊂
 *     "Pelican Office Interiors") — the ACCEPTED cross-sender residual (owner ruling 2026-07-27,
 *     re-accepted Oracle 2026-08-12). Do NOT "fix" containment out — that turns "Show again" into a
 *     visible no-op whenever config lives on a nested-name sibling.
 *  2. Resolver includes GROUP siblings; excludes other senders and other types.
 *  3. Un-hide over (resolver ∪ matched id) clears EVERY copy of the row — including the garble-named
 *     matched template the resolver cannot name-match — while an unrelated sender's row survives.
 *  4. getHiddenFieldsForSupplierType (the display union) consumes the SAME resolver: a hide left on
 *     ANY resolved sibling still surfaces in the union.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_sender_field_hidden.js
 */

const Database = require('better-sqlite3');
const templates = require('./templates');

let fails = 0;
function check(label, cond, extra) {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT,
    document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT, confirmed_count INTEGER DEFAULT 0,
    group_id INTEGER, sample_document_id INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE template_hidden_fields (template_id INTEGER NOT NULL, field_key TEXT NOT NULL,
    PRIMARY KEY (template_id, field_key));
`);

const ins = db.prepare('INSERT INTO templates (name, document_type_slug, group_id, confirmed_count) VALUES (?, ?, ?, ?)');
const A = ins.run('Pelican Office Interiors', 'invoice', null, 5).lastInsertRowid;   // exact-name canonical
const B = ins.run('Office Interiors',         'invoice', null, 1).lastInsertRowid;   // containment sibling (pinned residual)
const C = ins.run('Reg No GB 903',            'invoice', null, 0).lastInsertRowid;   // garble-named — only reachable as doc.template_id
const D = ins.run('Meadowvale Dairy',         'invoice', null, 3).lastInsertRowid;   // other sender — must survive untouched
const E = ins.run('Pelican OI (dup)',         'invoice', 7,    0).lastInsertRowid;   // group sibling of A
db.prepare('UPDATE templates SET group_id = 7 WHERE id = ?').run(A);
const F = ins.run('Pelican Office Interiors', 'quote',   null, 2).lastInsertRowid;   // same sender, OTHER type — out of scope

console.log('\n1+2. Resolver membership (single scope authority)');
const ids = templates.resolveVisibilityTemplateIds(db, {
  supplier_name: 'Pelican Office Interiors', document_type_slug: 'invoice' });
check('exact-name template A resolved', ids.has(A));
check('containment sibling B resolved (ACCEPTED residual — do not fix into a no-op)', ids.has(B));
check('group sibling E resolved (group_id activation)', ids.has(E));
check('garble-named C NOT name-resolved (why the write-set must add doc.template_id)', !ids.has(C));
check('other sender D not resolved', !ids.has(D));
check('same sender, other TYPE (F) not resolved', !ids.has(F));

console.log('\n3. Union un-hide clears every copy incl. the matched garble sibling; other senders survive');
const KEY = 'serials';
for (const id of [A, B, C, D]) {
  db.prepare('INSERT OR IGNORE INTO template_hidden_fields (template_id, field_key) VALUES (?, ?)').run(id, KEY);
}
// The IPC's write-set rule: resolver ids ∪ the doc's matched template (C here).
const writeSet = new Set(ids); writeSet.add(C);
for (const id of writeSet) templates.setHiddenField(db, id, KEY, false);
const left = db.prepare('SELECT template_id FROM template_hidden_fields WHERE field_key = ?').all(KEY).map(r => r.template_id);
check('A cleared', !left.includes(A));
check('B (containment sibling) cleared', !left.includes(B));
check('C (matched garble sibling) cleared — the row the resolver alone would leave', !left.includes(C));
check("D (other sender) still hidden — un-hide never clobbers another sender's config", left.includes(D));

console.log('\n4. Display union consumes the SAME resolver (read/write cannot drift)');
db.prepare('INSERT OR IGNORE INTO template_hidden_fields (template_id, field_key) VALUES (?, ?)').run(B, 'po_ref');
const union = templates.getHiddenFieldsForSupplierType(db, {
  supplier_name: 'Pelican Office Interiors', document_type_slug: 'invoice' });
check('a hide on the containment sibling surfaces in the display union', union.includes('po_ref'), JSON.stringify(union));

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
