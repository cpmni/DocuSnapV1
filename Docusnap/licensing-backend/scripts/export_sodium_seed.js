#!/usr/bin/env node
'use strict';

/**
 * export_sodium_seed.js — derive the raw Ed25519 SEED (32 bytes, base64) from an
 * existing PKCS8 private key, for PHP libsodium signing (sodium_crypto_sign_
 * seed_keypair). Keeps the SAME keypair the client already pins — no churn.
 *
 * Output (host-only, .gitignored): keys/ed25519_<kid>_sodium_seed.b64
 *
 * Usage (from project root):
 *   node licensing-backend/scripts/export_sodium_seed.js [kid]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const kid = process.argv[2] || 'k1';
const keysDir = path.join(__dirname, '..', 'keys');
const pemPath = path.join(keysDir, `ed25519_${kid}_private.pem`);

const priv = crypto.createPrivateKey(fs.readFileSync(pemPath));
const jwk = priv.export({ format: 'jwk' });          // OKP/Ed25519: d = 32-byte seed (base64url)
const seed = Buffer.from(jwk.d, 'base64url');
if (seed.length !== 32) throw new Error('unexpected seed length: ' + seed.length);

const outPath = path.join(keysDir, `ed25519_${kid}_sodium_seed.b64`);
fs.writeFileSync(outPath, seed.toString('base64'), { mode: 0o600 });
console.log('wrote', outPath);
