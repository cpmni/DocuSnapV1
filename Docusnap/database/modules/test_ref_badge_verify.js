#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_ref_badge_verify.js
 * -----------------------------------------
 * Pins trust.refBadgeVerified / refBadgeVerifyEnabled — the DARK ref-badge verify state (mig 185,
 * 2026-09-18; Chris #1; gary -> Oracle SIGN-OFF-W/COND C1-C6). The Review badge maps a READ confidence to
 * green "High"; on the REFERENCE role that over-claims verification the value never got, so a confident
 * single-glyph misread (PO-69837->PO-69637 @93, keyword, first-seen) wore a trustworthy badge.
 *
 * The load-bearing pins (Oracle's flip gate, predicate layer):
 *   - THE EXHIBIT: a confident, valid-shape, FIRST-SEEN, single-witness keyword ref => verified=FALSE
 *     (so the renderer shows "Read", not green). A future "make refs green again" change trips this.
 *   - INVERSE: a corroborated ref stays verified=TRUE (green) — the neutral state never becomes universal.
 *   - C2/C3: history is a SUPPLIER-SCOPE property (confirmed_count>=3), never the value's shape; the
 *     doc-type-wide ('' supplier) bucket must NOT green a first-seen supplier off other suppliers' history.
 *   - authority precedence: a typed/admin-fixed/override ref is verified BY AUTHORITY.
 *   - the enable gate honours the env kill + the setting.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_ref_badge_verify.js
 */

const Database = require('better-sqlite3');
const trust    = require('./trust');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function section(t) { console.log(`\n${t}`); }

// A corroboration record that _corrobLicensed accepts: >=2 independent page families agree, none disagree.
const CORROB_OK  = JSON.stringify({ independent_agree: true, winner_family: 'crop', agree: ['keyword'], disagree: [] });
// A single-family record (the exhibit): a lone keyword read, agrees with nothing => NOT licensed.
const CORROB_ONE = JSON.stringify({ independent_agree: false, winner_family: 'keyword', agree: [], disagree: [] });

const DOC     = { supplier_name: 'Northgate Textiles', type_slug: 'purchase_order' };
const REFKEY  = 'po_number';
// Matured supplier-scope history for THIS supplier+type+field.
const FMT_MATURE = [{ field_key: 'po_number', document_type: 'purchase_order', supplier_name: 'Northgate Textiles', confirmed_count: 5 }];
// History exists ONLY in the doc-type-wide ('' supplier) bucket + for OTHER suppliers — never for this one.
const FMT_OTHERS = [
  { field_key: 'po_number', document_type: 'purchase_order', supplier_name: '',              confirmed_count: 40 },
  { field_key: 'po_number', document_type: 'purchase_order', supplier_name: 'Someone Else',   confirmed_count: 12 },
];
// A supplier-scoped group that is under the >=3 bar (should never appear in the default getFieldFormats
// output, but pin the threshold directly for safety).
const FMT_THIN = [{ field_key: 'po_number', document_type: 'purchase_order', supplier_name: 'Northgate Textiles', confirmed_count: 2 }];

const ext = (o) => ({ display_value: 'PO-69637', raw_value: 'PO-69637', extraction_method: 'keyword', corroboration: null, ...o });

section('THE EXHIBIT — confident, valid-shape, first-seen, single-witness keyword ref => NOT verified ("Read")');
check('null corroboration, keyword, no history => false',
  trust.refBadgeVerified(null, DOC, REFKEY, ext({ corroboration: null }), { formats: [] }) === false);
check('1-family (keyword only) record => false',
  trust.refBadgeVerified(null, DOC, REFKEY, ext({ corroboration: CORROB_ONE }), { formats: [] }) === false);

section('INVERSE — a corroborated ref stays verified (green)');
check('>=2 page families agree => true',
  trust.refBadgeVerified(null, DOC, REFKEY, ext({ corroboration: CORROB_OK }), { formats: [] }) === true);

section('C2/C3 — history is a SUPPLIER-SCOPE property, never value shape, never the doc-type-wide bucket');
check('matured supplier scope (confirmed_count 5) => true',
  trust.refBadgeVerified(null, DOC, REFKEY, ext(), { formats: FMT_MATURE }) === true);
check('history only in the "" bucket + other suppliers => FALSE for a first-seen supplier',
  trust.refBadgeVerified(null, DOC, REFKEY, ext(), { formats: FMT_OTHERS }) === false);
check('supplier scope under the >=3 bar => false',
  trust.refBadgeVerified(null, DOC, REFKEY, ext(), { formats: FMT_THIN }) === false);
check('shape-blind: a shape-valid value alone never greens (same as the exhibit)',
  trust.refBadgeVerified(null, DOC, REFKEY, ext({ display_value: 'PO-00001' }), { formats: [] }) === false);

section('authority precedence — a typed / admin-fixed / override ref is verified BY AUTHORITY');
for (const m of ['manual', 'template_fixed', 'template_fixed_locked', 'keyword_override']) {
  check(`method '${m}' (no corrob, no history) => true`,
    trust.refBadgeVerified(null, DOC, REFKEY, ext({ extraction_method: m }), { formats: [] }) === true);
}
check("method 'anchor' (placement, not an authoritative literal) => false",
  trust.refBadgeVerified(null, DOC, REFKEY, ext({ extraction_method: 'anchor' }), { formats: [] }) === false);
check('no ref key => false (never green a doc without a ref role)',
  trust.refBadgeVerified(null, DOC, null, ext(), { formats: FMT_MATURE }) === false);

section('enable gate — env kill + the setting');
const prev = process.env.REF_BADGE_VERIFY_STATE;
process.env.REF_BADGE_VERIFY_STATE = '1'; check('env 1 => enabled', trust.refBadgeVerifyEnabled(null) === true);
process.env.REF_BADGE_VERIFY_STATE = '0'; check('env 0 => disabled', trust.refBadgeVerifyEnabled(null) === false);
delete process.env.REF_BADGE_VERIFY_STATE;
const db = new Database(':memory:');
db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`);
check('setting absent => DARK (disabled)', trust.refBadgeVerifyEnabled(db) === false);
db.prepare(`INSERT INTO settings (key, value) VALUES ('ref_badge_verify_state', 'true')`).run();
check('setting true => enabled', trust.refBadgeVerifyEnabled(db) === true);
if (prev !== undefined) process.env.REF_BADGE_VERIFY_STATE = prev;

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'}`);
process.exit(fails === 0 ? 0 : 1);
