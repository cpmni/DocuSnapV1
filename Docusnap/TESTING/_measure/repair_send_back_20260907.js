#!/usr/bin/env node
'use strict';
/*
 * TESTING/_measure/repair_send_back_20260907.js — owner order 2026-09-07 evening: "learning repair those 4 invoice
 * dates and doc 99". Runs the app's OWN Learning-Repair door (repairService.sendBackToReview — the exact function the
 * Settings → Learning Repair panel's `repair-deconfirm` IPC calls: de-confirm + retract this doc's confirm-planted
 * hints + delete its corrections rows + stamp the suspect-field note) on the LIVE DB, after a db.backup() copy.
 * Audit rows are written through the same audit module the IPC uses when it can be loaded; else noted.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/repair_send_back_20260907.js [--dry]
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const LIVE = 'C:/Users/cmccu/AppData/Roaming/ScanFinder/docusnap.db';
const BACKUP = path.join(__dirname, 'live_backup_20260907_before_repair.db');
const dry = process.argv.includes('--dry');
const repairService = require(path.join(ROOT, 'src', 'services', 'repairService'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));

const PLAN = [
  { id: 42, field: 'invoice_date', note: "the confirmed date '06-06-2026' is the clipped read from the mis-placed box; the healed re-read prints 26/06/2026 — check the page" },
  { id: 25, field: 'invoice_date', note: "the confirmed date '09-10-2026' is the clipped read from the mis-placed box; the healed re-read prints 19/10/2026 — check the page" },
  { id: 27, field: 'invoice_date', note: "the confirmed date '03-01-2026' is the clipped read from the mis-placed box; three independent reads print 28/01/2026 — check the page" },
  { id: 40, field: 'invoice_date', note: "the confirmed date '09-09-2026' is the clipped read from the mis-placed box; the healed re-read prints 15/09/2026 — check the page" },
  { id: 99, field: 'reference_number', note: "filed by the sweep as lowercase 'ws-55718'; the page prints 'WS-55718' — check the case" },
];

(async () => {
  const src = new Database(LIVE, { readonly: true });
  await src.backup(BACKUP);
  src.close();
  console.log('backup:', BACKUP);
  const db = new Database(LIVE);
  db.pragma('busy_timeout = 5000');
  // The app's logAudit = auth.addAuditEntry(db, { user_id: session, ...entry }) (src/modules/auth/handler.js);
  // outside the app there is no session → user_id null, the rest identical.
  let logAudit = null;
  try {
    const auth = require(path.join(ROOT, 'database', 'modules', 'auth'));
    logAudit = (db, entry) => auth.addAuditEntry(db, { user_id: null, ...entry });
  } catch {}
  for (const p of PLAN) {
    const before = db.prepare('SELECT id, status, confirmed_via, learning_excluded_at FROM documents WHERE id = ?').get(p.id);
    const val = db.prepare('SELECT display_value FROM extractions WHERE document_id = ? AND field_key = ?').get(p.id, p.field);
    console.log(`doc ${p.id} before:`, JSON.stringify(before), p.field, '=', val && val.display_value);
    if (dry) continue;
    if (!before || before.status !== 'confirmed') { console.log('  skip: not confirmed'); continue; }
    const r = repairService.sendBackToReview(db, p.id, { suspects: [{ field: p.field, note: p.note }], source: 'repair' });
    console.log('  sendBackToReview →', JSON.stringify(r));
    if (r.ok && logAudit) {
      try { logAudit(db, { action: 'repair_send_to_review', action_category: 'document', target_type: 'document', target_id: p.id, outcome: 'success', details: JSON.stringify({ ...r.unplanted, by: 'owner order via Claude, 2026-09-07' }) }); }
      catch (e) { console.log('  audit skipped:', e.message); }
    }
    const after = db.prepare('SELECT status, confirmed_via, put_back_at FROM documents WHERE id = ?').get(p.id);
    const note = db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?').get(p.id, p.field);
    console.log('  after:', JSON.stringify(after), '| note:', (note && note.validation_note || '').slice(0, 90));
  }
  console.log('review count now:', documents.getReviewCount(db), dry ? '(dry run — nothing written)' : '');
  console.log('audit:', logAudit ? 'written' : 'NOT written (audit module not loadable outside the app)');
  db.close();
})();
