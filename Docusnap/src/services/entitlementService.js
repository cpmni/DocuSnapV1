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
const SEATS_KEY = 'detached_client_seats';        // DEPRECATED local key — never read as entitlement (kept only for the migration test)
const SEARCH_SEATS_KEY = 'detached_search_seats';   // backend-cached: concurrent search clients
const WORKFLOW_SEATS_KEY = 'detached_workflow_seats'; // backend-cached: workflow add-on capacity
const SIGNED_KEY = 'detached_features_signed';      // set when the counts came from the SIGNED token (Phase 2)

function _readSetting(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null; // table missing / not initialised → treated as unset
  }
}

// Resolve a non-negative seat count from `key`. Entitlement is driven PURELY by this
// count (>0 ⇒ entitled), and the count is only ever written by the licensing handler from
// the VERIFIED token / backend /v1 response. There is NO local fallback key — a
// hand-edited local setting can never fabricate entitlement (P0 self-grant fix).
function _seatCount(getSetting, db, key) {
  const raw = parseInt(getSetting(db, key), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * @returns {{ entitled:boolean, feature:string, seats:number, reason:string,
 *             search:{entitled:boolean,seats:number}, workflow:{entitled:boolean,seats:number} }}
 *   PER-FEATURE: `search` is the base detached-client capability (a connected client holds
 *   a search seat); `workflow` is an add-on ON a held search seat (workflow ≤ search by
 *   construction at the backend). Top-level entitled/seats mirror SEARCH so existing
 *   callers (the seat pool / claimSeat) are unchanged. Counts come ONLY from the settings
 *   the licensing handler writes from the VERIFIED token / backend /v1 response
 *   (detached_search_seats / detached_workflow_seats) — there is NO local fallback, so a
 *   locally-edited setting can never fabricate entitlement. Default-deny: unset ⇒ 0 ⇒ not entitled.
 */
function checkClientEntitlement(db, deps = {}) {
  const getSetting = deps.getSetting || _readSetting;
  const searchSeats   = _seatCount(getSetting, db, SEARCH_SEATS_KEY);
  const workflowSeats = _seatCount(getSetting, db, WORKFLOW_SEATS_KEY);
  const search   = { entitled: searchSeats > 0,   seats: searchSeats };
  const workflow = { entitled: workflowSeats > 0, seats: workflowSeats };
  // Phase 2: the counts above are written from the SIGNED token when one is cached
  // (handler._syncSignedFeatures overrides the unsigned JSON), so an unsigned/tampered
  // JSON response cannot raise the caps; `signed` reflects that source. Old tokens fall
  // back to the Phase 1 JSON-cached counts (signed:false).
  const signed = getSetting(db, SIGNED_KEY) === 'true';
  return {
    entitled: search.entitled, feature: FEATURE, seats: search.seats,
    reason: search.entitled ? 'licensed' : 'not_licensed',
    search, workflow, signed,
  };
}

module.exports = { checkClientEntitlement, FEATURE, SETTING_KEY, SEATS_KEY, SEARCH_SEATS_KEY, WORKFLOW_SEATS_KEY, SIGNED_KEY };
