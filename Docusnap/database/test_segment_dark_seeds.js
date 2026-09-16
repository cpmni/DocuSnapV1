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
const SEEDS = [{ key: 'segment_continuation_veto', mig: 177, flag: '--continuation-veto' }, { key: 'segment_title_slug', mig: 178, flag: '--title-slug' }];
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
  check('BOTH pre-pass callers pass _separationOpts (watch separateFiles + the manual import block)',
    hsrc.includes('_separationOpts(db, built && built.args)') && hsrc.includes('_separationOpts(db, trainingArgs)'));
  check('no env bridge for either key (a DB→env bridge would be a dead switch in the pre-pass)',
    !/SEGMENT_TITLE_SLUG|SEGMENT_CONTINUATION_VETO/.test(hsrc));
  const py = fs.readFileSync(path.join(REPO, 'python_backend', 'segment_docs.py'), 'utf8');
  for (const s of SEEDS) check(`segment_docs.py takes ${s.flag}`, py.includes(`"${s.flag}"`));
  check('segment_docs.py reads NO env switch for these', !/SEGMENT_TITLE_SLUG|SEGMENT_CONTINUATION_VETO/.test(py));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /17[78]/.test(String(h.detail)) || /segment_(title_slug|continuation_veto)/.test(String(h.detail)));
  check('the release gate raises NO hit on migrations 177/178 (false seeds of listed keys)', hits.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
