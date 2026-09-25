'use strict';
/*
 * test_teach_suggest.js — SUGGESTED-TEACH in the guided wizard (mig 220 `suggested_teach_enabled`, DARK;
 * owner idea → 007+reggie+eric → Oracle SIGN-OFF-W/COND C-A/C-B). Pins the WIRING + the two Oracle
 * ship-blockers, since the whole feature is source-structure (no jsdom): a missing link turns it off or
 * unsafe silently.
 *
 * What it guards:
 *  - the DARK kill switch (byte-identical OFF: maybeSuggestField early-returns on !SUGGEST_ON);
 *  - the value SOURCE = the IMPORT keyword reads (getDocumentWithExtractions), raw_value the locate target;
 *  - the hook fires from promptField AFTER the manual prompt is armed (fire-and-forget, draw stands);
 *  - it REUSES the shipped typed-locate path (locateTypedValue → showLocatedPick → useLocatedBox), never a
 *    second OCR/picker, and commits with valueSource:'read' so the value-correction row shows;
 *  - C-B: suggestOffered marked BEFORE the OCR await + the doc/page/angle/curField/drag/results race bails;
 *  - MULTIPLE never auto-picks (showLocatedPick), issuer/list/barcode excluded;
 *  - canAdvance BLOCKS advancing while any field is pending (the human checkpoint that replaces Review's C4);
 *  - the transport exposes getDocumentWithExtractions.
 *
 *   node src/windows/teach/test_teach_suggest.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const raw = fs.readFileSync(path.join(__dirname, '..', 'shared', 'teach-ui', 'teach.js'), 'utf8');
// Normalise CRLF→LF FIRST (the tree is core.autocrlf, so lines carry a trailing \r that `.` won't
// match — leaving comments un-stripped and the \s* gaps below unjumpable), then strip line comments
// (the comments describe the design in prose, so a naive scan could match the very text it checks).
const js = raw.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const transport = fs.readFileSync(path.join(__dirname, 'coreTeachTransport.js'), 'utf8');

console.log('\nTHE SWITCH (DARK, byte-identical OFF)');
check('SUGGEST_ON is a module-level switch',
      /let SUGGEST_ON\s*=\s*false\s*;/.test(js));
check('it reads the suggested_teach_enabled setting, default OFF',
      /getSetting\?\.\('suggested_teach_enabled'\)\.then\(\s*v\s*=>\s*\{\s*SUGGEST_ON\s*=\s*v\s*===\s*'true'/.test(js));
check('maybeSuggestField early-returns FIRST on !SUGGEST_ON (no page-words spawn when off)',
      /function maybeSuggestField\([^)]*\)\s*\{\s*if\s*\(!SUGGEST_ON/.test(js));
check('the import-value fetch is gated on the switch + the transport method',
      /if\s*\(SUGGEST_ON\s*&&\s*D\.getDocumentWithExtractions\s*&&\s*state\.importValues === null/.test(js));

console.log('\nVALUE SOURCE = the IMPORT keyword reads');
check('fetch reads the doc extractions via the transport',
      /await D\.getDocumentWithExtractions\(state\.doc\.id\)/.test(js));
check('raw_value is the locate target (falls back to display_value)',
      /e\.raw_value\s*\?\?\s*e\.display_value/.test(js));
check('the transport exposes getDocumentWithExtractions',
      /getDocumentWithExtractions:\s*\(\.\.\.a\)\s*=>\s*d\.getDocumentWithExtractions\(\.\.\.a\)/.test(transport));

console.log('\nTHE HOOK — fire-and-forget after the manual prompt is armed');
check('promptField calls renderFieldPrompt THEN maybeSuggestField',
      /renderFieldPrompt\(\);\s*maybeSuggestField\(f\);/.test(js));

console.log('\nREUSE the shipped typed-locate path (no second OCR / picker)');
check('maybeSuggestField locates via the shared locateTypedValue',
      /function maybeSuggestField[\s\S]{0,900}await locateTypedValue\(/.test(js));
check('it routes through the shipped showLocatedPick (never a new picker)',
      /function maybeSuggestField[\s\S]{0,1400}showLocatedPick\(f, String\(value\), hits, 0, \{ onYes:/.test(js));
check('it commits via useLocatedBox with valueSource:read (value-correction row shows)',
      /onYes:\s*\(box\)\s*=>\s*useLocatedBox\(f, String\(value\), box, \{ valueSource:\s*'read' \}\)/.test(js));
check('useLocatedBox takes a valueSource opt (default typed = shipped behaviour)',
      /async function useLocatedBox\(f, value, box, opts\)\{[\s\S]{0,200}const src\s*=\s*\(opts && opts\.valueSource\)\s*\|\|\s*'typed';/.test(js));
check('located is set ONLY when typed (a read value keeps the correction row)',
      /if\s*\(src === 'typed'\)\s*state\.results\[f\.key\]\.located = true;/.test(js)
      && !/state\.results\[f\.key\]\.located = true;\s*\n\s*state\.results\[f\.key\]\.valueSource = 'typed'/.test(js));
check('showLocatedPick threads opts.onYes (default = shipped typed useLocatedBox)',
      /const _yes\s*=\s*\(opts && opts\.onYes\)\s*\|\|\s*\(\(box\)=>useLocatedBox\(f, typed, box\)\)/.test(js));

console.log('\nC-B — the async race guards (a late suggest cannot clobber the operator)');
check('suggestOffered is marked BEFORE the OCR await',
      /state\.suggestOffered\.add\(f\.key\);[\s\S]{0,300}await locateTypedValue/.test(js));
check('it bails if already offered (no re-suggest loop after Redraw)',
      /if\s*\(state\.suggestOffered\.has\(f\.key\)\)\s*return;/.test(js));
check('after the await it bails on any frame change (doc / page / angle)',
      /if\s*\(state\.doc\?\.id !== openDocId \|\| state\.pageIndex !== openPage \|\| state\.deskewAngle !== openAngle\)\s*return;/.test(js));
check('after the await it bails if the operator drew / moved field / a result exists',
      /if\s*\(curField\(\) !== f \|\| drag \|\| state\.results\[f\.key\]\)\s*return;/.test(js));
check('NONE (no hit) leaves the manual draw prompt standing',
      /if\s*\(!hits \|\| !hits\.length\)\s*return;/.test(js));

console.log('\nEXCLUSIONS + the human checkpoint (canAdvance)');
check('issuer / list / barcode are excluded from suggestion',
      /if\s*\(isIssuerField\(f\)\s*\|\|\s*isListField\(f\)\s*\|\|\s*f\.auto === 'barcode'\)\s*return;/.test(js));
check('canAdvance step 3 BLOCKS advancing while any field is pending (replaces Review C4)',
      /case 3:\s*return state\.fields\.length>0 && state\.fields\.every\(f => \{[\s\S]{0,120}status !== 'pending'/.test(js));

console.log('\nNO dependency on the removed Review-only SuggestTeach reducer');
check('the wizard does not reference SuggestTeach (it uses ValueLocate via locateTypedValue)',
      !/SuggestTeach/.test(js));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
