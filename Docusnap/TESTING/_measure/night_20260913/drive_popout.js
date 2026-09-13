'use strict';
// Drive the REAL client (launched with --remote-debugging-port=9225 against the fake core) over CDP:
// sign in → click Search in the sidebar → does a second window (the pop-out) appear, and what does it say?
const { chromium } = require('C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/46f261df-90c6-45b9-87c4-6c9b00a6bdef/scratchpad/chris-driver/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const ctx = browser.contexts()[0];
  const pages = () => ctx.pages();
  const main = pages().find(p => /renderer\/index\.html/.test(p.url())) || pages()[0];
  console.log('pages at start:', pages().map(p => p.url()));
  const errs = [];
  const hook = (p, tag) => { p.on('pageerror', e => errs.push(`${tag} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${tag} console.${m.type()}: ${m.text()}`); }); };
  hook(main, 'main');
  ctx.on('page', (p) => { hook(p, 'NEW'); console.log('NEW PAGE:', p.url()); });

  // wait for the login screen (connect happens at boot against the saved/env server)
  await main.waitForSelector('#login:not(.hidden)', { timeout: 15000 }).catch(async () => console.log('login screen not shown; body:', (await main.textContent('body')).slice(0, 300)));
  await main.fill('#u', 'admin'); await main.fill('#p', 'Popout-Test-9');
  await main.click('#login-btn');
  await main.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  console.log('signed in; nav-search visible:', await main.isVisible('#nav-search'));
  const before = pages().length;
  await main.click('#nav-search');
  await sleep(4000);
  const after = pages();
  console.log(`pages before=${before} after=${after.length}:`, after.map(p => p.url()));
  // what did main get back? replay the IPC directly from the page
  const r = await main.evaluate(() => window.scanfinder.openSearch({}));
  console.log('openSearch() →', JSON.stringify(r));
  await sleep(3000);
  const pop = pages().find(p => /search\/index\.html/.test(p.url()));
  if (pop) {
    hook(pop, 'popout');
    await sleep(1500);
    const state = await pop.evaluate(() => ({ title: document.title, rows: document.querySelectorAll('.result-item').length, hasTransport: !!window.SearchTransport, globals: ['SearchMarkup','SearchState','SearchUI','SearchWorkflow','SearchStamp','SearchMailbox','ClientTheme'].filter(g => !window[g]), banner: document.getElementById('popout-banner')?.className, visible: document.visibilityState, w: window.innerWidth, h: window.innerHeight }));
    console.log('popout state:', JSON.stringify(state));
  } else {
    console.log('NO POP-OUT PAGE FOUND');
  }
  // main-window toasts (fixed divs appended to body)
  const toasts = await main.evaluate(() => [...document.body.children].filter(e => e.style && e.style.position === 'fixed' && e.style.bottom === '24px').map(e => e.textContent));
  console.log('toasts on main:', JSON.stringify(toasts));
  console.log('errors:', errs.length ? errs.join('\n  ') : 'none');
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('driver failed:', e.message); process.exit(1); });
