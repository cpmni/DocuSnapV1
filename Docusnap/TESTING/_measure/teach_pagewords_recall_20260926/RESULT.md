# Teach page-words speedup — locate-recall A/B ship gate (2026-09-26)

OLD = native 288-DPI, dpi=None, sequential (today). NEW = downscale 288->200 + told dpi 200 + parallel passes.
Boxes normalised [0,1] by each arm's own reported dims → directly comparable (placement-transparency invariant).
Raw (non-deskewed) render both arms — the A/B delta is what the gate measures.

docs: 30   field-locates tested: 90
recall  OLD 90/90   NEW 90/90   (net-new 0, regressions 0)
placement  both-located 90   median IoU 0.975   false-locate (NEW box on WRONG text) 0
instance-select  unique-both 56, of which box moved (diff TRUE occurrence, benign) 1; multi-hit moved 0
wall-clock  OLD 1630 ms/doc   NEW 1071 ms/doc   speedup 1.52x

## GATE: PASS  (PASS = 0 recall regressions AND 0 false-locate on wrong text)
False-locate = a NEW hit whose matched text != the value. valueLocate.js:118 only returns runs that EQUAL
the value, so every hit sits on the value string; a moved box is a DIFFERENT real occurrence (header vs a
duplicate ref line), not wrong text — the human Accept/Redraw picks the instance. Recall parity is the UX bar.

### instance-select moves (benign — box on a different TRUE occurrence of the value):
- ref "PI/26/7656" IoU 0  OLD[y0.201 x0.070 w0.076 "PI/26/7656"]  NEW[y0.455 x0.325 w0.067 "PI/26/7656"] — invoice/doc2058_Pelican-Office_invoice_0021.pdf

| field | value | old | new | nO | nN | IoU | dims old→new |
|---|---|---|---|---|---|---|---|
| ref | PI/25/5193 | Y | Y | 2 | 2 | 0.98 | 2383x3368→1655x2339 |
| date | 17-06-2025 | Y | Y | 1 | 1 | 0.955 | 2383x3368→1655x2339 |
| supplier | Pelican Office Interiors | Y | Y | 2 | 2 | 0.985 | 2383x3368→1655x2339 |
| ref | OED/51028 | Y | Y | 1 | 1 | 0.984 | 2383x3368→1655x2339 |
| date | 23-02-2026 | Y | Y | 1 | 1 | 0.966 | 2383x3368→1655x2339 |
| supplier | Oakhaven Electrical Wholesale | Y | Y | 2 | 2 | 0.996 | 2383x3368→1655x2339 |
| ref | NRQ-1085 | Y | Y | 1 | 1 | 0.982 | 2383x3368→1655x2339 |
| date | 07-08-2026 | Y | Y | 1 | 1 | 0.994 | 2383x3368→1655x2339 |
| supplier | Nordwind Refrigeration Ltd | Y | Y | 2 | 1 | 0.999 | 2383x3368→1655x2339 |
| ref | MVC-1459 | Y | Y | 1 | 1 | 0.974 | 2383x3368→1655x2339 |
| date | 03-03-2026 | Y | Y | 1 | 1 | 0.984 | 2383x3368→1655x2339 |
| supplier | Meadowvale Dairy Wholesale | Y | Y | 2 | 2 | 0.637 | 2383x3368→1655x2339 |
| ref | ITH-0093 | Y | Y | 2 | 2 | 0.953 | 2383x3368→1655x2339 |
| date | 24-04-2026 | Y | Y | 2 | 2 | 0.889 | 2383x3368→1655x2339 |
| supplier | Ironclad Tool Hire | Y | Y | 1 | 1 | 0.998 | 2383x3368→1655x2339 |
| ref | HTS-SO-73867 | Y | Y | 1 | 1 | 0.956 | 2383x3368→1655x2339 |
| date | 07-04-2025 | Y | Y | 1 | 1 | 0.966 | 2383x3368→1655x2339 |
| supplier | Harrowgate Timber Supplies | Y | Y | 2 | 2 | 0.98 | 2383x3368→1655x2339 |
| ref | CJB-3292 | Y | Y | 1 | 1 | 0.958 | 2383x3368→1655x2339 |
| date | 23-07-2026 | Y | Y | 1 | 1 | 0.985 | 2383x3368→1655x2339 |
| supplier | Castellan Security Systems | Y | Y | 1 | 1 | 0.998 | 2383x3368→1655x2339 |
| ref | PO-85919 | Y | Y | 1 | 1 | 0.972 | 2383x3368→1655x2339 |
| date | 21-01-2025 | Y | Y | 1 | 1 | 0.984 | 2383x3368→1655x2339 |
| supplier | Bramblewood Joinery Ltd | Y | Y | 2 | 2 | 0.987 | 2383x3368→1655x2339 |
| ref | PI/25/6157 | Y | Y | 2 | 2 | 0.973 | 2383x3368→1655x2339 |
| date | 26-01-2025 | Y | Y | 1 | 1 | 0.975 | 2383x3368→1655x2339 |
| supplier | Pelican Office Interiors | Y | Y | 2 | 2 | 0.986 | 2383x3368→1655x2339 |
| ref | OED/22349 | Y | Y | 1 | 1 | 0.953 | 2383x3368→1655x2339 |
| date | 02-03-2025 | Y | Y | 1 | 1 | 0.974 | 2383x3368→1655x2339 |
| supplier | Oakhaven Electrical Wholesale | Y | Y | 2 | 2 | 0.996 | 2383x3368→1655x2339 |
| ref | NRQ-4624 | Y | Y | 1 | 1 | 0.967 | 2383x3368→1655x2339 |
| date | 05-07-2025 | Y | Y | 1 | 1 | 0.954 | 2383x3368→1655x2339 |
| supplier | Nordwind Refrigeration Ltd | Y | Y | 2 | 2 | 0.98 | 2383x3368→1655x2339 |
| ref | MVC-3462 | Y | Y | 1 | 1 | 0.621 | 2383x3368→1655x2339 |
| date | 07-02-2026 | Y | Y | 1 | 1 | 0.986 | 2383x3368→1655x2339 |
| supplier | Meadowvale Dairy Wholesale | Y | Y | 2 | 2 | 0.866 | 2383x3368→1655x2339 |
| ref | ITH-0093 | Y | Y | 2 | 2 | 0.98 | 2383x3368→1655x2339 |
| date | 07-07-2026 | Y | Y | 2 | 2 | 0.974 | 2383x3368→1655x2339 |
| supplier | Ironclad Tool Hire | Y | Y | 1 | 1 | 0.989 | 2383x3368→1655x2339 |
| ref | HTS-SO-95822 | Y | Y | 1 | 1 | 0.975 | 2383x3368→1655x2339 |
| date | 26-03-2026 | Y | Y | 1 | 1 | 0.979 | 2383x3368→1655x2339 |
| supplier | Harrowgate Timber Supplies | Y | Y | 2 | 2 | 0.992 | 2383x3368→1655x2339 |
| ref | CJB-1416 | Y | Y | 1 | 1 | 0.958 | 2383x3368→1655x2339 |
| date | 03-01-2026 | Y | Y | 1 | 1 | 0.99 | 2383x3368→1655x2339 |
| supplier | Castellan Security Systems | Y | Y | 1 | 1 | 0.992 | 2383x3368→1655x2339 |
| ref | PO-35640 | Y | Y | 1 | 1 | 0.973 | 2383x3368→1655x2339 |
| date | 22-08-2025 | Y | Y | 1 | 1 | 0.974 | 2383x3368→1655x2339 |
| supplier | Bramblewood Joinery Ltd | Y | Y | 2 | 2 | 0.988 | 2383x3368→1655x2339 |
| ref | PI/26/7656 | Y | Y | 1 | 1 | 0 | 2383x3368→1655x2339 |
| date | 07-06-2026 | Y | Y | 1 | 1 | 0.952 | 2383x3368→1655x2339 |
| supplier | Pelican Office Interiors | Y | Y | 2 | 2 | 0.978 | 2383x3368→1655x2339 |
| ref | OED/89515 | Y | Y | 1 | 1 | 0.985 | 2383x3368→1655x2339 |
| date | 21-06-2025 | Y | Y | 1 | 1 | 0.979 | 2383x3368→1655x2339 |
| supplier | Oakhaven Electrical Wholesale | Y | Y | 2 | 2 | 0.991 | 2383x3368→1655x2339 |
| ref | NRQ-4135 | Y | Y | 1 | 1 | 0.969 | 2383x3368→1655x2339 |
| date | 04-04-2026 | Y | Y | 1 | 1 | 0.958 | 2383x3368→1655x2339 |
| supplier | Nordwind Refrigeration Ltd | Y | Y | 2 | 2 | 0.981 | 2383x3368→1655x2339 |
| ref | MVC-7992 | Y | Y | 1 | 1 | 0.954 | 2383x3368→1655x2339 |
| date | 11-08-2026 | Y | Y | 1 | 1 | 0.992 | 2383x3368→1655x2339 |
| supplier | Meadowvale Dairy Wholesale | Y | Y | 2 | 2 | 0.857 | 2383x3368→1655x2339 |
| ref | ITH-0093 | Y | Y | 2 | 2 | 0.572 | 2383x3368→1655x2339 |
| date | 15-12-2025 | Y | Y | 2 | 2 | 0.683 | 2383x3368→1655x2339 |
| supplier | Ironclad Tool Hire | Y | Y | 1 | 1 | 0.941 | 2383x3368→1655x2339 |
| ref | HTS-SO-24857 | Y | Y | 1 | 1 | 0.956 | 2383x3368→1655x2339 |
| date | 10-06-2025 | Y | Y | 1 | 1 | 0.953 | 2383x3368→1655x2339 |
| supplier | Harrowgate Timber Supplies | Y | Y | 2 | 2 | 0.981 | 2383x3368→1655x2339 |
| ref | CJB-8105 | Y | Y | 1 | 1 | 0.975 | 2383x3368→1655x2339 |
| date | 12-04-2026 | Y | Y | 1 | 1 | 0.955 | 2383x3368→1655x2339 |
| supplier | Castellan Security Systems | Y | Y | 1 | 1 | 0.989 | 2383x3368→1655x2339 |
| ref | PO-60029 | Y | Y | 1 | 1 | 0.985 | 2383x3368→1655x2339 |
| date | 09-04-2026 | Y | Y | 1 | 1 | 0.947 | 2383x3368→1655x2339 |
| supplier | Bramblewood Joinery Ltd | Y | Y | 2 | 2 | 0.989 | 2383x3368→1655x2339 |
| ref | PI/26/2247 | Y | Y | 2 | 2 | 0.982 | 2383x3368→1655x2339 |
| date | 16-08-2026 | Y | Y | 1 | 1 | 0.981 | 2383x3368→1655x2339 |
| supplier | Pelican Office Interiors | Y | Y | 2 | 2 | 0.991 | 2383x3368→1655x2339 |
| ref | OED/27381 | Y | Y | 1 | 1 | 0.973 | 2383x3368→1655x2339 |
| date | 14-02-2026 | Y | Y | 1 | 1 | 0.97 | 2383x3368→1655x2339 |
| supplier | Oakhaven Electrical Wholesale | Y | Y | 2 | 2 | 0.984 | 2383x3368→1655x2339 |
| ref | NRQ-1911 | Y | Y | 1 | 1 | 0.955 | 2383x3368→1655x2339 |
| date | 09-10-2025 | Y | Y | 1 | 1 | 0.989 | 2383x3368→1655x2339 |
| supplier | Nordwind Refrigeration Ltd | Y | Y | 2 | 2 | 0.997 | 2383x3368→1655x2339 |
| ref | MVC-2711 | Y | Y | 1 | 1 | 0.97 | 2383x3368→1655x2339 |
| date | 19-04-2025 | Y | Y | 1 | 1 | 0.956 | 2383x3368→1655x2339 |
| supplier | Meadowvale Dairy Wholesale | Y | Y | 2 | 2 | 0.991 | 2383x3368→1655x2339 |
| ref | ITH-0093 | Y | Y | 2 | 2 | 0.966 | 2383x3368→1655x2339 |
| date | 03-06-2026 | Y | Y | 3 | 3 | 0.975 | 2383x3368→1655x2339 |
| supplier | Ironclad Tool Hire | Y | Y | 1 | 1 | 0.956 | 2383x3368→1655x2339 |
| ref | HTS-SO-43957 | Y | Y | 1 | 1 | 0.966 | 2383x3368→1655x2339 |
| date | 14-01-2025 | Y | Y | 1 | 1 | 0.987 | 2383x3368→1655x2339 |
| supplier | Harrowgate Timber Supplies | Y | Y | 2 | 2 | 0.996 | 2383x3368→1655x2339 |