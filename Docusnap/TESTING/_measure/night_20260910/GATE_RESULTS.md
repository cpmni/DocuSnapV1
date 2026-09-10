# Night 2026-09-10 — flip-gate measurements (OFF vs ON on a copy of the owner's LIVE DB)

Harness: scratchpad `gate/gate.js` (reprocess stored_path PDFs OFF vs ON per arc's env, dump every field +
`trust.isAutoFileEligible`, diff). The 605 corpus is NOT in the reset live DB, so this proves NO-REGRESSION on
the owner's OWN docs (the class-relevant Vellum/Thornbury docs ARE present); the corpus M=0 across all
suppliers is still owner-owed. No live-DB writes (read + reprocess only).

## mig 157 `template_drift_override_guard` — 19 Vellum & Crane sales_order docs (231-251)
ONLY ONE change: **#243 customer_name 'CH1 2HU' -> 'Larch & Hollow Cafe Co'** (postcode -> the NAME — the
correction). 18 docs byte-identical. wouldAutoFile GAINED 0 / LOST 0 → **M-CHECK: wouldAutoFile(ON) ⊆
wouldAutoFile(OFF) = YES** (no new auto-file; the one change is a pure correction, still auto-file-eligible).
The 0.8 floor flipped only the 0.667 phantom "Chester" match; every clean "Customer" locate unchanged.
VERDICT: clean on the class. Flip needs the 605 M=0 + the match_score census (C2) still.

## mig 154 `trust_ref_role_shape` — 21 Thornbury invoices (168-188)
0 value/note changes, 0 wouldAutoFile gained/lost → **M=0 subset = YES** (no regression on the confirmed set).
The HEAL itself is pinned (test_scope_trust §25) + was root-caused on the originally-held 20; this gate is the
no-regression half on the currently-confirmed docs. Flip needs the live re-judge of any still-held Thornbury.

## mig 156 `name_role_nonname_flag` — 19 Vellum & Crane sales_order docs (231-251)
ONLY #243 flagged: customer_name = 'CH1 2HU' (postcode, drift-guard OFF in this arm) → +NOTE →
wouldAutoFile true->false (correctly HELD). The other 18 (Corvus, Pemberton, Larch & Hollow, …real company
names) → NO note, NO change. **0 false positives on real names; wouldAutoFile GAINED 0 / LOST 1 (subset = YES
— the guard only REMOVES auto-files).** Precision confirmed on the class. Note: with mig-157 ON, #243 reads
the NAME → the non-name guard is then vacuous on it (a last-resort backstop, as designed — the two compose
correctly). Flip needs the accepted_names batch-stall check + the 605 fire census.

## Net
All three arcs: **M=0 (no new silent auto-file) on the owner's real docs.** drift-override delivers the
correction the owner wanted; non-name is a clean backstop; ref-role is regression-free. The full 605 M=0 +
each arc's census stay owner-owed before a customer flip.
