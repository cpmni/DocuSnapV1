#!/usr/bin/env node
'use strict';
/*
 * scripts/check-licenses.js
 * -------------------------
 * Prebuild license gate. Enumerates every third-party component that actually
 * SHIPS — the Node production-dependency tree AND the bundled Python packages in
 * vendor/python — resolves each one's license, and FAILS the build if any is not
 * on the approved allowlist (or is copyleft).
 *
 * Why: a future `npm update` / re-provisioned vendor/python can silently pull a
 * version whose license changed (e.g. a permissive package relicensed, or a new
 * transitive dependency that is GPL/AGPL). Without a gate you would package it
 * and only discover the problem later. This makes the build STOP and demand a
 * human review instead of assuming a version bump is still safe.
 *
 * Outcome per component: ALLOWED (on the allowlist) / DENIED (copyleft) /
 * UNKNOWN (unrecognised — review it, then either add the SPDX id to ALLOW or
 * record a reviewed decision in OVERRIDES). DENIED or UNKNOWN => exit 1.
 *
 * Dual licenses ("BSD-3-Clause OR GPL-2.0") pass if EITHER side is allowed — we
 * elect the permissive option (see node-forge in THIRD-PARTY-LICENSES.txt).
 *
 * Usage:
 *   node scripts/check-licenses.js          gate (exit 1 on any DENIED/UNKNOWN)
 *   node scripts/check-licenses.js --audit  print the full table, never fail
 *
 * Keep this in sync with THIRD-PARTY-LICENSES.txt when ALLOW/OVERRIDES change.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const AUDIT = process.argv.includes('--audit');

// SPDX families that are free for commercial closed-source distribution with
// attribution only. Matched case-insensitively as substrings of each token.
const ALLOW = [
  'MIT', 'ISC', 'BSD', '0BSD', 'APACHE', 'PYTHON-2.0', 'PSF', 'HPND',
  'ZLIB', 'LIBPNG', 'UNLICENSE', 'CC0', 'BLUEOAK', 'OFL', 'WTFPL',
  'PUBLIC DOMAIN', 'PUBLIC-DOMAIN', 'MIT-CMU',
  // MPL-2.0 is weak, FILE-LEVEL copyleft — OK to bundle in a closed-source
  // product. Its only obligation is source availability for the MPL-covered
  // files; this app ships unmodified Python/JS SOURCE, so that is satisfied.
  // CONDITION: never MODIFY an MPL-covered file without publishing that file's
  // source under MPL. (Applies to: certifi, parts of tqdm.)
  'MPL-2.0', 'MPL 2.0', 'MPL2',
];
// Copyleft / source-disclosure — must never ship without a deliberate review.
const DENY = ['AGPL', 'LGPL', 'GPL', 'SLEEPYCAT', 'OSL', 'EUPL', 'CDDL', 'MS-RL'];

// Reviewed exceptions: packages whose metadata license STRING is nonstandard or
// empty but which have been manually verified. Keyed by package name.
// (Add an entry ONLY after reading the package's actual LICENSE file.)
const OVERRIDES = {
  // name: { license: 'SPDX', note: 'why this is approved' }
};

function classify(expr) {
  if (!expr) return 'UNKNOWN';
  const norm = String(expr).toUpperCase().replace(/[()]/g, ' ').trim();
  const allowedTok = (t) => ALLOW.some((a) => t.includes(a));
  const deniedTok  = (t) => DENY.some((d) => t.includes(d));
  // OR: any branch that is fully allowed wins. AND ("AND" or "/"): all parts must pass.
  const orBranches = norm.split(/\bOR\b/);
  for (const br of orBranches) {
    const parts = br.split(/\bAND\b|\//).map((s) => s.trim()).filter(Boolean);
    if (parts.length && parts.every(allowedTok) && !parts.some(deniedTok)) return 'ALLOWED';
  }
  if (deniedTok(norm)) return 'DENIED';
  return 'UNKNOWN';
}

// ── Node: walk the production dependency tree ────────────────────────────────
function nodeLicenseOf(pkgDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    if (typeof p.license === 'string') return p.license;
    if (p.license && p.license.type) return p.license.type;
    if (Array.isArray(p.licenses)) return p.licenses.map((l) => l.type || l).join(' OR ');
    return null;
  } catch { return null; }
}
function collectNode() {
  const root = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const seen = new Map();   // name -> {version, license}
  const visit = (name) => {
    if (seen.has(name)) return;
    const dir = path.join(REPO, 'node_modules', name);
    if (!fs.existsSync(dir)) return;             // devDep-only / not installed
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* */ }
    seen.set(name, { version: meta.version || '?', license: nodeLicenseOf(dir) });
    for (const dep of Object.keys(meta.dependencies || {})) visit(dep);
  };
  for (const dep of Object.keys(root.dependencies || {})) visit(dep);
  return [...seen.entries()].map(([name, v]) => ({ ecosystem: 'node', name, ...v }));
}

// ── Python: read each bundled package's dist-info METADATA ───────────────────
function pyLicenseOf(metaFile) {
  let txt = '';
  try { txt = fs.readFileSync(metaFile, 'utf8'); } catch { return null; }
  const m = (re) => { const x = txt.match(re); return x ? x[1].trim() : null; };
  // Prefer the SPDX expression, then the License field, then OSI classifiers.
  const expr = m(/^License-Expression:\s*(.+)$/m);
  if (expr) return expr;
  const lic = m(/^License:\s*(.+)$/m);
  if (lic && lic.toUpperCase() !== 'UNKNOWN' && lic.length < 60) return lic;
  const classifiers = [...txt.matchAll(/^Classifier:\s*License ::.*::\s*(.+)$/gm)].map((x) => x[1].trim());
  if (classifiers.length) {
    return classifiers.map((c) => c
      .replace(/.*MIT.*/i, 'MIT').replace(/.*BSD.*/i, 'BSD').replace(/.*Apache.*/i, 'Apache-2.0')
      .replace(/.*Python Software Foundation.*/i, 'PSF').replace(/.*Historical Permission.*/i, 'HPND')
      .replace(/.*\bGNU\b.*Affero.*/i, 'AGPL').replace(/.*\bGNU\b.*Lesser.*/i, 'LGPL').replace(/.*\bGNU\b.*General.*/i, 'GPL')
    ).join(' OR ');
  }
  return lic || null;
}
function collectPython() {
  const site = path.join(REPO, 'vendor', 'python', 'Lib', 'site-packages');
  if (!fs.existsSync(site)) return { present: false, rows: [] };
  const rows = [];
  for (const entry of fs.readdirSync(site)) {
    if (!entry.endsWith('.dist-info')) continue;
    const metaFile = path.join(site, entry, 'METADATA');
    const name = entry.replace(/-\d.*$/, '');
    const version = (entry.match(/-([\d][^-]*)\.dist-info$/) || [])[1] || '?';
    rows.push({ ecosystem: 'python', name, version, license: pyLicenseOf(metaFile) });
  }
  return { present: true, rows };
}

// Full classified inventory — reused by scripts/gen-third-party-notices.js.
function inventory() {
  const node = collectNode();
  const py = collectPython();
  const all = [...node, ...py.rows].map((r) => {
    const ov = OVERRIDES[r.name];
    const license = ov ? ov.license : r.license;
    return { ...r, license, status: classify(license), note: ov ? ov.note : '' };
  });
  all.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));
  return { all, pythonPresent: py.present };
}

module.exports = { collectNode, collectPython, classify, inventory };

if (require.main !== module) return;

// ── Run ──────────────────────────────────────────────────────────────────────
const { all, pythonPresent } = inventory();
const py = { present: pythonPresent };

const bad = all.filter((r) => r.status !== 'ALLOWED');
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);

console.log('\n  License gate — shipped third-party components\n');
console.log('  ' + pad('STATUS', 9) + pad('ECOSYS', 8) + pad('PACKAGE', 30) + pad('VERSION', 14) + 'LICENSE');
console.log('  ' + '-'.repeat(95));
for (const r of all) {
  const mark = r.status === 'ALLOWED' ? ' ' : (r.status === 'DENIED' ? '!' : '?');
  console.log(`${mark} ` + pad(r.status, 9) + pad(r.ecosystem, 8) + pad(r.name, 30) + pad(r.version, 14) + (r.license || '(none found)'));
}
if (!py.present) {
  console.log('\n  NOTE: vendor/python is not assembled here — Python packages were NOT checked.');
  console.log('        Re-run this gate on the build machine where vendor/python exists.');
}

if (bad.length === 0) {
  console.log(`\n  OK — all ${all.length} components are on the approved allowlist.\n`);
  process.exit(0);
}

console.error(`\n  ${bad.length} component(s) need review before packaging:`);
for (const r of bad) {
  console.error(`    [${r.status}] ${r.ecosystem}:${r.name}@${r.version} — ${r.license || '(no license metadata)'}`);
}
console.error('\n  Resolve each one, then either:');
console.error('   - add its SPDX family to ALLOW (if it is a recognised permissive license), or');
console.error('   - record a reviewed decision in OVERRIDES (after reading its LICENSE file), or');
console.error('   - replace the dependency if it is genuinely copyleft (GPL/AGPL/LGPL).');
console.error('  Also update THIRD-PARTY-LICENSES.txt to match.\n');
process.exit(AUDIT ? 0 : 1);
