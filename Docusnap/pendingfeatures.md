# Pending Features & Deferred Work

> Running backlog. When a feature/fix is discussed but NOT implemented right away, add it here with
> the notes/details agreed + anything pertinent (symptom, code pointers, the fix direction, gates,
> and any advisor rulings). Newest at top of each section. Remove an item when it ships (note the commit).

---

## UX / product

### ✓ DONE — Teach clipped-code reconcile, Slice 2 (the DRIFTED-sibling path)  (2026-07-31, `a4fa107`, ON)
- Slice 1 (`f2e5ee3`/`c70bae7`, `TEMPLATE_INLINE_CODE_RECONCILE`) fixed the FAST path; Slice 2 (`a4fa107`,
  `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT` default ON) extends the reconcile to the DRIFT/relocate path
  (`_geometric`). Routes through `_inline_code_reconcile` wholesale (robust page-wide source — Oracle SEND-BACK of
  the partial `located`-based version, which could DEGRADE a correct geometric read). Gate: `drift_forced_probe.py`
  10/10 + 0 degraded + 3 real drift-garble fixes; realdoc DRIFT==baseline; 4 drift unit/PIN. Memory
  `project_teach_inline_code_reconcile_20260731`.
- **Perf follow-up (optional, still open):** the reconcile does a page-wide locate per clean CODE read; it's `line_cache`-shared
  with the registration landmark fit (≈0 extra OCR on registration-enabled docs), but a doc with a taught code
  field and NO landmarks pays one fresh page-wide OCR. If profiling ever flags it, gate the cross-check on a cheap
  pre-signal (e.g. the local pre-pass `inline_value` disagreeing) before escalating to the page-wide locate.

### ✓ FIXED (pending owner smoke) — Teach wizard label non-recognition  (2026-07-30)
- **Root cause (frame-math bug):** `cropB64` sends the label band NATIVE (ds=1.0 under `TEACH_NATIVE_CROP`),
  but the label-detection code at `src/windows/teach/renderer.js:787/803` recomputed `ds=OCR_TARGET_H/bandHpx`
  (~0.42) WITHOUT honouring `TEACH_NATIVE_CROP` — so `cY` (the value centre fed to `nearestRowTo`) and the
  label word-box→page-norm conversion were scaled ~0.42× against words that are in NATIVE crop px →
  `nearestRowTo` looked in the wrong place → no row → "No label found here" even with the caption right beside
  the value (the Saltmarsh "Order Date" miss). FIX: both `ds` now `TEACH_NATIVE_CROP ? 1.0 : (…)`, frame-
  consistent with the crop. `nearestRowTo`/`nearestLeftCluster` then correctly narrow a wide band (heading +
  caption) to the caption row, so cause (2) is subsumed.
- **Smoke:** reopen Teach on the Saltmarsh PO → draw the Order Date value → "Order Date" should now be detected.
  If a residual remains on a badly-skewed scan (cause 3), look at the band slice next.

### ✓ SHIPPED — Teach wizard: only-current-box overlay + Straighten text button  (2026-07-30, owner)
- Overlay now draws ONLY the field being taught (removed the done-fields loop in `redrawCanvas`); the last
  box clears once the final field confirms (`advanceField` parks `fieldIndex` past the end → `curField()`
  undefined). Display-only — `state.results` untouched.
- The teach `∞` straighten control replaced with Review's icon + "Straighten" text button (`#tz-deskew`,
  auto-width; keeps the `.active` pressed style). `src/windows/teach/{renderer.js,index.html}`. Needs app reopen.

### Template Manager — Straighten button  (added 2026-07-30, owner)
- **Wanted:** a Straighten control in the Template Manager preview (same as Review/teach) so a tilted
  sample can be levelled before drawing/checking anchor→target boxes. `src/windows/settings/` (Template
  Viewer `#tpl-dock`) + reuse `get-page-deskew` + the AnchorLabel transform (as teach does).

### Template Manager — visualize + tighten anchor boxes  (added 2026-07-30, owner — EXPLORE)
- **Owner questions (answered inline in chat 2026-07-30):** do TM-drawn boxes validate on import? what is
  the TM for? should the drawn zones be VISIBLE on a doc (like Review's "show where it reads") so the user
  sees where the system snaps? what settings tighten a frequently-misfiring box?
- **Direction to design:** (1) a "show where it reads" overlay in the TM preview (reuse the Review overlay
  path + `template_mapper` located-zone output); (2) per-mapping tightness controls (padding/expansion,
  registration on/off, label-lock strictness, absolute-vs-relocate) surfaced per field; (3) a per-box
  test-on-this-sample readout (already partly in `recordMappingTest`). See the chat exploration for the
  full write-up + the FACT-checked answers on how mappings/anchors are actually used at extraction.

### ✓ SHIPPED — Import "couldn't be read" banner: details + dismiss  (2026-07-30)
The amber Import banner now (1) reworded "held for retry (not filed, not lost)"; (2) a **Details** toggle
lists each held doc + WHY (`documents.error_message`, via the existing `getStuckDocs`); (3) a **dismiss (×)**
per-session acknowledge that re-surfaces only when MORE docs fail (`_stuckDismissedAt`). Renderer + markup +
CSS only (`src/windows/main/{renderer.js,index.html}`); errored docs still hold at `status='error'` (never
lost) — dismiss is display-only. Needs an app reopen to render.

---

## UX / product (continued)

### Catch-up filing ("file the rest") — DESIGN SIGNED OFF 2026-07-31, NOT BUILT
- Owner idea: after K same-scope manual confirms, remaining queue docs (correct values, stale
  scores) re-gate against the warmer learning and batch-file behind a per-scope consent
  banner+list with per-doc untick. barry (L3, near top of office backlog) → gary (two-tier
  predicate: free re-gate + imageless consistency re-score; memory-held; files STORED rows via
  reviewService.confirm bulk) → **Oracle SIGN-OFF-W/COND** with two rulings (sweep confirms
  EXCLUDED from graduation via new `confirmed_via` column, values-learning flows;
  banner-consent v1, silent File-All absorption rejected) and two seams both advisors missed
  (corrections-SPAN revocation so human-only windows don't disarm self-revocation; candidacy
  extractions FINGERPRINT so consent can't go stale). **Full agreed design + build slices:
  `docs/designs/CATCHUP_FILING_2026-07-31.md`.** Build in a fresh session, slice 1 first
  (migration + scopeTrust rework — feature-independent).

## Extraction / accuracy

### Cross-contamination residual — Stage-2 `_qualify_against_format` — DO-NOTHING (gary+Oracle, 2026-07-30)
- **Resolved understanding (Oracle traced it):** the Stage-4.5 fix (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default
  ON, engine.py:4421/4631) closes the keyword/rigid path. The feared Stage-2 `anchor_crop` null is **largely
  already handled**: `method='anchor_crop'` is set at `anchor.py:586` only AFTER passing `_qualify_against_format`
  at `582`; a clean stranger crop is nulled at **582** (the ENTRY to the relocate/registration recovery chain),
  and the located case is **already resurrected** at `anchor.py:1102-1104`/`1175-1177` by the same
  `_digit_free_on_digit_field`/`_partial_of_uniform_shape` predicates (flagged at Stage 4.5). So `anchor_crop`
  is NOT the danger the earlier note claimed.
- **The genuine residual is a NARROW sliver:** `method='anchor'` text-fallback (+`anchor_crop_recovered`) —
  label readable as a text line but NOT locatable as a box, relocate/registration failed, field `_xsupplier`.
- **Why DO-NOTHING (gary designed a fix; Oracle SIGN-OFF-W/COND → build DARK / fallback DO-NOTHING):** the fix
  (an `xsupplier_lookup` companion threaded to `anchor.py:1253`, keep-clean-reject-garble via the readability
  predicates) is sound + fail-safe (kept value → Stage-4.5 flag → never auto-files), BUT (a) reward is the
  narrow text-fallback sliver only; (b) a kept stranger ref WINS Tier A (engine.py:3552, `located` includes
  `'anchor'`) and DEMOTES a would-be keyword auto-file to a flagged review showing a WRONG value on disagreement
  — a real auto-file-rate regression (never a silent misfile); (c) the FIRING path is CORPUS-INERT (no taught
  anchors in the born-digital harness; real anchors belong to confirmed suppliers), so it can't be validated —
  Oracle's flip gate needs a constructed taught-anchor `_xsupplier` case on the BF_/KO_/… corpus. Not worth the
  demotion downside for a corpus-inert edge on a single-supplier install. Revisit only if a real firing case
  appears on a genuine multi-supplier install. gary's full design + Oracle's conditions (A corrected framing /
  B demotion pin / C taught-anchor gate / D `test_doctype_scoped_format_gate.py` direct-call short-circuit /
  E single `(entry,is_xsupplier)` closure) are in the 2026-07-30 chat.

### Letterhead cold-start supplier reader  (confirmed at scale 2026-07-29)
- **Symptom:** cold (first-contact, no learning) supplier identity reads only from a `Supplier:`/`Bill
  From:` caption. The born-digital demo batch measured **~8%** supplier accuracy cold — name-as-text
  letterheads, footer-only issuers, and text wordmarks all return null. Resolves once learning/templates
  exist, so it's a first-contact gap.
- **Fix direction:** the designed-but-unbuilt `letterhead.py` **suggestion-only** reader (largest text in
  the top band → issuer). Only ever needs to carry doc #1. See memory `project_issuer_band_and_letterhead`.

### S1 band-graduate — real fix (column/geometry-aware issuer window)
- **State:** S1 (`TEMPLATE_IDENTITY_BAND_GRADUATE`, commit `958229c`) is built DARK and proven **INERT**
  on its target: two-column `BILL FROM | BILL TO` layouts put the issuer name AFTER the "BILL TO"
  recipient marker in the linearized text, so `_issuer_hint_band` truncates it out → no shed.
- **Fix direction (deferred, gary+Oracle):** a column/geometry-aware issuer window, OR a `BILL FROM`-
  anchored corroboration window that excludes the recipient column (Oracle C2 is the constraint).
  Memory `project_autofile_s1_band_graduate_20260729`.

### delivery_number / worksheet ref completion  (reggie, 2026-07-29)
- delivery_number went 0% → **45%** after adding its `field_patterns` entry — still partial (more
  label/format coverage + the footer/three-party layouts). worksheet `reference_number` stays **30%** —
  the "Worksheet No"/"Job No" labels must be added at the **type-scoped** layer (preset override / ⊕
  teach), NOT the global `_REF_ROLE_CAPTIONS` seed (reggie: global would collide with `job_no` + blast
  every custom ref field).

### ✓ FIXED — Set A warm cross-contamination  (2026-07-30, d9ec7d5 + flip 2b8bdb2)
- Loading live learning dropped new-supplier ref accuracy (Set A ref 84.7% cold → 50% warm). iris PROVED
  (isolation) it was NOT phash/fingerprint/anchor (all falsified) but the learned-shape `formats` store: the
  doc-type-scoped `('')` aggregate on a single-supplier install IS that supplier's ref convention, hard-nulling
  stranger refs at Stage 4.5. FIX (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default ON): a `('')`-only verdict FLAGS
  not NULLS; supplier-scoped withhold byte-unchanged. Gate: score_demo A warm ref 55→89%, realdoc M=0. See
  memory `project_shape_withhold_supplier_scoped_20260730`.

### Name-presence veto residuals  (2026-07-31, Oracle-logged with the TEMPLATE_FIXED_NAME_PRESENCE_VETO sign-off)
- **Bank-less collision survives unflagged:** a collision onto a supplier with **no ≥3-word branding
  fingerprint** exits `_flag_branding_conflict` at the own_ratio-None fail-safe (engine.py ~1959)
  BEFORE the un-named branch — a conf-95 wrong `template_fixed` stamp stands unflagged and CAN
  auto-file. The supplier_prints_name ratio is exactly the evidence that could judge it where the
  bank can't — extend the veto ahead of that early-return (own slice + own gate).
- **`_doctype_fixed_supplier` is a DEAD GUARD in production** (found 2026-07-31 building the veto):
  it reads `f.get('key')` but the templates payload carries `field_key` (template_matcher reads
  `field_key`; only the unit fixture uses `key` — test_fixed_supplier_immune.py greens on a shape
  production never sends). The template-MISS fixed-supplier fill + its logo-immunity have therefore
  never fired live. Fixing = one word, but it ACTIVATES a dormant conf-95 stamp path — needs its own
  vet + gate (and the new veto already covers it once live). Do NOT "fix" casually.
- **Ratio-deflation poison loop:** each wrong-scope confirm under a name-printing supplier drags its
  prints-name ratio toward <0.80 and disarms the veto. Clean at flip (Copperfield 1.0/60,
  Ridgeway 1.0/101 — verified 2026-07-31); re-check at any mass-misfile incident.

### Needless-flag session residuals  (2026-07-31 evening; herald+gary+Oracle)
- **Slice C — `_center_in_any` overlap-fraction fix at source** (ocr/tesseract.py:76-85): the PSM-6
  supp merge's center-point dedupe lets an overlapping supp word through inter-fragment gaps →
  DOUBLED tokens in `ocr_text` for every consumer (the manufactured heading garble rung-2 now
  works around). An overlap-fraction test fixes it at source but changes OCR text corpus-wide —
  own session, own full gate. Do not bundle.
- **Demo-corpus identity residuals (pre-existing, measured in `demo_notes_gate.js`):**
  `SaltmarshSeafoods_purchase_order_01` reads issuer `'altmarsh Seafoods'` (leading-glyph clip);
  `_02` reads `Ridgeway Plant Hire` (cross-supplier identity collision). Both identical OFF/ON —
  the branding-primary redesign class (`project_identity_branding_primary_20260728`), plus the
  refuse-note holds on cross-supplier phash locks (herald's 172/175 — CORRECT protective holds).
- Demo gate + probes live in `stress_test/`: `demo_notes_gate.js` (sampled 2/supplier×type — no
  silent caps, logged), `heading_band_probe.py`, `geom_witness_probe.js`.

### Teach label pass-2 follow-ups  (2026-07-31)
- **Pass-1 type-heading gap:** teach still lacks a pass-1 `labelIsTypeHeading` reject (Review ⊕ has
  one at review/renderer.js:6792); pass-2 rejects headings (`isTypeHeadingLabel`), but a clean
  UNCLIPPED pass-1 heading read would still be offered. Port the reject to teach pass-1 + dedup with
  Review's copy (its test regex-extracts from renderer.js — move both onto the shared pure helper).
- **Review ⊕ two-pass adoption:** review/renderer.js ~3771-3786 builds the same open-loop 1.8× label
  band — same decapitation class, unverified there. Adopt the shared clip-gate + re-read
  (`clusterTouchesClipEdge`/`labelRereadRect`/`cropBoxToPageNorm`) in the ⊕ tool.

### ✓ SUPERSEDED for the V-class — clipped-suffix reconciliation SHIPPED ON (2026-07-31 night, `36a4a32`)
- The section below was AMENDED by Oracle after a traced single-doc run showed the 'V-69523' class is
  an `anchor_registration` box misplacement (~76px right of the value start) whose read WINS over the
  discarded correct keyword read — label-confirmed methods are shape-EXEMPT (engine:4692), so neither
  the crop-matte fix (pixels outside the crop) nor the escalation rung (trigger never fires) could
  touch it. Shipped instead: `_reconcile_clipped_suffix` (kill `CANDIDATE_SUFFIX_RECONCILE`, ON) —
  adopt the fuller keyword read of the SAME token from the always-on candidate ledger (suffix +
  digit-identity + shape-pass + confirmed-prefix membership), flag-only without prefix support.
  Gates: OFF byte-identical; ON ref 91.8→94.5%, M 8→7 zero new members, heals #121/123/124/136/137.
- **Amended Oracle rulings (2nd pass):** XRES escalation = DO NOTHING for now (both rungs; revival
  gate = a MEASURED count of withhold-branch abstains-after-GATE_REREAD on the corpus); oscar crop
  fix DEFERRED pending its own measured heal; **NEXT: garbled-anchor remediation sweep** (07-30-era
  taught rows with garbled labels, e.g. Ridgeway 'Inwotce No.' — re-teach or purge, then re-trace
  #121 on a clean anchor); registration.py fit audit ONLY if the ~0.03-norm misplacement survives
  remediation; 225 preset stays PARKED and the CURRENT 225 measurement is CONFOUNDED both ways —
  re-measure only after guard + remediation (added to C7 preconditions).

### Cross-res escalation re-read + "Faster (225)" preset — Oracle-gated plan (2026-07-31 night)
- **Origin:** live "Worksh Eet" garbled Add-type nudge at owner's `ocr_dpi=200` speed test. Full dpi
  sweep (202 docs, GT=confirmed): 150/200/240/250/260/275 each garble 1-4 tracked headings (different
  docs per res — decorrelated lottery); 225/280/300 clean; 280 only 7% faster (pointless). Realdoc:
  225 = type/supplier 100% (even heals #54, wrong at 300) but ref 90.1% vs 91.8%, **M 8→9** (prefix
  clip 'INV-35900'→'V-35900' crosses into auto-file; digit-dup 'PO-64334'→'PO-643224'). Scratch data:
  session scratchpad `filed*.tsv` / `rr300.txt` / `rr225.txt` (regenerable).
- **Oracle verdict (gary+oscar consensus vetted):** SIGN OFF W/COND on the escalation mechanism at
  **300-base only, dark**; **DO NOTHING (parked)** on the 225 preset. Killer fact (Oracle traced,
  overturning gary's stale-docstring read): `format_anomaly_checker._fold_shape` folds the digit-run
  length of ANY single-run shape — `'@@-#####'`→`'@@-#'` — so the 225 digit-dup class PASSES shape,
  never triggers escalation, and has ZERO in-pipeline guard. Length-invariance is BY DESIGN
  (`project_numeric_shape_fold`); do not revert it.
- **Build order (never bundle):** (1) oscar's crop fix — outward-rounded crop bounds + 12-16px white
  matte on field slices (cures edge-glyph drop at ALL res, incl. the 'V-xxxxx' class living at 300
  today on #121/123/124) — standalone, own switch, own realdoc M≤8 pass FIRST (it changes crop bytes
  everywhere, so it must precede the escalation baselines). (2) Slice 1 field rung `XRES_GATE_REREAD`
  inside `_maybe_gate_reread` (engine.py ~2729-2815/4782): injected `render_page_fn(page_idx,dpi)`
  from process_docs (pypdfium2 + recorded rotations; None for image-imports/born-digital), one cached
  alt render per (doc,page) keyed (dpi,pidx), independent LOCATE at alt res (no frame mapping).
  Lane A files clean ONLY IF: passes the exact failed check AND digits byte-identical AND base is a
  contiguous suffix with alpha-only prefix len 1-3 AND (C1) learned-shapes non-empty + ref/code field
  class only AND (C2) completed prefix ∈ confirmed prefixes via `ocr_corrector.lookup_prefix`
  (membership, not distance) — else lane B (cap 69 + corrected_to + note, customer-plain copy).
  Method stays original tier, never authoritative. (3) Slice 2 heading rung 3 `XRES_HEADING_REREAD`
  (same adopt contract as rungs 1-2; re-green `demo_notes_gate.js` ON+OFF — composes with 4a058a6).
- **Other conditions:** C3 PINs (digit substitution NEVER lane A; agree-but-still-fails = reject;
  never method-authoritative) · C4 RAM (alt-render cache ≤2 pages/doc, freed per doc — slow-PC
  feature must not re-create import RAM starvation) · C5 gates (300+ON vs 300 byte-identical-or-
  better M≤8; OFF byte-identical; probes #131/#121 lane A, #70/#163 lane B, stable no-fire control)
  · C6 merge seam: engine-emitted `corrected_to` (GATE_REREAD lane B, handler.js ~246) currently
  gets OPERATOR-grade veto power in the reprocess merge — add the pinned case to
  `test_reprocess_annotated_empty.js` + fix the comment; do NOT redesign the merge in this feature.
- **C7 preset revival (v2, only then "Faster (225)" returns):** trigger-widening length signal
  (single-group ref digit-run length differs from uniform in-scope confirmed length → fire re-read;
  cross-res agree → clean, disagree → lane B) + oscar's native-dpi-relative base/escalate rule +
  a gate asserting every new-wrong-at-225 doc is healed-or-flagged (absent-from-M-by-luck ≠ pass)
  + evidence on REAL 300-native scans (this corpus is 150-native; 225 there is an upsample — on
  real scans it's a downsample and likely worse). UI swap (150/200→225/300 + write-back snap) was
  edited then REVERTED per verdict — do not commit a Faster preset before C7.

### Validation slices S-A/B/C/D — gary-designed 2026-08-01 overnight, AWAITING ORACLE (not built)
- **Evidence base:** realdoc 202-doc residual M=5 + 8 regressions decomposed into classes; the #141
  delivery_number trace ('21/07/2026' committed to a REF field @88 silent). gary traced the WIN to
  Tier-A (engine.py:3764): the Ridgeway anchor row is an operator ⊕ teach (last_authoritative_at) →
  authoritative=True; Tier-A never consults confidence; `located` is BY FIAT for anchor_registration
  (anchor.py:1376 membership — even after relocate PROVED label_off_taught_position); ocr_min_conf
  is None for non-free-text (anchor.py:1497) → _ocr_clean blind; `alphanumeric` pattern contains `/`
  → a date has coverage 1.0. Registration rung also RESURRECTS a shape-failing read (anchor.py:
  1175-1177) and is _LABEL_CONFIRMED (shape-exempt everywhere). "Distrusted as witness
  (KEYWORD_ANCHOR_CORROB independence-fraud exclusion), trusted as winner" — the one-sided
  contradiction is the primary lever.
- **S-A date-in-ref flag** (kill DATE_IN_REF_FLAG): engine pass beside _flag_prefix_outlier (order:
  suffix-reconcile → S-A → prefix-outlier → S-B); ref-role/reference fields whose value FULLY parses
  as a date (validator.parse_date + full-string 3-component same-separator regex belt) → cap 69 +
  customer-plain note, NEVER null; exempt manual/template_fixed + scopes whose OWN shape accepts it;
  gary deviation FOR ORACLE: keyword_override NOT exempt (label authority ≠ value authority).
  PINs: '20260731'/'21/07'/'DN-24/07/26' NOT flagged; '12.05.11' FLAGGED (pinned trade-off).
  Highest rank: deterministic, near-zero regression surface, holds at EVERY floor (the note is the
  only floor-independent block — trust.js:601 flagged check).
- **S-B ref digit-run LENGTH profile** (kill REF_LENGTH_OUTLIER_GUARD, build OFF): ocr_corrector
  beside the prefix model — digit_run_profile tuples ('7602-1354-4'→(4,4,1)), build_length_index
  with DOMINANT_MIN_COUNT/SHARE + the weight-aware self-heal accept bars; exact tuple match; flag
  cap 69. Catches accretion (#33 'INV-12110') + digit-dup ('PO-643224') that the LENGTH-FOLDED shape
  cannot see (fold BY DESIGN, untouched, pinned). Rollover PIN: 'INV-1000' vs uniform (3,) FLAGS —
  accepted trade-off. Note precedence S-A > prefix-outlier > S-B.
- **S-C blind-geometry disagreement reconciliation** (kill BLIND_GEOM_DISAGREE_RECONCILE, DARK,
  flip=owner+gates): post-merge pass (suffix-reconcile pattern, ledger, no new OCR). v1 scope:
  winner method == anchor_registration EXACTLY (NOT inline/relocated — pinned, protects the
  2026-07-26 Tier-A re-teach fix; NOT rigid anchor_crop — already shape-gated); winner fails own-
  supplier shape; ledger has independent-stage (0_template/0.5_mapping/1_keyword) shape-PASSING
  disagreeing candidate. ADOPT when ≥2 independent stages agree normalise-equal (the #141 case:
  keyword_override@93 + template_mapping@90 both 'DN-24408') — a method inadmissible as corroboration
  witness cannot silently overrule two admissible witnesses; FLAG (cap 69, both values named) when
  only one. Deliberately narrows the authoritative-wins invariant for anchor_registration only
  ("the teach fixed the position, not the value" doctrine) — state in commit + pin.
- **S-D registration fit audit** (investigation only): measure per-fire n_inliers/residual/landmark
  spread/target leverage/provenance (07-30-era landmarks?) vs realised divergence (#141 = 0.047 norm
  vs the 0.02 inlier bar). Hypotheses H1 n=2 vacuous similarity fit / H2 leverage extrapolation /
  H3 stale landmarks / H4 similarity-vs-affine. Cheap gates if evidence: min_inliers=3, leverage
  refusal → keyword fall-through, or trust-cap 69+flag. Fix only on clean separation, zero clean-case
  collateral; else data remediation (re-pin landmarks), not code.
- **S-B2 conforming-profile confidence corroboration** (separate switch, DARK, own Oracle pass —
  never bundle with the flag slices): solo keyword read capped 85 whose digit-run profile AND prefix
  are both confirmed-dominant in a supported scope → +3 (the Stage-4.5 support boost falls 1 short).
  The direct MORE-auto-commits lever, alongside S-C's ADOPT lane and the unbuilt Stage-7 stage 3
  field_format_rules.
- **Expected residual after S-A+B+C:** {#65, #154, #86} interior stroke-level substitutions — only a
  second-render/second-engine witness could reach (the parked xres design's territory).

### Type-note placement — twice-misread as a supplier failure (2026-08-01)
- The type-refuse/ambiguity note attaches to the SUPPLIER row (engine `_flag_type_ambiguity`), so
  it renders under DOCUMENT ISSUER — the owner twice read a fully-resolved issuer@98 as "can't
  resolve the supplier". Follow-up: surface type-level notes beside the TYPE selector / in the
  summary band instead of under the issuer field (renderer placement; the emit could carry a
  `note_scope: 'type'` marker). Small, UX-only.

### Interior digit stroke-substitution — INVESTIGATED + ORACLE-VETTED, ready to build (2026-08-01 evening)
**007 measured pack + Oracle round complete** (oracle_log 2026-08-01 4th round; evidence preserved in
`stress_test/out/stroke_sub_2026-08-01/` — matrix.json ~30 reads/doc at 150-600dpi, per-stage traces,
600-dpi glyph exhibits). Axis = READING (placement clean on every exemplar; oscar crop-matte fix
REFUTED for this class). Substrate: 150-DPI-native JPEG rasters, digits ~10px, JPEG ringing closes
1px counters (2↔3, 9↔3, 5→8/9/3). THREE read chains flip independently (locate ~133dpi 1100px /
crop-ladder / full-page keyword — doc-291's one digit read three ways in one run). Tier-A precedence
commits the error (anchor.py:1037 nulls inline ocr_conf = structurally exempt from the Tier-A garble
gate); on #291 wrong inline@85 beat CORRECT keyword@85 sitting in the ledger at every DPI.
- **Class re-drawn (Oracle + main session both eyeballed exhibits): #86/#154/#285 = GT-POISON** —
  pages print well-formed '24/03/2026'/'DN-38884'/'WS-43842' vs contradicting confirmed values
  (30/30 unanimous high-conf reads = correct-OCR-vs-wrong-GT fingerprint). True OCR class = #65,
  #283, #291, #299 + the healed 259 signature. **REMEDIATION FIRST (owner): eyeball the 3 exhibits,
  then Learning Repair de-confirm → correct to printed value → re-confirm** (confirmed poison feeds
  live shapes/hints/S-B indexes — gt_overrides alone insufficient). Do BEFORE any gate baselines.
- **D1 SIGNED W/COND (build first): in-band digit-disagreement flag.** Post-merge, LAST in pinned
  pass order (after S-B+witness; extend test_validation_pass_order.js); REF-ROLE fields only (date
  fields = structural false-fire hazard, zero measured heals); trigger = distinct-stage ledger
  candidate, identical non-digit skeleton (separator-normalised), same length, ≤2 digit positions
  differing (tighten to 1 if census >3%); witness conf floor from census; FLAG-only (note + cap 69 +
  suggestion surface; copy directs reviewer to the DOCUMENT, never "pick one" — 65@400 shows both
  readings can be wrong). **Mandatory pre-build census: predicate offline over the 299 corpus
  (run8.js scaffolding), false-fire bar ≤3% hard / ≤2% target.** Exempt dominant-value-snapped
  winners matching an in-scope confirmed literal if census shows any. Gate: OFF byte-identical; ON
  values byte-identical corpus-wide (notes/conf only), #291 flagged, flag-audit total. Pins: 291 +
  259-signature fixtures fire; suffix-adopted fuller read does NOT; 3-sub does NOT; date does NOT;
  flagged would-auto-file doc HOLDS. Heals/flags: #291 now + closes the GT-in-band-loses-to-Tier-A
  hole. Catches 2 of the 4-doc class; combined with D2 = 4 of 4 flagged or healed.
- **D2 CONDITIONAL GO (second, after D1's census) — RE-SPECCED by Oracle:** the witness is a second-
  DOWNSAMPLE-GEOMETRY line-locate + harvest of the known label/value band (400→1100 or 600→1100),
  NOT a value-box crop re-OCR (matrix PROVES the crop stays wrong at 400/600 — the 283/299 heals came
  from the locate chain's changed anti-alias kernel; a crop-witness build would measure zero heals
  and green its gate anyway). Tier-A-won ref fields only; NO skip-on-keyword-agreement (283@300:
  keyword agreed with the WRONG value — same-substrate agreement is only semi-independent); flag-only
  through the SAME shared comparator as D1 (one implementation, one pin). Pre-build bake-off between
  the two chains on 65/283/299 catch + clean-corpus incremental fire-rate ≤3% + latency; fixture PDFs
  for 283/299 must FLAG under the built witness (pins the locate-chain spec — a crop implementation
  fails by construction); C3 unit pin (witness can NEVER change a value); throughput bound ~≤15%.
- **D3 REJECTED (DO NOTHING): never-harvest-values-from-locate-pass** — inverts the July-31 arbiter
  premise (crop box routinely swallows label tails/clips prefixes — the traces' own anchor_reject
  lines show it), heals only #291 which D1 already flags, resurrects the clip class. BANKED future
  path instead: full-res re-LOCATE (solve box precision — 007-A's own revival precondition).
- Also REFUTED by measurement: global preprocessing/binarisation changes (no recipe at any DPI read
  the poison-free saturated cases; flips recipe-stable); 400-as-primary (fixed 283/299, broke 65
  worse + 285@400 lost PLACEMENT entirely — DPI non-monotone). Substrate fix out of app reach; a
  low-scan-quality import advisory = future barry idea.
- **Cured sub-class (6237398): merged-doubled-digit** — REF_LENGTH_WITNESS_RECONCILE ON heals the
  'WS-1904'-for-'WS-11904' family from the ledger on the artifact's fingerprint (one digit inserted
  adjacent to an identical digit); rollover-drift pinned unadoptable; authoritative winners get
  flag-with-suggestion only.
- **Second live exemplar + a cheaper sub-class (2026-08-01, Vellum worksheet_18):** page prints
  'WS-11904'; anchor_inline read 'WS-1904' (doubled '1' merged — segmentation, not substitution)
  and WON the tie over keyword's CORRECT 'WS-11904' (both @85, anchor tier outranks). S-B FLAGGED
  it live (4-vs-5 digit note — the guard's first real catch). The trace shows the cure candidate:
  an inline-vs-independent-read DIGIT-COUNT disagreement arm — when a same-field ledger candidate
  PASSES the scope's length profile that the winner FAILS, prefer/flag (the S-C pattern extended
  to anchor_inline, currently pinned OUT to protect the 07-26 re-teach fix — that pin needs its
  own Oracle round before any widening). Segmentation drops ARE decorrelated across reads (keyword
  had it right) unlike pure stroke substitutions.

### R2 cohort pick admission — DEFERRED with revival evidence (Oracle 2026-08-01)
- Banked from the type-refuse deadlock arc (11b7ae9 shipped R1+R3+reword instead). R2 = admit a
  band-13 _letterhead_cohort member with document_type_slug == detected_slug into the Stage-0 PICK
  when title_trusted (heals doc #2 of a new type with zero confirms). REVIVAL EVIDENCE: after
  R1+R3 live, the refuse-note class still recurs materially (more than the expected single
  teach-window note per new supplier-type pair) on the demo gate or live. Conditions if revived:
  trusted-title gate only; detail-veto ordering intact; margin-3 untouched for the untrusted path;
  cohort sibling passes the SAME downstream qualification gates (no gate bypass); cohort anchored
  on an in-margin member's non-null dominant_supplier.

### Digital ↔ scanned bleed (same supplier, divergent layout)
- **Confirmed (Set B warm):** a digital doc reusing a live name inherits the scanned identity (**supplier
  90%**) but the scanned template's field geometry doesn't fit the digital layout (**ref 29%**, held).
- **gary's least-invasive fix (deferred):** extend the `_located_at_taught_position` layout gate to
  **same-supplier** authoritative rigid reads (today cross-supplier only, `anchor.py:~1404`) → a taught
  absolute box fails toward review when its caption isn't at the taught position on a divergent layout.
  NOT a source-partition (that's wrong for production — same supplier should share learning).

---

## Type detection

### TYPE_PRESENCE_VETO — Slice 0 (band reader) + Slice 2 (auto-type cure)  (night 2026-07-28)
- Slice 0: a title-band PSM-11/upscale reader (`read_title_band`) to erase the veto's ~1.5–2.3%
  fail-safe false-holds and feed the cure. Slice 2: arm-the-refuse so legible titles auto-type correctly
  — **flip LAST**, after the identity fixes soak; biggest regression risk (needs a full-corpus per-doc
  type-flip gate). Memory `project_type_presence_veto_20260728`.

### Identity branding-primary separation  (night 2026-07-28, designed)
- Vellum/Larkspur phash collision (64-bit hash = LAYOUT not mark). Fix = branding-PRIMARY supplier
  separation, coarse recall-only, 256-bit mark corroborates. Vellum PDFs are image scans → Slice B
  (reprocess) cure; Option C (geometry) = fresh-import SUGGEST-only. Memory
  `project_identity_branding_primary_20260728`.

---

## Testing infrastructure

### Install preset types + total/line-item fields
- The live DB has only 5 doc types (invoice/sales_order/purchase_order/delivery_note/service_worksheet)
  and **no total/line-item field on any type**. Install credit_note/quote/statement/receipt (Settings →
  Add from catalog) + add a total field, then re-run `score_demo_digital.js` to cover all 9 demo types +
  money extraction (currently untestable). Can be scripted into a copy DB.

---

## Security / hardening

### Cython engine + arm fuses + asar rungs  (discussed 2026-07-29)
- The extraction engine ships as sourceless `.pyc` (a speed bump — bytecode decompiles back to
  near-source). `.pak` = Chromium resources (non-issue); most `.py` = third-party libs + thin entry
  shims. **Real upgrades (deferred, own session — build-chain change + full smoke):** Cython-compile the
  engine → native `.pyd`; arm the Electron fuses (`HARDEN_FUSES`, RunAsNode/inspector off); the deferred
  asar rungs B/D/F/E (bytenode/obfuscation). Plan: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`. Framing:
  raise the bar, not "uncrackable" — the **licensing gate** is the commercial moat, not code secrecy.
