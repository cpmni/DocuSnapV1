'use strict';

// Record the user's chosen output/documents folder in the Windows registry
// (HKCU\Software\ScanFinder\OutputPath) so the NSIS uninstaller can REFUSE to delete an
// app-data folder that contains it.
//
// The uninstaller's optional "remove all data" step wipes %APPDATA%\ScanFinder,
// %APPDATA%\DocuSnap and %LOCALAPPDATA%\ScanFinder. The output folder normally sits well
// outside those (default: Documents\Scan Finder), so filed documents are never touched. This
// guards the one edge case where a user pointed their output folder INSIDE one of them — the
// uninstaller reads this value and skips any wipe target that equals or contains it, so a
// data-wipe can never take the user's processed documents.
//
// Best-effort + Windows-only; never throws into the caller. Uses reg.exe (present on every
// Windows install) via execFile with fixed args (no shell → no injection from the path).

const { execFile } = require('child_process');
const path = require('path');

function recordOutputPath(outputPath) {
  try {
    if (process.platform !== 'win32') return;
    const p = String(outputPath == null ? '' : outputPath).trim();
    if (!p) return;
    // Prefer the absolute System32 path so a stripped PATH can't stop the write; fall back to
    // the bare name. execFile (no shell) + fixed args → the user's path can't inject anything.
    const regExe = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'reg.exe')
      : 'reg';
    execFile(
      regExe,
      ['add', 'HKCU\\Software\\ScanFinder', '/v', 'OutputPath', '/t', 'REG_SZ', '/d', p, '/f'],
      { windowsHide: true },
      () => { /* best-effort; ignore success/failure */ },
    );
  } catch { /* best-effort — must never disturb the caller */ }
}

module.exports = { recordOutputPath };
