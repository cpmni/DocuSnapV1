'use strict';
/*
 * test_issuer_clear_not_a_correction.js — pins Oracle's revised B2 (2026-08-14).
 * Run: node src/windows/review/test_issuer_clear_not_a_correction.js
 *
 * THE DATA LOSS THIS PINS. When the Document Issuer settles on a different sender,
 * _clearSuspectReadsForNewIssuer empties every field that was read from a supplier-SCOPED source,
 * because those values belonged to the previous supplier. Correct policy. But it used to record
 * the clear as `corrections[key] = {original_value: o, corrected_value: ''}` — an entry
 * BYTE-IDENTICAL to the one an operator's own edit stages. saveCorrections then wrote it straight
 * through: `UPDATE extractions SET display_value = '', was_corrected = 1`
 * (database/modules/learning.js:325), blanking the stored row and stamping it as human-corrected,
 * plus a corrections audit row asserting an edit that never happened.
 *
 * Two outcomes were observed, and the quieter one is the worse:
 *   (1) no repaint  — the panel is blank, the filed name loses the field, the row is blanked.
 *   (2) a repaint   — _resolveFieldVisibility calls renderFields, which rebuilds every row from
 *                     doc.extractions, so the operator sees the CORRECT values and confirms; the
 *                     stored row is blanked underneath them. Screen and database diverge, and
 *                     search then misses a document the operator can see is right.
 *
 * WHY THE FIX IS HERE AND NOT IN THE BACKEND. Oracle first specified a guard in saveCorrections
 * refusing to write an empty display_value. Measured against source, that breaks the LEGITIMATE
 * case: getFieldFormats computes `(corrected_value || display_value || '').trim()`
 * (learning.js:1363) — '' is falsy — so with the row preserved, a value the operator DELIBERATELY
 * deleted keeps feeding value_counts, the name lexicon and the dominance snap for ever. And the
 * backend cannot separate the two cases: both stage an identical entry, and it cannot be given a
 * marker without a payload-suppliable field, which the internal-`via` convention forbids.
 * Ruling (Oracle, revised B2): the defect is that a machine-initiated clear IMPERSONATES an
 * operator correction. Fix the impersonation at its source; leave the write alone.
 *
 * ACCEPTED TRADE-OFF, pinned below so it is not "fixed" back: the stored extraction row keeps the
 * previous supplier's value until reprocess. That is the normal state of every field the operator
 * did not touch — visible and correctable — whereas a false corrections row and a blanked value
 * are neither.
 */
const fs   = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const learning = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'database', 'modules', 'learning.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// ── Slice the clear out of renderer.js and run it against a stub DOM ────────────────────────
const cs = renderer.indexOf('function _clearSuspectReadsForNewIssuer');
const ce = renderer.indexOf('async function _refreshTaughtForType');
check('_clearSuspectReadsForNewIssuer is present', cs > -1 && ce > cs);
const clearSrc = renderer.slice(cs, ce);

// _isSupplierScopedRead is the real one, sliced too — the scope predicate must not drift from
// what the test believes it is.
const ps = renderer.indexOf('function _isSupplierScopedRead');
const pe = renderer.indexOf('// After the issuer settles on a different supplier');
check('_isSupplierScopedRead is present', ps > -1 && pe > ps);

function makeInput(key, value, method) {
  return {
    value,
    dataset: { key, method, original: value },
    classList: { remove() {}, add() {}, toggle() {} },
    closest: () => null,
  };
}

// Build the harness: real clear + real scope predicate, stubbed surroundings.
function runClear({ issuer, storedSupplier, inputs }) {
  const corrections = {};
  let clearedByIssuerChange = new Set();
  const toasts = [];
  const messages = [];                  // what the operator is TOLD about the clear (2026-08-13)
  const scope = {
    corrections,
    get clearedByIssuerChange() { return clearedByIssuerChange; },
    set clearedByIssuerChange(v) { clearedByIssuerChange = v; },
    currentDoc: { supplier_name: storedSupplier },
    _currentIssuerValue: () => issuer,
    validateConfirm: () => {},
    showToast: (msg, level) => toasts.push({ msg, level }),
    // The clear now NAMES the fields it emptied and offers an undo, so the slice needs the label
    // lookup and the persistent-bar surface it calls (both live outside the sliced range).
    labelFor: (k) => ({ vat_no: 'VAT Number', customer_name: 'Customer', total: 'Total' }[k] || k),
    escHtml: (s) => String(s == null ? '' : s),
    appendTeachMessage: (html, opts) => { messages.push({ html, actions: (opts && opts.actions) || [] }); },
    dismissServerNote: () => {},
    clearFieldWarning: () => {},
    document: { querySelectorAll: () => inputs },
  };
  const fn = new Function('scope', `
    with (scope) {
      ${renderer.slice(ps, pe)}
      ${clearSrc}
      _clearSuspectReadsForNewIssuer();
    }
  `);
  fn(scope);
  return { corrections, cleared: clearedByIssuerChange, toasts, messages, inputs };
}

console.log('\n— the machine clear must not impersonate an operator correction —');

const vat  = makeInput('vat_no',        'GB 512 8846 27',            'template_fixed');
const cust = makeInput('customer_name', 'Quillstone Print & Packaging', 'anchor_crop');
const kw   = makeInput('total',         '1234.56',                   'keyword');       // supplier-INDEPENDENT
const r1 = runClear({
  issuer: 'B8ramblewood Joinery Ltd',        // the round-4 garble: differs from stored ⇒ clear fires
  storedSupplier: 'Bramblewood Joinery Ltd',
  inputs: [vat, cust, kw],
});

check('the clear still fires (this test is not vacuous)', r1.cleared.size > 0);
check('supplier-scoped fields are emptied on screen', vat.value === '' && cust.value === '');
check('a keyword (supplier-independent) read is KEPT', kw.value === '1234.56');
check('NO corrections entry is staged for a machine-cleared field  ← the fix',
      Object.keys(r1.corrections).length === 0);
check('the cleared keys are recorded as a render fact instead',
      r1.cleared.has('vat_no') && r1.cleared.has('customer_name'));
check('a kept field is not recorded as cleared', !r1.cleared.has('total'));
// B2d, 2026-08-13: the SURFACE moved and the intent is unchanged. B2d shipped a `warn` toast,
// because with no corrections entry and no database trace that toast was the only record N fields
// were emptied. A toast is a 4-second record that names nothing — Chris round 4 card 3 was exactly
// this: "I fixed one field and two correct fields I never touched went blank, with no message."
// The announcement now goes to the PERSISTENT bar, NAMES each field, and offers an undo. The pin
// keeps B2d's real requirement (a destructive clear is announced, never in the success tone) and
// adds the two properties that make it useful.
check('the destructive clear is ANNOUNCED  (B2d)', r1.messages.length === 1);
check('...naming each field it emptied, not just a count',
      /VAT Number/.test(r1.messages[0].html) && /Customer/.test(r1.messages[0].html));
check('...and offering the way back', r1.messages[0].actions.length === 1
      && /undo/i.test(r1.messages[0].actions[0].label));
check('...and never as a success-tone toast', r1.toasts.length === 0);

// No-op cases — the clear must not fire at all.
const untouched = makeInput('vat_no', 'GB 512 8846 27', 'template_fixed');
const r2 = runClear({ issuer: 'Bramblewood Joinery Ltd', storedSupplier: 'bramblewood joinery ltd',
                      inputs: [untouched] });
check('same supplier (case-insensitive) ⇒ nothing cleared, nothing said',
      untouched.value === 'GB 512 8846 27' && r2.cleared.size === 0 && r2.toasts.length === 0);

// ── Source pins: the surrounding wiring the behaviour depends on ────────────────────────────
console.log('\n— wiring —');

check('renderFields suppresses a cleared field across a repaint  ← closes the resurrect-and-file hole',
      /clearedByIssuerChange\.has\(key\)\s*\?\s*''\s*:/.test(renderer));

check('an operator edit releases the suppression (retyping is not blanked by the next repaint)',
      /clearedByIssuerChange\.delete\(key\)/.test(renderer));

// Count RESETS only — the `let clearedByIssuerChange = new Set()` declaration is not one.
const resets = (renderer.match(/(?<!let )clearedByIssuerChange = new Set\(\)/g) || []).length;
const corrResets = (renderer.match(/(?<!let )corrections = \{\}/g) || []).length;
check(`the set is doc-scoped: reset at every site corrections is (${resets} vs ${corrResets})`,
      resets === corrResets && resets >= 4);

check('the clear no longer writes corrections[key] anywhere in its body',
      !/corrections\[key\]\s*=/.test(clearSrc));

// ── The deliberate NON-change, pinned so a future session does not "also fix" the backend ───
console.log('\n— the backend write is deliberately UNCHANGED (see header) —');

check('saveCorrections still reflects a correction onto the stored extraction row',
      /UPDATE extractions SET display_value = @corrected_value, was_corrected = 1/.test(learning));
check('...unconditionally, so an operator\'s OWN clear still empties the row and leaves learning',
      /updateExtractionValue\.run\(\{ document_id, field_key, corrected_value: corrected_value \?\? '' \}\)/
        .test(learning));
check('getFieldFormats still falls through a falsy corrected_value to display_value '
      + '(the reason a backend guard would break the human clear)',
      /const finalValue = \(row\.corrected_value \|\| row\.display_value \|\| ''\)\.trim\(\)/.test(learning));
check('clearAnchors remains reachable only for a NON-EMPTY corrected_value '
      + '(so a machine clear could never have wiped a taught anchor — Oracle B2c refuted at source)',
      // Window widened 1600→2600: saveCorrections' single `if (corrected_value)` block grew past 1600
      // chars (LIST-ownership + global-hint legs) before the ONE guarded clearAnchors call. The invariant
      // is unchanged — there is exactly one `if (corrected_value)` guard and one clearAnchors CALL in
      // saveCorrections, and the call is inside the guard; the window only bounds "closely follows".
      /if \(corrected_value\) \{[\s\S]{0,2600}?clearAnchors\(db, \{/.test(learning));

console.log(fails ? `\n${fails} FAILED` : '\nAll pins passed');
process.exit(fails ? 1 : 0);
