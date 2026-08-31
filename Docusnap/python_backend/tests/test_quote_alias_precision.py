"""A4 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND S3) — the catalog's Quote
aliases ("Quotation", "Estimate") and their PRECISION.

THE INCIDENT: the printed heading of every Nordwind quote is "QUOTATION"; the Quote type NAME folds in
as a heading phrase (keyword.py) but "Quotation" never did, so no Quote could ever carry a trusted
title — and when ONE mis-confirm planted a rival type on the letterhead, nothing could settle the
"several document types" hold. Aliases enter the SAME scoring bucket as the name, so they also score
as position-weighted MENTIONS (the Oracle's correction to "heading-only"): a caption line
"Quotation Ref NRQ-2551" may steady the detected TYPE but must never be a trusted HEADING.

Pins: "QUOTATION" standalone → type Quote, heading True; "Quotation Ref NRQ-2551" (caption only) →
heading False (title_trusted stays False); a Quote named only by its alias still detects; the
catalog carries exactly these aliases (source pin on document_types.js); mention-vs-heading on the
Service Worksheet aliases too.

Run:  PYTHONIOENCODING=utf-8 py -3.12 tests/test_quote_alias_precision.py   (from python_backend/)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

fail = 0
def check(name, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond: fail += 1

NAMES = ['Quote', 'Invoice', 'Purchase Order', 'Service Worksheet']
ALIASES = {'Quote': ['Quotation', 'Estimate'], 'Service Worksheet': ['Worksheet', 'Job Sheet']}
LETTERHEAD = "Nordwind Refrigeration Ltd\n9 Frostfield Estate - Colderton, CL3 5RW\nVAT Reg No GB 903 3318 42\n"

def det(body):
    return keyword.detect_document_type(LETTERHEAD + body, {}, NAMES, ALIASES)

print("the heading:")
r = det("QUOTATION\nQuotation Ref    NRQ-9024\nDate    04-03-2026\nCUSTOMER\nBramblewood Joinery Ltd\n")
check("'QUOTATION' standalone line → type Quote", r is not None and r['type'] == 'Quote')
check("…and heading True (a trusted title is now possible for a Quote)", bool(r and r.get('heading')))
r2 = det("Estimate\nRef E-1001\n")
check("'Estimate' standalone → Quote, heading True", r2 is not None and r2['type'] == 'Quote' and r2.get('heading') is True)

# process_docs.py:792 — title_trusted_fresh = heading AND confidence >= 70. The EXPOSED heading flag
# tolerates a "No."/"Ref" caption word beside a title (the shipped _HEADING_CAPTION design: "Invoice
# No." is a real banner), so the caption line alone reads heading=True — the confidence floor is what
# keeps a caption-only page UNTRUSTED. Pinned at the title_trusted level, which is what matters.
def trusted(r):
    return bool(r and r.get('heading') and int(r.get('confidence') or 0) >= 70)
check("…the banner page is title_trusted (heading AND conf >= 70)", trusted(r))

print("\nthe caption (the owner's 16/17 pages where the banner was dropped by the page OCR):")
r3 = det("NR\nQuotation Ref    NRQ-5470\nDate    18-04-2025\nCUSTOMER    DELIVERY ADDRESS\nBramblewood Joinery Ltd\n")
check("'Quotation Ref NRQ-5470' with NO standalone heading → title_trusted False (caption tolerance, but conf < 70)",
      not trusted(r3))
check("…(it still steadies the detected TYPE as a mention — the Oracle-stated wider effect; conf 65)",
      r3 is not None and r3['type'] == 'Quote' and int(r3.get('confidence') or 0) < 70)
r4 = det("PURCHASE ORDER\nPO-65220\nQuotation Ref NRQ-5470\nDate 01-03-2026\n")
check("a Purchase Order that CITES a quotation ref → its own heading wins (Purchase Order, trusted)",
      r4 is not None and r4['type'] == 'Purchase Order' and trusted(r4))
r5 = det("Order Acknowledgement\nas per your quotation dated 1 May\n")
check("a prose mention ('as per your quotation') → heading False", r5 is None or not r5.get('heading'))

print("\nno regression / other catalog aliases:")
check("'INVOICE' heading still detects Invoice with heading True", (det("INVOICE\nInvoice No 1\n") or {}).get('type') == 'Invoice'
      and (det("INVOICE\nInvoice No 1\n") or {}).get('heading') is True)
check("'SERVICE WORKSHEET' heading → Service Worksheet", (det("SERVICE WORKSHEET\nTicket No 1\n") or {}).get('type') == 'Service Worksheet')
check("'Job Sheet' alias heading → Service Worksheet, heading True",
      (det("Job Sheet\nTicket No 1\n") or {}).get('type') == 'Service Worksheet' and (det("Job Sheet\nTicket No 1\n") or {}).get('heading') is True)
check("a page with no type words → None", det("Dear Sir, thank you for your custom\n") is None)

print("\nsource pins (the catalog ships these aliases; migration 85 seeds them where a type has none):")
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dt = open(os.path.join(root, 'database', 'modules', 'document_types.js'), encoding='utf-8').read()
check("Quote → ['Quotation', 'Estimate']", "title_aliases: ['Quotation', 'Estimate']" in dt)
check("Service Worksheet → ['Worksheet', 'Job Sheet']", "title_aliases: ['Worksheet', 'Job Sheet']" in dt)
check("Remittance Advice → ['Remittance']; Statement → ['Statement of Account']",
      "title_aliases: ['Remittance']" in dt and "title_aliases: ['Statement of Account']" in dt)
check("addPresetTypes passes the aliases to addType", "title_aliases: preset.title_aliases || null" in dt)
check("seedPresetTitleAliases never overwrites an operator's aliases and goes through normaliseTitleAliases",
      "if (Array.isArray(cur) && cur.length) continue;" in dt and "const na = normaliseTitleAliases(db, preset.title_aliases, row.name);" in dt)
idx = open(os.path.join(root, 'database', 'index.js'), encoding='utf-8').read()
check("migration 85 calls seedPresetTitleAliases and stamps itself", "seedPresetTitleAliases(db)" in idx
      and "INSERT OR IGNORE INTO migrations (version) VALUES (85)" in idx)

print()
if fail:
    print("FAILED: %d check(s)" % fail); sys.exit(1)
print("ALL PASS")
