// Issuer-teach decisions (Chris round 2026-09-01, cards 1+2 — eric + Oracle SIGN-OFF-W/COND C1-C8).
//
// Two PURE decisions the Review renderer consults so a garbled Document-Issuer read can neither
// stand up a stale sibling-ripple offer nor overwrite a correct value in the field:
//
//   shouldOfferIssuerRipple({ read, implausible })
//     The "Apply “X” to N siblings & re-read" bar is only offered for a read the plausibility
//     predicate (learning.issuerReadLooksImplausible via check-issuer-read) did NOT flag. Empty →
//     never. With the kill switch OFF the IPC answers implausible:false, so the decision is
//     identical to today's (offer whenever there's a read).
//
//   shouldDrawnReadReplaceField({ read, priorValue, implausible, fieldKey })
//     A ⊕/drawn-box read replaces the field's current value EXCEPT the one case Oracle C2 names:
//     fieldKey === 'supplier_name' AND the field already holds a non-empty value AND the read is
//     implausible — then the prior value is kept and the read is offered as a "Use “X”" action
//     instead. Every other key (customer_name included — the guard is NOT widened to
//     _isNameLikeField, C2) and every empty-prior case keeps today's behaviour. An empty read never
//     writes (today's `if (text)` gate, restated here so the decision is complete).
//
// Both are dual-exported (window global for the renderer, module.exports for the pins) with NO
// DOM/IPC access — the callers compute `implausible` from the ONE check-issuer-read result and
// thread it in (C5).
(function (root) {
  'use strict';

  const SUPPLIER_KEY = 'supplier_name';

  function _s(v) { return typeof v === 'string' ? v.trim() : ''; }

  function shouldOfferIssuerRipple(opts) {
    const read = _s(opts && opts.read);
    if (!read) return false;
    return !(opts && opts.implausible === true);
  }

  function shouldDrawnReadReplaceField(opts) {
    const read = _s(opts && opts.read);
    if (!read) return false;
    const key = opts && typeof opts.fieldKey === 'string' ? opts.fieldKey : '';
    if (key !== SUPPLIER_KEY) return true;
    const prior = _s(opts && opts.priorValue);
    if (!prior) return true;
    return !(opts && opts.implausible === true);
  }

  const api = { shouldOfferIssuerRipple, shouldDrawnReadReplaceField, SUPPLIER_KEY };
  root.IssuerTeachDecision = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
