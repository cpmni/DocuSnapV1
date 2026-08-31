# HANDOVER 2026-08-01 OVERNIGHT (autonomous session, owner asleep)

**Branch** `feat/reprocess-throughput-autostraighten`, **PUSHED, origin in sync.** Continues
`HANDOVER_2026-07-31_NIGHT.md`. Owner's overnight brief: (1) the auto-file-on-confirm fixes
(= Catch-up Filing), (2) design+build tests probing teach wizard / template manager / review
robustness, (3) thorough exploration of anchor/value reliability + new validation methods for
more auto-commits. All changes safe + revertible (kill-switched / dark / backed up).

## TL;DR — the evening + night in one paragraph
The owner's "Worksh Eet" screenshot unravelled into the deepest extraction dig in weeks: dpi sweep
(no flawless res exists; 225/280/300 only clean type-detectors), a cross-res escalation design that
Oracle ultimately PARKED after tracing that its own trigger could never fire on the class it was
built for, and the REAL fixes shipped instead: **clipped-suffix reconciliation** (`36a4a32`, ON —
heals the 'V-69523' class from the candidate ledger, ref 91.8→94.5%, M 8→7), the **garbled-anchor
remediation sweep** (`15e9846`, purged the poisoned 'Inwotce No.' row, registration audit condition
then RE-MET on clean landmarks by #141), then overnight: **Catch-up slices 1+2** (`376ed23`+
`621a105`, slice 2 dark), **template hardening** (`0495458`), and **gary's S-A/B/C/D validation
designs** banked for Oracle. Realdoc at wrap: 202 docs, ref 96.5%, type/supplier 100%, M=5 (all
GT-poison-suspect), regressions 8.

## COMMITTED tonight (newest first)
- **`0495458`** fix(templates): mapping geometry validation + reassign target guard + HONEST audit
  outcomes + `test_template_adversarial.js`. PIN: anchor==target stays allowed (teach POSITION-ONLY
  issuer mapping — caught as my own near-encroachment during the change).
- **`621a105`** feat(sweep): Catch-up SLICE 2 DARK — `_reextractFastCore` refactor (IPC byte-
  identical), `sweep-scope-candidates` READ-ONLY IPC (setting `scope_sweep_enabled` default OFF +
  env `SCOPE_SWEEP`), pure `sweepPredicate.js` + 22 pins (better-fresh-value fails; stored-empty+
  fresh-value HELD; overlay keeps stored conf on fresh-empty).
- **`376ed23`** feat(trust): Catch-up SLICE 1 — mig 57 `confirmed_via` + HUMAN-only graduation
  window + corrections-SPAN in the same total order (Oracle SEAM 1). Realdoc vs a mig-applied DB
  COPY (`RR_DB`): BYTE-IDENTICAL. test_scope_trust §23 pins.
- **`15e9846`** chore(scripts): `sweep-garbled-anchors.js` (dry-run/--apply+backup). Live run: 29
  scanned, exactly 1 flagged+purged (Ridgeway 'Inwotce No.'), 0 false flags. Backup
  `docusnap.backup-2026-07-31T21-16-08-655Z.db` + deleted-rows JSON beside the live DB.
- **`c53327b`** docs + **`36a4a32`** feat(extraction): CLIPPED-SUFFIX RECONCILIATION (kill
  `CANDIDATE_SUFFIX_RECONCILE`, **ON**) — label-confirmed clip ('V-69523') healed by adopting the
  discarded fuller keyword read (suffix + digit-identity + shape-pass + confirmed-prefix membership);
  flag-only lane without prefix support; NO corrected_to emitted (dodges the reprocess-merge
  operator-grade seam). OFF byte-identical; ON heals #121/123/124/136/137, M 8→7 zero new members.

## Verification state (honest)
- Every commit gated: unit pins green (suffix 25 · sweep 22 · scope-trust full suite · template
  adversarial 24 · neighbours), realdoc byte-identical gates for mig-57 and suffix-OFF, kill
  switches live-verified (=0 restores 'V-69523').
- Realdoc runs tonight: baseline 182-doc (M=8) → suffix-ON (M=7) → post-remediation 202-doc
  (M=5, corpus grew — owner confirmed the 20 worksheets before bed). M residual {33,78,65,86,154} =
  all from the known GT-poison-suspect class (#78's GT '0-82268' is itself a clipped confirm).
- **Slices 3+4 of Catch-up (renderer consent UI + flip) deliberately NOT built** — renderer work
  needs owner visual smoke; the design is signed, slices 1+2 are the risky seams and they're in.
- **gary's S-A/B/C/D NOT built** — advisor discipline: Oracle must vet first (gary flagged one
  deviation explicitly for him: keyword_override NOT exempt from S-A).

## THE BIG FINDING (read before any anchor/registration work)
#141 ('21/07/2026' committed to delivery_number @88 silent, CLEAN label row): gary traced the win —
**Tier-A (engine.py:3764) never consults confidence; `located` is BY FIAT for anchor_registration
(anchor.py:1376 membership, granted even after the relocate rung PROVED label_off_taught_position);
`ocr_min_conf` is None for structured fields → quality-blind; the `alphanumeric` validation pattern
contains `/` → a date scores coverage 1.0.** The registration rung also resurrects shape-failing
reads (anchor.py:1175-1177) and is `_LABEL_CONFIRMED` (shape-exempt at anchor.py:1252 + engine.py:
4790). One-sided contradiction: KEYWORD_ANCHOR_CORROB excludes registration as an "independence
fraud" WITNESS, yet Tier-A lets it WIN outright. Fix designs = S-A/S-C in `pendingfeatures.md`
("Validation slices S-A/B/C/D"). Registration fit-audit condition is MET (clean-landmark drift
0.047 norm vs the 0.02 inlier bar) — S-D is the bounded investigation plan.

## FIRST ACTIONS (next session)
1. **Oracle-vet gary's S-A/B/C/D** (`pendingfeatures.md` has the full designs + PINs + gates;
   `ae1d…` agent transcript has the long form). Build order after sign-off: S-A (deterministic
   date-in-ref flag) → S-C dark (blind-geometry disagreement reconciliation — the decision-layer
   fix) → S-B (length profile) → S-D investigation. S-B2 (confidence corroboration, the direct
   more-auto-commits lever) SEPARATE, never bundled.
2. **Catch-up slice 3** (renderer pills + banner + untick + accept path w/ fingerprint re-check +
   server-side re-validate + `confirmed_via='scope_sweep'`) + slice 4 gates — owner present.
3. Owner in-app: set `ocr_dpi` 200→300 (Settings→Processing — still on the speed-test value, the
   original garble source); teach one-step visual smoke still pending from yesterday.
4. Coverage gaps NOT yet built (inventory, full list in the Explore transcript `a0c8…`): teach
   `doCommit` zero coverage + non-transactional; ⊕ `pendingAnchors` staging untested; reviewService
   type-deleted fallback writes denorm from literal 'invoice_number'; XML `esc` lacks quote
   escaping; confirm-vs-reprocess unlocked; `_backupDbBeforeMerge` failure path untested.

## KEY FACTS / SWITCHES
- New switches: `CANDIDATE_SUFFIX_RECONCILE` (ON, =0 kills) · `scope_sweep_enabled` setting
  (OFF) + `SCOPE_SWEEP` env (=1 force / =0 hard-off) · mig 57 `confirmed_via` (NULL=human).
- Parked with revival gates (`pendingfeatures.md`): XRES escalation both rungs (measured
  withhold-abstain count) · oscar crop matte fix (own measured heal) · 225 "Faster" preset
  (225 evidence CONFOUNDED both ways until suffix-guard+remediation era re-measure; UI swap
  reverted, uncommitted).
- Oracle log updated ×2 (the fold-blindness catch + the amended-verdict reversal — "the fix was
  never at a different resolution, it was at the merge").
- Memories: `project_xres_escalation_design_20260731` (rewritten) · `project_overnight_20260801`
  (new) · index updated.
- Harness notes: single-doc traced pipeline runner = scratchpad `run_one_traced.js` (rebuild if
  needed: spawns process_docs with the realdoc snapshot + --trace --slice-dir); sweep smoke needs
  `SCOPE_SWEEP=1` + a queued scope (queue is EMPTY at wrap — owner confirmed everything).
- Agents tonight: Explore (coverage inventory), gary ×1 (S-A/B/C/D), Oracle ×2 earlier (xres verdict
  + amended). All advisory outputs relayed/banked.
