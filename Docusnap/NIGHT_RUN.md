# NIGHT RUN — the overnight test/check queue and its ledger

> **Owner convention (2026-08-30):** anything Claude thinks is worth TESTING or CHECKING goes into this file's QUEUE as
> it is noticed. When the owner says "going to bed", the newest `docs/designs/NIGHT_RUN_*.md` prompt runs. **Every
> night, when the run finishes, the session moves what it did into the DONE ledger with the result and a
> "repeat only if" condition — so no night repeats work unless it is needed.** Before planning a night, read the
> DONE ledger first. Keep entries one to three lines; detail lives in the linked report/handover.

## TONIGHT — PENDING (starts when the owner says "going to bed")
**Prompt:** `docs/designs/NIGHT_RUN_2026-08-31_ADVERSARIAL_CORPUS.md` (paste the `=== PROMPT ===` block, or the armed
session starts it itself). **Queued 2026-08-30 by the owner:** "generate a set of multi columned documents for testing,
and examples of other areas you feel may pose problems … create the test docs, run them through their paces and get
chris to test them." Branch `feat/teach-side-overnight` at `9b16b08`+.

| Phase | Budget | What | Deliverable |
|---|---|---|---|
| 0 orient | ≤30 min | read the 08-30 NIGHT handover + the pendingfeatures block; `db.backup()` a fresh live copy; read the three rigs (`gen_demo_digital.py`, `gen_customer_test.py` incl. `scanify()`, `score_demo_digital.js`, `realdoc_regression.js`) | the DB copy under the session scratch |
| 1 build | ≤3 h | `stress_test/gen_hard_set.py`: 10 classes × ≥3 NEW synthetic issuers × ~20 docs, TWO renditions (digital text-layer + rasterised scan at 150/200 DPI with skew/noise/fade), one `ground_truth.json` (row per file, `class` tag), `--smoke` first + eyeball 10 PNG renders before the full run, `README_PROTOCOL.txt` | `Desktop\Hard Set\{digital,scan}\`, commit `feat(stress): gen_hard_set.py …` |
| 2 score | ≤2 h | `stress_test/score_hard_set.js` from `score_demo_digital.js`: per class × rendition accuracy (type/supplier/ref/date/total/subtotal/tax), SILENT-wrong list, would-auto-file via `trust.isAutoFileEligible`, "wrong AND would file" per class; arms COLD digital · COLD scan · WARM scan, all at `OCR_RENDER_DPI=200` with the app env mirrored; control docs must score clean first | `docs/HARD_SET_REPORT_2026-08-31.md` + commit |
| 3 triage | ≤1.5 h | top-3 would-file-wrong classes → the matching advisor (reggie dates/money/signs · oscar small print/degraded · 007 placement/columns · herald type/logo siblings · gary design) → a CLASS CARD each (mechanism · seam · smallest fix · gate); **build nothing** unless trivial + DARK + Oracle + realdoc-605 gated, one at most | cards in the report + `pendingfeatures.md` |
| 4 Chris | ≤2 h | `/christest` with the scan set copied into the sandbox (never the Desktop original); cold import as a new customer, teach two issuers (⊕ + wizard), File All, then the multi-column / small-print docs in Review — is a wrong total visible and flagged or "Nothing looks wrong"?; warnings truth table; ≤8 cards by harm; implement nothing | `docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md` (verbatim + round header) |
| 5 wrap | ≤30 min | `HANDOVER_2026-08-31_MORNING.md`, CLAUDE.md LATEST block (demote tonight's, archive to `docs/session-log.md`), memory + `MEMORY.md`, `pendingfeatures.md` cards, **this file: move the done work to the DONE ledger with results + "repeat only if", add the new QUEUE candidates, clear TONIGHT**; sandbox left on 9223 with its PID; commit, no push | the morning handover |

**The ten classes:** `multicol_money` · `table_total` · `small_print` (8/9 pt + an 11 pt control) · `edge_date`
(flush-edge, `1/12` vs `11/12`, ISO, US, month names) · `buyer_large` · `continental` (+ EU VAT ids; scan matters) ·
`logo_siblings` · `degraded` (1-3° skew, faint serial, thermal, staple blot, fax header) · `multipage` · `credit_sign`
(`-£`, `£-`, `(x)`, `x-`, `CR`, dash-leader control).
**Guard rails:** live app + live DB + `Desktop\Demo Docs` read-only; no new deps; `git commit -F` only; never push;
the six junctures (esp. #1 look at the whole rendered frame, #6 verify at the source); ≤1 h per class; a class that
won't render legibly after two attempts is dropped and said so; every phase reports even if partial.
**Autonomy protocol (owner, 2026-08-30):** runs on auto — never waits for the owner; agents are free (advisors +
Oracle, in parallel when independent); **Chris ALWAYS sandboxed** (`/christest` instance on 9223, a COPY of the
corpus, never the live app/DB/Desktop originals; his cards are logged, never implemented tonight); **anything that
needs the owner's approval is LOGGED under "NEEDS YOUR APPROVAL (morning)" in the handover and skipped** (live flips,
push, live-DB/app/Desktop writes, non-DARK changes, new deps, licensing/legal/backend/website, deletes outside the
scratch/sandbox, implementing a Chris card); **anything that looks dangerous goes to the agents first (gary/eric →
Oracle) and, with no safe route, that item STOPS and the run moves to the next thing** — never improvise around a
refusal. Full text in the prompt's "Autonomy & safety protocol".
**Expected morning outcome:** a second corpus shape with scores, a ranked list of what to build next, Chris's
verdict — and zero unvetted pipeline changes.

## QUEUE — worth testing or checking (ranked; add freely, date each)
- **2026-08-30 · The baseline 7 wrong auto-files (M = 7 / 605, 1.2 %) — the leading/garbled-digit DATE class**
  (#953, #1423, #1453, #1649 + the poisoned-GT #364; suppliers #331, #1092). Silent misfiles a customer never sees;
  the biggest remaining extraction risk. Needs: trace each, class card (reggie + 007), a witness-style guard.
  Covered partly by the Hard Set's `edge_date` class — read that result before designing.
- **2026-08-30 · AUDIT of every shipped "never auto-files / review-bound / held" claim against the REAL gate** with
  `autofile_gate_unify` ON: the deskew retry's `_needs_review=True` was a dead guard (found by accident). Enumerate
  every writer that relies on `_needs_review` or on a doc-level flag instead of a field NOTE, and test each with
  `trust.isAutoFileEligible` on a fixture. gary → Oracle.
- **2026-08-30 · Refs/dates in the re-slice witness sweep (slice 2)** — trigger must be "the zone's own read was
  ABSENT or format-INVALID" (never out-vote a valid dissent); reuse `_read_pad_window_date/code` as rung 1; the ref
  xcheck demoter is Oracle-B2-deferred (0030's `NRQ-2551` hold is that class).
- **2026-08-30 · R8 as the PRIMARY money mapping read — census only**: every taught currency mapping across ≥5
  templates at 200 AND 300 DPI, tight ladder vs R8 vs GT (0 T→F, 0 new format-valid wrong, pad-window suites
  byte-identical, small-font totals decide it). Oracle said NO until this exists.
- **2026-08-30 · The deskew retry never fires on a note-only hold** (keys on engine `_needs_review`); its 5/20 heals
  were a sandbox artefact (empty ref/date). Measure how many live held docs have skew ≥ 0.3° and a note-only hold
  before widening the trigger.
- **2026-08-30 · Tidy the 15 JS pins broken by the mig-93 default flip** ("OFF (default)" sections now start ON in a
  fresh in-memory DB): `test_company_key_own_scope`, `test_learning_excluded_readers`, `test_put_back_hold`,
  `test_rewrite_marker_exclusion`, `test_quiet_lane_*` ×3, `test_reprocess_holds_as_lane`, `test_reviewservice`,
  `test_type_ambiguity_ripple`, `test_activity_strip`, `test_issuer_clear_not_a_correction` (+ the three crashes
  `test_document_types_aliases`, `test_workflow_ipc`, `test_workflow_snapshot`, and the `stamp-*` wiring red). One-line
  fix each (state the OFF arm explicitly after `runMigrations`, as done in `test_role_disagreement_refuse.js`).
- **2026-08-30 · The total-swap class** (garbage zone read WON, no keyword read, only the re-read reconciles) — 0
  stored exhibits; needs the re-read injected before `_reconciliation_pick_total`. Low priority until a census finds one.
- **2026-08-30 · Money fold in `_corrob_values_agree`** — no measured target (19/20 records already agree); build only
  if a census finds separator-only money dissents. reggie's design is in the 08-30 handover.
- **2026-08-30 · Warm cross-contamination** (2026-07-29 rig: loading live learning dropped a NEW supplier's ref 58→33 %
  on suppliers sharing nothing with the scanned data) — still open; the Hard Set's warm-scan arm re-measures it.
- **2026-08-30 · Search perf**: `verifyAuditChain` re-verifies the whole audit log on every Search open (grows with use).
- **2026-08-30 · Release the wider-reading doubt when the COMMITTED ref IS the dominant form (owner's Pelican
  `PI/25/3699` exhibit — owner: "history shows PI is always the submitted value, and PI was detected during the
  run").** The pad-window flag ("A wider reading of this box shows 'P1/25/3699'…", method `_padcodeflag`, capped 70)
  has no clearing arm when the read is already RIGHT: the P adopt lane + class B only fire when the read is wrong
  (they decline on an established committed form) — the mirror-image gap. Design: release the note iff committed ==
  the scope's ≥0.90-dominant prefix (extractable share) AND passes the learned shape AND the alternative differs by
  exactly ONE confusable glyph AND the committed string is printed VERBATIM elsewhere on the page (the
  "Please quote … on all remittances" line = the independent leg) AND the alternative form is not itself an
  established series (refuse the day P1/… becomes real). Value never rewritten. reggie/gary → Oracle → DARK + census.
  statement exhibit):** the straighten retry's changed-field hold fires on `was '42-04-2025' → now '12-04-2025'` —
  but a day-42 date is not a competing reading, it is noise (the format-invalid-witness principle). Design: when
  `was` fails the field's DETERMINISTIC validity (date: parse_date None; money: not strict shape) AND `now` passes,
  skip the note (noise→value, nothing real changed). RELAXES Oracle C13 → needs a census (how many changed-field
  holds have an impossible `was`? the Hard Set's edge_date/degraded classes generate these) + Oracle sign-off.
  NOTE the independence rule stands: a raw-vs-straightened agreement of the SAME box is never corroboration
  (doc-561: a garble agrees with itself under rotation).
- **2026-08-30 · Toggle hygiene sweep (owner rule):** audit the switch inventory for anything PROVEN bad (failed gate,
  wrong-value exhibit, Oracle SEND BACK) → remove it or move it to a "DO NOT USE" group under the SFDEV dev-switch
  section with the reason in its sub-label. Also: the owner's live test showed TWO stacked "— confirm once." sentences
  on one field (the JS manual-reprocess lane's note + the engine's straighten note) — check one-note-per-field on the
  reprocess road; cosmetic but noisy.

## Standing corpus rule (owner, 2026-08-30)
Test runs use **ONE version of each document — no duplicates**: the durable corpus at
`Desktop\ScanFinder Test Corpus\` (605 papers, `<type>/doc<id>_<name>.pdf`, `ground_truth.json` = the confirmed
values, `rr_ids.txt` for the DB-based harness via `RR_IDS`). Never score the raw duplicate-heavy import folders.
Regenerate after a big import: `TESTING/_measure/reslice_20260830/_build_test_corpus.py <db-copy> <dest>`. Never
confirm/teach from this folder into the LIVE app.

## DONE ledger (newest first) — do NOT repeat unless the "repeat if" condition holds
- **2026-08-30 EVENING · Deduped test corpus BUILT** → `Desktop\ScanFinder Test Corpus` (605 papers: invoice 203 ·
  sales_order 125 · delivery_note 62 · service_worksheet 56 · purchase_order 51 · credit_note 41 · statement 40 ·
  quote 27; 54 MB). Repeat if: a big new live import lands (re-run `_build_test_corpus.py` on a fresh copy).
- **2026-08-30 EVENING · Re-slice witness arc + money-format hygiene + deskew dead-guard fix.** Result: built DARK,
  Oracle C1-C14, 605-paper four-arm realdoc gate MET (M 7 unchanged, +1 would-file, 0 wrong releases); full suites'
  reds all pre-existing. Report: `HANDOVER_2026-08-30_NIGHT.md`, artefacts `TESTING/_measure/reslice_20260830/`.
  Repeat if: the money reader or `_reconciliation_pick_total` changes, or a new corpus shows a noted-total class the
  sweep declines on (`RESLICE_CENSUS_DIR` reasons).
- **2026-08-30 EVENING · Duplicate census of the confirmed corpus.** Result: 2,029 confirmed → 1,940 with a file → 618
  byte-distinct → 605 papers by (type, supplier, ref, date); `RR_IDS` list at
  `TESTING/_measure/reslice_20260830/runs/rr_ids_dedup.txt` (`_dedup_ids.py`). Repeat if: the owner imports a new
  batch (re-run `_dedup_ids.py` on a fresh `db.backup()` copy).
- **2026-08-30 EVENING · Stored-record money-dissent census.** Result: 10 money dissents in 538 records — 8
  format-invalid (older-vintage reads), 2 valid garbles (0023). Repeat if: the crop ladder changes.
- **2026-08-30 DAY · Deskew review-bound retry (whole-page straighten).** Result: `4607cc6`, 5/20 Nordwind identities
  healed — on a sandbox with EMPTY ref/date; live mostly inert on note-only holds. Repeat: NO — measure the live
  note-only-hold population first (queue item above).
- **2026-08-29 · Electron 44 upgrade gates 1-5b; security audit; Chris vet.** See `HANDOVER_2026-08-29.md`.
  Repeat if: Electron bumps again (gate 5b DPAPI continuity is the mandatory one).
