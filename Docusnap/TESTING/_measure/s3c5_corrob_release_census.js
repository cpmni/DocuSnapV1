#!/usr/bin/env node
'use strict';
/*
 * TESTING/_measure/s3c5_corrob_release_census.js — REREAD_HOLD_CORROB_RELEASE, Oracle C17 (2026-09-07): the
 * AUTO-FILE ELIGIBILITY DELTA. Over a db.backup() COPY: every extraction row carrying the S3-C5 "Read differently
 * after learning" sentence → would the release predicate (licensed + keyword witness, non-identity) fire on its
 * CURRENT record → with that sentence stripped and a baseline corrected_to cleared, does isAutoFileEligible flip
 * the document ineligible → eligible? Every flipped doc is listed for the owner to vet against its page.
 * Read-only on the copy (the overlay is in-memory).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/s3c5_corrob_release_census.js <copy.db>
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const trust = require(path.join(ROOT, 'database', 'modules', 'trust'));
const dbPath = process.argv[2];
if (!dbPath) { console.error('usage: <copy.db>'); process.exit(2); }
const db = new Database(dbPath, { readonly: true });
const S3C5 = /Read differently after learning — was '([^']*)', now '([^']*)'\. Please check which is right\./;
const rows = db.prepare(`SELECT e.document_id, e.field_key, e.display_value, e.validation_note, e.corrected_to, e.corroboration, d.status
                         FROM extractions e JOIN documents d ON d.id = e.document_id
                         WHERE e.validation_note LIKE '%Read differently after learning%'`).all();
console.log(`rows carrying the S3-C5 sentence: ${rows.length}`);
let predicateFires = 0, flips = [], identityRows = 0, noKeyword = 0, disagree = 0, notNeedsReview = 0;
for (const r of rows) {
  if (r.field_key === 'supplier_name') { identityRows++; continue; }
  const rec = (() => { try { return JSON.parse(r.corroboration || 'null'); } catch { return null; } })();
  if (!trust._corrobLicensedKeyword(rec)) {
    if (trust._corrobLicensed(rec)) noKeyword++;
    else if (rec && Array.isArray(rec.disagree) && rec.disagree.length) disagree++;
    continue;
  }
  predicateFires++;
  const m = S3C5.exec(r.validation_note || '');
  const was = m ? m[1] : null;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(r.document_id);
  if (doc.status !== 'needs_review') { notNeedsReview++; }
  const all = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(r.document_id);
  const before = trust.isAutoFileEligible(db, doc, { extractions: all });
  const overlay = all.map(x => x.field_key !== r.field_key ? x : {
    ...x,
    validation_note: String(x.validation_note || '').replace(S3C5, '').replace(/\s{2,}/g, ' ').trim() || null,
    corrected_to: (was !== null && String(x.corrected_to || '').trim() === was) ? null : x.corrected_to,
  });
  const after = trust.isAutoFileEligible(db, doc, { extractions: overlay });
  if (!before.eligible && after.eligible) flips.push({ id: r.document_id, file: doc.original_filename, field: r.field_key, value: r.display_value, was, before: before.reason, after: after.reason });
}
console.log(`identity rows skipped: ${identityRows} · licensed-but-no-keyword (T1 holds): ${noKeyword} · disagree (T2 holds): ${disagree}`);
console.log(`predicate fires (would release): ${predicateFires} · of which not needs_review: ${notNeedsReview}`);
console.log(`AUTO-FILE ELIGIBILITY DELTA (ineligible → eligible): ${flips.length}`);
for (const f of flips) console.log('  FLIP', JSON.stringify(f));
