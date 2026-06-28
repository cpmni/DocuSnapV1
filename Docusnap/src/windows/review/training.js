'use strict';
/*
 * Interactive step-by-step training for the Review window — a gentle "coachmark" tour for
 * first-time users. It dims the screen, spotlights the control to use next, points an arrow
 * at it with a plain-English instruction, and AUTO-ADVANCES when the user does the action
 * (change the type, click Confirm…). Self-contained: renderer-only, no IPC, no new deps.
 */
(function () {
  const STEPS = [
    { id: 'queue', sel: '#queue-list', title: 'Your review queue', advance: 'click',
      body: 'Every scanned document waiting for you appears here. Click one to open it — and we’ll walk through checking and filing it.' },
    { id: 'nav', sel: '#btn-doc-next', title: 'Move between documents', advance: 'next',
      body: 'Step through your documents with these arrows — or just press the ↑ and ↓ keys, no mouse needed.' },
    { id: 'doc', sel: '#doc-panel', title: 'The scanned document', advance: 'next',
      body: 'The scan itself shows in the middle. You can zoom and drag it to read anything closely.' },
    { id: 'split', sel: '#btn-split-pdf', title: 'Split a combined PDF', advance: 'next',
      body: 'Sometimes one PDF holds several documents scanned together. The ✂ Split button — it appears on multi-page files — lets you split them into separate documents, each filed on its own.' },
    { id: 'fieldspanel', sel: '#fields-panel', title: 'What Scan Finder read', advance: 'next',
      body: 'On the right are the details it pulled out — who it’s from, the date, the reference. Your job is just to check them.' },
    // Branch point: pick an existing type (→ skip to "check details"), or "No type yet" → build one.
    { id: 'doctype', sel: '#doctype-select', title: 'Choose the document type', advance: 'change', allowNext: true,
      advanceTo: 'fields', branch: { label: 'No type yet', to: 'nt-open', requires: '#btn-new-doctype' },
      body: 'Pick what kind of document this is (Invoice, Order…). If the right type isn’t in the list, click “No type yet” and we’ll create it together.' },
    { id: 'nt-open', sel: '#btn-new-doctype', title: 'Create a new type', advance: 'click',
      body: 'Click “+ New type” to open the type builder.' },
    { id: 'nt-fill', sel: '#fields-panel', pin: 'bottom', advance: 'next', returnTo: 'doctype', title: 'Build your new type',
      body: 'Give the type a name, add the fields you want Scan Finder to capture, and Save. We’ll bring you right back here to pick it — and from now on it can detect and file that type automatically.' },
    { id: 'fields', sel: '#fields-scroll', title: 'Check the details', advance: 'next',
      body: 'Read down the fields and fix anything that looks wrong. To teach a field for next time, click its ⊕ and draw a box round the value.' },
    { id: 'ack', sel: '#btn-acknowledge', title: 'Mark as reviewed (Space)', advance: 'next',
      body: 'When a document was flagged but you’ve checked everything’s fine, press the Space key (or this button) to mark it reviewed — so “File All Ready” will include it.' },
    { id: 'del', sel: '#btn-delete', title: 'Delete a document', advance: 'next',
      body: 'Don’t need it? Delete removes the document from the queue — it goes to the recycle bin, so it can be restored later if needed.' },
    { id: 'confirm', sel: '#btn-confirm', title: 'File the document', advance: 'click', alsoEnter: true,
      body: 'When everything looks right, click Confirm & File — or just press Enter — to file a tidy copy and jump to the next document. Scan Finder learns from your corrections each time.' },
    { id: 'reproc', sel: '#btn-reprocess-all', title: 'Reprocess all — it gets smarter', advance: 'next',
      body: 'Once you’ve confirmed a few documents, Reprocess all re-reads every document still in the queue using what Scan Finder just learned from your corrections — often filling in fields it missed the first time.' },
    { id: 'fileall', sel: '#btn-file-all-review', title: 'File all ready', advance: 'next',
      body: 'When several documents look right, File All Ready files them all at once — they’re tidied away and become searchable later from Search. Anything still missing details is left for you to check.' },
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
  function jumpTo(id) { const i = steps.findIndex(s => s.id === id); if (i < 0) { next(); return; } idx = i; render(); }
  function finish() {
    callout.classList.add('done');
    callout.innerHTML = `<div class="tc-title">You’re all set 🎉</div>
      <div class="tc-body">That’s the whole loop — open a document, check the details, pick the type, Confirm & File, then use Reprocess all / File all ready for the rest. You can re-run this any time from “Take a tour”.</div>
      <div class="tc-foot"><span class="tc-step"></span><span class="tc-actions"><button class="tc-skip">Done</button><button class="tc-next">Do another →</button></span></div>`;
    hole.style.opacity = '0'; arrow.style.display = 'none';
    callout.style.left = '50%'; callout.style.top = '50%'; callout.style.transform = 'translate(-50%,-50%)';
    callout.querySelector('.tc-skip').onclick = stop;
    callout.querySelector('.tc-next').onclick = restart;
  }

  // "Do another" — walk the loop again on the next document in the queue.
  function restart() {
    idx = 0;
    callout.classList.remove('done');
    callout.style.transform = ''; hole.style.opacity = ''; arrow.style.display = '';
    render();
  }

  function render() {
    clearStep();
    const step = steps[idx];
    const target = q(step.sel);
    const visible = !!(target && target.getClientRects().length);
    const isAction = step.advance === 'click' || step.advance === 'change';
    // An action can't be performed on a control that isn't on screen — skip it. But an
    // INFO step still explains a feature even when its button is conditionally hidden
    // (Split shows only on multi-page PDFs, Mark Reviewed only when flagged, etc.).
    if (!visible && isAction) { next(); return; }

    callout.classList.remove('done');
    callout.style.transform = ''; callout.style.bottom = ''; hole.style.opacity = ''; arrow.style.display = '';
    const fwd = step.advanceTo || step.returnTo;   // forward-jump target id (else linear next)
    const fwdGo = () => (fwd ? jumpTo(fwd) : next());
    const reqEl = step.branch && step.branch.requires && q(step.branch.requires);
    const branchOk = step.branch && (!step.branch.requires || (reqEl && reqEl.getClientRects().length));
    callout.innerHTML = `
      <div class="tc-title">${step.title}</div>
      <div class="tc-body">${step.body}</div>
      <div class="tc-foot">
        <span class="tc-step">Step ${idx + 1}</span>
        <span class="tc-actions">
          <button class="tc-skip">Skip tour</button>
          ${branchOk ? `<button class="tc-branch">${step.branch.label}</button>` : ''}
          ${isAction
            ? `<span class="tc-hint">do this to continue</span><button class="${step.allowNext ? 'tc-next' : 'tc-skipstep'}">${step.allowNext ? 'Next →' : 'skip&nbsp;→'}</button>`
            : '<button class="tc-next">Next →</button>'}
        </span>
      </div>`;
    callout.querySelector('.tc-skip').onclick = stop;
    callout.querySelector('.tc-next')?.addEventListener('click', fwdGo);
    callout.querySelector('.tc-skipstep')?.addEventListener('click', fwdGo);
    callout.querySelector('.tc-branch')?.addEventListener('click', () => jumpTo(step.branch.to));

    // No spotlight when the control isn't on screen, or for a "pinned" step (e.g. while the
    // new-type builder is open) — keep the card out of the way at the bottom.
    if (!visible || step.pin === 'bottom') {
      hole.style.opacity = '0'; arrow.style.display = 'none';
      callout.style.left = '50%';
      if (step.pin === 'bottom') { callout.style.top = 'auto'; callout.style.bottom = '24px'; callout.style.transform = 'translateX(-50%)'; }
      else { callout.style.top = '50%'; callout.style.transform = 'translate(-50%,-50%)'; }
      return;
    }

    if (step.advance === 'click') {
      const h = () => setTimeout(next, 350);          // let the control's own handler run first
      target.addEventListener('click', h, { once: true });
      cleanup.push(() => target.removeEventListener('click', h));
      if (step.alsoEnter) {   // Confirm & File also fires on the Enter key
        const ek = (e) => { if (e.key === 'Enter') { document.removeEventListener('keydown', ek); setTimeout(next, 350); } };
        document.addEventListener('keydown', ek);
        cleanup.push(() => document.removeEventListener('keydown', ek));
      }
    } else if (step.advance === 'change') {
      const h = () => fwdGo();
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
    callout.style.width = cw + 'px';
    const ch = callout.offsetHeight || 150;
    // A tall pane (queue / preview / fields) leaves no room above or below, so the callout
    // would land off-screen. Park it bottom-centre with no arrow; small targets get the arrow.
    const tall = r.height > window.innerHeight * 0.6;
    let left, top, showArrow = !tall;
    if (tall) {
      left = window.innerWidth / 2 - cw / 2;
      top = window.innerHeight - ch - 24;
    } else {
      const placeBelow = (window.innerHeight - r.bottom) > (ch + 28) || r.top < (ch + 28);
      top = placeBelow ? r.bottom + 16 : r.top - ch - 16;
      left = r.left + r.width / 2 - cw / 2;
      arrow.textContent = placeBelow ? '▲' : '▼';
      arrow.style.top = (placeBelow ? r.bottom + 1 : r.top - 23) + 'px';
    }
    // Clamp fully on-screen so instructions are never lost off an edge.
    left = Math.min(Math.max(12, left), window.innerWidth - cw - 12);
    top = Math.min(Math.max(12, top), window.innerHeight - ch - 12);
    callout.style.left = left + 'px';
    callout.style.top = top + 'px';
    arrow.style.display = showArrow ? '' : 'none';
    if (showArrow) arrow.style.left = (Math.min(Math.max(r.left + r.width / 2, left + 16), left + cw - 16) - 9) + 'px';
  }

  // Wire the launch button if present.
  document.getElementById('btn-training')?.addEventListener('click', start);
  // When a new type is created during the "build a type" step, jump straight back to picking it.
  window.docusnap?.onDocTypesChanged?.(() => {
    if (active && steps[idx] && steps[idx].id === 'nt-fill') jumpTo(steps[idx].returnTo || 'doctype');
  });
  window.ReviewTraining = { start, stop, isActive: () => active };
})();
