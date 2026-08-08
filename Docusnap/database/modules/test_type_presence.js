'use strict';
// TYPE-PRESENCE (Type Slice 1) — JS learn-side pins + JS<->Python parity vectors.
// Run: node database/modules/test_type_presence.js   (plain node OK — pure logic + a mock db)

const fs = require('fs');
const path = require('path');
const tp = require('./typePresence');

const VEC = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'python_backend', 'tests', 'data', 'type_presence_vectors.json'), 'utf8'));

let fails = 0;
function check(label, cond) {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`);
  if (!cond) fails++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── typeHeadingTokens (shared vectors) ───────────────────────────────────────────
console.log('-- typeHeadingTokens (name ∪ aliases, generic-stripped) --');
for (const v of VEC.tokens) {
  check(`"${v.name}" + [${v.aliases}] -> [${v.expect}]`,
        eq(tp.typeHeadingTokens(v.name, v.aliases), v.expect));
}
check("'note'/'document' are generic (a lone one yields no tokens)",
      eq(tp.typeHeadingTokens('Document', []), []) && eq(tp.typeHeadingTokens('Note', []), []));
check('de-dupes repeated tokens across name+aliases',
      eq(tp.typeHeadingTokens('Purchase Order', ['Purchase Order Form']), ['purchase', 'order', 'form']));

// ── headingPresent (shared vectors — the >=0.6 whole-word match) ──────────────────
console.log('-- headingPresent (>=0.6 of tokens as whole words) --');
for (const v of VEC.present) {
  check(`[${v.tokens}] in "${v.band.replace(/\n/g, ' / ')}" -> ${v.expect}`,
        tp.headingPresent(v.tokens, v.band) === v.expect);
}
check('empty tokens / empty band -> false',
      tp.headingPresent([], 'delivery docket') === false && tp.headingPresent(['delivery'], '') === false);
check('whole-word only ("order" does not match inside "reorder")',
      tp.headingPresent(['order'], 'please reorder soon') === false);

// ── topBand (14 lines / 600 chars, lowered) ──────────────────────────────────────
console.log('-- topBand --');
const many = Array.from({ length: 30 }, (_, i) => `LINE${i}`).join('\n');
check('caps at 14 lines', tp.topBand(many).split('\n').length === 14);
check('lowercases', tp.topBand('DELIVERY DOCKET') === 'delivery docket');
check('caps at 600 chars', tp.topBand('x'.repeat(1000)).length === 600);

// ── templateTypeHeadingPresence (ratio over a template's confirmed docs) ──────────
console.log('-- templateTypeHeadingPresence (mock db) --');
function mockDb(type, docs) {
  return {
    prepare(sql) {
      return {
        get() { return /FROM document_types/.test(sql) ? type : undefined; },
        all()  { return /FROM documents/.test(sql) ? docs.map(t => ({ ocr_text: t })) : []; },
      };
    },
  };
}
const tmpl = { id: 7, document_type_slug: 'delivery_note' };
const type = { name: 'Delivery Note', title_aliases: JSON.stringify(['Delivery Docket']) };
const r1 = tp.templateTypeHeadingPresence(
  mockDb(type, ['ACME\ndelivery docket\nno 1', 'ACME\ndelivery docket\nno 2', 'ACME\nworksheet 38\nno 3']), tmpl);
check('tokens resolved from name ∪ aliases', eq(r1.tokens, ['delivery', 'docket']));
check('count = confirmed docs', r1.count === 3);
check('ratio = 2/3 (two docs print the heading, one is a mis-scanned worksheet)',
      Math.abs(r1.ratio - 2 / 3) < 1e-9);
const r2 = tp.templateTypeHeadingPresence(mockDb(type, []), tmpl);
check('no confirmed docs -> {ratio 0, count 0} but tokens still resolved',
      r2.count === 0 && r2.ratio === 0 && eq(r2.tokens, ['delivery', 'docket']));
const r3 = tp.templateTypeHeadingPresence(mockDb(null, ['x']), tmpl);
check('type not found -> {0,0,[]}', r3.count === 0 && r3.ratio === 0 && eq(r3.tokens, []));
const r4 = tp.templateTypeHeadingPresence(mockDb(type, ['x']), { id: 1, document_type_slug: '' });
check('no slug -> {0,0,[]}', eq(r4.tokens, []) && r4.count === 0);

console.log();
if (fails) { console.log(`FAIL: ${fails} check(s) failed`); process.exit(1); }
console.log('All type-presence (JS learn) pins passed.');
