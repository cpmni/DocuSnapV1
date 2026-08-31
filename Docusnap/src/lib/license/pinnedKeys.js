'use strict';

/**
 * src/lib/license/pinnedKeys.js — the PINNED offline-licence verification keys, baked
 * INTO the application bundle (the asar), NOT read from a loose file.
 *
 * WHY THIS EXISTS (SEC — offline forge hardening):
 * The offline licence gate is only as trustworthy as the public keys it verifies signatures
 * against. Those keys used to be read solely from `config/license.json`, which ships via
 * electron-builder `extraResources` — i.e. as a PLAIN, USER-EDITABLE FILE in the packaged app's
 * `resources/` directory. An attacker could therefore:
 *   1. generate their own Ed25519 keypair,
 *   2. overwrite `public_keys` in that loose file with their own public key,
 *   3. sign a token with the matching private key for their own fingerprint,
 * and the gate would verify it and grant access forever — a full offline licence bypass, with
 * nothing but a text editor.
 *
 * By baking the keys here (inside the asar) and having the config loader USE THESE instead of the
 * loose file's `public_keys`, swapping the loose file has no effect: verification always uses these
 * keys, which an attacker cannot change without repacking the asar (and, once the asar-integrity
 * fuse lands — build hardening 3b — defeating that check too).
 *
 * These are PUBLIC keys — safe to embed. The matching PRIVATE keys live ONLY on the licensing
 * server (and a dev box), are `.gitignore`d (`licensing-backend/keys/*`), and are never bundled.
 *
 * ROTATION: these MUST stay identical to `config/license.json` `public_keys` / `active_kid`. A key
 * rotation is a signed-build event — update BOTH this file and the config, then ship a new build.
 * `database/modules/test_license_pinned_keys.js` pins baked === config so a drift fails the suite.
 */

// Verbatim copy of config/license.json `public_keys` (kid -> { alg, format, key }).
const PINNED_PUBLIC_KEYS = Object.freeze({
  k1: Object.freeze({
    alg: 'EdDSA',
    format: 'spki-der-b64',
    key: 'MCowBQYDK2VwAyEA+2H2pdoru2atMzZENhcDwvf8vbVgc6mrhtYzwQq3ckI=',
  }),
  k2: Object.freeze({
    alg: 'EdDSA',
    format: 'spki-der-b64',
    key: 'MCowBQYDK2VwAyEAcWip1ghIjThDnfUkW4HUdCvtnzc7G7SuAJfzWG8ATVI=',
  }),
});

const PINNED_ACTIVE_KID = 'k1';

module.exports = { PINNED_PUBLIC_KEYS, PINNED_ACTIVE_KID };
