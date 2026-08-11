# Chris The Customer — full app vet, 2026-08-12 (round 3: comparison rerun of the past two nights)

**Why this round exists.** The owner's order before bed (2026-08-11 night): *"have chris rerun the
same tests from the past two nights in his sandbox and have him compare the results after todays
work."* His report below is verbatim; this header records the conditions and after-the-fact notes.

**Sandbox conditions.** Fresh install at the session sandbox
(`C:\Users\cmccu\.claude\jobs\3ab7c2e3\tmp\chris-sandbox\` — session-mortal; screenshots live
there too, copy anything worth keeping). Own userData, own Output, admin created through the real
first-run flow (0 users seeded), the SAME 200 scans as both prior nights (TESTING\IMPORT), CDP
9223, PID 132896. Seeded with the owner's learning via `scripts/seed-taught-state.js` from a
`db.backup()` snapshot of the live DB: 8 document types, 9 field anchors, 290 supplier hints, 10
logo fingerprints, 7 label overrides — and the SAME deviation as the 08-11 round, stated to Chris
up front: only 1 of 9 supplier templates transferred (slug/FK safety skips).

**THE BUILD UNDER TEST WAS THE SHIPPED DEFAULT at `afe8da0`** — migration 63, the 08-11 arcs
(Stage-0 identity refusals, teach flow rework, Approve visible arm, plausibility warn,
corroboration record) all present as a fresh install receives them; nothing armed by hand.
`TEMPLATE_NAME_EDGE_GROW` (built tonight) is DEFAULT OFF and was NOT part of what he exercised;
fix (a)'s teach snap trailing pad IS live on his teaches.

**THE RESULT IN ONE LINE:** the wrong-company bleed is FIXED in both variants — his deliberate
repeat of last night's poison (a garble-read teach on an owner-issued purchase order) touched ZERO
Oakhaven documents and zero VAT crossover; the garble was contained to 5 same-supplier docs, every
one flagged and held from File All Ready. His verdict: *"Yes — and for the first time without a
condition attached to my documents' safety."*

**Main-session triage notes (verified in code AFTER his run; for the owner's vet, NOT implemented):**
- His finding 1 (the promised teach-time "doesn't look like a company name" warning never spoke):
  DIAGNOSED — the plausibility toast in `review/renderer.js` (~:3634) is nested inside
  `if (detected)`, i.e. it only runs when the ANCHOR CAPTURE succeeded. A garbled read that also
  fails anchor capture (or is dropped by the new stale-box suppression) exits silent — exactly the
  moment the warning was built for, and it also explains his finding 3 (⊕ silent on success AND
  failure on some docs: `detected` falsy = no toast of any kind). Candidate fix is a one-line
  restructure (run the plausibility check on the READ, outside the anchor branch) — owner vet.
- His finding 2 (stale recycle-bin view: "empty" + Restore-all no-op while 152 docs sat inside) is
  a refresh/staleness defect in the bin view, not data loss — nothing was lost, and a fresh entry
  restored all 152 correctly.
- His finding 4 (reprocess turned ~45 green docs amber, "Matched by logo only") is the
  `template_identity_on_page` guard doing its stated job on a fresh install (it is in
  PROVEN_ON_DEFAULTS); the copy is honest, the surprise is the lack of a reprocess-summary line.

**NOTHING IN THIS REPORT IS IMPLEMENTED. It queues for the owner's vet.**

---

Everything stayed inside the sandbox. Here's his report.

---

# Chris The Customer — round 3, 2026-08-11 (comparison rerun)

**Setup:** fresh install driven end to end — admin account, terms, setup wizard (output folder set), tour skimmed, all 200 scans imported, the same two teaches as last night (a garble-read ⊕ teach on a Bramblewood-issued Quillstone purchase order; a clean wizard teach of Ironclad Tool Hire), Reprocess all after each, File All Ready, the approval workflow, and the destructive buttons. Everything inside the sandbox; the owner's app and files untouched. Seeded conditions matched last night (owner's types/hints/anchors, only 1 of 9 supplier templates). **Nothing here is implemented — it queues for your vet.**

## THE HEADLINE, FIRST

**The wrong-company bleed did not come back — in either variant.** I reran last night's exact poison: drew a slightly-off box on a purchase order my own company issued, got confident garbage (**"SIIPDI ico"** — this year's "@a eens Ee"), confirmed it, and pressed Reprocess all. Last night that stamped 20 Oakhaven delivery notes at 95%, unflagged, and File All Ready misfiled all 20 with Quillstone's VAT in the metadata. **Tonight: all 20 Oakhaven notes stayed "Sender not identified." The garble spread only to 5 of the taught supplier's own purchase orders, every one flagged "Check" with an inline note — "doesn't read like a name — please verify" — and File All Ready held all 5 back.** It filed 45 documents (19 Ironclad, 18 Nordwind, 9 Veltrix — I checked the folders and opened the records: every company carries its own VAT number, no crossover anywhere). The only wrongly-named folder on my disk is `SIIPDI-ico` containing the one document **I personally confirmed** over a garbled name — and that is my second-worst finding, because the app let me do it without a word (see finding 1).

## Walkthrough (screenshots in `C:\Users\cmccu\.claude\jobs\3ab7c2e3\tmp\chris-sandbox\`)

First contact is still the best part of the product — "There are no default credentials — you choose everything below" *(step01)*, and the recovery-code screen now has **Copy code** and **Print…** buttons with Continue locked behind the I-saved-it tick *(step02)* — my gripe from last night, fixed. Terms still open with **"WORKING DRAFT — FOR LEGAL REVIEW ONLY"**. The setup wizard's structure step now explains the fourth name block: *"The Title part only appears on documents that carry a title — for most (like this invoice) it simply drops out"* *(step04)*, and there's a new Regional format step. The import ran 200/200 with **"70 processed of 200 found"** live *(step05)* — last night's false-finish counter is gone — and ended **"FINISHED ✓ 200 processed — 147 need your review before filing, 53 ready"** *(step06)*, with the old "No documents found in this folder" alarm replaced by *"All 200 scans from this folder have been brought in and moved to its Processed subfolder."* Home now carries the split too: *"147 need your review · 53 ready to file."*

The ⊕ teach and its aftermath are steps 07–13; the wizard teach is steps 14–18 — including the fixed locate step: after I typed "Ironclad Tool Hire" (its name genuinely isn't printed in the statement header), the page zoomed to fit and a **green glowing box ringed the name in the page footer** *(step15)* — last night I was asked to approve a box I couldn't see. When a typed value is printed twice, a **"1 of 2 ›" stepper** walks the boxes *(step16, step17)*. The armed Approve is step19.

## VERIFY LIST — both prior nights, one line each

| Finding (night 1 → night 2) | Tonight |
|---|---|
| 1. Teach bled a company onto another company's docs, misfiled | **FIXED** — 0 of 20 Oakhaven affected; garble contained to the taught supplier's own docs and flagged; no misfile I didn't personally force |
| 2. "Reprocess all in queue" warns not at all | **FIXED** — *"Re-read all 199 documents (all in queue) from their pages? … Documents you've already confirmed and filed are not touched."* Count, scope, truth |
| 3. Queue says 200 when 43 need you; reason buried per-doc | **FIXED** — import summary, Home ("115 need your review · 37 ready to file") and green/amber rows all carry the split |
| 4. Tour + Home promise self-filing the default prevents | **BETTER-BUT** — Home is honest now (*"2 suppliers have **qualified for** automatic filing… Nothing filed automatically in the last 7 days — that also depends on the filing bar in Settings → Processing"*); tour card 5 still says *"Documents it's fully confident about file themselves automatically"* |
| 5. 53→58 switches, many ON under "Off by default" | **BETTER-BUT** — descriptions rewritten in plain, honest English ("Don't mistake a VAT registration number for a VAT amount"); "Off by default" now appears only where the switch really is off (2 places). But the page is now **63 toggles** (46 ON) and still one long list |
| 6. Confirming never says where the file went | **SAME** — counter ticks down, no message; File All Ready filed 45 with no summary |
| 7. Red dots on perfectly-reading fields | **SAME** — red dots beside High·90-94% fields; tooltip copy improved but still the error colour |
| 8. Two clicks to delete 60, restore one at a time | **FIXED** — "Restore all" exists, counts, and names the destination; bin rows lead with the filename. But see NEW finding 2 |
| Four names for the unknown-sender state | **FIXED** — only *"Sender not identified"* seen all night |
| Teach picker unsearchable | **FIXED** — filter box, works |
| Wizard's last button hid the teaching | **FIXED** — *"Save teaching & file"*, and the closing screen honestly says the next few siblings may still come to Review |
| "Yes — teach this position" with no visible box | **FIXED** — zoom-to-fit + green glow, verified with my own eyes |
| Approve silently does nothing (4 presses) | **FIXED** — first press arms: button becomes *"Confirm — approve and stamp with your name"* + *"Press the button again to confirm — an approval is permanent and stamped with your name."* Second press executes: *"Approved by chris on 11-08-2026 · View stamped copy."* The arm honestly expires (~8s) if you dither |
| Import's "No documents found" false alarm | **FIXED** (exact promised copy) |
| Mid-run "132 of 132" counter | **FIXED** ("70 processed of 200 found") |
| Recovery code: no copy/print | **FIXED** |
| Bin row "— / Sales Order" | **FIXED** (filename first) |
| Terms = solicitor draft | **SAME** |
| 'SUPPLIER' caption became a company name | **SAME CLASS** — my oversized box read "SUPPLIER" into the issuer field, silently (I didn't commit it) |
| Delete/Delete All/Empty bin copy | **STILL TRUTHFUL** — Delete All remains the best copy in the product |

## The NEW findings, worst first (≤8)

### 1. The promised "that doesn't look like a company name" warning never spoke — two bad reads, total silence, and I still filed a junk folder
- **Citation (verbatim):** Document Issuer field after my ⊕ draw: **"SIIPDI ico"** (selected, no message — step11). Second attempt, bigger box: **"SUPPLIER"** (no message — step12). Then **✓ Confirm & File** filed it; disk now has `Output/SIIPDI-ico/2026/April/Purchase-Order.09-04-2026.PO-60029.pdf` with `<SupplierName>SIIPDI ico</SupplierName>`.
- **User-moment:** teaching the issuer on my own company's purchase order, exactly like last night.
- **Observed confusion:** I was told this build warns at teach time on gibberish. I produced gibberish twice and heard nothing — not even the old green "Captured the position" toast on this path. The guard that DID catch it lives downstream: after Reprocess all, the five sibling documents carrying the garble were flagged **"doesn't read like a name — please verify"**. So the cabinet is protected from spread — but the teach moment itself, and my own confirm, still let "SIIPDI ico" become a folder without comment.
- **Harm + severity:** junk folder in the filing cabinet, made with the app's blessing. **High** (down from last night's very-high, because containment now works).
- **Class:** CONFUSION.
- **Proposed alternative:** say at the moment of capture what the sibling-flag says later: *"I read 'SIIPDI ico' from that box — that doesn't look like a company name. Draw it again, or type the name yourself."* And say it again on Confirm if it still doesn't look like one.
- **What I may be missing:** a toast may have flashed faster than my watcher; and "SUPPLIER" being one word may be deliberately exempt. But I watched the DOM for 10 seconds either side on both reads and nothing arrived — and no message means the same thing to a customer either way.

### 2. Delete-everything with the bin already open: the bin says "empty", Restore all silently does nothing, and for three minutes my 152 documents were nowhere I could see
- **Citation (verbatim):** bin view open from an earlier restore → Delete ALL 152 from Review → bin view still reads **"The recycle bin is empty."** → **Restore all** pressed: no dialog, no message, nothing. Review: **"0 · All reviewed ✓"**. Search: only 48 confirmed. Re-entering the bin fresh: **"RECYCLE BIN 152"**, and Restore all then worked perfectly (*"Restore all 152 documents from the recycle bin? They go back to where they were deleted from…"*).
- **User-moment:** the exact panic path — I deleted everything, went straight to the undo place I already had open, and the undo place told me there was nothing to undo.
- **Observed confusion:** every screen I could reach agreed my documents were gone. Nothing was lost — the bin view was stale — but the recovery surface is the one screen that must never lie about what's in it.
- **Harm + severity:** trust-eroded at the worst possible moment. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** refresh the bin list whenever documents enter the bin (or on every view entry), and make Restore all on an empty-looking bin say *"Nothing to restore"* rather than nothing at all.
- **What I may be missing:** a human might naturally re-enter the bin and self-heal; I held the stale view open. But "already had Search open" is hardly exotic.

### 3. The ⊕ teach is now silent even when it works — and on one document it did nothing at all, repeatedly
- **Citation:** on `..._0027.pdf` my draw filled the field ("SIIPDI ico") with no acknowledgement. On `..._0021.pdf` the same ⊕-and-draw produced **nothing** — no value, no message, no error — on three attempts; only a much bigger box finally read "SUPPLIER".
- **User-moment:** drawing the box the teach panel told me to draw.
- **Observed confusion:** last night this path said *"Captured the Document Issuer position from this layout."* Tonight the wizard still announces its captures; the ⊕ says nothing on success and nothing on failure. A button that sometimes answers and sometimes doesn't teaches me to stop trusting it.
- **Harm + severity:** slowed; erodes confidence in teaching. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** always answer a draw — with the read, or with *"I couldn't read anything in that box — try drawing it a little larger."*
- **What I may be missing:** my driver draws faster than a hand; the 0027/0021 difference may be something about those pages I can't see. But the silence is real on both.

### 4. Reprocessing changed documents I never touched from "ready" to flagged — for a good reason nobody states
- **Citation (verbatim):** Meadowvale group **"5 need a look" → "20 need a look"** after Reprocess all; Veltrix 2 → 11. Each newly-flagged document: **"DOCUMENT ISSUER · Check · 69%"**, *"Matched by logo only — the page text doesn't confirm this company. Please check."* — on a page whose letterhead banner plainly prints "Veltrix Automotive Parts" (white-on-grey).
- **User-moment:** I pressed Reprocess all to apply my teaching and watched other suppliers' piles turn amber.
- **Observed confusion:** the flag itself is honest and the check takes two seconds — but ~45 documents that were green went amber after a button that I was told "re-reads with the latest learned data", and nothing explains why reprocessing changed its mind.
- **Harm + severity:** slowed; a whiff of warning fatigue. **Medium.**
- **Class:** QUESTION — is the logo-only hold meant to fire on pages where the name IS printed but hard to read? If yes, the copy earns its place; it just surprised me.
- **Proposed alternative:** none for the guard; perhaps a line in the reprocess summary: "N documents are now held for an extra check."
- **What I may be missing:** the printed banner may genuinely be unreadable to the machine; I can only see that a human reads it instantly.

### 5. The label auto-detect garbles most captions on a tilted scan — and a garbled label can be saved as what the app "looks for"
- **Citation (verbatim):** wizard read-backs: label for Statement Ref = **"Gen ate ant Te a (above the value)"**; Date = **"ne"**, then my redraw = **"Zor (left of the value)"** — which I accidentally accepted; Account No = **"ITLI ANNO"**. (Balance Due, CUSTOMER and VAT Reg No were read perfectly.)
- **User-moment:** confirming each field in the wizard.
- **Observed confusion:** when the label read comes back EMPTY the app is honest — *"⚠ couldn't read it cleanly — I'll remember the spot instead"* — but when it comes back WRONG, "Zor" is presented for approval exactly like a real word, and nothing remarks that "Zor" doesn't look like a label. The values still extracted right on all 19 siblings, so the spot may be doing the real work — but I've now taught it to "look for" three nonsense words.
- **Harm + severity:** trust-eroded lightly; possible future fragility I can't see. **Medium.**
- **Class:** CONFUSION.
- **Proposed alternative:** apply the same "doesn't read cleanly" fallback when the label text is gibberish, not just when it's empty.
- **What I may be missing:** whether a garbled label text actually harms future reads, or the spot alone carries it.

### 6. A table border became a "|" inside my reference, and the last-check screen offers no way to fix it but walking back
- **Citation (verbatim):** read-back **"Value: | ITH-0093"**; wizard review step listed **"Statement Number: | ITH-0093"**; the only guidance: *"If anything looks wrong, go back and redraw it."*
- **User-moment:** final check before saving the teaching.
- **Observed confusion:** the box caught the printed cell border as a character. I spotted it at review, but fixing one character meant Back through the wizard and re-teaching the field (the sidebar shortcut saved me, though nothing told me it existed — I clicked the field name on a hunch).
- **Harm + severity:** slowed. **Low-medium.**
- **Class:** PREFERENCE.
- **Proposed alternative:** make the review rows clickable to jump straight to that field (it may already — say so), and strip lone border characters from a read with a note.

### 7. The cold-start suggestion sometimes offers a junk fragment as a company
- **Citation (verbatim):** on a Silverbeck sales order: *"Never seen this sender before. The top of the page reads 'Cleaning' — please confirm the correct company (check it's the sender, not the customer)."* with a button **"Use 'Cleaning'"**.
- **Observed confusion:** one press files paperwork under "Cleaning". The caveat sentence is doing a lot of load-bearing work. (On my own purchase order, the same hint offered "Bramblewood Joinery Ltd" — technically the issuer, but that files supplier paperwork under my own name; the caveat again carries it.)
- **Harm + severity:** low — it asks rather than acts. **Low.** Class: QUESTION.
- **Proposed alternative:** don't offer a single sentence-fragment word as a company; require two words or a known-supplier match before showing the button.

### 8. Split PDF gave no visible response at all tonight
- **Citation:** ✂ "Split PDF…" pressed twice on a one-page document — no flyout, no message, no dialog observed. Last night it refused politely.
- **Harm + severity:** cosmetic-to-low; possibly my watcher missed a transient. **Low.** Class: QUESTION.

## Warnings truth-table (tonight)

| Button | Warned? | Told the truth? | Said how many? | Way back, on that screen? |
|---|---|---|---|---|
| Confirm & File (nonsense company) | **No** | — | — | No — filed to `SIIPDI-ico` |
| **Reprocess all in queue** | **Yes** ✓ (new) | **Yes** — count, scope, "confirmed not touched" | **Yes (199)** | n/a |
| Reprocess N from "\<group\>" | (new button; not pressed) | — | count in the label | — |
| File All Ready | Yes | **Yes** — criteria stated; flagged docs genuinely held | **No** | Not mentioned |
| Delete (one, from Search) | Yes | Yes — names the bin and the route back | n/a | Yes ✓ tested |
| Delete All Review | Yes | **Yes** — still the best copy in the app | **Yes ("ALL 152")** | Yes ✓ tested |
| Restore all (fresh bin) | Yes | **Yes** — count + destination | **Yes (152)** | n/a |
| **Restore all (stale bin)** | **No — no dialog, no action, no error** | — | — | **The trap** — view says "empty" while 152 sit inside |
| Approve, 1st press | Arms visibly | *"an approval is permanent and stamped with your name"* — true | n/a | Auto-reverts in ~8s (honest) |
| Approve, 2nd press | Executes | History + stamped copy appear | n/a | n/a |
| Teach ⊕, garbage read | **No — nothing at all** | — | — | — |
| Empty bin / practice run / tour | Not retested tonight | | | |

The old pattern — frightening buttons handled beautifully, harmless-sounding ones silent — is **half-cured**: Reprocess-all and Restore-all joined the honest side. The silent ones left are Confirm (where did it go?), File All Ready (how many?), and the teach ⊕ (did you hear me?).

## What genuinely worked

**The containment.** One garbage teach that last night poisoned 20 of another company's documents tonight touched five of the right company's documents and every single one was held with a plain-English reason. The system now knows the difference between what I taught it and what it can prove.

**The provenance chips.** "Recognised by: Not seen before / Its logo and wording", "Fields read by: Printed labels / Taught positions · 7 taught fields" — for the first time I can see *why* it believes something, on every document, in words I'd say aloud.

**And the typed-value locate flow.** Type the name, watch it zoom out and ring the footer in green, step "1 of 2" between duplicates. That is teaching software how to read my paper, and it felt effortless.

## Top friction

**The app still won't speak at the two moments I'm most likely to hurt myself**: when a teach reads garbage (silence), and when I confirm that garbage into a folder (silence). Everything downstream of those moments has grown guards — the siblings get flagged, File All Ready holds them — but the person holding the pen still gets no warning at the moment of writing. The promised teach-time sentence exists somewhere in this build, I'm told; I couldn't make it appear.

## Would I keep using this after two weeks?

**Yes — and for the first time without a condition attached to my documents' safety.** Nothing I did tonight — including deliberately repeating last night's poison — put one company's paperwork in another company's folder unless I personally confirmed a value the screen showed me plainly. My worst outcomes tonight were a junk-named folder I made myself with no pushback, and three minutes of believing 152 documents had vanished because the recycle bin lied about being empty. Fix the bin's staleness and give the teach a voice, and I'd hand this to my office without a briefing.

## What I may be missing

> I'm one simulated customer, not a user test. My driver draws boxes at inhuman speed, which cost me several failed teach attempts and may explain some silences a human would never see — though I retried the important ones slowly. I could not drive the native folder pickers and set folders the way the picker would. I accepted "Zor" as a label through my own haste and said so. Where a button did nothing I checked for a swallowed dialog before reporting it. The two prior nights' numbers (20 misfiled, VAT crossover) are from my own reports; tonight's (5 contained, 0 crossed, 152 recovered) I verified on screen and on disk inside the sandbox. I can't tell you why 0027 reads garble where 0021 reads nothing — I judge only what the screen and the folders showed me. Everything above is a suggestion for you to vet — I changed no code, no copy, and no setting outside the sandbox.

**Screenshots:** `step01_signin` · `step02_recovery` · `step03_wizard1` · `step04_structure` · `step05_import_midrun` · `step06_import_done` · `step07_quill_open` · `step08_teachdraw` · `step11_afterslow` · `step12_supplier_read` · **`step13_siipdi_flagged`** · `step14_wizard_field1` · **`step15_locate_glow`** · `step16_twospots` · `step17_acct_spots` · `step18_ironclad0026` · **`step19_approve_armed`** · `step20_split` — all in `C:\Users\cmccu\.claude\jobs\3ab7c2e3\tmp\chris-sandbox\`.
