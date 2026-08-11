# Chris The Customer — full app vet, 2026-08-11 (overnight repeat round)

**Why this round exists.** The owner asked for Chris to revisit *the exact same tests under the same
conditions* as his 2026-08-10 overnight round, and for the two to be compared. His report below is
verbatim; this header records the conditions and my own after-the-fact verification.

**Sandbox conditions.** Fresh install at `~/Desktop/TESTING/_chris2` — own userData, own output
folder, admin account created through the real create-first-admin flow (0 users seeded), terms
unaccepted, output folder unset, empty queue. Seeded with the owner's learning: all 8 of his
document types (62 fields), 7 field anchors, 7 logo fingerprints, 185 supplier hints. The same 200
scanned documents as last night. CDP 9223, PID 83048.

**Deviation from last night, stated to Chris up front so he was not misled:** only **1 of the
owner's 8 supplier TEMPLATES** transferred; the rest hit a `templates.group_id` foreign key during
seeding. He therefore had *less* pre-taught supplier knowledge than last night. New helper
`scripts/seed-taught-state.js` does this grafting and now documents both traps (templates bind by
`document_type_slug`, not id; `group_id` is a real FK).

**THE BUILD UNDER TEST WAS THE SHIPPED DEFAULT — nothing was armed by hand.** This matters: the
wrong-company fix (`template_identity_on_page`) is in `PROVEN_ON_DEFAULTS`, so a FRESH install seeds
it ON. **The owner's own install does not have it**, because his DB ran migration 60 before the flag
existed. So Chris tested the fix as a *new customer* would receive it, with no intervention.
`code_separator_structure_guard`, `vat_eu_formats` and `teach_typed_value_locate` were all unset.

**OWNER-VERIFIED AFTERWARDS (filesystem and metadata, not Chris's word).** His headline reproduces
exactly:

```
Output/a-eens-Ee/        20 documents      <- Oakhaven delivery notes, misfiled
Output/@a-eens-Ee/        1 document       <- a second, near-identical junk folder
Output/Nordwind-Refrigeration-Ltd/  19     <- correct
Output/Ironclad-Tool-Hire/           1     <- correct
```

and the filed metadata for `Delivery-Note.28-04-2025.OED91377.xml` carries
`<SupplierName>a eens Ee</SupplierName>` with `<VatNo>GB 512 8846 27</VatNo>` — **Quillstone's VAT
number on an Oakhaven delivery note.** Last night only the company name crossed over; tonight two
fields did.

**THE RESULT IN ONE LINE, because it is a split decision.** The fix WORKS for an ordinary supplier
teach — teaching Ironclad through the wizard gave 19/19 correct with zero bleed onto any other
company, which is the thing Chris said last night he would stop using the product over. It does NOT
hold when the taught document is one the owner's **own company issued** (a purchase order on the
owner's letterhead, whose address block also appears on the recipient's documents) — which is the
same buyer-issued class the 2026-08-10 DAY fix was built for. Narrower than last night, not gone.

**NOTHING IN THIS REPORT IS IMPLEMENTED. It queues for the owner's vet.**

---

Everything stayed inside the sandbox. Here's his report.

---

# Chris The Customer — round 2, 2026-08-10 (repeat vet)

**Setup:** fresh install driven end to end — created the admin account, accepted terms, ran the setup wizard, the tour and the practice run, imported all 200 scans, reviewed, taught two suppliers two different ways, confirmed, filed, searched, pressed the frightening buttons, and ran a document through the approval workflow. Everything inside the sandbox. Nothing outside it was touched. **Nothing here is implemented — it's for you to vet.**

---

## VERIFY LIST — last night's findings, one line each

| # | Last night | Tonight |
|---|---|---|
| 1 | Teaching one supplier stamped another company's docs at 95% and misfiled one | **STILL-BROKEN** for documents *my own company issued* — I reproduced it exactly: **20 Oakhaven delivery notes filed into a folder that isn't a company**, and this time the **VAT number came across too**. **BUT FIXED** for a clean supplier teach — teaching Ironclad through the wizard gave **19/19 pure, zero bleed onto anybody** |
| 2 | "Reprocess all in queue" warns you not at all | **STILL-BROKEN** — no dialog, no tooltip, nothing; it re-read 160 documents on one click |
| 3 | Queue says 200 when 43 need you; reason only visible one doc at a time | **BETTER-BUT** — Import now ends with *"FINISHED ✓ 200 processed — 147 need your review before filing, 53 ready"* and rows show green **Ready to file** vs amber **Confirm to file →**. Home still just says *"200 waiting in the review queue"* |
| 4 | Tour and Home promise automatic filing the default prevents | **STILL-BROKEN** — bar still 100%, tour card 5 unchanged, practice run repeats it at 98%, and Home now says *"2 suppliers now file automatically"* when nothing has ever auto-filed. (Credit: while empty it was honest — *"No suppliers file automatically yet"*) |
| 5 | 53 switches, 37 ON under text reading "Off by default" | **BETTER-BUT** — 58 switches, 46 ON, **11** still ON under "Off by default". The filing bar is now the 2nd item on the page, not buried — that's a real improvement |
| 6 | Confirming never tells me where it went | **STILL-BROKEN** — counter 200→199, no message. File All Ready filed 38 with no summary at all |
| 7 | Red dots on fields reading perfectly | **STILL-BROKEN** — 8 dots, painted the app's error red, on fields reading 93–94% correctly |
| 8 | Delete 60 in two clicks, restore one at a time | **STILL-BROKEN** — still no "Restore all", and the bin now lists my deleted document as **"— / Sales Order"**, so I can't tell which one it is |
| — | Four names for the same state | **STILL-BROKEN** — saw all four again: *Sender not identified · Not yet identified · Unknown issuer · Unknown Company* |
| — | Teach picker can't be searched | **STILL-BROKEN** — 161 documents, no search box |
| — | Wizard promises label-marking it does itself | **BETTER** — the issuer step now says *"There's no label to mark"* |
| — | Last wizard button says "File this document", no mention of teaching | **STILL-BROKEN** |
| — | Split PDF / Delete one / Delete All / Empty bin warnings | **ALL STILL TRUTHFUL** — the best copy in the product |
| — | Single Reprocess warns | **BETTER** — it now warns *only when I actually have unsaved edits*. Good discipline, and it makes #2 look worse |

---

## The walkthrough

**First contact was excellent.** *"There are no default credentials — you choose everything below."* Recovery code with a plain explanation. The setup wizard opened with *"Everything stays on this computer"* and, on the folder step, *"🔒 Your original scans are never deleted"* — my number-one fear answered before I asked. It kept that promise: all 200 originals were sitting in `IMPORT\Processed` afterwards. The filing preview showed me a real example path before I committed. Diagnostics off by default with an itemised list of what is and isn't sent. I'd have signed up. *(step01–06)*

The **practice run** is the best teaching device in the app. Document on the left, what it read on the right, and the closing screen listed every file's before→after name *and* the folder it landed in. *(step07–10)*

**The import** ran 200 documents, zero errors, and ended with a proper breakdown. *(step13b)*

**Then I taught a supplier** the way the Review screen invites you to — the ⊕ on a Quillstone purchase order — and that is where it went wrong. *(step17–19)*

**Then I taught one properly** through the wizard, and it was clean and correct. That contrast is the most useful thing I found tonight. *(step20–22)*

---

## The 8 new findings, worst first

### 1. Teaching a purchase order *my own company issued* still puts my taught value on another company's documents — and this time the VAT number came too
- **Citation (verbatim):** Review, on `Oakhaven-Electrical_delivery_note_0027.pdf`, page heading **"Oakhaven Electrical Wholesale"** in 24-point type. Panel: **"DOCUMENT ISSUER · High · 95%"**, **"Recognised by: Its logo and wording"**, **"Nothing was flagged — this was read at 95%, just below the 100% you've set for filing without a check, so it's waiting for you."** and **"If documents like this are consistently right, lower the auto-file bar in Settings → Processing."** Queue group: **"@a eens Ee — 20 documents"**, every one 95%.
- **User-moment:** I'd taught one Quillstone purchase order and pressed Reprocess all, exactly as last night.
- **Observed confusion:** Before I taught, all 20 Oakhaven notes read "Sender not identified". After teaching one Quillstone document, all 20 carried my taught value at 95%. **VAT NUMBER also reads 95% and says `GB 512 8846 27` — which is printed on the Quillstone order, not this one. Oakhaven's own VAT is printed on the page as `GB 660 1173 45`.** Last night only the company name crossed over; tonight two fields did.
- **I then pressed File All Ready and proved it:** 38 documents filed, **18 perfect, 20 into the wrong folder.** `Oakhaven-Electrical_delivery_note_0015.pdf` is now at `Output/a-eens-Ee/2025/April/Delivery-Note.28-04-2025.OED91377.pdf` with `<SupplierName>a eens Ee</SupplierName>` and `<VatNo>GB 512 8846 27</VatNo>`.
- **The line that worries me most is the app's own advice.** On a document whose company it has completely misattributed, it suggests I lower the bar so documents like it file themselves.
- **Harm + severity:** documents silently misfiled. **Highest.**
- **Class:** CONFUSION.
- **Proposed alternative:** Before filling a company from something learned elsewhere, check the page's own name and VAT number. If they disagree: *"This page reads 'Oakhaven Electrical Wholesale' and VAT GB 660 1173 45, but I've filled in a company I learned somewhere else. Please confirm who sent this."* And don't offer "lower the bar" on a document whose issuer came from another layout.
- **What I may be missing:** the teach that leaked was on a purchase order carrying **my own letterhead and my own address**, and the Oakhaven notes carry my address too. The clean supplier teach did not leak at all. So this may be narrower than last night — I'd say it's now specifically about documents my own company issues, not everything.

### 2. A garbled read became my company name, was announced as a success, and filed itself into a folder named after the garbage
- **Citation (verbatim):** Green toast: **"Captured the Document Issuer position from this layout."** Document Issuer field then read **"@a eens Ee"**. Banner above still said only *"Needs a quick check — 1 field was read with low confidence, and 1 field was flagged by a formatting check."* — neither of them the company name. **✓ Confirm & File** was green and enabled.
- **User-moment:** I drew a box round "Quillstone Print & Packaging" so my order would file under the printer.
- **Observed confusion:** It read gibberish, congratulated itself, flagged nothing, and let me file. My output root's first folder is `@a-eens-Ee`. **And there are now two of them** — `@a-eens-Ee` (1 document) and `a-eens-Ee` (20) — the same nonsense value produced two folders that look identical in Explorer.
- **The asymmetry is the point:** when the issuer box was **empty** the app told me plainly — *"No Document Issuer yet — if you file now it will be saved under 'Unknown Company' and the app won't learn this sender."* When it held **nonsense**, silence. It guards absence but not nonsense.
- **Harm + severity:** trust-eroded; junk folders in the filing cabinet. **Very high.**
- **Class:** CONFUSION.
- **Proposed alternative:** If a taught read doesn't look like a company name, say so instead of celebrating: *"I read '@a eens Ee' from that box — that doesn't look like a company name. Draw it again, or type the name yourself."*
- **What I may be missing:** my box may have been a few pixels out. But the app doesn't know that and neither would a customer — the toast said it worked.

### 3. Approve does nothing, and says nothing. Reject works perfectly
- **Citation (verbatim):** Mailbox → Inbox → **"Sent to you by chris — they'd like your approval"**, buttons **Approve · Reject · Forward…**
- **User-moment:** approving a quote a colleague sent me.
- **Observed confusion:** I pressed **Approve** four times across two sessions — clean state, item selected, no leftover errors. Every time: no dialog, no message, no change. Item stays `pending`, Completed stays *"Nothing finished yet"*. **Reject with a note went through first time** — Inbox emptied, Sent and Completed both showed `rejected · Reason: Too expensive — get another quote.` So the machinery works; Approve is the one door that doesn't open.
- **A related trap:** a stale red error from an earlier Reject (*"Add a short note first — the sender needs to know why it was rejected."*) stays on screen while you press Approve, so the only message visible tells you about rejecting.
- **Harm + severity:** blocked — the headline action of the whole approval feature. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** whatever it's refusing, say it: *"You can't approve a document you sent yourself"* — or make it work. Silence on a button press is the worst of the three.
- **What I may be missing:** I'm the only user, so I approved my own request. If that's deliberately barred, the rule is right and only the silence is wrong.

### 4. The Import screen said "No documents found in this folder" straight after successfully reading 200 documents from it
- **Citation (verbatim):** under my folder path — **"No documents found directly in this folder — pick the folder that contains the scans (PDFs or images)."** Directly above the result table showing 200 processed documents.
- **User-moment:** the batch had just finished.
- **Observed confusion:** it reads as *you picked the wrong folder*. My first thought was: what has it done with my scans? They were safe — the app had correctly moved them to `Processed`, exactly as promised. Its own good behaviour is generating a false alarm.
- **Harm + severity:** trust-eroded at the worst moment. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** *"All 200 scans from this folder have been brought in and moved to Processed. Drop new scans here whenever you like."*

### 5. "Yes — teach this position" asks me to approve a position it never shows me
- **Citation (verbatim):** Teach wizard — **"Found that value printed on the page — the box on the page shows where."** with **Yes — teach this position →** and *Save as a typed value*.
- **User-moment:** the supplier's name wasn't printed anywhere I could see, so I typed it.
- **Observed confusion:** there is no box on the page. I looked at the whole page and there isn't one. I'm being asked to say yes to something I can't see, on the one screen whose entire job is showing me what it found.
- **Harm + severity:** slowed; the safeguard is the picture, and the picture is missing. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** draw the box, or change the sentence to *"I found that value on the page but can't show you where — teach the position anyway?"*
- **What I may be missing:** it may be drawn somewhere off-screen or too faint to see. Either way I couldn't see it.

### 6. One teach turned nineteen documents into companies called "SUPPLIER", "UPPLIER" and "rans"
- **Citation (verbatim):** Review queue groups: **"SUPPLIER — 13 documents · 13 need a look"**, **"UPPLIER — 5 documents"**, **"rans — 1 document"** — all of them Quillstone purchase orders.
- **User-moment:** after teaching one Quillstone order and reprocessing.
- **Observed confusion:** it has taken the printed *caption* "SUPPLIER" as the company. Before I taught, all 20 honestly said "Sender not identified" — a state I know what to do with. After, 19 look answered and are wrong. **My one teach moved 39 documents from honestly-unknown to confidently-wrong.**
- **In fairness:** these 19 all carry a **Check** flag, so the app is holding them. The 20 Oakhaven ones weren't flagged at all. That difference matters and it's to the product's credit.
- **Harm + severity:** slowed; teaching made things worse. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** a word printed as a heading above a block shouldn't be usable as a company name.

### 7. While it's working, the counter reads "132 processed of 132 found" — it never shows the total
- **Citation (verbatim):** Import panel mid-run — **"132 processed of 132 found"**, then **"162 processed of 162 found"**, ending **"200 processed of 200 found"**.
- **User-moment:** four minutes into a 200-document batch, wondering how long to wait.
- **Observed confusion:** the preview had just told me *"📄 200 documents ready to import"*. Then the counter says 132 of 132 — which reads as finished. I'd have walked away thinking it had stopped early.
- **Harm + severity:** slowed; false "done" signal. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** *"132 of 200 read"* — the total is already known.

### 8. The recycle bin can't tell me which document I deleted
- **Citation (verbatim):** delete dialog — **"Delete "Silverbeck-Cleaning_sales_order_0027.pdf"? It goes to the app's recycle bin — you can restore it from Search."** In the bin, that same document is listed as **"— / Sales Order"**.
- **User-moment:** going back for something I'd deleted by mistake.
- **Observed confusion:** the warning named my file precisely. The place I go to undo it shows a dash. With three deleted sales orders I'd be guessing. Restore itself worked — the count came straight back — but there's still no **Restore all** beside **Empty bin**.
- **Harm + severity:** recovery cost. **Medium.**
- **Class:** PREFERENCE.
- **Proposed alternative:** show the filename in the bin row, and add "Restore all".

---

## Warnings truth-table

| Button | Warned? | Told the truth? | Said how many? | Way back, on that screen? |
|---|---|---|---|---|
| Confirm & File (one) | **No** | — | — | Not mentioned |
| Confirm & File with a **nonsense** company | **No** | — | — | No — filed to `@a-eens-Ee` |
| Confirm & File with an **empty** company | **Yes** ✓ | Yes — names "Unknown Company" | n/a | Plainly stated |
| **Reprocess all in queue** | **No — none at all** | — | No | No |
| Reprocess (one document), no edits | No (deliberately) | n/a — **improvement** | n/a | n/a |
| Reprocess (one document), with edits | **Yes** | **Yes** — the edit was at risk exactly as stated | n/a | Plainly stated |
| File All Ready | Yes | Yes | **No** | Not mentioned — and 20 of the 38 went to the wrong folder |
| Delete (one document) | Yes | **Yes** — names the file, the bin and the route back | n/a | **Yes** ✓ tested, restore worked |
| Delete All Review | Yes | **Yes** — best in the app | **Yes ("ALL 160")** | Yes, and says what's *not* affected |
| Empty bin | Yes | **Yes** — *"including their PDF files… cannot be undone"* | **Yes** | Correctly says there isn't one |
| Send back to Review | Yes | Yes — *"It stays filed until you re-confirm it"* | n/a | Clear |
| Reject with no note | Yes | **Yes** — and explains *why* a note is needed | n/a | n/a |
| Split PDF | Refused politely | Yes | n/a | n/a |

> The pattern hasn't changed: **the frightening buttons are handled beautifully; the harmless-sounding ones are the ones that changed 160 documents and filed 38 without a word.**

---

## Smaller things I'd mention over a cup of tea

- The Terms I had to accept begin **"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE"** and contain `[SOLICITOR:]` notes. I assume you know — but a customer would.
- The recovery-code screen says *"Write it down or print it"* and gives me neither a Copy nor a Print button. Sixteen characters, by hand.
- The filing preview has **four** name blocks — `Type · Date · Reference · Title` — and the example underneath shows three: `Invoice.15-12-2025.INV-2025-0142.pdf`.
- Practice run: *"One field is uncertain — it's outlined in **amber**"* — the outline is blue and the bar is red. After I fixed it, that same sentence reappeared next to a green tick.
- Practice document 3 still showed the footnote from document 2: *"Read "INV-1042" from your box."*
- The wizard said **"7 OF 7 DONE / All fields captured"** when I'd marked two as not on the document.
- On a statement whose company name genuinely isn't printed, the instruction is confident it is: *"anywhere it's printed, including the footer."* The only name on that page was my own company's, as the customer.
- A label read as **"Statement Re"** (missing the f) and I was asked to confirm it. I'd have said yes without knowing better.
- Two blue buttons on the same panel both say "Send" — **"↩ Send back to Review"** and the workflow **"Send"**. I hit the wrong one; the dialog saved me.
- Empty states are genuinely good throughout: *"Nothing waiting on you — documents colleagues send you for approval or information appear here."*

## Decision count, one routine document

A clean one: open, glance, **1 click**. Still excellent.
A flagged one: **4–6**, mostly hunting for the problem rather than fixing it.

## What genuinely worked

**The rejected stamp.** A red **REJECTED · By: chris · Date: 10 Aug 2026 · Notes: Too expensive — get another quote.** printed across the top of the quote. That is the rubber stamp off my desk, and I could hand it to anyone.

**And the clean supplier teach.** Ironclad Tool Hire: the wizard read `£3,654.73` and worked out on its own that its label is **"Balance Due"**, to the **left** of the value. Then it taught 19 documents, all 19 genuinely Ironclad, and **left every other company alone.** `Nordwind-Refrigeration-Ltd/2025/August/Quote.11-08-2025.NRQ-3753.pdf` with every field right. That is my filing cabinet, rebuilt.

## Top friction

The same as last night, but I can now say it more precisely. **The app is honest about what it doesn't know, and silent about what it has got wrong.** Empty issuer? It warns me. Nonsense issuer? Nothing. Low confidence? A clear amber banner. Confidently wrong company taken off a different company's document? *"Recognised by: Its logo and wording,"* 95%, and an invitation to lower the bar. Every guard in this product is pointed at *absence*. None of them is pointed at *confident nonsense*.

## Would I keep using this after two weeks?

**Yes — with one condition, and it's a narrower condition than last night.** The fix has done real work: a clean supplier teach was flawless, 19 for 19, and it didn't touch a single other company. That's the thing I said I'd stop over, and for ordinary supplier documents it's fixed.

But 20 of the 41 documents in my output folder are in a folder named after a mis-read, and I got there by drawing one box and pressing two buttons the app told me to press. Until a company name that isn't a company name gets stopped before it becomes a folder, I'd be checking the output tree by hand every week — and that's the job I bought this to stop doing.

## What I may be missing

> I'm one simulated customer, not a user test — nobody "found" anything here except me. Two caveats matter. First, I couldn't drive the Windows folder pickers, so I set the output and import folders the way the picker would rather than by clicking Browse. Second, my ⊕ box produced a bad read and I can't tell you whether that was my aim or the app's reading — but I judged what appeared on screen afterwards, and the screen said it had succeeded. I also hit the wrong "Send" button once and filled the wrong note box once; both were mine, not the app's, and I've said so where it matters. Where a button did nothing I checked whether a dialog had been swallowed before reporting it. I can tell you what I saw and what ended up in the output folder; I can't tell you why the app decided Oakhaven was "@a eens Ee", and I haven't tried. Everything here is a suggestion for you to vet — I changed no code, no copy, and no setting outside the sandbox.

---

**Screenshots** (all in `C:\Users\cmccu\Desktop\TESTING\_chris\driver\`): `r2_step01_login` · `r2_step02_recovery` · `r2_step03_terms` · `r2_step04_wizard1` · `r2_step05_structure` · `r2_step07_practice` · `r2_step08_practice_doc` · `r2_step09_practice_gate` · `r2_step10_practice_fixed` · `r2_step11_import` · `r2_step13b_done` · `r2_step14_home` · `r2_step15_review` · `r2_step16_quill` · `r2_step17_draw` · **`r2_step19_HEADLINE`** · `r2_step20_wizard` · `r2_step21_locate` · `r2_step22_f2` · `r2_step23_search` · `r2_step24_send` · **`r2_step26_stamped`**

---

## Main-session triage (NOT implemented — for the owner)

**Verified at source, and it sharpens finding 1 into something actionable.** The
`template_identity_on_page` guard requires a layout to NAME its company before it may claim a
document. Chris's leaking teach was a **purchase order the owner's own company issued** — the
owner's letterhead, the owner's address block — and the Oakhaven delivery notes carry the owner's
address too, as the recipient. So the page *does* contain the name the template is keyed on, the
guard is satisfied, and the claim proceeds. **This is the same buyer-issued class the 08-10 DAY fix
was written for; the fix closed the supplier case and left the buyer-issued case open.** That is a
narrowing, not a solve, and the entry for it should say so.

**Finding 2 is arguably the more general defect and is new.** The teach captured `@a eens Ee`,
reported success, raised no flag, and the value became a folder name — twice, in two folders that
differ only by a leading `@`. The 2026-08-10 EVENING2 typed-value work pinned that *"a box is
evidence about WHERE, never WHETHER"*; this is the same principle unhandled in the opposite
direction — the app validates the *presence* of an issuer but never its *plausibility*.
`value_quality.name_quality` already exists and is not consulted on this path.

**Finding 3 (Approve silently does nothing) is a functional dead end in a shipped-but-hidden
feature** and is cheap to check: `workflowService` almost certainly refuses a self-approval, and the
refusal never reaches the renderer.

**Findings 4 and 7 are copy-only** and both are cases of the app understating its own good
behaviour.

### STATUS UPDATE 2026-08-11 (owner-directed): finding 2 is BUILT, default ON, NOT smoke-tested

`learning.issuerReadLooksImplausible` + IPC `check-issuer-read`, consumed by BOTH teach surfaces
(Review's forall teach read-back and the wizard's `finishIssuerField`). Where the app used to say
*"Captured the Document Issuer position from this layout"* over any read at all, a gibberish read
now says *"I read '@a eens Ee' from that box - that doesn't look like a company name. Draw it again,
or type the name in yourself."*

**It is a WARNING and nothing else** - the teach still stages, nothing is blocked, rewritten or
rejected. Kill switch: setting `teach_issuer_plausibility_warn` = `'false'`. Default ON, matching
its sibling `teach_typed_value_locate`, which likewise has no Settings toggle.

**The obvious implementation was measured and REJECTED.** `isPlausibleSupplierName` already exists
and looked like the answer, but it rejects **BP** and **IBM** on a <=3-char all-caps rule written
for extraction-time filtering - it would have nagged a customer whose supplier really is BP, on a
correct value, at the moment they were being helpful. So this is a narrower, warning-only predicate:
no letters at all, or leading punctuation, or (multi-token, initials excluded) a shared
`nameQuality` below 0.5. **Measured: 0 false positives over 22 real company names** including BP,
IBM, 3M, H&M, P&O Ferries, W H Smith, J S Bloggs, E.ON UK plc and all seven corpus suppliers.

**Known miss, pinned rather than tuned away:** `RENN ERNE, Nh` scores 0.67 and passes. Tightening
the floor to catch it costs `J S Bloggs`.

Pin: `database/modules/test_issuer_plausibility.js`, which fails in BOTH directions - it has a
control asserting `isPlausibleSupplierName('BP') === false`, so a future dev who "simplifies" this
back to the existing helper breaks the suite and reads why.

**NOT smoke-tested in the UI** - it needs the owner to draw a bad box once and see the sentence.
Findings 1, 3, 4-8 remain untouched and unimplemented.

**Suggested order for the owner:** 2 (plausibility guard — one predicate, already-existing helper,
protects the filing cabinet) → 1 (buyer-issued identity, the narrowed remainder) → 3 (silent
Approve) → 4/7 (copy) → the rest.
