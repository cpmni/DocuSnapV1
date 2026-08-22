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

---

## ROUND 14 — 2026-08-22 afternoon: the two-line wordmark slice + the owner's 22 real scans (fresh install, mig 82)

**Sandbox conditions:** fresh DB (migrations 1–82 — every reading/filing switch ON out of the box), isolated
userData, Demo Docs + `Doc sol\` (the owner's 22 real DOCUMENT SOLUTIONS scans), Output in the sandbox.
Driven over CDP (PID 22296) by the general-purpose Chris persona given rounds 13/13b to read first; typed-locate
teaching (the issuer box landed on the page FOOTER, not the stacked logo). Screenshots r14_step01–45 in the
session scratchpad `chris-driver/`. Report is VERBATIM.

I have what I need. Final tally: 27 documents filed on disk across two real sender folders (17 DOCUMENT SOLUTIONS, 10 Pelican), every one checked against its page and correct; one Quillstone PO under Bramblewood was my driver's mis-press (sent back). Here is my report.

---

# Chris The Customer — Round 14 (fresh install, sandbox CDP 9223 / PID 22296, 2026-08-22 13:34–14:50)

**Sandbox conditions:** fresh DB (migrations 1–82, every reading/filing switch ON out of the box), isolated userData, copied corpus, Output at the sandbox folder. Driven over CDP; native pickers substituted by setting the same variable the picker sets. Teaching: **typed-locate** for DOCUMENT SOLUTIONS (the wizard found the issuer in the page **footer**, not the stacked logo), **typed + one drawn box** for Pelican. Every claim checked against the app's records (`getReviewQueue`, `getScopeReadiness`, `getRecentAutoFiled`, `getDocumentWithExtractions`) and the Output folder; every filed page rendered and read by me. Screenshots `r14_step01–45.png` in `chris-driver\`.

## TL;DR
1. **The real-scans happy path happened once, and it was the best minute I've had with this app:** teach one worksheet → confirm two → at the third Confirm a quiet line appeared by itself at 9 s, swept 17 unopened documents (including the five bad scans), left the Print-Tracker alone, and **12 filed themselves at 80 s** — 15/15 on disk correct, three genuine duplicate scans honestly suffixed, and the app's dates were right where the owner's own filenames were wrong.
2. **But the teach itself did nothing for 150 s.** The DONE card said "works straight away"; the siblings stayed "Sender not identified / Read at 0%" until I typed the company name and took the "Apply to 14 & re-read" offer — and even then only 2 of 14 came back with details. For Pelican it was the reverse: the teach re-read ran, but the third Confirm produced nothing for 110 s and "Reprocess 17" was still the door (7 filed). The promise is still "sometimes".
3. **Fear probe found a real one:** filed → Put back → Delete → Empty bin leaves **no copy of the scan anywhere** (the original is moved out of `Processed` when it files), while the setup wizard promises originals "are never deleted… so you can always find them again."

## Walkthrough
- **A. First contact** (r14_step01–08): create admin → recovery code (Continue held until ticked) → Terms → six-step setup (output folder suggested `Documents\Scan Finder`, pointed at the sandbox; I mis-stepped past that page once and Back worked) → tour (plain, six cards; "Try a practice run"/"Import my documents" fork). Nothing new to fault.
- **B. Import `Doc sol` (22)** (r14_step09–11): ~25 s. Home table: 20 × "—", **"DOCUMENT OLUTIONS"**, **"Ticket Type"**. Records: **no document type on any of the 22** (a fresh install has only Invoice/Sales Order/Purchase Order), so no date/number anywhere; customer_name = **"Location"** (a printed label) on 21/22; two letterhead pre-fills at 69% with *"please confirm it's the sender, not the customer"*. No "Patrick", no "TIONS". Print-Tracker: no fields at all, "Sender not identified". Review groups: "DOCUMENT OLUTIONS 1 · Ticket Type 1 · Sender not identified 20".
- **C. Teach one worksheet** (r14_step12–22): opened 2601-0195-1. Blue card: *"This looks like a **Document Olutions**, but you don't have that document type yet… Add “Document Olutions”"* — the garbled company offered as a document TYPE, with SERVICE WORKSHEET printed in 20-pt on the page. Created "Service Worksheet" (+ "Worksheet" as also-appears-as; the dialog's fields can't be renamed to "Ticket No."/"Ticket Logged"). The Olutions card stayed on screen after the type was chosen. "Teach where the fields are": **no dialog**; wizard opened on my document; typed "DOCUMENT SOLUTIONS" → found in the **footer** line; ticket number and date located with labels "Ticket No. (left of the value)" / "Ticket Logged (left of the value)"; summary clean (r14_step21). DONE card at 4 s took the *nothing-is-waiting* variant ("As you confirm a few more… it will start filing itself"). **Review: no quiet line for 150 s**, queue 21, `getScopeReadiness()` = `[]`. Taught doc on disk correctly. Sibling's own Reprocess: type set to Service Worksheet, every field "Not found", *"Read at 0% · your setting 90%"*. Typed the company + Enter → *"14 more unfiled documents look like the same sender. Apply … to 14 & re-read"* (r14_step24) → 6 s later "DOCUMENT SOLUTIONS 15 · 13 need a look": **2 of 14** got the layout (95/90/94%, 93% overall), **12** got only the name at 75% ("Supplier set by you — confirm to file", 13% overall), 5 worksheets + Print-Tracker untouched. No "clipped fragment" note anywhere.
- **D. Confirm two, wait** (r14_step25–29): confirmed the two ready ones. Third Confirm at 0 s → badge "✓ files by itself" 1.6 s → *"Quietly re-reading DOCUMENT SOLUTIONS documents you haven't opened… 0 of 17 done"* at **9.2 s** → the five "Sender not identified" worksheets moved into the group one by one (6→1; the Print-Tracker stayed) → at 78.8 s a green panel *"12 … already read cleanly and now pass every check — nothing was re-read. ✓ File up to 12"* → at **80.3 s** *"✓ 12 documents from DOCUMENT SOLUTIONS filed by itself after your confirms… Put back"*, queue 19→7. **Disk: 15/15 right** (`DOCUMENT-SOLUTIONS\2026\<Month>\Service-Worksheet.<date>.<ticket>.pdf`); three scans of ticket 2605-0065-1 → `-DUPLICATE`, `-DUPLICATE-2` (genuinely the same sheet); 2603-0667-1 ×2 likewise; filed 16-03-2026 where the source names said 16-09-2026/2008 — the page says 16/03/2026, the app was right. Pressed the stale "File up to 12": *"✓ Filed 0 from DOCUMENT SOLUTIONS… Put back in Review"* + 12 × "kept back — it was handled in the meantime". **Put back** 12 → queue 19, copies stayed → confirmed one → **10 re-filed in 3 s**, in place, no new duplicates, no second re-read (the one Review had just moved onto was skipped). Left behind: the doc that was on screen during the sweep (its Reprocess then read 97/98% → "Ready to file" → my Confirm); the APPROVED-stamped 4th copy held honestly (*"'2605-0065' doesn't appear on this page as written"*); and **four copies of one scan with the title cut off** — no type, *"Couldn't match… confirming will teach this layout"*; I typed number+date and confirmed one; the other three did not follow after 75 s or after a Reprocess. Home meanwhile said *"20 ready to file"* (none were), later *"1 ready to file"* (the Print-Tracker) and *"No suppliers file automatically yet"* under a Review badge saying the opposite.
- **E. Import 200, Pelican** (r14_step30–41): 61 "—", Bramblewood 20 (the buyer, known), "Dairy Wholesale" 1; "ITH-0093" from round 13 is gone. Pelican 0023 carried no "Teach this document" card; used Teach from the main window. Issuer typed → "printed in 2 places", took #1; date found; invoice number: *"That isn't printed on this page… I can still save it — it will be filled in as typed on every document of this type"* for a number printed twice on the page (tried "26/6000" too). Drew a box → read **"P1/26/6000"** with *"Value wrong? Type it as printed"* → PI. DONE card: *"19 from Pelican are waiting… details fill in when they're re-read"*; quiet re-read at 12 s, 19/19 by 80 s. Result: **17 with no invoice number, 2 with "Pu2sisaso"/"Pu263130"** (flagged honestly). ⊕ on a sibling's number in Review read **PI/26/1150** correctly → Confirm (#2). Next doc's Reprocess: "PI/26/1792 · Check 50%" → Confirm (#3) → badge ready, readiness `ready:true` — **nothing for 110 s**. "Reprocess 17 from Pelican" → 26 s → *"✓ 17 documents from 2 senders… filed by itself"* (7 Pelican), plus a "File 1" for the on-screen one; 10 left at *"Overall 100% · Invoice Number wasn't read certainly enough (High · 84%)… Confirm it and it files. This isn't the confidence setting."* All 10 Pelican files on disk OCR-checked: correct, every reference "PI".
- **F. Search, scary buttons, fear probe** (r14_step42–45): Search by ticket/reference instant; "Galgorm" finds all 4 copies; "Kyocera" 17; **"Beaumont Galgorm" and "worksheet March" find nothing**. Truth-table below. Put back 17 → delete one put-back Pelican (went to bin, file still on disk) → Empty bin → **`Pelican-Office_invoice_0019.pdf` exists nowhere in the sandbox**. Re-filing the put-backs: Pelican confirm → 5 filed by itself in 3 s; DS confirm → no self-file, an offer bar *"10 … File up to 10"* → pressed → "Filed 10". **My driver pressed Confirm on the wrong on-screen document** (Quillstone-Print PO 0029, issuer pre-filled "Bramblewood Joinery Ltd" with the "sender, not the customer" note, 62%) → filed under `Bramblewood-Joinery-Ltd\`; Search → "Send back to Review" worked (copy stays until re-confirmed) — and Bramblewood's badge now reads "4 more to file by itself".

## Re-verify, changes 1–5
1. **Cold first pass, no fragments/address words — BETTER-BUT.** Zero "Patrick", zero "TIONS"; 20/22 arrive with the issuer empty. But **"DOCUMENT OLUTIONS"** (69%, the stacked logo read as one garbled line) and **"Ticket Type"** (a printed field label) were still pre-filled as companies, each with the "please confirm it's the sender" note; customer_name "Location" on 21/22.
2. **Teaching keeps the taught name, no "clipped fragment" note — FIXED as far as I could exercise it.** Across three re-reads of 21 worksheets, no "looks like a clipped fragment… please confirm" anywhere; siblings show "DOCUMENT SOLUTIONS · High 95%". **Caveat:** typed-locate put my issuer box on the footer, not the logo, so the "box reads only DOCUMENT" path was not driven — partly NOT-SEEN.
3. **Quiet re-read finds the badly scanned siblings — BETTER-BUT.** The teach itself triggered **no** re-read (150 s, readiness empty). The typed-name ripple found 14/19. The third-confirm re-read reached **17 = every unopened worksheet including the five bad scans, Print-Tracker excluded** — that part is exactly as promised. The four copies with the header cut off came back with nothing to show.
4. **The readying confirm re-reads by itself — FIXED for DOCUMENT SOLUTIONS, NOT-FIXED for Pelican.** DS: 3rd Confirm → line at 9 s → 12 filed at 80 s; 4th and later confirms started no re-read. Pelican: 3rd Confirm → ready badge → nothing in 110 s; "Reprocess 17" filed 7. Pattern I saw: the confirm-triggered re-read ran only for the sender whose teach-time re-read had *not* run.
5. **Layout named from the typed company — FIXED.** "DOCUMENT SOLUTIONS is filed and its layout is saved"; group, folder and every record say DOCUMENT SOLUTIONS; "OLUTIONS" survives only as the pre-teach group name.

## NEW finding cards (ranked by harm)

**1. A filed-then-put-back document can be destroyed with two presses, against the setup promise**
- Citation: setup wizard *"🔒 Your original scans are never deleted — they're just moved into a “Processed” folder so you can always find them again."*; Empty bin *"Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone."*
- User-moment: tidying a batch I'd put back to check.
- Observed: on filing, the original leaves `Processed` (the Output file is the moved original, not a copy). Put back → 🗑 → Empty bin, and `Pelican-Office_invoice_0019.pdf` is gone from Output, Processed and the app's inbox. The bin dialog is truthful; the wizard isn't.
- Harm: trust-eroded, potential loss. Class: QUESTION (the confirm must stay). Direction: either keep a copy in `Processed` when filing, or change the wizard line to "…moved into Processed, then into your output folder when filed."
- Missing: maybe "Processed" is meant only for never-filed scans; nothing here weakens the confirm.

**2. The teach does nothing visible until you type the name or confirm a third time**
- Citation: DONE card *"Teaching saved. It works straight away"*; sibling after Reprocess *"Read at 0% · your setting 90%"*, *"Recognised by: Not seen before"*; readiness `[]`.
- User-moment: I'd just taught, the card told me to confirm a few more, and every sibling was empty.
- Observed: no quiet line for 150 s; the way forward was typing the company name (ripple) — after which 12 of 14 came back with only the name and 13%. For Pelican the teach re-read ran fine. Harm: blocked for a timid user. Class: CONFUSION.
- Direction: run the teach re-read on the "Sender not identified" siblings too (the 3rd-confirm one proved it can find all 17), and make the DONE card say "N waiting" rather than the nothing-waiting variant.
- Missing: the footer box may have made the layout harder to match than a logo box would.

**3. Pelican: "✓ files by itself" and nothing files; the wizard's number box read nothing on 17 siblings**
- Citation: *"Pelican Office Interiors 17 documents · 17 need a look ✓ files by itself"*; wizard *"That isn't printed on this page — I can still save it — it will be filled in as typed on every document of this type"*; siblings *"Needs: Invoice Number"*.
- Observed: third Confirm, 110 s, nothing; "Reprocess 17" filed 7. The "save as typed" offer would have stamped PI/26/6000 on 19 invoices. Harm: slowed / trust-eroded (13b card 1 again). Class: CONFUSION.
- Direction: the confirm-time re-read should run whenever the sender turns ready, not only if the teach-time one was skipped; when a value is typed but not found, say "I read it as P1/26/6000 — is that it?" before offering a fixed value.
- Missing: my drawn box was 62×19 px at 100%; a human might draw tighter.

**4. Home tells a different story from Review**
- Citation: Home *"20 ready to file"* (records: 20 with no type, no issuer, no fields), later *"1 ready to file"* (the Print-Tracker), *"No suppliers file automatically yet — they graduate after a run of clean confirmations · learned 2 layouts"* after 34 documents had filed themselves; Review: *"Nothing is ready to file yet"* and "✓ files by itself" on two senders.
- Harm: trust-eroded. Class: CONFUSION. Direction: Home's "ready" should use the same test as File All Ready; "files by itself" senders should count as getting smarter.

**5. A company name offered as a document type**
- Citation: *"This looks like a Document Olutions, but you don't have that document type yet… Add “Document Olutions” — or choose an existing type above."*; on siblings *"Add “Document”"*. Stays after "Service Worksheet" is selected.
- User-moment: first real scan, page headed SERVICE WORKSHEET, filename starting "Worksheet."
- Harm: slowed; a first-timer would create a type called "Document Olutions". Class: CONFUSION. Direction: never offer the issuer read as a type; prefer the printed title or the filename word; hide the card once a type is chosen.

**6. Stale offers and counts (13b card 2 again)**
- Citation: *"12 DOCUMENT SOLUTIONS… already read cleanly and now pass every check — nothing was re-read. ✓ File up to 12"* shown seconds after those 12 filed; press → *"✓ Filed 0 from DOCUMENT SOLUTIONS… Put back in Review"* + 12 × *"kept back — it was handled in the meantime"*; *"Reprocess 13 from DOCUMENT SOLUTIONS"* with 6 left; a "File 1" bar that outlived its document; "nothing was re-read" straight after a re-read.
- Harm: trust-eroded. Class: CONFUSION. Direction: retire an offer when its documents file; one bar per sender; no "Put back" under "Filed 0".

**7. One click files a 62% document under the buyer while the warning is showing**
- Citation: Search details *"Bramblewood Joinery Ltd · Confirmed · 62% confidence"*; the Review note on that doc was *"The letterhead reads 'Bramblewood Joinery Ltd' — … please confirm it's the sender, not the customer, before filing."*; afterwards *"Bramblewood Joinery Ltd … 4 more to file by itself"*.
- Observed: this was **my driver's mis-press** on the on-screen document. Still: Confirm was live, and after "Send back to Review" the buyer still counts one confirm toward filing by itself. Class: QUESTION — I am not asking to block Confirm. Direction: a sent-back document should not count toward a sender's graduation.

**8. Small honesty slips (cosmetic)**
- Create-type dialog can't rename "Reference number" → "Ticket No." (the paper's words); *"Needs a quick check — 1 field was flagged by a formatting check"* for the name I typed myself; *"High · 84%"* beside *"wasn't read certainly enough"*; "Beaumont Galgorm" finds nothing while "Galgorm" finds four; *"confirming will teach this layout"* on the header-cut copies didn't carry to the other three; customer "Location" on 21 records; the DS put-back needed a "File up to 10" press while Pelican's re-filed itself. Class: PREFERENCE.

## Warnings truth-table
| Button | What it said | What it did | Verdict |
|---|---|---|---|
| Teach where the fields are (untaught sender) | no dialog | opened the wizard on my doc | Good |
| Save teaching & file | "Your document is filed… works straight away" | filed the one doc; siblings untouched (DS) / re-read (Pelican) | Half true |
| Apply "X" to 14 & re-read | as written | named 14, re-read them in 6 s; 2 got details | True (thin) |
| Confirm & File (3rd) | "Confirm 2 more and the rest… can start filing themselves" | DS: 12 filed at 80 s · Pelican: nothing | Sometimes |
| File up to 12 (stale) | "now pass every check" | "Filed 0" + 12 kept back | Harmless, false |
| Put back | "nothing is lost; the filed copies stay on disk" | 12/17 returned, copies on disk | TRUE |
| File All Ready (5 left) | "Nothing is ready to file yet" | nothing | TRUE (Home said otherwise) |
| Reprocess N from sender | "…doesn't file anything by itself — …the sender's own auto-file once it's learned" | 7 filed by itself 26 s later | TRUE (the last clause saved it) |
| Reprocess all in queue (194) | same + "can take a while" | cancelled | Honest |
| Delete (single) | "goes to the app's recycle bin — restore from Search" | in bin, file on disk | TRUE |
| Empty bin | "including their PDF files… cannot be undone" | only copy destroyed | TRUE — see card 1 |
| Delete All Review (194) | "go to the recycle bin… Files on disk are kept" | cancelled | Honest |
| Send back to Review | "It stays filed until you re-confirm it" | back in queue, file kept | TRUE |

## The owner's question, updated
For a scared first-timer with their **own** real scans: **once**, it was genuinely hands-off — from the third Confirm, 12 worksheets filed themselves with a line telling me what was happening, an undo that worked, and not one wrong folder or wrong ticket across 17 real, handwritten, partly duplicated scans. That is the product the owner is aiming at, and it exists. **But the way there still has things to remember:** (a) after teaching, **type the company name and take the "Apply to N" offer** — the teach alone left everything at 0%; (b) a sender that shows "✓ files by itself" may still need **Reprocess N from sender** (Pelican); (c) the document on screen never files for you; (d) a put-back batch sometimes wants a Confirm, sometimes an offer press; (e) scans with the title cut off need each copy typed by hand; (f) don't take the wizard's "save it as typed" for a number it can't read; (g) don't trust Home's "ready" count. Gone since 13b: the Template-Manager dialog, Enter-vs-click-away, "lower the bar" advice, the "P1" glyph in filed Pelican names (10/10 "PI" this round).

**What genuinely worked:** the DOCUMENT SOLUTIONS third-confirm minute — badge, quiet line, five bad scans swept in, Print-Tracker left out, 12 correct files, Put back and re-file in place. **Top friction:** the teach that changes nothing until you find the ripple, and a "files by itself" badge that is true for one sender and not the next. **Two-week verdict:** Yes — 27 real and synthetic documents filed with zero wrong values and zero wrong folders by the app's own hand; the only misfile was my finger. I'd keep it, with a sticky note saying "type the name, then Reprocess if the badge lies", and I'd want card 1 fixed before I emptied a bin.

## Humility
One persona, one sitting. The DOCUMENT SOLUTIONS issuer was taught from the **footer** via typed-locate, not the logo the owner drew, so the "clipped fragment" path (change 2) was only partly exercised. My Pelican number box was drawn by script at one size; a person might do better or worse. My driver made two mistakes I own: it left a hung process that cancelled one Reprocess dialog, and it pressed Confirm on a Quillstone PO that happened to be on screen (card 7) — I report the app's side of that honestly, not as a misfile by the app. The "Processed" behaviour may be by design; I judged it against the wizard's sentence. Page checks are my own reading of rendered pages (and one OCR pass), not an independent source. Screenshots `r14_step01–45.png` in `chris-driver\`.


---

# ROUND 15 — 2026-08-22 evening (fresh install; sandbox CDP 9223 / PID 17712; the round-14 vet queue built: Q1 keep-originals mig 83 ON, Q4a type-nudge arms ON, Q4b ONE classifier + Home senders, Q4c/Q4d bar prune + badge refresh, Q2 `fingerprint_seed_support_prune` ARMED in the sandbox; Q3 NOT in this build)

# Chris The Customer — Round 15 (fresh install, sandbox CDP 9223 / PID 17712, 2026-08-22 16:12–17:25)

**Sandbox conditions:** fresh DB, isolated userData, my own copy of Demo Docs + `Doc sol\` (the owner's 22 real scans), Output in the sandbox. Admin I created: **chris / plumbing2026!** (display "Chris Fenton"). Driven over CDP; native pickers substituted by setting the same variable the picker sets; every native confirm() captured before pressing. Teaching: **typed** for DOCUMENT SOLUTIONS (the wizard put the issuer box on the page footer again), **drawn boxes** for Ridgeway Plant Hire worksheets. Every claim checked against the app's own records and the Output folder; every doubtful page rendered and read by me; Saltmarsh and Ridgeway files also machine-checked against their pages. Screenshots `r15_step01–57.png` + page crops `top_*.png` in `chris-sandbox15\shots\`.

## TL;DR
1. **The teach now does real work the moment you save it.** Typed teach from my worst scan → 12 s later *"Quietly re-reading DOCUMENT SOLUTIONS documents you haven't opened… 0 of 19 done"* → 95 s later all 19 carry the sender, 18 carry the right ticket number and date (four header-cut copies included — the ones that came back empty last round), one held honestly. Drawn-box teach on Ridgeway: same line, 19 of 19, all with values. Zero wrong values, zero wrong folders across 57 filed files.
2. **But "✓ files by itself" still doesn't mean what it says for documents already sitting in Review.** After the third confirm the badge went green and 14 ready DOCUMENT SOLUTIONS (later 9 ready Ridgeway) sat there for 100–120 s with no line, no bar, nothing — until I pressed File All Ready. The same sender filed 16 new arrivals by itself on import seconds later, so the promise is true for new scans and false for the pile in front of you. Typed or drawn made no difference.
3. **The safety card is closed properly.** Filed → Put back → Delete → Empty bin: the bin dialog now says *"Your original scans in the Processed folder are not touched"* and it's true — the original was still in `Processed`; the app then refused to re-import that folder (*"…18 documents you have already filed… Import it anyway?"*), and saying yes even brought my destroyed file back under its plain name.

## Walkthrough
- **A. First contact** (r15_step01–10): admin → recovery code (Continue greyed until ticked) → Terms (draft banner, known) → six-step setup. The originals sentence has changed: *"When you confirm a document, Scan Finder files a tidy **copy** here"* and *"🔒 Your original scans are never deleted — each one is moved into the "Processed" folder when it is imported **and stays there after filing**, so you can always find it again. (Settings → Files & filing can turn the kept copy off to save disk space.)"* (r15_step05). Tour unchanged, six cards.
- **B. Import `Doc sol` (22)** (r15_step11–13): ~25 s. Same cold pass as round 14: twenty "—", **"DOCUMENT OLUTIONS"**, **"Ticket Type"**; customer "Location" on 21/22; no type on any. **Moment 1 — Home: "22 waiting in the review queue · 22 need your review"** (no "ready" line at all this time); **File All Ready: "Nothing is ready to file yet — every document in the queue is waiting on a check or a missing detail."** Agree.
  **The nudge** (r15_step14–15): on 2601-0195-1 *"This looks like a **Service Worksheet**, but you don't have that document type yet… Add "Service Worksheet" — or choose an existing type above."* — the printed title, not the company. Pressing it opens a **catalog** with Service Worksheet pre-ticked (Document Issuer, Worksheet Number, Worksheet Date) (r15_step16); the card vanished once the type was set (r15_step17). Across the 22: 2 offered "Service Worksheet", 18 offered nothing, the Print-Tracker offered **"Add "Print""**, and the APPROVED-stamped copy offered **"This looks like a Ment… Add "Ment""**. No company name was ever offered as a type.
  **Teach** (r15_step18–26): the "Teach this document" card was hidden on my worst scan (its only "read" field was the customer "Location"), so I used Teach on the main rail. Typed DOCUMENT SOLUTIONS → found in the footer (r15_step21); 2601-0195-1 → *"Label: Ticket No. (left of the value)"*; 07/01/2026 → *"Ticket Logged"*; summary clean (r15_step25). DONE card at 4 s, still the nothing-waiting wording: *"As you confirm a few more of their Service Worksheet in the review queue, it will start filing itself."* **Review at 12 s: the quiet line, 0 of 19**; 19 of 19 by ~107 s; group 1 → 19 ("2 need a look · 2 more to file by itself") (r15_step27). **Values:** all 19 "DOCUMENT SOLUTIONS · 95%"; 18 with number + date; excluded = the document Review had on screen (Booking.pdf) + the Print-Tracker. I read the pages for the four 2603-1351-1 copies, 2605-0769-1 (filename says 9605) and 2603-0668-1 (filename says 2008): **the app was right every time and the owner's filenames were wrong.** Held honestly: the APPROVED stamp sits over the "Ticket No." label → *"'2605-0065' doesn't appear on this page as written"*. One note *"Read differently after learning — was 'Ticket Type', now 'DOCUMENT SOLUTIONS'. Please check which is right."* (correct value). **Moment 2 — Home: "21 waiting · 4 need your review · 17 ready to file"; File All: "File 17 ready documents (of 21)… 2 flagged · 2 with no document type yet."** Agree.
  **Confirms** (r15_step29–31): #1 → "1 more to file by itself". #2 → **"✓ files by itself" at 1.6 s**, then a quiet "0 of 1" at 9 s (the copy that had been on screen) — which came back **blank**: *"Couldn't match this document to a saved layout"*, no type (r15_step34); its own Reprocess, with and without the type set, same. Waited 100 s: nothing filed. #3 (the "Ticket Type" one) → nothing in 120 s. #4 → nothing in 90 s. **Moment 3 — Home: "18 waiting · 3 need your review · 15 ready to file" and "1 sender files by itself after your confirmations. Learned 1 layout. Nothing has filed by itself in the last 7 days yet."**; File All 15. Agree, and Home is honest about the contradiction. File All Ready → *"File 14 ready documents (of 17)…"* → *"✓ Filed 14 documents — DOCUMENT SOLUTIONS (14). — 1 has no document type detected; 2 not ready to file."* (r15_step32). **Disk: 19/19 correct**, `DOCUMENT-SOLUTIONS\2026\<Month>\Service-Worksheet.<date>.<ticket>.pdf`, genuine duplicates suffixed (2605-0065-1 ×3, 2603-1351-1 ×3, 2603-0667-1 ×2). Processed folder still held all 22 originals. Home after: "3 waiting · 3 need your review"; "1 supplier has graduated to fully automatic filing".
- **C. Safety** (r15_step35–40): Search "2602-0527" → *"Send this document back to the Review queue? It stays filed until you re-confirm it."* → Review 🗑 *"Delete … It goes to the app's recycle bin — you can restore it from Search."* → bin → Empty bin: *"Permanently delete all 1 document in the recycle bin, including their PDF files? This cannot be undone. Your original scans in the Processed folder are not touched."* Result: Output PDF gone; **`Processed\Worksheet.13-02-2026.2602-0527-1-1.pdf` still there**; an orphan `.metadata\…xml` left behind. Import `Doc sol\Processed`: the preview still said "📄 22 documents ready to import", then *"This folder holds the original scans of 18 documents you have already filed. Importing it again would create duplicates. Import it anyway?"* (18 is exactly right). Cancel → a red **"COULDN'T START"** panel. Accept → 22 processed in 25 s: **"16 documents auto-filed — no review needed"** + *"Scan Finder has learned DOCUMENT SOLUTIONS — their clean Service Worksheet documents will now file automatically"*; all 16 on disk as `-DUPLICATE…` with correct names, and **2602-0527-1 re-filed under its plain name** (my destroyed copy was back). 6 to Review: the four header-cut 2603-1351-1 copies (now *"Couldn't match this document to a saved layout"*, no type — they had been read perfectly an hour earlier), the stamped copy ("5-0065-1 · manually mapped value differs from the usual format"), the Print-Tracker. Originals moved to `Processed\Processed`.
- **D. Demo Docs** (r15_step41–45): a supplier folder can't be imported whole (*"No documents found directly in this folder"*), so six subfolders (Saltmarsh invoice/PO/delivery, Ridgeway invoice/SO/worksheet) + `Other\IMPORT` = 320; all 320 "need your review". Home "329 · 329 need your review"; File All "Nothing is ready". Groups include **"Dairy Wholesale 1"** beside "Meadowvale Dairy Wholesale 18". Saltmarsh invoice_01: correct (09-08-2026 · INV-13608), one note *"please confirm it's the sender"*. Confirmed 01–04 (badge 5→1 more). **5th: quiet re-read of 34 at 10.7 s → at 39.7 s a bar *"13 Saltmarsh Seafoods Invoice documents were re-read just now and pass every check. ✓ File up to 13 · Review them · Not now · Choose which…"* → at 41.2 s, untouched by me, *"✓ 13 documents from Saltmarsh Seafoods filed by itself after your confirms… Put back"*.** Queue 324→311. **18/18 Saltmarsh on disk: number and date both on the page.** The two notices merged into one line; "Reprocess 42 from Saltmarsh" followed the live count. Send-back of INV-39650: fine. Ridgeway invoice confirm → "4 more" → Search → Send back → **"5 more" within 0.7 s**. Put back the 13 (12 returned, copies stayed) → no self-refile in 60 s → Home "312 need your review · 12 ready" = File All 12 → filed in place, **0 new duplicates**. Scary dialogs (Reprocess 60 / Reprocess all 312 / Delete All Review 312) read as before; cancelled.
- **E. Drawn-box control — Ridgeway worksheets** (r15_step46–52): nudge *"This looks like a Worksheet… Add "Worksheet""* though "Service Worksheet" exists. Wizard: drew the name → *"Company name: Ridgeway Plant Hire · Looks right"*; drew WS-83816 → *"Label: Reference No. (left of the value)"*; drew 27/07/2026 → *"Label: Date"*. DONE card identical (no "19 waiting"). Quiet re-read at 12 s, **"0 of 19"** (worksheets only — Ridgeway's 40 invoices/orders left alone), done at 173 s (~10 s each, slower than the worksheets' 5 s). **19/19 with name + number + date; 11 ready; 8 flagged:** 7 × *"manually mapped value differs from the usual format for this field — please verify"* at 70% — I read worksheet_17: it prints **WS-89028** exactly, same shape as the 11 clean ones (a skewed scan); worksheet_13 read "ws-54701" (page WS-54701); and one honest catch, worksheet_07 read "VS.72672" with *"A wider reading of this box shows 'WS-73673'"* — the page says WS-73673. Two confirms → worksheet line gone (graduated) → **nothing in 110 s**; Home "300 need your review · 9 ready" = File All 9. Ridgeway 4/4 on disk correct.
- **F. Odds and ends** (r15_step53–57): Settings → Files & filing: *"Keep original scans after filing — On: the original stays in the Processed folder after its filed copy is made, so emptying the recycle bin can never destroy your only copy. This keeps a second copy of every filed scan (about the size of your scan folder again). Off: the original is removed once the filed copy exists."* Bin → single Delete permanently: *"Permanently delete this document and its file? This cannot be undone. Your original scans in the Processed folder are not touched."* Restore all → back in the queue. No stale bars anywhere after the self-filings. **Meadowvale credit note 0025** (r15_step55): page headed CREDIT NOTE, sender read as "Dairy Wholesale", and the card says *"This looks like a **Poo**, but you don't have that document type yet… Add "Poo""* (Credit Note is in the catalog). Hand-typing number + date on one header-cut copy filed it correctly; the other three did not follow (same as round 14). Final Home: "308 waiting · 299 need your review · 9 ready"; "55 filed today"; *"3 senders file by themselves… 1 supplier has graduated"* (it said "2 suppliers" twenty minutes earlier).

## Re-verify, round-14 cards 1–8
1. **Put back → Delete → Empty bin destroys the only copy — FIXED.** Original stayed in `Processed`; the bin dialog says so and is true; the wizard, Settings and Help all say the same thing; re-importing the kept originals even restored the destroyed file.
2. **The teach does nothing visible — FIXED** (quiet re-read of 19 at 12 s, real values, no ripple needed) — **BETTER-BUT** the DONE card still uses the nothing-waiting sentence for both teaches.
3. **"✓ files by itself" and nothing files — BETTER-BUT.** New arrivals do file themselves (16 on the re-import, 13 at Saltmarsh's fifth confirm). Documents already read and sitting in the queue still don't (14 DS, 9 Ridgeway); File All Ready now offers them truthfully, so no "Reprocess N" trick is needed, but it's still a press.
4. **Home tells a different story from Review — FIXED.** Six moments checked (22/none, 17/17, 15/15, 12/12, 9/9, 3/3): Home's "N ready" = File All's N every time, and the Getting-smarter sub-line admits *"Nothing has filed by itself… yet"*. Residual: senders vs suppliers count flips (3 / 2 / 1).
5. **A company name offered as a type — FIXED for the taught scan, NEW-PROBLEM elsewhere.** "Service Worksheet" offered, card retires on choice, catalog pre-ticked. But "Print", "Ment", and "Poo" (on a CREDIT NOTE) are still offered, and "Dairy Wholesale" still stands as a sender.
6. **Stale offers and counts — FIXED.** No "File up to" after a self-file, no "Put back" under "Filed 0", "Reprocess N" live, notices one line, "were re-read just now" wording present.
7. **Sent-back doc counts toward graduation — FIXED.** Badge 4 → 5 within 0.7 s of the send-back.
8. **Small slips — partly.** *"Needs a quick check — 1 field was flagged by a formatting check"* still fires for the name the app itself pre-filled; catalog field names ("Worksheet Number / Date") are close to the paper's "Ticket No. / Ticket Logged" — fine.

## NEW finding cards (ranked by harm)

**1. The badge turns green and the pile in front of you never moves**
- Citation: Review *"DOCUMENT SOLUTIONS 17 documents · 2 need a look ✓ files by itself"*; Home *"1 sender files by itself after your confirmations… Nothing has filed by itself in the last 7 days yet."*; File All *"File 14 ready documents (of 17 in the Review queue)?"*
- User-moment: I'd taught, confirmed three, the badge said it files by itself, 14 ready ones sat in the list.
- Observed: 100 s, 120 s, 90 s of waiting across confirms 2–4: no line, no bar, nothing. Same for Ridgeway (9 ready, 110 s). Yet the same sender filed 16 new imports by itself and Saltmarsh's fifth confirm filed 13. I would conclude it's broken and press File All — which works, but then what's the badge for?
- Harm: trust-eroded / slowed. Class: CONFUSION.
- Direction: when a sender turns green, sweep what's already read and ready (the Saltmarsh bar shows the app can do this), or have the badge say "new documents will file by themselves — File All Ready for these N".
- Missing: maybe the app deliberately won't touch documents it read before the sender was trusted.

**2. The worst scans are read perfectly after the teach, then forgotten after a few good confirms**
- Citation: the four header-cut copies of 2603-1351-1 at teach time: *"DOCUMENT SOLUTIONS · High 95% · 2603-1351-1 · 31-03-2026"*; on re-import an hour later, all four: *"Couldn't match this document to a saved layout for the supplier — please check the document type; confirming will teach this layout."*, no type.
- User-moment: the same sheet, scanned four times; three filed correctly, the fourth (on screen during the teach) came back blank at the second confirm and stayed blank through Reprocess, with and without the type set.
- Harm: slowed; a customer who scans badly gets the app's worst result on their commonest problem. Class: QUESTION.
- Direction: whatever made the teach-time read work on these should keep working after confirms.
- Missing: the on-screen copy was excluded from the first pass by design; I can't tell if that's the only difference.

**3. "This looks like a Poo"**
- Citation: Review, Meadowvale-Dairy_credit_note_0025 (page headed CREDIT NOTE): *"This looks like a Poo, but you don't have that document type yet — so it can't be filed… Add "Poo" — or choose an existing type above."*; Document Issuer *"Dairy Wholesale"*; APPROVED-stamped worksheet: *"Add "Ment""*; Print-Tracker: *"Add "Print""*.
- Observed: I'd laugh, then wonder what else it's reading this way. Credit Note is in the catalog one click away; the printed title says so in 20-pt.
- Harm: trust-eroded; cosmetic on its own. Class: CONFUSION.
- Direction: only offer a word that is a real printed title, or a catalog match; never a three-letter scrap; and don't let half a company name stand as a sender.
- Missing: these are test scans with odd fonts; still, "Poo" is what a customer would screenshot.

**4. Seven false alarms in one teach, in words I can't say out loud**
- Citation: Ridgeway worksheets after the drawn teach: *"Worksheet Number · Check · 70% — manually mapped value differs from the usual format for this field — please verify"* on WS-89028, WS-35768, WS-91456, WS-62207, WS-86426, WS-99205 (all printed exactly so) and ws-54701.
- User-moment: 19 came back with values; 8 wanted me, and 6 of those were right.
- Harm: warning fatigue — after this I'd stop reading the flag, and then I'd miss worksheet_07, the one genuine catch ("VS.72672" with *"A wider reading of this box shows 'WS-73673'"* — which was right). Class: CONFUSION.
- Direction: *"This number looks different from the others from this sender — please check"*; and if the wider reading matches the usual shape, show it as the value and say so.
- Missing: these scans are skewed on purpose; real scans may trip this less.

**5. An offer that answers itself**
- Citation: *"13 Saltmarsh Seafoods Invoice documents were re-read just now and pass every check. ✓ File up to 13 · Review them · Not now · Choose which…"* at 39.7 s, then at 41.2 s *"✓ 13 documents from Saltmarsh Seafoods filed by itself after your confirms… Put back"*.
- Observed: I was shown "Not now" and "Choose which…" and had 1.5 s to use them. The outcome was right (18/18 checked) and Put back exists, so no harm done — but a bar that asks and then decides reads as the app ignoring me. Class: QUESTION.
- Direction: either don't show the choices, or honour them for a few seconds.
- Missing: it may be a receipt styled like an offer.

**6. The teach door is missing on the very document that needs it, and the DONE card still can't count**
- Citation: my worst scan, after setting the type: no "Teach this document" card at all (only "Location" had been "read", as the customer); DONE card both times: *"As you confirm a few more of their Service Worksheet in the review queue, it will start filing itself."* while 19 were waiting.
- Harm: slowed (I had to know the Teach button on the main rail exists). Class: CONFUSION.
- Direction: show the teach card whenever the reference and date are empty; say "19 more from this sender are waiting — I'm re-reading them now".
- Missing: the main-rail Teach is arguably the intended door.

**7. The import refusal is right but its frame is wrong**
- Citation: above the refusal, *"📄 22 documents ready to import"*; on Cancel, a red *"COULDN'T START — This folder holds the original scans of 18 documents you have already filed…"*; on Yes, originals moved to `Processed\Processed`.
- Harm: cosmetic / mild fright ("couldn't start" after I chose to stop). Class: PREFERENCE.
- Direction: "Import cancelled — this folder holds the kept originals of 18 filed documents"; and perhaps don't nest Processed inside Processed.

**8. Small honesty slips (cosmetic)**
- Home *"3 senders file by themselves"* next to *"2 suppliers have graduated"*, later *"1 supplier"*; a `.metadata` xml survives a purge; *"Delete ALL 312 document(s)… Files on disk are kept"* lacks the new originals sentence (it's not a purge, so fair); a supplier folder with subfolders can't be imported in one go; *"Reprocess 1 from "Dairy Wholesale""*; the untyped worksheet shows "INVOICE DATE / INVOICE NUMBER" labels until a type is picked. Class: PREFERENCE.

## Warnings truth-table
| Button / bar | What it said | What it did | Verdict |
|---|---|---|---|
| Setup wizard originals line | "files a tidy copy… stays there after filing" | originals stayed after filing, after the bin, after everything | TRUE |
| Save teaching & file (typed, DS) | "works straight away… As you confirm a few more…" | filed 1; re-read 19 in 95 s with real values | TRUE but under-sold |
| Save teaching & file (drawn, Ridgeway) | same | re-read 19 in 170 s, values on all | TRUE but under-sold |
| Confirm (3rd/4th, DS) · (3rd, Ridgeway) | badge "✓ files by itself" | nothing for 100–120 s | FALSE for the queue — card 1 |
| Confirm (5th, Saltmarsh) | — | 34 re-read, 13 filed by itself, bar + Put back | TRUE |
| "File up to 13 · Not now · Choose which…" | a choice | filed 1.5 s later | MISLEADING — card 5 |
| File All Ready (17 / 15 / 14 / 12 / 9) | "File N ready documents (of M)… Not included: …" | filed exactly N; Home showed the same N every time | TRUE |
| File All Ready (empty) | "Nothing is ready to file yet" | nothing | TRUE |
| Import (graduated sender) | "16 documents auto-filed — no review needed" | 16 on disk, correct, `-DUPLICATE` | TRUE |
| Import refusal | "original scans of 18 documents you have already filed… Import it anyway?" | 18 correct; Cancel → "COULDN'T START"; Yes → imported | TRUE (frame off) |
| Send back to Review | "It stays filed until you re-confirm it" | in queue, file kept, badge recomputed at once | TRUE |
| Put back (13) | "they stay filed; nothing is changed" | 12 returned, copies kept, re-filed in place later, 0 duplicates | TRUE |
| Delete (single) | "goes to the app's recycle bin — restore from Search" | in bin, both files on disk | TRUE |
| Empty bin | "…cannot be undone. Your original scans in the Processed folder are not touched." | Output copy gone, original kept | TRUE |
| Delete permanently (single) | same sentence | cancelled; Restore all returned it | Honest |
| Reprocess N from sender / all in queue | "…doesn't file anything by itself… the sender's own auto-file once it's learned" | cancelled | Honest |
| Delete All Review (312) | "go to the recycle bin… Files on disk are kept" | cancelled | Honest |

## What genuinely worked · top friction · verdict
**Worked:** the teach. One typed teach from the worst scan in the pile and 95 s later 18 of 19 real, handwritten, stamped, header-cut worksheets carried the right sender, ticket and date — the app read "16/03/2026" where the owner's own filenames said 2008 and September, and it was right. And the safety story is finished: the original survives everything, the bin dialog says so, and the refusal on re-import even rebuilt the file I'd destroyed.
**Top friction:** the green "✓ files by itself" over a pile that won't move until I press File All Ready — it's the one thing a first-timer will sit and wait for, and this round it never came for the already-read documents, typed or drawn.
**Would I keep using this after two weeks? Yes.** 57 files, 55 filed by the app's hand or one press, not one wrong folder or wrong number, and for the first time nothing went missing and nothing needed a trick. I'd still keep a sticky note: "green badge = press File All Ready once".

## Humility
One persona, one sitting, driven by script — the typed issuer box landed on the footer again rather than the logo, so the logo-box path stayed untested; my drawn boxes were one size. "Right value" means I read the page myself (plus a machine check on the 22 Saltmarsh/Ridgeway files), not an independent source. The four header-cut copies may be excluded on purpose in ways I can't see. The "Poo" and "Dairy Wholesale" cards come from test scans; the owner's real scans produced none of that this round. I cannot change anything and didn't; everything here is for the owner to vet. Screenshots `r15_step01–57.png` and `top_*.png` in `…\chris-sandbox15\shots\`.


---

# ROUND 16 — 2026-08-22 evening (fresh install; sandbox CDP 9223 / PID 22824; the Q3 LAYOUT ARM's own round: `quiet_reread_on_layout` + `template_identity_on_page` + `fingerprint_seed_support_prune` ON; the `8c0f26b` template-file sync in the build)

# Chris The Customer — Round 16 (fresh install, sandbox CDP 9223 / PID 22824, 2026-08-22 17:31–18:32)

**Sandbox conditions:** fresh DB, isolated userData, my own copy of Demo Docs + `Doc sol\`, Output in the sandbox. Admin: **chris / plumbing2026!** (recovery code NBQF-9WZS-ZU6C-9MEA, sandbox only). Driven over CDP; native pickers substituted by setting the variable the picker sets; every native confirm captured before pressing. Teaching: **drawn boxes** for Pelican (number box deliberately on the printed words "Invoice Number") and Ridgeway; **typed** for DOCUMENT SOLUTIONS. Every value checked against the app's own records and the Output folder; suspect pages rendered and read by me; all 34 filed files machine-checked. Screenshots `r16_step01–31.png` + page crops `top_pel_*.png` in `…\chris-sandbox16\shots\`. The owner's live app (pid 1932) was never touched.

## TL;DR
1. **The new thing works, and it's the best ⊕ I've had:** fix one box in Review, press Confirm, and 9 seconds later a quiet line starts by itself — Pelican "0 of 17", Ridgeway "0 of 16" — with no "Reprocess 17" to find. It filled 17 Pelican numbers (14 right), **held every one of the three wrong ones** (a neighbour-column "PO-29444" and two P1-for-PI) behind *"Read from your new box — confirm once."*, left the Ridgeway sheet it had already asked me about alone, and cleared six of Ridgeway's seven false alarms on the way. Nothing filed itself into a wrong folder; 33 of 34 files are right.
2. **The 34th is the one the wizard filed for me:** I drew the number box on the words "Invoice Number"; the wizard read back *"Value: Invoice Number · Label: none found — I'll remember the spot instead"*, offered "Looks right →", the summary said "Invoice Number → Invoice Number", and my taught document is on disk as `Invoice.05-01-2026.Invoice-Number.pdf`. Not a word of warning at three chances.
3. **DOCUMENT SOLUTIONS went backwards.** Last round the typed teach left 17 ready; this round the same teach leaves **19 held** by "confirm once" on every date, and because this sender gets no background re-read (by design), nothing ever washes the note off: three confirms and a green "✓ files by itself" later, 18 still "need a look", 40 notes, File All Ready has nothing. The re-imported header-cut copies still come back "Couldn't match" at 22%.

## Walkthrough (exact timings)
- **A. First contact** (r16_step01–06): admin → recovery code (Continue held until ticked) → Terms → six-step setup (output pointed at the sandbox; originals line unchanged from round 15) → tour (my script took "Try a practice run" by mistake; harmless). 17:31.
- **B. Pelican** (r16_step07–19). Import `Other\IMPORT` 17:31:55 → 17:34:08, 200/200 "need your review". Cold read of 0023: issuer 69% with the "sender, not the customer" note, date **"26-01-6000"** (the number's digits read as a date, "date is in the future"), number Not found. No "Teach this document" card on the panel → Teach from the main rail. Drew the name (*"Company name: Pelican Office Interiors · Looks right"*), the date (*"05-01-2026 · Label: Date (above the value)"*), then the number box **on the label** → *"Value: Invoice Number · Label: none found — I'll remember the spot instead"* (r16_step11) → Looks right → summary *"Invoice Number | Invoice Number"* → Save 17:37:27. DONE card at 4.1 s **now counts**: *"19 from Pelican Office Interiors are waiting in Review. They were read before this layout existed, so their details fill in when they're re-read."* Quiet line at **12.2 s** ("0 of 19"), ~2 s a document, done at ~82 s. Result: 19/19 sender 95% + date 94% with *"Read from your new box — confirm once."*, **0 numbers** (the bad spot read nothing on every sibling; on the taught doc it read the label).
  Opened 0029 (page PI/26/1792) → ⊕ on Invoice Number → *"Drag to select the Invoice Number value"* → drew it → bar *"✓ Anchor (label above): Invoice Numb — P1/26/1792 · Label is ← Left ↑ Above · ✎ Draw the anchor"* (r16_step16); I typed the I over the 1, Confirm & File 17:41:15. **Quiet line by itself at 9.2 s** — *"Quietly re-reading Pelican Office Interiors documents you haven't opened, now that you've taught its layout — 0 of 17 done"* — finished 80.3 s; "18 need a look" fell to 9 as it went. **Nothing filed, no bar, through 185 s.** Records: 17/17 re-read got a number (0026, on screen, left empty). **9 with no note/flag — all nine correct on the page** (0031, 0025, 0028, 0022, 0019, 0015, 0020, 0018, 0014; each has the number printed twice). **8 held with "confirm once"**: 5 correct (0030, 0027, 0024, 0013 @50%, 0012 @50%) and **3 wrong — 0021 "PO-29444" (page PI/26/7656; the "Your PO" box next door), 0016 "P1/26/1150", 0017 "P1/25/7780"** — each shown as *"INVOICE NUMBER High · 90%"* with Confirm & File lit (r16_step18). The date notes disappeared from all 17 re-read documents. Home *"189 need your review · 9 ready to file"* = File All *"File 9 ready documents (of 198)"*. Confirmed held-correct 0030 (17:46:48) → badge *"✓ files by itself"* at 1.7 s → nothing for 100 s; confirmed 0027 (17:48:46) → nothing for 120 s; held ones kept their notes. File All Ready → *"✓ Filed 9 documents — Pelican Office Interiors (9)"*. **Disk: 13 files, all `Pelican-Office-Interiors\<year>\<month>\`, 12 numbers + 13 dates match the page; the 13th is `Invoice.05-01-2026.Invoice-Number.pdf`.** Pelican left: 7 (0026 empty + the six held, three of them wrong, none filed).
- **C. The control, DOCUMENT SOLUTIONS** (r16_step20–23). Import 17:53:23 → 17:53:46, 22/22 to Review, same cold pass as before ("DOCUMENT OLUTIONS", "Ticket Type", no type). Nudge *"This looks like a Service Worksheet… Add "Service Worksheet""* → catalog → type set. Typed teach (footer issuer again; *"Label: Ticket No. (left of the value)"*, *"Ticket Logged"*), saved 17:56:54 → line at **12.1 s, "0 of 19"**, done ~86 s. Result: 19/19 sender, 18 number + date (the header-cut 2603-1351-1 copies read right; the stamped one held *"'2605-0065' doesn't appear on this page as written"*), **but every document carries "Read from your new box — confirm once." on its date (and 9 on the number) → 0 ready** (round 15: 17 ready here). ⊕ on the stamped copy's number → *"✓ No label word sits next to this value, so Scan Finder will remember this exact spot … Read: 2605-0065-1"* (r16_step22); typed the date; Confirm 18:01:52 → a line at 9.3 s for **"0 of 1"** — the one stray "Sender not identified" copy, which then joined the group (18→19, read right, with three holds on it) — **the 18 siblings were not re-read** (rule (a) held for them). Confirmed 2605-0065-1 (18:06:38) → *"✓ files by itself"* at 1.7 s → nothing; 18 still "need a look", **40 notes**; File All Ready: nothing; Home *"206 need your review"*. Per-document Reprocess clears the notes and swaps in *"Company inferred from previously filed documents on this layout — please confirm before filing."* Held either way.
- **D. Ridgeway worksheets, drawn** (r16_step24–29). Import 18:09:45 → 18:10:23; the catalog type from C gave them numbers cold (WS-12931 @85%); nudge still *"Add "Worksheet""* though Service Worksheet exists. Drawn teach (name · *"WS-83816"* · *"27/07/2026 · Label: Date (left of the value)"*), saved 18:12:47 → line at 12.2 s, "0 of 18", **~11 s a document, done ≈3.5 min**. 10 ready, 8 flagged: 7 × *"manually mapped value differs from the usual format for this field — please verify"* (all printed exactly so) + worksheet_07 *"VS-72672 — A wider reading of this box shows 'WS-73673'… Read differently after learning — was 'WS-73673', now 'VS-72672'. Please check which is right."* No "confirm once" anywhere (these already had their numbers). ⊕ on worksheet_13 (page WS-54701) → *"✓ Anchor (label to the left):  → ws-54701"* (blank label, lower case); corrected the case, Confirm 18:19:11 → **line at 9.3 s, "0 of 16"** = 18 − the on-screen worksheet_17 − worksheet_07 (left alone, still VS-72672 with its note) → done ≈3.8 min. **"8 need a look" → 3; the six false alarms cleared; not one neighbour-column value** (every number WS-xxxxx and on its page). File All Ready → 15 filed; then *"✓ 1 document from Ridgeway Plant Hire filed by itself after your confirms… Put back"* — worksheet_17, the one that had sat on screen at 38%, filed itself once Review moved off it. **Disk 18/18 right.** Left: worksheet_07 (held, right) and worksheet_09 (84%, not offered).
- **E. Re-import `Doc sol\Processed`** (r16_step30): 18:26:30 → 18:27:23; *"This folder holds the original scans of 3 documents you have already filed… Import it anyway?"* (3 is right). Footer *"✓ 22 processed — 13 need your review before filing, 9 ready"*. **All four header-cut copies: 22%, *"Couldn't match this document to a saved layout for the supplier — please check the document type; confirming will teach this layout"*, no type, no number, no date — while their first-import twins sit two rows up at 95/90/94.** 9 carry *"Company inferred… please confirm"*; 0 filed itself; Home *"230 need your review"* (0 ready) and File All Ready offers nothing — against the footer's "9 ready".

## NEW finding cards (ranked by harm)

**1. The wizard saved a box drawn on the label and filed my document with "Invoice Number" as its number**
- Citation: *"Check what I read for Invoice Number — Value: Invoice Number · Label: none found — I'll remember the spot instead · Looks right →"*; summary *"Invoice Number | Invoice Number"*; DONE card *"Your document is filed"*; disk `Pelican-Office-Interiors\2026\January\Invoice.05-01-2026.Invoice-Number.pdf`.
- User-moment: third box of my first teach, a bit sloppy.
- Observed: I'd press "Looks right" (it's the blue button, the value looks like words about the number), and get a filed document whose reference is the field's own name, plus a spot that read nothing on 19 siblings. The app can see the value equals the field's printed label.
- Harm: trust-eroded; one wrong value filed. Class: CONFUSION.
- Direction: when the box reads the field's own label (or any printed label), say *"That's the label 'Invoice Number', not the number — draw the box round the number itself"* and don't offer "Looks right"; repeat it in the summary; never file a reference that equals a field name.
- Missing: a real hand draws worse than my script and may land half-on; this case may be rarer than it looks.

**2. For a sender that gets no background re-read, "confirm once" never comes off — the whole pile is held**
- Citation: every DOCUMENT SOLUTIONS worksheet after the teach: *"WORKSHEET DATE High · 94% — Read from your new box — confirm once."*; after three confirms: *"DOCUMENT SOLUTIONS 18 documents · 18 need a look ✓ files by itself"*; File All Ready silent; Home *"206 need your review"*.
- User-moment: the owner's real scans, the third confirm done, the badge green, 18 correct worksheets in front of me.
- Observed: I would confirm 18 by hand, or press Reprocess and get *"Company inferred… please confirm"* instead — held either way. Pelican's identical notes vanished the moment its ⊕ re-read ran; this sender is denied that re-read by its name. Last round the same teach left 17 ready and 14 filed in one press.
- Harm: slowed badly / trust-eroded (the note says "once"; I've said yes three times). Class: CONFUSION.
- Direction: a confirm of a box should clear that box's "confirm once" on the sender's other waiting documents (that's what "once" promises), without needing a re-read; or let the re-read run for a generic-named sender when the customer typed the name themselves.
- Missing: holding a two-generic-word sender harder may be deliberate; I can't see why the note should survive a confirm.

**3. "High · 90%" on a wrong number that's only there because of my box**
- Citation: Pelican 0021 *"INVOICE NUMBER High · 90% — PO-29444 — Read from your new box — confirm once."* (page: PI/26/7656; PO-29444 is the "Your PO" box beside it); 0016 *"High · 90% — P1/26/1150"*; 0017 *"High · 90% — P1/25/7780"*; Confirm & File lit green on all three.
- User-moment: working down eight held Pelican invoices, five of which are right.
- Observed: the hold itself is exactly right — none filed. But "High" beside a note that means "I'm not sure" is the round-14 "High · 84% beside wasn't read certainly enough" again; on the sixth one I'd stop reading the page and press the green button. The app also read "PO-29444" under "Your PO" on the same page and didn't say so.
- Harm: trust-eroded; a tired confirm files a wrong number. Class: CONFUSION.
- Direction: a value under "confirm once" shows "Check", not "High"; when the value also sits under a different printed label, say *"this is printed under 'Your PO' — is it the invoice number?"*
- Missing: maybe "High" describes how clearly the pixels read, which is true.

**4. Re-import still can't read a header-cut copy the app read perfectly an hour earlier — and the counts disagree about it**
- Citation: re-imported `Worksheet.31-03-2026.2603-1351-1.pdf`: *"Recognised by: Layout available: DOCUMENT SOLUTIONS"* directly above *"Couldn't match this document to a saved layout for the supplier — please check the document type; confirming will teach this layout."* at 22%, *"This document doesn't have a document type yet"*; its first-import twin two rows up: *"DOCUMENT SOLUTIONS High · 95% · 2603-1351-1 · 31-03-2026"*. Import footer *"13 need your review before filing, 9 ready"* vs Home *"230 need your review"* and File All Ready offering nothing.
- User-moment: the brief said this was fixed; I re-imported the kept originals to check.
- Harm: slowed; the same sheet gets two different answers, and the footer promises 9 that nobody will file. Class: QUESTION (NOT FIXED as far as I could drive it).
- Direction: whatever reads the twin should read this one; the footer's "ready" should use File All's test.
- Missing: the fix may need the copies to have been filed first (only 3 were); I didn't test a second re-import after filing more.

**5. "✓ files by itself" still means "the next one you scan", not the pile (round-15 card 1, unchanged)**
- Citation: *"Pelican Office Interiors 17 documents · 8 need a look ✓ files by itself"* over 9 ready for 100 s + 120 s; DONE card *"Confirm 2 more Pelican Office Interiors Invoice and the rest of their Invoice in the queue will file themselves"*; Ridgeway 15 ready, none moved; Home *"Nothing has filed by itself in the last 7 days yet"* while a Review bar says *"✓ 1 document from Ridgeway Plant Hire filed by itself after your confirms"*.
- Observed: the only document that filed itself all evening was the one Review had been sitting on when it moved away. File All Ready did the rest, correctly, every time. Harm: slowed / trust-eroded. Class: CONFUSION.
- Direction: as before — sweep the ready pile when the badge turns green, or word the badge and DONE card for what actually happens ("new scans will file themselves — File All Ready for these 9").

**6. Words on the ⊕ bar, and the seven false alarms it then cleared**
- Citation: *"✓ Anchor (label above): Invoice Numb — P1/26/1792 · Label is: ← Left ↑ Above · ✎ Draw the anchor"*; on worksheet_13 *"✓ Anchor (label to the left):  → ws-54701"* (blank label); Ridgeway after the teach: 7 × *"manually mapped value differs from the usual format for this field — please verify"* on numbers printed exactly as read.
- Observed: "Anchor" isn't a word I'd say to a colleague, "Invoice Numb" is cut off, and one bar names no label at all. The good news: the ⊕ re-read **removed six of the seven false alarms** by itself — the first time anything has. Class: PREFERENCE (words) / QUESTION (why the alarms fire on the first read and not the second).
- Direction: *"Found it: P1/26/1792, next to 'Invoice Number' — right?"*; and whatever the second read knows about these numbers, the first could know.

## Truth-table — every sentence the app said about re-reading, holding or filing
| Where | What it said | What happened | Verdict |
|---|---|---|---|
| Wizard, bad box | *"Value: Invoice Number · Label: none found — I'll remember the spot instead"* → *"Looks right →"* | spot read nothing on 19 siblings; taught doc filed with "Invoice Number" | MISLEADING — card 1 |
| DONE card (Pelican) | *"19 … are waiting in Review… their details fill in when they're re-read"* | 19 re-read in 82 s; sender + date filled; number couldn't (my box) | TRUE — and it counts now |
| DONE card | *"Confirm 2 more … and the rest … will file themselves"* | 2 more confirmed; 9 ready sat 220 s; File All did it | FALSE — card 5 |
| Quiet line (teach) | *"Quietly re-reading X documents you haven't opened, now that you've taught its layout — N of M done. Review stays fully usable."* | ran at 12 s for all three senders; the on-screen doc excluded; Review usable | TRUE |
| Quiet line (after ⊕ + Confirm) | same sentence | started by itself at 9.2 s (Pelican 17), 9.3 s (Ridgeway 16), 9.3 s (DS: 1 stray only) | TRUE — the new behaviour; wording says "taught its layout" for a box fix |
| ⊕ bar (Pelican) | *"✓ Anchor (label above): Invoice Numb — P1/26/1792"* | read P1 for PI | Honest but jargon — card 6 |
| ⊕ bar (DS stamped) | *"No label word sits next to this value, so Scan Finder will remember this exact spot … Read: 2605-0065-1"* | correct read; spot saved; siblings not re-read | TRUE |
| Hold note | *"Read from your new box — confirm once."* on 8 Pelican numbers | all 8 held incl. 3 wrong; none filed | TRUE as a hold |
| Hold note | *"…confirm once."* on 19 DS dates | three confirms later, 40 notes remain | MISLEADING ("once") — card 2 |
| Hold note, Pelican dates | *"…confirm once."* on 19 | vanished from all 17 after one confirm + re-read | TRUE (by a re-read I didn't ask for) |
| Ridgeway worksheet_07 | *"Read differently after learning — was 'WS-73673', now 'VS-72672'. Please check which is right."* | left alone by the ⊕ re-read (16 = 18 − on-screen − this) | TRUE to rule (c) |
| Group badge | *"✓ files by itself"* (Pelican, DS, Ridgeway) | 0 / 0 / 1 filed from the pile | FALSE for the pile — card 5 |
| Bar | *"✓ 1 document from Ridgeway Plant Hire filed by itself after your confirms… they stay filed; nothing is changed · Put back"* | worksheet_17, on disk, right | TRUE |
| File All dialog | *"File 9 ready documents (of 198)… Each one is filed exactly as if you confirmed it yourself."* | 9 filed, all right; same for 15 Ridgeway | TRUE |
| File All result | *"✓ Filed 9 documents — Pelican Office Interiors (9). — 39 still need a required field…; 21 have no document type detected; 127 not ready to file."* | matched the queue | TRUE |
| Home | *"189 need your review · 9 ready to file"* (= File All 9); later *"206 need your review"* (= nothing) | — | TRUE both times |
| Import footer | *"✓ 22 processed — 13 need your review before filing, 9 ready"* | Home 0 ready, File All nothing | CONTRADICTION — card 4 |
| Import refusal | *"original scans of 3 documents you have already filed… Import it anyway?"* | 3 correct; imported on Yes | TRUE |
| Re-import copy | *"Couldn't match this document to a saved layout for the supplier… confirming will teach this layout."* | twin matched at 95% | MISLEADING — card 4 |
| Reprocess (one DS doc) | — | "confirm once" cleared, *"Company inferred… please confirm before filing"* added | held either way — card 2 |
| Rule (d) | "nothing files except through self-file / File All, never a wrong folder" | 34 files: 33 correct, 1 wrong value (card 1), 0 wrong folders, 0 wrong self-files | TRUE |

## Re-verify, round-15 cards passed
1. badge green / pile never moves — **NOT FIXED** (Pelican 9, Ridgeway 15, DS). 3. "Poo" — NOT SEEN (didn't reach the credit note). 4. seven false alarms — **BETTER-BUT**: still fire on the teach read; the ⊕ re-read then cleared six. 5. offer that answers itself — NOT SEEN (no Saltmarsh this round). Also: DONE card now counts the waiting documents (r15 card 6) — FIXED; "Add 'Worksheet'" when Service Worksheet exists (r15 card 8) — still there.

## What genuinely worked · top friction · verdict
**Worked:** the ⊕ door itself. Fix one box, confirm, and nine seconds later the app re-reads the sender's pile without being asked, keeps its hands off the document it had already questioned and the one on my screen, fills 17 numbers, **holds every wrong one** (including the neighbour-column PO the brief was worried about), and on Ridgeway quietly withdraws six false alarms it had raised an hour before. Zero wrong folders across 34 files. And the DONE card finally tells me "19 are waiting".
**Top friction:** the "confirm once" note that only comes off by a re-read — so the one sender that gets no re-read (the owner's own real scans) now sits fully held after three confirms, where last round it was fully ready.
**Would I keep using this after two weeks? Yes** — the fix-one-box-and-walk-away story is real now and it never misfiled. But I'd want cards 1 and 2 looked at before I let anyone else in the office draw a box: one makes the wizard file nonsense without a murmur, the other turns "confirm once" into "confirm eighteen".

## Humility
One persona, one sitting, boxes drawn by script at one size — my Pelican number box was **deliberately** on the label, which is the worst case, not the common one. I corrected "P1"→"PI" and "ws"→"WS" by typing before each Confirm, as I would at my desk; that typed correction may have changed what the app did next. The DS ⊕ fix was on the stamped copy with a hand-typed date, so it's not a clean twin of the Pelican one. "Right" and "wrong" are my own reading of rendered pages plus a crude machine check that passes "Invoice-Number" because those words are on the page. Rounds 15's cards 3 and 5 weren't reached. The header-cut re-import was tested with only 3 worksheets filed; the fix may need more. The "confirm once" hold on a generic-named sender may be intended. I changed no code, no repo file, and nothing outside the sandbox; everything here is for the owner to vet.
