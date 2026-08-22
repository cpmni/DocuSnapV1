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

---

## ROUND 13b — 2026-08-22 ~01:00: the RE-RUN on the fix build (`bff8f5b`), same sandbox DB

**Sandbox conditions:** the round-13 sandbox restarted on the fix build (same userData/DB, so the
account, queue, taught/confirmed senders and Output survived); `role_field_dominant_class` flipped ON in
addition to the round-13 switches. Driven by a fresh general-purpose Chris persona given his own round-13
report to read first. Screenshots step47–69 in the session scratchpad `chris-driver/`. Report is VERBATIM.

I have what I need. Queue 176 → 132 this sitting; Output folder 43 → 87 PDFs, every new file checked against its printed page. Here is my report.

---

# Chris The Customer — Round 13b (fix-build re-run, same sandbox DB, CDP 9223, 2026-08-22 00:58–01:35)

**Route:** signed back in as `chris`; same Playwright-over-CDP driver and typed-locate teaching as round 13. Every claim below was checked against the app's own records (`getReviewQueue`, `getScopeReadiness`, `getRecentAutoFiled`, `getDocumentWithExtractions`) and the Output folder; for every newly filed PDF I rendered the page and read the order number and date off it myself and compared them to the filename (87/87 match, the one "?" being my own checker misreading a round-13 file). Screenshots `step47–69` in `chris-driver\`.

## Walkthrough
- **step47–48** Home/Review as I left them (176 waiting, 43 filed). The group badges had changed: Harrowgate now *"learned · needs a layout"* (it used to claim "✓ files by itself"); Veltrix and Pelican still "✓ files by itself" with 8 and 5 sitting there.
- **step49–50 Veltrix.** Opened 0029 (clean read, issuer "Check · 66%"), pressed Confirm once. **2 s later:** *"✓ 15 documents from 2 senders you've confirmed filed by itself after your confirms · Put back"*, queue 176→170, Veltrix 8→2. Disk: 5 new files via `scope_sweep` + mine, all under `Veltrix-Automotive-Parts\`, all matching the page. Of the 2 left: 0025 held on *"'VXS33215' doesn't appear on this page as written"* — the page prints "Order No VXS33215" plainly (safe hold, wrong reason); 0013 read identically to the five that filed and was simply left behind — a second Veltrix confirm didn't pick it up either; "Reprocess 1" then offered "File 1", which filed it correctly (`auto_reprocess`).
- **step51** Odd-reference probe: typed `VX$12345` over 0013's number + Enter. No warning, the badge beside it still said "High · 95%", and the record didn't change (typing isn't saved without Confirm) — so I couldn't manufacture an odd held document without confirming a wrong value, which I declined to do.
- **step52** The Reprocess warning now ends *"Re-reading updates the details; it doesn't file anything by itself — documents that come out ready still file through Confirm, File All Ready, or the sender's own auto-file once it's learned."*
- **step53–54 Harrowgate, the 5th confirm.** Before: badge "learned · needs a layout", readiness `confirms 4/5, hasTemplate false`. Confirm at 0.0 s → **1.1 s** badge "✓ files by itself", readiness `5/3, hasTemplate true, ready true` → **10.2 s** *"Quietly re-reading Harrowgate Timber Supplies documents you haven't opened, now that you've taught its layout — 0 of 14 done"* → **13.3 s** line gone → **14.3 s** *"✓ 29 documents from 3 senders… filed by itself"*, queue 167→153, Harrowgate 15→1. All 14 on disk, all correct (incl. the three that had been flagged at 75%). The badge never lied. Then a green panel appeared: *"14 Harrowgate Timber Supplies Sales Order documents already read cleanly and now pass every check — nothing was re-read. ✓ File up to 14"* — for documents that had just filed. Pressing it: *"✓ Filed 0 from Harrowgate Timber Supplies… Put back in Review"* + fourteen lines of *"kept back — it was handled in the meantime (…)"*.
- **step55 Reprocess as the single door.** Pressed the receipt's Put back (25 returned: Harrowgate 14, Pelican 6, Veltrix 5 — the receipt had said 29). Then "Reprocess 15 from Harrowgate": **2 s** → *"✓ 14 documents from Harrowgate… filed by itself"*, the bar offered only "File 1" (the document on screen). Correct, in place, no duplicates. A second bar offered "File up to 6" Pelican with *"1 other sender is also ready — file these first and the next offer follows"* → filed 6 correctly; the Veltrix offer never followed. "Reprocess 5 from Veltrix" on the put-back five: *"Completed 0 of 5"*, records untouched, nothing filed, nothing said; File All Ready then counted them as "flagged — waiting for you to check a value". Confirming one of them by hand filed the other 3 in 2 s, leaving the one on screen.
- **step56–57 Castellan, Enter.** Typed "Castellan Security Systems" into the empty issuer, Enter only → bar at once: *"19 more unfiled documents look like the same sender. Apply "Castellan Security Systems" to 19 & re-read · Not now"*. Apply named 20/20.
- **step58–65 Nordwind, teach from Review.** Quotation with no type; "Change what's read…" was greyed; picked "＋ Create new type…" → a clear dialog (step59) → "Quotation" created and selected, with *"“Quotation” created. Confirm this document now — or teach Scan Finder where each field sits… [Teach where the fields are]"* (step60; but the date it had read vanished and the blue note still said "doesn't have a document type yet"). Teach: **no dialog**, 3 typed fields, Save → DONE card at 4 s; **Review had already moved to the next document**; quiet re-read 10–45 s, all 19 siblings to 93%, fields filled, 0 flags, honest note *"Confirm 2 more and the rest from this sender can start filing themselves · 1 of 3 confirmed"*. Confirmed 2 → badge "✓ files by itself", readiness `ready true` — **and nothing filed for 50 s**; each held one said *"Nothing looks wrong — Invoice Date couldn't be checked automatically, so this one is waiting for your eye. Overall 93%… Confirm it and it files."* "Reprocess 17 from Nordwind" → 11 s → 16 filed by itself (all correct on disk, skewed scans included).
- **step66–67 Pelican re-teach.** Through the main-window wizard: no dialog of any kind for a sender taught before. The wizard's suggested spot for the invoice number was the footer line, label shown as *"ment terms: Due on receipt. Please quote (left of the value)"*; I accepted. 0025 filed correctly (`PI269923`) and Review moved on — but the 4 waiting Pelican were not re-read, and after "Reprocess 4" they read *"Not found — doesn't match the expected format — please enter manually"* at 56–70% (they had been 84–93%).
- **step68–69** Close: 132 waiting, 87 filed, "2 suppliers have qualified for automatic filing · learned 5 layouts".

## Re-verify, items 1–6
1. **Broken-pattern sender unstuck — FIXED.** One Veltrix confirm → 5 filed by itself in 2 s, right folder/number/date (page-checked). Caveats: one equally clean sibling (0013) was skipped with no visible reason and no later confirm swept it; a "$" typed into a number box draws no warning (I could not make an odd held document without saving a wrong value).
2. **Harrowgate 5th confirm — FIXED.** Badge honest before and after; layout made at 1 s; re-read 10–13 s; 14 filed by itself at 14 s, all correct. No "Read differently" notes were visible (they filed before I could open one). Copy nit: *"now that you've taught its layout"* — I taught nothing, I confirmed five.
3. **Reprocess as a single door — BETTER-BUT.** Harrowgate (14 filed, "File 1" only for the on-screen one) and Nordwind (16 filed) behaved exactly as promised. But: the five put-back Veltrix got *"Completed 0 of 5"* and silence; and a stale "File 1"/"File up to 14" can still be pressed and file 0 (card 2). "Reprocess 7 from Veltrix" still showed with 2 left.
4. **Enter settles the issuer — FIXED.** Immediate bar on Castellan; Apply named all 20.
5. **Review moves on after the wizard files — FIXED** (two samples: Nordwind at 4 s, Pelican).
6. **Copy — FIXED except one NOT-SEEN.** Untaught sender: no dialog (Nordwind). Reprocess warning: new sentence present. Empty required field: *"Fill in Invoice Number — a document can't file until its required details are in, whatever the bar."* (still led by the *"read at 61%, below the 90% you've set"* line). **"You've taught X before…": NOT-SEEN** — re-teaching Pelican through the wizard raised no dialog at all, anywhere.

**Known, still present:** "ITH-0093 · 5 more to file by itself", "Dairy Wholesale". The File-All-as-5th-confirm gap: **not constructible** on this DB (no untaught sender has File-All-ready documents), so NOT-SEEN.

## NEW finding cards (ranked by harm)

**1. A sender turns "✓ files by itself" at its 3rd confirm, but its waiting documents keep a stale hold until someone presses Reprocess**
- Citation: header *"Nordwind Refrigeration Ltd 17 documents ✓ files by itself"*; each document *"Nothing looks wrong — Invoice Date couldn't be checked automatically, so this one is waiting for your eye. Overall 93% · waiting for your check. Confirm it and it files."*
- User-moment: I had done exactly what the note told me ("Confirm 2 more and the rest… can start filing themselves") and waited 50 s.
- Observed: nothing filed; "Reprocess 17 from Nordwind" filed 16 in 11 s. So the check that held them was out of date, not failing. Also "Invoice Date" on a Quotation whose field is called "Date".
- Harm: trust-eroded / slowed (a timid user never presses Reprocess). Class: CONFUSION.
- Direction: the quiet re-read that runs after a teach should also run after the confirm that makes a sender ready (Harrowgate already does this after its 5th); or don't show "✓ files by itself" until a sweep has filed something.
- Missing: Pelican/Veltrix didn't need this, so it may be specific to a newly created type.

**2. Offers to file documents that have already filed — "File up to 14" that files 0, and bars that never go away**
- Citation: *"14 Harrowgate… already read cleanly and now pass every check — nothing was re-read. ✓ File up to 14"* shown seconds after *"✓ 29 documents… filed by itself"*; pressed → *"✓ Filed 0 from Harrowgate Timber Supplies — checked against the documents you just confirmed. Put back in Review"* + 14 × *"kept back — it was handled in the meantime"*. Later: three bars stacked for 30 minutes, one document offered in two of them ("File 1" and "File up to 1"), *"2 other senders are also ready — file these first and the next offer follows"* when nothing followed; the stale "File 1" vanished on press and filed nothing.
- Harm: trust-eroded (the owner's own rule: never a File N that files 0). Class: CONFUSION.
- Direction: retire an offer the instant its documents file; one bar per sender; a "Put back in Review" link makes no sense under "Filed 0".
- Missing: nothing went wrong on disk — every press was harmless.

**3. "Reprocess N from sender" on put-back documents does nothing and says nothing**
- Citation: *"Completed 0 of 5"* then blank; records' read-time unchanged; File All Ready: *"114 flagged — waiting for you to check a value"* including the five Veltrix that had filed by themselves 20 minutes earlier.
- User-moment: I'd put them back to check one, then wanted them re-filed.
- Harm: slowed. Class: QUESTION — why are the same five "ready" at 00:59 and "flagged" at 01:12?
- Direction: either re-read them or say "these were put back by you — confirm one and the rest follow" (which is what worked).

**4. A second teach of a known sender can quietly make it worse, and doesn't touch the waiting documents**
- Citation: wizard *"Value: PI/26/9923 · Label: ment terms: Due on receipt. Please quote (left of the value)"*; afterwards the four waiting Pelican: *"INVOICE NUMBER Not found — doesn't match the expected format — please enter manually"*, 56–70% (were 84–93%); Review header went from "2 taught fields" to "1 taught field".
- Harm: trust-eroded — the DONE card said "Teaching saved. It works straight away", the waiting ones weren't re-read, and when they were, they'd gone backwards. No "You've taught Pelican before" warning anywhere. Class: CONFUSION.
- Direction: when the label it found is a sentence fragment, say so and prefer the other occurrence; a re-teach should ask "replace the spot you taught on 21 Aug?"; run the quiet re-read after a re-teach too.
- Missing: I accepted the wizard's spot without stepping through its "printed in 2 places" offer — a careful person might have caught the label.

**5. Small honesty slips (cosmetic)**
- Creating a type from Review wiped the date it had already read (09-10-2025) and left *"This document doesn't have a document type yet"* above a selected "Quotation". `VX$12345` typed into a number box keeps "High · 95%" and no warning. Group headers lose their badge/countdown after a re-read or put-back (Nordwind "19 documents" with no "2 more", Veltrix no badge while the app's readiness said ready). "Reprocess 7 from Veltrix" with 2 left. A put-back of a "29" receipt returned 25. Class: PREFERENCE.

## The owner's question, updated
For a scared first-timer: **two of the three paths are now genuinely hands-off.** Harrowgate: five plain Confirms and nothing else — 14 filed themselves with a line that told me what was happening. Veltrix: one Confirm, five filed, receipt with Put back. Those are the first rounds where I pressed nothing I'd have to remember. Nordwind (create type → teach → 2 confirms) still needed **one** press of Reprocess-sender; last round that was two presses plus File All Ready.
Still to be remembered/pressed that shouldn't be: (a) Reprocess-sender after the confirm that makes a taught sender ready (card 1); (b) Reprocess after re-teaching (card 4); (c) the document you're looking at never files for you — you confirm it or press its "File 1"; (d) dismissing stale offer bars and knowing which of two "File 1"s is real; (e) a put-back sender wants a Confirm, not a Reprocess. Gone since round 13: File All Ready after a reprocess, clicking away instead of Enter, the "Template Manager" dialog, the "lower the bar" advice on an empty field.

**Top friction:** the stale hold/offer problem in both directions — held documents that are already fine (card 1) and offers for documents already gone (card 2). **What genuinely worked:** the Harrowgate minute — confirm, badge, quiet line, receipt, 14 correct files, 14 seconds. **Two-week verdict:** Yes, more firmly than round 13 — 44 documents filed this sitting, zero in a wrong folder, zero wrong numbers or dates, undo worked every time; I'd still be pressing Reprocess for a newly taught sender, but now I'd know it's one press, not a ritual.

## Humility
One scripted persona, one sitting, the same clean corpus, typed-locate teaching (the owner's users may draw). My driver made the Pelican re-teach worse by accepting the wizard's first located spot; I report it because the wizard proposed it, but a human might have stepped through. The Veltrix 0013 skip is a mystery I could not explain from records. The put-back count (25 vs 29) may reflect documents I'd filed another way in round 13. I could not construct the File-All-5th-confirm gap on this DB. Page checks were my own reading of the rendered pages, not an independent source. Screenshots `step47–69.png` in `chris-driver\`.
