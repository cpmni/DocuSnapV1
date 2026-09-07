'use strict';
/*
 * harden-js.js — SOURCE PROTECTION Build 2 (+3) for the MAIN-PROCESS JS. OPT-IN, OFF by default.
 *
 * WHY: app.asar ships every src/ + database/ .js as readable source (`npx @electron/asar extract` dumps
 * database/modules/trust.js — the auto-file/graduation predicate — and the licensing gate verbatim). This
 * script stages `build_js/` (gitignored): a copy of src/ + database/ where the ENTIRE main-process require
 * graph reachable from src/main.js is esbuild-bundled into ONE file at src/main.js and the now-inlined
 * source files are removed. With --bytecode it then V8-compiles that bundle to src/main.jsc (bytenode) and
 * leaves a 2-line source loader at src/main.js, so `asar extract` yields bytecode, not code.
 *
 * SAFE BECAUSE (verified 2026-09-07): there are NO computed require()s of app source and NO dynamic
 * import() in src/ or database/ (grep-clean), so esbuild statically resolves the whole graph — nothing is
 * left as a runtime require to a file this script deletes. node_modules stay EXTERNAL (packages:'external'
 * — better-sqlite3/argon2 native, bytenode, electron), and the renderer assets (src/windows/**) + the
 * preload (src/preload.js) are loaded by PATH at runtime (loadFile / preload:), never require()d, so
 * esbuild never touches them and they ship unbundled.
 *
 * OPT-IN: only scripts/build-electron.js (HARDEN_JS=1) runs this and remaps electron-builder's `files` to
 * pull src/ + database/ from build_js/. A normal `npm run build` never calls it → byte-identical. Kill
 * switch = don't set HARDEN_JS (or `git revert`). The bundle is emitted at src/main.js's SAME asar-relative
 * path so __dirname-relative loads (windows html, preload) and process.resourcesPath seams are unchanged.
 *
 *   node scripts/harden-js.js            # Build 2: bundle only (readable-but-collapsed)
 *   node scripts/harden-js.js --bytecode # Build 2+3: bundle then V8-bytecode the bundle
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build_js');
const ENTRY_REL = path.join('src', 'main.js');
const WANT_BYTECODE = process.argv.includes('--bytecode');

// Copy a tree, skipping test files + dev debris (mirrors the packaged `files` negations).
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (['__tests__', 'node_modules'].includes(e.name)) continue;
      copyTree(path.join(src, e.name), path.join(dst, e.name));
    } else {
      if (/^test_.*\.js$/.test(e.name) || /\.test\.js$/.test(e.name) || e.name.endsWith('.map')) continue;
      fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
    }
  }
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(path.join(ROOT, 'src'), path.join(OUT, 'src'));
  copyTree(path.join(ROOT, 'database'), path.join(OUT, 'database'));

  const esbuild = require('esbuild');
  const entry = path.join(OUT, ENTRY_REL);
  const tmpOut = path.join(OUT, 'src', '.main.bundle.js');

  const result = esbuild.buildSync({
    entryPoints: [entry],
    outfile: tmpOut,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    packages: 'external',      // keep ALL node_modules external (native deps, electron, bytenode)
    // Keep the app's package.json a RUNTIME require — electron-builder injects buildRev into the
    // packaged copy, and main.js reads pkg.version/buildRev from it; inlining it here would freeze a
    // stale/absent rev. It resolves at runtime (bundle at asar/src/main.js -> asar/package.json).
    external: ['../package.json'],
    metafile: true,
    logLevel: 'warning',
    legalComments: 'none',
    // OBFUSCATE VARIABLES (2026-09-07, owner ask): minify renames every LOCAL identifier — and after
    // bundling the whole graph into one file, internal functions like `isAutoFileEligible`/
    // `_corrobLicensed` ARE locals, so they get renamed too (they only kept their names in the readable
    // asar because they were cross-module property references). This scrubs the identifier names from the
    // bytecode constant pool that plain bytenode leaves visible. Whitespace/tracebacks don't matter — the
    // bundle becomes bytecode. String LITERALS (note text, threshold-as-string) survive minify; the
    // optional javascript-obfuscator string-array pass below hides those when HARDEN_JS_STRINGS=1.
    minify: true,
  });

  // Which app-source files got inlined into the bundle → delete them from build_js (only the bundle ships).
  const inputs = Object.keys(result.metafile.inputs)
    .map(p => path.resolve(ROOT, p))
    .filter(p => p.startsWith(OUT + path.sep) && !p.includes(`${path.sep}node_modules${path.sep}`));

  // Overwrite the entry with the bundle, then remove every OTHER inlined source file.
  fs.rmSync(entry);
  fs.renameSync(tmpOut, entry);
  let removed = 0;
  for (const f of inputs) {
    if (f === entry) continue;
    if (fs.existsSync(f)) { fs.rmSync(f); removed++; }
  }
  // Prune now-empty dirs under build_js/database and build_js/src (leaves windows/ + preload.js intact).
  pruneEmpty(path.join(OUT, 'database'));
  pruneEmpty(path.join(OUT, 'src'));

  let mode = `bundle only (${removed} source modules inlined + removed)`;

  // OPT-IN string-array obfuscation (HARDEN_JS_STRINGS=1). minify already renamed every local identifier;
  // this hides the STRING LITERALS that survive it (DB setting keys like "graduation_window", log text,
  // method-name strings) by moving them into a rotated/encoded array decoded at runtime. Conservative
  // config for a Node/Electron MAIN bundle: NO transformObjectKeys (property-key mangling is the risky
  // lever — module-boundary keys like `isAutoFileEligible` and any JSON-serialised/DB-payload key would
  // break; left readable by design), NO controlFlowFlattening / deadCodeInjection (startup cost), NO
  // selfDefending / debugProtection (they break under bytenode and hang). Console output kept (the owner
  // diagnoses from processing.log). External require() path strings are encoded but decode at runtime, so
  // node_modules/electron resolution is unaffected.
  if (process.env.HARDEN_JS_STRINGS === '1') {
    const JsObf = require('javascript-obfuscator');
    const code = fs.readFileSync(entry, 'utf8');
    const obf = JsObf.obfuscate(code, {
      compact: true,
      target: 'node',
      identifierNamesGenerator: 'mangled',
      renameGlobals: false,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 1,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      splitStrings: false,
      transformObjectKeys: false,
      numbersToExpressions: false,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      selfDefending: false,
      debugProtection: false,
      disableConsoleOutput: false,
      unicodeEscapeSequence: false,
    }).getObfuscatedCode();
    fs.writeFileSync(entry, obf);
    mode += ' + string-array obfuscation';
  }

  if (WANT_BYTECODE) {
    // V8-bytecode the bundle with THIS project's Electron (V8 parity — a bytenode .jsc is locked to the
    // exact V8; compiling with node_modules/electron guarantees it matches the shipped binary, mirroring
    // compile-python-bytecode.js's shipped-interpreter guarantee).
    const jsc = path.join(OUT, 'src', 'main.jsc');
    const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const compileScript = path.join(ROOT, 'scripts', '_bytenode_compile.js');
    if (!fs.existsSync(electronExe)) { console.error('[harden-js] node_modules/electron missing — cannot V8-compile.'); process.exit(1); }
    execFileSync(electronExe, [compileScript, entry, jsc], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (!fs.existsSync(jsc)) { console.error('[harden-js] main.jsc not produced — gate failed.'); process.exit(1); }
    // The source loader stub that ships as src/main.js (electron's entry). Requires bytenode (a runtime
    // dep) to register the .jsc loader, then runs the compiled bundle.
    const stub = "'use strict';\n"
      + "// SOURCE PROTECTION Build 3 — the real main-process code is the adjacent V8-bytecode bundle\n"
      + "// (main.jsc, built by scripts/harden-js.js --bytecode). bytenode registers the .jsc require hook.\n"
      + "require('bytenode');\n"
      + "module.exports = require('./main.jsc');\n";
    fs.rmSync(entry);
    fs.writeFileSync(entry, stub);
    const strNote = process.env.HARDEN_JS_STRINGS === '1' ? ' + string-array obfuscation' : '';
    mode = `bundle${strNote} + V8 bytecode (main.jsc; ${removed} source modules inlined + removed)`;
  }

  // Gate: the crown-jewel source must be GONE from build_js.
  const crown = [path.join('database', 'modules', 'trust.js'),
                 path.join('src', 'modules', 'licensing', 'handler.js'),
                 path.join('src', 'lib', 'license', 'token.js')];
  for (const rel of crown) {
    if (fs.existsSync(path.join(OUT, rel))) {
      console.error(`[harden-js] ${rel} still present as SOURCE in build_js — gate failed.`);
      process.exit(1);
    }
  }
  // Belt: the renderer + preload MUST remain (they are not bundled).
  for (const rel of [path.join('src', 'preload.js'), path.join('src', 'windows', 'review', 'renderer.js')]) {
    if (!fs.existsSync(path.join(OUT, rel))) {
      console.error(`[harden-js] ${rel} missing from build_js — the renderer/preload must ship unbundled.`);
      process.exit(1);
    }
  }
  console.log(`[harden-js] staged build_js: ${mode}. Renderer + preload kept unbundled; node_modules external.`);
}

function pruneEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name));
  }
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
}

main();
