'use strict';
// Hermetic tests for the opt-in diagnostics collector (src/modules/telemetry.js).
// Run with Electron-as-Node (better-sqlite3 native ABI):
//   ELECTRON_RUN_AS_NODE=1 npx electron src/modules/test_telemetry.js
const Database = require('better-sqlite3');
const { createTelemetry, shapeEvent, safeValue } = require('./telemetry');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, name TEXT NOT NULL,
    props_json TEXT, event_uid TEXT, sent INTEGER NOT NULL DEFAULT 0)`);
  return db;
}
const count = (db) => db.prepare('SELECT COUNT(*) AS c FROM telemetry_events').get().c;

(async () => {
  // ── shapeEvent / safeValue — the allowlist IS the contract ──────────────────
  ok(shapeEvent('not_an_event', { x: 1 }) === null, 'unknown event → dropped (null)');
  ok(JSON.stringify(shapeEvent('extraction_error',
        { stage: 'stage2_anchor', error_class: 'AttributeError', file: 'anchor.py', line: 412, junk: 'leak' }))
      === JSON.stringify({ stage: 'stage2_anchor', error_class: 'AttributeError', file: 'anchor.py', line: 412 }),
     'extraction_error keeps only allowlisted + valid props (junk dropped)');
  ok(safeValue('error_class', 'failed to parse "Beaumont Care Homes Ltd"') === undefined,
     'a free-text error MESSAGE is dropped (only a type name is valid)');
  ok(safeValue('error_class', 'AttributeError') === 'AttributeError', 'an exception type name is kept');
  ok(safeValue('file', 'C:/Users/me/scans/anchor.py') === undefined, 'a path-shaped file is dropped');
  ok(safeValue('file', 'anchor.py') === 'anchor.py', 'our own source basename is kept');
  ok(safeValue('mode', 'bogus') === undefined && safeValue('mode', 'fast') === 'fast', 'mode is a strict enum');
  ok(safeValue('line', '412') === 412, 'line coerces to int');
  ok(safeValue('error_code', 'EBUSY') === 'EBUSY' && safeValue('error_code', 'whoops') === undefined, 'error_code enum');
  ok(safeValue('os_version', 'Windows_NT 10.0.26200') === 'Windows_NT 10.0.26200', 'os_version string kept');
  ok(safeValue('os_version', '/etc/passwd') === undefined, 'a slashy value is dropped from os_version');

  // ── consent gating: OFF → nothing is ever queued ────────────────────────────
  {
    const db = freshDb();
    let consent = 'false';
    const t = createTelemetry({ db, getSetting: () => consent,
      post: async () => ({ status: 200 }), config: { base_url: 'https://x/v1', product_id: 'p' }, fpHash: 'f'.repeat(64) });
    t.record('app_start', { app_version: '2.0.0' });
    ok(count(db) === 0, 'consent OFF → record() queues nothing');
    consent = 'true'; t.refreshConsent();
    t.record('app_start', { app_version: '2.0.0', arch: 'x64' });
    t.record('not_an_event', { x: 1 });
    ok(count(db) === 1, 'consent ON → known event queued, unknown dropped');
    const row = db.prepare('SELECT props_json FROM telemetry_events').get();
    ok(JSON.parse(row.props_json).app_version === '2.0.0', 'queued props are the validated shape');
  }

  // ── flush: 200 marks sent; non-2xx leaves queued; idempotent ────────────────
  {
    const db = freshDb();
    let status = 503; const posts = [];
    const t = createTelemetry({ db, getSetting: () => 'true',
      post: async (url, body) => { posts.push({ url, body }); return { status }; },
      config: { base_url: 'https://x/v1', product_id: 'p' }, fpHash: 'a'.repeat(64) });
    t.record('app_start', { app_version: '2.0.0' });
    await t.flush();
    ok(posts.length === 1 && posts[0].url.endsWith('/v1/diagnostics'), 'flush POSTs to /v1/diagnostics');
    ok(posts[0].body.fp_hash === 'a'.repeat(64) && Array.isArray(posts[0].body.events), 'body carries fp_hash + events');
    ok(db.prepare('SELECT sent FROM telemetry_events').get().sent === 0, 'non-2xx → row stays unsent (retried later)');
    status = 200;
    await t.flush();
    ok(db.prepare('SELECT sent FROM telemetry_events').get().sent === 1, '2xx → row marked sent');
    await t.flush();
    ok(posts.length === 2, 'a sent row is not re-posted (idempotent)');
  }

  // ── opt-out purges the buffer ───────────────────────────────────────────────
  {
    const db = freshDb();
    let consent = 'true';
    const t = createTelemetry({ db, getSetting: () => consent,
      post: async () => ({ status: 200 }), config: { base_url: 'https://x/v1', product_id: 'p' }, fpHash: 'b'.repeat(64) });
    t.record('app_start', { app_version: '2.0.0' });
    ok(count(db) === 1, 'queued one event');
    consent = 'false'; t.refreshConsent();
    ok(count(db) === 0, 'opt-out (refreshConsent off) PURGES the buffer');
  }

  // ── flush is a no-op when off (never transmits) ─────────────────────────────
  {
    const db = freshDb();
    const posts = [];
    const t = createTelemetry({ db, getSetting: () => 'false',
      post: async (u, b) => { posts.push(b); return { status: 200 }; },
      config: { base_url: 'https://x/v1', product_id: 'p' }, fpHash: 'c'.repeat(64) });
    await t.flush();
    ok(posts.length === 0, 'flush while OFF never posts');
  }

  console.log(`\ntelemetry: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
