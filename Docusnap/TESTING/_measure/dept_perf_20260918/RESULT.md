# Departments D7 — perf gate (Oracle 2026-09-18 #6) — PASS

The correlated-EXISTS join filter runs on every list/count reader. The corpus M=0 gate is vacuous for latency
(no departments in the corpus), so this measures the filter's cost on a departments-LOADED synthetic corpus:
50,000 documents (29,883 tagged into 1-3 of 8 departments, 20,117 shared), 40 users with 1-3 memberships each.
For each reader, three viewers on the SAME corpus: a MEMBER (join clause active), an ADMIN (visibleDocSql '' =
the pre-D7 fast path = baseline), SYSTEM_ACTOR (unfiltered). Runner: `perf.js` (Electron-as-Node).

## Result (50k docs)
- **Worst absolute list reader (member, join active): 58ms** (`search` over the confirmed list); every other
  list reader < 25ms. All sub-100ms at 50k → sub-second at any realistic small-office corpus.
- **Join-filter cost on non-trivial readers: worst x1.48** (`getStuckQueue`); `search` x1.32; most x1.0. The
  correlated EXISTS + the `document_departments(department_id)` index + the PKs make the filter near-free.
- The count readers show large ratios (x10-14) but on **sub-4ms absolutes** (3.8ms filtered vs 0.3ms empty) —
  trivially fast; excluded from the "meaningful ratio" (a big ratio on a 0.3ms baseline is noise).
- **Per-doc `canAccessDocument`: 204µs/call** — a single open-by-id is 0.2ms, negligible (readers use the SQL
  fragment, not per-doc loops).

## Gate
`worstAbs < 150ms` (58) · `meaningful ratio < 3` (x1.48) · `per-doc < 1000µs` (204) → **PERF PASS**.

Also verified at 20k (worst 22ms). The join model does not regress list latency at scale.

## Conclusion
Oracle #6 cleared. Combined with D2b (intake) + the denial matrix + the intake-seam pins, the departments
feature has passed all of Oracle's before-flip gates. `departments_enabled` stays a per-install admin opt-in
(not a customer default), and `INTAKE_GUARDED` is already true.
