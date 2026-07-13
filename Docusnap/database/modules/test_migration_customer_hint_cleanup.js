'use strict';
// Migration 45 — clean STALE customer_name learning (RC2). The recipient field must stop mirroring
// the issuer on reprocess WITHOUT deleting legit recipient learning. Pins the accepted dual-role
// trade-off so a future dev can't add a carve-out that re-admits the issuer bleed.
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_migration_customer_hint_cleanup.js
const Database = require('better-sqlite3');
const doctypes = require('./document_types');

let f = 0;
const check = (n, c) => { console.log((c ? 'OK  ' : 'BAD ') + n); if (!c) f++; };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE supplier_hints (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT,
     field_key TEXT, hint_value TEXT, usage_count INTEGER);
  CREATE TABLE field_anchors (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type TEXT,
     field_key TEXT, anchor_label TEXT, direction TEXT);
  CREATE TABLE logo_fingerprints (id INTEGER PRIMARY KEY, supplier_name TEXT, phash TEXT);
`);
const H = db.prepare(`INSERT INTO supplier_hints (supplier_name,document_type,field_key,hint_value,usage_count) VALUES (?,?,?,?,?)`);
const A = db.prepare(`INSERT INTO field_anchors (supplier_name,document_type,field_key,anchor_label,direction) VALUES (?,?,?,?,?)`);

// Known issuers (have a logo): Ashford, Blackstone. Greenfield/Dunroamin are recipients (no logo/scope).
db.prepare(`INSERT INTO logo_fingerprints (supplier_name,phash) VALUES ('Ashford Wholesale','x'),('Blackstone Logistics','y'),('Bramble & Finch Ltd','z')`).run();

// customer_name hints
H.run('Bramble & Finch Ltd', 'sales_order', 'customer_name', 'Bramble & Finch Ltd', 3); // STALE (self-equal) -> A
H.run('Blackstone Logistics','sales_order', 'customer_name', 'Blackstone Logistics', 3); // STALE (self-equal) -> A
H.run('__global__',          'sales_order', 'customer_name', 'Blackstone Logistics', 4); // STALE (global issuer) -> B
H.run('__global__',          'sales_order', 'customer_name', 'Greenfield Nurseries', 1); // LEGIT recipient -> KEEP
H.run('Acme Traders',        'invoice',     'customer_name', 'Dunroamin Caravan Park', 2); // LEGIT recipient (scope=supplier, value=buyer) -> KEEP
H.run('Acme Traders',        'invoice',     'customer_name', 'Blackstone Logistics', 2); // DUAL-ROLE: value is a known issuer -> DELETED (accepted trade-off)
// a supplier_name hint (must be UNTOUCHED — blast radius)
H.run('Bramble & Finch Ltd', 'sales_order', 'supplier_name', 'Bramble & Finch Ltd', 5);

// anchors
A.run('Ashford Wholesale', 'sales_order', 'customer_name', 'Document Issuer', 'below'); // STALE -> C
A.run('Acme Traders',      'invoice',     'customer_name', 'Bill To',         'below'); // LEGIT recipient anchor -> KEEP
A.run('Ashford Wholesale', 'sales_order', 'supplier_name', 'Document Issuer', 'below'); // issuer anchor -> KEEP (different field)

const r1 = doctypes.cleanupStaleCustomerLearning(db);
const r2 = doctypes.cleanupStaleCustomerLearning(db);   // idempotency

const hv = (scope, val) => db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE field_key='customer_name' AND supplier_name=? AND hint_value=?`).get(scope, val).n;
const anc = (sup, lbl) => db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE field_key='customer_name' AND supplier_name=? AND anchor_label=?`).get(sup, lbl).n;

// 1 — self-equal issuer hints gone (A)
check('self-equal Bramble hint DELETED', hv('Bramble & Finch Ltd','Bramble & Finch Ltd') === 0);
check('self-equal Blackstone hint DELETED', hv('Blackstone Logistics','Blackstone Logistics') === 0);
// 2 — global issuer hint gone, global recipient kept (B distinguishes)
check('__global__ issuer "Blackstone Logistics" DELETED', hv('__global__','Blackstone Logistics') === 0);
check('__global__ recipient "Greenfield Nurseries" KEPT', hv('__global__','Greenfield Nurseries') === 1);
// 3 — legit recipient (scope=supplier, value=buyer) kept
check('legit recipient "Dunroamin Caravan Park" KEPT', hv('Acme Traders','Dunroamin Caravan Park') === 1);
// 4 — blast radius: supplier_name hint untouched
check('supplier_name hint UNTOUCHED', db.prepare(`SELECT COUNT(*) n FROM supplier_hints WHERE field_key='supplier_name'`).get().n === 1);
// 5 — anchors
check('customer_name "Document Issuer" anchor DELETED', anc('Ashford Wholesale','Document Issuer') === 0);
check('customer_name "Bill To" recipient anchor KEPT', anc('Acme Traders','Bill To') === 1);
check('supplier_name "Document Issuer" anchor KEPT', db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE field_key='supplier_name' AND anchor_label='Document Issuer'`).get().n === 1);
// 6 — PIN the accepted dual-role trade-off (value is a known issuer → deleted even as a "recipient")
check('dual-role recipient whose value IS a known issuer DELETED (accepted trade-off)', hv('Acme Traders','Blackstone Logistics') === 0);
// 7 — idempotency
check('idempotent: second run deletes nothing', r2.hintsSelfEqual === 0 && r2.hintsKnownIssuer === 0 && r2.anchors === 0);
check('first run reported deletions', (r1.hintsSelfEqual + r1.hintsKnownIssuer) >= 3 && r1.anchors === 1);

console.log('\n' + (f ? `${f} FAILED` : 'All migration-45 (stale customer learning) checks passed'));
process.exit(f ? 1 : 0);
