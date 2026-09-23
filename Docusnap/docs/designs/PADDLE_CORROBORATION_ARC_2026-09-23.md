# Paddle corroboration arc — slice integrity · the second reader's read set · the decision rule

Date 2026-09-23 (night). Status: **DESIGN** (007 + oscar commissioned by the owner; assembled and source-verified by
the coordinator; awaiting the Oracle vet). S0 (geometry hygiene) is BUILT (`a0c25f2`, pins green) because it fixed
a live frame bug in the DARK hold and the measurement both advisors asked for could not run without it.

**Owner's target workflow:** several independent recognitions of each filing value agree → the document files; they
disagree → it holds; the human only ever sees a genuine conflict. "Fix the READING layer, never guess."

Legend: ✔ = verified by the coordinator at source this session · ○ = advisor claim, existence spot-checked, detail
not independently traced · H = hypothesis with its one measurement.

## 0. Corrections that came out of the commission (all ✔)
- **A live frame bug in the dark hold (007):** `field_anchors.x_norm/y_norm` store the taught box CENTRE
  (`src/windows/review/renderer.js:5377` "field_anchors stores CENTRE → convert ONCE"; `anchor.py:3970-3976` crops
  around `cx,cy`; `anchor.py:960-962` converts centre→top-left before the left-grow); `anchor.py:1721` passes
  `(x_norm, y_norm, w, h)` through as `taught_box`; `engine._winning_read_geom` returned it unconverted and
  `reslice._crop_padded` does top-left math → every rigid `anchor_crop` winner handed PP a crop shifted (+w/2, +h/2).
  Masked because mapped docs preferred the mapping rect and `_s05_pages` existed only on mapped docs; the pin
  asserted the pass-through. **Fixed in S0.**
- **The anchor stage reads page 0 only** (`anchor.py:1826` `page0 = page_images[0]`) → an anchor winner's crop page
  is KNOWN = 0; mig-211's `page_unknown` applies only to a mapping winner without its row. **Fixed in S0.**
- **`DESKEW_RAW_CROPS` defaults OFF and is mirrored nowhere** (`engine.py:788`; grep of src/ + database/) → in the
  product `crop_pages` IS `page_images` (identity, `engine.py:947-953`). Design in the deskewed page frame.
- **Not every census disagreement was Tesseract-wrong (oscar):** ≥8 Ironclad statement DATE rows are PADDLE-wrong
  (`Desktop\TEMPTEST_dual_reader\SUMMARY.md:38-40,63-67` — the tool merged ref+date into one crop; PP garbled the long
  gappy line at conf 0.42-0.85). Paddle's one measured failure shape = long multi-token lines → a PP floor (≈0.90)
  on any DISAGREEMENT hold; every PP-right disagreement had PP ≥ 0.903.
- **"PP disagrees on the 8 Print Tracker true positives" was inferred** — the C0 arm ran with the glyph switches
  OFF. Measured by `run_glyph_on.sh` (§12).
- **The rec model's dictionary is 95 printable-ASCII chars** (`python_backend/ocr/models/README.md:6`) → `£`/`€` are
  out of vocabulary; a totals compare must strip the leading non-digit run.
- **ORACLE VET (same night, `docs/oracle_log.md` 2026-09-23 NIGHT): PAD PARITY, not placement.** `anchor._crop_and_ocr`
  reads the taught/relocated value box **±20 px on every side** (`anchor.py:3975-3976` ✔); the hold handed PP the bare
  box + 0.15×h ≈ 4 px. The five "clipped" crops are that mismatch — Tesseract's wider crop rescued the glyph, PP's did
  not. **Built as C1 the same night:** the capture records the crop-family pad (+20 px) and the second reader gets the
  rect Tesseract actually read (no extra quiet zone); `_grow_code_left_read` returns only (surface, conf) ✔, so a grown
  winner's geometry stays the pre-grow box — threading the pad-window rect back is the C1 follow-up.
- **ORACLE VET: PP's demonstrated value on the owner's fonts is the S/5 class** (3 true catches `HS71Y07217`→
  `H571…` at 0.999, via the RESOLVE branch); **the sans O/0 class is PP-BLIND** (4/4 wrong on `W2E8X06407`; PP agrees
  with the wrong `RFH0` on 4 docs) → reachable only by a page-family disagreement or history. The mig-207 hold does
  NOT catch its founding exhibit p7 on the pipeline's anchor rect. Common-mode restated: **4 / 362 PP-agrees on
  pipeline crops, one O/0 family** (not "0/358").
- **ORACLE VET: the `pp_line` witness family (§3, first draft) BREACHES the standing C1** — `_corrob_licensed`
  (engine.py:1964-1972 ✔) and trust.js `_corrobLicensed` (:687-689 ✔) count ANY agreeing family: {crop} ∪ {pp_line}
  = 2 families with `crop` ∈ page families → LICENSED. Withdrawn: PP reads (P1, P2, P3, T1-on-a-grown-rect) never
  enter `_field_candidates` or the corroboration record under any name; they live in an instance transient
  `self._glyph_readset` + the trace. Mechanism pinned in `test_glyph_disagreement_hold.py`.
- **ORACLE VET: "727 confirmed = ground truth" is overstated** — 371 `scope_sweep` + 119 `auto_*` machine confirms
  (51 %) can be circular with the read under test; every count is partitioned by confirm provenance from here on.

## 1. Verified premises the design rests on
- Reader (`ocr/glyph_reader.py`): en PP-OCRv3 rec via onnxruntime, RECOGNITION ONLY (no det/cls, no OpenCV — shed
  for size); `read_crop` → `(text, mean, min_glyph)`; `prep_crop` = grey → LANCZOS to cap≈48 px → light unsharp
  ("do NOT add binarise/CLAHE/JPEG"); deterministic; reads ONE line; width = 48×aspect, not clamped.
- Crop: `reslice._crop_padded(page, box, vpad, hpad)` pads by × BOX HEIGHT, clamps at the page edge; hold reads
  (0.3, 0.15); release wide read hpad 1.0.
- Geometry (after S0): mapping winner → `_s05_read_geom[key]` (the EXPANDED rect the rung read) + its row's page;
  anchor winner → `_field_read_geom[key]` (located `box` top-left, or `taught_box` centre→top-left) + page 0;
  keyword/hint/memory → no box read. `_crop_pages` stashed for every doc; `_field_read_geom` captured for every
  field. `anchor_crop_crosscheck` winners carry no `taught_box` (○ 007: not in `_CROP_FAMILY_METHODS`) → no box.
- Existing anti-clip parts (all ✔ exist; params ○): `template_mapper._find_edge_cut_words` (:3612, word-overhang
  sensor, 0.6·g floor, under `TEMPLATE_ABS_EDGE_GUARD` DARK :645) + `_EDGE_CUT_NOTE` (:663); `_abs_edge_guard`
  (:3837); `TEMPLATE_PAD_WINDOW_READ` (:840, ON); `_grow_code_left_read` (mig 161 DARK) / `ANCHOR_CODE_LEFT_GROW`
  (mig 193 ON, `anchor.py:957-975`, commits clean iff the grown read == the page read); `template_edge_clip_heal`
  (151 DARK); `template_date_left_clip_grow` (131 DARK :662). The rule "two dark healers racing one class breed
  M=1s" is written into the guard (:641-642).
- Pixel-axis vote already exists: `reslice.read_code_witnesses` (:253) + `positional_consensus` (:301) — the glyph
  gallery ruling fixed its role as VETO-only; adopt only when an ink axis and the pixel axis concur.
- Corroboration principle: independence of METHOD FAMILY, never a witness count; `_CORROB_PAGE_FAMILIES =
  {mapping, crop, keyword}`; trust.js `_pageFamilyDisagrees` (:659) holds a role field with a page family in
  `disagree ∪ discounted` (both role-disagree belts ON); `normalise_for_tokens` has no O/0 fold; the mig-191
  suppression lifts an OFF-shape competitor for a taught on-shape winner. PP is NEVER a `_field_candidates` witness
  (Oracle C1). Same-engine same-pixel different-post-process agreement measured 5:1 false:true (2026-08-03).
- The Stage-4.5 learned-shape exemption for label-confirmed reads (`engine.py` ~:11758/:12081) is load-bearing
  (Castellan `CJB-` vs a `JB-` history) — never removed; the history axis must carry that lesson.
- Evidence: general census 3,718 fields 97.4% agree, 0/120 hardest both-wrong; soften set 18 → 14 PP-agree all
  crop-right, 4 disagree all crop-wrong/PP-right; synthetic left clip 1/18 both wrong (`SO-82482`→`30-82482`, PP
  mean 0.876, min glyph 0.505; correct agrees min 0.819-0.998; a clipped `P` → PP dropped it, `O-22954`, min 0.923
  — a DELETION leaves no weak glyph); C0 on the owner's 727: 9 soften docs = 8 crop-wrong/page-right + 1;
  `disagreeing-read` holds 82/727 — the dominant hold.

## 2. Part A — SLICE INTEGRITY (placement axis; runs before any reader)
**Frame.** Page-norm top-left of `crop_pages[page_idx]` (= the deskewed page). Detection in two frames on purpose:
the word sensor in page-norm (cached lines), the ink sensor in CROP PX on the exact bitmap the readers consume.
**Two sensors, OR'd, per horizontal edge:**
- S1 word-overhang = `_find_edge_cut_words(lines, read_box)` with its floors PARAMETERISED and set lower here
  (over ≥ 0.25·g, inside ≥ 0.5·g; keep 0.12 ≤ inside/ww ≤ 0.95). The edge guard COMMITS a value so it must be
  precise; the slice step only decides what the readers SEE — a false "cut" costs a bounded wider slice, never a
  wrong value. Lines = the mapper's shared `_line_cache` (○ `engine.py:9381` key `(id(page),0,0,1,1)`,
  `template_mapper.py:3590-3610`, PSM-6 on a width-capped page, per-word boxes page-norm top-left; H: populated on
  any located doc; a cold keyword-only doc pays one locate).
- S2 ink-at-edge (the hairline class S1 cannot see): quiet-zone crop with hpad floored at 4 px; Otsu
  (`reslice._otsu_binarise` :206, numpy); the OUTERMOST 2 columns each side within the box's vertical band: ink
  fraction ≥ 15 % of band height → the glyph continues past the crop. Rule exclusion: a dark run spanning > 1.5×
  the band height vertically is a RULE (boxed cell / table line) → a HARD bound, never an edge-touch (else every
  `keyword_cell_below` layout false-holds; H: boxed-cell rate on the 727). Vertical seat clip: same test on the
  top/bottom pad rows; heal by growing to the row band (0.5·h, never into an adjacent line).
  oscar's variant (a column ink profile, glyph width g = median ink-run width, grow in 0.5·g steps until a paper gap
  ≥ max(2 px, 0.25·g) → HEALED; the nearest same-row word box − 2 px reached with no gap → UNHEALABLE; cap 2.5·g)
  is the same sensor with an explicit stop rule — adopt the stop rule.
**Growth bounds (page-norm, from the cached lines, never from the box):** left = `label_box.x2 + 0.002` when the
winner carries a located label (the C-C2 "never re-absorb the located label" rule, `template_mapper.py:3896-3906`
○), else the nearest row-band word to the left + 0.5·g; right = the next row-band word − 0.5·g, else the page edge
(reaching it = `unhealed`, folding in the C4 `page_edge` rule); vertical = the box's row band. Step: S1 fired → to the
cut word's far edge + 0.004 (the guard's own rule); S2-only → grow by min(1.0·h, distance to bound), re-test S2, at
most 2 iterations. A bound reached with ink still on the edge → `unhealed`.
**One function** `extraction/slice_integrity.py: slice_for_readers(page, box, lines, label_box, dpi) → {crop, band,
rect, integrity ∈ {clean, healed, unhealed}, edges, sensors, bound_hit}` — pure, no OCR of its own, unit-testable on
drawn bitmaps (DejaVu, free). Consumers: the hold's narrow read, the mig-211 wide read (C3/C4 were a proxy for "does
the value continue past the box" — keep C3 as a belt until the integrity census is green, then retire it under a pin),
and the Tesseract re-read T1. "Same slice" = same source RECT; each engine applies its OWN frozen prep (Tesseract
ladder / R8 for totals; PP `prep_crop`) — a shared prepped bitmap would be a common-mode INPUT (oscar).
**Mutates nothing** on the results dict except the ONE new outcome `unhealed` → cap ≤69 + a neutral note, and only
when the field carries no note (first-writer precedence). Runs at the glyph-hold site, AFTER every committing arm has
finished with the value, consuming the FINAL geometry → it cannot race `_grow_code_left_read` / pad-window /
edge-clip-heal (they decide the value; it decides the readers' pixels). H (007): a grown-rung winner may carry the
PRE-grow `_read_geom` → the step would re-detect and re-grow to the same bound (harmless; pin it either way).
**What makes it wrong:** a value glued to its label (gap < 0.5·g) → `unhealed` → hold (correct polarity, a new hold
class — count it); a mis-placed bound by ≈1.5 px → absorbed by the 0.5·g margins; a composed taught box on a skewed
page is healed by the page's own lines.

## 3. Part B — the second reader's READ SET (per role: ref, date, total)
- **R1 box slice** = the winner's own rect (§1 geometry), healed by §2 → BOTH readers (T1 + P1). T1 collapses to the
  committed read T0 when integrity=clean and the rects quantise equal (`reslice.quantize_box`, 2 dp) — never counted
  twice.
- **R2 second box** = the OTHER located rect when it exists (mapping rect for an anchor winner; anchor rect for a
  mapping winner). Collapse when quantised-equal or IoU ≥ 0.9 (one pixel source, one vote). Else healed independently
  → P2 (and T2). **P1 ≠ P2 on same-length alnum → HOLD** with a neutral note "your two taught positions for this
  field read differently" — a genuine conflict and a stored-box repair lead. Never adopt either. P_drawn/P_box are
  the same engine on overlapping pixels = a PLACEMENT witness, never a second reading vote.
- **R3 label-line slice** (the fourth, engine-independent read): from the cached lines pick the ONE line whose row
  band contains the box centre (0 or ≥2 → no R3); if the winner's label is on that line, cut from the label's first
  word `x1 − 0.5·g` to the line's last word `x2 + 0.5·g`; label ABOVE (`keyword_cell_below`) → the value's own line
  entire; vertical `line.y ± 0.3·lh`. Multi-line boxes (h > 1.6 × median lh) → one PP read per cached line, joined.
  **Aspect cap 14:1** (the model class degrades on long gappy lines — the Ironclad shape): beyond it, or when the row
  carries ≥2 value-shaped tokens (`Net / VAT / Gross`), or a column gap ≥ 4 spaces sits between caption and value
  (right-aligned totals) → **split at the label: PP reads the VALUE RUN only**; field identity comes from Tesseract's
  label geometry; the keyword pattern runs over `tess_caption + ' ' + pp_value`. Say plainly: the VALUE glyphs are
  PP's, the caption is Tesseract's — the independence claim is on the value pixels. Glued text: the en model drops
  spaces at wide gaps → never run a caption regex needing `\s` on the PP string; match the caption by normalised
  PREFIX, run the field's VALUE regex on the remainder; containment = `_page_presence_corroborated` (reuse).
- **Comparators by role:** ref = alnum core, same-length single substitution for a hold (today's); date =
  `validator.parse_date` equality (the mig-208 fold lesson; a parse failure on either side = ABSTAIN, never hold);
  total = `money_cents` equality with sign (`reslice.witness_agrees`) after stripping a leading non-digit run
  (the OOV `£`); apply `money_sign_parens`/`_cr` to the PP string.
- **No-box winners (keyword/hint):** R3 only → a (T_page, P3) pair, two engines on overlapping pixels → HOLD-grade
  only, never a clearing witness by itself.
- **DPI:** stay at 200 (PP rescales to cap≈48 px; a 300-DPI re-render of a scanned PDF is a resample, no new
  information). Cost: PP ≈ 8-30 ms/slice; worst case 3 roles × 3 slices ≈ 0.2 s per scanned doc; born-digital abstains.
- **No PP read is ever recorded in `_field_candidates` or the corroboration record — under ANY family name**
  (ORACLE VET Seam 1: a `pp_line` family would still license the corroborated auto-file, see §0). P1/P2/P3 and T1 on
  a grown rect live in `self._glyph_readset` (instance transient) + the trace only; Part C reads them from there.

## 4. Independence map + the witness ruling (007 and oscar agree)
| read | pixels | engine | counts as |
|---|---|---|---|
| T0 committed box read | P0 | Tesseract LSTM | the value under test |
| T1 Tesseract on the healed R1 | P0' (rect) | Tesseract | = T0 when clean; a placement re-read when healed |
| P1 PP on the healed R1 | P0' | PP CNN-CTC | READING witness — only when integrity ∈ {clean, healed} |
| P2 PP on R2 | other rect | PP | PLACEMENT witness (two taught positions agree/disagree) |
| P3 PP on the label line + the field regex | ⊇ P0 + caption | PP | CONTEXT witness (box vs line framing); value glyphs still PP's |
| T_page full-page keyword read | page context | Tesseract, different segmentation | the existing page family — saw the whole glyph when the box clipped it |
| H history (dominant prefix / confirmed literal / learned shape) | OTHER documents' ink | none | the ONLY different-pixels axis inside one scan |
**Ruling:** a pair is independent iff DIFFERENT ENGINE or DIFFERENT PIXEL SOURCE (`reslice.source_key`: rect + dpi +
recipe), with two exclusions: (a) same engine + same pixels + different post-process = NOT a witness (5:1); (b) ANY
pair sharing pixels whose `integrity = unhealed` counts for NOTHING — the both-wrong `30-82482` shape. H may only
BREAK A TIE between two independent pixel reads, never create agreement alone, never on a scope whose history is
poisoned in the same direction (Pelican P1; Castellan JB), and only for a candidate whose learned-shape check passes
on THIS scope. **Common-mode classes a CNN shares with the LSTM** (agreement means nothing): clipped glyph (→ §2);
missing/broken ink; a rule/fold through the band (strip, then hold); sub-resolution text (cap < ~15 px at 200 DPI →
hold, no recipe adds information); genuine glyph identity (sans 1/I/l — H is the only axis); skew > ~3° (deskew
first); touching pairs (`rn`→`m`, caught by the length compare). **Not shared:** Tesseract's segmentation/PSM
artefacts (`$` at a pad edge, `|` at a rule, column splits), its language prior (`5`→`9` at conf 95), prep artefacts;
PP's own faults (wide-gap space dropping, digit hallucination on long low-quality lines, OOV currency).

## 5. Part C — the DECISION RULE (draft for gary → Oracle; oscar §4 + 007 §4; REVISED by §12)
- **PP is a TIE-BREAKER, not a lone arbiter (§12).** When the box (T0) and the page (T_page) AGREE, a PP dissent is
  trace-only (the sans 0/O class: 4/4 PP-wrong at 0.95). When box and page DISAGREE by one glyph, PP at mean ≥ 0.90
  on a Part-A-clean slice DECIDES — siding with the page = adopt review-bound (the `HS71Y07217` shape, 3/3 right);
  siding with the box = the existing hold stands with PP's vote named in the note.
- **"Box and page AGREE" means a POSITIVE page-family `agree` entry on the same normalised value** (ORACLE C5) —
  page-SILENT is not page-agree: page-silent + PP dissent ≥ 0.90 on a clean/healed slice → HOLD (the no-page-witness
  unique-serial class the hold was built for); page-agree + PP dissent → trace-only, counted as `glyph_lone_dissent`.
- **Rewritten winners abstain** (ORACLE C6): a `+corrected` / `+snapped` / `+confirmed_adopt` method, or `corrected_to`
  / `was_corrected` set, means T0 is a history-rewritten string, not a pixel read — compare PP to the retained raw
  read or abstain (no clear, no hold).
- **HOLD** on a disagreement among {T0, P1, T_page, H} only where no two of them agree against the third at the floors
  (a PP disagreement counts only at PP mean ≥ 0.90 and integrity ∈ {clean, healed}; a date parse failure on either
  side abstains; P1 ≠ P2 holds as "two positions read differently").
- **CLEAR** needs ALL of: (i) integrity ∈ {clean, healed}; (ii) T0 == P1 at PP mean ≥ 0.95 AND min glyph ≥ 0.80;
  (iii) one context/history axis: T_page contains the value (`_page_presence_corroborated`) OR H sides with it
  (shape-passing on this scope). (ORACLE C13 rewrite:) where the page pass and the box differ by ONE
  `_CONFUSE_TO_DIGIT` glyph, engine agreement (ii) plus H decides; where the page pass is SILENT, (ii) plus
  `_page_presence_corroborated` cannot be met, so H is the only route; where a page family DISAGREES on a non-map
  pair, nothing clears (trust.js holds — mig-211 C2).
- **Against a page-family disagreement:** T0 + P1 + H may outvote T_page (14/14 box+PP-side right in the soften
  census); T0 + P1 WITHOUT H may NOT (C0: 8/9 taught boxes wrong, page right). Clearing a page-family disagreement is
  a LEDGER write under the mig-191 predicate (`_suppress_taught_ref_disagree_record`) → the 82/727 `disagreeing-read`
  arc, its own Oracle vet. P3 and `positional_consensus` are VETO/context only.
- **Named preconditions (mig-211 C8):** `trust_role_disagreement_refuse` + `role_disagree_refuse_at100` (the at-100
  path's only page belt once the fc −12 and the boost lift a released doc) and `autofile_gate_unify` +
  `learning_exclude_machine_confirms` (a machine file never feeds `value_counts`).
- **What the human sees:** a hold always carries a reason naming both readings; a clear is silent; a "two positions
  read differently" hold is also a stored-box repair lead.

## 6. Thresholds (oscar; basis stated)
- AGREE counts iff PP mean ≥ 0.95 AND min glyph ≥ 0.80 (already in mig 211). Basis N=14+1; re-set from the 727
  (1st percentile of GT-correct agrees, floor 0.75). **Min-glyph screens SUBSTITUTIONS, not DELETIONS** — a dropped
  glyph leaves no weak step; deletions are caught by the length compare and, when shared, only by §2.
- Re-slice vs hold on a low min-glyph: extend `_ctc_decode` to also return the weak glyph's kept index + timestep
  fraction; min < 0.80 AND the weak glyph is first/last (outer 15 %) → EDGE-weak → ONE bounded re-slice (grow that
  side 1·g, re-read both) → still < 0.80 → hold; interior weak → hold at once.
- DISAGREE holds iff PP mean ≥ 0.90; below → abstain (`pp_lowconf`). Basis: every PP-right disagreement ≥ 0.903,
  every PP-wrong one ≤ 0.85 (Ironclad); N small → measure the PP-mean distribution of disagreements by GT on the 727.
- Tesseract word conf is NOT a witness-quality signal for confusables (wrong `$0-` reads at 80-87, wrong totals at
  89-95) — no Tesseract floor in the agree rule; conf is trace-only.
- History bars: reuse pinned ones only (dominant share ≥ 0.90, confirmed literal mig 204, `_PREFIX_CONFUSE_CLASSES`)
  + the Castellan lesson (history sides only with a shape-passing candidate).

## 7. Expected rates (oscar; honest bounds; the ONE 727 measurement each)
- False-file (clear-and-wrong): 0 on 134 adjudicated agrees; rule-of-three upper bound 2.2 % of the HARDEST agrees;
  do not claim below ~0.5 % of agreeing fields from this. Measurement: over 727 × {ref, date, total} vs the confirmed
  value, count (T0 == P1 ≠ GT) at the floors (≈2,000 fields; a 0 gives ≤0.15 %). With §2 the measured common-mode
  (clip) is removed; residual classes unmeasured, expect ≤0.1 %.
- False-hold (disagree, box right): 3/3,718 in the census, all PP < 0.68 → ≈0 at the 0.90 floor; the refined hold
  false-held 1/400 on clean synthetic. Expect 0.1-0.3 % of docs. Measurement: disagreements with T0 == GT on the 727.
- Hold volume: 2.6 % of fields ≈ 5-7 % of docs, ~95 % true catches. Today's `disagreeing-read` holds 11.3 %; the arc
  reduces touches ONLY if the clear rule may release page-family disagreements with H — Part C's decision.
- Clear yield: H, bounded above by 82 + 9 = 91/727; the soften subset measured 1/9; the 82 unmeasured for
  "box+PP+history agree" → §12.

## 8. Seams (what each part relies on / disables)
- Relies on: the winner's rect being the rect that produced the value (S0 ✔); `_line_cache` populated (○); mapping
  rects in the page frame under the 09-07 angle compose (✔ mappings; H for anchor `taught_box` under
  `teach_angle_compose_scan` — one reprocess trace on a skewed Print Tracker page); the reader vendored.
- Disables/weakens: **credibility reject** (`_crop_is_credible` + `_qualify_against_format`, ○ `anchor.py:4578`) —
  a healed/line read MUST pass both before it is compared, else "PO No SO-82482" swallows the label; **shape veto** —
  untouched (the step never changes a committed value); **Gate C absent note** — an `unhealed` verdict never
  overwrites it; **disagreeing-read** — nothing in A/B lifts it; **the boost** — any note pop inherits the mig-211
  classification (a)/(b)/(c); **`_corrobLicensed`** — no new ledger family; S-A2 changes what the crop family COMMITS
  only when the healed re-read is adopted (v1: it is NOT — the readers' pixels change, the committed value does not).
- The owner's data says the soften note is a TRUE positive 8/9 times (crop wrong, page right): any rule that lets
  two reads of the box's pixels outvote the page without H re-opens the checkpoint on exactly the layout Tesseract
  struggles with.

## 9. Slices + order (merged; each: pins + the ONE bench gate; what could regress)
- **S0 geometry hygiene — DONE `a0c25f2`** (taught_box centre→top-left; geometry follows the winner; anchor page 0;
  `_crop_pages` for every doc; capture for every field; RR_TRACE_OUT). Pins 17/12/19/4. Gate = §12 (the `no_box`
  histogram before/after; agree rate on the mapped docs unchanged). Regress: the mig-207 hold's population widens to
  anchor-only docs → its flip census must be re-run.
- **S1 `extraction/slice_integrity.py`** (pure; trace-only under `GLYPH_SLICE_INTEGRITY`): sensors, bounds, stop
  rule, rule exclusion. Pins on drawn bitmaps (clean / 55 %-20 %-hairline clips left/right/top → healed within bound
  / glued neighbour → unhealed / label bound respected / page edge → unhealed / vertical rule = bound / determinism);
  the edge guard's own pins stay green at its floors. Gate: integrity histogram over every role read on the 727,
  every `healed`/`unhealed` on a contact sheet, pixel-adjudicated; the 8 Print Tracker crops must be `clean`; the 18
  synthetic-clip slices re-run: `30-82482` must read `SO-82482` on the healed slice by BOTH engines. Regress: none
  (trace-only).
- **S-B1 `_ctc_decode` weak-glyph index + timestep fraction** (extra tuple elements). Pins: 222/222 parity on
  [0],[1]; a fixture with a known weak leading glyph. Regress: none.
- **S2 wire the healed slice into the hold + release** (DARK `slice_integrity_heal`): replace the narrow and wide
  `_crop_padded` calls; `unhealed` → release abstains `slice_unhealed` and (only when un-noted) writes the neutral
  clip note + cap ≤69. Pins: existing glyph pins green; `unhealed` → abstain + note precedence; OFF md5 identical.
  Gate: OFF-vs-ON on the 727 with FALLBACK+RESOLVE+RELEASE=1 in BOTH arms, INTEGRITY toggled: wouldFile(ON) ⊆
  wouldFile(OFF) (integrity can only add holds), M=0, new `unhealed` hold count = the false-hold rate (target ≤ the
  mig-207 census's 0.2 %); bump the `ocr_recipe` stamp if a committed read ever changes (v1: it does not).
- **S3 read set, capture-only** (DARK `GLYPH_READSET`): R2 + R3 + date/total roles, traced as `glyph_readset` with the
  §4 records; NO decision change. Pins: same-pixel collapse; in-band line pick (0/≥2 → no R3); multi-line split;
  aspect-cap split; the three comparators (`£2,363.76` vs `2,363.76` AGREE; Ironclad-shape gappy fixture → split;
  parse-fail → abstain). Gate: the agreement matrix {T0, T1, P1, P2, P3} × role vs the 727 confirmed values, per-pair
  false:true like the 08-03 bake-off — the numbers Part C's rule and the floors are set from. S3 runs parallel with S2.
- **S-B3 TOTAL-role disagreement hold** (Oracle R3 lead) on the cents compare + PP ≥ 0.90. Pins: `9,357.30` vs
  `5,357.30` HOLD; `£`-strip AGREE; parse-fail abstain. Gate: 727 totals false-hold count (expect ≤0.3 %),
  wouldFile ⊆. Regress: a `£`→`E` false hold if the strip is wrong.
- **S4 = Part C** (gary design → Oracle) on S3's records.

## 10. A PP DETECTION model — NO for this arc (oscar)
det ≈ 2.3-4.6 MB Apache-2.0, but DB post-processing needs pyclipper (MIT) / shapely (BSD-3) / OpenCV (Apache-2.0)
= the mass S0 shed and the RapidOCR stack removed for size. It buys line boxes from a non-Tesseract segmentation —
useful only for rows where Tesseract returns NO word box (light 7.5-pt grey serials; the dropped type banner). It does
not fix a taught-box frame, does not split caption from value, adds no value-pixel independence. Log a separate
"det for zero-words rows" arc gated on a census of role fields with no Tesseract word box (H < 1 %).

## 11. Oracle verdict (2026-09-23 NIGHT — full text + conditions C1-C14 in `docs/oracle_log.md`)
S0 SIGN OFF W/COND (incomplete without C1 pad parity — **built**) · S1 SIGN OFF W/COND, partly WRONG LAYER (Part A
v1 = word-snap + row-band; the ink sensor DETECT-only, C2) · S-B1 SIGN OFF · S2 SIGN OFF W/COND (`unhealed` =
abstain-all, no note/cap, C3) · S3 SEND BACK on the `pp_line` family (C4 — **withdrawn above**) · S-B3 SIGN OFF W/COND
(C11) · S4 Part C SEND BACK (C5-C9 — C5/C6/C13 folded into §5 above; C7 the H axis from human confirms only, tie-break
only, never against a taught + page-contained read, no H on a scope with a rival confusable confirm; C8 the 82-doc
route = right layer, own vet, both licence twins must refuse any new suppression list first; C9 provenance
partition + restate 4/362 + the in-sample floor) · det model DO NOTHING. **Gate to flip mig 207 = C10:** the 727
re-census after C1 + casefold + the 0.90 floor FIXED beforehand: false holds ≤ 1 (each on a contact sheet), would-file
lost ≤ 1 adjudicated, the 3 `HS71Y` catches kept, the 5 clip + 4 bleed docs read right, wouldFile(ON) ⊆ OFF, M=0,
OFF md5 identical, two ON runs byte-identical. The original open questions, for the record:
1. Part A's `unhealed` note — a NEW hold class on glued label/value layouts: acceptable (fail-toward-review) or must
   it abstain silently in v1 (trace-only) until the 727 histogram sizes it?
2. R2 "two taught positions read differently" → HOLD: the human message + whether it should also mark the anchor for
   repair (a stored-row write = out of scope for v1?).
3. Part C's history leg: the Castellan lesson (4 hand confirms of the OTHER field defined the shape) — is "H sides only
   with a shape-passing candidate" enough, or must H also require the winner's own scope to be non-poisoned (value_counts
   variance)?
4. The 82/727 `disagreeing-read` docs: is releasing a page-family disagreement on {T0, P1, H} a ledger write under
   mig-191 (own vet) or a note-side decision?
5. The P_line witness family `pp_line`: excluded from `_CORROB_PAGE_FAMILIES` — confirm that keeps C1 closed.

## 12. S0 measurement (727 docs, second reader ON, geometry fixed) — results ✔
`run_glyph_on.sh` (RR_APP_ENV=1, FALLBACK+RESOLVE=1, RELEASE off, `--trace`), 17 min; `analyse_glyph_on.js`; the
exact crops re-run for 25 docs with `--slice-dir` (`run_glyph_slices.sh` → `glyph_slices_sheet.png`, eyeballed).
| | count |
|---|---|
| `glyph_check` events | 529 = 358 AGREE · 169 abstain `no_box` (keyword/hint winners, geom=none) · 2 abstain (mapping winner, no rect) |
| PP agrees with the box AND the box is WRONG vs the confirmed value (common-mode) | **0 / 358** on `glyph_check`; **4** more via the RESOLVE branch — the Print Tracker `RFH0738865` family (below) |
| DISAGREEMENT holds | **16 — ALL FALSE** (the box was right vs the confirmed value every time); 0 true catches via the hold |
| would-file OFF→ON | gained 0 (the hold only adds holds) · **lost 6** (false holds on filing docs) |
| the 91 baseline `disagreeing-read` + soften docs | 74 PP agree · 13 no event · 4 disagree (all the same `W2E8X06407` O/0) |
| the 9 soften docs (RESOLVE branch) | #45 `PO-22954` agree 0.956 (reword; would release) · 3× `HS71Y07217` → PP `H571Y07217` 0.999 = **true catches** (PP sided with the page; the confirmed value is `H571…`) · 5× `RFH0738865` PP agree 0.962 — the confirmed value is `RFHO738865` on 4 of them and `RFH0…` on 1 |

**What the 16 false holds ARE (from the crops — the "look at the artefact" rule):**
- **5 CLIPPED boxes** — the taught/anchor rect cuts a glyph and PP reads the remnant: `SO-71797`→`5O` (S cut, PP 0.926),
  `INV-28243`→`…245` (3 cut, 0.886), `DN-16846`→`ON` (D cut, 0.654), `WS-43726`→`VS` (0.645), `WS-43655`→`NS` (0.68).
  Tesseract's own read survived because its pad-window/left-grow arms widen the read; the second reader was handed the
  raw box. **Part A is not hypothetical — it is 5 of 16 on the owner's data.**
- **4 VERTICAL BLEED** — the 0.3×h vertical pad pulls the neighbouring line or a box border into the crop: `NRQ-1124`
  (date below, 0.494), `DN-98358` (a fragment left + below, 0.524), `ITH-0093` (label above + border, 0.775),
  `SO-99174` (date top below, 0.918). Low confidence on three of four → a PP floor removes them; the vertical seat rule
  (§2, grow to the ROW band, never into an adjacent line) removes the cause.
- **2 CASE ONLY** — `Ws-62946`, `iTH-0093`: the compare was case-sensitive → **fixed (casefolded)**.
- **2 SERIF S/5, O/0 on small crops** — `WS-92515`→`W5` (0.822), `SO-72452`→`S0` (0.898): below a 0.90 floor.
- **4 SANS 0/O IDENTITY** — Print Tracker `W2E8X06407`→`…XO6407` at 0.95 ×4: a clean crop; the model reads a
  slashless zero as O. The confirmed value says 0. The page pass agreed with the box (the doc was held on its DATE, not
  the ref). **No reader can decide this glyph; only history/format can** (oscar's class 5) — and a lone PP dissent
  against a box+page agreement must NOT hold.
- **The `RFH0738865` / `RFHO738865` family is the same class:** the S2 census (mapping rect) had PP read `RFHO…`;
  tonight's anchor rect had PP read `RFH0…` at 0.962; Tesseract reads `0`; the owner confirmed `RFHO` on 4 docs and
  `RFH0` on 1. Two crops of one glyph, two PP answers → at the identity limit of the font. Not a common-mode
  misread to fear; a glyph whose identity must come from the serial's FORMAT (history axis), never from pixels.
**Applying the rules this suggests** (casefold ✔ + PP-disagree floor 0.90 + Part A heal on the 5 clips + "PP's lone
dissent against a box+page agreement is logged, not held"): false holds 16 → **1** (`SO-99174`, serif O/0 + bleed at
0.918, which the vertical seat rule also addresses); true catches stay 3 (PP 0.999, siding with the page).
**Implications for Part C (revising §5):** (i) PP is a TIE-BREAKER between the box and the page, not a lone arbiter —
when box and page AGREE, a PP dissent is trace-only; when they DISAGREE by one glyph, PP at ≥0.90 decides (the
`HS71Y07217` shape: 3/3 right); (ii) the sans 0/O and serif S/5 classes need the history/format axis, PP cannot
supply it; (iii) every PP read must go through Part A first — the clipped-box false holds are the arc's own evidence.
**Geometry after S0:** every `glyph_check` carried `geom_src` (mapping / anchor); `no_box` now only on keyword/hint
winners (169) + 2 mapping winners without a rect — the anchor-only population is reached (before S0 it abstained).

Licences: Tesseract 5 (Apache-2.0) via pytesseract (Apache-2.0); en_PP-OCRv3 rec weights (Apache-2.0) via
onnxruntime (MIT); numpy (BSD-3); scipy (BSD-3, `_adaptive_binarise` only); Pillow (HPND); pypdfium2 (BSD-3 /
Apache-2.0); DejaVu fixture font (Bitstream Vera licence, free). No OpenCV, no PyMuPDF (AGPL) anywhere in this arc.
