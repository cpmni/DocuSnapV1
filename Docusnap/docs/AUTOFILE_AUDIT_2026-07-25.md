# Auto-file audit — why correct documents don't auto-file (2026-07-25, Opus 4.8)

Overnight investigation triggered by the owner: 16 correct Saltmarsh Seafoods delivery dockets pile up
in Review instead of auto-filing. North star (co-equal, hard): **documents must auto-file when they
should AND the customer must trust every auto-file** — recall AND trust, neither traded.

The dockets read **correctly**. The customer/recipient-anchor issue that started this thread is a
**red herring for the pile-up** (customer_name is `required=0` → does not feed `overall_confidence`;
proven: doc 03 customer@70 and doc 04 customer@90 both overall 95). The batch is held by the
**auto-file gate + confidence caps + graduation state**, not by a wrong read.

## Evidence (traced / DB-verified — read-only)

Per-field confidence pattern across the 20 Saltmarsh dockets (type Delivery Note; required =
supplier_name, delivery_number, delivery_date; customer_name optional):
- `supplier_name` = **90 on ALL 20** (`hint_text_match`) — the KNOWN supplier's own name, flat-capped.
- Two groups: **overall 95** (delivery_number 98 + delivery_date 98, both `anchor_inline`) and
  **overall 88** (delivery_number 90 `keyword_override` + delivery_date **85** `anchor_inline`).
- Nothing reaches 100. Threshold = **100** (unset default). Scope confirmed = **4** (< TRUST_WINDOW 10
  → **NOT graduated** → floor 100).

The 88-vs-95 split is **TEMPLATE MATCH** (trace of doc 597 tmpl=NULL vs doc 599 tmpl=24):
- **Match** → supplier resolved EARLY → Stage-2.5 conformance boost (date 85→96, ref 85→95) +
  `docTrustGate` passes → overall 95.
- **No match** → supplier resolved LATE (2.5a text scan @≤85) → date via `late_anchor_rescue` capped
  @85 → overall 88. **Late-rescue ⟺ template-less by construction** (`engine.py:161-171`), and
  **sub-100 auto-file REQUIRES a template** (`docTrustGate` returns `no-template`, `trust.js:391`).

### Enumeration at a SIMULATED graduated floor of 95 (what confirming 6 more would unlock)
`4/20 would auto-file` (docs 594, 599, 604, 605 — all T24, clean). The other 16:
- **11 blocked below-floor** — every one **no-template** (the 88-docs + the 93/60 outliers). The
  template-match gap. *(scratchpad/enum2.js)*
- **5 blocked flagged** — 2 by a `delivery_number` "**type changed Invoice→Delivery Note on reprocess**"
  note (docs 596, 592); 3 by the **customer phantom note** (docs 593, 591, 595) — values all correct.

### System-wide context (the reassuring part) — `scratchpad/enum_all.js`
The **entire** review queue is these **16 Saltmarsh dockets** (all `below-floor`); nothing else in the
system is stuck. **14 scopes are graduated** (Thornbury delivery_note 160 confirms, Copperfield 60,
Larkspur/Marlowe/others 19-21) and file fine — including Saltmarsh's OWN invoice / sales_order /
service_worksheet (20 confirms each). The ONLY ungraduated Saltmarsh scope is **delivery_note (4/10)** —
which is exactly the stuck batch. So the graduation mechanism WORKS; this is a **young-scope + template-
match** issue, not a systemic auto-file defect. Confirm 6 more delivery dockets and that scope graduates
like its siblings.

## Ranked auto-file blockers / irregularities

1. **[PRIMARY] Template-match gap.** Identical Saltmarsh dockets: some match template 24 (→ boost → 95,
   `docTrustGate` ok), some don't (→ late supplier → 88, `no-template` bars sub-100 auto-file forever).
   This is the biggest bucket (11/16 held). **Read-only diagnosis needed:** why do doc 597's
   branding/logo/detected-identity fail to match template 24 while doc 599's match at only "60% via
   keywords+slug_rescue"? Likely the reuse-by-branding / IDF-hardening line already parked in
   `project_template_defrag_20260725` (Slice-2 live-owner-batch pending). ⚠ Oracle: **do NOT touch the
   matcher / identity / reuse thresholds autonomously** — max blast radius; owner-gated.
2. **[SECONDARY] supplier_name flat-capped @90** (`hint_text_match`) on a supplier identified by
   logo+template+keyword. Caps the ceiling: even perfect ref/date only reach (90+98+98)/3 = 95.33. The
   identity confidence ignores the multi-signal agreement. Identity-fusion territory (needs Phillip).
   Raises the ceiling; does NOT clear the 88-docs alone.
3. **["type changed on reprocess" flag]** permanently blocks auto-file (2 docs here; the note is stamped
   when reprocess flips the detected type). Once reprocess correctly resolves the type + reads the
   fields, is the note stale? A type-flip is worth ONE human glance, but it blocks auto-file
   indefinitely for docs that are actually correct. **Investigate:** should it clear after a clean
   reprocess, or convert to a one-time acknowledgement?
4. **[customer phantom note]** a false "caption disagreed" / "two different names" flag on a CORRECT
   customer value (3 docs). Blocks via the flagged gate. gary designed `RECIPIENT_CAPTION_CORROB`
   (corroboration-gated clear); a dark fix `_name_guard_keyword_clears` (engine.py:413) exists, held
   back for the #259 reason. Declutter — see [[project_recipient_anchor_problem]].
5. **[Graduation reality]** the scope needs 10 clean confirms; at 4/10 the floor is 100 so NOTHING
   auto-files regardless of any fix. **Immediate no-code lever: confirm 6 more dockets** → floor 95 →
   the 4 clean T24 docs flow. (Even then, 16 stay held by #1 + #3 + #4.) The 100 default threshold is
   fundamentally unreachable on a scan (every field caps below 100 by policy); graduation (floor 95) is
   the intended relief and is working as designed — the owner just hasn't confirmed enough yet.
6. **[Cold-supplier dirty-commit]** a brand-new supplier commits a caption-prefixed value into the
   FILENAME (`Delivery.Date 22-07-2026.No. DN-36457.pdf`) because `_qualify_against_format` passes an
   unqualified value through when there's no format history. **FIXED (dark)** by the caption-strip below.

## Built this session — the caption-prefix strip (DARK)

`feat(anchor): caption-prefix strip` (commit `9dfa011`, kill `ANCHOR_CAPTION_PREFIX_STRIP`, DEFAULT OFF).
`_strip_caption_prefix` recovers a structured value whose crop captured its own caption ("Date
22/07/2026" → "22/07/2026", "No. DN-36457" → "DN-36457") — reggie design + Oracle SIGN-OFF-WITH-CONDITIONS
(SEAM A currency-exclude; SEAM B recovery-not-pre-emption). Unit tests green
(`python_backend/tests/test_caption_prefix_strip.py`). **OFF byte-identical** (by construction + trace
byte-count match). **ON, live Saltmarsh batch: 16/16 zero VALUE changes** (recovers the anchor_crop
read method-only, same value) → value-safe. **Does NOT clear the batch** (the docs are held by
no-template + floor + supplier-cap). A/B harness: `stress_test/caption_strip_ab.js`. Its real wins:
the cold-supplier dirty-commit (#6) + recovering a read that would otherwise be lost when no inline
fallback exists. **Do NOT flip ON without the corpus A/B (M=0) + a flip-set page-verify** (Oracle
condition 6).

## Ruled OUT this session
- **Corroboration lift on late-rescue reads — DO NOTHING** (gary + Oracle): the 85 late cap guards the
  SUPPLIER PREMISE not the read; late-rescue ⟺ template-less ⟹ can't sub-100 auto-file ⟹ **zero recall**;
  lifting reopens the #472 class. Enumeration CONFIRMED inert: 0 docs held by weak-critical-with-template
  (`scratchpad/enum_autofile.js`).

## Template-match gap — diagnosis (read-only, 2026-07-25 night; do NOT touch the matcher — Phillip+owner own the design)

Traced doc 597 (no template, 88) vs doc 599 (T24, 95), both Saltmarsh delivery dockets, identical layout:
- **The logo phash is useless here.** 597's own delivery template **T24 is Hamming 26** away — the FARTHEST
  of all Saltmarsh templates; the CLOSEST is the wrong-type sibling **T21 (sales_order) at 14**; the
  supplier logo store is 28. All far outside the accept band (≤6) and the corrob band (≤13). So the logo
  path (`identify_template` path 1) correctly abstains — it cannot match 597 to anything. (Re-confirms
  [[project_logo_hash_unreliable]] / [[project_identity_overhaul_20260714]]: 64-bit phash has ~zero
  separating power on scans.) `scratchpad/hamming.py`.
- **The delivery templates are barely established.** T24 `confirmed_count=0`, `sample_document_id=None`;
  Ironbridge delivery T1=2, Copperfield T5=3, Thornbury T16=3 — despite those SCOPES having 20-160 clean
  confirms. Confirms are NOT reinforcing the (branding,slug) template (the reuse-by-branding /
  confirmed_count line — [[project_template_defrag_20260725]]). A never-reinforced template is fragile.
- **597 has ALL 9 of T24's fingerprint words** ([Saltmarsh,Seafoods,Harbour,Fisher,Quay,Grimsby,Delivery,
  Note,Deliver], keyword score 1.0 ≥ the 0.75 threshold) — yet `identify_template` returns None; 599
  matches T24 via the same-type keyword rescue (path 2b @60, which requires `detected_slug + title_trusted
  + hit_ratio ≥ 0.80`). The unstable element is the reverse-text **"DELIVERY DOCKET" banner** (a black-box
  reverse print): on 597 it OCR'd MERGED onto the ref line (`DELIVERY DOCKET    Delivery Note No. DN-36457`);
  on 599 it did NOT OCR at all (`Delivery Note No. DN-38626`). That plausibly flips `title_trusted`
  (standalone-heading signal), which gates the only rescue path that fires here.
- ⚠ **OPEN (needs an instrumented `identify_template` trace — Phillip, next session):** by the code, the
  logoless keyword fallback (path 2, `_match_by_keywords`, threshold 0.75, NO title_trusted requirement)
  should score T24 at 1.0 for 597 and return it — yet 597 returns None. The exact gate that suppresses it
  (a title_trusted refuse, an ambiguity hold, a supplier/branding gate, or the reprocess-doesn't-persist
  path) is NOT yet pinned. Pin it before designing.

**Design directions (for Phillip + owner — NOT built):** (a) stop relying on the unstable logo phash +
the fragile `title_trusted` heading for SAME-supplier matching — the branding fingerprint (597 has it in
full) is the reliable signal, so the keyword fallback SHOULD be rescuing 597; pin why it isn't. (b) make
confirms REINFORCE the (branding,slug) template so `confirmed_count` grows and the template establishes
(reuse-by-branding). (c) a banner-heading re-read for the reverse-text title ([[project_banner_heading_reread]],
kill BANNER_HEADING_REREAD) may stabilise `title_trusted`. Likely the exact Slice-2 live-owner-batch that
[[project_template_defrag_20260725]] is already waiting on.

## Recommended next steps (owner-gated)
1. **Confirm 6 more Saltmarsh dockets** → graduate the scope (floor 95) → 4 clean docs auto-file. Free.
2. **Diagnose the template-match gap** (#1) — the real lever for the other 11. Read-only first; the fix
   is very likely the pending reuse-by-branding Slice-2 live batch + Phillip IDF hardening.
3. **Decide the "type changed on reprocess" flag** (#3) and the customer phantom note (#4).
4. **Flip decision for the caption-strip** — run the full corpus A/B + flip-set page-verify, then flip.
