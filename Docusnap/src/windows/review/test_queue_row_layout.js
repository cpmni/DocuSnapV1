#!/usr/bin/env node
'use strict';
/**
 * src/windows/review/test_queue_row_layout.js — the Review queue row must never paint its meta chips over
 * the delete (×) button (owner screenshot 2026-09-08: at a narrow queue width the "↩ will re-file" chip and
 * the % badge, both flex-shrink:0, overflowed the body column and floated over the ×). Pins the layout
 * contract in the row template: the body column clips (`overflow:hidden`) and the meta line wraps
 * (`flex-wrap:wrap`), the chips stay flex-shrink:0 (they must not be squashed into ellipsis), and the
 * delete button stays a SIBLING of the body inside the outer flex row (its own slot, `flex-shrink:0`).
 *
 *   node src/windows/review/test_queue_row_layout.js
 */
const fs = require('fs');
const path = require('path');
const R = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  OK  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const tpl = R.slice(R.indexOf('<img class="qi-thumb" alt="">'), R.indexOf('qi-delete" title='));
check('the body column clips its overflow (nothing can paint past it)', /class="qi-body" style="[^"]*overflow:hidden/.test(tpl));
check('the body column keeps flex:1 + min-width:0 (it may shrink)', /class="qi-body" style="[^"]*flex:1;[^"]*min-width:0/.test(tpl));
check('the meta line wraps instead of overflowing', /class="qi-meta" style="[^"]*flex-wrap:wrap/.test(tpl));
check('the chips keep flex-shrink:0 (badge + put-back are never squashed)', /conf-badge[^>]*flex-shrink:0/.test(R) && /\.qi-putback\s*\{[^}]*flex-shrink:\s*0/.test(H));
check('the delete button is a sibling AFTER the body (its own flex slot)', R.indexOf('class="qi-body"') < R.indexOf('qi-btn danger qi-delete') && /\.qi-delete\s*\{[^}]*flex-shrink:\s*0/.test(H));
check('the seam is recorded beside .qi-delete', /painted over\s+this button/.test(H.replace(/\s+/g, ' ')));
console.log(`\nqueue-row layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
