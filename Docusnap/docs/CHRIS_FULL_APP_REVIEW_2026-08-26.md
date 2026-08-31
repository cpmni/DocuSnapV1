# Chris The Customer — full app review — 2026-08-26

## Round (2026-08-26): Cards 1 & 4 DARK-switch verification (sandbox)

**Conditions:** isolated sandbox on CDP 9223 (PID 20704), fresh install (create-first-admin), newest
working-tree code. Armed: `position_teach_nudge=true` (Card 1), `issuer_suggest_on_blank_confirm=true`
(Card 4), plus `issuer_sibling_fill`, `letterhead_prefill`, `review_activity_strip`, `batch_audit_enabled`,
`auto_file_threshold=90`. Focused 54-doc corpus: Pelican-Office (18, table-layout → Card 1),
Castellan-Security (12) / Oakhaven-Electrical (8) / Ironclad-Tool-Hire (8) (blank-issuer → Card 4),
SINGLE (8 teach docs). Login `chris`/`plumber2026`. Leak check CLEAN (0 writes to the owner's real folder
after noon; all filing in the sandbox Output).

**Headline:** **Card 1 WORKS** (all four checks pass). **Card 4 was BROKEN as wired** — the offer read the
empty queue stub (`currentDoc.extractions`) instead of the full rendered doc, so it never fired on the real
flow; the modal + adopt + learn chain are sound when forced open. **FIXED same session** (renderer.js reads
`_lastRenderedDoc`, id-matched; pin added). A second, separate gap remains: the engine emits no
`issuer_suggested` for these clearly-branded senders (a detection arc, owner-vet).

---

### Chris's report (VERBATIM — transcribed from the completion notification; the live transcript comes back empty per the standing trap)

**Sandbox login I created:** `chris` / `plumber2026` · admin recovery code `YD9E-4ZE8-F5AA-WFWA`
**Armed & confirmed on the running app:** `position_teach_nudge=true` (Card 1), `issuer_suggest_on_blank_confirm=true` (Card 4), plus `issuer_sibling_fill`, `letterhead_prefill`, `review_activity_strip`, `batch_audit_enabled`; `auto_file_threshold=90`.
**Method note:** I'm one made-up office manager, not a room of testers. I drove the real sandbox app over CDP and photographed the meaningful steps. Native OS pickers (folder Browse) can't be clicked by my helper, so I set the output folder the way the Settings screen would; everything else is exactly what a customer clicks.

#### TL;DR (3 lines)
1. **Card 1 (draw-a-box nudge) WORKS** — fires once per sender, clear and non-blaming, never nags the Issuer, and correctly goes silent once you've drawn a box.
2. **Card 4 (blank-issuer steer) is BROKEN as wired** — the nice 3-button modal can't fire on the normal review flow, so a customer with a blank-issuer doc still gets the old bare "Unknown Company?" dialog. The modal itself and its three buttons are sound when I force it open.
3. Everything destructive told the truth (Delete / Empty Bin verified — original scans really survive), search finds filed docs instantly, and the draft Terms still say "NOT YET IN FORCE."

#### VERDICT — Card 1 (draw-a-box nudge): WORKS
Imported Pelican-Office (18 invoices). Fields sit in a table, so Reference + Date read blank (Issuer read fine as "Pelican Office Interiors"). I TYPED `PI/26/1755` + `24-06-2026` and pressed Confirm & File. The nudge fired, exact text (level `info`):

> "**Filed. Typing fixed these on this document only — future documents from Pelican Office Interiors will read Invoice Date and Invoice Number blank too. If they sit in the same place each time, draw a box (⊕) around one to teach Scan Finder where, and it reads them automatically.**"

All four checks pass:
- **Fires once, clear, non-blaming** — names the sender, states the consequence, gives the action + payoff. No blame.
- **Once per sender** — a second typed Pelican doc showed only the plain "Filed as …" message; the seen-marker read `{"pelican office interiors|invoice":1}`.
- **Drawing a box suppresses it** — clean A/B at the service boundary: a confirm with no `taught_fields` returned the nudge; an identical confirm carrying `taught_fields:['invoice_date','invoice_number']` returned `positionHint: null`. Only the taught-fields flag differed.
- **Never nags the Document Issuer** — the first nudge named only Invoice Date + Invoice Number, even though the Issuer was letterhead-prefilled (identity is excluded).

**Does it help a non-technical user?** Yes — it's the first time the app explains *why the next 40 came in blank*, and the tour already taught "draw a box… you teach it once", so the nudge reinforces a known idea.

#### VERDICT — Card 4 (blank-issuer steer): BROKEN (as wired) — the modal never reaches a real customer
Imported Castellan (12), Oakhaven (8), Ironclad (8). Could not trigger the 3-button modal on the normal flow, traced to a data-wiring gap, verified three ways:
- **Live queue-row shape:** review rows carry the scalar `issuer_suggested` (+ `issuer_blank`) but **no `extractions` array** (`hasExtractions:false`).
- **Code path:** on the standard open-from-queue → Confirm flow, `currentDoc` **is** the queue row (never reassigned to the full record). The Card 4 offer reads `currentDoc.extractions.find(...).suggested_supplier` — always empty — instead of the `issuer_suggested` scalar that is actually delivered.
- **Instrumentation:** during a real confirm, `issuerOfferForBlank` was called with `suggestedSupplier: undefined, note: undefined` → `{offer:false}` → fell through to the plain native "Unknown Company… File it anyway?" dialog.

**The modal itself is sound** (forced the offer to fire to test downstream):
- Renders correctly: "This document has no Document Issuer / The page looks like it's from **Ironclad Tool Hire**…" Buttons: `Go back` · `File as Unknown Company` · `File under "Ironclad Tool Hire"`.
- **"File under X"** → filed to `Ironclad-Tool-Hire\2026\June\Invoice.14-06-2026.ICT-5580.pdf`, and it **learned the sender** (reprocessing another Ironclad doc then read the issuer as "Ironclad Tool Hire", held with the safe "Matched by logo only…" note).
- **"File as Unknown Company"** → `Unknown-Company / 2026 / June`. **"Go back"** → filed nothing.
- **Plain path unchanged** — a no-suggestion doc shows the plain native Unknown dialog, no modal.
- **Nothing auto-fills silently** — adopt requires the explicit button click.

**Bottom line:** the modal + adopt + learning chain all work; the fix is small (read the suggestion from the full doc / `issuer_suggested`) — plus the separate detection gap of the engine not emitting a suggestion for these senders.

#### Warnings truth-table
| Button | Warned | Actually | Truthful? |
|---|---|---|---|
| Delete (single, from Review) | "goes to the app's recycle bin — you can restore it from Search." | review 39→38, bin 0→1, restorable | ✅ |
| Empty bin | "Permanently delete… **Your original scans in the Processed folder are not touched.**" | bin→0; **verified all 46 Processed originals still on disk** | ✅ |
| Reprocess (single) | (no warning — non-destructive) | re-read, updated issuer via learned logo | ✅ |
| File All Ready | "Nothing is ready to file yet…" | filed nothing; queue unchanged | ✅ |
| Confirm & File, blank issuer (no suggestion) | "…filed under 'Unknown Company'… File it anyway?" | filed to `Unknown-Company` | ✅ |

#### NEW finding cards (ranked by harm)
1. **Card 4 blank-issuer steer never fires on the normal flow — HIGH.** The offer reads `currentDoc.extractions` (queue rows carry none; the suggestion is the `issuer_suggested` scalar the offer ignores). The armed feature is inert. *(→ FIXED this session — renderer reads `_lastRenderedDoc`.)*
2. **Draft Terms still say "NOT YET IN FORCE" + "[SOLICITOR:]" — HIGH (trust), recurring.** Legal domain.
3. **Engine emits no sender suggestion for clearly-branded senders — MOD.** Ironclad hexagon-logo statements group under "Sender not identified"; every blank-issuer row had `issuer_suggested` empty. Compounds Card 4 (nothing to steer with). Detection arc — census + Oracle.
4. **Card 1 nudge is a 4-second toast for a two-line instruction, with no click-to-teach — LOW-MOD.** Consider a dismissable bar (like the class-fix bar) with a "Show me where to draw" action, or longer dwell.
5. **Wizard defaults the output folder to `Documents\Scan Finder` — LOW (note).** Fine for a real customer; only a concern in a test harness. PREFERENCE.

#### What genuinely worked
The honesty of the destructive warnings — Empty Bin's "your original scans… are not touched" is **verifiably true** (all 46 originals survived a bin-empty). And **Card 1 does exactly what it promises**: one clear, once-per-sender, non-blaming nudge that finally explains why a table-layout supplier keeps coming in blank, and it correctly steps aside the moment you draw a box.

#### Top friction
Card 4 — the feature the owner armed to reduce Unknown-Company scatter can't reach a customer (offer reads the wrong place). *(→ fixed.)*

#### Two-week verdict
**Yes — I'd keep it and pay.** Batch filing is genuinely eased, nothing misfiled across 46 docs and two sender-teaches, every scary button told the truth. Want the draft Terms finished and the blank-issuer steer actually wired up.

#### Humility / what I couldn't test
Single simulated persona, one pass — not a user study. Proved Card 1's draw-suppression and Card 4's wiring at the service/DOM boundary because the driver can't perform a pixel-accurate ⊕ canvas draw or click native OS pickers (a known round-5 limit), so no real freehand teach — teaching exercised via typed corrections + the Card 4 adopt (which learned the sender by logo). For Card 4, forced the offer open to confirm the modal/adopt/learn chain, and inferred "never fires" from code + live queue shape + instrumentation (the corpus produced no genuine `issuer_suggested` doc). Nothing implemented; every finding queued for the owner's vet. Leak check clean.

---

### Main-session follow-up (2026-08-26, post-round)
- **Card 4 wiring bug FIXED** (`renderer.js`): the confirm-door offer now reads the suggestion + note from
  `_lastRenderedDoc` (the full doc `renderFields` drew), id-matched to the doc being confirmed, instead of the
  empty `currentDoc` queue stub. Preserves the branding-provenance seam (the note is on the full doc; the
  `issuer_suggested` scalar has none). Pin added to `test_issuer_blank_offer.js` ("reads the FULL rendered
  doc, not the empty queue stub"); all issuer-blank-offer pins green.
- **Card 4 RE-VERIFIED END-TO-END on the running sandbox (2026-08-26).** The corpus emits no natural branding
  suggestion (finding 3), so a genuine branding-conflict shape (blank issuer + `suggested_supplier` + a "page
  branding reads 'X'" note — exactly what `_flag_branding_conflict` writes) was INJECTED onto a real held
  Pelican doc, then the REAL confirm flow was driven over CDP. After a Review-window reload (to clear polluted
  in-memory state), Confirm & File raised a FRESH 3-button modal carrying the injected name — `Go back` ·
  `File as Unknown Company` · `File under "Pelican Office Interiors"` — and "File under" filed the doc under
  that name (`status:confirmed, supplier_name:"Pelican Office Interiors"`) and LEARNED the sender (hints=9,
  logo=1, corrections=11). The wiring fix is proven: real confirm → full-doc suggestion+note → predicate →
  modal → adopt+learn. (Trap for next time: leftover modal overlays [z 99999] block queue-row clicks and leave
  `_lastRenderedDoc` stale — `page.reload()` the Review window between drives.) The DETECTION half — the engine
  emitting the suggestion for real branded senders — remains finding 3 (owner-vet arc).
- **Card 1 confirmed WORKING** by the round — no code change.
- **Owner-vet queue (unbuilt):** finding 2 (Terms, legal) · finding 3 (engine emits no suggestion for branded
  senders — a detection arc, census+Oracle, same class as `name_dominant_snap`/`branding_strip`) · finding 4
  (Card 1 nudge as a dismissable bar + click-to-teach) · finding 5 (wizard output-folder default note).
- Both DARK switches **stay DARK** pending: Card 4 an end-to-end re-verify on a suggestion-carrying doc; a
  Chris round on the copy for Card 1's live copy/UX. Nothing flipped, nothing committed.


---

# ROUND 2026-08-26 NIGHT / 08-27 (fresh sandbox, CDP 9223 PID 3060, CHRISBOT 472 docs; armed DARK switches: corrob_verification_doubt_clear, learning_repair_console/forget, barcode_inventory/field, quiet_reread_on_layout, list_field_scan) — transcribed VERBATIM from Chris's report file


# Chris The Customer â€” full app run-through â€” 2026-08-26/27 (sandbox, fresh install)

**Who I am tonight:** Chris Fenton, office manager, handed the admin login for the Settings part. One made-up person, not a user test. I drove the real sandbox app (CDP 9223, PID 3060) and photographed the meaningful steps (`chris-driver\shot01.png â€¦ shot116.png`). Login I created: `chris` / `plumber2026`, recovery code `CHXW-B5ET-C8NG-RQYS`. Everything I filed went to the sandbox `Output` folder (I caught the wizard defaulting to `Documents\Scan Finder` and changed it before anything filed). I never touched a path outside the sandbox; the independent leak check is the owner's.

## TL;DR (3 lines)
1. **Numbers:** 472 documents in, **279 filed, 279 under the right company, 0 wrong type, 0 unknown-date folders.** Cold batch filed 0/200 by itself but "File All Ready" filed 115 in one click (26 s); the warm batch filed **116/200 by itself** (round 5 managed 98); scanned copies 13/20 by themselves; 20 exact duplicates all filed by themselves with "-DUPLICATE".
2. **The scare:** I drew ONE box round our own company name on a purchase order (the box is labelled "Document Issuer" and that IS the issuer). The app then re-badged a supplier's delivery note, a credit note and a service worksheet as *our* purchase orders at 95% with the words **"Nothing looks wrong"** and a live Confirm button. Nothing filed wrong â€” two were held for a missing PO number and I caught the third â€” but the sentence was the opposite of the truth.
3. **Every scary button told the truth** (Delete, Delete All, Restore all, Empty bin, Send back, File All, Start fresh + Undo). Search found a document in under 4 seconds. The Terms are still a "WORKING DRAFT â€” NOT YET IN FORCE".

---

## Walkthrough (what I did, what I saw)

**First contact (shot01â€“shot17).** Create-admin screen is plain ("no default credentials" is the only phrase I'd say differently). Recovery-code screen keeps Continue greyed until I tick "I have saved this code" â€” good. Terms gate: Accept greyed until ticked â€” but the text I'm accepting opens with `WORKING DRAFT â€” FOR LEGAL REVIEW ONLY. NOT YET IN FORCE` and `[SOLICITOR: â€¦]` notes (shot03). Setup wizard, 7 steps, all plain English; the output-folder step defaulted to the owner's real `Documents\Scan Finder` (shot05) â€” I changed it. Step 3 (folder/file-name blocks with a live preview, plus a new "Regional format" section defaulting to UK dates) is the best-explained settings screen in the app. Tour: 6 cards, every sentence sayable aloud (shot11â€“16).

**Practice run (shot17â€“shot53).** Three samples; document 2 has "INV-1O42" and the run insists I draw the box ("Draw a box around the Reference to correct it, then Confirm" â€” Confirm looked pressable but wouldn't move on, which is fine, the pulsing value showed me where). After the box: "Nicely done â€” the reference now reads from the box you drew." Document 3 carried **no stale hint** from document 2 (last round's Card 6 â€” FIXED). End screen lists the three filed names and folders, and says the copies vanish when I close the window â€” clear.

**SINGLE (10 teach docs, shot55â€“shot77).** 10 processed, 10 needed me, company blank on 9/10 (first contact, fair). Per document:
- Nordwind quote â†’ "This looks like a Quotation, but you don't have that document type yetâ€¦" â†’ `Add "Quotation"` opened a form **with the name pre-filled** (last round's Card 5 â€” FIXED) â†’ filed to `Nordwind-Refrigeration-Ltd\2025\June\Quotation.10-06-2025.NRQ-8153.pdf`.
- Silverbeck order: three boxes (name, date, number) all read right first go; readout bar named the label it found as **"CATES ORDER NO"** (paper says SALES ORDER NO) â€” the value was right.
- Veltrix (white-on-orange name) â†’ box read it. Quillstone PO on **our own** letterhead â†’ I followed the label and boxed "Bramblewood Joinery Ltd" â†’ filed under `Bramblewood-Joinery-Ltd\â€¦\Purchase-Orderâ€¦` (see Card 1 and the question below).
- Oakhaven delivery note â†’ `Add "Delivery Note"` went to the catalog with Delivery Note pre-ticked (fine). **Then the trouble (shot67â€“69):** after the re-read the panel showed type *Purchase Order*, issuer *Bramblewood Joinery Ltd Â· High 95%*, "Recognised by: Its logo and wording", and the blue box said *"Nothing looks wrong â€” this is only the second document from Bramblewood Joinery Ltdâ€¦ Confirm it and it files â€” and it counts towards this sender filing on its own."* The queue grew a "Bramblewood Joinery Ltd Â· 2 documents Â· 2 need a look Â· 2 more to file by itself" group holding **Meadowvale's credit note and Castellan's worksheet**, both "Needs: PO Number". I corrected all three by hand (type + boxes); the blue box stayed stale ("Nothing looks wrongâ€¦Bramblewood") after my corrections until I filed.
- Pelican invoice (table layout): "Teach this document â€” We recognise this sender but haven't learned this layout yet" sat above a page whose chip said "Not seen before" and whose sender box said "Not found" â€” one of those isn't true. Three boxes read right â†’ filed.
- Ironclad statement: **no company name printed anywhere** (just a logo). My helper fumbled typing the name and then pressed OK for me on *"Document Issuer is blank. This document will be filed under 'Unknown Company' and the app won't learn this sender. File it anyway?"* â€” it did exactly that (`Unknown-Company\2025\May\Statement.24-05-2025.ITH-0093.pdf`). My fault, but a truthful warning.
- After the last confirm the empty queue still showed the previous document's readout bar and teach panel (shot77).

**IMPORT â€” 200 cold (shot78â€“shot83).** 2.5 minutes. "âœ“ 200 processed â€” 60 need your review before filing, 140 ready." **0 filed by itself.** Every taught sender recognised 20/20 (the 20 "â€”" were Ironclad, never named). Review grouped by sender with heads like "Pelican Office Interiors 20 documents Â· 20 need a look Â· 2 more to file by itself". Opened one per group: Pelican 0012 read the invoice number as the word **"Date"** (70%, "auto-correctedâ€¦ please verify"); Silverbeck 0012 read **"s8-onne0722"** for SB-ORD60722 (flagged "doesn't appear on this page as written"); Nordwind 0012 "Nothing was flagged â€” read at 89%, just below the 90% you've set" (clear). These IMPORT pages are grey, slightly skewed scan-copies.

**Owner's test (c) â€” teach one, watch the siblings (shot82).** Re-drew the order-number box on Silverbeck 0012 and filed it at 00:11:41. Group head unchanged for 135 s ("19 need a look"), **but** opening sibling 0013 three minutes later showed *"Read differently after learning â€” was 'ss-oo9e275', now 'ss-onnea275'. Please check which is right. Use "ss-oo9e275" / Keep "ss-onneâ€¦"* â€” so yes, the others were re-read by themselves; on these grey copies they came back with a different wrong answer (Card 5).

**File All Ready #1.** Dialog: *"File 115 ready documents (of 199 in the Review queue)? Not included â€” they stay in the queue: â€¢ 75 flagged â€” waiting for you to check a value â€¢ 9 missing a required detail (date, reference or sender). Each one is filed exactly as if you confirmed it yourselfâ€¦"* â†’ 115 filed in 26 s; receipt *"âœ“ Filed 115 documents â€” Bramblewood Joinery Ltd (20), Oakhaven (20), Harrowgate (20), Castellan (20), Veltrix (18), Nordwind (13) and 1 more. â€” 84 not ready to fileâ€¦ New senders need a few confirms before they file themselves â€” the next batch will file more on its own."* Audit on disk: 126 filed, 125 right company, 0 wrong, 1 Unknown-Company (mine).

**IMPORT2 â€” 200 warm.** "âœ“ 200 processed â€” 69 need your review before filing, 131 ready." **116 filed by itself (58%).** Import table: Veltrix 20/20, Bramblewood 20/20, Oakhaven 20/20, Harrowgate 20/20, Castellan 20/20 auto; Nordwind 10 auto; Meadowvale 6 auto; Pelican 0, Silverbeck 0, Ironclad 0. On disk 242 filed, 0 wrong. Review banner: *"âœ“ 123 documents filed automatically â€” click to see the list â€” they stay filed; nothing is changed."*

**Search + put back (shot85â€“shot88).** Searched "ITH-0093": found the Unknown-Company statement in ~3 s (plus 40 unconfirmed Ironclad statements, because that number is also their account number). "â†© Send back to Review" â†’ *"Send this document back to the Review queue? It stays filed until you re-confirm it."* â†’ row marked "â†© put back", note "Sent back from Search â€” please re-check this document before filing." Typed the sender â†’ offer: **"25 more unfiled documents look like the same sender. Apply 'Ironclad Tool Hire' to 25 & re-read / Not now"** â†’ took it â†’ new "Ironclad Tool Hire 25 documents" group; "Sender not identified" 42 â†’ 16. Filed the statement â†’ Unknown-Company folder gone; 242/242 right company.

**Settings (shot90â€“shot109) â€” see the tab-by-tab section.** Learning Repair (owner's test a): clicked "Harrowgate Timber Supplies Â· Sales Order" â†’ *"Learned from 41 documents, last on 27 Aug 2026. Files by itself. 1 layout remembered. Sending a document back is what un-teaches it."* â†’ "Start fresh with this senderâ€¦" â†’ *"This forgets 1 layout and 45 remembered values and taught positions. 41 filed documents stay where they are and stop teaching. The next Sales Order from Harrowgate Timber Supplies will wait for you to check it, like a new sender. The sender is still recognised by its logo. You can undo this."* â†’ yes â†’ row read "Not yet â€” 5 more confirms" (layout chip gone; "Learned from 41 documents" still shown) â†’ "Undo start fresh" â†’ back to "1 layout Â· Files by itself"; Output unchanged (242 â†’ 242). Then imported the SCANNED Harrowgate order: **filed by itself** (as a -DUPLICATE). Clear enough what happened to my filed documents â€” the warning said "stay where they are" and they did.

Barcode (owner's test b): Document Types â†’ Statement â†’ added a field "Barcode", type "Barcode / QR code" (my helper first mis-set the Date filing role to "Barcode"; I put it back â€” the app let that happen without a word, and one queue row briefly read "Needs: Barcode"). Then reprocessed a statement: **no Barcode row appeared and nothing said whether a barcode was looked for** (Card 4).

**SCANNED (10):** 7 by itself (all "-DUPLICATE"), 3 held. **SCANNED_HARD (10):** 6 by itself, 1 ready, 3 held â€” including a sender invented as **"Pelican Oiites Interiors"** (held, no date/ref). The scanned Ironclad statement read the date **24-06-2025 at "High Â· 94%"** against a page printing 24-05-2025, with no warning on that field (Card 2). **DOC SOL (22 real worksheets):** 0 filed, 22 held, typed "Service Worksheet", every sender blank except two invented ones: **"Ticket Type"** and **"DOCUMENT OLUTIONS"** (each now a sender group promising "5 more to file by itself"). **test (20 exact duplicates of IMPORT):** 20/20 by itself as -DUPLICATE.

**Scary buttons (shot111â€“113):** see the truth table. Boss-on-the-phone: "Harrowgate" + March 2025 â†’ 1 result (HTS-SO-25996, 06-03-2025), and the exact number â†’ 1 result; 6.7 s for both searches including my typing. Home at the end: *"192 waiting in the review queue Â· 273 filed today Â· 279 last 7 days Â· 6 senders file by themselvesâ€¦ learned 9 layouts Â· 149 filed by themselves in the last 7 days."*

---

## NEW finding cards (ranked by harm)

### Card 1 â€” HIGH (trust; a near-miss misfile) â€” one box round our own name turned three supplier papers into "our" purchase orders, and the app said "Nothing looks wrong"
- **Citation (Review, Oakhaven delivery note, shot67):** *"Nothing looks wrong â€” this is only the second document from Bramblewood Joinery Ltd, so there isn't enough confirmed history yet to check Document Issuer on its own. Confirm 2 more and the rest from this sender can start filing themselves."* / *"Recognised by: Its logo and wording"* / DOCUMENT ISSUER *"Bramblewood Joinery Ltd High Â· 95%"* / type dropdown *"Purchase Order"* / queue head *"Bramblewood Joinery Ltd Â· 2 documents Â· 2 need a look Â· 2 more to file by itself"*.
- **User-moment:** I had just followed the label "Document Issuer" on a purchase order printed on OUR letterhead, and moved to the next document (a GOODS DELIVERY NOTE from Oakhaven).
- **Observed confusion:** I would read "Nothing looks wrong" + a green 95% + a live Confirm and press it, filing Oakhaven's delivery note as `Bramblewood-Joinery-Ltd\2026\January\Purchase-Order.22-01-2026.PO-46500.pdf` â€” and it would "count towards this sender filing on its own". The Meadowvale credit note and Castellan worksheet were re-badged the same way (held only because "PO Number" was missing).
- **Harm + severity:** trust-eroded, one click from a wrong-company + wrong-type file. HIGH. (Nothing actually misfiled.)
- **Class:** CONFUSION (the screen misreads the situation) + QUESTION (Settings â†’ Processing has a switch that describes this exact case â€” *"Stop a purchase-order layout claiming documents that say they are something elseâ€¦ Off by default"* â€” and it showed ON in my sandbox; I don't know why it didn't stop it).
- **Proposed alternative:** when the name I box is also printed in the CUSTOMER/BILL TO box of the same page, ask before saving: *"'Bramblewood Joinery Ltd' also appears as the customer on this page. Save it as the sender for this layout?"* And never print "Nothing looks wrong" when the type the app chose differs from the heading printed on the page â€” say *"The page says GOODS DELIVERY NOTE but this layout is a Purchase Order â€” please check the type."*
- **What I may be missing:** the owner has ruled that our own POs file under our name; maybe the fix belongs to the moment the layout is matched, not the teach.

### Card 2 â€” MOD-HIGH (silent wrong read) â€” a wrong date shown as "High Â· 94%" with no warning
- **Citation (Review, scanned Ironclad statement, shot108):** *"STATEMENT DATE High Â· 94%"* value *"24-06-2025"*; the page prints *"Date 24-05-2025"*. Same after "Reprocess".
- **User-moment:** checking the last scanned statement before File All.
- **Observed confusion:** I would trust a green "High" and file into June. This document was only held because two OTHER fields were flagged (issuer "Matched by logo only", reference garble). Take those away and it files into the wrong month.
- **Harm + severity:** trust-eroded / misfile-by-month. MOD-HIGH.
- **Class:** QUESTION â€” why did the "please verify" that appears on other date disagreements not appear here?
- **Proposed alternative:** when the page's own printed text reads a date differently from the remembered box, show *"The page reads 24-05-2025 here â€” please check"* and treat it as a hold (the Processing tab describes such a check: *"Never file a date or reference by itself when the page's own text reads it differentlyâ€¦ Off by default"*).
- **What I may be missing:** the scan is grey and skewed; perhaps the page text read the same wrong month.

### Card 3 â€” MOD (two screens disagree) â€” Import says "Ready to file" on rows whose reference is the word "Date"
- **Citation (Import results table after IMPORT2):** 13 rows *"Pelican Office Interiors | â€¦ | Date | Ready to file"*; Review for the same documents: *"Pelican Office Interiors 40 documents Â· 40 need a look"*; File All Ready #2: *"File 4 ready documents (of 171)â€¦ 140 flagged"* â€” none of the 13 filed.
- **User-moment:** reading the batch result to decide whether I could go home.
- **Observed confusion:** I would tell the boss "13 more are ready", then find Review holding all of them.
- **Harm + severity:** slowed / trust-eroded. MOD. (File All was the honest one.)
- **Class:** CONFUSION.
- **Proposed alternative:** the Import list should use the same word Review uses ("Check") for anything Review would hold; and a reference that reads "Date" should never be labelled ready.
- **What I may be missing:** the Import table may be a snapshot from before the later checks ran.

### Card 4 â€” MOD (feature invisible) â€” the new "Barcode / QR code" field shows nothing, not even "none found"
- **Citation (Settings â†’ Document Types â†’ Statement, shot109):** field row *"Barcode Â· barcode Â· TYPE Barcode / QR code"*; Review after Reprocess of a statement: fields *Document Issuer, Customer, Statement Number, Statement Date, Balance Due* â€” no Barcode row, no text containing "barcode" anywhere in the window.
- **User-moment:** I added the field the owner told me about and went to see it on a statement.
- **Observed confusion:** I would think the field failed to save, go back to Settings, see it saved, and give up. I can't tell whether the app looked for a barcode and found none (these test pages carry none) or never looked.
- **Harm + severity:** slowed / feeling stupid. MOD.
- **Class:** QUESTION.
- **Proposed alternative:** always show the row: *"Barcode â€” none found on this page"* / *"Barcode â€” 3 found, pick one"*. Also keep barcode fields out of the Main-number/Date role lists (my helper set "Date" = Barcode and the app accepted it; a row then said "Needs: Barcode").
- **What I may be missing:** Processing has "Read the barcodes printed on each pageâ€¦ Off by default" â€” maybe both switches must be on and the Settings text should say so beside the field type.

### Card 5 â€” MOD (asks me to choose between two wrong answers) â€” after a re-teach the siblings re-read themselves, then offer two garbles
- **Citation (Review, Silverbeck 0013, three minutes after my teach):** *"'ss-onnea275' doesn't appear on this page as written â€” please check the reference before filing. Read differently after learning â€” was 'ss-oo9e275', now 'ss-onnea275'. Please check which is right. Use "ss-oo9e275" Â· Keep "ss-onneâ€¦""*
- **User-moment:** the owner's test (c) â€” teach one, watch the rest.
- **Observed confusion:** the app went back over the others by itself (good â€” I saw it), but both readings are wrong and the same panel admits neither is on the page; a "Use" button for a value the app says isn't printed invites a wrong click.
- **Harm + severity:** slowed / warning fatigue (41 Silverbeck + 41 Pelican still waiting at the end). MOD.
- **Class:** QUESTION.
- **Proposed alternative:** *"Neither reading matches the page â€” draw the box again on this one"*, and no Use/Keep buttons when the page-check fails.
- **What I may be missing:** these are deliberately grey, skewed copies; on clean paper the re-read may simply work.

### Card 6 â€” LOW-MOD (invented senders with a promise) â€” "Ticket Type Â· 1 document Â· 5 more to file by itself"
- **Citation (Review queue heads):** *"DOCUMENT OLUTIONS 1 document Â· 1 needs a look Â· 5 more to file by itself"*, *"Ticket Type 1 document â€¦"*, *"Pelican Oiites Interiors 1 document â€¦"*.
- **User-moment:** after importing the real-world worksheets and the degraded scans.
- **Observed confusion:** I read it as "the app is on its way to filing things under 'Ticket Type' by itself". Three folders-to-be with nonsense names.
- **Harm + severity:** trust-eroded. LOW-MOD (all held).
- **Class:** QUESTION / PREFERENCE.
- **Proposed alternative:** group unconfirmed guesses under "Sender not identified (guess: Ticket Type)" and don't show "N more to file by itself" for a sender no one has ever confirmed.
- **What I may be missing:** "5 more" may mean "confirm 5 more first" â€” which is the wording problem from round 4 (Card 3) still here.

### Card 7 â€” LOW (stale words) â€” the panel keeps saying yesterday's thing
- **Citations:** after I set the type to Delivery Note and boxed "Oakhaven Electrical Wholesale", the blue box still read *"Nothing looks wrong â€” this is only the second document from Bramblewood Joinery Ltdâ€¦"* and the button *"Change what's read from Bramblewood Joinery Ltd's documents"*; after filing the last SINGLE document the empty queue still showed *"âœ“ The label to the left: Balance Due â†’ 4,142.35"* and the "Teach this document" panel (shot77); after **Delete All Review** the screen said *"âœ“ All reviewed â€” All documents reviewed âœ“"* (I had just binned 167); the queue row said "Sender not identified Â· Needs: a document type" while the panel said "Bramblewood Â· Purchase Order".
- **Harm:** cosmetic-to-trust. LOW. **Class:** CONFUSION.
- **Proposed:** refresh the blue box and row when type/issuer change; on an emptied-by-delete queue say *"Queue emptied â€” 167 in the recycle bin"*.
- **What I may be missing:** some of these refresh on the next click; I'm reporting the moment.

### Card 8 â€” LOW (Learning Repair wording)
- **Citation (Settings â†’ Learning Repair, Harrowgate, shot103):** *"A few documents worth a look â€” â€¢ Might not belong â€” Silverbeck-Cleaning_sales_order_0011.pdf This document looks quite different from the others of this type â€” worth a quick check."* under the HARROWGATE heading; after Start fresh: *"Learned from 41 documents Â· last 27 Aug 2026 Â· logo known â€” Not yet â€” 5 more confirms"*.
- **Observed confusion:** "Might not belong" to what? I clicked Harrowgate and got Silverbeck's papers. And "Learned from 41 documents" right after being told it forgot them.
- **Harm:** slowed. LOW. **Class:** CONFUSION.
- **Proposed:** *"Might not belong to Sales Order (it is filed under Silverbeck)"*; after Start fresh: *"Forgotten â€” 41 documents stay filed but no longer teach"*.
- **What I may be missing:** the "worth a look" box is per document type by design.

**Also noticed, not carded:** the sender-confirm question is labelled *"Needs a quick check â€” 1 field was flagged by a formatting check"* (it's a "is this the sender, not the customer?" question, not formatting); the readout bar's label box read *"CATES ORDER NO"*; "Fields read by: Unknown"; before a type is chosen the labels say INVOICE DATE / INVOICE NUMBER on a delivery note whose paper says Despatch Ref / Delivery Date.

## The question I'd ask the owner (not a card, because the app did what its label says)
The box is called **"Document Issuer"**, and on a purchase order we send out, the issuer is us. So 43 of our own POs now live under `Bramblewood-Joinery-Ltd\â€¦` â€” a folder with our own name on it â€” instead of under Quillstone, the supplier we sent them to. On my shelf, an order to Quillstone goes in the Quillstone folder. Is the folder named after us intended? If yes, say so once at the first such teach: *"Orders you send will file under your own company name."*

---

## Previously-reported items â€” verifies
- **FIXED â€” "Add 'Quotation'" form opened with the name blank (r5 Card 5):** name pre-filled "Quotation".
- **FIXED â€” practice run leaked a stale hint onto the next sample (r5 Card 6):** document 3 was clean.
- **BETTER-BUT â€” Pelican table layout piles up (r5 Card 1):** drawing boxes on one Pelican invoice made the next 40 read *something* (they're grey scan-copies: 13 read "Date" as the number, others garbles), all held â€” no silent misfile, but Pelican is still 41 deep at the end.
- **BETTER â€” first big batch files nothing (r5 Card 3):** cold batch still 0/200 by itself, but File All Ready then filed 115 in one honest click and the warm batch filed 116/200 alone (r5: 98).
- **BETTER â€” no-sender documents scatter into Unknown Company (r5 Card 4):** typing a sender once offered *"25 more unfiled documents look like the same sender. Applyâ€¦ & re-read"* â€” one click named 25. The plain native *"Document Issuer is blankâ€¦ File it anyway?"* box still appears when the app has no suggestion (this statement prints no company name).
- **STILL PRESENT â€” Terms say "WORKING DRAFT â€” NOT YET IN FORCE" + "[SOLICITOR:]" (every round).**
- **STILL PRESENT â€” "N more to file by itself" count wording (r4 Card 3).**
- **NEW-PROBLEM â€” Card 1 above (buyer-issued PO teach re-badging supplier papers).** Round 5 saw 3/20 attach to Bramblewood; tonight it went further: wrong TYPE too, with "Nothing looks wrong".
- **Not seen tonight:** the draw-a-box nudge (I never typed a date or number, so it had no reason to fire); the Put-back tooltip wording (r4 Card 6) â€” didn't hover it.

## Warnings truth-table
| Button | It warned | What actually happened | Truthful? |
|---|---|---|---|
| Confirm & File, blank sender | "â€¦filed under 'Unknown Company' and the app won't learn this sender. File it anyway?" | `Unknown-Company\2025\May\Statement.24-05-2025.ITH-0093.pdf` | âœ… |
| File All Ready #1 | "File 115 ready documents (of 199)â€¦ 75 flaggedâ€¦ 9 missingâ€¦ filed exactly as if you confirmed it yourself" | 115 filed in 26 s, 84 left, 0 wrong company/type | âœ… |
| File All Ready #2 | "File 4 ready documents (of 171)â€¦ 140 flaggedâ€¦ 27 missing" | 4 filed; the 13 "Ready to file / Date" Pelican rows refused | âœ… |
| Send back to Review | "It stays filed until you re-confirm it." | row "â†© put back"; on re-confirm it moved from Unknown-Company to Ironclad-Tool-Hire | âœ… |
| Delete (one) | "It goes to the app's recycle bin â€” you can restore it from Search." | Review 167â†’166, bin 1; Restore â†’ 167 | âœ… |
| Delete All Review | "Delete ALL 167â€¦ recycle binâ€¦ Files on disk are kept. Confirmed and deferred documents are NOT affected." | Review 0; Output unchanged; Restore all â†’ 167 in the same groups | âœ… (then said "All documents reviewed âœ“") |
| Restore all | "They go back to where they were deleted from (the review queue, or their filed folder)." | 167 back | âœ… |
| Empty bin | "Permanently delete all 1 documentâ€¦ including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched." | bin empty; original still in `SCANNED\Processed` | âœ… |
| Start fresh with this sender | "forgets 1 layout and 45 remembered valuesâ€¦ 41 filed documents stay where they areâ€¦ You can undo this." | status â†’ "Not yet â€” 5 more confirms"; 242 files untouched; Undo â†’ "Files by itself"; next Harrowgate scan filed itself | âœ… |
| Reprocess all in queue | "Re-read all 167â€¦ may replace what's shownâ€¦ filed documents not touchedâ€¦ anything that re-reads clean will file straight away â€” you'll see itâ€¦ with a Put back." | (I cancelled â€” read only) | â€” |
| Split PDF (1-page doc) | no message I could capture | nothing happened | ? (couldn't test a multi-page split) |
| Reprocess (one) | no warning | re-read; same values | âœ… |

## What genuinely worked
The put-back road: Search found the misfiled statement in seconds, "Send back to Review" said exactly what it would do, typing the sender once offered to name 25 siblings, and the folder fixed itself â€” 279/279 under the right company at the end. And the duplicate handling: 33 copies I fed it twice all came back as "-DUPLICATE" beside the original, nothing overwritten, exactly as the Files & filing tab promised.

## TOP friction point
Card 1. One box I was told to draw ("Document Issuer") made the app confidently wrong about three other suppliers' papers and *tell me nothing looked wrong*. It didn't misfile, but only because two of them were missing a number.

---

## Settings â€” tab by tab (as the office manager with the admin login)

**Files & filing (shot90).** Understood every control from its words: output folder, "Processed scans folder", "Keep original scans after filing" (the sentence about the recycle bin never destroying my only copy is the most reassuring line in the app), watch folder ("files must be stable for 30 seconds" â€” plain), folder-structure and file-name blocks with a live preview, duplicate labels. Wanted: it. Wouldn't touch: nothing here frightens me. Missing: a "test it with one scan" button. Word I'd stumble on: "Issuer" (I say "company").

**Document Types (shot91).** Clear list, built-in vs custom, per-field TYPE dropdown with a good tip, "Also appears as", filing roles. Frightening: the âœ• on a field (no warning shown â€” I didn't press it). Missing: the role lists let me pick a Barcode field as the Date (my helper did) â€” that shouldn't be offered. Words I couldn't say aloud: `supplier_name`, `invoice_number` (the grey code under each field name), "Keywords Â· 1", "Field visibilityâ€¦".

**Processing (shot92).** This is the one that frightens me. Above the fold it's fine: auto-file on/off, the 90% bar with a sentence I understand, "Clean confirmations before a sender is trusted (5)". Below it there are roughly **fifty** switches with paragraph-long explanations: "Don't ask about a name disagreement other readings already settled", "Let a reprocess clear out stale hidden working figures", "Hold a detail the background re-read filled in for the first time when the same box misread it on a sibling", "Never file a date or reference by itself when the page's own text reads it differently", "Straighten crooked scans before reading themâ€¦ not yet recommended". I would never touch any of them, I couldn't say most of them to a colleague, and yet two of them describe tonight's Cards 1 and 2 word for word. What I actually wanted from this tab: three things â€” how hard to work, how sure it must be before filing, and "ask me before filing anything from a sender I taught myself". Missing: a "Recommended / Advanced" split so the wall is behind a door.

**Appearance (shot93).** Themes (I picked Light), "Close button minimises to the tray" (plain), Home-screen cards. No fear, nothing missing.

**Templates (shot94).** "TEMPLATE VIEWER & ANCHOR MAPPINGâ€¦ anchor â†’ target zone field mappingsâ€¦ standard extraction pipelineâ€¦ Advanced: use only when standard extraction is repeatedly failing." I understood the list (a row per sender with "confirmed 41Ã—") and nothing else. Wouldn't touch: "Scan for duplicate templates", "Re-link stray documents", "+ New Template". Words: template, anchor, mapping, extraction pipeline, "0 mappings".

**Learning (shot95).** Top half is good: "Suppliers handled automatically" with a tick per sender (that I WANT â€” it's the one switch I'd use). "Keyword label overrides" I half-understood ("extra words to look for"). "Learning Recovery" + the "Learned memory inventory" table (`__global__ Â· sales_order Â· supplier_name Â· Supplier hint Â· 3 Â· 3`) is for the developer, not me. Frightening: **"Clear ALL learning memory"** and **"Erase ALL data â€” fresh install"** sit at the bottom of the same tab as the per-sender ticks. Words: corpora, learning key, supplier hint, field anchor, `__unknown__`.

**Learning Repair (shot96/103â€“106).** The new list is the right idea: every sender with "Learned from N documents Â· last date Â· 1 layout Â· logo known" and a status ("Files by itself", "Not yet â€” 4 more confirms", "Paused after a correction"). Clicking a sender gives a status sentence, "Start fresh with this senderâ€¦" (warning honest, undo present), a "worth a look" box (Card 8), and the document list. Wanted: this. Missing: a way to say "this sender is right, stop asking".

**Users & activity (shot97).** Me as ADMIN, roles Admin/Edit/Read Only, "Reset passwordâ€¦", "+ Add User", and a recent-activity table ("document_open document #51", "supplier_ripple_applied"). Understood the top; the table is code-speak.

**Workflow (shot98).** "Automatically send a filed document to someone â€” for approval or just for informationâ€¦ When a [type] is filed and it's Â£[amount], send it to [person] for approval." Plain and rather nice; "Show me what this would do" is the button I'd press first. Couldn't test with a second user.

**Audit (shot99).** "492 events matched", filters, Export CSV, "Verify integrity". Fine for an IT person; I'd never open it. Words: "sanitised", "integrity".

**Licensing (shot100).** "Paid licence â€” active Â· 61 day(s) remaining", seats 1/1, "Workflow add-on licensed Â· 4 seats", an approval-stamp placer (nice), "Search seats". Frightening: "Activate a different keyâ€¦". Words: "Merchant", "seat", "floating".

**Search client (shot101).** "Let the separate ScanFinder Search client connect over your networkâ€¦ loopbackâ€¦ TLS certificate". Off. Wouldn't touch. The "Set up the search clientâ€¦" guide button is the right shape. Words: loopback, TLS, certificate.

**Advanced (shot102).** Re-run wizard, "View Terms & Disclaimerâ€¦", Backup & Restore ("Restore overwritesâ€¦ This cannot be undone â€” export a backup first"), Diagnostic logging (with an honest "treat it as sensitive as the documents themselves"), anonymous diagnostics with "See exactly what's sent". Frightening in the right way; nothing missing.

**Overall on Settings:** Setup cluster = good. Administration cluster = built for the person who built it. The one tab a normal admin must visit â€” Processing â€” is the one I'd be scared to scroll.

---

## Two-week verdict
**Yes â€” I'd keep using it after two weeks, and pay.** 279 documents filed, every one under the right company and type, 149 of them without me; the batch chore I feared is gone. What I'd want before trusting it alone at the shop door: Card 1's "Nothing looks wrong" moment fixed (or the switch that says it prevents it made to work), the wrong-date-at-94% (Card 2) flagged, and the Terms finished.

## Humility / what I couldn't test
One simulated non-technical user, one pass, driven by a script that can't click Windows folder pickers (I set the two folders the way the screens would), that once accepted an "Unknown Company" dialog on my behalf, and that once put "Barcode" into the wrong dropdown â€” the Unknown-Company file and the "Needs: Barcode" row were my doing, not the app's. I couldn't test a multi-page split, the mailbox with a second person, the watch folder, backup/restore, licence activation, or the draw-a-box nudge (never typed a date). "Filed by itself" counts come from the app's own screens and the sidecar files on disk. All findings are suggestions for the owner to vet; I changed no code and nothing outside the sandbox.

**TL;DR again:** 472 in, 279 filed, 0 wrong company, 0 wrong type, 149 by itself; one box round our own name made the app confidently wrong and say "Nothing looks wrong"; every scary button told the truth; Terms still a draft. Would I keep it after two weeks? Yes.


### TRIAGE (main session, 2026-08-27 morning) — round 2026-08-26 NIGHT
| Card | Severity | Status | Where |
|---|---|---|---|
| 1 buyer-issued-PO teach re-badged 3 other suppliers' papers as Bramblewood POs @95, "Nothing looks wrong" | HIGH (held, not misfiled) | **BUILT DARK 2026-08-27** (`template_buyer_issued_letterhead_scope`; gary design → Oracle SEND BACK on one touch point → corrected). Root cause VERIFIED at source: template 3 won the WHOLE-PAGE text arm at 7/9 (the owner's name+address print in every BILL TO block); doc 6 untyped ("GOODS DELIVERY NOTE" = one extra real word → no trusted heading → the type-scope guard had nothing to refuse on); two roads (quiet-lane kw selector + single Reprocess). Fix: a `buyer_issued` template is recognised by text only over the LETTERHEAD band (the harvest's own truncation) — Python keyword + rescue arms, JS mirror (lane selector + wizard/graduation-link/reextract roads), plus a go-forward heal on the engine honour path (stale binding declined by the same band-hit evidence). Pins 43 + 28; refactor gate 0 diffs / 1242; band census 0/113; realdoc OFF vs ON + a Chris fired-path round owed before any flip. The owner's ruling stands: POs you send file under your own name (the folder is intended) | commit |
| 2 wrong date 24-06 vs page 24-05 @ High 94%, no warning (scanned statement) | MOD-HIGH | **VERIFIED 2026-08-27, no code change** — shot108 shows 24-06-2025 "High · 94%"; the stored row (doc 428) now holds the keyword read 24-05-2025 @94 with the crop family dissenting "_\| 24-06-20" — the corroboration record DID capture the disagreement, and the designed remedy (`trust_role_disagreement_refuse`: every-road refusal `disagreeing-read:<role>` + the "the page reads X two ways" panel copy) was OFF in Chris's sandbox but is already ON on the owner's live DB. Action: arm it in the sandbox for the next round. The "_\| 24-06-20" → "24-06-2025 @94" salvage is the leading-digit/month date class already in the owner's accuracy queue | handover |
| 3 Import table "Ready to file" on 13 rows Review holds (ref read as "Date") | MOD | **FIXED 2026-08-27** — root cause VERIFIED: the chip keyed on the ENGINE's `needs_review` (validator.needs_review = required-empty OR a field under its per-field threshold; the "Date" ref sat at exactly 70 with a "please verify" note → not flagged) while Review/File All ask `trust.isAutoFileEligible` (→ 'flagged'). The file_done handler now asks the predicate over the persisted rows and carries `review_hold` as a SEPARATE field (needs_review untouched — the T1 gate-unify seam); `addTableRow` keys the chip on either. Pin `test_chris_r6_ui_cards.js` | commit |
| 4 Barcode field row invisible when no barcode; Barcode allowed as the Date role | MOD | FIXED tonight (empty `barcode_none` row renders; Date role refused; is_variable) | commit |
| 5 layout-arm re-read offered Use/Keep between two garbles the page-check refuses | MOD | **FIXED 2026-08-27** — when the note carries the Gate-C "doesn't appear on this page as written" mark AND the offered value is not on the page either (sepless projection over `currentDoc.ocr_text`, stricter than Gate C so it can only hide, never show), the Use/Keep pair is replaced by "Neither reading appears on this page — draw the box again (⊕) or type the value from the page." Fail-open otherwise. Pin `test_chris_r6_ui_cards.js` | commit |
| 6 invented senders ("Ticket Type", "DOCUMENT OLUTIONS") shown as groups promising "5 more to file by itself" | LOW-MOD | **FIXED 2026-08-27** (the promise half) — `_senderReadinessLabel` renders NOTHING for a sender whose every pending scope has `confirms` = 0 (the gate's own count: nobody has ever vouched for the name). The group-under-"Sender not identified (guess: …)" half and the r4 Card 3 wording stay OWNER VET. Pin `test_chris_r6_ui_cards.js` | commit |
| 7 stale panels (blue box after a type change; readout bar on an empty queue; "All reviewed" after Delete All) | LOW | **FIXED 2026-08-27** — a type change or a settled DIFFERENT issuer drops the loaded hold verdict (`_holdVerdict = null`) before the reason panel repaints (the verdict described the doc as LOADED); Delete All sets a cause-aware LIST one-shot ("Queue cleared — N in the recycle bin") + the panel one-shot whenever nothing stays open; `clearDocPanel` hides the ⊕ read-back bar and the Teach card. Pin `test_chris_r6_ui_cards.js` | commit |
| 8 Learning Repair console: another sender's "worth a look"; "Learned from 41" after a forget | LOW | FIXED tonight (exact-scope suspects; "41 filed · none still teaching") | commit |
| Settings: the Processing "wall" of ~50 switches; Learning tab's wipe buttons beside the per-sender ticks; `supplier_name` codes in Document Types; Terms still a draft | — | OWNER VET (Recommended/Advanced split; move the wipes under Advanced) | handover |

### ROUND 7 — 2026-08-27 DAY — verification of the round-6 fixes (fresh sandbox, CDP 9223 PID 16040, 14 switches armed incl. `template_buyer_issued_letterhead_scope` + `trust_role_disagreement_refuse`)
**Chris's own report is missing:** every Chris spawn died on API/network errors (ENOTFOUND ×3; one transcript lost). He did
complete the fired path before the first drop (admin created, SINGLE imported, the Bramblewood PO taught exactly as in round 6,
the Oakhaven note reprocessed twice, the three papers confirmed under their own senders, IMPORT 200 imported). What follows is
the MAIN SESSION's verification from the sandbox DB (read-only) and a read-only CDP script — not his prose.
| Card | Verdict | Evidence |
|---|---|---|
| 1 buyer-issued re-badging | **FIXED (fired path MET)** | After the Bramblewood teach (09:14:58, template 1 `buyer_issued=1`) the lane job selected **nobody** (`done_ids ""`; round 6 `"4,2"`). Two Reprocess presses on the Oakhaven delivery note + the Castellan/Meadowvale confirms: supplier BLANK before his typing (`corrections.original_value ""`, `raw_value null`, method `manual`) — round 6 had `raw_value "Bramblewood Joinery Ltd" @95 template_fixed`. IMPORT 200: 21 Bramblewood-badged docs = the 21 Quillstone POs (Bramblewood letterhead), all template 1 / purchase_order; **0 inbound docs on the PO template; 0 supplier rows reading Bramblewood on a non-Quillstone paper.** |
| 3 Import "Ready to file" vs Review | **FIXED** | The 200-row Import table: `Confirm to file →` ×200, `Ready to file` ×0 — no chip contradicts Review. (The "Date" reference garble did not reproduce — the Pelican teach was typed, not drawn.) |
| 6 promise under an invented sender | **FIXED (promise half)** | Badges "2 more to file by itself" only under the five senders confirmed today (Castellan, Meadowvale, Pelican, Bramblewood, Oakhaven); none under Nordwind (21) / Harrowgate (20) / Veltrix (20) / "Sender not identified" (44). Grouping half still owner-vet. |
| 2 wrong date @94 | **NOT REPRODUCIBLE HERE** | The round-6 mis-read came from "Remembered positions" of a taught Ironclad layout; this sandbox had no Statement type (added via the catalog) and the scanned copy reads only customer + total. Remedy switch ON on the live DB; record-level verification stands (shot108 + doc 428's corroboration). |
| 5 / 7 | **see round 7c below** | Chris's fourth attempt watched card 7 as seen; card 5 did not arise (0 of 233 held docs carried the note pair). |

### ROUND 7c — 2026-08-27 late morning — Chris The Customer, attempt 4 (cards 7 + 5 as seen) — VERBATIM
Sandbox conditions: the same fresh install (CDP 9223, PID 16040), Review ~210 docs, five senders confirmed once each, Statement type added; report file `chris-sandbox\chris-report-r7c.md`, shots `r7c_00`–`r7c_15`.

**TL;DR** — Card 7 = BETTER-BUT. The two stale panels that mattered most are gone (the blue box and the sender button follow a type/sender change; the ⊕ read-back bar and "Teach this document" card no longer haunt the empty panel) — but **Delete All Review still ends on "✓ All reviewed — All documents reviewed ✓"** after binning 233, and the emptied right-hand column keeps the binned document's buttons. Card 5 did not arise — looked for across every held document (16 carry "doesn't appear on this page as written" alone, 0 carry "Read differently after learning", 0 both). Three new, all small: the panel says "Ready to file" over "please fill in…" after a type change (and the type change is kept without a confirm); overtyping a well-read sender offers to rename 20 documents after a name that's on none of them; the teach card says "We recognise this sender" beside "Sender not identified". Every warning pressed through told the truth; nothing was lost; **Yes, I'd keep using it.**

**Card 7 verdict — BETTER-BUT:** (a) change the TYPE — box changed at once to "Nothing was flagged… Ready to file", no stale sender/field name (r7c_02) → FIXED (but the new words contradict the "please fill in Invoice Date and Invoice Number" line under them — new card A); (b) type a different Document Issuer — "Change what's read from Fenton Plumbing Supplies's documents" the moment he clicked away (r7c_03) → FIXED; (c) Delete All Review (233) — **"✓ All reviewed" / "All documents reviewed ✓"** (r7c_08), only a small green "Deleted 233 review document(s)." strip at the foot tells the truth; the right column still shows the binned doc's buttons → NOT FIXED as seen; (d) last document of a small batch filed — read-back bar + Teach card both GONE (r7c_12); the sender button, Reprocess, bin and a greyed Confirm & File stayed → FIXED for the two things named. Extra: with a drawn/typed sender in the box, the blue box on the one-file worksheet still read "The Document Issuer box is still empty… Read at 0%" (r7c_11).

**New card A — LOW-MOD (the panel argues with itself, and a dropdown change is kept without a confirm):** after setting the type to Invoice on a 91% Castellan worksheet: blue box "Nothing was flagged on this document — check the values and confirm to file it. Ready to file" over "To file this document, please fill in Invoice Date and Invoice Number…" with Confirm greyed; moving away and back: the type STAYED Invoice, the typed sender was gone, the worksheet number/date showed "Not found", and the box read "Reference Number wasn't read certainly enough…" with no Reference Number box on the panel. Putting the dropdown back restored the reads — nothing told him it would. Proposed: one message ("Type changed to Invoice — this document now needs … (its Service Worksheet reads are kept if you switch back)"), drop "Ready to file" whenever the file button is grey, say once that a type change is kept straight away or offer Undo.
**New card B — LOW-MOD (QUESTION):** overtyping his OWN firm's name into a Castellan worksheet the app had read at High · 95% offered "20 more unfiled documents look like the same sender. Apply "Fenton Plumbing Supplies" to 20 & re-read · Not now" — a name printed on none of them. Proposed: keep the offer for a BLANK sender; when overtyping a high-confidence read, ask "This page seems to say 'Castellan…'. Use 'X' for this one only, or for the 20 others too?" (He didn't press it — the re-read may refuse pages where the name isn't printed.)
**New card C — LOW:** the one-file worksheet: the card said "We recognise this sender but haven't learned this layout yet" while the row said "Sender not identified" and the panel "Not seen before". Proposed: when the sender is blank, "We don't know this sender yet — teach this document once (or type the company name)…".

**Truth-table:** Confirm & File ×2 (Castellan test copies) ✅ filed to the right folders (11:43); Delete All Review — warning verbatim honest, Review 0, bin 233, filed docs untouched ✅ (then said "All reviewed"); Confirm & File (one-file worksheet, sender typed) ✅ `Document-Solutions\2026\May\…`; Restore all — "Restore all 233 documents…" ✅ bin empty, Review 233 same groups, same doc re-opened.
**Humility:** one persona via a helper script (rows/dropdown/buttons pressed for him; native boxes answered OK); ⊕ boxes drawn by page fractions; the app (started 09:51) was on the newest Review files (09:09/09:12) so the "NOT FIXED" is about this morning's screen; Card 5 was looked for, not manufactured; one folder created inside the sandbox (`CHRISBOT\one`). **TOP friction:** binning everything and being told "✓ All reviewed". **Worked:** Restore all. **Two weeks: Yes.**

#### TRIAGE — round 7c (main session, 2026-08-27)
| Item | Status |
|---|---|
| Card 7 (c) "✓ All reviewed" after Delete All | **FIXED AGAIN, ROOT CAUSE FOUND**: the morning fix used ONE-SHOT messages; the delete's IPC `review-count-changed` refresh re-rendered the empty branch AFTER the handler's own render, consuming the one-shot and painting the default. Now STICKY: nothing nulls the messages on use; the non-empty branch (a restore refills the queue) retires them. Pinned (`test_chris_r6_ui_cards.js`). The leftover column buttons (disabled Reprocess/bin/Confirm for a binned doc) → owner vet (cosmetic). |
| New card A — "Ready to file" over "please fill in…" after a type change | **FIXED (the contradiction)**: an unsaved type change now shows a NEUTRAL lead — "Type changed to X — check the fields below; a field the new type needs may be empty. The app re-checks when you confirm." + "Switching the type back restores what was read under it." — never "Ready to file" derived from the OLD type's confidence. The type change being PERSISTED without a confirm is pre-existing behaviour (the row regroups) → owner vet (pendingfeatures). |
| New card B — ripple offer after overtyping a high-confidence sender | OWNER VET (`pendingfeatures.md`) — the offer is a suggestion, and "& re-read" re-runs the page checks; the ask "this page seems to say X" is a copy/gate decision. |
| New card C — teach card "We recognise this sender" beside "Sender not identified" | OWNER VET (`pendingfeatures.md`) — copy keyed off the wrong case. |
| Card 5 | Not exercised (0/233 carried the note pair); source-pinned. |

---

# Round 8 — 2026-08-27 evening: the List field in Review (pills) — fresh code on the round-7 sandbox (CDP 9223)

**Brief:** `scratchpad\chris-sandbox\brief_r8_list_pills.md` (add a "Serial Number" List field to Service Worksheet; open the
Castellan worksheet; "+ One it missed"; edit / ✕ / ↺ / ";" / Edit as text / Undo; confirm; reprocess the twin; right-click).
**Verdict: NO for now for trusting it to fill by itself; the pills themselves "genuinely good and safe".** Screenshots
`chris-sandbox\shots_r8\` (29). Verbatim report follows; the triage table is at the foot.
# Chris The Customer — Round 8: the "Serial Number" list on a service worksheet

*One simulated office manager, poking at one row on the Castellan worksheets in the test copy. Not a user test — just me, my paper, and my two hands. Everything below happened in the sandbox only.*

## TL;DR (3 lines)
- Building the list by hand is genuinely pleasant — click a value to fix a letter, ✕ to drop one, ↺ to put it back, all with plain little labels. That part I liked.
- BUT the whole promise — "teach it once and every future worksheet fills itself" — fell over on the very next worksheet: it filed the **job number** as the serial and quietly dropped the **two real serials**, showing "1 found on this document" and 100%. That is the one thing this row exists to get right, and it got it wrong without telling me.
- It also captured one of the two serials wrong on the first sheet (grabbed "T-8325384" where the page plainly says "CT-8328847") with no flag on it at all.

**Top friction:** I taught it on one worksheet, confirmed, then let it read the next identical worksheet — and it put a **job reference** in the Serial Number box and missed both actual serials, at 100%, one click from filing.
**One thing that genuinely worked:** editing the entries — click a pill to change a character, ✕ to remove one, ↺ to bring it back — each with a clear little tooltip, and it never lost anything.

---

## Card 1 — It filed the JOB NUMBER as the serial on the next worksheet, and dropped the two real ones (TOP)
- **Citation (verbatim):** After I taught the serial on worksheet 0012, confirmed it, then opened its twin (0011) and pressed **▶▶ Reprocess**, the Serial Number box filled with one entry — **`CJB-9791`** — and the little receipt read **"1 found on this document"**. The page itself plainly prints, under the two line items, **"Serial No: CT-8051702"** and **"Serial No: CT-8813265"**. `CJB-9791` is the number printed at the very top beside **"JOB SHEET NO"**. The box header said **"High · 85%"** and the note above read **"Overall 100% · waiting for your check"**, with **"✓ Confirm & File"** lit and ready.
- **User-moment:** Doing exactly what the app told me to — "teach it once and every future worksheet fills this list" — and checking the next worksheet before filing it.
- **Observed confusion:** I expected the Serial Number box on this twin to show the two serials off the page (CT-8051702, CT-8813265). Instead it showed the **job number** and nothing else, and told me "1 found" as if that were a job done. If I'd trusted the row the way it invites me to, I'd have filed a worksheet whose "serials" are actually a job reference — and lost the two real serials with no sign anything was missing. For serial numbers — the whole reason I'd add this — that is the worst possible miss: it looks finished and it's wrong.
- **Harm + severity:** trust-eroded, bordering on the feature not being fit for its job. This is the fear I care about most: something filed wrong without me knowing.
- **Class:** CONFUSION.
- **Proposed alternative (a suggestion, not a demand):** when a taught list would pull in a value that also sits next to a *different* caption on the page (here the same short word appears in "JOB SHEET NO"), hold the document and say so — e.g. "Serial Number on this worksheet read **1** value, and it matches the Job Sheet heading too — please check before filing." And where the page clearly shows two "Serial No:" lines and the box found none of them, that mismatch itself deserves a "have a look" rather than a green 100%.
- **What I may be missing:** I taught it by boxing just the value (the brief told me the words "Serial No" needn't be in the box), so the app chose a very short caption on its own. Maybe boxing the caption too would fix it — but I wouldn't know to do that, and the receipt told me it was already sorted.

## Card 2 — One of the two serials came in wrong, with no flag on it
- **Citation (verbatim):** On the first worksheet (0012), after I pointed at one serial, the message bar said: **"✓ Caption No: collects 2 values on this page: T-8325384; CT-8116138."** The page prints **"Serial No: CT-8116138"** and **"Serial No: CT-8328847"**. So `CT-8116138` is right, but the second one it stored — `T-8325384` — is not what the page says (the page says `CT-8328847`).
- **User-moment:** Reading the receipt and counting: it said "2 values", the page has 2 serials, so I nearly ticked it off as correct.
- **Observed confusion:** the count was right (2 and 2), so at a glance it looks perfect — but one of the two is a wrong number, and it sits there looking exactly as solid as the correct one. Nothing on the row singles it out. I'd only catch it by reading each entry back against the paper letter-for-letter, which is the drudgery I hoped this would save.
- **Harm + severity:** trust-eroded. A wrong serial is as bad as a missing one when the accountant or a warranty claim needs it.
- **Class:** QUESTION (why is a value that doesn't match the page shown with no "check me" mark?).
- **Proposed alternative:** if one entry in a list reads far less cleanly than its neighbours, tint just that pill and add a one-line "check this one against the page" — don't let a shaky entry hide inside a confident "2 values".
- **What I may be missing:** faint or tight print is hard to read and no tool is perfect; I accept the odd slip. My point is only that the slip should show itself, not blend in.

## Card 3 — "Undo changes" wiped the whole list in one click, no "are you sure"
- **Citation (verbatim):** the link reads **"Undo changes"** with the tooltip **"Put the list back exactly as it was read"**. I clicked it once and the row went straight back to **"No entries"** / **"0 entries"** — every value I'd pointed out was gone.
- **User-moment:** I'd built the list by hand (the box started empty), tidied it, and clicked "Undo changes" expecting to undo my *last* change.
- **Observed confusion:** I read "Undo changes" as "step back one thing," not "throw away everything I did and empty the box." Because this list only exists once I've pointed things out, "back as it was read" means back to nothing — one click and all my work's gone, with no confirm and (once I click away) no obvious way back.
- **Harm + severity:** slowed / trust-eroded — losing a few minutes' careful pointing to a single misread click.
- **Class:** CONFUSION.
- **Proposed alternative:** name it for what it does — "Clear my changes" or "Start this list over" — and, when it would empty the whole box, ask once: "Remove all 2 entries and start over?"
- **What I may be missing:** maybe there's a way to bring it back that I didn't spot; even so, the word "Undo" led me to expect a small step, not a wipe.

## Card 4 — The "fills this list on every future document" promise is bolder than what happens
- **Citation (verbatim):** the receipt after I pointed at a serial: **"Saved as a keyword for Serial Number on every Service Worksheet when you confirm — every "No:" on future documents fills this list."**
- **User-moment:** reading the receipt to decide whether I could stop hand-typing serials from now on.
- **Observed confusion:** it promised that *every* future worksheet would fill this list — so I believed the next one was handled. The very next worksheet then filled it wrongly (Card 1). A confident promise that the next document immediately breaks teaches me to distrust the confident promises — which is a shame, because most of this app's little notes are honest.
- **Harm + severity:** trust-eroded.
- **Class:** PREFERENCE (soften the promise to match reality).
- **Proposed alternative:** "I'll try to fill Serial Number on future worksheets from here — always glance at it before filing." Honest, and it keeps my eye where it needs to be.
- **What I may be missing:** the promise may hold on cleaner layouts than these test ones; but on the two I actually tried, it didn't.

## Card 5 — "Never on these documents?" reads like a riddle, not a button
- **Citation (verbatim):** under the row sits **"Never on these documents?"** (tooltip: "If this sender's documents never carry this field, switch it off so it stops showing here").
- **User-moment:** scanning the row for what each link does before touching anything.
- **Observed confusion:** a bare question hanging there — "Never on these documents?" — doesn't tell me it's a switch, or what clicking it does. I'd read it two or three times and still hover before daring to click. The tooltip explains it well; the visible words don't.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** say the action: "Hide this field for Castellan" or "This field isn't on these documents — hide it."
- **What I may be missing:** regular users may learn it after once; first sight, it stopped me.

## Card 6 — Typing ";" turned BOTH entries red for a moment
- **Citation (verbatim):** typing a semicolon into one entry gave the warning **"An entry can't contain ";" — that's the separator between entries"** — the wording is clear and fair. But while it showed, **both** pills (not just the one I was editing) drew a red outline.
- **User-moment:** fat-fingered a ";" into one entry to see what it'd do.
- **Observed confusion:** the sentence is one of the better warnings I met — it tells me the rule and why. My only wobble was the red spreading to the entry I hadn't touched, which for a second read as "you've broken both of these."
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** outline only the entry that has the ";".
- **What I may be missing:** it cleared as soon as I fixed it and nothing was actually lost — a blink, not a wall.

---

## What genuinely worked (credit where due)
- **Editing the entries is lovely and safe.** Click a value and it opens right there to change a letter; the changed one gets a quiet note **"CT-8116138 — edited on this document; click to edit again"**. ✕ drops an entry — **"Remove this entry — it is not on this document (you can put it back)"** — and it goes grey with a ↺ (**"Put this entry back"**) so nothing's truly gone; the little tally **"1 entry · 1 removed"** kept count honestly. I removed both, put both back, and landed exactly where I started. That reversibility is precisely what stops me being scared of a screen.
- **Right-clicking the entries did NOT pop the cleanup menu** — and it shouldn't, so good. On an ordinary field (Worksheet Number) the right-click menu appeared as usual ("This field can wrap to the next line…"); on the serial list it stayed quiet. That's the right call and I'm glad someone thought of it.
- **"Edit as text" ⇄ "Show as list"** is a nice touch — flip to one plain box (`CT-8116138; T-8325384`) to paste or bulk-fix, flip back to tidy pills. Made sense first try.

---

## Would I keep using this row after two weeks?
**Not as it stands — not for trusting it to fill by itself.** I'd happily use the pills to tidy up serials on a document in front of me; that half is genuinely good and safe. But the point of teaching it is so the next fifty worksheets fill themselves — and on the *first* next worksheet it put a job number where the serials go, dropped the two real ones, and told me "1 found" at 100%. Serial numbers are the one thing you can't be "roughly right" about — a warranty or an insurer wants the exact string. Until teaching it reliably grabs the same kind of value on the next sheet (and flags the odd misread instead of hiding it), I'd have to hand-check every serial list on every document — which is the job I was trying to hand over. So: **No for now**, with a clear "yes, gladly" waiting on the other side of Card 1.

*— Chris Fenton. One made-up office manager, one afternoon, the Castellan worksheets in the test copy. I didn't touch anything outside the sandbox, and none of this should change the app until the owner has looked it over.*

## Round 8 TRIAGE (verified at source in the sandbox DB — `probe_sandbox_r8.out`, `probe_sandbox_text.out`)
| Card | Verdict | Mechanism (FACT) | Action |
|---|---|---|---|
| **1 TOP** job number filed as the serial on the twin, "1 found", 100% | **REAL — two defects, one FIXED tonight, one is its own arc** | (a) The ⊕ label picker returns the token NEAREST the value — "No" out of "Serial No:" — and `teach-list-caption` stored **"No"** doc-type-wide (override id 57, 15:50). The Review bar previewed with **"No:"** (multi-word branch → only the "Serial No:" line) while the stored "No" then matched **"JOB SHEET NO CJB-9791"** on the twin. (b) The twin (doc 217, the SCANNED import of the same PDF as doc 2) has **no "Serial No:" lines in its page text at all** — the OCR/geometry text rebuild dropped them (doc 2's born-digital text has both); so even the right caption finds nothing on scanned worksheets. | (a) FIXED: ONE `cleanCaption` shared by the ⊕ road, the wizard and the IPC; a generic tail (No / Number / # / Ref / Date…) is EXTENDED to the phrase printed left of the drawn value on the page ("Serial No") or REFUSED with the reason on all three roads; the preview now shows the debris a bad caption would collect. Pinned. (b) → `pendingfeatures.md` OCR text-loss arc (007/oscar). |
| **2** one of two serials wrong, no flag | REAL (deferred class) | The stored page text of doc 11 reads `Serial No:    T-8325384` (an OCR misread — no "C", digits off); the second value was the one Chris drew. No per-element shape check exists (Oracle cond 8: within-document shape consensus rides a non-note channel, census first). | Exhibit recorded in `pendingfeatures.md` (c); not built. |
| **3** "Undo changes" wiped the list, no confirm | REAL | On a list that STARTED EMPTY the read is nothing — "back to the read" = wipe. | FIXED: the link is not offered when the read was empty; otherwise reads "Undo all my changes (back to the N read)" with an explicit tooltip. |
| **4** the "every … fills this list" promise | REAL | Copy over-promised. | FIXED: "I'll look for "X" on future Service Worksheets and fill this list from it. Always glance at it before filing." |
| **5** "Never on these documents?" reads like a riddle | PRE-EXISTING copy (Chris r?-card 4 2026-08-12 link) | — | `pendingfeatures.md` copy note. |
| **6** ";" warning outlined both pills | REAL (cosmetic) | the warning set `.invalid` on the store; the sibling combinator paints the whole pills box | FIXED: the ";" warning no longer marks the store. |
| worked | pills edit/✕/↺/tally; no cleanup menu on the list; Edit as text ⇄ Show as list | — | keep |

