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

function _norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }

function create(deps) {
  const {
    getDb, enabled, isForegroundBusy, stageDocs, runShard, applyResult, presence, extractionsFingerprint,
    notify, logAudit, logger, setPriority, taskkill, markScopeActive, onJobDone, findSiblings = null,
    kwSelect = null,            // (c′) deps: (db, ocrText, slug) → template id the keyword arm would match, or null
    kwSelectEnabled = null,     // (db) → bool (the `quiet_reread_kw_select` switch)
    scopeTemplateIds = null,    // (db, supplier, slug) → Set of the scope's template ids
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    layoutArm = null,           // Q3: { enabled(db), onPage(db), nameTokens(name) } — the layout arm's preconditions
    corroborated = null,        // Q3 C3.3: trust._corrobLicensed(record) — licenses a first-fill to stand
  } = deps;

  const jobs = new Map();          // scopeKey -> job
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
             total: j.total, done: j.done.length, dropped: j.dropped.length, failed: j.failed, changed: j.changed.length };
  }

  // ── schedule: main-side hooks only (a taught confirm, never a renderer) ──────────────────────
  function schedule(db, opts = {}) {
    const { supplier, typeSlug, reason = 'teach', seedDocId = null } = opts;
    if (!enabled(db)) return false;
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
              remaining: null, done: [], dropped: [], failed: 0, changed: [], rerun: false, cancelled: false, timer: null, layoutArm: null };
      jobs.set(key, job);
    }
    for (const r of reasonList) job.reasons.add(r);
    if (seedDocId) job.seedDocId = Number(seedDocId);
    if (job.timer) timers.clearTimeout(job.timer);
    job.timer = timers.setTimeout(() => { job.timer = null; _tick(); }, DEBOUNCE_MS);
    return true;
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
  function _candidates(db, job) {
    const dt = db.prepare('SELECT id FROM document_types WHERE LOWER(slug) = ?').get(job.typeSlug);
    if (!dt) return [];
    const byId = new Map();
    const add = (r) => { if (r && !byId.has(r.id)) byId.set(r.id, r); };
    db.prepare(`
      SELECT d.id, d.original_filename, d.folder_path FROM documents d
       WHERE d.status = 'needs_review'
         AND (d.document_type_id = ? OR d.document_type_id IS NULL)
         AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
         AND d.template_id IS NULL
       ORDER BY d.id`).all(dt.id, job.supplier.toLowerCase()).forEach(add);
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
               AND (d.document_type_id = ? OR d.document_type_id IS NULL)
               AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
               AND d.ocr_text IS NOT NULL AND TRIM(d.ocr_text) <> ''
             ORDER BY d.id`).all(dt.id);
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
        let tplIds = new Set();
        try { tplIds = scopeTemplateIds ? (scopeTemplateIds(db, job.supplier, job.typeSlug) || new Set()) : new Set(); } catch { tplIds = new Set(); }
        // Only the templates the scope OWNS (frozen supplier_name = scope, or the template's sample
        // document is the scope's) — scopeTemplateIds also admits a template merely CARRIED by a
        // scope-named doc (a mis-binding to another sender's layout), which a layout write on this
        // scope did not touch.
        try {
          const owned = new Set(db.prepare(`
            SELECT t.id FROM templates t
             WHERE EXISTS (SELECT 1 FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name'
                             AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = ?)
                OR EXISTS (SELECT 1 FROM documents sd WHERE sd.id = t.sample_document_id
                             AND LOWER(TRIM(COALESCE(sd.supplier_name, ''))) = ?)`).all(job.supplier.toLowerCase(), job.supplier.toLowerCase()).map(r => r.id));
          tplIds = new Set([...tplIds].filter(id => owned.has(id)));
        } catch { tplIds = new Set(); }
        if (!tplIds.size) job.layoutArm = 'skipped:no_template';
        else {
          const ph = [...tplIds].map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT d.id, d.original_filename, d.folder_path FROM documents d
             WHERE d.status = 'needs_review'
               AND d.template_id IN (${ph})
               AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
               AND (d.document_type_id = ? OR d.document_type_id IS NULL)
               AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
               AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = d.id
                                 AND e.validation_note LIKE '%Read differently after learning%')
             ORDER BY d.id`).all(...tplIds, job.supplier.toLowerCase(), dt.id);
          let n = 0;
          for (const r of rows) { if (!byId.has(r.id)) { add({ ...r, _via: 'layout' }); n++; } }
          job.layoutArm = `selected:${n}`;
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.id - b.id).filter(r => !presence.viewers(r.id).length);
  }

  function _tick() {
    if (running) return;
    const next = [...jobs.values()].find(j => j.state === 'queued' || j.state === 'deferred');
    if (!next) return;
    if (isForegroundBusy()) { next.timer = timers.setTimeout(_tick, BUSY_POLL_MS); return; }   // wait for idle
    _run(next).catch(e => { try { logger?.warn?.(`[quiet-lane] ${next.key}: ${e && e.message}`); } catch {} });
  }

  async function _run(job) {
    const db = getDb();
    running = job;
    job.state = 'running';
    job.cancelled = false;
    markScopeActive(job.key, true);
    let staged = null;
    try {
      const all = job.remaining || _candidates(db, job).map(r => ({ docId: r.id, folderPath: r.folder_path, filename: r.original_filename, via: r._via || null }));
      const chunk = all.slice(0, CHUNK_CAP);
      job.remaining = all.slice(CHUNK_CAP);
      job.total = all.length + job.done.length + job.dropped.length;
      if (!chunk.length) { _finish(job, db); return; }
      staged = stageDocs(db, chunk, { auditMeta: { quiet: true } });
      if (!staged || !staged.tmpNames.length) { _finish(job, db); return; }
      notify({ type: 'job_start', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug, total: job.total, done: job.done.length });
      _startPoll();
      await runShard({
        db, staged, label: 'quiet-reprocess',
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
        markScopeActive(job.key, false);
        notify({ type: 'job_deferred', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug, reason: 'foreground' });
        job.timer = timers.setTimeout(_tick, BUSY_POLL_MS);
      } else if (job.remaining && job.remaining.length) {
        running = null;                                   // next chunk on the next tick (foreground may pre-empt between)
        job.state = 'queued';
        markScopeActive(job.key, false);
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
    if (nd.via === 'layout') {
      try { const ff = _holdFirstFills(db, nd.docId, nd.existing); if (ff.length) job.changed.push({ docId: nd.docId, fields: ff, firstFill: true }); } catch {}
    }
    job.done.push(nd.docId);
    if (changed.length) job.changed.push({ docId: nd.docId, fields: changed });
    notify({ type: 'doc_done', jobId: job.id, docId: nd.docId, changed: changed.length > 0, done: job.done.length, total: job.total });
  }

  // Q3 C3.3: first-fills of REQUIRED ROLE fields (issuer / reference / date) in a 'layout' job.
  // `corroborated(record)` is injected (trust._corrobLicensed: independent_agree across ≥2 PAGE
  // families — mapping/crop/keyword; memory+hint excluded). Returns the held fields.
  function _holdFirstFills(db, docId, existing) {
    const doc = db.prepare('SELECT document_type_id FROM documents WHERE id = ?').get(docId);
    if (!doc || !doc.document_type_id) return [];
    const dt = db.prepare('SELECT ref_field_key, date_field_key FROM document_types WHERE id = ?').get(doc.document_type_id) || {};
    const roleKeys = new Set(['supplier_name', dt.ref_field_key, dt.date_field_key].filter(Boolean));
    const req = db.prepare('SELECT key FROM fields WHERE document_type_id = ? AND enabled = 1 AND required = 1').all(doc.document_type_id)
      .map(f => f.key).filter(k => roleKeys.has(k));
    const before = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
    const after = Object.fromEntries(db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId).map(r => [r.field_key, r]));
    const held = [];
    const upd = db.prepare("UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?");
    for (const key of req) {
      const was = before[key] && String(before[key].display_value || '').trim();
      const now = after[key] && String(after[key].display_value || '').trim();
      if (was || !now) continue;                                 // not a first-fill
      let ok = false;
      try { ok = !!(corroborated && corroborated(after[key].corroboration)); } catch { ok = false; }
      if (ok) continue;                                          // licensed by ≥2 page families — the fill stands
      const note = 'Read from your new box — confirm once.';
      const prior = String(after[key].validation_note || '').trim();
      if (!prior.includes(note)) upd.run(prior ? `${prior} ${note}` : note, docId, key);
      held.push({ key, now });
    }
    return held;
  }

  // S3-C5. NOTE (Q3 C3.6, pinned): a value that was VALUED before and reads EMPTY now is NOT a
  // "changed read" — the fresh row is stored wholesale and the document is held as missing-required
  // (it cannot file). The old value must NOT be restored here: keeping it would let a shape-
  // plausible WRONG value file on the strength of a read the new layout no longer makes.
  function _holdChangedReads(db, docId, existing) {
    const doc = db.prepare('SELECT document_type_id FROM documents WHERE id = ?').get(docId);
    if (!doc || !doc.document_type_id) return [];
    const req = db.prepare('SELECT key, label FROM fields WHERE document_type_id = ? AND enabled = 1 AND required = 1').all(doc.document_type_id);
    const before = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
    const after = Object.fromEntries(db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId).map(r => [r.field_key, r]));
    const changed = [];
    const upd = db.prepare("UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?");
    for (const f of req) {
      const was = before[f.key] && String(before[f.key].display_value || '').trim();
      const now = after[f.key] && String(after[f.key].display_value || '').trim();
      if (!was || !now) continue;                               // a fill (or a loss) is not a changed read
      if (_norm(was) === _norm(now)) continue;
      const note = `Read differently after learning — was '${was}', now '${now}'. Please check which is right.`;
      const prior = String(after[f.key].validation_note || '').trim();
      upd.run(prior ? `${prior} ${note}` : note, docId, f.key);
      changed.push({ key: f.key, was, now });
    }
    return changed;
  }

  function _finish(job, db) {
    job.state = 'done';
    running = null;
    markScopeActive(job.key, false);
    jobs.delete(job.key);
    try {
      logAudit(db, { action: 'quiet_reprocess_job', target_type: 'scope', outcome: 'success',
        metadata: { supplier: job.supplier, type_slug: job.typeSlug, reason: job.reason, reasons: [...(job.reasons || [])].join('+'),
                    layout_arm: job.layoutArm || '',
                    done_ids: job.done.join(','), dropped: job.dropped.map(d => `${d.docId}:${d.reason}`).join(','),
                    failed: job.failed, changed_ids: job.changed.map(c => c.docId).join(','),
                    first_fill_ids: job.changed.filter(c => c.firstFill).map(c => c.docId).join(',') } });
    } catch { /* best-effort */ }
    notify({ type: 'job_done', jobId: job.id, supplier: job.supplier, typeSlug: job.typeSlug,
             done: job.done.length, dropped: job.dropped.length, failed: job.failed, changed: job.changed.length });
    // The ONLY filing door: the sweep (offer bar, or the scope-local auto-accept when it is on).
    try { onJobDone && onJobDone(db, { supplier: job.supplier, typeSlug: job.typeSlug, done: job.done.slice() }); } catch {}
    if (job.rerun) { job.rerun = false; schedule(db, { supplier: job.supplier, typeSlug: job.typeSlug, reason: job.reason, reasons: [...(job.reasons || [])], seedDocId: job.seedDocId }); }   // the UNION (C3.4)
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
           _internals: { jobs, get running() { return running; }, procs: () => _quietProcs, tick: _tick } };
}

module.exports = { create, SCOPE_KEY, CHUNK_CAP, DEBOUNCE_MS, BUSY_POLL_MS };
