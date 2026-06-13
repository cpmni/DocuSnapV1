#!/usr/bin/env python3
"""
tests/test_group_mapping_fallback.py
------------------------------------
Unit tests for the template-group "shared-anchor" fallback in
extraction.engine.select_mapping_source — the deferred behaviour that lets a
matched template with NO enabled mappings of its own borrow enabled
field_mappings from a grouped sibling.

Covers:
  1. Own enabled mappings -> used as-is, no group lookup (unchanged behaviour)
  2. No own mappings + grouped sibling with mappings -> borrow the sibling's
  3. No own mappings + no group -> empty, clean fallback
  4. No own mappings + group but no sibling has mappings -> empty, clean fallback
  5. enabled:0 / enabled:False mappings don't count (own OR sibling)
  6. Deterministic pick: most enabled mappings wins, regardless of list order
  7. Tie on count -> higher confirmed_count, then lower id (stable)
  8. A different group_id sibling is NOT borrowed from
  9. None templates list is handled

Usage:
    py -3.12 python_backend/tests/test_group_mapping_fallback.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.engine import select_mapping_source, _enabled_mappings


def check(label: str, condition: bool) -> bool:
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return condition


def section(title: str):
    print(f"\n{title}")


def _map(field_key, enabled=1):
    return {"field_key": field_key, "anchor_text": "X", "enabled": enabled}


def _tmpl(tid, group_id=None, mappings=None, confirmed_count=0, name=None):
    return {
        "id": tid,
        "name": name or f"tmpl{tid}",
        "group_id": group_id,
        "confirmed_count": confirmed_count,
        "field_mappings": mappings or [],
    }


def main() -> int:
    failures = 0

    # ── 1. Own mappings win, no group lookup ──────────────────────────────────
    section("1. matched template's own enabled mappings are used unchanged")
    own = _tmpl(43, group_id=9, mappings=[_map("date"), _map("job_no")])
    sibling = _tmpl(44, group_id=9, mappings=[_map("customer_name")])
    maps, src = select_mapping_source(own, [own, sibling])
    if not check("uses its OWN 2 mappings, not the sibling's", len(maps) == 2 and src is own):
        failures += 1

    # ── 2. Borrow from grouped sibling when matched has none ──────────────────
    section("2. no own mappings + grouped sibling with mappings -> borrow")
    bare = _tmpl(44, group_id=9, mappings=[])                       # clean identity, no mappings
    rich = _tmpl(43, group_id=9, mappings=[_map("customer_name"), _map("date"), _map("job_no")])
    maps, src = select_mapping_source(bare, [bare, rich])
    if not check("borrows the sibling's 3 mappings", len(maps) == 3):
        failures += 1
    if not check("source is the sibling, not the matched template", src is rich):
        failures += 1

    # ── 3. No group -> clean empty fallback ───────────────────────────────────
    section("3. no own mappings + no group -> empty, no borrow")
    solo = _tmpl(50, group_id=None, mappings=[])
    maps, src = select_mapping_source(solo, [solo, rich])
    if not check("returns empty mappings", maps == []):
        failures += 1
    if not check("source falls back to the matched template", src is solo):
        failures += 1

    # ── 4. Group but no sibling has mappings -> clean empty fallback ──────────
    section("4. grouped but no sibling has mappings -> empty")
    a = _tmpl(60, group_id=7, mappings=[])
    b = _tmpl(61, group_id=7, mappings=[])
    maps, _ = select_mapping_source(a, [a, b])
    if not check("returns empty mappings", maps == []):
        failures += 1

    # ── 5. Disabled mappings don't count ──────────────────────────────────────
    section("5. enabled:0 / enabled:False mappings are ignored")
    disabled_own = _tmpl(70, group_id=3, mappings=[_map("date", enabled=0), _map("x", enabled=False)])
    sib_ok = _tmpl(71, group_id=3, mappings=[_map("customer_name")])
    maps, src = select_mapping_source(disabled_own, [disabled_own, sib_ok])
    if not check("matched template's disabled mappings don't block the borrow",
                 len(maps) == 1 and src is sib_ok):
        failures += 1
    sib_disabled = _tmpl(81, group_id=4, mappings=[_map("date", enabled=0)])
    bare2 = _tmpl(80, group_id=4, mappings=[])
    maps, _ = select_mapping_source(bare2, [bare2, sib_disabled])
    if not check("a sibling whose only mappings are disabled is not borrowed from", maps == []):
        failures += 1

    # ── 6. Deterministic: most enabled mappings wins, order-independent ───────
    section("6. picks the sibling with the most enabled mappings")
    matched = _tmpl(100, group_id=5, mappings=[])
    few  = _tmpl(101, group_id=5, mappings=[_map("date")])
    many = _tmpl(102, group_id=5, mappings=[_map("date"), _map("job_no"), _map("customer_name")])
    for order in ([matched, few, many], [matched, many, few]):
        maps, src = select_mapping_source(matched, order)
        if not check(f"borrows the 3-mapping sibling regardless of list order {[t['id'] for t in order]}",
                     len(maps) == 3 and src is many):
            failures += 1

    # ── 7. Tie on count -> higher confirmed_count, then lower id ──────────────
    section("7. tie-break by confirmed_count then id")
    m = _tmpl(200, group_id=6, mappings=[])
    s_old  = _tmpl(201, group_id=6, mappings=[_map("a"), _map("b")], confirmed_count=2)
    s_new  = _tmpl(202, group_id=6, mappings=[_map("a"), _map("b")], confirmed_count=9)
    _, src = select_mapping_source(m, [m, s_old, s_new])
    if not check("higher confirmed_count wins the tie", src is s_new):
        failures += 1
    s_lowid  = _tmpl(203, group_id=6, mappings=[_map("a"), _map("b")], confirmed_count=5)
    s_highid = _tmpl(204, group_id=6, mappings=[_map("a"), _map("b")], confirmed_count=5)
    _, src = select_mapping_source(m, [m, s_highid, s_lowid])
    if not check("equal confirmed_count -> lowest id wins", src is s_lowid):
        failures += 1

    # ── 8. Different group is not borrowed from ───────────────────────────────
    section("8. a sibling in a DIFFERENT group is never borrowed from")
    matched_g1 = _tmpl(300, group_id=1, mappings=[])
    other_g2   = _tmpl(301, group_id=2, mappings=[_map("date"), _map("job_no")])
    maps, _ = select_mapping_source(matched_g1, [matched_g1, other_g2])
    if not check("no cross-group borrow", maps == []):
        failures += 1

    # ── 9. None templates list handled ────────────────────────────────────────
    section("9. None templates list is safe")
    maps, src = select_mapping_source(_tmpl(400, group_id=1, mappings=[]), None)
    if not check("returns empty without raising", maps == []):
        failures += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    if failures:
        print(f"{failures} check(s) FAILED.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
