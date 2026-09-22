"""list_census.py — synthetic serial-page census, switches OFF vs ON (Oracle cond 10 gate H).

Bank = the APP's real path: shipped config/keyword_patterns.json → seed_field_labels (LIST_FIELD_SCAN=1) →
merge_label_overrides with the taught captions (doc-type-wide, additive) — so `serial_number` carries the
inferred 'alphanumeric' validation exactly as the engine gives it. Page set generated ONCE and scored by
both arms (the first draft re-rolled pages per arm — noise, not signal).

Page shapes (the owner's corpus + Chris's runs): one 'Serial No: X' line per serial (gen_customer_test),
a dotted caption, a header row ('Serial No   Model   Qty' + column), a plural caption, mixed
'Serial No'/'Serial Number' lines, inline 'Serial No: X    Model: Y'. Every page also prints a
'Reference No: WS…' line (the generic-ref-bank exhibit) and a 'Model' header word.

Scores: exact-set hits, DEBRIS elements (not a real serial), MISSED serials.
Run: py -3.12 <this file>   (from the repo root)
"""
import os, sys, json, copy, random
sys.path.insert(0, os.path.join(os.getcwd(), 'python_backend'))
os.environ['LIST_FIELD_SCAN'] = '1'
from extraction import keyword

CFG = json.load(open(os.path.join('config', 'keyword_patterns.json'), encoding='utf-8'))
DEFS = [{"key": "serial_number", "label": "Serial Number", "type": "list"},
        {"key": "reference_number", "label": "Reference number", "type": "reference"}]
MODELS = ["XR-200", "Compact 5", "Pro Max", "Basic"]


def bank(taught):
    pats = keyword.seed_field_labels(copy.deepcopy(CFG), DEFS)
    ovr = [{"doc_type_slug": "service_worksheet", "field_key": "serial_number", "label": t, "exclusive": 0, "template_id": 0}
           for t in taught]
    return keyword.merge_label_overrides(pats, ovr, "service_worksheet") if ovr else pats


def serial(rng):
    return rng.choice(["NW-", "SN", "CX-", ""]) + "".join(rng.choice("0123456789") for _ in range(rng.choice([6, 7, 8])))


def page(rng, kind):
    sns = [serial(rng) for _ in range(rng.randint(3, 10))]
    lines = ["SERVICE WORKSHEET", "Reference No: WS%06d" % rng.randint(1, 999999), "Date 20-01-2026", ""]
    gt = sns
    if kind == "one_per_line":
        lines += [f"Serial No: {s}" for s in sns]
    elif kind == "dotted":
        lines += [f"Serial No. {s}" for s in sns]
    elif kind == "header_row":
        lines += ["Serial No        Model          Qty"]
        lines += [f"{s}        {rng.choice(MODELS)}          1" for s in sns]
        gt = sns[:1]      # caption ABOVE a column: element 1 only is the documented residual
    elif kind == "plural":
        lines += [f"Serial Nos: {s}" for s in sns]
    elif kind == "mixed_captions":
        lines += [f"{rng.choice(['Serial No', 'Serial Number'])}: {s}" for s in sns]
    elif kind == "inline_model":
        lines += [f"Serial No: {s}    Model: {rng.choice(MODELS)}" for s in sns]
    lines += ["", "Total 100.00"]
    return "\n".join(lines) + "\n", gt, kind


KINDS = ["one_per_line", "dotted", "header_row", "plural", "mixed_captions", "inline_model"]
rng = random.Random(20260827)
PAGES = [page(rng, k) for k in KINDS for _ in range(60)]


def run(arm_on, pats):
    keyword.LIST_CAPTION_TAIL_BOUND = arm_on
    keyword.LIST_ELEMENT_DIGIT_GATE = arm_on
    tot = {"docs": 0, "exact": 0, "debris": 0, "missed": 0, "elements": 0}
    by_kind, debris_samples = {}, {}
    for text, gt, k in PAGES:
        r = keyword.extract_fields(text, ["serial_number"], pats, list_keys={"serial_number"})
        got = [e.strip() for e in (r.get("serial_number", {}).get("value") or "").split(";") if e.strip()]
        gts = {g.casefold() for g in gt}
        debris = [e for e in got if e.casefold() not in gts]
        missed = [g for g in gt if g.casefold() not in {e.casefold() for e in got}]
        if debris:
            debris_samples.setdefault(k, set()).update(debris[:2])
        b = by_kind.setdefault(k, {"docs": 0, "exact": 0, "debris": 0, "missed": 0, "elements": 0})
        for d in (tot, b):
            d["docs"] += 1; d["elements"] += len(got); d["debris"] += len(debris); d["missed"] += len(missed)
            d["exact"] += int(not debris and not missed)
    return tot, by_kind, debris_samples


for taught in ([], ["Serial No"], ["Serial No", "Serial Number", "Serial Nos"]):
    pats = bank(taught)
    print(f"\n=== taught captions: {taught or '(none — label seed only)'}   bank labels: "
          f"{[l['text'] if isinstance(l, dict) else l for l in pats['field_patterns']['serial_number']['labels']]}")
    for arm in (False, True):
        tot, bk, ds = run(arm, pats)
        print(f"  arm {'ON ' if arm else 'OFF'}: docs={tot['docs']} exact={tot['exact']} elements={tot['elements']} debris={tot['debris']} missed={tot['missed']}")
        for k, d in bk.items():
            ex = ('   e.g. ' + ' | '.join(sorted(ds[k])[:3])) if k in ds else ''
            print(f"      {k:15s} exact={d['exact']:3d}/{d['docs']} debris={d['debris']:3d} missed={d['missed']:3d}{ex}")
