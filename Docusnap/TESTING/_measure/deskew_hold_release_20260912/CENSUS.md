# Hold-RELEASE arc — pre-design pixel + straightened-read census (2026-09-12)

Falsification-first census for the proposed `deskew_hold_release` arc (mig 163, the MIRROR of mig 162:
when straightening reads the SAME value + refutes a false page-absent note → DROP the note → auto-file
predicate decides). Class writeup: `pendingfeatures.md` 2026-09-12 top entry. AUTO-FILE-enabling tier.

## Cohort
The 6 Saltmarsh Seafoods delivery notes the mig-162 armed-cell gate admitted through the role-note door
(`armed_on.straighten.jsonl`); mig 162's field-adopt refused all 6 by F2 (value unchanged). One supplier,
one template. GT = the DB confirmed `delivery_number`.

## Method
- Live-DB readonly read (`ELECTRON_RUN_AS_NODE`) → id→path→GT→confirmed method (`scratchpad/db_map.js`).
- Pixel render of #130 + #145 (`scratchpad/render_saltmarsh.py`): confirmed the page PRINTS the value.
- Straightened-read census: an env-gated (`DESKEW_HR_DEBUG`) per-door-key dump added to the
  process_docs else-branch (REVERTED after — process_docs.py is byte-clean), run via the realdoc harness
  armed ON arm + `RR_IDS=130,136,139,140,144,145` (mig 153 ON operating point, DPI 200). Raw jsonl in
  `saltmarsh_straighten_reads.jsonl` + `saltmarsh_armed_on.consensus.jsonl`.

## Result (per doc)
| id | GT | raw read | straightened read @conf | st note | F3 lic_kw | disagree | RELEASE decision |
|---|---|---|---|---|---|---|---|
| 130 | DN-92961 | DN-92961 | DN-92961 @89 crop | none | **True** | [] | **FIRES — correct** |
| 139 | DN-79533 | DN-79533 | DN-79533 @89 crop | none | **True** | [] | **FIRES — correct** |
| 140 | DN-38626 | DN-38626 | DN-38626 @89 crop | none | **True** | [] | **FIRES — correct** |
| 144 | DN-26479 | DN-26479 | DN-26479 @89 crop | none | False | mapping=`IN.96479` | REFUSE (F3 disagree) — conservative, would-be-correct |
| 136 | DN-78051 | DN-78051 | DN-78051 @85 crop | **absent** | False | [] | REFUSE (F4 straightened still absent + no keyword) — conservative |
| **145** | **DN-42798** | **DN-42** | **DN-42798 @90 mapping** | absent | False | [] | **REFUSE (F2 value CHANGED → mig-162 territory)** |

## Verdict
- **3/6 release, all CORRECT. 0 wrong releases. 0 misfiles.** The arc recovers #130/#139/#140 (false
  absent note on a value that IS on the page + straightened crop+keyword corroboration, no straightened
  note) to auto-file-eligible; the scope's `isAutoFileEligible` then decides.
- **The landmine #145 is SAFE by F2**: the current fresh read garbles `DN-42798`→`DN-42` (a truncation;
  the confirmed value is `DN-42798`, pixel-verified on the page). Straightening reads the CORRECT
  `DN-42798` — a CHANGED value → the release (value-UNCHANGED) refuses; it is mig-162's case, and mig 162
  itself refuses it (F3 lic_kw False, F4 straightened absent) → #145 stays HELD with `DN-42`, never
  auto-filed. No regression.
- **#144 / #136 refuse conservatively** (F3 straightened disagree; F4 straightened-absent-persists) —
  would-be-correct but the arc does not trust them → they stay held for the human, byte-identical to today.
- **Triple-guard validated:** F2 (value unchanged) + F3 (exact keyword witness, disagree==[]) + F4 (no
  page-absent mark on the straightened field). Each independently refuses at least one of the 3 non-fires.

## Still owed for a FLIP (per the mig-162 gate template)
The 605 corpus census (needs `RR_DB`), the {162/163}×{153} cells, M=0 + wouldFile(ON)⊇wouldFile(OFF) with
every new filer adjudicated at the pixels. This cohort census is the design's falsification, not the flip gate.

## Phase-1 empirical gate (built code, armed OFF vs ON, the 6 docs) — 2026-09-12
mig 163 `deskew_false_absent_reflag` built DARK; ran `DESKEW_FALSE_ABSENT_REFLAG` OFF vs ON, RR_APP_ENV=1, DPI 200,
`RR_IDS=130,136,139,140,144,145` (outputs `reflag_{off,on}.*`):
- **RE-FLAGGED fires on #130 / #139 / #140** — the false ABSENT note → the truthful "confirmed on the straightened
  page — confirm once." hold.
- **#136 / #144 / #145 unchanged** (F4a straightened-still-absent / F3 disagree / F2 value-changed).
- **wouldFile deltas OFF→ON = 0** — removes NO filer (Oracle P2 set-equality). Every doc still held.
Verdict: Phase-1 is safe (fixes the lie on 3/6, removes no checkpoint). The RELEASE (auto-file) leg is SEND BACK.
