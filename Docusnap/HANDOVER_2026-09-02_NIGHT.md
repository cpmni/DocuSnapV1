# HANDOVER — 2026-09-02 NIGHT

Continued from `HANDOVER_2026-09-02_EVENING.md`. Branch `feat/teach-side-overnight`. **HEAD = origin =
`6a9bc26`, all pushed.** Tree clean except `NIGHT_RUN.md` (a DONE-ledger entry, committed as part of this
wrap). No build this session (renderer/JS + Python + tests + docs). Installer unchanged (last is 09-02 DAY's
`…-1023-bac4e90.exe`, UNSIGNED — a rebuild is still owed to ship the renderer fixes).

## TL;DR
Cleared the safe autonomous queue, then ran a full advisor→Oracle design pass on two owner-reported Print
Tracker exhibits. **SHIPPED (all DARK/safe, pushed):** reprocess one-confirm-once-per-field (`09e446a`);
raw_value on keyword money reads arming credit-sign arm 2 (`32ae95b`) — census RUN, PASS on safety;
SFDEV dev-switch gate-integrity pin (`8584e16`); **Fix B** (`eb67c47`) — fragment-containment yield admits
code-shaped fields via a known-set anchor, the fix for the clipped-`model` exhibit, DARK. **DESIGNED +
Oracle-signed, NOT built:** Fix A (read-layer edge-grow, deferred) and the format-flag high-variance
suppression arc. **GIT NEAR-MISS caught + fixed** (see Verification state).

## Committed this session (newest first, all pushed)
- `6a9bc26` docs — format-flag high-variance suppression: reggie+gary+Oracle SIGN-OFF-W/COND design (UNBUILT).
- `1972792` docs — Fix A conditions corrected (Oracle A-C1..C4; UNBUILT, flip deferred).
- `eb67c47` **feat(extraction) — Fix B: fragment-containment yield admits code-shaped fields (DARK).**
- `8584e16` test(settings) — SFDEV dev-switch gate integrity pin (toggle hygiene sweep).
- `32ae95b` feat(credit-sign) — raw_value on keyword money reads (arm 2).
- `09e446a` fix(reprocess) — one "— confirm once." sentence per field on the manual reprocess road.

## The fixes

### 1. Reprocess double-note — `09e446a` (renderer/JS, SHIPPED)
Owner exhibit (08-30): a manual reprocess of a straighten-CHANGED field stacked TWO "— confirm once."
notes (engine `_DESKEW_CHANGED_NOTE`, which fires on first-fills too via the `was=''` direction, + the
manual lane's via note). Both funnel through `rereadHolds.holdFirstFills`. Fix: one confirm-once per field —
if the field already carries a "— confirm once." family member, skip appending another; the hold still
stands (reliability path stays permanently held by the pre-existing note). Pin `test_reprocess_holds_as_lane.js`
§5 (RED-first: 2 BAD without the fix). 4 sibling hold pins green.

### 2. raw_value on keyword money reads — `32ae95b` (Python, SHIPPED + CENSUS PASS)
`validator.credit_sign_note` arm 2 (raw text carried a negative marker the committed value dropped) was
DEAD on keyword totals — keyword reads set no `raw_value`. `keyword.extract_fields` now preserves the
pre-clean matched text as `raw_value` on a CURRENCY read, gated behind `CREDIT_SIGN_COHERENCE` (OFF
byte-identical). **This is LIVE** (CREDIT_SIGN_COHERENCE is forced on by `money_sign_parens`/`_cr`, mig-98).
Pin `test_keyword_raw_value_credit_sign.py`: all 3 notations (`(£908.16)`,`908.16-`,`£908.16 CR`) fire arm 2
end-to-end through `validate_and_adjust`; OFF byte-identical; scoped to currency.
**CENSUS (owner ran, `TESTING/_measure/credit_sign_census/`):** on `C:\temp\docusnap.db` (arm 2 ARMED —
`credit_sign_coherence`/`money_sign_parens`/`_cr` all `true`, mig 104), 487 money-type corpus docs:
**0 value diffs (additive confirmed) + 0 new arm-2 flags** → no false positives on the real corpus. Caveat:
`C:\temp\docusnap.db` is the COLD reset test DB (4 confirmed); arm 2 is learning-independent so the
false-flag result stands, but a WARM real-DB run is the fully representative check (queued in NIGHT_RUN DONE).

### 3. Toggle hygiene sweep → gate-integrity pin — `8584e16` (test, SHIPPED)
Audited the switch inventory (owner rule: a PROVEN-bad toggle is removed or moved to a "DO NOT USE" SFDEV
group). **Verdict: NO switch qualifies.** The three "NEVER flip" switches are all already handled —
`template_format_fail_yield_strict_money` dev-gated + dark-by-SEAM; `trust_company_key_own_scope` has no UI
(env only); `deskew_on_import` deliberately customer-visible with honest copy. The SFDEV gate (`DEV_SWITCH_IDS`,
138 entries) audited: 0 dead entries, 0 dups, 0 leaked reading-internals (22 un-gated toggles all deliberate
customer/UI/licensing). Locked it in: `test_settings_wiring.js` now pins the gate (every entry names a real
toggle · no dups · every un-gated toggle on a declared customer-facing allowlist). RED-first verified.

### 4. Fix B — fragment-containment yield admits code-shaped fields — `eb67c47` (Python, DARK)
**Exhibit** (`2_split_p24.pdf`, Print Tracker, `model`): a taught absolute mapping box drawn SHORT read
`Ecosys PA2600cw)` @90 and beat the correct keyword_override `Ecosys PA2600cwx` @85 (also in confirmed DB).
**Root (gary, verified):** a Stage-0.5 `template_mapping` incumbent outranks keyword_override
UNCONDITIONALLY (`engine.py:8234`→bare `continue` `8330`; keyword-authority path `8347` unreachable for a
mapping incumbent) — never a confidence contest. **Advisors:** oscar+007 (read side A) + reggie+gary (merge
side B) → **Oracle SIGN-OFF-W/COND** — and Oracle caught a SHIP-BLOCKER: the value has an internal space, so
the dominant anchor (and the dominant index, ocr_corrector.py:424 drops whitespace dominants) is
guaranteed-INERT on a high-variance field → B would have done nothing on the reported doc. **Revised B-C1:
KNOWN-SET anchor** (challenger is a confirmed known-good literal via `confirmed_counts_index`, whitespace-
tolerant; INCUMBENT is NOT known = a clip artifact — closes the both-in-known collision). Built: module
helpers `_value_is_code_shaped`, `_value_in_confirmed_set`, method `_code_shaped_containment_ok`; additive OR
on the scope conjunct at `engine.py:8314`. All existing conjuncts unchanged; cap 88 review-bound; DARK flag
`TEMPLATE_FRAGMENT_CONTAINMENT_YIELD` (mig 100) OFF → byte-identical. Pin `test_fragment_containment_yield.py`
extended: FIRING test on the literal spaced `Ecosys PA2600cwx`, anti-collision pins, a known-set/scope pin, a
non-vacuity CONTRAST pin (the old dominant anchor is inert here). RED-first verified. Siblings green.
**FLIP is a later owner decision** — re-run the mig-100 census against the WIDENED predicate (B-C4) + a
live-confirm the `model` doc heals; needs the WARM DB.

## Verification state — be honest
- **GIT NEAR-MISS (caught + fixed).** Before committing Fix B, `git status` showed a STAGED reversion of the
  pushed `keyword.py` raw_value change (14 deletions), and the working tree had also lost it (a stray stash
  pop during an earlier RED-first). Caught it via `git diff --cached`, unstaged + `git restore` from HEAD,
  confirmed `keyword.py == HEAD` (raw_value line 1496 present) BEFORE committing. No reversion shipped. Lesson
  for the next session: after any `git stash push/pop` during a RED-first, re-check `git status` for unexpected
  staged/working changes to unrelated files.
- **raw_value census:** RAN (owner), interpreted at source (arm2 armed confirmed via settings query). 0 value
  diffs + 0 false flags on 487 COLD-DB docs. Efficacy proven by the unit/integration pin, NOT by the corpus
  (corpus carries no marker-total read via keyword — "no exposure here", not a failure).
- **Fix B:** pins green + RED-first. OFF byte-identical BY CONSTRUCTION (DARK flag). NOT run through the real
  605-corpus (Oracle: the corpus is DOUBLY blind — never fires Stage-0.5 mapping AND no high-variance model
  GT — so the FIRING integration test is the only automated gate; it passes).
- **Fix A + format-flag arc:** DESIGNED + Oracle-signed, NOT built, NOT tested. Do not imply otherwise.
- Python tests were run with `PYTHONIOENCODING=utf-8` (the `⊂`/`—` in test output trips cp1252 when piped).

## FIRST ACTIONS for the fresh session
1. Read this handover. `git log --oneline -6` — expect HEAD=origin=`6a9bc26`, clean tree.
2. **Owner decision — cheap, settles Fix A's applicability:** `SELECT type FROM fields WHERE key='model'` on
   the real DB. Free-text → Fix A needs the scope-widen; alphanumeric → A is just arming a flag. (Fix B works
   regardless.)
3. **Build the format-flag high-variance suppression arc** — fully designed + Oracle SIGN-OFF-W/COND, the
   recommended next build (per `pendingfeatures.md` "SUPPRESS the format differs… flag on HIGH-VARIANCE
   fields" → ADVISOR CONSENSUS block). Honor Oracle C1 (per-rung: engine path auto-files, mapper DERIVED rungs
   stay review-bound), C2 (fail-safe when value_counts absent), C3 (preserve the column-bleed trim), C6 pins.
4. Then Fix A DARK (deferred flip) per `pendingfeatures.md` A-C1..C4.

## Deferred — DESIGNED, NOT built (load-bearing conditions, so they can't be built wrong)
- **Format-flag high-variance suppression** (`pendingfeatures.md`, Oracle SIGN-OFF-W/COND `6a9bc26`): ONE
  choke point `format_anomaly_checker.check_value` shape leg (`:566-573`); relax when `_has_no_usual_format`
  (≥3 LENGTH-AWARE `shape_families`, ≥8 confirms, no family ≥50%) — length-aware NOT `_fold_shape`; keep the
  near-miss slip-catch (same-length single letter↔digit-confusable substitution off a confirmed value).
  Oracle: C1 mapper derived rungs (`shape_mode='flag'`) stay REVIEW-BOUND (retain the cap; NOT a single
  `return None` — per-caller); C2 don't suppress when `value_counts` absent; C3 preserve `extract_accepted_shape`
  trim (gate terminal writes, not an early None); C4 predicate-tightness pin; C5 near-miss pin + never
  auto-apply; C6 M=0 + zero accuracy drop + two-sided non-vacuity + OFF byte-identical (`=='1'`). DARK flag
  `FORMAT_VARIANCE_RELAX`. Thread `value_counts` into `fmt_entry` in `build_format_class_index`.
- **Fix A — read-layer edge-grow for free-text codes** (`pendingfeatures.md`, `1972792`, Oracle deferred flip):
  `_abs_edge_guard` code branch ALREADY right-grows; gap is SCOPE (`_SNAP_VAL_TYPES` excludes free-text). New
  DARK flag `TEMPLATE_CODE_EDGE_GROW` + a SEPARATE scope conjunct on the SAME `_value_is_code_shaped` (move it
  to `template_mapper.py`, engine imports it). A-C1 right-neighbour gap test (`_find_edge_cut_words` only finds
  the cut word, not the gap). A-C2 the "cold-safe→flags" claim is FALSE (`template_mapper.py:3380` clean-commits
  via the snap-union witness) → force flag-only for the free-text code leg. A-C3 stricter census. Does NOT heal
  the exhibit (B does) — lower priority.

## Needs the USER
- `SELECT type FROM fields WHERE key='model'` (settles Fix A).
- **Fix B flip gate** (owner-machine, WARM DB): re-run the mig-100 census against the widened predicate + a
  live-confirm the `model` doc heals. `C:\temp\docusnap.db` is COLD (4 confirmed) — not enough.
- **raw_value WARM census** (optional, queued): re-run `TESTING/_measure/credit_sign_census/run_census.ps1`
  against a `db.backup()` of the WARM live DB for a fully representative false-flag check.
- A rebuild is owed to ship the renderer fixes (last installer is 09-02 DAY's, unsigned).

## Key facts / paths
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`. The census used `C:\temp\docusnap.db` = a COLD reset copy
  (4 confirmed, mig 104).
- **Census harness (new, untracked):** `TESTING/_measure/credit_sign_census/{run_census.ps1,census_credit_sign.js}`
  — A/B via a single-file `git checkout 32ae95b^ -- keyword.py`, reuses `reslice_20260830/_run_docs.js` +
  `_diff_runs.js`. Run: `powershell -ExecutionPolicy Bypass -File …\run_census.ps1 -DbCopy <copy>`.
- **Run Python tests** with `PYTHONIOENCODING=utf-8 py -3.12 tests/<t>.py`; JS pins with
  `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron <t>.js`.
- **Git root** is `C:/GIT Projects` (app under `Docusnap/`) — pathspecs need the `Docusnap/` prefix.
- Advisor round facts live in `pendingfeatures.md` (the two 2026-09-02 arc entries) + the Oracle rulings quoted
  there; `docs/oracle_log.md` should get the two rulings appended (Oracle had no write tool this session).
