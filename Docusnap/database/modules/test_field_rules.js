#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_field_rules.js
 * ------------------------------------
 * field_rules CRUD (Review cleanup-rules toolkit): saveFieldRule upsert + token
 * normalization, getFieldRules, scope-clear, and Learning Recovery surfacing. The
 * stored token_norm must match python_backend/extraction/field_rules.normalize_token.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_field_rules.js
 */

const Database = require('better-sqlite3');
const learning = require('./learning');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond ? 0 : 1; }

function makeDb() {
  const db = new Database(':memory:');
  // Mirrors migration 36.
  db.exec(`
    CREATE TABLE field_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT, document_type TEXT, field_key TEXT NOT NULL,
      rule_type TEXT NOT NULL, token_norm TEXT, created_from TEXT,
      side TEXT NOT NULL DEFAULT 'trailing', min_prefix INTEGER NOT NULL DEFAULT 3,
      usage_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE field_anchors (supplier_name TEXT, document_type TEXT, field_key TEXT);
    CREATE TABLE supplier_hints (supplier_name TEXT, document_type TEXT, field_key TEXT);
    CREATE TABLE corrections (supplier_name TEXT, document_type TEXT, field_key TEXT);
    CREATE TABLE logo_fingerprints (supplier_name TEXT);
  `);
  return db;
}

function main() {
  let f = 0;
  const db = makeDb();

  // remove_text: token normalized (casefold + collapse ws + cap 40, matching Python).
  learning.saveFieldRule(db, {
    supplier_name: 'Acme Ltd', document_type: 'invoice', field_key: 'reference_number',
    rule_type: 'remove_text', token: '  DOCUSYS   Model  Name ', side: 'trailing',
  });
  let rows = learning.getFieldRules(db);
  f += check('remove_text saved', rows.length === 1);
  f += check('token normalized', rows[0].token_norm === 'docusys model name');
  f += check('side stored', rows[0].side === 'trailing');
  f += check('min_prefix defaulted to 3', rows[0].min_prefix === 3);

  // Upsert: same scope+token → no duplicate, usage_count bumped.
  learning.saveFieldRule(db, {
    supplier_name: 'Acme Ltd', document_type: 'invoice', field_key: 'reference_number',
    rule_type: 'remove_text', token: 'DOCUSYS MODEL NAME',
  });
  rows = learning.getFieldRules(db);
  f += check('upsert: no duplicate', rows.length === 1);
  const uc = db.prepare(`SELECT usage_count FROM field_rules WHERE rule_type='remove_text'`).get().usage_count;
  f += check('upsert: usage_count bumped', uc === 1);

  // keep_block: NULL token, one per scope.
  learning.saveFieldRule(db, {
    supplier_name: 'Acme Ltd', document_type: 'invoice', field_key: 'reference_number',
    rule_type: 'keep_block',
  });
  learning.saveFieldRule(db, {   // duplicate keep_block → upsert, not a new row
    supplier_name: 'Acme Ltd', document_type: 'invoice', field_key: 'reference_number',
    rule_type: 'keep_block',
  });
  rows = learning.getFieldRules(db);
  f += check('keep_block saved once (NULL token)',
             rows.filter(r => r.rule_type === 'keep_block').length === 1
             && rows.find(r => r.rule_type === 'keep_block').token_norm === null);

  // Invalid inputs rejected.
  f += check('bad rule_type rejected',
             learning.saveFieldRule(db, { field_key: 'x', rule_type: 'nope' }).changes === 0);
  f += check('remove_text with empty token rejected',
             learning.saveFieldRule(db, { field_key: 'x', rule_type: 'remove_text', token: '  ' }).changes === 0);

  // Recovery summary counts rules.
  const sum = learning.getRecoverySummary(db, { supplier_name: 'Acme Ltd', document_type: 'invoice' });
  f += check('recovery summary counts rules', sum.rules === 2);

  // Scope-clear.
  const cleared = learning.clearFieldRulesForScope(db, { supplier_name: 'Acme Ltd', document_type: 'invoice' });
  f += check('scope clear removes both rules', cleared.changes === 2 && learning.getFieldRules(db).length === 0);

  console.log(f ? `\n${f} check(s) FAILED` : '\nAll field_rules CRUD checks passed');
  process.exit(f ? 1 : 0);
}

main();
