#!/usr/bin/env node
'use strict';
/**
 * scripts/check-release-migrations.js — RELEASE GATE: no TEST-BUILD force-ON of a DARK switch may
 * reach a customer build (pre-deployment audit 2026-09-07 P0-1; plan
 * docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.1; Oracle C4: the discriminator is the KEY,
 * not the SQL shape).
 *
 * Runs FIRST in `npm run build` / `build:store`. Refuses the build (exit 1) unless TEST_BUILD=1 when:
 *   (i)   database/index.js carries a `// @TEST_BUILD_MIG <N> keys=…` sentinel (a numbered force-ON);
 *   (ii)  a database/index.js line carries the test-build prose ("TEST-ONLY / REVERSIBLE",
 *         "revert … before customer build") — belt for an unsentinelled block;
 *   (iii) a migration block writes 'true' by UPSERT/UPDATE (a FORCE, not an INSERT OR IGNORE seed)
 *         and is not labelled `// @DEFAULT_FLIP <N>` — "label it or it's refused";
 *   (iv)  a database/modules/test_migration*_test_force_on.js pin exists (a fresh-install-must-be-ON pin);
 *   (v)   a listed TEST switch key appears inside a `@DEFAULT_FLIP` block or inside the
 *         ALL_ON_DEFAULTS_93 literal (the label is not a bypass; a DARK key cannot become a default
 *         without leaving database/dark_switches.js);
 *   (vi)  any non-test JS under src/ or database/ writes a listed key 'true' by ANY idiom —
 *         setSetting(...,'true'), UPDATE settings SET value='true', INSERT OR REPLACE, excluded.value,
 *         parameterised run(k,'true') within a few lines of the key;
 *   (vii) the repo package.json carries `testBuild` (a test build's extraMetadata leaked into the source).
 *
 * TEST_BUILD=1 → the hits are printed as ALLOWED and the build proceeds (build-electron.js stamps the
 * artifact `-TEST`). Pure `scan()` is exported for the pin (scripts/test_check_release_migrations.js).
 *
 *   node scripts/check-release-migrations.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches.js'));

const RE = {
  appliedHas: /if\s*\(\s*!applied\.has\((\d+)\)\s*\)/,
  sentinel: /^\s*\/\/\s*@TEST_BUILD_MIG\s+(\d+)\b/,
  defaultFlip: /^\s*\/\/\s*@DEFAULT_FLIP\s+(\d+)\b/,
  prose: /TEST-ONLY \/ REVERSIBLE|revert(?: this migration)?(?: with [\d\/]+)?(?: \(or gate\))? before (?:ANY )?customer build|revert before (?:ANY )?customer build/i,
  forceTrue: /DO UPDATE SET value\s*=\s*'true'|UPDATE settings SET value\s*=\s*'true'|INSERT OR REPLACE INTO settings[^;]*'true'|excluded\.value/i,
  allOnStart: /const ALL_ON_DEFAULTS_93\s*=\s*\[/,
};

function quotedKeys(text) {
  const out = new Set();
  for (const k of TEST_SWITCH_KEYS) if (text.includes(`'${k}'`) || text.includes(`"${k}"`)) out.add(k);
  return [...out];
}

/**
 * scan({ indexSrc, otherFiles: [{file, src}], pkgJson }) → { hits: [{belt, file, line, detail}] }
 * Pure — no I/O. Line numbers are 1-based.
 */
function scan({ indexSrc, otherFiles = [], pkgJson = {} } = {}) {
  const hits = [];
  const push = (belt, file, line, detail) => hits.push({ belt, file, line, detail });
  const lines = String(indexSrc || '').split(/\r?\n/);

  // Pass 1: block structure — label lines attach to the next `if (!applied.has(N))`.
  let pendingLabel = null;          // { type, mig, line }
  let current = null;               // { mig, label, startLine }
  let inAllOn = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1, text = lines[i];
    let m;
    if ((m = RE.sentinel.exec(text))) { pendingLabel = { type: 'TEST_BUILD_MIG', mig: Number(m[1]), line: ln }; push('i', 'database/index.js', ln, `@TEST_BUILD_MIG ${m[1]} (numbered force-ON)`); continue; }
    if ((m = RE.defaultFlip.exec(text))) { pendingLabel = { type: 'DEFAULT_FLIP', mig: Number(m[1]), line: ln }; continue; }
    if ((m = RE.appliedHas.exec(text))) {
      const mig = Number(m[1]);
      current = { mig, label: pendingLabel && pendingLabel.mig === mig ? pendingLabel : null, startLine: ln };
      pendingLabel = null;
      continue;
    }
    if (RE.allOnStart.test(text)) inAllOn = true;
    if (inAllOn) {
      for (const k of quotedKeys(text)) push('v', 'database/index.js', ln, `TEST switch '${k}' inside ALL_ON_DEFAULTS_93`);
      if (/\];/.test(text)) inAllOn = false;
      continue;
    }
    if (/^\s*\/\//.test(text)) {
      if (RE.prose.test(text)) push('ii', 'database/index.js', ln, `test-build prose: "${text.trim().slice(0, 90)}"`);
      continue;
    }
    if (RE.forceTrue.test(text)) {
      if (!current || !current.label) push('iii', 'database/index.js', ln, `UPSERT/UPDATE-to-'true' in migration ${current ? current.mig : '?'} with no @DEFAULT_FLIP / @TEST_BUILD_MIG label`);
    }
    if (current && current.label && current.label.type === 'DEFAULT_FLIP') {
      for (const k of quotedKeys(text)) push('v', 'database/index.js', ln, `TEST switch '${k}' inside @DEFAULT_FLIP ${current.mig}`);
    }
  }

  // (vi) any other non-test file writing a listed key 'true'.
  for (const { file, src } of otherFiles) {
    const ol = String(src).split(/\r?\n/);
    for (let i = 0; i < ol.length; i++) {
      const window = ol.slice(Math.max(0, i - 3), i + 4).join('\n');
      const writes = /setSetting\([^)]*'true'\)|SET value\s*=\s*'true'|INSERT OR REPLACE INTO settings|excluded\.value|run\(\s*\w+\s*,\s*'true'\s*\)|,\s*'true'\s*\)\s*\.run/.test(ol[i]);
      if (!writes) continue;
      for (const k of quotedKeys(window)) push('vi', file, i + 1, `writes TEST switch '${k}' to 'true'`);
    }
  }

  // (vii) package.json must not carry testBuild.
  if (pkgJson && Object.prototype.hasOwnProperty.call(pkgJson, 'testBuild')) push('vii', 'package.json', 0, `testBuild=${JSON.stringify(pkgJson.testBuild)} present in the repo package.json`);

  // De-dup (a line can match several belts identically).
  const seen = new Set();
  return { hits: hits.filter(h => { const k = `${h.belt}|${h.file}|${h.line}|${h.detail}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(p); }
    else if (e.isFile() && e.name.endsWith('.js') && !/^test_/.test(e.name) && !/\.test\.js$/.test(e.name)) yield p;
  }
}

function collect() {
  const indexPath = path.join(ROOT, 'database', 'index.js');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const otherFiles = [];
  for (const dir of [path.join(ROOT, 'src'), path.join(ROOT, 'database')]) {
    for (const f of walk(dir)) {
      if (path.resolve(f) === path.resolve(indexPath)) continue;
      otherFiles.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), src: fs.readFileSync(f, 'utf8') });
    }
  }
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // (iv) force-on pin files.
  const pinHits = [];
  const modDir = path.join(ROOT, 'database', 'modules');
  if (fs.existsSync(modDir)) {
    for (const f of fs.readdirSync(modDir)) if (/^test_migration.*_test_force_on\.js$/.test(f)) pinHits.push({ belt: 'iv', file: `database/modules/${f}`, line: 0, detail: 'fresh-install-must-be-ON pin present' });
  }
  return { indexSrc, otherFiles, pkgJson, pinHits };
}

if (require.main === module) {
  const { indexSrc, otherFiles, pkgJson, pinHits } = collect();
  const { hits } = scan({ indexSrc, otherFiles, pkgJson });
  const all = [...hits, ...pinHits];
  const testBuild = process.env.TEST_BUILD === '1';
  if (all.length === 0) {
    console.log(`[check-release-migrations] OK — no TEST-BUILD force-ON reaches this build (${TEST_SWITCH_KEYS.length} DARK keys guarded).`);
    process.exit(0);
  }
  const head = testBuild
    ? `[check-release-migrations] TEST_BUILD=1 — ${all.length} test-build hit(s) ALLOWED (the artifact is stamped -TEST):`
    : `[check-release-migrations] REFUSED — ${all.length} TEST-BUILD force-ON hit(s); set TEST_BUILD=1 for a test build or remove them for a release:`;
  (testBuild ? console.log : console.error)(head);
  for (const h of all) (testBuild ? console.log : console.error)(`  [${h.belt}] ${h.file}${h.line ? ':' + h.line : ''} — ${h.detail}`);
  process.exit(testBuild ? 0 : 1);
}

module.exports = { scan, RE, TEST_SWITCH_KEYS };
