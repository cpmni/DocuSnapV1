'use strict';
/*
 * test_not_recognised.js — the "Not recognised" tab membership predicate (Part B, 2026-09-21).
 *
 * A review-queue row is UNIDENTIFIED (belongs in the calm "Not recognised" bucket, out of the main queue)
 * iff: no issuer value (issuer_blank===1) AND no document type AND nothing suggested. NEVER keyed on
 * confidence (the overcorrection guard — a faint but present read is not "unrecognised"). A TYPED-but-no-
 * issuer doc is only PARTIALLY recognised and stays in Review.
 *
 * Run: node src/windows/shared/test_not_recognised.js
 */
const { isNotRecognisedDoc } = require('./notRecognised');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// membership TRUE — truly unidentified
check('no issuer + no type + no suggestion -> IN the bucket',
  isNotRecognisedDoc({ issuer_blank: 1, document_type_id: null, issuer_suggested: null }) === true);
check('issuer_blank as boolean true is accepted too',
  isNotRecognisedDoc({ issuer_blank: true, document_type_id: null }) === true);
check('a low OVERALL confidence does not change membership (still in — it is unidentified, not low)',
  isNotRecognisedDoc({ issuer_blank: 1, document_type_id: null, overall_confidence: 12 }) === true);

// membership FALSE — recognised / partially recognised (stays in Review)
check('a TYPED doc with no issuer -> NOT in the bucket (partially recognised)',
  isNotRecognisedDoc({ issuer_blank: 1, document_type_id: 4 }) === false);
check('an issuer VALUE present -> NOT in the bucket',
  isNotRecognisedDoc({ issuer_blank: 0, document_type_id: null }) === false);
check('a LOW-confidence but PRESENT issuer -> NOT in the bucket (never keyed on confidence)',
  isNotRecognisedDoc({ issuer_blank: 0, document_type_id: null, overall_confidence: 8 }) === false);
check('a letterhead SUGGESTION offered -> NOT in the bucket (there is a "Use X" to click)',
  isNotRecognisedDoc({ issuer_blank: 1, document_type_id: null, issuer_suggested: 'Acme Ltd' }) === false);
check('a blank/whitespace suggestion does NOT rescue it (still unidentified)',
  isNotRecognisedDoc({ issuer_blank: 1, document_type_id: null, issuer_suggested: '   ' }) === true);

// edges
check('null doc -> false', isNotRecognisedDoc(null) === false);
check('undefined -> false', isNotRecognisedDoc(undefined) === false);
check('a fully-read doc (issuer + type) -> false', isNotRecognisedDoc({ issuer_blank: 0, document_type_id: 2 }) === false);

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
