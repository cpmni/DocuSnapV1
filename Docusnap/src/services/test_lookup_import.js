'use strict';
/**
 * test_lookup_import.js — pins the Records-list IMPORT (design QUICKFILE_LOOKUP_LISTS_2026-09-21.md; Oracle
 * C4/C5). CSV parse edge cases; Excel serial→date (1900 leap bug + 1904 system, C5); transactional apply;
 * composite-key dedupe (never merge two same-named subjects on the name alone — reggie); blank-master skip +
 * report; a bad date imported blank + flagged (never stored). Filing is not involved (import writes only
 * lookup_records). ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_lookup_import.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const lookup = require('../../database/modules/lookup');
const imp = require('./lookupImport');
const { parseCsv } = require('../lib/csvParse');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

console.log('§1 CSV parse — BOM, quoted comma/newline, CRLF, semicolon (EU Excel)');
{
  const csv = '﻿name,note\r\n"Doe, John","line1\nline2"\r\nJane,plain\r\n';
  const { rows } = parseCsv(csv);
  check('BOM stripped, header intact', rows[0][0] === 'name' && rows[0][1] === 'note');
  check('quoted comma kept as one field', rows[1][0] === 'Doe, John');
  check('quoted embedded newline preserved', rows[1][1] === 'line1\nline2');
  check('trailing empty row dropped', rows.length === 3);
  const semi = parseCsv('a;b;c\n1;2;3\n');
  check('semicolon delimiter auto-detected', semi.rows[1].length === 3 && semi.rows[1][0] === '1');
}

console.log('§2 Excel serial → DD-MM-YYYY (C5: 1900 leap bug + 1904 system)');
{
  check('serial 44197 (1900 system) → 01-01-2021', imp.excelSerialToDMY(44197, false) === '01-01-2021');
  check('serial 59 (1900) → 28-02-1900 (below the phantom leap day)', imp.excelSerialToDMY(59, false) === '28-02-1900');
  check('serial 0 (1904 system) → 01-01-1904', imp.excelSerialToDMY(0, true) === '01-01-1904');
  check('negative/garbage serial → null', imp.excelSerialToDMY(-3, false) === null);
}

console.log('§3 applyImport — transactional, serial dates, composite dedupe, blank-master skip, bad-date flag');
{
  const db = new Database(':memory:'); runMigrations(db);
  const cl = lookup.createList(db, {
    name: 'Children', master_key: 'name',
    columns: [{ key: 'name', is_master: true }, { key: 'dob', type: 'date' }, { key: 'addr' }],
    disambiguator_key: 'dob', upsert_key: ['name', 'dob'],
  });
  const list = lookup.getList(db, cl.id);
  const parsed = { headers: ['name', 'dob', 'addr'], isXlsx: true, date1904: false, rows: [
    ['John Doe', '44197', '12 High St'],       // dob serial → 01-01-2021
    ['', '44197', 'no name'],                   // blank master → skipped
    ['John Doe', '44197', '12 High St again'],  // same composite (name+dob) → dedupe to update
    ['Jane Roe', 'notadate', '9 Oak Rd'],       // bad date → imported blank + flagged, record still inserted
  ]};
  const map = { name: 0, dob: 1, addr: 2 };
  const r = imp.applyImport(db, list, parsed, map, { mode: 'append' });
  check('apply ok', r.ok === true);
  check('inserted 2 (John Doe once, Jane once)', r.inserted === 2);
  check('updated 1 (the duplicate John Doe composite)', r.updated === 1);
  check('skipped 1 (blank master) + reported', r.skipped === 1 && r.errors.some(e => e.error === 'blank_master'));
  check('bad date flagged + reported (row imported)', r.dateFlags === 1 && r.errors.some(e => e.error === 'bad_date'));
  const john = db.prepare("SELECT values_json FROM lookup_records WHERE list_id=? AND master_value='John Doe'").get(cl.id);
  check('John Doe stored once, dob normalised from the Excel serial', JSON.parse(john.values_json).dob === '01-01-2021');
  const jane = db.prepare("SELECT values_json FROM lookup_records WHERE list_id=? AND master_value='Jane Roe'").get(cl.id);
  check('Jane Roe stored with a BLANK dob (bad date never stored)', JSON.parse(jane.values_json).dob === '');
  check('total records = 2 (dedupe worked)', lookup.countRecords(db, cl.id) === 2);

  // A SECOND append with the same composite updates, never duplicates.
  const r2 = imp.applyImport(db, list, { headers: ['name', 'dob', 'addr'], isXlsx: true, date1904: false, rows: [['John Doe', '44197', 'new addr']] }, map, { mode: 'append' });
  check('re-import same composite → update, not a new row', r2.updated === 1 && lookup.countRecords(db, cl.id) === 2);
  check('the update took (addr changed)', JSON.parse(db.prepare("SELECT values_json FROM lookup_records WHERE master_value='John Doe' AND list_id=?").get(cl.id).values_json).addr === 'new addr');
}

console.log('§4 no upsert key → insert-all + report name collisions (never silent-merge)');
{
  const db = new Database(':memory:'); runMigrations(db);
  const cl = lookup.createList(db, { name: 'People', master_key: 'name', columns: [{ key: 'name', is_master: true }], upsert_key: null });
  const list = lookup.getList(db, cl.id);
  const r = imp.applyImport(db, list, { headers: ['name'], isXlsx: false, date1904: false, rows: [['John Doe'], ['John Doe'], ['Jane']] }, { name: 0 }, { mode: 'append' });
  check('no upsert key: both John Does INSERTED (never merged)', r.inserted === 3 && lookup.countRecords(db, cl.id) === 3);
  check('name collision REPORTED', r.collisions >= 1);
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
