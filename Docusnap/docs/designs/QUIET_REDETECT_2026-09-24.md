# Quiet redetect after a type / override change — design record (2026-09-24 evening 2)

**Owner ask (verbatim intent):** "Some new docs won't recognise a supplier and the type may not yet have been added
from the catalog. Could we do a quick reprocess after every confirm for all docs from that supplier — or for
unrecognised docs everything in the queue — so everything gets categorised quickly, then further confirms allow
auto-file?"

**Advisors:** gary (design + tests) · eric (main-process lifecycle) · Oracle (vet; `docs/oracle_log.md` 2026-09-24
evening 2 — A: SIGN OFF WITH CONDITIONS C1-C7 · B: DO NOTHING · C: DO NOTHING). Switch `quiet_redetect_on_type_change`
(mig 216, DARK); ledger `docs/DARK_SWITCH_LEDGER.md`; gate `TESTING/_measure/quiet_redetect_gate_20260924/RESULT.md`.

## What already existed (verified at source)
- The quiet re-read lane (`src/modules/processing/quietLane.js`, S3 2026-08-21, `quiet_reread_enabled` ON since
  mig 93) re-reads a sender's held template-less docs after a TAUGHT confirm, a layout write, a graduation mint, the
  READY crossing, Learning Repair. Guards: invisible to `_anyProcessingBusy`, pre-empted by every foreground spawn,
  merge gate (viewer / status / rows / `expect` fingerprint in the row txn), S3-C5 changed-read hold, the reliability
  first-fill hold (released at finish unless the field proved unreliable), filing only via the sweep.
- Nothing fired on a type create / catalog add / re-enable / alias edit or an override save; the lane was FULL-only.
- The imageless `--reextract` run reuses cached text and still runs `detect_document_type` (process_docs.py:1154,
  outside the :1067 branch) — a new type IS detected on the Quick road. Since the same day the Quick road can RAISE a
  stale score (Quick-rescore, Plan-B C4 re-ruled).
- Slice B prior art: `offerIssuerRipple` ("Apply 'X' to N & re-read") — deliberately an OFFER with a count.

## The three slices
- **A — BUILT (DARK).** A type becomes available (created / catalog / re-enabled / aliases edited, desktop or /v1) or
  a Keyword Label Override is saved/removed → the lane's new scope-less kind `redetect`: Quick (`reextract`) pass over
  the held template-less docs whose type is NULL or the General Document placeholder (key `*|redetect`), or — for an
  override — the held template-less docs of that type (key `<slug>|redetect`). Cap 400 newest, docs whose
  `detected_type_name` names one of the job's types first; a doc whose OCR cache is unusable is SKIPPED and counted,
  never staged Full; no sweep scope marked, no auto-accept fan-out; scoped jobs tick first. **Gate finding (same
  evening):** a born-digital doc (`bd_used`) is refused by the batch predicate for a COST reason (its Quick skips OCR;
  a born-digital Full is nearly free) — that made the redetect a no-op on the whole Demo Docs population, so the
  redetect asks the same predicate with only `bd_used` waived (`allowBornDigital`; every other invalidator applies;
  the lane is the only caller). ⚠ Not put to the Oracle as a separate question — flagged for a morning re-rule.
- **B — DO NOTHING.** On the Quick road a re-read carries nothing of a typed name to a no-supplier sibling
  (identity_fusion never fills an empty issuer; hints need usage ≥2; the logo plant is text-gated, Full-only and
  unreliable on scans; a lone confirm links but never creates a template). The ripple offer is the honest lever.
  Optional B′ later: let the accepted ripple's re-read ride the quiet lane Quick.
- **C — DO NOTHING.** The READY arm + the graduation mint already cover "the confirm that makes a sender fileable";
  a spawn per confirm is churn.

## Oracle rulings applied
1. No wildcard sweep block, no `onJobDone` fan-out (`_autoAcceptScope` refuses `quiet-lane-active` with no re-queue;
   `job_done` already re-asks the queue-wide consent bar).
2. `via:'redetect'` on the reliability branch (never an unconditional role hold — `REPROCESS_CARRY_LANE_HOLD` would
   carry it through the later Full re-read and the sweep would never file).
3. Generic→X re-type: rows dropped, NO "type changed" note (General Document is a placeholder) — paired with **C1**:
   the scoped arms (`_candidates` both queries + `_ownedTemplateRows`) now admit Generic-typed docs under the switch
   (they were silently skipped since mig 93).
4. A2 (overrides) in; **C5** an override on an identity/name key holds first-fills of that key with an unconditional
   "Read from the label you added — confirm once." (G1/G2 guard taught boxes, not keyword captures).
5. UI minimum: `_isActivelyViewing` covers the Not-recognised tab; a blank-scope hint copy. No KINDS extension.
- **C3** blank-supplier docs key their reliability witness bucket per document (`doc:<id>|<slug>`).
- **C6** the Quick-rescore cap keeps a redetect merge with a kept row below 100 (pinned in the rescore test).
- **C7** `update-document-type` fires on `title_aliases` OR `enabled` 0→1.

## Build map
`quietLane.js` (constants, deps, `_scheduleRedetect`, `_redetectCandidates`, `_genericAdmitId`, `_markScope`, tick
ordering, C5 hold, finish/status) · `rereadHolds.js` (`_scopeOf` per-doc for a blank supplier; `holdFirstFills`
`opts.onlyKeys`) · `processing/handler.js` (`_redetectEnabled`, `scheduleQuietRedetect`, lane deps `redetectEnabled` /
`quickUsable` / `genericTypeId` / `isIdentityKey`, `runShard` `reextract` forward, quick staging's C2
`known_template_id` mirror, the Generic flip-note split) · `settings/handler.js` (`_afterDetectionChange` + 8 doors) ·
`api/handler.js` (POST doc-types) · `review/renderer.js` (viewing predicate + hint) · `database/index.js` mig 216 ·
`dark_switches.js` (14 keys) · count pins 137/163/205.

## Pins
`test_quiet_lane_redetect.js` (10 sections) · `test_migration216_quiet_redetect.js` · `test_reread_holds_blank_supplier_scope.js`
· `test_detection_change_triggers.js` (17) · `test_reprocess_type_flip.js` §5 · `tests/test_reextract_type_detect_order.py`.

## Gate (see RESULT.md)
OFF and ON arms on the owner-sandbox exhibit copy: add the missing catalog types → the ON arm's redetect audit lists the
untyped docs, typed-wrong 0, wrong-filed 0, OFF unchanged; then save a Quote override → the 17 quotes re-read Quick.
Not exercised on real data: Generic-typed docs (the copies hold none) — covered by the C1 unit pin; the
"graduated lane lists the formerly-Generic docs → sweep files them" leg is the same road arm B of the Quick-rescore
gate proved on the 12 quotes.
