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


---

# CHRIS THE CUSTOMER — ROUND 11 (2026-08-21)

**Sandbox conditions:** fresh install (0 users → create-admin), CDP 9223, isolated userData, copied
Demo Docs corpus. New-install defaults (mig 70, auto-file bar 90, reading switches ON) PLUS the new
fixes enabled: `ref_class_fix_enabled`, `hint_band_ws_normalize` (E), `template_identity_geom_fragment_shed`
(D), `template_date_invalid_yield` (Z). Run driven by the general-purpose Chris persona (the
`chris-the-customer` subagent type is not spawnable in this environment). Screenshots step01–step21 in
the session scratchpad `chris-driver/`. Report is VERBATIM.

---

**TL;DR (3 lines):** The app I've now spent a proper session with never once lost a document or filed one in the wrong place — 32 filed, zero misfiles, everything I deleted came straight back. But out of the box it holds *everything* and makes me name the company on all 200 documents one at a time, the "do all 20 at once" button quietly undoes my work, and "File up to 30" filed nothing. Three of the four fixes I was asked to check are genuinely landed (the money one is lovely); the sender-recognition promise still isn't kept until you formally teach.

I'm one made-up office manager driven by a script over one sitting on tidy PDFs — not a real fortnight and not a room full of users. Read it that way.

## Walkthrough (with screenshots)

- **step01–step06** — Made the admin account, saved the recovery code (Continue stays greyed until I tick "I have saved this code" — good), accepted Terms, walked the 6-step setup and set my output folder. First contact is calm and plain-English.
- **step07** — The 6-card tour. Genuinely well written; "One document type, many layouts" pre-empts the exact question I'd have asked ("do I make a folder per supplier?").
- **step08** — Home/Import. Clean. "Local only" badge bottom-left is reassuring.
- **step09–step10** — Imported my first 200 (wave 1). Opened Review: **210 documents · 201 need a look.** Every sales order said *"Couldn't confirm who issued this page — the top of the page reads 'Veltrix Automotive Parts'."* I clicked **Use "Veltrix Automotive Parts"** and it offered **"Apply … to 20 & re-read."**
- **step11–step13** — Taught a Pelican invoice through the wizard: draw a box → it reads it back → "Looks right?". Clear, calm, honest.
- **step14–step15** — After teaching, Pelican docs now say **"Layout available: Pelican Office Interiors"** and, once reprocessed, **"Its logo and wording"** with the issuer auto-filled at **95%**. This is the app finally recognising a sender.
- **step16–step18** — Added a "Balance Due" money field and tested typing an amount (card #4).
- **step19** — Ran **File All Ready**.
- **step20** — Search + recycle bin.
- **step21** — Second batch imported; banner "**18 documents filed automatically**".

## Round-10 cards — re-verify

- **#2 "Never seen this sender before"** → **BETTER, BUT.** The *issuer note* is fixed — it now reads *"Couldn't confirm who issued this page — the top of the page reads 'Veltrix Automotive Parts'. Please confirm the correct company (check it's the sender, not the customer)."* (step09). The old blaming line is gone. **However**, a separate little chip, **"Recognised by: Not seen before,"** still shows on document 14 *after I'd filed 13 from the exact same company* (step14). So one place stopped crying "never seen"; another place still does.
- **#3 "Company inferred… please confirm"** → **FIXED in the wording; couldn't make it appear live.** The note now spells out the recovery: *"Confirming a few documents from 'X' helps Scan Finder recognise it and stop asking. Use 'Reprocess X'…"* On my clean PDFs the recognised layout read the company cleanly at 95%, so it never needed to "infer" — the trapdoor didn't open for me. On a rougher scan it would. I'll call the copy fixed and the silent-trapdoor unproven-either-way.
- **#4 £-less money teach** → **FIXED, and nicely (step18).** I typed `2102.40` for the Balance Due field. It answered: *"This looks like a value that changes on each document… Freezing '2102.40' would fill it on every document of this type — but an amount or date usually changes each time. Draw where it sits so each document is read,"* with **"Draw where it sits →" as the primary button** and "Freeze it as typed anyway" demoted. No more "isn't printed / frozen forever." Exactly right.
- **Drawn date** → **BETTER, BUT.** I drew a box a bit too big and caught the word "Date." It read *"Wate 05-01-2026"* and **warned** *"That doesn't read like a date… redraw it — or type."* Good that it warned instead of silently filing junk — but the date "05-01-2026" is *right there* in what it read, and it kept the messy line rather than lifting the obvious date out. A tight box reads clean.

## New finding cards (ranked by harm)

**1 — "Apply to 20 & re-read" quietly undoes the thing I just fixed** · *trust-eroded / near data-loss* · CONFUSION
Citation (step10, Review): *"20 more unfiled documents look like the same sender. Apply "Veltrix Automotive Parts" to 20 & re-read."* Moment: I'd just set the company on one sales order and wanted the other 20 to follow. I clicked it; it said "Applying…", the offer vanished (looked like success) — and then **every one of the 20 still said "couldn't confirm," and the one I'd already fixed forgot it too.** I checked several documents by hand: all reverted. I ended up worse off than before I clicked. Proposed: if the re-read is going to wipe the company, don't offer to apply it — or make the applied company *stick* through the re-read. What I might be missing: maybe it's meant to only "pin a spot" and the born-digital layout still declines — but from my chair, I clicked a helpful blue button and it deleted my work.

**2 — "File up to 30" filed 0** · *trust-eroded* · CONFUSION
Citation (step19): dialog *"File up to 30 of 196 documents… Every document with its type and required fields filled in will be filed."* Result toast: *"Filed 0 of 30 documents — 22 still need a required field (Order Date, Sales Order Number, Invoice Date); 6 have no document type detected; 168 not ready to file."* Moment: I braced for 30 documents to move; none did, and I got a wall of numbers (30, 22, 6, 168) I can't add up. Proposed: count only what will *actually* file ("File 8 ready documents?"), and if it's 0, say "Nothing is ready to file yet" instead of promising 30. What I might be missing: the pre-count is an optimistic guess and the real gate is stricter — but a promise of 30 then 0 reads as broken.

**3 — Confirming a sender 13 times never makes it "recognised"** · *slowed / promise-not-kept* · QUESTION
Citation (tour): *"Scan Finder learns each new layout the first time it sees it, then recognises it from then on."* Reality: after I filed **13** identical-layout Veltrix documents, number 14 still said **"Not seen before"** and made me set the company again (step14). Only *teaching* (drawing boxes) creates recognition; confirming doesn't. Moment: I did the obvious thing — file a stack of the same invoice — and expected it to "click." It never did. Proposed: either let a few confirms establish the layout, or tell me plainly on the confirm screen: *"Filing these won't stop the asking — teach this layout once to do that."* What I might be missing: there may be good safety reasons confirms don't auto-establish a layout — but then the tour is over-promising.

**4 — Fresh install: nobody's company gets filled in** · *slowed, at scale* · CONFUSION
Citation: 200 imported, **every** document's Document Issuer held as empty with "Couldn't confirm who issued this page — the top of the page reads 'X'." The company name is printed at the top, the app *shows* it read it, and still won't put it in the box — I have to click "Use 'X'" on each. Moment: my first real batch and there are 200 identical little confirmations ahead of me. Proposed: when the letterhead clearly reads a company and there's nothing contradicting it, fill it in (still un-graduated, still reviewable) rather than leaving all 200 blank. What I might be missing: caution about buyer-issued documents where the top name isn't the sender — but blanking *every* document to guard the few is a heavy tax.

**5 — The sender I *taught* won't auto-file; the one I only *confirmed* does** · *confusing/slowed* · QUESTION
I taught Pelican a full template — it's recognised beautifully — yet its documents stay in Review (held by a formatting flag and, I gather, needing more confirms). Meanwhile Veltrix, which I never taught but confirmed ~13 times, auto-filed **18/20** of the next batch at 100%. Moment: I did the "proper" thing (teach) and got *less* automation than the lazy thing (confirm a lot). Proposed: after a teach, let a couple of clean confirms graduate that sender too, so teaching visibly pays off. What I might be missing: graduation is deliberately confirm-count based for safety — fair, but it makes teaching feel unrewarded.

**6 — A "$" slipped into a reference and got auto-filed into the filename** · *data-quality* · QUESTION
Two auto-filed Veltrix files are named `…VX$22033.pdf` and `…VXS$33215.pdf` — the "S" of the order number read as "$". Right company, right month, just a wrong character in the reference that then auto-filed at "100%". A pound-or-dollar sign inside a reference number is an obvious "that's not right" shape. Proposed: flag a currency symbol appearing inside a reference before auto-filing. What I might be missing: I bulk-confirmed the *company* and didn't eyeball each reference — a slower human might have caught these two.

**7 — P1 vs PI: primary guess is the wrong one (but it does own up)** · *cosmetic/slowed* · QUESTION
Citation (step15): on an invoice printed **PI/26/1792**, the app showed **P1/26/1792** as the answer and warned *"this could read 'P1/26/1792' or 'PI/26/1792' (1 and I look alike on a scan)… please check which is printed,"* with **Use "PI/26/1792"** / **Keep** buttons. Good that it flags and offers both — but its first pick was the wrong one, so I have to correct it. Proposed: when the layout is taught, lean toward the taught shape. What I might be missing: this is a genuinely hard OCR call, and offering both is honest.

**8 — I'm accepting Terms marked "NOT YET IN FORCE"** · *cosmetic/trust* · QUESTION
Citation (step03): the Terms I must accept literally contain *"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE"* and "[SOLICITOR:]" notes. A real buyer would pause at being asked to agree to a draft. (I understand this is pre-release.)

## Warnings truth-table (said vs did)

| Button | What it SAID | What it DID | Verdict |
|---|---|---|---|
| Delete (one doc) | "Delete '…0029.pdf'? It goes to the app's recycle bin — you can restore it from Search." | Moved to recycle bin; I restored it from Search; back in the queue. | **True** |
| Delete All Review | "Delete ALL 378… go to the recycle bin… Files on disk are kept. Confirmed and deferred documents are NOT affected." | 378 → recycle bin; 32 confirmed untouched; **Restore all** brought all 378 back. | **True** |
| File All Ready | "File up to **30** of 196…" | Filed **0**; long confusing toast. | **Misleading (over-promised)** |
| Reprocess (this doc) | (no scary warning; re-reads in place) | Re-read; filled issuer to 95%; document stayed in Review for me to check. | **True** |
| Apply "X" to 20 & re-read | "Sets the sender on those documents and re-reads them. They stay in Review." | Set nothing that stuck; reverted the one I'd set. | **False (silent no-op)** |
| Split (✂) | — | Present in the tool rail; I couldn't exercise it meaningfully — all my documents are single-page. | Untested |

## What genuinely worked

- **Onboarding, tour and copy** — plain, no jargon, reassuring ("Everything stays on this computer").
- **Filing one at a time is flawless** — every confirm landed as `Company/Year/Month/Type.Date.Ref.pdf` with a matching metadata file. **Zero misfiles all session** (32 filed, two company folders, both correct).
- **The teach wizard** — reads every box back to me and asks "Looks right?"; the finish screen honestly warns "the next few may still come through Review."
- **Recognition after teaching** — "Layout available", "Its logo and wording", company auto-filled at 95%.
- **Card #4 money fix** — the standout.
- **Delete / Delete-All / Restore-all** — truthful warnings, complete recovery, nothing lost.
- **Automation shows its work** — "18 documents filed automatically — click to see the list" (step21), each at 100%, with an × to pull one back.
- **Mature auto-file** — the one sender I confirmed enough auto-filed 90% of its next batch, all correct.
- **Search** — instant, correct.

## The comparison — first night vs now

| | Wave 1 (fresh install) | Wave 2 (after teaching 1 sender + confirming 1 sender ~13×) |
|---|---|---|
| Auto-filed | **0 / 200** | **18 / 200** (all the graduated sender, at 100%) |
| Misfiles | 0 | **0** |
| Company captured on import | 0 of 200 | 40 of 200 got a company; the graduated sender ~90% |
| What made me watch it | Confirming the company on *every* document; the "Apply to 20" that undid itself; "File up to 30" that filed 0 | Much smoother for the graduated sender — it just filed itself and told me |

Net: **the ceiling is high and safe** (right values, right folders, real hands-off filing, everything recoverable), but **the ramp is a grind** and two of the tools meant to speed the ramp (Apply-to-N, File-All-Ready) misbehaved.

## The two-week verdict

**Would I keep using it after two weeks? Yes — but through gritted teeth for the first week.** I'd keep it because in a full session it never lost a document, never filed one wrong, showed me what it did, and let me undo everything — that's the thing I actually lie awake about, and it passed. The "but" is real: getting a supplier to the point where it files itself meant clicking the company name on document after document, the one button that promised to do them all in a batch quietly threw my work away, and "File up to 30" filed nothing. If a colleague asked, I'd say "it's genuinely good once it knows your suppliers — budget a frustrating first week teaching and confirming, and don't trust the 'do them all' buttons yet."

## What's still missing (ranked)

1. **A batch company-apply that actually works** — "Apply to N" is the single biggest lever for the 200-document first day, and it's currently a no-op that reverts. Fix or remove it.
2. **Fill the company on import when the letterhead plainly reads it** — stop blanking all 200 and making me type the same name over and over.
3. **Make confirming earn recognition** — or, on the confirm screen, tell me confirming won't stop the asking and point me at teaching.
4. **Make "File All Ready" honest** — count what will really file; if it's zero, say so.
5. **Catch obvious reference garbage** (a "$" or "£" inside a reference number) before it auto-files into a filename.

## Humility — what a real fortnight would catch that one sitting can't

- I'm one scripted persona over one session, not real users and not real muscle memory — a true fortnight would test whether I'd *keep* confirming through the grind or give up in week one.
- I confirmed companies in bulk, faster and more mechanically than a human hand; a real Chris would move slower, probably catch the two "$" references I let sail through, and might tire before any sender graduated.
- These were clean, born-digital PDFs. Real scans read worse — several of the "better, but" behaviours (the inferred-company note, the P1/PI guess) would show their true colours on a rough scan, which I couldn't fully exercise.
- I only worked **2 of the 10 senders** deeply; the other eight I'm inferring from.
- My driver could have mis-clicked or drawn boxes differently from a real mouse — where a finding mattered I checked it against the underlying records (empty company fields, reverted values, filed folders) rather than trusting the screen alone, but I can't rule out a driver quirk entirely.

*— Chris Fenton*
