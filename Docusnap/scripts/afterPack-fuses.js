'use strict';
/*
 * afterPack-fuses.js — DECOMPILE/TAMPER hardening scaffold (Rung A, eric-designed 2026-07-26).
 *
 * electron-builder afterPack hook that flips the SAFE subset of Electron fuses on the packaged
 * ScanFinder.exe: RunAsNode OFF (no `ELECTRON_RUN_AS_NODE=1 ScanFinder.exe script.js` to run the app as
 * raw Node and dump/patch it), NODE_OPTIONS OFF, and --inspect OFF (no live-memory debugger attach).
 *
 * KILL SWITCH / SAFETY: hardens ONLY when HARDEN_FUSES=1. The DEFAULT build (env unset) is a NO-OP, so
 * the shipped binary is byte-identical to before and this hook can never brick it. @electron/fuses is
 * require()d INSIDE the armed branch only, so a missing devDependency cannot break the default build.
 * git-revertible. Arming ON needs a LIVE SMOKE (a bad flip = app won't start) — do NOT ship armed
 * without launching the packaged app.
 *
 * DEFERRED here (Rung B, needs an embedded-asar hash + a live smoke — a wrong flip is a guaranteed
 * brick): OnlyLoadAppFromAsar / EnableEmbeddedAsarIntegrityValidation. Wire those via
 * electron-builder's native `build.electronFuses` (it embeds the asar hash), NOT here.
 *
 * Verify WITHOUT launching the app:
 *   node --check scripts/afterPack-fuses.js
 *   default no-op:  node -e "require('./scripts/afterPack-fuses')({electronPlatformName:'win32',appOutDir:'.',packager:{appInfo:{productFilename:'ScanFinder'}}}).then(()=>console.log('no-op OK'))"
 *   armed dry-pack: set HARDEN_FUSES=1 && npx electron-builder --dir --win --x64   (then read fuses back off dist\win-unpacked\ScanFinder.exe)
 */
const path = require('path');

module.exports = async function afterPack(context) {
  if (process.env.HARDEN_FUSES !== '1') {
    console.log('[afterPack-fuses] HARDEN_FUSES!=1 — skipped (default build unchanged, byte-identical).');
    return;
  }
  if (context.electronPlatformName !== 'win32') {
    console.log('[afterPack-fuses] non-win32 platform — skipped.');
    return;
  }
  // Required only on the armed path, so the default build has zero dependency on it.
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const exe = path.join(context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`);            // -> ScanFinder.exe
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,                              // no ELECTRON_RUN_AS_NODE on the packaged exe
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,   // no NODE_OPTIONS injection
    [FuseV1Options.EnableNodeCliInspectArguments]: false,          // no --inspect debugger attach
    // DEFERRED (Rung B — do NOT enable here; needs embedded-asar integrity + a live smoke):
    // [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  });
  console.log('[afterPack-fuses] HARDEN_FUSES=1 — armed RunAsNode/NODE_OPTIONS/inspect OFF on', exe);
};
