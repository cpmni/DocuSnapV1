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
const previewSvc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'previewService.js'), 'utf8');

// selectDoc must wrap its fetch sequence and render an honest error, not leave the spinner.
check('selectDoc wraps the fetch in try/catch', /async function selectDoc[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/.test(preview));
check('a load-error renderer exists', /function _showPreviewLoadError/.test(preview));
check('the error state renders the .pv-load-error node (not a spinner)',
      /_showPreviewLoadError[\s\S]*?pv-load-error/.test(preview) && /catch\s*\([\s\S]*?_showPreviewLoadError/.test(preview));
check('the stale-main "No handler registered" class is detected', /No handler registered/i.test(preview));
check('a retry control re-runs selectDoc', /pe-retry[\s\S]*?selectDoc\(doc\)/.test(preview));

// Stale-selection guard: a newer click must not be clobbered by an older fetch resolving late.
check('selectDoc captures a selection token and bails when stale',
      /\blet mine = doc/.test(preview) && (preview.match(/s\.selectedDoc !== mine/g) || []).length >= 2);
// Chris r2 vet item A: a mailbox/workflow caller hands selectDoc a BARE {id}; the fields, actions and
// stamp sub-renders must ALL get the MERGED doc (doc + fetched detail), else the status chip → "Unknown"
// and the subtitle → "Document —".
check('selectDoc feeds the MERGED doc to fields + actions + stamp (never the bare doc)',
      /const merged = \{ \.\.\.doc, \.\.\.\(full \|\| \{\}\) \};/.test(preview)
      && /renderPreviewFields\(merged\)/.test(preview)
      && /renderActions\(merged\)/.test(preview)
      && /onDocShown\(merged\)/.test(preview)
      && !/renderActions\(doc\)/.test(preview) && !/onDocShown\(doc\)/.test(preview));
check('the merge upgrades the stale-guard token in lockstep (mine = merged)',
      /s\.selectedDoc = merged;[\s\S]{0,120}mine = merged;/.test(preview));
check('previewService.getDocumentDetail resolves type_name so the detail DTO carries it (fixes "Type —")',
      /SELECT slug, name FROM document_types WHERE id = \?/.test(previewSvc) && /doc\.type_name = typeName/.test(previewSvc));

// The mailbox + workflow pre-fetches must be gone (they were unguarded double-fetches).
check('mailbox row click no longer pre-fetches detail (routes through guarded selectDoc)',
      !/getDocumentDetail\(r\.document_id\)/.test(mailbox) && /selectDoc\(\{\s*id:\s*r\.document_id\s*\}\)/.test(mailbox));
check('workflow resubmit no longer pre-fetches detail (routes through guarded selectDoc)',
      !/getDocumentDetail\(route\.document_id\)/.test(workflow) && /selectDoc\(\{\s*id:\s*route\.document_id\s*\}\)/.test(workflow));

console.log(fails ? `\n${fails} FAILED` : '\nAll preview error-state pins passed');
process.exit(fails ? 1 : 0);
