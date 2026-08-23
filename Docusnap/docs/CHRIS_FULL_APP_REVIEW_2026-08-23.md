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

---

## Round 18 TRIAGE + FIXES (2026-08-23 overnight, continued)
gary (A1 design) → Oracle (A1 SEND BACK → rebuilt; put-back W/COND; A4/A2/A6 signed; Q2; A3 part 2). One commit per card; behaviour widenings DARK; nothing pushed.
| Card | Verdict | Fix (commit) |
|---|---|---|
| A1 wrong date self-filed (447) | SYSTEM — the teach-arm first-fill had NO evidence gate; the same job held 4 S3-C5 disagreements on the same box | `371ef2d` the FIRST-FILL RELIABILITY hold (DARK `quiet_reread_first_fill_reliability_hold`): hold every first-fill at merge, release at finish unless the field proved unreliable in the job (K=1; witnesses = S3-C5, loss, engine yield); the "— confirm once." family survives the READY arm and a same-value Reprocess; S3-C5 rows carry `corrected_to = was` (Use/Keep). Census: DS 0 held, Copperfield held |
| A3 Put back does not stick | BUG | `19e91b0` + `061ca82` mig 86 `put_back_at` stamped by every human "look again" door; the ONE predicate refuses; a machine via refused pre-claim; only a human claim clears; the auto accept files as "Auto-filed (after your confirms)" |
| A4 Review type-split dead end | BUG (one link past the r17 fix) | `7b8c8e1` the IPC whitelist forwards `typeSplit` |
| A2 one click past the warning | UX | `8b5ae1a` Use "FULL NAME" primary; Save re-asks; ack carried |
| A5 type change wipes values | PREFERENCE | owner vet (the anti-bleed rule) |
| A6 badge over a waiting pile; phantom Customer Name | by design (07-22 foreign rows hold) + copy | `8b5ae1a` honest foreign-field copy; the badge/licence mismatch → owner vet |
| A7 Home contradicts the strip | BUG | `615263c` the tally counts every machine via |
| A8 untaught garble groups | PREFERENCE | owner vet |
| cards 5 / 7 / copy | UX | `8b5ae1a` bulk lists senders; chip says put back; "null characters" (kind forwarded); the lane notice names the trigger |

---

## ROUND 19 — 2026-08-23 overnight (fresh sandbox CDP 9223, PID 20880; the round-18 fixes `7b8c8e1`…`371ef2d` in the build (mig 86); switches ON: the round-18 set + `quiet_reread_first_fill_reliability_hold`; corpus SINGLE 10 + IMPORT 200 + Doc sol 22 + Demo Docs Copperfield / Ironbridge / Larkspur invoices 20 each + IMPORT2 200) — VERBATIM

# Chris The Customer — Round 19 (2026-08-23 overnight, third overnight round)

Sandbox: fresh ScanFinder on CDP 9223 (PID 20880), admin "chris", output `chris-sandbox\Output`. Corpora in the order of round 18: SINGLE 10 → Nordwind taught → IMPORT 200 → Doc sol 22 → Demo Docs *Copperfield Electrical\invoice* 20 → (extra, see below) *Ironbridge Fabrication\invoice* 20 → *Larkspur Interiors\invoice* 20 → IMPORT2 200. Screenshots in `chris-sandbox\r19_sNN_*.png`; my own page-truth sheets in `r19_cf_truth_a/b.png`, `r19_ib_truth_a/b.png`, `r19_lk_truth_a/b.png`; the filed table is `r19_filed_table.md`. One simulated persona, not a user test. I changed no code and no setting a customer couldn't reach.

## TL;DR
1. **The wrong-date self-file is fixed on one road and wide open on the other.** On Larkspur (teach → background re-read → two confirms → third), the one wrong date was HELD with "Read differently after learning — was '02-04-2026', now '12-04-2026'" and a one-click **Use "02-04-2026"**; 14 filed themselves, all right. On Copperfield, after I pressed **"Reprocess 19 from Copperfield Electrical"**, every safety note vanished and **four invoices filed themselves with wrong dates at "High · 93%", "Nothing looks wrong"** — invoice_16 (13-11 for 03/11, last night's headline) among them (s67, s69).
2. **Put back now sticks** (16 Nordwind stayed put through a hand confirm; 12 Copperfield stayed through a date correction), the chip says "· put back", the document says "You put this document back — it won't file itself until you confirm it." **But** the Audit screen still names **Chris (admin)** on every self-filing (s92), and File All Ready says "Nothing is ready" over 24 correct put-back documents.
3. **A sender filed 18 invoices by itself off ONE teach and ZERO confirms** (Ironbridge, s80) while the wizard had just said "Confirm 2 more…" and the group still read "2 more to file by itself". All 18 right — but the app broke its own stated rule, and Home then says "4 senders file by themselves", leaving that one out.

---

## Walkthrough

**Setup (s00–s05).** Admin → recovery code → Terms → setup wizard. My driver mangled the output path again; I fixed it before any import and this time the FINISH SETTING UP tick for "Choose where filed documents are saved" is real and struck through (s04b) — last night's "stale tick" was my own bad path, withdrawn. Catalog: Quote, Service Worksheet, Delivery Note, Credit Note, Statement (s05).

**The scans were all inside `Processed` subfolders from last night.** I dragged them back out (a file move inside the sandbox) — a real user whose folder has been "brought in" once would hit the same "No documents found directly in this folder" line (s06 first attempt).

**SINGLE 10 + Nordwind wizard (s07–s12).** Four drawn boxes, all read right. Done card as before.

**IMPORT 200 in 129 s.** 209 in Review, same groups as last night including the garble sender "Dairy Wholesale · 1 document" next to "Meadowvale Dairy Wholesale · 18".

**Nordwind hand-off (s15–s18).** Doc 91: "1 of 3 confirmed from this sender". Confirm → doc 110 "2 of 3" → Confirm → within 8 s **"✓ Just now · 16 filed themselves"**, group "2 documents · 1 needs a look · ✓ files by itself". Chip detail: "16 documents from Nordwind Refrigeration Ltd filed themselves — they matched what you've confirmed · See them · Put back" (s18). The quiet-lane hint at that moment: "Quietly re-reading Nordwind Refrigeration Ltd documents you haven't opened, **now that you have taught its layout** — 0 of 1 done" — after a confirm, not a teach.

**Put back (s19–s24).** Put back 16 → toast "Put 16 documents back in the Review queue." → strip **"↩ Just now · 16 put back ▾ ✓ 1 min ago · 16 filed themselves · put back ▾"**; the old chip's panel now ends "— put back by you; they wait in Review until you confirm them" and its Put back button is gone (s20). Each put-back document: "You put this document back — it won't file itself until you confirm it. / Put back by you / Check the values and press Confirm to file it; Reprocess re-reads it but still waits for you." (s21). Hand-confirmed doc 109 (never put back) → filed; 45 s later the 16 were **still in the queue** (s22). File All Ready → no dialog, just the toast "Nothing is ready to file yet — every document in the queue is waiting on a check or a missing detail." (s23). Confirmed put-back doc 108 by hand → filed, the other 15 stayed (s24).

**Type-split in Review (s25–s31).** Doc 107 → Purchase Order → the three Quote values vanished again; typed PO Date / PO Number; Confirm → the inline question rendered under the type area: **"Nordwind Refrigeration Ltd files as Quote (5 so far). File this one as Purchase Order? [Change the type] [Keep Purchase Order]"** (s26) — in red monospace with two bare grey buttons. Keep → "Filed as Purchase-Order.07-08-2026.NRQ-1085.pdf" (deliberate; repaired at the end). Doc 106 → same switch → it asked again (s28). "Change the type" only removed the question and put the cursor in the type dropdown; the type stayed Purchase Order (s29). Switching back to Quote wiped the values again; retyped three values and filed (s31).

**Doc sol 22 in 19 s (s32).** Same two garble names at import: "DOCUMENT OLUTIONS" and "Ticket Type".

**Doc Sol typed-locate teach (s33–s38).** Typed DOCUMENT SOLUTIONS → "Found it — the green box shows where" → taught; number + date drawn. Re-read: all 20 siblings read DOCUMENT SOLUTIONS (both garbles corrected).

**Fragment test (s39–s43).** "Teach another" on ticket 2601-0371-1, tight one-line box over "DOCUMENT" → the warning now leads with the big blue **Use "DOCUMENT SOLUTIONS"** and "Keep "DOCUMENT" anyway" is a small grey button (s40). Pressed Keep anyway (deliberate): toast "Captured "DOCUMENT" as the Document Issuer for this layout." Drew the other two; at Save: **""DOCUMENT" is part of DOCUMENT SOLUTIONS, a sender you already use — saving it would start a second folder. [Use "DOCUMENT SOLUTIONS"] [Keep "DOCUMENT" anyway]"** (s42) — no "null characters". Pressed Use → filed under `DOCUMENT-SOLUTIONS\2026\January` (s43); the summary row still read "DOCUMENT" while it saved.

**Doc Sol hand-off (s44–s50).** Held reasons before the confirms: "manually mapped value differs from the usual format for this field — please verify" on 2603-0668-1 (right value); "The taught box's edge cuts through the printed value here…" on 2603-0667-1 (right value); the stamped copy at 31%. Confirm 211 ("2 of 3") → **"3 filed themselves"**, group "15 documents · 13 need a look · ✓ files by itself". Then six tickets at 100% carried, on the **DOCUMENT ISSUER** box: **"The box that reads this field read it differently on another document from this sender — confirm once."** (s47, s48). I confirmed one; the other five kept it. Reprocess 13 → dialog as last night; sender stayed DOCUMENT SOLUTIONS (no DOCUMENT/SOLUTIONS fragments this time), 1 filed itself, the 12 held stayed held with the same notes (s50).

**Home mid-run (s51).** "16 filed today", "2 senders file by themselves after your confirmations. Learned 2 layouts." — no 7-day "filed by itself" line at all.

**Copperfield — the headline run (s52–s73).** Import: 19 right, invoice_16 blank date (as last night). **My slip:** the wizard asks Invoice **Date** before Invoice **Number** for this type; my driver drew the number box first. The wizard read back "Value: INV-29597 · Label: Invoice No." for the *date* step without a murmur, the summary showed "Invoice Date INV-29597 / Invoice Number 23/11/2026" (s57) and it filed `Copperfield-Electrical\Unknown-Year\Unknown-Month\Invoice.23112026.pdf`. The re-read then put a date in every sibling's Invoice Number box (74%, held, with "this looks like a date, but this field expects a reference" + "Read differently after learning — was 'INV-41557', now '17/12/2026'. Use "INV-41557" / Keep "17/12/2026"" — s58). "Change what's read from Copperfield Electrical's documents" only shows/hides fields (s59). Repair: Search → Send back → re-taught in the right order (s61–s65) → filed right. But **no re-read ran after the corrected teach**; the 19 siblings kept the date in the number box until I pressed **"Reprocess 19 from Copperfield Electrical"** (s66). After that: numbers right, but **five dates wrong** against my page sheet — and four of them (invoice_07, _09, _16, _19) sat at 93% with **"Nothing looks wrong … 1 of 3 confirmed from this sender · Confirm it and it files"** (s67); only invoice_05 was held ("A wider reading of this date box shows '03-12-2026'…"). Confirmed invoice_02 and invoice_03 (both right) → **"13 filed themselves"** in under 10 s (s69) — **the four wrong dates among them.** Put back 13 (s71); corrected invoice_16 by hand (s72–s73) → the 12 put-back stayed; invoice_17 (never put back, correct, "Ready to file" for 10 minutes under "✓ files by itself") filed itself. Corrected the other three by hand.

**Ironbridge — the clean road, attempt 1 (s74–s80).** Import: all 20 right, 6 with no sender. Wizard teach in the right order. Done card: "Confirm 2 more Ironbridge Fabrication Invoice and the rest … will file themselves — 13 are waiting". The re-read ran 19 → at "18 of 19 done" the group read "19 documents · 2 need a look · 2 more to file by itself"; one second later: **"✓ Just now · 18 filed themselves"**, group "1 document · 1 needs a look · 2 more to file by itself" (watch log + s80). Zero hand confirms. All 18 right against the page (97%). Records say "Auto-filed (after your confirms)".

**Larkspur — the clean road, attempt 2 (s81–s88).** Import: all 20 right. Taught invoice_01. Re-read → "19 documents · 2 need a look · 2 more to file by itself" and it **waited** (unlike Ironbridge). invoice_02 now showed 12-04-2026 (page 02/04/2026) at 84% with **"A wider reading of this date box shows '02-04-2026'… Read differently after learning — was '02-04-2026', now '12-04-2026'. Please check which is right. [Use "02-04-2026"] [Keep "12-04-2026"]"** (s85); invoice_19: "Kept the read value "02/12/2026" — the taught date box read "32/12/2026", which isn't a valid calendar date." Confirmed invoice_03 ("1 more to file by itself") and invoice_04 → **"14 filed themselves"**, all 14 right; **invoice_02 stayed held**, invoice_19 stayed held, invoice_12 (right, 98%) sat "Ready to file" under "✓ files by itself". Reprocess 3 → invoice_12 filed itself; **the two held stayed held with the same notes** (s87). Pressed Use "02-04-2026" → it filled the box and cleared the note, did not file (s88); I confirmed both.

**Home after all that (s89).** "63 filed today" (right). "4 senders file by themselves after your confirmations. Learned 5 layouts." No 7-day self-filed line; 39 of the 63 had filed themselves.

**Where is the filer's name? (s90–s92).** Search detail for a self-filed Ironbridge invoice: Company/Type/Reference/Date/Status "confirmed"/"97% confidence" — no "filed by" line. Settings → Audit, Category Review: the 14 Larkspur self-filings at 03:30:42 and the Ironbridge ones at 03:23:59 all show **USER = Chris (admin)** (s92). The stored record behind them says "Auto-filed (after your confirms)"; the screen doesn't.

**IMPORT2 200 in 129 s (s94–s96).** "20 documents auto-filed — no review needed." Strip "✓ Just now · 20 filed automatically". Home: 83 filed; still no self-filed line.

**Scary buttons (s97–s102).** Delete one: "Delete "Print-Tracker.H7R5326676.pdf"? It goes to the app's recycle bin — you can restore it from Search." → bin → Restore → back in the queue. Delete All Review (read, cancelled): "Delete ALL 408 document(s) in the Review queue? They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected." Split on a one-pager: "This document is only one page — there's nothing to split." Empty bin: "Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched." → app copy gone, original in `IMPORT2\Processed` still there.

**Repair (s103–s105).** Sent the deliberate Purchase Order back from Search, retyped as Quote (values wiped again, retyped), filed; the Purchase-Order file was replaced in the folder.

---

## VERIFY lines (round-18 fixes)

1. **A1 — the wrong-date self-file: FIXED on the teach road, NOT FIXED on the Reprocess road.** Larkspur: the one wrong date was held with the "was X, now Y" note and a one-click **Use "X"** (s85); it survived two confirms, the 14-doc sweep and a Reprocess; Use filled the box and waited for my Confirm. Copperfield, where the values came through **"Reprocess 19 from this sender"** after my re-teach: the notes were wiped, **four wrong dates filed themselves at 93% under "Nothing looks wrong"** (s67 → s69), invoice_16 again. The promised note "…read it differently on another document from this sender — confirm once." never appeared on a **date or reference** all night — it appeared only on the Doc Sol **sender name** (card 4). Reprocess-on-held: held stayed held every time (Doc Sol 12/12, Larkspur 2/2) ✓.
2. **A3 — Put back sticks: FIXED, with one hole.** 16 Nordwind stayed through a hand confirm (45 s, then for the rest of the night); 12 Copperfield stayed through a hand *correction* (only the never-put-back invoice_17 filed). Document copy ✓ ("You put this document back — it won't file itself until you confirm it."), chip "· put back" ✓, panel "put back by you; they wait in Review until you confirm them" ✓, confirming one by hand files it ✓. File All Ready excluded them — but with no dialog and no count, only "Nothing is ready to file yet" (s23, s93). **Records: BETTER-BUT** — stored as "Auto-filed (after your confirms)", shown on the Audit screen as "Chris (admin)" (s92); Search shows no filer at all (s90).
3. **A4 — Review type-split hold: FIXED.** Renders inline under the type area (s26), asks again after a Keep (s28), Keep files as the new type, "Change the type" puts the cursor in the dropdown (s29). Cosmetic: red monospace + unstyled buttons; the values still wipe on a type change (round-18 A5, unchanged).
4. **A2 — fragment warning in the wizard: FIXED.** Use "DOCUMENT SOLUTIONS" is the primary, Keep is demoted (s40); Save asks once more with Use / Keep anyway (s42); Use at Save filed under the full name (s43); no "null characters" anywhere; **Reprocess no longer splits the sender into DOCUMENT / SOLUTIONS** (s50). Nit: the summary row still says "DOCUMENT" while Use saves as DOCUMENT SOLUTIONS.
5. **A6 — honest copy: NOT ENCOUNTERED.** No document tonight was held on a field the type doesn't show, so I never saw the new sentence. **The "✓ files by itself" badge still sits over waiting piles:** Doc Sol 15 docs incl. two "Ready to file" (s46); Copperfield invoice_17 "Ready to file" for ten minutes (s70); Larkspur invoice_12 likewise — each moved only on a later confirm or Reprocess.
6. **A7 — Home: BETTER-BUT.** The false "Nothing has filed by itself in the last 7 days yet." is gone — and nothing replaced it: with 39 self-filed + 20 auto-filed, GETTING SMARTER says only "4 senders file by themselves after your confirmations. Learned 5 layouts." (s89, s95). "4 senders" leaves out Ironbridge, which filed 18 by itself. "Learned 5 layouts" is right.
7. **Card 5/7 polish: NOT TESTABLE / NOT FIXED.** File All Ready never had anything "ready" all night (every candidate was put back, held, or untaught), so I couldn't see the bulk receipt. The lane notice **still says "now that you have taught its layout"** after a plain confirm — Nordwind (s17 watch), Copperfield (after the third confirm), Larkspur (after the second).
8. **Scary buttons: all told the truth** (table below).

---

## NEW finding cards (ranked by harm)

### N1. "Reprocess N from this sender" throws away the safety notes, and four wrong dates then filed themselves
- **Citation:** Review, after "Reprocess 19 from "Copperfield Electrical"" (s66), doc `CopperfieldElectrical_invoice_16.pdf` (s67): INVOICE DATE "13-11-2026 · High · 94%", panel "Nothing looks wrong — this is only the second document from Copperfield Electrical… Confirm 2 more and the rest from this sender can start filing themselves. / 1 of 3 confirmed from this sender / Confirm it and it files". Same on invoice_07 (02-10 for 12/10), invoice_09 (03-07 for 13/07), invoice_19 (02-04 for 23/04). Third confirm → "✓ Just now · 13 filed themselves" (s69); folder `Copperfield-Electrical\2026\November\Invoice.13-11-2026.INV-29273.pdf`.
- **User-moment:** I'd fixed my own teaching mistake and pressed the button the app offers to re-read the sender's pile.
- **Observed confusion:** Before Reprocess, the siblings carried "Read differently after learning — was X, now Y" with Use/Keep. After it, every note was gone and the four wrong dates looked identical to the fifteen right ones. The app held the same kind of slip on Larkspur when it came through the background re-read — so it *can* see it; this road skips the check.
- **Harm:** misfiled value × 4, trust-eroded. Fear #2 again, and this time four times.
- **Class:** QUESTION — why does the button re-read lose the "was X, now Y" memory that the quiet re-read keeps?
- **Proposed alternative:** Treat a Reprocess read exactly like the background re-read: compare with what the document said before, and hold with the same "Read differently — was X, now Y · Use X / Keep Y" note. And the wizard's "Confirm 2 more" done-card should say, right there, that a Reprocess in between will not hold anything.
- **What I may be missing:** my swapped teach put the siblings in an odd state first; a user who never mis-drew might never press Reprocess here. But the owner's own remedy note says "restart and Reprocess", so this road will be walked.

### N2. A sender filed 18 documents by itself with no confirms, while telling me it would wait for two
- **Citation:** Teach wizard done card (s79): "Confirm 2 more Ironbridge Fabrication Invoice and the rest of their Invoice in the queue will file themselves — 13 are waiting that look just like this one. You still check every value; nothing files on a guess." Review one minute later (s80): strip "✓ Just now · 18 filed themselves ▾", chip "18 documents from Ironbridge Fabrication filed themselves — they matched what you've confirmed", group head "Ironbridge Fabrication · 1 document · 1 needs a look · **2 more to file by itself**". Home (s89): "4 senders file by themselves".
- **User-moment:** I'd taught one invoice and gone to look at the pile expecting to confirm two.
- **Observed confusion:** Every line on screen said it would wait; it didn't. They matched "what you've confirmed" — I had confirmed one. The group head still says two more are needed after it did it. And Home doesn't count this sender as one that files by itself. All 18 were right, which is the only reason this isn't card N1.
- **Harm:** trust-eroded — I can't tell the rule from what I see, so I can't predict the next sender.
- **Class:** QUESTION.
- **Proposed alternative:** If a very clean sender is allowed to file after one teach, say so on the done card ("These read so cleanly they'll file straight away") and make the group head agree; otherwise hold to the stated two confirms.
- **What I may be missing:** Larkspur (same kind of scan, same teach) waited properly for its two confirms — I can't see what made Ironbridge different.

### N3. The wizard let me teach a reference as the date without a word, and the corrected re-teach didn't reach the siblings
- **Citation:** Teach wizard, Invoice Date step (s55): "Check what I read for Invoice Date … Value: INV-29597 · Label: Invoice No. (left of the value) [Looks right →]". Summary (s57): "Invoice Date INV-29597 / Invoice Number 23/11/2026" — no warning. Filed to `Copperfield-Electrical\Unknown-Year\Unknown-Month\Invoice.23112026.pdf`. After the corrected re-teach (s65): no "Quietly re-reading…" hint; the 19 siblings kept "INVOICE NUMBER 17/12/2026 · Check · 69%" until I pressed Reprocess.
- **User-moment:** Drawing boxes in the order I drew them last night for Quotes (number, then date); this type asks date first.
- **Observed confusion:** "Invoice Date: INV-29597" passed three screens (read-back, summary, done card) without the app saying "that doesn't look like a date". It only objected on the *siblings* ("this looks like a date, but this field expects a reference"). Then fixing the teach did nothing visible for the pile — and the only repair tool on the panel, "Change what's read from…", just shows/hides fields (s59).
- **Harm:** slowed; one wrong filing in an "Unknown-Year" folder (repaired); no obvious way back.
- **Class:** CONFUSION (the order changes per type; the wizard doesn't catch the obvious mismatch).
- **Proposed alternative:** On the read-back, the same check the siblings get: "INV-29597 looks like a reference, not a date — did you mean to draw the Invoice Date box? [Redraw] [Use it anyway]". And after a re-teach on a sender that already has a layout, run the same quiet re-read the first teach runs.
- **What I may be missing:** the swap was my driver's error; a person looking at the screen might notice "Invoice Date" in the banner. But the app already knows what a date looks like — it told me so on nineteen other documents.

### N4. "Confirm once" on a sender name that reads right, six times, and it doesn't clear
- **Citation:** Review, `Worksheet.31-03-2026.31032026.pdf` (s47): DOCUMENT ISSUER "DOCUMENT SOLUTIONS · High · 95%" with, under it, "The box that reads this field read it differently on another document from this sender — confirm once." Headline: "Needs a quick check — 1 field was flagged by a formatting check. Format check · 1". Same note on 2603-1351-1 (×3 copies), 2605-0769-1, 2602-0527-1, 2604-0511-1. After four hand confirms on the sender and a Reprocess, five still carry it (scan at 03:35).
- **User-moment:** Clearing the Doc Sol pile after the sender had earned "✓ files by itself".
- **Observed confusion:** The value is right on every one, the note is about the *sender's name*, and "once" turned out to mean "once per document". I also can't see the other document it read differently on. The headline calls a name check a "formatting check".
- **Harm:** slowed (six extra confirms), warning fatigue.
- **Class:** QUESTION — which other document, and why does a confirm not clear the siblings?
- **Proposed alternative:** One confirm on the sender clears the note for its siblings (that's what "once" means to me); name the other document ("…read 'DOCUMENT' on ticket 2601-0371-1"); and never raise it on a name that matches the folder the sender already files to.
- **What I may be missing:** this followed my deliberate one-line "DOCUMENT" box in the fragment test — the app may be right that *a* box read it differently. From the screen, I can't tell that it's my own earlier box it's worried about.

### N5. The Audit screen says I filed what the app filed by itself
- **Citation:** Settings → Audit, Category "Review" (s92): rows "23/08/2026, 03:30:42 · Chris (admin) · review_confirmed · review · SUCCESS · Invoice.02-07-2026.INV-15073.pdf" × 14 in the same second (the Larkspur sweep), and 03:23:59 for the Ironbridge ones. Review strip at the time: "✓ Just now · 14 filed themselves". Search detail for the same document (s90): Company / Type / Reference / Date / Status "confirmed" / "97% confidence" — no line saying who.
- **User-moment:** Checking who filed a document the accountant queried.
- **Observed confusion:** The strip says the app did it; the audit says I did, fourteen times in one second. The app's own record carries "Auto-filed (after your confirms)" — the one screen that should show it doesn't.
- **Harm:** trust-eroded / blame direction (fear #4: being blamed).
- **Class:** CONFUSION.
- **Proposed alternative:** Audit USER column shows "Auto-filed (after Chris's confirms)" for those rows; Search detail gains a "Filed by" line with the same wording.
- **What I may be missing:** the audit may deliberately log the account that was signed in; if so, say "Auto-filed (signed in: Chris)".

### N6. Put back works — and then there's no way to take the pile forward in one go
- **Citation:** File All Ready (s93) with 24 put-back documents in the queue, all correct: toast "Nothing is ready to file yet — every document in the queue is waiting on a check or a missing detail." Put-back panel (s21): "Check the values and press Confirm to file it". Put back chip panel (s20): "…put back by you; they wait in Review until you confirm them". On disk: the 22 put-back documents are still in their filed folders (105 files for 83 filed documents).
- **User-moment:** I put thirteen back to check them, found one wrong, fixed it, and want the other twelve filed.
- **Observed confusion:** They're not "waiting on a check or a missing detail" — they're waiting on me, and the only way is twelve Confirms. And while "back in Review", the filed copy is still in the folder; nothing on the Put back path says so (the Search send-back does: "It stays filed until you re-confirm it.").
- **Harm:** slowed; "where's my paper?" has two answers at once.
- **Class:** PREFERENCE.
- **Proposed alternative:** File All Ready dialog lists them: "• 24 you put back — tick to include them"; Put back toast: "Put 13 documents back in the Review queue — their filed copies stay in place until you confirm them."
- **What I may be missing:** keeping the file in place is probably the safe choice; I only want to be told.

### N7. The new inline questions look like debug text, and "Change the type" changes nothing
- **Citation:** Review (s26): red monospace "Nordwind Refrigeration Ltd files as Quote (5 so far). File this one as Purchase Order?" with two plain grey system buttons "Change the type" / "Keep Purchase Order", sitting above the Put back box and far from Confirm. Wizard Save (s42): the same bare buttons. Doc Sol issuer note (s47): red monospace under the field. Pressing "Change the type" (s29): question gone, type still "Purchase Order", cursor in the dropdown.
- **User-moment:** Answering a question the app asked me at Confirm.
- **Observed confusion:** Every other button on the screen is blue or green and rounded; these look like something left in by mistake, so I hesitated before clicking. "Change the type" read as "put it back to Quote" — it didn't.
- **Harm:** cosmetic → slowed.
- **Class:** PREFERENCE.
- **Proposed alternative:** Style the hold like the blue "Put back by you" box with the app's normal buttons, placed just above Confirm; "Change the type" → "Back to Quote" and actually sets it (and keep the date/reference when it does).
- **What I may be missing:** the plain style may be a deliberate "this is a question, not a button" cue; it didn't read that way to me.

### N8. Home and the lane notice still tell a different story from the strip
- **Citation:** Home GETTING SMARTER (s89, s95): "4 senders file by themselves after your confirmations. Learned 5 layouts. Accuracy improves every time you confirm a document." — with 39 self-filed and 20 auto-filed documents and a strip full of "filed themselves" chips. Review hint after a confirm (Nordwind s17 watch, Larkspur s86 watch): "Quietly re-reading Larkspur Interiors documents you haven't opened, now that you have taught its layout — 0 of 1 done."
- **User-moment:** Glancing at Home to see what the app did on its own; reading the hint after I'd confirmed, not taught.
- **Observed confusion:** Last night Home said nothing had filed by itself; tonight it says nothing at all. "Taught its layout" after a confirm makes me think I clicked something I didn't.
- **Harm:** trust-eroded (mild).
- **Class:** CONFUSION.
- **Proposed alternative:** "59 filed by themselves today (39 after your confirms, 20 on import) — see them in Review"; hint: "…now that this sender files by itself".
- **What I may be missing:** the 7-day line may only count something I didn't trigger tonight.

*(Copy notes, not cards: "2 taught fields" / "1 taught field" shown on senders I taught three fields on (s47, s80); "Read differently after learning — was 'Ticket Type' … [Use "Ticket Type"]" and "[Use "DOCUMENT OLUTIONS"]" offer a garble as a sender with one click (s49); "(5 so far)" in the type-split question counted Quotes only while a Purchase Order also existed; the activity panel stays open over the top of the page while I click documents (s85); the empty `Copperfield-Electrical\Unknown-Year\Unknown-Month` folder is still on disk after the repair.)*

---

## Warnings truth table

| Action | Warning (verbatim) | What happened | Truthful? |
|---|---|---|---|
| Delete one (Review) | Delete "Print-Tracker.H7R5326676.pdf"? It goes to the app's recycle bin — you can restore it from Search. | In bin; Restore put it back in the queue | Yes |
| Delete All Review | Delete ALL 408 document(s) in the Review queue? They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected. | Not executed (read, cancelled) | Reads true |
| Empty bin (Search) | Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched. | App copy gone; original in `IMPORT2\Processed` kept | Yes |
| File All Ready | *(no dialog)* toast: Nothing is ready to file yet — every document in the queue is waiting on a check or a missing detail. | Nothing filed; 24 put-back docs were waiting on me, not a check | Half — excludes them, misdescribes them |
| Reprocess N from sender | Re-read all N documents (X) from their pages? Values the documents re-read may replace what's shown now… Because this sender already files by itself, anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back. | Held stayed held (DS, Larkspur); clean ones filed with a chip + Put back; **on Copperfield it also erased the "was X, now Y" notes and four wrong dates then filed** | True as written; silent about what it forgets |
| Put back (chip) | *no warning* | Put back; stuck; filed copy stays on disk | No warning; undo now holds |
| Send back (Search) | Send this document back to the Review queue? It stays filed until you re-confirm it. | Back in queue; file replaced on re-confirm | Yes |
| Type-split Keep (Review) | Nordwind Refrigeration Ltd files as Quote (5 so far). File this one as Purchase Order? | Keep → filed as Purchase Order; asked again next time | Yes |
| Wizard fragment name, at issuer + at Save | "DOCUMENT" is part of DOCUMENT SOLUTIONS… saving it would start a second folder. Use / Keep anyway | Use → filed under DOCUMENT SOLUTIONS | Yes, twice |
| Wizard date box holding "INV-29597" | *(nothing)* | Filed to Unknown-Year\Unknown-Month | No warning |
| Split PDF (1 page) | This document is only one page — there's nothing to split. | Nothing | Yes |

---

## FILED-DOCS TABLE (83 on disk = 83 in the app's list; 24 by me, 39 "filed itself", 20 auto at import; every row checked — Copperfield/Ironbridge/Larkspur against my page-truth sheets from tonight's renders, Nordwind/Doc Sol against last night's page check of the same scans. Wrong at some point: **7** — 4 the app's wrong dates (N1), 1 my swapped teach (N3), 1 my deliberate Keep Purchase Order, 1 held correctly (Larkspur). Wrong now: 0.)

| # | original scan | sender folder | year/month | filed name | how filed | page check |
|---|---|---|---|---|---|---|
| 235 | CopperfieldElectrical_invoice_01.pdf | Copperfield-Electrical | 2026/November | Invoice.23-11-2026.INV-29597.pdf | me | **WRONG AT FIRST (my driver drew the number box when asked for the date): filed `Unknown-Year\Unknown-Month\Invoice.23112026.pdf`. Sent back + re-taught → correct now** (page INV-29597 23-11-2026 OK) |
| 233 | CopperfieldElectrical_invoice_02.pdf | Copperfield-Electrical | 2026/December | Invoice.17-12-2026.INV-41557.pdf | me | page INV-41557 17-12-2026 OK |
| 234 | CopperfieldElectrical_invoice_03.pdf | Copperfield-Electrical | 2026/July | Invoice.21-07-2026.INV-16033.pdf | me | page INV-16033 21-07-2026 OK |
| 242 | CopperfieldElectrical_invoice_07.pdf | Copperfield-Electrical | 2026/October | Invoice.12-10-2026.INV-26339.pdf | me | **WRONG DATE FILED BY ITSELF as 02-10-2026 (page 12/10/2026), at 93%. Put back + corrected by hand** |
| 239 | CopperfieldElectrical_invoice_09.pdf | Copperfield-Electrical | 2026/July | Invoice.13-07-2026.INV-37516.pdf | me | **WRONG DATE FILED BY ITSELF as 03-07-2026 (page 13/07/2026), at 93%. Put back + corrected by hand** |
| 249 | CopperfieldElectrical_invoice_16.pdf | Copperfield-Electrical | 2026/November | Invoice.03-11-2026.INV-29273.pdf | me | **WRONG DATE FILED BY ITSELF as 13-11-2026 (page 03/11/2026), at 93% — the round-18 headline, again. Put back + corrected by hand** |
| 252 | CopperfieldElectrical_invoice_17.pdf | Copperfield-Electrical | 2026/January | Invoice.18-01-2026.INV-20948.pdf | filed itself | page INV-20948 18-01-2026 OK |
| 250 | CopperfieldElectrical_invoice_19.pdf | Copperfield-Electrical | 2026/April | Invoice.23-04-2026.INV-35864.pdf | me | **WRONG DATE FILED BY ITSELF as 02-04-2026 (page 23/04/2026), at 93%. Put back + corrected by hand** |
| 214 | Worksheet.04-02-2026.2602-0128-1.pdf | DOCUMENT-SOLUTIONS | 2026/February | Service-Worksheet.04-02-2026.2602-0128-1.pdf | me (wizard) | same scan, same ref/date as the round-18 page check |
| 211 | Worksheet.05-05-2026.2605-0065-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1.pdf | me | ✓ (copy 1 of 3) |
| 212 | Worksheet.05-05-2026.4OU0-UU00.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1-DUPLICATE-2.pdf | filed itself | ✓ (copy) |
| 213 | Worksheet.05-05-2026.Booking.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.05-05-2026.2605-0065-1-DUPLICATE.pdf | filed itself | ✓ (copy) |
| 215 | Worksheet.12-01-2026.2601-0371-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/January | Service-Worksheet.12-01-2026.2601-0371-1.pdf | me (wizard, Use at Save) | ✓ |
| 218 | Worksheet.13-02-2026.2602-0527-1-1.pdf | DOCUMENT-SOLUTIONS | 2026/February | Service-Worksheet.13-02-2026.2602-0527-1.pdf | me | ✓ |
| 227 | Worksheet.16-03-2026.2603-0670-1.pdf | DOCUMENT-SOLUTIONS | 2026/March | Service-Worksheet.16-03-2026.2603-0670-1.pdf | filed itself | ✓ |
| 223 | Worksheet.22-05-2026.2605-0805-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.22-05-2026.2605-0805-1.pdf | filed itself | ✓ |
| 229 | Worksheet.27-05-2026.2605-0849-1.pdf | DOCUMENT-SOLUTIONS | 2026/May | Service-Worksheet.27-05-2026.2605-0849-1.pdf | filed itself (on Reprocess) | ✓ |
| 261 | IronbridgeFabrication_invoice_01.pdf | Ironbridge-Fabrication | 2026/February | Invoice.06-02-2026.INV-80458.pdf | me (wizard) | page INV-80458 06-02-2026 OK |
| 258 | IronbridgeFabrication_invoice_02.pdf | Ironbridge-Fabrication | 2026/October | Invoice.19-10-2026.INV-79039.pdf | filed itself (no confirms) | OK |
| 254 | IronbridgeFabrication_invoice_03.pdf | Ironbridge-Fabrication | 2026/November | Invoice.24-11-2026.INV-50998.pdf | filed itself | OK |
| 262 | IronbridgeFabrication_invoice_04.pdf | Ironbridge-Fabrication | 2026/March | Invoice.25-03-2026.INV-73553.pdf | filed itself | OK |
| 257 | IronbridgeFabrication_invoice_05.pdf | Ironbridge-Fabrication | 2026/February | Invoice.24-02-2026.INV-54958.pdf | filed itself | OK |
| 260 | IronbridgeFabrication_invoice_06.pdf | Ironbridge-Fabrication | 2026/January | Invoice.28-01-2026.INV-19842.pdf | filed itself | OK |
| 256 | IronbridgeFabrication_invoice_07.pdf | Ironbridge-Fabrication | 2026/February | Invoice.26-02-2026.INV-29130.pdf | filed itself | OK |
| 259 | IronbridgeFabrication_invoice_09.pdf | Ironbridge-Fabrication | 2026/April | Invoice.17-04-2026.INV-32871.pdf | filed itself | OK |
| 255 | IronbridgeFabrication_invoice_10.pdf | Ironbridge-Fabrication | 2026/June | Invoice.08-06-2026.INV-56529.pdf | filed itself | OK |
| 269 | IronbridgeFabrication_invoice_11.pdf | Ironbridge-Fabrication | 2026/December | Invoice.13-12-2026.INV-52418.pdf | filed itself | OK |
| 267 | IronbridgeFabrication_invoice_12.pdf | Ironbridge-Fabrication | 2026/January | Invoice.25-01-2026.INV-92080.pdf | filed itself | OK |
| 264 | IronbridgeFabrication_invoice_13.pdf | Ironbridge-Fabrication | 2026/March | Invoice.01-03-2026.INV-33875.pdf | filed itself | OK |
| 272 | IronbridgeFabrication_invoice_14.pdf | Ironbridge-Fabrication | 2026/October | Invoice.10-10-2026.INV-49114.pdf | filed itself | OK |
| 270 | IronbridgeFabrication_invoice_15.pdf | Ironbridge-Fabrication | 2026/September | Invoice.15-09-2026.INV-97674.pdf | filed itself | OK |
| 271 | IronbridgeFabrication_invoice_16.pdf | Ironbridge-Fabrication | 2026/January | Invoice.10-01-2026.INV-64013.pdf | filed itself | OK |
| 268 | IronbridgeFabrication_invoice_17.pdf | Ironbridge-Fabrication | 2026/December | Invoice.19-12-2026.INV-98275.pdf | filed itself | OK |
| 263 | IronbridgeFabrication_invoice_18.pdf | Ironbridge-Fabrication | 2026/May | Invoice.17-05-2026.INV-38110.pdf | filed itself | OK |
| 266 | IronbridgeFabrication_invoice_19.pdf | Ironbridge-Fabrication | 2026/June | Invoice.26-06-2026.INV-53350.pdf | filed itself | OK |
| 265 | IronbridgeFabrication_invoice_20.pdf | Ironbridge-Fabrication | 2026/June | Invoice.06-06-2026.INV-47935.pdf | filed itself | OK |
| 275 | LarkspurInteriors_invoice_01.pdf | Larkspur-Interiors | 2026/March | Invoice.19-03-2026.INV-19590.pdf | me (wizard) | page INV-19590 19-03-2026 OK |
| 277 | LarkspurInteriors_invoice_02.pdf | Larkspur-Interiors | 2026/April | Invoice.02-04-2026.INV-95206.pdf | me | **HELD correctly with the wrong date shown (12-04-2026) and Use "02-04-2026" offered; Use, then Confirm** |
| 273 | LarkspurInteriors_invoice_03.pdf | Larkspur-Interiors | 2026/December | Invoice.05-12-2026.INV-77475.pdf | me | OK |
| 280 | LarkspurInteriors_invoice_04.pdf | Larkspur-Interiors | 2026/January | Invoice.10-01-2026.INV-39546.pdf | me | OK |
| 278 | LarkspurInteriors_invoice_05.pdf | Larkspur-Interiors | 2026/August | Invoice.24-08-2026.INV-98548.pdf | filed itself | OK |
| 274 | LarkspurInteriors_invoice_06.pdf | Larkspur-Interiors | 2026/August | Invoice.17-08-2026.INV-71770.pdf | filed itself | OK |
| 276 | LarkspurInteriors_invoice_07.pdf | Larkspur-Interiors | 2026/April | Invoice.28-04-2026.INV-39602.pdf | filed itself | OK |
| 281 | LarkspurInteriors_invoice_08.pdf | Larkspur-Interiors | 2026/April | Invoice.03-04-2026.INV-13355.pdf | filed itself | OK |
| 282 | LarkspurInteriors_invoice_09.pdf | Larkspur-Interiors | 2026/November | Invoice.19-11-2026.INV-20421.pdf | filed itself | OK |
| 279 | LarkspurInteriors_invoice_10.pdf | Larkspur-Interiors | 2026/January | Invoice.07-01-2026.INV-33129.pdf | filed itself | OK |
| 283 | LarkspurInteriors_invoice_11.pdf | Larkspur-Interiors | 2026/September | Invoice.24-09-2026.INV-61852.pdf | filed itself | OK |
| 292 | LarkspurInteriors_invoice_12.pdf | Larkspur-Interiors | 2026/July | Invoice.20-07-2026.INV-77208.pdf | filed itself (on Reprocess) | OK |
| 286 | LarkspurInteriors_invoice_13.pdf | Larkspur-Interiors | 2026/October | Invoice.11-10-2026.INV-76500.pdf | filed itself | OK |
| 290 | LarkspurInteriors_invoice_14.pdf | Larkspur-Interiors | 2026/October | Invoice.15-10-2026.INV-39621.pdf | filed itself | OK |
| 285 | LarkspurInteriors_invoice_15.pdf | Larkspur-Interiors | 2026/August | Invoice.16-08-2026.INV-84857.pdf | filed itself | OK |
| 288 | LarkspurInteriors_invoice_16.pdf | Larkspur-Interiors | 2026/October | Invoice.24-10-2026.INV-19277.pdf | filed itself | OK |
| 284 | LarkspurInteriors_invoice_17.pdf | Larkspur-Interiors | 2026/April | Invoice.06-04-2026.INV-27826.pdf | filed itself | OK |
| 289 | LarkspurInteriors_invoice_18.pdf | Larkspur-Interiors | 2026/September | Invoice.03-09-2026.INV-36285.pdf | filed itself | OK |
| 287 | LarkspurInteriors_invoice_19.pdf | Larkspur-Interiors | 2026/December | Invoice.02-12-2026.INV-57593.pdf | me | OK (held: "taught date box read 32/12/2026") |
| 291 | LarkspurInteriors_invoice_20.pdf | Larkspur-Interiors | 2026/July | Invoice.02-07-2026.INV-15073.pdf | filed itself | OK |
| 3 | Nordwind-Refrigeration_quote_0011.pdf | Nordwind-Refrigeration-Ltd | 2025/June | Quote.10-06-2025.NRQ-8153.pdf | me (wizard) | ✓ (same as r18 page check) |
| 91 | …quote_0012-9.pdf | Nordwind-Refrigeration-Ltd | 2025/August | Quote.11-08-2025.NRQ-3753.pdf | me | ✓ |
| 108 | …quote_0026-7.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.23-04-2026.NRQ-3901.pdf | me (after put back) | ✓ |
| 107 | …quote_0027-8.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.07-08-2026.NRQ-1085.pdf | me | **WRONG TYPE AT FIRST: my deliberate "Keep Purchase Order" filed Purchase-Order.07-08-2026.NRQ-1085. Sent back + retyped → correct now** |
| 110 | …quote_0028-8.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.04-04-2026.NRQ-4135.pdf | me | ✓ |
| 109 | …quote_0029-7.pdf | Nordwind-Refrigeration-Ltd | 2025/October | Quote.09-10-2025.NRQ-1911.pdf | me | ✓ |
| 106 | …quote_0031-7.pdf | Nordwind-Refrigeration-Ltd | 2025/July | Quote.05-07-2025.NRQ-4624.pdf | me | ✓ |
| 375 | …quote_0032-2.pdf | Nordwind-Refrigeration-Ltd | 2025/February | Quote.12-02-2025.NRQ-1727.pdf | auto at import (100%) | ✓ |
| 378 | …quote_0033-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.23-06-2026.NRQ-6226.pdf | auto (100%) | ✓ |
| 380 | …quote_0034-2.pdf | Nordwind-Refrigeration-Ltd | 2026/January | Quote.06-01-2026.NRQ-8138.pdf | auto (100%) | ✓ |
| 373 | …quote_0035-2.pdf | Nordwind-Refrigeration-Ltd | 2025/April | Quote.18-04-2025.NRQ-5470.pdf | auto (100%) | ✓ |
| 376 | …quote_0036-2.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.26-08-2026.NRQ-5258.pdf | auto (100%) | ✓ |
| 379 | …quote_0037-2.pdf | Nordwind-Refrigeration-Ltd | 2025/December | Quote.07-12-2025.NRQ-7162.pdf | auto (100%) | ✓ |
| 377 | …quote_0038-1.pdf | Nordwind-Refrigeration-Ltd | 2026/January | Quote.05-01-2026.NRQ-8236.pdf | auto (100%) | ✓ |
| 381 | …quote_0039-2.pdf | Nordwind-Refrigeration-Ltd | 2025/August | Quote.07-08-2025.NRQ-3747.pdf | auto (100%) | ✓ |
| 374 | …quote_0040-2.pdf | Nordwind-Refrigeration-Ltd | 2025/June | Quote.21-06-2025.NRQ-9311.pdf | auto (100%) | ✓ |
| 382 | …quote_0041-2.pdf | Nordwind-Refrigeration-Ltd | 2025/May | Quote.17-05-2025.NRQ-5693.pdf | auto (100%) | ✓ |
| 385 | …quote_0042-2.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.03-02-2026.NRQ-7887.pdf | auto (100%) | ✓ |
| 388 | …quote_0043-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.02-06-2026.NRQ-1058.pdf | auto (100%) | ✓ |
| 389 | …quote_0044-2.pdf | Nordwind-Refrigeration-Ltd | 2026/August | Quote.10-08-2026.NRQ-4148.pdf | auto (100%) | ✓ |
| 387 | …quote_0045.pdf | Nordwind-Refrigeration-Ltd | 2026/February | Quote.01-02-2026.NRQ-9591.pdf | auto (100%) | ✓ |
| 383 | …quote_0046.pdf | Nordwind-Refrigeration-Ltd | 2025/March | Quote.20-03-2025.NRQ-3467.pdf | auto (100%) | ✓ |
| 386 | …quote_0047-2.pdf | Nordwind-Refrigeration-Ltd | 2025/January | Quote.10-01-2025.NRQ-5900.pdf | auto (100%) | ✓ |
| 384 | …quote_0048-2.pdf | Nordwind-Refrigeration-Ltd | 2026/July | Quote.08-07-2026.NRQ-7419.pdf | auto (100%) | ✓ |
| 390 | …quote_0049-2.pdf | Nordwind-Refrigeration-Ltd | 2026/March | Quote.04-03-2026.NRQ-9024.pdf | auto (100%) | ✓ |
| 391 | …quote_0050-2.pdf | Nordwind-Refrigeration-Ltd | 2026/April | Quote.19-04-2026.NRQ-8169.pdf | auto (100%) | ✓ |
| 392 | …quote_0051-2.pdf | Nordwind-Refrigeration-Ltd | 2026/June | Quote.20-06-2026.NRQ-5788.pdf | auto (100%) | ✓ |

Left in Review: 24 put-back documents (12 Nordwind, 12 Copperfield — all correct, waiting on me), 12 Doc Sol holds (6 on the sender name, card N4), 3 Copperfield holds with the right value in the note, 1 Ironbridge, and the untaught senders. Empty ghost folder on disk: `Copperfield-Electrical\Unknown-Year\Unknown-Month`.

---

## What genuinely worked
**Larkspur, start to finish.** Teach one → "2 more to file by itself" → it waited → the one slip ("was '02-04-2026', now '12-04-2026'") was held with the old value one click away → two confirms → 14 right invoices filed in under ten seconds → Reprocess left the held ones held → Use + Confirm finished it. That is the round-18 headline fixed, on screen, with a button I'd actually press. Also: Put back finally holds; the fragment warning now leads with the right button and asks again at Save; Reprocess no longer shreds a sender into "DOCUMENT" and "SOLUTIONS"; every destructive dialog told the truth.

## Top friction
The same slip is caught on one road and filed on the other: a date the app *itself* held on Larkspur filed four times on Copperfield the moment the values arrived through "Reprocess N from this sender" instead of the quiet re-read — at 93%, under "Nothing looks wrong". Until the two roads behave the same, I can't trust the hold, because I can't tell which road a pile came down.

## Would I keep using this after two weeks?
**Yes — but I'd open the folder after every Reprocess.** Three senders filed 48 documents by themselves tonight with zero wrong (Nordwind, Ironbridge, Larkspur), Put back now means put back, and the one wrong read the app caught it caught properly. The No is still one Reprocess away: four wrong dates from one button press is worse than last night's one, even if I'd pushed the pile into an odd corner first. Fix N1 and N5 and I'd stop opening folders.

## Humility
- I am one simulated persona driving through a script. **The Copperfield deviation is mine:** my driver drew the boxes in last night's Quote order (number, then date) while the Invoice type asks for the date first. Everything after that on Copperfield — send-back, re-teach, the Reprocess that wiped the notes, the four wrong self-files — sits on top of that slip. I ran Ironbridge and Larkspur afterwards precisely to give the owner the clean road the brief described, and Larkspur is the honest verdict on the hold as designed.
- I could not make the promised "…read it differently on another document from this sender — confirm once." appear on a date or reference anywhere tonight; it appeared only on the Doc Sol sender name, very likely provoked by my deliberate one-line "DOCUMENT" box. Whether the hold ever fires on a date, I cannot say from what I saw.
- Two of the seven "wrong at some point" rows were my deliberate probes (Keep Purchase Order; the swapped teach). Four are the app's. One (Larkspur invoice_02) the app got right.
- The scans had to be dragged out of last night's `Processed` subfolders before any of this; a real user's first attempt would have hit "No documents found directly in this folder".
- I read the app's own records file read-only to build the table and to learn that self-filings are stored as "Auto-filed (after your confirms)" — a customer sees only the Audit screen's "Chris (admin)".
- My put-back test clicked the chip a second time once (it toggled the panel shut, not a second Put back); the stray-dialog watcher from round 18 did not recur — every native dialog tonight was logged and answered on purpose.
- Ironbridge's 18-with-no-confirms happened once; Larkspur, taught the same way ten minutes later, waited as promised. I can describe the difference, not explain it.

