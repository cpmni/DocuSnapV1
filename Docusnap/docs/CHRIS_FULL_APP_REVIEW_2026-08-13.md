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
