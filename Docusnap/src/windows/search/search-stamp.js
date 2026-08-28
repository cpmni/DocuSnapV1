'use strict';
/*
 * search-stamp.js — the "Send or stamp…" popup + click-to-place + the stamped/original toggle.
 * Workflow+Stamping redesign 2026-08-28 (slice 2b). Self-contained: injects its own CSS + popup DOM.
 * The renderer only ever sends coords + a stamp type; the main process resolves the source, gates
 * permission + access, and writes the immutable record (src/services/stampService.js).
 */
(function () {
  const S = () => window.SearchState || {};
  let _doc = null, _types = [], _placing = null, _selType = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (msg) => { try { window.SearchState && window.SearchState.toast ? window.SearchState.toast(msg) : console.log(msg); } catch { /* noop */ } };
  const _fmtDT = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');   // ISO → "YYYY-MM-DD HH:MM"

  // ── one-time CSS (CSP allows inline styles) ─────────────────────────────────
  function _css() {
    if (document.getElementById('stamp-css')) return;
    const s = document.createElement('style'); s.id = 'stamp-css';
    s.textContent = `
      .stamp-popup-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
      .stamp-popup{width:min(560px,92vw);max-height:88vh;overflow:auto;background:var(--surface);border:1px solid var(--border2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:16px 18px}
      .sp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
      .sp-title{font-size:15px;font-weight:600;color:var(--text)}
      .sp-x{border:none;background:transparent;color:var(--muted);font-size:20px;line-height:1;cursor:pointer;border-radius:6px;width:26px;height:26px}
      .sp-x:hover{background:var(--surface2);color:var(--text)}
      .sp-sub{font-size:12px;color:var(--muted);margin-bottom:12px}
      .sp-waiting{background:var(--accent-bg);border:1px solid var(--border2);border-radius:9px;padding:10px 12px;margin-bottom:12px;font-size:12.5px}
      .sp-waiting .sp-wact{display:flex;gap:8px;margin-top:8px}
      .sp-seg{display:flex;gap:6px;background:var(--surface2);border-radius:9px;padding:4px;margin-bottom:12px}
      .sp-seg-btn{flex:1;border:none;background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;padding:7px 8px;border-radius:6px;cursor:pointer}
      .sp-seg-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.15)}
      .sp-lead{font-size:12.5px;color:var(--text);margin-bottom:10px}
      .stamp-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
      .stamp-chip{border:1.5px solid var(--sc,var(--border2));color:var(--sc,var(--text));background:transparent;font-weight:700;font-size:12px;letter-spacing:.03em;padding:6px 12px;border-radius:999px;cursor:pointer}
      .stamp-chip.sel{background:var(--sc,var(--accent));color:#fff}
      .stamp-chip.new{border-style:dashed;color:var(--muted);font-weight:600}
      .sp-note,.sp-select{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12.5px;font-family:inherit;margin-bottom:10px}
      .sp-row{display:flex;gap:8px;align-items:center;margin-bottom:10px}
      .sp-row label{font-size:12px;color:var(--muted);flex:0 0 auto}
      .sp-actions{display:flex;justify-content:flex-end;gap:8px}
      .sp-actions .btn{border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text)}
      .sp-actions .btn.primary{background:var(--accent);color:var(--on-accent,#fff)}
      .sp-actions .btn:disabled{opacity:.5;cursor:not-allowed}
      .sp-hint{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5}
      .sp-history{margin-top:14px;border-top:1px solid var(--border);padding-top:10px}
      .sp-hist-head{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
      .sp-hist-row{font-size:12px;color:var(--text);padding:4px 0;border-bottom:1px solid var(--border)}
      .sp-hist-row .h-seq{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:50%;background:var(--surface2);color:var(--muted);font-size:10px;font-weight:700;margin-right:6px}
      .sp-hist-row .h-badge{font-weight:700;margin-right:6px}
      .sp-hist-empty{font-size:12px;color:var(--muted)}
      .sp-err{color:var(--err);font-size:12px;margin-top:6px}
      /* new-stamp inline */
      .sp-new{border:1px dashed var(--border2);border-radius:9px;padding:10px;margin:8px 0}
      .sp-swatches{display:flex;gap:8px;margin:6px 0}
      .sp-sw{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer}
      .sp-sw.sel{border-color:var(--text)}
      /* placement */
      #stamp-place-bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9500;background:var(--surface);border:1px solid var(--border2);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:12.5px;color:var(--text)}
      #stamp-place-bar .btn{border:none;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text)}
      #stamp-place-bar .btn.primary{background:var(--accent);color:var(--on-accent,#fff)}
      #stamp-place-bar .btn:disabled{opacity:.5;cursor:not-allowed}
      #stamp-ghost{position:fixed;z-index:9400;pointer-events:none;box-sizing:border-box;border:2px solid var(--sc,#2E7D32);background:color-mix(in srgb, var(--sc,#2E7D32) 14%, transparent);border-radius:4px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--sc,#2E7D32);font-size:13px;letter-spacing:.03em}
      #stamp-ghost .sg-label{pointer-events:none;padding:0 4px;overflow:hidden;white-space:nowrap}
      #stamp-ghost.placed{pointer-events:auto;cursor:move;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--sc,#2E7D32)}
      #stamp-ghost .sg-handle{display:none;position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;background:var(--sc,#2E7D32);border:2px solid #fff;border-radius:3px;cursor:nwse-resize}
      #stamp-ghost.placed .sg-handle{display:block}
      body.stamp-placing #preview-img{cursor:crosshair}
      /* stamped/original toggle */
      #stamp-view-toggle{display:inline-flex;align-items:center;gap:6px;margin-left:10px;font-size:11px}
      #stamp-view-toggle select{background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:6px;font-size:11px;padding:2px 4px}
      #stamp-view-toggle .sv-badge{background:var(--accent-bg);color:var(--accent2);border-radius:999px;padding:1px 7px;font-weight:600}
      .sv-help{font-size:10.5px;color:var(--muted);margin-left:6px}
    `;
    document.head.appendChild(s);
  }

  // ── popup shell ─────────────────────────────────────────────────────────────
  function _ensure() {
    let el = document.getElementById('stamp-popup');
    if (el) return el;
    _css();
    el = document.createElement('div');
    el.id = 'stamp-popup'; el.className = 'stamp-popup-overlay'; el.style.display = 'none';
    el.innerHTML = `
      <div class="stamp-popup" role="dialog" aria-label="Send or stamp">
        <div class="sp-head"><span class="sp-title" id="sp-title">Send or stamp</span><button class="sp-x" title="Close">&times;</button></div>
        <div class="sp-sub" id="sp-sub"></div>
        <div class="sp-waiting" id="sp-waiting" hidden></div>
        <div class="sp-seg" id="sp-seg">
          <button class="sp-seg-btn active" data-mode="stamp">Stamp it myself</button>
          <button class="sp-seg-btn" data-mode="send">Send to someone</button>
        </div>
        <div id="sp-panel-stamp"></div>
        <div id="sp-panel-send" hidden></div>
        <div class="sp-history"><div class="sp-hist-head">History</div><div id="sp-hist-list"></div></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.sp-x').addEventListener('click', close);
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    el.querySelectorAll('.sp-seg-btn').forEach(b => b.addEventListener('click', () => _mode(b.dataset.mode)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.style.display !== 'none' && !_placing) close(); });
    return el;
  }
  function _mode(m) {
    const el = _ensure();
    el.querySelectorAll('.sp-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    el.querySelector('#sp-panel-stamp').hidden = m !== 'stamp';
    el.querySelector('#sp-panel-send').hidden = m !== 'send';
  }
  function close() { const el = document.getElementById('stamp-popup'); if (el) el.style.display = 'none'; }

  async function open(doc) {
    _doc = doc;
    const el = _ensure();
    el.querySelector('#sp-sub').textContent = `${doc.supplier_name || 'Document'} — ${doc.reference_number || doc.type_name || ''}`;
    const canStamp = !!S().canStamp;
    const canSend = !!S().workflowEntitled && (S().role === 'admin' || S().role === 'edit');
    el.querySelector('[data-mode="stamp"]').style.display = canStamp ? '' : 'none';
    el.querySelector('[data-mode="send"]').style.display = canSend ? '' : 'none';
    el.querySelector('#sp-seg').style.display = (canStamp && canSend) ? '' : 'none';
    el.querySelector('#sp-title').textContent = canStamp && canSend ? 'Send or stamp' : (canStamp ? 'Stamp this document' : 'Send this document');
    _mode(canStamp ? 'stamp' : 'send');
    el.style.display = '';
    _renderWaiting(); _renderStamp(); _renderSend(); _renderHistory();
  }

  // ── "Waiting on you" (a route addressed to me for THIS doc) ─────────────────
  async function _renderWaiting() {
    const host = document.getElementById('sp-waiting'); if (!host) return;
    host.hidden = true; host.innerHTML = '';
    if (!S().workflowEntitled) return;
    let mine = [];
    try { mine = (await window.docusnap.workflow.inbox() || []).filter(r => r.document_id === _doc.id && (r.state === 'pending' || r.state === 'claimed')); } catch { return; }
    if (!mine.length) return;
    const r = mine[0], approve = r.action_required === 'approve';
    host.hidden = false;
    host.innerHTML = `<div><b>${esc(r.from_username || 'Someone')}</b> sent this ${approve ? 'for your approval' : 'just so you\'ve seen it'}${r.comment ? ` — “${esc(r.comment)}”` : ''}.</div>
      ${approve ? `<input class="sp-note" id="sp-w-note" placeholder="Add a note (required to reject)" maxlength="300" style="margin-top:8px">` : ''}
      <div class="sp-wact">${approve ? `<button class="btn primary" id="sp-w-approve">Approve</button><button class="btn" id="sp-w-reject">Reject</button>` : `<button class="btn primary" id="sp-w-ack">Got it</button>`}</div>
      <div class="sp-err" id="sp-w-err" hidden></div>`;
    const err = host.querySelector('#sp-w-err');
    const resolve = async (decision) => {
      err.hidden = true;
      const note = host.querySelector('#sp-w-note') ? host.querySelector('#sp-w-note').value : '';
      if (decision === 'reject' && !note.trim()) { err.hidden = false; err.textContent = 'Add a short note so the sender knows why.'; return; }
      try {
        await window.docusnap.workflow.resolve(r.id, decision, note, r.version);
        toast(decision === 'approve' ? 'Approved.' : decision === 'reject' ? 'Rejected.' : 'Marked as seen.');
        close(); await _refreshStampedView(_doc.id);
      } catch (e) { err.hidden = false; err.textContent = (e && e.message) || 'Could not do that.'; }
    };
    host.querySelector('#sp-w-approve')?.addEventListener('click', () => resolve('approve'));
    host.querySelector('#sp-w-reject')?.addEventListener('click', () => resolve('reject'));
    host.querySelector('#sp-w-ack')?.addEventListener('click', () => resolve('acknowledge'));
  }

  // ── Stamp panel ─────────────────────────────────────────────────────────────
  async function _renderStamp() {
    const host = document.getElementById('sp-panel-stamp'); if (!host) return;
    if (!S().canStamp) { host.innerHTML = ''; return; }
    if (!_types.length) { try { _types = await window.docusnap.stamp.types(); } catch { _types = []; } }
    host.innerHTML = `
      <div class="sp-lead">Add a stamp to record a decision or a status.</div>
      <div class="stamp-chips">${_types.map(t => `<button class="stamp-chip" data-id="${t.id}" style="--sc:${esc(t.color)}">${esc(t.label)}</button>`).join('')}<button class="stamp-chip new" data-new="1">+ New stamp</button></div>
      <div id="sp-new-host"></div>
      <input class="sp-note" id="sp-stamp-note" placeholder="Add a note to the stamp — optional" maxlength="200">
      <div class="sp-actions"><button class="btn primary" id="sp-place" disabled>Place stamp on the document</button></div>
      <div class="sp-hint">You'll click a blank area on the document to drop it. A stamp is <b>permanent</b> — it shows your name and today's date and can't be removed; correct a mistake by adding a <b>VOID</b> stamp.</div>`;
    _selType = null;
    host.querySelectorAll('.stamp-chip[data-id]').forEach(c => c.addEventListener('click', () => {
      host.querySelectorAll('.stamp-chip').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      _selType = { id: Number(c.dataset.id), label: c.textContent, color: c.style.getPropertyValue('--sc') };
      host.querySelector('#sp-place').disabled = false;
    }));
    host.querySelector('[data-new]').addEventListener('click', () => _newStampInline(host));
    host.querySelector('#sp-place').addEventListener('click', () => {
      if (_selType) _beginPlacement(_selType, host.querySelector('#sp-stamp-note').value);
    });
  }

  function _newStampInline(host) {
    const nh = host.querySelector('#sp-new-host');
    const COLORS = { green: '#2E7D32', red: '#C62828', amber: '#B07816', blue: '#1565C0', grey: '#546170' };
    nh.innerHTML = `<div class="sp-new">
      <input class="sp-note" id="sp-new-word" placeholder="Word on the stamp (e.g. PAID IN FULL)" maxlength="16" style="text-transform:uppercase">
      <div class="sp-swatches">${Object.entries(COLORS).map(([k, v]) => `<span class="sp-sw" data-c="${v}" style="background:${v}" title="${k}"></span>`).join('')}</div>
      <div class="sp-actions"><button class="btn" id="sp-new-cancel">Cancel</button><button class="btn primary" id="sp-new-go" disabled>Create stamp</button></div>
      <div class="sp-err" id="sp-new-err" hidden></div></div>`;
    let color = null;
    const word = nh.querySelector('#sp-new-word'), go = nh.querySelector('#sp-new-go'), err = nh.querySelector('#sp-new-err');
    const sync = () => { go.disabled = !(word.value.trim() && color); };
    nh.querySelectorAll('.sp-sw').forEach(sw => sw.addEventListener('click', () => {
      nh.querySelectorAll('.sp-sw').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); color = sw.dataset.c; sync();
    }));
    word.addEventListener('input', sync);
    nh.querySelector('#sp-new-cancel').addEventListener('click', () => { nh.innerHTML = ''; });
    go.addEventListener('click', async () => {
      err.hidden = true;
      try {
        await window.docusnap.stamp.typeCreate({ label: word.value.trim(), color });
        _types = await window.docusnap.stamp.types();
        nh.innerHTML = ''; _renderStamp();
      } catch (e) { err.hidden = false; err.textContent = (e && e.message) || 'Could not create the stamp.'; }
    });
  }

  // ── Placement mode ──────────────────────────────────────────────────────────
  // The stamp follows the cursor; a click DROPS it; once dropped it can be moved (drag the body) or
  // resized (drag the corner, clamped to MIN_W..MAX_W) or Start over; Place stamp commits exactly ONE
  // stamp + the one note. Height follows the content server-side (pdfStamp), so only the WIDTH resizes.
  const MIN_W = 0.12, MAX_W = 0.50;   // stamp width as a fraction of the page width
  function _beginPlacement(type, note) {
    close();
    const img = document.getElementById('preview-img');
    if (!img || !(S().currentPages && S().currentPages.length)) { toast('Open the document first.'); return; }
    document.body.classList.add('stamp-placing');
    _placing = true;
    let mode = 'following';                    // 'following' -> 'placed'
    let w = 0.28, cx = 0.5, cy = 0.10;         // width + CENTRE (page-normalised) of the ghost

    const ghost = document.createElement('div'); ghost.id = 'stamp-ghost'; ghost.style.display = 'none';
    ghost.style.setProperty('--sc', type.color || '#2E7D32');
    ghost.innerHTML = `<span class="sg-label">${esc(type.label)}</span><span class="sg-handle" title="Drag to resize"></span>`;
    document.body.appendChild(ghost);

    const bar = document.createElement('div'); bar.id = 'stamp-place-bar';
    bar.innerHTML = `<span id="spb-hint">Move the stamp into place, then click to drop it.</span>
      <button class="btn" id="spb-remove" hidden>Start over</button>
      <button class="btn" id="spb-cancel">Cancel</button>
      <button class="btn primary" id="spb-go" disabled>Place stamp</button>`;
    document.body.appendChild(bar);
    const hint = bar.querySelector('#spb-hint'), go = bar.querySelector('#spb-go'), removeBtn = bar.querySelector('#spb-remove');

    const rect = () => img.getBoundingClientRect();
    function draw() {
      const r = rect();
      const wpx = Math.max(8, w * r.width), hpx = Math.max(24, wpx * 0.30);
      let left = r.left + cx * r.width - wpx / 2, top = r.top + cy * r.height - hpx / 2;
      left = Math.max(r.left, Math.min(r.right - wpx, left));
      top = Math.max(r.top, Math.min(r.bottom - hpx, top));
      ghost.style.display = ''; ghost.style.left = left + 'px'; ghost.style.top = top + 'px';
      ghost.style.width = wpx + 'px'; ghost.style.height = hpx + 'px';
    }
    function currentBox() {
      const r = rect(), g = ghost.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1 - w, (g.left - r.left) / r.width)), y: Math.max(0, (g.top - r.top) / r.height), w };
    }

    // FOLLOW the cursor until a click drops it.
    function onMove(e) {
      if (mode !== 'following') return;
      const r = rect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { ghost.style.display = 'none'; return; }
      cx = (e.clientX - r.left) / r.width; cy = (e.clientY - r.top) / r.height; draw();
    }
    function onDrop(e) {
      if (mode !== 'following') return;
      const r = rect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      cx = (e.clientX - r.left) / r.width; cy = (e.clientY - r.top) / r.height;
      mode = 'placed'; ghost.classList.add('placed'); draw();
      hint.textContent = 'Drag to move · drag the corner to resize.'; go.disabled = false; removeBtn.hidden = false;
    }
    // MOVE (drag body) / RESIZE (drag handle) once dropped.
    let drag = null;
    function onDown(e) {
      if (mode !== 'placed') return; e.preventDefault(); e.stopPropagation();
      drag = { handle: e.target.classList.contains('sg-handle'), x: e.clientX, y: e.clientY, cx, cy, w };
    }
    function onDragMove(e) {
      if (!drag) return; const r = rect();
      if (drag.handle) w = Math.max(MIN_W, Math.min(MAX_W, drag.w + (e.clientX - drag.x) / r.width * 2));
      else { cx = drag.cx + (e.clientX - drag.x) / r.width; cy = drag.cy + (e.clientY - drag.y) / r.height; }
      draw();
    }
    const onUp = () => { drag = null; };
    const onSync = () => { if (mode === 'placed') draw(); };

    window.addEventListener('mousemove', onMove);
    img.addEventListener('click', onDrop);
    ghost.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('scroll', onSync, true); window.addEventListener('resize', onSync);

    function cleanup() {
      document.body.classList.remove('stamp-placing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('scroll', onSync, true); window.removeEventListener('resize', onSync);
      img.removeEventListener('click', onDrop);
      ghost.remove(); bar.remove(); _placing = null;
    }
    removeBtn.addEventListener('click', () => {
      mode = 'following'; ghost.classList.remove('placed'); go.disabled = true; removeBtn.hidden = true;
      hint.textContent = 'Move the stamp into place, then click to drop it.';
    });
    bar.querySelector('#spb-cancel').addEventListener('click', cleanup);
    go.addEventListener('click', async () => {
      if (mode !== 'placed') return;
      const box = currentBox(), page = (S().currentPage || 0);
      go.disabled = true; go.textContent = 'Placing…';
      try {
        await window.docusnap.stamp.place({ documentId: _doc.id, stampTypeId: type.id, box, page, note });
        cleanup(); toast(`${type.label} stamped — recorded against this document.`);
        await _refreshStampedView(_doc.id);
      } catch (e) { go.disabled = false; go.textContent = 'Place stamp'; toast((e && e.message) || 'Could not stamp.'); }
    });
  }

  // ── Stamped/original toggle + view ──────────────────────────────────────────
  // Called from selectDoc after the fields render. Shows the toggle + defaults to Stamped when the
  // document carries ≥1 stamp; "Original" swaps back to the normal pages.
  async function onDocShown(doc) {
    const nav = document.getElementById('page-nav');
    document.getElementById('stamp-view-toggle')?.remove();
    if (!doc || !nav) return;
    if (doc._origPages == null) doc._origPages = (S().currentPages || []).slice();   // the un-stamped pages, per-doc
    let stamps = [];
    try { stamps = await window.docusnap.stamp.list(doc.id); } catch { stamps = []; }
    if (S().selectedDoc !== doc) return;              // a newer selection owns the pane
    if (!stamps.length) return;
    const wrap = document.createElement('span'); wrap.id = 'stamp-view-toggle';
    wrap.innerHTML = `<span class="sv-badge">🏷 ${stamps.length}</span>
      <select id="sv-sel"><option value="stamped">Stamped</option><option value="original">Original</option></select>
      <span class="sv-help">Your original is never changed.</span>`;
    nav.appendChild(wrap);
    wrap.querySelector('#sv-sel').addEventListener('change', (e) => _setView(doc, e.target.value));
    _setView(doc, 'stamped');
  }
  async function _setView(doc, which) {
    const s = window.SearchState; if (!s || !s.selectedDoc || s.selectedDoc.id !== doc.id) return;
    if (which === 'original') {
      if (doc._origPages && doc._origPages.length) { s.currentPages = doc._origPages; s.currentPage = Math.min(s.currentPage, s.currentPages.length - 1); _repaint(); }
      return;
    }
    try {
      const r = await window.docusnap.stamp.currentPages(doc.id);
      if (!s.selectedDoc || s.selectedDoc.id !== doc.id) return;
      if (r && r.ok && r.pages && r.pages.length) { s.currentPages = r.pages; s.currentPage = Math.min(s.currentPage, r.pages.length - 1); _repaint(); }
    } catch { /* leave the current view */ }
  }
  function _repaint() {
    const s = window.SearchState;
    const img = document.getElementById('preview-img');
    if (img && s.currentPages[s.currentPage]) img.src = s.currentPages[s.currentPage];
  }
  async function _refreshStampedView(docId) {
    const s = window.SearchState; if (!s || !s.selectedDoc || s.selectedDoc.id !== docId) return;
    await onDocShown(s.selectedDoc);   // re-reads the stamp list → shows the toggle/count + the stamped view
  }

  // ── Send panel (re-homes assign) ────────────────────────────────────────────
  async function _renderSend() {
    const host = document.getElementById('sp-panel-send'); if (!host) return;
    if (!(S().workflowEntitled && (S().role === 'admin' || S().role === 'edit'))) { host.innerHTML = ''; return; }
    let recips = [];
    try { recips = await window.docusnap.workflow.recipients(); } catch { recips = []; }
    let stampers = [];
    try { stampers = (await window.docusnap.stamp.grants()).filter(u => u.canStamp).map(u => u.id); } catch { stampers = recips.map(r => r.id); }
    const opts = (list) => list.map(r => `<option value="${r.id}">${esc(r.displayName || r.username)} (${esc(r.role)})</option>`).join('');
    host.innerHTML = `
      <div class="sp-lead">Send this document to a colleague.</div>
      <div class="sp-row"><label>Why</label>
        <select class="sp-select" id="sp-why"><option value="approve">They need to approve it</option><option value="acknowledge">Just so they've seen it</option></select></div>
      <div class="sp-row"><label>To</label><select class="sp-select" id="sp-to"></select></div>
      <input class="sp-note" id="sp-send-note" placeholder="Note (optional)" maxlength="300">
      <div class="sp-actions"><button class="btn primary" id="sp-send-go">Send</button></div>
      <div class="sp-err" id="sp-send-err" hidden></div>`;
    const why = host.querySelector('#sp-why'), to = host.querySelector('#sp-to'), err = host.querySelector('#sp-send-err');
    const fill = () => {
      const forApproval = why.value === 'approve';
      const list = forApproval ? recips.filter(r => stampers.includes(r.id)) : recips;
      to.innerHTML = opts(list) || `<option value="">${forApproval ? 'No one can approve yet — grant stamping in Settings' : 'No recipients'}</option>`;
    };
    why.addEventListener('change', fill); fill();
    host.querySelector('#sp-send-go').addEventListener('click', async () => {
      err.hidden = true;
      const toId = Number(to.value); if (!toId) { err.hidden = false; err.textContent = 'Pick a recipient.'; return; }
      try {
        await window.docusnap.workflow.assign(_doc.id, toId, why.value, host.querySelector('#sp-send-note').value);
        toast('Sent — it\'s in their Mailbox. You can recall it while it\'s waiting.');
        close();
      } catch (e) { err.hidden = false; err.textContent = (e && e.message) || 'Could not send.'; }
    });
  }

  // ── History ─────────────────────────────────────────────────────────────────
  async function _renderHistory() {
    const host = document.getElementById('sp-hist-list'); if (!host) return;
    const rows = [];
    try {
      // stamp.list is oldest-first = placement order, so the index is the stamp's number on the doc.
      (await window.docusnap.stamp.list(_doc.id)).forEach((st, i) =>
        rows.push({ seq: i + 1, at: st.placedAt, who: st.placedBy, label: st.label, color: st.color, note: st.note }));
    } catch { /* */ }
    if (S().workflowEntitled) {
      try { (await window.docusnap.workflow.docHistory(_doc.id) || []).forEach(h => rows.push({ at: h.resolved_at || h.created_at, who: h.actor_username || h.from_username, label: (h.state || '').toUpperCase(), color: 'var(--muted)', note: h.resolution_comment || h.comment })); } catch { /* */ }
    }
    rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));   // newest first
    host.innerHTML = rows.length
      ? rows.map(r => `<div class="sp-hist-row">${r.seq ? `<span class="h-seq">${r.seq}</span>` : ''}<span class="h-badge" style="color:${esc(r.color)}">${esc(r.label)}</span>${esc(r.who || '')} · ${esc(_fmtDT(r.at))}${r.note ? ' — “' + esc(r.note) + '”' : ''}</div>`).join('')
      : `<div class="sp-hist-empty">Nothing yet.</div>`;
  }

  window.SearchStamp = { open, close, onDocShown };
})();
