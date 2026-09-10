# Chris The Customer — Full App Review — 2026-09-10

**Round conditions (sandbox vet, `/christest`):** isolated second instance, CDP `http://localhost:9223`,
PID 18708, launched via `npm start` from source at HEAD `bfbac84`. Fresh 0-user DB (true first-contact).
The two new DARK auto-file arcs were ARMED in the sandbox DB for this round — `template_edge_clip_heal`
(mig 151) + `role_disagree_refuse_at100` (mig 152) — with parents `template_pad_window_code`/`_labelled`,
`teach_angle_compose_scan`, `trust_role_disagreement_refuse` all ON, `auto_file_threshold` 90,
`strict_100_autofile` off. Corpus: `Demo Docs` (born-digital) copied into the sandbox. Output to the sandbox
`Output`. Owner's live app + `%APPDATA%\ScanFinder` were OFF LIMITS and untouched. Findings are Chris's;
they change nothing — owner vet only.

---

I now have comprehensive coverage. Everything this round stayed strictly inside the sandbox (port 9223 / PID 18708; output, imports and all 20 filed docs are in the sandbox folders — no boundary crossing). Here is my report.

---

# Chris The Customer — Full App Review (2026-09-10)

**Who:** Chris Fenton, non-technical office manager. One simulated persona — NOT a user study.
**Where:** Sandbox only (CDP `http://localhost:9223`, PID 18708). Fresh 0-user install → created admin "Chris Fenton". Output folder set to the sandbox `Output`. Screens are real OS-window captures (`shots/stepNN_*.png`).
**This round's focus:** the two new auto-file safety behaviours and how clearly they're presented, plus the standard fortnight battery.
**Boundary note (owner, please read):** Unlike last round, I stayed entirely inside the sandbox — I never opened `%APPDATA%\ScanFinder` or the owner's app. Every action was port 9223 / PID 18708, and all filing went to the sandbox `Output`.

## What I did to surface the focus behaviours
A cold 20-doc import all correctly went to Review (nothing auto-filed cold). I then confirmed 10 Copperfield sales orders — that scope **graduated** (auto-file bar 90%) — and imported 10 *more* Copperfield sales orders. On the now-trusted scope: **8 auto-filed at 100%, and 2 were HELD for review despite reading 100%.** Those two holds are exactly the new safety nets, and they gave me the material to answer the focus questions.

## Focus verdict (a / b / c)
- **(b) A doc "held that would've filed silently" — OBSERVED, and handled well.** Two overall-100 docs were kept back: one because a **date was re-read after straightening** and one because a **customer name was flagged**. In both, the **correct value is shown** and the reason is findable on the field itself. `step08`, `step09`.
- **(a) A value recovered at a *lower* confidence — the scary-number risk did NOT materialise (on my evidence).** The clearest recovery I hit was **doc 28's date**: the page is visibly skewed, printed `03/06/ 2026`; the app straightened it, recovered the date from empty, and adopted it at **98% (High)** — *not* a scary low number — with a plain note *"Read differently after straightening — was '(empty)', now '03-06-2026' — confirm once."* I did **not** encounter a *code/reference* recovered at a visibly lower confidence in the born-digital demo set, so I can't fully judge that exact case (humility below). When I confirmed it, it filed to the **correct month** (`…/2026/June/Sales-Order.03-06-2026.SO-75446.pdf`).
- **(c) "In review when nothing looks wrong" — the app explicitly addresses this, and mostly nails it.** Three good summary variants: *"Nothing was flagged — this was read at 63%, below the 90% you've set for filing without a check… If documents like these are consistently right, lower the auto-file bar in Settings → Processing"* (`step16`) and *"Nothing looks wrong — … Overall 100% · waiting for your check. This isn't the confidence setting — changing that won't file this one"* (`step08`). That's genuinely thoughtful. The one real cry-wolf is Finding 2.

## New finding cards (ranked by harm)

### 1. A held doc's summary blames "a formatting check" when the real reason is a *straightening re-read* (or a name check)
- **Citation (verbatim, Review `step08`, doc "CopperfieldElectrical_sales_order_12"):** summary *"Nothing looks wrong — a value was flagged by a formatting check. Overall 100% · waiting for your check."* — while the actual field note under ORDER DATE reads *"Read differently after straightening — was '(empty)', now '03-06-2026' — confirm once."*
- **User-moment:** A doc reading 100% is in my queue; I read the summary to learn why.
- **Observed confusion:** The summary says "formatting check," so I hunt for a value whose *format* looks wrong. There isn't one — the real story is "we re-read the date after fixing the tilt." A straightening re-read is not a formatting problem. On doc 27 the same summary appears, but there the real reason is a *name* flag — so one generic sentence is used for two different, unrelated reasons.
- **Harm + severity:** trust-eroded. On a tool whose promise is "I show you what I did," a summary that misnames what it did undercuts otherwise-excellent copy.
- **Class:** CONFUSION.
- **Proposed alternative:** make the summary echo the field's own reason — *"A date was re-read after we straightened the page — please confirm it once"* / *"A name didn't look like a name — please check it."*
- **What I may be missing:** internally these may all be one "flagged" category; the fix is wording, not behaviour, and the correct per-field note *is* already shown right below.

### 2. A held doc's only "problem" is an obvious company name flagged "doesn't read like a name"
- **Citation (verbatim, Review `step09`, doc _11):** CUSTOMER *"Stonegate Property Mgmt"* (High · 70%) with *"doesn't read like a name — please verify ✓ This name is correct"*; this single flag held the whole 100% doc.
- **User-moment:** Checking why a perfect-looking sales order is in review.
- **Observed confusion:** "Stonegate Property Mgmt" is plainly a company. The "Mgmt" abbreviation trips the name check, so a normal business name pulls a document into review. If ordinary company names get flagged, I stop trusting the flag.
- **Harm + severity:** warning fatigue / slowed.
- **Class:** CONFUSION.
- **Proposed alternative:** treat common business tokens (Mgmt, Ltd, Co, &, Services) as name-like so the check keeps its meaning for genuinely odd values; keep the "✓ This name is correct" escape. (I'm only reporting a false-alarm; I'm not asking to remove the check.)
- **What I may be missing:** these are synthetic customers; a real "Mgmt" abbreviation may be rarer, and the one-click "This name is correct" is a reasonable mitigation.

### 3. Auto-filed docs report "100% confidence" while their own fields read 80–82%
- **Citation (verbatim, Search `step14`, SO-75446):** right panel shows **"Confirmed · 100% confidence"** while **Customer Name** shows **82%** (and supplier reads 80% under the hood).
- **User-moment:** Opening a filed doc to check it.
- **Observed confusion:** "100% confidence" next to a field that says "82%" doesn't add up. The 100% is really the learned-layout trust score, not a read of these fields.
- **Harm + severity:** trust wobble.
- **Class:** QUESTION.
- **Proposed alternative:** for a trusted/auto-filed doc show "Filed automatically (learned layout)" instead of a "100% confidence" that contradicts the field reads.
- **What I may be missing:** power users may want the raw score; and "confidence" is an industry word some buyers expect. (Same family as last round's Findings 3 & 5.)

### 4. A solo owner can't send anything for approval — and the message points at the wrong fix
- **Citation (verbatim, Search → ✉ Send… `step15`):** the **To** list reads *"No one can approve yet — grant stamping in Settings."* The admin's own stamp permission is off (`canStamp:false`).
- **User-moment:** Trying the approval feature as the owner.
- **Observed confusion:** As the only user, I have no one to send to — but the message tells me to "grant stamping," implying that's the blocker. Even the plain-language "Just so they've seen it" (acknowledge) option, which shouldn't need stamping, still shows the same line. The real missing piece is *a second person*.
- **Harm + severity:** a whole feature is unusable/confusing out of the box for the single-office segment.
- **Class:** QUESTION.
- **Proposed alternative:** when the sender is the only user, say *"You're the only user — add a colleague in Settings → Users to send documents for approval."* Whether the first admin should get stamping by default is a security-model call for you to vet (I'm only flagging).
- **What I may be missing:** approvals are a LAN add-on aimed at multi-user offices; a solo owner may simply never need it. I could not run a two-party approve/reject/recall cycle in a single-user sandbox.

### 5. The activity chips above Review show four counts that don't reconcile
- **Citation (verbatim, Review `step09`/`step10`):** *"8 filed automatically"*, *"You filed 9"*, *"9 more offered in File All Ready"*, and later *"Nothing filed — 12 kept back."*
- **User-moment:** Glancing at what the app has been doing to my documents.
- **Observed confusion:** Four different numbers about auto-filing/filing, including a stale-looking "9 more offered in File All Ready." As the person accountable for mis-files, I want *one* trustworthy number for "what did it file by itself."
- **Harm + severity:** slowed / mild trust erosion.
- **Class:** PREFERENCE.
- **Proposed alternative:** collapse to one running line ("Filed automatically: 8 · You filed: 10 · Held for a check: 2").
- **What I may be missing:** these are a live event log; each chip may be individually correct for its moment. (Same family as last round's Finding 5.)

## Warnings truth-table (this round)
| Action | What it warned | What actually happened | True? |
|---|---|---|---|
| **Delete a document** | *"It goes to the app's recycle bin — you can restore it from Search."* | Soft-delete (status `deleted`), file kept on disk, restored cleanly (count 12→11→12). | **TRUE — verified end-to-end.** |
| **Delete All Review** | *"Delete ALL 10… recycle bin… restore any time from Search… Files on disk are kept. Confirmed and deferred documents are NOT affected."* | 10 → bin, `restore all` brought all 10 back; confirmed docs untouched. | **TRUE — verified end-to-end.** |
| **File All Ready (0 ready)** | button | Chip: *"Nothing filed — 12 kept back."* Did **not** file the below-floor or flagged docs. | **TRUE — verified.** |
| **Confirm & File** | files to Company/Year/Month | `Output/Copperfield-Electrical/2026/July/Sales-Order.12-07-2026.SO-19736.pdf` | **TRUE — verified.** |
| **Confirm a HELD (100%) doc** (behaviour b) | held with a recovered value | Filed to the correct month for the recovered date (`…/2026/June/…SO-75446.pdf`). | **TRUE — verified.** |
| **Send back to Review** (Search) | *"Send this document back to the Review queue? It stays filed until you re-confirm it."* | Dismissed — not executed; wording is honest. | Honest (not executed). |
| **Reprocess** (a review doc) | *(no destructive consent shown)* | Reprocessed in place; nothing overwritten/auto-filed. | Appropriate — no false claim. |

Every destructive warning I could execute **told the truth.** This remains the app's strongest area.

## Previously-reported items re-verified
- **09-09 Finding 1 — phantom "Format check · 1" on future-dated docs → FIXED.** A Ridgeway invoice dated 18-12-2026 now shows only *"Needs a quick check — 1 field was read with low confidence · Low confidence · 1"* pointing at the Document Issuer; no format-check chip (`step10`). (The "formatting check" *wording* survived only on the graduated auto-file-path holds — see new Finding 1.)
- **09-09 Finding 6 — separator sheet unexplained → FIXED.** The Import screen now carries *"Put a printed separator sheet between documents when you scan a stack — Scan Finder splits the batch into separate documents wherever it sees one."* (`step06`).
- **09-09 Finding 5 — mismatched counts → BETTER-BUT.** Still present as the Review activity chips (new Finding 5).
- **09-09 Findings 2, 4, 7 (Export "Filed folder" column; "Off by default" toggles shown ON; backup accepted a fabricated fingerprint) → NOT re-tested** this round (I didn't open Export, Processing settings, or Backup — the last deliberately, after last round's incident).

## What genuinely worked
- **The new hold-then-recover behaviour actually did its job:** two docs that would otherwise have auto-filed at 100% were held, the recovered/flagged values were correct, and confirming filed them to the right month.
- **The "why is this in review" copy** — *"Nothing was flagged — read at 63%, below the 90%…"* and *"Nothing looks wrong … waiting for your check. This isn't the confidence setting."* — is the best answer I've seen to "a perfectly fine doc is stuck."
- **Filing correctness:** 20/20 filed to correct Company/Year/Month with tidy names; skewed pages read and filed correctly.
- **Delete/restore + Delete-All truthfulness** (verified both directions).
- **Onboarding integrity:** create-admin, recovery-code (Continue greyed until you tick), Terms gate, wizard trust copy, and the Teach-wizard entry all intact and jargon-free.

## Top friction
**Finding 1 — the held-doc summary calls a straightening re-read (and a name check) "a formatting check."** It's the one place the app misnames its own excellent work, and it lands right on the new auto-file safety surface the owner most wants to feel trustworthy.

## Would I keep using it after two weeks?
**YES.** It files my paper correctly, its automatic actions show their work, its destructive warnings are honest, and the new safety nets held back exactly the two documents that deserved a second look — with the correct values on screen. The friction is wording, not danger: a summary that says "formatting check" for a straightening re-read, an obvious company name flagged as "not a name," and a "100% confidence" that doesn't match the field reads. Tidy up that held-doc summary and this is a confident yes.

## Humility block
I'm **one simulated persona, not a user study.** Key limits this round: (1) **Behaviour (a) — a *code* recovered at a *lower* confidence — I never encountered** in the born-digital demo set, so my read on "does the lower number scare you" is inferred from the analogous *date* re-read (which read 98%, so it didn't); a scanned/clipped-code case could look different. (2) I could **not complete a two-party approval cycle** (single-user sandbox), so workflow is judged only from the Send dialog, the Mailbox empty state, and the stamping gate. (3) Several checks were driven through the app's own services where a **native OS dialog** couldn't be operated by my driver — I've said so at each point and never claimed an action I didn't complete; notably one native delete-confirm briefly hung my driver (the round-5 trap) and I dismissed it with Cancel before re-running cleanly. (4) I may be wrong that "Stonegate Property Mgmt" would be a real customer's exact printed name. All findings are suggestions for the owner to vet — they change nothing by themselves.
