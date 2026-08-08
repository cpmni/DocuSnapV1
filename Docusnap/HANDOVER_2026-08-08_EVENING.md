# HANDOVER — 2026-08-08 (evening, owner present) — Oracle ×2 · SEC-17 fail-open FIXED · teach label pick · two live pattern defects · two owner decisions shipped · Pelican `customer_name` diagnosed

**Branch** `feat/reprocess-throughput-autostraighten` · **11 commits, ALL PUSHED** · working tree
clean apart from the owner's own long-standing uncommitted edit to
`python_backend/tests/test_template_target_word_snap.py` (untouched all session).

Continues `HANDOVER_2026-08-08_DAY.md`. That file's FIRST ACTIONS list is now fully worked:
Oracle on SEC-17 (done, and it found a live hole), the landmark/multi-page question (answered at
source, no probe needed), and three of the four owner decisions.

> **FILENAME NOTE.** `HANDOVER_2026-08-08.md` is a MISDATED older file (last modified 2026-08-05)
> and `HANDOVER_2026-08-08_DAY.md` is the earlier half of today. **This file is `_EVENING` and is
> the newest.**

---

## TL;DR

| commit | what |
|---|---|
| `b4f9ff2` | backlog: the page-2 landmark question ANSWERED at source (no probe needed) |
| `2fc0260` | backlog: corrected my own "not once read by a template rung" absolute; re-scoped audit item 3 |
| `917a009` | **SEC-17 B1 — a live FAIL-OPEN in the shipped security fix. Oracle found it; fixed + pinned** |
| `1eb96fb` | **teach picks the anchor label by SCORE, not arrival order** (the shared module's own "C5" gap) |
| `991b140` | docs: Oracle on SEC-17 + the gary/reggie data-type design; 3 of my claims corrected |
| `c15f679` | **IBAN rejected every printed IBAN; the IPv6 leg matched clock times** — two live defects |
| `b41cad6` | teach T1/T2 — Oracle's conditions on the label pick |
| `3dc162c` | **`delivery_number` → `reference_code`** (owner decision; migration 59) |
| `2a85838` | **`ocr_type` retired from the UI** (owner decision) |
| `117d78b` | docs: Oracle SEND BACK on the data-type widening; struck a false claim I had written |
| `d0ef6a2` | docs: **Pelican `customer_name` wrong on 66 of 72 — diagnosed** |

**Nothing new was flipped.** Two things ship LIVE-ON and both are corrections to already-live
behaviour (`SF_REALPATH_CONTAINMENT`, and the two config patterns). The owner said they will do the
flipping when the current arc is finished.

---

## 1. SEC-17 — Oracle pass found a live fail-open IN THE SHIPPED FIX (`917a009`)

**Verdict: SIGN OFF WITH CONDITIONS, 3 BLOCKING. Ruling on ON/OFF: LEAVE IT ON** (OFF is strictly
worse). **Severity DOWNGRADED to LOW** — both IPCs are fire-and-forget with no data returning to the
renderer, all doors are admin/edit gated, `ALLOWED_OPEN_EXTS` excludes executables, and the attacker
needs write access inside an approved root already.

- **B1 — FIXED.** `_realCanonical` returned the RAW path on ENOENT while `_withinAnyRoot`
  canonicalises the ROOT: two frames, one comparison. A MISSING leaf under a junction
  (`Output\peek\nope.pdf`) still passed — the exact hole SEC-17 exists to close. The shipped
  comment's defence ("openPath would fail anyway") holds for `open-file` but NOT for
  `show-in-explorer`, which reveals the CONTAINING directory. Fixed by walking up to the nearest
  existing ancestor, canonicalising that, re-appending the tail.
- **B2 — FIXED.** The pin's FAIL-CLOSED line asserted the OPPOSITE of its own label, and the
  `return null` unverifiable branch was ENTIRELY unpinned. Both fixed, plus a pin recording that
  case-insensitivity SURVIVES the kill switch (so OFF is documented as *not* a full revert).
- **20 pins green, ZERO skips.** The non-vacuity line proves the pre-fix code accepted the bypass.

**STILL OPEN — B3 is BLOCKING for release and needs the owner.** The refusal is SILENT: both
channels are `ipcMain.on`, so an unverifiable path gives no dialog, no toast, only a `logger.warn`.
Suspected trigger is a dehydrated OneDrive placeholder while offline. **Discharge by EITHER a
distinct visible refusal OR a measurement that the OneDrive case cannot reach it — a measurement
discharges it, an assumption does not.** Note the one existing message is also WRONG for that case
("outside the app's allowed folders" when the truth is "we could not verify where this file lives").

**THE SEAM, and it means containment is NOT total today (C5).** `_isOpenablePath` has TWO admission
doors; SEC-17 hardened door 1 only. A document filed through a junction — via the still-textual
write containment at `filing/handler.js:172` — has the escaped path recorded in
`documents.stored_path`, and door 2 matches `stored_path` TEXTUALLY and allows the open. Same
failure mode as `registration.is_unfalsifiable` / the Castellan incident.

C4 (shared `src/lib/pathContainment.js`; the filing WRITE side behind its own flag because a false
refusal there BLOCKS CONFIRM), C6 (retire the three legacy raw-path channels — doc-id variants
already exist, which deletes the surface instead of guarding it), C7, C8, and a `navGuard.js` prefix
trap are all in **`SECURITY_BACKLOG.md` (GITIGNORED — local only)**.

**Oracle's manual gate has NOT been run:** `mklink /J C:\<OutputRoot>\peek C:\Users\<you>\Documents`
then trigger `show-in-explorer` on `C:\<OutputRoot>\peek\nope.pdf` (a leaf that does NOT exist).

## 2. Teach wizard — label picked by SCORE, not arrival order (`1eb96fb`, `b41cad6`)

Audit item 3, and the first half of the owner's "finish the teach anchor/value detection".
`autoLabel` read the LEFT band and returned on the first non-empty label, so a garbled left strip
beat a clean caption above. The Review ⊕ tool fixed exactly this on 2026-07-11 with the shared,
Oracle-signed, pinned `AnchorLabel.pickLabelCandidate` — and that module's own comment recorded that
teach did not share it ("pre-existing gap, C5"). Teach now calls the same function; no new judgement
was introduced. Both bands read CONCURRENTLY, so the extra read costs one round-trip, not two.

**Oracle GRANTED default ON**, having first gone looking for the regression that would have made it
wrong (a both-suspicious pick downgrading a garbled label into a phantom anchor) and REFUTED it at
source. He then found a smaller real one:
- **T1 (fixed)** — when the picker scored both sides 0 I fell through to the synthetic
  0.12-page strip, where the OLD code stored the tight caption box it had actually located. Worse
  geometry for the stored offset and relocation. Now the located box is kept.
- **T2 (fixed)** — the shared module's "teach does NOT share this picker" comment became false the
  moment teach called it. Corrected, and it now points at the teach pin.

**27 pins green.** `TEACH_LABEL_PICK=false` restores the sequential early return, byte-identical.

**Scope honesty:** all 11 phantom-anchor mappings on this install are `supplier_name`, and template
rungs win `supplier_name` only ~15 times in ~731 reads. This is a FORWARD fix for every future
teach, not a live drag.

## 3. Two LIVE validation defects, shipped separately and first (`c15f679`)

Both found by reggie while reviewing the data-type widening; both Oracle SIGN OFF; neither is part
of that widening.

- **IBAN rejected every conventionally-printed IBAN.** `GB29 NWBK 6016 1331 9268 19` failed. Two
  surfaces openly disagreed about the same correct value: `trust.js:169` strips whitespace before
  its mod-97 check and ACCEPTED it, while the Review on-blur scored 0% coverage and WARNED.
- **The `ip_address` IPv6 leg was wrong in BOTH directions.** It ACCEPTED `09:30:15` — a clock time
  — and `ip_address ∈ _PRECISE_VAL_TYPES`, so a high-coverage match is graded TYPE-AUTHORITATIVE and
  skips the charset and learned-shape checks. It REJECTED `fe80::1`, the example the UI itself
  prints.

**The new JS pin caught a gap in my own IPv6 fix**, which is the argument for it existing:
`2001:db8::8a2e:370:7334` matched only its PREFIX, which `re.search` reports as a match (so the
Python assertion passed) while the renderer's coverage rule correctly scores a partial. The Python
pin now asserts WHOLE-VALUE coverage, not search truthiness.

## 4. Owner decisions shipped

- **`delivery_number` → `reference_code`** (`3dc162c`, migration 59 — **CONFIRMED APPLIED** on the
  owner's restart: *"migration 59: retyped 1 delivery_number field(s) text -> reference_code"*).
  Measured first: of 126 distinct values, **exactly ONE has no digit** — `'Delivery'`, 5 occurrences,
  the bug itself. **Extraction deliberately does NOT move** — the shipped
  `field_patterns.delivery_number` entry keeps `validation: alphanumeric`, and
  `_seed_field_patterns` skips keys already in the config, so Stage 0.5/2 `val_type` is unchanged.
  Only the TYPE-keyed gate at the FILING boundary moves. **Pinned, deliberately, that the Stage-1
  validation stays `alphanumeric`**: tightening it to `reference_code` too WOULD change extraction,
  because that pattern is anchored and `_clean_value` has no extraction leg for it, so
  `"No. DN-98447"` would be dropped rather than cleaned.
- **`ocr_type` RETIRED from the UI** (`2a85838`). Written by three surfaces with three vocabularies,
  read by ZERO production code. The DB COLUMN STAYS (defaulted) — dropping it is a destructive
  migration for no benefit. The one real consumer, the dev CLI `test_mapping.py`, was REPOINTED to
  the field's real declared type rather than orphaned.

## 5. Stage-1 data-type coverage — DESIGNED, then SENT BACK. **Do not build it as specified.**

This is the owner's headline ask ("all data types, not a subset · custom == built-in · keywords
100%"). gary + reggie designed it; **Oracle SENT IT BACK**, and all three of his ship-blockers live
BETWEEN the two advisors rather than inside either.

**The defect is real and verified:** `seed_field_labels` (`keyword.py:342-364`) seeds only key-role
`date`, key-role `alphanumeric`, and key-role None with DB type EXACTLY `'text'`. Key-role `currency`
and every non-`text` DB type fall through and are never attempted (`keyword.py:942-945` skips any
field with no pattern entry). **And `doctype-editor.js:77-79` `guessType` AUTO-SELECTS
`currency`/`reference` from the label**, so a user typing "Unit Price" or "Account" is GIVEN an
unattemptable type without opening the dropdown.

**BLOCKING conditions B1–B6 and gate additions G2/G6 are recorded in `pendingfeatures.md`.** The
headline ones:
- **B2 (already applied to the doc)** — I had written that `trust.js` `STRICT_TYPES` is the
  fail-toward-review rail. **It is not.** It checks FORM; the failure is a well-FORMED value from the
  WRONG PARTY, so it passes; and a strict-typed field `continue`s at `trust.js:567` and never reaches
  the cold-scope `unverifiable-value` block. **reggie's Rule C1 is the only rail.**
- **B4** — close the incumbent seam BY CONSTRUCTION, not by measuring: a seeded 80 read displaces a
  capped-and-noted anchor read AND the note goes with it (the loser is discarded whole at
  `engine.py:5793`), removing a human checkpoint.
- **G2** — the generator must plant a capped-and-noted anchor, or that seam counter is 0 on both
  arms whatever the code does.

**Three of MY claims were corrected during this design** — do not re-derive them wrongly: the
"Discount typed Percentage" example is WRONG (`discount` is a shipped key and is rescued; use
`unit_price`/`account`); this is NOT as latent as filed, because `guessType` steers users into it;
and my cited lines for the currency sign loss were STALE (it is `keyword.py:1509` plus
`_clean_value` at `:1768-1772`, where no currency alternative admits a sign at all).

---

## 6. OWNER-REPORTED, DIAGNOSED — Pelican `customer_name` wrong on 66 of 72 (`d0ef6a2`)

The owner ran the SFDEV debug table over the live queue and marked the bad cells
(`Debug/debug_table/debug_values.json`, 17:08Z, 72 docs), asking whether it is "a wider detection
issue with freetext fields". **Right about the layer, wrong about the instrument — and the
difference matters, because the obvious fix heals 1 of 66.**

**Two classes, ONE mis-sized taught box** (template 33, taught 2026-08-07 21:10,
`confirmed_count=1`, and **no `corrections` rows exist for the scope**):
- **TRUNCATION** — `'Bramblewood Joinery Lt'` ×49, `'…Joinery L'` ×9, `'…Joinery Ltc'` ×2. Target
  `tw=0.1627` ends FLUSH with the final glyph — zero right margin — so per-scan drift shears the
  `d`. The SAME box reads correctly on 24 docs at conf 95, which is what proves it MARGINAL.
- **WRONG ROW** — `'Unit 4, Sawpit Lane'` ×10 + 2 variants. Target `th=0.0151` against anchor
  `ah=0.0068` ≈ **2.2 line-heights**, so it spans the name and address rows.

**Why nothing caught it — the reusable finding.** `template_target_word_snap` and
`template_abs_edge_guard` are BOTH ON in the live settings and the template was taught AFTER both
shipped. They did not fire because **both deliberately EXCLUDE names** (`template_mapper.py:308-309`:
*"NAMES excluded v1 — NAME_UNCLIP_RECONCILE owns that class"*). So every shipped clip-repair
mechanism is scoped away from names, and the one that owns names is **DEFAULT OFF and never
flipped**. The clipped value commits at **95** (above the 88 critical floor) and beats a CORRECT
`keyword_override` read of `Bramblewood Joinery Ltd` sitting at **83**.

**THE OBVIOUS FIX IS THE WRONG ONE — measured before proposing.** `TEMPLATE_FREETEXT_GUARD_PARITY`
is what makes the name-quality guard reachable for this free-text field, but the guard rejects only
`name_quality < 0.5` and these score `Lt` **0.67**, `L` **0.67**, `Ltc` **0.67**, `Unit 4, Sawpit
Lane` **0.75** — all PASS. Only `'Srambdlewood Joinery L'` (0.33) is rejected. **It would heal 1 of
66.** The values are name-SHAPED; they are merely clipped.

> **CORRECTION TO MY OWN EARLIER MEASUREMENT.** I recorded the free-text template-rung population as
> "~1 read in 24 docs" and called the guard-parity slice NEAR-INERT on REACHABILITY grounds. The
> reachability half is badly wrong: it is **93 of 99** on documents 738+. The "near-inert"
> conclusion survives for a COMPLETELY DIFFERENT REASON — the values score above the guard's
> threshold. Quote the yield figure, never the reachability figure.

### The NAME_UNCLIP arm — built and RUNNING at handover time

`stress_test/name_unclip_ab.js` (new, read-only: temp copies of the working files, no DB writes,
live DB opened readonly, and `liveEnv` mirrors the install's REAL switch state so arm A is the
owner's actual behaviour rather than a default). Two arms over EVERY non-deleted Pelican document:
**A** = baseline, **B** = `NAME_UNCLIP_RECONCILE=1`.

Ground truth is `Bramblewood Joinery Ltd`, and it is justified rather than assumed: every Pelican
delivery note is addressed to the same customer (the only distinct values across the batch are
Bramblewood spellings plus that company's own address line), 24 documents already read it exactly,
`keyword_override` reads it independently, and the owner marked every other value WRONG.

**THE NUMBER THAT DECIDES THE FLIP IS NOT THE HEAL COUNT — IT IS `REGRESSED`.** The ~24 documents
whose taught box currently reads correctly must not move. `NAME_UNCLIP_RECONCILE` is the first
sanctioned post-merge rewrite of a Stage-0.5 winner, so a single regression should stop the flip.
Collateral on `delivery_number` / `delivery_date` / `supplier_name` must also be 0.

**It is NOT expected to touch the ~12 wrong-ROW cells** (`'Unit 4, Sawpit Lane'`) — those are a box
HEIGHT defect, not a clip, so a partial heal is the designed outcome and must not read as a failure.

**Condition C1 (keyword AND crop witnesses, token-identical) is the one that cannot be checked by
inspection** and is the reason this arm exists. C3 (winner remnant page-ABSENT — the page prints
`Ltd`, never `Lt`) and C5 (name-quality no worse — 1.0 vs 0.67) both hold on inspection.

> **STATUS AT HANDOVER: the arm was still running.** ~100 documents × 2 arms of full OCR takes
> tens of minutes. **Re-run it rather than trusting any partial reading** — and note the harness is
> piped through `Out-String` in the launch command, which BUFFERS all output until the process
> exits, so an empty log means "still running", not "no output".
>
> ```
> ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/name_unclip_ab.js
> ```
>
> **The owner has said they will do the flipping once this arc is finished — so report the numbers,
> do not flip.**

---

## Key facts / paths / gotchas

- **Live DB** `%APPDATA%\ScanFinder\docusnap.db`. The Pelican batch has grown well past the 722 docs
  the DAY handover recorded — documents now run to ~#836.
- **`SECURITY_BACKLOG.md` is GITIGNORED** — SEC-17…SEC-22 and all of Oracle's C-conditions exist
  only on this machine. `pendingfeatures.md` holds the only tracked pointer.
- JS tests via Electron-as-Node:
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <file>`. Pure-static pins
  (`test_settings_wiring`, `test_teach_multipage`, `test_teach_label_pick`, `test_ocr_type_retired`,
  `test_validation_pattern_surfaces`) run under plain `node`.
- **The Python suite CANNOT be run with a bare `pytest tests/`** — it mixes pytest-style and
  script-style files, and a script-style one `sys.exit`s at import, which aborts collection with an
  INTERNALERROR. Run script-style files directly with `py -3.12 tests/<f>.py`.
- **Four pre-existing Python failures, verified identical with this session's files stashed:**
  `test_network_field_authority` (a harness signature mismatch — `unexpected keyword argument
  'trace'`; its IP/MAC assertions pass), `test_label_overrides` (2), `test_anchor_crop_crosscheck`
  (3). Do not attribute these to the session's changes.
- `git commit -F <file>`; **never** a PowerShell here-string, and `<<'EOF'` is a PS parse error.
- PS 5.1 mojibakes UTF-8 on write — use a Python script for text surgery on `.md` files.
- A **new harness** `stress_test/name_unclip_ab.js` was added this session (read-only, temp copies,
  mirrors the live switch state via `liveEnv`). Piping it through `Out-String` BUFFERS all output
  until the process exits — do not read the log expecting progress.
