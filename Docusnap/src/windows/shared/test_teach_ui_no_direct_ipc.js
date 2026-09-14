'use strict';
/*
 * test_teach_ui_no_direct_ipc.js — DRIFT GUARD for the shared teach UI (teach-over-client parity,
 * 2026-09-14; Oracle SIGN-OFF-W/COND — the search-ui S0 precedent applied to teach).
 *
 * src/windows/shared/teach-ui/ is the ONE canonical teach wizard, driven by BOTH the core Teach window and
 * (S1+) the detached client's teach pop-out, through an injected `window.TeachTransport` (data) +
 * `window.TeachHost` (window/navigation chrome). The moment a shared file reaches IO directly —
 * `window.docusnap` (core bridge), `window.scanfinder` (client bridge), `ipcRenderer`, or a `require(` — it
 * silently works on ONE app and breaks (or forks) the other, and the mandate ("every core teach change
 * replicates to the client automatically") is dead. This pin fails on any such token in any shared file
 * (comments included), so a future edit cannot quietly re-hardcode the core bridge.
 *
 * It also pins the adapter contract from the other side: every `window.TeachTransport.<name>` / `D.<name>`
 * the shared files call must be DEFINED by the core transport adapter (src/windows/teach/coreTeachTransport.js),
 * and every `window.TeachHost.<name>` / `HOST.<name>` by the core host adapter (coreTeachHost.js) — a new call
 * in the shared code without an adapter entry would throw at first use on the core.
 *
 * A planted-violation self-test proves the scan bites.
 *
 *   node src/windows/shared/test_teach_ui_no_direct_ipc.js
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
    if (!/\.(js|css|html)$/.test(f) || /^test_/.test(f)) continue;   // the pins themselves name the tokens
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of FORBIDDEN) if (re.test(src)) out.push([f, re.source]);
  }
  return out;
}

// 1 — the real shared module.
const UI = path.join(__dirname, 'teach-ui');
const files = fs.readdirSync(UI).filter(f => f.endsWith('.js') && !/^test_/.test(f));
check(`the shared teach-ui module exists (${files.length} .js file${files.length === 1 ? '' : 's'})`, files.length >= 1);
const hits = scanDir(UI);
check('no shared teach-ui file reaches IO directly (window.docusnap / window.scanfinder / ipcRenderer / require / contextBridge)'
      + (hits.length ? ` — OFFENDERS: ${hits.map(([f, p]) => `${f}: ${p}`).join('; ')}` : ''),
      hits.length === 0);

// helper: top-level object keys of an adapter (4-space indent, `name:`)
function adapterKeys(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'teach', rel), 'utf8');
  return new Set([...src.matchAll(/^\s{4}([A-Za-z_]\w*):\s/gm)].map(m => m[1]));
}
// helper: members called on an alias / global across the shared files
function calledMembers(reAlias, reGlobal) {
  const called = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(UI, f), 'utf8');
    for (const m of src.matchAll(reGlobal)) called.add(m[1]);
    for (const m of src.matchAll(reAlias)) called.add(m[1]);
  }
  return called;
}

// 2 — every TeachTransport call the shared files make is defined by the core transport adapter.
{
  const defined = adapterKeys('coreTeachTransport.js');
  const called = calledMembers(/\bD\.([A-Za-z_]\w*)/g, /window\.TeachTransport\.([A-Za-z_]\w*)/g);
  const missing = [...called].filter(n => !defined.has(n));
  check(`every TeachTransport member the shared UI touches is defined by coreTeachTransport.js (${called.size} touched)`
        + (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''),
        missing.length === 0 && called.size >= 15);
  check('the transport adapter declares caps (the shared UI hides what a transport cannot do)', defined.has('caps'));
}

// 3 — every TeachHost call the shared files make is defined by the core host adapter.
{
  const defined = adapterKeys('coreTeachHost.js');
  const called = calledMembers(/\bHOST\.([A-Za-z_]\w*)/g, /window\.TeachHost\.([A-Za-z_]\w*)/g);
  const missing = [...called].filter(n => !defined.has(n));
  check(`every TeachHost member the shared UI touches is defined by coreTeachHost.js (${called.size} touched)`
        + (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''),
        missing.length === 0 && called.size >= 3);
}

// 4 — self-test: a scratch dir with ONE planted direct-IPC call must be caught.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teach-noipc-'));
  try {
    fs.writeFileSync(path.join(tmp, 'clean.js'), "'use strict';\nconst x = window.TeachTransport.getReviewQueue();\n");
    fs.writeFileSync(path.join(tmp, 'dirty.js'), "'use strict';\nconst y = window.docusnap.getReviewQueue();\n");
    const planted = scanDir(tmp);
    check('self-test: a planted window.docusnap in a shared file IS caught (and the clean file is not)',
          planted.length === 1 && planted[0][0] === 'dirty.js');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(fails ? `\n${fails} FAILED` : '\nAll shared teach-ui no-direct-IPC pins passed');
process.exit(fails ? 1 : 0);
