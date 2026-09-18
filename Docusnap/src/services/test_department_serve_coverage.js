'use strict';
/**
 * test_department_serve_coverage.js — the DURABLE regression lock (2026-09-18; gary + eric → Oracle #5).
 * The department leak class is "a by-id serve/mutate path that forgot the gate" (that is how reprocess-document,
 * split-pdf, the /v1 mutations and the desktop confirm slipped through). This pin:
 *   (1) LOCKS every known by-id serve/mutate handler + /v1 route to a sanctioned gate token — a regression that
 *       removes a gate turns this RED;
 *   (2) TRIPWIRES new /v1 by-id routes (a count assertion) so a future endpoint cannot be added ungated silently.
 * It complements test_department_serve_hardening.js (runtime denial proof) with a static coverage proof.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_serve_coverage.js
 *
 * ── AUDIT DEBT (Oracle #5: "verify the batch/bulk paths"): the following IPC handlers also touch a document by
 *    id but are NOT in the lock below, each with the reason they are believed safe OR the note that they are OWED
 *    a per-handler verification BEFORE the departments_enabled flip. Do not treat this list as certified —
 *    MUST-AUDIT items are owed:
 *      gated-in-service : open-document-file, show-document-in-explorer (via _openResolvedDoc → canAccessDocument);
 *                         set-document-department(s) (via departmentService.setDocumentDepartments → canAccessDocument)
 *      viewer-scoped    : get-stuck-docs, get-autofiled-grid, get-review-event-docs, sweep-scope-candidates,
 *                         sweep-queue-candidates (list readers that thread a viewer / visibleDocSql)
 *      DARK (off)       : reextract-fields-fast, sweep-scope-accept, sweep-scope-undo
 *      admin-only       : purge-document, restore-all-deleted (verify the role gate)
 *      MUST-AUDIT ⚠     : reprocess-batch, reprocess-autocommit-accept, batch-audit-correct, batch-audit-send-back,
 *                         accept-name-value, accept-issuer, accept-field-chars, resolve-issuer, find-issuer-siblings,
 *                         class-fix-resolve-ask, acknowledge-review, get-staged-teach-thumbnail
 *    (Full plan: the 2026-09-18 night handover "NEEDS YOUR APPROVAL".)
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

const GATE = /canAccessDocument|_assertDocAccess|_assertDeletedDocAccess|_gateDoc|_gateMutate|departmentVisibility|\.decision\(/;
const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

// Split a handler source into { name -> full block } (block = from one ipcMain.handle( to the next — variable
// length, so a long handler is never truncated).
function ipcBlocks(src) {
  const parts = src.split(/ipcMain\.handle\(/);
  const map = {};
  for (let i = 1; i < parts.length; i++) {
    const nm = (parts[i].match(/^\s*['"]([a-z0-9-]+)['"]/i) || [])[1];
    if (nm && !map[nm]) map[nm] = parts[i];
  }
  return map;
}

console.log('§1 desktop IPC — every known by-id SERVE/MUTATE handler references a gate token (the lock)');
{
  const proc = ipcBlocks(read('../modules/processing/handler.js'));
  const rev  = ipcBlocks(read('../modules/review/handler.js'));
  const MUST_GATE = {
    'reprocess-document': proc, 'split-pdf': proc,
    'sweep-inview-file': proc, 'sweep-inview-recheck': proc, 'sweep-inview-hold': proc,
    'get-document-with-extractions': rev, 'get-document-detail': rev, 'get-document-pages': rev,
    'get-document-page': rev, 'get-document-page-count': rev, 'get-document-page-info': rev,
    'get-document-outline': rev, 'get-document-thumbnail': rev, 'get-enhanced-preview': rev,
    'find-in-document': rev, 'get-spreadsheet-grid': rev, 'get-document-departments': rev,
    'defer-document': rev, 'restore-deferred': rev, 'delete-document': rev, 'restore-document': rev,
    'confirm-review': rev,
  };
  for (const [name, tbl] of Object.entries(MUST_GATE)) {
    const block = tbl[name];
    check(`${name}: present AND references a gate token`, !!block && GATE.test(block));
  }
}

console.log('§2 gated-one-level-down (helper / service) still carries the token');
{
  const proc = read('../modules/processing/handler.js');
  const dsvc = read('./departmentService.js');
  // open-document-file / show-document-in-explorer route through _openResolvedDoc.
  check('_openResolvedDoc (open/show-in-explorer) gates on canAccessDocument',
    /_openResolvedDoc\s*=\s*\([^)]*\)\s*=>/.test(proc) && /canAccessDocument/.test(proc.slice(proc.indexOf('_openResolvedDoc ='), proc.indexOf('_openResolvedDoc =') + 1600)));
  // set-document-department(s) route through departmentService.setDocumentDepartments.
  check('departmentService.setDocumentDepartments gates on canAccessDocument',
    /function setDocumentDepartments/.test(dsvc) && GATE.test(dsvc.slice(dsvc.indexOf('function setDocumentDepartments'), dsvc.indexOf('function setDocumentDepartments') + 400)));
}

console.log('§3 /v1 — every by-id document/review ROUTE references a gate token + the count tripwire');
{
  const api = read('../modules/api/handler.js');
  // Enumerate the by-id route regexes: `${API_PREFIX}/documents/(\\d+)/<verb>` and `/review/(\\d+)/<verb>`.
  const routeRe = /(documents|review)\/\(\\\\d\+\)\/([a-z-]+|:?\w+)?/g;   // matches the regex-literal form in source
  // Simpler + robust: find each `pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/VERB$`))` occurrence.
  const byId = [...api.matchAll(/\^\$\{API_PREFIX\}\/(documents|review)\/\(\\\\d\+\)\/([a-zA-Z-]+)\$/g)]
    .map(m => `${m[1]}/${m[2]}`);
  const unique = [...new Set(byId)];
  // The verbs that SERVE or MUTATE a specific doc (must be gated). Excluded, with reason:
  //   documents/purge          — admin-only (admins are exempt; no dept leak)
  //   documents/ocr-region(-boxes) / ocr-page-words / page-deskew — the OCR/teach reads take a CLIENT-SUPPLIED
  //     imageBase64 in the body (verified src ~:816); NO doc file is resolved server-side, the docId is only for
  //     the audit, and the image could only have come from the already-gated /v1/page. Not a doc-content leak.
  //   review/release           — returns {ok:true} only (no data); presence cleanup.
  const MUST = new Set([
    'documents/pages', 'documents/thumbnail', 'documents/page-info', 'documents/outline', 'documents/page-count',
    'documents/find', 'documents/spreadsheet', 'documents/confirm', 'documents/defer', 'documents/undefer',
    'documents/delete', 'documents/restore', 'review/viewing',
  ]);
  for (const r of unique) {
    if (!MUST.has(r)) continue;
    // Find the route block: from its regex to the next `pathname.match` (bounded).
    const verb = r.split('/')[1];
    const at = api.indexOf(`/(\\\\d+)/${verb}$`);
    const block = at >= 0 ? api.slice(at, at + 1400) : '';
    check(`/v1 ${r}: route references a gate token`, GATE.test(block));
  }
  // Count tripwire: the set of by-id document/review routes must equal the audited snapshot. A NEW by-id route
  // (added ungated) grows this set → RED → the author must gate it + update the snapshot (Oracle #5 "new endpoint").
  const SNAPSHOT = [
    'documents/page-info', 'documents/pages', 'documents/thumbnail', 'documents/outline',
    'documents/page-count', 'documents/find', 'documents/spreadsheet', 'documents/confirm', 'documents/defer',
    'documents/undefer', 'documents/delete', 'documents/restore', 'documents/purge', 'review/viewing', 'review/release',
    // the teach-over-client OCR/geometry reads (client-supplied image; see MUST comment) — not gated by design
    'documents/ocr-region', 'documents/ocr-region-boxes', 'documents/ocr-page-words', 'documents/page-deskew',
  ].sort();
  const live = unique.sort();
  const added = live.filter(r => !SNAPSHOT.includes(r));
  const removed = SNAPSHOT.filter(r => !live.includes(r));
  check(`/v1 by-id route set matches the audited snapshot (added=${JSON.stringify(added)} removed=${JSON.stringify(removed)})`,
    added.length === 0 && removed.length === 0);
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
