# HANDOVER — 2026-08-27 MORNING (the autonomous overnight run of 2026-08-26 → 27)

**Branch** `feat/teach-side-overnight` · **HEAD `b0e94f4`** (+ this handover's own docs commit) · **6 commits tonight, LOCAL /
NOT pushed** (owner reviews then pushes — standing rule). Tracked tree clean. Untracked cruft from earlier sessions is untouched
and must NOT be committed (`TESTING/_measure/*`, old `HANDOVER_*`, `x`, `../Backup`, `docs/SECURITY_HARDENING_REPORT_2026-07-28.md`,
`docs/designs/TEACH_POISONING_ARC_2026-08-13.md`, the stray `scripts/*.js` + `test_*.js` that `git status` lists).

| commit | what |
|---|---|
| `9861d37` | landmark box word-snap (was built, uncommitted) + source pin |
| `c80e387` | **the three arcs** — class F note-clear · Learning Repair v2 · barcodes + LIST separator fix (ALL DARK) |
| `8cb80ac` | two source-contract pins updated to tonight's constants (no production change) |
| `df0c86b` | handover + CLAUDE.md LATEST |
| `d0d74fb` | Chris round 6 — two defects in tonight's code fixed + his verbatim report + triage |
| `b0e94f4` | HEAD pins + Chris track record |

The owner's brief for the night: finish the three pending items → redesign Learning Repair with the agents → check what a package
like this is expected to have (barcode field, LIST field) → build what the agents agree on, safely → run Chris on the CHRISBOT folder
+ a thorough Settings review → report the questions for the morning. Everything below is what happened; nothing was flipped live.

---

## ⏭ FIRST ACTIONS FOR THE FRESH SESSION (in order)

1. **Restart the live app once** — migrations **90** (`documents.learning_excluded_at`) + **91** (`document_barcodes`) apply. Both are
   inert (nothing stamps or writes them until a switch is on). Live DB stays byte-equivalent otherwise.
2. **Owner decisions** (next section) — get them before building anything from the Chris vet queue.
3. **Class F flip check (if the owner says go):** Settings → Processing → "Don't ask to double-check a value two independent
   readings already agree on" (needs "recompute the format penalty" ON — it is on the live DB; the bridge refuses otherwise).
   Then in Review, **Reprocess the SuperStore 31901 doc** and watch the trace (SFDEV): expect `corrob_note_resolve cls=F`,
   invoice_number 70→90, the doc reaches Ready. That is Oracle C5(e); C5(d)/(f) already have corpus evidence (below).
4. **Chris vet queue** → agents (Card 1 = a detection arc for herald/gary; Card 2 = the date class; Card 3 = one classifier for
   Import + Review). His cards are suggestions; nothing from them is built.
5. The Chris sandbox is still up — poke it or `/christest` rebuilds it (details at the foot).

---

## OWNER DECISIONS (ranked; nothing flipped live)

1. **CLASS F flip — the evidence is in and it is NOT vacuous.** Realdoc OFF vs ON on your live DB (1242 confirmed docs,
   `RR_APP_ENV=1`): F cleared **24 edge-cut notes — all 24 CORRECT** (the SuperStore 3190x class you flagged: 31900/31902/31903/
   31904/31905/31906/…), field 78→90, would-file **1168 → 1192**, **0 wrong values gained, M unchanged at 12 (all pre-existing:
   the Harrowgate GT-poison class #31-48 + #331/#1092 supplier), M_type 0, 0 lost**, 1218/1242 docs byte-identical. Still owed
   before a live flip (Oracle C5): the SFDEV live heal of 31901 in YOUR app + one clip positive control. Arms + diff:
   `stress_test/out/rr_f_{off,on}.{md,jsonl}` + `TESTING/_measure/overnight_20260826/rr_diff_f.js`.
2. **Learning Repair v2 — three UX defaults (Oracle ruled, you confirm):** (a) "Start fresh" per sender × document type (auto-widen
   to the sender when it has one type)? (b) after a forget, the sender's filed documents STAY filed + searchable and simply stop
   teaching (recommended; the old "requeue" road exists if you prefer back-to-Review)? (c) never move files on disk on a rename/
   merge — an explicit "Re-file N" button instead? Plus: do you want a WHOLE-SENDER forget (logo + VAT/company-number registry +
   accepted-issuer)? Tonight's forget deliberately leaves those (a sender may have other types).
3. **Targeted field re-slice after a ⊕ teach — gary AND oscar: WRONG LAYER for the filing road.** The full-page OCR is already
   skipped on a reprocess (cached `ocr_text`), so the saving is ~2-3× not 10×; a field-only WRITE poisons the re-read holds'
   baseline (re-opens the Oracle C3.3 misfile) and can never corroborate (one family → never heals a note → "nothing cleared").
   **The cheaper lever exists and Chris proved it works: the layout arm `quiet_reread_on_layout` (DARK) re-read his siblings after a
   re-teach.** Your call: flip the arm (after Card 5 — see Chris), or fund the suggestion-only "quick read" pill after a timing
   measurement. Detail: `pendingfeatures.md`.
4. **Barcode field — three questions only you can answer:** which symbologies do your customers print (courier/delivery labels,
   bill-payment barcodes, supplier document IDs)? may a barcode field be the ref/filename role (allowed tonight)? should it ever be
   `required` (an absent decode would then block filing)? Slice B2 (LEARN at confirm so it can auto-file) is designed (reggie's
   rules in `pendingfeatures.md`) and waits on these.
5. **Chris Card 1 (HIGH, held not misfiled):** after he boxed YOUR company as Document Issuer on a buyer-issued PO (your ruling: POs
   file under the buyer), the app re-badged an Oakhaven delivery note, a Meadowvale credit note and a Castellan worksheet as
   *Bramblewood purchase orders @95* with "Nothing looks wrong" + a live Confirm; held only because two lacked a PO number. He
   notes `template_buyer_issued_type_scope` was ON and didn't stop it → a detection arc. His question: is a folder named after
   *you* intended for the POs you send out?
6. **Barry's "expected features" sweep — top 6, ranked:** searchable-PDF text layer on the FILED copy (must-have; **Q: may the
   filed PDF differ from the original bytes, given originals are kept?**) · barcodes (built) · exact-duplicate skip at import (L1
   quick win) · export/accountant pack + saved search (**Q: Xero / Sage / QuickBooks?**) · supplier/customer list import as a
   witness · LIST finish (chips, long-format CSV, repeated XML values). Rejected with reasons: email-in, print driver, tags,
   retention, handwriting, TWAIN.
7. **Chris's Settings verdict:** the Processing "wall" of ~50 switches he'd never touch and can't say aloud — wants a Recommended/
   Advanced split; "Clear ALL learning memory" / "Erase ALL data" sit on the same Learning tab as the per-sender ticks he DOES
   want; `supplier_name` codes visible in Document Types; Terms still "WORKING DRAFT" (every round).

---

## WHAT SHIPPED (commit `c80e387`; every switch DEFAULT OFF, byte-identical off; each arc advisor → Oracle → pins → gate)

### 1. CLASS F — one general "corroboration clears a verification-doubt note" rule (Oracle SIGN-OFF-W/COND)
`python_backend/extraction/engine.py` class F in `_resolve_corroborated_notes` (env `CORROB_VERIFICATION_DOUBT_CLEAR`, setting
`corrob_verification_doubt_clear`). Clears the note AND lifts the FIELD to 90 (the edge-cut caps the field at 70; trust.js reads
the field — popping the note alone was cosmetic) iff: the mark ∈ the write-site constants (`_EDGE_CUT_NOTE`, `_FT_FALLTHROUGH_NOTE`,
`_SHAPE_TRIM_NOTE`, `_REREAD_NOTE_HEAD` — deny-by-default) · ≥2 DISTINCT page families agree with no dissent · an UN-noted ≥80
witness from a different page family · exact learned skeleton on a non-freetext/non-currency class **+ a LENGTH leg the C1 pin
itself found** (`_fold_shape` collapses every pure-digit skeleton to `#`, so `3190` scored 1.0 against a `#####` history — the raw
skeleton must be a learned `shape_families` variant) · no pending corrected_to · never identity/names/human methods · **C2**
totals/currency-typed fields refused · **C3** the re-read mark accepts only a KEYWORD witness · **C4** `_reconcileEnv` arms F only
where `corrob_note_recompute_fc` is on. The emit's family bucket is hoisted to `_corrob_record_bucket` (logic unchanged). Pins:
`tests/test_verification_doubt_clear.py` 39, `test_corrob_note_resolve.py` 51, emit/date-fold/name/recon/xcheck suites unchanged.
Verdict logged `docs/oracle_log.md` 2026-08-26 NIGHT.

### 2. LANDMARK BOX SNAP — `9861d37` (`settings/renderer.js addLandmarkFromRect`, same shared BoxSnap + `template_box_word_snap`
gate as the mapping path; pin in `test_settings_wiring.js`).

### 3. LEARNING REPAIR v2 — selector + console + a "start fresh" that REALLY forgets (Oracle SIGN-OFF-W/COND C1–C6)
**The finding (barry + gary, verified at source):** the old "Forget learning for this type" (`recoveryService.js:69-105`) was a
HALF-forget — it cleared anchors/hints/rules and left everything that teaches: the owned layout (template + frozen sender + logo
hashes) and the LIVE-derived model (`getFieldFormats` / `scopeTrust` / `getDominantSupplier` kept counting the confirmed docs) —
a "forgotten" sender stayed warm and GRADUATED.
- **Slice 0 (`learning_exclude_docs`, default ON, inert until stamped):** mig 90 `documents.learning_excluded_at` + ONE predicate
  `database/modules/machine_vias.learningExcludedSql(db, alias)` threaded into 17 learning-feeding readers (learning / trust /
  templates / namePresence / typePresence / typeSplit / templateMerge / documents type-ahead / review handler / repairSuspects) +
  the type-ambiguity waiver counts in `processing/handler.js`. NEGATIVE list pinned (search/browse/counters/writers untouched).
  `_cleanupAutoMoneyFields` deliberately NOT threaded (a destructive startup guard). Kill `LEARNING_EXCLUDE_DOCS=0` re-admits
  stamped docs to learning; it does NOT undo a forget. Pins: `database/modules/test_learning_excluded_readers.js` 87.
- **Slice 1 (`learning_repair_console`):** `src/services/learningScopeService.listScopes` — one row per sender × type from documents
  ∪ every learning table (17 scopes on your DB in ~200 ms; orphaned learning surfaces; carries `excluded`/`teaching`) with
  plain-word graduation ("Files by itself" / "Not yet — 2 more confirms" / "Paused after a correction"). Settings → Learning Repair
  shows a selector (search + chips: worth a look / not filing by itself / learning-but-no-documents / no sender) → click → the
  console (status sentence + today's document list + Start fresh + Undo). The typed picker stays while the switch is off.
- **Slice 2 (`learning_repair_forget`):** `src/services/learningRepairService.js` — dryRun (the consequence sentence from the SAME
  counts) + forgetScope: JSON snapshot (userData `repair-snapshots/`) → exact-scope deletes (C3) → per-doc retract ONCE (C1:
  `learning_retracted_at` stamped while confirmed; `repairService` send-back/delete skip an already-retracted doc; restore never
  re-plants an excluded doc; a HUMAN confirm clears both stamps in `documents.confirmIfReviewable`) → owned templates removed with
  runtime `PRAGMA foreign_key_list` child enumeration (C2 fail-closed: a template whose confirmed docs include another sender, or
  another type, is REFUSED + reported) → exclusion stamps → `<slug>.json` hygiene (C6). Corrections KEPT. Undo = exact row
  restore by id (C4) incl. the `__global__` hint twins + identifier rows. Then quiet-lane reason `repair` re-reads the sender's now
  template-less held docs under "Read again after a learning repair — confirm once." (`rereadHolds.NOTES.repair`, C5).
  Logos/identifiers/accepted-issuer survive; files on disk never touched. IPCs `learning-scopes` / `learning-repair-dry-run` /
  `learning-repair-forget` / `learning-repair-undo` / `learning-repair-snapshots` (settings handler, admin). Pins:
  `src/services/test_learning_repair_service.js` 32.
- LATER (`pendingfeatures.md`): remembered-values editor, layouts canvas (read-only reuse + wizard deep-link), rename/merge arc,
  whole-sender forget, "Recently forgotten", the Learning tab's raw inventory → SFDEV-only.

### 4. BARCODES — `barcode_inventory` + `barcode_field` (barry → gary; reggie rules)
- **Slice A:** `python_backend/ocr/barcodes.py` — one zxingcpp (Apache-2.0, already vendored for the separator sheets) pass per
  OCR-rendered page (no second render): every 1D/2D symbol, SFSEP payloads excluded, invalid decodes dropped, deduped, capped,
  never raises. `process_docs.py` threads rows to the engine and emits `barcodes` TRI-STATE (absent = no decode ran → rows kept;
  `[]` → cleared). mig 91 `document_barcodes` (`database/modules/barcodes.js`); persisted at import + INSIDE the reprocess
  transaction; `documents.search` full-text reaches a bar-only value. Pins: `tests/test_barcode_decode.py` 16 (round-trip through
  zxing's own encoder at 2-3 px/module), `database/modules/test_document_barcodes.js`.
- **Slice B:** field type **"Barcode / QR code"** (editor dropdown behind `window.__barcodeFieldOn`). Engine Stage 1.5: the decode is
  the ONE writer — exactly one code-like decode → value @100 + "Read from the barcode printed on this page — please confirm it once."
  (no learning yet → the note holds every doc: correctness first); several → EMPTY + a note listing them; URL/vCard → unsupported
  note; **none found → an empty `barcode_none` row that still renders (Chris card 4)**. Keys kept out of the keyword scan; the
  LIST-style ownership skips (mapping seed reclaim, Stage 2, 2.6, 2.5b, 4.5, hints). ⊕ teach refused; the teach wizard skips it
  with the reason; `is_variable`; **never the Date role** (may be the ref role — owner Q); `field_charsets.barcode: null`. Its notes
  are NOT in the class-F allowlist (pinned). Pins: `tests/test_barcode_field_stage.py` 21.
- **LIST field (owner: "is it properly implemented?") — YES for the printed layout it was built for:** a repeated inline caption
  ("Serial No: X" per line) collects EVERY occurrence, deduped, joined "; " (`list_field_scan`, ON by default via mig 70). Residuals:
  a caption ABOVE a vertical COLUMN reads element 1 only; no count witness; no per-element search snippet. Tonight (reggie): an
  element carrying `;` is refused at the one writer (`keyword.py` collect); the Review split narrowed to `;` only. Pin 10 added.

### 5. Full-suite status (run 23:23–23:28)
JS 274 files / Python 264 script-style + 308 pytest. **Every red was already red before tonight** (each run against the previous
commit in a worktree) except two source-contract pins that matched old literals — updated in `8cb80ac`. Pre-existing reds
(unchanged, documented): JS `test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`,
`test_document_types_aliases`; Python `test_identity_fusion` (pytest) + `anchor_crop_crosscheck`, `label_overrides`,
`template_rescue`, `engine_detail_thread`, `network_field_authority`, `reprocess_manifest`. Log:
`TESTING/_measure/overnight_20260826/full_suite_20260826.log`; runner `full_suite.ps1` there (detached: `Start-Process powershell -File …`).

---

## SWITCH TABLE (new tonight; absent = off)
| setting | env | default | what |
|---|---|---|---|
| `corrob_verification_doubt_clear` | `CORROB_VERIFICATION_DOUBT_CLEAR` | OFF | class F (needs `corrob_note_recompute_fc` ON — enforced in `_reconcileEnv`) |
| `learning_exclude_docs` | `LEARNING_EXCLUDE_DOCS` | **ON** (inert until a doc is stamped) | the ONE learning-exclusion predicate |
| `learning_repair_console` | — | OFF | the sender selector + console UI (settings renderer reads it) |
| `learning_repair_forget` | `LEARNING_REPAIR_FORGET` | OFF | the "Start fresh" door (enforced in the service, never the renderer) |
| `barcode_inventory` | `BARCODE_INVENTORY` | OFF | decode + persist every page barcode; search |
| `barcode_field` | `BARCODE_FIELD` | OFF | the Barcode / QR code field type + Stage 1.5 |
All six have Settings → Processing rows + `test_settings_wiring.js` pins. Migrations **90** + **91**. The live DB is at 89 until the
app restarts.

---

## CHRIS ROUND 6 (2026-08-26 NIGHT / 08-27; fresh sandbox; verbatim report + triage table in `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`)
**Numbers:** 472 in → **279 filed, 279 under the right company, 0 wrong type, 0 unknown-date folders, 149 filed by itself.** Cold
batch 0/200 by itself → "File All Ready" filed 115 in one click (26 s, 0 wrong); **warm batch 116/200 by itself (58%; round 5 = 98)**;
scanned 13/20; 20 exact duplicates all `-DUPLICATE`. **Every scary button told the truth** (truth-table in the report). Leak check:
the owner's `Documents\Scan Finder` + live DB last written 21:18/21:10 — before the run. **Verdict: "Yes — I'd keep using it after two
weeks, and pay."** Key screenshots: `TESTING/_measure/overnight_20260826/chris_r6_shots/` (03 terms draft · 67-69 card 1 · 82 the
sibling re-read · 103-106 Learning Repair · 108 card 2 · 109 barcode field · 111-113 scary buttons); his report file `chris-report.md` there.
**Tonight's features as he saw them:** Learning Repair selector = "the right idea… Wanted: this"; "Start fresh" warning honest, Undo
worked, the next Harrowgate scan filed itself after Undo; the layout arm DID re-read siblings after his re-teach (owner test c); the
barcode field row was invisible when the page had no barcode (card 4) — **FIXED `d0d74fb`**; the console showed another sender's
"worth a look" doc + "Learned from 41" right after a forget (card 8) — **FIXED `d0d74fb`**.
**Vet queue (not built):** Card 1 HIGH (above, decision 5) · Card 2 MOD-HIGH scanned statement date 24-06 vs page 24-05 @ "High 94%"
with no warning (the month/leading-digit class; `trust_role_disagreement_refuse` DARK) · Card 3 MOD the Import results table says
"Ready to file" on 13 Pelican rows whose reference read as the word "Date" while Review holds them (File All was honest) · Card 5 MOD
after the layout-arm re-read the siblings offered Use/Keep between two garbles the panel itself says aren't on the page · Card 6
invented senders ("Ticket Type", "DOCUMENT OLUTIONS", "Pelican Oiites Interiors") as groups promising "5 more to file by itself" ·
Card 7 stale panels (the blue "Nothing looks wrong" box after a type change; readout bar on an empty queue; "All reviewed ✓" after
Delete All) · Settings (decision 7). Previously-reported verifies: r5 Card 5 (Add "Quotation" pre-fill) FIXED · r5 Card 6 (practice
stale hint) FIXED · r5 Card 1 Pelican pile BETTER-BUT (41 still held, none misfiled) · r5 Card 3 cold batch BETTER (File All then
115) · r5 Card 4 no-sender scatter BETTER ("25 more look like the same sender — apply & re-read") · Terms draft STILL PRESENT.

## CHRIS SANDBOX (left running)
CDP **9223**, PID **3060**, `<session scratchpad>\chris-sandbox\` (session-mortal: `userData\docusnap.db` with his admin `chris` /
`plumber2026`, his docs `CHRISBOT\`, output `Output\` = 279 filed). Armed in HIS DB only: the six switches above +
`quiet_reread_enabled`, `quiet_reread_on_layout`, `list_field_scan`, `corrob_note_recompute_fc` (`arm_sandbox.js`). `/christest`
rebuilds from scratch (`scripts/seed-chris-sandbox.js`, the driver = `playwright-core` + `connectOverCDP`, captures via
`scripts/capture-window.ps1 -OwnerPid <pid>`).

## TRAPS (re-confirmed tonight)
- The Bash tool here has no node/npm/git; PowerShell has no heredoc → commit via `git commit -F <file>` written by the Write tool,
  and write the file BOM-less (`Out-File -Encoding utf8` puts a BOM into the commit subject; use `[IO.File]::WriteAllText(p, s,
  UTF8Encoding(false))`).
- The background Bash/PowerShell tool has a 10-minute ceiling — the ~23-min realdoc arms must run DETACHED (`Start-Process
  powershell -File …`; `rr_classF.ps1` pattern), then poll a done marker.
- A delegate's report said 87/87; my run said 86/87 — the missing one was MY new service carrying the filter literal. Re-run a
  delegate's pins yourself; verify its diff, not its prose.
- `documents.search` defaults to `status='confirmed'` — a fixture pin over queued docs must pass `status`.
- `_fold_shape` makes every pure-digit skeleton `#`: any "learned shape" check on a digits-only ref is LENGTH-BLIND unless it reads
  `shape_families` variants.
- Two source-contract pins in the suite literally match production strings (`re-read from the page`, `layout || ready`) — a
  refactor that hoists a literal into a constant, or extends a condition, needs the pin extended in the same commit.
- `runMigrations` does NOT seed the built-in doc types (`open()` does) — fixtures seed `document_types` themselves.
- The Learning-Repair console must filter suspects to the EXACT scope: `repair-overview` unions type-wide outliers of other senders
  by design (Chris card 8).
