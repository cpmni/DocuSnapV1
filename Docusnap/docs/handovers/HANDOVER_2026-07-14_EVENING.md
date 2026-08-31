# HANDOVER 2026-07-14 EVENING — Review disambiguation picker + anchor/caption fixes + auto-straighten design

> Continues `HANDOVER_2026-07-14.md` (the DAYTIME logo/skew/branding work). This session: the anchor-precedence
> + caption fixes, the NEW ⑂ Resolve disambiguation picker, the caption-band-exclusion fix — all **MERGED to
> `main` via PR #10** (merge `6c93bb0`) — plus a reprocess-throughput commit and a fully-designed-but-UNBUILT
> auto-straighten feature.

## TL;DR for the next session
1. **START HERE: build the auto-straighten field re-read** from `docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md`
   (Oracle-signed FIELD-SCOPED design; whole-doc was SENT BACK). Owner chose it; it's the top pending task.
   Slice 0 (process_docs `_extract_document(deskew_pages=…)` refactor, byte-identical) → Slice 1 (field-scoped
   deskew re-read + corroborate/adopt) → Slice 2 (retire Straighten-all's forced read). Touches the CORE
   extraction pipeline → build carefully with its own corpus M=0 gate; NOT rushed (why it was deferred).
2. **Branch `feat/reprocess-throughput-autostraighten`** (off post-PR#10 main) holds `d7968ed` (reprocess
   worker cap 5→10) + this handover + the design doc → **PR to `main` opened this session** (see below).
   Worker cap is main-process code → **needs an app RESTART**.
3. **`main` is current** (PR #10 merged). Local `main` may be stale — `git fetch && git checkout main &&
   git merge --ff-only origin/main` before branching new work.

## MERGED to main via PR #10 (`6c93bb0`) — the anchor/picker batch (all corpus-verified M unchanged)
- `963f643` **fix#1a** — the label-lock relocate crop now KEEPS its OCR confidence (was NULLED; un-blinds the
  field-conf cap + engine Tier-A OCR gate). `tests/test_name_relocate_disagreement.py`.
- `3884013` **fix#1b** — `NAME_RELOCATE_DISAGREE_GUARD` (engine `_name_relocate_should_hold`): a garbled
  RELOCATED name read can't beat a CLEAN keyword name; Oracle's absolute **0.6 name-quality floor** protects a
  legit mixed-case teach ("McConnell Kelly Solicitors"@0.667). Kill switch `NAME_RELOCATE_DISAGREE_GUARD`.
- `94cef42` **fix#2 caption-demotion** — a relocate whose LEADING tokens ARE the taught caption
  (anchor `_is_caption_bleed` → `caption_bleed` flag) yields to the clean keyword. Kill switch
  `RELOCATE_CAPTION_DEMOTE`. E2E: doc 191 "Customer Site tee"→"Fembank Veterinary Clinic".
- `cf6ed02` **picker BACKEND** — engine emits + persists per-field `candidates` [{value, box(top-left),
  source_label, method, confidence}] for flagged name fields (migration 48 `extractions.candidates`; kill
  switch `FIELD_CANDIDATES_EMIT`). `tests/test_field_candidates.py`, `test_field_candidates_persist.js`.
- `626a8d1` **picker RENDERER** — the **⑂ Resolve** in-page popup (raw page + ①②③ markers + clickable list);
  a click fills the value + stages a position-only anchor (top-left→centre via `shared/pickBox.js`, pinned by
  `test_pick_box.js` incl. a real saveAnchor round-trip). A pick NEVER files (server flag gates). **Renderer
  JS → needs a RESTART to load.**
- `6f60276` **caption-band exclusion** — a thin one-line value box is padded ~3× taller, so a below-anchor
  relocate crop balloons UP into the caption on a DESKEWED scan ("Customer eu"/"ae Cafe Co"). `_caption_top_limit`
  → `_crop_and_ocr(top_limit_norm=)` clamps the crop TOP below the located caption (collapse→skip→review). +
  position-veto on the label-lock locate. Kill switch `RELOCATE_CAPTION_EXCLUDE`. E2E doc 183 under DESKEW:
  OFF="Customer eu"@69+picker; ON="Kingfisher Print Studio"@89 clean. `tests/test_caption_exclusion.py`.
  (`stress_test/_trace_docs.js` gained a `DESKEW=1` flag + a `⑂cands` dump.)

## Committed on the branch (NOT merged) — PR opened this session
- `d7968ed` **reprocess worker cap 5→10** (`handler.js` ~1462; owner request). Effective count still bounded by
  min(cap, processing_concurrency, files). **Main-process → needs RESTART.**

## PENDING / next — the auto-straighten field re-read (DESIGNED, NOT BUILT)
Read `docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md`. Advisor round done (oscar OCR + gary pipeline + Oracle).
**Decisive finding: straighten is NOT monotone** — Kingfisher raw-garbled→deskew-clean (deskew HELPS);
delivery_docket_12 raw "Larch & Hollow Cafe Co"@87 CORRECT→deskew "ae Cafe Co"@78 WORSE (⊕ box registered to
RAW geometry; rotation mis-registers → clip). So read BOTH ways, keep strictly-better, RAW privileged default.
Oracle SENT BACK the whole-doc dual-read (silent-sibling-mutation / type-flip / empty-clear holes) → build the
FIELD-SCOPED shape (re-read ONLY the flagged field on a deskewed page; adopt nothing else; review-bound). Reuse
the `_maybe_gate_reread` injection (engine.py:1706) on DESKEWED pages with a NAME adopt gate. Pins: docket_12
keeps raw@87; Kingfisher clears its flag. customer_name is NOT corpus-scored → corpus M=0 proves inertness, not
correctness (use the E2E pair).

## Live-diagnosis facts the owner asked about (durable)
- **Auto-file not firing at 97%:** `auto_file_threshold` is UNSET → default **100**. For an UNGRADUATED scope
  the auto-file floor = exactly the threshold (`trust.js:437` `graduated ? min(userThr,95) : userThr`).
  Northgate/delivery_note `scopeTrust` = `{trusted:false, floor:100, reason:"recent-correction", confirmed:35,
  corrections:3}` — 3 recent corrections reset the clean streak graduation needs. FIX: Settings → Processing →
  lower the auto-file slider to 97 (a traced 97% delivery note is clean: no flags, DN@90/date@98 clear the 88
  critical floor, template matched). OR confirm cleanly until it graduates → 95 floor.
- **Reprocess "1 at a time"/slow:** it IS parallel (`Promise.all` over shards, cap now 10). The counter ticks
  per-file so it LOOKS serial. The real slowness = **Straighten-all ON** → every TILTED doc does a full
  deskew re-OCR (cache reused only for upright docs). **Keep Straighten-all OFF** unless straightening is needed.
- **Straighten-all is a LIVE DEFECT** — it stores the straightened read UNCONDITIONALLY (even when raw was
  better → docket_12's @78). Reprocess-only → never auto-files → Review-visible, not silent. Slice 2 retires it.
- **Box "lower/further than drawn"** (owner Q): the displayed box is the anchor's RELOCATED read position for
  THAT doc (drift-recovery: finds "Deliver To", places value box via the learned offset) — not the fixed taught
  box. It follows the value per-doc; correct value = correct box. Same reason straighten breaks it (raw-frame
  registration).

## Owner test corpora on Desktop (NOT in the live DB; some Demo Docs INTENTIONALLY ambiguous = picker fixtures)
`Fresh Test Docs` (500 PDFs + a full GT CSV) · `ScannedDocs` (174, filename=Invoice.date.ref GT) · `Demo Docs`
(900 — Vellum&Crane / Thornbury / Copperfield × 5 types × 20; some with overlapping/missing data by design).

## State: working tree clean after the commits below; live app was running (`npm start`). Nothing pushed
before this session's push. All kill switches default-on + additive; every merged change was M-unchanged on
`stress_test/realdoc_regression.js`.
