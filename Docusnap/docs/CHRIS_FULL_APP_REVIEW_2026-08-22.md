# Chris The Customer — full app review, 2026-08-22

---

## ROUND 13 — 2026-08-22 overnight: vets the "teach 1 → import N → it files itself" arc (Slices 0/1/3 + copy items, all ON)

**Sandbox conditions:** fresh install (0 users → create-admin), CDP 9223, isolated userData, copied Demo
Docs corpus, Output to the sandbox folder. Migrations 1–79 on a fresh DB; then `TESTING/_measure/flip_arc.js`
flipped ON: `scope_sweep_enabled`, `scope_sweep_auto_accept`, `letterhead_fragment_abstain`,
`quiet_reread_enabled`, `learning_exclude_machine_confirms`, `autofile_gate_unify`, `letterhead_issuer`,
`letterhead_prefill`, `ref_class_fix_enabled` (threshold 90 from mig 71). Driven by the general-purpose
Chris persona (typed-locate teaching, imports via the app's own process call). Screenshots step01–46 in the
session scratchpad `chris-driver/`. Report is VERBATIM.

I have what I need. Final tally: 43 documents filed on disk across five sender folders, every one under the right company; queue 200 → 176. Here is my report.

---

# Chris The Customer — Round 13 (sandbox CDP 9223, fresh install, 2026-08-21/22)

**Route used:** Playwright over CDP; native pickers substituted by setting the same variable the picker sets (output folder → sandbox `Output`; source folder → `Other\IMPORT`, then Copperfield folders) and pressing the app's own buttons. Teaching done by the **typed route** ("Or type it instead" → the wizard found the spot → "Yes — teach this spot"), not drawn boxes. Every finding that mattered was checked against the app's records (`getReviewQueue`, `getRecentAutoFiled`, `getDocumentWithExtractions`) and the Output folder on disk.

## TL;DR
1. **The new machinery works and is honest** — the DONE card (19 waiting, "Check them in Review"), the quiet re-read line (appears ~11 s, pauses for a foreground Reprocess, never touched the document I had open), "filed by itself" + Put back, and the File All Ready dialog all did exactly what they said.
2. **But the promise "confirm 2 more and the rest file themselves" came true for ONE sender in four.** Pelican: yes (10 filed by itself, twice). Harrowgate (4 confirms), Veltrix (teach + 2 confirms), Copperfield: the group badge turned to "✓ files by itself" and then **nothing moved** — the siblings sit on "please confirm it's the sender" / "Company inferred" at 60–74%. The owner's "REMEMBER to press Reprocess this supplier, then File All Ready" is still the real path for 3 of 4 senders.
3. One self-filed Pelican invoice carries a wrong reference (P1 for PI) — right company, right date, one glyph wrong, no flag.

## Walkthrough
- **A. First contact** (step01–08): admin account → recovery code (Continue held until ticked — good) → Terms (still banner'd "WORKING DRAFT — NOT YET IN FORCE") → 6-step setup; "Everything stays on this computer" and "originals are never deleted" are reassuring; output folder suggested is `Documents\Scan Finder` (I pointed it at the sandbox). Tour copy is plain. Import screen is one box and one button.
- **B. Import 200** (step09–13): 2.5 min. Home table: 57 "—", 4 Ironclad statements as company **"ITH-0093"** (a reference number), one Meadowvale as **"Dairy Wholesale"**, 20 Quillstone POs as **"Bramblewood Joinery Ltd"** (the buyer). Silverbeck/Castellan arrive with the issuer **empty** (no "Cleaning"/"Security" — change 4 holds on arrival). Review: all 200 held (144 flagged, 21 no type, 35 missing a required detail); File All Ready correctly toasts "Nothing is ready to file yet".
- **C. Import-then-teach** (step14–30): opened a Pelican invoice — date and number "Not found" though plainly printed; the big card "Teach this document — We recognise this sender but haven't learned this layout yet" is the right nudge, but clicking it first raises a native dialog about "template"/"Template Manager". Teach = 3 fields, ~9 clicks. DONE card exactly as promised (step20). Quiet line at 11–12 s, 19 docs in ~45 s. Confirmed 2 by hand → **"✓ 10 documents from Pelican Office Interiors filed by itself after your confirms"** (step28); all 10 Pelican, all in `Pelican-Office-Interiors\` (disk-checked). **Put back** returned all 10 to the queue, copies stayed on disk; confirming one more re-filed them in place (14 PDFs, no duplicates). The other 6 Pelican each held on the honest "could read P1 or PI" question with a one-click fix; fixing one did not ripple to the other five.
- **Silverbeck ripple** (step22–25): typed the real name; **Enter did nothing**, clicking away produced "19 more unfiled documents look like the same sender. [Apply … to 19 & re-read] [Not now]". Apply kept my value and named all 20. Date/number stayed empty (no layout taught) — and no "Teach this document" card on this doc.
- **D. Teach-then-import Copperfield** (step31–39): taught 1 → imported 19 → **9 "Filed (auto)" on import**, 10 held: 8 "Needs: Invoice Number" on visibly skewed scans (Straighten + Reprocess read nothing; typed it), 2 on earned flags ("taught date box read 7/17/2076", "NV-41507 … box edge cuts through the value"). All 11 Copperfield files on disk look right.
- **Harrowgate / Veltrix** (step43–46): the failure case — see cards 1–2. File All Ready then filed exactly 9 of the 9 it promised.
- **E. Scary buttons** — truth-table below. Search "5193" found the invoice instantly (step42).

## NEW finding cards (ranked by harm)

**1. "✓ files by itself" badge appears, then nothing files — for 3 of 4 senders**
- Citation: queue head *"Harrowgate Timber Supplies 17 documents · 17 need a look ✓ files by itself"*; each doc *"DOCUMENT ISSUER Check · 66%"* with *"Recognised by: Not seen before"* — after I had confirmed **four** Harrowgate orders. Veltrix after teach + 2 confirms: 17 × *"Company inferred from one previously filed document — please confirm before filing."*
- User-moment: I did what the DONE card told me ("Confirm 2 more… the rest will file themselves") and waited.
- Observed: Count dropped only by my own confirms. "Reprocess 17 from Harrowgate" then cleaned 14 (95%, no flags) but filed none; File All Ready was the third press. Veltrix needed teach → 2 confirms → Reprocess sender → File All Ready to move 9. That is exactly the "remember to press" chain the owner fears, with a badge saying the opposite.
- Harm: trust-eroded / slowed — blocked for a timid user. Class: CONFUSION.
- Direction: the sweep that runs after a confirm should also run after "Reprocess this sender" finishes (the docs it just cleaned are the ones it should file); and a sender with N human confirms of the same issuer shouldn't still read "Not seen before". Do not show "✓ files by itself" until a sweep has actually filed something for that sender.
- Missing: the "Company inferred"/"please confirm the sender" note is round-10's open card #3; I may be re-measuring it rather than a regression.

**2. A wrong reference filed by itself (one glyph), unflagged**
- Citation: `Pelican-Office_invoice_0016.pdf` self-filed as `Invoice.16-01-2026.P1261150.pdf` (record: `reference_number "P1/26/1150"`, 93%, `review_flag_count 0`, `confirmed_via scope_sweep`); the page's own footer text reads *"Please quote PI/26/1150"*.
- Harm: trust-eroded — right company/date, wrong reference; the 6 siblings with the same doubt WERE held with "could read P1 or PI", this one was not. Class: QUESTION.
- Direction: when the footer/remittance line disagrees with the header read by a confusable glyph, hold it like the others.
- Missing: cosmetic in the filename, but a searcher typing "PI/26/1150" won't find it.

**3. Enter doesn't offer the ripple; only clicking away does**
- Citation: after typing *Silverbeck Cleaning Supplies* + Enter — no bar; after clicking the page — *"19 more unfiled documents look like the same sender. Apply "Silverbeck Cleaning Supplies" to 19 & re-read · Not now"*.
- Observed: the bar is small monospace text with a tiny "Not now"; the blue note above still said *"The Document Issuer box is still empty"* after I'd filled it; after Apply the amber box called my typed name a *"formatting check"*.
- Harm: slowed. Class: CONFUSION. Direction: fire on Enter too; refresh the note; label it "Sender set by you".
- Missing: a mouse user who clicks away would see it.

**4. Review keeps showing a document the teach wizard just filed, with a live Confirm button**
- Citation: Review header `CopperfieldElectrical_invoice_01.pdf` · *"Recognised by: Not seen before"* · green *"✓ Confirm & File"* — the record was already `status: confirmed` (step37).
- Harm: "where's my paper?" — the screen says un-filed, the wizard said filed. Class: CONFUSION. Direction: when a teach files the open doc, Review should move on (as it does after its own Confirm).
- Missing: pressing Confirm again would probably just re-file in place.

**5. Teach first-click dialog talks about templates**
- Citation: *"Teach this as a NEW document? We don't have a template for this layout. If you have taught a similar document before, click Cancel and update that one in Template Manager instead, so we don't create a duplicate."*
- User-moment: my very first teach, on the app's own recommendation. Harm: fear at the door; "Template Manager" is nowhere in my vocabulary. Class: CONFUSION.
- Direction: on a sender with no taught layout, skip the dialog; otherwise: "You haven't taught this sender before — carry on. (If you think you have, press Cancel and check Settings → Templates.)"
- Missing: the guard is there to stop duplicates on a recognised sender.

**6. Copy that points the wrong way**
- *"Nothing was flagged — this was read at 61%… If documents like this are consistently right, lower the auto-file bar in Settings → Processing"* — on a doc whose Invoice Number is **missing**; lowering the bar can't file it. *"format differs from the usual — please verify"* on the first-ever Copperfield document (no "usual" exists). *"Needs a quick check — 2 fields were flagged by a formatting check"* when one is just "confirm it's the sender". Also *"Reprocess 17 from Pelican"* when 7 remained.
- Harm: trust-eroded (warning fatigue). Class: PREFERENCE. Direction: don't mention the bar when a required field is empty; suppress "usual" notes before any history exists; refresh the Reprocess count after a sweep.

**7. Reprocess warnings never say "this doesn't file anything"**
- Citation: *"Re-read all 195 documents (all in queue) from their pages? Values the documents re-read may replace what's shown now, and this can take a while…"*
- User-moment: exactly the owner's scenario — a user hoping the pile will vanish. Observed: it took ~2 s for 17, and the pile did not vanish. Class: QUESTION.
- Direction: add one sentence: "Re-reading updates the details; it doesn't file anything — ready documents still need Confirm or File All Ready."

**8. Senders arrive as fragments/references on a clean install**
- Citation: queue groups *"ITH-0093 4 documents · 3 more to file by itself"*, *"Dairy Wholesale 1 document"*, *"Bramblewood Joinery Ltd 20 documents"* (the Quillstone POs).
- Harm: the badge offers to let a reference number "file by itself". Class: CONFUSION. Direction: a value that matches the reference pattern shouldn't be offered as a sender; buyer-issued POs remain the known class.
- Missing: known classes from earlier rounds; recorded here because a first-timer sees them in the first minute.

## Re-verify of tonight's 5 changes
1. **Sender files itself after confirms — BETTER-BUT.** Pelican: FIXED (10 filed by itself, all same sender, right folder, Put back works, re-sweep on next confirm works). Harrowgate/Veltrix/Copperfield: badge flips to "✓ files by itself" but nothing files (card 1). One self-filed value wrong by a glyph (card 2).
2. **Quiet re-read after teach — FIXED.** Line at ~11 s, "k of N done", 19 docs ≈ 45–70 s; Review fully usable (opened, typed, confirmed a Silverbeck doc mid-run — it's on disk); a foreground Reprocess showed "paused while you work — resumes on its own" and resumed in 2 s; the open document never changed; "Read differently after learning — was '26-01-6000', now '05-01-2026'" appeared and was honest.
3. **DONE card — FIXED.** Exact text with "19 from Pelican… waiting" and "Check them in Review" (opened Review on a re-read Pelican doc). Adapts when nothing waits ("I'll recognise Copperfield Electrical from now on…"). Caveat: the queue head said "3 more" while the card/panel said "2 more" until my first confirm; and the promise itself only came true for Pelican.
4. **No "Cleaning"/"Security" — FIXED on arrival** (all 40 empty). Ripple: **BETTER-BUT** — appears on click-away, not Enter; Apply works and keeps the typed value. "Dairy Wholesale" fragment still arrives for one Meadowvale.
5. **File All Ready dialog — FIXED.** "File 9 ready documents (of 185 in the Review queue)? Not included… • 133 flagged • 21 with no document type yet • 22 missing a required detail" → filed exactly 9. Nit: the progress banner counts "Filing 85 of 185 · 75 skipped".

## Warnings truth-table
| Button | What it said | What it did | Verdict |
|---|---|---|---|
| Delete (🗑, single) | "Delete X? It goes to the app's recycle bin — you can restore it from Search." | Doc left queue; in Search → Recycle bin; Restore put it back in Review | TRUE |
| Empty bin | "Permanently delete all 1 document… including their PDF files? This cannot be undone." | Bin emptied; app's working copy gone; the original scan stayed in `IMPORT\Processed` | TRUE (original kept, as setup promised) |
| Delete All Review | "Delete ALL 195… They go to the app's recycle bin… Files on disk are kept." | Cancelled (read only) | Honest |
| Reprocess N from sender | "Re-read all 17… may replace what's shown… confirmed and filed are not touched." | Re-read, nothing filed, filed docs untouched | TRUE but silent on "doesn't file" |
| Reprocess all in queue | same wording, 195 | Cancelled | same |
| File All Ready | "File 9 ready… Not included: …" | Filed 9 | TRUE |
| Put back | tooltip "Return these to the Review queue — nothing is lost; the filed copies stay on disk" | 10 back, copies on disk | TRUE |
| Teach this document | "Teach this as a NEW document?… Template Manager" | Opened the wizard | True but jargon |

## The owner's question, plainly
For a scared first-timer, **the happy path is now genuinely short**: open a held invoice → the card tells you to teach → 3 fields, ~9 clicks → the card tells you what happens next → the others fill in by themselves while you keep working → confirm two → "10 filed by itself", with Put back. That's the first time I've felt carried rather than instructed. **But it only carried me once in four senders.** For Harrowgate, Veltrix and Copperfield I still had to: know to press "Reprocess this sender", notice that cleaned documents don't file, then press File All Ready — three things to REMEMBER, while the badge claimed "files by itself". Still to be remembered/pressed that shouldn't be: (a) Reprocess-sender after the confirms, (b) File All Ready after a reprocess, (c) the I/1 "Use PI" click per Pelican doc, (d) typing the number on skewed scans, (e) clicking away (not Enter) to get the ripple.

**What genuinely worked:** the quiet re-read and the "filed by itself… Put back" receipt — automation that shows its work and can be undone on the same screen. **Top friction:** the "please confirm it's the sender / Company inferred" hold that survives four human confirms. **Two-week verdict:** Yes, narrowly — zero documents landed in a wrong company folder across 43 filings and undo always worked; I'd keep it, but I'd be pressing Reprocess + File All Ready every morning and quietly wondering why the badge lies.

## Humility
One scripted persona, one sitting, clean PDFs from a known corpus, typed-locate teaching rather than drawn boxes (the owner's users may draw). My driver mis-stepped twice: it re-clicked a queue row after taking the "Use PI" offer, which reloaded the doc and dropped my fix (so `P1266000` on disk is my fault, not the app's), and a native "Teach this as a NEW document?" dialog appeared on screen mid-session that I can't attribute with certainty — I closed it via the OS; if a finding looked like the app's doing I checked the records and the disk, not just the pixels. The concurrency test is bounded by how fast the re-read is (19 docs in about a minute). Screenshots: `chris-driver\step01–46.png`.
