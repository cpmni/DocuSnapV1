'use strict';
/*
 * test_search_detail_depathed.js — the Document-detail DTO follow-up (Oracle C3 on the
 * de-pathing slice). THE HOLE THIS CLOSES: the search ROW surface was de-pathed, but every
 * row CLICK fetched get-document-with-extractions (getById SELECT *) — shipping the selected
 * doc's stored/working/folder paths and full ocr_text into the search renderer anyway.
 *
 * Now: Search/mailbox/resubmit fetch the PROJECTED get-document-detail (the /v1 trust-
 * boundary shape, dto.projectDocumentDetail, reused verbatim so desktop and wire cannot
 * drift), and the FULL read is Review-only (admin/edit — Review consumes folder_path +
 * ocr_text BY DESIGN; Oracle's caller-aware warning).
 *
 *   node src/windows/search/test_search_detail_depathed.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// 1 — no search-window script may call the FULL read (source pin over the window's scripts). The set
// spans the window's OWN scripts AND the shared search-ui module it loads (../shared/search-ui/*.js —
// since the 2026-09-13 extraction; a `/`-less filter alone would leave those unscanned = a vacuous
// green, the Oracle's seam 2). The common shared scripts (theme/helpmode/dialogFocus) are out of scope.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1])
  .filter(f => !f.includes('/') || f.includes('/search-ui/'));
const offenders = scripts.filter(f => {
  try { return fs.readFileSync(path.join(__dirname, f), 'utf8').includes('getDocumentWithExtractions'); }
  catch { return false; }
});
check(`the scanned set includes the shared search-ui module (${scripts.filter(f => f.includes('/search-ui/')).length} files)`,
      scripts.some(f => f.includes('/search-ui/')));
check(`no search-window or shared search-ui script calls getDocumentWithExtractions (checked ${scripts.length})`
      + (offenders.length ? ` — OFFENDERS: ${offenders.join(', ')}` : ''),
      offenders.length === 0);
// The shared preview reaches the detail ONLY via the transport, and the core adapter maps THAT to the
// PROJECTED getDocumentDetail bridge call (a positive assertion — the shared module never names the
// bridge, so without this the pin could not tell a projected read from a full one on the core).
const sharedPreview = fs.readFileSync(path.join(__dirname, '..', 'shared', 'search-ui', 'searchPreview.js'), 'utf8');
const adapter = fs.readFileSync(path.join(__dirname, 'coreTransport.js'), 'utf8');
check('the shared preview fetches the selected doc through SearchTransport.getDocumentDetail',
      /window\.SearchTransport\.getDocumentDetail\(doc\.id\)/.test(sharedPreview) && !/window\.docusnap/.test(sharedPreview));
check('coreTransport.getDocumentDetail is a pass-through to window.docusnap.getDocumentDetail (the projected DTO read)',
      /getDocumentDetail:\s*\(\.\.\.a\) => d\.getDocumentDetail\(\.\.\.a\)/.test(adapter) && /const d = window\.docusnap;/.test(adapter));

// 2 — the projection itself: /v1 FORBIDDEN fields never survive; extractions are projected.
const dto = require(path.join(__dirname, '..', '..', 'services', 'dto.js'));
const projected = dto.projectDocumentDetail({
  id: 7, supplier_name: 'Acme', reference_number: 'INV-1', doc_date: '01-01-2026',
  status: 'confirmed', type_name: 'Invoice', type_slug: 'invoice', overall_confidence: 95,
  original_filename: 'a.pdf', stored_filename: 'Invoice.pdf',
  stored_path: 'C:/secret/Invoice.pdf', working_path: 'C:/inbox/7.pdf',
  folder_path: 'C:/secret', ocr_text: 'THE WHOLE DOCUMENT', keyword_fingerprint: '[1,2]',
  extractions: [{ field_key: 'invoice_number', display_value: 'INV-1', confidence: 95,
                  raw_value: 'raw', validation_note: null, corrected_to: null,
                  was_corrected: 0, extraction_method: 'keyword' }],
});
const FORBIDDEN = ['stored_path', 'working_path', 'folder_path', 'ocr_text', 'keyword_fingerprint'];
check('projected detail carries NONE of the forbidden fields',
      FORBIDDEN.every(k => !(k in projected)));
check('projected detail keeps the display surface (id/status/extractions with display_value)',
      projected.id === 7 && projected.status === 'confirmed'
      && projected.extractions.length === 1
      && projected.extractions[0].display_value === 'INV-1'
      && !('raw_value' in projected.extractions[0]));

// 3 — handler source pins: the projected IPC uses the dto; the FULL read is admin/edit-only.
const handler = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'review', 'handler.js'), 'utf8');
check("get-document-detail projects through dto.projectDocumentDetail",
      /get-document-detail'[\s\S]{0,900}projectDocumentDetail\(doc\)/.test(handler));
check("get-document-with-extractions is requireRole('admin','edit') — Review-only",
      /get-document-with-extractions'[\s\S]{0,200}requireRole\('admin', 'edit'\)/.test(handler));

console.log(fails ? `\n${fails} FAILED` : '\nAll search detail de-pathing pins passed');
process.exit(fails ? 1 : 0);
