#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_logo_detail_enrol.js — Slice B: enrolment of the isolated-mark 256-bit DETAIL
 * hash (the logo-collision discriminator) ALONGSIDE each logo phash. Verifies:
 *   1. migration 47 adds documents.logo_detail_hash + logo_fingerprints.detail_hash +
 *      template_logo_hashes.detail_hash (NULL-inert);
 *   2. learning.saveLogoFingerprint stores detail_hash on INSERT, backfills it on the UPDATE branch
 *      (COALESCE — never overwriting an existing one), and getAllLogos surfaces it;
 *   3. templates.create seeds the detail hash and templates.addLogoHash stores + backfills it.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_logo_detail_enrol.js
 */
const Database = require('better-sqlite3');
const os = require('os'), path = require('path'), fs = require('fs');
const learning  = require('./learning');
const templates = require('./templates');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; }
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
const HX = (c, n = 16) => c.repeat(n);

// ── 1. Migration 47 on a fresh DB (runMigrations builds the schema + runs all migrations) ───
console.log('migration 47 — the detail-hash columns land:');
{
  const { runMigrations } = require('../index');
  const db = new Database(':memory:');
  runMigrations(db);
  check('documents.logo_detail_hash exists',            cols(db, 'documents').includes('logo_detail_hash'));
  check('logo_fingerprints.detail_hash exists',         cols(db, 'logo_fingerprints').includes('detail_hash'));
  check('template_logo_hashes.detail_hash exists',      cols(db, 'template_logo_hashes').includes('detail_hash'));
  db.close();
}

// ── in-memory schema (post-migration shape) for the enrolment-logic tests ───────────────────
function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE logo_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT NOT NULL, phash TEXT, ahash TEXT,
      detail_hash TEXT, match_count INTEGER NOT NULL DEFAULT 1, last_seen TEXT DEFAULT (datetime('now')));
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT, confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right', fixed_value TEXT,
      is_variable INTEGER DEFAULT 1, fixed_locked INTEGER DEFAULT 0, UNIQUE(template_id, field_key));
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, detail_hash TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(template_id, phash));
  `);
  return db;
}

console.log('\nlearning.saveLogoFingerprint — stores + backfills detail_hash:');
{
  const db = makeDb();
  learning.saveLogoFingerprint(db, { supplier_name: 'Acme', phash: HX('a'), ahash: HX('a'), detail_hash: HX('d', 64) });
  let r = db.prepare("SELECT detail_hash FROM logo_fingerprints WHERE supplier_name='Acme'").get();
  check('INSERT stores the detail hash', r.detail_hash === HX('d', 64));

  // A phash-only save (pre-migration-style) → NULL detail; then a re-confirm (same phash → UPDATE branch)
  // with a detail hash BACKFILLS it.
  learning.saveLogoFingerprint(db, { supplier_name: 'Beta', phash: HX('b'), ahash: HX('b'), detail_hash: null });
  check('phash-only save → NULL detail_hash',
        db.prepare("SELECT detail_hash FROM logo_fingerprints WHERE supplier_name='Beta'").get().detail_hash === null);
  learning.saveLogoFingerprint(db, { supplier_name: 'Beta', phash: HX('b'), ahash: HX('b'), detail_hash: HX('e', 64) });
  check('UPDATE branch BACKFILLS the missing detail hash',
        db.prepare("SELECT detail_hash FROM logo_fingerprints WHERE supplier_name='Beta'").get().detail_hash === HX('e', 64));
  learning.saveLogoFingerprint(db, { supplier_name: 'Beta', phash: HX('b'), ahash: HX('b'), detail_hash: HX('f', 64) });
  check('COALESCE — an EXISTING detail hash is NOT overwritten',
        db.prepare("SELECT detail_hash FROM logo_fingerprints WHERE supplier_name='Beta'").get().detail_hash === HX('e', 64));
  check('getAllLogos surfaces detail_hash', learning.getAllLogos(db).every(row => 'detail_hash' in row));
  db.close();
}

console.log('\ntemplates.create / addLogoHash — seed + store + backfill detail_hash:');
{
  const db = makeDb();
  const tid = templates.create(db, { name: 'Acme Invoice', document_type_slug: 'invoice',
    logo_phash: HX('a'), logo_detail_hash: HX('d', 64), keyword_fingerprint: ['acme'], fields: [] });
  check('create seeds the detail hash into the template set',
        db.prepare('SELECT detail_hash FROM template_logo_hashes WHERE template_id=? AND phash=?').get(tid, HX('a')).detail_hash === HX('d', 64));

  templates.addLogoHash(db, tid, HX('c'), null);          // append a phash-only ref
  check('addLogoHash phash-only → NULL detail',
        db.prepare('SELECT detail_hash FROM template_logo_hashes WHERE template_id=? AND phash=?').get(tid, HX('c')).detail_hash === null);
  templates.addLogoHash(db, tid, HX('c'), HX('g', 64));   // same phash + a detail hash → backfill
  check('addLogoHash BACKFILLS the detail hash onto an existing phash row',
        db.prepare('SELECT detail_hash FROM template_logo_hashes WHERE template_id=? AND phash=?').get(tid, HX('c')).detail_hash === HX('g', 64));
  db.close();
}

// ── C2(i) [Slice-1d DO-NOTHING ledger 2026-07-24] — the Store-B detail write is UNCONDITIONAL ────────
// The whole do-nothing verdict RESTS on template_logo_hashes.detail_hash accruing at confirm-time
// REGARDLESS of LOGO_DETAIL_ENROL (that flag gates ONLY Store A = logo_fingerprints, at
// processing/handler.js). The confirm call-site is review/handler.js -> templates.create/update ->
// addLogoHash. If a "consistency" refactor ever gates THIS write behind LOGO_DETAIL_ENROL, the LIVE
// Stage-0 detail veto silently starves — this pin goes RED first.
console.log('\nC2(i) — Store-B detail write is UNCONDITIONAL (not gated by LOGO_DETAIL_ENROL):');
{
  for (const envVal of ['0', undefined]) {
    const prev = process.env.LOGO_DETAIL_ENROL;
    if (envVal === undefined) delete process.env.LOGO_DETAIL_ENROL; else process.env.LOGO_DETAIL_ENROL = envVal;
    const db = makeDb();
    const tid = templates.create(db, { name: 'Z', document_type_slug: 'invoice', logo_phash: HX('1'),
      logo_detail_hash: HX('d', 64), keyword_fingerprint: [], fields: [] });
    check(`create writes Store-B detail_hash with LOGO_DETAIL_ENROL=${envVal}`,
      db.prepare('SELECT detail_hash FROM template_logo_hashes WHERE template_id=? AND phash=?').get(tid, HX('1')).detail_hash === HX('d', 64));
    templates.addLogoHash(db, tid, HX('2'), HX('e', 64));
    check(`addLogoHash writes Store-B detail_hash with LOGO_DETAIL_ENROL=${envVal}`,
      db.prepare('SELECT detail_hash FROM template_logo_hashes WHERE template_id=? AND phash=?').get(tid, HX('2')).detail_hash === HX('e', 64));
    db.close();
    if (prev === undefined) delete process.env.LOGO_DETAIL_ENROL; else process.env.LOGO_DETAIL_ENROL = prev;
  }
}

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
