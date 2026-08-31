#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_seed_support_prune.js
 * -------------------------------------------
 * Q2 of the Chris round-14 queue — the ONE-SAMPLE SEED SUPPORT PRUNE (measured → Oracle SIGN-OFF-
 * W/COND C1–C9, 2026-08-22; docs/oracle_log.md "Q2 RE-RULE"). A template born from one document
 * freezes that document's fingerprint; three OCR-garble tokens capped every sibling at 0.70 < 0.75
 * so the teach-time quiet re-read selected 0. The prune drops seed tokens with document-frequency 0
 * over the install's other documents, guarded by G1 issuer-protect, G2 reward licence (≥2 recovered
 * held siblings, no contradicting claim), FLOOR and an all-or-nothing HALF-CAP. DARK.
 *
 * Pins i–ix (Oracle C6) + the end-to-end selection/binding effect.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_seed_support_prune.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const templates = require('./templates');
const learning = require('./learning');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

const SEED = ['SERVICE', 'WORKSHEET', 'Lol', 'DOCUMENT', 'OLUTIONS', 'ILa', 'Ticket', 'Location', 'Work', 'Address'];
const SIB_TEXT = 'SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS\nTicket    Location\nTicket No.    2601-0371-1    Work Address    Beaumont Care Homes Ltd\n';
const SEED_TEXT = 'SERVICE WORKSHEET\nLol O02)\nDOCUMENT OLUTIONS    nO Oe\nTL    ILa*\nTicket    Location\nTicket No.    2601-0195-1    Work Address    Beaumont Care Homes\n';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Service Worksheet', 'service_worksheet', 0)").run();
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (2, 'Invoice', 'invoice', 1)").run();
  return db;
}
// a held doc's own top-band fingerprint defaults to its first line's tokens (the harvest shape)
function mkDoc(db, { text, status = 'needs_review', typeId = null, template = null, supplier = null, supVal = null, supMethod = 'keyword', fp = null }) {
  const id = Number(documents.insert(db, { original_filename: 'x.pdf', folder_path: '/in', status, supplier_name: supplier, document_type_id: typeId, template_id: template }).lastInsertRowid);
  const ownFp = fp || (String(text || '').split('\n').slice(0, 5).join(' ').match(/[A-Za-z]{3,}/g) || []).slice(0, 10);
  db.prepare('UPDATE documents SET ocr_text = ?, keyword_fingerprint = ? WHERE id = ?').run(text, JSON.stringify(ownFp), id);
  if (supVal) db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'supplier_name', ?, ?, 80, ?)").run(id, supVal, supVal, supMethod);
  return id;
}

console.log('§i the exhibit: the worst-scan seed prunes to 7 tokens, licensed by the recovered siblings');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: SEED_TEXT, status: 'confirmed', typeId: 1, supplier: 'DOCUMENT SOLUTIONS' });
  const sibs = []; for (let i = 0; i < 6; i++) sibs.push(mkDoc(db, { text: SIB_TEXT }));   // held, untyped, template-less, unnamed
  const r = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('dropped exactly the three garble tokens', r.dropped.join() === 'Lol,OLUTIONS,ILa' && r.reason === 'pruned');
  check('kept the seven supported tokens in order', r.fingerprint.join() === 'SERVICE,WORKSHEET,DOCUMENT,Ticket,Location,Work,Address');
  check('licensed by ≥2 recovered held siblings (' + r.recovered + ')', r.recovered >= 2);
  // end to end: the raw seed reaches no sibling at 0.75, the pruned one reaches them all
  const tRaw = templates.create(db, { name: 'raw', document_type_slug: 'service_worksheet', keyword_fingerprint: SEED, fields: [] });
  let hitRaw = 0; for (const id of sibs) if (templates.findByKeywordFingerprint(db, db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(id).ocr_text, templates.KEYWORD_THRESHOLD, 'service_worksheet')) hitRaw++;
  db.prepare('UPDATE templates SET keyword_fingerprint = ? WHERE id = ?').run(JSON.stringify(r.fingerprint), tRaw);
  let hitPruned = 0; for (const id of sibs) if (templates.findByKeywordFingerprint(db, db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(id).ocr_text, templates.KEYWORD_THRESHOLD, 'service_worksheet')) hitPruned++;
  check(`the matcher's keyword arm: raw seed ${hitRaw}/6 siblings, pruned ${hitPruned}/6 (the selection AND binding gap)`, hitRaw === 0 && hitPruned === 6);
  // ix — the trade-off: a later intersection never re-admits a pruned token (accepted: G2 only prunes tokens absent on ≥2 recovered siblings)
  const later = templates.stabiliseFingerprint(r.fingerprint, SEED);
  check('ix: stabiliseFingerprint(pruned, a later sample carrying the garble) never re-admits it', !later.includes('Lol') && !later.includes('OLUTIONS'));
}

console.log('§ii an install with no other documents keeps the raw seed');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: SEED_TEXT, status: 'confirmed', typeId: 1 });
  const r = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('raw kept (every token has df 0 → nothing survives the floor) — ' + r.reason, r.fingerprint.join() === SEED.join() && r.dropped.length === 0 && (r.reason === 'floor' || r.reason === 'half-cap'));
}

console.log('§iii G1 issuer-protect: a first-of-its-kind brand token with no sibling is never pruned');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: 'VELTRIX AUTOMOTIVE PARTS\nInvoice\nTotal\nVAT\n', status: 'confirmed', typeId: 2 });
  for (let i = 0; i < 3; i++) mkDoc(db, { text: 'AUTOMOTIVE PARTS Invoice Total VAT Garage Road\n' });   // other docs share every token but the brand
  const r = templates.pruneSeedFingerprint(db, ['Veltrix', 'Automotive', 'Parts', 'Invoice', 'Total', 'VAT'], { docId: seedDoc, issuer: 'Veltrix Ltd', typeId: 2, enabled: true });
  check("'Veltrix' (df 0) survives because it token-matches the issuer — " + r.reason, r.fingerprint.includes('Veltrix') && r.dropped.length === 0);
  const r2 = templates.pruneSeedFingerprint(db, ['Veltrix', 'Automotive', 'Parts', 'Invoice', 'Total', 'VAT'], { docId: seedDoc, issuer: 'Unrelated Co', typeId: 2, enabled: true });
  check('positive control: with a different issuer the same token IS a prune candidate (then G2 decides: ' + r2.reason + ')', r2.reason !== 'all-supported');
}

console.log('§iv G2 reward licence — negative control: a garble token with NOTHING to recover keeps the raw seed');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: SEED_TEXT, status: 'confirmed', typeId: 1 });
  mkDoc(db, { text: 'Ticket Location Work Address SERVICE WORKSHEET DOCUMENT\n', status: 'confirmed', typeId: 1 });   // confirmed — not in the held pool
  const r = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('raw kept — ' + r.reason, r.fingerprint.join() === SEED.join() && /^unlicensed:0$/.test(r.reason));
  mkDoc(db, { text: SIB_TEXT });                                                                            // ONE held sibling — still short of 2
  const r1 = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('one recovered sibling is not a licence — ' + r1.reason, r1.reason === 'unlicensed:1');
  mkDoc(db, { text: SIB_TEXT });
  const r2 = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('two recovered siblings license it', r2.reason === 'pruned' && r2.recovered === 2);
}

console.log('§v G2 contradiction: a recovered doc carrying ANOTHER sender\'s non-prefill claim refuses the prune');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: SEED_TEXT, status: 'confirmed', typeId: 1 });
  mkDoc(db, { text: SIB_TEXT }); mkDoc(db, { text: SIB_TEXT });
  mkDoc(db, { text: SIB_TEXT, supVal: 'Bolt Fasteners Ltd', supMethod: 'keyword' });
  const r = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('raw kept — ' + r.reason, r.dropped.length === 0 && /^contradiction:\d+$/.test(r.reason));
  const db2 = fresh();
  const s2 = mkDoc(db2, { text: SEED_TEXT, status: 'confirmed', typeId: 1 });
  mkDoc(db2, { text: SIB_TEXT }); mkDoc(db2, { text: SIB_TEXT });
  mkDoc(db2, { text: SIB_TEXT, supVal: 'Patrick', supMethod: 'letterhead_prefill' });
  const r2 = templates.pruneSeedFingerprint(db2, SEED, { docId: s2, issuer: 'DOCUMENT SOLUTIONS', typeId: 1, enabled: true });
  check('a cold-start PREFILL ("Patrick") is not a sender claim — still licensed', r2.reason === 'pruned');
}

console.log('§v-b G2 same-layout evidence: a doc that merely MENTIONS the seed tokens in its body (the buyer-issued class) does not license');
{
  const db = fresh();
  const BUYER = ['Bramblewood', 'Joinery', 'Ltd', 'PURCHASE', 'Unit', 'Sawpit', 'Lane', 'Xq', 'Zz', 'Tel'];   // three garble tokens → raw reaches nothing
  const seedDoc = mkDoc(db, { text: 'Bramblewood Joinery Ltd\nPURCHASE ORDER\nUnit 4 Sawpit Lane Draymarket SSS\nTel 0123\n', status: 'confirmed', typeId: 2 });
  // other suppliers' cold documents: their OWN letterhead at the top, the buyer's block in the body
  for (let i = 0; i < 4; i++) mkDoc(db, { text: `HARROWGATE TIMBER SUPPLIES\nSALES ORDER\nBill To: Bramblewood Joinery Ltd Unit 4 Sawpit Lane Draymarket SSS PURCHASE order ref\n` });
  const r = templates.pruneSeedFingerprint(db, BUYER, { docId: seedDoc, issuer: 'Bramblewood Joinery Ltd', typeId: 2, enabled: true });
  check("'Tel' (df 0) is a candidate but the recovered docs are OTHER layouts (buyer block in the body) → raw kept — " + r.reason, r.dropped.length === 0 && /^unlicensed/.test(r.reason));
  // control: the same tokens in the recovered docs' OWN top band DO license
  const db2 = fresh();
  const s2 = mkDoc(db2, { text: 'Bramblewood Joinery Ltd\nPURCHASE ORDER\nUnit 4 Sawpit Lane Draymarket SSS\nTel 0123\n', status: 'confirmed', typeId: 2 });
  for (let i = 0; i < 4; i++) mkDoc(db2, { text: 'Bramblewood Joinery Ltd\nPURCHASE ORDER\nUnit 4 Sawpit Lane Draymarket SSS\n' });
  const r2 = templates.pruneSeedFingerprint(db2, BUYER, { docId: s2, issuer: 'Bramblewood Joinery Ltd', typeId: 2, enabled: true });
  check('positive control: same-layout siblings (tokens in their own band) license the prune — ' + r2.reason, r2.reason === 'pruned' && r2.dropped.join() === 'Xq,Zz,Tel');
}

console.log('§vi half-cap is all-or-nothing; floor');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: 'xx', status: 'confirmed', typeId: 1 });
  for (let i = 0; i < 3; i++) mkDoc(db, { text: 'Ticket Location Work Address\n' });
  const r = templates.pruneSeedFingerprint(db, ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'Ticket', 'Location', 'Work', 'Address'], { docId: seedDoc, issuer: 'X', typeId: 1, enabled: true });
  check('6 of 10 unsupported → raw kept (' + r.reason + '), no partial prune', r.reason === 'half-cap' && r.fingerprint.length === 10);
  const r2 = templates.pruneSeedFingerprint(db, ['J1', 'J2', 'Ticket', 'Location'], { docId: seedDoc, issuer: 'X', typeId: 1, enabled: true });
  check('a short seed (≤ floor+1) is never pruned (' + r2.reason + ')', r2.fingerprint.length === 4 && r2.dropped.length === 0);
}

console.log('§vii OFF is byte-identical (setting default, env both ways)');
{
  const db = fresh();
  const seedDoc = mkDoc(db, { text: SEED_TEXT, status: 'confirmed', typeId: 1 });
  for (let i = 0; i < 3; i++) mkDoc(db, { text: SIB_TEXT });
  check('mig 84: a NEW install carries fingerprint_seed_support_prune=true (INSERT OR IGNORE)', learning.getSetting(db, 'fingerprint_seed_support_prune', null) === 'true');
  learning.setSetting(db, 'fingerprint_seed_support_prune', 'false');
  const off = templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1 });
  check('setting false → off, seed untouched', off.reason === 'off' && off.fingerprint.join() === SEED.join());
  const db84 = new Database(':memory:'); runMigrations(db84);
  db84.prepare("UPDATE settings SET value = 'false' WHERE key = 'fingerprint_seed_support_prune'").run();
  db84.prepare('DELETE FROM migrations WHERE version = 84').run(); runMigrations(db84);
  check('mig 84 never UPSERT-forces an existing install (a false stays false)', learning.getSetting(db84, 'fingerprint_seed_support_prune', null) === 'false');
  learning.setSetting(db, 'fingerprint_seed_support_prune', 'true');
  check('setting true → prunes', templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1 }).reason === 'pruned');
  process.env.FINGERPRINT_SEED_SUPPORT = '0';
  check('env 0 beats setting true', templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1 }).reason === 'off');
  learning.setSetting(db, 'fingerprint_seed_support_prune', 'false');
  process.env.FINGERPRINT_SEED_SUPPORT = '1';
  check('env 1 beats setting false', templates.pruneSeedFingerprint(db, SEED, { docId: seedDoc, issuer: 'DOCUMENT SOLUTIONS', typeId: 1 }).reason === 'pruned');
  delete process.env.FINGERPRINT_SEED_SUPPORT;
}

console.log('§viii both birth paths call the helper (source contract)');
{
  const rh = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'review', 'handler.js'), 'utf8');
  const gt = fs.readFileSync(path.join(__dirname, 'graduationTemplate.js'), 'utf8');
  const tj = fs.readFileSync(path.join(__dirname, 'templates.js'), 'utf8');
  check('_upsertTemplate CREATE hands the pruned value to create() (C1: after the customer strip, never a post-hoc UPDATE)',
        /templates\.pruneSeedFingerprint\(db, keyword_fingerprint, \{ docId: document_id, issuer: confirmedIssuer/.test(rh) && /keyword_fingerprint: _seedFp,/.test(rh)
        && rh.indexOf('templates.pruneSeedFingerprint(db, keyword_fingerprint') > rh.indexOf("process.env.FINGERPRINT_HYGIENE !== '0'"));
  check('graduationTemplate.apply prunes its seed through the same helper', /templates\.pruneSeedFingerprint\(db, s\.keyword_fingerprint/.test(gt) && /keyword_fingerprint: seedFp,/.test(gt));
  check('findByKeywordFingerprint stays a read-only consumer (no prune inside it)', !/pruneSeedFingerprint/.test(tj.slice(tj.indexOf('function findByKeywordFingerprint'), tj.indexOf('function findByKeywordFingerprint') + 2500)));
  check("documents.keyword_fingerprint is never rewritten by the prune", !/UPDATE documents SET keyword_fingerprint/.test(tj.slice(tj.indexOf('function pruneSeedFingerprint'), tj.indexOf('function pruneSeedFingerprint') + 5000)));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
