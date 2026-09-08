# Chris The Customer — Full App Review — 2026-09-08 EVENING (comparison round vs 2026-09-03)

> **Round conditions:** fresh sandboxed instance (isolated userData seeded by `scripts/seed-chris-sandbox.js` — 0 users, migrations
> through 140 incl. the mig-137 dark-switch reset, mig-138 `ocr_dpi=200`, mig-139 import parallelism ON; copied Demo Docs, 15
> supplier folders), CDP port 9223 (app PID 3200), real PrintWindow screenshots, under the owner's safety contract (sandbox only, no
> code changes, findings queue for the owner's vet). Tree under test: HEAD `bcd61b6` on `feat/teach-side-overnight` = the 2026-09-08
> audit-fix build (KEY-based dark-switch gate + mig 137 one-shot reset + runtime arming, mig 138/139 efficiency bundle, mig 140
> name-grow belts DARK, release road + verifier, the Review queue row overlap fix `72ce811`, backups never carry dark switches).
> **Mission (owner's args):** the FULL battery under the SAME conditions as the 09-03 pass, every 09-03 item judged BETTER / WORSE /
> SAME with evidence, plus anything new — the customer experience, not the code. Report appended VERBATIM below.
> **IMPLEMENT NOTHING without the owner's explicit go.**

---

# Chris The Customer — Full App Review — 2026-09-08 (audit-fix build, HEAD `bcd61b6`)

> **Round conditions:** fresh sandboxed instance (CDP 9223, pid 3200, isolated `userData`, copied Demo Docs), real PrintWindow screenshots (`chris-sandbox\step01…step75*.png`, 95 files), the same cold-learning conditions as the 2026-09-03 round. Nothing outside the sandbox was read or written. Findings queue for the owner's vet — **implement nothing without the owner's explicit go.** I am one simulated office manager, not a user test.

**TL;DR (3 lines):** First contact is as good as it was — recovery code, Terms, 7-step wizard, tour and practice run are unchanged and still honest, and the Review-row fix is real (file names no longer sit on the delete ×). Import felt clearly quicker (10 scans in ~16 s, 20 invoices in ~37 s) and every scary button — including Empty bin and the new approval workflow — told the truth. The two things I flagged last time are still there (the Import list keeps saying "Confirm to file →" on filed documents; a watch-folder bundle comes in whole), and the bundle case got scarier: it now offers a company name taken from page 3 while showing me page 1.

## Walkthrough (what each screenshot shows)
- **step01–03** — Sign-in/create-admin ("no default credentials — you choose everything below"), one-time recovery code with "Continue" greyed until ticked, Terms gate. SAME as 09-03.
- **step04–10** — 7-step wizard. Step 2 now also asks "WHERE SHOULD ORIGINAL SCANS GO AFTER THEY'RE BROUGHT IN?" (Default = a "Processed" folder alongside my scans, with "Your original scans are never deleted…"). Step 3 has the live filing preview and a "Regional format" block. Speed defaults to **Fast**, accuracy **Thorough**, diagnostics **No thanks**. (I redirected the output folder to the sandbox; the app honestly refused a garbled path with "That folder can't be written to — pick another location.")
- **step11_tour1–6, step12_practice1–10** — 6-card tour and the watermarked practice run (teach by box → import → fix "INV-1O42" → confirm). SAME as 09-03, still excellent.
- **step13–17** — Import screen; folder picked shows "10 documents ready to import" with the names; the run; the log.
- **step18–25** — Review, now **grouped by sender**; Pelican open (step20) and zoomed to 175 % (step21); the three "Sender not identified" documents (step24, 25a–c).
- **step26–31** — 20 Northgate invoices imported; one confirmed; File All Ready; the two left behind.
- **step32–34** — Search for `INV-87127` (1.6 s), the result's actions, the Mailbox.
- **step35–45** — Settings: Processing (Balanced 200 DPI, 10 documents at once), Licensing (paid, workflow add-on ON), Workflow rules, Users (Can stamp, Add User, the one-time temporary password).
- **step36–37, 43** — ⊕ teach on Silverbeck's blank issuer; confirmed and filed.
- **step46–48, 54–55, 70–71** — the scary buttons: row ×, Reprocess, Split, Recycle bin/Restore all, Delete All Review, Empty bin.
- **step49–53** — auto-import folder set, a 3-supplier bundle + 2 singles dropped in; the bundle in Review.
- **step50–52, 56–69, 72–74** — approval workflow end to end as Chris and as a second user Sam (send → approve with stamp → stamped viewer → Save a copy → recall → reject → history).

## Item-by-item against the 09-03 review
| 09-03 item | Verdict | Evidence |
|---|---|---|
| **#1 Import list says "Confirm to file →" on filed documents** | **SAME — NOT FIXED.** After a manual Confirm & File (Pelican) the row still read "Confirm to file →", also after leaving and returning to the tab (step23), and after File All Ready all 17 filed Northgate rows still said it. | step23, Import list text after File All |
| **#2 Watch-folder bundle swallowed as one document** | **SAME on the split, WORSE on the name.** My 3-supplier bundle arrived as one 3-page document. Last time it was labelled "DELIVER TO" (obviously wrong); this time it is labelled **"Halcyon Leisure Group"**, a real company name lifted from page 3 (NEW #1). | step53, `bundle_page3.png` |
| **#3 "3 fields were flagged by a formatting check" with no field named** | **SAME.** Pelican: "Format check · 3", but no field says which. | step20 |
| **#4 "confirm it's the sender, not the customer" on every document** | **SAME.** Same sentence on Pelican, Veltrix, all 20 Northgate invoices ("Check · 69%"). | step20, 22, 28 |
| **#5 The reference note copy** | **SAME / could not fire** — cold install again; judged as copy last time, nothing new to add. | — |
| **#6 Bare percentages / red "31%" chips** | **BETTER-BUT.** Rows now add words: "Needs: Document Issuer", "Needs: Invoice Number", "Needs: a document type" (step24). But a *green* "63%" now means "ready to file" while "Check" means not — the number stopped meaning what I thought (NEW #4). | step24, step29 |
| **Queue row: file name over the delete ×** (owner's ask) | **FIXED.** Names truncate ("Pelican-O…", "Silverbec…") and the × is clear on every row I looked at. Side effect in NEW #8. | step19, 24, 27 |
| **Pelican reference "P1/25/3699"** (09-03) | **BETTER by my eye** — now reads "PI/25/3699", which is what the page looks like to me at 175 %. I can't swear which is printed. | step21 |

## NEW finding cards (ranked by harm)

### 1. The bundle's company name comes from a page I'm not looking at
- **Citation (verbatim):** Review, `bundle_3suppliers.pdf`, "Page 1 / 3" — DOCUMENT ISSUER **"Halcyon Leisure Group"** "Check · 40%"; summary "Needs a quick check — 1 field was read with low confidence." INVOICE NUMBER "INV-80458" "High · 98%".
- **User-moment:** checking what the auto-import folder made of a three-supplier bundle.
- **Observed confusion:** The page on screen is an **Ironbridge Fabrication** invoice billed to "Stonegate Property Mgmt"; "Halcyon Leisure Group" appears nowhere on it — it is the "Supplier" line on page 3 (a Northgate purchase order). The number and date are from page 1, the company from page 3, and nothing tells me the details were stitched from different pages. If I press the green button, three suppliers' paperwork files under a company that isn't on the page I checked.
- **Harm + severity:** trust-eroded, likely misfile — the "where's my paper?" answer would be wrong for two of the three pages.
- **Class:** CONFUSION.
- **Proposed alternative:** when a document has more than one page and the issuer was read from a page other than the one shown, say so on the issuer note ("read from page 3 — this looks like more than one document; consider Split"), and put the ✂ Split suggestion in the same breath.
- **What I may be missing:** the 40 % mark did keep it out of File All Ready, so nothing filed itself; and Split is one click away on the rail — I just wasn't told to use it.

### 2. My STATEMENT is called an Invoice and blocked for an "Invoice Number" it doesn't have
- **Citation (verbatim):** Review, `Ironclad-Tool-Hire_statement_0011.pdf` — type picker **"Invoice"**; INVOICE NUMBER "Not found"; "To file this document, please fill in **Invoice Number** — this field is needed to file it."; row "Needs: Invoice Number".
- **User-moment:** working through the "Sender not identified" group.
- **Observed confusion:** The page says **STATEMENT** and prints "Statement Ref ITH-0093". The picker offers only Invoice / Sales Order / Purchase Order plus "＋ Create new type…". I would type ITH-0093 into "Invoice Number" to get it filed, which is a lie I'd later regret when searching.
- **Harm + severity:** blocked (can't file honestly) / slowed.
- **Class:** CONFUSION.
- **Proposed alternative:** when the page heading is a common document word the app doesn't have a type for, offer it: "This looks like a Statement — add 'Statement' as a document type?" (the catalog already has one, I believe; I never found the road to it from here).
- **What I may be missing:** an admin could add a Statement type from Settings; a first-day user won't know that's the fix.

### 3. "4 more to file by itself" and "17 more ready to file" sit side by side
- **Citation (verbatim):** Review group header "19 documents · 2 need a look / **4 more to file by itself**" beside the chip "**17 more ready to file** · Just now · Northgate Textiles" (step29). After File All: "learned · needs a layout"; Home: "No senders file by themselves yet — teach a layout and confirm a few of its documents · learned 1 layout."
- **User-moment:** I had just confirmed one Northgate invoice and wanted to know what would happen to the other 19.
- **Observed confusion:** I read "4 more to file by itself" as "4 more documents will file themselves", then the button offered 17. After I'd filed 18 of them the sender still "needs a layout" and Home says nobody files by themselves. I don't know what a "layout" is or why 18 confirmations don't count.
- **Harm + severity:** slowed / trust-eroded (I stop believing the counters).
- **Class:** QUESTION.
- **Proposed alternative:** one sentence in plain words: "Confirm 4 more from this sender without corrections and their documents will file themselves on import." And if File All Ready doesn't count toward that, say so in its dialog.
- **What I may be missing:** the File-All dialog did say "New senders need a few confirms before they file themselves" — maybe the 17 were counted and the "layout" is a separate thing.

### 4. A green "63%" now means "ready", a "Check" means "not" — the number contradicts the word
- **Citation (verbatim):** queue rows "Northgate… No… **63%**" (green) for the ready ones; "Northgate… No… **Check**" for the two held back; Search shows a *filed* invoice as "**Confirmed · 63% confidence**".
- **User-moment:** scanning the queue after one confirm.
- **Observed confusion:** I'd expect a higher number to be readier; instead the 63 %s are the ones the app is happy to file and the un-numbered "Check" ones aren't. And a document I've already confirmed still carries "63% confidence" in Search.
- **Harm + severity:** cosmetic → trust-eroded.
- **Class:** PREFERENCE.
- **Proposed alternative:** on rows use words only ("Ready" / "Needs a look"); on a confirmed document drop the percentage.
- **What I may be missing:** the number may mean something else ("how sure before you confirmed").

### 5. The approver sees a different document card from the sender
- **Citation (verbatim):** as Sam (Edit role) the same INV-87127 shows **"Type —"** and a grey **"Unknown"** badge; the stamp dialog is titled **"Document —"**. As Chris it shows "Type Invoice · Confirmed · 63% confidence".
- **User-moment:** Sam opening the approval request I sent him.
- **Observed confusion:** Sam would ask "what is this, and why is it Unknown?" before approving. It's the same filed invoice.
- **Harm + severity:** trust-eroded, low.
- **Class:** CONFUSION.
- **Proposed alternative:** show the type and status the sender saw; put the reference in the dialog title ("Document INV-87127").
- **What I may be missing:** may be intended for the Edit role; either way the words don't help.

### 6. The counters tell three stories during and after a batch
- **Citation (verbatim):** mid-run: strip "**Processing 1 of 20 — NorthgateTextiles_invoice_07.pdf**" and "0 / 20", card "**10 processed of 30 found**" (step26_mid1). After the watch folder brought in 3 files: strip "WATCH FOLDER — IDLE ✓ **20 processed — 20 need your review before filing**" while the list held 23 rows.
- **User-moment:** watching the batch, then checking what the auto-import did.
- **Observed confusion:** "1 of 20" names file 07 while several run at once; the card counts the whole session; the strip after a watch import still talks about the last manual batch.
- **Harm + severity:** cosmetic.
- **Class:** QUESTION.
- **Proposed alternative:** "Working on 7 at once — 3 of 20 done", and let the watch import write its own strip line ("Auto-import: 3 new — 3 need your review").
- **What I may be missing:** the log ("Using 7 workers to stay within this PC's available memory") does explain it, and the end-of-run line is right.

### 7. Two small stale/leaky lines
- **Citation (verbatim):** Import log: "**✓ → undefined**" after several documents (step17). Review, after my ⊕ box filled the issuer: the blue note still read "**The Document Issuer box is still empty** — an empty box pulls the overall score down…" above a box showing "Silverbeck Cleaning Supplies" (step37).
- **User-moment:** reading the log after the batch; checking my teach.
- **Observed confusion:** "undefined" is not a word I'd say to a colleague; the "still empty" note above a full box made me doubt the teach had taken (it had — the green "✓ I read Silverbeck Cleaning Supplies from your box" line said so).
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** drop or fill the "undefined"; clear the "still empty" note the moment the box is filled.
- **What I may be missing:** nothing — both are just words.

### 8. Twenty rows that all read "Northgate… No… Check"
- **Citation (verbatim):** queue rows "Northgate… / No… / Check" ×20 (step27).
- **User-moment:** trying to find invoice 07 among 20 from the same sender.
- **Observed confusion:** the overlap fix truncates so hard that every row is identical; I had to widen the pane or open each one.
- **Harm + severity:** slowed.
- **Class:** PREFERENCE.
- **Proposed alternative:** when the sender is already the group heading, show the reference (INV-87127) or date on the row instead of repeating the sender.
- **What I may be missing:** the splitter is draggable; a wider default may be all it needs.

## Warnings truth-table (button → what it warned → what actually happened)
| Button | What it warned | What actually happened |
|---|---|---|
| **Delete (row ×)** | "Delete "Ironclad-…0011.pdf"? Note: this is the document in the row you clicked — NOT "bundle_3suppliers.pdf", the document open on the right. It goes to the app's recycle bin — you can restore it from Search." | Exactly that document went (13→12); the open bundle untouched. **True**, and it named the right two documents. |
| **Restore all** | "Restore all 1 document from the recycle bin? They go back to where they were deleted from (the review queue, or their filed folder)." | Back in the queue (12→13). **True.** |
| **File All Ready** | "File 17 ready documents (of 28 in the Review queue)? Not included — they stay in the queue: • 8 flagged… • 1 with no document type yet • 2 missing a required detail… Each one is filed exactly as if you confirmed it yourself…" | Filed exactly 17 (disk 2→19 PDFs); 11 stayed; 17+8+1+2 = 28. **True to the number.** |
| **Split (✂)** on a 1-page doc | "This document is only one page — there's nothing to split." | Nothing happened. **True.** (Not executed on the 3-page bundle — see "not exercised".) |
| **Reprocess** | (no warning) | Re-read, nothing lost. **Correct** — no scare needed. |
| **Delete All Review** | "Delete ALL 13 document(s) in the Review queue? They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected." | Queue → 0, "Queue cleared — 13 in the recycle bin"; Output PDFs unchanged (21). **True on every clause.** |
| **Empty bin** | "Permanently delete all 13 documents in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched." | Bin → empty; Output unchanged; all 33 originals still in their `Processed` folders. **True.** |
| **Send… (approval)** | no confirm — "Send" just sends | Appeared in Sam's Inbox word for word. Fine. |
| **Reject** with no note | "Add a short note so the sender knows why." | Refused until I typed one. **Good.** |
| **Recall** | (no warning) | Flipped to "recalled" instantly; visible to Sam as "recalled". Fine, though a mis-click can't be undone except by re-sending. |
| **Stamp** | "A stamp is permanent — it shows your name and today's date and can't be removed; correct a mistake by adding a VOID stamp." | Approve placed a green APPROVED stamp (by s.patel, date, note) on a **copy** — `…INV-87127.APPROVED-stamped-r1.pdf` beside the untouched original (same size, same July date). **True.** |

## What genuinely worked well
- **Speed.** 10 scanned pages in ~16 s and 20 invoices in ~37 s, with the log saying why ("Using 7 workers to stay within this PC's available memory"). It felt distinctly quicker than my last visit, and nothing looked wrong — every file landed, 0 errors, originals moved to `Processed` as promised.
- **The approval workflow, end to end, with a second user.** Add User → one-time temporary password (shown once, "not stored anywhere") → Sam forced to set his own → Inbox → Approve/Reject (note required to reject) → "View stamped copy" → "Save a copy…" that actually saved a stamped PDF → Recall → Completed list on both sides with the reasons. Home's "1 sent, awaiting others" / "1 waiting for you" kept me oriented.
- **The ⊕ teach on a blank issuer** — one box, "✓ I read Silverbeck Cleaning Supplies from your box. Saved as this layout's company name when you confirm", filed under `Silverbeck-Cleaning-Supplies\2025\August\`.
- **Search** — reference found in 1.6 s; "Torquay" (a town only in a customer's address) found the right three documents.
- The row fix, and the honest "No Document Issuer yet — if you file now it will be saved under 'Unknown Company'…" note.

## Top friction
**The bundle that names a company from a page I can't see (NEW #1)** — combined with the unchanged "Confirm to file →" on filed rows (09-03 #1), the two places that should answer "where is my paper?" are the two that mislead.

## Two-week verdict
**Yes — I'd keep using it.** Nothing was lost, every filing went where the shelf metaphor says it should, the warnings earned their trust again (now including Empty bin and stamping), and the approval loop worked with a real second person. The stale Import list and the bundle's borrowed company name are the two things I'd be muttering about by Friday.

## Could not exercise / caveats
- The new reference note (09-03 #5) — cold install, it can't fire; nothing new to judge.
- **Split on a real multi-page document** — I only pressed ✂ on a one-page doc; I did not split the 3-page bundle, so the "original is permanently removed" clause is unverified this round.
- The Teach **wizard** (nav "Teach") — I taught with ⊕ in Review instead. Defer, Print, Export, the separator sheet, Learning Repair, Straighten — not pressed.
- Auto-import was tested with three files dropped once; I didn't try the toggle off, or a second drop.

## Humility block
- I drive the app through automation. Native Windows dialogs (folder picker, Save a copy) were driven by Win32 messages, not a mouse; my driver also left ghost native confirms behind after accepting them (cleared at the end) — a customer would never see those, and I've not counted them.
- Timings include my own polling (roughly ±2 s).
- "PI" vs "P1" on Pelican is judged by eye at 175 %; the owner's earlier notes suggest the page prints P1 — I report what I saw, not what's printed.
- Which page "Halcyon" came from I established by rendering the bundle myself (page 3 prints "Supplier: Halcyon Leisure Group"); the app never told me.
- The "Type — / Unknown" difference may be by design for the Edit role; I'm reporting the words, not the rule.
- One simulated office manager; suggestions only; I changed no code or copy, touched only sandbox folders (`chris-sandbox\`, `chris-driver\`), and the sandbox app is left running, signed in as Chris.
