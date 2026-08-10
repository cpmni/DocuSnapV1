# HANDOVER — 2026-08-11 OVERNIGHT (autonomous; owner asleep from ~22:00)

**Branch** `feat/teach-side-overnight` · **HEAD `4982610`** · all pushed, tree clean.
**Migration 60, unchanged.** **NOTHING FLIPPED. NO live-DB write. No destructive action.**
Standing rules honoured throughout: default-OFF flags, measure against the snapshot never the live
DB, no flips while the owner is away.

Continues `HANDOVER_2026-08-10_EVENING2.md`. The evening's work (SFDEV captions, both Oracle passes,
three measurements) is in commits `54ac065`…`e619bc0`; this covers the night that followed.

---

## TL;DR

1. **Both extraction flags are fully discharged** — every Oracle condition that was a code change is
   applied. What is left on each is your judgement, not a measurement.
2. **The `I`→`1` misread is root-caused, designed, Oracle-signed with 4 blocking conditions, and
   DELIBERATELY NOT BUILT.** It is bigger than it looked and one condition means the obvious version
   heals nothing.
3. **The whole test suite ran for the first time: 457 files, 442 pass, 14 genuinely red.** All
   pre-existing — verified against the commit this session started from. The "4 pre-existing
   failures" line in CLAUDE.md was understating by nearly 4×.
4. **Chris re-ran his review** in a fresh sandbox under last night's conditions. See his section.
5. **Do not flip `CODE_SEPARATOR_STRUCTURE_GUARD` on its own** — that changed tonight, see below.

---

## THE ONE THING THAT CHANGES A DECISION YOU WERE ABOUT TO MAKE

You were told the separator guard was ready to flip. **Flip it only together with the `I`→`1` fix,
and after it.**

`ocr_corrector.value_to_template` keeps `/` as a literal. Once the guard is armed and your confirms
make 10-character values the majority for that supplier, the scope's learned template becomes
`UD/DD/DDDD` — and `try_correct` (`LETTER_TO_DIGIT['I'] = '1'`) then rewrites a **correct**
`PI/26/6000` back to `P1/26/6000` at `min(95, 90+20) = 95`, method `+corrected`, **with no note**
(`engine.py:6688-6701`). It cannot fire today only because the poisoned history is separator-free
(8 chars) and `try_correct` bails on a length mismatch.

**The guard is the fuse; your own confirms arm it.** gary found it, Oracle verified it and ruled on
the flip order. Nobody is proposing to fix Stage 2.5b tonight — it is a separate, higher-blast-radius
slice — but the ordering matters and you were about to be told the opposite.

---

## The `I`→`1` misread — root-caused, specified, NOT BUILT

**It is not placement.** I rendered the crop and read it by eye first: a clean, tight, legible
`PI/26/6000`. A reading failure on good pixels.

**The correct read is produced and then discarded.** Measured on the exact crops the pipeline used:
raw greyscale is correct **5/5**; light 2/5; heavy 1/5; struct 0/5 — and **raw is not a rung**.
Ranking rungs by mean word confidence compares posteriors conditioned on *different evidence*: the
processing destroys the antialiasing grey that separates a serif `I` from a `1` at ~20px cap height,
so **confidence rises as evidence is destroyed**.

**I had this partly wrong and it was load-bearing.** My write-up said "every rung scores below 60".
False on 2 of 5 — re-measured through the ladder's own `_read_lines_full` (not `image_to_string`;
they disagree on layout assembly), 0025 and 0022 clear the gate and return through the accept branch.
A comparator-only fix heals at most 3/5. Corrected in place.

**You asked whether pre-converting to 2-bit B&W would help. Measured: no, and it is the same mistake
in a new coat** — 1-bit Otsu at x2 scores 79–85 while WRONG against raw at 45–56 while RIGHT.
Tesseract already binarises internally with an adaptive threshold; a global pre-threshold only
discards the grey that carries the distinction. Dithering returns `'PYoereo08'`.

**The design (gary's, Oracle-preferred): a RAW WITNESS.** Read the crop once unprocessed; it is a
witness, never a candidate, and may change the committed string only when it differs by exactly ONE
confusable-glyph substitution at the SAME length. It cannot change length, structure or emptiness.

**Oracle: SIGN OFF WITH CONDITIONS — 4 blocking.** The critical one, **C1: as specified it heals
zero documents today**, because both ladder exits return the string *after* `_repair_single_token`,
which with sepguard off deletes the slashes — so the witness compares 10 characters against 8 and
discards. The comparison must move inside the rung loop, before the repair. C2 requires two tiers
(FLAG before ADOPT) because the rule is symmetric and has no independent corroborator. C3 requires a
bidirectional per-pair census before enabling any pair beyond `I`/`1`. C4 is the flip order above.

**Why I did not build it.** With C1–C4 applied this is a two-tier flag, a bidirectional census, a
Gate C amendment and a pin set that must drive the real ladder. Half-building that unattended, in
the extraction path, is exactly what "safely, no regressions" rules out. **It is fully specified in
`pendingfeatures.md` and ready to build cold.** Also worth knowing: the corpus is synthetic and
rasters at 150 DPI while the app renders at 200, so "raw" is already resample #1 — generalisation to
a real scanner is hypothesis, not measurement.

---

## The suite: 457 files, 14 genuinely red, none of them mine

`pytest tests/` has always aborted (a script-style file `sys.exit`s at import), so nobody has had a
whole-suite number. New `stress_test/run_all_suites.py` runs each file in its own process.

```
457 files   442 pass   15 fail   (8 python + 7 js; one is a runner artefact)
```

**All 15 reproduce identically at `455d4a7`** — verified in a separate worktree, then removed. Zero
regressions from anything this session did.

- **One shared cause found:** `test_accept_correction` / `test_page_count` / `test_recycle_bin` all
  die on `table documents has no column named logo_detail_hash` (migration 47). Those fixtures build
  a schema that skips the migration set — test rot, not a product defect, but three gates have been
  asserting nothing.
- **Two worth your eye:** `src/modules/api/test_v1_contract.js` **crashes** before completing (the
  gate on the frozen `/v1` contract), and `client/test_apiclient.js` fails a **no-leak** assertion —
  which is precisely what the de-pathing work exists to protect. Neither is evidence of a live leak;
  both may be stale like the family above. But a security-adjacent gate that does not run is
  indistinguishable from one that passes until someone looks.
- **I fixed none of them, deliberately** — blind test-repair at 2am is how a real regression gets
  papered over. A suggested order (cheapest and highest-value first) is in `pendingfeatures.md`.

Baseline artefact: `~/Desktop/TESTING/_measure/suite_results_20260810.json`. Compare against that
file, not against memory.

---

## Chris's re-run

<!-- CHRIS_SECTION -->

---

## Also landed tonight

- **`stress_test/probe_crop_recipes.py`** — reads one saved crop under every prep plus the
  binarisation variants, printing text NEXT TO confidence, because the finding is that the two are
  uncorrelated.
- **`scripts/seed-taught-state.js`** — grafts an install's taught state into a fresh sandbox DB
  (learning only: no documents, users or extractions, so the create-first-admin flow and empty queue
  survive). Two things learned the hard way and now commented: templates bind by
  `document_type_slug` not by id, and `templates.group_id` is a real foreign key.
- **`NIGHT_NOTES_2026-08-10.md`** — the working state, written to disk so a context compaction could
  not lose the measurements. Safe to delete once this handover is read.

---

## FIRST ACTIONS for the next session

1. **Read Chris's section above and triage it** — it is the only part of tonight aimed at the
   customer rather than the engine.
2. **Build the raw witness with C1–C4.** Fully specified; C1 is what makes it non-inert.
3. **Then, and only then, flip the two extraction flags together** (witness first, sepguard second).
   Neither has anything measured standing against it any more.
4. **The UI smoke list, five items** — still unseen, still needs you at the screen.
5. `deskew_on_import` is still `'true'` and still makes `teach_angle_compose_scan` unreachable.

## Needs the USER

- **The flip queue is four flags deep** and none can be validated without you:
  `template_identity_on_page` (Oracle-signed; **note it is already ON in any FRESH install** because
  it is in `PROVEN_ON_DEFAULTS` — your existing DB is the one that misses it),
  `code_separator_structure_guard` (flip WITH the witness, not before),
  `vat_eu_formats` (nothing measured against it), and `teach_typed_value_locate` (already default-on,
  never smoke-tested).
- **`tessdata_best` is worth 20 read-only minutes** but must not be shipped as a drop-in: swapping
  the model re-bases every confidence constant in the product (the 60 ladder floor, the 88 auto-file
  floor, `_CLEAN_DATE_CONF=94`).
- **The 14 red gates.** Which do you want repaired, and do you want them repaired or re-derived?

## Running processes at wrap

- Your own app, launched ~21:53 on the live DB (I never wrote to it).
- **Chris's sandbox on port 9223** with its own userData at
  `~/Desktop/TESTING/_chris2/userData`, output at `~/Desktop/TESTING/_chris2/Output`. Left running
  per the skill so you can poke it. The next `/christest` kills and rebuilds it.
- Last night's sandbox is preserved untouched at `~/Desktop/TESTING/_chris/` for comparison.
