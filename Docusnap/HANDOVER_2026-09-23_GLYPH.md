# HANDOVER — PP-OCR confusable "second reader" + this session's work (2026-09-23)

Branch `feat/teach-side-overnight`. **HEAD `546efc7`, all pushed.** Migration **207**. `TEST_SWITCH_KEYS` **11**.
`node scripts/run-pins.js` = **413/413 green**. Read this before continuing the glyph work; then `CLAUDE.md`.

---

## THE FEATURE — PP-OCR "second reader" confusable hold (DARK: `glyph_fallback_enabled`, mig 207)
The owner's problem: a scanned reference like `1G25802868` is read as `1625802868` (a letter `G` seen as digit
`6`; also `1`↔`I`, `O`↔`0`). Owner's thesis "Tesseract is the bottleneck" — CONFIRMED by measurement: a second
recognizer (PP-OCR, `en_PP-OCRv3` rec via onnxruntime) reads the glyph correctly where Tesseract can't. Oracle
verdict: **SEND BACK → RE-RULE SIGN-OFF-W/COND** (2026-09-22, `docs/oracle_log.md` bottom) on the corrected live
exhibit. Built in slices, all DARK, all pinned:
- **S0** `python_backend/ocr/glyph_reader.py` — deterministic rec-only engine, direct onnxruntime (no rapidocr
  wrapper, no OpenCV; cv2-equivalent numpy bilinear). Vendored model `python_backend/ocr/models/rec.onnx`
  (en_PP-OCRv3, 8.97 MB, Apache-2.0, dict embedded in ONNX metadata) + `.sha256` + README. 222/222 parity with
  rapidocr, two-process byte-identical, runs under `vendor/python`. Pin `tests/test_glyph_reader.py` (4).
- **S1** `engine._glyph_disagreement_hold` (engine.py ~6816), wired at the flag site (~11960). On a scanned
  ref-role read, re-reads the crop with PP; on DISAGREEMENT holds the doc (cap conf ≤69 + neutral note naming
  BOTH readings). NEVER overwrites, NEVER auto-files, NEVER a corroboration candidate (Oracle C1). Setting→env
  mirror in `src/modules/processing/handler.js:419`. Pin `tests/test_glyph_disagreement_hold.py` (16).
- **S2** refined the trigger to **single-glyph swaps** (alnum-normalise + SAME length + EXACTLY ONE differing
  position) after the census found the raw trigger false-held 14%. Census
  `TESTING/_measure/glyph_fallback_census_20260922/RESULT.md`: safety PASS (wouldFile(ON)⊆wouldFile(OFF),
  0 value changes, false-hold 0.2%); efficacy 2/2 on the owner's real Print Tracker doc (p7 `RFH0738865`,
  p11 `1G25802868`).
- **Import-log** lines (f3d1be5): "Second reader checked the reference '…' — agrees." / "Second reader
  disagrees … — holding this document for you to check." (`engine.log`→import log).
- **Anchor-read coverage** (8480f27, gary-designed): the crop resolver only read `_s05_read_geom` (Stage-0.5
  MAPPING), but real Print Tracker refs read via the **ANCHOR** stage (`anchor_inline`/`anchor_crop`/
  `anchor_crop_relocated`). Added `_winning_read_geom(data)` (prefer `box` over `taught_box`) + capture into
  `self._field_read_geom` after the anchor merge (engine.py ~11090) + a resolver fallback. Byte-identical off.
- **Diagnostic tracing** (546efc7): `self._t('glyph_check', outcome=abstain|agree, reason=…, has_anchor_geom=…)`
  at the no-box abstain + agree branches (trace-only) — so the diag log shows whether the check RAN.

## ⚠ THE OPEN QUESTION (resume here) — does the second reader actually FIRE on the owner's real docs?
Two diag reads of the LIVE session file (`Debug/diagnostic_2026-09-23T08-02-30-364Z.jsonl`, dev app writes to
`<repo>/Debug/`) show **0 glyph holds** on the 34-page Print Tracker batch. Why, established from the diag:
- **p7 `RFH0738865` + p11 `1G25802868` are ALREADY HELD by the existing anchor machinery** (p7 has a review
  note, p11 committed no value). My method SKIPS an already-noted field (one-note-per-field) → correct, no
  double-flag. So the two confusables are caught — by the EXISTING reader, not the new one.
- **31 refs read clean (value, no note)** via anchor — these are what the second reader SHOULD check. The diag
  captures only TRACE events, not the `engine.log` "Second reader" lines, so I could not tell from it whether
  the check ran-and-agreed (good) or silently abstained (anchor-box capture not working).
- **ACTION:** the `glyph_check` tracing (546efc7) now answers this. **Have the owner reprocess ONE Print Tracker
  page** (dev app re-spawns python per run → picks up the new code; the running instance already has
  `GLYPH_FALLBACK_ENABLED=1`), then read the newest `Debug/diagnostic_*.jsonl` for `event:'glyph_check'`:
  `outcome:'agree'` on the 31 = the fix works (belt-and-braces confirmed); `outcome:'abstain' reason:'no_box'
  has_anchor_geom:false` = the anchor-box capture is NOT populating (debug `_winning_read_geom` vs the real
  committed ref data — the `+corrected`/suffix methods may not carry `box`/`taught_box`).
- **HONEST BOTTOM LINE forming:** on the owner's REAL Print Tracker docs the EXISTING anchor arms already flag
  the confusable refs, so the new second reader's marginal value there is a backup, not the primary catch. Its
  unique value is a CONFIDENT-WRONG-with-NO-flag ref, which did not occur on this batch. Confirm with the trace,
  then decide with the owner whether the feature earns a flip or stays a dark safety net.

## ⚠ THE "NO AUTO-FILES" QUESTION — Print Tracker IS graduated; likely the reads sit just below the 95 floor
Owner corrections (load-bearing): **Print Tracker is NOT a new supplier — it is established/graduated** (custom
type `print_tracker`, its own template "Print Tracker Doc", 135 learned format rules — confirmed in the diag
`doc_context`), and **graduation is teach + 2 confirms**, not 10. So the earlier "new supplier / graduation gate"
explanation was WRONG. The owner did 1 reprocess + 1 fresh IMPORT; no auto-files on either.
- **Reprocess NEVER auto-files** (handler.js:4092, by design) — that half is expected.
- **The fresh IMPORT is the real question.** Traced the gate (`trust.js isAutoFileEligible`):
  - `floor = (graduated) ? Math.min(userThr, 95) : userThr` (trust.js:1278). So a GRADUATED scope needs
    **overall_confidence ≥ 95** (the `auto_file_threshold`=100 does NOT block graduation — min caps at 95).
  - `CRITICAL_FIELD_FLOOR = 88` (trust.js:74): the ref/date must EACH clear 88.
  - Plus: no `validation_note` on any role field, and `docTrustGate` (template match + every valued field
    verifiable) for any sub-100 auto-file.
- **Evidence from the live diag** (`Debug/diagnostic_2026-09-23T08-02-30-364Z.jsonl`, per-doc `final` events):
  refs read 87–98 (via `anchor_inline`/`anchor_crop`/`anchor_crop_relocated`), dates 94–98, mostly NO notes.
  BUT several `anchor_crop_relocated` refs read at **87 — one below the 88 critical floor** (W2E8X06407,
  C738JB00279, 1984800049, H571Y07217) → those docs are held on the critical-field floor alone. For the 90–98
  ones, the **overall_confidence BLEND** (all fields, incl. the 87–90 anchor reads) very likely lands **< 95**
  → below the graduated floor → held.
- **THE MISSING PIECE (resume here):** the actual `overall_confidence` per doc AND the `isAutoFileEligible`
  `reason` are computed JS-side and are NOT in the python diag jsonl (which only has per-field trace). To nail
  it: (a) add a JS-side auto-file-decision log in `_maybeAutoFile`/`_autoFileDoc` (handler.js) that records
  `{docId, overall, eligible, reason, floor}` per import doc, OR (b) ask the owner to read one held doc's overall
  in Review, OR (c) have the owner query the live DB (`SELECT overall_confidence FROM documents WHERE …`). If
  overall ≥95 + no notes + docTrustGate-clean and STILL not filing → a real gate bug; if overall <95 → the reads
  plateau just below the floor (a calibration/friction question: graduated Print Tracker anchor reads land ~90–94,
  under the 95 auto-file floor — the same class as the historical SuperStore "228 confirms, reads 96–97" note
  that dropped the floor 98→95; the anchor plateau here is lower still).
- **Owner's own note:** "teach + 2 confirms will autofile docs" — so the graduation path works; the question is
  purely why these specific reads don't clear the 95 overall floor. NOT the glyph switch, NOT a new-supplier gate.

## ENABLING IT LIVE (how the running app has it on)
Dev app launched with `GLYPH_FALLBACK_ENABLED=1` in its environment (the DB setting stays 'false' — env override
only, reverts on a normal restart). Dev `py -3.12` has onnxruntime + resolves the vendored model. The spawn env
includes `...process.env` (handler.js:4129 import, :4131 reprocess) so the shell env reaches the python. To
re-enable after a restart: `GLYPH_FALLBACK_ENABLED=1 npm start` (or set the `glyph_fallback_enabled` setting to
'true'). The running instance at handover is the dev app (log `…/scratchpad/live-glyph.log`).

## OWED before any customer default flip (dark_switches.js FLIP GATE + Oracle)
1. Oracle vet of the anchor-read WIDENING (gary designed it as inside the signed envelope; get the formal nod).
2. The anchor-path false-hold census on REAL data (the synthetic 700 corpus reads via MAPPING, can't exercise
   anchor) — use the owner's Print Tracker reprocess + the `glyph_check` traces as the census.
3. onnxruntime + the model vendored into the SHIPPED build (proven to load under vendor/python; not yet in the
   installer's `files`/extraResources). Add PP-OCR model + onnxruntime to `THIRD-PARTY-LICENSES.txt`/`COMPLIANCE.md`.
4. Determinism release-gate (vendor/python load) + the trade-lock pins already in the pin file.

---

## OTHER WORK THIS SESSION (all pushed)
- **Security review** `docs/SECURITY_REVIEW_2026-09-22.md` — no new Crit/High code vulns. Do-first: **H1** admin
  console 2FA optional by default (licence-minting console) → provision TOTP + verify on host; **H2** unsigned
  installer → code-sign; **M1** backend MySQL unencrypted PII (names/emails/IPs) — the real backend crown-jewel is
  the Ed25519 signing seed file, not the DB; **M2** desktop SQLite plaintext OCR text (encryption arc DARK) —
  largest data gap; **M3** LAN add-on lacks per-doctype ACL unless Departments configured; **M4** /v1 rate limiter
  fails open if table absent; **M5** exposure protections Apache-only.
- **Chris full-app vet** `docs/CHRIS_FULL_APP_REVIEW_2026-09-22.md` — verdict YES; F1/F2/F3 fixes CONFIRMED live;
  every destructive warning told the truth. 6 new findings, top (medium): the teach read-back accepted a customer
  name+ADDRESS as the "company name" (preview-only, discardable). Others low/copy. NONE implemented — owner triage.
- **Logo propagation** for the "Not recognised" tab → logged in `pendingfeatures.md` (2026-09-23): teaching one
  unrecognised doc should re-check the OTHER unrecognised docs against the newly-learned logo (barry/Oracle-gated).

## COMMITS THIS SESSION (feat/teach-side-overnight, all pushed)
`6198c1c` S0 engine · `62434f3` S1 hold · `e75c574` S2 census · `bcbd7be` security · `c3c68fa` night-ledger ·
`ecb42f7` Chris · `f3d1be5` import-log + pendingfeatures · `8480f27` anchor-read coverage · `546efc7` glyph-check trace.

## GOTCHAS
- Dev diag log = `<repo>/Debug/diagnostic_<stamp>.jsonl`; captures TRACE events (`self._t`), NOT `engine.log`
  ("Second reader …" lines go to the import-log UI only). Diag on = the running app's diagnostic logging setting.
- Live DB `%APPDATA%\ScanFinder\docusnap.db` BLOCKED to Claude's tools — ask the owner or use `!` for live queries.
- Python re-spawns per import/reprocess → engine.py edits take effect on the NEXT run, no app restart.
- Commit via the Bash tool with a heredoc; BACKTICKS in the message get shell-evaluated (8480f27 lost two words) —
  avoid backticks or escape them.
