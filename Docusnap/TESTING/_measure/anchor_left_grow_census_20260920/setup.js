'use strict';
// Migrate the warm-corpus copy to HEAD so mig-186/191 (and the other current ref defaults) are ON in BOTH
// arms and mig-192 anchor_code_left_grow is seeded OFF (the OFF arm's clean state). Read-only to the docs.
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const db = new Database(path.join(__dirname, 'warm.db'));
const orig = console.log; console.log = () => {};
runMigrations(db);
console.log = orig;
const v = db.prepare('SELECT MAX(version) m FROM migrations').get().m;
const g = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : '(unset)'; };
console.log('migrated to mig', v);
for (const k of ['anchor_code_left_grow', 'taught_ref_disagree_suppress', 'trust_ref_role_shape', 'template_drift_override_guard', 'template_code_left_grow']) {
  console.log('  ', k, '=', g(k));
}
const nDocs = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed'").get().c;
console.log('confirmed docs:', nDocs);
db.close();
