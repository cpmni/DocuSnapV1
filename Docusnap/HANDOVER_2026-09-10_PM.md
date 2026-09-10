# HANDOVER 2026-09-10 PM — auto-file arcs shipped DARK + the LIVE auto-file-friction root cause (the next task)

Cold-start for the next session. Branch `feat/teach-side-overnight`, **pushed** through `a1ebf0d`.

## 1. What shipped this session (all DARK, committed + PUSHED, in the -TEST build)
Owner loop: "as many RELIABLE autofiles as possible — reliable clean slices." Everything below is gary/007/(oscar/reggie) → **Oracle-gated**, seed OFF, byte-identical off, in `TEST_SWITCH_KEYS` (**37 keys**), flip owner-gated.

- **`f89fb63` SFDEV trace → foreground doc only.** The in-Review SFDEV console flooded with background OCR; `routeTrace(msg, toReview)` now forwards to the console only for the foreground single-doc reprocess (`traceWantedBg` vs `traceWanted`).
- **mig 151 `template_edge_clip_heal`** (`3188445`/`7a74d1e`/`ec76fb9`; `docs/designs/EDGE_CLIP_HEAL_2026-09-10.md`, Oracle C1-C7). 007's placement-certified taught-box edge-clip CODE recovery: a skewed sibling's composed box severs one edge glyph (`YN-38626`↔`DN-38626`); adopt the recovered code **capped 87** when `_snap_union_witness` certifies the un-cut edge + slot-fill (NOT OCR confidence). trust.js C5: 88-floor relax needs `_corrobLicensedKeyword`. NAME half deferred (needs `_read_pad_window_name` + a name witness). Pin `test_edge_clip_heal.py`.
- **mig 152 `role_disagree_refuse_at100`** (`bfbac84`; the DATE_LEFT_CLIP_M2 fix, Oracle C6/C7). The M=2 silent wrong-date auto-file (Copperfield #77/#78): a page-family role disagreement is now refused at `overall==100` too (a new `docTrustGate` `roleDisagreeOnly` mode — reuses its setup, runs ONLY the `_pageFamilyDisagrees` leg, not the over-blocking full at100 gate). Pin `test_role_disagree_refuse_at100.js` (incl. an OFF pin documenting the live misfile).
- **mig 153 `template_taught_corrob_adopt`** (`7c86874`/`2ffbecd`; `docs/designs/TAUGHT_CORROB_ADOPT_2026-09-10.md`, Oracle SIGN-OFF-W/COND C1-C4 + G1-G3). The owner's "2 reads agree → adopt." The MIRROR of the class `_universal_postmerge_verify` excludes: a Stage-0.5 taught winner that raised a `_padcodeflag` (self-declared clip) whose pad recovery the **independent keyword** family corroborates → ADOPT. **PHASE 1 = review-bound** (cap 87 + softened note; the RIGHT value shown + one confirm). Guardrail: `"keyword" in slot['fams']` (never two box-crops) + a **C1 positional guard** (keyword witness on the taught row — neighbour-bleed close) + `_uv_restore_demotion`. Part A (`_pad_witness` stash, template_mapper FLAG branch) + Part B (`_taught_flag_corrob_adopt`, engine.py before `_build_corroboration_emit`, folded into the recompute guard). trust.js C5 extended to `_corrobadopt`. Pin `test_taught_corrob_adopt.py`. **Exhibit: Thornbury `delivery_docket_10` — `IN-64470`→`DN-64472`.** PHASE 2 (@90 auto-file) is census-gated.
- **`a1ebf0d` sweep auto-proceed countdown** (renderer). Oracle direction "suppress the click, keep the signal": the "File up to N" offer for a VIEWED eligible doc becomes "✓ File N now · Xs" (6 s), auto-clicking file on expiry; gated on `scope_sweep_auto_accept`, HOLDS while a field editor is focused, ANY bar click cancels it. Reuses the existing accept path.

**-TEST installer:** `dist/ScanFinder Setup 2.0.0-r20260910-1410-a1ebf0d-TEST.exe` (signed, 37 DARK keys). Owner INSTALLED it. **Verified LIVE on the owner's DB: max mig 153, 37/37 armed** (edge-clip/M2/taught-corrob all `true`; `scope_sweep_*` + `teach_angle_compose_scan` + `trust_role_disagreement_refuse` on).

**Chris vet** `docs/CHRIS_FULL_APP_REVIEW_2026-09-10.md` (verdict YES; M2 belt worked in-experience). Top card: the graduated-scope HELD-doc summary says "a formatting check" for a straightening re-read / name flag (wording).

## 2. ⭐ THE NEXT TASK — the LIVE auto-file friction, root-caused (do this first)
Owner ran **Reprocess-all → nothing auto-filed**; the app had told them (post-teach) "files after 2 more confirms," they did it, it didn't file. Root-caused end-to-end on the live DB (`%APPDATA%\ScanFinder`, Thornbury **invoice** scope):

- **Reprocess is review-bound by design** (never silently files — the 08-12 101-doc wrong-supplier incident); it only OFFERS eligible docs. 0 of 20 were eligible.
- The 20 held docs are Thornbury **invoices**; block reason **`unverifiable-value:invoice_number`** (later; `supplier_name` earlier). Values are CORRECT + note-free (`INV-45152` @98).
- **THE BUG:** confirmed invoice numbers are `INV-71940` · `INV-71940` · `INV-50540` = **3 confirmed docs but only 2 DISTINCT** (a duplicate/misread). With ≤2 distinct, the format classifies `invoice_number` as **'constant'** (a fixed field), and `docTrustGate` then **refuses every genuinely-new invoice number** (`valueMatchesShape` fails — the new value isn't one of the 2 constants). A **variable ref field mistaken for a fixed one.**
- **Compounded:** `invoice_number` field TYPE = **`text`** (not `reference_code`), so it can ONLY verify by confirmed history (no shape pattern to check). A `reference_code` type would verify `INV-#####` on sight.
- **The broken promise:** `src/services/teachFollowup.js` counts each role's `confirmed_count` toward `FORMAT_SOLID_MIN=3` (`learning.js:846`), but `confirmed_count` is TOTAL (not deduped, `learning.js:1746`) while the gate needs ≥3 DISTINCT → they diverge on a duplicate ref. teachFollowup's C2 even warns about the 'constant' trap but promised anyway (it judged queued-sibling distinct refs before the duplicate landed).
- **`graduation_window = 5`** on this install (I mis-said 10 to the owner — corrected). Scope at confirmedCount 3, need 2 more — but graduation isn't the real blocker; the 'constant' shape-refusal is.

**THE FIX to spec (advisor + Oracle — this is the owner's #1 unlock):**
1. A **REF ROLE** (ref_field_key: invoice/PO/SO number) must verify a new value by its confirmed **SHAPE** (`INV-#####`), **never** as constant-value membership — these are variable by nature and must never classify 'constant'/refuse-new. (Likely in `trust.js` docTrustGate ~1010-1044 + the format classifier; a ref role skips the constant gate, verifies by shape / `_matchesTypePattern`.)
2. Align `teachFollowup.js`'s promise to the DISTINCT-shape reality (don't promise when the refs would classify 'constant'; count distinct, account for the gate).
3. Check whether `invoice_number` type=`text` is the built-in Invoice preset default (→ every install hits this) — if so, fix the preset/seed to `reference_code`, or make the gate treat a ref role as shape-verified regardless of the field's stored type.
Immediate owner workaround offered: Learning-Repair the duplicate `INV-71940`, and/or retype `invoice_number`→`reference_code` in Settings as a live test.

**Teach vs gate (owner asked):** the doc WAS taught (supplier `template_fixed`; #174 invoice_number via `template_mapping_edgegrow`). Teaching lands WHERE to read; the taught LABEL also feeds the keyword layer (hence `keyword_override` reads) — reading works (`INV-45152` @98). The hold is purely the auto-file VERIFICATION gate, not the teach/read.

## 3. Flip gates still owed (before any customer default)
- **edge-clip heal (151):** realdoc M=0 + fire census (every adopt==page truth) + adversarial same-shape-neighbour set; arm chain `template_pad_window_code` + `_labelled` + `template_edge_clip_heal`.
- **taught-corrob-adopt (153) Phase 2:** raise cap 87→90 + `docs/designs/TAUGHT_CORROB_ADOPT_2026-09-10.md` G1-G3 — realdoc M=0 + the direct integration fixture INCLUDING the adversarial same-shape-neighbour census (must NOT adopt).
- **M2 belt (152):** realdoc `wouldAutoFile(ON) ⊆ wouldAutoFile(OFF)` + M=0.
- **sweep countdown / `scope_sweep_auto_accept` customer-default:** owner validates the cadence, then a @DEFAULT_FLIP mig (it's already default-on via mig 80 — the countdown just changes the viewed-doc UX).

## 4. Gotchas discovered this session
- **WAL read trap:** a plain file-copy of `%APPDATA%\ScanFinder\docusnap.db` MISSES the boot migration sitting in the uncheckpointed `-wal`. Copy `docusnap.db` + `-wal` + `-shm` together (or use `db.backup()`). First read showed mig 152 falsely; with the WAL it was 153.
- **`learning.getFieldFormats(db)` returns an ARRAY** of format objects (`.find(x=>x.field_key===...)`), NOT a string-keyed object — my `Object.keys().filter()` gave a false "0 formats."
- The classifier BLOCKS a direct script write to the LIVE `%APPDATA%\ScanFinder\docusnap.db` (and `git push`) — the owner runs those (`! git push …`); the installed **-TEST build self-arms** on launch (no hand-write needed).
- `graduation_window = 5` on this install (not the assumed 10).
- Pre-existing unrelated red: `src/windows/review/test_activity_strip.js` "card 8 / Search send-back door" — fails on HEAD independent of this session.

## 5. Where things are
Docs: `docs/designs/{EDGE_CLIP_HEAL,TAUGHT_CORROB_ADOPT,DATE_LEFT_CLIP_M2}_2026-09-*.md`, `docs/oracle_log.md` (4 new 2026-09-10 verdicts). Pins: `test_edge_clip_heal.py`, `test_taught_corrob_adopt.py`, `database/modules/test_role_disagree_refuse_at100.js`. Sandbox from the Chris run may still be at port 9223 (session-mortal).
