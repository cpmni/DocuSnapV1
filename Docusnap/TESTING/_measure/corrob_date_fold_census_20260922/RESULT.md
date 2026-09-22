# CORROB_DATE_FOLD_WIDE census — 2026-09-22

Arm = the 09-21 baseline env (`base_env1.jsonl`, RR_APP_ENV=1, WIDE unset = OFF) vs the SAME env +
`CORROB_DATE_FOLD_WIDE=1`. 400 test docs (700-corpus). Delta = purely the wide date fold.

## Safety — PASS (M=0)
- docs changed by value (date/ref/overall/wouldFile): **0 / 400**
- hold → FILE: **0** · FILE → hold: **0** · overall change: **0**

WIDE is **byte-identical / inert on the synthetic corpus** — it has no date role whose page-text family reads
a month-name form (`Month D, YYYY`) against a numeric taught box (the Print Tracker shape), so the wide branch
fires 0×. Same pattern gary + Oracle predicted (the corpus is a SAFETY gate, not an efficacy gate).

## Efficacy
Carried by the unit pins (`python_backend/tests/test_corrob_date_fold.py` _WIDE block: fold same-calendar-date /
different-format; disagree on a different day + dmy polarity swap; fail-closed on garble; code unaffected;
byte-identical OFF) + the owner's real Print Tracker exhibit.

## Owed before a flip (Oracle conditions)
- An INJECTED month-name-vs-numeric census exercising BOTH the hold-lift (emit) AND the note-clear paths
  (engine.py:4661/:4795), asserting docs move hold→file / note→clear and NO doc moves to a WRONG file.
- The flip machinery (a mig seeding `corrob_date_fold_wide` OFF + the settings→spawn-env mirror + add to
  TEST_SWITCH_KEYS), then the flip — owner's call.
