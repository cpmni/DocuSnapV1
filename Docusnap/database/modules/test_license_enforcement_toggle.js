#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_enforcement_toggle.js
 * ---------------------------------------------------
 * Enforcement is ALWAYS ON and CANNOT be disabled — there is no toggle path: not
 * the `license_enforcement_enabled` setting, not the old DOCUSNAP_LICENSE_ENFORCEMENT
 * env override, and not an unpackaged/dev build. (The original "staged enforcement"
 * control surface was removed; see CLAUDE.md → Licensing & activation.)
 *
 * This asserts the control surface is LOCKED:
 *   - decideAccess enforces regardless of any setting/env (no token -> needs_online);
 *   - license-get-enforcement always reports ON / ON / null + locked:true;
 *   - license-set-enforcement cannot relax enforcement (ok:false), and the gate
 *     still enforces afterwards;
 *   - packaged AND dev builds both enforce (no unpackaged bypass).
 * Hermetic: an offline transport so no token is granted and the decision depends
 * only on enforcement being permanently on.
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_enforcement_toggle.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const handler = require('../../src/modules/licensing/handler');
const learning = require('./learning');

const ROOT = path.join(__dirname, '..', '..');
const ENV = 'DOCUSNAP_LICENSE_ENFORCEMENT';
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;

const offline = () => Promise.reject(new Error('test-offline'));
const db = new Database(':memory:');
runMigrations(db);

const handlers = {};
handler.register({
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  licenseTransport: offline,   // force the online refresh to fail -> no token granted
  fs,
  logger: { warn: () => {}, err: () => {} },
});

(async () => {
  // 1) The persisted setting is inert — any value still enforces (no token -> lock).
  for (const v of ['false', 'true']) {
    learning.setSetting(db, 'license_enforcement_enabled', v);
    const r = await handler.decideAccess();
    if (!check(`setting=${v}: still enforced (no token -> locked_needs_online)`,
        r.decision === 'locked_needs_online' && r.enforcement === true)) fail++;
  }

  // 2) The old env escape hatch is gone — any value still enforces.
  for (const v of ['off', 'on', '0', '1', '']) {
    process.env[ENV] = v;
    const r = await handler.decideAccess();
    if (!check(`env=${JSON.stringify(v)}: still enforced (locked_needs_online)`,
        r.decision === 'locked_needs_online')) fail++;
  }
  delete process.env[ENV];

  // 3) get-enforcement always reports the locked, always-on state.
  const e = handlers['license-get-enforcement']();
  if (!check('get-enforcement reports ON / ON / null + locked',
      e.setting === true && e.effective === true && e.envOverride === null && e.locked === true)) fail++;

  // 4) set-enforcement cannot relax enforcement; the gate still enforces after it.
  const sr = handlers['license-set-enforcement'](null, false);
  if (!check('set-enforcement cannot relax enforcement (ok:false)', !!sr && sr.ok === false)) fail++;
  const after = await handler.decideAccess();
  if (!check('still enforced after attempting set-enforcement(false)',
      after.decision === 'locked_needs_online')) fail++;

  // 5) Packaged AND dev both enforce — no unpackaged/dev bypass.
  for (const isPackaged of [true, false]) {
    const dbX = new Database(':memory:'); runMigrations(dbX);
    handler.register({ ipcMain: { handle: () => {} }, getDb: () => dbX,
      resourcePath: (...p) => path.join(ROOT, ...p), licenseTransport: offline,
      app: { isPackaged }, fs, logger: { warn: () => {}, err: () => {} } });
    const rx = await handler.decideAccess();
    if (!check(`isPackaged=${isPackaged}: enforced (locked_needs_online)`,
        rx.decision === 'locked_needs_online' && rx.enforcement === true)) fail++;
    dbX.close();
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
