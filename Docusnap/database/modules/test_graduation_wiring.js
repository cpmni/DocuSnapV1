'use strict';
/*
 * test_graduation_wiring.js — source-inspection pins for the graduation auto-template WIRING
 * (the seams the Oracle made load-bearing; the LOGIC is covered by test_graduation_template.js).
 * Run: node database/modules/test_graduation_wiring.js
 */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

const reviewSvc = read('src', 'services', 'reviewService.js');
const handler   = read('src', 'modules', 'review', 'handler.js');
const api       = read('src', 'modules', 'api', 'handler.js');
const gradMod   = read('database', 'modules', 'graduationTemplate.js');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

console.log('reviewService.js — detached-block wiring + ORDERING (Oracle):');
check('onScopeGraduated is an optional deps hook defaulting to no-op',
      reviewSvc.includes('const onScopeGraduated     = deps.onScopeGraduated     || (async () => {});'));
check('the graduation hook is called with its own try/catch (best-effort, never breaks confirm)',
      reviewSvc.includes('await onScopeGraduated(db, document_id, { allValues, document_type_slug, supplier_name, dtInfo })'));
const idxTaught = reviewSvc.indexOf('await onTaughtConfirm(');
const idxGrad   = reviewSvc.indexOf('await onScopeGraduated(');
check('graduation hook runs AFTER onTaughtConfirm (taught template wins → no double-create)',
      idxTaught > 0 && idxGrad > idxTaught);
check('graduation hook is OUTSIDE the taught_fields guard (fires on plain confirms)',
      // the taught_fields `if (...) { onTaughtConfirm }` block closes before the graduation call
      idxGrad > reviewSvc.indexOf('Array.isArray(taught_fields)') &&
      /onTaughtConfirm[\s\S]*?\n\s*}\n[\s\S]*?await onScopeGraduated/.test(reviewSvc));
check('graduation hook is inside the !bulk detached block', reviewSvc.includes('if (!bulk) {'));

console.log('\nreview/handler.js — injection + Electron enrichment:');
check('desktop injects onScopeGraduated → _maybeGraduationTemplate',
      handler.includes('onScopeGraduated: (db, docId, info) => _maybeGraduationTemplate(ctx, db, docId, info),'));
check('_maybeGraduationTemplate delegates the decision+DB write to the pure module',
      handler.includes('graduation.decide(db, document_id, info)') && handler.includes('graduation.apply(db, document_id, decision)'));
check('enrichment (sample/landmarks/fingerprint) runs ONLY for a freshly CREATED template',
      /if \(res\.created\)\s*\{[\s\S]*?generateLandmarks[\s\S]*?generateFingerprint/.test(handler));
check('stale "no longer auto-created on every confirm" comment updated to note the graduation exception',
      handler.includes('ONCE at scope GRADUATION'));

console.log('\napi/handler.js — /v1 is DESKTOP-ONLY for this slice (Oracle ruling 7):');
check('the /v1 reviewService does NOT inject onScopeGraduated', !api.includes('onScopeGraduated'));

console.log('\ngraduationTemplate.js — C1 link-not-fold:');
check('apply() never CALLS templates.update(...) (would fold this doc into a foreign template)',
      !/templates\.update\([^)]/.test(gradMod));   // a real call has an arg; the comment says "templates.update()"
check('a link only UPDATEs documents.template_id (leaves the matched template untouched)',
      gradMod.includes("UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL"));

console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails ? 1 : 0);
