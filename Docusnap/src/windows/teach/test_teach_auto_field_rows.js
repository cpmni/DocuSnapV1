'use strict';
/*
 * test_teach_auto_field_rows.js — TEACH A LIST FIELD = TEACH ITS CAPTION (owner, 2026-08-27), and the
 * wizard rail must SHOW a Barcode field (muted, with the reason) instead of dropping it with a toast.
 *
 * THE OWNER'S SPEC (verbatim, 2026-08-27): "the teach feature should capture 1 value and the label
 * should be drawn. when processing in future, every iteration of that keyword should allow the
 * corresponding value to populate the list. … The label should be, if it isn't already there, added
 * to the keywords for the field of that doc type. … Teach should display all the captured values on
 * the taught doc and displayed before confirmation."
 *
 * THE GAP IT REPLACES: `_splitListFields` pulled List fields from the draw flow (a stored box would
 * be dead — Oracle C1 2026-08-11) with a 4-second toast, so a List field created in Settings
 * "didn't show up" in Teach. Now: a List field stays teachable; the box finds its CAPTION; the caption
 * is written as a doc-type-wide ADDITIVE keyword (teach-list-caption, Admin+Edit, list-typed only,
 * INSERT OR IGNORE = "if it isn't already there"); the confirm panel previews every value the caption
 * collects on the page; no box is stored; the taught document files with all the previewed values.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/teach/test_teach_auto_field_rows.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const js = rd('src/windows/teach/renderer.js');
const html = rd('src/windows/teach/index.html');
const rh = rd('src/modules/review/handler.js');
const pre = rd('src/preload.js');

console.log('1. the split: LIST fields stay TEACHABLE (tagged auto=list); BARCODE fields are still pulled');
check('_splitListFields keeps a list field in the teach list (return false after tagging) and pulls a barcode field',
      /if \(t === 'list' && window\.__listFieldTypeOn\) \{ f\.auto = 'list'; return false; \}/.test(js)
      && /if \(t === 'barcode' && window\.__barcodeFieldOn\) \{ f\.auto = 'barcode'; return true; \}/.test(js));
check('isListField keys off the auto tag', /function isListField\(f\)\{ return !!f && f\.auto === 'list'; \}/.test(js));

console.log('2. the confirm panel: caption copy, the value PREVIEW, and a caption-required demotion');
{
  const s = js.indexOf('function showValueConfirm(f, r){');
  const e = js.indexOf('function enterLabelRedraw(){', s);
  const body = (s > -1 && e > -1) ? js.slice(s, e) : '';
  check('a list field gets its own prompt ("Check the caption I found for") before the typed/read branches',
        /else if \(isListField\(f\)\)\{[\s\S]{0,200}setPrompt\('Check the caption I found for', f\.label\);/.test(body)
        && body.indexOf("else if (isListField(f)){") < body.indexOf('} else if (typed){'));
  check('the preview line lists every value the caption collects on THIS page (from the document\'s stored text)',
        // 2026-08-27 pm (Chris r8 card 1): the caption is NORMALISED + a generic tail EXTENDED before the preview,
        // and the previewed caption is the one stored (`r.anchor_text = _cap`) — the preview and the keyword agree.
        /_listVals = _listPreviewValues\(_cap, _ocr\);/.test(body)
        && /LC\.cleanCaption\(r\.anchor_text\)/.test(body) && /LC\.extendCaption\(_cap, r\.value, _ocr\)/.test(body)
        && /r\.anchor_text = _cap;/.test(body)
        && /collects \$\{_listVals\.length\} value/.test(body));
  check('a caption that is still a generic tail ("No") is never offered: warning names it, "Looks right" demoted',
        /_capOk = !!_cap && !_generic;/.test(body) && /on its own that would match every/.test(body));
  check('no caption → warning + "Looks right" demoted to "Save without a caption", Redraw label promoted',
        /A list is taught by its caption — I couldn't read one beside your box/.test(body)
        && /_yes\.textContent = 'Save without a caption'/.test(body)
        && /_rl\.classList\.add\('primary'\)/.test(body));
  check('"Looks right" stores the caption + the previewed values on the result',
        /if \(isListField\(f\)\) \{ r\.listCaption = _capOk \? r\.anchor_text : null; r\.listValues = _listVals \|\| \(r\.value \? \[String\(r\.value\)\] : \[\]\); \}/.test(body));
}

console.log('3. the preview helper behaves like the collector (whitespace-tolerant caption, value after it, dedupe)');
{
  const m = /function _listPreviewValues\(caption, ocrText\)\{[\s\S]*?\n\}\n/.exec(js);
  check('helper source found', !!m);
  if (m) {
    const fn = new Function(m[0] + '; return _listPreviewValues;')();
    const PAGE = ['Castellan Security Systems', 'SERVICE WORKSHEET', 'JOB SHEET NO CJB-9791 DATE 06-05-2026',
      'Description    Qty', '8-Channel NVR 2TB    1', 'Serial No: CT-8051702', 'IP Dome Camera 4MP    1',
      'Serial No: CT-8813265', 'Serial  No : CT-8051702', 'Work carried out:'].join('\n');
    const v = fn('Serial No', PAGE);
    check('"Serial No" collects both serials, deduped, caption punctuation stripped', JSON.stringify(v) === JSON.stringify(['CT-8051702', 'CT-8813265']));
    check('"Serial Number" (the field LABEL) collects nothing on a page printing "Serial No" — why the caption teach exists',
          fn('Serial Number', PAGE).length === 0);
    check('a single-word caption is word-bounded ("No" alone never matches inside "NVR" text)', fn('No', 'Serial No: X-1\nNVRNo9 junk\n').length === 1);
    check('a column break cuts the value ("Qty" column not swallowed)', JSON.stringify(fn('Description', 'Description    Qty\n')) === JSON.stringify(['Qty']) || fn('Description', 'Description    Qty\n').length <= 1);
    check('empty caption / empty page → []', fn('', PAGE).length === 0 && fn('Serial No', '').length === 0);
  }
}

console.log('4. doCommit: the caption is written (server door), no box is stored, the doc files with all the values');
{
  const s = js.indexOf('async function doCommit(){');
  const e = js.indexOf('function ', s + 30);
  const body = (s > -1 && e > -1) ? js.slice(s, e) : '';
  check('allValues carries the previewed list joined "; " for a list field',
        /if \(isListField\(f\) && Array\.isArray\(r\.listValues\) && r\.listValues\.length\) \{ allValues\[f\.key\] = r\.listValues\.join\('; '\); continue; \}/.test(body));
  check('the caption goes through D.teachListCaption per list field AFTER the template exists, advisory on failure',
        /const templateId=promo\.templateId;[\s\S]{0,900}D\.teachListCaption\(\{ document_type_slug: state\.docTypeSlug, field_key: f\.key, label: r\.listCaption \}\)/.test(body)
        && /wasn't saved as a keyword/.test(body));
  check('the Stage-0.5 mapping loop SKIPS list fields (a box would be dead)',
        /if \(isListField\(f\)\) continue;\s*\/\/ a LIST field stores NO box/.test(body));
}

console.log('5. the server door: Admin+Edit, list-typed only, ADDITIVE doc-type-wide, "if it isn\'t already there"');
{
  const s = rh.indexOf("ipcMain.handle('teach-list-caption'");
  const body = s > -1 ? rh.slice(s, s + 2200) : '';
  check('IPC exists and is teach-gated (admin OR edit)', /requireRole\('admin', 'edit'\);/.test(body));
  check('refuses a field that is not on the type, and any non-list field',
        /That field is not on this document type/.test(body) && /!== 'list'\) return \{ success: false/.test(body));
  check('writes an ADDITIVE, doc-type-wide override (exclusive 0, template_id 0) through addLabelOverride',
        /addLabelOverride\(db, \{ doc_type_slug: slug, field_key: key, label: cap, exclusive: 0, template_id: 0 \}\)/.test(body));
  check('a value-shaped "caption" (a bare code) is refused', /That does not look like a printed caption/.test(body));
  check('preload bridges teachListCaption', /teachListCaption:\s*\(data\)\s*=> ipcRenderer\.invoke\('teach-list-caption', data\)/.test(pre));
}

console.log('6. the rail still SHOWS pulled (barcode) fields, muted, with the reason');
{
  const s = js.indexOf('function renderFieldRail(){');
  const e = js.indexOf('renderFooter();', s);
  const body = (s > -1 && e > -1) ? js.slice(s, e) : '';
  check('renderFieldRail appends one .fieldrow.auto row per state.listFields entry (unclickable)',
        /for \(const f of \(state\.listFields \|\| \[\]\)\) \{[\s\S]{0,120}row\.className='fieldrow auto';/.test(body)
        && !/for \(const f of \(state\.listFields[\s\S]{0,900}row\.onclick/.test(body));
  check('index.html styles the auto row', /\.fieldrow\.auto\{cursor:default\}/.test(html) && /\.dot\.auto\{/.test(html));
}

console.log('7. the Review ⊕ road teaches a List field the same way (owner: "the review ⊕ button should also teach a list caption … show them all")');
{
  const rv = rd('src/windows/review/renderer.js');
  const rhtml = rd('src/windows/review/index.html');
  const shared = rd('src/windows/shared/listCaption.js');
  check('the old ⊕ refusal for a List field is GONE (barcode refusal kept)',
        !/is a List field — it's collected by finding its label everywhere on the page, so there's no position to teach/.test(rv)
        && /is a Barcode field — it's read from the barcode printed on the page/.test(rv));
  check('_isListFieldKey keys off the field type + the list scan switch',
        /function _isListFieldKey\(key\) \{[\s\S]{0,200}=== 'list' && !!window\.__listFieldScanOn;/.test(rv));
  check('the ⊕ completion routes a List field to _stageListCaption (after the issuer branch, before the anchor readout)',
        /\} else if \(_isListFieldKey\(fieldKey\)\) \{[\s\S]{0,400}_stageListCaption\(fieldKey, detected, text\);[\s\S]{0,60}\} else \{\s*showAnchorReadout\(detected, text\);/.test(rv));
  check('a List draw with no caption stages NOTHING and says a list is taught by its caption',
        /\} else if \(_isListFieldKey\(fieldKey\)\) \{\s*delete pendingAnchors\[fieldKey\];[\s\S]{0,300}a list is taught by its[\s\S]{0,40}<strong>caption<\/strong>/.test(rv));
  {
    const s = rv.indexOf('function _stageListCaption(fieldKey, detected, text) {');
    const body = s > -1 ? rv.slice(s, rv.indexOf('function _splitListValue(', s)) : '';   // the whole function (it grew with the merge rule)
    check('_stageListCaption stages a CAPTION record (no box geometry) keyed to the doc type',
          /pendingAnchors\[fieldKey\] = \{ listCaption: caption, field_key: fieldKey,\s*document_type: selectedTypeSlug \|\| currentDoc\?\.type_slug/.test(body));
    // 2026-08-27 pm (Oracle cond 4): the fill MERGES (current ∪ (preview − (original − current))) and writes through the
    // store's `input` event — the row listener is the ONE `corrections` writer; a direct write here is the old defect.
    check('…fills the field with EVERY value the caption collects on the page (shared preview), merged, via the store input event',
          /window\.ListCaption\.previewValues\(caption, \(currentDoc && currentDoc\.ocr_text\) \|\| ''\)/.test(body)
          && /input\.value = list\.join\('; '\);/.test(body) && /_listUnion\(current, _listMinus\(preview, removed\)\)/.test(body)
          && /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\);/.test(body) && !/corrections\[fieldKey\] =/.test(body));
    check('…and tells the user on the bar: caption, count, values, and an HONEST forward promise (Chris r8 card 4)',
          /collects <strong>\$\{preview\.length\}<\/strong> value/.test(body) && /I'll look for "\$\{escHtml\(caption\)\}" on future/.test(body)
          && !/on future documents fills this list/.test(body));
    check('a generic tail caption ("No") is extended from the page or refused with the reason — never staged',
          /LC\.isGenericCaption/.test(body) && /LC\.extendCaption\(caption, text,/.test(body) && /on its own that would match every/.test(body));
    check('a suspicious / type-heading / fallback caption stages nothing (fail toward "draw again")',
          /const clean = caption && !labelLooksSuspicious\(caption\) && !labelIsTypeHeading\(caption\);[\s\S]{0,80}if \(!clean\) \{\s*delete pendingAnchors\[fieldKey\];/.test(body));
  }
  check('the confirm commit routes a listCaption record to teachListCaption and never to saveFieldAnchor',
        /if \(pendingAnchors\[fk\] && pendingAnchors\[fk\]\.listCaption\) \{[\s\S]{0,500}window\.docusnap\.teachListCaption\?\.\(\{[\s\S]{0,200}label: _lc\.listCaption \}\);[\s\S]{0,500}continue;\s*\}[\s\S]{0,400}saveFieldAnchor\(\{ \.\.\.pendingAnchors\[fk\]/.test(rv));
  check('both windows load the ONE shared preview (review + teach index.html); the teach helper delegates to it',
        /<script src="\.\.\/shared\/listCaption\.js"><\/script>/.test(rhtml) && /<script src="\.\.\/shared\/listCaption\.js"><\/script>/.test(html)
        && /if \(typeof window !== 'undefined' && window\.ListCaption && window\.ListCaption\.previewValues\) return window\.ListCaption\.previewValues\(caption, ocrText\);/.test(js));
  {
    // The shared module is the source of truth — run the same behavioural cases against IT.
    const api = new Function('module', 'window', shared + '; return module.exports;')({ exports: {} }, undefined);
    const PAGE = 'Castellan Security Systems\nSERVICE WORKSHEET\nSerial No: CT-8051702\nIP Dome Camera 4MP    1\nSerial No: CT-8813265\nSerial  No : CT-8051702\n';
    check('shared previewValues: "Serial No" → both serials, deduped', JSON.stringify(api.previewValues('Serial No', PAGE)) === JSON.stringify(['CT-8051702', 'CT-8813265']));
    check('shared previewValues: the field LABEL "Serial Number" collects nothing on a page printing "Serial No"', api.previewValues('Serial Number', PAGE).length === 0);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
