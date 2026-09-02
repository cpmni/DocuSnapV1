# WATCH_SEPARATE_ENABLED — soak flip gate (2026-09-02)

**Feature:** `watch_separate_enabled` (DARK, built `29adce2`). The watch folder runs the SAME multi-document
separation pre-pass a manual import runs — so a bundled multi-doc PDF dropped in the watch folder is split
into per-document segments and each is detected/filed on its own, instead of importing as ONE document.

**Why this matters (the real parity win):** manual import runs `auto_separate_enabled` (default ON); watch
runs `watch_separate_enabled` (default OFF). Until this flips, a bundled PDF gets genuinely DIFFERENT field
detection by arrival path — the owner's "it wouldn't matter if watch or manual" is FALSE for bundled PDFs.
Flipping it is a higher-value parity win than the OMP micro-convergence in the unification arc.

**Why it is still DARK (Oracle SIGN-OFF-W/COND on the build):** the wrong-boundary risk is UNMEASURED on
the single-doc corpus. On the UNATTENDED watch path a segment auto-files with nobody watching, so a
wrong-but-clean split boundary could file half a document to the wrong folder silently. The build already
mitigates this — **fresh split segments are HELD for review (`autoFileRun=false`)** — but the empirical
questions (does the real separator split real bundles at the RIGHT boundary; no re-import loop; no lost
document) can only be answered by running the flag ON over real scans for a while. That is this gate.

---

## What is ALREADY guaranteed (unit-pinned — do NOT re-litigate)
`src/modules/watch/test_watch_separation.js` (17 checks, pure over `applySeparationToTracked` + `classifyPoll`):
- **Re-import-loop GUARD:** each produced segment is pre-marked `processing`, so the resumed poll classifies
  it `in-flight`, never a fresh arrival to re-queue.
- **No-loss accounting:** output = passthrough + all segments; consumed dropped; no dup; no segment name
  collides with a surviving input.
- **Held-set = exactly the produced segments** (the `autoFileRun=false` contract); a passed-through single
  doc is NOT held (stays auto-fileable).
- OFF / nothing-to-split path is byte-identical.

Also structurally true (code): `_separating` blocks the poll + drain re-entry for the whole split span; the
split original moves to `.sf_separated_originals/` (a subfolder the non-recursive poll ignores); the
stability debounce (`classifyPoll`) is untouched (a half-written file is never in the stable set);
`_liveProcs` stays SEPARATE from the manual `_currentBatchProcs`.

## What the SOAK must measure (the unmeasured, empirical risks)
1. **Boundary correctness** — real bundled PDFs split at the RIGHT page boundaries (no segment straddling
   two documents; no over-split of a genuine multi-page single doc).
2. **No re-import loop** — no segment is ever re-detected/re-tracked as a fresh arrival.
3. **No document loss** — every input PDF ends as either a filed/held document (or its segments), with its
   original in `.sf_separated_originals/`; nothing vanishes.
4. **No separation error / crash** — no `[watch] separation failed`, no non-zero batch exit.
5. **Held-then-correct** — the held segments, when reviewed, carry the RIGHT fields (the boundary produced a
   coherent document), and File-All routes them correctly.
6. **Stability debounce intact** — a still-being-written file is never split.

---

## THE GATE

### Step 0 — pre-check (automated, run anytime)
```
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/watch/test_watch_separation.js   # 17 → ALL PASS
node stress_test/import_watch_parity.js is unrelated; the relevant unit gate is the one above.
```
Must be green before a soak starts.

### Step 1 — arm the soak (owner machine, isolated)
- Use a SANDBOX/COPY watch folder + output root, never the live Desktop originals (owner standing rule).
- Turn the flag ON: SFDEV toggle, or `settings` row `watch_separate_enabled = 'true'`. Confirm
  `auto_separate_enabled` is ON (the heuristic arm needs it + taught templates) — a zero-template install
  with the heuristic off will separate NOTHING (that is a correct no-op, not a pass).
- Note the log path: `%APPDATA%\ScanFinder\processing.log`.

### Step 2 — feed it (a controlled set + then organic)
- **Controlled:** the known bundled PDFs (e.g. the Demo Docs "Print Tracker" bundle the manual path already
  splits into 27 `4_split_pN.pdf`) plus 3–5 genuine multi-page SINGLE docs (the over-split control) and a
  couple of separator-sheet bundles (the consumed control). Drop them into the watch folder a few at a time
  AND all at once (the concurrent-arrival case). Confirm each expected split appears in Review as held
  segments, and each genuine single doc is NOT over-split.
- **Organic soak:** leave the flag ON over a normal working day / overnight of real inbound scans.

### Step 3 — measure (automated)
```
node stress_test/watch_separate_soak.js --watch-folder <sandbox watch folder>
```
Reads `processing.log`, reports the tally, and returns:
- **PASS (rc 0)** — ≥1 real separation AND 0 re-import loops AND 0 separation errors AND 0 non-zero batch
  exits AND 0 orphaned split-originals.
- **FAIL (rc 1)** — any hard failure above (with the offending names/lines).
- **INCONCLUSIVE (rc 2)** — no separations seen yet; keep soaking or feed a known bundle.

### Step 4 — human boundary + held-review check (the part no tool can do)
For the controlled bundles: open the held segments in Review and confirm the boundary is right and each
segment's fields are coherent (a straddled boundary shows as a segment with mixed/garbled roles). Spot-check
that File-All files them to the right folders. THIS is the wrong-boundary risk axis (#1/#5) — the analyzer
proves no loop/loss/crash, but a human confirms the split is semantically correct.

### PASS criteria for the FLIP
- Step 0 green · Step 3 **PASS** over a soak with a meaningful separation count (≥ ~10 real bundles across
  the controlled + organic set) · Step 4 human check: every controlled bundle split at the right boundary,
  0 genuine single docs over-split, 0 misfiled on File-All.
- Then the owner's call (a live flip is approval-class). Flip = `watch_separate_enabled = 'true'` default /
  the settings default; keep the SFDEV kill-switch.

### Rollback
Flip is a single setting. If a post-flip issue appears, set `watch_separate_enabled = 'false'` — the watch
path returns to importing bundles whole (the current shipped behaviour). No data migration; segments already
produced stay as normal documents.

---

## Notes / seams
- The literal watch/import spawn code-merge is DONE (`buildWorkerCommand`, steps 1+2, 2026-09-02) so the
  per-doc READS are already identical by arrival path; this gate is only about the SEPARATION pre-pass.
- The separator is confidence-based and fail-safe: a normal multi-page invoice (or any detector/splitter
  error/timeout) yields ONE segment and nothing changes — so the dominant failure mode to watch is
  OVER-split of a genuine single doc, not under-split (which is just today's behaviour).
- Artefacts: analyzer `stress_test/watch_separate_soak.js`; pin `src/modules/watch/test_watch_separation.js`;
  build `29adce2`. This gate is queued in `NIGHT_RUN.md` and `pendingfeatures.md`.
