'use strict';
/**
 * src/services/classFixService.js — the human-licensed class correction (every write lives here).
 * ------------------------------------------------------------------------------------------------
 * gary + reggie design → Oracle SIGN-OFF-WITH-CONDITIONS (8 blocking), 2026-08-19.
 * DEFAULT OFF behind `ref_class_fix_enabled` / env REF_CLASS_FIX. OFF is inert by construction:
 * the entry point returns null before reading anything.
 *
 * WHAT IT DOES. The operator corrects ONE reference — 'P1/26/3130' to 'PI/26/3130'. The same
 * byte-exact substitution is applied to the other QUEUED documents of that (supplier, type) whose
 * reference carries the same wrong head, and they are TOLD about it afterwards with an undo. No
 * dialog beforehand; no second dialog after. That is the owner's ask verbatim, and it is the
 * Gmail-undo pattern rather than a confirmation prompt.
 *
 * WHY THIS IS LEGITIMATE WHERE "HISTORY REWRITES A PAGE" IS NOT. The engine's P adopt lane needs a
 * page witness because nobody licensed it: history alone proposing a rewrite is a poisoned corpus
 * waiting to happen. Here a HUMAN licensed the class, on a document they were looking at. The app
 * applies that one decision to byte-identical cases and files nothing — every touched document
 * stays in Review, badged, where the same human sees it before it can leave.
 *
 * THE FIVE THINGS THAT KEEP IT SAFE (each is an Oracle blocking condition, each has a pin):
 *  C1  No `corrected_to` is written on a sibling. It looks like the obvious badge carrier and it is
 *      a trap: trust.js counts a non-empty corrected_to as `flagged` unless a USER-VISIBLE toggle
 *      is on, and the Review summary counts it with no carve-out at all — so twelve documents the
 *      app just fixed would each announce "1 field was flagged by a formatting check", and turning
 *      one setting off would hold them shut forever. The METHOD MARKER carries the badge instead:
 *      durable, survives confirm, touches no gate, and it is already needed for the learning
 *      exclusion, the undo integrity check and the reprocess guard.
 *  C2  A class-fixed row is excluded from the learning corpus. Without it, one click manufactures
 *      up to 25 votes for its own premise and self-licenses the engine's arm — the B7 loop exactly.
 *      A row the human later CORRECTS is re-admitted (see the carve-out in learning.js).
 *  C3  A reprocess would otherwise take the fresh read wholesale and silently revert every
 *      propagated value — and, because the marker went with it, the undo would then refuse too.
 *      Guarded in processing/handler.js at the `used_new` line.
 *  C4  Tier 2. The VALUE is written everywhere the rule reaches (justified: the document never
 *      leaves Review, the operator sees it badged before it can file, and a QUEUED document feeds
 *      no learning — getFieldFormats filters status='confirmed'). The blocking NOTE is only cleared
 *      where THAT document's own evidence agrees, and only for the enumerated note classes that
 *      actually name the old value. Every other note is REPLACED, not cleared, and still holds.
 *  C6  One ask, remembered. When the sender's confirmed history holds BOTH forms, the fix is not
 *      obviously a fix — so ask, once, and remember the answer for that (supplier, type, from→to)
 *      so the second correction is silent. Asking every time is the thing the owner banned.
 *
 * NEVER: the identity field (renameSupplier owns that), dates, money, or name-like fields. The
 * reference ROLE field only. Never a document that has already been filed.
 */

const refClassFix = require('./refClassFix');

const MARKER = '+prefix_class_fix';
const CAP = 25;                        // the sweep's cap, for the same reason: a promise of "12"
                                       // that silently delivers 25 (or 3) is worse than no feature

/**
 * The note classes Tier 2 may CLEAR, hoisted here and asserted against their Python write sites by
 * test_ref_class_fix.js (Oracle C4). A note outside this set is replaced, never cleared — "the
 * value is now on the page" does not answer a shape warning or a relocation flag, and those are
 * the notes most likely to be hiding something real.
 */
const CLEARABLE_NOTE_MARKS = Object.freeze([
  'one character differs',                       // engine rawwitness ask
  '— likely a one-character misread',            // engine prefix-outlier tail
  'A wider reading of this box shows',           // template_mapper pad-window disagreement
  "doesn't appear on this page as written",      // engine Gate C
]);

/** What a document is told INSTEAD of a clear, when the value was fixed but its own page could not
 *  be made to agree. It still holds the document — fail toward Review. */
const APPLIED_HOLD_NOTE =
  'This reference was corrected to {} to match a correction you made on another document from this '
  + 'sender. This page could not be re-checked, so please confirm it before filing.';

/** In-memory undo batches (Oracle: the toast BUTTON is session-scoped; durability comes from the
 *  audit row plus the untouched raw_value, not from persisting toast state). */
const _batches = new Map();
let _batchSeq = 0;

/** Answers remembered for the one-time ask, keyed (supplier|type|from→to). Session-scoped by
 *  design: this must never harden into a persistent rewrite rule (Oracle C6). */
const _askAnswers = new Map();

function _enabled(db, learning) {
  if (process.env.REF_CLASS_FIX === '0') return false;
  if (process.env.REF_CLASS_FIX === '1') return true;
  try { return learning.getSetting(db, 'ref_class_fix_enabled', 'false') === 'true'; }
  catch { return false; }
}

const _askKey = (sup, slug, rule) =>
  `${String(sup).trim().toLowerCase()}|${String(slug).trim().toLowerCase()}|${rule.fromHead}>${rule.toHead}`;

/**
 * THE ENTRY POINT. Called from reviewService.confirm as the LAST effect before it returns, with its
 * own guards — never from inside another transaction.
 *
 * Returns null when nothing was done (the overwhelming majority of confirms), or a summary the
 * renderer turns into a toast:
 *   { batchId, field, from, to, docs:[{id, filename, was, now, noteCleared}], capped, remaining }
 * or, when both forms are established, { ask:true, batchId:null, ... , candidates:[…] }.
 */
function applyForConfirm(db, opts) {
  const {
    documentId, corrections, supplierName, typeSlug, dtInfo, actorName,
    learning, audit, presence, logger,
  } = opts || {};

  if (!_enabled(db, learning)) return null;              // OFF ⇒ nothing read, nothing written
  const refKey = dtInfo && dtInfo.ref_field_key;
  if (!refKey || !documentId || !supplierName || !typeSlug) return null;

  // The ref ROLE field only, and only when the human actually edited it.
  const edit = corrections && corrections[refKey];
  if (!edit) return null;
  const rule = refClassFix.deriveClassFix(edit.original_value, edit.corrected_value);
  if (!rule) return null;

  const scope = { sup: String(supplierName).trim(), slug: String(typeSlug).trim() };

  // Candidate siblings: QUEUED only, same scope, not this document, not workflow-locked, not open
  // in front of somebody else. `document_id <> ?` is on the SELECT and on every write.
  let rows;
  try {
    rows = db.prepare(`
      SELECT d.id, d.original_filename, d.ocr_text,
             e.display_value, e.raw_value, e.validation_note, e.extraction_method, e.corrected_to
        FROM documents d
        JOIN extractions e ON e.document_id = d.id AND e.field_key = @refKey
        JOIN document_types t ON t.id = d.document_type_id
       WHERE d.status = 'needs_review'
         AND d.id <> @docId
         AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = LOWER(@sup)
         AND LOWER(TRIM(COALESCE(t.slug, ''))) = LOWER(@slug)
         AND COALESCE(d.workflow_status, '') NOT IN ('pending', 'claimed')
       ORDER BY d.id`).all({ refKey, docId: documentId, sup: scope.sup, slug: scope.slug });
  } catch (e) { logger?.warn?.('class fix: candidate scan failed: ' + (e && e.message)); return null; }

  if (presence) rows = rows.filter(r => !presence.viewers(r.id).length);

  const hits = [];
  for (const r of rows) {
    const now = refClassFix.applyClassFix(r.display_value, rule);
    if (now) hits.push({ row: r, now });
  }
  if (!hits.length) return null;

  const capped = hits.length > CAP;
  const take = hits.slice(0, CAP);

  // ── C6: the one-time ask ────────────────────────────────────────────────────────────────────
  // Both forms established means the sender's own confirmed history holds the READ's form often
  // enough that this may be a second convention rather than a misread. On the owner's mature
  // install that is true of exactly this class, and those rows are almost certainly confirmed
  // MISREADS — which is precisely why a human, not a bar, should settle it. Ask once; remember.
  const askKey = _askKey(scope.sup, scope.slug, rule);
  if (!_askAnswers.has(askKey)) {
    let established = false;
    try {
      const grp = (learning.getFieldFormats(db) || []).find(g =>
        String(g.supplier_name || '').trim().toLowerCase() === scope.sup.toLowerCase()
        && String(g.document_type || '').trim().toLowerCase() === scope.slug.toLowerCase()
        && g.field_key === refKey);
      if (grp) {
        // MACHINE EVIDENCE COUNTS ON THE REFUSAL SIDE (Oracle S1-C3, 2026-08-19).
        // `learning_exclude_machine_confirms` (ON by default) hides every auto-filed and swept
        // document from `value_counts`, and on a real corpus that is most of it — measured 89.9%
        // on the round-9 database, where a sender with 27 confirmed values presents 4.
        //
        // That starvation is a SAFETY loss here, not a reward loss. Asking is the conservative
        // branch: with the read's own form hidden, `established` comes back false, no question is
        // asked, and up to 25 references are rewritten class-wide on evidence the app actually
        // holds and cannot see. C6 of this feature's own sign-off is defeated by the exclusion.
        //
        // So union the machine channel in — UNFILTERED and REFUSAL-ONLY. This can only ever make
        // the app ASK; it can never license a rewrite, widen a gate, or reach anything that
        // decides filing. The mirrored rule: a refusal test may use the fullest evidence there is;
        // a licensing test may use human-attested evidence only.
        const bucket = { ...(grp.value_counts || {}) };
        for (const [v, n] of Object.entries(grp.machine_value_counts || {})) {
          bucket[v] = (bucket[v] || 0) + n;
        }
        established = refClassFix.bothFormsEstablished(bucket, rule.fromHead);
      }
    } catch (e) { logger?.warn?.('class fix: both-forms check failed: ' + (e && e.message)); }
    if (established) {
      return {
        ask: true, askKey, field: refKey, from: rule.fromHead, to: rule.toHead,
        capped, remaining: capped ? hits.length - CAP : 0,
        candidates: take.map(h => ({ id: h.row.id, filename: h.row.original_filename,
                                     was: h.row.display_value, now: h.now })),
      };
    }
    _askAnswers.set(askKey, true);            // no ambiguity to settle — nothing to ask about
  } else if (_askAnswers.get(askKey) === false) {
    return null;                              // they said no for this class; stay quiet
  }

  return _commit(db, { documentId, refKey, rule, take, capped, total: hits.length,
                       scope, actorName, audit, logger });
}

/** The operator answered the one-time ask. `yes` applies the batch and remembers; `no` remembers
 *  the refusal so the next correction of the same class is silent. */
function resolveAsk(db, opts) {
  const { askKey, yes } = opts || {};
  if (!askKey) return null;
  _askAnswers.set(askKey, !!yes);
  if (!yes) return null;
  return applyForConfirm(db, opts);           // re-derives against LIVE rows — never a stale list
}

function _commit(db, { documentId, refKey, rule, take, capped, total, scope, actorName, audit, logger }) {
  const batchId = `cf${++_batchSeq}`;
  const undo = [];
  const docs = [];

  const upd = db.prepare(`
    UPDATE extractions
       SET display_value = @now,
           extraction_method = @method,
           validation_note = @note
     WHERE document_id = @id AND document_id <> @src AND field_key = @refKey`);

  try {
    db.transaction(() => {
      for (const h of take) {
        const r = h.row;
        const oldMethod = String(r.extraction_method || '');
        // C1: the marker is the badge carrier. corrected_to is NEVER written (see the header).
        const method = oldMethod.endsWith(MARKER) ? oldMethod : (oldMethod + MARKER);

        // ── C4, Tier 2 ──────────────────────────────────────────────────────────────────────
        // Clear the blocking note only on THIS document's own evidence, and only for a note class
        // that actually named the old value. Everything else is REPLACED with a note that still
        // holds — the value is fixed, but nothing has re-checked the page, so it waits for a human.
        const note = String(r.validation_note || '');
        const witnessed = (String(r.corrected_to || '').trim() === h.now)
                          || refClassFix.pageCarriesSepless(r.ocr_text || '', h.now);
        const namesOldValue = !!note && note.includes(String(r.display_value || ''));
        const clearable = !!note
          && CLEARABLE_NOTE_MARKS.some(m => note.includes(m))
          && namesOldValue;
        const noteCleared = !note ? false : (witnessed && clearable);
        const newNote = !note ? null
          : (noteCleared ? null : APPLIED_HOLD_NOTE.replace('{}', h.now));

        undo.push({ id: r.id, display_value: r.display_value, extraction_method: r.extraction_method,
                    validation_note: r.validation_note, applied: h.now });
        upd.run({ id: r.id, src: documentId, refKey, now: h.now, method, note: newNote });
        docs.push({ id: r.id, filename: r.original_filename, was: r.display_value,
                    now: h.now, noteCleared });
      }
    })();
  } catch (e) {
    logger?.warn?.('class fix: apply failed, nothing written: ' + (e && e.message));
    return null;                              // the transaction rolled back — fail toward Review
  }

  _batches.set(batchId, { refKey, sourceId: documentId, rows: undo });

  // C8: the consent trail. Mandatory, and the reason the undo survives a crash without persisting
  // toast state — raw_value is untouched, so this row plus the marker is enough to reconstruct.
  try {
    audit && audit(db, {
      action: 'class_fix_applied', target_type: 'document', target_id: documentId,
      document_id: documentId, outcome: 'success', actor_username: actorName || null,
      metadata: { field: refKey, from: rule.fromHead, to: rule.toHead, scope: `${scope.sup}|${scope.slug}`,
                  doc_ids: docs.map(d => d.id).join(','), applied: docs.length,
                  cleared: docs.filter(d => d.noteCleared).length,
                  capped: capped ? total : 0, batch: batchId },
    });
  } catch { /* the audit must never fail the fix */ }

  logger?.log?.(`  Class fix: ${rule.fromHead}→${rule.toHead} applied to ${docs.length} queued `
                + `${scope.sup} document(s)${capped ? ` (${total - docs.length} beyond the cap)` : ''}`);

  return { batchId, field: refKey, from: rule.fromHead, to: rule.toHead, docs,
           capped, remaining: capped ? total - docs.length : 0 };
}

/**
 * UNDO. Restores each row that STILL carries the marker AND still holds exactly what we wrote —
 * anything the operator or a reprocess has touched since is left alone. A document filed in the
 * meantime is refused outright: reverting the database would desync it from the filename and the
 * XML already written to disk.
 */
function undoBatch(db, batchId, opts = {}) {
  const b = _batches.get(batchId);
  if (!b) return { ok: false, reason: 'expired' };
  const { audit, actorName, logger } = opts;

  const cur = db.prepare(`SELECT e.document_id AS id, e.display_value, e.extraction_method, d.status
                            FROM extractions e JOIN documents d ON d.id = e.document_id
                           WHERE e.document_id = ? AND e.field_key = ?`);
  const rest = db.prepare(`UPDATE extractions
                              SET display_value = @display_value,
                                  extraction_method = @extraction_method,
                                  validation_note = @validation_note
                            WHERE document_id = @id AND field_key = @refKey`);
  let restored = 0, skipped = 0;
  try {
    db.transaction(() => {
      for (const r of b.rows) {
        const c = cur.get(r.id, b.refKey);
        if (!c) { skipped++; continue; }
        if (c.status !== 'needs_review') { skipped++; continue; }        // filed since — refuse
        if (!String(c.extraction_method || '').endsWith(MARKER)) { skipped++; continue; }
        if (String(c.display_value || '') !== String(r.applied)) { skipped++; continue; }
        rest.run({ id: r.id, refKey: b.refKey, display_value: r.display_value,
                   extraction_method: r.extraction_method, validation_note: r.validation_note });
        restored++;
      }
    })();
  } catch (e) { return { ok: false, reason: 'failed', message: e && e.message }; }

  _batches.delete(batchId);
  try {
    audit && audit(db, {
      action: 'class_fix_undone', target_type: 'document', target_id: b.sourceId,
      document_id: b.sourceId, outcome: 'success', actor_username: actorName || null,
      metadata: { batch: batchId, restored, skipped },
    });
  } catch { /* best effort */ }
  logger?.log?.(`  Class fix: undo ${batchId} — ${restored} restored, ${skipped} left alone`);
  return { ok: true, restored, skipped };
}

/** Test seam only — the module-level maps are process-lifetime by design. */
function _reset() { _batches.clear(); _askAnswers.clear(); _batchSeq = 0; }

module.exports = {
  applyForConfirm, resolveAsk, undoBatch,
  MARKER, CAP, CLEARABLE_NOTE_MARKS, APPLIED_HOLD_NOTE, _reset,
};
