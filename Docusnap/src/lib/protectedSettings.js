'use strict';

// SECURITY (Stage 2 — M1, Oracle C1): the SINGLE source of truth for setting keys that encode
// ENTITLEMENT / LICENSING / update state. They must never be writable through ANY user-facing door —
// neither the generic `set-setting` IPC nor a restored settings backup — because they are written
// only by the main-process sync paths (licensing/handler `_syncSignedFeatures`, the /v1 activation
// flow), which call `learning.setSetting()` directly. Shared by `src/modules/settings/handler.js`
// (set-setting refuse) AND `src/services/backupService.js` (backup exclude) so the two doors can't
// drift — the original drift (backup filtered only the substring 'licens', letting `detached_*_seats`
// ride a crafted backup and self-grant the paid add-on on restore) is exactly what this closes.
const _KEYS = new Set([
  'detached_client_licensed', 'detached_search_seats', 'detached_workflow_seats',
  'detached_features_signed', 'update_info',
  // GATE STATE (Sammy H-1): flipping these via a restored backup / the generic set-setting door
  // bypasses the legal-acceptance and first-run gates. They are written only by the dedicated
  // legal-accept / onboarding-complete flows (setSetting direct), so protecting the generic door
  // + backup here never blocks the real path.
  'terms_accepted', 'first_run_completed',
]);

function isProtectedSettingKey(key) {
  const s = String(key == null ? '' : key).toLowerCase();
  // client_api_* (Sammy M-2/M-3): the LAN /v1 API host/port/cert PATHS + the enrollment PAIRING
  // SECRET. Exporting them leaks LAN topology + the pairing secret; restoring them lets a crafted
  // backup stand up the API with a pairing code the attacker knows. Written only by the dedicated
  // client-api enable/cert handlers (setSetting direct), never the generic door — so excluding them
  // from set-setting + backup is safe.
  return _KEYS.has(s) || /^licens/.test(s) || s.includes('licens') || s.startsWith('client_api');
}

module.exports = { isProtectedSettingKey };
