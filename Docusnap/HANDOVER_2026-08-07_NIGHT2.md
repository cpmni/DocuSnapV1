# HANDOVER — 2026-08-07 (evening/night 2) — VAT-reg guard SHIPPED + FLIPPED · delivery-note defect DIAGNOSED + fix specified · two designs ready

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `5ee4718`** (+ this handover) · all
pushed. Continues `HANDOVER_2026-08-07_NIGHT.md`. Owner present all session, then asleep; the NIGHT
PLAN below was owner-approved ("run on auto and safely, no regressions") and is the work to do.

---

## TL;DR
1. **SHIPPED + OWNER-FLIPPED (live):** `vat_reg_not_amount` + `net_misread_total_flag` — a VAT
   REGISTRATION NUMBER was being read as a TAX AMOUNT, false-flagging ~12 correct documents.
   Full gate green; Castellan batch reprocessed and all 21 filed.
2. **DESIGNED, NOT BUILT:** the shadow-row auto-file deadlock (gary, full design + test plan) and
   the taught-label / taught-value family (reggie, 5 ranked slices).
3. **DIAGNOSED + FIX SPECIFIED (not built):** the Pelican `delivery_number` defect. One mechanism —
   a wrong-column inline witness — reaching the value through TWO call sites plus a third unguarded
   door. Proven by arm C: both switches off heals **5 of 5, 0 regressions**. 007's fix is one
   predicate applied at two sites (`TEMPLATE_INLINE_ROW_OVERLAP`). Build it FIRST tonight.
4. Everything new is DEFAULT OFF. The only flips this session were the two the owner asked for.

---

## COMMITTED THIS SESSION (all pushed)
- `a4f7f8a` bridge for `CREDIT_SIGN_COHERENCE` (it shipped env-only on 08-07 and was unflippable).
- `89be9ab` Settings toggles for the curated-sender + pad-window-code families (also bridge-only).
- `d575668` **`VAT_REG_NOT_AMOUNT`** — the guard. Occurrence-level skip in `_search_for_label`,
  evaluated on the RAW tail before the column split and before `normalise_currency_spacing` mints
  the decimal. FORM-based predicate (money veto → ≥9 ungrouped digits → unbroken-run → non-leading
  group ≠ 3 → country prefix → registration keyword last).
- `60606d9` bridge + one paired Settings toggle for `vat_reg_not_amount` + `net_misread_total_flag`.
- `2a1ae7d` **Oracle's two BLOCKING conditions**: C1 credit-sign precedence over net-misread, C2
  co-residency (arming the guard forces `CREDIT_SIGN_COHERENCE`).
- `0af82a4` / `2414ef1` / `20159fb` / `5ee4718` — pendingfeatures entries, the corrected mechanism,
  the owner's doc-type/keyword backlog item, and the oracle_log entry.

## LIVE FLAG STATE (owner-flipped, verified in the DB)
`vat_reg_not_amount=true` · `net_misread_total_flag=true` · `credit_sign_coherence=true` ·
`heading_absent_reread=true` · plus the earlier crop/template families. **Nothing else was flipped.**

---

## THE VAT ARC — closed
**Mechanism:** the bare `"VAT"` label matches a letterhead's `VAT Reg GB 651 0027 84`; the scan is
top-down and returns the first accepted occurrence; `number_format` rule 3 ("trailing 2-digit
decimal with the point dropped") MINTS a decimal because a UK VRN is grouped 3-4-2 — `651 0027 84`
→ `651 0027.84` — which only then passes currency validation, and `_clean_value` returns just the
match, destroying the `Reg GB 651` context. Measured: identical `0027.84` on all 13 documents of one
supplier, the ONLY `vat_tax` value in the live DB.

**Gate (all green):** corpus 288 docs zero T→F, zero values moved, `vat_no` untouched (the arming
proof) · **0 new `reconcile_pick`** on both instruments (Oracle's blocker) · realdoc **byte-identical**
with BOTH flags armed, n=699 · Castellan 21 docs: 19 fires, 16 notes cleared, 0 gained, 0 totals
changed · G4 survival census clean · the C1 pin verified to FAIL 3/3 on the pre-fix build.
**As production runs it (C2 forces the sign detector on): false alarms 39 → 0, true flags 16 → 26** —
the 11 extra are credit notes whose sign is lost, which the corpus scorer counts as CORRECT because
`normMoney` strips the minus (known instrument defect; the additive sign census proves it).

**Named residual:** `Harrowgate-Timber_quote_0046.pdf` / `L922.14` — an OCR garble that loses its
(accidental) flag. Its owner (format-fail-yield) is dark, and `trust.js:486-495` routes currency to
`_currencyDpConsistent` only, which `L922.14` PASSES, never consulting `_currencyish`. One-line
right-layer fix, own gate.

---

## THE DELIVERY-NOTE DEFECT — DIAGNOSED, fix specified, ready to build

**Symptom:** Pelican Office Interiors delivery notes; 4 of 9 commit the caption `'Delivery'` as
`delivery_number` at conf 70 (`template_mapping_shapewarn`); 5 read `PD…` correctly.

**Ruled OUT by measurement (do not re-explore):**
- Fuzzy label matching — `_label_score` returns **1.000** on the true caption line.
- Registration displacement — A/B with `--registration` removed gives the identical wrong value.
- Teach geometry — the taught target box lands exactly on the true value in the page OCR.
- My own premise that `_geometric()` returned None — **refuted by 007**: the reconcile at `:1241`
  is downstream of `:1229`'s `if not text: return None`, so its having run PROVES the geometric read
  succeeded and was then overwritten.

**007's proven mechanism (mechanism 1):** `_target_inline_with_anchor` (`template_mapper.py:930`)
decides "is this taught model an inline row?" using `_DRIFT_FLOOR = 0.02` — a *drift* floor reused as
a *same-row* tolerance, ≈70px on an A4 render, 1.5-3 line pitches. The Pelican mapping's boxes do not
even overlap vertically (0.0045 gap) and it still admits them, letting `_inline_code_reconcile` →
`_pick_fuller_code`'s inline-disagreement branch commit the neighbouring caption. The tiebreak at
`:1094` is OCR confidence, and a dictionary caption ("Delivery Date") systematically outscores a code
("PD/26/6680") on an LSTM engine — so once admitted, the caption wins every time.
**Fix:** `tol = (anchor_h + target_h) / 2` — the geometric definition of vertical overlap. On this
mapping: Δcy 0.01515 vs tol 0.01065 → correctly refused, 42% margin. No magic number, DPI-invariant.

**E1 RESULT — the prediction did NOT hold (this is the important part):**
```
arm A = live baseline · arm B = TEMPLATE_INLINE_CODE_RECONCILE_DRIFT=0
#730  Delivery -> PD266842   FIXED  (conf 70->90)
#727 #733 #735 #736  Delivery -> Delivery   UNCHANGED
#728 #729 #731 (PD…, conf 90) · #732 #734 (PD…, conf 70, template_mapping_RELOCATED)  unchanged
FIXED 1 · REGRESSED 0 · unchanged 9      (007 predicted 4 fixed)
```
**ARM C — THE DECISIVE RUN (007 round 2, and it CLOSES the diagnosis):** E1 was the WRONG ISOLATION.
There are THREE sites that can mint `template_mapping_shapewarn`, and arm B disabled only one:
- **A** `:1241` `_inline_code_reconcile` inside `_geometric()` — switch `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT`.
- **B** `:1880` `_inline_code_reconcile` on the ABSOLUTE rung — **different switch**,
  `TEMPLATE_INLINE_CODE_RECONCILE`, which arm B left ARMED. This is the **not-drifted** path, which is
  exactly what a teach sample at zero drift takes — so #736 failing is CONSISTENT with the diagnosis,
  not evidence of a teach-capture bug.
- **C** `:1283` `_inline()`'s own `_gate_value(shape_mode='flag')` — **no switch and no layout guard at
  all**; a latent hole whether or not it fires here.

With BOTH switches off (`TEMPLATE_INLINE_CODE_RECONCILE=0 TEMPLATE_INLINE_CODE_RECONCILE_DRIFT=0`):
```
#727 Delivery -> PD26668C   #730 -> PD266842   #733 -> PD251023
#735 -> PD26785             #736 -> PD251197   (the TEACH SAMPLE, healed)
#728 #729 #731 unchanged @90 · #732 #734 unchanged @70 (return early via _edge_cut_relocate :1858)
FIXED 5 · REGRESSED 0 · unchanged 5        <-- 007's round-2 prediction, exactly
```
**Caveat to carry:** two healed values have OCR character errors (`PD26668C` for …6680, `PD26785`
for a 8-char code). The RUNG hijack is fixed; those are read-quality residuals for a separate look.
`#727` healed via `template_mapping_padcode`, i.e. the pad-window code slice.

**THE FIX (007, widened after arm C) — one predicate, TWO sites, flag `TEMPLATE_INLINE_ROW_OVERLAP`:**
1. `:936 _target_inline_with_anchor` — `tol = (anchor_h + target_h)/2` replacing
   `max(a.h, t.h, _DRIFT_FLOOR)`. Closes doors A and B together.
2. `:1255 _inline()` — same guard at the top: if `dx or dy` and the taught layout is label-above,
   return None. Closes door C, which has no guard today.
With C closed, a label-above mapping whose geometric read fails falls through to the registration
fallback (:1968) and then omits the field -> REVIEW. Never a caption.
**Pins (3):** inline mapping (Δcy≈0.001) still admitted at both sites; label-above (Δcy 0.015,
h 0.0083/0.0130) refused at both; legacy offset-less mapping (dx=dy=0) keeps `_inline()` as its
PRIMARY read at :1296 — that last one pins the trade-off so nobody generalises the guard into the
legacy path. Ship it as *"a taught label-above mapping may not commit a same-row harvest"*, NOT as
"the delivery fix".

(Superseded by arm C above — the "second mechanism" was the SECOND CALL SITE of the same one.
Kept because the E1 numbers are what forced the correct isolation.)
**Harness:** `stress_test/inline_reconcile_ab.js` (moved into the repo this session — read-only,
temp copies, prints per-doc baseline vs armed).

---

## THE TEACH POISONING FINDING (owner-spotted, high value)
The owner noticed a poisoned value in Learning History: `Your P0`, seen 1.

**Traced:** `#736` IS the teach sample document. The wizard DISPLAYED the correct value; the document
stored `'Your PO'` (conf 70, `keyword_override`) and was confirmed, seeding learning with a caption.
The correct value DID land — in `supplier_hints` (`delivery_number 'PD/25/1197'`, usage 1) — but
hints fill EMPTY fields only, need `usage ≥ 2`, and never override a read. Learning History derives
from CONFIRMED documents' extraction rows, so the caption is all it ever saw.

**So: the taught document never receives its taught values, and it is the document most likely to
poison the scope.** That is the inverse of the owner's north star ("teaching must never make a field
worse than not teaching").

**Also FACT:** `delivery_number`'s field type is `text` and there is **no `validation_patterns.text`
entry**, so that field has NO format gate at all — which is why `'Delivery'` and `'Your PO'` pass.
Retyping it to `reference_code` would close the class but changes validation for every delivery note
already filed → **owner decision, flagged, not done.**

---

## READY TO BUILD (designs complete, nothing written)

### gary — shadow-row auto-file deadlock
`docTrustGate` judges filability on `shadow_reconcile` rows that are invisible in Review, excluded
from `getFieldFormats` (`learning.js:1237`), **deleted at confirm** by `dropForeignExtractions`, and
not filing inputs. `f` is therefore always `undefined` → `unverifiable-value:<field>` → the document
can never auto-file and the operator can never clear it. **Sealed twice.** The `at100` arm already
ignores such rows (`trust.js:503`) — internal precedent.
- Fix: add `extraction_method` to the SELECT at `trust.js:442`; skip a row iff `shadow_reconcile`
  AND not a defined field of this type AND not a role key. Skip placed AFTER the `validation_note`
  check so a flagged shadow row still blocks. Switch `TRUST_SHADOW_ROW_SKIP`, default OFF.
- **TRAP — do this first:** `realdoc_regression.js:194-199` and `sweepPredicate.js:89-96` build their
  overlays WITHOUT `extraction_method`, so the gate would be **vacuously green**. Thread it, confirm
  the baseline is unchanged by the threading alone, then arm.
- Pins incl. the foreignFields Oracle condition (2026-07-22): a VISIBLE foreign row must STILL block.
- Live proof captured before the owner cleared it: three documents at conf 97 on a graduated scope
  (floor 95) with no note, reason `unverifiable-value:subtotal`, row freshly written
  (`reprocess_merge decision=used_new`). The owner unblocked them by confirming, which DELETES the
  invisible row without anyone checking it — a rubber-stamp, not a review.
- gary's second defect, same class: reprocess CARRIES FORWARD rows the new run no longer produces
  (`handler.js:557-572`), so a stale `vat_tax='0027.84'` still drives the renderer's "✓ mathematically
  verified" badge. Own switch `REPROCESS_SHADOW_STALE_DROP`, ship as a pair, in that order.

### reggie — taught labels / taught values (5 ranked slices)
- **Slice 0 (measurement, blocks the rest):** why does the taught mapping misread its own sample
  document? = the A3 question above.
- **Slice 1 (BUILD FIRST, system-wide):** widen `PO_REF_DIGIT_GATE`'s arming from the hardcoded
  `('po_number','sales_order_number')` to the REF ROLE via `_infer_validation(field_key) ==
  'alphanumeric'`. The predicate `re.search(r'\d\S*\d', value)` is already shipped and corpus-proven.
  Kills `'Your PO'`/`'Delivery'` for every ref field, supplier and type; accepts `PD/26/6680`,
  `PO 22954`, `DN-98447`. Own switch, default OFF. **Expect a throughput change** — documents that
  used to commit a caption now arrive EMPTY and route to review. Gate: realdoc `armed == baseline`
  AND no ref recall drop (if `invoice_number` moves at all, narrow to the taught/override tier);
  corpus zero T→F.
- **Slice 2:** commit the taught VALUE to the taught document (rails: must pass the field's own gate
  first; commit nothing on failure; stamp provenance for Learning Repair; may SEED a shape but never
  VETO at N=1). Owner-facing — design + Oracle, do NOT build unattended.
- **Slice 3:** taught label → keyword, **supplier+type scoped**, ADDITIVE (tried first, never
  suppressing built-ins), with a value-as-label admission gate. Note `'Despatch Ref'` is ALREADY a
  shipped label, so this slice is INERT on Pelican.
- **Slice 4:** taught direction + column-aware `below`. `_search_for_label` is text-only and its
  `below` branch takes the LEFTMOST column segment of the next line regardless of the matched label's
  x — column-blind, and actively left-biased. Real geometry exists in-process (`words_out.rows`,
  page 0 only, absent on cached reprocess) — needs a witness-equality join, everything ratioed to
  `med_h`, never absolute px.
- **Slice 5:** promotion on confirm (blocked on whether the winning label survives into the
  extractions row).

---

## NIGHT PLAN (owner-approved) — full text in the session scratchpad `NIGHT_PLAN_2026-08-07.md`
**REVISED after arm C** — the delivery fix is now fully specified and proven, so it leads:
1. **A1** build `TEMPLATE_INLINE_ROW_OVERLAP` (one predicate, two sites, 3 pins) — dark.
2. **A2** cross-template census: how many taught mappings in the DB are label-above yet admitted by
   `_DRIFT_FLOOR`? Sizes the blast radius across ALL templates, not just Pelican.
3. **B** reggie Slice 1 (ref-role digit gate) — dark + pins.
4. **C** shadow-row skip: Oracle → thread `extraction_method` into the two overlays → build.
5. Gates batched (realdoc + corpus per slice; `stress_test/inline_reconcile_ab.js` for A1).
6. **D** design only. Then the morning handover.

**Guardrails the owner set: run on auto, safely, NO REGRESSIONS.**
- Everything DEFAULT OFF, byte-identical off, pinned by a test asserting the OFF path still
  reproduces the bug.
- No flips, no confirms, no Learning Repair, no writes to the live DB. The Pelican documents stay as
  the owner left them (confirming them poisons `delivery_number` further and is the owner's call).
- A red gate means the slice stays dark and gets written up — never tuned until it passes.
- No Chris run (needs a sandbox build and is worth more when the owner can act on findings).

---

## KEY FACTS / GOTCHAS
- **Harnesses now in the repo** (were session-scratchpad, would have been lost):
  `stress_test/vat_gate_probe.js` (per-doc A/B over a template's docs + `reconcile_pick` census +
  G4 survival census) and `stress_test/inline_reconcile_ab.js` (the E1 arm). Both read-only,
  live DB opened readonly, documents run from temp copies.
- Run JS harnesses with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe …`, NEVER
  `electron.cmd`. Python: `py -3.12` with `PYTHONIOENCODING=utf-8` (cp1252 kills `→`/`£` prints).
- **`realdoc_regression.js` writes a FIXED filename** (`stress_test/out/realdoc_regression.md`) — copy
  the report aside between arms or the second overwrites the first.
- The corpus scorer inherits `process.env`, so `FLAG=1 … electron.exe stress_test/customer_corpus_score.js`
  arms the run (its own comment at :255 says so).
- **A flat corpus lane is not automatically a pass** — Oracle's rule. Verify the guard ARMED (diff the
  jsonl, not just the lanes); the VAT arm's lanes were byte-identical while 43 documents changed.
- `customer_corpus_score.normMoney` strips `-`, so credit-note sign errors score CORRECT. Use the
  additive `total_sign_got`/`total_sign_gt` census.
- The Python suite has **4 pre-existing failures** (`test_engine_detail_thread`, `test_label_overrides`
  (2), `test_template_rescue`, plus a `trace`-kwarg TypeError in `test_network_field_authority`) —
  all verified identical with the session's files stashed. Do not chase them.
- Owner's own uncommitted edits to `CLAUDE.md` and `python_backend/tests/test_template_target_word_snap.py`
  — left untouched all session, do not stage.
- `templates.sample_document_id` is the teach sample link (33 → 736). Useful for any teach forensics.
- Advisor track record this session: gary corrected the "shadow rows are inert" premise and found the
  harness overlay trap; Oracle caught a BLOCKING seam (net note pre-empting the credit-sign note on a
  sign-blind rail) that neither specialist saw, and it fired on live data (#722); 007 proved the
  `_DRIFT_FLOOR` misuse but its 4-of-5 prediction was refuted by E1. **Measure every advisor claim.**
