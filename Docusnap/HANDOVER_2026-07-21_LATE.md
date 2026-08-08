# HANDOVER — 2026-07-21 LATE (Opus 4.8)

**Branch:** `feat/reprocess-throughput-autostraighten`
**Last commit:** `370d04d` — **and the branch is FULLY PUSHED** (`HEAD == origin/…`, 0 ahead / 0 behind).
⚠ `HANDOVER_2026-07-21.md` + CLAUDE.md both say "7 commits ALL UNPUSHED". **That is now STALE — verified
tonight with `git rev-list --left-right --count @{u}...HEAD` → `0  0`.** Do not re-push anything.
**Uncommitted batch: YES — 5 files** (see §2). **Installer:** still
`ScanFinder Setup 2.0.0-r20260721-1010-581d626.exe`, which predates commits 2-6 → **REBUILD before any
owner live test.**
**Live DB:** migration **52** (box-width learning HAS applied — CLAUDE.md's "live DB still at 51 until
next start" is stale). 185 confirmed / 12 needs_review / 16 deleted.

**NEXT SESSION IS AN AUTONOMOUS OVERNIGHT NIGHT RUN.** The work plan + its hard rules are §7. Read §7
before touching anything.

---

## 1. TL;DR

A short, mostly-UI session. Three things happened:

1. **First-run wizard cards fixed** (owner: *"this is better"*) — a `theme.css` margin leak was
   knocking every card after the first 16px out of alignment, and the selected card now grows via
   flex-grow. **Uncommitted.**
2. **First-run wizard window made taller** (720 → 820, screen-clamped) because step 1 grows ~95px when
   "Choose a folder" reveals the processed-scans path row, which was tipping the panel into a
   scrollbar that appeared and vanished as the card was toggled. **Uncommitted, NOT yet seen running.**
3. **The wizard "closes itself" bug was ROOT-CAUSED** by a 16-agent adversarial trace — a 12-second
   uncancelled `destroyWindow('onboarding')` timer. **Not fixed.** Owner is testing further; a
   zero-code discriminating test is in §5.

Also inherited from earlier today and still uncommitted: a **substantial teach-wizard batch** (7
changes incl. a real OCR misread fix) that the owner has **never tested**.

---

## 2. UNCOMMITTED — the whole tree

```
 M CLAUDE.md
 M src/main.js
 M src/windows/onboarding/index.html
 M src/windows/teach/index.html
 M src/windows/teach/renderer.js
?? ../Backup/          (outside the repo — ignore)
```

### 2a. `src/windows/onboarding/index.html` — first-run cards (OWNER-APPROVED)

**Root cause (verified):** `theme.css:321` carries `.card + .card { margin-top:16px }` for cards
stacked in a *column*. The wizard's cards sit in a *row*, so every card after the first was pushed
down 16px. **This is the long-standing "the second card doesn't line up" defect.** No amount of
`align-items` could square it up.

Fix: `.cards > .card{margin-top:0}` + `align-items:flex-start`; a shared `min-height:104px` so
unselected siblings match whether their description runs to one or two lines; and `.card.sel` grows to
`min-height:136px; flex-grow:1.55`.

⚠ **Sized with flex-grow, NOT `transform:scale()` — and that is load-bearing.** Scale was tried here
before and backed out because on the wide 2-card Accuracy row it overlapped the neighbour. Flex takes
the extra width *out of* the siblings, so overlap is impossible by construction. (The teach doc-picker
in §2c *does* use scale — legitimately: its cards are ~215px inside a 14px gap, so 1.045 adds ~5px per
side and cannot reach a neighbour. Different geometry, different correct answer. Don't "unify" them.)

Affects all five card rows: copy-folder, theme, threads, accuracy, diagnostics.

### 2b. `src/main.js` — wizard height (NOT YET SEEN RUNNING)

`ONBOARDING_WINDOW_OPTIONS.height` 720 → **820**, plus a new `onboardingWindowOptions()` that clamps to
`workArea.height - 40` (floor 600) at open time, because `screen` isn't available at module load.
Rationale: the window is `resizable:false`, so it must fit its **tallest** step, not its average one —
and a hardcoded 820 would put the "Next" button under the taskbar on a 768-high laptop with no way to
resize out of it. The panel keeps its internal `overflow-y` as the backstop.

Verified: `main.js` parses (`vm.Script`). **Not verified: that 820 is actually enough** — it needs an
app restart to see, which had not happened when the session ended.

### 2c. `src/windows/teach/{index.html,renderer.js}` — teach batch (OWNER HAS NOT TESTED ANY OF IT)

Seven distinct changes, all built earlier today:

1. **OCR parity with Review (a real misread fix).** Owner reported teach reading `SO-51261` as
   `$00-51261` where Review reads it correctly. Cause: teach downscaled every crop to
   `OCR_TARGET_H≈28px` — roughly half a 1.5-scale line, enough to collapse `S`→`$` and `O`→`0`.
   Review's `runZoneOcr` crops at **native** resolution (`review/renderer.js:3188-3197`) and
   `region.py`'s own light-first ladder already handles scaling, so the downscale was doing badly what
   the recipe already does. **Kill switch `TEACH_NATIVE_CROP=false` restores the old downscale.**
   Also switched to `D.ocrRegionBoxes` first with a plain `ocrRegion` fallback — the same order Review
   uses, so one recipe instead of two that can drift. (Verified tonight: `ocrRegionBoxes` really does
   exist — `preload.js:212` → `processing/handler.js:1806`.)
2. **The Document Issuer is now taught POSITION-ONLY.** Real letterheads print no caption above the
   company name, so asking for a "label" manufactured a **phantom anchor that never re-locates on a
   future scan** — the teach silently did nothing. Same rule Review already applies
   (`review/renderer.js` RC2, Oracle-signed 2026-07-10); label-less mappings are a first-class case in
   `template_mapper.py:405` (base 78 "no label" vs 90 "anchor located"). Its saved "anchor" box is now
   the target itself, never a synthesised box 0.1 to the left (that was phantom geometry the mapper
   could try to relocate against).
3. **Read-back panel moved to the banner.** It used to sit at the *bottom* of the page pane while the
   instruction sat at the top, so the eye ping-ponged. Now one place, under the instruction it belongs
   to. Every write funnels through `setConfirm()` — a single seam if it ever moves again.
4. **Prompt emphasis** — `.pact` (quiet action line) + `.ptitle` (field name as a title), always set
   through one `setPrompt(action, title)` helper so a later caller can't lose the emphasis.
   ⚠ **A "What to do now" GUIDANCE BAND above the pane was built earlier and REJECTED by the owner as
   "too much". Do NOT rebuild it.** This small version is the accepted answer.
5. **Doc-picker cards are now page previews** (215px min, 210px-tall top-of-page thumbnail, ✓ badge,
   `scale(1.045)` on the selected one). At the old shared 48×62 icon size every scan from one company
   looked identical, so the user physically could not do what the step asks ("pick one clear, typical
   scan"). Selection toggles **in place** rather than re-rendering — a full re-render re-ran the lazy
   thumbnail loader on every card and made "exactly one card is big" depend on a clean rebuild.
   Same `.grid > .card{margin-top:0}` theme.css leak cancelled here (in a grid it made the first card
   *taller* than its row-mates, because grid items stretch to a shared bottom).
6. **Opens at 1.5× zoom** (`TZ_DEFAULT`) — the fitted page is too small to draw an accurate box on, so
   every user zoomed in by hand first. Deferred to the next frame and applied after any deskew
   re-render so `tzApply` measures the true fitted width.
7. Wording: "Unknown supplier" → "Unknown issuer" (display name is Document Issuer since mig 38).

**No tests were run against any of this.** See §4.

---

## 3. The wizard self-close — ROOT-CAUSED, NOT FIXED

Owner: *"on clicking between cards, the wizard closed itself and I had to reopen it"* — on the **folder
cards** (step 1), which make **no IPC call at all**. Traced by a 16-agent workflow (4 independent
lenses → adversarial refutation → synthesis).

**Winner (all FACT, quoted):**

1. `main.js:210-217` — `openMainShell()` builds
   `teardown = () => { destroyWindow('login'); destroyWindow('license'); destroyWindow('onboarding'); }`
   then arms **both** `main.once('ready-to-show', teardown)` **and** `setTimeout(teardown, 12000)`.
   The timer handle is never stored; there is no `clearTimeout` anywhere in `main.js`.
2. `teardown` captures **no window handle** — `destroyWindow(name)` resolves `windows['onboarding']`
   **at fire time**, so it kills whatever wizard exists 12s later, *including one created after the
   timer was armed*.
3. `destroyWindow` sets `_allowClose = true` before `close()`, and the primary-window close
   interceptor is gated on `!win._allowClose` — so this is a **real DESTROY, not a hide-to-tray**.
4. On a re-run the main shell already exists, so `createWindow('main', …)` takes the **reuse** branch
   and returns **without reaching `loadFile`** ⇒ `ready-to-show` can never re-fire ⇒ **the 12s
   backstop is the only teardown that ever runs.**
5. Armed by `D.onboardingComplete()` — `onboarding/renderer.js:261` (final Next) and **`:272` (Skip
   setup)** → `main.js:1302-1316`, whose body writes the flag and calls `openMainShell()` but **never
   closes the wizard itself**.

**Symptom this produces:** you press Skip (or the final button); the wizard *stays on screen and stays
clickable* (main is merely raised behind it), so it looks like nothing happened; you carry on clicking
cards; ~12s later the window is destroyed mid-interaction, silently. **Second variant needing no user
action at all:** re-opening the wizard within 12s of any previous finish/skip — the still-armed earlier
timer kills the brand-new window.

**HYPOTHESIS (the only unobserved link):** that the owner pressed Skip/finish shortly before the
disappearance. `skipBtn` sits in the footer on every non-final step, right beside the cards. Card
clicks *alone* cannot arm anything — every card handler only calls `set-setting`/`set-processing-mode`,
and `settings/handler.js:442-456` makes no window-lifecycle call.

**RULED OUT — do not re-chase:** renderer crash (`app.on('render-process-gone')` `main.js:1150-1164` is
log-only, and **the dev log `processing.log` has ZERO ERROR/WARN lines since the 21:07:04Z start** —
checked); no `window.close`/`location.*` in `windows/onboarding/*` or `shared/theme.js`; parent
cascade (onboarding is not in `CHILD_WINDOWS`, so it has no parent); `showLicenseWindow`'s close loop
(it would also destroy `settings` and show a lock window — neither observed).

**Fix direction (smallest correct, NOT built):**
1. When `createWindow('main', …)` returns via the **reuse** branch the shell is already painted, so
   `openMainShell` should run `teardown` **synchronously** instead of arming a 12s delay. That alone
   turns the reported symptom into "Skip closes the wizard immediately", which is the correct
   behaviour.
2. Make `teardown` **identity-scoped**: capture the actual `BrowserWindow` instances at call time and
   destroy only those exact instances if still alive, so an older timer can never hit a newer wizard.
   (Needs a by-instance variant of `destroyWindow`.)
3. Store the `setTimeout` handle and `clearTimeout` it in the `ready-to-show` arm and on main's
   `closed`.
4. `ipcMain.on('onboarding-complete')` should destroy its own window rather than relying on a generic
   delayed sweep — the signal's window should not outlive the signal.

⚠ **Related but SEPARATE, do not fold in blindly:** the `createWindow` reuse-without-`loadFile` seam
(`main.js:511-527`) means a *hidden* wizard reopens on its stale step with stale renderer state. Fixing
the timer does not fix that. It also means **renderer edits to onboarding/login/license/main need a
FULL APP RESTART**, not a window reopen (teach/review/settings/search do reload — they're destroyed on
close).

Full agent transcript: `…/subagents/workflows/wf_25254fef-695/journal.jsonl`.

---

## 4. Verification state — be honest

**What actually ran tonight:**
- `main.js` syntax check via `vm.Script` → parses.
- Live-DB read-only queries (Electron-as-Node) → migration 52; `first_run_completed="true"`,
  `close_to_tray` unset (⇒ hide-to-tray **active**), `telemetry_enabled="false"`, `theme="dark"`.
- `processing.log` scanned for ERROR/WARN since the 21:07:04Z start → **none**.
- The 16-agent trace in §3 (adversarial verify pass; 16/16 agents completed, 0 errors).

**What did NOT run — assume nothing about it:**
- **No test suite. No corpus/realdoc regression. No Python tests. Nothing.**
- The onboarding **height** change has not been seen in a running app.
- The **entire teach batch** (§2c) is untested by anyone — including the OCR-parity change, which is
  the one that alters read behaviour.

**Corrections to earlier claims:**
- "7 commits ALL UNPUSHED" (CLAUDE.md / HANDOVER_2026-07-21.md) — **false**, the branch is fully pushed.
- "live DB still at 51 until next start" — **false**, it is at **52**.
- CLAUDE.md says opt-in diagnostics is "DESIGNED but NOT built" — **false**, it IS built:
  `src/modules/telemetry.js` (event allowlist, consent cache, purge-on-opt-out), migration 42's
  `telemetry_events` buffer, the Settings toggle (`settings/renderer.js:4493`), and the wizard card.

**Diagnostics default — audited on request, confirmed OFF:** `renderer.js:14` initial `diag:false`;
`:83` reads `=== 'true'` so unset ⇒ off; `:252` writes an explicit `'false'` when clicking through or
skipping; nothing seeds the key anywhere; `telemetry.js:101` is independently strict opt-in and
defaults `false` on any read error; `settings/handler.js:451` purges the buffer on opt-out.

---

## 5. Needs the USER (not the night run)

1. **Restart the app** (`npm start`) and check the wizard height is enough — the height change cannot
   be seen without a full restart.
2. **Discriminating test for the self-close** (zero code): open Settings → Advanced → Re-run setup,
   click **Skip setup**, then touch nothing and count. Predicted: it sits there ~12 seconds and
   vanishes on its own. Separately, when it vanishes, reopen it — *same step with choices still
   highlighted* ⇒ it was hidden; *fresh at step 1* ⇒ destroyed by the timer (the winner).
   (The tray is not a discriminator: `showPrimaryWindow` only reveals `main`/`login`.)
3. **Test the teach batch** (§2c) — especially: does a drawn box now read `SO-51261` correctly, and
   does teaching the Document Issuer complete without asking for a label?
4. **Rebuild the installer** before any live test — the current one predates 5 of the last 7 commits.
5. Longstanding, unchanged: print/Ricoh live test (`75206fb`), detected-type nudge fresh-install run
   with dockets, Generic-Document smoke, reprocess-parallelism 6-core load test, Filing Slips real-MFD
   pilot, licensing V7 (live `REMOTE_ADDR`) + V8 (`test_admin_throttle.php` with WAMP up).

---

## 6. Background processes

- **`npm start` is RUNNING** (task `btgj1hkkb`, started 21:07:04Z). Electron's console does not reach
  that task's output file — **the real log is `<repo>/processing.log`** (dev mode writes there, not to
  userData; `main.js:921-924`).
- **CLOSE THE DEV APP BEFORE ANY `npm run build`** — EPERM on `better_sqlite3.node`.

---

## 7. THE NIGHT-RUN PLAN

### 7.0a OWNER-SET SCOPE FOR THIS RUN (decided 2026-07-21 LATE)

**BUILD P1, DIAGNOSE P2.** Explicitly:
- Commit the uncommitted UI batch as 3 commits (§7.1), no push.
- **P1 (repairSuspects ref-prefix blindness): BUILD IT** — root cause verified, detector-only blast
  radius. Kill-switched, control-test-first, Oracle-gated, pinned. Decide + state the Python-mirror
  question (one side or both).
- **P2 (duplicate dates): DIAGNOSE ONLY.** Pin which stage writes the duplicates and produce an
  Oracle-vettable fix design. **Do NOT build a P2 fix this run** even if the cause looks obvious.
- **P3-P5: DESIGN ONLY if time remains** (Oracle-vetted plans), do not build. Do not touch the
  `LETTERHEAD_ISSUER` flip or anything in the "do not start tonight" list.

### 7.0 Hard rules (non-negotiable, they encode past failures)

- **Control-test FIRST.** Capture the baseline *before* writing code. Every behavioural change is
  **kill-switched**, and with the switch OFF the corpus must be **byte-identical**.
- **Corpus gate:** `stress_test/realdoc_regression.js` with `GATE=1`. **READ THE REPORT FILE** — a
  trailing `echo` masks the exit code, and `GATE=1` exits 1 on any silent regression including the
  known pre-existing class. Never hand over "the gate passed" without having read it.
- ⚠ **`realdoc_regression.js` spawns `process_docs.py` DIRECTLY — it is structurally BLIND to every
  Electron/renderer change.** A green corpus run proves *nothing* about items P3/P4/P5 below.
- **Advisor + Oracle gate on substantive changes.** gary for Python root-cause/fix design, eric for
  anything touching window lifecycle/IPC, reggie for patterns, then **Oracle last**. Brief them fully —
  a fresh spawn starts cold.
- **DO NOT push. DO NOT rebuild the installer. DO NOT commit anything that isn't yours** without
  saying so plainly in the morning report.
- **DO NOT confirm any document in the review queue.** The 12 `needs_review` docs are the label-garble
  set — confirming one plants the garble into learning. Do not touch the live DB at all.
- **Doc #190** (`LarkspurInteriors_purchase_order_08.pdf`) is known poisoned GT (a PO confirmed as a
  delivery note). Do not use it as evidence of anything.
- Python: never `py -c` with newlines — write a `.py` file. Packaged embeddable Python drops the script
  dir from `sys.path` (`sys.path.insert` then `from ocr.x import …`).
- Run JS tests with **Electron-as-Node**, not plain node (native-module ABI):
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>`.

### 7.1 FIRST ACTION — clear the tree

**Commit the uncommitted batch (do NOT push).** Three commits, so the owner can revert any one:
1. `fix(onboarding): square up the first-run card rows and enlarge the chosen card` (+ the main.js
   height change, or split it out as its own `fix(onboarding): size the wizard for its tallest step`).
2. `fix(teach): read drawn boxes at native resolution, matching Review` (+ the issuer position-only
   change — or split; the issuer change is behavioural and deserves its own).
3. `feat(teach): one read-back panel at the top, page-preview doc picker, 1.5x default zoom`.

State clearly in the morning report that **none of it has been owner-tested**.
There is also a **known pre-existing five-failure test set** that is NOT yours and must not be
"fixed" opportunistically: `test_anchor_crop_crosscheck` (3), `test_late_anchor_rescue` (7),
`test_template_rescue` (1), `test_field_data_types` (silent), `test_identity_fusion` (known). If you
run the suite, expect them; report them separately from anything you cause.

### 7.2 Priority order

**P1 — `repairSuspects` is structurally blind to a ref-prefix outlier.** *(Best night-run job: root
cause already VERIFIED, blast radius is a detector only, no extraction change, and it is one of the two
items actively corrupting learning.)*
`src/services/repairSuspects.js:36-45` `shapeSignature` maps **every letter to `@`**, so `PO-21275`
and `DN-70795` both reduce to `@@-#####` — identical. The detector discards the only differing token,
so this class is **structurally invisible; no threshold tuning can ever surface it** (B1 at `:182` and
the pool check at `:239` both compare shapes only).
Fix direction: learn the dominant **alphabetic prefix / literal token** per (doc-type, field)
alongside the shape, and flag a strong-dominant mismatch. Owner: *"needs to be smarter than a 1-char
swap"* — a single-character edit-distance rule is explicitly not enough.
⚠ **Mirror lives in `format_anomaly_checker.shape_signature` (Python) — keep the two aligned or they
drift.** Decide deliberately whether this fix belongs in one or both, and say which in the report.
Note: doc #190 is *also* the poisoned-GT doc, so this detector working would have caught the poisoning
itself — that is the motivating case, not a test target.

**P2 — irrelevant date fields all filled with the same value.** *(Highest value, but DIAGNOSE ONLY
unless the cause is unambiguous and a kill-switched fix is provably byte-identical when off.)*
Seen in Learning Repair on `IronbridgeFabrication_delivery_docket_04.pdf`: a delivery note shows
Delivery Date **and** Invoice Date **and** Order Date **and** Po Date, all four `12-06-2026`, while the
real Delivery Date read as the garbled "2 12/06/2026" and got flagged. **Two separate faults:**
(a) a delivery note carries invoice/order/po date fields *at all* — extraction runs against the
**union of all installed types' keys**, so a date lands in every date-ish key; (b) **one value is
copied into every one of them**, which then feeds learning as if corroborated.
**Fault (b) is the one that matters — find which stage writes the duplicates before designing
anything.** Overlaps the per-template field HIDING item but is NOT the same thing: hiding is
display-only, this is bad DATA being stored and learned.

**P3 — the wizard 12s teardown timer** (§3). Small, fully understood, `main.js` only. Build fix
direction items 1-3; item 4 (`onboarding-complete` owning its own window) is the tidiest but touches
the shell swap — **run it past eric**. ⚠ Corpus gate is blind here; the proof is the two zero-code
observations in §5.2, which only the owner can perform — so **build it, pin it with a unit test if you
can, and leave the live confirmation to the owner.**

**P4 — field order unstable across documents.** `getWithExtractions` (`database/modules/documents.js:126`)
is `ORDER BY rowid` = the order the **Python engine** happened to emit fields for *that* doc, which
varies by which stage won — so it is arbitrary per document. `fields.sort_order` **already exists**
(`database/index.js:1205`, default 100) and is the intended canonical order. Fix = order displayed
fields by the type's `sort_order` (fallback rowid) **at the SHARED seam** so Review / Search / detached
client all agree. ⚠ **Check the `/v1` DTO contract before changing client-visible ordering.**
Structural roles (issuer/date/ref) must stay reorderable-but-never-deletable. The drag-to-reorder
editor UI is a *second* slice — do not start it the same night.

**P5 — Template Manager alphabetical.** Small. `templates.getAll` (`database/modules/templates.js:32`)
sorts `confirmed_count DESC, name`. ⚠ **SEAM — that same `getAll` feeds the sibling tiebreaks and "the
order templates reach the matcher"** (`277a107` / `TEMPLATE_LIVE_COUNTS`), so **do NOT re-sort the
query**. Sort in the Admin Template *viewer* only, or add an explicit display-order argument.

**Do not start these tonight** (they need owner input or a decision): `LETTERHEAD_ISSUER` flip
(owner + Oracle call), per-template field hiding, keyword-per-field UI, the first-run
output-folder-not-copying-on-a-different-PC bug (unstarted, needs reproduction on a second PC),
po_date corroboration, worksheet line-merge mode-3, buyer-issued Supplier→issuer trace, workflow
slices 5/6.

### 7.3 Morning report

State per item: what was built, the kill-switch name, the baseline-vs-after numbers **with the report
file you read**, which advisors signed off, what is UNVERIFIED, and anything you deliberately did not
do. Be explicit where a green gate proves nothing (P3/P4/P5).

---

## 8. Key facts & paths

- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db` (ScanFinder, *not* DocuSnap). Read it **read-only**:
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <script.js>` with
  `new Database(path, { readonly:true, fileMustExist:true })`. Plain `node` fails on NODE_MODULE_VERSION.
- **Migration 52** live. Old 213-doc misfile corpus preserved at
  `%APPDATA%\ScanFinder\docusnap.backup-20260720-misfile-corpus.db` (replayable via `TEMPLATE_PROBE_DB`).
- **Dev log:** `<repo>/processing.log` (dev writes to the repo, packaged writes to userData).
- **Output folder:** `C:\Users\cmccu\Desktop\Kyle Test\Documents`; `processed_folder` is empty
  (⇒ a "Processed" subfolder beside the scans).
- **Corpus gate:** `stress_test/realdoc_regression.js` (`GATE=1`). **Template gate:**
  `stress_test/template_gate_probe.py` — a permanent live-DB replay; `realdoc_regression` is blind to
  the wrong-template-match class.
- Prior handovers, most recent first: `HANDOVER_2026-07-21.md`, `HANDOVER_2026-07-20_LATE.md`,
  `HANDOVER_2026-07-20_EVENING.md`, `HANDOVER_2026-07-20.md`.
- Advisors: `gary` / `oracle` / `barry-the-brainstormer` / `eric` / `oscar` / `reggie` are registered
  subagent types; **`007` is NOT** — spawn general-purpose with the persona from `.claude/agents/007.md`.
