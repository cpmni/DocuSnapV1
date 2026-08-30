'use strict';
/**
 * test_help_nav.js
 * Guards the User Guide's deep links across the rebuild (help-system plan §9/§11):
 * every openHelpWindow(section) the app sends must resolve to a manifest page, every
 * page/search-index file must exist, and each rebuilt spine page must carry an anchor
 * for its own primary section so a deep link lands cleanly (not just at the top).
 *
 * Parses help-nav.js as text (it's a browser IIFE — cannot be required in Node).
 * Run: node src/windows/help/test_help_nav.js
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const nav = fs.readFileSync(path.join(DIR, 'help-nav.js'), 'utf8');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

// The section keys the APP actually passes to openHelpWindow (grep of src/windows/**).
// Update this list if a new openHelpWindow('x') call is added anywhere in the app.
const APP_SENDERS = ['main', 'settings', 'client-cert-setup', 'review', 'which-tool', 'search', 'teach', 'home'];

// The rebuilt pages whose primary section anchor must be present (2026-08-31: the
// whole guide is now rebuilt — every page except the two search-client ones).
const REBUILT = ['index.html', 'quick-start.html', 'set-up.html', 'teach.html', 'import.html',
                 'review.html', 'fix-a-detail.html', 'files-by-itself.html',
                 'where-things-go.html', 'search.html', 'export.html', 'approvals.html',
                 'learning.html', 'admin.html', 'document-types.html', 'settings.html',
                 'shortcuts.html', 'troubleshooting.html'];

// ── Parse the PAGES manifest (file + section keys) ───────────────────────────
const pagesBlock = nav.slice(nav.indexOf('const PAGES ='), nav.indexOf('const SEARCH_INDEX'));
const PAGES = [];
for (const m of pagesBlock.matchAll(/file:\s*'([^']+)'[\s\S]*?sections:\s*\[([^\]]*)\]/g)) {
  PAGES.push({ file: m[1], sections: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) });
}
check('parsed the PAGES manifest (>=10 pages)', PAGES.length >= 10);
const allSections = new Set(PAGES.flatMap((p) => p.sections));

// 1) every app deep-link sender resolves to some page
for (const s of APP_SENDERS) check(`app deep-link '${s}' resolves to a page`, allSections.has(s));

// 2) every manifest page file exists on disk
for (const p of PAGES) check(`manifest page exists: ${p.file}`, fs.existsSync(path.join(DIR, p.file)));

// 3) no page file listed twice
check('no duplicate page files', new Set(PAGES.map((p) => p.file)).size === PAGES.length);

// 4) every file referenced by the search index exists
const siBlock = nav.slice(nav.indexOf('const SEARCH_INDEX'));
const siFiles = new Set([...siBlock.matchAll(/'([a-z0-9-]+\.html)'/g)].map((x) => x[1]));
for (const f of siFiles) check(`search-index file exists: ${f}`, fs.existsSync(path.join(DIR, f)));

// 5) each rebuilt page carries an anchor (id="...") for its OWN primary section key
for (const p of PAGES) {
  if (!REBUILT.includes(p.file)) continue;
  const html = fs.readFileSync(path.join(DIR, p.file), 'utf8');
  const primary = p.sections[0];
  check(`${p.file} has an anchor id="${primary}"`, new RegExp(`id="${primary}"`).test(html));
}

console.log(FAILS ? `\n${FAILS} FAILED` : '\nALL PASS');
process.exit(FAILS ? 1 : 0);
