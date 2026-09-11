# Chris The Customer — full app review — 2026-09-11

## Round: 2026-09-11 (sandboxed, today's DARK arcs ARMED)
Sandbox conditions: fresh install (create-first-admin flow, 0 users), isolated userData + Output under the
session scratchpad, `-TEST` build so migs 154-158 are ARMED ON (42/42 TEST switches), CDP 9223 / PID 25284,
corpus = a copy of Desktop\Demo Docs (incl. the owner-added Vellum & Crane + Thornbury arc exhibits). The run
was interrupted once by a NETWORK error (API unreachable, not an app fault) and resumed. Everything inside the
sandbox only; nothing implemented — all findings queue for the owner's vet.

Focus this round: the four arcs — 157 drift-override (name not postcode), 156 non-name flag+hold, 154 ref-role
shape (new ref files), 158 note de-dup — plus the general review/auto-file customer experience.

---

**TL;DR (3 lines):** A genuinely strong fortnight. The three big fixes I could reach all held up: it files the
customer's **name, not the postcode**; it **flags and holds** a name that reads as gibberish instead of filing it;
and a **brand-new invoice number from a supplier I'd already filed files itself** instead of getting stuck.
Warnings told the truth, nothing was lost, and delete is properly undoable. My biggest gripes: nearly every
new-supplier document stops me to "confirm the sender," and one sales-order number quietly read `S0-` where the
page says `SO-`.

I am one made-up office manager, not a user test — treat this as a single careful opinion for the owner to weigh.

---

## Walkthrough (with screenshots)

**First contact — all clean.**
- Create-admin screen — plain English, "you choose everything below" `…/chris-driver/step01_createadmin.png`
- Recovery code — Continue stays greyed until I tick "I have saved this code" `step02_recovery.png`
- Terms — Accept greyed until I tick the box `step03_terms.png`
- First-run wizard: welcome + "Everything stays on this computer" `step04_wizard1.png`; output folder, "a folder for each company, then year and month… your original scans are never deleted" `step05_wizfolder.png`. (I pointed the output at my sandbox folder through Settings rather than the default, to stay inside the sandbox.)
- Welcome tour: 6 clear cards, incl. "one document type, many layouts" `step06_tour1.png` … "You're ready to go" `step07_tourlast.png`
- Practice run: "Nothing here touches your real files" banner `step08_practice1.png`; I drew boxes round the company/reference/date and it read each back correctly `step09_practiceteach.png` / `step10_taught.png`. This is the same draw-a-box teach used for real, so I count teaching as exercised — and I watched a real teach the owner had done on "Veltrix Automotive Parts" go on to file **17** of that sender's orders by itself.

**Real work.**
- Home/Import `step13_home.png`. Review opened onto an auto-file moment: green pills **"✓ 17 filed themselves · Veltrix"** and **"✓ 16 filed themselves · Silverbeck"** `step14_review_autofile.png`.
- Worked the queue: a "Which is correct?" pick for a customer read two ways (Bramblewood vs Bramblexood) `step14…`; confirmed a Silverbeck order `step15_review2.png`; filing landed exactly as promised — `Company/Year/Month/Type.Date.Ref` in my sandbox Output (verified on disk).
- Imported **Vellum & Crane** and **Thornbury** from the sample folder to probe the fixes `step16`–`step23`.
- Search: found a filed invoice by number instantly `step25_search.png` / `step26_searchresult.png`; opened the workflow "Send" `step27_send.png`; checked the recycle bin `step28_recyclebin.png`.

---

## The four focus fixes — how each behaved

**① Customer name, not the postcode (157) — FIXED (as far as I could see).**
Every Vellum sales order filed the **name**: "Ashcombe Care Homes Ltd" `step17_vellum_so08.png`, "Larch & Hollow Cafe Co", "Pemberton Joinery" (×2). Even where the customer block was "Corvus Security Services … LU2 0PB", it stayed on the name line — never grabbed the postcode `step19_so05_eee.png`. And of the 42 documents that filed themselves, **all 42 recorded a real company name as the customer — not one postcode or street slipped through.**

**② A name that isn't a name gets held (156) — FIXED.**
One Vellum order read the customer as "eee". It was **flagged "doesn't read like a name — please verify" and held**, not filed `step19_so05_eee.png`. Good. Honesty note: I never managed to make it read a *bare postcode* into the name box (fix ① kept it off the postcode line), so I couldn't watch the postcode/email case specifically — but the "that's not a name" safety clearly works.

**③ New invoice number from a known supplier files (154) — FIXED.**
After I confirmed 3 Thornbury invoices, importing more meant **two brand-new numbers (INV-88669, INV-93277) filed themselves at "100% confidence"** and **9 more were "offered in File All Ready"** `step23_thornbury_held.png`. New numbers like INV-80429 / INV-23480 read fine and were held **only** on the sender-check, never as "can't verify this value" — that phrase appears **nowhere** in the whole queue. (Silverbeck did the same: 16 orders with distinct new numbers filed themselves.)

**④ One tidy re-check note, not a wall (158) — COULDN'T REPRODUCE, reported honestly.**
No stacked-note case ever arose in the sample documents, so there was nothing to de-duplicate. Where the app *does* raise a query it's already tidy: the "Which is correct?" pick was a single clean box with two options, and the hold message is always one line ("Needs a quick check — 1 field was read with low confidence"). So the spirit holds — but I did not hit the exact exhibit, and separately I found the near-miss in Card 1 below.

---

## Finding cards (ranked by harm)

**Card 1 — A sales-order number read `S0-` where the page says `SO-`, with no query raised**
- **Citation (Review):** field "SALES ORDER NUMBER … High · 88%" showing `S0-47966`; the page prints `SO-47966`. `step20_so06_ref.png`
- **User-moment:** glancing over a Vellum order before filing it.
- **Observed confusion:** the reference is the one thing that becomes the file's name, yet a zero-for-oh swap here carries no "please check this" note — every other field that's unsure gets one. I'd file it without noticing, and later search `SO-47966` and not find it.
- **Harm + severity:** trust-eroded (wrong filename / lost-on-search).
- **Class:** QUESTION → CONFUSION.
- **Proposed alternative:** when a reference contains an easily-swapped character (O/0, I/1, S/5), add the same one-line "Read `S0-47966` here — please check the page" note it already uses elsewhere.
- **What I may be missing:** at screen zoom O and 0 are genuinely hard to tell apart; it's possible the sample really prints `S0`. Every other Vellum order read `SO-`, which is why it stood out.

**Card 2 — Almost every new-supplier document stops me to "confirm the sender"**
- **Citation (Review):** "DOCUMENT ISSUER — Check · 69% … The letterhead reads 'Thornbury Fasteners' … please confirm it's the sender, not the customer, before filing." `step22_thornbury.png`
- **User-moment:** first batch from a new supplier — 10 Thornbury invoices, all held on this one point.
- **Observed confusion:** the company name is huge at the top of every page and it read it correctly every time, yet each one waits for me to confirm it. When *everything* asks, I stop reading and just click through — which is exactly when a real problem would sail past.
- **Harm + severity:** slowed + warning fatigue.
- **Class:** QUESTION (I'm not asking to remove the sender safety — I'm asking why an obviously-correct letterhead is treated as unsure).
- **Proposed alternative:** when the big letterhead name matches the sender it's filing under, treat that as read — keep the check for the genuinely ambiguous ones. It does improve after a few confirms (2 auto-filed, 9 offered), so it's the *first-contact* wall that bites.
- **What I may be missing:** confirming the sender is also how it learns the supplier, so a first-look-per-supplier check may be deliberate.

**Card 3 — "✓ This name is correct" sits one click away from obvious gibberish**
- **Citation (Review):** customer field `eee`, below it "doesn't read like a name — please verify" and a **"✓ This name is correct"** button. `step19_so05_eee.png`
- **User-moment:** clearing a held order quickly.
- **Observed confusion:** the app correctly says "eee" isn't a name — but the fastest button next to it says the name IS correct. In a hurry I'd tap it and teach it that "eee" is a real customer forever.
- **Harm + severity:** trust-eroded (I could poison it with one mis-tap).
- **Class:** PREFERENCE.
- **Proposed alternative:** when the value clearly isn't a name, lead with "Type the correct name" and make "This name is correct" the quieter, second option.
- **What I may be missing:** for genuinely odd-but-real names that button is a real time-saver; it's the pairing with obvious gibberish that reads wrong.

**Card 4 — The same supplier split into three "senders", one of them named "SALES ORDER"**
- **Citation (Review, Grouped by sender):** "Vellum & Crane Stationers — 8 documents", plus separate groups "Vellum & Crane — 1 document" and "**S ALES ORDER** — 1 document". `step16_vellum.png`
- **User-moment:** looking down the sender list to work one supplier's pile.
- **Observed confusion:** it's all one company, Vellum & Crane. Seeing it three times — and a group named after a document heading, not a company — made me think I'd imported from two firms.
- **Harm + severity:** slowed / confusing.
- **Class:** CONFUSION.
- **Proposed alternative:** fold near-identical sender names together, and never let a heading like "SALES ORDER" become a sender group.
- **What I may be missing:** these were held-for-review reads, so the odd groups may tidy up once each is confirmed.

**Card 5 — "Nothing looks wrong" shown on a document that plainly needed a decision**
- **Citation (Review):** blue banner "**Nothing looks wrong** — a value was flagged by a formatting check. … waiting for your check" — on the order where the customer had to be picked between two spellings. `step14_review_autofile.png`
- **User-moment:** reading the banner to decide if I can trust it.
- **Observed confusion:** "Nothing looks wrong" and "a value was flagged" in the same breath cancel each other out. Elsewhere the message is specific and I trusted it more ("Sales Order Number wasn't read certainly enough for automatic filing" `step15_review2.png`).
- **Harm + severity:** trust-eroded (cosmetic → believability).
- **Class:** CONFUSION (copy).
- **Proposed alternative:** drop "Nothing looks wrong"; say what needs me, e.g. "One value read two ways — please pick the right one."
- **What I may be missing:** this is a BETTER-BUT — most banners are now honest and specific; this one phrasing lags.

**Card 6 — A delivery note's fields are labelled "INVOICE …"**
- **Citation (Review):** a "DELIVERY DOCKET" (page says "Delivery Note No. DN-31602") shown with panel labels "INVOICE DATE" and "INVOICE NUMBER". `step18_vellum_dd.png`
- **User-moment:** glancing at a delivery note before setting its type up.
- **Observed confusion:** the labels don't match the words on the paper. It *does* say clearly "Delivery Note · not set up — Add", which softens it.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** use neutral labels ("Reference", "Date") until the type is set up, so they never contradict the page.
- **What I may be missing:** once I add the Delivery Note type these labels presumably correct themselves.

---

## Warnings truth-table (what it said vs what it did)

| Button | What it SAID | What it DID | Verdict |
|---|---|---|---|
| **File All Ready** | "File 8 ready of 29. Not included: 14 flagged · 4 no type · 3 missing a detail. Each filed as if you confirmed it; anything needing a detail is left in the queue." `step24` | Math matches the queue exactly (8+14+4+3=29). Couldn't press the native **OK** through my driver (a known quirk of this build), but confirming individually files exactly as described — verified on disk in Output. | **TRUE** (copy honest; execution verified via single-confirm) |
| **Delete document** | "Goes to the app's recycle bin — you can restore it from Search." | Verified the actual action: doc → recycle bin (status "deleted"), **Restore returned it** to Review, bin then empty. Bin is reachable from Search with "The recycle bin is empty" / Restore all / Empty bin. `step28` | **TRUE** |
| **Delete All Review** (tooltip) | "Deletes every document in this list — they go to the recycle bin, restorable from Search." | Didn't run it (native OK undrivable), but it's the same mechanic I verified above. | **TRUE (copy); execution not run** |
| **Defer** (tooltip) | "Moves to the Deferred tab. Nothing is filed or deleted." | Consistent with the Deferred tab present (0). | **TRUE (copy)** |
| **Auto-file countdown** | "Filing automatically in Ns — press Not now to keep them in Review." | 17+16+2 filed themselves and show as green "filed themselves" pills you can expand; all appear in Search as Confirmed. | **TRUE (shows its work)** |
| **Reprocess** (one held doc) | (no warning) | Re-read immediately ("Reprocessing…"). Reasonable — it's re-reading an unconfirmed doc, which can only help. | **OK** |

Two native `confirm()` dialogs (File All Ready, Delete) auto-cancelled through my driver before I could accept — this is the CDP limitation the brief itself flagged, **not** an app fault. I verified those actions' real behaviour another way where it mattered.

---

## What genuinely worked
- **The automation shows its work.** "17 filed themselves", "2 filed automatically · Thornbury", "9 more offered in File All Ready" — I always knew what it did on its own, and could expand each pill.
- **The File All Ready consent is the best I've seen** — it tells you exactly how many file, how many stay, and *why*.
- **Delete is genuinely undoable** — bin + one-click restore, reachable from Search. My top fear (losing a document) is well handled.
- **It files the customer's name, not the postcode**, and holds gibberish instead of filing it — the two fixes I most wanted to see.
- **Honest "can't file yet" messages** for types not set up ("Delivery Note · not set up — Add") `step18`.

## Top friction
The **sender check on every first-contact document** (Card 2). On a fresh supplier's pile I'm clicking "yes that's the sender" on page after page where the name is huge and obviously right — that's where warning fatigue creeps in.

## Two-week verdict
**Yes, I'd keep using it.** It gets my documents filed, it shows me what it did, it doesn't lose things, and the risky buttons tell the truth. The name-vs-postcode and new-number fixes make it noticeably more trustworthy than a stack of folders. I'd want the first-contact sender clicks eased and the `S0/SO` slip caught — but none of that would send me back to the lever-arch folders.

## Humility block
I'm a single simulated office manager, not real user testing — no "users found" here, just one careful pass. I judged only screens I actually drove today (plus the sample documents in front of me). I couldn't press two native OK dialogs or reproduce the stacked-note case, and I couldn't run the send→approve→stamp workflow end-to-end because I'm the only user in this sandbox ("No one can approve yet — grant stamping in Settings" `step27`). Everything I did was in the sandbox only; I filed to the sandbox Output, moved my sample copies to their Processed folders, and did a delete/restore that I put straight back. Nothing here is a change — it's all for the owner to vet.
