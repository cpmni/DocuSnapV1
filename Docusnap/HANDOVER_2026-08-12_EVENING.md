# HANDOVER — 2026-08-12 EVENING (owner present; incident → root-cause → Oracle-signed fix → live remediation)

**Branch:** `feat/teach-side-overnight` · **HEAD `3852d7c`, PUSHED, tree clean** (2 commits this
session: `0177716` consent-bar slice → `3852d7c` pendingfeatures). No installer. Migration still 63.
Untracked one-off (deliberate, like the superstore script): `scripts/remediate-sweep-cohort-20260812.js`.

## TL;DR
Owner reported "reprocess gave multiple autofiles across different suppliers". Root cause: the
renderer's `autoCommitFullConfidence()` (shipped `222d4fb` 2026-06-29) ran after EVERY batch-reprocess
completion and swept the ENTIRE queue through auto-file — filing 101 docs at 12:36 UTC as ordinary
HUMAN confirms (via NULL, owner's username), invisible to the banner, feeding the human graduation
window AND saveCorrections hint learning. Dormant for weeks; yesterday's graduation flips detonated
it. **CLAUDE.md's 08-12 DAY claim "reprocess NEVER auto-files" was WRONG** (backend true, renderer
door existed). eric design → Oracle SIGN-OFF-W/COND (consent bar — his decisive catch: batch-scoping
alone can't prevent recurrence, Reprocess All's batch IS the queue). Built, gated, committed
(`0177716`), pushed. Live remediation RUN (owner `!`): 101 docs stamped `auto_reprocess`; re-measure
shows **Pelican/invoice + Veltrix/sales_order graduation REVOKED (recent-correction)** — the inflated
windows had been burying real corrections. Separately: the graduation-freeze replay gate PASSED, and
the import-vs-reprocess type disparity was traced to the TYPE ELECTION (design filed, NOT built).

## Committed
### `0177716` — post-reprocess CONSENT BAR (Oracle-signed; queue-wide sweep REMOVED, no restore door)
- processing/handler.js: batch records own `docIds` (post-lock-filter, `_reprocessOffer` cleared at
  batch start); `consume-reprocess-completion` now role+license gated BEFORE the once-flag flip,
  computes server-owned offer = batch docIds (queued, un-locked) × `trust.autoFileEligibleIds`;
  setting `reprocess_autocommit_offer` DEFAULT ON (Oracle-granted — consent-gated = fail-safe);
  payload-less `reprocess-autocommit-accept` re-checks per doc, files via reviewService.confirm
  `{via:'auto_reprocess'}`, `_recordAutoFiled` each, audits `reprocess_autofiled` summary.
- reviewService.js: sentinel set {scope_sweep, auto_reprocess} internal-arg-only; auto_reprocess
  stamps username 'Auto-filed (reprocess)' (scope_sweep byte-identical); audit actor stays human.
- trust.js:538 NOT-IN += 'auto_reprocess' (span stays via-agnostic — correction still revokes);
  templates.js learnTemplateOnCommit skips it; search stat widened to LIKE 'Auto-filed%'.
- renderer: hook deleted; `#reprocess-autofile-bar` (File N / Review them → sweep filter / Not now);
  banner copy "in the last run" dropped (rolling undismissed list). `get-auto-file-eligible` RETIRED
  (handler + preload); `reprocessAutocommitAccept` exposed.
- Settings toggle + wiring pin. **Gates ALL GREEN:** test_reprocess_autocommit 27/27 (new) ·
  test_scope_trust ALL PASS incl. new §23(c2) both-sides pins · settings-wiring · foreign-fields ·
  shadow-row-skip · reviewservice ×2 · queue-badge.
- Also in the commit: realdoc RR_DUMP gains supConf/supMethod (evidence-vs-value instrument).

## Live-DB actions (data)
- **101-doc cohort STAMPED** `confirmed_via='auto_reprocess'` (owner-run `!`, classifier blocked me —
  correct). Backup `%APPDATA%\ScanFinder\docusnap_pre_sweepstamp_20260812.db`. Census self-validated
  each row (still confirmed + via NULL + burst username). Re-measure (backup vs live): Castellan
  41→28 · Nordwind 38→24 · Oakhaven 41→21 · Silverbeck 26→7 (all still trusted; W=5) ·
  **Pelican 36→REVOKED · Veltrix 28→REVOKED, both 'recent-correction'** — honest fail-toward-review.
- Snapshots: `Desktop\TESTING\_measure\rr_freeze_{post,pre}_20260812.db` (replay arms).

## Verification state (honest)
- **Graduation-freeze replay gate PASSED** (single-variable A/B, 281 docs, live settings mirror,
  DPI 200): all 61 Oakhaven/Harrowgate docs hint@85-90/logo@72-98 → template_fixed@95(Oak)/98(Harr),
  values identical, ZERO cross-scope movement (220 others byte-identical), would-file 241→246 (+5 =
  exactly the stuck class). 6 pre-existing would-file-wrong docs identical in BOTH arms (Pelican I→1
  refs + one quote total) — not freeze collateral, but note they exist.
- **Type disparity TRACED, fix NOT built** (agent FINDINGS in session scratchpad 30ca4b35
  `disparity\FINDINGS.md`; design + gate filed at pendingfeatures TOP): `'bill to'` in the Invoice
  keyword bucket is heading-eligible; tilted scans OCR it alone → whole-line heading test passes →
  2×+head=True beats 'CREDIT NOTE' (shares row with letterhead; heading test checks LEFTMOST column
  segment only, keyword.py:943); 3/5 exact ties go to config order (keyword.py:965). Deterministic;
  plain reprocess NEVER self-heals (cached text); only straighten-reprocess re-reads (= how #609
  flipped, with the type-flip note shown). Wrong layers named: heading rungs/template refuse/threads.
- **The consent bar is UNSMOKED in the UI** (renderer loads on next Review open; main code on next
  app start — app was CLOSED at wrap, owner may have restarted).
- Corrected claims this session: my "12:36 burst = File All Ready click" was WRONG (owner denied;
  real cause = the sweep); "auto-file fires at IMPORT ONLY" (08-12 DAY correction #1) was WRONG.

**POST-WRAP ADDENDUM (`fdd1d47`):** owner ran a fresh import on the NEW code — 20 Castellan docs
@95 sat ELIGIBLE-but-parked; root = `_maybeAutoFile:4329` refuses sub-100 docs on the BROAD Python
`msg.needs_review` (probable trigger: empty vat_no @0 — verify at source), so the shared predicate
is never asked. **Slice FILED at pendingfeatures TOP (owner-ordered), NOT built** — needs_review
emit trace first, own Oracle pass, M=0 gate. Interim exits: File All Ready / group-reprocess
consent bar / hide the empty field per-sender.

## FIRST ACTIONS (fresh session)
1. Owner smoke: restart app → Review → group-reprocess something → consent bar appears, File N files
   with 'Auto-filed (reprocess)' stamp, Not-now leaves queue untouched. Check the banner copy.
2. The owed censuses (pin-discharge / CONFADOPT / shadow-attribution) — MUST treat the 101-doc
  cohort as suspect (its saveCorrections hint learning ran pre-fix; usage counts polluted).
  Hint-usage rollback = owner decision (cohort list via `confirmed_via='auto_reprocess'`).
3. Type-election fix slice (pendingfeatures top): own advisor+Oracle gate; corpus TYPE census M=0.
4. Still open from DAY: sender-editor smoke list · tpl 11 cleanup · Ironclad C7/re-teach ·
  Lid→Ltd root-cause arc.

## Needs the USER
Consent-bar smoke · hint-rollback decision · Pelican/Veltrix will HOLD docs until re-graduated
(expected — tell them why) · type-fix go-ahead.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (mig 63). Backups today: `docusnap_pre_sweepstamp_20260812.db`
  (beside live) + `live_backup_20260812_pinclear.db` + `rr_freeze_*` in `Desktop\TESTING\_measure\`.
- New pins: `src/modules/processing/test_reprocess_autocommit.js` · test_scope_trust §23(c2).
- Oracle log entries NOT written to docs/oracle_log.md this session (verdicts live in this handover
  + the eric/Oracle agent outputs) — add if the convention demands.
- Remediation one-off: `scripts/remediate-sweep-cohort-20260812.js` (census/APPLY pattern, untracked).
