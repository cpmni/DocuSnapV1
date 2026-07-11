# Scan Finder — overnight review & testing log

**Date:** 2026-06-29 (overnight autonomous session)
**Scope:** Review/test only. The *only* code change made this session is the **search-client setup help file** (explicitly discussed/approved). Everything else below is **logged for your decision — nothing else was changed.**

> Legend: 🔴 blocker / real bug · 🟠 should-fix · 🟡 nice-to-have / improvement · 💡 feature or design idea · ✅ verified OK

---

## TL;DR (read this first)
- **Done & committed:** the **search-client setup help file** (the one approved change) — a layman walkthrough + a "Set up the search client…" button in Settings, advanced cert items tucked away. Pushed.
- **Tests:** the **entire suite is green** — 75 Python + 65 JS files + the 400-doc stress harness (0 false-joins). The Stage-2 extraction reorder from earlier holds up.
- **MSIX / Store:** **GO-WITH-WORK** — keep NSIS as primary, add MSIX as a Store SKU. Four work items (§1): **storage relocation** (the per-package AppData gets wiped on uninstall → breaks "persist across reinstall"/anti-trial-stacking), a **Store-commerce-vs-Polar decision**, `runFullTrust` capability, and a 4-part version scheme. Disclose/strip the hidden dev-inspector for the Store build.
- **One real release-blocker:** the **concurrency cap is still at the testing value of 10** with a "revert before shipping" TODO in **three** places (§C1) — revert before release.
- **A few small bugs in *this session's* auto-file work** to tidy (§C2–C4) — the most important is **C4**: auto-file deletes the working copy, which undercuts the new "review the auto-committed docs" re-file path.
- **Security:** every desktop-side audit item I could check (F-02, F-06, F-07, F-08) is **already fixed**. Remaining open items are server-side/architectural (F-01/F-03), tied to the commerce decision.
- **Product (bob's top 5):** bundled "try it on a sample" first-run · plain-language status badges instead of "confidence %" · a "why is this in review?" one-liner · card-group the Settings wall · settle the Store-commerce question first.
- **Full prioritised list:** see §5 (release-readiness checklist).

---

## ✅ Progress — 2026-06-30 working session (committed + pushed)
Worked through the code fixes step by step, each with an impact check:
- **C1 — concurrency cap** reverted 10→5 in **all four** spots (two engine clamps, the Settings JS, the watch handler, + the dropdown 6–10 options). *(commit: revert concurrency cap)*
- **C2 — auto-filed banner** now resets per burst (first auto-file after a 60s quiet gap), so watch sessions don't grow it unbounded.
- **C3 — teach temp folders** swept on each stage (bounds `sf-teach-*` clutter to ≤1).
- **C4 — reprocess** now resolves a confirmed doc's source from `stored_path` (re-surfaced auto-filed docs no longer "File not found"). **C4b** (re-file-after-edit duplicate/orphan) is a **pre-existing `commitDocument` behaviour that also affects "Edit in Review"** — deferred as its own careful step (a naive change risks deleting the filed copy).
- **C6 — `inc_ocr_conf`** consistency in the registration rung's `_should_replace`.
- **C8 — Reprocess-All shard watchdog** now self-settles on timeout (no Promise.all hang).
- **Help-coverage gap** (review `advanced`) closed.
- All anchor/extraction suites stayed green through these.

**Licensing model clarified by the owner (reshapes §1):**
- **B3 RESOLVED** — the Store app is **free, trial-only**; the Store is purely a distribution vessel for the 14-day trial. The trial is obtained from + recorded on the **backend against the device fingerprint**; reinstalling can't reset it (the fingerprint is MachineGuid-derived, outside the AppData container). **All sales are via Polar; licences issued/managed by the backend.** No Microsoft commerce.
- **B1 LARGELY RESOLVED** — because the trial's authority is the backend+fingerprint (not the local token), an MSIX container wipe on uninstall does **not** enable trial-farming. Residual is only *learned-data*/cached-token loss on uninstall (a value/UX point, covered by Backup & Restore), no longer a licensing blocker.
- **electron-builder version resolved:** installed is **24.13.3** (CLAUDE.md's "v26" is incorrect). For the MSIX `appx` target, consider upgrading — capability/`runFullTrust` injection improved in later majors.

**Remaining MSIX/Store prep (for when packaging begins):** `runFullTrust` + the `appx` target config · **disclose or strip the dev-inspector** for the Store build · 4-part numeric version · optionally relocate just the SQLite DB to preserve learned data across an MSIX uninstall.

### ✅ Follow-on session (2026-06-30, later) — also done
- **Dev-inspector split:** main-window inspector now **dev-only** (`!app.isPackaged`); **Review trace console kept** in packaged for on-site diagnosis (owner will disclose it to MS Store; never in help).
- **Client app keyboard-focus bug fixed:** the client never grabbed `webContents.focus()`, so text fields wouldn't type until you clicked out/in. Window-level fix (cures all fields) + `totp` rAF defer + **pattern logged in CLAUDE.md** for future client fields.
- **C4b done:** re-filing a confirmed doc now **moves/replaces** cleanly (no `-DUPLICATE`/orphan, no "source not found"); first-time confirm byte-identical.
- **MSIX:** `MSIX_SETUP.md` written (the full dual-track recipe); electron-builder version corrected to **24.13.3** in CLAUDE.md. appx wiring intentionally NOT committed (needs the Partner-Center identity + a build machine).
- All commits pushed; filing/review/anchor suites green throughout.

---

## 0. What I implemented (the one approved change)
- **New `src/windows/help/search-client-setup.html`** — a self-contained, layman "Set up the Search Client" walkthrough: turn on access + enter address → the automatic certificate (explained simply) → connect the other PC → Windows Firewall exception → a **connection-problems FAQ**.
- Registered it in the help nav (`help-nav.js` PAGES + search index).
- Added a **"Set up the search client…"** button to **Settings → Search client access** (`btn-client-setup-help` → `openHelpWindow('client-cert-setup')`).
- **Buried the advanced cert items** (Generate/re-issue, Export connection profile, your-own-cert paths) under the **Advanced** disclosure; the Managed-TLS panel now shows just a plain "created automatically — nothing to manage" status.
- Verified: JS syntax OK; help-coverage check OK for settings (39/39 keyed controls).

---

## 1. MSIX / Microsoft Store packaging assessment (via eric)

**Verdict: GO-WITH-WORK — keep NSIS as primary, add MSIX as an additive Store SKU. Do NOT make one build serve both** (storage model + payment contract genuinely diverge).

### 🔴 B1 — Storage virtualization breaks "persist across reinstall" + anti-trial-stacking
All durable state hangs off `app.getPath('userData')` (`%APPDATA%\ScanFinder`): the SQLite DB (`database/index.js:14`), `inbox/`, `certs/`, `templates/`, cached `license_tokens`. The design **relies** on this surviving reinstall (`deleteAppDataOnUninstall:false`; the device-bound anti-trial-stacking model). Under MSIX, Roaming-AppData writes are redirected into the **per-package container**, which is **wiped on uninstall by default** → reinstalling resets the trial, drops the cached licence token, and loses learned data.
**Fix (recommend, one change):** relocate *durable* state (DB, `license_tokens`, `certs/`, learned templates) to a non-container path via the existing `app.setPath('userData', …)` hook (`main.js:34`), guarded so NSIS keeps today's path. `inbox/` + logs can stay in the container. (Needs verification on target Windows builds — redirection/wipe behaviour varies.)

### 🟠 B2 — Restricted capabilities → manual Store certification review
Needs **`runFullTrust`** (spawn bundled Python/Tesseract; read MachineGuid from HKLM; arbitrary folder I/O; inbound socket). If durable state moves to Documents/arbitrary paths, also **`broadFileSystemAccess`** — both require written justification + manual review (allowed, but slower/rejectable).
**Fix:** declare `runFullTrust`; **avoid `broadFileSystemAccess`** by using the existing folder pickers (`pick-folder`/`pick-output-folder`) for scan/output folders (picker-granted access needs no broad cap). electron-builder's `appx` target won't add restricted caps for you — needs a custom manifest fragment.

### 🟠 B3 — Store payment policy vs your Polar/JWS licensing (needs a business decision)
Store policy generally requires digital licences sold to Store users to go through Microsoft commerce; an entirely-external Polar/JWS activation can be flagged, and a Store-purchase + Polar-key double-charge must be avoided.
**Decision (pick one):** (a) list **free** on the Store, keep external Polar activation (cleanest — verify it's compliant as a "free app connecting to an external service"); or (b) use Store commerce for the Store SKU and bypass Polar there. Never present both.

### 🟡 B4 — Versioning needs a 4-part numeric scheme
MSIX requires `a.b.c.d` numeric, strictly increasing per submission; the `<UTC>-<gitsha>` build stamp can't live in the package version. Map SemVer → `MAJOR.MINOR.PATCH.<build counter>`; keep the git-sha only in the About box.

### Store-submission red flags to pre-empt
`runFullTrust`/`broadFileSystemAccess` justification · external activation + Polar (B3) · the inbound LAN API (opt-in, off by default, loopback-default, TLS-pinned) · **the hidden dev-inspector (Ctrl+Shift+D+M, pw `SFDEV`)** — Store dislikes undocumented/hidden functionality; **disclose it or strip it from the Store build** · bundled interpreter/child-process spawning (disclose).

### ✅ Confirmed FINE (don't over-engineer)
- Inbound LAN server **survives** under full trust (the loopback/`loopbackExempt` issues are UWP-AppContainer-only; a `runFullTrust` app uses the full user token). Same firewall first-bind prompt as today.
- Bundled Python + Tesseract are acceptable (bundled, not downloaded → policy 10.x not violated); native `.node`/`.exe`/`.dll` are covered by the MSIX package signature (and Store re-signs → **fixes today's unsigned-SmartScreen prompt** for the Store channel).
- MachineGuid stays readable/stable under full trust.
- `extraResources`/`asarUnpack` translate cleanly to the appx target.

### ⚠️ FACT to resolve first
`package.json` pins **electron-builder `^24.13.3`**, but CLAUDE.md says **v26**. The `appx` target + capability injection differ across majors — **confirm the actually-installed version** before configuring MSIX.

---

## 2. Code / function review findings (via a deep read-only review)

> Several of these are in code **changed this session** (the backend auto-file + teach import). Per your "no other changes" instruction I did **not** fix them — flagging for your call. The two I'd action before a release are **C1** and **C4**.

### 🔴 C1 — Concurrency cap left at a test value with a "revert before shipping" TODO *(pre-existing, release-blocker)*
Clamps `processing_concurrency` to `Math.min(10, …)` with an explicit *"revert before shipping"* TODO in **three** places: `processing/handler.js:579-582` (import), `:1177-1181` (Reprocess All), and **`src/windows/settings/renderer.js:293`** (`// TESTING: raised 5 → 10; revert before shipping`). On a 4-core box with concurrency 8, `threadCap` floors to 1 → 8 single-threaded Tesseract procs contend for 4 cores (2× oversubscription) → the batch runs **slower**. **Revert all three to `Math.min(5,…)` (or core-count) before release.** (A repo sweep for `TODO/before shipping/revert` otherwise found only benign input placeholders + comments.)

### 🟠 C2 — Auto-filed banner counter never resets during watch *(introduced this session)*
`main/renderer.js`: `_autoFiledThisRun` only resets in `handleProgress`'s `'start'` case, but `handleProgress` early-returns for watch events while `onDocAutoFiled` still increments for every (incl. watch) auto-file. A long watch session shows a persistent, ever-growing "N documents auto-filed" banner with no run boundary. **Fix:** a watch-driven reset or a separate watch tally.

### 🟠 C4 — Auto-file deletes the working copy, undercutting the "re-surface & re-file" path *(introduced this session — important)*
`_autoFileDoc` unlinks the inbox working copy + nulls `working_path` after filing. But the new Review "auto-committed" re-surface lets an operator open a *confirmed* auto-filed doc and **re-file** it. With `working_path` gone: **reprocess** falls back to the drained original in `Processed/` (fragile, can "File not found"), and **re-filing** re-copies from the drained original → a `-DUPLICATE` organised copy. **Fix:** keep the working copy until the doc ages out of `recent_auto_filed`, or source re-file from `stored_path`.

### 🟡 C3 — `stage-pdf-for-teach` leaks a temp dir per invocation *(introduced this session)*
`handler.js` `fs.mkdtempSync(...'sf-teach-')` is never cleaned up; each teach-import leaves an `sf-teach-*` folder (+ a `Processed/` subfolder) in `%TEMP%`. **Fix:** remove the temp dir after the import resolves.

### 🟡 C5 — `_partial_of_uniform_shape` can over-refuse a shorter new ref *(by-design trade-off)*
A genuinely-new shorter code that is a sub-run of the uniform learned shape (e.g. `1234-5678` vs history `####-####-#`) is refused → review. **Fails safe** (never a wrong value); this is reggie's intended conservative choice. Logged as a known trade-off, not a bug. A targeted test would document it.

### 🟡 C6 — Registration rung omits `inc_ocr_conf` in `_should_replace` *(latent asymmetry)*
Relocate passes `inc_ocr_conf=ocr_conf`; the (now-after) registration rung doesn't. Moot today (registration only fires when value is None/weak), but becomes a real bug if that trigger is ever loosened. Make the two rungs consistent.

### 🟡 C7 — LABEL-LOCK locate runs for every free-text anchor, even on clean pages *(perf)*
The free-text label-lock runs a page-wide locate (cache-mitigated) before the cheaper drift trigger, on every doc. On image-only scans with several free-text anchors this adds a guaranteed full-page locate even when the rigid crop was perfect. Worth benchmarking vs the pre-reorder path.

### 🟡 C8 — Reprocess-batch shard watchdog doesn't self-settle *(hang risk)*
`handler.js:1213-1217`: on timeout it `taskkill`s the proc but relies on `proc.on('close')` to resolve the shard promise; if the kill fails the `Promise.all` hangs the full 30-min window. The single-doc path settles directly in its watchdog — the batch path should too.

### Smaller improvements noted
- `setImmediate(_handleFileMessage(...))` for non-`file_done` msgs omits `autoFileRun` (harmless — they return early — but clearer to pass it).
- `_autoFileDoc` returns silently on `!fr.success`; a `logger?.warn` would aid diagnosis.
- `onDocAutoFiled` ships an `info.count` the renderer ignores — use it or drop it.
- 🟡 **Help-coverage gap:** `check-help-coverage.js` reports `review: data-help-key "advanced"` has no `HELP_TEXTS` entry. One-line add.

### ✅ Verified OK (don't touch)
- **SQL**: all queries parameterised, incl. `documents.getByIds`'s `IN (${ph})` placeholder build — no interpolated values.
- **IPC role-gating**: all mutating handlers `requireRole`; dev-session getters read-only; licence re-checks gate process/reprocess.
- **`recent_auto_filed` concurrency** (the worry I flagged): `_recordAutoFiled` is fully synchronous read-modify-write on the single-threaded loop — no lost-update race despite concurrent workers.
- **Drain duplicate-safety**: EXDEV vs transient-lock handled correctly; locked-unlink-after-copy removes the copy (no duplicate). Sound.
- **Reprocess single-doc lifecycle**: settles exactly once across close/error/watchdog.
- **`safeSend`** guards the destroyed-webContents crash on mirrored progress.
- **First-run onboarding (the Store-conversion-critical path)** is robust: every `getSetting` is wrapped with a working default, `needsOnboarding`/the flag-write are fail-open (`main.js:186,882`), output-folder validation falls back to `{ok:false}` on error (`onboarding/renderer.js:141`), and only the output folder is required. A broken setting can't brick first run. *(My own check — verified OK.)*

---

## 3. Test results
- **Python:** **75 / 75** test files pass (script-style run, 120s timeout each) — including the new `test_anchor_arbiter_reorder.py` and the refreshed `test_anchor_registration.py`. No failures, no flakes.
- **Free-text regression:** the 400-doc `multiline_measure` stress harness still **`[PASS]` — 0 false-joins, 100% recall** after the Stage-2 reorder.
- **JS (Electron-as-Node):** **65 / 65** test files pass (database/modules, services, modules, client) — no failures.
- **Net: the entire suite is green** — 75 Python + 65 JS + the stress harness. No regressions from this session's changes.

---

## 4. Improvement & feature suggestions (product lens via bob + mine)

### 💡 If you only do 5 things (bob's recommendation, strongly seconded)
1. **Bundled "Try it on a sample" first-run path** *(S/M)* — ship 2–3 sample PDFs + a "Try Scan Finder on a sample" button that runs them end-to-end and lands the user in Review with a filled, green result. The Store trial converts on the *first* successful extraction; this removes "I have nothing to test with." **Highest-leverage change.**
2. **Reframe "confidence %" as plain status badges** *(S)* — "Ready to file / Please check / Needs your input" (keep the number as a tooltip). A layman reads a bare percentage as a grade/criticism.
3. **One-line "why is this here?" on every review doc** *(S)* — a calm human sentence ("I couldn't find the invoice date" / "This supplier's layout is new to me"). You already compute validation notes + template-recheck signals; just surface one line. Turns review from a chore into a guided fix.
4. **Settings card-grouping + plain-language labels** *(S/M)* — the known "flat monochrome wall." Group into titled cards (Setup / Learning / Administration) with a one-line helper each; purge internal vocab ("anchor/template/extraction/reprocess") from operator-facing surfaces. Settings is where an anxious buyer goes to feel in control.
5. **Resolve the Store packaging + commerce + licensing question first** *(diagnosis)* — a precondition that can invalidate other work (see §1). Independently reached by both bob and eric.

### 💡 Other ranked feature ideas
- **"What Scan Finder has learned" milestone moment** *(S/M)* — elevate the existing "Getting smarter" card into an occasional gentle toast ("You've taught 5 suppliers — it now files most of these automatically"). Makes the core differentiator *felt*; great screenshot material. (Don't nag.)
- **First-run "what do you file most?" preset picker** *(M)* — surface the preset doc-type catalog (today buried in Settings) as an optional onboarding step; extraction gets a head start and the app feels tailored in 20 seconds.
- **"Find a document" as a first-class verb on Home** *(M)* — the product is Scan *Finder*; search is the long-term retention hook. Prominent search + a great empty state ("Filed documents are instantly searchable — try a supplier name").
- **Trial→buy CTA that respects the Store commerce path** *(M, gated by the §1-B3 decision)* — calm persistent "N of 14 days" + one "Unlock the full version" button routed to the correct path for the Store build.

### 💡 Design / UX
- Plain-English **error recovery** for every failure (OCR-no-text, locked file, no fields) — a calm message + next action, never a raw `needs_review`/stack trace.
- **Empty states with a job to do** — every empty list (Review, Search, Home) says what to do next + one button.
- **One primary action per screen** — audit for screens with competing equal-weight buttons; the eye should always find the single accent button.
- Collapse the **6-step first-run** so the *required* path feels like ~2 steps (output folder), with theme/performance as "change later."

### 💡 Store-readiness
- **The 5-minute first win is the whole game** — listing screenshots + first run must both deliver import → watch it read → tidy filed file.
- **Screenshot story:** (1) hero before/after messy scan → tidy filename; (2) Review showing green "Ready to file"; (3) the "gets smarter" card; (4) instant search; (5) **"100% offline — nothing leaves your PC"** trust panel. *Privacy is the strongest differentiator vs cloud OCR — lead with it.*
- **Free tier:** keep the 14-day *full* trial (generous; reads well) — avoid a crippled freemium for this audience. Say explicitly that filed documents stay on disk if the trial ends (huge trust signal; no data hostage).
- **Review prompts:** use the Store ratings API only after a positive moment (Nth auto-file / a learning milestone), never on launch or error.
- **Listing copy:** "Offline. Private. Learns your suppliers." — sell tidy filing + never losing a document, not "an extraction pipeline."

### ⚠️ Risks / do NOT
- Don't **headline the LAN client** (certs/firewall/TLS erode "simple + private" — keep it advanced/opt-in; the new setup helper this session is the right shape: hidden until opted into).
- Don't **expose the AI/learning internals** (templates/anchors/registration math) to the buyer — the wow is "it learns."
- Don't add **cloud/sync** — offline-and-private *is* the moat.
- Don't **ship more settings** — new features should add good defaults, not knobs.
- Don't **gate the trial behind a card/account** — you don't today; keep it.

---

## 5. Release-readiness checklist (consolidated)
Ordered by priority for a Store launch:
1. 🔴 **Revert the concurrency cap** in all 3 places (C1) — `processing/handler.js:579,1177` + `settings/renderer.js:293`.
2. 🔴 **MSIX storage relocation** (§1-B1) — move durable state off the package-virtualized AppData or accept trial-reset-on-reinstall.
3. 🟠 **Decide Store commerce vs Polar** (§1-B3) — free-listing + external activation, or Store commerce; never both.
4. 🟠 **Disclose or strip the hidden dev-inspector** (Ctrl+Shift+D+M / `SFDEV`) for the Store build — Store dislikes undocumented functionality.
5. 🟠 **Fix the auto-file ↔ re-surface re-file interaction** (C4) — keep the working copy (or re-file from `stored_path`) so "review the auto-committed docs" can actually re-file.
6. 🟠 **Reset the auto-filed banner counter for watch** (C2).
7. 🟡 Clean up the teach-import temp dir (C3); the reprocess-batch watchdog self-settle (C8); the `inc_ocr_conf` asymmetry (C6); the `review`/`advanced` help-coverage gap.
8. ✅ **Confirm the electron-builder version** (package.json says ^24, CLAUDE.md says v26) before configuring the `appx` target.
9. 🟡 4-part numeric version scheme for MSIX (§1-B4).

### ✅ Release-readiness items that already PASS
- License-compliance build gate: **all 81 bundled components on the approved allowlist** (no GPL/AGPL; commercially safe). `npm run check:licenses` exit 0.
- Full automated test suite green (75 Python + 65 JS + the stress harness).
- The Stage-2 reorder shipped this session is validated by 3 agents + tests + no harness regression.

---

## 6. Security posture (re: the prior `SECURITY_AUDIT.md`)
A detailed audit already exists (`SECURITY_AUDIT.md`, 338 lines) — overall posture rated *"solid engineering with a few real, fixable gaps."* I did **not** re-run a full audit, but I spot-checked **every code-verifiable desktop-side finding, and all four are now resolved** (good progress since the audit):
- ✅ **F-02 (arbitrary file read via the LAN `/v1/documents/:id/pages`)** — **FIXED.** `src/modules/api/handler.js:398-411` resolves the path **server-side from the doc id only**; client-supplied `folderPath`/`filename` are explicitly not read. (Was the top *technical* blocker.)
- ✅ **F-06 (`open-file`/`show-in-explorer` launching arbitrary paths)** — **FIXED.** `processing/handler.js:220-250` now rejects UNC paths + executable types and requires an app-managed root; a blocked path is logged `[security] blocked …`.
- ✅ **F-07 (TLS private keys in the working tree)** — **FIXED.** `Samples/scanfinder-cert/ca.key` is git-ignored.
- ✅ **F-08 (`..`/dot-only segments in the filing path)** — **FIXED.** `filing/handler.js:268+` `sanitiseFolderName` neutralises `..`/`.`, plus a `path.resolve` containment check on `targetDir`.

**Still open + relevant to a Store launch** (per the audit — these are architectural/server-side, not desktop-code):
- **F-01** (client-side licensing is one patchable JS branch) — intersects directly with the **§1-B3 Store-commerce decision**: if the Store SKU uses Microsoft commerce, much of this concern moves to the Store; if it keeps Polar/JWS, the audit's multi-point-enforcement + asar-integrity/fuses + installer-signing recommendations apply. (MSIX/Store signing helps.)
- **F-03 / F-04 / F-05** (licensing-server rate-limiting / enroll-MITM CA-pinning / admin-login lockout) — server-side infra, independent of packaging; worth closing before a public launch that drives trial volume.
- **F-09** (VM clones share MachineGuid) — low/medium, by-design; blend a per-install secret if it matters.
None newly introduced this session.

> Recommendation: before the Store launch, re-walk `SECURITY_AUDIT.md` §8 and re-verify each Tier-1/2 item against current code (two are already done); pair F-01 with the §1-B3 commerce decision.

---

*End of overnight review. The only code changed this session is the search-client setup help file (committed). Everything in §1–§6 is logged for your decision — nothing else was modified.*
