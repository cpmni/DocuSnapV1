'use strict';
/*
 * quickfileView.js — the Home-window "Quick File" PANE (replaces the old modal quickfile.js).
 * QuickFile+Departments plan §3 Q1; UI direction 2026-09-13 (barry: pane > modal; eric: view-router
 * swap; Oracle-gated). An in-page view, sibling to Import: choose files → type Company/Date/Title/
 * Reference/Notes + a Quick File doc type → file each without OCR → a persistent RECEIPT (Open folder /
 * Find it / Undo). Paths never enter the renderer (MAIN holds a staging token map); we pass tokens back.
 * CSP-safe: createElement + addEventListener only, no inline handlers, no innerHTML of user text.
 *
 * Backend is UNCHANGED — the same four IPCs the modal used (quickFilePick/DocTypes/AddType/Submit).
 * DARK: the nav item + the Import cross-link stay display:none until direct_intake_enabled reveals them;
 * #view-quickfile is never .active when off; renderer's showView no-ops 'quickfile' unless enabled.
 */
(function () {
  const D = window.docusnap;
  if (!D || !D.quickFilePick) { window.QuickFileView = { enabled: false, enter() {}, refreshTypes() {} }; return; }

  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const k in props) { if (k === 'style') Object.assign(n.style, props[k]); else if (k in n) n[k] = props[k]; else n.setAttribute(k, props[k]); }
    for (const c of [].concat(kids)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };
  const stem = (name) => String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Document';
  // Plain-English reason for a refused staged file (Q-C10 validator reasons → operator text).
  const _refuseReason = (r) => ({
    network: 'network paths aren’t supported yet',
    unsupported_type: 'unsupported file type',
    too_large: 'too large',
    inside_app: 'that file is inside ScanFinder’s own folders',
    unresolved: 'the file could not be read',
    missing: 'the file was not found',
    not_a_file: 'not a file',
    invalid: 'invalid file',
  })[r] || 'unsupported file';
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let _inited = false;
  let staged = [];                 // [{ token, name, titleInput }]
  let typeSelect = null, partyI, dateI, refI, notesI, filesBox, msg, fileBtn, pickBtn, typeRow, receiptBox;

  const view = { enabled: false };

  // ── Reveal (fail-closed): read the flag ONCE; on enabled, un-hide the two entry points. Any failure
  //    leaves them hidden (matches the old modal's semantics). The nav item is routed by data-view; the
  //    Import cross-link is wired here to switch to the pane. ──
  document.addEventListener('DOMContentLoaded', async () => {
    let enabled = false;
    try { const r = await D.quickFileDocTypes(); enabled = !!(r && r.ok && r.enabled); } catch { /* stays hidden */ }
    view.enabled = enabled;
    if (!enabled) return;
    const nav = document.getElementById('nav-quickfile');
    const btn = document.getElementById('btn-quickfile');
    if (nav) nav.style.display = '';                          // data-view routes the click (renderer delegation)
    if (btn) { btn.style.display = ''; btn.addEventListener('click', (e) => { e.preventDefault(); if (window.showView) window.showView('quickfile'); }); }
  });

  function renderTypeRow(installed, presets) {
    typeRow.textContent = '';
    typeRow.appendChild(el('label', { className: 'sidebar-label', style: { display: 'block', marginBottom: '4px', fontSize: '12px' } }, 'File as'));
    const seen = new Set(); const opts = [];
    for (const t of (installed || [])) { opts.push(el('option', { value: String(t.id) }, t.name)); seen.add(t.slug); }
    for (const p of (presets || [])) { if (!seen.has(p.slug)) opts.push(el('option', { value: 'new:' + p.slug }, p.name)); }
    typeSelect = el('select', { className: 'input', style: { width: '100%', padding: '8px', borderRadius: 'var(--r-sm)' } }, opts);
    typeRow.appendChild(typeSelect);
    if (!opts.length) typeRow.appendChild(el('div', { className: 'muted', style: { fontSize: '12px', color: 'var(--muted)', marginTop: '4px' } }, 'No Quick File types available.'));
  }

  function renderFiles() {
    filesBox.textContent = '';
    if (!staged.length) { filesBox.appendChild(el('div', { className: 'muted', style: { fontSize: '13px', color: 'var(--muted)' } }, 'No files chosen yet.')); return; }
    for (const f of staged) {
      const row = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } });
      row.appendChild(el('span', { style: { flex: '0 0 40%', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.name));
      f.titleInput = el('input', { className: 'input', type: 'text', value: stem(f.name), placeholder: 'Title', style: { flex: '1', padding: '6px', borderRadius: 'var(--r-sm)' } });
      row.appendChild(f.titleInput);
      const rm = el('button', { className: 'btn-mini', type: 'button', title: 'Remove' }, '×');
      rm.addEventListener('click', () => { staged = staged.filter((x) => x !== f); renderFiles(); });
      row.appendChild(rm);
      filesBox.appendChild(row);
    }
  }

  // A persistent receipt row for one filed document (Open folder / Find it / Undo). Built with textContent
  // only — the title + path are user-controlled, never innerHTML.
  function addReceipt(name, title, res) {
    if (!receiptBox) return;
    receiptBox.hidden = false;
    const row = el('div', { className: 'qf-receipt-row', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderTop: '1px solid var(--border)' } });
    row.appendChild(el('svg', { className: 'ico ico-sm', 'aria-hidden': 'true' }, [(() => { const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-check'); return u; })()]));
    row.appendChild(el('span', { style: { flex: '1', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: title }, title || name));
    const link = (label, fn) => { const a = el('button', { className: 'btn-mini', type: 'button' }, label); a.addEventListener('click', fn); return a; };
    // De-pathed (Oracle C2): reveal by docId — main re-resolves the current filed path (survives an Edit/
    // re-file) and no filed path round-trips through the renderer (preload.js convention).
    if (res.docId && D.showDocumentInExplorer) row.appendChild(link('Open folder', () => D.showDocumentInExplorer(res.docId)));
    if (D.openSearchWindow) row.appendChild(link('Find it', () => D.openSearchWindow(title || name)));
    if (res.docId && D.deleteDocument) {
      const undo = link('Undo', async () => {
        try { await D.deleteDocument(res.docId, res.storedPath || null); undo.disabled = true; row.style.opacity = '.5';
          row.appendChild(el('span', { className: 'muted', style: { fontSize: '12px', color: 'var(--muted)' } }, 'removed (in recycle bin)')); } catch {}
      });
      row.appendChild(undo);
    }
    receiptBox.appendChild(row);
  }

  async function doFile() {
    if (!typeSelect || !typeSelect.value) { msg.style.color = 'var(--warn)'; msg.textContent = 'Pick a type first.'; return; }
    if (!staged.length) { msg.style.color = 'var(--warn)'; msg.textContent = 'Choose at least one file.'; return; }
    if (!partyI.value.trim()) { msg.style.color = 'var(--warn)'; msg.textContent = 'Enter the company or person.'; partyI.focus(); return; }
    fileBtn.disabled = true; pickBtn.disabled = true;
    const reEnable = () => { fileBtn.disabled = false; pickBtn.disabled = false; };
    // Resolve the type — a "new:<slug>" option is a catalog preset added on first use.
    let documentTypeId; const tv = typeSelect.value;
    if (tv.indexOf('new:') === 0) {
      msg.style.color = 'var(--muted)'; msg.textContent = 'Setting up the type…';
      try {
        const ar = await D.quickFileAddType(tv.slice(4));
        if (!ar || !ar.ok || !ar.type) { msg.style.color = 'var(--warn)'; msg.textContent = 'Could not set up that type.'; reEnable(); return; }
        documentTypeId = ar.type.id;
        const fresh = await D.quickFileDocTypes(); renderTypeRow(fresh.installed, fresh.presets);
        for (const o of typeSelect.options) if (Number(o.value) === documentTypeId) typeSelect.value = o.value;
      } catch { msg.style.color = 'var(--warn)'; msg.textContent = 'Could not set up that type.'; reEnable(); return; }
    } else documentTypeId = Number(tv);
    const shared = { documentTypeId, party: partyI.value.trim(), date: dateI.value || '', reference: refI.value.trim(), notes: notesI.value.trim() };
    let filed = 0; const errors = [];
    for (const f of staged) {
      msg.style.color = 'var(--muted)'; msg.textContent = `Filing ${filed + 1} of ${staged.length}…`;
      const title = (f.titleInput && f.titleInput.value.trim()) || stem(f.name);
      try {
        const r = await D.quickFileSubmit({ token: f.token, meta: { ...shared, title } });
        if (r && r.ok) { filed++; addReceipt(f.name, title, r); } else errors.push(`${f.name}: ${(r && r.error) || 'failed'}`);
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    msg.style.color = errors.length ? 'var(--warn)' : 'var(--ok)';
    msg.textContent = `Filed ${filed} document(s)${errors.length ? ` · ${errors.length} could not be filed (${errors[0]})` : ''}. They're searchable now.`;
    staged = []; renderFiles();
    fileBtn.disabled = false; pickBtn.disabled = false;
  }

  function build() {
    const root = document.getElementById('qf-root');
    if (!root) return;
    root.textContent = '';
    root.appendChild(el('h1', { className: 'view-title' }, 'Quick File'));
    root.appendChild(el('p', { className: 'muted', style: { margin: '0 0 16px', fontSize: '13px', color: 'var(--muted)', maxWidth: '640px' } },
      'For documents that need no scanning — Word, Excel, email, PDF. Type the details and it files straight into your folders, searchable a moment later. It never runs OCR and never teaches the scanner.'));

    // Header row: pick zone (left) + details (right). Click-to-pick CARD that also accepts a DRAG-DROP
    // (Oracle SIGN-OFF-W/COND 2026-09-13). The `data-intake-drop` attribute scopes the drop wiring to
    // THIS element — the window-level preload drop guard (preventDefault, kills file:// nav) is UNTOUCHED
    // and still fires as the last-in-chain backstop; every other window is byte-identical.
    const dropZone = el('div', { id: 'qf-dropzone', 'data-help-key': 'quick-file', 'data-intake-drop': '', style: {
      flex: '0 0 260px', minHeight: '120px', border: '1px solid var(--border)', background: 'var(--surface)',
      borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '8px', padding: '18px', textAlign: 'center', color: 'var(--muted)', cursor: 'pointer' } });
    pickBtn = el('button', { className: 'btn', type: 'button' }, 'Choose files…');
    pickBtn.addEventListener('click', doPick);
    dropZone.appendChild(el('div', { style: { fontSize: '13px' } }, 'Choose documents to file'));
    dropZone.appendChild(pickBtn);
    dropZone.addEventListener('click', (e) => { if (e.target === dropZone) doPick(); });

    // Drag-drop. The dashed "drop here" cue shows ONLY while a real file drag is over the card. Path
    // resolution happens in the PRELOAD (webUtils.getPathForFile needs the real File — a File passed
    // from the renderer through contextBridge is a proxy and resolves to ''); the preload hands us the
    // resolved absolute paths via onQuickFileDrop, and we forward them to MAIN for Q-C10 validation. The
    // renderer never touches a File or a path. The drop event itself is preventDefaulted by the window
    // backstop (preload) AND here (cue reset) — never stopPropagation.
    const _hasFiles = (e) => { try { return Array.prototype.includes.call(e.dataTransfer.types || [], 'Files'); } catch { return false; } };
    const _drag = (on) => {
      dropZone.style.borderStyle = on ? 'dashed' : 'solid';
      dropZone.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
      dropZone.style.background = on ? 'var(--accent-bg)' : 'var(--surface)';
    };
    dropZone.addEventListener('dragenter', (e) => { if (_hasFiles(e)) { e.preventDefault(); _drag(true); } });
    dropZone.addEventListener('dragover', (e) => { if (_hasFiles(e)) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch {} } });
    dropZone.addEventListener('dragleave', (e) => { if (e.target === dropZone) _drag(false); });
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); _drag(false); });   // cue reset (paths arrive via onQuickFileDrop)

    // The preload resolves the dropped paths and calls this back (plain string[] — never a File).
    if (D.onQuickFileDrop) D.onQuickFileDrop(async (paths) => {
      _drag(false);
      if (!paths || !paths.length) { if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = 'Couldn’t read the dropped file(s) — use “Choose files…” instead.'; } return; }
      try {
        const r = await D.quickFileStagePaths(paths);
        if (r && r.ok) {
          staged = staged.concat((r.files || []).filter((f) => f.token).map((f) => ({ token: f.token, name: f.name })));
          renderFiles();
          const refused = (r.files || []).filter((f) => f.refused);
          if (refused.length) { msg.style.color = 'var(--warn)'; msg.textContent = `${refused.length} file(s) skipped — ${_refuseReason(refused[0].refused)}.`; }
          else if (msg) { msg.style.color = 'var(--ok)'; msg.textContent = `Added ${(r.files || []).length} file(s) — fill in the details and File.`; }
        } else if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = 'Could not add those files.'; }
      } catch { /* ignore */ }
    });

    typeRow = el('div', { style: { margin: '0 0 12px' } });
    const inStyle = { width: '100%', padding: '8px', borderRadius: 'var(--r-sm)', boxSizing: 'border-box' };
    const mkField = (labelText, input) => el('div', { style: { marginBottom: '10px' } },
      [el('label', { className: 'sidebar-label', style: { display: 'block', marginBottom: '4px', fontSize: '12px' } }, labelText), input]);
    partyI = el('input', { className: 'input', type: 'text', placeholder: 'Company or person', style: inStyle });
    dateI  = el('input', { className: 'input', type: 'date', value: todayIso(), style: inStyle });
    refI   = el('input', { className: 'input', type: 'text', placeholder: 'Optional', style: inStyle });
    notesI = el('textarea', { className: 'input', rows: 2, placeholder: 'Optional — searchable', style: inStyle });
    const details = el('div', { style: { flex: '1', minWidth: '0' } }, [
      typeRow,
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
        [mkField('Company / Person', partyI), mkField('Date', dateI), mkField('Reference', refI), mkField('Notes', notesI)]),
    ]);
    root.appendChild(el('div', { style: { display: 'flex', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' } }, [dropZone, details]));

    // Staged files.
    filesBox = el('div', { style: { margin: '12px 0', maxHeight: '200px', overflowY: 'auto' } });
    root.appendChild(filesBox);
    renderFiles();

    // Action + message.
    msg = el('div', { style: { minHeight: '18px', fontSize: '13px', margin: '6px 0' } });
    fileBtn = el('button', { className: 'btn-run', type: 'button', style: { minWidth: '180px' } }, 'File documents');
    fileBtn.addEventListener('click', doFile);
    root.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [fileBtn, msg]));

    // Persistent receipt.
    receiptBox = el('div', { className: 'qf-receipt', hidden: true, style: { marginTop: '18px' } });
    receiptBox.appendChild(el('div', { className: 'sidebar-label', style: { fontSize: '12px', marginBottom: '2px' } }, 'Filed just now'));
    root.appendChild(receiptBox);
  }

  async function doPick() {
    try {
      const r = await D.quickFilePick();
      if (!r || !r.ok) return;
      const refused = (r.files || []).filter((f) => f.refused);
      staged = staged.concat((r.files || []).filter((f) => f.token).map((f) => ({ token: f.token, name: f.name })));
      renderFiles();
      if (refused.length) { msg.style.color = 'var(--warn)'; msg.textContent = `${refused.length} file(s) skipped (unsupported type).`; }
    } catch { /* ignore */ }
  }

  async function refreshTypes() {
    if (!typeRow) return;
    try { const info = await D.quickFileDocTypes(); if (info && info.ok) renderTypeRow(info.installed, info.presets); } catch {}
  }

  // enter(): build once (idempotent), refresh the type list on each entry, focus the company field.
  async function enter() {
    if (!_inited) { build(); _inited = true; }
    await refreshTypes();
    setTimeout(() => { try { partyI && partyI.focus(); } catch {} }, 30);
  }

  window.QuickFileView = { get enabled() { return view.enabled; }, enter, refreshTypes };
})();
