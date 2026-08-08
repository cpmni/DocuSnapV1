# HANDOVER 2026-08-01 DAY (owner-present marathon; follows HANDOVER_2026-08-01_OVERNIGHT.md)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `4965984`, PUSHED, tree clean** (only
the long-standing untracked leftovers). **Installer still `5b5d344`** — predates 3 full sessions;
rebuild to ship anything. **Dev app**: owner's `npm start` running (restarted ~12:24, HAS all of
today's main-process code INCLUDING R1 — earlier confirms ran through a stale process, see gotcha).
Live DB backups from today's two `--apply` runs sit beside `%APPDATA%\ScanFinder\docusnap.db`.

## TL;DR
Owner-driven day on top of the overnight autonomous run. Shipped, all Oracle/advisor-gated, all
kill-switched: **S-A/S-B/S-C validation slices + the S-D vacuous-fit gate** (built "what passed" —
S-A date-in-ref ON, S-B length profile ON, S-C blind-geometry reconcile ON after owner flip,
REG_MIN_INLIERS_GATE ON) · **the type-refuse LEARNING DEADLOCK cured** (herald-traced: refuse ⇒
null template_id ⇒ learn-on-commit bailed ⇒ young template never warmed/never intersect-flushed ⇒
refused forever; R1 link-on-confirm + R3 counterparty harvest markers + honest note + retro-heal
script applied ×2 = 37 orphaned confirms linked) · **live note suppressor repaired** (my reword had
silently broken its matcher) · **length-witness reconciliation** (doc-297 'WS-1904' class — heal
from the ledger on the doubled-digit fingerprint; flag-with-suggestion + Accept button otherwise) ·
UI fixes (graduation banner names the TYPE; pick-bar overlay; veto-note neutral copy; branding-blank
live pill unpin; bare-'Date' role label). **Corpus at wrap: 299 docs, type/supplier 100%, ref
97.0%, date 99.7%, M=9** — residual now dominated by ONE class: interior stroke substitutions
(6 exemplars, all proven pre-existing via kill-switch A/Bs).

## COMMITTED today (day session; overnight's are in its own handover)
- `4965984`/`e4766de`/`b99c149` docs: backlog exemplars + note-placement UX follow-up.
- `6237398` **length-witness reconciliation** (kill `REF_LENGTH_WITNESS_RECONCILE`, ON): inside
  S-B's fire point, ledger witness passing profile+shape+prefix+not-date; ADOPT only on
  `suffix_reconcile.doubled_digit_fingerprint` (witness = winner + ONE digit inserted
  adjacent-identical) AND passive winner, at the witness's own conf; authoritative/non-fingerprint
  = flag + `corrected_to` suggestion. PINs: rollover-drift never adopts; multi-edit dup pair →
  flag lane. Realdoc ON==OFF byte-identical (arm corpus-inert today). 37 suite pins.
- `cea79ef` **stale-note suppressor repair**: the live on-open strip (scopeConfirmedCount>0)
  existed since before; my reword broke its matcher. `_STALE_TYPE_NOTE` = ONE shared regex, both
  copies; `test_stale_note_matcher.js` pins + never-widen negatives. Oracle: display-only SIGNED,
  persisting the clear on open SENT BACK (autoCommitFullConfidence = passive-open silent-file seam).
- `f82bde2`+`11b7ae9` **deadlock cure**: R1 `TEMPLATE_LINK_ON_CONFIRM` (null-tid confirm resolves
  via reuseByEstablishedName + reversible link, existing arm enriches; scope_sweep confirms
  excluded — pinned) · R3 `FINGERPRINT_COUNTERPARTY_MARKERS` (word-boundary supplier/vendor
  truncation; regeneration gate: only counterparty names removed corpus-wide) · note reword
  ("confirming will teach this layout") · gate matchers widened · `scripts/link-confirmed-templates.js`
  (dry-run/--apply; APPLIED twice: 26 then 11 orphans linked, backups beside DB). R2 cohort-pick
  admission BANKED with revival evidence (pendingfeatures).
- `115ba62` graduation banner per-(supplier,TYPE) wording · `db9fb18` pick-bar hides Mark-Reviewed
  pill · `930842e` veto-note neutral copy + `REEXTRACT_UNPIN_BLANK_SUPPLIER` (stale-collision unpin
  + branding-blank ⟳ pill exception, 8 merge pins) · `d3db1e4` `DATE_ROLE_GENERIC_LABEL` (bare
  'Date' for date roles; due_date sibling-dedupe pinned) · `570833b`/`6649723`/`1411d50` the
  S-slices + reg gate (see overnight handover + `project_validation_slices_20260801`).

## Verification state (honest)
- Every slice gated before flip: kill-OFF byte-identical realdoc diffs (S-A/S-B/S-C/reg-gate/
  length-witness), flag audits (S-A = exactly #141/#142; S-B = 0 corpus flags), heal probes on
  real pixels (#141/#142 'DN-24408'@98; doc 259 template-matched note-free post-retro-heal; slice
  probe 150-400dpi all read 'WS-11904' correctly — the xres deferral is evidence-complete).
- **M went 5→9 on the 299-corpus — NOT a regression of ours**: proven byte-identical with the
  length-witness arm OFF; the 4 new rows (#283/285/291/299, Vellum worksheets) are interior digit
  substitutions on freshly-confirmed docs — the pre-existing residual class growing with corpus.
- **Corrected mid-session claims**: (1) my "nothing landed" after the interrupted commit was wrong —
  the local commit existed, only the push was stopped; (2) the 10:55 import's blank dates were my
  live-editing window racing the import's python spawns, not a system fault; (3) the "can't resolve
  supplier" report was actually the type-layout note under the issuer — supplier was resolved @98
  (note-placement follow-up banked).
- NOT verified: owner's final Accept-clicks on the 3 flagged worksheets; the queue may still hold
  2-3 docs.

## FIRST ACTIONS (fresh session)
1. **The two evidence-complete candidate slices, if owner wants accuracy next** (each needs its own
   Oracle round): (a) S-C widening to shape-FAILING `anchor_crop_relocated` winners with ≥2
   distinct-family agreeing witnesses (doc-286 measured: relocate drifted a row up, read label
   garbage 'VATCirocA1'@82, beat keyword's correct 'WS-73541' — flag+suggestion caught it);
   (b) oscar's crop-edge outward-round + white-matte fix (screenshot doc's trailing-'1' loss =
   its deferred "measured heal" evidence).
2. **Catch-up Filing slices 3+4** (renderer consent UI + gates + flip) — design signed, slices 1+2
   dark in place, owner-present work.
3. The stroke-substitution second-witness investigation (6 exemplars in pendingfeatures) — the
   dominant residual; 007 crop-geometry lens first.
4. Installer rebuild decision (close dev app first — EPERM).

## DEFERRED (load-bearing conditions attached — do not build unvetted)
- All in `pendingfeatures.md`: R2 cohort admission (revival evidence named) · Proposal B length-flag
  re-read (revival = measured no-witness flag population) · XRES escalation (dead for the measured
  classes, evidence-complete) · 225 "Faster" preset (confounded, C7 preconditions) · S-B2 confidence
  lever (Oracle: crosses the 88 floor on population evidence — own round) · type-note placement UX ·
  coverage-gap test list (teach doCommit untested + non-transactional, reviewService type-deleted
  fallback, XML quote escaping, confirm-vs-reprocess lock).

## NEEDS THE USER
- Accept/confirm the last flagged worksheets (suggestion buttons are live).
- Visual smokes still pending: teach one-step confirm; the ⟳ pill on a branding-blank doc; the
  reworded notes/banner on next graduation.
- Installer rebuild + (optional) `strict_100_autofile`/auto-file threshold review now that ref sits
  at 97 with the reconciliation family live.

## KEY FACTS / SWITCHES (today's additions)
- New kill switches, all default ON unless stated: `DATE_IN_REF_FLAG` · `REF_LENGTH_OUTLIER_GUARD` ·
  `BLIND_GEOM_DISAGREE_RECONCILE` · `REG_MIN_INLIERS_GATE` · `TEMPLATE_LINK_ON_CONFIRM` ·
  `FINGERPRINT_COUNTERPARTY_MARKERS` · `REEXTRACT_UNPIN_BLANK_SUPPLIER` · `DATE_ROLE_GENERIC_LABEL` ·
  `REF_LENGTH_WITNESS_RECONCILE`. Engine pass order PINNED: suffix-reconcile → S-C → S-A →
  prefix-outlier → S-B(+witness arm).
- Mig 57 `confirmed_via` live; sweep IPC dark (`scope_sweep_enabled` OFF).
- GOTCHA (bit twice today): the RUNNING dev app's main process predates same-session JS commits —
  confirms through a stale app silently skip new learning arms; python is fresh per spawn. Check
  app start time vs commit time before diagnosing a "broken" confirm-path fix.
- Memories: `project_deadlock_reconcile_20260801` · `project_validation_slices_20260801` ·
  `project_overnight_20260801`. Oracle log has 3 new entries (he went ~10 rounds today — the
  fold-blindness catch, the amended xres verdict, S-A/B/C/D, R1/R3, Option-A note ruling, the
  length-witness fingerprint narrowing).
