# Accepted-debris-trim allowlist — CLOSED DESIGN (build after the night batch commits)

**Status:** design complete, Oracle **SIGN OFF WITH CONDITIONS** (2026-07-11; C1+C2 blocking).
User-requested: an Accept button on the "Trimmed OCR debris from the read — please verify" flag;
once accepted, that exact debris on that ISSUER + DOC TYPE (hard user constraint) is trimmed
silently, never warned again, no confidence penalty from the trim. Cycle: gary design → Oracle.

## Key facts (gary, Oracle-verified)
- The trim = `_recover_clean_token` (anchor.py:186-218; exactly-one-valid-token contract, debris
  tokens ≤2 chars w/ non-alnum, ≤3 debris chars). THREE emitter sites set
  method=anchor_crop_recovered (anchor.py:447-450, 804-808, 867-871). Pre-trim raw is DISCARDED
  (handler.js:1020-1021 writes raw=display=trimmed) — signature not derivable from DB today.
- The user's @50 = the UNLOCATED-POSITION cap (anchor.py:1074), NOT the trim. Acceptance removes
  the nag; the 50 stays; the position cure is a ⊕ re-teach (then located+shape reads commit
  clean ≤95). Tiers: unlocated+shape-ok 50+note → accepted: 50 NO note (position cap PINNED
  §2b); located+shape-ok 87 no-note → accepted: base ≤95 (the 87 one-glance cap lifted — SEE C1);
  off-shape → acceptance INERT; different signature → nag unchanged.

## Design
- Key: (supplier _accept_norm, doc_type_slug, field_key, signature) EXACT — field_key
  deliberately tighter than the user's floor; NO global/cross-supplier/cross-doctype fallback.
- `debris_signature(raw, clean)` pure public in anchor.py: raw ws-tokenised, the ONE recovered
  token → '*', single-space joined, UPPERCASED ('. = 317437' → '. = *'). Reusable by the
  deferred PF_wor_36 qualify-reject site (ONE allowlist for both).
- Transport: the note itself carries the pattern — 'Trimmed OCR debris from the read
  (pattern: ". = *") — please verify the value.' Renderer parses + parrots back (one computer;
  no schema change; raw_value follow-up recorded).
- Plumbing = accepted-names twin: settings JSON 'accepted_debris_trims'; learning.js
  add/get/remove (4-tuple dedupe); IPC accept-debris-trim (admin/edit; issuer = ON-SCREEN
  Document Issuer at click; slug resolved DB-side; note-clear by regex; audited); preload;
  --accepted-debris-file; engine.set_accepted_debris + _debris_index_for(supplier,slug) FRESH
  at BOTH extract_with_anchors call sites (engine.py:1682, 2003); anchor.py kwarg
  accepted_debris (pre-scoped dict field_key→set(sig)); renderer button. NO kill switch
  (empty allowlist = off, pinned).

## Oracle conditions (C1+C2 BLOCKING)
- **C1: the >87 lift for ref/date fires ONLY behind an authoritative-crosscheck rail.** His
  seam catch: recovered reads SKIP the anchor.py:613 crosscheck (method flipped to
  anchor_crop_recovered before it) — today harmless because 87 < the 88 floor; the lift revokes
  exactly that stop. Concrete channel: leader-dot forms where '. =' is row furniture on EVERY
  row → a one-row drift reads the DATE row into the ref field → recovery+accepted signature+
  located+digit-fold shape pass → ≤95 clean → silent wrong auto-file on a graduated scope.
  Rail: run the crosscheck on the recovered read (compare the label's inline value, debris-
  trimmed the same way, via _reads_disagree); disagreement → no lift + flag; no derivable
  inline value → stay 87 note-free. PIN with a test that FAILS if the lift ever goes
  unconditional. (Alternative: defer the whole lift to slice 2.)
- **C2: note grammar injection-proof** (debris can contain quotes/parens — '" *' breaks a naive
  regex); fixed delimiters/escaping, ONE shared fixture string asserted Python-emit + JS-parse.
- C3: the renderer button must be added INSIDE the isApplied branch (renderer.js:1524-1525 —
  recovered rows render the corrected-badge with NO buttons today; all existing accept buttons
  are !isApplied-gated).
- C4: accept-time honesty UX — when the accepting read was unlocated (≤50) or shape history is
  cold, say the confidence stays low / nag may recur until re-teach or more confirms. Release-
  note: pre-change docs carry the old note text → no button until reprocessed.
- C5: JS stores the parsed signature VERBATIM (Python is the sole normaliser); entries visible
  + removable (remove IPC + Settings→Learning memory inventory).
- C6 gates: corpus A/B with EMPTY allowlist → metric-identical INCLUDING needs_review counts
  (the note text changes for everyone; routing must not); seeded-acceptance per-doc A/B;
  realdoc M=0 + zero per-field drop; unit battery gary §1-§2f + the C1 disagreement pin + the
  C2 fixture. Neighbour suites: test_recover_clean_token.py, test_identity_anchor_scope.py,
  test_late_anchor_rescue.py, test_anchor_name_lock_guard.py.

## Honesty items (tell the user)
- The motivating doc (PO3618@50) stays @50 after accepting — the warning goes; the 50 is the
  position axis; re-teach cures it. The 87→95 lift benefits LOCATED docs and is an auto-file
  policy change standing on the C1 rail, not on the user's quote.
- Jittery debris under-delivers by design (glued '.=' vs spaced '. =' = different signatures;
  digit/letter flicker re-nags). Recorded widening (debris-region space-insensitivity) only if
  live repeats bite — never silently.
- Non-interference contract with the gate-failure re-read design: any new/moved
  anchor_crop_recovered emitter must set _rec_sig from ITS OWN raw per attempt; confidence
  lifts compose via explicit min/max.

Files: anchor.py (186-218, 447-871, 963-1156, 613 crosscheck), engine.py (403-421, 1682, 2003),
process_docs.py, learning.js (1162-1190), processing/handler.js (244-330, 1020-1024),
review/handler.js (277-301), review/renderer.js (1498-1528), trust.js (228-238, 443-467).
New tests: python_backend/tests/test_accepted_debris.py, database/modules/test_accepted_debris.js.
