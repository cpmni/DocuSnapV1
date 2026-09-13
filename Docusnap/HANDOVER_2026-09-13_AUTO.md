# HANDOVER 2026-09-13 (AUTONOMOUS run — owner away ~2h) — preview UX + Quick File edit + submit PANE + Chris

Branch `feat/teach-side-overnight`. **7 commits this run, NONE pushed** (push = approval-class, owner's call).
Continues `HANDOVER_2026-09-13_DAY.md`. `npm run test:pins` = **349 green / 2 red** (both pre-existing:
`test_compile_python_keep`, `test_activity_strip` — neither from this run). No flips. Owner's app + Chris's
sandbox were left running; I never touched the owner's live app or DB.

## START HERE — the owner's queue
1. **PUSH?** 7 local commits (`a93c8fd`→ this run). Your call.
2. **Verify on screen** (the 3 live preview features + the pane): see §VERIFY.
3. **Chris's Quick File vet** — §CHRIS (findings queue for you; implement none without your go).
4. **Flip decisions remain yours** (all approval-class): `direct_intake_enabled` (Quick File — has a
   pre-flip gate, see §PANE C3/C4) + the still-owed departments D2 sweep before departments can flip.
5. **Owner decision still open from DAY:** the P1↔PI confirm-once arc (Slice 1 vs both) — unchanged.

## WHAT SHIPPED (committed, tested)
- `a93c8fd` **3 preview fixes** — (a) **Clear stuck errors:** a failed-OCR doc holds at status='error'
  forever; the banner × was session-only + the Home card had no dismiss → a **"Remove"** button
  (`discard-stuck-docs`) soft-deletes them to the bin (originals kept). *Fixes your "can't clear the 2
  errors."* (b) **Find-in-document box** top-right of the Search preview (searches the open doc; born-digital
  PDF text). (c) **.xlsx grid preview** — a spreadsheet now shows its cells (dependency-free), not an icon.
  *Answers your Excel-preview ask (route 1, no new tool).* Pins: `test_stuck_discard` 16, `test_find_in_document_box` 14, `test_ooxml_grid` 17.
- `9284b77` **Fast first page** for big multi-page PDFs — page 1 paints immediately, the rest preload in the
  background. *Answers your "8 MB PDF slow to open."* Pin `test_fast_first_page` 10.
- `b432f5a` **Quick File edit-details** (`directIntakeService.update`) — edit a filed Quick File doc's
  company/date/title/notes → re-files if a filing token changed; body stays searchable. DARK. + the
  **missing-features scan** `docs/brainstorms/QUICKFILE_MISSING_FEATURES_2026-09-13.md`.
- `9d57c76` **Quick File submit PANE** — replaces the popup modal with an in-page view sibling to Import
  (barry: pane>modal; eric arch; Oracle SIGN-OFF-W/COND). §PANE. Pin `test_quickfile_pane` 15.
- `+ oracle_log` entry for the pane.
- **thumbnail placeholder fix** (Search results) — a clean CSS document-glyph placeholder replaces the
  browser's broken-image glyph while a thumb loads AND for office/text docs that have no thumbnail.
  *Answers your "different holding image" request + Chris finding 4.* (Review's `qi-thumb` uses `alt=""` and
  Chris didn't flag it — left as-is; its own comment claims a clean empty box.)

## §VERIFY (owed — I couldn't reload your running app or Chris's in-flight sandbox to smoke these)
- Search preview: open a multi-page PDF → page 1 shows fast; open the sample `.xlsx` (or any) → a cell grid;
  the top-right **Find** box highlights text in the open doc.
- Home (Import view): the "couldn't be read" banner now has **Remove** → clears the 2 stuck errors to the bin.
- Quick File PANE (needs `direct_intake_enabled` ON): the ⚡/Quick File nav opens an in-page pane (not a
  popup); pick → type Company/Date/Title → File → a receipt row with Open folder / Find it / Undo.

## §PANE — Oracle SIGN OFF WITH CONDITIONS (design: docs/designs/QUICKFILE_SUBMIT_PANE_2026-09-13.md)
Pure front-end swap; backend/IPCs unchanged; behaviourally inert OFF. Conditions are **pre-FLIP, not
pre-merge** — the DARK code is safe as landed.
- **C1 APPLIED** — `#qf-dropzone` is a plain click-to-pick card, NOT a dashed "drop here" box (drag-drop is
  deferred to Q-C12; a drop cue would be a false affordance).
- **C2 APPLIED** — receipt "Open folder" uses the de-pathed `showDocumentInExplorer(docId)` (no filed path
  into the renderer).
- **C3 PARTLY DONE** — live CDP smoke on the sandbox (reloaded to the new code) PASSED **ON** (pane is the
  active view; `#qf-dropzone` + receipt + "File documents" present; the 4 Quick File types listed; modal
  gone) **and OFF** (nav hidden, `QuickFileView.enabled` false, a stray `showView('quickfile')` no-ops →
  stays Home). STILL MANUAL: filing a doc end-to-end through the pane's native file picker (couldn't
  automate the OS picker — same limit Chris hit). Sandbox left on the pane (port 9223) for you to try live.
- **C4 STANDING** — do NOT flip `direct_intake_enabled` before Q-C1/Q-C2 land: a Quick-Filed doc is still a
  confirmed row reachable by the four UNBUILT write-side doors (Put-back/Learning-Repair send-back,
  Edit-in-Review, reprocess, requeue) — the "learning rows for a doc nobody read" seam.
- Deliberately UNWIRED (would silently no-op): Department field (handler doesn't copy `meta.departmentId`),
  company autocomplete (Q-C7 needs a dedicated non-learning reader).

## §CHRIS — sandboxed Quick File vet — **VERDICT: YES ("I'd keep using it")**
Full report: `docs/CHRIS_FULL_APP_REVIEW_2026-09-13.md` (ROUND 2). Sandbox port 9223 (PID 1368), Quick File
flag ON, seeded `.xlsx`/`.txt`. He vetted the **modal** submit (launched pre-pane) + the shipped preview
features. Core promise HOLDS: filed to Company/Year/Month, content-searchable in seconds, never in Review;
xlsx grid "a delight"; multi-file smooth; delete/restore safe. **8 findings — implement NONE without your go**
(one exception, #4, already handled — it was your own prior request):
1. **TOP HARM — "Send back to Review" strands a Quick File doc in un-fileable limbo:** the prominent blue
   action drops a filed Quick File doc into Review saying "scanned page no longer available", **Confirm & File
   disabled**, no path back to Filed; the file is safe on disk but nothing says so. → hide it for non-scanned
   docs, or honest copy + keep an Edit-details/Confirm path. *(Your call — a real trap.)*
2. `.txt` shows "No preview available" though searchable (xlsx shows a grid) — inconsistent, reads as a bug.
3. Jargon "never runs OCR / teaches the scanner" in the modal copy.
4. **Office/text broken-image thumbnails in Search** — *= your earlier "holding image" request; **FIXED this
   session** (`+ thumbnail fix` below).*
5. Quick File undiscoverable beyond the nav rail (tour/checklist never mention it).
6. Duplicates filed silently (a `-DUPLICATE` copy, no notice) — barry's dup-detect must-have.
7. "Find in this document" is PDF-only (not xlsx/text).
8. "100%/High confidence" shown on hand-typed fields — odd.
The sandbox is left running (port 9223) for you to poke; the next /christest rebuilds it (and picks up the pane).

## WHAT REMAINS (Quick File / departments — the honest scope)
- **Departments D2 list-reader SWEEP** — the load-bearing safety slice (thread `visibleDocSql`/`canAccessDocument`
  into every remaining list/count reader; site list = `docs/designs/QUICKFILE_DEPARTMENTS_ERIC_ARCH_2026-09-12.md`
  §A.2). DARK-inert now (no departments configured). NOT done this run. **Must be COMPLETE before departments flip.**
- Quick File slice-3 rest: replace-file + `document_versions`, bulk edit (update() is done).
- Drag-drop (Q-C12) + watch-folder (own passes). barry must-haves to consider next: duplicate-detection,
  text-snippet preview in results, tags; differentiators: expiry reminders + bulk backfill (see the brainstorm doc).

## MEMORY
`project_quickfile_pane_and_preview_20260913.md` (+ MEMORY.md index). GOTCHAS carried there
(xlsxWriter emits inlineStr; Home CSP has no img-src → SVG icons; the census/switch traps unchanged).
