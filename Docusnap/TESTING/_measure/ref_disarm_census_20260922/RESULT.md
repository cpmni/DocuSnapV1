# mig-204 census — REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM (2026-09-22)

Arm = the 09-21 baseline env (`base_env1.jsonl`, RR_APP_ENV=1, `ref_confusable_flag` ON, disarm OFF) vs the SAME
env + `REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM=1`. 400 test docs (700-corpus, learning-excluded/confirmed).
Delta = purely the disarm.

## Safety — PASS (M=0)
- docs changed by VALUE (ref/date/overall/wouldFile): **0 / 400**
- hold -> FILE (new auto-file): **0**
- FILE -> hold: **0**
- overall-confidence change: **0**

The disarm is **byte-identical / inert on the synthetic corpus** — the corpus has no near-constant-ref sender
whose read EXACTLY equals a <3-distinct confirmed literal (the Print Tracker shape), so it fires 0×. Same pattern
as the flip-corpus geometry fixes: synthetic corpus is a SAFETY gate, not an efficacy gate.

## Fire denominator
0 fires on the 400-doc corpus. Efficacy is carried by the 6 unit pins
(`python_backend/tests/test_ref_confusable_confirmed_literal_disarm.py`, 6/6) + the owner's real Print Tracker
exhibit. Cross-supplier isolation (test_5, supplier-strict) and the 1-confirm cap<=69/still-held (test_2) are
pinned there.

## Flip recommendation — OWNER'S CALL (held DARK)
Safety is M=0. BUT this is NOT pure fail-toward-review: the `>=2`-confirm branch does a FULL disarm, which removes
the nag and can let a doc become auto-file eligible (a hold -> file LIFT). On a real same-supplier sender that
misreads INTO its own >=2-confirmed exact literal, the disarm would release it. Oracle C3 count-gate (>=2,
supplier-strict, exact `_cmp_norm` match) makes that narrow, and the 1-confirm branch stays capped/held — but the
lift path is why the handover held it out of the 34-switch fail-toward-review batch. Leaving the flip to the owner.
