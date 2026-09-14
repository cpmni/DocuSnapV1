'use strict';
/*
 * test_search_thumbs_queue.js — the shared search UI's thumbnail QUEUE (searchThumbs.js), pinned in a bare
 * Node context (Oracle 2026-09-14 condition 2 on the viewer-speed slice). Every thumbnail is a Python process
 * on the core, so the queue must: keep at most TWO reads in flight; serve the NEWEST queued row first (a fresh
 * scroll / new search jumps rows queued earlier); SKIP a row whose <img> is gone by the time it is dequeued
 * AND forget its cache entry (a re-scroll re-requests — it never inherits a null); dedupe concurrent requests
 * for one document. No IntersectionObserver here → lazy() loads immediately (the module's own fallback).
 *
 *   node src/windows/shared/test_search_thumbs_queue.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const tick = () => new Promise(r => setImmediate(r));

const calls = [];            // docIds the transport was asked for, in order
const pending = new Map();   // docId -> resolve (released by the test)
const transport = {
  getDocumentThumbnail: (id) => new Promise((resolve) => { calls.push(id); pending.set(id, resolve); }),
};
const release = (id) => { const r = pending.get(id); pending.delete(id); if (r) r('data:image/png;base64,' + id); };
const sandbox = { console, setTimeout, Promise };
sandbox.window = { SearchTransport: transport };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'search-ui', 'searchThumbs.js'), 'utf8'), sandbox, { filename: 'searchThumbs.js' });
const Thumbs = sandbox.window.SearchThumbs;
const mkImg = (connected) => ({ isConnected: connected, src: '', classList: { add() {}, remove() {}, toggle() {} } });

(async () => {
  check('searchThumbs.js installed window.SearchThumbs.lazy without an IntersectionObserver', Thumbs && typeof Thumbs.lazy === 'function');

  console.log('at most two in flight; rows gone by dequeue time are skipped and forgotten');
  const imgs = {};
  for (let id = 1; id <= 10; id++) { imgs[id] = mkImg(id >= 9); Thumbs.lazy(imgs[id], { id }); }   // 1..8 already gone, 9..10 visible
  await tick();
  check('10 rows queued, 8 of them disconnected → exactly 2 transport calls (the visible ones)', calls.length === 2 && calls.includes(9) && calls.includes(10));
  check('nothing beyond the two in flight is requested while they are pending', calls.length === 2);
  release(9); release(10); await tick(); await tick();
  imgs[1].isConnected = true; Thumbs.lazy(imgs[1], { id: 1 }); await tick();
  check('a skipped row was FORGOTTEN: re-lazy of row 1 (now visible) requests it (no inherited null)', calls.length === 3 && calls[2] === 1);
  release(1); await tick(); await tick();

  console.log('newest first (LIFO) while the two slots are busy');
  const a = mkImg(true), b = mkImg(true), c = mkImg(true), d = mkImg(true);
  Thumbs.lazy(a, { id: 20 }); Thumbs.lazy(b, { id: 21 }); await tick();          // take both slots
  Thumbs.lazy(c, { id: 22 }); Thumbs.lazy(d, { id: 23 }); await tick();          // queued behind
  check('two in flight (20, 21); 22 and 23 wait', calls.slice(-2).join() === '20,21' && calls.length === 5);
  release(20); await tick(); await tick();
  check('a freed slot serves the NEWEST queued row first (23 before 22)', calls.length === 6 && calls[5] === 23);
  release(21); await tick(); await tick();
  check('…then the older one (22)', calls.length === 7 && calls[6] === 22);
  release(22); release(23); await tick(); await tick();

  console.log('dedupe + a row that vanished while it waited');
  const e1 = mkImg(true), e2 = mkImg(true);
  Thumbs.lazy(e1, { id: 30 }); Thumbs.lazy(e2, { id: 30 }); await tick();
  check('two rows for the same document share ONE request', calls.filter(x => x === 30).length === 1);
  release(30); await tick(); await tick();
  const f = mkImg(true), g = mkImg(true), h = mkImg(true);
  Thumbs.lazy(f, { id: 40 }); Thumbs.lazy(g, { id: 41 }); await tick();          // slots busy
  Thumbs.lazy(h, { id: 42 }); h.isConnected = false;                             // vanishes while queued
  release(40); await tick(); await tick();
  check('a row that vanished while queued is never requested', !calls.includes(42));
  h.isConnected = true; Thumbs.lazy(h, { id: 42 }); await tick();
  check('…and is requested once it is back on screen (its cache entry was cleared)', calls.includes(42));
  release(41); release(42); await tick();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
