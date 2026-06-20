'use strict';

/**
 * services/entitlementService.js
 * ------------------------------
 * Decides whether the DETACHED CLIENT feature is licensed for this core install —
 * the add-on entitlement the client "grabs" when it connects. Kept separate from
 * the core licensing GATE (src/modules/licensing): that gate decides whether the
 * app may run at all; this decides whether the optional detached-client feature is
 * included in the customer's license.
 *
 * MVP source of truth: a per-install setting `detached_client_licensed`
 * ('true'/'1'), DEFAULT-DENY (absent → not entitled), which the licensing system
 * (or an admin) sets when the add-on is purchased. A later follow-up can derive
 * this from a feature claim in the signed license token instead — the API only
 * depends on this function's result, so that swap won't ripple.
 *
 * Reads the settings table directly (no learning-module dependency) so it stays
 * trivially testable and safe when the table is absent.
 */

const FEATURE = 'detached_client';
const SETTING_KEY = 'detached_client_licensed';
const SEATS_KEY = 'detached_client_seats';   // licensed concurrent-client seat count

function _readSetting(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null; // table missing / not initialised → treated as unset
  }
}

/**
 * @returns {{ entitled:boolean, feature:string, seats:number, reason:string }}
 *   seats = the licensed concurrent-client seat cap (0 when not entitled; defaults to
 *   1 when entitled but the count is unset). The detached-client SEAT POOL enforces it.
 */
function checkClientEntitlement(db, deps = {}) {
  const getSetting = deps.getSetting || _readSetting;
  const val = getSetting(db, SETTING_KEY);
  const entitled = val === 'true' || val === '1';
  const seatsRaw = parseInt(getSetting(db, SEATS_KEY), 10);
  const seats = entitled ? (Number.isFinite(seatsRaw) && seatsRaw > 0 ? seatsRaw : 1) : 0;
  return { entitled, feature: FEATURE, seats, reason: entitled ? 'licensed' : 'not_licensed' };
}

module.exports = { checkClientEntitlement, FEATURE, SETTING_KEY, SEATS_KEY };
