"""
Reprocess type-authority override (2026-07-09, Oracle-signed design):
a MACHINE-assigned doc type (never human-confirmed) may be re-typed on reprocess by the
document's OWN trusted standalone title; a HUMAN-confirmed type is NEVER overridden; and
the (detected_slug, title_trusted) pair stays COHERENT (pinned => the title is trusted
only when it AGREES with the pin — the old split-brain shipped the fresh heading's trust
alongside the ASSIGNED slug and could make template matching refuse a legitimate sibling).

Also pins the authority plumbing of doc_overrides: a doc WITH a manifest entry never
inherits a GLOBAL authority flag (per-doc fact; Oracle condition), while single-doc
reprocess (no manifest) uses the global flag.

Run:  py -3.12 tests/test_reprocess_type_flip.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from process_docs import resolve_assigned_type_authority, doc_overrides

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


print("resolve_assigned_type_authority — the override gate:")

# THE fix case: machine authority + trusted contradicting heading => flip.
ovr, tt = resolve_assigned_type_authority("sales_order", "machine", "worksheet", True)
check("machine + trusted contradicting title => OVERRIDE", ovr is True)
check("... and the fresh title stays trusted", tt is True)

# Human authority: never overridden, and the contradicting title must NOT be
# threaded as trusted against the pinned slug (coherent pair).
ovr, tt = resolve_assigned_type_authority("sales_order", "human", "worksheet", True)
check("human authority => PINNED", ovr is False)
check("human + contradicting title => title_trusted False (coherence)", tt is False)

# ABSENT authority (every pre-flag caller: harness, older invocations) => pinned.
ovr, tt = resolve_assigned_type_authority("sales_order", None, "worksheet", True)
check("absent authority => PINNED (backward-compatible default)", ovr is False)
check("absent + contradicting title => title_trusted False", tt is False)

# Unknown authority string behaves as the safe pin (no argparse choices= on purpose).
ovr, _ = resolve_assigned_type_authority("sales_order", "MACHINE ", "worksheet", True)
check("unrecognised authority value => PINNED (safe)", ovr is False)

# Untrusted title (clipped scan / body mention): pin holds exactly as today.
ovr, tt = resolve_assigned_type_authority("sales_order", "machine", "worksheet", False)
check("machine + UNTRUSTED title => PINNED (clipped-scan protection)", ovr is False)
check("... title_trusted False", tt is False)

# Detected title resolves to NO known slug: pin holds.
ovr, tt = resolve_assigned_type_authority("sales_order", "machine", None, True)
check("machine + unresolvable detected slug => PINNED", ovr is False)
check("... unresolvable trusted title is NOT trusted against the pin", tt is False)

# Detected title AGREES with the pin: no self-flip, and the agreeing title IS trusted
# (protects the pinned type from a wrong-type template exactly like a fresh scan).
ovr, tt = resolve_assigned_type_authority("worksheet", "machine", "worksheet", True)
check("agreeing title => no flip", ovr is False)
check("agreeing title => title_trusted True (coherent, protective)", tt is True)
ovr, tt = resolve_assigned_type_authority("worksheet", "human", "worksheet", True)
check("agreeing title under human authority => title_trusted True", tt is True and ovr is False)

# Fresh scan (no assigned slug): pure passthrough of the fresh signal.
ovr, tt = resolve_assigned_type_authority(None, None, "worksheet", True)
check("fresh scan => no override, fresh trust passes through", ovr is False and tt is True)
ovr, tt = resolve_assigned_type_authority(None, "machine", None, False)
check("fresh scan, no heading => untrusted", ovr is False and tt is False)

print("\ndoc_overrides — authority threading (Oracle: no global fallback for manifest docs):")

# Single-doc reprocess (no manifest): the global flag is the channel.
_, _, ks, _, auth, _sup = doc_overrides(None, "a.pdf", known_doc_slug="sales_order",
                                  known_doc_slug_authority="machine")
check("no manifest: global authority applies", auth == "machine" and ks == "sales_order")

# Batched manifest WITH an entry: ONLY the entry's authority counts — a global flag
# must never leak onto a manifest-carried doc (per-doc statuses differ).
man = {"rb_1.pdf": {"known_doc_slug": "sales_order", "known_doc_slug_authority": "machine"},
       "rb_2.pdf": {"known_doc_slug": "invoice"}}
_, _, ks, _, auth, _sup = doc_overrides(man, "rb_1.pdf", known_doc_slug_authority=None)
check("manifest entry carries its own authority", auth == "machine" and ks == "sales_order")
_, _, ks, _, auth, _sup = doc_overrides(man, "rb_2.pdf", known_doc_slug_authority="machine")
check("manifest entry WITHOUT authority does NOT inherit the global (stays pinned)",
      auth is None and ks == "invoice")

# File absent from the manifest falls back to globals (existing semantics).
_, _, ks, _, auth, _sup = doc_overrides(man, "other.pdf", known_doc_slug="quote",
                                  known_doc_slug_authority="machine")
check("file not in manifest: global fallback (slug + authority)", ks == "quote" and auth == "machine")

# SHAPE GUARD. doc_overrides is unpacked POSITIONALLY at every call site, so adding a return value
# silently breaks all of them — which is exactly what happened: the supplier-pin work (2026-07-16)
# appended `known_supplier` and this pin, still asserting five, went red and stayed red (found
# 2026-07-20). Keep the number here in step with the function, and when you change it, fix the
# call sites in the SAME commit.
#   (enhance_params, known_template_id, known_doc_slug, ocr_text, known_doc_slug_authority,
#    known_supplier)
vals = doc_overrides(None, "x.pdf")
check("doc_overrides returns a 6-tuple", isinstance(vals, tuple) and len(vals) == 6)

print(f"\n{fails} FAILED" if fails else "\nAll reprocess type-flip checks passed.")
sys.exit(1 if fails else 0)
