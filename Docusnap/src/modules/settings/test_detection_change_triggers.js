'use strict';
/*
 * test_detection_change_triggers.js — QUIET REDETECT trigger wiring (2026-09-24; eric Q1/Q5 → Oracle C7).
 * Behaviour pins against a fake ipcMain with the doctypes / label-override modules scripted and processing/handler's
 * scheduleQuietRedetect SPIED: each detection-change door schedules exactly once with the right {typeSlug, overrideKey,
 * reason}; a refused / no-op write schedules nothing; a THROWING scheduler never fails the write (the settings result
 * is returned unchanged). Model: test_field_broadcast.js.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/settings/test_detection_change_triggers.js
 */
const path = require('path');
const Module = require('module');
let pass = 0, fail = 0;
const check = (label, ok, extra) => { if (ok) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); } };
const HANDLER = path.join(__dirname, 'handler.js');

const calls = [];
let schedulerThrows = false;
const script = {
  create: () => ({ success: true, id: 41, type: { id: 41, slug: 'quote' } }),
  presets: () => [{ slug: 'credit_note', status: 'added', id: 42 }, { slug: 'receipt', status: 'already_present' }, { slug: 'bad', status: 'error' }],
  addType: () => ({ lastInsertRowid: 43, changes: 1 }),
  updateType: () => ({}),
  addOverride: () => ({ ok: true, inserted: 1 }),
  addOverrides: () => ({ ok: true, inserted: 2 }),
  delOverride: () => ({ ok: true, deleted: 1 }),
};
// a tiny fake DB: the helper resolves a slug by type id; update-document-type reads the prior row; delete reads the override row
const typeRows = { 41: { slug: 'quote', enabled: 1 }, 42: { slug: 'credit_note', enabled: 1 }, 43: { slug: 'delivery_note', enabled: 1 }, 50: { slug: 'statement', enabled: 0 }, 51: { slug: 'invoice', enabled: 1 } };
const fakeDb = {
  prepare: (sql) => ({
    get: (id) => {
      if (/FROM document_types WHERE id = \?/.test(sql)) { const r = typeRows[id]; return r ? { slug: r.slug, enabled: r.enabled, name: r.slug } : undefined; }
      if (/FROM field_label_overrides WHERE id = \?/.test(sql)) return id === 7 ? { doc_type_slug: 'quote', field_key: 'quote_number' } : undefined;
      return undefined;
    },
    all: () => [], run: () => ({ changes: 1 }),
  }),
  transaction: (fn) => (...a) => fn(...a),
};
const realLoad = Module._load;
const noop = () => {};
Module._load = function (request, parent) {
  if (parent && parent.filename === HANDLER) {
    if (/document_types$/.test(String(request))) {
      return {
        createTypeWithFields: (...a) => script.create(...a), addPresetTypes: (...a) => script.presets(...a),
        addType: (...a) => script.addType(...a), updateType: (...a) => script.updateType(...a),
        normaliseTitleAliases: () => ({ notices: [] }), ensureStructuralRoles: noop,
        getAll: () => [], getAllWithFields: () => [], getAllWithFieldsAll: () => [], getPresetCatalog: () => [],
      };
    }
    if (/label_overrides$/.test(String(request))) {
      return { listLabelOverrides: () => [], addLabelOverride: (...a) => script.addOverride(...a), addLabelOverrides: (...a) => script.addOverrides(...a), deleteLabelOverride: (...a) => script.delOverride(...a) };
    }
    if (/processing\/handler$/.test(String(request))) {
      return { scheduleQuietRedetect: (db, info) => { if (schedulerThrows) throw new Error('lane exploded'); calls.push(info); return true; }, scheduleQuietReread: () => false };
    }
    if (/auth\/handler$/.test(String(request))) {
      return new Proxy({}, { get: (_t, k) => (k === 'getCurrentUser' ? () => ({ username: 't', role: 'admin' }) : noop) });
    }
  }
  return realLoad.apply(this, arguments);
};
const handlers = {};
const mod = require(HANDLER);
const ctx = {
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} },
  getDb: () => fakeDb, db: fakeDb,
  notifyAllWindows: noop, notifyMainWindow: noop, logger: { log: noop, warn: noop, error: noop },
  logAudit: noop, requireRole: noop, requireLogin: noop, getCurrentUser: () => ({ username: 't', role: 'admin' }),
};
let registered = false;
try { const reg = (mod && (mod.register || mod.init)) || (typeof mod === 'function' ? mod : null); if (typeof reg === 'function') { reg(ctx); registered = true; } }
catch (e) { console.log('  (register threw: ' + (e && e.message) + ')'); }
check('the settings handler registers against the fake ctx', registered && typeof handlers['create-doc-type-with-fields'] === 'function', Object.keys(handlers).length + ' handlers');

const last = () => calls[calls.length - 1];
async function tryCall(name, ...args) { try { return await handlers[name]({}, ...args); } catch (e) { return { threw: e.message }; } }

async function run() {
  if (!registered) return;
  console.log('\n1. each detection-change door schedules once with the right shape');
  calls.length = 0;
  await tryCall('create-doc-type-with-fields', { name: 'Quote', fields: [] });
  check('create-doc-type-with-fields → { typeSlug quote, reason type-created }', calls.length === 1 && last().typeSlug === 'quote' && last().reason === 'type-created', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('add-doctype-presets', ['credit_note', 'receipt', 'bad']);
  check('add-doctype-presets → ONLY the added slug schedules', calls.length === 1 && last().typeSlug === 'credit_note' && last().reason === 'type-added', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('add-document-type', { name: 'Delivery Note' });
  check('add-document-type → resolves the new id to its slug', calls.length === 1 && last().typeSlug === 'delivery_note', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('update-document-type', 51, { title_aliases: ['Tax Invoice'] });
  check('update-document-type with title_aliases → alias-edited', calls.length === 1 && last().typeSlug === 'invoice' && last().reason === 'alias-edited', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('update-document-type', 50, { enabled: true });
  check('update-document-type enabled 0→1 → type-enabled (Oracle C7)', calls.length === 1 && last().typeSlug === 'statement' && last().reason === 'type-enabled', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('update-document-type', 51, { enabled: true });
  check('update-document-type enabled 1→1 → NO schedule', calls.length === 0, JSON.stringify(calls));
  calls.length = 0;
  await tryCall('update-document-type', 51, { name: 'Invoice (renamed)' });
  check('update-document-type name-only → NO schedule', calls.length === 0, JSON.stringify(calls));
  calls.length = 0;
  await tryCall('add-label-override', { doc_type_slug: 'quote', field_key: 'total_amount', label: 'Total (inc VAT)' });
  check('add-label-override → { typeSlug quote, overrideKey total_amount, reason override }', calls.length === 1 && last().typeSlug === 'quote' && last().overrideKey === 'total_amount' && last().reason === 'override', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('add-label-overrides', { doc_type_slug: 'quote', field_key: 'quote_number', labels: 'Quotation Ref, Quote No' });
  check('add-label-overrides (inserted 2) → one schedule', calls.length === 1 && last().overrideKey === 'quote_number', JSON.stringify(calls));
  calls.length = 0;
  await tryCall('delete-label-override', 7);
  check('delete-label-override → the removed row\'s type + key, reason override-removed', calls.length === 1 && last().typeSlug === 'quote' && last().overrideKey === 'quote_number' && last().reason === 'override-removed', JSON.stringify(calls));

  console.log('\n2. a refused / no-op write schedules nothing');
  calls.length = 0;
  script.create = () => ({ success: false, error: 'dup' });
  await tryCall('create-doc-type-with-fields', { name: 'Quote' });
  check('create refused → no schedule', calls.length === 0);
  script.addOverride = () => ({ ok: true, inserted: 0 });
  await tryCall('add-label-override', { doc_type_slug: 'quote', field_key: 'x', label: 'dup' });
  check('override duplicate (inserted 0) → no schedule', calls.length === 0);
  script.delOverride = () => ({ ok: true, deleted: 0 });
  await tryCall('delete-label-override', 7);
  check('override delete of a missing row (deleted 0) → no schedule', calls.length === 0);

  console.log('\n3. a THROWING scheduler never fails the write');
  script.create = () => ({ success: true, id: 41, type: { id: 41, slug: 'quote' } });
  script.addOverride = () => ({ ok: true, inserted: 1 });
  schedulerThrows = true;
  const r1 = await tryCall('create-doc-type-with-fields', { name: 'Quote' });
  check('create returns its normal result although the scheduler threw', r1 && r1.success === true && !r1.threw, JSON.stringify(r1));
  const r2 = await tryCall('add-label-override', { doc_type_slug: 'quote', field_key: 'total_amount', label: 'Total' });
  check('override add returns its normal result although the scheduler threw', r2 && r2.ok === true && !r2.threw, JSON.stringify(r2));
  const r3 = await tryCall('update-document-type', 50, { enabled: true });
  check('update-document-type returns ok although the scheduler threw', r3 && r3.ok === true && !r3.threw, JSON.stringify(r3));
  schedulerThrows = false;
}
run().then(() => { Module._load = realLoad; console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
