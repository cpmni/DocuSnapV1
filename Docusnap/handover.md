# HANDOVER — 2026-09-21

**Branch** `feat/teach-side-overnight`. **HEAD `b435687`.** **Origin CURRENT (all pushed).** Migration **193**.
Working tree clean. `node scripts/run-pins.js` = **401/401 green** (plus the flip pins updated this session).
Read this first, then `docs/designs/NIGHT_RUN_2026-09-20.md` (the completed night run) + `docs/designs/OPTIN_SPLIT_2026-09-20.md`
(the top build-ready plan) + `docs/CHRIS_FULL_APP_REVIEW_2026-09-20.md` (Chris's vet + triage).

## Installers (customer-shippable pair, hardened, at HEAD `b435687`)
Rebuilt this wrap (`build:release` core + client `dist`):
- Core `dist\ScanFinder Setup 2.0.0-r20260921-0949-b435687.exe` (hardened, `testBuild:false` = dark switches off).
- Client `client\dist\ScanFinder Search Client Setup 1.0.2-r20260921-0952-b435687.exe`.
The EARLIER pair (`…-4d0dc09.*`) predates the clip flip + the split pattern dropdown — ship the `b435687` pair.
Self-signed → SmartScreen "Run anyway" on first launch. (Core verifier result: see `TESTING/_measure/build_20260921_ship_core.log`.)

## What shipped this session (2026-09-20 → 21, all pushed)
1. **Graphical page-splitter + blank removal** (`b3cad58`) — thumbnail-grid popout: click the first page of each
   sub-document, drop blank pages (conservative auto-flag, reviewable), preview lightbox. The original is MOVED to
   `.sf_separated_originals` (recoverable), never hard-deleted (Oracle C-a). One hardened `_runSplit` (role+dept
   gates, strict guard). **Pattern dropdown** added (`b435687`): Custom · Every page · Every N pages — seeds the
   marks + highlights the grid (restores the retired free-text every/each options). Chris rated it "safe +
   understandable, could split without fear."
2. **Clip fix `anchor_code_left_grow`** — mig 192 DARK (`701eba0`) → efficacy injection (`8787693`) → **FLIPPED ON
   mig 193** (`6150d9b`). A taught-box crop that clips a ref's leading glyph (WS-62315→VS-62315) is re-read with the
   mig-161 left-slack window; on independent convergence with the full-page read it commits CLEAN (no needless
   "please verify" click), else flips+flags (fail-toward-review). Gate met: census M=0 + the synthetic injection
   FIRES on a real clipped raster + adversarial ABSTAINS.
3. **LAN connect fixes** (`8bc5f13`, `443e426`) — the client's one-time-code field (hidden until the server asks),
   a core "Require a one-time code" checkbox, and expired-code recovery (an expired code stopped blocking with no
   off switch — status now distinguishes configured/active/expired). `pairingOk` security gate UNCHANGED.
4. **Thumbnail retry fix** (`4d0dc09`) — a failed thumbnail is retried with backoff instead of a permanent blank
   (the client "some thumbnails never load" bug). Shared search-ui + synced client copy.
5. **Night run** (`cba3303`, `b65149f`): opt-in-split DESIGN (Oracle SIGN-OFF-W/COND), undetected-bucket UX shape
   (barry), Castellan Slice 2 = DO-NOTHING, Chris full-app vet (YES, 6 findings), 401/401 pins.

## NEXT BATCH — prioritised

### A. Build-ready (owner go to build)
1. **Opt-in auto-split on import + page-1 separator-sheet trigger** — plan `docs/designs/OPTIN_SPLIT_2026-09-20.md`,
   Oracle SIGN-OFF-W/COND. Default-flip `auto_separate_enabled` OFF (INSERT-OR-IGNORE, mig 194) — the win is the
   default flip alone (skip the expensive pre-pass; page-1-only extraction REJECTED as unsafe). **MANDATORY (the
   ship-blocker Oracle caught): a multipage-auto-file HOLD** (else a graduated supplier silently files a merged
   bundle that never reaches Review). Plus: renderer polarity flip (4th site), retire `watch_separate_enabled` + its
   dead toggle + re-point 2 contract pins, the buildSplitPlan mixed-exemption seam, gate G1-G7 (G3 the auto-file-hold
   pin MUST fail on pre-fix code). Slice 1b (page-1-sheet override) in the filing-slips path.
2. **Undetected-issuer bucket** — pendingfeatures.md 2026-09-20 + barry's shape. **Part A first** (don't COMMIT a
   non-name value as the issuer — `value_quality.is_name_like_field`/`name_quality`; L1/HIGH/LOW-effort, kills the
   spurious "shall not be responsible…" headings at source). Then Part B (a "Not recognised" Review tab — clone the
   Deferred tab; membership = value-quality-fail + no logo/template/teach, NEVER low-confidence). NEXT design step =
   reggie/gary the declare-undetected gate → Oracle, then build.

### B. Chris's findings to vet/fix (`docs/CHRIS_FULL_APP_REVIEW_2026-09-20.md` — all copy/UX, no data loss)
3. **Top: the "63% confidence" on already-CONFIRMED docs** (a doubt-number on signed-off work) + the "1 field low
   confidence" banner that points at no visible field (reconcile the whole-doc % with the visible field scores /
   point at the low field). Search preview + Review.
4. **The splitter's "original can be recovered" promise has NO visible recover button** (the file IS in
   `.sf_separated_originals`; add a "Recover the original" action, or reword). Pairs with the deferred Shape-A.
5. Smaller: client-api stale "connections OFF" note (refresh live); LAN-client summary copy leans technical;
   "ID code" vs "one-time code" both read as "code" — rename one.

### C. Standing DEV backlog (pre-dates this session)
6. **Deploy the 3 licensing-server changes** (`BEFORE_RELEASE.md`, manual IONOS: CF real-IP fix ordered upload,
   New-account admin, API-activity page) + the IP-logging privacy notice. Deploy traps in `BEFORE_RELEASE.md`.
7. **DB-at-rest encryption decision** (2a whole-DB vs 2b TOTP-only) — approval-class, owner call.
8. **VM live-verify** the shipped pair (Castellan clip fix now files clean; client one-time-code + thumbnails).

### D. Later (pendingfeatures.md)
Rotate/reorder pages in the splitter · a general queue-wide Join · `.sf_separated_originals` name-collision
hardening (a shared-basename original can overwrite an earlier recovery copy — C12 depends on that archive) ·
import-time/duplex blank removal.

## Key facts / gotchas
- **The clip fix is now ON by default (mig 193).** The `b435687` build ships it live; watch it on the Larkspur/
  Castellan worksheets (the WS-62315 "please verify" click should clear automatically).
- `anchor_code_left_grow` DELISTED from TEST_SWITCH_KEYS (customer default); count pins now 44; release gate green.
- Marks→groups→split is the ONE split path (`split_plan.js marksToGroups`, pinned). The pattern dropdown just seeds
  boundaries; every-N = the old `--every` behaviour.
- Console `→`/unicode in a Python test's print string crashes on Windows cp1252 — use `->` in test labels.
- A heredoc that opens a file for WRITE before the READ arg evaluates TRUNCATES it (`io.open(p,'w').write(io.open(p).read())`)
  — read into a var first. (Bit twice this session.)
- Chris sandbox is via `/christest` (rebuilds a fresh sandboxed instance each time; the last one has exited).
- Memory saved: this session's durable facts are in the committed design docs + CHRIS review; no new `memory/` file
  written (the docs are the record).
