'use strict';
// ─────────────────────────────────────────────────────────────────────────────────
// Opt-in, DOCUMENT-DATA-FREE diagnostics collector.  See DIAGNOSTICS_PLAN.md.
//
// HARD, NON-NEGOTIABLE RULES (the allowlist below IS the contract):
//   • OFF by default. Nothing is queued or sent unless the `telemetry_enabled`
//     setting is exactly 'true'. Opt-out PURGES the buffer.
//   • Only the ENUMERATED event names in EVENTS may be recorded; only their listed
//     prop keys are kept; every value must pass its strict per-key validator or it
//     is DROPPED. There is NO free-form text field anywhere — so no document/field
//     value, name, reference, path or OCR text can ever ride along, even by accident.
//   • Best-effort: record()/flush() swallow every error and NEVER throw into a
//     caller, NEVER block processing or the UI, and do no network in record().
// ─────────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const CONTRACT  = '1.0';
const MAX_ROWS  = 5000;   // hard cap on the offline buffer (oldest sent → oldest unsent evicted)
const BATCH     = 100;    // events per flush POST
const RETAIN_D  = 14;     // days to keep already-sent rows before pruning

// ── The event allowlist. event name → the ONLY prop keys it may carry. ────────────
const EVENTS = {
  app_start:           ['app_version', 'build_rev', 'os_version', 'electron_version', 'arch'],
  app_exit:            [],
  main_crash:          ['error_class', 'file', 'line'],
  renderer_crash:      ['reason', 'window', 'exit_code', 'file', 'line'],
  unhandled_error:     ['error_class', 'file', 'line'],
  python_exit:         ['exit_code', 'stage'],
  extraction_error:    ['stage', 'error_class', 'file', 'line'],
  ocr_error:           ['error_class', 'file', 'line'],
  render_error:        ['error_class', 'file', 'line'],
  filing_error:        ['error_class', 'file', 'line'],
  drain_failure:       ['error_code'],
  migration_failure:   ['migration_version'],
  dependency_missing:  ['name'],
  processing_mode_used:['mode'],
};

// ── Strict per-key validators. A value that doesn't match is DROPPED (returns
//    undefined). These are deliberately tight: identifiers, our own source-file
//    basenames, small enums, integers and short version strings ONLY. ─────────────
const asInt   = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : undefined; };
const VALIDATORS = {
  // platform / build — short version-ish strings (letters/digits/space/.-_), no slashes
  app_version:       (s) => /^[A-Za-z0-9_.\- ]{1,48}$/.test(s) ? s : undefined,
  build_rev:         (s) => /^[A-Za-z0-9_.\- ]{1,48}$/.test(s) ? s : undefined,
  os_version:        (s) => /^[A-Za-z0-9_.\- ]{1,48}$/.test(s) ? s : undefined,
  electron_version:  (s) => /^[A-Za-z0-9_.\- ]{1,48}$/.test(s) ? s : undefined,
  arch:              (s) => /^[a-z0-9_]{1,12}$/.test(s) ? s : undefined,
  // an exception TYPE name (never a message)
  error_class:       (s) => /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(s) ? s : undefined,
  // OUR OWN source-file basename only (no directory, no path)
  file:              (s) => /^[A-Za-z0-9_]{1,40}\.(js|py|ts|html)$/.test(s) ? s : undefined,
  line:              asInt, exit_code: asInt, migration_version: asInt,
  // pipeline stage / dependency / Electron crash reason — small lowercase tokens
  stage:             (s) => /^[a-z0-9_]{1,32}$/.test(s) ? s : undefined,
  name:              (s) => /^[a-z0-9_\-]{1,32}$/.test(s) ? s : undefined,
  reason:            (s) => /^[a-z\-]{1,24}$/.test(s) ? s : undefined,
  // fixed enums
  mode:              (s) => (s === 'fast' || s === 'smart') ? s : undefined,
  error_code:        (s) => /^[A-Z]{2,16}$/.test(s) ? s : undefined,
};

function safeValue(key, v) {
  if (v == null) return undefined;
  const f = VALIDATORS[key];
  if (!f) return undefined;                 // key not in any allowlist → never sent
  return f(String(v));
}

// Reduce a {name, props} to ONLY its allowlisted, validated props. Unknown event
// names and unknown/invalid props are silently dropped. Returns null to drop entirely.
function shapeEvent(name, props) {
  const allowed = EVENTS[name];
  if (!allowed) return null;
  const clean = {};
  for (const k of allowed) {
    const sv = safeValue(k, props ? props[k] : undefined);
    if (sv !== undefined) clean[k] = sv;
  }
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// createTelemetry — dependency-injected so it is hermetically testable.
//   db        : better-sqlite3 handle (synchronous)
//   getSetting: (db, key) => string|null    (learning.getSetting)
//   post      : async (url, bodyObj) => { status, body }   (the HTTPS transport)
//   config    : { base_url, product_id }    (from config/license.json)
//   fpHash    : the pseudonymous device id (computeFpHash result)
//   appInfo   : { app_version, build_rev, os_version, electron_version, arch }
//   logger    : optional { warn }
// ─────────────────────────────────────────────────────────────────────────────────
function createTelemetry({ db, getSetting, post, config, fpHash, appInfo = {}, logger } = {}) {
  let consent = null;   // cached: null = unknown, then boolean

  function enabled() {
    if (consent === null) {
      try { consent = getSetting(db, 'telemetry_enabled') === 'true'; }
      catch { consent = false; }
    }
    return consent;
  }

  // Call after the setting changes. Opt-out (now off) PURGES the buffer.
  function refreshConsent() {
    consent = null;
    if (!enabled()) purge();
  }

  function purge() {
    try { db.prepare('DELETE FROM telemetry_events').run(); } catch (e) { logger?.warn?.('telemetry purge: ' + e.message); }
  }

  function record(name, props) {
    try {
      if (!enabled()) return;                 // OFF → nothing is ever queued
      const clean = shapeEvent(name, props);
      if (!clean) return;                     // unknown event → drop
      const uid = crypto.randomBytes(8).toString('hex');
      const ts  = new Date(); ts.setMinutes(0, 0, 0);   // coarse to the hour (no workflow fingerprint)
      db.prepare('INSERT INTO telemetry_events (ts, name, props_json, event_uid, sent) VALUES (?,?,?,?,0)')
        .run(ts.toISOString(), name, JSON.stringify(clean), uid);
      // bounded buffer: evict oldest already-sent first, then oldest unsent
      const n = db.prepare('SELECT COUNT(*) AS c FROM telemetry_events').get().c;
      if (n > MAX_ROWS) {
        db.prepare('DELETE FROM telemetry_events WHERE id IN (SELECT id FROM telemetry_events ORDER BY sent DESC, id ASC LIMIT ?)')
          .run(n - MAX_ROWS);
      }
    } catch (e) { logger?.warn?.('telemetry record: ' + e.message); }
  }

  // Convenience: app_start with the platform/build facts already attached.
  function recordAppStart(extra) { record('app_start', Object.assign({}, appInfo, extra)); }

  async function flush() {
    try {
      if (!enabled()) return;
      if (typeof post !== 'function' || !config || !config.base_url) return;
      const rows = db.prepare('SELECT id, ts, name, props_json, event_uid FROM telemetry_events WHERE sent=0 ORDER BY id LIMIT ?').all(BATCH);
      if (!rows.length) return;
      const events = rows.map(r => ({ ts: r.ts, name: r.name, props: JSON.parse(r.props_json || '{}'), event_uid: r.event_uid }));
      const body = { product_id: config.product_id, fp_hash: fpHash, contract: CONTRACT, events };
      const res = await post(config.base_url.replace(/\/$/, '') + '/diagnostics', body);
      if (res && res.status >= 200 && res.status < 300) {
        const upd = db.prepare('UPDATE telemetry_events SET sent=1 WHERE id=?');
        db.transaction((ids) => ids.forEach((id) => upd.run(id)))(rows.map(r => r.id));
        try { db.prepare("DELETE FROM telemetry_events WHERE sent=1 AND ts < datetime('now', ?)").run('-' + RETAIN_D + ' days'); } catch {}
      }
      // anything but 2xx → leave queued, retry next flush
    } catch (e) { logger?.warn?.('telemetry flush: ' + e.message); }
  }

  // Read-only: what's currently QUEUED (for the "see exactly what's sent" view).
  function queued() {
    try {
      return db.prepare('SELECT ts, name, props_json AS props, sent FROM telemetry_events ORDER BY id DESC LIMIT 200')
        .all().map(r => ({ ts: r.ts, name: r.name, props: JSON.parse(r.props || '{}'), sent: !!r.sent }));
    } catch { return []; }
  }

  return { record, recordAppStart, flush, purge, refreshConsent, enabled, queued,
           // exposed for tests / the "what's sent" UI
           shapeEvent, safeValue, EVENTS, CONTRACT };
}

module.exports = { createTelemetry, shapeEvent, safeValue, EVENTS, CONTRACT, MAX_ROWS, BATCH };
