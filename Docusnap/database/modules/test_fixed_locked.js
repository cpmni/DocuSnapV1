#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_fixed_locked.js
 * -------------------------------------
 * Admin-LOCKED fixed template values (migration 31). A fixed value an admin sets
 * via templates.setFieldFixedValue is marked template_fields.fixed_locked = 1 and is
 * PRESERVED across confirmed-history rebuilds (_upsertFields via templates.update) —
 * a deliberate override can't be flipped back to variable or erased. An ordinary
 * auto-derived non-variable field stays UNLOCKED and is overwritten as before.
 * Clearing returns the field to normal (fixed_locked = 0, is_variable = 1).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_fixed_locked.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const templates = require('./templates');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
function tf(db, tid, key) {
  return db.prepare('SELECT * FROM template_fields WHERE template_id = ? AND field_key = ?').get(tid, key);
}

const db = new Database(':memory:');
runMigrations(db);

// ── Migration 31: column exists, default unlocked ──────────────────────────────
const cols = db.prepare('PRAGMA table_info(template_fields)').all().map(c => c.name);
check('migration 31: template_fields.fixed_locked column exists', cols.includes('fixed_locked'));

const tid = templates.create(db, { name: 'Document Solutions Service Worksheet',
                                   document_type_slug: 'service_worksheet' });

// ── Persistence: admin-set fixed value is stored as LOCKED ──────────────────────
templates.setFieldFixedValue(db, tid, 'supplier_name', 'Document Solutions');
let r = tf(db, tid, 'supplier_name');
check('admin-set fixed value stored',           r && r.fixed_value === 'Document Solutions');
check('admin-set fixed value -> is_variable=0', r && r.is_variable === 0);
check('admin-set fixed value -> fixed_locked=1', r && r.fixed_locked === 1);

// ── A confirmed-history rebuild that says VARIABLE must NOT erase the locked row ─
templates.update(db, tid, { fields: [
  { field_key: 'supplier_name',    is_variable: true, fixed_value: null },   // history "thinks" it's variable
  { field_key: 'reference_number', is_variable: true, fixed_value: null },
] });
r = tf(db, tid, 'supplier_name');
check('locked row survives rebuild: fixed_value kept',  r && r.fixed_value === 'Document Solutions');
check('locked row survives rebuild: is_variable stays 0', r && r.is_variable === 0);
check('locked row survives rebuild: still locked',      r && r.fixed_locked === 1);

// ── An UNLOCKED auto fixed value is still overwritten by a variable rebuild ──────
templates.update(db, tid, { fields: [{ field_key: 'total_amount', is_variable: false, fixed_value: 'AUTO' }] });
check('unlocked auto fixed stored (is_variable=0)', (tf(db, tid, 'total_amount') || {}).is_variable === 0);
check('unlocked auto fixed is NOT locked',          (tf(db, tid, 'total_amount') || {}).fixed_locked === 0);
templates.update(db, tid, { fields: [{ field_key: 'total_amount', is_variable: true, fixed_value: null }] });
r = tf(db, tid, 'total_amount');
check('unlocked row IS overwritten by a variable rebuild (no behaviour change)',
      r && r.is_variable === 1 && (r.fixed_value === null || r.fixed_value === undefined));

// ── Clearing returns the field to normal (unlocked + variable) ──────────────────
templates.setFieldFixedValue(db, tid, 'supplier_name', '');
r = tf(db, tid, 'supplier_name');
check('clearing -> fixed_value null',        r && (r.fixed_value === null || r.fixed_value === undefined));
check('clearing -> is_variable back to 1',   r && r.is_variable === 1);
check('clearing -> fixed_locked back to 0',  r && r.fixed_locked === 0);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll fixed-locked persistence checks passed.');
process.exit(fails ? 1 : 0);
