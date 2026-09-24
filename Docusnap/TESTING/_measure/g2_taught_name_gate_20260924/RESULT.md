# G2 gate (b) — taught_name_disagree_refuse (mig 214, DARK) — Oracle conditions (2026-09-24)

**Bar:** realdoc 727 + sandbox, OFF vs ON via `TAUGHT_NAME_DISAGREE_REFUSE`: extraction md5 identical (a JS-only gate can
not change Python output) · `wouldFile(ON) ⊆ wouldFile(OFF)` · every lost filer listed (key, box, witness), each
box-wrong or the Fembank class, else SEND BACK · C7 flood table.

**Arms** (the G2 tree `37b61d0` from a worktree via `RR_PY_ROOT`, `RR_APP_ENV=1`, 200 DPI): the owner's 727 copy OFF/ON,
Chris's 09-23 sandbox copy (67 confirmed, all six 09-23 switches ON) OFF/ON.

## Owner's 727
| check | result |
|---|---|
| G2off md5 == the R1/G1 arm | **TRUE** (`3c41c1f806b2`) — both dark switches off = a no-op |
| extraction fields OFF vs ON | **identical** |
| wouldFile OFF → ON | 517 → 502 · gained **0** · lost **15** |
| the 15 lost filers, ALL `disagreeing-read:customer_name` | #7 `Corvus Securitv` (garble) · #19 `Meadowvale Farn` (garble) · #75 `Customer` (label) · #82 `Customer` (label; the box a human later corrected to Ashcombe Care Homes Ltd) · #134/#135/#141/#142 `Stonegate Property` (clipped `… Mgmt`) · #151 `Ashcombe Care Homes I` (clip) · #157 `vineficher Print Studio` (garble) · #224 `arch .& Hollow Cafe Co` (garble, new in the live re-read) · #225 `Ashcombe Care Homes` (clipped `… Ltd`) · #228 `lalcyon Leisure Group` (garble, new) · #264 `Kinafisher Print Studio` (garble) · **#262 `Fernbank Veterinary Clinic` = the ONE pinned trade-off** (the page witness `Fembank` is the misread) |
| box-wrong : correct-box-held | **14 : 1** (the pinned class) ✔ |
| already-held docs whose REASON moved | 13 Print Tracker docs `disagreeing-read:date` → `disagreeing-read:customer` (row order): boxes `Workforce Training Springf` ×9 (clipped `… Springfield Rd`) and `Utax` ×4 (a printer MAKE in the customer box; witness `John McCaffrey & Co 2`) — every box wrong; no filing change (held either way). When the mig-208 date fold lifts the date hold, these stay held by this leg with the "re-teach a wider box" cue — correct. |
| C7 flood check | (supplier, field) groups: Copperfield|customer_name 2 (labels) · Saltmarsh 4 (clips) · Thornbury 2 · Vellum 2 · Northgate 2 · Print Tracker|customer 13 (already held; boxes wrong). No group of ≥3 human-confirmed-as-is correct boxes → **no flood** |

## Chris's sandbox (67)
extraction fields identical · wouldFile 53 → 47 · lost exactly **#65 `Larch & Hollaw cat. -.` · #67 `Ashcombe Care Homec` ·
#69 `Customer` · #76 `Customer` · #78 `Larch & Hollow Cafe C` · #79 `Ashcombe Care Homes`** = the six wrong customer names of
his card 1 · gained 0.

## Verdict
**Gate (b) MET:** identical extraction on both DBs; ON ⊆ OFF; 20 of the 21 lost filers are a wrong box (label / clip /
garble / wrong row), the 21st is the pinned `Fernbank` class; no flood. Not run: a second ON pass (the JS gate is
deterministic over identical extraction). mig 214 is flip-ready on this evidence; the Oracle's C7 flood table must be
re-checked on the live install at flip time (the Print Tracker `customer` box drifts to a wrong row on 13 docs — a
re-teach, not a scope breaker).
