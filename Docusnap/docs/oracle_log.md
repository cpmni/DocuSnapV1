# The Oracle — trial log

The Oracle (`.claude/agents/oracle.md`) vets the CONSENSUS of the specialist advisors (007, gary,
oscar, reggie, eric) before a fix ships: he hunts anomalies/missed cases, sanity-checks the OCR &
office-doc reality, and asks whether the average user is actually served. This log records each time he
was used and whether he EARNED HIS KEEP — did he catch something real the specialists missed, or just
echo them? Reviewed periodically to decide if he stays.

Columns: date · topic · specialists' consensus (1 line) · Oracle verdict · **did he add value?** (a
concrete catch / a false alarm / no-op echo) · outcome.

| # | Date | Topic | Consensus (in) | Oracle verdict | Added value? | Outcome |
|---|---|---|---|---|---|---|
| 1 | 2026-07-09 | Cross-supplier authoritative-anchor bleed → crop drift (Anconia teach lands on City Office layout, reads `$0`/`1828987`) + OCR-debris-prefix recovery (`". = 317437"`) + clean-crop whitelist | Agree root cause (`located_ok` proves caption exists, not same layout) + stop destructive sweep (gary Slice 1). FORK: gary=supplier-scope priority (Slice 2) vs 007=geometry position-check suffices. reggie=recover-and-flag. oscar=whitelist-with-preservation-guard, confident-clean, runs before reggie. | SIGN OFF WITH CONDITIONS. Ruled the FORK **for gary** (keep Slice 2) with a concrete same-corner scenario 007's check can't discriminate. 6 conditions. | **YES — strong.** Caught a DANGEROUS INTERACTION no specialist saw: oscar's confident-clean REMOVES the credibility-rejection safety, so a drifted cross-supplier crop reading a *different valid number* could clean to high conf → auto-file wrong (resurrects M=1). Also caught a coordinate-frame bug in 007's helper (offset captured vs label TOP-LEFT, helper compared CENTRE → off by ½ label box) + weak-for-same-corner + no-offset direction-blindness. | Conditions folded in. SHIPPED (branch fix/anchor-bleed-crop-ocr): reggie recovery + Slice 1 (sweep scope) + Slice 2 (supplier-aware priority) + 007① placement gate (Oracle's offset-frame correction, per-axis tol, scoped to cross-supplier). **Corpus VALIDATED: ref 96.3%→99.4%, regressions 46→8 (all poisoned GT), true silent-wrong-auto-file = 0** (the harness's 4 M-docs read 152567 correctly — proven by their own original filenames; GT was mis-confirmed "1/2"). oscar's confident-clean whitelist DEFERRED per his M=1 warning (reggie's flagged recovery covers the read). |

## Running assessment
_(updated as cases accrue — keep/retire recommendation)_
- After case 1: **KEEP — clear value.** On his first outing he caught a cross-cutting interaction bug
  (oscar's fix silently disarming the safety 007's fix relies on) that each specialist missed because
  each only saw their own slice — exactly the seam a vetting layer exists to cover. He also found a
  concrete coordinate-frame error and settled the fork with a distinguishing scenario, not a hand-wave.
  Net: he changed the implementation plan for the better and prevented a likely M=1 regression. Continue.
