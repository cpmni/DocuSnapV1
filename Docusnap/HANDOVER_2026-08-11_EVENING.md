# HANDOVER — 2026-08-11 EVENING (owner live-testing session, continuous with DAY 2)

**Branch** `feat/teach-side-overnight` · HEAD **`1edfb7c`** · ALL PUSHED, tree clean.
**Read `HANDOVER_2026-08-11_DAY2.md` first** — the morning half (corroboration record, template-
scoped labels, LIST type, Chris fixes, young-identity). This file is the afternoon/evening: the
owner tested live and drove ~15 fix commits. **`OWNER_TEST_SCRIPT_2026-08-11.md` is partly stale
now** — the teach-wizard sections describe the pre-rework flow.

## PICK UP FIRST — the dock (the one thing left broken-then-reverted)

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
