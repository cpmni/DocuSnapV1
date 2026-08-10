# Overnight working notes — 2026-08-10 → 08-11 (autonomous)

Scratch state so nothing is lost to a context compaction. Owner asleep; standing rules apply —
default-OFF flags, no flips, no live-DB writes, no destructive actions.

Branch `feat/teach-side-overnight`, HEAD at start of night `f0004d6`.

## Owner's instruction for the night
1. Finish the `I`→`1` work using the advisors.
2. Compact.
3. Re-run last night's audits and tests.
4. Have Chris revisit the EXACT same tests in his sandbox under the SAME conditions, and compare
   his new findings with yesterday's.

## Where the `I`→`1` work stands

**Defect.** Page prints `PI/26/6000`; pipeline commits `P1/26/6000`. Crop is clean and legible —
rendered and read by eye first. A READING failure, not placement.

**Measured (my probe, 5 live docs, PSM 7):** raw greyscale is correct **5/5**; light 2/5; heavy 1/5;
struct 0/5. Raw is NOT a rung today.

**Step 0 probe (mine, after oscar reported):** native/no-resample PSM 7 correct 5/5; adding a QUIET
ZONE hurts (flips 0023, drops confidence) — **refutes oscar's step-1 prediction**; x2 BICUBIC wrong
4/5, so the filter is not the fault, **the upsample itself is**. Ink band 18–19px. Installed model is
standard `tessdata` 4.1MB integer LSTM, **not** `tessdata_best` (a real untested lever; I did not
download a model unilaterally overnight).

**VERIFIED MYSELF against the ladder's own `_read_lines_full`** (not `image_to_string`, which was
gary's fidelity objection) — which exit each document takes:

| doc | exit | winner |
|---|---|---|
| 0023 | SUB-FLOOR | struct/psm7 `P1/26/6000` |
| 0025 | **GATE (>=60)** | struct/psm7 `P1/26/9923` |
| 0019 | SUB-FLOOR | struct/psm7 `P1/26/2247` |
| 0022 | **GATE (>=60)** | light/psm7 `P1/26/3711` |
| 0029 | SUB-FLOOR | struct/psm7 `P1/26/1792` |

**This confirms gary's load-bearing correction: 2 of 5 return through the GATE, not the sub-floor
comparator, so a comparator-only fix heals at most 3/5.** The fix must sit at BOTH exits.

**oscar (OCR) — key points.** Confidence is not comparable across preps because processing removes
the antialiasing grey that separates a serif `I` from `1`; the LSTM reads the GREYSCALE copy and was
trained on antialiased renders, so sharpened/binarised input is out-of-distribution; the
bidirectional LSTM sees `I` in an 80%-digit context and is biased toward a digit. Whitelist,
`--user-patterns` and `classify_bln_numeric_mode` all ruled out (the last is inert under OEM 3 AND
biased toward digits). LANCZOS is the wrong filter for small glyph text (ringing). Prep AGREEMENT
must NOT be built — prior art `docs/oracle_log.md` 2026-08-03 measured same-pixel witnesses 5:1
false:true, and light+heavy agree on `P1` on 0022/0029.

**gary (Python) — the design: the RAW WITNESS.** Read the crop once unprocessed. It is a WITNESS,
never a candidate: it may change the committed string ONLY when it differs from what the ladder was
already returning by exactly ONE confusable-glyph substitution AT THE SAME LENGTH. Scope
`CODE_READ_RAW_WITNESS=1` AND `verify_fn is None` AND `val_type in {alphanumeric, reference_code}`
AND `crop.width < 300`. Applied at BOTH exits via one helper. Confusable pairs reuse
`ocr_corrector._is_confusion`. Verified 5/5 on the measured rows; the 0030 counter-exhibit is
excluded BY CONSTRUCTION (different length + fails the debris test). Bridge in `_anchorCropEnv`,
toggle + `test_settings_wiring.js` pin in the SAME commit.

**gary's corrections to my brief (all verified or accepted):** the gate-vs-sub-floor split above;
`_light_prep` does NOT autocontrast (stale docstring — my table's label was wrong); "raw+light agree
3/5" is really 2/5; voting refuted; the gate bar "all eight other lanes byte-identical" is NOT
achievable because `keyword._infer_validation` maps `*_no`/`*_ref`/`reference*` to `alphanumeric`,
so `po_ref`/`account_no`/`vat_no`/serials are IN SCOPE by design.

**THE TIME BOMB (gary, verified by him at source).** Stage 2.5b (`engine.py:6686-6701`) has NO
`template_mapping` exemption and `ocr_corrector.LETTER_TO_DIGIT['I'] = '1'`. Once the scope's learned
template is `UD/DD/DDDD`, `try_correct('PI/26/6000','UD/DD/DDDD')` returns `('P1/26/6000', 20)` →
conf `min(95,90+20)=95`, method `template_mapping+corrected`, **no note**. It does not fire today
ONLY because the poisoned history is separator-free (8 chars) and `ocr_corrector.py:209` bails on a
length mismatch. **Arming `CODE_SEPARATOR_STRUCTURE_GUARD` creates 10-char confirmed values and
eventually re-breaks this.** Oracle was asked to rule on whether sepguard should be held back.

**Status:** Oracle pass RUNNING on the reconciled design. Nothing built.

## Other work in flight
- `stress_test/run_all_suites.py` (NEW) — runs every Python + JS test in its own process, because
  `pytest tests/` aborts (a script-style file `sys.exit`s at import). Running in background; writes
  `~/Desktop/TESTING/_measure/suite_results_20260810.json`.
- Chris re-run NOT started. Last night's round is `docs/CHRIS_FULL_APP_REVIEW_2026-08-10.md`
  ("overnight round"): fresh install, own userData/output, admin via the real first-run flow, seeded
  with the owner's taught state (7 templates), 200 scanned docs imported, nothing confirmed first.
  His top findings were (1) the wrong-company misfile on 18 documents at 95%, (2) the queue claiming
  200 needed review when 43 did, (3) praise for the teach wizard and filing.
  **KEY WRINKLE for the comparison: finding 1 was FIXED today but ships DEFAULT OFF**
  (`TEMPLATE_IDENTITY_ON_PAGE`), so a pure defaults re-run would still show it. Precedent for arming
  flags in Chris's launch env and saying so exists — the 2026-08-09 round did exactly that.

## Do not forget
- The app is RUNNING (owner left it up, ~21:53, 4-5 electron processes). Measure against the
  SNAPSHOT `~/Desktop/TESTING/_measure/live_20260810.db`, never the live DB.
- A Chris sandbox must use `DOCUSNAP_USERDATA` + port 9223 and kill any prior 9223 instance.
