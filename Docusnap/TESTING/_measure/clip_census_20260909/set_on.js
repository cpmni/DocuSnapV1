const Database = require('better-sqlite3');
const db = new Database(process.argv[2]);
db.prepare("INSERT INTO settings (key,value) VALUES ('template_code_read_widen','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
console.log('census_on template_code_read_widen =', JSON.stringify(db.prepare("SELECT value FROM settings WHERE key='template_code_read_widen'").get()));
db.close();
