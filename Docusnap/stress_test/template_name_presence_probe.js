'use strict';
// G1 live probe for the per-supplier NAME-PRESENCE veto (namePresence.js) — the real go/no-go, since
// stress_test/realdoc_regression.js is structurally BLIND to this JS layer. Replays
// templates.identifyByFingerprint OFF vs ON (name veto), with the DETAIL veto held ON in BOTH arms
// (so the delta is the name veto alone), over the live DB (READ-ONLY). Reports:
//   (a) the Saltmarsh->Larkspur incident OFF/ON  (proves non-vacuous: OFF reproduces the bug),
//   (b) a corpus-wide sweep of confirmed docs — any doc that matched its OWN-supplier template OFF
//       and loses it ON is a false-veto (must be 0, or only accepted name-less/garble cases),
//   (c) G3: the Saltmarsh doc's wizard save-target (same identify) no longer resolves Larkspur.
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates'));
const LIVE = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const db = new Database(LIVE, { readonly: true, fileMustExist: true });

const slugById = {};
for (const t of db.prepare('SELECT id, slug FROM document_types').all()) slugById[t.id] = t.slug;

function identify(d, nameVetoOn) {
  const prev = process.env.TEMPLATE_NAME_PRESENCE_VETO;
  process.env.TEMPLATE_NAME_PRESENCE_VETO = nameVetoOn ? '1' : '0';   // detail veto stays default ON
  try {
    return templates.identifyByFingerprint(db, {
      logo_phash: d.logo_phash, ocr_text: d.ocr_text,
      document_type_slug: slugById[d.document_type_id] || null,
      logo_detail_hash: d.logo_detail_hash,
    });
  } finally {
    if (prev === undefined) delete process.env.TEMPLATE_NAME_PRESENCE_VETO;
    else process.env.TEMPLATE_NAME_PRESENCE_VETO = prev;
  }
}
const nm = m => (m && m.template) ? `${m.template.name} (${m.method}, id=${m.template.id})` : 'no match';

// (a) + (c) the incident
const salt = db.prepare("SELECT id, supplier_name, logo_phash, logo_detail_hash, ocr_text, document_type_id FROM documents WHERE original_filename LIKE 'SaltmarshSeafoods_sales_order_11%' ORDER BY id DESC LIMIT 1").get();
console.log('=== (a) INCIDENT: SaltmarshSeafoods_sales_order_11 ===');
if (!salt) { console.log('  (doc not found)'); } else {
  console.log(`  supplier="${salt.supplier_name}"  detail_hash=${salt.logo_detail_hash ? 'present' : 'null'}`);
  console.log(`  OFF (name veto off) -> ${nm(identify(salt, false))}`);
  const on = identify(salt, true);
  console.log(`  ON  (name veto on)  -> ${nm(on)}`);
  console.log(`  (c) G3 wizard save-target ON = ${on && on.template ? on.template.name : 'none'}  (must NOT be Larkspur)`);
}

// (b) corpus sweep
const docs = db.prepare("SELECT id, supplier_name, logo_phash, logo_detail_hash, ocr_text, document_type_id FROM documents WHERE status='confirmed' AND logo_phash IS NOT NULL AND ocr_text IS NOT NULL").all();
const ownLost = []; let foreignRefused = 0, unchanged = 0;
for (const d of docs) {
  const mOff = identify(d, false), mOn = identify(d, true);
  const offId = mOff && mOff.template ? mOff.template.id : null;
  const onId = mOn && mOn.template ? mOn.template.id : null;
  if (offId === onId) { unchanged++; continue; }
  const offIdentity = offId ? templates.establishedIdentity(db, offId) : null;
  const own = offIdentity && d.supplier_name && offIdentity.toLowerCase() === d.supplier_name.toLowerCase();
  if (own) ownLost.push({ doc: d.id, supplier: d.supplier_name, lostIdentity: offIdentity, onNow: onId ? nm(mOn) : 'no match' });
  else foreignRefused++;
}
console.log(`\n=== (b) SWEEP: ${docs.length} confirmed docs with logo_phash ===`);
console.log(`  unchanged (veto had no effect): ${unchanged}`);
console.log(`  FOREIGN matches refused by the veto (GOOD — the Larkspur-on-Saltmarsh class): ${foreignRefused}`);
console.log(`  OWN-supplier matches LOST (MUST be 0, or only accepted name-less/garble): ${ownLost.length}`);
for (const l of ownLost) console.log(`     doc #${l.doc} supplier="${l.supplier}" lost "${l.lostIdentity}" -> now ${l.onNow}`);
db.close();
