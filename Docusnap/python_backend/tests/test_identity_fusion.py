"""test_identity_fusion.py — issuer_chrome recipient-marker truncation + integration.
The issuer-band chrome is the precision guard for text-led supplier identity: it must keep the
top issuer letterhead and DROP the recipient block / footer so identify_supplier can't match a
non-issuer name that happens to be in the gazetteer.
Run: py -3.12 test_identity_fusion.py   (also pytest-compatible)."""
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # python_backend
from extraction import identity_fusion as idf

C = idf.issuer_chrome


def test_markers_truncate_recipient():
    # issuer is the top line; the recipient below every marker must be dropped
    for marker in ["Bill To", "BILLED TO", "Bill-To", "BillTo", "Invoice To", "Invoiced To",
                   "Sold To", "Ship To", "Shipped To", "Deliver To", "Delivery To",
                   "Consignee", "Recipient:", "Customer", "Customer Name", "Client:",
                   "Account Holder", "Account Name", "For the attention of Mrs Smith",
                   "FAO Jane", "F.A.O.", "Attn: Purchasing", "Attention", "Buyer",
                   "Purchased By", "Ordered By"]:
        c = C(f"Crestwave Systems Ltd\n{marker}\nBeacon Hill School\n123 Client Road")
        assert "Crestwave Systems Ltd" in c, (marker, c)
        assert "Beacon Hill School" not in c, (marker, c)


def test_line_anchored_bare_to():
    # bare "To:" only at line start (letter / order-form recipient)
    c = C("Harbourview Trading\nTo: Beacon Hill School\nDear Sir")
    assert "Harbourview Trading" in c and "Beacon Hill School" not in c
    # ...but "to" mid-line must NOT truncate (issuer address / body)
    c2 = C("Northgate Supplies Ltd\nUnit 4, Point to Point Estate\nBelfast")
    assert "Point to Point" in c2


def test_issuer_band_does_not_fire():
    c = C("Crestwave Systems Ltd\n12 High Street, Belfast BT1 1HE\n"
          "Tel: 028 9012 3456  info@crestwave.co.uk\nVAT Reg No: GB123456789")
    assert "Crestwave Systems Ltd" in c and "High Street" in c and "VAT Reg No" in c


def test_invoice_heading_is_not_a_marker():
    # "Invoice To" is a marker, but "Invoice Total"/"Invoice No" (the \b after 'to') must not fire
    assert "Invoice No 5" in C("Harbourview Trading\nInvoice No 5\nDate 01-02-2026")
    assert "Invoice Total" in C("Harbourview Trading\nInvoice Total 30.00")


def test_customer_contact_sense_guarded():
    # an issuer's "Customer Service" contact strip must NOT truncate
    c = C("Crestwave Systems Ltd\nCustomer Service: 0800 123 456\nwww.crestwave.co.uk")
    assert "Customer Service" in c and "crestwave" in c.lower()


def test_footer_excluded():
    # a name only in the footer (beyond the top band) is not in the issuer chrome
    c = C("INVOICE\nHarbourview Trading\n1 Trade Park\nBelfast\nVAT 123\nInvoice No 5\n"
          "Item A 10.00\nItem B 20.00\nTotal 30.00\nPrinted by Pinnacle Print Group")
    assert "Harbourview Trading" in c and "Pinnacle Print Group" not in c


def test_column_salvage_same_line():
    # two-column letterhead: issuer and marker share a line -> keep the pre-marker text
    c = C("Crestwave Systems Ltd          Bill To:\nBeacon Hill School")
    assert "Crestwave Systems Ltd" in c and "Beacon Hill School" not in c


def test_empty_abstains():
    assert C("") == "" and C(None) == ""
    # first line IS the recipient marker -> empty band -> safe abstain downstream
    assert C("Bill To:\nBeacon Hill School") == ""


def test_integration_picks_issuer_not_recipient():
    # identify_supplier over the issuer band picks the ISSUER even when the recipient is a known supplier
    suppliers = ["Crestwave Systems Ltd", "Beacon Hill School", "Northgate Supplies Ltd"]
    text = "Crestwave Systems Ltd\nBill To:\nBeacon Hill School\nInvoice 123"
    res = idf.identify_supplier(C(text), suppliers)
    assert res["accepted"] and res["supplier"] == "Crestwave Systems Ltd", res
    assert "Beacon Hill School" not in C(text)


def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print("ok:", fn.__name__)
    print(f"\nALL {len(fns)} PASSED")


if __name__ == "__main__":
    _run()
