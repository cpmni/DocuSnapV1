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

## Recent session changes (2026-07-09 → 07-11) — durable mechanisms now in the code
**READ FIRST: `docs/handovers/HANDOVER_2026-07-11.md`** (morning wrap-up — the whole NIGHT batch is
UNCOMMITTED on top of commit `e898009`; live DB at migration 45; slip-fixer incident + approved fix
cycle). Fuller narratives: `…_2026-07-10_EVENING.md` (the evening batch underneath) + `…_2026-07-10.md`
/ `…_DAYTIME.md`. Session write-ups were REORGANISED 2026-07-11 into `docs/handovers/` +
`docs/night-reports/` + `docs/audits/` — old root paths in memories/handovers are stale by exactly
that prefix. All on branch `feat/doctype-title-aliases`; each fix has unit tests (+ real-doc E2E
where noted).

### 2026-07-11 DAYTIME — slip-fixer FIXED+WIDENED · 5 designs Oracle-closed
**READ: `docs/handovers/HANDOVER_2026-07-11_DAYTIME.md`** (full detail; this is the index).
- **SHIPPED (uncommitted, tested):** (1) slip-fixer ORIENTATION VETO — proposer extracted to
  `src/windows/shared/slipFix.js`; letter↔digit proposals need the candidate's own neighbour
  classes to agree; manual ✎ renames deliberately veto-free; (2) fused-pair DELETION widening —
  `S0O-51337`-class heals ONLY toward an exact learned witness + orientation. `test_slip_fix.js`
  38/38 + live-DB sweep `stress_test/slipfix_sweep.js` PASS. NO corpus run BY DESIGN (zero
  pipeline files). **Ban lifted** — but a Review window opened before the fix runs the OLD code
  (reopen to load). (3) "Dated" added to order_date labels (`tests/test_date_labels.py` 7/7).
- **5 DESIGNS CLOSED (Oracle SIGN OFF WITH CONDITIONS; build AFTER the batch commits, each its
  own commit + corpus A/B) — the conditions live in `docs/designs/*_2026-07-11.md`:**
  REREAD_ESCALATION (Stage-4.5 withheld ref → pixel re-read, ≤69+note; 9 conditions) ·
  ACCEPTED_DEBRIS (Accept button on the trim flag; scoped issuer+doctype+field; C1 crosscheck
  rail blocking) · DIRECTION_SUPREMACY (c2 ownership guard + G3b known-caption guard
  customer-side + D1 teach label-pick; D2 sweep-guard = DO NOTHING; builder traps recorded) ·
  CROP_GEOMETRY (read-time snap-to-glyph retry INTRUSION-only + teach-time box snap).
- **Recorded seams/follow-ups** (detail in the handover + design docs): qualification-withhold ×
  reprocess-merge keeps stale pre-gating junk unflagged; crosscheck side-pick prefers label-side
  debris over agreeing crop+keyword (doc 2378 repro); Stage-2.5d can reproduce the inversion on
  poisoned constant-code dominants; read-time witness-deletion rung (user-proposed companion to
  the re-read). Live wins: Bramble learning clean; customer anchor #158 re-taught, generalizing.

### 2026-07-11 MORNING — "Fix likely slips" INVERTED live (tool defect; fix cycle APPROVED)
- The Learning-History slip-fixer (`computeSlipFixes`, review renderer → `renameFieldValue`) is
  COUNT-BLIND: it renames toward the ≥80% in-scope column consensus, with no orientation guard on
  symmetric confusion pairs (0↔O/$↔S/1↔I). On (Bramble & Finch, sales_order, sales_order_number)
  the majority was itself the poisoned ZERO form (3 mis-confirmed `S0-…` docs), so it renamed the
  two LEGIT values majority-ward: 1879 `SO-66820`→`S0-66820`, 1886 `SO-27481`→`S0-27481`. Blast
  radius = learning tables only (extractions/corrections/hints; `documents.reference_number` +
  filed files untouched — the filenames PROVED the inversion). Undo = five ✎ renames toward `SO-`
  (66820/27481/55005/51337/33736; each also drops the stale hint) — VERIFY landed before touching
  learning. **"Fix likely slips" ban LIFTED — fix SHIPPED 2026-07-11 daytime (block above); safe
  once the Review window is reopened on the new code** (an already-open window runs the old
  proposer). (The NIGHT++++ note + gt_overrides 1880 `why` used to say the opposite — corrected.)
  **USER APPROVED the fix cycle ("yes, run it") — first job next session, don't re-ask:** gary+
  reggie design → Oracle last; smallest slice = block wrong-ward proposals (alpha-prefix
  letter-prior, cross-supplier/doc-type-wide consensus agreement, filename confirm-time record;
  propose NOTHING rather than invert); pin the inversion scenario in a test. Design brief in
  `docs/handovers/HANDOVER_2026-07-11.md`.

### 2026-07-10 NIGHT++++ — SLICE 1 BUILT ANYWAY (explicit USER POLICY OVERRIDE of the gate)
- The owner overrode the Slice-0 do-nothing gate ("belt-and-braces over conditional deployment"),
  so the runtime guard SHIPPED: `value_quality.contains_structured_sibling` (pure predicate —
  whole-value token-bounded containment on normalise_for_tokens forms, sibling len≥5 + ≥1 digit;
  kills the year/pure-alpha/mid-token classes) + `engine._flag_cross_field_duplication` at the
  post-merge guard seam (after the recipient guard, BEFORE identity rescue — gary's composition).
  HOLD-ONLY: name-like non-exempt (manual/template_fixed*/keyword_override) field whose value
  contains an UN-NOTED ≥80-conf non-name sibling's whole value → cap ≤69 + note + needs_review;
  value never touched; an existing wordness note is preserved (cap still applies). The SWEEP now
  IMPORTS the same predicate (offline regression twin; post-refactor re-run reproduces 1 hit /
  0 silent exactly). Tests: `test_cross_field_duplication.py` (incl. the PINNED trade-off: a legit
  "Name REF" compound layout flags every doc until a slice-2 evidence exemption) + six neighbour
  suites green. **Oracle: SIGN OFF WITH CONDITIONS** — seams verified (dup-cap→rescue composition
  REAL; boost-skip intended; conflict-note overwrite lossy-but-safe; no renderer accept-button
  leakage; auto-file TRIPLE-LOCKED incl. at-100). A2 APPLIED same night: the helper's
  `_needs_review` set was DEAD code (the pipeline reassigns unconditionally) — removed; 69<70
  threshold + the note ARE the routing (test reworked to assert the real mechanism + pin
  no-dead-set). REMAINING CONDITIONS: (1) corpus A/B overnight (M=0, zero per-field drop,
  flag-delta eyeball — esp. address⊃postcode / ship_to⊃PO classes); (2) FAST-FOLLOW: pass
  accepted_names/accepted_issuers into the guard (the ONLY name guard ignoring the operator
  allowlists — a compound-layout install has no in-product escape until then; workaround: type
  the value = manual exempt, or re-teach excluding the ref); (3) slice-2 notes: evidence
  exemption, label-aware name-likeness (key-only today — a `field_7` labelled "Customer Name"
  is invisible). READ THE CORPUS OUTPUT BEFORE COMMIT.
- **✅ TRIAGED 2026-07-11 morning — the RED was GT-NULL POISONING, not a code regression.**
  #1777/#1786/#1788 are AW_sal_* Ashford Wholesale sales orders CONFIRMED WITHOUT AN ISSUER in the
  early testing era (filed under `Unknown-Company\` on disk — the stored paths prove it; 1777's
  letterhead was read as 'Ashford Wholesale' in the 07-10 probes). The pipeline NOW resolves the
  correct supplier; the harness scored the right answer against a null answer key. The +5
  regressions account EXACTLY: these 3 supplier rows + doc #1778's known ref/date pair. REMEDY per
  house convention: `gt_overrides.json` gained the 3 entries (NEW `poisoned_supplier` support in the
  harness applier — `""` means "DB issuer must STILL be null", self-validated + fname-pinned;
  non-destructive). Corpus RELAUNCHED with overrides — expect M back to the known Cloudpeak 4.
  OPTIONAL user cleanup: re-file the 3 docs to Ashford in-app (edit-in-place), then REMOVE the
  entries per the file's convention. (Superseded RED note below kept for the record.)
  **RERUN RESULT (07-11 morning): supplier 99.9% (the 3 Ashford rows now score correct), all 10
  overrides applied / 0 skipped, M=5 = the known Cloudpeak 4 + #1880 (BF_sal_24)** — triaged:
  DUAL cause: (a) GT mis-confirmed 'S0-51337' with a ZERO (the 0/O slip class; true SO-51337 per
  the sibling pattern; gt_override ADDED — the doc stays a VISIBLE regression since the
  pipeline's own read 'S0O-51337'@90/keyword is also imperfect on this rough scan — honest and
  intended); (b) the read itself = the SAME class as the Cloudpeak 4 (high-conf keyword ref
  misread on a rough scan clearing the 88 floor) — FOLDED into that standing triage item.
  Tonight's guards are NON-CAUSAL for the read (shipped 'Order Number' label, pre-existing; the
  new guards only push review-ward; the current-tree faithful run lands the doc review=TRUE —
  the fail-safe holds live; the harness M is eligibility-boundary jitter via the customer
  field's read). ⚠ The remediation originally queued here ("Fix likely slips, S0→SO") MISFIRED
  2026-07-11 — the tool renamed majority-ward INTO the poison; see the 2026-07-11 MORNING block.
  Remediation is now the five manual ✎ renames + re-confirm 1880.
- **⚠ OVERNIGHT CORPUS RESULT (2026-07-10 ~23:30): RED — DO NOT COMMIT UNTIL TRIAGED.** Corpus
  2,106→2,253 (evening confirms). Regressions 29→34 (24→28 silent); ref 99.2→98.9; supplier/date
  held/up. **M = 8**: the four KNOWN pre-existing Cloudpeak refs (#2068/70/74/82, kill-switch-proven
  non-causal earlier) **+ THREE NEW: #1777/#1786/#1788 — all sales_order, all wrong on SUPPLIER,
  all OLD docs that were clean in the previous run.** The variant-adopt slice CANNOT be the cause
  in-harness (realdoc's snap() never passes --identity-conflict → the conflict block never runs
  there) — suspects: the C2 weak-core locate exception (anchor.py — NO kill switch), the name-lock
  Layers A/B, or GT drift from the evening's rapid confirms. **MORNING TRIAGE (before commit):**
  per-doc A/B of #1777/#1786/#1788 supplier reads — working tree vs `git show HEAD:` copies of
  anchor.py (the ab_offenders.py pattern in the session scratchpad; swap the file, rerun the doc,
  diff supplier value/method) → if C2/Layers causal, fix-or-gate before commit; if GT drift,
  annotate like the City Office class. Also eyeball the +5 regressions + the ref dip against the
  new-doc population (Cloudpeak-class growth). The duplication guard is FLAG-ONLY and cannot
  change values (any value delta from it = a bug — Oracle).

### 2026-07-10 NIGHT+++ — cross-field duplication guard: SLICE-0 GATE SAID DO-NOTHING (superseded by the override above; the sweep + gate reasoning remain the record)
- The KO_wor_41 class (a wandered relocate committing a SIBLING structured field's value into a
  name-like field: customer="Reference 'WS703182" while reference_number=WS703182@95). Bob+gary
  designed a two-slice guard; **Slice 0 (the decision gate) ran 2026-07-10 night**:
  `stress_test/crossfield_sweep.py` (READ-ONLY, permanent tool — re-run on the next sighting)
  swept 2,360 docs / 7,261 extraction rows with the exact Slice-1 predicate (name-like target
  non-manual; sibling non-name-like, normalised len≥5, ≥1 digit, conf≥80, un-noted; whole-value
  token-boundary containment on normalise_for_tokens forms). RESULT: **1 hit in the entire
  corpus — KO_wor_41 itself — already noted by wordness. Silent residual = 0 → documented
  DO-NOTHING**; wordness's live coverage of this class is currently complete. Slice 1 (pure
  predicate in value_quality.py + flag-only cap≤69+note beside the engine ~2547 guard seam,
  digit/boundary/method-exemption FP rules, the pinned compound-layout nag trade-off) stays a
  READY DESIGN in gary's 2026-07-10 feasibility report — build it ONLY when the sweep shows a
  silent hit (his named structural risk: wordness self-disables on scopes whose confirmed
  history went code-like, so re-run the sweep if a scope's wordness goes quiet). Related
  later slices (own Oracle passes): same-field variant preference (sighting 2), relocate
  geometry (007-led, evidence-first).

### 2026-07-10 NIGHT++ — focus repair COMPLETED (the "no caret but typing works" cure)
- **Root cause (eric, telemetry-proven)**: the repair edge was ASYMMETRIC — `blurWebView()` is
  WIDGET-level and its focus-DROP always lands; `wc.focus()` is VIEW-level and EARLY-OUTS with no
  renderer message when aura focus never moved (window stayed OS-focused — true in every broken
  press: 17-run telemetry `suspect=false pageHasFocus=false winFocused=true wcFocused=true`). So
  every edge was a NET page-focus drop: Blink `focused_` stuck FALSE → no caret/:focus/hasFocus,
  keys still route to activeElement (typing works). Explains BOTH the original "broken everywhere"
  era AND the milder stranded state. TWO stale polarities: post-dialog renderer hasFocus() lies
  TRUE (suspect-arming catches it); post-child-close it's truthfully FALSE (only a renderer-read
  can catch it) — both needed.
- **Fixes (focusRepair.js + preload + main; test_focus_repair.js extended, all green)**:
  (1) THE RESTORE HALF — `blurWebView(); focusOnWebView(); wc.focus()` (focusOnWebView =
  documented widget-level counterpart, RenderWidgetHost::Focus, ZERO OS activation — the
  win.blur/win.focus storm invariant holds); edge gated on `win.isFocused()` (a proactive draw
  edge must never stamp page focus onto a background window); returns {edgeRan} (IPC reply +
  telemetry `forceEdge=` added). (2) forceEdge — the preload's (C) one-shot re-issue (fires ONLY
  after an invoke-ordered repair + double-rAF STILL measures hasFocus()===false; unreachable from
  a healthy click; capped at one) now sends `forceEdge:true` which the edge honours — the old
  payload was deliberately ignored, leaving the self-heal TOOTHLESS (the latent revision bug).
  PINNED: pageHasFocus alone NEVER fires the edge (the at-rest OR-fallback stays dead); first-pass
  payload never carries forceEdge. (3) CHILD-CLOSE ARMING — browser-window-created hook:
  `win.on('close') → getParentWindow().__focusSuspect = true` (dropdown pin safe: <select> popups
  aren't BrowserWindows). REJECTED by eric: caret nudges (setSelectionRange/el.blur+focus — wrong
  layer, page-focus bit is the gate), wc.isFocused() gating (truthful for key routing, blind to
  the renderer bit), draw-path send→invoke (FIFO ordering + self-sufficient edge). NEEDS RESTART.
  **Oracle: SIGN OFF WITH CONDITIONS (applied)** — his headline: the restore half RETRO-FIXES the
  morning's own armed heals (all three arm sites ran blur-only NET-DROP edges — how the runs were
  manufactured); F3 child-close arming is safe ONLY because of F1 (both pinned together). C1
  comment fix applied (help/license are PARENTLESS → never arm; covered by (C) forceEdge).
  ⚠ FAST-FOLLOW (Oracle C3, non-blocking): the dialog wrap is REVIEW-ONLY — 44 native
  confirm()/alert() sites elsewhere (34 in Settings) leave stale-TRUE desyncs unarmed. The wrap
  CANNOT move to the preload (contextIsolation: overriding window.confirm there wraps the
  ISOLATED world's copy — page code never calls it; it would silently do nothing) — replicate
  the review renderer's 6-line IIFE via a shared MAIN-WORLD script per window. Optional
  hardening (recorded, not built): conditional __focusSuspect clear on edgeRan. Manual gate
  (A-F scenarios) required before commit+build.

### 2026-07-10 NIGHT+ — template NAME-HEAL widened (the postcode-named-template report)
- A template born at a supplier's FIRST confirm is NAMED from whatever sat in the Document-Issuer
  field (by design, `_upsertTemplate`; slug derived + frozen) — a wrong first detection birthed
  `name='BT23 1BE'` (slug bt23_1be, later hand-renamed 'Pinnacle') and `name='Ref'` (4 confirms).
  The old heal renamed only still-GENERIC "<Type> Template" names. NOW: `templates.
  shouldAdoptIssuerName(current, issuer)` (pure, exported) — a later confirm's PLAUSIBLE issuer
  (learning.isPlausibleSupplierName, and never a postcode) is adopted when the current name is
  generic OR shape-implausible ("IN"/"36552") OR a UK POSTCODE (regex twin of validation_patterns.
  postcode_uk — postcodes PASS the plausibility shape test, hence the extra rule) OR a single bare
  DOCUMENT-CAPTION word (Ref/Invoice/Total/… frozen set). A plausible hand-given/adopted name is
  NEVER touched (no flip-flop); documented residual: a hand-named ≤3-char ALL-CAPS brand ('DHL')
  re-adopts the issuer (cosmetic; pinned). Wired in review/handler `_upsertTemplate` reuse branch.
  `test_template_name_heal.js`. Template 20 ('Ref') self-heals on its next confirm. ALSO REPAIRED:
  `test_supplier_identity_persistence.js` fixture lacked the `extractions` table the EVENING
  confirm-upsert now writes (pre-existing break since that batch, crashed on require) — table added.

### 2026-07-10 NIGHT — Sales-Order anchor/label geometry (MP_sal_35 'Sso'@91 + "SO #" captions)
- **Diagnosed on the real scan (trace-proven), 3 axes**: (1) the ⊕ LEFT label strip was exactly rect.h
  tall at the VALUE's y — a bolder/higher caption ("SO #") got DECAPITATED → 'sok' → extractLabel's
  ≤3-char reject → position-only teach (the vertical twin of the above-band bug); (2) short captions
  structurally locked out (sanitize stripped '#' → weak 2-char "SO" label; ≤3 tails rejected);
  (3) THE INVERSION: the taught below-anchor's label-lock INLINE HARVEST is CROSS-COLUMN by
  construction (007) — rigid crop read the CORRECT 'Formby & Sons', rejected off_row_drift; the
  harvested junk 'Sso#' cleared every gate (single-token skips the multi-word name gate; '#' pushed
  name_quality to 1.0; ocr_conf NULLED on relocate paths → OCR cap blind; synthetic conf 87-92 has no
  quality term; wordness missed by 0.16 logprob) → committed @91 UNFLAGGED. DPI theory half-disproven
  by probe: tight 108-DPI crops read clean; 300-DPI source = robustness margin only (deferred design).
- **Fixes (oscar+007+reggie designed, gary consolidation-reviewed)**: LEFT strip centre-expanded 1.8×
  (review captureAnchorContext + teach autoLabel) + shared `nearestRowTo` row-pick (anchorLabel.js
  `_groupRows` refactor shared with nearestAboveRow) so a neighbour row can't hijack the column pick;
  SHORT_CAPTION allowlist in extractLabel (closed class [SP]/?O|[SP]\.O\.?|REF|NO + one [.#:], glued
  'SO#'→'SO #' normalised — spaced locates 1.0 vs SOLD-TO 0.5, glued fuzzy-TIES 0.667 both) +
  sanitize keeps a STANDALONE '#' — landed in BOTH twins (anchorLabel.js + learning.js — divergence
  re-strips AND NULLS the drift offset; pinned in test_anchor_phantom_display_label.js) + 9 shipped
  S/O-S.O.-"SO #" sales_order_number labels (longest-first!) + `_label_score` boundary guards made
  conditional on alnum needle edges ('#'-terminal needles match glued values). **anchor.py NAME-GUARD
  Layers A+B** (`_name_junk_shaped`: key-only is_name_like_field, judged on the NON-ALNUM-STRIPPED
  form, single-token <4 letters or name_quality<0.5): A = the label-lock replacement keeps a
  multi-word name-quality rigid over a junk-shaped candidate (reject event
  `name_guard_junk_candidate`), B = relocated/inline junk-name commits capped ≤70; both flag via
  `_relocate_guard_note` (SEPARATE slot from _xcheck_note — the crosscheck can flip the value; never
  overwrites a method note). off_row_drift untouched; the 2026-07-06 drift-fix class pinned
  replaceable; DELIBERATE residual: ≤3-alpha brands ('IBM') flag on wandered reads (accepted-names
  doesn't reach anchor.py yet — future plumbing). Composes with Stage-2.6 rescue (min-cap keeps
  70+note; pinned in test_late_anchor_rescue.py §4c).
- **E2E MP_sal_35**: BEFORE customer_name='Sso'@91 unflagged + SO number ABSENT → AFTER
  customer_name='Formby & Sons'@70+note (beats the keyword interleave artifact "SO #"@83) +
  sales_order_number filled @88 review-bound. Siblings: MP_sal_36 clean 'Antrim Coast Hotels'@90
  (guard costless when clean) + SO@88; MP_sal_03 kept-rigid@70+note + SO@88; AW_sal_07 (other
  supplier) imperfect reads capped 69/70 → review, never silent. Strip probe: old geometry → no
  label; new → 'so #'. Tests: test_anchor_name_lock_guard.py (junk shapes + BOTH trade-off pins) +
  test_so_number_labels.py + test_anchor_label.js §nearestRowTo/SHORT_CAPTION/sanitize# +
  phantom-label test premise moved customer_name→supplier_name (STALE after migration 44 — the 2 BADs
  were PRE-EXISTING, proven vs HEAD). Full battery green. DEFERRED designs recorded: 300-DPI teach
  crop source (--source-dpi + sliver-gate scaling 5px@108≡14px@300 + crop_norm box space, gated
  image-only via born_digital.assess_page); '↓ Below' readout toggle (+ runAnchorDraw dcy>0
  misclassify fix); min(native,300).
- **Oracle verdict: SIGN OFF WITH CONDITIONS — ALL THREE CLOSED.** C1 corpus A/B: regressions
  29/24-silent (one BETTER than the pre-fix run), per-field supplier 99.8/ref 99.2/date 99.6
  (identical; sales_order_number scores inside the type's ref role; customer_name NOT
  corpus-scored — its evidence is the 4-doc E2E), M=4 = the SAME pre-existing Cloudpeak set
  (kill-switch-proven non-causal; open triage). C2 IMPLEMENTED: `_is_blind_cross_supplier_anchor`
  weak-core exception — a locate via a ≤3-alpha-core caption ("No."/"Ref"/"SO #") does NOT count
  as "same layout" for a NAMED different supplier (falls to the blind drop); same-supplier /
  global / ≥4-core byte-identical; the suite's two LOCATED-KEEP pins were moved off the
  placeholder 'x' label onto realistic captions (intent preserved); 5 new C2 rows; ZERO stored
  anchors have weak-core labels → the completed corpus run certifies the final code. C3 RECORDED:
  **the 88 critical floor passes conf==88 BY DESIGN** (trust.js blocks only c < 88, pinned in
  test_scope_trust.js — do NOT "fix" the comparator, it would over-hold clean 88/90 base reads);
  the pattern-valid slipped-ref class ('SO'→'50' @88) is carried by Stage-4.5 learned-shape
  gating + docTrustGate + overall/notes, NOT the floor (doc 2204 was stopped twice: overall 58 +
  the name-guard note). Oracle also corrected one evidence line: 'Formby & Sons'@70 beats
  keyword@83 via TAUGHT-anchor precedence (Tier-A), not confidence — a PASSIVE anchor would lose
  that merge to the interleave artifact (pre-existing keyword exposure, documented, not new).

### 2026-07-10 LATE EVENING — custom FREE-TEXT fields first-class (RC1 slice 2 + the ordering seam)
- **Diagnosed on MP_wor_48 (Worksheet `customer` "Not found" forever, reprocess included), 3 stacked
  causes**: (1) free-text custom fields never Stage-1-seeded (slice-1 gap, by design); (2) THE ORDERING
  SEAM — on a late-resolving doc (no template/logo match) Stage 2 runs with supplier=None and
  `_anchor_matches` cannot admit that supplier's OWN POSITIONAL anchors (only identity anchors ride the
  type-match branch — gary corrected the initial blind-drop theory: it's the FILTER), supplier resolves
  at 2.5a but anchors never re-ran — so teaching was ignored exactly where it matters most; (3) the 3
  pre-geometry-fix CUSTOMER anchors carry GARBLED labels ('ie), Oo Sp' slips labelLooksSuspicious — all
  tokens <4 alpha). Hints correctly skip multi-valued customer (variability guard, unchanged).
- **Fix A — free-text seeding** (`keyword.seed_field_labels` party branch, kill switch
  `SEED_FREE_TEXT_ENABLED`): a custom text field seeds its OWN DB label only (len≥3, SAME-TYPE sibling
  label dedupe so customer_name+customer on one type can't double-fill; global bank alone never blocks),
  base 75 (< ref/date's 80 < the 88 floor, > the 70 review threshold), method plain 'keyword',
  role_caption='party' arming reggie's guards in `_search_for_label`: G1 `_party_caption_conflict`
  (follow-word stop: ref/no/order/po/copy/signature/services… — "Customer Ref 4118"/"CUSTOMER COPY"
  never fill; 4-space column break after the label = another column's caption, NOT a conflict), G2
  compound-tail ("Customer / Site" remainder never a value), G3 `_is_caption_fragment` (a candidate
  VALUE that is itself a caption fragment — "Reference No.", bare "Name" — is skipped; fixes the
  COLUMN-INTERLEAVE where the line after 'Site / Customer' in reading order is the ref row and the true
  value 'Formby & Sons' is one further). Shipped patterns byte-identical (party-gated).
- **Fix B — Stage 2.6 LATE-ANCHOR RESCUE** (`engine.py`, kill switch `LATE_ANCHOR_RESCUE_ENABLED`,
  pure gate `_late_rescue_applicable` + `anchor.anchor_admissible` public wrapper): when the supplier
  was UNRESOLVED at Stage-2 time and is plausibly resolved after (2.5a text scan, or the post-Stage-2
  promotion of a Stage-1 keyword identity — same seam), re-run anchor extraction over the DELTA OF
  ADMISSION (admissible under resolved supplier, NOT under None) = provably ONLY that supplier's own
  named positional anchors (identity/global already admitted; foreign fails both) → can never re-admit
  the 2026-07-09-banned cross-supplier positional reads. FILL-EMPTY-ONLY, conf ≤ _LATE_RESCUE_CAP 85
  (the text-scan premise's own cap; < 88 critical floor), blind reads keep anchor.py's 50 cap → review;
  method string untouched + `late_rescue` marker. Stage-0-resolved docs byte-identical (gate).
  Post-rescue the 3 garbled anchors self-serve as positional reads @50 → NO cleanup migration (gary D3:
  blanking ≡ same path; re-teach per scope upgrades to located reads — saveAnchor sweep is
  SUPPLIER-scoped, learning.js:434, contra the older "across all suppliers" note above).
- **Oracle verdict: SIGN OFF WITH CONDITIONS (all code conditions APPLIED + re-tested)**: C2 the
  "75 keeps the doc off exactly-100" rationale was FALSE (optional fields often UNCOUNTED in
  overall_confidence; a counted-EMPTY field scored 0, so a fill RAISES overall — the real rails are the
  at-100 freetext-skip class + review routing + the 88 critical floor; comment corrected); C3
  `_PARTY_FOLLOW_STOP` += site/address/tel/telephone/phone/fax/email/mobile/web/website ("Customer Site
  Address" now fail-empty); C4 rescue delta tightened to SAME-TYPE anchors (legacy NULL-type rows out),
  the A-over-B PRECEDENCE INVERSION named in the Stage-2.6 comment (a seeded keyword@75 fill excludes
  the field from the delta, so on late docs a ⊕ teach can't displace a wrong seeded read until the
  supplier gains a template/logo — fails toward review; follow-up option documented), gate docstring
  widened (any results['supplier_name'] promotion arms it). C1 PENDING: read the corpus REPORT incl.
  at-100/auto-file churn (filled fields LIFT overall — check no doc newly crosses into auto-file with a
  wrong seeded/rescued value). C5: state plainly whether corpus GT covers custom `customer`.
- **E2E on the real doc**: seeded path `customer='Formby & Sons' @75 keyword` (overall 82 → review);
  rescue path (seeding off) `@50 anchor_crop late_rescue` → review. Tests:
  `test_custom_field_seeding.py` (slice-1 "customer NOT seeded" pin DELIBERATELY flipped; full G1/G2/G3
  battery + T-real interleave + dedupe + kill switch) + NEW `test_late_anchor_rescue.py` (delta
  invariants, fill-empty-only, caps, gate pins, kill switch). All 8 anchor/identity/guard/rescue suites
  green. **Corpus gate (C1) RESULT**: corpus 1838→2098 (tonight's confirms); regressions 30/25-silent
  = BASELINE-IDENTICAL (zero new); per-field supplier 99.8%→99.8%, ref 99.2%→99.2%, date 99.4%→99.6%
  (improved); no auto-file churn (96.6%→96.5%). **M=4 — ALL PROVEN NON-CAUSAL** (per-doc kill-switch
  A/B: ON==OFF byte-identical): a PRE-EXISTING weakness surfaced by NEW DATA — Cloudpeak Systems
  (first confirmed TODAY), invoices carrying BOTH an invoice# and a PO#, scanned-digit misreads at 95
  keyword conf (> the 88 floor) → #2068/70/74/82 would-auto-file wrong ref; #2074's GT itself looks
  mis-confirmed ('PO755' vs printed '1947063' — the #404 class). ⚠ OPEN FOLLOW-UP (not this change):
  triage tonight's Cloudpeak confirms (Learning Repair / re-confirm) + a reggie pass on the
  invoice#-vs-PO# candidate ambiguity; until then a future Cloudpeak invoice CAN auto-file a wrong ref
  (pre-existing exposure). C5 (honesty): the harness scores supplier/ref/date/total ONLY — `customer`
  is NOT corpus-scored; the seeded field's accuracy evidence = the MP_wor_48 E2E (both paths, correct
  value, review-bound) + the unit battery + review routing.

### 2026-07-10 EVENING (UNCOMMITTED at handover — details/conditions in the EVENING handover)
- **Focus REVISED**: the systemic cure's `pageHasFocus===false` OR-fallback made `blurWebView` (the app's
  ONLY page-focus dropper) fire on ~half of clicks → SELF-PERPETUATED the desync ("broken everywhere").
  Now SUSPECT-ONLY (armed: native dialog / post-Confirm / runZoneOcr draw); the preload `focusin`
  secondary from `4d2de72` is REVERTED. Child-window-close arm SHIPPED NIGHT++ (see below, with
  the focusOnWebView restore half that made it safe). `test_focus_repair.js`.
- **RC2 UNLINK (migrations 44+45)**: `COMPANY_KEYS=['supplier_name']` — customer_name is an ordinary
  OPTIONAL recipient field everywhere; 44 reshapes existing types (SCHEMA-ONLY), 45 purges stale
  issuer-as-customer hints/anchors (keeps legit recipients); review renderer decoupled (6 ISSUER_KEYS
  sites). `test_migration_customer_unlink.js` + `test_migration_customer_hint_cleanup.js`.
- **Reprocess keeps the template** (`process_docs.py`): the machine-authority override no longer clears
  `_kt`; an `authoritative` guard stops a resurrected template re-asserting its stale type.
- **Template RESCUE** (`template_matcher.py`): a drifted-logo doc still matches its own SAME-TYPE template
  on ≥0.80 keyword-branding overlap + logo band ≤20 → `keywords+slug_rescue` @60 (Meridian 3-fragment case).
- **`region.py _strip_horizontal_rules`**: gated underline/rule removal before the light rung (underlined
  captions garbled at the 108-DPI teach preview). **`po_number`** labels: + "P/O …"/"P.O. …" forms.
  ⚠ **SUPERSEDED DIAGNOSIS (2026-07-10 late evening)** — the LIVE garble ("eee F WS CwE ewe") was NOT
  underline fusion: the ⊕ ABOVE-strip (one value-box height) CLIPPED the caption to its bottom 2-4px
  (line spacing > box height) and OCR HALLUCINATED words from the sliver. THREE-LAYER FIX, oscar-vetted,
  proven on MP_wor_47 + 4 more docs/2 suppliers (probe: true captions 2→8, empties 3→0): (1) GEOMETRY —
  above band = 2.5 line-heights (floor 34px) with a 0.1h bottom STANDOFF, BOTH surfaces (review
  captureAnchorContext + teach autoLabel, teach floor 0.028 page-height); shared `nearestAboveRow`
  (anchorLabel.js) keeps only the BOTTOM word-row so the taller band can't re-glue two lines;
  (2) `region.py` SLIVER GATE `_looks_unreadable_sliver` (ink band <5px pre-upscale → EMPTY, all
  draw-tool callers incl. /v1 targeting-OCR — fail toward "no label", never junk); (3) UX — a
  suspicious/garbled caption is NEVER DISPLAYED (review readout + teach wizard show "couldn't read the
  caption — position remembered", empty editable input; junk dropped on advance). ALSO FIXED:
  _strip_horizontal_rules erased BOX BORDERS (edge-hugging full-width lines) which flipped
  test_region_light_first's bordered crop read "Serial number"→EMPTY — now skips edge bands
  (top/bottom 6%). Dashed-underline eraser DELIBERATELY DEFERRED (geometry solves it; bridging dash
  gaps risks erasing text rows — oscar's safe row-profile recipe is in the 07-10 oscar consult if ever
  needed; pinned in test_strip_rules.py). Tests: `test_region_sliver.py` + `test_strip_rules.py` (NOW
  EXISTS — was claimed but missing) + `test_anchor_label.js` §nearestAboveRow; light_first back GREEN.
- Corpus gate: batch corpus-NEUTRAL, **M=0 held**; `GATE=1` exits 1 on the PRE-EXISTING 21-silent class —
  read the report file, not the exit code. Final Oracle vet of the template/rescue/PO fixes crashed
  (transient API) — **re-run before commit+build**.
- **Migration 43 stamped** (`database/index.js`) — `document_types.title_aliases` only ever landed on
  FRESH DBs (safeAdd sat in the stamped migration-2 block); existing installs stayed at v42. Now a
  proper stamped migration 43. `test_document_types_aliases.js` pins the stamped-v42 case.
- **Reprocess type-authority override** (`process_docs.resolve_assigned_type_authority`, handler manifest):
  a MACHINE-assigned doc type (never human-confirmed) may be re-typed on reprocess by the doc's OWN
  TRUSTED standalone title; a human-confirmed type is NEVER overridden; clipped scans keep the pin;
  `--known-doc-slug-authority machine` passed only for never-confirmed docs; flip drops stale wrong-type
  extraction rows + plants a load-bearing review note (blocks auto-file). Fixed the "keeps applying Sales
  Order on reprocess" report. Coherent (detected_slug,title_trusted) pair. `test_reprocess_type_flip.py/.js`.
- **Recipient-caption issuer guard** (`engine._flag_recipient_caption_issuer`): a plain 'keyword' read of a
  customer_name-IDENTITY field (shipped label bank is all recipient captions) is capped 69 + noted (never
  rewritten) — a sales-order BUYER name can't silently fill the Document Issuer. Exempts learned/taught/
  manual methods + accept allowlists + both-key types. `test_issuer_caption_guard.py`.
- **Identity rescue slice 1** (`engine._rescue_identity_from_scope`, kill-switch `IDENTITY_RESCUE_ENABLED`):
  on a customer_name-identity type, when the incumbent issuer read is QUALITY-FAILED junk AND the supplier
  scope resolved STRUCTURALLY (logo/template) AND a same-scope confirmed hint (usage≥2, guarded by
  `_apply_hints`) AGREES with it, REPLACE the junk with the confirmed issuer at conf 69 + provenance note
  (review by construction, never silent). Fixed "issuer says SO #". Structural-origin is by METHOD (the
  field VALUE may be format-withheld). `test_identity_rescue.py` (37 checks + real E2E). Slice 2
  (graduate past review) DESIGNED, NOT Oracle-signed, NOT built. supplier_name-identity types NOT covered
  (Fix A below solved the PO case via the logo).
- **Supplier "Ref" label guard** (`keyword._identity_ref_caption`, mirrors `_total_role_collision`): a bare
  "Supplier"/"Vendor"/"Seller" caption followed by a reference word (Ref/Reference/No/Number/Code/ID/VAT/
  Account) or '#' is a BUYER-side reference caption, NOT the issuer — skip it; a real "Supplier: Acme" still
  reads. Removing the "Ref" junk lets the LOGO win (@96). `test_keyword_label_guard.py` §1e.
- **Confirm-upsert** (`learning.saveCorrections`): a value TYPED into a field the engine never read had NO
  extraction row, so the reflect-back UPDATE was a no-op and the value lived only in `corrections` —
  invisible to every learning reader (all select FROM extractions), to search, and on reopen ("worksheets
  no longer learning values"). Now inserts a `manual` extraction row (conf 100, corrected_to NULL). Born at
  CONFIRM time so no auto-file path reads it. `test_save_corrections.js`.
- **getAllHints (uncapped training)** (`learning.getAllHints`): `buildTrainingArgs` used bare `getHints(db)`
  whose default LIMIT 100 (usage DESC) STARVED the engine of every new supplier's usage-1/2 hints once the
  corpus passed 100 rows. Training now uncapped (scoped/display callers keep the cap). `test_getallhints.js`.
- **Position-only issuer teach** (renderer + `learning.saveAnchor`): a ⊕ issuer teach with no printed caption
  now saves an EMPTY label (position-only), never the field DISPLAY name ("Document Issuer") — a phantom
  label the anchor engine silently dropped ("my teach never sticks"). saveAnchor also drops a label equal to
  the field's display label (unless OCR'd from the page). `test_anchor_phantom_display_label.js`.
- **SYSTEMIC keyboard-focus cure** (`src/preload.js` pointerdown + `src/main.js` runEnsureFocus +
  `src/lib/focusRepair.js`): ONE central heal at the universal text-field pointerdown chokepoint fixes the
  render-widget desync (page-focus lost while the window still claims focus) regardless of trigger (Confirm/
  draw/Learning-History all showed identical `pageHasFocus=false`). In the desynced state only: pre-focus the
  pressed control SYNCHRONOUSLY (so SetPageFocus restores focus to IT not <body>) → `invoke` the repair
  (ordered, not fire-and-forget send) → double-rAF re-assert → one-shot blind-spot re-issue. Healthy clicks
  byte-identical; <select> excluded; the two pinned regressions hold (no win.blur/focus; no win.on('blur')
  suspect). Per-site confirm(suspect)+draw(proactive) fixes stay as belt-and-braces. NEEDS A RESTART.
  `test_focus_repair.js`. ⚠ **REVISED 2026-07-10 (the systemic-cure build was net-broken "everywhere"):**
  the blanket `pageHasFocus===false` OR-fallback in `focusRepair.js` was REMOVED — it fired `blurWebView`
  (the ONLY page-focus dropper in the app) off a CAPTURE-phase at-rest `document.hasFocus()` read on ~half of
  clicks, so it SELF-PERPETUATED the desync (telemetry: false in runs of 5-7 consecutive). `blurWebView` now
  fires ONLY on an ARMED `__focusSuspect` trigger (native dialog / post-Confirm / draw-OCR — each arms it);
  the additive `focusin` secondary was reverted. So the heal covers ARMED triggers — NOT "regardless of
  trigger"; a non-armed desync (child-window close, keyboard-Tab-only) falls through to the recoverable
  click-out-and-back dead caret (fail-safe — never a wrong value). Arming child-window-close is a fast-follow.

## Working rules (read before any fix)

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
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router — thin, delegates to modules
│   ├── preload.js                       # contextBridge API bridge
│   ├── modules/
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND 100% AUTO-FILE (_maybeAutoFile/_autoFileDoc, hooked in _handleFileMessage): a fully-typed, un-flagged, overall_confidence===100 doc files itself the moment it's processed — MANUAL import + WATCH folder + background alike (window need not be open), reusing filing.commitDocument + documents.confirm, gated by auto_file_full_confidence; records ids in a rolling `recent_auto_filed` setting; emits 'doc-auto-filed'. (Reprocess-All keeps the renderer-side review.autoCommitFullConfidence.) CONFIGURABLE THRESHOLD (2026-07, `auto_file_threshold` setting, default 100 = full-confidence-only, Settings → Processing slider 80-100): a doc auto-files when overall_confidence ≥ the threshold. The type + un-flagged gate is the real safety — BELOW 100 the backend ALSO requires `needs_review` false (fully typed, no field flagged), and the renderer bulk path keeps its `!review_flag_count` filter — so lowering the slider only lets a clean, confident doc skip Review, never a flagged one. Pairs with the "confidence grows with learning" boosts: a regular supplier's reads climb toward ~98%, so a user who sees perfect docs at 98% can set the slider to 98 and have them auto-file.
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced→"View learning history" (get-field-value-history / purge-field-value / rename-field-value, admin/edit, audited) → learning.getFieldValueHistory/purgeFieldValue/renameFieldValue: list the confirmed values learned for a (supplier,doctype,field) scope (same final values getFieldFormats samples); PURGE a value that shouldn't exist (e.g. a "Booking" drift artifact) from extractions+corrections+supplier_hints so it stops polluting the learned shape; RENAME a value (oldValue→newValue across extractions+corrections, drops the stale hint) to fix an OCR slip ("$O2"→"SO2"). Review toolbar ⚙ Advanced button → flyout → sortable modal (click a heading to sort). Modal is NON-blocking (no backdrop, positioned left): the right fields pane stays lit + clickable and clicking a field LIVE-RELOADS the table for that field (focusin→loadLearningHistoryFor, active field highlighted .lh-active-field). Per-row 📄 "docs" toggle = learning.getDocumentsForFieldValue (get-documents-for-field-value IPC, admin/edit, read-only): reveals the CONFIRMED source documents that carry that learned value (same scope + final-value expression getFieldValueHistory groups by), each with an "Open in Review" button → renderer `_navigateToDoc(id)` loads the FILED doc in-place for re-checking (Edit-in-place, status stays confirmed; the allowRefile path re-files on confirm — so a bad learned value like "$4" can be traced to its docs + corrected). Per-row ✎ inline-edit (rename) + 🗑 delete-confirm; "Fix likely slips" button = renderer computeSlipFixes: a value differing from a ≥80% per-position column consensus at exactly ONE char that's a likely OCR slip (_likelySlip: a symbol where alnum expected, or a known confusion $↔S/0↔O/1↔I…) and whose corrected form matches the dominant shape or an existing value → proposes old→new, applies on confirm via renameFieldValue. Guarded by database/modules/test_field_value_history.js
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer — browse/pin samples, anchor→target mapping CRUD; Learning Recovery reassign (link-only, reversible) + MERGE (templates.mergeInto: fold a fragment's doc-links/missing-mappings/fields/landmarks/sample/identity into a canonical row, sum confirmed_count, delete source — IRREVERSIBLE; the cure for near-duplicate "same logo, drifted phash" template fragmentation). Guarded by database/modules/test_template_merge.js
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core (see Detached search client). presenceService = the "Currently being reviewed by <name>" signal: an in-memory Map<docId,Map<viewerKey,{username,displayName,lastSeen}>> SHARED SINGLETON (shared()) the desktop + /v1 API both publish to; TTL ~60s self-expires a crashed/disconnected viewer; ADVISORY ONLY (the atomic confirm is the authority, so stale presence can't cause a wrong outcome). heartbeat/release/releaseAll/viewers(excludeSelf). Guarded by src/services/test_presence.js. reviewService = createReviewService({deps}) → queue/deferred/counts/confirm/defer/restore, shared by the desktop IPC + (Phase 3) the /v1 client API; explicit actor {username,role} (auth+workflow-lock enforced at the edge). CONFIRM CLAIMS the doc atomically (documents.confirmIfReviewable) BEFORE filing so two confirms can't both file it (loser → ALREADY_FILED w/ the winner's name); re-file (already-confirmed) skips the claim — but ONLY when the caller passes an explicit `payload.allowRefile` intent (desktop renderer sets it ONLY when the doc was opened while ALREADY confirmed = "Edit in Review"; the /v1 client NEVER sets it, server-decided). Without that intent a confirm that RACED from the review QUEUE into an already-filed doc runs the atomic claim and loses cleanly (ALREADY_FILED), instead of the old last-writer-wins SILENT OVERWRITE of reviewer #1 (2026-06-30 audit finding; `documents.confirmIfReviewable` carries an unused `allowRefile` CAS branch, but reviewService gates the claim-SKIP on intent rather than routing through it — a claim-before-file would null the existing stored_path). CENTRAL DATE NORMALISATION (2026-07): confirm normalises every DATE-typed field's value (doc-type `date_field_key` + any type='date' field) to the core's canonical DD-MM-YYYY ONCE, via filing.normaliseDate (the same parseDate/formatDate the filename builder uses), BEFORE both filing and learning.saveCorrections — so whatever a client (desktop or /v1) submits ("Aug 03 2012", "2012-08-03", "3/8/2012") the STORED value, the FILENAME and the LEARNING corpus all agree, and no client re-implements date parsing (the "corrected date in the client isn't in the core's format" fix). Unparseable values are left as typed (never dropped). Electron-only steps (source-move, landmark capture, taught-confirm promote, count broadcast) are INJECTED hooks → desktop path byte-identical. SNAPPIER CONFIRM (2026-07-09): the best-effort learning hooks captureSample + onTaughtConfirm (each SPAWNS a Python landmark subprocess — the bulk of the felt Confirm→next-doc pause) are now DETACHED (fire-and-forget AFTER all persistence + notifyCounts), so confirm RETURNS immediately; confirmReview STAYS awaited so the atomic claim + fail-toward-review hold (the Oracle ruled a full-optimistic renderer WRONG LAYER — it would open a silently-gone-doc hole). releaseDelayMs dropped to 0; the renderer backgrounds the logo save. Pinned so a re-added `await` can't re-freeze the UI. Guarded by src/services/test_reviewservice.js + database/modules/test_documents_cas.js
│   └── windows/
│       ├── main/{index.html,renderer.js}      # DASHBOARD + NAV RAIL (2026-06-28 redesign, replaced the launchpad). LEFT RAIL = single nav: Home · Import · Review(badge) · Search · Teach · Settings + a rail CLOCK (time large/date small) + "Local only" + a Dark-mode quick toggle at the very foot. CONTENT = a view-router (showView 'home'|'import'); Review/Search/Teach/Settings still open as their own maximised child windows. HOME = attention-led dashboard in ONE auto-fit card grid (repeat(auto-fit,minmax(260px,1fr)) → no empty cells; full-width banners use .dash-span); content column centred + width-capped (clamp(1100px,92vw,1320px)). Cards: Needs-your-attention (review+deferred+stuck counts → Open Review, or "all caught up"); Documents-filed pulse (today/week/month from confirmed_at); Import quick-start; Auto-import (watch status + on/off switch + pick-folder, admin-only); Getting-smarter (suppliers+layouts learned); Where-your-files-go (output folder + Open folder via the open-folder IPC); trial banner (licenseGetDiagnostics, "N of 14 days", calm/warn/crit); first-run setup checklist (auto-hides); Recent activity (recent confirmed; refreshes live on confirm via refreshDashboardIfHome). updateAttention() is the CHEAP count-event repaint; refreshDashboard() (the searchDocuments query) runs on load / Home-open only. IMPORT VIEW = folder picker + Process/Stop + session stats + live results table (Company/Date/Reference/Status) + progress strip; "Filed"/"Needs review" rows open THAT doc via openReviewWindowAt(db_id). Processing text shows "Multi-page document (N pages)" via the file_pages event. Reprocess-All progress is a BANNER (review window). CARD SET EXPANDED + CUSTOMISABLE (2026-06-30): two-tier grid — TOP (Quick find · Needs-attention · Documents-filed · Filed-automatically=auto-file % · Getting-smarter · Did-you-know tips · Recent-activity) + FILES & FOLDERS (Auto-import · Import · Where-your-files-go · Storage=free disk via fs.statfsSync · Backup=last-backup-at · Search-clients); the data cards are fed by the `get-dashboard-extra` IPC. Each card is individually toggleable in Settings → **Appearance → Home screen** (`dashboard_hidden_cards` JSON array of card ids → `applyDashboardCardPrefs` toggles `.card-hidden`; `dashboard-cards-changed` broadcast repaints live). The FIRST-RUN DEFAULT hides Quick find/Filed automatically/Storage/Backup/Search clients (seeded in `onboarding-complete`, unset-only — see First-run wizard). DRAG-TO-REORDER (2026-07): grab a card's `.dash-card-head` to move it WITHIN its section grid — the others FLIP-dock smoothly around the drop (a fixed floating card follows the cursor over a `.dash-ph` placeholder that holds the slot). Cards can't cross sections (the drop-target search is scoped to the drag's own grid). Only the multi-card grids carry `data-grid` ("top", "files") and are sortable; the recent banner grid is not. Order persists per section in `localStorage['dashboard_card_order']` ({grid→[ids]}) and is re-applied on load via applyDashCardOrder (SAME-window UI pref, so localStorage not a DB setting). Header handles are delegated on the grid so they survive card content refreshes.
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC; "Show where it reads" overlays (amber) the RESOLVED anchor/target on the current page via test-template-mapping → template_mapper.resolve_geometry (so the operator sees the mapping TRACK a shifted scan, vs the static drawn boxes). FIXED-VALUE MODE is a segmented pill ("Read it from the document" / "Always use the same value"), wording mirrored in Settings → Template Manager. ⊕ teach shows a post-draw READOUT BAR (detected label + value + [← Left]/[↑ Above] direction toggle — see Stage 2 "⊕ AUTO-ANCHOR LABEL SEARCH"). THREE teaching surfaces framed by ROLE so they're legible to non-technical users: Fix a field (⊕) · Teach a document (teach wizard) · Fine-tune a layout (Template Wizard, advanced fallback) — see Help "Which should I use?" (help/templates.html #which-tool). "TEACH THIS DOCUMENT" CTA (2026-06-28, renderTeachCta, centred above the preview): shown ONLY for a genuinely-unseen doc — HIDDEN when a template matched (template_id), when the recheck finds a drifted template (`_templateRecheck.matched` — reprocess fixes it, no action), or when ANY field was read by a learned method (keyword/keyword_override/anchor/template_mapping); a recognised sender (logo/keyword) gets a one-time confirm. Launches the Teach wizard at the doc (skips doc-selection). A `doc-types-changed` broadcast (settings/handler on type create/add/presets) refreshes the Review type dropdown + Settings list + main results-table key map live (preload `onDocTypesChanged`).
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card concepts carousel; owned child of main, reopenable from user menu) — see First-run wizard. LAST-CARD FORK (2026-07): primary "Try a practice run" (→ welcomeDone('practice') → main opens the tutorial AFTER welcome closes so it parents to the shell, not the closing tour) + secondary "Import my documents".
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED beginner "practice run" (2026-07) — Import→Review→teach→Confirm over 3 bundled watermarked sample docs, ENTIRELY in-renderer over pre-baked fixtures. NO real DB/learning/output touched (structural isolation — no wired write path; per bob+eric). Reuses the real Review UI look. DRAW-A-BOX TEACH SIM: arm a field → drag a box round its value on the HTML-rendered doc → it "reads" the value in (mirrors the ⊕ target tool; the low field on doc 2 must be taught to proceed) — pure simulation, not real OCR. Only disk side-effect: `tutorial-file-sample` copies a bundled PDF into %TEMP%/scanfinder-practice for the "before→after filing" reveal (`tutorial-open-folder` opens it directly — the generic open-folder guard blocks TEMP; wiped on window close + before-quit). Backend: src/modules/tutorial/handler.js. Entry points: welcome-tour fork + Home "Practice run" card (dash-practice, toggleable + draggable) + user-menu "Try a practice run"; `practice_run_completed` softens the card copy once done. Samples ship via extraResources; .gitattributes pins *.pdf binary (autocrlf would corrupt the xref).
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
│       └── trust.js                    # supplier GRADUATION / safe eventual auto-file: a (supplier,doc-type) scope earns a 95 auto-file floor (TRUSTED_FLOOR; lowered from 98 in 2026-07 — clean template_fixed/anchor learned reads genuinely PLATEAU at 95-97, so a 98 floor sat just ABOVE where graduated suppliers actually land and never fired; the numeric floor is a coarse gate, docTrustGate is the real safety) after W=10 CLEAN confirmations. isAutoFileEligible = the ONE predicate BOTH auto-file sites share (backend _autoFileDoc/_maybeAutoFile + renderer via get-auto-file-eligible), gated per-doc by a STRUCTURAL safety gate (docTrustGate) in TWO regimes: sub-100 (a graduated discount read) gets the FULL gate (template + EVERY valued field verifiable); at 100 (Slice 7, `opts.at100`) gets a LENIENT gate — NO template requirement + skips a genuinely-unverifiable field (freetext / no-history / ambiguous 'constant' shape), so a legit variable free-text field (per-doc customer name) + logo-only 100% suppliers still auto-file, BUT a deterministically-invalid strict value (bad calendar date / checksum-failing IBAN·VAT / dropped-decimal total) OR a value violating a STRUCTURED learned shape (a code field learned as xxxx-xxxx-x reading the word "Information") is now blocked at 100 too (the old gate-free path let it through). Verified: 0 regression on 289 live 100% docs. scopeTrust/docTrustGate/classifyLearnedShape/validDate/validIban(mod-97)/validVatGb/currencyDpConsistent (a 0-dp total against an all-2-dp learned history = dropped-decimal 100× error → blocked; #9/reggie T4)/matchesTypePattern (a STRICT-typed value must also match its SHARED config validation_pattern at the gate, not just lack a note — #9/reggie T5; each strict type routed once: date=calendar, iban/vat=checksum, currency=dp, others=shared regex, no-pattern types like 'number' stay trusted); STRICT_TYPES excludes 'alphanumeric'; master switch supplier_graduation_enabled + per-scope graduation_optout; listGraduatedScopes feeds the Settings roster. Guarded by database/modules/test_scope_trust.js + the real-doc soundness gate in stress_test/realdoc_regression.js (M=0 = no would-auto-file-a-wrong-value)
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see Extraction pipeline below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding (same-logo siblings disambiguated by keyword fingerprint, THEN by the doc's own detected TITLE — see identify_template detected_slug/title_trusted below)
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read → inline-harvest/relocate off the located label (label_box) → registration fallback
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction (same-length char subs) + Stage 2.5d DOMINANT-VALUE SNAP (reggie, 2026-07): count-weighted — snaps a code read to its DOMINANT confirmed literal (≥5 count AND ≥80% share) when it matches after collapsing internal whitespace (branch A, zero-risk) or ONE known OCR-confusion substitution (branch B, kill-switch SNAP_ALLOW_SUBSTITUTION). Fixes what try_correct can't: an inserted SPACE ("1 102V03NL1"→"1102V03NL1") + a slip on a field whose consensus template was POLLUTED by a mis-confirmed artifact (derive_template is count-blind, so a 31× canonical was drowned by a 1× "11O2…"). Skips name fields + fixed/override reads + a read already equal to a confirmed value; variable fields self-exclude. build_dominant_index/lookup_dominant/snap_to_dominant; guarded by tests/test_dominant_snap.py
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js. is_name_like_field EXCLUDES technical addresses (mac/ip/hardware/network "address") — they are CODES, not names, so the name-quality/_name_field_code_reject gates must not strip their legitimate value ("D4:F0:C9:25:9B:64", "192.168.1.200"); else a labelled mac_address/ip_address anchor can never fill (the value's relocated read is rejected as "no real word")
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   │   └── identity_fusion.py           # text-led SUPPLIER identity (page chrome vs known-supplier gazetteer; rapidfuzz dual-gate). DORMANT/SHADOW: engine.extract(identity_shadow=True)→_shadow_identity() records resolved-vs-text_led agree/conflict, changes NOTHING (off by default = byte-identical). Measure via process_docs --identity-shadow (emits file_done.identity_shadow) / rich_field_runner. Sandbox 100% precision/0 silent-wrong; real-engine bounded run 0 false-conflict. Promotion (conflict→needs_review + add rapidfuzz to requirements + check-licenses allowlist) PENDING — see docs/handovers/HANDOVER_2026-07-07.md
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py FULL-PAGE OCR text is rebuilt from image_to_data word GEOMETRY (reconstruct_page_text, 2026-07, routed via ocr/engine.py TesseractEngine.read_page): Tesseract's page segmentation (plain image_to_string) treats a wide right-column gap as a COLUMN break, so a right-aligned totals block OCRs as two detached columns — labels ("Subtotal:"/"Total:") on their own lines, values ("$387.74") stranded elsewhere — and the line-based keyword matcher can't pair them, so total/subtotal read EMPTY on scanned pages (born-digital pages keep exact word positions and never hit this path). Words are grouped into VISUAL ROWS (y-centre band) so a label + its far-right value stay on ONE line; a wide intra-row x-gap emits a 4-space column break so keyword.py's existing column-split guard still separates genuine columns. Same recognised words as image_to_string — only their grouping into reading lines changes; falls back to image_to_string on any error (never reads worse). Took scanned subtotal/total from ~63% → 100% in a 400-doc bench with no regression. Guarded by tests/test_ocr_engine.py. region.py: interactive draw-tool zone-OCR (review ⊕ picker, Template Wizard read-back, Template Manager) + --boxes label-position capture; LIGHT-FIRST ladder mirroring anchor._crop_and_ocr (light greyscale+upscale-small-only read first, heavy autocontrast+sharpen only when light is EMPTY) so a drawn box reads the SAME as extraction and clean born-digital crops aren't mangled into junk ("Serial number"→"be_7"); MULTI-LINE AWARE (2026-06): a drawn box that covers a value WRAPPING onto 2+ lines (a work address "Beaumont Care Homes Ltd -"/"Jordanstown") is re-segmented with PSM 6 (block mode) after the ladder and rebuilt line-by-line (top→bottom, space-joined) — PSM 7 (single-line) won the ladder first and MANGLED a multi-line crop into one garbled line ("p sverablseti Care Homes Ltd -"); a single-line crop keeps the ladder text byte-identical; the PSM-6 data is computed once + reused by --boxes. Guarded by tests/test_region_light_first.py (multi-line case); landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
│   ├── logo/fingerprint.py
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD (osd.traineddata, Apache-2.0; bundled). detect_rotation(img)→CW° to upright (0 on low conf/failure/sparse — never guesses; conf≥2.0, OSD on a width-capped copy ~120 DPI). correct_image(img,r)=img.rotate(360-r) (PIL is CCW; pypdf is CW + additive → page.rotate(r) verbatim — the two opposite signs are PROVEN in tests/test_orientation.py; a wrong sign corrupts every doc). Integrated in tesseract.extract_text_and_images(auto_rotate, rotations_out): first import only (gated off under cached_text/reprocess), born-digital pages SKIPPED (upright). process_docs --auto-rotate emits file_done.page_rotations; processing/handler _rotateWorkingCopyIfNeeded runs pdf_rotate.py (pypdf in-place /Rotate, atomic .part→rename) on the inbox WORKING COPY before drain/auto-file, so the FILED copy + every reprocess inherit upright from one detection. Gated by auto_rotate_enabled (default ON; original is drained to Processed/ UNTOUCHED → mis-rotation recoverable). Settings → toggle.
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
```
document_types  — name, slug, built_in, ref_field_key, date_field_key,
                  title_aliases  ← migration 43 (JSON array TEXT, nullable): extra printed-title
                  phrases that ALSO detect this type (a supplier that prints "Work Sheet" for a
                  type named "Worksheet"). Folded into the type's NAME-keyed bucket in
                  keyword.detect_document_type (result stays the NAME → detected_slug/heading-trust
                  unchanged; NO aliases = byte-identical). Validated by document_types.normaliseTitleAliases
                  (hard-reject an alias == ANY existing type name; drop <3-char/numeric/over-long;
                  cap 20). Edited via the "Also appears as" chips in the shared doctype-editor. Guarded
                  by database/modules/test_document_types_aliases.js + tests/test_detect_type_aliases.py
fields          — document_type_id(FK), key, label, type, required, built_in
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number,
                  working_path  ← migration 17: app-managed import copy in
                  userData/inbox/<docId><ext>; preferred by preview/reprocess/
                  confirm so they don't depend on the source folder surviving
                  page_count  ← migration 37: captured at import; drives the Review
                  multi-page icon + the "Multi-page document" processing text. NULL
                  for pre-migration rows (no icon until reprocessed)
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count
                  HINTS FILL EMPTY FIELDS ONLY (engine._apply_hints, usage_count≥2,
                  conf=min(90,60+usage*5)). EVIDENCE-BASED VARIABILITY GUARD (2026-06): a
                  field with ≥2 DISTINCT confirmed values in-scope is variable IN FACT and is
                  SKIPPED — so a per-document free-text field (e.g. customer) never gets the
                  most-frequent past value stamped on a new doc when its anchor read nothing
                  ("McConnell Kelly Solicitors" onto a "Dunroamin Caravan Park" doc). The
                  schema is_variable flag only covered ref/date fields; this evidence check
                  mirrors review/handler.js _buildTemplateFields. Stable fields (one recurring
                  value) still benefit.
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x_norm, y_norm,
                  w_norm, h_norm, usage_count, confidence,
                  last_authoritative_at  ← migration 20: set on an EXPLICIT ⊕
                  re-teach. ⊕ TEACH PERSISTS ON COMMIT, NOT ON THE DRAW (review/
                  renderer.js, 2026-06): the drawn anchor is STAGED in `pendingAnchors`
                  (keyed by field, mirroring `corrections`) and only written by
                  saveFieldAnchor in confirmCurrentDoc after a successful confirm
                  (re-keyed to the confirmed supplier); an un-confirmed teach (skip/
                  defer/doc-change/reprocess) discards it, so an accidental wrong pick
                  leaves NO learned trace. The field VALUE still fills immediately;
                  only the learning is deferred. (Erase a committed mistake via
                  Settings → Learning Recovery → Clear anchors, scoped to supplier/
                  doctype; or just re-teach — authoritative sweeps the old.)
                  saveAnchor's authoritative branch TRUSTS the drawn
                  box outright (no tolerance/blend) and makes it the SINGLE
                  anchor for (field_key, document_type) by sweeping every other
                  row for that field+doctype ACROSS ALL SUPPLIERS — the doc-type
                  is the layout; a teach corrects the field for that layout, not
                  for one resolved supplier. anchor._filter_anchors then puts
                  authoritative anchors in their OWN bucket ahead of all passive
                  ones BEFORE supplier-priority, so an explicit teach can never
                  lose to a stale auto-learned anchor that merely happens to be
                  tagged to the supplier the template/logo resolved (the bug that
                  made re-teaching look broken); among teaches the most recent
                  wins. Passive auto-learn (no flag) still usage-weight-blends,
                  but with PER-AXIS tolerance (h sets the vertical threshold, not
                  max(w,h)) so a one-line correction isn't mistaken for jitter.
                  offset_dx_norm/offset_dy_norm  ← migration 21: drift-invariant
                  label→value vector captured on the ⊕ teach (see Stage 2 note).
                  NOTE: supplier_name is a LEARNING SCOPE key (resolved via
                  logo/template/optional field), never a required document field.
logo_fingerprints — supplier_name, phash, ahash, match_count
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf,  ← migration 22
                  page_number. 3-5 stable/unique/well-spread words auto-derived
                  from a template's sample page (ocr/landmarks.py); RE-located on
                  each incoming page to fit the Stage 0.5 registration transform
                  (registration.py). Additive/inert — a template with no rows uses
                  the existing anchor/offset path unchanged.
template_logo_hashes — template_id(FK cascade), phash, UNIQUE(template_id,phash)  ← migration 26
                  MULTI-REFERENCE logo identity: a template carries a SET of logo
                  phashes, not one. Per-scan DPI/enhance drift shifts a recomputed
                  phash double-digit Hamming, so a single frozen logo_phash made a
                  drifted same-supplier scan spawn a near-duplicate template. Stage 0
                  (_logo_candidates) and JS findByLogoHash now take the MIN distance
                  over the set (legacy fallback: [templates.logo_phash]); templates.
                  logo_phash stays the seed/primary. On confirm, templates.update
                  APPENDS the scan's hash when it's drifted-but-related (dist to
                  nearest ref in (2,13]); set capped at 8 (evict most-redundant
                  non-primary). _upsertTemplate reuses on a 7-13 "convergence" band
                  gated by same doc-type-slug + ≥0.60 keyword overlap, so the set
                  CONVERGES instead of fragmenting; the matcher accept gate stays ≤6.
                  mergeInto folds hash sets. Guarded by test_template_logo_hashes.js
                  + tests/test_logo_phashes_multiref.py.
settings        — key, value (key-value store; incl. registration_enabled —
                  default ON, gates the Stage 0.5 registration rung;
                  born_digital_enabled — default ON, gates PDF text-layer extraction;
                  name_wordness_flag — default ON, gates the free-text NAME wordness
                  review FLAG (handler.js buildTrainingArgs → process_docs --name-wordness
                  → engine.set_name_wordness): a supplier/customer read that doesn't read
                  like a name (document-chrome stoplist + ref-code bleed + char-trigram
                  garble via extraction/wordness.py, PLUS history-gated name_match
                  truncation/fragment flag + word_like self-calibration) is flagged for
                  review (note + conf≤70), NEVER rejected/rewritten. Inert without the
                  shipped extraction/data/char_trigrams.json. OPERATOR OVERRIDE (2026-07,
                  `accepted_name_values` settings JSON): a Review "✓ This name is correct"
                  button (on a wordness-flagged name field) → accept-name-value IPC →
                  learning.addAcceptedName adds the exact value to an allowlist fed to the
                  engine (buildTrainingArgs --accepted-names-file → engine.set_accepted_names);
                  a name in that set is EXEMPT from the wordness + truncation flags forever
                  (the cure for a legit acronym company like "Cloud VPS" whose "VPS" token
                  reads low on the char model). The button also clears the flag on the current
                  doc immediately. See test_harness/WORDNESS_NOTES.md;
                  first_run_completed — 'true' once the setup wizard finishes/skips
                  (migration 24 stamps it for already-configured installs so existing
                  users are never re-onboarded))
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← migration 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
users           — …, totp_secret, totp_enabled  ← migration 28 (detached-client MFA
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
(re-add = no-op); catalog types are `built_in=0` (fully removable). The two invoice
DIRECTIONS carry the correct company identity — **Purchase Invoice → `supplier_name`, Sales
Invoice → `customer_name`** — so filing/learning scope is right from the start. reggie-
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
- **Review queue** mirrors the Search results list: plain scroll + click (no arrow
  rail; ↑/↓ keys still cycle), and a **draggable splitter** makes the file column
  width adjustable (persisted in localStorage).

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

### ✅ RESOLVED (2026-07-09) — the 2026-07-08 real-doc harness RED was NOT a code regression. See `HANDOVER_2026-07-09.md`.
Isolated (baseline `main` vs branch on the SAME live DB): the RED was (1) ONE accidental AUTHORITATIVE
⊕ teach — `field_anchors` id=24, Cloud VPS `invoice_number`, label "Invoice" — which (per
`learning.saveAnchor`) swept every other supplier's invoice_number anchor AND bled cross-supplier,
false-locating on the generic caption "Invoice" to crop-read a wrong-but-valid neighbour (City Office
`1828987`@87), overriding the correct keyword read (`152567`@98); and (2) partly-POISONED test GT (user
mis-confirmed page-numbers/fragments while bug-hunting — #404 GT `22163`/`16-03-2026` but the doc's own
OCR+filename say `22162`/`03-06-2026`; #896 GT `1/2`; #962/#1012 GT `102`). `main` was actually WORSE on
safety (would-auto-file-wrong=25 vs the branch's 1). **True silent-wrong-auto-file = 0.** FIX SHIPPED
(branch `fix/autofile-critical-field-floor`): a filing-critical per-field confidence floor in
`trust.js` `isAutoFileEligible` (`critical_field_conf_floor`, default 88, 0=off) — a present ref/date
value must itself clear the floor to auto-file, at every floor incl. 100; HOLD-only, so it can't cause a
wrong auto-file; took would-auto-file-wrong 25→1 (the 1 = poisoned #404). The branch
`fix/ocr-multicol-precedence` (oscar grouping + reggie guard) is NOT the cause and is safe to build.
DAYTIME cause fix (reggie, not done — delicate): stop a NAMED cross-supplier authoritative read that
located only via a WEAK/generic caption from being auto-trusted as "same layout" in `anchor.py`
(`anchor_crop_relocated` is always `located_ok=True`, so it skips the cross-supplier guard). Cleanup:
Settings → Learning → Learning Recovery (clear the Cloud VPS anchor), or `py
stress_test/_clean_mistaught_anchor.py delete`.

### FIXED (residual noted) — cross-supplier POSITIONAL anchor bleed (2026-07-06)
A ⊕-taught AUTHORITATIVE anchor for a POSITIONAL field (e.g. `invoice_number`) was applied ACROSS
suppliers: `_anchor_matches` admits it on doc-type match, `_filter_anchors` ranks authoritative teaches
ahead of supplier-priority, and the read-stage guard was IDENTITY-ONLY — so Anconia's `INVOICE NUMBER`
anchor (pinned top-right) blind-read the top-left "Invoice To" on a City Office invoice (LATENT: masked
by the multi-method net until keyword doesn't fire). FIX (007-reviewed): the read-stage guard
`_is_blind_cross_supplier_anchor` (renamed from `_is_blind_cross_supplier_identity`, anchor.py) now
drops a BLIND (`not located_ok`) read from a NAMED different supplier for ANY field — a LOCATED read
(taught label found here → same layout) is still kept for every field (authoritative-wins holds), and
same-supplier / global-scoped anchors are kept (a global positional's fixed-position blind read is
intended). Key insight: `located_ok` (does the taught label appear on THIS page?) IS the per-read
"same layout?" signal, so no template-scoping was needed. Guarded by `test_identity_anchor_scope.py`;
A/B `realdoc_regression` 738 docs, 0 regressions, M=0, no per-field accuracy drop.
RESIDUAL (mostly closed 2026-07-06): the false-locate — a cross-supplier layout sharing the SAME
caption at a DIFFERENT position, so the rigid ABSOLUTE crop reads a wrong-but-valid value — is now
cross-read against the label's REAL inline value for FREE-TEXT/CURRENCY (the LABEL LOCK) and for
REF + DATE (the authoritative-crop cross-check, `anchor.py`, extended to dates with a calendar-aware
compare); on disagreement the located read wins + flags for review. Remaining sliver (low-severity): a
value printed BELOW its label (inline harvest empty) on a cross-supplier false-locate isn't cross-read
— needs the geometric `_place_from_located` path (the deferred "fixed-positioning-from-label" idea).


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

## Fast Mode suggestion
After confirming a doc, call `check-fast-mode-suggestion(supplierName)`.
If returns non-null, show toast: "Switch to Fast Mode? You've confirmed N docs
from [supplier]. Fast Mode processes instantly."
Buttons: "Switch to Fast Mode" → `set-processing-mode('fast')` | "Not now"

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
