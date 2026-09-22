# HANDOVER — 2026-08-12 NIGHT (owner-set priority: THE IMPORT ARC)

**Branch `feat/teach-side-overnight` · HEAD `fdd1d47`, PUSHED, tree clean.** Detail of the evening's
builds lives in `HANDOVER_2026-08-12_EVENING.md` (consent bar `0177716`, 101-doc remediation,
type-election trace) — read it second. Migration 63. App was RUNNING at wrap (owner's `npm start`).

## THE OWNER'S GOAL — this is the arc, verbatim intent
**"Import the 200 docs and have the majority auto-file — any that don't, I will look at and we can
figure out the problems."** Everything below serves that. Today's 200-doc import measured the gap:
**70 auto-filed · 130 queued**, and the 130 decompose as:
- **93 CLEAN + ELIGIBLE, parked** — `trust.isAutoFileEligible` says file (graduated floor 95,
  zero flags): Castellan 20 · Oakhaven 20 · Veltrix 20 · Silverbeck 19 · Pelican 14.
- **15 Nordwind quotes** — `unverifiable-value:subtotal` (the shadow-row deadlock class).
- **17 genuinely flagged** (Pelican stamped-VAT totals, Nordwind date disagreements, Quillstone POs…).
- **5 Meadowvale** typed invoice (missing invoice_number) — the type-election defect.
So the honest ceiling TODAY is ~178/200 auto-filed with ~22 real reviews. The blockers are TWO code
gates + one unflipped fix, not read quality.

## PRIORITY 1 — THE THREE-GATE DISPARITY (slice filed at pendingfeatures TOP, `fdd1d47`; BUILD IT)
Three different auto-file opinions exist; only one is authoritative:
1. **Import pre-gate** `_maybeAutoFile` (`processing/handler.js:4326-4329`): refuses any sub-100 doc
   whose Python `file_done` said `needs_review` — BROADER than the predicate (fires on an empty /
   below-threshold field). This parked the 93. **Unverified link: trace at source what set
   `needs_review` on docs 737-756 (probable: empty `vat_no` @0) BEFORE building.**
2. **File All Ready** (`review/renderer.js:4838 isFlagged`): PROVEN today — owner clicked FAR on the
   130, it ran "Filing 118 of 130 · 117 skipped → Filed 0". The orange "Check — 1 field read with
   low confidence" chip (below-threshold field, e.g. vat_no@0) counts as FLAGGED to FAR even though
   the predicate calls the doc eligible and the Confirm button is green.
3. **`trust.isAutoFileEligible`** — the authoritative predicate (already shared by import's
   `_autoFileDoc`, the consent bar, the sweep). The 93 pass it.
**Build:** import defers to the predicate for graduated candidates (keep the cheap conf pre-filter);
DECIDE-and-PIN the below-threshold-field policy (should a low-conf/empty NON-structural field hold a
graduated doc the predicate accepts? — Oracle rules); reconcile FAR's isFlagged with the same ruling.
Flag DEFAULT OFF + toggle + wiring pin; own advisor+Oracle pass; gates = dark realdoc md5-identical ·
parked-eligible census before/after · M=0. **Acceptance test = the owner's goal: re-import the 200
(fresh copies), expect ~178 auto-filed, and sit with the owner on the remainder.**

## PRIORITY 2 — flip candidate for the 15 Nordwind: `trust_shadow_row_skip`
Oracle-signed 2026-08-08 (`e18859c`, both blocking conditions answered), bridged; believed OFF in
live DB — VERIFY STATE IN THE DB FIRST (stale-flag lessons). It exactly owns
`unverifiable-value:subtotal` deadlocks (invisible shadow_reconcile rows). Owner decision to flip.

## PRIORITY 3 — the `es we` exhibit (CJB-5054) + adopt widening
Picker showed 'es we' (taught box, drifted read) vs 'Bramblewood Joinery Ltd' (37× confirmed).
Owner challenge stands: massively-corroborated literal vs uncorroborated 2-token fragment should not
be a coin-toss. (a) TRACE which clause refused CONFIRMED_DOMINANT_ADOPT (flag is ON, owner-flipped
13:06 — junk predicate miss on plausible-word tokens, or the STRICT variability clause); (b) design
the widening under the Lid→Ltd arc (corroboration step 3 — "let it move decisions" — this is its
justifying exhibit; owner direction 08-11: a margin is not evidence). (c) INTERIM, tell the owner:
a 30-second re-teach of the Castellan Customer box kills the 'es we' source outright.

## What already WORKS (proven live today — do not rebuild)
- **Consent bar (`0177716`) LIVE-PROVEN**: owner cleared ~118 of the 130 via per-group "Reprocess N
  from <sender>" → "File N" bars. It uses the authoritative predicate. But the reprocess round-trip
  on a fresh import is the waste Priority 1 removes.
- Remediation of the 101 misattributed sweep files DONE (stamped `auto_reprocess`, backup
  `docusnap_pre_sweepstamp_20260812.db`); **Pelican/invoice + Veltrix/sales_order graduation REVOKED
  (recent-correction) — EXPECTED, real corrections resurfaced; they re-earn with clean confirms.**
- Graduation-freeze replay gate PASSED (61 docs → template_fixed@95/98, zero cross-scope).

## Also open (EVENING handover + pendingfeatures carry the detail)
Type-election fix (the 5 Meadowvale: 'bill to' heading-eligible — design ready, own Oracle pass) ·
owed censuses treating the 101-cohort as SUSPECT (hint learning polluted; rollback = owner call) ·
consent-bar/editor smoke lists · tpl 11 cleanup · Ironclad C7/re-teach · oracle_log entries for the
two 08-12 EVE verdicts if convention demands.

## FIRST ACTIONS
1. Verify the `needs_review` emit at source (one doc, 737-756) → then BUILD Priority 1 (advisor →
   Oracle → dark → gates). This is the session.
2. Check `trust_shadow_row_skip` in the live DB; put the flip to the owner with the 15-doc evidence.
3. Trace CJB-5054's adopt refusal; recommend the re-teach meanwhile.
4. When the slice ships + flip lands: the owner re-imports the 200 → measure auto-file rate →
   review the residue WITH the owner (their stated workflow).

## Key facts
Live DB `%APPDATA%\ScanFinder\docusnap.db` (mig 63) · backups: `docusnap_pre_sweepstamp_20260812.db`
(beside live) + `rr_freeze_*` in `Desktop\TESTING\_measure\` · corpus `Desktop\TESTING - Copy\IMPORT`
(200 docs, "-1" pages) · new pins `src/modules/processing/test_reprocess_autocommit.js` +
`test_scope_trust.js §23(c2)` · remediation one-off `scripts/remediate-sweep-cohort-20260812.js`
(untracked) · GOTCHAS: pipe electron.exe output or PS doesn't wait; `!` prefix = Git Bash not PS;
never measure a DB the app holds — snapshot via better-sqlite3 backup.
