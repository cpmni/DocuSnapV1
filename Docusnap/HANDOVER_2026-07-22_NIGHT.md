# HANDOVER — 2026-07-22 NIGHT (Opus 4.8)

**Branch:** `feat/reprocess-throughput-autostraighten`
**HEAD `dde0e39` — PUSHED. Origin in sync (`git rev-list --left-right --count @{u}...HEAD` = `0 0`).**
**Uncommitted source:** none. Tree clean except the out-of-repo `../Backup/`.
**Installer BUILT this session:** `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe` — **CRASH-FIX-ONLY**
(off `3e3fde1`; does NOT contain the label guard `dde0e39` — a rebuild off `dde0e39` adds it).
**Live DB:** migration **52**, now **187 confirmed docs** on this dev machine.
**⚠ 4 `electron.exe` processes were alive at wrap-up** (orphans from a killed `npm start`, or a relaunched
dev app) — confirm they're closed before any `npm run build` (EPERM on `better_sqlite3.node` otherwise).

> Supersedes nothing — this is a NEW, later session than `HANDOVER_2026-07-22_LATE.md` (which was the
> P3/P5 build + audit-review session). This one is dominated by a **live customer crash** on 2 PCs.

---

## 1. TL;DR
A production crash — **`'bool' object has no attribute 'get'`** — was hitting **2 customer PCs** today
(surfaced as reprocess "No data returned" AND import → Errors folder). Root-caused, fixed, gate-checked,
and an **installer built**. Plus 4 other fixes. **5 commits, all pushed:**

| Commit | Fix | Kill switch |
|---|---|---|
| `2cbc3ec` | **P2** — drop foreign-type extraction rows at confirm | `FOREIGN_FIELD_DROP` |
| `bd7eb83` | date cross-check compares CALENDAR dates, not raw strings | `DATE_AWARE_CROSSCHECK` |
| `f55bf98` | tidy the untyped-doc OCR preview snippet when garbled (renderer) | — |
| `3e3fde1` | **THE CRASH FIX** — guard the Stage 0/1/2 counters against `_`-metadata | — (log-only) |
| `dde0e39` | **label caption guard** — stop a caption word stealing a taught label | `ANCHOR_CAPTION_HARVEST_GUARD` |

**Two wrong leads were chased and explicitly ruled out** (don't re-chase): the **parallel reprocess option**
(`ocr_parallel_reprocess_enabled`) — owner turned it off, crash persisted — and the **`field_rules`
multiline rule** — a coincidence. The real cause is the **logo text-gate `'suggest'` branch** (below).

---

## 2. The crash (3e3fde1) — root cause + fix (gary-verified, code-cited)
- **Root:** the logo text-gate **`'suggest'`** branch injects `results["_needs_review"] = True` — a **bool** —
  into the main results dict mid-pipeline (`engine.py:2605`). The three diagnostic **"found" counters**
  (Stage 0/1/2 log lines, `engine.py:2421/2783/3010`) iterated `results.values()` and called `v.get("value")`
  with **no `_`-key / `isinstance(dict)` guard** — every OTHER results-iterator in the engine already skips
  `_` keys. `True.get("value")` → the crash. It only fires once a supplier's **logo is learned** but its
  page **text doesn't corroborate** it (fine before the session's logo learning accumulated, error after) —
  which is exactly the customer's SuperStore invoices.
- **Fix:** one shared `_count_valued_fields()` helper (skips `_` keys / non-dicts), used by all three
  counters. **Log-only + behaviour-neutral** (a flag was never a "valued field") → byte-identical extraction.
  Also resolves the reprocess **"No data returned"** (same crash, the reprocess handler just hid the reason).
- **Test:** `python_backend/tests/test_needs_review_counter.py` (incl. a pin that the pre-fix comprehension
  raised). **Installer built** with it — deploy to fix the customer.

## 3. The other four (all pushed)
- **`2cbc3ec` P2** (Oracle SIGN-OFF-W-CONDITIONS). Extraction runs against the UNION of all types' field
  keys → a delivery note's bare `Date:` filled invoice/order/po_date, stored + learned. Drop rows whose
  `field_key` isn't on the doc's assigned type at **BOTH** confirm sites (`reviewService.confirm` +
  `_autoFileDoc`), **AFTER** the auto-file eligibility gate (so a flagged foreign field still holds the doc —
  ordering is load-bearing). Shared `ownField` predicate in **`src/lib/foreignFields.js`** (reused by
  `_buildTemplateFields`). Sweep **`scripts/p2-foreign-field-sweep.js`** (dry-run found **94** existing rows on
  the live DB — owner runs `--apply`). Test `src/lib/test_foreign_fields.js`.
- **`bd7eb83` date cross-check.** `_reads_disagree` (`anchor.py:2997`) only date-parsed when
  `val_type=='date'`, else raw string compare → `04/06/2026` vs `04-06-2026` fired a needless "taught
  position and full-page read disagreed" flag. Now date-aware whenever BOTH reads parse. Test
  `test_reads_disagree.py`.
- **`f55bf98` snippet tidy** (renderer, client-side). The untyped-doc OCR preview strips symbol noise and
  shows a calm note when too garbled. **Renderer change → needs the Review window reopened to see.**
- **`dde0e39` label caption guard** (Barry + 007 + reggie + gary + Oracle SIGN-OFF-W-CONDITIONS, **1-6 met**).
  A taught label ("Item") that also leads a HEADING ("Item Information") got relocated onto the heading and
  inline-harvested "information". Guard at the single `anchor.py` convergence point (after the credibility
  null-gate, **re-read methods only** — a clean rigid read is untouched): a caption-continuation value is
  nulled, and if nothing else fills the field an **empty+note** row is emitted (routes to Review — never a
  silent wrong value nor a silently-blank auto-file). Predicate `keyword.is_caption_continuation` (val_type-
  aware: ARM1 all-alpha on a digit-bearing code field; ARM2 all tokens in a tight header-noun set), shared
  with `_buildTemplateFields`'s `ownField`. **The geometry occurrence-picker (auto-PICK the right "Item") is
  DEFERRED** — this slice is the fail-safe, not the "make it stick" picker. Tests:
  `test_caption_continuation.py`, `test_anchor_ambiguous_label.py` (pins flipped: r = clean-read no-note,
  r4 = empty+note held, OFF = legacy "Information"), `database/modules/test_caption_empty_flagged.js` (JS
  trust flagged-gate — the load-bearing "empty+note row trips `isAutoFileEligible.flagged`" assertion the
  corpus can't reach).

---

## 4. Verification state — be honest
- **All unit tests GREEN** (P2, date, crash-counter, and the 3 label-guard tests). Re-run after a stash/pop.
- **Corpus gate (`realdoc_regression.js`, GATE=1) EXITS 1** — but NOT from this session's fixes. It exits 1
  on the **pre-existing baseline**: M=3 would-auto-file-wrong (#190 **poisoned GT** + two PO-ref OCR
  misreads), M_type=1, 10 "regressions" (incl. #190 + #7, both **documented poisoned GT** — the confirmed
  value is itself wrong). ⚠ A trailing `tail`/`echo` in the run command **masks the exit code** — always
  read the report, don't trust the printed "exit 0".
  - **Crash fix (`3e3fde1`) is log-only** → provably byte-identical, contributes zero to the numbers.
  - **Label guard (`dde0e39`) gate = a clean A/B**: `ANCHOR_CAPTION_HARVEST_GUARD=0` vs default (ON), same
    live DB → **`diff` EMPTY (byte-identical)**. The guard is inert on this corpus (no "Item Information"
    layout in it, as Oracle/gary predicted) → **no regression**, and OFF-byte-identical is proven.
- **Corrected mid-session wrong claims (do not re-chase):** (a) the parallel reprocess option is NOT the
  cause; (b) the `field_rules` multiline rule is a coincidence, NOT the cause. The DB inspection + gary's
  trace landed the real logo-`'suggest'`-counter cause.
- The affected-PC DB was examined **read-only as a copy** at `C:\Users\cmccu\Pictures\Screenshots\docusnap.db`
  (Jamie's PC). The failing docs were data-identical to working ones (ruled out "bad doc"); the real error
  was hidden by the reprocess handler's opaque "No data returned".

---

## 5. FIRST ACTIONS for the fresh session
1. **Deploy** `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe` to the **2 affected PCs** → resolves
   the crash. Data preserved across the update (no need to clear the learned logo). Unsigned → SmartScreen
   "More info → Run anyway".
2. **Decide: rebuild off `dde0e39`** so the label guard (Item-Information fix) also ships. (Close the stray
   `electron.exe` first; stash-nothing-needed now — everything's committed.)
3. **P2 sweep** on the live DB: `scripts/p2-foreign-field-sweep.js` (dry-run = 94 rows) → back up → `--apply`.
4. **Pre-crash queue** (all owner-gated, paused when the crash hit): P4 field order, H2 pairing decision,
   live-test the earlier **P3/P5/teach** batch (still un-owner-tested from `HANDOVER_2026-07-22_LATE.md`).

---

## 6. Deferred (designed / not built) — with the load-bearing conditions
- **Label geometry occurrence-picker** — the "make teaching actually STICK by auto-picking the right
  occurrence" half. 007/Oracle: NOT the fragile `med_h*1.2` glue tie-break (it no-ops on the real doc);
  re-scope to prefer the value-carrying / standalone label; own corpus gate. `dde0e39` is the fail-safe only.
- **P4 field order** — order displayed fields by `fields.sort_order` at the SHARED seam; ⚠ check the `/v1`
  DTO contract before changing client-visible order. Drag-to-reorder editor = a 2nd slice.
- **H2 LAN pairing TOFU** (HIGH) — `docs/designs/AUDIT_H2_PAIRING_2026-07-21.md`; owner Path-A-vs-B call.
- **P2 `--apply` sweep** (owner runs it; 94 rows).

## 7. Needs the USER
- Deploy the installer (2 PCs). · P2 `--apply` (94 rows). · Rebuild-off-`dde0e39` decision. · Live-test
  P3/P5/teach. · **Poisoned-GT cleanup** (#190 LarkspurInteriors PO-as-delivery-note, #7 Ironbridge garbled
  date) — the M=3 baseline; de-confirm/re-file to un-poison, or leave (it's honest, not a pipeline fault).

## 8. Key facts & paths
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`, **mig 52**, **187 confirmed** (this machine). Read-only:
  `new Database(path,{readonly:true,fileMustExist:true})`.
- **Kill switches added this session** (all default ON; `=0` = legacy; OFF ⇒ byte-identical):
  `FOREIGN_FIELD_DROP` · `DATE_AWARE_CROSSCHECK` · `ANCHOR_CAPTION_HARVEST_GUARD`.
- **Run tests:** `py -3.12 <file>` (Python); `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>` (JS,
  native-module ABI). **Corpus:** `GATE=1 ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron
  stress_test/realdoc_regression.js` — **READ the report** (exits 1 on the baseline M=3). Kill-switch A/B:
  prefix the env var (`ANCHOR_CAPTION_HARVEST_GUARD=0 GATE=1 …`).
- **Build:** `vendor/python` present (this is a build machine). Crash-fix-only build was made by stashing the
  label guard → `npm run build` → `git stash pop`. Installer unsigned; NSIS keeps `%APPDATA%` DB across
  reinstall (data + learning preserved).
- **Crash root lines:** inject `engine.py:2605`; counters `engine.py:2421 / :2783 / :3010`; fix helper
  `_count_valued_fields` (module-level in `engine.py`, before `_cmp_norm`).
- **Advisors used:** barry (product), 007 (OCR — general-purpose + `.claude/agents/007.md` persona), reggie,
  gary (Python), oracle (several rounds), eric (P3, earlier session). No bob.
- Prior handovers, newest first: `HANDOVER_2026-07-22_LATE.md`, `HANDOVER_2026-07-22.md`,
  `HANDOVER_2026-07-21_LATE.md`, `HANDOVER_2026-07-21.md`.
