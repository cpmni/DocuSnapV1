# HANDOVER — 2026-09-21 (later)

**Branch** `feat/teach-side-overnight`. **HEAD `b002cca`.** **Origin CURRENT (all pushed).** Migration **195**.
Working tree clean of feature work (only pre-existing untracked scratch/db-wal files remain — do NOT commit them).
`node scripts/run-pins.js` = **405/405 green** (the `test_ref_class_fix` timing flake happened to pass; it is the
one known-flaky pin — a red there is pre-existing, not yours).
Read this first, then `docs/designs/OPTIN_SPLIT_2026-09-20.md` + `docs/CHRIS_FULL_APP_REVIEW_2026-09-20.md` +
`pendingfeatures.md` (the 2026-09-20 "Undetected issuer" + "opt-in split" entries carry the STATUS blocks).

## Installers (customer-shippable pair, hardened — see the ⚠ below before shipping)
Last built at HEAD `52344d3` (`build:release` core + client `dist`; hardened, verified):
- Core `dist\ScanFinder Setup 2.0.0-r20260921-1144-52344d3.exe` (testBuild:false, boot smoke 0, 15 windows, fuses OK, signed).
- Client `client\dist\ScanFinder Search Client Setup 1.0.2-r20260921-1147-52344d3.exe`.
- Built offline (`AUDIT_OFFLINE_OK=1` — the npm registry is unreachable on this box; github IS reachable, so pushes
  work; deps UNCHANGED, so the audit result is identical). Self-signed → SmartScreen "Run anyway" on first launch.
⚠ **This pair PREDATES the undetected-issuer gate + the "Not recognised" tab (`4195209`, `b002cca`).** Part A is DARK
(off, no effect), but **Part B (the tab) is a live UI addition NOT in this build.** Rebuild at HEAD to ship Part B.

## What shipped this session (2026-09-21, 8 commits, all pushed)
1. **Opt-in auto-split** (`ec17b5c` slice 1 + `87226d2` slice 1b). Auto-detect batch separation is now OPT-IN
   (**mig 194**, default OFF; INSERT-OR-IGNORE de-escalation — explicit choices survive). A whole-landed multipage
   scan whose LATER page reads as a new document-start (not a continuation) is HELD from auto-file (scoped, fail-
   toward-review — `process_docs.py multi_doc_suspect` + `handler.js` `MULTI_DOC_HOLD_NOTE`). A **page-1 separator
   sheet** splits the whole stack (`ocr/segmentation.py compose_segments` + `--auto-split` gates the whole-file
   heuristic; the `segmentHoldPages`/`buildPairContext` mixed-exemption seam fixed). Watch follows the same switches
   (`watch_separate_enabled` RETIRED). Review shows a calm "N pages · Split" chip.
2. **Chris 2026-09-20 vet — all 6 findings** (`52344d3`): F1 confirmed docs show "Checked by you" not "N% confidence"
   (Search preview, shared→client); F2 the Review hold banner NAMES the field + its % and is reworded "below the level
   needed to file on its own" (reconciles with the green "High" badge); F3 the splitter names where the original goes
   (`.sf_separated_originals`); F4 plain-English LAN copy; F5 "ID code" → "certificate ID"; F6 the teach-over-client
   note refreshes live when access toggles (the real bug).
3. **Undetected-issuer feature (A + B)** — reggie+gary → Oracle SIGN-OFF-W/COND.
   - **Part A** (`4195209`, **mig 195** DARK `issuer_undetected_blank`): a NON-NAME, unsupported cold issuer read
     (the "shall not be responsible…" disclaimer caption-matched to "Supplier:") is declared Undetected (blank +
     `_supplier_name`=None + review note) instead of committed. `engine._declare_issuer_undetected`; predicate
     `keyword.issuer_read_looks_implausible` (a pinned TWIN of the JS `issuerReadLooksImplausible`, single-token
     BP/IBM/3M immunity + a non-Latin carve-out on BOTH sides); method allow-list (fail-safe). Byte-identical off.
   - **Part B** (`b002cca`): the Review **"Not recognised" tab** — docs with no issuer + no type + nothing suggested,
     moved OUT of the main queue into a calm bucket (clone of Deferred). Membership = pure `shared/notRecognised.js`
     (pinned, never keyed on confidence). Display-only, no switch.

## NEXT BATCH — prioritised

### A. Finish / ship
1. **Rebuild the customer pair at HEAD** (`build:release` core + client `dist`, `AUDIT_OFFLINE_OK=1`) so the shipped
   build carries Part B (the "Not recognised" tab) + the Chris fixes. Kill every Electron first (EBUSY). Then update
   this installer block.
2. **The undetected-issuer FLIP census** (before turning `issuer_undetected_blank` ON): `realdoc_regression.js`
   RR_APP_ENV=1, M=0 + zero supplier_name accuracy drop, **report the fire DENOMINATOR**, + a **multi-token synthetic
   FP set** (all-lowercase real names like "acme joinery" DO blank — the pinned first-contact trade-off; measure how
   often that fires on real reads). The single-token brand hunt is near-vacuous (Oracle C4). Efficacy is unit-proven
   only (the corpus can't reach a disclaimer-manual layout).
3. **The opt-in-split ON-promotion gates** (only if the owner ever wants auto-split back ON as a default): G1
   byte-identical forced-ON + G2/G6 OFF-path/speed census on the real 34-page bundle. The shipped OFF default is safe.

### B. Chris follow-ups
4. **Split "recover the original" button** (Chris F3, deferred Shape-A): the original IS in `.sf_separated_originals`
   (F3 reworded to say so), but there's no visible recover action. Add one (split result, or Search → recycle).
   Pairs with C12 Rejoin.

### C. Standing DEV backlog (owner-gated — pre-dates this session)
5. **Deploy the 3 licensing-server changes** (`BEFORE_RELEASE.md`, manual IONOS upload — needs the owner's login):
   CF real-IP fix, New-account admin, API-activity page + the IP-logging privacy notice. Deploy traps in that file.
6. **DB-at-rest encryption decision** — 2a whole-DB (recovery-code / data-loss trade) vs 2b TOTP-secret-only (lighter).
   Owner call; blocks the "fully hardened" story.
7. **VM live-verify** the shipped pair (opt-in-split off by default → scans land whole + the "N pages · Split" chip;
   the client one-time-code / certificate-ID rename; thumbnails).

### D. Later (pendingfeatures.md)
Rotate/reorder pages in the splitter · a general queue-wide Join · `.sf_separated_originals` name-collision hardening
· import-time/duplex blank removal.

## Key facts / gotchas
- **DARK switches this session:** `issuer_undetected_blank` (mig 195, IN TEST_SWITCH_KEYS → count **45**). `auto_separate_enabled`
  (mig 194) is a customer FEATURE default flip (opt-in OFF), NOT in TEST_SWITCH_KEYS.
- **Advisor + Oracle gate:** the undetected-issuer gate went reggie+gary → Oracle (SIGN-OFF-W/COND, 6 conditions, all
  honoured — see the commit body + `pendingfeatures.md`). Opt-in-split was pre-vetted in `OPTIN_SPLIT_2026-09-20.md`.
- **The issuer predicate is a JS↔Python TWIN** — `learning.js issuerReadLooksImplausible` ⇔ `keyword.issuer_read_looks_implausible`,
  pinned on the SHARED vectors `python_backend/tests/issuer_implausible_vectors.json`. Change BOTH or the pin goes red.
- **Part B membership** lives ONLY in `src/windows/shared/notRecognised.js` (window.NotRecognised) — the renderer uses it,
  `test_not_recognised.js` pins it. It moves docs OUT of the Review tab, so the Review-tab count < Home's total needs_review
  (same shape as Deferred; intended).
- Console `→`/unicode in a Python test's print string crashes on Windows cp1252 — use `->`; run Python tests with
  `PYTHONIOENCODING=utf-8`. `open()` a source file with `encoding='utf-8'` (a stray non-ASCII byte breaks a cp1252 read).
- The npm registry is unreachable on this box (offline). `AUDIT_OFFLINE_OK=1 npm run build:release` for a build; github push works.
- Chris sandbox is via `/christest` (fresh sandbox each run).
