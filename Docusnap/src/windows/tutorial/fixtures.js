'use strict';
// Pre-baked practice documents. Pure static data — the whole practice run lives in
// the renderer, nothing is wired to the real pipeline or DB.
//
// TEACH-FIRST protocol (2026-08-31, owner): the practice run now mirrors the
// recommended route — TEACH one document in a mini wizard sim, then IMPORT the
// batch, then REVIEW as the place you CORRECT. Three docs teach the loop:
//   sample1 — the TEACH document (Riverside invoice): the user points out each
//             detail by drawing a box round its value, then saves + files it.
//   sample2 — a SECOND Riverside invoice: comes in almost fully read ("because
//             you taught this sender once") with ONE uncertain detail the user
//             fixes IN REVIEW by typing over it (or drawing a box — both real).
//   sample3 — a Purchase Order from a sender the user has NOT taught: it still
//             reads what it can; the coach points at Teach for regulars.
//
// field: { key, label, value, confidence, low?, hint?, correct? }
//   low   — the deliberately uncertain field the user corrects in Review
// Doc-level: originalName (incoming scan), docType/company/year/month/filedName
// drive the filing reveal, coach is the per-doc guidance line, teach:true marks
// the wizard-sim document (its `value`s are what each drawn box "reads").
window.TUTORIAL_FIXTURES = [
  {
    id: 'sample1',
    teach: true,
    sampleFile: 'sample1.pdf',
    originalName: 'scan001.pdf',
    docType: 'Invoice',
    company: 'Riverside Office Co.',
    year: '2026', month: 'May',
    filedName: 'Invoice.22-05-2026.INV-2098',
    coach: 'Teach it once — point out each detail by drawing a box around the value on the page.',
    coachDone: 'All four details taught. Save the lesson and Scan Finder files this document — and remembers where to look on every Riverside document from now on.',
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer', value: 'Riverside Office Co.', confidence: 98,
        ask: 'Draw a box around the company name at the top — that tells Scan Finder who this layout belongs to.' },
      { key: 'invoice_number', label: 'Reference',       value: 'INV-2098',             confidence: 96,
        ask: 'Now the reference — draw a box around the invoice number.' },
      { key: 'invoice_date',   label: 'Date',            value: '22-05-2026',           confidence: 95,
        ask: 'The date next — box the date on the page.' },
      { key: 'total_amount',   label: 'Total',           value: '340.00',               confidence: 97,
        ask: 'Last one — box the total.' },
    ],
  },
  {
    id: 'sample2',
    sampleFile: 'sample2.pdf',
    originalName: 'scan002.pdf',
    docType: 'Invoice',
    company: 'Riverside Office Co.',
    year: '2026', month: 'June',
    filedName: 'Invoice.15-06-2026.INV-1042',
    coach: 'Another Riverside invoice — because you taught this sender once, the details are already filled in. One reading is uncertain: click it and type the correct value over it.',
    coachDone: 'Fixed — Scan Finder learns from corrections too. Press “Confirm and file” to file it.',
    fields: [
      { key: 'supplier_name',  label: 'Document Issuer', value: 'Riverside Office Co.', confidence: 98 },
      { key: 'invoice_number', label: 'Reference',       value: 'INV-1O42',              confidence: 54, low: true,
        hint: 'The scan is smudged here — it read a letter “O” where the page prints a zero. Click the value and type it as printed: INV-1042. (Drawing a box around it works too.)',
        correct: 'INV-1042' },
      { key: 'invoice_date',   label: 'Date',            value: '15-06-2026',            confidence: 97 },
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
    coach: 'A sender you haven’t taught — Scan Finder still reads what it can. Everything here looks right, so just confirm it. For companies you hear from regularly, teach one example first (the Teach button on the Home screen) and their documents arrive like the last one did.',
    fields: [
      { key: 'supplier_name', label: 'Document Issuer', value: 'Meadowbank Trading', confidence: 97 },
      { key: 'po_number',     label: 'Reference',       value: 'PO-5567',            confidence: 94 },
      { key: 'po_date',       label: 'Date',            value: '03-06-2026',         confidence: 92 },
      { key: 'total_amount',  label: 'Total',           value: '2,880.00',           confidence: 95 },
    ],
  },
];
