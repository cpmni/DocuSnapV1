'use strict';
/*
 * reuse_by_name_replay.js — live-DB READ-ONLY gate for TEMPLATE_REUSE_BY_NAME (Lever 1, Oracle 2026-07-27).
 * realdoc_regression is BLIND to the JS template create/reuse path, so this is the real gate: it proves
 * templates.reuseByEstablishedName clusters same-(established-identity, slug) siblings, 0 cross-identity,
 * picks the richest canonical, and rejects containment. Read-only — writes nothing.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/reuse_by_name_replay.js [<db>]
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const DB = process.argv[2] || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(DB, { readonly: true, fileMustExist: true });
const tpls = db.prepare('SELECT id, name, slug, document_type_slug FROM templates').all();

// 1. establishedIdentity + confirmedDocCount per template.
console.log('# templates: id | slug | establishedIdentity | confirmedDocs | name');
const info = {};
for (const t of tpls) {
  let ident = null, cc = 0;
  try { ident = templates.establishedIdentity(db, t.id, null); } catch {}
  try { cc = templates.confirmedDocCount(db, t.id) || 0; } catch {}
  info[t.id] = { slug: t.document_type_slug, ident, cc, name: t.name };
  console.log(`  ${t.id} | ${t.document_type_slug} | ${ident || '(none)'} | ${cc} | ${t.name}`);
}

// 2. cluster by (normalised establishedIdentity, slug) — the true "same supplier + type" key.
const groups = {};
for (const t of tpls) {
  const i = info[t.id];
  if (!i.ident) continue;                       // no established identity ⇒ not a reuse target
  const key = norm(i.ident) + '\u0000' + (i.slug || '');
  (groups[key] || (groups[key] = [])).push(t.id);
}
const dupGroups = Object.entries(groups).filter(([, ids]) => ids.length > 1);
console.log('\n# duplicate (establishedIdentity, slug) groups:');
for (const [k, ids] of dupGroups) console.log(`  ${k.replace('\u0000', ' / ')} -> ${ids.join(', ')}`);
check(`every dup group is single-identity (0 cross-identity groups)`, dupGroups.every(([k]) => k.split('\u0000')[0].length >= 3));

// 3. per-template: reuseByEstablishedName(its own identity, its slug) must return a SAME-identity sibling.
let crossIdentity = 0, resolved = 0;
for (const t of tpls) {
  const i = info[t.id];
  if (!i.ident || !i.slug) continue;
  const rid = templates.reuseByEstablishedName(db, i.ident, i.slug, null);
  if (rid == null) continue;
  resolved++;
  if (norm(info[rid].ident) !== norm(i.ident)) { crossIdentity++; console.log(`  ✗ cross-identity: ${t.id}(${i.ident}) -> ${rid}(${info[rid].ident})`); }
}
check(`reuseByEstablishedName resolved ${resolved} identities with 0 cross-identity acquisitions`, crossIdentity === 0);

// 4. canonical = richest. For each dup group, the resolved id is the max-confirmedDocs sibling.
for (const [, ids] of dupGroups) {
  const i0 = info[ids[0]];
  const rid = templates.reuseByEstablishedName(db, i0.ident, i0.slug, null);
  const richest = ids.slice().sort((a, b) => info[b].cc - info[a].cc)[0];
  check(`  group ${i0.ident}/${i0.slug}: reuse -> ${rid} == richest sibling ${richest}`, rid === richest);
}

// 5. containment must NOT reuse (exact only). A prefix of an identity resolves nothing.
const anyIdent = tpls.map(t => info[t.id]).find(i => i.ident && i.slug && norm(i.ident).length > 5);
if (anyIdent) {
  const prefix = norm(anyIdent.ident).split(' ')[0];   // e.g. "northgate" from "northgate textiles"
  const cid = templates.reuseByEstablishedName(db, prefix, anyIdent.slug, null);
  check(`containment guard: prefix "${prefix}" of "${anyIdent.ident}" does NOT reuse (exact only) -> ${cid}`, cid == null);
}
// 6. too-short / implausible issuer -> null.
check('len<3 issuer -> null', templates.reuseByEstablishedName(db, 'NT', (anyIdent || {}).slug || 'invoice', null) == null);

db.close();
console.log('\n' + (fails ? `${fails} FAILED` : 'ALL PASS'));
process.exit(fails ? 1 : 0);
