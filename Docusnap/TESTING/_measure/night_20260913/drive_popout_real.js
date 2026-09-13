'use strict';
// Drive the REAL client (CDP 9226) against the REAL sandbox core (a dev core, TEST_BUILD, its /v1 on 8797).
//   --phase 1 : refusal before sign-in · sign in (admin) · Search opens · rows · theme follows · logout closes the pop-out
//               · sign in again · open the pop-out and LEAVE it open (for phase 2)
//   --phase 2 : (the core was restarted meanwhile → the client's session token is stale) press Search / use the open
//               pop-out → the 401 path must close it and sign the main window out with a message
//   --phase 3 : sign in as the READ-ONLY user → the pop-out opens; no Delete / bin / recycle
const { chromium } = require('C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/46f261df-90c6-45b9-87c4-6c9b00a6bdef/scratchpad/chris-driver/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const phase = (process.argv.find(a => /^--phase/.test(a)) || '--phase 1').split(/[= ]/)[1] || process.argv[process.argv.indexOf('--phase') + 1] || '1';
const R = []; const ok = (name, cond, extra) => { R.push({ name, ok: !!cond }); console.log(`  ${cond ? 'OK ' : 'BAD'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
  const ctx = browser.contexts()[0];
  const pages = () => ctx.pages();
  const mainOf = () => pages().find(p => /renderer\/index\.html/.test(p.url()));
  const popOf = () => pages().find(p => /search\/index\.html/.test(p.url()));
  const errs = [];
  const hook = (p, tag) => { p.on('pageerror', e => errs.push(`${tag} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errs.push(`${tag} console.error: ${m.text()}`); }); };
  ctx.on('page', (p) => hook(p, 'new'));
  const main = mainOf(); hook(main, 'main');
  const toasts = async () => main.evaluate(() => [...document.body.children].filter(e => e.style && e.style.position === 'fixed' && e.style.bottom === '24px').map(e => e.textContent));
  const signIn = async (u, p) => {
    await main.waitForSelector('#login:not(.hidden)', { timeout: 20000 });
    await main.fill('#u', u); await main.fill('#p', p); await main.click('#login-btn');
    await main.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  };

  if (phase === '1') {
    console.log('phase 1: before sign-in');
    // The connect screen may show if the core was still booting — press Connect until the login shows.
    for (let i = 0; i < 6 && !(await main.isVisible('#login:not(.hidden)')); i++) {
      if (await main.isVisible('#connect:not(.hidden)')) { try { await main.click('#connect-btn'); } catch {} }
      await sleep(2500);
    }
    const r0 = await main.evaluate(() => window.scanfinder.openSearch({}));
    ok('before sign-in: openSearch refuses with "not signed in"', r0 && r0.ok === false && r0.error === 'not signed in', JSON.stringify(r0));
    await signIn('nightadmin', 'Night-Admin-9');
    ok('signed in as the admin', await main.isVisible('#nav-search'));
    await main.click('#nav-search');
    await sleep(4000);
    let pop = popOf();
    ok('Search opens the pop-out window (a second page)', !!pop, pages().map(p => p.url()).join(' | '));
    if (pop) {
      hook(pop, 'popout');
      await sleep(2500);
      const st = await pop.evaluate(() => ({ rows: document.querySelectorAll('.result-item').length, vis: document.visibilityState, w: innerWidth, h: innerHeight, theme: document.documentElement.getAttribute('data-theme'), caps: window.SearchTransport && window.SearchTransport.caps, role: window.SearchState && window.SearchState.role, entitled: window.SearchState && window.SearchState.entitled, banner: document.getElementById('popout-banner').className, note: document.getElementById('popout-note').className, findVisible: getComputedStyle(document.getElementById('match-nav')).display }));
      console.log('   pop-out:', JSON.stringify(st));
      ok('pop-out lists the sandbox documents (2 rows)', st.rows === 2, 'rows=' + st.rows);
      ok('pop-out knows the role (admin) + the search entitlement', st.role === 'admin' && st.entitled === true, `role=${st.role} entitled=${st.entitled}`);
      ok('pop-out caps: S2 reads ON against a 1.3.0 core; no hint banner', st.caps && st.caps.find === true && st.caps.singlePage === true && !/show/.test(st.note), JSON.stringify(st.caps));
      // click a row → preview (no files behind the placeholder rows → honest "no preview", but the fields render)
      await pop.click('.result-item[data-id="1"]');
      await sleep(3000);
      const pv = await pop.evaluate(() => ({ fields: document.querySelectorAll('.pf-row').length, ph: document.getElementById('preview-img-placeholder').textContent.trim().slice(0, 40), btns: [...document.querySelectorAll('#preview-actions button')].map(b => b.textContent.trim()) }));
      console.log('   preview:', JSON.stringify(pv));
      ok('preview renders the field table for the clicked row', pv.fields >= 5, 'fields=' + pv.fields);
      ok('admin actions: Delete offered; desktop-only actions hidden', pv.btns.includes('Delete') && !pv.btns.some(t => /Explorer|Open File|Print|Edit in Review|Send back/.test(t)), pv.btns.join(','));
      // theme follows the main window
      await main.evaluate(() => window.ClientTheme.apply('midnight'));
      await sleep(800);
      const th = await pop.evaluate(() => document.documentElement.getAttribute('data-theme'));
      ok('theme picked in the main window re-themes the pop-out live', th === 'midnight', 'pop-out theme=' + th);
      await main.evaluate(() => window.ClientTheme.apply('warm'));
      // logout closes the pop-out
      await main.click('#account-btn'); await sleep(400); await main.click('#am-signout');
      await sleep(2500);
      ok('logout closes the pop-out (back to one page)', !popOf() && pages().length === 1, pages().map(p => p.url()).join(' | '));
      // sign in again, open the pop-out and leave it for phase 2
      await signIn('nightadmin', 'Night-Admin-9');
      await main.click('#nav-search');
      await sleep(4000);
      ok('after re-sign-in the pop-out opens again (left open for phase 2)', !!popOf());
    }
  }

  if (phase === '2') {
    console.log('phase 2: the core was restarted → the client token is stale');
    const hadPop = !!popOf();
    // The main window's heartbeat saw the outage + the return. Now press Search (pushes to the open pop-out or opens one).
    await main.click('#nav-search');
    let t = [];
    for (let i = 0; i < 12 && !t.length; i++) { await sleep(500); t = await toasts(); }   // a toast lives 2.6 s — poll for it
    await sleep(3000);
    const loginVisible = await main.isVisible('#login:not(.hidden)');
    ok('stale session: the main window is signed out (login screen) after the pop-out saw a 401', loginVisible, 'pop-out was open before: ' + hadPop);
    ok('stale session: a message told the user ("session ended")', t.some(x => /session ended/i.test(x)), JSON.stringify(t));
    ok('stale session: no pop-out left open', !popOf(), pages().map(p => p.url()).join(' | '));
    // and it recovers: sign in again → Search works
    await signIn('nightadmin', 'Night-Admin-9');
    await main.click('#nav-search');
    await sleep(4000);
    ok('after signing in again, Search opens the pop-out', !!popOf());
    const pop = popOf();
    if (pop) { const rows = await pop.evaluate(() => document.querySelectorAll('.result-item').length); ok('…with the rows', rows === 2, 'rows=' + rows); }
    // close it via logout for phase 3
    await main.click('#account-btn'); await sleep(400); await main.click('#am-signout');
    await sleep(2000);
  }

  if (phase === '3') {
    console.log('phase 3: read-only user');
    if (!(await main.isVisible('#login:not(.hidden)'))) {
      await main.click('#account-btn'); await sleep(400); await main.click('#am-signout');
      await sleep(2000);
    }
    await signIn('nightreader', 'Night-Reader-9');
    await main.click('#nav-search');
    await sleep(4000);
    const pop = popOf();
    ok('read-only: Search opens the pop-out', !!pop);
    if (pop) {
      await sleep(2000);
      const st = await pop.evaluate(() => ({ rows: document.querySelectorAll('.result-item').length, role: window.SearchState.role, recycle: getComputedStyle(document.getElementById('btn-recycle')).display, types: document.querySelectorAll('#inp-type option').length }));
      console.log('   read-only pop-out:', JSON.stringify(st));
      ok('read-only: rows listed (a 403 on /v1/doc-types did not stop the boot)', st.rows >= 1 && st.types === 1, JSON.stringify(st));
      ok('read-only: no recycle bin button', st.recycle === 'none');
      await pop.click('.result-item[data-id="1"]');
      await sleep(2500);
      const btns = await pop.evaluate(() => [...document.querySelectorAll('#preview-actions button')].map(b => b.textContent.trim()));
      ok('read-only: no Delete action', !btns.includes('Delete'), btns.join(','));
    }
  }

  console.log('errors:', errs.length ? '\n  ' + errs.join('\n  ') : 'none');
  console.log(`RESULT phase ${phase}: ${R.filter(r => r.ok).length}/${R.length} ok`);
  await browser.close().catch(() => {});
  process.exit(R.every(r => r.ok) ? 0 : 1);
})().catch((e) => { console.error('driver failed:', e.message); process.exit(1); });
