'use strict';
/*
 * quietLane.js — the QUIET BACKGROUND RE-READ LANE (Slice 3 of the "teach 1 → import N → it files
 * itself" arc; eric + gary design → Oracle SIGN-OFF ON DESIGN with conditions S3-C1..C6, 2026-08-21;
 * DARK behind `quiet_reread_enabled` / QUIET_REREAD).
 *
 * THE PROBLEM. The owner: "I teach one document, then import 100 — or import 100 and teach one from
 * the pile — and then I have to REMEMBER to press 'Reprocess this supplier'. A customer presses
 * 'Process all in queue' expecting the pile to vanish, waits ages, and only one sender moves."
 * Measured (TESTING/_measure/s2_histogram.js, the 08-20 night sandbox): 354 of 378 held documents
 * were untyped or had no sender — documents read BEFORE their sender's layout existed. No recompute
 * moves them (Slice 2 = DO NOTHING); only a re-read with the new template does (Chris r12: blank →
 * 94/90 via template_mapping, but only after he pressed Reprocess).
 *
 * WHAT THIS DOES. After a TAUGHT confirm lands for (supplier, type), the sender's other held
 * documents that carry NO template read are re-read on a separate main-process lane that is:
 *   · INVISIBLE to `_anyProcessingBusy()` — Review is never refused or greyed by it (the owner's
 *     hard constraint), which is also why every DB race below must be real, not "serialised away";
 *   · ONE worker, the SAME `_reprocessThreadCap` as every other reprocess path (the pinned thread-cap
 *     identity rule — a different cap flips boundary glyphs and manufactures phantom "read
 *     differently" holds, S3-C4), demoted to BELOW_NORMAL (Node `os.setPriority` + the Python-side
 *     ctypes self-demotion so every Tesseract child inherits it; never IDLE class — it crawls);
 *   · PRE-EMPTED BY KILL, never held: any foreground door (single reprocess, batch reprocess, import
 *     pool) calls `preempt()` the instant it commits to spawning, plus a 1.5 s busy poll while a
 *     worker is alive. The job is deferred with its remaining docs and resumes when idle;
 *   · MERGE-GATED (S3-C1/C6): the `file_done` handler re-checks — cancelled · being viewed ·
 *     status still needs_review · extraction rows unchanged since staging — in ONE synchronous block
 *     and hands `applyReprocessResult` an `expect` that is verified INSIDE the row+document
 *     transaction. A confirm landing mid-read wins by construction; an open document is never
 *     touched; a class-fix / pin / pill fill between stage and merge drops the merge;
 *   · CHANGED-READ HELD (S3-C5, the owner's stable-read idea inverted): after the merge, every
 *     required field that was VALUED before and reads DIFFERENTLY now gets a note — "read differently
 *     after learning — was X, now Y" — so it is flagged and cannot file without a human; a fill
 *     (blank → value) is not a change;
 *   · ONE consent idiom (S3-(c)): its eligible documents reach filing ONLY through the sweep offer /
 *     scope-local auto-accept (handler.scheduleScopeAutoAccept), never `_reprocessOffer`, never a
 *     commit of its own. The lane marks its scope in `_quietLaneActiveScopes` while running so the
 *     sweep refuses that scope until the merges have landed (S1-C5).
 *
 * Hermetic: every side effect is an injected dep (see create()), so the pins run with no Python,
 * no spawn and no timers wired to the wall clock.
 */

const SCOPE_KEY = (sup, slug) => `${String(sup || '').trim().toLowerCase()}|${String(slug || '').trim().toLowerCase()}`;
const CHUNK_CAP = 40;               // docs per pass — the foreground can pre-empt between chunks
const DEBOUNCE_MS = Number(process.env.QUIET_REREAD_DEBOUNCE_MS) || 8000;   // teach/confirm bursts coalesce into one pass (env: test override only)
const BUSY_POLL_MS = 1500;          // S3-C3: kill latency bound while a worker is alive
// QUIET REDETECT (2026-09-24; owner: "categorise everything quickly, then confirms allow auto-file";
// gary + eric → Oracle SIGN-OFF-W/COND C1-C7, docs/oracle_log.md). A SCOPE-LESS job kind on this same
// lane: when a document TYPE becomes available (created, added from the catalog, re-enabled, its title
// aliases edited) or a Keyword Label Override is saved, the held docs that were read BEFORE that change
// are re-read on the QUICK (imageless, text-only) road — the same `--reextract` pass the operator's Quick
// reprocess runs, with the press removed. Untyped population key `*|redetect` (NULL- or Generic-typed,
// template-less); an override's population key `<slug>|redetect` (the held template-less docs of that
// type). Guards inherited unchanged: viewer / foreground pre-empt / merge gate / S3-C5 / the reliability
// first-fill hold; a doc whose OCR cache is unusable is SKIPPED and counted — never staged Full in the
// background (pinned). The job marks no sweep scope and fans out no auto-accept (Oracle decision 1: a
// text-only pass RECOGNISES; the next human confirm's scope sweep files). DARK behind
// `quiet_redetect_on_type_change` (mig 216), riding `quiet_reread_enabled`.
const REDETECT_REASON = 'redetect';
const REDETECT_KEY = (slug) => (slug ? `${String(slug).trim().toLowerCase()}|redetect` : '*|redetect');
const REDETECT_CAP = 400;           // newest-first per job; the remainder is audited and waits for the next event
// Oracle C5: the unconditional first-fill hold for an identity/name key an override was saved on — a member of the
// "— confirm once." family (rereadHolds CONFIRM_ONCE) so the carry, the dedup and the later-arm exclusion all apply.
const OVERRIDE_NOTE = 'Read from the label you added — confirm once.';

function _norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }

function create(deps) {
  const {
    getDb, enabled, isForegroundBusy, stageDocs, runShard, applyResult, presence, extractionsFingerprint,
    notify, logAudit, logger, setPriority, taskkill, markScopeActive, onJobDone, findSiblings = null,
    recordEvent = null,         // (db, ev) → the activity-strip ledger (reviewEvents.record); the redetect's durable receipt (2026-09-25)
    kwSelect = null,            // (c′) deps: (db, ocrText, slug) → template id the keyword arm would match, or null
    kwSelectEnabled = null,     // (db) → bool (the `quiet_reread_kw_select` switch)
    scopeTemplateIds = null,    // (db, supplier, slug) → Set of the scope's template ids
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    layoutArm = null,           // Q3: { enabled(db), onPage(db), nameTokens(name) } — the layout arm's preconditions
    corroborated = null,        // Q3 C3.3: trust._corrobLicensed(record) — licenses a first-fill to stand
    changedReadLicensed = null, // REREAD_HOLD_CORROB_RELEASE (2026-09-07): trust._corrobLicensedKeyword(record)
    corrobReleaseEnabled = null, // (db) → bool — the `reread_hold_corrob_release` switch
    typeSplitArm = null,        // A6 (type-split arc): { enabled(db) } — the confirm-once ripple's switch
    readyArm = null,            // owner card 1 (2026-08-23): { enabled(db), floor(db, supplier, slug) } — the READY-crossing re-read of TEMPLATE-CARRYING held docs below the scope floor
    firstFillReliability = null, // Chris r18 A1 (Oracle 2026-08-23): { enabled(db), k } — hold every first-fill at merge, release at finish unless the field proved unreliable in this job
    // QUIET REDETECT deps (2026-09-24): all optional — absent ⇒ the redetect kind is inert and the scoped
    // arms are byte-identical.
    redetectEnabled = null,     // (db) → bool — the `quiet_redetect_on_type_change` switch (+ quiet_reread_enabled + licence)
    quickUsable = null,         // (db, docId) → { usable, reason } — ocrCache.ocrCacheUsable over the stored text + recipe stamp
    genericTypeId = null,       // (db) → the General Document type id, or null (Oracle C1: the scoped arms admit Generic-typed docs under the switch)
    isIdentityKey = null,       // (key) → bool — supplier/customer/name-like (Oracle C5: an override on such a key holds its first-fills)
  } = deps;

  const jobs = new Map();          // scopeKey -> job
  // A scope-less redetect job marks NO sweep scope (Oracle decision 1, 2026-09-24: a wildcard block would
  // make every human confirm during a long pass lose its auto-accept — `_autoAcceptScope` refuses
  // `quiet-lane-active` with no re-queue). Scoped jobs behave exactly as before.
  const _markScope = (key, on) => { if (key && !String(key).endsWith('|redetect')) markScopeActive(key, on); };
  let running = null;              // the job whose worker is alive
  let _quietProcs = [];            // OWN list — never _currentBatchProcs
  let _poll = null;
  let _seq = 0;

  function status() {
    return {
      running: running ? _public(running) : null,
      queued: [...jobs.values()].filter(j => j !== running).map(_public),
    };
  }
  function _public(j) {
    return { id: j.id, supplier: j.supplier, typeSlug: j.typeSlug, state: j.state, reason: j.reason,
             // `ready` survives a coalesce (a 'ready' crossing folded onto a running teach/layout job keeps
             // reason='teach' but reasons has 'ready') — the autofile-check bar filters on this (owner 2026-09-09).
             ready: !!(j.reasons && j.reasons.has('ready')) || j.reason === 'ready',
             kind: j.kind || 'scoped', quick: !!j.quick, typeSlugs: j.typeSlugs ? [...j.typeSlugs] : [],   // QUIET REDETECT
             skipped: (j.skipped || []).length, capped: j.capped || 0,
             total: j.total, done: j.done.length, dropped: j.dropped.length, failed: j.failed, changed: j.changed.length };
  }

  // ── schedule: main-side hooks only (a taught confirm, never a renderer) ──────────────────────
  function schedule(db, opts = {}) {
    const { supplier, typeSlug, reason = 'teach', seedDocId = null } = opts;
    if (!enabled(db)) return false;
    if (opts.redetect === true) return _scheduleRedetect(db, opts);   // the scope-less kind (its own key + gate)
    const sup = String(supplier || '').trim(), slug = String(typeSlug || '').trim().toLowerCase();
    if (!sup || !slug) return false;
    const key = SCOPE_KEY(sup, slug);
    let job = jobs.get(key);
    const reasonList = (Array.isArray(opts.reasons) ? opts.reasons : []).concat(reason ? [reason] : []).map(r => String(r || '').trim()).filter(Boolean);
    // Q3 seam 6 (Oracle C3.4): a 'layout' write landing DURING a running 'teach'/'ready' job must
    // ADD to the job's reasons and the rerun must recompute candidates with the UNION — otherwise
    // the template-carrying arm is silently skipped exactly when the user is fixing things.
    if (job && job === running) { job.rerun = true; for (const r of reasonList) job.reasons.add(r); if (seedDocId) job.seedDocId = seedDocId; return true; }   // coalesce: one follow-on pass
    if (!job) {
      job = { id: `q${++_seq}`, key, supplier: sup, typeSlug: slug, reason: reasonList[0] || reason, reasons: new Set(), state: 'queued', total: 0, seedDocId: null,
              remaining: null, done: [], dropped: [], failed: 0, changed: [], rerun: false, cancelled: false, timer: null, layoutArm: null, readyArm: null,
              holdsBatch: _holds.newBatch() };
      jobs.set(key, job);
    }
    for (const r of reasonList) job.reasons.add(r);
    if (seedDocId) job.seedDocId = Number(seedDocId);
    if (opts.typeSplitTemplateId) job.typeSplitTemplateId = Number(opts.typeSplitTemplateId);   // A6: the confirmed doc's template
    if (job.timer) timers.clearTimeout(job.timer);
    job.timer = timers.setTimeout(() => { job.timer = null; _tick(); }, DEBOUNCE_MS);
    return true;
  }

  // QUIET REDETECT — schedule the scope-less kind. `typeSlug` = the type that became available (or the
  // override's type); `overrideKey` = the override's field key (A2). The untyped population coalesces on
  // ONE key whatever the type (a catalog tick of five types = one pass, ordered by each doc's own
  // `detected_type_name`); an override's population is keyed by its type. Same debounce, same rerun.
  function _scheduleRedetect(db, opts = {}) {
    let on = false;
    try { on = !!(redetectEnabled && redetectEnabled(db)); } catch { on = false; }
    if (!on) return false;
    const slug = String(opts.typeSlug || '').trim().toLowerCase();
    const overrideKey = String(opts.overrideKey || '').trim() || null;
    if (overrideKey && !slug) return false;                       // an override is always type-scoped
    const key = REDETECT_KEY(overrideKey ? slug : null);
    const reason = String(opts.reason || REDETECT_REASON).trim() || REDETECT_REASON;
    let job = jobs.get(key);
    if (job && job === running) { job.rerun = true; job.reasons.add(reason); if (slug) job.typeSlugs.add(slug); if (overrideKey) job.overrideKeys.add(overrideKey); return true; }
    if (!job) {
      job = { id: `q${++_seq}`, key, kind: REDETECT_REASON, quick: true, scopeless: true, supplier: '', typeSlug: overrideKey ? slug : '',
              typeSlugs: new Set(), overrideKeys: new Set(), reason: REDETECT_REASON, reasons: new Set(), state: 'queued', total: 0, seedDocId: null,
              remaining: null, done: [], dropped: [], skipped: [], skippedViewing: [], capped: 0, failed: 0, changed: [], rerun: false, cancelled: false, timer: null,
              layoutArm: null, readyArm: null, holdsBatch: _holds.newBatch() };
      jobs.set(key, job);
    }
    job.reasons.add(reason);
    if (slug) job.typeSlugs.add(slug);
    if (overrideKey) job.overrideKeys.add(overrideKey);
    if (job.timer) timers.clearTimeout(job.timer);
    job.timer = timers.setTimeout(() => { job.timer = null; _tick(); }, DEBOUNCE_MS);
    return true;
  }

  // Oracle C1 (2026-09-24): under the redetect switch the SCOPED arms also admit a GENERIC-typed doc —
  // the mig-93 fallback stamps General Document on an undetected import, and every scoped arm's
  // `document_type_id = ? OR IS NULL` silently skipped those, so a sender taught AFTER such an import
  // never re-read them. -1 never matches a real id ⇒ OFF is byte-identical.
  function _genericAdmitId(db) {
    try { if (!(redetectEnabled && redetectEnabled(db))) return -1; } catch { return -1; }
    try { const g = genericTypeId ? genericTypeId(db) : null; return Number.isFinite(Number(g)) && g != null ? Number(g) : -1; } catch { return -1; }
  }

  // Candidate set is computed at START (not enqueue): the HELD docs that carry NO template read and
  // belong to the taught sender — exactly the population a teach changes. Two arms, unioned:
  //   (a) docs already carrying the sender's name (a wrong/partial earlier read, or a prefill);
  //   (b) docs that LOOK like the same sender BY PAGE TEXT (database/modules/supplierSiblings — the
  //       correction ripple's finder, seeded from the taught document) — because a document read
  //       before its sender was taught usually has NO supplier at all (measured: 190 of 378 held on
  //       the 08-20 night sandbox), so a name match alone would miss the owner's exact case.
  // Excludes presence viewers + workflow-locked (the staging re-checks the lock) + deferred (parked
  // by the user). Never a doc that already carries a template (those are the sweep's business).
  // The TEMPLATE-CARRYING population of a scope (the layout arm's rule, shared with the ready arm):
  // held docs bound to one of the templates the scope OWNS (frozen supplier_name = scope, or the
  // template's sample document is the scope's) — scopeTemplateIds also admits a template merely
  // CARRIED by a scope-named doc (a mis-binding to another sender's layout), which is excluded —
  // that carry the scope's name, same type (or untyped), not in a workflow, and not already holding
  // an S3-C5 "Read differently after learning" note. `belowFloor` (the ready arm) keeps only docs
  // whose stored overall_confidence is below it. Returns null when the scope owns no template.
  function _ownedTemplateRows(db, job, dt, { belowFloor = null, excludeNoted = true } = {}) {
    let tplIds = new Set();
    try { tplIds = scopeTemplateIds ? (scopeTemplateIds(db, job.supplier, job.typeSlug) || new Set()) : new Set(); } catch { tplIds = new Set(); }
    try {
      const owned = new Set(db.prepare(`
        SELECT t.id FROM templates t
         WHERE EXISTS (SELECT 1 FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name'
                         AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = ?)
            OR EXISTS (SELECT 1 FROM documents sd WHERE sd.id = t.sample_document_id
                         AND LOWER(TRIM(COALESCE(sd.supplier_name, ''))) = ?)`).all(job.supplier.toLowerCase(), job.supplier.toLowerCase()).map(r => r.id));
      tplIds = new Set([...tplIds].filter(id => owned.has(id)));
    } catch { tplIds = new Set(); }
    if (!tplIds.size) return null;
    const ph = [...tplIds].map(() => '?').join(',');
    const args = [...tplIds, job.supplier.toLowerCase(), dt.id, _genericAdmitId(db)];
    let floorSql = '';
    if (Number.isFinite(belowFloor)) { floorSql = ' AND COALESCE(d.overall_confidence, 0) < ?'; args.push(belowFloor); }
    // P3 (Chris r19 N3, Oracle W/COND): the LAYOUT arm re-reads NOTED docs too — a new/changed box is new
    // evidence about WHERE, and the notes were about the PREVIOUS box (the corrected Copperfield re-teach
    // re-read nothing: every sibling carried a note from the wrong-order teach). The re-read re-derives
    // the holds honestly (S3-C5 against the displayed value, the first-fill hold, and mergeReprocessRows
    // carries a same-value hold). The READY arm keeps the exclusion (same box → same read → a silent
    // un-hold). Depends on the carry: REPROCESS_CARRY_LANE_HOLD=0 falls back to excluding noted docs.
    const noteSql = excludeNoted
      ? `
         AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
                           AND (e.validation_note LIKE '%Read differently after learning%'
                             OR e.validation_note LIKE '%— confirm once.%'))`
      : '';
    return db.prepare(`
      SELECT d.id, d.original_filename, d.folder_path FROM documents d
       WHERE d.status = 'needs_review'
         AND d.template_id IN (${ph})
         AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
         AND (d.document_type_id = ? OR d.document_type_id IS NULL OR d.document_type_id = ?)
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')${noteSql}${floorSql}
       ORDER BY d.id`).all(...args);
  }
  // Oracle 2026-08-23 (A1 seam): the NOT EXISTS above covers the WHOLE lane-hold family — S3-C5 AND every
  // "— confirm once." note (layout / ready / reliability). Without it the READY arm re-read a held
  // first-fill below the floor, the same box reproduced the same wrong value, both holds went silent
  // (was == now; was valued) and the sweep filed it. A doc the lane has already asked about is never
  // re-read by the lane again; the human's confirm or the manual Reprocess is the way out.

  // QUIET REDETECT population (computed at START, like every arm). Untyped job (`*|redetect`): held,
  // template-less docs whose type is NULL or the Generic fallback, not workflow-locked, not already
  // holding a lane note, with stored page text. Override job (`<slug>|redetect`): the held template-less
  // docs OF that type. Ordered so the docs whose own `detected_type_name` names one of the job's types
  // come first, then newest. Each doc is asked `quickUsable` — an unusable OCR cache (no recipe stamp /
  // enhanced template / empty text) is SKIPPED and counted, never staged for a Full read (pinned); the
  // operator's own Quick reprocess stays the self-heal road for those. Capped at REDETECT_CAP; the
  // remainder is counted and picked up by the next event.
  function _redetectCandidates(db, job) {
    job.skippedViewing = [];   // per pass (a rerun recomputes)
    const gid = (() => { try { const g = genericTypeId ? genericTypeId(db) : null; return g == null ? -1 : Number(g); } catch { return -1; } })();
    const noteSql = `
         AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
                           AND (e.validation_note LIKE '%Read differently after learning%'
                             OR e.validation_note LIKE '%— confirm once.%'))`;
    let rows = [];
    if (job.typeSlug) {
      // OVERRIDE job (typed docs): a doc the lane has already asked about keeps its lane-hold exclusion (the A1 seam).
      const dt = db.prepare('SELECT id FROM document_types WHERE LOWER(slug) = ?').get(job.typeSlug);
      if (!dt) return [];
      rows = db.prepare(`
        SELECT d.id, d.original_filename, d.folder_path, 0 AS pri FROM documents d
         WHERE d.status = 'needs_review'
           AND d.template_id IS NULL
           AND d.document_type_id = ?
           AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
           AND d.ocr_text IS NOT NULL AND TRIM(d.ocr_text) <> ''${noteSql}
         ORDER BY d.id DESC`).all(dt.id);
    } else {
      // UNTYPED job: NO lane-note exclusion. An untyped doc was never "asked" by the lane — but the engine's own
      // "Found 'X' after straightening — confirm once." (the deskew retry at import) is a member of the confirm-once
      // family, and it excluded 7 of Chris's 98 unrecognised papers from the very pass that would have typed them
      // (2026-09-24 card 3). A re-type re-derives every hold honestly (S3-C5 + the reliability first-fill hold).
      const names = job.typeSlugs.size
        ? db.prepare(`SELECT LOWER(name) AS n FROM document_types WHERE LOWER(slug) IN (${[...job.typeSlugs].map(() => '?').join(',')})`).all(...job.typeSlugs).map(r => r.n)
        : [];
      rows = db.prepare(`
        SELECT d.id, d.original_filename, d.folder_path, LOWER(COALESCE(d.detected_type_name, '')) AS dtn FROM documents d
         WHERE d.status = 'needs_review'
           AND d.template_id IS NULL
           AND (d.document_type_id IS NULL OR d.document_type_id = ?)
           AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
           AND d.ocr_text IS NOT NULL AND TRIM(d.ocr_text) <> ''
         ORDER BY d.id DESC`).all(gid)
        .map(r => ({ ...r, pri: names.includes(r.dtn) ? 1 : 0 }))
        .sort((a, b) => (b.pri - a.pri) || (b.id - a.id));
    }
    const out = [];
    for (const r of rows) {
      // a doc being viewed is never touched — remember it so the Review window can tell the person (card 1)
      if (presence.viewers(r.id).length) { job.skippedViewing.push(r.id); continue; }
      if (out.length >= REDETECT_CAP) { job.capped++; continue; }
      let v = { usable: true, reason: 'ok' };
      // allowBornDigital: a text-layer doc is exactly what a text-only redetect wants (the handler dep re-asks the batch
      // predicate with only `bd_used` waived; every other invalidator still applies) — gate finding 2026-09-24.
      try { v = quickUsable ? (quickUsable(db, r.id, { allowBornDigital: true }) || v) : v; } catch (e) { v = { usable: false, reason: 'probe-failed' }; }
      if (!v.usable) { job.skipped.push({ docId: r.id, reason: `no-cache:${v.reason || 'unknown'}` }); continue; }
      out.push({ id: r.id, original_filename: r.original_filename, folder_path: r.folder_path, _via: REDETECT_REASON });
    }
    return out;
  }

  function _candidates(db, job) {
    if (job.kind === REDETECT_REASON) return _redetectCandidates(db, job);
    const dt = db.prepare('SELECT id FROM document_types WHERE LOWER(slug) = ?').get(job.typeSlug);
    if (!dt) return [];
    const byId = new Map();
    const add = (r) => { if (r && !byId.has(r.id)) byId.set(r.id, r); };
    db.prepare(`
      SELECT d.id, d.original_filename, d.folder_path FROM documents d
       WHERE d.status = 'needs_review'
         AND (d.document_type_id = ? OR d.document_type_id IS NULL OR d.document_type_id = ?)
         AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
         AND d.template_id IS NULL
       ORDER BY d.id`).all(dt.id, _genericAdmitId(db), job.supplier.toLowerCase()).forEach(add);
    if (job.seedDocId && findSiblings) {
      let sibs = [];
      try { sibs = findSiblings(db, job.seedDocId, job.supplier, { cap: 500 }) || []; } catch { sibs = []; }
      const ids = sibs.map(x => Number(x.id)).filter(Boolean);
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        db.prepare(`
          SELECT d.id, d.original_filename, d.folder_path FROM documents d
           WHERE d.id IN (${ph})
             AND d.status = 'needs_review'
             AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
             AND d.template_id IS NULL
           ORDER BY d.id`).all(...ids).forEach(add);
      }
    }
    // (c′) — KEYWORD-FINGERPRINT SELECTION (2026-08-22, gary → Oracle SIGN-OFF-W/COND, replacing the
    // hash arm that measured DEAD on real scans: same-sender phash distance 14–28 vs the ≤6 accept).
    // The matcher's own keyword arm, mirrored in JS (templates.findByKeywordFingerprint at the
    // exported KEYWORD_THRESHOLD), asked over each held template-less doc's STORED ocr_text: a hit on
    // one of the scope's templates SELECTS the doc for a re-read. Measured: 100 on 20 of the owner's 21
    // worksheets incl. all 8 the text-similarity arm missed, not the stranger; 19/388 (5%) on the
    // 410-doc pile = the sender's own invoices. SELECTION ONLY — the pipeline's matcher assigns
    // identity with all its gates; this arm never writes supplier_name or template_id. Bounds: same
    // type or untyped; unnamed, the scope's own name, OR a `letterhead_prefill` row (a cold-start
    // suggestion, not a sender claim — S3-C5 still holds its change with "was 'X'").
    if (kwSelect && kwSelectEnabled && scopeTemplateIds) {
      let on = false;
      try { on = !!kwSelectEnabled(db); } catch { on = false; }
      if (on) {
        let tplIds = new Set();
        try { tplIds = scopeTemplateIds(db, job.supplier, job.typeSlug) || new Set(); } catch { tplIds = new Set(); }
        if (job.seedDocId) {
          try { const sd = db.prepare('SELECT template_id FROM documents WHERE id = ?').get(job.seedDocId); if (sd && sd.template_id) tplIds.add(sd.template_id); } catch { /* optional */ }
        }
        if (tplIds.size) {
          const rows = db.prepare(`
            SELECT d.id, d.original_filename, d.folder_path, d.supplier_name, d.ocr_text,
                   (SELECT e.extraction_method FROM extractions e WHERE e.document_id = d.id AND e.field_key = 'supplier_name') AS sup_method
              FROM documents d
             WHERE d.status = 'needs_review'
               AND d.template_id IS NULL
               AND (d.document_type_id = ? OR d.document_type_id IS NULL OR d.document_type_id = ?)
               AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
               AND d.ocr_text IS NOT NULL AND TRIM(d.ocr_text) <> ''
             ORDER BY d.id`).all(dt.id, _genericAdmitId(db));
          const scopeN = job.supplier.toLowerCase();
          for (const r of rows) {
            if (byId.has(r.id)) continue;
            const supN = String(r.supplier_name || '').trim().toLowerCase();
            if (supN && supN !== scopeN && r.sup_method !== 'letterhead_prefill') continue;   // another sender's claim: never
            let hit = null;
            try { hit = kwSelect(db, r.ocr_text, job.typeSlug); } catch { hit = null; }
            if (hit && tplIds.has(hit)) add({ id: r.id, original_filename: r.original_filename, folder_path: r.folder_path, _via: 'kw' });
          }
        }
      }
    }
    // ── Q3: THE LAYOUT ARM (Chris round 14 card 6 — a ⊕ box on a sibling re-read nothing until the
    // user pressed "Reprocess 17"; gary → Oracle SIGN-OFF-W/COND C3.1–C3.7, 2026-08-22). A layout
    // WRITE (an authoritative anchor or a template mapping) makes every template-carrying read of
    // the scope stale by definition — the same population the manual "Reprocess N from sender"
    // re-reads, with the press removed. It crosses the 08-21 S3 "template-less only" boundary,
    // so it is its own reason ('layout'), its own switch, and it runs ONLY when:
    //   · quiet_reread_on_layout is on (DARK) AND template_identity_on_page is 'true' — the engine's
    //     honour path re-imposes known_template_id and must be able to DECLINE a binding the page
    //     does not name (SEAM-1; C3.1);
    //   · the scope name is JUDGEABLE — ≥2 distinctive tokens survive the generic filter (the JS
    //     mirror of template_matcher._name_arm_tokens); an all-generic name ("DOCUMENT SOLUTIONS")
    //     makes _identity_refuses abstain by construction, so the binding would be re-imposed
    //     UNTESTED (C3.2) → arm skipped, audited.
    // Population: held docs carrying one of the scope's templates AND the scope's name, minus any
    // doc already holding an S3-C5 "Read differently after learning" note (seam 2 — a doc the
    // lane has already asked the user about is not re-read again). Filing only via the sweep /
    // auto-accept; a REQUIRED role field first-filled by the new box is held with a note unless
    // page-corroborated (C3.3, _holdFirstFills).
    if (job.reasons && job.reasons.has('layout')) {
      let why = null;
      try { if (!(layoutArm && layoutArm.enabled && layoutArm.enabled(db))) why = 'off'; } catch { why = 'off'; }
      if (!why) { try { if (!layoutArm.onPage(db)) why = 'on_page_off'; } catch { why = 'on_page_off'; } }
      if (!why) { try { if (!(layoutArm.nameTokens(job.supplier).size >= 2)) why = 'unjudgeable_identity'; } catch { why = 'unjudgeable_identity'; } }
      if (why) {
        job.layoutArm = `skipped:${why}`;
      } else {
        const rows = _ownedTemplateRows(db, job, dt, { excludeNoted: process.env.REPROCESS_CARRY_LANE_HOLD === '0' });   // P3
        if (!rows) job.layoutArm = 'skipped:no_template';
        else {
          let n = 0;
          for (const r of rows) { if (!byId.has(r.id)) { add({ ...r, _via: 'layout' }); n++; } }
          job.layoutArm = `selected:${n}`;
        }
      }
    }
    // ── THE READY ARM (owner card 1, Chris 15 → built 2026-08-23; gary design, Oracle C-set of the
    // layout arm re-applied). Once the seed-support prune (Q2) makes the teach-time re-read work, the
    // siblings BIND to the scope's template BEFORE any confirm — at overall 91–93 under the scope's
    // UNGRADUATED floor (100). The sweep then offers nothing, and the 'ready' crossing (the 3rd
    // contributing confirm) re-read only TEMPLATE-LESS docs (the S3 boundary) — so the owner saw
    // "✓ files by itself" over a pile that waited for File All. This arm re-reads, at the READY
    // crossing only, the scope's template-carrying held docs whose stored overall confidence sits
    // BELOW the scope's live floor (a doc at/above it files through the sweep without a re-read).
    // Same population rule + same guards as the layout arm (owned templates · the scope's name · no
    // prior S3-C5 note · on-page identity ON · judgeable name — so the binding IS re-tested), plus:
    //   · its own switch `quiet_reread_on_ready_templated` (DARK), riding `quiet_reread_on_ready`;
    //   · the C3.3 first-fill hold applies (via 'ready' — "confirm once"), fail toward review;
    //   · filing only via the sweep / scope auto-accept, never here.
    // An all-generic scope name (DS) is skipped + audited like the layout arm — the owner is told.
    if (job.reasons && job.reasons.has('ready')) {
      let why = null;
      try { if (!(readyArm && readyArm.enabled && readyArm.enabled(db))) why = 'off'; } catch { why = 'off'; }
      if (!why) { try { if (!(layoutArm && layoutArm.onPage && layoutArm.onPage(db))) why = 'on_page_off'; } catch { why = 'on_page_off'; } }
      if (!why) { try { if (!(layoutArm.nameTokens(job.supplier).size >= 2)) why = 'unjudgeable_identity'; } catch { why = 'unjudgeable_identity'; } }
      if (why) {
        job.readyArm = `skipped:${why}`;
      } else {
        let floor = null;
        try { floor = readyArm.floor ? readyArm.floor(db, job.supplier, job.typeSlug) : null; } catch { floor = null; }
        if (!Number.isFinite(floor)) job.readyArm = 'skipped:no_floor';
        else {
          const rows = _ownedTemplateRows(db, job, dt, { belowFloor: floor });
          if (!rows) job.readyArm = 'skipped:no_template';
          else {
            let n = 0;
            for (const r of rows) { if (!byId.has(r.id)) { add({ ...r, _via: 'ready' }); n++; } }
            job.readyArm = `selected:${n}:floor=${floor}`;
          }
        }
      }
    }
    // ── A6 (the type-split arc, 2026-08-22; gary → Oracle SIGN-OFF-W/COND S1, build LAST): the
    // CONFIRM-ONCE RIPPLE. After a human confirms a document that carried the Fix A note ("this
    // letterhead is used for several document types"), the sender's OTHER held documents on the SAME
    // template + SAME type that still carry that exact note are re-read here — never a stored-row
    // note shed (a reprocess re-plants it; the `_d4` lesson: the penalty is removed where it is
    // computed). Under the unsupported-rival waiver (A2) the re-read drops the note and its penalty
    // at extraction; a sibling is never re-typed — its own re-read resolves or stays held, so a
    // genuinely mixed batch is safe by construction. The caller (processing/handler) pre-checks the
    // waiver switch + the rival's support and audit-skips otherwise (Oracle: never fire when the
    // waiver cannot succeed — it would re-plant the note for nothing).
    if (job.reasons && job.reasons.has('typesplit')) {
      let why = null;
      try { if (!(typeSplitArm && typeSplitArm.enabled && typeSplitArm.enabled(db))) why = 'off'; } catch { why = 'off'; }
      if (!why && !job.typeSplitTemplateId) why = 'no_template';
      if (why) {
        job.typeSplitArm = `skipped:${why}`;
      } else {
        const rows = db.prepare(`
          SELECT d.id, d.original_filename, d.folder_path FROM documents d
           WHERE d.status = 'needs_review'
             AND d.template_id = ?
             AND d.document_type_id = ?
             AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
             AND EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
                           AND e.validation_note LIKE '%used for several document types%')
           ORDER BY d.id`).all(job.typeSplitTemplateId, dt.id);
        let n = 0;
        for (const r of rows) { if (!byId.has(r.id)) { add({ ...r, _via: 'typesplit' }); n++; } }
        job.typeSplitArm = `selected:${n}`;
      }
    }
    return [...byId.values()].sort((a, b) => a.id - b.id).filter(r => !presence.viewers(r.id).length);
  }

  function _tick() {
    if (running) return;
    // Scoped jobs run before a scope-less redetect (the teach wizard's taught confirm first; the redetect's
    // population is computed at its own start, so docs the scoped pass just typed are no longer in it).
    const waiting = [...jobs.values()].filter(j => j.state === 'queued' || j.state === 'deferred');
    const next = waiting.find(j => j.kind !== REDETECT_REASON) || waiting[0];
    if (!next) return;
    if (isForegroundBusy()) { next.timer = timers.setTimeout(_tick, BUSY_POLL_MS); return; }   // wait for idle
    _run(next).catch(e => { try { logger?.warn?.(`[quiet-lane] ${next.key}: ${e && e.message}`); } catch {} });
  }

  async function _run(job) {
    const db = getDb();
    running = job;
    job.state = 'running';
    job.cancelled = false;
    _markScope(job.key, true);
    let staged = null;
    try {
      // Learning Repair "start fresh" (Oracle C5, 2026-08-26): a job scheduled with reason 'repair'
      // re-reads the sender's template-less held docs (the forget just un-bound them) under the
      // unconditional `repair` hold, never the provisional teach hold.
      const _repairVia = (job.reasons && job.reasons.has('repair')) ? 'repair' : null;
      const all = job.remaining || _candidates(db, job).map(r => ({ docId: r.id, folderPath: r.folder_path, filename: r.original_filename, via: r._via || _repairVia || null }));
      const chunk = all.slice(0, CHUNK_CAP);
      job.remaining = all.slice(CHUNK_CAP);
      job.total = all.length + job.done.length + job.dropped.length;
      if (!chunk.length) { _finish(job, db); return; }
      staged = stageDocs(db, chunk, { auditMeta: { quiet: true, ...(job.kind === REDETECT_REASON ? { redetect: true } : {}) }, quick: !!job.quick });
      if (!staged || !staged.tmpNames.length) { _finish(job, db); return; }
      notify({ type: 'job_start', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug, total: job.total, done: job.done.length, reason: job.reason,
               ready: !!(job.reasons && job.reasons.has('ready')) || job.reason === 'ready',   // r19 N8: the hint names the trigger; `ready` drives the autofile-check bar (owner 2026-09-09)
               kind: job.kind || 'scoped', quick: !!job.quick, typeSlugs: job.typeSlugs ? [...job.typeSlugs] : [], skipped: (job.skipped || []).length });
      _startPoll();
      await runShard({
        db, staged, label: 'quiet-reprocess',
        reextract: !!job.quick,                         // QUIET REDETECT: the imageless --reextract road (never for a scoped job)
        extraEnv: { DS_PROCESS_PRIORITY: 'below_normal' },
        track: (p) => { _quietProcs.push(p); try { setPriority(p.pid, 10); } catch {} },
        onFileDone: (msg) => _onFileDone(db, job, staged, msg),
      });
    } finally {
      _stopPoll();
      _quietProcs = [];
      try { staged && staged.cleanup && staged.cleanup(); } catch {}
      if (job.cancelled) {
        // Pre-empted: keep what merged, defer the rest (the in-flight doc is simply redone).
        const doneSet = new Set([...job.done, ...job.dropped.map(d => d.docId)]);
        const rest = (staged ? Object.values(staged.nameToDoc).map(n => ({ docId: n.docId, folderPath: n.folderPath, filename: n.filename })) : [])
          .filter(x => !doneSet.has(x.docId));
        job.remaining = [...rest, ...(job.remaining || [])];
        job.state = 'deferred';
        running = null;
        _markScope(job.key, false);
        notify({ type: 'job_deferred', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug, reason: 'foreground' });
        job.timer = timers.setTimeout(_tick, BUSY_POLL_MS);
      } else if (job.remaining && job.remaining.length) {
        running = null;                                   // next chunk on the next tick (foreground may pre-empt between)
        job.state = 'queued';
        _markScope(job.key, false);
        job.timer = timers.setTimeout(_tick, 0);
      } else if (job.state === 'running') {
        _finish(job, db);
      }
    }
  }

  // THE MERGE GATE (S3-C6): one synchronous block — no await between the checks and the apply.
  function _onFileDone(db, job, staged, msg) {
    const nd = staged.nameToDoc[msg.original_filename] || staged.nameToDoc[msg.filename];
    if (!nd) return;
    const drop = (reason) => { job.dropped.push({ docId: nd.docId, reason }); notify({ type: 'doc_dropped', jobId: job.id, docId: nd.docId, reason }); };
    if (job.cancelled) return drop('cancelled');                         // a kill can leave a complete line in the pipe
    if (!(msg.success && msg.extractions)) { job.failed++; return; }
    if (presence.viewers(nd.docId).length) return drop('open');          // opened after staging
    const cur = db.prepare('SELECT status, workflow_status FROM documents WHERE id = ?').get(nd.docId);
    if (!cur || cur.status !== 'needs_review') return drop('status-changed');   // a mid-read confirm wins
    if (['pending', 'claimed'].includes(String(cur.workflow_status || ''))) return drop('workflow-locked');
    const fp = extractionsFingerprint(nd.existing);
    const rowsNow = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(nd.docId);
    if (extractionsFingerprint(rowsNow) !== fp) return drop('rows-changed');   // class-fix / pin / pill fill landed
    let verdict = null;
    try {
      verdict = applyResult(db, nd.docId, nd.existing, msg, nd.filename, { expect: { status: 'needs_review', fingerprint: fp }, preserveAck: true });
    } catch (e) { job.failed++; try { logger?.err?.(`[quiet-lane] merge ${nd.filename}: ${e && e.message}`); } catch {} return; }
    if (verdict && verdict.dropped) return drop(verdict.dropped);
    // S3-C5: a value that was VALUED before and reads DIFFERENTLY now is held with a note.
    const changed = _holdChangedReads(db, nd.docId, nd.existing);
    // Q3 C3.3 (fail toward review): in a 'layout' job a REQUIRED role field that the new box
    // FIRST-FILLS (empty → valued) is held with a note unless the read is page-corroborated — the
    // misfile the Oracle named is a drifted ⊕ box first-filling an empty ref with a same-shape
    // neighbour code; S3-C5 has no prior value to compare and the sweep's gate would pass the shape.
    // SCOPE (Chris round 16 card 2): ONLY a document the LAYOUT ARM selected (a template-carrying
    // sibling re-read under its stored binding) — never the teach-time re-read of template-less docs
    // (Slice 3's signed path), even when the wizard's mapping saves put 'layout' in the same job's
    // reasons. Round 16: every first-filled DS date got "confirm once" at the TEACH, and a generic-
    // named sender (no layout arm) could never shed it.
    // Owner card 1 (2026-08-23): the READY arm's template-carrying re-reads are held the same way —
    // there is no "new box", so the note names the learning instead.
    // Chris round 18 A1 (Oracle 2026-08-23, SEND BACK → rebuilt): doc 447's date was BLANK at import,
    // FIRST-FILLED 13-11-2026 by the teach-time re-read (single-family, nothing on the page agreed) and
    // swept at the ready crossing; four siblings of the SAME job carried S3-C5 disagreements on the
    // same date box (the page agreed with the old value every time). The box was provably unreliable
    // on this layout and nothing aggregated the evidence. Now: every first-fill on a teach/kw via is
    // HELD at merge ("confirm once"); at _finish — before onJobDone, i.e. before any sweep — the hold
    // is RELEASED unless that field proved unreliable in this job (K=1: one S3-C5 disagreement, one
    // valued→empty loss, or one engine taught-box yield on the same field). DS-shaped jobs (every
    // sibling blank before, no disagreements) release at finish → the hand-off stands; Copperfield
    // holds 447. Corroborated first-fills (≥2 page families) never hold. DARK behind
    // `quiet_reread_first_fill_reliability_hold`; via layout/ready keep their unconditional hold.
    const _ffOn = (() => { try { return !!(firstFillReliability && firstFillReliability.enabled && firstFillReliability.enabled(db)); } catch { return false; } })();
    if (nd.via === 'layout' || nd.via === 'ready' || nd.via === 'repair') {
      try { const ff = _holds.holdFirstFills(db, nd.docId, nd.existing, _holds.NOTES[nd.via]); if (ff.length) job.changed.push({ docId: nd.docId, fields: ff, firstFill: true }); } catch {}
      if (_ffOn) { try { _holds.onDocMerged(db, job.holdsBatch, { docId: nd.docId, existing: nd.existing, via: 'witness-only', reliability: true, _changed: changed }); } catch {} }
    } else if (_ffOn) {
      try { _holds.onDocMerged(db, job.holdsBatch, { docId: nd.docId, existing: nd.existing, via: nd.via || 'teach', reliability: true, _changed: changed }); } catch {}
    }
    // QUIET REDETECT, Oracle C5 (2026-09-24): an override saved on an IDENTITY / NAME key ("Customer:" → supplier_name
    // is the unguarded twin of Chris's 09-22 finding — G1/G2 guard TAUGHT boxes, not keyword captures) holds every
    // first-fill of THAT key unconditionally, naming the label family; other keys keep the reliability branch above.
    if (job.kind === REDETECT_REASON && job.overrideKeys && job.overrideKeys.size && isIdentityKey) {
      const idKeys = [...job.overrideKeys].filter(k => { try { return !!isIdentityKey(k); } catch { return false; } });
      if (idKeys.length) {
        try {
          const ff = _holds.holdFirstFills(db, nd.docId, nd.existing, OVERRIDE_NOTE, { onlyKeys: new Set(idKeys) });
          if (ff.length) job.changed.push({ docId: nd.docId, fields: ff, firstFill: true });
        } catch {}
      }
    }
    job.done.push(nd.docId);
    if (changed.length) job.changed.push({ docId: nd.docId, fields: changed });
    notify({ type: 'doc_done', jobId: job.id, docId: nd.docId, changed: changed.length > 0, done: job.done.length, total: job.total });
  }

  // ── THE HOLDS LIVE IN rereadHolds.js (Chris r19 N1, Oracle P1: ONE road for holds) ───────────────
  // S3-C5 changed reads (with the C1 type-valid baseline), first-fill holds per via, the reliability
  // witnesses + release — shared with the manual "Reprocess N" road. Thin aliases keep the names the
  // tests and the merge below use.
  const _holds = require('./rereadHolds').create({ corroborated, changedReadLicensed, corrobReleaseEnabled,
    k: Number(firstFillReliability && firstFillReliability.k) || 1 });
  const RELIABILITY_NOTE = _holds.RELIABILITY_NOTE;
  const _holdChangedReads = (db, docId, existing) => _holds.holdChangedReads(db, docId, existing);
  const _holdFirstFills = (db, docId, existing, noteText) => _holds.holdFirstFills(db, docId, existing, noteText);
  const _releaseProvisionalHolds = (db, job) => _holds.release(db, job.holdsBatch);

  function _finish(job, db) {
    job.state = 'done';
    // A1: the reliability release runs BEFORE onJobDone (the sweep) and before the scope goes inactive —
    // a held row is never sweepable, a released row is released only on a reliable field.
    let _rel = { released: [], held: [] };
    try { if (job.holdsBatch && job.holdsBatch.provisionalHolds.length) _rel = _releaseProvisionalHolds(db, job); } catch {}
    for (const h of _rel.held) job.changed.push({ docId: h.docId, fields: [{ key: h.key, now: h.now }], firstFill: true });
    running = null;
    _markScope(job.key, false);
    jobs.delete(job.key);
    try {
      logAudit(db, { action: 'quiet_reprocess_job', target_type: 'scope', outcome: 'success',
        metadata: { supplier: job.supplier, type_slug: job.typeSlug, reason: job.reason, reasons: [...(job.reasons || [])].join('+'),
                    kind: job.kind || 'scoped', quick: job.quick ? 1 : 0,                                   // QUIET REDETECT
                    type_slugs: job.typeSlugs ? [...job.typeSlugs].join(',') : '',
                    override_fields: job.overrideKeys ? [...job.overrideKeys].join(',') : '',   // not "*_keys": the audit redactor masks any field named like a secret
                    skipped: (job.skipped || []).map(s => `${s.docId}:${s.reason}`).join(','), capped: job.capped || 0,
                    layout_arm: job.layoutArm || '',
                    ready_arm: job.readyArm || '',            // owner card 1
                    type_split_arm: job.typeSplitArm || '',   // A6
                    done_ids: job.done.join(','), dropped: job.dropped.map(d => `${d.docId}:${d.reason}`).join(','),
                    failed: job.failed, changed_ids: job.changed.map(c => c.docId).join(','),
                    first_fill_ids: job.changed.filter(c => c.firstFill).map(c => c.docId).join(','),
                    field_unreliable: job.holdsBatch ? _holds.statsSummary(job.holdsBatch) : '',   // A1
                    reliability_held_ids: _rel.held.map(h => h.docId).join(','), reliability_released_ids: _rel.released.map(h => h.docId).join(',') } });
    } catch { /* best-effort */ }
    notify({ type: 'job_done', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug, kind: job.kind || 'scoped',
             done: job.done.length, dropped: job.dropped.length, failed: job.failed, changed: job.changed.length,
             skipped: (job.skipped || []).length, capped: job.capped || 0,
             viewing: (job.skippedViewing || []).slice() });   // the docs left alone because someone had them open (card 1: the window says so)
    // The ONLY filing door: the sweep (offer bar, or the scope-local auto-accept when it is on). A scope-less
    // redetect fans out NO auto-accept (Oracle decision 1, 2026-09-24): a text-only pass recognises; the next human
    // confirm's scope sweep — and the queue-wide consent bar the renderer re-runs on job_done — decide filing.
    if (job.kind !== REDETECT_REASON) { try { onJobDone && onJobDone(db, { supplier: job.supplier, typeSlug: job.typeSlug, done: job.done.slice() }); } catch {} }
    else if (job.done.length) {
      // Chris 2026-09-24 card 1 (durable receipt): the redetect's result outlives the toast as an activity-strip chip —
      // "N given their type", scoped to the type(s) the user added / the override's type; never undoable (nothing filed).
      try {
        const _slugs = [...(job.typeSlugs || [])].filter(Boolean);
        recordEvent && recordEvent(db, { kind: 'recognised', ids: job.done.slice(), scope: { supplier: null, typeSlug: _slugs[0] || job.typeSlug || null },
                                         typeSlugs: _slugs.length ? _slugs : (job.typeSlug ? [job.typeSlug] : []), undo: null });
      } catch { /* a receipt never fails the job */ }
    }
    if (job.rerun) {
      job.rerun = false;
      if (job.kind === REDETECT_REASON) {
        const slugs = [...(job.typeSlugs || [])], keys = [...(job.overrideKeys || [])];
        if (keys.length) for (const k of keys) _scheduleRedetect(db, { typeSlug: job.typeSlug || slugs[0] || null, overrideKey: k, reason: REDETECT_REASON });
        else _scheduleRedetect(db, { typeSlug: slugs[0] || null, reason: REDETECT_REASON });
        for (const s of slugs.slice(1)) _scheduleRedetect(db, { typeSlug: s, reason: REDETECT_REASON });
      } else {
        schedule(db, { supplier: job.supplier, typeSlug: job.typeSlug, reason: job.reason, reasons: [...(job.reasons || [])], seedDocId: job.seedDocId });   // the UNION (C3.4)
      }
    }
    else timers.setTimeout(_tick, 0);
  }

  // ── pre-emption: KILL, never hold ────────────────────────────────────────────────────────────
  function preempt(reason = 'foreground') {
    if (!running || !_quietProcs.length) return false;
    running.cancelled = true;
    for (const p of _quietProcs) {
      try { taskkill(p.pid); } catch {}
      try { p.kill(); } catch {}
    }
    try { logger?.log?.(`[quiet-lane] pre-empted (${reason}): ${running.key}`); } catch {}
    return true;
  }
  function _startPoll() {
    _stopPoll();
    _poll = timers.setInterval(() => { if (isForegroundBusy()) preempt('busy-poll'); }, BUSY_POLL_MS);
  }
  function _stopPoll() { if (_poll) { timers.clearInterval(_poll); _poll = null; } }

  function cancel(jobId) {
    const job = [...jobs.values()].find(j => j.id === jobId);
    if (!job) return false;
    if (job === running) { job.cancelled = true; job.remaining = []; preempt('cancel'); return true; }
    if (job.timer) timers.clearTimeout(job.timer);
    jobs.delete(job.key);
    return true;
  }
  function shutdown() {
    for (const j of jobs.values()) { if (j.timer) timers.clearTimeout(j.timer); }
    if (running) { running.cancelled = true; running.remaining = []; }
    for (const p of _quietProcs) { try { taskkill(p.pid); } catch {} try { p.kill(); } catch {} }
    _quietProcs = [];
    _stopPoll();
    jobs.clear();
  }

  return { schedule, preempt, cancel, status, shutdown,
           _internals: { jobs, get running() { return running; }, procs: () => _quietProcs, tick: _tick, holdChangedReads: _holdChangedReads, releaseProvisionalHolds: _releaseProvisionalHolds } };
}

module.exports = { create, SCOPE_KEY, CHUNK_CAP, DEBOUNCE_MS, BUSY_POLL_MS };
