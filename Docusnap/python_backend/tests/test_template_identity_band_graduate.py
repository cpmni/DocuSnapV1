"""S1 — TEMPLATE-IDENTITY BAND GRADUATE (gary-designed, Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-28).

A MAJORITY-tier template_identity FILL (@70 + "Company inferred from previously filed documents"
note) sheds its review NOTE — becoming an un-noted {value:V, confidence:85, method:
'template_identity_corroborated'} — ONLY when the filled issuer name is INDEPENDENTLY printed in
this page's ISSUER BAND. Value is FIXED to V (never swaps supplier). DEFAULT OFF
(TEMPLATE_IDENTITY_BAND_GRADUATE) => OFF is byte-identical.

Pins the Oracle conditions:
  kill-off          — S1 unset/'0' -> never sheds (byte-identical).
  band-kill (C2)    — ISSUER_HINT_BAND='0' -> never sheds (must not shed off the raw ocr_text[:600]).
  single-tier       — a SINGLE-tier note is never shed (accepted trade-off lock).
  eligibility       — only a still-NOTED 'template_identity' fill is shed-eligible; the un-noted @90
                      override / an already-shed value / other methods are NOT.
  descriptor-subset — (C1) a same-trade descriptor subset ('...water systems' minus 'Cascade') does
                      NOT shed (the >=60% FILL test would; ALL-tokens closes it).
  strict-corrob     — full normalised value as a band substring, OR every distinctive token whole-word.
  lone-short-token  — a single short token (<6) can never shed; a single long token present can.
  recipient-absent  — a value absent from the (truncated) band never sheds -> the recipient
                      self-corroboration hole stays closed.

Run:  py -3.12 tests/test_template_identity_band_graduate.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import (ExtractionEngine, _identity_corroborated_strict,
                               _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY,
                               _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def majority(value):
    return {"value": value, "method": "template_identity",
            "confidence": 70, "validation_note": _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY}


ARMED = {"TEMPLATE_IDENTITY_BAND_GRADUATE": "1"}          # ISSUER_HINT_BAND absent -> on
BAND  = "bill from: profile construction ltd\ninvoice # 40100"   # already-truncated issuer band
SHED  = ExtractionEngine._should_shed_template_identity_note


# ── C1 predicate: _identity_corroborated_strict ──────────────────────────────────
print("-- _identity_corroborated_strict (the note-shed predicate) --")
check("full normalised value as a band substring -> sheds",
      _identity_corroborated_strict("Profile Construction", BAND) is True)
check("every distinctive token whole-word (non-contiguous) -> sheds",
      _identity_corroborated_strict("Halcyon Group", "halcyon leisure\n... trading as group ltd") is True)
check("DESCRIPTOR SUBSET does NOT shed ('Cascade Water Systems' vs a band with only 'water systems')",
      _identity_corroborated_strict("Cascade Water Systems", "acme water systems division") is False)
check("a value ABSENT from the band -> no shed",
      _identity_corroborated_strict("Northgate Textiles", BAND) is False)
check("lone SHORT token (<6) can never shed ('IN' in a band containing 'in')",
      _identity_corroborated_strict("IN", "bill from in the post ltd") is False)
check("lone LONG token (>=6) present -> sheds",
      _identity_corroborated_strict("Ironbridge", "ironbridge fabrication co") is True)
check("empty value / empty band -> False",
      _identity_corroborated_strict("", BAND) is False and _identity_corroborated_strict("X", "") is False)
check("all-generic value ('Services Ltd') -> no shed (no distinctive tokens, no substring hit)",
      _identity_corroborated_strict("Services Ltd", "bill from acme corp") is False)


# ── the S1 decision: _should_shed_template_identity_note ──────────────────────────
print("-- _should_shed_template_identity_note (env / tier / corroboration gate) --")
check("ARMED + majority note + corroborated -> SHED",
      SHED(majority("Profile Construction"), BAND, env=ARMED) is True)
check("kill-off: S1 unset -> never sheds (byte-identical)",
      SHED(majority("Profile Construction"), BAND, env={}) is False)
check("kill-off: S1='0' -> never sheds",
      SHED(majority("Profile Construction"), BAND,
           env={"TEMPLATE_IDENTITY_BAND_GRADUATE": "0"}) is False)
check("C2 band-kill: ISSUER_HINT_BAND='0' -> never sheds even when corroborated",
      SHED(majority("Profile Construction"), BAND,
           env={"TEMPLATE_IDENTITY_BAND_GRADUATE": "1", "ISSUER_HINT_BAND": "0"}) is False)
check("SINGLE-tier note is never shed (accepted trade-off lock)",
      SHED({"value": "Profile Construction", "method": "template_identity",
            "validation_note": _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE}, BAND, env=ARMED) is False)
check("eligibility: un-noted @90 precedence override is NOT shed",
      SHED({"value": "Profile Construction", "method": "template_identity", "confidence": 90},
           BAND, env=ARMED) is False)
check("eligibility: an already-shed value (method template_identity_corroborated) is NOT re-shed (idempotent)",
      SHED({"value": "Profile Construction", "method": "template_identity_corroborated",
            "confidence": 85}, BAND, env=ARMED) is False)
check("eligibility: a logo read is NOT shed",
      SHED({"value": "Profile Construction", "method": "logo",
            "validation_note": _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY}, BAND, env=ARMED) is False)
check("eligibility: non-dict -> False",
      SHED(None, BAND, env=ARMED) is False)
check("majority note but value ABSENT from band -> no shed (recipient hole stays closed)",
      SHED(majority("Northgate Textiles"), BAND, env=ARMED) is False)
check("majority note but empty value -> no shed",
      SHED(majority(""), BAND, env=ARMED) is False)


print()
if fails:
    print(f"FAIL: {fails} check(s) failed")
    sys.exit(1)
print("All template-identity band-graduate pins passed.")
