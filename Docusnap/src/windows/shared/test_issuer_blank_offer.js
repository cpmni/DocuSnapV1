'use strict';
/*
 * test_issuer_blank_offer.js — Card 4 (Chris R5): the blank-issuer "these look like X?" offer.
 * Pins the pure predicate AND the DARK wiring in renderer.js. The load-bearing pin is the SEAM guard
 * (Oracle 2026-08-26): the offer fires ONLY on a branding-provenance suggestion — a suggested_supplier
 * carrying a NON-branding note (e.g. a future buyer-issued vendor write) must NOT be offered, or the
 * offer would steer filing toward a company the page's letterhead does not identify as the issuer.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/shared/test_issuer_blank_offer.js
 */
const fs = require('fs');
const path = require('path');
const IBO = require('./issuerBlankOffer');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const BRAND = "The page branding reads 'Castellan' — please confirm the correct company.";
const VENDOR = "This looks like a purchase order you sent — file it under the supplier, Quillstone?";

console.log('predicate');
{
  const r = IBO.issuerOfferForBlank({ issuerValue: '', suggestedSupplier: 'Castellan', note: BRAND });
  check('FIRES on a blank issuer + branding-provenance suggestion', r.offer === true && r.name === 'Castellan');
}
// THE SEAM NEGATIVE PIN — a suggestion with a NON-branding note is refused (guards a future Card-2-style
// vendor write that overloads suggested_supplier with a different company).
check('does NOT fire on a suggestion with a NON-branding note (the seam guard)',
      IBO.issuerOfferForBlank({ issuerValue: '', suggestedSupplier: 'Quillstone', note: VENDOR }).offer === false);
// POSITIVE CONTROL — Path B (no suggestion) must reach the honest Unknown dialog, so the assertion
// above isn't vacuously green.
check('does NOT fire when there is no suggestion (Path B → honest Unknown Company)',
      IBO.issuerOfferForBlank({ issuerValue: '', suggestedSupplier: '', note: '' }).offer === false);
check('does NOT fire when the issuer already has a value (never override a read/typed value)',
      IBO.issuerOfferForBlank({ issuerValue: 'Acme Ltd', suggestedSupplier: 'Castellan', note: BRAND }).offer === false);
check('null-safe on missing fields', IBO.issuerOfferForBlank().offer === false && IBO.issuerOfferForBlank({}).offer === false);
check('the branding regex matches the exact renderer isBrandingFlag family',
      IBO.BRANDING_PROVENANCE.test('letterhead may read Foo') && IBO.BRANDING_PROVENANCE.test('confirm the correct company'));

console.log('renderer wiring (DARK)');
{
  const rd = fs.readFileSync(path.join(__dirname, '..', 'review', 'renderer.js'), 'utf8');
  check('the switch is read as DARK (default false) into _issuerBlankOfferOn',
        /getSetting\('issuer_suggest_on_blank_confirm'\)/.test(rd)
        && /_issuerBlankOfferOn = String\(blankOffer \?\? 'false'\) === 'true';/.test(rd));
  check('the confirm door gates the offer on the switch AND routes through the shared predicate',
        /_issuerBlankOfferOn && window\.IssuerBlankOffer/.test(rd)
        && /window\.IssuerBlankOffer\.issuerOfferForBlank\(\{/.test(rd));
  // The Chris round (2026-08-26) found the offer read `currentDoc.extractions`, but the queue stub has
  // NO extractions array (only the issuer_suggested scalar, which has no note) → the offer never fired.
  // Pin the fix: read the FULL rendered doc (_lastRenderedDoc, id-matched), never the stub.
  check('the offer reads the suggestion from the FULL rendered doc, not the empty queue stub',
        /_lastRenderedDoc && currentDoc && _lastRenderedDoc\.id === currentDoc\.id/.test(rd)
        && !/const _ext = \(currentDoc\?\.extractions/.test(rd));
  check('accept adopts for BOTH filing and learning (allValues + a correction), never a silent auto-fill',
        /if \(choice === 'adopt'\)/.test(rd)
        && /allValues\[issuerKey\] = _offer\.name;/.test(rd)
        && /corrections\[issuerKey\] = \{ original_value: '', corrected_value: _offer\.name \};/.test(rd));
  check("the 'unknown'/'cancel' paths preserve the old behaviour (blank → Unknown, or cancel)",
        /if \(choice === 'cancel'\) return \{ cancelled: true \};/.test(rd));
  check('index.html loads the predicate script', /issuerBlankOffer\.js/.test(
        fs.readFileSync(path.join(__dirname, '..', 'review', 'index.html'), 'utf8')));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll issuer-blank-offer pins passed');
process.exit(fails ? 1 : 0);
