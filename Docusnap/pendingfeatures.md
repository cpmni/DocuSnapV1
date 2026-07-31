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
