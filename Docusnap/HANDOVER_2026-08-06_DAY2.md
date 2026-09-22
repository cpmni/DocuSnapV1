# HANDOVER — 2026-08-06 DAY2 (taught-read fix marathon: 4 owner-flippable fixes + 1 shelved + root-cause design)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `8ddbc80`** · 7 commits this session,
**LOCAL / NOT PUSHED** · installer unchanged · **2 files uncommitted (both PRE-EXISTING, not this session)**.
**Continues** `HANDOVER_2026-08-06_NIGHT.md`. Owner drove live via the running app (Kyle Test corpus).

---

## TL;DR
Owner reprocessed real Larkspur docs and surfaced one taught-read failure per screenshot; each was
root-caused (verify-at-source) and fixed through the full advisor→Oracle→gate loop. **4 fixes shipped
DARK + owner-flippable, 1 shelved net-negative, 1 root-cause design captured for a fresh session.** Every
fix is default-OFF + byte-identical off; each has an env bridge (`processing/handler.js _reconcileEnv`) +
a Settings→Processing toggle. The app must be RESTARTED for the bridges to load (main-JS).

## Committed this session (7 commits, LOCAL — push when ready)
1. **`55a41b1` teach-commit sample-angle enabler** — `generateSampleAngle` (templates/handler.js) wired at
   promote/link/graduation/captureSample. SMOKED green (real `detect_angle.py` spawn via ctx.pythonExe()
   FUNCTION, angle written, log line, idempotent). Inert unless `teach_angle_compose` on.
2. **`80663ab` snap-union geometry witness — SHELVED DARK.** Built to Oracle SIGN-OFF-W/COND (007's
   un-cut-edge anchor), 15/15 pins. **NF gate NET-NEGATIVE (ref −1, account_no −1, 0 gains)** — geometry
   can't tell "grow recovered the clipped true value" from "box on wrong field, both tiers agree wrong."
   Switch `TEMPLATE_SNAP_UNION_WITNESS` default OFF. Kept for the Stage-2 clean-upgrade idea; NOT flipped.
3. **`142ab79` edge-cut → label-relocate (placement fix).** delivery_number `VIN-O0U5D`: a taught box
   seated ~0.01 off clips → garble; the horizontal edge-guard grow can't fix a VERTICAL clip. When the
   guard can't clean-heal a cut, re-seat off the LOCAL located label + word-snap (`_relocate_and_read`),
   FLAGGED pre-fill. Oracle SIGN-OFF-W/COND (Rule A local-only; never silent clean; co-requires
   TARGET_WORD_SNAP). Switch `template_edge_cut_relocate`. **NF gate +1/0** (po_ref Ironclad delivery_note
   heal). 15/15 pins. Exact doc_06 heal OWNER-WATCHED (standalone harness can't bit-reproduce the misread).
4. **`bbf35a3` C2a trailing-glyph slack.** worksheet_12 `WS-14939` read CORRECTLY but false-flagged
   "differs from usual format" — the abs box misread the trailing glyph (`WS-1493S`@44), the inline read
   recovered `WS-14939`@91 (shape-confirmed, double-witnessed), but C2a demanded a byte-exact prefix. Now a
   length-preserving 1-trailing-glyph slack (conf MARGIN, shared-prefix floor, legs ii+iv+v gate). Switch
   `template_clip_commit_edge_slack`. **NF 0/0** (inert on corpus — the class isn't there); ISOLATED
   worksheet_12 pin (edge-guard OFF) PASS: `@70 shapewarn → @95 clean`. 10 unit pins.
5. **`11aa400` invalid-date-yields.** invoice_08 `33/04/2026` (impossible, day 33 — a tilt misread of
   `03/04/2026`) won the merge over valid keyword `03/04/2026`. Now an unparseable+unsalvageable taught
   date yields to a valid ≥90-conf keyword date, FLAGGED. Switch `template_date_invalid_yield`. **NF +1/0**
   (Castellan PO date, wrong→correct). 13 pins → then extended (see #6).
6. **`e1996bb` future-date-yields (extends #5).** invoice_14 `15/10/2096` (a VALID date 70y future — year
   glyph-misread) won over valid keyword `15/10/2026`. Predicate now returns a REASON ('' / 'impossible' /
   'future'); 'future' fires > `_DATE_YIELD_FUTURE_DAYS`=1096 (~3y, its OWN constant — a swap is more
   destructive than the 366-day flag) with kw not >366d future. New sub-switch `template_date_future_yield`.
   Shared clock via `validator.days_in_future(value, now)`. **NF +1/0** (future arm INERT on corpus; the
   +1 is #5's Castellan heal preserved). 22 unit pins.
7. **`8ddbc80` DATE-CROP DESKEW-READ design (docs only).** Root of the whole date-crop misread class,
   PROVEN empirically (see FIRST ACTIONS). Design captured, owner chose fresh-session build.

## Verification state — HONEST
- All NF gates: `stress_test/customer_corpus_score.js` TEACH=1 SET=both SAMPLE=228 SEED=7 + shipped flags,
  OFF vs ON, reports `stress_test/out/customer_score_*.{md,jsonl}`. Read in full this session.
- **Corpus can't exercise every class.** Slack (#4) and future-yield (#6) are INERT on the Customer corpus
  (the exact classes are Larkspur/Kyle-specific) — proven safe (0 regressions, byte-identical) but their
  real heals are owner-watched. #3/#5 DID fire in the corpus (+1 each).
- **Standalone harness limitation (recurring):** it re-reads dates/codes CORRECTLY on some renders, so it
  can NOT bit-reproduce the app's tilt/glyph misreads (doc_06 gave ADIAOINNAL, inv08 read 03-04-2026
  clean). So the EXACT live heals (VIN-O0U5D→DN-58038, 33/04→03-04, 2096→2026) are **owner-watched**, not
  harness-proven. The mechanisms are proven by unit pins + isolated pins; the gates prove no-regression.
- Corrected mid-session: my first read of the invoice_08 trace (that keyword won) was WRONG — the clearer
  2nd screenshot showed template_mapping's invalid date WON (led to fix #5).
- Pins re-run green after every edit; existing date suites (precedence/hard-gate/future-only/clip-gate)
  and the mapper suites unaffected.

## FIRST ACTIONS (fresh session)
1. **Owner smoke the 4 flips** (see "Needs the USER"). Report which land clean; the exact heals are the
   real confirmation the harness couldn't give.
2. **Build the date-crop deskew-read root fix** — the charter is `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md`.
   PROVEN mechanism (`<scratchpad>/datecrop_probe.py`, filed invoice_08 `Invoice.03-04-2026.INV-13355.pdf`,
   skew 1.80°, GT 03/04/2026): tight taught box RAW psm7 = `NrAIMMAINNAC`; **RAW box+pad psm6 = `03/04/2026` ✓**;
   **DESK box+pad psm7 = `13/04/2026`** (0→1 misread). Deskew DEGRADES the 0.2–2° read; raw+pad+psm6 is
   clean. Fix = read-path angle floor / raw-preferring frame election for CROP reads, routed through
   `teach_angle_compose`'s level frame + the `deskewedNormToRaw` level→raw inverse (avoids the
   DESKEW_RAW_CROPS RED-gate placement trap) + a psm6+pad rung. Multi-slice; gate against M=0 + zero drop
   on customer/issuer/date (the RED-gate casualties). Build Slice 0 first (byte-identical).
3. **push** the 7 local commits if the owner wants them on the remote.

## Deferred / open (with load-bearing conditions)
- **Snap-union witness Stage-2** (pendingfeatures): the shelved `_snap_union_witness` is SOUND on a
  PLACEMENT-CORRECT re-seated box (not the grown box it net-negatived on) — clean-upgrades the flagged
  edge-cut-relocate heal. Own switch + own re-seat-frame gate. Do NOT un-shelve on the grown box.
- **Same-year / still-parses date misread** (03→08, order-flip): NOT caught by #5/#6 (parses) — it's the
  DATE-CROP READ fix's job (#8ddbc80 design), not another merge-layer guard.
- **Pure-vertical-inside-column clip** (pendingfeatures): edge-cut-relocate fires only on a horizontal cut;
  a pure-vertical seat clip needs a row-seat-mismatch sensor.

## Needs the USER
- Flip the 4 toggles (Settings → Processing, all default OFF): **Re-read a taught spot off its label when
  the box clips the value** (`template_edge_cut_relocate`) · **Don't flag a taught value when only its last
  character was misread** (`template_clip_commit_edge_slack`) · **Never file an impossible date over a valid
  one** (`template_date_invalid_yield`) · **Never file a wildly-future date over a valid one**
  (`template_date_future_yield`). **RESTART the app** (main-JS bridge), then reprocess. Expect: docket_06
  delivery_number `DN-58038`; worksheet_12 ref clean (not flagged); invoice_08 date `03-04-2026`; a 2096
  date → keyword date.

## Key facts / paths
- Live DB `C:\Users\cmccu\AppData\Roaming\ScanFinder\docusnap.db` (read-only queries via
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e '...'`). Working files in
  `…\ScanFinder\inbox\<docId>.pdf` — CONSUMED on confirm/file (docs re-file mid-session; use the filed
  `Kyle Test\Documents\…` copy for a stable source).
- Python tests: `py -3.12 python_backend/tests/<t>.py`. Delete `python_backend/**/__pycache__` if a Python
  edit "doesn't take" (bit twice this session). Debug prints in the mapper go to STDERR — the corpus scorer
  DISCARDS per-doc stderr; a scratch probe must forward it.
- New/updated flag switches (all default OFF, engine.py + template_mapper.py flag zones): env bridges in
  `src/modules/processing/handler.js` `_reconcileEnv`; UI toggles in `settings/renderer.js` (the `[id,key]`
  loop) + `settings/index.html`. Oracle log: `docs/oracle_log.md` (5 new entries this session).
- Advisors used heavily: gary (design+tests), reggie (comparator/date-predicate precision), 007
  (geometry/placement, run as general-purpose+persona — NOT a registered subagent_type), Oracle (final
  vet, caught the real seams every round: the note-is-sole-auto-file-block, the 94-floor-defeats-cap, the
  green-but-false pins).

## GOTCHAS reaffirmed
- Stale-main: main-JS commits (the env bridges) need a full app RESTART; the app re-files docs on confirm.
- The standalone reprocess harness can't bit-reproduce app tilt/glyph misreads (frame/OCR-context divergence).
- `_CLEAN_DATE_CONF`=94 floors a clean date's confidence → the merge `_CONFLICT_CAP`=88 is COSMETIC; the
  non-empty `validation_note` is the FLOOR-INDEPENDENT auto-file block (trust.js:466). Pin the DECISION,
  never `conf==88`.
