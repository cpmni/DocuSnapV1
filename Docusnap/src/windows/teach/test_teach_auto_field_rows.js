'use strict';
/*
 * test_teach_auto_field_rows.js — the teach wizard's field rail must SHOW a type's List / Barcode
 * fields (muted, with the reason) instead of dropping them with a transient toast.
 *
 * THE GAP THIS PINS (owner, 2026-08-27): "I just created a field for lists in Settings → Document
 * Types. When I go to Teach and select Service Worksheet, I don't see the new field." The field WAS
 * on the type (`serial_number`, type list, enabled) — `_splitListFields` pulls list/barcode fields
 * from the draw flow BY DESIGN (a stored box would never be consulted; Oracle C1 2026-08-11), but the
 * only trace was a 4-second toast, so the rail's list disagreed with Settings. The rail now appends a
 * `.fieldrow.auto` row per pulled field: label + why, unclickable.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/teach/test_teach_auto_field_rows.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const js = rd('src/windows/teach/renderer.js');
const html = rd('src/windows/teach/index.html');

console.log('the split still pulls list + barcode fields from the DRAW flow (unchanged contract)');
check('_splitListFields tags list and barcode fields as auto and removes them from the teach list',
      /function _splitListFields\(fields\)\{[\s\S]{0,700}f\.auto = 'list'[\s\S]{0,200}f\.auto = 'barcode'[\s\S]{0,200}teach: fields\.filter\(f => !lists\.includes\(f\)\), lists/.test(js));

console.log('the rail SHOWS the pulled fields with the reason');
{
  const s = js.indexOf('function renderFieldRail(){');
  const e = js.indexOf('renderFooter();', s);
  const body = (s > -1 && e > -1) ? js.slice(s, e) : '';
  check('renderFieldRail appends one .fieldrow.auto row per state.listFields entry, after the teachable rows',
        /state\.fields\.forEach\(\(f,i\)=>\{[\s\S]+?\}\);\s*[\s\S]{0,700}for \(const f of \(state\.listFields \|\| \[\]\)\) \{[\s\S]{0,120}row\.className='fieldrow auto';/.test(body));
  check('the row says WHY per kind (list: collected by label · barcode: read from the decode) and names the field',
        /collected automatically wherever its label appears — nothing to draw/.test(body)
        && /read from the barcode printed on the page — nothing to draw/.test(body)
        && /\$\{esc\(f\.label\)\}/.test(body.slice(body.indexOf('for (const f of (state.listFields')))
        && /class="dot auto"/.test(body));
  check('the auto row is NOT clickable (no onclick — nothing to capture)',
        !/for \(const f of \(state\.listFields[\s\S]{0,900}row\.onclick/.test(body));
  check('the tooltip points a List field at Settings → Learning for its label',
        /Settings → Learning if the paperwork prints a different caption/.test(body));
}
check('index.html styles the auto row (muted dashed dot, default cursor)',
      /\.fieldrow\.auto\{cursor:default\}/.test(html) && /\.dot\.auto\{background:transparent;border:2px dashed var\(--muted\)/.test(html) && /\.auto-why\{/.test(html));

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
