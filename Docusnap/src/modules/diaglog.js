'use strict';

/**
 * modules/diaglog.js — deep diagnostic log (JSONL).
 *
 * Captures the full extraction TRACE (per-stage candidates, merge decisions,
 * crop bboxes, final values) plus decision-level events, to a per-session file
 * for forensic diagnosis. OFF by default — enabled by the `diagnostic_logging`
 * setting or the DOCUSNAP_DIAGNOSTIC_LOG=on env var. When off it is a complete
 * no-op and the extraction pipeline is byte-identical (the trace is only ever an
 * observer). One JSON event per line.
 *
 * Location: <project>/Debug in dev, <userData>/debug when packaged (mirrors how
 * processing.log resolves). Per-session file so a run is never truncated
 * mid-investigation. NEVER writes secrets (license keys/fingerprints/tokens) —
 * it does write document field values + OCR text, so treat the file as sensitive
 * as the documents themselves.
 */

const path = require('path');
const fs   = require('fs');

let _app = null, _stream = null, _file = null, _enabled = false;

function init(app) { _app = app; }

function _dir() {
  if (_app && _app.isPackaged) return path.join(_app.getPath('userData'), 'debug');
  return path.join(__dirname, '..', '..', 'Debug');   // src/modules -> project root
}

// Idempotent: opens a fresh per-session file the first time it's enabled.
function enable() {
  if (_enabled) return _file;
  try {
    const dir = _dir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    _file   = path.join(dir, `diagnostic_${stamp}.jsonl`);
    _stream = fs.createWriteStream(_file, { flags: 'a' });
    _enabled = true;
    write({ ev: 'diag_start', file: _file, started_at: new Date().toISOString() });
  } catch { _enabled = false; }
  return _file;
}

function isEnabled() { return _enabled; }
function currentFile() { return _file; }

// Write one event. Always stamps a timestamp. No-op when disabled. Large string
// fields should be truncated by the caller; image bytes are never written
// (reference the slice PNG path instead).
function write(obj) {
  if (!_enabled || !_stream) return;
  try { _stream.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); }
  catch { /* diagnostics must never disrupt processing */ }
}

function close() {
  try { _stream && _stream.end(); } catch {}
  _stream = null; _enabled = false;
}

module.exports = { init, enable, isEnabled, currentFile, write, close };
