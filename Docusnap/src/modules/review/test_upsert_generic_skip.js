#!/usr/bin/env node
'use strict';

/**
 * src/modules/review/test_upsert_generic_skip.js
 * ----------------------------------------------
 * Pinned trade-off (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §3): the heterogeneous
 * "General Document" pile never mints templates — _upsertTemplate must return
 * {skipped:'generic-type'} for the generic slug BEFORE touching the db (a generic-born
 * template could later Stage-0-match and stamp generic over a doc a real type fits).
 * The tripwire db proves the skip happens before ANY db access; the negative case
 * proves the skip is slug-scoped (a normal slug proceeds into the db and hits the
 * tripwire, i.e. the guard doesn't swallow real types).
 *
 *   node src/modules/review/test_upsert_generic_skip.js
 */

const { _upsertTemplate } = require('./handler');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

const tripwire = new Proxy({}, { get(_, prop) { throw new Error(`db touched (${String(prop)}) before the generic skip`); } });

(async () => {
  let r;
  try {
    r = await _upsertTemplate({}, tripwire, 1, {
      allValues: { supplier_name: 'X' }, document_type_slug: 'general_document', supplier_name: 'X', dtInfo: {},
    });
    check("generic slug ⇒ {skipped:'generic-type'} with ZERO db access", r && r.skipped === 'generic-type', JSON.stringify(r));
  } catch (e) {
    check("generic slug ⇒ {skipped:'generic-type'} with ZERO db access", false, e.message);
  }

  let threw = false;
  try {
    await _upsertTemplate({}, tripwire, 1, {
      allValues: { supplier_name: 'X' }, document_type_slug: 'invoice', supplier_name: 'X', dtInfo: {},
    });
  } catch (e) { threw = /db touched/.test(e.message); }
  check('non-generic slug proceeds into the db (guard is slug-scoped)', threw);

  console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
})();
