#!/usr/bin/env node
'use strict';

/**
 * scripts/p2-foreign-field-sweep.js  (P2 — one-time remediation)
 * -------------------------------------------------------------
 * The runtime fix (foreignFields.dropForeignExtractions at the two confirm transitions) is
 * FUTURE-ONLY: documents ALREADY confirmed still carry the foreign extraction rows (e.g. a delivery
 * note showing Invoice/Order/PO Date). This one-time sweep clears them from the existing corpus,
 * using the SAME keep-predicate as the runtime fix so the two can't diverge.
 *
 * DRY RUN by default — reports what WOULD be deleted, touches nothing. Add --apply to delete.
 * Fail-open: an untyped doc, or a type with no field metadata, is SKIPPED (never blanked).
 *
 *   Preview (read-only):
 *     ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/p2-foreign-field-sweep.js
 *   Apply (BACK UP THE DB FIRST):
 *     ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/p2-foreign-field-sweep.js --apply
 *   Custom DB:  --db "C:\\path\\to\\docusnap.db"
 */

const path = require('path');
const Database = require('better-sqlite3');
const { ownFieldPredicate } = require('../src/lib/foreignFields');

function parseArgs(argv) {
  const a = { apply: false, db: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--db') a.db = argv[++i];
  }
  return a;
}

function defaultDbPath() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(base, 'ScanFinder', 'docusnap.db');
}

function buildDtInfo(db, typeId) {
  if (!typeId) return null;
  const t = db.prepare('SELECT id, slug, ref_field_key, date_field_key FROM document_types WHERE id = ?').get(typeId);
  if (!t) return null;
  t.fields = db.prepare('SELECT key FROM fields WHERE document_type_id = ?').all(typeId);
  return t;
}

function main() {
  const args = parseArgs(process.argv);
  const dbPath = args.db || defaultDbPath();
  console.log(`P2 foreign-field sweep — ${args.apply ? 'APPLY (will delete)' : 'DRY RUN (read-only)'}`);
  console.log(`DB: ${dbPath}\n`);

  const db = new Database(dbPath, { readonly: !args.apply, fileMustExist: true });
  const docs = db.prepare("SELECT id, document_type_id FROM documents WHERE status = 'confirmed'").all();

  const byType = new Map();   // slug -> { docs:Set, rows:number }
  const byField = new Map();  // field_key -> rows
  const toDelete = [];        // { docId, field_key }
  let skippedNoType = 0;

  for (const doc of docs) {
    const dtInfo = buildDtInfo(db, doc.document_type_id);
    if (!dtInfo || !Array.isArray(dtInfo.fields) || dtInfo.fields.length === 0) { skippedNoType++; continue; }
    const keep = ownFieldPredicate(dtInfo);
    const keys = db.prepare('SELECT DISTINCT field_key FROM extractions WHERE document_id = ?').all(doc.id);
    for (const { field_key } of keys) {
      if (keep(field_key)) continue;
      toDelete.push({ docId: doc.id, field_key });
      byField.set(field_key, (byField.get(field_key) || 0) + 1);
      const slug = dtInfo.slug || `type#${dtInfo.id}`;
      const rec = byType.get(slug) || { docs: new Set(), rows: 0 };
      rec.docs.add(doc.id); rec.rows++; byType.set(slug, rec);
    }
  }

  console.log(`Confirmed docs scanned: ${docs.length}  (skipped, untyped/no-metadata: ${skippedNoType})`);
  console.log(`Foreign extraction rows found: ${toDelete.length}\n`);
  if (byType.size) {
    console.log('By document type:');
    for (const [slug, rec] of [...byType.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
      console.log(`  ${slug.padEnd(20)} ${String(rec.rows).padStart(5)} rows across ${rec.docs.size} docs`);
    }
    console.log('\nBy foreign field key:');
    for (const [k, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(24)} ${String(n).padStart(5)}`);
    }
  }

  if (!args.apply) {
    console.log('\nDRY RUN — nothing deleted. BACK UP THE DB, then re-run with --apply to delete these rows.');
    db.close();
    return;
  }
  if (toDelete.length === 0) { console.log('\nNothing to delete.'); db.close(); return; }

  const del = db.prepare('DELETE FROM extractions WHERE document_id = ? AND field_key = ?');
  const tx = db.transaction((rows) => { let n = 0; for (const r of rows) n += del.run(r.docId, r.field_key).changes; return n; });
  const deleted = tx(toDelete);
  console.log(`\nAPPLIED — deleted ${deleted} foreign extraction rows.`);
  db.close();
}

main();
