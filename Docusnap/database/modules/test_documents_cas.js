#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_documents_cas.js
 * --------------------------------------
 * Phase 1 of the multi-user review concurrency guard. A plain confirm() is an unconditional
 * UPDATE, so two writers (two clients, a client vs the desktop, or the auto-file vs a manual
 * confirm) could both "win" and double-file. confirmIfReviewable/deferIfReviewable/
 * restoreIfDeferred are status-guarded compare-and-set: the SECOND writer of the same row
 * gets changes===0 and can respond cleanly ("already filed by <name>"). Also checks the new
 * documents.confirmed_by_username column (migration 41) records WHO filed it (incl. the
 * 'Auto-filed (100%)' sentinel for the backend 100%-confidence auto-file).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_documents_cas.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
const get = (db, id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
const newDoc = (db, status = 'needs_review') =>
  Number(documents.insert(db, { original_filename: 'scan.pdf', folder_path: '/in', status }).lastInsertRowid);

const db = new Database(':memory:');
runMigrations(db);

// ── Migration 41: the column exists ────────────────────────────────────────────
const cols = db.prepare('PRAGMA table_info(documents)').all().map(c => c.name);
check('migration 41: documents.confirmed_by_username column exists', cols.includes('confirmed_by_username'));

// ── confirmIfReviewable: first wins, second is a no-op (the race) ───────────────
const d1 = newDoc(db);
const r1 = documents.confirmIfReviewable(db, d1, { stored_filename: 'a.pdf', stored_path: '/out/a.pdf', confirmed_by_username: 'sarah' });
check('first confirm changes = 1', r1.changes === 1);
check('  → status confirmed', get(db, d1).status === 'confirmed');
check('  → confirmed_by_username = sarah', get(db, d1).confirmed_by_username === 'sarah');
check('  → stored_path persisted', get(db, d1).stored_path === '/out/a.pdf');

const r2 = documents.confirmIfReviewable(db, d1, { stored_filename: 'b.pdf', stored_path: '/out/b.pdf', confirmed_by_username: 'bob' });
check('second confirm changes = 0 (lost the race)', r2.changes === 0);
check('  → confirmed_by_username still sarah (not clobbered)', get(db, d1).confirmed_by_username === 'sarah');
check('  → stored_path still a.pdf', get(db, d1).stored_path === '/out/a.pdf');

// ── allowRefile: the desktop re-file path may re-confirm an already-confirmed doc ──
const r3 = documents.confirmIfReviewable(db, d1, { stored_filename: 'c.pdf', stored_path: '/out/c.pdf', confirmed_by_username: 'sarah', allowRefile: true });
check('re-file with allowRefile changes = 1', r3.changes === 1);
check('  → stored_path updated to c.pdf', get(db, d1).stored_path === '/out/c.pdf');

// ── claim-before-file shape: stored_* may be null on claim, filled in later ──────
const d2 = newDoc(db);
const rc = documents.confirmIfReviewable(db, d2, { confirmed_by_username: 'Auto-filed (100%)' });
check('claim with null stored changes = 1', rc.changes === 1);
check('  → confirmed with the auto-file sentinel', get(db, d2).confirmed_by_username === 'Auto-filed (100%)');
check('  → stored_path null until filing fills it', get(db, d2).stored_path === null);

// ── deferIfReviewable: only from needs_review ───────────────────────────────────
const d3 = newDoc(db);
check('defer a needs_review doc changes = 1', documents.deferIfReviewable(db, d3).changes === 1);
check('  → status deferred', get(db, d3).status === 'deferred');
check('defer again changes = 0 (no longer needs_review)', documents.deferIfReviewable(db, d3).changes === 0);

// ── restoreIfDeferred: only from deferred ───────────────────────────────────────
check('restore the deferred doc changes = 1', documents.restoreIfDeferred(db, d3).changes === 1);
check('  → status needs_review', get(db, d3).status === 'needs_review');
check('restore again changes = 0 (no longer deferred)', documents.restoreIfDeferred(db, d3).changes === 0);
check('a confirmed doc cannot be deferred', documents.deferIfReviewable(db, d1).changes === 0);

// ── confirm() still works and now records confirmed_by_username ─────────────────
const d4 = newDoc(db);
documents.confirm(db, d4, { stored_filename: 'd.pdf', stored_path: '/out/d.pdf', confirmed_by_username: 'karen' });
check('confirm() records confirmed_by_username', get(db, d4).confirmed_by_username === 'karen');
const d5 = newDoc(db);
documents.confirm(db, d5, { stored_filename: 'e.pdf', stored_path: '/out/e.pdf' });
check('confirm() without the arg leaves it null (back-compat)', get(db, d5).confirmed_by_username === null);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
