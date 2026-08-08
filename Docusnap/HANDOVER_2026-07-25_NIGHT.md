# HANDOVER 2026-07-25 NIGHT (Opus 4.8) — autonomous overnight run

Branch `feat/reprocess-throughput-autostraighten`. **1 new LOCAL commit `9dfa011` (NOT pushed).**
Working tree has uncommitted new files (harness + docs — see below). Owner asleep; ran autonomously
under a hard **no-regressions** rule: every code change kill-switched DEFAULT OFF (byte-identical off).

## TL;DR
The owner's "recipient/customer anchor" problem turned out to be a **red herring for the auto-file
pile-up**. Traced it to root: 16 correct Saltmarsh dockets pile up because of the **auto-file gate +
confidence caps + an ungraduated scope**, NOT a wrong read. Built ONE approved, low-risk fix (the
caption-prefix strip, DARK), ruled out the corroboration lift as inert, and produced a full audit of
what actually hinders auto-file. **Nothing that changes live behaviour was shipped** — the one code
commit is DEFAULT OFF and byte-identical until the owner flips it after a page-verify.

## What was BUILT (committed LOCAL `9dfa011`, DEFAULT OFF)
**Caption-prefix strip** — `_strip_caption_prefix` in `python_backend/extraction/anchor.py` (kill
`ANCHOR_CAPTION_PREFIX_STRIP`). A rigid anchor crop can capture its own caption ("Date 22/07/2026",
"No. DN-36457") → the correct value is DISCARDED by the credibility/format gate, OR on a cold supplier
commits DIRTY into the filename. The strip removes the field's OWN taught label prefix (mandatory
whitespace after the label → a glued "NO-1234" is untouched; structured non-currency only; free-text
excluded). Advisors: reggie design → Oracle **SIGN-OFF-WITH-CONDITIONS**:
- **SEAM A** — currency EXCLUDED (its label-lock at anchor.py:472 has its own caption defence that keys
  on the caption being present; stripping first blinds it). Scope allowlist = date/alphanumeric/
  reference_code/job_reference/number.
- **SEAM B** — RECOVERY not pre-emption: strip applied only when the un-stripped value would be
  REJECTED, or there is NO learned format (cold-supplier). Byte-identical for values that already qualify.
- Recovered value stays a plain (non-authoritative) `anchor_crop` → a disagreeing keyword still holds it.

**Verification (honest):**
- Unit: `python_backend/tests/test_caption_prefix_strip.py` — 22 checks GREEN.
- OFF byte-identical: by construction (block gated before mutation) + doc-597 trace byte-count-identical.
- ON, live Saltmarsh batch (16 docs, `caption_strip_ab.js`): **16/16 zero VALUE changes** — the strip
  recovers the read METHOD-only (anchor_inline→anchor_crop), same value "22-07-2026". Value-safe here.
- ⚠ **NOT flipped ON. NOT run through the full corpus (realdoc_regression) A/B.** Oracle's flip gate
  (condition 6) = corpus M=0 + zero date/ref accuracy drop + page-verify every doc whose committed
  date/ref VALUE changes. Do that BEFORE flipping. **It does NOT clear the Saltmarsh batch.**

## UNCOMMITTED new files (commit when ready — carry no data, safe)
- `stress_test/caption_strip_ab.js` — reusable OFF-vs-ON A/B harness for the strip (flip-set evidence).
  Run: `FILES=587.pdf,...602.pdf KNOWN_SLUG=delivery_note DEMO_FOLDER="%APPDATA%/ScanFinder/inbox"
  ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/caption_strip_ab.js`
  (or point DEMO_FOLDER at "Demo Docs/<supplier>/<type>").
- `docs/AUTOFILE_AUDIT_2026-07-25.md` — the full audit (READ THIS — the ranked blocker list).
- (These + `9dfa011` are one logical batch; commit the two files, then decide on push.)

## The REFRAME (why the batch is stuck) — see docs/AUTOFILE_AUDIT_2026-07-25.md
customer_name is `required=0` → irrelevant to `overall_confidence`. The 88-vs-95 split is **TEMPLATE
MATCH**: match → supplier early → conformance boost → 95 + docTrustGate ok; no match → supplier late →
`late_anchor_rescue` cap 85 → 88, and no-template **bars sub-100 auto-file** (docTrustGate). Scope is
**4/10 confirms → floor 100 → NOTHING auto-files** yet. Simulated at graduated floor 95: only **4/20**
file; **11 blocked no-template** (template-match gap = the PRIMARY lever), **5 blocked flagged** (2
"type changed on reprocess", 3 customer phantom note).

## RULED OUT (do not build)
- **Corroboration lift** (anchor_crop+anchor_inline → lift date past 85): gary + Oracle **DO NOTHING**.
  Late-rescue ⟺ template-less ⟹ can't sub-100 auto-file ⟹ zero recall; the 85 cap guards the SUPPLIER
  premise; lifting reopens #472. Enumeration CONFIRMED inert (0 weak-critical-with-template).

## NEXT SESSION — recommended (all owner-gated; Oracle: do NOT touch the matcher autonomously)
1. **Confirm 6 more Saltmarsh dockets** → graduate → floor 95 → 4 clean docs auto-file (free, no code).
2. **Diagnose the template-match gap** (why doc 597 misses template 24; 599 matches at only 60%) — the
   real lever for 11/16. Likely the pending reuse-by-branding Slice-2 + Phillip IDF hardening
   ([[project_template_defrag_20260725]]). READ-ONLY diagnosis first.
3. **"type changed on reprocess" flag** — should it clear after a clean reprocess (blocks 2 correct docs)?
4. **Caption-strip flip** — full corpus A/B + flip-set page-verify, then flip `ANCHOR_CAPTION_PREFIX_STRIP`.
5. Optional: identity-fusion to lift supplier_name off the flat 90 hint cap (raises ceiling; Phillip).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only `?mode=ro`). Saltmarsh dockets = docs 587-606,
  type_id 4 (delivery_note), inbox `<docid>.pdf`. Template 24 = the matched Saltmarsh template.
- ⚠ Python change ⇒ clear `python_backend/**/__pycache__` before reprocess (stale bytecode).
- JS harness needs Electron-as-node (better-sqlite3 ABI): `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>`.
- Scratchpad probes (this session): `enum_autofile.js` (why-held), `enum2.js` (graduated-floor sim),
  `trace_dd.js` (single-doc OFF/ON trace), `q_saltmarsh.py`/`reloc.py` (DB reads). Base:
  `%LOCALAPPDATA%\Temp\claude\c--GIT-Projects-Docusnap\d421a1d4-c675-433f-84b4-17134135e35f\scratchpad`.
- Advisors used: reggie (strip), gary (corroboration + reframe), oscar (OCR/resolution), barry
  (product), Oracle (final vet). Full designs in the session transcript.
- Memory: [[project_caption_prefix_strip_20260725]] · [[project_autofile_blockers_20260725]] ·
  [[project_recipient_anchor_problem]] (updated).
