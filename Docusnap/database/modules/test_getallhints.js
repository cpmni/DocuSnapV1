#!/usr/bin/env node
'use strict';
// getAllHints (2026-07-10): the TRAINING dump must be UNCAPPED. buildTrainingArgs used
// the bare getHints(db), whose default LIMIT 100 (by usage_count DESC) silently starved
// the engine of every new supplier's usage-1/2 hints once the corpus grew past 100 rows
// (535 live rows, 435 invisible when caught — the Bramble & Finch identity hint among
// them). Pins: the dump is uncapped; the display form keeps its cap; and the PRODUCTION
// training path actually uses the uncapped form (source pin — a revert to getHints(db)
// silently reintroduces the starvation with every test green).
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_getallhints.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const learning = require('./learning');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

const db = new Database(':memory:');
runMigrations(db);
const ins = db.prepare(`INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count)
                        VALUES (?, 'invoice', 'invoice_number', ?, ?)`);
for (let i = 0; i < 150; i++) ins.run(`Supplier ${i}`, `INV-${i}`, 150 - i);

check('getAllHints returns the WHOLE corpus (150/150)', learning.getAllHints(db).length === 150);
check('bare getHints keeps its display cap (100)', learning.getHints(db).length === 100);
check('a usage-1 hint (a fresh confirm) IS in the training dump',
      learning.getAllHints(db).some(h => h.usage_count === 1));
db.close();

// Source pin: the production training path must use the uncapped form.
const fs = require('fs'), path = require('path');
const handlerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('buildTrainingArgs uses getAllHints (not the capped bare getHints)',
      /getAllHints\(db\)/.test(handlerSrc) && !/allHints\s*=\s*learning\.getHints\(db\)/.test(handlerSrc));

console.log(fails ? `\n${fails} FAILED` : '\nAll getAllHints checks passed.');
process.exit(fails ? 1 : 0);
