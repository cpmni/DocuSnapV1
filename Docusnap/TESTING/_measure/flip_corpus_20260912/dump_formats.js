'use strict';
// Dump learning.getFieldFormats from the injected warm DB (paths hardcoded — electron-as-node
// argv breaks on spaces). ELECTRON_RUN_AS_NODE=1 electron.exe dump_formats.js
const path = require('path');
const fs = require('fs');
const REPO = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const DB = 'C:/Users/cmccu/Desktop/Flip Corpus Inject/warm_inject.db';
const OUT = 'C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/46f261df-90c6-45b9-87c4-6c9b00a6bdef/scratchpad/formats.json';
const db = new Database(DB, { readonly: true, fileMustExist: true });
const fmts = learning.getFieldFormats(db);
db.close();
fs.writeFileSync(OUT, JSON.stringify(fmts, null, 1));
console.log('wrote', fmts.length, 'format scopes ->', OUT);
for (const g of fmts) {
  if ((g.field_key || '').includes('sales_order') || (g.document_type || '') === 'sales_order')
    console.log('  scope', JSON.stringify({ sup: g.supplier_name, dt: g.document_type, fk: g.field_key, n: (g.sample_values || []).length, prov: g.provisional }));
}
