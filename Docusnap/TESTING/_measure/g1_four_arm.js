// Oracle G1 — four-arm measurement on a COPY: base / mint-only / defan-only / both.
// Reports held→eligible flips, newly GRADUATED scopes (with the required field's class and
// distinct-value count), newly DE-graduated scopes, and M (wrong folder/type) on the flip set.
const fs = require('fs');
const Database = require('better-sqlite3');
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const SRC = process.argv[2];
const GT = { 'castellan-security':'castellan','harrowgate-timber':'harrowgate','ironclad-tool-hire':'ironclad',
  'meadowvale-dairy':'meadowvale','nordwind-refrigeration':'nordwind','oakhaven-electrical':'oakhaven',
  'pelican-office':'pelican','quillstone-print':'quillstone','silverbeck-cleaning':'silverbeck','veltrix-automotive':'veltrix' };
const TYPES = ['service_worksheet','sales_order','purchase_order','credit_note','delivery_note','invoice','quote','statement'];
const gtOf = fn => { const b=String(fn||'').toLowerCase().replace(/\.pdf$/,''); const k=Object.keys(GT).find(x=>b.startsWith(x));
  return { sup: k?GT[k]:null, type: TYPES.find(t=>b.includes('_'+t))||null }; };

function arm(label, { mint, defan }) {
  const p = `TESTING/_measure/_g1_${label}.db`;
  fs.copyFileSync(SRC, p);
  const db = new Database(p);
  if (mint) {
    // Sandbox-only backfill standing in for "what the fix will do from now on": mint the approved
    // values of already-confirmed docs. NOT shipped behaviour (the fix is go-forward-only) — this
    // is how we measure where it lands.
    let n = 0;
    for (const d of db.prepare("SELECT id, supplier_name, document_type_id FROM documents WHERE status='confirmed'").all()) {
      const have = new Set(db.prepare('SELECT field_key FROM extractions WHERE document_id=?').all(d.id).map(r=>r.field_key));
      const av = {};
      if (d.supplier_name && !have.has('supplier_name')) av.supplier_name = d.supplier_name;
      n += learning.persistConfirmedValues(db, d.id, av);
    }
    process.stdout.write(`   [${label}] backfilled ${n} rows\n`);
  }
  if (defan) process.env.FORMAT_CORRECTIONS_DEDUPE = '1'; else process.env.FORMAT_CORRECTIONS_DEDUPE = '0';
  const held = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
  const elig = held.filter(d => { try { return trust.isAutoFileEligible(db, d).eligible; } catch { return false; } });
  const scopes = db.prepare(`SELECT DISTINCT d.supplier_name sup, dt.slug FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
      WHERE TRIM(COALESCE(d.supplier_name,''))<>''`).all();
  const grad = scopes.filter(s => { try { return !!(trust.scopeTrust(db, s.sup, s.slug)||{}).trusted; } catch { return false; } })
                     .map(s => `${s.sup}|${s.slug}`);
  const wrong = elig.filter(d => { const g = gtOf(d.original_filename);
    const f = String(d.supplier_name||'').toLowerCase().replace(/[^a-z]/g,'');
    return (g.sup && !f.includes(g.sup)); });
  db.close(); fs.unlinkSync(p);
  return { eligible: elig.length, held: held.length, grad: new Set(grad), wrongFolder: wrong.length,
           wrongList: wrong.map(d=>d.original_filename) };
}
const base  = arm('base',  { mint: false, defan: false });
const mintO = arm('mint',  { mint: true,  defan: false });
const defO  = arm('defan', { mint: false, defan: true  });
const both  = arm('both',  { mint: true,  defan: true  });
delete process.env.FORMAT_CORRECTIONS_DEDUPE;
const diff = (a, b) => [...b].filter(x => !a.has(x));
for (const [name, r] of [['base',base],['mint-only',mintO],['defan-only',defO],['BOTH',both]]) {
  console.log(`\n${name.padEnd(11)} held=${r.held} eligible=${r.eligible} graduatedScopes=${r.grad.size} wrongFolderAmongEligible=${r.wrongFolder}`);
  if (name !== 'base') {
    const newly = diff(base.grad, r.grad), lost = diff(r.grad, base.grad);
    console.log(`            newly graduated: ${newly.length ? newly.join(', ') : '(none)'}`);
    console.log(`            DE-graduated   : ${lost.length ? lost.join(', ') : '(none)'}`);
  }
  if (r.wrongList.length) console.log('            M>0:', r.wrongList.join(', '));
}
