'use strict';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

let _path = null;
let _fs   = null;
// REDACTION IS THE DEFAULT (2026-08-09 NIGHT, pre-release data audit).
// This log runs ALWAYS, with no toggle and no mention anywhere in the UI, and it was writing
// supplier and customer names, VAT numbers, references, totals and absolute paths into
// %APPDATA%\ScanFinder\processing.log. On this machine that was 1,139 money amounts, 2,567
// supplier mentions and 685 user paths. Diagnostic logging — which records much the same content —
// is off by default, admin-gated and documents itself as sensitive; the support log did most of the
// same with none of the ceremony. It is the first thing anybody would grep in a support bundle, a
// screen-share or a backup.
// So the SHAPE of every line is kept (which field, which stage, which confidence, which method,
// what failed) and the CONTENT is not. An admin who turns Diagnostic Logging on gets the full
// detail, in the place that already warns about what it holds.
let _detailed = false;

function init(logPath, fs) {
  _path = logPath;
  _fs   = fs;
  _write('INFO', '══════════════════ DocuSnap started ══════════════════');
}

// Quoted values ('ACME Ltd', "GB 903 3318 42") and Windows paths are where the customer's data
// actually lives in these lines. Both are replaced with a marker that keeps the line readable and
// says plainly that something was removed, so a support reader is never misled into thinking a
// field came back empty. Deliberately blunt: a scrubber that tries to be clever about WHICH values
// matter is a scrubber that will one day decide a bank account number is fine.
const _QUOTED  = /(['"]).{2,}?\1/g;
const _WINPATH = /\b[A-Za-z]:\\[^\s"'()]+/g;

function _scrub(msg) {
  return String(msg).replace(_QUOTED, "'<redacted>'").replace(_WINPATH, '<path>');
}

/** Full detail is opt-in and admin-gated — it follows the Diagnostic Logging setting. */
function setDetailed(on) { _detailed = !!on; }

function _write(level, msg) {
  if (!_path || !_fs) return;
  try {
    const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${_detailed ? msg : _scrub(msg)}\n`;
    _fs.appendFileSync(_path, line, 'utf8');
    _trimIfNeeded();
  } catch {}
}

function _trimIfNeeded() {
  try {
    if (_fs.statSync(_path).size <= MAX_BYTES) return;
    const content = _fs.readFileSync(_path, 'utf8');
    const lines   = content.split('\n').filter(Boolean);
    // Drop the oldest half, keeping the most recent entries
    const keep    = lines.slice(Math.ceil(lines.length / 2));
    _fs.writeFileSync(_path, keep.join('\n') + '\n', 'utf8');
  } catch {}
}

const log  = (msg) => _write('INFO',  String(msg));
const warn = (msg) => _write('WARN',  String(msg));
const err  = (msg) => _write('ERROR', String(msg));

module.exports = { init, log, warn, err, setDetailed, _scrub };
