'use strict';
/*
 * test_core_transport.js — the core Search window's adapter for the shared search UI is a PURE
 * PASS-THROUGH (Oracle C1, client search parity 2026-09-13).
 *
 * WHY IT MATTERS: the shared module's error branches were written against the raw bridge — a failed
 * findInDocument → _clearMatches(), a missing IPC handler → the "restart to finish" pane, a rejected
 * getDocumentPage → "leave the hole". An adapter that "normalised" a rejection into an empty shape (say
 * `{matches:[]}`) would turn those into DIFFERENT visible states (a `no-match` red box instead of a
 * cleared overlay). So every adapter method must forward its arguments verbatim AND let a rejection
 * reject through. Pinned two ways: the source shape, and a behavioural run against a rejecting stub.
 *
 *   node src/windows/search/test_core_transport.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const src = fs.readFileSync(path.join(__dirname, 'coreTransport.js'), 'utf8');

console.log('1. source shape — every method is `(...a) => d.<same name>(...a)`, no catch/normalisation');
{
  const methods = [...src.matchAll(/^\s{4}([A-Za-z_]\w*):\s+\(\.\.\.a\) => d\.([A-Za-z_]\w*)\(\.\.\.a\),/gm)];
  const mismatched = methods.filter(m => m[1] !== m[2]).map(m => `${m[1]}→${m[2]}`);
  // The full set the shared UI relies on — named, so a dropped one is reported by name (a bare count
  // would let a removal hide behind an addition).
  const REQUIRED = ['searchDocuments', 'getDeletedQueue', 'restoreAllDeleted', 'purgeAllDeleted', 'deleteDocument', 'restoreDocument',
    'purgeDocument', 'repairDeconfirm', 'getDocumentDetail', 'getDocumentPages', 'getDocumentPage', 'getDocumentPageCount', 'getDocumentOutline',
    'findInDocument', 'getSpreadsheetGrid', 'getDocumentThumbnail', 'showDocumentInExplorer', 'openDocumentFile',
    'openReviewWindowAt', 'printDocument', 'printAvailable', 'getAllDocTypes', 'getEntitlement', 'authGetCurrentUser', 'getSetting'];
  const found = new Set(methods.map(m => m[1]));
  const missing = REQUIRED.filter(n => !found.has(n));
  check(`every required pass-through method is present (${found.size} found)` + (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''), missing.length === 0);
  check('each forwards to the SAME-NAMED bridge method' + (mismatched.length ? ` — ${mismatched.join(', ')}` : ''), mismatched.length === 0);
  // S4: the nested stamp.* and workflow.* blocks are pass-throughs too, every member same-named.
  const nested = [...src.matchAll(/^\s{6}([A-Za-z_]\w*):\s+\(\.\.\.a\) => d\.(stamp|workflow)\.([A-Za-z_]\w*)\(\.\.\.a\),/gm)];
  check(`the nested stamp.* / workflow.* members are same-named pass-throughs (${nested.length})`, nested.length >= 19 && nested.every(m => m[1] === m[3]));
  for (const n of ['can', 'types', 'typeCreate', 'place', 'list', 'currentPages', 'grants']) check(`stamp.${n} present`, nested.some(m => m[2] === 'stamp' && m[1] === n));
  for (const n of ['inbox', 'sent', 'assigned', 'completed', 'recipients', 'assign', 'resolve', 'recall', 'adminCancel', 'docRoutes', 'docHistory', 'openStampedViewer']) check(`workflow.${n} present`, nested.some(m => m[2] === 'workflow' && m[1] === n));
  check('onWorkflowCountsChanged subscribes through the bridge', /onWorkflowCountsChanged:\s+\(cb\) => d\.onWorkflowCountsChanged\(cb\)/.test(src));
  check('onBinChanged subscribes through the bridge', /onBinChanged:\s+\(cb\) => d\.onBinChanged\(cb\)/.test(src));
  check('no .catch / try / envelope / default-value normalisation anywhere in the adapter',
        !/\.catch\(/.test(src) && !/\btry\b/.test(src) && !/\?\?/.test(src) && !/\|\| \{/.test(src) && !/\.then\(/.test(src));
  check('every cap is TRUE on the core', /caps:\s*\{[^}]*\}/.test(src) && !/caps:\s*\{[^}]*false/.test(src));
}

console.log('2. behaviour — a rejecting / recording bridge stub');
{
  const calls = [];
  const rej = new Error('No handler registered for get-document-page');
  const stub = new Proxy({}, {
    get(_t, name) {
      if (name === 'stamp') return { can: (...a) => { calls.push(['stamp.can', a]); return Promise.resolve({ canStamp: true }); } };
      if (name === 'onBinChanged') return (cb) => { calls.push(['onBinChanged', typeof cb]); };
      if (name === 'getDocumentPage') return (...a) => { calls.push([name, a]); return Promise.reject(rej); };
      return (...a) => { calls.push([name, a]); return Promise.resolve({ via: name, a }); };
    },
  });
  global.window = { docusnap: stub };
  require(path.join(__dirname, 'coreTransport.js'));
  const T = global.window.SearchTransport;
  check('window.SearchTransport is defined by loading the adapter', !!T && typeof T === 'object');
  check('caps object present with singlePage/find/spreadsheet/bin/sendBack/localFile/review/print/stamps/settings all true',
        ['singlePage', 'pageCount', 'find', 'spreadsheet', 'bin', 'restoreAll', 'sendBack', 'localFile', 'review', 'print', 'stamps', 'settings']
          .every(k => T.caps[k] === true));

  (async () => {
    // exact positional arity is preserved (the preview passes (id, null, null, SCALE) to getDocumentPages)
    await T.getDocumentPages(7, null, null, 3);
    check('getDocumentPages forwards (7, null, null, 3) verbatim', JSON.stringify(calls.find(c => c[0] === 'getDocumentPages')[1]) === '[7,null,null,3]');
    await T.getDocumentThumbnail(9, null, null);
    check('getDocumentThumbnail forwards (9, null, null) verbatim', JSON.stringify(calls.find(c => c[0] === 'getDocumentThumbnail')[1]) === '[9,null,null]');
    await T.repairDeconfirm(5, { source: 'search' });
    check('repairDeconfirm forwards the options object', JSON.stringify(calls.find(c => c[0] === 'repairDeconfirm')[1]) === '[5,{"source":"search"}]');
    // a rejection rejects THROUGH — never swallowed into an empty shape
    let threw = null;
    try { await T.getDocumentPage(7, 0, 3); } catch (e) { threw = e; }
    check('a rejecting bridge call rejects through the adapter with the SAME error', threw === rej);
    const r = await T.stamp.can();
    check('stamp.can passes through the nested bridge', r && r.canStamp === true && calls.some(c => c[0] === 'stamp.can'));
    T.onBinChanged(() => {});
    check('onBinChanged hands the callback to the bridge', calls.some(c => c[0] === 'onBinChanged' && c[1] === 'function'));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })();
}
