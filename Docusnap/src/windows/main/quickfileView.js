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
    for (const c of [].concat(kids)) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);   // skip null kids (parity with lookupAdmin.js el) — a `? x : null` kid must be a no-op, not appendChild(null)
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

  // A light OUTLINE drop glyph (a tray with a down-arrow) — stroked in the muted colour, no fill, so it
  // reads soft rather than a solid dark block. Built with createElementNS (CSP-safe).
  const _dropGlyph = (size) => {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.6');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.style.width = size + 'px'; s.style.height = size + 'px'; s.style.color = 'var(--muted)'; s.style.opacity = '0.8';
    const p = (d) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); s.appendChild(e); };
    p('M12 3 v10');              // arrow shaft
    p('M8 11 l4 4 l4 -4');       // arrow head (pointing down = drop)
    p('M4 15 v3 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 v-3');   // open tray
    return s;
  };

  // A sprite icon (createElementNS — the CSP-safe way; the `el` helper can't make real SVG nodes).
  const _svgIco = (id, size) => {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('viewBox', '0 0 24 24');
    s.style.width = size + 'px'; s.style.height = size + 'px'; s.style.flex = '0 0 auto';
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.appendChild(u);
    return s;
  };

  // Scoped styles for the pane — injected once. Consistent inputs (the theme .input looked inconsistent
  // here), a defined details card, and a proper dashed drop zone.
  function _injectStyles() {
    if (document.getElementById('qf-styles')) return;
    const st = document.createElement('style');
    st.id = 'qf-styles';
    st.textContent = `
      .qf-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:18px 20px; }
      .qf-lbl { display:block; margin-bottom:5px; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
      .qf-in { width:100%; box-sizing:border-box; padding:9px 11px; font:inherit; font-size:13px; color:var(--text);
               background:var(--surface); border:1px solid var(--border2); border-radius:var(--r-sm); transition:border-color .12s, box-shadow .12s; }
      .qf-in::placeholder { color:var(--muted); }
      .qf-in:focus { outline:none; border-color:var(--accent2); box-shadow:0 0 0 3px var(--accent-bg); }
      .qf-drop { border:2px dashed var(--border2); background:var(--surface2); border-radius:var(--r); display:flex;
                 flex-direction:column; align-items:center; justify-content:center; gap:9px; padding:26px 20px; text-align:center;
                 color:var(--muted); cursor:pointer; transition:border-color .12s, background .12s; }
      .qf-drop:hover { border-color:var(--accent); background:var(--accent-bg); }
      .qf-drop.drag { border-color:var(--accent); background:var(--accent-bg); }
      .qf-filerow { display:flex; gap:10px; align-items:center; padding:8px 0; border-top:1px solid var(--border); }
      .qf-filerow:first-child { border-top:none; }
    `;
    document.head.appendChild(st);
  }

  let _inited = false;
  let staged = [];                 // [{ token, name, titleInput }]
  let typeSelect = null, partyI, dateI, refI, notesI, filesBox, msg, fileBtn, pickBtn, typeRow, receiptBox, _singleArea;
  let installedTypes = [];         // Slice 0: the installed Quick File types (with their fields) for custom-field render
  let customBox = null;            // container for the selected type's per-type CUSTOM inputs
  let customInputs = {};           // fieldKey -> input element, for the current type
  let multiDocEnabled = false;     // S4a: quickfile_multidoc_enabled (DARK, mig 198) — gates the >1 master-detail path
  let _qfFocusedIdx = 0;           // focused staged doc in multi-doc mode
  const _previewCache = new Map(); // token -> {renderable, dataUrl|kind} (immutable per token)

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
    installedTypes = installed || [];
    typeRow.textContent = '';
    typeRow.appendChild(el('label', { className: 'qf-lbl' }, 'File as'));
    const seen = new Set(); const opts = [];
    for (const t of (installed || [])) { opts.push(el('option', { value: String(t.id) }, t.name)); seen.add(t.slug); }
    for (const p of (presets || [])) { if (!seen.has(p.slug)) opts.push(el('option', { value: 'new:' + p.slug }, p.name)); }
    typeSelect = el('select', { className: 'qf-in', style: { appearance: 'auto' } }, opts);
    typeSelect.addEventListener('change', () => { renderCustomFields(); refreshTypeahead(); _resolveRecordKey(); });
    typeRow.appendChild(typeSelect);
    if (!opts.length) typeRow.appendChild(el('div', { className: 'muted', style: { fontSize: '12px', color: 'var(--muted)', marginTop: '4px' } }, 'No Quick File types available.'));
    renderCustomFields();
  }

  // Slice 0 (Fork A): render the selected type's CUSTOM fields (everything that isn't already one of the
  // fixed inputs — Company/Person=supplier_name, Date, Reference, per-file Title). A 'new:<slug>' preset has
  // no created fields yet (and its defaults are all roles), so nothing renders until it's created + refetched.
  function renderCustomFields() {
    if (!customBox) return;
    customBox.textContent = '';
    customInputs = {};
    const tv = typeSelect && typeSelect.value;
    if (!tv || tv.indexOf('new:') === 0) return;
    const t = installedTypes.find((x) => String(x.id) === String(tv));
    if (!t || !Array.isArray(t.fields)) return;
    const roleKeys = new Set(['supplier_name', t.date_field_key, t.ref_field_key || 'reference_number', 'title'].filter(Boolean));
    const customs = t.fields.filter((f) => f && f.key && !roleKeys.has(f.key));
    if (!customs.length) return;
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginTop: '14px' } });
    for (const f of customs) {
      const ty = String(f.type || 'text');
      const input = ty === 'date' ? el('input', { className: 'qf-in', type: 'date' })
        : (ty === 'longtext' || ty === 'textarea' || ty === 'multiline')
          ? el('textarea', { className: 'qf-in', rows: 2, placeholder: f.required ? '' : 'Optional', style: { resize: 'vertical' } })
          : el('input', { className: 'qf-in', type: ty === 'number' ? 'number' : 'text', placeholder: f.required ? '' : 'Optional' });
      customInputs[f.key] = input;
      grid.appendChild(el('div', {}, [el('label', { className: 'qf-lbl' }, f.label || f.key), input]));
    }
    customBox.appendChild(grid);
  }

  // ── S4b: auto-fill typeahead on the bound Records list's TRIGGER field ────────────────────────────
  let _typeaheadCleanup = null;
  const _toInputDate = (v) => {
    const s = String(v || '').trim();
    let m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);        // DD-MM-YYYY → yyyy-mm-dd for <input type=date>
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  };
  function _detachTypeahead() { if (_typeaheadCleanup) { try { _typeaheadCleanup(); } catch {} _typeaheadCleanup = null; } }
  function _triggerInputFor(fieldKey, t) {
    if (!fieldKey) return null;
    if (fieldKey === 'supplier_name') return partyI;
    if (t && fieldKey === t.date_field_key) return dateI;
    if (t && fieldKey === (t.ref_field_key || 'reference_number')) return refI;
    return customInputs[fieldKey] || null;
  }
  function _fillFromRecord(fields, t) {
    for (const key in fields) {
      const input = _triggerInputFor(key, t);
      if (!input) continue;
      const val = fields[key];
      input.value = (input.type === 'date') ? _toInputDate(val) : String(val);
      input.style.transition = 'background .1s'; input.style.background = 'var(--accent-bg)';
      setTimeout(() => { try { input.style.background = ''; } catch {} }, 900);
    }
  }
  async function refreshTypeahead() {
    _detachTypeahead();
    if (!(D.lookup && D.lookup.typeBinding)) return;
    const tv = typeSelect && typeSelect.value;
    if (!tv || tv.indexOf('new:') === 0) return;
    const typeId = Number(tv);
    let b; try { b = await D.lookup.typeBinding(typeId); } catch { b = null; }
    if (!b || !b.ok || !b.bound || !b.triggerFieldKey) return;
    const t = installedTypes.find((x) => String(x.id) === String(typeId));
    const input = _triggerInputFor(b.triggerFieldKey, t);
    if (!input || !input.parentNode) return;
    _typeaheadCleanup = _wireSuggest(input, typeId, b, (r) => _fillFromRecord(r.fields, t));
  }

  // Shared Records-list suggest wiring: a token-prefix dropdown under `input`; on pick it resolves the record
  // and hands the result to onPick(r). Used by BOTH the shared form (refreshTypeahead) and the multi-doc per-doc
  // form (Chris follow-up 2026-09-22). Returns a cleanup fn.
  function _wireSuggest(input, typeId, b, onPick) {
    // A dropdown positioned under the trigger input (its wrapper is made position:relative).
    input.parentNode.style.position = 'relative';
    const dd = el('div', { style: { position: 'absolute', left: '0', right: '0', top: '100%', zIndex: '40',
      background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-sm)', marginTop: '2px',
      maxHeight: '220px', overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)', display: 'none' } });
    input.parentNode.appendChild(dd);
    let timer = null, reqId = 0;
    const hide = () => { dd.style.display = 'none'; dd.textContent = ''; };
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 3) { hide(); return; }
      const my = ++reqId;
      let res; try { res = await D.lookup.suggest({ documentTypeId: typeId, query: q, limit: 8 }); } catch { res = null; }
      if (my !== reqId) return;                         // drop a late response (monotonic guard)
      if (!res || !res.ok || !res.rows || !res.rows.length) { hide(); return; }
      dd.textContent = '';
      for (const row of res.rows) {
        // F5 (Chris 2026-09-21): a distinguishing detail beside the name. Prefer the list's disambiguator; else
        // the record's own disambiguator; else FALL BACK to the record's first other non-empty field (generic —
        // any record type) so two same-named subjects (two "Ava") are still tellable apart.
        const sub = (b.list && b.list.disambiguator_key && row.values && row.values[b.list.disambiguator_key])
          ? row.values[b.list.disambiguator_key]
          : (row.disambiguator || (() => {
              const mk = b.list && b.list.master_key;
              for (const k in (row.values || {})) { if (k === mk) continue; const v = row.values[k]; if (v != null && String(v).trim() !== '') return String(v); }
              return '';
            })());
        const item = el('div', { style: { padding: '7px 11px', cursor: 'pointer', fontSize: '13px', borderTop: '1px solid var(--border)' } },
          [el('span', {}, row.master_value), sub ? el('span', { style: { color: 'var(--muted)', marginLeft: '8px', fontSize: '12px' } }, '· ' + sub) : null]);
        item.addEventListener('mousedown', async (ev) => {
          ev.preventDefault();                          // keep focus / fire before blur
          hide();
          let r; try { r = await D.lookup.resolve({ documentTypeId: typeId, recordId: row.id }); } catch { r = null; }
          if (r && r.ok && r.fields) onPick(r);
        });
        dd.appendChild(item);
      }
      if (res.total > res.rows.length) dd.appendChild(el('div', { style: { padding: '6px 11px', fontSize: '12px', color: 'var(--muted)', borderTop: '1px solid var(--border)' } }, `+${res.total - res.rows.length} more — keep typing`));
      dd.style.display = 'block';
    };
    const onInput = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
    const onBlur = () => setTimeout(hide, 150);          // allow a click to land first
    input.addEventListener('input', onInput);
    input.addEventListener('blur', onBlur);
    return () => { clearTimeout(timer); input.removeEventListener('input', onInput); input.removeEventListener('blur', onBlur); try { dd.remove(); } catch {} };
  }

  // Fill a resolved record's fields into a STAGED entry's own values (multi-doc per-doc form). Mirrors
  // _fillFromRecord but writes f.values (party/date/reference/customFields) instead of the shared inputs.
  function _fillRecordIntoValues(fields, f, t) {
    if (!f.values) f.values = { customFields: {} };
    if (!f.values.customFields) f.values.customFields = {};
    for (const key in fields) {
      const val = fields[key];
      if (key === 'supplier_name') f.values.party = String(val);
      else if (t && key === t.date_field_key) f.values.date = _toInputDate(val);
      else if (t && key === ((t.ref_field_key) || 'reference_number')) f.values.reference = String(val);
      else f.values.customFields[key] = String(val);
    }
  }

  function renderFiles() {
    filesBox.textContent = '';
    const multi = multiDocEnabled && staged.length > 1;
    // Multi-doc takes over the whole pane (Review-style: files left · preview centre · fields right), so the
    // default drop card + shared form step aside (owner 2026-09-22).
    if (_singleArea) _singleArea.style.display = multi ? 'none' : '';
    filesBox.style.maxHeight = multi ? '' : '200px';
    filesBox.style.overflowY = multi ? '' : 'auto';
    if (!staged.length) { filesBox.appendChild(el('div', { className: 'muted', style: { fontSize: '13px', color: 'var(--muted)' } }, 'No files chosen yet.')); return; }
    if (multi) { renderMultiDoc(); return; }   // S4a: per-doc entry + preview
    for (const f of staged) {
      const row = el('div', { className: 'qf-filerow' });
      row.appendChild(_svgIco('i-check', 15));
      row.appendChild(el('span', { style: { flex: '0 0 34%', fontSize: '12px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.name));
      f.titleInput = el('input', { className: 'qf-in', type: 'text', value: stem(f.name), placeholder: 'Title', style: { flex: '1' } });
      row.appendChild(f.titleInput);
      const rm = el('button', { className: 'btn-mini', type: 'button', title: 'Remove' }, '×');
      rm.addEventListener('click', () => { staged = staged.filter((x) => x !== f); renderFiles(); });
      row.appendChild(rm);
      filesBox.appendChild(row);
    }
  }

  // ── S4a: multi-document master-detail (filmstrip + focused preview + per-doc form) ───────────────
  // Behind quickfile_multidoc_enabled + >1 files (Oracle FLAG1). Single-file/flag-off path is untouched.
  // Each staged entry OWNS its values; inputs close over the entry (Oracle MC1 — never a mutable index).
  const _roleKeysOf = (t) => new Set(['supplier_name', t && t.date_field_key, (t && t.ref_field_key) || 'reference_number', 'title'].filter(Boolean));
  const _customFieldsOf = (t) => { if (!t || !Array.isArray(t.fields)) return []; const rk = _roleKeysOf(t); return t.fields.filter((f) => f && f.key && !rk.has(f.key)); };
  function _gatherSharedCustom() { const o = {}; for (const k in customInputs) { const v = customInputs[k] && customInputs[k].value; if (v != null && String(v).trim() !== '') o[k] = String(v).trim(); } return o; }
  function currentShared() { return { party: partyI.value.trim(), date: dateI.value || '', reference: refI.value.trim(), notes: notesI.value.trim(), customFields: _gatherSharedCustom() }; }
  function _ensureValues() { for (const f of staged) { if (!f.values) f.values = { customFields: {} }; if (!f.values.customFields) f.values.customFields = {}; if (f.values.title == null) f.values.title = stem(f.name); } }
  function _selectedType() { const tv = typeSelect && typeSelect.value; if (!tv || tv.indexOf('new:') === 0) return null; return installedTypes.find((x) => String(x.id) === String(tv)) || null; }

  // F6 (2026-09-22): the record FOLDER KEY for the selected type — resolved exactly as the backend
  // resolveRecordFolderKey does (folder_key_field → bound-list master mapping → 'supplier_name'), so the
  // multi-doc "ready" dot lights green ⟺ the doc files to a real <Type>/<Key>/ folder (amber ⟺ Unfiled).
  let _recordKey = null;   // { keyField, dateKey, refKey, label }
  function _labelForKey(t, key) {
    if (!key || key === 'supplier_name') return 'a company or person';
    const f = (t && Array.isArray(t.fields)) ? t.fields.find((x) => x && x.key === key) : null;
    return (f && (f.label || f.key)) || key;
  }
  async function _resolveRecordKey() {
    _recordKey = null;
    const t = _selectedType();
    if (!t) return;
    let keyField = (t.folder_key_field && String(t.folder_key_field)) || null;
    if (!keyField && D.lookup && D.lookup.typeBinding) {
      try { const b = await D.lookup.typeBinding(t.id); if (b && b.ok && b.bound && b.triggerFieldKey) keyField = b.triggerFieldKey; } catch {}
    }
    keyField = keyField || 'supplier_name';
    _recordKey = { keyField, dateKey: t.date_field_key || null, refKey: t.ref_field_key || 'reference_number', label: _labelForKey(t, keyField) };
    if (multiDocEnabled && staged.length > 1) renderFiles();   // repaint the dots with the resolved key
  }

  async function _loadPreview(f, imgHost) {
    let pv = _previewCache.get(f.token);
    if (!pv) { try { pv = await D.quickFilePreview(f.token); } catch { pv = { ok: true, renderable: false }; } if (pv && pv.ok) _previewCache.set(f.token, pv); }
    if (!staged.includes(f)) return;                       // dropped while we awaited — drop a late render (Oracle lifecycle)
    imgHost.textContent = '';
    if (pv && pv.renderable && pv.dataUrl) {
      imgHost.appendChild(el('img', { src: pv.dataUrl, alt: '', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' } }));
    } else {
      imgHost.appendChild(_svgIco('i-book', 26));
      imgHost.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--muted)', marginTop: '4px', wordBreak: 'break-all' } }, (pv && pv.kind && pv.kind !== 'expired') ? String(pv.kind).replace('.', '').toUpperCase() : ''));
    }
  }

  function renderMultiDoc() {
    _ensureValues();
    if (_qfFocusedIdx >= staged.length) _qfFocusedIdx = staged.length - 1;
    if (_qfFocusedIdx < 0) _qfFocusedIdx = 0;
    const QF = window.quickfileMeta;
    const shared = currentShared();
    // Review-style 3-column master/detail (owner 2026-09-22): file list · preview · per-doc fields, filling the
    // pane — the default drop card + shared form are hidden by renderFiles.
    const COLH = 'min(72vh, 660px)';
    const wrap = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'stretch', marginTop: '4px' } });
    const strip = el('div', { style: { flex: '0 0 220px', height: COLH, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });
    const centre = el('div', { style: { flex: '1', minWidth: '260px', display: 'flex', flexDirection: 'column' } });
    const right = el('div', { style: { flex: '0 0 360px', height: COLH, overflowY: 'auto', paddingRight: '2px' } });
    wrap.appendChild(strip); wrap.appendChild(centre); wrap.appendChild(right);
    filesBox.appendChild(wrap);

    staged.forEach((f, i) => {
      const ready = QF ? QF.isReady(QF.withDefaults(f, shared), _recordKey || undefined) : true;
      const needLabel = (_recordKey && _recordKey.label) || 'a company or person';
      const cell = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '6px', cursor: 'pointer', flex: '0 0 auto',
        border: i === _qfFocusedIdx ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' } });
      const thumb = el('div', { style: { flex: '0 0 40px', height: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', overflow: 'hidden' } });
      cell.appendChild(thumb);
      cell.appendChild(el('span', { style: { flex: '1', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.values.title || f.name));
      cell.appendChild(el('span', { title: ready ? 'Ready to file' : `Needs ${needLabel} — files under “Unfiled” until set`, style: { flex: '0 0 auto', width: '9px', height: '9px', borderRadius: '50%', background: f.filed ? 'var(--muted)' : (ready ? 'var(--ok)' : 'var(--warn)') } }));
      const rm = el('button', { className: 'btn-mini', type: 'button', title: 'Remove' }, '×');
      rm.addEventListener('click', (e) => { e.stopPropagation(); staged = staged.filter((x) => x !== f); _previewCache.delete(f.token); renderFiles(); });
      cell.appendChild(rm);
      cell.addEventListener('click', () => { _qfFocusedIdx = i; renderFiles(); });
      strip.appendChild(cell);
      _loadPreview(f, thumb);
    });
    const addBtn = el('button', { className: 'btn', type: 'button', style: { flex: '0 0 auto', marginTop: '2px', fontSize: '12px' } }, '+ Add files');
    addBtn.addEventListener('click', () => doPick());
    strip.appendChild(addBtn);

    // CENTRE — the zoom/pan preview fills the column.
    const prev = el('div', { style: { position: 'relative', flex: '1', minHeight: '320px', overflow: 'hidden', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' } });
    centre.appendChild(prev);
    centre.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--muted)', margin: '6px 0 0' } }, 'Scroll to zoom · right-drag to pan · or use the buttons'));
    _mountPreviewViewer(prev, staged[_qfFocusedIdx]);

    // RIGHT — the focused document's own fields.
    _renderFocusedForm(right, staged[_qfFocusedIdx], shared);
  }

  // Zoom/pan document viewer for the focused staged file (owner 2026-09-22). Scroll = zoom, right-drag = pan
  // (the Review/Search model). Listeners live on the viewer element so a re-render (renderFiles) GCs them —
  // no window-level leak. Non-renderable (office/email/gone) → an icon card.
  async function _mountPreviewViewer(wrap, f) {
    wrap.replaceChildren();
    let pv = _previewCache.get(f.token);
    if (!pv) { try { pv = await D.quickFilePreview(f.token); } catch { pv = { ok: true, renderable: false }; } if (pv && pv.ok) _previewCache.set(f.token, pv); }
    if (!pv || !pv.renderable || !pv.dataUrl) {
      const card = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' } });
      card.appendChild(_svgIco('i-book', 32));
      card.appendChild(el('div', { style: { fontSize: '12px', marginTop: '6px', wordBreak: 'break-all' } }, (pv && pv.kind && pv.kind !== 'expired') ? String(pv.kind).replace('.', '').toUpperCase() : 'No preview'));
      wrap.appendChild(card);
      return;
    }
    // A scroll pane (fills the wrapper) holds the image; the zoom controls sit ABOVE it, pinned top-right, so
    // they don't scroll with the page (matches the Review/Search viewers).
    const scroll = el('div', { style: { position: 'absolute', inset: '0', overflow: 'auto', cursor: 'grab' } });
    const img = el('img', { src: pv.dataUrl, alt: '', style: { display: 'block', width: '100%', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' } });
    scroll.appendChild(img);
    wrap.appendChild(scroll);

    let zoom = 1;
    const setZoom = (z) => { zoom = Math.min(6, Math.max(0.4, z)); img.style.width = (zoom * 100) + '%'; };
    const zbtn = (label, title, fn) => {
      const b = el('button', { className: 'btn', type: 'button', title, style: { padding: '2px 0', width: '30px', fontSize: '16px', lineHeight: '1.1' } }, label);
      b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
      return b;
    };
    const controls = el('div', { style: { position: 'absolute', top: '8px', right: '8px', zIndex: '5', display: 'flex', gap: '4px',
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '3px', boxShadow: '0 2px 8px rgba(0,0,0,.14)' } });
    controls.appendChild(zbtn('−', 'Zoom out', () => setZoom(zoom / 1.25)));
    controls.appendChild(zbtn('⤢', 'Fit', () => { setZoom(1); scroll.scrollTop = 0; scroll.scrollLeft = 0; }));
    controls.appendChild(zbtn('+', 'Zoom in', () => setZoom(zoom * 1.25)));
    wrap.appendChild(controls);

    scroll.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
    scroll.addEventListener('contextmenu', (e) => e.preventDefault());
    scroll.addEventListener('mousedown', (e) => { if (e.button !== 2) return; e.preventDefault(); panning = true; sx = e.clientX; sy = e.clientY; sl = scroll.scrollLeft; st = scroll.scrollTop; scroll.style.cursor = 'grabbing'; });
    scroll.addEventListener('mousemove', (e) => { if (!panning) return; scroll.scrollLeft = sl - (e.clientX - sx); scroll.scrollTop = st - (e.clientY - sy); });
    const endPan = () => { if (panning) { panning = false; scroll.style.cursor = 'grab'; } };
    scroll.addEventListener('mouseup', endPan);
    scroll.addEventListener('mouseleave', endPan);
  }

  // The focused document's per-doc fields (the RIGHT column of the multi-doc pane). Inputs close over THIS
  // entry `f` (MC1). Single-column stack to suit a narrow side column. Placeholder shows the shared default.
  function _renderFocusedForm(host, f, shared) {
    if (!f) return;
    const t = _selectedType();
    host.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.values.title || f.name));
    const mk = (labelText, input) => el('div', { style: { marginBottom: '12px' } }, [el('label', { className: 'qf-lbl' }, labelText), input]);
    const bind = (input, key) => { input.addEventListener('input', () => { f.values[key] = input.value; }); return input; };
    const party = bind(el('input', { className: 'qf-in', type: 'text', value: f.values.party || '', placeholder: shared.party ? `${shared.party} (shared)` : 'Company or person' }), 'party');
    const date = bind(el('input', { className: 'qf-in', type: 'date', value: f.values.date || '' }), 'date');
    const ref = bind(el('input', { className: 'qf-in', type: 'text', value: f.values.reference || '', placeholder: shared.reference ? `${shared.reference} (shared)` : 'Optional' }), 'reference');
    const title = bind(el('input', { className: 'qf-in', type: 'text', value: f.values.title || stem(f.name), placeholder: 'Title' }), 'title');
    // Map role/custom field keys → the per-doc input, so the Records-list typeahead can find THIS doc's trigger.
    const _trigMap = { supplier_name: party };
    if (t && t.date_field_key) _trigMap[t.date_field_key] = date;
    _trigMap[(t && t.ref_field_key) || 'reference_number'] = ref;
    host.appendChild(mk('Company / Person', party));
    host.appendChild(mk('Date', date));
    host.appendChild(mk('Reference', ref));
    host.appendChild(mk('Title', title));
    // Per-doc custom fields (bound into f.values.customFields).
    const customs = _customFieldsOf(t);
    if (customs.length) {
      const cg = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginTop: '4px' } });
      for (const cf of customs) {
        const ty = String(cf.type || 'text');
        const inp = (ty === 'date') ? el('input', { className: 'qf-in', type: 'date', value: f.values.customFields[cf.key] || '' })
          : (ty === 'longtext' || ty === 'textarea' || ty === 'multiline') ? el('textarea', { className: 'qf-in', rows: 2, style: { resize: 'vertical' } })
            : el('input', { className: 'qf-in', type: ty === 'number' ? 'number' : 'text', value: f.values.customFields[cf.key] || '' });
        if (inp.tagName === 'TEXTAREA') inp.value = f.values.customFields[cf.key] || '';
        inp.addEventListener('input', () => { f.values.customFields[cf.key] = inp.value; });
        _trigMap[cf.key] = inp;
        cg.appendChild(el('div', {}, [el('label', { className: 'qf-lbl' }, cf.label || cf.key), inp]));
      }
      host.appendChild(cg);
    }
    if (f.error) host.appendChild(el('div', { style: { color: 'var(--warn)', fontSize: '12px', marginTop: '8px' } }, f.error));
    // S4b per-doc typeahead (Chris follow-up 2026-09-22): the multi-doc per-doc form gets the same Records-list
    // auto-fill the shared form has — wired onto THIS doc's trigger input, filling f.values then repainting.
    if (D.lookup && D.lookup.typeBinding && t) {
      (async () => {
        let b; try { b = await D.lookup.typeBinding(t.id); } catch { b = null; }
        if (!b || !b.ok || !b.bound || !b.triggerFieldKey) return;
        const trig = _trigMap[b.triggerFieldKey];
        if (!trig || !trig.parentNode || !host.isConnected) return;   // doc switched while we awaited → drop
        _wireSuggest(trig, t.id, b, (r) => { _fillRecordIntoValues(r.fields, f, t); renderFiles(); });
      })();
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
    // Require the RESOLVED folder key field, not always "Company / Person" (Chris re-verify card 1; the F6
    // principle for the single/shared path): a record type keyed on a custom field (e.g. Child name) must NOT be
    // blocked by an empty company box — the folder keys on the child's name. supplier_name-keyed types unchanged.
    // Multi-doc validates per-doc in its own loop (MC3), so skip this shared gate there.
    if (!(multiDocEnabled && staged.length > 1)) {
      const QF = window.quickfileMeta;
      const keyLabel = (_recordKey && _recordKey.label) || 'a company or person';
      const entryLike = { values: { party: partyI.value.trim(), date: dateI.value || '', reference: refI.value.trim(), title: '', customFields: _gatherSharedCustom() } };
      const keyOk = QF ? !!QF.resolvedKeyValue(entryLike, _recordKey || undefined) : !!partyI.value.trim();
      if (!keyOk) {
        msg.style.color = 'var(--warn)'; msg.textContent = `Enter the ${keyLabel}.`;
        const ki = (_recordKey && _triggerInputFor(_recordKey.keyField, _selectedType())) || partyI;
        try { ki.focus(); } catch {}
        return;
      }
    }
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
        renderCustomFields(); refreshTypeahead(); _resolveRecordKey();
      } catch { msg.style.color = 'var(--warn)'; msg.textContent = 'Could not set up that type.'; reEnable(); return; }
    } else documentTypeId = Number(tv);
    // Slice 0: gather the per-type custom field values (shared across the staged files, like party/date/notes).
    const customFields = {};
    for (const k in customInputs) { const v = customInputs[k] && customInputs[k].value; if (v != null && String(v).trim() !== '') customFields[k] = String(v).trim(); }
    const shared = { documentTypeId, party: partyI.value.trim(), date: dateI.value || '', reference: refI.value.trim(), notes: notesI.value.trim(), customFields };

    // S4a: multi-doc — file each staged doc with ITS OWN values merged under the shared defaults. Each meta
    // is built by the pinned helper closing over the specific entry (MC1). MC3: keep unfiled docs on screen.
    if (multiDocEnabled && staged.length > 1) {
      const QF = window.quickfileMeta;
      const sharedVals = { party: shared.party, date: shared.date, reference: shared.reference, notes: shared.notes, customFields };
      let filedN = 0; const remain = []; let firstErr = '';
      for (const f of staged) {
        if (!f.values) f.values = { customFields: {} };
        const merged = QF.withDefaults(f, sharedVals);
        const needLabel = (_recordKey && _recordKey.label) || 'a company or person';
        if (!QF.isReady(merged, _recordKey || undefined)) { f.error = `Needs ${needLabel}`; remain.push(f); if (!firstErr) firstErr = `${f.name}: needs ${needLabel}`; continue; }
        const meta = QF.buildMeta(documentTypeId, merged);
        meta.title = (merged.values.title || '').trim() || stem(f.name);
        try {
          const r = await D.quickFileSubmit({ token: f.token, meta });
          if (r && r.ok) { filedN++; f.filed = true; _previewCache.delete(f.token); addReceipt(f.name, meta.title, r); }
          else { f.error = (r && r.error) || 'failed'; remain.push(f); if (!firstErr) firstErr = `${f.name}: ${f.error}`; }
        } catch (e) { f.error = e.message; remain.push(f); if (!firstErr) firstErr = `${f.name}: ${e.message}`; }
      }
      staged = remain; _qfFocusedIdx = 0; renderFiles();
      msg.style.color = remain.length ? 'var(--warn)' : 'var(--ok)';
      msg.textContent = `Filed ${filedN} document(s)${remain.length ? ` · ${remain.length} still need details (${firstErr})` : "; they're searchable now."}`;
      fileBtn.disabled = false; pickBtn.disabled = false;
      return;
    }

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
    _injectStyles();
    // Header — title + one-line intro, left-aligned to the content below.
    root.appendChild(el('div', { style: { marginBottom: '18px' } }, [
      el('h1', { className: 'view-title', style: { margin: '0 0 4px' } }, 'Quick File'),
      el('p', { style: { margin: 0, fontSize: '13px', color: 'var(--muted)', maxWidth: '680px', lineHeight: '1.5' } },
        'File a document that needs no scanning — Word, Excel, email or PDF. Type a few details and it goes straight into your folders, searchable a moment later. No OCR, no teaching.'),
    ]));

    // Drop / pick card (left). Accepts a DRAG-DROP (Oracle SIGN-OFF-W/COND 2026-09-13): data-intake-drop
    // scopes the preload drop resolver to THIS element; the window-level drop guard is untouched.
    const dropZone = el('div', { id: 'qf-dropzone', className: 'qf-drop', 'data-help-key': 'quick-file',
      'data-intake-drop': '', style: { flex: '0 0 300px', minWidth: '260px' } });
    dropZone.appendChild(_dropGlyph(40));   // light OUTLINE glyph (a filled sprite icon read too dark/solid)
    dropZone.appendChild(el('div', { style: { fontSize: '15px', fontWeight: '600', color: 'var(--text)' } }, 'Drag documents here'));
    dropZone.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, 'or'));
    pickBtn = el('button', { className: 'btn', type: 'button' }, 'Choose files…');
    pickBtn.addEventListener('click', doPick);
    dropZone.appendChild(pickBtn);
    dropZone.addEventListener('click', (e) => { if (e.target === dropZone) doPick(); });

    // Drag-drop. The dashed "drop here" cue shows ONLY while a real file drag is over the card. Path
    // resolution happens in the PRELOAD (webUtils.getPathForFile needs the real File — a File passed
    // from the renderer through contextBridge is a proxy and resolves to ''); the preload hands us the
    // resolved absolute paths via onQuickFileDrop, and we forward them to MAIN for Q-C10 validation. The
    // renderer never touches a File or a path. The drop event itself is preventDefaulted by the window
    // backstop (preload) AND here (cue reset) — never stopPropagation.
    const _hasFiles = (e) => { try { return Array.prototype.includes.call(e.dataTransfer.types || [], 'Files'); } catch { return false; } };
    const _drag = (on) => dropZone.classList.toggle('drag', on);
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

    typeRow = el('div', { style: { marginBottom: '14px' } });
    const mkField = (labelText, input) => el('div', {},
      [el('label', { className: 'qf-lbl' }, labelText), input]);
    partyI = el('input', { className: 'qf-in', type: 'text', placeholder: 'Company or person' });
    dateI  = el('input', { className: 'qf-in', type: 'date', value: todayIso() });
    refI   = el('input', { className: 'qf-in', type: 'text', placeholder: 'Optional' });
    notesI = el('textarea', { className: 'qf-in', rows: 3, placeholder: 'Optional — searchable', style: { resize: 'vertical' } });
    customBox = el('div', {});   // Slice 0: per-type custom fields render here on type-select
    const details = el('div', { className: 'qf-card', style: { flex: '1', minWidth: '320px' } }, [
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' } },
        [mkField('Company / Person', partyI), mkField('Date', dateI), mkField('Reference', refI), mkField('Notes', notesI)]),
      customBox,
    ]);
    // The doc-type picker ("File as") sits ABOVE the single/multi area so it stays visible in BOTH modes — the
    // whole batch shares one type, and the multi-doc pane hides _singleArea, so the type must live OUTSIDE it
    // (Chris 2026-09-22: multi-file had no way to choose the doc type).
    root.appendChild(typeRow);
    // Drop card + details share a row and stretch to equal height. In the multi-doc pane this whole area is
    // hidden and the file list / preview / per-doc fields take over (renderFiles), so the shared form never
    // sits cramped above a squeezed preview (owner 2026-09-22).
    _singleArea = el('div', { style: { display: 'flex', gap: '18px', alignItems: 'stretch', flexWrap: 'wrap' } }, [dropZone, details]);
    root.appendChild(_singleArea);

    // Staged files (single-file rows) OR the multi-doc master/detail — renderFiles decides + sizes filesBox.
    filesBox = el('div', { style: { margin: '12px 0' } });
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
    try { multiDocEnabled = String(await D.getSetting('quickfile_multidoc_enabled')) === 'true'; } catch { multiDocEnabled = false; }
    await refreshTypes();
    refreshTypeahead();
    _resolveRecordKey();
    setTimeout(() => { try { partyI && partyI.focus(); } catch {} }, 30);
  }

  window.QuickFileView = { get enabled() { return view.enabled; }, enter, refreshTypes };
})();
