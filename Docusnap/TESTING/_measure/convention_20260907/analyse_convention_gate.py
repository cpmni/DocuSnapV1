"""ONE-CONFIRM convention gate — read the three Hard Set scan-warm arms (off / on / ctrl) and count, for the
buyer_large class's buyer_issued_po docs (Bramblewood = the warm buyer, PO hint lowered to 1 so the note fires):
supplier value, whether the supplier field is flagged (the note), and wouldFile.
  off  : one_confirm OFF, no record   -> flagged (the note)          — today's behaviour after <3 confirms
  on   : one_confirm ON,  record x1   -> NOT flagged, same value      — leg 2 (one noted answer licenses)
  ctrl : one_confirm ON,  NO record   -> flagged                      — the record, not the switch, is load-bearing
Usage: py -3.12 analyse_convention_gate.py <dir>"""
import io
import json
import os
import sys

d = sys.argv[1]
out = []
for arm in ('off', 'on', 'ctrl'):
    p = os.path.join(d, f'score_scan_warm_{arm}.jsonl')
    rows = []
    for line in io.open(p, encoding='utf-8'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('cls') == 'buyer_large' and r.get('variant') == 'buyer_issued_po':
            g = r.get('got') or {}
            fl = r.get('flagged') or {}
            rows.append((r.get('file'), g.get('supplier'), bool(fl.get('supplier')), bool(r.get('wouldFile')), r.get('afReason')))
    noted = sum(1 for x in rows if x[2])
    wf = sum(1 for x in rows if x[3])
    sups = sorted({str(x[1]) for x in rows})
    out.append(f"{arm:5s}: buyer_issued_po docs {len(rows)} · supplier-flagged (note) {noted} · wouldFile {wf} · suppliers {sups}")
    for x in rows:
        out.append(f"        {x[0]} | {x[1]} | flagged={x[2]} | wouldFile={x[3]} {x[4] or ''}")
txt = "\n".join(out)
io.open(os.path.join(d, 'convention_gate.md'), 'w', encoding='utf-8').write("# ONE-CONFIRM convention gate (Hard Set scan warm, three DB copies)\n\n```\n" + txt + "\n```\n")
print(txt)
