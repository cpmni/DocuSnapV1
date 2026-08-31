// r19 N2 census: on the r19 sandbox DB, the badge vs the gate for every held doc of the taught senders, OFF vs ON.
const Database = require('C:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust');
const sr = require('C:/GIT Projects/Docusnap/database/modules/scopeReadiness');
const db = new Database(process.argv[2], { readonly: true });
const rows = db.prepare("SELECT d.* , dt.slug FROM documents d JOIN document_types dt ON dt.id=d.document_type_id WHERE d.status='needs_review' AND d.supplier_name IN ('Ironbridge Fabrication','Larkspur Interiors','Copperfield Electrical','Nordwind Refrigeration Ltd','DOCUMENT SOLUTIONS')").all();
const by = {};
for (const r of rows) {
  process.env.TRUST_COMPANY_KEY_OWN_SCOPE = '0'; const off = trust.isAutoFileEligible(db, r);
  process.env.TRUST_COMPANY_KEY_OWN_SCOPE = '1'; const on = trust.isAutoFileEligible(db, r);
  const k = r.supplier_name; by[k] = by[k] || { n: 0, offElig: 0, onElig: 0, ready: sr.isReady(db, r.supplier_name, r.slug).ready, flips: [] };
  by[k].n++; if (off.eligible) by[k].offElig++; if (on.eligible) by[k].onElig++;
  if (off.eligible !== on.eligible) by[k].flips.push(`${r.id}:${off.reason}->${on.reason}`);
}
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(28), `held=${v.n} badgeReady=${v.ready} eligibleOFF=${v.offElig} eligibleON=${v.onElig}`, v.flips.length ? 'flips: ' + v.flips.join(' ') : '');
