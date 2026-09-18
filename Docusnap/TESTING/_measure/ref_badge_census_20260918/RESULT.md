# Badge census — ref_badge_verify_state (mig 185) — 2026-09-18

Flip gate for the DARK ref-badge verify state (`docs/designs/REF_BADGE_VERIFY_2026-09-18.md`, Oracle C-gate).
`M=0` is trivial (presentation-only, no engine value moves). The real gate is: does the calm neutral "Read"
badge flip on any TRAINED scope (alarm-fatigue = the owner's rejected failure mode)?

## Runner
`badge_census.js` over a COPY of `Desktop\Flip Corpus 700\warm_700.db` (never the original), read-only:
```
NODE_PATH=<repo>/node_modules ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
  TESTING/_measure/ref_badge_census_20260918/badge_census.js <copy-of-warm_700.db>
```
For every confirmed doc's REFERENCE-role field it applies `trust.refBadgeVerified` + the renderer's badge rule
and tallies green "High" vs the flip to "Read", split by whether the doc's supplier+type scope is TRAINED
(confirmed_count ≥ 3) or COLD.

## Substrate honesty
- warm_700 has REAL confirmed-scope history → drives the **history leg** (leg c) faithfully.
- warm_700 has **0 corroboration records** (synthetic) → leg (a) is inert here, so this census **OVER-counts**
  "Read" (real corroboration would only turn Read → green). A **worst-case** measurement.
- Every warm doc is a **correctly-confirmed** value → every flip here is a "calm nag", never a caught misread
  (the misread-catch case is pinned separately as the exhibit).
- warm_700 is a **mature** install (each scope has several confirms) → it measures the STEADY STATE, not the
  cold first-days.

## Result (worst-case, mature install)
```
confirmed docs with a non-empty ref value : 700
  scope TRAINED (>=3 confirmed)            : 700 (100.0%)
  scope COLD    (<3 confirmed)             : 0
confident refs (conf>=70)                 : 700
  stay GREEN "High" (verified)            : 700 (100.0%)   [all via scope history >=3, leg c]
  flip to "Read" (unverified)             : 0   (0.0%)
    FLIPS ON A TRAINED SCOPE (must be 0)   : 0   PASS
```

## Reading
- **Cond 4 (zero flips on a trained scope) — PASS**, empirically, on 700 real-shaped scopes. Structurally it
  cannot fail (the history leg greens any scope with ≥3 confirmed history), and this confirms the leg fires on
  real confirmed scopes rather than mis-keying.
- **Fade-to-green demonstrated:** once a supplier+type has ≥3 confirms, its confident ref is green again — the
  badge is invisible on a mature install (0 nag). This is the property the owner's removed positive-only line
  lacked.
- **Cond 5 (cold flips genuinely single-witness) — structural:** a flip requires conf≥70 AND not-corroborated
  AND not-authoritative AND no scope history = single-witness by definition.

## NOT measured here (needs a real-scan cold run)
The **cold-install "Read" volume** — how often a BRAND-NEW supplier's first 1-2 confident refs (before the 3rd
confirm) show "Read" on a real install. warm_700 has no cold scopes and no corroboration, so the true cold rate
(where some cold refs ARE corroborated → green even cold) is `≤` the worst case "every confident uncorroborated
first ref". To measure it faithfully: process a batch of the real 605 corpus scans through the engine COLD
(fresh DB, no history) and report the ref corroboration rate = the real green-vs-Read split on first reads.
This is informational (not a pass/fail gate — cond 4 is the gate) and is the owner's call before flipping.

## Verdict
The load-bearing flip gate (no alarm on trained scopes) is **met**. Flip remains the owner's call; the one open
number is the early-days cold "Read" frequency (above), which only bounds how chatty the badge is on day one and
never affects filing.
