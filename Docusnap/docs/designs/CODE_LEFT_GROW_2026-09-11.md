# Arc A — Stage-0.5 page-absent code-clip: placement-certified wider re-read (design, 2026-09-11)

> **STATUS: BUILT — Phase 1 DARK (Oracle SIGN OFF WITH CONDITIONS B1-C7; C1/C2/C3/C4/C6/C7 folded in;
> Phase 2 auto-file HELD per C5). Seed OFF; flip owner-gated (census owed).** Built via a placement-
> certified wider re-read at the Stage-0.5 commit (before `_maybe_pad_code`). Tests: `test_template_code_
> left_grow.py` 10/10 (incl. the premise pin, the worksheet_07 regression PIN, the neighbour-swallow
> refusal), mig-137 @45. The UPSTREAM half of the
> Ridgeway `reference_number` fix (the "why are the crops so bad" root cause). Arc B (mig 160,
> `filing_sanity_ref_reinstate`, BUILT) is the downstream salvage; **this Arc A repairs the READ at
> Stage 0.5 so the value is right in the first place** — A upstream, B the residual net. Switch
> `template_code_left_grow` / env `TEMPLATE_CODE_LEFT_GROW`, mig 161. Log: `docs/oracle_log.md`.
> Companion: `docs/designs/REF_ARBITER_REINSTATE_2026-09-11.md`.

## Exhibit + the pixel measurement (Oracle's send-back precondition, now MET)
RidgewayPlantHire worksheet_07 (doc 358), `reference_number`. Page prints `WS-73673`; the Stage-0.5
`template_mapping` taught-box crop committed **`VS-72672`** (wrong). MEASURED:
- 150-DPI **full-page** OCR reads `WS-73673` cleanly on ALL 20 Ridgeway worksheets → source ink legible.
- 240-DPI token render: **WIDE crop OCR = `WS-73673`** (clean, correct letter AND digits); **trim the left
  14% of the token → `/S-73673`** (W severed).
- ⇒ **crop-BOUNDS clip** (the taught box's frozen normalised left edge lands ~14% right of the W on this
  wider/skewed sibling), NOT source-pixel severance. Oracle A-preconditions #1 (bounds-clip) + #2 (a wider
  read recovers WS incl. digits) **MET**. #3 (ref role runs the code family) MET — `_seed_field_patterns`
  coerces the `"reference"`-typed role to `alphanumeric` (engine.py:2999/:3032) ∈ `_CODE_CROSSCHECK_TYPES`.

## Root cause + why the 3 existing arcs miss it
A shape-VALID taught-code read commits under `shape_mode='ignore'` with **no page witness**. `VS-72672`
folds to the same `reference_code` skeleton as `WS-73673` (3 scattered diffs: W→V, 3→2, 3→2), so:
- **mig 141 read-widen** short-circuits at template_mapper.py:2613 (`shape_match_score(tight)==1.0 → None`)
  — fires only on a shape-INVALID tight read.
- **mig 151 edge-clip heal** needs `_clip_contained` (`_EDGE_CLIP_MIN_INTACT=3` intact un-cut-side glyphs,
  ≤2 differing edge glyphs) — 0 intact both edges → refused (Oracle's send-back reason).
- **mig 160 reinstate (Arc B)** salvages from the ledger — doesn't re-read; needs a keyword candidate.
**Arc A's distinct trigger = PAGE-ABSENCE:** a committed code that appears NOWHERE on the page is wrong
regardless of shape; a wider row-bounded re-read that recovers a code which IS on the page, matches the
learned shape, and geometrically occupies the taught slot is the correct value.

## Mechanism (007 option c — reuse, don't reinvent; bypass `_clip_contained`)
A new helper `_grow_code_left_read(...)` (a.k.a. `_widen_code_placement_adopt`) at the read-widen site
(`_extract_one` ~template_mapper.py:2805), reusing two in-file primitives:
- **`_read_pad_window_code(page, target_box, validation_patterns, return_geom=True)`** (:2411) — the
  row-bounded psm6 wider read (`hpad=min(0.8·bw,0.06)`, `vpad=0.5·bh` = the row-neighbour guard; validates
  each token against the hard `reference_code` pattern; picks the code nearest box-centre; ABSTAINS on two
  near-equidistant codes; returns the recovered token's page-normalised box). The measured 14% clip ≪ the
  80%·bw left reach.
- **`_snap_union_witness(locate_lines, cand_box, …, recovered, target_box, edges)`** (:3540) — the
  PLACEMENT certifier, fed the **independent locate-tier full-page words** (a genuine 2nd OCR pass, NOT the
  pad read's self-witness): condition (1) at :3584 — exact contiguous union of ≥0.9-inside locate words ==
  `_code_norm(recovered)` — simultaneously proves the value is (a) on-page, (b) in the taught slot, (c)
  un-cut-edge anchored. This REPLACES the `_clip_contained` guard the exhibit defeats.

## Trigger conjunction (gary — ALL required; byte-identical OFF)
1. armed (`TEMPLATE_CODE_LEFT_GROW=='1'`, per-call read) AND `abs_text` present AND `val_type ∈
   _CODE_CROSSCHECK_TYPES` AND `not abs_expanded`;
2. mig-141 read-widen returned None on this read (tight is shape-VALID) — the disjointness guard;
3. **PAGE-ABSENCE:** `_code_norm(abs_text)` not a whole-token in the cached page-wide token set (the same
   whole-token discipline Gate C uses);
4. **LEFT-CLIP geometry:** the grown read's box `_clip_edges=='L'` (overhangs the taught box LEFT, not
   'R'/'LR') AND `_row_aligned` AND its RIGHT edge within ~1 glyph of the taught box's right edge
   ("same token extended left," not a neighbour);
5. **RECOVERY corroboration:** recovered value `_validate_code`, `shape_match_score==1.0` vs the confirmed
   entry, AND itself whole-token page-present; NOT `_pad_label_glued` (never a swallowed label tail).
Cold-start (no learned `shapes`) ⇒ ABSTAIN (today's flag path + Arc B catch it).

## Adopt rule — staged, fail-toward-review
- **Phase 1 (flip candidate now, DARK, REVIEW-BOUND):** on a full trigger, SWAP the committed value to the
  recovered code (filename/search/pre-fill correct even when Arc B's ledger candidate is absent), **cap
  conf ≤87** (`<88` floor), attach a truthful note ("read the box wider — please verify the reference"),
  method `+leftgrow`. Strictly better than today (recovers the correct value + one human review).
- **Phase 2 (separate census-gated slice):** commit at conf ≥90, no note → Gate C passes (value is
  page-present) → auto-file. Licensed by the SAME triangulation mig-143 `template_pad_date_adopt` uses
  (independent page family + page-present + tight read is the outlier) — but bigger blast, so census-first.

## Plumbing
mig 161 seeds `template_code_left_grow='false'` (index.js pattern); `dark_switches.js` +1 → **45**;
`handler.js` env `TEMPLATE_CODE_LEFT_GROW`. No hard dep (reuses the ungated `_read_pad_window_code` +
`format_lookup` + `line_cache`); composes with Gate C/Arc B + read-widen. New cost: one memoised page-wide
OCR when armed AND a shape-valid code box commits (byte-identical/no-cost OFF).

## The seam
- **vs Arc B (mig 160, BUILT):** A upstream, no double-fire. A recovers `WS-73673` → value on-page → Gate C
  never writes the ABSENT mark → B's trigger never fires. A miss/abstain → Gate C flags → B reinstates from
  the ledger (today's behaviour, preserved). A@Stage-0.5 (template_mapper), B/Gate C@engine.py — A strictly
  upstream.
- **vs read-widen (mig 141):** DISJOINT triggers (shape-INVALID vs shape-VALID-page-absent); order pinned
  (read-widen first; if None + shape-valid + page-absent → Arc A).
- **WEAKENS downstream (Phase 2 ONLY):** removes the Gate-C/Arc-B human checkpoint for the fixed case
  (auto-files instead of holding) — licensed only by the Phase-2 census (pixel-equality on every added
  filer). Phase 1 removes nothing.
- **Invariant:** "manual/authoritative wins on TYPE alone (`shape_mode='ignore'`)" — Arc A does NOT re-veto
  on shape; it acts only on PAGE-ABSENCE (positive proof the box clipped) and recovers from the SAME slot
  (the read-widen precedent: "the teach fixed the position, not the value"). A page-present manual value is
  never touched.

## Tests + census
- Unit `test_template_code_left_grow.py` (helper direct, page stub + synthetic format_lookup), each proven
  to FAIL with its guard removed: (1) recover-and-adopt Phase-1; (2) clean box → byte-identical; (3) page==
  teach width → None; (4) **neighbour-swallow refusal (adversarial)**; (5) shape-invalid recovery → decline;
  (6) disjointness with mig-141 both-ON. **Regression PIN:** worksheet_07 geometry+text → `VS-72672`→
  `WS-73673` ON, byte-identical OFF. Phase-1 cap-≤87+note pin (a future dev can't silently promote to
  auto-file). JS pin: Phase-1 note + `<88` ⇒ `isAutoFileEligible` false.
- Census (605 + Demo, OFF vs ON, `RR_APP_ENV=1 OCR_RENDER_DPI=200`): fire census **adjudicated AT THE
  PIXELS** (GT may be a mis-confirmed clip); **M=0** (structural — the arc only fires on a page-ABSENT value,
  so a correct value can't trigger it); Phase-1 `wouldFile(ON)⊆wouldFile(OFF)`; Phase-2 `⊇` AND every new
  filer's value == the page-printed token (pixel-equality) = the go/no-go; zero per-field accuracy drop.
  **Zero fires on 605+Demo ⇒ stays DARK** (like mig-155) — needs a real docket corpus to earn the flip.

## Open for Oracle
- Is `_snap_union_witness`(+exact-shape+single-side-clip) a sufficient REPLACEMENT for the bypassed
  `_clip_contained` on the every-doc Stage-0.5 code path?
- The neighbour-swallow guard (right-edge-anchor within ~1 glyph + `_pad_label_glued` + the reader's
  abstain) — enough with `box`-based geometry, or a residual sideways-neighbour risk?
- Phase-1 (cap 87) now vs Phase-2 later — right staging?
- The two HYPOTHESES (a two-code same-right-edge row; a mis-resolved-supplier `format_lookup` licensing a
  wrong-scope shape) — census-reachable, or accept as guarded residual?
- 007 measurements to pin pre-build: 200-DPI recovery (re-confirm the wide read = `WS-73673` at product
  DPI, not 240); the max leading-clip fraction across the corpus vs the 0.8·bw reach.
