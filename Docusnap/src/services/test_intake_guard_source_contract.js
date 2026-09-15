'use strict';
/**
 * test_intake_guard_source_contract.js — Quick File Q-C2 source-contract pin (Oracle Condition D).
 *
 * The behavioural pin (test_intake_guard.js) proves each guard WORKS today; this proves each guard is
 * STILL PRESENT in its source, so a future refactor can't silently delete one and leave a green suite
 * (the reprocess IPC + /v1 confirm are main-bound and only source-provable here). Pure string reads.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_intake_guard_source_contract.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const count = (s, sub) => s.split(sub).length - 1;

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

const documentsJs = read('database/modules/documents.js');
check('documents.js belt clause present in BOTH deconfirm + requeue (>=2 occurrences)',
  count(documentsJs, "COALESCE(intake,'') <> 'direct'") >= 2);
check('documents.js imports _hasIntakeColumn from machine_vias',
  /_hasIntakeColumn.*require\('\.\/machine_vias'\)/.test(documentsJs) || documentsJs.includes('_hasIntakeColumn'));

const reviewJs = read('src/services/reviewService.js');
check("reviewService.confirm guards intake before writes (isDirectIntake + QUICK_FILE_NOT_REVIEWABLE)",
  reviewJs.includes('intakeGuard.isDirectIntake(db, document_id)') && reviewJs.includes('QUICK_FILE_NOT_REVIEWABLE'));

const repairJs = read('src/services/repairService.js');
check("repairService.sendBackToReview calls intakeGuard.guard(...,'send-back')",
  repairJs.includes("intakeGuard.guard(db, docId, 'send-back')"));
check('repairService delete skips retract for a typed doc (!isDirectIntake)',
  repairJs.includes('!intakeGuard.isDirectIntake(db, docId)'));

const procJs = read('src/modules/processing/handler.js');
check("reprocess-document handler guards intake ('reprocess')",
  procJs.includes(".guard(db, docId, 'reprocess')"));

const settingsJs = read('src/modules/settings/handler.js');
check("settings raw-deconfirm door guards intake ('send-back')",
  settingsJs.includes(".guard(db, docId, 'send-back')"));

const guardJs = read('src/lib/intakeGuard.js');
check('intakeGuard.js exports guard + isDirectIntake + MESSAGES',
  /module\.exports\s*=\s*{[^}]*isDirectIntake[^}]*guard[^}]*}/.test(guardJs.replace(/\n/g, ' ')));

const searchSvc = read('src/services/searchService.js');
check("searchService DTO carries 'intake'", /SEARCH_ROW_FIELDS[\s\S]*'intake'/.test(searchSvc));

const searchActions = read('src/windows/shared/search-ui/searchActions.js');
check("shared searchActions hides the Review dead-end for a typed doc (doc.intake === 'direct')",
  searchActions.includes("doc.intake === 'direct'"));

const clientSearchActions = read('client/renderer/shared/search-ui/searchActions.js');
check("client searchActions is in sync (carries the same intake branch)",
  clientSearchActions.includes("doc.intake === 'direct'"));

const rr = read('stress_test/realdoc_regression.js');
check('realdoc harness excludes typed docs from GT (Q-C4, >=2 selectors)',
  count(rr, "COALESCE(d.intake,'') <> 'direct'") >= 2);

console.log(fails === 0 ? '\nintake-guard-source-contract: ALL PASS' : `\nintake-guard-source-contract: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
