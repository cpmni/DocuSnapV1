'use strict';
/*
 * lookupAdmin.js — the Settings UI for Quick File RECORDS LISTS (auto-fill lookup). Self-contained so it
 * doesn't bloat settings/renderer.js; rendered into #dt-lookup-host in the Document-Types detail pane for a
 * Quick File-capable type only. Handles: the enable toggle (lookup_lists_enabled), binding a list to the
 * type's fields (field map), records add/list/delete, and CSV/XLSX import (pick → column-map → commit).
 * DARK: when lookup_lists_enabled is off it shows only a "Turn on" button; the backend gates every call too.
 * CSP-safe: createElement + textContent + addEventListener only, never innerHTML of user data.
 */
(function () {
  const D = window.docusnap;
  const L = D && D.lookup;
  if (!L) { window.LookupAdmin = { render() {} }; return; }

  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const k in props) { if (k === 'style') Object.assign(n.style, props[k]); else if (k in n) n[k] = props[k]; else n.setAttribute(k, props[k]); }
    for (const c of [].concat(kids)) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };
  const small = (t, extra) => el('div', { className: 'field-label-small', style: Object.assign({ color: 'var(--muted)' }, extra || {}) }, t);
  const labelForKey = (key, list) => { const c = (list.columns || []).find(x => x.key === key); return (c && c.label) || key; };

  let currentType = null;

  async function render(type) {
    currentType = type;
    const host = document.getElementById('dt-lookup-host');
    if (!host) return;
    host.textContent = '';
    let en; try { en = await L.enabled(); } catch { en = null; }
    const enabled = !!(en && en.ok && en.enabled);
    const card = el('div', { style: { marginTop: '16px', padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--surface2)' } });
    card.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Auto-fill from a Records list'));
    card.appendChild(small('Keep a list of the people, customers, vehicles or other subjects you file about. When someone types the first few letters, the rest of the details fill in automatically.', { marginBottom: '10px' }));
    if (!enabled) {
      const btn = el('button', { className: 'btn', type: 'button' }, 'Turn on Records lists');
      btn.addEventListener('click', async () => { try { await D.setSetting('lookup_lists_enabled', 'true'); } catch {} render(currentType); });
      card.appendChild(btn);
      host.appendChild(card);
      return;
    }
    await renderBinding(card, type);
    host.appendChild(card);
  }

  async function renderBinding(card, type) {
    let lists = [], maps = [], boundListId = null;
    try { const r = await L.lists(); if (r.ok) lists = r.lists; } catch {}
    try { const r = await L.fieldMapsGet(type.id); if (r.ok) { maps = r.maps || []; boundListId = r.listId; } } catch {}

    const row = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } });
    row.appendChild(el('label', { className: 'field-label-small' }, 'Use list:'));
    const sel = el('select', { className: 'input', style: { maxWidth: '260px' } });
    sel.appendChild(el('option', { value: '' }, '— none —'));
    for (const l of lists) sel.appendChild(el('option', { value: String(l.id) }, `${l.name} (${l.record_count} record${l.record_count === 1 ? '' : 's'})`));
    sel.appendChild(el('option', { value: 'new' }, '+ Create a list from this type…'));
    if (boundListId) sel.value = String(boundListId);
    row.appendChild(sel);
    card.appendChild(row);

    const mapHost = el('div', {}); card.appendChild(mapHost);
    const recHost = el('div', { style: { marginTop: '12px' } }); card.appendChild(recHost);

    const drawMaps = (listId) => {
      mapHost.textContent = '';
      const list = lists.find(l => String(l.id) === String(listId));
      if (!list) return;
      mapHost.appendChild(small(`Match each field to a column from “${list.name}”. The person types into the master field (${labelForKey(list.master_key, list)}).`, { margin: '4px 0 8px' }));
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' } });
      const inputs = {};
      for (const f of (type.fields || [])) {
        const s = el('select', { className: 'input' });
        s.appendChild(el('option', { value: '' }, '— don’t fill —'));
        for (const c of (list.columns || [])) s.appendChild(el('option', { value: c.key }, c.label || c.key));
        const cur = maps.find(m => m.field_key === f.key);
        if (cur) s.value = cur.column_key;
        inputs[f.key] = s;
        grid.appendChild(el('div', {}, [el('label', { className: 'field-label-small' }, f.label || f.key), s]));
      }
      mapHost.appendChild(grid);
      const save = el('button', { className: 'btn-run', type: 'button', style: { marginTop: '10px', padding: '5px 14px', fontSize: '13px' } }, 'Save auto-fill');
      const msg = el('span', { className: 'field-label-small', style: { marginLeft: '10px', color: 'var(--muted)' } });
      save.addEventListener('click', async () => {
        const m = [];
        for (const k in inputs) { const col = inputs[k].value; if (col) m.push({ field_key: k, column_key: col }); }
        const r = await L.fieldMapsSet({ documentTypeId: type.id, listId: Number(listId), maps: m });
        msg.style.color = (r && r.ok) ? 'var(--ok)' : 'var(--err)';
        msg.textContent = (r && r.ok) ? 'Saved.' : ('Error: ' + ((r && r.error) || 'failed'));
      });
      mapHost.appendChild(el('div', {}, [save, msg]));
    };

    sel.addEventListener('change', async () => {
      if (sel.value === 'new') { await createListFromType(type); return; }   // re-renders on success
      if (!sel.value) { await L.fieldMapsSet({ documentTypeId: type.id, listId: null, maps: [] }); mapHost.textContent = ''; recHost.textContent = ''; return; }
      drawMaps(sel.value); drawRecords(recHost, Number(sel.value), lists.find(l => String(l.id) === sel.value));
    });

    if (boundListId) { drawMaps(boundListId); drawRecords(recHost, boundListId, lists.find(l => l.id === boundListId)); }
  }

  // Create a list whose columns ARE this type's fields, master = the company/person field, disambiguator =
  // the first date field. upsert key = master+disambiguator when a disambiguator exists, else NULL (so an
  // import never merges two same-named subjects). Auto-map each field to its same-key column, then re-render.
  async function createListFromType(type) {
    const fields = (type.fields || []);
    if (!fields.length) return;
    const master = fields.find(f => f.key === 'supplier_name') ? 'supplier_name' : fields[0].key;
    const dateField = fields.find(f => String(f.type) === 'date');
    const columns = fields.map(f => ({ key: f.key, label: f.label || f.key, type: f.type || 'text', is_master: f.key === master }));
    const upsert_key = dateField ? [master, dateField.key] : null;
    const cr = await L.createList({ name: `${type.name} — records`, master_key: master, columns, disambiguator_key: dateField ? dateField.key : null, upsert_key });
    if (!cr || !cr.ok) return;
    await L.fieldMapsSet({ documentTypeId: type.id, listId: cr.id, maps: fields.map(f => ({ field_key: f.key, column_key: f.key })) });
    render(currentType);
  }

  async function drawRecords(host, listId, list) {
    host.textContent = '';
    const head = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } });
    head.appendChild(el('div', { style: { fontWeight: '600', flex: '1' } }, 'Records'));
    const addBtn = el('button', { className: 'btn', type: 'button', style: { padding: '3px 10px', fontSize: '12px' } }, '+ Add');
    const impBtn = el('button', { className: 'btn', type: 'button', style: { padding: '3px 10px', fontSize: '12px' } }, 'Import CSV / Excel…');
    head.appendChild(addBtn); head.appendChild(impBtn);
    host.appendChild(head);
    const body = el('div', {}); host.appendChild(body);

    const cols = (list && list.columns) || [];
    const master = list && list.master_key;

    const reload = async () => {
      body.textContent = '';
      let recs = [], total = 0;
      try { const r = await L.records({ listId, offset: 0, limit: 100 }); if (r.ok) { recs = r.records; total = r.total; } } catch {}
      body.appendChild(small(`${total} record${total === 1 ? '' : 's'}${total > 100 ? ' (showing first 100)' : ''}`, { margin: '2px 0 6px' }));
      for (const rec of recs) {
        const line = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '3px 0', borderTop: '1px solid var(--border)' } });
        const sub = (list && list.disambiguator_key && rec.values[list.disambiguator_key]) ? ` · ${rec.values[list.disambiguator_key]}` : '';
        line.appendChild(el('span', { style: { flex: '1', fontSize: '13px' } }, `${rec.master_value}${sub}`));
        const del = el('button', { className: 'btn-mini', type: 'button', title: 'Delete record' }, '×');
        del.addEventListener('click', async () => { await L.deleteRecord(rec.id); reload(); });
        line.appendChild(del);
        body.appendChild(line);
      }
    };

    addBtn.addEventListener('click', () => {
      const form = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', margin: '8px 0', padding: '8px', background: 'var(--surface)', borderRadius: 'var(--r-sm)' } });
      const inputs = {};
      for (const c of cols) { const i = el('input', { className: 'input', type: String(c.type) === 'date' ? 'date' : 'text', placeholder: c.label || c.key }); inputs[c.key] = i; form.appendChild(el('div', {}, [el('label', { className: 'field-label-small' }, (c.label || c.key) + (c.key === master ? ' (required)' : '')), i])); }
      const save = el('button', { className: 'btn-run', type: 'button', style: { padding: '4px 12px', fontSize: '12px' } }, 'Save record');
      const msg = el('span', { className: 'field-label-small', style: { marginLeft: '8px', color: 'var(--err)' } });
      save.addEventListener('click', async () => {
        const values = {}; for (const k in inputs) if (inputs[k].value.trim()) values[k] = inputs[k].value.trim();
        const r = await L.addRecord({ listId, values });
        if (r && r.ok) { form.remove(); reload(); } else { msg.textContent = r && r.error === 'blank_master' ? `Enter the ${labelForKey(master, list)}.` : 'Could not save.'; }
      });
      form.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, [save, msg]));
      body.parentNode.insertBefore(form, body);
    });

    impBtn.addEventListener('click', () => importFlow(host, listId, list, reload));
    reload();
  }

  async function importFlow(host, listId, list, onDone) {
    let picked; try { picked = await L.importPick(); } catch { picked = null; }
    if (!picked || picked.canceled) return;
    if (!picked.ok) { alert('Could not read that file: ' + (picked.error || 'error')); return; }
    const panel = el('div', { style: { margin: '8px 0', padding: '10px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-sm)' } });
    panel.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, `Import — ${picked.rowCount} row${picked.rowCount === 1 ? '' : 's'} found`));
    panel.appendChild(small('Match each list column to a column from your file.', { marginBottom: '8px' }));
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' } });
    const colSel = {};
    const guess = (colKey, label) => { const i = picked.headers.findIndex(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '') === String(label || colKey).toLowerCase().replace(/[^a-z0-9]/g, '')); return i; };
    for (const c of (list.columns || [])) {
      const s = el('select', { className: 'input' });
      s.appendChild(el('option', { value: '' }, '— skip —'));
      picked.headers.forEach((h, i) => s.appendChild(el('option', { value: String(i) }, h || `Column ${i + 1}`)));
      const g = guess(c.key, c.label); if (g >= 0) s.value = String(g);
      colSel[c.key] = s;
      grid.appendChild(el('div', {}, [el('label', { className: 'field-label-small' }, (c.label || c.key) + (c.key === list.master_key ? ' (required)' : '')), s]));
    }
    panel.appendChild(grid);
    const modeRow = el('div', { style: { margin: '8px 0' } });
    const modeSel = el('select', { className: 'input', style: { maxWidth: '220px' } }, [el('option', { value: 'append' }, 'Add to the list'), el('option', { value: 'replace' }, 'Replace the whole list')]);
    modeRow.appendChild(el('label', { className: 'field-label-small' }, 'Mode: ')); modeRow.appendChild(modeSel);
    panel.appendChild(modeRow);
    const go = el('button', { className: 'btn-run', type: 'button', style: { padding: '5px 14px', fontSize: '13px' } }, 'Import');
    const cancel = el('button', { className: 'btn', type: 'button', style: { marginLeft: '8px', padding: '5px 12px', fontSize: '13px' } }, 'Cancel');
    const msg = el('div', { className: 'field-label-small', style: { marginTop: '6px' } });
    go.addEventListener('click', async () => {
      const columnMap = {}; for (const k in colSel) if (colSel[k].value !== '') columnMap[k] = Number(colSel[k].value);
      if (columnMap[list.master_key] == null) { msg.style.color = 'var(--err)'; msg.textContent = `Match the ${labelForKey(list.master_key, list)} column first.`; return; }
      go.disabled = true;
      const r = await L.importCommit({ token: picked.token, listId, columnMap, mode: modeSel.value });
      if (r && r.ok) {
        msg.style.color = 'var(--ok)';
        msg.textContent = `Imported: ${r.inserted} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no name)` : ''}${r.dateFlags ? `, ${r.dateFlags} with an unreadable date` : ''}${r.collisions ? `, ${r.collisions} share a name — review` : ''}.`;
        if (onDone) onDone();
        setTimeout(() => { panel.remove(); }, 2500);
      } else { go.disabled = false; msg.style.color = 'var(--err)'; msg.textContent = 'Import failed: ' + ((r && r.error) || 'error'); }
    });
    cancel.addEventListener('click', async () => { try { await L.importCancel(picked.token); } catch {} panel.remove(); });
    panel.appendChild(el('div', { style: { marginTop: '4px' } }, [go, cancel]));
    panel.appendChild(msg);
    host.appendChild(panel);
  }

  window.LookupAdmin = { render };
})();
