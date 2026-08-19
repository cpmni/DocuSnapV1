# Chris The Customer — full app review, 2026-08-19

## ROUND 10 — the human-licensed class correction (P1/PI)

**Sandbox conditions.** Fresh install, CDP 9223, own userData + Output, 0 users (genuine
create-first-administrator flow). Corpus: copies of `Desktop\Demo Docs\Other` — SINGLE (10) +
IMPORT (200) + IMPORT2 (200) = 410 documents. All ten senders taught via TYPED-LOCATE per
`TEACH_ORDER.md`, exactly as rounds 7–9.

**Nine switches ON before wave 1:** `ref_class_fix_enabled` (NEW, migration 74) ·
`ref_prefix_confusable_adopt` · `raw_witness_vacuous_suppress` · `filing_sanity_page_match_v2` ·
`scope_sweep_enabled` · `confirm_persist_values` · `format_corrections_dedupe` ·
`vat_reg_symbol_confusable` · `money_sign_capture`.

**Acceptance gate (Oracle, unchanged): PASSED.** 356 documents filed, zero wrong folder, zero wrong
value across 14 pages read by eye, zero filename mismatches.

**The number this build was trying to move: 15 → 4.** Round 9 needed fifteen typed corrections for
Pelican alone; round 10 needed five across all 410 documents, one of which existed only because he
deliberately tested Undo and redid it.

**Report follows VERBATIM.**

---

# CHRIS THE CUSTOMER — ROUND 10
**Fresh install · 410 documents · 19 Aug 2026 · sandbox only**

## TL;DR (three lines)
1. **The class fix is the best thing you've built.** One typed correction fixed six other invoices, told me exactly which, let me undo it, and never touched the lookalike-but-different ones. My typing dropped from **fifteen corrections to five**.
2. **Nothing was misfiled. Again.** 356 documents filed — 0 wrong folder, 0 wrong value in 14 pages I read by eye, 0 filename mismatches. All four scary warnings told the exact truth.
3. **The Approve button in the approval mailbox does nothing.** Reject works. Approve is dead — that's the whole point of an approval workflow.

---

## THE WALKTHROUGH

**First contact** (step01–step18). Account → recovery code → Terms → 7-step setup → 6-card tour → practice run. The recovery-code screen wouldn't let me past without ticking; the folder step told me *"Your original scans are never deleted — they're just moved into a 'Processed' folder"* and that turned out to be literally true. The **practice run is excellent** (step13–18): three sample documents, one deliberately misread (`INV-1O42` for `INV-1042`), I dragged a box round the number and got *"Nicely done — the reference now reads from the box you drew"*, and it ended with a list of exactly where each file went. Best onboarding I've seen from this app.

**Teaching ten documents** (step21–24). Typed-locate throughout. The wizard found the printed label for me every time (`JOB SHEET NO`, `Order Ref`, `Despatch Ref`…), and when a value appeared twice it asked which spot I meant. One snag — see card 4.

**Wave 1 — 200 documents.** **Zero filed themselves.** Every sender read 93–94% against a 90% bar, but a new sender needs three confirms before it's trusted, and the teach doesn't count as one. The Review screen was honest about it (step32): *"this is only the second document from Castellan Security Systems… Confirm 2 more and the rest from this sender can start filing themselves. 1 of 3 confirmed from this sender."*

**The headline** (step26–31). Pelican invoice 0014: page prints **PI/26/3318**, app read **P1/26/3318**, and it said so plainly. I typed the correction and confirmed. Then:

> *"Also corrected **P1** to **PI** on **6** other documents waiting from this sender. 5 now read cleanly. 1 still needs a look — their pages could not be re-checked, so they stay in Review."* · Show what changed · Undo

I verified every claim rather than believing it:
- **Show what changed** listed all six by name: `Pelican-Office_invoice_0020.pdf — P1/25/6157 → PI/25/6157`, and so on.
- Opened two of them: both really changed, both showed a calm green **"✓ corrected by an earlier fix — was 'P1/26/1792'"** chip, **no red flag**.
- All six **still in Review**. Nothing filed.
- **The two `PL/` invoices were untouched.** ✓
- **Undo** put all six back to `P1/` and cleared the bar. Redo worked identically.
- Later a second correction on a `PL/` invoice fixed its one sibling — and left the **`P1L/26/3152`** invoice (two characters wrong) completely alone. **The control passed.** I had to type that one myself.

**Does it ask first?** No. It acts, then tells you, with Undo. On a fresh install that's exactly right.

**Reprocess survival.** Re-read all 195. Every corrected value held — not one reverted. Better: their scores *rose* (74–93 → 82–100) and the reader started getting `PI/` on its own.

**File All Ready.** Prompt said *"File up to 146 of 195 documents… 49 flagged documents are not included."* It filed **exactly 146**. Promise and delivery matched to the document.

**Wave 2 — 200 documents.** **155 filed themselves (77.5%)**, seven senders at 20/20, banner keeping a running tally: *"✓ 155 documents filed automatically · 34 filed with your approval."* Silverbeck and Veltrix filed **nothing** — see card 3.

**Scary buttons.** All pressed. All honest — see the truth-table.

---

## NEW FINDINGS (7, ranked by harm)

### 1. The Approve button does nothing — Reject on the same panel works
- **Citation (verbatim):** Mailbox → *"Sent to you by chris — they'd like your approval"* · buttons **Approve** · **Reject** · **Forward…**
- **User-moment:** A colleague sends me a sales order to approve. I click Approve.
- **Observed confusion:** Nothing happens. No message, no tick, the item stays marked `pending`, and it's still in my Inbox tomorrow. I clicked it four times across two different documents. **Reject** with a note on the same panel worked first time and moved the item straight out. So the panel isn't dead — only Approve is.
- **Harm + severity:** **Blocked.** The one thing an approval mailbox exists for.
- **Class:** CONFUSION
- **Proposed alternative:** Make Approve do what Reject does. Until then, if approval can't complete for a reason (needing a claim first, say), say so on the button rather than swallowing the click.
- **What I may be missing:** Perhaps approving your own document is deliberately blocked. If so it must SAY that — silence reads as broken.

### 2. "Never seen this sender before" — on the fortieth document from that sender
- **Citation (verbatim):** *"Never seen this sender before. The top of the page reads 'Nordwind Refrigeration Ltd' — please confirm"*
- **User-moment:** Working the last few stragglers after 356 documents filed.
- **Observed confusion:** I had already filed **39 Nordwind quotes**. The page is an ordinary Nordwind quotation (step render `top101`) — right company name, right heading, Quotation Ref **NRQ-2551** printed plainly. The app read **nothing**: no sender, no quote number, 31%. Three documents in the round did this (two Nordwind, one Veltrix). The sentence is simply not true, and it's the most alarming line in the app.
- **Harm + severity:** **Trust-eroded**, and it's the worst read of the round.
- **Class:** CONFUSION
- **Proposed alternative:** *"I couldn't recognise this page as one of Nordwind Refrigeration Ltd's usual layouts — the top of the page reads 'Nordwind Refrigeration Ltd'. Is that right?"* Never claim you've never seen a sender you've filed 39 of.
- **What I may be missing:** The logo does sit in a different corner on this one, so the layout may genuinely be new to it. That's still not "never seen this sender".

### 3. One note is holding 52 of my remaining 90 documents
- **Citation (verbatim):** *"Company inferred from previously filed documents on this layout — please confirm before filing."* (and its singular twin, *"…from one previously filed document…"*)
- **User-moment:** Wondering why Silverbeck and Veltrix filed 0 of 20 in wave 2 while seven other senders filed 20 of 20.
- **Observed confusion:** Those two senders never collected their three confirms in wave 1, because **this note held all 20** — and then it held all 20 of wave 2 as well. One note cost me **39 documents in wave 2 alone**, and 52 of the 90 documents still queued carried it. It's recoverable — confirm two, press Reprocess, and the note clears — but nothing on screen told me that was the move.
- **Harm + severity:** **Slowed**, badly. The single biggest cost in my queue.
- **Class:** CONFUSION
- **Proposed alternative:** Once a sender shows **"✓ files by itself"**, stop asking. And when the note is holding a whole sender, offer the fix in place: *"Confirm 2 of these and I can re-check the other 36 for you."*
- **What I may be missing:** The note is honest on document #2. It's document #40 where it stops earning its place.

### 4. Typing a money amount without its "£" gets you a screen whose default freezes that amount forever
- **Citation (verbatim):** *"That isn't printed on this page — Balance Due — No matching text found. I can still save it — it will be filled in as typed on every document of this type."* Buttons: **Save it as typed →** (blue, primary) · Edit the value · Draw it instead
- **User-moment:** Teaching Ironclad's statement. The page says `Balance Due  £4,142.35`. I typed `4,142.35` — exactly the digits.
- **Observed confusion:** It told me the value isn't on the page. It *is* on the page, in 12-point bold, and I could see it in the preview beside the message. I only got past it by guessing the pound sign was the problem — adding `£` found it instantly. A tired user takes the blue button instead, and then **every future Ironclad statement is stamped £4,142.35** — a balance that changes every month.
- **Harm + severity:** **Trust-eroded now, wrong data later.** The one place in this app where the obvious click plants a lasting error.
- **Class:** CONFUSION
- **Proposed alternative:** Match the number regardless of the currency symbol. Failing that, don't make "Save it as typed" the blue button on a money field — and warn in the same breath: *"This value will be stamped on every Statement from Ironclad, even when the amount changes. Balances usually change — try drawing a box instead."*
- **What I may be missing:** Perhaps typing is meant for genuinely fixed values only. Then the wizard should say which fields those are before I start typing.

### 5. Sweep offers go stale — the button says "File 18" when the answer is 0
- **Citation (verbatim):** *"18 Castellan Security Systems Service Worksheet documents already read cleanly and now pass every check — nothing was re-read."* · **✓ File 18**
- **User-moment:** Coming back to a banner that had been sitting there while I worked elsewhere.
- **Observed confusion:** All 18 had been filed long before. I pressed it anyway. It filed **0** and explained itself beautifully — *"✓ Filed 0 from Castellan Security Systems — checked against the documents you just confirmed"* then *"kept back — it was handled in the meantime"* for each of the 18 by name. Same thing again with a Veltrix "File 15". So the **delivery is faultless and safe**; it's the **number on the button** that's out of date by the time you read it.
- **Harm + severity:** **Trust-eroded** (cosmetic in outcome). After twice being told 18 and getting 0, I stopped believing the counts.
- **Class:** CONFUSION
- **Proposed alternative:** Re-count the offer when the queue changes, or drop the offer entirely once it can no longer be satisfied.
- **What I may be missing:** Re-counting constantly may be expensive. Then just say *"up to 18"*, as the File All Ready dialog already does — that one was believable precisely because it hedged and then hit the number exactly.

### 6. A value the app corrected itself, which IS on the page, still gets flagged
- **Citation (verbatim):** *"'PI/26/9910' doesn't appear on this page as written — please check the reference before filing."*
- **User-moment:** Working through the five Pelican invoices left after wave 2.
- **Observed confusion:** The page prints `PI/26/9910` in the Invoice Number box (I rendered it and read it). The app's own value is `PI/26/9910`, and its record shows it *corrected* it to get there. Then it warned me the value isn't on the page. It fixed it and then complained about its own fix — and that flag kept the document out of the automatic filing.
- **Harm + severity:** **Slowed** + **warning fatigue**. Flags that cry wolf on correct values are how flags stop meaning anything.
- **Class:** QUESTION — why did it warn about a value it had just repaired?
- **Proposed alternative:** Re-run the "is it on the page" check *after* a repair, not before.
- **What I may be missing:** Maybe the check reads a different part of the page than my eye does. Either way, the sentence as shown is false.

### 7. The notice stack eats the document list, and two counters disagree with the app itself
- **Citation (verbatim):** Review, four stacked notices at once; Search header *"CONFIRMED 200"*; Home *"7 suppliers have qualified for automatic filing"*
- **User-moment:** Trying to pick the next document to work on.
- **Observed confusion:** Four notices took roughly a third of the left column (step38, step43), leaving me two visible rows of a 52-document list; there's no way to collapse them together. Separately: Search's browse view is headed **CONFIRMED 200** when **356** are filed — I'd conclude a March invoice was missing (searching for it by reference *does* find it instantly, so it's the header that misleads). And Home says **7 suppliers have qualified** while the Review screen shows **"✓ files by itself"** on every sender and all ten have well past three confirms.
- **Harm + severity:** **Slowed** + **trust-eroded**.
- **Class:** PREFERENCE (layout) / CONFUSION (the counts)
- **Proposed alternative:** Cap the stack at two notices with a "2 more" expander; head the browse list *"Showing 200 of 356 filed"*; make Home's supplier count read from the same place the Review headers do.
- **What I may be missing:** The 200 may be a deliberate page size; it just needs to say so.

---

## PREVIOUSLY-REPORTED ITEMS — one-line verdicts

| Round 9 card | Verdict |
|---|---|
| File All Ready announces "up to N" then files 0, silently | **FIXED** — promised "up to 146 of 195", filed exactly 146 |
| 100% default files nothing out of the box | **FIXED** — default is now 90%; wave 2 filed 155/200 untouched |
| 15 Pelican `P1/`/`PL/` corrections needed | **FIXED** — 5 typed corrections for the whole 410-document round |
| Home says "1 supplier has qualified" while ten file themselves | **BETTER BUT** — now says 7; still not 10 |
| "Never seen this sender before" after 39 filed | **NOT FIXED** — card 2 |
| Stale "Company inferred…" note holding documents | **NOT FIXED** — card 3, now the biggest single cost |
| Recycle-bin round-4/5 fixes (empty deletes PDFs, restore page-intact) | **STILL GOOD** — verified both |
| Green "Ready to file" chip on documents that never file | **FIXED** — now a blue box giving the actual numbers |
| Untick mismatch on a multi-item sweep | **Could not reproduce** — everything filed was filed correctly |

---

## WARNINGS TRUTH-TABLE

| What it said | What it did | Verdict |
|---|---|---|
| *"File up to 146 of 195… 49 flagged documents are not included"* | Filed exactly 146; 49 stayed | **TRUE** |
| *"Delete ALL 54… They go to the app's recycle bin — you can restore them any time. Files on disk are kept. Confirmed and deferred documents are NOT affected."* | 54 to bin, all files present, all 356 filed untouched, all restored later | **TRUE, all four clauses** |
| *"Permanently delete all 2 documents in the recycle bin, including their PDF files? This cannot be undone."* | Both PDFs really gone from disk; filed documents untouched | **TRUE** |
| *"Send … back to Review? This just moves it to your Review list — nothing is deleted."* | Moved back, nothing lost, wrongly-named copy cleaned up too | **TRUE** |
| *"Re-read all 195 documents… Values may replace what's shown now. Documents you've already confirmed and filed are not touched."* | Re-read 195; my corrections survived; filed documents untouched | **TRUE** |
| *"Restore all 54 documents… They go back to where they were deleted from"* | All 54 back in Review, pages intact | **TRUE** |
| *"'PI/26/9910' doesn't appear on this page as written"* | It does appear, verbatim | **FALSE** (card 6) |
| *"Never seen this sender before"* | 39 of that sender already filed | **FALSE** (card 2) |
| *"That isn't printed on this page — No matching text found"* (£4,142.35) | It is printed on the page | **FALSE** (card 4) |
| *"18 … documents already read cleanly and now pass every check"* | 0 were available | **STALE** (card 5) |

---

## THE NUMBER YOU ASKED FOR

**Five.** Five typed corrections across the whole round, all of them Pelican invoice numbers, on 410 documents. Round 9 needed **fifteen for Pelican alone**. One of my five was only there because I deliberately pressed Undo and redid it — so the honest working figure is **four**. Two of those four cleaned up nine bad references between them; the other two were genuine one-offs the fix rightly refused to generalise.

## WHAT GENUINELY WORKED
The **"Show what changed" list**. Six lines, each one `filename — old → new`, plus an Undo sitting next to it. I have never trusted an automatic change in this app before, because I could never check it. This time I could, in four seconds, and when I pressed Undo it really did put all six back. That is what "the app shows its work" should look like everywhere.

Close second: the cold-start message — *"this is only the second document from Castellan Security Systems… Confirm 2 more and the rest from this sender can start filing themselves. 1 of 3 confirmed."* It told me why it was holding and exactly what to do about it. That's a competent junior explaining themselves.

## TOP FRICTION
The **"Company inferred… please confirm before filing"** note. It quietly cost me two entire suppliers — 39 documents in wave 2 that were read perfectly and filed nothing — and there was no sign on screen that confirming two and pressing Reprocess would set them free. I only found it by poking. A first batch of 200 shouldn't have a trapdoor in it.

## THE TWO-WEEK VERDICT
**Yes — and this is the first round where I'd say that without a "but".** It filed 356 documents for me, put every single one in the right folder with the right number, and I typed into four fields all night. It corrected six invoices off one keystroke, showed me exactly what it had done, and put them all back when I asked. It told the truth on every scary button I pressed. The Approve button being dead is embarrassing but it's one button in a corner I'd rarely visit; the "Company inferred" nag is the thing that would actually annoy me weekly. Fix those two and I'd stop watching it so closely — which, for a filing clerk, is the whole point.

---

**What I may be missing, overall:** I am one simulated office manager on a synthetic corpus of ten senders, driving the app with a script rather than a mouse. My scripted clicks left four native dialogs stacked up at one point, which is my doing, not the app's — I checked, and every one of those confirms had actually been honoured. And I filed one document with a wrong reference myself by clicking Confirm past a warning that told me plainly the value wasn't on the page; I repaired it with Learning Repair afterwards. That one is on me, not on Scan Finder — but it does show the "doesn't appear on this page" warning is advisory only, with nothing standing between a hurried user and a wrong reference in the filing cabinet.
