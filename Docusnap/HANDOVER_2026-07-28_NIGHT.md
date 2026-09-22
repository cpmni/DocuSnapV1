# HANDOVER — 2026-07-28 NIGHT (Opus 4.8, autonomous; owner asleep)

**Branch:** `feat/reprocess-throughput-autostraighten` · **NOTHING committed tonight** (all work is
design + measurement + this handover). The pre-existing state stands: 5 commits unpushed (`c22e771`→
`eebe154`) + the daytime uncommitted batch (see `HANDOVER_2026-07-28.md`). No code changed, no DB touched,
no flip. DB backup from earlier stands (`docusnap.backup-20260728-202834-pre-rename44.db`). One live DB edit
earlier (owner-approved): template 44 renamed "Larkspur Interiors"→"Vellum & Crane Stationers".

## TL;DR
Owner spent the evening on two problems — **wrong SUPPLIER** (Vellum/Larkspur identity) and **wrong TYPE**
(worksheets→invoice, PO→sales order). Both are the SAME root disease: the **64-bit logo phash hashes LAYOUT
not the mark**, so same-layout templates cross-bind. Ran two full advisor rounds, each specialist→Oracle-
gated, NO-REGRESSIONS enforced:
1. **IDENTITY round** (iris + gary → Oracle): fix = branding-PRIMARY supplier separation. SIGNED GO.
2. **TYPE round** (Herald → Oracle): the wrong-type stamps happen because the doc's printed TYPE HEADING
   isn't being READ (general OCR garbles big display titles), so the existing trusted-title refuse is
   starved. Fix = a title-band reader + the owner's own "type-printed-on-sheet" veto. SIGNED GO.
The owner's veto idea was VERIFIED on the live DB: it catches all 4 incidents, arms 38 templates, at a
2.3% fail-safe false-hold cost. **Nothing built** — a build-ready spec is below; the flip is an owner call.

---

## TYPE misdetection — root cause (verified at source + Herald rendered the title bands)
Every live (needs_review) type-misdetect is a WRONG-TYPE TEMPLATE STAMP via the phash collision — the
assigned type == the matched template's type in every case:
| doc | filename | assigned | matched template |
|---|---|---|---|
| #1523/#1529 Larkspur worksheet | worksheet | delivery_note | tmpl2 Larkspur **delivery_note** |
| #1843 Saltmarsh delivery | delivery | invoice | tmpl22 Saltmarsh **invoice** |
| #2119 Vellum worksheet | worksheet | purchase_order | tmpl35 **Marlowe** purchase_order (foreign) |
| #1414 Ironbridge PO | purchase_order | delivery_note | tmpl1 Ironbridge **delivery_note** |

**Herald's decisive finding (rendered page-0 title bands):** the titles are LEGIBLE (~0–1.5° skew, NOT
Northgate-style skew garble) — WORKSHEET / DELIVERY DOCKET / PURCHASE ORDER, a human reads each instantly.
But the general full-page PSM-3 OCR (`reconstruct_page_text`) mangles each display title a DIFFERENT way:
garble (`WO mg KS`), drops the white-on-black knockout banner, row-splits "PURCHASE ORDER", or clean-but-
spaced `WORKS HEET`. Band-isolated **PSM-11 recovers all four**. Result: `title_trusted=False` on all four
(`process_docs.py:637`) → the trusted-title REFUSE (`template_matcher.py:457`, gated `if title_trusted…`)
is STARVED → the colliding wrong-type template stamps its slug via the tie-break (`:432`).
**Axis verdict:** axis-1 TITLE READING is broken (4 ways); classification/refuse are sound but blind.

**Partition with identity:** branding-primary (identity Slice B) resolves ONLY #2119 (foreign Marlowe
template). #1523/#1843/#1414 are SAME-supplier, identical-branding, wrong-TYPE siblings → separable ONLY by
the printed type. So the type reader + type veto are LOAD-BEARING and complementary to the identity fix.

---

## Owner's "type-printed-on-sheet" veto — VERIFIED on the live DB (read-only, this session)
The owner's idea = the TYPE analog of the shipped per-supplier name-presence veto (`namePresence.js`,
7229cdd). Measured on the live DB (`scratchpad/measure_type_presence*.py`):
- **Arming: 38 templates** print their type-heading reliably (ratio≥0.80, n≥3). Verified at source (Oracle's
  demand — not Herald's estimate). The name-token predicate (distinctive tokens of the type NAME, with
  'note'/'document' treated generic) is SUFFICIENT — all 4 incident templates arm at 0.97–1.00. **No fragile
  learned-modal-phrase needed** → learn-side and check-side both use the SAME token-match on `ocr_text` →
  Oracle's C-a parity is trivial (this avoids his STOP-condition #1).
- **All 4 incidents HOLD** (the wrong type's heading is genuinely absent from the doc's band).
- **False-hold sweep: 46/1980 = 2.3%** correct docs whose OWN heading is absent from the band → would falsely
  HOLD. FAIL-SAFE (one-click review, never a wrong file). Band-widening doesn't help (46→45→44). **The 46 are
  almost all the SAME reconstruct heading-garble Herald diagnosed** (correct POs whose "PURCHASE" OCR'd as
  "pu rc", etc.) — i.e. **Slice 0's PSM-11 reader is exactly what would recover them and drop 2.3%→~0.**

**Trade, stated plainly for the flip decision:** the veto converts the wrong-type SILENT MISFILES (4 seen +
the whole future class) into visible holds, at the cost of ~46 correct docs (2.3%) also held for a one-click
confirm. Standalone (reconstruct only) it's a safe stopgap; the CLEAN version pairs it with Slice 0 to erase
the 2.3%. Slice 0 needs owner-attended OCR validation (Oracle: its real test set is the live DB, not corpus).

---

## Unified ship order (BOTH rounds; Oracle #2, Slice-3 dropped)
Each kill-switched, OFF ⇒ byte-identical, gated (corpus M/M_type=0 + accuracy byte-identical + live replay).
1. **Type Slice 0** — inert band reader `read_title_band` (PSM-11/upscale/vote; suggestion-only, never
   writes a field). Dependency for the CLEAN veto + Slice 2.
2. **Type Slice 1** — `TYPE_PRESENCE_VETO` (owner's idea), DARK, HOLD-only. ← *safest, highest-value; spec below.*
3. **Identity iris-A** — fail-to-review hardening (arms the distinctive veto at the bind).
4. **Identity gary-Item2** — stale-name heal (cosmetic; ship with a `name_locked` flag, Oracle).
5. **Identity gary-Item1** — Option C letterhead **SUGGEST** (not assign) + `geometry_from_lines` bridge.
6. **Identity iris-B** — branding-primary PICK (after A soaks).
7. **Type Slice 2** — arm-the-refuse (the CURE: legible titles auto-type correctly). **Flip LAST, after
   identity A AND B soak** (Oracle #2 §3 cross-round seam), full-corpus per-doc type-flip gate, owner smoke.
8. iris-C mark corroboration + Store-A backfill · 9. gary-Item3 wrong-type detach (DARK) · 10. iris-D mark
   normalisation (deferred).

**Biggest regression across both rounds (Oracle):** Type Slice 2 — the band reader misreads a legible title
into a valid-but-WRONG slug that matches a wrong-type sibling → tie-break picks it `logo+slug` → refuse can't
fire (best_slug==detected_slug) → `_type_authoritative=True` → **silent wrong-type auto-file**. PIN = full-
corpus per-doc type-flip enumeration (every type change must move TOWARD ground truth; M_type=0 alone is
insufficient). This is why Slice 2 is last + owner-smoked; DO NOT build it unattended.

---

## BUILD-READY SPEC — Type Slice 1 `TYPE_PRESENCE_VETO` (Oracle SIGN-OFF-W-CONDITIONS)
Reconstruct-only variant (name-token predicate; parity-trivial). Mirror `database/modules/namePresence.js`.
- **Learn seam (JS, `database/modules/templates.js`):** thread `type_heading_ratio` + `type_heading_n` onto
  each template dict in the getAll path that feeds Python (exactly like `dominant_supplier`/`confirmed_count`
  are threaded — see `best_t.get('dominant_supplier')` at template_matcher.py:465). Ratio = fraction of the
  template's `status='confirmed'` docs whose `ocr_text` TOP-BAND (first ~14 lines/600 chars, lowered)
  contains the template's type-heading distinctive tokens (≥0.6 present, mirror `nameCorroborated`). Compute
  once per getAll (per batch), not per doc (Oracle C-b — cheap: a DB query per template, no OCR).
  Type-heading tokens = distinctive tokens of `document_types.name` (∪ `title_aliases`), GENERIC set adds
  'note','document' (a lone "note"/"document" is not a type signal). Denominator = confirmed docs with
  non-empty ocr_text (Oracle C5 parity with namePresence).
- **Consume seam (Python, `template_matcher.py` ~:475, AFTER the trusted-title refuse `:457`, BEFORE the
  detail veto `:481`, inside `conf>=60`):** if `TYPE_PRESENCE_VETO!='0'` AND `_logo_refused is None` AND
  `best_t` armed (`type_heading_ratio>=0.80` AND `type_heading_n>=3`) AND candidate `ocr_lower` token count
  `>=50` (thin-text abstain — never veto a failed scan) AND the type-heading tokens of `best_t` are ABSENT
  from the candidate TOP-BAND (same token-match, ≥0.6 = present) → `return _type_refuse(best_slug, best_slug)`
  **reusing `type_refused: True`** (Oracle C-c: do NOT invent a `type_absent` key — engine.py:2773/:4910
  already consume `type_refused`). Any exception → fall through (fail-open, byte-identical).
- **Kill switch `TYPE_PRESENCE_VETO`** (default '0' until owner flips) → OFF byte-identical (the new block
  skipped). Thresholds env-overridable (`_RATIO` 0.80, `_MIN_SAMPLE` 3, `_MIN_TOKENS` 50).
- **Fail-toward-abstain ordering (verbatim from namePresence, Oracle C-d):** kill-off / not armed / thin
  candidate / heading present → NO veto.
- **Gate (Oracle C-e):** OFF byte-identical (assert block unreachable) · realdoc `M_type=0` + would-auto-file
  no-drop · the 4 incident docs HOLD · the false-hold sweep re-run (target the measured ~2.3%, enumerate,
  each is genuinely a garbled-heading correct doc not a lost catch) · a legible correct-type control must NOT
  hold · pins: armed-template shows heading→never held; ratio<0.80 / n<3 → never arms. Corpus harness DOES
  exercise identify_template (Python) so realdoc is a valid gate here (unlike the JS confirm-time slices).
- **Composition (Oracle confirmed):** post-pick HOLD, does not conflict with identity Slice B; both route
  through `_flag_type_ambiguity` (one note, not two).
- **Scratchpad measurement scripts:** `measure_type_presence.py` (+`2.py`) reproduce the 38-arm / 4-incident /
  2.3% numbers read-only against the live DB.

**Slice 3 (single-word `WORKS HEET`→worksheet in `_fuzzy_heading`): Oracle DO NOTHING** — it cannot
distinguish a mid-word OCR split from a legit two-word alias (`test_detect_type_aliases.py:51-54`), and its
incident (#2119) is cured by Slice 0's band read. Drop it; fold into Slice 0.

---

## IDENTITY round (unchanged from earlier — see memory + `scratchpad/oracle_identity_synthesis.md`)
Branding-primary supplier separation; Oracle SIGN-OFF-W-CONDITIONS. Key: Vellum PDFs are IMAGE scans → Slice
B (branding on cached ocr_text) is the reprocess cure; Option C (geometry) is fresh-import-only + must be
SUGGEST not ASSIGN. Full detail: memory `project_identity_branding_primary_20260728` +
`scratchpad/{identity_round_brief,oracle_identity_synthesis}.md`.

---

## FIRST ACTIONS (morning)
1. **Read this + memory `project_identity_branding_primary_20260728`.** Two Oracle-signed GO designs, one
   unified ship order, nothing built.
2. **Decide Type Slice 1 flip tradeoff:** 2.3% false-holds (fail-safe) to stop wrong-type silent misfiles.
   Either flip the reconstruct-only veto now (build per the spec above, ~1 focused session, corpus-gateable),
   OR wait and pair it with Slice 0 to erase the 2.3% (Slice 0 needs your live OCR smoke).
3. **Build order for the wrong-TYPE fix:** Type Slice 0 (reader) → Slice 1 (veto) is the safe front; Slice 2
   (the real auto-type cure) flips only after identity A+B soak.
4. **Baseline corpus DONE: `M_type = 0`** (`scratchpad/baseline_corpus.log`, 1935 confirmed docs). IMPORTANT
   nuance: the harness scores CONFIRMED docs only (already correctly typed by the owner), so M_type is 0 on
   the corpus and CAN'T directly measure the wrong-type-stamp problem — that lives in the incoming/needs_review
   pipeline (#1523/#1843/#2119/#1414). So the Type-Slice-1 gate is "**keep** M_type=0 + the 4-incident
   identify_template replay HOLDs + the false-hold sweep", NOT "reduce corpus M_type" (nothing to reduce there).
   Separately the baseline shows a real **ref-accuracy tail** (many `would-auto-file but WRONG on: ref`,
   esp. service_worksheet #2015-2937) — a DIFFERENT problem (ref reading, ~2% weak spot), not tonight's scope.
5. Everything else from `HANDOVER_2026-07-28.md` (daytime) still stands: 5 unpushed commits, uncommitted
   batch, SuperStore anchor-removal script, push/installer decisions.

## Key paths / artifacts
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only `?mode=ro`); mig 56; 1935 confirmed.
- Advisor briefs + syntheses + measurements: session scratchpad
  `…\42e74d1f-…\scratchpad\` — `identity_round_brief.md`, `oracle_identity_synthesis.md`,
  `oracle_type_synthesis.md`, `measure_type_presence.py`/`2.py`, `type_mismatch_db.py`, `vellum_probe.py`.
- Advisors used tonight: iris, gary, oracle (×2), herald — all read-only, none wrote the DB.
