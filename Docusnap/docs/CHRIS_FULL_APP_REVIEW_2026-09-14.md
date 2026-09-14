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
