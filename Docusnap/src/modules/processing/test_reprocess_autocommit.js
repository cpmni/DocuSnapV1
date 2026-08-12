'use strict';
/*
 * test_reprocess_autocommit.js — PINs for the post-reprocess consent-bar slice
 * (Oracle SIGN-OFF-W/COND 2026-08-12; replaces the renderer's queue-wide
 * autoCommitFullConfidence sweep that filed 101 docs across every supplier after a
 * 14-doc group reprocess, attributed to the human user).
 *
 * These are STRUCTURAL pins in the test_foreign_fields.js style: they read the shipped
 * source and assert the load-bearing shapes a future dev could silently regress.
 * Behavioral trust pins (window exclusion + span revocation) live in
 * database/modules/test_scope_trust.js §23(c2).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/modules/processing/test_reprocess_autocommit.js
 */
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let pass = 0, failn = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { failn++; console.log(`  FAIL ${name}`); } };

const handler   = read('src/modules/processing/handler.js');
const service   = read('src/services/reviewService.js');
const trustSrc  = read('database/modules/trust.js');
const templates = read('database/modules/templates.js');
const searchH   = read('src/modules/search/handler.js');
const renderer  = read('src/windows/review/renderer.js');
const preload   = read('src/preload.js');
const reviewH   = read('src/modules/review/handler.js');

console.log('1. via sentinel is INTERNAL-only and exact');
check('reviewService declares both sentinels', /_VIA_SENTINELS = \['scope_sweep', 'auto_reprocess'\]/.test(service));
check('sentinel read ONLY from the internal arg (payload cannot smuggle a via)',
      /internal && _VIA_SENTINELS\.includes\(internal\.via\)/.test(service)
      && !/payload\.via|payload\s*\|\|\s*\{\}\)\.via/.test(service));
check("machine username stamped for auto_reprocess only ('Auto-filed (reprocess)')",
      /_via === 'auto_reprocess' \? 'Auto-filed \(reprocess\)' : actorName/.test(service));

console.log('2. trust: human window excludes the sentinel; span stays via-agnostic');
check('window NOT-IN list carries all five machine sentinels (gate-unify added auto_graduated/auto_threshold)',
      /NOT IN \('scope_sweep', 'auto_corroborated', 'auto_reprocess', 'auto_graduated', 'auto_threshold'\)/.test(trustSrc));
check('corrections span still built via-agnostic (_confirmedSql(false) present)',
      /_confirmedSql\(false\)/.test(trustSrc));

console.log('3. learning guards');
check('learnTemplateOnCommit skips auto_reprocess (machine confirm never drives template learning)',
      /_via === 'scope_sweep' \|\| _via === 'auto_reprocess'/.test(templates));

console.log('4. search dashboard counts every machine username');
check("search stat uses LIKE 'Auto-filed%' (not the exact-100% match)",
      /confirmed_by_username LIKE 'Auto-filed%'/.test(searchH)
      && !/confirmed_by_username = 'Auto-filed \(100%\)'/.test(searchH));

console.log('5. server-owned offer: scope, gates, consume-once');
check('batch records its own docIds at start (post-lock-filter nameToDoc)',
      /docIds: Object\.values\(nameToDoc\)\.map\(n => n\.docId\)/.test(handler));
check('a new batch clears any unconsumed offer (fail-safe overwrite)',
      /_reprocessOffer = null;\s*\n\s*_reprocessStatus = \{ running: true/.test(handler));
{
  const h = handler.slice(handler.indexOf("ipcMain.handle('consume-reprocess-completion'"));
  const consume = h.slice(0, h.indexOf('ipcMain.handle(', 10));
  const iRole = consume.indexOf("requireRole('admin', 'edit')");
  const iLic  = consume.indexOf('licenseDenied(db)');
  const iFlip = consume.indexOf('_reprocessStatus.pendingCompletion = false');
  check('consume gates role BEFORE the once-flag flip (refused consume never swallows the completion)',
        iRole >= 0 && iFlip > iRole);
  check('consume gates license BEFORE the once-flag flip', iLic >= 0 && iFlip > iLic);
  check('offer computed from the BATCH docIds, never the queue',
        /_reprocessStatus\.docIds/.test(consume) && !/getReviewQueue/.test(consume));
  check('offer is setting-gated (reprocess_autocommit_offer, default ON)',
        /getSetting\(db, 'reprocess_autocommit_offer', 'true'\)/.test(consume));
  check('offer uses the ONE shared batch predicate (trust.autoFileEligibleIds)',
        /autoFileEligibleIds\(db, rows\)/.test(consume));
}
{
  const a = handler.slice(handler.indexOf("ipcMain.handle('reprocess-autocommit-accept'"));
  const accept = a.slice(0, a.indexOf('ipcMain.handle(', 10));
  check('accept IPC is PAYLOAD-LESS (server-authoritative ids)',
        /ipcMain\.handle\('reprocess-autocommit-accept', async \(\) =>/.test(handler));
  check('accept consumes the offer once (nulled before filing)',
        /const offer = _reprocessOffer;\s*\n\s*_reprocessOffer = null;/.test(accept));
  check('accept re-checks eligibility per doc at accept time', /isAutoFileEligible\(db, doc/.test(accept));
  check('accept skips workflow-locked docs', /'pending', 'claimed'/.test(accept));
  check("accept files through the ONE shared confirm with the internal via",
        /reviewService\.confirm\(db, actor, \{[\s\S]*?\}, \{ via: 'auto_reprocess' \}\)/.test(accept));
  check('accept records each file for the re-surface banner (_recordAutoFiled)',
        /_recordAutoFiled\(db, docId\)/.test(accept));
  check('accept audits a summary row (reprocess_autofiled)', /action: 'reprocess_autofiled'/.test(accept));
}

console.log('6. the queue-wide sweep is GONE, no restore door');
check('renderer autoCommitFullConfidence removed (name may survive in history comments only)',
      !/function autoCommitFullConfidence|autoCommitFullConfidence\(\)/.test(renderer));
check('renderer consent bar exists and files only via the payload-less accept',
      /showReprocessAutofileOffer/.test(renderer) && /reprocessAutocommitAccept\(\)/.test(renderer));
check('get-auto-file-eligible IPC retired (handler)', !/ipcMain\.handle\('get-auto-file-eligible'/.test(reviewH));
check('get-auto-file-eligible retired from preload; accept exposed',
      !/get-auto-file-eligible/.test(preload) && /reprocess-autocommit-accept/.test(preload));
check('renderer no longer calls getAutoFileEligible', !/getAutoFileEligible/.test(renderer));

console.log('7. honest banner copy');
check('auto-filed banner no longer claims "in the last run"',
      !/filed automatically in the last run/.test(renderer));

console.log(`\n${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
