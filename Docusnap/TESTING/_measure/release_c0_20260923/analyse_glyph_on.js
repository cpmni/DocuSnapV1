#!/usr/bin/env node
'use strict';
/*
 * S0 measurement analysis (007 + oscar, 2026-09-23 night). Inputs: the baseline OFF arm (full.jsonl), the
 * second-reader ON arm (glyph_on.jsonl) and its engine trace (glyph_on.trace.jsonl, RR_TRACE_OUT).
 * Reports: (a) glyph_check outcome × geom_src histogram; (b) every DISAGREEMENT hold: PP's read vs the box vs the
 * confirmed GT (true catch / false hold); (c) on the baseline's `disagreeing-read` + soften docs, PP's side;
 * (d) wouldFile OFF→ON changes (the hold may only ADD holds); (e) DOWNGRADE rewords (agree on a soften doc).
 *
 * Usage: node analyse_glyph_on.js <full.jsonl> <glyph_on.jsonl> <glyph_on.trace.jsonl>
 */
const fs = require('fs');
const load = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const off = load(process.argv[2]), on = load(process.argv[3]), tr = load(process.argv[4]);
const offBy = new Map(off.map(r => [r.id, r])), onBy = new Map(on.map(r => [r.id, r]));
const SOFT = 'look like another on a scan';
const norm = s => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// trace events are keyed by the shard's file name (docNNN.pdf) — map to ids via the harness's naming
const idOf = (doc) => { const m = /doc(\d+)\.pdf/.exec(String(doc || '')); return m ? Number(m[1]) : null; };
const checks = tr.filter(e => e.event === 'glyph_check'), dis = tr.filter(e => e.event === 'glyph_disagreement');
const resolves = tr.filter(e => e.event === 'glyph_resolve');

// (a) histogram
const hist = {};
for (const e of checks) { const k = `${e.outcome}${e.reason ? ':' + e.reason : ''} / geom=${e.geom_src || '?'}`; hist[k] = (hist[k] || 0) + 1; }
console.log(`docs OFF ${off.length} · ON ${on.length} · trace events ${tr.length} (glyph_check ${checks.length}, disagreement ${dis.length}, resolve ${resolves.length})`);
console.log('\n(a) glyph_check outcome × geometry source:'); Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

// (b) disagreement holds vs GT — GT = the confirmed value; the ON row tells us whether the committed (box) read was correct
console.log(`\n(b) DISAGREEMENT holds (${dis.length}): PP read vs box read vs confirmed`);
let trueCatch = 0, falseHold = 0, ppWrongBoxWrong = 0;
for (const e of dis) {
  const id = idOf(e.doc); const r = onBy.get(id); const o = offBy.get(id);
  const boxOk = r && r.ref ? r.ref.correct : null;          // was the committed (box) read right?
  // PP right? we cannot see GT directly; infer: box wrong AND the OFF baseline's confirmed value equals PP's read is not
  // available here — so report both reads and the box verdict; adjudicate the residual by eye.
  const tag = boxOk === false ? 'BOX WRONG (PP likely right → true catch)' : boxOk === true ? 'BOX RIGHT (PP wrong → FALSE HOLD)' : '?';
  if (boxOk === false) trueCatch++; else if (boxOk === true) falseHold++; else ppWrongBoxWrong++;
  console.log(`  #${id} ${r ? r.type : '?'} box='${e.committed}' pp='${e.pp_read}' (pp ${e.pp_conf}) ${tag} · OFF reason=${o && o.reason} note=${o && o.ref && o.ref.note ? 'yes' : 'no'}`);
}
console.log(`  → box-wrong (true catch) ${trueCatch} · box-right (false hold) ${falseHold} · unknown ${ppWrongBoxWrong}`);

// (c) the baseline's disagreeing-read + soften docs: what did the second reader say?
const target = off.filter(r => String(r.reason).startsWith('disagreeing-read') || (r.ref && r.ref.note && r.ref.note.includes(SOFT)));
console.log(`\n(c) baseline disagreeing-read + soften docs: ${target.length}`);
const byDoc = {};
for (const e of checks.concat(dis)) { const id = idOf(e.doc); (byDoc[id] = byDoc[id] || []).push(e); }
const tally = {};
for (const r of target) {
  const evs = byDoc[r.id] || [];
  const k = evs.length ? evs.map(e => e.event === 'glyph_disagreement' ? 'DISAGREE' : `${e.outcome}${e.reason ? ':' + e.reason : ''}`).join('+') : 'no-event';
  tally[k] = (tally[k] || 0) + 1;
}
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
for (const r of target) {
  const evs = byDoc[r.id] || [];
  const d = evs.find(e => e.event === 'glyph_disagreement');
  if (d) console.log(`  #${r.id} ${r.type} box='${d.committed}' pp='${d.pp_read}' boxCorrect=${r.ref && r.ref.correct} OFF=${r.reason}`);
}

// (d) wouldFile changes
const gained = on.filter(r => r.wouldFile && offBy.get(r.id) && !offBy.get(r.id).wouldFile);
const lost = on.filter(r => !r.wouldFile && offBy.get(r.id) && offBy.get(r.id).wouldFile);
console.log(`\n(d) wouldFile OFF→ON: gained ${gained.length} (must be 0 — the hold only adds holds) · lost ${lost.length}`);
gained.forEach(r => console.log(`  GAINED #${r.id} ${r.type} ref='${r.ref && r.ref.val}'`));
lost.forEach(r => console.log(`  lost #${r.id} ${r.type} ref='${r.ref && r.ref.val}' ON reason=${r.reason}`));

// (e) downgrade rewords
console.log(`\n(e) DOWNGRADE rewords (glyph_resolve agree): ${resolves.filter(e => e.outcome === 'agree').length}; disagree-in-resolve: ${resolves.filter(e => e.outcome === 'disagree').length}`);
