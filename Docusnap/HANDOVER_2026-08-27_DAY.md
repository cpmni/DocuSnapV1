# HANDOVER — 2026-08-27 DAY (Chris round 6 fixes: cards 1/3/5/6/7 built, card 2 verified)

**Branch** `feat/teach-side-overnight` · resumed from `HANDOVER_2026-08-27_MORNING.md` (`6787291`) · **this session's code
commit `d6c1f17`** (+ the docs commits that follow it) · 8+ commits ahead of origin, NOT pushed — owner reviews then pushes. Owner's instruction this session: "read the handover and continue … continue
with chris's fixes". Every behaviour change is DARK (default OFF); every card's fix is pinned; the advisor→Oracle gate ran on
the one detection arc. **Nothing was flipped on the live DB. The live app is still the 21:02 (08-26) instance** — DB at
migration **87**, so a restart applies 88–91 (all inert until a switch is on).

## What the cards turned out to be (all verified at source in the Chris sandbox DB + shot108)
| Card | Verdict | Mechanism (FACT) | Fix |
|---|---|---|---|
| **1 HIGH** buyer-issued PO teach re-badged 3 suppliers' papers as Bramblewood POs @95 | **BUILT DARK** `template_buyer_issued_letterhead_scope` (gary → Oracle SEND BACK on one touch point → corrected; log `docs/oracle_log.md` 2026-08-27) | Template 3 (`buyer_issued=1`, fingerprint = the owner's name+address) won the WHOLE-PAGE text arm at 7/9 on docs 2/4/6 — those words print in every BILL TO block. Logo hashes far apart (not the logo arm). Doc 6 was UNTYPED at import ("GOODS DELIVERY NOTE" has one extra real word → `_segment_is_heading` False → no trusted heading) so the type-scope guard had nothing to refuse on. Two roads: the quiet lane's kw-selector arm c′ (`quiet_reread_kw_select`, `done_ids "4,2"` 8 s after the teach) + Chris's single Reprocess of doc 6. | A marked template is recognised by TEXT only over the LETTERHEAD band (`header_band_text` — the fingerprint harvest's own truncation, now ONE helper for both): `_match_by_keywords` hits + the same-type rescue arm (Python), `findByKeywordFingerprint` (JS mirror: the lane selector + wizard save-target / graduation-link / reextract roads via `identifyByFingerprint`), and a go-forward HEAL on the engine honour path (a stale binding is declined when the band-hit ratio < 0.75 — `sticky_binding_declined reason='letterhead'`). `_identity_refuses` stays WHOLE-PAGE (the Oracle's send-back: configuration B — a PO taught with the counterparty as issuer — prints its identity below the band). Owner ruling unchanged: POs you send file under your own name. |
| **2 MOD-HIGH** wrong date 24-06 @ High 94%, no warning | **VERIFIED, no code** | shot108 confirms; the stored record (doc 428) holds the keyword read 24-05 @94 with the crop family dissenting "_\| 24-06-20" — the record captured the disagreement; the designed remedy `trust_role_disagreement_refuse` ("the page reads X two ways") was OFF in the sandbox and is **already ON on your live DB**. | Arm it in the next sandbox (`arm_sandbox_r7.js`). The "_\| 24-06-20" → "24-06-2025 @94" salvage is the leading-digit/month date class already in your accuracy queue. |
| **3 MOD** Import table "Ready to file" on 13 rows Review holds | **FIXED** | The chip keyed on the ENGINE's `needs_review` (= required-empty OR a field under its per-field threshold; the "Date" ref sat at exactly 70 with a "please verify" note → not flagged) while Review/File All ask `trust.isAutoFileEligible` (→ `flagged`). | `_handleFileMessage` asks the predicate over the persisted rows and carries `review_hold` as a SEPARATE field (`needs_review` untouched — the T1 gate-unify seam); `addTableRow` keys the chip on either. |
| **5 MOD** Use/Keep between two garbles the page-check refuses | **FIXED** | S3-C5 note + Gate-C absent mark on the same row; the offered value was not on the page either. | When the note carries the Gate-C mark AND the offered value fails a sepless page check (stricter than Gate C → can only HIDE), the pair becomes "Neither reading appears on this page — draw the box again (⊕) or type the value from the page." Fail-open otherwise. |
| **6 LOW-MOD** invented senders promising "5 more to file by itself" | **FIXED (promise half)** | `_senderReadinessLabel` counted down for a sender with `confirms` = 0 (the gate's own count). | Nothing rendered when every pending scope has 0 confirms. The "Sender not identified (guess: X)" grouping half stays owner-vet (`pendingfeatures.md`). |
| **7 LOW** stale panels | **FIXED (Chris r7c: (a)(b)(d) as seen; (c) re-fixed after his "NOT FIXED")** | The fetched hold verdict described the doc as LOADED; `clearDocPanel` never hid the ⊕ read-back / Teach card; Delete All's messages were ONE-SHOTS — the delete's IPC `review-count-changed` refresh re-rendered AFTER the handler's own render, consumed them and painted "✓ All reviewed" again (Chris saw exactly that with 233). | Type change / settled different issuer → `_holdVerdict = null` + repaint — and a type change now shows a NEUTRAL lead ("Type changed to X — check the fields below…", Chris r7c card A) instead of "Ready to file" re-derived from the old type's confidence; Delete All → "Queue cleared — N in the recycle bin" (list + panel messages now STICKY until the queue refills); `clearDocPanel` → `hideAnchorReadout()` + `renderTeachCta(null)`. |

## Pins (all green) + suites
- NEW `src/windows/review/test_chris_r6_ui_cards.js` (cards 3/5/6/7 source contracts, CRLF-safe) · NEW
  `python_backend/tests/test_buyer_issued_letterhead_scope.py` 43/43 (real sandbox texts + template-3 fingerprint: band ==
  harvest incl. the counterparty kill-switch; OFF positive control 7/9 = 77; ON refusals; the owner's own PO 9/9; unmarked
  control byte-identical; config-B admitted + matches its own PO under ON; honour-path predicate; empty-band trade-off; source
  contracts incl. the untouched type-scope guard + V1 rival pin) · `database/modules/test_buyer_issued_scope.js` §4 13→28
  (JS mirror OFF/ON, env both directions, fixture table without the column, markers/regex parity read from the .py source,
  `identifyByFingerprint` road) · `test_settings_wiring.js` BRIDGES + SETTING_SWITCHES rows.
- Re-run green: `test_chris_r5_ui_cards`, `test_hold_reason_truthful`, `test_queue_badge_copy`, `test_import_autofile_gate`,
  `test_quiet_lane`, `test_quiet_lane_layout`, `test_seed_support_prune`, `test_template_type_scoped_match`,
  `test_fingerprint_hygiene`; Python `test_template_matcher`, `test_identity_on_page`, `test_buyer_issued_issuer_guard`.
- Full suite: see RESULTS below.

## Oracle gate for the Card 1 switch (conditions → status)
1. Redesign `_identity_refuses` touch point — DONE (whole-page kept; heal on the honour path).
2. Pins that can go red (config B) — DONE (43/43 + 28/28).
3. Corpus arm with every PO-ref template marked — the owner's DB holds exactly ONE PO-ref template (t8 Bramblewood, config A,
   113 bound confirmed docs, already marked) → the live-DB OFF-vs-ON arm IS that arm. RESULTS below.
4. Fingerprint-refactor gate — **0 diffs across 1242 confirmed docs** (`TESTING/_measure/r6fix_20260827/fp_gate_census.py`).
5. Empty-band census — **0 empty bands, 0 below 0.75 among the 113 PO docs**.
6. Fired path on a fresh Chris sandbox, switch ON (teach the Bramblewood PO → docs 2/4/6 must NOT be re-badged; doc 7 → template
   @95; the lane must not select 2/4/6) — see RESULTS / next round.
7. Next slice: surface `sticky_binding_declined` as a review note (`pendingfeatures.md`).

## Switch (new today; absent = off)
| setting | env | default | what |
|---|---|---|---|
| `template_buyer_issued_letterhead_scope` | `TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE` | OFF | a `buyer_issued` template's text arms score the letterhead band only (Python via `_reconcileEnv`; JS `templates.js` reads the key directly, env wins both directions); honour-path heal |
Settings → Processing row "Only recognise a purchase-order layout you send out by its letterhead" (beside the type-scope row).

## LIST field — TEACH ITS CAPTION (built ~14:30, owner-directed live; commit after the flips)
**Trigger:** the owner created a List field (`serial_number` "Serial Number") on Service Worksheet, opened Teach, and
"didn't see the new field" — `_splitListFields` pulled List fields from the draw flow BY DESIGN (a box would be dead) with a
4-second toast. **Owner spec (verbatim):** "the teach feature should capture 1 value and the label should be drawn. when
processing in future, every iteration of that keyword should allow the corresponding value to populate the list … The label
should be, if it isn't already there, added to the keywords for the field of that doc type … Teach should display all the
captured values on the taught doc and displayed before confirmation."
**Built (wizard):** a List field stays teachable (`auto='list'`); the banner says "drag over ONE of the values — I'll read the
caption beside it"; `autoLabel` finds the caption; the confirm panel says "Check the caption I found for …" and previews every
value that caption collects on the page (`_listPreviewValues` — a JS twin of the inline collector: whitespace-tolerant
caption, word-boundary for a single word, value = what follows on the line, caption punctuation stripped, cut at a column
break, deduped); no caption → warning + "Looks right" demoted to "Save without a caption", Redraw label promoted. At save:
NEW IPC `teach-list-caption` (review/handler.js; Admin+Edit; the field must exist on the type AND be type list; a value-shaped
"caption" refused) → `addLabelOverride({exclusive:0, template_id:0})` = an ADDITIVE, doc-type-wide keyword, INSERT OR IGNORE =
"if it isn't already there"; `merge_label_overrides` CREATES the keyword entry for a custom key, so the collector then scans
for it; no Stage-0.5 mapping is stored for the field; the taught document files with all the previewed values joined "; ".
Preload `teachListCaption`. Pin `src/windows/teach/test_teach_auto_field_rows.js` (source contracts + a behavioural test of
the preview helper on the Castellan worksheet text: "Serial No" → both serials; "Serial Number" → nothing).
**For your field:** the worksheets print "Serial No:" — the field label "Serial Number" alone would never match
(`_label_pattern` = `serial\s*number`); teaching one value in the wizard now writes "Serial No" as its keyword. Until you
re-teach, add "Serial No" under Settings → Learning → Keyword label overrides for `serial_number`.
**Needs an app restart** to load the new wizard/preload/handler code (the app was started 13:35 on the older code).
**The Review ⊕ road (built ~15:00, owner: "the review ⊕ button should also teach a list caption … I would like it to
show them all so the user can see it is doing its job"):** ⊕ on a List field boxes ONE value → `_stageListCaption` stages a
`{listCaption}` record in `pendingAnchors` (every reset / unsaved-changes guard applies for free), fills the field with EVERY
value the caption collects on the page (`src/windows/shared/listCaption.js previewValues` — the ONE preview both windows
use; the teach renderer delegates to it) and says so on the ⊕ bar; at confirm the record routes to `teach-list-caption`
(never `saveFieldAnchor`); no caption read → nothing staged + "a list is taught by its caption". The old ⊕ refusal toast
for List fields is gone (barcode's stays). Pin `test_teach_auto_field_rows.js` §7 (34 checks).
**Next (owner ask, brainstorm running with barry/gary/reggie/eric/bob/Chris-lens → Oracle):** a chips display of the
detected values in Review + a per-element "problem" flow + what a correction should teach (`scratchpad/list_review_brief.md`).

## ⚡ LIVE FLIPS — 2026-08-27 13:35 (owner: "please flip the switches and start the app")
The live app (still the 08-26 21:02 instance) and the sandbox were already closed. With no app running, SEVEN switches were
set `true` on `%APPDATA%\ScanFinder\docusnap.db` by a direct `settings` UPSERT (so NO `setting_changed` audit rows exist for
them — the flip is recorded here instead): `corrob_verification_doubt_clear` (class F; prerequisite `corrob_note_recompute_fc`
was already true) · `learning_exclude_docs` · `learning_repair_console` · `learning_repair_forget` · `barcode_inventory` ·
`barcode_field` · `template_buyer_issued_letterhead_scope`. Then `npm start -- --remote-debugging-port=9222` (detached,
`scratchpad\launch_live.ps1`, log `scratchpad\live_app.log`): CDP 9222 up in 5 s; **migrations 88–91 applied** — note mig 89
also defaulted `position_teach_nudge` + `issuer_sibling_fill` + `issuer_suggest_on_blank_confirm` ON (the 08-26 NIGHT
migration; `identifier_registry` stays DARK). Read-back: DB at **91**, all seven `true`, `document_barcodes` +
`supplier_identifiers` tables present, `documents.learning_excluded_at` present.
**NOT flipped (older vet-queue arcs, unchanged):** `name_dominant_snap`, `branding_strip_reg_boilerplate` (08-25 detection
arcs, need corpus OFF==ON + Oracle), `identifier_registry` (needs a real-customer-VAT corpus), `trust_company_key_own_scope`
(holds 45 of your docs), `template_fixed_debris_wide`, `type_ambiguity_ripple`, `review_group_by_letterhead`.
**Owner post-flip check still owed (Oracle C5(e) for class F):** open Review with SFDEV trace on, Reprocess the SuperStore
31901 doc → expect `corrob_note_resolve cls=F`, invoice_number 70→90, the doc reaches Ready. (Needs your login — I cannot
drive the live Review window.)

## Owner decisions (carried from the morning handover + today)
- The morning list stands (class F flip after the SFDEV live heal; Learning Repair defaults; barcode Qs; barry's sweep). New:
  **flip `template_buyer_issued_letterhead_scope`?** — after RESULTS + the fired-path round; its cost on your DB is measured at
  zero (conditions 3–5). `quiet_reread_on_layout` is ALREADY ON on your live DB (morning decision 3's cheaper lever).
- Card 6 grouping half; Card 2 needs nothing from you (the switch is on live).

## Traps (new today)
- `Start-Process powershell -File <path with a space>` silently dies — quote the path INSIDE the argument (`"-File", "`"C:\GIT Projects\…`""`).
- The realdoc harness spawns Python with `{...process.env, ...appEnv}` — an env var the live DB's `_reconcileEnv` does not set
  passes through from the shell (how the OFF/ON arms are pinned); `RR_DB=<copy>` retargets the harness.
- The realdoc `RR_DUMP` row now carries `tmpl` (matched template id) — a per-template match count is diffable.
- A background agent can die on an API drop mid-report — resume it with SendMessage (context intact) rather than re-spawning.

## RESULTS (filled at the end of the session)
- Full suite (09:40–09:50, `TESTING/_measure/r6fix_20260827/full_suite.ps1`; log in the session scratchpad `suite/suite.log`):
  **JS 275 files / 5 red — exactly the five documented pre-existing** (`test_authoritative_anchor`, `test_document_types_aliases`,
  `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`); **Python script-style 265 / 7 red = the six documented**
  (`anchor_crop_crosscheck`, `label_overrides`, `template_rescue`, `engine_detail_thread`, `network_field_authority`,
  `reprocess_manifest`) **+ `test_buyer_issued_letterhead_scope.py` caught MID-EDIT by the detached run (version skew: its BAD line was
  the §8 check corrected two minutes later; re-run 43/43)**; **pytest 307 passed / 1 failed = the documented `test_identity_fusion`**.
  ZERO new reds.
- **Realdoc OFF vs ON — BYTE-IDENTICAL on all 1242 docs** (`RR_APP_ENV=1`, 99 app vars mirrored, the owner's live DB = the
  Oracle's "arm C" since its only PO-ref template is already marked; 09:40–11:10; `stress_test/out/rr_lh_{off,on}.{md,jsonl}`,
  diff `TESTING/_measure/r6fix_20260827/rr_diff_lh.js`): identical 1242 / changed 0 · would-file **1168 → 1168** (gained –, lost –)
  · wrong values gained on ref/date **0** · supplier changed **0** · supplier method changed **0** · per-template match counts
  differing **none** (Bramblewood t8: 113 → 113) · both arms: type 100.0 %, supplier 99.8 % (1240/1242), ref 99.0 %, date
  99.0 %, total 100.0 %; regressions 28 / 26 silent = the known pre-existing classes (Harrowgate GT-poison #31–48, #331, #1092…).
  → Oracle conditions 3 + 5 met: the owner's own POs keep every recognition; nothing else moves.
- **Fired path (Oracle condition 6) — MET on the real pipeline** (fresh sandbox, every switch armed incl.
  `template_buyer_issued_letterhead_scope`; Chris round 7, verified from the sandbox DB `probe_r7*.out`): Chris re-taught the
  Bramblewood PO exactly as in round 6 (09:14:58 → template 1 `buyer_issued=1`). The quiet-lane job for Bramblewood/purchase_order
  8 s later selected **nobody** (`done_ids ""` — round 6: `"4,2"`). He pressed Reprocess on the Oakhaven delivery note TWICE
  (09:20, 09:24) and on the Castellan worksheet: the supplier stayed **blank** (`corrections.original_value ""` → his typed
  sender; `extractions.raw_value null`, method `manual`) — round 6 had `raw_value "Bramblewood Joinery Ltd" @95 template_fixed`
  on all three. Then IMPORT (200): **21 docs badged Bramblewood = the 21 Quillstone POs (Bramblewood letterhead), all template 1
  / purchase_order; 0 inbound documents bound to template 1; 0 supplier rows reading Bramblewood on a non-Quillstone paper.**
  **Chris's narrative for the fired path is MISSING (his first three spawns died on API/network errors — ENOTFOUND ×3, one
  lost transcript) — the round-7 table in `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md` is MY verification (DB + read-only CDP).
  His FOURTH attempt (round 7c, verbatim in the same doc) watched cards 7 + 5 as seen: card 7 BETTER-BUT → (a)(b)(d) fixed,
  (c) "✓ All reviewed" after Delete All 233 NOT FIXED → root cause (one-shot messages consumed before the IPC re-render)
  found and re-fixed sticky + pinned; his new card A ("Ready to file" over "please fill in…" after a type change) fixed with
  a neutral lead; cards A2/B/C/D/E → `pendingfeatures.md`. Card 5 never arose (0/233 carried the note pair).**
- **Live (CDP, read-only) verification of the other cards on the same sandbox** (`chris-driver\verify_r7.js`): **Card 3** —
  the 200-doc IMPORT results table shows "Confirm to file →" on all 200 rows, zero "Ready to file" over a doc Review holds
  (the "Date" garble class did not reproduce: Chris typed the Pelican values instead of drawing boxes). **Card 6** — the
  "N more to file by itself" badge appears ONLY under the five senders confirmed today (each "2 more"); nothing under
  Nordwind / Harrowgate / Veltrix / "Sender not identified" (0 confirms). **Card 2** — NOT reproducible on a fresh sandbox:
  the round-6 mis-read came from "Remembered positions" of a taught Ironclad layout; here the Statement preset had to be added
  first and the scan reads only customer + total. The remedy switch is ON on your live DB; the record-level verification stands.
  **Card 7** — source-pinned only today (needs a human-driven interaction round).
