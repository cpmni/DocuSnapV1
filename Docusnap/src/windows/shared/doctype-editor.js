'use strict';
/*
 * doctype-editor.js — shared, self-contained document-type editor.
 *
 * One friendly type editor used by BOTH the Settings "Document Types" tab and the
 * Teach-a-document wizard, so the create/edit UX lives in a single place. It
 * renders host-scoped (no global element IDs — safe to mount in any document),
 * injects its own stylesheet once, and takes the COMMIT POLICY from the host:
 *   - create mode: the host calls controller.commit() (immediate, e.g. Settings)
 *                  or controller.getDraft() (deferred, e.g. Teach commit step).
 *   - edit mode:   each field/role change is persisted IMMEDIATELY via the
 *                  injected api (add/update/delete-field, update-document-type).
 *                  There is no transactional "update whole type" backend, so edit
 *                  is per-field, exactly like the old Fields tab.
 *
 * Structural roles (Company=supplier_name + Date) are LOCKED here — the backend is
 * the authoritative enforcer (document_types.ensureStructuralRoles); this is the
 * single renderer-side mirror. Reference is a removable default (reference-less
 * types are intentionally allowed).
 *
 *   window.DocTypeEditor.create(host, opts) -> controller
 *     opts = {
 *       mode: 'create' | 'edit',
 *       api:  window.docusnap,            // IPC bridge (injected; no global coupling)
 *       initial: typeObject | null,       // edit: the type row {id,name,fields,...}
 *       showName: bool,                   // default: true in create, false in edit
 *       onValidityChange: (ready)=>{},    // create: drive the host's Create button
 *       onChange: ()=>{},                 // edit: a mutation persisted (host refresh)
 *     }
 *     controller = { isReady, getDraft, commit, destroy, getTypeId }
 */
(function () {
  // [value, label, tooltip] — the tooltip shows the accepted format + an example so a
  // non-technical user can tell the types apart (shown as an <option title> and as a
  // live hint line under the dropdown). Examples mirror config validation_patterns.
  const TYPE_OPTS = [
    ['text', 'Text', 'Any text — names, descriptions, free-form. No format checking.'],
    ['date', 'Date', 'A date in any common style, tidied to DD-MM-YYYY.  e.g. 12/05/2026 · 12 May 2026'],
    ['currency', 'Currency', 'A money amount.  e.g. £1,250.00 · 1250.00 GBP'],
    ['number', 'Number', 'A plain number.  e.g. 42 · 1000'],
    ['reference', 'Reference number', 'A general reference — letters and/or numbers, may include - / .  e.g. INV-001 · A12345'],
    // Supplementary structured types (flag-only — surfaced for review, never blocked).
    // Each has a matching validation_patterns key + engine _TYPE2VAL + renderer
    // validationKeyFor mirror; keep all in lockstep.
    ['email', 'Email', 'An email address.  e.g. name@company.com'],
    ['percentage', 'Percentage', 'A percentage from 0–100%.  e.g. 20% · 17.5%'],
    ['postcode_uk', 'Postcode (UK)', 'A UK postcode.  e.g. BT1 4AB · SW1A 1AA'],
    ['vat_gb', 'VAT number (GB)', 'A UK VAT registration number.  e.g. GB123456789 · 123 4567 89'],
    ['reference_code', 'Reference code', 'Letters and numbers, MUST include at least one digit (may use - / .).  e.g. ABC12345 · PO-2026-014'],
    ['iban', 'IBAN', 'An international bank account number.  e.g. GB29NWBK60161331926819'],
    ['website', 'Website', 'A web address.  e.g. www.company.com · https://company.com'],
    ['mac_address', 'MAC address', 'A hardware (MAC) address — accepts colons.  e.g. D4:F0:C9:25:9B:64'],
    ['ip_address', 'IP address', 'An IP address (IPv4 or IPv6) — accepts dots/colons.  e.g. 192.168.1.200 · fe80::1'],
  ];
  const TYPE_TIP = Object.fromEntries(TYPE_OPTS.map(([v, , t]) => [v, t || '']));
  const tipFor = (v) => TYPE_TIP[v] || '';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Field key = a stable identifier (lowercase, underscores). Mirrors the keySlug
  // used by the old add-field form so a hand-typed key style is preserved.
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const guessType = (label) => /date/i.test(label) ? 'date'
    : (/total|amount|price|cost|sum|net|gross|vat|tax/i.test(label) ? 'currency' : 'text');

  function injectStyles() {
    if (document.getElementById('dte-styles')) return;
    const st = document.createElement('style');
    st.id = 'dte-styles';
    st.textContent = `
      .dte { display:flex; flex-direction:column; gap:16px; }
      .dte-lbl { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); display:block; margin-bottom:8px; }
      .dte-lbl .muted { text-transform:none; letter-spacing:0; font-weight:400; }
      .dte-fields { display:flex; flex-direction:column; gap:6px; }
      .dte-row {
        display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px;
        padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface);
      }
      .dte-row.locked { background:var(--surface2); }
      /* Name + key share ONE baseline so the label doesn't ride high above its key,
         and the whole identity block centres on the same line as the right controls.
         A min-width keeps the name legible and lets the TYPE/ENABLED controls wrap to a
         second line (instead of overlapping the name) when the panel is narrow. */
      .dte-row .idn { display:flex; align-items:baseline; gap:8px; min-width:140px; }
      .dte-row .nm { font-weight:500; font-size:13px; line-height:1; }
      .dte-row .key { font-family:var(--mono); font-size:10px; color:var(--muted); line-height:1; }
      .dte-row .spacer { flex:1; min-width:8px; }
      .dte-row .lock { color:var(--muted); font-size:12px; cursor:default; align-self:center; }
      .dte-row select { min-width:128px; }
      /* Divider between a field's IDENTITY (lock+name+key) and its TYPE/behaviour
         controls, plus a tiny caption on each control so its purpose is clear at a
         glance. Caption travels WITH its control, so it stays correct on ragged rows
         (toggle present/absent) and in create mode (no toggle). */
      .dte-row .col-div { width:1px; align-self:stretch; background:var(--border2); margin:-8px 2px -8px 0; flex:0 0 auto; }
      .dte-row .grp { display:flex; align-items:center; gap:6px; }
      .dte-row .ctl-cap { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); user-select:none; white-space:nowrap; }
      /* Remove-button slot is RESERVED on every row (placeholder when not removable) so
         the divider + Type column line up uniformly across locked and editable rows. */
      .dte-row .x, .dte-row .x-slot { flex:0 0 auto; width:20px; text-align:center; }
      .dte-row .x { cursor:pointer; color:var(--muted); font-weight:700; user-select:none; }
      .dte-row .x:hover { color:var(--err); }
      .dte-addrow { display:flex; gap:8px; margin-top:8px; }
      .dte-addrow input { flex:1; min-width:0; }
      .dte-roles { display:flex; gap:16px; flex-wrap:wrap; }
      .dte .form-group { display:flex; flex-direction:column; gap:5px; }
      .dte .form-group > label { font-size:11px; color:var(--muted); }
      .dte-err { color:var(--err); font-size:12px; min-height:1em; }
    `;
    document.head.appendChild(st);
  }

  function typeSelectHtml(current, disabled) {
    const opts = TYPE_OPTS.map(([v, l, t]) =>
      `<option value="${v}"${v === current ? ' selected' : ''} title="${esc(t || '')}">${l}</option>`).join('');
    return `<select class="field-select dte-type"${disabled ? ' disabled' : ''} title="${esc(tipFor(current))}">${opts}</select>`;
  }

  function create(host, opts) {
    opts = opts || {};
    const api  = opts.api || window.docusnap;
    const mode = opts.mode === 'edit' ? 'edit' : 'create';
    const showName = opts.showName != null ? opts.showName : (mode === 'create');

    let type = opts.initial || null;   // edit: live type row (kept fresh after mutations)
    let committing = false;
    let destroyed  = false;

    // create-mode draft state
    let name = '';
    let fields = [];                   // [{label, key?, type, locked?}]
    let refKey = '';
    let dateKey = '';

    injectStyles();
    if (mode === 'create') seedCreate();

    function seedCreate() {
      fields = [
        { label: 'Company', key: 'supplier_name', type: 'text', locked: true },
        { label: 'Reference number', type: 'text' },
        { label: 'Date', type: 'date', locked: true },
      ];
      const g = (re) => { const m = fields.find(f => re.test(f.label) || re.test(f.key || '')); return m ? (m.key || slugify(m.label)) : ''; };
      refKey  = g(/number|no\b|ref|invoice|order/i) || '';
      const dF = fields.find(f => f.type === 'date');
      dateKey = g(/date/i) || (dF ? (dF.key || slugify(dF.label)) : '');
    }

    const currentFields = () => (mode === 'create' ? fields : (type.fields || []));

    function isReady() {
      if (mode !== 'create') return true;
      return !!name.trim() && fields.length >= 1;
    }
    function emitValidity() { if (opts.onValidityChange) opts.onValidityChange(isReady()); }
    function showErr(msg) { const el = host.querySelector('.dte-err'); if (el) el.textContent = msg || ''; }

    function fieldRowHtml(f, i) {
      const editing  = mode === 'edit';
      const locked   = editing ? (f.is_structural === 1) : !!f.locked;
      const isBuiltin = editing && f.built_in === 1;
      const removable = !locked && !isBuiltin;          // create: any non-locked; edit: custom only
      const key      = f.key || slugify(f.label);
      const enabled  = f.enabled !== 0;
      return `
        <div class="dte-row${locked ? ' locked' : ''}" data-i="${i}"${editing ? ` data-fid="${f.id}"` : ''}>
          ${locked ? '<span class="lock" title="Required field - cannot be removed or retyped">&#128274;</span>' : ''}
          <span class="idn"><span class="nm">${esc(f.label)}</span>${editing ? `<span class="key">${esc(key)}</span>` : ''}</span>
          <span class="spacer"></span>
          <span class="col-div" aria-hidden="true"></span>
          <span class="grp">
            <span class="ctl-cap" title="The kind of data this field holds">Type</span>
            ${typeSelectHtml(f.type || 'text', locked)}
          </span>
          ${editing ? `<span class="grp">
            <span class="ctl-cap" title="${locked ? 'Required field - always on' : 'Whether this field is used when filing'}">Enabled</span>
            <label class="toggle" title="${locked ? 'Required field - always on' : 'Enable or disable this field'}">
              <input type="checkbox" class="dte-en"${enabled ? ' checked' : ''}${locked ? ' disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </span>` : ''}
          ${removable ? '<span class="x" title="Remove field">&#10005;</span>' : '<span class="x-slot" aria-hidden="true"></span>'}
        </div>`;
    }

    function roleOptionsHtml() {
      return '<option value="">&mdash; none &mdash;</option>' + currentFields().map(f => {
        const k = f.key || slugify(f.label);
        return `<option value="${esc(k)}">${esc(f.label)}</option>`;
      }).join('');
    }

    function render() {
      if (destroyed) return;
      const curRef  = mode === 'create' ? refKey  : (type.ref_field_key  || '');
      const curDate = mode === 'create' ? dateKey : (type.date_field_key || '');

      host.innerHTML = `
        <div class="dte">
          ${showName ? `
            <div>
              <label class="dte-lbl">Document type name</label>
              <input type="text" class="field-select dte-name" placeholder="e.g. Delivery Note" autocomplete="off" value="${esc(name)}">
            </div>` : ''}
          <div>
            <label class="dte-lbl">Fields${mode === 'create' ? ' <span class="muted">&mdash; what details should Scan Finder pull out?</span>' : ''}</label>
            <div class="dte-fields">${currentFields().map(fieldRowHtml).join('')}</div>
            <div class="dte-addrow">
              <input type="text" class="field-select dte-add-input" placeholder="Add a field, e.g. Order Number" autocomplete="off">
              <button class="btn dte-add-btn">+ Add field</button>
            </div>
          </div>
          <div>
            <label class="dte-lbl">Filing roles</label>
            <div class="dte-roles">
              <div class="form-group">
                <label>&#9733; Main number${mode === 'create' ? ' <span class="muted">(the invoice / order number)</span>' : ''}</label>
                <select class="field-select dte-ref">${roleOptionsHtml()}</select>
              </div>
              <div class="form-group">
                <label>&#128197; Date</label>
                <select class="field-select dte-date">${roleOptionsHtml()}</select>
              </div>
            </div>
          </div>
          <div class="dte-err"></div>
        </div>`;

      host.querySelector('.dte-ref').value  = curRef;
      host.querySelector('.dte-date').value = curDate;
      wire();
      emitValidity();
    }

    // Re-fetch this type after an edit mutation so local state + UI stay truthful,
    // then notify the host (left list field counts / enabled state).
    async function reload() {
      try {
        const all = await api.getAllDocTypesAll();
        const fresh = all.find(t => t.id === type.id);
        if (fresh) type = fresh;
      } catch (e) { /* keep last-known state */ }
      render();
      if (opts.onChange) opts.onChange();
    }

    function wire() {
      const nameEl = host.querySelector('.dte-name');
      if (nameEl) nameEl.addEventListener('input', () => { name = nameEl.value; emitValidity(); });

      // Per-row type / enable / remove
      host.querySelectorAll('.dte-row').forEach((row) => {
        const i = Number(row.dataset.i);
        const fid = row.dataset.fid ? Number(row.dataset.fid) : null;
        const typeSel = row.querySelector('.dte-type');
        if (typeSel && !typeSel.disabled) {
          typeSel.addEventListener('change', async () => {
            typeSel.title = tipFor(typeSel.value);   // keep the closed-select tooltip in sync
            if (mode === 'create') { fields[i].type = typeSel.value; }
            else {
              try { await api.updateField(fid, { type: typeSel.value }); type.fields[i].type = typeSel.value; if (opts.onChange) opts.onChange(); }
              catch (e) { showErr('Could not change type: ' + e.message); }
            }
          });
        }
        const enCb = row.querySelector('.dte-en');
        if (enCb && !enCb.disabled) {
          enCb.addEventListener('change', async () => {
            try { await api.updateField(fid, { enabled: enCb.checked ? 1 : 0 }); type.fields[i].enabled = enCb.checked ? 1 : 0; if (opts.onChange) opts.onChange(); }
            catch (e) { showErr('Could not change field: ' + e.message); enCb.checked = !enCb.checked; }
          });
        }
        const x = row.querySelector('.x');
        if (x) {
          x.addEventListener('click', async () => {
            if (mode === 'create') { fields.splice(i, 1); render(); return; }
            if (!confirm('Delete this custom field? This cannot be undone.')) return;
            try { await api.deleteField(fid); await reload(); }
            catch (e) { showErr('Could not delete field: ' + e.message); }
          });
        }
      });

      // Add field
      const addInput = host.querySelector('.dte-add-input');
      const addBtn   = host.querySelector('.dte-add-btn');
      const doAdd = async () => {
        const label = (addInput.value || '').trim();
        if (!label) return;
        const ftype = guessType(label);
        if (mode === 'create') {
          fields.push({ label, type: ftype });
          render();
          host.querySelector('.dte-add-input').focus();
        } else {
          const key = slugify(label);
          if (!key) { showErr('Please enter a field label.'); return; }
          try { await api.addField({ document_type_id: type.id, key, label, type: ftype }); await reload(); }
          catch (e) { showErr('Could not add field: ' + e.message); }
        }
      };
      if (addBtn)   addBtn.addEventListener('click', doAdd);
      if (addInput) addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

      // Filing roles
      const refSel  = host.querySelector('.dte-ref');
      const dateSel = host.querySelector('.dte-date');
      refSel.addEventListener('change', async () => {
        if (mode === 'create') { refKey = refSel.value; return; }
        try { await api.updateDocumentType(type.id, { ref_field_key: refSel.value || null }); type.ref_field_key = refSel.value || null; if (opts.onChange) opts.onChange(); }
        catch (e) { showErr('Could not set main number: ' + e.message); }
      });
      dateSel.addEventListener('change', async () => {
        if (mode === 'create') { dateKey = dateSel.value; return; }
        try { await api.updateDocumentType(type.id, { date_field_key: dateSel.value || null }); type.date_field_key = dateSel.value || null; if (opts.onChange) opts.onChange(); }
        catch (e) { showErr('Could not set date: ' + e.message); }
      });
    }

    function getDraft() {
      return {
        name: name.trim(),
        fields: fields.map(f => ({ key: f.key || slugify(f.label), label: f.label, type: f.type })),
        ref_field_key: refKey || null,
        date_field_key: dateKey || null,
      };
    }

    async function commit() {
      if (mode !== 'create') return { success: false, error: 'not in create mode' };
      if (committing) return { success: false, error: 'busy' };
      if (!isReady()) { showErr('Enter a name and at least one field.'); return { success: false, error: 'incomplete' }; }
      committing = true;
      showErr('');
      try {
        const res = await api.createDocTypeWithFields(getDraft());
        if (!res || !res.success) showErr((res && res.error) || 'Could not create the type.');
        return res || { success: false };
      } catch (e) {
        showErr('Error: ' + e.message);
        return { success: false, error: e.message };
      } finally {
        committing = false;
      }
    }

    function destroy() { destroyed = true; if (host) host.innerHTML = ''; }

    render();

    return {
      isReady,
      getDraft,
      commit,
      destroy,
      getTypeId: () => (type ? type.id : null),
    };
  }

  window.DocTypeEditor = { create };
})();
