# Flip-census prep — mig 154 / 156 / 157 (2026-09-11)

Ready-to-fire runner for the owner-owed **605 M=0** safety half of each arc's flip gate.
Census is HELD (owner runs it — the harness opens the live DB, which is blocked to Claude's
sandbox). Everything here is verified against the code; nothing was executed.

## The three live arcs + their env levers (verified in source)
| Arc | key | env var | ON (fix) | OFF (old / byte-identical) | read site |
|---|---|---|---|---|---|
| 154 | `trust_ref_role_shape` | `TRUST_REF_ROLE_SHAPE` | `1` | `0` | trust.js:426 (`_refRoleShapeEnabled`) |
| 156 | `name_role_nonname_flag` | `NAME_ROLE_NONNAME_FLAG` | `1` | `0` (`!= "0"`) | engine.py:11064 |
| 157 | `template_drift_override_guard` | `TEMPLATE_DRIFT_OVERRIDE_GUARD` | `1` | `0`/unset (`== "0"` ⇒ old relocate) | template_mapper.py:2867 |

Env vars forwarded to the Python subprocess at `realdoc_regression.js:127`; 154 is read in the
Node process by trust.js. So setting the env var on the harness invocation controls the arc — **no
DB write needed** to toggle a switch OFF vs ON.

## The clean single-arc A/B (arm137 baseline)
`RR_APP_ENV=0` returns `{}` for the app-spawn env (`realdoc_regression.js:103`) = the historical
no-DARK-switch baseline = **arm137 release shape** (every DARK switch OFF). On that base, the one
explicit env var is the ONLY difference between the two arms — exactly the Oracle-specified gate.

Because `RR_APP_ENV=0` forwards NO switches, the run is clean EVEN THOUGH the live DB is currently
armed (42/42 ON). The operating-point guard still counts the 42 armed rows and REFUSES unless
`RR_ALLOW_ARMED=1` — so pass it deliberately; the run is still a clean arm137 A/B.

**`OCR_RENDER_DPI=200` MUST be set in BOTH arms.** With `RR_APP_ENV=0` the `ocr_dpi` setting is not
forwarded, and process_docs defaults to **300** (tesseract.py:58) — product is 200 (mig 138). A
300-DPI arm is not what the app does (the recurring vacuous-arm trap).

## ⚠ Corpus caveat (READ FIRST)
`realdoc_regression.js` reprocesses the **CONFIRMED docs in the DB it opens** (`LIVE_DB`, or `RR_DB`
override) and scores vs their confirmed values. After the 2026-09-06 live-DB reset the live DB holds
~453 confirmed (the 605-corpus `rr_ids.txt` then selects only ~15). So:
- Run as-is ⇒ M=0 over your **live** confirmed docs (a real no-regression signal, but NOT the 605).
- For the true **605** gate, point `RR_DB` at a DB (backup/corpus) that actually contains the 605
  corpus docs, then the same commands apply.

## Run it (owner shell — app CLOSED is safest; harness opens read-only)
From the repo root. One arc at a time; each writes an OFF and an ON consensus dump, then diffs.

```bash
bash TESTING/_measure/flip_census_20260911/run_census.sh 157   # drift-override (recommended first)
bash TESTING/_measure/flip_census_20260911/run_census.sh 156   # non-name guard
bash TESTING/_measure/flip_census_20260911/run_census.sh 154   # ref-role shape
# or all three:
bash TESTING/_measure/flip_census_20260911/run_census.sh all
```

To run against a corpus/backup DB instead of the live DB:
```bash
RR_DB="/c/path/to/corpus_docusnap.db" bash TESTING/_measure/flip_census_20260911/run_census.sh 157
```

## What "pass" means (per-arc flip gate)
- **M = 0**: no doc that read/filed correctly OFF now reads wrong ON (silent wrong read/auto-file).
  The diff prints any doc whose ref/date/supplier/customer VALUE changed OFF→ON.
- **wouldFile(ON) ⊇ wouldFile(OFF)**: the arc only ADDS filers (or is neutral); it never removes one
  silently. The diff prints any doc that filed OFF but not ON (a regression) and any new ON-only filer.
- **new filers == GT**: every ON-only new filer's role fields equal the confirmed value (the diff
  flags a new filer whose value differs from the DB confirmed value).
- Plus each arc's own census (below), then Oracle before a customer default (`@DEFAULT_FLIP`).

### Per-arc extra census (from dark_switches.js flip-gate notes)
- **157**: the `match_score` census to place the 0.8 floor — the mig-157 census logging is already in
  `_exactness_census` (template_mapper.py:2852); grep the run's stderr/log for the logged scores and
  confirm the 0.667/0.82 gap holds on the corpus. Zero unintended relocations.
- **156**: the `accepted_names` batch-stall check (a supplier's legitimate recurring value must not
  stall its batch) + the fire census (which docs the flag fires on) — the diff's ON-only holds list.
- **154**: live re-judge of any still-held Thornbury (should now file) + new-would-file-ref == GT.

## Output
`stress_test/out/flip_census_20260911/<arc>_{off,on}.consensus.jsonl` (gitignored — real values,
NEVER commit) + a printed diff summary per arc.
