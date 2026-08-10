'use strict';
/*
 * fixed_value_locatable.js — READ-ONLY census.
 *
 * THE QUESTION THIS ANSWERS (owner, 2026-08-10): a teach that TYPES a value stores
 * `{value, target:null, anchor:null, status:'fixed'}` — no geometry at all, so nothing a future
 * document of the same layout can be matched against, and the value is reused as-is on every
 * document of the type. Before designing a fix, we need to know WHY those values were typed:
 *
 *   - If most of them ARE printed on their own sample page, they were typed because the OCR read
 *     was wrong, not because the value is absent. Then the fix is small and obvious: find the
 *     typed string in the page's word geometry and store the box it was found at, turning most
 *     manual entries back into positioned teaches for free.
 *   - If most of them are genuinely NOT on the page, no amount of searching will find them, and
 *     the work belongs on confidence/scope instead (don't let a sample-of-one typed constant be
 *     asserted at 95; ask the operator whether it applies to every document).
 *
 * The measurement is deliberately CRUDE and generous — it uses the sample document's stored
 * `ocr_text`, i.e. "is this string present on the page at all", which is an UPPER BOUND on what a
 * geometry search could find (a value present in the text might still be unmatchable in the word
 * boxes; a value absent from the text certainly is). An upper bound is the right shape here: if
 * even the generous test says "rarely present", direction 1 is dead without further work.
 *
 * READ-ONLY: opens `mode=ro` and never writes. Point it at a SNAPSHOT, never at a DB the running
 * app has open (`?immutable=1` is WRONG here — it ignores the -wal, which is where recent writes
 * live).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
 *     stress_test/fixed_value_locatable.js TESTING/_measure/fixedval.db
 */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join('TESTING', '_measure', 'fixedval.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Compare-time normalisation, mirroring the spirit of text_normalise: case-fold and strip
// everything that is not alphanumeric, so punctuation/spacing differences between what was typed
// and what OCR produced don't count as "absent". Generous ON PURPOSE (see header).
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const rows = db.prepare(`
  SELECT tf.template_id, tf.field_key, tf.fixed_value,
         t.name          AS template_name,
         t.document_type_slug AS slug,
         t.sample_document_id AS sample_id,
         d.id            AS doc_id,
         d.original_filename AS doc_name,
         LENGTH(COALESCE(d.ocr_text, '')) AS ocr_len,
         d.ocr_text      AS ocr_text
    FROM template_fields tf
    JOIN templates t ON t.id = tf.template_id
    LEFT JOIN documents d ON d.id = t.sample_document_id
   WHERE tf.fixed_value IS NOT NULL AND TRIM(tf.fixed_value) <> ''
   ORDER BY tf.template_id, tf.field_key
`).all();

const buckets = {
  present:    [],   // printed on its own sample page ⇒ a geometry search could have found it
  absent:     [],   // genuinely not on the page ⇒ no search will help
  no_sample:  [],   // template has no pinned sample document — unmeasurable, not a verdict
  no_ocr:     [],   // sample exists but carries no OCR text — unmeasurable, not a verdict
};

for (const r of rows) {
  const val = String(r.fixed_value).trim();
  if (r.sample_id == null || r.doc_id == null) { buckets.no_sample.push({ ...r, val }); continue; }
  if (!r.ocr_len)                              { buckets.no_ocr.push({ ...r, val });    continue; }
  const nv = norm(val);
  // A very short normalised value would match almost anything; treat those as unmeasurable rather
  // than counting a coincidence as a find.
  if (nv.length < 3) { buckets.no_ocr.push({ ...r, val, why: 'value too short to test' }); continue; }
  (norm(r.ocr_text).includes(nv) ? buckets.present : buckets.absent).push({ ...r, val });
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const measurable = buckets.present.length + buckets.absent.length;

console.log(`\nDB: ${dbPath}`);
console.log(`Fixed values (template_fields.fixed_value, non-empty): ${rows.length}\n`);
console.log(`  PRINTED on its own sample page : ${String(buckets.present.length).padStart(4)}  (${pct(buckets.present.length, measurable)} of measurable)`);
console.log(`  NOT on the page                 : ${String(buckets.absent.length).padStart(4)}  (${pct(buckets.absent.length, measurable)} of measurable)`);
console.log(`  no pinned sample document      : ${String(buckets.no_sample.length).padStart(4)}  (unmeasurable)`);
console.log(`  sample has no OCR text / short : ${String(buckets.no_ocr.length).padStart(4)}  (unmeasurable)`);
console.log(`  ------------------------------------------`);
console.log(`  measurable total               : ${String(measurable).padStart(4)}\n`);

// Per-field breakdown: WHICH fields are being typed matters as much as how many. A field that is
// always typed and always present is the strongest case for the geometry search; a field always
// typed and never present is a genuine constant.
const byField = {};
for (const k of ['present', 'absent']) {
  for (const r of buckets[k]) {
    (byField[r.field_key] ||= { present: 0, absent: 0 })[k]++;
  }
}
const fieldRows = Object.entries(byField).sort((a, b) =>
  (b[1].present + b[1].absent) - (a[1].present + a[1].absent));
if (fieldRows.length) {
  console.log('Per field (measurable only):');
  console.log('  field                     printed   absent');
  for (const [key, v] of fieldRows) {
    console.log(`  ${key.padEnd(24)} ${String(v.present).padStart(7)} ${String(v.absent).padStart(8)}`);
  }
  console.log('');
}

const show = (title, list, n) => {
  if (!list.length) return;
  console.log(`${title} (showing ${Math.min(n, list.length)} of ${list.length}):`);
  for (const r of list.slice(0, n)) {
    console.log(`  tpl ${String(r.template_id).padStart(3)} ${String(r.field_key).padEnd(18)} ` +
                `${JSON.stringify(r.val).padEnd(34)} ${r.doc_name || '(no sample)'}`);
  }
  console.log('');
};
show('PRINTED — a geometry search could have captured a box', buckets.present, 25);
show('NOT ON THE PAGE — a genuine constant', buckets.absent, 25);
show('UNMEASURABLE — no pinned sample', buckets.no_sample, 10);

db.close();
