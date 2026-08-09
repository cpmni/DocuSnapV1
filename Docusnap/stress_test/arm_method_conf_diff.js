#!/usr/bin/env node
/**
 * arm_method_conf_diff.js — ORACLE C6 GATE (2026-08-09).
 *
 * WHY THIS EXISTS. Every money gate run so far diffed VALUES. That is blind to the case Oracle
 * named: the same value arriving by a different RUNG, at a different CONFIDENCE, and therefore
 * with a different auto-file decision. A value-only diff reports "byte-identical" while the
 * document silently moves from Review to auto-filed. This script diffs METHOD and CONFIDENCE.
 *
 * It consumes the arm JSONs that `teach_run_ab.js` already writes (they carry `.fields[k].m`
 * and `.fields[k].c` per field — no harness change was needed), so it is READ-ONLY and costs
 * nothing beyond the two arms you already ran.
 *
 *   node stress_test/arm_method_conf_diff.js <baseline.json> <armed.json> [--field total_amount]
 *
 * Legs, matching Oracle's C6 wording:
 *   (a) same value / different method     — provenance moved
 *   (b) same value / different confidence — and whether it CROSSED the auto-file floor
 *   (c) registration census: `template_registration%` armed vs baseline, expected delta 0.
 *       The drift branch `return relocated` skips `_abs_edge_guard`, so if the row-pitch flag
 *       pushes money onto the registration rung instead, that is the seam showing up as a number.
 *
 * HONEST LIMIT — state it whenever you quote this script. `eligible` here is the FIELD-LEVEL
 * input to the auto-file decision (confidence >= 88 with no validation_note), NOT the decision
 * itself. The real gate is database/modules/trust.js (isAutoFileEligible / docTrustGate), which
 * also weighs supplier graduation, document type and the flag set. A field crossing the floor is
 * necessary, not sufficient. Do not report "N documents changed auto-file state" from this alone.
 */
'use strict';
const fs = require('fs');

const AUTOFILE_FLOOR = 88;          // trust.js passes conf == 88 BY DESIGN; only c < 88 blocks.

function load(p) {
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const by = new Map();
  for (const r of rows) by.set(r.original_filename, r);
  return by;
}

// The field-level precondition for auto-file. A note is a hard block regardless of confidence.
const eligible = f => f && f.c != null && f.c >= AUTOFILE_FLOOR && !f.note;
const norm = v => (v == null ? null : String(v).trim());
const rung = m => (m == null ? '(none)' : String(m));

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--field');
  const only = fi >= 0 ? args[fi + 1] : null;
  // skip both the flag AND its value — otherwise the value reads as a third positional file
  const files = args.filter((a, i) => !a.startsWith('--') && !(fi >= 0 && i === fi + 1));
  if (files.length !== 2) {
    console.error('usage: arm_method_conf_diff.js <baseline.json> <armed.json> [--field <key>]');
    process.exit(1);
  }
  const [A, B] = files.map(load);

  const stat = {};                  // per field key
  const S = k => (stat[k] ||= {
    docs: 0, valueChanged: 0, methodOnly: 0, confOnly: 0, methodAndConf: 0,
    eligGained: 0, eligLost: 0, appeared: 0, vanished: 0,
    regBase: 0, regArmed: 0, methodPairs: new Map(),
  });
  const detail = { methodOnly: [], confOnly: [], eligFlip: [], valueChanged: [] };

  for (const [fn, ra] of A) {
    const rb = B.get(fn);
    if (!rb) continue;
    const keys = new Set([...Object.keys(ra.fields || {}), ...Object.keys(rb.fields || {})]);
    for (const k of keys) {
      if (only && k !== only) continue;
      const fa = (ra.fields || {})[k];
      const fb = (rb.fields || {})[k];
      const s = S(k);
      s.docs++;
      if (fa && /^template_registration/.test(rung(fa.m))) s.regBase++;
      if (fb && /^template_registration/.test(rung(fb.m))) s.regArmed++;

      if (!fa && !fb) continue;
      if (!fa && fb) { s.appeared++; continue; }
      if (fa && !fb) { s.vanished++; continue; }

      const va = norm(fa.v), vb = norm(fb.v);
      if (va !== vb) {
        s.valueChanged++;
        detail.valueChanged.push({ fn, k, from: va, to: vb, mFrom: rung(fa.m), mTo: rung(fb.m), cFrom: fa.c, cTo: fb.c });
        continue;                   // a changed value is the OTHER gate's business, not this one's
      }

      // ---- same value from here down: this is exactly what a value-only diff cannot see ----
      const mChanged = rung(fa.m) !== rung(fb.m);
      const cChanged = (fa.c ?? null) !== (fb.c ?? null);
      if (mChanged && cChanged) s.methodAndConf++;
      else if (mChanged) s.methodOnly++;
      else if (cChanged) s.confOnly++;
      if (mChanged) {
        s.methodPairs.set(`${rung(fa.m)} -> ${rung(fb.m)}`,
          (s.methodPairs.get(`${rung(fa.m)} -> ${rung(fb.m)}`) || 0) + 1);
        detail.methodOnly.push({ fn, k, v: va, mFrom: rung(fa.m), mTo: rung(fb.m), cFrom: fa.c, cTo: fb.c });
      } else if (cChanged) {
        detail.confOnly.push({ fn, k, v: va, m: rung(fa.m), cFrom: fa.c, cTo: fb.c });
      }

      const ea = eligible(fa), eb = eligible(fb);
      if (ea !== eb) {
        if (eb) s.eligGained++; else s.eligLost++;
        detail.eligFlip.push({ fn, k, v: va, dir: eb ? 'GAINED' : 'LOST',
          cFrom: fa.c, cTo: fb.c, noteFrom: fa.note || null, noteTo: fb.note || null,
          mFrom: rung(fa.m), mTo: rung(fb.m) });
      }
    }
  }

  const keys = Object.keys(stat).sort();
  console.log(`\nC6 METHOD/CONFIDENCE DIFF   baseline=${files[0]}   armed=${files[1]}`);
  console.log(`documents compared: ${[...A.keys()].filter(f => B.has(f)).length}` +
              (only ? `   (field filter: ${only})` : ''));
  console.log('\nSAME VALUE, DIFFERENT PROVENANCE  (invisible to a value-only diff)');
  console.log('field                     n   val≠  meth  conf  m+c  elig+  elig-  reg(base→armed)');
  let anyReg = false, anyMove = false, anyElig = false;
  for (const k of keys) {
    const s = stat[k];
    if (s.regBase !== s.regArmed) anyReg = true;
    if (s.methodOnly || s.confOnly || s.methodAndConf) anyMove = true;
    if (s.eligGained || s.eligLost) anyElig = true;
    console.log(
      k.padEnd(24) +
      String(s.docs).padStart(5) + String(s.valueChanged).padStart(6) +
      String(s.methodOnly).padStart(6) + String(s.confOnly).padStart(6) +
      String(s.methodAndConf).padStart(5) +
      String(s.eligGained).padStart(7) + String(s.eligLost).padStart(7) +
      `   ${s.regBase} → ${s.regArmed}`);
  }

  console.log('\n(c) REGISTRATION-RUNG CENSUS — Oracle expects delta 0.');
  console.log(anyReg
    ? '    *** DELTA IS NON-ZERO — money moved onto the rung that adopts on geometry alone. ***'
    : '    OK: no field changed its template_registration% count.');

  const dump = (title, rows, fmt) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length})`);
    for (const r of rows.slice(0, 60)) console.log('    ' + fmt(r));
    if (rows.length > 60) console.log(`    … ${rows.length - 60} more`);
  };
  dump('SAME VALUE, METHOD CHANGED', detail.methodOnly,
    r => `${r.fn}  ${r.k}='${r.v}'  ${r.mFrom} -> ${r.mTo}  conf ${r.cFrom} -> ${r.cTo}`);
  dump('SAME VALUE, CONFIDENCE CHANGED', detail.confOnly,
    r => `${r.fn}  ${r.k}='${r.v}'  ${r.m}  conf ${r.cFrom} -> ${r.cTo}`);
  dump('AUTO-FILE ELIGIBILITY FLIPPED (field-level proxy — see header)', detail.eligFlip,
    r => `${r.dir}  ${r.fn}  ${r.k}='${r.v}'  conf ${r.cFrom} -> ${r.cTo}  note ${r.noteFrom} -> ${r.noteTo}  ${r.mFrom} -> ${r.mTo}`);
  dump('VALUE CHANGED (for reference — score_teach_run.py is the authority on right/wrong)',
    detail.valueChanged,
    r => `${r.fn}  ${r.k}  '${r.from}' -> '${r.to}'  ${r.mFrom} -> ${r.mTo}  conf ${r.cFrom} -> ${r.cTo}`);

  console.log('\nVERDICT INPUTS (not a verdict — read them with the score table):');
  console.log(`    same-value provenance moves : ${anyMove ? 'PRESENT' : 'none'}`);
  console.log(`    registration-rung delta     : ${anyReg ? 'NON-ZERO (investigate)' : 'zero'}`);
  console.log(`    field-level eligibility flip: ${anyElig ? 'PRESENT' : 'none'}`);
  console.log('    Reminder: eligibility here is the FIELD input to trust.js, not the decision.\n');
}

main();
