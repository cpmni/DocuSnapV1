#!/usr/bin/env node
'use strict';
/**
 * scripts/test_no_shipped_py_source.js — SOURCE-PROTECTION build gate (Build 1, 2026-09-07;
 * Oracle SIGN-OFF-W/COND). Runs AFTER scripts/compile-python-bytecode.js has staged build_python/,
 * BEFORE electron-builder packs it. Asserts the invariant the owner asked for: no readable Python
 * source ships. Belt to the two gates inside compile-python-bytecode.js — a separate, wired script so
 * the guarantee survives a future refactor of the compile stage.
 *
 * Fails the build if ANY .py remains in the staged tree, or if a crown-jewel / spawn-entry module is
 * NOT present as sourceless .pyc. Honours SHIP_PY_SOURCE=1 (the kill switch): when set, the stage is
 * verbatim source by design, so this gate is skipped.
 *
 *   node scripts/test_no_shipped_py_source.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build_python');

if (process.env.SHIP_PY_SOURCE === '1') {
  console.log('[test_no_shipped_py_source] SHIP_PY_SOURCE=1 — verbatim source staged by design; gate skipped.');
  process.exit(0);
}
if (!fs.existsSync(OUT)) {
  console.error('[test_no_shipped_py_source] build_python/ not staged — run scripts/compile-python-bytecode.js first.');
  process.exit(1);
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let fails = 0;

// 1. NO .py anywhere in the staged tree (the ALLOWLIST is empty — KEEP_SOURCE=∅).
const leftover = [...walk(OUT)].filter(f => f.endsWith('.py')).map(f => path.relative(OUT, f));
if (leftover.length) {
  console.error(`[test_no_shipped_py_source] ${leftover.length} readable .py in build_python/ — FAIL:`);
  leftover.slice(0, 30).forEach(r => console.error(`    ${r}`));
  fails++;
} else {
  console.log('[test_no_shipped_py_source] OK — 0 readable .py in the staged tree.');
}

// 2. crown jewels + JS-spawned entries exist as sourceless .pyc (mirrors the compile gate's list).
const CROWN = ['extraction/engine.py', 'extraction/anchor.py', 'extraction/template_matcher.py',
               'ocr/tesseract.py', 'logo_detail.py', 'logo_hash.py'];
const ENTRIES = ['process_docs.py', 'render_pages.py', 'ocr_region.py', 'pdf_splitter.py', 'pdf_rotate.py',
                 'segment_docs.py', 'filing_slips.py', 'template_fingerprint.py', 'test_mapping.py',
                 'ocr/region.py', 'ocr/region_worker.py', 'ocr/landmarks.py', 'ocr/detect_angle.py',
                 'render/pages.py', 'render/preview_enhance.py', 'logo/fingerprint.py'];
for (const rel of [...CROWN, ...ENTRIES].map(p => p.replace(/\//g, path.sep))) {
  const src = path.join(OUT, rel);
  const pyc = src + 'c';
  if (fs.existsSync(src)) { console.error(`[test_no_shipped_py_source] ${rel} present as SOURCE — FAIL`); fails++; }
  if (!fs.existsSync(pyc)) { console.error(`[test_no_shipped_py_source] ${rel}c (bytecode) missing — FAIL`); fails++; }
}

if (fails) { console.error(`\n[test_no_shipped_py_source] FAILED: ${fails}`); process.exit(1); }
console.log('[test_no_shipped_py_source] ALL PASS — build_python/ is fully sourceless.');
