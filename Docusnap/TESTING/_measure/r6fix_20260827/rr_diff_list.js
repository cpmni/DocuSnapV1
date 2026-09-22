'use strict';
// Per-doc diff for the LIST-REVIEW slice realdoc gate (2026-08-27 pm): baseline = this morning's letterhead ON arm
// (rr_lh_on_dump.jsonl, 11:09, same live-DB settings) vs the post-slice run (rr_list_dump.jsonl). The owner's DB grew
// between the runs, so the diff is over the SHARED ids only; the md tables are compared by eye (printed below).
const fs = require('fs');
const OUT = 'c:/GIT Projects/Docusnap/stress_test/out';
const load = (f) => { const m = new Map(); for (const l of fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n')) { if (!l.trim()) continue; try { const j = JSON.parse(l); m.set(j.id, j); } catch {} } return m; };
const base = load('rr_lh_on_dump.jsonl'), cur = load('rr_list_dump.jsonl');
const shared = [...base.keys()].filter(id => cur.has(id)).sort((a, b) => a - b);
const onlyNew = [...cur.keys()].filter(id => !base.has(id)).length;
const keys = new Set(); for (const r of [...base.values(), ...cur.values()]) Object.keys(r).forEach(k => keys.add(k));
console.log(`baseline docs ${base.size} · current docs ${cur.size} · shared ${shared.length} · new-only ${onlyNew}`);
console.log(`dump keys: ${[...keys].join(', ')}`);
const diffs = {};
for (const id of shared) {
  const a = base.get(id), b = cur.get(id);
  for (const k of keys) {
    if (k === 'id') continue;
    const x = JSON.stringify(a[k] ?? null), y = JSON.stringify(b[k] ?? null);
    if (x !== y) (diffs[k] = diffs[k] || []).push({ id, base: a[k], cur: b[k] });
  }
}
for (const [k, rows] of Object.entries(diffs)) {
  console.log(`\n${k}: ${rows.length} doc(s) differ`);
  for (const r of rows.slice(0, 12)) console.log(`  #${r.id}: ${JSON.stringify(r.base)} → ${JSON.stringify(r.cur)}`);
}
if (!Object.keys(diffs).length) console.log('\nNO per-doc differences on the shared ids (byte-identical on every dumped field).');
const tail = (f, n) => { const ls = fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n'); return ls.filter(l => /accuracy|type|supplier|ref|date|total|would|regress|M=|M_type|wrong/i.test(l)).slice(0, n).join('\n'); };
console.log('\n--- baseline md (rr_lh_on.md) key lines ---\n' + tail('rr_lh_on.md', 30));
console.log('\n--- current md (rr_list.md) key lines ---\n' + tail('rr_list.md', 30));
