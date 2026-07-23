'use strict';
/*
 * test_doctype_reorder.js — pins planReorder, the sort_order commit logic behind field
 * drag-to-reorder in the shared DocTypeEditor. Run: node src/windows/shared/test_doctype_reorder.js
 *
 * WHAT THIS GUARDS. Reordering fields writes fresh sort_order values (gap of 10 — sort_order is an
 * INTEGER column, so whole-number slots, never fractional midpoints) and must persist ONLY the rows
 * whose value actually changed (edit mode does one updateField per changed row). planReorder both
 * mutates each field's sort_order (so local state matches the new order before re-render) AND returns
 * the minimal write set. The two load-bearing properties: (1) gap-of-10 whole numbers; (2) no write
 * for an unchanged row.
 */
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(path.join(__dirname, 'doctype-editor.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// Extract the PURE planReorder (no DOM refs) and eval it in isolation.
const start = src.indexOf('function planReorder');
const end   = src.indexOf('/* __PIN_END:planReorder__ */');
check('planReorder present with its pin-end marker', start > -1 && end > start);
const planReorder = eval('(' + src.slice(start, end) + ')');

const mk = (id, so) => ({ id, sort_order: so });
const prevOf = (fields) => new Map(fields.map(f => [f.id, f.sort_order]));

console.log('\nplanReorder — behaviour:');

// 1. No change: same order, already 10/20/30 → no writes, values preserved.
{
  const f = [mk(1,10), mk(2,20), mk(3,30)];
  const writes = planReorder(f, prevOf([mk(1,10),mk(2,20),mk(3,30)]));
  check('(1) unchanged order → no writes', writes.length === 0);
  check('(1) values stay 10/20/30', f[0].sort_order===10 && f[1].sort_order===20 && f[2].sort_order===30);
}

// 2. Swap the first two → only those two change (the third keeps 30).
{
  const prev = prevOf([mk(1,10),mk(2,20),mk(3,30)]);
  const reordered = [mk(2,20), mk(1,10), mk(3,30)];   // f2, f1, f3
  const writes = planReorder(reordered, prev);
  check('(2) swap first two → new slots 10/20/30 by position',
        reordered[0].sort_order===10 && reordered[1].sort_order===20 && reordered[2].sort_order===30);
  check('(2) exactly the two moved rows are written', writes.length === 2);
  const byId = Object.fromEntries(writes.map(w => [w.id, w.sort_order]));
  check('(2) f2 → 10 and f1 → 20', byId[2] === 10 && byId[1] === 20);
  check('(2) the unmoved f3 (30→30) is NOT written', !writes.some(w => w.id === 3));
}

// 3. Move last to first → all three shift.
{
  const prev = prevOf([mk(1,10),mk(2,20),mk(3,30)]);
  const reordered = [mk(3,30), mk(1,10), mk(2,20)];
  const writes = planReorder(reordered, prev);
  check('(3) rotate last-to-first → all three change', writes.length === 3);
  const byId = Object.fromEntries(writes.map(w => [w.id, w.sort_order]));
  check('(3) f3→10, f1→20, f2→30', byId[3]===10 && byId[1]===20 && byId[2]===30);
}

// 4. Whole-number gap-of-10 slots only (never fractional midpoints).
{
  const reordered = [mk(1,100), mk(2,100), mk(3,100), mk(4,100), mk(5,100)];
  planReorder(reordered, prevOf(reordered.map(f => mk(f.id, f.sort_order))));
  check('(4) slots are exactly (i+1)*10, all integers',
        reordered.every((f, i) => f.sort_order === (i+1)*10 && Number.isInteger(f.sort_order)));
}

// 5. Non-standard priors (all default 100) → every row is renumbered + written.
{
  const prev = prevOf([mk(1,100),mk(2,100),mk(3,100)]);
  const reordered = [mk(1,100), mk(2,100), mk(3,100)];
  const writes = planReorder(reordered, prev);
  check('(5) all-100 priors → renumbered to 10/20/30 and all written', writes.length === 3
        && reordered[0].sort_order===10 && reordered[2].sort_order===30);
}

console.log('\nWiring (source):');
check('the row carries a drag handle + is draggable', /class="dte-handle"/.test(src) && /draggable="true"/.test(src));
check('drag only starts from the handle (dragstart gated on pressedHandle)',
      /pressedHandle/.test(src) && /if \(!row \|\| !pressedHandle\) \{ e\.preventDefault\(\); return; \}/.test(src));
check('edit-mode applyOrder re-renders BEFORE persisting (no stale-index await window)',
      /render\(\);\s*\/\/ re-sync indices before any await/.test(src));
check('applyOrder persists via updateField sort_order', /api\.updateField\(w\.id, \{ sort_order: w\.sort_order \}\)/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nAll reorder checks passed');
process.exit(fails ? 1 : 0);
