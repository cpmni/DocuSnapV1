'use strict';
/* _ab_summary.js — headline comparison of the four realdoc arms (off / sweep / discount / all):
 * accuracy table, regressions (+ SILENT), would-auto-file N, M (wrong would-file), M_type, per-field fill lines that
 * differ; the reslice census fires/declines per arm; recon_demote fires with a resliced witness; and, from
 * RR_CONSENSUS, the count of total-role fields whose method carries '+corrob_clear' (the class-C / recon release
 * counter) per arm, plus per-doc would-file flips between arms (from RR_DUMP). */
const fs = require('fs'), path = require('path');
const RUNS = 'C:/Users/cmccu/.claude/jobs/a8d11584/tmp/runs';
const ARMS = ['off', 'sweep', 'discount', 'all'];
const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const lines = (f) => (rd(f) || '').split('\n').map(s => s.trim()).filter(s => s[0] === '{').map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

const head = {};
for (const a of ARMS) {
  const md = rd(path.join(RUNS, `realdoc_${a}.md`));
  if (!md) { console.log(`${a}: report MISSING`); continue; }
  const acc = {}; for (const m of md.matchAll(/^\| (type|supplier|ref|date|total|subtotal) \| (\d+) \| (\d+) \| ([\d.]+%|-) \|/gm)) acc[m[1]] = `${m[2]}/${m[3]} ${m[4]}`;
  const reg = (md.match(/\*\*Regressions[^:]*: (\d+)\*\* — of which (\d+) SILENT/) || []).slice(1);
  const af = (md.match(/\*\*Auto-file soundness \(#6\): (\d+)\/(\d+) reprocessed docs would auto-file; (\d+) would auto-file a WRONG value/) || []).slice(1);
  const mt = (md.match(/\*\*Wrong-TYPE auto-file \(M_type, Oracle C3\): (\d+)/) || [])[1];
  const aborted = /ABORTED EARLY/.test(md);
  head[a] = { acc, regressions: reg[0], silent: reg[1], wouldFile: af[0], of: af[1], M: af[2], M_type: mt, aborted };
  console.log(`${a.padEnd(9)} ${aborted ? '!! ABORTED ' : ''}acc=${JSON.stringify(acc)} regressions=${reg[0]} silent=${reg[1]} wouldFile=${af[0]}/${af[1]} M=${af[2]} M_type=${mt}`);
  // fill-rate lines for a later diff
  head[a].fill = Object.fromEntries([...md.matchAll(/^- ([^:]+): (\d+)\/(\d+)/gm)].map(m => [m[1], `${m[2]}/${m[3]}`]));
}
// fill-rate diffs vs off
for (const a of ARMS.slice(1)) {
  if (!head[a] || !head.off) continue;
  const diffs = Object.keys({ ...head.off.fill, ...head[a].fill }).filter(k => head.off.fill[k] !== head[a].fill[k]);
  console.log(`fill-rate diffs off→${a}: ${diffs.length ? diffs.map(k => `${k} ${head.off.fill[k]}→${head[a].fill[k]}`).join('; ') : 'none'}`);
}
// census
for (const a of ARMS) {
  const rc = lines(path.join(RUNS, `census_realdoc_${a}`, 'reslice_census.jsonl'));
  const byReason = {}; for (const r of rc) { const k = r.witness ? 'WITNESS' : (r.decline || '?'); byReason[k] = (byReason[k] || 0) + 1; }
  const rd2 = lines(path.join(RUNS, `census_realdoc_${a}`, 'recon_demote_census.jsonl'));
  const demoted = rd2.filter(r => r.demoted), resliced = demoted.filter(r => String(r.witness || '').includes('resliced'));
  console.log(`${a.padEnd(9)} reslice census: ${JSON.stringify(byReason)} | recon demotes: ${demoted.length} (by resliced witness: ${resliced.length}; declined: ${rd2.length - demoted.length})`);
  const wit = rc.filter(r => r.witness); for (const w of wit.slice(0, 10)) console.log(`    witness: committed=${w.committed} read=${w.witness.value}@${w.witness.confidence} ${w.witness.rung}`);
}
// +corrob_clear on total-role fields per arm (RR_CONSENSUS)
for (const a of ARMS) {
  const cs = lines(path.join(RUNS, `realdoc_${a}_consensus.jsonl`));
  let clear = 0, noted = 0;
  for (const d of cs) for (const [k, v] of Object.entries(d.fields || {})) {
    if (!/total/.test(k)) continue;
    if (String(v[2] || '').includes('+corrob_clear')) clear++;
    if (v[3]) noted++;
  }
  console.log(`${a.padEnd(9)} consensus: docs=${cs.length} total-fields with +corrob_clear=${clear} noted totals=${noted}`);
}
// would-file flips vs off (RR_DUMP)
const dump = a => Object.fromEntries(lines(path.join(RUNS, `realdoc_${a}_dump.jsonl`)).map(r => [r.id, r]));
const off = dump('off');
for (const a of ARMS.slice(1)) {
  const d = dump(a); const gained = [], lost = [];
  for (const id of Object.keys(off)) { if (!d[id]) continue; if (!off[id].wouldFile && d[id].wouldFile) gained.push(id); if (off[id].wouldFile && !d[id].wouldFile) lost.push(id); }
  console.log(`would-file flips off→${a}: gained ${gained.length} [${gained.slice(0, 20).join(',')}] lost ${lost.length} [${lost.slice(0, 20).join(',')}]`);
}
