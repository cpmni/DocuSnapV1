'use strict';
/*
 * test_segment_hold_predicate.js — the PURE half of the split-segment "look first" hold (2026-09-16;
 * gary → Oracle SIGN-OFF-W/COND C1-C10). Plain Node, no Electron/DB.
 *
 *   segmentHoldPages(rewrites)  → which produced segments need a human look: MULTI-page AND from a
 *                                  HEURISTIC split (a rewrite with separator sheets is exempt)
 *   segmentHoldNote / SEGMENT_HOLD_MARK → the sentence joins the "— confirm once." lane-hold family
 *                                  BYTE-EQUAL with handler._isLaneHoldNote, rereadHolds.CONFIRM_ONCE and
 *                                  composeNote._isLaneHold (Oracle C8)
 *   carrySegmentHold             → slice 2: a reprocess never sheds the hold (Oracle C1)
 *   composeNote                  → the mark is its OWN topic, never de-duped (Oracle C5)
 *   the splitter's naming contract in pdf_splitter.py (source pin)
 *
 * Run: node src/modules/processing/test_segment_hold_predicate.js
 */
const fs = require('fs');
const path = require('path');
const SP = require('./split_plan');
const { composeNote } = require('./composeNote');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('§1 segmentHoldPages — the population that needs a look');
{
  const rw = [
    { original: 'a.pdf', segments: ['a_split_p1.pdf', 'a_split_p2-3.pdf', 'a_split_p4.PDF', 'a_split_p5-9.pdf'], separators: 0 },
    { original: 'b.pdf', segments: ['b_split_p1-2.pdf', 'b_split_p3.pdf'], separators: 2 },        // sheet-bounded → exempt
    { original: 'c.pdf', segments: ['c_split_p1-3.pdf'], separators: 1 },                          // the single-output REWRITE → exempt
    { original: 'd.pdf', segments: ['d_split_p1-2.pdf'] },                                          // no separators key → heuristic
  ];
  const m = SP.segmentHoldPages(rw);
  check('a multi-page heuristic cut is selected with its page range', eq(m.get('a_split_p2-3.pdf'), { from: 2, to: 3 }) && eq(m.get('a_split_p5-9.pdf'), { from: 5, to: 9 }));
  check('a 1-page cut is NOT selected (it cannot contain a stranger page)', !m.has('a_split_p1.pdf') && !m.has('a_split_p4.PDF') && !m.has('b_split_p3.pdf'));
  check('every segment of a sheet-bounded rewrite is exempt (operator-declared boundaries)', !m.has('b_split_p1-2.pdf') && !m.has('c_split_p1-3.pdf'));
  check('a rewrite without the separators key counts as heuristic', m.has('d_split_p1-2.pdf'));
  check('null / [] / junk → empty map', SP.segmentHoldPages(null).size === 0 && SP.segmentHoldPages([]).size === 0 && SP.segmentHoldPages([null, {}]).size === 0);
  check('a non-splitter name is never selected even inside a rewrite', !SP.segmentHoldPages([{ original: 'x.pdf', segments: ['x-pages-2-3.pdf', 'x_split_pA-B.pdf'] }]).size);
}

console.log('\n§2 the note — one sentence, in the lane-hold family, byte-equal literals (Oracle C8)');
{
  const n = SP.segmentHoldNote(2, 3);
  check('carries the mark + the page range', n.includes(SP.SEGMENT_HOLD_MARK) && n.startsWith('Pages 2–3 '));
  check('ends with the family literal "— confirm once."', n.endsWith('— confirm once.'));
  check('segmentHoldRange parses it back', eq(SP.segmentHoldRange(n), { from: 2, to: 3 }) && SP.segmentHoldRange('no range here') === null);
  check('hasSegmentHold keys on the mark only', SP.hasSegmentHold(`prior note. ${n}`) && !SP.hasSegmentHold('Read differently after learning — confirm once.'));
  const H = read(path.join(__dirname, 'handler.js'));
  const RH = read(path.join(__dirname, 'rereadHolds.js'));
  const CN = read(path.join(__dirname, 'composeNote.js'));
  const lit = '— confirm once.';
  check("handler._isLaneHoldNote still keys on the identical literal", /function _isLaneHoldNote\(note\) \{\s*\n\s*const n = String\(note \|\| ''\);\s*\n\s*return n\.includes\('Read differently after learning'\) \|\| n\.includes\('— confirm once\.'\);/.test(H));
  check('rereadHolds.CONFIRM_ONCE is the identical literal', RH.includes(`const CONFIRM_ONCE = '${lit}';`));
  check('composeNote._isLaneHold keys on the identical literal', CN.includes(`n.includes('${lit}')`));
  check('U+2014 em dash in the family literal (not a hyphen)', lit.charCodeAt(0) === 0x2014 && n.includes(lit));
}

console.log('\n§3 the splitter naming contract (source pin — the regex reads THIS)');
{
  const PY = read(path.join(__dirname, '..', '..', '..', 'python_backend', 'pdf_splitter.py'));
  check('pdf_splitter names a multi-page segment p{a}-{b}', PY.includes('label = f"p{page_indices[0] + 1}-{page_indices[-1] + 1}"'));
  check('…and a 1-page segment p{a}', PY.includes('label = f"p{page_indices[0] + 1}"'));
  check('…as {stem}_split_{label}.pdf', PY.includes('out_name = f"{stem}_split_{label}.pdf"'));
  check('MULTI_PAGE_SEGMENT_RE matches exactly that shape', SP.MULTI_PAGE_SEGMENT_RE.test('doc_split_p23-24.pdf') && !SP.MULTI_PAGE_SEGMENT_RE.test('doc_split_p23.pdf'));
}

console.log('\n§4 carrySegmentHold — slice 2 (Oracle C1): a reprocess never sheds the hold');
{
  const sentence = SP.segmentHoldNote(2, 3);
  const existing = [{ field_key: 'invoice_number', display_value: 'INV-1', validation_note: sentence }, { field_key: 'invoice_date', display_value: '01-02-2026', validation_note: null }];
  const roles = { refKey: 'invoice_number', dateKey: 'invoice_date' };
  let merged = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: null }, { field_key: 'invoice_date', display_value: '01-02-2026', validation_note: null }];
  SP.carrySegmentHold(existing, merged, roles);
  check('a DIFFERENT fresh ref (used_new dropped the note) gets the sentence back on the ref-role row', merged[0].validation_note === sentence && !merged[1].validation_note);
  merged = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: 'one character differs — check which is printed' }, { field_key: 'invoice_date', display_value: 'x', validation_note: null }];
  SP.carrySegmentHold(existing, merged, roles);
  check('an existing fresh note is kept — the sentence is PREPENDED, nothing lost', merged[0].validation_note === `${sentence} one character differs — check which is printed`);
  merged = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: sentence }];
  const before = JSON.stringify(merged); SP.carrySegmentHold(existing, merged, roles);
  check('idempotent — a merged row already carrying the mark is untouched', JSON.stringify(merged) === before);
  merged = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: null }];
  const b2 = JSON.stringify(merged); SP.carrySegmentHold([{ field_key: 'invoice_number', display_value: 'INV-1', validation_note: null }], merged, roles);
  check('no-op when NO stored row carried the mark (byte-identical rows)', JSON.stringify(merged) === b2);
  merged = [{ field_key: 'total', display_value: '9.99', validation_note: null }];
  SP.carrySegmentHold(existing, merged, roles);
  check('no ref/date row in the merge → the first VALUED row carries it', merged[0].validation_note === sentence);
  merged = [{ field_key: 'total', display_value: '', validation_note: null }];
  SP.carrySegmentHold(existing, merged, roles);
  check('no valued row at all → a stub row on the ref key carries it (the C12 shape)', merged.length === 2 && merged[1].field_key === 'invoice_number' && merged[1].extraction_method === 'segment_hold' && merged[1].validation_note === sentence && merged[1].display_value === null);
}

console.log('\n§5 composeNote — the mark is its OWN topic (Oracle C5)');
{
  const hold = SP.segmentHoldNote(2, 3);
  const advisory = "this could read 'SO-61040' or '$O-61040' (S and $ look alike on a scan) — one character differs; showing 'SO-61040' — please check which is printed";
  check('hold + a genuine ref advisory → NOT collapsed (null → caller concats, both survive)', composeNote(hold, advisory) === null && composeNote(advisory, hold) === null);
  check('hold + a lane-hold "confirm once" note → NOT collapsed either', composeNote(hold, 'Read differently after learning — confirm once.') === null);
  check('the lane-hold family itself still de-dups as before', composeNote('Read differently after learning — confirm once.', advisory) === 'Read differently after learning — confirm once.');
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
