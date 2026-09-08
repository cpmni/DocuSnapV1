#!/usr/bin/env node
'use strict';
/**
 * scripts/test_uninstall_shell_context.js — the uninstaller's opt-in data wipe must run in the
 * CURRENT user's shell-variable context (2026-09-08; plan docs/designs/AUDIT_FIX_PLAN_2026-09-08.md
 * slice 2.3). Under a per-machine install electron-builder's uninstaller runs with
 * `SetShellVarContext all`, where NSIS resolves $APPDATA / $LOCALAPPDATA to C:\ProgramData — so a
 * wipe of "$APPDATA\ScanFinder" written without the context flip silently targets a folder that does
 * not exist (owner report 2026-09-07; baa25dd chased locked files). Both installers are per-machine
 * now, so both customUnInstall macros must flip to `current` BEFORE the first wipe and restore `all`
 * AFTER the last one — the same idiom electron-builder's own uninstaller.nsh uses.
 *
 *   node scripts/test_uninstall_shell_context.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const CASES = [
  { nsh: 'installer.nsh',        pkg: 'package.json',        wipe: /!insertmacro SafeWipe|RMDir \/r "\$(?:LOCAL)?APPDATA/ },
  { nsh: 'client/installer.nsh', pkg: 'client/package.json', wipe: /RMDir \/r "\$(?:LOCAL)?APPDATA/ },
];

const problems = [];
for (const c of CASES) {
  const src = fs.readFileSync(path.join(ROOT, c.nsh), 'utf8');
  const m = /!macro customUnInstall\r?\n([\s\S]*?)!macroend/.exec(src);
  if (!m) { problems.push(`${c.nsh}: no customUnInstall macro`); continue; }
  // Code lines only — the explanatory comments legitimately mention "SetShellVarContext all".
  const lines = m[1].split(/\r?\n/).filter(l => !/^\s*;/.test(l));
  const wipeIdx = lines.map((l, i) => (c.wipe.test(l) ? i : -1)).filter(i => i >= 0);
  if (!wipeIdx.length) { problems.push(`${c.nsh}: customUnInstall has no data wipe`); continue; }
  const first = wipeIdx[0], last = wipeIdx[wipeIdx.length - 1];
  const before = lines.slice(0, first).join('\n');
  const after = lines.slice(last + 1).join('\n');
  if (!/\$\{if\} \$installMode == "all"\s*\n\s*SetShellVarContext current\s*\n\s*\$\{endif\}/.test(before)) {
    problems.push(`${c.nsh}: no 'SetShellVarContext current' (guarded by $installMode == "all") before the first wipe`);
  }
  if (!/\$\{if\} \$installMode == "all"\s*\n\s*SetShellVarContext all\s*\n\s*\$\{endif\}/.test(after)) {
    problems.push(`${c.nsh}: no 'SetShellVarContext all' restore after the last wipe`);
  }
  if (/SetShellVarContext all/.test(before)) problems.push(`${c.nsh}: 'SetShellVarContext all' appears BEFORE the wipe`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, c.pkg), 'utf8'));
  if (pkg.build?.nsis?.perMachine !== true) problems.push(`${c.pkg}: build.nsis.perMachine must be true (it is ${JSON.stringify(pkg.build?.nsis?.perMachine)})`);
}

if (problems.length) {
  console.error(`[test_uninstall_shell_context] FAIL:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('[test_uninstall_shell_context] OK — both uninstallers wipe per-user data in the current-user context; both installs are per-machine.');
