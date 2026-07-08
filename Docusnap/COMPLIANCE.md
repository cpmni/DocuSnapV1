# Open-Source License Compliance

How ScanFinder stays compliant with the licenses of the third-party components it
bundles, and the steps to keep it that way. This is engineering process, not legal
advice.

## What ships and where the notices live

ScanFinder is a closed-source commercial product that bundles open-source
components (Electron/Chromium/FFmpeg, a CPython interpreter + Python OCR/ML
packages, a Tesseract binary, Node dependencies, and self-hosted IBM Plex fonts).
All shipped components are under permissive or notice-style licenses; the only
copyleft pieces are weak/file-level (FFmpeg LGPL-2.1 via Electron, and a couple of
MPL-2.0 files). **There is no GPL/AGPL anywhere in the shipped product.**

| Artifact | Notice file | How it ships |
|---|---|---|
| Core app | `THIRD-PARTY-LICENSES.txt` (repo root) | `package.json` → `build.extraResources` → `resources/THIRD-PARTY-LICENSES.txt` |
| Search client | `client/THIRD-PARTY-LICENSES.txt` | `client/package.json` → `build.extraResources` |

Both apps also surface the notice in-app: **user menu / sidebar → About → "Third-Party
Licenses"** opens the bundled file (`get-app-about` / `open-third-party-licenses`
in the core app; `client-about` / `client-open-licenses` in the client).

Fonts are **self-hosted** (`src/windows/shared/fonts/`, latin-subset IBM Plex under
OFL-1.1) — the app must never fetch fonts from a CDN, which would break the
offline/privacy posture. See the font note in the notice file.

## The two tools

### 1. License gate — `scripts/check-licenses.js`

A **prebuild guard** that refuses to package a build containing a disallowed
license. It enumerates the Node production-dependency tree *and* every bundled
Python package in `vendor/python`, resolves each license from package metadata,
and classifies it:

- **ALLOWED** — on the permissive/notice-style allowlist (MIT, ISC, BSD-2/3, 0BSD,
  Zlib, Apache-2.0, HPND/MIT-CMU, MPL-2.0, CC0-1.0, PSF/Python-2.0, OFL-1.1, Boost).
- **DENIED** — copyleft (GPL/AGPL/LGPL-source) → build fails.
- **UNKNOWN** — unrecognised license → build fails (forces human review).

Dual licenses (`A OR B`) pass if **either** side is allowed (we elect the
permissive option). Exit code 1 on any DENIED/UNKNOWN.

```bash
npm run check:licenses        # gate (exit 1 on any DENIED/UNKNOWN)
node scripts/check-licenses.js --audit   # print the full table, never fail
```

Policy decisions encoded in the script:
- **MPL-2.0 is allowed** — weak file-level copyleft; we ship the unmodified `.py`
  source in `vendor/python`, which satisfies its source-availability term. Never
  *modify* an MPL-covered file without publishing that file under MPL.
- **Dual-license elections** — `node-forge → BSD-3-Clause`, `expand-template → MIT`,
  `rc → MIT`, `packaging → Apache-2.0`.
- To approve a new permissive license, add its SPDX family to `ALLOW`. To record a
  reviewed exception for a nonstandard metadata string, use the `OVERRIDES` map
  (only after reading the package's actual LICENSE file). Genuine copyleft → replace
  the dependency.

The gate is wired into `npm run build`, so a bad license cannot be packaged.

### 2. Notice generator — `scripts/gen-third-party-notices.js`

Rewrites the **component inventory** (section 1) of `THIRD-PARTY-LICENSES.txt` from
the same source of truth the gate uses, and re-stamps the **product version**
(from `package.json` / `client/package.json`) and **review date**. It does NOT
touch the curated copyright notices (section 2) or license texts (section 3) — edit
those by hand. Runtimes that are not npm/PyPI packages (Electron, CPython,
Tesseract, SQLite, fonts) are hardcoded in the generator's manual block.

```bash
node scripts/gen-third-party-notices.js
```

## Release workflow

Run these on the **build machine where `vendor/python` is assembled** (the gate can
only see the Python packages when they're present):

1. Bump `version` in `package.json` and `client/package.json` for the release.
2. `npm run check:licenses` — must pass. If it fails, resolve each flagged
   component (see "Policy decisions" above) before continuing.
3. `node scripts/gen-third-party-notices.js` — refreshes the inventory + version/date.
4. Commit the updated `THIRD-PARTY-LICENSES.txt`.
5. `npm run build` (re-runs the gate as a safety net) and ship.

## When a dependency changes

- A new or relicensed dependency that the gate flags as **UNKNOWN/DENIED** stops the
  build. Read its real LICENSE file, then: add its SPDX family to `ALLOW` (permissive),
  record an `OVERRIDES` entry (reviewed exception), or replace it (copyleft).
- If you add a license **family** not yet covered, add its full text to section 3 of
  `THIRD-PARTY-LICENSES.txt` and its name to the "license families" line in the intro
  (the generator does not manage section 3).
- Re-run the generator so the inventory matches.

## Notes

- The notice file is informational/attribution only and grants no rights in
  ScanFinder. A lawyer's review is advisory and has not been performed.
- Apache-2.0 §4(d): the bundled Apache components carry no separate NOTICE file
  except `opencv-python`'s `LICENSE-3RD-PARTY.txt` (referenced in the notice).
  Re-verify if dependencies change.
- Each component's own LICENSE file travels with the product (Node packages in the
  app archive; Python packages in `vendor/python`, e.g. `*.dist-info/licenses/`).
