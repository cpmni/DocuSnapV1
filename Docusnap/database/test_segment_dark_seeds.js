'use strict';
/*
 * test_segment_dark_seeds.js — migrations 177 + 178: the two separator DARK switches (2026-09-16).
 *
 *   mig 177  segment_continuation_veto  — a page that declares itself a continuation ("Page 2 of 2", "continued",
 *                                          "brought forward") is never a cut (Oracle (B) slice 1)
 *   mig 178  segment_title_slug         — each page's own title is threaded into the separator's template match
 *                                          as a cascade (gary → Oracle (A))
 *
 * Both seeded 'false' (DARK), listed in TEST_SWITCH_KEYS (armed only by the runtime test-build road), NO force-ON
 * twin, argv-only kills (`--continuation-veto` / `--title-slug` — the pre-pass spawn never carries the DB-bridged
 * env, so a settings read at the handler decides the argv), a later manual ON survives the next start.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_segment_dark_seeds.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');
const { TEST_SWITCH_KEYS } = require('./dark_switches');
const { scan } = require(path.join(REPO, 'scripts', 'check-release-migrations'));

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
// mig 179 (2026-09-17): segment_known_supplier_change — a page naming a DIFFERENT known supplier (+ a labelled
// number/date witness) starts a new document; the names ride their OWN temp JSON (`--known-suppliers-file`).
// mig 180 (2026-09-17): segment_pair_hold — the S4 silent-truncation belt; NO argv (the Python `weak_pages` class is
// unconditional metadata, the JS consumer is the switched half — read at the stamp site like mig 176's).
// segment_continuation_veto (mig 177), segment_title_slug (178) and segment_known_supplier_change (179) GRADUATED to
// customer defaults via migs 181/182/183 on 2026-09-17 (owner go) — their homes are database/test_default_flip_177.js and
// database/test_default_flip_178_179.js; their argv pins stay below.
const SEEDS = [{ key: 'segment_pair_hold', mig: 180, flag: null }];
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

for (const s of SEEDS) {
  console.log(`\n${s.key} (mig ${s.mig})`);
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`mig ${s.mig} stamped`, !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(s.mig));
  check(`a fresh (non-TEST) install ends with ${s.key} === 'false' (DARK)`, get(db, s.key) === 'false');
  check(`${s.key} is in TEST_SWITCH_KEYS (armed by the runtime test-build road, never a numbered force-ON)`, TEST_SWITCH_KEYS.includes(s.key));
  check(`mig ${s.mig} is an INSERT OR IGNORE seed of false`, new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${s.key}', 'false'\\)`).test(src));
  check('NO numbered force-ON twin exists', !new RegExp(`VALUES \\('${s.key}', 'true'\\)`).test(src));
  check('not in ALL_ON_DEFAULTS_93', !new RegExp(`ALL_ON_DEFAULTS_93 = \\[[\\s\\S]*?'${s.key}'[\\s\\S]*?\\];`).test(src));
  db.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(s.key);
  quiet(() => runMigrations(db));
  check('a later manual ON survives the next start', get(db, s.key) === 'true');
  db.close();
}

console.log('\nargv is the ONLY kill (the pre-pass spawn env carries no DB-bridged switch)');
{
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check("handler reads segment_title_slug + segment_continuation_veto in _separationOpts and threads them as buildSegmentArgs opts",
    /titleSlug: learn\.getSetting\(db, 'segment_title_slug', 'false'\) === 'true'/.test(hsrc)
    && /continuationVeto: learn\.getSetting\(db, 'segment_continuation_veto', 'false'\) === 'true'/.test(hsrc));
  check('BOTH pre-pass callers pass _separationOpts WITH their cleanup array (watch separateFiles + the manual import block)',
    hsrc.includes('_separationOpts(db, built && built.args, built ? built.tempFiles : null)') && hsrc.includes('_separationOpts(db, trainingArgs, tempFiles)'));
  check('mig 179: the handler reads segment_known_supplier_change, asks learning.getKnownSupplierNames at minConfirms 3, writes its OWN temp JSON and pushes it to the caller\'s cleanup array',
    /learn\.getSetting\(db, 'segment_known_supplier_change', 'false'\) === 'true'/.test(hsrc)
    && /learn\.getKnownSupplierNames\(db, \{ minConfirms: 3 \}\)/.test(hsrc)
    && /writeTempJson\('known_suppliers', names\)/.test(hsrc) && /tempFiles\.push\(f\)/.test(hsrc));
  check('mig 179: the names file NEVER rides buildTrainingArgs (process_docs\' strict parse_args would refuse the flag)',
    !/known-suppliers-file/.test(hsrc.slice(hsrc.indexOf('function buildTrainingArgs'), hsrc.indexOf('function _separationOpts'))));
  check('no env bridge for any of the three keys (a DB→env bridge would be a dead switch in the pre-pass)',
    !/SEGMENT_TITLE_SLUG|SEGMENT_CONTINUATION_VETO|SEGMENT_KNOWN_SUPPLIER_CHANGE/.test(hsrc));
  const py = fs.readFileSync(path.join(REPO, 'python_backend', 'segment_docs.py'), 'utf8');
  for (const s of SEEDS) if (s.flag) check(`segment_docs.py takes ${s.flag}`, py.includes(`"${s.flag}"`));
  check('segment_docs.py still takes --continuation-veto / --title-slug / --known-supplier-change (the graduated switches ride argv exactly as before)',
    py.includes('"--continuation-veto"') && py.includes('"--title-slug"') && py.includes('"--known-supplier-change"'));
  check('segment_docs.py reads NO env switch for these', !/SEGMENT_TITLE_SLUG|SEGMENT_CONTINUATION_VETO|SEGMENT_KNOWN_SUPPLIER_CHANGE|SEGMENT_PAIR_HOLD/.test(py));
  check('segment_docs.py arms the rule only with --known-supplier-change AND a non-empty names list',
    py.includes('if isinstance(names, list) and names:') && py.includes('known=known'));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /1(?:7[789]|80)/.test(String(h.detail)) || /segment_(title_slug|continuation_veto|known_supplier_change|pair_hold)/.test(String(h.detail)));
  check('the release gate raises NO hit on migrations 177/178/179/180 (false seeds of listed keys)', hits.length === 0);
}

console.log('\nmig 180 segment_pair_hold — the Python class is unconditional metadata; the JS consumer is the switched half');
{
  const seg = fs.readFileSync(path.join(REPO, 'python_backend', 'ocr', 'segmentation.py'), 'utf8');
  const py = fs.readFileSync(path.join(REPO, 'python_backend', 'segment_docs.py'), 'utf8');
  check('detect_segments emits `weak_pages` UNCONDITIONALLY (no argv, no env, no setting gates the class)',
    seg.includes('"weak_pages": weak_pages,') && !/weak_pages.*(?:argv|environ|args\.)/.test(seg) && !/--weak|weak-pages|WEAK_PAGES/.test(py));
  check('the slips path emits an empty weak_pages (sheet-bounded cuts are never weak)', py.includes('"weak_pages": [],'));
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check("the handler gates the pair belt on the setting at the landing site (read 'false' default, like mig 176)",
    /learning\.getSetting\(db, 'segment_pair_hold', 'false'\) === 'true'/.test(hsrc));
  check('the rewrite carries the weak names (weakSegmentNames over the plan) and BOTH callers build the pair context',
    hsrc.includes('.weak = weakSegmentNames(plan, made.map(f => path.basename(f)));') && hsrc.includes('pairCtx = buildPairContext(sepRes && sepRes.rewrites);')
    && fs.readFileSync(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'), 'utf8').includes("pairCtx = require('../processing/split_plan').buildPairContext(sep.rewrites);"));
  check('no env bridge for segment_pair_hold', !/SEGMENT_PAIR_HOLD/.test(hsrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
