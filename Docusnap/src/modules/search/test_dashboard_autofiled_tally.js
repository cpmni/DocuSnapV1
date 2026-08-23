'use strict';
/*
 * test_dashboard_autofiled_tally.js — Chris round 18 card A7 (2026-08-23).
 *
 * Home's GETTING SMARTER card said "Nothing has filed by itself in the last 7 days yet." while the
 * Review strip listed 23 that had: the tally counted only the 'Auto-filed%' username, and the scope
 * sweep ("filed themselves") stamps confirmed_via='scope_sweep' under the TRIGGERING USER's name.
 *
 * Pins the query's shape at the source (the handler registers IPC on require, so the query is
 * asserted as text) and runs the same SQL against a migrated fixture: a scope-swept doc counts, a
 * human confirm does not, an import auto-file still does.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/search/test_dashboard_autofiled_tally.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8').split(CR + LF).join(LF);

console.log('source contract:');
const m = /const auto {2}= db\.prepare\(`SELECT COUNT\(\*\) c FROM documents WHERE status='confirmed' AND confirmed_at >= \? AND \(confirmed_by_username LIKE 'Auto-filed%'\$\{_hasVia \? " OR \(confirmed_via IS NOT NULL AND TRIM\(confirmed_via\) <> ''\)" : ''\}\)`\)\.get\(weekAgo\)\.c;/.exec(src);
check('the 7-day tally counts ANY machine via, not only the Auto-filed username', !!m);

console.log('\nthe query on a migrated fixture:');
const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
const mk = (username, via) => {
  const id = Number(documents.insert(db, { original_filename: 'x.pdf', folder_path: '/in', status: 'confirmed', supplier_name: 'Acme', document_type_id: 1 }).lastInsertRowid);
  db.prepare("UPDATE documents SET confirmed_at = datetime('now'), confirmed_by_username = ?, confirmed_via = ? WHERE id = ?").run(username, via, id);
  return id;
};
mk('chris', null);                       // a human confirm — never "by itself"
mk('chris', 'scope_sweep');              // filed itself after the user's confirms (the r18 case)
mk('Auto-filed (100%)', 'auto_threshold');   // an import auto-file
mk('chris', 'auto_reprocess');           // the reprocess accept door
const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
const _hasVia = !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='confirmed_via'").get();
const auto = db.prepare(`SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND confirmed_at >= ? AND (confirmed_by_username LIKE 'Auto-filed%'${_hasVia ? " OR (confirmed_via IS NOT NULL AND TRIM(confirmed_via) <> '')" : ''})`).get(weekAgo).c;
check('3 of 4 count as filed by itself (sweep + import + reprocess accept); the human confirm does not', auto === 3);
const old = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND confirmed_at >= ? AND confirmed_by_username LIKE 'Auto-filed%'").get(weekAgo).c;
check('negative control: the old username-only count saw 1 (the bug)', old === 1);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
