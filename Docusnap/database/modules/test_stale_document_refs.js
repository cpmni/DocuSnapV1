#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_stale_document_refs.js
 * --------------------------------------------
 * Pins documents.resolveFilePath + documents.filterExisting — the reusable layer
 * that keeps documents whose physical file was deleted out of search results
 * (without hard-deleting the audit rows). Uses an injectable existsFn so it's
 * deterministic and needs no real files on disk.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_stale_document_refs.js
 */

const path = require('path');
const documents = require('./documents');

function check(l, c) { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); return c; }

let fail = 0;

// ── resolveFilePath ────────────────────────────────────────────────────────
const confirmedDoc   = { status: 'confirmed', stored_path: 'C:/out/Acme/Invoice.1.pdf', stored_filename: 'Invoice.1.pdf', folder_path: 'C:/in', original_filename: 'scan1.pdf' };
const reviewDoc      = { status: 'needs_review', folder_path: 'C:/in', original_filename: 'scan2.pdf' };
const deferredDoc    = { status: 'deferred', folder_path: 'C:/in', original_filename: 'scan3.pdf' };
const noPathDoc      = { status: 'needs_review' };  // unresolvable

fail += !check('confirmed doc resolves to its filed stored_path',
  documents.resolveFilePath(confirmedDoc) === 'C:/out/Acme/Invoice.1.pdf');
fail += !check('needs_review doc resolves to folder_path/original_filename',
  documents.resolveFilePath(reviewDoc) === path.join('C:/in', 'scan2.pdf'));
fail += !check('a row with no usable path resolves to null',
  documents.resolveFilePath(noPathDoc) === null);

// ── filterExisting (injected existsFn) ──────────────────────────────────────
// Only the confirmed doc's filed file and the deferred doc's source still exist.
const present = new Set(['C:/out/Acme/Invoice.1.pdf', path.join('C:/in', 'scan3.pdf')]);
const existsFn = (p) => present.has(p);

const rows = [confirmedDoc, reviewDoc, deferredDoc, noPathDoc];
const kept = documents.filterExisting(rows, existsFn);

fail += !check('confirmed doc with an existing stored file is KEPT', kept.includes(confirmedDoc));
fail += !check('needs_review doc whose source file is missing is EXCLUDED', !kept.includes(reviewDoc));
fail += !check('deferred doc whose source file still exists is KEPT', kept.includes(deferredDoc));
fail += !check('row with no resolvable path is KEPT (never assumed stale)', kept.includes(noPathDoc));

// A confirmed doc whose filed file was deleted out-of-band is excluded.
const deletedConfirmed = { status: 'confirmed', stored_path: 'C:/out/Acme/Gone.pdf' };
fail += !check('confirmed doc whose stored file was deleted is EXCLUDED',
  documents.filterExisting([deletedConfirmed], existsFn).length === 0);

// Empty/undefined input is safe.
fail += !check('filterExisting handles empty/undefined input',
  documents.filterExisting([], existsFn).length === 0 && documents.filterExisting(undefined, existsFn).length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nAll stale-document-ref checks passed');
process.exit(fail ? 1 : 0);
