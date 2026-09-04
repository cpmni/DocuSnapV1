# HANDOVER — 2026-09-04 LATE (confusion-precedence 2a BUILT — at a RELOCATED site)

Branch `feat/teach-side-overnight`. **HEAD = `4fed950`.** Last PUSHED = `8d26532` (the morning wrap). **3 commits
LOCAL / UNPUSHED** — `54d473f` feat · `0ad3cf9` docs · `4fed950` chore (owner has not asked to push this batch).
Working tree CLEAN of tracked files. No installer. Dev app still running from the MORNING code (background task
`bo0iggwx0`); the Python side picks the new engine up on the next spawn, the JS merge + mig 119 need a restart —
either way the arc is seed-OFF and INERT on this DB (see §Verification), so nothing changes for the owner today.

## TL;DR
Built **CONFUSION PRECEDENCE 2a** (mine this sender's own HUMAN `corrections` into per-scope OCR-confusion facts →
correct a NEVER-SEEN serial, REVIEW-BOUND, DARK `confusion_precedence`, mig 119) — but NOT at the site the morning
sign-off named. Traced at source: the leg-b/leg-a site (engine Stage-4.5 text branch) is **unreachable for every
ref-role field of a ref-NAMED type** (`text_field_keys` drops `_is_ref_field` keys; Print Tracker `reference_number`
is type `reference` AND ref-named). So RESOLVE_REF_NEAR_MISS / RESOLVE_REF_POSITIONAL **never executed on the
exhibit** (their predicate pins are green — the dead-guard class); doc138's heal was Stage 2.5b. gary redesigned,
Oracle **SIGN-OFF-W/COND O1-O9**: 2a now runs as its own pass AFTER every page-witness gate (Gate C … D1) and BEFORE
the boost, writes NO `corrected_to`/`was_corrected`, unions the machine-confirmed literals on the refusal side, and
refuses any fact whose `from` glyph a known literal legitimately carries at that position. Also logged: a live
**auto-file-candidate exhibit** for the leg-b relocation (doc176), Stage 2.5b's silent @95 ref rewrite, and barry's
website download-ticker MVP (owner's mid-session ask).

## Committed (all local)
### `54d473f` feat(extraction): confusion-precedence 2a (DARK, mig 119)
- `database/modules/learning.js` `getFieldConfusions(db)` — corrections JOIN documents (`status='confirmed'` +
  `learningExcludedSql`) LEFT JOIN document_types; latest row per (doc,field) via `MAX(c.id)`; SUPPLIER-scoped groups
  ONLY (A1 by construction — no `''` twin); same-length rows differing at EXACTLY ONE position → fact
  `{len,pos,from,to,support_docs,support_values,counter}`; `counter` = docs holding the OPPOSITE fact; raw emit,
  cap 100/scope. No machine-confirm exclusion (a corrections row is a human act — C2).
- `src/modules/processing/handler.js` — `buildTrainingArgs` mines ONLY when armed (env `CONFUSION_PRECEDENCE==='1'`,
  else the setting; env `'0'` = explicit OFF) and merges `confusions` + **`confusion_literals`** (= keys(value_counts)
  ∪ keys(machine_value_counts), built ONCE here so Python never reads the machine channel — Oracle O3a) onto the
  matching supplier|doctype|field group → OFF is byte-identical INCLUDING the training payload. `_reconcileEnv`
  bridge `confusion_precedence` → `CONFUSION_PRECEDENCE`.
- `python_backend/extraction/format_anomaly_checker.py` — `_CONFUSION_MIN_DOCS=3`, `_CONFUSION_MIN_VALUES=2`,
  `_confusion_refusal_literals` (union, casefolded — O3c), `_confusion_from_attested` (**O3b**: any known literal of
  that length carrying `from` at `pos` kills the fact — the S-family beside the 5-family), `_confusion_breaks_confirmed`
  (752/782), `confusion_correct(value, fmt_entry, min_len=10)` → `{value,pos,from,to,support_docs}|None`: ≥10 alnum;
  needs `confusions` AND `value_counts` (value_counts = the LICENSING precondition); EMPTY casefolded edit-1 ball over
  the union; BACKED letter↔digit only; ≥3 docs / ≥2 values / counter==0; exactly ONE position with ONE target.
  `build_format_class_index` threads `confusions` + `confusion_literals` beside `value_counts`.
- `python_backend/extraction/engine.py` — `_CONFUSION_PRECEDENCE` (`== '1'` idiom), `_CONFUSION_NOTE_MARK`
  ("corrected from this sender's past corrections"), `_CONFUSION_NOTE` (O8: both forms, the glyph pair, the count,
  "This exact value has not been seen before"), `_CODE_FIELD_SKIP_TYPES` (the house deny set, pinned equal to the
  four reconciles' local `_skip_types`), **`_apply_confusion_precedence(results, field_defs, supplier_name,
  document_slug)`** — deny: `_` keys, identity keys, list/barcode keys, name-like, skip types, already noted or
  `corrected_to`, method `== anchor_crop_crosscheck` (equality-keyed restore), user-set methods
  (override/template_fixed/manual/operator_pin), whitespace or digit-less values; A1 direct `(s,d,key)` index lookup
  (never `_make_format_lookup`'s `''` fallback); post-correction shape-sanity refusal (read passes `check_value`,
  correction fails → refuse); writes value/display_value, keeps raw_value, conf `min(conf,70)`, the note, method
  `+confusion_resolved` — **NO corrected_to, NO was_corrected (O2)**; returns bool. **Call site** after
  `_rescue_identity_from_scope` (i.e. after Gate C `:10667` → … → D1 `:10699`) and before the LEARNED-AGREEMENT BOOST;
  `_cp_fired` ORed into `review_needed` (O4 — `results['_needs_review']` is assigned unconditionally at `:10713+` and
  `validator.needs_review` never reads a note; 70 is not < 70).
- `database/index.js` mig 119 `confusion_precedence` seed OFF — **no force-ON twin** (gary/Oracle: don't add one; the
  OWED revert list already carries six).
- `database/modules/test_machine_confirm_learning.js` — the production-consumer count of the literal
  `machine_value_counts` 2 → 3 (justified: refusal-side union in handler.js) + a source assertion that
  `value_counts` stays the licensing precondition and Python never reads the channel.
- `docs/extraction-pipeline.md` — the Stage-4.5 2a paragraph (placement, predicate, provenance rules).
- **Pins (all RED-first, all green):** `python_backend/tests/test_confusion_precedence.py` **34** (heal, A2 floors,
  unbacked 5↔8, confirmed pre-value, rival within 1 edit, indel neighbour, break-check both ways, two-position refuse,
  two-target refuse, malformed rows, **O3a union — `W2S8745899` reads as SEEN**, **O3b attestation — the unseen sibling
  `W2S9999999` refused**, O3c casefold, G4 self-disarm) · `test_confusion_precedence_wiring.py` **41** (**REACHABILITY:
  a `reference`-typed ref-named key fires via `template_mapping` AND `anchor_crop_relocated`**, any code field with
  facts, the write shape incl. NO corrected_to/was_corrected, the deny set, the module deny set == the four locals,
  A1 belt, OFF==ON, source order after Gate C / after `+snapped` / after D1 / before the boost / ORed into
  review_needed / never calls `_has_no_usual_format`, the mark bilingual) · `database/modules/test_field_confusions.js`
  **17** · `test_confusion_no_row_on_accept.js` **7** (renderer dirty-check source pin; `saveCorrections(db,id,{})`
  writes 0 rows; edit-back writes the counter) · `test_confusion_autofile_hold.js` **11** (`trust.isAutoFileEligible`
  refuses 'flagged' via the note AND independently 'weak-critical-field' via the ≤70 cap with the note stripped +
  vacuous-ignore ON; a 95 no-note control WOULD file; OFF payload carries no `confusions`; env `'0'` beats the
  setting; `+confusion_resolved` NOT a getFieldFormats exclusion; the badge keys on corrected_to; no JS clearer
  matches the note).
### `0ad3cf9` docs — `docs/oracle_log.md` (the relocation verdict) + `pendingfeatures.md` (3 entries, below).
### `4fed950` chore — O6b REACHABILITY comment at the dead leg-b/leg-a site; `test_format_anomaly_variance.py`
window 4200 → 4800 (comment-only shift).

## Verification state — honest
- **E2E on `db.backup()` COPIES (never the live DB; scratchpad `make_e2e_db.js` injects 3 confirmed Print Tracker
  docs + corrections forming a fact; `repro_121.js` takes `DS_DB` / `DS_PDF` / `CONFUSION_PRECEDENCE`):**
  - **Guard (Oracle G2-b):** doc55 `W2S8745899` (machine-confirmed ×6) with an OVER-FLOOR (10,2,S→5) poison fact →
    **unchanged** `W2S8745899` @95, no `+confusion_resolved` — the attestation (machine literal in the union) killed
    the fact. The union on the copy carried `W2S8745899` + `W2S7828006` (verified).
  - **OFF==ON:** doc176 ON vs OFF `file_done` payloads byte-identical (no fact applied — see the exhibit below).
  - **NOT demonstrated live: the HEAL.** No live doc currently presents 2a's class (a never-seen read with a backed
    letter at a supported position ≥2 edits from every known literal): every backed-letter read on this DB is either
    within 1 edit of a known literal (leg-b's class) or a genuine machine-confirmed family (which O3b protects — by
    design). The heal is carried by the unit wiring pin on the REAL `build_format_class_index` entry (live Print
    Tracker value_counts + sample order) driving the REAL method.
- **Inert on the owner's DB today:** the live `corrections` table has 5 latest-per-(doc,field) rows; no fact reaches
  ≥3 docs. That is the design working (gary: "starvation ≈ success" — 2a only pays where the pre-fill arcs fail and a
  human still corrects by hand; an accepted pre-fill writes no row, and once a 2a value is confirmed the case moves to
  leg-b). Say this plainly to the owner: flipping it ON shows nothing until ≥3 hand-corrections of the same
  (len,pos,from→to) with ≥2 distinct corrected values accumulate for one sender.
- **NOT run:** realdoc M=0 (Oracle G1 — expected-trivial/inert; must assert the arm ARMED via the merged-fact log line),
  the constructed adversarial census (G2, the gate that matters — cells listed in the Oracle log), G3 per-field
  regression with prod provenance ON. All OWED before FLIP, not before build.
- **Corrected claims from the morning handover:** "leg-b/leg-a proven end-to-end" was VACUOUS — leg-a's "doc196 proof"
  gives the identical outcome whether or not it ran; neither has ever executed on a ref-role field of a ref-named
  type. The 09-04 Oracle framing "2a generalises signed leg-b" is therefore void (R5) — 2a is the family's FIRST live
  arc and its safety case stands alone (which is why O1-O9 are stricter than A1-A4).
- **Pre-existing (not mine):** `test_settings_wiring.js` still fails ONE check (stamp/dbenc element ids).

## ⚠ LIVE EXHIBIT the owner should know about (found by the e2e, not fixed — out of this build's scope)
doc176 (`…split_p11-3.pdf`): the FRESH crop read is `1625802868` @95 `anchor_crop_relocated`, **no note,
`needs_review: false`, overall 100** — one BACKED glyph (6↔G) from the human-confirmed `1G25802868`. That is exactly
leg-b's singleton-ball case; at the dead site nothing resolves it, so a re-import is an **auto-file candidate carrying
a misread serial** (the stored row happens to be held today only because an older import left a note on it). Gate C
passes it (the page reads `1625802868` too); D1 doesn't fire (letter vs digit). Fix = the leg-b relocation
(`pendingfeatures.md` 2026-09-04) — a separate, census-gated commit.

## ⏭ FIRST ACTIONS (next session)
1. **Relocate leg-b/leg-a** per Oracle R4 + gary Q5 (pendingfeatures entry): one `_resolve_code_reads` pass beside
   `_apply_confusion_precedence` running leg-b → leg-a → 2a in precedence, each behind its own flag; leg-b must ALSO
   drop `corrected_to`/`was_corrected` (O2) and honour the machine-literal union; REACHABILITY assertions added to the
   three existing pins; its own realdoc M=0 + census. Treat as a NEW feature (no production history). doc176 is the
   exhibit.
2. Owner decision on **Stage 2.5b's silent @95 ref rewrite** (pendingfeatures) — note+cap it like 2a, or census first.
3. Owner decision on the **website download ticker** MVP (pendingfeatures; barry) — prerequisite = the 5-minute
   `REMOTE_ADDR` vs `CF-*` header check on the live licensing host (it also audits the existing rate limiter).
4. Before any FLIP of 2a: G1 (M=0, arm asserted armed) + G2 (constructed census on a copy vs independent GT) + G3.

## Deferred (designed, NOT built)
- **HIGH auto-file tier** — still NOT approved: H1-H5 + **H6** (2a must run WARM with a measured false-correction rate
  first). "2a shipped" is not evidence for HIGH.
- Two-position corrections as fact sources — refused for v1 (one human act → two votes = the B7 class); pinned in
  `test_field_confusions.js` §3; if starvation ever forces it, tag `multi: true` + per-position ≥3-distinct-doc floor +
  a separate census.
- A marker-keyed Review badge for `+confusion_resolved` (Oracle O2 "recommended", not required) — the note already
  names the raw read.

## Needs the USER
- Push decision (3 local commits).
- The two owner decisions above (2.5b, ticker) + the standing OWED list from the morning handover (revert the six
  TEST force-ON migs 108/110/112/114/116/118 before a customer build; WARM census + M=0 per arc).
- Chris 09-03 finding still open (import list not flipping to "Filed" after a MANUAL confirm).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — **max migration applied on disk = 118** (119 lands on the next app
  start; seed OFF). E2E copies + harness in this session's scratchpad (`make_e2e_db.js`, `repro_121.js`,
  `probe_corrections.js`, `probe_e2e_candidates.js`, `probe_w2s.js`).
- Run pins: `PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/<name>.py`; JS via
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/<name>.js`.
- Advisors this session: barry (ticker), gary (root cause + relocation design + test plan), Oracle (O1-O9). All in
  `docs/oracle_log.md` (2026-09-04 late entry).
- Memory: `memory/project_confusion_precedence_20260904.md` (new) + the family file
  `memory/project_ref_variance_relax_20260903.md`.

---
## ADDENDUM (later the same afternoon) — two more arcs, all LOCAL, app restarted with everything ON
HEAD = `c8baa68`. Commits after the wrap: `12e5176` feat(import) · `f12b952` feat(extraction) · `c8baa68` docs. Tree clean.
Dev app RESTARTED on this code with `format_class_join` + `confusion_precedence` + the six family arcs all `true`
(max migration 120 on disk; migs 119/120 seeded `0 row` because the switches were pre-armed).

### `12e5176` — import messaging: "grabbed / checking / splitting" before processing (owner ask)
`_separateBatchDocuments` now emits a QUIET per-file "Checking “X” for multiple documents… (k/N)" (status line only,
`quiet` flag honoured by the main renderer) and a LOUD "Splitting “X” — N documents found, separating them before
processing…" (or "Removing N separator sheet(s) from “X”…") BEFORE the splitter runs. Watch path: those lines only
ever reached processing.log (no `file_begin` yet, ticker silent) — the drain now mirrors them to `watch-progress`
and the strip shows them; the "file stable — accepted" pickup is mirrored as "Picked up “X” — accepted for
processing". Pins green: split_plan, watch_separation, watch_row_dbid_sync, import_watch_parity.

### `f12b952` — FORMAT_CLASS_JOIN (DARK `format_class_join`, mig 120) — Oracle SIGN-OFF-W/COND C1-C11
**The owner's doc262 exhibit** ("edge cuts the value … fuller reading could not be verified" on a plainly-printed
`752923124N3M2`): the mapper HAD re-read it correctly (`_edge_cut_relocate`); consent failed because the scope had NO
format entry — `classify_format` needs the 3 NEWEST confirmed values to agree on a class, else FREETEXT, and the
index DROPS a FREETEXT non-name entry. Today's confirms put a pure-digit serial beside alnum ones → the Print
Tracker `reference_number` entry vanished → EVERY confirmed-literal arc (RELAX_REF/_INLINE, both Gate-C softens,
leg-b, 2a, `_has_no_usual_format`) + the consent ladder went silently inert for that sender; the morning pins stayed
green on a baked 19-value order (vacuous). Built per Oracle: the join admission in `build_format_class_index`
(distinct-set class, name-field exclusion, separators over the distinct set, NO `shapes` key, length-aware
`shape_families`, no `support`, supplier-scoped only); `_shape_consents` 'joined' tier (review-bound; literal or a
≥3-doc family); `_JOINED_LITERAL_NOTE` (truthful) at the relocate + grow; engine class-F refusal, keep-and-flag,
fc_delta exclusion. Pin `test_format_class_join.py` 51 (RED-first on the LIVE order). Census tool
`python_backend/tools/format_join_census.py` (live: 1 scope joins, hard lines clean, coverage 19/23). E2E: doc262 →
`752923124N3M2` @85 + the TRUTHFUL Gate-C soften note (review-bound by design — 752 AND 782 are both confirmed
literals on this install); doc146 (no dissent) OFF==ON identical.
**Owed before FLIP (pendingfeatures):** the corpus census + realdoc M=0 + blanked-field/flag deltas (C11: revert
the TEST force-ON migs first); the UNANIMOUS-by-accident twin (own slice); Stage 4.5 hard-nulling an exact
confirmed literal (own slice); Learning-Repair remediation of the rubber-stamped `1625802868` (docs 176/210) and
`782923124N3M2` (doc 92).
**Push:** none of `12e5176`/`f12b952`/`c8baa68` pushed (owner has not asked).
