'use strict';
/**
 * test_quickfile_meta.js — pins the pure per-doc meta assembly (Oracle MC2/MC1). Proves each entry's meta
 * comes from THAT entry (no shared-index leak), custom fields pass through, defaults merge under the entry's
 * own values, and title is never inherited. ELECTRON_RUN_AS_NODE=1 electron src/lib/test_quickfile_meta.js
 */
const m = require('./quickfileMeta');
let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

const e1 = { token: 't1', values: { party: 'Acme', date: '01-01-2026', reference: 'A1', title: 'Doc One', notes: 'n1', customFields: { dob: '2020-01-01' } } };
const e2 = { token: 't2', values: { party: 'Beta Ltd', date: '02-02-2026', reference: 'B2', title: 'Doc Two', notes: '', customFields: {} } };

console.log('§1 buildMeta returns EACH entry\'s own values (no cross-doc leak — MC1)');
const m1 = m.buildMeta(7, e1), m2 = m.buildMeta(7, e2);
check('entry 1 meta = entry 1 values', m1.party === 'Acme' && m1.reference === 'A1' && m1.title === 'Doc One' && m1.customFields.dob === '2020-01-01');
check('entry 2 meta = entry 2 values (independent)', m2.party === 'Beta Ltd' && m2.reference === 'B2' && m2.title === 'Doc Two');
check('documentTypeId carried', m1.documentTypeId === 7 && m2.documentTypeId === 7);
check('trims + empty customFields ok', m2.customFields && Object.keys(m2.customFields).length === 0);

console.log('§2 isReady = has a company/person');
check('ready when party set', m.isReady(e1) === true);
check('not ready when party blank', m.isReady({ values: { party: '  ', title: 'x' } }) === false);

console.log('§3 withDefaults — shared applies UNDER the entry\'s own values; title never inherited');
const shared = { party: 'Sunnydays', date: '09-09-2026', reference: '', notes: 'batch', customFields: { room: 'Blue' } };
const filled = m.withDefaults({ values: { party: '', date: '', reference: 'OWN-REF', title: 'Mine', customFields: { room: 'Red' } } }, shared);
check('blank party inherits the shared default', filled.values.party === 'Sunnydays');
check('own reference wins over blank shared', filled.values.reference === 'OWN-REF');
check('own custom value wins over shared', filled.values.room === undefined && filled.values.customFields.room === 'Red');
check('title is NOT inherited (per-doc always)', filled.values.title === 'Mine');
const inheritCustom = m.withDefaults({ values: { customFields: {} } }, shared);
check('blank custom inherits the shared custom default', inheritCustom.values.customFields.room === 'Blue');

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
