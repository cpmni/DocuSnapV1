# Chris The Customer — Full App Review — 2026-08-25

## Round 1 (post-resume vet)

**Sandbox conditions:** fresh install (create-admin first-run), CDP 9223, mig 87, ~135 switches ON bar
straighten. THIS ROUND additionally armed `batch_audit_enabled=true` so Chris could vet the brand-new
"Quick check" grid (its backend landed 2026-08-24 `eef96bd`, the front-end resumed + committed this
session `c1d5c08`). Corpus = Demo Docs (Copperfield + Saltmarsh imported). Two DARK backend arcs
(`name_dominant_snap`, `branding_strip_reg_boilerplate`) stayed OFF (backend accuracy, can't fire on a
fresh untaught corpus, not Chris-visible).

**Sandbox login Chris created:** `chris` / `plumber2026` · recovery `2KEF-SMEQ-2MGU-BRRC`.

### Triage (owner authorised "fix problems then re-run Chris" for this overnight round)
| Card | Sev | Verdict | Action |
|---|---|---|---|
| 1 — Confirm & File accepts a present-but-invalid date → silent misfile to `Unknown-Year/Unknown-Month` | HIGH | REAL BUG (known class) | **FIXED** — gary+Oracle WRONG-LAYER: gate on `filing.normaliseDate` server-side (reviewService.confirm refusal + `_autoFileDoc` hold + batchAudit align + renderer pre-block) |
| 2 — Terms say "WORKING DRAFT… NOT YET IN FORCE" + `[SOLICITOR:]` notes | HIGH (trust) | Owner domain (legal) | QUEUED — owner finalises solicitor text |
| 3 — Quick-check re-file renames `Invoice.…` → `Document.…` | MOD-HIGH | REAL BUG (new code) | **FIXED** (`batchAuditService._resolveDtInfo` resolves slug from `document_type_id`) |
| 4 — Half a new supplier's invoices → "Sender not identified" (logo matched another co, text disagrees) | MOD | Detection arc | QUEUED — letterhead-name-over-abstain; needs census+Oracle, too risky overnight; one confirm teaches it |
| 5 — Quick-check Cards view shows dev codes (`anchor_inline`/`keyword`) | LOW-MOD | REAL (new code) | **FIXED** (`_baFieldMeta` drops the method token) |
| 6 — Queue row still says "Needs: Invoice Date" after the field was filled | LOW | Stale-refresh nicety | QUEUED — low, refresh-timing, Chris himself unsure it's real |
| 7 — Empty bin removes the PDF but leaves the `.metadata/*.xml` sidecar | LOW | REAL minor bug | **FIXED** (`_purgeOne` removes the sidecar) |
| Config note — the grid was ON but the activity strip (its entry point) was OFF | — | Flip coupling | QUEUED — flip the strip wherever the grid is on |

### Verdict
**Yes — would keep using it and pay.** Wanted Card 1 + Card 3 fixed before trusting it unsupervised
(both fixed this round); Card 2 (draft Terms) would make a customer hesitate at the shop door.

---

### Chris's report (VERBATIM — transcribed from the completion notification; the live transcript comes back empty per the standing trap)

**Sandbox login:** `chris` / `plumber2026` · recovery `2KEF-SMEQ-2MGU-BRRC`.
**Harness note:** the CDP driver auto-dismisses native `confirm()` dialogs; for File All / Apply corrections / Empty bin, Chris captured + judged the wording then accepted on the user's behalf so the actions genuinely ran. He turned ON `review_activity_strip` to reach the Quick-check button (config note below). All inside the sandbox.

#### Finding cards (ranked by harm)
- **Card 1 — Confirm & File accepts an invalid date and silently files to "Unknown" — HIGH.** Empty date correctly greyed Confirm; a present-but-unreadable date ("1/ 2026" → "Not a valid date") left Confirm ENABLED, filed with no warning to `…/Copperfield-Electrical/Unknown-Year/Unknown-Month/Invoice.INV-29273.pdf`. "I would never know it misfiled." Proposed: treat "Not a valid date" like empty — block/warn.
- **Card 2 — The Terms say "WORKING DRAFT… NOT YET IN FORCE" with "[SOLICITOR:]" notes — HIGH (trust).** Agreeing to a document that says it isn't finished. Reported as a QUESTION; content undermined confidence. Owner/legal domain.
- **Card 3 — Correcting a value in Quick check re-files "Document.…" instead of "Invoice.…" — MOD-HIGH.** Success msg "✓ Re-filed as Document.23-11-2026.INV-29597-QCTEST.pdf"; on disk `Document.…pdf` while the other 17 are `Invoice.…`. Filing got less accurate as a side-effect of fixing a number.
- **Card 4 — Half of a new supplier's invoices land in "Sender not identified" — MOD.** "Saltmarsh Seafoods" printed large on every page, yet 9/20 came back no-sender because the badge matched a different company ("logo matched another company but the page text doesn't agree"). Proposed: prefer the large printed letterhead name over abstaining.
- **Card 5 — Quick check Cards view shows developer codes ("94% · anchor_inline", "95% · keyword") — LOW-MOD.** Table view sensibly shows just the %; Cards added the internal labels.
- **Card 6 — The queue row still says "Needs: Invoice Date" after it was filled — LOW.** Stale until confirm/reprocess.
- **Card 7 — Empty bin removes the PDF but leaves a stray `.metadata/*.xml` — LOW.** Warning itself truthful.

#### Warnings truth-table
| Button | Warned | Actually | Truthful? |
|---|---|---|---|
| Delete (single) | "recycle bin… restore later" | binned, filed copy kept, restorable | ✅ |
| Restore all | "back to review queue or filed folder" | restored to filed, no duplicate | ✅ |
| Empty bin | "permanently delete… including PDFs… originals not touched" | filed PDF removed, 20 originals untouched; XML sidecar left | ✅ (minor leftover) |
| File All Ready | "File 18 (of 19)… 1 flagged stays… as if you confirmed it" | filed 18, left the 1 | ✅ |
| Split PDF | "only one page — nothing to split" | correct | ✅ |
| Reprocess | (no warning — non-destructive) | re-read, issuer still Not found | ✅ |
| **Confirm & File (invalid date)** | **(no warning)** | **filed to Unknown-Year/Unknown-Month** | ❌ **Card 1** |

**Config note:** the Quick-check *grid* was enabled but the *activity strip* carrying its button was OFF (`review_activity_strip` unset) — as shipped in this config a customer would never see the entry point. Flip the strip on wherever the grid is on.

#### What worked / friction / verdict
- **Worked:** honest automation everywhere (File All "as if you confirmed it yourself"; "your original scans are never deleted"; issuer-confirm note; Empty-bin reassurance); the Quick-check grid concept + execution; instant search retrieval.
- **Biggest friction:** the invalid-date silent misfile (Card 1) breaking the app's otherwise-honest "shows its work" promise.
- **Two-week verdict:** **Yes — would keep using it and pay.** Wanted Card 1 + Card 3 fixed before trusting it unsupervised; the draft Terms (Card 2) would make him hesitate at the shop door.
- **Humility:** one simulated non-technical user, one pass; some issues (garbled taught date, needing to enable the strip) came from how he drove the app; impressions for the owner to vet.


---

## Round 2 — focused re-verify (same sandbox userData relaunched on the fixed code)

All four fixes confirmed live; no regressions. Verdict: **yes, with more confidence than last round.**

| Card | Verdict | What Chris saw |
|---|---|---|
| 1 — invalid date silent misfile | **FIXED** | `1/ 2026` → field "Not a valid date", plain message about an unknown date, Confirm & File **disabled**. `15/12/2025` files fine. OCR-spaced `15 / 12 / 2025` filed correctly to `Saltmarsh-Seafoods/2025/December/Invoice.15-12-2025.INV-79528.pdf`. |
| 3 — Quick-check keeps the type in the name | **FIXED** | Edited a value, Apply → re-filed `Invoice.07-02-2026.INV-25557-QC.pdf` (kept "Invoice."). |
| 5 — no dev codes on Cards | **FIXED** | Cards show only "100%" / "Invoice Date 98%" etc. — no anchor_inline/keyword. |
| 7 — no orphan metadata on Empty bin | **FIXED** | PDF and its `.metadata` XML both removed; only an empty `.metadata` folder remains (harmless). |

Historical residue confirming the bugs were real (from round 1, pre-fix, still on disk):
`Copperfield-Electrical/Unknown-Year/Unknown-Month/Invoice.INV-29273.pdf` and `.../November/Document.23-11-2026.INV-29597-QCTEST.pdf`.

**New (low harm) — Card A:** OCR-spaced `15 / 12 / 2025` showed a red "Not a valid date" field note while
the Confirm button stayed active and the doc filed correctly — a mixed signal (no harm). QUESTION-class.
→ FIXED this session (`97d3527`): the on-blur date note now accepts whatever `_parseDrawnDate` accepts
(preclean), so it agrees with the Confirm button and the folder builder. Only relaxes → no new false warning.

Regression sweep: import+review, File All Ready (honest zero-filed receipt), search, delete→restore — all pass.

---

## Round 3 — Card A single-fix verify (sandbox relaunched on `97d3527`)

**Card A → FIXED.** Spaced `15 / 12 / 2025`: no red note, "High · 98%" tag, Confirm active — note and button
agree. Broken `1/ 2026`: red "Not a valid date" + the plain helper "The Invoice Date can't be read as a real
date, so this document would be filed under an unknown date. Please correct it before filing." + Confirm
**disabled**. Sanity pass (normal review+file ticked 19→18; search found the just-filed doc). No regressions.

**Trivial cosmetic aside (queued, not fixed):** on a broken date the green "High · 98%" read-confidence pill
still sits beside the red "not valid" note. Chris confirmed it did NOT mislead (button disabled + helper
clear). It's read-confidence (the OCR was sure what it read) vs typed-value-validity — a genuine tension, not
a bug. Owner may tidy the pairing if desired; low value.

## Session outcome
4 real bugs (Cards 1/3/5/7) + 1 cosmetic wrinkle (Card A) — **all fixed and Chris-verified across 3 rounds,
zero regressions.** Commits `200e68d` (Cards 1/3/5/7) + `97d3527` (Card A). **Owner vet queue (not built):**
Card 2 (draft Terms — legal), Card 4 (letterhead-name-over-abstain detection arc — census+Oracle), Card 6
(stale queue-row refresh), the grid↔activity-strip flip coupling, and the green-pill/red-note cosmetic pairing.

---

## Round 4 (2026-08-25 later) — issuer_sibling_fill C2-widening GATE (Oracle SEND-BACK-then-corrected)

**Sandbox conditions:** fresh install (create-admin first-run), CDP 9223 PID 17244, mig 87, `issuer_sibling_fill`
armed (setting + env `ISSUER_SIBLING_FILL=1`) + `review_activity_strip` on. Corpus = Demo Docs (Saltmarsh
Seafoods + Thornbury Fasteners imported). This round is the fired-path half of Oracle's flip gate for the
CORRECTED C2 (logo≤13 OR `convergesByBranding(0.80)` + mature-sibling identity re-check). The collision-safety
half was measured separately (real-data census, below).

**Collision-seam census (owner's real 1668-doc / 11-supplier backup, `convergesByBranding@0.80`):**
CROSS-supplier pairs **0 / 1,250,932 converge (0.000%)** — a garble-collision cannot slip the branding arm.
SAME-supplier pairs **87.1% converge** — genuine siblings admit strongly. (Plus unit PIN h2 + the measured
RED-on-old-raw-0.60 / GREEN-on-convergesByBranding proof.)

**Verdict: strong YES, zero misfiles across two suppliers.** 0→17 filed in one click; the safety watch held
both ways (Saltmarsh confirm never touched Thornbury, incl. 3 look-alike-badge Thornbury docs the sweep
refused). Undo/Put-back clean; every scary-button warning true. NEW finding cards (owner-vet queue, NOT built):
Card 4 one identical Saltmarsh sibling left behind (the coverage cost of the tightened bar — safe, fail-toward-
review, one extra confirm) · Card 6 the sibling-chip "Put back" tooltip talks about filed files when nothing
filed yet (copy) · Card 3 queue counts don't reconcile ("N more to file by itself") · Card 5 activity chips go
stale/stack · Card 7 "needs a quick check" on a doc File-All then files. Card 1 (draft Terms) + Card 2
(look-alike badge pre-fills wrong sender, held+flagged — the `branding_strip_reg_boilerplate`/Card-4 class)
recur from prior rounds. NONE is a safety regression from the C2 change.

### Chris's report (verbatim)

**TL;DR (3 lines):**
1. **The headline fix works, and it's the best thing I've seen from this app.** I confirmed ONE Saltmarsh invoice, accepting the name at the top, and 18 identical ones sorted themselves — "File All Ready" went from offering **zero** to filing **17** in one click, all into the right Saltmarsh folders.
2. **It didn't misfile a single thing across two suppliers.** When I mixed in a second company (Thornbury), confirming Saltmarsh never touched a Thornbury paper, and confirming Thornbury never touched a Saltmarsh one. Every scary button's warning told the truth, and Undo cleanly put things back.
3. **The remaining problems are trust/polish, not safety:** my legal agreement still shows unfinished "draft, not yet in force / [SOLICITOR:]" notes; a look-alike company badge pre-filled the WRONG sender on 3 papers (caught and held, but unnerving); and a few counts on screen don't add up.

Note on method: I'm one made-up office manager, not a room of testers. I drove the real sandbox app and photographed every step. One thing I couldn't do the normal way — the "Browse" button for the output folder opens a Windows picker my helper can't click — so I set the output folder to the sandbox the same way the Settings screen would. Everything else is exactly what a customer clicks.

**Walkthrough:** Made the admin login (`chris`); recovery-code screen makes you tick "I have saved this code" before Continue lights up. Setup wizard + tour in plain English. Home showed "WHERE YOUR FILES GO" + "You're all caught up". Imported 20 Saltmarsh invoices — every one held **"The letterhead reads 'Saltmarsh Seafoods' — filled in for you, but please confirm it's the sender, not the customer, before filing."**, File All Ready offered **0**. Confirmed ONE (accepted, no retype) → blue chip **"18 more ready to file — Just now · Saltmarsh Seafoods"**, 18 flipped from "Check". File All Ready dialog **"File 17 ready documents (of 19)… 1 flagged, 1 missing a required detail"** → filed 17, chip **"You filed 17 · 2 kept back"**. All landed under `Saltmarsh-Seafoods\2026\<Month>\Invoice.<date>.<INV>.pdf`; sender saved as **Saltmarsh Seafoods**, NOT the Bill-To (Kingfisher). One identical Saltmarsh invoice left behind still asking to confirm the sender. Imported Thornbury too — 3 Thornbury papers pre-filled sender **"Saltmarsh Seafoods"** (look-alike round-"SS"/hexagon-"TF" badges) but each held + flagged **"Matched by logo only — the page text doesn't confirm this company. Please check."** Confirmed a Thornbury → **"16 more ready to file · Thornbury Fasteners"**; cross-company safety held both ways; the chip's **"Put back"** cleanly returned the 16.

**Finding cards (ranked by harm):**
- **Card 1 (HIGH, trust) — Terms still show "WORKING DRAFT — … NOT YET IN FORCE" + "[SOLICITOR: confirm the enforceable contracting-party identity…]".** First legal thing a paying customer signs; reads unfinished. QUESTION (won't edit legal wording) — finish/remove the internal banner + [SOLICITOR:] notes before selling.
- **Card 2 (MEDIUM, trust; safety held) — a look-alike badge pre-filled the WRONG sender on 3 Thornbury papers** ("Saltmarsh Seafoods" with "Matched by logo only — the page text doesn't confirm this company. Please check."). Caught, held, refused by the sweep — nothing misfiled. Proposed: when badge-only AND page text disagrees, leave sender **blank** rather than a confident wrong name (keep the hold+warning).
- **Card 3 (MEDIUM, slowed/trust) — counts don't add up:** "Saltmarsh Seafoods — 20 documents · 20 need a look · 5 more to file by itself". One honest line instead.
- **Card 4 (LOW/MED, slowed) — one identical invoice left behind while its 18 twins swept** (SaltmarshSeafoods_invoice_18, "Check · 69%", same layout). Sweep it too if same sender+layout, or say why it's singled out.
- **Card 5 (LOW, trust) — the "what just happened" chips stack + go stale** ("18 more ready" stayed after only 17 filed / 2 kept back). Retire/fold a superseded chip.
- **Card 6 (LOW, trust) — "Put back" tooltip talks about filed files when nothing was filed yet:** "The copies already written to your filing folder stay there and are replaced when you file them again." For a not-yet-filed sweep, say "Nothing has been filed yet."
- **Card 7 (LOW, trust) — "Needs a quick check" on a paper File All then files** without me checking (three shown details all "High"). Reserve "needs a quick check" for things that actually block filing.

**Warnings truth-table:** Delete one (row-vs-open note) ✅ · Delete All Review ✅ · Restore all ✅ · Empty bin (original scan survives in Processed) ✅ · File All Ready ✅ · Reprocess N ✅ · Reprocess all (honest it may auto-file, points at Undo) ✅. Every warning told the truth.

**Safety watch (must NEVER happen — it didn't):** Saltmarsh+Thornbury imported together; confirming Saltmarsh filled only Saltmarsh siblings, confirming Thornbury filled only Thornbury; the 3 look-alike-badge papers were held+flagged+refused by the sweep at every step. Final: 19 under Saltmarsh-Seafoods, 1 under Thornbury-Fasteners — not one paper crossed companies.

**What worked / verdict:** the batch-filing chore (confirm the sender on twelve identical invoices one by one for nothing) is gone — one confirm, 18 followed, one honest click filed 17, undoable. Delete/Empty-bin warnings the most honest in the app (tell you the original scans are safe). **"Would I keep + pay after two weeks? Yes"** — the chore that made him consider going back to lever-arch folders is solved, 20 invoices across two suppliers filed with zero misfiles, everything visible + undoable; wants the draft Terms finished before paying. Humility: one made-up office manager, not a room of testers; the output-folder Browse picker couldn't be clicked by the driver (set the folder the Settings way).

---

## Round 5 (2026-08-25 overnight) — FULL run-through on the CHRISBOT battery (452 scans)

**Sandbox conditions:** fresh install (create-admin first-run), CDP 9223 PID 8924, mig 87, `issuer_sibling_fill`
+ `review_activity_strip` + `batch_audit_enabled` armed, `ISSUER_SIBLING_FILL=1`. Corpus = the owner's
**CHRISBOT** battery copied into the sandbox: SINGLE (10, teach set) · IMPORT (200, cold first batch) ·
IMPORT2 (200, warm) · SCANNED (10) · SCANNED_HARD (10, degraded) · DOC SOL (22, variety). Owner asleep;
autonomous overnight run (~67 min, 203 tool calls).

**LEAK CHECK (main session, verified independently):** owner's real `Documents\Scan Finder` = 10,759 files
but **0 written in the last 8h**; all 430 sandbox `Output` files (215 docs + .metadata) stayed in the
sandbox. Chris caught the setup wizard defaulting the output to the owner's real `Documents\Scan Finder`
and corrected it to the sandbox BEFORE any doc filed — no leak.

**Note on the sibling-fill feature (main session interpretation):** Chris TAUGHT the suppliers first (from
SINGLE), so by IMPORT time they were KNOWN suppliers — their issuer read via template/anchor, NOT the
`letterhead_prefill` hold the sibling-fill triggers on. So his "confirming one didn't offer the 20 siblings"
is the feature's trigger scenario being BYPASSED by teach-first, not a regression — the no-teach Saltmarsh
round (Round 4) fired it perfectly (0→17). The feature is scoped to a NEW, untaught supplier's first batch.

**Verdict: strong YES, zero wrong-company misfiles across 215 filed docs; every bad/degraded read HELD, not
filed.** Numbers: IMPORT cold **0/200** auto-file (all held, identity still right on ~172/200) → ~98/200 after
graduating a few suppliers; **IMPORT2 warm 98/200 (49%)** untouched; SCANNED 5/10; SCANNED_HARD 4/10 (all
correct, the 3 bad reads — "Pelican Oiites", blank Ironclad, ref-less Veltrix — HELD); DOC SOL 0/22 (17
correctly typed). Final: 215 filed (107 fully auto · 34 graduated-sweep · 74 hand-confirmed), 236 in Review.

### Chris's report (verbatim)

**TL;DR:** set up from scratch, taught 10 suppliers, threw a 200-doc batch, a second 200-doc batch, degraded
scans, and oddball worksheets at it. Across 215 filed docs, **not one landed under the wrong company, and
every garbled/degraded read was held, not filed silently.** Costly friction: the first big batch filed
nothing itself (0/200) until a few of each supplier were confirmed — then it caught fire (batch 2 filed
98/200 untouched). One table-layout supplier (Pelican) piled up 41 unread docs because typing the fix
doesn't teach the app where to look next time.

**The numbers (measured):** IMPORT cold 0/200 (0%); after File-All + ~20 confirms ~98/200; IMPORT2 warm
98/200 (49%); SCANNED 5/10 (identity 9/10); SCANNED_HARD 4/10 all correct; DOC SOL 0/22 (17 typed "Service
Worksheet"). Final tally 215 filed / 236 in Review: 107 fully automatic, 34 swept on graduation, 74 hand.
5 "easy" suppliers (Oakhaven/Nordwind/Harrowgate ~43 each, Veltrix 42, Castellan 36) near hands-off; 5
"hard/odd" (Pelican, Meadowvale, Quillstone, Ironclad, Silverbeck) stuck at 1 each. The "confirm one,
siblings follow" helper did NOT offer 20 siblings on the FIRST confirm; the sweep arrived at "a few confirms."

**Safety watch — CLEAN:** 206/206 filed docs matched their true sender (machine-checked); no silent wrong
values (two "$"-bearing refs like `VXS$33215` are genuinely printed); degraded scans never misfiled (Pelican
"Oiites", blank Ironclad, ref-less Veltrix all HELD); no Unknown Year/Month folders. Only off-note: 3
Castellan worksheets Chris himself bulk-confirmed with no sender landed in an honest "Unknown-Company" bucket
(warned each time).

**Warnings truth-table:** Delete one ✅ · Delete All Review ✅ · Empty Bin (original scan verified still on
disk after) ✅ · File All Ready ✅ · Reprocess all ✅ · Split 1-page ("nothing to split") ✅. Every
destructive warning told the truth.

**Verifies:** FIXED/BETTER — auto-file bar now defaults 90 (was 100, filed nothing); activity strip shows
"✓ 98 filed automatically" receipts. STILL PRESENT — Terms "WORKING DRAFT … NOT YET IN FORCE" + [SOLICITOR:].

**Finding cards (ranked):**
- **Card 1 (MOD-HIGH) — typing a fix files THIS doc but silently doesn't teach the next 40.** Pelican's
  fields sit in a table → app read nothing; Chris TYPED the values + filed; the next 41 Pelican docs came in
  blank again (typing teaches identity, not field POSITION — only drawing a box does). Nudge: "Filed. To read
  this on future documents from this sender too, draw a box (⊕) — typing fixes only this one."
- **Card 2 (MOD) — buyer-issued PO shows MY company at the top; no steer.** A Quillstone PO on Bramblewood
  (buyer) letterhead → sender left blank, 3/20 auto-attached to Bramblewood. Offer: "This looks like an order
  you sent — file it under the supplier, Quillstone?"
- **Card 3 (MOD) — first big batch filed nothing by itself (0/200); everything waited.** Expectation gap
  (batch 2 then filed 98/200). Set the expectation after the first File-All (not more-aggressive filing).
- **Card 4 (MOD) — can Confirm & File with no sender → docs scatter into "Unknown-Company".** 3 plainly-
  Castellan docs landed alone. Offer "These look like Castellan — file them there?" (keep the warning).
- **Card 5 (LOW) — "Add 'Quotation'" opens a form with the name blank** (should pre-fill "Quotation").
- **Card 6 (LOW) — practice run leaked a stale hint** ("Read 'INV-1042'…") onto the next sample. Clear per-
  field hint on advance. (Practice-run only.)
- **Card 7 (LOW/trust, VERIFY still-present) — draft Terms "NOT YET IN FORCE" + [SOLICITOR:] notes** at the
  acceptance gate. Owner's legal domain.

**What worked:** the honesty of the destructive warnings (Empty Bin's "original scans not touched" verifiably
true), zero wrong-company misfiles across 215 docs, every bad OCR read held not filed. **Top friction:** the
Pelican hard-layout pile-up (Card 1). **Two-week verdict: Yes — would keep + pay.** Wants the draw-a-box
nudge, a PO steer, and finished Terms. **Humility:** single simulated persona, not a user test; his fiddly
coordinate-drawing made him TYPE several teaches a human would DRAW — Card 1 is "the app allows a shortcut
that doesn't scale," not "can't be taught"; the Unknown-Company scatter was his own bulk-confirm; couldn't
test the approval Mailbox end-to-end (needs a second user/PC). Caught + corrected the wizard's real-folder
default before any filing.
