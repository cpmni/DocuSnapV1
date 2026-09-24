'use strict';
/**
 * test_field_broadcast.js — PIN for the field-mutation broadcast (2026-09-24, Chris round card 2c; eric D1 →
 * Oracle C11). `add-field` / `update-field` / `delete-field` must notify every open window (`doc-types-changed`)
 * on SUCCESS, and stay silent on a throw or a no-op mutator result — the Review window's field list is rebuilt
 * from that event, so a field taught mid-session (the customer's Total) is drawn instead of silently dropped
 * from the Confirm payload and the sidecar.
 *
 * Behavioural half: the handler module is registered against a fake ipcMain + a spy notifyAllWindows + a stub
 * doctypes module, so no DB / auth session is needed. Source half: the three handlers carry the guard.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/modules/settings/test_field_broadcast.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
}

const HANDLER = path.join(__dirname, 'handler.js');
const src = fs.readFileSync(HANDLER, 'utf8').replace(/\r\n/g, '\n');

console.log('\n1. source: the three field doors broadcast on success only');
for (const door of ['add-field', 'update-field', 'delete-field']) {
  const line = src.split('\n').find(l => l.includes(`ipcMain.handle('${door}'`)) || '';
  check(`${door}: the result is checked before notifying (if (r) notifyAllWindows('doc-types-changed'))`,
        /if \(r\) notifyAllWindows\('doc-types-changed'\); return r;/.test(line), line.slice(0, 160));
}

console.log('\n2. behaviour: register the module against a fake ipcMain, spy the broadcast');
// Stub the doctypes module so addField/updateField/deleteField are scripted (no DB).
const script = { add: () => ({ changes: 1, lastInsertRowid: 11 }), update: () => ({ changes: 1 }), del: () => ({ changes: 1 }) };
const realLoad = Module._load;
const noop = () => {};
Module._load = function (request, parent) {
  if (parent && parent.filename === HANDLER) {
    if (/document_types$/.test(String(request))) {
      return { addField: (...a) => script.add(...a), updateField: (...a) => script.update(...a), deleteField: (...a) => script.del(...a) };
    }
    // the handler takes requireRole / requireLogin / logAudit from the auth module, not from ctx — no session here
    if (/auth\/handler$/.test(String(request))) {
      return new Proxy({}, { get: (_t, k) => (k === 'getCurrentUser' ? () => ({ username: 't', role: 'admin' }) : noop) });
    }
  }
  return realLoad.apply(this, arguments);
};
const handlers = {};
const broadcasts = [];
// the handler requires doctypes / auth INSIDE register(ctx), so the stub must stay active until the run ends
const mod = require(HANDLER);
const ctx = {
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} },
  getDb: () => ({}),
  notifyAllWindows: (ch) => broadcasts.push(ch),
  requireRole: () => {},
  logAudit: () => {},
  getCurrentUser: () => ({ username: 't', role: 'admin' }),
};
let registered = false;
try {
  const reg = (mod && (mod.register || mod.init)) || (typeof mod === 'function' ? mod : null);
  if (typeof reg === 'function') { reg(ctx); registered = true; }
} catch (e) { console.log('  (register threw: ' + (e && e.message) + ')'); }
check('the settings handler module registers against the fake ctx', registered && typeof handlers['add-field'] === 'function',
      Object.keys(handlers).length + ' handlers');

async function run() {
  if (!(registered && typeof handlers['add-field'] === 'function')) return;
  const n = () => broadcasts.filter(b => b === 'doc-types-changed').length;
  broadcasts.length = 0;
  await handlers['add-field']({}, { document_type_id: 1, key: 'total', label: 'Total', type: 'currency' });
  check('add-field success → exactly one doc-types-changed', n() === 1, JSON.stringify(broadcasts));
  broadcasts.length = 0;
  await handlers['update-field']({}, 11, { type: 'currency' });
  check('update-field success → exactly one doc-types-changed', n() === 1, JSON.stringify(broadcasts));
  broadcasts.length = 0;
  await handlers['delete-field']({}, 11);
  check('delete-field success → exactly one doc-types-changed', n() === 1, JSON.stringify(broadcasts));
  // no-op mutator result (a structural field / empty change set returns undefined) → silent
  broadcasts.length = 0;
  script.update = () => undefined;
  await handlers['update-field']({}, 1, {});
  check('update-field no-op (undefined result) → NO broadcast', broadcasts.length === 0, JSON.stringify(broadcasts));
  broadcasts.length = 0;
  script.del = () => undefined;
  await handlers['delete-field']({}, 1);
  check('delete-field refused (structural → undefined) → NO broadcast', broadcasts.length === 0, JSON.stringify(broadcasts));
  // a throw propagates before the notify line
  broadcasts.length = 0;
  script.add = () => { throw new Error('UNIQUE constraint failed'); };
  let threw = false;
  try { await handlers['add-field']({}, { document_type_id: 1, key: 'total' }); } catch { threw = true; }
  check('add-field throw → propagates, NO broadcast', threw && broadcasts.length === 0, `threw=${threw} ${JSON.stringify(broadcasts)}`);
}
run().then(() => { Module._load = realLoad; console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
