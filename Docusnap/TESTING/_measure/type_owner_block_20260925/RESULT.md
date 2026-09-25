# type_owner_uninstalled_block (mig 217) — build gate (2026-09-25)

**Change:** `keyword.py` TYPE_TITLE_OWNER_PRECEDENCE re-rank — an uninstalled SHIPPED type name standing alone as a
strict top-band heading is a BLOCKING owner (two owners → the sum). DARK; child of the fold; env
`TYPE_OWNER_UNINSTALLED_BLOCK`. Design `docs/designs/TYPE_OWNER_UNINSTALLED_BLOCK_2026-09-25.md`; Oracle C1-C10 in
`docs/oracle_log.md` 2026-09-25.

## Text census (`census.py`, read-only DB copies; product type env = fold + owner-precedence + the other PROVEN_ON keys)
| arm | DB copy | known set | docs | changed OFF→ON | third-type arm | OLD-vs-NEW block-OFF mismatches |
|---|---|---|---|---|---|---|
| (a) | Chris 2026-09-24 sandbox | IMPORT-time {Invoice, Sales Order, Purchase Order, Quotation} | 200 | **2 = docs 46, 52** (Invoice@81/80 heading → Statement@95 heading) | 0 | 0 |
| (b) | the owner's LIVE DB copy (`live727.db`) | its 12 installed types + aliases | 758 | **0** | 0 | 0 |
| (c) | live copy, ABLATED (− Statement/Credit Note/Delivery Note/Receipt/Remittance/PO) | 8 types | 758 | **0** | 0 | — |
| (c2) | Chris copy, ABLATED | 4 types | 200 | 2 = docs 46, 52 | 0 | — |
| — | `warm_700.db` | — | 0 (stores no `ocr_text`; not a text-census source) | — | — | — |

- **Efficacy (Oracle C8 at the recipe level):** on the import-time set the ONLY changes are the two exhibit docs — both
  become `Statement@95 heading=True` → `DETECTED_SLUG_FALLBACK` → untyped + `detected_type_name='Statement'`. (c2)'s
  "confirmed type not in the ablated set" rows ARE those two: their `document_type_id` is the machine-typed WRONG Invoice
  (status `needs_review`, never confirmed) — the defect, not a regression.
- **Blast radius:** 0 changes on the owner's 758 real texts, installed OR ablated → the third-type arm (Oracle C5) is
  EMPTY on real data → the trade-off is pinned (`test_owner_block_pins_the_sum_fallback`) and needs no review route.
- **OFF-equivalence (the helper refactor):** the PRE-change `keyword.py` (`git show 7057b87`) and the new one produce
  IDENTICAL `{type, confidence, heading, all_scores}` on all 958 texts with the block unset. The only Python change is
  inside `detect_document_type`, and every road (import, reprocess, Quick, the separator's `title_signal`) reaches it
  through that function → the realdoc OFF arm is byte-identical by construction (queued in `NIGHT_RUN.md` for the
  formal md5 record; not a build blocker).

## Pins
- `python_backend/tests/test_teach_side_gates.py` 36/36: the six original typeowner pins + ten new (`off_is_today` =
  the C3 red-first fact on the REAL fixture: Invoice heading True while the sum has Statement ahead; `blocks_never_promotes`
  == the sum election; `needs_fold`; `keeps_order_confirmation`; `declines_deep_uninstalled_heading`; `declines_a_mention`;
  `covers_scoring_phrase_names` (CREDIT NOTE); `pins_the_sum_fallback` (trade-off); `alias_never_self_blocks` (C1);
  `symmetry` (C2)). Fixtures `tests/fixtures/ironclad_statement_{46_skewed,44_straight}.txt` (synthetic corpus issuer).
- `test_type_uninstalled_heading_fold.py` §9 (Oracle C3): the shipped COMBINATION on the real skewed exhibit — block OFF
  → Invoice heading True (recorded), block ON → Statement@95.
- `database/modules/test_migration217_type_owner_uninstalled_block.js`: seed/list/count 15/no force-ON/manual ON survives;
  the bridge nested INSIDE the fold's block (C10); the engine's blocker loop shape (helper symmetry, C1 exclusion, never
  into `_owners`, promotion body unchanged, C7 comments). Count pins 205/215/216 → 15.
- `test_segmentation.py` green (title_signal unchanged).

## C4 — separation arms — MET
`c4_run.sh` = the 2026-09-16 soak census (`seg_census3.py`, the SHIPPED segmentation functions + `walk_boundaries`,
four internal arms base/both/three/veto_known) re-run under the product type env (fold + owner-precedence + the other
PROVEN_ON keys) twice, the block OFF vs ON being the ONLY difference. Inputs: the repo copies of `doctypes.json`,
`known3_sandbox.json`, `gt.json`, `controls{,2..5}` + GT; the soak's PDF stacks (old scratchpad, 20 files); templates =
`templates.getAll()` exported from the owner's live DB copy (job scratch — real data, never committed).
- **Stacks** (`tb_*`, `bundle_*`: 20 files, 95 expected boundaries) + **controls 1-5** (46 files): `c4_diff.txt` = **0 lines**
  — every per-file boundary list, every named/witness tuple and every TOTAL line is byte-identical OFF vs ON. No split
  decision moved. (Per-arm totals unchanged from the 09-16 record: three = 90/95 on the stacks, 6/6, 10/10, 8/8, 6/6, 25/25.)
- **`real_34.pdf`** (the owner's real 34-page Print Tracker bundle): its original no longer sat in the scratch Bundles
  dir (0 files scored in the main pair); re-stitched from the soak's 34 split pages into job scratch and run as its own
  pair — `c4_real_run.sh` / `c4_real_{off,on}.txt` / `c4_real_diff.txt`: **OFF == ON (diff 0 lines), 34/34 boundaries
  right in every arm (base / both / three / veto_known), 0 lost, 0 over-splits.**
- The `single_0*` over-split controls are gone with the old scratchpad (not re-creatable from splits); the five control
  sets above carry the over-split guard for this pair.

## Owed before FLIP (not before build)
- realdoc ON arm at `RR_APP_ENV=1 OCR_RENDER_DPI=200` (M=0, zero per-field drop, type diffs ⊆ uninstalled-title docs) +
  the OFF md5 record (queued).
- Oracle C9: Hard Set `statement_layout` class (type-first straight + 1.5° skew, subhead_invoice, remittance_advice) +
  the two controls + the scorer rule "an uninstalled GT type scores correct as untyped + `detected_type_name == GT`"
  (also fixes balance_bf / sib_statement).
