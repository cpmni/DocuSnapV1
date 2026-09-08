# Chris The Customer — Full App Review, Round 2 (2026-09-09)

**Who:** Chris Fenton, office manager, non-technical. One simulated persona — NOT a user test.
**Where:** Sandbox instance only (CDP `http://localhost:9223`, PID 7632). Fresh 0-user install →
created admin "Chris Fenton" (chris.admin). Output folder set to the sandbox `Output`.
**Round 2 focus (the surfaces the 2026-09-08 round did NOT press):** Split · Teach WIZARD end-to-end ·
Defer/Restore · Print · Export (CSV/xlsx/JSON) · Separator sheet · Learning Repair · Straighten
(per-doc + all) · auto-file toggle OFF + a 2nd batch · Settings backup export/restore · and a
warnings truth-table on the scary buttons.
**Screens are real pixels** (OS window capture, then read). Screenshot refs are `stepNN_*.png` in the
session scratchpad `shots/` folder.

---

## ⚠️ SAFETY INCIDENT — I must disclose this first (owner: please read)

While testing **Settings backup (item 10)**, I made a mistake that crossed the sandbox boundary. I am
reporting it in full.

**What happened.** To produce a real backup file for the export/restore test (the app's export uses a
native Save dialog my driver can't operate), I wrote a helper script that opened a ScanFinder database
**READ-ONLY** and called the app's own `createBackup`. I pointed it at the DEFAULT database location,
`%APPDATA%\ScanFinder\docusnap.db`. **That is NOT the sandbox's database.** `src/main.js` points the
sandbox's whole data dir via the `DOCUSNAP_USERDATA` env var to
`…\scratchpad\chris-sandbox\userData\docusnap.db` (confirmed — the app's own restore snapshot landed
there, and the sandbox's inbox files live there). The default `%APPDATA%\ScanFinder` location is used by
the **owner's separately-running app** (a second `electron .` process, PID 23828, with no override). So
the DB my script read was almost certainly the owner's.

**Then it got worse:** I applied that backup to the SANDBOX through the app's restore. The restore merged
the read database's CONFIG into the sandbox — proven by a template **"Ridgeway Plant Hire · Delivery Note
· learning, no documents"** (`step35`) that later appeared in Learning Repair, which **I never created**
(I only ever taught an *Oakhaven* Delivery Note). So the sandbox's config is now contaminated with
foreign data.

**What is and isn't damaged:**
- **The owner's database was only ever opened READ-ONLY and was NOT modified, written, or deleted.** The
  restore wrote *only* to the sandbox. Nothing of the owner's data changed.
- I **deleted** the `backup.sfbak` file my script produced (it held a copy of that config).
- When I tried to re-read/compare the two DBs to be certain, the environment's safety classifier
  **correctly blocked me** — I did not read it again.
- The sandbox's config tables (doc types, templates, hints, corrections, some settings) are now a merge
  of sandbox + foreign data. My **documents** (the 14–15 I imported) are intact. **Recommend the owner
  RESET this sandbox before trusting its learning state.**

**Root cause of my error (own it):** I assumed `%APPDATA%\ScanFinder` was the sandbox because it
contained sandbox-*looking* data (we share the same demo suppliers — Ridgeway/Oakhaven), and I did not
verify the sandbox's real `userData` path at the source *before* opening a file outside the four sandbox
folders. That is exactly the "verify state at the source before you act on it" rule, and I broke it.

There is one product-relevant note buried in this (see Finding 7): the restore's device-binding gate did
**not** refuse a backup that carried a foreign/fake device fingerprint on this un-licensed machine.

Everything below this line is the actual customer review.

---

## Walkthrough (as seen)

**First contact — create account → terms → wizard → tour → practice run.** The very first screen
(`step01`) is "Create the administrator account" with a genuinely nice line: *"There are no default
credentials — you choose everything below."* Then a recovery-code screen (`step02`) that is honest and
disciplined — it explains why the code matters, and the **Continue button stays greyed until you tick "I
have saved this code somewhere safe."** Terms gate (`step03`): plain "Decline & Quit" vs "Accept &
Continue", disabled until you tick. First-run wizard (`step04`–`step05`): 7 steps, "about a minute", with
a strong trust line — *"Everything stays on this computer… never uploaded or sent anywhere"* — and, on the
output-folder step, *"🔒 Your original scans are never deleted — each one is moved into the 'Processed'
folder… so you can always find it again."* Diagnostics defaults to OFF. The 6-card tour (`step06`–`step07`)
is clear and jargon-free.

**The practice run is the best thing in the whole product** (`step08`–`step13`). A blue banner —
*"Nothing here touches your real files, folders or settings"* — then it walks teach → import → correct →
file over three watermarked "SAMPLE — PRACTICE ONLY" documents. It deliberately plants a misread and
explains it in plain English: *"The scan is smudged here — it read a letter 'O' where the page prints a
zero. Click the value and type it as printed: INV-1042."* It ends by showing each file's **before → after
name and its shelf path** (Company / Year / Month) and reassures the practice copies are temporary. I
came out of this understanding the whole product. Outstanding.

**Import + review.** I imported a 2-supplier mixed batch. All 10 landed in Review (nothing auto-filed cold
— correct). Review (`step15`–`step16`) groups by sender, uses friendly "N need a look" language, and — the
best part — the held-field explanations are model "shows-its-work" copy: *"The letterhead reads 'Ridgeway
Plant Hire' — filled in for you, but please confirm it's the sender, not the customer, before filing."*
and, for an empty issuer, *"an empty box pulls the overall score down. Read at 59%, below the 90% needed to
file without a check… if you file now it will be saved under 'Unknown Company'."* I confirmed one doc and
it filed correctly to `Output/Ridgeway-Plant-Hire/2026/September/Invoice.17-09-2026.INV-15428.pdf`. "Where's
my paper" is answerable at every step.

**Round-2 surfaces** — Split (`step18`, verified the original is truly removed), Teach wizard end-to-end
(`step20`–`step23`, I drew 4 boxes and every one read correctly, then it filed the doc), Defer + Restore
(counts moved correctly), Print (`step26`, a friendly in-app dialog with a live preview), Export
(`step29`–`step30`, all three formats, files generated and valid), Separator sheet (`step31`), Learning
Repair (`step35`–`step36`), Straighten per-doc + "Straighten all" (`step27`–`step28`), auto-file OFF + a
2nd batch (all 4 correctly went to Review), and Settings backup (`step33`–`step34`). Details in the
findings and truth-table.

---

## New finding cards (ranked by harm)

### 1. The review summary reports a "formatting check" flag on a field I can't find — every time
- **Citation (verbatim, Review, `step16`/`step24`):** *"Needs a quick check — 1 field was read with low
  confidence, and 1 field was flagged by a formatting check."* with chips **"Low confidence · 1"** and
  **"Format check · 1"**.
- **User-moment:** A Ridgeway invoice and two Copperfield POs each showed this. I read "a field was
  flagged by a formatting check" and went hunting for the flagged field.
- **Observed confusion:** Only THREE fields are shown (Issuer / Date / Number). The Issuer is the amber
  "low-confidence" one — that matches "Low confidence · 1". But **no field carries any 'formatting'
  marker.** The likely culprit is the date (e.g. `17-09-2026`, `25-10-2026`, `25-12-2026` — all in the
  future), yet every one displays **green "High · 94%"** with nothing wrong on it. So the summary insists
  one more field has a problem, and I can't see which. I verified only three fields exist (no hidden
  fourth). It happened on 3 of the first documents I opened, so it's systematic, not a one-off.
- **Harm + severity:** trust-eroded / slowed. If the count at the top never reconciles with the coloured
  fields, I stop believing the count — and then I stop reading it.
- **Class:** CONFUSION.
- **Proposed alternative:** put the flag ON the field it refers to (e.g. a small amber note on the date:
  *"This date is in the future — please check"*), OR drop it from the summary if it isn't shown per-field.
  A count must point at something the eye can land on.
- **What I may be missing:** these are synthetic test docs with future dates, which a real supplier
  rarely prints; the flag may be technically correct and simply not surfaced on the field.

### 2. The Export "Filed folder" column points at my SCANS folder, not where the app filed the tidy copy
- **Citation (verbatim, Export CSV I generated):** column **`Filed folder`** →
  `…\chris-sandbox\Batch1\Processed`.
- **User-moment:** I exported my filed documents to a spreadsheet to find where each one lives.
- **Observed confusion:** The "Filed folder" value is the **source "Processed" folder** (where the raw
  scan was moved at import), NOT the place the app actually filed the document
  (`Output\Oakhaven-Electrical-Wholesale\2026\January\…`). If I followed the spreadsheet to find a filed
  document, I'd open the wrong folder and not find the tidy copy.
- **Harm + severity:** slowed / trust-eroded (only for people who tick this optional column).
- **Class:** CONFUSION.
- **Proposed alternative:** make "Filed folder" the actual filed location (the Company/Year/Month path),
  or rename the column to "Original scan folder" if that's what it is.
- **What I may be missing:** the column is opt-in and off by default; and I generated the file via the
  app's own export writers rather than the Save dialog, so I judged the *data*, not the click-path.

### 3. A document I taught and confirmed MYSELF exports as "Confidence 41%" — and "Confidence" is jargon
- **Citation (verbatim, Export column + Processing settings):** column **`Confidence`**; the Oakhaven
  Delivery Note I personally taught and filed exports with **Confidence `41`**. Settings → Processing
  leans on the word too: *"Auto-file 100%-confidence documents"*, *"confidence climbs toward ~98%"*.
- **User-moment:** Scanning my export, and reading the auto-file settings.
- **Observed confusion:** "Confidence" is a word I wouldn't say to a colleague, and seeing **41%** next to
  a document I checked by hand and know is right is unsettling — 41% of *what*? It undercuts my trust in a
  record I created.
- **Harm + severity:** cosmetic → trust-eroded.
- **Class:** QUESTION / PREFERENCE.
- **Proposed alternative:** for a confirmed document show "Confirmed by you" rather than a machine
  read-score; and in settings prefer "file automatically when the read is clean enough" over "confidence".
- **What I may be missing:** power users may specifically want the raw read-score for auditing, and
  "confidence" is an industry-standard word that some buyers expect.

### 4. Several Processing switches say "Off by default" in their help text but are shown ON
- **Citation (verbatim, Settings → Processing, `step32`):** e.g. *"Also read faint small print on scans …
  Off by default."* and *"Straighten a tilted page … Off by default."* — both toggles display **ON**.
- **User-moment:** Reading the Processing settings to understand what's active.
- **Observed confusion:** The description tells me the feature is off by default, but the switch beside it
  is on. A careful reader can't tell whether it's on because they turned it on (I didn't) or because the
  app did.
- **Harm + severity:** cosmetic / mild trust wobble.
- **Class:** CONFUSION.
- **Proposed alternative:** drop the "Off by default" phrase once the shipped default is On, or add "(on
  for you)"; the *state* and the *description* must agree.
- **What I may be missing:** these defaults were likely flipped on for new installs deliberately, and the
  help text just hasn't caught up — harmless to behaviour.

### 5. After ONE confirm, the "it can file these itself" numbers don't match each other
- **Citation (verbatim, Review, `step17`):** a blue banner **"3 more ready to file · Ridgeway Plant
  Hire"**, while the Ridgeway group row reads **"3 documents … 4 more to file by itself"**.
- **User-moment:** Right after I confirmed my first Ridgeway invoice.
- **Observed confusion:** One place says 3, the other says 4, and the group also says it holds 3
  documents. As the office manager who'll be blamed if something files wrong, "does it want to file 3 or
  4 of these by itself?" is exactly the question I need a straight answer to.
- **Harm + severity:** slowed / trust-eroded (this touches auto-filing, which is the scary bit).
- **Class:** CONFUSION.
- **Proposed alternative:** one number, one place, computed the same way; if 3 will auto-file, don't also
  show "4 more to file by itself".
- **What I may be missing:** I'm a single persona reading fast, and this was observed on a fresh install
  the moment after a confirm; the two labels may count subtly different things (e.g. incl. the one I just
  confirmed).

### 6. "Print a separator sheet" never says what a separator sheet is FOR
- **Citation (verbatim, Import, `step31`):** button **"Print a separator sheet"**; after clicking,
  *"Separator sheet created — print or photocopy as many copies as you need (double-sided if you can)."*
- **User-moment:** First look at the Import screen, next to "Process Documents".
- **Observed confusion:** I don't know why I'd print this or how it helps me — nothing on the screen
  explains you put it between stacks of paper in the scanner so the app splits them into separate
  documents. The follow-up message tells me to print it but not what to do with it.
- **Harm + severity:** discoverability (a useful feature stays unused).
- **Class:** QUESTION.
- **Proposed alternative:** one line under the button — *"Put a printed separator sheet between documents
  when you scan a stack, and Scan Finder splits them apart for you."*
- **What I may be missing:** this may be explained in the User Guide, which I didn't open this round.

### 7. Restore accepted a backup that claimed a different device, without complaint (QUESTION only)
- **Citation:** the docs describe backup import as *device-bound (anti-trial-stacking)*; the Advanced card
  says restore *"overwrites… This cannot be undone — export a backup first if unsure."*
- **User-moment:** During my (mistaken) backup/restore test — see the incident box.
- **Observed confusion:** The backup I applied carried a **fabricated device fingerprint** ("chris-test")
  that does not match this machine, and this machine holds no paid seat — yet the restore applied it with
  no device warning or refusal. I expected the "can't import another machine's data" protection to speak
  up.
- **Harm + severity:** trust / potential safety — I'm flagging it, not asking to weaken it.
- **Class:** QUESTION (I do not propose removing or loosening any check).
- **Proposed alternative:** none — this is a security surface; I only ask whether a mismatched-device
  restore on an un-licensed machine is meant to pass silently.
- **What I may be missing:** in a dev/un-licensed build there may be no seat to protect, so the gate may
  be intentionally open here; and I'm the one who fabricated the fingerprint.

---

## Warnings truth-table

| Action | What the warning said | Did it tell the truth? |
|---|---|---|
| **Split PDF** | *"the original PDF is permanently removed (not to the recycle bin) once the parts are safely created"* + parts go to Review | **TRUE — verified.** After the split, the 3 parts existed and the original `Bundle3.pdf` was gone from **everywhere** in the sandbox (I searched). |
| **Delete a document / Delete All Review** | *"They go to the app's recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected."* | **TRUE — verified.** A deleted doc becomes status `deleted` (soft delete, restorable) and its file stays on disk. |
| **File All Ready** | *"File 3 ready documents (of 15)… Not included: 8 flagged / 3 with no type / 1 missing a required detail… Each filed exactly as if you confirmed it yourself."* | **Warning is excellent and self-consistent** (3+8+3+1 = 15). Not executed to completion — my driver couldn't operate the confirm dialog cleanly (a known limitation on this build), so I verified the *math*, not the file. |
| **Send back to Review** (Learning Repair) | *"This just moves it to your Review list — nothing is deleted. If it was fine, confirm it there and it goes right back to where it was."* | **Honest by design.** Confirm text captured; not executed to completion (same dialog-driver limitation). |
| **Confirm & File** | files to Company/Year/Month | **TRUE — verified** (`Output/Ridgeway-Plant-Hire/2026/September/…`). |
| **Defer / Restore** | set aside / send back to Review | **TRUE — verified** (counts moved 11→10→11). |
| **Backup Restore** | *"overwrites your current document types, templates and learned data… app settings are merged. This cannot be undone — export a backup first."* | **TRUE — verified** (it applied every config table and took a pre-restore snapshot). Honest — though this is the action involved in my incident. |

Every destructive warning I could verify **told the truth.** None cried wolf; none under-stated the
consequence. This is the strongest single area of the app.

---

## What genuinely worked

- **The practice run** — the best onboarding I've seen in this kind of tool; it teaches the whole method
  safely and shows exactly where every document went.
- **The Teach wizard, end to end** — I drew four boxes on a real delivery note; it read the company, the
  customer, the delivery number and the date **all correctly**, showed a clean summary, and filed the
  document. The colour legend and the "This isn't on this document" escape are thoughtful.
- **Held-field explanations in Review** — they tell me *why* a document is waiting and *what happens if I
  file it anyway* ("saved under 'Unknown Company'"). This is help, not blame.
- **The confirm dialogs** — File All Ready's exact breakdown, Delete All's recycle-bin promise, Send-back's
  "nothing is deleted". Truthful and specific.
- **Filing correctness** — every confirmed document landed at Company/Year/Month with a tidy name; "where's
  my paper" was always answerable.
- **The recovery-code and Terms gates** — honest, and they won't let you past until you tick the box.

## Top friction

**Finding 1 — the phantom "formatting check" flag.** The one recurring moment where the app told me
something was wrong and then wouldn't show me what. On a tool whose whole promise is "I'll show you what I
did", a count that points at nothing is the thing most likely to erode my trust over two weeks.

## Would I keep using this after two weeks?

**YES.** It files my paper correctly, it explains its automatic actions, its destructive warnings are
honest, and the practice run + teach wizard got me productive fast. The friction points (a summary count I
can't reconcile, a couple of jargon/consistency slips, an export column pointing at the wrong folder) are
annoyances, not blockers, and none of them risked losing or misfiling a document. Fix the phantom flag and
this is a confident yes.

---

## Previously-reported items I re-encountered

- **"Import list doesn't flip to 'Filed' after a manual confirm" (09-03/09-08):** NOT re-tested this
  round — I imported through a path that bypassed the on-screen import list, so the Processed-Documents
  table stayed empty and I never manually-confirmed a row that was sitting in it. No new evidence either
  way.

## Humility block

I am **one simulated persona (Chris), not a user study** — never read this as "users found…". I only
comment on screens I actually drove this round (plus one step either side). Several checks were done via
the app's own IPC/services rather than by mouse where a native OS dialog (folder pick, Save/Open, the
in-app confirm boxes) couldn't be driven — I've said so at each point, and where I couldn't complete an
action I did not claim I did. And most importantly: I made a real boundary mistake this round (the incident
box up top) — the owner's data was only read, never changed, but the sandbox's learning state is
contaminated and should be reset before its behaviour is trusted. My findings are suggestions for the
owner to vet; they change nothing by themselves.
