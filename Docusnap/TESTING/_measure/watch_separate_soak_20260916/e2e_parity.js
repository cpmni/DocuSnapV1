// e2e_parity.js DB — Oracle C6: for every source file imported WHOLE (no _split_) in BOTH the two-switch e2e (ids 1034-1167)
// and the three-switch e2e (ids > 1167), compare the filing outcome (status + page_count). Prints every difference.
const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
const norm = (n) => String(n).replace(/\.pdf$/i, '').replace(/-\d+$/, '');
const rows = db.prepare('SELECT id, original_filename, status, page_count FROM documents WHERE id >= 1034 ORDER BY id').all()
  .filter(r => !/_split_/.test(String(r.original_filename)));
const a = new Map(), b = new Map();
for (const r of rows) (r.id <= 1167 ? a : b).set(norm(r.original_filename), r);
let same = 0, diff = 0;
for (const [k, r] of a) {
  const s = b.get(k); if (!s) continue;
  if (s.status === r.status && s.page_count === r.page_count) same++;
  else { diff++; console.log(`DIFF ${k}: two-switch #${r.id} ${r.status} p${r.page_count} -> three-switch #${s.id} ${s.status} p${s.page_count}`); }
}
console.log(`whole-file imports in both runs: ${same + diff}; identical ${same}, different ${diff}; three-switch whole files ${b.size}`);
