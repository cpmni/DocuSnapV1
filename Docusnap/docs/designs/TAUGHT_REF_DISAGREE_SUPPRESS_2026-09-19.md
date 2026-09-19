# TAUGHT_REF_DISAGREE_SUPPRESS (mig 186) — Slice 1

**Date** 2026-09-19 · **Switch** `taught_ref_disagree_suppress` (env `TAUGHT_REF_DISAGREE_SUPPRESS`) ·
**DARK, seed OFF** · gary root-cause + fix design → Oracle **SIGN-OFF-W/COND** (conditions applied below).

## The live blocker
A custom "Service Worksheet" type (Castellan Security Systems). The operator TAUGHT the "JOB SHEET NO"
box → ref field `CJB-1578` (a Stage-0.5 `template_mapping`, authoritative). Every worksheet also prints
"Job Ref JB-2554". A **generic seeded ref caption** (`keyword._REF_ROLE_CAPTIONS` includes a bare `"Ref"`,
guarded only against party words like Customer/Your/Supplier — not "Job") reads `JB-2554` as a
**keyword-family competitor for the same role**. The corroboration record becomes
`disagree:[{keyword, JB-2554}]`; `trust.js _pageFamilyDisagrees` + `trust_role_disagreement_refuse`
(customer default ON) **HOLD** the doc — forever, on every worksheet. A held doc never graduates, so
confirming siblings never auto-files the rest, and reprocess regenerates the same record. Nothing files.

This is a **cross-supplier office-doc class** (job sheets / service tickets routinely carry both a
job-sheet number and a job reference), not a Castellan quirk.

## The fix (engine record edit + trust guard)
When ON, after the `_shape_ok` block in `engine.extract()` (so the FINAL supplier scope is used), for the
**ref role only**: if the winner is an authoritative Stage-0.5 taught read (`_is_stage05_located`) whose
value **matches** the scope's learned shape (`_shape_ok[ref_key]`), move any competitor whose value is
**off** that learned shape out of `disagree`/`discounted` into a NEW key `suppressed_taught_role`.

- Pure transform `engine._suppress_taught_ref_disagree_record(rec, winner_taught, winner_shape_ok, off_shape)`
  (unit-tested); the engine call site supplies the winner predicates + the real off-shape check.
- `trust.js _pageFamilyDisagrees` does **not** scan `suppressed_taught_role` → the HOLD lifts.
- `trust.js _corrobLicensed` **refuses** the licence on any non-empty `suppressed_taught_role` (Oracle C1,
  the ship-blocker) → the doc files by the NORMAL graduation/threshold route, never a laundered
  corroborated auto-file. Inherited by `_corrobLicensedKeyword` / `_docFullyCorroborated` /
  `refBadgeVerified` / first-fill / rereadHolds.

**Owner's batch behaviour** falls out via existing graduation: the FIRST worksheet holds (cold-start, no
learned shape → condition fails), the operator confirms it, the scope learns `CJB-####`, and every queued
sibling then satisfies the conditions and releases. "One confirm clears the batch."

## Safety (fail-toward-review preserved)
Byte-identical OFF. Holds (no suppression) on: cold-start (no learned shape), a garbled taught read (fails
its own shape), a **same-shape** competitor (a genuine same-field ambiguity), or a non-taught winner.
**DATE role excluded** — the r19(d) Copperfield wrong-date-vs-page-keyword safety stays fully intact
(dates are shape-weak; a correct date is often off-skeleton).

## Oracle conditions (all applied)
- **C1 (ship-blocker):** the suppressed entry goes to `suppressed_taught_role`; `_corrobLicensed` returns
  false on it (never launders into corroborated auto-file). Pinned.
- **C2:** a competitor already in `discounted` is moved too (else `_pageFamilyDisagrees` keeps holding).
- **C3:** filter placed after the `_shape_ok` block, reusing the FINAL `results['supplier_name']` scope
  (no Stage-0.5-time local, no engine recompute — clears no `validation_note`).
- **C4:** ref-role only; the keyword-source fix (a bare "Ref" skipping qualified captions like "Job Ref")
  is a **separate, wider-blast slice** with its own census — NOT bundled here.

## Tests
- `python_backend/tests/test_taught_ref_disagree_suppress.py` — the pure transform: taught-wins-moves,
  garbled/non-taught/same-shape → no move (holds), discounted moved (C2), mixed, no-op, `_is_stage05_located`.
- `database/modules/test_taught_ref_disagree_suppress.js` — the trust.js seam: `_corrobLicensed` false on a
  suppressed record (+ control that WOULD license), `_pageFamilyDisagrees` doesn't scan the key (hold lifts)
  but still fires on a real disagree, `refBadgeVerified` invariance.
- Flip gate (owner, before arming as a customer default): realdoc **M=0** + zero ref-role accuracy drop +
  `wouldFile(ON) ⊇ wouldFile(OFF)` on shape-valid taught winners + a constructed drift cell held under both.

## Follow-on (Slice 2, deferred — owner's "exclude the label" idea)
A durable per-scope preference written at teach-commit / first human resolution ("for this supplier+type,
read `<ref_key>` from the taught box; the 'Job Ref' caption is NOT this role") + a batch "apply to the N
others" action — makes even the FIRST doc file with zero confirms. A new persisted control with its own
poisoning/override/retract surface → its own Oracle pass. Not needed for Slice 1.
