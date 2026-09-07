# ONE-CONFIRM convention gate (Hard Set scan warm, three DB copies)

```
off  : buyer_issued_po docs 7 · supplier-flagged (note) 7 · wouldFile 0 · suppliers ['Bramblewood Joinery Ltd']
        buyer_large_002.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_005.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_008.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_011.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_014.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_017.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_020.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
on   : buyer_issued_po docs 7 · supplier-flagged (note) 0 · wouldFile 4 · suppliers ['Bramblewood Joinery Ltd']
        buyer_large_002.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=True ok
        buyer_large_005.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=False flagged
        buyer_large_008.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=True ok
        buyer_large_011.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=True ok
        buyer_large_014.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=False flagged
        buyer_large_017.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=True ok
        buyer_large_020.pdf | Bramblewood Joinery Ltd | flagged=False | wouldFile=False flagged
ctrl : buyer_issued_po docs 7 · supplier-flagged (note) 7 · wouldFile 0 · suppliers ['Bramblewood Joinery Ltd']
        buyer_large_002.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_005.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_008.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_011.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_014.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_017.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
        buyer_large_020.pdf | Bramblewood Joinery Ltd | flagged=True | wouldFile=False flagged
```
