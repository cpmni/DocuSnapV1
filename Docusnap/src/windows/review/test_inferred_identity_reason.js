// Lever A (2026-08-20, Chris round-10 card #3) — CROSS-LANGUAGE PIN.
// renderReviewReason surfaces the template-identity FILL note as its own actionable Review block by
// matching two exact strings (INFERRED_IDENTITY_NOTES in review/renderer.js). Those strings MUST
// equal the Python engine's _TEMPLATE_IDENTITY_FILL_NOTE_{SINGLE,MAJORITY} (engine.py) — otherwise a
// reword on the engine side silently drops the doc back into the opaque "formatting check" bucket and
// the trapdoor returns. This test reads both files as text and asserts the sets are equal.
//
// Run:  node src/windows/review/test_inferred_identity_reason.js   (from repo root)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// Reconstruct a Python parenthesised implicit-concatenated string constant: join every "…" segment.
function pyConst(name) {
  const m = engineSrc.match(new RegExp(name + '\\s*=\\s*\\(([\\s\\S]*?)\\)'));
  if (!m) return null;
  const segs = [...m[1].matchAll(/"([^"]*)"/g)].map(s => s[1]);
  return segs.length ? segs.join('') : null;
}
const pySingle = pyConst('_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE');
const pyMajority = pyConst('_TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY');

// Extract the JS array literal's single-quoted strings.
const jm = rendererSrc.match(/const INFERRED_IDENTITY_NOTES\s*=\s*\[([\s\S]*?)\]/);
const jsNotes = jm ? [...jm[1].matchAll(/'([^']*)'/g)].map(s => s[1]) : [];

check('engine SINGLE constant found', !!pySingle && pySingle.includes('Company inferred'));
check('engine MAJORITY constant found', !!pyMajority && pyMajority.includes('Company inferred'));
check('renderer INFERRED_IDENTITY_NOTES has 2 entries', jsNotes.length === 2);

const py = new Set([pySingle, pyMajority].filter(Boolean));
const js = new Set(jsNotes);
check('SINGLE note matches across JS ↔ Python', js.has(pySingle));
check('MAJORITY note matches across JS ↔ Python', js.has(pyMajority));
check('no EXTRA JS note that the engine does not emit', jsNotes.every(n => py.has(n)));

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
