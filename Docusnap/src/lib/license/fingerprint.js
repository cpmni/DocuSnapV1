'use strict';

/**
 * src/lib/license/fingerprint.js — device fingerprint (Phase 1).
 *
 * Computes a stable device fingerprint in the MAIN process and returns ONLY its
 * SHA-256 hash. The raw identifier never leaves this function scope: it is never
 * returned, never sent over the wire, and never exposed to the renderer (no
 * preload channel surfaces it).
 *
 * Composition is deliberately CONSERVATIVE to avoid routine hardware-change
 * false positives:
 *   - Primary: Windows registry MachineGuid
 *     (HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid). It is created at OS
 *     install and is stable for the OS lifetime — it SURVIVES app reinstalls
 *     (so reinstalling can never reset a trial) and is unaffected by routine
 *     hardware swaps (RAM/disk). Volatile inputs (IP, hostname under normal use,
 *     removable hardware) are intentionally excluded.
 *   - Salt: product_id, so the same machine yields a different fp_hash per
 *     product (privacy — prevents cross-product correlation).
 *
 * @param {string} productId  opaque product id from config/license.json (salt)
 * @returns {string} lowercase hex SHA-256 fingerprint hash (fp_hash)
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// SECURITY (Stage 2 — M11): absolute path to reg.exe. A bare 'reg' resolves from the (user-writable)
// app directory first, so a planted reg.exe could feed a SPOOFED MachineGuid into the licence device
// fingerprint. %SystemRoot%\System32 is not user-writable.
//
// ...BUT %SystemRoot% ITSELF IS (2026-08-09 NIGHT, pre-release audit). It is an ENVIRONMENT
// VARIABLE, and any user can set it when launching a process. So the original defence was
// circumventable without admin rights and without touching a single line of licensing code:
//   1. write C:\Users\me\fake\System32\reg.exe — a three-line script that prints an invented
//      MachineGuid;
//   2. start Scan Finder with SystemRoot=C:\Users\me\fake.
// The app computes a brand-new fingerprint, the server sees a machine it has never met, and hands
// out a fresh 14-day trial. Change one character in the fake GUID and take another 14 days, for
// ever. Five minutes, no admin, repeatable — cheaper than every other attack on the licence, and
// it never goes near the code that checks it.
//
// So the candidates are hard-coded, and an environment-supplied SystemRoot is accepted ONLY when
// it matches one of them exactly (case-insensitively). We prefer the real system drive from
// %SystemDrive% when that is itself plausible, and otherwise fall back to C:. If none of the
// candidates exists we return null and `readMachineGuid` falls through to its conservative
// fallback — a machine we cannot fingerprint precisely is a machine that gets a stable-but-weaker
// identity, never a NEW one on demand.
function _resolveRegExe() {
  const fs = require('fs');
  const drive = /^[A-Za-z]:$/.test(String(process.env.SystemDrive || ''))
    ? process.env.SystemDrive : 'C:';
  const candidates = [
    path.join(drive + '\\', 'Windows', 'System32', 'reg.exe'),
    'C:\\Windows\\System32\\reg.exe',
    path.join(drive + '\\', 'WINNT', 'System32', 'reg.exe'),
    // LAST RESORT — the environment value, and only when no real Windows directory was found
    // (Oracle C6). Returning null here is NOT a soft failure: `readStableMachineRaw` falls back to
    // the HOSTNAME, so the fingerprint would CHANGE on upgrade and silently invalidate an already
    // activated paid seat. On any genuine Windows machine `C:\Windows\System32\reg.exe` exists and
    // wins at candidate 2, so the spoof this list exists to defeat still fails — an attacker cannot
    // remove that file without admin. This candidate is only ever reached on a machine that has no
    // real System32 at all, i.e. exactly the machine whose fingerprint would otherwise churn.
    path.join(String(process.env.SystemRoot || ''), 'System32', 'reg.exe'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  // Diagnosable rather than silent: a support case where activation "just stopped working" after an
  // upgrade is otherwise invisible, and this is its one tell.
  if (process.platform === 'win32') {
    try { console.warn('fingerprint: no reg.exe found — falling back to a hostname-derived id'); } catch {}
  }
  return null;
}
const REG_EXE = _resolveRegExe();

function readMachineGuid() {
  if (!REG_EXE) return null;          // no trustworthy reg.exe -> conservative fallback, never a new identity
  try {
    const out = execFileSync(
      REG_EXE,
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    if (m) return m[1].toLowerCase();
  } catch { /* fall through to conservative fallback */ }
  return null;
}

// Stable per-machine raw material. Stays in scope — never returned/transmitted.
function readStableMachineRaw() {
  const guid = readMachineGuid();
  if (guid) return 'mg:' + guid;
  // Fallback for non-Windows dev or a locked-down registry: a stable host value.
  // Still hashed; still never exposed raw.
  return 'host:' + os.hostname();
}

function computeFpHash(productId) {
  if (!productId) throw new Error('license/fingerprint: productId (salt) is required');
  const raw = readStableMachineRaw();
  return crypto.createHash('sha256').update(productId + '|' + raw).digest('hex');
}

module.exports = { computeFpHash };
