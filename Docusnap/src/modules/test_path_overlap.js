'use strict';
// Unit test for modules/path_overlap.js (QA audit #8).
// Run: node src/modules/test_path_overlap.js
const { foldersOverlap, isWithin } = require('./path_overlap');
let fail = 0;
const eq = (l, got, want) => { const ok = got === want; console.log(`  ${ok ? 'OK ' : 'BAD'} ${l} => ${got}`); if (!ok) fail++; };

eq('equal folders overlap',            foldersOverlap('C:/Out', 'C:/Out'), true);
eq('child inside parent overlaps',     foldersOverlap('C:/Out/Sub', 'C:/Out'), true);
eq('parent contains child overlaps',   foldersOverlap('C:/Out', 'C:/Out/Sub'), true);
eq('siblings do NOT overlap',          foldersOverlap('C:/Out', 'C:/In'), false);
eq('prefix-but-not-nested no overlap', foldersOverlap('C:/Output', 'C:/Out'), false);   // "Output" != child of "Out"
eq('trailing slash normalised',        foldersOverlap('C:/Out/', 'C:/Out'), true);
eq('windows case-insensitive',         foldersOverlap('c:/out', 'C:/OUT'), process.platform === 'win32');
eq('empty a → no overlap',             foldersOverlap('', 'C:/Out'), false);
eq('empty b → no overlap',             foldersOverlap('C:/Out', ''), false);
eq('isWithin equal',                   isWithin('C:/Out', 'C:/Out'), true);
eq('isWithin not nested',              isWithin('C:/Out', 'C:/Out/Sub'), false);

console.log(fail ? `\n${fail} FAILED` : '\nAll path_overlap checks passed.');
process.exit(fail ? 1 : 0);
