# HANDOVER — 2026-08-31 MORNING (the adversarial-corpus night run)

**Branch** `feat/teach-side-overnight`, **NOT pushed** (your review-then-push rule). Night commits, in order:
`1e1461f` (gen_hard_set.py, 400 PDFs) · `1cbaad3` (score_hard_set.js) · `1590d03` (scorer fixes + the score
report) · `363dd26` (three advisor class cards) · `6ba8782` (Chris's round) · the wrap commit (this file +
ledgers). **Nothing in the extraction pipeline was changed. No switch was flipped. No live-DB/app/Desktop
write happened.** The live app was untouched all night; the DB used everywhere was a `db.backup()` copy.

## What ran (the full night, per `docs/designs/NIGHT_RUN_2026-08-31_ADVERSARIAL_CORPUS.md`)

1. **Built the Hard Set** — `Desktop\Hard Set\{digital,scan}\` : 10 adversarial classes × 20 docs × 2
   renditions (400 PDFs), 7 synthetic issuers, controls embedded, `ground_truth.json`. Generator
   `stress_test/gen_hard_set.py` (`--smoke`, HARDSET_OUT override).
2. **Scored it 3 ways** — cold digital, cold scan, warm scan (your real learning read-only) via
   `stress_test/score_hard_set.js` (app env mirrored, DPI 200, the ONE `isAutoFileEligible` predicate).
   **Report: `docs/HARD_SET_REPORT_2026-08-31.md`.**
3. **Three advisor class cards** (gary, reggie, oscar — full text `docs/designs/HARD_SET_CLASS_CARDS_2026-08-31.md`).
4. **Chris's sandboxed round** on a copy of the scan set — **`docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md`**
   (verbatim + my triage table).

## The headline numbers

- **600 doc-arm scores, ZERO silent misfiles: wrong+would-file = 0 in every class, every arm.** Every wrong
  read was flagged or EMPTY-held; every hold's predicate reason was honest (`below-floor`).
- Chris (fresh install, 60 nastiest docs): **0 auto-filed cold, File All truthfully filed 0**, one Thornfield
  lesson healed boxed dates on 8 siblings across 3 paper styles with **zero bleed**, credit-note teach kept
  the drawn minus. **Two-week verdict: YES.**
- The scoreboard's fill story: plain `Label: value` layouts read ~100% cold even at 9pt/EU formats; **boxed
  label-above-value cells are the big cold FILL gap** (~0-15%, 6 of 10 classes) — and teach heals them
  (Chris proved it end-to-end).

## The five findings that matter (mechanisms traced, designs written, NOTHING built)

1. **Boxed meta_row cells (oscar's card):** Stage-1's right-leg steals the NEIGHBOUR cell's caption
   (`keyword.py:2062-2139`), the below leg is never reached and is column-blind; Stage 2 has a below reader
   but no cold trigger. Design: a column-aligned cell-below arm, DARK, conf cap 85, five guards.
   **Corollary: `ref_role_digit_gate` is currently the ONLY thing stopping this layout cold-committing
   "Date" as a reference @95** on installs with it off.
2. **Credit-note sign (reggie's card):** measured per notation — `£-x` heals (the shipped
   `MONEY_SIGN_CAPTURE`), `-£x` / `(£x)` / `x-` / `x CR` all read positive (always flagged). Mint =
   keyword `_clean_value`; design = parens+CR under DARK sub-flags, trailing minus stays note-only; seams:
   penny-reconcile sign agreement, the anchor-path twin, the arm-3 mirror. Residual hole: a credit note
   that MIS-TYPES as invoice gets no sign note at all (arm 2 dead — `raw_value` never set on keyword reads).
3. **Warm buyer-issued "silent steer" (gary's card): NOT a defect — your 07-12 Oracle doctrine working**
   (issuer on a buyer-issued PO = the letterhead buyer; my GT wanted the vendor — GT flaw). The real
   residual: warm silence is licensed by ANY maturity, nothing checks it's convention-backed. Lever-1
   design (convention-licensed silence, else carry the cold-style both-parties note) is in the cards doc.
4. **Chris card 1 — the "ready" language contradicts itself on one screen** ("7 more ready to file" chips
   vs "Nothing is ready to file yet" from the button; 2+5=7 on a 6-doc group). The safety was right every
   time; the words weren't. Copy/semantics fix + one counter query to check.
5. **Chris card 2 / heading-words-as-answers:** "Date"/"NOTE" land in ref boxes wearing ✓/"High · 70%" with
   "Confirm to keep" copy. The digit gate + File All refused them all — but the dressing invites a tired
   confirm. Small presentational rule (bare page-furniture word never wears ✓/High) + oscar's arm is the
   real fix.

## NEEDS YOUR APPROVAL (morning) — logged and skipped, per your protocol

- **Choose which class-card builds to green-light** (each then goes DARK → Oracle → pins → Hard Set +
  realdoc-605 gates): oscar's cell-below arm · reggie's parens/CR sign capture (+ the `raw_value` mini-slice)
  · gary's convention-licensed-silence note. My ranking: oscar first (biggest fill lever), reggie second
  (16-doc deterministic exhibit), gary third (Review-honesty, no M-risk).
- **Chris's 8 cards** — all queued in `pendingfeatures.md`, none implemented. Cards 1+2 are the ones I'd
  vet first (both copy-level, both trust-facing).
- **Hard Set GT fixes** (safe harness-side edits I can do next session without approval if you prefer):
  thermal GT type invoice→receipt (or add Receipt), buyer_issued_po dual-accept per your doctrine,
  credit-note component-sign convention.
- **Add the Receipt preset type to the live app?** Thermal till-roll receipts land untyped today because no
  Receipt type is installed — the catalog has one ready; one tick in Settings → Document Types →
  "Add from catalog…".
- **Sandbox left RUNNING** on CDP 9223 (PID 36960, userData under the session job tmp) if you want to poke
  Chris's end state; kill it whenever — next /christest rebuilds it.

## Corrections to my own first readings (so you don't inherit them)

- The scorer's first run had a dead would-file lane (`isAutoFileEligible` refuses a falsy doc id as
  'no-type' — I passed `id: 0`) and conflated EMPTY-held with SILENT-wrong; both fixed in `1590d03`,
  all three arms re-run clean before anything was read.
- I first called the 7 warm buyer-issued reads "silent-wrong — top card"; gary's trace showed they're your
  signed doctrine + a GT flaw. The report and cards doc carry the corrected reading.

## Where everything lives

- Corpus: `Desktop\Hard Set\` (400 PDFs + GT + `score_*.md`/`.jsonl` per arm — jsonl is authoritative).
- Scores/report: `docs/HARD_SET_REPORT_2026-08-31.md` · cards: `docs/designs/HARD_SET_CLASS_CARDS_2026-08-31.md`
  · Chris: `docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md`.
- Night ledger updated: `NIGHT_RUN.md` (TONIGHT cleared, DONE entries + repeat-only-if, new queue items).
- DB copy used: `<job tmp>\live_20260831.db` (session-mortal). Sandbox: `<job tmp>\chris-sandbox\`.

---

## DAY-2 ADDENDUM (you went back to sleep; "stay on auto, have Chris vet both when done")

**Job A — the practice run now teaches the TEACH-FIRST protocol** (`3e47cd4` + r2 fixes): Step 1 =
a mini teach-wizard sim (draw a box per detail on the sample invoice - the same THREE details the
real Invoice teach asks for - then "Save and file this one"); Step 2 = import the two remaining
docs; Step 3 = Review as CORRECTION (the taught sender's sibling arrives read with one uncertain
reference you fix by TYPING over it; drawing stays as the secondary road; the untaught sender
reads cold and points at Teach). Welcome tour cards 4/5/6 reframed ("Teach it first" / "Check and
correct" / teach-then-import); Home practice-card note updated.

**Job B — the User Guide rebuilt end to end** (`2a9b4d7`): 20 pages in your signed voice - five
NEW (where-things-go, export, approvals+stamps+mailbox+routing, learning/repair, admin), five
old-voice pages rewritten (document-types incl. List+Barcode, search incl. recycle bin+send-back,
settings 11-tab map, shortcuts, troubleshooting question-led), review/set-up/index extended
(activity strip, Quick check, Deferred, put-back, teach-first practice copy, 2 new path cards).
help-nav.js manifest = 20 pages, every old deep-link key re-pointed; test_help_nav ALL PASS. All
20 pre-existing "?"-popup gaps filled - `check:help` fully green (153 keys).

**Chris round 2 (fresh sandbox2, tonight's code): BOTH VERDICTS YES.** "Tonight the app and its
paperwork finally agree with each other." He verified ~a dozen guide claims hands-on - zero lies
found. His 6 cards: 4 were defects in tonight's own build and were FIXED the same night (Esc
soft-lock in the practice draw; Back-then-Save duplicate done-row; 4-vs-3 detail mismatch; the
Teach window intro's "mark the printed label" overstatement) + the guide-search "serial" gap
(fixed). Card 4 (closing a "?" popup silently ends help mode) is a BEHAVIOUR CHOICE - queued in
pendingfeatures for you. Full round summary appended to docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md.

**ADDED TO NEEDS YOUR APPROVAL:** the help-mode persistence choice (Chris r2 card 4); the Export
window's empty-install preview check (pendingfeatures).

**Sandbox2 LEFT RUNNING** on 9223 (PID 33988, fresh install, tonight's code) - walk the new
practice run + open the User Guide from the account menu to review both. Day-2 commits:
`3e47cd4` (tutorial rework) - `2a9b4d7` (guide rebuild) - the r2 fixes commit - the wrap commit.
Restart your live app to load the new tutorial/tour/help (renderer files load at window open).
---

## DAY-2 ADDENDUM 2 (late morning): ALL THREE CARDS BUILT + ORACLE-CYCLED + GATED · Terms live · installer built

**You said "build oscar's card", then reggie's, then gary's — all three are DONE, DARK, and fully
gated** (evidence dossier: `docs/designs/DARK_ARCS_GATES_2026-08-31.md`; verdict trail:
`docs/oracle_log.md`):
1. `keyword_cell_below` (`ece65b1`+`829afed`) — Oracle SEND BACK -> all six conditions applied +
   re-pinned. Hard Set: boxed ref/date 0-15% -> 85-100%, +240/+253 correct fills, 0 new wrong.
   realdoc-605: byte-identical (adds nothing on a taught corpus).
2. `money_sign_parens`/`money_sign_cr` (`9dd5139`+`e0fe39d`) — Oracle S-O-W/COND applied (the C1
   co-residency force: either capture arms CREDIT_SIGN_COHERENCE). Hard Set credit totals 24%->65%
   (lead/trail stay flagged by design). realdoc-605: byte-identical (your corpus prints no
   parens/CR amounts).
3. `buyer_issued_convention_note` (`5d1dd84`+`f72eee5`) — Oracle S-O-W/COND applied ('logo' in the
   tuple; deskew-seam gate arms; demoter-immunity pins). Warm gates: your install unchanged
   (licensed); the stripped copy flips all 7 silent->flagged. realdoc-605: byte-identical both
   arms — 0 live POs lack the licence.
Flip suggestions + residual queue items are in the dossier. Nothing is flipped.

**Terms are LIVE (`127ec74`):** your checked text + the product-fit additions as final language
(device release/re-activation, MoR refund route, min-supported-version updates, third-party
notices pointer, documents-stay-yours, General section). LEGAL_VERSION 2026-08-31 — one-time
re-accept. Ready for your solicitor re-check.

**Installer for your other machine:** `dist\ScanFinder Setup 2.0.0-r20260831-0918-127ec74.exe`
(315 MB). SmartScreen "Run anyway"; trial needs internet on first run.

**Incident, owned:** my pre-build process sweep pattern-matched its own command line and the
kill took down YOUR running app and the sandbox along with the harness (the 08-28 class). Your
app was relaunched on the real DB within minutes (nothing lost — it's up on 9222; migs 95-97
applied at that boot, all three switches seeded OFF); the sandbox stays down until next needed;
the realdoc arms were re-run in full. The build then succeeded precisely because the locks were
clear.

**Gate artifacts** copied durably to `TESTING/_measure/dark_arcs_20260831/`.