'use strict';
/**
 * test_department_serve_hardening.js — the 2026-09-18 WATERTIGHT hardening proof (gary + eric → Oracle
 * SIGN-OFF-W/COND). Proves the by-id SERVE/MUTATE + routing paths that were found ungated now DENY the
 * adversary (an edit user in no department), still ALLOW a member/admin, and are byte-identical when no
 * departments exist. Complements test_department_denial_matrix.js (list readers) — this pin is the
 * SERVE/MUTATE surface: reprocess-document, split-pdf (+ child-tag inheritance), the /v1 mutation cluster,
 * restore-of-a-deleted-doc, the workflow-assign SENDER self-grant, and the fail-closed gate.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_serve_hardening.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const access = require('./accessService');
const dept   = require('./departmentService');
const dv     = require('../../database/modules/departmentVisibility');
const wfSvc  = require('./workflowService').createWorkflowService({});

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

let _n = 0;
function mkUser(db, role, all = 0) {
  const id = db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments, is_active) VALUES (?,?,?,?,?,1)')
    .run('u' + (++_n) + Math.random().toString(36).slice(2, 6), 'u', 'x', role, all).lastInsertRowid;
  return { role, id, userId: id, username: 'u' + id };
}
function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  const admin    = mkUser(db, 'admin');
  const editFin  = mkUser(db, 'edit');
  const editNone = mkUser(db, 'edit');            // THE ADVERSARY — writer, no department
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  const mk = (status, ...deptIds) => {
    const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in',?)").run(status).lastInsertRowid;
    for (const d of deptIds) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d);
    return id;
  };
  return { db, admin, editFin, editNone, fin, mk };
}
const allow = (db, u, id) => access.canAccessDocument(db, u, id).allow;

console.log('§1 the shared per-doc gate — reprocess-document / split-pdf / /v1 confirm|defer|undefer|delete|viewing all funnel through canAccessDocument');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const restricted = mk('needs_review', fin);
  const shared     = mk('needs_review');
  const r = access.canAccessDocument(db, editNone, restricted);
  check('adversary DENIED a restricted doc (department_restricted)', r.allow === false && r.reason === 'department_restricted');
  check('a MEMBER is allowed the restricted doc', allow(db, editFin, restricted));
  check('admin is allowed the restricted doc', allow(db, admin, restricted));
  check('adversary CAN act on a shared (untagged) doc — byte-identical', allow(db, editNone, shared));
}

console.log('§2 restore-of-a-DELETED doc gates on the department decision directly (the _assertDeletedDocAccess twin)');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const delRestricted = mk('deleted', fin);
  check('adversary DENIED restoring a deleted restricted doc', dv.decision(db, editNone, { id: delRestricted }).deny === true);
  check('a MEMBER may restore it (decision allows — canAccessDocument would wrongly block a deleted doc)',
    dv.decision(db, editFin, { id: delRestricted }).deny === false && access.canAccessDocument(db, editFin, delRestricted).allow === false);
  check('admin may restore it', dv.decision(db, admin, { id: delRestricted }).deny === false);
  check('a deleted SHARED doc is restorable by anyone (byte-identical)', dv.decision(db, editNone, { id: mk('deleted') }).deny === false);
}

console.log('§3 split-pdf CHILD inheritance — a child of a restricted parent inherits its tags (no laundering to shared)');
{
  const { db, editFin, editNone, fin, mk } = seed();
  // Replicate the handler's inheritance: read the parent's tags, copy them to each child row.
  const inheritToChild = (parentId, status) => {
    const parentDepts = db.prepare('SELECT department_id FROM document_departments WHERE document_id = ?').all(parentId).map(r => r.department_id);
    const childId = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('c.pdf','/in',?)").run(status).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
    for (const d of parentDepts) ins.run(childId, d);
    return childId;
  };
  const child = inheritToChild(mk('confirmed', fin), 'needs_review');
  check('a child of a RESTRICTED parent is DENIED to the adversary (not laundered to shared)', !allow(db, editNone, child));
  check('...and is allowed to a member', allow(db, editFin, child));
  const sharedChild = inheritToChild(mk('confirmed'), 'needs_review');
  check('a child of a SHARED parent stays shared — byte-identical', allow(db, editNone, sharedChild));
}

console.log('§4 fail-CLOSED: a membership-query error on a KNOWN-tagged doc DENIES (was fail-open)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const admin = mkUser(db, 'admin');
  const editNone = mkUser(db, 'edit');
  const fin = dept.createDepartment(db, admin, 'Finance').id;   // configured() → true
  const doc = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in','needs_review')").run().lastInsertRowid;
  db.prepare('INSERT INTO document_departments (document_id, department_id) VALUES (?,?)').run(doc, fin);   // tagged
  // Break user_departments so the membership JOIN throws (table still EXISTS → _hasTables passes → configured):
  db.exec('DROP TABLE user_departments');
  db.exec('CREATE TABLE user_departments (department_id INTEGER, broken INTEGER)');   // no user_id column
  check('membership JOIN error on a tagged doc → DENY (fail-closed, not the old fail-open allow)',
    dv.decision(db, editNone, { id: doc }).deny === true);
  check('admin still recovers (admin is exempt BEFORE the query)', dv.decision(db, admin, { id: doc }).deny === false);
}

console.log('§5 _hasTables now requires document_departments — an install missing it is INERT (clean short-circuit), not erroring');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const editNone = mkUser(db, 'edit');
  db.exec('DROP TABLE document_departments');   // simulate a pre-mig-184 / missing-join-table install
  check('configured() is false when document_departments is absent', dv.configured(db) === false);
  check('decision() is inert (deny:false) — never throws on the missing join table', dv.decision(db, editNone, { id: 1 }).deny === false);
}

console.log('§6 workflow-assign SENDER gate — an outsider cannot route a restricted doc to self-grant route_party access');
{
  const { db, admin, editFin, editNone, fin, mk } = seed();
  const restricted = mk('needs_review', fin);
  const asNone = wfSvc.assign(db, editNone, { documentId: restricted, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('adversary (non-member SENDER) is refused NOT_FOUND — never becomes a route party', asNone.ok === false && asNone.code === 'NOT_FOUND');
  const asFin = wfSvc.assign(db, editFin, { documentId: restricted, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('a MEMBER may route it (sender gate passes)', asFin.ok === true);
  const asAdmin = wfSvc.assign(db, admin, { documentId: mk('needs_review', fin), toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('admin may route it (sender gate passes)', asAdmin.ok === true);
  const asShared = wfSvc.assign(db, editNone, { documentId: mk('needs_review'), toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('an outsider CAN route a SHARED doc (byte-identical: no NOT_FOUND from the sender gate)', asShared.code !== 'NOT_FOUND');
}

console.log('§7 byte-identical when NO departments exist (the inert-install proof)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  const editFin  = mkUser(db, 'edit');
  const editNone = mkUser(db, 'edit');
  const doc = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in','needs_review')").run().lastInsertRowid;
  check('no departments → canAccessDocument allows an edit writer (writer)', allow(db, editNone, doc));
  check('no departments → decision inert (deny:false)', dv.decision(db, editNone, { id: doc }).deny === false);
  const as = wfSvc.assign(db, editNone, { documentId: doc, toUserId: editFin.id, actionRequired: 'acknowledge' });
  check('no departments → assign sender gate never blocks (no NOT_FOUND)', as.code !== 'NOT_FOUND');
}

// ── 2026-09-18 audit-debt red-team (Oracle SEND-BACK → C-A/C-B/C-C). Each of these would LEAK on the
//    pre-fix code: file / heal / disclose a restricted doc for a non-member. confirmBatch is async, so the
//    remaining sections run inside one async wrapper that owns the final report.
(async () => {
  console.log('§8 batch-audit-correct/confirmBatch — the adversary cannot FILE a restricted doc via a crafted edits payload');
  {
    const { db, editFin, editNone, fin, mk } = seed();
    const restricted = mk('confirmed', fin);
    const shared     = mk('confirmed');
    const ins = db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method) VALUES (?,?,?,?,90,'keyword')");
    ins.run(restricted, 'body', 'orig', 'orig'); ins.run(shared, 'body', 'orig', 'orig');
    const build = () => {
      const calls = [];
      const svc = require('./batchAuditService').createBatchAuditService({
        reviewService: { confirm: async (_db, _actor, payload) => { calls.push(Number(payload.document_id)); return { ok: true, filename: 'f.pdf' }; } },
        documents: require('../../database/modules/documents'),
        doctypes: require('../../database/modules/document_types'),
        access,
        getEvent: () => ({ ids: [restricted, shared] }),
        valPatterns: () => ({}), preserveAnchors: () => false, normaliseDate: null,
      });
      return { svc, calls };
    };
    const edits = [{ docId: restricted, fields: { body: 'X' } }, { docId: shared, fields: { body: 'Y' } }];
    const a = build(); const rA = await a.svc.confirmBatch(db, editNone, { eventId: 1, edits });
    check('adversary: restricted result is "not-in-batch" (existence-hiding)', (rA.results.find(r => r.docId === restricted) || {}).reason === 'not-in-batch');
    check('adversary: reviewService.confirm NEVER called with the restricted id (not filed)', !a.calls.includes(restricted));
    check('adversary: the SHARED doc was still filed', a.calls.includes(shared));
    const b = build(); await b.svc.confirmBatch(db, editFin, { eventId: 1, edits });
    check('member: the restricted doc IS filed for a member', b.calls.includes(restricted));
  }

  console.log('§9 find-issuer-siblings/findSiblings — a restricted fingerprint-matching sibling is hidden from a non-member');
  {
    const { db, editFin, editNone, fin } = seed();
    const sib = require('../../database/modules/supplierSiblings');
    const fp = '["alpha","beta","gamma","delta"]';
    const mkD = (...deptIds) => {
      const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint) VALUES ('d.pdf','/in','needs_review','Old Co',?)").run(fp).lastInsertRowid;
      for (const d of deptIds) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d);
      return id;
    };
    const src = mkD(), restr = mkD(fin), shared = mkD();
    const idsNone = sib.findSiblings(db, src, 'New Co', { viewer: editNone }).map(s => s.id);
    check('adversary: the RESTRICTED sibling is NOT returned', !idsNone.includes(restr));
    check('adversary: the SHARED sibling IS returned', idsNone.includes(shared));
    const idsFin = sib.findSiblings(db, src, 'New Co', { viewer: editFin }).map(s => s.id);
    check('member: the RESTRICTED sibling IS returned', idsFin.includes(restr));
    const idsSys = sib.findSiblings(db, src, 'New Co', { viewer: dv.SYSTEM_ACTOR }).map(s => s.id);
    check('system actor: both returned (unfiltered)', idsSys.includes(restr) && idsSys.includes(shared));
  }

  console.log('§10 reprocess-batch / reprocess-autocommit-accept — the per-item filter drops a restricted id, keeps a shared/own one');
  {
    const { db, editFin, editNone, fin, mk } = seed();
    const restricted = mk('needs_review', fin);
    const shared     = mk('needs_review');
    const filt = (u) => [{ docId: restricted }, { docId: shared }].filter(d => access.canAccessDocument(db, u, d.docId).allow).map(d => d.docId);
    check('adversary: the restricted id is dropped, the shared kept', JSON.stringify(filt(editNone)) === JSON.stringify([shared]));
    check('member: both kept', JSON.stringify(filt(editFin)) === JSON.stringify([restricted, shared]));
  }

  console.log('§11 classFixService.applyForConfirm — a restricted sibling is neither healed nor disclosed to a non-member');
  {
    process.env.REF_CLASS_FIX = '1';
    const { db, editFin, editNone, fin } = seed();
    const learning = require('../../database/modules/learning');
    const classFix = require('./classFixService');
    const refClassFix = require('./refClassFix');
    const typeId = db.prepare("INSERT INTO document_types (name, slug, built_in, ref_field_key) VALUES ('Invoice','invoice',0,'reference_number')").run().lastInsertRowid;
    const mkDoc = (ref, ...deptIds) => {
      const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id) VALUES ('d.pdf','/in','needs_review','Acme',?)").run(typeId).lastInsertRowid;
      db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method) VALUES (?, 'reference_number', ?, ?, 90, 'keyword')").run(id, ref, ref);
      for (const d of deptIds) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d);
      return id;
    };
    const source = mkDoc('P1/26/3130'), sibRestr = mkDoc('P1/26/3131', fin), sibShared = mkDoc('P1/26/3132');
    const rule = refClassFix.deriveClassFix('P1/26/3130', 'PI/26/3130');
    check('precondition: a class-fix rule derives (P1→PI)', !!rule);
    const opts = (viewer) => ({ documentId: source,
      corrections: { reference_number: { original_value: 'P1/26/3130', corrected_value: 'PI/26/3130' } },
      supplierName: 'Acme', typeSlug: 'invoice', dtInfo: { ref_field_key: 'reference_number', slug: 'invoice' },
      learning, audit: () => {}, logger: null, viewer });
    const idsNone = ((classFix.applyForConfirm(db, opts(editNone)) || {}).docs || []).map(d => d.id);
    check('adversary: the SHARED sibling is healed', idsNone.includes(sibShared));
    check('adversary: the RESTRICTED sibling is NOT healed or disclosed', !idsNone.includes(sibRestr));
    classFix._reset();
    const idsFin = ((classFix.applyForConfirm(db, opts(editFin)) || {}).docs || []).map(d => d.id);
    check('member: the RESTRICTED sibling IS healed for a member', idsFin.includes(sibRestr));
    classFix._reset();
    delete process.env.REF_CLASS_FIX;
  }

  console.log('§12 charsetAcceptService.applyCharsetAccept — a restricted sibling is neither cleared nor returned in clearedDocs');
  {
    const { db, editNone, fin } = seed();
    const learning = require('../../database/modules/learning');
    const charset = require('./charsetAcceptService');
    const typeId = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('Invoice','invoice',0)").run().lastInsertRowid;
    db.prepare("INSERT INTO fields (document_type_id, key, label, type) VALUES (?, 'reference_number', 'Ref', 'text')").run(typeId);
    // pick a char the garble guard accepts (so the accept is not refused wholesale)
    const ch = ['#', '&', '/', '-'].find(c => learning.isAcceptableFieldChar(c)) || '#';
    const meta = JSON.stringify({ chars: [ch], precap: 88 });
    const mkDoc = (...deptIds) => {
      const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id, overall_confidence) VALUES ('d.pdf','/in','needs_review','Acme',?,70)").run(typeId).lastInsertRowid;
      db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, validation_note, charset_flag_meta, extraction_method) VALUES (?, 'reference_number', ?, ?, 70, ?, ?, 'keyword')")
        .run(id, 'AB' + ch + '12', 'AB' + ch + '12', 'unexpected characters (' + ch + ') - please verify', meta);
      for (const d of deptIds) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d);
      return id;
    };
    const source = mkDoc(), sibRestr = mkDoc(fin), sibShared = mkDoc();
    const res = charset.applyCharsetAccept(db, { docId: source, fieldKey: 'reference_number', viewer: editNone });
    check('charset accept ran (guard accepted "' + ch + '")', !!(res && res.ok));
    const cleared = new Set((res && res.clearedDocs) || []);
    check('adversary: the SHARED sibling was cleared', cleared.has(sibShared));
    check('adversary: the RESTRICTED sibling was NOT cleared / not in clearedDocs', !cleared.has(sibRestr));
    const noteRestr = db.prepare('SELECT validation_note FROM extractions WHERE document_id = ?').get(sibRestr).validation_note;
    check('adversary: the RESTRICTED sibling still carries its note (untouched)', !!noteRestr);
  }

  console.log('§13 byte-identical when NO departments — the new gates drop/hide NOTHING (anti-over-gating trade-off pin)');
  {
    const db = new Database(':memory:'); runMigrations(db);
    const editNone = mkUser(db, 'edit');
    // confirmBatch files even for this actor when no departments exist
    const d1 = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name) VALUES ('d.pdf','/in','confirmed','Acme')").run().lastInsertRowid;
    db.prepare("INSERT INTO extractions (document_id, field_key, display_value, raw_value, confidence, extraction_method) VALUES (?, 'body','orig','orig',90,'keyword')").run(d1);
    const calls = [];
    const svc = require('./batchAuditService').createBatchAuditService({
      reviewService: { confirm: async (_db, _a, p) => { calls.push(Number(p.document_id)); return { ok: true, filename: 'f.pdf' }; } },
      documents: require('../../database/modules/documents'), doctypes: require('../../database/modules/document_types'), access,
      getEvent: () => ({ ids: [d1] }), valPatterns: () => ({}), preserveAnchors: () => false, normaliseDate: null,
    });
    await svc.confirmBatch(db, editNone, { eventId: 1, edits: [{ docId: d1, fields: { body: 'X' } }] });
    check('no departments → confirmBatch files the doc (byte-identical)', calls.includes(d1));
    // findSiblings returns matches regardless of viewer when no departments
    const sib = require('../../database/modules/supplierSiblings');
    const fp = '["alpha","beta","gamma","delta"]';
    const src  = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint) VALUES ('s.pdf','/in','needs_review','Old Co',?)").run(fp).lastInsertRowid;
    const cand = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, keyword_fingerprint) VALUES ('c.pdf','/in','needs_review','Old Co',?)").run(fp).lastInsertRowid;
    check('no departments → findSiblings returns the sibling for any viewer (byte-identical)',
      sib.findSiblings(db, src, 'New Co', { viewer: editNone }).map(s => s.id).includes(cand));
    // reprocess filter drops nothing
    const kept = [{ docId: d1 }].filter(d => access.canAccessDocument(db, editNone, d.docId).allow);
    check('no departments → reprocess filter drops nothing', kept.length === 1);
  }

  console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
