# Fast on-open road — pipeline env parity gate (Oracle C5, 2026-09-25) — MET

**Change under test:** `_reextractFastCore` (the Review window's on-open "second look" suggestion road,
`reextract-fields-fast`) now spawns Python with the SAME switch env as the Quick/batch shard — `_pipelineSpawnEnv(db)` =
`_autoTitleEnv + _ocrDpiEnv + _anchorCropEnv + _reconcileEnv` — instead of `_ocrDpiEnv` alone. A/B lever (never the
default): `REEXTRACT_FAST_PIPELINE_ENV=0` restores the old switch-less spawn. Root cause + Oracle ruling:
`docs/oracle_log.md` 2026-09-25; the display-only twin stays as a belt (`test_reextract_fast_gate.js`).

## Method
Two throwaway userData copies (`gate_prep.py`, job scratch `%USERPROFILE%\.claude\jobs\68b38f39\tmp\gate\{fastAB,fastABc}`,
mortal): (A) the owner's 2026-09-24 sandbox DB after this morning's redetect (12 waiting docs, incl. the pinned
Meadowvale credit note, doc 4) and (B) Chris's 2026-09-24 sandbox DB (170 needs_review + 7 deferred = 177). For each
arm a DEV instance of the fixed code was launched on the copy (`run_fast_arm.sh`), signed in, Review opened, and
`window.docusnap.reextractFieldsFast(id)` called for every waiting doc (`fast_ab.py`); OFF = env kill set, ON = default.
`fast_ab_cmp.py` diffs the suggestion sets per field: DROPPED / GAINED / CHANGED + any timeout/no-result delta.

## Result
| copy | docs | suggestions OFF | ON | dropped | gained | changed | status deltas |
|---|---|---|---|---|---|---|---|
| A owner | 12 | 1 | 0 | 1 | 0 | 0 | 0 |
| B Chris | 177 | 31 | 8 | 23 | 0 | 0 | 0 |

- **GAINED = 0, CHANGED = 0** on both → no new pre-fill anywhere (the SEND-BACK conditions never fired).
- **Timeouts / no-result deltas = 0** (same 60 s watchdog; imageless runs stay seconds).
- **Every DROPPED suggestion is WRONG**, i.e. a value the committing pipeline refuses and the pill used to offer:
  - 19 × `vat_tax` = `7719.06` on the Ironclad Tool Hire statements — a slice of the footer line
    `VAT Reg No GB 442 7719 06` read as a VAT AMOUNT. The `vat_reg_not_amount` guard (owner-flipped 2026-08-07, false
    alarms 39→0) never reached this road. (Statement has no `vat_tax` field, so the pill had no input to fill — but the
    same read would land on any type that does.)
  - 5 × `statement_number` = `Date` on the UNTYPED Ironclad statements (deferred, detected Statement, type NULL) — the
    caption committed as the reference, the exact 2026-08-31 "cold-committing 'Date' as ref" class. The night's display
    twin could NOT catch these: with no `document_type_slug` it resolves no ref role. The armed Python
    `ref_role_digit_gate` refuses them regardless of type.
- **Pinned exhibit (Oracle C5):** copy A doc 4 (Meadowvale credit note, Credit Note installed) → NO `credit_note_number`
  suggestion ON (nor OFF — the twin already dropped "Meadowvale"; the root cause is now closed one layer down).
- The 8 suggestions that survive ON are identical in value to OFF (subset), so the pill is now "what a Quick reprocess
  would store".

## Fail direction (observed)
ON refuses → the input stays EMPTY with the ordinary required-field prompt; nothing stored on this road (pinned).
Zero filing change: the sweep's filing paths are `tier1Only` (`test_queue_sweep.js` green).

## C7 smoke
Main-process change → needs an app restart. The A/B ON arm IS that smoke: a fresh instance of the fixed code on the
owner's copy offered no ref pill on the Meadowvale credit note. The owner's live sandbox (CDP 9223) still runs the
pre-fix main process until restarted.
