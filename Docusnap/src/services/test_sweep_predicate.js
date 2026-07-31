'use strict';
/**
 * src/services/test_sweep_predicate.js
 * ------------------------------------
 * Catch-up Filing slice 2 — the PURE Tier-2 consistency predicate
 * (docs/designs/CATCHUP_FILING_2026-07-31.md §Green-light predicate + §Test plan).
 * Every design arm pinned; the PINNED TRADE-OFFS are the load-bearing ones — a future
 * dev must not "fix" them back into unsafe filing:
 *   - a BETTER fresh value (un-clipped code) still FAILS the match (stale display must
 *     not batch-file);
 *   - stored-empty + fresh-VALUE is HELD, never filed;
 *   - a note/corrected_to on EITHER side fails.
 *
 *   node src/services/test_sweep_predicate.js
 */
const { evaluateSweepConsistency, extractionsFingerprint } = require('./sweepPredicate');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const ROLES = new Set(['supplier_name', 'invoice_number', 'invoice_date']);
const stored = (over = {}) => ([
  { field_key: 'supplier_name', display_value: 'Anconia Corp', raw_value: 'Anconia Corp', confidence: 95 },
  { field_key: 'invoice_number', display_value: 'INV-121', raw_value: 'INV-121', confidence: 90 },
  { field_key: 'invoice_date', display_value: '14-11-2026', raw_value: '14-11-2026', confidence: 92 },
  { field_key: 'total', display_value: '£100.00', raw_value: '£100.00', confidence: 88 },
  ...(over.rows || []),
].map(r => ({ validation_note: null, corrected_to: null, ...r, ...(over[r.field_key] || {}) })));
const fresh = (over = {}) => ({
  supplier_name: { value: 'Anconia Corp', confidence: 97 },
  invoice_number: { value: 'INV-121', confidence: 93 },
  invoice_date: { value: '14-11-2026', confidence: 95 },
  total: { value: '£100.00', confidence: 90 },
  ...over,
});
const run = (s, f, slugs = {}) => evaluateSweepConsistency({
  storedRows: s, freshFields: f, roleKeys: ROLES,
  storedSlug: slugs.stored || 'Invoice', freshSlug: slugs.fresh || 'Invoice',
});

console.log('§1 green light');
{
  const v = run(stored(), fresh());
  check('all-match all-clean → pass', v.pass === true && v.reason === 'ok');
  check('overlay keeps stored values with FRESH confidence',
        v.overlay.find(o => o.field_key === 'invoice_number').confidence === 93
        && v.overlay.find(o => o.field_key === 'invoice_number').display_value === 'INV-121');
  const v2 = run(stored(), fresh({ total: { value: '', confidence: null } }));
  check('fresh-empty NON-role passes (imageless self-skip is structural)', v2.pass === true);
  check('…and its overlay row keeps the STORED confidence (stale-weak anchor still trips the 88 floor)',
        v2.overlay.find(o => o.field_key === 'total').confidence === 88);
  check('normalise-equal tolerance (whitespace/case)',
        run(stored(), fresh({ supplier_name: { value: '  ANCONIA  CORP ', confidence: 97 } })).pass === true);
}

console.log('§2 role arms');
{
  check('role fresh-EMPTY fails',
        run(stored(), fresh({ invoice_number: { value: '', confidence: null } })).reason === 'role-empty-on-recheck');
  check('role MISMATCH fails',
        run(stored(), fresh({ invoice_number: { value: 'INV-999', confidence: 95 } })).reason === 'role-mismatch');
  check("PIN: a BETTER fresh value ('INV-12110' un-clipped vs displayed 'INV-121') STILL FAILS",
        run(stored(), fresh({ invoice_number: { value: 'INV-12110', confidence: 96 } })).pass === false);
  check('role stored-empty fails (nothing displayed to consent to)',
        run(stored({ invoice_number: { display_value: '', raw_value: '' } }), fresh()).reason === 'role-empty-stored');
}

console.log('§3 non-role arms');
{
  check('non-role contradiction fails',
        run(stored(), fresh({ total: { value: '£999.99', confidence: 90 } })).reason === 'field-mismatch');
  check('PIN: stored-EMPTY + fresh-VALUE = HELD (new-value-on-recheck), never filed',
        run(stored({ total: { display_value: '', raw_value: '' } }), fresh()).reason === 'new-value-on-recheck');
}

console.log('§4 flags + type');
{
  check('PIN: stored validation_note fails',
        run(stored({ total: { validation_note: 'please verify' } }), fresh()).reason === 'stored-flagged');
  check('PIN: stored corrected_to fails',
        run(stored({ total: { corrected_to: '£101.00' } }), fresh()).reason === 'stored-flagged');
  check('PIN: fresh note fails',
        run(stored(), fresh({ total: { value: '£100.00', confidence: 90, validation_note: 'x' } })).reason === 'fresh-flagged');
  check('type slug change fails',
        run(stored(), fresh(), { fresh: 'Sales Order' }).reason === 'type-changed');
  check('slug compare is case-insensitive', run(stored(), fresh(), { fresh: 'invoice' }).pass === true);
}

console.log('§5 fingerprint (SEAM 2 candidacy→accept mutation guard)');
{
  const a = extractionsFingerprint(stored());
  check('stable across calls', a === extractionsFingerprint(stored()));
  check('order-independent', a === extractionsFingerprint([...stored()].reverse()));
  check('value edit changes it', a !== extractionsFingerprint(stored({ total: { display_value: '£1.00' } })));
  check('note appearing changes it', a !== extractionsFingerprint(stored({ total: { validation_note: 'v' } })));
  check('confidence change changes it', a !== extractionsFingerprint(stored({ total: { confidence: 12 } })));
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
