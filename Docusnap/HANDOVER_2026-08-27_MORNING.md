# HANDOVER — 2026-08-27 MORNING (the autonomous overnight run of 2026-08-26 → 27)

**Branch** `feat/teach-side-overnight` · **HEAD `d0d74fb`** · 5 commits tonight, LOCAL / NOT pushed (owner reviews then pushes):
`9861d37` landmark box snap (+pin) · `c80e387` the three arcs (class F + Learning Repair v2 + barcodes/LIST, ALL DARK) ·
`8cb80ac` two source-contract pins updated · `df0c86b` docs · `d0d74fb` Chris's two cards on tonight's code fixed + his report/
triage. Tracked tree clean. Pre-existing untracked cruft untouched (do NOT commit
`TESTING/_measure/*`, old `HANDOVER_*`, `x`, `../Backup`, the 08-13 design doc, the stray scripts/tests listed by `git status`).

The owner's brief for the night: finish the three pending items → redesign Learning Repair with the agents → check what a
package like this is expected to have (barcode field, LIST field) → build what the agents agree on, safely → run Chris on the
CHRISBOT folder + a thorough Settings review → report questions for the morning. Everything below is what happened.

---

## ⏭ OWNER DECISIONS FOR THE MORNING (ranked; nothing here is flipped live)

1. **CLASS F flip — the evidence is in and it is NOT vacuous.** Realdoc OFF vs ON on your live DB (1242 confirmed docs,
   `RR_APP_ENV=1`): F cleared **24 edge-cut notes — all 24 CORRECT** (the SuperStore 3190x class you flagged: 31900/31902/
   31903/31904/31905/31906/…), field 78→90, would-file **1168 → 1192**, **0 wrong values gained, M unchanged at 12
   (all pre-existing: the Harrowgate GT-poison class #31-48 + #331/#1092 supplier), M_type 0, 0 lost**, 1218/1242 docs
   byte-identical. Oracle C5 still wants, before a live flip: the SFDEV live heal of 31901 in YOUR app (Review → Reprocess
   that doc with the switch on) and one clip positive control. **Flip order (enforced in code, C4):** `corrob_note_recompute_fc`
   must be ON (it is on your DB) before `corrob_verification_doubt_clear`. Diff tool: `scratchpad/rr_diff_f.js`; arms in
   `stress_test/out/rr_f_{off,on}.{md,jsonl}`.
2. **Learning Repair v2 — three UX defaults (Oracle ruled, you confirm):** (a) "Start fresh" is per sender × document type
   (auto-widen to the sender when it has one type)? (b) after a forget the sender's filed documents STAY filed + searchable and
   simply stop teaching (recommended; today's "requeue" road exists if you prefer back-to-Review)? (c) never move files on
   disk on a rename/merge; an explicit "Re-file N" button instead? Also: do you want a WHOLE-SENDER forget (logo + VAT/company-
   number registry + accepted-issuer) — tonight's forget deliberately leaves those (a sender may have other types).
3. **Targeted field re-slice after a ⊕ teach — gary AND oscar say WRONG LAYER for the filing road** (details in
   `pendingfeatures.md`): the full-page OCR is already skipped on a reprocess (cached `ocr_text`), so the saving is ~2-3× not
   10×; a field-only WRITE poisons the re-read holds' baseline (re-opens the Oracle C3.3 misfile) and can never corroborate
   (one family → never heals a note → "nothing cleared"). **The cheaper lever exists: flip the Oracle-signed layout arm
   `quiet_reread_on_layout` (DARK)** — armed in Chris's sandbox tonight for that evidence. Your call: flip the arm after his
   round, or fund the suggestion-only "quick read" pill after a timing measurement.
4. **Barcode field — three questions only you can answer:** which symbologies do your customers actually print (courier/
   delivery labels, bill-payment barcodes, supplier document IDs)? may a barcode field be the ref/filename role? should it ever
   be `required` (an absent decode would then block filing)? Slice B2 (LEARN at confirm so it can auto-file) is designed
   (reggie's rules) and waits on these.
5. **Barry's "what a package like this is expected to have" sweep — top 6, ranked:** searchable-PDF text layer on the FILED copy
   (must-have; **Q: may the filed PDF differ from the original bytes, given originals are kept?**) · barcodes (built) · exact-
   duplicate skip at import (L1 quick win) · export/accountant pack + saved search (**Q: Xero / Sage / QuickBooks?**) · supplier/
   customer list import as a witness · LIST finish (chips, long-format CSV, repeated XML values). Rejected with reasons: email-in,
   print driver, tags, retention, handwriting, TWAIN.
6. **Chris's round** — see the section at the foot (appended when his report landed) and `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`.

---

## WHAT SHIPPED (commit `c80e387`, every switch DEFAULT OFF, byte-identical off)

### 1. CLASS F — one general "corroboration clears a verification-doubt note" rule (the #1 item; Oracle SIGN-OFF-W/COND)
`engine.py` class F in `_resolve_corroborated_notes` (env `CORROB_VERIFICATION_DOUBT_CLEAR`, setting
`corrob_verification_doubt_clear`, Settings → Processing "Don't ask to double-check a value two independent readings already
agree on"). Clears the note AND lifts the FIELD to 90 (the edge-cut caps the field at 70; trust.js reads the field — popping
the note alone was cosmetic) iff: the mark ∈ the write-site constants (`_EDGE_CUT_NOTE`, `_FT_FALLTHROUGH_NOTE`,
`_SHAPE_TRIM_NOTE`, `_REREAD_NOTE_HEAD` — deny-by-default) · ≥2 DISTINCT page families agree, no dissent · an UN-noted ≥80
witness from a different page family · exact learned skeleton on a non-freetext/non-currency class **+ a LENGTH leg the C1 pin
itself found** (`_fold_shape` collapses every pure-digit skeleton to `#`, so `3190` scored 1.0 against a `#####` history — the
raw skeleton must be a learned `shape_families` variant) · no pending corrected_to · never identity/names/human methods ·
**C2** totals/currency-typed fields refused · **C3** the re-read mark accepts only a KEYWORD witness · **C4** `_reconcileEnv`
arms F only where `corrob_note_recompute_fc` is on. The emit's bucket is hoisted to `_corrob_record_bucket` (logic unchanged;
emit suites green). Pins: `test_verification_doubt_clear.py` 39, `test_corrob_note_resolve.py` 51. Verdict logged in
`docs/oracle_log.md` 2026-08-26 NIGHT.

### 2. LANDMARK BOX SNAP — committed `9861d37` (was built, uncommitted) + a source pin in `test_settings_wiring.js`.

### 3. LEARNING REPAIR v2 — selector + console + "start fresh" that REALLY forgets (Oracle SIGN-OFF-W/COND C1–C6)
**The finding (barry + gary, verified):** the old "Forget learning for this type" was a HALF-forget — `recoveryService`
cleared anchors/hints/rules and left everything that teaches: the owned layout (template + frozen sender + logo hashes) and the
LIVE-derived model (`getFieldFormats` / `scopeTrust` / `getDominantSupplier` kept counting the confirmed docs) — a "forgotten"
sender stayed warm and GRADUATED.
- **Slice 0 (default ON, inert until stamped):** mig 90 `documents.learning_excluded_at` + ONE predicate
  `machine_vias.learningExcludedSql(db, alias)` threaded into 17 learning-feeding readers + the type-ambiguity waiver counts
  (a delegate did the sweep; its diff was verified, one of its 87 pins had caught my service literal). NEGATIVE list pinned
  (search/browse/counters/writers untouched). `_cleanupAutoMoneyFields` deliberately NOT threaded (a destructive startup guard).
  Kill `LEARNING_EXCLUDE_DOCS=0`. Pins: `test_learning_excluded_readers.js` 87.
- **Slice 1 (`learning_repair_console`):** `learningScopeService.listScopes` — one row per sender × type from documents ∪ every
  learning table (17 scopes on your DB in 308 ms; orphaned learning surfaces) with plain-word graduation. Settings → Learning
  Repair shows a selector (search + chips: worth a look / not filing by itself / learning-but-no-documents / no sender) → click →
  the console (status sentence + today's document list + Start fresh + Undo). The typed picker stays while the switch is off.
- **Slice 2 (`learning_repair_forget`):** `learningRepairService`: dryRun (the consequence sentence from the SAME counts the
  forget acts on) + forgetScope: JSON snapshot (userData `repair-snapshots/`) → exact-scope deletes (C3) → per-doc retract ONCE
  (C1: `learning_retracted_at` stamped while confirmed; `repairService` send-back/delete skip an already-retracted doc; restore
  never re-plants an excluded doc; a HUMAN confirm clears both stamps in `confirmIfReviewable`) → owned templates removed with
  runtime `PRAGMA foreign_key_list` child enumeration (C2 fail-closed: a template whose confirmed docs include another sender,
  or another type, is REFUSED + reported) → exclusion stamps → `<slug>.json` hygiene (C6). Corrections KEPT. Undo = exact row
  restore by id (C4) incl. the `__global__` hint twins + identifier rows. Then the quiet lane reason `repair` re-reads the
  sender's now template-less held docs under "Read again after a learning repair — confirm once." (C5). Logos/identifiers/
  accepted-issuer survive; files on disk never touched. Pins: `test_learning_repair_service.js` 32.
- LATER (pendingfeatures): remembered-values editor, layouts canvas, rename/merge arc, whole-sender forget, "Recently forgotten",
  the Learning tab's raw inventory → SFDEV-only.

### 4. BARCODES (barry → gary; reggie value rules) — `barcode_inventory` + `barcode_field` (both DARK)
- **Slice A:** `python_backend/ocr/barcodes.py` — one zxingcpp (Apache-2.0, already vendored) pass per OCR-rendered page (no
  second render): every 1D/2D symbol, SFSEP separator payloads excluded, invalid decodes dropped, deduped, capped, never raises.
  `process_docs.py` threads rows to the engine and emits `barcodes` TRI-STATE (absent = no decode ran → rows kept; `[]` →
  cleared). mig 91 `document_barcodes`; persisted at import + INSIDE the reprocess transaction; `documents.search` full-text
  reaches a bar-only value. Pins: `test_barcode_decode.py` 16 (round-trip through zxing's own encoder at 2-3 px/module),
  `test_document_barcodes.js`.
- **Slice B:** field type **"Barcode / QR code"** (editor dropdown behind `window.__barcodeFieldOn`). Engine Stage 1.5: the decode
  is the ONE writer — exactly one code-like decode → value @100 + "Read from the barcode printed on this page — please confirm it
  once." (no learning yet → the note holds every doc: correctness first); several → EMPTY + a note listing them (never
  first-wins); URL/vCard → unsupported note. The key set is kept out of the keyword scan and drives the LIST-style ownership
  skips (mapping seed reclaim, Stage 2, 2.6, 2.5b, 4.5, hints). ⊕ teach refused; the teach wizard skips it with the reason;
  `field_charsets.barcode: null`. Its notes are NOT in the class-F allowlist (pinned). Pins: `test_barcode_field_stage.py` 19.
- **LIST field (the owner's question "is it properly implemented?") — YES for the printed layout it was built for:** a repeated
  inline caption ("Serial No: X" per line) collects EVERY occurrence, deduped, joined "; " (`list_field_scan`, ON by default via
  mig 70; 9 pins). **Residuals:** a caption ABOVE a vertical COLUMN reads element 1 only; no count witness; no per-element search
  snippet. Tonight (reggie): an element carrying `;` is refused at the one writer; the Review split narrowed to `;` only
  (a comma inside an element is data). Pin 10 added.

### 5. Test status (full suite run 23:23–23:28)
JS 274 files / Python 264 script-style + 308 pytest. **Every red was already red before tonight** (verified by running each
against the previous commit in a worktree) except two source-contract pins that matched old literals — updated in `8cb80ac`.
Pre-existing reds (unchanged): JS `test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`,
`test_teach_multipage`, `test_document_types_aliases`; Python `test_identity_fusion` (pytest) + `anchor_crop_crosscheck`,
`label_overrides`, `template_rescue`, `engine_detail_thread`, `network_field_authority`, `reprocess_manifest`.

---

## SWITCH TABLE (new tonight; all seeded by nothing — absent = off)
| setting | env | default | what |
|---|---|---|---|
| `corrob_verification_doubt_clear` | `CORROB_VERIFICATION_DOUBT_CLEAR` | OFF | class F (needs `corrob_note_recompute_fc` ON — enforced) |
| `learning_exclude_docs` | `LEARNING_EXCLUDE_DOCS` | **ON** (inert until a doc is stamped) | the ONE learning-exclusion predicate |
| `learning_repair_console` | — | OFF | the sender selector + console UI |
| `learning_repair_forget` | `LEARNING_REPAIR_FORGET` | OFF | the "Start fresh" door (enforced in the service) |
| `barcode_inventory` | `BARCODE_INVENTORY` | OFF | decode + persist every page barcode; search |
| `barcode_field` | `BARCODE_FIELD` | OFF | the Barcode / QR code field type + Stage 1.5 |
Migrations: **90** `documents.learning_excluded_at`, **91** `document_barcodes`. Your live DB is still at 89 until you restart
the app (nothing is stamped/written by either until a switch is on).

## CHRIS SANDBOX (left running for you)
CDP **9223**, PID **3060**, `scratchpad/chris-sandbox/` (fresh DB, `userData\docusnap.db`), his docs `chris-sandbox\CHRISBOT`
(copy of the desktop folder, 472 files), output `chris-sandbox\Output`. Armed in HIS DB only: the six switches above +
`quiet_reread_enabled`, `quiet_reread_on_layout`, `list_field_scan`, `corrob_note_recompute_fc`. `/christest` rebuilds it.

## TRAPS re-confirmed tonight
- The Bash tool here has no node/npm/git; PowerShell has no heredoc → commit via `git commit -F <file>` written by the Write
  tool (and strip the BOM — `Out-File -Encoding utf8` writes one into the commit subject; use `WriteAllText(..., UTF8Encoding(false))`).
- The background Bash/PowerShell tool has a 10-minute ceiling — the ~45-min realdoc arms must run DETACHED (`Start-Process
  powershell -File …`), then poll the done marker.
- A delegate's report said 87/87; my run said 86/87 — the missing one was MY new service carrying the filter literal. Verify the
  delegate's diff AND re-run its pins yourself.
- `documents.search` defaults to `status='confirmed'` — a fixture pin over queued docs must pass `status`.
- `_fold_shape` makes every pure-digit skeleton `#`: any "learned shape" check on a digits-only ref is LENGTH-BLIND unless you
  read `shape_families` variants.
- The 08-25 realdoc arms took 22 min each; tonight's 1242-doc arms took ~23 min each (8 shards).

## CHRIS ROUND (2026-08-26 NIGHT / 08-27; fresh sandbox, CHRISBOT 472 docs; verbatim report in `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`)
**Numbers:** 472 in → **279 filed, 279 under the right company, 0 wrong type, 0 unknown-date folders, 149 filed by itself.**
Cold batch 0/200 by itself → "File All Ready" filed 115 in one click (26 s, 0 wrong); **warm batch 116/200 by itself (58%;
round 5 = 98)**; scanned 13/20; 20 exact duplicates all `-DUPLICATE`. **Every scary button told the truth** (truth-table in
the report). Leak check: the owner's `Documents\Scan Finder` + live DB last written 21:18/21:10 — before the run; nothing
left the sandbox. **Verdict: "Yes — I'd keep using it after two weeks, and pay."**
**Tonight's features as he saw them:** Learning Repair selector = "the right idea… Wanted: this"; "Start fresh" warning honest,
Undo worked, the next Harrowgate scan filed itself after Undo; the layout arm DID re-read siblings after his re-teach (owner
test c — the re-slice question answered: it works, on grey copies it returned a different garble → card 5); the barcode field
row was INVISIBLE when the page had no barcode (card 4) — **FIXED tonight** (an empty `barcode_none` row now renders; a
barcode field can no longer be the Date role; `is_variable`); the console showed another sender's "worth a look" doc + said
"Learned from 41" right after a forget (card 8) — **FIXED tonight** (exact-scope suspects; "41 filed · none still teaching").
**OWNER VET QUEUE (his cards, NOT built — his suggestions never change code by themselves):**
- **Card 1 HIGH (near-miss, held):** after he boxed OUR name as Document Issuer on a buyer-issued PO (your ruling: POs file
  under the buyer), the app re-badged an Oakhaven delivery note, a Meadowvale credit note and a Castellan worksheet as
  *Bramblewood purchase orders @95* with "Nothing looks wrong" + a live Confirm; held only because two lacked a PO number.
  He notes Processing's "Stop a purchase-order layout claiming documents that say they are something else" showed ON
  (`template_buyer_issued_type_scope`) yet didn't stop it → a detection arc for herald/gary (type-presence veto vs the
  buyer-issued scope) — and the copy: never say "Nothing looks wrong" when the page heading disagrees with the chosen type.
  His question for you: is a folder named after US intended for the POs we send out?
- **Card 2 MOD-HIGH:** scanned Ironclad statement date read 24-06-2025 @ "High 94%" vs the page's 24-05-2025, no warning
  (held only by other fields) — the leading-digit/month class; `trust_role_disagreement_refuse` is DARK.
- **Card 3 MOD:** the Import results table says "Ready to file" on 13 Pelican rows whose reference read as the word "Date";
  Review holds them all (File All was honest). Two screens, two verdicts.
- **Card 5 MOD:** after the layout-arm re-read, siblings offered Use/Keep between two garbles the panel itself says aren't on
  the page — don't offer Use/Keep when the page-check fails.
- **Card 6 LOW-MOD:** invented senders ("Ticket Type", "DOCUMENT OLUTIONS", "Pelican Oiites Interiors") shown as groups with
  "5 more to file by itself".
- **Card 7 LOW:** stale panels (the blue "Nothing looks wrong" box after he corrected the type; the readout bar on an empty
  queue; "All reviewed ✓" after Delete All).
- **Settings, tab by tab (his admin hat):** Setup cluster clear (Files & filing "the most reassuring line in the app"; the
  wizard's Regional-format step "best-explained screen"); **Processing = the wall of ~50 switches he'd never touch and can't
  say aloud — wants a Recommended/Advanced split**; Learning: "Suppliers handled automatically" ticks = the one switch he'd use,
  but "Clear ALL learning memory" / "Erase ALL data" sit on the same tab; Document Types shows `supplier_name` codes; Templates/
  Audit/Search client/Licensing are "built for the person who built it". Terms still "WORKING DRAFT" (every round).
