#!/usr/bin/env node
'use strict';
/**
 * test_optional_soft_flag.js — pins the DARK arc `optional_soft_flag_autofile` (owner 2026-09-09, gary design):
 * a wordness / format-variance note on an OPTIONAL non-role non-strict field no longer BLOCKS auto-file on a
 * GRADUATED scope. The pure predicate `isSoftAdvisory` carries the whole safety asymmetry (role / required /
 * strict-typed fields + a pending corrected_to still block); the wiring is source-scanned; the end-to-end
 * OFF/ON behaviour is the flip-gate census on arm137 + the 605 corpus.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_optional_soft_flag.js
 */
const path = require('path');
const fs = require('fs');
const trust = require('./trust');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const roleKeys = new Set(['supplier_name', 'invoice_number', 'invoice_date']);

console.log('isSoftAdvisory — the safety asymmetry (soft = optional AND non-role AND non-strict only):');
check('optional non-role text field → SOFT', trust.isSoftAdvisory('customer_name', 'text', 0, roleKeys) === true);
check('a ROLE field is never soft (issuer)', trust.isSoftAdvisory('supplier_name', 'text', 0, roleKeys) === false);
check('a ROLE field is never soft (ref)', trust.isSoftAdvisory('invoice_number', 'reference_code', 0, roleKeys) === false);
check('a REQUIRED field is never soft', trust.isSoftAdvisory('customer_name', 'text', 1, roleKeys) === false);
check('a STRICT-typed field is never soft (date)', trust.isSoftAdvisory('some_date', 'date', 0, roleKeys) === false);
check('a STRICT-typed field is never soft (currency)', trust.isSoftAdvisory('some_amt', 'currency', 0, roleKeys) === false);
check('UNKNOWN required → NOT soft (fail-safe)', trust.isSoftAdvisory('note', 'text', undefined, roleKeys) === false);
check('empty key → not soft', trust.isSoftAdvisory('', 'text', 0, roleKeys) === false);

console.log('wiring (source-scan of trust.js):');
const src = fs.readFileSync(path.join(__dirname, 'trust.js'), 'utf8').replace(/\r\n/g, '\n');
check('the non-block is gated on a GRADUATED/corroborated scope, never a cold one',
      /const _softNonblock = _softFlagOn && \(graduated \|\| corroborated\);/.test(src));
check('isAutoFileEligible uses the role-aware count only when _softNonblock',
      /_softNonblock[\s\S]{0,20}\? _flaggedSoftAware\(db, doc, opts, _ctFlags\)/.test(src));
check('_flaggedSoftAware keeps corrected_to blocking and only skips soft-advisory notes',
      /if \(ctFlags\(e\.corrected_to, e\.display_value\)\) return true;/.test(src)
      && /return !isSoftAdvisory\(e\.field_key, m\.type, m\.required, roleKeys\);/.test(src));
check('docTrustGate skips the note-block ONLY for a soft-advisory field under softOptionalNonblock',
      /opts\.softOptionalNonblock && isSoftAdvisory\(e\.field_key, fieldTypes\.get\(e\.field_key\), _requiredByKey\.get\(e\.field_key\), roleKeys\)/.test(src));
check('isAutoFileEligible threads softOptionalNonblock into docTrustGate',
      /docTrustGate\(db, doc\.id, doc\.supplier_name, slug, \{ \.\.\.opts, softOptionalNonblock: _softNonblock \}\)/.test(src));
check('the OFF path keeps the original flagged filter + COUNT SQL (byte-identical when the arc is off)',
      /opts\.extractions\.filter\(e => String\(e\.validation_note \|\| ''\)\.trim\(\) \|\| _ctFlags\(e\.corrected_to, e\.display_value\)\)\.length/.test(src)
      && /SELECT COUNT\(\*\) c FROM extractions WHERE document_id = \? AND \(\(validation_note IS NOT NULL/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nAll optional-soft-flag pins passed');
process.exit(fails ? 1 : 0);
