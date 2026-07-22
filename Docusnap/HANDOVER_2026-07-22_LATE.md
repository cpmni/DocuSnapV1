# HANDOVER — 2026-07-22 LATE (Opus 4.8)

**Branch:** `feat/reprocess-throughput-autostraighten`
**Origin at `5db3590`.** HEAD `0849579` — **1 commit ahead, UNPUSHED (`0849579`, P5).** Everything
else this session is pushed. `git rev-list --left-right --count @{u}...HEAD` = `0 1`.
**Uncommitted source:** none. Tree clean except the out-of-repo `../Backup/`.
**Installer:** still `ScanFinder Setup 2.0.0-r20260721-1010-581d626.exe` — predates the whole 07-22
stack → **REBUILD before any live test.**
**Live DB:** migration **52**.

> Supersedes `HANDOVER_2026-07-22.md` (which was written at a battery-death interruption, before the
> tests were run and before P3/P5 were built). That earlier file's facts are still correct for the
> night-run + audit work; this one adds the resumed session.

---

## 1. TL;DR

Resumed after a dead battery at the wrap-up point. Since then, all clean-tree work:

1. **Ran this session's unit tests — all green** (the night-run + audit fixes were previously
   *authored but never executed*). 6 files + the two new ones below.
2. **Corrected a handover error:** P1's ref-prefix detector is **JS-only** by deliberate reggie+Oracle
   decision, NOT "both mirrors" as the first 07-22 handover claimed (`bc677d1`).
3. **Built P3** — the first-run wizard's 12-second self-close (`4e0af32`; eric SIGN-OFF-WITH-CONDITIONS,
   all met). **Pushed.**
4. **Built P5** — alphabetical Template Manager roster (`0849579`). **UNPUSHED.**
5. Reviewed the **security-audit overview** with the owner: 6 of 7 High/Medium findings are now fixed;
   H2 is the one open finding and needs an owner decision.

---

## 2. This session's commits (all on top of the night-run + audit stack)

| Commit | What | Pushed? |
|---|---|---|
| `0849579` | **P5** — Template Manager roster alphabetical (see §3) | **NO** |
| `5db3590` | docs: mark P3 built (CLAUDE.md + design doc) | yes |
| `4e0af32` | **P3** — stop the wizard destroying itself after 12s (see §3) | yes |
| `bc677d1` | docs: correct P1 scope to JS-only (see §1.2) | yes |
| `5d93f4e` | docs: `HANDOVER_2026-07-22.md` + CLAUDE.md session-state refresh | yes |

The 11 commits below `5d93f4e` (`f6d85b5`→`90ecaf7`) are the night run + security audit — documented in
`HANDOVER_2026-07-22.md` and unchanged.

---

## 3. Built this session — detail

### P3 — wizard 12-second self-close (`4e0af32`, PUSHED)
**Root cause:** `openMainShell` armed an uncancelled `setTimeout(teardown, 12000)` whose `teardown`
resolved `windows['onboarding']` **by name at fire time**. On a "Re-run setup", `createWindow('main')`
takes its reuse branch (main already painted, no re-`loadFile`), so `ready-to-show` never re-fires and
the 12s timer becomes the ONLY teardown — destroying whatever wizard occupied the slot 12s later,
mid-interaction. A no-user-action variant: reopen the wizard within 12s of a previous finish and the
still-armed earlier timer kills the brand-new window.
**Fix (kill switch `WIZARD_TEARDOWN_FIX=0` = exact legacy path):** new `src/lib/coverTeardown.js` —
`closeCoverWindows` (identity-scoped: captures the actual login/license/onboarding *instances* and
closes only those) + `scheduleCoverTeardown` (pure/injectable arm-cancel: reuse ⇒ tear down NOW; fresh ⇒
on `ready-to-show` with a stored, cleared 12s backstop). `openMainShell` now calls it.
**Files:** `src/main.js`, `src/lib/coverTeardown.js`, `src/lib/test_coverteardown.js`.
**Tests:** `test_coverteardown.js` **19/19** — identity-scoping invariant + every timer path (reuse,
fresh→ready-to-show, closed-before-paint, wedged-renderer, destroyed-main). `main.js` parses.
**Advisor:** eric (Electron) **SIGN OFF WITH CONDITIONS** — all three met (reuse-invariant documented,
timer-wiring test added, `closed` closure dropped once `ready-to-show` wins). He verified no blank-swap
regression and no cross-instance delete hazard.
**Scope note:** does NOT fix the separate "Re-run reopens a *stale wizard on its old step*" bug (still
open — that's the reuse-without-`loadFile` seam, `main.js` createWindow reuse branch).
**⚠ Corpus gate is BLIND here.** Live confirmation needs an owner FULL app restart (§5).

### P5 — Template Manager alphabetical (`0849579`, UNPUSHED)
Roster (`get-templates`) now sorted **alphabetically by name** — the owner's ask. Done in the
viewer-only wrapper `templates.getAllWithLiveCounts` (**verified** sole non-test caller = the
`get-templates` IPC). The **matcher-facing** `templates.getAll` (whose count-desc SQL order feeds the
sibling tiebreaks + the order templates reach the matcher) is left **byte-identical**. The settings
renderer preserves received order, so grouped + ungrouped rows are alphabetical now (groups were
already A→Z). Also makes Review's "link to existing template" picker alphabetical (harmless/better).
**Kill switch `TEMPLATE_VIEWER_ALPHA=0`** restores count-desc.
**Files:** `database/modules/templates.js`, `database/modules/test_template_confirmed_count.js` (+ the
CLAUDE.md/design-doc tracking).
**Tests:** `test_template_confirmed_count.js` **ALL PASS** — reworked with divergent names (Zephyr=3
docs vs Acme=1) so it genuinely pins viewer=alpha, `getAll`=count-desc, and the kill switch. Replaced a
prior order assertion that would have passed by *coincidence* under alphabetical (a dead guard).
Built without a separate Oracle round (display-only, provably-isolated wrapper, matcher order pinned) —
offer Oracle if the owner wants the formal gate.

---

## 4. Verification state — be honest

**What ran this session (all green):**
- P1: `test_repair_suspects.js` (JS) + `test_format_shape_consistency.py` (Py §8 invariant).
- Audit: `test_secretstore.js` (12/0), `test_certservice.js` (28/0), `test_navguard.js` (10/0),
  `test_backupservice.js` (incl. M5 cases).
- P3: `test_coverteardown.js` (19/0). P5: `test_template_confirmed_count.js` (all pass).
- `main.js` parses (`node --check`).

**What did NOT run — assume nothing:**
- **No corpus/realdoc regression** this session. It is structurally BLIND to renderer/main-lifecycle
  (P3), storage/DB-display (P5), and the audit's Electron/IPC fixes — so a green run would prove nothing
  about them; that's why it wasn't run. It would only exercise the P1 Python invariant, which
  `test_format_shape_consistency.py` already covers.
- **No automated coverage** for audit M1 (secure_delete), M2/M3, or the M4 CSP sweep — code-review only.
- **Nothing owner-tested live** yet: P3 (needs restart), P5 (needs the app open), and the earlier teach/
  onboarding UI batch (`f9bc202`/`1618f77`/`f6d85b5`).

**Known pre-existing five-failure test set (NOT ours — do not "fix"):** `test_anchor_crop_crosscheck`(3),
`test_late_anchor_rescue`(7), `test_template_rescue`(1), `test_field_data_types`(silent),
`test_identity_fusion`(known).

---

## 5. FIRST ACTIONS for the fresh session

1. **Push `0849579` (P5)** — the only unpushed commit (owner call).
2. **H2 decision (owner)** — the one open audit High. Path A (interim lockdown) vs Path B (full pairing
   code). Design in `docs/designs/AUDIT_H2_PAIRING_2026-07-21.md`. No live exposure today (add-on off).
3. **Owner live checks** (need a FULL app restart — renderer/main edits don't hot-reload):
   - P3: Settings → Advanced → Re-run setup → Skip. Predicted: closes **immediately** now (not ~12s
     later). eric's discriminator: if it still lingers, the fix didn't take.
   - P5: open Settings → Templates — roster should be A→Z.
   - The teach batch: does a drawn box read `SO-51261` correctly; does teaching the Document Issuer
     complete without asking for a label.
4. **Rebuild the installer** before any live test (predates the whole 07-22 stack).
5. **If building continues:** P2 (Option A), then P4 — both designed, see §6.

---

## 6. Deferred (designed / diagnosed, not built)

- **H2 — LAN pairing TOFU** (HIGH, owner decision). `docs/designs/AUDIT_H2_PAIRING_2026-07-21.md`.
- **P2 — duplicate date fields** (DIAGNOSED). `docs/designs/P2_DUPLICATE_DATE_FIELDS_2026-07-21.md`.
  Fault(b) root cause = generic Stage-1 date patterns all carry a bare `"Date"` label → a delivery
  docket's `Date:` fills invoice/order/po_date alike. **Option A** (persist/learn only the type's own
  fields, storage/confirm seam) recommended; corpus gate is blind → needs a JS/DB test. 20/81 delivery
  notes affected. Owner + Oracle choose the fix layer before building.
- **P4 — field order unstable across docs** (DESIGNED). `docs/designs/NIGHTRUN_P3_P5_2026-07-21.md`.
  Order by `fields.sort_order` at the shared seam. ⚠ **Check the `/v1` DTO contract** before changing
  client-visible ordering. Drag-to-reorder editor is a *second* slice.

**Security-audit remainder (owner/ops, not autonomous):** code-sign installer/app (OV/EV cert
~£200–400/yr; also clears SmartScreen + raises licence-tamper bar) · deploy the PHP hardening batch
(SEC-01/02/06/13/14/15, already code-complete) to IONOS + run V1–V8 gates · ~80 Low/Info hardening
(TOTP-secret-at-rest, log hygiene, OCR temp-file sweep, `set-setting` key denylist, retire `SFDEV`
console in packaged builds, bump Electron off EOL v31). **Accepted risk (don't chase):** offline licence
enforcement is bypassable by the machine owner; app-level DB encryption can't defeat malware-as-user
(**BitLocker** is the right control for disk-theft — don't claim "the DB is encrypted" while inbox/
output/temp/logs stay plaintext). Full detail: `SECURITY_AUDIT_2026-07-21.md` (gitignored).

**Do not start without owner input:** `LETTERHEAD_ISSUER` flip, per-template field hiding,
keyword-per-field UI, first-run output-folder-not-copying-on-another-PC (needs a 2-PC repro), po_date
corroboration, worksheet line-merge mode-3, buyer-issued Supplier→issuer trace, workflow slices 5/6.

---

## 7. Key facts & paths
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db` (ScanFinder, not DocuSnap), **mig 52**. Read-only:
  Electron-as-Node + `new Database(path,{readonly:true,fileMustExist:true})`.
- **Origin:** `5db3590`; **1 commit ahead** (`0849579`, P5). Everything else pushed.
- **Run JS tests:** `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>` (native-module ABI).
  Python (dev): `py -3.12 <file>`. Corpus gate: `stress_test/realdoc_regression.js` (`GATE=1`, READ the
  report file) — blind to renderer/main/DB-display changes. Template gate: `template_gate_probe.py`.
- **Kill switches added this session:** `WIZARD_TEARDOWN_FIX` (P3), `TEMPLATE_VIEWER_ALPHA` (P5) — both
  default ON; `=0` restores legacy.
- **Dev log:** `<repo>/processing.log`. Close the dev app before `npm run build` (EPERM). Some
  electron/node processes were alive on the machine — confirm the dev app is closed first.
- **Do not confirm** the 12 `needs_review` label-garble docs; doc #190 is poisoned GT.
- Advisors registered: `gary`/`oracle`/`barry-the-brainstormer`/`eric`/`oscar`/`reggie`. `007` is NOT —
  spawn general-purpose with the persona from `.claude/agents/007.md`.
- Prior handovers, newest first: `HANDOVER_2026-07-22.md`, `HANDOVER_2026-07-21_LATE.md`,
  `HANDOVER_2026-07-21.md`, `HANDOVER_2026-07-20_LATE.md`.
