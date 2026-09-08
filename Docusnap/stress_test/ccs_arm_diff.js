'use strict';
/*
 * ccs_arm_diff.js — arm-vs-arm diff of two customer_corpus_score.js jsonl outputs
 * (docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §4 slice 3.4). The A↔B pin for the efficiency bundle is
 * ZERO delta across verdicts / *_got / confs / notes / methods per doc+rendition; A↔C (200 vs 300 DPI)
 * is informational per lane. Rows keyed by file|rendition; the `_operating_point` header row is compared
 * separately and printed. Plain node.
 *
 *   node stress_test/ccs_arm_diff.js stress_test/out/customer_score_<A>.jsonl stress_test/out/customer_score_<B>.jsonl [--strict]
 *   --strict  exit 1 on ANY delta (the A↔B pin); default = report only (A↔C)
 */
const fs = require('fs');
const [a, b, ...flags] = process.argv.slice(2);
if (!a || !b) { console.error('usage: ccs_arm_diff.js <A.jsonl> <B.jsonl> [--strict]'); process.exit(2); }
const strict = flags.includes('--strict');
const load = (f) => {
  const rows = new Map(); let op = null;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue; const r = JSON.parse(l);
    if (r._operating_point) { op = r._operating_point; continue; }
    rows.set(`${r.file}|${r.rendition}`, r);
  }
  return { rows, op };
};
const A = load(a), B = load(b);
const keys = [...new Set([...A.rows.keys(), ...B.rows.keys()])].sort();
const onlyA = keys.filter(k => !B.rows.has(k)), onlyB = keys.filter(k => !A.rows.has(k));
const FIELDS = ['verdicts', 'confs', 'notes', 'methods'];
const norm = (v) => JSON.stringify(v === undefined ? null : v);
const deltas = []; const laneFlips = {};
for (const k of keys) {
  const x = A.rows.get(k), y = B.rows.get(k); if (!x || !y) continue;
  const d = [];
  if (x.processed !== y.processed) d.push(`processed ${x.processed}→${y.processed}`);
  for (const f of FIELDS) {
    const lanes = new Set([...Object.keys(x[f] || {}), ...Object.keys(y[f] || {})]);
    for (const lane of lanes) {
      const vx = norm((x[f] || {})[lane]), vy = norm((y[f] || {})[lane]);
      if (vx !== vy) { d.push(`${f}.${lane} ${vx}→${vy}`); if (f === 'verdicts') { laneFlips[lane] = laneFlips[lane] || { gain: 0, loss: 0 }; if (y.verdicts[lane]) laneFlips[lane].gain++; else laneFlips[lane].loss++; } }
    }
  }
  for (const g of Object.keys({ ...x, ...y }).filter(n => /_got$/.test(n))) if (norm(x[g]) !== norm(y[g])) d.push(`${g} ${norm(x[g])}→${norm(y[g])}`);
  if (d.length) deltas.push({ k, d });
}
console.log(`A: ${a}\n   operating point: ${A.op ? JSON.stringify(A.op) : '(none recorded — pre-C6 run)'}`);
console.log(`B: ${b}\n   operating point: ${B.op ? JSON.stringify(B.op) : '(none recorded — pre-C6 run)'}`);
console.log(`rows: A=${A.rows.size} B=${B.rows.size} only-A=${onlyA.length} only-B=${onlyB.length} · docs with ANY delta: ${deltas.length}`);
if (Object.keys(laneFlips).length) console.log('verdict flips per lane (A→B): ' + Object.entries(laneFlips).map(([l, v]) => `${l} +${v.gain}/-${v.loss}`).join(' · '));
for (const x of deltas.slice(0, 60)) console.log(`  ${x.k}: ${x.d.join(' | ')}`);
if (deltas.length > 60) console.log(`  … ${deltas.length - 60} more`);
const clean = deltas.length === 0 && onlyA.length === 0 && onlyB.length === 0;
console.log(clean ? '\nIDENTICAL — zero delta across verdicts / *_got / confs / notes / methods.' : (strict ? '\nFAIL — deltas present (the A↔B pin requires zero).' : '\n(report only)'));
process.exit(strict && !clean ? 1 : 0);
