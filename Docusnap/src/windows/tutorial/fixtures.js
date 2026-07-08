'use strict';
// Pre-baked practice documents. Pure static data — the whole practice run lives in
// the renderer, nothing is wired to the real pipeline or DB. Three docs teach the
// loop: a clean invoice that flies through, an invoice with ONE uncertain field to
// correct (the teaching moment), and a Purchase Order (a different type files under
// its own folder/name).
//
// field: { key, label, value, confidence, low?, hint?, correct? }
//   low   — the deliberately uncertain field the user corrects
// Doc-level: originalName (incoming scan), docType/company/year/month/filedName drive
// the filing reveal, coach is the per-doc guidance line.
window.TUTORIAL_FIXTURES = [
  {
    id: 'sample1',
    sampleFile: 'sample1.pdf',
    originalName: 'scan001.pdf',
    docType: 'Invoice',
    company: 'Riverside Office Co.',
    year: '2026', month: 'May',
    filedName: 'Invoice.22-05-2026.INV-2098',
    coach: 'Everything reads with high confidence. Documents Scan Finder is this sure about file themselves automatically — but let’s confirm it together this time.',
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer', value: 'Riverside Office Co.', confidence: 98 },
      { key: 'invoice_number', label: 'Reference',       value: 'INV-2098',             confidence: 96 },
      { key: 'invoice_date',   label: 'Date',            value: '22-05-2026',           confidence: 95 },
      { key: 'total_amount',   label: 'Total',           value: '340.00',               confidence: 97 },
    ],
  },
  {
    id: 'sample2',
    sampleFile: 'sample2.pdf',
    originalName: 'scan002.pdf',
    docType: 'Invoice',
    company: 'Practice Supplies Ltd',
    year: '2026', month: 'June',
    filedName: 'Invoice.15-06-2026.INV-1042',
    coach: 'One field is uncertain — it’s outlined in amber. Correct it, then confirm. That correction is exactly how Scan Finder learns.',
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer', value: 'Practice Supplies Ltd', confidence: 98 },
      { key: 'invoice_number', label: 'Reference',       value: 'INV-1O42',              confidence: 54, low: true,
        hint: 'The reader mistook a zero for the letter “O”. Fix it to INV-1042.', correct: 'INV-1042' },
      { key: 'invoice_date',   label: 'Date',            value: '15-06-2026',            confidence: 95 },
      { key: 'total_amount',   label: 'Total',           value: '1,250.00',              confidence: 96 },
    ],
  },
  {
    id: 'sample3',
    sampleFile: 'sample3.pdf',
    originalName: 'scan003.pdf',
    docType: 'Purchase Order',
    company: 'Meadowbank Trading',
    year: '2026', month: 'June',
    filedName: 'PurchaseOrder.03-06-2026.PO-5567',
    coach: 'A different document type — a Purchase Order. Notice Scan Finder files it under its own folder and naming, keeping everything tidy by type.',
    fields: [
      { key: 'supplier_name', label: 'Document Issuer', value: 'Meadowbank Trading', confidence: 97 },
      { key: 'po_number',     label: 'Reference',       value: 'PO-5567',            confidence: 94 },
      { key: 'po_date',       label: 'Date',            value: '03-06-2026',         confidence: 92 },
      { key: 'total_amount',  label: 'Total',           value: '2,880.00',           confidence: 95 },
    ],
  },
];
