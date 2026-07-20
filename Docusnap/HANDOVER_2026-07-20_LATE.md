# HANDOVER — 2026-07-20 LATE (the third session of the day)

**Branch** `feat/reprocess-throughput-autostraighten` · **all pushed through `2a81124`** · working
tree CLEAN (only the untracked `../Backup/`, not ours) · tag **`milestone-20260720-identity`**
(owner-marked significant point, pushed) sits on `2a81124`.
**Installer `dist\ScanFinder Setup 2.0.0-r20260720-2050-2a81124.exe` (built 21:51) is CURRENT** —
carries everything below. Every earlier `dist\*.exe` is stale.
**The owner's dev app (`npm start`) may still be RUNNING** on a FRESH database (wiped ~21:00; the
old 213-doc DB is preserved — see Key facts). The owner was mid-live-test at session end.
**Read this, then `HANDOVER_2026-07-20_EVENING.md`, then CLAUDE.md.** Context: this session was
run on Fable 5; the next continues on Opus 4.8.

---

## TL;DR

1. **The 10 template_fixed misfiles are FIXED and verified** — full investigation → gary+Phillip
   design → Oracle SIGN-OFF-WITH-CONDITIONS → built in his order: 5 kill-switched slices, all ON
   (`705da10`→`7c541fa`). Probe: 52/52 wrong-match outcomes healed, 0 false abstains. Corpus ON and
   OFF each byte-identical to the pre-change baseline.
2. **The letterhead geometry slice is BUILT and MEASURED, still DARK** (`2a81124`,
   `LETTERHEAD_ISSUER=0`): real scans 0% → **67% correct** (117/174) with a 7.5% garble-fragment
   tail; synthetic 45/45. The flip needs owner+Oracle.
3. **A NEW class was found during the owner's live test and fully planned but NOT BUILT: the
   label-as-value captures** ('Vetiver 10' ≈ "Deliver To" garble committed as customer_name,
   12/20 Ridgeway dockets, 7 of 12 UNFLAGGED). 007-instrumented root cause + gary design +
   Oracle ruling are complete; the plan is in `project_label_capture_plan.md` (memory) and
   summarised below. **This is the fresh session's build job.**
4. The supplier-link guard had its **first live exercise** during the owner's confirms (worked;
   two stale rows were from a pre-guard app instance, wiped with the old DB).

---

## COMMITTED THIS SESSION (all pushed; every slice kill-switched, OFF ⇒ byte-identical, pinned)

### The template-misfile fix stack (Oracle-gated, built in his recommended order)
1. **`705da10` supplier-link guard** (`TEMPLATE_SUPPLIER_LINK_GUARD`) — Oracle's BLOCKING catch:
   the confirm-time reinforcement loop. A doc misfiled to another supplier's template kept its
   `template_id` through confirm (Part D detaches on TYPE only), poisoning the wrong template via
   live counts, dominant dilution, `captureSample` landmarks (plain confirm) and phash APPEND at
   hamming 4-6 (taught confirm). TWO arms: reviewService confirm seam (BEFORE captureSample) +
   `_upsertTemplate` Part E (link + findByLogoHash/branding re-acquisitions). Predicate =
   `templates.establishedIdentity` (dominant confirmed issuer else frozen supplier value) +
   `supplierNamesDisjoint` (zero shared distinctive tokens — variants keep the link). 18-check
   red-first test `database/modules/test_confirm_supplier_link_guard.js`.
2. **`6379d14` distinctive-token Stage-0 gate** (`TEMPLATE_GATE_DISTINCTIVE`) — V1 was defeated 3
   ways by the live misfiles (logo+slug method bypass; junk 'INV'/'Industrial' stored tokens vs
   the ≤0.0 trigger; rival bar 0.75 unreachable through type-words/customer-leak). V2: gates every
   logo-cluster accept, `_distinctive_tokens` (stopword strip + type-word-PREFIX rule; 'inverness'
   pinned) vs the 0.25 present-bar, rival = per-identity banks + supplier-NAME arm, fuzzy, issuer
   band. `_BRANDING_STOPWORDS`/MIN_WORDS/PRESENT_RATIO moved to template_matcher (engine aliases).
   Rival-REQUIRED abstain (Oracle adjudication); Acme pin verbatim; V1 preserved under `=0`.
3. **`c81ae92` engine banks adopt the shared filter** (`BRANDING_DISTINCTIVE_TOKENS`) — junk
   tokens could inflate a WRONG supplier's own_ratio and SUPPRESS the conflict flag (red-proven).
   Parity pin: bank == `_distinctive_tokens` (Oracle condition D).
4. **`09ca82b` harvest hygiene** (`FINGERPRINT_HYGIENE`) — Python: digit-glue skip at harvest
   ('INV' in "INV-76642", raw-text context). JS `_upsertTemplate`: subtract CONFIRMED
   customer_name tokens (minus issuer-shared, Oracle E; skipped when issuer==customer fallback).
   HEALING pinned: the update intersect drops a stored leak ('Ashcombe') on the next confirm.
5. **`7c541fa` named-rival blank** (`BRANDING_NAMED_BLANK`) — a `template_fixed` value the
   branding net positively contradicts BY NAME blanks value AND `_supplier_name` scope (stamped
   at engine.py:3889 BEFORE the flag); note+`suggested_supplier` kept ("Use" button renders on a
   value-less row). Locked/manual/un-named branches NEVER blank (pinned).
6. **`366e8ef`** CLAUDE.md thread-close docs.

### `2a81124` — the letterhead GEOMETRY slice (DARK)
`reconstruct_page_text(words_out)` now emits per-row word groups → `read_page(words_out=)` →
`extract_text_and_images(page0_words_out=)` (page 0 only; CLEARED on cached-text return) →
`engine.extract(page0_geometry=)` → `pick_issuer(geometry=)`. Geometry arm: COLUMN-SEGMENT
candidates (the real SuperStore letterhead joins name+title on one row) through the existing text
gates + a distinctive-core gate, LINE-level upper-median heights RATIOED to med_h (floors 1.15 /
lead 1.10 — move only on aggregate measurement), fragment-yields-to-superset ('Cloud'→'Cloud VPS',
also healed 'City'→'City Office NI'). Three defects the dark measurement caught pre-ship, all
pinned: 'SERVICE WORKSHEET' suggested 17× (generic-name tokens now gate the core — honest cost:
"Document Solutions"-class names unsuggestable); the joined-row miss; the wordmark-fragment win.
GENERIC_SINGLES += location/ticket. Corpus byte-identical proven on a SAME-DB stash pair (the
first A/B diverged because the owner was confirming mid-run — the documented trap, re-proven).

## Verification state — honest
- Corpus (156 docs at baseline): BASELINE == ON == OFF byte-identical for the misfile stack;
  geometry threading byte-identical on the stash pair (173 docs by then — the owner was
  confirming live). M=1 throughout = the KNOWN pre-existing #108. Reports were READ, not
  exit-code-trusted.
- `stress_test/template_gate_probe.py` (NEW, permanent, THE gate for the misfile class —
  realdoc_regression is BLIND to it): baseline 52 wrong-match outcomes → 52 healed, false-abstain
  0, unadjudicatable 0, verdict PASS.
- Geometry measurements: real `C:\Users\cmccu\Desktop\ScannedDocs` 174 docs — text 3 suggestions
  → geometry 117 correct / 13 garble fragments / 44 honest abstains; Demo Docs 45/45/0.
- **Five PRE-EXISTING test failures catalogued by stash-bisect (NOT this session's):**
  `test_anchor_crop_crosscheck` (3), `test_late_anchor_rescue` (7), `test_template_rescue` (1),
  `test_field_data_types` (silent exit), `test_identity_fusion` (known). Un-triaged; likely stale
  from the issuer-band session. Two stale stubs FIXED in passing (test_precedence trace kwarg;
  three read_page stubs + one lambda gained words_out).
- Guard live evidence: owner confirms detached docs 192/183 and created Vellum tpl 19 instead of
  reinforcing Copperfield; docs 193/189 kept stale links — confirmed via a STILL-OPEN pre-guard
  app instance (timestamps 21:00-21:04 vs the new app at ~21:01-21:03). Moot: DB wiped.

---

## THE FRESH SESSION'S BUILD JOB — the label-capture plan (Oracle-ruled, NOT built)

Full plan in memory `project_label_capture_plan.md`; the evidence census, 007's instrumented
replay and the Oracle ruling are summarised there. The class: a correctly-taught 'below' anchor
commits an OCR garble OF ITS OWN LABEL ('Vetiver 10'/'Veliver to' ≈ "Deliver To") as
customer_name — 12/20 live Ridgeway dockets, **7 of 12 UNFLAGGED**, and on a graduated supplier
this class silently wrong-files (Oracle's premise correction).

**Three stacked, code-verified root causes:** (1) READING — `_crop_and_ocr` clamps its own window
but hands the ladder the full page + UNCLAMPED box; `_noise_smooth_retry`'s preview fast path
(anchor.py:2335-2347, :2402-2407, also :2448-2452) re-crops the page at box.y−0.5h with NO
top_limit, restoring the caption band; `clean_crop_segment` (:2187) takes the FIRST line ⇒ caption
becomes the value. `top_limit_norm` produced at exactly ONE call site (:525); drift-rung :842
never clamped. (2) a swallowed NameError at :578 (`_drelo` unassigned on the inline branch; bare
except at :598) that corrupts ocr_conf provenance and skips the exact caption check — fixing it
ALONE makes inline junk MORE Tier-A-eligible (sequencing load-bearing). (3) flag family
structurally capped (name_quality('Veliver to')=1.0 == 'Denver Trading') + the merge hold dead on
`keyword_override` incumbents (engine.py:255 checks =="keyword") + Tier-A ignores confidence.

**Build order (Oracle):** A ladder clamp (thread top_limit into BOTH `_noise_smooth_retry` sites;
degenerate ⇒ fall back to the CLAMPED crop; + drift-rung :842; rides `RELOCATE_CAPTION_EXCLUDE`)
→ C composed reject (bare `_is_fuzzy_caption_bleed` vocab, NO nq gate, AND caller-side worst-case
window overlaps the located caption band ⇒ `caption_band_read` reject, keep rigid else fall
through; kill `CAPTION_BAND_REJECT`; note ONLY when the anchor contributes nothing or the
survivor disagrees) → D one-token `keyword_override` admission at engine.py:255 → B NameError fix
(same commit as/after C+D; `_read_box` branch-aware) → F optional conf-cap. **E (crop-first
reorder) DEFERRED** to its own gated slice. Oracle's discriminator arithmetic (why both advisors'
versions were sent back): gary's full-label echo MISSES 'Vetiver 10' (lev 0.444>0.35); the bare
k=1 vocab FALSELY rejects 'Denver Trading' (0.286≤0.35) — only geometry separates.
**Merge gate:** red-first pins per slice (incl. a synthetic fast-path re-inclusion pin proven RED)
· replay docs 81-100 (0 caption commits; 0 lost correct on 82/90/95/98 + 92/93/100) · corpus OFF
byte-identical / ON M=0 · must-survive anchor suites green, stash-bisect any new failure vs the
five catalogued.
**⚠ DATA HYGIENE (Oracle's seam, time-sensitive):** the 12 garble docs sit in the owner's review
queue NOW — confirming one plants the garble into learning (Stage-2.5d snap + shape collapse).
After the fix: reprocess them before confirm. The owner was told to correct the Customer field
per-doc if confirming sooner.

## FIRST ACTIONS for the fresh session
1. **Build the label-capture plan** in the Oracle's order (A→C→D→B), baseline replay of docs
   81-100 FIRST (control-test-first; owner directive this session: "please be careful to monitor
   for regressions" — stash-bisect any new test failure against the five catalogued).
2. After it lands: rebuild the installer (close the dev app first — EPERM) and have the owner
   Reprocess-All on the Ridgeway queue before confirming those 12.
3. Optionally triage the five pre-existing test failures (small, they mask real breakage).

## Deferred (designed, NOT built — load-bearing conditions attached)
- **LETTERHEAD_ISSUER flip** — stays OFF until owner+Oracle accept the measured 7.5% garble tail
  (all human-gated; the fragments are OCR garbles of the true name — the stop rule forbids
  garble-specific rescue).
- **Crop-first reorder (plan slice E)** — different class (cross-column inline pre-emption); own
  switch, own replay evidence; do NOT fold into the label-capture train.
- **Trading-partner own-inflation class** (Oracle, misfile review): a wrong supplier who IS the
  doc's customer self-exempts both branding nets — backlog, own slice.
- Workflow slices 5/6 · SEC-04 · Barry 3-5 · the geometry-slice tail (Beijing/'Cit Office'
  fragments) — as per the EVENING handover.

## Needs the USER
- Continue the fresh-install live test (the queue's 12 label-garble docs: correct Customer before
  confirm, or wait for the fix + reprocess).
- IONOS deploy (all backend security fixes still inert) · print/Ricoh test · second-machine
  docket test (unchanged from EVENING).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — **FRESH (wiped ~21:00), migration 51**. The OLD
  213-doc misfile corpus is preserved at
  `%APPDATA%\ScanFinder\docusnap.backup-20260720-misfile-corpus.db` — `template_gate_probe.py`
  replays it via env `TEMPLATE_PROBE_DB`.
- Probe: `py -3.12 stress_test/template_gate_probe.py` → `stress_test/out/template_gate_probe.md`.
  Corpus: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`
  → READ `stress_test/out/realdoc_regression.md`, never trust the exit code; mid-session A/B pairs
  are invalid while the owner confirms docs — stash-pair on the SAME DB state to prove
  byte-identical.
- Kill switches added today: `TEMPLATE_SUPPLIER_LINK_GUARD` · `TEMPLATE_GATE_DISTINCTIVE` ·
  `BRANDING_DISTINCTIVE_TOKENS` · `FINGERPRINT_HYGIENE` · `BRANDING_NAMED_BLANK` (all ON).
  Dark: `LETTERHEAD_ISSUER`.
- Real-scan corpora: `C:\Users\cmccu\Desktop\ScannedDocs` (174 real docs incl. the owner's
  worksheets) · `C:\Users\cmccu\Desktop\Demo Docs` (9 synthetic suppliers). The Ridgeway teach
  test set: `C:\Users\cmccu\Desktop\Kyle Test`.
- The extraction/keyword.py stdlib-shadowing trap for probe scripts: pre-import
  collections/functools/json/re/keyword BEFORE inserting `python_backend/extraction` on sys.path.
- Advisors used today: gary + Phillip (document-fingerprinting persona) + Oracle on the misfiles;
  007 (general-purpose + persona, instrumented replay) + gary + Oracle on the label capture.
  007's diagnostic scripts were in the (now-expired) session scratchpad — the handover +
  memory carry the findings; his replay is re-derivable from the plan's line references.
