'use strict';
/*
 * test_taught_ref_disagree_suppress.js — the trust.js SEAM pins for TAUGHT_REF_DISAGREE_SUPPRESS
 * (mig 186, 2026-09-19; gary → Oracle SIGN-OFF-W/COND). Engine-side the filter moves an off-shape
 * ref competitor out of `disagree`/`discounted` into a NEW `suppressed_taught_role` key. These pins
 * lock the TWO trust.js contracts that make that safe:
 *   1. THE HOLD LIFTS: _pageFamilyDisagrees does NOT scan `suppressed_taught_role` (so the
 *      role-disagreement refusal no longer fires), but STILL fires on a real `disagree`.
 *   2. THE LICENCE DOES NOT LAUNDER (Oracle C1, the ship-blocker): _corrobLicensed returns FALSE on
 *      any non-empty `suppressed_taught_role` — so emptying `disagree` can never flip a mapping+crop
 *      common-mode record into a silent corroborated auto-file. refBadgeVerified inherits it.
 *
 * Run:  node database/modules/test_taught_ref_disagree_suppress.js
 */
const path = require('path');
const trust = require(path.join(__dirname, 'trust.js'));

let P = 0, F = 0;
const ok = (name, cond) => { if (cond) { P++; console.log('  ok  ' + name); } else { F++; console.log('  FAIL ' + name); } };

console.log('1. _corrobLicensed — the suppressed-entry guard (Oracle C1, the ship-blocker)');
{
  // The exact bug shape: a taught MAPPING winner with an agreeing CROP candidate (common-mode, Pelican-565),
  // and the only thing that had been holding the licence off was the now-emptied `disagree`.
  const laundered = { winner_family: 'mapping', agree: ['crop'], disagree: [],
                      suppressed_taught_role: [{ family: 'keyword', value: 'JB-2554' }], independent_agree: true };
  ok('a record whose competitor was moved to suppressed_taught_role is NOT corrob-licensed (no silent auto-file)',
     trust._corrobLicensed(laundered) === false);
  // CONTROL: the SAME record without the suppressed entry IS licensed — proves the guard is the deciding line,
  // not some other predicate (so a future dev who removes the guard sees this flip and the pin above go red).
  const control = { winner_family: 'mapping', agree: ['crop'], disagree: [], independent_agree: true };
  ok('CONTROL: the same mapping+crop record with NO suppressed entry IS licensed', trust._corrobLicensed(control) === true);
  // A stringified record (the stored column form) is guarded too.
  ok('guard applies to the JSON-string record form', trust._corrobLicensed(JSON.stringify(laundered)) === false);
  // An empty suppressed list must NOT block (byte-identical to no key).
  ok('an EMPTY suppressed_taught_role list does not block the licence',
     trust._corrobLicensed({ winner_family: 'mapping', agree: ['crop'], disagree: [], suppressed_taught_role: [], independent_agree: true }) === true);
}

console.log('\n2. _pageFamilyDisagrees — the hold LIFTS for a suppressed competitor, but a real disagree still holds');
{
  // Competitor ONLY in suppressed_taught_role (engine moved it there) → no page-family disagreement → hold lifts.
  const suppressed = { winner_family: 'mapping', agree: [], disagree: [],
                       suppressed_taught_role: [{ family: 'keyword', value: 'JB-2554' }], independent_agree: false };
  ok('a competitor in suppressed_taught_role is NOT seen by _pageFamilyDisagrees (the role-refusal stops holding)',
     trust._pageFamilyDisagrees(suppressed) === null);
  // A genuine disagree is unchanged — the guard did not weaken the refusal for the normal case.
  const held = { winner_family: 'mapping', agree: [], disagree: [{ family: 'keyword', value: 'JB-2554' }], independent_agree: false };
  const hit = trust._pageFamilyDisagrees(held);
  ok('a real disagree still fires _pageFamilyDisagrees (normal hold intact)', hit && hit.family === 'keyword' && hit.value === 'JB-2554');
  // And a competitor still in `discounted` still holds (only the engine, when it actually suppresses, moves it out).
  const disc = { winner_family: 'mapping', agree: [], disagree: [], discounted: [{ family: 'keyword', value: 'JB-2554', reason: 'x' }], independent_agree: false };
  ok('a competitor still in discounted still fires _pageFamilyDisagrees', trust._pageFamilyDisagrees(disc) && trust._pageFamilyDisagrees(disc).family === 'keyword');
}

console.log('\n3. refBadgeVerified — inherits the guard (no green badge via the corroborated leg on a suppressed record)');
{
  const doc = { supplier_name: 'Castellan Security Systems', type_slug: 'service_worksheet' };
  const extLaundered = { extraction_method: 'template_mapping', corroboration: JSON.stringify(
    { winner_family: 'mapping', agree: ['crop'], disagree: [], suppressed_taught_role: [{ family: 'keyword', value: 'JB-2554' }], independent_agree: true }) };
  // No DB history passed (opts.formats=[]) and method is not an authoritative literal, so the ONLY road to
  // "verified" would be the corroborated leg — which the guard closes. Verdict must be false.
  ok('refBadgeVerified is NOT true via corroboration for a suppressed-competitor record',
     trust.refBadgeVerified(null, doc, 'reference_number', extLaundered, { formats: [] }) === false);
  // INVARIANCE: the control (no suppressed entry) WOULD be corroborated-verified — proves the split rides the guard.
  const extControl = { extraction_method: 'template_mapping', corroboration: JSON.stringify(
    { winner_family: 'mapping', agree: ['crop'], disagree: [], independent_agree: true }) };
  ok('INVARIANCE: the same record without the suppressed entry IS corroborated-verified',
     trust.refBadgeVerified(null, doc, 'reference_number', extControl, { formats: [] }) === true);
}

console.log('\n' + (F === 0 ? 'ALL PASS' : F + ' FAILED') + `  (${P} ok)`);
process.exit(F ? 1 : 0);
