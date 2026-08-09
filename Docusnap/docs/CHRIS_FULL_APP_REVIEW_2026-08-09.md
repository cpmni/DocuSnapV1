# Chris The Customer — full-app review, 2026-08-09

## Round 3 — "Can I tell whether teaching worked?"

**Sandbox conditions.** Fresh install in an isolated instance (`scratchpad\chris-sandbox\`, CDP 9223,
PID 30840): new DB, 0 users so he got the real create-first-admin flow, terms unaccepted, output
folder unset. Corpus copied INSIDE the sandbox — 2 documents to teach (Castellan Security service
worksheet, Veltrix Automotive order confirmation) and 37 scanned siblings of those two suppliers.

**The build under test was NOT the shipped default.** The three switches from the overnight session
were armed via the launch environment: `STAGE05_REF_CODE_GATE`, `KEYWORD_GENERIC_CAPTION_EXCLUSIVE`,
`TYPE_TITLE_OWNER_PRECEDENCE`. So this round measures the FIXED build.

**The controlled contrast, which Chris was not told about.** Those two suppliers were chosen because
in the owner's own run one teach worked (Castellan: issuer/ref/date 100%) and one silently did
nothing (Veltrix: template never matched, issuer 0%). He was explicitly forbidden from reading the
code or the database to find out which — if he could not tell from the screens, that was the finding.

**Owner-verified afterwards (filesystem, not Chris's word):** his finding 1 reproduces. Of 18 filed
documents, 4 carry a visibly wrong reference or year —
`Sales-Order.18-03-2025.VyYoa1niRe.pdf`, `Sales-Order.05-02-2020.VXS986.pdf`,
`Engineer-Worksheet.26-04-2020.CJB-6347.pdf`, `Engineer-Worksheet.01-05-2026.C.JB-7957.pdf`.

**NOTHING IN THIS REPORT IS IMPLEMENTED. It queues for the owner's vet.**

---

Everything stayed inside the sandbox. Here's my report.

---

# Chris The Customer — Round 3: "Can I tell whether teaching worked?"

**TL;DR (3 lines)**
1. **Yes, there is a teach signal — three of them — but none answers the question.** One is anonymous ("1 supplier now files automatically"), one is unreadable (sender names render as a single character), and the per-document badge says "Taught positions" identically on documents where teaching demonstrably failed.
2. **What actually told me the difference was the per-document summary** — "Nothing was flagged" (Veltrix) vs "Needs a quick check" (Castellan). That's honest and it works.
3. **The serious harm is elsewhere:** three documents were filed with values that are visibly wrong on the page, all marked "High · 90%", none flagged. One 2026 document is now in a `2020/` folder.

---

## Walkthrough

**First contact** (`01-signin` → `10-tour`). Account creation explains itself ("There are no default credentials — you choose everything below"). The recovery-code screen is gated behind a tick and is honest: *"This code works once. Using it generates a brand-new code and immediately invalidates this one."* The onboarding privacy card — *"Everything stays on this computer. Scan Finder works fully offline — your documents are never uploaded or sent anywhere"* — is the best line in the product. The 6-card tour set my expectation precisely: *"You teach it once. Next time a document from that supplier comes in, it knows exactly where to look."* That is the promise I then tested.

**Teach #1 — Castellan** (`12-teach1` → `20-done`). Wizard intro is honest: *"Nothing is saved until the very end — you can go back at any point."* I built a new "Engineer Worksheet" type; it auto-guessed my field types (Job Ref → Reference number, Customer → Text), which saved me real decisions. Drawing was excellent: every box came back with a live read and an auto-found label — *"Value: CJB-9791 · Label: JOB SHEET NO (left of the value)"*, and it even got the direction right on Customer (*"above the value"*). Five of five perfect.

**Teach #2 — Veltrix** (`21-cantread`, `22-wrongread`). "Teach another document" did exactly what its subtitle promised. But the white-on-orange letterhead read back **"~ Neltrix Automotive Parts"** with only *Looks right →* and *Redraw value* offered (finding 5).

**Import 37** (`23`–`24`). "37 processed of 37 found · 37 OK · 0 Errors". 17 rows showed a green **"Filed"** pill. My output folder contained **two** files — the two I'd taught (finding 2).

**Review** (`25`–`32`). Groups: `'` 18 docs · 5 need a look / (blank) 17 docs · **15** need a look / `4` 1 doc / `V` 1 doc. That 5-of-18 vs 15-of-17 split is exactly the answer I wanted — and I could not read whose it was (finding 3). Opening documents, Veltrix said *"Nothing was flagged — this was read at 87%, below the 100% you've set for filing without a check"*; Castellan said *"Needs a quick check — 1 field was read with low confidence, and 2 fields were flagged by a formatting check."* On screen I could see why: this Castellan sibling prints **"WORKSHEET NO"** and **"INVOICE TO"** where my taught sample printed "JOB SHEET NO" and "CUSTOMER". The Customer field had grabbed **"signature:"**.

**Scary buttons** (`36`, `38`, `41`). All pressed for real. Delete → restore verified end to end. File All Ready filed 15 in one click. Delete All Review binned 21 and I restored nothing back — everything it promised held.

---

## Finding cards (8, ranked by harm)

### 1. Visibly wrong values pass every check and get baked into the filename and the folder
**Citation (verbatim):** Review panel — `REFERENCE NUMBER  High · 90%` / `C.JB-7957`; document banner `Nothing was flagged — this was read at 87%…`. On disk: `Output/Veltrix-Automotive-Parts/2025/March/Sales-Order.18-03-2025.VyYoa1niRe.pdf` and `Output/Castellan-Security-Systems/2020/April/Engineer-Worksheet.26-04-2020.CJB-6347.pdf`.
**User-moment:** I pressed File All Ready trusting "0 Errors" and "Nothing was flagged".
**Observed confusion:** Three verified against the page (`39-gibberish`, `40-c2020`, `40-v2020`): page says **Order Ref VXS10186** → filed `VyYoa1niRe`; page says **Order Ref VXS98624 / Date 05-02-2026** → filed `VXS986` and `05-02-2020`; page says **DATE 26-04-2026** → filed into `2020/April`. None was flagged. `VyYoa1niRe` is not a shape any reference number takes.
**Harm + severity:** trust-eroded, high. My 2026 paperwork is in a 2020 folder; browsing by year fails. **Mitigation I verified and want credited:** Search *does* find it — typing the real `VXS10186` returns the document, because Search is full-text. So retrieval survives; the shelf label is what's wrong.
**Class:** CONFUSION.
**Proposed alternative:** two cheap gates before a value reaches a filename — (a) a reference that mixes upper/lower case mid-token, or has no run of ≥3 digits, gets "this doesn't look like a reference number — please check"; (b) a date whose year differs from every other document from that sender by >2 years gets "read as 2020 — the rest from this sender are 2025–2026". Both as review flags, not as auto-corrections.
**What I may be missing:** these may be deliberately-degraded test scans, and real customer scans might not produce reads this poor.

### 2. The Import screen says "Filed" for documents that are not in my filing folder
**Citation (verbatim):** PROCESSED DOCUMENTS table, STATUS column, green pill `Filed` on 17 rows. Same screen, bottom bar: `FINISHED ✓ 37 processed — 20 need your review before filing, 17 ready`. Nav badge: `Review 37`.
**User-moment:** Scanning the results table to see what still needed me.
**Observed confusion:** I read 17 green "Filed" and concluded 17 were done and in my folder. My output folder held 2 files, and Review said all 37 were waiting. The bottom bar's word — **"ready"** — is the accurate one; the column contradicts it on the same screen.
**Harm + severity:** trust-eroded, high — this is the "where's my paper?" invariant.
**Class:** CONFUSION.
**Proposed alternative:** change the pill to **`Ready to file`** (and keep `Confirm to file →` for the others). Reserve `Filed` for documents actually written to the output folder.
**What I may be missing:** "Filed" may be intended as shorthand for "will file without you", which is defensible — but nothing on the screen says so.

### 3. "Grouped by sender" shows one character instead of the sender's name
**Citation (verbatim):** Review left panel, four rows read `' 18 documents · 5 need a look`, `17 documents · 15 need a look` (no name at all), `4 1 document · 1 needs a look`, `V 1 document · 1 needs a look`. (`26-groupzoom`.) The full names *are* in the app — the second group is "Castellan Security Systems".
**User-moment:** Comparing my two taught suppliers to see which teach had worked.
**Observed confusion:** I dragged the panel splitter 260px wider expecting the names to appear; they didn't (`28-widezoom`). The 5-of-18 vs 15-of-17 contrast is the single best answer to "did my teaching work", and it is unattributable.
**Harm + severity:** slowed → blocked for the mission question; high.
**Class:** CONFUSION.
**Proposed alternative:** show the sender name on its own line above the counts, ellipsised if long, with the full name as a tooltip.
**What I may be missing:** this may be specific to my window size or a theme; I only tested one maximised window.

### 4. "This isn't on this document" is immediately contradicted by "All fields captured"
**Citation (verbatim):** Button `This isn't on this document`. Immediately after pressing it: header `Teaching complete / Ready to review / All fields captured — choose Review → below to save this document type.` and sidebar `DETAILS — 6 OF 6 DONE`. (`18-6of6`.)
**User-moment:** Telling the app that Purchase Order Number genuinely isn't printed on this page.
**Observed confusion:** I told it one field was absent and it replied that all six were captured and six of six were done. There *is* an amber dot on that field instead of green — but there's no legend for it, and the only colour key on screen (`▮ value (what I read)` / `▮ label (what I look for)`) is a different code entirely.
**Harm + severity:** trust-eroded, medium — I'd doubt whether the button registered.
**Class:** CONFUSION.
**Proposed alternative:** counter reads `5 OF 6 CAPTURED · 1 NOT ON THIS PAGE`; banner reads *"Ready to review — 5 fields captured, 1 marked as not on this page."* Add a one-line key beside the dots: `● captured  ● not on this page`.
**What I may be missing:** the amber dot may be obvious to someone who uses the wizard daily.

**Verdict on the two controls under test:**
- **"Teach another document"** — **passes cleanly.** The subtitle *"Starts again at the document list. This one is already filed."* told me both what it would do and that my work was safe, before I clicked. It then did exactly that. Nothing to change.
- **"This isn't on this document"** — **findable: yes.** It's a full-width bordered button in the sidebar, visible without scrolling, with a genuinely good reason underneath: *"Use that rather than pointing at something else — a box round the wrong value teaches the wrong value to every document from this sender."* **Does the wording tell me what it does: no.** It states what I'm asserting, not the consequence. I only learned the consequence two screens later, on the review list: `Purchase Order Number — you'll fill this in when reviewing`. Two smaller notes: the blue instruction banner at the top only ever says "draw a box", so it never offers the not-present option; and "this document" is ambiguous when what I'm actually teaching is a layout for all future documents from this sender.

### 5. A *wrong* read gives me no way to type the correction — only a *failed* read does
**Citation (verbatim):** With a large box: `Value: ~ Neltrix Automotive Parts` and only `Looks right →` (blue primary) and `Redraw value`. With a tighter box: `Couldn't read that clearly. Try a bigger box, or type the value:` plus a text box and `Use this`. (`21-cantread`, `22-wrongread`.)
**User-moment:** Teaching the Veltrix company name off a white-on-orange banner.
**Observed confusion:** The escape hatch is attached to the harmless failure and withheld from the dangerous one. Facing "~ Neltrix Automotive Parts" my choices were accept a misspelling that becomes my supplier folder forever, or redraw and hope. I reached the typing box by accident — by drawing *smaller*, which the on-screen advice ("Try a bigger box") tells you not to do.
**Harm + severity:** blocked, high — one careless click on a button labelled "Looks right →" mislearns the supplier.
**Class:** CONFUSION.
**Proposed alternative:** show the same `or type the value:` box on the confirm step too, under the read-back — always available, never pre-filled over a good read.
**What I may be missing:** a coloured letterhead may be an unusually hard case, and most letterheads are dark-on-white.

### 6. "File All Ready" never says how many — the delete beside it does
**Citation (verbatim):** `File all ready documents in the Review queue?` / *"Every document with its type and required fields filled in will be filed, exactly as if you confirmed it one by one. Documents still missing required details are left in the queue for you to review."* Compare, same app: `Delete ALL 21 document(s) in the Review queue?` / *"They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected."*
**User-moment:** About to file an unknown number of documents in one click.
**Observed confusion:** I pressed OK not knowing whether it meant 3 or 30. It filed 15. The rule it states is good; the scale and the reversibility are both missing — and the button next to it proves the team knows how to say both.
**Harm + severity:** trust-eroded, medium.
**Class:** QUESTION.
**Proposed alternative:** `File all 15 ready documents in the Review queue?` and add one sentence: *"Filed documents move to your output folder; you can send one back from Settings → Learning Repair."* (I'm not asking for the confirm to be softened — I want it to say more.)
**What I may be missing:** the count may be hard to compute before the run starts.

### 7. Home says "1 supplier now files automatically" but not which one
**Citation (verbatim):** Home → GETTING SMARTER card: `1 supplier now files automatically · learned 2 layouts.` `Accuracy improves every time you confirm a document.`
**User-moment:** Wanting one glance that says whether both my teaches took.
**Observed confusion:** This is the closest thing in the product to the answer — it correctly knows one of my two suppliers is working and one isn't. It won't tell me which, so I can't act on it. "learned 2 layouts" also reads as success, which pulls the opposite way.
**Harm + severity:** slowed, medium.
**Class:** PREFERENCE.
**Proposed alternative:** name them — *"Veltrix Automotive Parts files automatically. Castellan Security Systems still needs checking — see Review."* with the second name linking into that sender's queue.
**What I may be missing:** with fifty suppliers a list would be unwieldy; maybe only the ones needing attention should be named.

### 8. The fixed-value hint reuses "(e.g. the company name)" for every field
**Citation (verbatim):** On the Reference number step: `If the Reference number never changes (e.g. the company name), you don't need to draw a box — just type it once.` On the last step: `If the Purchase Order Number never changes (e.g. the company name)…`
**User-moment:** Reading the blue "Always the same on every document?" bar on each field.
**Observed confusion:** The field name is substituted but the example isn't. A reference number changes on every document by definition — this sentence invites a new user to pin their invoice number as a fixed value, which would stamp one number onto every document from that supplier.
**Harm + severity:** cosmetic in appearance, potentially serious in effect; medium.
**Class:** CONFUSION.
**Proposed alternative:** show the bar only for text-type fields, and drop the parenthetical when the field isn't the issuer: *"If the Purchase Order Number is the same on every document from this sender, you can type it once instead of drawing a box."*
**What I may be missing:** most people probably skip past this bar entirely.

---

## Smaller notes (one line each, no card)
- Recovery-code screen says *"Write it down or print it"* — there is no copy, print, or save button; the only button is "Continue to ScanFinder".
- The filename builder shows four blocks (`Type . Date . Reference . Title`) but the preview renders three, and every real filename came out with three.
- Right after a successful run the Import screen shows *"No documents found directly in this folder — pick the folder that contains the scans (PDFs or images)"* beside *"37 OK · 0 Errors"* — it reads as an error about the folder I just used successfully.
- Product name alternates: "Welcome to ScanFinder" (sign-in) vs "Welcome to Scan Finder" (setup); window titles do both.
- Choosing a built-in type in the teach wizard offers no "Also appears as" box — my page said **ORDER CONFIRMATION** and I had no way to record that while looking straight at it.
- Red dots sit beside fields reading `High · 94%` with no legend; the ⊕ repair turned a dot green while the badge still read `Low · 35%` and the value was still wrong ("Sceblewood Joinery Ltd").
- Once filed, originals leave the "Processed" folder (37 → 21), though onboarding says they're moved there *"so you can always find them again"*. They're in the output folder, not lost — but not where I was told to look.
- Warning copy under fields uses a code-style font and lowercase openings: `manually mapped value differs from the usual format for this field — please verify`. I never "mapped" anything — I drew a box.

**Previously reported — verify:** *"1 field that were"* grammar bug — **FIXED.** I now see `1 field was read with low confidence, and 2 fields were flagged by a formatting check` and `1 field was flagged by a formatting check`, correct in both directions.

---

## Warnings truth-table

| Warning | Claim | Verdict |
|---|---|---|
| Delete one document | *"It goes to the app's recycle bin — you can restore it from Search."* | **TRUE** — found in bin, restored, Review 35→36 |
| Delete All Review | *"Delete ALL 21 document(s)"* | **TRUE** — bin then held exactly 21 |
| Delete All Review | *"restore them any time from Search → Show the recycle bin"* | **TRUE** |
| Delete All Review | *"Files on disk are kept."* | **TRUE** — output stayed 18, originals stayed 21 |
| Delete All Review | *"Confirmed and deferred documents are NOT affected."* | **TRUE** |
| File All Ready | *"Every document with its type and required fields filled in will be filed"* | **TRUE** — 15 filed |
| File All Ready | how many will be filed | **MISSING** — no count given |
| Split PDF | *"This document is only one page — there's nothing to split."* | **TRUE** |
| Teach intro | *"Nothing is saved until the very end"* | **TRUE** — Back/Cancel were safe throughout |
| Teach done | *"Starts again at the document list. This one is already filed."* | **TRUE** |
| Teach, after skipping a field | *"All fields captured"* | **FALSE** — five captured, one declared absent |
| Import table | green `Filed` pill | **FALSE** — none of them were in my output folder |

*(Method note, from my last round's lesson: I confirmed no dialog was being silently swallowed. Every native dialog was photographed before acceptance, and one "empty recycle bin" reading turned out to be a stale window — re-navigating showed 21. I did not report that as a broken promise.)*

---

## What genuinely worked

The **teach wizard's read-back**. Every box came back with the value *and* the label it had found on its own — *"Value: CJB-9791 · Label: JOB SHEET NO (left of the value)"*, *"Label: CUSTOMER (above the value)"*. I never had to point out a label, and it got the direction right unprompted. That is automation showing its work, and it's the reason I trusted the wizard.

Close seconds: the **Delete All warning** (count, destination, restore path, what's untouched — all four, all true); the honest **per-document summary** that genuinely distinguished my two suppliers; the **filing shelf** landing exactly as promised (`Castellan-Security-Systems/2026/May/Engineer-Worksheet.06-05-2026.CJB-9791.pdf`); and **full-text Search**, which found a document by its real order number even though the stored reference was gibberish — that quietly saved finding 1 from being a disaster.

## Top friction point

**After teaching two suppliers, I could not tell which one had worked.** The information exists in three places and each one fails differently: Home knows the answer but won't name the supplier; the Review sender groups show the answer but render as `'` and `V`; and the per-document badge says *"Fields read by: Taught positions · 5 taught fields"* identically on a document whose Customer field had read "signature:". A badge that says teaching was *applied* reads, to me, as teaching *worked*.

## Would I still be using this in a fortnight?

**Yes — but with my auto-file setting left exactly where it is.**

Yes, because the parts that decide whether I keep a tool are right: I taught it a document type it had never seen, in about four minutes, without understanding anything about how it works, and it started reading my paperwork. The filing came out looking like a filing cabinet. The destructive buttons told me the truth every single time I tested them, and I could undo everything. Nothing left my machine.

The caveat is finding 1. The Veltrix screen invited me to *"lower the auto-file bar in Settings → Processing"* — and if I'd taken that advice, `VXS10186` filed as `VyYoa1niRe` and a 2026 worksheet sitting in a `2020` folder would have happened silently, with no review step where I could catch them. So I'd keep using it, and I'd keep checking every document, which is roughly half the value I was sold. Fix the "Filed" label and put a sanity check on references and years before they reach a filename, and I'd raise the bar and stop checking.

## What I may be missing (overall)

I'm one person, on one machine, with 39 documents from two synthetic suppliers, in one maximised window on a light theme. Both suppliers happened to vary their printed labels between documents ("JOB SHEET NO"/"WORKSHEET NO", "CUSTOMER"/"INVOICE TO", "Sales Order No"/"Order Ref") — if that's unusual in real paperwork, my central finding is much rarer than I've made it sound. I can't tell whether the bad reads are the software or deliberately rough test scans. I never opened Settings, so remedies the app offers there are invisible in this report. And I drove the app through a script rather than a mouse, so anything that depends on hover, focus, or timing may behave differently for a real pair of hands.
