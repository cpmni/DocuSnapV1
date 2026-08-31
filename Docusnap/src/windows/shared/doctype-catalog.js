'use strict';
/*
 * doctype-catalog.js — the "Add from catalog…" picker, shared by Settings and the Teach wizard.
 *
 * WHY IT IS SHARED. The owner's report: creating a document type inside the teach wizard offers
 * less than creating one in Settings. The type EDITOR was already shared (`doctype-editor.js`), so
 * fields and structural roles were identical — what was missing is everything AROUND it, and the
 * catalog is the headline: in Settings you can tick "Sales Invoice, Credit Note, Statement" and get
 * each one complete with its fields and its likely printed labels, so extraction has a head start
 * before anything is taught. In the wizard you had to build the type by hand, field by field, at
 * the exact moment you are least in the mood for it — you are mid-teach, holding a document.
 *
 * It is EXTRACTED here rather than copied, for the reason this codebase keeps relearning: a second
 * copy of a behaviour drifts, and then the two surfaces disagree in a way nobody notices until a
 * customer reports it. One implementation, two mounts.
 *
 * Usage:
 *   DocTypeCatalog.open({ api, onAdded: async (slugs) => { ... refresh your list ... } })
 *
 * `api` needs exactly two channels, both already in the shared preload:
 *   getDoctypeCatalog()      -> [{slug, name, company_key, fields:[{label}], already_present}]
 *   addDoctypePresets(slugs) -> {success, ...}
 */
(function () {
  const COMPANY_LABELS = { supplier_name: 'Document Issuer', customer_name: 'Document Issuer' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function open(opts) {
    const api = opts && opts.api;
    const onAdded = (opts && opts.onAdded) || (async () => {});
    if (!api || !api.getDoctypeCatalog) return;

    let catalog;
    try { catalog = await api.getDoctypeCatalog(); }
    catch (e) { alert('Could not load the catalog: ' + ((e && e.message) || e)); return; }
    if (!Array.isArray(catalog) || !catalog.length) return;

    const rows = catalog.map((p) => {
      const fieldList = (p.fields || []).map(f => esc(f.label)).join(', ');
      const company = COMPANY_LABELS[p.company_key] || p.company_key;
      const tag = p.already_present
        ? '<span style="font-size:10px; color:var(--ok); border:1px solid var(--ok); border-radius:999px; padding:1px 7px;">Already added</span>'
        : '';
      return `
        <label style="display:flex; gap:10px; align-items:flex-start; padding:8px 6px; border-radius:8px; cursor:pointer;">
          <input type="checkbox" data-slug="${esc(p.slug)}" ${p.already_present ? 'checked disabled' : ''}
                 style="margin-top:3px;">
          <div style="flex:1;">
            <div style="font-size:12px; font-weight:500;">${esc(p.name)}
              <span style="font-weight:400; color:var(--muted);">· company: ${esc(company)}</span> ${tag}</div>
            <div style="font-size:11px; color:var(--muted); line-height:1.5;">${fieldList}</div>
          </div>
        </label>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center;';
    overlay.innerHTML = `
      <div style="width:460px; max-height:80vh; background:var(--surface); border:1px solid var(--border2);
                  border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                  font-family:var(--sans); color:var(--text);">
        <div style="font-size:13px; font-weight:600;">Add document types from catalog</div>
        <div style="font-size:11px; color:var(--muted); line-height:1.6;">
          Tick the document types your business uses. Each one is added with its fields and likely
          labels, so extraction has a head start before you teach anything.</div>
        <div id="cat-rows" style="overflow-y:auto; border:1px solid var(--border); border-radius:8px;
             padding:4px; flex:1; min-height:120px;">${rows}</div>
        <div style="display:flex; gap:8px;">
          <button id="cat-cancel" style="flex:1; padding:9px; border-radius:6px; border:1px solid var(--border2);
                  background:transparent; color:var(--muted); font-family:inherit; font-size:12px; cursor:pointer;">Cancel</button>
          <button id="cat-add" style="flex:1; padding:9px; border-radius:6px; border:none; background:var(--accent);
                  color:#fff; font-family:inherit; font-size:12px; font-weight:500; cursor:pointer;">Add selected</button>
        </div>
      </div>`;
    // help-mode's capture-phase click interceptor would otherwise swallow clicks inside the modal
    // (the 2026-07 dead-dialog class) — every custom overlay in this app opts out the same way.
    overlay.setAttribute('data-help-ignore', '1');
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#cat-cancel').addEventListener('click', close);

    overlay.querySelector('#cat-add').addEventListener('click', async () => {
      const slugs = Array.from(overlay.querySelectorAll('input[type=checkbox]:checked:not(:disabled)'))
        .map(cb => cb.getAttribute('data-slug'));
      if (!slugs.length) { close(); return; }
      const btn = overlay.querySelector('#cat-add');
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const res = await api.addDoctypePresets(slugs);
        close();
        if (res && res.success) await onAdded(slugs);
        else alert('Could not add types: ' + ((res && res.error) || 'unknown error'));
      } catch (e) {
        close();
        alert('Could not add types: ' + ((e && e.message) || e));
      }
    });
  }

  window.DocTypeCatalog = { open };
})();
