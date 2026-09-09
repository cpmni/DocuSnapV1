# template_code_read_widen (mig 141) — flip-gate census, 2026-09-09

Clean isolated A/B on `reset_arm_20260908/arm137.db` (147 confirmed docs, Ironbridge 105 + Larkspur 42),
`RR_APP_ENV=1`, `RR_ALLOW_ARMED=1`. OFF = `census_off.db` (arc absent). ON = `census_on.db`
(`template_code_read_widen='true'`; operating point reported 1/28 TEST_SWITCH_KEYS ON — the arc in ISOLATION,
every other DARK arc off).

## Safety — PASS
- Silent wrong auto-file (M): OFF **4** → ON **4** → **delta 0** (the arc adds no wrong auto-file; the 4 are the
  pre-existing baseline set, untouched).
- Wrong-TYPE auto-file: 0 → 0.
- Accuracy: type 100% / supplier 100% / ref 100% / date 97.3% (143/147) — **byte-identical OFF vs ON** (no drop).
- wouldFile regressions (filed OFF, not ON): **0** → wouldFile(ON) ⊇ wouldFile(OFF) holds.
- New WRONG auto-files (new filer, value ≠ GT): **0**.

## Efficacy — POSITIVE
- **31 fires** (method carries `readwiden`): every recovered ref value == GT (`onCorrect:true` on all 31). Spread:
  invoice, purchase_order, sales_order, delivery_note. Methods observed: `template_mapping_readwiden`,
  `…_readwiden_edgegrow`, `…_readwiden_edgecut+corrob_verified` (composes cleanly with the existing edge/corrob legs).
- **4 NEW correct auto-files** (ids 22, 28, 110, 115): held on OFF, now auto-file on ON, ref+date == GT — the arc
  removed the leading-glyph-clip flag that was the only blocker. 0 new wrong.
- FIXED (was wrong-auto-filing OFF → correct ON): 0 (the baseline's 4 wrong auto-files are a different, untouched set).

## Scope caveat
arm137 is Ironbridge + Larkspur, NOT the Marlowe/Ridgeway dockets from the owner's exhibit (a different reset than
007's live DB). Same clip CLASS (page-width variance), so the result generalises; a docket-specific efficacy run
would need the Demo Docs docket templates. The safety result is corpus-wide and decisive.

## Remaining flip-gate item
**Oracle sign-off** (the standing advisor+Oracle gate) on the 007 root cause + gary design + this census, before the
switch is flipped ON for a customer build. Arc stays DARK until then. Logs: `off.log`/`on.log`, consensus
`off.jsonl`/`on.jsonl`, `compare.js`.
