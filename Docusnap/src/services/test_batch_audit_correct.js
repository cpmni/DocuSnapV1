'use strict';
/**
 * test_batch_audit_correct.js — the batch-audit orchestrator's SAFETY CHECKPOINT, hermetic.
 *
 * The isRefile path in reviewService.confirm bypasses every confirm safety gate; the orchestrator
 * re-adds the checkpoint at its OWN edge. These pins stop a future dev collapsing confirmBatch back
 * into a raw confirm(allowRefile) loop and restoring the bypass. reviewService.confirm is STUBBED —
 * this tests the orchestrator's decisions, not filing (which reviewService already tests).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_batch_audit_correct.js
 */
const { createBatchAuditService } = require('./batchAuditService');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } };

// ── Stubs ─────────────────────────────────────────────────────────────────────
const DATE_PATS = ['(?<!\\d)\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}(?!\\d)'];
function makeDeps(docs, { preserve = true, confirmImpl } = {}) {
  const confirmCalls = [];
  const reviewService = {
    confirm: async (db, actor, payload, internal) => {
      confirmCalls.push({ payload, internal });
      if (confirmImpl) return confirmImpl(payload, internal);
      return { ok: true, success: true, filename: 'Filed.' + payload.document_id + '.pdf' };
    },
  };
  const documents = {
    getWithExtractions: (db, id) => docs[id] || null,
    getById: (db, id) => docs[id] || null,
    getByIds: () => Object.values(docs),
  };
  const doctypes = {
    getWithFields: (db, slug) => ({
      slug, date_field_key: 'invoice_date', ref_field_key: 'invoice_number',
      fields: [
        { key: 'invoice_number', type: 'text' },
        { key: 'invoice_date', type: 'date' },
        { key: 'total_amount', type: 'currency' },
      ],
    }),
  };
  const svc = createBatchAuditService({
    reviewService, documents, doctypes,
    getEvent: () => ({ id: 7, ids: Object.keys(docs).map(Number) }),
    valPatterns: () => ({ date: DATE_PATS }),
    preserveAnchors: () => preserve,
  });
  return { svc, confirmCalls };
}
const doc = (id, over = {}) => ({
  id, status: 'confirmed', supplier_name: 'Acme Ltd', type_slug: 'invoice',
  extractions: [
    { field_key: 'invoice_number', display_value: 'INV-100' },
    { field_key: 'invoice_date', display_value: '01-02-2026' },
    { field_key: 'total_amount', display_value: '10.00' },
  ], ...over,
});

(async () => {
  // ── Happy path: one changed VALUE field → confirm once, right shape ───────────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_number: 'INV-999' } }] });
    check('happy: filed=1', r.filed === 1 && r.results[0].ok);
    check('happy: confirm called once', confirmCalls.length === 1);
    const p = confirmCalls[0].payload;
    check('happy: allowRefile true', p.allowRefile === true);
    check('happy: bulk true', p.bulk === true);
    check('happy: corrections = CHANGED field only', Object.keys(p.corrections).length === 1 && p.corrections.invoice_number.corrected_value === 'INV-999' && p.corrections.invoice_number.original_value === 'INV-100');
    check('happy: allValues is the FULL map', p.allValues.invoice_number === 'INV-999' && p.allValues.invoice_date === '01-02-2026' && p.allValues.total_amount === '10.00');
    check('happy: internal.preserveAnchors true (switch on)', confirmCalls[0].internal.preserveAnchors === true);
  }

  // ── PIN E-flag: preserveAnchors switch OFF is threaded ────────────────────────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) }, { preserve: false });
    await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { total_amount: '12.00' } }] });
    check('preserve OFF threaded', confirmCalls[0].internal.preserveAnchors === false);
  }

  // ── PIN B: issuer + type edits are ROUTED, never re-filed ──────────────────────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) });
    const r1 = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { supplier_name: 'Other Co' } }] });
    check('PIN B: issuer edit route-to-review', r1.results[0].reason === 'route-to-review' && r1.results[0].field === 'supplier_name');
    const r2 = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { document_type: 'purchase_order' } }] });
    check('PIN B: type edit route-to-review', r2.results[0].reason === 'route-to-review' && r2.results[0].field === 'document_type');
    check('PIN B: confirm NEVER called for routed edits', confirmCalls.length === 0);
    check('PIN B: routed edits not counted as filed', r1.filed === 0 && r2.filed === 0);
  }

  // ── PIN C: a format-invalid date is REFUSED inline (no re-file) ────────────────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_date: 'not-a-date' } }] });
    check('PIN C: invalid date refused', r.results[0].reason === 'invalid-value' && r.results[0].field === 'invoice_date' && r.results[0].detail === 'invalid-date');
    check('PIN C: confirm not called on invalid', confirmCalls.length === 0);
    // Positive control: a VALID date passes.
    const { svc: svc2, confirmCalls: cc2 } = makeDeps({ 5: doc(5) });
    const r2 = await svc2.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_date: '15-03-2026' } }] });
    check('PIN C control: valid date filed', r2.filed === 1 && cc2.length === 1);
  }
  // Empty structural field refused (can't blank the filename's key parts).
  {
    const { svc } = makeDeps({ 5: doc(5) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_number: '   ' } }] });
    check('empty ref refused', r.results[0].reason === 'invalid-value' && r.results[0].detail === 'empty');
  }

  // ── PIN D: ev.ids is authoritative; a docId not in the batch is refused ────────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 999, fields: { invoice_number: 'X' } }] });
    check('PIN D: not-in-batch refused', r.results[0].reason === 'not-in-batch');
    check('PIN D: confirm not called for foreign id', confirmCalls.length === 0);
  }

  // ── no-change is a no-op (skipped, confirm not called, not counted filed) ──────
  {
    const { svc, confirmCalls } = makeDeps({ 5: doc(5) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_number: 'INV-100' } }] });
    check('no-change: ok+no-change, not filed', r.results[0].ok === true && r.results[0].reason === 'no-change' && r.filed === 0);
    check('no-change: confirm not called', confirmCalls.length === 0);
  }

  // ── not-confirmed (e.g. a put-back doc that slipped in) is refused ────────────
  {
    const { svc } = makeDeps({ 5: doc(5, { status: 'needs_review' }) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_number: 'INV-999' } }] });
    check('not-confirmed refused', r.results[0].reason === 'not-confirmed');
  }

  // ── PIN C4: a confirm failure SURFACES per-doc with its reason (never silent) ──
  {
    const { svc } = makeDeps({ 5: doc(5) }, { confirmImpl: () => ({ ok: false, code: 'NO_SOURCE_FILE', error: 'gone' }) });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 7, edits: [{ docId: 5, fields: { invoice_number: 'INV-999' } }] });
    check('per-doc failure surfaced', r.results[0].ok === false && r.results[0].reason === 'NO_SOURCE_FILE' && r.results[0].code === 'NO_SOURCE_FILE' && r.filed === 0);
  }

  // ── unknown event → clean refusal ─────────────────────────────────────────────
  {
    const svc = createBatchAuditService({ reviewService: { confirm: async () => ({ ok: true }) }, documents: {}, doctypes: {}, getEvent: () => null, valPatterns: () => ({}), preserveAnchors: () => true });
    const r = await svc.confirmBatch({}, { username: 'u' }, { eventId: 1, edits: [{ docId: 5, fields: {} }] });
    check('unknown event refused', r.ok === false && r.reason === 'unknown-event');
  }

  console.log(`\nbatch-audit orchestrator: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
