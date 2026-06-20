#!/usr/bin/env node
'use strict';
/*
 * scripts/gen-third-party-notices.js
 * ----------------------------------
 * Regenerates the COMPONENT INVENTORY (section 1) of THIRD-PARTY-LICENSES.txt
 * from the SAME source of truth the build-time license gate uses
 * (scripts/check-licenses.js), so the notice can never silently fall behind the
 * dependencies that actually ship. The curated license TEXTS (sections 2-3) and
 * the Apache/OFL/MPL bodies are left untouched — only the inventory list is
 * rewritten.
 *
 * The Electron runtime framework and the self-hosted UI fonts are added here
 * because they are not npm "dependencies" (Electron is a devDependency that
 * provides the runtime; the fonts are asset files), so the gate doesn't
 * enumerate them — but they DO ship and must be listed.
 *
 * Usage:  node scripts/gen-third-party-notices.js
 */

const fs = require('fs');
const path = require('path');
const { inventory } = require('./check-licenses');

const NOTICE = path.join(__dirname, '..', 'THIRD-PARTY-LICENSES.txt');
const DIV = '-'.repeat(80);
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);

const { all, pythonPresent } = inventory();
const node = all.filter((r) => r.ecosystem === 'node');
const py = all.filter((r) => r.ecosystem === 'python');

const row = (r) => `  ${pad(r.name, 32)}${pad(r.version, 14)}${r.license || '(see package)'}`;

let s = '';
s += DIV + '\n1. COMPONENT INVENTORY\n' + DIV + '\n\n';
s += 'This inventory is REGENERATED from the build-time license gate\n';
s += '(scripts/check-licenses.js) so it lists every third-party component that\n';
s += 'actually ships. Regenerate after any dependency change:\n';
s += '    npm run check:licenses          (verify all licenses are approved)\n';
s += '    node scripts/gen-third-party-notices.js   (rewrite this inventory)\n';
s += 'License identifiers are taken from each package\'s own metadata. The full\n';
s += 'text of each license family is in section 3.\n\n';

s += 'Bundled runtimes & binaries (shipped, but not enumerated as npm/PyPI packages)\n';
s += '  Electron 31                     MIT  (embeds Chromium [BSD-3-Clause] and\n';
s += '                                  FFmpeg [LGPL-2.1, dynamically linked]; the\n';
s += '                                  Electron runtime ships its own complete\n';
s += '                                  LICENSE + LICENSES.chromium.html, included\n';
s += '                                  by reference — see the note in section 3)\n';
s += '  CPython 3.12 (vendor/python)    PSF License Agreement (GPL-compatible,\n';
s += '                                  permissive; (c) Python Software Foundation)\n';
s += '  Tesseract OCR 5 (vendor/        Apache-2.0  (engine binary + tessdata\n';
s += '    tesseract, + tessdata)        trained-data; (c) the Tesseract contributors)\n';
s += '  SQLite (in better-sqlite3)      Public Domain (https://sqlite.org/copyright.html)\n\n';

s += `Node.js components — production dependency tree (${node.length})\n`;
s += node.map(row).join('\n') + '\n\n';

if (pythonPresent) {
  s += `Python components — bundled interpreter, vendor/python (${py.length})\n`;
  s += py.map(row).join('\n') + '\n\n';
} else {
  s += 'Python components — vendor/python was NOT present when this inventory was\n';
  s += 'generated, so the bundled Python packages are not listed. Regenerate on the\n';
  s += 'build machine (where vendor/python exists) before release.\n\n';
}

s += 'User-interface fonts (self-hosted asset files, src/windows/shared/fonts)\n';
s += '  IBM Plex Sans / IBM Plex Mono   SIL Open Font License 1.1 (c) 2017 IBM Corp.\n\n';

s += 'NOT distributed (excluded from the installer; listed for completeness)\n';
s += '  Ollama + phi3:mini              excluded via build config (if ever bundled,\n';
s += '                                  both are MIT, (c) Microsoft / Ollama authors)\n\n';

// ── Splice the new inventory into the existing notice ────────────────────────
let txt = fs.readFileSync(NOTICE, 'utf8');
const re = /-{60,}\r?\n1\. COMPONENT INVENTORY\r?\n-{60,}\r?\n[\s\S]*?(?=-{60,}\r?\n2\. PER-COMPONENT COPYRIGHT)/;
if (!re.test(txt)) {
  console.error('Could not locate the "1. COMPONENT INVENTORY" section to replace. Aborting.');
  process.exit(1);
}
txt = txt.replace(re, s.replace(/\r?\n/g, '\r\n'));

// Stamp the product versions from package.json, so the notice tracks the build
// it ships with instead of a hand-edited number.
const coreVer = require('../package.json').version;
let clientVer = '?';
try { clientVer = require('../client/package.json').version; } catch { /* client optional */ }
txt = txt.replace(/^Applies to product version: .*/m,
  `Applies to product version: ScanFinder ${coreVer} (core) / ${clientVer} (search client).`);
// Refresh the review date.
txt = txt.replace(/^Last reviewed: .*/m, `Last reviewed: ${new Date().toISOString().slice(0, 10)}.`);
fs.writeFileSync(NOTICE, txt);

console.log(`Inventory rewritten: ${node.length} node + ${pythonPresent ? py.length : 0} python components`
  + (pythonPresent ? '' : ' (vendor/python absent — Python not listed)') + '.');
