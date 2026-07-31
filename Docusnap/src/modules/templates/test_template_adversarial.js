#!/usr/bin/env node
'use strict';

/**
 * src/modules/templates/test_template_adversarial.js
 * 2026-07-31 hardening pins (overnight robustness sweep — coverage-gap inventory):
 *   - save-template-mapping GEOMETRY VALIDATION: NaN / negative / >1 / zero-area /
 *     off-page boxes are refused (they previously persisted straight into Stage-0.5
 *     geometry as silent future mis-crops). PIN: anchor==target stays ALLOWED — the
 *     teach wizard's POSITION-ONLY issuer mapping is exactly that (teach/renderer.js
 *     ~:992); a future "tidy-up" identity refusal would break every teach commit.
 *   - reassign-template-documents: nonexistent TARGET refused cleanly (ok:false,
 *     'target-missing') instead of relying on the FK throw; reassign is behaviourally
 *     reversible (A→B then B→A restores the links).
 *   - AUDIT OUTCOME HONESTY: a refused reassign/merge audits outcome 'failure' with a
 *     reason — never 'success' for a mutation that did not happen.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/templates/test_template_adversarial.js
 */
const audits = [];
const fakeAuth = {
  requireRole: () => ({ id: 1, username: 'u', role: 'admin' }),
  hasRole: () => true,
  getCurrentUser: () => ({ id: 1, username: 'u', role: 'admin' }),
  logAudit: (_db, e) => audits.push(e),
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
// License gate stubbed permissive — this suite tests geometry/audit behaviour, not licensing.
const licPath = require.resolve('../licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: { licenseDenied: () => null } };

const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const templates = require('../../../database/modules/templates');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const lastAudit = (action) => [...audits].reverse().find(a => a.action === action);

const db = new Database(':memory:'); runMigrations(db);
const t1 = Number(templates.create(db, { name: 'Acme', document_type_slug: 'invoice' }));
const t2 = Number(templates.create(db, { name: 'Acme Dup', document_type_slug: 'invoice' }));

const H = {};
require('./handler').register({ ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} }, getDb: () => db,
  resourcePath: (...p) => path.join(__dirname, '..', '..', '..', ...p) });

const GOOD = {
  field_key: 'invoice_number', page_number: 0, anchor_text: 'Invoice No.',
  anchor_x_norm: 0.70, anchor_y_norm: 0.10, anchor_w_norm: 0.10, anchor_h_norm: 0.02,
  target_x_norm: 0.82, target_y_norm: 0.10, target_w_norm: 0.10, target_h_norm: 0.02,
};
const save = (over) => H['save-template-mapping']({}, t1, { ...GOOD, ...over });

console.log('\n§1 save-template-mapping geometry validation');
check('well-formed mapping saves', save({}).success === true);
check('NaN coordinate refused', save({ anchor_x_norm: NaN }).success === false);
check('string-garbage coordinate refused', save({ target_y_norm: 'abc' }).success === false);
check('negative coordinate refused', save({ anchor_x_norm: -0.2 }).success === false);
check('coordinate > 1 refused', save({ target_x_norm: 1.4 }).success === false);
check('zero-width target refused (no area)', save({ target_w_norm: 0 }).success === false);
check('zero-height anchor refused (no area)', save({ anchor_h_norm: 0 }).success === false);
check('off-page box refused (x + w > 1)', save({ target_x_norm: 0.95, target_w_norm: 0.10 }).success === false);
check('whole-page box (0,0,1,1) is ALLOWED (on-page, has area — teach may draw big)',
      save({ anchor_x_norm: 0, anchor_y_norm: 0, anchor_w_norm: 1, anchor_h_norm: 1,
             target_x_norm: 0, target_y_norm: 0, target_w_norm: 1, target_h_norm: 1 }).success === true);
check('PIN: anchor==target (teach POSITION-ONLY issuer mapping) stays ALLOWED',
      save({ anchor_x_norm: GOOD.target_x_norm, anchor_y_norm: GOOD.target_y_norm,
             anchor_w_norm: GOOD.target_w_norm, anchor_h_norm: GOOD.target_h_norm }).success === true);
check('refused mapping did not persist',
      !templates.getMappings(db, t1).some(m => Number.isNaN(m.anchor_x_norm) || m.target_w_norm === 0));

console.log('\n§2 reassign: target existence + reversibility + audit honesty');
{
  // two docs linked to t2
  const mkDoc = () => db.prepare(
    "INSERT INTO documents (original_filename, folder_path, status, template_id) VALUES ('a.pdf', 'C:/in', 'confirmed', ?)"
  ).run(t2).lastInsertRowid;
  const d1 = mkDoc(), d2 = mkDoc();

  const bad = H['reassign-template-documents']({}, t2, 999999);
  check('nonexistent target refused (ok:false target-missing)', bad.ok === false && bad.reason === 'target-missing');
  check('links untouched by the refused reassign',
        db.prepare('SELECT COUNT(*) c FROM documents WHERE template_id = ?').get(t2).c === 2);
  const aBad = lastAudit('template_documents_reassigned');
  check("PIN: refused reassign audits outcome 'failure' with a reason",
        aBad && aBad.outcome === 'failure' && aBad.metadata && aBad.metadata.reason === 'target-missing');

  const fwd = H['reassign-template-documents']({}, t2, t1);
  check('real reassign moves both links', fwd.moved === 2
        && db.prepare('SELECT COUNT(*) c FROM documents WHERE template_id = ?').get(t1).c === 2);
  const aGood = lastAudit('template_documents_reassigned');
  check("successful reassign audits 'success' with the moved count",
        aGood && aGood.outcome === 'success' && aGood.metadata && aGood.metadata.moved === 2);
  const back = H['reassign-template-documents']({}, t1, t2);
  check('reassign is reversible (B→A restores)', back.moved === 2
        && db.prepare('SELECT COUNT(*) c FROM documents WHERE template_id = ?').get(t2).c === 2
        && db.prepare('SELECT template_id FROM documents WHERE id = ?').get(d1).template_id === t2
        && db.prepare('SELECT template_id FROM documents WHERE id = ?').get(d2).template_id === t2);
}

console.log('\n§3 merge audit honesty');
{
  const selfMerge = H['merge-template']({}, t1, t1);
  check('self-merge refused by the module', selfMerge.ok === false);
  const aSelf = lastAudit('template_merged');
  check("PIN: refused merge audits 'failure' — the log never asserts a merge that didn't happen",
        aSelf && aSelf.outcome === 'failure');
}

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All template adversarial checks passed.');
process.exit(0);
