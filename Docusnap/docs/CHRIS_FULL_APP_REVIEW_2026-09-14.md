# Chris The Customer — full-app review, 2026-09-14 (night run of 2026-09-13)

> **Round conditions:** sandboxed ONLY — a fresh core instance (`scratchpad\night-sandbox\userData`, seeded with the
> machine-bound licence rows + two users, dev build `TEST_BUILD=1`, CDP 9223, its `/v1` on 127.0.0.1:8797) and the
> REAL detached client (`--user-data-dir` scratch, CDP 9226) pointed at it; a COPY of `Desktop\Demo Docs`. Focus: the
> client search parity arc shipped 2026-09-13 (S0→S4: the shared Search screen, the client's search POP-OUT window,
> approvals/stamps in it, the four `/v1` preview reads, the re-centred client Quick File). Screenshots under
> `scratchpad\night-sandbox\shots\` (session-mortal). Report appended VERBATIM below; the main session's triage follows.

---

# Chris The Customer — round on the shared Search window (core + client), 13 Sept 2026, sandbox only

**TL;DR (3 lines)**
1. The client's **Search** button opened its own window for me every time (four times, two users) — same screen as the core's, and Find/zoom/stamp/approve all worked over the network.
2. Two things in the client search window would make me distrust it: **"Delete permanently" left the file on the shelf** while telling me it was gone, and **the Recycle-bin view won't let go** (a purged document keeps a live Restore button; Home hand-overs land beside "The recycle bin is empty").
3. The client's **Quick File** page is a dead end ("No Quick File types — ask an admin to add one") even though the same account files fine from the core.

All screenshots: `…\scratchpad\night-sandbox\shots\` (filenames cited below).

## Walkthrough

**Core (nightadmin).** Sign-in → Terms gate (`02_core_terms.png`, clear, Accept greyed until ticked) → Home already pointed at the sandbox `Output\` (`03_core_main.png`). Imported `Ridgeway Plant Hire\invoice` (20 scanned, 36 s, `07_ridgeway_done.png`), `Saltmarsh Seafoods\delivery_docket` (20), `Other\SINGLE` (10 typed), and the one 34-page stack in `.sf_separated_originals` (it came in as 34 blank single pages, `18_multipage_done.png`). Reviewed: 9 Ridgeway confirmed by hand, then the strip said **"✓ 11 filed themselves · Ridgeway Plant Hire"** and Import showed the banner *"Scan Finder has learned Ridgeway Plant Hire — their clean Invoice documents will now file automatically"* (`11_confirm_after.png`, `18_multipage_done.png`) — every one of the 20 landed in `Output\Ridgeway-Plant-Hire\2026\<Month>` on disk. Added "Delivery Note" from the catalog via the Review note's own button (`13_addtype.png`), filed one docket; typed the company name on three typed documents and filed them (`19_pelican_review.png`). Then the core **Search** window battery (`20…24, 33, 38, 41–52`).

**Client (nightadmin).** Signed the read-only user out (its search window closed), signed in (`27_client_home.png`), pressed **Search** → separate window within ~2 s, "CONFIRMED 23" (`29_client_searchclick_main.png` shows the new window). Battery: Find on a scanned page and a typed page, zoom, ↑/↓, bin round-trip, stamp PAID over the network (`54_client_stamp_placed.png`), send-for-information, send-to-self-for-approval, approve via the popup's "waiting on you" panel (`57_client_waiting_history.png`, `61_client_after_approve.png`), Mailbox tabs (`59_client_mailbox_*.png`), Home search box + Recently-filed hand-overs (`46`, `50`), Dark mode (`62_client_dark_searchwin.png` — followed instantly), sign-out (window closed), Quick File (`65`, `67`).

**Read-only (nightreader).** Sidebar trimmed to Home / Search / Mailbox 2 / Settings (`70_reader_home.png`); Search window opened; on a document: Find + zoom only, no Delete, no Send, no bin; the Delete key did nothing (`71_reader_searchwin_doc.png`); Mailbox shows the two "for information" items with no buttons (`72_reader_mailbox.png`).

## Finding cards (new, ranked by harm)

**1. Client search window — "Delete permanently" said it would delete the file; the file stayed on the shelf.**
- Citation: confirm box *"Permanently delete this document and its file? This cannot be undone."* (client search window, bin view).
- User-moment: emptying a test invoice (INV-43700) I'd binned, to see if the warning tells the truth.
- Observed: the record vanished (the core's Search and its own Recycle bin no longer know INV-43700), but `Output\Ridgeway-Plant-Hire\2026\January\Invoice.09-01-2026.INV-43700.pdf` **and** its `.metadata\…xml` are still there. The core's identical action removed both (`23_core_bin_after_permanent.png` → February folder emptied).
- Harm: **trust-eroded, high** — an orphan on the shelf that the app has forgotten; the next tidy-up or re-import is a coin toss.
- Class: CONFUSION.
- Suggestion: over the network either delete the file too, or word it honestly: *"Remove this document from ScanFinder? The filed copy stays in your folder."*
- What I may be missing: perhaps the client is deliberately not allowed to touch files — then the warning is the thing to fix.

**2. Client search window — the Recycle-bin view won't let go.**
- Citation: left panel *"The recycle bin is empty."* while the middle still shows the purged invoice with *"Status deleted"* and live **Restore** / **Delete permanently** buttons (`46_client_homesearch_searchwin.png`); and after Home → *"Find a filed document"* → "Pelican" → Search, or clicking a Recently-filed row, the window keeps *"← Back to search / Empty bin / The recycle bin is empty."* with FIND "Pelican 0 / 0" and the requested document sitting on the right (`50_client_recent_searchwin.png`).
- User-moment: back on Home, looking for Pelican's invoice.
- Observed: I would read "The recycle bin is empty" and "0 / 0" and conclude Pelican isn't filed. Pressing the ghost **Restore** did nothing, silently.
- Harm: **slowed + trust-eroded**.
- Class: CONFUSION.
- Suggestion: any hand-over from Home (and any purge) should return the window to plain search and clear the right-hand pane.
- What I may be missing: maybe the core behaves the same after a purge — I only saw the stale pane on the client.

**3. Client Quick File — a dead end that blames the admin, who is me.**
- Citation: FILE AS *"No Quick File types — ask an admin to add one"*; pressing **File documents** → *"Pick a type first."* (`67_client_quickfile_result.png`). The core's own Quick File pane, same account, offers *Contract / Agreement, Correspondence, Spreadsheet / Report, Filed Document* and filed my PNG fine (`69_core_quickfile_filled.png`; it appeared in the client's "Recently filed" as *Chris Test Co · QF-CHRIS-CORE*).
- User-moment: filing a screenshot from the client.
- Observed: I added "General Document" from the catalog in core Settings and signed out/in on the client — still "no types". The dropdown itself renders **blank** (`65_client_quickfile.png`), the explanation is hidden inside it.
- Harm: **blocked** (client Quick File).
- Class: CONFUSION.
- Suggestion: show the same list the core shows; if truly none, print the explanation as text under the box, not as a greyed option.
- What I may be missing: the client may need a specific "quick file" flag on a type that the catalog doesn't set.

**4. Both Search windows — granting "Can stamp" doesn't reach a window that's already open.**
- Citation: Settings → Users & activity *"Can stamp"* ticked (`32_canstamp.png`); the popup still says *"No one can approve yet — grant stamping in Settings"* and the button stays *"✉ Send…"* (`33_core_send_history.png`) until I close and reopen Search, after which it becomes *"🏷 Send or stamp…"* with the *Stamp it myself* tab (`43_core_popup_after_reopen.png`). Same on the client (`53_client_reopen_doc.png`).
- User-moment: doing exactly what the popup told me, then coming straight back.
- Harm: **slowed** (I'd assume the tick didn't save).
- Class: QUESTION.
- Suggestion: re-read permissions when the popup opens, or say *"Close and reopen Search to use it."*
- What I may be missing: a deliberate security choice — then the message should say so.

**5. Client Home — "AWAITING OTHERS" counts things that were already actioned.**
- Citation: *"AWAITING OTHERS 4 · you sent, not yet actioned"* (`60_client_home_counts.png`) while the Sent tab showed 2 pending + 2 **approved** (`59_client_mailbox_sent.png`). The core Home said *"3 sent, awaiting others"* when 3 were pending — correct.
- Harm: trust-eroded, low.
- Class: QUESTION.
- Suggestion: count only pending.
- What I may be missing: perhaps "actioned" means "acknowledged by the sender".

**6. Client, read-only user — "awaiting your decision" with nothing to decide.**
- Citation: Home *"WAITING ON YOU 2 · awaiting your decision"* (`70_reader_home.png`); Mailbox Inbox lists two *"For information · from nightadmin"* items with **no buttons at all** (`72_reader_mailbox.png`). Opening them changed nothing (still "pending").
- Harm: **slowed + confusing** — a number that never goes down.
- Class: CONFUSION.
- Suggestion: a *"Got it"* button on for-information items, and "waiting for you" wording rather than "decision".
- What I may be missing: maybe FYI items are meant to clear on their own after a while.

**7. Stamp popup History — wrong hour, raw username, back-to-front date.**
- Citation: popup *"HISTORY · 1 PAID nightadmin · 2026-09-13 21:39"* (`52_core_stamp_history.png`) while the stamp printed on the page says *"By: nightadmin · Date: 13 Sep 2026, 22:39"* (`52_core_stamp_placed.png`) and the app clock read 22:39. Same on the client (21:40 vs 22:40).
- Harm: cosmetic / trust (an hour out is the kind of thing an accountant queries).
- Class: PREFERENCE.
- Suggestion: *"PAID — Night Admin, 13-09-2026 22:39"*, same clock everywhere.
- What I may be missing: nothing I can think of; the page stamp gets it right.

**8. Client — "scanfinder-client" and two windows with one name.**
- Citation: the client's own confirm/alert boxes are titled *"scanfinder-client"* (`40_client_homesearch_main.png` — a real one, see humility block); both client windows carry the identical title *"ScanFinder — Search"* in the taskbar (`00_client_start.png` vs `29_…png`).
- Harm: cosmetic.
- Class: PREFERENCE.
- Suggestion: title the boxes "ScanFinder"; title the main window "ScanFinder Client" or "Home".
- What I may be missing: the title may be Windows' doing, not the app's.

## One-line verifies / not tonight's subject
- Core Search window looked and behaved as before: results list, details pane, Find (scanned + typed), zoom, ↑/↓, bin, Send, Mailbox inside the window — nothing odd found beyond cards 4 and 7.
- In the narrow client window the page toolbar clips at both ends (`54_client_stamp_placed.png`: "…00% + Reset … 🏷1 Stampe…") — cosmetic.
- Find said "Dudley 1 / 2" on a page that prints Dudley once — I could only see one highlight; low confidence it matters.
- Saltmarsh dockets: 19/20 came in with "—" for reference; typed documents came in with "—" for company on a fresh install (expected, not searched-for tonight).
- Review's "Add 'Delivery Note'" sheet's promise ("then selected here") held after its own re-read; picking the type by hand on the next docket left four empty fields and Confirm greyed until a Reprocess.
- Review row badge "63%" next to fields all reading "High · 90%+" (`11_confirm_after.png`) — I'd ask why.
- The 34-page stack imported as 34 blank single pages — so multi-page paging / lazy loading could NOT be tested; no .xlsx/.docx exist in the Demo Docs, so the spreadsheet grid could not be tested either.

## Warnings truth-table
| App / screen | Warning (verbatim) | Truth |
|---|---|---|
| Core Search | "Move this document to the recycle bin? You can restore it later." | TRUE |
| Core Search | "Restore all 1 document from the recycle bin? They go back to where they were deleted from…" | TRUE (back in results, file intact) |
| Core Search | "Permanently delete this document and its file? This cannot be undone. Your original scans in the Processed folder are not touched." | TRUE (PDF + xml gone; Processed still 20) |
| Core Search | "The recycle bin is already empty." | TRUE |
| Core Search | "Send this document back to the Review queue? It stays filed until you re-confirm it." | TRUE (file on disk, doc back in queue) |
| Core Review | "Nothing filed — 41 kept back" (File All Ready) | TRUE |
| Core/Client stamp bar | "Your original is never changed." | TRUE (filed PDF byte-identical to its Processed original; stamped copies kept separately) |
| Client Search | "Move this document to the recycle bin? You can restore it later." | TRUE |
| Client Search | "Permanently delete this document and its file? This cannot be undone." | **PARTLY FALSE** — record gone, file + xml kept (card 1) |
| Client Search | "The recycle bin is already empty." | TRUE |

## What genuinely worked
The client Search window: opens on its own, same screen as the core, Find on a scanned page over the network ("Dudley 1/2", "Total Due 1/1", nonsense "0/0" with arrows greyed), stamping and approving over the network with the Inbox emptying to *"Nothing waiting on you"*, theme following instantly, sign-out closing it, and the read-only trim exactly as promised (no delete, no bin, no send). Import's plain talk was the best copy of the night: *"11 filed themselves"*, *"All 20 scans … moved to its Processed subfolder"*, and the learned-sender banner with a Manage link.

## Top friction
Card 2 — the client's bin view that won't let go, compounded by card 1's orphaned file: together they break "where is my paper, and is it safe?".

## Two-week verdict
**Would I keep using this after two weeks? Yes** — the core Search is solid and the client window now genuinely mirrors it; I'd want cards 1–3 fixed before the client goes on my colleagues' desks, because those are the ones that would make them ring me.

## Humility block
- One simulated persona, sandbox only, one evening; no real users.
- **My driver mis-fired three times, all in the sandbox and all reported:** (a) the folder dialog once returned the owner's `Downloads` folder — the app only *listed* 49 file names in its preview; I never pressed Process and re-picked immediately (`06_folder_picked.png`); (b) a regex hit "Send back to Review" instead of "Send…", so INV-69523 sits in the Review queue; (c) a stray type change on docket_18, restored.
- The stacked native message boxes were **my driver's artefact** (proved in `ghost_test.js`: one box, cleared by Enter, with no handler; a leftover only when my handler "accepts") — cleared on both apps at the end. The *title* "scanfinder-client" on a real box is genuine.
- Cards 5–7 rest on numbers I read off the screen against the app's own Sent/History lists; I can't see the reasoning behind them.
- The owner's "search window doesn't open" report did **not** reproduce for me in four attempts; I have nothing to offer on it beyond: it opened in ~2 s each time, with no message at the bottom of the main window.
- Sandbox state at wrap: core dev app + client both responding; core signed in as Night Admin (Review 62 waiting, Settings and Search windows open); client signed in as Night Reader with its search window open; two routes pending to nightreader; nothing outside the sandbox written.

---

## Main-session TRIAGE (read-only root causes; NOTHING implemented — the owner vets)

| # | Where | Root cause (traced) | Proposed fix | Class |
|---|---|---|---|---|
| 1 | `/v1` purge (`src/modules/api/handler.js` `_purgeDocFiles`, ~L65) | **PRE-EXISTING, real data bug.** The /v1 purge deletes `[documents.resolveFilePath(doc), doc.working_path]` — `resolveFilePath` returns the WORKING copy, never the filed copy (the exact bug the DESKTOP purge fixed 2026-08-13: `_purgeOne` now targets `working_path` AND `stored_path` explicitly + the `.metadata` xml; pinned by `test_purge_and_bin_truth`). The /v1 lane never got that fix. | Route the /v1 purge + purge-all through the same `_purgeOne` helper the desktop uses (or export it from review/handler) + a `/v1` pin. A DELETE path → owner approval. | **APPROVAL-CLASS (destructive path) — morning #1** |
| 2 | shared `searchQuery.js` / `searchResults._act` / client `popout.js` deep-links | Two halves. (a) After a purge from the rail/toolbar/context menu, `_act` clears the selection but NOT the preview; on the CORE the `bin-changed` push (`onBinChanged` → `rowsGone` → clears the pane) hides this — the client has NO push channel, so the purged doc stays in the pane with live buttons (the "ghost Restore"). (b) A Home deep-link (`set-query` / `goto-doc`) arrives while the pop-out is in BIN mode → `doSearch()` fetches the deleted queue → "The recycle bin is empty" + "Pelican 0 / 0". The core has the same latent (b). | (a) in `_act`: if an acted id === `selectedDoc.id`, clear the preview (the `_afterChange` idiom). (b) a deep-link exits bin mode (and mailbox mode) first. Shared module; harness-pinned. | safe UI fix — owner go |
| 3 | client `renderer.js` Quick File view + `/v1/documents/intake/doc-types` | The core pane lists `installed` (reading_mode='none' types) PLUS the catalog `presets` (create-on-first-use `new:<slug>`); the client renders `installed` ONLY → empty on a fresh install, and a catalog add of a normal type does not help. The blank `<select>` hides the explanation. | Return `presets` on the /v1 doc-types probe (it already exists core-side) + let the client's submit create-on-first-use like the core; show the explanation as text. Client Quick File lane (previous session's S1/S2). | owner go |
| 4 | shared `searchInit.js` (`canStamp` read once) + `searchStamp._renderSend` | `SearchState.canStamp` is read at init only; the popup reads it, never re-asks. | Re-read `stamp.can()` (and recipients/grants) when the popup OPENS. Shared, small. | owner go |
| 5 | client main `renderer.js` `refreshBadges` | Counts every route in `sent` (no state filter); the core Home counts pending only. | Filter pending/claimed for the "awaiting others" card. Client main window. | owner go |
| 6 | client main `renderer.js` mailbox (read-only) | For-information items for a READ-ONLY user show no "Got it"; the pop-out's popup DOES offer it (`sp-w-ack`) — the main-window Inbox rows don't open the decision path for readonly (`canDecide()` gating). Number never decrements. | Offer "Got it" (acknowledge) for FYI items regardless of role in the main-window mailbox; wording "waiting for you". | owner go |
| 7 | shared `searchStamp.js` `_fmtDT` | `String(iso).slice(0,16)` prints the UTC hour; the page stamp uses local time. Pre-existing on the core. | `new Date(iso).toLocale…` + display name over username + DD-MM-YYYY. | owner go (cosmetic) |
| 8 | client `main.js` `createWindow` title; dialog titles | The main window is titled "ScanFinder — Search" (same as the pop-out); native dialog title = the app name from package.json (`scanfinder-client`). | Main window "ScanFinder Client"; `productName`/`app.setName` for dialogs. | owner go (cosmetic) |
| — | 34-page stack from `.sf_separated_originals` imported as 34 BLANK pages | Not tonight's subject; that folder holds SEPARATED originals (an app-managed artefact, not an import source) — a Chris-driver choice, but blank pages on import deserve a look. | Check with the owner whether importing from `.sf_separated_originals` is meaningful; if so, why blank. | owner question |

## Outcomes — 2026-09-14 morning (owner: "Continue with Chris's fixes in the recommended order")

All 8 cards built in order 1→8 and pushed. `npm run test:pins` 360/361 (the one red, `test_ref_class_fix`, is the
pre-existing flaky pin — green when run alone), `--smoke-windows` 14/14, the sync pin green (the client copy of the shared
screen regenerated). The owner's core (`TEST_BUILD=1`) + client were restarted on this code.

| # | Outcome | Commit |
|---|---|---|
| 1 | **DONE.** `/v1` purge + purge-all go through `review/handler.purgeDocumentFiles` (working copy + FILED copy + `.metadata` xml) — the desktop's own helper, now exported; the row is deleted after. Pin `src/modules/api/test_v1_purge_files.js`. The warning "and its file" is TRUE again. | `0129053` |
| 2 | **DONE (shared screen).** (a) `searchResults._act` clears the preview when an acted id is the selected doc. (b) `SearchQuery.setQuery(q)` / `SearchPreview.openDocById(id)` are the entry points for an external term / document and leave the bin + mailbox views first; the core Quick-find and the client pop-out deep-links use them. Harness-pinned on both apps. | `ff49223` |
| 3 | **DONE.** The client's Quick File lists the installed types + the catalog presets (`new:<slug>`, admin only), with a hint line when there is nothing to pick; `/v1/documents/intake` resolves `new:<slug>` through `doctypes.addPresetTypes` (admin only, idempotent) before filing. | `0f58ecb` |
| 4 | **DONE (shared screen).** `SearchStamp.open()` re-reads `stamp.can()` when it opens and re-renders the actions. | `ff49223` |
| 5 | **DONE.** `refreshBadges` counts the OPEN routes (pending/claimed) in Sent as `counts.sentOpen`; the Home "Awaiting others" card shows that. | `0f58ecb` |
| 6 | **DONE (shared screen).** A read-only user with a route waiting on them gets a "✉ Waiting on you…" door in the doc actions; the popup titles itself "Waiting on you", hides the stamp + send panels and keeps Got it / Approve. The client MAIN-window mailbox rows were verified in code: "Got it" for FYI items is already un-gated there (`mbRow` + `decisionBar`) — the missing door was the pop-out. | `ff49223` |
| 7 | **DONE (shared screen).** `_fmtDT` prints local `DD-MM-YYYY HH:MM`; `stampService.stampsForDocument` adds `placedByName` (display name, username fallback) and the history shows it. | `ff49223` |
| 8 | **DONE.** Main window "ScanFinder Client"; `app.setName('ScanFinder Search Client')` with the userData path pinned first (dialog titles), the pop-out keeps "ScanFinder — Search". | `0f58ecb` |
| — | The 34 blank pages from `.sf_separated_originals` — still an owner question, logged in `pendingfeatures.md`. | — |

---

## Round — 2026-09-14 EVENING (teach-over-client S3 focus; sandbox core, port 9223, PID 19212)

Sandbox conditions: fresh migrated DB (0 users → first-admin), Demo Docs copied in, Output in-sandbox, CDP 9223. Focus (owner): the new "Teach from the search client" — the Settings toggle + the shared Teach wizard (the client side had no client app connected, so it was judged via the core wizard, which runs the same shared code). Full standard battery also run.

### Verdict: **YES — would keep using after two weeks.** Teach works end-to-end and tells the truth; the safety net (warnings + recycle bin + originals kept) is excellent; every warning was truthful.

### FOCUS findings
1. **Teaching toggle can be ON while the connections door it needs is shut — QUESTION.** In Settings → Search client, ticking "Allow teaching from the search client (admin only)" says "On — an admin on the search client can teach…", but the "Allow search-client connections" switch above (client_api_enabled) can still be Off. Nothing on the teach card says the top switch must also be on. Proposed: when connections are off, add "Search-client connections are off above — turn those on first for this to take effect."
2. **"template" is a word customers don't use — PREFERENCE.** The toggle copy says "a new document type or template"; everywhere else the app says "layout" (tour, teach finish screen). Match it: "…type or layout".
3. **Teach summary shows the fixed value but not the destination folder — QUESTION.** For a fixed issuer that differs from the printed letterhead (fixed "Fenton Plumbing & Heating" on a Northgate page), the summary never shows which company folder it files to before you press "Save teaching & file". Proposed: add "Will file to: <Company> › <Year> › <Month>" on the summary. (Recoverable + the done screen states it after, so a nicety.)

**Positive on the focus:** the toggle copy answers all three questions — WHAT / WHO (+ "(admin only)") / and the key catch "the document being taught must already be in this PC's review queue". The fixed-value path copy is honest end-to-end. The fixed Document Issuer took effect exactly as taught and filed under the fixed name.

### Standard-battery findings
4. **After teaching, 12 of 18 invoices flagged "check the company name" when the name was correct — QUESTION (Chris's top friction).** DOCUMENT ISSUER · Check · 69% on a value ("Northgate Textiles") correct on every one. Warning-fatigue risk. Proposed (keeps the hold): soften the tone to "Looks right — quick confirm" when the shown value matches the just-learned sender. (Pre-existing issuer-flag behaviour, not S3.)
5. **"learned · needs a layout" queue-header phrase is opaque — CONFUSION (minor).** Proposed plain words: "I know this sender — teach one layout to speed these up."

### Warnings truth-table: every one TRUE (Confirm&File, File All Ready "file 6 of 18", single delete→recycle bin→restore, Delete All Review, Split "only one page", Save teaching & file). Not one lied.

### Not testable in this sandbox: the search-client's OWN Teach button (no client app connected — the owner is wiring one next) and the full approval hand-off (only one user).

### Humility: one simulated office manager, not a user test; clumsy box-drawing was Chris's automation limit (the read-back caught it every time); only sample docs used. All findings are for the owner to vet — nothing implemented without the owner's go.

---

## Round — 2026-09-14 EVENING #2 (teach-over-client S3 on the ACTUAL search CLIENT; client CDP 9224 → sandbox core 9223, API 127.0.0.1:8765)

Setup: the sandbox core's /v1 API enabled on loopback + teach_over_client_enabled on; a detached search-client app connected to it (🟢 Connected · API v1.7.0); admin `chris` / `Chris-Test-9`; 12 Northgate invoices in the core's review queue.

### RESULT: **the client teach works END-TO-END, live.** Chris signed in on the client, clicked the sidebar **Teach**, taught a Northgate invoice from the MAIN PC's queue (create/pick type → draw + read-back each field → the fixed-value "Save without a spot" Document Issuer, the exact case that broke → Save). Done screen "✓ Your document is filed"; verified on the core — INV-87127 now **Confirmed** in Search, review queue **12→11**. The fixed-issuer path saved with no error/dialog. Verdict: a remote admin could teach from the client without help; would keep using.

### Findings (all minor; queued for owner vet)
1. **Review count doesn't update after "filed" until a manual Refresh — QUESTION (top friction).** Wizard said "filed" but the client sidebar still read "Review 12"; only Review→Refresh showed 11. Fix: refresh the client's review count when the teach window reports "filed".
2. **Sidebar "Teach" label is vague — CONFUSION/PREFERENCE.** Reads like a tutorial. Proposed: "Teach a document" (+ a one-line hint).
3. **Done screen says "filed" but not WHICH computer — QUESTION.** On a separate PC, say "filed on the main computer".
4. **Doc-picker thumbnails are blank page icons — PREFERENCE.** Can't tell a clean scan from a crooked one (which it asks you to judge). Show page pictures like Search does.
5. **Reference label read-back looked garbled ("Invoice No. IN") — QUESTION (value INV-87127 was correct).** Tidy the label read-back / don't sweep the value's first letters into the label.
6. **"Save without a spot" wording is cryptic — PREFERENCE.** Proposed: "Keep it as typed (don't tie it to the page)".

### Warnings truth-check (Save step): "Your document is filed" — TRUE (found in Search as Confirmed; queue dropped by one). No false alarms.

### What worked: the read-back that SHOWS ITS WORK (typed "Northgate Textiles" → it drew a green box where it found it; each field read back with green value + blue label boxes before anything saved).

### Humility: one simulated admin, once, on test data, driven by a script; only judged the screens walked through; didn't test a bad scan / network drop mid-save / two people teaching at once.

---

## ROUND A — 2026-09-15 night run (connect + teach-over-client + Quick File)

*Chris The Customer, non-technical small-office admin. Drove the running sandbox only (core CDP 9223, client CDP 9224). All three features exercised end-to-end: I connected the client (recovered it from an expired code), taught a Northgate invoice from the client and watched it file on the main PC, and Quick-Filed a document. Screenshots saved in the reviewer's scratchpad.*

### TL;DR (3 lines)
- **Verdict: YES — I'd keep using it.** All three features actually WORK over the network: I taught an invoice from the client and it filed on the main PC (main PC's review queue dropped 10 → 9, "11 filed today"); I Quick-Filed a document and found it in the filed list moments later. The teach read-back and the certificate-check wording are genuinely good.
- The sharp edge is **Quick File keeping the last document's Company / Reference / Notes after you file** — a real chance to file the NEXT document under the wrong details without noticing.
- The connection is solid once made, but the setup screen shows an address (`0.0.0.0`) you can't actually type into another PC, and the certificate pop-up appeared **twice**; clicking the second copy knocked the connection out.

### Verdict: **YES, I would keep using it after two weeks** — because the everyday jobs (teach an invoice, drop a no-scan document into filing, search) all completed and the safety read-backs earned my trust. The friction below is fixable polish, not broken plumbing.

---

### Card 1 — Quick File remembers the LAST document's details after you file (misfile risk) — CONFUSION / could-misfile
- **Citation (verbatim):** After clicking **"File documents"**, the confirmation **"Filed 1 document(s)."** appears, the file area resets to **"No files chosen yet."**, but the fields still read **COMPANY / PERSON "Copperfield Electrical"**, **REFERENCE "PO-DEMO-QF-A"**, **NOTES "Chris round A quick file test"**.
- **User-moment:** I filed one document and went to file a second, different one.
- **Observed confusion:** The document I chose was cleared, so I'd assume the form was cleared. I'd pick a new file (say a gas bill) and hit **File documents** — and it would go in under "Copperfield Electrical / PO-DEMO-QF-A" because those boxes silently kept the old values. I would not notice, because a half-full form looks like a form I filled.
- **Harm + severity:** trust-eroded / could-misfile — **high**. The whole point of Quick File is speed, which is exactly when nobody re-reads pre-filled boxes.
- **Class:** CONFUSION.
- **Proposed alternative:** On success, clear the whole pane (file + all fields), OR keep the fields but visually mark them as "carried over from last time — check before filing". Keep the confirmation; just don't leave stale identity data armed.
- **What I may be missing:** If the common real-world use is "file ten pages of the SAME contract in a row", keeping the fields is a feature — in which case make that intent visible rather than silent.

### Card 2 — The certificate-check pop-up appears twice, and dismissing the copy dropped the connection — CONFUSION / blocked
- **Citation (verbatim):** "Get certificate from server…" produced the dialog **"Check the server's certificate … It matches — connect"** — and the screen text contained that dialog's heading **twice**. After I clicked **"It matches — connect"** and reached Home (**"Connected"**), the same dialog was still sitting on top of the Home screen; dismissing it left the footer showing **"Offline"**, then **"Connecting…"** which did not recover on its own.
- **User-moment:** Reconnecting the client after its saved code had expired.
- **Observed confusion:** I confirmed the security code once and got in — then the identical pop-up was still there. I'd think "did it not work? do I press it again?" Pressing the second one knocked me back offline.
- **Harm + severity:** trust-eroded / blocked — **high** (connection is the door to everything else).
- **Class:** CONFUSION.
- **Proposed alternative:** Only ever show ONE certificate-check dialog, and once accepted don't let a duplicate remain able to re-fire a connect. Keep the (excellent) wording exactly as-is.
- **What I may be missing:** I drove this fast with a script and clicked the duplicate deliberately to probe it; a human might click it once and never see the second. But the duplicate dialog is clearly being created twice, so a real user could hit it.

### Card 3 — The address shown on the main PC is `0.0.0.0`, which won't work if typed on another PC — CONFUSION / blocked (for the real LAN case)
- **Citation (verbatim):** Settings → Search client shows **"Running · https://0.0.0.0:8765"** and **"Address 0.0.0.0 Port 8765 secure (https)"**, while the built-in guide says **"enter this PC's network (LAN) address — e.g. 192.168.1.50"** and the certificate line reads **"Needs re-issue · missing 192.168.0.237 · expires 17/12/2028"**. The client's own connect box was pre-filled with a *third* number, **192.168.56.1**.
- **User-moment:** Following the on-screen "enter this PC's address" instruction to set up a client.
- **Observed confusion:** I'd read `0.0.0.0` as "the address", type it (or trust the QR) on the other PC, and it would never connect — `0.0.0.0` isn't a place another computer can reach. Four different numbers appear across the screens; I can't tell which one to trust.
- **Harm + severity:** blocked / slowed — **high** for the multi-PC case (the client eventually reached the server only via `127.0.0.1` on the same machine).
- **Class:** CONFUSION.
- **Proposed alternative:** When bound to all interfaces, show the actual reachable LAN address (e.g. "Reachable at 192.168.0.237:8765"), not `0.0.0.0`; make the QR / profile carry that same reachable address.
- **What I may be missing:** This is a co-located sandbox, so the "real" LAN address is ambiguous here — on a normal install the app may already substitute the true IP, in which case this is only a sandbox artefact. Flagging so the owner can confirm which.

### Card 4 — Teaching: the document jumps size / zoom after every box you draw — PREFERENCE / slowed
- **Citation (verbatim):** Header cycles **"Field 1 of 3 …" → "Field 2 of 3 …" → "Check what I read for …"**; as it does, the page redraws at a different size (measured: the document image went from 791px wide at 150% to 527px wide at 100% between the draw and confirm states).
- **User-moment:** Drawing boxes around the issuer, then the date, then the number.
- **Observed confusion:** Each time I finished a box, the whole invoice shrank/grew and shifted. I lost my place and had to re-find the next value. It also makes precise drawing feel unstable — the page moves under you.
- **Harm + severity:** slowed / trust-eroded — **medium**. Teaching is already the scariest screen for a normal user; a jumping page adds to that.
- **Class:** PREFERENCE.
- **Proposed alternative:** Keep the document pane a fixed size and zoom throughout the teach; grow/shrink only the instruction panel, not the page.
- **What I may be missing:** The resize is tied to the instruction panel changing height between "draw" and "confirm"; a human drawing in one smooth motion may notice it less than my step-by-step script did.

### Card 5 — When connecting goes wrong, the message is raw computer-speak — CONFUSION / QUESTION
- **Citation (verbatim):** A failed connect showed **"cannot reach server: getaddrinfo ENOTFOUND 10.85.2.125c"**; a stale saved code showed **"pairing code expired"** with no next step offered.
- **User-moment:** Trying to reconnect the client.
- **Observed confusion:** "getaddrinfo ENOTFOUND" means nothing to me — I can't tell if I typed the address wrong, the main PC is off, or the firewall is blocking it. "pairing code expired" tells me what's wrong but not what to DO (I didn't know I had to go back to the main PC and make a new code).
- **Harm + severity:** slowed / trust-eroded — **medium** (only bites on the unhappy path, but that's when a scared user most needs help).
- **Class:** CONFUSION (error path) / QUESTION.
- **Proposed alternative:** "Couldn't reach that PC. Check the address and that the main PC is switched on with search-client access turned on." For the code: "That one-time code has expired — on the main PC, Settings → Search client, click 'Show a one-time code' for a fresh one."
- **What I may be missing:** The `…125c` had a stray character from my scripted typing, so the exact string isn't a real user's — but the raw `getaddrinfo ENOTFOUND` style is the product's.

### Card 6 — Certificate status "Needs re-issue" reads like something is broken — QUESTION / trust-eroded
- **Citation (verbatim):** **"Managed TLS certificate — Needs re-issue · missing 192.168.0.237 · expires 17/12/2028"**, followed by **"CA fingerprint 58:1E:6C:F8:1E:F5:ED:D3:…"** and the reassurance **"Created automatically for the address above — nothing to manage."**
- **User-moment:** Skimming the Search-client settings before inviting a colleague on.
- **Observed confusion:** "Needs re-issue" and "missing 192.168.0.237" sound like a fault I must fix, yet the next line says "nothing to manage". Mixed signals — do I act or not? "TLS certificate", "CA fingerprint" are words I'd never say.
- **Harm + severity:** trust-eroded — **low/medium** (it's a safety surface, so I only report the confusion, I don't ask to remove it).
- **Class:** QUESTION.
- **Proposed alternative:** If the app can re-issue itself, say so with an action: "Security certificate — the current one doesn't cover this PC's address yet. [Update it]". Call the fingerprint an "ID code" here too (the client already does).
- **What I may be missing:** "Needs re-issue" may be genuinely important state the owner wants surfaced; I'm flagging the wording, not asking to hide the status.

### Card 7 — Quick File's "done" is a whisper, with no "where did it go?" and no undo — cosmetic / trust
- **Citation (verbatim):** **"Filed 1 document(s)."** (small grey text beside the button). The client's Review badge also stayed on **"Review 10"** after I taught+filed a document, and only corrected to **"Review 9"** (matching the main PC) after I reconnected.
- **User-moment:** Confirming my document actually filed and finding where.
- **Observed confusion:** "1 document(s)" reads robotic. It doesn't tell me WHERE it filed (which company/year/month), give me a link to open it, or an undo — so I'm trusting on faith. And a count that doesn't update makes me doubt whether anything happened.
- **Harm + severity:** cosmetic / trust-eroded — **low** (it did file and was searchable — I found "Copperfield … PO-DEMO-QF-A · 14-09-2026" in the filed list).
- **Class:** PREFERENCE.
- **Proposed alternative:** "Filed 1 document — Copperfield Electrical, filed under 2026 › September. [Open] [Undo]". Fix the "(s)". Refresh the Review/filed counts live after a client action.
- **What I may be missing:** Counts may refresh on a timer I didn't wait out; the stale badge could be a slow poll rather than a permanent bug.

### Also noticed (below the 7-card line)
- **Doc-picker thumbnails are blank generic icons** when teaching from the client, yet the screen says **"Pick one clear, typical scan. The cleaner the example, the better…"** — I can't judge "clean" without seeing the pages.
- During teaching, a couple of box read-backs briefly showed wrong text (e.g. a date box read **"et Ms"**) — **but this was almost certainly my fast scripted dragging while the page was resizing (Card 4), not the product**: the safety check caught it every time (**"⚠ That doesn't read like a date… redraw it — or type it below"**) and the final Review + the filed record were all correct (Invoice / Northgate Textiles / 03/03/2026 / INV-17226).

### Warnings truth-check
- Teach: **"✓ Done — and Scan Finder just learned something / Your document is filed"** — **TRUE**. Main PC's queue dropped by one and the invoice appeared in the filed list.
- Quick File: **"Filed 1 document(s)."** — **TRUE**. The document appeared in the client's "Recently filed" list and was searchable.
- Certificate dialog: **"Confirm this ID code matches the one shown on the main PC…"** — the code shown (58:1E:6C:…) **matched** the main PC's Settings exactly. No false alarms.

### Top friction point
Quick File keeping the previous document's Company / Reference / Notes after filing (Card 1) — the one place a fast, trusting user could genuinely misfile without knowing.

### One thing that genuinely worked
The **certificate-check step and the teach read-back**. The security pop-up says, in plain words, *"Confirm this ID code matches the one shown on the main PC (Settings → Search client). If it doesn't match, someone may be impersonating your server,"* points me exactly where to look, and its **Cancel** button is the prominent one — so it doesn't push me to click "yes" blindly. And teaching over the network genuinely shows its work: I told it the company name and it drew a green box exactly where it found it, and read every field back to me before saving anything. That built real trust. The built-in **"Set up the Search Client — step by step"** guide is also excellent, plain-English, hand-holding writing.

### Humility
One simulated admin, once, on a co-located sandbox, driven by a script that clicks and drags faster than a person. I judged only the screens I walked; I did not test a genuinely bad scan, a mid-save network drop, two people teaching at once, or the Quick File native file-picker (it uses a Windows dialog my tooling can't open, so I exercised an already-staged file). Two of my findings (the stray character in the connect error, the transient teach misreads) are partly my automation's fault and I've said so.

---

## ROUND A — night run 2026-09-15 (Chris)

**TL;DR (3 lines).** All three new things actually work in front of me: I connected the search client to the main PC, signed in, taught a Northgate invoice from the client and watched it file on the main PC, and I can see quick-filed documents that landed. The pain is all in *connecting*: one dead-end message stopped me cold, and the "is this really your server?" check uses words the two screens do not share. I would keep using it — but a first-timer connecting on their own would need a hand.

**Verdict: YES — I would keep using it.** Connect, Teach-over-the-client, and Quick File each did what they promise. Every finding below is friction on the way in, not a broken feature.

*Setup: one simulated office manager driving the live sandbox — search client (window 9224) to main PC (window 9223), signed in as `chris`/`Chris-Test-9`. Screenshots under the reviewer's scratchpad `client_01..12_*.png`.*

**What worked end-to-end (verified, not assumed):**
- **CONNECT** — from a signed-out state I re-entered the server address, was shown the "is this your server?" check, accepted, and signed straight in (`client_09..12`).
- **TEACH** — I taught the Northgate invoice INV-17226 on the client (pointed out the company, typed the date and number when the box misread, saved). On the main PC that exact document is now filed as done — company "Northgate Textiles", reference INV-17226, date 03-03-2026 (`client_03..08`).
- **QUICK FILE** — I could not finish a *fresh* one because "Choose files…" opens the normal Windows file box, which my test harness cannot operate (that is a harness limit, not a fault). But three quick-filed "Copperfield Electrical / PO-DEMO-QF-A" documents from earlier are on the main PC, filed and findable — so the feature lands documents (`client_02`).

### Card 1 — feature: CONNECT — "pairing code expired" with no way forward *(most painful — blocked me)*
- **Citation (verbatim):** Connect screen, red line under the form: **"pairing code expired"** (shown after I typed my server address and clicked **"Connect"**).
- **User-moment:** I had signed out, pressed "Change server", typed my server's address and clicked Connect to get back in.
- **Observed confusion:** I got told a *pairing code* had expired — a code I never saw, never typed, and the screen never asked me for. Nothing tells me what it is, where a new one comes from, or that I should ring whoever set this up. I would be completely stuck. (I only got past it by clearing it on the main PC — which a normal user cannot reach from the client.)
- **Harm + severity:** blocked.
- **Class:** CONFUSION.
- **Proposed alternative:** when the code has run out, say what to do next in the same breath, e.g. *"This connection code has expired. On the main PC, open Settings then Search client then 'Connect a client' and scan the new code (or read it out)."* Keep the check itself.
- **What I may be missing:** this may mostly bite the "reconnect / change server" path; a brand-new user handed a fresh code or QR by their admin might sail past it first time.

### Card 2 — feature: CONNECT — the two screens call the safety code different names
- **Citation (verbatim):** Client check box: **"Confirm this ID code matches the one shown on the main PC (Settings then Search client)."** The main PC, on that very screen, shows: **"CA fingerprint 58:1E:6C:F8:…"** under a heading **"Managed TLS certificate"**.
- **User-moment:** the client told me to compare an "ID code" against the main PC, so I went to look for it.
- **Observed confusion:** on the main PC there is no "ID code" — there is a "CA fingerprint" under "Managed TLS certificate". I cannot be sure they are the same thing, so I would either give up checking or just click "It matches" without really matching anything — which defeats the whole point of the check.
- **Harm + severity:** trust-eroded (the safety step quietly gets skipped).
- **Class:** CONFUSION.
- **Proposed alternative:** use ONE name in both places — call it "ID code" (or "connection ID") on the main PC too, right next to the digits, so a person can recognise it rather than have to translate.
- **What I may be missing:** an IT-minded admin knows "CA fingerprint"; but the client wording is plainly written for a non-technical person, so the main PC should meet it halfway.

### Card 3 — feature: CONNECT — the certificate note is a wall of jargon
- **Citation (verbatim):** Connect screen, under "SERVER CA CERTIFICATE": **"The CA that signed the server (e.g. ca.crt) — not the server's own server.crt. Only needed for a self-signed / internal certificate; full verification stays on."**
- **User-moment:** deciding whether I needed to press "Choose .crt…" before connecting.
- **Observed confusion:** I do not know what a CA, a ca.crt, a server.crt, or a self-signed certificate is. I cannot tell whether this step is for me or not, so I would freeze — or click "Choose .crt…" and go hunting for a file I do not have.
- **Harm + severity:** slowed / trust-eroded.
- **Class:** CONFUSION.
- **Proposed alternative:** *"Most people can skip this. Only choose a file if the person who set up the main PC gave you one."* Tuck the technical detail behind a "?".
- **What I may be missing:** many people will connect by scanning the QR or importing a profile and never read this line at all.

### Card 4 — feature: TEACH — the read-back shows the *previous* field's answer under the *next* field's heading
- **Citation (verbatim):** right after I pointed out the company, the panel read: heading **"Check what I read for Invoice Date"**, body **"Value: Textiles · Label: Northga (left of the value)"**, then **"That doesn't read like a date."**
- **User-moment:** I had just drawn a box round the company name; the wizard moved itself on to "Invoice Date".
- **Observed confusion:** the Invoice Date panel was showing my *company* text ("Textiles") with a "does not read like a date" warning — before I had pointed out any date. For a second I thought it had grabbed the wrong thing for the date, when really it just had not cleared the last answer off the screen.
- **Harm + severity:** slowed / trust-eroded (momentary).
- **Class:** CONFUSION.
- **Proposed alternative:** the instant the wizard moves to the next field, clear the last field's boxes and read-back so the new field starts clean on "Draw a box…".
- **What I may be missing:** my box happened to span two words; a tidy single-value box might not trigger the leftover.

### Card 5 — feature: CONNECT — checking 32 blocks of letters and numbers by eye
- **Citation (verbatim):** the code I was asked to confirm: **"58:1E:6C:F8:1E:F5:ED:D3:EB:98:1A:14:E8:EE:35:30:D2:14:AC:29:30:D3:A7:DA:A9:7A:88:4C:DD:06:56:E9"**.
- **User-moment:** the check asked me to confirm this matched the main PC before connecting.
- **Observed confusion:** that is 32 blocks to compare across two screens. Honestly, I would glance, give up, and press "It matches — connect" without truly checking — which means the safety step is not doing its job for someone like me.
- **Harm + severity:** trust-eroded. *(I am not asking to remove or weaken the check — flagging it as a question.)*
- **Class:** QUESTION.
- **Proposed alternative (keeps the safety):** nudge people to the "Scan a QR code…" route, which does the matching for you; or visually highlight just the first and last few blocks to compare. Do NOT drop the check.
- **What I may be missing:** the QR route already handles this automatically — this hand-comparison may only be the rare fallback.

### Card 6 — feature: QUICKFILE — clear screen, but "where did it go / can I undo?" is not on it
- **Citation (verbatim):** Quick File screen: **"File a document that needs no scanning — Word, Excel, PDF or an image. Type a few details and it's sent to ScanFinder and filed, searchable a moment later."** Button: **"File documents"**.
- **User-moment:** about to send a document (company "Copperfield Electrical", reference "PO-DEMO-QF-A") with the "File documents" button.
- **Observed confusion:** before I commit, the screen does not tell me *where* it will end up or how to pull it back if I picked the wrong company — the thing I fear most is a document going somewhere I cannot find. (I could not reach the after-you-file screen through my test harness, so I cannot confirm whether that reassurance appears next.)
- **Harm + severity:** trust-eroded (mild).
- **Class:** QUESTION.
- **Proposed alternative:** on this screen or the one straight after filing, one plain line: *"Filed under Copperfield Electrical, 2026, September. Find it in Search, or move it from there."*
- **What I may be missing:** the confirmation I could not reach may already say exactly this; and the feature clearly works (earlier quick-filed documents are filed and findable on the main PC).

### Card 7 — feature: TEACH — the summary and "done" screens float in a big empty page *(cosmetic)*
- **Citation (verbatim):** review step titled **"Here's what Scan Finder found"** with four short rows, and the finish screen **"Done — and Scan Finder just learned something"** — both a small block near the top with a large empty patterned area below.
- **User-moment:** confirming what it captured, then finishing.
- **Observed confusion:** the important bit is a small table adrift in a lot of empty space; my eye hunts for it, and the empty page makes me wonder if something failed to load.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** centre the summary card or show the document beside it, so the screen feels finished.
- **What I may be missing:** on a smaller screen the empty space would be less obvious.

### Top friction: the **"pairing code expired"** dead-end on the connect screen — a message about a code I never saw, with no way forward.
### One thing that genuinely worked: **the teach read-back that shows its work.** When my box misread the date, it said so plainly, let me type "03/03/2026", then drew a green box where it *found* that on the page and asked "is this the right spot?". I always knew what it had, and I could fix it without starting over — that is a competent junior showing me their work.
### Would I keep using this after two weeks? **Yes** — because once I am connected it behaves, and teaching from my own desk actually filed the document on the main PC. But connecting the first time (or reconnecting) needs a friendlier hand, or I would be phoning whoever set it up.

### Humility: one simulated office manager, once, on a test setup, driven by a script. My clumsy box-drawing was my own limit — the read-back caught it every time. I could not operate the Windows file box (Quick File) or force a mid-connect failure, so I judged those from the screens I could reach plus the documents already filed. Everything here is for the owner to vet — nothing changed in the app.

---

## ROUND B — 2026-09-15 (re-verify the round-A fixes)

Focused re-check of the four fixes made after round A. Same sandbox (core CDP 9223, client CDP 9224),
each window reloaded from disk (`Page.reload ignoreCache`) so the fixed renderer files loaded. I only
re-verified the four items; I did not re-run the full vet. Not tested (per brief): upload-to-teach (S4,
needs a client restart — pin-verified) and the two DARK security fixes (nothing visible — pin-verified).

**TL;DR (3 lines):** All four fixes LANDED and every one reads better to a non-technical user. The
round-A blocker — the main PC showing `0.0.0.0` as the address to type — is gone; the connect card now
lists the real LAN addresses, the fingerprint is now "ID code" on both sides, Quick File clears the
identity boxes after filing (and says so), and connect failures now speak plain English. No new breakage
from the reloads; a good client connect still works.

### Fix 1 — the connect ADDRESS (round-A Card 3 blocker) — LANDED & better
- **Citation (verbatim), core Settings → Search client:** status line now reads **"Running · https, port
  8765 — see "Connect a client" below for the address to use"** (no more `https://0.0.0.0:8765`), and the
  Connect-a-client card reads **"Address 192.168.56.1 or 192.168.0.237  Port 8765  secure (https)"**.
- **Verdict:** `0.0.0.0` is no longer presented as a URL or as "the address to use". The real reachable
  LAN addresses are shown in the place a person is told to read them. A non-technical user now has
  something they can actually type on the other PC. Good.
- **Residual (minor, NOT a regression, out of scope of the 4 fixes):** at the top of the same screen the
  server **"listen on"** input still shows a bare **`0.0.0.0`** with no visible on-screen label (its
  placeholder is "0.0.0.0 (LAN) or 127.0.0.1"). That is the legitimate bind config, not the address to
  type — but a bare `0.0.0.0` in a box could still make someone hesitate for a moment. A one-word label
  ("Listen on") would remove the last doubt. QUESTION-class, low harm.
- **Also noted (pre-existing, = round-A Card 6):** the certificate line still reads "Needs re-issue ·
  missing 192.168.0.237 · expires 17/12/2028", i.e. the certificate does not yet cover one of the two
  addresses the card tells you to use. Unchanged tech-note; separate from these four fixes.

### Fix 2 — the safety code is now called "ID code" on the main PC — LANDED & better
- **Citation (verbatim), core Settings → Search client:** the disclosure is titled **"Security
  certificate & ID code"** and the value is labelled **"ID code 58:1E:6C:F8:…"** — matching the client's
  check box, which says **"Confirm this ID code matches the one shown on the main PC (Settings → Search
  client)."**
- **Verdict:** the round-A translation gap is closed. The client says "ID code", the main PC now says
  "ID code" right next to the same digits (58:1E:6C:F8:… on both). A person can now recognise and match
  them instead of guessing that "CA fingerprint" and "ID code" are the same thing. Good.

### Fix 3 — Quick File clears the identity boxes after filing (round-A Card 1 misfile risk) — LANDED (verified at source; live picker not automatable)
- **Citation (verbatim), client Quick File submit handler** (`client/renderer/renderer.js` 687–696): on a
  clean file it clears the fields — `['qf-party','qf-ref','qf-notes'].forEach(id => { const el = $(id);
  if (el) el.value=''; })` — and shows **"Filed {N} document{plural} under {party}. The boxes are cleared
  for the next one."**; the awkward `document(s)` is gone (`const plural = filed === 1 ? '' : 's'`).
- **Verdict:** this directly fixes the round-A misfile risk — after filing, COMPANY / REFERENCE / NOTES no
  longer stay armed with the previous document's details, and the confirmation both NAMES where it went
  ("under {party}") and states the boxes were cleared. The "1 document" (not "1 document(s)") reads
  naturally. On a *partial* failure the staged files and fields are deliberately kept so the user can
  retry with the same details — correct.
- **Couldn't test live:** the Windows file picker can't be scripted and the staged-file list is private to
  the renderer module, so I could not inject a fake file to drive a real submit. Verdict is from the code
  path (as the brief allows). Worth one manual confirm by the owner: file a real document and watch the
  three boxes empty.

### Fix 4 — plainer connect copy + plain failure messages — LANDED & better
- **Citation (verbatim), client connect screen:** the certificate field now reads **"Most people can skip
  this — just press Connect and check the ID code. Only choose a file if the person who set up the main PC
  gave you one. (Advanced: it's the CA certificate that signed the server, e.g. ca.crt; full verification
  stays on.)"** — the jargon is pushed into an "(Advanced: …)" aside.
- **Live test — bad address:** I typed a non-existent host and pressed Connect; the screen showed
  **"Couldn't reach that PC. Check the address and port, and that the main PC is switched on with
  search-client access turned on."** — no raw `ETIMEDOUT` / `getaddrinfo` reached me.
- **Expired one-time code (verified at source, `client/renderer/renderer.js` 260–261):** an expired code
  now maps to **"That one-time code has expired. On the main PC, open Settings → Search client → "Connect
  a client" and show a new code (or scan the new QR), then try again."** — it tells the user exactly where
  to get a fresh code. The network-error mapping (264–265) turns every raw socket code into the plain
  "Couldn't reach that PC…" sentence I saw live.
- **Verdict:** the connect screen now guides rather than blames, and the round-A "pairing code expired"
  dead-end (its top friction point) now ends with a clear next step. Good.

### New breakage from the reloads: NONE observed.
Reloading each window loaded the fixed files cleanly. My bad-address test dropped the client to the
connect screen (expected); re-entering the good address reconnected it ("Reconnected", back at sign-in),
so a normal connect still works and the sandbox is left usable.

### Round-B bottom line
- **Fix 1 — connect address:** landed & better (one tiny residual: label the bare `0.0.0.0` bind box).
- **Fix 2 — "ID code" naming:** landed & better (matches on both PCs).
- **Fix 3 — Quick File clears + plural:** landed (source-verified; owner: one live confirm).
- **Fix 4 — plainer connect copy + plain errors:** landed & better (verified live and at source).
