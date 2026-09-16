const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const { runMigrations } = require('C:/GIT Projects/Docusnap/database/index');
const db = new Database(process.argv[2]);
const before = db.prepare('SELECT MAX(version) v FROM migrations').get().v;
runMigrations(db);
const after = db.prepare('SELECT MAX(version) v FROM migrations').get().v;
console.log(`migrated ${before} -> ${after}; has intake:`, !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='intake'").get());
db.close();
