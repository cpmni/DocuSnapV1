# HANDOVER — 2026-08-22 EVENING (the round-14 vet queue → Chris 15 → Chris 16)

> Resume here. Previous: `HANDOVER_2026-08-22.md` (the overnight "teach 1 → import N → it files itself"
> arc, the afternoon two-line wordmark slice, Chris rounds 13/13b/14 — still the place for those
> details). Every Oracle verdict + gate is in `docs/oracle_log.md` (entries "Chris round 14 vet queue",
> "Q2 RE-RULE", and the BUILD + GATES / CHRIS 15 / CHRIS 16 notes under them). Chris's reports are
> verbatim in `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md` (rounds 13 → 16).

## State
- Branch `feat/teach-side-overnight`, **HEAD `ce3011f`, everything PUSHED, tree clean.**
- Commits tonight, in order: `00e0cc3` Q1 · `98ef004` Q4b/c/d · `07a6632` Q4a · `0d879f8` Q2 · `f67700b` docs ·
  `8c0f26b` template-file sync · `92b60b7` merge of `feat/q3-layout-reread` (`4be9330` Q3) · `fd50ee7` docs ·
  `3a4896f` mig 84 · `401ac48` CLAUDE.md · `5709a15` C3.3 scoping · `ce3011f` docs.
- Migrations: **83** (`documents.drained_at` + backfill; `keep_processed_originals` UPSERT ON everywhere),
  **84** (`fingerprint_seed_support_prune` INSERT OR IGNORE ON for NEW installs). Q3 (`quiet_reread_on_layout`)
  stays DARK.
- Suites at HEAD: JS **236 green / 3 red** — `test_authoritative_anchor` (documented), `test_v1_contract` (3 BAD)
  + `test_doctype_surface_parity` (1) — the last two were verified red at `2d25e87` BEFORE tonight (not ours;
  decide: fix or add to the documented list). Python 307 green + the documented `test_identity_fusion` + the 6
  pre-existing script-style reds, zero new. **Run script-style Python tests with `PYTHONIOENCODING=utf-8`** or
  52 of them "fail" on a cp1252 `→`.
- **Sandbox 16 is still running** (CDP 9223, PID 22824, admin `chris` / `plumbing2026!`, userData
  `<scratchpad>\chris-sandbox16\userData`). Kill it before the next `/christest` (it rebuilds on 9223).
- **Worktree to clean up:** `C:\GIT Projects\Docusnap-q3` (branch `feat/q3-layout-reread`, merged; has a
  `node_modules` junction) → `git -C "C:\GIT Projects" worktree remove Docusnap-q3` then delete the branch.
  The repo root is `C:\GIT Projects` (worktrees land at `<path>\Docusnap\…`).

## What shipped tonight (each behind its own switch)
| Item | Commit | Switch / mig | What it does |
|---|---|---|---|
| **Q1 keep the original** | `00e0cc3` | mig 83 `keep_processed_originals` ON everywhere; env `KEEP_PROCESSED_ORIGINALS`; `IMPORT_FILED_FOLDER_GUARD=0` | Filing MOVED the original: import drains it into `<source>/Processed`, the confirm-time `removeSourceFile` (pre-dates the drain) unlinked THAT file → Output was the only copy (Chris 14 card 1). ONE gate in `reviewService.confirm`: OFF = old removal; ON + drained → untouched; ON + not drained → drained now, never unlinked. `process-folder` refuses a folder that is the `folder_path` of ≥1 confirmed doc with "Import it anyway?". Wizard/help/Settings copy fixed; Files & filing toggle; purge dialogs append "Your original scans in the Processed folder are not touched." |
| **Q4b ONE review classifier** | `98ef004` | none (read-only) | `src/windows/shared/reviewReadiness.js` (flagged › noType › missing › ready, ack-exempt) behind `documents.getReviewSplit` AND File All's partition — Home's N == File All's N. Home headline "N senders file by themselves" = `scopeReadiness.isReady` (memo 10 s), graduation as sub-line. |
| **Q4c/Q4d bars + badge** | `98ef004` | none | `shared/offerPrune.js`: offers pruned to the live queue on every broadcast; a "nothing"/"auto-accept-running" answer retires a stale OFFER bar; no "Put back" under "Filed 0"; "Reprocess N" live; "were re-read just now" copy; readiness badge refreshed on any broadcast (a sent-back doc counts nowhere — it was a stale render). |
| **Q4a type nudge** | `07a6632` | `TYPE_NUDGE_ISSUER_EXCLUDE` (ON), `TYPE_NUDGE_L0` (ON after census; `=0` reverts) | The harvest skipped line 0 by position; on 17/22 DS scans the title IS line 0. Issuer READ never offered as a type (garble-tolerant token match); line 0 admissible with a known issuer. Census 221 docs: 0 correct lost / 40 wrong removed; L0 +16 correct / 0 new wrong. Card hides on type choice. |
| **Q2 seed support prune** | `0d879f8`, mig 84 `3a4896f` | `fingerprint_seed_support_prune` / `FINGERPRINT_SEED_SUPPORT` (ON new installs) | ROOT CAUSE of "the teach does nothing": a template born from ONE scan freezes that scan's fingerprint; three OCR-garble tokens capped every sibling at EXACTLY 0.70 < 0.75 (measured on `r14_copy.db`). `templates.pruneSeedFingerprint`: drop df=0 tokens; G1 issuer-protect; G2 reward licence (≥2 recovered held same-type docs, no name-disjoint non-prefill claim, AND each carries ≥0.6 of the pruned tokens in its OWN top-band fingerprint — the same-layout leg that stopped buyer-issued seeds being licensed by other suppliers' pages, cross hits 20→179 without it); floor; all-or-nothing half-cap. Both birth paths. Census: recall 98.9→100%, cross 6.98% unchanged. |
| **Q3 layout arm** | `4be9330` (merged `92b60b7`), fix `5709a15` | `quiet_reread_on_layout` / `QUIET_REREAD_ON_LAYOUT` — **DARK**; needs `template_identity_on_page` ON | An authoritative anchor / mapping WRITE that changed something schedules the lane with reason 'layout': held docs carrying one of the scope's OWNED templates AND the scope's name, minus S3-C5-noted docs; only for a judgeable scope name (≥2 name-arm tokens, JS mirror pinned to `_GENERIC_NAME_TOKENS`); a REQUIRED role field first-filled by the new box is HELD "Read from your new box — confirm once." unless page-corroborated — **keyed on the doc's selecting arm (`nd.via === 'layout'`), never the job's reasons** (`5709a15`); valued→empty merges as empty; reasons union on a running job; SEAM-1 engine comment rewritten. |
| **Template-file sync** | `8c0f26b` | `TEMPLATE_FILE_SYNC_ON_COMMIT=0` disables | `learnTemplateOnCommit` intersected fingerprints in the DB; the Python matcher reads the template FILE. Both callers now rewrite the file. Also: a `DOCUSNAP_USERDATA` sandbox now owns `<userData>/templates` — until now every Chris sandbox shared the repo's dev `templates/` folder with the owner's live app (rounds ≤15 carry that caveat). |

Dev-gated Settings toggles exist for every new switch (Processing tab, SFDEV). Pins: `test_keep_processed_originals.js`,
`shared/test_review_readiness.js`, `shared/test_offer_prune.js`, `tests/test_type_heading_nudge.py`,
`test_seed_support_prune.js`, `test_quiet_lane_layout.js`, `review/test_template_file_sync.js`.
Census scripts: `TESTING/_measure/q4a_census.py`, `q2_fingerprint_gap.js`, `q2_seed_hygiene_census.js`,
`q2_seed_prune_final_census.js`.

## Chris rounds tonight
- **Round 15 (Q1/Q4/Q2 armed): YES** — 57 filed, zero wrong folder/value. Teach from the worst DS scan →
  `fingerprint_seed_pruned kept 7 recovered 20` → teach-time re-read 19/19 (round 14: 0), 18 right values.
  Safety card closed (originals survive Put back → Delete → Empty bin; re-import refused with the right count).
  Home == File All at six moments.
- **Round 16 (Q3's own round): YES — "the best ⊕ I've had"** — fix one box, Confirm, quiet line by itself
  at 9 s (`layout_arm: selected:18`), 17 re-read, **all three wrong first-fills HELD** (incl. the neighbour-
  column "Your PO" value — the misfile path the Oracle named), S3-C5-noted doc left alone, generic-named DS
  skipped, six false alarms withdrawn on Ridgeway; 34 filed, 0 wrong folders.

## OPEN — owner vet queue (nothing built)
1. **The green badge over an already-read pile (Chris 15/16 card 1 — top).** Diagnosed on `r15_copy.db`:
   now that Q2 makes the teach-time re-read work, siblings bind BEFORE any confirm at overall 91–93; the
   ungraduated scope floor is 100; the 'ready' arm (and the graduation arm) only re-read TEMPLATE-LESS docs →
   nothing re-reads them with the learned formats → no `scope_sweep_offered` row at all → the pile waits for
   File All (which files them correctly). Saltmarsh filed because its 5th confirm GRADUATED (floor 95) and
   the graduation re-read gave oc100. **Direction: a READY-crossing re-read of TEMPLATE-CARRYING held docs
   whose `overall_confidence` < the scope floor (their read predates the learned formats) — Q3's guards
   (owned templates, on-page, judgeable name).** Needs the Oracle (it is the Q3 boundary again). Fallback:
   badge/DONE-card copy "new scans will file themselves — File All Ready for these N".
2. **The wizard accepts a number box drawn ON the label** ("Value: Invoice Number · Looks right →") and
   filed `Invoice.05-01-2026.Invoice-Number.pdf` (Chris 16 card 1). Direction: refuse a read equal to the
   field's label / any printed caption; no "Looks right"; never file a reference that equals a field name.
3. **Header-cut DS copies unmatched on re-import** (Chris 16 card 4, 22%, "Couldn't match"). NOT the
   round-15 file/DB divergence (the sync is in): the pruned seed legitimately keeps SERVICE/WORKSHEET (on
   16/21 siblings) → a header-cut copy scores 5/7 = 0.71 on the keyword arm; yet the teach-time lane read
   them correctly (bound by another arm — untraced). **Trace before designing:** `TESTING/_measure/trace_reprocess.js`
   on a copy of `chris-sandbox16\userData\docusnap.db` + its `userData\templates`. Also the import footer's
   "9 ready" vs Home/File All's 0 — the footer uses the pipeline flag, not the classifier.
4. "High · 90%" beside a held first-fill (show "Check" while the note stands; name the other caption —
   "printed under 'Your PO'"). ⊕ bar jargon ("Anchor", truncated "Invoice Numb", a blank label).
5. "confirm once" should also clear on the siblings when the box's read is confirmed (Chris 16 card 2's
   other half) — only matters for scopes without a layout arm now that the scoping fix is in.
6. Junk-caps type offers ("Poo"/"Ment"/"Print" — pre-existing in the census); "Dairy Wholesale" as a sender
   (letterhead fragment on a fixture); the young-scope "differs from the usual format" false alarms (fire on
   the first read, withdrawn on the second); the offer bar that auto-accepts 1.5 s later (show the receipt
   only when auto-accept is on); the DONE card's "teach from your clearest copy" hint (unbuilt UX half).
7. Cosmetics: senders (3) vs graduated suppliers (2) both on Home; an orphan `.metadata` xml after a purge;
   supplier folders with subfolders can't be imported whole; `Processed\Processed` nesting on override.
8. Built WITHOUT asking (bug-class — veto if you disagree): `8c0f26b` (template-file sync + sandbox
   templatesDir) and `5709a15` (the C3.3 scoping).

## Traps recorded tonight
- **The Python matcher reads the template FILE, not the DB row.** Any DB-only fingerprint write must rewrite
  the file (`_writeTemplateFile` / `_writeTemplateFileForSync`).
- **A one-sample fingerprint is the taught scan's garble.** Measure at birth (`documents.keyword_fingerprint`
  of the taught doc) AND in the file; never widen lane selection by folder (Oracle refused).
- The C3.3 hold keys on `nd.via === 'layout'` — the wizard's mapping saves coalesce 'layout' into the same
  job as the taught confirm, so job reasons are NOT a per-doc signal.
- `scopeTemplateIds` admits a template merely CARRIED by a scope-named doc (a mis-binding); the layout arm
  filters to OWNED templates (frozen supplier / sample doc).
- `documents.update()` whitelists columns — `folder_path` / `drained_at` need a direct UPDATE.
- `src/modules/templates/` is matched by the `templates/` gitignore line — `git add -f` for the handler.
- Bash heredocs here strip one backslash level — write patch scripts with the Write tool.
- `PYTHONIOENCODING=utf-8` for the script-style Python tests.
- Windows CopyFile preserves mtime: `find -newer` misses freshly filed PDFs; use birth time.
- Oracle rulings to keep: folder-key widening REFUSED; `issuer_chrome_lines` as an exclude set = dead guard;
  the half-cap is not a safety (issuer-protect + reward licence are); G2 must demand same-LAYOUT evidence.

## How to resume
1. Read this file, then `docs/oracle_log.md` from "2026-08-22 afternoon — Chris round 14 vet queue" to the end.
2. Decide the vet queue above (item 1 first — it is the only thing between a first-timer and "it files itself").
3. Before building item 1: gary design → Oracle (it crosses the S3 boundary; reuse Q3's guards) → dark → pins →
   a Chris round with `quiet_reread_on_layout` + `template_identity_on_page` + the new switch ON.
4. `/christest` rebuilds the sandbox on 9223 — kill PID 22824 first; remove the `Docusnap-q3` worktree.
