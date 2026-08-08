'use strict';
/*
 * compile-python-bytecode.js — stage python_backend/ for packaging as SOURCELESS BYTECODE.
 *
 * WHY (2026-07-26, owner decision): the installer previously shipped the whole extraction pipeline
 * as readable .py source (extraResources copied python_backend/ verbatim) — effectively source
 * distribution of the core IP. This script builds `build_python/` (gitignored): a copy of
 * python_backend with every LIBRARY module compiled to an adjacent .pyc (compileall -b, sourceless
 * imports — CPython loads module.pyc/__init__.pyc in place of .py) and the .py removed. Packaging
 * (package.json extraResources) ships build_python/ AS "python_backend", so every runtime path is
 * unchanged.
 *
 * WHAT STAYS AS SOURCE — the JS-SPAWNED ENTRY SCRIPTS ONLY (spawned as `python.exe <path>.py`;
 * grep-verified against src/ 2026-07-26). These are thin CLIs / spawn surfaces; the crown jewels
 * (extraction/*, ocr/tesseract.py etc., logo_hash/logo_detail) all compile. A later hardening pass
 * can shim these too.
 *
 * RECOVERABILITY / KILL SWITCH: SHIP_PY_SOURCE=1 stages a VERBATIM source copy (the pre-2026-07-26
 * installer content, byte-identical behaviour); reverting this commit restores the old pipeline
 * entirely. The .pyc magic is guaranteed to match the shipped interpreter because compilation runs
 * under vendor/python/python.exe itself (the exact exe the installer bundles).
 *
 * Run standalone:  node scripts/compile-python-bytecode.js
 * Wired into:      npm run build (before electron-builder)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'python_backend');
const OUT = path.join(ROOT, 'build_python');
const VENDOR_PY = path.join(ROOT, 'vendor', 'python', 'python.exe');

// Never staged (mirrors the old extraResources filter + dev debris).
const EXCLUDE_DIRS = new Set(['__pycache__', 'tests', 'test_harness', 'artifacts']);

// JS-spawned entry scripts — MUST remain .py at these exact relative paths (spawn contract).
const KEEP_SOURCE = new Set([
  'process_docs.py', 'render_pages.py', 'ocr_region.py', 'pdf_splitter.py', 'pdf_rotate.py',
  'segment_docs.py', 'filing_slips.py', 'template_fingerprint.py', 'test_mapping.py',
  'ocr/region.py', 'ocr/region_worker.py', 'ocr/landmarks.py',
  'render/pages.py', 'render/preview_enhance.py',
  'logo/fingerprint.py',
].map(p => p.replace(/\//g, path.sep)));

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      copyTree(path.join(src, e.name), path.join(dst, e.name));
    } else {
      if (e.name.endsWith('.pyc') || e.name.endsWith('.pyo')) continue;   // stale debris never rides
      fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
    }
  }
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(SRC, OUT);

  if (process.env.SHIP_PY_SOURCE === '1') {
    console.log('[compile-python-bytecode] SHIP_PY_SOURCE=1 — staged VERBATIM source copy (kill switch).');
    return;
  }
  if (!fs.existsSync(VENDOR_PY)) {
    console.error('[compile-python-bytecode] vendor/python/python.exe missing — cannot guarantee .pyc');
    console.error('magic matches the shipped interpreter. Aborting (build machines carry vendor/).');
    process.exit(1);
  }

  // Compile EVERY .py to an adjacent .pyc with the SHIPPED interpreter (magic-number guarantee).
  // -b = legacy adjacent layout (module.pyc beside module.py) => sourceless import after .py removal.
  execFileSync(VENDOR_PY, ['-m', 'compileall', '-b', '-q', OUT], { stdio: 'inherit' });

  // Remove source for everything EXCEPT the spawn-contract entry scripts.
  let compiled = 0, kept = 0;
  for (const f of [...walk(OUT)]) {
    if (!f.endsWith('.py')) continue;
    const rel = path.relative(OUT, f);
    if (KEEP_SOURCE.has(rel)) { kept++; continue; }
    const pyc = f + 'c';                       // module.py -> module.pyc (compileall -b)
    if (!fs.existsSync(pyc)) {
      console.error(`[compile-python-bytecode] MISSING BYTECODE for ${rel} — refusing to strip source.`);
      process.exit(1);
    }
    fs.rmSync(f);
    compiled++;
  }
  // compileall -b also compiled the kept entries (harmless adjacent .pyc; python.exe entry.py
  // ignores it because the .py timestamp governs nothing in -b mode) — drop those to avoid staleness.
  for (const rel of KEEP_SOURCE) {
    const pyc = path.join(OUT, rel) + 'c';
    fs.rmSync(pyc, { force: true });
  }
  // Belt: no __pycache__ dirs in the staged tree.
  for (const f of [...walk(OUT)]) {
    if (f.includes('__pycache__')) fs.rmSync(f, { force: true });
  }

  // Sanity gate: the crown jewels must be sourceless; the entries must exist as source.
  const mustBeGone = ['extraction/engine.py', 'extraction/anchor.py', 'extraction/template_matcher.py',
                      'ocr/tesseract.py', 'logo_detail.py', 'logo_hash.py']
    .map(p => p.replace(/\//g, path.sep));
  for (const rel of mustBeGone) {
    if (fs.existsSync(path.join(OUT, rel))) {
      console.error(`[compile-python-bytecode] ${rel} still present as SOURCE — gate failed.`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(OUT, rel) + 'c')) {
      console.error(`[compile-python-bytecode] ${rel}c missing — gate failed.`);
      process.exit(1);
    }
  }
  for (const rel of KEEP_SOURCE) {
    if (!fs.existsSync(path.join(OUT, rel))) {
      console.error(`[compile-python-bytecode] entry ${rel} missing from stage — gate failed.`);
      process.exit(1);
    }
  }
  console.log(`[compile-python-bytecode] staged build_python: ${compiled} modules sourceless, ${kept} spawn entries kept as .py`);
}

main();
