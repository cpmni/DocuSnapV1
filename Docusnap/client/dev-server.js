'use strict';

/**
 * client/dev-server.js  (DEV DEMO ONLY)
 * -------------------------------------
 * Stands up the /v1 API on 127.0.0.1:8765 against a throwaway in-memory DB seeded
 * with demo users, documents and mailbox routes, so the detached client can be run
 * and seen WITHOUT the core app or the real database. Not part of any build.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe client/dev-server.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const api = require('../src/modules/api/handler');
const pw  = require('../src/modules/auth/password');

const PORT = 8765;
const DEMO = { admin: 'demo12345', alice: 'alice12345' };
// Demo toggle: the detached-client add-on is "licensed" while this file exists, so
// the entitlement gate can be flipped live (create/delete it) without a restart.
const LICENSE_FLAG = path.join(os.tmpdir(), 'scanfinder_demo_licensed');

// A tiny but valid PNG so the preview pane shows an actual image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHklEQVR42u3OMQEAAAgDoJfc6Bb0' +
  'oQEOyE1V1dXV1dX1Bk2QAAFL2bA9AAAAAElFTkSuQmCC', 'base64');

async function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, supplier_name TEXT, reference_number TEXT, doc_date TEXT,
      document_type_id INTEGER, status TEXT, ocr_text TEXT, overall_confidence INTEGER,
      original_filename TEXT, stored_filename TEXT, stored_path TEXT, folder_path TEXT,
      working_path TEXT, workflow_status TEXT, confirmed_at TEXT, processed_at TEXT
    );
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT,
      display_value TEXT, confidence INTEGER, was_corrected INTEGER, corrected_to TEXT, validation_note TEXT, extraction_method TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, from_user_id INTEGER,
      from_username TEXT, to_user_id INTEGER, to_username TEXT, action_required TEXT, state TEXT DEFAULT 'pending',
      comment TEXT, resolution_comment TEXT, claimed_by_id INTEGER, claimed_by_username TEXT, claimed_at TEXT,
      resolved_at TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice'),(2,'Purchase Order','purchase_order')`).run();

  const png = path.join(os.tmpdir(), 'scanfinder_demo_page.png');
  fs.writeFileSync(png, PNG);

  const ins = db.prepare(`INSERT INTO documents
    (id,supplier_name,reference_number,doc_date,document_type_id,status,overall_confidence,
     original_filename,stored_filename,working_path,confirmed_at,processed_at)
    VALUES (@id,@s,@r,@d,@dt,@st,@c,@of,@sf,@wp,@ca,@pa)`);
  const docs = [
    { id:1, s:'Acme Supplies Ltd', r:'INV-1042', d:'14-03-2026', dt:1, st:'confirmed', c:94, of:'acme_1042.pdf', sf:'Invoice.14-03-2026.INV-1042.pdf', wp:png, ca:'2026-03-14', pa:'2026-03-14' },
    { id:2, s:'Beaumont Care Homes', r:'INV-2207', d:'09-03-2026', dt:1, st:'confirmed', c:88, of:'beaumont_2207.pdf', sf:'Invoice.09-03-2026.INV-2207.pdf', wp:png, ca:'2026-03-09', pa:'2026-03-09' },
    { id:3, s:'Northwind Traders', r:'PO-5589', d:'02-03-2026', dt:2, st:'confirmed', c:91, of:'northwind_po.pdf', sf:'PurchaseOrder.02-03-2026.PO-5589.pdf', wp:png, ca:'2026-03-02', pa:'2026-03-02' },
    { id:4, s:'Riverside Logistics', r:'INV-7781', d:'18-03-2026', dt:1, st:'needs_review', c:52, of:'riverside_7781.pdf', sf:null, wp:png, ca:null, pa:'2026-03-18' },
  ];
  for (const d of docs) ins.run(d);

  const ex = db.prepare(`INSERT INTO extractions (document_id,field_key,display_value,confidence,extraction_method,validation_note)
                         VALUES (?,?,?,?,?,?)`);
  ex.run(1,'invoice_number','INV-1042',96,'keyword',null);
  ex.run(1,'invoice_date','14-03-2026',95,'anchor',null);
  ex.run(1,'total_amount','£1,250.00',92,'anchor',null);
  ex.run(2,'invoice_number','INV-2207',90,'keyword',null);
  ex.run(2,'total_amount','£430.00',61,'anchor','format anomaly: review');

  const u = db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (?,?,?,?,?,1)`);
  u.run(1,'demo','Demo Admin', await pw.hashPassword(DEMO.admin), 'admin');
  u.run(2,'alice','Alice (Edit)', await pw.hashPassword(DEMO.alice), 'edit');

  // A couple of mailbox routes so Inbox/Sent show content immediately.
  const r = db.prepare(`INSERT INTO document_routes (document_id,from_user_id,from_username,to_user_id,to_username,action_required,state,comment)
                        VALUES (?,?,?,?,?,?,?,?)`);
  r.run(2,2,'alice',1,'demo','approve','pending','Please approve this invoice');     // demo's inbox
  r.run(3,2,'alice',1,'demo','acknowledge','pending','FYI — new PO filed');          // demo's inbox
  r.run(1,1,'demo',2,'alice','approve','pending','Can you sign off?');               // demo's sent
  db.prepare(`UPDATE documents SET workflow_status='pending' WHERE id IN (1,2,3)`).run();

  return db;
}

seed().then((db) => {
  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] },
    checkEntitlement: () => ({
      entitled: fs.existsSync(LICENSE_FLAG), feature: 'detached_client',
      reason: fs.existsSync(LICENSE_FLAG) ? 'licensed' : 'not_licensed',
    }),
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  ScanFinder DEMO API → http://127.0.0.1:${PORT}/v1`);
    console.log(`  Sign in:  demo / ${DEMO.admin}   (admin)`);
    console.log(`            alice / ${DEMO.alice}  (edit)`);
    console.log(`  Add-on licensed: ${fs.existsSync(LICENSE_FLAG) ? 'YES' : 'NO'}  (toggle file: ${LICENSE_FLAG})`);
    console.log(`  Ctrl+C to stop.\n`);
  });
}).catch((e) => { console.error('demo seed failed:', e); process.exit(1); });
