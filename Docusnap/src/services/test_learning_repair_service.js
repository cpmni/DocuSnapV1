'use strict';
/*
 * test_learning_repair_service.js — PINs for Learning Repair "START FRESH" (learningRepairService:
 * dryRun / forgetScope / undoForget; gary design → Oracle SIGN-OFF-W/COND C1–C6, 2026-08-26; DARK
 * `learning_repair_forget`). The pins Oracle asked to be RED on the naive build:
 *   • forget → a later send-back leaves ANOTHER sender's `__global__` twin intact (C1 idempotence);
 *   • a template shared with another sender is REFUSED and reported (C2);
 *   • forget → scopeTrust cold, with a pre-forget `trusted:true` positive control;
 *   • Undo round-trip equality on templates / template_fields / supplier_hints / document links (C4);
 *   • a human re-confirm clears both stamps (documents.confirmIfReviewable, no via);
 *   • "Pacmec" is untouched by forgetting "Acme" (C3 exact scope);
 *   • the switch OFF refuses; corrections are KEPT.
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/services/test_learning_repair_service.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/modules/../index');
const learning = require('../../database/modules/learning');
const trust = require('../../database/modules/trust');
const templates = require('../../database/modules/templates');
const documents = require('../../database/modules/documents');
const repairService = require('./repairService');
const svc = require('./learningRepairService');

let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`  FAIL ${name}${extra ? '  [' + JSON.stringify(extra) + ']' : ''}`); } };

const ACME = 'Acme Ltd', PACMEC = 'Pacmec Ltd', S2 = 'Bramble Co';
function seedInvoiceType(db) {
  const inv = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key, built_in) VALUES ('Invoice','invoice','invoice_number','invoice_date',1)").run().lastInsertRowid;
  const addF = db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (?,?,?,?,1,1)');
  addF.run(inv, 'supplier_name', 'Document Issuer', 'text');
  addF.run(inv, 'invoice_date', 'Invoice Date', 'date');
  addF.run(inv, 'invoice_number', 'Invoice Number', 'text');
  return inv;
}
function mkTemplate(db, sup, slug, frozen = true) {
  const tid = db.prepare(`INSERT INTO templates (name, slug, document_type_slug, keyword_fingerprint) VALUES (?, ?, ?, '["x"]')`)
    .run(`${sup} ${slug}`, `${sup.toLowerCase().replace(/\W+/g, '-')}-${slug}-${Math.random().toString(36).slice(2, 6)}`, slug).lastInsertRowid;
  if (frozen) db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (?, 'supplier_name', ?, 0)").run(tid, sup);
  db.prepare("INSERT INTO template_field_mappings (template_id, field_key, anchor_text, anchor_x_norm, anchor_y_norm, anchor_w_norm, anchor_h_norm, target_x_norm, target_y_norm, target_w_norm, target_h_norm) VALUES (?, 'invoice_number', 'Invoice Number', 0.1,0.1,0.1,0.02, 0.3,0.1,0.2,0.02)").run(tid);
  return tid;
}
function mkDoc(db, inv, sup, i, tid, status = 'confirmed') {
  const ref = `${sup.slice(0, 3).toUpperCase()}${1000 + i}`, when = `0${(i % 9) + 1}-06-2026`;
  const id = db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence, confirmed_at, template_id, ocr_text, reference_number, doc_date)
                         VALUES (?, ?, '/in', ?, ?, 96, ?, ?, ?, ?, ?)`)
    .run(inv, `${sup}-${i}.pdf`, status, sup, `2026-06-0${(i % 9) + 1}T10:00:00Z`, tid, `INVOICE\n${sup}\nInvoice Number ${ref}\nInvoice Date ${when}\nTotal 120.00`, ref, when).lastInsertRowid;
  const ex = db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 95, ?)`);
  ex.run(id, 'supplier_name', sup, sup, 'template_fixed');
  ex.run(id, 'invoice_number', ref, ref, 'keyword');
  ex.run(id, 'invoice_date', when, when, 'keyword');
  ex.run(id, 'total_amount', '£120.00', '£120.00', 'keyword');
  return id;
}
function seed(db) {
  const inv = seedInvoiceType(db);
  learning.setSetting(db, 'graduation_window', '3');
  const tAcme = mkTemplate(db, ACME, 'invoice');
  const tPac = mkTemplate(db, PACMEC, 'invoice');
  const tShared = mkTemplate(db, ACME, 'invoice');           // frozen to Acme but ALSO carries S2's confirmed docs (the intruder class)
  const acme = [1, 2, 3, 4, 5].map(i => mkDoc(db, inv, ACME, i, tAcme));
  const pac = [1, 2, 3].map(i => mkDoc(db, inv, PACMEC, i, tPac));
  const s2 = [1, 2].map(i => mkDoc(db, inv, S2, i, tShared));
  const held = mkDoc(db, inv, ACME, 9, null, 'needs_review');
  // scope learning rows
  const hint = db.prepare("INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?, 'invoice', ?, ?, ?)");
  hint.run(ACME, 'total_amount', '£120.00', 5);
  hint.run(PACMEC, 'total_amount', '£99.00', 2);
  // a __global__ twin planted by BOTH Acme (doc 1) and S2 (doc 1) — twins are planted by the
  // CORRECTIONS path of the confirm (retractConfirmHints mirrors it), so both docs carry a
  // total_amount correction: usage 2 — the C1 exhibit.
  hint.run('__global__', 'total_amount', '£120.00', 2);
  db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?, 'total_amount', '£120.00', '£120.00', ?, 'invoice')").run(acme[0], ACME);
  db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?, 'total_amount', '£120.00', '£120.00', ?, 'invoice')").run(s2[0], S2);
  db.prepare("INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence) VALUES (?, 'invoice', 'invoice_number', 'Invoice Number', 'right', 'top', 0.1,0.1,0.2,0.02, 3, 90)").run(ACME);
  db.prepare("INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone, x_norm, y_norm, w_norm, h_norm, usage_count, confidence) VALUES (?, 'invoice', 'invoice_number', 'Invoice Number', 'right', 'top', 0.1,0.1,0.2,0.02, 3, 90)").run(PACMEC);
  db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?, 'invoice_number', 'ACM1001', 'ACM1001', ?, 'invoice')").run(acme[0], ACME);
  try { db.prepare("INSERT INTO field_label_overrides (doc_type_slug, field_key, label, template_id) VALUES ('invoice','invoice_number','Inv No',?)").run(tAcme); } catch {}
  return { inv, tAcme, tPac, tShared, acme, pac, s2, held };
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-snap-'));
function fresh() { const db = new Database(':memory:'); runMigrations(db); return db; }

console.log('1. dry run + switch OFF refuses');
{
  const db = fresh(); const s = seed(db);
  process.env.LEARNING_REPAIR_FORGET = '0';
  const plan = svc.dryRun(db, { supplier_name: ACME, document_type_slug: 'invoice' });
  check('dryRun counts: 1 hint, 1 anchor, 1 owned template, 1 REFUSED (shared) template, 5 docs to stamp, 1 held to re-read',
        plan.ok && plan.hints === 1 && plan.anchors === 1 && plan.templates.length === 1 && plan.templates[0].id === s.tAcme
        && plan.templatesRefused.length === 1 && plan.templatesRefused[0].id === s.tShared
        && plan.templatesRefused[0].otherSuppliers.some(o => o.name === S2) && plan.docsToStamp === 5 && plan.held.reread === 1, plan);
  check('consequence sentence names the layout, the filed docs, the cold restart and the kept shared layout',
        /1 layout/.test(plan.text) && /5 filed documents stay/.test(plan.text) && /like a new sender/.test(plan.text) && /shared with another sender/.test(plan.text) && /undo/i.test(plan.text));
  const r = svc.forgetScope(db, { username: 'admin' }, { supplier_name: ACME, document_type_slug: 'invoice' }, { snapshotDir: tmpDir });
  check('OFF: forget refused, nothing changed', r.ok === false && db.prepare("SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name = ?").get(ACME).n === 1);
  delete process.env.LEARNING_REPAIR_FORGET;
}

console.log('2. forget: cold scope, exact scope, shared template refused, corrections kept, held doc unbound');
const db = fresh(); const s = seed(db);
process.env.LEARNING_REPAIR_FORGET = '1';
const t0 = trust.scopeTrust(db, ACME, 'invoice');
check('control: Acme graduated BEFORE the forget (5 human confirms, W=3)', t0.trusted === true && t0.confirmedCount === 5, t0);
const g0 = (learning.getFieldFormats(db) || []).find(g => g.supplier_name === ACME && g.field_key === 'invoice_number');
check('control: the derived model holds Acme values', !!g0 && Object.keys(g0.value_counts).length === 5);
const res = svc.forgetScope(db, { username: 'admin' }, { supplier_name: ACME, document_type_slug: 'invoice' }, { snapshotDir: tmpDir });
check('forget ok + snapshot written', res.ok && res.snapshotPath && fs.existsSync(res.snapshotPath), res);
check('summary: 1 hint, 1 anchor, 1 template, 5 docs stamped + retracted, 1 refused',
      res.ok && res.summary.hints === 1 && res.summary.anchors === 1 && res.summary.templates === 1 && res.summary.docsStamped === 5
      && res.summary.docsRetracted === 5 && res.summary.templatesRefused === 1, res.summary);
const t1 = trust.scopeTrust(db, ACME, 'invoice');
check('scopeTrust is COLD after the forget (volume, 0 confirms, floor 100)', t1.trusted === false && t1.reason === 'volume' && t1.confirmedCount === 0 && t1.floor === 100, t1);
check('the derived model no longer holds any Acme group', !(learning.getFieldFormats(db) || []).some(g => g.supplier_name === ACME));
check('Acme docs stay confirmed + searchable', db.prepare("SELECT COUNT(*) n FROM documents WHERE supplier_name = ? AND status = 'confirmed'").get(ACME).n === 5
      && documents.search(db, { docType: 'invoice' }).filter(d => d.supplier_name === ACME).length === 5);
check('Acme docs carry BOTH stamps', db.prepare("SELECT COUNT(*) n FROM documents WHERE supplier_name = ? AND learning_excluded_at IS NOT NULL AND learning_retracted_at IS NOT NULL").get(ACME).n === 5);
check('owned template deleted, held doc unbound; SHARED template kept with S2 still bound',
      !db.prepare('SELECT 1 FROM templates WHERE id = ?').get(s.tAcme) && !!db.prepare('SELECT 1 FROM templates WHERE id = ?').get(s.tShared)
      && db.prepare('SELECT COUNT(*) n FROM documents WHERE template_id = ?').get(s.tShared).n === 2);
check('template-scoped label override deleted with the template', db.prepare('SELECT COUNT(*) n FROM field_label_overrides WHERE template_id = ?').get(s.tAcme).n === 0);
check('C3 exact scope: Pacmec untouched (hint, anchor, template, trust count)',
      db.prepare("SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name = ?").get(PACMEC).n === 1
      && db.prepare("SELECT COUNT(*) n FROM field_anchors WHERE supplier_name = ?").get(PACMEC).n === 1
      && !!db.prepare('SELECT 1 FROM templates WHERE id = ?').get(s.tPac)
      && trust.scopeTrust(db, PACMEC, 'invoice').confirmedCount === 3);
check('corrections KEPT', db.prepare("SELECT COUNT(*) n FROM corrections WHERE supplier_name = ?").get(ACME).n === 2);
const twin = db.prepare("SELECT usage_count FROM supplier_hints WHERE supplier_name = '__global__' AND hint_value = '£120.00'").get();
check("the __global__ twin lost exactly Acme's votes (2 → 1; S2's vote survives)", !!twin && twin.usage_count === 1, twin);

console.log('3. C1 idempotence: a later send-back / delete of a forgotten doc must NOT retract again');
repairService.sendBackToReview(db, s.acme[0], {});
const twin2 = db.prepare("SELECT usage_count FROM supplier_hints WHERE supplier_name = '__global__' AND hint_value = '£120.00'").get();
check("send-back after forget leaves S2's __global__ twin intact (still 1)", !!twin2 && twin2.usage_count === 1, twin2);
repairService.deleteToRecycleBin(db, s.acme[1]);
const twin3 = db.prepare("SELECT usage_count FROM supplier_hints WHERE supplier_name = '__global__' AND hint_value = '£120.00'").get();
check('delete after forget leaves it intact too', !!twin3 && twin3.usage_count === 1, twin3);
repairService.restoreFromRecycleBin(db, s.acme[1]);
const twin4 = db.prepare("SELECT usage_count FROM supplier_hints WHERE supplier_name = '__global__' AND hint_value = '£120.00'").get();
check('restore of a learning-EXCLUDED doc does NOT re-plant (stays 1) and keeps its stamps',
      !!twin4 && twin4.usage_count === 1 && !!db.prepare('SELECT learning_excluded_at FROM documents WHERE id = ?').get(s.acme[1]).learning_excluded_at, twin4);

console.log('4. a HUMAN re-confirm returns a doc to teaching (both stamps cleared); a machine confirm does not');
{
  const id = s.acme[0];   // sent back above → needs_review, still stamped excluded
  check('precondition: sent-back doc is needs_review and still carries the exclusion stamp',
        db.prepare('SELECT status, learning_excluded_at FROM documents WHERE id = ?').get(id).status === 'needs_review'
        && !!db.prepare('SELECT learning_excluded_at FROM documents WHERE id = ?').get(id).learning_excluded_at);
  documents.confirmIfReviewable(db, id, { stored_filename: 'a.pdf', stored_path: '/out/a.pdf', confirmed_by_username: 'admin', confirmed_via: 'scope_sweep' });
  const m = db.prepare('SELECT status, learning_excluded_at, learning_retracted_at FROM documents WHERE id = ?').get(id);
  check('machine confirm (via) keeps both stamps', m.status === 'confirmed' && !!m.learning_excluded_at);
  documents.deconfirmDocument(db, id);
  documents.confirmIfReviewable(db, id, { stored_filename: 'a.pdf', stored_path: '/out/a.pdf', confirmed_by_username: 'admin' });
  const h = db.prepare('SELECT status, learning_excluded_at, learning_retracted_at FROM documents WHERE id = ?').get(id);
  check('HUMAN confirm clears both stamps', h.status === 'confirmed' && !h.learning_excluded_at && !h.learning_retracted_at, h);
  check('…and the scope counts that doc again', trust.scopeTrust(db, ACME, 'invoice').confirmedCount === 1);
}

console.log('5. undo round-trip (C4) on a fresh forget');
{
  const db2 = fresh(); const s2 = seed(db2);
  const before = {
    tpl: db2.prepare('SELECT * FROM templates WHERE id = ?').get(s2.tAcme),
    tf: db2.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY id').all(s2.tAcme),
    map: db2.prepare('SELECT * FROM template_field_mappings WHERE template_id = ? ORDER BY id').all(s2.tAcme),
    hints: db2.prepare('SELECT supplier_name, document_type, field_key, hint_value, usage_count FROM supplier_hints ORDER BY id').all(),
    links: db2.prepare('SELECT id, template_id FROM documents WHERE supplier_name = ? ORDER BY id').all(ACME),
    trust: trust.scopeTrust(db2, ACME, 'invoice').trusted,
  };
  const r = svc.forgetScope(db2, { username: 'admin' }, { supplier_name: ACME, document_type_slug: 'invoice' }, { snapshotDir: tmpDir });
  check('forget ok', r.ok);
  check('listSnapshots sees it', svc.listSnapshots(tmpDir).some(x => x.path === r.snapshotPath));
  const u = svc.undoForget(db2, r.snapshotPath);
  check('undo ok', u.ok, u);
  const after = {
    tpl: db2.prepare('SELECT * FROM templates WHERE id = ?').get(s2.tAcme),
    tf: db2.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY id').all(s2.tAcme),
    map: db2.prepare('SELECT * FROM template_field_mappings WHERE template_id = ? ORDER BY id').all(s2.tAcme),
    hints: db2.prepare('SELECT supplier_name, document_type, field_key, hint_value, usage_count FROM supplier_hints ORDER BY id').all(),
    links: db2.prepare('SELECT id, template_id FROM documents WHERE supplier_name = ? ORDER BY id').all(ACME),
    trust: trust.scopeTrust(db2, ACME, 'invoice').trusted,
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('templates row restored with its ORIGINAL id', !!after.tpl && after.tpl.id === before.tpl.id && after.tpl.name === before.tpl.name);
  check('template_fields + mappings restored', same(after.tf, before.tf) && same(after.map, before.map));
  check('supplier_hints restored (Acme rows + the __global__ twin count)',
        same(after.hints.map(h => `${h.supplier_name}|${h.field_key}|${h.hint_value}|${h.usage_count}`).sort(),
             before.hints.map(h => `${h.supplier_name}|${h.field_key}|${h.hint_value}|${h.usage_count}`).sort()), { before: before.hints, after: after.hints });
  check('document links restored', same(after.links, before.links));
  check('stamps cleared, scope graduated again', after.trust === true && before.trust === true
        && db2.prepare("SELECT COUNT(*) n FROM documents WHERE supplier_name = ? AND (learning_excluded_at IS NOT NULL OR learning_retracted_at IS NOT NULL)").get(ACME).n === 0);
  check('snapshot consumed', !fs.existsSync(r.snapshotPath));
}

delete process.env.LEARNING_REPAIR_FORGET;
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
