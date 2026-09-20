#!/usr/bin/env node
'use strict';
/**
 * scripts/test_check_release_migrations.js — pins the release gate (scripts/check-release-migrations.js).
 * One RED fixture per belt (i)–(vii), one GREEN fixture per allowed idiom, then the REAL repo, which
 * must scan clean (RED until the mig-137 slice deletes the 13 TEST-BUILD blocks — by design), and the
 * TEST_BUILD=1 escape (exit 0 with hits printed as ALLOWED).
 *
 *   node scripts/test_check_release_migrations.js
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { scan, TEST_SWITCH_KEYS } = require(path.join(ROOT, 'scripts', 'check-release-migrations.js'));
const { FEATURE_MASTER_SWITCHES, FEATURE_MASTER_SWITCH_WRITERS } = require(path.join(ROOT, 'database', 'dark_switches.js'));

let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log(`  OK  ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } }
const belts = (hits) => hits.map(h => h.belt).sort().join(',');
const K = TEST_SWITCH_KEYS[0];               // a real listed key
const NOTKEY = 'some_customer_default';      // never listed

const block = (n, body, label) => `${label ? label + '\n' : ''}  if (!applied.has(${n})) {\n    try {\n${body}\n      db.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (${n})').run();\n    } catch (e) { console.warn(e.message); }\n  }\n`;
const upsertTrue = (k) => `      db.prepare(\`INSERT INTO settings (key, value) VALUES ('${k}', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'\`).run();`;
const seedFalse = (k) => `      db.prepare(\`INSERT OR IGNORE INTO settings (key, value) VALUES ('${k}', 'false')\`).run();`;
const seedTrueIgnore = (k) => `      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, 'true')").run('${k}');`;

console.log('check-release-migrations gate:');

// (i) sentinel
check('(i) @TEST_BUILD_MIG sentinel is a hit', belts(scan({ indexSrc: block(900, upsertTrue(K), `  // @TEST_BUILD_MIG 900 keys=${K}`) }).hits) === 'i');
// (ii) prose only (no write, no sentinel)
{ const src = `  // ⚠ TEST-ONLY / REVERSIBLE: revert before ANY customer build\n` + block(901, seedFalse(K));
  check('(ii) test-build prose alone is a hit', belts(scan({ indexSrc: src }).hits) === 'ii'); }
{ const src = `  // revert with 108/110/112 before ANY customer build.\n` + block(901, seedFalse(K));
  check('(ii) "revert with … before ANY customer build" is a hit', belts(scan({ indexSrc: src }).hits) === 'ii'); }
// (iii) unlabelled UPSERT-true
check('(iii) unlabelled UPSERT-to-true is a hit (any key)', belts(scan({ indexSrc: block(902, upsertTrue(NOTKEY)) }).hits) === 'iii');
check('(iii) unlabelled UPDATE settings SET value=true is a hit', belts(scan({ indexSrc: block(903, `      db.prepare("UPDATE settings SET value = 'true' WHERE key = '${NOTKEY}'").run();`) }).hits) === 'iii');
// (v) DEFAULT_FLIP of a listed key / ALL_ON list
check('(v) @DEFAULT_FLIP block writing a TEST key is a hit', belts(scan({ indexSrc: block(904, upsertTrue(K), '  // @DEFAULT_FLIP 904') }).hits) === 'v');
check('(v) TEST key inside ALL_ON_DEFAULTS_93 is a hit', belts(scan({ indexSrc: `const ALL_ON_DEFAULTS_93 = [\n  'auto_rotate_enabled', '${K}',\n];\n` }).hits) === 'v');
// (vi) cross-file
check('(vi) setSetting(key,"true") in another file is a hit', belts(scan({ indexSrc: '', otherFiles: [{ file: 'src/x.js', src: `learning.setSetting(db, '${K}', 'true');` }] }).hits) === 'vi');
check('(vi) parameterised run(k,"true") near the key is a hit', belts(scan({ indexSrc: '', otherFiles: [{ file: 'src/y.js', src: `for (const k of ['${K}']) {\n  up.run(k, 'true');\n}` }] }).hits) === 'vi');
check('(vi) writing a NON-listed key "true" elsewhere is allowed', scan({ indexSrc: '', otherFiles: [{ file: 'src/z.js', src: `learning.setSetting(db, '${NOTKEY}', 'true');` }] }).hits.length === 0);
// (vii) package.json
check('(vii) package.json testBuild is a hit', belts(scan({ indexSrc: '', pkgJson: { testBuild: true } }).hits) === 'vii');
// GREEN idioms
check('labelled @DEFAULT_FLIP UPSERT of a non-listed key is allowed', scan({ indexSrc: block(905, upsertTrue(NOTKEY), '  // @DEFAULT_FLIP 905') }).hits.length === 0);
check('INSERT OR IGNORE seed-true (customer choice preserved) needs no label', scan({ indexSrc: block(906, seedTrueIgnore(NOTKEY)) }).hits.length === 0);
check('seed-OFF of a TEST key is allowed', scan({ indexSrc: block(907, seedFalse(K)) }).hits.length === 0);
check('UPSERT-to-false (a discharge) is allowed', scan({ indexSrc: block(908, `      db.prepare(\`INSERT INTO settings (key, value) VALUES ('${K}', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'\`).run();`) }).hits.length === 0);
check('a comment MENTIONING a TEST key inside a @DEFAULT_FLIP block is not a hit', scan({ indexSrc: block(909, `      // unlike '${K}', this one is a real default\n` + upsertTrue(NOTKEY), '  // @DEFAULT_FLIP 909') }).hits.length === 0);

// ── FEATURE-MASTER waiver (departments_enabled; 2026-09-20, gary → Oracle SIGN-OFF-W/COND C1-C4) ─────
// belt (vi) waives ONE write of a feature-master key when file===FEATURE_MASTER_SWITCH_WRITERS[key] AND its
// ±3-line window carries `// @FEATURE_MASTER_WRITE <key>`. These pins LOCK the trade-off: the real writer is
// waived, but every drift/copy/second-write/normal-key path still FIRES (fail-toward-refuse).
const SENT = (k) => `// @FEATURE_MASTER_WRITE ${k}`;
const MK = 'departments_enabled';
const MFILE = FEATURE_MASTER_SWITCH_WRITERS[MK];          // 'src/modules/settings/handler.js'
const wtrue = (k) => `learning.setSetting(db, '${k}', 'true');`;
const mkHits = (hits) => hits.filter(h => h.detail.includes(`'${MK}'`));

// (a) the REAL mapped file, unmodified, is waived — 0 departments_enabled hits.
{ const realSrc = fs.readFileSync(path.join(ROOT, MFILE), 'utf8');
  check('(a) REAL mapped file is waived (0 departments_enabled hits)',
    mkHits(scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: realSrc }] }).hits).length === 0); }
// (a') the minimal sentinelled write in the mapped file is waived.
check("(a') sentinelled master write in its mapped file is waived",
  scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: `${SENT(MK)}\n${wtrue(MK)}` }] }).hits.length === 0);
// (b) hole-guards — sentinel copied to another file / missing / naming the wrong key all FIRE.
check('(b) same write in a DIFFERENT file still fires (sentinel copied)',
  belts(scan({ indexSrc: '', otherFiles: [{ file: 'src/evil.js', src: `${SENT(MK)}\n${wtrue(MK)}` }] }).hits) === 'vi');
check('(b) mapped file WITHOUT the sentinel still fires',
  belts(scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: wtrue(MK) }] }).hits) === 'vi');
check('(b) sentinel naming a DIFFERENT key does not waive this key',
  belts(scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: `// @FEATURE_MASTER_WRITE some_other_key\n${wtrue(MK)}` }] }).hits) === 'vi');
// (c) a NORMAL dark key is never waived, even in the mapped file with its own sentinel.
check('(c) a normal dark key is never waived in the mapped file',
  belts(scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: `${SENT(K)}\n${wtrue(K)}` }] }).hits) === 'vi');
// (e) proximity: a sentinel >3 lines from the write is out of window → FIRES (drift fail-safe).
check('(e) sentinel >3 lines from the write does not waive (drift fires)',
  belts(scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: `${SENT(MK)}\n//1\n//2\n//3\n${wtrue(MK)}` }] }).hits) === 'vi');
// (f) one-per-file cap (Oracle C1): a SECOND sentinelled master write in the mapped file FIRES.
check('(f) a SECOND sentinelled master write in the mapped file fires (one-per-file cap)',
  scan({ indexSrc: '', otherFiles: [{ file: MFILE, src: `${SENT(MK)}\n${wtrue(MK)}\n${SENT(MK)}\n${wtrue(MK)}` }] }).hits.length >= 1);
// (d) anti-rot: the mapping is LIVE — for each (key→file): the file exists, the key is a feature-master key
// ∈ TEST_SWITCH_KEYS, and the REAL file scanned with the sentinel STRIPPED still fires (a dead exemption = red).
for (const [k, rel] of Object.entries(FEATURE_MASTER_SWITCH_WRITERS)) {
  const abs = path.join(ROOT, rel);
  check(`(d) anti-rot: writer file exists for '${k}'`, fs.existsSync(abs), rel);
  check(`(d) anti-rot: '${k}' is a feature-master key ∈ TEST_SWITCH_KEYS`,
    FEATURE_MASTER_SWITCHES.has(k) && TEST_SWITCH_KEYS.includes(k));
  if (fs.existsSync(abs)) {
    const stripped = fs.readFileSync(abs, 'utf8').replace(new RegExp(`@FEATURE_MASTER_WRITE\\s+${k}\\b`, 'g'), '@X_disabled');
    const hits = scan({ indexSrc: '', otherFiles: [{ file: rel, src: stripped }] }).hits.filter(h => h.detail.includes(`'${k}'`));
    check(`(d) anti-rot: real ${rel} WOULD fire for '${k}' without the sentinel (live exemption)`, hits.length >= 1);
  }
}

// The REAL repo — must scan clean now (mig-137 slice shipped; departments_enabled is waived via the
// feature-master exemption above). A non-zero exit here means a genuine dark-key force-ON reaches a release.
{ const gate = path.join(ROOT, 'scripts', 'check-release-migrations.js');
  const r = spawnSync(process.execPath, [gate], { cwd: ROOT, env: { ...process.env, TEST_BUILD: '' }, encoding: 'utf8' });
  check('REAL repo: gate passes with TEST_BUILD unset (no force-ON reaches a release)', r.status === 0, `exit ${r.status}: ${(r.stderr || r.stdout).split('\n').slice(0, 4).join(' | ')}`);
  const t = spawnSync(process.execPath, [gate], { cwd: ROOT, env: { ...process.env, TEST_BUILD: '1' }, encoding: 'utf8' });
  check('REAL repo: TEST_BUILD=1 always exits 0', t.status === 0, `exit ${t.status}`);
}

console.log(`\ncheck-release-migrations: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
