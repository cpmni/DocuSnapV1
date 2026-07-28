#!/usr/bin/env node
'use strict';

/**
 * src/modules/templates/test_audit_coverage.js
 * STAGE 5a — proves the destructive template handlers now write an audit row (they had ZERO audit
 * coverage before). Registers the REAL templates handler with a fake ipcMain + fake auth (require.cache)
 * whose logAudit captures, and an in-memory DB.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/templates/test_audit_coverage.js
 */
const audits = [];
let role = 'admin';
const fakeAuth = {
  requireRole: (...roles) => { if (!roles.includes(role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return { id: 1, username: 'u', role }; },
  hasRole: (...roles) => roles.includes(role),
  getCurrentUser: () => ({ id: 1, username: 'u', role }),
  logAudit: (_db, e) => audits.push(e),
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const templates = require('../../../database/modules/templates');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const had = (action) => audits.some(a => a.action === action);

const db = new Database(':memory:'); runMigrations(db);
const t1 = Number(templates.create(db, { name: 'Acme', document_type_slug: 'invoice' }));
const t2 = Number(templates.create(db, { name: 'Acme Dup', document_type_slug: 'invoice' }));

const H = {};
require('./handler').register({ ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} }, getDb: () => db,
  resourcePath: (...p) => path.join(__dirname, '..', '..', '..', ...p) });

console.log('\nStage 5a — destructive template handlers write an audit row');
H['rename-template']({}, t1, 'Acme Renamed');
check('rename-template audited', had('template_renamed'));

H['reassign-template-documents']({}, t2, t1);
check('reassign-template-documents audited', had('template_documents_reassigned'));

H['merge-template']({}, t2, t1);
check('merge-template audited', had('template_merged'));
check('  → and it names from/to in metadata', audits.some(a => a.action === 'template_merged' && a.metadata && a.metadata.to === t1));

H['delete-template']({}, t1);
check('delete-template audited', had('template_deleted'));
check('  → the template is actually gone', templates.getById(db, t1) == null);

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All Stage-5a audit-coverage checks passed.');
process.exit(0);
