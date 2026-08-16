# Chris The Customer — Round 7 (2026-08-16, RERUN of the 2026-08-15 late re-run, on the six overnight fixes)

**Sandbox conditions:** fresh install (session scratchpad `chris-sandbox`, CDP 9223), HEAD at the six
overnight commits (`b477872`…`96d0875`): hold-siblings identical-rewrite fix, P prefix-adopt lane,
vacuous-witness suppression, migration 71 (fresh-install auto-file bar **90**), bin-changed broadcast,
copy fixes. TYPED-issuer wizard teach on all 10 suppliers per TEACH_ORDER; the two new experimental
switches (`ref_prefix_confusable_adopt`, `raw_witness_vacuous_suppress`) flipped ON between waves.
Report below VERBATIM from Chris.

---

**TL;DR (3 lines):**
1. **The headline bug is dead: 0 of 400 imports carried the "sender for this layout was changed" note** (was 200/200), File All Ready offered **184** and filed them all correctly, and wave-2 auto-filed **188/200 (94%)** vs ~55% last night — **zero wrong value, zero wrong folder across all 29 filings I eyeballed against the page.**
2. Both new switches demonstrably worked: every auto-filed Pelican reads **PI/** (15/20 wave-2 + 6 wave-1 rescued on reprocess), and the "compare the value with itself" question is gone.
3. The biggest remaining thief is a **false "'X' doesn't appear on this page as written" flag on values that are printed exactly** — it held ~7 correct docs tonight, including one where it cancelled the new switch's own win.

## Walkthrough
- Create-admin → recovery code → terms (Accept stayed dead until I ticked the box) → wizard (`step01-firstscreen.png`, `step02-wizard.png`). All clean; I left the suggested output folder and repointed it in Settings after (sandbox containment — noted below in humility).
- Skimmed the tour (`step03-tour.png`), taught all 10 suppliers with the wizard, typed issuer route. Zero locate failures, zero re-draws; the catalog added Statement/Credit Note/Quote/Delivery Note in one dialog. All 10 filed to the right Company/Year/Month.
- Wave 1: 200 imported (`step04-review-wave1.png`) — measurements below. File All Ready → 184 filed. 10-doc spot-check across all suppliers: all correct (`spotcheck1\*.png`).
- Drawn-box control: re-taught Veltrix with a DRAWN issuer box (`step05-teachdraw.png`). The box read back "**N**eltrix Automotive Parts" and the near-match guard caught it instantly — *"That is one character different from Veltrix Automotive Parts, which you already use on 18 documents. Two spellings file this sender into two folders."* — with a one-click `Use "Veltrix Automotive Parts"` fix. Excellent guard, excellent copy.
- Flipped the two new switches (both shipped OFF, both flipped cleanly; their descriptions are honest and plain).
- Wave 2: 200 fresh imported → 188 auto-filed. 11 renders eyeballed including 5 Pelicans (`spotcheck2\*.png`): all correct.
- Reprocessed the 27-doc queue → consent bar: *"8 reprocessed documents read clean and are ready to file — ✓ File 8 · Review them · Not now."* Filed 8; all 8 verified correct against print (`consent8_refs.png`), including PI/26/7656 — last night's "compare it with itself" case (`step06-afterfile8.png`).
- Recycle bin: deleted a held doc from Review with the bin view open in Search — **the bin repainted by itself in 0.5s**; Restore all returned it to the queue with fields intact.

## Comparison table vs last night

| Measure | Last night | Tonight |
|---|---|---|
| "Sender was changed" notes | **200/200** | **0/400** (both waves; survives a drawn-box re-teach too) |
| File All Ready offer | **0** | **184 of 200** (filed 184, 16 flagged stayed) |
| Wave-1 auto-file on import | 0/200 (bar 100) | **0/200** — bar is 90 now, but brand-new senders aren't trusted yet, so wave 1 still files nothing on import (the File-All click is the wave-1 payoff; the bar shows up in wave 2) |
| Wave-2 auto-file | ~55% | **188/200 = 94%** |
| Pelican I/1 correctness | ~55% correct, misreads filed with warnings | **100% of filed Pelicans read PI/** (15/20 wave-2 auto-filed + 6 wave-1 rescued by reprocess; 8 held, none misfiled) |
| Recycle bin staleness | stale until clicked | **self-repaints in 0.5s** |
| Wrong value / wrong folder among filed | — | **0 of 29 eyeballed** (10 wave-1, 11 wave-2, 8 consent-filed) |

## NEW finding cards (ranked by harm)

**1. The app flags its own correct reading as "not on this page" — and holds the document**
- **Citation (verbatim):** Review, Sales Order Number on Veltrix-Automotive_sales_order_0022: *"'VXS22033' doesn't appear on this page as written — please check the reference before filing."* Same note on Silverbeck 0023/0037/0040/0044 and Pelican 0038.
- **User-moment:** clearing the "needs a look" pile after wave 2.
- **Observed confusion:** I open the page and **"Order No VXS22033" is printed exactly** — same for SB-ORD74238/24456/59173/74033 and PI/26/9910 (all verified against renders). The app is 95% confident AND says the value isn't on the page, in the same breath. On Pelican 0038 the new switch corrected P1→PI **rightly**, then this false check stole the very auto-file the fix earned.
- **Harm + severity:** slowed + trust-eroded — ~7 rightful auto-files stolen tonight; after two of these I'd stop believing the warning (which is dangerous, because the SAME sentence is also used when the value really is wrong, e.g. PL/26/3883).
- **Class:** CONFUSION.
- **Proposed alternative:** none to the wording — the sentence is fine when it's true. The checker itself needs the owner's eye. If the check can't be made reliable for hyphen/slash references, it shouldn't fire at 95-confidence template reads.
- **What I may be missing:** the checker may be reading a different rendering (rotation/contrast) than I am; I only verified against clean renders of the same page.

**2. Documents I explicitly approved are counted as "filed automatically"**
- **Citation (verbatim):** Review banner after clicking ✓ File 8: *"✓ 196 documents filed automatically — click to see the list — they stay filed; nothing is changed."* (188 before my click, 196 after.)
- **User-moment:** I pressed "File 8" on the consent bar, then read the banner.
- **Observed confusion:** the 8 were MY decision; the counter says the machine did it. If my boss asks "did you check these?", the app's own record says "automatic".
- **Harm + severity:** trust-eroded, cosmetic mechanics.
- **Class:** QUESTION (is a separate "you approved" toast shown and I missed it? My capture window may have been too slow — but the persistent counter is what a returning user reads.)
- **Proposed alternative:** count them separately: *"188 filed automatically · 8 filed with your approval."*
- **What I may be missing:** the momentary toast may already say "you approved" (the fix I was asked to verify); I could not capture it before it expired.

**3. Credit-note minus signs: a right total held by a sign-blind double-check, and a "$540" VAT from nowhere**
- **Citation (verbatim):** Meadowvale-Dairy_credit_note_0050 (overall 100, held), total note: *"the total -514.30 was read the same way by two independent methods; the page's net/subtotal reading 428.58 disagrees with it — please check"* — while the page prints **£-428.58**; and the VAT field shows **"$540"** where the page prints **£-85.72**.
- **User-moment:** checking why a 100%-confidence document was still in the queue.
- **Observed confusion:** the "disagreement" is the app's own second reader dropping the minus; and I can't tell where "$540" came from — wrong currency AND wrong amount, sitting quietly in a side field that would go into my records on confirm.
- **Harm + severity:** slowed (false hold) + a genuinely wrong value one click from being filed metadata; trust-eroded.
- **Class:** CONFUSION.
- **Proposed alternative:** the second reader should keep the minus on credit notes before claiming a disagreement; and a side-field value in a currency the document never uses deserves its own flag, not silence.
- **What I may be missing:** VAT/subtotal may be optional info fields the filing never uses; I didn't confirm the doc to see what lands in the XML.

**4. Two visually clean quotes couldn't be recognised at all on import — and after reprocess their plainly-printed reference is simply missing**
- **Citation (verbatim):** queue rows "Sender not identified · 2 documents" (Nordwind 0026/0030, conf 31), note *"Never seen this sender before…"*; after reprocess the sender resolves (85) but the Quotation Ref field (**NRQ-3901**, printed clean and large) is absent from the fields list — doc held at 61 with nothing telling me it's the ref that's missing except the "Needs:" chip.
- **User-moment:** wondering why 2 of 20 Nordwind quotes failed when 18 sailed through.
- **Harm + severity:** slowed; 2/400 docs — small but these two need full manual attention.
- **Class:** QUESTION (what's different about these two scans?).
- **Proposed alternative:** none from me — flagging the pattern for the owner.
- **What I may be missing:** the pages may be lower-contrast scans than they render for me; 2/400 may simply be the honest residue.

**5. "…differs from the filed value" on a document that isn't filed yet**
- **Citation (verbatim):** Pelican-Office_invoice_0015: *"A wider reading of this box shows 'PI/26/2361', which differs from the filed value — please verify."*
- **User-moment:** copy read-aloud on a held doc (the note is otherwise a big improvement — it now shows two DIFFERENT values; last night it showed the same value twice).
- **Observed confusion:** "the filed value"? Nothing is filed — the doc is in Review. I'd wonder if some other copy already went into a folder.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** *"…which differs from the value shown here — please check which is printed."*
- **What I may be missing:** "filed value" may be an internal term for the field's current value.

**6. The teach done-screen calls every teach "the first example"**
- **Citation (verbatim):** teach wizard done screen after re-teaching Veltrix (18 documents already filed for that sender): *"This was the first example."*
- **Harm + severity:** cosmetic. **Class:** PREFERENCE.
- **Proposed alternative:** *"Teaching saved."* when the sender already has filed documents.
- **What I may be missing:** re-teaching may genuinely reset that layout's example count.

**7. Two different answers to "where's my original scan?"**
- **Citation (verbatim):** onboarding: *"Your original scans are never deleted — they're just moved into a 'Processed' folder."* After tonight: auto-filed documents' originals stay in `…\Processed`; documents filed by me (teach commits, File All, File 8) leave `Processed` — the filed copy in the output tree IS the moved original.
- **Harm + severity:** cosmetic today (nothing lost — I checked the full ledger: 410 in, 391 filed, 19 in review, 0 missing).
- **Class:** QUESTION — is the asymmetry deliberate?
- **What I may be missing:** a deliberate rule like "manual confirmation = adopt the original into the archive" that just isn't written anywhere I saw.

*(No 8th card — the P1L/26/3152 hold is the new switch correctly refusing two-character damage; that's the system working, not a finding.)*

## Previously-reported items — verify lines
- Sender-confirm note on every import (200/200) → **FIXED** (0/400; typed teach, drawn re-teach, and reprocess all clean).
- File All Ready offers 0 → **FIXED** (offered 184 of 200, dialog explains the 16 exclusions, filed exactly 184).
- Out-of-box bar 100 files nothing → **BETTER-BUT**: bar ships at 90, but a fresh install's wave-1 import still files 0 (senders not yet trusted) — the first-session payoff is now the one-click File All rather than silent import filing. Wave 2 is where 90 pays: 94%.
- Pelican I→1 (⊕ can't fix an OCR misread) → **FIXED in effect**: the new switch corrects P1/PL→PI when the page carries it; 100% of filed Pelicans are PI-correct; misreads it can't prove stay held, none misfiled.
- The "auto-corrected … check which is printed" same-value-twice note → **FIXED** (notes now show two different values; small "filed value" wording nit = card 5).
- Oakhaven slash-drop (19/20 cosmetic flags) → **STAYS FIXED** (OED/… reads keep the slash; zero Oakhaven flags in 40 docs; filename is windows-safed only).
- Stale recycle-bin view → **FIXED** (0.5s self-repaint; delete→restore round trip intact, fields preserved).
- Reprocess consent toast "you approved" → **UNVERIFIED** (toast expired before I caught it) and the persistent counter still says "filed automatically" for approved docs — card 2.
- Buyer-issued Quillstone PO → containment **HELD** (40 POs filed under Quillstone, no Bramblewood folder ever created).

## Warnings truth-table (every scary dialog I pressed)

| Dialog (verbatim core) | Pressed | What actually happened | Honest? |
|---|---|---|---|
| "File up to 184 of 200 documents…16 flagged documents are not included" | OK | exactly 184 filed, 16 stayed | ✓ |
| "Re-read all 27 documents…Values the documents re-read may replace what's shown now" | OK | 27 re-read; values changed only where re-reads differed | ✓ |
| "8 reprocessed documents read clean and are ready to file — ✓ File 8" | File 8 | 8 filed, all correct | ✓ (credit wording: card 2) |
| "Delete 'Pelican-Office_invoice_0047.pdf'? It goes to the app's recycle bin — you can restore it from Search." | OK | went to bin, restorable | ✓ |
| "Restore all 1 document…They go back to where they were deleted from" | OK | returned to Review, fields intact | ✓ |
| Teach: "⚠ one character different from Veltrix Automotive Parts…Two spellings file this sender into two folders" | Use "Veltrix…" | known spelling adopted, drawn spot kept | ✓ — the best guard copy in the app |

## Close-out
- **What genuinely worked:** the teach wizard end-to-end — ten suppliers, five doc types (four added from the catalog in one dialog, one built custom), typed-locate found every value first try, auto-detected the right labels, and the near-match issuer guard turned my one genuine misread into a one-click fix. That plus 94% wave-2 auto-file with a perfect eyeball record is the product working as promised.
- **Top friction:** the false "doesn't appear on this page as written" flag (card 1). It's now the single most common reason a correct document sits in my queue, and it spends the credibility the other warnings have earned.
- **Two-week verdict:** **Yes.** Day one costs me a teach session and one File-All click; by the second batch 9 in 10 documents file themselves into the right folders, and everything it held back tonight was either genuinely wrong or wrongly flagged — never wrongly filed.

## Humility block
- **ACCEPTANCE GATE: PASS — zero wrong value / wrong folder among filed documents.** 29 filings verified by eye against the page (10 wave-1, 11 wave-2 auto-filed, 8 consent-filed); every other filing checked only by filename/prefix pattern (e.g. all 15 wave-2 Pelicans are PI/) — I did not eyeball all 391.
- I drove the app through scripts, not a mouse; a real hand may hit ordering/focus quirks I masked (my own scripts misfired twice and the app was innocent both times).
- The output folder was set via the app's settings store after the wizard (my driver can't operate the native folder picker); a real customer's Browse flow is untested tonight.
- The "you approved" toast may exist and simply out-lived my capture — card 2 is about the persistent counter, not proof the toast is wrong.
- The demo corpus is synthetic and friendly (born-digital teach docs, consistent layouts); real-world scans will be uglier than anything tonight measured.

---

## Main-session triage (2026-08-16, same night)
- Cards 1+3 → root-caused at source the same night (page-pass confusable/split evidence; shadow-mint
  sign loss + vat-reg `$` self-disarm) → gary designs → Oracle vet → round-2 fixes (see handover).
- Card 2 → implemented same night (approved-vs-automatic split in `recent_auto_filed` + banner copy).
- Cards 5+6 → implemented same night (pad-window note copy; teach done-screen copy).
- Cards 4+7 → owner vet queue (2/400 residue investigation; Processed-folder asymmetry ruling).
