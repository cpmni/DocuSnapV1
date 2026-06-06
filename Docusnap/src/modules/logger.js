'use strict';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

let _path = null;
let _fs   = null;

function init(logPath, fs) {
  _path = logPath;
  _fs   = fs;
  _write('INFO', '══════════════════ DocuSnap started ══════════════════');
}

function _write(level, msg) {
  if (!_path || !_fs) return;
  try {
    const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${msg}\n`;
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

module.exports = { init, log, warn, err };
