'use strict';
/**
 * src/services/directIntakeService.js — the "Quick File" (non-OCR direct intake) lane.
 * QuickFile+Departments plan §3 + eric B.5 → Oracle Q-C1..Q-C12. DARK behind `direct_intake_enabled`.
 *
 * A document that needs no OCR: the user types the company/date/title, we file it into the SAME
 * Company/Year/Month tree as scanned docs and make it searchable — WITHOUT Review, OCR, or learning.
 * Internally an ordinary CONFIRMED `documents` row whose fields were TYPED (extraction_method='typed',
 * documents.intake='direct'). The "never learns" guarantee is the NON-SWITCHABLE learningExcludedSql
 * clause (Q-C1, machine_vias.js); this service simply never calls reviewService.confirm / isAutoFileEligible
 * (F9), so no write-side learning fires either.
 *
 * TRANSPORT-AGNOSTIC + INJECTABLE: every side effect (fs, filing, working-copy, date-normalise, audit,
 * clock) is a dep so the desktop IPC + a future /v1 upload share it and the pin stubs filing. The safe
 * state for a typed row is REFUSAL WITH A REASON (Oracle: fail-toward-review is INVERTED here — a typed
 * doc must never land in a queue), so every guard returns {ok:false, error} and touches nothing.
 *
 * NOT YET (own slices, logged): stage() token map, update()/replace()/bulkUpdate(), tags, the OOXML/PDF
 * search-text extraction (ocr_text is title+notes for now), drag-drop, the watch-folder lane.
 */

const fs = require('fs');
const fileKinds = require('../lib/fileKinds');
const pathContainment = require('../lib/pathContainment');

const MB = 1024 * 1024;
const DEFAULT_MAX_MB = 50;

function getSetting(db, key, dflt) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : dflt; }
  catch { return dflt; }
}
function enabled(db) { return String(getSetting(db, 'direct_intake_enabled', 'false')) === 'true'; }

/**
 * Q-C10 intake-path validator — the ONE gate for EVERY path that becomes a Quick File doc (the OS
 * dialog, drag-drop, the --quickfile arg). Canonicalises ONCE (Oracle: no double-canonicalise / TOCTOU)
 * and checks type / real-file / containment / size against that CANONICAL path, never the raw string.
 * Returns {ok,ext,size,path} on accept, or {refused:<reason>, ...} so the caller can TELL the user —
 * a typed lane's safe state is refusal WITH A REASON, never a silent drop.
 *   reasons: invalid | network | unsupported_type | unresolved | missing | not_a_file | inside_app | too_large
 * @param rawPath  the path as supplied (dialog result / dropped File path / launch arg)
 * @param opts     {userDataDir, outputRoot, maxMb}
 */
function validateIntakePath(rawPath, opts = {}) {
  if (!rawPath || typeof rawPath !== 'string') return { refused: 'invalid' };
  // Network shares (UNC) refused for now — WITH a reason, never silently (a later slice may add them).
  if (/^[\\/]{2}/.test(rawPath)) return { refused: 'network' };
  const ext = fileKinds.normExt(rawPath);
  // Accept-list decides; never-open is defence in depth.
  if (!fileKinds.isIntake(ext) || fileKinds.isNeverOpen(ext)) return { refused: 'unsupported_type', ext };
  const real = pathContainment.realCanonical(rawPath);          // canonicalise ONCE
  if (!real) return { refused: 'unresolved' };                  // exists-but-unverifiable → refuse
  let st;
  try { st = fs.statSync(real); } catch { return { refused: 'missing' }; }
  if (!st.isFile()) return { refused: 'not_a_file' };
  // Never stage a file that lives inside the app's own data or the filing output tree.
  const roots = [opts.userDataDir, opts.outputRoot].filter(Boolean);
  if (pathContainment.targetWithinAnyRoot(real, roots)) return { refused: 'inside_app' };
  const maxMb = Number(opts.maxMb) || DEFAULT_MAX_MB;
  if (st.size > maxMb * MB) return { refused: 'too_large', maxMb };
  return { ok: true, ext, size: st.size, path: real };
}

/**
 * Submit ONE typed document.
 * @param db        better-sqlite3 handle
 * @param actor     {role, username|userId}
 * @param input     {srcPath, ext, size, documentTypeId, party, date, title, reference, notes, departmentId}
 * @param deps      {fs, path, outputRoot, commitDocument, ensureWorkingCopy, normaliseDate, inboxDir,
 *                   logAudit, now, maxMb, canAccessDocument}
 * @returns {{ok:true, docId, storedPath} | {ok:false, error, detail?}}
 */
async function submit(db, actor, input, deps = {}) {
  const now = deps.now || (() => new Date().toISOString());
  const role = actor && actor.role;
  if (!(role === 'admin' || role === 'edit')) return { ok: false, error: 'forbidden' };
  if (!enabled(db)) return { ok: false, error: 'disabled' };

  const { srcPath, size, documentTypeId } = input || {};
  if (!srcPath || !documentTypeId) return { ok: false, error: 'bad_request' };

  // Accept-list decides; never-open is defence in depth (Q-C10). path.extname handles a double ext.
  const ext = fileKinds.normExt(input.ext || (deps.path ? deps.path.extname(srcPath) : srcPath));
  if (!fileKinds.isIntake(ext) || fileKinds.isNeverOpen(ext)) return { ok: false, error: 'unsupported_type', detail: ext };

  const maxMb = Number(deps.maxMb != null ? deps.maxMb : getSetting(db, 'direct_intake_max_mb', DEFAULT_MAX_MB)) || DEFAULT_MAX_MB;
  if (typeof size === 'number' && size > maxMb * MB) return { ok: false, error: 'too_large', detail: `${maxMb}MB` };

  const dt = db.prepare('SELECT * FROM document_types WHERE id = ?').get(documentTypeId);
  if (!dt) return { ok: false, error: 'unknown_type' };
  const refKey = dt.ref_field_key || 'reference_number';   // Quick File presets carry no ref role

  // D2b: validate the create-time department (Oracle 2026-09-17 item 8). This lane creates the row, so the
  // D-C9 widening rule is enforced HERE (no docId yet for canAccessDocument): a non-admin may only tag its
  // OWN active department (or shared, when the switch is off); a foreign/absent id, or shared-while-on for a
  // non-privileged user, is refused. Closes the LAN/Quick File bypass that let intake land any department.
  const _svcDept = deps.departmentService || require('./departmentService');
  const validateDept = deps.validateCreateDepartments || _svcDept.validateCreateDepartments;
  const reqDepts = Array.isArray(input.departmentIds) ? input.departmentIds
                 : (input.departmentId != null ? [input.departmentId] : []);
  const dv = validateDept(db, actor, reqDepts);
  if (!dv.ok) return { ok: false, error: dv.error };
  const deptTargets = dv.target || [];   // number[] (D7: a doc may be in several departments)

  const party = (input.party || '').trim();
  const title = (input.title || (deps.path ? deps.path.parse(srcPath).name : '') || 'Document').trim();
  const notes = (input.notes || '').trim() || null;
  // Date through the every-door normaliser (invalid dates never file — the every-door rule).
  let docDate = null;
  if (input.date) {
    docDate = deps.normaliseDate ? deps.normaliseDate(String(input.date)) : String(input.date);
    if (!docDate) return { ok: false, error: 'bad_date' };
  }

  const insertRow = db.prepare(`INSERT INTO documents
    (original_filename, folder_path, document_type_id, supplier_name, doc_date, reference_number,
     status, overall_confidence, confirmed_at, confirmed_by_username, page_count, ocr_text,
     intake, intake_notes, department_set_by)
    VALUES (@of,@fp,@dt,@sup,@date,@ref,'confirmed',NULL,@ts,@by,@pc,@ocr,'direct',@notes,@setby)`);
  const insertEx = db.prepare(`INSERT INTO extractions
    (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected)
    VALUES (?,?,?,?,100,'typed',0)`);

  const staged = deps.path ? deps.path.dirname(srcPath) : '';
  const originalFilename = deps.path ? deps.path.basename(srcPath) : String(srcPath);

  // Q2 searchable body text — office (OOXML) / born-digital PDF / plain text, NO OCR. Best-effort +
  // async, so computed BEFORE the sync transaction. Absent dep (or a scan/binary) → title+notes only.
  let body = '';
  if (deps.extractSearchText) { try { body = String((await deps.extractSearchText(srcPath, ext)) || ''); } catch {} }

  let docId, storedPath;
  try {
    const tx = db.transaction(() => {
      const ts = now();
      const searchText = ([title, notes, body].filter(Boolean).join('\n').slice(0, 200000)) || null;
      docId = insertRow.run({
        of: originalFilename, fp: staged, dt: documentTypeId, sup: party || null, date: docDate,
        ref: (input.reference || '').trim() || null, ts, by: actor.username || null,
        pc: input.pageCount || null, ocr: searchText, notes,
        setby: deptTargets.length ? 'user' : null,
      }).lastInsertRowid;
      // D7: write the document's department SET into the join (a no-op when shared / departments off).
      if (deptTargets.length) {
        const insDD = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
        for (const d of deptTargets) insDD.run(docId, d);
      }
      // Typed extractions (confidence 100, method 'typed'). Role fields keyed off the doc type.
      const add = (k, v) => { if (k && v != null && String(v).trim() !== '') insertEx.run(docId, k, String(v), String(v)); };
      add('supplier_name', party);
      add(dt.date_field_key, docDate);
      add(refKey, (input.reference || '').trim());   // Quick File presets have ref_field_key null → 'reference_number'
      add('title', title);
    });
    tx();
  } catch (e) { return { ok: false, error: 'db_error', detail: e.message }; }

  // Working copy + filing OUTSIDE the txn (I/O). The user's source is NEVER moved or deleted.
  try {
    const workingPath = deps.ensureWorkingCopy
      ? deps.ensureWorkingCopy(deps.fs, deps.path, deps.inboxDir, srcPath, docId, originalFilename)
      : srcPath;
    const allValues = { supplier_name: party, title,
                        [dt.date_field_key]: docDate, [refKey]: (input.reference || '').trim() };
    const filed = await deps.commitDocument({
      db, fs: deps.fs, path: deps.path, outputRoot: deps.outputRoot, folderPath: staged,
      originalFilename, workingPath, existingFiledPath: null, allValues,
      documentType: dt.name, dtInfo: dt, logger: deps.logger || (() => {}),
    });
    if (!filed || filed.success === false) throw new Error((filed && filed.error) || 'commit failed');
    storedPath = filed.filePath;             // commitDocument returns { success, filename, filePath }
    const storedFilename = filed.filename;
    // Q-C5: NULL working_path after filing so reconcileHolding never deletes the (now-filed) copy;
    // the filed copy is canonical. Then drop the inbox copy (mirrors reviewService re-file).
    db.prepare(`UPDATE documents SET stored_filename=?, stored_path=?, working_path=NULL WHERE id=?`)
      .run(storedFilename || null, storedPath || null, docId);
    if (deps.fs && workingPath && workingPath !== srcPath) { try { deps.fs.unlinkSync(workingPath); } catch {} }
  } catch (e) {
    // Fail-toward-refusal: undo the row (never leave a half-filed typed doc in a stuck list).
    try { db.prepare('DELETE FROM extractions WHERE document_id=?').run(docId); db.prepare('DELETE FROM documents WHERE id=?').run(docId); } catch {}
    return { ok: false, error: 'file_failed', detail: e.message };
  }

  try { if (deps.logAudit) deps.logAudit(db, 'document_direct_intake', { document_id: docId, type: dt.slug, party, department_ids: deptTargets }); } catch {}
  return { ok: true, docId, storedPath };
}

/**
 * Edit a Quick File document's typed details, re-filing when a filing token (company/date/title/reference)
 * changed. Quick File rows only (intake='direct'). Reuses the proven re-file road (commitDocument with
 * existingFiledPath + unlink the old copy/XML — reviewService.js:516-520 pattern); the current FILED copy
 * is the source, since working_path is NULL after the first filing (Q-C5).
 *
 * @param db
 * @param actor  {role, username}
 * @param docId
 * @param patch  {party?, date?, title?, reference?, notes?, departmentId?}  (only provided keys change)
 * @param deps   {fs, path, outputRoot, commitDocument, normaliseDate, logAudit, canAccessDocument?, editGuard?}
 * @returns {{ok:true, docId, storedPath, refiled} | {ok:false, error, detail?}}
 */
async function update(db, actor, docId, patch, deps = {}) {
  const role = actor && actor.role;
  if (!(role === 'admin' || role === 'edit')) return { ok: false, error: 'forbidden' };
  if (!enabled(db)) return { ok: false, error: 'disabled' };
  if (docId == null) return { ok: false, error: 'bad_request' };

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return { ok: false, error: 'not_found' };
  if (doc.intake !== 'direct') return { ok: false, error: 'not_quick_file' };   // only ever a typed row

  // Department / access gate (inert when departments not configured) + edit-lock, when injected.
  if (deps.canAccessDocument) { const a = deps.canAccessDocument(db, actor, docId); if (a && a.allow === false) return { ok: false, error: 'forbidden' }; }
  if (deps.editGuard) { try { deps.editGuard(db, docId); } catch (e) { return { ok: false, error: 'locked', detail: e.message }; } }

  const dt = db.prepare('SELECT * FROM document_types WHERE id = ?').get(doc.document_type_id);
  if (!dt) return { ok: false, error: 'unknown_type' };
  const refKey = dt.ref_field_key || 'reference_number';
  const curTitleRow = db.prepare("SELECT display_value FROM extractions WHERE document_id=? AND field_key='title'").get(docId);

  const p = patch || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const cur = {
    party: doc.supplier_name || '',
    title: (curTitleRow && curTitleRow.display_value) || '',
    reference: doc.reference_number || '',
    notes: doc.intake_notes || '',
  };
  const next = {
    party: has('party') ? String(p.party || '').trim() : cur.party,
    title: has('title') ? (String(p.title || '').trim() || cur.title) : cur.title,
    reference: has('reference') ? String(p.reference || '').trim() : cur.reference,
    notes: has('notes') ? (String(p.notes || '').trim() || null) : (doc.intake_notes || null),
  };
  // Date through the every-door normaliser (invalid dates never file).
  let docDate = doc.doc_date;
  if (has('date')) {
    if (p.date) { docDate = deps.normaliseDate ? deps.normaliseDate(String(p.date)) : String(p.date); if (!docDate) return { ok: false, error: 'bad_date' }; }
    else docDate = null;
  }

  const filingChanged = next.party !== cur.party || next.title !== cur.title
    || next.reference !== cur.reference || (docDate || null) !== (doc.doc_date || null);

  // Re-derive the searchable BODY from the (content-unchanged) current file BEFORE any re-file/unlink, so an
  // edit keeps the doc findable by its body text (not just the new title/notes). Best-effort; '' on absence.
  let body = '';
  const srcForBody = (doc.working_path || doc.stored_path);
  if (deps.extractSearchText && srcForBody) {
    const ext = fileKinds.normExt(doc.original_filename || srcForBody);
    try { body = String((await deps.extractSearchText(srcForBody, ext)) || ''); } catch {}
  }

  // Re-file FIRST (I/O, outside any txn) when a filing token changed — using the current filed copy as
  // the source. Fail-toward-refusal: on any filing error, change nothing.
  let storedPath = doc.stored_path, storedFilename = doc.stored_filename, refiled = false;
  if (filingChanged && doc.stored_path) {
    try {
      const allValues = { supplier_name: next.party, title: next.title, [dt.date_field_key]: docDate, [refKey]: next.reference };
      const filed = await deps.commitDocument({
        db, fs: deps.fs, path: deps.path, outputRoot: deps.outputRoot,
        folderPath: deps.path ? deps.path.dirname(doc.stored_path) : '', originalFilename: doc.original_filename,
        workingPath: doc.stored_path, existingFiledPath: doc.stored_path, allValues,
        documentType: dt.name, dtInfo: dt, logger: deps.logger || (() => {}),
      });
      if (!filed || filed.success === false) throw new Error((filed && filed.error) || 'commit failed');
      const newPath = filed.filePath;
      // Unlink the OLD filed copy + its XML sidecar when the path actually moved (reviewService re-file pattern).
      if (deps.fs && newPath && newPath !== doc.stored_path) {
        try { deps.fs.unlinkSync(doc.stored_path); } catch {}
        if (deps.path) { const ext = deps.path.extname(doc.stored_path);
          const xml = deps.path.join(deps.path.dirname(doc.stored_path), '.metadata', deps.path.basename(doc.stored_path, ext) + '.xml');
          try { deps.fs.unlinkSync(xml); } catch {} }
      }
      storedPath = newPath; storedFilename = filed.filename; refiled = true;
    } catch (e) { return { ok: false, error: 'file_failed', detail: e.message }; }
  }

  // Persist the new values + refreshed search text in one transaction.
  try {
    const tx = db.transaction(() => {
      const searchText = ([next.title, next.notes, body].filter(Boolean).join('\n').slice(0, 200000)) || null;
      // D7: department changes are NOT handled here — the retired scalar is never written; a Quick File
      // doc's departments are changed through the per-document tagger (setDocumentDepartments), the same
      // set-form widening rule as any other document. This edit only touches the typed fields + filing.
      db.prepare(`UPDATE documents SET supplier_name=@sup, doc_date=@date, reference_number=@ref,
        intake_notes=@notes, stored_filename=@sf, stored_path=@sp, ocr_text=@ocr
        WHERE id=@id`).run({
        sup: next.party || null, date: docDate, ref: next.reference || null, notes: next.notes,
        sf: storedFilename || null, sp: storedPath || null, ocr: searchText, id: docId,
      });
      const upsert = (k, v) => {
        if (!k) return;
        const val = (v == null ? '' : String(v));
        const ex = db.prepare('SELECT id FROM extractions WHERE document_id=? AND field_key=?').get(docId, k);
        if (val.trim() === '') { if (ex) db.prepare('DELETE FROM extractions WHERE id=?').run(ex.id); return; }
        if (ex) db.prepare("UPDATE extractions SET raw_value=?, display_value=?, confidence=100, extraction_method='typed', was_corrected=0 WHERE id=?").run(val, val, ex.id);
        else db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected) VALUES (?,?,?,?,100,'typed',0)").run(docId, k, val, val);
      };
      upsert('supplier_name', next.party);
      upsert(dt.date_field_key, docDate);
      upsert(refKey, next.reference);
      upsert('title', next.title);
    });
    tx();
  } catch (e) { return { ok: false, error: 'db_error', detail: e.message }; }

  try { if (deps.logAudit) deps.logAudit(db, 'document_direct_intake_updated', { document_id: docId, refiled }); } catch {}
  return { ok: true, docId, storedPath, refiled };
}

module.exports = { submit, update, enabled, validateIntakePath, DEFAULT_MAX_MB };
