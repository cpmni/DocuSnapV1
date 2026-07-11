# Handover — 2026-07-10 daytime session (continues HANDOVER_2026-07-10.md)

**Branch:** `feat/doctype-title-aliases`  ·  **Baseline before this session:** `a873c4e`  ·  **HEAD:** `76a7bd0`
Everything below is COMMITTED. No uncommitted source. Two verification runs + one advisor pass are
IN FLIGHT (see §4). The user switched to a fresh session mid-verification.

---

## 1. TL;DR

Overnight (separate handover `HANDOVER_2026-07-10.md`) shipped 4 doctype/reprocess/identity fixes.
This daytime session shipped **7 more commits** addressing live problems the user hit while testing
with fresh suppliers (Bramble & Finch, Blackstone Logistics), plus a **systemic keyboard-focus cure**.
All have unit tests + (where applicable) real-doc E2E. The combined-morning **corpus A/B is running**
against a FROZEN snapshot; the **Oracle final-diff pass has NOT been run yet**; **no installer built yet.**

Every design went through the advisors (gary/reggie/eric/Oracle) exactly as the overnight work did.

---

## 2. What shipped this session (commits, newest first)

| Commit | What | Verified |
|---|---|---|
| `76a7bd0` | **SYSTEMIC focus cure** — heal the render-widget keyboard-focus desync at the universal pointerdown chokepoint (not per-trigger). | unit pins; **NEEDS USER RESTART + repro** |
| `fc1fb6e` | **Supplier "Ref" fix** — bare "Supplier"/"Vendor"/"Seller" label no longer reads "Supplier Ref/No/Account/#" as the issuer (reggie; mirrors `_total_role_collision`). | unit + real-doc E2E (BF_pur_42 → "Bramble & Finch Ltd" @96 logo) |
| `4a60984` | **Draw-target dead caret** (per-site draw fix; now belt-and-braces under the systemic cure). | unit pins |
| `b9a7dc0` | identity-rescue Oracle ratification riders (resolved-scope arg floor pin). | unit |
| `f42829f` | **Identity rescue slice 1** — a corroborated learned issuer (structural logo/template + confirmed hint) replaces quality-failed junk on customer_name-identity types, ALWAYS review-flagged. | 37 unit + real-doc E2E (BF_sal_20 "SO #" → "Bramble & Finch Ltd" @69 + note) |
| `5315737` | **getAllHints** — training saw only the top 100 hints (LIMIT-100 default) → new suppliers' usage-1/2 hints invisible. Now uncapped. | unit + it's what unblocked the rescue E2E |
| `5c73045` | **Position-only issuer teach** — never save the field DISPLAY name ("Document Issuer") as a phantom anchor label (the "my teach never sticks" loop). | unit (JS + Python) |
| `2676824` | test: CRLF fix on a focus pin that was red-at-commit. | — |
| `8365769` | Confirm-path focus fix (arm suspect; now belt under the systemic cure). | unit |
| `4d1de54` | **Confirm-upsert** — a value TYPED into a field the engine never read now persists as a `manual` extraction row, so it feeds learning/search/reopen ("worksheets no longer learning values"). | 12 unit incl. reader-visibility |

## 3. The problems these solved (for context)

- **"Keeps applying Sales Order on reprocess"** (overnight) → reprocess type-authority (`041f2c4`/`f684c17`).
- **"Customer name in the Document Issuer"** on sales orders → recipient-caption guard (overnight `c17b66f`) + identity rescue (`f42829f`).
- **"Worksheets no longer learning values"** → confirm-upsert (`4d1de54`) + getAllHints (`5315737`). Root: typed-into-empty values lived only in `corrections`; every learning reader selects FROM `extractions`.
- **"Issuer says SO #"** (doc 1878) → identity rescue: logo(85) + hint(×2) now WIN over the junk keyword read.
- **"Supplier says Ref"** (doc BF_pur_42) → reggie's label guard: "Supplier Ref" is a buyer-side reference caption, not the issuer. After the fix the LOGO wins directly (@96) — Fix B (supplier-side rescue) proved UNNECESSARY, not built.
- **Focus dead-caret across Confirm / draw / Learning-History** → ONE desync (telemetry `pageHasFocus=false winFocused=true wcFocused=true` identical across triggers) → systemic cure (`76a7bd0`).

## 4. IN FLIGHT — pick up here

1. **Corpus A/B (frozen, same 2017-doc snapshot)** — the honest verification. The live corpus grew
   1760→2017 while working (user actively confirming), so a live A/B is contaminated; I froze a DB
   snapshot and run BOTH old + new code against it:
   - Snapshot: `C:\Users\cmccu\AppData\Local\Temp\sf-frozen\ScanFinder\docusnap.db` (2017 confirmed).
   - Old code (pre-morning `63b0cdb`) runs from a worktree: `C:\Users\cmccu\AppData\Local\Temp\sf-baseline-wt\Docusnap` (node_modules is a JUNCTION to the repo's). Output → `sf-frozen\baseline_frozen.md`.
   - New code (HEAD) → `sf-frozen\final_frozen.md`.
   - Both launched via `APPDATA=C:\...\sf-frozen ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`.
   - **When both finish: `diff baseline_frozen.md final_frozen.md`.** GATE (Oracle C4): every value diff
     must be attributable to (a) supplier-"Ref"→correct gains, (b) identity-rescue gains, (c) hint-visibility
     changes; **M (would-auto-file-a-WRONG-value) must be 0**; no per-field accuracy drop.
   - Safety already confirmed on the earlier live 2014-doc baseline: **M=0**.
2. **Oracle final-diff pass** — NOT DONE. After the A/B is clean, put the full session diff
   (`git diff a873c4e..HEAD`) to the Oracle for the final adversarial read, exactly as done overnight
   (that pass caught a broken pre-existing suite — do it).
3. **Build** — only after 1 + 2. `npm run build` (close the dev app first — EPERM on better_sqlite3.node).
   Prior good installer: `dist\ScanFinder Setup 2.0.0-r20260709-2256-63b0cdb.exe` (overnight; lacks all daytime work).

## 5. Needs the USER

- **RESTART `npm start`** to load ALL of today's work — the running session had NONE of it (telemetry showed
  no `[focus] after:` lines). Then **try to break the focus fix**: Confirm & File, draw a ⊕ target, open
  Learning History, then click a text field each time. If a caret is ever still dead, the dev terminal now
  prints `[focus] after: active=… hasFocusNow=… activeStillEl=…` — that line tells eric exactly which
  residual it is (active=BODY vs hasFocusNow=false). **If keyboard-Tab (no mouse) ever dead-carets**, that's
  the one uncovered case → add a guarded `focusin` secondary (eric's design, additive).
- After restart + a **reprocess** of the Bramble/Blackstone batches: the supplier "Ref" grouping should
  collapse back to real supplier names; worksheets should learn typed values.
- **Doc 1778 (AW_pur_08)** still outstanding from overnight: Learning Repair → send back → **set type to
  Purchase Order BEFORE Confirm** (else it recreates deleted learning poison).

## 6. Open items / caveats / ideas discussed

- **Supplier gazetteer validation idea** (user's, this session): validate a supplier read against known
  supplier names and DISCARD-if-spurious → next method; logo-gate a taught region. VERDICT given: most is
  redundant (logo already maps to the name directly; taught region = field anchors + registration). The one
  valuable NEW part = **promote the dormant `identity_fusion` gazetteer check from shadow to actively
  discard spurious reads** — but it can false-reject BRAND-NEW suppliers, so it must DISCARD only on
  CONFLICT (logo says X, text says clearly-different Y) and KEEP+FLAG the merely-unknown. NOT built; deferred
  to a gary→Oracle slice IF real docs show it's needed (park-and-see was the leaning, since Fix A already
  made the logo win).
- **identity rescue is customer_name-identity ONLY** (slice 1). supplier_name-identity types (POs) are NOT
  covered — but Fix A (`fc1fb6e`) solved the actual PO case via the logo, so the supplier-side rescue is not
  currently needed. Slice 2 (graduate a rescue past review at higher hint usage) is DESIGNED but explicitly
  NOT signed by the Oracle — its own review required.
- **Pre-existing test failures (NOT regressions, verified):** `python_backend/tests/test_authoritative_anchor.py`
  has 2 stale failures (still asserts the OLD cross-supplier anchor sweep that the 2026-07-09 supplier-scoped
  change replaced). Confirmed failing before this session's changes. Update or delete the stale assertions.
- **CLAUDE.md stale claims** (flagged overnight, still worth a docs pass): saveAnchor's authoritative sweep is
  now supplier-scoped; the "daytime cause fix not done" note is done. Now ALSO add the daytime mechanisms
  (this session updated the relevant CLAUDE.md sections — see the extraction/review/UI notes).
- **Focus fix residual (eric's honest caveat):** the invoke reply and the SetPageFocus messages ride
  different mojo pipes, so correctness rests PRIMARILY on the pre-edge sync `el.focus()` (step A), not on
  invoke ordering. A future refactor that drops step (A) reintroduces the race — the test pins guard it.

## 7. Key facts for the fresh session

- **Live DB:** `%APPDATA%\Roaming\ScanFinder\docusnap.db` (~2017+ confirmed; user still adding). Read-only
  via `sqlite3.connect('file:...?mode=ro', uri=True)` for diagnostics.
- **DB backups this session:** `%APPDATA%\ScanFinder\db_backups\` — `…pre-overnight.bak`, `…pre-template-fix.bak`.
- **Frozen A/B snapshot + worktree:** see §4. `git worktree remove --force C:\Users\cmccu\AppData\Local\Temp\sf-baseline-wt` to clean up after the A/B (and delete `sf-frozen`).
- **Harness:** `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js` (M=0 gate = 0 would-auto-file-wrong; ~35 min on 2017 docs).
- **Tests:** Python `py -3.12 tests/<t>.py` from `python_backend/`; JS `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>` (or plain `node` for pure-logic ones like the focus suite). New this session: `test_identity_rescue.py`, `test_getallhints.js`, `test_anchor_phantom_display_label.js`; extended `test_save_corrections.js`, `test_keyword_label_guard.py` (§1e), `test_identity_anchor_scope.py`, `test_focus_repair.js`.
- **Advisor subagent types available:** oracle, gary, eric, oscar, reggie, bob (all real subagent_types this session).
- **Revert any slice:** `git revert <sha>`; the identity rescue has kill-switch `IDENTITY_RESCUE_ENABLED` in engine.py.
