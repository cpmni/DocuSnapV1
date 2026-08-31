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


---

# Round 4 — the workflow feature (send-for-approval / Mailbox), same night

> The owner flipped the pre-release WORKFLOW feature on (`WORKFLOW_FEATURE_ENABLED=true`,
> seats already licensed) and sanctioned a hands-on run: Chris routed documents to himself,
> approved, acknowledged, recalled, and attempted a rejection. Saved verbatim below.
> Post-round: his #1 card (dead Reject) was root-caused — an empty rejection note SILENTLY
> no-ops (`search-workflow.js` decide(): `if (reject && !note) return;` with the requirement
> hidden in placeholder text) — and fixed with a visible inline error; his #7 (the search
> cap-note above the Mailbox) was the same selective-clear class as round 3 and is fixed.
> The DESIGN cards (approval record on the document, silent completions, mailbox row content,
> "Assigned" empty-state, Route→Send wording, sent-date display, due dates/nudges) are
> NOT implemented — owner vets.

## TL;DR (his)
1. The boss's "Reject" button does nothing — no message, no change; the sender is never told.
2. Approve / "Got it" / Recall all work but finish in silence, and afterwards the document
   carries no visible record of who approved it or when.
3. The good bones are genuinely good: the note travels word for word, Recall really works,
   and the Home card counts both directions.

## His walkthrough (condensed quotes)
- Home: **"WAITING ON YOU / 0 waiting for you / Open Mailbox"** — "sensible, I'd spot that."
- Panel: **"ROUTE FOR APPROVAL / FOR INFORMATION"** with person/kind pickers, "Note
  (optional)", **"Route…"**. His note "Please approve - over 500 pounds" arrived quoted
  word-for-word in the receiving banner — "like a post-it stapled to the invoice."
- Mailbox: **Inbox / Sent / Assigned / Completed**; rows like "Saltmarsh Seafoods · pending ·
  Approval · from chris · 20-02-2026" — no reference, and the date is the document's, not
  the send. Approve/Got-it: silent vanish, panel resets. **Recall: "exactly the undo I
  wanted, and it leaves a paper trail"** (row flips to "recalled").
- **Reject: pressed twice, dead-centre — nothing.** (Root-caused post-round, above.)
- "View stamped copy" opened outside his test chair — unverified.
- The round-3 cap-note sentence sat above his four-item Inbox (fixed).

## His cards, ranked: 1 dead Reject (fixed) · 2 no approval record on the document ·
3 silent completions + "Route…" promises a step it doesn't have · 4 mailbox rows lack
reference/note/sent-date · 5 "Route" jargon + sender-side "Approve" reads backwards
(proposes "SEND TO A COLLEAGUE" / "Needs their approval" / "Sent to you by…") ·
6 "Assigned" pile unexplained · 7 cap-note leak (fixed).

## His verdict
"**Would our office USE the send-for-approval feature? Not yet — but we'd want to.** Yes to
the idea… No to this build, because the boss's Reject does nothing and an approval leaves no
dated, named record on the document — the two things paper does give us (a scribbled 'no,
because…' and initials with a date). Fix those two and I'd switch the same week. A due date
('needs an answer by Friday') and a gentle nudge for things sitting 'pending' would complete
what paper never managed."

*(Driver scripts: scratchpad chris-driver/r4_*.js; the Reject repro is r4_reject.js /
r4_reject2.js — real mouse click, no console errors, no state change.)*



---

# Round 5 — the sandbox: Chris's first fortnight, hands on the keys (2026-08-02)

> The owner ordered a FULLY SANDBOXED second instance (fresh DB, own userData, copied Demo
> Docs, own Output — `DOCUSNAP_USERDATA` dev hook, CDP 9223) with full destructive freedom and,
> for the first time, REAL SCREENSHOTS (`scripts/capture-window.ps1` OS-level capture; his
> shots r5_step01–38 in the session scratchpad). Per the owner's standing rule for this round,
> NOTHING below is implemented — every finding queues for the owner's vet.

## His TL;DR
- "I set up alone, taught it one supplier with one drawn box, filed 19 documents, found them
  again, sent/approved/rejected/recalled paperwork to myself, deleted everything and got it
  back — **nothing was ever lost and I always eventually knew where my paper was.**"
- "The scary buttons **tell the truth** — the delete dialogs are the best-written words in the
  product. The worst problem is the opposite corner: the setup wizard tells me a filing story
  ('by type') that the real app (Company/Year/Month) contradicts."
- "**I'd keep it, and I'd say so at the pub.**"

## The whole arc, witnessed
Create-account → recovery code ("scared me exactly the right amount") → terms → wizard →
tour → practice run → import Ridgeway (20 docs) → ⊕ teach ONE box (two mis-aims self-recovered
on screen) → Reprocess → "Reprocess 19 from 'Ridgeway Plant Hire'" → the pile heals to 94% →
File All Ready files 13 → shelf on disk exactly as promised → Search finds INV-73448 first try
→ Home: "1 supplier now file automatically" (his grammar catch: "files"). Workflow round-trip:
send/approve/reject-with-coaching/recall; Sent tab "a proper ledger"; History lines present;
the NEW stamped viewer "like a real rubber stamp… no browser, no path".

## His verify lines (earlier rounds, seen in the flesh)
⊕ hover FIXED · Unknown-Company honesty FIXED ("excellent") · dead Reject FIXED (note box +
coaching line) · mailbox rows FIXED · stamped viewer FIXED (two niggles below) · queue "Not
yet identified" BETTER · mailbox empty-states GOOD · NEW small: "1 supplier now file
automatically" grammar.

## His 8 cards (ranked, ALL awaiting owner vet — none implemented)
1. **Two different filing stories in setup** — wizard step 2 + practice doc 3 say "by type";
   step 3 / tour / reality say Company›Year›Month. "A filing app being fuzzy about filing" on
   day one. Fix = align the two stray sentences.
2. **Originals move at IMPORT, not at filing, and the aftermath reads like an error** — wizard
   says "after they're filed"; the emptied source folder then shows "No documents found
   directly in this folder — pick the folder that contains the scans". Proposes a truthful
   post-run line ("✓ 20 originals moved into 'Processed'…").
3. **Approve-with-note exists in the Mailbox but not the Search panel** — same buttons, no note
   box there; one-click Approve stamps permanently with no confirm/undo. (CONFUSION +
   QUESTION: is one-click intended?)
4. **The 63%-vs-100% hold sentence fibs three ways** — "just below" (it isn't), no hint the
   score comes from the empty issuer, "threshold" jargon. Proposes naming the empty box.
5. **Stamped save-dialog filename is machine bookkeeping** — "Stamped-copy.route-1.pdf";
   proposes "Invoice.09-05-2026.INV-30650 — APPROVED.pdf". (Also noted: dialog opened in the
   OTHER instance's last save folder — shared-machine artefact, not carded.)
6. **Post-destruction screens fib a little** — emptied-by-delete queue says "All documents
   reviewed ✓"; purged doc lingers in the side panel with a live Restore; "EVERYTHING" purge
   dialog has no count and doesn't say whether disk files are touched (QUESTION).
7. **✂ Split silently no-ops on a 1-page document** — fierce warning, then nothing. Proposes
   "This document is only one page — there's nothing to split."
8. **Jargon stragglers** — wizard finale "Offline OCR", "EXTRACTION CONFIDENCE" header,
   "Reprocess with Learned Data". Proposes plain twins.
One-liners: terms gate shows "WORKING DRAFT… NOT YET IN FORCE" (QUESTION — solicitor-pending) ·
"The default." on unselected theme card / "A good default" beside pre-picked Fast · practice
run refuses the TYPED correction it asked for ("Correct it, then confirm" vs "Draw a box…") ·
"Draw a box to read it" under already-read fields · Home "Last run: 20 filed" when queued ·
wizard step-3 preview didn't refresh after changing the folder · stamped page renders softer
than Review's · batch reprocess showed no visible progress/done (uncertainty: his tool may
have eaten a toast).

## The truth table (scary buttons, actually pressed)
Delete → bin → Restore: **TRUE end to end** · Delete All Review (21): **TRUE — "best dialog in
the app"** · File All Ready: **TRUE** · Reprocess one/batch: TRUE (batch feedback quiet) ·
Split: warning honest, behaviour mute on 1-pager · Empty bin: TRUE (thinner words) · Practice
run isolation: TRUE.

**His confession (calibration note for all rounds):** his driver was silently CANCELLING native
confirm() dialogs for half the session — he nearly reported File All Ready as a dead button; it
isn't. In-page findings (like round 4's Reject) stand; any past "silent native dialog" claim
should be re-weighed.

## Verdict
"**Yes — and this time I've done the work, not just read the screens.** … The findings above
are wording and seams, not cracks in the floor."


---

## Round: 2026-08-02 OVERNIGHT2 (sandbox vet, full walkthrough)
Sandbox conditions: isolated instance on CDP 9223 (PID 22296), fresh DB (create-admin first-run),
Demo Docs copied into the sandbox, output to the sandbox Output folder. Extra owner focus this
round: the re-skinned Search window, the preview error state, the Home "Open Mailbox" deep-link,
and the Light⇄Dark quick-flip. Report appended VERBATIM below.

---

Sandbox is tidy (no leftover `.bak`; inbox count reconciles). Note a nice bonus: approving auto-saved a stamped copy next to the original (`...INV-94023.APPROVED-stamped.pdf`) — without me clicking "Save a copy". That's the app showing its work.

I have everything. Here is my review.

---

# Chris The Customer — Sandbox vet (full walkthrough)

**One simulated persona, not a user test.** Read-only lens; every card below is a SUGGESTION for the owner to vet, never a change. I drove the live sandbox (CDP 9223) end to end: first-run → import 20 invoices → review/teach/file → search → workflow → every scary button → all 13 Settings tabs.

## TL;DR (3 lines)
- The plumbing is genuinely solid: filing lands where promised, originals are kept, **every destructive warning I tested told the truth**, and the approval-stamp flow is excellent.
- Two things would make me hesitate on day one: the **Terms screen makes me accept a document that says it's an unfinished draft "NOT YET IN FORCE"**, and the **company name on a brand-new supplier reads as "Not found"** even though it's the biggest text on the page.
- A scatter of computer-speak leaks through ("needs_review", "63% confidence", "document_open", "(supplier_name)") that a normal office user shouldn't see.

---

## What I did, in order
Created the admin account (step01) → saved the recovery code (step03) → **accepted the Terms** (step05) → onboarding wizard set my output folder with the paper-shelf metaphor (step09) → welcome tour + practice run, both clearly sandboxed (step16-17) → set output to the sandbox folder → **processed 20 Copperfield invoices** (all landed in Review) → taught the Document Issuer by **drawing a box** round the company name (step29, it read "Copperfield Electrical") → **Confirmed & Filed** one (step30) → verified it filed to `…/Copperfield-Electrical/2026/April/Invoice.18-04-2026.INV-94023.pdf` with a tidy metadata record, and the originals moved to a "Processed" folder → **searched** "INV-94023" and found it (step32-33) → ran the **approval workflow** end to end: send → Mailbox → two-step Approve → History → **stamped viewer** (step41) → pressed **every scary button** → walked **all 13 Settings tabs**.

---

## Finding cards (ranked by harm)

### 1. The Terms I must accept say they're an unfinished draft, and contain internal notes to a solicitor
- **Citation (verbatim, step05):** *"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE. This document is a first-pass draft prepared for the business owner and must be reviewed and finalised by a qualified solicitor…"* and, inside clause 1, *"[SOLICITOR: confirm the enforceable contracting-party identity…"* (I counted **9** "[SOLICITOR:]" notes).
- **User-moment:** First launch — the gate won't let me in until I tick "I have read and accept the Terms of Use."
- **Observed confusion:** I would read "NOT YET IN FORCE" and think "am I agreeing to something that isn't finished — is this even real?" Seeing notes addressed to a solicitor in a contract I'm signing makes the whole product feel unfinished.
- **Harm + severity:** trust-eroded — **high** (it's the very first serious screen; it colours everything after).
- **Class:** CONFUSION / QUESTION.
- **Proposed alternative:** Ship the finalised Terms text (drafting banner + all "[SOLICITOR:]" notes removed) before this reaches a paying customer; the acceptance mechanism itself is fine.
- **What I may be missing:** This is almost certainly a placeholder legal file not meant to ship — but it IS what's on screen in this build, so I'm flagging it.

### 2. On a brand-new supplier, the company name reads as "Not found" — even though it's the biggest thing on the page (TOP friction)
- **Citation (verbatim, step24/step26):** field **"Document Issuer — Not found"** while "Copperfield Electrical" is printed in large letters at the top; footer note *"No Document Issuer yet — if you file now it will be saved under 'Unknown Company' and the app won't learn this sender."*
- **User-moment:** First look at my imported batch — I expected the app to have grabbed the company, the date and the reference for me.
- **Observed confusion:** All 20 invoices came in "Not yet identified"; the date and reference read fine, but the **company** — the one thing the whole filing shelf is built on — was blank on every one. I have to teach or type it myself before I trust the batch. If it can't read "Copperfield Electrical" in giant red letters, I'd wonder what else it's missing.
- **Harm + severity:** slowed / trust-eroded — **high** for the daily job (filing-by-company is the core value).
- **Class:** CONFUSION.
- **Proposed alternative:** On a not-yet-known sender, still take a best guess at the company from the top-of-page heading and show it as a "please check" value, rather than a bare "Not found" that reads like failure.
- **What I may be missing:** It's the first time it's ever seen this supplier, and the moment I pointed the company out **once**, it started offering *"Use 'Copperfield Electrical' — the logo looks similar"* on the other invoices (step59) — so it clearly learns fast. My gripe is only the cold-start on document #1.

### 3. The Recycle bin shows a different document's preview than the one in the list
- **Citation (verbatim, step51):** list reads **"RECYCLE BIN 1 — CopperfieldElectrical_invoice_16.pdf"**, but the right-hand details simultaneously showed **"REFERENCE INV-94023 … STATUS confirmed"** with an "Approved by chris.fenton" history — a *different, already-filed* invoice.
- **User-moment:** I deleted invoice_16 and opened the recycle bin to check it landed there safely.
- **Observed confusion:** The list says invoice_16, the big preview and details say INV-94023. If I now press a button, which document does it act on? I clicked the bin item and it corrected itself (then showed "STATUS deleted" and a "Restore" button, step52) — but for a moment I couldn't tell what I was looking at.
- **Harm + severity:** trust-eroded — **medium** (in the one place I go specifically to rescue a document, the screen shows me the wrong document).
- **Class:** CONFUSION.
- **Proposed alternative:** On opening the recycle bin, auto-select the first bin item (or blank the preview) so the details always match the list.
- **What I may be missing:** It self-corrected on click, so it may be a momentary stale panel rather than a wrong-target action.

### 4. Documents I've already checked and filed still show a percentage labelled "confidence"
- **Citation (verbatim, step33/step37):** on the confirmed invoice, **"Confirmed 63% confidence"**; in the deleted-item panel, **"READING CONFIDENCE … 31%"** and **"Needs Review 31% confidence"**.
- **User-moment:** I open my filed invoice in Search to check it.
- **Observed confusion:** I confirmed this document myself — so why does it still say "63%"? Is something still wrong with it? "Confidence" isn't a word I'd say to a colleague, and putting a low-looking number next to "Confirmed" makes a finished job look unfinished.
- **Harm + severity:** trust-eroded — **medium/low**.
- **Class:** QUESTION / CONFUSION.
- **Proposed alternative:** Once a document is Confirmed, drop the score entirely (or show "Checked by you"). Keep the reading score only on items still in Review, and consider plainer wording than "confidence".
- **What I may be missing:** The number may be useful to power users; I'd just not show it on things I've personally signed off.

### 5. Computer codes leak into everyday screens
- **Citation (verbatim):** STATUS **"needs_review"** (step35, underscore); activity/audit rows read **"document_open"**, **"document_close"**, **"reprocess"** (step62 Users/Audit); field labels read **"Document Issuer (supplier_name)"**, **"Invoice Date (invoice_date)"** (step62 Learning/Document Types).
- **User-moment:** Glancing at a document's status and skimming the "Recent activity" list.
- **Observed confusion:** "needs_review" and "document_open" are computer-speak — I'd read them aloud and feel I was looking at the plumbing, not my filing. The "(supplier_name)" in brackets looks like a bit of code someone forgot to hide.
- **Harm + severity:** cosmetic / trust — **low**, but pervasive.
- **Class:** PREFERENCE.
- **Proposed alternative:** Human labels: "Needs review", "Opened document", "Closed document", "Re-read"; drop the "(supplier_name)"-style bracketed keys on customer screens.
- **What I may be missing:** The audit log is admin-facing, so raw codes there matter less than on the main status.

### 6. When a document's file can't be shown, the preview says "No preview available" with no way to retry
- **Citation (verbatim, step35):** centre pane read **"No preview available"** (no "Try again" button, no note about whether the document is safe).
- **User-moment:** I opened a document whose underlying file I'd (deliberately) made unavailable, to see how a failure looks.
- **Observed confusion:** The good news — it did **not** spin forever. But "No preview available" doesn't tell me whether my document is in trouble or just can't be shown right now, and there's no button to try again.
- **Harm + severity:** trust-eroded — **low**.
- **Class:** QUESTION.
- **Proposed alternative:** For a can't-load case, say "Couldn't show this document right now — the file may have moved. [Try again]" so I know it's a display hiccup, not a lost document.
- **What I may be missing:** The owner mentioned an honest "Couldn't load — try again" message; I likely hit the *missing-file* path rather than the *render-failure* path, so the nicer message may exist on a route I didn't trigger.

### 7. The "Administration" settings tabs are written in language I couldn't say aloud
- **Citation (verbatim, step66 Templates):** *"TEMPLATE VIEWER & ANCHOR MAPPING — Inspect templates and manage anchor → target zone field mappings. Templates with no mappings continue using the standard extraction pipeline."* (step65 Processing:) *"Auto-file confidence threshold"*, *"Recover long reference numbers cut off by the crop"*, *"Trim the label off the start of a read value"*, *"Faster field reads (warm OCR helper)"*.
- **User-moment:** Poking through Settings to understand what I can change.
- **Observed confusion:** "anchor → target zone field mappings", "extraction pipeline", "confidence threshold", "cut off by the crop" — I have no idea what these mean, and I'd worry I might break something.
- **Harm + severity:** slowed / cosmetic — **low** (I'd retreat, not break anything).
- **Class:** PREFERENCE.
- **Proposed alternative:** Keep these under a clear "Advanced / only if a supplier keeps reading wrong" heading (Templates already does this well — *"Advanced: use only when standard extraction is repeatedly failing"*) and swap the worst phrases for plain ones ("where to look on the page", "how sure it needs to be before filing on its own").
- **What I may be missing:** These are genuinely advanced knobs a normal user never needs; the "Advanced" labelling already softens the blow, so this is polish, not a blocker.

*(Smaller things I noticed, not worth a full card: after I taught the company, the blue helper box still read "The Document Issuer box is still empty" even though it was filled — stale hint; the Recycle bin shows two buttons both labelled "Back to search"; Files & filing says "reserved device names are defused", which I didn't understand.)*

---

## Warnings truth-table (did the button tell the truth?)

| Button | Warning said (verbatim) | What actually happened | Truthful? |
|---|---|---|---|
| **Delete** (Review) | *"Delete 'CopperfieldElectrical_invoice_16.pdf'? It goes to the app's recycle bin — you can restore it from Search."* | Count 19→18; doc appeared in recycle bin | ✅ True |
| **Restore** (bin) | (Restore) | Count 18→19; doc back in Review | ✅ True |
| **Empty bin** | *"Permanently delete everything in the recycle bin, including their PDF files? This cannot be undone."* | Bin emptied; the working PDF was genuinely gone from disk | ✅ True |
| **File All Ready** | *"…Every document with its type and required fields filled in will be filed… Documents still missing required details are left in the queue…"* | Filed **0**, left 18 (the company-less docs were **left**, not dumped under "Unknown Company"); showed *"Filed 0 · 18 left for review"* | ✅ True & safe |
| **Confirm & File** | *"…if you file now it will be saved under 'Unknown Company'… or file anyway."* | After I taught the company, it filed to `Copperfield-Electrical/2026/April/…` | ✅ True |
| **Split PDF** | (tool) | Toast: *"This document is only one page — there's nothing to split."* | ✅ True |
| **Reprocess** (doc) | (no warning; non-destructive) | *"Reading selection…"* → *"✓ Reprocessed"*; nothing lost | ✅ True |
| **Defer** | tooltip *"…it moves to the Deferred tab. Nothing is filed or deleted."* | (verified copy only) | ✅ Honest |
| **Approve** (workflow) | two-step *"Confirm — approve and stamp with your name"* | Stamped green **APPROVED / By: chris.fenton / Date: 02 Aug 2026**; logged to History; auto-saved a stamped copy alongside the original | ✅ True |

**Every warning I pressed told the truth.** That is the single most reassuring thing in this whole review.

---

## What genuinely worked
Lots, but the standout: **the approval + stamped-copy flow** (step40-41). Approve is a deliberate two-step ("Confirm — approve and stamp with your name"), it drops a clear green **APPROVED / By / Date** stamp on the document, records it in History, and quietly files a stamped copy next to the original (`…INV-94023.APPROVED-stamped.pdf`) — exactly the audit trail I'd want when the accountant asks "who signed off this invoice?". Honourable mentions: the honest **delete → bin → restore** loop; the onboarding line *"Your original scans are never deleted — they're just moved into a 'Processed' folder"*; the Home **"WHERE YOUR FILES GO"** card with the real path and an Open-folder button; and the **theme quick-flip** — I set Nordic Slate, flipped to dark and back via **both** the rail toggle and the account menu, and it returned to **Nordic** each time (the "forgets your theme" worry did not reproduce).

## Owner's focus items — verified
- **Search re-skin:** looks modern and holds together — tinted "Invoice" type chips, amber "Needs Review" chips, score bars, pill buttons, a magnifying-glass lead box (step31). Nothing read worse *except* the "confidence" wording (card 4) and the raw "needs_review" status (card 5).
- **Home "Open Mailbox":** lands **straight on the Mailbox** (Inbox tab active, *"Nothing waiting on you…"*), not a blank search (step47). ✅
- **Preview error:** no endless spinner (good) — but see card 6 about the plainer message/no retry.
- **Light⇄Dark quick-flip:** round-trips correctly and keeps the chosen theme (step44-45). ✅

## Top friction point
**The company/sender not being read on a new supplier (card 2).** Everything about ScanFinder's value — filing by company, finding it when the accountant rings — hangs on the company name, and on first contact it was blank on all 20 invoices. The recovery is quick (teach once, it learns), but the cold-start moment is where a paper-and-Excel person like me would lose confidence. The Terms draft (card 1) is the more *alarming* surprise, but it's a one-off gate, not daily friction.

## Two-week verdict
**Would I keep using this after two weeks? Yes** — because it does the thing I actually care about: my documents go to a sensible folder I can open, my originals are never thrown away, search finds them by reference in seconds, and every scary button was honest about what it did. What's holding it back from a *confident* yes is chore-y first contact on each new supplier (typing/teaching the company), a few screens that talk like a computer ("needs_review", "63% confidence"), and a Terms screen that currently looks unfinished. Fix the wording and the cold-start guess and I'd recommend it to the office next door.

---

**Humility block:** I'm one simulated non-technical persona (Chris), not a usability study — nothing here is "users found…". I drove the sandbox with a script, so a couple of my own hiccups (a mis-timed two-step Approve click; the Import results table not updating because I kicked processing via the bridge, bypassing the button's own progress) are **my driving artefacts, not app faults**, and I've excluded them. I may have hit a different preview-failure path than the one the owner meant (card 6). All findings are suggestions for the owner to vet, never code changes.

**Key screenshots (in `<scratchpad>/chris-driver/`):** step05-terms.png (card 1) · step26-doc18.png + step24-review.png (card 2) · step51-bin.png (card 3) · step33-preview.png + step37-mailbox.png (card 4) · step35-previewerr.png (cards 5 & 6) · step65-processing.png + step66-templates.png (card 7) · step41-stamped.png (worked) · step46-home.png (Home).
