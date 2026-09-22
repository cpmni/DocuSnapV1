const db = require('better-sqlite3')(process.argv[2]);
const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
for (const k of ['ref_prefix_confusable_adopt','raw_witness_vacuous_suppress','filing_sanity_page_match_v2','vat_reg_symbol_confusable','money_sign_capture']) up.run(k);
for (const k of ['ref_prefix_confusable_adopt','raw_witness_vacuous_suppress','filing_sanity_page_match_v2','vat_reg_symbol_confusable','money_sign_capture','auto_file_threshold'])
  console.log(k, '=', (db.prepare('SELECT value FROM settings WHERE key=?').get(k)||{}).value);
