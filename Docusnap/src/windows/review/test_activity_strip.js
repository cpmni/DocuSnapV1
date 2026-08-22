'use strict';
/*
 * test_activity_strip.js — B2 of the activity-strip arc (2026-08-22; barry + eric → Oracle
 * SIGN-OFF-W/COND C2/C5/C6/C8/C9). Source-contract pins on the Review renderer + index.html — the
 * strip is pure DOM over the B1 ledger, so the contract is what a fresh build can silently break.
 *
 * Pins: the strip is gated on `review_activity_strip` and adds NO layout when off (the head variable
 * stays 46 px) · OFFERS are never rendered in the strip (no File/Review/Not now copy in the strip code)
 * · `onReviewEvent` renders the strip ONLY (C2 — never `_refreshQueueFromBroadcast`) · the click-outside
 * listener is observe-only (no stopPropagation/preventDefault; C5) and Esc is consumed only with a
 * panel open · the strip carries `data-help-ignore` · the four absolute children consume `--doc-head-h`
 * (C8) · chips newest-left, ≤10, age out at 15 min · the owner's clarification: click-anywhere closes
 * the PANEL only · copy (C9): "filed automatically" for auto_filed, "filed themselves" reserved for
 * self_filed · the sweep done-phase bar defers to the strip when armed (no 20 s timer) · "See them"
 * and "Put back" go by EVENT id · kept-back reasons render (C6) · a >25 put-back asks first (C7) ·
 * preload exposes the five names.
 *
 * Run: node src/windows/review/test_activity_strip.js
 */
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8').split(CR + LF).join(LF);   // CRLF-safe
const rend = read('renderer.js'), html = read('index.html'), pre = read('..', '..', 'preload.js');
let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };
const fn = (name) => { const i = rend.indexOf(name); return i < 0 ? '' : rend.slice(i, rend.indexOf(LF + '}' + LF, i) + 3); };
const cssRule = (sel) => { const i = html.indexOf(sel + ' {'); return i < 0 ? '' : html.slice(i, html.indexOf('}', i)); };

console.log('gating + layout (C8):');
check("armed by the review_activity_strip setting, read once", /_asOn = \(await window\.docusnap\.getSetting\('review_activity_strip'\)\) === 'true'/.test(rend));
check('OFF → the doc-panel head variable stays 46 px; ON → 74 px', /#doc-panel \{[^}]*--doc-head-h: 46px;/.test(html) && /#doc-panel\.has-activity-strip \{ --doc-head-h: 74px; \}/.test(html));
check('the strip is display:none unless #doc-panel carries has-activity-strip', /#activity-strip \{ display: none;/.test(html) && /#doc-panel\.has-activity-strip #activity-strip \{ display: flex; \}/.test(html));
check('…and renderActivityStrip toggles that class from _asOn', /panel\.classList\.toggle\('has-activity-strip', _asOn\)/.test(rend));
const consumes = (sel) => /top: (var\(--doc-head-h\)|calc\(var\(--doc-head-h\) \+ 40px\))/.test(cssRule(sel));
// #ack-hint has an earlier one-line rule (the select-hint override) — take the block rule by its `position: absolute` body
const ackHint = html.slice(html.indexOf('#ack-hint {' + LF), html.indexOf('}', html.indexOf('#ack-hint {' + LF)));
check('the four absolute children consume --doc-head-h (C8)',
      consumes('#btn-acknowledge') && consumes('#wizard-panel') && consumes('.anchor-readout') && /top: calc\(var\(--doc-head-h\) \+ 40px\)/.test(ackHint));
check('the strip is the first child of #doc-panel, before #doc-toolbar', html.indexOf('id="activity-strip"') > html.indexOf('<div id="doc-panel">') && html.indexOf('id="activity-strip"') < html.indexOf('<div id="doc-toolbar">'));
check('the strip + panel carry data-help-ignore', /id="activity-strip" data-help-ignore/.test(html) && /id="activity-panel" data-help-ignore/.test(html));

console.log(LF + 'the feed (C2):');
const init = fn('async function initActivityStrip()');
check('onReviewEvent renders the strip ONLY — never the queue refresh', /onReviewEvent\?\.\(\(ev\) => \{[\s\S]*?renderActivityStrip\(\);[\s\S]*?\}\);/.test(init) && !/onReviewEvent[\s\S]{0,600}_refreshQueueFromBroadcast/.test(init));
check('events load from the ledger on open (getReviewEvents), never from recent_auto_filed', /_asEvents = \(await window\.docusnap\.getReviewEvents\?\.\(\)\) \|\| \[\]/.test(init) && !/recent_auto_filed|getRecentAutoFiled/.test(fn('function renderActivityStrip()')));
check('relative time re-labels every 30 s without a refetch, cleared on beforeunload', /setInterval\(\(\) => \{ if \(_asOn\) renderActivityStrip\(\); \}, 30_000\)/.test(init) && /beforeunload/.test(init));
check('relative time is computed from the event stamp', /function _asRelTime\(at\)[\s\S]{0,120}Date\.now\(\) - Number\(at/.test(rend));

console.log(LF + 'the strip (owner + barry):');
check('chips ≤ 10, newest first, age out at 15 min', /const AS_MAX = 10, AS_TTL_MS = 15 \* 60 \* 1000;/.test(rend) && /\.slice\(0, AS_MAX\)/.test(rend));
check('scroll ‹ › buttons hide unless the track overflows', /prev\.hidden = !over \|\| track\.scrollLeft <= 0/.test(rend));
check('a chip reads "<icon> <when> · <short> ▾"', /\$\{_asIcon\(ev\)\} <span class="as-when">\$\{escHtml\(_asRelTime\(ev\.at\)\)\}<\/span> · \$\{escHtml\(_asShort\(ev\)\)\} <span class="as-caret">▾<\/span>/.test(rend));
check('no chip → a quiet "Recent activity ▾" while any event remains (never a blank band)', /Recent activity <span class="as-caret">▾<\/span>/.test(rend));
check('click-anywhere closes the PANEL only (the chip stays)', /if \(_asOpenId == null\) return;\s*\n\s*if \(e\.target\.closest\('#activity-panel'\) \|\| e\.target\.closest\('#activity-strip'\)\) return;\s*\n\s*_asClosePanel\(\);/.test(rend));
const capStart = rend.indexOf("document.addEventListener('click', (e) => {" + LF + "    if (_asOpenId == null) return;");
const capture = capStart < 0 ? '' : rend.slice(capStart, rend.indexOf('}, true);', capStart));
check('…the click-outside listener is observe-only (no stopPropagation / preventDefault — C5)', capture.length > 0 && !/stopPropagation|preventDefault/.test(capture));
check('Esc is consumed only while a panel is open', /e\.key === 'Escape' && _asOpenId != null/.test(rend));

console.log(LF + 'offers stay out of the strip:');
const stripStart = rend.indexOf('// ═══ B2 — THE ACTIVITY STRIP'), stripEnd = rend.indexOf('initActivityStrip();' + LF, stripStart);
const stripCode = (stripStart < 0 || stripEnd < 0) ? '' : rend.slice(stripStart, stripEnd);
check('the strip block is found and bounded', stripCode.length > 1000 && stripCode.length < 20000);
check('no offer copy in the strip code (File up to / Review them / Not now / Choose which)', stripCode.length > 0 && !/File up to|Review them|Not now|Choose which/.test(stripCode));
check('the sweep done-phase bar defers to the strip when armed — and its 20 s timer with it', /if \(s\.phase === 'done' && _asOn\) \{[\s\S]{0,300}?_sweepState = null; bar\.style\.display = 'none'/.test(rend));

console.log(LF + 'copy (C9) + actions (C5/C6/C7):');
check('auto_filed = "filed automatically"; self_filed = "filed themselves"', /case 'auto_filed': return `\$\{n\} document\$\{s\} filed automatically/.test(rend) && /case 'self_filed': return `\$\{n\} document\$\{s\}\$\{sup \? ` from <b>\$\{sup\}<\/b>` : ''\} filed themselves/.test(rend));
check('put_back tells the truth about the filed copies', /put back in Review — the filed copies stay in your folder until you file them again/.test(rend));
check('kept-back reasons render in the panel (C6)', /kept back — \$\{escHtml\(typeof _sweepReason === 'function' \? _sweepReason\(d\.reason\) : d\.reason\)\}/.test(rend));
check('"See them" resolves by EVENT id and reuses the filed-list view mode', /getReviewEventDocs\?\.\(evId\)/.test(rend) && /_viewingAutoFiled = true;\s*\/\/ the existing/.test(rend));
check('"Put back" goes by EVENT id, asks first above 25 (C7), and reports refused honestly', /undoReviewEvent\?\.\(evId\)/.test(rend) && /if \(n > 25 && !confirm\(`Put \$\{n\} documents back in Review\?/.test(rend) && /couldn't be \(filed another way since\)/.test(rend));
// customer-facing COPY only: every string/template literal in the strip block (code identifiers such as ev.scope are not copy)
const literals = (stripCode.match(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g) || []).join(LF).replace(/\$\{[^}]*\}/g, '');
check('no banned jargon in the strip copy (scope / sweep / lane / reprocess / template)', stripCode.length > 0 && !/\b(scope|sweep|lane|reprocess|template)\b/i.test(literals));

console.log(LF + 'preload:');
for (const name of ['getReviewEvents', 'onReviewEvent', 'markReviewEventsSeen', 'getReviewEventDocs', 'undoReviewEvent'])
  check(`preload exposes ${name}`, new RegExp('\\b' + name + ':').test(pre));

console.log(LF + 'Chris round 17 cards 4 / 5a / 6 / 8 (eric batch):');
const rh = read('..', '..', 'modules', 'review', 'handler.js'), ph = read('..', '..', 'modules', 'processing', 'handler.js');
const rsvc = read('..', '..', 'services', 'repairService.js'), sa = read('..', 'search', 'search-actions.js');
const tile = fn('async function refreshAutoCommittedBar');
check('card 4: under the strip the tile yields (early return on _asOn) — placed AFTER the "viewing" back-bar branch',
      /if \(typeof _asOn !== 'undefined' && _asOn\) \{ bar\.style\.display = 'none'; bar\.innerHTML = ''; return; \}/.test(tile)
      && tile.indexOf("_viewingAutoFiled") < tile.indexOf("typeof _asOn !== 'undefined' && _asOn"));
check('card 4: get-recent-auto-filed derives from status + a machine door (never the rolling id set alone)',
      /\.filter\(d => d && d\.status === 'confirmed' && \(d\.confirmed_via \|\| \/\^Auto-filed\/\.test\(String\(d\.confirmed_by_username \|\| ''\)\)\)\)/.test(rh));
check("card 5a: the strip line for a BULK approval drops the sender (the breakdown lives in the panel)",
      /case 'approved':\s+return ev\.bulk \? `You filed \$\{n\} in one go`/.test(rend));
check('card 6: get-processing-activity self-heals a stale import banner when nothing is running',
      /if \(_activity && _activity\.source === 'import' && !_anyProcessingBusy\(\)\) \{ _activity = null; _broadcastActivity\(\); \}/.test(ph));
check('card 6: the renderer re-pulls the activity truth every 30 s while the banner shows',
      /setInterval\(\(\) => \{ if \(_processingActive\) window\.docusnap\.getProcessingActivity\?\.\(\)/.test(rend));
check('card 6: the Reprocess dialog says a clean re-read WILL file when the sender files by itself (and how to undo)',
      /anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back/.test(rend)
      && /const _selfFiles = /.test(rend));
check("card 8: Search's send-back names its door ('Sent back from Search'), Learning Repair keeps its own",
      /const _prefix = source === 'search' \? 'Sent back from Search' : NOTE_PREFIX;/.test(rsvc)
      && /\$\{_prefix\}: \$\{s\.note\}/.test(rsvc) && /\$\{_prefix\} — please re-check this document before filing\./.test(rsvc)
      && /repairDeconfirm\(doc\.id, \{ source: 'search' \}\)/.test(sa));

console.log(fails ? LF + fails + ' FAILED' : LF + 'All activity-strip contract checks passed');
process.exit(fails ? 1 : 0);
