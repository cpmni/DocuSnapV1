'use strict';
/*
 * test_autofile_check_bar.js — pins the auto-file eligibility PROGRESS bar (owner 2026-09-09; eric design):
 * a slim "Checking eligible docs from <sender> for Autofile" strip in the Review PREVIEW, shown ONLY for a
 * live quiet-lane 'ready' job (a just-graduated sender's held docs being re-read + checked), WITHOUT
 * un-silencing the teach/layout quiet re-reads (_quietSilent stays honoured by _renderQuietHint).
 * Source-scan pins (the window's convention). Run: node src/windows/review/test_autofile_check_bar.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const rd = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = rd('index.html');
const rend = rd('renderer.js');
const lane = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'processing', 'quietLane.js'), 'utf8').replace(/\r\n/g, '\n');

// placement: the bar lives inside the PREVIEW (#doc-panel), and is hidden by default.
check('#autofile-check-bar exists inside #doc-panel (the preview)',
      html.indexOf('id="autofile-check-bar"') > html.indexOf('id="doc-panel"') && html.indexOf('id="doc-panel"') > -1);
check('the bar is hidden by default (the `hidden` attribute)', /id="autofile-check-bar" hidden/.test(html));

// independence: the bar's render filters to live ready jobs and NEVER reads _quietSilent.
{
  const s = rend.indexOf('function _renderAutofileCheckBar()');
  const e = rend.indexOf('window.docusnap.onQuietReprocess', s);
  const body = (s > -1 && e > -1) ? rend.slice(s, e) : '';
  check('_renderAutofileCheckBar filters to live ready jobs', /find\(j => j\.ready && j\.state !== 'done'\)/.test(body));
  check('_renderAutofileCheckBar never reads _quietSilent (surfaces autofile without un-silencing the lane)',
        body.length > 0 && !/_quietSilent/.test(body));
  check('the bar carries the plain no-jargon copy "Checking which documents … can file on their own"',
        /Checking which documents\$\{sup\} can file on their own/.test(body));
  // Oracle 2026-09-25 B3: NO DENOMINATOR — the frozen "done of total" fraction drifts from the queue and is
  // worse than no number. The bar must never render a done/total pair.
  check('the bar shows NO denominator (no "done of total" fraction)',
        !/ready\.total/.test(body) && !/ready\.done/.test(body) && !/\bof \$\{/.test(body));
  // Oracle 2026-09-25 B1/B2 (cut 2): the background check YIELDS to the offer/countdown via the pure
  // deriveReviewStatus reducer — so "still checking" and "ready to file" never co-render (the owner's clash).
  check('the check bar yields via ReviewStatus.checkBarShows (offer/countdown own the surface)',
        /window\.ReviewStatus[\s\S]{0,80}checkBarShows\(\{ inviewActive: !!_inviewCd, offerActive:/.test(body));
  check('the yield reads the live reprocess-offer bar + the in-view countdown state',
        /getElementById\('reprocess-autofile-bar'\)/.test(body) && /_inviewCd/.test(body));
}
// the reducer is loaded in the Review window (a <script>, requireable by test_review_status.js)
check('reviewStatus.js is loaded in review/index.html', /<script src="\.\.\/shared\/reviewStatus\.js">/.test(html));
// when the offer clears (dismiss / review / accept-or-expire), the check bar is re-rendered so it reappears
check('the offer teardown re-renders the check bar (dismiss + review + accept)',
      (rend.match(/_renderAutofileCheckBar\(\);/g) || []).length >= 3);
check('_renderQuietHint STILL returns early on _quietSilent (silence preserved for teach/layout re-reads)',
      /function _renderQuietHint\(\)[\s\S]{0,220}if \(_quietSilent\)/.test(rend));

// wiring: the handler stores ev.ready + renders/clears the bar; the quiet lane emits the ready marker.
check('onQuietReprocess stores the ready marker on job_start', /if \(ev\.ready\) j\.ready = true;/.test(rend));
check('onQuietReprocess clears the bar on job_done and renders it otherwise',
      /_quietJobs\.delete\(ev\.jobId\); _renderQuietHint\(\); _renderAutofileCheckBar\(\)/.test(rend)
      && /_renderQuietHint\(\);\s*\n\s*_renderAutofileCheckBar\(\);/.test(rend));
check('quietLane job_start + _public carry the `ready` marker (survives a coalesce)',
      /type: 'job_start'[\s\S]{0,240}ready: !!\(job\.reasons && job\.reasons\.has\('ready'\)\) \|\| job\.reason === 'ready'/.test(lane)
      && /ready: !!\(j\.reasons && j\.reasons\.has\('ready'\)\) \|\| j\.reason === 'ready'/.test(lane));

console.log(fails ? `\n${fails} FAILED` : '\nAll autofile-check-bar pins passed');
process.exit(fails ? 1 : 0);
