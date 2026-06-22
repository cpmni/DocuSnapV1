#!/usr/bin/env node
'use strict';

/**
 * src/services/test_seatpool.js — sticky concurrent seat-pool engine.
 * Covers: claim up to the cap · reject over cap (SEAT_LIMIT) · a reconnecting client
 * reuses its seat (no new seat) · heartbeat bumps last-seen/ip · NO auto-expiry ·
 * admin release frees a seat for the next client · cap 0 rejects all.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_seatpool.js
 */

const Database = require('better-sqlite3');
const { createSeatPool } = require('./seatPool');

let fail = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; return cond; }

const db = new Database(':memory:');   // persisted pool — back it with an in-memory DB
db.exec(`CREATE TABLE client_seats (id TEXT PRIMARY KEY, client_key TEXT UNIQUE, username TEXT,
  role TEXT, hostname TEXT, ip TEXT, first_seen INTEGER, last_seen INTEGER, workflow_enabled INTEGER NOT NULL DEFAULT 0)`);

let t = 1000;
let n = 0;
const pool = createSeatPool({ getDb: () => db, now: () => t, genId: () => 's' + (++n) });

// claim up to the cap (2)
const a = pool.claim({ clientKey: 'c1', username: 'a', hostname: 'PC-A', ip: '10.0.0.1' }, 2);
const b = pool.claim({ clientKey: 'c2', username: 'b', hostname: 'PC-B', ip: '10.0.0.2' }, 2);
check('claim c1 ok (records host/ip)', a.ok && !a.reused && a.seat.ip === '10.0.0.1' && a.seat.hostname === 'PC-A');
check('claim c2 ok', b.ok && !b.reused);
check('two seats in use', pool.count() === 2);

// 3rd distinct client over the cap → refused
const c = pool.claim({ clientKey: 'c3', username: 'c', ip: '10.0.0.3' }, 2);
check('3rd client over cap → SEAT_LIMIT (inUse/cap reported)', !c.ok && c.code === 'SEAT_LIMIT' && c.inUse === 2 && c.cap === 2);
check('rejection did not consume a seat', pool.count() === 2);

// reconnect same client → reuses its seat, no new seat
t = 2000;
const a2 = pool.claim({ clientKey: 'c1', username: 'a', ip: '10.0.0.9' }, 2);
check('reconnect c1 reuses its seat (same id, reused=true)', a2.ok && a2.reused && a2.seat.id === a.seat.id);
check('reconnect updates ip + last-seen', a2.seat.ip === '10.0.0.9' && a2.seat.lastSeen === 2000);
check('reconnect did not grow the pool', pool.count() === 2);

// heartbeat
t = 3000; pool.touch('c1', { ip: '10.0.0.5' });
const c1 = pool.list().find(s => s.clientKey === 'c1');
check('touch() bumps last-seen + ip', c1.lastSeen === 3000 && c1.ip === '10.0.0.5');

// NO auto-expiry — far in the future, seats persist (admin-release model)
t += 30 * 24 * 60 * 60 * 1000;
check('seats never auto-expire', pool.count() === 2);

// admin release frees a seat → the next client can take it
check('release a held seat → true', pool.release(a.seat.id) === true);
check('release an unknown seat → false', pool.release('nope') === false);
check('one seat free after release', pool.count() === 1);
const d = pool.claim({ clientKey: 'c4', username: 'd', ip: '10.0.0.4' }, 2);
check('a new client takes the freed seat', d.ok && !d.reused && pool.count() === 2);
check('the released client cannot reclaim while full', pool.claim({ clientKey: 'c1', username: 'a' }, 2).ok === false);

// workflow add-on — an upgrade ON a held search seat, capped independently of search.
// State here: c2 + c4 hold seats; c1 was released (no seat).
check('workflow without a held seat → NO_SEAT', pool.claimWorkflow('c1', 1).code === 'NO_SEAT');
check('workflow on a held seat (cap 1) → ok', pool.claimWorkflow('c2', 1).ok === true);
check('workflow now in use = 1', pool.workflowInUse() === 1);
check('a 2nd held seat over workflow cap 1 → WORKFLOW_LIMIT',
  (() => { const w = pool.claimWorkflow('c4', 1); return !w.ok && w.code === 'WORKFLOW_LIMIT'; })());
check('workflow re-claim is idempotent (reused, no double-count)',
  (() => { const w = pool.claimWorkflow('c2', 1); return w.ok && w.reused === true && pool.workflowInUse() === 1; })());
check('list() surfaces workflowEnabled', pool.list().find(s => s.clientKey === 'c2').workflowEnabled === true);

// cap 0 → nothing can claim (fresh empty pool)
const db0 = new Database(':memory:');
db0.exec(`CREATE TABLE client_seats (id TEXT PRIMARY KEY, client_key TEXT UNIQUE, username TEXT,
  role TEXT, hostname TEXT, ip TEXT, first_seen INTEGER, last_seen INTEGER)`);
check('cap 0 rejects all (empty pool)', createSeatPool({ getDb: () => db0 }).claim({ clientKey: 'x' }, 0).ok === false);

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll seat-pool checks passed.');
process.exit(fail ? 1 : 0);
