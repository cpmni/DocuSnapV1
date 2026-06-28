'use strict';
/*
 * Interactive step-by-step training for the Review window — a gentle "coachmark" tour for
 * first-time users. It dims the screen, spotlights the control to use next, points an arrow
 * at it with a plain-English instruction, and AUTO-ADVANCES when the user does the action
 * (change the type, click Confirm…). Self-contained: renderer-only, no IPC, no new deps.
 */
(function () {
  const STEPS = [
    { sel: '#queue-list',     title: 'Your review queue',     advance: 'next',
      body: 'Every scanned document waiting for you appears here. Click one to open it — then follow these steps to check and file it.' },
    { sel: '#doc-panel',      title: 'The scanned document',  advance: 'next',
      body: 'The scan itself shows in the middle. You can zoom and drag it to read anything closely.' },
    { sel: '#fields-panel',   title: 'What Scan Finder read', advance: 'next',
      body: 'On the right are the details it pulled out — who it’s from, the date, the reference. Your job is just to check them.' },
    { sel: '#doctype-select', title: 'Choose the document type', advance: 'change',
      body: 'Pick what kind of document this is (Invoice, Order…). Go ahead and choose it now.' },
    { sel: '#fields-scroll',  title: 'Check the details',     advance: 'next',
      body: 'Read down the fields and fix anything that looks wrong. To teach a field for next time, click its ⊕ and draw a box round the value.' },
    { sel: '#btn-confirm',    title: 'File the document',     advance: 'click',
      body: 'When everything looks right, click Confirm & File. Scan Finder files a tidy copy and learns from your corrections. That’s it!' },
  ];

  let steps = [], idx = 0, active = false, hole, callout, arrow, cleanup = [];
  const q = (sel) => document.querySelector(sel);

  function start() {
    if (active) return;
    steps = STEPS.filter(s => q(s.sel));
    if (!steps.length) return;
    active = true; idx = 0;
    hole    = document.createElement('div'); hole.className = 'tour-hole';
    arrow   = document.createElement('div'); arrow.className = 'tour-arrow';
    callout = document.createElement('div'); callout.className = 'tour-callout';
    document.body.append(hole, arrow, callout);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  function stop() {
    if (!active) return;
    active = false; clearStep();
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKey, true);
    [hole, arrow, callout].forEach(el => el && el.remove());
    hole = arrow = callout = null;
  }

  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); stop(); } }
  function clearStep() { cleanup.forEach(fn => fn()); cleanup = []; }
  function next() { idx++; if (idx >= steps.length) finish(); else render(); }
  function finish() {
    callout.classList.add('done');
    callout.innerHTML = `<div class="tc-title">You’re all set 🎉</div>
      <div class="tc-body">That’s the whole loop — open a document, check the details, pick the type, Confirm & File. You can re-run this any time from “Show me how”.</div>
      <div class="tc-foot"><span class="tc-step"></span><span class="tc-actions"><button class="tc-next">Done</button></span></div>`;
    hole.style.opacity = '0'; arrow.style.display = 'none';
    callout.style.left = '50%'; callout.style.top = '50%'; callout.style.transform = 'translate(-50%,-50%)';
    callout.querySelector('.tc-next').onclick = stop;
  }

  function render() {
    clearStep();
    const step = steps[idx];
    const target = q(step.sel);
    if (!target) { next(); return; }
    callout.style.transform = ''; hole.style.opacity = ''; arrow.style.display = '';
    const isAction = step.advance === 'click' || step.advance === 'change';
    callout.innerHTML = `
      <div class="tc-title">${step.title}</div>
      <div class="tc-body">${step.body}</div>
      <div class="tc-foot">
        <span class="tc-step">Step ${idx + 1} of ${steps.length}</span>
        <span class="tc-actions">
          <button class="tc-skip">Skip tour</button>
          ${isAction
            ? '<span class="tc-hint">do this to continue</span><button class="tc-skipstep">skip&nbsp;→</button>'
            : '<button class="tc-next">Next →</button>'}
        </span>
      </div>`;
    callout.querySelector('.tc-skip').onclick = stop;
    callout.querySelector('.tc-next')?.addEventListener('click', next);
    callout.querySelector('.tc-skipstep')?.addEventListener('click', next);

    if (step.advance === 'click') {
      const h = () => setTimeout(next, 350);          // let the control's own handler run first
      target.addEventListener('click', h, { once: true });
      cleanup.push(() => target.removeEventListener('click', h));
    } else if (step.advance === 'change') {
      const h = () => next();
      target.addEventListener('change', h, { once: true });
      cleanup.push(() => target.removeEventListener('change', h));
    }
    reposition();
  }

  function reposition() {
    if (!active) return;
    const step = steps[idx]; const target = step && q(step.sel);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 6;
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';

    const cw = 300;
    const placeBelow = (window.innerHeight - r.bottom) > 170 || r.top < 170;
    callout.style.width = cw + 'px';
    const top = placeBelow ? r.bottom + 16 : Math.max(12, r.top - callout.offsetHeight - 16);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 12);
    callout.style.left = left + 'px';
    callout.style.top = top + 'px';

    arrow.textContent = placeBelow ? '▲' : '▼';
    arrow.style.left = (Math.min(Math.max(r.left + r.width / 2, left + 16), left + cw - 16) - 9) + 'px';
    arrow.style.top = (placeBelow ? r.bottom + 1 : r.top - 23) + 'px';
  }

  // Wire the launch button if present.
  document.getElementById('btn-training')?.addEventListener('click', start);
  window.ReviewTraining = { start, stop, isActive: () => active };
})();
