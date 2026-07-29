# HANDOVER 2026-07-29 EVENING (Opus 4.8)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `bb553dd`** · origin **2 commits BEHIND**
(`7b46bbe`, `bb553dd` UNPUSHED) · tree clean (only pre-existing untracked: `../Backup/`, `../Docusnap - Copy*`,
`HANDOVER_2026-07-28*.md`, `docs/SECURITY_HARDENING_REPORT_2026-07-28.md`, `scripts/remove-superstore-invnum-anchor.js`).
**No installer built this session.** Live DB `%APPDATA%\ScanFinder\docusnap.db` (mig unchanged). `ocr_dpi=200`.

## TL;DR
Owner-driven live-testing evening. SHIPPED (committed): CLAUDE.md de-bloat (pushed) + draw-tool perf lever DARK
+ **Slice 2** of a Copperfield-PO fix (po_number footer guard, unit-green). DESIGNED + advisor+Oracle-vetted, NOT
built: **Slice 1 learn-on-commit** (the keystone — owner's "the system has to learn when these docs are committed")
with a mandatory Oracle condition (C-A). DIAGNOSED, not fixed: an installer-freeze (one-off, not our code), a
teach-wizard label-read miss. Slice 2 corpus gate ran GREEN (M_type 0). No running processes at wrap.

---

## COMMITTED this session

### `262c26c` docs: trim CLAUDE.md session-state pile-up (1876→1049 lines) — **PUSHED**
Moved the stacked per-session state blocks 07-20→07-28 verbatim into `docs/session-log.md` (extends the archive to
07-28), kept only the 07-29 block + durable gotchas + a "replace-don't-stack" pointer. No content lost (each block
also has a `HANDOVER_*.md`).

### `7b46bbe` perf(review): concurrent draw-tool OCR reads — **DARK, UNPUSHED**
Owner: "box drawing insufferably slow on a 16-core, value fills then still waits." Root: per drawn box the teach/⊕
review flow runs TWO serial OCR waves — the VALUE read fills the field, THEN the left+above LABEL reads run — using
≤2 of the 4 warm workers. Label reads are geometry-only (independent of the value text) so they can overlap.
- Kill switch **`window.__drawConcurrentAnchor`** (setting `draw_concurrent_anchor_reads`, **default OFF = byte-identical**).
  ON: start the value read as a promise + fire `captureAnchorContext` concurrently → ~1 OCR wall-time instead of 2.
  `supplier_name` excluded (its anchor scope reads the just-populated issuer input); empty-read guard; the diag tee
  tolerates a value promise (serial/string caller unchanged). File: `src/windows/review/renderer.js` only (+47/−5).
- **eric + Oracle: SIGN OFF WITH CONDITIONS.** Focus-repair seam is safe (OCR completion is focus-inert; only a
  child-process SPAWN perturbs focus, cold-path/first-draw only, and concurrency moves it BEFORE the repair =
  equal-or-safer). **Conditions before flip:** **C1** (owner live smoke — set `draw_concurrent_anchor_reads=true` AND
  REOPEN Review; draw 4-5 fields, first-draw-of-session, a date field, supplier_name, an empty draw; staged anchors
  must match OFF + caret lands each time). **C2** (ship-with, mine to build): wire the unused `regionWorker.warmUp()`
  into Review-window open (kills the first-draw cold-spawn — the only focus-touch path). **C3** (mine to build): unit
  pin on `captureAnchorContext` string-vs-promise handling. Defer: empty-draw wasted OCR + first-date double-IPC.

### `bb553dd` fix(extraction): po_number/sales_order footer-boilerplate guard (**Slice 2**) — **UNPUSHED**
See the Copperfield section. Backend `keyword.py` only + `python_backend/tests/test_po_order_footer.py` (5 pins, all
green incl. kill-switch-OFF byte-identical + the Oracle-protected "Our Order No." own-ref). Corpus gate RUNNING (below).

---

## THE COPPERFIELD PURCHASE-ORDER FAILURE — 3 axes, one root (deep investigation)

Owner hit: a Copperfield PO held "No template match" + a stale type note despite 17 confirmed POs; then one PO's
Reference read as footer prose "on all correspondence and delivery notes". Six advisor/forensic agents
(herald, iris, reggie, gary, Oracle ×2) ran. **All root causes VERIFIED at the source.**

**⚠ Two of MY mid-session claims were FALSIFIED — do not repeat them:**
- I told the owner the refuse was a **64-bit phash-can't-separate-layouts** problem. **WRONG (herald).** The logo
  arm never even runs (nearest sibling dist 10 > the ≤6 accept gate). The real cause is the KEYWORD arm.
- I hypothesised enrichment was **gated on MATCHING** (refuse→no-match→no-learn). **WRONG (iris).** Even the 13
  MATCHED POs didn't enrich. The gate is **TEACHING** (only a taught confirm enriches).

**Verified root cause (iris + herald converge):** the identity-convergence step — append the doc's logo hash to the
multi-ref set (`addLogoHash`) + **intersect** the keyword fingerprint (`stabiliseFingerprint`) — lives in
`templates.update()` and runs ONLY on a **taught** confirm. Ordinary confirm / File-All / auto-file take
graduation create-or-pure-LINK (graduation-C1 forbids `update()`), so graduation-born templates FREEZE at 1 logo hash
+ a fingerprint polluted with the sample doc's CUSTOMER tokens ("Sandpiper/Hotels" on the PO template id3). Effects:
(a) the PO fingerprint scores 0.70 < the 0.80 rescue floor while the invoice fingerprint is a pure-letterhead subset
scoring 1.0 (a "letterhead magnet") → invoice wins the keyword arm → trusted-title refuse → hold; (b) the frozen
logo set can't isolate the PO layout. **iris PROVED by replay** (`scratchpad/enrich_replay.py`): current(1 hash)=
**11/20 POs match the INVOICE template** (latent silent-misfile, saved today only because the title is read); enriched
(symmetric per-type)=**all 60 docs match own-type, ZERO cross-type flips**, held docs resolve by LOGO ALONE. The same
intersect strips the pollution → PO rescue 0.70→0.80+ (herald's text path recovers too). ONE missing call = both bugs.

### Slice 2 — po_number/sales_order footer guard — **BUILT `bb553dd`** (reggie design, gary staged)
The ref read footer prose because the injected bare label "Order Number" (`PO_ORDER_NO_LABELS`) matched the footer
"quote **our order number** on all correspondence…" and loose `alphanumeric` validation (un-anchored `re.search`, no
digit req) accepted the prose. Downstream of the refuse (starved anchor → keyword fallback) BUT a real reusable hole.
- **Part 1** `PO_ORDER_INSTRUCTION_SKIP` (default ON): `_order_caption_is_instruction` skips a bare "order no/number"
  whose TAIL is a prose lead-word (on/in/with/…) or that follows an instruction verb (quote/cite/…). Leaves the
  "our"/"your" own-ref exemption intact (the tail is the discriminator). OR'd into `keyword.py:1166`.
- **Part 2** `PO_REF_DIGIT_GATE` (default ON): after `_clean_value`, an order-family value must carry a ≥2-digit
  spaceless run (`\d\S*\d`) — un-anchored + space-tolerant so a noisy real header (`, p0-22954`) still reads
  (deliberately looser than `reference_code`; avoids the 2026-07-24 null regression). Fail toward review.
- Backend-only; shared `validation_patterns` UNTOUCHED (renderer keys off field TYPE at `renderer.js:65`). Closes the
  symmetric `sales_order_number` hole. Both kill switches OFF ⇒ byte-identical (pinned). **⚠ Cosmetic follow-up
  (deferred, reggie): the "Order No" header stores a leading comma `, PO-…` — the right-strip omits ","; add it.**
- **VERIFICATION: unit test GREEN (5/5). Corpus gate GREEN** (`realdoc_regression.js`, 57 confirmed docs): supplier
  100% / date 100% / ref 98.2% / **M_type 0**. The ONE ref regression (#33 invoice `INV-121`→`INV-12110`, SILENT) is
  **invoice_number = PRE-EXISTING, NOT Slice 2** — the digit-gate is field-scoped to `('po_number','sales_order_number')`
  and the instruction-skip only fires on bare-"order" labels, so invoice_number is provably untouched (field-scope
  proof; a formal OFF-vs-ON corpus A/B was NOT run — but is airtight by scope). No po_number/sales_order regression.
  LIVE on next reprocess (bytecode cache cleared).

### Slice 1 — LEARN-ON-COMMIT convergence + backfill (the keystone) — **DESIGNED, NOT BUILT**
gary's staged design + **Oracle SIGN OFF WITH CONDITIONS (GO to BUILD, NO-GO to FLIP until C-A).**
- Extract the identity-convergence body of `templates.update()` (`templates.js:~985-1023`) into
  `templates.enrichIdentity(db,id,{logo_phash,logo_detail_hash,keyword_fingerprint})` (count-free, field-free).
- New guarded `learnTemplateOnCommit(ctx,db,docId,{document_type_slug,supplier_name})`: kill switch
  `TEMPLATE_LEARN_ON_CONFIRM=0`⇒no-op; resolve final template_id (null→return); **TYPE-SCOPE** (template slug==
  confirmed slug); **SUPPLIER-VALIDATE** (`establishedIdentity` non-disjoint, Part-E mirror); then `enrichIdentity`.
  Wire on THREE routes: single confirm (`reviewService.js` !bulk chain AFTER `onScopeGraduated`, only when NOT a
  taught confirm), File-All/bulk (mirror the routing detached call `:338`, runs on bulk too), auto-file (end of
  `_autoFileDoc`, fail-open). **SYMMETRIC across all types** (asymmetric inverts safety). No file write (DB is the
  matcher's source). No schema/migration.
- **1c reversible backfill** `scripts/template-enrich-backfill.js` (app-closed, dry-run default, `--apply`/`--revert`,
  JSON snapshot): replays `enrichIdentity` over each template's already-confirmed linked docs, per-doc supplier+type
  validated. Heals existing frozen templates → owner reprocesses → held POs match. (Bootstrap: held docs won't clear
  by reprocess alone until this runs; bulk/File-All confirm currently skips the learn hooks — the fix must cover the
  route the owner uses.)
- **⚠⚠ C-A (Oracle ship-blocker, MANDATORY before flip — fold in at BUILD time):** the naive hook re-plants a logo
  graduation's **C3 guard deliberately withheld.** C3 seeds a template KEYWORD-ONLY (logo_phash=null) on a
  cross-supplier logo collision (≤`COLLISION_DIST`=10); `enrichIdentity`'s logo step is **seed-if-empty + append**
  (NOT intersect), so it would seed that withheld logo → **future silent cross-supplier misfile** (the 64-bit phash
  hashes letterhead LAYOUT, so same-layout different-supplier is the danger zone). gary's "impossible by construction"
  is TRUE for the fingerprint (intersect-only) but **FALSE for the logo set.** FIX: `enrichIdentity({appendLogoOnly:
  true})` from the automatic hook + backfill — enrich the logo only when the template ALREADY has a logo; never seed a
  new primary logo automatically. The fingerprint intersect (the real healer) stays.
- **Other Oracle conditions (pre-flip):** **C-B** behavioural pin (C3 keyword-only template + colliding-logo commit ⇒
  logo stays NULL + no `template_logo_hashes` row; + null-`establishedIdentity` mislink ⇒ no foreign hash) RED before
  C-A, green after. **C-C** supplier-AWARE audit (every logo hash traces to a confirmed doc same-slug **AND** non-
  disjoint issuer — gary's was type-only, would pass a Copperfield hash on a Larkspur PO template). **C-D** prove
  backfill apply→revert round-trip byte-identical on a live-DB COPY (snapshot ALL identity state incl. every
  `template_logo_hashes` row + detail_hash; cap-eviction can drop a pre-existing hash). **C-E flip gate:** iris
  `enrich_replay` 0-flip on the FULL 60 + `template_gate_probe.py` + `--apply`'d live-DB-COPY matcher run (held POs
  resolve, M=0/M_type=0) + the C-C audit + C-B green. **Note:** `test_graduation_wiring.js:48` (C1 pin) stays green
  but is MEANINGLESS for this hook — it pins the graduation module, not `enrichIdentity`; do not treat it as coverage.
- Confirmed benefit (Oracle-credited): the fingerprint intersect heals the customer-token pollution on EVERY confirm.

### Slice 3 — herald title fixes — **PARKED**
herald A (feed the recovered red-channel heading into the rescue overlap) — **do NOT build** (it lifts the same 0.80
overlap Slice 1's intersect lifts → double-count that would MASK a Slice-1 regression from the gate). herald B
(trusted-title fall-through: bind a same-supplier correct-type sibling HELD) — **build DARK** later, flip only if a
residual survives Slice 1 (likely subsumed). Both agreed by gary + Oracle.

### Honest residual (gary+Oracle, deferred to branding-primary backlog)
A brand-NEW multi-type-on-one-letterhead supplier's FIRST PO, `title_trusted=False`, before its PO template has any
confirmed PO to converge from → the invoice letterhead-magnet can still silently misfile as invoice. Pre-existing
(iris's "11/20 latent"), NARROWED not eliminated by Slice 1, not covered by herald B. Do NOT widen Slice 1 to chase it.

---

## DIAGNOSED, not fixed

### Installer froze the PC at the Finish page (owner report)
One-off on the owner's laptop (fresh install, AVG disabled, SSD, app fine after). **Not our code** (installer.nsh
does nothing heavy at finish; app launches only on Finish click, and clicking Finish ENDED the freeze). Most likely
the Windows shell / SmartScreen reputation check on the new **unsigned** exe hanging Explorer briefly. Durable fix =
**code-sign the installer** (known backlog). Optional: `nsis.runAfterFinish:false`. Watch for a repeat on another PC.

### Teach-wizard label read fails ("Couldn't read the caption cleanly") — owner suspected DPI
**NOT the `ocr_dpi=200` setting** (verified): the teach wizard renders its OWN preview at `TEACH_RENDER_SCALE=4.0` =
288 DPI and crops native (`TEACH_NATIVE_CROP`) — `ocr_dpi` only drives the extraction page render. Found a REAL but
probably-not-causal coordinate bug: `src/windows/teach/renderer.js:779/795` recompute a downscale `ds≈0.42` that
IGNORES `TEACH_NATIVE_CROP` (crop is sent native at ds=1.0), so the label word-box coords are mis-scaled — but
`nearestRowTo` has no distance threshold so a SINGLE-row band still returns the row (won't fully explain a miss).
**Leading hypothesis (NOT reproduced):** the label band spans the whole width left of the value, so it contains the
big RED "PURCHASE ORDER" heading beside the small black "Order No." → region OCR loses the small caption (garble one
time, nothing the next). **NEXT:** reproduce the actual band slice (owner rule: look at the slice) → fix the read +
the `ds` frame bug. Small, teach-renderer-only.

---

## FIRST ACTIONS (fresh session)
1. **Slice 2 corpus gate = GREEN** (already read: M_type 0, supplier/date 100%, the 1 ref miss #33 is pre-existing
   invoice_number, not Slice 2). Slice 2 is ready to ship. Optional: a formal OFF-vs-ON A/B if you want it measured
   rather than field-scope-reasoned.
2. **Build Slice 1 dark** (keystone, owner's requirement) with **C-A `appendLogoOnly` folded in from the start**, the
   `enrichIdentity` extraction, the guarded hook on all 3 commit routes, the C-B pins, and the 1c backfill — then the
   C-E flip gate (C-C supplier-aware audit + backfill round-trip + iris replay + live-DB-copy matcher run). Kill switch
   `TEMPLATE_LEARN_ON_CONFIRM`, default OFF until the gate + owner OK.
3. **Draw-perf flip prep**: build C2 (`regionWorker.warmUp()` on Review open) + C3 (the string/promise pin); then the
   owner does the C1 live smoke; then flip `draw_concurrent_anchor_reads`.
4. **Teach-wizard label read**: reproduce the band slice + fix (+ the `ds` frame bug).
5. **Push decision** — 2 unpushed (`7b46bbe`, `bb553dd`).

## NEEDS THE USER
- Slice 1 backfill `--apply` (app-closed) after Slice 1 builds + gates, then reprocess the held Copperfield POs.
- Draw-perf C1 live smoke (see `7b46bbe` above).
- The 20 held Copperfield POs meanwhile: values are correct (bar the now-fixed footer ref) — File-All to file them,
  OR wait for Slice 1 + backfill then reprocess (they'll auto-match). Reprocess alone won't clear them pre-fix.
- Untracked `HANDOVER_2026-07-28*.md` + `docs/SECURITY_HARDENING_REPORT_2026-07-28.md` + the SuperStore removal
  script: commit or leave (carried from prior sessions).

## KEY FACTS / PATHS
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only replay `?mode=ro`). Copperfield templates: id1 delivery,
  id2 invoice, **id3 purchase_order** (all `confirmed_count=0` stored — live count derived; id3 has 13 linked POs).
- Run keyword unit test: `cd python_backend && py -3.12 tests/test_po_order_footer.py`. Clear
  `python_backend/**/__pycache__` if a Python change doesn't take effect.
- Corpus harness: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js` (spawns the
  Tesseract fleet — heavy; don't run during the owner's live session).
- Forensic scratchpad (this session's proofs): `…\scratchpad\enrich_replay.py` (iris), `doc43_band_raw.png`, `exp2.py`
  (herald), matrices — under the session temp dir.
- Agents used: eric, oracle ×2, iris, herald, reggie, gary — all registered types.
