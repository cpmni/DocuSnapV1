# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

---


## Extended reference (read the relevant doc on demand)
This file is the lean index. Deep detail lives in `docs/` and is loaded ONLY when a task
touches that area — read the pointed-to doc BEFORE working in it:
- `docs/extraction-pipeline.md` — full Stage 0–4.6 internals, drift/registration/label-lock/
  slip-fix/multiline design, OCR recipes, performance + confidence calibration. **Read before
  ANY extraction/anchoring/OCR/validation change.**
- `docs/licensing.md` — license gate internals, offline token verify, PHP backend, admin 2FA, Legal/Terms gate.
- `docs/detached-client.md` — the `/v1` TLS API, cert wizard, entitlement/workflow gates, presence, harnesses.
- `docs/features.md` — first-run wizard, welcome tour, settings backup, Learning Repair, teaching wizard, dev inspector.
- `docs/history.md` — resolved QA/audit findings + build-stage history (Settings/Review/Search/Stage-7 rebuilds).
- `docs/session-log.md` — VERBATIM ARCHIVE of the old per-session change blocks (2026-07-09 → 07-19).
  Grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent session built.
- `docs/architecture-notes.md` — the long per-file design notes moved out of the directory map (marked
  ➜AN there). Read the matching block before changing one of those files.

## Current session state (2026-07-26 FINAL) — logo-identity fix COMPLETE, FLIPPED ON + LIVE-VALIDATED
**FLIP + LIVE VALIDATION (latest):** defaults flipped ON (`eeb257d` — `TEMPLATE_VETO_FALLTHROUGH` +
`LOGO_DETAIL_GLOBAL_RIVALS` default '1', =0 restores; test OFF-cases now set '0' explicitly). Owner ran
`npm start`, reprocessed the stuck Saltmarsh dockets: **"the docs filed fine"** — the full chain
(collision-vetoed → fall-through match → boost → G1/G2 clean → FILED) is live-proven. ⚠ The PACKAGED
app needs an installer REBUILD to carry it. **10 commits ahead of origin, ALL UNPUSHED** (through
`3e0812c` — incl. `docs/ARCHITECTURE_SNAPSHOT_2026-07-26.md`, the C++-port planning report; MODULES.md
verified badly stale there). Push decision = owner. **The earlier DARK note below is superseded. ↓**
**LATER 2026-07-26: the corroboration-gated variant CLEARED the gate.** gary designed + Oracle signed
(revised C8) the G1/G2 guards, BUILT `ba8bcea`, all green: **G1** (final assembly) — a fall-through
doc's critical winner must be corroborated (independent-FAMILY rail read, or boundary-guarded page
presence incl. the date RAW-form arm; field-kind-aware note holds via the flagged gate; NO authoritative
exemption) · **G2** (Stage-2 merge) — a non-authoritative crop at INVERTED confidence never silently
displaces a disagreeing keyword (keep keyword + note; agreeing keeps the incumbent noteless, C6;
authoritative exempt BY RULING — G1 backstops, accepted cost (c) pinned). Tag `veto_fallthrough` from
the matcher; ONE master switch (`TEMPLATE_VETO_FALLTHROUGH`) — **naked C is unreachable at runtime**
(Oracle-blessed deviation). **Gate results: M == 2 exactly** (#472 eliminated; baseline #183/#583 only),
M_type 0, **would-auto-file 377** (+42 vs OFF 335), ref/supplier = baseline, dates 98.2 with the complete
wrong-stored set {#456, #472} both **[flagged]** note-held ("no silent wrong value"); live: #472/#456
held with notes, Saltmarsh clean 100. Unit `test_veto_fallthrough_corrob.py` 20 pins + 7 sibling suites
green. **STILL DARK — the flip (defaults ON + installer rebuild) is the OWNER'S call.** Backlog (named,
do NOT widen G1 for it): G1 verifies EXISTENCE not BINDING — a lone read grabbing a different genuine
page token passes; that is the #183 Fix-A anchor-binding work. **The earlier block below is superseded
on the gate outcome; its root-cause forensics remain canonical. ↓**

## (superseded on outcome) 2026-07-26 — logo-identity slices BUILT DARK; corpus gate BLOCKED naked C
**2026-07-26 (Fable 5, owner-directed).** The remaining 4 "perfect" dockets (587/588/589/590, overall 94
< graduated floor 95) were root-caused to the END: owner's exercise ("the logo is visually identical —
find the algorithmic fix") → built the **iris** perceptual-forensics agent (`.claude/agents/iris.md`,
REGISTERED — pixels-first, 4-layer decomposition, contrastive matrices) → iris proved the 64-bit "logo
hash" hashes **LAYOUT not the mark** (phash of the top-left w/2×h/5 crop; mark <5% of area; intra- ==
inter-supplier distance ⇒ ZERO separation; 8/16 dockets coarse-lock a WRONG supplier ≤6) while the
**256-bit isolated mark separates cleanly** (own ≤38 vs impostors ≥86 min-over-set; pairwise tails cross
— the multi-ref set is load-bearing) and the purpose-built detail veto was silent because its rival
universe was cut by the same broken coarse hash. **BUILT (Oracle-conditioned, both DARK/OFF, 2 commits):**
`522cc3b` Slice A global-rival veto universe (kill `LOGO_DETAIL_GLOBAL_RIVALS`; probe 606 docs 0 wrong/0
false-abstain) · `c1f9a3f` Slice C identity-veto fall-through to the text arms (kill
`TEMPLATE_VETO_FALLTHROUGH`; C2 supplier-scoped sibling exclusion LOAD-BEARING + C3 winner branding/mark
bar). Unit 6/6+8/8, matcher family green. **Live A+C ON: all 4 dockets match T24, overall 99-100, values
unchanged-correct.** Slice B (mark as primary matcher) DEFERRED per Oracle until mark normalisation.
**⚠ CORPUS FLAG-MATRIX FAILED THE FLIP — DO NOT FLIP:** ON = +43 would-auto-file BUT **NEW M #472**
(template match un-holds its skew-wrong ref — the hold was luck, not safety) **+ date 98.4→98.2 (#456**
new wrong date on the template-matched path). Flip prerequisite = the skew read-layer fix
([[project_183_harvest_synthesis]] A/B) OR a corroboration-gated C (fall-through docs auto-file only on
multi-source-corroborated criticals — Saltmarsh 4 pass, #472 fails); each needs its own Oracle round.
Meanwhile: the 4 docs are correct on screen — owner confirms by hand. Earlier same session: caption-strip
`9dfa011` (DARK), audit `docs/AUTOFILE_AUDIT_2026-07-25.md` (07-26 update appended), template-diagnosis
`6c13ec3`. **6 commits ahead of origin, ALL LOCAL/UNPUSHED.** Memory:
[[project_logo_identity_slices_20260726]] · [[project_autofile_blockers_20260725]] ·
[[project_caption_prefix_strip_20260725]]. **Prior block ↓**

## Current session state (2026-07-25 NIGHT, autonomous) — READ `HANDOVER_2026-07-25_NIGHT.md` FIRST
**2026-07-25 NIGHT (Opus 4.8, autonomous overnight; owner asleep, hard NO-REGRESSIONS rule).** Chased the
owner's "recipient/customer anchor" problem to root and it is a **RED HERRING for the auto-file pile-up**:
customer_name is `required=0` → never feeds `overall_confidence`. The 16 correct Saltmarsh dockets pile up
because of **TEMPLATE MATCH + confidence caps + an ungraduated scope**, NOT a wrong read. Full audit:
**`docs/AUTOFILE_AUDIT_2026-07-25.md`**. Root: match→supplier early→Stage-2.5 conformance boost (85→96)+
docTrustGate ok→95; no-match→supplier LATE→`late_anchor_rescue` cap 85→88, and **no-template BARS sub-100
auto-file** (docTrustGate, trust.js:391). Scope **4/10 confirms→floor 100→nothing auto-files**; simulated
at graduated floor 95 only **4/20** file (11 no-template + 5 flagged [2 "type changed on reprocess", 3
customer phantom note]). **BUILT (DARK, LOCAL commit `9dfa011`, NOT pushed): caption-prefix strip** (kill
`ANCHOR_CAPTION_PREFIX_STRIP` default OFF) — `_strip_caption_prefix` recovers a structured crop that
captured its caption ("Date 22/07/2026"→"22/07/2026") + fixes a cold-supplier dirty-commit; reggie+Oracle
SIGN-OFF-W/COND (SEAM A currency-exclude, SEAM B recovery-not-pre-emption). OFF byte-identical; unit green
(`test_caption_prefix_strip.py`); ON live batch **16/16 zero VALUE changes** (method-only recovery). ⚠ NOT
flipped, NOT full-corpus-gated, **does NOT clear the batch**. **RULED OUT (gary+Oracle DO NOTHING): the
corroboration lift** (late-rescue⟺template-less⟹zero recall; enumeration confirmed inert). **UNCOMMITTED
new files** (safe, carry no data): `stress_test/caption_strip_ab.js` (A/B harness), `docs/AUTOFILE_AUDIT_2026-07-25.md`,
`HANDOVER_2026-07-25_NIGHT.md`. **NEXT (owner-gated; Oracle: do NOT touch the matcher autonomously):** confirm
6 more dockets→graduate; diagnose the template-match gap (primary lever, [[project_template_defrag_20260725]]);
decide the "type changed on reprocess" flag; flip the strip after corpus A/B + page-verify. Memory:
[[project_autofile_blockers_20260725]] · [[project_caption_prefix_strip_20260725]]. **Prior block ↓**

## Current session state (2026-07-25 EVENING) — READ `HANDOVER_2026-07-25_EVENING.md` FIRST
**2026-07-25 (Opus 4.8) — live-testing day with the owner; branch `feat/reprocess-throughput-autostraighten`
ALL PUSHED through `863e914` (origin `0 0`, tree clean). 6 commits, all kill-switched + advisor/Oracle gated.**
`5501be1` **merge tool (Slice 1)** — `templateMerge` splits `insufficient` vs `divergent` + offers an owner-
confirmed backup-first `merge_review` for near-identical-branding dupes (kill `TEMPLATE_MERGE_REVIEW`;
Settings→Templates→Suggested cleanups; ⚠ the merges themselves are an OWNER click, NOT run) · `aba2f46`
**reuse-by-branding DEFAULT ON (Slice 2)** — a confirm/teach reuses its (branding,slug) template instead of
minting (kill `TEMPLATE_REUSE_BY_BRANDING`; replay 482/534 reuse, 0 cross-supplier; ⚠ needs one LIVE OWNER
BATCH + Phillip's IDF hardening before wide rollout) · `17f25e5` **live field-visibility by supplier** —
`templates.findForSupplierType` resolves a no-template doc's hidden fields + re-scopes on issuer edit (kill
`FIELD_VIS_LIVE_RESOLVE`; modes via setting `field_visibility_resolve_mode`) · `af346d8` **logo-refuse
fall-through** — `identify_template`'s logo-arm trusted-title refuse falls through to the same-type keyword
rescue (+ Oracle C1 supplier guard) so a wrong-type same-supplier logo lock no longer gives "No template match"
on reprocess (kill `LOGO_REFUSE_FALLTHROUGH`; corpus M/accuracy-neutral, +5 correct auto-files; VALIDATED LIVE)
· `8103268`/`863e914` docs (label-separator tolerance INVESTIGATED → DO NOT BUILD: reggie premise-break, no-op
for its symptom). ⚠ **Python change ⇒ clear `python_backend/**/__pycache__`** or a reprocess runs STALE
bytecode (masked the logo fix for ~an hour this session). ⭐ **NEXT SESSION'S TARGET: the recipient/customer
anchor** can't pick the COMPANY-NAME line out of a captioned multi-line address block ("Deliver To" / "Site
Customer") — it reads the caption or a garbled address line, `keyword_override` rescues the correct name, and
the batch keeps landing in review; DIAGNOSED, not fixed (handover + [[project_recipient_anchor_problem]]).
Memory: [[project_logo_refuse_fallthrough_20260725]] · [[project_field_visibility_live_resolve_20260725]] ·
[[project_template_defrag_20260725]]. **Prior block ↓**

## Current session state (2026-07-24 LATE → overnight) — READ `HANDOVER_2026-07-24_LATE.md` FIRST
**2026-07-24 LATE (Opus 5 → Opus 4.8 re-review + autonomous overnight) — 5 commits PUSHED through
`c9d9480` (origin `0 0`, tree clean).** `733b4e1` **late-rescue sticky cap** (kill `LATE_RESCUE_CAP_STICKY`,
default ON; restores the documented 85 cap that Stage-2.5b +8 conformance + Stage-4.5 +5 silently lifted to
98; terminal re-cap before overall_confidence; A/B M 10→9, OFF byte-identical) · `ef612ae` **GT repair** (9
poisoned corpus rows re-read at 600 DPI + corrected in `gt_overrides.json`, self-validating; + type-override
support; corpus now type 100% / ref 98.6% / M 10→1 [only #183] / M_type 0) · `2cc20f7` docs · `14d52c4`+
`c9d9480` **per-template field HIDING BUILT** (Task #2; migration **54** `template_hidden_fields`; hide a
field the type has but a layout lacks so Review stops flagging it missing; HIDE-ONLY + superset-locked +
structural roles never hideable; INERT with no rows ⇒ byte-identical; Template Manager toggle + Review
row-skip need a LIVE-TEST). ⚠ Remaining real M = **#183** (skew broke OCR row-grouping → the harvest
SYNTHESISED `PO-20008`; two fixes proposed, NOT built — see `project_183_harvest_synthesis`). ⚠ The
`NAME_GUARD_KEYWORD_CLEAR` flip is now UNBLOCKED (#259 GT repaired) but its gate is "enumerate the docs it
newly auto-files + check each against the PAGE", not M. **↓ The Opus-5 investigation block (superseded on
the facts by the re-review) follows.**
**2026-07-24 LATE (Opus 5) — an INVESTIGATION session. The session was asked to build the REF-HOLD guard
and instead demolished its premise.**
⚠ **THE REF-HOLD GUARD IS DEAD — do NOT build it** (Oracle DO NOTHING, on MECHANISM not measurement: the
doctrine at `anchor.py:651` presumes BOTH reads are credible, and the guard would apply it to one credible
read + one the pipeline already binned as not-credible = the invariant inverted). Measured 0 TP / 9-10 FP.
⚠ **THE CORPUS GT IS POISONED ON 8 ROWS — true M is 2, not 10** (#180 #259 #262 #263 #266 #269 #273 #287
+#190; each page read at 350-400 DPI; only **#183** and **#472** are genuine misreads). This invalidates the
"M-safe" gate on ALL FOUR of 2026-07-24's commits, in BOTH directions — re-run them after the GT repair.
⚠ **#259 is NOT a real misread**: the pipeline's `DN-38472` is CORRECT; its `corrections` row is a
single-character prepend (`N-28472`→`DN-28472`), so the operator fixed a missing letter and never audited
the digits. The prior claim *"two sources say DN-28472"* is FALSE — the quoted "crop read" was verbatim that
row's `original_value`. So `NAME_GUARD_KEYWORD_CLEAR`'s DARK reason does not exist; its gate is NOT "did M
rise" (the harness's scored set excludes `customer_name`) but "enumerate the docs the flip newly auto-files
and check each against the PAGE".
⚠ **ROOT CAUSE = MULTI-FACTOR STACK, no single clean fix (Opus 4.8 re-review, TESTED — corrects the
"skew is THE cause / deskew is THE fix" framing that an earlier pass asserted untested).** For the two
genuine misreads {#183, #472} the chain is: (a) keyword can't read the clean value — po_number labels
lack "Order No" AND the doc's footer boilerplate ("quote this Order No. on all correspondence") collides,
so a naive label-add REGRESSES to null (TESTED) → (b) falls to the taught crop → (c) supplier resolved
LATE → Stage 2.6 blind crop → (d) SKEW clips it → wrong value → (e) the 85 late-rescue cap LEAKS to 98 →
silent misfile. **SKEW is real (deskew recovers #472→PO-98093, #183→PO-60906) BUT DESKEW IS NOT THE FIX:
it is not fail-safe — it CORRUPTED #180 (correct raw `PO-91914` → resample-flipped `PO-81914`), exactly
the `DESKEW_RAW_WITNESS` glyph-flip.** Global deskew trades errors; any deskew must be field-scoped +
witnessed. `project_detect_deskew_parked`/`_deskew_field_reread`/`_deskew_raw_witness` already warned this.
**SAFEST NEXT BUILD = the late-rescue TERMINAL RE-CAP (below): fail-toward-review, Oracle-signed, converts
#472 to held-for-review without solving skew/keyword — but its ~14% review-volume cost is an OWNER call.**
⚠ **#180 is a GT-poison, NOT a genuine misread** (raw pipeline reads `PO-91914` correctly). GT poisoning
re-confirmed at 600 DPI (#180/#259/#266); true M=2. Skew measurement (still valid as CONTEXT): spread
−2.1°…+2.4°, ~15px/degree walk at x_norm 0.83-0.86, up to 66% of a band; corpus is SYNTHETIC (simulated
scans, skew deliberate). ⚠ **(a SYMPTOM, do NOT lead with it, A/B REGRESSED, DEFAULT OFF) structured
ref/date OCR crops slice the glyph bottoms off.** `anchor.py:3053-3058` gives vertical headroom ONLY to
text/multiline_text;
ref/date keep a FLAT 20px. The stated reason ("numerics keep the tight box so they don't bleed into the next
COLUMN") does not cover what it gates — the withheld pad is `half_h`, i.e. VERTICAL, which can only bleed
into an adjacent ROW. Measured on #472 at 300 DPI: OFF ⇒ `"No. PQO-aRano"` (garbage) · 0.25 ⇒ `"No. PO-98092"`
· **0.35/0.4 ⇒ `"No. PO-98093"` EXACTLY CORRECT**. PART 1 BUILT (kill `ANCHOR_STRUCTURED_HEADROOM`, DEFAULT
OFF). ⚠ **BUT THE FIRST A/B FAILED — DO NOT FLIP IT ON:** at 0.35, part 1 ALONE gives M 10→11, M_type 0→1,
ref −2, **0 healed** (new silent wrongs #173 `WS-77682`→`WS-77622`, #484 `PO-83362`→`PO-82262`) — the
adjacent-row/extra-noise risk is MEASURED. Mechanism proven, shipped shape not. Measure part 1+2 TOGETHER,
sweep the ratio DOWN, and consider applying the headroom ONLY where the rigid crop would otherwise be
REJECTED (that shape avoids both regressions by construction). **PART 2 REQUIRED, not built**: the correct
crop is STILL rejected because it carries the caption tail
`No.` and `_pattern_coverage` (`anchor.py:2208-2222`) uses `re.search` = FIRST match (3/12) — and `finditer`
alone only reaches 0.67 < 0.8, so the fix is to STRIP THE TAUGHT LABEL before the credibility gate.
⚠ **Stage-2.6 late-rescue cap leak (real, DEMOTED):** `engine.py:3628` caps 85, then `:3784` +8
(`ocr_corrector.py:274` `boost_table{0:8}` = +8 for ZERO fixes) and `:4358` +5 ⇒ **98**. 55 of 56 rescued
fields leak. Holding them costs 54 correct docs to catch 1 → **re-measure AFTER the crop fix, not before**.
Dead code found: `late_rescue` (`engine.py:3629`) is written and NEVER read; `review/renderer.js:2482` tests
it as a METHOD string and can never fire; `engine.py:4338`'s "never reaches 100" is stale (graduated floor is
**95**, `trust.js:45/548`). `test_late_anchor_rescue.py` 7 RED = ONE stale fixture (its OCR puts the supplier
after "Customer", a recipient marker per `chrome_band.py:26`) — and its `capped at 85` check passes
VACUOUSLY on an empty field. **Prior block ↓**

## (prior) Session state (2026-07-24) — READ `HANDOVER_2026-07-24.md` FIRST
**2026-07-24 (Opus 4.8 1M) — live-testing day WITH the owner; branch `feat/reprocess-throughput-autostraighten`
PUSHED through `f0107f9` (origin in sync `0 0`); tree clean.** Owner-facing pipeline overview (flowchart + plain-
English stage-by-stage): **`docs/DETECTION_OVERVIEW_2026-07-24.pdf`**. **6 code commits, all kill-switched
(OFF ⇒ byte-identical), each advisor→Oracle SIGN-OFF, corpus M-safe:**
`4af4bba` **issue-2 own-label exemption** — a precise labelled keyword read (Invoice No/PO Date) no longer
over-flagged by the taught-ownership guard; SHARED/generic labels (Date/#) still held (kill `TAUGHT_OWNERSHIP_OWN_LABEL`, ON) ·
`5c94db8` **located-recovery** — Stage-2.6b re-runs an owned taught anchor when the supplier resolved LATE (Stage 2
ran supplier-blind) so a correct held ref/date lifts (kill `LATE_RESCUE_LOCATED_CORROB`, ON; #473 fixed; the crop-
BLIND version was Oracle-REJECTED = repeated-date misfile) · `7229cdd` **name-presence veto** — kills a cross-supplier
LOGO false-match on the JS template SUGGESTION path (Larkspur-on-Saltmarsh): a supplier that reliably prints its own
name can't be suggested for a page missing it (kill `TEMPLATE_NAME_PRESENCE_VETO`, ON; live sweep 510 docs → 0 false-
vetoes; guards the pill + teach-wizard save-target + graduation link) · `7d11f86` **name-guard keyword-clear — DARK**
(kill `NAME_GUARD_KEYWORD_CLEAR`, **DEFAULT OFF**) — clears a PHANTOM 'caption disagreed' flag on a keyword-corroborated
name; the owner's raw-OCR-witness idea was Oracle-SENT-BACK (it silently files a stale DRIFTED name); its M-gate rose
10→11 on **#259** (a CORRECT name-flag-clear un-masked a pre-existing REAL ref misread DN-28472→DN-38472), so per
Oracle+owner it ships DARK · (+ overnight `8e2211c` deskew raw-witness ON, `5377e24` slice-1d DO-NOTHING; the naive
cross-tier auto-file lift was MEASURED+REVERTED). **Installer** `dist\ScanFinder Setup 2.0.0-r20260724-1432-7229cdd.exe`
(3 LIVE fixes; name-guard is dark → NO rebuild needed for it). ~~**NEXT — the REF-HOLD guard.**~~
⚠ **SUPERSEDED 2026-07-24 LATE — DO NOT BUILD THE REF-HOLD GUARD.** Its whole premise was wrong: #259's GT is
POISONED (the pipeline's `DN-38472` is CORRECT), the cited crop read `'N-28472'` was actually a `corrections`
row's `original_value` not a measurement, the "single-digit" framing was wrong (the crop is 2 positions off),
the cited site `anchor.py:638-659` is stale (`:642-689`, and it is structurally unreachable on a rejected crop
because it is gated `method == "anchor_crop"` at `:665`), and `on_reject` is TRACE-ONLY so a guard hung off it
would be dead in production. Measured 0 TP / 9-10 false holds. See the LATE block above. **Owner live-checks OPEN**
(on the current installer): Thornbury
invoice/PO_05 (issue-2 + located-recovery) + Saltmarsh sales-order (no "Template available: Larkspur"). Memory:
[[project_taught_ownership_own_label]] · [[project_late_located_corrob]] · [[project_name_presence_veto]] ·
[[project_name_guard_keyword_clear]] · [[project_deskew_raw_witness]] · [[project_slice1d_donothing]]. **Prior block ↓**

## (prior) Session state (2026-07-23 NIGHT) — READ `HANDOVER_2026-07-23_NIGHT.md` FIRST
**2026-07-23 NIGHT (Fable 5) — 15 commits, ALL PUSHED through `b28f581`; tree clean; migration 53.**
`48262e0` **ANCHOR_LINE_SELECT built DARK** (flip = the live Thornbury gate) · UI: editor subgrid rows
+ Keywords pill `c5c1e58`, type-LIST drag `76c2b96`, Review labels left `7b07620` · **identity chain**:
JS detail-hash veto `6ab04f1` (64-bit histograms CROSSED — 2/64 cross vs 18/64 drift, never tune it;
256-bit impostor floor 86) + poisoned-link sweep `2c1dd13` (13 live links, owner --apply PENDING) +
enrolment DARK `c9725e2` (`LOGO_DETAIL_ENROL=1` arms — INVERTED default) + sparse guard `059d87b` →
**unified `b28f581`: BOTH detail arms suggest-only, coarse winner THREADED to the text gate; C5 gate
PASSED (backfilled == starved BYTE-IDENTICAL, 268/390, M=9 same rows) — enrolment flip now SAFE,
owner-timed** · `06470a4` KEYWORD_ANCHOR_CORROB lift + weak-critical-field hold copy ·
repair symmetry: send-back UN-PLANTS `a9f2d42` (hints retract + corrections delete + suspect notes;
corrections queries had NO status filter — that leak is closed), delete/restore `6d61cb0` (mig-53
marker; re-plant IFF retract proven), C7 plant-side foreign filter `de67cc7`. ⚠ PREMISES CORRECTED:
the sparse-set "abstention" theory was WRONG (it was the Slice-D miss-fill arm); the Oracle's
"disagree can't fire on genuine docs" was measured FALSE (the WINNER is the rival on 2-bit
collisions) — he re-adjudicated; "ref-via-keyword NEVER auto-files" was over-broad (shipped patterns
score 90; the support boost self-heals at ≥5 confirms). NEXT (2026-07-24 CORRECTION): Slice 1d
INVESTIGATED → **DO-NOTHING-IN-CODE** (gary + Oracle SIGN-OFF-W/CONDITIONS). The "Stage-0 accepts on
logo alone" premise was a STORE CATEGORY-ERROR: the Stage-0 veto (`_logo_detail_veto`→`veto_by_detail`)
reads `template_logo_hashes.detail_hash` (**Store B, 19/21, written UNCONDITIONALLY at confirm-time**),
NOT the starved Store A `logo_fingerprints.detail_hash` (0/29 = the dark-enrolment/backfill target,
which feeds the ANCHOR path only). Engine threads the query hash (engine.py:2484). MEASURED live:
`veto_by_detail` fires 13/13 on the poisoned links, 0/364 false abstains; a fresh `identify_template`
replay (`stress_test/stage0_detail_veto_probe.py`, veto OFF vs ON) = **0 wrong matches** → the 13 links
are HISTORICAL DATA, not reproducible today. "Mirror the JS twin" would MISFILE (bare one-sided veto is
non-separable at Stage-0 — drift p90 96 overlaps impostor floor 86; regresses 268→131 auto-files).
Owner action = `scripts/poisoned-template-link-sweep.js --apply` (NOT reprocess — the known-id fallback
re-imposes the poison). Full ledger + seam pins + residual-(b) fix: [[project_slice1d_donothing]].
Owner live checks still open. **Prior block ↓**

## (prior) Session state (2026-07-23 EVENING) — READ `HANDOVER_2026-07-23_EVENING.md` FIRST
**2026-07-23 EVENING (Opus 4.8 → Fable 5) — Thornbury live-testing day; 5 commits PUSHED through
`0ae0f46` (origin in sync `0 0`); tree clean.** `0bbfdce` SFDEV trace shows EVERY field + per-field
OCR crop thumbnails · `d91da4b` field drag-to-reorder (shared DocTypeEditor, ⠿ handle) · `274276c`
per-field keyword labels (🏷, reuses label_overrides) · **`1c8243b` E2** — a crop-vs-fullpage
crosscheck flip auto-accepts when a Stage-1 keyword read normalises-equal (re-based `anchor_inline`
@90 ≥ the 88 floor; kill `CROSSCHECK_KEYWORD_CLEAR`; corpus A/B: only 117→118 would-auto-file, M=3
unchanged) · **`0ae0f46`** gate-reread NORMALISATION-ONLY recoveries file clean (0-edit alnum-core;
dates need strict CALENDAR equality — Oracle C1; kill `GATE_REREAD_CLEAN_ACCEPT`; corpus A/B
byte-identical). ⚠ DEAD PREMISES, do not re-chase: E1 "oversized taught box" (all taught ref/date
anchors are SINGLE-ROW h_norm 0.015-0.024 — the 2-row crop is READ-TIME +20px padding bleed) ·
"keyword corroboration inert on delivery_number" (preset installs seed 8 labels — owner caught it).
**NEXT SESSION'S BUILD JOB: `ANCHOR_LINE_SELECT`** — per-line crop selection, fully designed +
Oracle-SIGNED: **`docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md`** is the canonical spec (band +
per-rung rescale, pins a-k incl. RED-first, slice-2 `ANCHOR_ROW_GRACE` builds DARK). Then:
owner-requested **doc-TYPE list rearranging** (backend sort_order READY, UI only) + live-test
drag-reorder/keywords · the **85-vs-88 hold class** (BUILT 2026-07-23 late session, Oracle fork-A:
`KEYWORD_ANCHOR_CORROB` lift + the weak-critical-field panel copy. FRAMING CORRECTED per Oracle C8:
the SEEDED/override keyword path caps at 85 by design — shipped patterns score 90 and clear the
floor — and the class PARTIALLY SELF-HEALS: the Stage-4.5 support boost lifts 85→89 at ≥5 confirmed
docs in scope; the truly-held residue is young scopes + same-batch first contact + constant-value
fields, which the corroboration lift now covers when a second located read agrees. The recovered/
slipfix caps are DELIBERATELY not lifted — anchor.py:1247-1275). P4 CORRECTED: Review already honours sort_order —
only Search-preview extras (rowid) + the /v1 DTO remain. Corpus facts: 276 docs, ref accuracy 95.3%
(the weak spot), several "regressions" are poisoned `N-99718`-style GT. **Base block ↓**

## (prior) Session state (2026-07-23) — READ `HANDOVER_2026-07-23.md` FIRST
**2026-07-23 (Opus 4.8) — a RENDERER-ONLY Review first-run UX fix. Branch
`feat/reprocess-throughput-autostraighten` PUSHED through `f4463cd` (origin in sync `0 0`); tree clean.**
Fixed the "first-import user gets lost in Review" hole: the queue defaults to **grouped-by-sender**,
all groups **collapsed on open**, and on a cold DB every doc's `supplier_name` is null → a single
collapsed **"—"** bar over an EMPTY pane, nothing selected. **2 commits, both pushed:** `5e0fc80` —
new PURE `decideInitialSelection()` (grouped view with a SINGLE sender pile auto-expands + opens doc 1;
**2+ piles → land on nothing**, preserving the collapsed overview; flat unchanged) + made target-nav
**XOR** auto-land (removes a pre-existing double-select race) + relabel the null pile via
`groupTitle()` ("Your scanned documents" alone / "Sender not identified" among named piles; per-row →
"Not yet identified"; **KEY stays `'—'`** so expand/nav unchanged; unidentified pile sunk in the SHARED
sort but BELOW the `need>0` term so a flagged pile is never buried) + an empty-pane "Start reviewing →"
CTA (`#preview-cta`, hidden via the single `_clearPreviewState` seam). `f4463cd` — Defer + File-All
done-paths now `advanceAfterAction()` (land on the next doc in grouped view) instead of blanking the
pane; the flat-only `selectDoc(queue[0])` pattern is now gone from **all three** sites. Advisors:
**barry + eric + oracle (SIGN OFF WITH CONDITIONS C1–C4, all met)**. **No kill switch** (renderer-only;
corpus harness is BLIND to renderer code). **Pinned:** `src/windows/review/test_review_initial_selection.js`
(16/16 green under `node` — extracts+evals the pure fn, incl. the "2+ groups → select nothing" widening
guard). Siblings green; `node --check` OK. **⚠ NOT DONE: the live cold-DB smoke** — reopen Review to
load it; (ii)+(iii) checkable now on the live DB, (i) needs a cold/single-null-pile queue (fresh-install
run or a seeded copy — do NOT wipe the live 187-confirmed DB). **Prior block ↓**

## (prior) Session state (2026-07-22 NIGHT) — READ `HANDOVER_2026-07-22_NIGHT.md` FIRST
**2026-07-22 NIGHT (Opus 4.8) — a LIVE CUSTOMER CRASH session. Branch
`feat/reprocess-throughput-autostraighten` PUSHED through `dde0e39` (origin in sync `0 0`); tree clean.**
Fixed a production crash **`'bool' object has no attribute 'get'`** on 2 PCs (surfaced BOTH as reprocess
"No data returned" AND import→Errors): the logo text-gate **`'suggest'`** branch injects
`results["_needs_review"]=True` (a bool) mid-pipeline (`engine.py:2605`) and the 3 UNGUARDED Stage-0/1/2
"found" counters (`engine.py:2421/:2783/:3010`) `.get()` it → crash; fires once a supplier's LOGO is learned
but its page TEXT doesn't corroborate. **`3e3fde1`** = shared `_count_valued_fields()` guard (log-only,
byte-identical). **INSTALLER BUILT crash-fix-only:** `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe`
(does NOT include the label guard — rebuild off `dde0e39` to add it; ⚠ 4 stray `electron.exe` at wrap-up →
close before building). ⚠ RULED OUT + do NOT re-chase: the parallel reprocess option (`ocr_parallel_reprocess_enabled`)
AND the `field_rules` multiline rule were BOTH wrong leads. **5 commits, all PUSHED:** `2cbc3ec` **P2**
foreign-date-field drop at BOTH confirm sites after the auto-file gate (kill `FOREIGN_FIELD_DROP`; shared
`src/lib/foreignFields.js`; sweep `scripts/p2-foreign-field-sweep.js` found **94** live rows — owner `--apply`) ·
`bd7eb83` date cross-check by CALENDAR date not raw string (kill `DATE_AWARE_CROSSCHECK`) · `f55bf98`
garbled-snippet tidy (renderer) · `3e3fde1` the crash fix · `dde0e39` **label caption guard** — a taught
label ("Item") that leads a HEADING ("Item Information") no longer harvests "information"; nulls the caption
re-read + emits an empty+note row → review (kill `ANCHOR_CAPTION_HARVEST_GUARD`; Oracle conds 1-6 met; corpus
A/B OFF-vs-ON **byte-identical**; the geometry occurrence-picker to make teaching auto-STICK is a DEFERRED
follow-up). Live DB **mig 52, 187 confirmed**. Corpus gate EXITS 1 on the PRE-EXISTING baseline (M=3
poisoned-GT #190/#7 + OCR misreads), NOT this session's fixes (crash fix log-only; label guard A/B empty diff).
**Base block ↓**

## (prior) Session state (2026-07-22 LATE) — READ `HANDOVER_2026-07-22_LATE.md` FIRST
**2026-07-22 LATE adds to the below:** this session's unit tests all RAN GREEN (P1/audit/P3/P5); P1 scope
corrected to **JS-only** (`bc677d1`); **P3 BUILT+PUSHED** (`4e0af32`, wizard 12s self-close, eric-signed,
kill `WIZARD_TEARDOWN_FIX`); **P5 BUILT UNPUSHED** (`0849579`, alphabetical Template Manager, kill
`TEMPLATE_VIEWER_ALPHA`). Origin at `5db3590`, **1 commit ahead**. Open: H2 owner decision · P2/P4
designs · installer rebuild + owner live-test of P3/P5/teach. **Base block ↓**
**2026-07-22 (Opus 4.8) — the night run + a security-audit remediation pass; branch
`feat/reprocess-throughput-autostraighten` has **11 commits UNPUSHED** on top of origin `370d04d`
(`f6d85b5`→`90ecaf7`). Tree clean except this session-state refresh.** The LATE handover's UI batch is
now COMMITTED (`f6d85b5` cards, `1618f77` wizard height, `f9bc202` teach batch — **still none owner-tested**).
**P1 BUILT** (`ac7bdb3`): `repairSuspects.detectRefPrefixOutliers` (JS, kill `REPAIR_PREFIX_MISMATCH`) —
suggestion-only Learning-Repair flag for a ref whose alpha prefix (DN/PO/SO/INV) disagrees with the
type's dominant one. **JS-ONLY by deliberate reggie+Oracle decision** — the "one side or both" answer is
**JS-only + a Python tripwire**: `format_anomaly_checker.shape_signature` stays PREFIX-BLIND on purpose
(prefix-awareness at extraction time would fail-toward-review-violate on a new supplier), pinned by
`test_format_shape_consistency.py` §8. Do NOT port the rule into Python. Tests green (JS 27/27 + Py §8). **P3 BUILT** (`4e0af32`, kill
`WIZARD_TEARDOWN_FIX=0`): the first-run wizard's 12s self-close — `openMainShell`'s teardown now
identity-scopes the captured cover-window instances + tears down synchronously on the reuse branch +
stores/clears the backstop timer (`src/lib/coverTeardown.js`, pin `test_coverteardown.js` 19 checks;
eric SIGN-OFF-W/CONDITIONS, all met). **⚠ needs an owner FULL-RESTART to confirm live** (main-process
change); does NOT fix the separate "Re-run reopens a stale wizard on its old step". **P5 BUILT** (2026-07-22,
kill `TEMPLATE_VIEWER_ALPHA=0`): Template Manager roster now ALPHABETICAL by name — sorted in the
viewer-only wrapper `templates.getAllWithLiveCounts` (its sole non-test caller is the `get-templates`
IPC); the matcher-facing `templates.getAll` count-desc order is left BYTE-IDENTICAL (pinned in
`test_template_confirmed_count.js` with divergent names). **P2 DIAGNOSED, P4 DESIGNED** (`b0739ca`, docs
in `docs/designs/`): P2 fault(b) root cause = generic Stage-1 date patterns all carry a bare `"Date"`
label, so a delivery docket's `Date:` fills invoice/order/po_date alike (Option A storage-seam fix
recommended, NOT built). **SECURITY AUDIT `SECURITY_AUDIT_2026-07-21.md` — 6/7 FIXED:** H1 CA-key-at-rest (`8546932`,
`src/lib/secretStore.js`) · M1 secure_delete (`75634be`) · M2+M3 `/v1` session-revoke + TOTP re-auth
(`90ecaf7`) · M4 nav lockdown (`3555c73` `src/lib/navGuard.js`) + CSP `'none'` sweep (`12c9da1`) · M5
empty-array backup guard (`596c083`). **H2 (LAN pairing TOFU) is the ONLY open finding — DESIGN ONLY,
needs OWNER Path-A-vs-B call** (`docs/designs/AUDIT_H2_PAIRING_2026-07-21.md`; add-on OFF by default = no
live exposure). ⚠ **UNVERIFIED: no test suite / corpus gate was RUN this session — unit tests authored,
not proven green.** Installer predates all 11 commits → REBUILD before any live test. Nothing pushed.

## (prior) Session state (2026-07-21 LATE) — `HANDOVER_2026-07-21_LATE.md` (NIGHT RUN NOW DONE — see 07-22)
**2026-07-21 LATE (Opus 4.8) — UI session; branch `feat/reprocess-throughput-autostraighten` was
pushed through `370d04d`** (verified `git rev-list --left-right --count @{u}...HEAD` = `0 0` —
the earlier "7 commits ALL UNPUSHED" note below is STALE, do not re-push). **(This batch is now
COMMITTED as `f6d85b5`/`1618f77`/`f9bc202` — see the 07-22 block; still NONE owner-tested.)** (1) `onboarding/index.html` **first-run cards** — a `theme.css` `.card + .card{margin-top:16px}`
leak knocked every row-card after the first down 16px (the long-standing "second card doesn't line up");
cancelled + selected card grows via **flex-grow NOT scale** (scale overlapped the wide Accuracy row) —
owner said "this is better" · (2) `main.js` **wizard height 720→820**, screen-clamped via new
`onboardingWindowOptions()` (fixed-size window must fit its TALLEST step; step 1 grows ~95px when
"Choose a folder" reveals the path row) — NOT yet seen running · (3) `teach/{index.html,renderer.js}`
**teach batch** (7 changes): native-resolution crop = **OCR parity with Review** (fixes teach reading
`SO-51261` as `$00-51261`; kill `TEACH_NATIVE_CROP=false`), **Issuer taught POSITION-ONLY** (no phantom
label anchor; same rule as Review RC2), read-back panel moved to the banner via one `setConfirm()` seam,
`.pact`/`.ptitle` prompt emphasis via one `setPrompt()` (⚠ the "What to do now" GUIDANCE BAND was
REJECTED — do NOT rebuild), page-preview doc picker + 1.5× default zoom. **WIZARD SELF-CLOSE ROOT-CAUSED
(not fixed):** `openMainShell()` arms an uncancelled `setTimeout(teardown,12000)` (`main.js:210-217`)
whose `destroyWindow('onboarding')` resolves the window at FIRE time, so any wizard alive 12s after any
`openMainShell()` is destroyed — and on a re-run the main-shell reuse branch skips `loadFile` so
ready-to-show never fires and the 12s timer is the ONLY teardown. Fix = run teardown synchronously on the
reuse branch + identity-scope it + clearTimeout (eric-gate). **Corrections to CLAUDE.md:** live DB is at
**mig 52** (not "51 until next start"); opt-in diagnostics IS built (`telemetry.js` + mig 42 + Settings
toggle + wizard card, OFF by default — not "DESIGNED but NOT built"). **The AUTONOMOUS NIGHT RUN this
block planned (§7) HAS RUN — P1 built, P2 diagnosed, P3–P5 designed; see the 07-22 block for outcomes.**
Installer `...r20260721-1010-581d626.exe` predates the 07-22 commit stack → REBUILD before live-test.

## (prior) Session state (2026-07-21) — READ `HANDOVER_2026-07-21.md`
**2026-07-21 (Opus 4.8) — 7 commits, ALL UNPUSHED on `feat/reprocess-throughput-autostraighten`
(`f08f131`→`8f41e95`); tree clean.** Overnight SECURITY AUDIT delivered (`SECURITY_AUDIT_2026-07-21.md`,
gitignored: DB not encrypted → recommend disk-level; licensing self-grant main-process-only; PHP
hardening inert until IONOS). Then, live-testing: (1) `581d626` **label-as-value** — a taught 'below'
anchor no longer commits its own caption garble (order A→C→D→B; kills `NAME_HOLD_ADMIT_OVERRIDE`/
`LABELLOCK_INLINE_PROVENANCE`/`CAPTION_BAND_REJECT`) · (2) `666258a` **identity self-poisoning** — the
`TEMPLATE_SUPPLIER_LINK_GUARD` confirm path voted the doc-being-confirmed for its own stale identity
(the "Copperfield sticks after re-teach" root cause); `getDominantSupplier`/`establishedIdentity` now
take `excludeDocId` (kill `TEMPLATE_GUARD_SELF_INDEPENDENT`) · (3) `27d54b7`+`5760489` **Search UI** —
vertical rail + zoom/pan + expandable details + ↑/↓ cycle · (4) `1234814` **box-width learning**
(migration **52** `field_anchors.max_w_norm` high-water; DARK behind `ANCHOR_MAX_CROP_WIDTH`; live DB
**IS at 52** — the "still at 51" note was superseded once the app restarted) · (5) `80d532c` **letter-spacing type recovery** — "PU RC HASE ORDER"→
Purchase Order via top-band collapsed-equality + Seam-B heading force (default ON `HEADING_LETTER_SPACING`;
multi-word-only guard) · (6) `8f41e95` audit-log View buttons styled. **Installer
`...r20260721-1010-581d626.exe` predates commits 2–6 → REBUILD before owner live-test.** Non-bug: filed
files show scan mtime (copyFileSync preserves it), not a filing bug. Poisoned GT: doc #190
LarkspurInteriors_purchase_order_08 mis-confirmed as delivery_note. **QUEUE (diagnosed, not built):**
first-run-wizard output-folder-not-copying-on-a-different-PC (REAL, unstarted) · per-template field
HIDING (superset-locked, structural-protected) · keyword-per-field (backend done, UI left) · po_date
corroboration date-separator exemption · worksheet line-merge mode-3 (diagnose doc-156 A-vs-B first) ·
buyer-issued Supplier→issuer guard trace · `LETTERHEAD_ISSUER` flip · **TEACH-WIZARD PROMPT EMPHASIS — DONE 2026-07-21, uncommitted**
(owner: the wizard is hard to follow — "you don't know what to do next, so you find yourself looking for
the instruction". ⚠ A "What to do now" GUIDANCE BAND above the pane was built and **REJECTED by the owner
as "too much" — do NOT rebuild it.** The accepted answer is far smaller: make the EXISTING step-3 banner
stand out by splitting the prompt into a quiet ACTION line + the FIELD NAME as a title
(`.pact`/`.ptitle` in `teach/index.html`; single `setPrompt(action,title)` helper in `teach/renderer.js`
so a later prompt can't lose the emphasis). Awaiting owner test) ·
**FIELD ORDER UNSTABLE ACROSS DOCS** (owner 2026-07-21, Search pane + probably the detached client:
the same type's fields appear in a DIFFERENT order doc-to-doc. LEAD, evidenced: `getWithExtractions`
`database/modules/documents.js:126` is `ORDER BY rowid` = the order the PYTHON ENGINE happened to emit
fields for THAT doc, which varies by which stage won — so it is arbitrary per document. `fields.sort_order`
ALREADY EXISTS (`database/index.js:1205`, default 100) and is the intended canonical order. Fix = order
displayed fields by the type's `sort_order` (fallback rowid) at the SHARED seam so Review/Search/client
all agree; then ADD drag-to-reorder in the Doc Type editor writing `sort_order`. ⚠ structural roles
issuer/date/ref must stay reorderable-but-never-deletable; check the /v1 DTO contract before changing
client-visible ordering) · **"RE-RUN SETUP" REOPENS A STALE WIZARD, NEVER A FRESH ONE** (found 2026-07-21 while styling
the cards. VERIFIED: `close_to_tray` defaults to `'true'` (`main.js:655`), and onboarding is in
`PRIMARY_WINDOWS`, so the window X **hides** it (`main.js:571-578`) instead of destroying it.
`showOnboarding()` (`main.js:220`) then calls `createWindow`, which REUSES a live window —
`.restore()/.show()/.focus()` and returns WITHOUT `loadFile` (`main.js` createWindow reuse branch).
So Settings→Advanced→Re-run setup re-shows the wizard **on whatever step it was left on, with the
previous field values and stale renderer state** — it does not restart setup. Also means renderer
edits to onboarding/login/license/main need a FULL APP RESTART, not a window reopen (child windows
like teach/review/settings/search DO reload — they are destroyed on close). FIX DIRECTION: have
`showOnboarding` reload/reset when reusing (e.g. `loadFile` again), so the wizard always starts at
step 0. ⚠ Check the same reuse-without-reload seam on login/license before changing createWindow
itself) · **"MIGHT NOT BELONG" IS BLIND TO A REF-PREFIX OUTLIER** (owner 2026-07-21, doc **#190**
`LarkspurInteriors_purchase_order_08.pdf` — a PURCHASE ORDER confirmed as a DELIVERY NOTE, with
`PO-21275` stored in Delivery Number while every sibling reads `DN-#####`. ROOT CAUSE **VERIFIED, not
hypothesised**: `repairSuspects.shapeSignature` (`src/services/repairSuspects.js:36-45`) maps EVERY
letter to `@`, so `PO-21275` and `DN-70795` BOTH reduce to `@@-#####` — identical. The detector
discards the only differing token, so this class is STRUCTURALLY invisible; no threshold tuning can
ever surface it (B1 at :182 and the pool check at :239 both compare shapes only). FIX DIRECTION: learn
the dominant ALPHABETIC PREFIX / literal token per (doc-type, field) alongside the shape and flag a
strong-dominant mismatch — owner: "needs to be smarter than a 1-char swap". ⚠ Mirror lives in
`format_anomaly_checker.shape_signature` (python) — keep the two aligned or they drift. NOTE doc #190
is ALSO the known poisoned-GT doc, so fixing this detector would have caught the poisoning itself) ·
**IRRELEVANT DATE FIELDS ALL FILLED WITH THE SAME VALUE** (owner 2026-07-21, seen in Learning
Repair on `IronbridgeFabrication_delivery_docket_04.pdf`: a DELIVERY NOTE shows Delivery Date **and**
Invoice Date **and** Order Date **and** Po Date, all four = "12-06-2026", while the real Delivery Date
read as the garbled "2 12/06/2026" and got flagged. TWO separate faults: (a) a delivery note carries
invoice/order/po date fields AT ALL — CLAUDE.md already records that extraction runs against the UNION
of all installed types' keys, so a date lands in every date-ish key; (b) one date value is copied into
every one of them, which then feeds learning as if corroborated. Overlaps the per-template field HIDING
item but is NOT the same thing — hiding is display-only, this is bad DATA being stored and learned.
Diagnose which stage writes the duplicates before designing) · **TEMPLATE MANAGER ALPHABETICAL** (owner 2026-07-21. LEAD: `templates.getAll`
`database/modules/templates.js:32` sorts `confirmed_count DESC, name`. ⚠ SEAM — that same `getAll` feeds
the sibling tiebreaks and "the order templates reach the matcher" (`277a107`/`TEMPLATE_LIVE_COUNTS`), so
do NOT re-sort the query; sort in the Admin Template VIEWER only, or add an explicit display-order arg).

## (prior) Session state (2026-07-20) — full detail in `HANDOVER_2026-07-20_LATE.md` + `docs/session-log.md`
**LATE SESSION 2026-07-20 (Fable 5) — READ `HANDOVER_2026-07-20_LATE.md` FIRST.** All pushed
through `2a81124`, tag `milestone-20260720-identity` (owner-marked good point). **CURRENT installer
`dist\ScanFinder Setup 2.0.0-r20260720-2050-2a81124.exe`** — every earlier one is stale. The live
DB was WIPED ~21:00 for a fresh-install test (migration 51); the OLD 213-doc misfile corpus is
preserved at `%APPDATA%\ScanFinder\docusnap.backup-20260720-misfile-corpus.db` (replayable via
`TEMPLATE_PROBE_DB`).
**THE FRESH SESSION'S BUILD JOB — the LABEL-AS-VALUE plan (Oracle-ruled, NOT built).** A correctly-
taught 'below' anchor commits a garble OF ITS OWN LABEL ('Vetiver 10'≈"Deliver To") as
customer_name — 12/20 live Ridgeway dockets, 7 of 12 UNFLAGGED; on a graduated supplier the class
silently wrong-files. Root causes (007 instrumented replay, all code-verified): the OCR ladder's
preview fast path re-crops the FULL PAGE from the UNCLAMPED box (anchor.py:2335-2347/:2402/:2448 —
restores the caption band the :525 clamp excluded; `clean_crop_segment` takes the FIRST line) · a
swallowed NameError at :578 (bare except :598; fixing it ALONE makes inline junk MORE Tier-A-
eligible — sequencing load-bearing) · flag family structurally capped
(name_quality('Veliver to')=1.0 == 'Denver Trading') · merge hold dead on `keyword_override`
(engine.py:255 checks =="keyword") · Tier-A ignores confidence. **Build order A→C→D→B** (ladder
clamp → composed reject [bare fuzzy-echo vocab AND window-overlaps-caption-band; content alone
CANNOT separate: gary's full-label echo misses 'Vetiver 10' at 0.444, the bare vocab falsely
rejects 'Denver Trading' at 0.286] → keyword_override one-token → NameError fix; E crop-first
DEFERRED). Full plan + merge gate: memory `project_label_capture_plan.md`. ⚠ DATA HYGIENE: the 12
garble docs are in the review queue — confirming one plants the garble into learning; reprocess
after the fix, or correct Customer per-doc first.
**GEOMETRY SLICE BUILT+MEASURED, still DARK (`2a81124`, LETTERHEAD_ISSUER=0):** words_out threads
page-0 rows/heights → `pick_issuer(geometry=)`; COLUMN-SEGMENT candidates, LINE-level heights
ratioed to med_h, fragment-yields-to-superset. Real scans 0%→**67% correct** (117/174, 13 garble
fragments, 44 honest abstains), synthetic 45/45. Flip = owner+Oracle decision. Corpus byte-identical
proven on a SAME-DB stash pair (mid-session A/B is invalid while the owner confirms — re-pair).
**Earlier today (see EVENING/daytime handovers):** trust gate `eb79638`, issuer band `e8f3a6c`,
detected-type nudge `0f3c8e9`, word-geometry hand-off `1bc144e` (now consumed by the slice above).
**Five PRE-EXISTING test failures catalogued by stash-bisect (NOT today's work, un-triaged):**
test_anchor_crop_crosscheck(3) · test_late_anchor_rescue(7) · test_template_rescue(1) ·
test_field_data_types(silent) · test_identity_fusion(known).
**THE 10 template_fixed MISFILES ARE FIXED (late evening 2026-07-20, `705da10`→`7c541fa`)** — full
investigation → gary+Phillip design → Oracle SIGN-OFF-WITH-CONDITIONS → built in his order. Five
kill-switched slices, ALL ON: `TEMPLATE_SUPPLIER_LINK_GUARD` (the confirm-time reinforcement loop —
Oracle's blocking catch: a corrected confirm bumped/appended/diluted/landmark-sampled the WRONG
template; guard at BOTH the reviewService confirm seam and `_upsertTemplate` Part E) ·
`TEMPLATE_GATE_DISTINCTIVE` (Stage-0 gate on distinctive tokens — V1 was defeated 3 ways: the
logo+slug bypass, junk 'INV'/'Industrial' stored tokens, and a rival bar unreachable by cross-type/
customer-leaked fingerprints; V2 = per-identity banks + supplier-NAME arm, fuzzy, issuer-band) ·
`BRANDING_DISTINCTIVE_TOKENS` (engine banks, parity-pinned) · `FINGERPRINT_HYGIENE` (digit-glue
harvest skip + confirmed-customer-token subtraction; stored leaks HEAL via the update intersect) ·
`BRANDING_NAMED_BLANK` (a named-rival-contradicted `template_fixed` value blanks + keeps the "Use"
button; locked/un-named/non-template NEVER blank). **Gate: `stress_test/template_gate_probe.py`**
(permanent live-DB replay — realdoc_regression is BLIND to this class): 52/52 wrong-match outcomes
healed (the 10 + the Larkspur-class), false-abstain 0; corpus ON == baseline byte-identical.
**The 6 misfiled Vellum docs in review are safe to correct+confirm once a build with the guard is
installed** (needs an installer REBUILD — the current one predates all of this). Residual, honest:
a FULLY cold supplier (no template/hints/name anywhere) still accepts + flags with the wrong name —
that is the letterhead cold-start thread's job, not this fix's.

**Branch `feat/reprocess-throughput-autostraighten` — ALL PUSHED through `2a81124`, working tree
clean. (Installer note superseded — the CURRENT installer is `...r20260720-2050-2a81124.exe`, see
the LATE session block above.) Daytime detail: `HANDOVER_2026-07-20.md` (then
`HANDOVER_2026-07-19.md`).**
- **OWNER-REPORTED LIVE BUGS FIXED 2026-07-20** (all root-caused from their log + a copy of the
  second machine's DB, all corpus-gated byte-identical): **`04a6af1` the FRESH-INSTALL TYPE HOLE** —
  a type detected from the SHIPPED keyword buckets but NOT installed (Delivery Note is a PRESET, not
  a built-in) left `detected_slug` None, which silently DISARMED **both** type-refuse guards, so a
  same-supplier PO template stamped its slug on delivery dockets; now the slug is DERIVED
  (`_slug_from_type_name`, parity with JS `safeSlug`; kill `DETECTED_SLUG_FALLBACK`) ·
  **`277a107` `templates.confirmed_count` was ALWAYS 0** (only bumped on the taught-confirm branch) —
  NOT cosmetic: it feeds the sibling tiebreaks at `template_matcher.py:179` + `engine.py:696` and the
  order templates reach the matcher, all inert at 0; `getAll` now serves the LIVE count
  (`liveConfirmedCounts` returns **null**, not an empty Map, when uncountable so a fixture without a
  `documents` table keeps the stored value; kill `TEMPLATE_LIVE_COUNTS`; a pin asserting "getAll is
  UNTOUCHED" was deliberately flipped) · **`0107331`** a GARBLED caption on the RELOCATED crop (the
  exact check was relocate-only, the fuzzy check rigid-only — a garbled relocate fell between them) ·
  **`53ceea9`** Review now says WHY a clean doc waits below the auto-file threshold.
- **UNTYPED-DOC REVIEW MESSAGE FIXED `39e8142`** (gary design → Oracle SEND-BACK-WITH-CONDITIONS;
  his C1 IS the commit): a null-type doc used to fall through to the clean-hold branch and be told
  "just below the X% you've set — lower the threshold", which is FALSE at any threshold because
  `trust.js` refuses `no-type` unconditionally; `validateConfirm` also disabled Confirm with NO note.
  New FIRST branch in `renderReviewReason` **gated on `document_type_id`, NOT on any detected name**
  (the advice is wrong for EVERY untyped doc; detection usually returns nothing at all) + a note on
  the no-type Confirm return. ORDERING is the load-bearing property — pinned by
  `src/windows/review/test_review_untyped_reason.js` (8 checks red pre-fix). **STILL OPEN (gary's
  slice 1 tail, Oracle C2/C3/C5/C6): `detected_type_name`/`detected_type_conf` columns (migration 51
  is free) + the "Add '<type>'" button. TRAP to solve first — extraction ran against the union of
  all installed types' keys, so add-type → auto-select rebuilds rows by key and every field goes
  BLANK; add-a-type must be followed by a REPROCESS (safe: reprocess forces needs_review and
  `_maybeAutoFile` has ONE call site, the import `file_done` path) or must not auto-select. Also:
  clear the columns wherever a type is later assigned, and `document_type` can be template-overridden
  while `type_confidence` is always the keyword score (don't pair them blindly).**
  ⚠ `realdoc_regression.js` spawns `process_docs.py` DIRECTLY — it is structurally blind to every
  Electron/renderer change. A green corpus run proves nothing about renderer work.
- **DETECTED-TYPE NUDGE BUILT `0f3c8e9`** (the tail above, Oracle C2/C3/C5/C6): **migration 51**
  `documents.detected_type_name` (NULL-inert; set ONLY when a detected name matches no installed
  type; **name only — no confidence column**, since `type_confidence` is a keyword-bucket score and
  `document_type` can be template-overridden) · one helper `_resolveDetectedType` at BOTH insert
  seams, reprocess **CLEARS** via plain assignment not COALESCE (else the suggestion outlives the
  type being added) · Review's untyped notice gains "Add '<type>'" which **adds AND RE-READS** —
  auto-select alone BLANKS every field, because extraction ran against the union of all installed
  types' keys (Oracle's best catch) · **NO slug fallback** (would newly resolve types exact matching
  misses = a live `document_type_id` change; pinned out) · kill `DETECTED_TYPE_NUDGE=0`. PIN A: a
  named detection never adopts Generic. Guarded by `test_detected_type_nudge.js` (whitelist trap
  proven red first). **UNCLICKED — needs an owner fresh-install run with dockets.**
- **AUTO-FILE TRUST GATE — non-role shape leniency, DEFAULT ON `eb79638`** (built dark `5f88791`;
  Barry+gary designed, **Oracle SENT BACK and the shipped design is his**). Sub-100 auto-file
  required EVERY valued field to pass `valueMatchesShape`, which returns false for `'freetext'` BY
  DESIGN — so a per-document customer name made the gate UNSATISFIABLE and **graduation unreachable
  for any doc carrying one**. Measured: 29 docs held, 25 of them among 156 already hand-confirmed.
  **THE TRAP THAT KILLED TWO DESIGNS:** `item="Information"` is a misread that GETS CONFIRMED, which
  collapses its own field to freetext — so a blanket freetext exemption **disarms the guard exactly
  when the field is poisoned** (today's blanket block fails SAFE under contamination; both proposed
  designs failed OPEN). Also rejected: keying on `isNameLikeField` — it matches on SUBSTRING, so
  `customer_order_number`/`company_reg_no` are "name-like" CODE fields; it was built for
  `_buildTemplateFields` where over-inclusion is safe, here it inverts. **SHIPPED:**
  `_dominantStructuredClass` (≥5 samples, ≥75%) consulted ONLY in the lenient branch — 14 codes
  outvote one intruder, 11 varied names abstain. Do NOT change `classifyLearnedShape` itself (it
  feeds `scopeTrust`, and reclassifying there widens GRADUATION). NULL/dangling role ⇒ NO leniency
  (the 88 floor is already a no-op there — two guards off at once). Gate: corpus A/B 50→82
  would-auto-file, **M unchanged at 1**, M_type 0, accuracy byte-identical. Kill
  `TRUST_NONROLE_SHAPE_LENIENT=0`. Pins: `test_scope_trust.js` §18b (contaminated history — FAILS
  against the rejected design) + §18c (NULL-role) + the both-directions trade-off pin.
- **REVIEW HOLD REASON IS NOW AUTHORITATIVE (`5f88791`, Oracle merge precondition)** — the panel
  derived its message from the confidence threshold and claimed that was "truthful by construction".
  **FALSE once graduation is active** (effective floor = min(threshold, 95)), and wrong BOTH ways: a
  gate-held doc was told to lower a threshold that cannot help it, and a graduated doc ABOVE its
  floor was told **"Ready to file"** about a doc the predicate had refused. New `get-auto-file-reason`
  IPC returns the SAME predicate's verdict; the panel names the blocking field. **THIRD false
  hold-reason of this class fixed 2026-07-20** (`39e8142` untyped, this one, + the nudge copy) —
  when Review explains a hold, it must read the real verdict, never re-derive one.
- **ISSUER BAND for known-supplier text matches `e8f3a6c`** (gary design → Oracle SIGN-OFF-WITH-
  CONDITIONS C1-C4). `engine.py` Stage 2.5a matched a known supplier HINT anywhere in a raw
  `ocr_text[:600]` slice whose docstring called it "the issuer band" — it isn't: the RECIPIENT name
  sits ~160-180 chars in on real docs, so the CUSTOMER was admissible evidence for the ISSUER.
  Now `_issuer_hint_band` truncates at the first recipient marker via `chrome_band.issuer_chrome`,
  keeping the 600-char REACH (`_HINT_BAND_LINES=40`) — chrome_band's own `max_lines=6` default is
  NOT used and must NOT be moved (it is calibrated for TOKEN-RATIO consumers like
  `_identity_text_sufficient`; this consumer is an all-or-nothing substring test). Kill
  `ISSUER_HINT_BAND=0`. **THE REWARD IS ON THE GRADUATION ARM, not the swap arm** — graduation swaps
  a NOTED fill for an UN-NOTED one and `trust.js` refuses auto-file on any note BEFORE the floor
  check, so the note IS the human checkpoint; its stated evidence standard (`engine.py:3024`) had
  never matched the code. **Oracle C1 (the blocking catch): the swap arm has NO else** — suppressing
  a match left an IMPLAUSIBLE incumbent ('IN') standing as the filing + learning scope, unnoted; it
  now blanks with a note, DELTA-SCOPED to only where the legacy slice would have matched.
  HONEST SCOPE: marker-bearing layouts only — a marker-free "To:"-first page still gets the legacy
  window. Accepted+pinned costs: issuer-RIGHT two-column loses its match; a two-row-wrapped name is
  newly matchable. **Does NOT fix the buyer-issued vendor-caption class** (needs a type-aware slice;
  do NOT add supplier/vendor/seller to `_RECIPIENT_MARKER` — type-blind, 3+ consumers, and
  "Supplier: ACME" is the issuer's own self-declaration on a supplier-issued form).
- **⚠ THE ISSUER IS ONLY FINDABLE BY A CAPTION — the structural cold-start hole (OPEN)**. Traced
  2026-07-20: `Vellum & Crane Stationers` is OCR line 1 and `supplier_name` comes back null.
  `field_patterns.supplier_name` is caption-only (Bill From/Supplier/Vendor/Issued By/Billed By/
  Seller/Company Name/Business Name) and real letterheads carry NONE; `position_hint:"top_third"`
  is DEAD CONFIG (read nowhere). The RECIPIENT *is* captioned (`Bill To`, base_confidence **78** vs
  the issuer's **40**). EVERY other issuer path (template/logo/hint-scan/branding) is
  learning-dependent ⇒ dead on a cold DB. 007: the geometry that would fix it (word boxes, heights,
  `med_h`) is COMPUTED THEN DISCARDED at `ocr/tesseract.py:239` — `keyword.py` gets a bare string, so
  "largest text in the top band" is UNREPRESENTABLE, not merely unimplemented. Designed, NOT built:
  a `letterhead.py` SUGGESTION-only reader (it only ever has to carry doc #1 — after one confirm,
  learning resolves the supplier forever, so it never needs authority to assert).
- **⚠ RECURRING TRAP — THREE stale fixtures fixed in one day, all one class** (`71ffc8d`, `0f3c8e9`):
  a `documents`/`templates` test fixture that never gained a column production gained. Because
  `documents.insert()`/`templates.create()` name every column, the INSERT fails outright and EVERY
  downstream assertion reads as a PRODUCT regression ("the failure-row producer regressed"). SUSPECT
  THE FIXTURE SCHEMA FIRST. Also: `documents.update()`'s `allowed` whitelist SILENTLY DROPS unknown
  keys — a column added to `insert()` but not there writes once and can never be cleared.
- **THE TWO PRE-EXISTING TEST FAILURES ARE FIXED (`71ffc8d`)** — both were stale, not regressions:
  `test_reprocess_type_flip.py` unpacked a 5-tuple from `doc_overrides` (6 since the supplier-pin
  work), and its own shape pin was red too so it never flagged it; `test_promote_custom_doctype.js`
  had a fixture predating `logo_detail_hash`/`detail_hash` (mig 47), so the promote died on
  "no such column" and EVERY later assertion cascaded off that one error. A stale pin there was
  deliberately flipped: it asserted a recipient `customer` name freezes as a template `fixed_value`,
  which contradicts `_buildTemplateFields` rule (B) — only the ISSUER is legitimately constant.
- **WORKFLOW SUITE — engine COMPLETE for single-hop; 2 slices left, neither blocking**: built =
  slice 0 (authz) · 1 (reveal core) · 2 (decision snapshot) · 3 (amount routing) · routing-settings ·
  FYI non-locking · E1 admin cancel. REMAINING = **slice 5 delegation+escalation** (a real feature,
  not a prerequisite) and **slice 6 PACKAGING FLIP** (unbundle from the client seat + backend SKU +
  entitlement card — this is the go-live switch). Slice 4 multi-step DEFERRED (Barry). The temp
  `WORKFLOW_FEATURE_ENABLED=true` flip is REVERTED (`14a7d2e`) — the suite ships dark; flipping it
  locally for testing turns `test_entitlement.js` red, which is expected, not a regression.
- **FYI NON-LOCKING slice BUILT 2026-07-19 (Barry→gary/eric→Oracle C1–C8, 20-suite gate green)** —
  only open APPROVE routes lock (`hasActiveApprovalRoute`, NOT-acknowledge polarity incl. NULL;
  env `WORKFLOW_ACK_LOCKS=1` restores old locking); delete now CLOSES open routes as 'recalled' +
  "Document deleted by <name>" at ALL SIX soft-delete doors (five were unguarded — pre-existing
  approve-strand hole fixed; **/v1 delete also GAINED editGuard**, was a remote authz hole); rule
  builder offers "for approval / for information"; mailbox shows "For your information"/"Got it"
  (display-only). Spec+conditions `docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md`. KNOWN:
  `test_entitlement.js` fails while the temp flag flip is in the tree (revert to clear).
- **E1 ADMIN CANCEL-ROUTE ALSO BUILT 2026-07-19 (gary GO-W/CHANGES + eric + Oracle OC1–OC4;
  19-suite gate green)** — `workflowService.adminCancelRoute` (admin-only both layers; pending AND
  claimed; CAS; comment ALWAYS "Cancelled by <name> (administrator)" = the third 'recalled'
  producer discriminator; conditional workflow_status stamp; `admin_cancelled` badge-only event;
  heals routes on deleted docs/recipients — NEVER add a ROUTABLE_STATES check there) + 3 IPCs
  (`workflow-admin-cancel` / `workflow-doc-routes` access-gated per SEC-03 / `workflow-open-routes`)
  + Search-preview routed-banner (self-populating `.wf-routed`, two-step confirm, no native
  confirm()) + Settings→Workflow "Open routes" list (THE discovery surface — system routes appear
  in nobody's Sent; deleted-doc rows included as the legacy-strand healer). Spec
  `docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md`. The workflow feature is now
  PRE-LAUNCH-COMPLETE per the handover checklist. **NEXT:** owner live tests (print/Ricoh; a
  click-through of the rule builder + FYI flow + cancel surfaces while the flag is on) → revert
  `WORKFLOW_FEATURE_ENABLED` to false before any push/build → push decision (23 commits).
- **Workflow suite**: Slices 1–3 + the routing-settings slice ALL BUILT, DARK behind
  `WORKFLOW_FEATURE_ENABLED=false` (entitlementService.js). Routing = a separate step at the FILING SEAM
  for EVERY filed doc (auto-filed via `workflowService.assignSystem` null-sender + reviewed + File-All-Ready),
  admin rules in a hidden Workflow Settings tab. Spec `docs/designs/WORKFLOW_ROUTING_SLICE_2026-07-19.md`;
  Slice-1 plan `docs/designs/WORKFLOW_SLICE1_BUILD_2026-07-18.md`. Multi-step routing DEFERRED (Barry).
- **⚠ AWAITING OWNER LIVE TEST**: print flow fix `75206fb` (does the Ricoh spool paper? z-order OK?) —
  Electron 31 CANNOT show the classic Windows print dialog (Win11 behaviour; print callback UNRELIABLE —
  modal is callback-independent); clean native rebuild BANKED in `docs/designs/NATIVE_PRINT_2026-07-18.md`
  (C2: compiled C# helper, NOT .ps1). Also pending: Generic-Document owner smoke; reprocess-parallelism
  load test (`ocr_parallel_reprocess_enabled`); Filing Slips real-MFD pilot (then slice 5 watch parity
  BEFORE default-ON).
- **Recently shipped, DEFAULT OFF unless noted**: Filing Slips slices 1+2 (synthetic pilot PASSED);
  Generic Document type + Auto-Title (6 slices, `4a4abe4`); template convergence M2/M3
  (`TEMPLATE_REUSE_BY_BRANDING` — ⚠ open: real-DB duplicates have no landmarks → merge won't fire, see
  `docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md`); supplier PIN + resolve-the-issuer (`SUPPLIER_PIN`);
  single-doc reprocess parallelism B+C. DEFAULT ON: accessService authz gate (SEC-03 fix, `f8299d4`);
  auto-file critical-field floor (88); Slice D 256-bit logo detail; OCR warm worker pool; the 2026-07-09→15
  extraction-guard family (see the archive).
- **Security**: work `SECURITY_BACKLOG.md` (repo root, gitignored, LOCAL-ONLY) one-by-one; proactively
  flag holes any new feature exposes. **CODE-FIXED + Oracle-signed: SEC-01/02/06/14 (`aad2141`,
  `bd82a9e`) · SEC-05 (`07d01af` + `98da251` = its Oracle C1/C2/C3) · SEC-13/15/19 (`10bb9e1`).**
  ALL INERT UNTIL DEPLOYED TO IONOS. Owner gates V7 (live `REMOTE_ADDR` — load-bearing for SEC-01)
  + V8 (`php licensing-backend\scripts\test_admin_throttle.php` with WAMP up, never run); the live
  console will REQUIRE 2FA (break-glass env `LICENSING_ADMIN_ALLOW_NO_2FA=1` once).
  **SEC-05 recovery runbook CHANGED**: the rollback mark now also lives at
  `%LOCALAPPDATA%\ScanFinder\.time-anchor`, so "delete `%APPDATA%\ScanFinder`" alone no longer
  un-bricks a machine — delete that file too, or just get it online once (the C2 self-heal).
  **Next open: SEC-04** (dead pairing gate) — eric-designed, NOT built; client transport+IPC already
  thread `code`, ship CLIENT field first then core; his own finding to fold in:
  `backupService._settingExcluded` only filters `licens`, so a pairing code would ride out in backups.
- **IDENTITY REDESIGN — BUILT 2026-07-20** (owner-signed, Oracle C1–C8 folded; 5 commits
  `3c0a744`→`febdc29`; spec `docs/designs/IDENTITY_TEXT_FIRST_2026-07-19.md` carries the full
  verification ledger). A logo match no longer asserts identity alone: it must AGREE with the page
  text (`LOGO_TEXT_GATE`), may only SUGGEST when the text can't judge, and is DROPPED when the text
  contradicts it — while still surfacing the branding-detected name so the "Use '<name>'" button (and
  the ripple) survive. A confirm can no longer teach the logo to a wrong-but-confirmed supplier
  (`LOGO_PLANT_TEXT_GATE`, corroboration-gated so first-contact enrolment still works). The renderer's
  silent auto-fill is now a click affordance. One correction RIPPLES to same-sender siblings by text
  (`SUPPLIER_RIPPLE`) through the review-bound pin rail. Corpus ON==OFF byte-identical; on the live
  install the gate abstains on exactly the 4 misassigned dockets, 0 correct identities suppressed.
  **OPEN**: Slice 1d — **RESOLVED 2026-07-24 DO-NOTHING-IN-CODE** (Oracle SIGN-OFF-W/COND; the Stage-0
  veto is LIVE via Store B, the 13 links are historical DATA → owner sweep, not a code fix; genuine
  cold-start residual (b) is NOT text-gate-defended = the issuer-by-caption family, letterhead/text
  layer not a logo veto; ledger [[project_slice1d_donothing]]) · D2 Barry slices 3-5 · D3 the inert
  detail-hash path (retire or fix) · **UX: a clean doc held just below the auto-file threshold gives
  no on-screen reason** (owner hit this: 9/20 auto-filed at 100, #121 held at 98 with
  `auto_file_threshold` unset=100 — the mechanism is correct, the silence isn't; Review should say
  "98% — just below your auto-file setting").
- **(superseded) IDENTITY REDESIGN (overnight 2026-07-19) — DESIGNED**: the Larkspur
  incident (20 new-supplier docs; logo layer misassigned 5; correction didn't heal) is diagnosed to root —
  the 64-bit logo phash has ZERO separating power (live-measured cross-supplier min hamming 2) while the
  branding TEXT named the true supplier every time. Direction (Barry+gary): **text-first, logo
  corroborates, abstain-by-default; a logo match alone never assigns or plants learning** + a correction
  RIPPLE via the pin rail. Spec `docs/designs/IDENTITY_TEXT_FIRST_2026-07-19.md`; permanent suite
  `stress_test/logo_identity_suite.py` (GREEN — 6 PIN-BROKEN reality pins). Oracle vet AFTER owner D1.
  KEY TRAP for the build: review-renderer `attemptLogoMatch` is NOT display-only (auto-fills + writes
  corrections = the confirm-time poison back door); Stage-0 `identify_template` accepts on logo alone
  (Slice 1d, own corpus gate).
- **Process rules**: include Barry EARLY on new features (before design/Oracle); control-test-first
  (baseline BEFORE code; kill-switched; OFF ⇒ byte-identical); advisor+Oracle gate on substantive changes.

**Durable gotchas from past sessions (full context: `docs/session-log.md` + memory index):**
- Packaged EMBEDDABLE Python (`vendor/python`, `python312._pth`) drops the script dir from `sys.path`:
  any spawned Python CLI must `sys.path.insert` then `from ocr.x import …`, NEVER bare `import x`;
  reproduce with `python -P`; verify build-only fixes against `vendor/python`, not `py`.
- The 88 critical auto-file floor passes conf==88 BY DESIGN (blocks only c<88) — pinned in
  `test_scope_trust.js`; do NOT "fix" the comparator.
- A custom doc type is identified by its "Also appears as" ALIASES, never its arbitrary internal name.
- `field_anchors.document_type` stores the SLUG, not the type NAME — a name-keyed lookup is a dead guard
  whose unit test can still falsely pass (the "dead guard greens every test" trap).
- The license window carries its OWN copies of the Settings hierarchy styles — do NOT move them to theme.css.
- Renderer JS changes (Review window, slip-fixer, teach) need the window REOPENED/app restarted to load.
- `processing/handler.js` requires `learning` per-function — a module-load smoke can't catch call-time
  ReferenceErrors (the `77e674e` class); new user-facing files under userData need `_allowedOpenRoots`.
- Test-GT can be poisoned by casual confirms (fictional/test docs plant real learning rows — purge after
  pilots); remediation conventions: `gt_overrides.json` + the archive's 2026-07-10/11 blocks.

## Working rules (read before any fix)

**STOP AND SECOND-GUESS at these five junctures** (owner rule, added 2026-07-24 after a root cause was
missed that the owner spotted immediately). Not "think harder" — at each named juncture, spend ONE extra
step asking **"do I need more information?"** and **"what am I missing?"**, then continue. This does NOT
override token conservation: it is five specific moments, not a licence to widen every investigation.
1. **You just looked at an artefact to answer ONE question.** Before closing an image / trace / report,
   describe what ELSE is in the frame. FAILURE 2026-07-24: nine document crops were opened to read a
   reference number; every one of them also showed a visibly SKEWED page, which was the actual root
   cause, and it was read past nine times.
2. **You found a plausible cause and it feels satisfying** — especially when it is a code smell (a wrong
   comment, a suspicious constant, an obvious asymmetry). Ask "why is THAT true?" one level deeper before
   designing. A wrong comment is evidence of confusion, not proof you have found the mechanism.
3. **Your own measurement produced an extreme number.** An extreme number IS the finding — do not file it
   as mild corroboration of the small hypothesis you already hold. FAILURE: `no_candidate = 326/574`
   (57% of rigid crops yielding nothing comparable) was noted as "consistent with clipping" and moved
   past; 57% is a structural mismatch, not an under-sized constant.
4. **Before proposing ANY fix**, ask "am I treating a symptom?" and "what would make this wrong?" — then
   say the answer out loud in the design. A fix that compensates for a misalignment instead of removing
   it will pass its unit test and fail its corpus gate (it did: the crop-headroom A/B bought 2 new silent
   wrong reads and healed 0).
5. **Before concluding, grep the memory index + CLAUDE.md for prior art on the MECHANISM**, not just on
   the symptom. FAILURE: `project_skew_anchor_misread` / `project_detect_deskew_parked` /
   `project_deskew_field_reread` already recorded that skew breaks anchored reads. All three were in the
   index and none were consulted.
**Corollary — the owner is a live source of information, not just an approver.** When something is cheap
for them to answer and expensive to infer (how they draw a teach box, whether duplicate imports are
deliberate, what a scan actually looks like), ASK before building on an assumption.

**Token conservation — hard requirement**
- Smallest possible scope: read the fewest files necessary; never scan the
  whole repo unless a narrow, targeted investigation has proven insufficient.
- Stage non-trivial work into incremental edits — prefer a focused change
  over a broad rewrite. Keep investigation and responses concise and
  non-repetitive.

**Extraction/anchoring fixes are system fixes, not document fixes**
Any issue touching field detection, anchors, OCR regions, keyword matching,
validation, supplier/template learning, or extraction accuracy is a reusable
*application-level* weakness until proven otherwise — assume it also affects
unseen suppliers, layouts, and future templates, not just the document on screen.
**Every document in the current corpus is a TEST DOC** (the BF_/KO_/MP_/NS_/PF_/AW_/CS_
batches, SuperStore, etc.) — the deliverable is NEVER a fixed document, always a fixed
SYSTEM. A doc-level outcome only matters as EVIDENCE of a system behaviour. (Operator
actions in-session — a ⊕ teach, a typed correction, a confirm — are fine and are
themselves system-wide by design: a teach lands a supplier+doctype-scoped anchor, a
confirm feeds scope-wide learning. CODE changes, by contrast, must never be tuned to
one document, one filename, or one sample's coordinates.)
- Fix the reusable layer — matching strategy, learning rules, normalisation,
  thresholds, validation — not the symptom on one sample document.
- No one-document hacks: filename-based exceptions, sample-specific
  coordinates, or narrow conditionals tuned to a single case (allowed only
  with a documented architectural reason).
- State explicitly how the fix helps future unseen documents/templates. If it
  mainly helps the sample in front of you and doesn't clearly improve the
  broader system, stop and redesign the approach.
- Verify beyond the single failing document: note likely impact on other
  templates/layouts and regression risk; prefer multi-sample or manual
  cross-checks over a single-document confirmation.

---

## Subagents & skills (advisors the user invokes by name)
Defined in `.claude/agents/*.md`; invoked via the Agent tool. All three are
ADVISORY — they diagnose/recommend and DO NOT implement unless explicitly asked.
Implementation stays with main Claude Code. Brief them with full context (a fresh
spawn starts cold) and relay their findings to the user.
- **bob** (`agents/bob.md`) — senior software & product advisor. Receives a
  report/diagnostic/plan, translates to plain English, splits fact vs assumption,
  flags risks, gives ranked options + a recommendation. Use after producing a
  report when the user wants options before implementation.
- **barry** (`agents/barry-the-brainstormer.md`, 2026-07-18) — elite PRODUCT
  BRAINSTORMER: high-value feature ideation for home/personal/small-office document
  management. Thinks in full user flows (capture→review→file→retrieve), friction,
  trust and segment fit; labels ideas L1 polish → L4 market-first bet + priority.
  Carries a verified product-grounding block (full-text search live, auto-separation
  exists, ref-less types first-class). Brainstorm-stage only — his output still goes
  through the normal advisor+Oracle gate before any build. First output:
  `docs/brainstorms/BARRY_2026-07-18_home-edition_generic-docs_separator-sheets.md`.
- **gary** (`agents/gary.md`, 2026-07-09) — Python engineering analyst: root-cause
  analysis (FACT vs ASSUMPTION), smallest-correct testable fix DESIGN (with backward-compat +
  data-migration + invariant notes), and TEST STRATEGY (unit + the realdoc_regression M=0/accuracy
  gate + a test that PINS an accepted trade-off so a future dev can't restore the bug). Uses the
  Python skills below. Now has a durable brief; still spawn general-purpose reading it if not a
  registered type. (Validated the absolute-target-first root cause for the worksheet date/name
  failures; designed the cross-supplier sweep/priority slices this session.)
- **oscar** (`agents/oscar.md`) — OCR expert: efficient OCR pipelines
  (preprocessing, Tesseract PSM/OEM/lang, per-field crop recipes, confidence,
  tables/searchable-PDF, accuracy-vs-throughput). HARD RULE: only recommends
  open-source tools that are free for commercial use, and states the licence —
  e.g. flags PyMuPDF (AGPL) and steers to pypdfium2, which this project uses.
- **eric** (`agents/eric.md`) — Electron expert: main/renderer architecture,
  secure IPC + preload/contextBridge, BrowserWindow/webContents lifecycle,
  child-process management, packaging/electron-builder, code signing, perf/memory.
- **reggie** (`agents/reggie.md`) — regex & extraction-pattern expert: analyses/
  tightens/loosens field regexes and validation rules (invoice/PO/sales-order
  numbers, VAT, dates, totals, codes, IDs) and anchored label→value extraction;
  precision-first; keeps the renderer `RegExp` and Python `re` patterns aligned
  (the shared `validation_patterns` in config/keyword_patterns.json). Returns a
  fixed report shape (Facts / Proposed pattern / Match examples / Integration point
  / Risks / Smallest change).
- **007** (`agents/007.md`) — elite OCR ENGINEER (deeper than oscar on geometry):
  separates the READING axis from the PLACEMENT axis, follows the coordinate frame,
  proves FACT vs HYPOTHESIS, fixes the reusable layer. For the hardest OCR positioning
  bugs (label→value drift, registration / coordinate-frame mismatches) + end-to-end
  OCR-pipeline review; same OSS-licence hard rule as oscar. (Led the Stage 0.5
  inline-harvest drift fix with oscar + eric — see OCR_WORKFLOW_REVIEW.md.)
- **oracle** (`agents/oracle.md`) — the FINAL adversarial reviewer: VETS the CONSENSUS of
  the other advisors (invoke him LAST, after 007/gary/oscar/reggie/eric agree, or when one
  proposal needs a hard second opinion). His load-bearing skill is systems/precedence
  reasoning, not first-draft analysis — he catches the SEAM where two individually-correct
  fixes combine badly, VETS THE PREMISE of the ask (facts/reward/risk), TRACES the code to
  verify claims (same-frame/units, where a value is computed vs its gate), weighs BLAST RADIUS
  (prefers do-nothing / a lower-risk layer over touching page-wide code), insists on FAIL-
  TOWARD-REVIEW (never a silent wrong value; don't drop the human checkpoint on same-pixel
  agreement alone), and names the VERIFICATION GATE (harness M=0 + zero accuracy drop). Verdicts:
  SIGN OFF / …WITH CONDITIONS / SEND BACK / DO NOTHING / WRONG LAYER. Same OSS-licence hard rule.
  Trial log + running assessment: `docs/oracle_log.md` (4-for-4 so far; his brief was refined
  from that track record). Spawn as general-purpose with the persona if not yet a registered type.

**Advisor refinement (2026-07-09):** all the design advisors (007/gary/oscar/reggie/eric) now carry a
**"name the seam"** rule — before proposing, state what the fix RELIES ON upstream and what safety/gate
it DISABLES downstream (a credibility reject, a review flag, an auto-file floor, a precondition another
fix depends on) — because the session's worst near-miss was a fix that was correct in isolation but
removed the safety another fix relied on (an M=1). 007 additionally frame-checks the capture convention
of its own helpers (top-left vs centre); oscar checks what a "cleaner"/whitelisted read disables; the
principle is "fail toward review, never toward a silent wrong value." The Oracle remains the final
cross-cutting check for the seam the specialists still miss.

**Skills** in `.claude/skills/`: a set of Python engineering skills
(`testing-strategy`, `code-quality`, `performance`, `api-design`, `packaging`,
`security-audit`, etc. — gary's toolkit), `ocr-document-processor` (oscar's
OCR knowledge pack: SKILL.md + scripts; note its requirements.txt lists PyMuPDF —
use pypdfium2 here instead), and `ocr-engineering` (007's deep OCR pack: coordinate
frames, anchor→offset math, merged-row inline harvest, registration-as-fallback,
debug triage). `scan-finder-frontend-design` covers the website/UI.

---

## What this is
Windows desktop app (ships as **Scan Finder** / `ScanFinder.exe`; internal
identifiers, DB `docusnap.db` and `%APPDATA%\DocuSnap` remain "DocuSnap"):
scans documents → OCR → extracts fields → files them intelligently.
Electron + Python backend + SQLite. Fully offline capable.

---

## Business / company details
**Six Mile Software** is a **trading name (sole trader) — NOT a registered limited
company** (no Ltd, no Companies House number as of 2026-06). **Scan Finder** is the
product. Use these for the website (footer, contact, legal/terms), the licensing emails,
and anywhere a business identity is needed:
- **Trading name:** Six Mile Software  *(do NOT append "Ltd" or imply incorporation /
  a company number until one is actually registered)*
- **NEVER surface the proprietor's personal name** anywhere public (site, footer, emails,
  Terms/Privacy). Present the business as **"Six Mile Software" + the virtual address +
  licensing@scanfinder.co.uk only.** (The clean route to full name‑privacy + compliance is
  to incorporate **Six Mile Software Ltd** — then only the company name/number/registered
  office appear; until then, lean on Polar being the seller of record, below.)
- **Address:** Office 1874, 92 Castle Street, Belfast, N. Ireland, BT1 1HE
  (virtual business address)
- **Product:** Scan Finder · **domain:** scanfinder.co.uk · **licensing/email sender:**
  licensing@scanfinder.co.uk
- **Seller of record:** **Polar** (Merchant of Record) — Polar is the legal seller for
  purchases, so the customer's purchase contract + VAT/tax sit with Polar, not Six Mile
  Software. The website/emails still carry the Six Mile Software identity for support.
- Revisit this whole block (and add the company number) **if/when a limited company is
  incorporated**.

---

## Stack
| Layer | Tech |
|---|---|
| Desktop shell | Electron 31, Node.js, better-sqlite3 |
| UI | Vanilla HTML/CSS/JS; **native OS window frames**; shared light/dark theme (`src/windows/shared/theme.css`) |
| LAN add-on | TLS `/v1` API (Node `https`) + detached Electron search client; certs via node-forge (`src/services/certService.js`) — see Detached search client |
| OCR | Tesseract 5 via pytesseract + pypdfium2 |
| Database | SQLite via better-sqlite3 |
| Platform | Windows only |

---

## Directory map
Long per-file design notes live in **`docs/architecture-notes.md`** (marked ➜AN below) — read the
matching block there BEFORE changing one of those files.
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router — thin, delegates to modules
│   ├── preload.js                       # contextBridge API bridge
│   ├── modules/
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND AUTO-FILE (_maybeAutoFile/_autoFileDoc; `auto_file_threshold` slider default 100; type+un-flagged gate is the real safety) ➜AN
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced → Learning History (view/purge/rename learned values + "Fix likely slips", admin/edit, audited; per-row source-docs + Open in Review) ➜AN
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer; Learning Recovery reassign (reversible) + templates.mergeInto (IRREVERSIBLE fragment merge) ➜AN
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core shared by desktop IPC + /v1. reviewService: atomic claim-then-file confirm (allowRefile intent), central DD-MM-YYYY date normalisation, detached learning hooks (snappy confirm). presenceService: advisory "being reviewed by" TTL map ➜AN
│   └── windows/
│       ├── main/{index.html,renderer.js}      # dashboard + nav rail; customisable/draggable card grid (localStorage order, Settings→Appearance toggles); import view opens result rows in Review ➜AN
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # zoom/pan preview; hidden Template Wizard (⚓) + "Show where it reads" overlay; ⊕ teach readout bar; three role-framed teaching surfaces; Teach-this-document CTA ➜AN
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card carousel; last-card fork → practice run) ➜AN
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED practice run — in-renderer over bundled fixtures, NO real DB/learning/output touched; draw-a-box teach sim ➜AN
│       ├── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
│       ├── help/                              # User Guide window (index + content pages, help.css, help-nav.js) — native frame, themed
│       └── shared/{theme.css,theme.js,helpmode.js}  # centralised palette/components · theme toggle · data-help-key help-mode
│   (createWindow opens every panel HIDDEN and reveals on ready-to-show — no
│    empty-background "black box" flash; startup/login flow passes show:false and
│    reveals manually, so it's untouched)
├── database/
│   ├── index.js                         # open(), runMigrations(), runJsMigrations()
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       ├── learning.js                 # hints, anchors, logos, getSetting/setSetting
│       ├── templates.js                # template CRUD, field mappings, sample-document linkage
│       ├── licensing.js                # client license_tokens cache (cacheToken/getActiveToken/clearSeatToken)
│       └── trust.js                    # supplier GRADUATION / safe auto-file: TRUSTED_FLOOR 95 after W=10 clean confirms; isAutoFileEligible = the ONE shared predicate; docTrustGate two regimes (sub-100 full gate, at-100 lenient but blocks deterministically-invalid/shape-violating values) ➜AN
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see Extraction pipeline below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding (same-logo siblings disambiguated by keyword fingerprint, THEN by the doc's own detected TITLE — see identify_template detected_slug/title_trusted below)
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read → inline-harvest/relocate off the located label (label_box) → registration fallback
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5 learned misread correction + 2.5d DOMINANT-VALUE SNAP (count-weighted snap to a ≥5-count/≥80%-share confirmed literal; kill SNAP_ALLOW_SUBSTITUTION) ➜AN
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js; is_name_like_field EXCLUDES technical addresses (mac/ip = CODES, not names) ➜AN
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   │   └── identity_fusion.py           # text-led SUPPLIER identity — DORMANT/SHADOW mode (changes nothing; rapidfuzz promotion pending, HANDOVER_2026-07-07.md) ➜AN
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py rebuilds page text from word GEOMETRY (visual rows — the scanned-totals two-column fix); region.py draw-tool zone-OCR, light-first ladder + multi-line PSM-6; landmarks (registration); text_enhance (degraded re-read); born_digital (PDF text layer, skips OCR) ➜AN
│   ├── logo/fingerprint.py
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD; rotation SIGN convention PROVEN in tests/test_orientation.py (PIL CCW vs pypdf CW — a wrong sign corrupts every doc); working-copy rotated once at import; auto_rotate_enabled default ON ➜AN
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas). --thumb = single low-res page-1 thumbnail for list thumbnails (previewService.getThumbnail)
├── config/keyword_patterns.json        # editable pattern library
├── config/license.json                 # client license config: base_url, product_id, public_keys (PUBLIC keys only)
├── client/                              # detached LAN search/mailbox Electron client (apiClient.js pins the CA) — see Detached search client
├── cert-tool/                           # standalone TLS cert-generator GUI (node-forge)
└── licensing-backend/                   # separate PHP 8 + MySQL activation server (WAMP/IONOS); see Licensing
    ├── public/{index.php, v1/*.php, admin/*}  # health · /v1 trial_start|activate|validate|revoke|status · admin web page
    ├── lib/{db.php, jws.php, admin_auth.php}   # PDO+JSON helpers · Ed25519 signing · admin gate+CSRF+bright chrome
    └── schema.sql · keys/ (gitignored seeds + admin_password.hash) · scripts/{Configure,Verify}-WampBackend*.ps1
```

---

## Database tables
Long design notes for the annotated tables live in `docs/architecture-notes.md` (➜AN).
```
document_types  — name, slug, built_in, ref_field_key, date_field_key,
                  title_aliases ← mig 43: extra printed-title phrases that ALSO detect the type
                  ("Also appears as" chips; alias == any existing type name hard-rejected) ➜AN
fields          — document_type_id(FK), key, label, type, required, built_in
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number,
                  working_path  ← mig 17: app-managed import copy in userData/inbox/<docId><ext>;
                  preferred by preview/reprocess/confirm (source folder need not survive)
                  page_count   ← mig 37: captured at import; drives the multi-page icon (NULL pre-mig)
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count.
                  Hints FILL EMPTY FIELDS ONLY (usage≥2, conf=min(90,60+usage*5)); the EVIDENCE-BASED
                  VARIABILITY GUARD skips any field with ≥2 distinct confirmed values in-scope ➜AN
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x/y/w/h_norm, usage_count, confidence,
                  last_authoritative_at (mig 20), offset_dx/dy_norm (mig 21 drift-invariant vector).
                  ⊕ teach persists ON COMMIT not on the draw (staged in pendingAnchors); an
                  authoritative teach is the SINGLE anchor per (field,doctype) — sweeps ALL suppliers
                  and outranks every passive anchor. supplier_name here is a LEARNING SCOPE key,
                  never a required document field. document_type stores the SLUG. ➜AN
logo_fingerprints — supplier_name, phash, ahash, match_count
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf, page_number
                  (mig 22): 3-5 stable words re-located per page to fit the Stage-0.5 registration
                  transform; additive/inert — no rows = existing anchor/offset path ➜AN
template_logo_hashes — template_id(FK cascade), phash, UNIQUE (mig 26): MULTI-REFERENCE logo set —
                  matchers take MIN distance over the set; drifted-but-related hashes appended on
                  confirm (dist (2,13], cap 8); _upsertTemplate reuse band 7-13; accept gate ≤6 ➜AN
settings        — key, value (key-value store). Notable: registration_enabled (ON) ·
                  born_digital_enabled (ON) · name_wordness_flag (ON — free-text NAME review flag;
                  operator "✓ This name is correct" → accepted_name_values allowlist exempts forever)
                  · first_run_completed (mig 24 stamps already-configured installs) ➜AN
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← mig 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
users           — …, totp_secret, totp_enabled  ← mig 28 (detached-client MFA
                  only; nullable/inert — the in-process desktop login never reads them)
document_routes — document_id(FK cascade), from/to_user_id+username,
                  action_required(approve|acknowledge), state(pending|claimed|approved|
                  rejected|acknowledged|recalled), comment, resolution_comment,
                  claimed_by_*, resolved_at, version  (mailbox/approval; see Detached
                  search client). documents.workflow_status = denormalised latest state.
                  Ensured UNCONDITIONALLY in runJsMigrations — NOT version-stamped.
```

---


## Extraction pipeline
`process_docs.py` → `ExtractionEngine.extract()` runs a staged pipeline:
- **Stage 0** `template_matcher.py` — match a learned template, seed fields (same-logo suppliers
  disambiguated by keyword fingerprint; doc-type slug resolution — a null slug silently disables
  the format/qualification gates). TYPE-PRECEDENCE (2026-07-09): a supplier issuing several doc types
  on ONE letterhead has same-logo sibling templates with IDENTICAL fingerprints, so the fingerprint
  tie-break can't separate them and the established sibling stamps the WRONG type over the doc's own
  title. `identify_template(detected_slug, title_trusted)` breaks the tie by the doc's OWN detected
  title: within the same-logo cluster PREFER the sibling whose `document_type_slug == detected_slug`;
  REFUSE (return None → doc to review to teach) when a TRUSTED title declares a type NO sibling carries.
  `title_trusted` = the type is a STRUCTURAL standalone HEADING (`keyword.detect_document_type` exposes
  `heading` + `_line_is_heading_like`; incl. "WORKSHEET 38"), NOT a confidence threshold (a low-sitting
  title under a tall letterhead scores ~70-79, which a threshold would exclude). `detected_slug`/
  `title_trusted` are computed ONCE in `process_docs` and threaded IDENTICALLY into BOTH identify_template
  calls (pre-extract + the engine's authoritative one) so they can't split-brain. Custom-type TITLE
  ALIASES (see `document_types.title_aliases`) feed this via detect_document_type. Guarded by
  `tests/test_template_matcher.py` (identical-fingerprint fixture).
- **Stage 0.5** `template_mapper.py` — admin-drawn anchor→target zone mappings. Absolute-target-first
  read → inline-harvest / relocate off the located label → registration fallback ("register, then read").
- **Stage 1** `keyword.py` — regex patterns from `keyword_patterns.json` (~60-70% of fields); label
  word-boundary guards (e.g. "Total" must not match inside "Subtotal").
- **Stage 2** `anchor.py` — learned label positions + logo supplier ID; drift recovery, label-lock,
  digit-parity guard, slip-fix, inline harvest, multi-line continuation.
- **Stage 4** `validator.py` — date normalise/salvage, currency infer, cross-field maths.
- **Stage 4.5** `format_anomaly_checker.py` — coarse-class + learned-shape consistency vs confirmed
  history; free-text guard; token-level name repair; format-weighted overall confidence.
- **Stage 4.6** candidate override — gated, DEFAULT-OFF.

**Processing mode** (`processing_mode`, default `smart`): `fast` and `smart` are now IDENTICAL
(stages 1+2) — they diverged only for the removed AI mode. The user-facing Fast/Smart CHOICE was
COLLAPSED (2026-07-08): no Settings selector, no topbar mode badge, no "Switch to Fast Mode?"
suggestion toast. The `processing_mode` setting + `--mode` plumbing REMAIN for tolerance (a stored
`fast`/`smart` is still honoured; `set-processing-mode` stays registered + admin/edit-gated;
`check-fast-mode-suggestion` is a retired no-op). Reintroduce a mode only if the stages diverge again.

⚠ **Critical invariants — always honour these (full rationale in the doc):**
- engine.extract() returns a FLAT dict mixing field dicts `{value,confidence,method}` with `_`-prefixed
  metadata (`_supplier_name`, `_overall_confidence`, …). Pop `_` keys BEFORE iterating fields; call
  `sanitise_extractions()` after popping, before emitting.
- Supplier identity must reflect the LATEST reliable `results['supplier_name']`, not the first guess —
  engine re-resolves it once, after every stage, before persisting hints/anchors/logos.
- Manual/authoritative anchors (⊕ teach, Stage 0.5 mapping, `keyword_override`) win on regex/TYPE alone
  (`shape_mode='ignore'`) and must NOT be vetoed by the learned-shape check; auto tiers keep full type+shape gating.
- Extraction/anchoring fixes are **system fixes, not document fixes** — fix the reusable layer, no
  one-document hacks (see Working rules).

📖 **FULL detail — read before ANY extraction/anchoring/OCR/validation/confidence change:
`docs/extraction-pipeline.md`** (every stage's internals + fix history, the drift/registration/
label-lock/slip-fix/inline-harvest/multiline designs, OCR ladder & crop recipes, `_gate_value`
shape modes, authority precedence, performance notes, and the accuracy/concurrency/load harnesses).

## Filing system
```
OutputRoot/
└── CompanyName/
    └── 2025/
        └── December/
            ├── Invoice.15-12-2025.INV-001.pdf
            └── .metadata/
                └── Invoice.15-12-2025.INV-001.xml
```
- Output root stored in settings table as `output_folder` (set on Settings →
  General; NOT changed by the rules below).
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- **OUTPUT STRUCTURE is now BUILDER-driven** (Settings → "Output Structure" tab,
  renamed from "File Naming"; `src/modules/filing/filename_pattern.js`), both
  token "block" builders (click-to-insert + custom text + live preview):
  - **Subfolders** = `output_folder_pattern` setting — a token string where `/`
    starts a new subfolder level. Default `{supplier}/{year}/{month}` = the legacy
    Company/Year/Month layout, so installs that never change it are byte-identical.
    `buildFolderSegments` token-substitutes + Windows-safes EACH level (illegal
    chars stripped, reserved device names defused) and DROPS empty levels; the
    handler still enforces the output-root containment check on the joined path.
  - **Filename** = `filename_pattern` setting (default `{docType}.{date}.{ref}` =
    `DocType.DD-MM-YYYY.RefNo.pdf`) — the existing `buildFilename` engine, unchanged.
  - Builder blocks (`FIELD_TOKENS`): Company `{supplier}` · Document Type `{docType}`
    · Date `{date}` · Reference `{ref}` · Year `{year}` · Month `{month}`. The
    same builders appear in the first-run wizard's "Output organization" step.
  - filing/handler.js IPCs: `get-output-structure-info` (blocks + defaults),
    `preview-output-path` ({folderPattern,filenamePattern} → sanitised segments +
    filename). Guarded by test_filename_pattern.js.

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

**STRUCTURAL fields (Document Issuer / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the COMPANY/identity
field (`COMPANY_KEYS` — **`['supplier_name']` ONLY since migration 44, 2026-07-10**: customer_name was
UNLINKED from identity and is now an ordinary OPTIONAL recipient field on every type; migration 45
purged its stale issuer-as-customer learning — see HANDOVER_2026-07-10_EVENING.md), the `date_field_key`, and
the `ref_field_key`. The identity field's DISPLAY label is **"Document Issuer"** for
BOTH keys (migration 38, 2026-06-28 — one unambiguous label so an operator never
enters variable data like a customer name in the identity field; supersedes the
migration-35 "Supplier Name"/"Customer Name" split and the migration-27 "Company").
Label-only — the internal KEYS (supplier_name/customer_name) + learning schema are
untouched. (Deferred: customer_name may later become a SEPARATE recipient field on
issuer-style types, with supplier_name as the sole identity — a data-model change.)
They drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning
(logo_fingerprints/hints/anchors/corrections/template identity key off the company
scope value), so the FIELD can't be deleted, disabled, renamed or retyped — but the
per-document VALUE stays editable (correcting a mis-read is what feeds learning).
The internal key stays `supplier_name`/`customer_name` (only the display LABEL
changed — "Supplier Name"/"Customer Name") so the learning schema is untouched. `is_structural` is annotated on each
field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked toggle, no
delete, 🔒). `updateField`/`deleteField` enforce it server-side;
`create-doc-type-with-fields` injects a Company field if the caller omits one.
Guarded by `database/modules/test_structural_fields.js`. (RESOLVED 2026-07-10: migration 44
made `supplier_name` the sole identity/scope key on EVERY type — sales orders included;
`customer_name` is a plain optional recipient field. The old latent nuance is gone.)

**DANGLING STRUCTURAL ROLE — self-heal + Confirm resilience** (2026-07): a type's
`ref_field_key`/`date_field_key` can end up pointing at a field that no longer exists
(the Reference field was deleted, or a type was created with a role key that never
matched a real field). That made Review's Confirm gate IMPOSSIBLE to satisfy — the
required key matched NO field, so Confirm sat disabled with nothing on screen to fill
(the "won't let me file, no empty field visible" trap). Three guards: (1)
`repairStructuralRoles()` CLEARS a dangling role to NULL on the UI type-list loads
(`getAllWithFields`/`getAllWithFieldsAll`) so the Settings dropdown shows it as unset +
re-pickable (not auto-repointed — guessing ticket_no vs serial_number is the user's
call); (2) `updateType` REFUSES to set a role to a field key that doesn't exist (can't
create a new dangling role); (3) the Review renderer's `validateConfirm` DETECTS a
dangling role (required key with no matching field) and shows a clear note ("This
type's Reference field isn't set up. Choose it in Settings → Document Types") instead
of a silent block. Guarded by `test_structural_fields.js`.

**PRESET DOCUMENT-TYPE CATALOG** (Settings → Document Types → "Add from catalog…";
`database/modules/document_types.js` `PRESET_CATALOG`/`getPresetCatalog`/`addPresetTypes`):
a shipped library of ready-made types a business TICKS to add — Purchase/Sales Invoice,
Remittance Advice, Credit Note, Delivery Note, Statement, Receipt, Quote. Ticking one
ATOMICALLY creates the type + fields + structural roles (reuses
`create-doc-type-with-fields`/`ensureStructuralRoles`) AND seeds its likely field-label
aliases into `field_label_overrides` (per-install, doc-type-scoped — see
`keyword.merge_label_overrides`), so Stage-1 anchored extraction has a head start with NO
teaching. Slug is DERIVED from the name (`presetSlug`, mirrors `addType`); idempotent
(re-add = no-op); catalog types are `built_in=0` (fully removable). Post-migration-44 EVERY
preset's identity/company role is **`supplier_name`** (the sole scope key) — Sales Invoice /
Remittance / Delivery Note / Statement ALSO carry `customer_name` as an ordinary optional
RECIPIENT field (the remitter's payer captions "Received From"/"Payment From" live on
`supplier_name`, the issuer) — so filing/learning scope is right from the start. reggie-
reviewed labels: only DOC-SPECIFIC captions + the NOVEL ref/date fields are seeded;
canonical fields (supplier/customer/invoice_*/total) defer to the shipped
`keyword_patterns.json` `field_patterns` (single source of truth, no drift); bare generics
("From"/"Date"/"Amount"/…) dropped (un-shipped fields had no Stage-1 gate — now closed by
the override validation-by-role above, but the lists stay tight). Phase 2 (DEFERRED): narrow
DETECTION by the enabled-type set so "tick only what I use" also cuts cross-type confusion
(today the shipped `document_type_keywords` buckets always score regardless of `enabled`).
Guarded by `database/modules/test_doctype_presets.js`.

---


## Licensing & activation
Optional device-bound license gate: trial + paid-seat. **OFF in dev, ON by default in packaged builds;
enforcement is ALWAYS ON in every build** (no env/setting/dev bypass). The MAIN process is the sole
decider — `enterMainApp()` → `licensingModule.decideAccess()` (`src/modules/licensing/handler.js`); the
renderer can only REQUEST entry (`license-enter-app`), never self-grant. A non-`allow` gate routes to the
license window (`src/windows/license`). Tokens verified OFFLINE (`src/lib/license/token.js`) against pinned
Ed25519 public keys (alg EdDSA, kid pinned). Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`fingerprint.js`) — raw value never leaves main. Config in `config/license.json` (`base_url`/`product_id`/
PUBLIC keys only; bundled via extraResources → rebuild installer after editing). Backend = separate PHP 8 +
MySQL server (`licensing-backend/`, `/v1/{trial/start,activate,validate,revoke,status}` + admin web page).
⚠ Secrets: never log/echo account or activation keys; never re-display a one-time key; never expose
`account_key_hash` or the raw fingerprint.

## Legal / Terms acceptance
Version-stamped acceptance gate from ONE bundled `LEGAL.txt` (repo root; **DRAFT** — solicitor items
outstanding). Surfaced in three places: installer NSIS licence page · first-run / version-bump gate
(`src/windows/legal/`, shown by `enterMainApp()` after the licence gate, before onboarding, enforced in
MAIN) · re-read (About box + Settings → Advanced → Legal). Acceptance stored LOCALLY only
(`settings.terms_accepted = {version,hash,app_version,accepted_at}` — no telemetry, no external calls).
Bump `LEGAL_VERSION` (main.js) + the file's `Version:` header to re-prompt everyone.

📖 **FULL detail: `docs/licensing.md`** (decideAccess specifics, offline verify order, backend endpoints
+ owner-email-on-trial, admin 2FA/TOTP, config keys, and the Legal gate internals + IPC).

**Update-available banner (slice 1, advisory).** MS Store delivers the actual binary (auto-update on
relaunch); the app only SIGNALS "a newer version exists." The backend `releases` table (one row per
channel: `latest_version`/`update_url`/`min_supported_version`) rides the EXISTING `/v1/validate` +
`/v1/status` responses via `lib/release.php` `release_info()` — UNSIGNED, non-gating, and EXCEPTION-PROOF
(a failure returns null and can NEVER 500 the token response → no lockout). Client compares `latest_version`
vs `app.getVersion()` (clean 3-part SemVer in both NSIS + MSIX builds; `buildRev` is never an ordering key)
CLIENT-SIDE, so the version never leaves the device. `licensing/handler.js` `captureUpdateInfo` (TOTAL — its
own try/catch, persists to the `update_info` setting, never null-over-good, cannot disturb the gate decision)
+ `resolveUpdateInfo` (garbage-safe) → `get-update-info` IPC + `open-update-url` (scheme-allowlisted
https/ms-windows-store only). Home dashboard `#dash-update` banner: info-tone, PULL model (mirrors
refreshTrialBanner), per-version dismissal. **Slice 2 — forced-update** (`min_supported_version`): decideAccess
sets `gate.forceUpdate` ONLY on a REACHABLE backend's live response (`belowFloor(app.getVersion(), min_supported)`),
so an offline app is NEVER locked (FAIL-OPEN, eric's hard rule); enterMainApp + the 6h reval timer route a
forced doc to its OWN lock window (`src/windows/update-lock/`, distinct from the licence lock — Update / Quit
only; `update-lock-quit` IPC is sender-guarded). Designed with eric/bob/gary; guarded by
`src/lib/update/test_version.js` (incl. `belowFloor`) + `src/modules/licensing/test_update_info.js`.

## Detached search client (LAN add-on)
A separate Electron search/mailbox client runs on other LAN PCs and talks to the core over a TLS `/v1`
API (`src/modules/api/handler.js`, Node `https`). It is an **entitlement-gated add-on**
(`src/services/entitlementService.js`, `detached_client_licensed` setting) that ALSO upgrades the core
app's own Search; the core works fully standalone with the add-on off. Core services are
transport-agnostic (`searchService`/`reviewService`/`workflowService`/`presenceService`/`sessionService`)
so the desktop IPC and the `/v1` client share one implementation.

Key pieces:
- **/v1 API** — search/preview, review-over-/v1 (queue/counts/confirm/defer via the shared claim-then-file
  `reviewService`), doc-types, presence ("Currently being reviewed by <name>"), workflow routes, enroll/CA.
  DTO projection returns ONLY the frozen contract fields (never `stored_path`/`folder_path`/`working_path`).
- **Managed 2-tier TLS** (`certService.js`, node-forge) — a CA signs a server cert; the client pins the CA.
- **Mailbox/approval workflow** — present but HIDDEN pre-release behind `WORKFLOW_FEATURE_ENABLED=false`.
- **TOTP MFA** (client-only) + **/v1 session revocation** on admin deactivate/role-change/password-reset.

⚠ Security invariants (preserve): real TLS verification, NO silent self-signed bypass in the client UI;
pin the **CA** (`ca.crt`), not `server.crt`; `ca.key` NEVER crosses any endpoint; enrollment needs a
fingerprint/pairing integrity check.

📖 **FULL detail: `docs/detached-client.md`** (every `/v1` endpoint + contract version, cert wizard,
entitlement/workflow gates, presence/reviewService internals, the client targeting-OCR path + open bug,
theming/keyboard-focus fixes, the concurrency/accuracy/import-load stress harnesses, and all tests).

## UI conventions
**Shared theme** — every window's palette + components are centralised in
`src/windows/shared/theme.css` (loaded by all windows) + `theme.js`. **ELEVEN named
themes**: the core SIX (2026-06-28) — Light · Warm Paper · Nordic Slate (light
family) · Dark · Midnight · Graphite (dark family) — PLUS a **Seasonal** group
(2026-07): Spring · Summer (sunshine-yellow) · Autumn · Winter (icy-blue) light +
**Festive** (dark, evergreen-green with a holly-RED accent + gold). Each is a
`:root[data-theme="X"]` token-override block; **Warm Paper is the default**. The
seasonal themes carry faint repeating **SVG-tile artwork** (leaves/suns/snowflakes/
holly) served as CSP-safe `'self'` files from `shared/patterns/*.svg` (NEVER
`data:` URIs — `img-src 'self'` blocks those), `background-attachment:fixed`, baked
low opacity. `DARK_THEMES` in theme.js gates the dark family (incl. `festive`). `theme.js` sets BOTH `data-theme` (palette)
AND `data-mode` (light|dark family) on `<html>` — `color-scheme` + the logo swap
key on `data-mode` so all dark themes get native dark scrollbars/logo. `--on-accent`
token = text colour on a filled accent (lets Midnight's amber use near-black text).
Subtle background patterns are pure CSS gradients (CSP-safe — NO `url(data:…)`, which
`img-src 'self'` blocks) on the shell `--bg` only (Warm=dots, Slate=grid, Midnight=
glow; others flat). Picked via Settings → General → Appearance `<select>`; the
account menu + the main-window rail-foot toggle are a quick Light⇄Dark flip
(mode-aware). `set-setting('theme',…)` persists + broadcasts `theme-changed` live.
Windows reference the tokens and no longer define their own `:root`.
```css
/* light (default) — the client palette */
--bg:#f4f6fa  --surface:#ffffff  --surface2:#eef1f7  --surface3:#e4e8f1
--border:#e4e7ef  --border2:#d2d8e4
--accent:#3b7df0  --accent2:#2f6fe0  --accent-bg:#e7f0ff
--ok:#1f9d63  --warn:#b07816  --err:#d64545
--text:#1b1f2a  --muted:#69728a  --doc-bg:#eef1f7
--r:12px --r-sm:9px --r-pill:999px        /* rounded buttons / inputs / cards */
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code) — SELF-HOSTED woff2
(latin subset, OFL-1.1) in src/windows/shared/fonts/ + @font-face in theme.css.
NO Google-Fonts CDN (was a per-window offline/privacy leak); every window's CSP
is now font-src 'self'. Don't reintroduce a CDN <link>.
```
- **Native OS window frames** (`main.js` `frame:true`). The old custom drag
  titlebars are hidden globally (`html #titlebar,.titlebar{display:none!important}`
  in theme.css). The main window's bar is renamed `#topbar` and kept as a real toolbar.
- **Self-contained child windows** (review/settings/search/teach/dev-inspector):
  opened **modal** to the focused parent, **`skipTaskbar`** (no second taskbar
  icon), start **maximised** with user resize remembered (`applyWindowState` →
  `window-state.json`).
- **Settings & Review use a left-sidebar shell**; buttons/inputs are the rounded
  client-style components from theme.css.
- **Settings tab structure (11 tabs, 2026-06-30 reorg — the "General" junk-drawer is
  GONE):** a `Setup` cluster — **Files & filing** (folders + output structure) ·
  **Document Types** · **Processing** (mode/parallel/OCR/separation/name-checks + the
  import toggles auto-file/multiline/auto-rotate + Review confidence threshold) ·
  **Appearance** (theme + Home-screen cards + window behaviour) — then an
  `Administration` cluster (side-head divider) — **Templates** (the `#tpl-dock` viewer
  only) · **Learning** (Keyword Label Overrides at top + Learning Recovery + memory
  inventory) · **Learning Repair** (see below) · **Users** (accounts + recent activity) · **Audit** (the audit log) ·
  **Licensing** (licence + activation + seats; `#wf-section` workflow stays HIDDEN) ·
  **Search client** (the `#client-api-*` access card) · **Advanced** (Backup & Restore
  + Diagnostic Logging + Re-run setup). The renderer (`settings/renderer.js`) tab-click
  handler is generic on `data-tab`→`panel-<slug>`; only these slugs carry lazy-init —
  `learning`→`loadMemoryInventory`, `audit`→`loadAudit`, `searchclient`→
  `initClientApiSection`. Every control is wired by element ID, so a section moves
  between tabs intact. (Done via two reviewed worktree passes; guarded by the
  div-balance + tab↔panel pairing checks.)
- **Help-mode** (`src/windows/shared/helpmode.js`): elements tagged `data-help-key`
  highlight and deep-link into the User Guide window (`src/windows/help/`).
- **List thumbnails** (`src/windows/shared/thumbs.js`): page-1 PDF thumbnails in the
  Review queue, Search results, and the Teach doc-picker, lazy per visible row
  (IntersectionObserver) + a per-window in-memory cache. ONE shared IPC
  `get-document-thumbnail` → `previewService.getThumbnail` → `render/pages.py --thumb`
  (single low-res page; reuses pypdfium2 — no new dep). GOTCHA: the observed element
  must have a layout box — `display:none` starves IntersectionObserver, so the teach
  card uses a `visibility:hidden` overlay (review/search use a visible placeholder box).
- **About box** (core: user-menu "About ScanFinder…"; client: sidebar "About"): app +
  Electron version + copyright (read from package.json `build.copyright`) + a
  "Third-Party Licenses" button that opens the bundled notice via `shell.openPath`.
  IPC `get-app-about`/`open-third-party-licenses` (core), `client-about`/
  `client-open-licenses` (client). See License compliance.
- **Review queue** mirrors the Search results list: plain scroll + click (↑/↓ keys
  still cycle), and a **draggable splitter** makes the file column width adjustable
  (persisted in localStorage). Beside the queue is a **docked vertical tool rail**
  (`#queue-scroll-rail`, `src/windows/review/index.html`): a top **nav group**
  (`.rail-nav-group`) + a **document-tools group** (`.rail-tools-group`) holding the
  ✂ Split-PDF, Template-Wizard (⚓), OCR-Enhance, ⚙ Advanced (learning-history), and
  ∞ **Straighten-all** buttons — compact `.queue-tool-btn` icon triggers whose wide
  controls open as `.rail-flyout` popovers anchored to the rail (active = the shared
  `.open` pressed style). SEPARATELY, a horizontal `#doc-toolbar` sits ABOVE the page
  (zoom, page nav, the per-doc ∞ Straighten button). A Review control lives in one or
  the other — grep the WHOLE index.html before assuming a control's home. (The session
  "Straighten all" toggle — `#btn-deskew-all` + its `#deskew-all-bar` angle-threshold
  flyout — is in the tool rail; the per-doc Straighten is in `#doc-toolbar`.)

---

## IPC reference

### Renderer → Main (invoke — returns promise)
```
pick-folder, pick-output-folder, process-folder(folderPath)
get-document-types, get-all-doc-types
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
get-validation-patterns                # validation_patterns from config (cached) — Review on-blur field validation
create-doc-type-with-fields({name,fields[],ref_field_key,date_field_key})  # transactional; teaching wizard
get-doctype-catalog, add-doctype-presets(slugs[])   # preset doc-type catalog (admin) — see Preset document-type catalog
get-teach-target                       # docId the teach window was opened at (pulled once on load)
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
get-document-thumbnail(id,folderPath,filename)   # page-1 low-res thumb (shared/thumbs.js)
get-app-about, open-third-party-licenses          # About box: version + open the bundled notice
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), reprocess-document({docId,folderPath,filename})
ocr-region(base64), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
search-documents(params)
get-setting(key), set-setting(key,value)
get-output-structure-info, preview-output-path({folderPattern,filenamePattern})  # Output Structure builders
settings-backup-export({password}), settings-backup-preview({password}), settings-backup-apply({path,password})  # admin; see Settings backup
get-processing-mode, set-processing-mode(mode)
check-fast-mode-suggestion(supplierName)
license-get-status, license-start-trial, license-activate(data), license-revoke(data)
license-test-activate(data)            # admin local test — never mutates real state
license-get-enforcement, license-set-enforcement(on)   # admin-gated; Settings → Activation
dev-inspector-unlock(pw)               # pw checked in MAIN (=== 'SFDEV'); opens dev-inspector window
dev-inspector-running                  # read-only bool (isBatchRunning)
dev-get-session-docs, dev-get-session-doc(key)  # read-only in-memory dev-session registry (no DB)
dev-get-slice(path)                    # base64 of a temp OCR crop; path MUST resolve under ctx.devSliceDir
split-pdf(file,ranges,outDir,docId,every)  # pypdf split; `every` N = split every N pages (1=each), else ranges
onboarding-suggested-folder, onboarding-validate-folder(folder)  # first-run wizard (mkdir+probe writability)
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
open-teach-window, open-teach-window-at(docId)   # guided teaching wizard (Admin+Edit)
onboarding-complete, open-onboarding   # first-run wizard: set first_run_completed+open shell / re-run (admin)
notify-review-complete
license-enter-app                      # REQUEST entry; main re-decides via decideAccess
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
reprocess-progress(msg), process-progress(msg)
process-trace(ev)                      # dev-inspector + (when its console is active) the REVIEW window; never the main window. See Dev inspector / Review trace console
license-state(gate)                    # pushed to the license window with the blocked-state reason
```

---

## Process-progress message types (Python → Electron stdout)
```json
{"type":"start","total":N}
{"type":"file_begin","filename":"..."}
{"type":"file_done","success":true,"status":"needs_review|confirmed|error",
 "original_filename":"...","overall_confidence":85,"needs_review":true,
 "document_type":"Invoice","supplier_name":"...","extractions":{...},
 "invoice_number":"...","invoice_date":"...","total_amount":"..."}
{"type":"log","text":"...","level":""|"warn"|"err"}
```

---

## Known bugs (fix these first)

### Resolved 2026-07 headline bugs — moved to `docs/history.md` (verbatim)
- 2026-07-08 harness RED = mis-taught anchor + poisoned GT, NOT code (fix: critical-field 88 floor in trust.js).
- 2026-07-06 cross-supplier POSITIONAL anchor bleed FIXED (`_is_blind_cross_supplier_anchor`; small residual noted).

### Resolved QA / audit history — see `docs/history.md`
The 2026-07-02 read-only adversarial audit's **11 findings are all FIXED + tested**; the per-item landing
notes (backup natural-key upsert, no-ref/date confirm dead-end, reprocess-discards-edits guard, batch
file-copy off the file_done path, File-All-Ready expectId race, empty-issuer warn, shared `slug.js`,
watch/output overlap block, etc.) plus the "verified SOUND, don't re-audit" list have moved to
**`docs/history.md`**. Read it before re-touching backup restore, confirm gating, slug derivation, or path-overlap.

### BUG 1+2 — `str object has no attribute get`
**File**: `python_backend/process_docs.py`
**Cause**: engine.extract() returns _ prefixed metadata as plain strings mixed
with field dicts. After popping _ keys, some may remain or validator iterates them.
**Fix**: Add and call `sanitise_extractions()` after all _ keys are popped:
```python
def sanitise_extractions(raw: dict) -> dict:
    clean = {}
    for key, data in raw.items():
        if key.startswith('_'):
            continue
        if isinstance(data, dict):
            clean[key] = data
        elif data is not None:
            clean[key] = {"value": str(data), "confidence": 50, "method": "unknown"}
        else:
            clean[key] = {"value": None, "confidence": 0, "method": "unknown"}
    return clean
```
Also update `validator.py` `validate_and_adjust()` to skip _ keys and
normalise non-dict values as defensive belt-and-braces.

### BUG 3 — Regex `bad character range /-\.`
**File**: `config/keyword_patterns.json`
**Fix**: In `validation_patterns.date`, change `[/-\.]` to `[/\-.]`

---


## Features to build / build history — see `docs/history.md`
The staged build specs (Stage 2 Settings rebuild · Stage 5 Review rebuild · Stage 6 Search window ·
Stage 7 field-format cross-referencing) are largely **DONE**; their specs and the durable "built
additions" notes have moved to **`docs/history.md`**. Still genuinely OUTSTANDING there:
- **Stage 7 Stage 3** — persistent learned format model (`field_format_rules` table, migration 12,
  `--format-rules-file`): overrides the inferred class once `confirmed_count ≥ 10`. Not yet built.

## Fast Mode suggestion — RETIRED
The Fast/Smart user choice was collapsed 2026-07-08 (see Processing mode above);
`check-fast-mode-suggestion` is a retired no-op kept for tolerance. Do not re-implement the toast.

---


## First-run wizard · Settings backup · Learning Repair
- **First-run wizard** (`src/windows/onboarding/`) — a linear setup wizard shown ONCE on a clean install,
  AFTER the licensing gate; gated by the `first_run_completed` setting (migration 24 stamps already-
  configured DBs so existing users are never re-onboarded — NEVER infer "clean install" from empty state).
  Only required step = a writable output folder. Followed by a 6-card welcome/familiarisation TOUR
  (`src/windows/welcome/`, its own `welcome_seen` flag; reopenable from the user menu).
- **Settings backup / restore** (admin; `src/services/backupService.js`; Settings → Advanced) — exports
  operational config to ONE password-encrypted file (scrypt → AES-256-GCM over gzipped JSON). Includes
  settings (minus `licens*`), doc types/fields, templates, anchors, hints, corrections, logos; EXCLUDES
  users/recovery/audit/licensing/documents. **Device-bound import** (anti-trial-stacking): a backup from a
  different machine is refused unless this machine holds an active paid seat.
- **Learning Repair** (admin Settings tab, `panel-repair`) — un-poison a doc type by browsing its confirmed
  docs and sending a bad one back to Review (replace-in-place, no `-DUPLICATE`). Grounding fact: learning is
  derived LIVE from `confirmed` docs (`getFieldFormats` filters `status='confirmed'`), so de-confirm/soft-
  delete is the real lever — clearing learning tables alone doesn't un-poison. Precision-first suspect
  detectors (`src/services/repairSuspects.js`): outlier docs (phash) + anomalous values (shape/name/charset).

📖 **FULL detail: `docs/features.md`** (wizard steps + gate flow + copy-after-processing keys; backup
crypto/scope/restore transaction/IPC; Learning Repair detectors/scope-split/IPC/UI).

## Main window — "Review your documents" CTA
After a batch finishes, a green "✓ Review your documents" button appears in the sidebar
below Process Documents (where Stop was) and opens the Review window. Shown only when
`stats.done > 0`, reset on each run start, gated like the Review nav (hidden for
read-only). Complements the "View Results" 3-field table, doesn't replace it.

## Help-mode + modals gotcha
`shared/helpmode.js`'s active capture-phase click interceptor (shows help INSTEAD of
activating a control) used to swallow clicks inside in-page modals — a destructive
typed-confirm dialog (Erase ALL data) then looked broken (couldn't click/type). Fix:
help-mode skips any element under `[data-help-ignore]`; the custom modals
(showTypedConfirmDialog, showSecretDialog) set it. SEPARATELY, those modals now defer
`input.focus()` to `requestAnimationFrame` (focusing an element the same tick it's
appended is dropped by Chromium → "no flashing cursor") + a click-to-focus fallback.


## Teaching wizard · Dev inspector
- **Teaching wizard** (`src/windows/teach/`) — a dedicated linear "Teach a new document" wizard for
  non-technical users (Admin+Edit): welcome → choose the scanned doc → pick or CREATE a doc type → point
  out each field by drawing a box around its VALUE (live OCR read-back; the wizard auto-detects the nearby
  label as the anchor) → review → commit. Each field is saved as a **Stage 0.5 anchor→target MAPPING**
  (value-box-only + auto-label — works on document #1, registration covers drift), NOT a Stage 2 ⊕ anchor.
  Commit sequence is DEFERRED to the last step (promote-to-template → save-template-mapping per field →
  confirm-review) so Back/Cancel are safe.
- **Dev inspector** (hidden, read-only — no DB writes, no learning) — in the MAIN window press
  **Ctrl+Shift+D then M**, password `SFDEV`. An answer-first extraction-provenance view + a Review-window
  **trace console** (same key combo, inside Review) for debugging extraction PRECEDENCE. The `--trace` /
  `--slice-dir` flags are added ONLY while the inspector/console is open (or diag logging is on), so normal
  processing is byte-identical. OCR slices saved to one temp dir, served base64, cleared on close.

📖 **FULL detail: `docs/features.md`** (teach auto-flow / fixed-value / artifact / commit sequence;
dev-inspector three-column UI, telemetry mirror, trace event types, click-to-highlight slices, per-field
winning-lineage reconstruction, and the known main-app follow-ups).

## Python invocation pattern
All Python scripts called with temp files for large data (avoids Windows
ENAMETOOLONG limit on CLI args):
```javascript
const file = path.join(os.tmpdir(), `ds_name_${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(data));
// pass --name-file file to Python
// cleanup in proc.on('close')
```

Python uses `py -3.12` in dev, `vendor/python/python.exe` when packaged.

---

## License compliance (third-party OSS) — see `COMPLIANCE.md` (canonical)
The shipped product bundles permissive/notice-style OSS (no GPL/AGPL); the only
copyleft is weak/file-level (FFmpeg LGPL-2.1 via Electron, a couple of MPL-2.0
files). Compliance is automated:
- **`THIRD-PARTY-LICENSES.txt`** (core, repo root) + **`client/THIRD-PARTY-LICENSES.txt`**
  ship via each app's `build.extraResources`; surfaced in-app via the About box.
- **`scripts/check-licenses.js`** — prebuild GATE (wired into `npm run build`, also
  `npm run check:licenses`). Enumerates the Node prod-dep tree + bundled
  `vendor/python` packages, classifies each license ALLOWED / DENIED(copyleft) /
  UNKNOWN against an allowlist, exits 1 on any DENIED/UNKNOWN so a dependency bump
  can't silently ship a bad license. Dual `A OR B` passes if either side is allowed
  (elections: node-forge→BSD-3, expand-template→MIT, rc→MIT, packaging→Apache-2.0).
  MPL-2.0 is allowed (we ship unmodified source). Exports its collectors.
- **`scripts/gen-third-party-notices.js`** — rewrites the notice's INVENTORY section
  from the gate's data + re-stamps the product version (package.json) and date; leaves
  the curated copyright/license-text sections alone.
- **Release**: on the build machine (where `vendor/python` exists) bump versions →
  `npm run check:licenses` → `node scripts/gen-third-party-notices.js` → `npm run build`.
- When a new license FAMILY appears, add its text to section 3 of the notice + its
  name to the intro list (the generator does NOT manage section 3). Editing the
  notice's whole license text in one Write trips the API content filter — author the
  short parts, then APPEND long texts (fetched to files) via a script.

## Dev workflow
```bash
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract; licensing enforcement OFF
npm run build      # → dist\ScanFinder Setup <ver>-r<rev>.exe  (rev = scripts/build-rev.js, or $BUILD_REV)
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

**Build notes**: electron-builder is pinned **`^24.13.3`** (installed = 24.13.3 — an earlier note
saying "v26" was inaccurate; verify with `require('electron-builder/package.json').version`). Avoid
re-adding the legacy `win.sign` / `win.signingHashAlgorithms` keys. For a future MSIX/Store SKU see
`MSIX_SETUP.md` (consider upgrading electron-builder for the `appx` target). A TEST `.appx`
builds via `electron-builder --win appx` (placeholder identity `SixMileSoftware.ScanFinder` /
`CN=Six Mile Software`) — but it REQUIRES **Windows Developer Mode ON** (or an elevated shell):
electron-builder extracts its bundled `winCodeSign` toolset using SYMLINKS, which Windows blocks
without that privilege, so `makeappx.exe` never lands and the build dies `spawn UNKNOWN`/`ENOENT`.
The resulting `.appx` is unsigned (Store signs on submission; for local sideload self-sign a cert
whose subject == the appx Publisher, then `Add-AppxPackage`). An opt-in document-data-FREE
diagnostics/error-reporting feature is DESIGNED but NOT built — see `DIAGNOSTICS_PLAN.md`
(Phase 0 first; strict enumerated allowlist, no field values even masked, consent-gated).
`postinstall` runs
`install-app-deps`; native deps
(`argon2`, `better-sqlite3`) are auto-rebuilt for the Electron ABI during build. Installer is
**unsigned** → SmartScreen "More info → Run anyway" on the VM. Run gate tests with
Electron-as-Node, not plain node (native-module ABI).

**Versioning (policy: manual SemVer + automatic build stamp — Eric+Gary consensus).**
THREE INDEPENDENT axes: the core app version, the client app version, and the `/v1`
contract version (`API_CONTRACT_VERSION` in `src/modules/api/handler.js` — the real
client↔server compatibility signal; never gate licensing on it). Bump `package.json`
`version` **manually, at release only**, git-tagged (MAJOR breaking/licensing-tier · MINOR
feature/add-on · PATCH fix) — do **NOT** auto-bump per build (it churns git + pollutes the
number licensing/support reads). Every build is still made DISTINCT + traceable by an
automatic stamp: `scripts/build-rev.js` `buildRev()` = `<UTC yyyymmdd-hhmm>-<git short sha>`
(or `BUILD_REV` verbatim), carried by both `nsis.artifactName`s as `-r${env.BUILD_REV}` →
e.g. `ScanFinder Setup 2.0.0-r20260622-1133-9f158c5.exe`, AND baked into the packaged
`package.json` via `--config.extraMetadata.buildRev` so the **About box** self-reports
`Version <ver> (<rev>)` (unpackaged dev reads the live git sha). Release ritual: bump
`version` → `git tag` → `BUILD_REV=<version> npm run build` (optionally branch artifactName
to drop the `-r<ver>` for a clean `ScanFinder Setup 2.1.0.exe`).

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset DB during development (also clears users,
cached license tokens, and the enforcement setting).
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
Packaged build remembers prior login/trial because that DB persists across reinstalls
(NSIS `deleteAppDataOnUninstall:false`). Licensing enforcement is ALWAYS ON (no env/setting/
dev bypass) — dev must run against a real backend trial/seat for the machine's fingerprint.
