# NIGHT RUN — 2026-08-31: the ADVERSARIAL TEST CORPUS ("Hard Set"), scored, then Chris

> **How to use:** paste the block between the `=== PROMPT ===` markers into a FRESH Claude Code session on the
> `feat/teach-side-overnight` branch. It runs autonomously while the owner sleeps. Owner wrote the ask on
> 2026-08-30 ("generate a set of multi columned documents for testing, and examples of other areas you feel may pose
> problems … create the test docs, run them through their paces and get chris to test them").

=== PROMPT ===

Read `CLAUDE.md` (its rules bind you), then `HANDOVER_2026-08-30_NIGHT.md`, then the `pendingfeatures.md` block
"2026-08-30 NIGHT — OWNER-QUEUED NEXT ARC: an ADVERSARIAL test corpus". This is an autonomous overnight run; the owner
is asleep and cannot answer questions — decide, record the assumption, keep going. Deliver every phase's report even
if a phase is partial. Finish by writing `HANDOVER_2026-08-31_MORNING.md` and replacing the CLAUDE.md LATEST block.

## Standing rules (non-negotiable)
- The owner's LIVE app and LIVE DB (`%APPDATA%\ScanFinder\docusnap.db`, dev app on `npm start`) are read-only to
  you. Any DB you need is a `db.backup()` copy (`TESTING/_measure/reslice_20260830/_backup_live.js <dest>`), never a
  file copy, never the live path. `Desktop\Demo Docs` and `Desktop\Customer Doc Test` are the owner's — do not modify.
- **Measure before you build; report before you fix.** The purpose of tonight is a CORPUS and its SCORES. A code fix
  is allowed only if it is DARK (default OFF), advisor→Oracle-signed, pinned, and gated on the 605-paper realdoc
  (`TESTING/_measure/reslice_20260830/_realdoc_ab.ps1` pattern, `RR_IDS` from `runs/rr_ids_dedup.txt`) with M
  unchanged. Default is: write the class card, don't build. Never flip a switch on the live DB.
- The six STOP-AND-SECOND-GUESS junctures in CLAUDE.md apply — especially #1 (look at what ELSE is in the frame when
  you open a rendered test doc) and #6 (verify state at the source; the harness must set `OCR_RENDER_DPI=200`).
- `git commit -F <file>` only; one commit per phase; NEVER push (the owner pushes). No new dependencies (reportlab,
  Pillow, pypdfium2, numpy are present). Electron-as-Node for every JS harness (`ELECTRON_RUN_AS_NODE=1
  node_modules\.bin\electron.cmd …`). Python pins: `cd python_backend && py -3.12 tests\<t>.py`.
- Chris runs ONLY inside the sandbox instance the `/christest` skill builds (port 9223); his findings queue for the
  owner and are implemented by nobody tonight.

## Autonomy & safety protocol (owner's words, 2026-08-30 — binds every phase)
"Make sure it runs on auto but safely. It is free to spin up the agents and Chris must always run sandboxed. If there
is anything that requires my approval then log it for the morning and move on. If proceeding with an action looks
dangerous then bring it to the agents and if there is no safe direction stop and work on something else."
- **Auto:** never wait for the owner. Decide, record the assumption in the handover, continue. Every phase reports
  even if partial; a blocked phase is stated as blocked, never silently skipped.
- **Agents are free:** spawn advisors (reggie / oscar / 007 / gary / herald / eric / iris / bob / barry) and the
  Oracle whenever a design, a diagnosis or a doubtful action needs a second head — in parallel when independent.
  Brief each fully (a fresh spawn is cold); relay findings, don't paraphrase their numbers.
- **Chris ALWAYS sandboxed:** only via the `/christest` skill's isolated instance (own `userData`, own Output, port
  9223, a COPY of the corpus). Never point him at the live app (the owner's `npm start` instance), the live DB, or a
  Desktop original. His findings queue for the owner; nothing he says is implemented tonight.
- **Needs the owner's approval → LOG IT AND MOVE ON.** Keep a running **"## NEEDS YOUR APPROVAL (morning)"** section in
  `HANDOVER_2026-08-31_MORNING.md`; each entry = what · why it needs you · the exact command/flip to run if approved ·
  the risk of not doing it. Approval-class actions (never do them tonight): flipping ANY switch on the live DB;
  `git push`; any write to the live DB / the live app's userData / `Desktop\Demo Docs` / `Customer Doc Test`;
  restarting or killing the owner's app; a non-DARK behaviour change; a schema migration beyond seeding a DARK switch
  OFF; a new dependency; anything touching licensing, Terms, the PHP backend, the website; deleting or moving
  anything outside the session scratch / the Chris sandbox / `stress_test/out`; implementing a Chris card.
- **Looks dangerous → bring it to the agents; no safe direction → stop THAT item and work on something else.** "Looks
  dangerous" = a command touching paths outside the scratch/sandbox/`Desktop\Hard Set`, any `Remove-Item -Recurse`
  on a repo or Desktop path, a force git operation, a process kill not scoped to a PID tree this session started, a
  harness that would write through to a live table, an OCR/CPU run you cannot bound. Ask gary/eric (mechanism) then
  the Oracle (blast radius); if they cannot name a safe route, log it under NEEDS YOUR APPROVAL with their reasoning
  and continue with the next phase/class. Never improvise around a refusal.
- **Bound the machine:** one harness at a time (8 shards), Chris after scoring finishes; if the owner's app is
  running, leave it alone (it isn't launched with CDP — do not attach to it).

## Phase 0 — orient (≤30 min)
1. `git log --oneline -6` — expect `4c413a9` at the top. `git status` — only `CLAUDE.md` should be modified.
2. Read `stress_test/gen_demo_digital.py` (the archetype DSL + `ground_truth.json` shape), `stress_test/
   gen_customer_test.py` (`scanify()` at ~:679 — the rasterise + skew + noise recipe; `render_one`; `--smoke`),
   `stress_test/score_demo_digital.js` (cold/warm scoring), `stress_test/realdoc_regression.js` (`RR_APP_ENV`,
   `RR_DB`, `RR_IDS`, the would-file scoring via `trust.isAutoFileEligible`).
3. Make the DB copy: `TESTING\_measure\reslice_20260830\_backup_live.js <scratch>\live_20260831.db`.
4. **Corpus rule (owner):** any run over the owner's own documents uses ONE version of each — `RR_IDS` from
   `Desktop\ScanFinder Test Corpus\rr_ids.txt` (605 papers; `ground_truth.json` there is the confirmed GT), never
   the duplicate-heavy raw folders. The Hard Set you build tonight is separate and already duplicate-free by
   construction.

## Phase 1 — build the generator `stress_test/gen_hard_set.py` (≤3 h)
Model it on `gen_customer_test.py` (issuer/layout DSL, deterministic seeds, `ground_truth.json`, `--smoke`) and reuse
its `scanify()` — generalised to `--dpi {150,200}` + `--skew-max` + `--fade` (thermal-receipt fade = lower contrast +
grey ink). Output `Desktop\Hard Set\` with TWO renditions per document — `digital\` (true text layer) and `scan\`
(rasterised) — and ONE `ground_truth.json` (row per FILE: file, rendition, class, issuer, type, ref, date, total,
subtotal, tax, currency, extras). NEW synthetic issuers only (never a live name — Set-A discipline), ≥3 per class.
The ten classes, ~20 documents each per rendition (tag every row with `class`):
1. `multicol_money` — `Net | VAT | Gross` on ONE row; two totals blocks side by side; a right-aligned amount column
   beside a caption column; narrow (≤2 char) column gaps; one variant where the TOTAL is the middle column.
2. `table_total` — a totals row INSIDE the line-item table plus a footer "Total due"; a "Balance b/f" row above the
   total; a "Carried forward" that looks like a total.
3. `small_print` — totals and refs at 8 pt and 9 pt (render the SAME layout at 11 pt as the control).
4. `edge_date` — the date flush against the left page edge / a box border / a table rule; `1/12/2026` vs
   `11/12/2026` pairs; ISO `2026-12-01`; US `12/01/2026` with a US locale hint; month names ("1 Dec 2026").
5. `buyer_large` — two-column BILL FROM | BILL TO where the BUYER's name is the larger text; a SHIP TO on the right;
   a buyer-issued PO on the buyer's letterhead.
6. `continental` — `1.234,56`, `1 234,56`, `1'234.56`, EU VAT ids (`DE123456789`, `FR12 345 678 901`, `NL…B01`),
   `€` before and after the amount — SCAN rendition is the one that matters.
7. `logo_siblings` — one issuer's invoice / credit note / statement sharing a logo; two DIFFERENT issuers with
   near-identical logos (same shape, one colour apart) and different names.
8. `degraded` — 1°, 2°, 3° skew; a faint grey serial line; a thermal receipt (narrow page, fade); a stapled-corner
   blot over the ref; a fax header line above the letterhead; a coffee-ring style blot.
9. `multipage` — 2-3 pages, the total ONLY on the last page; page-1 "continued…"; a page-2 "carried forward".
10. `credit_sign` — credit notes with `-£`, `£-`, `(160.32)`, `160.32-`, `160.32 CR`; one plain invoice with a
    dash-leader `TOTAL ------ 160.32` (must NOT read as a minus).
Discipline: run `--smoke` first (1 doc per class per rendition), render 10 of them to PNG (pypdfium2) and READ the
PNGs before the full run — a generator bug that renders text over text wastes the night (juncture #1). Write
`Desktop\Hard Set\README_PROTOCOL.txt` (what the set is, that it is synthetic, how to import it safely).
Commit: `feat(stress): gen_hard_set.py — adversarial corpus (10 classes × digital + scan renditions)`.

## Phase 2 — score it (≤2 h)
Build `stress_test/score_hard_set.js` from `score_demo_digital.js`: per-class × per-rendition accuracy for type /
supplier / ref / date / total / subtotal / tax, the SILENT-wrong list (wrong + no note + conf ≥ 70), would-auto-file
via `trust.isAutoFileEligible` (the realdoc pattern), and a "wrong AND would file" count per class = the number that
matters. Three arms, all at `OCR_RENDER_DPI=200` with the app env mirrored (`RR_APP_ENV=1` semantics — copy
`_appSpawnEnv` from `realdoc_regression.js` and set `RR_DB` to the copy): (a) COLD digital, (b) COLD scan, (c) WARM
scan (the copy's learning loaded read-only — measures bleed from the owner's learning onto strangers, the
2026-07-29 open bug). Write `docs/HARD_SET_REPORT_2026-08-31.md`: a class × rendition table, the silent-wrong list
with ids, the would-file-wrong count, and per class ONE sentence naming the mechanism you SAW in a `--trace` run
(use `TESTING/_measure/reslice_20260830/_run_docs.js` + `_trace_field.js` for a single doc's lifecycle) — FACT vs
ASSUMPTION marked. Commit: `feat(stress): score_hard_set.js + HARD_SET_REPORT_2026-08-31.md`.

## Phase 3 — triage, not fixes (≤1.5 h)
For the three classes with the most would-file-wrong: spawn the matching advisor with the trace facts (reggie for
dates/money formats/signs; oscar for small print / degraded; 007 for placement / column geometry; herald for type /
logo siblings; gary for a design that must not regress) and get a CLASS CARD each: mechanism, the seam ("relies
on / disables"), smallest fix design, its gate. Put the cards in the report + `pendingfeatures.md`. Build NOTHING
unless a card is trivial, DARK, Oracle-signed, pinned and passes the 605-paper realdoc with M unchanged — and even
then, ONE at most. Ordinary outcome for tonight: zero code changes to the pipeline.

## Phase 4 — Chris (≤2 h)
Invoke the `/christest` skill with the focus: "a new customer whose documents are the Hard Set". Copy
`Desktop\Hard Set\scan` (NOT the Desktop original) into the sandbox as its Demo Docs; the safety contract verbatim.
Mission additions for Chris: import the scan set cold; teach two issuers (one ⊕, one wizard); File All; then LOOK at
the multi-column and small-print documents in Review — is a wrong total VISIBLE and flagged, or does it say
"Nothing looks wrong"? Does the app explain a held document in words a customer understands? The warnings truth
table as usual; ≤8 cards ranked by harm. Append his report verbatim to `docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md`
with a dated round header and the sandbox conditions; add the triage to the handover. Implement nothing.

## Phase 5 — wrap (≤30 min)
`HANDOVER_2026-08-31_MORNING.md` (TL;DR, commits, the class × rendition table, the top-3 cards, Chris's verdict +
vet queue, honest verification state, first actions, traps), replace the CLAUDE.md LATEST block (demote tonight's
to "(previous)"; archive the outgoing block to `docs/session-log.md`), a memory file + `MEMORY.md` line, and
`pendingfeatures.md` (the cards). Leave the Chris sandbox running on 9223 and note its PID. Commit docs; do not push.
**Then update `NIGHT_RUN.md` (owner convention 2026-08-30):** move everything tonight actually did into the DONE
ledger with its result, the report pointer and a "repeat only if" condition; add every NEW thing worth testing or
checking that tonight surfaced to the QUEUE (dated, one to three lines, ranked); re-point TONIGHT at nothing (or at
the next prompt if you wrote one). Before you planned any phase, you should already have read the DONE ledger — no
night repeats work unless its "repeat if" condition holds.

## Stop rules / budget
- Never more than 1 h on one class; if a class won't render legibly after two attempts, drop it, say so, move on.
- If the scorer disagrees with the ground truth on a CONTROL doc (the 11-pt control, a plain clean invoice), the
  harness or the env is wrong — fix that before reading any class number (juncture #3: an extreme number IS the
  finding, but only once the control is clean).
- Report failures with their output; a skipped phase is stated as skipped. No "should work".

=== END PROMPT ===

## Why this shape (for the owner)
- The 99.7 % from tonight's 605-paper gate is measured on ONE corpus shape (generated demo layouts, mostly clean
  200-DPI scans, ~8 senders). The Hard Set is a second shape built from the failure classes actually seen: the
  leading-digit date class behind the baseline M = 7, the small-print class the Oracle named when refusing R8 as a
  primary read, the multi-column row rebuild the OCR row-builder was patched for in July, the buyer-issued PO steer,
  EU formats the strict money predicate documents but never OCR-tests, logo collisions, and sign coherence.
- Two renditions of the same truth separate LAYOUT bugs (digital, no OCR) from READ bugs (scan) — the
  2026-07-29 rig showed why that split matters (supplier cold-start 8 % was a layout problem, not OCR).
- Scores first, cards second, fixes last (and DARK) — the same order every arc this month has used; the
  overnight budget is spent on evidence, not on unvetted changes to a pipeline that currently files 94 % right.
