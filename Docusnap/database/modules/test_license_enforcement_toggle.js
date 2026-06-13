#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_enforcement_toggle.js
 * ---------------------------------------------------
 * Staged-enforcement control surface added on top of Phase 2's gate:
 *   - decideAccess honours the persisted `license_enforcement_enabled` setting.
 *   - The DOCUSNAP_LICENSE_ENFORCEMENT env override WINS over the setting in both
 *     directions (the dev escape hatch / staged enable).
 *   - license-get-enforcement reports setting / effective / envOverride.
 * No token signing needed: we assert the enforcement DECISION (off->allow,
 * on+no-token->locked_needs_online), not token validity (covered by phase 2).
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
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;

const db = new Database(':memory:');
runMigrations(db);

const handlers = {};
handler.register({
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  // Hermetic: force the online refresh to fail so enforcement decisions depend
  // only on the setting/env/cache, not a reachable backend at cfg.base_url.
  licenseTransport: () => Promise.reject(new Error('test-offline')),
  fs,
  logger: { warn: () => {}, err: () => {} },
});

const ENV = 'DOCUSNAP_LICENSE_ENFORCEMENT';
function setEnv(v) { if (v === null) delete process.env[ENV]; else process.env[ENV] = v; }
function setSetting(on) { learning.setSetting(db, 'license_enforcement_enabled', on ? 'true' : 'false'); }
const getEnf = () => handlers['license-get-enforcement']();

(async () => {
  // 1) env unset, setting OFF -> enforcement off -> allow
  setEnv(null); setSetting(false);
  let r = await handler.decideAccess();
  if (!check('setting OFF, no env -> allow', r.decision === 'allow' && r.enforcement === false)) fail++;
  let e = getEnf();
  if (!check('get-enforcement reports OFF/OFF/null', e.setting === false && e.effective === false && e.envOverride === null)) fail++;

  // 2) env unset, setting ON, no cached token -> locked_needs_online
  setSetting(true);
  r = await handler.decideAccess();
  if (!check('setting ON, no env, no token -> locked_needs_online', r.decision === 'locked_needs_online')) fail++;
  e = getEnf();
  if (!check('get-enforcement reports ON/ON/null', e.setting === true && e.effective === true && e.envOverride === null)) fail++;

  // 3) env=off OVERRIDES setting ON -> allow (the dev escape hatch)
  setEnv('off');
  r = await handler.decideAccess();
  if (!check('env=off overrides setting ON -> allow', r.decision === 'allow')) fail++;
  e = getEnf();
  if (!check('get-enforcement effective OFF via env override', e.setting === true && e.effective === false && e.envOverride === false)) fail++;

  // 4) env=on OVERRIDES setting OFF -> enforce (no token -> locked_needs_online)
  setEnv('on'); setSetting(false);
  r = await handler.decideAccess();
  if (!check('env=on overrides setting OFF -> locked_needs_online', r.decision === 'locked_needs_online')) fail++;
  e = getEnf();
  if (!check('get-enforcement effective ON via env override', e.setting === false && e.effective === true && e.envOverride === true)) fail++;

  // 5) env parsing variants
  setSetting(false);
  const truthy = ['1', 'true', 'yes', 'ON'];
  const falsy  = ['0', 'false', 'no', 'OFF'];
  const ignored = ['', 'maybe', 'enabled'];
  let ok = true;
  for (const v of truthy)  { setEnv(v); ok = ok && getEnf().effective === true; }
  for (const v of falsy)   { setEnv(v); ok = ok && getEnf().effective === false; }
  for (const v of ignored) { setEnv(v); ok = ok && getEnf().envOverride === null; } // defers to setting
  if (!check('env parsing: truthy/falsy/ignored handled', ok)) fail++;

  // 6) Fresh install (no setting row): PACKAGED build enforces by default so a
  //    clean profile must activate; dev (not packaged) stays off. Uses a fresh DB
  //    with no enforcement setting, and an offline transport so no token is granted.
  setEnv(null);
  const offline = () => Promise.reject(new Error('test-offline'));
  const dbPkg = new Database(':memory:'); runMigrations(dbPkg);
  handler.register({ ipcMain: { handle: () => {} }, getDb: () => dbPkg, resourcePath: (...p) => path.join(ROOT, ...p),
    licenseTransport: offline, app: { isPackaged: true }, fs, logger: { warn: () => {}, err: () => {} } });
  let rp = await handler.decideAccess();
  if (!check('packaged + unset setting + no grant -> enforced (locked_needs_online)', rp.decision === 'locked_needs_online')) fail++;

  const dbDev = new Database(':memory:'); runMigrations(dbDev);
  handler.register({ ipcMain: { handle: () => {} }, getDb: () => dbDev, resourcePath: (...p) => path.join(ROOT, ...p),
    licenseTransport: offline, app: { isPackaged: false }, fs, logger: { warn: () => {}, err: () => {} } });
  let rd = await handler.decideAccess();
  if (!check('dev + unset setting -> not enforced (allow)', rd.decision === 'allow' && rd.enforcement === false)) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
