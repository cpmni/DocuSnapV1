#!/usr/bin/env node
'use strict';

/**
 * scripts/backfill-graduation-issuer-freeze.js
 * --------------------------------------------
 * BACKFILL for the graduation issuer freeze (gary → Oracle SIGN-OFF-W/COND, 2026-08-12): existing
 * graduation-born templates are identity-mute ({is_variable:1, fixed_value:null} on supplier_name),
 * so their scopes' docs read the issuer at the hint cap (85) / logo (~72) forever — under the
 * TRUSTED_FLOOR (95). Freeze the ISSUER ONLY to the scope's established identity, exactly what the
 * create branch now does under `graduation_freeze_issuer`.
 *
 * The sample-angle-backfill pattern: CENSUS (read-only, default) → BACKUP → APPLY → replay gate.
 * Census predicate (Oracle §5, all five clauses):
 *   1. the template's supplier_name field row is variable / null-fixed (or absent);
 *   2. establishedIdentity(db, tplId) non-null;
 *   3. isPlausibleSupplierNameBase(ident) — judging an already-CONFIRMED identity;
 *   4. trust.scopeTrust(db, ident, slug).trusted — the ≥W human-confirm warrant;
 *   5. the identity has ≥DISTINCTIVE_MIN distinctive tokens (the create branch's C2 guarantee —
 *      backfilled templates must be measured against it, not assumed);
 *   6. the template has NO supplier_name geometry MAPPING (template_field_mappings) — a template
 *      that READS its issuer is not identity-mute; freezing it would turn a page-read into a
 *      stamp, outside this design's warrant.
 *
 * Usage (Electron-as-Node; APP CLOSED for apply):
 *   census:  ELECTRON_RUN_AS_NODE=1 electron.exe scripts/backfill-graduation-issuer-freeze.js
 *   apply:   ... APPLY=1  (backs up the DB beside itself first; prints every row it changes)
 */

const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.BF_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
console.log('DB path (resolved):', DB_PATH, '| exists:', fs.existsSync(DB_PATH));
if (!fs.existsSync(DB_PATH)) process.exit(1);

const REPO = path.resolve(__dirname, '..');
const Database  = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust     = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const gt        = require(path.join(REPO, 'database', 'modules', 'graduationTemplate.js'));
const { isPlausibleSupplierNameBase } = require(path.join(REPO, 'database', 'modules', 'learning.js'));

const APPLY = process.env.APPLY === '1';
const db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });

const rows = db.prepare('SELECT id, name, document_type_slug, keyword_fingerprint FROM templates').all();
const plan = [];
for (const t of rows) {
  const supRow = db.prepare(
    "SELECT id, fixed_value, is_variable FROM template_fields WHERE template_id = ? AND field_key = 'supplier_name'"
  ).get(t.id);
  const mute = !supRow || supRow.fixed_value == null;                       // clause 1
  if (!mute) { continue; }
  const ident = (() => { try { return templates.establishedIdentity(db, t.id); } catch { return null; } })();
  const why = [];
  if (!ident) why.push('no-established-identity');                          // clause 2
  else {
    if (!isPlausibleSupplierNameBase(ident)) why.push('implausible-identity');           // clause 3
    else {
      const st = trust.scopeTrust(db, ident, t.document_type_slug || '');
      if (!st.trusted) why.push(`not-graduated (${st.reason})`);            // clause 4
    }
    let kf = []; try { kf = JSON.parse(t.keyword_fingerprint || '[]'); } catch {}
    if (gt.distinctiveTokens(kf).length < gt.DISTINCTIVE_MIN) why.push('thin-identity'); // clause 5
    const mapping = db.prepare(
      "SELECT 1 FROM template_field_mappings WHERE template_id = ? AND field_key = 'supplier_name' LIMIT 1"
    ).get(t.id);
    if (mapping) why.push('has-issuer-mapping (reads its issuer — not mute)');           // clause 6
  }
  plan.push({ id: t.id, name: t.name, slug: t.document_type_slug, ident, supRowId: supRow ? supRow.id : null,
              eligible: why.length === 0, why: why.join('; ') || 'ELIGIBLE' });
}

console.log('\n-- census (identity-mute templates) --');
for (const p of plan) console.log(`tpl ${p.id} | ${p.name} | ${p.slug} | ident: ${p.ident} | ${p.eligible ? '>> FREEZE' : 'skip: ' + p.why}`);
const todo = plan.filter(p => p.eligible);
console.log(`\n${todo.length} template(s) eligible of ${plan.length} identity-mute.`);

if (!APPLY) { console.log('Census only (APPLY=1 to mutate — close the app first).'); db.close(); process.exit(0); }

const backup = DB_PATH.replace(/\.db$/, `_pre_issuerfreeze_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.db`);
db.backup(backup).then(() => {
  console.log('backup done:', backup, fs.statSync(backup).size, 'bytes');
  const upd = db.prepare("UPDATE template_fields SET fixed_value = ?, is_variable = 0 WHERE template_id = ? AND field_key = 'supplier_name'");
  const ins = db.prepare("INSERT INTO template_fields (template_id, field_key, anchor_label, direction, fixed_value, is_variable) VALUES (?, 'supplier_name', NULL, 'right', ?, 0)");
  for (const p of todo) {
    const changed = upd.run(p.ident, p.id).changes;
    if (!changed) ins.run(p.id, p.ident);
    console.log(`APPLIED tpl ${p.id} (${p.name}): supplier_name fixed_value = '${p.ident}'`);
  }
  console.log('\nDone. Rewrite of template debug JSON + replay gate: run the app once (the template');
  console.log('file rewrites on next confirm/update) or run the replay arm per the handover.');
  db.close();
}).catch(e => { console.error('BACKUP FAILED — nothing written:', e.message); db.close(); process.exit(1); });
