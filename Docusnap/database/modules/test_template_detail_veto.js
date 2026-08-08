#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_template_detail_veto.js
 * ---------------------------------------------
 * Pins the 256-bit DETAIL-HASH VETO in templates.identifyByFingerprint (Oracle SIGN OFF WITH
 * CONDITIONS 2026-07-23; kill switch TEMPLATE_LOGO_DETAIL_VETO, default ON).
 *
 * THE INCIDENT THIS GUARDS: the Review "Template available" pill named THORNBURY FASTENERS on a
 * COPPERFIELD ELECTRICAL delivery docket. The 64-bit phash's histograms have CROSSED on real
 * scans (cross-supplier 2/64 vs same-supplier drift 18/64 — no threshold exists), so the logo
 * arm may not accept alone when the 256-bit isolated-mark evidence contradicts it (measured
 * impostor 114-124/256 vs genuine drift 30-56; veto dist 72). The same decision function picks
 * the Template Wizard's SAVE TARGET and graduation's 'link' write, so this is not cosmetic.
 *
 * ANTI-REGRESSION: pin 9 names the incident — a future dev who "fixes" a missing pill by
 * restoring the logo-alone accept goes red here.
 * C1 DIVERGENCE PIN: the JS veto is the bare FAR-FROM-PICK semantic, DELIBERATELY diverging
 * from Stage-0's positive-rival logo_detail.veto_by_detail — pinned so neither side is
 * "harmonised" without a decision (see logoDetail.js header for the full rationale).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_template_detail_veto.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const templates = require('./templates');
const logoDetail = require('./logoDetail');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }
function setenv(name, v) { if (v == null) delete process.env[name]; else process.env[name] = v; }

// Fixture schema MUST carry the migration-47 detail_hash column (the documented stale-fixture
// trap: a fixture without a column production code selects makes every assertion read as a
// product regression).
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT, sample_document_id INTEGER,
      confirmed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0,
      ocr_auto_params TEXT, supplier_name TEXT);
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, fixed_locked INTEGER DEFAULT 0,
      UNIQUE(template_id, field_key));
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, detail_hash TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(template_id, phash));
  `);
  return db;
}

// 64-bit phashes (16 hex chars): the doc's mark, an impostor 2 bits away (the measured
// cross-supplier separation), and a far true-supplier hash (drift exceeds it — 18+ bits).
const DOC_PHASH      = '0000000000000000';
const IMPOSTOR_PHASH = '0000000000000003';   // 2/64 bits — inside the ≤6 accept gate
const RIGHT_PHASH    = '00000000ffffffff';   // 32/64 bits — outside the gate (drift class)

// 256-bit detail hashes (64 hex chars): agree ≈40 (inside genuine drift 30-56),
// contradict ≈120 (the measured impostor band 114-124).
const DOC_DETAIL        = '0'.repeat(64);
const AGREE_DETAIL      = 'f'.repeat(10) + '0'.repeat(54);   // dist 40
const CONTRADICT_DETAIL = 'f'.repeat(30) + '0'.repeat(34);   // dist 120

const OCR = 'copperfield electrical faraday industrial park coventry delivery docket';

function seed(db, { rightTemplate = true } = {}) {
  const impostor = templates.create(db, {
    name: 'Thornbury Fasteners', document_type_slug: 'delivery_note',
    logo_phash: IMPOSTOR_PHASH, logo_detail_hash: CONTRADICT_DETAIL,
    keyword_fingerprint: ['thornbury', 'fasteners', 'bristol', 'severn'],
  });
  let right = null;
  if (rightTemplate) {
    right = templates.create(db, {
      name: 'Copperfield Electrical', document_type_slug: 'delivery_note',
      logo_phash: RIGHT_PHASH, logo_detail_hash: AGREE_DETAIL,
      keyword_fingerprint: ['copperfield', 'electrical', 'coventry', 'faraday'],
    });
  }
  return { impostor, right };
}

function identify(db, over = {}) {
  return templates.identifyByFingerprint(db, {
    logo_phash: DOC_PHASH, ocr_text: OCR, document_type_slug: 'delivery_note',
    logo_detail_hash: DOC_DETAIL, ...over,
  });
}

function main() {
  section('0. fixture arithmetic (self-checking)');
  check('phash doc↔impostor = 2 (inside accept ≤6)', templates.hammingDistance(DOC_PHASH, IMPOSTOR_PHASH) === 2);
  check('phash doc↔right = 32 (outside accept)', templates.hammingDistance(DOC_PHASH, RIGHT_PHASH) === 32);
  check('detail doc↔contradict = 120 (impostor band)', logoDetail.detailDistance(DOC_DETAIL, CONTRADICT_DETAIL) === 120);
  check('detail doc↔agree = 40 (genuine drift band)', logoDetail.detailDistance(DOC_DETAIL, AGREE_DETAIL) === 40);

  section('1. INCIDENT SHAPE — near phash + contradicting detail ⇒ never the logo arm');
  {
    const db = makeDb(); seed(db);
    const r = identify(db);
    check('impostor logo match VETOED, keyword arm recovers the RIGHT template',
      r && r.method === 'keywords' && r.template.name === 'Copperfield Electrical');
  }

  section('2. near phash + AGREEING detail ⇒ logo accept unchanged');
  {
    const db = makeDb();
    const t = templates.create(db, {
      name: 'Thornbury Fasteners', document_type_slug: 'delivery_note',
      logo_phash: IMPOSTOR_PHASH, logo_detail_hash: AGREE_DETAIL,
      keyword_fingerprint: ['thornbury', 'fasteners', 'bristol', 'severn'],
    });
    const r = identify(db);
    check('detail within drift band → logo match stands', r && r.method === 'logo' && r.template.id === t);
  }

  section('3. fail-open — missing evidence NEVER vetoes');
  {
    const db = makeDb(); seed(db, { rightTemplate: false });
    const r1 = identify(db, { logo_detail_hash: null });
    check('null QUERY detail ⇒ logo accept (caller-not-passing / isolate-fail class)',
      r1 && r1.method === 'logo');
    const db2 = makeDb();
    templates.create(db2, {
      name: 'Thornbury Fasteners', document_type_slug: 'delivery_note',
      logo_phash: IMPOSTOR_PHASH, logo_detail_hash: null,   // detail-less template row (the 2/20 class)
      keyword_fingerprint: ['thornbury', 'fasteners', 'bristol', 'severn'],
    });
    const r2 = identify(db2);
    check('empty STORED set ⇒ logo accept (pre-mig-47 / detail-less rows)', r2 && r2.method === 'logo');
  }

  section('4. kill switch + env threshold parity');
  {
    const db = makeDb(); seed(db, { rightTemplate: false });
    setenv('TEMPLATE_LOGO_DETAIL_VETO', '0');
    const off = identify(db);
    setenv('TEMPLATE_LOGO_DETAIL_VETO', null);
    check('TEMPLATE_LOGO_DETAIL_VETO=0 ⇒ the vetoed case accepts again (OFF ⇒ byte-identical)',
      off && off.method === 'logo');
    setenv('LOGO_DETAIL_VETO_DIST', '200');
    const loose = identify(db);
    setenv('LOGO_DETAIL_VETO_DIST', '30');
    const db2 = makeDb();
    templates.create(db2, {
      name: 'Thornbury Fasteners', document_type_slug: 'delivery_note',
      logo_phash: IMPOSTOR_PHASH, logo_detail_hash: AGREE_DETAIL,   // dist 40 > 30 ⇒ vetoed now
      keyword_fingerprint: ['thornbury', 'fasteners', 'bristol', 'severn'],
    });
    const tight = identify(db2);
    setenv('LOGO_DETAIL_VETO_DIST', null);
    check('LOGO_DETAIL_VETO_DIST honoured both directions (200 → no veto at 120; 30 → veto at 40)',
      loose && loose.method === 'logo' && !(tight && tight.method === 'logo'));
  }

  section('5. null-sentinel arithmetic (the don\'t-reuse-hammingDistance decision)');
  check('length-mismatched hex ⇒ null, NOT a number (a large sentinel would wrongly veto)',
    logoDetail.detailDistance('abc', DOC_DETAIL) === null
    && logoDetail.detailDistance(null, DOC_DETAIL) === null
    && logoDetail.detailDistance('z'.repeat(64), DOC_DETAIL) === null);
  check('minOverSet skips null entries, null when nothing comparable',
    logoDetail.minOverSet(DOC_DETAIL, [null, 'short', AGREE_DETAIL]) === 40
    && logoDetail.minOverSet(DOC_DETAIL, []) === null
    && logoDetail.minOverSet(DOC_DETAIL, [null, 'short']) === null);

  section('6. C1 — deliberate Stage-0 divergence pinned');
  {
    // NO rival detail anywhere (single template in the whole DB) + query far from its set ⇒
    // the JS bare far-from-pick semantic VETOES — UNLIKE Stage-0's veto_by_detail, which needs
    // a positive rival match and would fail open here. This is the cold-supplier surface the
    // divergence exists for (see logoDetail.js); do not "harmonise" either side without a ruling.
    const db = makeDb(); seed(db, { rightTemplate: false });
    const r = identify(db);
    check('no-rival-anywhere + pick-far ⇒ VETO (bare semantic, deliberately unlike Stage-0)',
      !(r && r.method === 'logo'));
    const py = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'logo_detail.py'), 'utf8');
    check('parity tripwire: Python default is still 72 where JS defaults 72',
      py.includes("'LOGO_DETAIL_VETO_DIST', '72'") && logoDetail.vetoDist() === 72);
    const tm = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'extraction', 'template_matcher.py'), 'utf8');
    check('Stage-0 still uses veto_by_detail (the refined semantic) — divergence is two-sided',
      tm.includes('logo_detail.veto_by_detail(query_detail_hash'));
  }

  section('7. ANTI-REGRESSION — the Thornbury/Copperfield incident, permanently');
  {
    // phash distance 0 (identical corner thumbnails — even MORE confusable than the measured 2)
    // + detail ~120 ⇒ NO logo match. A future dev who restores the logo-alone accept to "fix a
    // missing pill" reopens the incident and goes red HERE.
    const db = makeDb();
    templates.create(db, {
      name: 'Thornbury Fasteners', document_type_slug: 'delivery_note',
      logo_phash: DOC_PHASH, logo_detail_hash: CONTRADICT_DETAIL,
      keyword_fingerprint: ['thornbury', 'fasteners', 'bristol', 'severn'],
    });
    const r = identify(db);
    check('phash dist 0 + detail 120 ⇒ NO logo match (incident pin)', !(r && r.method === 'logo'));
  }

  console.log(fails ? `\n${fails} FAILED` : '\nAll template detail-veto checks passed');
  process.exit(fails ? 1 : 0);
}

main();
