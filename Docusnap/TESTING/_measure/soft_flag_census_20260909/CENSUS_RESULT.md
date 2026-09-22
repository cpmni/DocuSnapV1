# optional_soft_flag_autofile (mig 142) — flip-gate census, 2026-09-09

Isolated A/B on `reset_arm_20260908/arm137.db` (147 confirmed docs, Ironbridge 105 + Larkspur 42),
`RR_APP_ENV=1`, `RR_ALLOW_ARMED=1`. OFF = `off.db` (arc absent). ON = `on.db`
(`optional_soft_flag_autofile='true'`; operating point 1/29 TEST_SWITCH_KEYS ON — the arc in isolation).

## Safety — PASS
- Silent wrong auto-file (M): OFF **4** → ON **4** → delta 0.
- Wrong-TYPE auto-file: 0 → 0.
- Accuracy: type/supplier/ref/date 100/100/100/97.3 — **byte-identical OFF vs ON** (no drop).
- wouldFile regressions (filed OFF, not ON): **0** → wouldFile(ON) ⊇ wouldFile(OFF) holds.
- New WRONG auto-files: **0**. New filers: **0**.

## Efficacy — UNMEASURED on this corpus (0 fires)
arm137 is Ironbridge + Larkspur; its held docs are held by ROLE issues / below-floor / non-graduated scopes,
NOT by a soft optional-field note on a graduated scope. The owner's exhibit (customer_name "Stonegate Property
Mgmt" @70 "doesn't read like a name" on a graduated Marlowe delivery note) is on the owner's LIVE install, not
in arm137 — so the arc had nothing to fire on here (0 new filers). The census therefore proves SAFETY (the arc
changes nothing harmful) but cannot demonstrate efficacy on this corpus.

**Wiring/logic proven separately:** `test_optional_soft_flag.js` (the pure `isSoftAdvisory` asymmetry + the
source-scan of the gated wiring) + `test_migration142`. Full suite 330/330.

## Efficacy demonstration path (owed)
The owner's `-TEST` build (with the arc armed) on their real Marlowe delivery notes IS the efficacy demo — those
are the exact target (graduated sender + a customer_name wordness hold). Alternatively a synthetic
graduated-scope fixture with a soft optional-field note. Until then: SAFE + correctly-wired, efficacy shown by
the owner's live test.

## Remaining flip-gate item
**Oracle sign-off** on the owner exhibit + gary design + this census (safety) + the owner's live efficacy demo,
before the switch is flipped ON for a customer build. Arc stays DARK. Logs: `off.log`/`on.log`, consensus
`off.jsonl`/`on.jsonl`; compare via `../clip_census_20260909/compare.js`.
