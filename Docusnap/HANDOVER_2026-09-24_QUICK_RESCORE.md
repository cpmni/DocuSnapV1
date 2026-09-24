# HANDOVER 2026-09-24 (late) — the QUICK-reprocess stale-score fix — **BUILT + GATED + APPLIED (evening 2)**

> **STATUS (2026-09-24 ~20:40):** BUILT as `a5f3cab` (shared penalty constants) + `36f14a1` (the fix + pins + docs), on
> `feat/teach-side-overnight`, UNPUSHED. gary vet → Oracle RE-RULE of Plan-B C4 = SIGN-OFF-W/COND C1-C6
> (`docs/oracle_log.md` 2026-09-24 evening) — all six applied. Design deltas vs the text below: (1) the raise is also
> BLOCKED when the doc is CONTESTED or when a TAUGHT key was kept on a scored key (`stats.taughtKeptKeys`); (2) the
> mismatch penalty leg IS mirrored (constants now live once in `database/modules/format_consistency.js`, shared with
> `charsetAcceptService`; cross-language pin `test_format_consistency_twin.js`); (3) hidden-key skip never applies to
> identity/role keys. GATE MET (`TESTING/_measure/quick_rescore_gate_20260924/RESULT.md`): CONTROL = the 17 stay 31 ·
> FIX arm A = 17 → 93, 0 field diffs, hold `below-floor` → **`no-template`** (gary's catch: the exhibit had NO Nordwind
> template, so 93 alone cannot file — sub-100 needs a bound template) · arm B = 5 clean confirms graduate the sender
> (`graduation_window` 5 on the sandbox) → template minted → the Quick pass binds + rescores the remaining 12 →
> consume auto-files **12/12** · arm C (fresh live-DB copy, 53-doc Quick) = 800 docs byte-identical control vs fix,
> flip list 0, Print Tracker zero raises. Pins `test_reprocess_quick_rescore.js` 14 sections ALL OK; whole suite
> `node scripts/run-pins.js` 424 files: 423 green + ONE stale pin (`database/modules/test_corrob_autofile.js`, a
> hand-rolled `fields` schema without `label`, which `37b61d0`'s trust query reads since the mig-215 flip — NOT this
> fix) → column added to the test schema → ALL PASS. Gate scripts (prep / seed-user / CDP driver / snapshot / compare /
> flips) live in the job scratch `…\jobs\68b38f39\tmp\gate\` and are described in the RESULT.md. **SANDBOX RESTARTED on the fixed code** (CDP 9223, new
> PID 18836, same data folder; the owner's admin account + docs persist). ⚠ FLAG for the owner: the sandbox's
> `output_folder` is the REAL `C:\Users\cmccu\Documents\Scan Finder` (sandbox files land in the live output tree).
> **Owner's next step:** any low-scored docs from a sender that already HAS a template → Reprocess (Quick) → they
> rescore and file by themselves; a sender WITHOUT a template holds honestly as "layout hasn't been matched to a
> template yet" until ~5 clean confirms (graduation) or a teach. The 17 quotes in the LIVE sandbox were already Full
> re-read + filed by the owner before the fix landed, so the exhibit itself is gone there.

> **SANDBOX MOVED (before the /newsession):** its data folder now lives OUTSIDE the job scratch at
> `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924` (userData · Output · Demo Docs · `exhibit-db-copy\`). The app was relaunched
> from there on CDP 9223 (PID 30092, launcher 12228 at the move; if gone, find it with `Get-NetTCPConnection -LocalPort 9223`
> or relaunch with `DOCUSNAP_USERDATA` = that `userData`). Everything under `%USERPROFILE%\.claude\jobs\68b38f39\tmp\`
> (gate arms, sbdb copies) is job-mortal — the RESULT.md files in the repo hold the numbers.

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
Screenshot `Pictures\Screenshots\Screenshot 2026-09-24 193056.png`; DB copy `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\exhibit-db-copy\`.
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
3. Build + pins + the sandbox gate. The sandbox app is RUNNING (CDP 9223 — see the SANDBOX MOVED note at the top; data folder
   `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\userData`, Output `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\Output`, Demo Docs copy beside
   it). **A main-process change needs the sandbox RESTARTED** to load it: kill PID 27684 + 27744 (`taskkill /PID … /T /F`),
   relaunch exactly as before —
   `$env:DOCUSNAP_USERDATA="C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\userData"; Start-Process cmd -ArgumentList '/c','npm start -- --remote-debugging-port=9223' -WorkingDirectory "C:\GIT Projects\Docusnap" -WindowStyle Hidden`
   (the data + the owner's admin account + the 17 quotes persist; the DB is at mig 215).
4. Tell the owner: "Quick-reprocess the Nordwind 17 again" and what to expect (each ≥ 90, then "files by itself").
5. Commit per slice; push when asked.

## Needs the USER
- The owner continues the sandbox test after the fix. Their Quote type: fields issuer / quote_number / quote_date
  (required) + total_amount (optional); their overrides "Quotation Ref", "Total (inc VAT)" (exclusive 0, template 0).
- Decide the DARK-vs-default question if the Oracle punts it.

## Key facts / paths
- Sandbox DB copy of the exhibit: `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\exhibit-db-copy\docusnap.db` (docs 11-24 = the quotes at
  31; doc 1 = the one that filed via `scope_sweep` at 100 after a FULL read).
- Quick road: `handler.js` ~5535 (`quick_reprocess_enabled`, ON since mig 203) → `shardGroups.push({ reextract: true … })`
  ~5580 → per-doc merge ~3760-3830 (C4 at ~3786) → `_updateDoc` ~3824.
- The imageless keep sites: ~1718 (empty-with-note), ~1809 (differing), ~1825-1834 (identity conf preserve).
- Scorer to mirror: `validator.overall_confidence` ~925-966 (`key_fields` = required else all; unread → 0; `exclude_keys`).
- Traps: edit scripts via the Write tool (bash heredocs with quotes fail); keep test labels ASCII (cp1252 console);
  `node --check` after editing the handler; the sandbox's `DOCUSNAP_USERDATA` hook is DEV-ONLY (a packaged build ignores
  it and would hit the live DB — never run `dist\…\ScanFinder.exe` on this PC).
