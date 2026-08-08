'use strict';
/*
 * test_preview_error_state.js — pins the eternal-spinner fix so it can't silently regress.
 *
 * THE BUG: selectDoc() drew a spinner then ran two BARE awaits (getDocumentDetail then
 * getDocumentPages). Any rejection — a missing IPC handler after a stale-main update, a DB
 * hiccup, the doc deleted mid-click — left the spinner spinning forever with zero feedback.
 * The two mailbox/workflow pre-fetches had the same unguarded shape (row highlights, nothing
 * loads). This source-scan pin (the window's convention, cf. test_no_global_collisions.js)
 * asserts the guards are present so the silent-failure class can't come back.
 *
 *   node src/windows/search/test_preview_error_state.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const preview  = read('search-preview.js');
const mailbox  = read('search-mailbox.js');
const workflow = read('search-workflow.js');

// selectDoc must wrap its fetch sequence and render an honest error, not leave the spinner.
check('selectDoc wraps the fetch in try/catch', /async function selectDoc[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/.test(preview));
check('a load-error renderer exists', /function _showPreviewLoadError/.test(preview));
check('the error state renders the .pv-load-error node (not a spinner)',
      /_showPreviewLoadError[\s\S]*?pv-load-error/.test(preview) && /catch\s*\([\s\S]*?_showPreviewLoadError/.test(preview));
check('the stale-main "No handler registered" class is detected', /No handler registered/i.test(preview));
check('a retry control re-runs selectDoc', /pe-retry[\s\S]*?selectDoc\(doc\)/.test(preview));

// Stale-selection guard: a newer click must not be clobbered by an older fetch resolving late.
check('selectDoc captures a selection token and bails when stale',
      /const mine = doc/.test(preview) && (preview.match(/s\.selectedDoc !== mine/g) || []).length >= 2);

// The mailbox + workflow pre-fetches must be gone (they were unguarded double-fetches).
check('mailbox row click no longer pre-fetches detail (routes through guarded selectDoc)',
      !/getDocumentDetail\(r\.document_id\)/.test(mailbox) && /selectDoc\(\{\s*id:\s*r\.document_id\s*\}\)/.test(mailbox));
check('workflow resubmit no longer pre-fetches detail (routes through guarded selectDoc)',
      !/getDocumentDetail\(route\.document_id\)/.test(workflow) && /selectDoc\(\{\s*id:\s*route\.document_id\s*\}\)/.test(workflow));

console.log(fails ? `\n${fails} FAILED` : '\nAll preview error-state pins passed');
process.exit(fails ? 1 : 0);
