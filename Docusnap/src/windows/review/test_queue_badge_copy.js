'use strict';
/*
 * test_queue_badge_copy.js — the queue row badge's "waiting for your OK" suffix must stay
 * STATUS-GATED (Oracle C1, 2026-08-02). THE SEAM THIS PINS: the auto-filed view loads
 * CONFIRMED docs into `queue` and renders them through the same buildQueueItem — an
 * un-gated suffix hovers "waiting for your OK" on already-filed documents one inch under
 * the bar that says "they stay filed; nothing is changed" (two truthful copies from the
 * SAME commit contradicting each other on one screen). The gate is `doc.status !==
 * 'confirmed'`, layer-correct so any future reuse of the builder inherits it.
 *
 *   node src/windows/review/test_queue_badge_copy.js
 */
const fs = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

check("the 'waiting for your OK' suffix exists on the queue badge",
      renderer.includes('waiting for your OK'));
check('…and is STATUS-GATED (never shown on a confirmed doc — the auto-filed view)',
      /sev === 'high' && doc\.status !== 'confirmed' \? ' · waiting for your OK' : ''/.test(renderer));
{
  const start = renderer.indexOf('function renderDeferredList()');
  const end = renderer.indexOf('\nfunction ', start + 1);
  const body = start > -1 ? renderer.slice(start, end > -1 ? end : undefined) : '';
  check('the deferred list builds its own rows (the badge builder is queue-tab only)',
        body.length > 0 && !body.includes('buildQueueItem('));
}
check('the auto-filed view hides the review action block (Delete All Review cannot show '
      + 'a wrong count over a confirmed list — Oracle A1)',
      /reviewActions\.style\.display = _viewingAutoFiled \? 'none' : 'flex';/.test(renderer));

// The row badge routes through the ONE readiness classifier (window.ReviewReadiness.classify) so it
// can never wear a green "Looks good" over a doc Home / File All would HOLD (untyped, blank required
// detail, flagged). Pinned on the source: the classify() call, the green-only-when-ready severity,
// and the no-type / blank-issuer blocker copy that the old local-signal badge had no leg for.
{
  const start = renderer.indexOf('function buildQueueItem(');
  const end = renderer.indexOf('\nfunction ', start + 1);
  const body = start > -1 ? renderer.slice(start, end > -1 ? end : undefined) : '';
  check('buildQueueItem asks window.ReviewReadiness.classify (the same verdict as Home / File All)',
        /window\.ReviewReadiness\.classify\(doc, \{ valuedOnly: !!window\.__farValuedOnly \}\)/.test(body));
  check('green is reserved for a truly-ready row (any not-ready reason → orange, never green)',
        /const notReady\s*=\s*_cls !== 'ready';/.test(body)
        && /else if \(notReady\)\s*sev = 'mid';/.test(body)
        && /else if \(conf != null\)\s*sev = 'high';/.test(body));
  check('an untyped or blank-issuer row names its real blocker (no type / Document Issuer)',
        /No document type — can’t file yet/.test(body)
        && /'Needs: a document type'/.test(body)
        && /'Needs: Document Issuer'/.test(body));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll queue-badge copy pins passed');
process.exit(fails ? 1 : 0);
