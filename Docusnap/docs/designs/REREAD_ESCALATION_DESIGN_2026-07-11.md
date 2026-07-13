# Gate-failure targeted re-read — CLOSED DESIGN (build after the night batch commits)

**Status:** ✅ **BUILT 2026-07-11** on top of the committed night batch (`838de51`). Slices:
(1) `ocr/targeted_reread.py` pure module (predicate `is_adoptable` + `locate_value_region` +
`reread_field_value`) + `tests/test_gate_fail_reread.py` (27 units incl. seam #1 + provenance
gate); (2) engine hook at the Stage-4.5 withhold branch (`_maybe_gate_reread`, kill switch
`GATE_REREAD` env, default ON) + provenance plumbing (`tesseract.extract_text_and_images`
`provenance_out` → `process_docs` → `engine.extract` `page_provenance`); (3) harness adoption
count + corpus A/B. **Verified:** kill-switch-OFF byte-identical (10 suites); E2E — #2408 adopts
`SO-27481` review-bound, #2392 fail-safe abstains (crop still garbled); corpus A/B — 5 adoptions
ALL correct/more-correct + review-bound (3 pure recall wins null→correct: #1886/#2354/#2335),
ZERO in the M (auto-file-wrong) list (review-bound invariant holds). Prior status below.

**Status (original):** design complete, Oracle **SIGN OFF WITH CONDITIONS** (2026-07-11). Do NOT build into
the uncommitted night batch (Oracle condition 8): own commit, own corpus A/B, after `e898009`+
night-batch commit. Cycle: user proposal → oscar (OCR axis) + gary (engine seam) parallel →
Oracle joint vet.

## Goal
When Stage 4.5 WITHHOLDS a structured value on format grounds (engine.py:2574-2579 — value=None,
conf 0, note "doesn't match the expected format — please enter manually"), take ONE bounded
second look: locate the garbled value's region on the page, tight-crop re-read via the existing
crop ladder, adopt ONLY a read that passes the exact gates the original failed — review-bound.

**Evidence:** fused-glyph garbles on rough scans (SO-51337→`S0O-51337`, INV-70811→`INV-708114`);
the operator's ⊕ redraw of the same region reliably reads correctly (segmentation-context
artifact, not pixel quality — MP_sal_35 probe: tight 108-DPI crops read clean where the 300-DPI
full-page pass garbled). Every text-side repair rung (2.5 char-subs, 2.5d dominant snap, 4.5
propose_correction) is same-length/substitution-based — the fused/split-glyph class is
length-changing and only fixable with pixels. Live repro docs: 2392 (BF_sal_24), 2408
(BF_sal_27), 2378 (BF_inv_37) — all REPROCESS repros.

## Consensus design
- **Trigger:** the Stage-4.5 withhold branch only; structured fields only (text_field_keys
  structurally can't reach it); never name-like keys; method gate = {keyword, keyword_override}
  (blind anchor_crop EXCLUDED — its failure axis is placement, already laddered once); one
  escalation per field per doc; kill switch `GATE_REREAD_ENABLED`; watchdogs 2.5s/field 5s/doc
  → bail to withhold.
- **Recipe (oscar):** REUSE `_ocr_crop_laddered` (anchor.py:2006). Tight crop = union of value-
  token boxes + 0.6/0.5 row-height padding + neighbour-clip; upscale only if row height <30px
  (LANCZOS→~45px, cap 4×); --dpi hint. NO char whitelist (LSTM beam-forcing converts junk to
  plausible junk; live confusions are within-charset). NO voting (same-pixel variants aren't
  independent witnesses). NO higher-DPI re-render (scanned PDFs embed the raster; the probe
  proved resolution wasn't the axis). NO text_enhance rung for structured in slice 1.
- **Locate (gary, Oracle F1):** AT ESCALATION TIME — one `image_to_data` pass per page per
  extract() call (cached per-extract dict); fuzzy match of the garble with the keyword `label`
  as adjacency disambiguator (label survival through every merge branch VERIFIED); abstain on
  ambiguity/miss → withhold stands. Retained-geometry REJECTED for slice 1 (dead on cached-text
  reprocess — the demonstrated path — and frame-trapped, see seams).
- **Adoption (Oracle F2+F3):** ONE predicate object `_reread_adoptable` = check_value(fmt_entry)
  clean + charset clean + Stage-1 pattern match + KINSHIP (edit distance ≤2 on alnum-collapsed
  forms vs the withheld garble — kills wrong-instance gate-valid adoptions). Passed as the
  ladder's verify_fn (rung selection) AND re-applied to the ladder's return (authority).
- **Semantics:** value/display = re-read, was_corrected + corrected_to, conf = min(original, 69),
  note `re-read from the page (was "<garble>") — please verify`, format_anomaly_flagged, method
  untouched + `reread` marker. Auto-file ineligible by FOUR locks (note blocks at every floor
  incl. 100 trust.js:443-448; corrected_to blocks; 69<70 needs_review validator.py:730; 69<88
  critical floor). Fail/None/second-garble → withhold dict BYTE-IDENTICAL. No learning writes;
  ingestion only via human confirm. Cures the reprocess keep-on-empty stale-junk seam for the
  4.5-withhold class.

## Oracle's seam catches (both designers missed)
1. **Ladder return contract:** `_ocr_crop_laddered` returns `best_seg or None` — the best
   FAILING segment when no rung passes verify_fn (anchor.py:2106-2107). Non-None ≠ adopted.
   The one-predicate-two-call-sites composition makes the fallthrough structurally impossible.
   Never use `meta` presence as success.
2. **Deskew frame trap:** full-page OCR runs on `preprocess_for_ocr(img)` (deskews when enabled,
   tesseract.py:284) while `page_images` are the RAW render (:307-309) — retained boxes would
   live in the wrong frame (~13px @0.3° = decapitation range). INVARIANT: locate and crop from
   the SAME image instance. Any future geometry fast path must carry frame/transform.
3. **Multi-word garbles:** the inserted-space class ("1 102V03NL1") locates as a word SEQUENCE —
   the fuzzy locate must n-gram/join adjacent words within a row.
4. **Locate config parity:** mirror reconstruct_page_text's config (PSM3 + supplementary PSM6 +
   --dpi) so the garble reproduces and the match lands; cached-text strings may predate current
   OCR code → abstain-on-miss (recall-lossy, safe).
5. **Poisoned-scope recall:** a poisoned learned shape REJECTS the true re-read → withhold
   (fail-safe). Recall depends on clean learning; E2E docs need the BF scope clean (renames
   landed 2026-07-11). 2.5d never-resnap PIN kept (adopted string must not pass through
   ocr_corrector at all).

## Premise correction (Oracle)
"The only site that empties a structured value" is FALSE — validator.py:475-476 (Stage-4 date
withhold "not a valid date") is a second site. Slice-1 coverage = refs/codes; garbled-but-
date-like dates are kept+flagged@30 (validator.py:470-473) and never reach the 4.5 withhold.

## G1 — born-digital exclusion (per-page, structural)
`page_text_lines` is PAGE-0-ONLY (process_docs.py:454-465) — doc-level exclusion leaks mixed
docs. Add `provenance_out: list|None` to `extract_text_and_images` (rotations_out precedent,
tesseract.py:301/:377-378), thread into engine.extract; hook requires
`provenance[located_page] == 'ocr'`; missing provenance on PDF → abstain; image inputs → 'ocr'.

## Build-fork conditions (all 9, verbatim intent)
1. One `_reread_adoptable` callable, verify_fn + re-applied; unit: ladder returns gate-failing
   best_seg → NOT adopted.
2. Frame invariant (locate + crop same image instance), commented at the hook.
3. Locate: config parity + n-gram multi-word matching + label adjacency + abstain; units:
   inserted-space garble locates; ambiguous double-match abstains.
4. provenance_out per-page; units: BD-page → byte-identical withhold (exact note string);
   missing provenance → abstain.
5. Kinship in-predicate; unit: gate-valid wrong-instance ≥3 edits → withhold.
6. Pins: never-resnap; one-escalation-per-field; watchdog → byte-identical withhold; kill
   switch OFF → byte-identical (`GATE_REREAD_ENABLED`).
7. Corpus gate: add an ADOPTION COUNT to the harness report (0 adoptions = "never fired", not
   "safe"); load-bearing signals = per-field accuracy delta + adoption eyeball list; E2E on
   2392/2408/2378 only after re-verifying the BF scope's shapes are clean at build time.
8. Sequencing: own commit after the night batch lands; own corpus A/B.
9. Docs honesty: the date withhold (validator.py:475-476) is a second empty-site, out of scope.

gary's test plan (9 units incl. exact-string withhold pin, kill-switch byte-identity,
no-double-escalation, ordering pin) + oscar's module contract (deterministic, abstain-on-
ambiguity, `reread_field_value(page_images, garbled, label, val_type, cache)`) stand as written.
Files: engine.py (~2565 hook), new ocr/targeted_reread.py, tesseract.py (provenance_out),
process_docs.py, tests/test_gate_fail_reread.py. No new dependencies (Tesseract/pytesseract/
pypdfium2 stack — Apache-2.0/BSD).
