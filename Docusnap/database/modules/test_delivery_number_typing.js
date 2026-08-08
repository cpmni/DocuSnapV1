'use strict';
/*
 * test_delivery_number_typing.js — a delivery number is a CODE, and must carry a digit.
 *
 * THE DEFECT (owner decision, 2026-08-08; migration 59). `delivery_number` shipped as type `text`,
 * and `text` is the least-gated state in the whole system: there is no `validation_patterns.text`
 * entry at all, and `text` is not in `STRICT_TYPES`, so the field had NO type-keyed format gate on
 * any surface. That is how the printed caption 'Delivery' came to be stored as a delivery number
 * and auto-filed — the class the 2026-08-07 delivery-caption arc chased from the geometry side.
 *
 * WHY reference_code AND NOT SOMETHING LOOSER — measured on the live install before the change,
 * not assumed: of 126 distinct `delivery_number` values, exactly ONE carries no digit — 'Delivery',
 * 5 occurrences, i.e. the bug itself. Every other value (DN-98447, PD267010, DN-24408 …) has
 * digits. `reference_code` requires at least one digit, so it withholds precisely the defect class
 * and nothing else. That measurement is the whole justification for the retype, so it is recorded
 * here rather than only in a commit message.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — verified, not assumed. Extraction is unchanged. Stage 1
 * still reads through the SHIPPED `field_patterns.delivery_number` entry, whose `validation` stays
 * `alphanumeric`, and `engine._seed_field_patterns` skips any key already in the shipped config, so
 * Stage 0.5/2 `val_type` does not move either. Only the TYPE-keyed gate at the filing boundary
 * changes. Pinned below, because a future dev "tidying" the config by switching that shipped
 * validation to reference_code as well WOULD change extraction — reference_code is anchored and
 * `_clean_value` has no reference_code extraction leg, so a value like "No. DN-98447" would be
 * dropped rather than cleaned.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_delivery_number_typing.js
 */
const fs = require('fs');
const path = require('path');
const trust = require('./trust.js');
const { PRESET_CATALOG } = require('./document_types.js');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

console.log('\nTHE CATALOG SHIPS IT AS A CODE');
{
  const dn = (PRESET_CATALOG || []).find(t => t.ref_field_key === 'delivery_number');
  check('a Delivery Note preset exists and keys its ref role to delivery_number', !!dn);
  const f = dn && (dn.fields || []).find(x => x.key === 'delivery_number');
  check('its delivery_number field is typed reference_code (not text)', !!f && f.type === 'reference_code');
  check('...and it is still the required structural ref field', !!f && f.required === 1);
}

console.log('\nreference_code IS GATED AT THE FILING BOUNDARY (text was not)');
check("'reference_code' is a strict type", trust.STRICT_TYPES.has('reference_code'));
check("'text' is NOT — this is why the old typing had no gate at all",
      !trust.STRICT_TYPES.has('text'));

console.log('\nTHE MEASURED POPULATION — the one digit-free value is rejected, the rest pass');
// THE BUG ITSELF: the printed caption, stored 5x on the live install as a delivery number.
check("'Delivery' (the caption) is REJECTED", trust.matchesTypePattern('reference_code', 'Delivery') === false);
check("'Delivery Note' is REJECTED", trust.matchesTypePattern('reference_code', 'Delivery Note') === false);
// Real values sampled from the live install — all 125 other distinct values carry digits.
for (const v of ['DN-98447', 'PD267010', 'DN-24408', 'DN-99718', 'PD251438', 'DN-98358']) {
  check(`real delivery number ${v} still passes`, trust.matchesTypePattern('reference_code', v) === true);
}
check("a digit-free word is rejected however code-like it looks",
      trust.matchesTypePattern('reference_code', 'DESPATCH') === false);

console.log('\nEXTRACTION MUST NOT MOVE — the shipped Stage-1 entry stays alphanumeric');
{
  const cfg = require(path.join(__dirname, '..', '..', 'config', 'keyword_patterns.json'));
  const entry = (cfg.field_patterns || {}).delivery_number;
  check('the shipped delivery_number entry still exists', !!entry);
  check("...and its validation is still 'alphanumeric', so Stage 1 reads exactly as before",
        !!entry && entry.validation === 'alphanumeric');
  // If someone tightens the line above to reference_code, they change EXTRACTION, not just filing:
  // reference_code is ^-anchored and _clean_value has no extraction leg for it.
  check('reference_code is anchored (which is why it must not become the Stage-1 gate casually)',
        (cfg.validation_patterns.reference_code || []).every(p => p.startsWith('^') && p.endsWith('$')));
}

console.log('\nTHE MIGRATION EXISTS AND IS NARROW');
{
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  check('migration 59 is present', /applied\.has\(59\)/.test(idx));
  check("it only retypes fields currently typed text/empty (idempotent, never clobbers a choice)",
        /UPDATE fields SET type = 'reference_code'[\s\S]{0,240}IN \('text',''\)/.test(idx));
  check('it is scoped to types whose ref ROLE is delivery_number, not every field with that key',
        /ref_field_key = 'delivery_number'/.test(idx));
  check('it stamps the migrations table', /VALUES \(59\)/.test(idx));
}

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nall delivery_number typing pins passed\n');
process.exit(fails ? 1 : 0);
