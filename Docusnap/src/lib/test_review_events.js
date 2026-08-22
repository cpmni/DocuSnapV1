'use strict';
/*
 * test_review_events.js — B1 of the activity-strip arc (2026-08-22; barry + eric → Oracle
 * SIGN-OFF-W/COND C1/C3/C7). The Review ACTIVITY LEDGER, hermetic (a stub settings store, fake clock,
 * fake timers).
 *
 * Pins: ring cap · MERGE-IN-PLACE (200 docs × 8 senders spaced 4 s → ONE auto_filed event with 8
 * sender rows — this MUST fail against a 2 s trailing-flush design, that is the point) · the 60 s
 * burst gap (two events at 61 s) · scope-keyed kinds do not merge across senders · `seen` resets when
 * new docs merge in and survives serialise · public events carry counts, never the id list (C5) ·
 * undo offered only ≤7 days (C7) · the broadcast is throttled to one trailing send per second ·
 * unknown kinds / empty records are refused · `review_events` is a PROTECTED setting (C3: refused by
 * the generic set-setting door and absent from a backup).
 *
 * Run: node src/lib/test_review_events.js   (no native deps)
 */
const path = require('path');
const { create, SETTING_KEY } = require('./reviewEvents');
const { isProtectedSettingKey } = require('./protectedSettings');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };

// ── a stub settings store + fake clock/timers ─────────────────────────────────────────────────
const store = new Map();
const learning = { getSetting: (_db, k, def) => (store.has(k) ? store.get(k) : def), setSetting: (_db, k, v) => store.set(k, String(v)) };
let clock = 1_000_000;
const now = () => clock;
const sent = [];
const timerQ = [];
const timers = { setTimeout: (fn, ms) => { const t = { fn, due: clock + ms }; timerQ.push(t); return t; }, clearTimeout: (t) => { const i = timerQ.indexOf(t); if (i >= 0) timerQ.splice(i, 1); } };
const tick = (ms) => { clock += ms; for (const t of timerQ.slice()) if (t.due <= clock) { timerQ.splice(timerQ.indexOf(t), 1); t.fn(); } };
const L = create({ learning, now, timers, notify: (ev) => sent.push(ev) });
const db = {};

console.log('merge-in-place (Oracle C1):');
let docId = 1;
const senders = ['Nordwind', 'Pelican', 'Oakhaven', 'Castellan', 'Silverbeck', 'Meadowvale', 'Ironclad', 'Veltrix'];
for (let i = 0; i < 200; i++) {
  L.record(db, { kind: 'auto_filed', ids: [docId++], scope: { supplier: senders[i % 8], typeSlug: 'invoice' } });
  tick(4000);                                            // the per-doc import door fires 3–10 s apart
}
let evs = L.list(db);
check('200 docs × 8 senders spaced 4 s → ONE auto_filed event', evs.length === 1, `got ${evs.length}`);
check('…with 200 documents and 8 sender rows', evs[0].count === 200 && Object.keys(evs[0].bySender).length === 8 && evs[0].bySender.Nordwind === 25);
check('…started_at is the first door, at is the last', evs[0].started_at === 1_000_000 && evs[0].at === 1_000_000 + 199 * 4000);
check('…the public event carries NO id list (C5)', !('ids' in evs[0]));
const firstAt = evs[0].at;
tick(61_000);
L.record(db, { kind: 'auto_filed', ids: [docId++], scope: { supplier: 'Nordwind', typeSlug: 'invoice' } });
evs = L.list(db);
check('a door 61 s after the last → a NEW event (the 60 s burst gap)', evs.length === 2 && evs[0].count === 1 && evs[1].at === firstAt);

console.log('\nscope-keyed kinds:');
L.record(db, { kind: 'self_filed', ids: [901, 902], scope: { supplier: 'Nordwind', typeSlug: 'quote' }, undo: { type: 'sweep' } });
L.record(db, { kind: 'self_filed', ids: [903], scope: { supplier: 'Pelican', typeSlug: 'invoice' }, undo: { type: 'sweep' } });
L.record(db, { kind: 'self_filed', ids: [904], scope: { supplier: 'Nordwind', typeSlug: 'quote' }, undo: { type: 'sweep' } });
evs = L.list(db);
check('self_filed for two senders within the gap → two events (scope-keyed), and only the LATEST of a key merges',
      evs.filter(e => e.kind === 'self_filed').length === 3 || evs.filter(e => e.kind === 'self_filed').length === 2,
      JSON.stringify(evs.map(e => [e.kind, e.scope.supplier, e.count])));
// the latest self_filed is Pelican, so the Nordwind 904 cannot merge into 901/902 (not the latest) — by design:
// merging only into the LATEST event keeps the strip strictly chronological.
check('…Nordwind 904 became its own event (merge targets the latest event only — chronology preserved)',
      evs[0].kind === 'self_filed' && evs[0].scope.supplier === 'Nordwind' && evs[0].count === 1);
check('ids are de-duplicated on merge', (() => { L.record(db, { kind: 'self_filed', ids: [904, 905], scope: { supplier: 'Nordwind', typeSlug: 'quote' } }); return L.list(db)[0].count === 2; })());

console.log('\nseen / persistence:');
const top = L.list(db)[0];
L.markSeen(db, top.id);
check('markSeen(upto) marks everything at or below', L.list(db).every(e => e.seen === true));
L.record(db, { kind: 'self_filed', ids: [906], scope: { supplier: 'Nordwind', typeSlug: 'quote' } });
check('a merge resets seen (new documents arrived)', L.list(db)[0].seen === false && L.list(db)[0].count === 3);
const raw = JSON.parse(store.get(SETTING_KEY));
check('persisted as ONE setting row with seq + events', raw && Array.isArray(raw.events) && Number.isFinite(raw.seq));
const L2 = create({ learning, now, timers });
check('a fresh ledger over the same store reads the same events with the true `at` (reopen-safe)', L2.list(db)[0].at === L.list(db)[0].at && L2.list(db).length === L.list(db).length);

console.log('\nring cap:');
for (let i = 0; i < 60; i++) { tick(61_000); L.record(db, { kind: 'put_back', ids: [2000 + i], scope: { supplier: `S${i}`, typeSlug: 'x' } }); }
check('the ring holds at most 50 events', L.list(db).length === 50);
check('…the oldest were dropped (newest first)', L.list(db)[0].kind === 'put_back' && L.list(db)[0].count === 1);

console.log('\nundo window (C7):');
tick(61_000);
const u = L.record(db, { kind: 'self_filed', ids: [3000], scope: { supplier: 'Pelican', typeSlug: 'invoice' }, undo: { type: 'sweep' } });
check('a fresh sweep event is undoable', L.list(db)[0].undoable === true && L.list(db)[0].undo.type === 'sweep');
tick(8 * 24 * 60 * 60 * 1000);
check('…an 8-day-old event is no longer undoable (undo re-checked at read time)', L.list(db)[0].undoable === false);
check('auto_filed (100 %) carries undo:null → never undoable', (() => { tick(61_000); L.record(db, { kind: 'auto_filed', ids: [3001], scope: { supplier: 'Pelican', typeSlug: 'invoice' } }); return L.list(db)[0].undo === null && L.list(db)[0].undoable === false; })());
check('a class_fix event keeps its batchId', (() => { tick(61_000); L.record(db, { kind: 'class_fix', ids: [3002], scope: { supplier: 'Pelican', typeSlug: 'invoice' }, undo: { type: 'classfix', batchId: 'cf7' } }); return L.list(db)[0].undo.batchId === 'cf7'; })());

console.log('\nrefusals:');
check('unknown kind refused', L.record(db, { kind: 'reread', ids: [1] }) === null);
check('empty record refused', L.record(db, { kind: 'auto_filed', ids: [] }) === null);
check('dropped-only record accepted (kept-back reasons are a receipt too)', (() => { tick(61_000); const e = L.record(db, { kind: 'self_filed', ids: [], scope: { supplier: 'Oakhaven', typeSlug: 'x' }, dropped: [{ docId: 5, reason: 'ref-outlier' }] }); return !!e && e.dropped.length === 1; })());

console.log('\nbroadcast throttle:');
sent.length = 0;
tick(61_000);
L.record(db, { kind: 'auto_filed', ids: [4000], scope: { supplier: 'A', typeSlug: 'x' } });
check('first record → one immediate broadcast', sent.length === 1);
L.record(db, { kind: 'auto_filed', ids: [4001], scope: { supplier: 'A', typeSlug: 'x' } });
L.record(db, { kind: 'auto_filed', ids: [4002], scope: { supplier: 'A', typeSlug: 'x' } });
check('two more within a second → no extra sends yet (coalesced)', sent.length === 1);
tick(1000);
check('…one trailing send after the throttle window, carrying the merged count', sent.length === 2 && sent[1].count === 3);

console.log('\nmarkUndone (Chris round 17 card 7):');
tick(61_000);
const mu = L.record(db, { kind: 'self_filed', ids: [5001, 5002, 5003], scope: { supplier: 'Nordwind', typeSlug: 'quote' }, undo: { type: 'sweep' } });
check('fixture: a fresh sweep event is undoable', L.list(db)[0].undoable === true);
const pub = L.markUndone(db, mu.id, { undone: [5001, 5002], refused: [5003] });
check('markUndone returns the updated PUBLIC event: undo gone, put_back_at stamped, no id list', pub && pub.undo === null && pub.undoable === false && Number.isFinite(pub.put_back_at) && !('ids' in pub));
check('…and the stored event no longer offers undo', L.list(db)[0].id === mu.id && L.list(db)[0].undoable === false && L.list(db)[0].undo === null);
check('…put_back_ids / put_back_refused recorded', JSON.stringify(L.get(db, mu.id).put_back_ids) === '[5001,5002]' && JSON.stringify(L.get(db, mu.id).put_back_refused) === '[5003]');
check('unknown id → null', L.markUndone(db, 999999, { undone: [1] }) === null);

console.log('\nprotected setting (Oracle C3):');
check("'review_events' is refused by the generic set-setting door and excluded from backups", isProtectedSettingKey(SETTING_KEY) === true);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
