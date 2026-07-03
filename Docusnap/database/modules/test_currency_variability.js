#!/usr/bin/env node
'use strict';
// A CURRENCY field (total/subtotal/tax/amount) is per-document variable, so
// _annotateFieldVariability must mark it is_variable — otherwise supplier hints
// stamp one invoice's total onto every other invoice whose total read empty (the
// "$3,446.16 on every doc, auto-filed at 100%" bug), and template freezing pins
// it. Mirrors the existing date/ref-field handling.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_currency_variability.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const doctypes = require('./document_types');

let fail = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fail++; };

const db = new Database(':memory:');
runMigrations(db);
doctypes.seedBuiltInTypes(db);
const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;

doctypes.addField(db, { document_type_id: invId, key: 'total_amount', label: 'Total',    type: 'currency' });
doctypes.addField(db, { document_type_id: invId, key: 'notes',        label: 'Notes',    type: 'text' });

const byKey = {};
for (const f of doctypes.getWithFields(db, 'invoice').fields) byKey[f.key] = f;

check('currency field (total_amount) is is_variable',          byKey.total_amount.is_variable === 1);
check('date field stays is_variable (regression)',             byKey.invoice_date.is_variable === 1);
check('ref field stays is_variable (regression)',              byKey.invoice_number.is_variable === 1);
check('plain text field is NOT variable (regression)',         byKey.notes.is_variable === 0);
check('supplier_name (identity) is NOT variable (regression)', byKey.supplier_name.is_variable === 0);

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll currency-variability checks passed.');
process.exit(fail ? 1 : 0);
