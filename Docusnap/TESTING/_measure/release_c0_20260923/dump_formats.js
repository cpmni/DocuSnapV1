#!/usr/bin/env node
'use strict';
/*
 * Dump learning.getFieldFormats(db) from a READ-ONLY DB copy to JSON — the EXACT payload the harness passes
 * to the engine as --formats-file (stress_test/realdoc_regression.js:79), so a Python census can rebuild
 * format_anomaly_checker.build_format_class_index the way engine.set_formats does.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/release_c0_20260923/dump_formats.js <db> <out.json>
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const learning = require(path.join(ROOT, 'database', 'modules', 'learning.js'));
const db = new Database(process.argv[2], { readonly: true });
const formats = learning.getFieldFormats(db);
fs.writeFileSync(process.argv[3], JSON.stringify(formats));
console.log(`formats groups: ${formats.length} -> ${process.argv[3]}`);
