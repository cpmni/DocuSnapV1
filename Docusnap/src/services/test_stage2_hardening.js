#!/usr/bin/env node
'use strict';

/**
 * src/services/test_stage2_hardening.js
 * -------------------------------------
 * STAGE 2 (privilege / file-access / exfiltration hardening). Drives the real handlers with a fake
 * ipcMain + fake auth (require.cache) and an in-memory DB, asserting:
 *   M1  set-setting refuses ENTITLEMENT/LICENSING keys (no self-grant of the paid add-on)
 *   L1  get-setting requires a session except the pre-login 'theme' read
 *   M7  set-setting refuses an unsafe output_folder (system dir / drive root); allows normal + UNC
 *   M13 get-stuck-docs / get-stuck-count require a session (no unauth metadata disclosure)
 *   M6  the auto-file floor coerces an out-of-range setting back to the safe default (no `-1` bypass)
 *
 * The M2 / E-5 / L2 guards live in the top-level main.js router (not a register() module) and mirror
 * the already-tested fromLegalWindow / hasRole patterns — covered by review, not a unit harness here.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_stage2_hardening.js
 */

let session = null;   // mutated per case
const fakeAuth = {
  getCurrentUser: () => session,
  hasRole: (...roles) => !!session && roles.includes(session.role),
  requireLogin: () => { if (!session) throw Object.assign(new Error('login required'), { code: 'FORBIDDEN' }); return session; },
  requireRole: (...roles) => { if (!session || !roles.includes(session.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return session; },
  logAudit: () => {},
};
const authPath = require.resolve('../modules/auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../modules/licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };

const path = require('path');
const os   = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const threw = (fn, code) => { try { fn(); return false; } catch (e) { return code ? e.code === code : true; } };
const ROOT = path.join(__dirname, '..', '..');

// ── register the settings handler ──
const db = new Database(':memory:'); runMigrations(db);
const S = {};
require('../modules/settings/handler').register({
  ipcMain: { handle: (n, fn) => { S[n] = fn; }, on: () => {} },
  getDb: () => db, notifyAllWindows: () => {}, telemetry: null, fs: require('fs'),
});

// ── §1  M1 — set-setting refuses managed entitlement/licensing keys ──
console.log('\n§1  M1 — set-setting refuses entitlement/licensing keys');
session = { id: 1, username: 'a', role: 'admin' };
check("'detached_search_seats' refused (PROTECTED_SETTING)", threw(() => S['set-setting']({}, 'detached_search_seats', '5'), 'PROTECTED_SETTING'));
check("'detached_features_signed' refused", threw(() => S['set-setting']({}, 'detached_features_signed', 'x'), 'PROTECTED_SETTING'));
check("'update_info' refused", threw(() => S['set-setting']({}, 'update_info', '{}'), 'PROTECTED_SETTING'));
check("'license_key_masked' refused (licens* prefix)", threw(() => S['set-setting']({}, 'license_key_masked', 'x'), 'PROTECTED_SETTING'));
check("a normal key ('theme') still writes", S['set-setting']({}, 'theme', 'dark') === true);
check('  → entitlement seats were NOT written', db.prepare("SELECT value FROM settings WHERE key='detached_search_seats'").get() === undefined);

// ── §2  L1 — get-setting requires a session except 'theme' ──
console.log('\n§2  L1 — get-setting gates non-theme reads pre-login');
session = null;
check("pre-login: get-setting('theme') is allowed", S['get-setting']({}, 'theme') === 'dark');
check("pre-login: get-setting('output_folder') requires login", threw(() => S['get-setting']({}, 'output_folder'), 'FORBIDDEN'));
check("pre-login: get-setting('watch_folder') requires login", threw(() => S['get-setting']({}, 'watch_folder'), 'FORBIDDEN'));
session = { id: 1, username: 'a', role: 'readonly' };
check('signed-in (any role): get-setting(anything) works', S['get-setting']({}, 'output_folder') === null);

// ── §3  M7 — set-setting refuses an unsafe output_folder ──
console.log('\n§3  M7 — set-setting refuses system-dir / drive-root output folders');
session = { id: 1, username: 'a', role: 'admin' };
check("output_folder 'C:\\Windows\\System32' refused", threw(() => S['set-setting']({}, 'output_folder', 'C:\\Windows\\System32'), 'UNSAFE_OUTPUT_FOLDER'));
check("output_folder 'C:\\Program Files\\x' refused", threw(() => S['set-setting']({}, 'output_folder', 'C:\\Program Files\\x'), 'UNSAFE_OUTPUT_FOLDER'));
check("output_folder bare drive root 'C:\\' refused", threw(() => S['set-setting']({}, 'output_folder', 'C:\\'), 'UNSAFE_OUTPUT_FOLDER'));
// Oracle C3 — bypasses that survive path.resolve
check("device namespace '\\\\?\\C:\\Windows\\System32' refused", threw(() => S['set-setting']({}, 'output_folder', '\\\\?\\C:\\Windows\\System32'), 'UNSAFE_OUTPUT_FOLDER'));
check("8.3 short name 'C:\\PROGRA~1\\x' refused", threw(() => S['set-setting']({}, 'output_folder', 'C:\\PROGRA~1\\x'), 'UNSAFE_OUTPUT_FOLDER'));
check("output_folder empty refused", threw(() => S['set-setting']({}, 'output_folder', '   '), 'UNSAFE_OUTPUT_FOLDER'));
const okFolder = path.join(os.tmpdir(), 'sf-out-test');
check('a normal folder is accepted', S['set-setting']({}, 'output_folder', okFolder) === true);
check('a UNC network share is accepted (legitimate business filing target)', S['set-setting']({}, 'output_folder', '\\\\fileserver\\scans') === true);

// ── §4  M13 — stuck-doc reads require a session ──
console.log('\n§4  M13 — get-stuck-docs / get-stuck-count require a session');
const P = {};
require('../modules/processing/handler').register({
  ipcMain: { handle: (n, fn) => { P[n] = fn; }, on: () => {} },
  getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p),
  pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
  backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
  configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
  templatesDir: () => os.tmpdir(), createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
  notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false, devSliceDir: os.tmpdir(), windows: {}, app: null,
  fs: require('fs'), logger: { log() {}, warn() {}, err() {} }, spawn: () => {}, path,
});
session = null;
check('pre-login: get-stuck-docs throws', threw(() => P['get-stuck-docs'](), 'FORBIDDEN'));
check('pre-login: get-stuck-count throws', threw(() => P['get-stuck-count'](), 'FORBIDDEN'));
check('pre-login: get-processing-activity throws', threw(() => P['get-processing-activity'](), 'FORBIDDEN'));
session = { id: 1, username: 'a', role: 'readonly' };
check('signed-in: get-stuck-docs works', Array.isArray(P['get-stuck-docs']()));

// ── §5  M6 — the auto-file floor coerces an out-of-range setting to the safe default ──
console.log('\n§5  M6 — auto-file floor ignores a negative/garbage threshold (no `-1` bypass)');
const trust = require('../../database/modules/trust');
db.prepare("INSERT INTO document_types (id,name,slug,built_in,ref_field_key,date_field_key) VALUES (1,'Invoice','invoice',1,'invoice_number','invoice_date')").run();
const docId = Number(documents.insert(db, { original_filename: 'x.pdf', folder_path: '/in', status: 'needs_review' }).lastInsertRowid);
db.prepare('UPDATE documents SET document_type_id=1, overall_confidence=50, supplier_name=? WHERE id=?').run('Acme', docId);
const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(docId);
const floorFor = (v) => { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('auto_file_threshold',?)").run(v); return trust.isAutoFileEligible(db, doc).floor; };
check("threshold '-1' → floor 100 (NOT -1); a 50%-conf doc is NOT auto-filed", floorFor('-1') === 100);
check("threshold 'garbage' → floor 100", floorFor('not-a-number') === 100);
check("threshold '200' → floor 100 (clamped)", floorFor('200') === 100);
check("threshold '90' (valid) → floor 90", floorFor('90') === 90);
check("threshold '0' → floor 100 (unchanged: 0 means 'unset' → safe default)", floorFor('0') === 100);
db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('critical_field_conf_floor','-5')").run();
check('a hostile critical_field_conf_floor (\'-5\') does not crash the predicate (coerced to the 88 default; behaviour pinned in test_scope_trust)',
      (() => { try { trust.isAutoFileEligible(db, doc); return true; } catch { return false; } })());

// ── §6  M1 backup door (Oracle C1) — a crafted backup can't restore entitlement keys ──
console.log('\n§6  M1 (Oracle C1) — settings-backup restore refuses entitlement/licensing keys');
{
  const backupService = require('../services/backupService');
  const rdb = new Database(':memory:'); runMigrations(rdb);
  backupService.applyBackup(rdb, { tables: { settings: [
    { key: 'detached_search_seats',   value: '5' },   // the paid add-on gate — must NOT restore
    { key: 'detached_features_signed', value: 'forged' },
    { key: 'license_key_masked',       value: 'x' },
    { key: 'update_info',              value: '{"update_url":"https://evil"}' },
    { key: 'theme',                    value: 'dark' },   // a normal key SHOULD restore
  ] } });
  const val = (k) => (rdb.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value;
  check('detached_search_seats NOT restored (no self-grant via backup)', val('detached_search_seats') === undefined);
  check('detached_features_signed NOT restored', val('detached_features_signed') === undefined);
  check('license_key_masked NOT restored', val('license_key_masked') === undefined);
  check('update_info NOT restored', val('update_info') === undefined);
  check('a normal setting (theme) DID restore', val('theme') === 'dark');
  rdb.close();
}

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All Stage-2 hardening checks passed.');
process.exit(0);
