"""
Verify _filter_anchors prefers the most-recently AUTHORITATIVE anchor over one
with merely a higher passive usage_count — so an operator's ⊕ re-teach wins
selection immediately. usage_count remains the final tie-break for anchors with
no authoritative stamp.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import anchor


def _a(label, usage, auth=None, sup="ds", dt="worksheet"):
    return {
        "supplier_name": sup, "document_type": dt, "field_key": "date",
        "anchor_label": label, "direction": "right",
        "x_norm": 0.25, "y_norm": 0.20, "w_norm": 0.1, "h_norm": 0.02,
        "usage_count": usage, "confidence": 1.0, "last_authoritative_at": auth,
    }


def test_authoritative_beats_high_usage():
    stale = _a("Ticket Category", usage=50)                       # no stamp
    taught = _a("Date", usage=1, auth="2026-06-16 18:31:07")      # explicit teach
    order = anchor._filter_anchors([stale, taught], "ds", "worksheet")
    assert order[0]["anchor_label"] == "Date", "authoritative re-teach must sort first"


def test_authoritative_beats_supplier_exact_stale():
    # The real-world failure: a stale anchor under the RESOLVED supplier
    # (supplier-exact, tier 0) must still lose to a supplier-agnostic explicit
    # teach (global/__unknown__, tier 2) — auth bucket is considered first.
    stale = _a("Ticket Category", usage=18, auth=None,
               sup="document solutions", dt="wsd")
    taught = _a("Date", usage=1, auth="2026-06-16 18:31:07",
                sup="__unknown__", dt="wsd")
    order = anchor._filter_anchors([stale, taught], "document solutions", "wsd")
    assert order[0]["anchor_label"] == "Date", \
        "explicit teach must beat a supplier-exact stale anchor"


def test_more_recent_authoritative_wins():
    older = _a("DateOld", usage=1, auth="2026-06-16 10:00:00")
    newer = _a("DateNew", usage=1, auth="2026-06-16 18:31:07")
    order = anchor._filter_anchors([older, newer], "ds", "worksheet")
    assert order[0]["anchor_label"] == "DateNew", "most recent authoritative wins"


def test_usage_count_breaks_ties_without_stamp():
    low = _a("A", usage=2)
    high = _a("B", usage=9)
    order = anchor._filter_anchors([low, high], "ds", "worksheet")
    assert order[0]["anchor_label"] == "B", "usage_count still tie-breaks unstamped anchors"


def test_auth_rank_parses_timestamp():
    assert anchor._auth_rank({"last_authoritative_at": "2026-06-16 18:30:00"}) == 20260616183000
    assert anchor._auth_rank({"last_authoritative_at": None}) == 0
    assert anchor._auth_rank({}) == 0


if __name__ == "__main__":
    test_authoritative_beats_high_usage()
    test_more_recent_authoritative_wins()
    test_usage_count_breaks_ties_without_stamp()
    test_auth_rank_parses_timestamp()
    print("All anchor authoritative-precedence checks passed")
