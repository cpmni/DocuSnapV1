# Chris The Customer — full app run-through — 2026-08-26/27 (sandbox, fresh install)

**Who I am tonight:** Chris Fenton, office manager, handed the admin login for the Settings part. One made-up person, not a user test. I drove the real sandbox app (CDP 9223, PID 3060) and photographed the meaningful steps (`chris-driver\shot01.png … shot116.png`). Login I created: `chris` / `plumber2026`, recovery code `CHXW-B5ET-C8NG-RQYS`. Everything I filed went to the sandbox `Output` folder (I caught the wizard defaulting to `Documents\Scan Finder` and changed it before anything filed). I never touched a path outside the sandbox; the independent leak check is the owner's.

## TL;DR (3 lines)
1. **Numbers:** 472 documents in, **279 filed, 279 under the right company, 0 wrong type, 0 unknown-date folders.** Cold batch filed 0/200 by itself but "File All Ready" filed 115 in one click (26 s); the warm batch filed **116/200 by itself** (round 5 managed 98); scanned copies 13/20 by themselves; 20 exact duplicates all filed by themselves with "-DUPLICATE".
2. **The scare:** I drew ONE box round our own company name on a purchase order (the box is labelled "Document Issuer" and that IS the issuer). The app then re-badged a supplier's delivery note, a credit note and a service worksheet as *our* purchase orders at 95% with the words **"Nothing looks wrong"** and a live Confirm button. Nothing filed wrong — two were held for a missing PO number and I caught the third — but the sentence was the opposite of the truth.
3. **Every scary button told the truth** (Delete, Delete All, Restore all, Empty bin, Send back, File All, Start fresh + Undo). Search found a document in under 4 seconds. The Terms are still a "WORKING DRAFT — NOT YET IN FORCE".

---

## Walkthrough (what I did, what I saw)

**First contact (shot01–shot17).** Create-admin screen is plain ("no default credentials" is the only phrase I'd say differently). Recovery-code screen keeps Continue greyed until I tick "I have saved this code" — good. Terms gate: Accept greyed until ticked — but the text I'm accepting opens with `WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE` and `[SOLICITOR: …]` notes (shot03). Setup wizard, 7 steps, all plain English; the output-folder step defaulted to the owner's real `Documents\Scan Finder` (shot05) — I changed it. Step 3 (folder/file-name blocks with a live preview, plus a new "Regional format" section defaulting to UK dates) is the best-explained settings screen in the app. Tour: 6 cards, every sentence sayable aloud (shot11–16).

**Practice run (shot17–shot53).** Three samples; document 2 has "INV-1O42" and the run insists I draw the box ("Draw a box around the Reference to correct it, then Confirm" — Confirm looked pressable but wouldn't move on, which is fine, the pulsing value showed me where). After the box: "Nicely done — the reference now reads from the box you drew." Document 3 carried **no stale hint** from document 2 (last round's Card 6 — FIXED). End screen lists the three filed names and folders, and says the copies vanish when I close the window — clear.

**SINGLE (10 teach docs, shot55–shot77).** 10 processed, 10 needed me, company blank on 9/10 (first contact, fair). Per document:
- Nordwind quote → "This looks like a Quotation, but you don't have that document type yet…" → `Add "Quotation"` opened a form **with the name pre-filled** (last round's Card 5 — FIXED) → filed to `Nordwind-Refrigeration-Ltd\2025\June\Quotation.10-06-2025.NRQ-8153.pdf`.
- Silverbeck order: three boxes (name, date, number) all read right first go; readout bar named the label it found as **"CATES ORDER NO"** (paper says SALES ORDER NO) — the value was right.
- Veltrix (white-on-orange name) → box read it. Quillstone PO on **our own** letterhead → I followed the label and boxed "Bramblewood Joinery Ltd" → filed under `Bramblewood-Joinery-Ltd\…\Purchase-Order…` (see Card 1 and the question below).
- Oakhaven delivery note → `Add "Delivery Note"` went to the catalog with Delivery Note pre-ticked (fine). **Then the trouble (shot67–69):** after the re-read the panel showed type *Purchase Order*, issuer *Bramblewood Joinery Ltd · High 95%*, "Recognised by: Its logo and wording", and the blue box said *"Nothing looks wrong — this is only the second document from Bramblewood Joinery Ltd… Confirm it and it files — and it counts towards this sender filing on its own."* The queue grew a "Bramblewood Joinery Ltd · 2 documents · 2 need a look · 2 more to file by itself" group holding **Meadowvale's credit note and Castellan's worksheet**, both "Needs: PO Number". I corrected all three by hand (type + boxes); the blue box stayed stale ("Nothing looks wrong…Bramblewood") after my corrections until I filed.
- Pelican invoice (table layout): "Teach this document — We recognise this sender but haven't learned this layout yet" sat above a page whose chip said "Not seen before" and whose sender box said "Not found" — one of those isn't true. Three boxes read right → filed.
- Ironclad statement: **no company name printed anywhere** (just a logo). My helper fumbled typing the name and then pressed OK for me on *"Document Issuer is blank. This document will be filed under 'Unknown Company' and the app won't learn this sender. File it anyway?"* — it did exactly that (`Unknown-Company\2025\May\Statement.24-05-2025.ITH-0093.pdf`). My fault, but a truthful warning.
- After the last confirm the empty queue still showed the previous document's readout bar and teach panel (shot77).

**IMPORT — 200 cold (shot78–shot83).** 2.5 minutes. "✓ 200 processed — 60 need your review before filing, 140 ready." **0 filed by itself.** Every taught sender recognised 20/20 (the 20 "—" were Ironclad, never named). Review grouped by sender with heads like "Pelican Office Interiors 20 documents · 20 need a look · 2 more to file by itself". Opened one per group: Pelican 0012 read the invoice number as the word **"Date"** (70%, "auto-corrected… please verify"); Silverbeck 0012 read **"s8-onne0722"** for SB-ORD60722 (flagged "doesn't appear on this page as written"); Nordwind 0012 "Nothing was flagged — read at 89%, just below the 90% you've set" (clear). These IMPORT pages are grey, slightly skewed scan-copies.

**Owner's test (c) — teach one, watch the siblings (shot82).** Re-drew the order-number box on Silverbeck 0012 and filed it at 00:11:41. Group head unchanged for 135 s ("19 need a look"), **but** opening sibling 0013 three minutes later showed *"Read differently after learning — was 'ss-oo9e275', now 'ss-onnea275'. Please check which is right. Use "ss-oo9e275" / Keep "ss-onne…"* — so yes, the others were re-read by themselves; on these grey copies they came back with a different wrong answer (Card 5).

**File All Ready #1.** Dialog: *"File 115 ready documents (of 199 in the Review queue)? Not included — they stay in the queue: • 75 flagged — waiting for you to check a value • 9 missing a required detail (date, reference or sender). Each one is filed exactly as if you confirmed it yourself…"* → 115 filed in 26 s; receipt *"✓ Filed 115 documents — Bramblewood Joinery Ltd (20), Oakhaven (20), Harrowgate (20), Castellan (20), Veltrix (18), Nordwind (13) and 1 more. — 84 not ready to file… New senders need a few confirms before they file themselves — the next batch will file more on its own."* Audit on disk: 126 filed, 125 right company, 0 wrong, 1 Unknown-Company (mine).

**IMPORT2 — 200 warm.** "✓ 200 processed — 69 need your review before filing, 131 ready." **116 filed by itself (58%).** Import table: Veltrix 20/20, Bramblewood 20/20, Oakhaven 20/20, Harrowgate 20/20, Castellan 20/20 auto; Nordwind 10 auto; Meadowvale 6 auto; Pelican 0, Silverbeck 0, Ironclad 0. On disk 242 filed, 0 wrong. Review banner: *"✓ 123 documents filed automatically — click to see the list — they stay filed; nothing is changed."*

**Search + put back (shot85–shot88).** Searched "ITH-0093": found the Unknown-Company statement in ~3 s (plus 40 unconfirmed Ironclad statements, because that number is also their account number). "↩ Send back to Review" → *"Send this document back to the Review queue? It stays filed until you re-confirm it."* → row marked "↩ put back", note "Sent back from Search — please re-check this document before filing." Typed the sender → offer: **"25 more unfiled documents look like the same sender. Apply 'Ironclad Tool Hire' to 25 & re-read / Not now"** → took it → new "Ironclad Tool Hire 25 documents" group; "Sender not identified" 42 → 16. Filed the statement → Unknown-Company folder gone; 242/242 right company.

**Settings (shot90–shot109) — see the tab-by-tab section.** Learning Repair (owner's test a): clicked "Harrowgate Timber Supplies · Sales Order" → *"Learned from 41 documents, last on 27 Aug 2026. Files by itself. 1 layout remembered. Sending a document back is what un-teaches it."* → "Start fresh with this sender…" → *"This forgets 1 layout and 45 remembered values and taught positions. 41 filed documents stay where they are and stop teaching. The next Sales Order from Harrowgate Timber Supplies will wait for you to check it, like a new sender. The sender is still recognised by its logo. You can undo this."* → yes → row read "Not yet — 5 more confirms" (layout chip gone; "Learned from 41 documents" still shown) → "Undo start fresh" → back to "1 layout · Files by itself"; Output unchanged (242 → 242). Then imported the SCANNED Harrowgate order: **filed by itself** (as a -DUPLICATE). Clear enough what happened to my filed documents — the warning said "stay where they are" and they did.

Barcode (owner's test b): Document Types → Statement → added a field "Barcode", type "Barcode / QR code" (my helper first mis-set the Date filing role to "Barcode"; I put it back — the app let that happen without a word, and one queue row briefly read "Needs: Barcode"). Then reprocessed a statement: **no Barcode row appeared and nothing said whether a barcode was looked for** (Card 4).

**SCANNED (10):** 7 by itself (all "-DUPLICATE"), 3 held. **SCANNED_HARD (10):** 6 by itself, 1 ready, 3 held — including a sender invented as **"Pelican Oiites Interiors"** (held, no date/ref). The scanned Ironclad statement read the date **24-06-2025 at "High · 94%"** against a page printing 24-05-2025, with no warning on that field (Card 2). **DOC SOL (22 real worksheets):** 0 filed, 22 held, typed "Service Worksheet", every sender blank except two invented ones: **"Ticket Type"** and **"DOCUMENT OLUTIONS"** (each now a sender group promising "5 more to file by itself"). **test (20 exact duplicates of IMPORT):** 20/20 by itself as -DUPLICATE.

**Scary buttons (shot111–113):** see the truth table. Boss-on-the-phone: "Harrowgate" + March 2025 → 1 result (HTS-SO-25996, 06-03-2025), and the exact number → 1 result; 6.7 s for both searches including my typing. Home at the end: *"192 waiting in the review queue · 273 filed today · 279 last 7 days · 6 senders file by themselves… learned 9 layouts · 149 filed by themselves in the last 7 days."*

---

## NEW finding cards (ranked by harm)

### Card 1 — HIGH (trust; a near-miss misfile) — one box round our own name turned three supplier papers into "our" purchase orders, and the app said "Nothing looks wrong"
- **Citation (Review, Oakhaven delivery note, shot67):** *"Nothing looks wrong — this is only the second document from Bramblewood Joinery Ltd, so there isn't enough confirmed history yet to check Document Issuer on its own. Confirm 2 more and the rest from this sender can start filing themselves."* / *"Recognised by: Its logo and wording"* / DOCUMENT ISSUER *"Bramblewood Joinery Ltd High · 95%"* / type dropdown *"Purchase Order"* / queue head *"Bramblewood Joinery Ltd · 2 documents · 2 need a look · 2 more to file by itself"*.
- **User-moment:** I had just followed the label "Document Issuer" on a purchase order printed on OUR letterhead, and moved to the next document (a GOODS DELIVERY NOTE from Oakhaven).
- **Observed confusion:** I would read "Nothing looks wrong" + a green 95% + a live Confirm and press it, filing Oakhaven's delivery note as `Bramblewood-Joinery-Ltd\2026\January\Purchase-Order.22-01-2026.PO-46500.pdf` — and it would "count towards this sender filing on its own". The Meadowvale credit note and Castellan worksheet were re-badged the same way (held only because "PO Number" was missing).
- **Harm + severity:** trust-eroded, one click from a wrong-company + wrong-type file. HIGH. (Nothing actually misfiled.)
- **Class:** CONFUSION (the screen misreads the situation) + QUESTION (Settings → Processing has a switch that describes this exact case — *"Stop a purchase-order layout claiming documents that say they are something else… Off by default"* — and it showed ON in my sandbox; I don't know why it didn't stop it).
- **Proposed alternative:** when the name I box is also printed in the CUSTOMER/BILL TO box of the same page, ask before saving: *"'Bramblewood Joinery Ltd' also appears as the customer on this page. Save it as the sender for this layout?"* And never print "Nothing looks wrong" when the type the app chose differs from the heading printed on the page — say *"The page says GOODS DELIVERY NOTE but this layout is a Purchase Order — please check the type."*
- **What I may be missing:** the owner has ruled that our own POs file under our name; maybe the fix belongs to the moment the layout is matched, not the teach.

### Card 2 — MOD-HIGH (silent wrong read) — a wrong date shown as "High · 94%" with no warning
- **Citation (Review, scanned Ironclad statement, shot108):** *"STATEMENT DATE High · 94%"* value *"24-06-2025"*; the page prints *"Date 24-05-2025"*. Same after "Reprocess".
- **User-moment:** checking the last scanned statement before File All.
- **Observed confusion:** I would trust a green "High" and file into June. This document was only held because two OTHER fields were flagged (issuer "Matched by logo only", reference garble). Take those away and it files into the wrong month.
- **Harm + severity:** trust-eroded / misfile-by-month. MOD-HIGH.
- **Class:** QUESTION — why did the "please verify" that appears on other date disagreements not appear here?
- **Proposed alternative:** when the page's own printed text reads a date differently from the remembered box, show *"The page reads 24-05-2025 here — please check"* and treat it as a hold (the Processing tab describes such a check: *"Never file a date or reference by itself when the page's own text reads it differently… Off by default"*).
- **What I may be missing:** the scan is grey and skewed; perhaps the page text read the same wrong month.

### Card 3 — MOD (two screens disagree) — Import says "Ready to file" on rows whose reference is the word "Date"
- **Citation (Import results table after IMPORT2):** 13 rows *"Pelican Office Interiors | … | Date | Ready to file"*; Review for the same documents: *"Pelican Office Interiors 40 documents · 40 need a look"*; File All Ready #2: *"File 4 ready documents (of 171)… 140 flagged"* — none of the 13 filed.
- **User-moment:** reading the batch result to decide whether I could go home.
- **Observed confusion:** I would tell the boss "13 more are ready", then find Review holding all of them.
- **Harm + severity:** slowed / trust-eroded. MOD. (File All was the honest one.)
- **Class:** CONFUSION.
- **Proposed alternative:** the Import list should use the same word Review uses ("Check") for anything Review would hold; and a reference that reads "Date" should never be labelled ready.
- **What I may be missing:** the Import table may be a snapshot from before the later checks ran.

### Card 4 — MOD (feature invisible) — the new "Barcode / QR code" field shows nothing, not even "none found"
- **Citation (Settings → Document Types → Statement, shot109):** field row *"Barcode · barcode · TYPE Barcode / QR code"*; Review after Reprocess of a statement: fields *Document Issuer, Customer, Statement Number, Statement Date, Balance Due* — no Barcode row, no text containing "barcode" anywhere in the window.
- **User-moment:** I added the field the owner told me about and went to see it on a statement.
- **Observed confusion:** I would think the field failed to save, go back to Settings, see it saved, and give up. I can't tell whether the app looked for a barcode and found none (these test pages carry none) or never looked.
- **Harm + severity:** slowed / feeling stupid. MOD.
- **Class:** QUESTION.
- **Proposed alternative:** always show the row: *"Barcode — none found on this page"* / *"Barcode — 3 found, pick one"*. Also keep barcode fields out of the Main-number/Date role lists (my helper set "Date" = Barcode and the app accepted it; a row then said "Needs: Barcode").
- **What I may be missing:** Processing has "Read the barcodes printed on each page… Off by default" — maybe both switches must be on and the Settings text should say so beside the field type.

### Card 5 — MOD (asks me to choose between two wrong answers) — after a re-teach the siblings re-read themselves, then offer two garbles
- **Citation (Review, Silverbeck 0013, three minutes after my teach):** *"'ss-onnea275' doesn't appear on this page as written — please check the reference before filing. Read differently after learning — was 'ss-oo9e275', now 'ss-onnea275'. Please check which is right. Use "ss-oo9e275" · Keep "ss-onne…""*
- **User-moment:** the owner's test (c) — teach one, watch the rest.
- **Observed confusion:** the app went back over the others by itself (good — I saw it), but both readings are wrong and the same panel admits neither is on the page; a "Use" button for a value the app says isn't printed invites a wrong click.
- **Harm + severity:** slowed / warning fatigue (41 Silverbeck + 41 Pelican still waiting at the end). MOD.
- **Class:** QUESTION.
- **Proposed alternative:** *"Neither reading matches the page — draw the box again on this one"*, and no Use/Keep buttons when the page-check fails.
- **What I may be missing:** these are deliberately grey, skewed copies; on clean paper the re-read may simply work.

### Card 6 — LOW-MOD (invented senders with a promise) — "Ticket Type · 1 document · 5 more to file by itself"
- **Citation (Review queue heads):** *"DOCUMENT OLUTIONS 1 document · 1 needs a look · 5 more to file by itself"*, *"Ticket Type 1 document …"*, *"Pelican Oiites Interiors 1 document …"*.
- **User-moment:** after importing the real-world worksheets and the degraded scans.
- **Observed confusion:** I read it as "the app is on its way to filing things under 'Ticket Type' by itself". Three folders-to-be with nonsense names.
- **Harm + severity:** trust-eroded. LOW-MOD (all held).
- **Class:** QUESTION / PREFERENCE.
- **Proposed alternative:** group unconfirmed guesses under "Sender not identified (guess: Ticket Type)" and don't show "N more to file by itself" for a sender no one has ever confirmed.
- **What I may be missing:** "5 more" may mean "confirm 5 more first" — which is the wording problem from round 4 (Card 3) still here.

### Card 7 — LOW (stale words) — the panel keeps saying yesterday's thing
- **Citations:** after I set the type to Delivery Note and boxed "Oakhaven Electrical Wholesale", the blue box still read *"Nothing looks wrong — this is only the second document from Bramblewood Joinery Ltd…"* and the button *"Change what's read from Bramblewood Joinery Ltd's documents"*; after filing the last SINGLE document the empty queue still showed *"✓ The label to the left: Balance Due → 4,142.35"* and the "Teach this document" panel (shot77); after **Delete All Review** the screen said *"✓ All reviewed — All documents reviewed ✓"* (I had just binned 167); the queue row said "Sender not identified · Needs: a document type" while the panel said "Bramblewood · Purchase Order".
- **Harm:** cosmetic-to-trust. LOW. **Class:** CONFUSION.
- **Proposed:** refresh the blue box and row when type/issuer change; on an emptied-by-delete queue say *"Queue emptied — 167 in the recycle bin"*.
- **What I may be missing:** some of these refresh on the next click; I'm reporting the moment.

### Card 8 — LOW (Learning Repair wording)
- **Citation (Settings → Learning Repair, Harrowgate, shot103):** *"A few documents worth a look — • Might not belong — Silverbeck-Cleaning_sales_order_0011.pdf This document looks quite different from the others of this type — worth a quick check."* under the HARROWGATE heading; after Start fresh: *"Learned from 41 documents · last 27 Aug 2026 · logo known — Not yet — 5 more confirms"*.
- **Observed confusion:** "Might not belong" to what? I clicked Harrowgate and got Silverbeck's papers. And "Learned from 41 documents" right after being told it forgot them.
- **Harm:** slowed. LOW. **Class:** CONFUSION.
- **Proposed:** *"Might not belong to Sales Order (it is filed under Silverbeck)"*; after Start fresh: *"Forgotten — 41 documents stay filed but no longer teach"*.
- **What I may be missing:** the "worth a look" box is per document type by design.

**Also noticed, not carded:** the sender-confirm question is labelled *"Needs a quick check — 1 field was flagged by a formatting check"* (it's a "is this the sender, not the customer?" question, not formatting); the readout bar's label box read *"CATES ORDER NO"*; "Fields read by: Unknown"; before a type is chosen the labels say INVOICE DATE / INVOICE NUMBER on a delivery note whose paper says Despatch Ref / Delivery Date.

## The question I'd ask the owner (not a card, because the app did what its label says)
The box is called **"Document Issuer"**, and on a purchase order we send out, the issuer is us. So 43 of our own POs now live under `Bramblewood-Joinery-Ltd\…` — a folder with our own name on it — instead of under Quillstone, the supplier we sent them to. On my shelf, an order to Quillstone goes in the Quillstone folder. Is the folder named after us intended? If yes, say so once at the first such teach: *"Orders you send will file under your own company name."*

---

## Previously-reported items — verifies
- **FIXED — "Add 'Quotation'" form opened with the name blank (r5 Card 5):** name pre-filled "Quotation".
- **FIXED — practice run leaked a stale hint onto the next sample (r5 Card 6):** document 3 was clean.
- **BETTER-BUT — Pelican table layout piles up (r5 Card 1):** drawing boxes on one Pelican invoice made the next 40 read *something* (they're grey scan-copies: 13 read "Date" as the number, others garbles), all held — no silent misfile, but Pelican is still 41 deep at the end.
- **BETTER — first big batch files nothing (r5 Card 3):** cold batch still 0/200 by itself, but File All Ready then filed 115 in one honest click and the warm batch filed 116/200 alone (r5: 98).
- **BETTER — no-sender documents scatter into Unknown Company (r5 Card 4):** typing a sender once offered *"25 more unfiled documents look like the same sender. Apply… & re-read"* — one click named 25. The plain native *"Document Issuer is blank… File it anyway?"* box still appears when the app has no suggestion (this statement prints no company name).
- **STILL PRESENT — Terms say "WORKING DRAFT — NOT YET IN FORCE" + "[SOLICITOR:]" (every round).**
- **STILL PRESENT — "N more to file by itself" count wording (r4 Card 3).**
- **NEW-PROBLEM — Card 1 above (buyer-issued PO teach re-badging supplier papers).** Round 5 saw 3/20 attach to Bramblewood; tonight it went further: wrong TYPE too, with "Nothing looks wrong".
- **Not seen tonight:** the draw-a-box nudge (I never typed a date or number, so it had no reason to fire); the Put-back tooltip wording (r4 Card 6) — didn't hover it.

## Warnings truth-table
| Button | It warned | What actually happened | Truthful? |
|---|---|---|---|
| Confirm & File, blank sender | "…filed under 'Unknown Company' and the app won't learn this sender. File it anyway?" | `Unknown-Company\2025\May\Statement.24-05-2025.ITH-0093.pdf` | ✅ |
| File All Ready #1 | "File 115 ready documents (of 199)… 75 flagged… 9 missing… filed exactly as if you confirmed it yourself" | 115 filed in 26 s, 84 left, 0 wrong company/type | ✅ |
| File All Ready #2 | "File 4 ready documents (of 171)… 140 flagged… 27 missing" | 4 filed; the 13 "Ready to file / Date" Pelican rows refused | ✅ |
| Send back to Review | "It stays filed until you re-confirm it." | row "↩ put back"; on re-confirm it moved from Unknown-Company to Ironclad-Tool-Hire | ✅ |
| Delete (one) | "It goes to the app's recycle bin — you can restore it from Search." | Review 167→166, bin 1; Restore → 167 | ✅ |
| Delete All Review | "Delete ALL 167… recycle bin… Files on disk are kept. Confirmed and deferred documents are NOT affected." | Review 0; Output unchanged; Restore all → 167 in the same groups | ✅ (then said "All documents reviewed ✓") |
| Restore all | "They go back to where they were deleted from (the review queue, or their filed folder)." | 167 back | ✅ |
| Empty bin | "Permanently delete all 1 document… including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched." | bin empty; original still in `SCANNED\Processed` | ✅ |
| Start fresh with this sender | "forgets 1 layout and 45 remembered values… 41 filed documents stay where they are… You can undo this." | status → "Not yet — 5 more confirms"; 242 files untouched; Undo → "Files by itself"; next Harrowgate scan filed itself | ✅ |
| Reprocess all in queue | "Re-read all 167… may replace what's shown… filed documents not touched… anything that re-reads clean will file straight away — you'll see it… with a Put back." | (I cancelled — read only) | — |
| Split PDF (1-page doc) | no message I could capture | nothing happened | ? (couldn't test a multi-page split) |
| Reprocess (one) | no warning | re-read; same values | ✅ |

## What genuinely worked
The put-back road: Search found the misfiled statement in seconds, "Send back to Review" said exactly what it would do, typing the sender once offered to name 25 siblings, and the folder fixed itself — 279/279 under the right company at the end. And the duplicate handling: 33 copies I fed it twice all came back as "-DUPLICATE" beside the original, nothing overwritten, exactly as the Files & filing tab promised.

## TOP friction point
Card 1. One box I was told to draw ("Document Issuer") made the app confidently wrong about three other suppliers' papers and *tell me nothing looked wrong*. It didn't misfile, but only because two of them were missing a number.

---

## Settings — tab by tab (as the office manager with the admin login)

**Files & filing (shot90).** Understood every control from its words: output folder, "Processed scans folder", "Keep original scans after filing" (the sentence about the recycle bin never destroying my only copy is the most reassuring line in the app), watch folder ("files must be stable for 30 seconds" — plain), folder-structure and file-name blocks with a live preview, duplicate labels. Wanted: it. Wouldn't touch: nothing here frightens me. Missing: a "test it with one scan" button. Word I'd stumble on: "Issuer" (I say "company").

**Document Types (shot91).** Clear list, built-in vs custom, per-field TYPE dropdown with a good tip, "Also appears as", filing roles. Frightening: the ✕ on a field (no warning shown — I didn't press it). Missing: the role lists let me pick a Barcode field as the Date (my helper did) — that shouldn't be offered. Words I couldn't say aloud: `supplier_name`, `invoice_number` (the grey code under each field name), "Keywords · 1", "Field visibility…".

**Processing (shot92).** This is the one that frightens me. Above the fold it's fine: auto-file on/off, the 90% bar with a sentence I understand, "Clean confirmations before a sender is trusted (5)". Below it there are roughly **fifty** switches with paragraph-long explanations: "Don't ask about a name disagreement other readings already settled", "Let a reprocess clear out stale hidden working figures", "Hold a detail the background re-read filled in for the first time when the same box misread it on a sibling", "Never file a date or reference by itself when the page's own text reads it differently", "Straighten crooked scans before reading them… not yet recommended". I would never touch any of them, I couldn't say most of them to a colleague, and yet two of them describe tonight's Cards 1 and 2 word for word. What I actually wanted from this tab: three things — how hard to work, how sure it must be before filing, and "ask me before filing anything from a sender I taught myself". Missing: a "Recommended / Advanced" split so the wall is behind a door.

**Appearance (shot93).** Themes (I picked Light), "Close button minimises to the tray" (plain), Home-screen cards. No fear, nothing missing.

**Templates (shot94).** "TEMPLATE VIEWER & ANCHOR MAPPING… anchor → target zone field mappings… standard extraction pipeline… Advanced: use only when standard extraction is repeatedly failing." I understood the list (a row per sender with "confirmed 41×") and nothing else. Wouldn't touch: "Scan for duplicate templates", "Re-link stray documents", "+ New Template". Words: template, anchor, mapping, extraction pipeline, "0 mappings".

**Learning (shot95).** Top half is good: "Suppliers handled automatically" with a tick per sender (that I WANT — it's the one switch I'd use). "Keyword label overrides" I half-understood ("extra words to look for"). "Learning Recovery" + the "Learned memory inventory" table (`__global__ · sales_order · supplier_name · Supplier hint · 3 · 3`) is for the developer, not me. Frightening: **"Clear ALL learning memory"** and **"Erase ALL data — fresh install"** sit at the bottom of the same tab as the per-sender ticks. Words: corpora, learning key, supplier hint, field anchor, `__unknown__`.

**Learning Repair (shot96/103–106).** The new list is the right idea: every sender with "Learned from N documents · last date · 1 layout · logo known" and a status ("Files by itself", "Not yet — 4 more confirms", "Paused after a correction"). Clicking a sender gives a status sentence, "Start fresh with this sender…" (warning honest, undo present), a "worth a look" box (Card 8), and the document list. Wanted: this. Missing: a way to say "this sender is right, stop asking".

**Users & activity (shot97).** Me as ADMIN, roles Admin/Edit/Read Only, "Reset password…", "+ Add User", and a recent-activity table ("document_open document #51", "supplier_ripple_applied"). Understood the top; the table is code-speak.

**Workflow (shot98).** "Automatically send a filed document to someone — for approval or just for information… When a [type] is filed and it's £[amount], send it to [person] for approval." Plain and rather nice; "Show me what this would do" is the button I'd press first. Couldn't test with a second user.

**Audit (shot99).** "492 events matched", filters, Export CSV, "Verify integrity". Fine for an IT person; I'd never open it. Words: "sanitised", "integrity".

**Licensing (shot100).** "Paid licence — active · 61 day(s) remaining", seats 1/1, "Workflow add-on licensed · 4 seats", an approval-stamp placer (nice), "Search seats". Frightening: "Activate a different key…". Words: "Merchant", "seat", "floating".

**Search client (shot101).** "Let the separate ScanFinder Search client connect over your network… loopback… TLS certificate". Off. Wouldn't touch. The "Set up the search client…" guide button is the right shape. Words: loopback, TLS, certificate.

**Advanced (shot102).** Re-run wizard, "View Terms & Disclaimer…", Backup & Restore ("Restore overwrites… This cannot be undone — export a backup first"), Diagnostic logging (with an honest "treat it as sensitive as the documents themselves"), anonymous diagnostics with "See exactly what's sent". Frightening in the right way; nothing missing.

**Overall on Settings:** Setup cluster = good. Administration cluster = built for the person who built it. The one tab a normal admin must visit — Processing — is the one I'd be scared to scroll.

---

## Two-week verdict
**Yes — I'd keep using it after two weeks, and pay.** 279 documents filed, every one under the right company and type, 149 of them without me; the batch chore I feared is gone. What I'd want before trusting it alone at the shop door: Card 1's "Nothing looks wrong" moment fixed (or the switch that says it prevents it made to work), the wrong-date-at-94% (Card 2) flagged, and the Terms finished.

## Humility / what I couldn't test
One simulated non-technical user, one pass, driven by a script that can't click Windows folder pickers (I set the two folders the way the screens would), that once accepted an "Unknown Company" dialog on my behalf, and that once put "Barcode" into the wrong dropdown — the Unknown-Company file and the "Needs: Barcode" row were my doing, not the app's. I couldn't test a multi-page split, the mailbox with a second person, the watch folder, backup/restore, licence activation, or the draw-a-box nudge (never typed a date). "Filed by itself" counts come from the app's own screens and the sidecar files on disk. All findings are suggestions for the owner to vet; I changed no code and nothing outside the sandbox.

**TL;DR again:** 472 in, 279 filed, 0 wrong company, 0 wrong type, 149 by itself; one box round our own name made the app confidently wrong and say "Nothing looks wrong"; every scary button told the truth; Terms still a draft. Would I keep it after two weeks? Yes.
