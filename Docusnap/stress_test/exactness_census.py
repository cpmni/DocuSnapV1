"""exactness_census.py — ORACLE C7. Aggregate the per-PID jsonl files written by
`template_mapper._exactness_census` when TEMPLATE_EXACTNESS_CENSUS names a path.

    py -3.12 stress_test/exactness_census.py <census-path-prefix>

WHAT THIS ANSWERS, and why the corpus score cannot.
TEMPLATE_DRIFT_ROW_PITCH fires only when `_label_is_the_taught_one` accepts, which requires the
matched OCR line to be the taught label rather than a caption that merely scored well. `_ocr_lines`
runs --psm 6 with NO column segmentation, so on a layout where the label and its value share a
printed line — or where two columns merge into one OCR line — the predicate declines and the flag
is inert no matter how drifted the page is. The corpus draws ONE totals geometry across all ten
issuers, so a 31/31 corpus result is evidence about that one geometry, not about the class.

The acceptance rate below IS the flag's recall ceiling on this corpus. Read it before saying
anything about how well money generalises.
"""
import collections
import glob
import json
import sys


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    prefix = sys.argv[1]
    files = sorted(glob.glob(prefix + '.*.jsonl'))
    if not files:
        raise SystemExit('no census files matching %s.*.jsonl — was TEMPLATE_EXACTNESS_CENSUS set?'
                         % prefix)

    rows = []
    for fn in files:
        with open(fn, 'r', encoding='utf-8') as fh:
            for ln in fh:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    rows.append(json.loads(ln))
                except ValueError:
                    pass                      # a torn line from a killed shard is not a data point

    print('census files: %d   records: %d\n' % (len(files), len(rows)))

    by_type = collections.defaultdict(lambda: [0, 0])
    by_field = collections.defaultdict(lambda: [0, 0])
    declines = collections.Counter()
    for r in rows:
        t = r.get('type') or '?'
        f = r.get('field') or '?'
        hit = 1 if r.get('exact') else 0
        by_type[t][0] += hit
        by_type[t][1] += 1
        by_field[f][0] += hit
        by_field[f][1] += 1
        if not hit:
            declines[(r.get('anchor'), r.get('matched'))] += 1

    def table(title, d):
        print(title)
        print('  %-26s %8s %8s %8s' % ('', 'exact', 'seen', 'rate'))
        for k in sorted(d, key=lambda k: -d[k][1]):
            hit, seen = d[k]
            print('  %-26s %8d %8d %7.0f%%' % (k, hit, seen, 100.0 * hit / max(seen, 1)))
        print()

    table('EXACTNESS HIT-RATE BY VALUE TYPE  (currency is the one flag 2 was measured on)', by_type)
    table('BY FIELD', by_field)

    cur = by_type.get('currency')
    if cur:
        print('CURRENCY RECALL CEILING: %d of %d (%.0f%%) of money mappings that reach the drift'
              % (cur[0], cur[1], 100.0 * cur[0] / max(cur[1], 1)))
        print('check can EVER be helped by TEMPLATE_DRIFT_ROW_PITCH. The rest decline on the label')
        print('predicate before geometry is consulted.\n')

    if declines:
        print('TOP DECLINES  (taught label -> the OCR line that answered it)')
        for (anchor, matched), n in declines.most_common(25):
            print('  x%-4d %-30r -> %r' % (n, anchor, (matched or '')[:70]))


if __name__ == '__main__':
    main()
