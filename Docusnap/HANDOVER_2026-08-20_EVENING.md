# HANDOVER — 2026-08-20 EVENING — Chris round 10: the class fix works; 15 corrections down to 4

**Branch `feat/teach-side-overnight` · HEAD `815631c` · ALL PUSHED to origin · tree clean**
(no uncommitted code; only the long-standing untracked TESTING/HANDOVER files).
Context: this handover covers the four commits AFTER `HANDOVER_2026-08-20.md` was last updated
(`d76eb30`) — the round-10 verdict and the same-night card fixes. Read `HANDOVER_2026-08-20.md`
first for the class-fix design (mig 74) and the machine-confirm starvation arc (Oracle split
ruling, slice 0 = mig 75); this file is what happened when Chris tested it.

> Session note: the prior chat was closed mid-handover (2026-08-20 ~18:06) — the only thing lost
> was the handover text itself. Every code/doc change was already committed and pushed.

---

## TL;DR

1. **Chris round 10 ran (2026-08-19 evening, sandbox CDP 9223, all nine switches ON) and the
   class fix works end to end.** One typed correction fixed six siblings; "Show what changed"
   named all six (`filename — old → new` + Undo); Undo really put all six back; the two `PL/`
   invoices were untouched; the `P1L/` two-character control was refused as designed; Reprocess
   All reverted nothing. **Typed corrections: 15 (round 9, Pelican alone) → 5, honest figure 4**
   (one of the five was a deliberate Undo-and-redo).
2. **Zero misfiling again.** 410 documents, 356 filed, 0 wrong folder, 0 wrong value across 14
   pages Chris read by eye, 0 filename mismatches. All four scary warnings told the exact truth.
   Wave 2 filed 155/200 by itself. **First round Chris says yes with no "but".**
3. **7 new cards; 3 fixed the same night (`815631c`), 4 open.** The verdict's two named
   annoyances: the Approve button (fixed — see below) and the "Company inferred" nag (OPEN — it
   held **52 of his remaining 90** documents and cost two senders 39 wave-2 auto-files).
4. Verbatim appended to **`docs/CHRIS_FULL_APP_REVIEW_2026-08-19.md`** (`8a2bb1f`) — NOT a new
   2026-08-20 file, despite the prior handover's expectation.

---

## COMMITTED (all pushed; nothing uncommitted)

- **`d23ace3` — mig 75, slice 0 of the starvation ruling (`learning_exclude_rewrite_markers`,
  DEFAULT OFF) + the classFixService refusal-union (unconditional).** Full detail in
  `HANDOVER_2026-08-20.md`. Load-bearing invariant (written into the code): a REFUSAL test may
  use the fullest evidence (human + all machine); a LICENSING/rewrite-permission test may use
  human-attested only; NEITHER may use evidence a rewrite created; never amplify a shared index —
  split the input, not the switch.
- **`d76eb30` — both slice-0 censuses** (`TESTING/_measure/census_rewrite_markers.js`): zero
  groups die, zero shape flips, zero de-graduations on BOTH round-9 sandbox and live backup; the
  only marked rows (16 `+name_corrob_adopt`, live) are all machine-confirmed, i.e. the hole is
  currently masked exactly as Oracle described.
- **`8a2bb1f` — Chris round 10 verbatim** (7 cards, walkthrough, truth-table, verdict).
- **`815631c` — three round-10 cards fixed** (JS suite after: **209 green, 3 pre-existing reds,
  zero new**):
  - **Card 1 — Approve "does nothing" (reported in FOUR rounds: r2, r5, r10).** Approve is NOT
    dead — it is the deliberate owner-approved two-step arm (first press arms, second commits).
    The defect: the arm auto-reverted SILENTLY after 8s, so paced clicks armed/disarmed
    alternately with nothing on screen. Two-step stays; the window is longer and a lapse now says
    so instead of quietly restoring the button. `src/windows/search/search-workflow.js`.
  - **Card 5 — stale sweep promise.** The sweep offer is a snapshot; delivery was already correct
    (re-checks, files what is still eligible, names what it keeps back) — only the button's
    promise was stale. Now "File up to N" (the File All Ready wording Chris explicitly trusts).
    `src/windows/review/renderer.js`.
  - **Card 6 first half — a note that outlived its value.** On reprocess the class-fix guard kept
    the corrected value but took the fresh row's NOTE computed against the discarded read —
    "'PL/26/6000' doesn't appear on this page" shown on a row displaying PI/26/6000. The note now
    follows the value; the hold survives (nothing re-verified the page). Notes about anything
    else are left alone. `src/modules/processing/handler.js` + pin in
    `src/services/test_ref_class_fix.js`.

## NOT A BUG — card 6 second half (customer face of the starvation)

Doc 337: value PI/26/9910, page PRINTS PI/26/9910, full-page OCR reads P1/26/9910. Gate C tells
the truth about the text it holds. Page-match v2 leg 2 exists for exactly this case and DECLINED
because it needs dominance backing and **dominance is starved on a fresh install** — the same
measured starvation (89.9% of the round-9 corpus invisible). So a false warning sits on a correct
value on the very page the arm was built for. Fix rides on the starvation slice-1 redesign, not on
Gate C.

## OPEN CARDS (round 10, not yet touched)

- **#3 (biggest UX lever, per Chris's own verdict): the "Company inferred" note held 52 of 90
  remaining docs; cost two entire senders 39 wave-2 auto-files.** Related: round 9's "24 stale
  Company inferred notes" was already open.
- **#2: "Never seen this sender before" on the FORTIETH document from that sender.** Cause not
  yet investigated — do not assume it is the starvation without verifying at source.
- **#4: typing a money amount without its "£" leads to a screen whose default freezes that amount
  forever** (the fixed-value freeze from a typed-locate teach — the known young-identity trigger).
- **#7: the notice stack eats the document list, and two counters disagree with the app itself.**

## VERIFICATION STATE — honest

- Round-10 numbers are Chris's own hands-on count (410 docs, 14 pages eye-read), not a harness.
- `815631c` fixes passed the JS suite (209 green / 3 pre-existing reds / 0 new) but have NOT been
  re-run past Chris — the Approve window change and the sweep wording are unvetted by a fresh round.
- Slice 0 (mig 75) is DARK and its censuses are green (zero de-graduations on both DBs) — the
  named precondition for a flip is therefore MET, but the flip itself was deliberately left as an
  owner decision and has NOT happened.
- Slice 1 of the starvation fix is SEND BACK — NOT built. The pin that killed it is in the repo.

## FIRST ACTIONS for a fresh session

1. **Owner vet of the round-10 cards** — especially open card #3 ("Company inferred" holds 52/90):
   it is the verdict's named weekly annoyance and the biggest remaining auto-file lever on a young
   install. Design with gary, Oracle last (it touches the inferred-identity note gate,
   `project_inferred_identity_note_gate_20260814.md`).
2. **Starvation slice 1 redesign** (Oracle SEND BACK conditions in `docs/oracle_log.md` +
   `HANDOVER_2026-08-20.md`) — card 6b and possibly card 2 are its customer faces.
3. Cards #2 (verify cause at source first), #4, #7.
4. Owed before any default-ON flip (now ~11 dark/gated flags incl. mig 74 + mig 75): the sweep
   integration fixture (Oracle G2) and the four-arm cold-start measurement.
5. Ops unchanged: the hourly Polar-reconcile cron is still TODO.

## NEEDS THE USER

- Decide the two dark flags: `ref_class_fix_enabled` (mig 74 — round 10 just validated it
  end-to-end, zero misfiles, Undo proven) and `learning_exclude_rewrite_markers` (mig 75 —
  censuses green on both DBs).
- Vet the 4 open round-10 cards before anything is built on them (owner convention).

## KEY FACTS / PATHS

- Round-10 verbatim: `docs/CHRIS_FULL_APP_REVIEW_2026-08-19.md` (ROUND 10 section).
- Round-10 sandbox artifacts (screenshots step01–step43, driver scripts): the 08-19 session's
  scratchpad `…\Temp\claude\C--GIT-Projects-Docusnap\4a5b8f06-…\scratchpad\chris-r10` — TEMP, may
  vanish; the verbatim doc is the durable record.
- Census scripts (read-only): `TESTING/_measure/census_machine_pointer.js` +
  `census_rewrite_markers.js`.
- Flags at `database/index.js:1744` (`ref_class_fix_enabled`) and `:1768`
  (`learning_exclude_rewrite_markers`), both seeded `'false'`.
- Live DB: `%APPDATA%\ScanFinder\docusnap.db` · JS suite: `ELECTRON_RUN_AS_NODE=1` per
  `reference_running_test_suite.md` · `pytest tests/` ABORTS (known).
