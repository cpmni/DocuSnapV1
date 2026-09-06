#!/usr/bin/env node
'use strict';
/**
 * src/modules/processing/test_angle_heal_argv.js
 * ----------------------------------------------
 * Log review 5b (2026-09-05, eric → Oracle SIGN-OFF-W/COND): the TEACH_ANGLE_COMPOSE lazy sample-angle
 * heal (_healSampleAngles) called main.js `pythonArgs()` with NO script — its signature is
 * pythonArgs(script, ...args) — so argv was ['-3.12', undefined, detect_angle.py, '--file', file] and
 * every heal ran `py -3.12 undefined detect_angle.py` → exit 2 → templates 6/7 stayed NULL-angled
 * (the (...a) => a stub in test_stage2_hardening.js masked it). This pin registers the handler with a
 * pythonArgs SPY carrying MAIN's semantics, monkeypatches child_process.spawn, arms
 * teach_angle_compose_scan and drives buildTrainingArgs (the heal's only caller).
 *
 * Pins: (1) argv[0] is the interpreter flag, argv[1] ends detect_angle.py, EVERY argv entry is a string
 * (the old source fails here); (2) '--file' <sample> follows; (3) the detector's answer is stored
 * (sample_deskew_angle = 0 for a level sample); (4) a template with NO pinned sample never spawns;
 * (5) the stderr capture rides the warn.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_angle_heal_argv.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));

let fails = 0;
const check = (label, cond, detail) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && detail ? '\n      ' + detail : ''}`); if (!cond) fails++; return cond; };

// ── fixture: a template with a pinned sample doc (file on disk) and NO angle; a second with no sample ──
const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anglepin-'));
const sample = path.join(tmpDir, 'sample.pdf');
fs.writeFileSync(sample, 'not really a pdf');
const docId = Number(documents.insert(db, { original_filename: 'sample.pdf', folder_path: tmpDir, status: 'confirmed',
  supplier_name: 'Acme', document_type_id: 1 }).lastInsertRowid);
db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(sample, docId);   // insert() ignores working_path
const tid = templates.create(db, { name: 'Acme', document_type_slug: 'invoice', keyword_fingerprint: ['ACME', 'INVOICE'], fields: [] });
db.prepare('UPDATE templates SET sample_document_id = ?, sample_deskew_angle = NULL WHERE id = ?').run(docId, tid);
const tid2 = templates.create(db, { name: 'NoSample', document_type_slug: 'invoice', keyword_fingerprint: ['NOSAMPLE'], fields: [] });
db.prepare('UPDATE templates SET sample_document_id = NULL, sample_deskew_angle = NULL WHERE id = ?').run(tid2);
learning.setSetting(db, 'teach_angle_compose_scan', 'true');

// ── the spawn spy (the heal destructures child_process at call time, so the module patch is what it sees) ──
const cp = require('child_process');
const realSpawn = cp.spawn;
const spawns = [];
cp.spawn = (exe, args, opts) => {
  spawns.push({ exe, args: Array.isArray(args) ? args.slice() : args, opts });
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  setImmediate(() => {
    p.stderr.emit('data', 'detector: fine');
    p.stdout.emit('data', JSON.stringify({ angle: 0.0 }));
    p.emit('close', 0);
  });
  return p;
};

// ── register the handler with MAIN's pythonArgs semantics ──
const warns = [];
const fakeAuth = { requireLogin() { return { username: 'sarah', role: 'admin' }; }, requireRole() { return { username: 'sarah', role: 'admin' }; },
                   getCurrentUser() { return { username: 'sarah', role: 'admin' }; }, hasRole() { return true; }, logAudit() {} };
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };
const handler = require('./handler');
handler.register({
  ipcMain: { handle: () => {}, on: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  pythonExe: () => 'py',
  pythonArgs: (script, ...args) => ['-3.12', script, ...args],      // main.js semantics — NOT (...a) => a
  tesseractPath: () => 'tesseract',
  backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
  configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
  templatesDir: () => tmpDir, createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
  notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'),
  windows: {}, app: null, fs, path,
  logger: { log: () => {}, warn: (m) => warns.push(String(m)), err: (m) => warns.push(String(m)) },
  spawn: () => { throw new Error('ctx.spawn must not run in this test'); },
});

(async () => {
  console.log('§1 buildTrainingArgs arms the heal → ONE spawn with a well-formed argv');
  const { args: trainingArgs, tempFiles } = handler.buildTrainingArgs(db, () => path.join(ROOT, 'config', 'keyword_patterns.json'), { log: () => {}, warn: (m) => warns.push(String(m)) });
  check('buildTrainingArgs returned args', Array.isArray(trainingArgs));
  check('exactly one spawn (the template WITH a sample) — the sample-less template never spawns', spawns.length === 1, JSON.stringify(spawns.map(s => s.args)));
  const argv = spawns[0] ? spawns[0].args : [];
  check("argv[0] is the interpreter flag '-3.12'", argv[0] === '-3.12', JSON.stringify(argv));
  check('argv[1] ends with detect_angle.py (the SCRIPT is where main.js puts it)', typeof argv[1] === 'string' && /detect_angle\.py$/.test(argv[1]), JSON.stringify(argv));
  check('EVERY argv entry is a string (the old source carried an `undefined`)', argv.length > 0 && argv.every(x => typeof x === 'string'), JSON.stringify(argv));
  check("'--file' <the pinned sample> follows the script", argv[2] === '--file' && argv[3] === sample, JSON.stringify(argv));
  check('the interpreter is the ctx pythonExe', spawns[0] && spawns[0].exe === 'py');

  await new Promise(r => setTimeout(r, 50));
  console.log('§2 the detector answer is stored');
  const row = db.prepare('SELECT sample_deskew_angle FROM templates WHERE id = ?').get(tid);
  check('sample_deskew_angle healed to 0 (level sample stored as 0.0, NOT NULL)', row && row.sample_deskew_angle === 0, JSON.stringify(row));
  const row2 = db.prepare('SELECT sample_deskew_angle FROM templates WHERE id = ?').get(tid2);
  check('the sample-less template stays NULL (logged skip, never spawned)', row2 && row2.sample_deskew_angle == null);
  check('no "angle heal" warn for the healed template', !warns.some(w => /angle heal \(template \d+\): (detector returned no angle|unparseable)/.test(w)), JSON.stringify(warns));

  console.log('§3 stderr rides the warn when the detector answers nothing');
  cp.spawn = (exe, args) => {
    spawns.push({ exe, args });
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    setImmediate(() => { p.stderr.emit('data', "ModuleNotFoundError: No module named 'x'"); p.stdout.emit('data', ''); p.emit('close', 2); });
    return p;
  };
  const tid3 = templates.create(db, { name: 'Broken', document_type_slug: 'invoice', keyword_fingerprint: ['BROKEN'], fields: [] });
  db.prepare('UPDATE templates SET sample_document_id = ?, sample_deskew_angle = NULL WHERE id = ?').run(docId, tid3);
  const r3 = handler.buildTrainingArgs(db, () => path.join(ROOT, 'config', 'keyword_patterns.json'), { log: () => {}, warn: (m) => warns.push(String(m)) });
  await new Promise(r => setTimeout(r, 50));
  check('the failed heal warns WITH the stderr text', warns.some(w => /angle heal \(template \d+\).*stderr=ModuleNotFoundError/.test(w)), JSON.stringify(warns));
  for (const f of [].concat(tempFiles || [], r3.tempFiles || [])) { try { fs.unlinkSync(f); } catch {} }

  cp.spawn = realSpawn;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
