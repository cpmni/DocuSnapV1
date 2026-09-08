#!/usr/bin/env node
'use strict';
/**
 * scripts/remove-superstore-invnum-anchor.js
 * One-off, REVERSIBLE removal of the mis-taught SuperStore invoice_number anchor (label "INVOICE",
 * the document title) that was causing every SuperStore invoice to hold at 69% on the taught-field
 * ownership guard, even though the keyword read the number correctly.
 *
 *   1. Close ScanFinder (so the DB isn't locked).
 *   2. node scripts/remove-superstore-invnum-anchor.js            (dry run — shows what it WOULD delete)
 *      node scripts/remove-superstore-invnum-anchor.js --apply    (backs up the DB, then deletes)
 *
 * Backup: docusnap.backup-<timestamp>.db beside the live DB. To undo, copy it back over docusnap.db.
 * Scoped tightly: supplier LIKE 'superstore%', field_key='invoice_number' ONLY. The invoice_DATE
 * anchor (label "Date:") is left intact.
 */
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const APPLY = process.argv.includes('--apply');
const DB = path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db');
if (!fs.existsSync(DB)) { console.error('DB not found:', DB); process.exit(1); }

const SEL = `SELECT id, supplier_name, field_key, anchor_label, direction, usage_count, last_authoritative_at
             FROM field_anchors WHERE lower(supplier_name) LIKE 'superstore%' AND field_key = 'invoice_number'`;

// Read-only first to show the target.
{
  const ro = new Database(DB, { readonly: true });
  const rows = ro.prepare(SEL).all();
  ro.close();
  console.log(`Found ${rows.length} SuperStore invoice_number anchor(s):`);
  for (const r of rows) console.log('  ', JSON.stringify(r));
  if (!rows.length) { console.log('Nothing to remove — already gone.'); process.exit(0); }
  if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to back up + delete.'); process.exit(0); }
}

// Backup, then delete.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = DB.replace(/\.db$/, `.backup-${stamp}.db`);
fs.copyFileSync(DB, backup);
for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(DB + ext)) fs.copyFileSync(DB + ext, backup + ext); } catch {} }
console.log('Backed up to:', backup);

const db = new Database(DB);           // read-write; requires the app to be CLOSED
db.pragma('busy_timeout = 4000');
const info = db.prepare(`DELETE FROM field_anchors WHERE lower(supplier_name) LIKE 'superstore%' AND field_key = 'invoice_number'`).run();
db.close();
console.log(`Deleted ${info.changes} anchor row(s). Reopen ScanFinder and reprocess the SuperStore queue — the invoice number now reads by keyword and should auto-file.`);
console.log('Undo: copy the backup back over docusnap.db.');
