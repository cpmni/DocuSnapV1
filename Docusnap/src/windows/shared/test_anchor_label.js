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
// A BIG banner heading ("PURCHASE ORDER") shares the OCR row with a normal-sized caption ("Order
// No.") near the value. The heading's tall boxes inflate the GLOBAL median, so a global threshold
// swallowed the real column gap and glued the heading onto the caption ("the label grabs the whole
// line" — the PO-83175 report). The PER-GAP threshold (scaled to the right/caption word) must split it.
{
  const words = [
    { text: 'PURCHASE', box: [10,  0, 120, 60] },   // big banner heading, far left (tall boxes)
    { text: 'ORDER',    box: [140, 0, 100, 60] },
    { text: 'Order',    box: [300, 20, 45, 15] },   // normal caption near the value — wide gap before it
    { text: 'No.',      box: [350, 20, 25, 15] },
  ];
  const c = A.nearestLeftCluster(words);
  check('big banner heading does NOT glue onto the caption (per-gap threshold)', c && c.text === 'Order No.');
  check('banner heading dropped from the label', c && !/PURCHASE/.test(c.text));
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

// ── D1b: form-label WORD-RATIO tiebreak (2026-07-17) — a garble/non-label LEFT loses a SCORE-1 tie
// to a decisively-cleaner multi-word caption ABOVE. reggie-designed, Oracle SIGN-OFF-WITH-CONDITIONS.
check('labelWordRatio: "Rote," = 0 (not a form-label word)', A.labelWordRatio('Rote,') === 0);
check('labelWordRatio: "Site / Customer" = 1', A.labelWordRatio('Site / Customer') === 1);
check('labelWordRatio: "verial No." = 0.5', A.labelWordRatio('verial No.') === 0.5);
check('labelWordRatio: "Serial No." = 1', A.labelWordRatio('Serial No.') === 1);
check('labelWordRatio: dotted stem "S.O." = 1 (NOT split on ".")', A.labelWordRatio('S.O.') === 1);
check('labelWordRatio: empty = 0', A.labelWordRatio('') === 0);
// THE INCIDENT: garbled left "Rote," vs true caption "Site / Customer" above (both score 1) -> ABOVE
p = A.pickLabelCandidate('Rote,', 'Site / Customer', CUST);
check('INCIDENT: garble left "Rote," loses tie to real caption "Site / Customer" above',
      p.direction === 'above' && p.label === 'Site / Customer');
// clean-case CLIP: "verial No." (Serial misread) loses to the real "Serial No." above
p = A.pickLabelCandidate('verial No.', 'Serial No.', []);
check('clean-case clip left loses tie to the real caption above', p.direction === 'above');
// C2 GUARD: a LONE dictionary word above (1 vocab hit) does NOT override a real single-token abbrev left
p = A.pickLabelCandidate('EORI', 'Order', []);
check('C2: lone-word above does NOT override a non-vocab abbrev left', p.direction === 'left' && p.label === 'EORI');
// C1 PINNED MIS-STEER (ACCEPTED): a non-vocab abbrev left IS overridden by a strong >=2-word caption
// above — the operator's [<- Left] toggle corrects it. Pinned so a future dev SEES that not all
// abbreviations are protected (only the vocab stems po/so/ref/no/vat/id/serial are).
p = A.pickLabelCandidate('EORI', 'Order Details', []);
check('C1 (ACCEPTED mis-steer): non-vocab abbrev left flips to a 2-word caption above', p.direction === 'above');
p = A.pickLabelCandidate('SKU', 'Site / Customer', []);
check('C1 (ACCEPTED mis-steer): "SKU" left flips to "Site / Customer" above', p.direction === 'above');
// GARBLE ABOVE must NOT flip a good LEFT (the above side needs >=2 vocab words)
p = A.pickLabelCandidate('Delivery Address', 'Rote garble', []);
check('garble above does NOT flip a clean label left', p.direction === 'left' && p.label === 'Delivery Address');
// BALANCED TIE (regression pin, C4): equal-quality captions stay LEFT (status quo)
p = A.pickLabelCandidate('Ship To', 'Deliver To', []);
check('balanced 2-word tie stays LEFT (no spurious flip)', p.direction === 'left');
// KILL SWITCH: OFF -> tie is unconditional LEFT (byte-identical to pre-change)
A.setRatioTiebreak(false);
try {
  p = A.pickLabelCandidate('Rote,', 'Site / Customer', CUST);
  check('kill switch OFF: incident tie -> LEFT (byte-identical to pre-change)', p.direction === 'left');
} finally {
  A.setRatioTiebreak(true);   // restore (suite's monkeypatch-restore convention)
}

// ── deskewedNormToRaw — the ⊕ deskew back-transform, sign PINNED vs REAL PIL.rotate ──────
// The display-deskew straightens the on-screen page; a box drawn there is in the STRAIGHTENED
// frame, but extraction reads the RAW scan, so on save the anchor coords are rotated back. Get
// the sign wrong and every future taught anchor lands off — so these cases are GROUND TRUTH from
// a marker-pixel round-trip through real PIL.rotate (python_backend probe): place a marker at a
// known RAW pixel, PIL-rotate by `angle` (what the display does), read where the marker LANDS in
// the straightened image (the "drawn" point), and assert deskewedNormToRaw recovers the RAW pixel.
// The correct transform is R(+angle) about the centre; R(-angle) is pinned as WRONG here so a
// future "sign fix" can't silently invert it. Tolerance ~2px (PIL positions rounded to 0.1).
{
  // [W, H, drawnPxX, drawnPxY, angleDeg, rawPxX, rawPxY]  (drawn = PIL landing pos; raw = target)
  const CASES = [
    [400, 600, 287.0, 142.0,  5.0, 300, 150],
    [400, 600, 138.0, 506.0,  5.0, 120, 500],
    [400, 600, 310.0, 157.0, -4.0, 300, 150],
    [800, 500, 692.0,  84.3,  3.0, 700, 100],
  ];
  for (const [W, H, dx, dy, ang, rx, ry] of CASES) {
    const got = A.deskewedNormToRaw(dx / W, dy / H, ang, W, H);
    const ex = Math.abs(got.x * W - rx), ey = Math.abs(got.y * H - ry);
    check(`deskew back-transform recovers raw (W${W} a${ang}) — err ${ex.toFixed(2)},${ey.toFixed(2)}px`, ex < 2 && ey < 2);
    // The WRONG sign must NOT recover the raw point (guards against an inverted "fix").
    const bad = A.deskewedNormToRaw(dx / W, dy / H, -ang, W, H);
    check(`  ...and R(-angle) does NOT (sign is load-bearing)`, ang === 0 || Math.abs(bad.x * W - rx) > 3 || Math.abs(bad.y * H - ry) > 3);
  }
  // angle 0 / missing dims → identity (no-op when the page is already straight)
  const id = A.deskewedNormToRaw(0.4, 0.7, 0, 400, 600);
  check('deskew angle 0 → identity', id.x === 0.4 && id.y === 0.7);
}

// ── deskewFinalizeAnchor — the ⊕ deskew FRAME-CONSISTENCY fail-safe (Oracle C1) ──────────
// The back-transform is valid ONLY against the frame the box was drawn on. Between draw and commit
// there are OCR awaits; if the displayed frame changed, the staged coords belong to a different
// frame and MUST be dropped, never persisted as raw. Pins: keep when deskew uninvolved, transform
// when the frame is unchanged, and DROP on every frame-change mode. A green test that can't
// reproduce the drop would be worthless (Oracle), so each drop mode is exercised explicitly.
{
  const F = (over) => Object.assign({ angle: 5.0, docId: 7, page: 0, W: 400, H: 600 }, over || {});
  // drawn point (287,142) is raw (300,150) rotated +5° (matches the deskewedNormToRaw ground truth)
  const anchor = () => ({ x_norm: 287 / 400, y_norm: 142 / 600, offset_dx_norm: 0.05, offset_dy_norm: 0.02 });

  let r = A.deskewFinalizeAnchor(anchor(), F({ angle: 0 }), F({ angle: 0 }));
  check('deskew uninvolved → keep (byte-identical)', r.action === 'keep');

  r = A.deskewFinalizeAnchor(anchor(), F(), F());
  check('frame unchanged → transform', r.action === 'transform');
  check('  ...transformed x recovers raw (~300/400)', Math.abs(r.x * 400 - 300) < 2);
  check('  ...transformed y recovers raw (~150/600)', Math.abs(r.y * 600 - 150) < 2);
  check('  ...offset recomputed in raw frame', r.offset_dx != null && r.offset_dy != null);

  check('toggle-off mid-read → drop', A.deskewFinalizeAnchor(anchor(), F(), F({ angle: 0 })).action === 'drop');
  check('off→on mid-read → drop', A.deskewFinalizeAnchor(anchor(), F({ angle: 0 }), F()).action === 'drop');
  check('page changed → drop', A.deskewFinalizeAnchor(anchor(), F(), F({ page: 1 })).action === 'drop');
  check('doc changed → drop', A.deskewFinalizeAnchor(anchor(), F(), F({ docId: 9 })).action === 'drop');
  check('undecoded image (live W=0) → drop', A.deskewFinalizeAnchor(anchor(), F(), F({ W: 0 })).action === 'drop');
  check('dims changed → drop', A.deskewFinalizeAnchor(anchor(), F(), F({ H: 700 })).action === 'drop');
  check('no snapshot while deskew live → drop', A.deskewFinalizeAnchor(anchor(), null, F()).action === 'drop');

  r = A.deskewFinalizeAnchor({ x_norm: 0.5, y_norm: 0.5 }, F(), F());
  check('position-only anchor (no offset) → transform, no offset', r.action === 'transform' && r.offset_dx == null);
}

console.log(fails ? `\n${fails} FAILED` : '\nAll anchor-label checks passed');
process.exit(fails ? 1 : 0);
