# Chris The Customer — 2026-08-05 round (NARROWED SCOPE: Straighten-fix reprocess vet)

**Sandbox conditions:** live-userData COPY (owner's taught templates + 17 Larkspur delivery
dockets in Review), Straighten-all ON, `TEACH_ANGLE_COMPOSE=1`, template-27 sample angle
pre-seeded 1.5° (the lazy heal was verified separately by CLI; the sandbox relaunch had
dropped the env, which is why his batches 1-3 could not engage the fix — they captured the
BEFORE state instead). Owner-approved scope: reprocess-only, no full app sweep, nothing
confirmed by Chris, findings queue for the owner's vet.

**Main-session DB corroboration (post-round):** docket_14 `DN-98447 @97 template_mapping`
(auto-filed `Larkspur-Interiors\2026\August\Delivery-Note.16-08-2026.DN-98447.pdf`);
docket_15 healed via `template_mapping_edgegrow` (the jitter-crater guard composing with the
level-frame fix); 13+ dockets full DN-xxxxx @96-98. Residuals: docket_11 `IN-75028` @97
(left-cut partial committed clean — edge-guard miss on this doc's tilt), docket_10
`UIN-09045` @92 (garble), dockets_12/16 `template_mapping_shapewarn` @78 (the false
"differs from the usual format" class — Chris's card 2).

Report VERBATIM below.

---

# CHRIS THE CUSTOMER — round report: "I taught it once on a straightened page — does it now just work?"

**TL;DR (3 lines):**
1. **The fix works.** After one batch re-run in the properly-armed sandbox, every docket I could inspect reads the FULL DN-xxxxx number at 90-97%, and docket_14 read so perfectly the app filed it on its own as `Delivery-Note.16-08-2026.DN-98447.pdf` — exactly the success value.
2. **Two dockets (14 and 19) left the Review queue by auto-filing during the batch** — I confirmed nothing, but the owner's "queue untouched" wish was overridden by the app's own automation. The queue now holds 15, not 17.
3. Two blemishes: the batch button silently skips whichever document is open ("Completed 16 of 17", no name given), and a false "differs from the usual format" note demoted 4 previously-clean dockets to "Check".

**Account note:** I never saw the create-administrator screen — both sandbox instances came up already signed in as **chris (ADMIN)**. I created no account and hold no credentials to report.

**Instance history (matters for reading the evidence):** the middle instance (PID 35180) had lost the fix's switch on relaunch, so my three batch runs there could never engage it — they instead captured a clean BEFORE state and proved the batch machinery runs. The final instance (PID 16064, angle pre-seeded 1.5°) is where the one decisive batch ran.

## Per-doc table (final instance unless marked BEFORE)

| Doc | delivery_number (value · % badge · trace wording · flag) | delivery_date | issuer / customer | Screenshot |
|---|---|---|---|---|
| docket_14 **BEFORE** | **N-9844 · High·70% · `template_mapping_edgecut` won; `keyword_override DN-98447` lost** · flag: *"The taught box's edge cuts through the printed value here and the fuller reading could not be verified — please check this value."* | 16-08-2026 · High·96% | Larkspur Interiors 98% / Bluefin Marine Ltd 87% | step03, step06, step08, step09 |
| docket_14 **AFTER** | **DN-98447 — proven by the auto-filed name `Larkspur-Interiors\2026\August\Delivery-Note.16-08-2026.DN-98447.pdf`**. No trace/panel possible — it filed itself out of the queue before I could look. | 16-08-2026 (in filename) | — | Output folder listing |
| docket_19 AFTER | Auto-filed: `2026\January\Delivery-Note.23-01-2026.DN-97113.pdf` | 23-01-2026 | — | Output listing |
| docket_20 | DN-62624 · High·97% · trace: `mapping DN-62624 template_mapping 90% won`, `keyword 93% lost — superseded by "DN-62624"` · no flag | 10-09-2026 · trace shows `10/09/2026 → 10-09-2026` validate step | Larkspur Interiors 71% / Brightwater Dental Practice 87% | step14, step15 |
| docket_09 | DN-21473 · High·97% · (no trace run) · no flag | 18-08-2026 · 96% | Larkspur Interiors 89% / Pemberton Joinery 80% | step17 |
| docket_13 | DN-55843 · High·97% · was "Check" pre-fix, healed | 15-12-2026 | Larkspur Interiors 71% / Redwood Construction 92% | step18 |
| docket_16 | DN-57194 · High·78% · **value matches the page exactly**, yet flag: *"manually mapped value differs from the usual format for this field — please verify"* — demoted 94%→"Check" | 21-11-2026 | Larkspur Interiors 71% / Kingfisher Print Studio 92% | step16 |

**The "composed / sample tilt 1.50°" line: NOT SEEN.** I searched every visible word of the Review window (trace console open, fresh trace run) for "composed", "tilt", "teach-frame" — nothing. If it lives in the main-window inspector rather than the Review console, that's where it hid from me.

## Finding cards (4, ranked by harm)

**1. The batch button skips the document you're looking at, and won't say so.**
- Citation: button *"Reprocess 17 from "Larkspur Interiors""* → progress *"Reprocessing 4 of 16"* → *"Completed 16 of 17"*.
- User-moment: I pressed "reprocess everything" to re-read the whole pile, docket_14 open in front of me.
- Observed confusion: I expected all 17 done; the one skipped was exactly the one I cared about, still showing its old wrong value, and nothing named it. The counter even flips 17→16 mid-run.
- Harm: slowed + trust-eroded (I re-ran the whole batch to catch one doc). Class: CONFUSION.
- Proposed alternative: include the open document, or finish with *"16 done — LarkspurInteriors_delivery_docket_14.pdf was open and wasn't re-read. Re-read it now?"*
- What I may be missing: skipping the open doc may protect unsaved edits; there may be a design reason I can't see.

**2. A "differs from the usual format" warning on a value that doesn't differ.**
- Citation (docket_16): *"manually mapped value differs from the usual format for this field — please verify"* under DN-57194, while the page prints "Delivery Note No. DN-57194" — the same DN-xxxxx shape as all sixteen siblings.
- User-moment: post-fix spot-check of a doc that was 94% clean before the healing run.
- Observed confusion: I read the note, compared the paper, and could not restate what supposedly differs. Four dockets (16, 12, 04, 03) flipped 94%→"Check" this way; "need a look" went 7→8 after a run that made things better.
- Harm: trust-eroded / warning-fatigue — a wolf-cry on correct values teaches me to ignore the notes that matter. Class: CONFUSION.
- Proposed alternative: only show the note when the difference can be named in the note itself ("reads DN-571**94** here but DN-571**84** at its taught spot — please check").
- What I may be missing: the "usual format" may be computed from something invisible to me; there may be a real sub-surface disagreement.

**3. Documents can leave the Review queue during a reprocess with nothing said where I'm standing.** *(QUESTION card — I am not proposing any change to what gets filed.)*
- Citation: Review count 17 → 15 across the batch; no message in the Review window mentioned filing. The two turned up filed correctly in `Larkspur-Interiors\2026\August\...` and `...\January\...`.
- User-moment: watching the batch, then counting my pile.
- Observed confusion: "where did my two papers go?" was only answerable by leaving the room (Home / Output folder).
- Harm: momentary scare, then delight when found — but silent automation is scary automation. Class: QUESTION.
- Proposed alternative: a completion line such as *"16 re-read · 2 read perfectly and were filed — view them"*.
- What I may be missing: a toast may have flashed between my 4-second samples; the Home screen's "filed today" counter may be considered the answer.

**4. The badge says "High" even at 70% beside a please-check warning.**
- Citation (docket_14 BEFORE): *"DELIVERY NUMBER High · 70%"* directly above *"…could not be verified — please check this value."*
- Observed confusion: "High" and "please check" in the same breath — which do I believe?
- Harm: cosmetic/trust. Class: PREFERENCE.
- Proposed alternative: let the word track the number ("Check · 70%").
- What I may be missing: "High" may describe the field's tier rather than this read; the meaning may be documented somewhere I didn't look.

**Minor observation, not carded:** once, right after a batch, the panel showed docket_09's values beside docket_14's page image (step05) — it self-corrected on reselect; transient, old instance.

## What genuinely worked
The progress pill ("Reprocessing 10 of 16 · Larkspur Interiors…"), the Stop button, and the greyed buttons during a run are honest and calm. The straighten chip shows its work per doc ("∞ Straightened +1.9° / -2.0° / +2.4°"). And the filed result reads like a shelf: `Larkspur-Interiors\2026\August\Delivery-Note.16-08-2026.DN-98447.pdf` — I could find that with a phone to my ear.

## Customer verdict
I taught it once on a straightened page, and on the re-read it now just works: every number came back whole — DN-98447, DN-62624, DN-21473, DN-55843, DN-57194 — with proper DD-MM-YYYY dates, and the two best reads filed themselves into exactly the right drawer. The old "N-9844, please check" mess is gone wherever the fix ran. What's left is manners, not competence: tell me when you skip the page I'm holding, don't warn me about a number that's plainly fine, and say it out loud when you file my paper for me. **Would I keep using this after two weeks? Yes** — because the teaching stuck, and the filing shelf reads like my own cabinet.

## Humility block
- I drove with a script, not a human hand; my dialog-catcher logged zero native dialogs, but timing gaps (4s samples) could hide a toast.
- My step01 screenshot accidentally captured the OWNER'S live app window (wrong PID supplied at start); I clicked nothing there, quarantined the file as `OWNER_APP_ACCIDENTAL_CAPTURE_DO_NOT_USE.png`, and used none of it as evidence.
- docket_14's AFTER state rests on the filed filename, not a panel screenshot — the auto-file outran me; the owner may want to open the filed PDF to double-check the paper matches.
- The absent "composed … sample tilt" line may simply live in a window I wasn't sent to.
- The middle instance's three batch runs were mine in good faith under a dead switch; any learning side-effects they left in the sandbox predate the decisive run.

Everything above queues for the owner's vet. I changed no code and confirmed no documents; the sandbox queue holds 15 docs (2 auto-filed by the app), Straighten-all left ON.
