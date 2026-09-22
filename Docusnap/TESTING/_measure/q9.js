const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const k of ['filing_sanity_page_match_v2','vat_reg_symbol_confusable','money_sign_capture','ref_prefix_confusable_adopt','raw_witness_vacuous_suppress'])
  console.log(k, '=', (db.prepare('SELECT value FROM settings WHERE key=?').get(k)||{}).value);
const t = String(db.prepare('SELECT ocr_text FROM documents WHERE id=339').get().ocr_text||'');
console.log('=== doc 339 FULL:');
t.split('\n').forEach((ln,i)=>{ if (/99|9910|26/.test(ln)) console.log(`L${i}: ${JSON.stringify(ln)}`); });
console.log('=== audit reprocess rows for 205/339/382:');
for (const r of db.prepare("SELECT created_at, action, document_id FROM audit_log WHERE document_id IN (205,339,382) ORDER BY id DESC LIMIT 12").all())
  console.log(r.created_at, r.action, r.document_id);
