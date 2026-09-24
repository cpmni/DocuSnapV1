# HANDOVER 2026-09-24 (late) — the QUICK-reprocess stale-score fix (design; NOT built) — owner resumes testing after it lands

**Branch:** `feat/teach-side-overnight` · HEAD `6d3b714` (+ this handover) · origin CURRENT · migrations **215** ·
`TEST_SWITCH_KEYS` **13** · tree clean · installer to ship `dist\ScanFinder Setup 2.0.0-r20260924-1805-fa249d1.exe`.
**Context:** `HANDOVER_2026-09-24.md` (the day: Chris round → 7 fixes → gates → flips → onnxruntime vendored + built).
This file is ONE fix: the owner's first sandbox observation. The owner will continue testing in the sandbox once it is
applied — so the fresh session's job is: design-vet → build → pin → gate → apply to the running sandbox → tell the owner.

## The exhibit (owner sandbox, 2026-09-24 ~19:30; verified on a copy of its DB)
17 Nordwind Refrigeration QUOTES imported while the Quote type had no keyword for them ("Not recognised") → the schema
scorer zeroed the required fields → `documents.overall_confidence = 31`. The owner added Keyword Label Overrides
("Quotation Ref" → quote_number, "Total (inc VAT)" → total_amount) and ran a **QUICK** reprocess. Result: every field now
reads well — issuer 90 (`letterhead_prefill+issuer_sibling_fill`), quote_number 95 (`keyword_override`), quote_date 96,
total 95 (`✓ Value mathematically verified`), no notes — but each doc still shows **"read at 31%, below the 90% you've
set"**, none files by itself, and File All Ready offers all 20 (its readiness classifier looks at flags/blanks, not the %).
Screenshot `Pictures\Screenshots\Screenshot 2026-09-24 193056.png`; DB copy `%USERPROFILE%\.claude\jobs\68b38f39\tmp\osb\`.
Workaround the owner was told: **"Reprocess 17 from Nordwind" → Full re-read** (rescores → ~94 → files), or File All Ready.

## Root cause — verified at source (`src/modules/processing/handler.js`)
1. Quick reprocess = the imageless `--reextract` run (Plan B, 2026-09-01; gary → Oracle SIGN-OFF-W/COND C1-C7).
2. `mergeReprocessRows` (~1665) KEEPS a stored read the text-only pass cannot reproduce and counts every keep in
   `stats.imagelessKept`: (a) ~1718 an image-family/taught row whose fresh read is EMPTY-with-note; (b) ~1809 an
   image-family/taught row whose fresh value DIFFERS (`kept_imageless_taught` / `kept_imageless_contested`);
   (c) ~1825-1834 **the identity-preserve leg**: `supplier_name` fresh text read AGREES but at LOWER confidence → the
   stored read (conf/method) is kept "so a text-only pass never downgrades the issuer" — kill `QUICK_IMAGELESS_IDENTITY_PRESERVE=0`.
   On the exhibit it is (c): stored issuer 90 vs the fresh text read lower → kept → `imagelessKept = 1`.
3. **Oracle C4 (~3786-3791):** `if (_imageless && _mergeStats.imagelessKept > 0)` → `_overallToStore = the doc's PRIOR
   overall_confidence` — because the imageless engine scores kept reads as 0 and a recomputed overall would mass-hold the
   best-taught suppliers. Correct intent; wrong outcome when the prior was LOW: **a Quick pass can never RAISE a document's
   score.** The engine's own quick-run overall (`result.overall_confidence`) is discarded whenever anything was kept.
4. The stored value is written by `_updateDoc` (~3824 `UPDATE documents SET overall_confidence = ?`); the consent offer /
   scope auto-accept / File-N then read the stored 31 → below the 90 threshold → held; File All Ready ignores the %.
5. NOT involved: the second reader (born-digital quotes; it only runs on scanned reference crops), the flips, R1.

## The fix — design (gary → Oracle re-rule REQUIRED: this touches Plan-B condition C4, so it is a re-rule, not a bug fix)
**Rescore in JS from the MERGED rows, and never store less than the prior.** Immediately after `mergeReprocessRows`
returns and BEFORE `_overallToStore` is decided:
- `rescored = requiredMean(mergedRows, fieldDefs, hiddenKeys)` — the JS twin of `validator.overall_confidence`
  (`python_backend/extraction/validator.py` ~925-966): over the type's REQUIRED fields (`fields.required = 1`; roles are
  required by nature since mig 92), else every defined field; a present value contributes its row confidence; an unread
  required field contributes 0; a key in `template_hidden_fields` for the doc's template is skipped ("the operator declared
  this layout lacks the field", the `exclude_keys` leg). Kept rows carry their STORED confidence — that is exactly what the
  imageless engine could not see, so C4's concern ("kept reads scored 0") is met by construction.
- `_overallToStore = Math.max(prior, Math.min(rescored, cap))` where `cap = 99` (a Quick pass must not mint the gate-free
  100 % road — Oracle C1 of Plan B: "Quick never files what Full would hold") — OR, if the Oracle prefers, `cap =
  result.overall_confidence + (100 − …)`… keep it simple: 99. Never below the prior (C4's purpose), never above what the
  merged rows support, never 100.
- The format-consistency penalty (`fc_delta`, the −12 a noted field earns) is NOT available to JS (grep: neither
  `process_docs.py` nor `handler.js` emits it) — a noted row is already flagged → held regardless of the %, so the score
  is cosmetic for it; document this (do not fake a penalty).
- Contested docs (`_contested.length`, Oracle C1) stay excluded from the consent offer exactly as today — the rescore
  changes the NUMBER, never the offer set. `_recordAutoFiled`, the scope auto-accept and File-N read the stored number
  afterwards → the rescored doc becomes eligible on the NEXT sweep/offer, which is the whole point.
- Kill switch: env `QUICK_RESCORE_MERGED=0` (default ON — a bug-class fix inside the shipped Quick path, like R1's
  `TEMPLATE_FORMAT_FAIL_CODE_AGREE`; no new DB switch/mig unless the Oracle asks for DARK first). Trace event
  `reprocess_quick_rescore` {prior, engine, rescored, stored}.
**Name the seam:** RELIES on `fields.required` being honest (mig 92 asserts the roles) and on hidden-field exclusion
parity with the Python scorer; DISABLES nothing — it only ever RAISES a stored score toward what the merged rows read, and
a raise can only turn a held doc into an OFFERED one (the consent bar / scope sweep still re-validate every doc through
`isAutoFileEligible` before filing — the flagged / disagreeing-read / critical-floor gates are untouched).
**What would make this wrong:** a kept row whose stored confidence is STALE-HIGH (a taught box that drifted; the imageless
pass can't see the drift) → the rescore inherits it. Mitigation is already there: such a row is CONTESTED (~1809/~1718
`kept_imageless_contested`) → excluded from this run's offer/auto-accept; and a taught key's keep is operator-blessed.
Pin it.

## Pins + gate
- `src/modules/processing/test_reprocess_quick_rescore.js` (Electron-as-Node; model: `test_reprocess_autocommit.js` /
  `test_reprocess_annotated_empty.js` for the imageless merge harness): (1) prior 31, merged rows required 90/95/96 →
  stored 93 (mean of required, no 100); (2) prior 96, rescored 80 → stored 96 (never below the prior); (3) a required field
  unread → its 0 pulls the mean; (4) hidden key skipped; (5) a contested keep → number rescored BUT doc still in
  `_reprocessContested` (offer unchanged); (6) kill `'0'` → the prior is kept (today's byte-identical path); (7) a FULL run
  (`!_imageless`) → untouched (`result.overall_confidence` stored as today); (8) the cap: all-100 rows → 99.
- Source pin: `_overallToStore` never assigned 100 on the imageless road; the C4 block still exists (the rescore is INSIDE
  it, not a replacement).
- Gate: (a) the owner's sandbox exhibit — apply the fix, Quick-reprocess the 17 Nordwind quotes → each ≥ 90 → "files by
  itself" on the next sweep (this is what the owner will do); (b) realdoc 727 `RR_APP_ENV=1` quick arm is not available in
  the harness (it runs Full) → use the sandbox copies (`tmp\sbdb2`, `tmp\osb`) with a scripted Quick run if one exists
  (`quick_reprocess_enabled` road, `reprocess-scope-quick` IPC?) else the live sandbox; M=0 (no field VALUE changes — the
  fix touches only the number); no doc's stored overall DROPS (assert across the run).
- Then `node scripts/run-pins.js` from the repo root (415+ files; green today).

## FIRST ACTIONS for the fresh session
1. Read this + `pendingfeatures.md` (2026-09-24 entry, same content) + `docs/oracle_log.md` 2026-09-01 (Plan B C1-C7 —
   the C4 wording that is being re-ruled).
2. gary (design vet, the `requiredMean` twin, the cap) → Oracle (re-rule C4). Front-load the facts above.
3. Build + pins + the sandbox gate. The sandbox app is RUNNING (CDP 9223, PID 27684, launcher 27744, data folder
   `%USERPROFILE%\.claude\jobs\68b38f39\tmp\owner-sandbox\userData`, Output `…\owner-sandbox\Output`, Demo Docs copy beside
   it). **A main-process change needs the sandbox RESTARTED** to load it: kill PID 27684 + 27744 (`taskkill /PID … /T /F`),
   relaunch exactly as before —
   `$env:DOCUSNAP_USERDATA="…\owner-sandbox\userData"; Start-Process cmd -ArgumentList '/c','npm start -- --remote-debugging-port=9223' -WorkingDirectory "C:\GIT Projects\Docusnap" -WindowStyle Hidden`
   (the data + the owner's admin account + the 17 quotes persist; the DB is at mig 215).
4. Tell the owner: "Quick-reprocess the Nordwind 17 again" and what to expect (each ≥ 90, then "files by itself").
5. Commit per slice; push when asked.

## Needs the USER
- The owner continues the sandbox test after the fix. Their Quote type: fields issuer / quote_number / quote_date
  (required) + total_amount (optional); their overrides "Quotation Ref", "Total (inc VAT)" (exclusive 0, template 0).
- Decide the DARK-vs-default question if the Oracle punts it.

## Key facts / paths
- Sandbox DB copy of the exhibit: `%USERPROFILE%\.claude\jobs\68b38f39\tmp\osb\docusnap.db` (docs 11-24 = the quotes at
  31; doc 1 = the one that filed via `scope_sweep` at 100 after a FULL read).
- Quick road: `handler.js` ~5535 (`quick_reprocess_enabled`, ON since mig 203) → `shardGroups.push({ reextract: true … })`
  ~5580 → per-doc merge ~3760-3830 (C4 at ~3786) → `_updateDoc` ~3824.
- The imageless keep sites: ~1718 (empty-with-note), ~1809 (differing), ~1825-1834 (identity conf preserve).
- Scorer to mirror: `validator.overall_confidence` ~925-966 (`key_fields` = required else all; unread → 0; `exclude_keys`).
- Traps: edit scripts via the Write tool (bash heredocs with quotes fail); keep test labels ASCII (cp1252 console);
  `node --check` after editing the handler; the sandbox's `DOCUSNAP_USERDATA` hook is DEV-ONLY (a packaged build ignores
  it and would hit the live DB — never run `dist\…\ScanFinder.exe` on this PC).
