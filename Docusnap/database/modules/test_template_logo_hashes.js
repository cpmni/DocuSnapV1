#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_template_logo_hashes.js
 * ----------------------------------------------
 * Multi-reference logo phash (migration 26): a template carries a SET of logo
 * hashes; matching takes the MIN distance; confirms APPEND drifted-but-related
 * hashes (within band, not near-dupes) so the set converges and a future scan
 * resolves directly — instead of spawning a near-duplicate template.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_template_logo_hashes.js
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

// Hashes built so popcount(diff from H0) is exact: 'f'=4 bits, '7'=3, '3'=2, '1'=1.
const H0   = '0000000000000000';
const H2   = '0000000000000003';   // dist(H0)=2
const H9   = '0000000000000777';   // dist(H0)=9   (convergence band, 7-13)
const H20  = 'fffff00000000000';   // dist(H0)=20, and FAR from H9 (high nibbles vs H9's low) -> beyond net for the whole set
const KW   = ['acme', 'invoice', 'total'];

function main() {
  let f = 0;
  const db = makeDb();

  // distances are what the design assumes
  f += !check('fixture dist(H0,H9)=9',  templates.hammingDistance(H0, H9) === 9);
  f += !check('fixture dist(H0,H2)=2',  templates.hammingDistance(H0, H2) === 2);
  f += !check('fixture dist(H0,H20)=20', templates.hammingDistance(H0, H20) === 20);

  // create() seeds the reference set with the primary.
  const A = templates.create(db, { name: 'Acme Invoice', document_type_slug: 'invoice',
    logo_phash: H0, keyword_fingerprint: KW });
  f += !check('create seeds one logo hash', JSON.stringify(templates.getLogoHashes(db, A)) === JSON.stringify([H0]));
  templates.addLogoHash(db, A, H0);
  f += !check('addLogoHash dedups via UNIQUE', templates.getLogoHashes(db, A).length === 1);

  // findByLogoHash takes the MIN over the set; a 9-bit drift is a candidate (<=13)
  // but BELOW the strict accept gate (conf<60).
  const m9 = templates.findByLogoHash(db, H9);
  f += !check('findByLogoHash finds A for a 9-bit drift', m9 && m9.id === A);
  f += !check('match_distance is the min (9), conf 46 (<60 strict gate)', m9 && m9.match_distance === 9 && m9.confidence === 46);

  // keyword overlap (the convergence over-merge guard).
  f += !check('keywordOverlap same-supplier high', Math.abs(templates.keywordOverlap(['acme','invoice'], KW) - 2/3) < 1e-9);
  f += !check('keywordOverlap different-supplier 0', templates.keywordOverlap(['x','y'], KW) === 0);

  // CONVERGENCE: a confirm of the drifted scan (update) APPENDS H9 → set converges.
  templates.update(db, A, { logo_phash: H9, keyword_fingerprint: KW, fields: [] });
  f += !check('update appended the drifted hash (set now 2)', templates.getLogoHashes(db, A).length === 2);
  const m9b = templates.findByLogoHash(db, H9);
  f += !check('after convergence the drifted scan resolves at dist 0 (conf 100)',
    m9b && m9b.id === A && m9b.match_distance === 0 && m9b.confidence === 100);

  // DEDUP_FLOOR: a near-identical re-render (dist 2 <= floor) is NOT appended.
  templates.update(db, A, { logo_phash: H2, keyword_fingerprint: KW, fields: [] });
  f += !check('update does NOT append a near-duplicate (dist<=2)', templates.getLogoHashes(db, A).length === 2);

  // Beyond the candidate net → not a match at all.
  f += !check('a 20-bit-distant hash does not match', templates.findByLogoHash(db, H20) === null);

  // CAP 8 + eviction: add 8 more distinct in-band hashes; set caps at 8, primary kept.
  const C = templates.create(db, { name: 'Cap T', document_type_slug: 'invoice', logo_phash: H0 });
  for (let i = 1; i <= 10; i++) {
    // distinct hashes within the band: vary the low nibbles, popcount small.
    templates.addLogoHash(db, C, '00000000000000' + i.toString(16).padStart(2, '0'));
  }
  const capSet = templates.getLogoHashes(db, C);
  f += !check('reference set capped at 8', capSet.length === 8);
  f += !check('the seed/primary hash is never evicted', capSet.includes(H0));

  db.close();
  console.log(f ? `\n${f} FAILED` : '\nAll logo-hash multi-reference checks passed');
  process.exit(f ? 1 : 0);
}

main();
