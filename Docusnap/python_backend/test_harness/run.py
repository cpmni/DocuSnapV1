"""Orchestrator CLI for the six-agent test harness.

  Full run:        py -3.12 -m test_harness.run --config artifacts/test_harness/config.json
  Smoke (N docs):  py -3.12 -m test_harness.run --limit 5 --steps generate
  Re-run one doc:  py -3.12 -m test_harness.run --doc-id DOC_000123 --steps validate

Stage 0 implements: generate. The other steps are declared and stubbed so the pipeline
shape + artifact contract are fixed; they fill in across Stages 1-6.
"""
from __future__ import annotations
import argparse
import json
import sys
import time
import traceback

from test_harness.config import load_config, save_config, Paths

STEPS = ["generate", "drift", "ocr", "template", "validate", "report"]


def _run_meta(cfg, paths):
    meta = {"harness_version": __import__("test_harness").__version__,
            "python": sys.version.split()[0], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "config": cfg}
    try:
        import PIL, numpy
        meta["pillow"] = PIL.__version__; meta["numpy"] = numpy.__version__
    except Exception:
        pass
    with open(paths.run_meta, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="test_harness.run")
    ap.add_argument("--config", default=None, help="path to config JSON")
    ap.add_argument("--steps", nargs="*", default=["all"], help=f"subset of {STEPS} or 'all'")
    ap.add_argument("--doc-id", default=None, help="restrict a step to one document")
    ap.add_argument("--limit", type=int, default=None, help="cap generated docs (smoke runs)")
    ap.add_argument("--step", default=None, help="alias for a single --steps value")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    paths = Paths(cfg).ensure()
    if not args.config:                       # persist the resolved config so a run is reproducible
        save_config(cfg, paths.run_meta.replace("run_meta.json", "config.json"))
    _run_meta(cfg, paths)

    steps = [args.step] if args.step else (STEPS if args.steps == ["all"] else args.steps)
    doc_ids = [args.doc_id] if args.doc_id else None
    print(f"[harness] {__import__('test_harness').__version__}  out={paths.root}  steps={steps}"
          + (f"  doc={args.doc_id}" if args.doc_id else ""))

    for step in steps:
        t0 = time.time()
        try:
            if step == "generate":
                from test_harness import generator
                rows = generator.generate_corpus(cfg, paths, limit=args.limit)
                print(f"[generate] {len(rows)} doc(s) -> {paths.corpus}  manifest={paths.manifest}")
            elif step == "drift":
                from test_harness import drift
                print(f"[drift] {drift.run(cfg, paths, doc_ids)}")
            elif step == "teach":
                from test_harness import teach
                print(f"[teach] {teach.run(cfg, paths, doc_ids)}")
            elif step == "ocr":
                from test_harness import ocr_detect
                print(f"[ocr] {ocr_detect.run(cfg, paths, doc_ids)}")
            elif step == "template":
                from test_harness import template_anchor
                print(f"[template] {template_anchor.run(cfg, paths, doc_ids)}")
            elif step == "validate":
                from test_harness import metrics
                print(f"[validate] {metrics.run(cfg, paths, doc_ids)}")
            elif step == "report":
                from test_harness import reporter
                print(f"[report] {reporter.run(cfg, paths, doc_ids)}")
            else:
                print(f"[warn] unknown step '{step}' (valid: {STEPS})")
        except Exception as e:
            print(f"[ERROR] step '{step}' failed: {e}")
            traceback.print_exc()
            return 1
        print(f"[{step}] done in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
