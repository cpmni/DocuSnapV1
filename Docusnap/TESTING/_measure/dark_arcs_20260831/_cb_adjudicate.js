'use strict';
// Adjudication diff for the realdoc-605 arms (Oracle C6 for cell-below, C3 for money-sign).
// Usage: node _cb_adjudicate.js <off_consensus.jsonl> <on_consensus.jsonl> [moneysign]
//  - every previously-NON-EMPTY field must be byte-identical INCLUDING confidence
//  - diffs must be strictly empty -> filled (cell-below) / sign-gains on marked amounts (moneysign)
//  - would-file changes + note/corroboration-bearing diffs enumerated for human adjudication
//  - moneysign mode additionally checks ALL currency-role fields and flags sign-gains on
//    non-credit types that carry no note (must be zero)
const fs = require('fs');
const [offP, onP, mode] = process.argv.slice(2);
const MS = mode === 'moneysign';

function load(p) {
  const m = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(l);
    m[o.id] = o;
  }
  return m;
}
const off = load(offP), on = load(onP);

let changedNonEmpty = 0, fills = 0, signGains = 0, signGainNoNoteNonCredit = 0, wfChanges = 0;
const rows = [];
const CURRENCYISH = /total|subtotal|tax|vat|amount|discount|balance/i;

for (const id of Object.keys(off)) {
  const a = off[id], b = on[id];
  if (!b) continue;
  // fields = {key: [value, conf, method, note]}
  const fa = a.fields || {}, fb = b.fields || {};
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  for (const k of keys) {
    const ra = fa[k] || [], rb = fb[k] || [];
    const va = { value: ra[0], confidence: ra[1], method: ra[2], validation_note: ra[3] };
    const vb = { value: rb[0], confidence: rb[1], method: rb[2], validation_note: rb[3] };
    const sa = (va.value == null ? '' : String(va.value)), sb = (vb.value == null ? '' : String(vb.value));
    const ca = va.confidence, cb = vb.confidence;
    if (sa === sb && ca === cb) continue;
    const wasEmpty = sa.trim() === '';
    const nowEmpty = sb.trim() === '';
    const signGain = !wasEmpty && !nowEmpty && sb.replace(/^-/, '') === sa.replace(/^[£$€¥]?/, '').replace(/^-/, '')
      && sb.startsWith('-') && !sa.startsWith('-');
    if (wasEmpty && !nowEmpty) { fills++; rows.push(`FILL  doc ${id} ${k}: '' -> '${sb}' @${cb}`); continue; }
    if (signGain) {
      signGains++;
      const note = String(vb.validation_note || '').trim();
      const typ = String(b.document_type || b.type || '').toLowerCase();
      const credit = /credit/.test(typ);
      if (!credit && !note) { signGainNoNoteNonCredit++; rows.push(`SIGN-NO-NOTE doc ${id} (${typ}) ${k}: '${sa}' -> '${sb}'`); }
      else rows.push(`SIGN  doc ${id} (${typ}) ${k}: '${sa}' -> '${sb}'${note ? ' [noted]' : ''}`);
      continue;
    }
    changedNonEmpty++;
    rows.push(`CHANGED doc ${id} ${k}: '${sa}'@${ca} -> '${sb}'@${cb}${MS && CURRENCYISH.test(k) ? ' [currency-role]' : ''}`);
  }
  const wa = a.would_file != null ? a.would_file : a.wouldFile;
  const wb = b.would_file != null ? b.would_file : b.wouldFile;
  if (wa !== wb) { wfChanges++; rows.push(`WOULD-FILE doc ${id}: ${wa} -> ${wb}`); }
}

console.log(`docs compared: ${Object.keys(off).length}`);
console.log(`previously-non-empty CHANGED (must be 0${MS ? ' outside sign-gains' : ''}): ${changedNonEmpty}`);
console.log(`empty->filled: ${fills}`);
if (MS) {
  console.log(`sign-gains: ${signGains}  | sign-gains on NON-credit with NO note (must be 0): ${signGainNoNoteNonCredit}`);
}
console.log(`would-file changes (adjudicate each): ${wfChanges}`);
console.log('');
for (const r of rows.slice(0, 80)) console.log(r);
if (rows.length > 80) console.log(`… and ${rows.length - 80} more`);
