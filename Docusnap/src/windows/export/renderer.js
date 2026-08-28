'use strict';
/* Export-data window renderer. Reads options (suppliers / types+fields / metadata
 * columns) from the admin-gated export IPC, lets the user narrow the scope, shows
 * a live match count + sample preview, and writes CSV/JSON via a save dialog. */

const api = window.docusnap;
const ROW_CAP = 10000;   // mirrors exportService.EXPORT_ROW_CAP
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let OPT = null;                    // { suppliers, types, meta } from the server
const fieldsByType = new Map();    // slug -> [{key,label,type}]
const state = {
  types: new Set(),                // selected type slugs
  sups: new Set(),                 // selected sender names (exact)
  meta: new Set(),                 // selected metadata column keys
  fieldChecked: new Map(),         // field key -> bool (kept across type-list rebuilds)
  needsReview: false,
  from: '', to: '',          // "Date filed" range (confirmed_at)
  docFrom: '', docTo: '',    // "Document date" range (doc_date)
  format: 'csv',
  lastCount: 0,
};

// ── Load options + seed the "everything" default ─────────────────────────────
async function init() {
  try { OPT = await api.exportOptions(); }
  catch (e) { $('count-line').innerHTML = `<span class="muted">Could not load export options: ${esc(e.message || e)}</span>`; return; }

  // Opt-in defaults (owner 2026-08-28): document types + senders start UNticked; only the
  // essential columns (Document Issuer / Date / Reference, via each meta's `def`) start ticked.
  // The user ticks what they want; the live count follows (empty selection = 0, server-side).
  (OPT.types || []).forEach((t) => { fieldsByType.set(t.slug, t.fields || []); });
  (OPT.meta || []).forEach((m) => { if (m.def) state.meta.add(m.key); });

  renderTypes();
  renderSuppliers();
  renderColumns();
  wire();
  schedulePreview();
}

// ── Renderers ────────────────────────────────────────────────────────────────
function renderTypes() {
  const host = $('type-list');
  if (!OPT.types.length) { host.innerHTML = '<div class="empty-note">No document types yet.</div>'; return; }
  host.innerHTML = OPT.types.map((t) => `
    <label class="ck"><input type="checkbox" data-type="${esc(t.slug)}" ${state.types.has(t.slug) ? 'checked' : ''}>
      <span class="lbl">${esc(t.name)}</span><span class="cnt">${t.docs} doc${t.docs === 1 ? '' : 's'}</span></label>`).join('');
  host.querySelectorAll('input[data-type]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.types.add(cb.dataset.type); else state.types.delete(cb.dataset.type);
    renderColumns();          // type selection drives which fields are offered
    schedulePreview();
  }));
}

function renderSuppliers() {
  const host = $('sup-list');
  const q = ($('sup-filter').value || '').trim().toLowerCase();
  const list = (OPT.suppliers || []).filter((s) => !q || s.name.toLowerCase().includes(q));
  if (!list.length) { host.innerHTML = '<div class="empty-note">No senders match.</div>'; return; }
  host.innerHTML = list.map((s) => `
    <label class="ck"><input type="checkbox" data-sup="${esc(s.name)}" ${state.sups.has(s.name) ? 'checked' : ''}>
      <span class="lbl">${esc(s.name)}</span><span class="cnt">${s.docs}</span></label>`).join('');
  host.querySelectorAll('input[data-sup]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.sups.add(cb.dataset.sup); else state.sups.delete(cb.dataset.sup);
    schedulePreview();
  }));
}

// Union of the selected types' fields, deduped by key (matches the server pivot).
function selectedFieldDefs() {
  const map = new Map();
  for (const slug of state.types) for (const f of (fieldsByType.get(slug) || [])) if (!map.has(f.key)) map.set(f.key, f);
  return map;
}

function renderColumns() {
  const host = $('col-list');
  const fieldMap = selectedFieldDefs();
  let html = '<div class="grp-head">Standard columns</div>';
  html += (OPT.meta || []).map((m) => `
    <label class="ck"><input type="checkbox" data-meta="${esc(m.key)}" ${state.meta.has(m.key) ? 'checked' : ''}>
      <span class="lbl">${esc(m.label)}</span></label>`).join('');
  if (fieldMap.size) {
    html += '<div class="grp-head">Document fields</div>';
    html += [...fieldMap.values()].map((f) => {
      const on = state.fieldChecked.has(f.key) ? state.fieldChecked.get(f.key) : false;   // fields default OFF (opt-in)
      return `<label class="ck"><input type="checkbox" data-field="${esc(f.key)}" ${on ? 'checked' : ''}>
        <span class="lbl">${esc(f.label)}</span><span class="cnt">${esc(f.type || 'text')}</span></label>`;
    }).join('');
  } else {
    html += '<div class="empty-note">Select document types above to include their fields.</div>';
  }
  host.innerHTML = html;
  host.querySelectorAll('input[data-meta]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.meta.add(cb.dataset.meta); else state.meta.delete(cb.dataset.meta);
    schedulePreview();
  }));
  host.querySelectorAll('input[data-field]').forEach((cb) => cb.addEventListener('change', () => {
    state.fieldChecked.set(cb.dataset.field, cb.checked);
    schedulePreview();
  }));
}

// ── Build the IPC payload from state ─────────────────────────────────────────
function buildPayload() {
  const fieldMap = selectedFieldDefs();
  const fields = [];
  for (const f of fieldMap.values()) {
    const on = state.fieldChecked.has(f.key) ? state.fieldChecked.get(f.key) : false;   // fields default OFF (opt-in)
    if (on) fields.push({ key: f.key, label: f.label, type: f.type });
  }
  const filters = {
    suppliers: [...state.sups],
    typeSlugs: [...state.types],
    includeNeedsReview: state.needsReview,
    filedFrom: state.from || null,
    filedTo: state.to || null,
    docFrom: state.docFrom || null,
    docTo: state.docTo || null,
  };
  const sel = { metaKeys: [...state.meta], fields, format: state.format };
  return { filters, sel };
}

// ── Live preview (debounced) ─────────────────────────────────────────────────
let _pvTimer = null;
function schedulePreview() { clearTimeout(_pvTimer); _pvTimer = setTimeout(runPreview, 250); }

async function runPreview() {
  const { filters, sel } = buildPayload();
  const nCols = sel.metaKeys.length + sel.fields.length;
  let r;
  try { r = await api.exportPreview({ filters, sel }); }
  catch (e) { $('count-line').innerHTML = `<span class="muted">Preview failed: ${esc(e.message || e)}</span>`; return; }

  state.lastCount = r.count;
  const canRun = r.count > 0 && nCols > 0;
  $('btn-run').disabled = !canRun;
  $('count-line').innerHTML = `<b>${r.count.toLocaleString()}</b> <span class="muted">document${r.count === 1 ? '' : 's'} match · ${nCols} column${nCols === 1 ? '' : 's'}</span>`;
  $('trunc-note').textContent = r.count > ROW_CAP ? `Only the first ${ROW_CAP.toLocaleString()} rows will be exported — narrow the filter for the rest.` : '';

  renderPreview(r.columns || [], r.rows || []);
}

function renderPreview(columns, rows) {
  const card = $('preview-card');
  if (!columns.length || !rows.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('preview-sub').textContent = `— first ${Math.min(rows.length, 8)} row${Math.min(rows.length, 8) === 1 ? '' : 's'}`;
  const head = '<tr>' + columns.map((c) => `<th>${esc(c.label)}</th>`).join('') + '</tr>';
  const body = rows.slice(0, 8).map((r) => '<tr>' + columns.map((c) => `<td>${esc(r[c.key])}</td>`).join('') + '</tr>').join('');
  $('preview-wrap').innerHTML = `<div class="preview-scroll"><table id="preview-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ── Run the export ───────────────────────────────────────────────────────────
async function runExport() {
  const msg = $('run-msg');
  // Explicit acknowledgment when the result exceeds the row cap (Oracle F1-C1:
  // never hand back a truncated file that looks complete).
  if (state.lastCount > ROW_CAP &&
      !window.confirm(`${state.lastCount.toLocaleString()} documents match, but an export is capped at ${ROW_CAP.toLocaleString()} rows.\n\nOnly the first ${ROW_CAP.toLocaleString()} will be saved (the file will say so). Narrow the filter to export the rest.\n\nSave the first ${ROW_CAP.toLocaleString()} now?`)) {
    return;
  }
  msg.className = ''; msg.textContent = 'Preparing…';
  $('btn-run').disabled = true;
  const { filters, sel } = buildPayload();
  let r;
  try { r = await api.exportRun({ filters, sel }); }
  catch (e) { msg.className = 'err'; msg.textContent = 'Export failed: ' + (e.message || e); $('btn-run').disabled = false; return; }

  if (r.canceled) { msg.textContent = ''; $('btn-run').disabled = false; return; }
  if (r.empty)    { msg.className = 'err'; msg.textContent = 'Nothing matched — nothing was written.'; $('btn-run').disabled = false; return; }
  msg.className = ''; msg.textContent = `Saved ${r.count.toLocaleString()} row(s) → ${r.path}`;
  $('btn-run').disabled = false;
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function wire() {
  // All / None on each group
  const setAll = (which, on) => {
    if (which === 'types') { state.types = on ? new Set(OPT.types.map((t) => t.slug)) : new Set(); renderTypes(); renderColumns(); }
    else if (which === 'sups') {
      // honour the current filter when ticking "All"
      const q = ($('sup-filter').value || '').trim().toLowerCase();
      const shown = (OPT.suppliers || []).filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) => s.name);
      if (on) shown.forEach((n) => state.sups.add(n)); else shown.forEach((n) => state.sups.delete(n));
      renderSuppliers();
    } else if (which === 'cols') {
      (OPT.meta || []).forEach((m) => { if (on) state.meta.add(m.key); else state.meta.delete(m.key); });
      for (const f of selectedFieldDefs().values()) state.fieldChecked.set(f.key, on);
      renderColumns();
    }
    schedulePreview();
  };
  document.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => setAll(b.dataset.all, true)));
  document.querySelectorAll('[data-none]').forEach((b) => b.addEventListener('click', () => setAll(b.dataset.none, false)));

  $('sup-filter').addEventListener('input', renderSuppliers);
  $('opt-needsreview').addEventListener('change', (e) => { state.needsReview = e.target.checked; schedulePreview(); });
  $('opt-doc-from').addEventListener('change', (e) => { state.docFrom = e.target.value; schedulePreview(); });
  $('opt-doc-to').addEventListener('change', (e) => { state.docTo = e.target.value; schedulePreview(); });
  $('opt-from').addEventListener('change', (e) => { state.from = e.target.value; schedulePreview(); });
  $('opt-to').addEventListener('change', (e) => { state.to = e.target.value; schedulePreview(); });
  $('opt-dates-clear').addEventListener('click', () => {
    state.from = ''; state.to = ''; state.docFrom = ''; state.docTo = '';
    ['opt-from', 'opt-to', 'opt-doc-from', 'opt-doc-to'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    schedulePreview();
  });
  document.querySelectorAll('input[name="fmt"]').forEach((r) => r.addEventListener('change', () => {
    state.format = document.querySelector('input[name="fmt"]:checked').value;
    document.querySelectorAll('.fmt-pill').forEach((p) => p.classList.toggle('on', p.querySelector('input').checked));
  }));

  $('btn-run').addEventListener('click', runExport);
  $('btn-close').addEventListener('click', () => window.close());
}

init();
