# Chris The Customer — full app review, 2026-08-23 (the overnight fix loop, rounds 18+)

> Continues `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md` (rounds 13–17 + the round-17 triage table).
> Each round is appended VERBATIM under a dated header naming the sandbox conditions; the triage that
> followed it is appended after it. Chris implements nothing; every card queues for the owner's vet.

## ROUND 18 — 2026-08-23 overnight (fresh sandbox CDP 9223, PID 31972; the round-17 fixes `99b90f1`…`740a243` in the build; switches ON: the round-17 set + `template_fixed_debris_wide` + `quiet_reread_on_ready_templated`; corpus SINGLE 10 + IMPORT 200 + Doc sol 22 + IMPORT2 200 + Demo Docs Copperfield Electrical invoices 20; mig 85) — VERBATIM

# Chris The Customer — Round 18 (2026-08-23 overnight, second overnight round)

Sandbox: fresh ScanFinder on CDP 9223 (PID 31972), admin "chris", output `chris-sandbox\Output`. Corpora: SINGLE 10 → Nordwind taught → IMPORT 200 → Doc sol 22 → IMPORT2 200 → Demo Docs *Copperfield Electrical\invoice* 20. All screenshots in `chris-sandbox\r18_sNN_*.png`; page-vs-filename check sheets in `r18_check_*.png`. One simulated persona, not a user test.

## TL;DR
1. **A document filed itself with the wrong date.** `CopperfieldElectrical_invoice_16.pdf` went into the folder as `Invoice.13-11-2026.INV-29273.pdf`; the page prints **03/11/2026** (s100, `r18_check_447_date.png`). It sat at "High · 94%", "Nothing was flagged… Ready to file", and the "filed themselves" sweep took it 5 s after my third confirm. Four siblings of the same teach were held with the *wrong* date shown in the box and the right one buried in a small note — so the hold works, but it let one through.
2. Round-17 fixes: **Cards 2, 4, 5, 6, 8 FIXED; 1 still NOT fixed in Review** (the "Keep / Change the type" hold never renders — only the same dead-end toast, twice, and again on re-file); **3 and 7 BETTER-BUT**. Zero wrong folders in the end — but only because I repaired three (two deliberate, one the app's).
3. **"Put back" does not stick.** Seven Doc Sol documents I put back re-filed themselves 1.5 s after my next confirm on that sender; nine Copperfield ones re-filed the moment I *corrected* a date. The records then say *I* confirmed them.

---

## Walkthrough

**Setup (s00–s05).** Admin → recovery code → Terms → 6-step wizard. My driver mangled the output path once (backslash) and I corrected it before any import (s03b). Home on first open (s15) still lists "Choose where filed documents are saved" under FINISH SETTING UP even though the wizard had just set it — a stale tick.

**Types (s07–s09).** Settings → Document Types → "+ Add from catalog…" → ticked Quote, Service Worksheet, Delivery Note, Credit Note, Statement. The dialog copy says "so extraction has a head start before you teach anything" — not a word I'd say to a colleague.

**SINGLE 10 + Nordwind wizard (s06, s11–s13).** Four drawn boxes, all four read-backs right, filed to `Nordwind-Refrigeration-Ltd\2025\June\Quote.10-06-2025.NRQ-8153.pdf`. Done-card: "I'll recognise Nordwind Refrigeration Ltd from now on. As you confirm a few more of their Quote in the review queue, it will start filing itself."

**IMPORT 200 in 124 s (s14).** 209 in Review; Nordwind group "20 documents · 1 needs a look · 2 more to file by itself"; every other sender says "5 more to file by itself" (s16). Two garble senders exist already: "Dairy Wholesale" (1 doc) next to "Meadowvale Dairy Wholesale" (18).

**Nordwind confirms → the ready arm (s17–s20).** Doc 91: "1 of 3 confirmed from this sender · Confirm it and it files — and it counts towards this sender filing on its own." Confirm → "Filed as Quote.11-08-2025.NRQ-3753.pdf in Nordwind-Refrigeration-Ltd / 2025 / August." Second confirm (doc 110) → within 3.5 s the group read **"2 documents · 1 needs a look · ✓ files by itself"** and the strip showed **"✓ Just now · 16 filed themselves ▾"** (s19). Chip detail: "16 documents from Nordwind Refrigeration Ltd filed themselves — they matched what you've confirmed · See them · Put back" (s20). All 16 checked against their pages: right folder, right ref, right date (`r18_check_nw_a/b.png`). The two left: the one I was looking at ("Ready to file") and one "Check" whose total note reads "adjusted to the total that balances against the line amounts — please verify" over a total that was already right (s21).

**Card 1 attempt in Review (s22–s27).** Doc 109 → type Purchase Order → the Quote values vanished, "To file this document, please fill in PO Date and PO Number"; typed them; Confirm → only the toast **"This sender has only ever filed as one document type — check the type before filing."** (s24). Confirm again → same toast (s25). No inline question, no buttons. Switching back to Quote wiped the three correct values again (s26); retyped, filed.

**Doc sol 22 (s29).** Two garble senders at import: "DOCUMENT OLUTIONS" and "Ticket Type"; the rest blank.

**Typed-locate teach over the wordmark (s30–s36).** I drew a one-line box over "DOCUMENT"; the app grew it to the whole logo block and read **"PE DOCUMENT SOLUTIONS"** (s31). Typed DOCUMENT SOLUTIONS → "Found it — the green box shows where" → "Yes — teach this spot" (s32). Number + date read right. Filed. Quiet re-read: "Quietly re-reading DOCUMENT SOLUTIONS documents you haven't opened, now that you've taught its layout — 4 of 20 done. Review stays fully usable." (s37). Afterwards **all 20 siblings read DOCUMENT SOLUTIONS** — "DOCUMENT OLUTIONS" and "Ticket Type" both corrected; no Gay / NOCUMENT / MENT this round (s38).

**Drawn one-line teach (s39–s43).** Tight box over "DOCUMENT" alone. Read "DOCUMENT" and the wizard warned: **"⚠ "DOCUMENT" is part of DOCUMENT SOLUTIONS, the name a saved layout already uses — a box over a two-line name often catches one line. Filing as "DOCUMENT" would start a second folder."** with a button **Use "DOCUMENT SOLUTIONS"** (s40). But the blue primary button directly under it is still "Looks right →". I pressed it to see what happens: it accepted, the summary listed Document Issuer **DOCUMENT** with no warning (s42 summary), Save asked nothing, and the done card said "I'll recognise DOCUMENT from now on." Folder `DOCUMENT\2026\January` created (deliberate, repaired later). Siblings stayed DOCUMENT SOLUTIONS (s43).

**Doc Sol confirms (s44–s50).** Doc 230 carried "manually mapped value differs from the usual format for this field — please verify" on a number (2603-0668-1) that matches every other ticket. After ONE hand confirm the strip said "7 filed themselves" while the group still said "1 more to file by itself" (s45–s46) — it filed by itself before it said it could. Second confirm → "✓ files by itself" over **10 documents that then sat there for 90 s** (s48–s49). One of them (doc 232, 93%) explains: "Nothing looks wrong — **Customer Name** couldn't be checked automatically, so this one is waiting for your eye." — a Service Worksheet has no Customer Name field (s50). All 10 Doc Sol filings checked against pages: correct, including three genuine copies of ticket 2605-0065-1 named -DUPLICATE / -DUPLICATE-2 (`r18_check_ds_a.png`).

**Home (s51).** Old tile gone. But the GETTING SMARTER card read: "2 senders file by themselves after your confirmations. Learned 2 layouts. **Nothing has filed by itself in the last 7 days yet.**" — 23 had filed themselves in the previous 15 minutes. (The sentence disappeared after the IMPORT2 auto-files, s75.)

**File All Ready (s52–s54).** Dialog: "File 5 ready documents (of 200 in the Review queue)? Not included — they stay in the queue: • 124 flagged — waiting for you to check a value • 4 with no document type yet • 67 missing a required detail (date, reference or sender) …". Filed 5; toast "Filed 5 documents · 195 left for review (4 have no document type — reprocess to detect it, or set a type)"; chip "✓ Just now · you filed 5 ▾" → detail "✓ You filed 5 in one go · See them" — no per-sender line, no Put back. One of the five (doc 227) had said "Overall 91% · waiting for your check" on its own panel a minute earlier.

**Reprocess 5 from DOCUMENT SOLUTIONS (s55–s63).** Dialog now says: "…Because this sender already files by itself, anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back." ✓. What came back: **4 documents re-labelled "DOCUMENT" and 1 "SOLUTIONS"** — the group DOCUMENT SOLUTIONS vanished from the queue and two new senders appeared (s55 after, s56). The note on each: "the sender for this layout was changed to 'DOCUMENT' on one document — confirm it here too and it will be used automatically from then on". Confirm unedited → HELD: **""DOCUMENT" is null characters off DOCUMENT SOLUTIONS, which you already use — two spellings would file this sender into two folders. Use "DOCUMENT SOLUTIONS" / Keep "DOCUMENT""** (s57). "Use" filed correctly every time (s58–s63).

**Put back (s64–s65).** "7 filed themselves" → Put back → no question asked → toast "Put 7 documents back in the Review queue." → chip "↩ Just now · 7 put back". Second press on the old chip: the Put back button is simply gone (detail: "…filed themselves — they matched what you've confirmed · See them"); no sentence says it was put back; the old chip then dropped off the strip. The 7 sat at 93% under "✓ files by itself"… until my next Doc Sol confirm (doc 213 at 01:18:22) — 1.5 s later all 7 had re-filed, recorded as confirmed by "chris".

**Search send-back (s66–s72).** "↩ Send back to Review" → "Send this document back to the Review queue? It stays filed until you re-confirm it." → in Review the note reads **"Sent back from Search — please re-check this document before filing."** ✓ (though the panel headline calls it "1 field was flagged by a formatting check"). Re-typing the sender wiped the number and date again (s70); the empty `DOCUMENT\2026\January` folder is still on disk.

**IMPORT2 200 in 134 s (s73–s75).** Banner "Processing new documents from import — N of 200. Reprocess is paused until this finishes." counted up and **cleared the same second the batch ended** (log `banner_import2.log`). 20 Nordwind quotes filed automatically at 100% — all 20 checked right (`r18_check_nw_import2a/b.png`). Chip "20 filed automatically" → "every field read clean (matched 100 %) · See them" — no Put back, no sender named.

**Card 1 again, after a Keep (s76–s85).** Three Nordwind docs sent back from Search. Review: type → Purchase Order → Confirm → same toast (s77). Wizard on another as Purchase Order → at Save: **"Nordwind Refrigeration Ltd files as Quote (38 so far). Teach this one as Purchase Order? [Yes, teach it as Purchase Order] [No — go back and change the type]"** (s79). Said Yes (deliberate) → filed as `Purchase-Order.21-06-2025.NRQ-9311.pdf`. Then AGAIN: Review → toast still fires (s81); wizard → the question still fires (s83) — the "one slip silences it forever" problem is gone. "No — go back and change the type" lands on the draw-boxes page, not the type page. Cancel: "Stop teaching? Nothing is saved yet." ✓. Repaired all three.

**Scary buttons (s86–s91, s103).** Delete one: "Delete "Print-Tracker.H7R5326676.pdf"? It goes to the app's recycle bin — you can restore it from Search." → bin showed it → Restore returned it to the queue (count 370 again). Empty bin: "Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched." — did it: the app's copy went, the original in `Doc sol\Processed` stayed. Split: "This document is only one page — there's nothing to split." (no multi-page scan in these corpora). Delete All Review (read, cancelled): "Delete ALL 370 document(s) in the Review queue? They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected."

**Demo Docs — Copperfield Electrical invoices, the ready arm proper (s92–s101).** Wizard on invoice_01 (three drawn boxes, all right). Done card: "Confirm 2 more Copperfield Electrical Invoice and the rest of their Invoice in the queue will file themselves — 19 are waiting that look just like this one. You still check every value; nothing files on a guess." Re-read bound 19 siblings (16 at 93%, 3 at 81%). Hand-confirmed two (s97–s98). At the third confirm: **"10 filed themselves" in 5 s**, a further "Quietly re-reading Copperfield Electrical documents you haven't opened, now that you've taught its layout — 0 of 2 done" (I had confirmed, not taught), then 7 left: 6 "need a look", 1 "Ready to file". The six: four say **"Read differently after learning — was '23-04-2026', now '02-04-2026'. Please check which is right."** (and 12→02-10, 13→03-07, 03-12→17-02) — the page agrees with the *old* value every time (`r18_check_cf_dates.png`), yet the box shows the new wrong one; two say "Kept the read value "10/06/2026" — the taught date box read "L0/06/2026", which isn't a valid calendar date. Please check." / "…read "7/02/2096", which is far in the future…". And among the 10 that filed themselves: **invoice_16, page 03/11/2026, filed as 13-11-2026** (`r18_check_cf_filed.png`, s100). Put back 10 → corrected that one date → the other 9 re-filed themselves instantly (s101).

---

## VERIFY lines (round-17 cards)

1. **Card 1 — inline type-split hold: NOT FIXED in Review / FIXED in the wizard / FIXED "still asks after a slip".** Review (new type + Confirm, first and second press, and re-file after Search send-back): only the toast "This sender has only ever filed as one document type — check the type before filing." — no "Change the type / Keep" anywhere, a dead end (s24, s25, s77, s81). Wizard asks before saving and keeps asking after one Keep (s79, s83). Note the toast's wording is now false after the Keep (one PO existed).
2. **Card 2 — garble folders: FIXED (with a copy bug).** No sibling read Gay/NOCUMENT/MENT; the two that came in garbled were corrected by the teach (s38). When the re-read did produce "DOCUMENT"/"SOLUTIONS", confirming unedited was HELD with Use/Keep (s57, s60) and Use filed right. Copy says "is **null** characters off" (s57). Zero wrong folders from the app's side.
3. **Card 3 — one-line drawn teach: BETTER-BUT.** The wizard now warns with the full name and a Use button (s40) — but "Looks right →" is still the blue default right under the warning, the summary shows "DOCUMENT" with no reminder, Save asks nothing, and the done card cheerfully says "I'll recognise DOCUMENT from now on" (s42). One click past the warning = second folder.
4. **Card 4 — tile vs strip: FIXED, NEW-PROBLEM.** The tile is gone (s51). The GETTING SMARTER card said "Nothing has filed by itself in the last 7 days yet." while the strip listed 23 that had (s51); it counts only import auto-files. "Learned 2 layouts" after I'd taught 3; "4" after 5 (s104).
5. **Card 5 — File All Ready: FIXED for the count, BETTER-BUT for the receipt.** Promised 5, filed 5, one chip "you filed 5" (s52–s54). Detail has no per-sender breakdown and no Put back. Home's "5 ready" excluded the 71 blank-sender docs ✓. One "ready" doc had told me a minute earlier it was "waiting for your check".
6. **Card 6 — Reprocess copy + banner: FIXED.** Dialog says clean re-reads WILL file and names Put back (s55); banner cleared within a second of the batch ending (banner log). New problem from the same button: see card A2.
7. **Card 7 — Put back twice: BETTER-BUT.** Second press impossible (button removed) and no phantom "0 put back" — but the chip never says it was put back, there's no "Already back in Review.", and the chip then disappears from the strip (s65). And the put-back documents re-file on the next confirm (card A3).
8. **Card 8 — Search send-back note: FIXED.** "Sent back from Search — please re-check this document before filing." (s69).
9. **The ready arm (Nordwind, Copperfield): WORKS — and that is the headline.** Third contributing confirm → "✓ files by itself" → 16 / 10 filed within 5 s, chip with Put back, re-read notes on the rest. Honest on the Nordwind pile. Copperfield: 1 of 10 filed with a wrong date; 4 held with the wrong date *shown*. **Doc Sol (generic name): badge NOT honest** — "✓ files by itself" over 10 documents (5 of them at 93% "ready") that sat for 90 s and only moved when I pressed File All Ready (s49–s50). Worse: 7 filed themselves *before* the badge flipped (s45).
10. **Scary buttons: all told the truth** (table below). Put back is the one action that asked nothing.

---

## NEW finding cards (ranked by harm)

### A1. A document filed itself with the wrong date, at "High · 94%", "Nothing was flagged"
- **Citation:** Review, doc `CopperfieldElectrical_invoice_16.pdf` (s100): INVOICE DATE "13-11-2026 · High · 94%"; panel "Nothing was flagged on this document — check the values and confirm to file it. Ready to file". Page: "Invoice Date 03/11/2026". Folder: `Copperfield-Electrical\2026\November\Invoice.13-11-2026.INV-29273.pdf`, chip "10 documents from Copperfield Electrical filed themselves — they matched what you've confirmed".
- **User-moment:** I'd taught one invoice, confirmed two, and the app filed ten on its own.
- **Observed confusion:** Nothing on screen hinted this one was different from the other nine. Four of its siblings were held with "Read differently after learning — was '23-04-2026', now '02-04-2026'. Please check which is right." — the same kind of slip — so the app *can* catch this; here it didn't. At import this document had shown "—" for its date (s92 table), so the only reading it ever had was the new wrong one.
- **Harm:** trust-eroded / misfiled value. This is fear #2 on my list: filed wrong without my knowing. A search for "November invoices from Copperfield" still finds it; a search by the printed date does not.
- **Class:** QUESTION — why was a date the first read couldn't find at all trusted to file without a look?
- **Proposed alternative:** When a document files itself, show the "filed themselves" chip's *See them* list with the date and reference beside each row so I can eyeball ten dates in five seconds; and treat "this field was blank at import, first read came from the new box" as a reason to hold once ("First read of this date came from your new box — confirm once.").
- **What I may be missing:** It may be that 1-in-10 is the accepted price for the speed, and the held four are the mechanism working. But the one that got through is the one I'd be blamed for.

### A2. One click past a clear warning created a second sender, and a Reprocess then handed five siblings to it
- **Citation:** Teach wizard (s40): '⚠ "DOCUMENT" is part of DOCUMENT SOLUTIONS, the name a saved layout already uses … Filing as "DOCUMENT" would start a second folder.' + [Use "DOCUMENT SOLUTIONS"] + primary **[Looks right →]**. Then Review after "Reprocess 5 from "DOCUMENT SOLUTIONS"" (s55–s56): group **DOCUMENT · 4 documents**, group **SOLUTIONS · 1 document**, note "the sender for this layout was changed to 'DOCUMENT' on one document — confirm it here too and it will be used automatically from then on".
- **User-moment:** I pressed the big blue button under the warning (as I would at 5 pm), then later asked the app to re-read the sender's last five.
- **Observed confusion:** The reprocess *removed* the correct sender from my queue and replaced it with two fragments, and the first note on each invited me to confirm the fragment. Only pressing Confirm revealed the real choice (Use / Keep). A user who trusts the first note and edits nothing is one click from a DOCUMENT folder; one who reads "confirm it here too" and does so would be held — good — but the two notes contradict each other on the same panel.
- **Harm:** trust-eroded; blocked for a non-reader. Folder `DOCUMENT\2026\January` is still on disk (empty) after repair.
- **Class:** CONFUSION.
- **Proposed alternative:** In the wizard, when the warning fires, make **Use "DOCUMENT SOLUTIONS"** the primary button and demote "Looks right" to "Keep "DOCUMENT" anyway"; repeat the warning on the summary row and at Save. In Review, when the "changed to 'DOCUMENT'" note and the "two spellings" hold both apply, show only the hold, before Confirm, not after.
- **What I may be missing:** I overrode an explicit warning, so some of this is on me; and the Keep path may be needed for a genuine "DOCUMENT Ltd". Still, the default should not be the second folder.

### A3. "Put back" lasts until your next confirm
- **Citation:** Strip (s64): "↩ Just now · 7 put back ▾"; then at 01:18:42 "✓ Just now · 7 filed themselves ▾" with no action of mine on those seven. App records: the seven re-filed 1.5 s after I confirmed a different Doc Sol document, marked confirmed by "chris". Same again with the Copperfield ten: I put them back to fix one date, corrected it, and the other nine re-filed instantly (s101, "✓ Just now · 10 filed themselves").
- **User-moment:** I put documents back precisely to look at them before they file; I then did one routine confirm.
- **Observed confusion:** I expected put-back documents to wait for me. Instead the act of fixing a mistake on one document re-fired the filing of its siblings — the exact moment I trust the reads least. And the receipt names me as the person who confirmed them.
- **Harm:** trust-eroded / undo illusory.
- **Class:** CONFUSION.
- **Proposed alternative:** A document I put back should carry "Put back by you — will not file itself until you confirm it" and be excluded from the by-itself sweep; and a *correction* on a sender should pause that sender's self-filing for the session ("You corrected a date from Copperfield Electrical — holding the other 9 for your eye") rather than trigger it.
- **What I may be missing:** Maybe the sweep is meant to treat my correction as fresh evidence. From where I sit it reads as "you noticed a mistake, so I'll hurry."

### A4. The type-split question in Review is still a dead end
- **Citation:** Review (s24, s25, s77, s81): toast "This sender has only ever filed as one document type — check the type before filing." — shown on first Confirm, second Confirm, and on a re-file after "Sent back from Search". No buttons, no inline note.
- **User-moment:** A quote that is really a purchase order; I changed the type and want to file it.
- **Observed confusion:** The toast tells me to check; I have checked; pressing Confirm again says the same thing. The only way to file the second type is the Teach wizard (which asks properly). After a Keep there, the toast's claim "has only ever filed as one document type" is untrue.
- **Harm:** blocked.
- **Class:** CONFUSION.
- **Proposed alternative:** The wizard's own wording, inline under the type box: "Nordwind Refrigeration Ltd files as Quote (38 so far). File this one as Purchase Order? [Change the type] [Keep Purchase Order]".
- **What I may be missing:** My driver saw no hidden note at all, so this isn't a layout glitch on my side; but I'm one tester.

### A5. Changing the type (or the sender) throws away the three correct values
- **Citation:** Review (s22, s26, s70): after choosing Purchase Order, "To file this document, please fill in PO Date and PO Number — these fields are needed to file it."; after switching *back* to Quote the Quote Number, Quote Date and Total boxes were empty; after retyping the sender on a sent-back document, Worksheet Number and Worksheet Date went blank.
- **User-moment:** Correcting one dropdown on a document whose other values were right.
- **Observed confusion:** I expected the date and reference to survive a type or sender change (a date is a date). I retyped the same three values four times tonight.
- **Harm:** slowed; invites a typo into a filename.
- **Class:** PREFERENCE (it works, the cost is mine).
- **Proposed alternative:** Carry the date and reference across a type change when the new type has a date and a reference role; on a sender retype, leave the other boxes alone.
- **What I may be missing:** The Quote → Purchase Order fields genuinely differ; maybe the wipe is deliberate for safety.

### A6. "✓ files by itself" over a pile that waits — and a reason that names a field the type doesn't have
- **Citation:** Review (s49–s50): group "DOCUMENT SOLUTIONS · 10 documents · 5 need a look · ✓ files by itself" for 90 s; doc 232's panel: "Nothing looks wrong — **Customer Name** couldn't be checked automatically, so this one is waiting for your eye. Overall 93% · waiting for your check. Confirm it and it files. This isn't the confidence setting — changing that won't file this one." The Service Worksheet panel shows Document Issuer, Worksheet Number, Worksheet Date only. Earlier (s45): "7 filed themselves" while the same group said "1 more to file by itself".
- **User-moment:** Reading the badge to decide whether I can leave this sender alone.
- **Observed confusion:** The badge says it files itself; five ready documents don't; the reason blames a field I can't see or fill. And the sender had already filed seven on its own one confirm *before* earning the badge — so the badge is late in one direction and early in the other.
- **Harm:** trust-eroded (the badge is the one line I want to believe).
- **Class:** QUESTION.
- **Proposed alternative:** If a sender won't sweep for a reason (here, presumably its plain-word name), say so on the group: "Files by itself on import — the ones here need one look from you", and never name a field the type doesn't show.
- **What I may be missing:** The brief warned me this sender's name is "generic"; I can't tell that from the screen, which is the point.

### A7. Home still contradicts the strip, just with a different sentence
- **Citation:** Home GETTING SMARTER (s51): "2 senders file by themselves after your confirmations. Learned 2 layouts. Nothing has filed by itself in the last 7 days yet." — at that moment the Review strip read "✓ 7 filed themselves" and "✓ 16 filed themselves". After the import (s75) the sentence vanished; (s104) "Learned 4 layouts." after five teaches.
- **User-moment:** Glancing at Home to see what the app did while I was away.
- **Observed confusion:** Two screens, two stories. I'd conclude the "filed themselves" chips weren't real filings.
- **Harm:** trust-eroded.
- **Class:** CONFUSION.
- **Proposed alternative:** "23 filed by themselves today (16 Nordwind Refrigeration Ltd, 7 DOCUMENT SOLUTIONS) — see them in Review", counting the same events the strip counts; count layouts the way the Templates tab does.
- **What I may be missing:** "by itself" may mean "at import" to the app; it means "without me" to me.

### A8. Untaught garble senders still become their own groups with no way to merge them
- **Citation:** Review (s16, s102): groups "Dairy Wholesale · 1 document" and "Ol Meadowvale · 1 document" beside "Meadowvale Dairy Wholesale · 37 documents"; doc 304's note: "The letterhead reads 'Ol Meadowvale' — filled in for you, but please confirm it's the sender, not the customer, before filing." — the only button on the field is "Never on these documents?". Headline: "Needs a quick check — 1 field was read with low confidence, and 1 field was flagged by a formatting check."
- **User-moment:** Scanning the sender list for the Meadowvale pile.
- **Observed confusion:** Three near-names for one company; the note asks me to confirm a name that is plainly half a name; nothing offers the full one that 37 siblings carry.
- **Harm:** slowed; two folders waiting to happen.
- **Class:** PREFERENCE.
- **Proposed alternative:** The same Use/Keep hold the taught sender got in s57: "'Ol Meadowvale' looks like part of Meadowvale Dairy Wholesale (37 in this queue). Use it?"
- **What I may be missing:** The merge may only be possible once a layout is taught; then the group should at least say "looks like Meadowvale Dairy Wholesale".

*(Copy notes, not cards: "null characters off" in the hold (s57); "manually mapped value differs from the usual format" on a number that matches every sibling (s44); "low confidence", "extraction" in the catalog dialog and "extraction may be less tolerant" on the wizard done-card; "Quietly re-reading … now that you've taught its layout" after a confirm, not a teach (s98); "No — go back and change the type" lands on the boxes page; the "Press Space to confirm reviewed" tooltip sits half under the strip panel (s21); the chip panel covers the top of the page while open (s47); "3 taught fields / 2 taught fields / 1 taught field" on three documents of the same sender.)*

---

## Warnings truth table

| Action | Warning (verbatim) | What actually happened | Truthful? |
|---|---|---|---|
| Delete one (Review) | Delete "Print-Tracker.H7R5326676.pdf"? It goes to the app's recycle bin — you can restore it from Search. | In bin; Restore returned it to the queue | Yes |
| Empty bin (Search) | Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched. | App copy deleted; original in `Doc sol\Processed` untouched | Yes |
| Delete All Review | Delete ALL 370 document(s) in the Review queue? They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected. | Not executed (read only) | Reads true |
| File All Ready | File 5 ready documents (of 200 in the Review queue)? Not included… 124 flagged… 4 with no document type… 67 missing a required detail… Each one is filed exactly as if you confirmed it yourself. | Filed exactly 5; 124+4+67 = 195 left | Yes |
| Reprocess N from sender | Re-read all 5 documents… Because this sender already files by itself, anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back. | Nothing filed (the re-read changed the sender instead, A2) | Yes as far as it goes |
| Put back (chip) | *no warning* | 7 / 10 returned to Review instantly; re-filed at my next confirm (A3) | No warning, and the undo didn't hold |
| Send back (Search) | Send this document back to the Review queue? It stays filed until you re-confirm it. | Back in queue with "Sent back from Search…"; file replaced on re-confirm | Yes |
| Teach wizard Cancel | Stop teaching? Nothing is saved yet. | Nothing saved | Yes |
| Teach wizard Save (type split) | Nordwind Refrigeration Ltd files as Quote (38 so far). Teach this one as Purchase Order? | Yes → filed as Purchase Order; No → back one step (to boxes, not type) | Yes |
| Teach wizard Save (fragment name) | warned at the issuer step only; nothing at Save | Folder DOCUMENT created | Warning true, placement weak |
| Split PDF (1-page doc) | This document is only one page — there's nothing to split. | Nothing happened | Yes |

---

## FILED-DOCS TABLE (76 documents on disk = 76 in the app's list; every one opened and its ref + date compared with the page; three were wrong at some point and are flagged)

| # | original scan | sender folder | year/month | filed name (type.date.ref) | how filed | check |
|---|---|---|---|---|---|---|
| 433 | CopperfieldElectrical_invoice_03.pdf | Copperfield-Electrical | 2026/July | Invoice.21-07-2026.INV-16033.pdf | me | ✓ |
| 434 | CopperfieldElectrical_invoice_02.pdf | Copperfield-Electrical | 2026/December | Invoice.17-12-2026.INV-41557.pdf | me | ✓ |
| 435 | CopperfieldElectrical_invoice_06.pdf | Copperfield-Electrical | 2026/August | Invoice.09-08-2026.INV-80744.pdf | filed itself | ✓ |
| 437 | CopperfieldElectrical_invoice_01.pdf | Copperfield-Electrical | 2026/November | Invoice.23-11-2026.INV-29597.pdf | me (wizard) | ✓ |
| 439 | CopperfieldElectrical_invoice_04.pdf | Copperfield-Electrical | 2026/January | Invoice.15-01-2026.INV-83936.pdf | filed itself | ✓ |
| 440 | CopperfieldElectrical_invoice_08.pdf | Copperfield-Electrical | 2026/March | Invoice.11-03-2026.INV-28333.pdf | filed itself | ✓ |
| 442 | CopperfieldElectrical_invoice_10.pdf | Copperfield-Electrical | 2026/September | Invoice.25-09-2026.INV-73127.pdf | filed itself | ✓ |
| 443 | CopperfieldElectrical_invoice_13.pdf | Copperfield-Electrical | 2026/November | Invoice.14-11-2026.INV-12110.pdf | filed itself | ✓ |
| 444 | CopperfieldElectrical_invoice_15.pdf | Copperfield-Electrical | 2026/March | Invoice.21-03-2026.INV-28873.pdf | filed itself | ✓ |
| 445 | CopperfieldElectrical_invoice_11.pdf | Copperfield-Electrical | 2026/October | Invoice.22-10-2026.INV-39435.pdf | filed itself | ✓ |
| **447** | CopperfieldElectrical_invoice_16.pdf | Copperfield-Electrical | 2026/November | Invoice.03-11-2026.INV-29273.pdf (now) | filed itself, then me | **WRONG DATE FILED BY ITSELF as 13-11-2026; page prints 03/11/2026 (s100). Put back + corrected by hand** |
| 448 | CopperfieldElectrical_invoice_20.pdf | Copperfield-Electrical | 2026/October | Invoice.15-10-2026.INV-75373.pdf | filed itself | ✓ |
| 451 | CopperfieldElectrical_invoice_17.pdf | Copperfield-Electrical | 2026/January | Invoice.18-01-2026.INV-20948.pdf | filed itself | ✓ |
| 452 | CopperfieldElectrical_invoice_18.pdf | Copperfield-Electrical | 2026/April | Invoice.18-04-2026.INV-94023.pdf | filed itself | ✓ |
| 211 | Worksheet.05-05-2026.4OU0-UU00.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1.pdf | filed itself | ✓ (ticket 2605-0065-1, copy 1 of 4) |
| 212 | Worksheet.05-05-2026.Booking.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1-DUPLICATE.pdf | filed itself | ✓ (copy 2) |
| **213** | Worksheet.12-01-2026.2601-0371-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/January | Service-Worksheet.12-01-2026.2601-0371-1.pdf (now) | me (wizard), then me | **WRONG FOLDER AT FIRST: `DOCUMENT\2026\January` — my deliberate click past the wizard warning (s42). Sent back + retyped** |
| 214 | Worksheet.05-05-2026.2605-0065-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1-DUPLICATE-2.pdf | filed itself | ✓ (copy 3) |
| 215 | Worksheet.05-05-2026.Booking.APPROVED-stamped.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1-DUPLICATE-3.pdf | me (Use) | ✓ (copy 4, stamped) |
| 216 | Worksheet.04-02-2026.2602-0128-1.pdf | DOCUMENT-SOLUTIONS | 2026/February | Service-Worksheet.04-02-2026.2602-0128-1.pdf | me (wizard) | ✓ |
| 217 | Worksheet.14-01-2026.2601-0563-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/January | Service-Worksheet.14-01-2026.2601-0563-1.pdf | me (Use) | ✓ |
| 218 | Worksheet.13-02-2026.2602-0527-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/February | Service-Worksheet.13-02-2026.2602-0527-1.pdf | filed itself | ✓ |
| 219 | Worksheet.07-01-2026.2601-0195-1.pdf | DOCUMENT-SOLUTIONS | 2026/January | Service-Worksheet.07-01-2026.2601-0195-1.pdf | me (Use) | ✓ (came back as "SOLUTIONS") |
| 221 | Worksheet.16-09-2026.2603-0667-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.16-03-2026.2603-0667-1.pdf | me (Use) | ✓ (page 16/03/2026; the old "16-09" name was the owner's) |
| 222 | Worksheet.16-09-2026.2603-0667-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.16-03-2026.2603-0667-1-DUPLICATE.pdf | me (Use) | ✓ |
| 223 | Worksheet.22-05-2026.2605-0805-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.22-05-2026.2605-0805-1.pdf | filed itself | ✓ |
| 224 | Worksheet.31-03-2026.31032026-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.31-03-2026.2603-1351-1-DUPLICATE-3.pdf | me (File All) | ✓ (ticket 2603-1351-1, 4 copies) |
| 225 | Worksheet.31-03-2026.2603-1351-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.31-03-2026.2603-1351-1-DUPLICATE-2.pdf | me (File All) | ✓ |
| 226 | Worksheet.22-05-2026.9605-0769-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.22-05-2026.2605-0769-1.pdf | filed itself | ✓ (page 2605-0769-1; the "9605" was the old name) |
| 227 | Worksheet.17-04-2026.2604-0511-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/April | Service-Worksheet.17-04-2026.2604-0511-1.pdf | me (File All) | ✓ |
| 228 | Worksheet.16-03-2026.2603-0670-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.16-03-2026.2603-0670-1.pdf | filed itself | ✓ |
| 229 | Worksheet.27-05-2026.2605-0849-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.27-05-2026.2605-0849-1.pdf | me | ✓ |
| 230 | Worksheet.16-03-2008.2603-0668-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.16-03-2026.2603-0668-1.pdf | me | ✓ (page 16/03/2026; "2008" was the old name) |
| 231 | Worksheet.31-03-2026.Booking.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.31-03-2026.2603-1351-1-DUPLICATE.pdf | me (File All) | ✓ |
| 232 | Worksheet.31-03-2026.31032026.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.31-03-2026.2603-1351-1.pdf | me (File All) | ✓ |
| 6 | Nordwind-Refrigeration_quote_0011.pdf | Nordwind-Refrigeration-Ltd | 2025/June | Quote.10-06-2025.NRQ-8153.pdf | me (wizard) | ✓ |
| 91 | Nordwind-Refrigeration_quote_0012-9.pdf | Nordwind-Refrigeration-Ltd | 2025/August | Quote.11-08-2025.NRQ-3753.pdf | me | ✓ |
| 92 | …quote_0016-8.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.13-02-2026.NRQ-9584.pdf | filed itself | ✓ |
| 93 | …quote_0015-8.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.21-04-2026.NRQ-1124.pdf | filed itself | ✓ |
| 94 | …quote_0020-8.pdf | Nordwind-Refrigeration-Ltd | 2025/December | Quote.02-12-2025.NRQ-7396.pdf | filed itself | ✓ |
| 95 | …quote_0013-8.pdf | Nordwind-Refrigeration-Ltd | 2026/May | Quote.09-05-2026.NRQ-6357.pdf | filed itself | ✓ |
| 96 | …quote_0017-8.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.13-02-2026.NRQ-5662.pdf | filed itself | ✓ |
| 97 | …quote_0014-8.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.27-04-2026.NRQ-4484.pdf | filed itself | ✓ |
| 98 | …quote_0021-9.pdf | Nordwind-Refrigeration-Ltd | 2025/March | Quote.26-03-2025.NRQ-3153.pdf | filed itself | ✓ |
| 99 | …quote_0018-8.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.10-06-2026.NRQ-8209.pdf | filed itself | ✓ |
| 100 | …quote_0019-8.pdf | Nordwind-Refrigeration-Ltd | 2025/March | Quote.16-03-2025.NRQ-8478.pdf | filed itself | ✓ |
| 101 | …quote_0023-8.pdf | Nordwind-Refrigeration-Ltd | 2025/September | Quote.21-09-2025.NRQ-7876.pdf | me | ✓ |
| 102 | …quote_0030-8.pdf | Nordwind-Refrigeration-Ltd | 2026/January | Quote.01-01-2026.NRQ-2551.pdf | filed itself | ✓ |
| 103 | …quote_0022-8.pdf | Nordwind-Refrigeration-Ltd | 2025/May | Quote.26-05-2025.NRQ-6472.pdf | filed itself | ✓ |
| 104 | …quote_0024-8.pdf | Nordwind-Refrigeration-Ltd | 2025/June | Quote.12-06-2025.NRQ-4843.pdf | filed itself | ✓ |
| 105 | …quote_0025-8.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.10-04-2026.NRQ-7469.pdf | filed itself | ✓ |
| 106 | …quote_0031-7.pdf | Nordwind-Refrigeration-Ltd | 2025/July | Quote.05-07-2025.NRQ-4624.pdf | filed itself | ✓ |
| 107 | …quote_0027-8.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.07-08-2026.NRQ-1085.pdf | filed itself | ✓ |
| 108 | …quote_0026-7.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.23-04-2026.NRQ-3901.pdf | filed itself | ✓ |
| 109 | …quote_0029-7.pdf | Nordwind-Refrigeration-Ltd | 2025/October | Quote.09-10-2025.NRQ-1911.pdf | me | ✓ |
| 110 | …quote_0028-8.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.04-04-2026.NRQ-4135.pdf | me | ✓ |
| 313 | …quote_0035-2.pdf | Nordwind-Refrigeration-Ltd | 2025/April | Quote.18-04-2025.NRQ-5470.pdf | auto at import, sent back, me | ✓ |
| **314** | …quote_0040-2.pdf | Nordwind-Refrigeration-Ltd | 2025/June | Quote.21-06-2025.NRQ-9311.pdf (now) | auto, sent back, me (wizard), sent back, me | **WRONG TYPE AT FIRST: `Purchase-Order.21-06-2025.NRQ-9311.pdf` — my deliberate "Yes, teach it as Purchase Order" (s80). Sent back + retyped** |
| 315 | …quote_0038-1.pdf | Nordwind-Refrigeration-Ltd | 2026/January | Quote.05-01-2026.NRQ-8236.pdf | auto, sent back, me | ✓ |
| 316 | …quote_0036-2.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.26-08-2026.NRQ-5258.pdf | auto at import (100%) | ✓ |
| 317 | …quote_0032-2.pdf | Nordwind-Refrigeration-Ltd | 2025/February | Quote.12-02-2025.NRQ-1727.pdf | auto (100%) | ✓ |
| 318 | …quote_0033-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.23-06-2026.NRQ-6226.pdf | auto (100%) | ✓ |
| 319 | …quote_0037-2.pdf | Nordwind-Refrigeration-Ltd | 2025/December | Quote.07-12-2025.NRQ-7162.pdf | auto (100%) | ✓ |
| 320 | …quote_0041-2.pdf | Nordwind-Refrigeration-Ltd | 2025/May | Quote.17-05-2025.NRQ-5693.pdf | auto (100%) | ✓ |
| 321 | …quote_0034-2.pdf | Nordwind-Refrigeration-Ltd | 2026/January | Quote.06-01-2026.NRQ-8138.pdf | auto (100%) | ✓ |
| 322 | …quote_0039-2.pdf | Nordwind-Refrigeration-Ltd | 2025/August | Quote.07-08-2025.NRQ-3747.pdf | auto (100%) | ✓ |
| 323 | …quote_0046.pdf | Nordwind-Refrigeration-Ltd | 2025/March | Quote.20-03-2025.NRQ-3467.pdf | auto (100%) | ✓ |
| 324 | …quote_0048-2.pdf | Nordwind-Refrigeration-Ltd | 2026/July | Quote.08-07-2026.NRQ-7419.pdf | auto (100%) | ✓ |
| 325 | …quote_0042-2.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.03-02-2026.NRQ-7887.pdf | auto (100%) | ✓ |
| 326 | …quote_0047-2.pdf | Nordwind-Refrigeration-Ltd | 2025/January | Quote.10-01-2025.NRQ-5900.pdf | auto (100%) | ✓ |
| 327 | …quote_0043-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.02-06-2026.NRQ-1058.pdf | auto (100%) | ✓ |
| 328 | …quote_0045.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.01-02-2026.NRQ-9591.pdf | auto (100%) | ✓ |
| 329 | …quote_0044-2.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.10-08-2026.NRQ-4148.pdf | auto (100%) | ✓ |
| 330 | …quote_0049-2.pdf | Nordwind-Refrigeration-Ltd | 2026/March | Quote.04-03-2026.NRQ-9024.pdf | auto (100%) | ✓ |
| 331 | …quote_0050-2.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.19-04-2026.NRQ-8169.pdf | auto (100%) | ✓ |
| 332 | …quote_0051-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.20-06-2026.NRQ-5788.pdf | auto (100%) | ✓ |

Totals: 76 filed — 33 "filed itself", 17 automatically at import, 26 by me. Wrong at some point: **3** (two my deliberate probes, **one the app's wrong date, A1**). Wrong now: 0. Empty ghost folder left on disk: `DOCUMENT\2026\January`. Left in Review: 375, including 6 Copperfield with the "Read differently after learning" holds (all with the wrong value in the box) and the untaught senders.

---

## What genuinely worked
The hand-off itself. "1 of 3 confirmed from this sender · Confirm it and it files — and it counts towards this sender filing on its own" → two confirms → "✓ files by itself" → sixteen quotes in the right folders in under five seconds, with a chip that names the sender and offers Put back. That is the thing I was promised in round 17 and didn't get; tonight it happened twice. Also: the Use "DOCUMENT SOLUTIONS" hold filed every fragment right, the File All Ready count finally adds up, and every destructive warning told the truth.

## Top friction
The app's self-filing doesn't pause when I signal doubt: Put back is undone by my next confirm, a *correction* triggers a sweep of the siblings, and one of those sweeps filed a wrong date at "High · 94%" with "Nothing was flagged". The hold on the other four proves it knows the risk; it needs to hold the tenth one too, and to leave put-back documents alone.

## Would I keep using this after two weeks?
**Yes, with one finger on Search.** The Nordwind and Doc Sol runs are the first time the app has filed a whole pile correctly on its own after two or three of my confirms, and Send back / Put back / Use all repaired my own mistakes cleanly. The No is one more wrong date away: A1 is the fear that makes me open every folder on Friday afternoon, and A3 means my "let me look first" doesn't hold. Fix those two and I'd stop checking.

## Humility
- I am one simulated persona, driving through a script; my driver snapped boxes where a mouse would wobble, and in the drawn-wordmark test the app grew my one-line box to two lines on the first try — a real hand might get different reads.
- Two of the three wrong filings were mine on purpose (one click past a clear warning; one "Yes" to a clear question). I did them because the brief asked; a careful user would not.
- I read the app's own filed-document list to build the table and to see *when* the put-back documents re-filed; I can describe what happened, not why.
- The Doc Sol scans had already been filed once by the owner under their old names; I used those names only as hints and checked every page myself — three of the owner's old names (9605-…, 16-09-…, 2008) were the ones that were wrong, not the app's.
- A stray watcher of mine was cancelling native dialogs for about ten minutes around 01:19–01:29; I killed it and re-ran every send-back, so none of the findings above rest on that window. The Put back with no warning happened before it existed.
- "Generic name" for DOCUMENT SOLUTIONS is the owner's word; from the screen I can't tell a generic sender from a normal one, which is itself the finding in A6.
