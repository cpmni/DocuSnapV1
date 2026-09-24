# QUIET REDETECT gate — 2026-09-24 (evening 2)

Feature under test: `quiet_redetect_on_type_change` (mig 216, DARK) — a type that becomes available or a Keyword Label
Override that is saved schedules the quiet lane's scope-less QUICK re-read of the held unrecognised (NULL / General
Document) template-less docs, or the override's type's (`src/modules/processing/quietLane.js` kind `redetect`;
design `docs/designs/QUIET_REDETECT_2026-09-24.md`; Oracle `docs/oracle_log.md` 2026-09-24 evening 2, A: SIGN OFF W/COND
C1-C7). Pins green: `test_quiet_lane_redetect.js` (10 sections), `test_migration216_quiet_redetect.js`,
`test_reread_holds_blank_supplier_scope.js`, `test_detection_change_triggers.js` (17), `test_reprocess_type_flip.js`
§5, `tests/test_reextract_type_detect_order.py`; whole suite `node scripts/run-pins.js` 428/428 (after the four
`TEST_SWITCH_KEYS` count pins moved 13→14).

## Method
Same rig as the Quick-rescore gate (`TESTING/_measure/quick_rescore_gate_20260924/RESULT.md`): a DEV instance on its own
`DOCUSNAP_USERDATA` built from the owner-sandbox EXHIBIT copy (output folder re-pointed, watch folder removed, client API
off, working files copied in), a seeded gate admin, the app driven over CDP through the Review window's own bridge. The
ON arm launches with `QUIET_REDETECT_ON_TYPE_CHANGE=1` in the process env (the DARK switch's env mirror); the OFF arm
launches plain. Each arm: sign in → open Review → snapshot → **add three catalog types the exhibit's untyped docs need**
(`addDoctypePresets(['delivery_note','statement','credit_note'])`) → wait for the lane to go idle → snapshot → **save a
Keyword Label Override on the Quote type** (`quote_number` ← "Quote Reference") → wait → snapshot. Audit rows
(`quiet_reprocess_job`, per-doc `reprocess` with `redetect:true`) and the documents table are read from the arm's DB.

Exhibit start state: docs 3 (Delivery Note detected), 4 (credit note, detection None), 5 (Service Worksheet detected),
6 (Statement detected) `needs_review`, type NULL, template NULL, all born-digital (`bd_used:true` recipe stamps);
17 Nordwind quotes typed Quote, template NULL, overall 31 (the Quick-rescore exhibit); doc 29 is the newest quote and is
the document the Review window opens on.

## OFF arm (`redetectOff`, switch off)
Presets added (`credit_note` id 8, `delivery_note` id 9, `statement` id 10); override saved (`inserted:1`). **No
`quiet_reprocess_job` row, no per-doc reprocess row; docs 3-6 unchanged (type NULL); the 17 quotes unchanged at 31.**
Byte-identical off, as pinned.

## ON arm 1 (`redetectOn`, before the born-digital relaxation)
- **Type-add job** ran 8 s after the presets (`kind:redetect quick:1 reasons:type-added type_slugs:credit_note,
  delivery_note,statement`) — but staged NOTHING: all four untyped docs were `skipped no-cache:born-digital-doc`. The
  batch's `ocrCacheUsable` refuses a text-layer doc (its Quick exists to skip OCR, and a born-digital Full is nearly free)
  — a COST rule that makes the redetect a no-op on exactly the owner's Demo Docs population.
- **Override job** ran 8 s after the save (`kind:redetect quick:1 reasons:override type_slugs:quote`): **16 of the 17
  quotes re-read on the Quick road, every one 31 → 93** (the Quick-rescore path, hands-free this time); the 17th (doc 29)
  was OPEN in the Review window and was correctly left alone (viewer exclusion at selection, not a drop). 16 per-doc
  `reprocess` audit rows stamped `quiet:true, redetect:true`. Nothing filed (no template; `no-template` hold as designed).
- Side finding: the audit redactor masked the job's `override_keys` field (any field named like a secret) → renamed
  `override_fields`.

**Fix applied (same evening, pinned):** the redetect's `quickUsable` asks the batch predicate with `allowBornDigital`
— only `bd_used` is waived, every other invalidator (dpi / light / bd setting / pipeline rev / tesseract) still applies;
the lane is the ONLY caller that asks for it (`test_migration216` source pins + `test_quiet_lane_redetect` §3).
Rationale: the alternative to Quick here is not Full (the lane never stages Full for this job) but nothing, and a
text-only redetect wants exactly what the text layer gives (type detection + keyword reads over exact text). What a
Quick-bd read LOSES vs the batch's Full fallback: the renders (logo identity arm, `_id_img`) and `page_text_lines`
(the letterhead geometry witness Full builds from the vector text) — every consumer of those is fail-toward-review on
this population. **Oracle re-rule (night): SIGN OFF WITH CONDITIONS C1-C3, all applied** — the re-ask lives in
`ocrCache.ocrCacheUsableForRedetect` (lane-only; the batch partition keeps its Full fallback by ruling), behavioural
pins `test_ocr_cache_born_digital.js` (17), the stamp is never laundered (imageless emits `{imageless:true}` only +
`COALESCE(?, ocr_recipe)`), and C3 below.

**C3 — issuer before/after on the ON arm (docs 3-6 and every changed row):** 3 NULL → NULL · 4 NULL → NULL · 5 NULL →
NULL · 6 NULL → NULL; no document's `supplier_name` changed from one non-null value to another anywhere in the 30-doc
snapshot. MET (accept only unchanged or NULL→value).

## ON arm 2 (`redetectOn2`, with the relaxation) — MET
- **Type-add job** (8 s after the presets; `kind:redetect quick:1 reasons:type-added type_slugs:credit_note,delivery_note,
  statement`): `done_ids 3,6,4,5`, skipped 0, dropped 0, failed 0. **Doc 3 → Delivery Note** (41 → 62; `delivery_number`
  `OED/29786` @93, `delivery_date` @94 first-filled), **doc 6 → Statement** (31 → 58), **doc 4 → Credit Note** (31,
  `credit_note_date` @94 first-filled), **doc 5 stays UNTYPED** (its detection names "Service Worksheet", a type that was
  NOT added — typed-wrong 0 by construction; its shared fields re-read 31 → 43). Every first-fill was held provisionally
  at merge and RELEASED at finish (`reliability_released_ids 3,3,6,6,4`, nothing proved unreliable) — no note left on
  docs 3-6. **Filed: 0** (no template on any of them). 20 per-doc `reprocess` audit rows stamped `quiet + redetect`.
- **Override job** (8 s after the save; `type_slugs:quote override_fields:quote_number`): 16 quotes 31 → 93 again; doc 29
  (open in Review) untouched.
- OFF arm vs ON arm 2 on everything the feature does not target: identical (the 30-doc snapshots differ only on the
  rows the two jobs re-read).

## Verdict
MET. The owner's two scenarios are hands-free on the ON arm: (1) add the missing type from the catalog → the held
unrecognised docs of that type are typed and field-filled within ~10 s, nothing filed by the pass itself; (2) save a
keyword override → the held docs of that type re-read on the Quick road and, with today's Quick-rescore, carry an honest
score. OFF is byte-identical. The "then confirms allow auto-file" leg is the same road the Quick-rescore gate's arm B
proved (graduation mints the template → the graduated lane + sweep file the rest).

Not exercised on real data: Generic-typed docs (both copies hold none — the exhibit's untyped docs are NULL-typed; the
C1 widening and the 3b flip split are covered by unit pins) and a heading-absent scan (stays untyped on Quick by design).
`realdoc_regression.js` is structurally blind to this change (JS-only, main-process lane).

Sandbox: the owner's instance was RESTARTED on this code (CDP 9223) with `QUIET_REDETECT_ON_TYPE_CHANGE=1` in its
process env (the DARK switch's env mirror; reverts on the next plain restart).
