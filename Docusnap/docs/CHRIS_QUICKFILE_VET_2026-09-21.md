# Chris The Customer — Quick File vet (daycare admin)
**Date:** 2026-09-21 · **Sandbox:** CDP 9223 (OwnerPid 3680) · **Reviewer:** Chris Fenton (one simulated non-technical persona — a daycare administrator, NOT a user test)

I run a daycare. I have a stack of children's paperwork — consent forms, medical notes, registration, emergency contacts — and I want to file each under the right child and find it again when a parent or inspector rings. I drove the live sandbox app and screenshotted each step. I only report what I actually saw or did.

---

## TL;DR (three lines)
1. **The auto-fill — the whole reason to keep a list of children — never appears.** Typing a child's name in Quick File shows no suggestions and fills nothing; setting the list up in Settings shows boxes labelled "undefined".
2. **"Document Issuer / Company / Person" is required on a child's record and decides the folder** — a daycare admin won't know what to put there, and the child's own name is *optional*.
3. **Filing itself is genuinely good:** fast, a tidy folder per child, searchable a moment later, with an honest "typed, not reviewed" note and a truthful recycle-bin delete.

---

## Walkthrough (with screenshots)

- **step01–02 — Create admin + recovery code.** "Create the administrator account" was clear, no jargon. The recovery-code screen ("Save your admin recovery code… It will not be shown again") kept **Continue greyed until I ticked "I have saved this code somewhere safe."** Good, honest gate.
- **step03 — Terms.** Standard. "Accept & Continue" greyed until I ticked the box. Fine.
- **step04 — Setup wizard.** Friendly. "Everything stays on this computer… never uploaded or sent anywhere" — exactly the reassurance I want for children's data. I set the filing folder to the sandbox Output.
- **step05 — Welcome tour (6 cards).** Every card talks about **invoices, orders, notes, suppliers, reference numbers, totals** and the scan-and-Review flow. Nothing about Quick File or filing a document under a *person*. The last card offers "Import my documents" / "Try a practice run" — again no mention of the way a daycare would actually work. Not wrong, but it's not my world.
- **step06 — Home.** Clean. **"Quick File" is in the left menu with a sparkle icon** (findable). "Where your files go" correctly showed my sandbox folder. A green "Local only" badge sits bottom-left — reassuring. Note: the "Finish setting up" checklist and the big cards all push me toward *Import / "Process your first batch"* (the scan path), not Quick File.
- **step07–08 — Settings → Document Types.** New **folder tabs "All types / Scanned (OCR) / Quick File"**. Child Record is listed as *custom · Quick File · 7 fields*. The **"How is this type filed?"** control reads "Scanned — the software reads it (OCR)" / "Quick File — you type the details, no scanning" / "Both". The plain-English half is good; the "(OCR)" is jargon. Child Record's locked fields are **Document Issuer** and **Date** (both **required**), while Child name, DOB, address, medical notes, guardian are all **optional**.
- **step09 — Added a custom field "Allergies"** to Child Record. Instant, easy, no save button needed. 
- **step10–11 — Records list admin (embedded in the type).** "Auto-fill from a Records list… When someone types the first few letters, the rest of the details fill in automatically." The "Children (5 records)" list is bound and lists the 5 kids. **But every column-match dropdown is blank, and clicking "+ Add" opened a new-child form whose four boxes are all labelled "undefined".** I can't tell which box is the name, DOB, address, or guardian. I did **not** open the CSV/Excel import (it opens a Windows file box I shouldn't drive), but from the flow it matches your file's headers and offers add/replace — it would show the same "undefined" column names.
- **step12 — Quick File screen.** "File a document that needs no scanning… No OCR, no teaching." Fields: **COMPANY / PERSON** (placeholder "Company or person"), Date (today, pre-filled), Reference, Notes, **Child name**, Date of birth, Home address, Medical notes, Guardian, and my new **Allergies** field. My new field flowed straight through — nice.
- **step14–15 — Typed "ava" into CHILD NAME → nothing.** No suggestion list, no fill of DOB/address/guardian. I tried several times, including re-opening Quick File fresh.
- **Filed the consent form** (I filed through the app's own filing step). It landed at `…/Ava-Thompson/2026/September/Child-Record.21-09-2026.Consent-form-—-Ava-Thompson.pdf` with a metadata sidecar — **a folder per child**.
- **Filed the other three** each under its own child — Liam-Doherty, Noah-Kelly, and Emma-Byrne (a child not on the list — typed by hand; the .png filed fine). Every one landed in its **own** child's folder — no mixing.
- **step16–17 — Search "Liam".** Found instantly: "Liam Doherty · Confirmed · 21-09-2026 · Child Record". Opening it shows all the details and an honest note: **"Quick Filed — typed details, not reviewed. To change it, delete and Quick File it again."** The preview showed the actual attached PDF (see note below).
- **Delete** → native confirm **"Move this document to the recycle bin? You can restore it later."** Truthful and recoverable.

> Note on the Liam preview: the record's details read correctly (Liam / medical notes / DOB / guardian), but the **preview showed a "Copperfield Electrical Delivery Docket"** — because the sandbox's `medical-notes-liam.pdf` fixture actually *contains* a delivery docket. That's test data, not a Quick File fault — and it usefully proves the preview shows the **real attached file**, which is the safety check a daycare needs.

---

## Findings (ranked by harm)

### F1 — Typing a child's name suggests nothing and fills nothing (the whole point of the list) 🔴
- **Citation (verbatim):** Quick File screen — *"When someone types the first few letters, the rest of the details fill in automatically"* (Settings) and the CHILD NAME box on the Quick File screen.
- **User-moment:** Filing Ava's consent form; I typed "ava" into **Child name** expecting her to pop up so her birthday, address and guardian fill themselves in.
- **Observed confusion:** Nothing appeared — no list of children, no fill. I retried and re-opened the screen; still nothing. (I confirmed the five children *are* in there and both Avas exist, so the details are present — they just never show.)
- **Harm + severity:** **Blocked** — this is the headline reason to keep a Records list; without it Quick File is just typing everything by hand.
- **Class:** CONFUSION.
- **Proposed alternative (owner-vet):** Make the Child-name box list the matching children as you type and fill the rest on pick; until it works, don't promise "the rest of the details fill in automatically."
- **What I may be missing:** I'm one persona driving a test build under a background job; it's *possible* a specific list setting (a "second detail to tell people apart") is what it's tripping on, and a list set up differently might behave better.

### F2 — Adding or setting up a child shows boxes labelled "undefined" 🔴
- **Citation (verbatim):** Settings → Document Types → Child Record → Records list, "+ Add" form — every box reads **"undefined"**; the "Match each field to a column" dropdowns are blank.
- **User-moment:** Adding a new child on the fly and checking how the list is wired.
- **Observed confusion:** Four identical boxes all called "undefined." I would have no idea which is the name, which is the birthday, which is the guardian — so I'd be afraid to type anything for fear of putting a child's address in the name box.
- **Harm + severity:** **Blocked** — an admin can't safely add a child or map columns.
- **Class:** CONFUSION.
- **Proposed alternative:** Show the real field names on the add-a-child boxes and the column dropdowns (Child name, Date of birth, Home address, Guardian).
- **What I may be missing:** This may be specific to how this particular list was created; a list built through the normal "Create a list from this type" button might label its boxes.

### F3 — "Document Issuer / Company / Person" is required on a child's record — and decides the folder 🟠
- **Citation (verbatim):** Quick File — **"COMPANY / PERSON"**, placeholder **"Company or person"**; Settings field **"Document Issuer"** (locked, Required on).
- **User-moment:** Filing a child's consent form; the app won't file until "Company / Person" has something in it, but a consent form has no company.
- **Observed confusion:** I don't know what to type — the child? the parent? my daycare? And whatever I type becomes the **folder name** (I put the child's name and got a folder per child). Meanwhile the child's *own name* field is optional. The one thing I must fill is the one that makes least sense; the obvious one is optional.
- **Harm + severity:** **Slowed + wrong-filing risk** — different staff would put different things there, scattering a child's papers.
- **Class:** QUESTION → CONFUSION.
- **Proposed alternative:** For a person-style record, name this field for what it actually is and files under (e.g. "File under — child's name"). Keep it required if it must be — just call it something a daycare recognises, not "Document Issuer / Company / Person." (I'm not asking to remove the required check.)
- **What I may be missing:** For an invoice business "Company / Person" is obvious; my quarrel is only with how it reads on a *child* record.

### F4 — Every hand-typed field shows "100%" 🟠
- **Citation (verbatim):** Filed record detail — **"Child Name  Liam Doherty 100%"**, **"Dob  2020-11-02 100%"**, **"Guardian  Michael Doherty 100%"**.
- **User-moment:** Opening a filed child record to check it.
- **Observed confusion:** "100%" next to every value looks like the software *checked* them. But I typed them all — it checked nothing. If I'd made a typo it would still say 100%, and I might trust it.
- **Harm + severity:** **Trust-eroded** — false reassurance on data nobody verified.
- **Class:** QUESTION.
- **Proposed alternative:** For Quick-Filed (typed) records, drop the percentage or label it "typed by you". The honest "typed details, not reviewed" note already sets the right expectation — the "100%" fights it.
- **What I may be missing:** The percentage is presumably meaningful on scanned documents; here it just leaks onto typed ones.

### F5 — Two children with the same first name: nothing beside the name to tell them apart 🟠
- **Citation (verbatim):** the "Children" list holds both **"Ava Thompson"** and **"Ava Robinson"**; the list is set up with no "second detail" to distinguish records.
- **User-moment:** Two Avas in my daycare; I need to be sure I file under the right one.
- **Observed confusion:** These two differ by surname, which helps — but a suggestion list shows only the names, with no birthday or guardian beside them. If I ever had two children with the *same full name*, I'd have no way to tell which is which, and could file a medical note under the wrong child.
- **Harm + severity:** **Wrong-child risk** in the same-name case — the scariest outcome for a daycare.
- **Class:** CONFUSION.
- **Proposed alternative:** Show a second detail (e.g. date of birth) next to each suggested child.
- **What I may be missing:** Because the suggestion list wouldn't show at all (F1), I saw this in the underlying data rather than on screen.

### F6 — Filing several at once could put the wrong child on a document 🟠
- **Citation (verbatim):** the multi-document filing model — a shared "Company / Person" at the top that applies to every document as a default.
- **User-moment:** Filing Liam's, Noah's and Emma's papers together, each under its own child.
- **Observed confusion:** The top "Company / Person" fills in as the default for *every* document. A document I forget to change would quietly inherit that one child — and (from the design) still show a green "ready" tick — so three children's papers could all land under one child while everything looks fine.
- **Harm + severity:** **Wrong-filing risk.**
- **Class:** CONFUSION.
- **Proposed alternative:** When filing several documents for *different* people, make each document's person explicit — don't silently inherit the folder/person from the top.
- **What I may be missing:** **I could not open the multi-document pane live** — attaching files opens a Windows file box I shouldn't drive in your sandbox — so this comes from walking the flow, not clicking it. The backend *did* file each of my three test documents under its own child correctly, so the risk is about the on-screen "apply to all," not the filing engine.

### F7 — "OCR" shows up on customer screens 🟡
- **Citation (verbatim):** tab **"Scanned (OCR)"**; **"Scanned — the software reads it (OCR)"**; Quick File intro **"No OCR, no teaching."**
- **User-moment:** Choosing how a type is filed.
- **Observed confusion:** I don't know what "OCR" means and wouldn't say it to a colleague. "The software reads it" already tells me everything.
- **Harm + severity:** **Cosmetic → slowed.**
- **Class:** PREFERENCE.
- **Proposed alternative:** Drop "(OCR)" everywhere; keep "the software reads it" / "you type the details."
- **What I may be missing:** Nothing on this one — it's just a word that shouldn't be on a daycare's screen.

---

## Warnings truth-table (destructive/committal actions I triggered)

| Action | Exact wording | True? | Notes |
|---|---|---|---|
| Delete a filed record | "Move this document to the recycle bin? You can restore it later." | ✅ TRUE | Native confirm; recoverable via the Recycle bin button. My driver auto-cancelled it, so nothing was deleted — I only read it. |
| Admin recovery code | "I have saved this code somewhere safe" gates "Continue to ScanFinder" | ✅ TRUE | Continue stays greyed until ticked. |
| Terms | "I have read and accept the Terms of Use" gates "Accept & Continue" | ✅ TRUE | Greyed until ticked. |
| Remove a staged document (×) before filing | (no confirm) | ⚪ NOT TESTED | Couldn't stage files into the pane without the Windows file box; from the flow it only drops the item from the list (nothing filed yet), so no data loss. |

*(Round-5 reminder applied: my driver silently cancels native confirm() dialogs — I checked, caught the swallowed Delete confirm, and report it as present and truthful, not "dead".)*

---

## What genuinely worked
**Filing.** Once a document is in, it's excellent: **a clean folder per child** (Company/Year/Month), searchable within a moment (I found "Liam" instantly), an honest **"Quick Filed — typed details, not reviewed"** note that tells me exactly how to change it, a **truthful recycle-bin delete**, and the preview shows the **real attached paper** so I can catch a wrong file. The **"Local only — never uploaded"** promise is exactly right for children's data, and adding a custom field ("Allergies") to a type was instant.

## Top friction
The auto-fill never appears (F1) and the records-list admin shows "undefined" boxes (F2) — so the one thing that would make Quick File better than dragging files into Windows folders (type a name, the rest fills in) doesn't happen. Right behind it: not knowing what to put in the required **"Company / Person"** on a child's record (F3).

## Two-week verdict
**Would I keep using this after two weeks? No — not yet, for children's records.** Filing and finding are genuinely good and I'd love the "folder per child." But with the name auto-fill not working, the setup screen showing "undefined," and a required "Document Issuer / Company / Person" I can't make sense of on a child, I'd worry I was mis-filing and I'd drift back to typing folder names myself. Fix the auto-fill and the person/issuer wording and I'd switch happily.

## Humility block
I'm **one simulated persona, not a user test** — I never say "users found." I judged only screens I actually drove (plus one step either side). I could **not** open the Windows file picker or the multi-document pane safely in your sandbox, so my multi-doc and some preview points come from walking the flow rather than clicking every button; a machine not running a background job might differ on the timing-sensitive bits. Every quote above is copied from a screen I saw. These are suggestions for you to vet — nothing here is a change, and I changed no code, and filed only sandbox test papers.
