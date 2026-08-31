# Baseline extraction accuracy — 400-doc corpus, fresh DB (shipped config, no learned data)

_Generated 2026-07-15T20:07:25.119Z · mode=fast · 400/400 docs processed_

## Accuracy by field × variant
| Field | Text (200) | Scanned (200) | Overall |
|---|---|---|---|
| type | 100.0% (200/200) | 95.5% (191/200) | 97.8% |
| supplier | 0.0% (0/200) | 0.0% (0/200) | 0.0% |
| ref | 100.0% (200/200) | 94.0% (188/200) | 97.0% |
| date | 100.0% (200/200) | 95.5% (191/200) | 97.8% |
| subtotal | 100.0% (200/200) | 100.0% (200/200) | 100.0% |
| total | 100.0% (200/200) | 100.0% (200/200) | 100.0% |

## Correct / wrong / missing (overall)
| Field | Correct | Wrong | Missing |
|---|---|---|---|
| type | 97.8% | 2.3% | 0.0% |
| supplier | 0.0% | 0.0% | 100.0% |
| ref | 97.0% | 0.0% | 3.0% |
| date | 97.8% | 0.0% | 2.3% |
| subtotal | 100.0% | 0.0% | 0.0% |
| total | 100.0% | 0.0% | 0.0% |

## Ref / Date / Total accuracy by document type
| Type | ref | date | total |
|---|---|---|---|
| invoice | 99.3% (133/134) | 100.0% (134/134) | 100.0% (134/134) |
| sales_order | 97.7% (130/133) | 98.5% (131/133) | 100.0% (133/133) |
| purchase_order | 94.0% (125/133) | 94.7% (126/133) | 100.0% (133/133) |

**Overall confidence** — text: min 60 / mean 62 / max 63 · scanned: min 31 / mean 60 / max 63

## Example failures
- **type**: scanned_sales_order_SC_SO-40223.pdf: want sales_order got invoice · scanned_purchase_order_AI_PO-10260.pdf: want purchase_order got invoice · scanned_purchase_order_SC_PO-40293.pdf: want purchase_order got invoice · scanned_sales_order_BW_SO-20316.pdf: want sales_order got invoice · scanned_purchase_order_SC_PO-40323.pdf: want purchase_order got invoice
- **supplier**: want "Acme Industrial" got NULL · want "Bluewave Supplies" got NULL · want "Greenfield Trading" got NULL · want "Sunrise Components" got NULL · want "Meridian Logistics" got NULL
- **ref**: want SO-40223 got NULL · want PO-30242 got NULL · want PO-10260 got NULL · want PO-40293 got NULL · want SO-10295 got NULL
- **date**: want 24-03-2023 got NULL · want 14-01-2022 got NULL · want 20-04-2022 got NULL · want 13-02-2025 got NULL · want 24-07-2023 got NULL

## Notes (how to read this)
- **supplier 0% is EXPECTED at baseline** — the document issuer is identified by LOGO fingerprint + learning, not a shipped keyword label (a company name at the top of a page has no caption to anchor on). It climbs toward ~95%+ as a supplier's docs are confirmed; this harness deliberately runs with NO learned data.
- **Text-layer (born-digital) docs are ~100%** on every structural + money field — the ceiling.
- **Almost all misses are on SCANNED docs**, and cluster on `sales_order`/`purchase_order`: OCR noise on the title/labels can mis-detect the type as `invoice`, which then cascades — the `invoice_number`/`invoice_date` keys don't match the SO/PO labels, so ref/date read NULL. A learned TEMPLATE match locks the type and closes this cascade (out of scope for a no-learning baseline).
- **ref/date/total/subtotal on text docs and on correctly-typed scanned docs are at or near 100%** — the shipped keyword/anchor extraction is sound; the baseline weakness is scanned-doc type detection for the two non-invoice types.