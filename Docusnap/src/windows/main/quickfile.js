'use strict';
/*
 * quickfile.js — the Home-window "Quick File" entry point (QuickFile+Departments plan §3 Q1).
 * Self-contained: shows the ⚡ button only when direct_intake_enabled is on, and drives a compact
 * modal — choose files → type Company/Date/Title/Reference/Notes + a Quick File doc type → file each
 * without OCR. Paths never enter the renderer (MAIN holds a staging token map); we pass tokens back.
 * CSP-safe: built with createElement + addEventListener, no inline handlers, no innerHTML of user text.
 */
(function () {
  const D = window.docusnap;
  if (!D || !D.quickFilePick) return;

  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const k in props) { if (k === 'style') Object.assign(n.style, props[k]); else if (k in n) n[k] = props[k]; else n.setAttribute(k, props[k]); }
    for (const c of [].concat(kids)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };
  const stem = (name) => String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Document';
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  document.addEventListener('DOMContentLoaded', async () => {
    const btn = document.getElementById('btn-quickfile');
    if (!btn) return;
    try { const r = await D.quickFileDocTypes(); if (r && r.ok && r.enabled) btn.style.display = ''; } catch { /* stays hidden */ }
    btn.addEventListener('click', openModal);
  });

  let overlay = null;
  function close() { if (overlay) { overlay.remove(); overlay = null; } }

  async function openModal() {
    close();
    let info; try { info = await D.quickFileDocTypes(); } catch { info = { ok: false }; }
    if (!info || !info.ok || !info.enabled) return;

    const card = el('div', { className: 'qf-card', style: {
      background: 'var(--surface)', color: 'var(--text)', borderRadius: 'var(--r)', width: 'min(680px, 94vw)',
      maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,.35)', padding: '22px 24px' } });
    overlay = el('div', { className: 'qf-overlay', 'data-help-ignore': '1', style: {
      position: 'fixed', inset: '0', background: 'rgba(20,24,34,.55)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '9999' } }, [card]);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    card.appendChild(el('h2', { style: { margin: '0 0 4px', fontSize: '18px' } }, '⚡ Quick File a document'));
    card.appendChild(el('p', { className: 'muted', style: { margin: '0 0 16px', fontSize: '13px', color: 'var(--muted)' } },
      'For documents that need no scanning — Word, Excel, email, PDF. Type the details and it files straight into your folders, searchable a moment later. It never runs OCR and never teaches the scanner.'));

    // ── doc type row (Quick File 'none' types; offer to add one if none installed) ──
    const typeRow = el('div', { style: { margin: '0 0 14px' } });
    card.appendChild(typeRow);
    let typeSelect = null;
    function renderTypeRow(installed, presets) {
      typeRow.textContent = '';
      typeRow.appendChild(el('label', { className: 'sidebar-label', style: { display: 'block', marginBottom: '4px', fontSize: '12px' } }, 'File as'));
      if (installed && installed.length) {
        typeSelect = el('select', { className: 'input', style: { width: '100%', padding: '8px', borderRadius: 'var(--r-sm)' } },
          installed.map(t => el('option', { value: String(t.id) }, t.name)));
        typeRow.appendChild(typeSelect);
      } else {
        typeSelect = null;
        typeRow.appendChild(el('div', { className: 'muted', style: { fontSize: '13px', marginBottom: '6px', color: 'var(--muted)' } },
          'No Quick File type yet. Add one to get started:'));
        const wrap = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
        for (const p of (presets || [])) {
          const b = el('button', { className: 'btn', type: 'button' }, `＋ ${p.name}`);
          b.addEventListener('click', async () => {
            b.disabled = true; b.textContent = 'Adding…';
            try { const r = await D.quickFileAddType(p.slug); if (r && r.ok) { const fresh = await D.quickFileDocTypes(); renderTypeRow(fresh.installed, fresh.presets); } else b.textContent = 'Failed — try again'; }
            catch { b.textContent = 'Failed — try again'; b.disabled = false; }
          });
          wrap.appendChild(b);
        }
        typeRow.appendChild(wrap);
      }
    }
    renderTypeRow(info.installed, info.presets);

    // ── shared fields ──
    const mkField = (labelText, input) => el('div', { style: { marginBottom: '10px' } },
      [el('label', { className: 'sidebar-label', style: { display: 'block', marginBottom: '4px', fontSize: '12px' } }, labelText), input]);
    const inStyle = { width: '100%', padding: '8px', borderRadius: 'var(--r-sm)', boxSizing: 'border-box' };
    const partyI = el('input', { className: 'input', type: 'text', placeholder: 'Company or person', style: inStyle });
    const dateI = el('input', { className: 'input', type: 'date', value: todayIso(), style: inStyle });
    const refI = el('input', { className: 'input', type: 'text', placeholder: 'Optional', style: inStyle });
    const notesI = el('textarea', { className: 'input', rows: 2, placeholder: 'Optional — searchable', style: inStyle });
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
      [mkField('Company / Person', partyI), mkField('Date', dateI), mkField('Reference', refI), mkField('Notes', notesI)]);
    card.appendChild(grid);

    // ── files ──
    const filesBox = el('div', { style: { margin: '10px 0', maxHeight: '160px', overflowY: 'auto' } });
    let staged = [];   // [{ token, name, titleInput }]
    function renderFiles() {
      filesBox.textContent = '';
      if (!staged.length) { filesBox.appendChild(el('div', { className: 'muted', style: { fontSize: '13px', color: 'var(--muted)' } }, 'No files chosen yet.')); return; }
      for (const f of staged) {
        const row = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } });
        row.appendChild(el('span', { style: { flex: '0 0 40%', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.name));
        f.titleInput = el('input', { className: 'input', type: 'text', value: stem(f.name), placeholder: 'Title', style: { flex: '1', padding: '6px', borderRadius: 'var(--r-sm)' } });
        row.appendChild(f.titleInput);
        filesBox.appendChild(row);
      }
    }
    renderFiles();

    const pickBtn = el('button', { className: 'btn', type: 'button' }, 'Choose files…');
    pickBtn.addEventListener('click', async () => {
      try {
        const r = await D.quickFilePick();
        if (!r || !r.ok) return;
        const refused = (r.files || []).filter(f => f.refused);
        staged = staged.concat((r.files || []).filter(f => f.token).map(f => ({ token: f.token, name: f.name })));
        renderFiles();
        msg.textContent = refused.length ? `${refused.length} file(s) skipped (unsupported type).` : '';
        msg.style.color = 'var(--warn)';
      } catch { /* ignore */ }
    });
    card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0 2px' } }, [pickBtn]));
    card.appendChild(filesBox);

    // ── actions + message ──
    const msg = el('div', { style: { minHeight: '18px', fontSize: '13px', margin: '6px 0' } });
    card.appendChild(msg);
    const fileBtn = el('button', { className: 'btn-run', type: 'button', style: { minWidth: '160px' } }, 'File documents');
    const cancelBtn = el('button', { className: 'btn', type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', close);
    card.appendChild(el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' } }, [cancelBtn, fileBtn]));

    fileBtn.addEventListener('click', async () => {
      if (!typeSelect) { msg.style.color = 'var(--warn)'; msg.textContent = 'Add a Quick File type first.'; return; }
      if (!staged.length) { msg.style.color = 'var(--warn)'; msg.textContent = 'Choose at least one file.'; return; }
      if (!partyI.value.trim()) { msg.style.color = 'var(--warn)'; msg.textContent = 'Enter the company or person.'; partyI.focus(); return; }
      fileBtn.disabled = true; cancelBtn.disabled = true; pickBtn.disabled = true;
      const documentTypeId = Number(typeSelect.value);
      const shared = { documentTypeId, party: partyI.value.trim(), date: dateI.value || '', reference: refI.value.trim(), notes: notesI.value.trim() };
      let filed = 0; const errors = [];
      for (const f of staged) {
        msg.style.color = 'var(--muted)'; msg.textContent = `Filing ${filed + 1} of ${staged.length}…`;
        try {
          const r = await D.quickFileSubmit({ token: f.token, meta: { ...shared, title: (f.titleInput && f.titleInput.value.trim()) || stem(f.name) } });
          if (r && r.ok) filed++; else errors.push(`${f.name}: ${(r && r.error) || 'failed'}`);
        } catch (e) { errors.push(`${f.name}: ${e.message}`); }
      }
      msg.style.color = errors.length ? 'var(--warn)' : 'var(--ok)';
      msg.textContent = `Filed ${filed} document(s)${errors.length ? ` · ${errors.length} could not be filed` : ''}. They're searchable now.`;
      staged = []; renderFiles();
      fileBtn.disabled = false; cancelBtn.disabled = false; pickBtn.disabled = false;
      fileBtn.textContent = 'File more';
    });

    setTimeout(() => partyI.focus(), 30);
  }
})();
