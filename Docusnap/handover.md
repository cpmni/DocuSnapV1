# HANDOVER — 2026-09-19 (day + autonomous night)

**Branch** `feat/teach-side-overnight`. **HEAD `48559c0`.** Origin at **`39456fe`** — the last **2 commits
(`70c94b8` test fixes, `48559c0` night ledger) are UNPUSHED** (push is the owner's call; the flips were pushed
under the owner's explicit "Push" earlier). Migration **190** (was 185 at session start). `node scripts/run-pins.js`:
**397 green, 1 red** = the EXPECTED `check-release-migrations` departments-in-TEST-build gate (not a bug).

## Installers (built this session, for the owner's VM)
- **Core (TEST, all switches armed):** `dist\ScanFinder Setup 2.0.0-r20260919-1819-6c9d31c-TEST.exe`
- **Client:** `client\dist\ScanFinder Search Client Setup 1.0.2-r20260919-1821-6c9d31c.exe`
Both at HEAD `6c9d31c` (carry the Castellan fix + thumbnails + everything below). SmartScreen → "Run anyway".

## What shipped this session (newest first)
1. **`48559c0`/`70c94b8`** night ledger + the 4 graduated-switch mig-pin updates + `role_dominant` isolation.
2. **`39456fe`/`6245e42` — FOUR flip-census graduations to customer defaults** (migs 187-190, all `@DEFAULT_FLIP`
   UPSERT-true, delisted, pinned `test_default_flip_187_188.js`/`_189_190.js`): **154 `trust_ref_role_shape`**,
   **157 `template_drift_override_guard`**, **158 `note_topic_dedup`**, **130 `reread_hold_corrob_release`**. Census
   `TESTING/_measure/flip_census_20260919/RESULT.md` (400-doc corpus, M=0 all; 154/157 live-proven, 158/130 byte-
   identical). **HELD: `confusion_precedence`** (value-changing, zero corpus evidence). TEST_SWITCH_KEYS → 45.
3. **`6c9d31c` — Castellan Slice 1, mig 186 DARK `taught_ref_disagree_suppress`** (gary → Oracle SIGN-OFF-W/COND):
   a taught Stage-0.5 ref winner that MATCHES the scope's learned shape suppresses a DIFFERENT-shape generic-caption
   competitor ("Job Ref" vs the taught "Job Sheet No") → the worksheet files by graduation after ONE confirm instead
   of being held forever. Engine `_suppress_taught_ref_disagree_record` + a trust.js `_corrobLicensed` guard on the
   `suppressed_taught_role` key (no laundered auto-file). Pins: `test_taught_ref_disagree_suppress.py`/`.js`. Design
   `docs/designs/TAUGHT_REF_DISAGREE_SUPPRESS_2026-09-19.md`. **DARK — armed in the TEST build; flip is owner's call.**
4. **`d92f7c4` — client thumbnails fix**: the lazy-thumbnail IntersectionObserver rooted on the VIEWPORT, so in a
   non-maximised window rows below the fold were never requested (the owner's "only render on full-screen"). Now roots
   on `#results-scroll`. Shared search-ui source + synced client copy.
5. **`14581c7` — Quick Reprocess taught-field keep**: an imageless reprocess BLANKED a taught template_mapping field
   (the annotated-empty branch of `mergeReprocessRows`). Now keeps the stored value + contests. (gary → Oracle W/COND).
6. **`e3849f5` — child-window keyboard focus at reveal**: a FORCE_MAXIMIZE window (Settings/Review/Teach/Search) got
   no OS keyboard focus (maximize "shows but doesn't focus"), so a clicked input showed no caret until the window was
   re-activated. One-shot focus pair at reveal (eric-vetted).
7. **`365258f`/`318db66` — departments UI**: the "All departments" toggle no longer wraps (switch + label flex
   siblings); the **Rename department** button now works (was native `window.prompt()`, which Electron doesn't
   implement → replaced with an in-app input dialog).
8. **`2e50669` — build/test hygiene**: `pdf_join.py` (C12 Rejoin) added to the packaging compile gate (real gap); two
   review wiring pins de-brittled (dept-gate insertions had pushed real lines past hardcoded char-windows).
9. **Licensing backend (PHP, NOT yet deployed — see `BEFORE_RELEASE.md`):** `1d4ba4a` Cloudflare real-client-IP fix
   for the rate limiter + `audit_events` (Oracle W/COND; ordered deploy: `ratelimit.php` then `db.php`); `b4755a3`
   customer-per-IP column on the admin API-activity page (+ later `6ad74d8` REMOVED the ipinfo.io geo link at the
   owner's request — no third-party IP disclosure). Privacy draft `docs/PRIVACY_IP_LOGGING_DRAFT.md`.

## ⏭ NEEDS THE OWNER (morning approval queue)
1. **Push** the 2 local commits (`70c94b8`, `48559c0`).
2. **Verify the TEST installers on the VM** — the Castellan hold now files (confirm ONE worksheet → the rest release)
   + client thumbnails load without full-screen.
3. **Deploy the 3 licensing-server changes** (`BEFORE_RELEASE.md`, no DB change): CF real-IP fix (ordered upload),
   the API-activity page (`api_activity.php`), the "New account" admin feature.
4. **Castellan Slice 2 — REFRAME (Oracle SEND BACK).** The owner's "first worksheet files with zero confirms" is NOT
   achievable via caption suppression: at genuine cold-start the FIRST doc of a newly-taught supplier is held by
   `docTrustGate`'s **no-history refusal** (`unverifiable-value` — a deliberate safety: a first-seen scope with no
   confirmed history should hold, else a wrong teach auto-files). Slice 1 already delivers "one confirm releases the
   batch." **Product truth to discuss:** the first doc from a new supplier SHOULD hold for a check; from the second on
   it files. If the owner still wants it, the lever is the no-history/graduation gate (page-wide, approval-class), not
   the caption rule — needs its own design. Slice 2b (a persisted exclusion table) stays deferred.
5. **`trust_ref_role_shape` × `role_field_dominant_class` interaction** (found tonight, pinned): together they're
   STRICTER on an outlier-collapsed ref scope (the `$`-outlier scope's clean sibling HOLDS for review instead of
   filing). Safe (fail-toward-review; would-file unchanged on the corpus). Design Q: should shape-verify defer to
   role-dominant there, or is holding correct?
6. **Flip candidates:** Slice 1 (mig 186) once VM-verified; the corpus is exhausted for the rest (safety-only) — further
   flips need live evidence. The DB-hardening decision (09-15) + Chris `/christest` + departments D7 live-test remain.

## Key facts / gotchas
- The corpus flip-census is EXHAUSTED for the remaining dark switches (they only fire on real-world shapes the 605/700
  synthetic corpus lacks) — the census proves SAFETY (M=0), not value. Further flips = live-evidence driven.
- Census tooling: `TESTING/_measure/flip_census_20260919/` (setup.js migrates a corpus copy + builds rr_ids;
  census_run.sh / census_run2.sh; compare.js). Baseline MUST be `RR_APP_ENV=1`; the switch lever is SHELL ENV.
- Memory pressure killed a background census once tonight (VMs were open); the VMs are closed now. Chris (a live app
  instance) was DEFERRED to a morning `/christest` rather than risk an unbabysitted OOM.
