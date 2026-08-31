'use strict';
/*
 * type_outcome_report.js — the TYPE-outcome gate for task #5 (Northgate PO→Invoice type-flip).
 *
 * Reads the JSONL emitted by realdoc_regression.js under RR_TYPE_ENUM=<file> (one row per confirmed
 * doc: {id, supplier, gt, got, conf, wouldFile, typeOk, guard, overridden}) and reports the two
 * load-bearing numbers the fix must move, per Oracle's C2/C6:
 *   - SILENT-MISFILE  = wrong type, would auto-file, NO type guard held it   (must be 0)
 *   - FALSE-HOLD      = CORRECT type, but a TYPE guard (ambiguity/refuse) fired (minimise; owner-accepted)
 * plus per-supplier segmentation so the review-volume cost is shown to be concentrated (or not).
 *
 * Carries no data — safe to commit. The JSONL it reads DOES carry real values → keep it out of git
 * (write it to the session scratchpad, not stress_test/out which is fine too — both gitignored).
 *
 * Run (single):  node stress_test/type_outcome_report.js <enum.jsonl>
 * Run (A/B):     node stress_test/type_outcome_report.js <baseline.jsonl> <treatment.jsonl>
 */
const fs = require('fs');

function load(file) {
  const rows = [];
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = ln.trim(); if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch {}
  }
  return rows;
}

// A TYPE guard is ambiguity or refuse; g1 (veto-fallthrough) is adjacent, NOT a type guard.
const isTypeGuard = g => g === 'ambiguity' || g === 'refuse';

function classify(r) {
  if (!r.typeOk) {
    if (r.wouldFile) return 'silent_misfile';          // wrong type + auto-files + (no guard) → the bad one
    if (isTypeGuard(r.guard)) return 'caught_typeguard'; // wrong type, held by a type guard (fail-safe)
    return 'caught_other';                              // wrong type, held by low-conf / g1 / other
  }
  if (isTypeGuard(r.guard)) return 'false_hold';        // CORRECT type but a type guard fired (the cost)
  if (r.wouldFile) return 'correct_file';
  return 'correct_held_other';                          // correct type, not filed (low conf / g1) — not a type false-hold
}

const CLASSES = ['silent_misfile', 'caught_typeguard', 'caught_other', 'false_hold', 'correct_file', 'correct_held_other'];

function summarise(rows, label) {
  const cls = {}; for (const c of CLASSES) cls[c] = [];
  for (const r of rows) cls[classify(r)].push(r);
  const bySup = {};
  for (const r of rows) {
    const k = (r.supplier || '—');
    const b = bySup[k] || (bySup[k] = { n: 0, silent: 0, falseHold: 0 });
    b.n++; const c = classify(r);
    if (c === 'silent_misfile') b.silent++;
    if (c === 'false_hold') b.falseHold++;
  }
  const typeOk = rows.filter(r => r.typeOk).length;
  const out = [];
  out.push(`## ${label} — ${rows.length} confirmed docs`);
  out.push(`type accuracy: ${typeOk}/${rows.length} (${(100 * typeOk / rows.length).toFixed(1)}%)`);
  out.push('');
  out.push('| class | n |');
  out.push('|---|---|');
  for (const c of CLASSES) out.push(`| ${c} | ${cls[c].length} |`);
  out.push('');
  out.push(`**SILENT-MISFILE (must be 0): ${cls.silent_misfile.length}**`);
  for (const r of cls.silent_misfile) out.push(`- #${r.id} ${r.supplier || '—'}: ${r.gt} → ${r.got} @${r.conf}${r.overridden ? ' [GT-OVERRIDDEN]' : ''}`);
  out.push(`\n**FALSE-HOLD (correct type, type guard fired — minimise): ${cls.false_hold.length}**`);
  for (const r of cls.false_hold) out.push(`- #${r.id} ${r.supplier || '—'} ${r.gt} held by ${r.guard}`);
  // Per-supplier segmentation — only suppliers carrying a silent-misfile or false-hold (the cost sites).
  const supRows = Object.entries(bySup).filter(([, b]) => b.silent || b.falseHold).sort((a, b) => (b[1].silent + b[1].falseHold) - (a[1].silent + a[1].falseHold));
  if (supRows.length) {
    out.push('\n**Per-supplier (only sites with a silent-misfile or false-hold):**');
    out.push('| supplier | docs | silent | false-hold |');
    out.push('|---|---|---|---|');
    for (const [k, b] of supRows) out.push(`| ${k} | ${b.n} | ${b.silent} | ${b.falseHold} |`);
  }
  return { text: out.join('\n'), cls };
}

const files = process.argv.slice(2);
if (files.length < 1) { console.error('usage: node type_outcome_report.js <enum.jsonl> [<treatment.jsonl>]'); process.exit(2); }

const A = load(files[0]);
const ra = summarise(A, files.length === 2 ? 'BASELINE' : 'TYPE OUTCOMES');
console.log(ra.text);

if (files.length === 2) {
  const B = load(files[1]);
  const rb = summarise(B, 'TREATMENT');
  console.log('\n' + rb.text);

  // A/B transition — align by id, report class changes (the real gate signal).
  const ca = {}; for (const r of A) ca[r.id] = classify(r);
  const cb = {}; for (const r of B) cb[r.id] = classify(r);
  const clsA = {}; for (const r of A) clsA[r.id] = r;
  const clsB = {}; for (const r of B) clsB[r.id] = r;
  const ids = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
  const moved = [];
  let newSilent = 0, fixedSilent = 0, newFalseHold = 0, fixedFalseHold = 0, typeFixed = 0, typeBroke = 0;
  for (const id of ids) {
    const x = ca[id], y = cb[id];
    if (x === y) continue;
    moved.push({ id, x, y, a: clsA[id], b: clsB[id] });
    if (y === 'silent_misfile' && x !== 'silent_misfile') newSilent++;
    if (x === 'silent_misfile' && y !== 'silent_misfile') fixedSilent++;
    if (y === 'false_hold' && x !== 'false_hold') newFalseHold++;
    if (x === 'false_hold' && y !== 'false_hold') fixedFalseHold++;
    const aOk = clsA[id] && clsA[id].typeOk, bOk = clsB[id] && clsB[id].typeOk;
    if (!aOk && bOk) typeFixed++;
    if (aOk && !bOk) typeBroke++;
  }
  console.log('\n## A/B TRANSITION');
  console.log(`NEW silent-misfile (REGRESSION — must be 0): ${newSilent}`);
  console.log(`fixed silent-misfile: ${fixedSilent}`);
  console.log(`NEW false-hold (review-volume cost): ${newFalseHold}`);
  console.log(`fixed false-hold: ${fixedFalseHold}`);
  console.log(`type now CORRECT (was wrong): ${typeFixed}`);
  console.log(`type now WRONG (was correct — REGRESSION): ${typeBroke}`);
  console.log(`\n${moved.length} docs changed class:`);
  for (const m of moved) {
    const b = m.b || {};
    console.log(`- #${m.id} ${b.supplier || (m.a && m.a.supplier) || '—'}: ${m.x} → ${m.y}  (gt=${b.gt || (m.a && m.a.gt)} got ${(m.a && m.a.got)}→${b.got})`);
  }
}
