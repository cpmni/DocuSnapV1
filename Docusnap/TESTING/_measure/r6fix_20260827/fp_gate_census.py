#!/usr/bin/env python3
"""Oracle conditions 4 + 5 (+ the A/B/C classification for condition 3) for the letterhead-scope arc.
READ-ONLY over the owner's live DB (sqlite3 URI mode=ro).

  4. FINGERPRINT-REFACTOR GATE: header_band_text now feeds every document's fingerprint harvest.
     Recompute extract_keyword_fingerprint(ocr_text) for every confirmed doc and diff against the
     PRE-REFACTOR harvest (the old loop inlined below, verbatim). Expect zero diffs.
  5. EMPTY-BAND CENSUS: confirmed docs bound to a PO-ref template whose band is '' or whose band hits
     against their OWN template fall below KEYWORD_THRESHOLD — each is a PO the flip would send to Review.
  3. A/B/C: per PO-ref template, is its established identity printed in its own fingerprint (A/C) or
     not (B — a PO taught with the counterparty as issuer)?

Run: py -3.12 TESTING/_measure/r6fix_20260827/fp_gate_census.py [db-path]
"""
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'python_backend'))
from extraction import template_matcher as tm  # noqa: E402
from extraction.template_matcher import STOP_WORDS, CALENDAR_WORDS  # noqa: E402

DB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db')


def old_extract_keyword_fingerprint(ocr_text: str, max_words: int = 10) -> list:
    """The harvest as it was BEFORE the header_band_text refactor (commit c80e387 state), verbatim."""
    RECIPIENT_MARKERS = ('bill to', 'ship to', 'invoice to', 'sold to', 'customer')
    _CPTY_RE = re.compile(r'\b(?:supplier|vendor)\b', re.IGNORECASE) \
        if os.environ.get('FINGERPRINT_COUNTERPARTY_MARKERS', '1') != '0' else None
    header_lines = []
    for line in ocr_text.split('\n')[:20]:
        low = line.lower()
        if any(m in low for m in RECIPIENT_MARKERS):
            break
        if _CPTY_RE is not None and _CPTY_RE.search(line):
            break
        header_lines.append(line)
    header_text = ' '.join(header_lines)
    _hygiene = os.environ.get('FINGERPRINT_HYGIENE', '1') != '0'
    words = []
    for m in re.finditer(r'\b[A-Za-z][A-Za-z0-9]{2,}\b', header_text):
        if _hygiene and re.match(r'[-/#]?\d', header_text[m.end():]):
            continue
        words.append(m.group(0))
    seen = set()
    fingerprint = []
    for word in words:
        lower = word.lower()
        if lower in STOP_WORDS or lower in CALENDAR_WORDS:
            continue
        if any(ch.isdigit() for ch in word):
            continue
        if word in seen:
            continue
        seen.add(word)
        fingerprint.append(word)
        if len(fingerprint) >= max_words:
            break
    return fingerprint


def main():
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    docs = con.execute("SELECT id, ocr_text, template_id, supplier_name FROM documents WHERE status = 'confirmed' AND ocr_text IS NOT NULL AND TRIM(ocr_text) <> ''").fetchall()
    print(f'DB {DB}\nconfirmed docs with text: {len(docs)}')

    # ── 4. refactor gate ──
    diffs = []
    for d in docs:
        new = tm.extract_keyword_fingerprint(d['ocr_text'])
        old = old_extract_keyword_fingerprint(d['ocr_text'])
        if new != old:
            diffs.append((d['id'], old, new))
    print(f'\n[4] refactor gate: {len(diffs)} fingerprint diffs across {len(docs)} docs (expect 0)')
    for x in diffs[:10]:
        print('   ', x)

    # ── 3. PO-ref templates + A/B/C ──
    tpls = con.execute("""SELECT t.id, t.name, t.document_type_slug, COALESCE(t.buyer_issued, 0) AS buyer_issued, t.keyword_fingerprint,
                                 (SELECT tf.fixed_value FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name') AS frozen
                            FROM templates t JOIN document_types dt ON dt.slug = t.document_type_slug
                           WHERE LOWER(COALESCE(dt.ref_field_key, '')) = 'po_number'""").fetchall()
    print(f'\n[3] PO-ref templates: {len(tpls)}')
    po_tpl_ids = set()
    fp_by_tpl = {}
    for t in tpls:
        fp = json.loads(t['keyword_fingerprint'] or '[]')
        fp_by_tpl[t['id']] = fp
        po_tpl_ids.add(t['id'])
        dom = con.execute("SELECT supplier_name, COUNT(*) n FROM documents WHERE template_id = ? AND status = 'confirmed' AND supplier_name IS NOT NULL GROUP BY supplier_name ORDER BY n DESC LIMIT 1", (t['id'],)).fetchone()
        identity = (dom['supplier_name'] if dom else None) or t['frozen'] or ''
        in_fp = tm.identity_present_on_page(identity, ' '.join(fp)) if identity else None
        bound = con.execute("SELECT COUNT(*) n FROM documents WHERE template_id = ? AND status = 'confirmed'", (t['id'],)).fetchone()['n']
        cls = 'unjudgeable' if in_fp is None else ('A/C (identity in the letterhead fingerprint)' if in_fp else 'B (identity NOT in the fingerprint — counterparty-as-issuer)')
        print(f"    t{t['id']} {t['name']!r} slug={t['document_type_slug']} marked={t['buyer_issued']} bound_confirmed={bound} identity={identity!r} fp={fp} → {cls}")

    # ── 5. empty-band / low-hit census over docs bound to PO-ref templates ──
    bound_docs = [d for d in docs if d['template_id'] in po_tpl_ids]
    empty, low = [], []
    for d in bound_docs:
        band = tm.header_band_text(d['ocr_text'])
        if not band.strip():
            empty.append(d['id'])
            continue
        fp = fp_by_tpl.get(d['template_id']) or []
        r = tm._keyword_hit_ratio({'keyword_fingerprint': fp}, band.lower()) if fp else None
        if r is not None and r < tm.KEYWORD_THRESHOLD:
            low.append((d['id'], d['template_id'], round(r, 2)))
    print(f'\n[5] docs bound to PO-ref templates: {len(bound_docs)}; empty band: {len(empty)} {empty[:20]}; band hits < {tm.KEYWORD_THRESHOLD}: {len(low)} {low[:20]}')
    print('\nDONE')


if __name__ == '__main__':
    main()
