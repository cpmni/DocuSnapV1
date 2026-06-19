#!/usr/bin/env node
'use strict';
// Unit test for services/sessionService.js — issue/verify/expiry/revocation with
// an injected clock. Run: node src/services/test_session.js (no native deps)

const { createSessionStore } = require('./sessionService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

let clock = 1000;
let n = 0;
const store = createSessionStore({
  now: () => clock,
  genToken: () => `tok${++n}`,
  absoluteMs: 10000, // 10s hard cap
  idleMs: 2000,      // 2s idle
});

const { token } = store.issue({ userId: 7, username: 'sam', role: 'edit' });
check('issue returns a token', token === 'tok1');

let s = store.verify(token);
check('verify resolves role/user', s && s.userId === 7 && s.role === 'edit' && s.username === 'sam');

// Idle window slides on use: at +1s still valid, then +1s again still valid.
clock += 1000; check('valid within idle window (+1s)', !!store.verify(token));
clock += 1000; check('idle window slid on use (+1s more)', !!store.verify(token));

// Now go idle past idleMs -> expired + evicted.
clock += 2001;
check('expires after idle timeout', store.verify(token) === null);
check('expired token evicted from store', store.size() === 0);

// Absolute cap: even with constant use, dies at absoluteMs.
clock = 5000;
const t2 = store.issue({ userId: 1, username: 'a', role: 'admin' }).token;
for (let i = 0; i < 20; i++) { clock += 400; store.verify(t2); } // keep sliding idle
clock = 5000 + 10001; // past absolute cap from issue time
check('absolute cap enforced despite activity', store.verify(t2) === null);

// Revoke + revokeUser.
const a = store.issue({ userId: 9, username: 'x', role: 'readonly' }).token;
clock += 100;
store.revoke(a);
check('revoke invalidates token', store.verify(a) === null);

const b = store.issue({ userId: 42, username: 'm', role: 'edit' }).token;
const c = store.issue({ userId: 42, username: 'm', role: 'edit' }).token;
check('revokeUser drops all of a user\'s sessions', store.revokeUser(42) === 2 && !store.verify(b) && !store.verify(c));

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll session checks passed.');
process.exit(fail ? 1 : 0);
