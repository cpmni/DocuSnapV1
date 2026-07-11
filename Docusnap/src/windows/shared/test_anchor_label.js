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

// ── nearestAboveRow — keep only the BOTTOM row (caption nearest the value) ──────
// A tall above-the-value strip catching TWO text rows: the caption "Site / Customer"
// on the bottom row and an unrelated line above it. Only the bottom row may win —
// gluing the rows back together was the old reason the strip was starved to one line
// (which then clipped captions to hallucinated slivers, the "eee F WS CwE ewe" bug).
{
  const words = [
    { text: 'Meridian', box: [0, 2, 60, 12] },    // upper row — must be dropped
    { text: 'Print',    box: [64, 2, 34, 12] },
    { text: 'Site',     box: [0, 22, 26, 12] },   // bottom row — the caption
    { text: '/',        box: [33, 21, 4, 14] },
    { text: 'Customer', box: [41, 22, 66, 12] },
  ];
  const r = A.nearestAboveRow(words);
  check('nearestAboveRow keeps the bottom row only', r && r.text === 'Site / Customer');
  check('nearestAboveRow drops the row above', r && !/Meridian/.test(r.text));
  check('nearestAboveRow box spans just the bottom row', r && r.box[1] === 21 && r.box[0] === 0 && (r.box[0] + r.box[2]) === 107);
}
// A single row comes back whole, words re-ordered left→right.
{
  const r = A.nearestAboveRow([
    { text: 'Customer', box: [41, 3, 66, 12] },
    { text: 'Site',     box: [0, 3, 26, 12] },
    { text: '/',        box: [33, 2, 4, 14] },
  ]);
  check('nearestAboveRow single row kept whole, left→right', r && r.text === 'Site / Customer');
}
// Slight y-jitter within one visual row (ascenders/descenders) must not split it.
{
  const r = A.nearestAboveRow([
    { text: 'Net',   box: [0, 5, 24, 11] },
    { text: 'Total', box: [28, 3, 36, 14] },   // 2px higher top, taller glyphs — same row
  ]);
  check('nearestAboveRow tolerates in-row y-jitter', r && r.text === 'Net Total');
}
check('nearestAboveRow([]) → null', A.nearestAboveRow([]) === null);
check('nearestAboveRow(null) → null', A.nearestAboveRow(null) === null);
check('nearestAboveRow ignores box-less words', A.nearestAboveRow([{ text: 'x' }]) === null);

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

// ── nearestRowTo — row nearest the value centre (the expanded LEFT strip, 2026-07-10) ────
// A 1.8×-tall left strip catches the caption row plus a neighbour row; only the row nearest
// the value's centre may feed the column pick (else the neighbour's rightmost word wins).
{
  const words = [
    { text: 'Date',     box: [500, 2, 40, 12] },    // row above (centre ~8)
    { text: 'SO',       box: [560, 22, 24, 13] },   // the caption row (centre ~28.5)
    { text: '#',        box: [590, 22, 10, 13] },
    { text: 'Account',  box: [500, 44, 60, 12] },   // row below (centre ~50)
  ];
  const r = A.nearestRowTo(words, 28);              // value centre in strip px
  check('nearestRowTo picks the caption row', r && r.map(w => w.text).join(' ') === 'SO #');
  const r2 = A.nearestRowTo(words, 6);
  check('nearestRowTo respects a different centre', r2 && r2[0].text === 'Date');
  check('nearestRowTo(null) → null', A.nearestRowTo(null, 10) === null);
  // composed with nearestLeftCluster: the caption row's rightmost column is the label
  const c = A.nearestLeftCluster(A.nearestRowTo(words, 28));
  check('row→column composition yields the caption', c && c.text === 'SO #');
}

// ── SHORT-CAPTION allowlist + '#' retention (reggie, 2026-07-10 — the "SO #" slice) ──────
// extractLabel: known short caption stems pass; OCR debris still dies.
check("extractLabel accepts 'SO'",   A.extractLabel('SO') === 'SO');
check("extractLabel accepts 'SO#' and un-glues it", A.extractLabel('SO#') === 'SO #');
check("extractLabel accepts 'S/O'",  A.extractLabel('S/O') === 'S/O');
check("extractLabel accepts 'Ref'",  A.extractLabel('Ref') === 'Ref');
check("extractLabel accepts 'No.'",  A.extractLabel('No.') === 'No.');
check("extractLabel accepts 'P.O.'", A.extractLabel('P.O.') === 'P.O.');
check("extractLabel still rejects 'sok' (the MP_sal_35 misread)", A.extractLabel('sok') === null);
check("extractLabel still rejects 'sox'", A.extractLabel('sox') === null);
check("extractLabel still rejects 'po4'", A.extractLabel('po4') === null);
check("extractLabel still rejects '$0'",  A.extractLabel('$0') === null);
// sanitizeAnchorLabel: a STANDALONE '#' survives (caption punctuation, the locate uniqueness);
// glued codes still drop; a letterless residue still collapses to ''.
check("sanitize keeps 'SO #' whole",      A.sanitizeAnchorLabel('SO #') === 'SO #');
check("sanitize keeps 'Item #' from 'Item # 123'", A.sanitizeAnchorLabel('Item # 123') === 'Item #');
check("sanitize still drops glued '#12345'", A.sanitizeAnchorLabel('SO #12345') === 'SO');
check("sanitize collapses letterless '# #' to empty", A.sanitizeAnchorLabel('# #') === '');
check("sanitize unchanged for plain captions", A.sanitizeAnchorLabel('Work Address') === 'Work Address');
check("sanitize unchanged for code-stripped captions",
      A.sanitizeAnchorLabel('2605-0769-1 Work Address') === 'Work Address');

// ── labelLooksSuspicious — garble guard ─────────────────────────────────────────
check('clean label not suspicious', A.labelLooksSuspicious('Serial No.') === false);
check('replacement-char label suspicious', A.labelLooksSuspicious('�escription') === true);
check('vowel-less garble suspicious', A.labelLooksSuspicious('brtnz') === true);
check('empty label suspicious', A.labelLooksSuspicious('') === true);
// case-chaos garble (the "Site / Customer" → "VUoWwriter" misread) must be caught
check('case-chaos garble suspicious', A.labelLooksSuspicious('VUoWwriter') === true);
check('case-chaos garble (spaced) suspicious', A.labelLooksSuspicious('VS VUoWwriter') === true);
check('ALLCAPS with misread lowercase suspicious', A.labelLooksSuspicious('INVOlCE') === true);
// real captions must NOT be flagged by the new rule (0 false-flags)
check('Site / Customer not suspicious', A.labelLooksSuspicious('Site / Customer') === false);
check('Account not suspicious', A.labelLooksSuspicious('Account') === false);
check('Net Total not suspicious', A.labelLooksSuspicious('Net Total') === false);
check('PO Number not suspicious', A.labelLooksSuspicious('PO Number') === false);
check('Work Address not suspicious', A.labelLooksSuspicious('Work Address') === false);
// documented accepted misses (clean-case clips) stay FALSE — operator corrects these
check('clean-case clip "verial" is an accepted miss', A.labelLooksSuspicious('verial No.') === false);

// ── D1: comma-orphan + pickLabelCandidate ───────────────────────────────────────
check('comma-orphan fragment suspicious ("esha, i")', A.labelLooksSuspicious('esha, i') === true);
check('comma-orphan no-space suspicious ("esha,i")', A.labelLooksSuspicious('esha,i') === true);
check('real comma caption NOT flagged ("Company, Inc")', A.labelLooksSuspicious('Company, Inc') === false);
check('two-letter tail after comma NOT comma-orphan ("Ref, No")', A.labelLooksSuspicious('Ref, No') === false);

const CUST = ['Customer', 'Bill To'];   // a customer field's own caption bank (field-scoped)
check('score 2 = matches THIS field caption', A.scoreLabelCandidate('Customer', CUST) === 2);
check('score 1 = clean non-matching label', A.scoreLabelCandidate('Ship To', CUST) === 1);
check('score 0 = suspicious label', A.scoreLabelCandidate('esha, i', CUST) === 0);
check('score 0 = empty', A.scoreLabelCandidate('', CUST) === 0);

let p = A.pickLabelCandidate('esha, i', 'Customer', CUST);
check('INCIDENT: above "Customer" beats garbled left "esha, i"', p.direction === 'above' && p.label === 'Customer');
p = A.pickLabelCandidate('Ship To', 'Deliver To', CUST);       // both score 1 -> tie
check('tie -> LEFT (status quo)', p.direction === 'left' && p.label === 'Ship To');
p = A.pickLabelCandidate('Customer', 'Customer', CUST);         // both score 2 -> tie
check('tie (both match) -> LEFT', p.direction === 'left');
p = A.pickLabelCandidate('esha, i', '�garble', CUST);
check('both suspicious -> position-only (empty label, no staged garble)', p.direction === null && p.label === '');
p = A.pickLabelCandidate('', '', CUST);
check('both empty -> position-only', p.direction === null && p.label === '');
p = A.pickLabelCandidate('', 'Bill To', CUST);
check('empty left, clean above -> above', p.direction === 'above' && p.label === 'Bill To');
p = A.pickLabelCandidate('Ship To', 'Customer', CUST);         // left 1, above 2
check('field-caption match (above) beats clean non-match (left)', p.direction === 'above');
p = A.pickLabelCandidate('Customer', 'Ship To', CUST);         // left 2, above 1
check('field-caption match (left) beats clean non-match (above)', p.direction === 'left');

console.log(fails ? `\n${fails} FAILED` : '\nAll anchor-label checks passed');
process.exit(fails ? 1 : 0);
