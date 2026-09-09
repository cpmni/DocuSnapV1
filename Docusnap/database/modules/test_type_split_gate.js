'use strict';
/*
 * test_type_split_gate.js — A3 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND S2-js-a).
 *
 * The pure predicate `typeSplit.checkTypeSplit`: fires ONLY when the issuer's confirmed history is
 * ≥3 docs AND 100 % one type T AND the slug being confirmed ≠ T. Once a second type is confirmed
 * (acknowledged) the history is mixed and the ask never fires again for that issuer.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_type_split_gate.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const { checkTypeSplit } = require('./typeSplit');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (7, 'Quote', 'quote', 0)").run();
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (3, 'Purchase Order', 'purchase_order', 1)").run();
const mk = (supplier, typeId, status = 'confirmed') => documents.insert(db, {
  original_filename: 'x.pdf', folder_path: '/in', status, supplier_name: supplier, document_type_id: typeId });

console.log('the predicate:');
for (let i = 0; i < 24; i++) mk('Nordwind Refrigeration Ltd', 7);
const r = checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order');
check('24 quotes + a Purchase Order confirm → split, names the established type and count', r.split === true
      && r.established_slug === 'quote' && r.established_name === 'Quote' && r.count === 24 && r.typed_slug === 'purchase_order'
      && r.typed_name === 'Purchase Order', JSON.stringify(r));
check('…the message reads as a question a customer can answer', /Nordwind Refrigeration Ltd files as Quote \(24 so far\)\. File this one as Purchase Order\?/.test(r.message));
check('the same type → no ask', checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'quote').split === false);
check('issuer match is case/space-insensitive', checkTypeSplit(db, '  nordwind refrigeration ltd ', 'purchase_order').split === true);
for (let i = 0; i < 2; i++) mk('Harbour Glass Ltd', 7);
check('a thin history (2 confirms) → no ask (reason thin)', checkTypeSplit(db, 'Harbour Glass Ltd', 'purchase_order').reason === 'thin');
mk('Harbour Glass Ltd', 7);
check('…at 3 confirms it fires', checkTypeSplit(db, 'Harbour Glass Ltd', 'purchase_order').split === true);
mk('Nordwind Refrigeration Ltd', 3);   // ONE acknowledged (or slipped) second-type confirm lands
// Chris round 17 card 1 rider (Oracle): one slip must not silence the ask for ever — "established" = the
// dominant type has >= 3 AND every other type has < 2 (the A2 unsupported-rival notion).
check('after ONE Purchase Order the ask STILL fires on the next PO (24 Q + 1 PO is not a second type yet)',
      checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order').split === true
      && checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order').count === 24);
check('…and on any other type too', checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'invoice').split === true);
mk('Nordwind Refrigeration Ltd', 3);   // the SECOND PO confirm — now a genuine second type
check('TRADE-OFF PIN: at 2 confirms of the second type the history is MIXED → the ask stops (a genuine second type costs one extra ack)',
      checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'purchase_order').reason === 'mixed'
      && checkTypeSplit(db, 'Nordwind Refrigeration Ltd', 'invoice').reason === 'mixed');
for (let i = 0; i < 5; i++) mk('Pending Co', 7, 'needs_review');
check('held docs are not history', checkTypeSplit(db, 'Pending Co', 'purchase_order').reason === 'thin');
check('unknown issuer / empty inputs → no ask', checkTypeSplit(db, 'Nobody', 'quote').split === false
      && checkTypeSplit(db, '', 'quote').split === false && checkTypeSplit(db, 'Nordwind Refrigeration Ltd', '').split === false);
check('an unknown typed slug still asks (typed_name null, slug in the message)',
      (() => { const x = checkTypeSplit(db, 'Harbour Glass Ltd', 'remittance'); return x.split === true && x.typed_name === null && /as remittance\?/.test(x.message); })());

// ── mig 144 type_split_teach_scope_suppress (Q1, herald): a TAUGHT type stands the ask down ──────────
console.log('\nteach-scope stand-down (mig 144):');
const fs = require('fs');
const path = require('path');
// a teach-origin template = a templates row (name==supplier, document_type_slug==slug) with >=1 mapping.
const teachTemplate = (supplier, slug, tid) => {
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (?, ?, ?, ?)")
    .run(tid, supplier, 'tpl_' + tid, slug);
  db.prepare("INSERT INTO template_field_mappings (template_id, field_key, target_x_norm) VALUES (?, 'invoice_number', 0.5)").run(tid);
};
// A cold single-type supplier that WOULD ask when confirming the other type.
for (let i = 0; i < 24; i++) mk('Teach Test Co', 7);          // 24 quotes
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (9, 'Invoice', 'invoice', 1)").run();
check('BASELINE: 24 quotes, confirm Invoice, no taught template → split:true (the ask fires)',
      checkTypeSplit(db, 'Teach Test Co', 'invoice').split === true);
teachTemplate('Teach Test Co', 'invoice', 501);              // the human TAUGHT Invoice for this supplier
check('OFF (arc off) is byte-identical — a taught template does NOT suppress unless the arc is on',
      checkTypeSplit(db, 'Teach Test Co', 'invoice').split === true
      && checkTypeSplit(db, 'Teach Test Co', 'invoice', { teachScopeSuppress: false }).split === true);
check('SCENARIO A (taught → silent): arc ON + a teach-origin Invoice template → split:false reason taught',
      (() => { const x = checkTypeSplit(db, 'Teach Test Co', 'invoice', { teachScopeSuppress: true }); return x.split === false && x.reason === 'taught'; })());
check('SCENARIO B (cold, never-taught): arc ON but confirming purchase_order (no taught PO template) → STILL asks',
      checkTypeSplit(db, 'Teach Test Co', 'purchase_order', { teachScopeSuppress: true }).split === true);
// a templates row WITHOUT a mapping is not a teach fingerprint (graduation stub / bare row) → still asks.
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (777, 'Barecase Co', 'tpl_777', 'invoice')").run();
for (let i = 0; i < 24; i++) mk('Barecase Co', 7);
check('NEGATIVE CONTROL: a templates row with NO field mapping is not teach-origin → arc ON still asks',
      checkTypeSplit(db, 'Barecase Co', 'invoice', { teachScopeSuppress: true }).split === true);
// setting-driven (no opts): flipping the setting ON drives the same stand-down.
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('type_split_teach_scope_suppress', 'true')").run();
check('setting-driven: type_split_teach_scope_suppress=true stands the taught ask down without opts',
      checkTypeSplit(db, 'Teach Test Co', 'invoice').split === false
      && checkTypeSplit(db, 'Teach Test Co', 'purchase_order').split === true);   // cold still asks
db.prepare("UPDATE settings SET value = 'false' WHERE key = 'type_split_teach_scope_suppress'").run();
// SAFETY PIN (herald seam): checkTypeSplit is NOT wired into the backend auto-file path — standing the ask
// down can never file a wrong type. Assert the processing handler never references it.
const procSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('SAFETY: checkTypeSplit is absent from processing/handler.js (not in the auto-file path)',
      !/checkTypeSplit/.test(procSrc));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
