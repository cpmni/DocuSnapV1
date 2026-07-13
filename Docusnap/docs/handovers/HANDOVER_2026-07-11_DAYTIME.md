# HANDOVER — 2026-07-11 DAYTIME (interactive test-drive session)

**Branch:** `feat/doctype-title-aliases` · **last commit:** `e898009` (nothing committed this
session) · **installer:** NOT rebuilt · **UNCOMMITTED BATCH: YES, LARGE** (~80 paths = the whole
2026-07-10 night batch PLUS today's daytime work, see below) · Live DB migration **45** · the dev
app (`npm start`) was left RUNNING at handover — **close it before any `npm run build`** (EPERM on
better_sqlite3.node).

**Context in one line:** the user drove the app live (re-imported test batches, taught, confirmed)
while Claude ran the approved slip-fixer fix cycle, then FOUR more advisor design cycles from live
findings — 3 fixes BUILT+TESTED, 5 designs CLOSED with Oracle verdicts, all recorded under
`docs/designs/`; every remaining build is deliberately queued BEHIND the batch commit.

---

## TL;DR

- **BUILT + TESTED today (uncommitted, in the tree):**
  1. **Slip-fixer orientation veto** — the approved first job. `computeSlipFixes` extracted to
     `src/windows/shared/slipFix.js` (+ script tag in review/index.html; renderer calls
     `window.SlipFix.…`); letter↔digit class-crossing proposals now require the candidate's own
     adjacent-character classes to match the target (transparent separators/edges, mixed/empty
     fail closed); veto at proposal-acceptance = strict subset; manual ✎ renames stay veto-free.
  2. **Fused-pair deletion widening** (2nd cycle, same day): `S0O-51337`-class garbles propose a
     one-char deletion ONLY toward an exact learned witness + orientation agreement.
     `test_slip_fix.js` **38/38**; `stress_test/slipfix_sweep.js` (live-DB old-vs-new, now
     length-aware) **PASS**: 135 scopes, ONE deletion proposal = the Bramble heal, ONE suppression
     = `P01168→PO1168` (pinned seam class — likely-legit, now manual-✎). T3 pin added to
     `test_field_value_history.js` (rename path never inherits the veto). NO corpus run BY DESIGN
     (zero pipeline files — a green would be can't-fail; Oracle-blessed).
  3. **"Dated" added to the shipped order_date label bank** (config/keyword_patterns.json) — the
     KO_sal_18 class (sales orders printing "Dated 30-07-2026" read no date; the caption always
     shipped in invoice_date's bank). NEW `python_backend/tests/test_date_labels.py` **7/7**
     (incl. Updated/Validated boundary pins). Plus a comment-only twin-pointer update in
     `ocr_corrector.py`.
- **5 DESIGNS CLOSED (Oracle-vetted), builds queued post-commit — full records in
  `docs/designs/`:** REREAD_ESCALATION · ACCEPTED_DEBRIS · DIRECTION_SUPREMACY ·
  CROP_GEOMETRY (all `*_2026-07-11.md`). Each file carries the complete build conditions.
- **Live-DB remediation VERIFIED:** the five ✎ undo renames landed (Bramble sales-order learning
  is clean letter-`SO-`); pre-undo the poison had DEEPENED (docs 2402/2406 confirmed with zero
  forms — filenames carry it); gary's suspected corrections-join vote inflation REFUTED (0 dupes
  DB-wide; the incident's 80% was real rows).
- **Live diagnoses (diag log `Debug/diagnostic_2026-07-11T09-29-08-563Z.jsonl`):** the crosscheck
  side-pick defect (INV-708114 — crop AND keyword agreed on the truth, the label-side harvest's
  debris won); the qualification-withhold × reprocess-merge seam (fresh runs correctly WITHHOLD
  off-shape garbles, the merge then keeps the OLD unflagged junk); the `'esha, i'` garbled-teach
  incident (left-first label pick + label-blind sweep destroyed the good Customer anchor — user
  re-taught clean, anchor #158 'Customer'→below now generalizes: Cavehill/Strand/Antrim all read);
  ROOT of the `SO #` junk: the SHIPPED customer_name pattern carries NO role_caption → the party
  guards NEVER RAN on it.

## Committed vs UNCOMMITTED

**Committed this session: nothing.** The uncommitted batch = the night batch (per
`docs/handovers/HANDOVER_2026-07-11.md`) + today's daytime files:
- NEW: `src/windows/shared/slipFix.js`, `src/windows/shared/test_slip_fix.js`,
  `stress_test/slipfix_sweep.js`, `python_backend/tests/test_date_labels.py`,
  `docs/designs/` (4 design records), `docs/handovers/HANDOVER_2026-07-11_DAYTIME.md` (this).
- MODIFIED today (on top of night-batch changes): `src/windows/review/renderer.js` (proposer
  extracted), `src/windows/review/index.html` (script tag),
  `database/modules/test_field_value_history.js` (T3), `config/keyword_patterns.json` ("Dated"),
  `python_backend/extraction/ocr_corrector.py` (comment only), `CLAUDE.md`.

## Verification state — honest

- `test_slip_fix.js` 38/38 · `test_field_value_history.js` green (incl. 2 new) ·
  `test_anchor_label.js` green · `test_date_labels.py` 7/7 · `test_so_number_labels.py` green.
  Sweep PASS (twice: post-veto and post-deletion, length-aware doctrine).
- **NO corpus/realdoc run today** — deliberate: the two slip-fixer slices touch zero pipeline
  files (Oracle: a corpus gate there would be a can't-fail green); the "Dated" label is a
  pattern-bank addition with its own unit battery. The batch's standing corpus state is the
  07-11 morning accounted run (M=5 = Cloudpeak 4 + #1880).
- **NOT verified / pending USER:** (1) the slip-fixer live check — reopen Review → Bramble
  sales-order → Sales Order Number → "Fix likely slips" → expect EXACTLY `S0O-51337 → SO-51337`
  → Apply (this is the Oracle's manual gate); (2) KO_sal_18 reprocess → Order Date should fill
  `30-07-2026` via the new "Dated" label; (3) an open Review window predating the fixes runs the
  OLD proposer — reopen first.
- Mid-session claims CORRECTED during the session: "the format gate didn't fire" (it DID fire on
  fresh runs — the stale rows predate the gating; the merge keeps them); "keyword is
  label-confirmed" (it is not); gary's vote-inflation hypothesis (refuted by DB).

## FIRST ACTIONS for the fresh session

1. Confirm the user's two live checks above happened (query the Bramble scope: the `S0O-51337`
   learning row should be GONE, `SO-51337` ×2; KO_sal_18 order_date filled). If not, walk them.
2. Then the standing sequence (unchanged from the morning handover): user manual gates → final
   corpus read → **COMMIT THE BATCH** (user's call on grouping) → close dev app → `npm run build`.
3. THEN the build queue, each its own commit + own corpus A/B, in this order (dependency-checked):
   **re-read escalation** (docs/designs/REREAD_ESCALATION_DESIGN_2026-07-11.md — 9 conditions;
   docs 2392/2408/2378 are its E2E cases) → **direction-supremacy c2→G3b→D1** (three kill-switched
   commits; D2 = DO NOTHING) → **accepted-debris** (C1 crosscheck rail + C2 note grammar
   blocking) → **crop-geometry slice 1 then 2**. Whichever of direction-supremacy/crop-geometry
   builds SECOND re-runs the first's pins (shared teach-surface).
4. Consider the recorded follow-ups: read-time witness-deletion rung (user-proposed, CLAUDE.md
   pointer), crosscheck side-pick arbitration, qualification-withhold×merge seam.

## Needs the USER (carried + new)

1. The two live checks (above).
2. BF_sal_27 (doc 2408): type `SO-27481` at confirm. Doc 1880 re-confirm with `SO-51337` (then
   remove its gt_override entry). Optional: re-confirm/delete doc 2392's filed garble-named
   duplicate (`Sales-Order.02-03-2026.S0O-51337.pdf`) + the BF_inv 99% duplicate queue docs +
   BF_inv_37 copy (doc 2378: delete, or correct to INV-70811 and confirm).
3. NOTE: the re-import batches auto-committed ~109 duplicates as `-DUPLICATE` files on disk —
   intentional behavior, may want a cleanup sweep later.
4. The morning handover's standing gates (focus A–F etc.) where still relevant.

## Key facts / paths

- DB `%APPDATA%\Roaming\ScanFinder\docusnap.db` (migration 45, read-only diagnostics only).
- Diag log: `Debug/diagnostic_2026-07-11T09-29-08-563Z.jsonl` (traces for the BF reprocesses).
- Tests: Python per-file script-style from `python_backend/`; JS via Electron-as-Node
  (`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron` — better-sqlite3 ABI); plain node OK for
  the pure shared modules (slipFix). Harness: read the REPORT file, never the exit code.
- Advisors: bob/oscar/eric/reggie/gary/oracle registered; 007 = general-purpose + persona from
  `agents/007.md` (used today for the crop-geometry design — his FACT-table style paid off).
- Today's process pattern that worked: user drives the app + screenshots; Claude reads the diag
  log + DB read-only; design cycles run as background agents (gary/reggie/oscar/007 parallel →
  Oracle last); fixes built by forks; docs/designs/*.md = the durable Oracle-conditions record.
