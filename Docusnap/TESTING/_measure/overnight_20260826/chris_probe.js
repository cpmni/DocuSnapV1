'use strict';
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223');
  const ctx = browser.contexts()[0];
  const pages = ctx ? ctx.pages() : [];
  console.log('pages:', pages.length);
  for (const p of pages) {
    let title = '', text = '';
    try { title = await p.title(); } catch {}
    try { text = await p.evaluate(() => document.body.innerText.slice(0, 600)); } catch (e) { text = '(no text: ' + e.message + ')'; }
    console.log('---', p.url(), '|', title);
    console.log(text.replace(/\s+/g, ' ').slice(0, 500));
  }
  await browser.close().catch(() => {});
  process.exit(0);
})().catch(e => { console.error('probe failed:', e.message); process.exit(1); });
