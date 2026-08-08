#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_enrich_identity.js
 * ----------------------------------------
 * Slice 1 (learn-on-commit) — pins templates.enrichIdentity, the count-free /
 * field-free identity-convergence step extracted from templates.update().
 *
 * Guards THREE things:
 *   1. update() is BYTE-IDENTICAL after the refactor — it still bumps
 *      confirmed_count, SEEDS a primary logo when empty, and appends a drifted
 *      hash (the taught-confirm path, appendLogoOnly = false).
 *   2. enrichIdentity INTERSECTS the keyword fingerprint (strips customer-token
 *      pollution — the real Copperfield healer) and never bumps confirmed_count.
 *   3. Oracle C-A: enrichIdentity({appendLogoOnly:true}) NEVER seeds a NEW primary
 *      logo — a keyword-only template (logo withheld on a cross-supplier collision)
 *      is left with NO logo at all — but DOES enrich a template that already has one.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_enrich_identity.js
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT, supplier_name TEXT
    );
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, detail_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(template_id, phash)
    );
  `);
  return db;
}

// popcount(diff from H0): 'f'=4 bits, '7'=3, '3'=2, '1'=1.
const H0 = '0000000000000000';
const H9 = '0000000000000777';   // dist(H0)=9  (convergence band 3-13)
function count(db, id) { return db.prepare('SELECT confirmed_count AS c FROM templates WHERE id = ?').get(id).c; }
function phash(db, id) { return db.prepare('SELECT logo_phash AS p FROM templates WHERE id = ?').get(id).p; }
function fp(db, id)    { return JSON.parse(db.prepare('SELECT keyword_fingerprint AS f FROM templates WHERE id = ?').get(id).f || '[]'); }

function main() {
  let f = 0;
  const db = makeDb();

  // ── 1. update() BYTE-IDENTICAL: bumps count + SEEDS a primary when empty ─────
  // A keyword-only template (logo withheld) — the exact C3 graduation shape.
  const A = templates.create(db, { name: 'Acme KW-only', document_type_slug: 'invoice',
    keyword_fingerprint: ['acme', 'ltd', 'invoice', 'total', 'sandpiper', 'hotels'] });
  f += !check('create() of a keyword-only template leaves logo_phash NULL', phash(db, A) == null);
  f += !check('create() seeds NO logo-hash row',                            templates.getLogoHashes(db, A).length === 0);

  templates.update(db, A, { logo_phash: H0, keyword_fingerprint: ['acme', 'ltd', 'invoice', 'total'], fields: [] });
  f += !check('update() bumps confirmed_count',                     count(db, A) === 1);
  f += !check('update() (taught path) SEEDS the primary logo',      phash(db, A) === H0);
  f += !check('update() seeds the primary into the hash set',       JSON.stringify(templates.getLogoHashes(db, A)) === JSON.stringify([H0]));
  f += !check('update() intersects the fingerprint (pollution gone)',
    JSON.stringify(fp(db, A)) === JSON.stringify(['acme', 'ltd', 'invoice', 'total']));

  // ── 2. enrichIdentity INTERSECTS + is COUNT-FREE ─────────────────────────────
  // Re-pollute via a fresh template, then heal with a clean incoming fingerprint.
  const B = templates.create(db, { name: 'Beta', document_type_slug: 'purchase_order', logo_phash: H0,
    keyword_fingerprint: ['beta', 'purchase', 'order', 'ref', 'sandpiper', 'hotels'] });
  const c0 = count(db, B);
  templates.enrichIdentity(db, B, { keyword_fingerprint: ['beta', 'purchase', 'order', 'ref', 'widgets'] });
  f += !check('enrichIdentity intersects (customer tokens dropped)',
    JSON.stringify(fp(db, B)) === JSON.stringify(['beta', 'purchase', 'order', 'ref']));
  f += !check('enrichIdentity does NOT bump confirmed_count (count-free)', count(db, B) === c0);

  // ── 3. Oracle C-A: appendLogoOnly NEVER seeds a NEW primary ──────────────────
  // A keyword-only template (no primary) — the withheld-logo C3 danger zone.
  const K = templates.create(db, { name: 'Kw Only', document_type_slug: 'purchase_order',
    keyword_fingerprint: ['kw', 'only', 'template'] });
  templates.enrichIdentity(db, K, { logo_phash: H0, appendLogoOnly: true,
    keyword_fingerprint: ['kw', 'only', 'template', 'extra'] });
  f += !check('C-A: appendLogoOnly leaves a null primary NULL (no seed)', phash(db, K) == null);
  f += !check('C-A: appendLogoOnly seeds NO hash-set row on a logo-less template',
    templates.getLogoHashes(db, K).length === 0);

  // …but appendLogoOnly DOES enrich a template that ALREADY carries a primary.
  const L = templates.create(db, { name: 'Has Logo', document_type_slug: 'purchase_order',
    logo_phash: H0, keyword_fingerprint: ['has', 'logo', 'template'] });
  const lc0 = count(db, L);
  templates.enrichIdentity(db, L, { logo_phash: H9, appendLogoOnly: true,
    keyword_fingerprint: ['has', 'logo', 'template'] });
  const lset = templates.getLogoHashes(db, L);
  f += !check('C-A: appendLogoOnly APPENDS a drifted hash when a primary exists', lset.length === 2 && lset.includes(H9));
  f += !check('C-A: the existing primary logo is unchanged',                      phash(db, L) === H0);
  f += !check('C-A: appendLogoOnly is still count-free',                          count(db, L) === lc0);

  db.close();
  console.log(f ? `\n${f} FAILED` : '\nAll enrichIdentity / C-A checks passed');
  process.exit(f ? 1 : 0);
}

main();
