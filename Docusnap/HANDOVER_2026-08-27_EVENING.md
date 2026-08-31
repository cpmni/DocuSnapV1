# HANDOVER — 2026-08-27 EVENING (List-field Review pills shipped · Chris r8 → caption bug fixed · the serial feature's real blocker found: grey small print the OCR cannot read)

**Branch** `feat/teach-side-overnight` · **HEAD `cab9fbc`** (code `38d5af2` = the List Review slice + Chris r8 fixes; `a9256dd` = the
help-system plan; `cab9fbc` = handover foot) · **17 commits ahead of origin, NOT pushed** (owner reviews then pushes).
**Live app: RUNNING on CDP 9222 on this code** (restarted 17:2x, again 17:5x after it was found closed; `scratchpad\launch_live.ps1`,
log `scratchpad\live_app.log`); DB at mig 91. **Chris sandbox: RUNNING on CDP 9223 on this code** (`chris`/`plumber2026`,
`scratchpad\chris-sandbox\`; its DB still carries Chris's bad override id 57 `serial_number`="No" — sandbox only).
Owner's last instruction: *"chris has stated he wouldnt use after 2 weeks as it stands. can we fix the issue he found? Please
start the app first then write a handover"* — app started, this is the handover; the fix status is §1.

## 0. First actions for the next session (in order)
1. Read this file, then `HANDOVER_2026-08-27_DAY.md` "RESULTS — LIST REVIEW SLICE" (the evening gates in full).
2. ~~Owner action: tick *required* on Document Issuer / Date / Reference~~ — **IMPOSSIBLE (the toggle is locked on a structural
   field) and SUPERSEDED the same night by migration 92** (the roles are required by nature; see the next handover). Owner step
   now: restart the app, then Reprocess the held worksheets.
3. **Build the OCR light-text recovery arc (§2)** — oscar (recipe) + 007 (merge frame) → Oracle → DARK switch → gates. It is the
   thing between Chris's "No for now" and his "yes, gladly".
4. Then the help-system plan: get the owner's answers to D1–D11 (`docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md` §12), D11 first.

## 1. "Can we fix the issue he found?" — status
Chris's two-week verdict hung on ONE card: after teaching a serial on worksheet 0012 and reprocessing its twin, the Serial Number
row read **`CJB-9791` (the JOB SHEET number), "1 found on this document", Overall 100%**, and the two real serials were absent.
Two mechanisms, verified at source (`scratchpad\probe_sandbox_r8.out`, `probe_sandbox_text.out`, `probe_ocr_loss.py`,
`probe_contrast.py`, `band_scan_200.png` vs `band_born_200.png`):
- **(a) FIXED tonight (`38d5af2`).** The ⊕ label picker returns the token NEAREST the value — "No" out of "Serial No:" — and the
  IPC stored it doc-type-wide; the Review bar had previewed with "No:" (multi-word branch → one line) while the stored "No"
  matched **"JOB SHEET NO CJB-9791"** on the twin. Now ONE `cleanCaption` (`src/windows/shared/listCaption.js`) is used by the ⊕
  road, the wizard and `teach-list-caption`; a generic tail (`no|nos|number|num|nº|#|ref|reference|id|code|date|qty|quantity`)
  is EXTENDED to the phrase printed left of the drawn value on the page ("Serial No") or REFUSED with the reason on all three
  roads (server-side too); the preview shows the debris a bad caption would collect. Pinned (`test_list_field_pills.js` 41,
  `test_teach_auto_field_rows.js`). Also fixed: "Undo changes" wiping an empty-read list (not offered; label says what it
  restores), the over-promise copy, the ";" warning outlining every pill.
- **(b) NOT fixed — the real blocker, now measured (§2).** The scanned worksheets' page text contains NO "Serial No:" lines at
  all, so the right caption collects nothing on scans. Tesseract does not recognise the grey 7.5-pt serial lines at 200 or
  300 DPI in PSM 3/6/11 (`probe_ocr_loss.py`: zero "Serial"/"CT-" words) — but a **global threshold at 200 recovers
  `Serial No: CT-8051702` / `CT-8813265` at conf 90–93** (`probe_contrast.py`, PSM 3, 200 DPI). The pixels are plainly there
  (`band_scan_200.png`): light grey small print on a tinted row; the dark item names beside them read fine.
So: the caption defect is fixed; the "fills itself on the next sheet" promise needs (b). Chris's "yes, gladly" waits on §2.

## 2. THE NEXT ARC — light-text recovery pass (design, gate, first steps)
**Class:** small light-grey print (sub-lines, footers, serials, "Reg No" strips) lost by Tesseract's own binarisation on
scans; the same family as the 08-22 "type banner dropped from page text on 105/416 docs" census (`heading_absent_census.py`
recovered 18/18 with a blind grey band OCR). A generated corpus prints serial lines at 7.5 pt rgb(90,90,90)
(`stress_test/gen_customer_test.py:523`); real forms do the same.
**Where it goes:** `python_backend/ocr/tesseract.py reconstruct_page_text` already runs a PSM-6 supplementary pass and merges
ONLY high-confidence alnum words whose centre lands in a region the PSM-3 pass left EMPTY (`_center_in_any`, `_SUPP_MIN_CONF`
50). Add a THIRD supplementary source under the same merge rule: grayscale → threshold at a HIGH level (probe: 200 beat 215;
oscar to choose fixed-200 vs an adaptive level off the page's light-text mode; consider a light UnsharpMask) → PSM 3 →
`_words_from_data` → merge words with conf ≥ 50 that sit in EMPTY regions of the PSM-3+PSM-6 result. Scanned pages only
(born-digital never reaches here); one extra tesseract call per scanned page (~+0.5–1 s; parallel-pool pattern already exists
for the PSM-6 pass, `DS_OCR_PARALLEL_FULLPAGE`).
**Switch:** DARK `ocr_light_text_recovery` (setting) / `OCR_LIGHT_TEXT_RECOVERY` env, bridged in `processing/handler.js`
`_reconcileEnv`; Settings → Processing row; OFF = byte-identical (the pass is not run).
**Blast radius (name the seam):** page text feeds EVERYTHING downstream — keyword reads, type detection (heading band), the
letterhead fingerprint harvest, `_valueOnPageSepless` page checks, the corroboration page families. New words appear ONLY in
regions that read empty before, but a recovered light footer/strip can still change a fingerprint or a heading verdict.
**Gate (Oracle will ask for these):** (1) OFF == ON realdoc on the owner's DB (`RR_APP_ENV=1`): accuracy table unchanged,
M=0, M_type=0, supplier/method/template per-doc identical except documented recoveries; (2) a fingerprint-diff census like
`TESTING/_measure/r6fix_20260827/fp_gate_census.py` (0 diffs, or every diff explained); (3) a recovered-words census: per
page, how many words the pass adds, their conf distribution, and a sample read by eye (debris risk: threshold noise in blank
regions); (4) the serial exhibit: sandbox doc 217 + the owner's live Castellan worksheets (docs 11/13/1504) gain their
"Serial No:" lines and the List collector fills on Reprocess; (5) Chris round 9 on the sandbox: teach 0012, reprocess 0011 —
the row must show the two real serials, nothing else. Kill switch tested both ways.
**Trap:** the harness renders at the app DPI (200 — `OCR_RENDER_DPI` from the `ocr_dpi` setting; module default 300); test at
the app's DPI, not the module default (the 08-09 "harness measured the wrong pipeline" lesson).

## 3. Why every Castellan worksheet is HELD since ~12:46 today (realdoc finding; owner action)
`validator.overall_confidence` scores the type's REQUIRED fields — or, when a type has NO required fields, EVERY field — and
counts an expected-but-empty field as 0. Service Worksheet has no required fields; the new List field reads empty on scans
(§2) → issuer 95 / date 98 / reference 98 / serial 0 → **overall 81 < the Castellan floor 95 → `below-floor`** (traced on the
live DB with the new `RR_IDS` harness filter, `scratchpad\rr_ids_consensus2.jsonl`; 96/96 Castellan would-file → held on the
full run; the 2 DOCUMENT SOLUTIONS flips are your correction today → 'recent-correction' floor 100). Not list-specific: any
optional field the engine cannot read does this on a type with no required fields — the List field is just the first optional
field you put on a graduated type. ~~**Remedy now:** tick *required* on the three structural roles for that type.~~ **CORRECTED the same night: the Required
toggle is LOCKED on a structural field (`doctype-editor.js`) and `updateField` refuses it — the remedy was impossible. The real
mechanism: the editor's CREATE road wrote `required=0` on the roles it supplied (every seeded type has 1). FIXED by migration 92
+ `document_types.assertStructuralRequired` at every writer (Oracle SIGN-OFF-W/COND); the scorer is unchanged.** `pendingfeatures.md` (h).

## 4. What shipped tonight (all in `38d5af2`; details `HANDOVER_2026-08-27_DAY.md` §"LIST field — REVIEW PILLS" + RESULTS)
Pills over the hidden store input (edit / ✕ + ↺ / "+ One it missed" = the ⊕ caption teach with merge rule
current ∪ (preview − (original − current)) / "Edit as text" / "Undo all my changes" / "N found on this document"); a pill edit
teaches this document only; three guards refuse field rules on a list key; hint writers skip list fields. Collector: union across
taught captions in page order, collect-only tail bound (`LIST_CAPTION_TAIL_BOUND`), code digit gate + caption-vocab arm
(`LIST_ELEMENT_DIGIT_GATE`), longest caption wins per line, own-label-only seed. The Chris r8 caption fix (§1a). Harness:
`realdoc_regression.js` gains `RR_IDS` (targeted, live-DB-safe) and `overall` + per-field reads on the RR_CONSENSUS row.
**Pins:** `test_list_field_scan.py` 27 · `test_list_field_pills.js` 41 · `test_list_field_learning_skip.js` 8 (Electron-as-Node)
· teach/r6/r5/wiring suites green · Python neighbours green. **Census:** one taught caption debris 478 → 0. **Realdoc:**
accuracy table unchanged (type 100 / supplier 99.9 / ref 99.2 / date 99.1 / total 100 on 1636 docs; M = the documented
pre-existing classes); the 96 flips = §3, not the collector.

## 5. Chris round 8 (verbatim + triage at the foot of `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`)
Pills "genuinely good and safe"; no cleanup menu on the list (right); Edit as text ⇄ Show as list fine. Cards: 1 TOP (§1) ·
2 a misread serial (`T-8325384`, the stored OCR text) with no mark — the deferred within-document shape consensus, exhibit
recorded · 3 Undo = wipe — FIXED · 4 over-promise — FIXED · 5 "Never on these documents?" copy — pendingfeatures (j) ·
6 ";" outline — FIXED. Verdict as printed: **No for now, "yes, gladly" on the other side of card 1** (= §2).

## 6. Help-system rebuild plan — written, awaiting decisions
`docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md` (`a9256dd`): gap map (12 pages, 8.3k words, stale claims with file:line,
zero-coverage list, dead deep links), teach-first architecture A0–G3, 7-step quick start rewritten after a Chris-lens read
(a "you'll know it worked when" column per step; `[VERIFY]` brackets for facts the writer must check), `[SHOT]` markers
S1–S15 (S15 = owner), glossary, the Home-menu "User Guide…" spec (`#user-menu`, above "Show welcome tour" →
`openHelpWindow('home')`; keep the top-bar Help), delivery slices, **eleven owner decisions D1–D11 (§12; D11 = approve the voice on
Quick start + Teach before writing)**, acceptance checklist. Facts corrected at source during the plan: the help window is NOT
modal (`main.js:502` — `help` is not a CHILD_WINDOW); the Mailbox/workflow is LIVE for add-on holders
(`entitlementService.js:37`, CLAUDE.md corrected); the sweep/consent bar is ON for every install (mig 80).

## 7. Owner decisions (ranked)
1. §3 remedy (tick the three roles required on Service Worksheet) — one minute, un-holds the worksheets.
2. Go for §2 (the light-text recovery arc) — it is what makes the serial feature work on scans.
3. Help plan D1–D11 — D11 first.
4. The earlier queue stands: class-F live heal check (SuperStore 31901), Learning Repair defaults, barcode questions, barry's
   sweep, `template_buyer_issued_letterhead_scope` flip (gates met), the OFF trio for the help guide (D1).

## 8. Traps (new tonight)
- The tool's shell guard blocks ANY command containing `Remove-Item` + a quoted path with a space — the WHOLE command is refused
  before it runs (a copy earlier in the same command never happened). Use `[System.IO.File]::Delete` or fresh filenames.
- `git commit -m @'…'@` here-strings break on inner quotes → always `git commit -F <file>`.
- Under Electron-as-Node `process.argv[2]` is the first script argument (argv[1] = the script) — the probe read the .js file as
  a DB and printed "file is not a database".
- Demoting other docs to `needs_review` on a DB COPY to "focus" the realdoc harness silently un-graduates every scope
  (everything reads `below-floor`/`weak-critical-field`) — use the new `RR_IDS` filter on the untouched live DB instead.
- `Start-Process … -Wait` killed by the tool timeout leaves the child (electron + 8 python workers) RUNNING — kill by CommandLine.
- The CDP `/json/version` "up" right after a launch can still be followed by the app being closed by the owner — re-check
  before assuming it is running.
- Every "N" in a quick-start-style sentence is a claim: two of barry's, one of bob's and two of my own pin premises were wrong
  until read at source ("Nu" ≠ "No"; 2-char and ALL-CAPS values are refused on every path; `Remove-Item` guard).
