'use strict';
/**
 * src/lib/reviewEvents.js — the Review ACTIVITY LEDGER (B1 of the activity-strip arc, 2026-08-22;
 * barry + eric → Oracle SIGN-OFF-W/COND C1/C3/C7).
 *
 * WHY: the Review window's top-left tile renders ONE rolling id-set (`recent_auto_filed`) whose
 * timestamp is overwritten on every write — it can only re-total ("20 filed" → "22 filed" ten minutes
 * later reads as "my documents disappeared"). This ledger is the PRESENTATION record of what the app
 * did and when: a ring of ≤CAP events, each {kind, at, started_at, ids, bySender, scope, approved,
 * undo, dropped, seen}. It is NOT the source of truth for anything — the audit log stays the durable
 * record and undo validity is re-checked server-side at click time. Best-effort: every write is
 * wrapped, a broken ledger can never affect filing.
 *
 * MERGE-IN-PLACE (Oracle C1 — the 2 s trailing flush was REFUSED): the customer's unit for an import
 * is THE BATCH, and the per-document import door fires 3–10 s apart. So a record() that arrives while
 * the latest event of the same KEY is younger than `burstGapMs` (60 s, shared with the main window's
 * _AUTOFILE_BURST_GAP_MS) MERGES into it: ids unioned, bySender counts added, `at` advanced,
 * `started_at` kept, `seen` reset (new documents arrived). Keys: `auto_filed` by kind only (a
 * 200-doc / 8-sender import = ONE event with 8 sender rows); every other kind by kind + scope.
 *
 * PERSISTENCE: ONE setting row `review_events` ({seq, events}) — listed in protectedSettings._KEYS
 * (Oracle C3: a restored backup would otherwise resolve FOREIGN document ids). Reopen shows the true
 * `at`. Broadcast via `notify(ev)` throttled to ≤1/s (trailing) so a burst costs one render.
 *
 * UNDO (C7): `undo` = { type: 'sweep' | 'classfix', batchId? } | null. Offered (undoable) only for
 * events ≤ UNDO_WINDOW_MS old — a 3-week-old deconfirm reverses live-derived learning that later
 * confirms built on. The renderer never sends an id list (the C5 ruling): undo and "See them" take the
 * EVENT id and the server resolves ids from ITS ledger.
 *
 * Pure apart from the settings reads/writes; pinned in src/lib/test_review_events.js.
 */

const SETTING_KEY = 'review_events';
const CAP = 50;
const BURST_GAP_MS = 60 * 1000;
const NOTIFY_THROTTLE_MS = 1000;
const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const KINDS = new Set(['auto_filed', 'self_filed', 'approved', 'class_fix', 'put_back']);

function _scopeKey(scope) {
  const s = scope || {};
  return `${String(s.supplier || '').trim().toLowerCase()}|${String(s.typeSlug || '').trim().toLowerCase()}`;
}

function create(deps = {}) {
  const learning = deps.learning || require('../../database/modules/learning');
  const now = deps.now || (() => Date.now());
  const cap = Number.isFinite(deps.cap) ? deps.cap : CAP;
  const burstGapMs = Number.isFinite(deps.burstGapMs) ? deps.burstGapMs
    : (Number(process.env.REVIEW_EVENTS_BURST_GAP_MS) || BURST_GAP_MS);   // env: test override only (the lane's QUIET_REREAD_DEBOUNCE_MS idiom)
  const throttleMs = Number.isFinite(deps.throttleMs) ? deps.throttleMs : NOTIFY_THROTTLE_MS;
  const undoWindowMs = Number.isFinite(deps.undoWindowMs) ? deps.undoWindowMs : UNDO_WINDOW_MS;
  const notify = typeof deps.notify === 'function' ? deps.notify : null;
  const timers = deps.timers || { setTimeout, clearTimeout };

  function _load(db) {
    try {
      const o = JSON.parse(learning.getSetting(db, SETTING_KEY, '') || 'null');
      if (o && Array.isArray(o.events)) return { seq: Number(o.seq) || 0, events: o.events.filter(e => e && e.id) };
    } catch { /* fall through */ }
    return { seq: 0, events: [] };
  }
  function _save(db, state) {
    state.events = state.events.slice(-cap);
    learning.setSetting(db, SETTING_KEY, JSON.stringify({ seq: state.seq, events: state.events }));
  }

  // ── throttled broadcast: first call immediate, later calls within throttleMs coalesce into one trailing send
  let _lastSent = 0, _pending = null, _timer = null;
  function _emit(ev) {
    if (!notify) return;
    const t = now();
    if (t - _lastSent >= throttleMs && !_timer) { _lastSent = t; try { notify(_public(ev)); } catch { /* best-effort */ } return; }
    _pending = ev;
    if (!_timer) {
      _timer = timers.setTimeout(() => {
        _timer = null; _lastSent = now();
        const p = _pending; _pending = null;
        if (p) { try { notify(_public(p)); } catch { /* best-effort */ } }
      }, Math.max(0, throttleMs - (t - _lastSent)));
    }
  }

  function _public(ev) {
    // the renderer never receives the id list (C5): counts + breakdown + the event id only
    const { ids, ...rest } = ev;
    return { ...rest, count: Array.isArray(ids) ? ids.length : 0, undoable: _undoable(ev) };
  }
  function _undoable(ev) {
    return !!(ev && ev.undo && ev.undo.type && (now() - Number(ev.at || 0)) <= undoWindowMs);
  }

  /**
   * record(db, { kind, ids, scope:{supplier,typeSlug}, approved, undo, dropped:[{docId,reason}] })
   * → the (possibly merged) event, or null when the ledger refused (unknown kind / nothing to record).
   */
  function record(db, ev = {}) {
    try {
      const kind = String(ev.kind || '');
      if (!KINDS.has(kind)) return null;
      const ids = [...new Set((Array.isArray(ev.ids) ? ev.ids : []).map(Number).filter(Boolean))];
      const dropped = Array.isArray(ev.dropped) ? ev.dropped.filter(d => d && d.docId).map(d => ({ docId: Number(d.docId), reason: String(d.reason || '') })) : [];
      if (!ids.length && !dropped.length) return null;
      const t = now();
      const state = _load(db);
      const scope = { supplier: String((ev.scope || {}).supplier || '').trim() || null, typeSlug: String((ev.scope || {}).typeSlug || '').trim().toLowerCase() || null };
      // Chris round 17 card 5a: a BULK approval (File All Ready) is keyed by kind like auto_filed — one chip
      // with a per-sender breakdown — while the sweep's "File N" stays scope-keyed (and undoable).
      const key = kind === 'auto_filed' ? 'auto_filed'
        : (kind === 'approved' && ev.bulk) ? 'approved|bulk'
        : `${kind}|${_scopeKey(scope)}`;
      const sender = scope.supplier || '—';
      // Merge into the NEWEST event with the SAME key inside the burst gap — not only the very latest event
      // (Oracle nod, 2026-08-23): a File All confirm triggers the 1.5 s scope auto-accept, whose self_filed
      // event can land MID-loop and would otherwise split one File All into two chips.
      let latest = null;
      for (let i = state.events.length - 1; i >= 0; i--) {
        const e = state.events[i];
        if ((t - Number(e.at || 0)) >= burstGapMs) break;
        if (e.key === key) { latest = e; break; }
      }
      let out;
      if (latest) {
        const have = new Set(latest.ids || []);
        for (const id of ids) have.add(id);
        latest.ids = [...have];
        latest.bySender = latest.bySender || {};
        latest.bySender[sender] = (latest.bySender[sender] || 0) + ids.length;
        latest.dropped = (latest.dropped || []).concat(dropped);
        latest.at = t;
        latest.seen = false;
        if (ev.approved != null) latest.approved = !!ev.approved;
        if (ev.undo && !latest.undo) latest.undo = ev.undo;
        out = latest;
      } else {
        state.seq += 1;
        out = { id: state.seq, key, kind, at: t, started_at: t, ids, bySender: { [sender]: ids.length }, scope,
                approved: !!ev.approved, undo: ev.undo && ev.undo.type ? { type: String(ev.undo.type), ...(ev.undo.batchId ? { batchId: String(ev.undo.batchId) } : {}) } : null,
                dropped, seen: false, ...(ev.bulk ? { bulk: true } : {}) };
        state.events.push(out);
      }
      _save(db, state);
      _emit(out);
      return out;
    } catch { return null; }
  }

  function list(db) {
    try { return _load(db).events.slice().reverse().map(_public); } catch { return []; }
  }
  function get(db, id) {
    try { return _load(db).events.find(e => e.id === Number(id)) || null; } catch { return null; }
  }
  function markSeen(db, uptoId) {
    try {
      const state = _load(db);
      const upto = Number(uptoId) || 0;
      let n = 0;
      for (const e of state.events) if (e.id <= upto && !e.seen) { e.seen = true; n++; }
      if (n) _save(db, state);
      return n;
    } catch { return 0; }
  }

  /**
   * markUndone(db, id, { undone, refused }) — Chris round 17 card 7: after a successful put-back the event
   * must stop offering Put back (a second press said "34 couldn't be (filed another way since)" about
   * documents the user had just put back). Sets `undo = null`, stamps `put_back_at` + `put_back_ids`,
   * saves and emits. Returns the updated PUBLIC event (the caller replaces its copy — the throttled
   * broadcast may drop a third emit inside one second) or null.
   */
  function markUndone(db, id, info = {}) {
    try {
      const state = _load(db);
      const ev = state.events.find(e => e.id === Number(id));
      if (!ev) return null;
      ev.undo = null;
      ev.put_back_at = now();
      ev.put_back_ids = [...new Set((Array.isArray(info.undone) ? info.undone : []).map(Number).filter(Boolean))];
      if (Array.isArray(info.refused) && info.refused.length) ev.put_back_refused = info.refused.map(Number).filter(Boolean);
      _save(db, state);
      _emit(ev);
      return _public(ev);
    } catch { return null; }
  }

  return { record, list, get, markSeen, markUndone, _load, _save, _undoable, SETTING_KEY, CAP: cap, BURST_GAP_MS: burstGapMs, UNDO_WINDOW_MS: undoWindowMs };
}

module.exports = { create, SETTING_KEY, CAP, BURST_GAP_MS, NOTIFY_THROTTLE_MS, UNDO_WINDOW_MS, KINDS };
