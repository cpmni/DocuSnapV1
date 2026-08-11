# HANDOVER — 2026-08-12 OVERNIGHT (autonomous; owner asleep, order: "do the remaining fixes on auto … then have chris rerun the same tests from the past two nights and compare")

**Branch** `feat/teach-side-overnight` · HEAD **`afe8da0`** · PUSHED. No flips, no live-DB writes,
no destructive actions. The owner's app kept RUNNING untouched throughout.

## TL;DR
1. **"Pelican did autofile" — verified at source: NOT machine auto-file.** Every Pelican filing is
   `review_confirmed` by chris (incl. a 9-doc File-All-Ready burst); `confirmed_via` is NULL on
   all; ZERO `auto_corroborated` docs exist. The only true machine auto-file ever on this install
   is 20 Meadowvale credit notes at graduation floor 95 on 08-10 midday. **Pelican 0016 (#483) is
   still needs_review @99 — CORRECTLY**: its invoice_number is the serif I→1 class ('P1/26/1150',
   the crop rung beat the correct mapping read — the corroboration record captured the
   disagreement) and the frozen supplier still carries the trailing dash. Filing it would have
   been a misfile; the hold is the system working.
2. **The NAME-BOX FLUSH-EDGE CLIP slice SHIPPED** (`afe8da0`, Oracle SIGN-OFF-W/COND, all
   discharged or filed): fix (a) teach-side trailing-pad floor 0.004 (boxSnap + valueLocate,
   asymmetry pinned) + fix (b) `TEMPLATE_NAME_EDGE_GROW` v1 DEFAULT OFF (right-cut only,
   last-token repair, page-present witness with NO short-token skip, flag-only ≤70+note, silent
   declines). Gates: OFF md5-identical · armed **+22 lane heals / 0 losses** (issuer +9, customer
   +11, vat +2) · census 29 heal / 14 decline · **1 direct commit / 28 superseded un-squats**
   (Oracle C2 — the flip buys ~zero new review volume).
3. **Oracle C1 — SAY THIS TO THE OWNER BEFORE ANY FLIP:** the flip does NOT fix the Ironclad
   'Ltc' exhibit itself — its overhang (0.0010) sits under the untouched 0.004 predicate floor.
   That page is cured by a RE-TEACH of tpl 10's customer box (the new snap pad then stores a safe
   box), or by the **C7 stored-box repair arm** (widen existing name-box trailing edges to the
   floor — sample-angle-backfill pattern; OWNER DECISION, backlog top).
4. **The OWED hidden-field-drop corpus arm ran and is CLEAN**: 30 ghost values dropped to EMPTY,
   all inside GT-certified declared-absent scopes (Meadowvale credit refs + Pelican PO refs
   masquerading as serials, incl. the literal caption 'Your PO'), zero collateral, all scored
   lanes identical to base. The sandbox had ZERO hidden rows — the arm's mutator declares what GT
   proves absent, so it measures the mechanism, not vacuum.
5. **Chris rerun** — see his section below (appended when he returned).

## What was verified / measured (read-only, live DB)
- Audit last 24h: 497 reprocess (the owner's 21:21 post-restart batch), 37 review_confirmed, 0
  auto-file actions. `recent_auto_filed` = the 20 Meadowvale docs from 08-10.
- `corroboration_autofile='true'` in live DB (owner's flip stands). It has never fired — for
  Pelican that is CORRECT twice over: the scope has 2 corrections (doc 493) so the zero-corrections
  condition fails, and frozen-issuer scopes are deliberately excluded (their path is graduation).
- 0016's corroboration records show the machinery working: account_no winner disagrees with a
  keyword read; invoice_number crop winner disagrees with the correct mapping read.

## Commit (1, pushed)
`afe8da0` — the name-clip slice + hidden-drop arm; full story in the commit message and
`docs/oracle_log.md` (2026-08-11 LATE-NIGHT entry). New pins:
`python_backend/tests/test_template_name_edge_grow.py` (22) · `test_box_snap.js` 8b ·
`test_value_locate.js` 13 · wiring-pin row for `name-edge-grow-toggle`.

## Open / conditions (load-bearing)
- **C7 stored-box repair arm** — the cure for EXISTING live templates (owner decision, own gate,
  backup-first). Without it, live flush boxes heal only where sibling drift ≥ the 0.004 floor.
- **C3 owner-watch**: the 90→70 un-squat's 71-89 window can swap one wrong string for another
  un-noted ('SITE ADDRESS' @78, observed once, zero lane cost). Census-watch, no build.
- **C6 standing rule**: never arm `NAME_UNCLIP_RECONCILE` alongside the name leg without a fresh A/B.
- Owner test script C–F + A3 still need the OWNER'S eyes (unchanged).
- tpl 9 Pelican angle row still HELD; buyer-issued slices 2/3; label-above keyword coverage —
  all unchanged from the LATE handover.

## Chris round 3 — rerun of the past two nights (owner-ordered comparison)
Full verbatim report + conditions header: **`docs/CHRIS_FULL_APP_REVIEW_2026-08-12.md`**.
Screenshots preserved to `~/Desktop/TESTING/_chris3_screens/` (20). Sandbox left RUNNING on CDP
9223, PID 132896 (session-mortal — next /christest rebuilds).

**HEADLINE: the wrong-company bleed is FIXED in BOTH variants.** He reran last night's exact
poison (garble-read ⊕ teach on an owner-issued purchase order, confirmed it, Reprocess all):
**0 of 20 Oakhaven notes affected** (all stayed "Sender not identified"), the garble contained to
5 same-supplier docs — every one flagged "doesn't read like a name — please verify" and HELD by
File All Ready — and **zero VAT crossover** (he opened the metadata on disk). File All Ready
filed 45 docs, each company carrying its own VAT. His verdict: *"Yes — and for the first time
without a condition attached to my documents' safety."*

**Verify list:** 14 prior findings FIXED (incl. Approve two-step arm — his 4-press ghost — the
locate-step green glow, Reprocess-all warning, recovery-code copy/print, queue-count honesty,
Restore-all existence), 2 BETTER-BUT (tour card 5 still over-promises self-filing; Settings now
63 toggles), 3 SAME (confirm says nothing about destination; File All Ready gives no summary
count; red dots on High-confidence fields).

**His 8 new findings, triaged (owner vet queue — NOTHING implemented):**
1. **HIGH — the teach-time plausibility warn NEVER SPOKE** on 'SIIPDI ico' (nor the success
   toast). DIAGNOSED in code post-run: the warn block in `review/renderer.js` ~:3634 is nested
   inside `if (detected)` — it only runs when the ANCHOR CAPTURE succeeded, so a garbled read
   that also fails capture (or hits the new stale-box suppression) exits silent — exactly the
   moment it exists for. Also explains his finding 3 (⊕ silent on success and failure). Candidate
   fix: run the plausibility check on the READ, outside the anchor branch + always answer a draw.
2. **HIGH — stale recycle-bin view**: bin open during Delete-All showed "empty", Restore-all
   no-opped silently while 152 docs sat inside; fresh entry restored all 152 perfectly. Not data
   loss — a view-refresh defect on the one screen that must never lie.
3. Medium-high — ⊕ teach silent (same mechanism as 1).
4. Medium — reprocess flipped ~45 docs green→amber via the `template_identity_on_page` logo-only
   hold (fresh-install default ON): guard honest, surprise unexplained; wants a reprocess-summary
   line ("N held for an extra check").
5. Medium — wizard label auto-detect presents GARBLED labels ('Zor', 'ITLI ANNO') for approval
   exactly like real words (empty gets the honest fallback; garbled does not).
6. Low-medium — a table border read as '|' inside a reference; review rows should jump to the field.
7. Low — cold-start offers a one-word fragment ("Use 'Cleaning'") as a company.
8. Low — Split PDF gave no visible response on a 1-page doc (possibly a transient his watcher missed).

## Key facts / paths
- Chris sandbox: `C:\Users\cmccu\.claude\jobs\3ab7c2e3\tmp\chris-sandbox\` (userData/Output/Demo
  Docs = the TESTING\IMPORT 200 scans), app on CDP **9223** PID **132896**, seeded with the owner's
  learning via `seed-taught-state.js` from a `db.backup()` snapshot (same 1-of-9-templates
  deviation as the 08-11 round, stated to Chris up front). Session-mortal — next /christest
  rebuilds it.
- Arm outputs: `~/Desktop/TESTING/arms/{base,namegrow,hiddendrop}.json` +
  `base_preedit_namegrow.json` (the md5 twin); census
  `~/Desktop/TESTING/_measure/namegrow_census/*.jsonl`.
- Deleted on sight per the LATE handover: the 4KB truncated `corrob_flipgate_snap.db`.
- The gotcha that did NOT bite tonight (avoided by design): all probe JS written via the Write
  tool, never Bash heredocs; every DB probe printed its resolved path first.
