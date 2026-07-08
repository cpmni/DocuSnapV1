#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_scope_trust.js
 * ------------------------------------
 * Guards trust.js — the supplier-graduation SCOPE trust + per-doc STRUCTURAL safety gate
 * (the safety core for "eventual auto-file"). Proves: a scope graduates only with volume +
 * a clean correction window + every required field verifiable; a correction self-revokes it;
 * and the structural gate blocks the untyped-confidently-wrong class (item="Information")
 * while letting a genuinely clean doc through.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_scope_trust.js
 */

const Database = require('better-sqlite3');
const trust    = require('./trust');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT,
                         label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER,
                            status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              display_value TEXT, raw_value TEXT, extraction_method TEXT, validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT,
                              original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  return db;
}

function seedType(db, extraFields = []) {
  const tid = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Invoice','invoice')").run().lastInsertRowid;
  const add = (key, type, req) => db.prepare(
    'INSERT INTO fields (document_type_id, key, type, required) VALUES (?,?,?,?)').run(tid, key, type, req ? 1 : 0);
  add('supplier_name', 'text',     1);   // constant learned value (the company)
  add('invoice_date',  'date',     1);   // strict type
  add('invoice_number','text',     1);   // loose type -> relies on learned 'code' shape
  add('total',         'currency', 1);   // strict type
  add('item',          'text',     0);   // OPTIONAL free-text — the danger field
  for (const [k, t, r] of extraFields) add(k, t, r);
  return tid;
}

function seedDoc(db, tid, { supplier, when, status = 'confirmed', template = 1, conf = 100, fields = {}, notes = {}, ctos = {} }) {
  const id = db.prepare(
    'INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, template_id, overall_confidence) VALUES (?,?,?,?,?,?)'
  ).run(supplier, tid, status, when, template, conf).lastInsertRowid;
  for (const [k, v] of Object.entries(fields)) {
    db.prepare('INSERT INTO extractions (document_id, field_key, display_value, extraction_method, validation_note, corrected_to) VALUES (?,?,?,?,?,?)')
      .run(id, k, v, 'keyword', notes[k] || null, ctos[k] || null);
  }
  return id;
}

function seedCorrection(db, docId, key, from, to) {
  db.prepare('INSERT INTO corrections (document_id, field_key, original_value, corrected_value) VALUES (?,?,?,?)')
    .run(docId, key, from, to);
}

function getDoc(db, id) { return db.prepare('SELECT * FROM documents WHERE id = ?').get(id); }

// N clean confirmed Anconia invoices: constant supplier, varied date/number/total. Returns the doc ids (newest last).
function seedCleanScope(db, tid, n, supplier = 'Anconia Corp', extra = () => ({})) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    ids.push(seedDoc(db, tid, {
      supplier,
      when: `2026-06-01T10:00:${String(i).padStart(2, '0')}Z`,   // increasing → i=n is newest
      fields: {
        supplier_name:  supplier,
        invoice_date:   `0${(i % 9) + 1}-06-2026`,
        invoice_number: `INV${1000 + i}`,
        total:          `${100 + i}.50`,
        ...extra(i),
      },
    }));
  }
  return ids;
}

function main() {
  // ── 1. Pure shape classifier ────────────────────────────────────────────────
  section('1. classifyLearnedShape');
  const cls = trust.classifyLearnedShape;
  check("constant (one value)",        cls(['Anconia Corp', 'Anconia Corp', 'Anconia Corp']) === 'constant');
  check("digits",                      cls(['1', '22', '333', '4444']) === 'digits');
  check("date",                        cls(['01-06-2026', '02-07-2025', '3/8/2024', '6 Aug 2026']) === 'date');
  check("currency",                    cls(['1.50', '2,000.00', '$3.00', '110.50']) === 'currency');
  check("code",                        cls(['INV1001', 'AB2C', 'X9Y', '44102V03NL1']) === 'code');
  check("freetext (mixed word+code)",  cls(['Information', '1102V03NL1', 'erent', 'some words here']) === 'freetext');
  check("none (no samples)",           cls([]) === 'none');

  // ── 2. valueMatchesShape ────────────────────────────────────────────────────
  section('2. valueMatchesShape');
  const m = trust.valueMatchesShape;
  check("constant match (known value)",     m('Anconia Corp', 'constant', ['Anconia Corp']) === true);
  check("constant reject (unknown value)",  m('Globex Ltd',   'constant', ['Anconia Corp']) === false);
  check("code accepts a digit-bearing token", m('44102V03NL1', 'code', []) === true);
  check("code rejects a plain word",        m('Information',  'code', []) === false);
  check("freetext never matches",           m('anything',     'freetext', ['anything']) === false);
  check("empty is neutral (true)",          m('',             'freetext', []) === true);

  // ── 3. fieldVerifiable ──────────────────────────────────────────────────────
  section('3. fieldVerifiable');
  check("strict type verifiable even with no learned shape", trust.fieldVerifiable('date', 'none') === true);
  check("loose type with freetext shape NOT verifiable",     trust.fieldVerifiable('text', 'freetext') === false);
  check("loose type with code shape verifiable",             trust.fieldVerifiable('text', 'code') === true);
  check("'alphanumeric' is treated as loose (needs a shape)",trust.fieldVerifiable('alphanumeric', 'freetext') === false);

  // ── 4. scopeTrust — volume ──────────────────────────────────────────────────
  section('4. scopeTrust volume gate (W=10)');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 9);
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("9 clean confirmations → NOT trusted", t.trusted === false && t.reason === 'volume');
    check("floor stays 100 when untrusted",      t.floor === 100);
    check("reports how many more are needed",    t.needed === 1);
  }
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10);
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("10 clean confirmations → TRUSTED",    t.trusted === true && t.reason === 'ok');
    check("trusted floor is 95",                 t.floor === trust.TRUSTED_FLOOR && t.floor === 95);
  }

  // ── 5. scopeTrust — cleanliness / reversibility ─────────────────────────────
  section('5. scopeTrust cleanliness + reversibility');
  {
    const db = makeDb(); const tid = seedType(db); const ids = seedCleanScope(db, tid, 10);
    seedCorrection(db, ids[ids.length - 1], 'total', '100.00', '110.50');   // correction on the NEWEST (in-window) doc
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("a correction in the window REVOKES trust", t.trusted === false && t.reason === 'recent-correction');
  }
  {
    const db = makeDb(); const tid = seedType(db); const ids = seedCleanScope(db, tid, 11);
    seedCorrection(db, ids[0], 'total', '1.00', '99.00');   // correction on the OLDEST (outside the newest-10 window)
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("a correction OUTSIDE the window → still trusted (recovery)", t.trusted === true);
  }
  {
    const db = makeDb(); const tid = seedType(db); const ids = seedCleanScope(db, tid, 10);
    seedCorrection(db, ids[5], 'total', '110.50', '110.50');   // NO-OP correction (original == corrected)
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("a no-op correction (unchanged value) does NOT revoke", t.trusted === true);
  }

  // ── 6. scopeTrust — every required field must be verifiable ──────────────────
  section('6. scopeTrust required-field verifiability');
  {
    // Add a REQUIRED free-text 'customer' field with 10 distinct wordy values → freetext → unverifiable.
    const db = makeDb();
    const tid = seedType(db, [['customer', 'text', 1]]);
    const names = ['ACME Inc', 'Globex Ltd', 'Initech', 'Umbrella Co', 'Stark Ind',
                   'Wayne LLC', 'Oscorp', 'Hooli', 'Pied Piper', 'Soylent'];
    seedCleanScope(db, tid, 10, 'Anconia Corp', i => ({ customer: names[i - 1] }));
    const t = trust.scopeTrust(db, 'Anconia Corp', 'invoice');
    check("a required FREE-TEXT field blocks graduation", t.trusted === false && t.reason === 'unverifiable-required-field');
    check("names the offending field",                    t.field === 'customer');
  }

  // ── 7. scopeTrust — guards ──────────────────────────────────────────────────
  section('7. scopeTrust guards');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    check("empty supplier → never trusted", trust.scopeTrust(db, '', 'invoice').trusted === false);
    check("unknown doctype → never trusted", trust.scopeTrust(db, 'Anconia Corp', 'nope').trusted === false);
    check("case-insensitive supplier match", trust.scopeTrust(db, 'anconia corp', 'invoice').trusted === true);
  }

  // ── 8. docTrustGate — the structural safety gate ────────────────────────────
  section('8. docTrustGate structural safety');
  {
    const db = makeDb(); const tid = seedType(db);
    // Establish a learned corpus incl. a CLEAN 'code' shape for item, so a clean item can pass
    // but a heading word can't. (>=3 item samples so getFieldFormats emits a format.)
    seedCleanScope(db, tid, 10, 'Anconia Corp', i => (i <= 4 ? { item: `M00${i}8` } : {}));

    const cleanDoc = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-02T10:00:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV2001', total: '250.00', item: 'M0058' },
    });
    check("clean doc (template + all fields shaped) → OK", trust.docTrustGate(db, cleanDoc, 'Anconia Corp', 'invoice').ok === true);

    const noTpl = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-02T10:01:00Z', template: null,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV2002', total: '250.00' },
    });
    check("no template match → blocked", trust.docTrustGate(db, noTpl, 'Anconia Corp', 'invoice').reason === 'no-template');

    const infoDoc = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-02T10:02:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV2003', total: '250.00', item: 'Information' },
    });
    const g = trust.docTrustGate(db, infoDoc, 'Anconia Corp', 'invoice');
    check("item='Information' (untyped word) → blocked", g.ok === false && g.reason === 'unverifiable-value:item');

    const emptyItem = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-02T10:03:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV2004', total: '250.00', item: '' },
    });
    check("empty item → OK (empty is safe)", trust.docTrustGate(db, emptyItem, 'Anconia Corp', 'invoice').ok === true);

    const flagged = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-02T10:04:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV2005', total: '250.00' },
      notes:  { invoice_date: 'salvaged — please verify' },
    });
    check("a flagged field → blocked", trust.docTrustGate(db, flagged, 'Anconia Corp', 'invoice').reason === 'flagged:invoice_date');
  }

  // ── 9. STRICT_TYPES trimmed (reggie hardening) ──────────────────────────────
  section('9. STRICT_TYPES trimmed');
  check("'integer' removed",       !trust.STRICT_TYPES.has('integer'));
  check("'decimal' removed",       !trust.STRICT_TYPES.has('decimal'));
  check("'date' still strict",     trust.STRICT_TYPES.has('date'));
  check("'reference_code' strict", trust.STRICT_TYPES.has('reference_code'));

  // ── 10. validDate — calendar bounds ─────────────────────────────────────────
  section('10. validDate (calendar bounds)');
  const vd = trust.validDate;
  check("valid DD-MM-YYYY",  vd('05-06-2026') === true);
  check("valid D/M/YY",      vd('9/8/25') === true);
  check("valid YYYY-MM-DD",  vd('2026-08-09') === true);
  check("valid text month",  vd('6 Aug 2026') === true);
  check("valid leap 29 Feb", vd('29-02-2024') === true);
  check("reject day 45",     vd('45/67/8901') === false);
  check("reject month 13",   vd('13/13/2026') === false);
  check("reject 31 Feb",     vd('31/02/2026') === false);
  check("reject 00/00/0000", vd('00/00/0000') === false);

  // ── 11. docTrustGate — date calendar defence-in-depth ───────────────────────
  section('11. docTrustGate date calendar re-check');
  {
    const db = makeDb(); const tid = seedType(db);
    seedCleanScope(db, tid, 10, 'Anconia Corp');
    const badDate = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-03T10:00:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '45/67/8901', invoice_number: 'INV3001', total: '250.00' },
    });
    const g = trust.docTrustGate(db, badDate, 'Anconia Corp', 'invoice');
    check("out-of-range date (no note) → blocked", g.ok === false && g.reason === 'invalid-date:invoice_date');
    const okDate = seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-03T10:01:00Z', template: 7,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV3002', total: '250.00' },
    });
    check("valid date → OK", trust.docTrustGate(db, okDate, 'Anconia Corp', 'invoice').ok === true);
  }

  // ── 12. isAutoFileEligible — the shared predicate (Slice 3) ─────────────────
  section('12. isAutoFileEligible (graduation floor + gate)');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const mk = (conf, extra = {}) => getDoc(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-04T10:00:00Z', status: 'needs_review', template: 7, conf,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV4001', total: '250.00', ...extra },
    }));
    const e98 = trust.isAutoFileEligible(db, mk(98));
    check("trusted scope, clean 98% + template → eligible", e98.eligible === true);
    check("...effective floor is 95",                       e98.floor === 95);
    // Regression for the real-corpus PLATEAU: clean template_fixed/anchor learned reads land
    // at 95-97, which the old 98 floor rejected (graduation dead letter). They must now file.
    check("trusted scope, clean 96% (learned plateau) → eligible", trust.isAutoFileEligible(db, mk(96)).eligible === true);
    check("trusted scope, clean 95% (at the floor) → eligible",    trust.isAutoFileEligible(db, mk(95)).eligible === true);
    check("trusted scope, 94% (below the 95 floor) → NOT eligible", trust.isAutoFileEligible(db, mk(94)).eligible === false);
    check("trusted scope, 99% + item='Information' → NOT eligible (structural gate)",
      trust.isAutoFileEligible(db, mk(99, { item: 'Information' })).eligible === false);
    check("trusted scope, 99% + no template → NOT eligible",
      trust.isAutoFileEligible(db, getDoc(db, seedDoc(db, tid, {
        supplier: 'Anconia Corp', when: '2026-06-04T10:05:00Z', status: 'needs_review', template: null, conf: 99,
        fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV4009', total: '250.00' } }))).eligible === false);
  }
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 9, 'Anconia Corp');   // untrusted (9<10)
    const mk = (conf) => getDoc(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-04T10:06:00Z', status: 'needs_review', template: 7, conf,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV4010', total: '250.00' },
    }));
    check("untrusted scope, 98% → NOT eligible (floor stays 100)", trust.isAutoFileEligible(db, mk(98)).eligible === false);
    check("untrusted scope, 100% → eligible (existing 100 path, no structural gate)", trust.isAutoFileEligible(db, mk(100)).eligible === true);
  }

  // ── 13. two-site fix: a pending correction candidate (corrected_to) also blocks ─
  section('13. isAutoFileEligible blocks a corrected_to candidate');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const d = getDoc(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-04T10:07:00Z', status: 'needs_review', template: 7, conf: 99,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV4011', total: '250.00' },
      ctos: { invoice_number: 'INV4011X' },   // Stage-4.5 correction candidate, no note
    }));
    check("corrected_to candidate → NOT eligible (two-site fix)", trust.isAutoFileEligible(db, d).eligible === false);
  }

  // ── 14. autoFileEligibleIds — batch with one shared getFieldFormats ──────────
  section('14. autoFileEligibleIds (batch)');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const good = seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-05T10:00:00Z', status: 'needs_review', template: 7, conf: 98,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV5001', total: '250.00' } });
    const low = seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-05T10:01:00Z', status: 'needs_review', template: 7, conf: 90,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV5002', total: '250.00' } });
    const ids = trust.autoFileEligibleIds(db, [getDoc(db, good), getDoc(db, low)]);
    check("batch returns only the eligible (98%) id", ids.length === 1 && ids[0] === good);
  }

  // ── 15. graduation master switch + per-scope opt-out ────────────────────────
  section('15. master switch + opt-out gate');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const mk = () => getDoc(db, seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-06T10:00:00Z', status: 'needs_review', template: 7, conf: 98,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV6001', total: '250.00' } }));
    check("graduation ON (default): trusted 98% → eligible", trust.isAutoFileEligible(db, mk()).eligible === true);
    db.prepare("INSERT INTO settings (key,value) VALUES ('supplier_graduation_enabled','false')").run();
    check("master switch OFF → 98% no longer eligible (floor back to 100)", trust.isAutoFileEligible(db, mk()).eligible === false);
    db.prepare("DELETE FROM settings WHERE key='supplier_graduation_enabled'").run();
    trust.setScopeOptOut(db, 'Anconia Corp', 'invoice', true);
    check("scope opted OUT → 98% not eligible", trust.isAutoFileEligible(db, mk()).eligible === false);
    trust.setScopeOptOut(db, 'Anconia Corp', 'invoice', false);
    check("opt-out removed → 98% eligible again", trust.isAutoFileEligible(db, mk()).eligible === true);
  }

  // ── 16. listGraduatedScopes (the roster) ────────────────────────────────────
  section('16. listGraduatedScopes');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const list = trust.listGraduatedScopes(db);
    check("roster lists the graduated Anconia/invoice scope",
      list.length === 1 && list[0].supplier === 'Anconia Corp' && list[0].slug === 'invoice');
    check("roster carries the confirmed count",   list[0].confirmed_count === 10);
    check("roster shows not-opted-out by default", list[0].opted_out === false);
    seedCleanScope(db, tid, 5, 'Contoso Ltd');   // only 5 confirmed → not graduated
    check("a scope below the window is NOT in the roster",
      trust.listGraduatedScopes(db).every(s => s.supplier !== 'Contoso Ltd'));
  }

  // ── 17. IBAN + GB VAT checksums (reggie T2/T3, #9) ──────────────────────────
  section('17. IBAN + GB VAT checksums');
  check("'iban' re-promoted to strict",    trust.STRICT_TYPES.has('iban'));
  check("'vat_gb' re-promoted to strict",  trust.STRICT_TYPES.has('vat_gb'));
  check("valid IBAN passes",    trust.validIban('GB82WEST12345698765432') === true);
  check("bad-check IBAN fails",  trust.validIban('GB00WEST12345698765432') === false);
  check("valid GB VAT passes",   trust.validVatGb('GB123456782') === true);
  check("bad GB VAT fails",      trust.validVatGb('GB123456789') === false);
  {
    const db = makeDb();
    const tid = db.prepare("INSERT INTO document_types (name,slug) VALUES ('Payment','payment')").run().lastInsertRowid;
    db.prepare("INSERT INTO fields (document_type_id,key,type,required) VALUES (?,?,?,?)").run(tid, 'iban', 'iban', 0);
    const mkDoc = (iban) => {
      const id = db.prepare("INSERT INTO documents (supplier_name,document_type_id,status,confirmed_at,template_id,overall_confidence) VALUES ('Acme',?,'needs_review','2026-06-07T10:00:00Z',7,99)").run(tid).lastInsertRowid;
      db.prepare("INSERT INTO extractions (document_id,field_key,display_value) VALUES (?,?,?)").run(id, 'iban', iban);
      return id;
    };
    check("docTrustGate blocks a bad-check IBAN", trust.docTrustGate(db, mkDoc('GB00WEST12345698765432'), 'Acme', 'payment').reason === 'invalid-iban:iban');
    check("docTrustGate passes a valid IBAN",     trust.docTrustGate(db, mkDoc('GB82WEST12345698765432'), 'Acme', 'payment').ok === true);
  }

  // ── 17b. currency decimal-place consistency (reggie T4, #9) ─────────────────
  section('17b. currency decimal-place consistency');
  const HIST2DP = ['100.00', '250.00', '99.99', '12.50', '7.00', '1000.00'];   // all 2-dp, 6 samples
  check("2-dp value vs 2-dp history → consistent",       trust.currencyDpConsistent('1234.56', HIST2DP) === true);
  check("dropped-decimal 0-dp value vs 2-dp history → INCONSISTENT", trust.currencyDpConsistent('123456', HIST2DP) === false);
  check("whole-pound value vs MIXED history → allowed",  trust.currencyDpConsistent('1234', ['100', '250.00', '99', '12.50', '7', '1000']) === true);
  check("too little history (<5) → allowed",             trust.currencyDpConsistent('123456', ['100.00', '250.00']) === true);
  check("tiny 0-dp value → allowed (low blast radius)",  trust.currencyDpConsistent('5', HIST2DP) === true);
  {
    // Integration: the seeded scope's `total` history is all 2-dp (X.50), so a dropped-decimal
    // total blocks the doc while a normal 2-dp total passes.
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const cand = (total) => trust.docTrustGate(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-07T11:00:00Z', status: 'needs_review', template: 7, conf: 98,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV7', total },
    }), 'Anconia Corp', 'invoice');
    check("docTrustGate blocks a dropped-decimal total (123456)", cand('123456').reason === 'currency-dp:total');
    check("docTrustGate passes a normal 2-dp total (250.00)",     cand('250.00').ok === true);
  }

  // ── 17c. STRICT-type value re-check vs shared validation_patterns (reggie T5, #9) ──────
  section('17c. STRICT-type re-check vs shared validation_patterns');
  // Unit: the helper reads config/keyword_patterns.json validation_patterns (present in-repo).
  check("valid email matches its pattern",     trust.matchesTypePattern('email', 'a.b@example.co.uk') === true);
  check("garbage email fails its pattern",     trust.matchesTypePattern('email', 'not-an-email') === false);
  check("valid UK postcode matches",           trust.matchesTypePattern('postcode_uk', 'BT1 1HE') === true);
  check("bad UK postcode fails",               trust.matchesTypePattern('postcode_uk', 'ZZ') === false);
  check("valid percentage matches",            trust.matchesTypePattern('percentage', '20%') === true);
  check("unknown type (no pattern) → allowed", trust.matchesTypePattern('number', '123456') === true);
  {
    // Integration: an email-typed field whose value is off-pattern (no note) is blocked at the gate.
    const db = makeDb();
    const tid = db.prepare("INSERT INTO document_types (name,slug) VALUES ('Contact','contact')").run().lastInsertRowid;
    db.prepare("INSERT INTO fields (document_type_id,key,type,required) VALUES (?,?,?,?)").run(tid, 'contact_email', 'email', 0);
    const mkDoc = (val) => {
      const id = db.prepare("INSERT INTO documents (supplier_name,document_type_id,status,confirmed_at,template_id,overall_confidence) VALUES ('Acme',?,'needs_review','2026-06-07T10:00:00Z',7,98)").run(tid).lastInsertRowid;
      db.prepare("INSERT INTO extractions (document_id,field_key,display_value) VALUES (?,?,?)").run(id, 'contact_email', val);
      return id;
    };
    check("docTrustGate blocks an off-pattern email", trust.docTrustGate(db, mkDoc('bogus text'), 'Acme', 'contact').reason === 'invalid-type:contact_email');
    check("docTrustGate passes a valid email",        trust.docTrustGate(db, mkDoc('ops@acme.com'), 'Acme', 'contact').ok === true);
  }

  // ── 18. a full-100 read files gate-free even in a graduated scope (the D:\ worksheet case) ──
  section('18. 100% read skips the structural gate; the discount still gets it');
  {
    const db = makeDb();
    const tid = seedType(db, [['customer', 'text', 0]]);   // optional, legitimately-variable free-text
    const names = ['Beaumont Care Homes Ltd - Croagh', 'Beaumont - Comber', 'Beaumont - Clandeboye',
                   'ACME Inc', 'Globex Ltd', 'Initech', 'Umbrella Co', 'Stark Ind', 'Wayne LLC', 'Oscorp'];
    seedCleanScope(db, tid, 10, 'Document Solutions', i => ({ customer: names[i - 1] }));
    const mk = (conf) => getDoc(db, seedDoc(db, tid, {
      supplier: 'Document Solutions', when: '2026-06-08T10:00:00Z', status: 'needs_review', template: 7, conf,
      fields: { supplier_name: 'Document Solutions', invoice_date: '05-06-2026', invoice_number: 'INV7001', total: '250.00',
                customer: 'New Customer Ltd - Belfast' },
    }));
    const d100 = mk(100);
    check("scope graduated (variable customer is OPTIONAL, so it doesn't block graduation)",
      trust.scopeTrust(db, 'Document Solutions', 'invoice').trusted === true);
    check("docTrustGate DOES block the variable free-text customer",
      trust.docTrustGate(db, d100.id, 'Document Solutions', 'invoice').reason === 'unverifiable-value:customer');
    check("100% doc → ELIGIBLE (full read files gate-free, as pre-graduation)",
      trust.isAutoFileEligible(db, d100).eligible === true);
    check("98% doc → NOT eligible (discount → gate applies → customer blocks)",
      trust.isAutoFileEligible(db, mk(98)).eligible === false);
  }

  // ── 19. auto-file SOUNDNESS matrix (#6): refuse structurally-wrong reads at the discount ──
  // The invariant: on the graduation-discount path (sub-100), a read that is structurally wrong
  // must NOT auto-file. Plus liveness (a clean read DOES file, so the gate isn't vacuously safe),
  // and an honest note on the residual the shape gate cannot catch.
  section('19. auto-file soundness — refuse structurally-wrong reads');
  {
    const db = makeDb();
    const tid = seedType(db);
    seedCleanScope(db, tid, 10, 'Anconia Corp', i => ({ item: `M00${i}8` }));   // item learns a CODE shape
    const cand = (extra, notes) => getDoc(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-09T10:00:00Z', status: 'needs_review', template: 7, conf: 98,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV9001', total: '250.00', item: 'M0018', ...extra },
      notes: notes || {},
    }));
    const elig = d => trust.isAutoFileEligible(db, d).eligible;
    check("clean 98% read → ELIGIBLE (liveness, not vacuous)",       elig(cand({})) === true);
    check("untyped item reads a word ('Information') → REFUSED",     elig(cand({ item: 'Information' })) === false);
    check("code field reads a word ('Information') → REFUSED",       elig(cand({ invoice_number: 'Information' })) === false);
    check("out-of-range date (45/67/8901) → REFUSED",                elig(cand({ invoice_date: '45/67/8901' })) === false);
    check("a flagged field (validation_note) → REFUSED",             elig(cand({}, { total: 'please verify' })) === false);
    check("empty optional item → still ELIGIBLE (empty is safe)",    elig(cand({ item: '' })) === true);
    // Previously a documented RESIDUAL (a wrong-but-valid-SHAPE value the plain shape gate can't
    // see); now CLOSED by the currency decimal-place-consistency signal (#9/reggie T4): a 0-dp
    // total against this scope's all-2-dp learned history is a dropped-decimal 100× error → REFUSED.
    check("decimal-shifted total (123456) → REFUSED (currency dp-consistency, #9)", elig(cand({ total: '123456' })) === false);
    // The true residual now is a same-dp wrong value (e.g. 250.00 → 520.00) — a transposition that
    // keeps 2 dp; that needs cross-field maths, not a shape/dp check.
  }

  // ── 20. result-eval (#6 harness enabler): judge a REPROCESSED result via opts.extractions ──
  section('20. isAutoFileEligible via opts.extractions (reprocessed-result eval)');
  {
    const db = makeDb(); const tid = seedType(db); seedCleanScope(db, tid, 10, 'Anconia Corp');
    const doc = getDoc(db, seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-10T10:00:00Z', status: 'needs_review', template: 7, conf: 98,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV1000', total: '250.00' } }));
    const d98 = { ...doc, overall_confidence: 98 };
    const cleanEx = [
      { field_key: 'supplier_name', display_value: 'Anconia Corp' },
      { field_key: 'invoice_date',  display_value: '05-06-2026' },
      { field_key: 'invoice_number', display_value: 'INV1000' },
      { field_key: 'total',         display_value: '250.00' },
    ];
    check("reprocessed clean result → eligible",
      trust.isAutoFileEligible(db, d98, { extractions: cleanEx, templateMatched: true }).eligible === true);
    check("reprocessed result with item='Information' → blocked",
      trust.isAutoFileEligible(db, d98, { extractions: [...cleanEx, { field_key: 'item', display_value: 'Information' }], templateMatched: true }).eligible === false);
    check("reprocessed result with a flagged field → blocked",
      trust.isAutoFileEligible(db, d98, { extractions: cleanEx.map(e => e.field_key === 'total' ? { ...e, validation_note: 'verify' } : e), templateMatched: true }).eligible === false);
    check("reprocessed result with no template match → blocked",
      trust.isAutoFileEligible(db, d98, { extractions: cleanEx, templateMatched: false }).eligible === false);
  }

  // ── 21. Slice 7 — the LENIENT at100 gate on the full-100 path ────────────────
  section('21. Slice 7: at100 structural gate');
  {
    // item learns a CODE shape (M0018, M0028, …); customer is legitimately-variable free-text
    // (>2 distinct → freetext) so it must NOT block a 100% doc.
    const db = makeDb(); const tid = seedType(db, [['customer', 'text', 0]]);
    const custs = ['Beaumont Bangor', 'Beaumont Galgorm', 'Beaumont Holywood', 'Acme Ltd', 'Globex',
                   'Initech', 'Umbrella Co', 'Stark Ind', 'Wayne LLC', 'Oscorp'];
    seedCleanScope(db, tid, 10, 'Anconia Corp', i => ({ item: `M00${i}8`, customer: custs[i - 1] }));
    const at100 = (extra) => getDoc(db, seedDoc(db, tid, {
      supplier: 'Anconia Corp', when: '2026-06-11T10:00:00Z', status: 'needs_review', template: 7, conf: 100,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV9', total: '250.00', item: 'M0018', customer: 'A New Customer Ltd', ...extra },
    }));
    const elig = d => trust.isAutoFileEligible(db, d).eligible;
    // DEFAULT (strict_100_autofile OFF): a full-100 read files GATE-FREE (pre-Slice-7). The stricter
    // at100 gate over-blocked legit 100% docs in the field, so it is opt-in now.
    const eligStrict = d => trust.isAutoFileEligible(db, d, { strict100: true }).eligible;
    check("100% clean read → ELIGIBLE (liveness)",                         elig(at100({})) === true);
    check("100% variable customer (freetext) NOT blocked (no regression)", elig(at100({ customer: 'Totally Unseen Name Corp' })) === true);
    // DEFAULT OFF: the cases the at100 gate targeted now auto-file (gate-free, as pre-Slice-7).
    check("DEFAULT off: 100% item='Information' → ELIGIBLE (gate-free)",   elig(at100({ item: 'Information' })) === true);
    check("DEFAULT off: 100% bad date → ELIGIBLE (gate-free)",            elig(at100({ invoice_date: '45/67/8901' })) === true);
    // OPT-IN (strict100): the lenient at100 gate fires and blocks those.
    check("strict100 ON: 100% item='Information' → BLOCKED",               eligStrict(at100({ item: 'Information' })) === false);
    check("strict100 ON: 100% bad calendar date → BLOCKED",               eligStrict(at100({ invoice_date: '45/67/8901' })) === false);
    check("strict100 ON: 100% dropped-decimal total → BLOCKED",           eligStrict(at100({ total: '25000' })) === false);
    // Anti-regression: logo-only 100% (no template) still auto-files (no template requirement at 100).
    const noTpl = getDoc(db, seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-11T10:05:00Z', status: 'needs_review', template: null, conf: 100,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV9', total: '250.00', item: 'M0018', customer: 'X Co' } }));
    check("100% logo-only (no template) → ELIGIBLE (no template req at 100)", trust.isAutoFileEligible(db, noTpl).eligible === true);
    // A sub-100 read of the SAME item='Information' is already blocked by the full gate (regression guard).
    const at98 = getDoc(db, seedDoc(db, tid, { supplier: 'Anconia Corp', when: '2026-06-11T10:06:00Z', status: 'needs_review', template: 7, conf: 96,
      fields: { supplier_name: 'Anconia Corp', invoice_date: '05-06-2026', invoice_number: 'INV9', total: '250.00', item: 'Information', customer: 'X Co' } }));
    check("sub-100 item='Information' still BLOCKED (full gate unchanged)", trust.isAutoFileEligible(db, at98).eligible === false);
  }

  // ── 22. reggie bug fixes: VAT GD/HA form + currency ≥4-digit trigger ─────────
  section('22. VAT GD/HA + currency ≥4-digit trigger');
  check("VAT GD gov-dept form passes checksum-free",  trust.validVatGb('GBGD001') === true);
  check("VAT HA health-authority form passes",        trust.validVatGb('GBHA599') === true);
  check("VAT GD wrong length still fails",             trust.validVatGb('GBGD12') === false);
  {
    const H = ['100.00', '250.00', '99.99', '12.50', '7.00', '1000.00'];   // all 2-dp
    check("3-digit whole '250' now ALLOWED (≥4 trigger)", trust.currencyDpConsistent('250', H) === true);
    check("4-digit whole '2500' still blocked",           trust.currencyDpConsistent('2500', H) === false);
    check("dropped-decimal '38774' still blocked",        trust.currencyDpConsistent('38774', H) === false);
  }

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
