# HANDOVER — 2026-08-13 NIGHT (slice-3 Oracle B2 gate built + run · Chris round 4)

**Branch `feat/teach-side-overnight` · HEAD `1766c62`, PUSHED.** Owner present at the start
(ordered the B2 gate), then asleep — the Chris round ran under the standing autonomous rules.
**No flag flipped, no live-DB write, no migration (still 63), no production code changed.**

## TL;DR
The owed slice-3 flip gate (Oracle B2) is BUILT and RUN over every replayable document on the
install. The gate's own numbers are clean — **demoted-and-wrong at DOC level = 0, collateral 0** —
but building it turned up something bigger than the gate: **`realdoc_regression.js` has never run
the app's flag configuration**, and that artefact is what produced the "the note does not re-form on
harness replay" claim for BOTH slice 2 and slice 3. With the app's env mirrored, both classes
re-form on the first document. `NAME_CORROB_NOTE_DEMOTE` still ships OFF: B2's second clause is met,
its first clause is not, and the owner should read §3 before flipping.

## 1. THE HARNESS FINDING — read this before trusting any older arm
`handler.js` spawns every import/batch extraction with
`_autoTitleEnv + _ocrDpiEnv + _anchorCropEnv + _reconcileEnv` (handler.js:2008-2014). On this
install that is **63 environment variables** — ~47 shipped toggles the owner has ON.
**`realdoc_regression.js` passes NONE of them**, so every arm in that file runs a DIFFERENT product
configuration from the app (the flags read `os.environ` and default OFF inside Python). That is
harmless for an A/B where both arms share the deficit, and fatal for any "does this class occur?"
question.

Stacked on top of it, two more blinders for this particular class:
- realdoc replays **CONFIRMED documents only**. The live carriers of the Layer-A name note are
  4 DELETED docs + 1 `needs_review` doc — so realdoc could never see one.
- realdoc passes `--reprocess-manifest`, which models REPROCESS. With a known template pinned,
  Stage 0.5 answers `customer_name` first and the Stage-2 relocate guard never gets to note it.
  The class forms on the IMPORT path.

Mirror the env, drop the manifest, replay any status: **the class fires on the first document.**
- `realdoc_regression.js` now takes **`RR_APP_ENV=1`** (DEFAULT OFF — turning it on changes the
  baseline of every historical arm in that file, so it is opt-in and must be stated when used) plus
  a comment naming the gap so it is not rediscovered a third time.
- **Slice 2 is affected identically.** Its pendingfeatures entry claimed the adjusted-total note
  does not re-form on replay, so "class-exercised acceptance = the owner's live reprocess". Re-run
  with the app env, `recon_demote_census.jsonl` on #1217 reads
  `{"field":"total","committed":"3,564.72","demoted":true,"witness":"template_mapping",
  "witness_conf":90,"committed_conf":93,"arith":true,"rejected":"3,864.72"}` — the owner's own
  exhibit, demoted correctly (the doc scores 0 wrong vs corpus GT). Slice 1's xcheck census fires on
  the same doc too (`quote_date` 26-03-2025 over a rejected 26-08-2025, correct). **Both entries
  struck and corrected in `pendingfeatures.md`.**
- **OWED, and now possible:** a slice-2 OFF-vs-ON arm over the same 914-doc population. It was never
  run because the class was believed unreachable. `name_demote_b2_gate.js` can host it with one env
  change.

## 2. THE INSTRUMENT — `stress_test/name_demote_b2_gate.js` (new, committable, carries no data)
- **Status-agnostic population** (any status; file resolved via `working_path` → `stored_path`).
  Default = the note's carriers + their scope siblings; `B2_ALL=1` = every replayable doc;
  `B2_DOCS=` = explicit ids.
- **The app's REAL env builders are required, not copied** (`H._autoTitleEnv`/`_anchorCropEnv`/
  `_reconcileEnv`), so the mirror cannot rot. `_ocrDpiEnv` is reproduced exactly (emit only when
  ≠ 300).
- `B2_FRESH=1` drops the manifest = the import path. `OCR_RENDER_DPI` from the live `ocr_dpi`
  setting — the 300-vs-200 vacuous-arm trap that made slice 1's first armed arm meaningless.
- `B2_WITH_SLICE2=1` arms slice 2 in **both** arms, so the delta stays slice 3 alone while the
  doc's OTHER note is out of the way — that is how the sole-hold configuration is reached with real
  pixels.
- Per doc, per arm: `needs_review` · `overall_confidence` · every extraction's value/conf/note/
  method · **`trust.isAutoFileEligible`** (the real shared predicate, `extraction_method` and
  `corroboration` threaded — omitting either makes an arm vacuously green) · the **FAR two-tier
  "needs a look"** rule from `documents.js` · every scoreable field vs GT.
- **GT honesty:** corpus `ground_truth.json` keyed by filename with the `-<n>` import suffix
  stripped (it resolves **1335/1336** docs), else the DB's confirmed values; a doc confirmed by a
  MACHINE via (`machine_vias.js`) is marked **SUSPECT** and kept OUT of the pass/fail count.
- Report sections: did it fire · **1b why not, per name field** (a "0 fired" run is otherwise
  undiagnosable and looks like a pass) · A2 · doc-level demoted-and-wrong · production
  auditability · the #259 shape · **4b counterfactual** · collateral · per-doc detail.
- `GATE=1` exits non-zero on demoted-and-wrong > 0, any collateral, or any census row in the OFF arm.

## 3. THE B2 RESULT — 914 replayable docs, OFF vs ARMED (`stress_test/out/b2_wide.md`)
Import path, 200 DPI, slice 2 armed in both arms.
- **Class rate 2/914** — #442 (confirmed) and #1217 (needs_review), both demoting
  `customer_name='Bramblewood Joinery Ltd'`, **both correct vs corpus GT**. Census: 2 demoted,
  **0 DECLINED**, **0 rows in the OFF arm**.
- **Collateral 0** — no other field differs between the arms on any of the 914.
- **GATE: demoted-and-wrong at DOC level on newly-unparked auto-files = 0.** The instrument is not
  vacuous — it scores **124 of the 914** as carrying at least one wrong value, identically in both
  arms (incl. the known Pelican `PI/26/…` → `P1/26/…` class, which the comparator does detect).
- **A2 ANSWERED = YES, and it is the headline.** No confidence is minted, so the field stays at 70 —
  but the field-level review threshold is `< 70` (documents.js:209), so **70 does not trip
  `below_threshold_valued_count`**. Both docs go `flagged → auto-file ELIGIBLE` and leave the "needs
  a look" bucket. And with `autofile_gate_unify` ON (live), `_maybeAutoFile` no longer bails on
  `needs_review` — it defers to the predicate — so Python still reporting `needs_review:true` does
  NOT hold the doc. **Releasing this note files the document.**
- **B2 clause 1 is NOT met — hand this to Oracle.** The #259 SHAPE (name note the sole hold while a
  sibling is silently wrong) does not occur in the population, so §4b asks the real predicate about a
  deliberately spoiled doc: corrupt the ref-role value, leave it unnoted at the same confidence ⇒
  **STILL ELIGIBLE — nothing else holds it.** The accidental safety Oracle named is real: today the
  phantom name note is the only thing between these two docs and the filing cabinet, and it was never
  evidence about the ref.
- **The "or the census must catch it" branch IS met, by SHIPPED code:** the demote writes
  `note_demoted` into the corroboration record, which is persisted (`extractions.corroboration`) and
  surfaced in Review/SFDEV — verified present on both docs with the witness pair
  (`template_mapping` + `keyword_override`) and 2 recorded guard-rejections each. Every release is
  queryable after the fact with no env-gated census.
- **The decision in one line:** a 2-in-914 release rate, both correct, both auditable — against the
  fact that after the release nothing else holds the doc if a sibling is silently wrong.

Suites at HEAD: `test_name_corrob_demote.py` **39/39**, `test_recon_note_demote.py` **34/34**.
Reports: `stress_test/out/b2_wide.md` (wide), `b2_scope.md` (41-doc scope arm, same verdict),
`b2_double_exhibit.md`, `b2_slice2_probe.md`. `stress_test/out/` is gitignored — real values.

## 4. CHRIS ROUND 4 — comparison rerun
Sandbox: `<session scratchpad>\chris-sandbox\` (session-mortal), own userData + Output, CDP **9223**,
PID **16240**, create-first-admin flow confirmed (0 users). Corpus copied in for him: the **same 200
scans** (`Desktop\TESTING\IMPORT`) as rounds 2 and 3. Taught state grafted from a read-only
`db.backup()` snapshot: 8 custom types / 62 fields, 12 anchors, 664 hints, 17 logo fingerprints, 12
label overrides — **1 of 11 templates transferred, 0 field mappings**, the SAME seeding deviation as
round 3 and stated to him up front, so the comparison is like for like. Flag state = fresh-install
defaults, NOT the owner's hand-flipped live settings (also the same as round 3).

**Full report + my after-the-fact verification: `docs/CHRIS_FULL_APP_REVIEW_2026-08-13.md`.**
Nothing implemented. Sandbox left running on **CDP 9223, PID 16240** (next `/christest` rebuilds it).

**FIXED since round 3:** the 63-toggle Processing page is now 24 (7 on) in plain English · the
cold-start junk-fragment company suggestion is gone (replaced by an honest hold sentence) · Split
PDF speaks (*"This document is only one page"*) · a "Value wrong? Type it as printed" box now sits
on the panel that used to dead-end. Everything round 3 marked FIXED stayed fixed.

**STILL BROKEN, unchanged:** the teach-time plausibility warning never speaks (4 draws — `eee`, a
whole address block, `B8ramblewood` — zero messages) · the ⊕ teach is silent on success AND failure
· the recycle-bin view goes stale during Delete All and "Restore all" then does nothing (he counted
**zero** native dialogs, so it is NOT his driver swallowing a prompt) · garbled auto-detected labels
are still offered with "Looks right →" as the primary button · confirming never says where the file
went · red "error" dots on correct fields.

**HIS TWO HEADLINE NUMBERS ARE MOSTLY A SEEDING ARTEFACT — verified, do not chase them as
regressions.** `seed-taught-state.js` transfers exactly ONE template and which one is arbitrary.
Round 4 drew live template **13 = "Bramblewood Joinery Ltd" / purchase_order with `supplier_name`
AND `vat_no` frozen (`is_variable=0`) to the owner's own values** — the buyer-issued template. That
is the KNOWN, still-open class Chris himself reported on 2026-08-11 and CLAUDE.md records as open
(*"the 08-10 fix closed the supplier case and left the buyer-issued case open"*), which is why 40
Oakhaven/Nordwind docs arrived under the owner's name with the owner's VAT. Round 3 drew a different
template, hence its "Sender not identified". Same cause inflates his 188-vs-147 and 19-spread-vs-5.
(I did not record round 3's grafted row, so this is strongly indicated, not certain.)

**WHAT IS REAL AND NEW — the vet queue:**
1. **A teach OVERWRITES a template's FROZEN identity value with a garbled read, unflagged.** Verified
   in the sandbox DB: `template_fields.fixed_value='B8ramblewood Joinery Ltd'`, `is_variable=0`, which
   then stamped **20 Quillstone purchase orders** via `template_fixed` at **95 with an EMPTY
   validation_note**; 20 confirmed, **12 written to `Output\B8ramblewood-Joinery-Ltd\`**. The garble
   also became a learning SCOPE key (a `field_anchors` row is now scoped to the misspelling). This is
   freeze-from-a-sample-of-one (`TEMPLATE_FREEZE_QUALIFY`, still OFF) meeting a silent teach surface.
   His proposed signal is the right one: **near-match to an existing company**, not name shape —
   `B8ramblewood` passes any plausibility check by construction.
2. **Teaching one field silently empties two others** (drew on Document Issuer ⇒ `customer_name` and
   `vat_no` went blank on screen, dot flipped taught→not-taught; reproduced on 2 docs; ⊕ without a
   draw does nothing, so it is the draw).
3. **"Empty bin" promises to delete the filed PDFs and does not** — the filed copy survived on disk.
4. **File All Ready has no count in its warning and no summary after** (filed 19 silently).
5. **Credit notes type as Invoices out of the box** while Settings openly says the switch *"Fixes
   credit notes being typed as invoices. Off by default."* — a defaults question for the owner.
6. The APPROVED stamp lands over the company name and the document title.
7. One supplier split across "recognised" and "Sender not identified" piles (7 + 18).

**What he praised:** the approval workflow end to end (send/approve/reject-with-required-reason/
recall/Mailbox/Sent/stamped copies) — *"I would hand that to my office tomorrow"*; the practice run,
which answers **"Read 'INV-1042' from your box"** every time — the exact sentence the real teach has
never once said; the rewritten Processing page.

**Verdict moved the wrong way:** round 3 was *"Yes — and for the first time without a condition
attached to my documents' safety."* Round 4 is **"Yes — but the condition is back on."**

## FIRST ACTIONS (fresh session)
1. **Owner decision on `name_corrob_note_demote`** — the evidence is in §3; recommend an Oracle read
   of the §4b counterfactual first. It ships OFF.
2. **Run the slice-2 OFF-vs-ON arm** over the 914-doc population now that the class is known to be
   harness-reachable (`name_demote_b2_gate.js` hosts it; slice 2 is the one with "evidence complete"
   against its name, and that verdict rested on the artefact struck in §1).
3. Machine-feed slice 1's remaining blockers: the C5 gate-unify round-trip pin + the C1 small census.
4. Consider whether any other gate in the repo rests on a realdoc arm that never ran the app's flags.

## Needs the USER
- The three flip decisions (`recon_total_note_demote`, `name_corrob_note_demote`,
  `learning_exclude_machine_confirms`) — all still OFF.
- The 4 `Bramblewood Joinery Ltd` wrong-party customer rows on confirmed Quillstone POs.
- Chris's round-4 findings — vet queue, nothing implemented.

## Key paths / gotchas
Live DB `%APPDATA%\ScanFinder\docusnap.db` (mig 63, `ocr_dpi=200`). New harness
`stress_test/name_demote_b2_gate.js`; `realdoc_regression.js` gained `RR_APP_ENV=1` (OFF).
GOTCHAS: realdoc = confirmed docs only AND no app env AND reprocess-modelling — three independent
blinders, all three must be cleared before "the class does not occur" means anything · a script
outside the repo must `require` node_modules by absolute path · `ELECTRON_RUN_AS_NODE=1` for JS
suites · `PYTHONIOENCODING=utf-8` for the Python suites on this console.
