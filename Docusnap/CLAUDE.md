# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

---


## Extended reference (read the relevant doc on demand)
This file is the lean index. Deep detail lives in `docs/` and is loaded ONLY when a task
touches that area — read the pointed-to doc BEFORE working in it:
- `docs/extraction-pipeline.md` — full Stage 0–4.6 internals, drift/registration/label-lock/
  slip-fix/multiline design, OCR recipes, performance + confidence calibration. **Read before
  ANY extraction/anchoring/OCR/validation change.**
- `docs/licensing.md` — license gate internals, offline token verify, PHP backend, admin 2FA, Legal/Terms gate.
- `docs/detached-client.md` — the `/v1` TLS API, cert wizard, entitlement/workflow gates, presence, harnesses.
- `docs/features.md` — first-run wizard, welcome tour, settings backup, Learning Repair, teaching wizard, dev inspector.
- `docs/history.md` — resolved QA/audit findings + build-stage history (Settings/Review/Search/Stage-7 rebuilds).
- `docs/session-log.md` — VERBATIM ARCHIVE of the old per-session change blocks (2026-07-09 → 07-28).
  Grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent session built.
- `docs/architecture-notes.md` — the long per-file design notes moved out of the directory map (marked
  ➜AN there). Read the matching block before changing one of those files.

## Current session state (2026-07-29) — long day: fixes + born-digital test rig + reggie fix — ALL PUSHED
**2026-07-29 (Opus 4.8). ALL PUSHED through `3705296` (HEAD; origin `0 0`, tree clean).** THREE phases:
(A) morning "run of fixes" (below), (B) an 800-doc BORN-DIGITAL test batch + a cold/warm SCORER, (C) a
reggie ISO-date/ref-label fix — B+C detailed in the AFTERNOON block after the veto section. Installer
**`dist\ScanFinder Setup 2.0.0-r20260729-0905-3351e2f.exe`** (VETO ON) **PREDATES the reggie config fix
`42a9334` — REBUILD to carry it.** The `-0812-41f1916` build (veto DARK) is superseded.
**Morning "run of fixes":** Committed + pushed the 07-28 uncommitted batch (DPI/forget/focus/overlay) + 3
owner-requested builds.
**Batch committed (07-28 work, now pushed):** `1e0a896` configurable OCR render DPI (`ocr_dpi` 150/200/300,
default 300 = byte-identical; owner LIVE-CONFIRMED 150 FASTER) · `a0ca71d` OCR-DPI selector + native-dialog focus
repair · `91ef6a7` case-insensitive Forget (`COLLATE NOCASE`) · `d04339a` stale anchor-overlay clear + clearer
position-anchor copy · `3a578f4` CLAUDE.md.
**Built THIS session (3 fixes):**
· `aebbd79` **import-view counts** (`main/renderer.js`, renderer-only) — folder preview re-scans at run end
(originals drained to Processed/); session "Found" counts per `file_done`, not the up-front folder total. Fixes
"still says 900 on stop".
· `958229c` **S1 band-graduate — DARK** (kill `TEMPLATE_IDENTITY_BAND_GRADUATE` default OFF) — sheds the
MAJORITY-tier template-identity issuer note → `{V,85,template_identity_corroborated}` when V is STRICTLY
corroborated in the ISSUER BAND (Profile-Construction class: name printed under BILL FROM, fill+note wins the
read). gary→Oracle C1 (strict ALL-tokens, not the FILL's ≥60%) + C2 (band-gated, never raw `[:600]`) + C3
(excluded from `_IDENTITY_STRUCTURAL_METHODS`). Pure static `_should_shed_template_identity_note`; pins
`test_template_identity_band_graduate.py` (20 green). **Corpus fired 0× (vacuous). FIRING TEST DONE (real docs
897/905/963/981/1128): S1 is INERT on its target — DO NOT FLIP.** The Profile docs are TWO-COLUMN born-digital
(`BILL FROM   BILL TO` one line, `Profile Construction   ACME Inc` the next); `_issuer_hint_band` truncates at
the "BILL TO" recipient marker which precedes the issuer name → band `"INVOICE BILL FROM"`, name excluded → no
shed (predicate logic verified correct — ON sheds / OFF keeps / wrong-name held; only the BAND lacks the name).
Same truncation defeats hint-graduation = WHY the docs are stuck. Real fix (deferred, gary+Oracle, C2 is the
constraint): a column/geometry-aware issuer window OR a `BILL FROM`-anchored recipient-excluding window.
[[project_autofile_s1_band_graduate_20260729]]
· `41f1916` (dark) → `3351e2f` **TYPE_PRESENCE_VETO — FLIPPED ON** (kill `TYPE_PRESENCE_VETO=0` restores byte-
identical) — the TYPE analog of `namePresence.js`. HOLDs a wrong-type logo-collision pick whose OWN type-heading
is ABSENT from the candidate top band (worksheet→delivery_note, PO→sales_order — the misfires that happen when
`title_trusted=False` starves the trusted-title refuse `template_matcher.py:457`). Two seams parity-pinned via
`python_backend/tests/data/type_presence_vectors.json`: LEARN = `database/modules/typePresence.js` +
`templates.getAll` threads `{type_heading_ratio,_n,_tokens}` per template; CONSUME = `template_matcher.py`
`_type_heading_absent` + the veto block (after the refuse, gated `_logo_refused is None`, reuses
`_type_refuse`/`type_refused`). Pins `test_type_presence.js` + `test_type_presence_matcher.py` green (matcher
fixtures unaffected — no threaded tokens ⇒ abstain). [[project_type_presence_veto_20260728]]
**Corpus gate (realdoc, 2057 docs, OFF baseline vs BOTH-flags-ON):** M_type=0 held · **ZERO new silent-wrong M**
· veto ELIMINATED #2390 (wrong-ref PO now held) · would-auto-file −30 (~1.5%) + taught-ownership 24→74, ALL
HOLD-only + FAIL-SAFE BY CONSTRUCTION (type_refused → no-template → one-click review, never a wrong file). S1
0 firings. (ON log `scratchpad/corpus_on.log`; OFF baseline = night session `beaewxxm4.output`.)

**AFTERNOON — BORN-DIGITAL TEST RIG + reggie ref/date fix (owner: "we've only tested 2 digital doc types,
both had bugs — build a varied batch"):**
· **Demo batch** — `stress_test/gen_demo_digital.py` (reportlab, born-digital = real text layer, isolates
LAYOUT/anchor/band/type bugs, no OCR noise) writes **800 PDFs to `Desktop/Demo Docs Digital/`**. **Set A** (600:
6 NEW suppliers × 6 archetypes — saas-clean / two-col BILL FROM\|BILL TO / footer-letterhead / three-party /
minimalist-text-wordmark / subheading — reproduces the 2 known bugs; safe anywhere). **Set B** (200: CLASH —
reuses live names SuperStore/Marlowe on divergent layouts). `ground_truth.json` per doc; edge tags
(below_tall / in_image_title / watermark / multi_page). Catalogue from barry+herald+gary. `README_PROTOCOL.txt`:
Set B → COPY DB or plain-confirm-only (gary: template-reuse-by-name collapses digital+scanned into one row,
un-unmergeable; ⊕-teach/correct irreversibly wipes scanned anchors); veto is SEED-FIRST (inert < 3 confirms).
· **Scorer** — `stress_test/score_demo_digital.js` reprocesses vs ground_truth.json, **cold** (empty learning,
isolates layout) or **`warm`** (loads live snapshot). Findings: type detection SOLID (invoice 100/PO 98.8/SO
97.5/delivery 98.8 — installed types); **supplier 8% cold = letterhead cold-start hole**; warm Set B **CLASH
BLEED CONFIRMED** (supplier 90% inherited from scanned learning, ref 29% layout-mismatch → held); warm Set A
**CROSS-CONTAMINATION** (ref 58→33% — live learning degrades UNRELATED new suppliers; suspect name-blind
`findLogoMatch` / global anchor → [[pendingfeatures]]). ⚠ DB has only 5 types + NO total field (install
credit_note/quote/statement/receipt + a total field to score the full 9 + money).
· **`42a9334` reggie ISO-date + ref-labels** (config-only `keyword_patterns.json`, reggie→Oracle SIGN-OFF-W/COND
ALL met) — **ISO date transposition** `2026-11-01`→`26-11-2001` FIXED (`_clean_value`/`_clean_text_fallback`
first-matched the DD/MM pattern on the ISO tail): ISO pattern FIRST + BOTH numeric date patterns now carry
`(?<!\d)…(?!\d)` (Oracle C2, no clip inside a longer digit run). NEW **`delivery_number`** field_patterns entry
(was NONE → 0%). `Our Ref`/`Order Ref`/`Issued` labels. Pins `test_iso_date_clip.py` (+C2 boundary +C5 mirror
trade-off). Corpus: date 96.1% UNCHANGED (corpus is scanned, no ISO — fix targets born-digital), M 19 no-new,
M_type 0, **delivery_number safe on 540 confirmed delivery notes (C3 PROVEN)**. Demo rescore ref 58→83 / date
60→84. **Config change → LIVE in the running dev app on the next processed doc (no restart).**
· **`3705296` `pendingfeatures.md`** — running backlog (owner convention: add discussed-but-deferred features
here). Item 1 = import **"couldn't be read" banner** (`renderStuckChip` `main/renderer.js:1265` — count-only,
no filename/reason/DISMISS; the doc holds at `status='error'`, NOT lost; `getStuckDocs()` already has names) +
10 deferred items (letterhead reader, S1 column-window, warm cross-contam, digital↔scanned bleed, delivery/
worksheet ref, preset+total fields, TYPE-veto slices, identity branding-primary, Cython/fuses hardening).
· **Security Q answered** (owner: ".py/.pak decompilable?"): engine ships sourceless **`.pyc`** (verified in the
package — a speed bump, decompilable); `.pak` = Chromium resources (non-issue); most `.py` = third-party libs +
thin entry shims. Real upgrades (deferred, backlog): Cython→native `.pyd`, arm fuses (`HARDEN_FUSES`), asar
rungs. **Licensing gate = the commercial moat, not code secrecy.**

**NEEDS OWNER:** (1) **REBUILD installer** off `3705296` — `r20260729-0905` predates the reggie config fix. Then
live-smoke: 150-DPI import, reprocess-reconnect (`eebe154`), forget/focus/overlay, the VETO. (2) **Import the demo
batch** — Set A into the live app (safe), Set B into a COPY DB (per README); run `score_demo_digital.js A` /
`… B warm`. (3) **Diagnose the Set A warm cross-contamination** (58→33 ref, [[pendingfeatures]]). (4) work
`pendingfeatures.md` (the stuck-banner UX + the rest). (5) SuperStore anchor-removal
`scripts/remove-superstore-invnum-anchor.js --apply` (app-closed, STILL not run). (6) untracked
`HANDOVER_2026-07-28*.md` + `docs/SECURITY_HARDENING_REPORT_2026-07-28.md` — commit or leave.
**S1 stays DARK (INERT on two-column, real fix deferred). Prior block ↓**


## Prior session states (2026-07-28 and earlier) — archived, read on demand
The per-session state blocks used to stack up here and bloated this file past 1800 lines. They are
now archived, not lost:
- **Each session has a `HANDOVER_<date>[_PART].md`** in the repo root (07-15 → 07-28_NIGHT). Read the
  one matching the work you're resuming.
- **`docs/session-log.md`** carries the VERBATIM per-session blocks (2026-07-09 → 07-28) in one
  greppable place — grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent
  session built.
- **`MEMORY.md` index + `memory/project_*.md`** carry the durable per-feature facts (commit hashes,
  kill switches, gate results, open follow-ups).
Keep this file lean: when a new session wraps, REPLACE the current-state block above — do not stack a
new one on top. Move the outgoing block to `docs/session-log.md` (+ a `HANDOVER_*.md`). The `/newsession`
skill does this.

**Durable gotchas from past sessions (full context: `docs/session-log.md` + memory index):**
- Packaged EMBEDDABLE Python (`vendor/python`, `python312._pth`) drops the script dir from `sys.path`:
  any spawned Python CLI must `sys.path.insert` then `from ocr.x import …`, NEVER bare `import x`;
  reproduce with `python -P`; verify build-only fixes against `vendor/python`, not `py`.
- The 88 critical auto-file floor passes conf==88 BY DESIGN (blocks only c<88) — pinned in
  `test_scope_trust.js`; do NOT "fix" the comparator.
- A custom doc type is identified by its "Also appears as" ALIASES, never its arbitrary internal name.
- `field_anchors.document_type` stores the SLUG, not the type NAME — a name-keyed lookup is a dead guard
  whose unit test can still falsely pass (the "dead guard greens every test" trap).
- The license window carries its OWN copies of the Settings hierarchy styles — do NOT move them to theme.css.
- Renderer JS changes (Review window, slip-fixer, teach) need the window REOPENED/app restarted to load.
- `processing/handler.js` requires `learning` per-function — a module-load smoke can't catch call-time
  ReferenceErrors (the `77e674e` class); new user-facing files under userData need `_allowedOpenRoots`.
- Test-GT can be poisoned by casual confirms (fictional/test docs plant real learning rows — purge after
  pilots); remediation conventions: `gt_overrides.json` + the archive's 2026-07-10/11 blocks.

## Working rules (read before any fix)

**STOP AND SECOND-GUESS at these six junctures** (owner rule, added 2026-07-24 after a root cause was
missed that the owner spotted immediately; item 6 added 2026-07-27). Not "think harder" — at each named
juncture, spend ONE extra step asking **"do I need more information?"** and **"what am I missing?"**, then
continue. This does NOT override token conservation: it is six specific moments, not a licence to widen
every investigation.
1. **You just looked at an artefact to answer ONE question.** Before closing an image / trace / report,
   describe what ELSE is in the frame. FAILURE 2026-07-24: nine document crops were opened to read a
   reference number; every one of them also showed a visibly SKEWED page, which was the actual root
   cause, and it was read past nine times.
2. **You found a plausible cause and it feels satisfying** — especially when it is a code smell (a wrong
   comment, a suspicious constant, an obvious asymmetry). Ask "why is THAT true?" one level deeper before
   designing. A wrong comment is evidence of confusion, not proof you have found the mechanism.
3. **Your own measurement produced an extreme number.** An extreme number IS the finding — do not file it
   as mild corroboration of the small hypothesis you already hold. FAILURE: `no_candidate = 326/574`
   (57% of rigid crops yielding nothing comparable) was noted as "consistent with clipping" and moved
   past; 57% is a structural mismatch, not an under-sized constant.
4. **Before proposing ANY fix**, ask "am I treating a symptom?" and "what would make this wrong?" — then
   say the answer out loud in the design. A fix that compensates for a misalignment instead of removing
   it will pass its unit test and fail its corpus gate (it did: the crop-headroom A/B bought 2 new silent
   wrong reads and healed 0).
5. **Before concluding, grep the memory index + CLAUDE.md for prior art on the MECHANISM**, not just on
   the symptom. FAILURE: `project_skew_anchor_misread` / `project_detect_deskew_parked` /
   `project_deskew_field_reread` already recorded that skew breaks anchored reads. All three were in the
   index and none were consulted.
6. **You are about to ASSERT that something EXISTS / does not exist / is configured a certain way** — a
   template, field, setting, DB column, learned row, file, flag. **NEVER state system state from indirect
   or partial evidence — VERIFY IT AT THE SOURCE first** (query the DB, read the code, list the table/dir).
   It is almost always a cheap, bounded check (one SQL query / one grep), and when the claim is load-bearing
   for a diagnosis it is mandatory, not optional. A UI or trace signal is NOT the state: "No template match"
   on screen means the matcher did not SELECT one for THIS doc — NOT that no template EXISTS. FAILURE
   2026-07-27: asserted "Northgate has no sales_order template" from a "No template match" flag plus a stale
   forensic, and built a diagnosis on it; the owner knew a sales_order template with ~10 confirms existed. A
   5-second `SELECT … FROM templates` would have caught it and changed the whole root cause. Do not make the
   owner be your fact-checker for state you could have queried.

**Corollary — the owner is a live source of information, not just an approver.** When something is cheap
for them to answer and expensive to infer (how they draw a teach box, whether duplicate imports are
deliberate, what a scan actually looks like), ASK before building on an assumption.

**Token conservation — hard requirement**
- Smallest possible scope: read the fewest files necessary; never scan the
  whole repo unless a narrow, targeted investigation has proven insufficient.
- Stage non-trivial work into incremental edits — prefer a focused change
  over a broad rewrite. Keep investigation and responses concise and
  non-repetitive.

**Extraction/anchoring fixes are system fixes, not document fixes**
Any issue touching field detection, anchors, OCR regions, keyword matching,
validation, supplier/template learning, or extraction accuracy is a reusable
*application-level* weakness until proven otherwise — assume it also affects
unseen suppliers, layouts, and future templates, not just the document on screen.
**Every document in the current corpus is a TEST DOC** (the BF_/KO_/MP_/NS_/PF_/AW_/CS_
batches, SuperStore, etc.) — the deliverable is NEVER a fixed document, always a fixed
SYSTEM. A doc-level outcome only matters as EVIDENCE of a system behaviour. (Operator
actions in-session — a ⊕ teach, a typed correction, a confirm — are fine and are
themselves system-wide by design: a teach lands a supplier+doctype-scoped anchor, a
confirm feeds scope-wide learning. CODE changes, by contrast, must never be tuned to
one document, one filename, or one sample's coordinates.)
- Fix the reusable layer — matching strategy, learning rules, normalisation,
  thresholds, validation — not the symptom on one sample document.
- No one-document hacks: filename-based exceptions, sample-specific
  coordinates, or narrow conditionals tuned to a single case (allowed only
  with a documented architectural reason).
- State explicitly how the fix helps future unseen documents/templates. If it
  mainly helps the sample in front of you and doesn't clearly improve the
  broader system, stop and redesign the approach.
- Verify beyond the single failing document: note likely impact on other
  templates/layouts and regression risk; prefer multi-sample or manual
  cross-checks over a single-document confirmation.

---

## Subagents & skills (advisors the user invokes by name)
Defined in `.claude/agents/*.md`; invoked via the Agent tool. All three are
ADVISORY — they diagnose/recommend and DO NOT implement unless explicitly asked.
Implementation stays with main Claude Code. Brief them with full context (a fresh
spawn starts cold) and relay their findings to the user.
- **bob** (`agents/bob.md`) — senior software & product advisor. Receives a
  report/diagnostic/plan, translates to plain English, splits fact vs assumption,
  flags risks, gives ranked options + a recommendation. Use after producing a
  report when the user wants options before implementation.
- **barry** (`agents/barry-the-brainstormer.md`, 2026-07-18) — elite PRODUCT
  BRAINSTORMER: high-value feature ideation for home/personal/small-office document
  management. Thinks in full user flows (capture→review→file→retrieve), friction,
  trust and segment fit; labels ideas L1 polish → L4 market-first bet + priority.
  Carries a verified product-grounding block (full-text search live, auto-separation
  exists, ref-less types first-class). Brainstorm-stage only — his output still goes
  through the normal advisor+Oracle gate before any build. First output:
  `docs/brainstorms/BARRY_2026-07-18_home-edition_generic-docs_separator-sheets.md`.
- **gary** (`agents/gary.md`, 2026-07-09) — Python engineering analyst: root-cause
  analysis (FACT vs ASSUMPTION), smallest-correct testable fix DESIGN (with backward-compat +
  data-migration + invariant notes), and TEST STRATEGY (unit + the realdoc_regression M=0/accuracy
  gate + a test that PINS an accepted trade-off so a future dev can't restore the bug). Uses the
  Python skills below. Now has a durable brief; still spawn general-purpose reading it if not a
  registered type. (Validated the absolute-target-first root cause for the worksheet date/name
  failures; designed the cross-supplier sweep/priority slices this session.)
- **oscar** (`agents/oscar.md`) — OCR expert: efficient OCR pipelines
  (preprocessing, Tesseract PSM/OEM/lang, per-field crop recipes, confidence,
  tables/searchable-PDF, accuracy-vs-throughput). HARD RULE: only recommends
  open-source tools that are free for commercial use, and states the licence —
  e.g. flags PyMuPDF (AGPL) and steers to pypdfium2, which this project uses.
- **eric** (`agents/eric.md`) — Electron expert: main/renderer architecture,
  secure IPC + preload/contextBridge, BrowserWindow/webContents lifecycle,
  child-process management, packaging/electron-builder, code signing, perf/memory.
- **reggie** (`agents/reggie.md`) — regex & extraction-pattern expert: analyses/
  tightens/loosens field regexes and validation rules (invoice/PO/sales-order
  numbers, VAT, dates, totals, codes, IDs) and anchored label→value extraction;
  precision-first; keeps the renderer `RegExp` and Python `re` patterns aligned
  (the shared `validation_patterns` in config/keyword_patterns.json). Returns a
  fixed report shape (Facts / Proposed pattern / Match examples / Integration point
  / Risks / Smallest change).
- **007** (`agents/007.md`) — elite OCR ENGINEER (deeper than oscar on geometry):
  separates the READING axis from the PLACEMENT axis, follows the coordinate frame,
  proves FACT vs HYPOTHESIS, fixes the reusable layer. For the hardest OCR positioning
  bugs (label→value drift, registration / coordinate-frame mismatches) + end-to-end
  OCR-pipeline review; same OSS-licence hard rule as oscar. (Led the Stage 0.5
  inline-harvest drift fix with oscar + eric — see OCR_WORKFLOW_REVIEW.md.)
- **oracle** (`agents/oracle.md`) — the FINAL adversarial reviewer: VETS the CONSENSUS of
  the other advisors (invoke him LAST, after 007/gary/oscar/reggie/eric agree, or when one
  proposal needs a hard second opinion). His load-bearing skill is systems/precedence
  reasoning, not first-draft analysis — he catches the SEAM where two individually-correct
  fixes combine badly, VETS THE PREMISE of the ask (facts/reward/risk), TRACES the code to
  verify claims (same-frame/units, where a value is computed vs its gate), weighs BLAST RADIUS
  (prefers do-nothing / a lower-risk layer over touching page-wide code), insists on FAIL-
  TOWARD-REVIEW (never a silent wrong value; don't drop the human checkpoint on same-pixel
  agreement alone), and names the VERIFICATION GATE (harness M=0 + zero accuracy drop). Verdicts:
  SIGN OFF / …WITH CONDITIONS / SEND BACK / DO NOTHING / WRONG LAYER. Same OSS-licence hard rule.
  Trial log + running assessment: `docs/oracle_log.md` (4-for-4 so far; his brief was refined
  from that track record). Spawn as general-purpose with the persona if not yet a registered type.

**Advisor refinement (2026-07-09):** all the design advisors (007/gary/oscar/reggie/eric) now carry a
**"name the seam"** rule — before proposing, state what the fix RELIES ON upstream and what safety/gate
it DISABLES downstream (a credibility reject, a review flag, an auto-file floor, a precondition another
fix depends on) — because the session's worst near-miss was a fix that was correct in isolation but
removed the safety another fix relied on (an M=1). 007 additionally frame-checks the capture convention
of its own helpers (top-left vs centre); oscar checks what a "cleaner"/whitelisted read disables; the
principle is "fail toward review, never toward a silent wrong value." The Oracle remains the final
cross-cutting check for the seam the specialists still miss.

**Skills** in `.claude/skills/`: a set of Python engineering skills
(`testing-strategy`, `code-quality`, `performance`, `api-design`, `packaging`,
`security-audit`, etc. — gary's toolkit), `ocr-document-processor` (oscar's
OCR knowledge pack: SKILL.md + scripts; note its requirements.txt lists PyMuPDF —
use pypdfium2 here instead), and `ocr-engineering` (007's deep OCR pack: coordinate
frames, anchor→offset math, merged-row inline harvest, registration-as-fallback,
debug triage). `scan-finder-frontend-design` covers the website/UI.

---

## What this is
Windows desktop app (ships as **Scan Finder** / `ScanFinder.exe`; internal
identifiers, DB `docusnap.db` and `%APPDATA%\DocuSnap` remain "DocuSnap"):
scans documents → OCR → extracts fields → files them intelligently.
Electron + Python backend + SQLite. Fully offline capable.

---

## Business / company details
**Six Mile Software** is a **trading name (sole trader) — NOT a registered limited
company** (no Ltd, no Companies House number as of 2026-06). **Scan Finder** is the
product. Use these for the website (footer, contact, legal/terms), the licensing emails,
and anywhere a business identity is needed:
- **Trading name:** Six Mile Software  *(do NOT append "Ltd" or imply incorporation /
  a company number until one is actually registered)*
- **NEVER surface the proprietor's personal name** anywhere public (site, footer, emails,
  Terms/Privacy). Present the business as **"Six Mile Software" + the virtual address +
  licensing@scanfinder.co.uk only.** (The clean route to full name‑privacy + compliance is
  to incorporate **Six Mile Software Ltd** — then only the company name/number/registered
  office appear; until then, lean on Polar being the seller of record, below.)
- **Address:** Office 1874, 92 Castle Street, Belfast, N. Ireland, BT1 1HE
  (virtual business address)
- **Product:** Scan Finder · **domain:** scanfinder.co.uk · **licensing/email sender:**
  licensing@scanfinder.co.uk
- **Seller of record:** **Polar** (Merchant of Record) — Polar is the legal seller for
  purchases, so the customer's purchase contract + VAT/tax sit with Polar, not Six Mile
  Software. The website/emails still carry the Six Mile Software identity for support.
- Revisit this whole block (and add the company number) **if/when a limited company is
  incorporated**.

---

## Stack
| Layer | Tech |
|---|---|
| Desktop shell | Electron 31, Node.js, better-sqlite3 |
| UI | Vanilla HTML/CSS/JS; **native OS window frames**; shared light/dark theme (`src/windows/shared/theme.css`) |
| LAN add-on | TLS `/v1` API (Node `https`) + detached Electron search client; certs via node-forge (`src/services/certService.js`) — see Detached search client |
| OCR | Tesseract 5 via pytesseract + pypdfium2 |
| Database | SQLite via better-sqlite3 |
| Platform | Windows only |

---

## Directory map
Long per-file design notes live in **`docs/architecture-notes.md`** (marked ➜AN below) — read the
matching block there BEFORE changing one of those files.
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router — thin, delegates to modules
│   ├── preload.js                       # contextBridge API bridge
│   ├── modules/
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND AUTO-FILE (_maybeAutoFile/_autoFileDoc; `auto_file_threshold` slider default 100; type+un-flagged gate is the real safety) ➜AN
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced → Learning History (view/purge/rename learned values + "Fix likely slips", admin/edit, audited; per-row source-docs + Open in Review) ➜AN
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer; Learning Recovery reassign (reversible) + templates.mergeInto (IRREVERSIBLE fragment merge) ➜AN
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core shared by desktop IPC + /v1. reviewService: atomic claim-then-file confirm (allowRefile intent), central DD-MM-YYYY date normalisation, detached learning hooks (snappy confirm). presenceService: advisory "being reviewed by" TTL map ➜AN
│   └── windows/
│       ├── main/{index.html,renderer.js}      # dashboard + nav rail; customisable/draggable card grid (localStorage order, Settings→Appearance toggles); import view opens result rows in Review ➜AN
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # zoom/pan preview; hidden Template Wizard (⚓) + "Show where it reads" overlay; ⊕ teach readout bar; three role-framed teaching surfaces; Teach-this-document CTA ➜AN
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card carousel; last-card fork → practice run) ➜AN
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED practice run — in-renderer over bundled fixtures, NO real DB/learning/output touched; draw-a-box teach sim ➜AN
│       ├── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
│       ├── help/                              # User Guide window (index + content pages, help.css, help-nav.js) — native frame, themed
│       └── shared/{theme.css,theme.js,helpmode.js}  # centralised palette/components · theme toggle · data-help-key help-mode
│   (createWindow opens every panel HIDDEN and reveals on ready-to-show — no
│    empty-background "black box" flash; startup/login flow passes show:false and
│    reveals manually, so it's untouched)
├── database/
│   ├── index.js                         # open(), runMigrations(), runJsMigrations()
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       ├── learning.js                 # hints, anchors, logos, getSetting/setSetting
│       ├── templates.js                # template CRUD, field mappings, sample-document linkage
│       ├── licensing.js                # client license_tokens cache (cacheToken/getActiveToken/clearSeatToken)
│       └── trust.js                    # supplier GRADUATION / safe auto-file: TRUSTED_FLOOR 95 after W=10 clean confirms; isAutoFileEligible = the ONE shared predicate; docTrustGate two regimes (sub-100 full gate, at-100 lenient but blocks deterministically-invalid/shape-violating values) ➜AN
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see Extraction pipeline below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding (same-logo siblings disambiguated by keyword fingerprint, THEN by the doc's own detected TITLE — see identify_template detected_slug/title_trusted below)
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read → inline-harvest/relocate off the located label (label_box) → registration fallback
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5 learned misread correction + 2.5d DOMINANT-VALUE SNAP (count-weighted snap to a ≥5-count/≥80%-share confirmed literal; kill SNAP_ALLOW_SUBSTITUTION) ➜AN
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js; is_name_like_field EXCLUDES technical addresses (mac/ip = CODES, not names) ➜AN
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   │   └── identity_fusion.py           # text-led SUPPLIER identity — DORMANT/SHADOW mode (changes nothing; rapidfuzz promotion pending, HANDOVER_2026-07-07.md) ➜AN
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py rebuilds page text from word GEOMETRY (visual rows — the scanned-totals two-column fix); region.py draw-tool zone-OCR, light-first ladder + multi-line PSM-6; landmarks (registration); text_enhance (degraded re-read); born_digital (PDF text layer, skips OCR) ➜AN
│   ├── logo/fingerprint.py
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD; rotation SIGN convention PROVEN in tests/test_orientation.py (PIL CCW vs pypdf CW — a wrong sign corrupts every doc); working-copy rotated once at import; auto_rotate_enabled default ON ➜AN
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas). --thumb = single low-res page-1 thumbnail for list thumbnails (previewService.getThumbnail)
├── config/keyword_patterns.json        # editable pattern library
├── config/license.json                 # client license config: base_url, product_id, public_keys (PUBLIC keys only)
├── client/                              # detached LAN search/mailbox Electron client (apiClient.js pins the CA) — see Detached search client
├── cert-tool/                           # standalone TLS cert-generator GUI (node-forge)
└── licensing-backend/                   # separate PHP 8 + MySQL activation server (WAMP/IONOS); see Licensing
    ├── public/{index.php, v1/*.php, admin/*}  # health · /v1 trial_start|activate|validate|revoke|status · admin web page
    ├── lib/{db.php, jws.php, admin_auth.php}   # PDO+JSON helpers · Ed25519 signing · admin gate+CSRF+bright chrome
    └── schema.sql · keys/ (gitignored seeds + admin_password.hash) · scripts/{Configure,Verify}-WampBackend*.ps1
```

---

## Database tables
Long design notes for the annotated tables live in `docs/architecture-notes.md` (➜AN).
```
document_types  — name, slug, built_in, ref_field_key, date_field_key,
                  title_aliases ← mig 43: extra printed-title phrases that ALSO detect the type
                  ("Also appears as" chips; alias == any existing type name hard-rejected) ➜AN
fields          — document_type_id(FK), key, label, type, required, built_in
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number,
                  working_path  ← mig 17: app-managed import copy in userData/inbox/<docId><ext>;
                  preferred by preview/reprocess/confirm (source folder need not survive)
                  page_count   ← mig 37: captured at import; drives the multi-page icon (NULL pre-mig)
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count.
                  Hints FILL EMPTY FIELDS ONLY (usage≥2, conf=min(90,60+usage*5)); the EVIDENCE-BASED
                  VARIABILITY GUARD skips any field with ≥2 distinct confirmed values in-scope ➜AN
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x/y/w/h_norm, usage_count, confidence,
                  last_authoritative_at (mig 20), offset_dx/dy_norm (mig 21 drift-invariant vector).
                  ⊕ teach persists ON COMMIT not on the draw (staged in pendingAnchors); an
                  authoritative teach is the SINGLE anchor per (field,doctype) — sweeps ALL suppliers
                  and outranks every passive anchor. supplier_name here is a LEARNING SCOPE key,
                  never a required document field. document_type stores the SLUG. ➜AN
logo_fingerprints — supplier_name, phash, ahash, match_count
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf, page_number
                  (mig 22): 3-5 stable words re-located per page to fit the Stage-0.5 registration
                  transform; additive/inert — no rows = existing anchor/offset path ➜AN
template_logo_hashes — template_id(FK cascade), phash, UNIQUE (mig 26): MULTI-REFERENCE logo set —
                  matchers take MIN distance over the set; drifted-but-related hashes appended on
                  confirm (dist (2,13], cap 8); _upsertTemplate reuse band 7-13; accept gate ≤6 ➜AN
settings        — key, value (key-value store). Notable: registration_enabled (ON) ·
                  born_digital_enabled (ON) · name_wordness_flag (ON — free-text NAME review flag;
                  operator "✓ This name is correct" → accepted_name_values allowlist exempts forever)
                  · first_run_completed (mig 24 stamps already-configured installs) ➜AN
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← mig 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
users           — …, totp_secret, totp_enabled  ← mig 28 (detached-client MFA
                  only; nullable/inert — the in-process desktop login never reads them)
document_routes — document_id(FK cascade), from/to_user_id+username,
                  action_required(approve|acknowledge), state(pending|claimed|approved|
                  rejected|acknowledged|recalled), comment, resolution_comment,
                  claimed_by_*, resolved_at, version  (mailbox/approval; see Detached
                  search client). documents.workflow_status = denormalised latest state.
                  Ensured UNCONDITIONALLY in runJsMigrations — NOT version-stamped.
```

---


## Extraction pipeline
`process_docs.py` → `ExtractionEngine.extract()` runs a staged pipeline:
- **Stage 0** `template_matcher.py` — match a learned template, seed fields (same-logo suppliers
  disambiguated by keyword fingerprint; doc-type slug resolution — a null slug silently disables
  the format/qualification gates). TYPE-PRECEDENCE (2026-07-09): a supplier issuing several doc types
  on ONE letterhead has same-logo sibling templates with IDENTICAL fingerprints, so the fingerprint
  tie-break can't separate them and the established sibling stamps the WRONG type over the doc's own
  title. `identify_template(detected_slug, title_trusted)` breaks the tie by the doc's OWN detected
  title: within the same-logo cluster PREFER the sibling whose `document_type_slug == detected_slug`;
  REFUSE (return None → doc to review to teach) when a TRUSTED title declares a type NO sibling carries.
  `title_trusted` = the type is a STRUCTURAL standalone HEADING (`keyword.detect_document_type` exposes
  `heading` + `_line_is_heading_like`; incl. "WORKSHEET 38"), NOT a confidence threshold (a low-sitting
  title under a tall letterhead scores ~70-79, which a threshold would exclude). `detected_slug`/
  `title_trusted` are computed ONCE in `process_docs` and threaded IDENTICALLY into BOTH identify_template
  calls (pre-extract + the engine's authoritative one) so they can't split-brain. Custom-type TITLE
  ALIASES (see `document_types.title_aliases`) feed this via detect_document_type. Guarded by
  `tests/test_template_matcher.py` (identical-fingerprint fixture).
- **Stage 0.5** `template_mapper.py` — admin-drawn anchor→target zone mappings. Absolute-target-first
  read → inline-harvest / relocate off the located label → registration fallback ("register, then read").
- **Stage 1** `keyword.py` — regex patterns from `keyword_patterns.json` (~60-70% of fields); label
  word-boundary guards (e.g. "Total" must not match inside "Subtotal").
- **Stage 2** `anchor.py` — learned label positions + logo supplier ID; drift recovery, label-lock,
  digit-parity guard, slip-fix, inline harvest, multi-line continuation.
- **Stage 4** `validator.py` — date normalise/salvage, currency infer, cross-field maths.
- **Stage 4.5** `format_anomaly_checker.py` — coarse-class + learned-shape consistency vs confirmed
  history; free-text guard; token-level name repair; format-weighted overall confidence.
- **Stage 4.6** candidate override — gated, DEFAULT-OFF.

**Processing mode** (`processing_mode`, default `smart`): `fast` and `smart` are now IDENTICAL
(stages 1+2) — they diverged only for the removed AI mode. The user-facing Fast/Smart CHOICE was
COLLAPSED (2026-07-08): no Settings selector, no topbar mode badge, no "Switch to Fast Mode?"
suggestion toast. The `processing_mode` setting + `--mode` plumbing REMAIN for tolerance (a stored
`fast`/`smart` is still honoured; `set-processing-mode` stays registered + admin/edit-gated;
`check-fast-mode-suggestion` is a retired no-op). Reintroduce a mode only if the stages diverge again.

⚠ **Critical invariants — always honour these (full rationale in the doc):**
- engine.extract() returns a FLAT dict mixing field dicts `{value,confidence,method}` with `_`-prefixed
  metadata (`_supplier_name`, `_overall_confidence`, …). Pop `_` keys BEFORE iterating fields; call
  `sanitise_extractions()` after popping, before emitting.
- Supplier identity must reflect the LATEST reliable `results['supplier_name']`, not the first guess —
  engine re-resolves it once, after every stage, before persisting hints/anchors/logos.
- Manual/authoritative anchors (⊕ teach, Stage 0.5 mapping, `keyword_override`) win on regex/TYPE alone
  (`shape_mode='ignore'`) and must NOT be vetoed by the learned-shape check; auto tiers keep full type+shape gating.
- Extraction/anchoring fixes are **system fixes, not document fixes** — fix the reusable layer, no
  one-document hacks (see Working rules).

📖 **FULL detail — read before ANY extraction/anchoring/OCR/validation/confidence change:
`docs/extraction-pipeline.md`** (every stage's internals + fix history, the drift/registration/
label-lock/slip-fix/inline-harvest/multiline designs, OCR ladder & crop recipes, `_gate_value`
shape modes, authority precedence, performance notes, and the accuracy/concurrency/load harnesses).

## Filing system
```
OutputRoot/
└── CompanyName/
    └── 2025/
        └── December/
            ├── Invoice.15-12-2025.INV-001.pdf
            └── .metadata/
                └── Invoice.15-12-2025.INV-001.xml
```
- Output root stored in settings table as `output_folder` (set on Settings →
  General; NOT changed by the rules below).
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- **OUTPUT STRUCTURE is now BUILDER-driven** (Settings → "Output Structure" tab,
  renamed from "File Naming"; `src/modules/filing/filename_pattern.js`), both
  token "block" builders (click-to-insert + custom text + live preview):
  - **Subfolders** = `output_folder_pattern` setting — a token string where `/`
    starts a new subfolder level. Default `{supplier}/{year}/{month}` = the legacy
    Company/Year/Month layout, so installs that never change it are byte-identical.
    `buildFolderSegments` token-substitutes + Windows-safes EACH level (illegal
    chars stripped, reserved device names defused) and DROPS empty levels; the
    handler still enforces the output-root containment check on the joined path.
  - **Filename** = `filename_pattern` setting (default `{docType}.{date}.{ref}` =
    `DocType.DD-MM-YYYY.RefNo.pdf`) — the existing `buildFilename` engine, unchanged.
  - Builder blocks (`FIELD_TOKENS`): Company `{supplier}` · Document Type `{docType}`
    · Date `{date}` · Reference `{ref}` · Year `{year}` · Month `{month}`. The
    same builders appear in the first-run wizard's "Output organization" step.
  - filing/handler.js IPCs: `get-output-structure-info` (blocks + defaults),
    `preview-output-path` ({folderPattern,filenamePattern} → sanitised segments +
    filename). Guarded by test_filename_pattern.js.

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

**STRUCTURAL fields (Document Issuer / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the COMPANY/identity
field (`COMPANY_KEYS` — **`['supplier_name']` ONLY since migration 44, 2026-07-10**: customer_name was
UNLINKED from identity and is now an ordinary OPTIONAL recipient field on every type; migration 45
purged its stale issuer-as-customer learning — see HANDOVER_2026-07-10_EVENING.md), the `date_field_key`, and
the `ref_field_key`. The identity field's DISPLAY label is **"Document Issuer"** for
BOTH keys (migration 38, 2026-06-28 — one unambiguous label so an operator never
enters variable data like a customer name in the identity field; supersedes the
migration-35 "Supplier Name"/"Customer Name" split and the migration-27 "Company").
Label-only — the internal KEYS (supplier_name/customer_name) + learning schema are
untouched. (Deferred: customer_name may later become a SEPARATE recipient field on
issuer-style types, with supplier_name as the sole identity — a data-model change.)
They drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning
(logo_fingerprints/hints/anchors/corrections/template identity key off the company
scope value), so the FIELD can't be deleted, disabled, renamed or retyped — but the
per-document VALUE stays editable (correcting a mis-read is what feeds learning).
The internal key stays `supplier_name`/`customer_name` (only the display LABEL
changed — "Supplier Name"/"Customer Name") so the learning schema is untouched. `is_structural` is annotated on each
field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked toggle, no
delete, 🔒). `updateField`/`deleteField` enforce it server-side;
`create-doc-type-with-fields` injects a Company field if the caller omits one.
Guarded by `database/modules/test_structural_fields.js`. (RESOLVED 2026-07-10: migration 44
made `supplier_name` the sole identity/scope key on EVERY type — sales orders included;
`customer_name` is a plain optional recipient field. The old latent nuance is gone.)

**DANGLING STRUCTURAL ROLE — self-heal + Confirm resilience** (2026-07): a type's
`ref_field_key`/`date_field_key` can end up pointing at a field that no longer exists
(the Reference field was deleted, or a type was created with a role key that never
matched a real field). That made Review's Confirm gate IMPOSSIBLE to satisfy — the
required key matched NO field, so Confirm sat disabled with nothing on screen to fill
(the "won't let me file, no empty field visible" trap). Three guards: (1)
`repairStructuralRoles()` CLEARS a dangling role to NULL on the UI type-list loads
(`getAllWithFields`/`getAllWithFieldsAll`) so the Settings dropdown shows it as unset +
re-pickable (not auto-repointed — guessing ticket_no vs serial_number is the user's
call); (2) `updateType` REFUSES to set a role to a field key that doesn't exist (can't
create a new dangling role); (3) the Review renderer's `validateConfirm` DETECTS a
dangling role (required key with no matching field) and shows a clear note ("This
type's Reference field isn't set up. Choose it in Settings → Document Types") instead
of a silent block. Guarded by `test_structural_fields.js`.

**PRESET DOCUMENT-TYPE CATALOG** (Settings → Document Types → "Add from catalog…";
`database/modules/document_types.js` `PRESET_CATALOG`/`getPresetCatalog`/`addPresetTypes`):
a shipped library of ready-made types a business TICKS to add — Purchase/Sales Invoice,
Remittance Advice, Credit Note, Delivery Note, Statement, Receipt, Quote. Ticking one
ATOMICALLY creates the type + fields + structural roles (reuses
`create-doc-type-with-fields`/`ensureStructuralRoles`) AND seeds its likely field-label
aliases into `field_label_overrides` (per-install, doc-type-scoped — see
`keyword.merge_label_overrides`), so Stage-1 anchored extraction has a head start with NO
teaching. Slug is DERIVED from the name (`presetSlug`, mirrors `addType`); idempotent
(re-add = no-op); catalog types are `built_in=0` (fully removable). Post-migration-44 EVERY
preset's identity/company role is **`supplier_name`** (the sole scope key) — Sales Invoice /
Remittance / Delivery Note / Statement ALSO carry `customer_name` as an ordinary optional
RECIPIENT field (the remitter's payer captions "Received From"/"Payment From" live on
`supplier_name`, the issuer) — so filing/learning scope is right from the start. reggie-
reviewed labels: only DOC-SPECIFIC captions + the NOVEL ref/date fields are seeded;
canonical fields (supplier/customer/invoice_*/total) defer to the shipped
`keyword_patterns.json` `field_patterns` (single source of truth, no drift); bare generics
("From"/"Date"/"Amount"/…) dropped (un-shipped fields had no Stage-1 gate — now closed by
the override validation-by-role above, but the lists stay tight). Phase 2 (DEFERRED): narrow
DETECTION by the enabled-type set so "tick only what I use" also cuts cross-type confusion
(today the shipped `document_type_keywords` buckets always score regardless of `enabled`).
Guarded by `database/modules/test_doctype_presets.js`.

---


## Licensing & activation
Optional device-bound license gate: trial + paid-seat. **OFF in dev, ON by default in packaged builds;
enforcement is ALWAYS ON in every build** (no env/setting/dev bypass). The MAIN process is the sole
decider — `enterMainApp()` → `licensingModule.decideAccess()` (`src/modules/licensing/handler.js`); the
renderer can only REQUEST entry (`license-enter-app`), never self-grant. A non-`allow` gate routes to the
license window (`src/windows/license`). Tokens verified OFFLINE (`src/lib/license/token.js`) against pinned
Ed25519 public keys (alg EdDSA, kid pinned). Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`fingerprint.js`) — raw value never leaves main. Config in `config/license.json` (`base_url`/`product_id`/
PUBLIC keys only; bundled via extraResources → rebuild installer after editing). Backend = separate PHP 8 +
MySQL server (`licensing-backend/`, `/v1/{trial/start,activate,validate,revoke,status}` + admin web page).
⚠ Secrets: never log/echo account or activation keys; never re-display a one-time key; never expose
`account_key_hash` or the raw fingerprint.

## Legal / Terms acceptance
Version-stamped acceptance gate from ONE bundled `LEGAL.txt` (repo root; **DRAFT** — solicitor items
outstanding). Surfaced in three places: installer NSIS licence page · first-run / version-bump gate
(`src/windows/legal/`, shown by `enterMainApp()` after the licence gate, before onboarding, enforced in
MAIN) · re-read (About box + Settings → Advanced → Legal). Acceptance stored LOCALLY only
(`settings.terms_accepted = {version,hash,app_version,accepted_at}` — no telemetry, no external calls).
Bump `LEGAL_VERSION` (main.js) + the file's `Version:` header to re-prompt everyone.

📖 **FULL detail: `docs/licensing.md`** (decideAccess specifics, offline verify order, backend endpoints
+ owner-email-on-trial, admin 2FA/TOTP, config keys, and the Legal gate internals + IPC).

**Update-available banner (slice 1, advisory).** MS Store delivers the actual binary (auto-update on
relaunch); the app only SIGNALS "a newer version exists." The backend `releases` table (one row per
channel: `latest_version`/`update_url`/`min_supported_version`) rides the EXISTING `/v1/validate` +
`/v1/status` responses via `lib/release.php` `release_info()` — UNSIGNED, non-gating, and EXCEPTION-PROOF
(a failure returns null and can NEVER 500 the token response → no lockout). Client compares `latest_version`
vs `app.getVersion()` (clean 3-part SemVer in both NSIS + MSIX builds; `buildRev` is never an ordering key)
CLIENT-SIDE, so the version never leaves the device. `licensing/handler.js` `captureUpdateInfo` (TOTAL — its
own try/catch, persists to the `update_info` setting, never null-over-good, cannot disturb the gate decision)
+ `resolveUpdateInfo` (garbage-safe) → `get-update-info` IPC + `open-update-url` (scheme-allowlisted
https/ms-windows-store only). Home dashboard `#dash-update` banner: info-tone, PULL model (mirrors
refreshTrialBanner), per-version dismissal. **Slice 2 — forced-update** (`min_supported_version`): decideAccess
sets `gate.forceUpdate` ONLY on a REACHABLE backend's live response (`belowFloor(app.getVersion(), min_supported)`),
so an offline app is NEVER locked (FAIL-OPEN, eric's hard rule); enterMainApp + the 6h reval timer route a
forced doc to its OWN lock window (`src/windows/update-lock/`, distinct from the licence lock — Update / Quit
only; `update-lock-quit` IPC is sender-guarded). Designed with eric/bob/gary; guarded by
`src/lib/update/test_version.js` (incl. `belowFloor`) + `src/modules/licensing/test_update_info.js`.

## Detached search client (LAN add-on)
A separate Electron search/mailbox client runs on other LAN PCs and talks to the core over a TLS `/v1`
API (`src/modules/api/handler.js`, Node `https`). It is an **entitlement-gated add-on**
(`src/services/entitlementService.js`, `detached_client_licensed` setting) that ALSO upgrades the core
app's own Search; the core works fully standalone with the add-on off. Core services are
transport-agnostic (`searchService`/`reviewService`/`workflowService`/`presenceService`/`sessionService`)
so the desktop IPC and the `/v1` client share one implementation.

Key pieces:
- **/v1 API** — search/preview, review-over-/v1 (queue/counts/confirm/defer via the shared claim-then-file
  `reviewService`), doc-types, presence ("Currently being reviewed by <name>"), workflow routes, enroll/CA.
  DTO projection returns ONLY the frozen contract fields (never `stored_path`/`folder_path`/`working_path`).
- **Managed 2-tier TLS** (`certService.js`, node-forge) — a CA signs a server cert; the client pins the CA.
- **Mailbox/approval workflow** — present but HIDDEN pre-release behind `WORKFLOW_FEATURE_ENABLED=false`.
- **TOTP MFA** (client-only) + **/v1 session revocation** on admin deactivate/role-change/password-reset.

⚠ Security invariants (preserve): real TLS verification, NO silent self-signed bypass in the client UI;
pin the **CA** (`ca.crt`), not `server.crt`; `ca.key` NEVER crosses any endpoint; enrollment needs a
fingerprint/pairing integrity check.

📖 **FULL detail: `docs/detached-client.md`** (every `/v1` endpoint + contract version, cert wizard,
entitlement/workflow gates, presence/reviewService internals, the client targeting-OCR path + open bug,
theming/keyboard-focus fixes, the concurrency/accuracy/import-load stress harnesses, and all tests).

## UI conventions
**Shared theme** — every window's palette + components are centralised in
`src/windows/shared/theme.css` (loaded by all windows) + `theme.js`. **ELEVEN named
themes**: the core SIX (2026-06-28) — Light · Warm Paper · Nordic Slate (light
family) · Dark · Midnight · Graphite (dark family) — PLUS a **Seasonal** group
(2026-07): Spring · Summer (sunshine-yellow) · Autumn · Winter (icy-blue) light +
**Festive** (dark, evergreen-green with a holly-RED accent + gold). Each is a
`:root[data-theme="X"]` token-override block; **Warm Paper is the default**. The
seasonal themes carry faint repeating **SVG-tile artwork** (leaves/suns/snowflakes/
holly) served as CSP-safe `'self'` files from `shared/patterns/*.svg` (NEVER
`data:` URIs — `img-src 'self'` blocks those), `background-attachment:fixed`, baked
low opacity. `DARK_THEMES` in theme.js gates the dark family (incl. `festive`). `theme.js` sets BOTH `data-theme` (palette)
AND `data-mode` (light|dark family) on `<html>` — `color-scheme` + the logo swap
key on `data-mode` so all dark themes get native dark scrollbars/logo. `--on-accent`
token = text colour on a filled accent (lets Midnight's amber use near-black text).
Subtle background patterns are pure CSS gradients (CSP-safe — NO `url(data:…)`, which
`img-src 'self'` blocks) on the shell `--bg` only (Warm=dots, Slate=grid, Midnight=
glow; others flat). Picked via Settings → General → Appearance `<select>`; the
account menu + the main-window rail-foot toggle are a quick Light⇄Dark flip
(mode-aware). `set-setting('theme',…)` persists + broadcasts `theme-changed` live.
Windows reference the tokens and no longer define their own `:root`.
```css
/* light (default) — the client palette */
--bg:#f4f6fa  --surface:#ffffff  --surface2:#eef1f7  --surface3:#e4e8f1
--border:#e4e7ef  --border2:#d2d8e4
--accent:#3b7df0  --accent2:#2f6fe0  --accent-bg:#e7f0ff
--ok:#1f9d63  --warn:#b07816  --err:#d64545
--text:#1b1f2a  --muted:#69728a  --doc-bg:#eef1f7
--r:12px --r-sm:9px --r-pill:999px        /* rounded buttons / inputs / cards */
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code) — SELF-HOSTED woff2
(latin subset, OFL-1.1) in src/windows/shared/fonts/ + @font-face in theme.css.
NO Google-Fonts CDN (was a per-window offline/privacy leak); every window's CSP
is now font-src 'self'. Don't reintroduce a CDN <link>.
```
- **Native OS window frames** (`main.js` `frame:true`). The old custom drag
  titlebars are hidden globally (`html #titlebar,.titlebar{display:none!important}`
  in theme.css). The main window's bar is renamed `#topbar` and kept as a real toolbar.
- **Self-contained child windows** (review/settings/search/teach/dev-inspector):
  opened **modal** to the focused parent, **`skipTaskbar`** (no second taskbar
  icon), start **maximised** with user resize remembered (`applyWindowState` →
  `window-state.json`).
- **Settings & Review use a left-sidebar shell**; buttons/inputs are the rounded
  client-style components from theme.css.
- **Settings tab structure (11 tabs, 2026-06-30 reorg — the "General" junk-drawer is
  GONE):** a `Setup` cluster — **Files & filing** (folders + output structure) ·
  **Document Types** · **Processing** (mode/parallel/OCR/separation/name-checks + the
  import toggles auto-file/multiline/auto-rotate + Review confidence threshold) ·
  **Appearance** (theme + Home-screen cards + window behaviour) — then an
  `Administration` cluster (side-head divider) — **Templates** (the `#tpl-dock` viewer
  only) · **Learning** (Keyword Label Overrides at top + Learning Recovery + memory
  inventory) · **Learning Repair** (see below) · **Users** (accounts + recent activity) · **Audit** (the audit log) ·
  **Licensing** (licence + activation + seats; `#wf-section` workflow stays HIDDEN) ·
  **Search client** (the `#client-api-*` access card) · **Advanced** (Backup & Restore
  + Diagnostic Logging + Re-run setup). The renderer (`settings/renderer.js`) tab-click
  handler is generic on `data-tab`→`panel-<slug>`; only these slugs carry lazy-init —
  `learning`→`loadMemoryInventory`, `audit`→`loadAudit`, `searchclient`→
  `initClientApiSection`. Every control is wired by element ID, so a section moves
  between tabs intact. (Done via two reviewed worktree passes; guarded by the
  div-balance + tab↔panel pairing checks.)
- **Help-mode** (`src/windows/shared/helpmode.js`): elements tagged `data-help-key`
  highlight and deep-link into the User Guide window (`src/windows/help/`).
- **List thumbnails** (`src/windows/shared/thumbs.js`): page-1 PDF thumbnails in the
  Review queue, Search results, and the Teach doc-picker, lazy per visible row
  (IntersectionObserver) + a per-window in-memory cache. ONE shared IPC
  `get-document-thumbnail` → `previewService.getThumbnail` → `render/pages.py --thumb`
  (single low-res page; reuses pypdfium2 — no new dep). GOTCHA: the observed element
  must have a layout box — `display:none` starves IntersectionObserver, so the teach
  card uses a `visibility:hidden` overlay (review/search use a visible placeholder box).
- **About box** (core: user-menu "About ScanFinder…"; client: sidebar "About"): app +
  Electron version + copyright (read from package.json `build.copyright`) + a
  "Third-Party Licenses" button that opens the bundled notice via `shell.openPath`.
  IPC `get-app-about`/`open-third-party-licenses` (core), `client-about`/
  `client-open-licenses` (client). See License compliance.
- **Review queue** mirrors the Search results list: plain scroll + click (↑/↓ keys
  still cycle), and a **draggable splitter** makes the file column width adjustable
  (persisted in localStorage). Beside the queue is a **docked vertical tool rail**
  (`#queue-scroll-rail`, `src/windows/review/index.html`): a top **nav group**
  (`.rail-nav-group`) + a **document-tools group** (`.rail-tools-group`) holding the
  ✂ Split-PDF, Template-Wizard (⚓), OCR-Enhance, ⚙ Advanced (learning-history), and
  ∞ **Straighten-all** buttons — compact `.queue-tool-btn` icon triggers whose wide
  controls open as `.rail-flyout` popovers anchored to the rail (active = the shared
  `.open` pressed style). SEPARATELY, a horizontal `#doc-toolbar` sits ABOVE the page
  (zoom, page nav, the per-doc ∞ Straighten button). A Review control lives in one or
  the other — grep the WHOLE index.html before assuming a control's home. (The session
  "Straighten all" toggle — `#btn-deskew-all` + its `#deskew-all-bar` angle-threshold
  flyout — is in the tool rail; the per-doc Straighten is in `#doc-toolbar`.)

---

## IPC reference

### Renderer → Main (invoke — returns promise)
```
pick-folder, pick-output-folder, process-folder(folderPath)
get-document-types, get-all-doc-types
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
get-validation-patterns                # validation_patterns from config (cached) — Review on-blur field validation
create-doc-type-with-fields({name,fields[],ref_field_key,date_field_key})  # transactional; teaching wizard
get-doctype-catalog, add-doctype-presets(slugs[])   # preset doc-type catalog (admin) — see Preset document-type catalog
get-teach-target                       # docId the teach window was opened at (pulled once on load)
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
get-document-thumbnail(id,folderPath,filename)   # page-1 low-res thumb (shared/thumbs.js)
get-app-about, open-third-party-licenses          # About box: version + open the bundled notice
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), reprocess-document({docId,folderPath,filename})
ocr-region(base64), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
search-documents(params)
get-setting(key), set-setting(key,value)
get-output-structure-info, preview-output-path({folderPattern,filenamePattern})  # Output Structure builders
settings-backup-export({password}), settings-backup-preview({password}), settings-backup-apply({path,password})  # admin; see Settings backup
get-processing-mode, set-processing-mode(mode)
check-fast-mode-suggestion(supplierName)
license-get-status, license-start-trial, license-activate(data), license-revoke(data)
license-test-activate(data)            # admin local test — never mutates real state
license-get-enforcement, license-set-enforcement(on)   # admin-gated; Settings → Activation
dev-inspector-unlock(pw)               # pw checked in MAIN (=== 'SFDEV'); opens dev-inspector window
dev-inspector-running                  # read-only bool (isBatchRunning)
dev-get-session-docs, dev-get-session-doc(key)  # read-only in-memory dev-session registry (no DB)
dev-get-slice(path)                    # base64 of a temp OCR crop; path MUST resolve under ctx.devSliceDir
split-pdf(file,ranges,outDir,docId,every)  # pypdf split; `every` N = split every N pages (1=each), else ranges
onboarding-suggested-folder, onboarding-validate-folder(folder)  # first-run wizard (mkdir+probe writability)
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
open-teach-window, open-teach-window-at(docId)   # guided teaching wizard (Admin+Edit)
onboarding-complete, open-onboarding   # first-run wizard: set first_run_completed+open shell / re-run (admin)
notify-review-complete
license-enter-app                      # REQUEST entry; main re-decides via decideAccess
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
reprocess-progress(msg), process-progress(msg)
process-trace(ev)                      # dev-inspector + (when its console is active) the REVIEW window; never the main window. See Dev inspector / Review trace console
license-state(gate)                    # pushed to the license window with the blocked-state reason
```

---

## Process-progress message types (Python → Electron stdout)
```json
{"type":"start","total":N}
{"type":"file_begin","filename":"..."}
{"type":"file_done","success":true,"status":"needs_review|confirmed|error",
 "original_filename":"...","overall_confidence":85,"needs_review":true,
 "document_type":"Invoice","supplier_name":"...","extractions":{...},
 "invoice_number":"...","invoice_date":"...","total_amount":"..."}
{"type":"log","text":"...","level":""|"warn"|"err"}
```

---

## Known bugs (fix these first)

### Resolved 2026-07 headline bugs — moved to `docs/history.md` (verbatim)
- 2026-07-08 harness RED = mis-taught anchor + poisoned GT, NOT code (fix: critical-field 88 floor in trust.js).
- 2026-07-06 cross-supplier POSITIONAL anchor bleed FIXED (`_is_blind_cross_supplier_anchor`; small residual noted).

### Resolved QA / audit history — see `docs/history.md`
The 2026-07-02 read-only adversarial audit's **11 findings are all FIXED + tested**; the per-item landing
notes (backup natural-key upsert, no-ref/date confirm dead-end, reprocess-discards-edits guard, batch
file-copy off the file_done path, File-All-Ready expectId race, empty-issuer warn, shared `slug.js`,
watch/output overlap block, etc.) plus the "verified SOUND, don't re-audit" list have moved to
**`docs/history.md`**. Read it before re-touching backup restore, confirm gating, slug derivation, or path-overlap.

### BUG 1+2 — `str object has no attribute get`
**File**: `python_backend/process_docs.py`
**Cause**: engine.extract() returns _ prefixed metadata as plain strings mixed
with field dicts. After popping _ keys, some may remain or validator iterates them.
**Fix**: Add and call `sanitise_extractions()` after all _ keys are popped:
```python
def sanitise_extractions(raw: dict) -> dict:
    clean = {}
    for key, data in raw.items():
        if key.startswith('_'):
            continue
        if isinstance(data, dict):
            clean[key] = data
        elif data is not None:
            clean[key] = {"value": str(data), "confidence": 50, "method": "unknown"}
        else:
            clean[key] = {"value": None, "confidence": 0, "method": "unknown"}
    return clean
```
Also update `validator.py` `validate_and_adjust()` to skip _ keys and
normalise non-dict values as defensive belt-and-braces.

### BUG 3 — Regex `bad character range /-\.`
**File**: `config/keyword_patterns.json`
**Fix**: In `validation_patterns.date`, change `[/-\.]` to `[/\-.]`

---


## Features to build / build history — see `docs/history.md`
The staged build specs (Stage 2 Settings rebuild · Stage 5 Review rebuild · Stage 6 Search window ·
Stage 7 field-format cross-referencing) are largely **DONE**; their specs and the durable "built
additions" notes have moved to **`docs/history.md`**. Still genuinely OUTSTANDING there:
- **Stage 7 Stage 3** — persistent learned format model (`field_format_rules` table, migration 12,
  `--format-rules-file`): overrides the inferred class once `confirmed_count ≥ 10`. Not yet built.

## Fast Mode suggestion — RETIRED
The Fast/Smart user choice was collapsed 2026-07-08 (see Processing mode above);
`check-fast-mode-suggestion` is a retired no-op kept for tolerance. Do not re-implement the toast.

---


## First-run wizard · Settings backup · Learning Repair
- **First-run wizard** (`src/windows/onboarding/`) — a linear setup wizard shown ONCE on a clean install,
  AFTER the licensing gate; gated by the `first_run_completed` setting (migration 24 stamps already-
  configured DBs so existing users are never re-onboarded — NEVER infer "clean install" from empty state).
  Only required step = a writable output folder. Followed by a 6-card welcome/familiarisation TOUR
  (`src/windows/welcome/`, its own `welcome_seen` flag; reopenable from the user menu).
- **Settings backup / restore** (admin; `src/services/backupService.js`; Settings → Advanced) — exports
  operational config to ONE password-encrypted file (scrypt → AES-256-GCM over gzipped JSON). Includes
  settings (minus `licens*`), doc types/fields, templates, anchors, hints, corrections, logos; EXCLUDES
  users/recovery/audit/licensing/documents. **Device-bound import** (anti-trial-stacking): a backup from a
  different machine is refused unless this machine holds an active paid seat.
- **Learning Repair** (admin Settings tab, `panel-repair`) — un-poison a doc type by browsing its confirmed
  docs and sending a bad one back to Review (replace-in-place, no `-DUPLICATE`). Grounding fact: learning is
  derived LIVE from `confirmed` docs (`getFieldFormats` filters `status='confirmed'`), so de-confirm/soft-
  delete is the real lever — clearing learning tables alone doesn't un-poison. Precision-first suspect
  detectors (`src/services/repairSuspects.js`): outlier docs (phash) + anomalous values (shape/name/charset).

📖 **FULL detail: `docs/features.md`** (wizard steps + gate flow + copy-after-processing keys; backup
crypto/scope/restore transaction/IPC; Learning Repair detectors/scope-split/IPC/UI).

## Main window — "Review your documents" CTA
After a batch finishes, a green "✓ Review your documents" button appears in the sidebar
below Process Documents (where Stop was) and opens the Review window. Shown only when
`stats.done > 0`, reset on each run start, gated like the Review nav (hidden for
read-only). Complements the "View Results" 3-field table, doesn't replace it.

## Help-mode + modals gotcha
`shared/helpmode.js`'s active capture-phase click interceptor (shows help INSTEAD of
activating a control) used to swallow clicks inside in-page modals — a destructive
typed-confirm dialog (Erase ALL data) then looked broken (couldn't click/type). Fix:
help-mode skips any element under `[data-help-ignore]`; the custom modals
(showTypedConfirmDialog, showSecretDialog) set it. SEPARATELY, those modals now defer
`input.focus()` to `requestAnimationFrame` (focusing an element the same tick it's
appended is dropped by Chromium → "no flashing cursor") + a click-to-focus fallback.


## Teaching wizard · Dev inspector
- **Teaching wizard** (`src/windows/teach/`) — a dedicated linear "Teach a new document" wizard for
  non-technical users (Admin+Edit): welcome → choose the scanned doc → pick or CREATE a doc type → point
  out each field by drawing a box around its VALUE (live OCR read-back; the wizard auto-detects the nearby
  label as the anchor) → review → commit. Each field is saved as a **Stage 0.5 anchor→target MAPPING**
  (value-box-only + auto-label — works on document #1, registration covers drift), NOT a Stage 2 ⊕ anchor.
  Commit sequence is DEFERRED to the last step (promote-to-template → save-template-mapping per field →
  confirm-review) so Back/Cancel are safe.
- **Dev inspector** (hidden, read-only — no DB writes, no learning) — in the MAIN window press
  **Ctrl+Shift+D then M**, password `SFDEV`. An answer-first extraction-provenance view + a Review-window
  **trace console** (same key combo, inside Review) for debugging extraction PRECEDENCE. The `--trace` /
  `--slice-dir` flags are added ONLY while the inspector/console is open (or diag logging is on), so normal
  processing is byte-identical. OCR slices saved to one temp dir, served base64, cleared on close.

📖 **FULL detail: `docs/features.md`** (teach auto-flow / fixed-value / artifact / commit sequence;
dev-inspector three-column UI, telemetry mirror, trace event types, click-to-highlight slices, per-field
winning-lineage reconstruction, and the known main-app follow-ups).

## Python invocation pattern
All Python scripts called with temp files for large data (avoids Windows
ENAMETOOLONG limit on CLI args):
```javascript
const file = path.join(os.tmpdir(), `ds_name_${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(data));
// pass --name-file file to Python
// cleanup in proc.on('close')
```

Python uses `py -3.12` in dev, `vendor/python/python.exe` when packaged.

---

## License compliance (third-party OSS) — see `COMPLIANCE.md` (canonical)
The shipped product bundles permissive/notice-style OSS (no GPL/AGPL); the only
copyleft is weak/file-level (FFmpeg LGPL-2.1 via Electron, a couple of MPL-2.0
files). Compliance is automated:
- **`THIRD-PARTY-LICENSES.txt`** (core, repo root) + **`client/THIRD-PARTY-LICENSES.txt`**
  ship via each app's `build.extraResources`; surfaced in-app via the About box.
- **`scripts/check-licenses.js`** — prebuild GATE (wired into `npm run build`, also
  `npm run check:licenses`). Enumerates the Node prod-dep tree + bundled
  `vendor/python` packages, classifies each license ALLOWED / DENIED(copyleft) /
  UNKNOWN against an allowlist, exits 1 on any DENIED/UNKNOWN so a dependency bump
  can't silently ship a bad license. Dual `A OR B` passes if either side is allowed
  (elections: node-forge→BSD-3, expand-template→MIT, rc→MIT, packaging→Apache-2.0).
  MPL-2.0 is allowed (we ship unmodified source). Exports its collectors.
- **`scripts/gen-third-party-notices.js`** — rewrites the notice's INVENTORY section
  from the gate's data + re-stamps the product version (package.json) and date; leaves
  the curated copyright/license-text sections alone.
- **Release**: on the build machine (where `vendor/python` exists) bump versions →
  `npm run check:licenses` → `node scripts/gen-third-party-notices.js` → `npm run build`.
- When a new license FAMILY appears, add its text to section 3 of the notice + its
  name to the intro list (the generator does NOT manage section 3). Editing the
  notice's whole license text in one Write trips the API content filter — author the
  short parts, then APPEND long texts (fetched to files) via a script.

## Dev workflow
```bash
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract; licensing enforcement OFF
npm run build      # → dist\ScanFinder Setup <ver>-r<rev>.exe  (rev = scripts/build-rev.js, or $BUILD_REV)
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

**Build notes**: electron-builder is pinned **`^24.13.3`** (installed = 24.13.3 — an earlier note
saying "v26" was inaccurate; verify with `require('electron-builder/package.json').version`). Avoid
re-adding the legacy `win.sign` / `win.signingHashAlgorithms` keys. For a future MSIX/Store SKU see
`MSIX_SETUP.md` (consider upgrading electron-builder for the `appx` target). A TEST `.appx`
builds via `electron-builder --win appx` (placeholder identity `SixMileSoftware.ScanFinder` /
`CN=Six Mile Software`) — but it REQUIRES **Windows Developer Mode ON** (or an elevated shell):
electron-builder extracts its bundled `winCodeSign` toolset using SYMLINKS, which Windows blocks
without that privilege, so `makeappx.exe` never lands and the build dies `spawn UNKNOWN`/`ENOENT`.
The resulting `.appx` is unsigned (Store signs on submission; for local sideload self-sign a cert
whose subject == the appx Publisher, then `Add-AppxPackage`). An opt-in document-data-FREE
diagnostics/error-reporting feature is DESIGNED but NOT built — see `DIAGNOSTICS_PLAN.md`
(Phase 0 first; strict enumerated allowlist, no field values even masked, consent-gated).
`postinstall` runs
`install-app-deps`; native deps
(`argon2`, `better-sqlite3`) are auto-rebuilt for the Electron ABI during build. Installer is
**unsigned** → SmartScreen "More info → Run anyway" on the VM. Run gate tests with
Electron-as-Node, not plain node (native-module ABI).

**Versioning (policy: manual SemVer + automatic build stamp — Eric+Gary consensus).**
THREE INDEPENDENT axes: the core app version, the client app version, and the `/v1`
contract version (`API_CONTRACT_VERSION` in `src/modules/api/handler.js` — the real
client↔server compatibility signal; never gate licensing on it). Bump `package.json`
`version` **manually, at release only**, git-tagged (MAJOR breaking/licensing-tier · MINOR
feature/add-on · PATCH fix) — do **NOT** auto-bump per build (it churns git + pollutes the
number licensing/support reads). Every build is still made DISTINCT + traceable by an
automatic stamp: `scripts/build-rev.js` `buildRev()` = `<UTC yyyymmdd-hhmm>-<git short sha>`
(or `BUILD_REV` verbatim), carried by both `nsis.artifactName`s as `-r${env.BUILD_REV}` →
e.g. `ScanFinder Setup 2.0.0-r20260622-1133-9f158c5.exe`, AND baked into the packaged
`package.json` via `--config.extraMetadata.buildRev` so the **About box** self-reports
`Version <ver> (<rev>)` (unpackaged dev reads the live git sha). Release ritual: bump
`version` → `git tag` → `BUILD_REV=<version> npm run build` (optionally branch artifactName
to drop the `-r<ver>` for a clean `ScanFinder Setup 2.1.0.exe`).

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset DB during development (also clears users,
cached license tokens, and the enforcement setting).
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
Packaged build remembers prior login/trial because that DB persists across reinstalls
(NSIS `deleteAppDataOnUninstall:false`). Licensing enforcement is ALWAYS ON (no env/setting/
dev bypass) — dev must run against a real backend trial/seat for the machine's fingerprint.
