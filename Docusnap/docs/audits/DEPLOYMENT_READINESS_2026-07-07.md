# Scan Finder — Deployment-Readiness Report
**Prepared overnight, 2026-07-07 · branch `feat/tray-stage1` (all work committed + pushed to origin)**

> Bottom line: the **core extraction/filing engine is in genuinely good shape** and, on the evidence, is close to shippable. What stands between you and a release is a **short list of non-engineering blockers** (business identity placeholder, a draft EULA, an unsigned installer) plus a **handful of client-app polish fixes** — none of them large. This report is where we are, what's blocking a ship, and a concrete path to get there. **No unrequested code changes were made** — everything below the "What changed tonight" section is a recommendation for your approval.

---

## 1. TL;DR

- **Done + pushed tonight:** removed the dormant AI/LLM (Ollama/phi3) path entirely; removed RapidOCR entirely (Tesseract-only OCR); made the text-led **supplier-identity conflict flag live** (default on, validated 99.4% precision / 0 false-alarms on your 166 real docs); rewrote the in-app **help guide** (exhaustive keyboard shortcuts + gestures, new shortcuts page); refreshed the **developer manual** and wrote a new **plain-English manual**; fixed the test harnesses broken by the arg removal.
- **Readiness verdict:** **Core app — ship-ready pending the blockers in §6.** **Client app — ship-ready pending ~5 small fixes in §5.**
- **The three things you must decide/do before a public release:** (1) replace the `SOFTWARE COMPANY` placeholder identity, (2) get `LEGAL.txt` off "working draft", (3) decide on code-signing the installer (SmartScreen). Everything else is polish.

---

## 2. What changed tonight (committed + pushed)

| Commit | Change |
|---|---|
| `09e3f83` | **Identity-conflict flag → live** (default ON; disable via `identity_conflict_flag='false'`). Flag-only: a doc whose letterhead names a *different* known supplier than the pipeline detected goes to Review with a note — never overrides/fills. Validated 99.4% precision / **0 false-alarms** on 166 real confirmed docs. |
| `cf639a4` | **RapidOCR removed** (Slice 2) — full-page OCR is Tesseract only; engine class + Settings toggle + `--ocr-*` plumbing + `requirements-ocr.txt` + the prebuild guard + `OCR_RUNTIME.md` + compliance entries all gone. Extraction byte-identical. Test harnesses updated. |
| `d01a531` (earlier) | **AI/LLM (Ollama/phi3, the `'ai'` mode) removed** entirely — `llm.py` deleted, engine/handler/process_docs stripped, stale `BUILD1.txt` deleted. Extraction byte-identical. Modes are now **Fast + Smart**. |
| `d186f2d` (earlier) | Ollama/AI references purged from BUILD.txt + config + `.gitignore` (blanket-ignore `vendor/`, shut out the 307 MB `sandbox/`). |
| `3e6977c` | **Help guide rewrite** — new `shortcuts.html` (full keyboard + gesture cheat-sheet), in-context callouts in Review/Search, wired into nav + search. |
| `ac2aafe` | **Dev manuals** — `DEVELOPER_MANUAL.md` currency pass + new plain-English `DEVELOPER_MANUAL_PLAIN.md`. |
| `a1f7d61` (earlier) | Identity measurement harnesses committed. |

**Byte-identical extraction** was verified after both the AI and RapidOCR removals (real-doc smokes: born-digital fields + scanned OCR both extract normally).

---

## 3. Regression / accuracy

**No regression from the AI + RapidOCR removals — extraction is fully intact.** Full suite ran clean (stress 400 text+scanned, live-DB 166 real docs, adversarial harness 200; all exit 0):

**Stress corpus (400 docs, after 2 teach cycles):**
- Type detection **98.0%** (392/400); all-fields-and-type-correct **90.0%** (360/400).
- `total_amount` **100%** (400/400) · `invoice_number` 99.3% (133/134) · `supplier_name` 93.0% after teach (**0 wrong / 0 silent**) · one *pre-existing* OCR slip on `sales_order_number` ('SO-30247'→'8030247', not a regression).
- **identity_fusion shadow: 400/400 verdicts, RIGHT 400 / silent-wrong 0 (100% precision), 0 conflicts, 0 false-alarms.**

**Live-DB (your 166 real confirmed docs):** fresh pipeline supplier 99.4%; text-led **99.4% precision (RIGHT 160 / silent-wrong 1), 0 false-alarms** — *identical to the pre-removal measurement*, confirming the now-live conflict flag is safe on real data. (The lone "silent-wrong" is doc #45, whose letterhead reads 'Contoso Asia' but is filed under 'Anconia Corp' — a business/mis-file mapping; it *agrees* with the pipeline, so it never flags.)

**Verdict: both removals are byte-identical to extraction, and the identity flag holds its validated precision. Safe to ship on the accuracy evidence.** (`test_identity_fusion` 10/10, `test_ocr_engine` seam checks, `check-licenses` gate all pass.)

---

## 4. Core app — interface, roles, first-time-user UX

### 4a. Role-based access (admin / edit / read-only)

**Strong.** A full audit of all **225 IPC handlers** confirms the app honours its stated principle — *"the IPC is the real enforcement boundary; UI hiding is a nicety."* User-management, settings, templates, filing, watch, and client-API handlers are uniformly admin-gated; Review's edit-vs-admin split (daily workflow for edit; permanent purge + bulk-delete for admin only) is coherent and enforced on both layers; Search's role mirroring is exemplary; a read-only user **cannot reach anything mutating** (verified end-to-end). Findings, ranked:

1. **[Should fix — UX, not security] A read-only user's Import screen is a silent dead control.** `#btn-import` isn't hidden for read-only (unlike Review/Teach), and `chooseSourceFolder()` has no try/catch — so a read-only user can open Import, click "choose a folder", and the admin-gated `pick-folder` IPC rejects them with *nothing visible happening*. No privilege leak (the IPC correctly denies), just confusing. Fix: hide `#btn-import` for read-only (one line, mirroring `btn-review`/`btn-teach`) ± a try/catch message. **The only user-visible role issue found.**
2. **[Should fix — defense-in-depth] Licensing IPCs break the app's own gating pattern.** `license-activate` / `-revoke` / `-test-activate` (mutating) + the status/diagnostics reads have **no role/login gate** (only `license-set-enforcement` checks admin inline). Real abuse needs devtools + a valid account key, but it's the one module not following "IPC is the boundary" and it leaks license state to any window. Fix: `requireRole('admin')` on the five admin handlers.
3. **[Should fix — defense-in-depth] Hidden dev-inspector data IPCs bypass their own password.** `dev-get-session-docs` is populated on every import and returns per-doc metadata (incl. in-review docs a read-only user is otherwise denied) with no auth check — reachable only via devtools, and the *window* is disabled when packaged, but the data IPCs themselves aren't gated. Fix: `requireLogin()` (or the inspector-active flag) on the four dev IPCs.
4. **[Polish + hygiene] Teach's "create a new type" is offered to edit users but is admin-only at the IPC** — the error only surfaces after the whole form is filled (Review hides the equivalent up-front). Plus a few ungated reads (`get-setting`, `get-stuck-docs`) worth a `requireLogin()` for consistency.

None of 2–4 is a live exploit (all need devtools JS execution); #1 is the only user-visible issue. This is a **solid role model** — the fixes are hardening + one UX tidy, not a redesign.

### 4b. First-time-user experience (assessment)

The onboarding path is unusually complete for a product at this stage:
- **First-run wizard** (output folder + basics) → **6-card welcome tour** → optional **sandboxed practice run** (tutorial over bundled watermarked samples, no real DB/output touched). This is a strong, low-risk first-run funnel.
- **Three role-framed teaching surfaces** (Fix-a-field ⊕ · Teach-a-document wizard · Fine-tune-a-layout Template Wizard) with a "Which should I use?" help section — good, but three overlapping ways to teach is the single most likely point of first-timer confusion; worth watching in real user testing.
- **Help-mode** (`?` then click any control) + a themed User Guide window (now with the exhaustive shortcuts page) is a genuine strength.
- **Attention-led dashboard** (needs-your-attention, filed-pulse, getting-smarter) is a good "what do I do now" home.

### 4c. Known interface follow-ups (found tonight)
- **"Reorder fields" is advertised but not implemented.** The doc-type editor help text (`settings/renderer.js`) implies fields can be reordered, but there is **no reorder handler** in the code. Either build the gesture or drop the claim. *(Help HTML already corrected tonight; the in-Settings help-text still overstates it.)*
- **Fast vs Smart is now vestigial.** Post-AI-removal the two modes are byte-identical (keyword+anchor). See §7 for the recommended collapse.

---

## 5. Detached Search Client — readiness

The client is **architecturally sound and mostly done** (clean TLS/CA-pinning, `contextIsolation`+`sandbox`, real CSP, consistent 401 sign-out, entitlement gating cleanly *hidden* not broken, working About/version/licenses, coexists with the core installer via distinct appIds). Version 1.0.2 vs core 2.0.0; `/v1` contract 1.1.0 both sides. Fixes before shipping the client, ranked:

1. **Review queue hides the confidence/validation signal it exists to show.** `client/renderer/renderer.js` `renderReviewFields()` renders only label+input; the same `doc.extractions` payload carries `confidence` + `validation_note` (Search preview already shows them, and the `.fwarn` CSS is defined-but-dead). A remote reviewer currently can't see *which field* triggered review or *why*. **Highest-impact, cheapest fix.**
2. **Silent failure on a network hiccup right after login.** `apiClient.login()` + the `client-login`/`client-entitlement` main handlers + the renderer login handler lack the try/catch that `client-set-server` and change-password already use → an unhandled rejection leaves the Sign-in button doing nothing with no message.
3. **`/v1/enroll` is dead from the UI.** A real, tested one-step pairing flow (`apiClient.enroll()`) has no `ipcMain` handler / preload / renderer entry point. Either wire it (one-click pairing) or remove it so it doesn't read as shippable.
4. **MFA/TOTP has no enrollment UI anywhere in the product.** Login supports a TOTP code, but nothing in any renderer can *turn MFA on* for an account (DB hand-edit only). Don't represent MFA as an available feature until there's an enrollment path.
5. **No Terms/Legal surfacing in the client.** A LAN user who only ever receives the client installer never sees/accepts anything (core's NSIS `LEGAL.txt` gate has no client equivalent). A business/legal decision, not just code.

*(Full detail with file:line for each is in the client-review notes; I can turn any of these into a fix on your say-so.)*

---

## 6. Shippability blockers (ranked, must-decide-before-release)

1. **Business-identity placeholder ships to the About box.** Both `package.json` files carry `"author": "SOFTWARE COMPANY"` + `"copyright": "Copyright © 2026 SOFTWARE COMPANY"` (core `:5,:17`; client `:6,:15`). The About box shows this verbatim. Per CLAUDE.md it must be **"Six Mile Software"** (and must never surface the proprietor's personal name). **Trivial fix, hard blocker.**
2. **EULA is a working draft.** `LEGAL.txt` header: *"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE."* Needs solicitor sign-off (the outstanding items noted in CLAUDE.md) before you can ship the acceptance gate as binding.
3. **Installer is unsigned** → Windows SmartScreen "More info → Run anyway" on first run (and contributes to the slow-first-launch Defender scan your friend hit). Decide: buy a code-signing cert (removes the friction) or ship unsigned with clear install instructions. This is the single biggest *perceived-trust* gap for a paying customer.
4. **Client polish (§5 items 1–2)** — the Review-confidence gap and the silent-login-failure are the two client fixes I'd treat as release-blocking for the add-on.

Everything else (MFA enrollment, `/v1/enroll`, client Legal gate, Fast/Smart collapse) is **should-do, not must-do**.

---

## 7. Doing it better / recommendations

- **Collapse Fast/Smart to one mode.** They're now identical. Remove the mode choice + the now-nonsensical "Switch to Fast Mode?" suggestion toast; default internally to one mode; keep the backend tolerant of stored `fast`/`smart`. Small, user-facing clarity win. *(Not done tonight — it's an interface change I didn't want to make unsupervised the same night as the interface review; ready to apply on your OK.)*
- **First-launch polish** (already scoped): a dashboard "Loading…" skeleton, defer the startup sweeps (`sweepInboxOrphans` + audit maintenance) to `setImmediate`, and — most impactfully — **code-sign the installer** to kill the SmartScreen + slow-first-launch experience.
- **Finish the identity flag for shipped builds:** on the build machine, `pip install rapidfuzz` into `vendor/python` (already in BUILD.txt) + regenerate `THIRD-PARTY-LICENSES.txt`. Until then the flag is inert-safe (guarded import) in packaged builds but won't actually run.
- **Dev-manual §4/§10 refresh** (deferred): the technical manual's UI sections predate the dashboard/nav-rail/themes/preset-catalog/graduation work; §22 now points to CLAUDE.md as authoritative, but a fuller pass is open.
- **Stage 7 Stage 3** (backlog): persistent learned format model (`field_format_rules`, migration 12) — the last unbuilt format-learning piece.

---

## 8. Proposed path to shippable

**Release-blocking (do first):**
1. Replace `SOFTWARE COMPANY` → `Six Mile Software` in both `package.json` files (author + copyright). *(2-minute fix; I can do it on your OK.)*
2. Get `LEGAL.txt` reviewed + off "working draft" (solicitor item — external dependency).
3. Decide on code-signing; if yes, procure a cert and wire `win.sign`.
4. Client: surface Review confidence/notes (§5.1) + wrap login in try/catch (§5.2).
5. Build-machine: `pip install rapidfuzz` into `vendor/python` + regen notices; `pip uninstall` the RapidOCR stack to shed ~80–180 MB.

**Should-do (fast follow):**
6. Collapse Fast/Smart (§7). 7. First-launch polish (§7). 8. Fix/remove the "reorder fields" claim. 9. Decide MFA-enrollment + `/v1/enroll` + client Legal (§5.3–5.5).

**Then:** bump versions, `git tag`, `BUILD_REV=<ver> npm run build` for core + `cd client && npm run dist`, smoke-test both installers on a clean VM.

---

*Appendix — this branch is **17+ commits ahead of `main`**; everything is pushed to `origin/feat/tray-stage1` (backed up) but **not yet merged to `main`**. Merge via PR when you're ready.*
