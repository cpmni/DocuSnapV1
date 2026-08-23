# HANDOVER — 2026-08-23 MORNING (wrap of the overnight Chris r17→r20 fix loop)

**Branch** `feat/teach-side-overnight` · **HEAD `d2f4ed2`** · **62 commits ahead of origin, NOT pushed** (owner's standing
rule overnight) · **tree clean** (no uncommitted batch) · **installer NOT rebuilt** (predates everything since 08-22).
**Context:** the owner went to bed with "take chris's recommendations to the agents, plan and fix, then get him to rerun…
keep a log of what he thinks." Four Chris rounds (17→20), each logged verbatim + a triage table. The long per-round
narrative is `HANDOVER_2026-08-23.md`; this file is the morning summary in the standard shape.

## TL;DR
- **Fixed and measured:** the wrong-date self-file class (Chris r18 A1 → r19 N1 → r20 "FIXED"): r20 = 73 filed,
  **0 wrong by the app**, every provoked wrong date HELD with the right value one click away; Ironbridge/Larkspur
  waited for their confirms; put-back held through confirms/corrections; Audit names the machine.
- **Root causes found tonight (all bugs, shipped):** the identity UNFREEZE class (`11ca0ba`) · hold payloads dropped
  at TWO links (`99b90f1`, `7b8c8e1`) · put back did not stick (mig 86 `put_back_at`, `19e91b0`+`061ca82`) · the
  corroboration record was separator-blind for dates (`6b77f30`, no date was ever corroborated) · File All's loop
  skipped on a note-only check, not the classifier (`0929e33`) · the machine via's audit row carried the user's id
  (`65ff83d`).
- **Behaviour widenings, all DARK** (table in `HANDOVER_2026-08-23.md` "EVERY SWITCH ADDED TONIGHT"):
  `template_fixed_debris_wide` · `quiet_reread_on_ready_templated` · `quiet_reread_first_fill_reliability_hold` ·
  `reprocess_holds_as_lane` · `trust_role_disagreement_refuse` · `trust_company_key_own_scope` (**do not flip live:
  holds 45 of the owner's 416 — the 08-19 starvation class**).
- **Pending:** the owner's steps below; the r20 vet cards; the next arc (the leading-digit date crop, #413).

## Committed vs UNCOMMITTED
Everything is committed (`git status` clean). Per-fix detail (root cause · files · tests · verdict) is in the three
triage tables: `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md` (r17) and `docs/CHRIS_FULL_APP_REVIEW_2026-08-23.md` (r18,
r19, r20). Oracle verdicts + conditions: `docs/oracle_log.md` (entries dated 2026-08-23). Gitignored-but-committed
measure: `TESTING/_measure/rr_on_reasons_20260823.jsonl` (`git add -f`).

## Verification state — honest
- **Whole suite** (`stress_test/run_all_suites.py`, 3 runs): final **552 files, 539 green, 13 red** = the 12 documented
  pre-existing (`test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`;
  Python `test_identity_fusion` + 6 script-style) + `test_ref_class_fix.js`, green 87/0 alone (runner flake; earlier
  `test_page_ocr_cache.py` flaked the same way). ZERO regressions from tonight's code.
- **Realdoc (owner's DB copy, `RR_APP_ENV=1`, DPI 200):** re-freeze base vs re-frozen = byte-identical (389/416, M=0);
  later tonight OFF = **381/416, M=1 (#413 `sales_order` date 04-08→24-08)**; ON (date fold + disagreement refusal +
  company own-scope) = 338/416, M=1 — attribution: `unverifiable-value` 45 (company own-scope), `disagreeing-read` 1,
  #413 `reason: ok` (no page witness). **CORRECTED CLAIM:** I first suspected tonight's code for the 389→381 drift; a
  worktree at the round-17 HEAD reproduces 381/M=1 exactly, as does an idle-machine re-run and the junk-kind bisect —
  tonight's code is exonerated; the 00:11 pair ran under a pre-compaction env I cannot reconstruct. The Oracle's
  "realdoc byte-identical expected" for the company own-scope rule was WRONG (45 held) — stated in the log.
- **Censuses:** first-fill reliability (DS 0 held / Copperfield held / K=1≈K=2); r19 Ironbridge (end-state DB
  uninformative — the unit pin carries the evidence).
- **NOT verified:** the realdoc arm is VACUOUS for lane/merge logic (fresh extraction) — P1/P3/the reliability hold
  are gated by their unit batteries + Chris rounds only. The Nordwind type-split was not re-run in r20.
- **Unexpected side effect to know:** at 04:19 I ran `taskkill /F /IM python.exe` to stop orphaned harness workers
  from a cancelled run; the owner's app and the sandbox were idle and survived.

## FIRST ACTIONS for the fresh session
1. Read `HANDOVER_2026-08-23.md` §"OWNER STEPS" + the r20 TL;DR in `docs/CHRIS_FULL_APP_REVIEW_2026-08-23.md`.
2. With the owner: run the re-freeze script on the live DB (dry run, then
   `--apply --templates-dir "C:\GIT Projects\Docusnap\templates"`); then flip, one at a time, watching the strip:
   `reprocess_holds_as_lane` → `quiet_reread_first_fill_reliability_hold` → `trust_role_disagreement_refuse` →
   `quiet_reread_on_ready_templated` → `template_fixed_debris_wide`. NOT `trust_company_key_own_scope`.
3. Owner vet of the r20 cards: the self-answering offer bar (open since r17), the open document never filing itself
   (copy), sender change wipes values (A5), the done card's "N look just like this one", hold styling, the strip TTL.
4. Push when the owner says so. Rebuild the installer after.

## Deferred (designed, not built) — load-bearing conditions
- **The leading-digit date crop (next arc):** #413 + the four Copperfield dates read the leading glyph wrong at
  93–97 % with NO page witness on #413 — the 08-07 pad-window recipe on the taught date box, or a keyword-vs-box
  witness requirement for role dates. 007/oscar arc; measure `corroboration.disagree` before designing.
- **Human vetting of first-fills (Oracle, the A1 residual):** release a first-fill hold only after ≥2 un-corrected
  human confirms of that field's first-fills in scope; a human correction of a first-fill counts as a witness (K=1);
  fuse with the correction-ripple HOLD (A3 part 2: a human correction of a role read by the same method on the same
  template holds the siblings' same field — never a value, never a sweep pause). Measure on live corrections first.
- **The company-key own-scope rule** stays DARK until the machine-confirm starvation question (08-19 memory) is
  settled — on the owner's corpus it holds 45 docs.
- **Foreign-row hold at gate time** (07-22 rule) — holds a doc on a field the confirm will discard; owner vet.
- **A5** carry date/ref across a type/sender change; **A8** the Use/Keep hold for untaught garble groups.

## Needs the USER
- The re-freeze script on the live DB (above); the flip order; the push.
- Decide the r20 vet cards (§3 above).
- Tell me whether the 00:11 realdoc pair's env matters (it predates the compaction; the current app-env number is
  M=1 on your corpus = the next arc either way).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` → **mig 86** after the next start (`documents.put_back_at`, NULL-inert).
  Live backups: `TESTING/_measure/live_backup_20260822_before_flips.db` (+ the night-start one).
- Sandbox: `<scratchpad>\chris-sandbox\` — `userData` (r20, **PID 31404 still running on CDP 9223**) + archived
  `userData_r17/r18/r19`, `Output_r17/18/19`, `r17/18/19_shots`; r19/r20 screenshots at the sandbox root. Scratchpad
  = `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\f48d5f84-2c4e-46b3-a5c3-08fbad8a1526\scratchpad`
  (session-mortal): realdoc reports `rr_dfold_off/on/on2/off_idle.txt`, `rr_bisect_*.txt`, `rr_on_reasons.jsonl`,
  DB snapshots `r18_snapshot.db`, `r19_snapshot.db`, `refreeze_live_base.db`.
- Tests: JS `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>`; Python script-style
  `PYTHONIOENCODING=utf-8 py -3.12 -m tests.<name>` from `python_backend/`; whole suite
  `PYTHONIOENCODING=utf-8 py -3.12 stress_test/run_all_suites.py` (→ `TESTING/suite_results.json`). Realdoc:
  `RR_DB=<copy> RR_APP_ENV=1 OCR_RENDER_DPI=200 [RR_CONSENSUS=<jsonl>] ELECTRON_RUN_AS_NODE=1 electron
  stress_test/realdoc_regression.js` (~8 min/arm; ONE arm per background command — the 10-min cap).
- New modules: `src/modules/processing/rereadHolds.js` (ONE road for re-read holds); `scripts/refreeze-template-identity-20260823.js`;
  censuses `TESTING/_measure/first_fill_reliability_census.js`, `r19_ironbridge_census.js`.
- Agents: `chris-the-customer` is NOT a registered subagent type — spawn `general-purpose` and have it Read
  `.claude/agents/chris-the-customer.md`; its transcript files come back EMPTY — the report exists only in the
  completion notification, write it out immediately.
- Traps: `core.autocrlf=true` (tests normalise CRLF; patch scripts `open(p, newline="")`); bash heredocs strip a
  backslash level AND turn `\n`/`\t` in strings into real characters — use Write/Edit for tests and patch scripts;
  any `Remove-Item` text in a PowerShell command can trip the path guard and block the WHOLE command silently.
