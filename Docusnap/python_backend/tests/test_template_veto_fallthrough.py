#!/usr/bin/env python3
"""
tests/test_template_veto_fallthrough.py
---------------------------------------
Slice C (Oracle SIGN-OFF-WITH-CONDITIONS C1-C5, 2026-07-26; kill TEMPLATE_VETO_FALLTHROUGH default
OFF): when an IDENTITY veto (256-bit mark veto or the distinctive-branding text gate) refuses the
coarse logo pick, identify_template used to `return None` — short-circuiting the text arms even when
the TRUE supplier's template scores keyword ratio ~1.0 (the live Saltmarsh case: wrong Thornbury lock
at coarse d=4, own template invisible behind the return). ON, the veto FALLS THROUGH to the same-type
rescue + keyword arms with:
  - C2 (LOAD-BEARING): the refuted SUPPLIER's templates — ALL siblings — excluded from both arms
    (a junk-heavy sibling fingerprint clears the raw 0.75 bar on a rival's page otherwise);
  - C3: the fall-through winner must clear the distinctive-branding presence bar, or (detail-veto
    flavour) belong to a supplier the MARK positively matched; else None exactly as today.
The C1 type-refuse guard (_fallthrough_supplier_ok) stays bound ONLY to _logo_refused (Seam-4 ruling).

Usage: py -3.12 python_backend/tests/test_template_veto_fallthrough.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from PIL import Image                                    # noqa: E402
from extraction import template_matcher as tm           # noqa: E402

Q_PHASH  = "aa" * 8          # the page's 64-bit coarse hash (monkeypatched in)
FAR_PH   = "55" * 8          # inverse — far outside LOGO_THRESHOLD for the RIGHT template
Q_DETAIL = "00" * 32         # the scanned 256-bit mark
FAR_DET  = "ff" * 32         # a mark that disagrees (d=256 > veto threshold)

# The page: Saltmarsh letterhead + docket furniture. Contains ALL of RIGHT's fingerprint words except
# 'fermbank' (so RIGHT's raw kw ratio is 8/9 ≈ 0.889 — deliberately BELOW a junk sibling's 1.0, which
# makes the C2 pin decisive: without supplier-scoped exclusion the sibling outranks RIGHT).
OCR = ("Saltmarsh Seafoods\nThe Harbour, Fisher Quay\nGrimsby DN31 3AB\nT 01472 690043\n"
       "DELIVERY DOCKET    Delivery Note No. DN-11111\nDate 22/07/2026\n"
       "Deliver To\nPemberton Joinery\nOld Sawmill, Beech Road\nKendal\n")

def _t(tid, name, sup, slug, fp, phashes=None, details=None):
    return {"id": tid, "name": name, "dominant_supplier": sup, "document_type_slug": slug,
            "keyword_fingerprint": fp, "logo_phashes": phashes or [], "logo_detail_hashes": details or []}

def fixtures():
    # WRONG: coarse-locks the page (phash == Q) but is a DIFFERENT supplier; junk fingerprint (all
    # type words → zero distinctive tokens → own-absent at the gate); mark disagrees (FAR_DET).
    wrong   = _t(1, "Thornbury delivery", "Thornbury Fasteners", "delivery_note",
                 ["delivery", "docket", "note"], phashes=[Q_PHASH], details=[FAR_DET])
    # SIBLING (the C2 trap): SAME refuted supplier, junk fingerprint that scores RAW 1.0 on this page,
    # no logo hashes (never in cands) — outranks RIGHT (0.889) unless excluded by SUPPLIER.
    sibling = _t(2, "Thornbury sibling", "Thornbury Fasteners", "delivery_note",
                 ["delivery", "docket", "note"])
    # RIGHT: the true supplier — coarse phash far (invisible to the logo arm), branding fully present,
    # mark agrees (Q_DETAIL). 'fermbank' keeps its raw ratio at 8/9.
    right   = _t(3, "Saltmarsh delivery", "Saltmarsh Seafoods", "delivery_note",
                 ["saltmarsh", "seafoods", "harbour", "fisher", "quay", "grimsby",
                  "delivery", "note", "fermbank"], phashes=[FAR_PH], details=[Q_DETAIL])
    # GHOST (the C3 trap): a third supplier whose junk fingerprint scores RAW 1.0 but has ZERO
    # distinctive tokens and no enrolled mark — must never be silently accepted on a fall-through.
    ghost   = _t(4, "Ghost delivery", "Ghost Ltd", "delivery_note", ["delivery", "docket", "note"])
    return wrong, sibling, right, ghost

ENVS = ("TEMPLATE_VETO_FALLTHROUGH", "LOGO_DETAIL_GLOBAL_RIVALS", "LOGO_DETAIL_VETO")

def run(templates, envs=None, query_detail=None):
    old = {k: os.environ.get(k) for k in ENVS}
    saved_hash = tm.compute_logo_hash
    try:
        for k in ENVS:
            os.environ.pop(k, None)
        for k, v in (envs or {}).items():
            os.environ[k] = v
        tm.compute_logo_hash = lambda img: Q_PHASH
        return tm.identify_template(Image.new("RGB", (64, 64), "white"), OCR, templates,
                                    detected_slug="delivery_note", title_trusted=False,
                                    query_detail_hash=query_detail)
    finally:
        tm.compute_logo_hash = saved_hash
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

def picked(res):
    return res and (res.get("template") or {}).get("id")

def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0
    wrong, sibling, right, ghost = fixtures()

    # ── OFF: today's behaviour pinned ────────────────────────────────────────────────────────────
    # Distinctive gate refuses the wrong lock (own-absent + rival branding present) → None.
    fails += not check("OFF: distinctive-gate veto -> None (today, pinned)",
                       run([wrong, sibling, right]) is None)
    # Detail veto (A armed) refuses → still None without C: A alone only changes the None's flavour.
    fails += not check("OFF(C)/ON(A): detail veto -> None (A alone = same user outcome)",
                       run([wrong, right], envs={"LOGO_DETAIL_GLOBAL_RIVALS": "1"},
                           query_detail=Q_DETAIL) is None)

    # ── ON: the fall-through recovers the RIGHT template ─────────────────────────────────────────
    r = run([wrong, sibling, right], envs={"TEMPLATE_VETO_FALLTHROUGH": "1"})
    fails += not check("ON: distinctive-gate fall-through -> RIGHT via keywords",
                       picked(r) == 3 and r.get("method") == "keywords")
    # C2 (LOAD-BEARING, decisive construction): the same-supplier SIBLING scores raw 1.0 > RIGHT's
    # 0.889 — under template-scoped-only exclusion the sibling would WIN the keyword arm and then be
    # rejected by the C3 bar, yielding None. Supplier-scoped exclusion is the only way RIGHT (id 3)
    # comes back, so this assertion FAILS on a template-scoped-only build (Oracle's requirement).
    fails += not check("ON: C2 pin — refuted supplier's junk SIBLING never re-admitted (RIGHT wins)",
                       picked(r) == 3)
    # A+C: the detail veto fires first (global rival), falls through, mark+text agree → RIGHT.
    r2 = run([wrong, sibling, right],
             envs={"TEMPLATE_VETO_FALLTHROUGH": "1", "LOGO_DETAIL_GLOBAL_RIVALS": "1"},
             query_detail=Q_DETAIL)
    fails += not check("ON(A+C): detail-veto fall-through -> RIGHT (mark rivals arm)",
                       picked(r2) == 3)

    # ── C3: a bar-failing winner is never silently accepted ─────────────────────────────────────
    # GHOST outranks RIGHT (raw 1.0 > 0.889) but has zero distinctive tokens and no enrolled mark →
    # the keyword arm's winner fails the bar → None (today's outcome for this page).
    fails += not check("ON: C3 pin — junk-only GHOST winner fails the bar -> None",
                       run([wrong, right, ghost], envs={"TEMPLATE_VETO_FALLTHROUGH": "1"}) is None)

    # ── The no-resolve corner stays byte-identical None ──────────────────────────────────────────
    # Rival mark evidence triggers the veto, but the rival's fingerprint never appears on the page →
    # both arms come up empty → None, exactly as before.
    lonely_rival = _t(5, "Rival elsewhere", "Elsewhere Ltd", "delivery_note",
                      ["zzz", "qqq"], details=[Q_DETAIL])
    fails += not check("ON(A+C): veto fires, nothing resolves -> None (byte-identical corner)",
                       run([wrong, lonely_rival],
                           envs={"TEMPLATE_VETO_FALLTHROUGH": "1", "LOGO_DETAIL_GLOBAL_RIVALS": "1"},
                           query_detail=Q_DETAIL) is None)

    # ── Sanity: no veto ⇒ the flag machinery is inert (normal accept unchanged) ─────────────────
    # RIGHT alone coarse-locks itself (phash == Q via monkeypatch… use its own template): a genuine
    # single-supplier match is untouched by the fall-through code.
    solo = _t(6, "Saltmarsh delivery", "Saltmarsh Seafoods", "delivery_note",
              ["saltmarsh", "seafoods", "harbour", "fisher", "quay", "grimsby"],
              phashes=[Q_PHASH], details=[Q_DETAIL])
    r3 = run([solo], envs={"TEMPLATE_VETO_FALLTHROUGH": "1"}, query_detail=Q_DETAIL)
    fails += not check("ON: genuine match untouched (accepts via logo arm)",
                       picked(r3) == 6 and str(r3.get("method", "")).startswith("logo"))

    print()
    print(f"{fails} FAILED" if fails else "All veto-fallthrough checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
