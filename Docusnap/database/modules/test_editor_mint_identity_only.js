#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_editor_mint_identity_only.js
 * --------------------------------------------------
 * ORACLE C1 PIN (2026-08-12, sender-field editor sign-off): the Review sender-field editor's
 * mint-on-demand passes `allValues = { supplier_name: <confirmed name> }` ONLY, so the template is
 * born IDENTITY-ONLY — zero field rules frozen from an unreviewed sample. The exposure this pins
 * shut: _buildTemplateFields freezes every schema-constant non-name text field (vat_no, account_no,
 * po_ref, serials) from a sample of ONE at template_fixed @95, and the editor is reachable on doc #1
 * of an unseen sender when every value is a raw machine read (the Quillstone wrong-company class,
 * HANDOVER_2026-08-10_NIGHT). Today's promote from a curated confirm keeps its full payload.
 *
 * Pin 1: identity-only payload ⇒ the ONLY rule row is the issuer's (no non-issuer fixed_value).
 * Pin 2: the restraint comes from the PAYLOAD, not the builder — a full payload still builds more
 *        rows, so a future dev re-sourcing keys from dtInfo (instead of allValues) breaks Pin 1.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_editor_mint_identity_only.js
 */

const Database = require('better-sqlite3');
const { _buildTemplateFields } = require('../../src/modules/review/handler');

let fails = 0;
function check(label, cond, extra) {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
}

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT, required INTEGER DEFAULT 0);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, status TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  return db;
}

// A type rich in exactly the field shapes rule (C) documented as freezable from a sample of one:
// schema-constant TEXT codes. If the builder ever starts sourcing keys from dtInfo, these appear.
const dtInfo = {
  id: 1, ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
  fields: [
    { key: 'supplier_name',  label: 'Document Issuer', is_variable: 0 },
    { key: 'vat_no',         label: 'VAT Number',      is_variable: 0 },
    { key: 'account_no',     label: 'Account Number',  is_variable: 0 },
    { key: 'po_ref',         label: 'PO Reference',    is_variable: 0 },
    { key: 'serials',        label: 'Serial Numbers',  is_variable: 0 },
    { key: 'invoice_number', label: 'Invoice Number',  is_variable: 1 },
  ],
};

function main() {
  const db = makeDb();

  console.log('\n1. Identity-only payload (the editor mint) — zero non-issuer rules');
  const rows = _buildTemplateFields(db, { supplier_name: 'Nordwind Refrigeration Ltd' }, dtInfo);
  const nonIssuer = rows.filter(r => r.field_key !== 'supplier_name');
  check('no non-issuer rule row exists at all', nonIssuer.length === 0, JSON.stringify(nonIssuer));
  check('no non-issuer fixed_value anywhere', nonIssuer.every(r => !r.fixed_value));
  const issuerRow = rows.find(r => r.field_key === 'supplier_name');
  check('the issuer rule carries the confirmed name (the template identity carrier)',
        !issuerRow || String(issuerRow.fixed_value || '') === 'Nordwind Refrigeration Ltd',
        JSON.stringify(issuerRow));

  console.log('\n2. Restraint lives in the PAYLOAD, not the builder (guards a dtInfo re-source)');
  const full = _buildTemplateFields(db, {
    supplier_name: 'Nordwind Refrigeration Ltd', vat_no: 'GB 903 3318 42',
    account_no: 'NRQ-3901', po_ref: 'PO-1234', serials: 'NW-1', invoice_number: 'INV-9',
  }, dtInfo);
  check('a full curated payload still builds MORE rows than identity-only',
        full.length > rows.length, `full=${full.length} identity=${rows.length}`);

  console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
}

main();
