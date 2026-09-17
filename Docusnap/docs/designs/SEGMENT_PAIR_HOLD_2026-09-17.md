# Segment PAIR hold — the S4 silent truncation belt (2026-09-17; mig 180 `segment_pair_hold`, DARK)

**Status:** BUILT DARK the same day (seeded 'false', in `TEST_SWITCH_KEYS` → 50, no force-ON twin, read at the landing
site like mig 176). **Advisors:** the population measured first (`weak_cut_census2.py`) → gary (design, one correction
round on the class) → Oracle **SIGN OFF WITH CONDITIONS C1-C12** (`docs/oracle_log.md` 2026-09-17, second entry).
**Flip = owner's call** after the C9 census cells AND a recovery action (C12) — see Gates.

## The problem, caught live
The batch-separation pre-pass cuts a page off when it matches the SAME template as the current document and its
keyword-fingerprint overlap clears 0.5 — and the fingerprint IS the letterhead words (`template_matcher.py:1306-1379`;
Copperfield's invoice fingerprint = `Copperfield Electrical Faraday Industrial Park Coventry`, nothing else). So a
2-page document whose page 2 repeats the letterhead with NO page marker (mig 177's veto needs one) is cut at page 2,
and on a MANUAL import a 1-page cut is never held (mig 176 holds multi-page cuts only): page 1 auto-files as a complete
1-page document, page 2 orphans in Review. The arc-3 e2e caught it (`e2e3_result.txt`: #1255
`ctrl5_supplier_copperfield_split_p1` AUTO-FILED at 100 — PO-95864, 25-12-2026 — with page 2 held; three more controls
cut the same way, both halves held). Pre-existing since the separator shipped.

## What the pages actually read (the facts the design rests on)
- The four exhibit cuts: `ctrl3_b2b_thornbury` p2 (p1 matched NO template at 150 DPI; p2 = the 9 % band + items →
  Thornbury/delivery_note, reason "different template"), `ctrl5_billto_copperfield` + `ctrl5_supplier_copperfield` p2
  (the same Copperfield template both sides, "first-page fingerprint"), `ctrl5_blur_copperfield` p2 (p1 blurred → no
  template; p2 Copperfield/invoice). All four: `is_document_start` False on p2 (no recipient marker, no email head).
- Post-extraction (the sandbox DB): the three Copperfield orphans read supplier @95 + the SAME reference as page 1
  (INV-29597 / INV-29597 / PO-95864) and NO date; the Thornbury orphan read supplier only. Every genuine document in
  the corpus reads its own different number + a date.
- `real_34.pdf` (the owner's real 34-page Print Tracker alert bundle): every page has witness False and names [] —
  BUT every page is an `is_document_start` hit via the EMAIL arm ("From: / Sent: / To:"). The walk labels them
  "first-page fingerprint" only by reason PRECEDENCE (`segmentation.py:378-386` tests the fingerprint first). So
  nothing downstream could tell a letterhead-only cut from one backed by first-page evidence. Adjacent alerts share a
  ref (a device serial: p24/p25 both 1984800049 and both dated 29-08-2026), and 7/34 alert pages read null ref + null
  date in the sandbox run (run-dependent).
- Levers rejected on the numbers: a pre-pass SUPPRESS ("same known name + no witness → never a fingerprint cut")
  rescues 1/4 (three p2s carry "Invoice No" in the band), and a suppressed only-cut imports the file WHOLE (mig 176
  blind); the Oracle's literal slice 3 (no ref AND no date AND same supplier → hold both, no class) holds the
  predecessors of every unreadable alert page (≤ 4 per 34, run-dependent). A class-ONLY belt ("hold every weak pair")
  would hold ~22 genuine stack documents.

## The design — a HYBRID (the pre-pass owns the CLASS, the pipeline owns the VALUES)
**Slice A — `segmentation.boundary_class` / `boundary_classes` (Python, pure, pinned §13).** A boundary is WEAK
("template_only") when it was decided by a TEMPLATE leg with NO document-start on the page: **A** the same template's
fingerprint (a repeated letterhead) · **B** no template → a template (page 1 matched nothing at 150 DPI) · **C** a
same-SUPPLIER sibling type switch (identity = `template_matcher._template_identity` — the dominant confirmed issuer,
else the frozen supplier_name fixed value — NEVER the cosmetic `templates.name`, Oracle C4; '' → strong). STRONG = any
doc-start hit, any known-supplier change (mig 179), a CROSS-supplier template switch, a vetoed page (no cut).
`detect_segments` emits the additive `weak_pages` key UNCONDITIONALLY (metadata; the segments are byte-identical);
`segment_docs.py`'s slips path emits `[]`.
**Slice B — `split_plan.js` (pure).** `buildSplitPlan` carries `weakIdx`; `weakSegmentNames` maps it onto the
splitter's outputs (made[k] ⇔ segments[k] — pdf_splitter writes its range sets in order, pinned); the rewrite carries
`weak: [basename…]`; `buildPairContext(rewrites)` pairs every weak segment k ≥ 1 of a HEURISTIC rewrite with k−1 (a
middle page of p1|p2|p3 belongs to two pairs; sheet-bounded rewrites and a user's own `x_split_p2.pdf` never pair —
the rewrite set is the trigger, never the filename). `pairHoldDecision({supplier,ref,date} × 2)` — **Oracle C6b (the
PRINCIPLE, ruled after the e2e exposed the blur shape):** a weak later page is RELEASED only on POSITIVE evidence that
it is a document of its own; with the same supplier, any missing piece is 'inconclusive' → hold both. In order: blank
supplier either side → **inconclusive** · different suppliers → **release** · no number AND no date on the later page →
**hold** (the orphan arm) · the same number as the earlier page (folded) → **hold** when the later date is empty or equal,
**release** when it is a different date of its own (the same-serial alert shape) · own number AND own date →
**release** (incl. after an unread earlier number — the ONE release that must stay: holding it would tax every
neighbour of an unreadable first page; recorded as a census count) · no number but a date DIFFERENT from the earlier
page's read date → **release** · everything else (a repeated date without a number, a number without a date, an
unread earlier number with a dated-but-numberless or numbered-but-dateless later page) → **inconclusive**. Suppliers compare
on suffix-stripped tokens with the separator's prefix tolerance; numbers after text_normalise + a separator strip +
a digit-confusable fold (O/0, I/l/1, S/5, B/8, Z/2 — the fold can only ever ADD a hold; the Oracle's `INV-2959l`
example is really an l↔1 case: `INV-2959O` ≡ `INV-29590`, `INV-29598` ≠ `INV-29597`); dates via the ONE parser
(`date_parse.parseDate`; unparseable = empty, the hold direction). Sentences are PER PAIR and name the partner page
("Page 1 came out of a multi-document scan as a document on its own; the next page (2) may belong to it — check both
(the original scan is kept in the folder's .sf_separated_originals) — confirm once."), end with the lane-hold literal,
carry their own mark (`SEGMENT_PAIR_MARK`, disjoint from mig 176's wording), and every stamp / clear keys on the EXACT
sentence (C3). `hasSegmentHold` is now EITHER family; `segmentHoldKind` tells them apart; `carrySegmentHold` carries
EVERY mark-bearing sentence (C5); `composeNote` gives the pair mark its own topic.
**Slice C — `handler.js` + `watch/handler.js` (both arrival paths).** One `pairCtx` per import / drain beside
`segHold`, threaded as `opts.segmentPairs`. On a landing (`_pairLanded`, after the mig-176 stamp, before the chip
verdict): partner not landed → stamp THIS doc's PROVISIONAL sentence (its own auto-file is refused by the ONE
predicate; `msg.needs_review` is NEVER raised — the release re-run must pass the T1 bail); partner errored →
inconclusive → stamp; both landed → decide: **release** clears the partner's provisional sentence and — ONLY when the
partner's landing was an auto-file run (C1: never on watch) and after ITS working-copy / rotate tail (C2, the
`_ioDone` deferred) — re-invokes `_maybeAutoFile` with the partner's ORIGINAL msg (the chain's status guard + atomic
claim make a double file impossible); **hold / inconclusive** stamps both. The error branch records the failure. A
stub row the pair stamp created is removed once its note is empty. Reason panel: kind `segment-hold` + `subkind
'pair'` + the partner page; Review's copy names the page and where the original is, never "use Split" (C7).
**Failure directions:** the provisional note IS the deferral — a successor that errors, a Stop, a kill mid-batch all
leave the first-landed half with a DURABLE note that File-All, the sweep and the reprocess offer refuse until a human
confirms once. Churn accepted (Oracle): on a 20-file stack import ~22 predecessors get a provisional note stamped and
cleared within seconds (two UPDATEs + one enqueue per pair; the Review flicker is the appear-then-auto-file churn every
import already has); an in-memory grace instead was rejected — a kill mid-batch would leave an UNMARKED page (the
mig-176 lesson).

## Census with the SHIPPED functions (`weak_cut_census2.py`, three-arm; outputs `weak2_*.txt`)
| set | boundaries | WEAK | weak genuine | weak over-split | note |
|---|---|---|---|---|---|
| the 4 exhibits (controls3/5) | 11 | 4 | 0 | **4** (all four) | 2 × A, 2 × B |
| real_34 + 5 singles | 33 | **0** | 0 | 0 | every alert page = an email-header doc-start |
| synthetic stacks (20 files) | 71 | 50 under "any template cut" → **~22** with cross-supplier STRONG | 22 | 0 | 8 × C (tb_same_01 p2-p5, tb_same_02 p3-p5, tb_04 p7) + ~14 × B; every one reads its own number + date → released |
Without the class the same value check would also hold 4 real_34 predecessors (the unread null/null alerts follow
read ones) — that is what the class buys.

## e2e (the Oracle's gate)
`e2e4_tail.sh` (the sandbox app on the new code, mig 180 applied at boot, the pair belt + 177/178/179 + 176 armed; one
manual import of the same 72 files as e2e3 through the app's own road; `soak_e2e_check.js` now FAILS an UNMARKED
truncated half and counts `truncatedHeldMarked` / `pairMarked` / `pairMarkedExact`) → `e2e4_result.txt`: 189 docs, 178
exact, **truncatedAutoFiled 0** (e2e3: 1), merged 3/3 marked, **pairMarkedExact 0** (no genuine document held), onePageAuto
81 (e2e3's 82 minus the truncated #1255 shape, now held), the whole-file set identical; 24 pairs decided in the app log —
21 released within seconds (own number + date), 3 held (b2b_thornbury · billto_copperfield · supplier_copperfield). The
blur pair was released by the first rule (page 1's number unreadable) → the C6b principle above → `e2e5_result.txt`
(the two blur controls, app restarted): `ctrl5_blur_copperfield` inconclusive → both held + marked, truncatedUnmarked 0.
**All four exhibit pairs held + marked; gate green for the DARK merge.** Full tables: RESULT.md "Pair belt".

## Gates
- **Before merge (DARK):** pins — `tests/test_segmentation.py` §13 · `test_split_plan.js` · `test_segment_pair_hold.js`
  (pure) · `test_segment_pair_stamp.js` (Electron) · `test_segment_hold_{predicate,stamp}.js` · `test_note_topic_dedup`
  · `test_segment_dark_seeds.js` (mig 180) · count pins 50 — ALL GREEN; the census above; e2e4.
- **Before the customer flip (Oracle C9 + C12):** (i) real_34 RASTERISED at 150/200 DPI → weak count + held = 0 via
  the value check (the born-digital email head is the protection today); (ii) a young-install stack (templates for the
  successor's supplier only) → the inconclusive count; (iii) the "email-arm-only STRONG" alternative class over
  stacks/real_34/controls (would catch a Sage-class full-header repeat without a page number, today STRONG); (iv)
  178+179+belt ON over controls3/5 → every sibling false cut held; AND a one-click recovery action on the pair reason
  ("Re-import as one document" from `.sf_separated_originals`, or Rejoin-with-previous) — today the hidden folder is the
  only way back.

## Pinned trade-offs (do not "fix" these)
- An adjacent DUPLICATE scan (same number + same date) is held for one look instead of filing as `-DUPLICATE`.
- A same-supplier weak pair whose later page reads its own number + date is NEVER held (blocks a "tighten" into the
  class-only form that would hold ~22 genuine documents).
- An email-header page is never weak (blocks a "widen" back onto the flagship one-click flow).
- A cross-supplier template switch is never weak; a cosmetic template rename never changes the class.
- A watch pair release never auto-files; the provisional stamp never raises `msg.needs_review`.
