"""Recurring-entity measurement for reggie's lexicon/history follow-ups.

The default synthetic corpus VARIES names, so it never builds a per-field name lexicon and
the history-dependent follow-ups (name_match repair, conforms_to_lexicon, the truncation
flag, word_like) look inert on it. This builds the population they actually target: a
SINGLE multi-site customer that RECURS ("Beaumont Care Homes Ltd - <site>", stable prefix +
varying tail), so a lexicon (expected_len) forms.

Method (one real OCR pass, faithful):
  1. generate a recurring-customer corpus (low-quality on, so OCR garbles/truncates names);
  2. run the REAL engine once (baseline — no history, name_wordness off) -> raw customer_name reads;
  3. build the confirmed history (formats) from GT canonical names — what the user would have
     after confirming docs;
  4. REPLAY each real read through engine.extract() WITH the history + name_wordness on
     (the follow-ups' Stage 4.5 path) — no re-OCR needed since the gate/repair act on the value;
  5. compare baseline vs treatment on customer_name: accuracy (repair), and wrong reads
     caught vs silent, plus false-flags on correct reads.

Run: py -3.12 -m test_harness.recurring_measure
"""
from __future__ import annotations
import os
import sys

from test_harness.config import load_config, Paths
from test_harness import generator, ocr_detect
from test_harness.metrics import load_json, norm_text, loose
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "config", "keyword_patterns.json")

PREFIX = "Beaumont Care Homes Ltd"
SITES = ["Bangor", "Holywood", "Belmont", "Parkview", "Clandeboye",
         "Newtownards", "Comber", "Dundonald"]


def _cfg():
    cfg = load_config(None)
    cfg.update({
        "output_dir": "artifacts/recurring",
        "scanned_docs": 280, "text_docs": 20, "total_docs": 300,
        "low_quality_pct": 45,          # more garbled/truncated name reads to catch
        "seed": 7,
        "recurring_customer": {"prefix": PREFIX, "sites": SITES},
    })
    return cfg


def _build_history(rows):
    """Confirmed-history formats-file from GT canonical customer names, per doc type."""
    by_type = {}
    for gt in rows:
        cv = gt.get("customer_name")
        if cv:
            by_type.setdefault(gt["doc_type"], {}).setdefault(cv, 0)
            by_type[gt["doc_type"]][cv] += 1
    formats = []
    for slug, vc in by_type.items():
        if len(vc) < 3:
            continue
        formats.append({"supplier_name": "", "document_type": slug,
                        "field_key": "customer_name", "sample_values": list(vc.keys()),
                        "value_counts": vc, "confirmed_count": sum(vc.values())})
    return formats


def _replay(read_value, slug, formats):
    """Run customer_name=read_value through engine.extract WITH history + name_wordness."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG_PATH if os.path.exists(CONFIG_PATH) else None)
    eng.set_name_wordness(True)
    eng.set_formats(formats)
    tm, kw, anc, val = (engine_mod.template_matcher, engine_mod.keyword,
                        engine_mod.anchor, engine_mod.validator)
    orig = (tm.identify_template, tm.compute_logo_hash, kw.extract_fields,
            anc.extract_with_anchors, val.validate_and_adjust)
    tm.compute_logo_hash = lambda *a, **k: None
    tm.identify_template = lambda *a, **k: None
    kw.extract_fields = lambda *a, **k: {"customer_name": {"value": read_value, "confidence": 88, "method": "keyword"}}
    anc.extract_with_anchors = lambda *a, **k: {}
    val.validate_and_adjust = lambda results, field_defs: results
    try:
        res = eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                          field_defs=[{"key": "customer_name", "type": "text"}], hints=[],
                          anchors=[], logos=[], templates=[], document_type="X",
                          document_slug=slug)
    finally:
        (tm.identify_template, tm.compute_logo_hash, kw.extract_fields,
         anc.extract_with_anchors, val.validate_and_adjust) = orig
    return res.get("customer_name") or {}


def _correct(pred, gt):
    return bool(pred) and (norm_text(pred) == norm_text(gt) or loose(pred) == loose(gt))


def main():
    cfg = _cfg()
    paths = Paths(cfg).ensure()
    print(f"[recurring] generating {cfg['total_docs']} docs (recurring customer '{PREFIX} - <site>') ...")
    rows = generator.generate_corpus(cfg, paths)
    print(f"[recurring] running REAL engine once (baseline OCR) ...")
    ocr_detect.run(cfg, paths)

    gts = [load_json(paths.gt_path(d)) for d in sorted(os.listdir(paths.corpus))
           if os.path.isdir(os.path.join(paths.corpus, d))]
    gts = [g for g in gts if g]
    formats = _build_history(gts)
    hist_types = {f["document_type"] for f in formats}
    print(f"[recurring] confirmed-history lexicon built for doc types: {sorted(hist_types)}")

    # Collect (raw read, gt) for customer_name on docs whose type has history.
    pairs = []
    for g in gts:
        slug = g["doc_type"]
        gt_val = g.get("customer_name")
        if not gt_val or slug not in hist_types:
            continue
        ext = load_json(os.path.join(paths.ocr, g["doc_id"], "extraction.json")) or {}
        raw = ((ext.get("extractions") or {}).get("customer_name") or {}).get("value")
        if raw in (None, ""):
            continue
        pairs.append((g["doc_id"], slug, raw, gt_val))

    base_correct = base_wrong = 0
    treat_correct = repaired = caught = silent = false_flag = 0
    examples = {"repaired": [], "caught": [], "false_flag": [], "silent": []}
    for did, slug, raw, gt_val in pairs:
        b_ok = _correct(raw, gt_val)
        base_correct += b_ok
        base_wrong += (not b_ok)
        r = _replay(raw, slug, formats)
        tval = r.get("value")
        flagged = bool(r.get("validation_note"))
        t_ok = _correct(tval, gt_val)
        treat_correct += t_ok
        if not b_ok and t_ok:
            repaired += 1
            if len(examples["repaired"]) < 6: examples["repaired"].append((raw, tval))
        if not b_ok and not t_ok:
            if flagged:
                caught += 1
                if len(examples["caught"]) < 6: examples["caught"].append((raw, r.get("validation_note")))
            else:
                silent += 1
                if len(examples["silent"]) < 6: examples["silent"].append((raw, gt_val))
        if b_ok and flagged:
            false_flag += 1
            if len(examples["false_flag"]) < 6: examples["false_flag"].append((raw, r.get("validation_note")))

    n = len(pairs)
    def pc(x): return f"{100*x//max(1,n)}%"
    print("\n================ RECURRING-ENTITY MEASUREMENT (customer_name) ================")
    print(f"  customer_name reads scored: {n}")
    print(f"  ACCURACY      baseline {base_correct}/{n} ({pc(base_correct)})  ->  treatment {treat_correct}/{n} ({pc(treat_correct)})")
    print(f"  of {base_wrong} baseline-WRONG reads:")
    print(f"     repaired to correct (name_match): {repaired}")
    print(f"     caught (flagged for review):      {caught}")
    print(f"     still silent (wrong, unflagged):  {silent}")
    print(f"  FALSE-FLAGS on correct reads:        {false_flag}/{base_correct}")
    for tag in ("repaired", "caught", "false_flag", "silent"):
        if examples[tag]:
            print(f"\n  e.g. {tag}:")
            for a, b in examples[tag]:
                print(f"     {a!r:<42} -> {b!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
