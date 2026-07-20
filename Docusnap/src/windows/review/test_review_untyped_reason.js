'use strict';
/*
 * test_review_untyped_reason.js — pins the UNTYPED-DOCUMENT explanation (Oracle C1, 2026-07-20).
 * Run: node src/windows/review/test_review_untyped_reason.js
 *
 * THE BUG THIS PINS. A document with no document_type_id used to fall all the way through
 * renderReviewReason to renderCleanHoldReason and be told:
 *     "read at 93%, just below the 100% you've set — lower the threshold in Settings → Processing"
 * That advice is FALSE for every null-type doc. trust.js isAutoFileEligible refuses with reason
 * 'no-type' at ANY confidence and ANY threshold, so lowering the slider to 0 files nothing. The
 * doc reached the clean branch because BOTH its counters are structurally zero when the type is
 * NULL: below_threshold_count JOINs fields ON f.document_type_id = d.document_type_id, and there
 * are no type-relevant extractions to flag. Meanwhile validateConfirm disabled Confirm and wrote
 * NO note, so the button was greyed out with nothing on screen explaining it.
 *
 * On a fresh install this is not an edge case: detection scores types from the SHIPPED
 * document_type_keywords buckets, which exist independently of the types an install HAS, so a
 * detected-but-not-installed type (Delivery Note is a PRESET, not a built-in) lands the doc
 * untyped — the 2026-07-20 delivery-docket report.
 *
 * ORDERING IS THE LOAD-BEARING PROPERTY, not the wording: the no-type branch must return BEFORE
 * lowN/flagN are consulted, or the clean branch reclaims the doc and the false advice comes back.
 *
 * GATED ON THE TYPE, NOT ON A DETECTED NAME. A later slice may enrich this sentence with the
 * detected type name ("this looks like a Delivery Note"). That enrichment must NOT become the
 * branch condition — the advice is wrong for EVERY untyped doc, including the majority where
 * detection returned nothing at all and there is no name to show.
 */
const fs   = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

console.log('renderReviewReason — the untyped branch:');

// Match CODE, not prose: the branch carries a long comment that names below_threshold_count and
// renderCleanHoldReason, so a bare indexOf on those words finds the explanation, not the statement,
// and the ordering assertions invert. (Caught by this test failing against the finished fix.)
const body = renderer.slice(renderer.indexOf('function renderReviewReason'));
const idxNoType = body.indexOf('if (!doc.document_type_id &&');
const idxLowN   = body.indexOf('const lowN = doc.below_threshold_count');
const idxClean  = body.indexOf('renderCleanHoldReason(el, doc)');

check('an untyped-document branch exists in renderReviewReason', idxNoType > -1);
check('it is gated on document_type_id, NOT on a detected type name',
      idxNoType > -1 && !/if \(!doc\.document_type_id && doc\.detected_type_name/.test(body));
check('ORDERING: the untyped branch precedes the below_threshold_count read',
      idxNoType > -1 && idxLowN > -1 && idxNoType < idxLowN);
check('ORDERING: the untyped branch precedes the clean/threshold branch',
      idxNoType > -1 && idxClean > -1 && idxNoType < idxClean);
check('it only speaks for docs actually WAITING (needs_review / deferred)',
      /!doc\.document_type_id && \(doc\.status === 'needs_review' \|\| doc\.status === 'deferred'\)/.test(body));
check('it returns, so the threshold copy cannot also run',
      idxNoType > -1 && body.slice(idxNoType, idxLowN).includes('return;'));
check('it states that the threshold is NOT the lever (the false-advice correction)',
      /never file itself automatically, whatever the confidence setting/.test(body));

console.log('\nvalidateConfirm — the no-type dead end:');
const vc = renderer.slice(renderer.indexOf('function validateConfirm'));
const vcNoType = vc.slice(0, vc.indexOf('const dt '));
check('the !selectedTypeSlug early-return writes a note instead of silently disabling Confirm',
      vcNoType.includes('confirm-config-note') && /Choose a document type/.test(vcNoType));
check('... and still disables Confirm (the gate itself is unchanged)',
      vcNoType.includes('btn.disabled = true') && vcNoType.includes('markRequiredMissing([])'));

console.log('\ntrust.js — the fact the copy rests on:');
const trust = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'trust.js'), 'utf8');
check("isAutoFileEligible still refuses a null-type doc with 'no-type' (unconditional)",
      /!doc\.document_type_id/.test(trust) && /'no-type'/.test(trust));

console.log(fails ? `\n${fails} FAILED` : '\nAll untyped-reason checks passed');
process.exit(fails ? 1 : 0);
