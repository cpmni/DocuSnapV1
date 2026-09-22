# HANDOVER 2026-08-30 NIGHT — the re-slice WITNESS arc (autonomous session)

**Branch:** `feat/teach-side-overnight` · resumed from `0ff8b42` · **commits below are LOCAL, NOT pushed** (owner
reviews then pushes). **Uncommitted at wrap:** `CLAUDE.md` (this block) only — check `git status`. **Dev app:** was
RUNNING on the real DB at session start; NOT restarted by me (the new Settings rows + migration 94 load on the next
restart; the Python side is re-read per spawn, so the DARK switches are reachable only once their settings are
`true` — they are seeded `false`).

## TL;DR (read this even if nothing else)
1. **The owner-approved arc was built — but its two premises were FALSIFIED by measurement first, and the fix
   changed shape.** The product's ladder reads Nordwind 0023's taught total box as **`29,242.76` @90 — a
   format-VALID garble** (the prior session's `£9 32632.76` was a raw slice OCR, not the product read). And **DPI is
   not the lever** (pad 0 fails at 200/300/400/600); **vertical headroom is**. A re-read with padding degrades the 19
   clean zones under PSM 7 (wrong digits at conf 22-70), so a re-read can only ever be a **corroboration-gated
   WITNESS**, never a replacement read. The recipe that works: **R8 = pad 0.5×h, NO upscale, 20 px white border,
   PSM 6 `image_to_data`, in-band line pick → 20/20 exact incl. 0023 (@92), 0 wrong-valid.**
2. **Shipped, all DARK (mig 94 seeds OFF), Oracle SIGN-OFF-WITH-CONDITIONS C1-C14 all built + pinned:**
   `reslice_witness_sweep` (engine stage 4.7, totals only — produces the crop-side witness the signed recon demoter
   needs; commits nothing), `corrob_discount_invalid_witness` (currency-only record hygiene),
   `template_format_fail_yield_strict_money` (dark; **never flip in this arc** — seam with the sweep), and the
   **deskew retry dead-guard correction** (per-field "Read differently after straightening — was X, now Y — confirm
   once." — the retry's `_needs_review=True` held nothing because `autofile_gate_unify` is ON).
3. **Gate:** Nordwind OFF (new code) vs the pre-edit baseline = **0 diffs / 20**; ON = **0023's note released via
   `template_mapping_resliced` @92 (R8), value unchanged, 19 byte-identical**. Full realdoc four-arm A/B
   (off / sweep / discount / all) on the live-DB copy → `C:\Users\cmccu\.claude\jobs\a8d11584\tmp\runs\realdoc_*.md`
   — see "Verification state" for whether it finished and the numbers.
4. **Two findings for the owner:** (a) the deskew retry (`deskew_review_retry_enabled`, TRUE on your live DB) **never
   fires on a note-only hold** (it keys on engine `_needs_review` = required-empty OR field<70) and its 5/20 heals came
   from a sandbox whose ref/date were EMPTY — live it is mostly inert; (b) 0030's ref hold (`NRQ-2551` @70 xcheck
   note: three reads agree, one Stage-2 anchor-crop garble `NRO-2591` rejected) is the Oracle-B2-deferred REF
   crosscheck class — not this arc.

## Commits this session (NOT pushed)
| commit | what |
|---|---|
| `fccaf55` `feat(reslice): re-slice WITNESS sweep for noted totals (engine stage 4.7, DARK) + money-format record hygiene + deskew retry changed-field holds` | `extraction/reslice.py`, `engine._reslice_witness_sweep` + `_penny_reconciles` + `format_invalid_witness` + the record's `discounted` list (currency-only) + `_stage05_format_fails` strict leg (docstring fixed), `number_format.money_strict_shape/money_cents` (hoisted `_money_wellformed`), mapper `_read_geom` → `extract_with_mappings(read_geoms_out=)`, `anchor._read_lines_full` line dicts gain `words`; `process_docs._deskew_retry_changed_fields/_apply_holds`; pins `tests/test_reslice_witness.py`, `tests/test_money_strict_shape.py`, `tests/test_deskew_review_retry.py` 27/27 |
| `91ca11b` `feat(settings): bridge + expose the 2026-08-30 re-slice arc switches (mig 94 seeds OFF); role refusal scans discounted; docs` | Settings rows (dev-gated) + `_reconcileEnv` bridges + `test_settings_wiring.js` rows + mig 94; JS `trust._pageFamilyDisagrees` scans `disagree ∪ discounted` (+ pin; the OFF section of `test_role_disagreement_refuse.js` now states OFF explicitly after mig 93); dev-inspector shows discounted + the re-slice witness; docs (`extraction-pipeline.md`, `oracle_log.md`, design REVISED banner, `pendingfeatures.md`) |

Untracked, NOT mine, left alone: `x` (0 bytes, 24/08), `src/windows/shared/test_valueLocate.js` (20/08), the
`docs/*REVIEW*`/`docs/ELECTRON_41_UPGRADE_PLAN.md`/`scripts/remediate-*` files from earlier sessions.

**LIVE-TEST FIX (owner's first hands-on, ~20:15 → fixed + committed the same evening):** on a skewed statement the
raw date read `42-04-2025`, the straighten retry corrected it to `12-04-2025`, and the new changed-field hold offered
`Use "42-04-2025"` as a one-click button (corrected_to was set unconditionally — my C12 polish). Fix
`_put_back_offerable`: the put-back only offers a TYPE-PLAUSIBLE raw value (a parsing date on a date, strict money on
money; the useful inverse — new garbled, old valid — still offers the old); the note still names the raw value.
Pin 36/36. Python is re-read per spawn — no restart needed, a fresh Reprocess picks it up. The toggle itself was
CORRECT behaviour (the straightened date won); only the button was wrong. Owner rule logged from this:
**a toggle proven bad is removed or moved to a "DO NOT USE" SFDEV group** (memory `feedback_bad_toggle_hygiene`);
also queued: the double "— confirm once." note stacking on the manual-reprocess road (cosmetic).

## What was measured (the facts the design now rests on)
- **Faithful replay** (`tmp/_run_docs.js`: `buildTrainingArgs` + the handler env builders + `OCR_RENDER_DPI=200`
  against a `db.backup()` copy of the live DB, `--trace`): 0023 flow = mapping `29,242.76`@90 wins on curated
  authority over `keyword_override £2,363.76`@93 → `_reconciliation_pick_total` swaps to `2,363.76` (1,969.80 +
  393.96, penny-exact) with `RECON_TOTAL_ADJUSTED_NOTE` → `_demote_recon_total_corroborated_note` (ON live) needs a
  CROP-SIDE witness — only the garble exists → note stuck. Engine `_needs_review` False (a note never sets it);
  the JS `isAutoFileEligible` holds the doc on the note.
- **Stored-record census** (`tmp/_db_census.py` on the copy): 538 money records; 10 dissents: **8 format-invalid**
  (`C9,262.76` ×4, `£2.205.60` ×3, `£0/2.0U` — older vintages of the same zones), 2 valid-garble (`29,242.76`, the
  current 0023). Money records are otherwise honest (`£`/commas fold via `_EDGE_RE`) → no money fold needed.
  13 noted total/ref/date rows in the whole DB, only 2 live (0023's total; one "Read again at your request").
- **Pad/prep probe on the product read path** (`tmp/_pad_probe.py`, `tmp/_ladder_probe.py`; `_read_lines_full`,
  the engine frame): pad 0 = 19/20 for every prep, 0023 wrong for every prep; vertical pad + PSM 7 = 15/20 with
  wrong digits; **R8/R7 (PSM 6 + in-band pick) = 20/20, 0 wrong-valid, 0 empty.**

## Oracle's conditions (all built; `docs/oracle_log.md` 2026-08-30 EVENING)
C1 trigger = `RECON_TOTAL_ADJUSTED_NOTE` exactly (closes the class-C seam) · C2 `_penny_reconciles` needs the tax
READ · C3 exactly one amount on the picked line (rejoin-first for OCR splits) · C4 the amount's own word confidence
(min with the line mean) · C5 PASS-2 pin (subtotal note survives) · C6 `prep` non-scaling + 0-based page index pins ·
C7 discount routes CURRENCY only (date leg pinned, unrouted) · C8 JS `_pageFamilyDisagrees` scans
`disagree ∪ discounted` · C9 dev-inspector shows `discounted` + the re-slice witness · C10 strict-money seam pin ·
C11 **flip order: sweep → discount → never strict-money in this arc** · C12 an emptied field is a change (stub row +
`corrected_to`) · C13 the retry charter is FIELD-level (same-value lift files normally) · C14 apply-before-adopt
source pin. **Not review-bound** (Oracle: the demoter's signed posture carries; the census is the flip bar).

## Verification state — honest
- Pins green: `test_money_strict_shape.py`, `test_reslice_witness.py`, `test_deskew_review_retry.py` 27/27, and
  every affected existing pin (corroboration_emit 26, corrob_date_fold, corrob_note_resolve 51, recon_note_demote 34,
  xcheck_corrob_demote 27, reconciliation_pick, candidate_resolver, stage05_format_yield, money_snap_proof 17/17,
  template_mapper*, pad_window_code, raw_crop_witness, anchor_line_select, struct_code_read, number_format,
  registration_arbiter, inline_harvest, abs_edge_guard, edge_cut_relocate, snap_union_witness, name_edge_grow,
  reg_arbiter_anchor_evidence, inline_row_overlap); JS `test_role_disagreement_refuse.js` ALL PASS (its OFF section
  needed an explicit OFF after mig 93 — fixed in the test); `test_settings_wiring.js` three new bridges OK.
- **Full Python suite (`tmp/_suite.ps1`): 294 pass / 9 fail — ALL 9 reproduce with IDENTICAL failure signatures on
  the pre-session commit `0ff8b42` (checked in a throwaway worktree):** `test_identity_fusion` (known),
  `test_anchor_crop_crosscheck` (3), `test_buyer_issued_issuer_guard` (1), `test_deskew_raw_crops` (1),
  `test_engine_detail_thread` (1), `test_label_overrides` (2), `test_network_field_authority`,
  `test_reprocess_manifest`, `test_template_rescue` (1). None are this session's.
- **Full JS suite (Electron-as-Node, 288 files): 268 pass / 20 fail — ALL 20 reproduce with IDENTICAL signatures on
  `0ff8b42`** (worktree + a `node_modules` junction): the four known (`test_authoritative_anchor`, `test_v1_contract`,
  `test_doctype_surface_parity`, `test_teach_multipage`) + the stamp-* wiring red + fifteen that look like the
  **mig-93 default flip** (fresh in-memory DBs now seed every switch ON, so "OFF (default)" sections fail:
  `test_company_key_own_scope`, `test_learning_excluded_readers`, `test_put_back_hold`, `test_rewrite_marker_exclusion`,
  `test_quiet_lane_first_fill_reliability`, `test_quiet_lane_layout`, `test_quiet_lane_ready_templated`,
  `test_reprocess_holds_as_lane`, `test_reviewservice`, `test_type_ambiguity_ripple`, `test_activity_strip`,
  `test_issuer_clear_not_a_correction`) + three crashes (`test_document_types_aliases`, `test_workflow_ipc`,
  `test_workflow_snapshot`). **Not this session's — but a tidy-up arc for the owner:** the same one-line fix I applied
  to `test_role_disagreement_refuse.js` (state the OFF arm explicitly after `runMigrations`) probably clears most.
- **Pre-existing red, NOT mine:** `test_settings_wiring.js` MISSING `stamp-section, stamp-preview-box, stamp-preview,
  stamp-msg, stamp-size, stamp-size-val, stamp-save, stamp-reset` — HEAD's renderer.js addresses them, HEAD's
  index.html lacks them (the 08-28 stamping move).
- Nordwind: OFF (new code) vs pre-edit baseline **0/20 diffs** (`tmp/_diff_runs.js`); ON (sweep + discount, strict
  off): **1 doc changed = 0023, note released, value unchanged**; `census_on2/reslice_census.jsonl` = 19 declines
  `no_note` + 1 witness; `recon_demote_census.jsonl` = 1 demote by `template_mapping_resliced`.
- **Full realdoc four-arm A/B:** launched via `tmp/_realdoc_ab.ps1` (off / sweep / discount / all; `RR_APP_ENV=1`,
  `OCR_RENDER_DPI=200`, per-arm `RR_DUMP` + `RR_CONSENSUS` + census dirs; the `.cmd` twin broke on a cmd.exe
  `rem`+`|` quirk — use the `.ps1`). Reports → `tmp/runs/realdoc_<arm>.md`. **Corpus = ONE representative per
  PAPER via `RR_IDS` (owner, 18:45: "most of these docs are dupes" — measured: 1,940 confirmed files with a file =
  618 byte-identical-distinct = 605 distinct (type, supplier, ref, date); only 32 filenames repeat — the rest are
  the same document re-imported under other names). `tmp/_dedup_ids.py` → `tmp/runs/rr_ids_dedup.txt` (605 ids,
  highest id per paper; a doc with an empty ref/date is never collapsed). The first 1,940-doc run was killed at 30 %.**
  **Gate = M unchanged vs OFF (no NEW wrong would-file), 0 per-field accuracy drop, 0 fill drop, ≥1 sweep fire,
  released-and-wrong = 0.** If a report is absent when you read this, the run was still going at wrap — read them
  before any flip.
  **OFF arm (baseline, every switch '0'; 605 papers, 200 DPI, app env mirrored): type 605/605 · supplier 603/605
  (99.7 %) · ref 603/605 (99.7 %) · date 598/605 (98.8 %) · total 108/108; 570/605 would auto-file; regressions 11
  (9 SILENT); M = 7 wrong would-files (#364 date — GT is the poisoned `26-01-9687`; #331 supplier; #953 date; #1092
  supplier — GT is the poisoned `Ticket Type`; #1423 date `26-01-1792`; #1453 date; #1649 date — the known
  leading/garbled-digit date class); M_type 0. Pre-existing — the switch arms are judged against THIS.**
  **SWEEP arm (`RESLICE_WITNESS_SWEEP=1` alone) — GATE PASSED:** accuracy identical on every field, regressions
  identical (11 / 9 silent), **M = 7 unchanged**, M_type 0, fill-rate diffs none; reslice census = 110 declines
  (`no_note`) + **1 witness** (doc 1840 = the live 0023: `£2,363.76` @92 R8); recon demotes 1 (by the resliced witness;
  OFF had 1 DECLINED for lack of a witness); total-field `+corrob_clear` 0 → 1; **would-file 570 → 571 (gained
  #1840, lost 0)**; released-and-wrong = 0. Summary tool: `tmp/_ab_summary.js`.
  **DISCOUNT arm (`CORROB_DISCOUNT_INVALID_WITNESS=1` alone) — GATE PASSED, INERT on this corpus:** the report is
  BYTE-IDENTICAL to OFF (0 line diffs; would-file 570, M 7, fill none, 0 flips). Record-only by design, and today's
  reader no longer produces the format-invalid class on these zones (the 8 measured dissents in the stored DB are
  older-vintage reads) — so the switch has no live target until a future garble; it is safe, not useful yet. The
  harness does not persist the corroboration record, so fire counts are not instrumented here (the dev-inspector
  shows `∅ discounted` per doc).
  **ALL-ON arm (sweep + discount; strict-money never) — GATE PASSED:** report BYTE-IDENTICAL to the sweep arm (0 line
  diffs): accuracy + fill identical to OFF, M = 7 unchanged, M_type 0, would-file 571 (gained #1840, lost 0), 1 witness
  fire, 0 wrong releases. **The Oracle gate is MET for `reslice_witness_sweep` and `corrob_discount_invalid_witness`
  (each alone AND together) on one-per-paper × 605 at the product's 200 DPI with the app env mirrored.** Reports +
  dumps + census: `tmp/runs/realdoc_{off,sweep,discount,all}.md`, `realdoc_<arm>_dump.jsonl`,
  `realdoc_<arm>_consensus.jsonl`, `census_realdoc_<arm>/`. Owner decision: flip sweep, then discount (Settings →
  Processing dev rows); strict-money stays OFF (C11).
- NOT verified: the ON arm on any corpus other than Nordwind + the owner's confirmed docs (the realdoc run); the
  discount on a NON-Nordwind money template; strict-money is deliberately unmeasured (dark by ruling).

## OWNER CONVENTIONS ADDED TONIGHT (late)
- **Deduped test corpus BUILT: `Desktop\ScanFinder Test Corpus\`** (605 papers — one per (type, supplier, ref, date) —
  as `<type>/doc<id>_<name>.pdf`, + `ground_truth.json` (confirmed values) + `rr_ids.txt` (for `RR_IDS`) + README;
  54 MB; builder `TESTING/_measure/reslice_20260830/_build_test_corpus.py`). **Standing rule: test runs use ONE
  version of each doc — never the duplicate-heavy raw folders; regenerate after a big import; never confirm/teach
  from it into the live app.**
- **`NIGHT_RUN.md` (repo root)** = the overnight test/check QUEUE + DONE ledger. Add anything worth testing or checking
  as you notice it; at the end of every night run move the work to DONE with its result + a "repeat only if"; never
  repeat DONE work unless that condition holds. Seeded tonight (the baseline M=7 date class is #1).
- **"Going to bed" = start the newest `docs/designs/NIGHT_RUN_*.md` prompt at once**, no confirmation (memory
  `feedback_going_to_bed_starts_night_run`).

## FIRST ACTIONS for the next session / owner
1. Read `tmp/runs/realdoc_*.md` (or re-run `tmp/_realdoc_ab.cmd`, ~30-40 min/arm). Flip order if green: Settings →
   Processing (dev switches) **"Re-read a taught total box when its reading doesn't add up"** first, then **"Don't
   count an unreadable amount or date as a disagreement"**; leave the strict-amount row OFF (Oracle C11).
2. RESTART the app (mig 94 + the three rows + the dev-inspector lines).
3. Reprocess Nordwind 0023 with the sweep on → the total's "please verify" note releases; the inspector shows
   `↻ re-slice witness R8` on the FINAL node.
4. Owner decisions queued in `pendingfeatures.md` (2026-08-30 EVENING block): refs/dates slice 2 (trigger = the
   zone's own read ABSENT/format-invalid; ref xcheck demoter is Oracle-B2-deferred); R8-as-primary money read
   (census first — Oracle NO for now); the deskew retry's note-only-hold trigger gap; the total-swap class.
5. **OWNER-QUEUED NEXT ARC (20:40): the ADVERSARIAL TEST CORPUS — THE NIGHT-RUN PROMPT IS WRITTEN:
   `docs/designs/NIGHT_RUN_2026-08-31_ADVERSARIAL_CORPUS.md` (paste the block between its `=== PROMPT ===` markers into a
   fresh session: build `gen_hard_set.py` → score cold/warm → advisor class cards → `/christest` on the scan set →
   handover; fixes only DARK + Oracle + realdoc-605 gated).** Design notes in `pendingfeatures.md` 2026-08-30 NIGHT block:
   extend `stress_test/gen_demo_digital.py` with a rasterised twin per archetype (200 + 150 DPI, skew, noise, fade)
   and ten ranked classes (multi-column money rows first, then in-table totals, 8-9 pt print, leading-digit dates,
   buyer-larger two-column addresses, continental numbers on rasters, same-logo siblings, degraded scans,
   multi-page, credit-note signs). Score cold + warm; every silent-wrong becomes an advisor→Oracle class card.
   Rationale: the 99.7 % is measured on one corpus shape; the baseline M = 7 (1.2 %) is the leading-digit date
   class — the biggest remaining extraction risk, untouched by tonight's arc.

## Traps found this session
- The `!= '0'` idiom: a harness OFF arm must set `'0'`, never `''` (again).
- `money_strict_shape` accepts a space-split the respacing cleaners can REJOIN (`£9 242 76` → `£9,242.76`) — by the
  shipped cleaners' contract, pinned as a known non-discount.
- `anchor._read_lines_full` line dicts now carry `words:[(text,conf)]` — additive; consumers read named keys.
- The mapper's `_read_geom` is a `_`-key popped INSIDE `extract_with_mappings` — never on a returned dict (22 direct
  `_extract_one` pins stay byte-identical).
- `git show HEAD:<path>` needs the `Docusnap/` prefix (the repo root is `C:\GIT Projects`).
- **NEVER round-trip a repo file through PS 5.1 `Get-Content -Raw` → `Set-Content`**: it reads UTF-8-no-BOM as ANSI
  and re-saves mojibake (`—` → `â€”`) — it corrupted NIGHT_RUN.md once tonight (caught, restored from the prior
  commit, re-applied with the Edit tool, amended). Use the Edit/Write tools for file content; PowerShell only for
  ASCII-safe generated text.
- `buildTrainingArgs(db, configPathFn)` takes a FUNCTION for the config path and returns `{args, tempFiles}`.
- `H._ocrDpiEnv` is not exported — replicate (`ocr_dpi` setting, 300 ⇒ unset).

## Key paths
- **DURABLE COPY of everything measured: `TESTING/_measure/reslice_20260830/`** (untracked, as usual) — the harness
  scripts (`_run_docs.js` faithful replay · `_diff_runs.js` · `_trace_field.js` · `_dedup_ids.py` / `_dupe_census.py` ·
  `_db_census.py` · `_pad_probe.py` / `_ladder_probe.py` / `_zone_probe.py` · `_realdoc_ab.ps1` · `_ab_summary.js` ·
  `_suite.ps1` · `_backup_live.js`), `runs/realdoc_{off,sweep,discount,all}.md` + dumps + consensus + census dirs,
  `runs/rr_ids_dedup.txt` (the 605 ids), the Nordwind `*_summary.json` arms, the suite results.
- Live DB copy (db.backup, ~17:10): `C:\Users\cmccu\.claude\jobs\a8d11584\tmp\live_20260830_evening.db` (2029
  confirmed, mig 93) — NOT copied (private data; re-make with `_backup_live.js`). The job tmp dir is deleted with
  the job.
- Nordwind docs: `C:\Users\cmccu\Desktop\Demo Docs\Other\IMPORT\Nordwind-*.pdf`.
- Design: `docs/designs/CORROB_RESLICE_SWEEP_2026-08-30.md` (REVISED banner at top); doc section:
  `docs/extraction-pipeline.md` "2026-08-30 — Re-slice WITNESS sweep"; Oracle: `docs/oracle_log.md`.
- Run a Python pin: `cd python_backend && py -3.12 tests/<t>.py`; JS: `ELECTRON_RUN_AS_NODE=1
  node_modules/.bin/electron database/modules/test_role_disagreement_refuse.js`. `git commit -F <file>` ONLY.
