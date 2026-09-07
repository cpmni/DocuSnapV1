# Source-protection packaging plan — 2026-09-07

> Owner ask: *"the ScanFinder folder in Program Files contains all our .py files in readable format …
> package the software so that when installed it is protected and not easily accessible."*
> Advisors: eric (Electron/JS) + gary (Python) + Oracle (seam vet). Supersedes the fuse-scaffold parts of
> `docs/BUILD_HARDENING_PLAN_2026-07-26.md` (the fuses are now LIVE in `package.json`). Oracle verdict:
> **SIGN OFF WITH CONDITIONS — three separate builds, each smoked independently, one behaviour-changing
> rung per build.** Nothing here is built yet; each build needs the owner's live smoke.

## Frame (say it plainly)
Client-side code on a user's disk can never be made un-decompilable — every rung buys attacker *time*,
not secrecy. This is **IP obfuscation, not a security fix**: the licensing gate is cryptographic
(Ed25519 offline verify), so reading `trust.js` or `licensing/handler.js` forges no token and opens no
auto-file exploit. The `electronFuses` block already shipping closes tamper / debug-attach / asar-swap;
**only READING is open** — `npx @electron/asar extract` dumps the JS, and 15 `.py` ship as source.

## Current exposure (verified 2026-09-07)
| Surface | State | IP value |
|---|---|---|
| 15 `.py` in `resources/python_backend` (`KEEP_SOURCE`) | **plaintext** — `process_docs.py` 1524 lines is the orchestrator | High (the owner's literal complaint) |
| `app.asar` JS (`database/modules/trust.js`, `src/modules/licensing/`) | plaintext (raw grep finds `_corrobLicensed`/`isAutoFileEligible`/`TRUSTED_FLOOR`) | High |
| `config/keyword_patterns.json` (in `resources/config`, outside the asar) | plaintext, read by BOTH JS and Python | Medium |
| ~38.5k lines `extraction/*.pyc` etc. | already sourceless `.pyc` (decompiles imperfectly with pycdc) | best-protected surface |
| `node_modules/**/*.map` (564 files), 8 better-sqlite3 build artifacts | shipped debris | Low |

Already fine: the `!**/test_*.js` glob works — no app test files ship (only 8 better-sqlite3 native-build
artifacts). Fuses live: `runAsNode:false`, `enableNodeOptionsEnvironmentVariable:false`,
`enableNodeCliInspectArguments:false`, `enableEmbeddedAsarIntegrityValidation:true`, `onlyLoadAppFromAsar:true`.

---

## BUILD 1 — Python `.pyc`-spawn + ship hygiene  [SIGN OFF W/COND; ship first, alone]
Answers the owner's literal complaint at the lowest blast radius, fail-closed, **keeps `.pyc` traceback
line numbers** (the owner diagnoses extraction failures from `processing.log`).

- **Shrink `KEEP_SOURCE` to ∅** in `scripts/compile-python-bytecode.js` (strip every `.py`, keep every
  `.pyc`; drop the "drop kept `.pyc`" loop). Point the JS spawns at `.pyc` at BOTH:
  - the `resourcePath('python_backend', …, 'X.py')` sites (`main.js:144`, workflow/api/review/processing
    handlers), AND
  - the four `path.join(path.dirname(backendScript()), 'X.py')` siblings —
    `segment_docs.py` (handler.js:2724), `pdf_splitter.py` (:2725, :5845), `filing_slips.py` (:5772),
    `pdf_rotate.py` (:6151).
- **Proven assumption (smoked on `vendor/python`, sourceless):** `python.exe X.pyc <args>` runs as
  `__main__`, `__file__` = the `.pyc` path, and `sys.path.insert(0, Path(__file__).parent)` +
  `from ocr.x import …` resolve against a sourceless package. **No `.py` shim fallback needed.**
- **Ship hygiene (free, zero risk):** add `!**/*.map` to the `files` globs; re-confirm test exclusion on
  the BUILT tree with `npx @electron/asar list … | grep -i test_`.
- **Kill switch:** existing `SHIP_PY_SOURCE=1` restores verbatim source. Dev (`npm start` → `py -3.12
  script.py` on `python_backend/`) is untouched.

**Conditions**
1. **Invert + extend the pin** `scripts/test_compile_python_keep.js`: assert every spawn site references
   `.pyc`, and cover the four `dirname(backendScript())` siblings AND `ctx.resourcePath` variants — the
   current regex sees none of them (this is exactly the `detect_angle.py` fail-open repeating).
2. Add `scripts/test_no_shipped_py_source.js`: after staging `build_python/`, assert no crown-jewel `.py`
   ships and each crown-jewel module exists only as `.pyc`.
3. Smoke MUST exercise Split, Segment, Rotate, Filing-slip, Region-OCR, teach angle-heal (`detect_angle`),
   thumbnails — the sibling spawns the corpus harness never reaches.

---

## BUILD 2 — esbuild bundle (NO bytecode)  [SIGN OFF W/COND; de-risks the landmines before opacity]
Collapse the main-process source into one bundle at the **same asar-relative path** so `__dirname`/
`process.resourcesPath` invariants hold; ship it readable-but-bundled first to catch path breaks while
still debuggable.

- **Bundle:** `src/main.js` entry graph + `database/**` + `src/modules/**` + `src/services/**` +
  `src/lib/**`. **Keep external:** `src/windows/**`, `src/preload.js`, `resources/config/`, and all
  native/node_modules deps.
- **Tool:** esbuild (MIT, build-time devDep → does not ship, not gated by `check-licenses`).
- **Kill switch:** `SHIP_JS_SOURCE=1` (twin of `SHIP_PY_SOURCE`).

**Conditions (the Oracle's real landmines — verified at source)**
1. **`database/index.js:72`** — raw `__dirname` + dynamic `readdirSync('migrations')`, no `isPackaged`
   guard. If esbuild inlines `index.js` into `src/main.js`, `__dirname` → `app.asar/src` → reads a
   non-existent `app.asar/src/migrations` → **DB never opens → app dead at boot.** Before bundling
   `database/**`: anchor `migrationsDir` to a bundle-stable root (`app.getAppPath()`-based with the
   harness-safe `try{require('electron')}` guard freeze_guard uses), OR keep `index.js` external and
   bundle only the secret modules under `database/modules/`.
2. **`charsetAcceptService.js:28`** — raw `require(path.join(__dirname,'..','..','config',
   'keyword_patterns.json'))`, no `isPackaged` guard (and likely ALREADY a latent packaged no-op — it
   points inside the asar where config does not ship). Give it the `_configDir()` guard `freeze_guard`/
   `trust` already use, before it enters the bundle.
3. esbuild `packages:'external'` (or explicit `external` for `argon2`, `better-sqlite3`, the prod deps) —
   native `.node` requires break if bundled.
4. Emit the bundle at `src/main.js` so `loadFile(path.join(__dirname,'windows',name,'index.html'))`
   (main.js:779) and the preload path (main.js:747) still resolve.

---

## BUILD 3 — bytenode the main bundle  [SIGN OFF W/COND; strongest JS opacity]
V8-bytecode the proven bundle so `asar extract` + grep finds bytecode, not `trust.js`.

- **Tool:** bytenode (MIT, **ships** as a `dependencies` runtime dep → passes `check-licenses`; confirmed
  the gate walks `root.dependencies` and MIT is allowlisted). Thin `src/main.js` source loader stub:
  `require('bytenode'); require('./main.jsc')`. Compile with the EXACT Electron 44 binary
  (`ELECTRON_RUN_AS_NODE`), mirroring the `.pyc` magic-parity guarantee.
- **Renderers CANNOT be bytenoded** — Chromium `<script src>` can't load `.jsc` under
  `contextIsolation`/`sandbox`. Optional later: terser-minify (BSD-2) renderers; NOT javascript-obfuscator
  `selfDefending`/`debugProtection` (hangs a sandboxed renderer).

**Conditions**
1. **Cost — main-process stack traces go dark.** `main.js:1320/1321/1329/1343` lose line numbers/names in
   `processing.log`. Mitigation is REAL only if gated as a release artifact: archive a source-map keyed by
   `buildRev` (the About box already self-reports `Version (rev)`) so a customer stack can be symbolicated
   after the fact. Never ship the map.
2. **New release coupling:** `.jsc` is locked to Electron 44's V8. A future Electron bump without
   recompiling `.jsc` on the new binary = won't boot (fail-closed). Document it in the release ritual; do
   NOT land bytenode in the same cycle as an Electron bump.

---

## DEFER / DO-NOTHING
- **Cython the crown jewels → native `.pyd`** (`engine.py`, `anchor.py`, `template_matcher.py`,
  `ocr/tesseract.py`, `landmarks.py`, logo modules) — the ONLY tier that defeats pycdc/decompyle3.
  Apache-2.0. **Own gated session** (build-chain + MSVC dep, ABI-locks CPython 3.12, costs traceback line
  numbers, `__file__` config resolution must be re-verified per compiled module). Already in
  `pendingfeatures.md`.
- **Encrypt `config/keyword_patterns.json` (Rung F) — DO NOTHING.** Low IP (regex/label patterns), must
  stay support-editable AND cross-runtime-readable by Python outside the asar; the key would ship in the
  binary (obfuscation, not secrecy). Not worth its blast radius.
- **NOT:** a custom encrypted-asar Electron fork (unmaintainable vs the Electron cadence); bytenode on
  renderers (architecturally impossible); the single-`--mode` dispatcher collapse (dominated, more
  revealing); PyArmor (commercial licence — fails "commercially free").

## The verification gate (single go/no-go; the pin suite runs on SOURCE, proves nothing about the build)
- **Logic-identity:** source `test_*.js` + Python pin suites green + the inverted keep-pin (covering the
  siblings and `.pyc`) + `test_no_shipped_py_source.js`.
- **Packaged smoke (on the installed tree, `vendor/python`, not `py`):** (1) app boots AND opens the DB
  (catches the `index.js:72` landmine); (2) **M=0 realdoc parity** — import a corpus subset, assert
  identical filed outcomes/fields vs the last source-run baseline; (3) exercise Split/Segment/Rotate/
  Filing-slip/Region-OCR/`detect_angle`/thumbnails; (4) **opacity proof** — `npx @electron/asar extract` +
  grep finds NONE of `{isAutoFileEligible, TRUSTED_FLOOR, _corrobLicensed}` and no crown-jewel `.py` under
  `resources`; (5) force one Python extraction error, confirm `processing.log` still shows `file:line`.
- Every failure mode here is **fail-closed** (red build / won't-boot in smoke) — this packaging work
  touches no confidence/auto-file/review decision, so there is no silent-wrong-document exposure.
