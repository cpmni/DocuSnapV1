#!/usr/bin/env node
'use strict';

/**
 * src/modules/processing/test_split_removal_guard.js
 * --------------------------------------------------
 * Pins the GRAPHICAL page-split + page-removal safety (2026-09-20; barry+eric+gary+oscar → Oracle
 * SIGN-OFF-W/COND ×2). Two parts:
 *   §1-§4  PURE (split_plan): marks+removed → non-contiguous GROUPS, the destructive-op fork predicate,
 *          the legacy range-file mirror, and the partition property invariant.
 *   §5     HANDLER (mocked ipcMain/db/spawn/fs): the split-pdf-marks path builds the right groups, MOVES
 *          the original aside (recoverable — NEVER unlink), inherits departments to children, and REFUSES
 *          (leaving the original untouched) on splitter under-production / all-removed / no-op.
 *
 * The two load-bearing rules Oracle named are pinned TOGETHER so a future dev can't quietly restore either:
 *   (a) the original is MOVED to .sf_separated_originals, not hard-deleted; and
 *   (b) a single-file "no-split clean" only proceeds when the output is STRICTLY FEWER pages than the input.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_split_removal_guard.js
 */

const EventEmitter = require('events');
const path   = require('path');
const os     = require('os');
const realFs = require('fs');

process.env.ACCESS_GATE_ENABLED = '0';   // isolate the split logic; the access gate has its own suite

let role = 'admin';
const fakeAuth = {
  requireLogin:    () => ({ id: 1, username: 'u', role }),
  requireUnlocked: () => ({ id: 1, username: 'u', role }),
  requireRole:     (...roles) => { if (!roles.includes(role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return { id: 1, username: 'u', role }; },
  hasRole:         (...roles) => roles.includes(role),
  getCurrentUser:  () => ({ id: 1, username: 'u', role }),
  logAudit:        () => {},
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true,
  exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };

const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const SP = require('./split_plan');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const N = (p) => path.normalize(String(p));
const ROOT = path.join(__dirname, '..', '..', '..');

let db;   // set per handler test; the harness closes over it

// ── §1 marksToGroups ────────────────────────────────────────────────────────────────────────────
console.log('\n§1  marksToGroups — boundaries + removal → (possibly non-contiguous) groups');
const mg = (m, r, n) => SP.marksToGroups(m, r, n);
check('split at 1&5, remove blanks 3&7 (N=8) → [[1,2,4],[5,6,8]] (2 files, NOT 4)',
      JSON.stringify(mg([1, 5], [3, 7], 8).groups) === '[[1,2,4],[5,6,8]]');
check('page 1 is an implicit boundary: [5] === [1,5]',
      JSON.stringify(mg([5], [], 8).groups) === JSON.stringify(mg([1, 5], [], 8).groups));
check('unsorted + duplicate marks normalise: [5,1,5] === [1,5]',
      JSON.stringify(mg([5, 1, 5], [], 8).groups) === JSON.stringify(mg([1, 5], [], 8).groups));
check('a removed boundary page → group starts at the next surviving page',
      JSON.stringify(mg([1, 5], [5], 8).groups) === '[[1,2,3,4],[6,7,8]]');
check('a whole group removed → the group vanishes',
      JSON.stringify(mg([1, 5], [5, 6, 7, 8], 8).groups) === '[[1,2,3,4]]');
check('mark out of range → REJECT (no clamp)', mg([1, 9], [], 8).ok === false);
check('non-integer mark → REJECT', mg([1, 2.5], [], 8).ok === false);
check('removed page out of range → REJECT', mg([1], [9], 8).ok === false);
check('bad N → REJECT', mg([1], [], 0).ok === false);
check('outputPageCount = N − |removed|', mg([1, 5], [3, 7], 8).outputPageCount === 6);

// ── §2 splitMarksAllowed — the destructive-op fork ────────────────────────────────────────────────
console.log('\n§2  splitMarksAllowed — the fork that authorises the delete/move-aside');
const allow = (m, r, n) => SP.splitMarksAllowed(SP.marksToGroups(m, r, n));
check('no split, no removal → REFUSED (no-op)',                    allow([1], [], 8).ok === false);
check('empty marks, no removal → REFUSED (no-op)',                 allow([], [], 8).ok === false);
check('remove-only, no split, STRICTLY fewer pages → ALLOWED',     allow([1], [4], 8).ok === true);
check('genuine split (≥2 groups) → ALLOWED',                       allow([1, 5], [], 8).ok === true);
check('split + interior removal → ALLOWED',                        allow([1, 5], [3, 7], 8).ok === true);
check('every page removed → REFUSED',                              allow([], [1, 2, 3, 4, 5, 6, 7, 8], 8).ok === false);
check('a whole sub-doc removed but strictly fewer → ALLOWED (1 file)', allow([1, 5], [5, 6, 7, 8], 8).ok === true);

// ── §3 expectedRangeFiles — legacy free-text guard mirror ─────────────────────────────────────────
console.log('\n§3  expectedRangeFiles — JS mirror of parse_ranges non-empty count');
check("'1-2,3' / 10 → 2",       SP.expectedRangeFiles('1-2,3', 10) === 2);
check("'1-3,5,7-9' / 10 → 3",   SP.expectedRangeFiles('1-3,5,7-9', 10) === 3);
check("'3-1' reversed → 0",     SP.expectedRangeFiles('3-1', 10) === 0);
check("'0,11' out-of-range → 0", SP.expectedRangeFiles('0,11', 10) === 0);
check("'1-99' clamped → counts 1", SP.expectedRangeFiles('1-99', 10) === 1);

// ── §4 property — the split partition invariant ───────────────────────────────────────────────────
console.log('\n§4  property — union == {1..N}\\removed, disjoint, files == non-empty groups');
let pf = 0;
for (let t = 0; t < 300; t++) {
  const Nn = 2 + Math.floor(Math.random() * 19);
  const marks = []; for (let p = 2; p <= Nn; p++) if (Math.random() < 0.3) marks.push(p);
  const removed = []; for (let p = 1; p <= Nn; p++) if (Math.random() < 0.2) removed.push(p);
  const plan = SP.marksToGroups(marks, removed, Nn);
  if (!plan.ok) { pf++; continue; }
  const flat = plan.groups.flat();
  const rem = new Set(removed);
  const expectedUnion = []; for (let p = 1; p <= Nn; p++) if (!rem.has(p)) expectedUnion.push(p);
  const disjoint = new Set(flat).size === flat.length;
  const unionOk  = JSON.stringify([...flat].sort((a, b) => a - b)) === JSON.stringify(expectedUnion);
  if (!(disjoint && unionOk && plan.expectedSegments === plan.groups.length)) pf++;
}
check('300 random marks/removed builds hold the partition invariant', pf === 0);

// ── §5 handler — the destructive path (mocked) ────────────────────────────────────────────────────
function harness({ splitterOut, existing, pages }) {
  const spawnArgs = [], moved = [], unlinked = [], written = [];
  const spawn = (_cmd, args) => {
    spawnArgs.push(args);
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    const out = args.includes('--count') ? { pages } : splitterOut;
    setImmediate(() => { p.stdout.emit('data', Buffer.from(JSON.stringify(out))); p.emit('close', 0); });
    return p;
  };
  const fsStub = Object.assign({}, realFs, {
    existsSync:    (p) => existing.has(N(p)),
    unlinkSync:    (p) => unlinked.push(String(p)),
    writeFileSync: (p, d) => written.push({ p: String(p), d: String(d) }),
    mkdirSync:     () => {},
    renameSync:    (s, d) => moved.push({ s: String(s), d: String(d) }),
  });
  const H = {};
  require('./handler').register({
    ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
    getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p),
    pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
    backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
    configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
    templatesDir: () => os.tmpdir(), createWindow: () => null, getMainWindow: () => null,
    notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
    notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
    reviewTraceActive: false, devSliceDir: os.tmpdir(), windows: {}, app: null,
    fs: fsStub, logger: { log() {}, warn() {}, err() {} }, spawn, path,
  });
  return { H, spawnArgs, moved, unlinked, written };
}

(async () => {
  // §5a — marks split with interior removal: 2 files, groups correct, ORIGINAL MOVED, departments inherited
  console.log('\n§5a  split-pdf-marks — interior removal → 2 files, original moved aside, depts inherited');
  {
    db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'stack.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path=? WHERE id=?').run('/inbox/x.pdf', id);
    const deptId = Number(db.prepare("INSERT INTO departments (name,slug) VALUES ('Accounts','accounts')").run().lastInsertRowid);
    db.prepare('INSERT INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, deptId);
    const rowOriginal = path.join('/scans', 'stack.pdf'), f1 = '/scans/a.pdf', f2 = '/scans/b.pdf';
    const existing = new Set([N('/inbox/x.pdf'), N(rowOriginal), N(f1), N(f2)]);
    const { H, spawnArgs, moved, unlinked, written } = harness({ splitterOut: { success: true, files: [f1, f2] }, existing, pages: 8 });
    const res = await H['split-pdf-marks']({}, { docId: id, marks: [1, 5], removed: [3, 7] });
    check('success, 2 children', res.success === true && res.docIds.length === 2);
    check('splitter invoked with --groups-file', spawnArgs.some(a => a.includes('--groups-file')));
    const gf = written.find(w => /ds_groups_/.test(w.p));
    check('the groups written are [[1,2,4],[5,6,8]] (interior blanks dropped, kept as 2 files)',
          !!gf && gf.d === '[[1,2,4],[5,6,8]]');
    check('ORIGINAL moved to .sf_separated_originals (recoverable), NOT unlinked',
          moved.length === 1 && N(moved[0].s) === N(rowOriginal) && /\.sf_separated_originals[\\/]stack\.pdf$/.test(moved[0].d)
          && !unlinked.some(p => N(p) === N(rowOriginal)));
    check('parent DB row removed', !db.prepare('SELECT 1 FROM documents WHERE id=?').get(id));
    const inh = res.docIds.map(cid => db.prepare('SELECT department_id FROM document_departments WHERE document_id=?').all(cid).map(r => r.department_id));
    check('both children inherit the parent department', inh.every(d => d.length === 1 && d[0] === deptId));
  }

  // §5b — splitter UNDER-PRODUCTION: expected 2, got 1 → refuse, original untouched
  console.log('\n§5b  under-production → REFUSE, original neither moved nor deleted');
  {
    db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'u.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path=? WHERE id=?').run('/inbox/u.pdf', id);
    const rowOriginal = path.join('/scans', 'u.pdf'), f1 = '/scans/u_a.pdf';
    const existing = new Set([N('/inbox/u.pdf'), N(rowOriginal), N(f1)]);
    const { H, moved, unlinked } = harness({ splitterOut: { success: true, files: [f1] }, existing, pages: 8 });
    const res = await H['split-pdf-marks']({}, { docId: id, marks: [1, 5], removed: [] });   // expects 2 groups
    check('refused (1 produced, 2 expected)', res.success === false);
    check('original NOT moved and NOT deleted', moved.length === 0 && !!db.prepare('SELECT 1 FROM documents WHERE id=?').get(id));
    check('the stray produced file was cleaned up', unlinked.some(p => N(p) === N(f1)));
  }

  // §5c — remove-only, NO split: 1 cleaned file (strictly fewer pages), original moved aside
  console.log('\n§5c  remove-only (no split) → 1 cleaned file, original moved aside');
  {
    db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'c.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path=? WHERE id=?').run('/inbox/c.pdf', id);
    const rowOriginal = path.join('/scans', 'c.pdf'), f1 = '/scans/c_clean.pdf';
    const existing = new Set([N('/inbox/c.pdf'), N(rowOriginal), N(f1)]);
    const { H, moved, written } = harness({ splitterOut: { success: true, files: [f1] }, existing, pages: 8 });
    const res = await H['split-pdf-marks']({}, { docId: id, marks: [], removed: [4] });
    check('success, 1 child', res.success === true && res.docIds.length === 1);
    const gf = written.find(w => /ds_groups_/.test(w.p));
    check('the single group omits the removed page 4', !!gf && gf.d === '[[1,2,3,5,6,7,8]]');
    check('original moved aside', moved.length === 1 && /\.sf_separated_originals/.test(moved[0].d));
  }

  // §5d — all-removed / no-op: REFUSED with NO splitter spawn (only the --count probe)
  console.log('\n§5d  all-removed / no-op → REFUSED, splitter never spawned');
  {
    db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'z.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path=? WHERE id=?').run('/inbox/z.pdf', id);
    const existing = new Set([N('/inbox/z.pdf'), N(path.join('/scans', 'z.pdf'))]);
    const { H, spawnArgs } = harness({ splitterOut: { success: true, files: [] }, existing, pages: 8 });
    const resAll = await H['split-pdf-marks']({}, { docId: id, marks: [], removed: [1, 2, 3, 4, 5, 6, 7, 8] });
    check('all-pages-removed → refused', resAll.success === false);
    const resNoop = await H['split-pdf-marks']({}, { docId: id, marks: [], removed: [] });
    check('no-op → refused', resNoop.success === false);
    check('splitter NEVER spawned (no --outdir call; only the --count probe ran)', !spawnArgs.some(a => a.includes('--outdir')));
    check('the doc is untouched', !!db.prepare('SELECT 1 FROM documents WHERE id=?').get(id));
  }

  console.log();
  if (fails) { console.log(`${fails} check(s) FAILED.`); process.exit(1); }
  console.log('All split-removal-guard checks passed.');
})();
