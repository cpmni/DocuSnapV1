'use strict';
// Anti-trial-stacking anchor for Settings backup RESTORE (Chris card 7, security review 2026-09-15).
//
// The origin fingerprint embedded in a backup file is UNTRUSTED. To read a backup the
// attacker already holds BOTH the file and its password, and this machine's fingerprint is
// a deterministic hash of locally-readable public data (product_id from the bundled config
// + the machine's MachineGuid), so a crafted/edited backup can set `device_fp` to match ANY
// target machine. "Same machine == the embedded device_fp equals mine" can therefore never
// authorise a restore — machine B can always mint a "made on B" claim for arbitrary content
// (it must, to make its own legitimate backups), so the file cannot distinguish "my own
// backup" from "someone else's backup relabelled as mine".
//
// The ONLY anchor a non-origin machine cannot mint is a SIGNATURE-VERIFIED, fp-bound, active
// PAID seat — the same anchor the whole licence gate already trusts (evaluateCachedAccess →
// token.evaluate: alg/kid-pinned, fp-bound, verify-before-claims; a verified TRIAL must not
// unlock import). This predicate takes ONLY the evaluated licence access. It deliberately
// does NOT accept `device_fp`, so same-machine equality can never be reintroduced through it.
function deviceImportAllowed(access) {
  if (access && access.decision === 'allow' && access.claims && access.claims.kind === 'seat') {
    return { allowed: true };
  }
  return { allowed: false };
}

module.exports = { deviceImportAllowed };
