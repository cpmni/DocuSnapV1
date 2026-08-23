# Chris The Customer — Full Vet, 2026-08-23 NIGHT (autonomous overnight round)

**Sandbox conditions:** fresh install (create-admin first-run), mig 87, 1330 Demo Docs, CDP 9223, **135
feature switches ON (all bar `deskew_on_import`)** — the fullest behaviour, including this session's new
work (put-back re-file, the two-line activity strip, the corroboration recorder fix, the logo-veto
immunity). Run under the owner's standing safety contract (sandbox-only, no code changes by Chris, findings
queue for the owner). Extra focus this round: put-back → File All re-file, the activity strip + its
close/receipt, and whether clearly-corroborated held docs auto-file.

> Report is VERBATIM below. Chris's transcript came back empty (known); this is the sole copy.

---

## Walkthrough (what I did)
I came in cold on the "Create the administrator account" screen and went right through: made my admin
account and saved the recovery code (step2_recovery.png), accepted the Terms (step3_terms.png), walked the
7-step first-run wizard setting my output folder (step4–step7), took the 6-card welcome tour (step8–step9),
and did the full sandboxed **practice run** — import → check → draw-a-box teach → confirm → filing summary
(step10–step14). It was genuinely the clearest onboarding I've met.

Then real work: I imported a batch of 12 Copperfield Electrical invoices (step18), confirmed several, watched
the sender graduate to "✓ files by itself", and tested the **put-back → File All Ready** loop in depth
(step19–step24). I filed all 12, checked they landed on disk in Company/Year/Month with the right names, then
imported 8 more of the same sender and watched 7 **auto-file themselves** (step25). I taught a missing date
by drawing a box (step26–step28), searched for filed invoices and opened one (step29–step31), sent it to a
colleague for approval and approved it in the Mailbox (step32–step33), and finally pressed every scary button
on a fresh 10-doc mixed batch: per-doc Delete + Restore, Split PDF, Delete All Review, Restore all, Reprocess
(step34–step38). Everything happened inside the sandbox. I left it usable (10 docs in Review, 21 filed).

## Finding cards (ranked by customer harm)

### 1. The Terms I must accept say "NOT YET IN FORCE" and contain editor notes
- Citation (verbatim, step3_terms.png): "WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE… This entire banner MUST be removed once the document is finalised for release." and inline "[SOLICITOR: confirm the enforceable contracting-party identity…]"
- User-moment: first thing I'm asked to legally agree to before I can use the app I paid for.
- Observed: forced to tick "I have read and accept the Terms of Use" on a document that openly says it isn't in force and still has the author's notes-to-self in it. I'd hesitate and wonder if the whole product is half-finished.
- Harm: trust-eroded — worst possible first impression. **High.** Class: QUESTION (can't weaken a legal gate; reporting the *content* scared me).
- Proposed: ship the finalised/solicitor-reviewed text, or at minimum strip the "[SOLICITOR:]" markers and the "WORKING DRAFT / MUST be removed" banner from the customer-facing copy.

### 2. First batch: 12 perfectly-read invoices, every single one held for the same reason
- Citation (step18): "Needs a quick check — 1 field was read with low confidence, and 1 field was flagged by a formatting check." + "The letterhead reads 'Copperfield Electrical' — filled in for you, but please confirm it's the sender, not the customer, before filing."
- Observed: all 12 read issuer/number/date correctly and identically, yet all 12 held solely to confirm the sender. Nothing actually wrong. Feels like the app doesn't trust its own correct reading.
- Harm: slowed / warning-fatigue — every new supplier's first batch is all-hold. **Medium-high.** Class: CONFUSION.
- Proposed: after I confirm the sender on the first 1–2 of an identical-layout batch, stop re-asking on the visibly-identical siblings in that same batch.
- Note: graduation *does* rescue this — after ~5 confirms the rest filed themselves; the pain is only the first batch per supplier.

### 3. One invoice stayed stuck while its 6 identical twins filed themselves
- Citation (step21): "6 documents from Copperfield Electrical filed themselves — they matched what you've confirmed." — meanwhile the last identical invoice still showed "Needs a quick check" at 63%.
- Observed: one invoice — identical to the 6 that just auto-filed — was left stuck. It only cleared to 100% when I happened to press **Reprocess** on it. A normal person would think that one doc was broken.
- Harm: slowed / trust-eroded. **Medium.** Class: CONFUSION.
- Proposed: when a sender graduates, include the document currently open on screen in the same auto-re-read sweep as its siblings, so it isn't orphaned.

### 4. The summary promises two problems, but I can only find one
- Citation (step18): header "1 field was read with low confidence, and 1 field was flagged by a formatting check", chips "Low confidence · 1" and "Format check · 1".
- Observed: only one field (Document Issuer, 69%) is marked — date and number are green "High". So I hunt for the second, "formatting-check" problem and there's nothing there. Two counters, one actual field, and that field shows the right value.
- Harm: trust-eroded / cosmetic — cried-wolf counting. **Medium-low.** Class: QUESTION.
- Proposed: if both concerns are about the same field, say so once ("The issuer needs a quick confirm"), not two separate problems.

### 5. It sometimes can't see a value that's plainly printed on the page
- Citation: Copperfield invoice_16 — "INVOICE DATE … Not found" while the page shows "Invoice Date 03/11/2026" (step25); Veltrix — "DOCUMENT ISSUER … Not found" with "Veltrix Automotive Parts" plainly in the orange header (step36).
- Observed: the missed value is right there — a date on a slightly crooked scan, a company name inside a coloured letterhead banner. "It's *right there*, why can't you read it?"
- Harm: slowed — a couple of docs per batch need manual help. **Medium-low.** Class: QUESTION.
- Proposed: keep improving reads on coloured/banner letterheads and skewed scans — but the app's *handling* of the miss is excellent.

### 6. "Anchor" is a word I wouldn't say out loud
- Citation (step28): "Anchor (label to the left): Invoice Date — 03-11-2026" and the "Draw the anchor" button.
- Observed: the rest of that bar is plain, but "Anchor" / "Draw the anchor" is jargon — I don't know what an anchor is in my filing world.
- Harm: cosmetic. **Low.** Class: PREFERENCE.
- Proposed: "The label next to it: Invoice Date" / "Point out the label" instead of "anchor".

## Warnings truth-table
| Button | Warning said | Actually happened | Verdict |
|---|---|---|---|
| Per-doc Delete | goes to recycle bin, restore from Search | 10→9, restored fine | Truthful |
| Delete All Review | all→recycle bin, disk kept, confirmed/deferred untouched | 10→0, disk kept, nothing else touched | Truthful |
| Restore all | back to where deleted from | all 10 returned to Review | Truthful |
| File All Ready (with put-backs) | "Includes 6 you put back… will be filed again (undo from strip). 1 flagged — waiting" | filed exactly 6, kept the 1, left undo chip | **Truthful (exemplary)** |
| File All Ready (nothing ready) | chip "Nothing filed — 1 kept back" + toast | filed nothing, honest receipt | Truthful |
| Split PDF | "only one page — nothing to split" | did nothing (single-page) | Truthful |
| Stop (mid File-All) | "Stop is not an undo" | accurate | Truthful |
| Reprocess (per-doc) | (no warning; non-destructive) | 63%→100%, made fileable | fine |
| Approve (workflow) | two-press confirm | completed, cleared Inbox | Truthful / good |
| Empty bin | (not tested — permanent) | — | Untested |

## What genuinely worked well
Practice run (best thing in the product); the **put-back → File All Ready loop** (blue "↩ will re-file" chip,
dialog names them, one-click re-file + honest bulk receipt — the extra-focus item, excellent); the **activity
strip** (two-line chips clear, panel has a ✕ *and* closes on click-away, 0-filed still leaves "Nothing filed —
N kept back"); held-doc messaging when it's a real problem (unknown-type + missing-date holds explain
themselves + one-click fix); the draw-a-box teach; safety everywhere (reversible, honest warnings, originals
kept); filing on disk (Company/Year/Month, tidy names + metadata).

## Top friction
The **first batch of any new supplier is all-hold** — a dozen perfectly-read invoices still made me confirm
the sender one by one. Resolves after a few confirms (then the sender files itself), but the front-loaded
"check all these correct documents" is the day-one frustration.

## Two-week verdict
**Yes — I'd still be using it.** Once a supplier is taught/confirmed a handful of times it files the rest by
itself, correctly, reversibly. Friction is all up front; safety/transparency is the best I've seen. The one
thing that would make me pause before recommending to my boss is the Terms screen reading "NOT YET IN FORCE".

## Humility block
One simulated persona, driven by automation (some clicks synthesised). Initially misjudged Approve as dead —
it's a deliberate two-press confirm (caught per the round-5 lesson). Couldn't test approval across two real
users; did not test "Empty bin" (permanent). Demo files are synthetic single-page scans, so Split on
multi-page and real scan quality weren't exercised; the reading misses may be sample-specific. Nothing here is
a change — all for the owner to vet.

---

## Round 2 — focused re-verify (same night, after fixes #6 + #3 landed)

Fresh sandbox (users reset, docs re-seeded, 135 switches on), new admin, imported 12 Copperfield + 8 more.

- **FIX A (#6, "anchor" jargon) → FIXED.** ⊕ readout button now "✎ Point out the label"; no "Anchor"/"Draw
  the anchor" anywhere. (He saw the *no-label-found* fallback variant on these scans; the label-detected
  "✓ The label to the left:" copy is in the build — a sample auto-detect limitation, not a copy defect.)
- **FIX B (#3, orphaned doc) → FIXED.** Held panel now reads: *"…Other documents from this sender now file
  themselves — this one was read before that. Press Reprocess… to re-read it, and it should file too."* — the
  old "lower the auto-file bar" advice is gone. Reprocess lifted the genuine 63% orphan (invoice_01) to 100%
  "Ready to file." End-to-end confirmed.

**New from the re-verify (2 flagged, 1 fixed):**
- **Card 2 (FIXED same night, `81719c1`):** the #3 hint said "Press Reprocess **(in the tools rail)**" — wrong
  location. The labelled Reprocess buttons are in the RIGHT panel under "This document"; the left rail's ⟳ is
  tooltip'd "Check what's ready to file", not "Reprocess". Repointed to "(below, under 'This document')".
- **Card 1 (FLAG — OCR arc):** an invoice whose date plainly prints "03/11/2026" reads "Invoice Date · Not
  found", and **Reprocess cannot recover it** (same pixels), while 7 identical siblings auto-filed. The
  orphan-nudge correctly does NOT show here (it's a missing-required hold, not below-floor-graduated). This is
  the OCR read arc (the leading-digit-date / banner-read class, 007/oscar) — same family as round-1 #5.
- **Card 3 (FLAG — teach/OCR):** teaching a date by drawing a box clipped "03/" → committed "11/2026" →
  "Not a valid date", with no warning that the box may have missed part of the number. The pad-window /
  clipped-box class + a "warn on an invalid taught value" gap.

**Round-2 verdict:** both fixes confirmed; would keep using it. Remaining snag is the unread date (OCR arc).

