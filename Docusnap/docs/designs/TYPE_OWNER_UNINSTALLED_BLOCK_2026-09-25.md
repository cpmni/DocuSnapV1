# Type-owner uninstalled block — two Ironclad STATEMENTS typed INVOICE (BUILT DARK 2026-09-25, mig 217)

**Status:** herald forensics → gary design (generalised Option B) → Oracle **SIGN OFF WITH CONDITIONS C1-C10** (2026-09-25;
`docs/oracle_log.md`) → owner "go" → **BUILT DARK the same day** (C1-C3, C6-C8, C10 applied; C4 arms run; C5 census MET —
`TESTING/_measure/type_owner_block_20260925/RESULT.md`; C9 Hard Set class + the realdoc ON arm = the FLIP gate, queued in
`NIGHT_RUN.md`). DARK switch **`type_owner_uninstalled_block`** (Oracle C6 name; env
`TYPE_OWNER_UNINSTALLED_BLOCK` `!= '0'`, mig 217 seeds `'false'`, in `TEST_SWITCH_KEYS` → 15), bridged INSIDE the fold's `if`
(`handler.js` ~585-587) so it is a child of `type_uninstalled_heading_fold`. Build DARK now; the Hard Set class (C9) is the
FLIP precondition, not the build precondition.

## The exhibit (herald rendered + measured; gary + Oracle re-read the code)
Four Ironclad Tool Hire STATEMENTS (raster scans). `ocr_text` line 0 = `STATEMENT` on all four (title read perfectly,
raw and deskewed). Installed at import: Invoice / Sales Order / Purchase Order / Quotation — Statement NOT installed.
Straight 44/39 → untyped + `detected_type_name='Statement'` (correct). Skewed 46/52 (+1.5°/+1.4°) → typed INVOICE with
`heading=True` → `title_trusted` → a CONFIDENT wrong type.

## Mechanism (FACT, `python_backend/extraction/keyword.py`)
The bucket SUM is right on all four with the fold ON (Statement 7.3 vs Invoice 4.3). The post-sum re-rank
`TYPE_TITLE_OWNER_PRECEDENCE` (:1214-1236; `type_title_owner_precedence` PROVEN_ON since mig 60) enumerates `_owners` over
`known_types` ONLY: a type whose bare name (or DB alias) stands alone as seg0 of a reading line inside the top band
(`_i <= 15` inclusive, or `_i/total <= 0.28`) per `_segment_is_heading(seg0, phrase, caption_ok=False)`; exactly ONE owner
with score > 0 → `best_type = owner`, `headings[owner]=True` — the sum is never consulted. On the skewed pages the geometry
row-rebuilder shears every table row so the type-cell `Invoice` lands ALONE at reading index 15 (the inclusive boundary);
the folded UNINSTALLED `STATEMENT` is never in `known_types` → cannot compete → `_owners == {Invoice}` → stolen. Toggling
ONLY owner-precedence flips 46/52 and nothing else. **SYSTEM, not skew:** a straight statement with the TYPE COLUMN FIRST,
or one bare `Invoice` sub-head line in the top 15, is stolen identically (measured synthetically). Census: Chris-200 →
exactly {46, 52}; the owner's copies → 0. The fold's `heading_only_lc` = {statement, letter} only under the shipped config
(other presets already carry their bare name as a scoring phrase) → herald's literal "folded names" B would miss a stolen
uninstalled Credit Note / Delivery Note / Receipt title → generalise.
**Oracle corrections to the framing:** (1) the reward is not two labels — a CONFIDENT stolen type is the 2026-08-08 defect
class in reverse: confirm or teach one and an Invoice template + Invoice-scope anchors bind to statement layouts (a
teach-poisoning vector). (2) The fold has been HALF-DEAD for its own exhibit class since mig 205: its pin arms only the fold,
never owner-precedence, and its fixture has the date column first — the shipped COMBINATION was never pinned (C3). (3) Going
forward B puts this class INTO the mig-216 redetect's scope (untyped + nudge → add type → heals) — an un-stated reward.
(4) The nudge on 44/39 comes from `type_detection` directly (`process_docs.py:1160` → `handler.js` `_resolveDetectedType`),
not from `_harvest_top_band_heading` — pin efficacy there (C8).

## The fix (gary, generalised B; pure additive branch inside the `if` at :1214, OFF = byte-identical)
```python
# after _owners is built (:1216-1231), before :1232
_blockers = set()
if (os.environ.get('TYPE_OWNER_UNINSTALLED_BLOCK', '0') != '0'
        and os.environ.get('TYPE_UNINSTALLED_HEADING_FOLD', '0') != '0'   # child of the fold (belt; the bridge nests it too)
        and known_types is not None):
    _installed_claims = {names of known_types} | {every alias of every INSTALLED type}   # Oracle C1 — NOT name_alias_lc
    for _tname in type_keywords:                       # every SHIPPED bucket name (config keys ∪ installed)
        _t = str(_tname or '').strip()
        if not _t or _t.lower() in _installed_claims or scores.get(_tname, 0) <= 0:
            continue
        if _top_band_owner(lines, total, [_t.lower()]):   # the :1221-1231 predicate, extracted VERBATIM into a pure helper used by BOTH loops
            _blockers.add(_tname)
if len(_owners) == 1 and not _blockers:
    ... (promotion exactly as today)
```
Blockers never enter `_owners` (an uninstalled name is NEVER promoted; `test_typeowner_on_needs_the_type_installed`
strengthened). Two owners of any kind → untouched → the SUM decides → exhibit: Statement@95 heading True →
`DETECTED_SLUG_FALLBACK` → untyped + "Add Statement" nudge — the path 44/39 already take. NOT Option A (a "shallower strict
heading" tie-break promotes when the uninstalled title sits deeper than a stray installed cell; ~40% of real headings sit
past the top quarter). NOT deskew (WRONG LAYER), NOT the `<= 15` band, NOT the row rebuilder (page-text grouping feeds
every doc), NOT the fold (make a folded name a competitor in scores) — the tallest-cluster geometry lever is its own arc
(`pendingfeatures.md` ~5349).

## Seam (Oracle-verified)
- `type_keywords` is a per-call copy (:989); installed names are `setdefault`ed in → keys = shipped ∪ installed.
- The boundary helper: :1222-1223 has `(total and …)`; total > 0 is guaranteed at :956 → verbatim extraction safe; the
  OFF-arm md5 gate covers the refactor.
- ORDER CONFIRMATION pins (`test_teach_side_gates.py:181-247`): no uninstalled standalone name → blockers ∅ → unchanged.
- **M1 (ship-blocking, C1):** an installed type's ALIAS equal to a shipped bucket name ("Sales Invoice" with alias
  "Invoice", no type named Invoice) would self-block → UNTYPED + "Add Invoice" on an install that HAS it → exclude installed
  names ∪ their aliases from blockers (never reuse `name_alias_lc`, which already holds the folded uninstalled names).
- **M2:** blockers WILL fire on ordinary docs ("Purchase Order 4500012345" in an invoice header reads as a standalone heading
  under `caption_ok=False`) — but that is exactly how OWNERS are detected today: with PO installed the same invoice already
  has two owners → the sum → Invoice. B's "one owner + one blocker → sum" is byte-for-byte today's two-owner path; it adds
  no new failure KIND, it extends an existing two-owner weakness to a new pair → no asymmetric depth/score guard; pin the
  trade-off and COUNT it (C5).
- **M3 close-sum:** a folded name earns ≤ 6.0 and nothing from mentions; a real invoice with a stray standalone "STATEMENT"
  line loses only with ZERO captions — not a real invoice; when the sum does go to the uninstalled name the outcome is
  untyped + nudge (review). Robust.
- **Separator pre-pass — B CAN touch a split decision, fail direction NOT review (C4):** `segmentation.py:615` uses
  `title_trusted` as the LAST-RESORT first-page witness; the mig-179 known-supplier-change cut requires a witness;
  `title_signal` returns `(None, False)` for an uninstalled winner → a stolen page that today yields `('invoice', True)`
  yields `(None, False)` under B → on a page with NO labelled number/date marker and no recipient+date shape the cut is
  LOST → an under-split nothing holds. Incidence ~0 (statements carry date markers) but MEASURE it.
- Machine-pin heal road unchanged (re-types only when the fresh slug is installed); B does not heal stored rows.
- M4 a DISABLED type counts as uninstalled (pre-existing fold behaviour; the mig-216 re-enabled road covers it).

## Conditions (binding) — C1-C10
**C1** alias exclusion (above) + pin: known=['Sales Invoice','Purchase Order'], aliases {'Sales Invoice':['Invoice']},
standalone "INVOICE" → ON type == OFF type == 'Sales Invoice'. **C2** symmetry pin: a page with standalone "DELIVERY NOTE"
≤ 15 and a bare "Invoice" seg0 ≤ 15 → `type(known=['Invoice','Delivery Note'])` == `type(known=['Invoice'], fold+B)` ==
'Delivery Note' ("a blocker is an owner the install lacks"). **C3** the fold's shipped-combination twin, proven RED first:
46's stored text under FOLD=1 + TYPE_TITLE_OWNER_PRECEDENCE=1 → record that HEAD yields Invoice, then green with B.
**C4** separation gate: the mig-178/179 arms (real_34 + the 09-16 templated stacks) OFF vs ON → boundaries identical, or
every diff explained as a page whose only witness was a WRONG trusted title. **C5** census (c) reports changed docs (all
with confirmed type ∈ the ablated set), blocker-FIRED docs with the matched seg0 text, and the THIRD-TYPE arm count
(blocked ∧ sum winner ∉ {owner, blocker} ∧ installed): 0 on 727 + warm_700 → pin the trade-off + log it; > 0 → route that
arm through the type-ambiguity review channel before any flip; add Purchase Order to one ablation arm. **C6** name
`type_owner_uninstalled_block`; ledger states child-of-fold, non-folded class inert when the fold is off, go-forward only.
**C7** fix stale comments `keyword.py:1019` ("DARK, mig 122" → graduated 205), `:1195` ("DEFAULT OFF" → PROVEN_ON 60),
`handler.js:583` (true only with B ON). **C8** efficacy pin at the recipe level: 46's text → Statement@95 heading True →
fallback 'statement' → `document_type` 'Statement' emitted → `_resolveDetectedType` unmatchedName; Chris-copy census asserts
`document_type_id` NULL + `detected_type_name` 'Statement' on 46/52. **C9 (FLIP gate)** Hard Set `statement_layout` class
(`stress_test/gen_hard_set.py`: type_col_first straight + 1.5° skew, subhead_invoice, remittance_advice) + CONTROLS (a
skewed INVOICE with a standalone "Statement" sub-head, GT invoice; an INVOICE with "Purchase Order 45678" with PO
uninstalled, GT invoice); scorer `score_hard_set.js:139-148`: an uninstalled GT type scores correct as untyped +
`detected_type_name == GT` (also fixes balance_bf / sib_statement). **C10** mig 217 INSERT OR IGNORE 'false';
`TEST_SWITCH_KEYS` → 15 + the three count pins (`test_default_flip_205_batch.js:64,67` + HELD :47-58;
`test_default_flip_215.js:37`; `test_migration216_quiet_redetect.js:30`); regex pin that the bridge sits inside the fold's
`if`.

## Tests (gary)
`test_teach_side_gates.py`: six typeowner pins green OFF and ON; fixtures `python_backend/tests/fixtures/
ironclad_statement_46_skewed.txt` + 44 control; new pins off_is_today · blocks_never_promotes (== the owner-prec-OFF
result, proves "untouched" not "promoted") · needs_fold · keeps_order_confirmation · declines_deep_uninstalled_heading
(STATEMENT at line 40 → promotion proceeds) · declines_a_mention ("VAT statement") · covers_scoring_phrase_names
(uninstalled CREDIT NOTE title + bare Invoice cell → ON Credit Note) · PINNED TRADE-OFF pins_the_sum_fallback
(ORDER_CONF_PAGE + standalone DELIVERY NOTE ≤ 15, DN uninstalled → Sales Order) · `_top_band_owner` direct (idx 15 True /
16-of-31 False / "date    Invoice" False) · C1 · C2 · C3. JS: `test_migration217_type_owner_uninstalled_block.js` mirroring
216's pin + the bridge-nesting regex.

## Gate before merge (DARK) · before FLIP
Merge: OFF arm md5-identical to the pre-change tree on realdoc (`RR_APP_ENV=1 OCR_RENDER_DPI=200`); ON M=0 + zero
per-field drop + type diffs ⊆ uninstalled-title docs; text census (a) Chris copy with the IMPORT-time known set → changes
exactly {46, 52}; (b) owner's 727 → 0; (c) per C5; C4 identical; all pins green OFF and ON with C3 demonstrably red on HEAD.
Flip: C9 Hard Set class wrong + would-file 0 on the controls, plus the C5 third-type count decision recorded.

## Fail direction
blocker + sum → uninstalled name wins → UNTYPED + "Add <type>" (review, with reason) · blocker + sum → the owner wins →
unchanged · blocker + sum → a THIRD installed type with a strong heading → typed (the one non-review arm = today's two-owner
behaviour; C5 counts it) · no blocker / fold OFF / `known_types` None → unchanged. No learning writes, no stored-row changes,
no teach ripple. Separation: the C4 under-split class must measure ~0.
