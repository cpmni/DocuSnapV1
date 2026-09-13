'use strict';
/*
 * test_search_ui_no_direct_ipc.js — DRIFT GUARD #2 for the shared search UI (client search parity,
 * 2026-09-13; Oracle C4).
 *
 * src/windows/shared/search-ui/ is the ONE canonical search screen driven by BOTH the core Search window
 * and the detached client's search pop-out, through an injected `window.SearchTransport`. The moment a
 * shared file reaches IO directly — `window.docusnap` (core bridge), `window.scanfinder` (client bridge),
 * `ipcRenderer`, or a `require(` — it silently works on ONE app and breaks (or forks) the other, and the
 * mandate ("every core search change replicates to the client automatically") is dead. This pin fails on
 * any such token in any shared file, so a future edit cannot quietly re-hardcode the core bridge.
 *
 * Also pins the adapter contract from the other side: every `window.SearchTransport.<name>` the shared
 * files call must be DEFINED by the core adapter (src/windows/search/coreTransport.js) — a new call in
 * the shared code without an adapter entry would throw at first use on the core.
 *
 * A planted-violation self-test proves the scan bites.
 *
 *   node src/windows/shared/test_search_ui_no_direct_ipc.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const FORBIDDEN = [/window\.docusnap/, /window\.scanfinder/, /\bipcRenderer\b/, /\brequire\(/, /contextBridge/];

function scanDir(dir) {
  const out = [];   // [file, pattern]
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of FORBIDDEN) if (re.test(src)) out.push([f, re.source]);
  }
  return out;
}

// 1 — the real shared module.
const UI = path.join(__dirname, 'search-ui');
const files = fs.readdirSync(UI).filter(f => f.endsWith('.js'));
check(`the shared search-ui module exists with its modules (${files.length} .js files)`, files.length >= 7);
const hits = scanDir(UI);
check('no shared search-ui file reaches IO directly (window.docusnap / window.scanfinder / ipcRenderer / require / contextBridge)'
      + (hits.length ? ` — OFFENDERS: ${hits.map(([f, p]) => `${f}: ${p}`).join('; ')}` : ''),
      hits.length === 0);

// 2 — every transport call the shared files make is defined by the core adapter.
{
  const adapterSrc = fs.readFileSync(path.join(__dirname, '..', 'search', 'coreTransport.js'), 'utf8');
  const defined = new Set([...adapterSrc.matchAll(/^\s{4}([A-Za-z_]\w*):\s/gm)].map(m => m[1]));   // top-level keys of the object
  const called = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(UI, f), 'utf8');
    for (const m of src.matchAll(/window\.SearchTransport\.([A-Za-z_]\w*)/g)) called.add(m[1]);
    for (const m of src.matchAll(/\bT\.([A-Za-z_]\w*)/g)) called.add(m[1]);           // the `const T = window.SearchTransport` alias
  }
  const missing = [...called].filter(n => !defined.has(n));
  check(`every SearchTransport member the shared UI touches is defined by coreTransport.js (${called.size} touched)`
        + (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''),
        missing.length === 0 && called.size >= 20);
  check('the adapter declares caps (the shared UI hides what a transport cannot do)', defined.has('caps') && called.has('caps'));
}

// 3 — self-test: a scratch dir with ONE planted direct-IPC call must be caught.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-noipc-'));
  try {
    fs.writeFileSync(path.join(tmp, 'clean.js'), "'use strict';\nconst x = window.SearchTransport.searchDocuments({});\n");
    fs.writeFileSync(path.join(tmp, 'dirty.js'), "'use strict';\nconst y = window.docusnap.searchDocuments({});\n");
    const planted = scanDir(tmp);
    check('self-test: a planted window.docusnap in a shared file IS caught (and the clean file is not)',
          planted.length === 1 && planted[0][0] === 'dirty.js');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(fails ? `\n${fails} FAILED` : '\nAll shared search-ui no-direct-IPC pins passed');
process.exit(fails ? 1 : 0);
