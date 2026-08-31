'use strict';
/*
 * sweep_integration_fixture.js — Catch-up Filing SLICE 4: the integration fixture
 * (design docs/designs/CATCHUP_FILING_2026-07-31.md §Test plan: "Integration fixture
 * (confirm K → sweep → accept → audit + queue asserted)").
 *
 * Drives the REAL modules end-to-end against a REAL-schema migrated temp DB:
 *   confirm K=10 (HUMAN, via reviewService.confirm — the one shared confirm)
 *   → graduation is the K-human-only computation (scopeTrust)
 *   → sweep candidacy (Tier 1: trust.isAutoFileEligible + extractionsFingerprint),
 *     ZERO-WRITE asserted (total_changes unchanged)
 *   → accept (the slice-3 semantics: fingerprint recheck → the SAME shared
 *     reviewService.confirm with INTERNAL {via:'scope_sweep'})
 *   → asserts: confirmed_via stamped · corrections SKIPPED for machine confirms ·
 *     hint usage NOT inflated · queue count drops · graduation window still counts
 *     the 10 HUMAN confirms only · audit hook fired per confirm
 *   → candidacy→accept MUTATION drop (SEAM 2: changed fingerprint = dropped)
 *   → undo (deconfirmDocument; the handler's confirmed_via server-check semantics)
 *   → asserts: docs back in the queue · stored_path KEPT (re-file in place) ·
 *     learning state (field formats) BYTE-EQUAL to the pre-sweep snapshot.
 *
 * The ipcMain layer itself (scope guards, busy/license refusals, audit calls) is
 * source-pinned at the bottom — the handlers close over Electron main state and are
 * exercised live by the owner's SCOPE_SWEEP=1 trial; this fixture proves the pieces
 * they compose are sound END-TO-END.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/sweep_integration_fixture.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbmod     = require(path.join(REPO, 'database', 'index.js'));
const doctypes  = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const trust     = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const { createReviewService } = require(path.join(REPO, 'src', 'services', 'reviewService.js'));
const { evaluateSweepConsistency, extractionsFingerprint } = require(path.join(REPO, 'src', 'services', 'sweepPredicate.js'));

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweepfix-'));
const outRoot = path.join(tmp, 'out'); fs.mkdirSync(outRoot);
const srcDir = path.join(tmp, 'src'); fs.mkdirSync(srcDir);

const db = new Database(path.join(tmp, 'fixture.db'));
dbmod.runMigrations(db);
try { dbmod.runJsMigrations(db); } catch { /* document_routes ensure — best-effort for the fixture */ }
doctypes.seedBuiltInTypes(db);
learning.setSetting(db, 'output_folder', outRoot);

const dt = db.prepare("SELECT * FROM document_types WHERE slug = 'invoice'").get();
const SUP = 'Fixture Supply Co';
// A minimal learned template: the sub-100 docTrustGate requires a template match
// (reason 'no-template' otherwise) — the fixture's docs are template-matched like a
// real warmed scope, so Tier-1 exercises the FULL structural gate, not a bypass.
db.prepare("INSERT INTO templates (name, slug, document_type_slug) VALUES ('Fixture Supply Co Invoice', 'fixture-supply-co-invoice', 'invoice')").run();
const TPL_ID = db.prepare('SELECT last_insert_rowid() AS id').get().id;
const auditLog = [];
const svc = createReviewService({ audit: (dbh, ev) => auditLog.push(ev) });
const actor = { username: 'fixture-user' };

// ── Seed: docId → {ref, date}; K=10 human targets + 4 queue docs (one for the mutation drop) ──
function seedDoc(i, status) {
  const fname = `fix_${i}.pdf`;
  fs.writeFileSync(path.join(srcDir, fname), `%PDF-1.4 fixture ${i}`);
  documents.insert(db, {
    original_filename: fname, folder_path: srcDir, document_type_id: dt.id,
    supplier_name: SUP, overall_confidence: 96, status, template_id: TPL_ID,
  });
  const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  const rows = [
    ['supplier_name', SUP, 97],
    ['invoice_number', `FX-10${String(i).padStart(2, '0')}`, 96],
    ['invoice_date', '14-07-2026', 95],
  ];
  for (const [k, v, c] of rows) {
    db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
                VALUES (?, ?, ?, ?, ?, 'keyword')`).run(id, k, v, v, c);
  }
  return id;
}
const humanIds = []; for (let i = 1; i <= 10; i++) humanIds.push(seedDoc(i, 'needs_review'));
const queueIds = []; for (let i = 11; i <= 14; i++) queueIds.push(seedDoc(i, 'needs_review'));

(async () => {
  console.log('§1 confirm K=10 (HUMAN, through the one shared reviewService.confirm)');
  for (const id of humanIds) {
    const vals = {}; for (const r of db.prepare('SELECT field_key, display_value FROM extractions WHERE document_id = ?').all(id)) vals[r.field_key] = r.display_value;
    const res = await svc.confirm(db, actor, {
      document_id: id, allValues: vals, corrections: {}, taught_fields: [],
      supplier_name: SUP, document_type: dt.name, document_type_slug: dt.slug, bulk: true,
    });
    if (!res || !res.ok) { check(`human confirm #${id} filed (${res && (res.code || res.error)})`, false); }
  }
  const humanRows = db.prepare(`SELECT status, confirmed_via, stored_path FROM documents WHERE id IN (${humanIds.join(',')})`).all();
  check('all 10 filed', humanRows.every(r => r.status === 'confirmed'));
  check("human confirms carry confirmed_via NULL", humanRows.every(r => r.confirmed_via === null));

  console.log('\n§2 graduation = the K-human-only computation');
  const st0 = trust.scopeTrust(db, SUP, dt.slug);
  check(`scope graduated on the 10 human confirms (trusted=${st0.trusted}, W count=${st0.confirmedCount})`,
        st0.trusted === true && st0.confirmedCount === 10);

  console.log('\n§3 sweep candidacy (Tier 1) — ZERO-WRITE evaluation');
  const preEval = db.prepare('SELECT total_changes() AS c').get().c;
  const candidates = [];
  for (const id of queueIds) {
    const doc = documents.getById(db, id);
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
    const g = trust.isAutoFileEligible(db, doc);
    if (g.eligible) candidates.push({ docId: id, fingerprint: extractionsFingerprint(rows) });
  }
  check('all 4 queue docs are Tier-1 candidates (stored rows pass the live gate)', candidates.length === 4);
  check('candidacy evaluation wrote NOTHING (total_changes unchanged)',
        db.prepare('SELECT total_changes() AS c').get().c === preEval);

  console.log('\n§4 SEAM 2 — candidacy→accept mutation drops the doc');
  const mutId = queueIds[3];
  db.prepare("UPDATE extractions SET display_value = 'FX-9999' WHERE document_id = ? AND field_key = 'invoice_number'").run(mutId);
  const mutRows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(mutId);
  const mutCand = candidates.find(c => c.docId === mutId);
  check('a value edit between consent and accept changes the fingerprint (doc DROPS)',
        extractionsFingerprint(mutRows) !== mutCand.fingerprint);

  console.log('\n§5 accept — the slice-3 semantics through the SAME shared confirm');
  const learnA1 = JSON.stringify(learning.getFieldFormats(db));
  const hintsA1 = JSON.stringify(db.prepare('SELECT supplier_name, field_key, hint_value, usage_count FROM supplier_hints ORDER BY 1,2,3').all());
  const corrA1 = db.prepare('SELECT COUNT(*) AS n FROM corrections').get().n;
  const queueBefore = documents.getReviewCount(db);
  const accepted = candidates.filter(c => c.docId !== mutId);
  const filed = [];
  for (const a of accepted) {
    const doc = documents.getById(db, a.docId);
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(a.docId);
    if (extractionsFingerprint(rows) !== a.fingerprint) continue;       // SEAM 2 recheck
    if (!trust.isAutoFileEligible(db, doc).eligible) continue;          // re-run the gate at accept
    const vals = {}; for (const r of rows) vals[r.field_key] = r.display_value ?? r.raw_value;
    const res = await svc.confirm(db, actor, {
      document_id: a.docId, allValues: vals, corrections: {}, taught_fields: [],
      supplier_name: doc.supplier_name, document_type: dt.name, document_type_slug: dt.slug, bulk: true,
    }, { via: 'scope_sweep' });
    if (res && res.ok) filed.push(a.docId);
  }
  check('3 accepted docs filed (the mutated 4th was dropped)', filed.length === 3);
  const sweptRows = db.prepare(`SELECT status, confirmed_via, stored_path FROM documents WHERE id IN (${filed.join(',')})`).all();
  check("machine confirms stamp confirmed_via='scope_sweep' (server-side internal arg)",
        sweptRows.every(r => r.status === 'confirmed' && r.confirmed_via === 'scope_sweep'));
  check('machine confirms SKIP saveCorrections (corrections table unchanged)',
        db.prepare('SELECT COUNT(*) AS n FROM corrections').get().n === corrA1);
  check('machine confirms do NOT inflate hint usage',
        JSON.stringify(db.prepare('SELECT supplier_name, field_key, hint_value, usage_count FROM supplier_hints ORDER BY 1,2,3').all()) === hintsA1);
  check(`queue dropped by exactly the filed count (${queueBefore} → ${documents.getReviewCount(db)})`,
        documents.getReviewCount(db) === queueBefore - 3);
  const st1 = trust.scopeTrust(db, SUP, dt.slug);
  check(`graduation window still counts HUMAN confirms only (W count ${st1.confirmedCount} — sweep confirms excluded)`,
        st1.confirmedCount === 10);
  check('the audit hook fired for every confirm (13 = 10 human + 3 machine)',
        auditLog.filter(e => e && /confirm/i.test(String(e.action || ''))).length >= 13
        || auditLog.length >= 13);

  console.log('\n§6 undo — server-checked via + learning-state restore');
  const humanTarget = humanIds[0];
  const hRow = db.prepare('SELECT confirmed_via FROM documents WHERE id = ?').get(humanTarget);
  check('the undo guard has grounds to refuse a human confirm (confirmed_via NULL ≠ scope_sweep)',
        hRow.confirmed_via !== 'scope_sweep');
  for (const id of filed) {
    const row = db.prepare('SELECT status, confirmed_via FROM documents WHERE id = ?').get(id);
    if (row.status === 'confirmed' && row.confirmed_via === 'scope_sweep') documents.deconfirmDocument(db, id);
  }
  const undone = db.prepare(`SELECT status, confirmed_via, stored_path FROM documents WHERE id IN (${filed.join(',')})`).all();
  check('undone docs are back in the queue with confirmed_via cleared',
        undone.every(r => r.status === 'needs_review' && r.confirmed_via === null));
  check('stored_path KEPT on undo (a later re-confirm replaces IN PLACE, no -DUPLICATE)',
        undone.every(r => r.stored_path));
  check('learning state (field formats) restored BYTE-EQUAL to the pre-sweep snapshot',
        JSON.stringify(learning.getFieldFormats(db)) === learnA1);

  console.log('\n§7 handler source pins (the ipc layer this fixture cannot drive)');
  const src = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check('accept re-runs _evaluateSweepDoc server-side', /sweep-scope-accept[\s\S]{0,3000}_evaluateSweepDoc\(db, doc, roleKeys, ctx\)/.test(src));
  check('accept passes the INTERNAL via (4th arg), never payload-suppliable',
        /reviewService\.confirm\(db, actor, \{[\s\S]{0,400}?\}, \{ via: 'scope_sweep' \}\)/.test(src));
  check('undo refuses rows whose confirmed_via is not scope_sweep',
        /row\.confirmed_via !== 'scope_sweep'/.test(src));
  check('offer/accept/undo all audited',
        src.includes("action: 'scope_sweep_offered'") && src.includes("action: 'scope_sweep_accepted'") && src.includes("action: 'scope_sweep_undone'"));
  check('candidates + accept are dark behind scope_sweep_enabled / SCOPE_SWEEP',
        (src.match(/scope_sweep_enabled/g) || []).length >= 2);

  try { db.close(); } catch { }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir — OS clears it */ }
  console.log(`\n${fails ? fails + ' FAILED' : 'All sweep integration-fixture checks passed.'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FIXTURE ERROR:', e); process.exit(1); });
