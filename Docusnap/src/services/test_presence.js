#!/usr/bin/env node
'use strict';

/**
 * src/services/test_presence.js
 * Phase 4: the in-memory "who's viewing" presence. Deterministic via an injectable clock.
 * Verifies heartbeat + viewers(exclude-self), TTL eviction of a gone viewer, heartbeat refresh,
 * release + releaseAll.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_presence.js
 *   (also runs under plain node — no native deps)
 */

const { createPresenceService } = require('./presenceService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

let clock = 1000;
const p = createPresenceService({ now: () => clock, ttlMs: 60000 });

// ── Two viewers on one doc; exclude-self ───────────────────────────────────────
p.heartbeat(7, { key: 'cliA', username: 'sarah', displayName: 'Sarah' });
p.heartbeat(7, { key: 'cliB', username: 'bob' });
check('doc 7 has 2 viewers', p.viewers(7).length === 2);
check('exclude-self drops the caller', p.viewers(7, 'cliA').length === 1 && p.viewers(7, 'cliA')[0].username === 'bob');
check('displayName falls back to username', p.viewers(7, 'cliA')[0].displayName === 'bob');
check('a doc with no viewers → []', p.viewers(999).length === 0);

// ── TTL eviction: a viewer not heard from for > ttl is reaped ──────────────────
clock += 30000;                                  // 30s — both still fresh
p.heartbeat(7, { key: 'cliA', username: 'sarah', displayName: 'Sarah' });   // sarah refreshes
clock += 40000;                                  // now cliB is 70s stale, cliA 40s
check('stale viewer (cliB) evicted, refreshed viewer (cliA) kept', p.viewers(7).length === 1 && p.viewers(7)[0].username === 'sarah');

clock += 60001;                                  // sarah now stale too
check('all stale → doc drops out', p.viewers(7).length === 0 && p._size() === 0);

// ── release + releaseAll ───────────────────────────────────────────────────────
p.heartbeat(8, { key: 'cliA', username: 'sarah' });
p.heartbeat(9, { key: 'cliA', username: 'sarah' });
p.heartbeat(9, { key: 'cliB', username: 'bob' });
p.release(8, 'cliA');
check('release removes a single doc viewer', p.viewers(8).length === 0);
check('  → other doc unaffected', p.viewers(9).length === 2);
p.releaseAll('cliA');
check('releaseAll drops the viewer everywhere', p.viewers(9).length === 1 && p.viewers(9)[0].username === 'bob');

// ── guards ─────────────────────────────────────────────────────────────────────
p.heartbeat(null, { key: 'x' });                 // no doc → ignored
p.heartbeat(10, { username: 'no-key' });         // no key → ignored
check('malformed heartbeats ignored', p.viewers(10).length === 0);

// ── onlyViewerIs (the in-view countdown's local-vs-remote discriminator, 2026-09-01) ──
const q = createPresenceService({ now: () => clock, ttlMs: 60000 });
q.heartbeat(20, { key: 'desktop:5', username: 'owner' });
check('onlyViewerIs true when the sole viewer is that key', q.onlyViewerIs(20, 'desktop:5') === true);
check('onlyViewerIs false for a different key', q.onlyViewerIs(20, 'desktop:9') === false);
q.heartbeat(20, { key: 'cliRemote', username: 'owner' });    // same user, second machine (a /v1 client)
check('onlyViewerIs false when a second (remote) viewer is present', q.onlyViewerIs(20, 'desktop:5') === false);
check('onlyViewerIs false for a doc nobody is viewing', q.onlyViewerIs(999, 'desktop:5') === false);
clock += 60001;                                              // both stale
check('onlyViewerIs false once the viewer is reaped', q.onlyViewerIs(20, 'desktop:5') === false);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
