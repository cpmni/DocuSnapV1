/**
 * test_quick_check_send_back.js — PIN for the Quick-check (batch-audit grid) "Send back to Review" button
 * (owner ask 2026-09-09). Wiring pin: the button reuses the SHARED, already-tested repairService.sendBackToReview
 * door, so this guards the WIRING (IPC event-cross-check + role gate + preload + renderer button/handler) so a
 * future edit can't silently drop it or bypass the trust model.
 *
 * Run:  node src/windows/review/test_quick_check_send_back.js   (plain node — source-string assertions only)
 */
const fs = require('fs'), path = require('path');
let P = 0, F = 0;
const check = (name, ok) => { if (ok) { P++; console.log('  ok  ' + name); } else { F++; console.log('  FAIL ' + name); } };
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const handler  = read('..', '..', 'modules', 'review', 'handler.js');
const preload  = read('..', '..', 'preload.js');
const renderer = read('renderer.js');
const repair   = read('..', '..', 'services', 'repairService.js');

console.log('1. IPC — event-cross-checked, admin/edit, reuses sendBackToReview');
const ipc = handler.slice(handler.indexOf("ipcMain.handle('batch-audit-send-back'"));
check('IPC batch-audit-send-back is registered', ipc.startsWith("ipcMain.handle('batch-audit-send-back'"));
check("gated on batch_audit_enabled", /_batchAuditEnabled\(\)/.test(ipc.slice(0, 400)));
check("requires admin/edit", /requireRole\('admin', 'edit'\)/.test(ipc.slice(0, 400)));
check("CROSS-CHECKS the docId against the event ids (C5 trust model, never trusts the renderer)",
  /getReviewEvent\(db, eventId\)/.test(ipc.slice(0, 700)) && /evIds\.has\(id\)/.test(ipc.slice(0, 700)));
check("calls repairService.sendBackToReview with source 'quick_check'",
  /sendBackToReview\(db, id, \{ source: 'quick_check' \}\)/.test(ipc.slice(0, 900)));
check("audits + refreshes the review count on success",
  /'quick_check_send_to_review'/.test(ipc.slice(0, 1100)) && /review-count-changed/.test(ipc.slice(0, 1100)));
check("no license gate (it UN-files, not files) — no licenseDenied call in the handler body",
  !/licenseDenied/.test(ipc.slice(0, 1100)));

console.log('\n2. repairService names the Quick-check door in the send-back note');
check("source 'quick_check' -> 'Sent back from Quick check' prefix",
  /source === 'quick_check' \? 'Sent back from Quick check'/.test(repair));

console.log('\n3. preload bridge');
check("preload exposes batchAuditSendBack(eventId, docId) -> batch-audit-send-back",
  /batchAuditSendBack:\s*\(eventId, docId\)\s*=>\s*ipcRenderer\.invoke\('batch-audit-send-back', \{ eventId, docId \}\)/.test(preload));

console.log('\n4. renderer — the button (both views) + handler + local drop');
check("cards view renders a .ba-sendback button carrying data-sendback",
  /class="ba-sendback" data-sendback="\$\{r\.id\}"/.test(renderer));
check("table view has a trailing action cell + header",
  /<th class="ba-tact"><\/th>/.test(renderer) && /<td class="ba-tact"><button[^>]*class="ba-sendback"/.test(renderer));
check("grid click delegates .ba-sendback to _baSendBack (and stops row-select)",
  /const sb = e\.target\.closest\('\.ba-sendback'\);/.test(renderer) && /_baSendBack\(Number\(sb\.dataset\.sendback\)\)/.test(renderer));
check("_baSendBack calls the bridge and drops the row LOCALLY (preserves other edits)",
  /window\.docusnap\.batchAuditSendBack\(_baEvId, docId\)/.test(renderer)
  && /_baRows\.splice\(idx, 1\)/.test(renderer));
check("_baSendBack closes the grid when nothing is left",
  /if \(!_baRows\.length\) \{ _baClose\(\); return; \}/.test(renderer));

console.log('\n' + (F === 0 ? 'ALL PASS' : F + ' FAILED') + `  (${P} ok)`);
process.exit(F ? 1 : 0);
