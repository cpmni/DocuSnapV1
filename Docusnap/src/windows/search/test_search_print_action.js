'use strict';
/*
 * test_search_print_action.js — the Search "Print" document action (Print-Slice 1, 2026-08-30).
 *
 * WHY. Printing a FILED document could only be done from Review (i.e. before filing); you go to
 * Search to find a filed doc but had no way to print it there. The Print button was added to the
 * Search document-actions panel. This pins its GATING against the REAL renderActions code (run
 * under a tiny DOM stub — no Electron window needed): the button appears IFF the printing feature
 * is available AND the doc has a resolvable file. It is a READ, so it is deliberately NOT
 * canEdit-gated (unlike Open File / Open in Explorer). Guards against the button silently
 * vanishing, or leaking when printing is off.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 npx electron src/windows/search/test_search_print_action.js
 *      (pure JS — plain `node` works too.)
 */
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

// ── minimal DOM stub — enough for renderActions + its _section/_btn/_statusChip helpers ──
const mkEl = (tag) => ({
  tag, className: '', style: {}, children: [], _text: '',
  get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
  get innerHTML() { return ''; }, set innerHTML(v) { if (v === '') this.children = []; },
  appendChild(c) { this.children.push(c); return c; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  addEventListener() {}, remove() {}, isConnected: true,
});
const panel = mkEl('div');
global.window = { SearchState: { role: 'admin', printAvailable: true }, docusnap: {} };
global.document = { createElement: (t) => mkEl(t), getElementById: (id) => (id === 'preview-actions' ? panel : null) };

require(path.join(__dirname, 'search-actions.js'));   // sets window.SearchActions

const buttons = (el, out = []) => { for (const c of (el.children || [])) { if (c.tag === 'button') out.push(c.textContent); buttons(c, out); } return out; };
const render = (printAvailable, opts = {}) => {
  panel.children = [];
  window.SearchState.printAvailable = printAvailable;
  window.SearchActions.renderActions({ id: 7, status: 'confirmed', has_file: true, overall_confidence: 95, ...opts });
  return buttons(panel);
};
const hasPrint = (labels) => labels.some((t) => /Print/.test(t));

console.log('\nSearch Print action gating');
check('Print appears when printing is available and the doc has a file', hasPrint(render(true)));
check('Print is HIDDEN when the printing feature is off', !hasPrint(render(false)));
check('Print is HIDDEN when the doc has no resolvable file', !hasPrint(render(true, { has_file: false })));

// A READ action: available to a read-only viewer too (not canEdit-gated), unlike Open File.
const ro = render(true, {});
global.window.SearchState.role = 'readonly';
const roLabels = render(true);
check('Print is offered to a read-only role (it is a READ, not an edit)', hasPrint(roLabels));
check('...while Open File is NOT (that one is canEdit-gated)', !roLabels.some((t) => /Open File/.test(t)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
