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
 * Structural roles (Document Issuer=supplier_name + Date) are LOCKED here — the backend is
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
  // Internal keys a CUSTOM field must never reuse — chiefly the identity field's keys
  // (and the 'company' alias the Document Issuer field is known by). A custom field whose
  // label collides with one of these, or with another field already on the type, gets a
  // 'custom_' prefix so it can't clash with the app's internal references.
  const RESERVED_KEYS = new Set(['supplier_name', 'customer_name', 'company']);
  const safeFieldKey = (label, existing = []) => {
    const base = slugify(label);
    if (!base) return base;
    const taken = new Set([...RESERVED_KEYS, ...existing]);
    let key = taken.has(base) ? 'custom_' + base : base;
    let k = key, n = 2;
    while (taken.has(k)) { k = `${key}_${n}`; n++; }
    return k;
  };
  const guessType = (label) => /date/i.test(label) ? 'date'
    : (/total|amount|price|cost|sum|net|gross|vat|tax/i.test(label) ? 'currency'
    : (/\b(ref|reference|number|no|invoice|order|po|account)\b/i.test(label) ? 'reference' : 'text'));

  // First field row whose vertical midpoint is BELOW the pointer (the drop lands before it);
  // null → drop at the end. Excludes the row being dragged. Pure DOM read (no re-render).
  function rowAfterPointer(container, y, exclude) {
    const rows = Array.prototype.slice.call(container.querySelectorAll('.dte-row')).filter(r => r !== exclude);
    for (const r of rows) {
      const box = r.getBoundingClientRect();
      if (y < box.top + box.height / 2) return r;
    }
    return null;
  }

  // Pure: assign fresh gap-of-10 sort_orders to fields in their NEW order (sort_order is an
  // INTEGER column — whole-number slots, never fractional midpoints), mutate each field's
  // sort_order, and return ONLY the rows whose value CHANGED so edit-mode persists the minimum.
  // Extracted + pin-tested (test_doctype_reorder.js).
  function planReorder(reorderedFields, prevSortById) {
    const writes = [];
    reorderedFields.forEach((f, idx) => {
      const next = (idx + 1) * 10;
      f.sort_order = next;
      if (prevSortById.get(f.id) !== next) writes.push({ id: f.id, sort_order: next });
    });
    return writes;
  }
  /* __PIN_END:planReorder__ */

  function injectStyles() {
    if (document.getElementById('dte-styles')) return;
    const st = document.createElement('style');
    st.id = 'dte-styles';
    st.textContent = `
      .dte { display:flex; flex-direction:column; gap:16px; }
      .dte-lbl { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); display:block; margin-bottom:8px; }
      .dte-lbl .muted { text-transform:none; letter-spacing:0; font-weight:400; }
      /* COLUMN-ALIGNED ROWS (2026-07-23, bob-reviewed): the list is ONE grid and every row
         tracks it via subgrid, so the divider + Type/Required/Enabled/Keywords columns line
         up EXACTLY across rows, auto-sized to the widest content — no magic widths to drift
         when copy or theme changes. This DELIBERATELY REVERSES the earlier "controls wrap to
         a second line on narrow panels" decision (the owner: wrapped rows read as misaligned
         chaos); the name column is the flexible one and ellipsises instead. Create mode
         renders fewer cells, so it gets its OWN template via the .dte--create mode class
         (both modes can coexist in one document — Settings hosts add-type AND edit).
         Columns (edit): handle | name+key | divider | type | required | enabled | keywords | ✕ */
      .dte-fields { display:grid; grid-template-columns: auto minmax(0,1fr) 1px auto auto auto auto 20px; gap:6px 10px; }
      .dte--create .dte-fields { grid-template-columns: auto minmax(0,1fr) 1px auto 20px; }
      .dte-row {
        grid-column: 1 / -1; display:grid; grid-template-columns: subgrid; align-items:center;
        padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface);
      }
      .dte-row .dte-handle { grid-column:1; }
      .dte-row .idn { grid-column:2; }
      .dte-row .col-div { grid-column:3; }
      .dte-row .grp-type { grid-column:4; }
      .dte-row .grp-req { grid-column:5; }
      .dte-row .grp-en { grid-column:6; }
      .dte-row .dte-kw { grid-column:7; }
      .dte-row .x, .dte-row .x-slot { grid-column:8; }
      .dte--create .dte-row .x, .dte--create .dte-row .x-slot { grid-column:5; }
      .dte-row.locked { background:var(--surface2); }
      /* Drag-to-reorder handle. The row is draggable but a drag only starts from this handle
         (gated in dragstart), so the Type select / toggles keep working. */
      .dte-row .dte-handle { flex:0 0 auto; align-self:center; cursor:grab; color:var(--muted);
        font-size:15px; line-height:1; user-select:none; padding:0 2px; }
      .dte-row .dte-handle:active { cursor:grabbing; }
      .dte-row.dragging { opacity:.45; }
      .dte-row.dragging .dte-handle { cursor:grabbing; }
      /* Per-field keyword-labels button + its inline editor panel. A LABELLED pill (not a
         bare glyph — invisible to the non-technical operators this UI serves) and a real
         <button> so it's keyboard-reachable with a focus state; the count doubles as a
         "this field has custom words" badge. Matches the .dte-chip pill language. */
      .dte-row .dte-kw { justify-self:start; cursor:pointer; user-select:none; white-space:nowrap;
        font:inherit; font-size:11px; line-height:1.4; color:var(--muted); background:var(--surface);
        border:1px solid var(--border2); border-radius:999px; padding:3px 10px; }
      .dte-row .dte-kw:hover { color:var(--accent); border-color:var(--accent); background:var(--accent-bg); }
      .dte-row .dte-kw:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
      .dte-row .dte-kw.open { color:var(--accent); border-color:var(--accent); background:var(--accent-bg); }
      .dte-kwpanel { grid-column:1 / -1; margin:-2px 0 4px 26px; padding:10px 12px; border:1px solid var(--border);
        border-radius:8px; background:var(--surface2); display:flex; flex-direction:column; gap:8px; }
      /* An open keyword panel is the dragged row's SIBLING — hide every panel while a drag
         gesture is live so it can't be left behind mid-gesture; the drop's re-render restores
         it under its (moved) row. */
      .dte-fields:has(.dte-row.dragging) .dte-kwpanel { display:none; }
      .dte-kw-title { font-size:12px; color:var(--text); }
      .dte-kw-builtins { font-size:11px; color:var(--muted); line-height:1.7; }
      .dte-kw-cap { text-transform:uppercase; letter-spacing:.06em; font-size:9px; }
      .dte-kw-bchip { display:inline-block; padding:1px 7px; border-radius:999px; border:1px dashed var(--border2);
        color:var(--muted); font-size:11px; }
      .dte-kw-note:empty { display:none; }
      /* Name + key share ONE baseline so the label doesn't ride high above its key. The
         lock lives INSIDE this cell (not its own column) so locked and unlocked rows'
         names align. min-width:0 + ellipsis: the name column is the row's only flexible
         track — a long name shortens here rather than wrapping the controls. */
      .dte-row .idn { display:flex; align-items:baseline; gap:8px; min-width:0; }
      .dte-row .nm { font-weight:500; font-size:13px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dte-row .key { font-family:var(--mono); font-size:10px; color:var(--muted); line-height:1; white-space:nowrap; }
      .dte-row .lock { color:var(--muted); font-size:12px; cursor:default; align-self:center; }
      .dte-row select { min-width:128px; }
      /* Divider between a field's IDENTITY (lock+name+key) and its TYPE/behaviour
         controls, plus a tiny caption on each control so its purpose is clear at a
         glance. Caption travels WITH its control. The negative vertical margins run the
         1px line through the row's padding, edge to edge. */
      .dte-row .col-div { width:1px; align-self:stretch; background:var(--border2); margin:-8px 0; }
      .dte-row .grp { display:flex; align-items:center; gap:6px; }
      .dte-row .ctl-cap { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); user-select:none; white-space:nowrap; }
      /* Remove-button slot is RESERVED on every row (placeholder when not removable) so
         the divider + Type column line up uniformly across locked and editable rows. */
      .dte-row .x, .dte-row .x-slot { flex:0 0 auto; width:20px; text-align:center; }
      .dte-row .x { cursor:pointer; color:var(--muted); font-weight:700; user-select:none; }
      .dte-row .x:hover { color:var(--err); }
      .dte-addrow { display:flex; gap:8px; margin-top:8px; }
      .dte-addrow input { flex:1; min-width:0; }
      .dte-fieldnote { margin-top:10px; padding:9px 11px; border-radius:8px;
        background:var(--surface2); border:1px solid var(--border); color:var(--muted);
        font-size:11.5px; line-height:1.5; }
      .dte-fieldnote b { color:var(--text); font-weight:600; }
      .dte-roles { display:flex; gap:16px; flex-wrap:wrap; }
      .dte .form-group { display:flex; flex-direction:column; gap:5px; }
      .dte .form-group > label { font-size:11px; color:var(--muted); }
      .dte-err { color:var(--err); font-size:12px; min-height:1em; }
      .dte-chips { display:flex; flex-wrap:wrap; gap:6px; }
      .dte-chips:empty { display:none; }
      .dte-chip { display:inline-flex; align-items:center; gap:7px; padding:3px 6px 3px 11px;
        border:1px solid var(--border2); border-radius:999px; background:var(--surface2); font-size:12px; }
      .dte-chip .cx { cursor:pointer; color:var(--muted); font-weight:700; line-height:1; padding:0 2px; }
      .dte-chip .cx:hover { color:var(--err); }
      .dte-alias-note { color:var(--warn); font-size:11px; line-height:1.4; min-height:0; margin-top:2px; }
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
    // Title aliases (both modes): other printed titles that also DETECT this type.
    let aliases = (type && Array.isArray(type.title_aliases)) ? type.title_aliases.slice() : [];

    injectStyles();
    if (mode === 'create') seedCreate();

    function seedCreate() {
      fields = [
        { label: 'Document Issuer', key: 'supplier_name', type: 'text', locked: true },
        { label: 'Reference number', type: 'reference' },
        { label: 'Date', type: 'date', locked: true },
      ];
      const g = (re) => { const m = fields.find(f => re.test(f.label) || re.test(f.key || '')); return m ? (m.key || slugify(m.label)) : ''; };
      refKey  = g(/number|no\b|ref|invoice|order/i) || '';
      const dF = fields.find(f => f.type === 'date');
      dateKey = g(/date/i) || (dF ? (dF.key || slugify(dF.label)) : '');
    }

    const currentFields = () => (mode === 'create' ? fields : (type.fields || []));

    // ── Per-field keyword labels (edit mode only) ────────────────────────────────
    // Extra caption words that make the cheap Stage-1 keyword pass catch a field without
    // per-document teaching — reuses the admin label-override store (field_label_overrides),
    // scoped to THIS type's slug. Single-open inline panel; kwOpenFor + the loaded rows survive
    // re-renders. A saved slug + field key are required, so this is edit-mode only.
    let kwOpenFor = null, kwRows = null, kwPatterns = null, kwNoteMsg = '';
    const kwCountFor = (key) => (kwRows || []).reduce((n, r) => n + (r.field_key === key ? 1 : 0), 0);
    async function loadKeywords() {
      if (mode !== 'edit' || !type || !type.slug) return;
      try {
        const [rows, pats] = await Promise.all([api.getLabelOverrides(), api.getFieldPatterns()]);
        kwRows     = (rows || []).filter(r => r.doc_type_slug === type.slug);
        kwPatterns = pats || {};
      } catch { kwRows = kwRows || []; kwPatterns = kwPatterns || {}; }
      if (!destroyed) render();
    }

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
        <div class="dte-row${locked ? ' locked' : ''}" data-i="${i}"${editing ? ` data-fid="${f.id}"` : ''} draggable="true">
          <span class="dte-handle" title="Drag to reorder this field" aria-hidden="true">&#10303;</span>
          <span class="idn">${locked ? '<span class="lock" title="Required field - cannot be removed or retyped">&#128274;</span>' : ''}<span class="nm">${esc(f.label)}</span>${editing ? `<span class="key">${esc(key)}</span>` : ''}</span>
          <span class="col-div" aria-hidden="true"></span>
          <span class="grp grp-type">
            <span class="ctl-cap" title="The kind of data this field holds">Type</span>
            ${typeSelectHtml(f.type || 'text', locked)}
          </span>
          ${editing ? `<span class="grp grp-req">
            <span class="ctl-cap" title="Whether a document must have this field filled before it can be filed">Required</span>
            <label class="toggle" title="${locked ? 'Structural field — always required' : 'Require this field before a document can be confirmed & filed'}">
              <input type="checkbox" class="dte-req"${f.required ? ' checked' : ''}${locked ? ' disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </span>` : ''}
          ${editing ? `<span class="grp grp-en">
            <span class="ctl-cap" title="${locked ? 'Required field - always on' : 'Whether this field is used when filing'}">Enabled</span>
            <label class="toggle" title="${locked ? 'Required field - always on' : 'Enable or disable this field'}">
              <input type="checkbox" class="dte-en"${enabled ? ' checked' : ''}${locked ? ' disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </span>` : ''}
          ${editing ? `<button type="button" class="dte-kw${kwOpenFor === key ? ' open' : ''}" data-kw="${esc(key)}" title="Extra caption words this field is detected by">&#127991; Keywords${kwCountFor(key) ? ' &middot; ' + kwCountFor(key) : ''}</button>` : ''}
          ${removable ? '<span class="x" title="Remove field">&#10005;</span>' : '<span class="x-slot" aria-hidden="true"></span>'}
        </div>`;
    }

    // The inline keyword-labels editor shown under a field when its 🏷 is open (edit mode). Lists the
    // shipped BUILT-IN words (read-only, always active) + any custom words this install added
    // (removable), and an add box. Empty string unless this field is the open one.
    function kwPanelHtml(f) {
      if (mode !== 'edit') return '';
      const key = f.key || slugify(f.label);
      if (kwOpenFor !== key) return '';
      const builtins = Array.isArray(kwPatterns && kwPatterns[key]) ? kwPatterns[key] : [];
      const customs  = (kwRows || []).filter(r => r.field_key === key);
      const bChips = builtins.length
        ? `<span class="dte-kw-cap">Built-in words (always active):</span> ` + builtins.map(b => `<span class="dte-kw-bchip">${esc(b)}</span>`).join(' ')
        : `<span class="dte-kw-cap">No built-in words ship for this field.</span>`;
      const cChips = customs.length
        ? `<div class="dte-chips">` + customs.map(r => `<span class="dte-chip" data-kwid="${r.id}">${esc(r.label)}<span class="cx" title="Remove">&#10005;</span></span>`).join('') + `</div>`
        : '';
      return `<div class="dte-kwpanel" data-kwfor="${esc(key)}">`
        + `<div class="dte-kw-title">Extra label words for <b>${esc(f.label)}</b> <span class="muted">&mdash; captions your documents actually use that mean this field</span></div>`
        + `<div class="dte-kw-builtins">${bChips}</div>`
        + cChips
        + `<div class="dte-addrow"><input type="text" class="field-select dte-kw-input" placeholder="e.g. Despatch Date, Delivered On" autocomplete="off"><button class="btn dte-kw-add">+ Add</button></div>`
        + `<div class="dte-alias-note dte-kw-note">${esc(kwNoteMsg)}</div>`
        + `</div>`;
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
        <div class="dte dte--${mode}">
          ${showName ? `
            <div>
              <label class="dte-lbl">Document type name</label>
              <input type="text" class="field-select dte-name" placeholder="e.g. Delivery Note" autocomplete="off" value="${esc(name)}">
            </div>` : ''}
          <div>
            <label class="dte-lbl">Fields${mode === 'create' ? ' <span class="muted">&mdash; what details should Scan Finder pull out?</span>' : ''}</label>
            <div class="dte-fields">${currentFields().map((f, i) => fieldRowHtml(f, i) + kwPanelHtml(f)).join('')}</div>
            <div class="dte-addrow">
              <input type="text" class="field-select dte-add-input" placeholder="Add a field, e.g. Order Number" autocomplete="off">
              <button class="btn dte-add-btn">+ Add field</button>
            </div>
            <div class="dte-fieldnote">
              <b>Tip:</b> each field&rsquo;s <b>Type</b> (the dropdown beside it) tells Scan Finder what to expect &mdash;
              a date, an amount, a reference number &mdash; so it reads that field more accurately.
              If you&rsquo;re not sure, choose <b>Text</b>.${mode === 'edit' ? `
              <br><b>Required</b> means a document can&rsquo;t be filed until this field is filled in.
              It applies to documents you file from now on &mdash; already-filed documents aren&rsquo;t affected.` : ''}
            </div>
          </div>
          <div data-help-key="doctype-aliases">
            <label class="dte-lbl">Also appears as <span class="muted">&mdash; other titles the same document is printed with</span></label>
            <div class="dte-chips">${aliases.map((a, i) => `<span class="dte-chip" data-ai="${i}">${esc(a)}<span class="cx" title="Remove">&#10005;</span></span>`).join('')}</div>
            <div class="dte-addrow">
              <input type="text" class="field-select dte-alias-input" placeholder="e.g. Work Sheet" autocomplete="off">
              <button class="btn dte-alias-btn">+ Add</button>
            </div>
            <div class="dte-fieldnote">A document is filed as this type when the title on the page matches the type&rsquo;s <b>name</b> <i>or</i> any title listed here. Add the spellings your documents actually use &mdash; e.g. <b>Work Sheet</b>, <b>Job Sheet</b>.</div>
            <div class="dte-alias-note"></div>
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
        if (fresh) { type = fresh; aliases = Array.isArray(type.title_aliases) ? type.title_aliases.slice() : []; }
      } catch (e) { /* keep last-known state */ }
      render();
      if (opts.onChange) opts.onChange();
    }

    // Apply a new field order. `perm` is the rows' ORIGINAL indices in their NEW visual order.
    // create: permute the draft array + re-render (commit assigns sort_order by array index).
    // edit: renumber sort_order (gap of 10), RE-RENDER FIRST to re-sync the per-row data-i/data-fid
    // bindings, THEN persist only the changed rows — so no control can act on a stale index mid-await.
    async function applyOrder(perm) {
      if (!perm || !perm.length) return;
      if (mode === 'create') {
        fields = perm.map(i => fields[i]).filter(Boolean);
        render();
        return;
      }
      const cur = type.fields || [];
      const prevSort = new Map(cur.map(f => [f.id, f.sort_order]));
      const reordered = perm.map(i => cur[i]).filter(Boolean);
      if (reordered.length !== cur.length) { render(); return; }   // guard: DOM/state mismatch → repaint, don't persist
      const writes = planReorder(reordered, prevSort);   // mutates each f.sort_order; returns changed rows
      type.fields = reordered;
      render();                                           // re-sync indices before any await
      for (const w of writes) {
        try { await api.updateField(w.id, { sort_order: w.sort_order }); }
        catch (e) { showErr('Could not save the new order: ' + e.message); await reload(); return; }
      }
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
        const reqCb = row.querySelector('.dte-req');
        if (reqCb && !reqCb.disabled) {
          reqCb.addEventListener('change', async () => {
            try { await api.updateField(fid, { required: reqCb.checked ? 1 : 0 }); type.fields[i].required = reqCb.checked ? 1 : 0; if (opts.onChange) opts.onChange(); }
            catch (e) { showErr('Could not change field: ' + e.message); reqCb.checked = !reqCb.checked; }
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
        const existingKeys = currentFields().map(f => f.key || slugify(f.label));
        if (mode === 'create') {
          fields.push({ label, type: ftype, key: safeFieldKey(label, existingKeys) });
          render();
          host.querySelector('.dte-add-input').focus();
        } else {
          const key = safeFieldKey(label, existingKeys);
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

      // Title aliases (chips). Create mode stages locally (emitted via getDraft); edit mode
      // persists each add/remove immediately, then re-reads so server-side validation
      // (drops of too-short/numeric aliases, or a name-collision error) is reflected.
      const aliasInput = host.querySelector('.dte-alias-input');
      const aliasBtn   = host.querySelector('.dte-alias-btn');
      const setNote = (msg) => { const n = host.querySelector('.dte-alias-note'); if (n) n.textContent = msg || ''; };
      const persistAliases = async (revertTo) => {
        if (mode === 'create') { render(); const el = host.querySelector('.dte-alias-input'); if (el) el.focus(); return; }
        try {
          const r = await api.updateDocumentType(type.id, { title_aliases: aliases });
          if (r && r.error) { aliases = revertTo; render(); setNote(r.error); return; }
          await reload();                                   // re-seeds aliases + re-renders from server truth
          setNote((r && r.notices && r.notices.length) ? r.notices.join('  ') : '');
        } catch (e) { aliases = revertTo; render(); setNote(e.message); }
      };
      const addAlias = async () => {
        const v = (aliasInput.value || '').trim();
        if (!v) return;
        const before = aliases.slice();
        if (!aliases.some(a => a.toLowerCase() === v.toLowerCase())) aliases.push(v);
        aliasInput.value = '';
        await persistAliases(before);
      };
      if (aliasBtn)   aliasBtn.addEventListener('click', addAlias);
      if (aliasInput) aliasInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } });
      host.querySelectorAll('.dte-chip .cx').forEach((x) => {
        x.addEventListener('click', async () => {
          const chip = x.closest('.dte-chip'); if (!chip) return;
          const before = aliases.slice();
          aliases.splice(Number(chip.dataset.ai), 1);
          await persistAliases(before);
        });
      });

      // ── Per-field keyword labels (toggle / add / remove) ─────────────────────
      host.querySelectorAll('.dte-kw').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.kw;
          kwOpenFor = (kwOpenFor === key) ? null : key;
          kwNoteMsg = '';
          if (kwOpenFor && kwRows === null) loadKeywords();   // first open → load (re-renders)
          else render();
        });
      });
      const kwPanel = host.querySelector('.dte-kwpanel');
      if (kwPanel) {
        const fieldKey = kwPanel.dataset.kwfor;
        const kwInput  = kwPanel.querySelector('.dte-kw-input');
        const kwAddBtn = kwPanel.querySelector('.dte-kw-add');
        const addKw = async () => {
          const val = (kwInput.value || '').trim();
          if (!val || !type || !type.slug) { kwNoteMsg = val ? '' : 'Enter a word to add.'; render(); return; }
          try {
            const r = await api.addLabelOverrides({ doc_type_slug: type.slug, field_key: fieldKey, labels: val });
            if (r && r.ok === false) { kwNoteMsg = 'Could not add those words.'; render(); return; }
            const rejected = (r && r.rejected)  || [];
            const warn     = (r && r.warnings)  || [];
            kwNoteMsg = rejected.some(x => x.code === 'cap_reached') ? 'Reached the limit of words for this field.'
              : rejected.length ? 'Some words were too long and were skipped.'
              : warn.length      ? `Added — note: "${warn[0].label}" is also used by another field.`
              : (r && r.inserted ? 'Added.' : (r && r.alreadyExisted ? 'Already added.' : ''));
            await loadKeywords();   // reload rows + re-render; kwNoteMsg persists across it
          } catch (e) { kwNoteMsg = 'Could not add: ' + (e.message || 'error'); render(); }
        };
        if (kwAddBtn) kwAddBtn.addEventListener('click', addKw);
        if (kwInput)  kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } });
        kwPanel.querySelectorAll('.dte-chip .cx').forEach((x) => {
          x.addEventListener('click', async () => {
            const chip = x.closest('.dte-chip'); if (!chip) return;
            try { await api.deleteLabelOverride(Number(chip.dataset.kwid)); kwNoteMsg = ''; await loadKeywords(); }
            catch (e) { kwNoteMsg = 'Could not remove: ' + (e.message || 'error'); render(); }
          });
        });
      }

      // ── Drag-to-reorder fields (handle-armed native DnD) ─────────────────────
      // The row is draggable, but a drag only STARTS from the ⠿ handle: we gate dragstart on
      // whether the pointer press began on the handle, so a click on the Type <select>/toggles
      // never starts a drag. Live feedback moves the SAME DOM node via insertBefore (its wired
      // listeners survive, no re-render mid-gesture); on drop we read the final order and commit
      // once via applyOrder (which re-renders to re-sync the row indices). All listeners are
      // host-scoped, so the next render()'s innerHTML replace GCs them — no cross-render leak.
      const fieldsWrap = host.querySelector('.dte-fields');
      if (fieldsWrap) {
        let pressedHandle = false;
        let dragRow = null;
        fieldsWrap.addEventListener('pointerdown', (e) => { pressedHandle = !!e.target.closest('.dte-handle'); });
        fieldsWrap.addEventListener('pointerup',   () => { pressedHandle = false; });
        fieldsWrap.addEventListener('dragstart', (e) => {
          const row = e.target.closest('.dte-row');
          if (!row || !pressedHandle) { e.preventDefault(); return; }   // only a handle-initiated gesture drags
          dragRow = row;
          row.classList.add('dragging');
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.i || ''); } catch (_) {}
        });
        fieldsWrap.addEventListener('dragend', () => {
          pressedHandle = false;
          if (dragRow) dragRow.classList.remove('dragging');
          dragRow = null;
        });
        fieldsWrap.addEventListener('dragover', (e) => {
          if (!dragRow) return;
          e.preventDefault();
          try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
          const after = rowAfterPointer(fieldsWrap, e.clientY, dragRow);
          if (after == null) { if (dragRow !== fieldsWrap.lastElementChild) fieldsWrap.appendChild(dragRow); }
          else if (after !== dragRow && after !== dragRow.nextSibling) fieldsWrap.insertBefore(dragRow, after);
        });
        fieldsWrap.addEventListener('drop', (e) => {
          if (!dragRow) return;
          e.preventDefault();
          const perm = Array.prototype.slice.call(fieldsWrap.querySelectorAll('.dte-row')).map(r => Number(r.dataset.i));
          dragRow.classList.remove('dragging');
          dragRow = null; pressedHandle = false;
          if (perm.some((v, idx) => v !== idx)) applyOrder(perm);
          else render();   // no net change → repaint to clear any drag artefacts
        });
      }
    }

    function getDraft() {
      return {
        name: name.trim(),
        fields: fields.map(f => ({ key: f.key || slugify(f.label), label: f.label, type: f.type })),
        ref_field_key: refKey || null,
        date_field_key: dateKey || null,
        title_aliases: aliases.slice(),
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
    loadKeywords();   // edit mode only (no-op otherwise) → repaints with per-field word counts

    return {
      isReady,
      getDraft,
      commit,
      destroy,
      getTypeId: () => (type ? type.id : null),
    };
  }

  // planReorder is exported as the ONE shared reorder-commit math (eric's review):
  // the Settings doc-type LIST drag-reorder uses the same renumbering + minimal-write
  // plan as the field rows here, so the two affordances can't drift apart.
  window.DocTypeEditor = { create, planReorder };
})();
