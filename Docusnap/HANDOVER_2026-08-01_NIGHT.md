# HANDOVER 2026-08-01 NIGHT (evening session; follows HANDOVER_2026-08-01_DAY.md)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `8d66041`, PUSHED, tree clean**
(only the long-standing untracked leftovers). **Installer still `5b5d344`** — now predates FOUR
sessions. **Dev app**: running from my `SCOPE_SWEEP=1 npm start -- --remote-debugging-port=9222`
launch (CDP 9222 open for the Chris driver; sweep armed via env, setting still OFF). Live DB
backups from the day's `--apply` runs still beside `%APPDATA%\ScanFinder\docusnap.db`.

## NEXT SESSION — AGREED ORDER (owner-set)
1. **Chris's cards first** (owner will vet which of 1-6 to implement; triage table in this
   handover below — nothing implemented yet, owner rule).
2. **Then the label-tail crop CLAMP** (Oracle SIGNED W/COND, build-ready dark —
   `pendingfeatures.md` "Label-tail crop CLAMP" carries C1-C7 + G1-G6 verbatim; 007's geometry
   evidence in `stress_test/out/stroke_sub_2026-08-01/` + scratchpad refs in the oracle_log entry).
3. Still owner-pending from the day: eyeball the 3 GT-poison exhibits
   (`stress_test/out/stroke_sub_2026-08-01/zooms/doc{86,154,285}_600_wide.png`) → Learning Repair
   (de-confirm → correct to printed value → re-confirm) — removes 3 phantom M rows.
4. Catch-up slice 4 (fixture integration + demo-corpus gates → flip `scope_sweep_enabled`).

## TL;DR of the evening
Owner-present marathon. Shipped, all gated/killed: **D1 in-band digit-disagreement flag** (census
0.00% false → built ON same day; realdoc diff = exactly #291 silent→flagged) · **D2 second-render
witness REFUTED by its own bake-off** (banked with revival bars) · **blank-supplier live fill
fixed end-to-end** (3 commits — the owner's Saltmarsh 18-doc batch now pill-fills) · **stale-note
display supersede** · **Catch-up Filing slice 3** (accept/undo + consent bar, dark) · **Chris The
Customer** advisor + skill + working Playwright/CDP driver, round 1 done (100% citation accuracy,
found a real grammar bug) · **007+Oracle root-caused the label-bleed crop class** (fix signed,
unbuilt). Corpus at wrap: ~380+ confirmed docs (Thornbury + Saltmarsh batches in), queue ~2.

## COMMITTED tonight (all pushed)
- `47af13c` docs: stroke investigation + Oracle verdict (D1 signed, D2 re-specced, D3 rejected,
  #86/#154/#285 reclassified GT-POISON — both Oracle AND main session eyeballed the exhibits).
- `cbad903` docs: third live exemplar (worksheet_01 trailing-digit inline drop; S-B caught live).
- `8c4ddea` **D1 digit-disagreement flag ON** (kill `DIGIT_DISAGREE_FLAG`): comparator
  `suffix_reconcile.digit_substitution_diff` SHARED with future D2 (one impl, one pin);
  census `stress_test/census_digit_disagree.js` (Oracle-mandated: 300 docs, 1 fire = the #291
  true catch, 0.00% false vs ≤3% bar); 31 pins `python_backend/tests/test_digit_disagree.py`;
  realdoc OFF-vs-ON = exactly #291 flagged, would-auto-file-wrong 9→8, values byte-identical.
  LAST in the pinned note chain; ref-role only; flag-only (C3: substitutions never adopt).
- `ee7c8b8` docs: **D2 BANKED** — bake-off ×2 (234 then 296 Tier-A docs, single-token + line-join
  harvests): 400→1100 ZERO correct catches @~3% false; 600→1100 ONE catch (#65) @1.3-1.7% false =
  5:1 false:true. 283/299 abstains are chain-level. Revival: ≥2-of-3 catch at ≤1% false.
  Artifacts `stress_test/out/stroke_sub_2026-08-01/bakeoff_d2*`.
- `ac96929` **blank-supplier live fill part 1**: the 930842e unpin expected engine Stage-0 to
  re-choose imageless — DEAD (Oracle C1 skips live Stage-0 with no image). Fix at the caller:
  `identifyByFingerprint` for unpinned blank docs, `admitReextractPick` admits the pick ONLY when
  it differs from the stale stored id (anti-recollision preserved, pinned). Engine known-id
  honour path then seeds template_identity@70 + 'Company inferred' note.
- `30fb97c` **part 2**: bb-exception now cracks the anchor-abstain wall (every confirm writes an
  authoritative supplier_name anchor → the wall killed the exception's ONE target case by
  construction; the branding-note marker can never sit on an intentional anchored empty — pinned
  both ways) + marker widened to BOTH veto copies /(confirm|set) the correct company/ (6 of 17
  live docs had the 'set' copy — the cea79ef one-copy-matcher lesson again). Verified on live
  rows: docs 386 + 383 both produce the suggestion through the real merge + real anchored keys.
- `5f1bc80` **display supersede**: stale field flag hides while a ⟳ suggestion is showing
  (display-only; DB note untouched; Confirm still the real clear — Oracle display-only precedent).
- `78d2fc5` **Catch-up Filing SLICE 3** (dark behind `scope_sweep_enabled` OFF + env
  `SCOPE_SWEEP`): `sweep-scope-accept` (server re-validates status/scope/workflow + candidacy
  FINGERPRINT + re-runs `_evaluateSweepDoc`, then files through the ONE shared
  `reviewService.confirm` with INTERNAL `{via:'scope_sweep'}` — 4th arg, never payload-suppliable;
  claim stamps `confirmed_via`; machine confirms SKIP saveCorrections) · `sweep-scope-undo`
  (server-verified via; deconfirm clears it; filed copies kept for in-place re-file) ·
  `#sweep-consent-bar` offer/filing/done + per-doc untick + Review-them filter + Undo all +
  kept-back reason chips · triggers: single confirm / prefix-ack / File-All dominant scope ·
  audits offered/accepted/undone. PINs `database/modules/test_confirmed_via.js` + all seam suites.
  **Branding-blank docs are STRUCTURALLY outside candidacy** (blank supplier + veto note fail the
  signed predicate) — heal via pills/reprocess first, then the sweep offers the batch.
- `b357a30` **Chris The Customer** (`.claude/agents/chris-the-customer.md` — registers as a named
  agent from next session) + `customer-experience-review` skill (barry's 12 heuristics + 8-task
  battery; bob's card format + tripwires + calibration ladder). Suggestions NEVER change code
  without owner vet.
- `8d66041` docs: label-tail clamp verdict (oracle_log + pendingfeatures build-ready entry).

## Chris round 1 — TRIAGE TABLE (owner to vet; NOTHING implemented)
Citation accuracy 100% (both checkable strings verified in code; grammar bug REAL:
renderer.js:2567 `Cleared ${n} field${s} that were…` → "Cleared 1 field that were").
1. **FORWARD (top)** — Accept button under the S-B two-values note names neither value; his fix:
   two labelled buttons "Use WS-73541" / "Keep WS-7354" (strengthens explicit consent).
2. **FORWARD + parked-partial** — "Teaching this field (⊕) usually fixes it for good" contradicts
   the teach panel's "only if it's showing the wrong value". Copy reconcile; the clamp kills the
   underlying class anyway.
3. **FORWARD, half-done** — the rescue's three voices: stale-note voice FIXED (`5f1bc80`);
   remaining = `Low · 0%` badge beside a filled suggestion, `High · 87%` beside "Not found",
   + the toast grammar bug (renderer.js:2567).
4. **FORWARD as one copy pass** — jargon: "cached-text re-read", "auto-committed", the
   ID/Extraction chips ("Recognised by: its logo and wording"). Owner should wordsmith.
5. **FORWARD (QUESTION)** — "97% · checked by you" (renderer.js:2076) vs field "High · 85%":
   unlabelled numbers; cue needs a label or plain words.
6. **FORWARD light** — warning fatigue: roll identical twin flags together; dots need a
   hover-word; per-row identical % = wallpaper.
7. **PARK** — the "usually printed at the top" irony; branding-primary work changes this class.
Discarded: none; zero tripwire violations. Round-1 calibration: strong; one more retrospective
round before widening scope (bob's ladder).

## Verification state (honest)
- D1: census + 31 pins + realdoc OFF/ON diff — all exactly as specified. D2: two independent
  bake-offs agree; no build.
- Live-fill fixes: verified against the live DB rows (docs 386/383 through the real merge with
  real anchored keys) + owner confirmed working in-app (36 auto-committed, queue 18→2).
- Catch-up slice 3: unit pins + parse/load smokes + seam suites green. NOT yet: the slice-4
  fixture integration + demo-corpus gates — flip stays OFF until they run.
- Clamp: designed + signed only. NOT built. 007's geometry artifacts preserved (scratchpad is
  session-mortal — geom_300.json etc. under the CURRENT session scratchpad; the durable copies
  of the stroke-sub evidence live in `stress_test/out/stroke_sub_2026-08-01/`; the clamp's
  geometry evidence should be re-derived or copied early next session if needed —
  `pendingfeatures.md` carries the full design + conditions regardless).
- Chris driver: `scratchpad/chris-driver/` (playwright-core + probe.js) — session-mortal; recipe
  = `npm start -- --remote-debugging-port=9222` + `chromium.connectOverCDP('http://localhost:9222')`
  (documented in the agent file).

## KEY SWITCHES tonight (all default ON unless stated)
`DIGIT_DISAGREE_FLAG` ON · `REEXTRACT_BLANK_REIDENTIFY` ON · `ANCHOR_LABEL_LEFT_CLAMP` NOT BUILT
(will default OFF) · `scope_sweep_enabled` setting OFF (env `SCOPE_SWEEP=1` = trial lever, armed
in the currently-running app only).

## GOTCHAS reinforced tonight
- The stale-main-process trap bit AGAIN (thrice): renderer/main JS fixes need app restart;
  renderer-only changes need only the WINDOW reopened; python is fresh per spawn.
- The Edit tool wrote a NUL byte into renderer.js once (grep went "binary file") — python
  byte-surgery fixed it; if grep suddenly reports a source file as binary, scan for \x00.
- `documents` table has NO updated_at column (use confirmed_at).
- realdoc GT-override rows can be identity-mismatched (⚠ skips in the report) — stale entries.
