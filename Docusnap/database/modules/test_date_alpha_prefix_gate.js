#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_date_alpha_prefix_gate.js
 * -----------------------------------------------
 * JS twin of python_backend/tests/test_date_alpha_prefix_gate.py (log review Item 3, 2026-09-05):
 * the shipped numeric date patterns carry an ALNUM lookbehind `(?<![A-Za-z0-9])` so a date can no
 * longer be read out of the tail of a letter-prefixed code (`PI/26/6000` -> `1/26/6000`). The JS
 * consumers compile the SAME config text through `new RegExp(p, 'i')` (trust.js _matchesTypePattern,
 * the Review renderer's on-blur validation), so the shared vector file must behave identically here.
 *
 *   node database/modules/test_date_alpha_prefix_gate.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'keyword_patterns.json'), 'utf8'));
const DATE = cfg.validation_patterns.date;
const vec = JSON.parse(fs.readFileSync(path.join(ROOT, 'python_backend', 'tests', 'date_alpha_prefix_vectors.json'), 'utf8'));
const matches = (s) => DATE.some(p => new RegExp(p, 'i').test(s));

console.log('-- 1 every date pattern compiles in V8 (lookbehind supported) --');
for (const p of DATE) { let ok = true; try { new RegExp(p, 'i'); } catch { ok = false; } check(`compiles: ${p}`, ok); }
const numeric = DATE.filter(p => p.startsWith('(?<!'));
check('two numeric patterns carry the alnum lookbehind', numeric.length === 2 && numeric.every(p => p.startsWith('(?<![A-Za-z0-9])')));

console.log('-- 2 shared vectors --');
for (const s of vec.accept) check(`ACCEPT ${JSON.stringify(s)}`, matches(s));
for (const s of vec.reject) check(`REJECT ${JSON.stringify(s)}`, !matches(s));

console.log('-- 3 the OLD pattern matched inside the exhibit (decisive) --');
check("OLD (?<!\\d) matched '1/26/6000' inside 'P1/26/6000'", /(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)/i.test('P1/26/6000'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
