// Apply the current migrations (mig 137 + a RELEASE identity → no arming) to arm137.db; leave arm136.db untouched.
const path = require('path');
const Database = require('c:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const { runMigrations } = require('c:/GIT Projects/Docusnap/database/index');
const { TEST_SWITCH_KEYS } = require('c:/GIT Projects/Docusnap/database/test_switch_keys');
const dir = path.dirname(__filename);
const count = (db) => TEST_SWITCH_KEYS.filter(k => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value === 'true').length;
const a = new Database(path.join(dir, 'arm136.db')); const b = new Database(path.join(dir, 'arm137.db'));
console.log('before: arm136 ON =', count(a), '| arm137 ON =', count(b), '| max mig', b.prepare('SELECT max(version) v FROM migrations').get().v);
const o = console.log; console.log = () => {}; runMigrations(b, { identity: { testBuild: false, buildRev: 'release-arm-20260908' } }); console.log = o;
console.log('after : arm136 ON =', count(a), '| arm137 ON =', count(b), '| max mig', b.prepare('SELECT max(version) v FROM migrations').get().v, '| ocr_dpi row:', (b.prepare("SELECT value FROM settings WHERE key='ocr_dpi'").get() || {}).value);
a.close(); b.close();
