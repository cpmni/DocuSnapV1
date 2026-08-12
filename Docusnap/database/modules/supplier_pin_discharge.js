'use strict';

/**
 * database/modules/supplier_pin_discharge.js — SUPPLIER_PIN_SELF_DISCHARGE (JS half).
 * gary design → Oracle SIGN-OFF-W/COND, 2026-08-12. The engine compares the NATURAL identity
 * read against the pin at the final re-assert and, when they normalise-equal, keeps the natural
 * row and emits `supplier_pin_discharged: {pin, value, method}` in file_done. This pure helper
 * decides whether the stored pin may be cleared.
 *
 * RACE GUARD (Oracle G7): the clear happens only when the CURRENT stored pin exactly equals the
 * pin string the engine judged. If the operator re-resolved the doc to a DIFFERENT name while the
 * reprocess ran, the new pin survives untouched — their newest decision always wins.
 * Pinned in test_supplier_pin_discharge.js.
 */

function shouldClearSupplierPin(storedPin, signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (!signal.pin || typeof signal.pin !== 'string') return false;
  if (storedPin == null) return false;                       // already cleared — nothing to do
  return String(storedPin).trim() === String(signal.pin).trim();
}

module.exports = { shouldClearSupplierPin };
