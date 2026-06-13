#!/usr/bin/env node
'use strict';

/**
 * generate_keys.js — licensing signing key generation (host-side, backend only).
 *
 * Generates an Ed25519 keypair for a given key id (kid):
 *   - PRIVATE key (PKCS8 PEM)  → licensing-backend/keys/ed25519_<kid>_private.pem
 *     (this directory is .gitignored and is NEVER part of the client bundle)
 *   - PUBLIC  key (SPKI DER, base64, single line) → printed to stdout
 *     (paste into config/license.json under publicKeys[<kid>])
 *
 * Also prints a fresh product_id (UUID) for convenience on first setup.
 *
 * Usage (from project root):
 *   node licensing-backend/scripts/generate_keys.js [kid]
 *
 * API-first / host-portable: the same script runs on the WAMP VM or the future
 * IONOS host; only the public half ever ships with the desktop client.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const kid     = process.argv[2] || 'k1';
const keysDir = path.join(__dirname, '..', 'keys');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

fs.mkdirSync(keysDir, { recursive: true });
const privPath = path.join(keysDir, `ed25519_${kid}_private.pem`);
fs.writeFileSync(privPath, privatePem, { mode: 0o600 });

console.log(JSON.stringify({
  kid,
  product_id: crypto.randomUUID(),
  public_key_spki_b64: publicDerB64,
  private_key_written_to: privPath,
}, null, 2));
