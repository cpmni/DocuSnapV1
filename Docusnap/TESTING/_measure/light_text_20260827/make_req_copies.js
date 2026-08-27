// Two FROZEN copies of the live DB for the required-roles A/B (online backup = WAL-consistent):
//   rr_req_off.db = untouched;  rr_req_on.db = document_types.assertStructuralRequired applied (the mig-92 heal).
// Also prints the confirmed service_worksheet ids for a targeted RR_IDS run. Never touches the live DB.
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const doctypes = require(path.join(REPO, 'database', 'modules', 'document_types'));
const live = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const dir = process.argv[2];
if (!dir) { console.error('usage: make_req_copies.js <outdir>'); process.exit(2); }
(async () => {
  const src = new Database(live, { readonly: true });
  const off = path.join(dir, 'rr_req_off.db'), on = path.join(dir, 'rr_req_on.db');
  await src.backup(off);
  await src.backup(on);
  const ids = src.prepare(`SELECT d.id FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
                           WHERE d.status = 'confirmed' AND dt.slug = 'service_worksheet' ORDER BY d.id`).all().map(r => r.id);
  src.close();
  const d = new Database(on);
  const n = doctypes.assertStructuralRequired(d);
  const rows = d.prepare(`SELECT dt.slug, f.key, f.required FROM fields f JOIN document_types dt ON dt.id = f.document_type_id
                          WHERE dt.slug = 'service_worksheet' ORDER BY f.sort_order`).all();
  d.close();
  console.log('healed on the ON copy:', n, JSON.stringify(rows));
  console.log('OFF', off);
  console.log('ON ', on);
  console.log('WS_IDS', ids.length, ids.join(','));
})().catch(e => { console.error(e); process.exit(1); });
