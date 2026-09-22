# Chris The Customer — full app review (2026-08-29, overnight round)

**Round conditions:** fresh sandbox instance (isolated `userData`, CDP 9223), seeded to the
create-first-admin flow, **all 125 feature switches ON** (the owner's up-to-date live config;
`deskew_on_import` + `identifier_registry` deliberately left off per their documented "do not flip").
Corpus = a COPY of the Desktop **CHRISBOT** folder (472 docs). Two phases: the CORE app end-to-end,
then the DETACHED SEARCH CLIENT and its interaction with the core. Real pixel screenshots in
`scratchpad/chris-captures/`. **Findings queued for the owner's vet — nothing implemented.**

Left running for owner inspection: sandbox core on **9223** (2 filed + 8 review docs, user "Sam"
created with stamp permission, one order approved + stamped); the Search Client on **9224** signed in
as Sam.

---

Chris's report follows VERBATIM:

---

# Chris The Customer — full hands-on vet (core app + detached client)

**Who I am:** Chris Fenton, office manager, 9-person plumbing firm. One simulated person, not a user test — so read this as one careful opinion, not "users found." Everything below I actually did in the sandbox, with screenshots (`…/scratchpad/chris-captures/stepNN…png`).

**TL;DR (3 lines):** The first five minutes are genuinely lovely — the practice run and the teach-a-box moment are the best onboarding I've seen in this app. But my first *real* batch hit a wall: 9 of 10 documents landed as "Sender not identified" and needed me. The scary buttons, the approval workflow, and the separate Search Client all told the truth and worked end to end.

---

## What I did (walkthrough)

1. **First contact** — made the admin account (`step01`), saved the recovery code (`step02` — the Continue button stays greyed until I tick "I've saved it," which I liked), accepted the Terms (`step03`), walked the 7-step setup wizard (`step04`–`step07`), the 6-card tour (`step08`–`step09`), then the **practice run** (`step10`–`step15`) — imported 3 samples, checked what it read, **drew a box to fix a misread reference (54% → 99%)**, confirmed, and saw exactly where each one filed.
2. **Real work** — brought in a supplier folder (10 docs). Reviewed the queue (`step18`), created a "Quotation" type on the fly (`step20`), **taught a document issuer by drawing a box round the letterhead** (`step23`–`step24`), confirmed & filed two documents, and searched them back up (`step26`–`step27`). I checked the filing folder on disk myself: both filed exactly where the app said, and every original was moved (not deleted) to the Processed folder — the promise held.
3. **Scary buttons** — File All (honest "nothing ready" receipt, `step29`), **Delete All** (`step30`, then really ran it), Recycle bin + **Restore all** (`step31`), single delete, and Split (correctly refused a 1-page doc). All reversible, all truthful.
4. **Approval workflow** — added a colleague "Sam," gave her the stamp permission (off by default — good), **sent a sales order to Sam for approval** (`step35`), and recalled a second one (`step37`).
5. **Detached Search Client (Phase 2)** — turned on network access (`step38`), launched the client, **signed in as Sam** (`step40`–`step41`), opened her Mailbox, **approved the order → it got a clean green APPROVED stamp** (`step42`–`step44`), searched and previewed filed docs (`step45`), and saw the recall land in her Completed list with an honest "Cancelled by Chris" note. The core side reflected all of it.

---

## Finding cards (ranked by harm)

### 1. My first real batch was a wall of work — 9 of 10 needed me
- **Citation (verbatim):** queue header "9 documents · 3 need a look"; on doc after doc, "Sender not identified" and "Needs: a document type" / "Needs: Document Issuer"; on the Oakhaven delivery note the issuer box literally read **"Not found"** under a big "Oakhaven Electrical Wholesale" letterhead.
- **User-moment:** I'd just imported a folder and hoped to see things filing themselves.
- **Observed confusion:** Every page had the company name printed at the top in bold, yet almost none were recognised, and several document kinds (Quotation, Delivery Note, Statement, Credit Note, Service Worksheet) "aren't set up yet" out of the box. I'd expect to point it at my scans and watch most of them file; instead I faced ten little jobs before anything filed itself.
- **Harm + severity:** trust-eroded / slowed — this is the moment a busy owner decides whether to persist.
- **Class:** PREFERENCE (the behaviour is *safe*, I'm not asking it to guess).
- **Proposed alternative:** at the end of the first import, one honest line — "First time round, Scan Finder learns each supplier and document kind as you confirm them — after this batch it'll start filing these itself." And let onboarding tick which document kinds I actually receive, so Quotation/Delivery Note/Statement exist before my first import.
- **What I may be missing:** these CHRISBOT samples are all addressed to the same buyer (Bramblewood), which probably makes the "which company is the sender?" problem look worse than a real, mixed inbox would.

### 2. The Search Client let Sam in on her one-time password without making her change it
- **Citation (verbatim):** in Settings Sam's row shows **"MUST SET NEW PASSWORD"**; the temp-password box said "it is shown only once… They will be asked to set their own password the first time they sign in." In the client I signed in as `sam` with that exact temp code and went **straight to her dashboard** — no "set a new password" step appeared.
- **User-moment:** signing a colleague in on another PC for the first time.
- **Observed confusion:** I expected the "you must set a new password first" gate to appear (it's promised on the create screen), and on the client it didn't. A one-time code that keeps working isn't one-time.
- **Harm + severity:** trust-eroded / potential security gap.
- **Class:** QUESTION (a security surface — I'm flagging, not asking to remove anything).
- **Proposed alternative:** none — please just verify whether the forced first-login password change is enforced in the Search Client the way it (presumably) is in the main app.
- **What I may be missing:** I fumbled the client login a couple of times before it took, so it's possible an earlier half-attempt cleared the flag. Worth confirming from a clean state.

### 3. "We recognise this sender" — but the badge next to it says "Not seen before"
- **Citation (verbatim):** on the Ironclad statement, the panel reads **"We recognise this sender but haven't learned this layout yet"** while the chip beside it reads **"Not seen before"** and "Fields read by: Unknown."
- **User-moment:** first time this brand-new supplier came in.
- **Observed confusion:** those two sentences flatly disagree. I can't tell whether it knows this company or not.
- **Harm + severity:** trust-eroded (mild).
- **Class:** CONFUSION.
- **Proposed alternative:** when the sender is genuinely new, say "This is a new supplier and a new layout — teach it once and I'll handle it next time."
- **What I may be missing:** maybe "recognise the sender" means something specific internally, but as a reader it contradicts the badge.

### 4. After I sent a document for approval, the Send box still said "Nothing yet"
- **Citation (verbatim):** Send dialog, HISTORY section: **"Nothing yet."** — shown *after* I'd clicked Send. (The route had actually been created — I only confirmed that by opening Settings → Workflow, which listed "to sam · awaiting approval.")
- **User-moment:** I clicked Send and wanted a "done, it's gone to Sam."
- **Observed confusion:** the one panel that should confirm the send told me nothing happened, so I genuinely thought it had failed and went hunting.
- **Harm + severity:** slowed / trust-eroded.
- **Class:** CONFUSION.
- **Proposed alternative:** after Send, show the new line in History straight away — "Sent to Sam for approval · just now."
- **What I may be missing:** perhaps it refreshes on reopening; it didn't within the time I watched.

### 5. Deleting one *filed* document warns less than deleting the whole queue
- **Citation (verbatim):** single delete — **"Move this document to the recycle bin? You can restore it later."** vs the (excellent) Delete-All wording — "They go to the app's recycle bin… **Files on disk are kept.** Confirmed and deferred documents are NOT affected."
- **User-moment:** tidying one already-filed order.
- **Observed confusion:** for a document I've *filed*, I want to know if the tidy copy in my filing folder goes too. The short version doesn't say.
- **Harm + severity:** cosmetic / small trust wobble.
- **Class:** PREFERENCE.
- **Proposed alternative:** add one clause — "…You can restore it later; the copy in your filing folder is kept."
- **What I may be missing:** it may behave identically to Delete-All; I just couldn't tell from the words.

### 6. The "issuer is empty, only 60%" nudge stayed on screen after I'd filled the issuer
- **Citation (verbatim):** after I taught the issuer and the field showed "Harrowgate Timber Supplies," the side panel still read **"The Document Issuer box is still empty — … Read at 60%, below the 90% needed…"** (`step24`).
- **User-moment:** right after a successful teach.
- **Observed confusion:** the readout bar cheerfully said "✓ I read Harrowgate Timber Supplies from your box," but the panel next to it still nagged that it was empty. Two truths at once.
- **Harm + severity:** cosmetic.
- **Class:** CONFUSION.
- **Proposed alternative:** clear/replace that hint the moment the field is filled.
- **What I may be missing:** it likely updates on the next redraw or on Confirm; it just looked contradictory in the moment.

### 7. "Being reviewed by" is blink-and-you'll-miss-it
- **Citation (verbatim):** with Chris viewing a doc in the main app, the client briefly carried "being reviewed…" text for that doc, then it vanished; the main app never showed a "being reviewed by Sam" banner at all.
- **User-moment:** checking whether a colleague is already on a document.
- **Observed confusion:** it flickered on and disappeared, so I couldn't rely on it to stop two of us clashing.
- **Harm + severity:** cosmetic (it's only advisory).
- **Class:** QUESTION.
- **Proposed alternative:** keep the "someone's looking at this" note visible for as long as they're actually on it.
- **What I may be missing:** it's meant as a soft hint, not a lock — and it did appear, just briefly.

### 8. I'm asked to accept Terms that say they're a draft and "NOT YET IN FORCE"
- **Citation (verbatim):** the very top of the Terms I must tick to accept — **"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE."** and, in clause 1, a **"[SOLICITOR: …]"** note.
- **User-moment:** first launch, before I can use anything.
- **Observed confusion:** ticking "I have read and accept the Terms of Use" on a document that says it isn't in force and still has notes to a solicitor in it feels off.
- **Harm + severity:** trust-eroded (mild, first impression).
- **Class:** QUESTION (legal — the owner's call; I'm only reporting the confusion, not asking to remove the gate).
- **Proposed alternative:** none from me — this is your legal decision.
- **What I may be missing:** I know this is placeholder text pending a solicitor; a customer just won't know that.

---

## Warnings truth-table (did the scary copy tell the truth?)

| Action | What it promised | Reality | Verdict |
|---|---|---|---|
| Delete All Review | 8 → recycle bin, restorable, **files on disk kept**, confirmed/deferred untouched | Queue cleared, all restorable, I checked disk: 10 originals + both filed folders intact | **True** |
| Restore all | "go back to where they were deleted from" | Review count went 0 → 8 | **True** |
| Single delete (filed doc) | "recycle bin… restore later" | Reversible | **True but vague** (silent on the filed copy) |
| File All (0 ready) | "Nothing is ready to file yet…" | Nothing filed, honest receipt | **True** |
| Split (1-page doc) | "only one page — there's nothing to split" | Refused sensibly | **True** |
| Recall / Cancel route | "removes it from the recipient's inbox and leaves an honest note in their Completed list" | Sam's inbox cleared; Completed showed "recalled · Cancelled by Chris Fenton" | **True** |
| Recovery / temp password | "shown only once… asked to set their own on first sign-in" | Core promises it; **client didn't force it** (see card 2) | **Unverified — flag** |

---

## What genuinely worked (credit where due)

- **The practice run is the best thing here.** A real, safe rehearsal — I drew a box, watched a 54% misread jump to 99% "Read from your box ✓," and got a plain before→after of where all three filed. If every new owner did this, support calls would drop.
- **Teaching a field is a delight** — draw a box, it reads it back, tells me it'll remember it for this supplier. No jargon.
- **Filing tells the truth.** Every "Filed as …" message matched the actual file on disk, and originals were moved, never deleted.
- **The tool tooltips answer my fear before I ask it** — e.g. Straighten: "display only — the filed file is unchanged."
- **The whole approval flow reads like plain English** — "Why: they need to approve it," routing rules as a sentence with a "Show me what this would do" preview, and a green **APPROVED / By: sam / Date …** stamp on a copy (my original untouched).
- **The Search Client connected with zero fuss** on loopback and showed my core's live data — pending approvals, filed docs, the lot.

---

## Top friction point
**The first real batch feels like all work and no payoff** (card 1): nine of ten documents held, "Sender not identified" on obvious letterheads, and half the document kinds "not set up yet." It's *safe* behaviour, and teaching fixes it — but it's front-loaded onto the exact moment a busy owner is deciding whether this thing saves them time.

## Would I keep using it after two weeks?
**Yes.** Because it never lied to me about where my documents went, everything I did was reversible, and once I'd taught a supplier it clearly remembered. The first-batch wall is real, but it's a one-time tax — and the practice run had already shown me that on the other side of it, documents start filing themselves. I'd push through it.

## Humility block
I'm one made-up office manager, not a real user test — don't read "users found." Three honest caveats: (1) the native "choose a folder" dialog couldn't be automated on this build, so I brought documents in through the app's own import function rather than the button — I didn't experience the Import screen's live progress bar first-hand. (2) Every sample was addressed to the same buyer, which likely makes the sender-recognition problem look worse than a mixed real inbox. (3) I enabled the Workflow and Search-Client add-ons myself as admin; an owner who hasn't bought those wouldn't see them at all. Findings 2 and 4 especially deserve a clean re-check before anyone acts on them.
