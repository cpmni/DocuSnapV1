# Hard Set score — scan cold (200 docs, DPI 200, app env mirrored)

| class | n | type | supplier | ref | date | total | EMPTY-held docs | SILENT-wrong docs | would-file | wrong+would-file | controls bad |
|---|---|---|---|---|---|---|---|---|---|---|---|
| buyer_large | 20 | 100% | 60% | 100% | 100% | - | 0 | 0 | 0 | 0 | 0/0 |
| continental | 20 | 100% | 90% | 100% | 100% | - | 0 | 0 | 0 | 0 | 0/0 |
| credit_sign | 20 | 100% | 100% | 85% | 100% | 65% | 3 | 0 | 0 | 0 | 0/3 |
| degraded | 20 | 85% | 90% | 70% | 95% | - | 6 | 0 | 0 | 0 | 0/0 |
| edge_date | 20 | 100% | 80% | 100% | 65% | - | 7 | 0 | 0 | 0 | 0/0 |
| logo_siblings | 20 | 80% | 100% | 25% | 100% | 0% | 12 | 0 | 0 | 0 | 0/0 |
| multicol_money | 20 | 100% | 85% | 100% | 100% | - | 0 | 0 | 0 | 0 | 0/0 |
| multipage | 20 | 100% | 100% | 100% | 100% | - | 0 | 0 | 0 | 0 | 0/0 |
| small_print | 20 | 100% | 90% | 100% | 100% | - | 0 | 0 | 0 | 0 | 0/7 |
| table_total | 20 | 65% | 90% | 0% | 100% | - | 13 | 0 | 0 | 0 | 0/0 |

## buyer_large mismatches
- buyer_large_002.pdf [buyer_issued_po] supplier: want 'Greyburn Plant Services' got 'Bramblewood Joinery Ltd' [flagged]
- buyer_large_005.pdf [buyer_issued_po] supplier: want 'Thornfield Fabrication Ltd' got 'Joinery' [flagged]
- buyer_large_006.pdf [buyer_bigger] supplier: want 'Lantern Bay Foods' got 'Lantem Bay Foods' [flagged]
- buyer_large_008.pdf [buyer_issued_po] supplier: want 'Aldercroft Stationery Co' got 'Joinery' [flagged]
- buyer_large_011.pdf [buyer_issued_po] supplier: want 'Lantern Bay Foods' got 'Bramblewood Joinery Ltd' [flagged]
- buyer_large_014.pdf [buyer_issued_po] supplier: want 'Helix Point Diagnostics' got 'Joinery' [flagged]
- buyer_large_017.pdf [buyer_issued_po] supplier: want 'Greyburn Plant Services' got 'Bramblewood Joinery Ltd' [flagged]
- buyer_large_020.pdf [buyer_issued_po] supplier: want 'Thornfield Fabrication Ltd' got 'Joinery' [flagged]

## continental mismatches
- continental_015.pdf [eur_after] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- continental_020.pdf [dot_thousands] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]

## credit_sign mismatches
- credit_sign_003.pdf [trail_minus] total: want '-300.48' got '300.48' [flagged]
- credit_sign_005.pdf [dash_leader_control CONTROL] ref: want 'INV-19623' got EMPTY [held]
- credit_sign_006.pdf [lead_minus] total: want '-1,753.20' got '1,753.20' [flagged]
- credit_sign_009.pdf [trail_minus] total: want '-882.12' got '882.12' [flagged]
- credit_sign_011.pdf [dash_leader_control CONTROL] ref: want 'INV-38797' got EMPTY [held]
- credit_sign_012.pdf [lead_minus] total: want '-178.80' got '178.80' [flagged]
- credit_sign_015.pdf [trail_minus] total: want '-163.80' got '163.80' [flagged]
- credit_sign_017.pdf [dash_leader_control CONTROL] ref: want 'INV-98088' got EMPTY [held]
- credit_sign_018.pdf [lead_minus] total: want '-109.44' got '109.44' [flagged]

## degraded mismatches
- degraded_004.pdf [thermal] ref: want 'RCP-82992' got EMPTY [held]
- degraded_005.pdf [staple_blot] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- degraded_005.pdf [staple_blot] ref: want 'INV-48607' got EMPTY [held]
- degraded_005.pdf [staple_blot] date: want '02-04-2026' got EMPTY [held]
- degraded_011.pdf [thermal] ref: want 'RCP-36678' got EMPTY [held]
- degraded_012.pdf [staple_blot] ref: want 'INV-39481' got EMPTY [held]
- degraded_013.pdf [fax_header] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- degraded_018.pdf [thermal] ref: want 'RCP-27648' got EMPTY [held]
- degraded_019.pdf [staple_blot] ref: want 'INV-71457' got EMPTY [held]

## edge_date mismatches
- edge_date_001.pdf [boxed_border] date: want '16-05-2025' got EMPTY [held]
- edge_date_006.pdf [flush_left] supplier: want 'Lantern Bay Foods' got EMPTY [held]
- edge_date_006.pdf [flush_left] date: want '21-08-2026' got EMPTY [held]
- edge_date_007.pdf [boxed_border] date: want '18-06-2026' got EMPTY [held]
- edge_date_010.pdf [iso] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- edge_date_012.pdf [flush_left] date: want '22-08-2026' got EMPTY [held]
- edge_date_013.pdf [boxed_border] date: want '25-07-2025' got EMPTY [held]
- edge_date_014.pdf [pair_1] supplier: want 'Lantern Bay Foods' got 'Lantern Bay' [flagged]
- edge_date_018.pdf [flush_left] supplier: want 'Lantern Bay Foods' got EMPTY [held]
- edge_date_018.pdf [flush_left] date: want '13-10-2025' got EMPTY [held]
- edge_date_019.pdf [boxed_border] date: want '02-07-2025' got EMPTY [held]

## logo_siblings mismatches
- logo_siblings_001.pdf [sib_credit] total: want '-3,216.00' got '3,216.00' [flagged]
- logo_siblings_003.pdf [lookalike_a] ref: want 'KR-69717' got EMPTY [held]
- logo_siblings_004.pdf [lookalike_b] ref: want 'KO-90987' got EMPTY [held]
- logo_siblings_005.pdf [sib_invoice] ref: want 'HPI-69313' got EMPTY [held]
- logo_siblings_006.pdf [sib_credit] total: want '-1,951.20' got '1,951.20' [flagged]
- logo_siblings_008.pdf [lookalike_a] ref: want 'KR-51858' got EMPTY [held]
- logo_siblings_009.pdf [lookalike_b] ref: want 'KO-32293' got EMPTY [held]
- logo_siblings_010.pdf [sib_invoice] ref: want 'HPI-13340' got EMPTY [held]
- logo_siblings_011.pdf [sib_credit] total: want '-2,136.00' got '2,136.00' [flagged]
- logo_siblings_013.pdf [lookalike_a] ref: want 'KR-79317' got EMPTY [held]
- logo_siblings_014.pdf [lookalike_b] ref: want 'KO-63348' got EMPTY [held]
- logo_siblings_015.pdf [sib_invoice] ref: want 'HPI-21467' got EMPTY [held]
- logo_siblings_016.pdf [sib_credit] total: want '-907.20' got '907.20' [flagged]
- logo_siblings_018.pdf [lookalike_a] ref: want 'KR-31015' got EMPTY [held]
- logo_siblings_019.pdf [lookalike_b] ref: want 'KO-53892' got EMPTY [held]
- logo_siblings_020.pdf [sib_invoice] ref: want 'HPI-45091' got EMPTY [held]

## multicol_money mismatches
- multicol_money_005.pdf [two_blocks] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- multicol_money_009.pdf [two_blocks] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- multicol_money_017.pdf [two_blocks] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]

## small_print mismatches
- small_print_011.pdf [pt11_control CONTROL] supplier: want 'Lantern Bay Foods' got 'Foods' [flagged]
- small_print_019.pdf [pt9] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]

## table_total mismatches
- table_total_002.pdf [carried_fwd] ref: want 'INV-11732' got EMPTY [held]
- table_total_003.pdf [total_in_table] ref: want 'INV-65787' got EMPTY [held]
- table_total_005.pdf [carried_fwd] ref: want 'INV-36128' got EMPTY [held]
- table_total_006.pdf [total_in_table] ref: want 'INV-36317' got EMPTY [held]
- table_total_008.pdf [carried_fwd] ref: want 'INV-56111' got EMPTY [held]
- table_total_009.pdf [total_in_table] ref: want 'INV-87735' got EMPTY [held]
- table_total_011.pdf [carried_fwd] ref: want 'INV-31455' got EMPTY [held]
- table_total_012.pdf [total_in_table] supplier: want 'Lantern Bay Foods' got 'Bay Foods' [flagged]
- table_total_012.pdf [total_in_table] ref: want 'INV-88041' got EMPTY [held]
- table_total_014.pdf [carried_fwd] ref: want 'INV-53323' got EMPTY [held]
- table_total_015.pdf [total_in_table] ref: want 'INV-90333' got EMPTY [held]
- table_total_017.pdf [carried_fwd] ref: want 'INV-24695' got EMPTY [held]
- table_total_018.pdf [total_in_table] ref: want 'INV-23619' got EMPTY [held]
- table_total_020.pdf [carried_fwd] supplier: want 'Lantern Bay Foods' got 'Bay' [flagged]
- table_total_020.pdf [carried_fwd] ref: want 'INV-83627' got EMPTY [held]
