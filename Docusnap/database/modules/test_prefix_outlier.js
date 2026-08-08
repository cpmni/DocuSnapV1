'use strict';
/*
 * database/modules/test_prefix_outlier.js
 * ---------------------------------------
 * Pins the JS prefix-outlier predicate (prefix_outlier.js — the confirm-gate mirror of the python
 * ocr_corrector guard) AND asserts byte-PARITY against the python by spawning _prefix_parity_probe.py.
 * The parity block is what stops the JS twin from silently drifting from the python (Oracle condition).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_prefix_outlier.js
 *      (plain `node` works too — no native deps). Parity needs `py -3.12`; it SKIPS (warns) if absent.
 */
const p = require('./prefix_outlier');
const { spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

let fails = 0;
function check(name, cond) { console.log((cond ? 'OK  ' : 'BAD ') + name); if (!cond) fails++; }

const many = (prefix, n, start = 0) => Object.fromEntries([...Array(n)].map((_, i) => [`${prefix}-${start + i}`, 1]));
const poisonVC = () => ({ ...many('DN', 12), 'IN-1': 1, 'IN-2': 1, '09/2026': 1 });   // 12 DN / 2 IN / 1 dateish -> total 15
const legitVC  = () => ({ ...many('DN', 50), ...many('CN', 8) });                      // established second prefix
const mixedVC  = () => ({ ...many('DN', 6), ...many('CN', 5) });                       // 55/45 -> disarm
const dnScope  = many('DN', 13, 60000);

// ── codePrefix (mirror the python test cases) ──────────────────────────────────
check('codePrefix DN-11354 -> DN', p.codePrefix('DN-11354') === 'DN');
check('codePrefix INV-2044 -> INV', p.codePrefix('INV-2044') === 'INV');
check('codePrefix WS830532 -> WS', p.codePrefix('WS830532') === 'WS');
check('codePrefix IN/26/0045 -> IN', p.codePrefix('IN/26/0045') === 'IN');
check('codePrefix lowercases -> upper', p.codePrefix('dn-9') === 'DN');
check('codePrefix pure-numeric -> null', p.codePrefix('1947063') === null);
check('codePrefix single-letter -> null', p.codePrefix('A1234') === null);
check('codePrefix no-digit (name) -> null', p.codePrefix('ABCDEF') === null);

// ── buildScopeRec arming / disarming ───────────────────────────────────────────
const recClean = p.buildScopeRec(dnScope);
check('clean 13-DN scope ARMS (dominant DN)', !!recClean && recClean.dominant === 'DN' && recClean.total === 13);
check('legit 55/45 two-prefix DISARMS', p.buildScopeRec(mixedVC()) === null);
check('pure-numeric DISARMS', p.buildScopeRec(Object.fromEntries([...Array(10)].map((_, i) => [String(1000 + i), 1]))) === null);
check('below MIN_COUNT DISARMS', p.buildScopeRec({ 'DN-1': 1, 'DN-2': 1 }) === null);

// ── weight-aware outlier (the Slice-2 rule, mirrored) ──────────────────────────
const poison = p.buildScopeRec(poisonVC());
check('poison rec: dominant DN, total 15, counts {DN:12,IN:2}',
      poison && poison.dominant === 'DN' && poison.total === 15 && poison.counts.DN === 12 && poison.counts.IN === 2);
check('Ridgeway poison: IN (2/15) FLAGS', p.isPrefixOutlier('IN', poison) === true);
check('DN (dominant) never flags', p.isPrefixOutlier('DN', poison) === false);
check('length-change (INV) no-fire', p.isPrefixOutlier('INV', poison) === false);
check('established CN (8/58) EXEMPT', p.isPrefixOutlier('CN', p.buildScopeRec(legitVC())) === false);
check('checkValue non-code value -> not outlier', p.checkValue('12345', recClean).outlier === false);
check('checkValue IN-14390 on poison -> outlier + prefix/dominant',
      (() => { const c = p.checkValue('IN-14390', poison); return c.outlier === true && c.prefix === 'IN' && c.dominant === 'DN'; })());
check('null rec -> never outlier', p.checkValue('IN-1', null).outlier === false);

// ── LIVE PARITY vs the python (ocr_corrector) ──────────────────────────────────
const cases = [
  { value_counts: poisonVC(), read_prefix: 'IN' },   // flag (2/15)
  { value_counts: poisonVC(), read_prefix: 'YN' },   // flag (unknown Hamming-1)
  { value_counts: legitVC(),  read_prefix: 'CN' },   // exempt (8/58, ABS)
  { value_counts: dnScope,    read_prefix: 'IN' },   // flag (count 0)
  { value_counts: dnScope,    read_prefix: 'DN' },   // never (dominant)
  { value_counts: { ...many('DN', 40), 'IN-a': 1, 'IN-b': 1, 'IN-c': 1, 'IN-d': 1 }, read_prefix: 'IN' }, // 4/44 thr 5 -> flag
  { value_counts: { ...many('DN', 40), ...many('CN', 5) }, read_prefix: 'CN' },  // 5/45 thr 5 -> exempt
  { value_counts: mixedVC(),  read_prefix: 'CN' },   // disarmed scope
];
const tmp = path.join(os.tmpdir(), `prefix_parity_${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(cases));
const probe = path.join(__dirname, '..', '..', 'python_backend', 'tests', '_prefix_parity_probe.py');
let py = spawnSync('py', ['-3.12', probe, tmp], { encoding: 'utf8' });
if (py.error || py.status !== 0) py = spawnSync('python', [probe, tmp], { encoding: 'utf8' });   // fallback
try { fs.unlinkSync(tmp); } catch { /* ignore */ }

if (py.error || py.status !== 0 || !py.stdout) {
  console.log('WARN parity SKIPPED (python probe unavailable): ' + ((py.stderr || (py.error && py.error.message) || 'no output')).trim());
} else {
  let pyOut = null;
  try { pyOut = JSON.parse(py.stdout.trim().split(/\r?\n/).pop()); } catch { /* below */ }
  if (!Array.isArray(pyOut) || pyOut.length !== cases.length) {
    check('parity probe returned a result per case', false);
    console.log('   probe stdout: ' + py.stdout);
  } else {
    cases.forEach((cse, i) => {
      const rec = p.buildScopeRec(cse.value_counts);
      const jsOutlier = rec ? p.isPrefixOutlier(cse.read_prefix, rec) : false;
      const jsDom = rec ? rec.dominant : null;
      const jsTotal = rec ? rec.total : null;
      const pr = pyOut[i] || {};
      check(`parity[${i}] ${cse.read_prefix}: outlier JS==PY (js=${jsOutlier})`, jsOutlier === !!pr.outlier);
      check(`parity[${i}] dominant JS==PY (js=${jsDom})`, (jsDom || null) === (pr.dominant || null));
      check(`parity[${i}] total JS==PY (js=${jsTotal})`, (jsTotal == null ? null : jsTotal) === (pr.total == null ? null : pr.total));
    });
  }
}

console.log();
console.log(fails ? `${fails} FAILED` : 'All prefix_outlier JS + parity checks passed');
process.exit(fails ? 1 : 0);
