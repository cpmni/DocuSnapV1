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
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { scan, TEST_SWITCH_KEYS } = require(path.join(ROOT, 'scripts', 'check-release-migrations.js'));

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

// The REAL repo — RED until the mig-137 slice lands (13 sentinels + 3 force-on pins today).
{ const gate = path.join(ROOT, 'scripts', 'check-release-migrations.js');
  const r = spawnSync(process.execPath, [gate], { cwd: ROOT, env: { ...process.env, TEST_BUILD: '' }, encoding: 'utf8' });
  check('REAL repo: gate passes with TEST_BUILD unset (no force-ON reaches a release)', r.status === 0, `exit ${r.status}: ${(r.stderr || r.stdout).split('\n').slice(0, 4).join(' | ')}`);
  const t = spawnSync(process.execPath, [gate], { cwd: ROOT, env: { ...process.env, TEST_BUILD: '1' }, encoding: 'utf8' });
  check('REAL repo: TEST_BUILD=1 always exits 0', t.status === 0, `exit ${t.status}`);
}

console.log(`\ncheck-release-migrations: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
