'use strict';
// seed-taught-state.js — graft an install's TAUGHT STATE into a fresh sandbox DB.
//
// WHY THIS EXISTS (2026-08-11). `seed-chris-sandbox.js` gives a fresh DB with 0 users, which is the
// right first-run experience but an unrealistic one: a real customer meets the app with suppliers
// already taught. Chris's 2026-08-10 overnight round was run against "the owner's own taught state,
// 7 supplier templates", and re-running him under the SAME conditions means reproducing that.
//
// It copies LEARNING ONLY — templates and their mappings/landmarks/logo hashes, field anchors,
// supplier hints, logo fingerprints. It copies NO documents, NO users, NO extractions, NO
// corrections and NO audit rows, so the sandbox still has an empty queue and the real
// create-first-admin flow.
//
// document_type_id is REMAPPED BY SLUG, never carried across: the two databases seed their built-in
// types independently and the ids do not have to agree. A template whose slug does not exist in the
// sandbox is SKIPPED and reported rather than silently attached to whatever id happened to match —
// binding a template to the wrong type is one of the defects this project has already paid for.
//
// The source is opened READ-ONLY. Point it at a SNAPSHOT, never at the DB a running app is using.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
//     scripts/seed-taught-state.js <source.db> <sandbox-userData>
const path = require('path');
const fs = require('fs');

const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));

const src = process.argv[2];
const dst = process.argv[3];
if (!src || !dst) {
  console.error('usage: seed-taught-state.js <source.db> <sandbox-userData>');
  process.exit(1);
}
const dstDb = path.join(dst, 'docusnap.db');
if (!fs.existsSync(src)) { console.error('source not found: ' + src); process.exit(1); }
if (!fs.existsSync(dstDb)) { console.error('sandbox db not found (seed it first): ' + dstDb); process.exit(1); }

const S = new Database(src, { readonly: true });
const D = new Database(dstDb);

const cols = (db, t) => { try { return db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name); } catch { return []; } };
const has = (db, t) => cols(db, t).length > 0;

// DOCUMENT TYPES FIRST. A taught template binds to a type SLUG, and the owner's install carries
// custom types (service_worksheet, order_confirmation, ...) that a fresh sandbox has never heard
// of. Without this every template bound to a custom type is skipped and the sandbox ends up with
// almost no taught state — which is a silently WRONG reproduction, not an obvious failure.
// Copies only slugs the sandbox lacks, then the fields of those types, so built-ins are untouched.
{
  const dstHave = new Set(D.prepare('SELECT slug FROM document_types').all().map(r => r.slug));
  const tcols = cols(S, 'document_types').filter(c => cols(D, 'document_types').includes(c) && c !== 'id');
  const insT = D.prepare(`INSERT INTO document_types (${tcols.join(',')}) VALUES (${tcols.map(c => '@' + c).join(',')})`);
  const fcols = cols(S, 'fields').filter(c => cols(D, 'fields').includes(c) && c !== 'id');
  const insF = D.prepare(`INSERT INTO fields (${fcols.join(',')}) VALUES (${fcols.map(c => '@' + c).join(',')})`);
  let nt = 0, nf = 0;
  const runTypes = D.transaction(() => {
    for (const t of S.prepare('SELECT * FROM document_types').all()) {
      if (dstHave.has(t.slug)) continue;
      const rec = {}; for (const c of tcols) rec[c] = t[c];
      const newId = insT.run(rec).lastInsertRowid; nt++;
      for (const f of S.prepare('SELECT * FROM fields WHERE document_type_id = ?').all(t.id)) {
        const fr = {}; for (const c of fcols) fr[c] = f[c];
        fr.document_type_id = newId;
        try { insF.run(fr); nf++; } catch { /* duplicate key on the type */ }
      }
    }
  });
  runTypes();
  console.log(`  document_types: ${nt} custom type(s) copied with ${nf} field(s)`);
}

// slug -> id in each database, so a type is matched by MEANING not by number.
const srcSlugById = new Map(S.prepare('SELECT id, slug FROM document_types').all().map(r => [r.id, r.slug]));
const dstIdBySlug = new Map(D.prepare('SELECT id, slug FROM document_types').all().map(r => [r.slug, r.id]));

function copy(table, opts = {}) {
  if (!has(S, table) || !has(D, table)) { console.log(`  ${table}: absent in one side, skipped`); return; }
  const shared = cols(S, table).filter(c => cols(D, table).includes(c) && c !== 'id');
  if (!shared.length) { console.log(`  ${table}: no shared columns, skipped`); return; }
  const rows = S.prepare(`SELECT * FROM ${table}`).all();
  const ins = D.prepare(
    `INSERT INTO ${table} (${shared.join(',')}) VALUES (${shared.map(c => '@' + c).join(',')})`);
  let n = 0, skipped = 0;
  const run = D.transaction(() => {
    for (const r of rows) {
      const rec = {};
      for (const c of shared) rec[c] = r[c];
      if (opts.remapTypeId && rec.document_type_id != null) {
        const slug = srcSlugById.get(rec.document_type_id);
        const id = slug ? dstIdBySlug.get(slug) : undefined;
        if (id == null) { skipped++; continue; }          // never guess a type binding
        rec.document_type_id = id;
      }
      if (opts.idMap && rec[opts.idMap.col] != null) {
        const mapped = opts.idMap.map.get(rec[opts.idMap.col]);
        if (mapped == null) { skipped++; continue; }
        rec[opts.idMap.col] = mapped;
      }
      try { const info = ins.run(rec); n++; if (opts.collect) opts.collect(r.id, info.lastInsertRowid); }
      catch { skipped++; }
    }
  });
  run();
  console.log(`  ${table}: ${n} copied${skipped ? `, ${skipped} skipped` : ''}`);
}

console.log(`taught state: ${src}\n           -> ${dstDb}`);
// templates first, capturing old-id -> new-id so children attach to the right parent.
const tplMap = new Map();
// template_groups FIRST: templates.group_id is a real FOREIGN KEY, and without the parent rows
// every template insert fails with 'FOREIGN KEY constraint failed' — which the copier would report
// only as a skip count. NOTE templates bind their type by  (TEXT), NOT by id,
// so no type remap applies to this table; the slug travels verbatim and the doctype copy above is
// what makes those slugs resolvable.
copy('template_groups');
copy('templates', { collect: (oldId, newId) => tplMap.set(oldId, newId) });
copy('template_fields',         { idMap: { col: 'template_id', map: tplMap } });
copy('template_field_mappings', { idMap: { col: 'template_id', map: tplMap } });
copy('template_landmarks',      { idMap: { col: 'template_id', map: tplMap } });
copy('template_logo_hashes',    { idMap: { col: 'template_id', map: tplMap } });
copy('template_sample_words',   { idMap: { col: 'template_id', map: tplMap } });
copy('template_hidden_fields',  { idMap: { col: 'template_id', map: tplMap } });
// supplier-scoped learning: keyed by NAME + slug string, so no id remap is needed.
copy('field_anchors');
copy('supplier_hints');
copy('logo_fingerprints');
copy('field_label_overrides');

// sample_document_id points at a documents row that does NOT exist here — null it rather than
// leave a dangling reference the template viewer would follow.
try {
  const n = D.prepare('UPDATE templates SET sample_document_id = NULL WHERE sample_document_id IS NOT NULL').run().changes;
  if (n) console.log(`  templates.sample_document_id: nulled ${n} dangling reference(s)`);
} catch { /* column may not exist on an older schema */ }

console.log('\nsandbox now holds:');
for (const t of ['templates', 'template_field_mappings', 'field_anchors', 'supplier_hints', 'logo_fingerprints']) {
  if (has(D, t)) console.log(`  ${t}: ${D.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`);
}
console.log(`  users: ${D.prepare('SELECT COUNT(*) n FROM users').get().n} (0 = create-first-admin flow preserved)`);
console.log(`  documents: ${D.prepare('SELECT COUNT(*) n FROM documents').get().n} (0 = empty queue)`);
S.close(); D.close();
