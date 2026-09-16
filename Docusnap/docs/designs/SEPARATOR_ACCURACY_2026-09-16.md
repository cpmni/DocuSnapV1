# Separator accuracy — two DARK arcs (2026-09-16)

**Status:** BOTH BUILT DARK (migs 177/178, seeded 'false', in `TEST_SWITCH_KEYS`, argv-only kills).
**Advisors:** gary (design A) → Oracle **SIGN OFF WITH CONDITIONS** (A: C1-C7; B: confirmed + widened, slices 1-3, C8-C11).
Owner: "continue" → measured, designed, vetted, built dark. **Flips = owner's call** after the gates below.

## The problem, measured (`TESTING/_measure/watch_separate_soak_20260916/`)
The batch-separation pre-pass (`python_backend/ocr/segmentation.py`) decides per page whether it starts a new
document: a known template matches AND the keyword-fingerprint overlap clears 0.5 (first-page signature), or a
different template matched (identity change), or a generic header cluster (doc-start). Two accuracy classes:

**(A) UNDER-split — a title-blind pre-pass.** The pre-pass called `identify_template(img, text, templates)` with no
`detected_slug`/`title_trusted` (the full pipeline threads the page's own title — the 2026-07-09 TYPE-PRECEDENCE
fix never reached the separator). On a same-letterhead supplier the sibling fingerprints are identical, so the
tie-break degenerates to the most-confirmed sibling; when that sibling's type reliably prints a heading that is
absent on this page, the TYPE-PRESENCE VETO refuses it → `{'template': None, 'type_refused': True}` → the page can
never be a boundary. Every missed boundary in the templated stacks was exactly this (a supplier's LESS-common
types are under-split systematically). The merged cut is held by mig 176, but held = friction.

**(B) OVER-split — a repeated letterhead IS the fingerprint.** `extract_keyword_fingerprint` harvests the letterhead
words, so a genuine continuation page that repeats the letterhead (logo + name + address — the Sage/Xero/Word-
template classes) clears the overlap floor and is cut off as a new document. `segment_docs.py` cut **6/6**
repeat-letterhead 2-page controls at page 2 (reason "first-page fingerprint"). On a manual import that is a
**silent truncation**: page 1 files as a one-page invoice, page 2 orphans (or files as a `-DUPLICATE` beside it).
Watch holds both. Pre-existing since the separator shipped; the soak's "0 over-splits" was vacuous (its singles
were non-templated suppliers). Oracle: three paths — (a) the overlap, (b) a same-supplier identity change,
(c) the generic doc-start on a full-header continuation.

## The fixes (both DARK; OFF = byte-identical argv + calls)
**(B) slice 1 — `segment_continuation_veto` (mig 177): a self-declared continuation page is never a cut.**
`segmentation.is_continuation_page(text)`: "Page n of N" / "Page n/N" anywhere with n ≥ 2 (never as the object of
"on/see/to" — "continued on page 2" is the page BEFORE); a bare "Page n" only as a page-number line of its own;
"continued" / "(cont.)" / "continuation" in the top 12 non-empty lines and never "continued on/overleaf/next/from";
"brought forward" / "B/F" in the top band ("carried forward" is excluded — it marks the page before). Applied in
`detect_segments` only when armed and only for i ≥ 1; `decide_boundary` untouched. OCR-failure direction: a
garbled marker = today's behaviour; a first page misread as "Page 2 of 2" = an under-split → a multi-page cut →
the mig-176 belt holds it (fail-toward-review).

**(A) — `segment_title_slug` (mig 178): thread the page's own title as a CASCADE.** `keyword.title_signal(text,
patterns, doc_types)` = the process_docs recipe (installed types minus `reading_mode='none'`, alias JSON tolerance,
trusted = heading ∧ conf ≥ 70), installed slugs only (no uninstalled-name fallback — pinned). `segmentation.
page_match`: trusted heading → `identify_template(…, slug, True)`; any installed slug → `(…, slug, False)` (the
`matching` branch needs no trust); else/fallback → today's 3-arg call. Each step falls back on None OR any
`type_refused`, so a page can never lose today's boundary (the pipeline recipe without a fallback LOST one: a
wrong trusted "invoice" title on a Castellan worksheet page hit the trusted-title refuse).

**Plumbing (both):** `segment_docs.py --continuation-veto` / `--title-slug --doc-types-file --config-file`;
`split_plan.buildSegmentArgs` emits them only when ON (never a null in argv); `handler.js _separationOpts(db, args)`
reads the two settings once per pre-pass at BOTH callers (manual import + watch `separateFiles`) and threads them —
argv is the only kill because the pre-pass spawn env is `process.env` + OMP, never the DB-bridged switch env.

## Census (`seg_probe4.py`, six arms, per-PAGE; `probe_6arm_*.txt`)
| set | expected | base | cascade (A) | veto (B) | both | over-splits base → both |
|---|---|---|---|---|---|---|
| synthetic stacks (20 files) | 95 boundaries | 72 | 79 (0 lost) | 72 | **79 (0 lost)** | 0 → 0 |
| real 34-page Print Tracker bundle | 34 | 34 | 34 | 34 | 34 | 0 → 0 |
| 5 non-templated multi-page singles | 5 | 5 | 5 | 5 | 5 | 0 → 0 |
| controls: letterhead-band p2 ± heading (6) | 6 | 6 | 6 | 6 | 6 | **6 → 0** |
| extended: logo-only p2, name-line p2 (4) | 4 | 4 | 4 | 4 | 4 | 0 → 0 (the feared identity-change exposure measured 0) |
| extended: full-header p2 + "Page 2 of 2" (2) | 2 | 2 | 2 | 2 | 2 | **2 → 0** |
| extended: "Page 1 of 2" stack (2 files, 4 docs) | 4 | 3 | 4 | 3 | **4** | **2 → 0** (both = exactly right) |
The "pipe" arm (the pipeline recipe verbatim, no fallback) is the one arm that LOSES a boundary — the reason for
the cascade's fallback. Residual 5 stack misses = 150-DPI heading garble ("WORKS HEET", "DELIVE") → an OCR-quality
arc, separate.

## Gates (Oracle)
- (B) slice 1 flip (C8): pure pins ✓ · controls 0/6 ✓ · stacks/real_34 lost-vs-base 0 ✓ · the end-to-end
  TRUNCATION metric **= 0 ✓** (one manual import of all 40 files with both switches armed: 134 docs, 133 exact
  cuts, 67 one-page cuts auto-filed all complete, 0 auto-filed docs shorter than their GT doc — RESULT.md "e2e").
- (A) flip (C5-C7): extended controls over-splits ≤ base per file ✓ (strictly fewer) · stacks lost 0 ✓ · real_34 ✓
  · truncation metric = 0 ✓ · AND (B) slice 2 shipped — OR the logo-only/name-line p2 controls measured 0 delta ✓
  (measured 0 in every arm). **Both gates are green; the flips are the owner's call** (customer default =
  approval-class). The one wrong cut in the e2e run (`bundle_05`, three non-templated docs imported whole) is the
  pre-existing never-split class, identical under base.
- Still owed (Oracle): **(B) slice 2** supplier-aware identity change (census first: same-supplier
  identity_change-only boundaries = 0), **(B) slice 3** the orphan-shaped 1-page cut belt (no ref AND no date AND
  same supplier as the preceding segment → hold both), and a **recovery path** (the original stack sits in
  `.sf_separated_originals` unadvertised; Review has Split but no Rejoin). Logged in `pendingfeatures.md`.

## Pins
`python_backend/tests/test_segmentation.py` §6 (`is_continuation_page` — n ≥ 2 only, "Page 1 of N" never, footers
of the page before never, top band only for "continued", "carried forward" excluded), §7 (`title_signal` — the
pinned divergences), §8 (`page_match` cascade with a recording stub: OFF = one 3-arg call; the fallback chain;
every-step-refuses → no boundary = the Q2 deferral pinned; source pins that the veto is armed-only and never on
page 0) · `src/modules/processing/test_split_plan.js` §7 (argv byte-identical OFF; never a null) ·
`database/test_segment_dark_seeds.js` (migs 177/178 false seeds, listed, no force-ON twin, argv-only kill at both
callers, gate-clean) · count pins 46 → 48.
