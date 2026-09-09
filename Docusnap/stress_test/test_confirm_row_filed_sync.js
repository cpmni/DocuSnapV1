'use strict';
/*
 * test_confirm_row_filed_sync.js (2026-09-09) — pins the manual-confirm → import-row-flip wiring
 * (Chris vet item B, open since 2026-09-03). The main window's import result rows flipped to "Filed"
 * ONLY on the auto-file broadcast (doc-auto-filed); a MANUAL confirm fired only a bare count
 * (review-count-changed), so the row stayed stuck on "Confirm to file →". The fix mirrors the auto-file
 * wiring for a manual confirm: confirm-review emits a per-doc 'doc-confirmed' event → preload bridge →
 * main/renderer markRowFiled(docId,{manual:true}) labels it plain "Filed" (vs "Filed (auto)"). A refactor
 * that drops the broadcast or the listener re-breaks the flip and this catches it.
 *
 *   node stress_test/test_confirm_row_filed_sync.js
 */
const fs = require('fs');
const path = require('path');
const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const handler = R('src', 'modules', 'review', 'handler.js');
const preload = R('src', 'preload.js');
const mainR   = R('src', 'windows', 'main', 'renderer.js');

// (1) confirm-review emits a per-doc 'doc-confirmed' on SUCCESS only (after the !r.ok early return, just
//     before `return r`) — a refused/failed confirm returns above and must not fire it.
check("confirm-review emits notifyMainWindow('doc-confirmed', { docId: payload.document_id }) right before `return r`",
      /notifyMainWindow\('doc-confirmed', \{ docId: payload\.document_id \}\);\s*\n\s*return r;/.test(handler));

// (2) preload bridges the 'doc-confirmed' channel as onDocConfirmed
check("preload exposes onDocConfirmed on the 'doc-confirmed' channel",
      /onDocConfirmed:\s*\(cb\) => ipcRenderer\.on\('doc-confirmed',\s*\(_e, info\) => cb\(info\)\)/.test(preload));

// (3) main renderer wires onDocConfirmed → markRowFiled(...,{manual:true}), and markRowFiled labels a
//     manual confirm "Filed" while auto-file keeps "Filed (auto)".
check('main renderer wires onDocConfirmed → markRowFiled(info.docId, { manual: true })',
      /onDocConfirmed\?\.\(\(info\) => \{[\s\S]{0,160}markRowFiled\(info\.docId, \{ manual: true \}\)/.test(mainR));
check('markRowFiled(docId, opts) labels a manual confirm "Filed" (auto-file stays "Filed (auto)")',
      /function markRowFiled\(docId, opts = \{\}\)/.test(mainR)
      && /const label = opts\.manual \? 'Filed' : 'Filed \(auto\)';/.test(mainR));

console.log(fails ? `\n${fails} FAILED` : '\nAll confirm-row-filed-sync pins passed');
process.exit(fails ? 1 : 0);
