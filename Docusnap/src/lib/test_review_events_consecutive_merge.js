#!/usr/bin/env node
'use strict';
/**
 * src/lib/test_review_events_consecutive_merge.js — owner 2026-09-07: "the notifications at the top are fragmented
 * per filed group but are all the same doc type and supplier — if consecutive batches are filed, can they be added
 * to the previous filing, increasing the doc count on that button". The ledger merged same-key events only inside
 * the 60 s burst gap; now the NEWEST event merges on the same key regardless of the gap. An intervening event of
 * another key still starts a fresh chip; a put-back chip is never revived by a merge; the in-gap rule for older
 * events is unchanged.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/lib/test_review_events_consecutive_merge.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond, detail) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && detail ? '\n      ' + detail : ''}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
let clock = 1_000_000;
const GAP = 1000;
const ledger = require('./reviewEvents').create({ now: () => clock, burstGapMs: GAP, undoWindowMs: 60 * 60 * 1000 });
const scope = (s) => ({ supplier: s, typeSlug: 'invoice' });
const rec = (kind, ids, s, extra = {}) => ledger.record(db, { kind, ids, scope: scope(s), approved: true, undo: { type: 'sweep' }, ...extra });
const list = () => ledger.list(db);                     // newest first; public shape (count, no ids)
const shape = (evs) => JSON.stringify(evs.map(e => [e.scope.supplier, e.count, e.put_back_at ? 'pb' : '']));

console.log('§1 consecutive same-sender filings grow ONE chip, well past the burst gap');
rec('self_filed', [1, 2], 'Ironbridge');
clock += 5 * 60 * 1000;                                   // 5 minutes later (gap is 1 s here)
rec('self_filed', [3, 4, 5], 'Ironbridge');
clock += 3 * 60 * 1000;
rec('self_filed', [6], 'Ironbridge');
let evs = list();
check('one event, not three', evs.length === 1, shape(evs));
check('…with all 6 ids and bySender 6', evs[0] && evs[0].count === 6 && evs[0].bySender.Ironbridge === 6);
check('…started_at kept from the first filing, at bumped to the last', evs[0].started_at === 1_000_000 && evs[0].at === clock);

console.log('§2 an intervening event of another key (past the gap) starts a fresh chip; the next same-key merges into THAT newest one only');
clock += 2 * GAP;
rec('self_filed', [7], 'Oakhaven');
clock += 2 * GAP;
rec('self_filed', [8, 9], 'Ironbridge');
evs = list();
check('three events: Ironbridge(2) · Oakhaven(1) · Ironbridge(6) — not merged across the Oakhaven chip', evs.length === 3 && evs[0].count === 2 && evs[1].count === 1 && evs[2].count === 6, shape(evs));
clock += 10 * 60 * 1000;
rec('self_filed', [10], 'Ironbridge');
evs = list();
check('…the newest Ironbridge chip absorbs the next one (2 → 3) ten minutes later', evs.length === 3 && evs[0].count === 3, shape(evs));

console.log('§3 a put-back chip is never revived by a merge');
const pb = ledger._load(db).events.slice(-1)[0];
ledger.markUndone(db, pb.id, { undone: pb.ids.slice(), refused: [] });
clock += 2 * GAP;
rec('self_filed', [11], 'Ironbridge');
evs = list();
check('a new chip after a put back (the put-back one stays put back)', evs.length === 4 && evs[0].count === 1 && !!evs[1].put_back_at, shape(evs));

console.log('§4 the in-gap rule for an OLDER same-key event is unchanged');
clock += 2 * GAP;
rec('self_filed', [12], 'Oakhaven');            // a fresh Oakhaven chip (its older one is far past the gap)
clock += 100;
rec('self_filed', [13], 'Ironbridge');          // newest is now Ironbridge (merges into chip [11] — consecutive rule)
clock += 100;
rec('self_filed', [14], 'Oakhaven');            // Oakhaven is NOT newest, but inside the gap → the old in-gap merge
evs = list();
const oak = evs.filter(e => e.scope.supplier === 'Oakhaven');
check('Oakhaven merged into its in-gap chip (count 2), no extra chip', oak.length === 2 && oak[0].count === 2 && oak[1].count === 1, shape(evs));
// [13] followed an Oakhaven chip, so it is NOT consecutive with [11]: a fresh chip (the intervening-key rule)
check('…while the Ironbridge [13] after the Oakhaven chip is its own chip (two Ironbridge chips of 1, neither put back)', evs.filter(e => e.scope.supplier === 'Ironbridge' && e.count === 1 && !e.put_back_at).length === 2, shape(evs));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
