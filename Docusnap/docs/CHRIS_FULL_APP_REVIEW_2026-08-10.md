# Chris The Customer — full app vet, 2026-08-10 (overnight round)

**Sandbox conditions.** A fresh install (own userData, own output folder, own admin account created
through the real first-run flow), seeded with the owner's own taught state — 7 supplier templates —
and then 200 scanned documents imported through the app's normal processing path. Nothing was
confirmed before Chris started, so he met the app at the "morning after the first big batch" moment.
He had full destructive freedom inside the sandbox and touched nothing outside it. **Nothing in this
report has been implemented. It is queued for the owner's vet.**

**Independent corroboration of his finding 1.** While Chris was working, the main session found the
same defect from the other end — in the database. One ordinary confirm of a Quillstone purchase
order created template 12 with `supplier_name` frozen to `'Quillstone Print & Packaging'`
(`is_variable = 0`) from that single document; that template then matched **Oakhaven Electrical
delivery notes** — a different company and a different document type — and stamped the wrong company
at confidence 95 via `template_fixed`. Chris found it by looking at the screen; the harness found it
by scoring the corpus. Two independent routes, same defect.

---

## TL;DR (his words)

1. I taught the app one company's name on one page. It then put that company's name on **18
   documents from a different company**, at 95%, with no warning — and I have proof one of them is
   now filed in the wrong company's folder.
2. The queue told me 200 documents needed me when 43 did; the real reason (a setting sat at 100%) is
   explained beautifully, but only after you click into a document, one at a time.
3. The teaching wizard and the filing itself are genuinely excellent — better than anything I
   expected. That's what makes finding #1 hurt.

---

## The 8 findings, worst first

### 1. Teaching one supplier put that supplier's name on another company's documents — and filed one in the wrong folder
- **Citation (verbatim):** Review panel on `Oakhaven-Electrical_delivery_note_0023.pdf` — page
  heading reads **"Oakhaven Electrical Wholesale"**; panel reads **"DOCUMENT ISSUER · High · 95% ·
  Quillstone Print & Packaging"**, **"Recognised by: Its logo and wording"**. Only warning shown:
  *"Needs a quick check — 1 field was flagged by a formatting check."*
- **User-moment:** I'd taught one Quillstone purchase order and pressed "Reprocess all in queue" to
  make it stick.
- **Observed confusion:** The Quillstone group jumped from 19 documents to **37**. The extra 18 are
  Oakhaven Electrical delivery notes. One Castellan group also gained an Oakhaven note. I confirmed
  one exactly as any user would — the account number *was* right — and it is now at
  `Output/Quillstone-Print-&-Packaging/2025/January/Delivery-Note.13-01-2025.OED26662.pdf`. The
  saved record contains `<SupplierName>Quillstone Print & Packaging</SupplierName>` next to
  `<VatNo>GB 660 1173 45</VatNo>` — Oakhaven's own VAT number, which it read correctly off
  Oakhaven's letterhead.
- **The bit that worries me most:** the only thing keeping the other 18 out of the wrong folder is
  an unrelated grumble about a slash in "OED/26662". Nothing anywhere says the company might be
  wrong. Clear that punctuation flag and they all go.
- **Harm + severity:** trust-eroded → **document misfiled silently. Highest.** This is the thing I'd
  stop using the app over.
- **Proposed alternative:** When a company name arrives from something learned elsewhere rather than
  from this page, and the page carries a different company name or VAT number, hold the document and
  say so: *"This looks like it's from Oakhaven Electrical Wholesale, but I've filled in Quillstone
  Print & Packaging from a layout I learned. Please confirm who sent this."*
- **What I may be missing:** I can't tell whether my teaching caused this or whether reprocessing
  would have done it anyway. All I can say is the sequence: before I taught, all 59 were "Sender not
  identified"; after teaching one and reprocessing, 18 of another company's documents were labelled
  Quillstone at 95%.

### 2. "Reprocess all in queue" changes every document with no warning; the one-document version warns
- **Citation (verbatim):** `▶▶ Reprocess` (one document) → *"Reprocessing re-reads this document
  with the latest learned data and REPLACES the fields on screen — your unsaved edits and type
  choice for this document will be lost. Continue?"* · `Reprocess all in queue` → **no dialog, no
  tooltip, no text of any kind.** It simply starts.
- **Observed confusion:** I expected the button affecting 197 documents to warn me at least as much
  as the one affecting 1. It warned me less — it warned me not at all. It's also the only route I
  found to apply teaching to documents already in the queue, so I'd press it often.
- **Harm + severity:** trust-eroded / work lost. **High.**
- **Proposed alternative:** Same words as the single version, with the count: *"Re-read all 197
  documents in the queue with the latest learned data? This replaces the fields on screen — any
  edits you haven't confirmed will be lost."*

### 3. The queue says 200 need me when 43 do, and the reason is only visible one document at a time
- **Citation (verbatim):** Home — *"NEEDS YOUR ATTENTION / 200 waiting in the review queue"*. Review
  groups — *"20 documents · 11 need a look"*. Inside one document — *"Nothing was flagged — this was
  read at 95%, just below the 100% you've set for filing without a check, so it's waiting for you."*
- **Observed confusion:** 200 is a day I haven't got. I'd have gone back to the folders before
  finding out that 157 of them were only there because of one setting.
- **Harm + severity:** slowed / abandonment risk. **High.**
- **Proposed alternative:** Put it on Home and on the queue header: *"43 documents need a look. The
  other 157 read cleanly and are waiting only because filing without a check is set to 100%."*

### 4. The tour and Home promise automatic filing that the default setting prevents
- **Citation (verbatim):** Tour card 5 — *"Documents it's fully confident about file themselves
  automatically."* Home — *"7 suppliers now file automatically."* Review — *"Read at 95% · your
  setting 100%"*.
- **Observed confusion:** I was told twice that documents file themselves. In 200 documents, not one
  did. My documents read 93–95%; the bar is 100%.
- **Harm + severity:** trust-eroded. **High** — this is the product's main promise.

### 5. 53 switches on one settings page, 37 of them switched ON under text reading "Off by default"
- **Citation (verbatim):** Settings → Processing, a switch visibly **blue and on** beneath a
  description ending **"Off by default."** 37 of the 53 switches are in that state.
- **Observed confusion:** Two problems. First, "Off by default" beside a switch that is on — I read
  that as a statement about *my* setting. Second, the page is about 4,500 words and reads as a list
  of thirteen different ways the app is known to misread my paperwork, each with a worked example of
  the wrong answer. Four of them say the same thing to my ear. I would not dare touch any of them,
  and I'd trust the app less for having read the list.
- **Harm + severity:** trust-eroded; the one setting I actually need (the filing bar) is lost in it.
  **High.**
- **Proposed alternative:** Put the four or five settings a customer can act on — filing bar,
  auto-rotate, wrap-around lines, auto-import — on the Processing page. Move the rest behind an
  "Advanced reading adjustments" expander, collapsed, with one honest line. And drop "Off by
  default" from the description; show the state on the switch, not in the prose.

### 6. Confirming a document never tells me where it went
- **Citation:** After `✓ Confirm & File`, the only change is the counter: *"Review 200"* → *"Review
  199"*. No message appears.
- **Observed confusion:** The document vanishes from the list. I had to open Windows Explorer to
  satisfy myself it existed. It did, in exactly the right place — but "did it save it?" is the
  question I'd ask 200 times, and the app answers it zero times.
- **Harm + severity:** trust-eroded; slows every document. **Medium-high.**
- **Proposed alternative:** A brief line where the document was: *"Filed to Castellan Security
  Systems ▸ 2026 ▸ April — Open folder"*.

### 7. Red dots on fields that are reading perfectly, meaning "you haven't taught this"
- **Citation (verbatim):** Six of seven fields carry a red dot. Hover: *"Not taught for this document
  type yet"*. The panel above says: *"Teach a field — only if it's showing the wrong value."* The
  header chip says *"3 taught fields"*.
- **Observed confusion:** Red means broken to me. I counted six red dots on a document whose every
  value was correct. And I can't reconcile "3 taught fields" with seven dots saying "not taught".
- **Harm + severity:** slowed; flags stop meaning anything. **Medium.**
- **Proposed alternative:** Don't use the error colour for it. Save red for "check this".

### 8. I can destroy 60 documents in two clicks; putting them back is one at a time
- **Citation (verbatim):** *"Delete ALL 60 document(s)… you can restore them any time from Search →
  Show the recycle bin."* In the bin: **"Empty bin"**, "Restore from recycle bin", "Delete
  permanently". There is no "Restore all".
- **Observed confusion:** The way back exists and I verified it — but deleting all 60 was two clicks
  and restoring 60 is sixty.
- **Harm + severity:** trust-eroded; recovery cost. **Medium.**
- **Proposed alternative:** A "Restore all" button beside "Empty bin".

---

## Warnings truth-table

| Button | Warned? | Told the truth? | Said how many? | Way back, on that screen? |
|---|---|---|---|---|
| Confirm & File (one) | No | — | — | Not mentioned |
| **Reprocess all in queue** | **No — none at all** | — | No | No |
| Reprocess (one document) | Yes | **Yes** — my typed edit was wiped, exactly as stated | n/a | No, but plainly stated |
| File All Ready | Yes | Yes | **No** | Not mentioned |
| Delete (one document) | Yes | **Yes** — names the file, the bin, and the route back | n/a | **Yes** ✓ tested |
| Delete All Review | Yes | **Yes** — best in the app | **Yes ("ALL 60")** | Yes ✓ verified |
| Empty bin | Yes | **Yes** — *"including their PDF files… cannot be undone"* | **Yes (60)** | Correctly says there isn't one |
| Defer | No dialog needed | Tooltip is exact | n/a | Yes |
| Split PDF | Refused politely | Yes | n/a | n/a |

> The pattern: **the buttons that sound frightening are handled beautifully. The buttons that sound
> harmless — "Reprocess all in queue", "File All Ready" — are the ones that changed 197 documents
> and filed 134 without telling me how many.**

---

## Smaller things I'd mention over a cup of tea

- Four different names for the same state: *"Sender not identified"* / *"Not yet identified"* /
  *"Unknown issuer"* / *"Unknown Company"*. I assumed they were four different problems.
- After I filled in the company name, the blue box still read *"The Document Issuer box is still
  empty"* with the name sitting in the box beneath it.
- The flagged field was the last one, hidden below the buttons, while the banner about it was at the
  top. Nothing scrolled me to it.
- I typed a value in by hand and the app still showed *"Low · 35%"* beside it.
- In search results, confirmed documents show reference and date; unconfirmed ones show only the
  supplier and type, so 196 rows looked identical.
- The teach picker lists all 197 documents with no way to search them.
- The wizard's opening screen says I'll *"mark the printed label next to it"* for every field. In
  practice it found every label itself. It's promising more work than it does.
- The wizard is called "Teach a new document" and its last button says "File this document" — no
  mention of the teaching being saved.
- `Reprocess` and `Skip` are the only buttons with no tooltip at all.
- Once I confirmed a document, its supplier group jumped down the queue list — my pile moved while I
  was working through it.

---

## Decision count, one routine document

A clean one: open it, glance, **1 click**. Well inside budget and genuinely good.
A flagged one: **4–6**, most of it spent locating the problem rather than solving it.

## What genuinely worked

**The teaching wizard, start to finish.** Pick the document from real thumbnails, pick the type from
plain cards, draw a box, and it reads the value *and* finds the printed label and shows me both
before saving anything. `HTS-SO-39116`, `Bramblewood Joinery Ltd`, `£532.50` — all perfect first
time. It warned me honestly that a box round the wrong value teaches the wrong value to every
document from that sender. And it ended by telling me what to expect next instead of pretending it
was finished. I'd hand that wizard to anyone in my office.

**And the filing itself.** `Castellan-Security-Systems / 2026 / April /
Service-Worksheet.12-04-2026.CJB-8105.pdf`. That is my filing cabinet, rebuilt.

## Top friction

Not any single screen — it's that **the app's confidence doesn't track its correctness**. It said
95% and "recognised by its logo and wording" about a company name it had taken from a different
company's document, on a page with the right company's name printed across the top in 24-point type.
Everywhere else this product is admirably honest about what it doesn't know. On the one field that
decides which folder my paper lands in, it was certain and wrong.

## Would I keep using this after two weeks?

**Yes — but only after finding 1 is fixed.** The teaching, the filing, the search and the writing are
better than anything I'd expect from a small program, and the destructive buttons are more honest
than most software I've paid for. But I'd have found those 18 Oakhaven delivery notes in
Quillstone's folder in about six weeks, when the accountant rang, and at that point I wouldn't trust
a single folder in that output tree. One silently misfiled document costs more trust than a hundred
correctly filed ones earn.

## What he may be missing (his standing note)

> I'm one simulated customer, not a user test — nobody "found" anything here but me. I walked into
> someone else's half-taught state with 200 unconfirmed documents, which is a harsher start than a
> real customer choosing their own first batch. I drove the app through a script, so I may have
> clicked things faster or in stranger orders than a person would, and I misread the ⊕ button as
> broken before checking properly. I can describe what I saw on screen and what appeared in the
> output folder; I can't tell you why the app decided Oakhaven was Quillstone, and I haven't tried.
> Everything above is a suggestion for you to vet — I've changed no code, no copy and no setting
> outside the sandbox.
