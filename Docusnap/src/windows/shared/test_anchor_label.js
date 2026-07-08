'use strict';
// Guards src/windows/shared/anchorLabel.js — the shared label-quality helpers used by BOTH the
// Review ⊕ tool and the Teach wizard (so the teach wizard's label detection can't regress to the
// old "grab the whole left band" behaviour that made the label span left).
//   node src/windows/shared/test_anchor_label.js
global.window = global;                 // the module attaches to `window`
const A = require('./anchorLabel');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── nearestLeftCluster — keep only the column NEAREST the value ─────────────────
// A wide two-column row: "Ticket No." far left, "Work Address" nearer the value. A big x-gap
// separates the columns; the nearest (rightmost) block must win, NOT both glued together.
{
  const words = [
    { text: 'Ticket',  box: [10, 0, 40, 12] },
    { text: 'No.',     box: [52, 0, 20, 12] },
    { text: 'Work',    box: [400, 0, 40, 12] },   // far right — a wide gap before this
    { text: 'Address', box: [442, 0, 60, 12] },
  ];
  const c = A.nearestLeftCluster(words);
  check('nearestLeftCluster keeps the nearest column only', c && c.text === 'Work Address');
  check('nearestLeftCluster drops the far-left caption', c && !/Ticket/.test(c.text));
  check('nearestLeftCluster box spans just the nearest block', c && c.box[0] === 400 && (c.box[0] + c.box[2]) === 502);
}
// One caption (small inter-word gaps only) stays whole.
{
  const c = A.nearestLeftCluster([
    { text: 'Invoice', box: [10, 0, 50, 12] },
    { text: 'Number',  box: [64, 0, 55, 12] },
  ]);
  check('single caption is kept whole', c && c.text === 'Invoice Number');
}
check('nearestLeftCluster([]) → null', A.nearestLeftCluster([]) === null);
check('nearestLeftCluster(null) → null', A.nearestLeftCluster(null) === null);

// ── sanitizeAnchorLabel — strip value-shaped tokens ─────────────────────────────
check('keeps a real caption', A.sanitizeAnchorLabel('Invoice Number') === 'Invoice Number');
check('drops a bare number token', A.sanitizeAnchorLabel('Total 12345') === 'Total');
check('drops a code-like serial (≥3 digits), keeps the caption', A.sanitizeAnchorLabel('SO2 1102V03') === 'SO2');
check('drops a date token', A.sanitizeAnchorLabel('Date 03-08-2012') === 'Date');
check('empty in → empty out', A.sanitizeAnchorLabel('') === '' && A.sanitizeAnchorLabel(null) === '');

// ── extractLabel — nearest (tail) words ─────────────────────────────────────────
check('extractLabel returns a short caption whole', A.extractLabel('some noise   Serial No.') === 'some noise Serial No.');
check('extractLabel keeps the last 40 chars of a long strip', A.extractLabel('x'.repeat(50) + ' Serial No.').length <= 40 && /Serial No\.$/.test(A.extractLabel('x'.repeat(50) + ' Serial No.')));
check('extractLabel rejects a too-short/no-alpha tail', A.extractLabel('  12  ') === null);

// ── labelLooksSuspicious — garble guard ─────────────────────────────────────────
check('clean label not suspicious', A.labelLooksSuspicious('Serial No.') === false);
check('replacement-char label suspicious', A.labelLooksSuspicious('�escription') === true);
check('vowel-less garble suspicious', A.labelLooksSuspicious('brtnz') === true);
check('empty label suspicious', A.labelLooksSuspicious('') === true);

console.log(fails ? `\n${fails} FAILED` : '\nAll anchor-label checks passed');
process.exit(fails ? 1 : 0);
