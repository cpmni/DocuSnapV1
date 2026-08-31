'use strict';
/*
 * test_chris_r6_ui_cards.js — contract pins for the safe UI / classifier fixes from Chris round 6
 * (docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md, triage table): Card 3 (the Import results chip asks
 * the ONE filing predicate), Card 5 (no Use/Keep pair when neither value is printed on the page),
 * Card 6 (no "N more to file by itself" promise under a never-confirmed sender), Card 7 (stale
 * panels: the hold verdict is dropped on a type/issuer change; Delete All says "Queue cleared";
 * the emptied panel clears the ⊕ read-back bar and the Teach card).
 * Source-regex pins in the project's existing style (cf. test_chris_r5_ui_cards.js). Files on
 * disk are CRLF (core.autocrlf) — every span below is `[\s\S]` based, never `\n`-anchored.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/review/test_chris_r6_ui_cards.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const renderer = rd('src/windows/review/renderer.js');
const mainR    = rd('src/windows/main/renderer.js');
const handler  = rd('src/modules/processing/handler.js');
const html     = rd('src/windows/review/index.html');

// ── Card 3 — the Import results chip asks the ONE filing predicate ───────────────────────────
console.log('Card 3 — one classifier for the Import table and Review');
{
  const s = handler.indexOf("Object.prototype.hasOwnProperty.call(msg || {}, 'barcodes')");
  const e = handler.indexOf('msg.db_id = docId;', s);
  const body = (s > -1 && e > -1) ? handler.slice(s, e) : '';
  check('the file_done handler asks trust.isAutoFileEligible over the persisted row, AFTER the extraction rows are written',
        /msg\.review_hold = null;[\s\S]{0,400}trust\.isAutoFileEligible\(db, row\)/.test(body)
        && handler.indexOf('learning.insertExtractions(db, docId, rows);') < s);
  check('the verdict rides a SEPARATE field — needs_review is never overwritten (the T1 gate-unify seam reads it)',
        /if \(v && !v\.eligible\) msg\.review_hold = v\.reason \|\| 'held';/.test(body)
        && !/msg\.needs_review\s*=/.test(body));
  check('the predicate call is best-effort (a row must never fail an import)',
        /try \{[\s\S]{0,300}trust\.isAutoFileEligible\(db, row\)[\s\S]{0,120}\} catch \{\}/.test(body));
}
{
  const s = mainR.indexOf('function addTableRow(msg)');
  const e = mainR.indexOf('tableBody.prepend(tr);', s);
  const body = (s > -1 && e > -1) ? mainR.slice(s, e) : '';
  check('addTableRow keys the chip on needs_review OR review_hold',
        /const _held = !!msg\.needs_review \|\| !!msg\.review_hold;/.test(body));
  check('a held row is tinted and reads "Confirm to file" — never "Ready to file"',
        /else if \(_held\)\s+tr\.classList\.add\('row-review'\);/.test(body)
        && /\} else if \(_held\) \{[\s\S]{0,200}Confirm to file/.test(body));
  check('the raw engine flag no longer decides the chip on its own',
        !/else if \(msg\.needs_review\)/.test(body));
}

// ── Card 5 — no Use/Keep pair when neither value is printed on the page ──────────────────────
console.log('Card 5 — Use/Keep suppressed when the page vouches for neither value');
{
  const s = renderer.indexOf('function appendFieldRow(');
  const e = renderer.indexOf('const row = document.createElement(\'div\');', s);
  const body = (s > -1 && e > -1) ? renderer.slice(s, e) : '';
  check('_neitherOnPage keys on the Gate-C absent mark AND the offered value being absent (sepless)',
        /const _neitherOnPage = !!correctedTo && correctedTo !== val && !isApplied[\s\S]{0,80}doesn't appear on this page as written[\s\S]{0,80}!_valueOnPageSepless\(correctedTo, currentDoc && currentDoc\.ocr_text\)/.test(body));
  check('the Use/Keep pair is gated on !_neitherOnPage',
        /const acceptHtml = \(correctedTo && correctedTo !== val && !isApplied && !_neitherOnPage\)/.test(body));
  check('in its place: a hint that points at the box (⊕), no button',
        /_neitherOnPage[\s\S]{0,40}field-note-hint[^<]*Neither reading appears on this page — draw the box again \(⊕\)/.test(body));
}
check('_valueOnPageSepless is fail-open (no text / empty value → true) and a plain sepless substring',
      /function _valueOnPageSepless\(value, pageText\) \{[\s\S]{0,400}if \(!v \|\| !p\) return true;[\s\S]{0,40}return p\.includes\(v\);/.test(renderer));
check('the hint has a style (no unstyled inline span)', /\.field-note-hint \{/.test(html));

// ── Card 6 — no countdown promise under a never-confirmed sender ────────────────────────────
console.log('Card 6 — "N more to file by itself" only for a sender someone has confirmed');
{
  const s = renderer.indexOf('function _senderReadinessLabel(supplier)');
  const e = renderer.indexOf('function _sweepVisibleQueue()', s);
  const body = (s > -1 && e > -1) ? renderer.slice(s, e) : '';
  check('zero confirms across every pending scope renders NOTHING, before the countdown is built',
        /if \(pending\.every\(r => !\(Number\(r\.confirms\) > 0\)\)\) return '';[\s\S]{0,600}to file by itself/.test(body));
  check('the "✓ files by itself" and "learned · needs a layout" states are decided first (unchanged)',
        body.indexOf('✓ files by itself') < body.indexOf("Number(r.confirms) > 0")
        && body.indexOf('learned · needs a layout') < body.indexOf("Number(r.confirms) > 0"));
}

// ── Card 7 — stale panels ────────────────────────────────────────────────────────────────────
console.log('Card 7 — stale panels');
{
  const s = renderer.indexOf('currentDoc.document_type_id      = dt ? (dt.id ?? null) : null;');
  const body = s > -1 ? renderer.slice(s, s + 1400) : '';
  check('a TYPE change drops the loaded hold verdict before the reason panel repaints',
        /_holdVerdict = null;[\s\S]{0,80}try \{ renderReviewReason\(currentDoc\); \} catch \{\}/.test(body));
}
{
  const s = renderer.indexOf("input.addEventListener('blur', () => {");
  const body = s > -1 ? renderer.slice(s, s + 2200) : '';
  check('a settled DIFFERENT issuer drops the verdict, repaints the panel and the sender label',
        /key === 'supplier_name' && currentDoc[\s\S]{0,200}_holdVerdict = null;[\s\S]{0,80}renderReviewReason\(currentDoc\)[\s\S]{0,80}_updateSenderFieldsBtn\(\)/.test(body));
}
{
  const s = renderer.indexOf("document.getElementById('btn-delete-all-review').addEventListener('click'");
  const e = renderer.indexOf('// ── Delete All Deferred', s);
  const body = (s > -1 && e > -1) ? renderer.slice(s, e) : '';
  check('Delete All sets the LIST one-shot ("Queue cleared — N in the recycle bin") unconditionally',
        /_queueEmptyMsg = `Queue cleared — \$\{res\.deleted\} in the recycle bin`;/.test(body));
  check('…and the panel one-shot whenever nothing stays open (not only when the open doc was queued)',
        /if \(hadCurrent\) currentDoc = null;\s*if \(!currentDoc\) _placeholderMsg = _clearedMsg;/.test(body));
  // Chris r7 (attempt 4) "NOT FIXED as seen": a ONE-SHOT was consumed by the handler's own render and the
  // delete's IPC-driven refresh painted the default again. STICKY now: nothing nulls the messages on use;
  // only the non-empty branch (the queue refilled — e.g. Restore all) retires them.
  check('renderQueueList shows the list message without consuming it (sticky)',
        /empty\.textContent = _queueEmptyMsg \|\| '✓ All reviewed';(?![\s\S]{0,40}_queueEmptyMsg = null;)/.test(renderer));
  check('the NON-EMPTY branch retires BOTH cause-aware messages',
        /empty\.style\.display = 'none';\s*_queueEmptyMsg\s*= null;[^\n]*\n\s*_placeholderMsg = null;\s*setQueueWrapVisible\(true\);/.test(renderer));
  check('clearDocPanel shows the panel message without consuming it (sticky)',
        /ph\.textContent\s*= _placeholderMsg \|\| 'All documents reviewed ✓';(?![\s\S]{0,40}_placeholderMsg\s*= null;)/.test(renderer));
}
{
  // Chris r7 new card A: a re-typed 91% worksheet read "Ready to file" over "please fill in Invoice Date…".
  check('a TYPE change marks the panel state unsaved (beside dropping the verdict)',
        /_holdVerdict = null;\s*_typeChangedUnsaved = true;\s*try \{ renderReviewReason\(currentDoc\); \} catch \{\}/.test(renderer));
  check('renderCleanHoldReason leads with the NEUTRAL "Type changed to X — check the fields" copy while unsaved, before any verdict/threshold copy',
        /const v = _holdVerdict;[\s\S]{0,200}if \(_typeChangedUnsaved\) \{[\s\S]{0,700}Type changed to <strong>[\s\S]{0,400}Waiting for your check[\s\S]{0,300}return;\s*\}/.test(renderer)
        && renderer.indexOf('if (_typeChangedUnsaved) {') < renderer.indexOf("v.kind === 'put-back'"));
  check('a document (re)load retires the unsaved-type-change lead',
        /_holdVerdict = null;\s*_typeChangedUnsaved = false;/.test(renderer));
}
{
  const s = renderer.indexOf('function clearDocPanel()');
  const body = s > -1 ? renderer.slice(s, s + 900) : '';
  check('clearDocPanel hides the ⊕ read-back bar and the Teach card',
        /hideAnchorReadout\(\);[\s\S]{0,60}renderTeachCta\(null\);/.test(body));
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
