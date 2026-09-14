#!/usr/bin/env node
'use strict';
/**
 * test_pairing_code.js — the "Connect a client" pairing code generator (Oracle C4, 2026-09-14).
 * Pins: the code is >= 8 chars, drawn from an UNAMBIGUOUS alphanumeric alphabet (no 0/O/1/I/L), and varies.
 * The gate behaviour (no code => open; code set => ?code= required, constant-time, expiry) is pinned in
 * test_v1_ca.js / test_v1_enroll.js — this pins the WRITER so a future dev can't quietly weaken the code.
 *   node src/modules/api/test_pairing_code.js
 */
const { _genPairingCode } = require('./handler');
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const codes = Array.from({ length: 200 }, () => _genPairingCode());
check('every code is >= 8 chars', codes.every(c => c.length >= 8));
check('every char is from the unambiguous set (A-Z minus I,L,O + 2-9)', codes.every(c => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(c)));
check('no ambiguous 0/O/1/I/L ever appears', codes.every(c => !/[01OIL]/.test(c)));
check('codes vary (not a constant)', new Set(codes).size > 190);
check('a custom length is honoured', _genPairingCode(12).length === 12);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
