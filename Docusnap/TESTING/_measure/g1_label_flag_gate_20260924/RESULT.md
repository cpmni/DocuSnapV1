# G1 gate — name_value_label_flag (mig 213, DARK) — Oracle C8 (2026-09-24)

**Bar:** realdoc 727 + Hard Set OFF byte-identical; ON: list EVERY new hold — each must be a caption / anchor / clip;
any REAL name held = SEND BACK.

**Arms** (owner's 727-doc live copy, `RR_APP_ENV=1`, 200 DPI, the G1 tree `a3371dc` from a worktree via `RR_PY_ROOT`):
G1off = `NAME_VALUE_LABEL_FLAG=0` · G1on = `=1`. Analysis in the job scratch `gate/`.

| check | result |
|---|---|
| G1off md5 == the R1-on arm N (the switch off is a no-op) | **TRUE** (`3c41c1f806b2`, 0 differing docs) |
| G1on vs G1off: new holds | **2**, both `customer_name` = the LABEL WORD `Customer` (docs 75, 82 — the Copperfield taught box on the label line; label `Customer`, anchor `Customer`), method `template_mapping+nonname_flag`, note "This reads as the label ‘Customer’, not a name — please check the value." |
| other field changes | **0** (M=0) |
| wouldFile off → on | 517 → 515 · gained 0 · lost exactly the two above |
| real names held | **0** |
| trace `name_value_label_flag` events | 2 (= the two holds) |
| Hard Set | not re-run for G1: the flag is env-gated (OFF byte-identical is proven above on the 727); the Hard Set has no taught customer boxes in the cold arm |

**Verdict: C8 MET** — every new hold is the caption itself; nothing real was held; OFF is byte-identical. Flip-ready on this
evidence (doc 82's box is the one a human later corrected to `Ashcombe Care Homes Ltd`; the flag would have held it first).
