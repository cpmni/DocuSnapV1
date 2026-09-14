const fs = require('fs');
const core = fs.readFileSync('src/windows/teach/index.html', 'utf8');
const NL = core.includes('\r\n') ? '\r\n' : '\n';
// Extract the DOM: from just after <body...> to just before the FIRST <script (the wizard's scripts).
const bodyOpen = core.search(/<body[^>]*>/i);
const afterBodyTag = core.indexOf('>', bodyOpen) + 1;
const firstScript = core.indexOf('<script', afterBodyTag);
if (bodyOpen < 0 || firstScript < 0) { console.error('markers not found'); process.exit(1); }
let dom = core.slice(afterBodyTag, firstScript).replace(/^\s*\r?\n/, '').replace(/\s+$/, '');

const head = [
  '<!DOCTYPE html>',
  '<html lang="en" data-theme="warm" data-mode="light"><!-- default at parse time → no flash before themeBoot runs -->',
  '<head>',
  '<meta charset="UTF-8">',
  '<!-- GENERATED for the detached client from src/windows/teach/index.html (teach-over-client S1). The DOM is the',
  '     core teach wizard verbatim; only the head (client CSP + themeBoot) and the script tags (client transport +',
  '     the synced shared copies) differ. Regenerate with scripts/gen-client-teach-index.js if the core DOM changes. -->',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; font-src \'self\'; script-src \'self\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'">',
  '<title>Teach a new document — Scan Finder</title>',
  '<link rel="stylesheet" href="../shared/theme.css" />',
  '<link rel="stylesheet" href="../shared/teach-ui/teach.css" />',
  '</head>',
  '<body>',
].join(NL);

// Order is load-bearing: the transport + host adapters and every shared sub-component must exist BEFORE
// teach.js (it reads window.TeachTransport / window.TeachHost and uses the sub-components at module load, then
// self-boots). teach.js is therefore LAST.
const scripts = [
  '<script src="../themeBoot.js"></script>',
  '<script src="clientTeachTransport.js"></script>',
  '<script src="clientTeachHost.js"></script>',
  '<script src="../shared/helpmode.js"></script>',
  '<script src="../shared/thumbs.js"></script>',
  '<script src="../shared/dialogFocus.js"></script>',
  '<script src="../shared/doctype-editor.js"></script>',
  '<script src="../shared/doctype-catalog.js"></script>',
  '<script src="../shared/anchorLabel.js"></script>',
  '<script src="../shared/listCaption.js"></script>',
  '<script src="../shared/boxSnap.js"></script>',
  '<script src="../shared/valueLocate.js"></script>',
  '<script src="../shared/teach-ui/teach.js"></script>',
  '</body>',
  '</html>',
].join(NL);

const out = head + NL + dom + NL + NL + scripts + NL;
fs.mkdirSync('client/renderer/teach', { recursive: true });
fs.writeFileSync('client/renderer/teach/index.html', out, 'utf8');
console.log('client teach index.html bytes:', out.length);
console.log('has #pageCanvas:', out.includes('id="pageCanvas"'), '| #doc-picker:', out.includes('id="doc-picker"'), '| #btn-next:', out.includes('id="btn-next"'));
console.log('loads teach.js:', out.includes('teach-ui/teach.js'), '| clientTeachTransport:', out.includes('clientTeachTransport.js'), '| no theme.js:', !out.includes('shared/theme.js'));
