# HANDOVER — 2026-08-11 EVENING (owner live-testing session, continuous with DAY 2)

**Branch** `feat/teach-side-overnight` · HEAD **`1edfb7c`** · ALL PUSHED, tree clean.
**Read `HANDOVER_2026-08-11_DAY2.md` first** — the morning half (corroboration record, template-
scoped labels, LIST type, Chris fixes, young-identity). This file is the afternoon/evening: the
owner tested live and drove ~15 fix commits. **`OWNER_TEST_SCRIPT_2026-08-11.md` is partly stale
now** — the teach-wizard sections describe the pre-rework flow.

## PICK UP FIRST — the dock (the one thing left broken-then-reverted)
**✓ RESOLVED 2026-08-11 late evening — `5391c52`, PUSHED, LIVE-SMOKED.** The 5th attempt below was
built exactly as designed plus two hardenings: (c) a drain-time failsafe (a hidden live child MUST
have a chip — re-adds if anything removed it, so the 4th's "no way back" state self-heals) and
(d) the restore IPC undocks deterministically after show() instead of waiting for event timing.
Smoked on a sandboxed instance (CDP-driven, screenshots): chip persists 0.3s/1.8s/4.8s after
minimise; NO desktop stub + one taskbar entry; chip-restore returns Settings AND Review fully
painted (the blank failure is gone); toolbar-reopen undocks; two chips + selective restore;
close-while-docked kills the chip; 12s soak = no spontaneous restore. Incidental pre-existing
finding: createWindow parents a child to the FOCUSED window, so Review opened while Settings has
focus becomes Settings' child and dies with it on close — not a dock defect, noted for later.

Minimised child windows: **SAFE STATE shipped** — the OS desktop stub (bottom-left of the screen,
ugly) + the working dock chip (bottom-right of the main window) coexist. FOUR stub-removal
iterations failed live, each documented at `src/main.js` `wireChildDock`:
1. hide-on-minimise → window restored BLANK (surface unpainted mid-animation);
2. deferred hide + `webContents.invalidate()` → still blank;
3. `setSkipTaskbar(false)` → **structurally impossible: these are OWNED windows and Windows never
   gives an owned window a taskbar button** — and the style flip made minimised windows "randomly
   pop back open by themselves";
4. restore-then-hide + a `_dockJuggle` guard → **restore()'s events fire AFTER the handler
   returns**, guard already down, undock deleted the chip right after it was added → hidden
   window, no chip, NO WAY BACK (owner hit it; reverted within minutes).
**Designed 5th attempt (NOT built):** hide-based again, but (a) `undock` ignores restore/show/focus
while `!win.isVisible()` — a hidden window cannot be "back in front", so the queued juggle
artefacts can't kill the chip; (b) clear the juggle flag in a `setTimeout(0)` so queued events
drain against it. Must be smoke-tested live before pushing — this feature has now burned four
pushes. Also offered and owner-interested: per-window taskbar/window icons (`win.setIcon` — needs
per-window .ico art; overlay badges via `setOverlayIcon`).

## What shipped this evening (all pushed)

1. **Teach wizard flow REWORK** (Chris-lens spec, `9e0ffff` + follow-ups): ONE question panel
   (banner slots with fixed jobs; `#rg-readback` deleted; ONE typing row `rb-input`); provenance
   (`r.valueSource` read|typed) drives truthful headings — a typed value is never asked "confirm
   what I read"; typed+placed ISSUER commits straight from the pick step; READ-FAILED and NO-HIT
   are honest states (NO-HIT has "Edit the value" typo recovery — was a silent fixed-commit);
   value/label readouts colour-matched to the page boxes; PICK has inline `‹ n of N ›` + Back;
   rail's duplicate Redraw deleted — clicking a DONE row re-opens its confirm state; states that
   REPLACE the value suppress stale boxes (`hideStoredBoxes` — in PICK the old box was hiding the
   located ring).
2. **Typed corrections TEACH** (`69e9e93`): the read-check typing row runs the locate flow when
   the typed value differs — found elsewhere = box was wrong → ring + approve re-targets; not
   found = OCR misread in place → drawn box kept (old behaviour byte-for-byte).
3. **Two-way date coherence** (`c4016ce`): date field + non-date read warns; non-date field +
   value that genuinely parses as a date warns ("stops ref/date mix-ups"). Warn-only.
4. **Chrome-word issuer carve-out** (`5ce9cad`): single-token 'Order'/'Invoice'/… now trips the
   issuer plausibility warn (the BP/IBM immunity holds — no chrome word is a company).
5. **Step-2 type editor** = collapsed top hatch (`144cf25`): "It's something new? Create a type
   here…" expands IN PLACE at the top; draft survives collapse; edit-mode owns the slot safely.
6. **"Or type it instead"** ghost button in the question zone, DRAW state only (`f9fb17e`) —
   corner hatch + its padding hack deleted (typing is an equal input since typed-locate).
7. **Migration 63 INCIDENT** (`210c747`): owner hit `no column named corroboration` live — the
   safeAdd sat in `addMissingColumns` (migration-2 block, stamped everywhere) so it reached FRESH
   DBs only — **the exact trap migration 43's comment documents, walked into again**. Migration 63
   heals existing installs; the reprocess delete+insert pair is now ONE transaction (the failed
   insert had stranded `Ironclad-Tool-Hire_statement_0030` with zero rows — owner reprocessed, and
   **confirmed the corroboration badge showing live**). Pin simulates the already-migrated case;
   also found `runJsMigrations` was never exported (tests silently no-op'd it; runMigrations is
   the entry).
8. **Hidden-field drop + wizard "Never"** (`15d93bc`, gary + Chris-lens): flag
   `template_hidden_field_drop` (OFF, bridged, toggled, wiring-pinned) — ONE engine choke before
   Stage 4 clears valued declared-absent keys (same resolver + protected strip as the scoring
   consumer); `mergeReprocessRows(hiddenKeys)` stops resurrecting stored fills (corrected_to is
   sacred, pinned ×4); wizard skip asks "Does paperwork from this sender usually show a {F}?" →
   "Never — stop looking for it" writes the hide at commit; hollow-ring rail dot; undo path named
   on-panel + at review step. **OWED: the corpus arm** (applive snapshot, base vs armed; only
   declared-hidden lanes may move, valued→empty; plus a TEACH_FRESH_IDENTIFY arm) — the flag's
   live effect is design-argued + unit-pinned, not corpus-measured. Owner's own Nordwind test is
   the first live evidence.
9. **SFDEV settings gate** (`7862532` + `770961f` + combo `3944e54`): ~47 kill-switch/experimental
   toggles hidden behind ONE persisted SFDEV unlock (`dev_switches_unlocked`; pw checked in MAIN,
   `dev-switches-unlock` IPC); **the gate itself is INVISIBLE** — `Ctrl+Shift+D` then `M` in
   Settings is the only summons (owner: a visible locked door "leads to curiosity"). The split
   list is `DEV_SWITCH_IDS` in settings/renderer.js — one reviewable array. NO values changed.
   **Slice 2 (promote proven flags to ON via PROVEN_ON_DEFAULTS) is a separate per-flag review**
   — at least two candidates carry flip conditions (separator guard WITH the I→1 witness).
10. **Dock chips bottom-right** (kept from the saga): styled per-window chips, stacked, restore
    works; owner likes them.

## Owner-confirmed live this session
- Straighten round-trip: **"the boxes move well with the values"** (smoke A4 — first human
  confirmation of draw-on-straightened → raw-frame store → compose-scan placement).
- Corroboration badge showing after reprocess (migration 63 healed).
- Teach draw-step typing panel at top: working.

## OPEN / NEXT
1. **Dock 5th attempt** (top) — build + LIVE smoke before push.
2. **Hidden-field-drop corpus arm** (item 8) before the owner leans on the flip.
3. **Settings gate review before deployment** (owner: "we can review it before deployment") —
   the DEV_SWITCH_IDS split + today's three visible evaluation toggles (teach-label-keyword,
   list-field-scan, hidden-field-drop) migrate behind the gate once settled.
4. Slice 2 proven-flag promotion review (per-flag, conditions honoured).
5. Owner test script sections C–F still stand (identity flip, label→keyword flip, List type);
   A3 (registration preview on tilted sample) still unsmoked.
6. Buyer-issued slices 2/3, Chris finding 6, I→1 witness — unchanged in `pendingfeatures.md`.

## LATE EVENING SESSION (same day, owner present) — dock resolved · angle backfill APPLIED · corroborated auto-file BUILT (OFF)

HEAD **`03b7d87`**, ALL PUSHED. Full detail in the commit messages; headline state:
1. **Dock RESOLVED** (`5391c52`, live-smoked) — see the top-of-file resolution note.
2. **SFDEV trace crops named per read** (`7dcb0be`): tags absolute box / derived offset / inline
   harvest / edge grow / label locate etc.; anchor-overlay tooltip made honest (a keyword rung has
   no crop — the blue box is the taught anchor, context only).
3. **Picker history ranking LIVE** (`0816b28`): a ≥3×-confirmed candidate sorts first labelled
   "you've confirmed this N times" — owner saw it live. Kill `CANDIDATE_HISTORY_RANK`.
4. **THE 'Ltc' ROOT CAUSE: stale `sample_deskew_angle=0`** on pre-round-trip templates —
   compose-scan misplaced every composed box by the sample's undeclared tilt. Proven -0.7
   hand-set: 5/19→16/19 exact. **Oracle: backfill = PRIMARY layer, name edge-grow = WRONG LAYER
   (not built), NAME_UNCLIP untouched.** Census C1: both detect regimes agree 0.00° on all 8
   samples (DPI-invariance now verified fact). **BACKFILL APPLIED LIVE** (`--apply --plan`,
   backup `docusnap_pre_angle_backfill_2026-08-11T1809.db`): tpl 5 → -0.30, tpl 7 → -0.70;
   **tpl 9 Pelican HELD** (floor-row, only negative lane evidence — pendingfeatures). Gate: 118
   review docs replayed, unchanged templates byte-identical, Castellan 6/13→12/13 exact, known
   trade doc 0017 'Branblewood' (m→n interior — 007's `_PREVIEW_DOWNSCALE` ~80-DPI finding, own
   backlog entry). Owner live-confirmed "most worked"; the `es we` scare was a stale Review
   window. Instruments: `census_sample_angles.py` · `gate_sample_angle_backfill.js` ·
   `backfill-sample-angles.js` · pins `test_backfill_sample_angles.js`. C4: heal arming now
   covers `teach_angle_compose_scan` (was compose-only = never armed on the live config).
5. **CORROBORATED AUTO-FILE BUILT, DEFAULT OFF** (`029b234`+`03b7d87`, Oracle SIGN-OFF-W/COND,
   owner confirmed "extra route, all checks kept"): volume-only substitution (C1 probe:
   ≥3 human confirms, zero corrections incl. machine files, verifiable required fields),
   `confirmed_via='auto_corroborated'` excluded from the graduation window (C2), family licensing
   {mapping,crop,keyword} page-families with **memory+hint REFUSED** (near-circular — so the flag
   will NOT flip the current Castellan 13; their path is graduation, 2 more confirms), toggle in
   Settings→Processing, harness overlays threaded + canary-pinned. 19+16+wiring pins green.
   **FLIP GATES RUN LATE NIGHT — ORACLE VERDICT: HOLD.** Green: base arm byte-identical (80-doc
   confirmed corpus, values identical, wouldFile deltas empty); armed effect = exactly 4
   review-queue docs, ALL FOUR hand-checked GT-correct; declined census discriminates 5 buckets
   (9 memory+hint refusals live); identity_on_page already 'true' (satisfied — but Oracle
   CORRECTED the record: that flag does NOT mitigate the buyer-issued class, which satisfies it
   BY CONSTRUCTION). **The decisive negative: keyword appears in 0 of 29 live issuer records —
   the issuer disagreement rail NEVER fires in practice, so the buyer-issued ABSTAIN shape
   (memory+mapping, no dissenting voice — pinned VISIBLE as battery 18c, licensed) is the live
   norm.** The flip was HELD pending the RECREATED POISON MEASUREMENT — **which then RAN the
   same night and UNLOCKED it.** Fresh sandbox, fresh-install defaults, flag ARMED: the
   original leak PO taught through the wizard's own commit handler (promote-to-template) in
   BOTH naming variants — vendor-frozen 'Quillstone Print & Packaging' AND owner-frozen
   'Bramblewood Joinery Ltd' (SELECT-verified: template 2 fixed_value = the owner's name,
   which IS printed on every note — the variant satisfying identity_on_page BY CONSTRUCTION);
   fingerprint = the Bramblewood address-block wildcard, the true leak fingerprint. All 21
   original Oakhaven notes imported live: **21/21 REFUSED at Stage-0 identification, zero
   claims, zero corroborated files, zero files of any kind** (app import stream + direct
   single-doc trace + DB census). **MAJOR FINDING: the wrong claim no longer forms even with
   the frozen identity printed on the page** — the 08-10 misfile fix + 08-11 young-identity
   corroboration close the class upstream of auto-file entirely. Oracle verdict UNLOCK
   (condition 2 discharged on the SELECT per his pre-committed rule). Recorded caveats: a
   bare confirm no longer creates a template (poison needs the wizard path — itself a
   finding); the recreated teach had no drawn mappings (irrelevant to Stage-0 refusal); the
   depth variant (drawn mappings + pre-loaded 3-confirm wrong scope) recorded nice-to-have,
   NOT owed. **Owner may flip: Settings → Processing → "Auto-file earlier when two readings
   agree".** Standing rule: never flip alongside `CODE_SEPARATOR_STRUCTURE_GUARD` without
   re-running the Pelican exhibit; the 18c abstain pin stays visible (`3d2b2af`).
6. **Owner UX ruling: the Review "✓ Two independent readings agree" line is REMOVED** — a
   positive-only badge trains expectation and its structural absence (label-above layouts are
   INVISIBLE to Stage-1 keyword — same-line matching only; pendingfeatures entry) reads as alarm
   on correct values. Record + SFDEV surfaces stay; do not resurrect as positive-only.
7. Keyword label-above gap, tpl 9 hold, engine NULL-angle decision, name-crop supersede — all
   filed in `pendingfeatures.md`.

## Gotchas added this evening
- **`addMissingColumns` runs ONLY in the migration-2 block** — a new column for an existing
  install needs its own numbered migration. Third time this trap has featured; the mig-63 pin now
  simulates the already-migrated case (DROP COLUMN + unstamp + rerun).
- **`runJsMigrations` is internal** — `runMigrations` is the only export/entry; a destructured
  `runJsMigrations` import is silently undefined.
- **Owned (parented) windows can never have taskbar buttons** on Windows; `setSkipTaskbar`
  flips on them cause spontaneous restores.
- **BrowserWindow event timing**: `restore()` inside a `minimize` handler delivers its
  restore/show/focus events AFTER the handler returns — a synchronous guard flag is already down.
- The owner runs the app via `! npm start` through the session terminal — app restarts appear as
  background-task notifications; full restart needed for main.js/engine changes, window reopen
  for renderer-only.
