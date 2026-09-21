# HANDOVER — 2026-09-21 EVENING

**Branch** `feat/teach-side-overnight` · **HEAD `d3df3ce`** (docs; last CODE commit `b002cca`) · **origin CURRENT — all
pushed** · migration **195** · `node scripts/run-pins.js` **405/405 green**. Working tree: feature work all committed;
the only dirty paths are the OWNER's (`CLAUDE.md`, `tools/video_tutorials/*`) — do NOT commit them.
Installer pair: last built at `52344d3` — **PREDATES the undetected-issuer gate + the "Not recognised" tab; rebuild
at HEAD to ship Part B** (see FIRST ACTIONS). No uncommitted feature batch. Nothing running.

The rolling `handover.md` carries the same state in the next-batch format; this file is the dated snapshot.

## TL;DR
Three features shipped + pushed, each advisor+Oracle-gated, all DARK/opt-in or display-only (safe to ship):
(1) **opt-in auto-split** (mig 194) + page-1 separator-sheet compose + a scoped multi-doc auto-file hold;
(2) **all 6 Chris 2026-09-20 vet findings** (copy/UX + one real stale-status bug); (3) the **undetected-issuer feature
A+B** — Part A (mig 195 DARK) blanks a non-name unsupported issuer, Part B adds the Review "Not recognised" tab.
Pending: rebuild the pair to carry Part B; the Part-A flip census; the split "recover original" button; the standing
owner-gated backlog (licensing deploy, DB-encryption decision, VM verify).

## Committed this session (8 commits, all pushed) — no uncommitted feature work

### 1. Opt-in auto-split — `ec17b5c` (slice 1) + `87226d2` (slice 1b)
Design `docs/designs/OPTIN_SPLIT_2026-09-20.md` (Oracle SIGN-OFF-W/COND, pre-vetted).
- **mig 194** `auto_separate_enabled` OPT-IN (default OFF; INSERT-OR-IGNORE de-escalation — an explicit 'true'/'false'
  survives; NOT in TEST_SWITCH_KEYS — a customer feature flip, not a dark switch). Both backend read defaults + the
  Settings toggle polarity flipped.
- **Scoped multi-doc auto-file HOLD** (the ship-blocker Oracle caught): `process_docs.py` emits `multi_doc_suspect`
  when a LATER page reads as a doc-start AND is not a self-declared continuation (mig-177 veto, from the already-OCR'd
  text — zero extra render); `handler.js _handleFileMessage` stamps `MULTI_DOC_HOLD_NOTE` (via `_stampSegmentHold`)
  when auto-split is OFF → `isAutoFileEligible` refuses. Gated OFF when auto-split ON (byte-identical, Oracle G1).
- **Page-1 separator-sheet override** (slice 1b): `ocr/segmentation.py compose_segments(n, seps, first_pages)` —
  sheets HARD, inter-sheet runs subdivided at heuristic first-pages, `weak_pages` = the sub-cuts only. `--auto-split`
  gates the whole-file heuristic. The `segmentHoldPages`/`buildPairContext` MIXED-exemption seam fixed (a composed file
  holds its weak sub-cuts, sheet-bounded segments exempt). Watch unified on `auto_separate_enabled || filing_slips`;
  `watch_separate_enabled` RETIRED (row kept, no longer read; dead toggle removed).
- **Review "N pages · Split" chip** on multipage rows → the graphical splitter.
- Files: `process_docs.py`, `handler.js`, `split_plan.js`, `segment_docs.py`, `ocr/segmentation.py`, `database/index.js`,
  `watch/handler.js`, `settings/{index.html,renderer.js}`, `review/renderer.js`.
- Tests: G3 `test_multi_doc_hold.js`, G4 `test_migration194_optin_split.js`, G5 re-pointed
  `test_watch_separate_default_on.js` + `test_migration137`; G7 `test_split_plan.js §9` + `test_segmentation.py`
  (compose + contracts) + `test_segment_pair_hold.js §2` re-pointed.
- OPEN: the ON-promotion gates G1 byte-identical + G2/G6 OFF-path/speed census — only if the owner ever wants auto-split
  ON as a default. The shipped OFF default is safe.

### 2. Chris 2026-09-20 vet — all 6 findings — `52344d3`
`docs/CHRIS_FULL_APP_REVIEW_2026-09-20.md` (resolution appended). F1 confirmed docs show "Checked by you" not "N%
confidence" (`searchActions.js`, shared→synced client). F2 the Review hold banner NAMES the low field + its % and is
reworded "below the level needed to file on its own" (a field can badge green "High · 82%" yet sit under the auto-file
bar). F3 splitter names where the original goes (`.sf_separated_originals`). F4 plain-English LAN summary. F5 "ID code"
→ "certificate ID" (core + client). **F6 (real bug):** the teach-over-client note refreshed only on its own toggle →
now refreshes when the access toggle changes (`settings/renderer.js`, function-scope `refreshTeachNote`).

### 3. Undetected-issuer feature A + B — reggie+gary → Oracle SIGN-OFF-W/COND (6 conditions, all honoured)
- **Part A** `4195209` — **mig 195 DARK `issuer_undetected_blank`** (IN TEST_SWITCH_KEYS → count **45**). Root cause
  (gary, verified): NOT the letterhead reader — a KEYWORD caption read ("The **Supplier** shall not be responsible…"
  matches the "Supplier" caption in `keyword_patterns.json`); nothing refused the commit. Fix:
  `engine._declare_issuer_undetected` (env `ISSUER_UNDETECTED_BLANK`), the last supplier_name mutation in extract()
  (after the suggestion writers + the ~11933 `_supplier_name` re-bake — the first lockstep-safe point), blanks the
  field + `_supplier_name` + a review note when the value fails the name test (`keyword.issuer_read_looks_implausible`,
  a pinned TWIN of the JS `issuerReadLooksImplausible` — single-token BP/IBM/3M immunity + a non-Latin carve-out on
  BOTH sides), the method is a bare `keyword` read (allow-list, fail-safe on unknown), no template/logo/hint/teach,
  not operator-accepted. Note ASSIGNED not composed; `suggested_supplier` dropped. Files: `keyword.py`, `engine.py`,
  `learning.js`, `handler.js` (env bridge), `dark_switches.js`, `database/index.js`. Tests: `test_undetected_issuer.py`
  + `test_migration195_issuer_undetected.js` on the SHARED vectors `python_backend/tests/issuer_implausible_vectors.json`;
  count pins 137/163 → 45.
- **Part B** `b002cca` — the Review **"Not recognised" tab** (clone of Deferred). Membership = pure
  `src/windows/shared/notRecognised.js isNotRecognisedDoc` (window.NotRecognised): no issuer value + no type + nothing
  suggested; NEVER keyed on confidence. Docs are MOVED OUT of the main queue (threaded through
  `_reviewTabQueue`/`_sweepVisibleQueue`/`reviewDisplayOrder`/`_activeListDocs`/`updateTabCounts`/the empty branch);
  rows = thumbnail + filename + "Couldn't identify this one" (no % badge); click → normal panel (type-picker + Teach);
  bulk = "Set aside all" → Deferred; tab hidden at 0; delete is mismatch-aware. Display-only, no switch, no
  data/trust/auto-file change. Pin: `test_not_recognised.js`. Re-pointed `test_delete_target_copy.js` (3 delete surfaces).

## Verification state (honest)
- `node scripts/run-pins.js` = **405/405 green** (final run after all three features + the two re-pointed pins). The
  `test_ref_class_fix` timing flake passed this run; a red there in future is the known pre-existing flake.
- `python_backend/tests/test_undetected_issuer.py` + `test_segmentation.py` green (run with `PYTHONIOENCODING=utf-8`).
- Opt-in-split: G3/G4/G5/G7 pins green. Multi-doc hold proven at the decision layer + the compose logic unit-pinned.
- Undetected-issuer: efficacy is UNIT-proven only (the 605 corpus is invoices/POs — it can't reach a disclaimer-manual
  layout; Oracle flagged this HYPOTHESIS). The all-lowercase-real-name trade-off ("acme joinery" blanks) is PINNED.
- NOT run: the undetected-issuer FLIP census (realdoc M=0 + denominator + multi-token FP set) — owed before the flip.
  The opt-in-split G1/G2/G6 census — owed only before an ON-promotion.
- NOT built at the shipped installer: Part B is a live UI addition NOT in the `52344d3` pair (rebuild to ship it).

## FIRST ACTIONS (fresh session)
1. **Rebuild the customer pair at HEAD** so it carries Part B (the tab) + the Chris fixes: kill every Electron (EBUSY),
   then `AUDIT_OFFLINE_OK=1 npm run build:release` (core) + `cd client && npm run dist`. Update the installer block.
2. **Undetected-issuer flip census** (before turning `issuer_undetected_blank` ON): `realdoc_regression.js` RR_APP_ENV=1,
   M=0 + zero supplier_name accuracy drop, REPORT the fire denominator, + a MULTI-TOKEN synthetic FP set (the single-token
   brand hunt is near-vacuous — Oracle C4).
3. **Split "recover the original" button** (Chris F3 / Shape-A): the original is in `.sf_separated_originals` (F3 reworded
   to say so) but no visible recover action — add one (split result, or Search → recycle). Pairs with C12 Rejoin.

## Deferred (designed / conditions)
- Opt-in-split ON-promotion: G1 byte-identical forced-ON + G2/G6 OFF-path/speed census on the 34-page bundle.
- Undetected Part A flip: the census above.
- pendingfeatures.md: rotate/reorder pages in the splitter · a general queue-wide Join · `.sf_separated_originals`
  name-collision hardening · import-time/duplex blank removal.

## Needs the USER (owner-gated)
- **Deploy the 3 licensing-server changes** (`BEFORE_RELEASE.md`, manual IONOS upload — needs the owner's login): CF
  real-IP fix, New-account admin, API-activity page + the IP-logging privacy notice.
- **DB-at-rest encryption decision** — 2a whole-DB (recovery-code/data-loss trade) vs 2b TOTP-secret-only.
- **VM live-verify** the (rebuilt) pair: opt-in-split off → scans land whole + the "N pages · Split" chip; the client
  certificate-ID rename + one-time-code; thumbnails.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (blocked to Claude script tools — copy to scratch to inspect). Migration **195**.
- Tests: `node scripts/run-pins.js` (JS pins, Electron-as-Node); Python `PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_*.py`.
- The issuer predicate is a JS↔Python TWIN (`learning.js issuerReadLooksImplausible` ⇔ `keyword.issuer_read_looks_implausible`),
  pinned on `python_backend/tests/issuer_implausible_vectors.json` — change BOTH or the pin reds.
- Build offline: `AUDIT_OFFLINE_OK=1` (npm registry unreachable on this box; github push works). Deps unchanged.
- Advisors: reggie/gary/oracle via the Agent tool; Chris via `/christest` (fresh sandbox each run).
