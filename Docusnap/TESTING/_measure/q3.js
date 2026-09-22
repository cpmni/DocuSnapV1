const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const k of ['auto_file_threshold','critical_field_conf_floor','deskew_on_import'])
  console.log(k, '=', JSON.stringify(db.prepare("SELECT value FROM settings WHERE key=?").get(k)));
