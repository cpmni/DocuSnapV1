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
const { execFileSync } = require('child_process');

function readMachineGuid() {
  try {
    const out = execFileSync(
      'reg',
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
