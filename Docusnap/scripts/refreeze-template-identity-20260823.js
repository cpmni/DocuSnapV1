#!/usr/bin/env node
'use strict';
/**
 * scripts/refreeze-template-identity-20260823.js — re-freeze template identities lost to the
 * IDENTITY UNFREEZE CLASS (found 2026-08-22 night; Oracle SIGN-OFF-W/COND C9.4).
 *
 * WHAT HAPPENED: `_fieldsWithMultipleConfirmedValues` counted distinct confirmed issuer values over the
 * WHOLE DOCUMENT TYPE, so a second sender of a type (or one confirmed garble row) made `supplier_name`
 * "multi-valued" and the next template upsert set its frozen identity to NULL. With no `template_fixed`
 * seed, every keep rule had nothing to keep. The code fix (per-template DOMINANCE) stops new unfreezes;
 * this script repairs the existing ones — and rewrites the template FILE, which the Python matcher reads
 * (Chris 15 card 2), so a DB-only repair would be cosmetic.
 *
 * RULE (C9.4): a template whose supplier_name row is `is_variable = 1`, not `fixed_locked`, not
 * `identity_unconfirmed`, and whose OWN confirmed documents carry ONE dominant issuer with
 * count ≥ 3 AND share ≥ 90 % AND a plausible company-name read → frozen to that issuer,
 * `fixed_source = 'refreeze'`. REFUSES to apply unless `template_identity_on_page = 'true'` (the guard
 * that keeps a re-frozen identity from stamping a page that does not name it).
 *
 * DRY-RUN by default — prints what it would do. `--apply` writes. The owner applies on the LIVE install in
 * the morning; tonight it runs against copies only.
 *
 * Usage:  ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/refreeze-template-identity-20260823.js <db> [--apply] [--templates-dir <dir>]
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));
const learning  = require(path.join(ROOT, 'database', 'modules', 'learning'));

const args = process.argv.slice(2);
const dbPath = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');
const tdIdx = args.indexOf('--templates-dir');
const templatesDir = tdIdx >= 0 ? args[tdIdx + 1] : null;
if (!dbPath) { console.error('usage: refreeze-template-identity-20260823.js <db> [--apply] [--templates-dir <dir>]'); process.exit(2); }

const MIN_COUNT = 3, MIN_SHARE = 0.9;
const db = new Database(dbPath, { readonly: !apply });
const onPage = learning.getSetting(db, 'template_identity_on_page', 'false') === 'true';
const rows = db.prepare(`
  SELECT t.id, t.name, t.document_type_slug, COALESCE(t.identity_unconfirmed, 0) AS unconfirmed,
         tf.id AS tf_id, tf.fixed_value, tf.is_variable, COALESCE(tf.fixed_locked, 0) AS locked
    FROM templates t LEFT JOIN template_fields tf ON tf.template_id = t.id AND tf.field_key = 'supplier_name'
   ORDER BY t.id`).all();

const plan = [];
for (const r of rows) {
  const tag = `#${r.id} ${r.name} [${r.document_type_slug}]`;
  if (!r.tf_id) { plan.push({ id: r.id, tag, action: 'skip', why: 'no supplier_name field row' }); continue; }
  if (r.is_variable === 0 && String(r.fixed_value || '').trim()) { plan.push({ id: r.id, tag, action: 'ok', why: `frozen '${r.fixed_value}'` }); continue; }
  if (r.locked) { plan.push({ id: r.id, tag, action: 'skip', why: 'fixed_locked (admin literal)' }); continue; }
  if (r.unconfirmed) { plan.push({ id: r.id, tag, action: 'skip', why: 'identity_unconfirmed (hold-siblings pending)' }); continue; }
  const dom = templates.getDominantSupplier(db, r.id, null);
  if (!dom) { plan.push({ id: r.id, tag, action: 'skip', why: 'no confirmed documents' }); continue; }
  const share = dom.count / dom.total;
  if (dom.count < MIN_COUNT || share < MIN_SHARE) { plan.push({ id: r.id, tag, action: 'skip', why: `dominant '${dom.value}' ${dom.count}/${dom.total} (${Math.round(share * 100)} %) below ${MIN_COUNT} / ${MIN_SHARE * 100} %` }); continue; }
  let implausible = false;
  try { implausible = !!learning.issuerReadLooksImplausible(dom.value); } catch { implausible = false; }
  if (implausible) { plan.push({ id: r.id, tag, action: 'skip', why: `dominant '${dom.value}' reads implausible` }); continue; }
  plan.push({ id: r.id, tag, action: 'refreeze', why: `'${dom.value}' ${dom.count}/${dom.total} (${Math.round(share * 100)} %)`, value: dom.value, tfId: r.tf_id });
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${dbPath}`);
console.log(`template_identity_on_page = ${onPage}`);
for (const p of plan) console.log(`  ${p.action.padEnd(8)} ${p.tag} — ${p.why}`);
const todo = plan.filter(p => p.action === 'refreeze');
console.log(`\n${todo.length} template(s) to re-freeze; ${plan.filter(p => p.action === 'ok').length} already frozen; ${plan.filter(p => p.action === 'skip').length} skipped.`);

if (!apply) { console.log('\n(dry run — pass --apply to write; needs --templates-dir to rewrite the template files the matcher reads)'); process.exit(0); }
if (!onPage) { console.error('\nREFUSED: template_identity_on_page is not ON — a re-frozen identity must stay behind the on-page guard. Flip it first.'); process.exit(3); }
if (!templatesDir || !fs.existsSync(templatesDir)) { console.error('\nREFUSED: --templates-dir <dir> is required and must exist (the Python matcher reads the FILE).'); process.exit(3); }

const upd = db.prepare("UPDATE template_fields SET fixed_value = ?, is_variable = 0, fixed_source = 'refreeze', fixed_set_at = datetime('now') WHERE id = ?");
let n = 0;
const { _writeTemplateFileForSync } = require(path.join(ROOT, 'src', 'modules', 'review', 'handler'));
for (const p of todo) {
  upd.run(p.value, p.tfId);
  try { _writeTemplateFileForSync(db, p.id, templatesDir); } catch (e) { console.warn(`  file rewrite failed for #${p.id}: ${e.message}`); }
  try {
    db.prepare(`INSERT INTO audit_log (action, action_category, target_type, target_id, outcome, details, created_at)
                VALUES ('template_identity_refrozen', 'learning', 'template', ?, 'success', ?, datetime('now'))`)
      .run(p.id, JSON.stringify({ value: p.value, why: p.why, script: 'refreeze-template-identity-20260823' }));
  } catch { /* audit schema may differ on old DBs */ }
  n++;
  console.log(`  re-froze ${p.tag} → '${p.value}'`);
}
console.log(`\nApplied: ${n} template(s) re-frozen; files rewritten under ${templatesDir}.`);
