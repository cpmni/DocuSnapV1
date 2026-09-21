'use strict';
/*
 * test_segment_pair_hold.js — the PURE half of the segment PAIR hold (2026-09-17; gary → Oracle SIGN-OFF-W/COND
 * C1-C12; DARK mig 180 `segment_pair_hold`). Plain Node, no Electron/DB.
 *
 * The S4 silent truncation: a 2-page document whose page 2 repeats the letterhead with no page marker is cut at page 2
 * on the strength of the letterhead alone; on a manual import page 1 auto-files as a complete 1-page document and page
 * 2 orphans (caught live 2026-09-17, e2e3 #1255). The pre-pass classifies each cut WEAK (template-only, no doc-start)
 * or STRONG; the handler compares the two halves of every WEAK cut once both are read and holds BOTH with a durable
 * "— confirm once." note when they read as ONE document.
 *
 *   weakPagesOf / weakSegmentIdx / weakSegmentNames  → the detector's `weak_pages` → segment indices → basenames
 *   buildPairContext(rewrites)                        → the pair population (heuristic rewrites only; the rewrite set is
 *                                                       the trigger, never the filename)
 *   pairSentences / SEGMENT_PAIR_MARK / kind / range   → per-pair sentences in the lane-hold family, DISJOINT from the
 *                                                       mig-176 mark
 *   pairHoldDecision(pred, succ)                       → 'hold' | 'release' | 'inconclusive' (Oracle C6 normalisation)
 *   clearPairSentence / carrySegmentHold (C5)          → exact-sentence clear; every mark-bearing sentence carried
 *   composeNote                                        → the pair mark is its OWN topic (the Oracle's C5 twin)
 *
 * Run: node src/modules/processing/test_segment_pair_hold.js
 */
const fs = require('fs');
const path = require('path');
const SP = require('./split_plan');
const { composeNote } = require('./composeNote');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('§1 the class travels: weak_pages → weakIdx → weak basenames');
{
  check('weakPagesOf: validated ints only; missing key → []', eq(SP.weakPagesOf({ weak_pages: [1, 'x', -1, 3.5, 2] }), [1, 2]) && eq(SP.weakPagesOf({}), []) && eq(SP.weakPagesOf(null), []));
  check('weakSegmentIdx: the k whose START page is weak (multi-page segments included)', eq(SP.weakSegmentIdx([[0, 0], [1, 2], [3, 3]], [1, 3]), [1, 2]) && eq(SP.weakSegmentIdx([[0, 0], [1, 1]], []), []));
  const p = SP.buildSplitPlan({ success: true, segments: [[0, 0], [1, 1], [2, 3]], weak_pages: [1] });
  check("buildSplitPlan carries weakIdx on a 'split' plan (today's fields untouched)", p.action === 'split' && p.minFiles === 2 && p.ranges === '1,2,3-4' && eq(p.weakIdx, [1]));
  check('…and an older detector without the key → weakIdx []', eq(SP.buildSplitPlan({ success: true, segments: [[0, 0], [1, 1]] }).weakIdx, []));
  check('weakSegmentNames maps plan indices onto the splitter outputs in order', eq(SP.weakSegmentNames(p, ['s_split_p1.pdf', 's_split_p2.pdf', 's_split_p3-4.pdf']), ['s_split_p2.pdf']) && eq(SP.weakSegmentNames({}, ['a']), []));
}

console.log('\n§2 buildPairContext — the pair population');
{
  const ctx = SP.buildPairContext([
    { original: 'a.pdf', segments: ['a_split_p1.pdf', 'a_split_p2.pdf', 'a_split_p3.pdf', 'a_split_p4-5.pdf'], separators: 0, weak: ['a_split_p2.pdf', 'a_split_p3.pdf', 'a_split_p4-5.pdf'] },
    { original: 'b.pdf', segments: ['b_split_p1.pdf', 'b_split_p2.pdf'], separators: 1 },                                 // PURE sheet-bounded (no weak) → exempt
    { original: 'c.pdf', segments: ['c_split_p1.pdf', 'c_split_p2.pdf'], separators: 0, weak: ['c_split_p1.pdf'] },     // k = 0 is never a pair
    { original: 'd.pdf', segments: ['d_split_p1.pdf', 'd_split_p2.pdf'], separators: 0 },                                // no weak key → none
    { original: 'e.pdf', segments: ['e-pages-1.pdf', 'e-pages-2.pdf'], separators: 0, weak: ['e-pages-2.pdf'] },          // non-splitter names → none
    // COMPOSED rewrite (opt-in-split slice 1b): a page-1 sheet (separators > 0) AND an internal heuristic sub-cut.
    // The `weak` set names ONLY the heuristic sub-cut, so it IS paired despite the sheet (the mixed-exemption seam).
    { original: 'f.pdf', segments: ['f_split_p1.pdf', 'f_split_p2.pdf'], separators: 1, weak: ['f_split_p2.pdf'] },
  ]);
  check('every weak segment k ≥ 1 of a heuristic rewrite pairs with k−1 (incl. a multi-page successor) + the composed sub-cut', ctx.pairs.length === 4
    && eq(ctx.pairs.map(q => [q.pred, q.succ]), [['a_split_p1.pdf', 'a_split_p2.pdf'], ['a_split_p2.pdf', 'a_split_p3.pdf'], ['a_split_p3.pdf', 'a_split_p4-5.pdf'], ['f_split_p1.pdf', 'f_split_p2.pdf']]), JSON.stringify(ctx.pairs));
  check('page ranges parsed from the splitter names (1-page and multi-page)', eq(ctx.pairs[2].succPages, { from: 4, to: 5 }) && eq(ctx.pairs[0].predPages, { from: 1, to: 1 }));
  check('a MIDDLE segment belongs to two pairs (p2: succ of (1,2) AND pred of (2,3)) — Oracle C3', (ctx.byName.get('a_split_p2.pdf') || []).length === 2 && (ctx.byName.get('a_split_p1.pdf') || []).length === 1);
  check('PURE sheet-bounded (no weak), k = 0, no weak key, non-splitter names → no pairs', !ctx.byName.has('b_split_p2.pdf') && !ctx.byName.has('c_split_p1.pdf') && !ctx.byName.has('d_split_p2.pdf') && !ctx.byName.has('e-pages-2.pdf'));
  check('COMPOSED rewrite (slice 1b): a sheet-bounded file with an internal heuristic sub-cut IS paired (weak selects it)', (ctx.byName.get('f_split_p2.pdf') || []).length === 1);
  check('null / [] / junk → an empty context with a landed map', SP.buildPairContext(null).pairs.length === 0 && SP.buildPairContext([null, {}]).byName.size === 0 && SP.buildPairContext([]).landed instanceof Map);
}

console.log('\n§3 the sentences — per pair, in the lane-hold family, DISJOINT from the mig-176 mark');
{
  const pair = SP.buildPairContext([{ original: 's.pdf', segments: ['s_split_p1.pdf', 's_split_p2.pdf'], separators: 0, weak: ['s_split_p2.pdf'] }]).pairs[0];
  const s = SP.pairSentences(pair);
  check('both sentences end with the family literal "— confirm once."', s.pred.endsWith('— confirm once.') && s.succ.endsWith('— confirm once.'));
  check('both carry the pair mark and NEITHER carries the mig-176 mark', SP.hasPairSegmentHold(s.pred) && SP.hasPairSegmentHold(s.succ) && !SP.hasMergedSegmentHold(s.pred) && !SP.hasMergedSegmentHold(s.succ));
  check('the predecessor names the NEXT page, the successor the PREVIOUS page', s.pred.includes('the next page (2)') && s.succ.includes('the previous page (1)') && SP.pairPartnerPage(s.pred) === 2 && SP.pairPartnerPage(s.succ) === 1);
  check('both say where the original scan is kept; neither says "use Split" (Oracle C7)', s.pred.includes('.sf_separated_originals') && s.succ.includes('.sf_separated_originals') && !/Split/.test(s.pred) && !/Split/.test(s.succ));
  check('the two sentences of one pair DIFFER (exact-sentence stamping / clearing needs that)', s.pred !== s.succ);
  const multi = SP.pairSentences(SP.buildPairContext([{ original: 's.pdf', segments: ['s_split_p1.pdf', 's_split_p2-3.pdf'], separators: 0, weak: ['s_split_p2-3.pdf'] }]).pairs[0]);
  check('a multi-page successor reads "Pages 2–3 … on their own; they may continue the previous page (1)"', multi.succ.startsWith('Pages 2–3 ') && multi.succ.includes('on their own; they may continue the previous page (1)'));
  check('hasSegmentHold is EITHER family; segmentHoldKind tells them apart; a row with both reports merged', SP.hasSegmentHold(s.pred) && SP.hasSegmentHold(SP.segmentHoldNote(2, 3))
    && SP.segmentHoldKind(s.pred) === 'pair' && SP.segmentHoldKind(SP.segmentHoldNote(2, 3)) === 'merged' && SP.segmentHoldKind(`${s.succ} ${SP.segmentHoldNote(2, 3)}`) === 'merged' && SP.segmentHoldKind('plain note') === null);
  check('segmentHoldRange parses "Page 2 " → {2,2} and still "Pages 2–3 " → {2,3}; no range → null', eq(SP.segmentHoldRange(s.succ), { from: 2, to: 2 }) && eq(SP.segmentHoldRange(SP.segmentHoldNote(2, 3)), { from: 2, to: 3 }) && SP.segmentHoldRange('nothing') === null);
  check('the mig-176 sentence is byte-identical to before (no regression of the other family)', SP.segmentHoldNote(2, 3) === 'Pages 2–3 were cut from a multi-document scan; check every page belongs to this document (if one doesn\'t, use Split) — confirm once.');
}

console.log('\n§4 pairHoldDecision — the value check (Oracle C6)');
{
  const D = SP.pairHoldDecision;
  const CP = 'Copperfield Electrical';
  check('exhibit (orphan arm): same supplier, no ref, no date → hold', D({ supplier: 'Thornbury Fasteners', ref: 'INV-71940', date: '08-03-2026' }, { supplier: 'Thornbury Fasteners', ref: '', date: null }) === 'hold');
  check('exhibit (same-document arm): same supplier, the SAME ref, no date → hold', D({ supplier: CP, ref: 'INV-29597', date: '23-11-2026' }, { supplier: CP, ref: 'INV-29597', date: '' }) === 'hold');
  check('a complete later page (its own ref + a date) → release', D({ supplier: CP, ref: 'PO-46491', date: '03-07-2026' }, { supplier: CP, ref: 'PO-53795', date: '24-03-2026' }) === 'release');
  check('the same-supplier sibling switch with its own ref + date (tb_04 p7 shape) → release', D({ supplier: 'Thornbury Fasteners', ref: 'INV-34487', date: '14-10-2026' }, { supplier: 'Thornbury Fasteners Ltd', ref: 'WS-68687', date: '23-11-2026' }) === 'release');
  check('PIN (accepted trade): the same ref AND the same date (an adjacent duplicate scan) → hold — one look, never a silent -DUPLICATE', D({ supplier: 'Print Tracker Doc', ref: '1984800049', date: '29-08-2026' }, { supplier: 'Print Tracker Doc', ref: '1984800049', date: '29-08-2026' }) === 'hold');
  check('PIN: the same ref with a DIFFERENT date (the p9/p10 alert shape) → release', D({ supplier: 'Print Tracker Doc', ref: 'RFC9508317', date: '11-09-2026' }, { supplier: 'Print Tracker Doc', ref: 'RFC9508317', date: '21-09-2026' }) === 'release');
  check('a later page with a DIFFERENT date of its own but no ref → release (a first page whose number failed to read)', D({ supplier: CP, ref: 'INV-1', date: '01-01-2026' }, { supplier: CP, ref: '', date: '02-01-2026' }) === 'release');
  check('C6b (i): a later page with NO ref and the SAME date as the earlier page (a repeated header, garbled number) → inconclusive (hold both)', D({ supplier: CP, ref: 'INV-1', date: '01-01-2026' }, { supplier: CP, ref: '', date: '01-01-2026' }) === 'inconclusive');
  check('C6b (ii): a later page with a DIFFERENT number but NO date → inconclusive (a continuation cannot show a date of its own; a first page would)', D({ supplier: CP, ref: 'INV-1', date: '01-01-2026' }, { supplier: CP, ref: 'INV-2', date: '' }) === 'inconclusive');
  check('C6b: no number, a date, but the EARLIER date unread → inconclusive (no positive evidence either way)', D({ supplier: CP, ref: 'INV-1', date: '' }, { supplier: CP, ref: '', date: '02-01-2026' }) === 'inconclusive');
  check('a blank supplier on EITHER side → inconclusive (the caller holds both)', D({ supplier: '', ref: 'INV-1', date: '01-01-2026' }, { supplier: CP, ref: '', date: '' }) === 'inconclusive' && D({ supplier: CP, ref: 'INV-1', date: '' }, { supplier: null, ref: '', date: '' }) === 'inconclusive');
  check('different suppliers → release, whatever the values', D({ supplier: CP, ref: 'INV-1', date: '' }, { supplier: 'Thornbury Fasteners', ref: '', date: '' }) === 'release');
  check('supplier tolerance: a legal suffix / a token-prefix extension is the SAME supplier (segmentation.same_supplier twin)', SP.sameSupplier('Copperfield Electrical Ltd', 'copperfield electrical') && SP.sameSupplier('Print Tracker', 'Print Tracker Services') && !SP.sameSupplier('Copperfield Electrical', 'Copperfield Plumbing') && !SP.sameSupplier('', 'x'));
  check('ref normalisation: case / separators / spaces fold', SP.normRef('inv - 29597') === SP.normRef('INV-29597') && SP.normRef(null) === '');
  check('PIN (C6): a digit-confusable slip on the repeated number still HOLDS (O↔0, I/l↔1, S↔5, B↔8, Z↔2 — hold direction only)', D({ supplier: CP, ref: 'INV-29590', date: '01-01-2026' }, { supplier: CP, ref: 'INV-2959O', date: '' }) === 'hold'
    && D({ supplier: CP, ref: 'INV-29591', date: '01-01-2026' }, { supplier: CP, ref: 'INV-2959l', date: '' }) === 'hold' && D({ supplier: CP, ref: 'SO-55', date: '' }, { supplier: CP, ref: '5O-S5', date: '' }) === 'hold');
  check('PIN: a genuinely different (consecutive) number WITH its own date → release (the fold never turns a real neighbour into a hold)', D({ supplier: CP, ref: 'INV-29597', date: '01-01-2026' }, { supplier: CP, ref: 'INV-29598', date: '02-01-2026' }) === 'release');
  check('dates via the ONE parser: 25/12/2026 ≡ 25-12-2026 ≡ 25 Dec 2026 (same ref + same date → hold)', D({ supplier: CP, ref: 'PO-1', date: '25/12/2026' }, { supplier: CP, ref: 'PO-1', date: '25-12-2026' }) === 'hold' && SP.normDate('25 Dec 2026') === '25-12-2026' && SP.normDate('31/04/2026') === '' && SP.normDate(null) === '');
  check('an unparseable later date reads as EMPTY (hold direction): same ref + garbage date → hold', D({ supplier: CP, ref: 'PO-1', date: '25-12-2026' }, { supplier: CP, ref: 'PO-1', date: '2S/1Z/2O26' }) === 'hold');
  check('the same-document arm needs a NON-EMPTY equal ref (two empty refs with a date on the later page → release)', D({ supplier: CP, ref: '', date: '01-01-2026' }, { supplier: CP, ref: '', date: '02-01-2026' }) === 'release');
  check('the UNREADABLE-predecessor arm (the blur shape, e2e4): earlier number unread + later page has a number but NO date → inconclusive (hold both)',
    D({ supplier: CP, ref: '', date: '23-11-2026' }, { supplier: CP, ref: 'INV-29597', date: '' }) === 'inconclusive');
  check('PIN (C6b, the release that must STAY): an unread earlier number + a COMPLETE later page (own number AND date) → release — holding it would tax every neighbour of an unreadable first page', D({ supplier: CP, ref: '', date: '23-11-2026' }, { supplier: CP, ref: 'INV-29597', date: '24-11-2026' }) === 'release');
  check('the principle: same supplier + a COMPLETE later page (own number + own date) → release even when the earlier page read nothing but its supplier', D({ supplier: CP, ref: '', date: '' }, { supplier: CP, ref: 'INV-5', date: '05-05-2026' }) === 'release');
}

console.log('\n§5 clearPairSentence — exact-sentence, everything else byte-identical');
{
  const pair = SP.buildPairContext([{ original: 's.pdf', segments: ['s_split_p1.pdf', 's_split_p2.pdf', 's_split_p3.pdf'], separators: 0, weak: ['s_split_p2.pdf', 's_split_p3.pdf'] }]);
  const A = SP.pairSentences(pair.pairs[0]), B = SP.pairSentences(pair.pairs[1]);
  const merged = SP.segmentHoldNote(2, 3);
  const advisory = "one character differs; showing 'SO-61040' — please check which is printed";
  check('removes exactly the one sentence; the other family + an advisory survive byte-identical', SP.clearPairSentence(`${A.succ} ${merged} ${advisory}`, A.succ) === `${merged} ${advisory}`);
  check('PIN (Oracle C3): p2 carrying (1,2)-succ AND (2,3)-pred — clearing the released pair leaves the held pair', SP.clearPairSentence(`${B.pred} ${A.succ}`, A.succ) === B.pred && SP.hasPairSegmentHold(SP.clearPairSentence(`${B.pred} ${A.succ}`, A.succ)));
  check("'' when nothing is left; unchanged when the sentence is absent", SP.clearPairSentence(A.pred, A.pred) === '' && SP.clearPairSentence(advisory, A.pred) === advisory && SP.clearPairSentence(null, A.pred) === '');
}

console.log('\n§6 carrySegmentHold — Oracle C5: EVERY mark-bearing sentence is carried');
{
  const pair = SP.buildPairContext([{ original: 's.pdf', segments: ['s_split_p1.pdf', 's_split_p2-3.pdf'], separators: 0, weak: ['s_split_p2-3.pdf'] }]).pairs[0];
  const pairS = SP.pairSentences(pair).succ, merged = SP.segmentHoldNote(2, 3);
  const roles = { refKey: 'invoice_number', dateKey: 'invoice_date' };
  const existing = [{ field_key: 'invoice_number', display_value: 'INV-1', validation_note: `${pairS} ${merged}` }];
  let out = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: null }];
  SP.carrySegmentHold(existing, out, roles);
  check('a row with BOTH sentences carries both onto the merged ref-role row (filter, not find)', out[0].validation_note === `${pairS} ${merged}`);
  out = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: merged }];
  SP.carrySegmentHold(existing, out, roles);
  check('a merged row already carrying ONE of them gets only the missing one prepended', out[0].validation_note === `${pairS} ${merged}`);
  out = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: null }];
  SP.carrySegmentHold([{ field_key: 'invoice_number', display_value: 'INV-1', validation_note: merged }], out, roles);
  check('the single-sentence case is byte-identical to before', out[0].validation_note === merged);
  out = [{ field_key: 'invoice_number', display_value: 'INV-9', validation_note: `${pairS} ${merged}` }];
  const before = JSON.stringify(out); SP.carrySegmentHold(existing, out, roles);
  check('idempotent when everything is already there', JSON.stringify(out) === before);
}

console.log('\n§7 composeNote — the pair mark is its OWN topic (the Oracle C5 twin)');
{
  const pairS = SP.pairSentences(SP.buildPairContext([{ original: 's.pdf', segments: ['s_split_p1.pdf', 's_split_p2.pdf'], separators: 0, weak: ['s_split_p2.pdf'] }]).pairs[0]).pred;
  const advisory = "this could read 'SO-61040' or '$O-61040' (S and $ look alike on a scan) — one character differs; showing 'SO-61040' — please check which is printed";
  check('pair sentence + a genuine ref advisory → NOT collapsed (both survive)', composeNote(pairS, advisory) === null && composeNote(advisory, pairS) === null);
  check('pair sentence + a lane-hold "confirm once" note → NOT collapsed either', composeNote(pairS, 'Read differently after learning — confirm once.') === null);
}

console.log('\n§8 source pins — the order contract and the unconditional class');
{
  const PY = read(path.join(__dirname, '..', '..', '..', 'python_backend', 'pdf_splitter.py'));
  check('pdf_splitter writes its range sets IN ORDER (made[k] ⇔ segments[k] — Oracle C8)', PY.includes('for page_indices in range_sets:') && PY.indexOf('for page_indices in range_sets:') < PY.indexOf('out_name = f"{stem}_split_{label}.pdf"'));
  const SEG = read(path.join(__dirname, '..', '..', '..', 'python_backend', 'ocr', 'segmentation.py'));
  check('detect_segments emits weak_pages from boundary_classes with the _template_identity map (never templates.name)', SEG.includes('"weak_pages": weak_pages,') && SEG.includes('identity_map(templates)') && SEG.includes('from extraction.template_matcher import _template_identity'));
  const H = read(path.join(__dirname, 'handler.js'));
  check('the handler pairs on the rewrite set (weakSegmentNames over the plan), never on a filename', H.includes('.weak = weakSegmentNames(plan, made.map(f => path.basename(f)));') && !/segmentPageRange\(msg\.original_filename\)/.test(H));
  check('the release re-invokes _maybeAutoFile ONLY for an auto-file landing (C1) and only after the partner\'s IO tail (C2)', /if \(partner\.autoFileRun\) \{\s*\n\s*Promise\.resolve\(partner\.ioDone\)\s*\n\s*\.then\(\(\) => _maybeAutoFile\(db, partner\.msg, folderPath, notifyMainWindow, logger\)\)/.test(H));
  check('the provisional stamp never raises msg.needs_review (the T1 bail must pass the release re-run)', !/_pairLanded[\s\S]{0,4000}?msg\.needs_review = true/.test(H.slice(H.indexOf('function _pairLanded'))));
  const RV = read(path.join(__dirname, '..', 'review', 'handler.js'));
  const RR = read(path.join(__dirname, '..', '..', 'windows', 'review', 'renderer.js'));
  // 2026-09-19 (C12): the pair copy now offers the one-click "Join with page N" recovery INSTEAD of pointing the
  // user at the raw .sf_separated_originals folder (barry/Oracle C7 — the button replaces the path hint). The panel
  // still reports subkind 'pair' + the partner page, still names the situation, still never says Split for a pair.
  check("the reason panel reports subkind 'pair' + the partner page; Review's copy names the page and offers the Join recovery (C7 / C12)",
    RV.includes('out.subkind = SP.segmentHoldKind(held.validation_note)') && RV.includes('out.partnerPage = SP.pairPartnerPage(held.validation_note)')
    && RR.includes("v.subkind === 'pair'") && RR.includes('came out of a multi-document scan as a document on its own')
    && RR.includes('undoDocumentSplit') && RR.includes('Join with page'));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
