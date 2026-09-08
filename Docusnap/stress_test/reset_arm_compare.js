'use strict';
/*
 * reset_arm_compare.js — the Oracle C8 metric for the mig-137 reconciliation arm
 * (docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.3): compare two realdoc_regression.js
 * RR_CONSENSUS jsonl files — the "136" arm (the reference DB with the test switches ON) and the
 * "137" arm (the same DB after the customer-build reset, all OFF).
 *
 *   PASS  ⇔  wouldFile(137) ⊆ wouldFile(136)   AND   value diffs on the intersection = 0
 *
 * Extra HOLDS on the OFF arm are EXPECTED (an OFF arm holds more by design), not regressions. The
 * regression class is 137 FILING what 136 held, or filing a DIFFERENT value. Any such doc must be
 * page-rendered before it counts (the confirmed values were accumulated everything-ON — rubber-stamp
 * class, S5). Plain node.
 *
 *   node stress_test/reset_arm_compare.js <consensus_136.jsonl> <consensus_137.jsonl>
 */
const fs = require('fs');
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: reset_arm_compare.js <consensus_ON.jsonl> <consensus_OFF.jsonl>'); process.exit(2); }
const load = (f) => { const m = new Map(); for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; const r = JSON.parse(l); m.set(r.id, r); } return m; };
const ON = load(a), OFF = load(b);
const ids = [...new Set([...ON.keys(), ...OFF.keys()])].sort((x, y) => x - y);
const onlyOn = ids.filter(i => ON.has(i) && !OFF.has(i)), onlyOff = ids.filter(i => OFF.has(i) && !ON.has(i));
const wfOn = new Set(ids.filter(i => ON.get(i)?.wouldFile)), wfOff = new Set(ids.filter(i => OFF.get(i)?.wouldFile));
const newFilers = [...wfOff].filter(i => !wfOn.has(i));            // 137 files what 136 held  → REGRESSION class
const extraHolds = [...wfOn].filter(i => !wfOff.has(i));           // 136 filed, 137 holds     → expected
const both = [...wfOn].filter(i => wfOff.has(i));
const norm = (v) => (v == null ? '' : String(v).trim());
const diffs = [];
for (const i of both) {
  const x = ON.get(i), y = OFF.get(i);
  const fx = x.fields || {}, fy = y.fields || {};
  const keys = new Set([...Object.keys(fx), ...Object.keys(fy)]);
  const d = [];
  for (const k of keys) {
    const vx = norm(fx[k]?.value ?? fx[k]), vy = norm(fy[k]?.value ?? fy[k]);
    if (vx !== vy) d.push(`${k}: '${vx}' → '${vy}'`);
  }
  if (norm(x.ref?.got ?? x.ref) !== norm(y.ref?.got ?? y.ref)) d.push(`ref: ${JSON.stringify(x.ref)} → ${JSON.stringify(y.ref)}`);
  if (norm(x.date?.got ?? x.date) !== norm(y.date?.got ?? y.date)) d.push(`date: ${JSON.stringify(x.date)} → ${JSON.stringify(y.date)}`);
  if (d.length) diffs.push({ id: i, type: x.type, d });
}
console.log(`docs: ON=${ON.size} OFF=${OFF.size} (only-ON ${onlyOn.length}, only-OFF ${onlyOff.length})`);
console.log(`wouldFile: ON=${wfOn.size} OFF=${wfOff.size} · both=${both.length} · extra holds on OFF (expected)=${extraHolds.length} · NEW filers on OFF (regression class)=${newFilers.length}`);
if (extraHolds.length) console.log(`  extra holds: ${extraHolds.slice(0, 40).join(',')}${extraHolds.length > 40 ? '…' : ''}`);
if (newFilers.length) console.log(`  NEW filers (render before counting): ${newFilers.map(i => `${i}(${OFF.get(i).reason || ''})`).join(', ')}`);
console.log(`value diffs on the intersection: ${diffs.length}`);
for (const x of diffs.slice(0, 40)) console.log(`  #${x.id} ${x.type || ''}: ${x.d.join(' | ')}`);
const pass = newFilers.length === 0 && diffs.length === 0 && onlyOn.length === 0 && onlyOff.length === 0;
console.log(pass ? '\nPASS — wouldFile(137) ⊆ wouldFile(136) and 0 value diffs on the intersection.' : '\nFAIL — see above (a NEW filer or a value diff needs a page render before it counts as a regression).');
process.exit(pass ? 0 : 1);
