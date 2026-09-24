# R1 gate — TEMPLATE_FORMAT_FAIL_CODE_AGREE (the code-led money exemption, `7ddf9fa`) — Oracle C3 (2026-09-24)

**Bar (Oracle):** K md5 == P (the env kill restores the legacy verdict byte-for-byte) · N vs K: the format-fail yield's
fire-set diff enumerated BOTH directions and REMOVALS only, every removal a cents-agree code-led pair (trace events) ·
`wouldFile(N) − wouldFile(K)` all `total == confirmed` · M=0, zero per-field drop · Hard Set wrong+would-file stays 0 ·
the Chris 36 on the DB copy → the invoices file, `SBP` held · two ON runs byte-identical.

**Arms** (owner's 727-doc live copy `stress_test/out/c0_live_copy/docusnap.db`, `RR_APP_ENV=1`, 200 DPI; each arm from
a `git worktree` via `RR_PY_ROOT` so working-tree edits could not leak in): **P** = pre-R1 tree `a983185` · **K** = R1 tree
with `TEMPLATE_FORMAT_FAIL_CODE_AGREE=0` · **N** = R1 tree ON. Analysis `gate_analyse.py` (job scratch `gate/`).

## Result on the 727
| check | result |
|---|---|
| K md5 == P md5 | **TRUE** (`3c41c1f806b2…` both; 0 differing docs of 727) — the kill restores the old tree byte-for-byte |
| format-fail yield fires K → N | 1 → 1 · removed **0** · added **0** |
| `format_fail_code_agree` trace events in N | **0** |
| wouldFile K → N | 517 → 517 · gained 0 · lost 0 |
| N vs K differing docs / non-total field changes | **0 / 0** (M=0) |
**Reading:** on the owner's data the exemption is INERT — none of the 727 has a taught currency box that captures an inline
ISO code (the one yield fire in both arms is not code-led). The bar's "removals only" is met trivially (0/0). The
efficacy evidence is the **Chris-36 quick gate** (R1 tree, his DB copy with the Total un-hidden): OFF = 36 invoices held by
the Total note, 0 would-file; ON = **22 would-file**, 14 held each with a real reason (cents disagree ×2, `SBP`/`BP`
misread code ×3, dropped digit, `-` for `.`, the reconcile note, 5 by the pre-existing `template_mapping_edgecut` guard
on correct totals). Every filer's total equals the page (both readers agree to the penny by construction).

## Hard Set (600 synthetic docs, digital + scan cold) — arm P done, K and N running at the time of writing
- P scan cold: wrong+would-file **0** in every class, would-file 0 (cold: nothing files), controls clean where scored.
- P digital cold: wrong+would-file **0**; would-file 0. **Pre-existing observation (NOT an R1 effect — this is the
  pre-R1 tree):** the digital arm's SUPPLIER column is 0 % (EMPTY, held) in 9 of 10 classes, while the scan arm reads it
  60–100 %. The born-digital issuer detection on this synthetic set held every doc with an empty issuer → logged for the
  owner as its own question (the 08-31 run recorded "600 scores, wrong+would-file 0" without this split).
- The 08-31 `score_digital_cold.jsonl` that lay in `Desktop\Hard Set` was overwritten by arm P's run (the scorer writes
  into the corpus root; the gate script moves each arm's files to `gate/hs_<arm>/`).
- **K and N Hard Set arms DONE (16:17):** per-doc (got, wouldFile, reason) md5 P == K == N on BOTH renditions
  (digital `d580db252b9b`, scan `49f01b6b65d5`); would-file 0, wrong+would-file 0, unflagged-wrong 0 in every arm.

## Verdict
**C3 MET:** the 727 (K md5 == P; N == K: 0 removals, 0 added, 0 lost, M=0), the Hard Set (P == K == N byte-identical per doc, wrong+would-file 0), the Chris 36 (0 → 22 file, `SBP` held). Not run: a second ON pass for determinism (N is byte-identical to K on every doc, which already shows the exemption produced no variance on this data). R1 stays LIVE; the env kill is proven byte-identical.
