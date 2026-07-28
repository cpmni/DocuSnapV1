#!/usr/bin/env node
'use strict';

/**
 * src/modules/filing/test_filename_pattern.js
 * --------------------------------------------
 * Direct unit test for filename_pattern.js — the token-based filename
 * builder behind Settings → File Naming.
 *
 * Covers:
 *   1. Default naming — {docType}.{date}.{ref}, all values present
 *   2. Supplier-inclusive naming — a custom pattern using {supplier}
 *   3. Missing token values — empty tokens collapse their separators
 *      instead of leaving "Invoice..INV-001" / "Invoice--INV-001" artifacts
 *   4. Illegal character sanitisation — Windows-illegal chars stripped,
 *      whitespace folded to "-"
 *   5. Windows-safety hardening (the backend pass, not just UI validation) —
 *      trailing periods/spaces removed, reserved device names (CON, PRN,
 *      COM1, LPT1, …) defused, and a value that sanitises away to nothing
 *      still falls back safely to the default pattern
 *   6. Validation & fallback — unsupported tokens / empty patterns / a
 *      pattern that produces an empty filename for a given document all
 *      fall back to the default pattern, never silently pass through
 *   7. Duplicate filename handling — -DUPLICATE, -DUPLICATE-2, …
 *
 * Usage:
 *   node src/modules/filing/test_filename_pattern.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const {
  DEFAULT_PATTERN, validatePattern,
  sanitiseFilenameStem,
  buildFilename, resolveDuplicateFilename, resolveDuplicate, previewDuplicateName, DUPLICATES_SUBFOLDER,
  DEFAULT_FOLDER_PATTERN, FIELD_TOKENS, buildFolderSegments, buildFilenameStem,
} = require('./filename_pattern');

// #10: the filing handler's supplier fallback — a value that sanitises to empty
// must still yield a company folder ("Unknown Company"), not drop the level.
function supplierFolderFallback(raw) {
  return buildFilenameStem(String(raw || ''), {}) || 'Unknown Company';
}

function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`);
  return ok;
}

const SAMPLE_VALUES = {
  docType:      'Invoice',
  date:         '15-12-2025',
  ref:          'INV-2025-0142',
  supplier:     'Acme Supplies Ltd',
  year:         '2025',
  month:        'December',
  originalName: 'scan001',
};

function main() {
  let failures = 0;

  // 1. Default naming — every token resolves, default separators preserved
  {
    const r = buildFilename({ pattern: DEFAULT_PATTERN, values: SAMPLE_VALUES, ext: '.pdf' });
    console.log('Default pattern, all values present');
    if (!check('filename = Invoice.15-12-2025.INV-2025-0142.pdf', r.filename === 'Invoice.15-12-2025.INV-2025-0142.pdf', r.filename)) failures++;
    if (!check('did not fall back', r.fellBack === false)) failures++;
  }

  console.log();

  // 2. Supplier-inclusive naming — a custom pattern using {supplier}
  {
    const pattern = '{docType}.{supplier}.{date}.{ref}';
    const r = buildFilename({ pattern, values: SAMPLE_VALUES, ext: '.pdf' });
    console.log('Custom pattern with {supplier}: ' + pattern);
    if (!check('supplier name spaces become dashes', r.filename === 'Invoice.Acme-Supplies-Ltd.15-12-2025.INV-2025-0142.pdf', r.filename)) failures++;
    if (!check('did not fall back', r.fellBack === false)) failures++;
  }

  console.log();

  // 3. Missing token values — collapse the separator an empty token leaves behind
  {
    console.log('Missing token values: separators collapse instead of leaving gaps');

    const noDate = buildFilename({
      pattern: DEFAULT_PATTERN,
      values: { ...SAMPLE_VALUES, date: '' },
      ext: '.pdf',
    });
    if (!check('"{docType}.{date}.{ref}" with no date -> Invoice.INV-2025-0142.pdf (not Invoice..INV-2025-0142.pdf)',
      noDate.filename === 'Invoice.INV-2025-0142.pdf', noDate.filename)) failures++;

    const noRefTrailing = buildFilename({
      pattern: DEFAULT_PATTERN,
      values: { ...SAMPLE_VALUES, ref: '' },
      ext: '.pdf',
    });
    if (!check('"{docType}.{date}.{ref}" with no ref -> trailing separator trimmed',
      noRefTrailing.filename === 'Invoice.15-12-2025.pdf', noRefTrailing.filename)) failures++;

    const noSupplierDashed = buildFilename({
      pattern: '{docType}-{supplier}-{ref}',
      values: { ...SAMPLE_VALUES, supplier: '' },
      ext: '.pdf',
    });
    if (!check('"{docType}-{supplier}-{ref}" with no supplier -> Invoice-INV-2025-0142.pdf (not Invoice--INV-2025-0142.pdf)',
      noSupplierDashed.filename === 'Invoice-INV-2025-0142.pdf', noSupplierDashed.filename)) failures++;
  }

  console.log();

  // 4. Illegal character sanitisation
  {
    console.log('Illegal Windows filename characters are stripped, whitespace folded to "-"');
    const r = buildFilename({
      pattern: '{docType}.{supplier}',
      values: { ...SAMPLE_VALUES, supplier: 'Acme & Sons / Ltd? <UK>' },
      ext: '.pdf',
    });
    if (!check('/, ?, <, > removed; spaces -> dashes; & kept (legal on Windows)',
      r.filename === 'Invoice.Acme-&-Sons-Ltd-UK.pdf', r.filename)) failures++;
  }

  console.log();

  // 5. Windows-safety hardening — the backend pass that runs in the filing
  //    path itself (sanitiseFilenameStem), independent of UI validation
  {
    console.log('Windows-safety backend pass: trailing "." / " " trimmed, reserved device names defused');

    if (!check('sanitiseFilenameStem strips a trailing "." directly',
      sanitiseFilenameStem('Invoice.INV-001.') === 'Invoice.INV-001', sanitiseFilenameStem('Invoice.INV-001.'))) failures++;
    if (!check('sanitiseFilenameStem strips trailing spaces directly',
      sanitiseFilenameStem('Invoice.INV-001  ') === 'Invoice.INV-001', sanitiseFilenameStem('Invoice.INV-001  '))) failures++;

    const trailingDotInPattern = buildFilename({
      pattern: '{docType}.{ref}.',
      values: SAMPLE_VALUES,
      ext: '.pdf',
    });
    if (!check('a trailing "." baked into the pattern itself is stripped from the committed filename',
      trailingDotInPattern.filename === 'Invoice.INV-2025-0142.pdf', trailingDotInPattern.filename)) failures++;

    const trailingDotInValue = buildFilename({
      pattern: '{docType}.{supplier}',
      values: { ...SAMPLE_VALUES, supplier: 'Acme Ltd.' },
      ext: '.pdf',
    });
    if (!check('a trailing "." carried in from a token\'s own value is stripped too ("Acme Ltd." -> "Acme-Ltd")',
      trailingDotInValue.filename === 'Invoice.Acme-Ltd.pdf', trailingDotInValue.filename)) failures++;

    const reservedAlone = buildFilename({
      pattern: '{ref}',
      values: { ...SAMPLE_VALUES, ref: 'CON' },
      ext: '.pdf',
    });
    if (!check('reserved device name "CON" on its own is defused to "CON_" (case-insensitive, "_" appended)',
      reservedAlone.filename === 'CON_.pdf' && reservedAlone.fellBack === false, reservedAlone)) failures++;

    const reservedLeadingComponent = buildFilename({
      pattern: '{ref}.{date}',
      values: { ...SAMPLE_VALUES, ref: 'com9' },
      ext: '.pdf',
    });
    if (!check('reserved name as the leading dot-component is defused regardless of what follows ("com9.15-12-2025" -> "com9_.15-12-2025")',
      reservedLeadingComponent.filename === 'com9_.15-12-2025.pdf', reservedLeadingComponent.filename)) failures++;

    const notActuallyReserved = buildFilename({
      pattern: '{ref}',
      values: { ...SAMPLE_VALUES, ref: 'CONTRACT' },
      ext: '.pdf',
    });
    if (!check('"CONTRACT" / "COM10" etc. are NOT reserved — only an exact device-name match is defused',
      notActuallyReserved.filename === 'CONTRACT.pdf', notActuallyReserved.filename)) failures++;

    const sanitisedAwayToNothing = buildFilename({
      pattern: '{ref}',
      values: { ...SAMPLE_VALUES, ref: '???' },
      ext: '.pdf',
    });
    if (!check('a value that is sanitised away to nothing ("???") falls back to the default pattern, not an empty/invalid name',
      sanitisedAwayToNothing.filename === 'Invoice.15-12-2025.pdf' && sanitisedAwayToNothing.fellBack === true,
      sanitisedAwayToNothing)) failures++;
  }

  console.log();

  // 6. Validation & fallback — never silently pass unsupported tokens through
  {
    console.log('Pattern validation');
    if (!check('default pattern is valid', validatePattern(DEFAULT_PATTERN).valid)) failures++;
    if (!check('"{ref}" alone is valid (runtime-empty is a fallback concern, not a validity one)', validatePattern('{ref}').valid)) failures++;

    const empty = validatePattern('   ');
    if (!check('blank pattern is invalid', empty.valid === false && /empty/i.test(empty.reason), empty)) failures++;

    const punctOnly = validatePattern('...---');
    if (!check('punctuation-only pattern is invalid (no tokens, no usable text)', punctOnly.valid === false, punctOnly)) failures++;

    const bogus = validatePattern('{docType}.{bogus}');
    if (!check('unsupported token is rejected, not passed through', bogus.valid === false && /Unsupported token: \{bogus\}/.test(bogus.reason), bogus)) failures++;

    console.log();
    console.log('Fallback behaviour — bad/empty-result patterns fall back to the default, with a reason');

    const fellBackBogus = buildFilename({ pattern: '{docType}.{bogus}', values: SAMPLE_VALUES, ext: '.pdf' });
    if (!check('unsupported-token pattern falls back to default output', fellBackBogus.filename === 'Invoice.15-12-2025.INV-2025-0142.pdf', fellBackBogus.filename)) failures++;
    if (!check('fallback is flagged with a reason', fellBackBogus.fellBack === true && !!fellBackBogus.reason)) failures++;

    const emptyResult = buildFilename({
      pattern: '{ref}',
      values: { ...SAMPLE_VALUES, ref: '' },
      ext: '.pdf',
    });
    if (!check('"{ref}" with no ref value on this document -> falls back to default pattern\'s output',
      emptyResult.filename === 'Invoice.15-12-2025.pdf', emptyResult.filename)) failures++;
    if (!check('empty-result fallback is flagged with a reason', emptyResult.fellBack === true && !!emptyResult.reason)) failures++;
  }

  console.log();

  // 7. Duplicate filename handling — unchanged from the existing behaviour
  {
    console.log('Duplicate filename resolution: -DUPLICATE, -DUPLICATE-2, …');
    const base = 'Invoice.15-12-2025.INV-001.pdf';

    const none = new Set();
    if (!check('no collision -> base filename kept', resolveDuplicateFilename(base, '.pdf', n => none.has(n)) === base)) failures++;

    const oneCollision = new Set([base]);
    if (!check('one collision -> -DUPLICATE',
      resolveDuplicateFilename(base, '.pdf', n => oneCollision.has(n)) === 'Invoice.15-12-2025.INV-001-DUPLICATE.pdf')) failures++;

    const twoCollisions = new Set([base, 'Invoice.15-12-2025.INV-001-DUPLICATE.pdf']);
    if (!check('two collisions -> -DUPLICATE-2',
      resolveDuplicateFilename(base, '.pdf', n => twoCollisions.has(n)) === 'Invoice.15-12-2025.INV-001-DUPLICATE-2.pdf')) failures++;

    const threeCollisions = new Set([
      base,
      'Invoice.15-12-2025.INV-001-DUPLICATE.pdf',
      'Invoice.15-12-2025.INV-001-DUPLICATE-2.pdf',
    ]);
    if (!check('three collisions -> -DUPLICATE-3',
      resolveDuplicateFilename(base, '.pdf', n => threeCollisions.has(n)) === 'Invoice.15-12-2025.INV-001-DUPLICATE-3.pdf')) failures++;
  }

  // 7b. Policy-aware duplicate resolution (2026-07-17) — suffix styles + Duplicates subfolder
  {
    console.log('Duplicate policy: suffix styles + Duplicates subfolder');
    const base = 'Invoice.15-12-2025.INV-001.pdf';
    const inDir = (set) => (name, sub) => set.has((sub ? sub + '/' : '') + name);

    let r = resolveDuplicate(base, '.pdf', inDir(new Set()), { policy: 'suffix', suffix: 'DUPLICATE' });
    if (!check('no collision -> base, no subfolder', r.filename === base && r.subfolder === '')) failures++;

    const two = new Set([base, 'Invoice.15-12-2025.INV-001-DUPLICATE.pdf']);
    r = resolveDuplicate(base, '.pdf', inDir(two), { policy: 'suffix', suffix: 'DUPLICATE' });
    if (!check('DEFAULT suffix DUPLICATE byte-identical (-DUPLICATE-2)',
      r.filename === 'Invoice.15-12-2025.INV-001-DUPLICATE-2.pdf' && r.subfolder === '')) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base])), { policy: 'suffix', suffix: 'COPY' });
    if (!check('suffix COPY -> -COPY', r.filename === 'Invoice.15-12-2025.INV-001-COPY.pdf')) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base, 'Invoice.15-12-2025.INV-001-2.pdf'])), { policy: 'suffix', suffix: 'number' });
    if (!check('suffix number -> -3 (pure counter)', r.filename === 'Invoice.15-12-2025.INV-001-3.pdf')) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base])), { policy: 'suffix', suffix: 'date', now: new Date(2026, 2, 5) });
    if (!check('suffix date -> -2026-03-05', r.filename === 'Invoice.15-12-2025.INV-001-2026-03-05.pdf')) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base])), { policy: 'suffix', suffix: 'ARCHIVE' });
    if (!check('custom suffix -> -ARCHIVE', r.filename === 'Invoice.15-12-2025.INV-001-ARCHIVE.pdf')) failures++;

    // previewDuplicateName — the Settings live preview; mirrors the FIRST-collision 'suffix' result (pure).
    if (!check('preview DUPLICATE', previewDuplicateName(base, '.pdf', 'DUPLICATE') === 'Invoice.15-12-2025.INV-001-DUPLICATE.pdf')) failures++;
    if (!check('preview COPY',      previewDuplicateName(base, '.pdf', 'COPY')      === 'Invoice.15-12-2025.INV-001-COPY.pdf')) failures++;
    if (!check('preview number -> -2', previewDuplicateName(base, '.pdf', 'number') === 'Invoice.15-12-2025.INV-001-2.pdf')) failures++;
    if (!check('preview date',      previewDuplicateName(base, '.pdf', 'date', new Date(2026, 2, 5)) === 'Invoice.15-12-2025.INV-001-2026-03-05.pdf')) failures++;
    if (!check('preview default (unset) === DUPLICATE', previewDuplicateName(base, '.pdf', null) === 'Invoice.15-12-2025.INV-001-DUPLICATE.pdf')) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base])), { policy: 'suffix', suffix: 'a/b:c' });
    if (!check('custom suffix sanitised (no path sep / illegal chars)',
      r.subfolder === '' && !/[\\/:]/.test(r.filename) && r.filename.startsWith('Invoice.15-12-2025.INV-001-'))) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base])), { policy: 'subfolder' });
    if (!check('subfolder policy -> Duplicates/, same name',
      r.filename === base && r.subfolder === DUPLICATES_SUBFOLDER)) failures++;

    r = resolveDuplicate(base, '.pdf', inDir(new Set([base, 'Duplicates/' + base])), { policy: 'subfolder' });
    if (!check('subfolder dup-of-dup -> -2 inside Duplicates',
      r.subfolder === DUPLICATES_SUBFOLDER && r.filename === 'Invoice.15-12-2025.INV-001-2.pdf')) failures++;
  }

  // ── Folder-pattern builder (Settings → Output Structure) ────────────────────
  console.log('\nFolder-pattern builder:');
  const fv = { supplier: 'Acme Supplies Ltd', docType: 'Invoice', year: '2025', month: 'December', ref: 'INV-001', date: '15-12-2025' };
  if (!check('default folder pattern = the legacy Company/Year/Month layout',
    DEFAULT_FOLDER_PATTERN === '{supplier}/{year}/{month}' &&
    JSON.stringify(buildFolderSegments(DEFAULT_FOLDER_PATTERN, fv)) === JSON.stringify(['Acme-Supplies-Ltd', '2025', 'December']),
    buildFolderSegments(DEFAULT_FOLDER_PATTERN, fv))) failures++;
  if (!check('"/" makes a new subfolder level; an illegal "/" inside a value is stripped',
    JSON.stringify(buildFolderSegments('{supplier}/{docType}', { ...fv, supplier: 'A/B Ltd' })) === JSON.stringify(['AB-Ltd', 'Invoice']))) failures++;
  if (!check('custom text between tokens is kept as a folder level',
    JSON.stringify(buildFolderSegments('Archive/{year}', fv)) === JSON.stringify(['Archive', '2025']))) failures++;
  if (!check('empty pattern -> zero subfolders (files into the output root)',
    buildFolderSegments('', fv).length === 0)) failures++;
  if (!check('a level whose only token is empty is dropped (no blank folder)',
    JSON.stringify(buildFolderSegments('{supplier}/{ref}/{year}', { ...fv, ref: '' })) === JSON.stringify(['Acme-Supplies-Ltd', '2025']))) failures++;
  if (!check('reserved device name as a folder level is defused',
    buildFolderSegments('{docType}', { ...fv, docType: 'CON' })[0] === 'CON_')) failures++;
  if (!check('builder blocks are the meaningful field tokens only ({title} joined 2026-07-18)',
    FIELD_TOKENS.map(t => t.token).join(',') === '{supplier},{docType},{date},{ref},{year},{month},{title}')) failures++;

  // #10: empty-sanitising supplier keeps a company folder (never files under Year/Month directly).
  for (const bad of ['..', '///', '***', '   ', '.']) {
    if (!check(`supplier "${bad}" falls back to Unknown Company`,
      supplierFolderFallback(bad) === 'Unknown Company')) failures++;
    const segs = buildFolderSegments(DEFAULT_FOLDER_PATTERN, { ...fv, supplier: supplierFolderFallback(bad) });
    if (!check(`supplier "${bad}" keeps the company folder level`,
      segs[0] === 'Unknown-Company' && segs.length === 3)) failures++;
  }
  if (!check('a real supplier is untouched by the fallback',
    supplierFolderFallback('Acme Supplies Ltd') === 'Acme Supplies Ltd')) failures++;

  // ── {title} token + the slice-6 default (Generic Document design §6/§7) ────────
  console.log('\n{title} token + new default pattern:');
  const typed = { docType: 'Invoice', date: '15-12-2025', ref: 'INV-001', supplier: 'Acme', year: '2025', month: 'December', originalName: 'scan1', title: '' };
  if (!check('{title} is a registered token (pattern with it does NOT fall back)',
    buildFilename({ pattern: '{docType}.{title}', values: { ...typed, title: 'Boiler Service Certificate' }, ext: '.pdf' }).fellBack === false)) failures++;
  if (!check('title value is sanitised (spaces→dashes)',
    buildFilename({ pattern: '{title}', values: { ...typed, title: 'Boiler Service Certificate' }, ext: '.pdf' }).filename === 'Boiler-Service-Certificate.pdf')) failures++;
  // PIN (slice 6): the new default is BYTE-IDENTICAL for typed docs — title empty ⇒ collapses.
  const oldDefault = buildFilename({ pattern: '{docType}.{date}.{ref}', values: typed, ext: '.pdf' }).filename;
  const newDefault = buildFilename({ pattern: DEFAULT_PATTERN, values: typed, ext: '.pdf' }).filename;
  if (!check(`new default byte-identical for typed docs (${newDefault})`, newDefault === oldDefault)) failures++;
  if (!check('generic doc (no ref) + title under the new default',
    buildFilename({ pattern: DEFAULT_PATTERN,
      values: { ...typed, docType: 'General Document', ref: '', title: 'Tenancy Agreement' }, ext: '.pdf' }).filename
      === 'General-Document.15-12-2025.Tenancy-Agreement.pdf')) failures++;

  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — filename_pattern regressed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All checks passed — filename_pattern behaves as expected.');
}

main();
