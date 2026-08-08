# HANDOVER — 2026-07-23 EVENING (Opus 4.8 → Fable 5 mid-session)

**Branch:** `feat/reprocess-throughput-autostraighten`
**HEAD `0ae0f46` — PUSHED. Origin in sync (`git rev-list --left-right --count @{u}...HEAD` = `0 0`).**
**Tree clean** except the out-of-repo `../Backup/`.
**Installer:** still `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe` (crash-fix-only) — it
predates EVERYTHING on this branch since `3e3fde1` → REBUILD before any packaged test.
**Running processes:** the owner's dev `npm start` was launched mid-session (background) and may still
be alive — check for stray `electron.exe` before any `npm run build` (EPERM on better_sqlite3.node).
**Supersedes:** `HANDOVER_2026-07-23.md` (the morning session — Review cold-start UX). Read that for
the morning's 3 commits; this one covers the rest of the day.

---

## 1. TL;DR
Owner-driven live-testing day on the Thornbury Fasteners delivery-docket batch. **5 feature/fix
commits, all PUSHED** (plus the morning's 3). Two Oracle-gated extraction fixes shipped; the BIG one
— **per-line crop selection (`ANCHOR_LINE_SELECT`)** — is fully designed + Oracle-SIGNED and **banked
as the next session's build job**: `docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md`.

| Commit | What |
|---|---|
| `0bbfdce` | SFDEV trace: EVERY field always shown + per-field OCR crop thumbnails |
| `d91da4b` | Type editor: drag-to-reorder fields (⠿ handle; shared DocTypeEditor) |
| `274276c` | Type editor: per-field keyword labels (🏷 inline panel; reuses label_overrides) |
| `1c8243b` | **E2** — crosscheck flip auto-accepts when keyword corroborates (kill `CROSSCHECK_KEYWORD_CLEAR`) |
| `0ae0f46` | Gate-reread normalisation-only recoveries file clean (kill `GATE_REREAD_CLEAN_ACCEPT`) |

## 2. The two shipped extraction fixes (both Oracle-gated, corpus-A/B'd)
- **`1c8243b` E2 crosscheck-corroboration clear.** A taught crop misread ("IN-23333" for
  "DN-23333") makes anchor.py's cross-check flip to the correct full-page value but cap 70 + flag —
  the doc held FOREVER (re-teaching can't fix a read-vs-read disagreement; 4 live docs). Fix at the
  ENGINE MERGE: when a Stage-1 `keyword`/`keyword_override` read normalises-equal to the flip
  (alnum-core for refs, calendar for dates), re-base to `anchor_inline` @90 (≥ the 88 critical floor
  — the keyword's own 85 would still hold, the Option-A trap) + strip the note. Oracle re-adjudicated
  TWICE: **E1 "oversized taught box" geometry is DEAD** (measured: all taught ref/date anchors are
  single-row h_norm 0.0154-0.0240; the 2-row crop is READ-TIME +20px padding bleed, not box size) —
  do not re-chase. Test `test_crosscheck_corroboration.py` 18/18.
- **`0ae0f46` gate-reread clean accept.** The Stage-4.5 re-read flagged EVERY recovery — even
  `"DN -99718"→"DN-99718"` (whitespace-only) → the owner's "why the correction message when no
  correction was made?". 0-edit alnum-core agreement (the kinship band's 0-edit subset) → accept
  clean, un-capped, un-noted; 1-2-edit real repairs stay review-bound. **Oracle C1 (blocking): dates
  need strict CALENDAR equality** — '1/12/2026' vs '11/2/2026' share a core but differ; unparseable
  side never clean; deliberately NOT `_reads_disagree` (fail-open polarity). Test
  `test_gate_reread_clean.py` 17/17. Also fixed the stale "(ships DARK/default OFF)" comments —
  GATE_REREAD is default ON.

## 3. Verification state — be honest
- **E2 corpus A/B** (OFF vs ON, live DB, 276 reprocessed): sole delta **117→118 would-auto-file**;
  M unchanged at 3 (the KNOWN poisoned-GT baseline #190/#7 + PO misreads — both runs exit 1 on it,
  as documented); values byte-identical. The 3 pre-existing `test_anchor_crop_crosscheck` failures
  are IDENTICAL ON/OFF (not ours).
- **Clean-accept corpus A/B:** reports **BYTE-IDENTICAL** — inert on the corpus (the 3 corpus
  gate-reread docs #223/#243/#262 are real-character repairs, correctly still flagged). OFF == legacy proven.
- **NOT verified live (owner-side, both fail-safe if they don't fire):** (a) E2's blocking check —
  that Stage-1 keyword reads `DN-23333` on each of the 4 originally-flagged dockets (reprocess them);
  (b) clean-accept on docket_07-1 — the `re-read from the page (was "DN -99718")` note should clear
  on reprocess. ⚠ Expectation-set: after the note clears, that field sits at its natural **85**
  (keyword-path ceiling) → the doc moves to the CALM "automatic check didn't pass" hold — see §5(85-vs-88).
- **Renderer/UI work untested live:** SFDEV crop strip + all-fields (owner used the trace all day
  post-fix — WORKING, confirmed by screenshots); drag-reorder + per-field keywords **NOT yet
  owner-tested** (Settings window reopen needed); the morning's cold-start smoke (i) still pending.
- **Corrections to mid-session claims (recorded so nobody re-learns them):** my "Review won't show
  the field reorder" was WRONG — Review's panel renders via `fieldDefs` (already sort_order); only
  `documents.js:126 getWithExtractions` (rowid) remains for Search-preview extras / possibly `/v1`.
  007's "keyword corroboration inert on delivery_number" was WRONG for preset installs — the live DB
  has **8 seeded labels** for `delivery_note/delivery_number` (owner caught this).

## 4. FIRST ACTIONS for the fresh session
1. **BUILD `ANCHOR_LINE_SELECT`** (+ `ANCHOR_ROW_GRACE` dark) per
   **`docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md`** — the canonical Oracle-signed spec: hook,
   band + per-rung rescale, scope cuts, pins (a)-(k) with the RED-first ones, the corpus gate with
   doc-by-doc flag-drop attribution, and the "ladder note" to pin in docstrings. Default OFF until
   the gate passes.
2. **Owner live-checks first** (they gate nothing but confirm the day): reprocess the Thornbury queue
   → E2 clears the 4 crosscheck docs; docket_07-1's reread note gone; then test **field drag-reorder
   + 🏷 per-field keywords** in Settings → Document Types (owner asked these be carried explicitly).
3. **OWNER-REQUESTED NEXT UI SLICE: doc-TYPE list rearranging** — reorder the document-types LIST
   itself (Settings left list). Backend READY (`document_types.sort_order` exists, every fetch
   `ORDER BY sort_order`); build the UI affordance on the same `applyOrder` seam style as d91da4b
   (eric's banked review recommends buttons-or-drag on one shared commit fn). NOT designed in detail — small.
4. **The 85-vs-88 permanent-hold class** (diagnosed, NOT designed): keyword-label reads are capped at
   85 (base 80 +5 right-of-label, `keyword.py:204/:754-760`) while ref/date roles need ≥88
   (`trust.js:566-584` critical floor, applies at EVERY threshold) → any doc whose REF resolves via
   keyword labels can NEVER auto-file (the owner's "what is stopping the auto file?" docs). Direction
   agreed in-chat: corroboration boost (agreeing anchor/inline/shape evidence lifts ≥88); needs the
   full advisor+Oracle gate. Related display gap: the hold panel's message map lacks
   'weak-critical-field' → falls to the generic copy instead of naming the field+floor
   (`renderer.js:~2010`).

## 5. Deferred / open (with load-bearing conditions)
- **ANCHOR_LINE_SELECT / ROW_GRACE** — see the design doc. Slice 2 stays DARK regardless of slice 1's
  gate (Oracle: the only new silent-wrong-value geometry lives in the grace zone).
- **85-vs-88 corroboration boost** — above; do NOT just lower the floor or bump keyword confidence
  blanketly (the floor is the safety net; only corroborated reads may cross it).
- **P4 field order** — CORRECTED SCOPE: Review already honours sort_order; remaining = Search-preview
  extras (`search-preview.js` iterates doc.extractions = rowid order) + check the `/v1` DTO before
  changing client-visible order.
- **Morning session residue** (see `HANDOVER_2026-07-23.md`): cold-start smoke (i); Defer/File-All
  advance live-check.
- **Pre-existing queue** (unchanged): P2 `--apply` sweep (94 rows) · H2 pairing decision · P3/P5/teach
  live-tests · poisoned-GT cleanup (#190/#7) · installer rebuild.

## 6. Needs the USER
Reprocess Thornbury queue (E2 + clean-accept live confirmation) · test drag-reorder + per-field
keywords + the Review cold-start batch · decide on the doc-type-list rearrange slice ·
installer rebuild before any packaged test · P2 `--apply`.

## 7. Key facts & paths
- **Kill switches added today** (all default ON; `=0` = legacy; OFF ⇒ byte-identical):
  `CROSSCHECK_KEYWORD_CLEAR` · `GATE_REREAD_CLEAN_ACCEPT`. Planned (default OFF): `ANCHOR_LINE_SELECT`,
  `ANCHOR_ROW_GRACE`.
- **Tests:** `py -3.12 python_backend/tests/test_crosscheck_corroboration.py` (18) ·
  `...test_gate_reread_clean.py` (17) · `node src/windows/review/test_review_initial_selection.js` (16)
  · `node src/windows/shared/test_doctype_reorder.js` (15). Corpus: `GATE=1 ELECTRON_RUN_AS_NODE=1
  ./node_modules/.bin/electron stress_test/realdoc_regression.js` — READ THE REPORT
  (`stress_test/out/realdoc_regression.md`); baseline exits 1 on M=3 poisoned GT; a trailing
  tail/echo masks the exit code. A/B copies from today: `stress_test/out/rr_{off,on}.md` (E2),
  `rc_{off,on}.md` (clean-accept).
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`, mig 52. The corpus now reprocesses 276 confirmed
  docs. Ref-accuracy context from today's report: supplier 100% / type 99.6% / date 98.2% /
  **ref 95.3%** — the ref digit-misread class is the weak spot; several "regressions" are POISONED
  GT (`N-99718`-style confirms missing the leading D — the very class E2/clean-accept address).
- **Advisors used:** 007 (2 rounds), gary (2), oracle (5 rulings incl. 2 re-adjudications — killed
  E1 on measurement both times a premise broke; the full-ladder closing note is in the design doc),
  barry + eric (morning). Model switched Opus 4.8 → Fable 5 mid-session (owner /model).
- Prior handovers, newest first: `HANDOVER_2026-07-23.md`, `HANDOVER_2026-07-22_NIGHT.md`,
  `HANDOVER_2026-07-22_LATE.md`.
