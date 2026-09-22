# Chris The Customer — Round 8: the "Serial Number" list on a service worksheet

*One simulated office manager, poking at one row on the Castellan worksheets in the test copy. Not a user test — just me, my paper, and my two hands. Everything below happened in the sandbox only.*

## TL;DR (3 lines)
- Building the list by hand is genuinely pleasant — click a value to fix a letter, ✕ to drop one, ↺ to put it back, all with plain little labels. That part I liked.
- BUT the whole promise — "teach it once and every future worksheet fills itself" — fell over on the very next worksheet: it filed the **job number** as the serial and quietly dropped the **two real serials**, showing "1 found on this document" and 100%. That is the one thing this row exists to get right, and it got it wrong without telling me.
- It also captured one of the two serials wrong on the first sheet (grabbed "T-8325384" where the page plainly says "CT-8328847") with no flag on it at all.

**Top friction:** I taught it on one worksheet, confirmed, then let it read the next identical worksheet — and it put a **job reference** in the Serial Number box and missed both actual serials, at 100%, one click from filing.
**One thing that genuinely worked:** editing the entries — click a pill to change a character, ✕ to remove one, ↺ to bring it back — each with a clear little tooltip, and it never lost anything.

---

## Card 1 — It filed the JOB NUMBER as the serial on the next worksheet, and dropped the two real ones (TOP)
- **Citation (verbatim):** After I taught the serial on worksheet 0012, confirmed it, then opened its twin (0011) and pressed **▶▶ Reprocess**, the Serial Number box filled with one entry — **`CJB-9791`** — and the little receipt read **"1 found on this document"**. The page itself plainly prints, under the two line items, **"Serial No: CT-8051702"** and **"Serial No: CT-8813265"**. `CJB-9791` is the number printed at the very top beside **"JOB SHEET NO"**. The box header said **"High · 85%"** and the note above read **"Overall 100% · waiting for your check"**, with **"✓ Confirm & File"** lit and ready.
- **User-moment:** Doing exactly what the app told me to — "teach it once and every future worksheet fills this list" — and checking the next worksheet before filing it.
- **Observed confusion:** I expected the Serial Number box on this twin to show the two serials off the page (CT-8051702, CT-8813265). Instead it showed the **job number** and nothing else, and told me "1 found" as if that were a job done. If I'd trusted the row the way it invites me to, I'd have filed a worksheet whose "serials" are actually a job reference — and lost the two real serials with no sign anything was missing. For serial numbers — the whole reason I'd add this — that is the worst possible miss: it looks finished and it's wrong.
- **Harm + severity:** trust-eroded, bordering on the feature not being fit for its job. This is the fear I care about most: something filed wrong without me knowing.
- **Class:** CONFUSION.
- **Proposed alternative (a suggestion, not a demand):** when a taught list would pull in a value that also sits next to a *different* caption on the page (here the same short word appears in "JOB SHEET NO"), hold the document and say so — e.g. "Serial Number on this worksheet read **1** value, and it matches the Job Sheet heading too — please check before filing." And where the page clearly shows two "Serial No:" lines and the box found none of them, that mismatch itself deserves a "have a look" rather than a green 100%.
- **What I may be missing:** I taught it by boxing just the value (the brief told me the words "Serial No" needn't be in the box), so the app chose a very short caption on its own. Maybe boxing the caption too would fix it — but I wouldn't know to do that, and the receipt told me it was already sorted.

## Card 2 — One of the two serials came in wrong, with no flag on it
- **Citation (verbatim):** On the first worksheet (0012), after I pointed at one serial, the message bar said: **"✓ Caption No: collects 2 values on this page: T-8325384; CT-8116138."** The page prints **"Serial No: CT-8116138"** and **"Serial No: CT-8328847"**. So `CT-8116138` is right, but the second one it stored — `T-8325384` — is not what the page says (the page says `CT-8328847`).
- **User-moment:** Reading the receipt and counting: it said "2 values", the page has 2 serials, so I nearly ticked it off as correct.
- **Observed confusion:** the count was right (2 and 2), so at a glance it looks perfect — but one of the two is a wrong number, and it sits there looking exactly as solid as the correct one. Nothing on the row singles it out. I'd only catch it by reading each entry back against the paper letter-for-letter, which is the drudgery I hoped this would save.
- **Harm + severity:** trust-eroded. A wrong serial is as bad as a missing one when the accountant or a warranty claim needs it.
- **Class:** QUESTION (why is a value that doesn't match the page shown with no "check me" mark?).
- **Proposed alternative:** if one entry in a list reads far less cleanly than its neighbours, tint just that pill and add a one-line "check this one against the page" — don't let a shaky entry hide inside a confident "2 values".
- **What I may be missing:** faint or tight print is hard to read and no tool is perfect; I accept the odd slip. My point is only that the slip should show itself, not blend in.

## Card 3 — "Undo changes" wiped the whole list in one click, no "are you sure"
- **Citation (verbatim):** the link reads **"Undo changes"** with the tooltip **"Put the list back exactly as it was read"**. I clicked it once and the row went straight back to **"No entries"** / **"0 entries"** — every value I'd pointed out was gone.
- **User-moment:** I'd built the list by hand (the box started empty), tidied it, and clicked "Undo changes" expecting to undo my *last* change.
- **Observed confusion:** I read "Undo changes" as "step back one thing," not "throw away everything I did and empty the box." Because this list only exists once I've pointed things out, "back as it was read" means back to nothing — one click and all my work's gone, with no confirm and (once I click away) no obvious way back.
- **Harm + severity:** slowed / trust-eroded — losing a few minutes' careful pointing to a single misread click.
- **Class:** CONFUSION.
- **Proposed alternative:** name it for what it does — "Clear my changes" or "Start this list over" — and, when it would empty the whole box, ask once: "Remove all 2 entries and start over?"
- **What I may be missing:** maybe there's a way to bring it back that I didn't spot; even so, the word "Undo" led me to expect a small step, not a wipe.

## Card 4 — The "fills this list on every future document" promise is bolder than what happens
- **Citation (verbatim):** the receipt after I pointed at a serial: **"Saved as a keyword for Serial Number on every Service Worksheet when you confirm — every "No:" on future documents fills this list."**
- **User-moment:** reading the receipt to decide whether I could stop hand-typing serials from now on.
- **Observed confusion:** it promised that *every* future worksheet would fill this list — so I believed the next one was handled. The very next worksheet then filled it wrongly (Card 1). A confident promise that the next document immediately breaks teaches me to distrust the confident promises — which is a shame, because most of this app's little notes are honest.
- **Harm + severity:** trust-eroded.
- **Class:** PREFERENCE (soften the promise to match reality).
- **Proposed alternative:** "I'll try to fill Serial Number on future worksheets from here — always glance at it before filing." Honest, and it keeps my eye where it needs to be.
- **What I may be missing:** the promise may hold on cleaner layouts than these test ones; but on the two I actually tried, it didn't.

## Card 5 — "Never on these documents?" reads like a riddle, not a button
- **Citation (verbatim):** under the row sits **"Never on these documents?"** (tooltip: "If this sender's documents never carry this field, switch it off so it stops showing here").
- **User-moment:** scanning the row for what each link does before touching anything.
- **Observed confusion:** a bare question hanging there — "Never on these documents?" — doesn't tell me it's a switch, or what clicking it does. I'd read it two or three times and still hover before daring to click. The tooltip explains it well; the visible words don't.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** say the action: "Hide this field for Castellan" or "This field isn't on these documents — hide it."
- **What I may be missing:** regular users may learn it after once; first sight, it stopped me.

## Card 6 — Typing ";" turned BOTH entries red for a moment
- **Citation (verbatim):** typing a semicolon into one entry gave the warning **"An entry can't contain ";" — that's the separator between entries"** — the wording is clear and fair. But while it showed, **both** pills (not just the one I was editing) drew a red outline.
- **User-moment:** fat-fingered a ";" into one entry to see what it'd do.
- **Observed confusion:** the sentence is one of the better warnings I met — it tells me the rule and why. My only wobble was the red spreading to the entry I hadn't touched, which for a second read as "you've broken both of these."
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** outline only the entry that has the ";".
- **What I may be missing:** it cleared as soon as I fixed it and nothing was actually lost — a blink, not a wall.

---

## What genuinely worked (credit where due)
- **Editing the entries is lovely and safe.** Click a value and it opens right there to change a letter; the changed one gets a quiet note **"CT-8116138 — edited on this document; click to edit again"**. ✕ drops an entry — **"Remove this entry — it is not on this document (you can put it back)"** — and it goes grey with a ↺ (**"Put this entry back"**) so nothing's truly gone; the little tally **"1 entry · 1 removed"** kept count honestly. I removed both, put both back, and landed exactly where I started. That reversibility is precisely what stops me being scared of a screen.
- **Right-clicking the entries did NOT pop the cleanup menu** — and it shouldn't, so good. On an ordinary field (Worksheet Number) the right-click menu appeared as usual ("This field can wrap to the next line…"); on the serial list it stayed quiet. That's the right call and I'm glad someone thought of it.
- **"Edit as text" ⇄ "Show as list"** is a nice touch — flip to one plain box (`CT-8116138; T-8325384`) to paste or bulk-fix, flip back to tidy pills. Made sense first try.

---

## Would I keep using this row after two weeks?
**Not as it stands — not for trusting it to fill by itself.** I'd happily use the pills to tidy up serials on a document in front of me; that half is genuinely good and safe. But the point of teaching it is so the next fifty worksheets fill themselves — and on the *first* next worksheet it put a job number where the serials go, dropped the two real ones, and told me "1 found" at 100%. Serial numbers are the one thing you can't be "roughly right" about — a warranty or an insurer wants the exact string. Until teaching it reliably grabs the same kind of value on the next sheet (and flags the odd misread instead of hiding it), I'd have to hand-check every serial list on every document — which is the job I was trying to hand over. So: **No for now**, with a clear "yes, gladly" waiting on the other side of Card 1.

*— Chris Fenton. One made-up office manager, one afternoon, the Castellan worksheets in the test copy. I didn't touch anything outside the sandbox, and none of this should change the app until the owner has looked it over.*
