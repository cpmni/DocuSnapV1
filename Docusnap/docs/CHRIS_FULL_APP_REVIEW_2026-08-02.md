# Chris The Customer — Round 2: the whole app (2026-08-02, overnight)

> Saved VERBATIM per the owner's request ("document his full findings this time in an md file
> and not just a table of points"). Produced by the chris-the-customer advisor driving the LIVE
> dev app over CDP (read-only — no confirms, deletes, setting changes, or DB writes). Screenshot
> capture hung in this Electron build (driver note at the bottom), so the whole review was done
> off the live rendered DOM text — every quote was on screen at the time. Round-2 citation
> spot-checks by the main session: "Delete All Review" tooltip absence verified
> (src/windows/review/index.html:913), the stale "Fast or Smart" guide section verified
> (src/windows/help/getting-started.html:106), the "Overall 97% · checked by you" cue is
> tonight's new copy — he was reviewing the live post-`29c4927` renderer.
> NOTHING from this report is implemented — owner vets first (standing rule).

---

I've walked the app. Screenshots wouldn't render over the driver (the window produces no frames — noted below), so I drove it by its live on-screen text instead. Every quote below was pulled off the running app.

---

*One simulated office manager's walkthrough. I am not a user test — I'm one made-up bloke with twenty years of Windows folders and a plumbing firm's filing to do. Take me as one opinion, not evidence.*

---

## TL;DR

1. The app is genuinely kind to me in the places I feared most — filing rules, duplicates, backups and the practice run all say plainly what they'll do, and Search found March's Thornbury invoice in about twenty seconds.
2. But the numbers don't agree with each other (the front page says 481 this week, Search says 200 in total), the destructive buttons are the only ones with no explanation, and one tab shows me an empty list while leaving "✓ Confirm & File" live on a document.
3. I'd keep it. I'd also keep a paper note by the monitor saying "don't touch the bin ones".

---

## The walkthrough

### Getting my bearings — the home screen

First thing: it looks like an app someone cared about. Left-hand strip with **"Home"**, **"Import"**, **"Review"** with a little **1** on it, **"Search"**, **"Teach"**, **"Settings"**, and at the bottom the time — **"23:09"**, **"Sat, 1 Aug 2026"** — and two words I liked instantly: **"Local only"**. I hovered it and got **"All processing is local. No data leaves your PC."** Good. That's the first question my boss asks about anything and now I have the answer without ringing anyone.

Cold narration, before I clicked anything. **"NEEDS YOUR ATTENTION / 1 waiting in the review queue / Open Review"** — right, one thing for me to look at, there's the button. **"WHERE YOUR FILES GO / C:\Users\cmccu\Desktop\Kyle Test\Documents / Open folder"** — perfect, that's my filing cabinet and there's the key. **"RECENT ACTIVITY"** with a list of Saltmarsh Seafoods worksheets — that's my last hour of work, good. **"IMPORT DOCUMENTS / No source folder chosen yet. / Go to Import"** — it's telling me what's missing instead of just showing me a blank. I like this app so far.

Then I got to the middle card and stopped.

> **"DOCUMENTS FILED"**
> **"279" "filed today"** — **"481" "this week"** — **"279" "this month"**

I read that three times. I filed 481 documents this week but only 279 this month? I've been doing invoices for twenty years and I can tell you the month contains the week. It's not a huge thing, nobody's document is lost, but it's the front page. It's the first number the boss sees over my shoulder. And the card directly underneath it is called **"GETTING SMARTER"**, which made me laugh out loud, because at that moment it plainly wasn't.

**"GETTING SMARTER / 6 suppliers now file automatically · learned 23 layouts. / Accuracy improves every time you confirm a document."** — that last sentence is lovely, actually. It tells me why I'm doing the boring bit.

**"DID YOU KNOW"** with **"Teach a document: Open a tricky scan in Review and use "Teach this document" so Scan Finder files its layout automatically next time."** and an **"Another tip"** button. Fine. I clicked "Another tip" out of nosiness like everyone does.

And **"PRACTICE RUN / New here? Walk through import, review and confirm with safe sample documents — nothing touches your real files. / Try a practice run"**. That sentence — *"nothing touches your real files"* — is the single best sentence in this entire application. That's the one that gets a nervous new starter to actually click something. Whoever wrote that understands people.

### The Import screen

Clicked **"Import"**. **"SOURCE FOLDER / Click to select a folder…"**, a big **"Process Documents"**, and a table headed **"COMPANY  DATE  REFERENCE  STATUS"** with **"No documents processed yet. Pick a source folder above and press Process."** underneath. Empty screen that talks to me — exactly right. Small niggle: the button says **"Process Documents"** and the message says *"press Process"*. Trivial, but I did glance around for a button called "Process".

Also there: **"Print separator sheets"**, and hovering gave me **"Print numbered separator sheets to slot between documents in your scan pile — the batch splits at each sheet"**. I know exactly what that is and I want it. That's how you explain a feature.

And **"Clear Stats"**. Hmm. "Stats" is a bit computery for me and my first thought was *does that delete anything?* Hovering said **"Reset the session counters to zero"** — fine, no harm. But my first instinct on a button with a broom-sounding name is to leave it alone.

### Review — where I'd spend my mornings

Clicked **"Open Review"**. New window, nice and big.

Top left: **"Review 1"** / **"Deferred 0"**. Then a green stripe:

> **"✓ 36 documents filed automatically on the last pass — click here to review them"**

Thirty-six documents were filed while I wasn't looking. Now — I *want* to be told that. That's automation showing its work and I genuinely appreciate it. But I stared at **"click here to review them"** for a good while and did not click it, because I couldn't work out what it would do to thirty-six documents that are already filed. Does it pull them back out? Un-file them? Just show me a list? Nothing on that stripe tells me, and thirty-six is a lot of paper to gamble. So I did what any office manager does with an unclear button: nothing. Which means the feature is there and I'm not using it.

The one document waiting: **"SaltmarshSeafoods_worksheet_05.pdf"**, under a heading **"Saltmarsh Seafoods / 1 document"**, with a green **"97%"** on it. Hovered: **"Looks good — 97% confidence"**.

So — it looks good, it's 97%, and it's in my to-do pile. Why?

The app answers, and this is where it lost me:

> **"Nothing looks wrong — Reference number was read at lower confidence than automatic filing requires, so this one is waiting for your eye. If the value is wrong, teaching it (⊕) usually fixes it for good — if it's right, just confirm."**

And directly beneath the three fields:

> **"REFERENCE NUMBER"** — **"High · 85%"** (hover: **"High confidence — the app is 85% sure of this reading"**)

So the same screen tells me the reference number was read *badly* and, two inches below, that it was read **"High"**. Also **"DOCUMENT ISSUER — High · 90%"**, **"DATE — High · 98%"**, and a badge saying **"Overall 97% · checked by you"**. Checked by *me*? I've been in the window ninety seconds and I haven't checked anything. That badge is claiming I did something I didn't do, and if there's one thing that makes an office manager sit up, it's the computer saying you signed off on something.

Then the final line, and I'm afraid I laughed at this one too:

> **"Confirm it and it files. This isn't the confidence setting — changing that won't file this one."**

The app is pre-emptively defending itself against a setting I hadn't heard of yet. It's the software equivalent of "and before you ask, no." I appreciate the honesty — genuinely, it's saving me a wasted trip to Settings — but a screen that has to warn you off its own settings is a screen telling you something.

**The good bits in Review**, and there are real ones. **"Recognised by: Its logo and wording"** and **"Fields read by: Remembered positions"**. That's plain English about a clever thing and I understood it immediately, first read, no help needed. More of that please.

Hovering the field name **"Document Issuer"** gave me **"The company the document is FROM — the sender who issued it (e.g. the supplier on an invoice). Not your own company."** — that "Not your own company" is exactly the mistake I'd have made. Someone watched a real person get that wrong and fixed it.

And the little dot beside two of the fields: **"Taught — Scan Finder knows where this field sits on this supplier's documents of this type"**. Fine, I get it.

**The button count.** For this one document — the one it says nothing is wrong with — I can press: **"Skip"**, **"↻ Defer"**, **"✓ File All Ready"**, **"🗑 Delete All Review"**, **"✓ Confirm & File"**, a **"🗑"**, and a small **"×"** on the list row. That's seven ways to move or lose the thing. Plus *three* separate Reprocess buttons: **"▶▶ Reprocess"** under **"THIS DOCUMENT"**, then under **"ALL DOCUMENTS IN THE QUEUE"** both **"Reprocess 1 from "Saltmarsh Seafoods""** and **"Reprocess all in queue"**. For one document. In a pile of one. I only ever needed one of them and I had to read all three to be sure.

**"↻ Defer"** — no explanation anywhere. I *think* it means "put it back in the pile for later", which is what I do with a dodgy invoice a hundred times a week, but "Defer" isn't a word I'd say to my colleague. I'd say "leave it".

**The two side rails.** Down the left of the list, little icons. Hovering them: **"OCR Enhancement"** — no idea, and I mean that literally, those letters mean nothing to me. **"Template Wizard — fine-tune a layout, pin fields precisely (admin)"**. **"Learning history — see & tidy the values learned for a field (admin)"**. **"Straighten every document this session — auto-straightens each doc you open and forces straightened reads on Reprocess All (display + reads only; filed files unchanged)"** — that last one is a mouthful, but the bit in the brackets is the bit I needed and it's there, so I forgave it.

I did open the scissors one. **"SPLIT PDF / By page range / Every page (1 file per page) / Every N pages / ✂ Split / Cancel"**. There's a **"Cancel"**, so I wasn't scared. I would like it to tell me what happens to the original — I'd want to know my one PDF isn't shredded — but the Cancel button did its job of making me brave enough to look.

Above the page: **"∞ Straighten"**, hover: **"Straighten a tilted scan so drawn boxes line up with the text (display only — the filed file is unchanged)"**. "the filed file is unchanged" — thank you. That's the sentence that lets me press it.

**Then I clicked "Deferred 0"**, purely to see what "Deferred" meant, and this is the moment of the whole review where I'd have phoned my nephew.

The list went completely blank. Not "nothing set aside" — blank. White. But on the right, the Saltmarsh worksheet was still sitting there in full, all three fields, and **"✓ Confirm & File"** still lit up and clickable. So the screen was simultaneously telling me *there's nothing here* and *here's a document, shall I file it?* I did not press it, because I didn't know what it would file or into what. But I want to be clear that a tired person at half four on a Friday absolutely would.

### Search — the accountant rings

This is the real test. The accountant rings: "Chris, I need the March invoice from Thornbury."

Opened **"Search"**. Straight away I liked it: it had already loaded everything, headed **"CONFIRMED"** with **"200"** beside it, and a second group **"UNCONFIRMED"** with **"1"** and a badge **"Needs Review"**. There's a box saying **"Search anything…"** and hovering it says **"Searches everything on the document — text, references, amounts, dates and codes. Numbers ignore commas (1137 finds 1,137)."** That "1137 finds 1,137" detail is thoughtful — that's someone who's actually typed an amount into a search box before.

Typed "Thornbury", pressed **"Search"** — under three seconds, **"CONFIRMED 80"**. Picked **"Invoice"** from the type list, searched again — **"CONFIRMED 20"**, and second row down: **"Invoice.16-03-2026.INV-50540-DUPLICATE-2.pdf"**, 16th of March. Clicked it, the page came up, and a neat panel:

> **"COMPANY / Thornbury Fasteners / TYPE / Invoice / REFERENCE / INV-50540 / DATE / 16-03-2026 / STATUS / confirmed"**

Twenty seconds, three or four clicks, accountant happy. That is a genuinely good result and better than my current shelf.

Except — and this is the bit where the phone call doesn't actually end — I now need to *send* it to her. And I looked. And looked. On that screen, with the invoice open in front of me, the only things I can press are zoom, next/previous, and three icons that hover as **"Delete (move to recycle bin)"**, **"Send back to Review (admin) — re-open a filed document in the queue"** and **"Show the recycle bin"**. There is no "Open", no "Show me the folder", no "Print", no "Email". I can find my document and look at it, and then I'm back to Windows Explorer hunting down the path by hand while she waits. That's the one place the app hands me back to the old way.

Two smaller things in Search. First, the filenames. **"Invoice.16-03-2026.INV-50540-DUPLICATE-2.pdf"** — and further down a **"Delivery-Note.22-09-2026.DN-99718-DUPLICATE-7.pdf"**. Seven. Somewhere there are six other delivery notes with that number and I have never met any of them. I know from the Settings tab that this is deliberate and safe, but seeing "-DUPLICATE-7" in the accountant's file name is a conversation I don't want to have.

Second, and worse: the front page told me **"481"** documents **"this week"**. Search, with an empty box and no filters, says **"CONFIRMED 200"**. There is no line anywhere saying "showing the first 200" or "200 of 481". So on one screen I have 481 and on another I have 200, and my brain — which has spent twenty years making sure nothing goes missing — immediately went *where are the other 281?* I don't think anything is lost. But I spent five minutes convinced something was, and that five minutes is the whole ballgame for a filing app.

### Settings — where I'd stop reading

Twelve tabs: **"Files & filing"**, **"Document Types"**, **"Processing"**, **"Appearance"**, **"Templates"**, **"Learning"**, **"Learning Repair"**, **"Users & activity"**, **"Audit"**, **"Licensing"**, **"Search client"**, **"Advanced"**. I'd open the first four and treat the rest as "for whoever set this up".

**Files & filing** is the best screen in the app and I'd like to say so loudly. **"OUTPUT FOLDER / Where confirmed documents are filed. Required before confirming any document."** Clear. The folder builder — clicking blocks called **"Issuer"**, **"Year"**, **"Month"** — with a live line underneath:

> **"C:\Users\cmccu\Desktop\Kyle Test\Documents › Smith-&-Sons-Builders-Ltd › 2025 › December › Invoice.15-12-2025.INV-2025-0142.pdf"**

That's my filing cabinet drawn out for me before I commit to anything. That is *exactly* how you show a nervous person what a setting does.

And then this, which I'd frame:

> **"If a new document would be filed under a name that already exists, the newer copy is kept with a label added to its file name, so nothing is ever overwritten. Choose the label:"**

"so nothing is ever overwritten". That sentence removed my number-one fear in one line, and then *let me choose the label*. Ten out of ten.

**Document Types.** Fine at the top — **"Select a type to edit its fields and filing roles, or create a new one. Each type's Company, Date and Reference roles drive filing and learning."** Then the field list shows me **"Document Issuer"** and, right underneath it in smaller text, **"supplier_name"**. And **"Invoice Date"** / **"invoice_date"**. Those underscore words are clearly not for me and they made the screen feel like I'd wandered into the back office by mistake.

Also, beside my perfectly healthy Invoice type, a button: **"Fix this type…"**. My first reaction was *what's wrong with my invoices?* I hovered, and it said **"Reset what's been learned for this type if it's reading documents wrong"**. So it's not a fix, it's a wipe. If I'd clicked that on a hunch because the label invited me to, I'd have thrown away everything it had learned about invoices, and I'd have done it thinking I was being helpful.

**Processing.** This is where I stop reading, and I can tell you the exact line:

> **"How many documents ScanFinder reads at the same time. This PC has 16 processor cores, so you can go up to 10."**

I don't know what a core is. I now know I have sixteen of them and that I'm allowed ten. I closed my eyes briefly. (In fairness the paragraph ends **"If unsure, 1–2 is safe"**, which is the right rescue.) Same for **"Scan reading detail (OCR resolution)"** and **"Fast (150 DPI)"**.

But before I stopped, I hit the thing that ties back to Review. At the top of this tab: **"Auto-file confidence threshold"** ... **"100%"**. At the bottom of the *same tab*: **"REVIEW / Confidence threshold / Flag a document for review if any field falls below this confidence"** ... **"70%"**. Two sliders, near-identical names, opposite jobs, one page apart — and over in Review the app is having to tell me **"This isn't the confidence setting — changing that won't file this one."** Now I understand why that sentence exists. It exists because these two are confusable, and the app knows it.

Credit where it's due though, this tab has some of the best writing in the product. The date one is superb: **"How to read an ambiguous numeric date like 03/04/2026. Day-first is 3 April (UK, Europe, most of the world); Month-first is 4 March (US); ISO is year-first."** I understood a genuinely fiddly thing in one read. And the separator sheets: **"If a sheet can't be read, nothing is split — the batch just arrives as one document in Review."** — telling me what happens when it *fails* is worth more to me than telling me what happens when it works.

One line here did stick out as not-for-me: **"When a Supplier or Customer name reads like a document heading, a reference/code, OCR garble, or a cut-off name…"**. "Garble" I can just about live with. Those three letters in front of it, no.

**Appearance** — short, clear, done. **"Colour theme"** / **"Changes the whole app's colours. Everything stays offline."** Nice that even the paint job reassures me nothing's leaving the building. And the list of home cards I can switch on and off, with **"Changes apply straight away."**

**Advanced** I opened by accident and I'm glad I did, because of this: **"Restore overwrites your current document types, templates and learned data with the backup's; app settings are merged. This cannot be undone — export a backup first if unsure."** That's how you write a dangerous button. It says what it eats, it says it can't be undone, and it tells me what to do first. Compare that to a certain bin-shaped button in Review and you'll see my complaint.

Also here: **"Optional, off by default. When on, Scan Finder sends anonymous diagnostics… It never includes your documents, scans, names, numbers, totals or file paths."** and a **"See exactly what's sent"** button. Off by default, plain list of what it isn't, and an offer to show me. I'd almost turn it *on* out of gratitude.

### The user guide

Clicked **"Help"** top-right (hover: **"Open the user guide"**) and got a proper guide with eleven numbered chapters. Well written, plain, no showing off. **"Speed tip: three keys to learn"** — **"In Review, Ctrl+Enter confirms & files, Space marks reviewed, and ↑/↓ move between documents."** — I'd have written that on a sticky note.

But it's describing a slightly different app than the one I've got open next to it.

It told me: **"An admin can run it again any time from Settings → General → Re-run setup."** I went to Settings. There is no "General". I checked all twelve tab names twice. (It's actually under "Advanced", which I only found by poking about.)

Then: **"Processing mode: Fast or Smart"** — **"The badge near the top shows how Scan Finder reads your documents. Click it to change the mode in Settings."** There is no badge near the top. The top of my screen has **"SCANFINDER"**, **"Help"**, **"?"** and my name. The words "Fast" and "Smart" appear nowhere on my home screen. I hunted for that badge for a good minute before concluding it wasn't me.

And the picture of the home screen is captioned with **"2 your trial / licence status"** — there's no such card on mine either.

This is the thing that makes people stop using a manual. Not that it's wrong once, but that the first two things I looked up weren't there, so now I don't trust the other nine chapters. And — this is the important bit — for a minute I assumed *I* had broken something or was looking in the wrong place. That's the feeling I hate most in software.

### The Teach window and the About box

Opened **"Teach"** out of curiosity. **"Let's teach Scan Finder a new document"**. Friendly. **"Nothing is saved until the very end — you can go back at any point."** — yes, good, that's the sentence that gets me to start.

Two words stopped me. **"The label is the anchor Scan Finder follows"** — I don't know what that word means in this context and I'd never say it out loud. And **"The boxes you draw are the exact ones the Template Manager shows later."** — I have never seen a Template Manager. It's being mentioned to me like an old friend. Where is it? Do I need it? Is it the thing behind the little icon labelled "Template Wizard"? I closed the window.

**About box**, from my name in the corner: **"ScanFinder / Version 2.0.0 (53513cf) / Electron 31.7.7 / Copyright © 2026 Six Mile Software"**. I don't know what an Electron is but apparently I've got 31 of them and they've been updated seven times. Harmless. Small thing: Escape didn't close it — I had to find the **"Close"** button. Nothing broke, but I did press Escape twice like a man rattling a locked door.

Nothing popped up on its own the whole time I was in there, which I count as a mercy.

---

## The finding cards

*Ranked by harm. Seven of them. All suggestions for the owner to weigh — I don't decide anything.*

---

### 1. The only button with no explanation is the one that destroys the pile

- **Citation (verbatim):** Review window, action bar under the queue — **"✓ File All Ready"** (hovering gives **"File every document whose type and required fields are filled in. Documents still missing details are left for manual review."**) sitting directly beside **"🗑 Delete All Review"** (hovering gives nothing at all).
- **User-moment:** First morning in Review, reading the row of buttons left to right to work out which is my "do the lot" button.
- **Observed confusion:** I hovered "✓ File All Ready" and got a full, reassuring sentence. I hovered "🗑 Delete All Review" and got silence. My honest reading of "Delete All Review" is ambiguous even as a phrase — it could be "delete all of the review list" or "delete all, review" or "delete: all review". The safe button explains itself and the dangerous one doesn't, which is exactly backwards from how I'd label a bin in a real office.
- **Harm + severity:** Trust-eroded now, potentially catastrophic later — this is the one button on the screen that could empty my morning's pile. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** Keep whatever confirmation step already guards it — I'm not asking to make it easier to press. Just give it words: label it **"🗑 Delete all in this list"** and give it a hover that says **"Deletes every document waiting in this list. They go to the recycle bin — you can get them back from Search → Recycle bin."** (Only if that's true; if they don't go to the bin, say so even more plainly.)
- **What I may be missing:** There may already be a typed-confirmation dialog behind it that spells all this out — I deliberately didn't click it to find out, so I'm judging the door, not the room.

---

### 2. The "Deferred" tab shows me nothing, and leaves "Confirm & File" live on a document

- **Citation (verbatim):** Review window — tab reads **"Deferred 0"**; the document list beneath it goes completely blank (no message of any kind); the right-hand side still shows **"SaltmarshSeafoods_worksheet_05.pdf"** with its three fields and a live **"✓ Confirm & File"** and **"🗑"**.
- **User-moment:** Clicking "Deferred" simply to find out what the word means.
- **Observed confusion:** I'd click "Deferred 0", see an empty white column, assume the screen is still loading, and then notice a document is still sitting there fully editable with a green File button. I would not be able to tell you which list that document belongs to or what "✓ Confirm & File" would file it *as* while I'm on this tab. Worse: I'd be one stray click from filing a document while looking at a screen that says there's nothing here.
- **Harm + severity:** Could file something without meaning to; and an empty screen that says nothing always reads as "broken" to me. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** Two small things. Put a line in the empty list: **"Nothing set aside. Documents you press '↻ Defer' on wait here until you come back to them."** And when the list is empty, clear the document pane too, or grey out "✓ Confirm & File" so it can't act on something that isn't in the list I'm looking at.
- **What I may be missing:** Keeping the document on screen may be deliberate so you don't lose your place when you flick between tabs — if so, the fix is just to say so on the empty list.

---

### 3. The front page says 481 and Search says 200, and nothing explains the gap

- **Citation (verbatim):** Home screen, **"DOCUMENTS FILED"** card — **"481"** / **"this week"**. Search window, with an empty **"Search anything…"** box and no filters set, the results heading reads **"CONFIRMED"** / **"200"** (plus **"UNCONFIRMED"** / **"1"**).
- **User-moment:** Opening Search for the first time to see "everything I've got".
- **Observed confusion:** I filed 481 this week; Search offers me 200 in total. There is no line anywhere saying "showing the first 200" or "200 of 481". My immediate, unavoidable conclusion is that 281 documents are unaccounted for, and I'd spend the next ten minutes searching for one I know exists to prove to myself it's still there.
- **Harm + severity:** Trust-eroded, badly. "A document has gone missing" is the single thing that would make me stop using this. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** If it's showing a first batch, say so where the number is: **"CONFIRMED — showing the first 200 of 481"**, with a **"Show more"** at the bottom of the list. If 200 is genuinely all there is, then the home card's wording needs to change instead, because those two numbers are counting different things under labels that sound the same.
- **What I may be missing:** "481 this week" and "200 confirmed" may honestly be measuring two different piles (filed-this-week versus confirmed-in-total), in which case nothing is wrong at all — but I couldn't work that out from the two screens, and I'm the one who has to.

---

### 4. I found the invoice and then couldn't do anything with it

- **Citation (verbatim):** Search window, with a document selected. The panel shows **"COMPANY / Thornbury Fasteners / TYPE / Invoice / REFERENCE / INV-50540 / DATE / 16-03-2026 / STATUS / confirmed"**. The only actions I could find are the zoom controls and three icons hovering as **"Delete (move to recycle bin)"**, **"Send back to Review (admin) — re-open a filed document in the queue"** and **"Show the recycle bin"**.
- **User-moment:** Accountant on the phone. I've found her invoice. She now needs it.
- **Observed confusion:** I looked round the whole panel for "Open", "Show in folder", "Print" or "Email" and found none. So having done the clever bit brilliantly, I now go to Windows Explorer and navigate to the folder by hand while she waits — which is the exact job I bought this to stop doing. (There may be a double-click trick; nothing on the screen suggests one, and I'm not going to guess with a customer on the line.)
- **Harm + severity:** Slowed — but it's the slowdown at the precise moment the app was supposed to shine. **High.**
- **Class:** CONFUSION.
- **Proposed alternative:** Two plain buttons in that panel beside the details: **"Open"** and **"Show in folder"**. If printing exists, **"Print"** as a third. Wording as literal as that — nothing else needed.
- **What I may be missing:** Printing appears to be something you switch on in Settings (**"Enable document printing"**, which mentions a Print button in Review), so some of this may already exist elsewhere and simply not be on the screen where I need it.

---

### 5. The document's own explanation contradicts its own badges

- **Citation (verbatim):** Review window, all on one screen at once —
  **"Nothing looks wrong — Reference number was read at lower confidence than automatic filing requires, so this one is waiting for your eye."**
  **"REFERENCE NUMBER"** … **"High · 85%"** (hover: **"High confidence — the app is 85% sure of this reading"**)
  **"Overall 97% · checked by you"**
  and in the list, that same document badged **"97%"** with hover **"Looks good — 97% confidence"**.
- **User-moment:** Trying to answer the only question I have in Review: *why is this one in my pile?*
- **Observed confusion:** The screen tells me the reference was read poorly and, two inches lower, that it was read **"High"**. It also tells me the document **"Looks good"** and that **"Nothing looks wrong"** — while sitting in the pile of things that are wrong. And **"checked by you"** claims I've already checked it, which I hadn't. My behaviour would be: read it twice, decide the percentages are meaningless, and from then on confirm everything without reading the reason at all. Which defeats the point of the reason.
- **Harm + severity:** Trust-eroded, and it trains me to ignore the warnings that *do* matter. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** Say the same thing in both places. Something like: **"Nothing looks wrong — but the Reference number isn't quite certain enough to file on its own, so it's waiting for your eye. Check it reads the same as the paper, then confirm."** And retire the "High · 85%" badge on the very field the note is holding back, or mark that one **"Needs your eye"** so the two agree. **"checked by you"** should only appear after I've actually checked it.
- **What I may be missing:** The percentages may be measuring genuinely different things that are all true at once — but if a screen needs me to know that, it needs to say it, and I don't think anything can be both "High" and "not high enough" to the same reader.

---

### 6. The user guide sent me to two places that don't exist

- **Citation (verbatim):** User Guide → "Getting Started" — **"An admin can run it again any time from Settings → General → Re-run setup."** and **"Processing mode: Fast or Smart"** … **"The badge near the top shows how Scan Finder reads your documents. Click it to change the mode in Settings."** Also the home-screen picture caption **"2 your trial / licence status"**.
- **User-moment:** Doing what you're supposed to do — looking something up in the manual instead of bothering someone.
- **Observed confusion:** There is no "General" tab in Settings (the twelve are **"Files & filing"**, **"Document Types"**, **"Processing"**, **"Appearance"**, **"Templates"**, **"Learning"**, **"Learning Repair"**, **"Users & activity"**, **"Audit"**, **"Licensing"**, **"Search client"**, **"Advanced"**), and there is no badge near the top of my home screen — the words "Fast" and "Smart" appear nowhere on it. I hunted for both, twice, and my first assumption was that I was doing it wrong. That's the feeling that stops people opening the manual again.
- **Harm + severity:** Slowed, and quietly corrosive — a manual you've caught out twice is a manual you stop opening. **Medium-high.**
- **Class:** CONFUSION.
- **Proposed alternative:** Point it at the real place: **"An admin can run it again any time from Settings → Advanced → Re-run setup wizard."** Delete the whole "Processing mode: Fast or Smart" section if that choice is gone, and re-take the home-screen picture so its caption matches what I'm actually looking at.
- **What I may be missing:** I'm on one particular setup with one particular set of home cards switched on — the licence bar and the mode badge may genuinely appear for other people, in which case the guide needs an "if you see…" rather than a rewrite.

---

### 7. "Documents filed": the month is smaller than the week

- **Citation (verbatim):** Home screen, **"DOCUMENTS FILED"** card — **"279"** / **"filed today"**, **"481"** / **"this week"**, **"279"** / **"this month"**.
- **User-moment:** Ten seconds after opening the app, doing what everyone does with three numbers: comparing them.
- **Observed confusion:** 481 this week, 279 this month. The month contains the week. I'd read it three times, decide the counter is broken, and then — this is the real cost — quietly discount the "279 filed today" as well, because if one of them is wrong I don't know which. And the card immediately underneath is headed **"GETTING SMARTER"**, which does not help its case.
- **Harm + severity:** Nothing lost, nothing misfiled — but it's the front page, and it teaches me not to believe the app's numbers. **Medium.**
- **Class:** QUESTION (I want to know why it did that) shading into CONFUSION.
- **Proposed alternative:** If "this week" means the last seven days and "this month" means the calendar month — which would explain it perfectly on the 1st of August — then label them that way: **"481 / last 7 days"** and **"279 / since 1 Aug"**. Or drop the third number entirely on the first days of a month.
- **What I may be missing:** It's the 1st of the month today, so this may look completely sensible on the 20th and I've caught it on the one day of the year it looks daft. Even so, that day comes round twelve times a year.

---

## What genuinely worked

Not politeness — these are the bits I'd defend to my boss.

1. **The duplicate-files explanation in Settings → Files & filing.** *"If a new document would be filed under a name that already exists, the newer copy is kept with a label added to its file name, so nothing is ever overwritten. Choose the label:"* — that killed my biggest fear in one sentence and then handed me the choice. Every dangerous-sounding feature in this app should be written by whoever wrote that.

2. **The live filing preview.** Clicking blocks called **"Issuer"**, **"Year"**, **"Month"** and watching **"C:\Users\cmccu\Desktop\Kyle Test\Documents › Smith-&-Sons-Builders-Ltd › 2025 › December › Invoice.15-12-2025.INV-2025-0142.pdf"** change underneath. That's a shelf. I can see my shelf before I agree to it. I have never once been shown that by a piece of office software.

3. **"Recognised by: Its logo and wording / Fields read by: Remembered positions"** in Review. Two lines that explain a clever thing without a single word I'd have to look up. If the rest of the app talked like this I'd have no cards to write.

4. **The practice run.** **"New here? Walk through import, review and confirm with safe sample documents — nothing touches your real files."** Six words at the end doing all the work. That's the difference between a new starter trying it and a new starter not touching it.

5. **The honesty in the small print** — **"nothing is printed until you confirm there"**, **"the filed file is unchanged"**, **"If a sheet can't be read, nothing is split"**, **"It only flags for a human to check — it never changes or deletes the value"**, and the diagnostics one that lists what it *doesn't* send and then offers **"See exactly what's sent"**. Whoever keeps writing "here's what happens when it goes wrong" — keep doing it. That's what makes me trust a machine.

6. **Search itself.** Twenty seconds from a ringing phone to the right March invoice on screen. The finding works. It's only the *doing something with it* that stops.

---

## Top friction point

**The buttons that can lose my work are the least explained things on the screen.**

Everywhere else this app goes out of its way to tell me what will happen — Straighten says *"the filed file is unchanged"*, Restore says *"This cannot be undone — export a backup first if unsure"*, filing shows me the exact folder before I commit. Then in Review, **"✓ File All Ready"** gets a full explanatory sentence and **"🗑 Delete All Review"** — the one that could empty my morning — gets nothing at all. **"Fix this type…"** invites me to press it and only reveals on hover that it wipes what it's learned. And the **"Deferred"** tab shows me an empty list with a live green File button next to it.

It's not that the app is careless. It's that its care is unevenly spread, and it's thinnest exactly where I'm most frightened. Fix the wording on the four or five dangerous controls and this becomes an app I'd stop double-checking.

---

## Would I keep using this after two weeks?

**Yes** — because the two things I actually need it for both work. It files documents into a shelf I can understand without me arranging anything, and when the accountant rings I can find her invoice in under half a minute. That's the job. After twenty years of a filing cabinet and a spreadsheet, that alone would keep me.

But a qualified yes, with a sticky note on the monitor. I'd keep it while never touching **"🗑 Delete All Review"**, never clicking **"click here to review them"** on those thirty-six auto-filed documents, ignoring the Processing tab entirely after the line about sixteen processor cores, and having stopped reading the reason notes in Review because they contradict their own badges. So I'd be using maybe two-thirds of what I paid for, and the third I'm avoiding is the third that would make me faster.

And I'd still be opening Windows Explorer by hand every time the accountant wants a copy of something. That's the one that would nag.

---

## What I may be missing

I'm one made-up bloke, not a study — don't let anyone report this as "users found". I ran on a machine whose window wouldn't give me pictures, so I read the app by its text rather than looking at it; layout, spacing, colour and anything that only exists as an icon may be much clearer in the flesh than it was to me, and I may have called something confusing that's perfectly obvious when you can see where it sits. I deliberately didn't press anything that files, deletes, confirms, reprocesses or changes a setting, so several of my worries are about doors I refused to open — there may be a proper "are you sure?" behind every one of them, which would soften half my complaints. This was one session on a queue of exactly one document, so I never saw a real twenty-document morning, never saw a document it got *wrong*, and never saw what a genuinely alarming warning looks like — so I can't tell you whether the flags earn their place in normal use, only that the one I saw didn't quite make sense. And where the numbers disagreed, I've reported that they disagreed on screen, not that anything is actually miscounted; that's for someone who can see inside to say.

---

*Driver note for the owner: `chromium.connectOverCDP('http://localhost:9222')` connects and reads/clicks fine, but every screenshot route (`page.screenshot`, `Page.captureScreenshot` with and without `fromSurface`/`captureBeyondViewport`, and `Page.startScreencast`) hangs with no frame produced, even though the page reports `visibilityState: "visible"` at 1084×711. `Browser.getWindowForTarget` isn't available in this build. This whole review was done off the live DOM instead — every quote above is text that was actually rendered and visible on screen at the time.*

---

# Round 3 — verification walk (same night, after the fixes landed)

> Appended verbatim. Chris re-walked the nine changed surfaces against the LIVE app
> (post-`ac2d924`). His one new catch (the stacking search cap-note — a bug in that
> night's own fix) was confirmed, fixed and live-verified in `334e004`.

**TL;DR (his):** eight of nine fixes read right; the new Search count line stacked and went
stale (fixed since); the week/month card is honest now but still makes you think at month-start.

Item verdicts: Search action buttons FIXED (found in seconds — "accountant-on-the-phone test
passed") · cap note NEW-PROBLEM (since fixed) · Deferred empty message FIXED · all three hovers
FIXED ("tells me the worst case AND the way back before I ever click") · green stripe FIXED
(he clicked it this time — "the promise held") · reason panel FIXED ("that's one story, and it
blames my setting, not me") · home card BETTER-BUT (order/labels at month-start) · About Esc
FIXED · Split warning FIXED ("the most honest sentence in the app — it told me the bad part
unprompted") · "Repair learning…" FIXED ("makes it safe to press just to look").

**His verdict moved:** "Would I keep using this after two weeks? **Yes** — last round it was
'yes, nervously'; now the app answers my fears before I ask."

Residual niceties he named (owner's list): Document-Actions button order (Open File first,
Delete further away) · home card order or "since 1 Aug" label · "on the last pass" wording
(already changed to "in the last run").
