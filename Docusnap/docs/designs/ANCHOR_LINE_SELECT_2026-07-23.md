# ANCHOR_LINE_SELECT — per-line candidate selection for the anchored crop read
**Status: DESIGNED + ORACLE-SIGNED (2026-07-23), NOT BUILT. Build job for the next session.**
Provenance: owner proposal → 007 design → gary verification (3 corrections) → Oracle
SIGN OFF WITH CONDITIONS. All cites re-verified by gary against the tree on 2026-07-23.

## The problem (live evidence: Thornbury Fasteners dockets, ~+2° skew)
The crop pad is a FIXED +20px half-height (`anchor.py:2837-2838`), so a single-row taught box
(live h_norm 0.0154-0.0240) structurally crops **~1.5-2.2 text rows**; skew slides the adjacent
row in half-sliced. `clean_crop_segment` then takes the FIRST non-empty line (`anchor.py:2337-2341`,
documented at `:2326` — update that docstring), so a date field's crop commits/rejects on the
NUMBER row's garbage ("vO. DN-50755" → not_credible → inline rescue). The crop witness is dead on
every such doc, and **label-ABOVE layouts (inline structurally EMPTY) have no rescue at all**.
⚠ RULED OUT (Oracle, measured): the taught boxes are NOT oversized — E1 "oversized-box" geometry
discriminators are DEAD; the bleed is read-time padding. Do not re-chase.
⚠ RULED OUT (Oracle): shrinking the pad — higher blast radius (changes OCR input pixels system-wide;
pad exists for bench-proven ascender reasons). Fix the READING (selection), not the padding.

## Slice 1 — `ANCHOR_LINE_SELECT` (env kill switch; DEFAULT OFF until the gate passes, then flip)
- **Hook:** inside `_ocr_crop_laddered`'s rung loop, replacing the `:2602` first-line take ONLY when
  active — all five crop rungs inherit it (rigid `:401`, label-lock relocate `:531`, gate re-read
  `:707`, drift relocate `:886`, registration `:966`; note `:966` deliberately passes no
  top_limit/max_w — do NOT "fix" in passing).
- **Lines at zero extra cost:** refactor `_read` (`:2417-2451`) → `_read_lines_full(img, psm)` →
  `(text, mean, min_conf, lines[{text, top, height, mean_conf, min_conf}])` from the SAME
  image_to_data pass (per-word top/height/line_num already received and discarded). `_read` stays a
  thin wrapper, byte-identical outputs. Do NOT extend `_read_block_lines` (second OCR pass; it stays
  continuation-only).
- **Band:** computed ONCE in `_crop_and_ocr` in CROP px from its own args
  (`band = ((cy−box_h/2)−y1, (cy+box_h/2)−y1)`, `box_h = h_norm*h`), only when both dims present
  (the 200×60 no-dims fallback → no band → inert). Passed as `row_band=` kwarg. **RESCALED PER RUNG**
  by `rimg.height / crop.height` — gary's frame catch: heavy `_tm._prep` (`template_mapper.py:1211-1216`)
  upscales ×2 for virtually EVERY crop; light `_light_prep` (`:2411-2413`) only <300px wide. A
  once-per-crop scale is the frame bug (pin c).
- **Selection rule, per PSM-6 line, top-sorted geometrically:**
  1. `_clean_one_line`;
  2. the rung's existing `verify_fn` (= `_crop_is_credible` AND `_qualify_against_format`,
     `:346-350` — NO new predicates);
  3. `date` additionally: `validator.parse_date` non-None (`validator.py:89`, lazy import);
  4. band overlap ≥50% of **min(line_height, band_height)** (the `:2709` narrower-box convention).
- **EXACTLY ONE in-band qualifier → commit** with meta (mean/min_conf) **from the selected line's
  words ONLY** (whole-crop min includes the garbled neighbour and would falsely demote a correct
  read out of Tier-A — `engine.py:3071-3136` `_ocr_clean` gates both the authoritative win and
  `is_taught_override`). **Zero or ≥2 → fall through to today's exact whole-text path FOR THAT RUNG**
  (slipfix / debris-trim / not_credible / inline preserved beneath). NEVER nearest-wins.
- **Method = the rung's NATIVE method** (gary correction #1): the selected line flows back through
  each rung's own commit (`anchor_crop` / `anchor_crop_relocated` / `anchor_registration`) — forcing
  'anchor_crop' would erase relocate provenance (`engine.py:294 _RELOCATE_METHODS` + trust
  discrimination key on it).
- **Scope:** `val_type ∈ {date, alphanumeric, job_reference, currency_code}` ONLY, `verify_fn`
  present (auto-excludes the gateless Stage-0.5 caller `:2588-2592`), band present. Free-text
  (incl. None) and currency EXCLUDED — currency's `:455-462` all-rows-regex-valid proof; the
  free-text preview fast path (`:2567`) is scope-disjoint.
- **OFF ⇒ byte-identical BY CONSTRUCTION:** same Tesseract call either way; the chooser branch never
  runs. Switch convention: per-call `os.environ.get(..., "0") != "0"` (matches `:2825`/`:1453`).

## Slice 2 — `ANCHOR_ROW_GRACE` (**build DARK; do NOT flip with slice 1** — Oracle)
±0.6·box_h vertical expansion inserted BEFORE the existing `:2861` caption clamp (so
`top_limit_norm` enforcement is existing code); downward cap ≤0.6 row; a line whose bbox touches
the crop top/bottom edge (≤~2px, crop px) is INELIGIBLE in the chooser (row-integrity by
disqualification). **Must be inert unless LINE_SELECT is active** (enforced in code — grace without
the chooser re-opens the 2026-07-20 caption-band incident class). The honest residual lives here:
a FULLY-contained wrong row within grace + a garbled true row (two stacked dates) is a new
silent-wrong-value geometry — hence dark, own adversarial pin, own later A/B, flipped only on a
measured case slice 1 alone fails.

## Oracle conditions (beyond the design)
1. **Chooser exception-safety:** the whole selection branch wrapped; any exception ⇒ today's exact
   whole-text path (the `:635-636` guard convention). Pin (h).
2. **`best_seg` bookkeeping:** when the chooser declines (zero/≥2/exception), the rung's
   best_seg/best_conf/best_min tracking AND the no-rung-gated return-best path must be byte-identical
   to today. Pin (k).
3. **Adversarial date pin (i), proven RED-first:** two stacked parseable dates in the crop, true row
   garbled → the wrong row must NOT commit under slice 1 (out-of-band → fall-through).
4. **Live val_type resolution check (j):** confirm on the live pipeline that `delivery_number`'s
   val_type at the ANCHOR path resolves in-scope (`alphanumeric` via the merged label-override entry,
   `anchor.py:320`), not None — else the scope cut silently excludes the very field this fixes.
5. Slice-2 stacking enforced in code + its own grace-zone adversarial pin before any flip talk.
6. Pins (a)-(g) as designed; (a) never-nearest-wins and (d) meta-frame defended hardest.

## Pin list (unit tests, Tesseract-free — extract pure `select_row_line(lines, band, val_type,
qualify_fn)` + `_row_band`; new `python_backend/tests/test_anchor_line_select.py`)
(a) two in-band qualifiers → reject (never nearest-wins) · (b) out-of-band-only qualifier → reject
(never commit another field's row) · (c) prep-scale invariance (<300px crop, ×2-3 prepped image —
band decision scale-invariant) · (d) meta-from-selected-line-only (whole-crop min 32, line min 91 →
meta 91; feeds `_TIER_A_OCR_MIN`) · (e) grace never above top_limit_norm + edge-touching line
ineligible · (f) free-text/currency/None: chooser never invoked, byte-identical with flag ON ·
(g) relocate-rung selection commits `anchor_crop_relocated` · (h) exception ⇒ status-quo ·
(i) stacked-dates adversarial (RED-first) · (j) live val_type check · (k) best_seg byte-identity.
Also: a shape-valid non-date ("99/99/2026") must NOT qualify on a date field. Ladder integration via
monkeypatched `_read_lines_full` stubs.

## Verification gate (before the default flips ON)
- Pins (a)-(k) green; (i) + anti-loosen pins proven RED against a naive build first.
- Corpus A/B OFF-vs-ON: **M unchanged vs the pre-existing M=3 baseline** (poisoned GT #190/#7 — a
  NEW M is a stopper), zero per-field accuracy drop, OFF byte-identical to base, and a **doc-by-doc
  attribution of every slipfix/recovered/crosscheck COUNT DROP as a verified healing** (a flag that
  disappears must be shown to be a framing artifact, not a lost checkpoint).
- Live: the 4 Thornbury docs — date commits from the crop rung (rung-native method, clean per-line
  min_conf), DN-56755 reads without debris-trim, docket_08-1's "vO. DN-50755" trace no longer
  reaches not_credible; PLUS a label-ABOVE fixture that today ends empty→review must FILL (the class
  nothing else covers).

## The ladder note (pin in docstrings — Oracle's closing condition)
2026-07-23's four rulings form a deliberate ladder: **LINE_SELECT fixes the READ · the
crosscheck+E2 (`CROSSCHECK_KEYWORD_CLEAR`) arbitrates a DISAGREEMENT with a real witness ·
clean-accept (`GATE_REREAD_CLEAN_ACCEPT`) stops flagging a NON-correction · the review flag
survives wherever no second independent read exists.** Each layer's guard assumes the one below
still fires — a future "simplification" that removes the crosscheck because "LINE_SELECT made it
quiet" reopens the City Office silent digit-mangle. Do not remove lower rungs.

## Known residuals (accepted, named)
- PSM-7 (first rung) can read the WRONG row alone, pass verify, and commit before multi-line
  evidence exists — selection never runs. Accepted (E2/FOREIGN_FIELD_DROP behind it); do NOT
  reorder the bench-calibrated ladder for it.
- Cold field (no learned shape): loose qualification → both rows qualify → ≥2 → status-quo
  fall-through (degrades exactly where evidence is weakest).
- gary HYPOTHESIS (harness-unreachable): a mis-resolved supplier whose learned shape belongs to
  another supplier's field → confident selection against wrong history; upstream cross-supplier
  gates (`:367-392`) unchanged.

Key files: `python_backend/extraction/anchor.py` (`:346-350`, `:2337-2341`, `:2417-2451`,
`:2560-2620`, `:2837-2878`) · `python_backend/extraction/template_mapper.py` (`:1204-1218`) ·
`python_backend/extraction/engine.py` (`:294`, `:3071-3136`) · `python_backend/extraction/validator.py`
(`:89`). Full advisor transcripts are session-local; this doc is the canonical spec.
