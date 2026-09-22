'use strict';
// Read-only smoke of learningScopeService.listScopes against the live DB (never written).
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true, fileMustExist: true });
const svc = require(path.join(REPO, 'src', 'services', 'learningScopeService.js'));
const t0 = Date.now();
const rows = svc.listScopes(db);
console.log(`scopes: ${rows.length}  (${Date.now() - t0} ms)`);
const orphaned = rows.filter(r => r.orphaned).length, blank = rows.filter(r => r.blankIssuer).length;
console.log(`orphaned (learning, no docs): ${orphaned}   blank-issuer: ${blank}   auto-files: ${rows.filter(r => r.trust.autoFiles).length}`);
for (const r of rows.slice(0, 12)) {
  console.log(`${(r.supplier_name || '(blank)').padEnd(34).slice(0, 34)} ${String(r.document_type_slug).padEnd(16)} docs=${String(r.docs).padStart(3)} tpl=${r.templates} hints=${r.hints} anchors=${r.anchors} corr=${r.corrections} rules=${r.rules} lbl=${r.labelOverrides} logos=${r.logos} ids=${r.identifiers}  auto: ${r.trust.text}`);
}
db.close();
