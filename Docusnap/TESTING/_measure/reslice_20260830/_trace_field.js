'use strict';
/* _trace_field.js <run.jsonl> <docSubstring> <field> — print every trace event + log line touching one field of one doc. */
const fs = require('fs');
const [file, docSub, field] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split('\n');
let cur = null;
for (const ln of lines) {
  const t = ln.trim(); if (t[0] !== '{') continue;
  let m; try { m = JSON.parse(t); } catch { continue; }
  if (m.type === 'file_begin') cur = m.filename;
  if (m.type === 'trace') {
    if (String(m.doc || cur || '').includes(docSub) && (!field || m.field === field || JSON.stringify(m).includes(field))) {
      const { type, doc, seq, ts, ...rest } = m;
      console.log(`[${seq}] ${JSON.stringify(rest)}`);
    }
  } else if (m.type === 'log' && cur && String(cur).includes(docSub) && (!field || String(m.text).includes(field) || /Stage 0\.5|Reconcile|Corrob|total|Straighten/i.test(m.text))) {
    console.log(`LOG ${m.text}`);
  } else if (m.type === 'file_done' && String(m.original_filename).includes(docSub)) {
    const ex = (m.extractions || {})[field];
    console.log(`DONE overall=${m.overall_confidence} needs_review=${m.needs_review} supplier=${m.supplier_name} type=${m.document_type}`);
    if (ex) console.log(`FIELD ${field}: ${JSON.stringify(ex)}`);
  }
}
