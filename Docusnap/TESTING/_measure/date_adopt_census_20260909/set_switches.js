// set_switches.js <db> <adopt: true|false>
// Both arms carry the dependency chain ON (pad_window_read + containment); only template_pad_date_adopt differs.
const Database = require('better-sqlite3');
const db = new Database(process.argv[2]);
const adopt = process.argv[3];
const set = (k, v) => db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);
set('template_pad_window_read', 'true');
set('template_pad_date_containment_flag', 'true');
set('template_pad_date_adopt', adopt);
const g = k => (db.prepare("SELECT value FROM settings WHERE key=?").get(k) || {}).value;
console.log('SET', process.argv[2], '| pad_window=', g('template_pad_window_read'),
  'containment=', g('template_pad_date_containment_flag'), 'adopt=', g('template_pad_date_adopt'));
db.close();
