// compare.js OFF.jsonl ON.jsonl [fireRegex]
// Per-doc OFF-vs-ON census over realdoc RR_CONSENSUS rows:
//   M      = ref/date correct OFF, wrong ON  (the safety gate — must be 0)
//   heal   = ref/date wrong OFF, correct ON
//   file→hold / hold→file = wouldFile deltas
//   fires  = ON rows whose fields carry the switch's signature (method suffix or note text) [fireRegex]
const fs = require('fs');
const load = f => { const m = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); m[r.id] = r; } catch {} } return m; };
const [offF, onF, fireRe] = process.argv.slice(2);
const off = load(offF), on = load(onF);
const ids = Object.keys(off).filter(id => on[id]).map(Number).sort((a, b) => a - b);
const missingOn = Object.keys(off).filter(id => !on[id]).length, missingOff = Object.keys(on).filter(id => !off[id]).length;
const M = [], heal = [], f2h = [], h2f = [], fires = [], valChanged = [], noteChanged = [];
let fileOff = 0, fileOn = 0;
const re = fireRe ? new RegExp(fireRe, 'i') : null;
for (const id of ids) {
  const a = off[id], b = on[id];
  if (a.wouldFile) fileOff++; if (b.wouldFile) fileOn++;
  for (const lane of ['ref', 'date']) {
    const x = a[lane], y = b[lane]; if (!x || !y) continue;
    if (x.correct === true && y.correct === false) M.push(`#${id} ${a.type} ${lane}: OFF '${x.val}' -> ON '${y.val}' [${y.method}] note=${y.note}`);
    if (x.correct === false && y.correct === true) heal.push(`#${id} ${a.type} ${lane}: OFF '${x.val}' -> ON '${y.val}' [${y.method}]`);
  }
  if (a.wouldFile && !b.wouldFile) f2h.push(`#${id} ${a.type}: ${a.reason || ''} -> ${b.reason || ''}`);
  if (!a.wouldFile && b.wouldFile) h2f.push(`#${id} ${a.type}: ${a.reason || ''} -> ${b.reason || ''}  ref=${b.ref && b.ref.correct} date=${b.date && b.date.correct}`);
  // field-level diffs
  const keys = new Set([...Object.keys(a.fields || {}), ...Object.keys(b.fields || {})]);
  for (const k of keys) {
    const fa = (a.fields || {})[k] || [], fb = (b.fields || {})[k] || [];
    if (String(fa[0] ?? '') !== String(fb[0] ?? '')) valChanged.push(`#${id} ${k}: '${fa[0]}' -> '${fb[0]}' [${fa[2]} -> ${fb[2]}]`);
    else if (String(fa[3] ?? '') !== String(fb[3] ?? '')) noteChanged.push(`#${id} ${k}: note '${fa[3]}' -> '${fb[3]}'`);
    if (re && (re.test(String(fb[2] || '')) || re.test(String(fb[3] || '')))) fires.push(`#${id} ${k}: '${fb[0]}' [${fb[2]}] note=${fb[3]}`);
  }
}
console.log(`docs compared: ${ids.length} (missing in ON: ${missingOn}, missing in OFF: ${missingOff})`);
console.log(`wouldFile OFF ${fileOff} / ON ${fileOn}`);
console.log(`\nM (correct OFF -> wrong ON): ${M.length}`); M.forEach(s => console.log('  ' + s));
console.log(`\nHEALS (wrong OFF -> correct ON): ${heal.length}`); heal.forEach(s => console.log('  ' + s));
console.log(`\nfile->hold: ${f2h.length}`); f2h.forEach(s => console.log('  ' + s));
console.log(`hold->file: ${h2f.length}`); h2f.forEach(s => console.log('  ' + s));
if (re) { console.log(`\nFIRES (/${fireRe}/): ${fires.length}`); fires.forEach(s => console.log('  ' + s)); }
console.log(`\nfield VALUE changes: ${valChanged.length}`); valChanged.slice(0, 60).forEach(s => console.log('  ' + s));
console.log(`field NOTE-only changes: ${noteChanged.length}`); noteChanged.slice(0, 60).forEach(s => console.log('  ' + s));
