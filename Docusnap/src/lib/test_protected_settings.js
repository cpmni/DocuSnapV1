#!/usr/bin/env node
'use strict';

/**
 * src/lib/test_protected_settings.js
 * ----------------------------------
 * Pins isProtectedSettingKey — the SINGLE door shared by the generic `set-setting` IPC refuse AND
 * the settings-backup export/restore exclusion. A key that returns true here can never be written
 * through a user-facing door, only by the dedicated main-process handlers (setSetting direct).
 *
 * Guards (Sammy 2026-07-30): the entitlement/licensing/update keys (original M1), PLUS the LAN /v1
 * API config incl. the enrollment PAIRING SECRET (client_api_*, M2/M3) and the legal/onboarding GATE
 * state (terms_accepted / first_run_completed, H-1) — none may ride a crafted backup or set-setting.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_protected_settings.js  (plain node also fine — no native deps)
 */
const { isProtectedSettingKey } = require('./protectedSettings');
let fail = 0;
const yes = (k) => { const ok = isProtectedSettingKey(k) === true;  console.log(`  ${ok ? 'OK ' : 'BAD'} protected: ${k}`); if (!ok) fail++; };
const no  = (k) => { const ok = isProtectedSettingKey(k) === false; console.log(`  ${ok ? 'OK ' : 'BAD'} writable:  ${k}`); if (!ok) fail++; };

// MUST be protected
['detached_client_licensed', 'detached_search_seats', 'detached_workflow_seats', 'detached_features_signed',
 'update_info', 'license_time_hwm', 'licensing_whatever',
 'client_api_enabled', 'client_api_pairing_code', 'client_api_ca_fingerprint', 'client_api_port',
 'terms_accepted', 'first_run_completed'].forEach(yes);
// case-insensitive
['CLIENT_API_PORT', 'Terms_Accepted', 'Update_Info'].forEach(yes);
// MUST stay writable (normal operational settings a backup legitimately carries)
['theme', 'output_folder', 'filename_pattern', 'auto_file_threshold', 'critical_field_conf_floor',
 'processing_mode', 'watch_folder', 'template_learn_on_confirm'].forEach(no);

console.log(fail ? `\n${fail} FAILED` : '\nAll protected-setting-key checks passed');
process.exit(fail ? 1 : 0);
