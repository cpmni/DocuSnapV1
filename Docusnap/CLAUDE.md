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
- `docs/session-log.md` — VERBATIM ARCHIVE of the old per-session change blocks (2026-07-09 → 08-13).
  Grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent session built.
- `docs/architecture-notes.md` — the long per-file design notes moved out of the directory map (marked
  ➜AN there). Read the matching block before changing one of those files.

## ⏭ LATEST — 2026-08-27 DAY (Chris round 6 fixes): **READ `HANDOVER_2026-08-27_DAY.md` FIRST**
Branch `feat/teach-side-overnight`, resumed from `6787291` (7 commits ahead of origin, NOT pushed — owner reviews then pushes).
Owner: "read the handover and continue … continue with chris's fixes". **Built + pinned (every behaviour change DARK):**
**Card 1 HIGH** = a `buyer_issued` PO template (fingerprint = the OWNER's name+address) won the WHOLE-PAGE text arm at 7/9 on
three other suppliers' papers (those words print in every BILL TO block; doc 6 untyped — "GOODS DELIVERY NOTE" is one extra
real word → no trusted heading → the type-scope guard had nothing to refuse on; roads = the quiet lane's kw selector + a single
Reprocess) → **`template_buyer_issued_letterhead_scope`**: a marked template is recognised by TEXT only over the LETTERHEAD band
(`template_matcher.header_band_text` = the fingerprint harvest's own truncation, ONE helper; JS twin
`branding_fingerprint.headerBandText`) in `_match_by_keywords`, the rescue arm, the JS mirror (`findByKeywordFingerprint` →
lane selector + wizard/graduation-link/reextract roads), plus a go-forward HEAL on the engine honour path
(`sticky_binding_declined reason='letterhead'`). **Oracle SEND BACK → corrected:** `_identity_refuses` stays WHOLE-PAGE
(configuration B — a PO taught with the counterparty as issuer — prints its identity below the band). Gates: refactor 0
diffs/1242 docs; 0 empty bands / 0 <0.75 among the 113 PO docs; realdoc OFF/ON + Chris fired-path round → handover RESULTS.
**Card 3** the Import chip asks the ONE predicate (`review_hold`; engine `needs_review` = required-empty OR field<70 ≠
`isAutoFileEligible`). **Card 5** no Use/Keep when the page vouches for neither value. **Card 6** no countdown at 0 confirms.
**Card 7** stale verdict dropped on type/issuer change; Delete All → "Queue cleared — N in the recycle bin"; empty panel clears
⊕/Teach. **Card 2** verified: `trust_role_disagreement_refuse` is ON live, was OFF in his sandbox — no code. Pins:
`test_chris_r6_ui_cards.js`, `test_buyer_issued_letterhead_scope.py` 43, `test_buyer_issued_scope.js` §4 (28), wiring rows.
Live app still the 08-26 21:02 instance (DB at mig 87 → restart applies 88–91). **Traps:** quote `-File` paths inside the
`Start-Process` argument; a dropped advisor resumes via SendMessage; a detached suite reads pins mid-edit (version-skew reds).

## (previous) 2026-08-27 MORNING (the autonomous overnight run): `HANDOVER_2026-08-27_MORNING.md`
Branch `feat/teach-side-overnight`, **HEAD `b0e94f4` (+ the handover docs commit), 7 commits LOCAL/NOT pushed** (owner reviews then pushes). Built while
the owner slept, every switch DARK (default OFF), each advisor→Oracle→pins→gate: **(1) CLASS F** the general
"corroboration clears a please-check note" rule (`corrob_verification_doubt_clear`; Oracle C1-C4 in code; **corpus gate
PASSED NON-VACUOUSLY on the owner's DB: 24 edge-cut notes cleared, all 24 correct — the SuperStore 3190x class — would-file
1168→1192, 0 wrong gained, M 12 unchanged**; flip order enforced: `corrob_note_recompute_fc` first); **(2) landmark box snap**
committed `9861d37` (+pin); **(3) targeted field re-slice → gary+oscar: WRONG LAYER** (full-page OCR already cached on a
reprocess; a field-only write poisons the re-read holds; cheaper lever = flip `quiet_reread_on_layout`); **(4) LEARNING
REPAIR v2** — the old forget was a HALF-forget (the live-derived model kept counting): mig 90 `documents.learning_excluded_at`
+ ONE predicate `machine_vias.learningExcludedSql` in 17 readers (default ON, inert until stamped) · `learningScopeService`
selector (`learning_repair_console`) · `learningRepairService.forgetScope` + exact-row Undo (`learning_repair_forget`; C1
retract-once stamps, C2 shared-template refusal, C5 lane reason `repair`) — a HUMAN confirm clears both stamps; **(5)
BARCODES** — `barcode_inventory` (zxingcpp per OCR page, mig 91 `document_barcodes`, search) + `barcode_field` (a
"Barcode / QR code" field type whose ONE writer is the decode, Stage 1.5, LIST-style ownership skips, confirm-once note);
**(6) LIST field audited = properly implemented for inline repeated captions** (column layout = element 1 only, documented);
`;` in an element now refused. **Full suite: every red is pre-existing except two source pins updated (`8cb80ac`).**
**OWNER DECISIONS (ranked in the handover):** flip F after the SFDEV live heal of 31901 · the three Learning-Repair UX
defaults + whole-sender forget · flip the layout arm vs fund a quick-read pill · the barcode symbology/role/required Qs ·
barry's sweep (PDF text layer — may the filed PDF differ from the original? · exact-dup skip · accountant export). **Chris's
round (CHRISBOT 472 docs, fresh sandbox CDP 9223 PID 3060, new switches armed): 279 filed, 0 wrong company, 0 wrong type,
149 by itself (warm batch 116/200 vs 98 last round), every scary button truthful, "Start fresh"+Undo clear, verdict YES.**
His two cards on tonight's code FIXED (`d0d74fb`: barcode row renders when none found + never the Date role; console
exact-scope suspects + honest "N filed · none still teaching"). VET QUEUE: Card 1 HIGH — a buyer-issued-PO teach re-badged
three other suppliers' papers as Bramblewood POs @95 with "Nothing looks wrong" (held; `template_buyer_issued_type_scope`
was ON and didn't stop it → detection arc); Card 2 wrong date @94 no warning (scanned statement); Card 3 Import table
"Ready" vs Review holding; Cards 5-7 + the Settings "Processing wall" (wants Recommended/Advanced). Report + triage:
`docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md` + the handover foot. Trap: `_fold_shape` makes every digits-only skeleton `#` — LENGTH-BLIND.

## (previous) 2026-08-26 NIGHT (identifier-registry arc + Chris R5 cards + switch inventory/flip): `HANDOVER_2026-08-26_NIGHT.md`
Branch `feat/teach-side-overnight`, **HEAD `f2349f9`, commits LOCAL/NOT pushed** (owner reviews then pushes).
**⏭ THE FRESH SESSION IS TO BUILD THREE FEATURES — top of queue in the handover:** (1) **CLASS F** — one general
"corroboration clears a verification-doubt note" rule (gary-AUDITED, NOT built; edge-cut 31901 exhibit; the rule
must LIFT the field to 90 not just pop the note; allowlist + ≥2-distinct-family + shape-pass + deny-by-default
seam; `pendingfeatures.md:51`); (2) **LANDMARK BOX SNAP** — ✅ BUILT this session, UNCOMMITTED in
`settings/renderer.js addLandmarkFromRect` — just add a pin + commit, don't rebuild; (3) **TARGETED FIELD
RE-SLICE** after a ⊕ teach — DESIGN-STAGE (needs advisor+Oracle). Shipped this session: Chris R5 cards 1-6
(`position_teach_nudge`+`issuer_suggest_on_blank_confirm` now DEFAULT-ON via **mig 89**, live DB flipped),
row-badge→classify(), quiet-lane 2 workers, and the **supplier hard-identifier registry slices 1a+1b DARK**
(`identifier_registry` — learn VAT/company-no at confirm, match→suggested_supplier; Oracle SIGN-OFF-W/COND, do
NOT flip until a REAL-customer-VAT corpus + M=0 + Oracle ratify — the synthetic corpus can't test checksum
precision). Switch inventory: only 6 DARK remain. `d811cce`=features, `f2349f9`=mig 89.

## (previous) 2026-08-26 DAY (resumed a mid-task C2 revision → Oracle re-vet → gate met): `HANDOVER_2026-08-26.md`
Branch `feat/teach-side-overnight`. The prior session left a half-finished, un-vetted WIDENING of the
`issuer_sibling_fill` **C2** safety on disk. That session finished + gated it (folded into commit `d811cce`).
- **The correction (`issuerSiblingFillService.js`):** the mid-task widening (logo≤13 OR `keywordOverlap≥0.60`)
  was buggy (dead keyword arm: `_KW_MIN=KEYWORD_THRESHOLD=75` vs a 0..1 fraction; un-threaded fingerprint) AND
  changed an Oracle-signed safety with no re-vet. **Oracle re-vet = SEND BACK → corrected in place:** the
  keyword arm now uses the app's ONE same-template comparator `brandingFp.convergesByBranding(src,sib,0.80)`
  (distinctive tokens, ≥3 shared floor, SYMMETRIC ratio) — NOT raw `keywordOverlap` (which the premise falsely
  claimed "mirrors handler.js:1635"; that 0.60 is an AND-guard on top of logo≤13, and raw overlap re-opens the
  two-senders-same-garble collision: asymmetric + name-token inflated). Logo arm stays ≤13. Added a
  mature-sibling identity re-check (`supplierNamesDisjoint(C, establishedIdentity(...))`). `reviewService.js`
  now threads the parsed `keyword_fingerprint` array into the pre-claim `src` capture.
- **GATE MET (owner may flip DARK→on):** census **0 / 1,250,932** cross-supplier convergences on the owner's
  1668-doc backup (87.1% same-supplier); PIN h2 with a measured RED-on-old(1.00/0.83 admit)/GREEN-on-new
  (0.375/0.625 refuse) proof; Chris R4 Saltmarsh fired 0→17; Chris R5 full 452-doc CHRISBOT run = 215 filed,
  **0 wrong-company misfiles**, every bad read HELD (leak-checked: nothing left the sandbox).
- **Also fixed Chris Card 6** (`renderer.js`): the Put-back tooltip/dialog said "copies already written to your
  filing folder" on an in-Review sibling-fill/class-fix undo where NOTHING was filed — now kind-aware.
- **Vet queue (Chris R4/R5, NONE safety, NOT built):** Card 1 draw-a-box-nudge (typing teaches identity not
  field POSITION — Pelican 41-blank pileup) · Card 2 buyer-issued-PO steer · Card 3 cold-batch expectation ·
  Card 4 no-sender Unknown-Company scatter · draft Terms (legal). **`issuer_sibling_fill` stays DARK.**

## (previous) 2026-08-25 (resumed after an accidental close: mid-task arcs + a full Chris fix loop): **READ `HANDOVER_2026-08-25.md` FIRST**
Branch `feat/teach-side-overnight`, **origin at `034a3ad`, 13 commits AHEAD + LOCAL/NOT pushed** (owner reviews then
pushes). The session was closed mid-commit; I read the 08-24 handover, committed the uncommitted mid-build work,
then ran the loop Chris→fix→Chris→(recommendation)fix→Chris. **(1) Resumed + committed 3 DARK/OFF-inert arcs:**
`c1d5c08` the Quick-check grid FRONT-END (UI half of `eef96bd`); `d687f31` two DARK detection arcs
(`name_dominant_snap` — a ≤1-edit legal-suffix slip "…Lid"→"…Ltd" silent-adopts + auto-files; and
`branding_strip_reg_boilerplate` — strip {vat,reg,registered,company} so a wrong logo-collision supplier can't win
own_ratio on a "VAT Reg…" line, doc-732). **BOTH detection arcs are OWNER-VET-QUEUE — DARK, need corpus OFF==ON +
Oracle before any flip.** **(2) Chris fix loop (3 rounds, `docs/CHRIS_FULL_APP_REVIEW_2026-08-25.md`):** round 1
→ 7 cards, strong yes; rounds 2+3 verified fixes live, zero regressions. **FIXED (`200e68d`+`97d3527`):**
- **Card 1 (HIGH) invalid-date SILENT MISFILE** — a present-but-unparseable date-ROLE value passed the
  empty-required Confirm gate and filed to `Company/Unknown Year/Unknown Month` with no signal. **gary + Oracle
  both WRONG-LAYER:** the renderer-only + `validation_patterns` idea was a FIG LEAF (looser than `filing.parseDate`
  — passes "15/12/202","15/12/25",slash-ISO,full-month; false-blocks OCR-spaced). Fix gates on `filing.normaliseDate`
  (the EXACT folder-builder parser) at EVERY door: `reviewService.confirm` (pre-claim refuse → interactive toast /
  File-All skip / /v1), `_autoFileDoc` (hold → closes the conf-100/`strict_100_autofile`-off auto-file hole),
  `batchAuditService.validateEdit` (aligned — was the same fig leaf), renderer `validateConfirm` (early pre-block via
  `_parseDrawnDate`). Pins: `test_normalise_date_predicate.js` (16, both sides), `test_reviewservice.js` (refusal
  replaces the old "left as typed" pin), `test_batch_audit_correct.js`.
- **Card 3 (MOD-HIGH)** Quick-check re-file renamed `Invoice.…`→`Document.…` (`getWithExtractions`→`getById` SELECT *
  has no `type_slug` → null slug → builder fell back to "Document"): resolve slug from `document_type_id` via
  `doctypes.getAll`. **Card 5** Cards leaked dev codes (`_baFieldMeta` drops method). **Card 7** Empty bin orphaned
  the `.metadata/*.xml` (`_purgeOne` removes it). **Card A** (round-2) OCR-spaced date showed a spurious "Not a valid
  date" while filing fine — the on-blur `fieldValidationError` now accepts what `_parseDrawnDate` accepts (agrees with
  button+builder; only relaxes).
**Card-1 corpus gate NOT run** — the fixes are confirm/file-time only, don't touch the extraction/`isAutoFileEligible`
READ path `realdoc_regression` measures (byte-identical by construction); predicate pinned 16/16. **OWNER VET QUEUE
(not built):** the 2 DARK detection arcs · Card 2 Terms "NOT YET IN FORCE"/[SOLICITOR:] (legal) · Card 4
letterhead-name-over-abstain (census+Oracle; same class as `branding_strip_reg_boilerplate`) · Card 6 stale
queue-row refresh · grid↔activity-strip flip coupling · green-pill/red-note cosmetic pairing. **Sandbox LEFT RUNNING**
CDP 9223 PID 19928 (`chris`/`plumber2026`, newest code).

## (previous) 2026-08-24 OVERNIGHT (autonomous: corroboration fix + a Chris round): `HANDOVER_2026-08-24.md`
Branch `feat/teach-side-overnight`, **origin at `034a3ad`, 4 overnight commits AHEAD + LOCAL/NOT pushed** (owner
reviews then pushes). Ran while the owner slept. **(1) `9c21ed6` the Pelican-565 corroboration fix** (Oracle
SIGN-OFF-W/COND): the record discarded a genuine independent mapping/crop agreement when the winner was bare
`anchor` (the full-page text/keyword-family reader) — fold bare anchor→keyword in the LOCAL `_corrob_bucket`
(shared bucket untouched; fraud stays closed by same-family skip; `agree_strong` closes the r19-unmask seam so a
bare-anchor line never masks a keyword-regex dissent). Kill `CORROB_ANCHOR_AS_KEYWORD=0`. 26 pins green; realdoc
A/B +2 correct heals, 0 new wrong, M_type=0. Go-forward: held docs reprocess to heal. **(2) Chris full vet** →
strong yes; fixed **#6** (`33a9f6b`, "anchor"→"label" copy) + **#3** (`670ffc7`, the orphaned-doc-while-twins-
auto-file: below-floor+graduated hold panel now guides to Reprocess, not "lower the bar"; + honest presence
comments — the desktop heartbeat is DEAD, presence is a leaky 60s beat, NOT a mid-edit guard) + **Card 2**
(`81719c1`, the nudge pointed "tools rail" → repointed under "This document"). Chris re-verify: #6 + #3 FIXED live.
**OWNER VET QUEUE (not built):** #1 Terms "NOT YET IN FORCE"/[SOLICITOR:] notes (legal, your domain) · #2
first-batch-all-hold (the misfile-safety arc — biggest friction, biggest risk) · **#3-A** the ZERO-CLICK orphan
fix (Oracle-signed DARK `sweep_retrigger_on_view_release` — re-trigger the quiet-reread LANE on doc-close only;
has a window-close-mid-edit trade-off to weigh) · #4 hold-summary double-counts one field (needs below-threshold
field-KEY plumbing from getReviewQueue) · #5/Card 1 OCR misses a printed date/banner issuer (the 007/oscar arc) ·
Card 3 clipped teach-box commits an invalid date with no warning. Sandbox left running on CDP 9223.

## (previous) 2026-08-23 EVENING (live test on a FRESH wiped DB): `HANDOVER_2026-08-23_EVENING.md`
Branch `feat/teach-side-overnight`, **HEAD `0b62235`, 63 commits ahead, NOT pushed.** The owner wiped the live DB
and ran a hands-on session; ONE commit built the fixes (all OFF byte-identical, Oracle-gated): **(1)** activity-strip
UX (two-line chips, ✕/click-to-close, always-a-receipt File All incl. 0-filed; `reviewEvents` dedups `dropped`);
**(2)** put-back re-file via File All (`putback_refile_on_file_all`, **mig 87** `refile_declined_at`+`putback_refiled_at`)
— a glanced-then-put-back doc re-files on the explicit click when it STILL passes the strict predicate
(`isAutoFileEligible({bypassPutBack})`), never via any machine path; undo-loop hard-holds; **(3)** two bugs (tab badge
was `queue.length`→DB count; class-fix bar ✕ + clears on doc change); **(4)** detail-veto single-supplier immunity
(`logo_detail_veto_single_supplier_immune`) — the 256-bit veto crops top-left + hashes a wordmark LETTER, false-
abstaining a dist-2 lock (Oakhaven 543/544); a call-site helper suppresses it ONLY for a corroborated single-supplier
lock tripped by a MARGINAL rival (>48), a DECISIVE rival (≤48, doc-193/buyer) still vetoes. **Verified:** 543/544 →
template 2 on the real app; realdoc A/B OFF-vs-ON byte-identical (supplier 100%, 0 new wrong-supplier, M_type=0);
all targeted+related suites green. **Live fresh DB** = `%APPDATA%\ScanFinder\docusnap.db` (mig 87, app running, all
new switches ON except `trust_company_key_own_scope`). **Deferred:** 531 (skew/coarse near-miss); the 12 wrong-date
auto-files (leading-digit date class — next accuracy arc); notification consolidation; the 5 garble/type-split vet
switches. **The overnight re-freeze/flip owner-owed items are MOOT (DB was wiped).**

## (previous) 2026-08-23 OVERNIGHT (Chris rounds 17→20 fix loop): `HANDOVER_2026-08-23_MORNING.md`
(the standard wrap: verification state, first actions, deferred conditions), then `HANDOVER_2026-08-23.md`
(its OWNER STEPS + the switch table), then `docs/CHRIS_FULL_APP_REVIEW_2026-08-23.md` (rounds 18/19/20 verbatim +
triage tables). Branch `feat/teach-side-overnight`, **~60 commits ahead, NOT pushed** (owner's standing rule).
**Round 20 verdict: the wrong-date self-file class is FIXED as seen — 73 filed, 0 wrong by the app, every wrong
read Chris could provoke was held with the right value one click away; Ironbridge/Larkspur waited for their
confirms.** Six new DARK switches (table in the handover); do NOT flip `trust_company_key_own_scope` live (holds 45
of the owner's docs). Owner owes: the re-freeze script on the live DB; the flip order; the r20 vet cards.
Round 17 (fresh sandbox, every switch ON) → 8 cards → agents → Oracle-gated → one commit each
(`99b90f1` … `740a243`, table in `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md` "Round 17 TRIAGE"); rounds 18–20
ran on the fixes. Headlines:
- **THE IDENTITY UNFREEZE CLASS (`11ca0ba`, a bug, no switch):** `_fieldsWithMultipleConfirmedValues` judged
  the company key TYPE-WIDE — ≥2 distinct confirmed suppliers on a TYPE unfroze EVERY template's identity at
  its next write (the "Gay" / "DOCUMENT" folders). Now per template by DOMINANCE (`templates.getDominantSupplier`);
  a NULL-over-frozen write is loud (warn + audit `template_identity_unfrozen`). **Owner step:**
  `node scripts/refreeze-template-identity-20260823.js --apply --templates-dir <repo templates/>` on the live DB
  (dry run found 5: Silverbeck, Veltrix, Castellan, Harrowgate, Nordwind; realdoc base vs re-frozen = identical, M=0).
- **Holds that never rendered (`99b90f1`):** the refused-confirm return dropped `nearMatch`/`typeSplit`. Rider
  `320433f`: one kept slip no longer silences the type-split ask ('mixed' needs ≥2 of the second type); a blank
  issuer is 'missing', never 'ready' (`issuer_blank`).
- **Garble/fragment (`72a75bd`, `875a433`, `9ae6c2b`):** wide debris leg DARK `template_fixed_debris_wide`;
  JUNK kind of the letterhead suggestion; `hasTemplate` requires the template's identity to BE the scope;
  the near-match SUB-RUN arm (`name_proximity.tokenSubrunIdentity`) asks with the full name first.
- **Review UX (`e9106aa`, `2cf5f26`):** tile yields under the strip + derives from status/door; File All
  records ONE bulk chip (ledger key `approved|bulk`, merge into the newest SAME-KEY event in the gap);
  import banner self-heals; Reprocess copy; "Sent back from Search"; `markUndone` + "Already back in Review.".
- **OWNER CARD 1 — THE READY ARM (`740a243`, DARK `quiet_reread_on_ready_templated`):** at the ready crossing
  the lane also re-reads the scope's OWNED-template held docs with `overall_confidence < scopeTrust().floor`
  (layout-arm guards + the C3.3 hold "Read after learning — confirm once."). **Cannot help an all-generic
  name (DS) — skipped + audited; tell the owner.** `_ownedTemplateRows` is the shared population query.
- **ROUND 18 → the fix loop continued (one commit each, Oracle-gated):** A1 **a wrong date self-filed** (447: blank
  at import, first-filled by the teach-time re-read, swept at the ready crossing) → `371ef2d` the FIRST-FILL
  RELIABILITY hold (DARK `quiet_reread_first_fill_reliability_hold`): hold every first-fill at merge, release at
  `_finish` unless the box proved unreliable in that job (K=1 `FIRST_FILL_UNRELIABLE_K`; witnesses = S3-C5 / loss /
  engine yield); the "— confirm once." family now survives the READY arm (`_ownedTemplateRows`) and a same-value
  Reprocess (`mergeReprocessRows`, `REPROCESS_CARRY_LANE_HOLD=0` kills); S3-C5 rows carry `corrected_to = was`.
  A3 **Put back must stick** → `19e91b0`+`061ca82` mig 86 `documents.put_back_at` (stamped by every human "look
  again" door — `deconfirmDocument`/requeue; the ONE predicate refuses `'put-back'`; a machine via is refused
  pre-claim `PUT_BACK`; only a human claim clears; the auto accept files as "Auto-filed (after your confirms)").
  A4 `7b8c8e1` the `confirm-review` IPC whitelist dropped `typeSplit`. A2/A6/5/7/copy `8b5ae1a`, A7 `615263c`.
  Census `TESTING/_measure/first_fill_reliability_census.js`: DS 0 held, Copperfield held, K=1≈K=2.
- **ROUND 19 → (04:00–04:40):** A2/A3/A4 FIXED; A1 fixed on the lane road but **four wrong dates self-filed via the
  manual "Reprocess N"** (N1) and **Ironbridge filed 18 on zero confirms** (N2). **THE MEASUREMENT THAT MATTERED:** the
  corroboration record called EVERY date a "disagreement" (`_cmp_norm` is separator-blind: `17-12-2026` vs
  `17/12/2026`) → no date was ever corroborated and the keyword family's CORRECT read on the four wrong rows was
  invisible → `6b77f30` date-aware compare (`FIELD_CORROBORATION_DATE_FOLD`) + the every-road `docTrustGate`
  refusal `disagreeing-read:<role>` (DARK `trust_role_disagreement_refuse`). N2 mechanism: the TYPE-wide
  `supplier_name` group was `constant` at 2 names (Copperfield + Ironbridge's own wizard confirm) → `69a65de`
  DARK `trust_company_key_own_scope` (a company key never borrows the type's names; the badge and the gate agree).
  P1 `5979bdc` **`src/modules/processing/rereadHolds.js` = ONE road for re-read holds** (the lane delegates; the
  manual batch + single-doc Reprocess write the same holds, DARK `reprocess_holds_as_lane`; C1: the S3-C5 baseline
  is the row's TYPE-VALID `corrected_to` else its display — never offer 'INV-29273' on a date). P3 `9dc7bf4` the
  layout arm re-reads noted docs (a new box is new evidence); N4/N5/N6/N8 `67aef42` + `65ff83d`. **Realdoc on the
  owner's copy (current app env): 381/416, M=1 (#413, a leading-digit date with no page witness — the next arc);
  the ON arm holds 45 more via `trust_company_key_own_scope` (do not flip) and exactly 1 via the disagreement
  refusal. The 389→381 "drift" was BISECTED: the round-17 HEAD reproduces 381/M=1 — tonight's code is exonerated.**
- **ROUND 20 → `0929e33` File All's loop skips on the ONE classifier (it filed the 9 put-back docs its dialog
  excluded); the identity never gets a one-click Use of its old garble; no duplicate S3-C5 note; `8bc3f32` the lane
  hint carries the job reason. Verdict: 73 filed, 0 wrong by the app.**
**Traps this session:** `core.autocrlf=true` → renderer.js etc. are CRLF on disk (tests slicing `
}
` must
normalise; patch scripts must open with `newline=""`); bash heredocs strip a backslash level (write tests with
the Write tool); hand-rolled test schemas lack mig columns (`pragma_table_info`); the `chris-the-customer`
agent type was NOT registered — spawn general-purpose + Read the persona file. Pre-existing reds unchanged:
`test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`;
Python `test_identity_fusion` + 6 script-style.


## (previous) 2026-08-22 NIGHT: **READ `docs/designs/TYPE_SPLIT_AND_ACTIVITY_STRIP_PLAN_2026-08-22.md` FIRST**
(the plan + the STATUS table at its foot), then `HANDOVER_2026-08-22_EVENING.md`. Branch `feat/teach-side-overnight`,
HEAD `44b6661`, NOT pushed. Three arcs landed tonight, every switch DARK unless stated:
- **The garbled-issuer arc `c5a4050`** (a one-line box over a stacked wordmark read `NOCUMENT` and minted a sender):
  `template_fixed_seed_fragment_garble` (P4 tolerates one edit per ≥6-char READ token; band leg never fuzzed),
  `identity_suggest_canonical` (the "Letterhead may read X" note now carries X in `suggested_supplier` → the
  branding button; the Stage-4.5 token repair `Use "DOCUMENT"` is cleared), `review_group_by_letterhead` (a garble
  groups under its letterhead company + a confirm-time hold). Adversarial census 16,809 pairs → 0 keeps.
- **The type-split arc** (17 Nordwind quotes held by Fix A after ONE mis-confirm bore a purchase_order rival):
  A1 `40f47e3` name-precedence BUG FIX (a template took the machine's pre-confirm read as its name) · A2 `e2fa804`
  `type_ambiguity_unsupported_waiver` — decided ENTIRELY in the engine (process_docs' B1 block is skipped on a
  reprocess of a typed doc), realdoc M=0/M_type=0, would-auto-file 389→410 · A3 `c67f8e1` `type_split_confirm_gate`
  ON (asks once: "Nordwind files as Quote (24 so far). File this one as a Purchase Order?"; the wizard asks BEFORE
  it promotes) · A4 `a4cbd84` catalog `title_aliases` + **mig 85** (Quote → Quotation/Estimate …; with A4 alone the
  live copy's held quote resolved clean) · A5 `7fdfa80` `heading_absent_census.py`: on the owner's DB the printed
  type banner is DROPPED from page text on 105/416 docs and a blind top-band grey OCR recovers 18/18 @96 — NOT a
  colour mechanism; fix = its own arc · A6 `7fdfa80` `type_ambiguity_ripple` (rides the quiet lane).
- **The activity strip** (the top-left tiles re-total `recent_auto_filed` and never expire): B1 `3676415`
  `src/lib/reviewEvents.js` ledger (merge-in-place per batch, `review_events` PROTECTED, four doors incl. the human
  File N, event-id IPC, chunked honest undo) · B2 `44b6661` `review_activity_strip` — chips above the document,
  newest left, click-anywhere closes the panel only · B3 (retire the tiles) = Oracle SEND BACK, not started.
**Owed:** a Chris round with the new switches ON; then the new-install flips. **Owner remedy for Nordwind:** delete
template 12 → retype doc 135 as Quote → Reprocess 17 — or just restart (mig 85) and Reprocess.
**Pre-existing reds:** `test_teach_multipage.js` (its own comment matches its regex), `test_authoritative_anchor`,
`test_v1_contract`, `test_doctype_surface_parity`; Python `test_identity_fusion` + 6 script-style. **Trap:** this
checkout is `core.autocrlf=true` — any source-contract test slicing on `
}
` must normalise CRLF first; Python
`open(p,'w')` patch scripts and bash heredocs both mangle backslashes — use the Write/Edit tools for test files.

## (historical) 2026-08-15: **READ `HANDOVER_2026-08-15.md` FIRST.** HEAD **`717058b`**, 11 commits
**PUSHED to origin**, tree clean. The corroboration arc shipped + validated; owner flipped all reading
switches on their live DB and made it the new-install DEFAULT (mig 70); Chris re-ran on the new defaults.
**⏭ TOP OF QUEUE (owner said "yes, build it"): the hold-siblings FIRST-BATCH REGRESSION.** Chris's re-run:
`template_identity_hold_siblings` (now DEFAULT-ON via mig 70) fires on a FIRST teach, not just a genuine
identity CHANGE — after teaching 10 fresh, ALL 200 imports carry "the sender for this layout was changed to
'X' — confirm it here too" @70 (`template_fixed`), and **File All Ready offers 0** (first night filed 154 in
one click). **FIX (approved, NOT built):** gate the hold-siblings mark on "a prior frozen identity existed AND
differs", never a first teach (`template_identity_hold_siblings` read in `templates.js` + bridged
`TEMPLATE_IDENTITY_HOLD_SIBLINGS`); + run a DRAWN-box teach control (Chris used typed-locate → freezes
fixed_value from 1 confirm, the young-identity trigger; first night he drew boxes, no such note); and/or don't
count the sender-confirm note as a File-All blocker. **MIG 70:** new installs default all reading switches ON
except `deskew_on_import` (arc keys UPSERT-forced true; others INSERT OR IGNORE); the 8 corrob switches
SFDEV-gated (`DEV_SWITCH_IDS`). **Chris re-run WINS vs first night:** Oakhaven slash-drop FIXED (20/20),
false "net disagrees" gone, trailing-period + `]` fixed, Pelican I/1 better (~55% correct), **mature auto-file
~55%→~93.5%.** Chris's buyer-issued mis-teach (Quillstone as issuer on a Bramblewood PO) → filed under
Quillstone, NO bleed, containment held. Live-DB backup: `TESTING/_measure/live_backup_20260815_autofile_arc.db`.
**THE FINDING (owner's intuition, PROVEN): the DB already knows the answer.** `extractions.corroboration`
records which independent method families read the same value; the confirmed corpus records the dominant
value/prefix. But `trust.js isAutoFileEligible` refuses UNCONDITIONALLY on any note/`corrected_to` and on a
ref/date <88. 20 held docs → 7 classes (A inferred-co · B I/1 invoice# · C corroborated-total · D `]`→1
account · E name-suggestion · F ref-not-on-page · G ref<88), each DB-answerable except F.
**BUILT (workflow `ws8i3wjq1`: 6-reader map → design → Oracle SIGN-OFF-W/COND; ALL DEFAULT OFF, migration 69):**
ONE predicate — `_corrobLicensed` (≥2 independent PAGE families {mapping,crop,keyword}, memory+hint EXCLUDED as
near-circular) AND value==dominant-confirmed. **Gate (`1d1cdab`, trust.js):** `critfield_corrob_floor_relax`
(G — clears the 88 floor iff licensed + learned-shape match; Oracle seam: crop+mapping are common-mode, the
shape match is the 2nd leg) · `vacuous_corrected_to_ignore` (B — a `corrected_to`==`display_value` no-op stops
flagging, null-safe). **Engine (`cb69795`):** `_resolve_corroborated_notes` wired as `_d4` in the `_d1|_d2|_d3`
recompute guard — THE KEY PLACEMENT: a cleared note there ALSO drops its `overall_confidence` penalty, so the
doc clears the floor on reprocess (a stored-row clear can't — the penalty is baked at extraction). Arms
A/B/C/D/E each gated + fail-toward-Review; `_corrob_licensed` mirrors trust.js (pinned cross-language).
**Remediation (`scripts/remediate-corrob-queue-20260815.js`):** stored-row backlog delivery (dry-run default).
**VALIDATED on the REAL pipeline (Chris mature-reprocess, 7141316): the arms CLEAR NOTES + ADOPT VALUES
correctly, ZERO misfiling** — Chris filed 7, all correct. **⚠ CORRECTION to an earlier over-claim: the
`verify_heal.py` "≥10/20" was WRONG** — it omitted the engine's format-confidence penalty (`fc_delta`) AND
assumed graduation. The HONEST measurement (real `isAutoFileEligible` over the mature sandbox, arms ON): of
17 still-held docs, **only 3 are `flagged` (a note the arms can clear); 14 are `below-floor`** — a CONFIDENCE
DEFICIT (overall 76–85 < floor; Pelican floor 100 = NOT graduated), NOT a note. **The arms clear notes/adopt
values; they do NOT raise overall_confidence past the floor.** So the arc auto-files docs held ONLY by a note
AT ≥floor confidence (a minority); the Pelican I/1 (oc 84) + most Silverbeck (oc 77) stay held by below-floor
regardless of the note-clear. **The bigger backlog lever is SEPARATE from this arc: why a CORRECT Pelican
invoice reads at overall 84 (the fc_delta format penalty), and Pelican not being graduated (floor 100).**
**33 new pins green; whole suite 483/494 = the 11 documented pre-existing reds, ZERO new. OFF is inert by
construction.** **The fix's real value: correctness (right value/folder, no spurious flag) — NOT a big
backlog auto-file jump. OWED before any live default-ON flip: the OFF==ON md5 corpus arm + Oracle ratify.**
**THE "overall-84" PENALTY — DIAGNOSED + FIXED (`3f64c10`, `corrob_note_recompute_fc`, DEFAULT OFF):** a
CORRECT Pelican invoice reads 84 because its `invoice_number` note is counted as a format MISMATCH by
`format_consistency_delta` (−12). Clearing the note SHOULD lift it, but the demoter recompute guard REUSED
the STALE `fc_delta` → **every note-demoter (these arms AND the shipped recon/name/xcheck slices) was
COSMETIC** (note cleared, penalty stayed). The fix recomputes the delta off POST-demote results when armed
(verified: 1716 84→96). **THE LINCHPIN — it is what makes note-demotes actually reduce the review pile.**
**BUT Pelican still won't auto-file:** `scopeTrust`=`{floor:100, reason:'recent-correction', corrections:3}`
— graduation is blocked by recent corrections (by-design safety), so 96<100→held. To auto-file the Pelican
I/1 docs, BOTH must happen: (1) the fc flip (84→96) AND (2) the scope must GRADUATE (recent corrections age
out). corroboration_autofile can't rescue it (Pelican invoice_number is single-method → `independent_agree:false`).
**CHRIS ROUND 2026-08-15 ran** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-15.md`; fresh sandbox CDP 9223, 7 switches
ON, SINGLE+IMPORT+IMPORT2 per TEACH_ORDER). **A fresh install has NO confirmed history, so the corroboration
arms are largely inert there** — his run measures the teach/import UX + base rate + detection issues. **Wave 1:
0/200 auto-file** — `auto_file_threshold` unset → defaults to **100%** while taught reads land 87–95%, so every
CORRECT read sits in Review (File-All-Ready then files 154/200 in one click). **Wave 2 (after that manual batch
GRADUATED the suppliers): ~55% auto-file, correct folders.** **OWNER-VET QUEUE (nothing implemented):**
**#1 the 100% default files nothing out of the box — default ~90 or prompt after the first batch (bigger than
this arc, orthogonal to it).** #2 buyer-issued PO steers "Document Issuer" at the OWN letterhead (Quillstone PO
= Bramblewood letterhead — the known buyer-issued class). #3 Pelican I→1 + ⊕ can't fix an OCR misread
(re-reads same pixels) — CONFIRMS class B; the app already computes the "wider reading" it only warns about.
#4 Oakhaven slash-drop flags 19/20 on a cosmetic "/" (the separator class). #5 stale recycle-bin view (recurs).
Chris CONFIRMED the round-4/5 recycle-bin fixes (Empty bin deletes PDFs; restore returns page-intact).
**CHRIS ROUND 2 (owner asked to re-run under REAL config): a SANITIZED COPY of the live DB (1258 confirmed,
all 30 owner flags + 7 fix flags ON, paths repointed + leak-checked, users cleared). Reprocessed the 24 held
docs → filed 7, ALL correct, ZERO misfiling.** Method fingerprints prove A/C/D/E fired on the real pipeline
(`+corrob_clear`×22, `+snap_corrob`×2, `+name_corrob_adopt`×4, `template_identity_corroborated`×4). **B FOLLOW-UP — RESOLVED 2026-08-16 as a NON-BUG (code-vintage artifact):** the mature-sandbox batch
reprocess ran 15:56; the B fix (`7141316`) was committed 19:00 — the batch simply ran the OLD leg.
Env/args parity across all 3 spawn paths verified; `mergeReprocessRows` is INNOCENT (used_new stores
the fresh row wholesale). The "trace mergeReprocessRows" lead was FALSE — do not chase it again.
Verdict: never filed a wrong value/folder — tidy the note copy and it's an unconditional yes.

## Prior sessions — 2026-08-01 → 08-14 (collapsed 2026-08-15; full detail in each `HANDOVER_*.md`, the `docs/session-log.md` verbatim archive, and the `MEMORY.md` index)
> These per-session state blocks were stacking up and bloating this file. Each is preserved IN FULL in
> its named `HANDOVER_*.md` (repo root) and appended verbatim to `docs/session-log.md`; the durable
> per-feature facts (commits, kill switches, gates, follow-ups) live in `MEMORY.md` + `memory/project_*.md`.
> **Grep the matching `HANDOVER_*.md` (or `docs/session-log.md`) before re-touching anything a recent
> session built.** Newest first:
- **08-14 overnight** → `HANDOVER_2026-08-14.md` (HEAD `656c722`) — near-match issuer gate (typed OR drawn, toggles ON, mig 68); 5 Chris round-5 cards incl. a `reconcileHolding` startup data-loss bug (soft-deleted page culled); the inferred-identity fuzzy-geom shed (OFF); Chris round 6.
- **08-13 NIGHT2** → `HANDOVER_2026-08-13_NIGHT2.md` (HEAD `3327a22`) — the home-run arc: 6 phases, 11 commits, migrations 64–67, 4 new flags DARK + mig 67 turns SEVEN switches ON for NEW INSTALLS only. Census F 85.4%→92.8%; buyer-issued slice 3 REFUSED by its own census; the lexicon `<3 distinct` root cause ⇒ WEAK-only.
- **08-13 AFTERNOON** → `HANDOVER_2026-08-13_AFTERNOON.md` + `docs/designs/TEACH_POISONING_ARC_2026-08-13.md` (HEAD `dc4bf1d`) — teach-poisoning arc; Oracle SEND BACK (9 conditions); root cause = the unguarded WRITER `templates.js:1195` (never compared warrants). Census E: 33/36 name scopes hold ONE value ⇒ WEAK-only.
- **08-13 NIGHT** → `HANDOVER_2026-08-13_NIGHT.md` (HEAD `53db7eb`) — slice-3 B2 gate built+run; `realdoc_regression.js` had NEVER run the app's flags (`RR_APP_ENV=1`, DEFAULT OFF); Chris round 4 (a teach overwrote a frozen identity → 20 siblings @95 → 12 filed).
- **08-13** → `HANDOVER_2026-08-13.md` (HEAD `e752b95`) — corroboration note-demote slices 2+3 + machine-feed slice 1, all DARK. The harness-DPI vacuous-arm trap (harness 300 vs app 200).
- **08-12 NIGHT2** → `HANDOVER_2026-08-12_NIGHT2.md` (HEAD `fa1c0cb`) — IMPORT ARC: auto-file 70/200 → ~184/200 live; 5 toggles owner-flipped ON. confusable-snap = WRONG LAYER; corroboration-clears-notes already ships.
- **08-12 NIGHT (early)** → `HANDOVER_2026-08-12_NIGHT.md` — the import-arc measure (70/200, the three-gate decomposition, the autofile-gate unify slice).
- **08-12 EVENING** → `HANDOVER_2026-08-12_EVENING.md` (HEAD `3852d7c`) — reprocess DID auto-file (the renderer `autoCommitFullConfidence` door); consent bar `0177716`; 101-doc cohort stamped `auto_reprocess`; type-election disparity traced.
- **08-12 DAY** → `HANDOVER_2026-08-12_DAY.md` + ADDENDUM (HEAD `3a751d0`) — 8 dark slices, 6 Oracle passes, backfill applied; auto-file was IMPORT ONLY (later corrected — the reprocess door); graduation ISSUER FREEZE; adopted rows never learn.
- **08-12 OVERNIGHT** → `HANDOVER_2026-08-12_OVERNIGHT.md` (HEAD `afe8da0`) — name-box flush-clip slice (un-squat heal; does NOT fix the Ironclad exhibit); "Pelican autofiled" verified FALSE; Chris round 3 (a guard nested in a success branch missed its own failure case).
- **08-11 LATE** → `HANDOVER_2026-08-11_LATE.md` (HEAD `dc285a3`) — 8 gated arcs live incl. corroborated auto-file owner-ON; child-window DOCK resolved; sample-angle backfill applied; currency symbol-cut stand-down. memory+hint never licenses.
- **08-11 DAY2** → `HANDOVER_2026-08-11_DAY2.md` + `OWNER_TEST_SCRIPT_2026-08-11.md` (mig 62–63) — corroboration record+surface (record-only); LIST field type; young-identity corroboration fix; taught label→keyword at template scope. memory family only in the emit; record-before-decide.
- **08-11 DAY** → `HANDOVER_2026-08-11_DAY.md` (HEAD `75d29ce`, mig 61) — taught label REPLACES generic keywords (OFF); issuer plausibility warn (ON). OWNER DIRECTION: CORROBORATION over getting-it-right — encode INDEPENDENCE OF METHOD FAMILY, never a witness count.
- **08-11 OVERNIGHT** → `HANDOVER_2026-08-11_NIGHT.md` (HEAD `455d4a7`) — `I`→`1` root-caused + Oracle-signed, deliberately NOT built; do NOT flip `CODE_SEPARATOR_STRUCTURE_GUARD` alone (operator confirms arm it); first whole-suite run (457 files, 14 genuine reds).
- **08-10 EVENING2** → `HANDOVER_2026-08-10_EVENING2.md` (HEAD `8ee7456`) — a typed teach value captures a position (a box is evidence about WHERE, never WHETHER); separator guard; EU VAT formats; `deskew_on_import` kills `teach_angle_compose_scan`.
- **08-10 EVENING** → `HANDOVER_2026-08-10_EVENING.md` (HEAD `6acf4e2`) — UI/UX + copy only; child-dock chip; stamp placement + size + notes elide; ageing chip; teach stops selling the position-less route.
- **08-10 DAY** → `HANDOVER_2026-08-10_DAY.md` (HEAD `65abd6f`, mig 60 installer) — wrong-company misfile FIXED (a layout may only claim a doc that NAMES its company); account numbers; cold-start sender; teach↔settings parity. `TEACH_FRESH_IDENTIFY=1`.
- **08-10 OVERNIGHT** → `HANDOVER_2026-08-10_NIGHT.md` (HEAD `bc157d9`) — ONE confirm stamped the wrong company on 18 others @95 (NOT fixed that night); VAT fixed (100/26/54 → 171/0/9); six security holes closed; `readable_census.py`.
- **08-09 NIGHT** → `HANDOVER_2026-08-09_NIGHT.md` (HEAD `71bce9b`) — the harness was measuring the WRONG pipeline (DPI 300 vs app 200); Oracle issuer-arbiter fix (fix the ARBITER, the layer moved); 4 flags bridged.
- **08-09 EVENING** → `HANDOVER_2026-08-09_EVENING.md` (HEAD `81c8c4c`) — the money slice: totals 89/28/3 → 119/0/1, 30 healed 0 regressed; drift row-pitch + currency edge-grow (both OFF).
- **08-09 morning** → `HANDOVER_2026-08-09.md` (revert `8b8b458`) — teach-side arc; 140 siblings: date 100%, customer 99%, issuer 86%, ref 86%; do NOT flip `deskew_on_import` (WRONG LAYER); `TEACH_ANGLE_COMPOSE_SCAN`.
- **08-08 OVERNIGHT** → `HANDOVER_2026-08-08_OVERNIGHT.md` (revert `8b8b458`) — the owner's teach-side test scored against corpus GT for the first time; remaining gap is GEOMETRY not rules; `teach_run_ab.js` + `score_teach_run.py`.
- **08-08 EVENING** → `HANDOVER_2026-08-08_EVENING.md` (HEAD `87c3057`) — SEC-17 live fail-open fixed; teach label-pick (shared `pickLabelCandidate`); 2 live validation defects (iban/ipv6); Pelican `customer_name` diagnosed. `pytest tests/` ABORTS.
- **08-08 DAY** → `HANDOVER_2026-08-08_DAY.md` (HEAD `078569e`) — NIGHT3 slices bridged + Oracle-gated (`TRUST_SHADOW_ROW_SKIP` sign-off); teach MULTI-PAGE shipped; SEC-17/18. `SECURITY_BACKLOG.md` is GITIGNORED.
- **08-07 NIGHT3** → `HANDOVER_2026-08-07_NIGHT3.md` (HEAD `359f2c7`) — delivery defect fixed (`_DRIFT_FLOOR` misused as a same-row tolerance); 3 slices DARK (inline-row-overlap, ref-role digit gate, shadow-row skip), all gates green.
- **08-07 NIGHT2** → `HANDOVER_2026-08-07_NIGHT2.md` (HEAD `5ee4718`) — VAT-reg-not-amount guard SHIPPED + owner-flipped (false alarms 39→0, true flags 16→26); delivery defect DIAGNOSED; shadow-row + reggie slice designs.
- **08-07** → `HANDOVER_2026-08-07.md` (HEAD `2a9a556`) — date-crop premise REVERSED (tight box clips the leading glyph; a padded window recovers it); SFDEV crop fix; credit-note type family (3 causes, one toggle); `validation_note` = the auto-file block.
- **08-05** → `HANDOVER_2026-08-05.md` (commits `b63bd86`·`8f631b8`·`2ddd5fa`·`fafd8b4`) — jitter-crater arc CLOSED (A/B/C/D dark, gates green): the crater = absolute-rung clipped-clean-read commits. Never edit mapper py mid-arm.
- **08-03 NIGHT** → `HANDOVER_2026-08-03_NIGHT.md` + `HANDOVER_2026-08-03.md` (HEAD `1ab4606`) — perfect-catch arc: SIX flips live, all Oracle-gated (crosscheck-outlier, universal-verify, edge-clean, word-snap, frag-clean, clip-commit).
- **08-02** → `HANDOVER_2026-08-02_NIGHT.md` + `HANDOVER_2026-08-02_OVERNIGHT.md` (HEAD `5652487`) — Chris fix cycle; label-tail clamp + scope-sweep + workflow suite ON; de-pathing; teach-first plan signed; the customer doc-test corpus.
- **08-01 NIGHT** → `HANDOVER_2026-08-01_NIGHT.md` (HEAD `8d66041`) — D1 digit-disagreement flag ON; blank-supplier live fill cured end-to-end; catch-up filing slice 3 built dark; Chris The Customer advisor + skill.

## Prior session states (2026-07-28 and earlier) — archived, read on demand
The per-session state blocks used to stack up here and bloated this file past 1800 lines. They are
now archived, not lost:
- **Each session has a `HANDOVER_<date>[_PART].md`** in the repo root (07-15 → 07-28_NIGHT). Read the
  one matching the work you're resuming.
- **`docs/session-log.md`** carries the VERBATIM per-session blocks (2026-07-09 → 08-13) in one
  greppable place — grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent
  session built.
- **`MEMORY.md` index + `memory/project_*.md`** carry the durable per-feature facts (commit hashes,
  kill switches, gate results, open follow-ups).
Keep this file lean: when a new session wraps, REPLACE the current-state block above — do not stack a
new one on top. Move the outgoing block to `docs/session-log.md` (+ a `HANDOVER_*.md`). The `/newsession`
skill does this.

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

**STOP AND SECOND-GUESS at these six junctures** (owner rule, added 2026-07-24 after a root cause was
missed that the owner spotted immediately; item 6 added 2026-07-27). Not "think harder" — at each named
juncture, spend ONE extra step asking **"do I need more information?"** and **"what am I missing?"**, then
continue. This does NOT override token conservation: it is six specific moments, not a licence to widen
every investigation.
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
6. **You are about to ASSERT that something EXISTS / does not exist / is configured a certain way** — a
   template, field, setting, DB column, learned row, file, flag. **NEVER state system state from indirect
   or partial evidence — VERIFY IT AT THE SOURCE first** (query the DB, read the code, list the table/dir).
   It is almost always a cheap, bounded check (one SQL query / one grep), and when the claim is load-bearing
   for a diagnosis it is mandatory, not optional. A UI or trace signal is NOT the state: "No template match"
   on screen means the matcher did not SELECT one for THIS doc — NOT that no template EXISTS. FAILURE
   2026-07-27: asserted "Northgate has no sales_order template" from a "No template match" flag plus a stale
   forensic, and built a diagnosis on it; the owner knew a sales_order template with ~10 confirms existed. A
   5-second `SELECT … FROM templates` would have caught it and changed the whole root cause. Do not make the
   owner be your fact-checker for state you could have queried.

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
Defined in `.claude/agents/*.md`; invoked via the Agent tool. ALL are ADVISORY — they diagnose/
recommend, DO NOT implement unless explicitly asked (implementation stays with main Claude Code).
Brief them fully (a fresh spawn starts cold) and relay findings. Read the agent file for the full
brief. Every design advisor (007/gary/oscar/reggie/eric) carries the **"name the seam"** rule: before
proposing, state what the fix RELIES ON upstream and what safety/gate it DISABLES downstream — the
worst near-miss was a fix correct in isolation that removed a safety another fix relied on (an M=1).
Same OSS-licence hard rule (free for commercial use, state the licence) on all OCR advisors.
- **bob** — senior software/product advisor: report/plan → plain English, fact vs assumption, risks,
  ranked options + recommendation. Use after a report, before implementation.
- **barry** (barry-the-brainstormer) — product BRAINSTORMER: high-value feature ideation for home/
  small-office doc management; full user flows, friction, segment fit; L1–L4 + priority. Brainstorm-
  stage only (still passes advisor+Oracle gate before build).
- **gary** — Python engineering analyst: root-cause (FACT vs ASSUMPTION), smallest-correct testable
  fix DESIGN (backward-compat + migration + invariants), TEST STRATEGY (unit + realdoc M=0 gate + a
  PIN test so a future dev can't restore the bug).
- **oscar** — OCR expert: pipelines, Tesseract PSM/OEM/lang, per-field crop recipes, confidence,
  throughput (flags PyMuPDF AGPL → pypdfium2).
- **eric** — Electron expert: main/renderer, secure IPC/preload, BrowserWindow/webContents lifecycle,
  child-process, packaging/electron-builder, signing, perf/memory.
- **reggie** — regex & extraction-pattern expert: field regexes + validation (invoice/PO/SO numbers,
  VAT, dates, totals, codes) + anchored label→value; precision-first; keeps JS `RegExp` ↔ Python `re`
  aligned (shared `validation_patterns`).
- **007** — elite OCR ENGINEER (deeper than oscar on geometry): separates READING from PLACEMENT,
  follows the coordinate frame, FACT vs HYPOTHESIS. For the hardest positioning bugs (label→value
  drift, registration/frame mismatch).
- **oracle** — FINAL adversarial reviewer: VETS the CONSENSUS (invoke LAST, after the specialists
  agree, or for a hard second opinion). Catches the SEAM between correct fixes, VETS THE PREMISE,
  TRACES code to verify claims, weighs BLAST RADIUS (prefers do-nothing/lower layer), insists FAIL-
  TOWARD-REVIEW, names the VERIFICATION GATE (M=0 + zero accuracy drop). Verdicts: SIGN OFF / …WITH
  CONDITIONS / SEND BACK / DO NOTHING / WRONG LAYER. Log: `docs/oracle_log.md`.
- **iris** / **herald** — perceptual-match & doc-TYPE/heading forensics (read-only, never write the
  live DB). 007 + Phillip run as general-purpose + persona. See the memory index + agent files.

**Skills** in `.claude/skills/`: Python engineering set (`testing-strategy`, `code-quality`,
`performance`, `api-design`, `packaging`, `security-audit` — gary's toolkit), `ocr-document-processor`
(oscar; its requirements.txt lists PyMuPDF — use pypdfium2), `ocr-engineering` (007's deep pack),
`scan-finder-frontend-design` (website/UI).

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
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair. ⚠ NOT "suggestion-only" (CORRECTED 2026-08-13): the STRONG tier (every changed token doc_freq>=0.9) AUTO-APPLIES at engine.py:7920-7932; only WEAK is suggestion-only. ⚠ Its lexicon is DEAD for 33 of 36 name scopes on this install — format_anomaly_checker.py:763 drops any group with <3 DISTINCT values BEFORE the build, and 91.7% of scopes hold exactly ONE (so doc_freq==1.0 makes the 0.9 STRONG bar a tautology there). JS twin of the deterministic legs = database/modules/name_proximity.js
│   │   └── identity_fusion.py           # text-led SUPPLIER identity. ⚠ NOT DORMANT (CORRECTED 2026-08-13): rapidfuzz 3.14.5 IS vendored, licensed and BUILD-ENFORCED (scripts/check-vendor-python.js:35); `identity_conflict_flag` defaults ON and the conflict arm sets _needs_review (engine.py:8349-8369). The only name-vs-known-SET matcher, but its gazetteer is logo/hint/anchor rows ONLY and it never sees a teach. Stale "unbundled → no-op" comments remain at engine.py:27-29 and :8372 ➜AN
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
  disambiguated by keyword fingerprint; a null doc-type slug silently disables the format/qualification
  gates). TYPE-PRECEDENCE (2026-07-09): same-logo sibling templates share IDENTICAL fingerprints, so the
  tie-break can't separate them and the established sibling stamps the WRONG type over the doc's own
  title. `identify_template(detected_slug, title_trusted)` breaks the tie by the doc's OWN detected
  title: within the same-logo cluster PREFER the sibling whose `document_type_slug == detected_slug`;
  REFUSE (return None → doc to review to teach) when a TRUSTED title declares a type NO sibling carries.
  `title_trusted` = the type is a STRUCTURAL standalone HEADING (not a confidence threshold). Both args
  computed ONCE in `process_docs`, threaded IDENTICALLY into BOTH identify_template calls (no split-
  brain); custom-type TITLE ALIASES (`document_types.title_aliases`) feed it via detect_document_type.
  Guarded by `tests/test_template_matcher.py`. Full detail: `docs/extraction-pipeline.md`.
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
  **NARROWED 2026-08-01 (Oracle-signed, S-C, kill `BLIND_GEOM_DISAGREE_RECONCILE` — DARK until owner flip):
  a REGISTRATION-resolved authoritative read that FAILS its own-supplier learned shape may be reconciled
  against ≥2 distinct-stage witnesses (adopt) / flagged against 1 — anchor_inline/anchor_crop_relocated
  winners stay fully exempt (the 2026-07-26 re-teach fix depends on it; pinned in
  tests/test_blind_geom_reconcile.py). Deterministic content-nature flags (date-in-ref S-A, ref-length
  S-B, prefix-outlier) also apply to taught reads — "the teach fixed the position, not the value".**
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
- **OUTPUT STRUCTURE is BUILDER-driven** (Settings → "Output Structure" tab;
  `src/modules/filing/filename_pattern.js`) — two token-block builders (click-to-insert + live preview):
  - **Subfolders** = `output_folder_pattern` (token string, `/` = new level). Default
    `{supplier}/{year}/{month}` = legacy Company/Year/Month (byte-identical if unchanged).
    `buildFolderSegments` token-substitutes + Windows-safes each level + drops empties; handler still
    enforces output-root containment on the joined path.
  - **Filename** = `filename_pattern` (default `{docType}.{date}.{ref}` = `DocType.DD-MM-YYYY.RefNo.pdf`)
    — existing `buildFilename` engine, unchanged.
  - Blocks (`FIELD_TOKENS`): `{supplier}` `{docType}` `{date}` `{ref}` `{year}` `{month}`; same builders
    in the first-run wizard. IPCs `get-output-structure-info` / `preview-output-path`. Guarded by
    `test_filename_pattern.js`.

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

**STRUCTURAL fields (Document Issuer / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the identity/COMPANY field (`COMPANY_KEYS`
= **`['supplier_name']` ONLY since mig 44, 2026-07-10**: customer_name was UNLINKED from identity →
ordinary OPTIONAL recipient field on every type; mig 45 purged its stale issuer-as-customer learning),
the `date_field_key`, and the `ref_field_key`. The identity field's DISPLAY label is **"Document
Issuer"** for both keys (mig 38 — one unambiguous label so an operator never enters variable data like
a customer name there; supersedes the mig-35 Supplier/Customer split). Label-only: internal keys
(supplier_name/customer_name) + learning schema untouched. These roles drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning (logos/hints/anchors/corrections/
template identity key off the company scope value), so the FIELD can't be deleted/disabled/renamed/
retyped — but the per-document VALUE stays editable (correcting a mis-read feeds learning).
`is_structural` annotated per field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked
toggle, no delete, 🔒); `updateField`/`deleteField` enforce it server-side; `create-doc-type-with-
fields` injects a Company field if omitted. Guarded by `test_structural_fields.js`.

**DANGLING STRUCTURAL ROLE — self-heal + Confirm resilience** (2026-07): a `ref_field_key`/
`date_field_key` can point at a field that no longer exists (Reference field deleted, or a type made
with a role key matching no field) → Review's Confirm gate became impossible (required key matched NO
field, Confirm disabled with nothing on screen to fill). Three guards: (1) `repairStructuralRoles()`
CLEARS a dangling role to NULL on the UI type-list loads (getAllWithFields[All]) so Settings shows it
unset + re-pickable (not auto-repointed — the user's call); (2) `updateType` REFUSES to set a role to
a non-existent field key; (3) Review's `validateConfirm` DETECTS a dangling role and shows a clear note
instead of a silent block. Guarded by `test_structural_fields.js`.

**PRESET DOCUMENT-TYPE CATALOG** (Settings → Document Types → "Add from catalog…"; `document_types.js`
`PRESET_CATALOG`/`getPresetCatalog`/`addPresetTypes`): a shipped library of ready-made types a business
TICKS to add — Purchase/Sales Invoice, Remittance Advice, Credit Note, Delivery Note, Statement,
Receipt, Quote. Ticking one ATOMICALLY creates type + fields + structural roles (reuses
`create-doc-type-with-fields`/`ensureStructuralRoles`) AND seeds likely field-label aliases into
`field_label_overrides` (per-install, doc-type-scoped) so Stage-1 has a head start with NO teaching.
Slug derived from the name (`presetSlug`); idempotent; catalog types `built_in=0` (removable). Post-
mig-44 EVERY preset's identity role is **`supplier_name`**; Sales Invoice/Remittance/Delivery Note/
Statement ALSO carry `customer_name` as an optional RECIPIENT field (payer captions "Received From"/
"Payment From" live on `supplier_name`, the issuer). reggie-reviewed labels: only doc-specific captions
+ novel ref/date fields seeded; canonical fields defer to `keyword_patterns.json` `field_patterns`
(single source of truth). Phase 2 (DEFERRED): narrow DETECTION by the enabled-type set. Guarded by
`test_doctype_presets.js`.

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

**Update-available banner (advisory).** MS Store delivers the binary; the app only SIGNALS "a newer
version exists." Backend `releases` table (per channel: `latest_version`/`update_url`/
`min_supported_version`) rides the EXISTING `/v1/validate`+`/v1/status` responses via `lib/release.php`
`release_info()` — UNSIGNED, non-gating, EXCEPTION-PROOF (failure → null, can NEVER 500 the token
response → no lockout). Client compares `latest_version` vs `app.getVersion()` CLIENT-SIDE (clean
3-part SemVer; `buildRev` never an ordering key). `licensing/handler.js` `captureUpdateInfo` (own
try/catch, persists `update_info` setting, never null-over-good, can't disturb the gate) +
`resolveUpdateInfo` → `get-update-info` IPC + `open-update-url` (scheme-allowlisted https/ms-windows-
store). Home `#dash-update` banner: info-tone, PULL model, per-version dismissal. **Slice 2 forced-
update** (`min_supported_version`): decideAccess sets `gate.forceUpdate` ONLY on a REACHABLE backend
(`belowFloor(...)`) so offline is NEVER locked (FAIL-OPEN, eric's rule) → own lock window
`src/windows/update-lock/` (Update/Quit only; `update-lock-quit` sender-guarded). Guarded by
`test_version.js` (incl. `belowFloor`) + `test_update_info.js`.

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
**Shared theme** — every window's palette + components centralised in `theme.css` + `theme.js`
(loaded by all windows). **ELEVEN named themes**: core SIX — Light · Warm Paper · Nordic Slate (light);
Dark · Midnight · Graphite (dark) — + a Seasonal group (Spring/Summer/Autumn/Winter light + Festive
dark). Each is a `:root[data-theme="X"]` token-override block; **Warm Paper is the default**. Seasonal
themes carry faint repeating SVG-tile artwork from `shared/patterns/*.svg` served CSP-safe `'self'`
(NEVER `data:` URIs — `img-src 'self'` blocks those), `background-attachment:fixed`, low opacity.
`theme.js` sets BOTH `data-theme` (palette) AND `data-mode` (light|dark family) on `<html>`;
`DARK_THEMES` gates the dark family (incl. `festive`) → `color-scheme` + logo swap key on `data-mode`.
`--on-accent` = text colour on a filled accent. Shell `--bg` patterns are pure CSS gradients (CSP-safe,
NO `url(data:…)`). Picked via Settings → Appearance; account menu + rail-foot toggle = quick Light⇄Dark
flip. `set-setting('theme',…)` persists + broadcasts `theme-changed` live. Windows reference the tokens,
no own `:root`.
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

## Known bugs / resolved history — see `docs/history.md`
- **Resolved 2026-07 headline bugs**: 07-08 harness RED = mis-taught anchor + poisoned GT, NOT code
  (fix: critical-field 88 floor in trust.js); 07-06 cross-supplier POSITIONAL anchor bleed FIXED
  (`_is_blind_cross_supplier_anchor`).
- **Resolved QA/audit (2026-07-02)**: all 11 adversarial-audit findings FIXED + tested (backup natural-
  key upsert, no-ref/date confirm dead-end, reprocess-discards-edits guard, batch file-copy off
  file_done, File-All-Ready expectId race, empty-issuer warn, shared `slug.js`, watch/output overlap,
  …). Read `docs/history.md` before re-touching backup restore, confirm gating, slug derivation, overlap.
- **Old BUG 1+2/3 (startup crashes) — FIXED**: `sanitise_extractions()` (process_docs.py) handles the
  `_`-metadata/str-value mix; `validation_patterns.date` char-range is `[/\-.]`. Both pinned in code.

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

**Build notes**: electron-builder pinned **`^24.13.3`** (verify with
`require('electron-builder/package.json').version`). Don't re-add the legacy `win.sign`/
`win.signingHashAlgorithms` keys. MSIX/Store SKU → `MSIX_SETUP.md`; a test `.appx`
(`electron-builder --win appx`, placeholder `SixMileSoftware.ScanFinder`/`CN=Six Mile Software`)
REQUIRES **Windows Developer Mode ON** — electron-builder extracts `winCodeSign` via SYMLINKS which
Windows blocks otherwise, so `makeappx.exe` never lands (`spawn UNKNOWN`/`ENOENT`); the `.appx` is
unsigned (Store signs on submission). Opt-in data-FREE diagnostics DESIGNED not built —
`DIAGNOSTICS_PLAN.md`. `postinstall` runs `install-app-deps`; native deps (`argon2`, `better-sqlite3`)
auto-rebuilt for the Electron ABI. Installer **unsigned** → SmartScreen "Run anyway" on the VM. Run
gate tests with Electron-as-Node, not plain node (native-module ABI).

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
