# Chris The Customer — full app vet, 2026-08-13 (round 4: comparison rerun of round 3)

**Why this round exists.** The owner's order before bed (2026-08-13 night): *"have chris rerun his
tests again and compare the results with the previous ones. sandboxed as always and copy the files
in there for him."* His report below is **verbatim**; this header records the conditions, and the
section after it records what I verified at source afterwards — because two of his headline numbers
turn out to be artefacts of the sandbox seeding rather than product regressions, and the owner
should not spend a morning chasing them.

**Sandbox conditions.** Fresh install at the session sandbox
(`…\ba2ca384-…\scratchpad\chris-sandbox\` — session-mortal; the 25 screenshots live there, copy
anything worth keeping). Own userData, own Output, admin created through the real first-run flow
(0 users seeded), the **SAME 200 scans** as rounds 2 and 3 (`Desktop\TESTING\IMPORT`), CDP 9223,
PID 16240. Taught state grafted from a read-only `db.backup()` snapshot of the live DB via
`scripts/seed-taught-state.js`: 8 custom document types with 62 fields, 12 field anchors, 664
supplier hints, 17 logo fingerprints, 12 label overrides — and **the same deviation as round 3,
stated to Chris up front: only 1 of 11 supplier templates transferred** (slug/FK safety skips),
with 0 template field mappings.

**Build under test:** the shipped fresh-install defaults at HEAD `1766c62` — migration 63, all
three note-demote slices and the machine-feed slice DEFAULT OFF and NOT exercised. Nothing was
armed by hand. The owner's own hand-flipped live settings are NOT present (a fresh install gets
`PROVEN_ON_DEFAULTS`), which was also true of round 3.

**THE RESULT IN ONE LINE:** the workflow half of the product is now excellent end to end, several
round-3 findings are fixed outright — and the teach surface's silence, which round 3 survived only
because downstream guards contained it, this time let a one-character garble reach 20 documents at
95% unflagged and put 12 of them on disk in a misspelled folder.

---

## AFTER-THE-FACT VERIFICATION (main session, read-only, on the SANDBOX DB only)

Chris judges what the screen shows him and does not diagnose — correctly. Two of his numbers needed
checking at source before they reach the owner as regressions.

**1. His card 1 ("40 documents from two other companies under MY company's name, 95%, with MY VAT
number") is the KNOWN, STILL-OPEN buyer-issued-template class — not a new defect.** The live DB's
template **13 = "Bramblewood Joinery Ltd" / purchase_order**, with `supplier_name` AND `vat_no`
**frozen** (`is_variable=0`) to the owner's own values. That is the template the seeder happened to
graft this time, and it is the exact mechanism Chris reported on 2026-08-11 and CLAUDE.md records
as still open: *"teaching a purchase order the OWNER issued still leaked onto 20 Oakhaven delivery
notes — verified on disk, and the VAT number crossed over too… the 08-10 fix closed the supplier
case and left the buyer-issued case open."* `template_identity_on_page` is satisfied because the
owner's company IS named on a document they RECEIVE (as the recipient).

**Why round 3 saw "Sender not identified" instead:** the seeder transfers exactly ONE template and
**which** one is arbitrary (slug/FK skips). Round 4 drew template 13; round 3 drew a different one.
So the round-3 → round-4 "step backwards" on this point is a **sandbox-seeding difference, not a
product change**. I cannot prove round 3's graft excluded template 13 — I did not record which row
it took — so treat that as strongly indicated rather than certain. The underlying defect is real
and open either way.

**2. His card 2 is REAL, and I verified it in the sandbox DB and on disk.** His teach did not create
a new template — it **overwrote the grafted template 13's frozen identity value**:
`template_fields.fixed_value = 'B8ramblewood Joinery Ltd'`, `is_variable=0`. That template then
stamped **20 Quillstone-Print purchase orders** (documents the owner ISSUED) via `template_fixed`
at **confidence 95 with `validation_note` empty** — no flag on any of them. 20 documents ended
`confirmed`; Chris counted 12 written to `Output\B8ramblewood-Joinery-Ltd\`. The garble also
entered the learning SCOPE key: `field_anchors` now carries a row scoped to supplier
`'B8ramblewood Joinery Ltd'`. This is the freeze-from-a-sample-of-one class
(`TEMPLATE_FREEZE_QUALIFY`, still OFF) meeting a teach surface that says nothing.

**3. His cards 8 and 2's "worse than round 3" counts (188 need review vs 147; 19 spread / 12 filed
vs 5 / 0) share cause (1) above** — with a frozen-identity buyer-issued template in the graft, the
teach lands on 20 existing siblings instead of creating a small fresh scope. Same caveat: seeding,
not a regression between `afe8da0` and `1766c62`.

**4. What is NOT explained away and should go to the vet queue as genuinely new or unfixed:** the
teach surface's total silence (round-3 finding 1, unchanged, and now demonstrably expensive); a
teach overwriting a template's FROZEN identity with a garbled read at 95 unflagged; File All Ready
having no count in its warning and no summary after; the stale recycle bin (round-3 finding 2,
unchanged, and he counted **zero** swallowed dialogs so it is not a driver artefact); "Empty bin"
promising to delete the filed PDF and not doing so; teaching one field emptying two others; and the
credit-note type switch shipping OFF while the page itself says it *"Fixes credit notes being typed
as invoices."*

**Nothing from this round has been implemented.** It all queues for the owner's vet.

---

## Chris's report (verbatim)

# Chris The Customer — round 4, 2026-08-12 (comparison rerun of round 3)

**TL;DR**
1. **The teach-time silence I reported last round is unchanged — and this time it cost me twelve real files.** One slightly-off box turned my own company into "B8ramblewood Joinery Ltd", spread it to 19 documents with "Nothing was flagged" on every one, and File All Ready wrote 12 of them into a misspelled folder. Last round the same experiment was contained to 5 documents and File All Ready held every one back.
2. **Worse at the start, better after a button: 40 documents from two other companies arrived under MY company's name at 95%, with MY VAT number.** Last round those same documents said "Sender not identified". Pressing Reprocess all healed all 40 — but a new customer's first sight of their filing cabinet is 40 documents in the wrong company.
3. **The approval workflow is now genuinely excellent end to end,** the recycle bin still lies about being empty at the exact moment you panic, and Split PDF and the junk-company suggestions are fixed.

**Conditions.** Fresh install, shipped fresh-install defaults — not the owner's hand-flipped switches; same basis as round 3, so the comparison is fair. Taught knowledge grafted from a read-only snapshot: 8 document types with 62 fields, 12 field anchors, 664 supplier hints, 17 logo fingerprints, 12 label overrides — but **only 1 of 11 supplier layouts and 0 field positions transferred**, the same deviation stated up front last round. Everything below happened inside the sandbox; the owner's app and files were never touched. **Nothing here is implemented — it queues for your vet.**

---

## Walkthrough

**First contact is still the best thing in the product.** "There are no default credentials — you choose everything below" *(r4_01)*, the recovery code with **Copy code** / **Print…** and Continue locked behind the tick *(r4_02)*, Terms still opening "WORKING DRAFT — FOR LEGAL REVIEW ONLY" *(r4_03)*. The setup wizard is seven calm steps *(r4_04, r4_05)* and the filing preview shows the actual path it will use. **The practice run — which I never tested before — is superb**: it ends by naming every file and where it went ("scan002.pdf → Invoice.15-06-2026.INV-1042.pdf · Practice Supplies Ltd / 2026 / June"), and when you draw a box it answers **"Read 'INV-1042' from your box."** Hold that thought; the real app never says it.

**Import: 200 scans in under three minutes, 0 errors** — much quicker than I remember. Live counter "20 processed of 200 found", ending **"FINISHED ✓ 200 processed — 188 need your review before filing, 12 ready"** *(r4_08)*. Last round: 147 and 53.

Review opened grouped by sender *(r4_09)* — and one group was wrong before I touched anything: **"Bramblewood Joinery Ltd · 60 documents"**, my own company, holding 20 Oakhaven delivery notes and 20 Nordwind quotes *(r4_13, r4_14)*. Then I repeated last round's poison *(r4_11, r4_12)*, filed it, reprocessed, ran File All Ready, taught Ironclad through the wizard *(r4_16–r4_20)*, searched *(r4_15)*, drove the whole approval workflow *(r4_23, r4_24)*, and pressed every frightening button *(r4_21, r4_22)*.

---

## VERIFY LIST — every prior finding, one line each

### Round 3's table

| Finding | Tonight |
|---|---|
| 1. Teach bled onto another company's docs, misfiled | **NEW PROBLEM** — bleed onto *other* companies stayed fixed, but my garble spread to **19** of my own docs (was 5) and **12 got filed** (was 0). See card 2 |
| 2. "Reprocess all in queue" warns not at all | **FIXED** — *"Re-read all 199 documents (all in queue) from their pages? … Documents you've already confirmed and filed are not touched."* |
| 3. Queue says 200 when N need you | **FIXED** — import summary, Home and per-row badges all carry the split |
| 4. Tour + Home promise self-filing the default prevents | **SAME** — tour card 5 still says *"Documents it's fully confident about file themselves automatically"*; the practice run repeats it |
| 5. 63 toggles, many ON under "Off by default" | **FIXED** — Processing is now **24 toggles (7 on)**, in plain English with reasons ("Fixes credit notes being typed as invoices") *(r4_25)* |
| 6. Confirming never says where the file went | **SAME** — queue ticked 200→199, silence; File All Ready filed 19, silence |
| 7. Red dots on perfectly-reading fields | **SAME** — red dot = "not taught", green = "taught"; tooltip copy is now excellent, colour is still the error red on 5 of 6 correct fields |
| 8. Restore one at a time | **FIXED** — Restore all counts and names the destination |
| Four names for the unknown-sender state | **FIXED** — only "Sender not identified" all night |
| Teach picker unsearchable | **FIXED** — "Filter by file name, sender or type…" works |
| Wizard's last button hid the teaching | **FIXED** — "Save teaching & file", honest closing screen |
| "Teach this position" with no visible box | **FIXED** — zoom-to-fit + green glow, verified with my eyes *(r4_17)* |
| Approve silently does nothing | **FIXED** — arms, then *"Approved by chris on 12-08-2026 · View stamped copy"* |
| Import's "No documents found" false alarm | **FIXED** |
| Mid-run counter | **FIXED** |
| Recovery code: no copy/print | **FIXED** |
| Bin row "— / Sales Order" | **FIXED** |
| Terms = solicitor draft | **SAME** |
| 'SUPPLIER' caption became a company name | **SAME CLASS, now committed** — 3 filed records carry `<CustomerName>SUPPLIEN</CustomerName>` / `OUPPLIER` |
| Delete / Delete All copy | **STILL TRUTHFUL** — but see card 4 for Empty bin |

### Round 3's eight new findings

| # | Finding | Tonight |
|---|---|---|
| 1 | Teach-time "doesn't look like a company name" warning never spoke | **SAME** — four draws, reads of `eee`, a whole address block, `B8ramblewood`; zero messages |
| 2 | Recycle bin stale during Delete All; Restore all does nothing | **SAME** — bin open, deleted 179, view still read *"The recycle bin is empty."*, Restore all gave **no dialog, no message, no action** (I counted dialogs: **0** — nothing was swallowed) |
| 3 | ⊕ teach silent on success and failure | **SAME** — four draws, four silences, including a near-perfect read |
| 4 | Reprocess flips green docs to "Matched by logo only" | **SAME** — still fires on pages printing the company name in large type |
| 5 | Label auto-detect garbles captions and offers them for approval | **SAME** — *"Label: yymarket, DM2"*, *"Label: atement of"*, *"Label: Statement F"*, all with "Looks right →" as the primary button |
| 6 | Wrong character in a reference, no fix but walking back | **BETTER-BUT** — there is now a **"Value wrong? Type it as printed: … Use this →"** box on that same panel. The garbled reads still happen |
| 7 | Cold-start offers a junk fragment as a company | **FIXED** — I checked 12 unknown-sender documents; **no suggestion buttons at all**. Instead: *"A known supplier's name appears on this page, but not in the letterhead area, so it wasn't trusted as the issuer."* |
| 8 | Split PDF gave no response | **FIXED** — *"This document is only one page — there's nothing to split."* |

---

## NEW findings, worst first

### 1. Forty documents from two other companies arrived filed under MY OWN company's name, at 95%, with MY VAT number — before I touched anything

- **Citation (verbatim):** Review, straight after import: **"Bramblewood Joinery Ltd · 60 documents · 48 need a look"**. Opening `Oakhaven-Electrical_delivery_note_0027.pdf`, whose page prints in large bold type **"Oakhaven Electrical Wholesale"**, **"19 Conduit Row · Ampfield, AM4 7GB · VAT Reg GB 660 1173 45"**, **"GOODS DELIVERY NOTE"** — the panel reads **DOCUMENT ISSUER · High · 95% · "Bramblewood Joinery Ltd"**, **VAT NUMBER "GB 512 8846 27"** (mine, not the printed one), type **"Purchase Order"**, **"Recognised by: Its logo and wording"**, and **"Nothing was flagged — this was read at 63%…"**. Same on all 20 Nordwind quotes *(r4_13, r4_14)*.
- **User-moment:** first look at my 200 imported scans.
- **Observed confusion:** I open the pile expecting a company per supplier. Forty documents from two firms I buy from are sitting under my own name with my own VAT number, and the app says nothing was flagged. If I'd worked down that group confirming, I'd have filed Oakhaven's and Nordwind's paperwork in my own folder.
- **Harm + severity:** wrong company on the paperwork, at the first moment I meet the product. **High** — and a step backwards: last round these exact documents said "Sender not identified".
- **Class:** CONFUSION.
- **Proposed alternative:** none for the mechanism. But when the name on the letterhead and the name it picks disagree, say so on the document — the same way "Matched by logo only" already does.
- **What I may be missing:** pressing **Reprocess all healed all 40** into correct groups, so the knowledge is clearly there. I can't tell why the first pass doesn't have it, and only 1 of 11 layouts transferred into my sandbox.

### 2. One slightly-off box created a misspelled version of my company, spread it to 19 documents unflagged, and File All Ready wrote 12 of them to disk

- **Citation (verbatim):** after my draw, Review shows **"B8ramblewood Joinery Ltd · 19 documents · 8 need a look"**; opening an unflagged one: **DOCUMENT ISSUER · High · 95% · "B8ramblewood Joinery Ltd"** with **"Nothing was flagged — this was read at 94%, below the 100% you've set for filing without a check, so it's waiting for you."** and, underneath, **"If documents like this are consistently right, lower the auto-file bar in Settings → Processing."** File All Ready warned **"File all ready documents in the Review queue? Every document with its type and required fields filled in will be filed, exactly as if you confirmed it one by one."** — no count — and my disk now holds **`Output/B8ramblewood-Joinery-Ltd/` with 12 PDFs**, each `<SupplierName>B8ramblewood Joinery Ltd</SupplierName>`.
- **User-moment:** teaching the company name on my own purchase order, exactly as last round.
- **Observed confusion:** nothing warned me at the draw, nothing warned me at Confirm, nothing flagged the 19 siblings, and the batch button filed 12 without a count or a summary. My company now exists twice in my filing cabinet, one character apart, and the only thing that stopped the other 7 was a bar the app is actively encouraging me to lower.
- **Harm + severity:** my filing silently split in two. **High** — worse than round 3, where the same experiment reached 5 documents, flagged every one, and File All Ready held them all.
- **Class:** CONFUSION.
- **Proposed alternative:** say at the draw what the sibling flag says later — *"I read 'B8ramblewood Joinery Ltd' from that box. That's one character different from a name you already use (Bramblewood Joinery Ltd). Is that right, or shall I use the existing one?"* And give File All Ready a count in the warning and a summary after.
- **What I may be missing:** "B8ramblewood" looks like a name, so a does-this-look-like-a-company check would rightly pass it — which is exactly why the *near-match to an existing company* is the signal that matters, not the shape of the word.

### 3. Teaching one field silently empties two others

- **Citation (verbatim):** before my draw on `..._0029.pdf`: **`customer_name=[Quillstone Print & Packaging]`, `vat_no=[GB 512 8846 27]`**. After one drag on the **Document Issuer**: **CUSTOMER "Not found"**, **VAT NUMBER** blank, and the Customer's dot flips from the green "Taught" to the red "Not taught". Reproduced on both documents I tried; pressing ⊕ *without* drawing changes nothing, so it is the draw.
- **User-moment:** correcting the company name on one document.
- **Observed confusion:** I fixed one field and two correct fields I never touched went blank, with no message. If I hadn't been watching them I'd have confirmed the document with the customer and VAT number missing.
- **Harm + severity:** correct data lost from the record without a word. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** if a teach re-reads the whole document, say so — *"I re-read the page with your new box; Customer and VAT Number came back empty. Check them before you confirm."*
- **What I may be missing:** they may repopulate on a later reprocess. They did not repopulate on screen, which is where I make the decision.

### 4. "Empty bin" says it deletes the PDF files. It didn't.

- **Citation (verbatim):** **"Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone."** I accepted. The bin went empty — and `Output/Harrowgate-Timber-Supplies/2025/July/Sales-Order.14-07-2025.HTS-SO-99027.pdf` is still sitting on my disk.
- **User-moment:** clearing the bin of a document I'd deleted.
- **Observed confusion:** the most irreversible-sounding sentence in the product describes something that didn't happen. Nothing was lost, so I'm not frightened — but if I'd emptied the bin to get rid of a document with someone's bank details on it, I'd now believe it was gone.
- **Harm + severity:** trust-eroded; a privacy expectation that isn't met. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** either delete the filed copy too, or say what it really does — *"Permanently remove 1 document from Scan Finder. This cannot be undone. The filed PDF stays in your output folder."*
- **What I may be missing:** it may have deleted a working copy I can't see. I can only report the file I can see, which survived.

### 5. The APPROVED stamp lands on top of the company name and the document title

- **Citation:** stamped copy viewer, **"APPROVED / By: chris / Date: 12 Aug 2026"** in a green box printed over **"Harrowgate Timber Suppli‹es›"** and **"SALES ORDER"** — both partly hidden *(r4_24)*.
- **User-moment:** checking the copy before sending it to the accountant.
- **Observed confusion:** the stamp is beautiful and legible; it's covering the two things that identify the document. I'd be embarrassed to email it.
- **Harm + severity:** cosmetic-to-slowed. **Low-medium.**
- **Class:** PREFERENCE.
- **Proposed alternative:** default the stamp to a clear area (below the letterhead rule, or bottom-right), and let me move it in Settings.
- **What I may be missing:** there is a stamp-placement setting somewhere; nothing on the viewer pointed me to it.

### 6. Out of the box, credit notes are typed as Invoices — and the switch that fixes it ships off

- **Citation (verbatim):** `Meadowvale-Dairy_credit_note_0023.pdf`, page headed **"CREDIT NOTE"**, panel type dropdown reads **"Invoice"**; INVOICE NUMBER "Not found", TOTAL "Not found" (the page shows **"Total to Pay £-609.62"**), and the Credit Ref landed in a PO field. Settings → Processing: **"Let the printed title decide the document's type … Fixes credit notes being typed as invoices. Off by default."**
- **User-moment:** reviewing a supplier credit.
- **Observed confusion:** the page says CREDIT NOTE in capitals an inch high and the app calls it an Invoice, then can't find its number or total. Settings openly names this and leaves it off. A credit filed as an invoice is a real bookkeeping error.
- **Harm + severity:** wrong type on money-in-my-favour documents. **Medium.**
- **Class:** QUESTION — if that switch fixes a known wrong outcome, why does a new customer start without it?
- **Proposed alternative:** none to the copy, which is honest. This is a default question for you.
- **What I may be missing:** it may be off because it costs something elsewhere. Nothing on screen tells me what.

### 7. One supplier is split across two piles — 7 recognised, 18 unidentified

- **Citation (verbatim):** Review sidebar shows **"Silverbeck Cleaning Supplies · 7 documents · 7 need a look"** *and* **"Sender not identified · 25 documents"**, whose contents are Silverbeck sales orders (`Silverbeck-Cleaning_sales_order_0012` … `_0031`).
- **User-moment:** working down my piles supplier by supplier.
- **Observed confusion:** I finish "Silverbeck", feel done, and 18 more of theirs are hiding in the unknown pile under a different heading.
- **Harm + severity:** slowed; work looks finished when it isn't. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** on an unidentified document, if a known supplier's name is on the page, name them in the hold — *"This looks like it may be from Silverbeck Cleaning Supplies. Confirm the sender?"*
- **What I may be missing:** only 1 of 11 layouts transferred to my sandbox, which likely widens this split beyond what a settled customer sees.

### 8. More knowledge than last round, and less of it ready to file

- **Citation (verbatim):** **"FINISHED ✓ 200 processed — 188 need your review before filing, 12 ready"**. Round 3, same 200 scans: *"147 need your review before filing, 53 ready"*.
- **User-moment:** the moment the batch ends and I see how much work is mine.
- **Observed confusion:** I was seeded with more than double the supplier knowledge of last round (664 hints against 290, 12 taught spots against 9), and got a quarter as many ready-to-file documents.
- **Harm + severity:** more work per batch. **Medium.** Class: **QUESTION.**
- **Proposed alternative:** none — I'm reporting the number, not diagnosing it.
- **What I may be missing:** the two runs are not identical installs and "ready" may be measured differently now. It is the number the product put on my screen both times, so it's the number I'd compare.

---

## Warnings truth-table (tonight)

| Button | Warned? | Told the truth? | Said how many? | Way back, on that screen? |
|---|---|---|---|---|
| Teach ⊕, garbage read | **No — nothing at all** | — | — | — |
| Confirm & File (misspelled company) | **No** | — | — | No — created `B8ramblewood-Joinery-Ltd` |
| **File All Ready** | Yes | **Yes** — criteria stated and honoured | **No** | Not mentioned; **no summary after** (filed 19) |
| Reprocess all in queue | **Yes** ✓ | **Yes** — count, scope, "confirmed not touched" | **Yes (199)** | n/a |
| Reprocess (single doc) | No (fair — one doc) | Yes — explains what it couldn't match | n/a | n/a |
| Delete (one, from Search) | Yes | Yes — names the bin and the route back | n/a | Yes ✓ tested |
| Delete All Review | Yes | **Yes** — still the best copy in the app | **Yes ("ALL 179")** | Yes ✓ tested |
| Restore all (fresh bin) | Yes | **Yes** — count + destination | **Yes (179)** | n/a |
| **Restore all (stale bin)** | **No — no dialog, no action, no error** | — | — | **The trap, unchanged** |
| **Empty bin** | Yes | **No** — promised "including their PDF files"; the PDF survived | **Yes ("all 1")** | Correctly says none |
| Approve, 1st / 2nd press | Arms visibly / executes | *"an approval is permanent and stamped with your name"* — true | n/a | Arm expires honestly |
| Reject | Yes — **blocks and explains**: *"Add a short note first — the sender needs to know why it was rejected."* | Yes | n/a | Sender sees the reason |
| Recall | Executes | Yes — item shows "recalled" | n/a | "Send again" offered |
| Split PDF | **Speaks now** — *"This document is only one page — there's nothing to split."* | Yes | n/a | n/a |

The pattern is the same as last round, half-cured: **the terrifying buttons are handled beautifully; the harmless-sounding ones are silent.** Teaching says nothing, Confirm says nothing, File All Ready says nothing. Those are the three moments I actually hurt myself tonight.

---

## What genuinely worked

**The approval workflow, start to finish.** I sent a document with a note, saw *"Sent to Chris Fenton — it's in their Mailbox. You can recall it from your Sent pile while it's still pending."*, approved it through a two-press arm that explains itself, rejected a second one and was **stopped and told why a reason was needed**, recalled a third, and found all three in a Sent pile that shows state, note, rejection reason and exactly the right action per row. The stamped copies landed beside the originals with names I can read — `…APPROVED-stamped-r1.pdf`. I would hand that to my office tomorrow.

**The practice run.** Three safe samples, a real draw-a-box that answers **"Read 'INV-1042' from your box."**, and a closing screen naming every file and its destination folder. It is the clearest thing in the product — and it is a standing demonstration that the app knows how to say what it just did.

**And the Processing settings page.** From 63 switches to 24, every one written like a person explaining it: *"Don't mistake a VAT registration number for a VAT amount"*, *"Fixes credit notes being typed as invoices."*

---

## Top friction

**The app still will not speak at the two moments I am most likely to hurt myself — and this round I have twelve files to prove the cost.** Last round I wrote that the silence was the problem but the containment saved me. Tonight the containment did not save me: the garble reached 19 documents unflagged and a batch button wrote 12 of them to disk under a name that is one character wrong. Every downstream guard behaved; nobody spoke to the person holding the pen. The practice run says *"Read 'INV-1042' from your box"* every single time. The real teach has never said it once.

---

## Would I keep using this after two weeks?

**Yes — but the condition I dropped last round is back on.** On 2026-08-12 I said *"Yes — and for the first time without a condition attached to my documents' safety."* I can't say that tonight. Two things put paperwork in the wrong place without me choosing it: 40 documents arriving under my own company's name at 95%, and 12 filed into a misspelled folder off one bad box. Both are recoverable — a reprocess healed the first, and nothing was destroyed — but "recoverable if you happen to press the right button" is not the same as safe. **Give the teach a voice, give File All Ready a summary, and refresh that recycle bin, and I'd hand this to my office without a briefing.** The workflow half of the product is already there.

---

## What I may be missing

> I'm one simulated customer, not a user test. My driver draws boxes at inhuman speed, and I set the output and source folders through the app's own routines because I can't operate a Windows folder picker — the app validated both and showed them back to me correctly. Where a button appeared dead I explicitly counted native dialogs before reporting it: on the stale-bin Restore all the count was **zero**, so nothing of mine swallowed a prompt. Only 1 of 11 supplier layouts and no taught field positions transferred into my sandbox, so more documents arrived untaught than a settled customer would see — I've flagged that where it could explain a finding. Round 3's numbers (5 contained, 0 filed, 147/53) are from my own report; tonight's (19 spread, 12 filed, 188/12, 40 misattributed) I verified on screen and on disk. I can't tell you why the first pass names the wrong company and a reprocess names the right one — I only judge what the screens and the folders showed me. Everything above is a suggestion for you to vet; I changed no code, no copy, and no setting outside the sandbox.

**Screenshots** (25, in `…\scratchpad\chris-sandbox\`): `r4_01_signin` · `r4_02_recovery` · `r4_03_terms` · `r4_04_wizard1` · `r4_05_structure` · `r4_06_home` · `r4_07_importready` · **`r4_08_importdone`** · `r4_09_reviewqueue` · `r4_10_doc1` · **`r4_11_teach_eee`** · **`r4_12_addressblock`** · **`r4_13_oakhaven`** · **`r4_14_nordwind`** · `r4_15_search` · `r4_16_wizard_field1` · **`r4_17_locate_glow`** · **`r4_18_label_garble`** · `r4_19_datewarn` · `r4_20_wizard_review` · `r4_21_split` · `r4_22_bin_empty` · `r4_23_docdetail` · **`r4_24_stamped`** · `r4_25_settings`


---
---

# ROUND 5 — 2026-08-13 (evening), the first round that is a TRUE comparison

**Why this round exists.** The owner asked for Chris round 5 as the acceptance test for the
home-run arc (10 commits, `332bf68` → `1f2b386`). His report is **verbatim** below; this header
records the conditions, and the section after it records what I verified at source afterwards —
because three of his seven new cards are consequences of changes made THIS session, and one of
them is a defect in my own work that he found before any owner did.

**Sandbox conditions.** Fresh install at HEAD `1f2b386`, session-mortal sandbox, own userData and
Output, admin created through the real first-run flow (0 users seeded), the **SAME 200 scans** as
rounds 2, 3 and 4, CDP 9223. Shipped fresh-install defaults — the owner's hand-flipped switches are
NOT present.

**TWO CONDITIONS RECORDED THIS TIME THAT PREVIOUS ROUNDS COULD NOT STATE:**

1. **The graft drew the SAME template as round 4** — template 1 = `Bramblewood Joinery Ltd` /
   `purchase_order`, with `supplier_name` **and** `vat_no` frozen to the owner's own values. Round 4's
   headline numbers were an artefact of which single layout `seed-taught-state.js` happened to
   transfer, and nobody had recorded it. Recorded now, and drawn again — so round 4 → round 5 is a
   real comparison, and his "188 need review / 12 ready" repeating EXACTLY is a stable measurement
   rather than a coincidence.
2. **Migration 67 fired on the fresh install and seeded all seven keys** (`autofile_gate_unify`,
   `far_lowconf_valued_only`, `type_election_title_first`, `reprocess_shadow_stale_drop`,
   `xcheck_corrob_note_demote`, `graduation_window=5`, `corroboration_autofile`). This is the first
   live proof of the promotion, and it is why his credit-note finding closed by itself.

**Not exercised this round, stated so it does not read as a failure:** `template_buyer_issued_type_scope`,
`template_identity_hold_siblings`, `teach_identity_near_match_keep` and `name_lexicon_low_distinct`
all ship DEFAULT OFF and were not armed. The grafted template also carries `buyer_issued = 0`
because that mark is written at confirm time (go-forward-only) and the row was grafted, not
confirmed. His card 1 of round 4 ("40 documents under my own company") therefore repeats
identically — the fix for it exists and is dark.

---

## AFTER-THE-FACT VERIFICATION (main session, read-only, on the SANDBOX DB only)

Chris judges what the screen shows and does not diagnose — correctly. Three of his cards needed
checking at source, and two of them changed shape when checked.

**1. Card 3 ("the near-miss is invisible at the draw") — CONFIRMED, and the cause is a gap in THIS
SESSION'S work, not a missing feature.** The teach-time near-match challenge shipped in `7dfb580`
and did not fire. Verified in his sandbox DB:

```
findNearMatchIdentity("Drambiewood Joinery Ltd") -> {"near":false,"reason":"no-near-match"}
documents under 'Drambiewood Joinery Ltd' : 38 needs_review, 1 confirmed
frozen template identity                  : template 1 = "Drambiewood Joinery Ltd"
```

The predicate's substrate is **human-confirmed `documents.supplier_name`, minimum 3** — deliberately,
so a machine-stamped cohort can never become "the name you already use". On a FRESH INSTALL there
are **zero confirmed documents**, so the correct spelling existed in exactly one place: the
template's **frozen identity**. The arc's own design says Tier B (`template_fields.fixed_value`)
may "only veto or trigger ASK, **never** be a target" — an ASK is precisely what this surface does,
and I did not wire it. **The fix is to widen the challenge's lookup to frozen template identities
as an ASK-only source; the ≥3-human-confirm rule stays as the bar for anything that WRITES.**
Note the second half: the frozen identity had ALREADY been overwritten with the garble, because
`teach_identity_near_match_keep` ships OFF. With that flag on, the incumbent survives the write AND
becomes available to name at the draw. The two halves need to ship together.

**2. Card 1 ("restored documents came back with no document behind them") — CONFIRMED AT SOURCE, and
it is worse than 'no preview'.** Doc #40, restored, back in the queue:

```
status=needs_review  working_path=…\userData\inbox\40.pdf   stored_path=null
resolveFilePath  -> …\userData\inbox\40.pdf
exists on disk   -> FALSE          (the inbox still holds 156 other files)
```

So the working copy was **deleted while the row kept pointing at it**. That is the diagnostic
shape: on the legitimate path (confirm) `reviewService` unlinks the working copy AND clears
`working_path` in the same step, so a row can never point at a file that is gone. Something removed
this file without clearing the pointer, leaving a document that can never render and — as Chris
says — still offers a green **Confirm & File**. `sweepInboxOrphans` (main.js:903) is ruled out: it
keeps every path `getWorkingPaths` returns, and that query has no status filter, so a binned row's
copy is protected. `_purgeOne` is ruled out: it deletes the ROW, and this row exists.
**ROOT CAUSE NOT ESTABLISHED — it needs a targeted repro (import, delete, restart, restore) and it
is the top of the vet queue.** Two guards are worth considering regardless of cause: a restored row
whose page is missing must say so, and `Confirm & File` must not be offered on a document with no
page.

**3. Card 2 ("File All Ready offered 40, filed 0, said nothing") — CONFIRMED, and the silence is my
bug.** The count shipped in `7db3f21` and is honest ("up to 40 of 219"), because the dialog uses the
loop's OWN skip rule — but the loop then rejects a document a SECOND time, on `confirmBtn.disabled`
(missing type or required field), which is only knowable after its fields load. All 40 failed there.
The summary then did not appear because I wrote it inside `if (filed)`, so the one run that most
needs an explanation — **zero filed** — is the one run that says nothing. Both are cheap fixes:
report `Filed 0 of 40` with the dominant reason, and never gate the summary on a non-zero count.

**4. Card 5 ("switches that say 'Off by default' while sitting on") — CONFIRMED, and it is migration
67's doing.** The promotion turned seven switches on for new installs; their Settings copy still
ends "Off by default." The switch is right and the sentence is now false. This is exactly the
contradiction migration 60's ritual was written to avoid (rows, not code defaults, "so the screen is
truthful") — the rows are right, the PROSE was not updated with them.

**5. Card 7 ("the read-back banner covers the toolbar and persists") — mine, from `7dfb580`.** The
`#anchor-readout` bar was chosen over a toast deliberately (a toast cannot carry the Undo button and
is destroyed by the next call), but it is not cleared when a new draw starts.

**6. Cards 4 and 6 are genuinely new and neither is a regression:** bulk repair after a bad teach
(one action broke 39 records; the way back is 39 actions), and the `.metadata` XML surviving an
Empty bin that deleted its PDF.

**Nothing from this round has been implemented.** It all queues for the owner's vet.

---

## Chris's report (verbatim)

# Chris The Customer — round 5, 2026-08-13 (direct comparison with round 4)

**TL;DR**
1. **The teach has found its voice.** Every draw now tells me what it read — *"✓ I read `Drambiewood Joinery Ltd` from your box"* — a bad box gets a real refusal, and the two fields it wipes are named with a working **Undo**. That is round 3's finding 1, round 3's finding 3 and round 4's card 3, all closed. The stamp moved off the letterhead, Empty bin now really deletes the PDF, credit notes type correctly, and the recycle-bin trap I reported twice is gone.
2. **But the near-miss is still invisible at the moment I make it.** The app told me it read a two-character misspelling of my own company and said nothing about that; I confirmed, and it built a `Drambiewood-Joinery-Ltd` folder on my disk. One reprocess later, **39 documents** carried the misspelling. The check *does* exist — it fires beautifully on the siblings — it just doesn't run for the person holding the pen.
3. **A new one, and it is the worst thing I found all night: I deleted documents, closed the app, reopened it, pressed Restore all — and they came back as records with no document behind them.** "No preview available", nothing to look at, and **Confirm & File still enabled**.

**Conditions.** Fresh install, shipped defaults — not the owner's hand-flipped switches. Same 200 scans as rounds 2, 3 and 4. Taught knowledge grafted from a read-only snapshot: 8 document types with 62 fields, 13 field anchors, 665 supplier hints, 18 logo fingerprints, 12 label overrides, and — I'm told, and it matters — **the same single supplier layout as round 4** (my own company's purchase order, with the company name and VAT number frozen). So the numbers below really are comparable this time. Everything happened inside the sandbox. **Nothing here is implemented — it queues for your vet.**

---

## Walkthrough

**First contact is unchanged and still the best part of the product.** *"There are no default credentials — you choose everything below"* (r5_01), the recovery code with **Copy code**/**Print…** and Continue locked behind the tick (r5_02), Terms still opening **"WORKING DRAFT — FOR LEGAL REVIEW ONLY"** (r5_03). The wizard is seven calm steps (r5_04, r5_05); when I fed it a bad folder it said *"That folder can't be written to — pick another location."* and refused to move on. The filing preview shows my real path, and the file-name builder now explains its own oddity: *"The Title part only appears on documents that carry a title — for most (like this invoice) it simply drops out."*

**The practice run is still superb** — and still says the sentence the real app has spent four rounds not saying: I drew a box and got **"Read "Riverside Office Co." from your box."**, then **"Read "INV-1042" from your box."**, then a closing screen naming every file and its folder. (One nit: that sentence was still sitting on screen on document 3, where I drew nothing, and on the finish screen.)

**Import: 200 scans in under four minutes, 0 errors.** Live counter, then **"FINISHED ✓ 200 processed — 188 need your review before filing, 12 ready"** (r5_07) — *exactly* round 4's numbers, and this time from the same starting knowledge, so it's a real repeat rather than a coincidence.

Review opened grouped by sender (r5_08) with the same wrong pile at the top: **"Bramblewood Joinery Ltd · 60 documents · 48 need a look"**, holding 20 of my own purchase orders plus 20 Oakhaven delivery notes and 20 Nordwind quotes. Then I repeated last round's poison (r5_17), confirmed it, reprocessed, ran File All Ready, drew on blank paper, sprang the recycle-bin trap deliberately, emptied the bin against a filed PDF, and drove the approval workflow to a stamped copy (r5_19–r5_22).

---

## VERIFY LIST — every prior finding, one line each

### Round 3's table

| Finding | Round 4 | Tonight |
|---|---|---|
| 1. Teach bled onto another company's docs, misfiled | NEW PROBLEM | **BETTER-BUT** — 0 siblings touched at the draw (was 19); 39 after a reprocess, but every one **flagged and named against the correct spelling**, dropped to 70%, and File All Ready filed none. See card 3 |
| 2. "Reprocess all in queue" warns not at all | FIXED | **FIXED** — *"Re-read all 79 documents (Bramblewood Joinery Ltd) from their pages? … Documents you've already confirmed and filed are not touched."* |
| 3. Queue says 200 when N need you | FIXED | **BETTER-BUT** — the import summary and per-group rows carry the split; the nav badge and the Review tab still show the flat total (200, then 219) |
| 4. Tour + Home promise self-filing the default prevents | SAME | **SAME** — tour card 5: *"Documents it's fully confident about file themselves automatically"* |
| 5. 63 toggles, many ON under "Off by default" | FIXED (24) | **BETTER-BUT** — now **29 toggles, 13 on**; still readable English, but several say "Off by default" while showing on. See card 5 |
| 6. Confirming never says where the file went | SAME | **SAME** — queue ticked 220→219, silence |
| 7. Red dots on perfectly-reading fields | SAME | **FIXED** — the markers are now hollow grey and green; no error red on correct fields |
| 8. Restore one at a time | FIXED | **FIXED** — *"Restore all 60 documents … They go back to where they were deleted from"* |
| Four names for the unknown-sender state | FIXED | **FIXED** — only "Sender not identified" all night |
| Approve silently does nothing | FIXED | **FIXED** — arms, then *"Approved by chris on 13-08-2026 · View stamped copy"* |
| Import's "No documents found" false alarm | FIXED | **FIXED** — *"📄 200 documents ready to import"* |
| Mid-run counter · Recovery code copy/print · Bin row "— / Sales Order" | FIXED | **FIXED** — all three |
| Terms = solicitor draft | SAME | **SAME** |
| 'SUPPLIER' caption became a company name | SAME CLASS, committed | **BETTER-BUT** — CUSTOMER read `DELIVER TO`, but it is now flagged: *"This value reads like a document heading, not a name"* |
| Delete / Delete All copy | truthful | **STILL TRUTHFUL** — and Empty bin has joined them |
| Teach picker search · wizard's last button · "Teach this position" glow · Split PDF | FIXED | **not re-tested this round** |

### Round 3's eight new findings

| # | Finding | Round 4 | Tonight |
|---|---|---|---|
| 1 | Teach-time "doesn't look like a company name" never spoke | SAME | **BETTER-BUT** — the teach now always states its read and refuses an unreadable box; a *near-miss of a name I already use* still draws no comment. Card 3 |
| 2 | Recycle bin stale; Restore all does nothing | SAME | **BETTER-BUT (the trap is gone)** — with the bin open I deleted 5 more, pressed Restore all, and got **"Restore all 5 documents from the recycle bin?"** and a real restore. The *list* is still stale until you leave and come back |
| 3 | ⊕ teach silent on success and failure | SAME | **FIXED** — speaks on both. Card 3 |
| 4 | Reprocess flips green docs to "Matched by logo only" | SAME | **SAME** — hit it on a Veltrix sales order |
| 5 | Label auto-detect garbles captions and offers them | SAME | **SAME** — *"✓ Anchor (label above): `Oo BS` → `re UP ees`"*, presented with a tick |
| 6 | Wrong character in a reference, no fix but walking back | BETTER-BUT | **BETTER** — I typed a correction straight into a field and it took it, re-read, and explained what changed |
| 7 | Cold-start offers a junk fragment as a company | FIXED | **FIXED** — no junk suggestions; instead *"A known supplier's name appears on this page, but not in the letterhead area, so it wasn't trusted as the issuer."* |
| 8 | Split PDF gave no response | FIXED | not re-tested |

### Round 4's eight new findings

| # | Finding | Tonight |
|---|---|---|
| 1 | 40 documents from two other companies under MY name at 95% with MY VAT | **SAME, identically** — Oakhaven delivery note printing *"Oakhaven Electrical Wholesale"*, *"VAT Reg GB 660 1173 45"*, *"GOODS DELIVERY NOTE"* reads **Issuer "Bramblewood Joinery Ltd" 95%**, **VAT "GB 512 8846 27"** (mine), type **Purchase Order**, *"Nothing was flagged"* (r5_09). A reprocess healed all 40 into their own groups again |
| 2 | One slightly-off box spread to 19 and filed 12 | **BETTER-BUT** — 1 filed (the one I confirmed myself), 0 spread until a reprocess. File All Ready now **carries a count**. Card 3 |
| 3 | Teaching one field silently empties two others | **FIXED** — *"⚠ Customer and VAT Number were read using the previous supplier's learned positions, so they have been cleared. Check them before you confirm."* + **"Undo — put them back"**, which I pressed and which restored both |
| 4 | "Empty bin" promises to delete the PDF and doesn't | **FIXED** — I emptied the bin against a filed PDF and the PDF was genuinely gone. Small residual in card 6 |
| 5 | APPROVED stamp lands on the company name and title | **FIXED** — stamp is now bottom-right on clear paper; letterhead and "PURCHASE ORDER" untouched (r5_21, r5_22) |
| 6 | Credit notes typed as Invoices; the fix ships off | **FIXED** — `Meadowvale-Dairy_credit_note_0026.pdf` types as **Credit Note**, and the switch now ships **on** |
| 7 | One supplier split across two piles | **SAME** — Silverbeck 11 + 9 hiding under "Sender not identified"; Pelican 15 + 5; Castellan 15 + 5; Ironclad 18 + 2 |
| 8 | More knowledge, less ready to file (188/12 vs 147/53) | **SAME — 188 / 12 exactly.** With the same layout grafted as last round, this is now a stable number rather than a mystery |

---

## NEW findings, worst first

### 1. Documents restored from the recycle bin came back with nothing behind them — and the app will still file them

- **Citation (verbatim):** delete → *"Delete "Harrowgate-Timber_sales_order_0026.pdf"? It goes to the app's recycle bin — you can restore it from Search."* Restore → *"Restore all 2 documents from the recycle bin? They go back to where they were deleted from (the review queue, or their filed folder)."* What I got back: the row, all its details — **Harrowgate Timber Supplies · HTS-SO-73867 · 768.96** — and where the page should be, **"No preview available"** (r5_15). The **"✓ Confirm & File"** button was green and enabled.
- **User-moment:** tidying up on Monday, closing the app, and changing my mind on Tuesday.
- **Observed confusion:** the whole promise of that bin is "you can restore it". I restored it and got an index card with no document attached. I can't check it, can't read it, can't print it for the accountant — and the app is perfectly willing to file it into my cabinet as though it were real. Earlier the same thing happened to 60 documents at once and I only noticed because every thumbnail in the list had gone white.
- **Harm + severity:** the thing I fear most — a document gone, quietly. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** don't clear a binned document's page until the bin is emptied. If it has already gone, the row must say so — *"The scanned page for this document is no longer available. Restoring brings back its details only."* — and Confirm & File should not be offered on a document with no page.
- **What I may be missing:** a same-session delete-and-restore worked perfectly, so this only bites once the app has been closed in between. The second time I tested it I had to force the app to close because shutting its windows didn't end it, so I can't swear the shutdown was tidy. My original scans were still sitting in the Processed folder, so nothing was lost from the computer — only from the app.

### 2. File All Ready offered to file 40 documents, filed none, and said nothing

- **Citation (verbatim):** **"File up to 40 of 219 documents in the Review queue? / 179 flagged documents are not included — they stay in the queue until you check them. / Every document with its type and required fields filled in will be filed, exactly as if you confirmed it one by one. Documents still missing required details are left in the queue for you to review."** I said yes. The queue stayed at **219**, my output folder gained **nothing**, and no message appeared.
- **User-moment:** the end-of-day tidy-up, clearing the easy ones.
- **Observed confusion:** the warning is a big improvement — it finally tells me a number. But the number then didn't happen, and nothing told me why. I'd assume the button was broken and press it again. (Every one of those 40 turned out to be missing a required field, so the app was right to hold them — it just counted them as ready first.)
- **Harm + severity:** slowed and trust-eroded; last round the same button filed 19 silently, tonight it filed 0 silently. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** count only what will actually file, and always say what happened afterwards — *"Filed 0 of 40. All 40 were still missing a required field (Order Date, PO Number) and stay in the queue."*
- **What I may be missing:** "up to" is doing honest work in that sentence. I still read it as a promise of forty.

### 3. The app now tells me what it read from my box — but not that it is one letter off a company I already use

- **Citation (verbatim):** at the draw — **"✓ I read `Drambiewood Joinery Ltd` from your box. Saved as this layout's company name when you confirm."** (r5_17). At Confirm — nothing. On my disk — `Output/Drambiewood-Joinery-Ltd/2026/May/Purchase-Order.24-05-2026.PO-53045.pdf`, its card reading `<SupplierName>Drambiewood Joinery Ltd</SupplierName>`. Then one reprocess later, **39** documents in a new group, each one carrying: **"Letterhead may read "Bramblewood Joinery Ltd" — detected "Drambiewood Joinery Ltd". Please confirm the issuer. ✓ Issuer is correct"**, dropped from 95% to **70%** (r5_18).
- **User-moment:** teaching the company name on my own purchase order, exactly as last round.
- **Observed confusion:** the app plainly *knows* how to spot this — that sibling sentence is the best warning in the product, it names the right spelling and it holds the document. It just doesn't run at the one moment where it would have cost me nothing: while I'm looking at the box I drew. Instead I got a cheerful tick, and my filing cabinet has two versions of my own company in it.
- **Harm + severity:** one bad box still reaches disk and 39 records. **High**, but a long way better than last round, when the 39 would have been silent at 95% and a batch button would have filed twelve of them.
- **Class:** CONFUSION.
- **Proposed alternative:** run the sibling check at the draw and say the same thing there — *"I read 'Drambiewood Joinery Ltd'. That's close to a name you already use (Bramblewood Joinery Ltd). Use the existing one, or keep what I read?"*
- **What I may be missing:** "Drambiewood" looks like a perfectly good company name, so a does-this-look-like-a-name test would rightly wave it through. The comparison against names I already have is the only signal that works — and it already exists downstream.

### 4. One bad box poisoned 39 documents, and the way back is one at a time

- **Citation (verbatim):** Review sidebar after the reprocess: **"Drambiewood Joinery Ltd · 39 documents · 39 need a look"**. On a poisoned one I typed the correct name into Document Issuer; the misspelling warning cleared and I got *"⚠ Customer and VAT Number were read using the previous supplier's learned positions, so they have been cleared."* — for that document only. Nothing offered to fix the other 38.
- **User-moment:** realising my mistake and trying to undo it.
- **Observed confusion:** one action broke 39 records; repairing them is 39 actions. I'd want the app to notice it had just renamed a pile and offer to put it back the way it was.
- **Harm + severity:** slowed, and a real chance I give up halfway and leave the cabinet half-wrong. **Medium.**
- **Class:** PREFERENCE.
- **Proposed alternative:** when a correction reverses a name the app applied in bulk, offer it in bulk — *"38 other documents also read 'Drambiewood Joinery Ltd'. Change them to 'Bramblewood Joinery Ltd' too?"*
- **What I may be missing:** nothing was filed, so nothing needs rescuing off the disk. This is tidying, not rescue.

### 5. Switches that say "Off by default" while sitting on

- **Citation (verbatim):** Settings → Processing, **"Let the printed title decide the document's type … Fixes credit notes being typed as invoices. Off by default."** — with the toggle **on** (r5_16). Same wording, same on-position, on **"Auto-file earlier when two readings agree … Off by default."**
- **User-moment:** checking what the app is doing before I trust it with a batch.
- **Observed confusion:** the sentence and the switch disagree. I can't tell whether the switch is on because someone set it, or whether the page is lying to me — and this is the page I'd read if I were trying to work out why a document went wrong.
- **Harm + severity:** trust-eroded; the settings page is my one source of truth. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** drop the "Off by default" sentence once a switch ships on, or replace it with the current state — *"On (recommended). You can turn this off if…"*
- **What I may be missing:** I'm glad it's on — it's what fixed my credit notes. It's the sentence I'd change, not the switch.

### 6. Emptying the bin deletes the PDF but leaves its details in a card beside it

- **Citation (verbatim):** **"Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone."** The PDF went. Left behind: `…/Drambiewood-Joinery-Ltd/2026/May/.metadata/Purchase-Order.24-05-2026.PO-53045.xml`, still readable, still containing `<SupplierName>`, `<PoNumber>`, `<Total>3,417.84</Total>`.
- **User-moment:** clearing out a document I didn't want kept.
- **Observed confusion:** last round this sentence was untrue and now it's true, which I'm pleased about. But if I emptied the bin because a document had details on it I didn't want lying around, the company, the reference and the amount are still sitting in a file next to where it was. The empty folders stay too.
- **Harm + severity:** trust-eroded; a privacy expectation partly met. **Low-medium.**
- **Class:** QUESTION.
- **Proposed alternative:** remove the card with the PDF and tidy the empty folders, or say so — *"…including their PDF files and their filing details."*
- **What I may be missing:** the sentence only ever promised the PDF, so this is me reading intent into it. That's exactly what a customer does.

### 7. The teach's read-back banner sits over the toolbar and stays until dismissed

- **Citation (verbatim):** the **"✓ I read `Drambiewood Joinery Ltd` from your box…"** panel opens across the top of the page, covering the zoom, page and Straighten controls (r5_17), and it stays there through the next draw unless I click its ×.
- **User-moment:** drawing a second box after the first.
- **Observed confusion:** I lost the toolbar, and on my next draw I couldn't tell whether the message on screen was about the box I'd just drawn or the one before.
- **Harm + severity:** cosmetic-to-slowed. **Low.**
- **Class:** PREFERENCE.
- **Proposed alternative:** clear it when a new draw starts, and float it clear of the toolbar.
- **What I may be missing:** it is genuinely the best new thing in the product. I'd rather have it in the way than not have it.

---

## Warnings truth-table (tonight)

| Button | Warned? | Told the truth? | Said how many? | Way back, on that screen? |
|---|---|---|---|---|
| **Teach ⊕, unreadable box** | **Yes** ✓ — *"⚠ I couldn't read any text in that box, so nothing was saved… Try drawing it a little wider, or type the value into the field yourself."* | Yes — nothing changed | n/a | n/a |
| **Teach ⊕, blank paper** | **Yes** ✓ — same message | Yes | n/a | n/a |
| **Teach ⊕, garbled near-miss** | Announces the read; **says nothing about the near-miss** | Truthful about what it read | n/a | Undo offered for the cleared fields ✓ |
| **Teach clearing other fields** | **Yes** ✓ — names both fields and why | Yes | **Yes (both named)** | **Yes — "Undo — put them back", tested ✓** |
| Confirm & File | **No** | — | — | No — created `Drambiewood-Joinery-Ltd` |
| **File All Ready** | Yes | **Partly** — criteria honoured, but 0 of the promised 40 filed | **Yes ("up to 40 of 219", "179 flagged… not included")** | **No summary after** |
| Reprocess (group) | **Yes** ✓ | Yes — count, scope, "confirmed not touched" | **Yes (79)** | n/a |
| Delete (one) | Yes | Yes — names the bin and the route back | n/a | Yes ✓ tested |
| **Restore all (fresh bin)** | Yes | Yes — count + destination | **Yes (60, then 2)** | n/a |
| **Restore all (stale bin)** | **Yes ✓ — the trap is gone** | Yes — counted the 5 deleted after the view opened | **Yes (5)** | n/a |
| **Restore all (after a restart)** | Yes | **No** — restored records with **no document behind them** | Yes (2) | None offered |
| **Empty bin** | Yes | **Yes now** — the filed PDF was genuinely deleted | **Yes ("all 1")** | Correctly says none |
| Approve, 1st / 2nd press | Arms — *"Press the button again to confirm — an approval is permanent and stamped with your name."* | Yes | n/a | Arm expires honestly |
| Reject with no note | **Yes — blocks and explains**: *"Add a short note first — the sender needs to know why it was rejected."* | Yes | n/a | Sender sees the reason |
| Bad output folder in setup | **Yes** ✓ — *"That folder can't be written to — pick another location."* | Yes | n/a | Stayed on the step ✓ |

**Dialogs counted, every time.** 60 delete prompts, 5 delete prompts, 1 restore prompt on the stale bin, 1 on Empty bin, 1 on File All Ready, 1 on each reprocess. **Nothing of mine swallowed a prompt** — where I report silence, the silence is the app's.

The pattern has genuinely shifted. Last round I wrote *"the terrifying buttons are handled beautifully; the harmless-sounding ones are silent."* Tonight the teach has joined the good column. **Confirm & File and File All Ready are the two that still don't speak** — and they are the two that put things on my disk.

---

## What genuinely worked

**The teach finally shows its work.** *"✓ I read `Drambiewood Joinery Ltd` from your box. Saved as this layout's company name when you confirm."* — I have asked for that sentence in three consecutive rounds. Alongside it: a bad box gets a real, kind refusal that tells me what to do instead, and the two fields the teach wipes are now named, explained, and reversible with a button that works. That's three of my findings closed in one change.

**The sibling warning is the best sentence in the product.** *"Letterhead may read "Bramblewood Joinery Ltd" — detected "Drambiewood Joinery Ltd". Please confirm the issuer."* It names both spellings, tells me which one the page shows, drops the confidence to 70%, and holds the document. Put that sentence in front of me at the draw and my card 3 disappears.

**The approval workflow, again, end to end** — two-press arm that explains itself, a rejection that stops and tells me why a reason is needed, a stamped copy named `…APPROVED-stamped-r1.pdf` beside the original, and the stamp now sitting **bottom-right on clear paper** where it belongs (r5_22). I'd hand that to my office tomorrow.

---

## Top friction

**Everything the app now says, it says one step too late.** The near-miss check exists and it is excellent — on the siblings. The count exists on File All Ready — but not on what actually filed. The confidence drops to 70% and holds 39 documents — after a reprocess I had to choose to run. At every one of those moments the app is protecting me *downstream of the decision I already made*. Move the sibling check to the draw and the summary to the end of File All Ready, and there is no way left for me to hurt myself by accident. And behind all of it sits the one thing that genuinely frightened me: **documents I put in the bin and asked for back came out empty.** That's not a late warning, that's a missing document.

---

## Would I keep using this after two weeks?

**Yes — and the condition is lighter than last round, but it hasn't come off.** Round 3 I said yes without a condition; round 4 the condition came back on because twelve files went to disk under a misspelled name. Tonight one file did, and thirty-nine records were caught, named and held — that's the system working, and I want to say so plainly. What keeps the condition on is the recycle bin: I deleted, closed the app like anyone would at five o'clock, came back, pressed the button that says "restore", and got shells. **Fix that, give the teach's near-miss check a voice at the draw, and tell me what File All Ready actually did, and I'd hand this to my office without a briefing.**

---

## What I may be missing

> I'm one simulated customer, not a user test. Three things I got wrong tonight, on the record. **(1)** Early on I wrote a sweeping click that hit every "×" on the screen — including the per-row delete buttons — and my own prompt-handler said yes to all sixty. That was me, not the app; the app asked properly sixty times. It did lead me to the recycle-bin finding, but I then reproduced that finding deliberately with two documents and one restart. **(2)** For about half an hour I thought boxes were being read forty pixels above where I drew them. They weren't: arming the teach adds a *"Drag to select the Document Issuer value"* bar that pushes the page down, and I had measured the page before arming. Every garbled read I got before I noticed — "Be", "a", "re UP ees" — was my error, and none of it is in this report as a finding. **(3)** The app shut down unexpectedly once mid-session, and the second time I had to force it closed because shutting its windows didn't end the process — so I can't promise either shutdown was tidy. Separately: to rerun last round's teach experiment I had to re-import twenty of my own purchase orders, so every queue number after that point (219, 220) is inflated by twenty against the import headline of 200. My driver draws boxes at inhuman speed, and I set the output and source folders through the app's own routines because I can't operate a Windows folder picker — the app validated both, rejected a malformed one with a clear message, and showed the good one back to me correctly. Round 4's numbers are from my own report; tonight's I verified on screen and on disk. Everything above is a suggestion for you to vet; I changed no code, no copy, and no setting outside the sandbox.

**Screenshots** (22, in `…\scratchpad\chris-sandbox\_r5_screens\`): `r5_01_signin` · `r5_02_recovery` · `r5_03_terms` · `r5_04_wizard1` · `r5_05_structure` · `r5_06_importready` · **`r5_07_importdone`** · `r5_08_reviewqueue` · **`r5_09_oakhaven`** · `r5_10_quillstone` · `r5_11_teach_good` · `r5_12_calbox` · `r5_13_rubberband` · `r5_14_state` · **`r5_15_nopreview`** · `r5_16_settings` · **`r5_17_teach_garble`** · **`r5_18_sibling_caught`** · `r5_19_workflow` · `r5_20_stamped` · `r5_21_stamp_position` · **`r5_22_stamp_full`**

**Sandbox left running** on CDP 9223, PID 26060, with 218 documents in the queue, 39 of them carrying my misspelling, and one approved stamped copy on disk.
