# Chris The Customer — Full App Review — 2026-08-15

**Round conditions:** fresh sandbox instance (CDP 9223, session-mortal), seeded fresh DB with the
2026-08-15 corroboration auto-file switches (all 7) flipped ON. Corpus = `TESTING\SINGLE` (10 taught) +
`TESTING\IMPORT` (200) + `TESTING\IMPORT2` (200), driven per `TEACH_ORDER.md`. Chris drove the app over
CDP with coordinate-based box drawing. **A fresh install has no confirmed history, so the corroboration
arms are largely inert here — this round measures the teach/import UX, the base auto-file rate, and
detection issues; the fix itself is proven on the mature live corpus (see `HANDOVER_2026-08-15.md`).**
Nothing from this round is implemented without the owner's explicit go.

---

# Chris The Customer — Full-Cycle Vet Report (sandbox, CDP 9223)

I ran the complete teach → import → review loop as a non-technical owner. Everything below is from the running sandbox; nothing here changes code. **All 10 `_0011` documents were taught (exclude them from GT scoring).** Screenshots are in the scratchpad (`step01`–`step39`).

## 1. First contact & teach walkthrough

**Onboarding is genuinely good.** Create-admin → forced recovery-code save (step03, greyed "Continue" until acknowledged) → Terms → 7-step wizard → 6-card tour → optional **practice run**. Copy is plain and reassuring ("Everything stays on this computer", "Your original scans are never deleted"). The practice run (step08/09) is excellent: side-by-side *document vs what Scan Finder read*, per-field confidence, and a live draw-a-box teach with helps-the-user copy ("The reader mistook a zero for the letter 'O'. Draw a box around the number…").

**Teach wizard — I taught all 10 scopes** (Castellan service-worksheet [new type created], Harrowgate SO, Pelican invoice, Quillstone PO, Silverbeck SO, Veltrix SO, Meadowvale credit-note, Oakhaven delivery-note, Nordwind quote, Ironclad statement). It works well: draw value → live read-back → auto-detected label → accept, with a Left/Above label toggle, a "This isn't on this document" path (+ "usually missing / never — stop looking"), and a clean summary. Notable moments:
- **Read-back caught my own bad draws** (a mis-aimed Reference box read "Unit Sawpit"; redraw fixed it) — the safety net works.
- **Typed-value locate is impressive**: for Ironclad (no company name in the header, only a logo) I typed "Ironclad Tool Hire" and it *found it in the tiny footer* and offered to teach that spot (step31).
- **Label auto-detect is mostly right** but once picked "SERVICE" (the title word above) instead of "DATE" for Castellan's date; and captured "JOB SHEET NO CJ" (2 chars of the value bled into the label).
- Date validation warned correctly on "| 24-05-2025" (caught a table cell-divider).
- Copy nit: teach summary renders "**Total**won't be looked for" with no space.

## 2. Success-rate numbers I measured

**Wave 1 — IMPORT (200), default settings, confirmed nothing:**
- **0 of 200 auto-filed. All 200 landed in Review.**
- **Dominant hold reason (≈154 of 200):** *correct reads held only by the bar.* The Review screen says it plainly: **"Nothing was flagged — this was read at 93%, below the 100% you've set for filing without a check… Read at 93% · your setting 100%."** `auto_file_threshold` is unset → **defaults to 100%**, and taught reads land at **87–95%**, so nothing clears it. Confidence spread of held docs: 90–94% = 23, 80–89% = 110, <80% = 4.
- **≈46 of 200 genuinely flagged** ("needs a look"): Pelican 20/20, Oakhaven 19/20, Veltrix 2, Nordwind 2 (unidentified), Castellan/Ironclad/Silverbeck 1 each.
- **"File All Ready" then filed 154/200 in one click** — its gate is *type + required fields + not-flagged*, NOT the 100% bar (dialog: "File up to 155 of 200… 45 flagged documents are not included"). So the realistic one-click-file rate after teaching is ~77%.

**Wave 2 — IMPORT2 (200), after wave-1 teach + File-All-Ready graduated the suppliers** *(188/200 done at report time; final ≈ same):*
- **≈103 of 188 auto-filed (~55%)**, no confirmation needed — a large jump from wave-1's 0%. The 8 "clean" suppliers now auto-file; **Pelican and Oakhaven never auto-file** (every doc trips a formatting flag). Auto-filed docs went to the **correct** folders/names (spot-checked; only the 10 expected supplier folders exist — no misfiling).
- Takeaway: **the system does get better with use** — but only *after* the user manually files a first batch (which graduates suppliers). Out of the box it files nothing.

## 3. Detection-issues log (highest-value section)

| Doc(s) | Supplier / type | Read vs printed | On-screen note |
|---|---|---|---|
| **All 20 Pelican invoices** (e.g. 0024, 0025) | Pelican / Invoice | invoice_number read **"P1263130" / "P1269923"** — printed **"PI/26/3130" / "PI/26/9923"** (serif **I→1** + slashes dropped) | "A wider reading of this box shows 'PI/26/3130', which differs from the filed value — please verify." |
| **~19/20 Oakhaven delivery notes** (0023, 0028…) | Oakhaven / Delivery Note | delivery_number **slash dropped**: "OED/89515" → **"OED89515"**, "OED/…" → "OED26662" (docs where the slash survives, e.g. "OED/65057", are NOT flagged) | "'OED89515' doesn't appear on this page as written — please check the reference before filing." |
| **All Pelican** | Pelican | supplier_name = **"Pelican Office Interiors."** — trailing **period** (not printed). Folder is sanitised to "Pelican-Office-Interiors" but the DB scope value carries the dot | (no flag — silent) |
| **Nordwind quote 0026 & 0030** | Nordwind / Quote | **supplier not identified** (null, conf 31) — template missed these 2; date/subtotal read fine | "Never seen this sender before. The top of the page reads 'Nordwind Refrigeration Ltd' — please confirm the correct company…" |
| **Silverbeck 0023** | Silverbeck / Sales Order | **Sales Order Number missing entirely** (only 3 of 4 fields read; conf 57) | (field absent) |
| **Castellan 0014** | Castellan / Service Worksheet | reference read **"3-8592"** (should be CJB-nnnn) | "'3-8592' doesn't appear on this page as written — please check the reference before filing." |
| **Veltrix ~2 docs (0025)** | Veltrix / Sales Order | sales_order_number "VXS33215" flagged even though it appears correct on-page — likely a **false-positive** formatting flag | "'VXS33215' doesn't appear on this page as written…" |

**Phase-2 note:** I opened the ⊕ "Teach this field" on a Pelican invoice number and drew over "PI/26/9923" — it read back **"P1/26/9923"** (slashes recovered, but **I→1 persists**). Re-teaching the same spot re-reads the same pixels, so **⊕ cannot fix an OCR character misread** — the real fix is to type the value into the field. I **cancelled** it (committing it would poison the scope with a wrong value), so **no plus-teach was committed** and wave-2 reflects wizard teaching only.

## 4. New finding cards (ranked by harm)

1. **Auto-file bar defaults to 100% → nothing auto-files out of the box** (CONFUSION, high). *Moment:* imported 200 after teaching all 10 suppliers; expected the confident ones to file themselves. *Observed:* 0/200 filed; every 87–95% correct read sits in Review. *Alt:* default the bar to ~90 (or prompt "Everything read well — file documents above 90% automatically?" after the first batch). The app already hints "lower the auto-file bar in Settings → Processing," but a new user won't find it. *Missing:* graduation eventually lowers the effective floor — but only after the user hand-files a batch first.
2. **Buyer-issued PO: "Document Issuer" points at the wrong company** (CONFUSION, high). *Moment:* teaching the Quillstone PO — the letterhead is **Bramblewood (my own company)**; the supplier I want to file under is **Quillstone** in a "SUPPLIER" block. *Observed:* the wizard says "draw the company name… how the sender will be filed," which aims a naïve user at their own letterhead → every PO filed under themselves. *Alt:* on a purchase-order layout, prompt "This looks like a PO you issued — file it under the **supplier** (Quillstone), not the letterhead?"
3. **Pelican invoice numbers systematically wrong (I→1), and ⊕ can't fix it** (trust-eroded, med). *Alt:* apply the "wider reading" the app already computes (it *knows* the value is "PI/26/3130") as an auto-correction, not just a warning.
4. **Oakhaven slash-drop flags 19/20 for a cosmetic difference** (trust-eroded/warning-fatigue, med). Nearly every Oakhaven doc is held over a missing "/". *Alt:* treat a separator-only difference as low-severity (auto-restore the slash from the page text) rather than a full review flag.
5. **Stale recycle-bin view** (CONFUSION, med). *Moment:* deleted 45 docs from Review with the Search window open on the Recycle bin tab; the bin still read **"The recycle bin is empty"** until I reloaded (the 45 were there after reload). *Alt:* refresh the bin on tab focus / on any delete event.
6. **Trailing period on Pelican issuer** ("Pelican Office Interiors.") (trust-eroded, low-med). Silent; risks a duplicate-sender/inconsistent-scope situation even though the folder name is sanitised.
7. **5 of 10 real types aren't built-in** (slowed, low). Only Invoice/Sales Order/Purchase Order ship; statement, credit-note, quote, delivery-note, worksheet all need "Add from catalog" or a build-your-own form. The catalog is good, but a first-timer meets it mid-teach.
8. **Sporadic single-doc misses** (QUESTION, low): 2 Nordwind quotes unidentified, 1 Silverbeck SON unread, 1 Castellan ref wrong — the app flags/holds all of them (safe), but they show the taught template isn't 100% robust to layout jitter.

## 5. Smoother-experience suggestions
- After the first successful batch, offer a one-click **"These all read well — turn on auto-filing above 90%?"** so teaching actually pays off without a Settings hunt.
- Auto-adopt the app's own **"wider reading"** for separator/character misreads (Pelican I→1, Oakhaven slash) instead of only warning.
- Detect **buyer-issued documents** and steer "Document Issuer" to the supplier block.
- Refresh the **recycle bin** on focus; add a "Show newest first" that reflects just-deleted items.
- Add a space in "Total won't be looked for."

## 6. Warnings truth-table · what worked · verdict

**Every destructive/automatic action told the truth:**
- File All Ready → "up to 155 of 200 … 45 flagged not included" → filed 154. ✅
- Single delete → "goes to the recycle bin — restore from Search." ✅
- Restore (1 and all 45) → "go back to where they were deleted from"; docs returned **with fields/page intact** (round-5 page-less-restore concern looks resolved). ✅
- Empty bin → "Permanently delete … **including their PDF files**? This cannot be undone." (round-4 "doesn't delete PDFs" concern looks resolved). ✅
- Delete All Review → "ALL 45 … recycle bin … **Files on disk are kept. Confirmed and deferred documents are NOT affected.**" ✅
- Reprocess → ran (value unchanged, cached page). ✅
- Split PDF → "This document is only one page — there's nothing to split." ✅
- **One bug:** the **recycle-bin view went stale** (finding #5) — the only case where a screen told me the wrong thing.

**One thing that genuinely worked:** the Review screen's transparency — "Recognised by: its logo and wording / taught positions / 3 taught fields", per-field confidence, and *"Read at 93% · your setting 100%"*. It always told me exactly why a document was waiting. And the teach read-back catching my own mis-draws.

**Top friction:** teaching everything perfectly and still having **0 of 200 file themselves** because the bar defaults to 100%. The capability is clearly there (wave-2 hit ~55% once suppliers graduated) — the default just hides it.

**Would I keep using it after two weeks? Yes** — the teach flow is genuinely pleasant, filing is tidy and correct, and it visibly gets better with use. But with a **condition**: out of the box it reviews everything, so I'd churn unless someone told me to lower the auto-file bar. Fix the default (or prompt for it) and the "yes" is unconditional.

**What I may be missing:** I drove the app via CDP with coordinate-based box-drawing, so my teach boxes may be marginally looser than a careful human's (I verified every read-back, but a few labels over-captured). The 100% default may be a deliberate safety choice for brand-new installs; graduation is *meant* to relax it — my wave-2 result supports that, but it only kicks in after a manual first batch. GT accuracy scoring is yours to run; I measured *observable* auto-file/hold behaviour and the on-screen reads, not per-field correctness against ground truth. Wave 2 was at 188/200 when I wrote this.

**Sandbox state:** wave-1 = 154 filed via File All Ready + 46 restored-then-held; wave-2 ≈103 auto-filed + rest in Review. Windows left open (Main, Review, Search) on CDP 9223. Taught docs = the ten `_0011` files listed in §1.
