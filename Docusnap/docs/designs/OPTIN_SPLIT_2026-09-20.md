# Auto-split-on-import → OPT-IN + page-1 separator-sheet trigger — BUILD-READY PLAN

Night run 2026-09-20. gary (design) → Oracle **SIGN OFF WITH CONDITIONS**. NOT built — for the owner's approval.
Supersedes the "first-10-pages probe" idea (pendingfeatures.md).

## Why
The auto-detect batch-separation pre-pass (`ocr/segmentation.py detect_segments`) renders+reads EVERY page
(150 DPI, no cap) — expensive on long scans — and a silently-wrong boundary in a long doc is hard for a customer
to spot. The graphical splitter shipped today (`b3cad58`) makes "land whole + let them split" a safe, cheap
recovery. So make auto-detect split OPT-IN (default OFF).

## The win (verified)
Setting `auto_separate_enabled='false'` nulls `templatesFile` → the pre-pass never spawns on BOTH import and watch
→ the primary behaviour needs NO new per-page code. Eliminates one of the two per-page passes a long scan pays
today (the other is extraction, F2) → ~halves import time on a long *scanned bundle* (directional; short/single
docs saw little pre-pass cost). **Page-1-only extraction is REJECTED** (F2: extraction reads fields beyond page 1
— totals on the last page, continuation; dropping it = silent field loss). Land whole, OCR all pages as today.

## Slice 1 — the flip + the safety hold (core)
1. **mig 193 — `INSERT OR IGNORE INTO settings VALUES('auto_separate_enabled','false')`** (NOT UPSERT — a
   de-escalation: untouched installs go OFF, an explicit 'true'/'false' the user set survives). No `@DEFAULT_FLIP`.
   ⚠ This turns bundle-splitting OFF for EXISTING users on upgrade too (they never seeded the key; mig-175 had
   given everyone watch-splitting). Intended opt-in, but say it out loud — it's a silent behaviour removal for
   users currently benefiting; defensible given the splitter recovery.
2. Flip the getSetting defaults 'true'→'false' at the THREE backend sites (`handler.js:3034`, `handler.js:3377`,
   and one more) **AND the renderer polarity (4th site, opposite sense): `settings/renderer.js` `loadAutoSeparate`
   `!== 'false'` → `=== 'true'`** (else the toggle shows ON while the backend does nothing — Oracle Q5).
3. **Unify watch:** `watch/handler.js:351` reads `watch_separate_enabled`; change to enter separation when
   `auto_separate_enabled==='true' || filing_slips_enabled==='true'`. Retire `watch_separate_enabled` in place
   (leave the row, stop reading it). **Remove or "DO NOT USE"-mark the dead `watch-separate-toggle` in Settings**
   (owner bad-toggle-hygiene rule). Re-point the two pins that encode the old contract
   (`test_watch_separate_default_on.js`, `test_migration137_test_switch_reset.js:56`) IN THE SAME COMMIT.
4. **⭐ Q2 — the MANDATORY auto-file hold (the ship-blocker Oracle caught).** With separation OFF, a graduated
   supplier auto-files the merged multipage bundle and it NEVER reaches Review → the "Split" chip never shows →
   silent wrong-file. So in `_maybeAutoFile`/`_handleFileMessage` (the existing `segmentHold`/`autoFileRun=false`
   pattern), HOLD a whole-landed multipage doc from auto-file when there is a positive second-document signal on a
   LATER page (`segmentation.is_document_start` / a different known supplier — computed from the ALREADY-extracted
   page text, F2, zero extra render), with reason "Multiple pages — may be more than one document; confirm or
   split." **Scope it** (don't blanket page_count>1 — that kills auto-file for legit 3-page invoices / the 34-page
   contract, violating max-auto-file). If signal-scoping is too much for slice 1, the fail-safe interim is a
   blanket multipage-auto-file hold (a held single multipage doc is a mild annoyance; a silently-filed bundle is a
   real wrong-file — fail toward review). Reason string mandatory either way.
5. **Review affordance:** on any `page_count>1` row, a calm "Multipage · N pages — may be several documents ·
   Split" chip → `openSplitWindowAt(docId)`; never a blocking alert. Reconcile with the older Chris "N pages —
   split?" / page-3-issuer nudges (they deferred to the pre-pass; now the chip is the primary surface — don't ship
   two nudges).
6. Settings label → "Automatically split multi-document scans" (+ helper: "Off = each scan is filed as one
   document; use Split in Review to separate it").

## Slice 1b — the page-1-sheet override (composition; the filing-slips path)
Oracle Q3: use the FILING-SLIPS path (reuse `slip_detect.py`), NOT a second page-0 QR probe. When
`filing_slips_enabled` is ON and a separator sheet is at page 0: instead of slips-only, ALSO run `detect_segments`
and COMPOSE via a new pure `compose_segments(n, seps, first_pages)` — sheets = hard boundaries (excluded);
subdivide each inter-sheet run at heuristic first-pages; emit the standard shape with `separator_pages` set and
`weak_pages` = the heuristic-derived cuts only. Additional between-doc sheets stay hard boundaries. Add `--auto-split`
to `buildSegmentArgs` so `detect_segments` runs only when auto-split on OR the page-1 override fires.
⚠ **Fix the mixed-exemption seam (Oracle §3 secondary):** `buildSplitPlan`/`segmentHoldPages`/`buildPairContext`
short-circuit on `separators>0` (whole file exempt). A composed file is BOTH sheet-bounded (exempt) AND internally
heuristic-cut (must be weak/held) — teach those three the mixed case, else the sub-cuts skip the mig-176/180 hold.
Surface the requirement in the Separator Sheets toggle copy ("drop a separator sheet on top of a stack to split
that scan"). "Does nothing on a slips-off/untaught install" is acceptable (gated behind a named toggle).

## Verification gate (before merge)
- **G1** M=0 byte-identical over the 605 corpus (RR_APP_ENV=1) with `auto_separate_enabled` forced ON.
- **G2** OFF-path census: a known multi-doc bundle lands as ONE doc (expected decision, not a regression).
- **G3 (load-bearing)** the Q2 auto-file-hold pin: a multi-doc bundle under a GRADUATED supplier, separation OFF →
  NOT auto-filed, lands needs_review with the reason. **Must FAIL on pre-fix code** (which auto-files it) — else
  G1/G2 green while the silent-file ships (the "green test that can't reproduce the bug" trap).
- **G4** migration DIRECTION pin (INSERT-OR-IGNORE, not UPSERT): no row → OFF; explicit 'true' survives ON; 'false'
  survives OFF.
- **G5** watch-retirement pin: `watch_separate_enabled` no longer read; watch follows `auto||slips`; the two old
  contract pins re-pointed in the same commit.
- **G6** speed delta on the real 34-page bundle (value confirmation).
- **G7** slice-1b mixed-plan pin: page-0 sheet + internal heuristic first-page → sheet cut STRONG/exempt, heuristic
  cut in weakIdx + held by 176/180 despite `separators>0`.

## Seam
Relies on: the graphical splitter as the recovery path (this feature is only safe because landing-whole is
reversible); `page_count` (mig 37) for the affordance. Disables (intended, inert-by-construction): the pre-pass +
its five safety switches (continuation-veto/title-slug/known-supplier + split_segment_hold/pair_hold) produce
nothing when off, byte-identical when on. Files: `handler.js` (separateFiles 2884-3057, import gate 3374-3403,
_maybeAutoFile/_handleFileMessage ~3131/3322), `split_plan.js`, `watch/handler.js` (341-366), `segment_docs.py`,
`ocr/segmentation.py` (557-640), `ocr/slip_detect.py`, `database/index.js`, `settings/renderer.js` (1547-1559),
`review/renderer.js` (2325, 9807-9817). Tests: `test_split_plan.js`, `test_watch_separation.js`,
`test_segmentation.py`, `test_slip_detect.py`, + the new G3/G4/G7 pins.
