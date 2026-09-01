'use strict';
/**
 * test_error_logging.js — comprehensive per-file error record + the redaction contract (2026-09-01).
 * Both manual import and the watch folder route failures through processing.formatFileError, so its
 * split-by-sensitivity is parity. Run:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_error_logging.js
 */
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..');
const { formatFileError } = require('./handler');
const { _scrub } = require('../logger');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error('  x ' + n); } };

// A failure whose filename AND error text are both value-bearing (would leak on the always-on log).
const LEAKY_FILE = 'Invoice_ACME_Ltd_2026.pdf';
const LEAKY_ERR  = 'invalid literal for int() with base 10: INV-12345';
const TRACE = 'Traceback (most recent call last):\n  File "engine.py", line 900\nValueError: ' + LEAKY_ERR;
const msg = { success: false, status: 'error', original_filename: LEAKY_FILE, error: LEAKY_ERR,
              error_type: 'ValueError', stage: 'extract', page_index: 2, traceback: TRACE };
const fe = formatFileError(msg);

// ── the ALWAYS-ON log line must be SHAPE ONLY (no filename, no error text, no traceback) ──
ok('logLine has NO filename',   !fe.logLine.includes('ACME') && !fe.logLine.includes(LEAKY_FILE));
ok('logLine has NO error text', !fe.logLine.includes('INV-12345') && !fe.logLine.includes('invalid literal'));
ok('logLine has NO traceback',  !fe.logLine.includes('Traceback'));
ok('logLine names stage + type', fe.logLine.includes('stage=extract') && fe.logLine.includes('type=ValueError'));
// even after the logger's own scrub it must be unchanged (already leak-free by construction)
ok('logLine survives _scrub unchanged (nothing to redact)', _scrub(fe.logLine) === fe.logLine);
// and _scrub does NOT save a leaky line — proves shape-only is load-bearing, not incidental
const leakyLine = `File failed: ${LEAKY_FILE} — ${LEAKY_ERR}`;
ok('a naive filename+error log line WOULD leak (why shape-only matters)', _scrub(leakyLine).includes('INV-12345'));

// ── the DB summary (sensitive store) carries the human detail ──
ok('summary names stage', fe.summary.includes('extract'));
ok('summary names type',  fe.summary.includes('ValueError'));
ok('summary carries the message', fe.summary.includes('INV-12345'));

// ── the diaglog record (sensitive, admin-gated sink) carries EVERYTHING ──
ok('diag ev', fe.diag.ev === 'file_error');
ok('diag filename', fe.diag.filename === LEAKY_FILE);
ok('diag traceback', fe.diag.traceback === TRACE);
ok('diag stage/type/page', fe.diag.stage === 'extract' && fe.diag.error_type === 'ValueError' && fe.diag.page_index === 2);
ok('diag disposition', fe.diag.disposition === 'Errors');

// ── timeout shape ──
const tfe = formatFileError({ success: false, status: 'error', original_filename: 't.pdf',
  error: 'processing timed out after 300s (skipped to protect the batch)', stage: 'timeout', timeout_s: 300 });
ok('timeout logLine shape-only', tfe.logLine === 'File failed: stage=timeout type=Timeout');
ok('timeout diag carries timeout_s', tfe.diag.timeout_s === 300);

console.log(`\nerror-logging redaction: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
