'use strict';

// Read-only developer inspector. Subscribes to the mirrored process/reprocess
// telemetry (no controls, no privileged IPC) and renders a simple live view.

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click',   () => window.docusnap.windowMinimise());
document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Element refs ──────────────────────────────────────────────────────────────
const runPill     = document.getElementById('run-pill');
const curFileEl   = document.getElementById('cur-file');
const activityEl  = document.getElementById('activity');
const detailEl    = document.getElementById('detail');
const barFill     = document.getElementById('bar-fill');
const progressTxt = document.getElementById('progress-text');
const snapEmpty   = document.getElementById('snapshot-empty');
const snapEl      = document.getElementById('snapshot');
const logEl       = document.getElementById('log');

// ── State ─────────────────────────────────────────────────────────────────────
let total = 0, done = 0;

// ── Raw log (collapsible) ─────────────────────────────────────────────────────
const logToggle = document.getElementById('log-toggle');
document.getElementById('log-head').addEventListener('click', () => {
  const open = logEl.classList.toggle('open');
  logToggle.textContent = open ? 'Hide' : 'Show';
});
function appendLog(text, level) {
  const line = document.createElement('div');
  line.className = 'log-line' + (level ? ' ' + level : '');
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Plain-English activity from a telemetry message ───────────────────────────
function describe(m) {
  switch (m.type) {
    case 'start':
      return `Starting — ${m.total || 0} document${m.total === 1 ? '' : 's'} queued`;
    case 'file_begin':
      return `Reading "${m.filename || '…'}"`;
    case 'file_done': {
      const name = m.original_filename || m.filename || 'document';
      const type = m.document_type || 'unknown type';
      const conf = (m.overall_confidence != null) ? `, ${m.overall_confidence}% confidence` : '';
      const rev  = m.needs_review ? ' — needs review' : '';
      return `Finished "${name}" — ${type}${conf}${rev}`;
    }
    case 'log':
      return null;   // logs feed the detail line + raw panel, not the headline
    default:
      return null;
  }
}

function setRunning(on) {
  runPill.textContent = on ? 'running' : 'idle';
  runPill.className = on ? 'on' : 'off';
}

function renderSnapshot(m) {
  snapEmpty.style.display = 'none';
  snapEl.style.display = '';
  document.getElementById('snap-type').textContent = m.document_type ? '· ' + m.document_type : '';
  const rows = [];
  const add = (k, v, cls) => rows.push(
    `<div class="k">${escapeHtml(k)}</div><div class="v ${cls || ''}">${escapeHtml(v == null || v === '' ? '—' : String(v))}</div>`
  );
  add('File',     m.original_filename || m.filename);
  add('Supplier', m.supplier_name);
  const conf = m.overall_confidence;
  add('Doc confidence', conf != null ? conf + '%' : '—', conf == null ? 'muted' : conf >= 80 ? 'ok' : 'warn');
  add('Status',   m.needs_review ? 'Needs review' : (m.status || 'ok'), m.needs_review ? 'warn' : 'ok');

  // Per-field resolved values, keyed by the ACTUAL field keys — matches what the
  // Review window shows. (The old display used the invoice_number convenience
  // field, which is wrong for non-invoice document types.)
  const ex = m.extractions || {};
  const keys = Object.keys(ex);
  if (keys.length) {
    rows.push('<div class="k" style="grid-column:1/3; color:var(--muted); margin-top:6px; '
      + 'border-top:1px solid var(--border); padding-top:6px;">Resolved fields (as Review sees them)</div>');
    for (const k of keys) {
      const f = ex[k] || {};
      const meta = f.value ? ` (${f.confidence != null ? f.confidence + '% ' : ''}${f.method || '?'})` : '';
      const note = f.validation_note ? ` · ${f.validation_note}` : '';
      add(k, (f.value == null || f.value === '' ? '—' : f.value) + meta + note, f.value ? '' : 'muted');
    }
  }
  snapEl.innerHTML = rows.join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Handle a telemetry message (shared by process + reprocess) ────────────────
function handle(m, source) {
  if (!m || typeof m !== 'object') return;

  if (m.type === 'start') {
    total = m.total || 0; done = 0;
    updateProgress();
    setRunning(true);
  } else if (m.type === 'file_begin') {
    curFileEl.textContent = m.filename || '—';
    setRunning(true);
  } else if (m.type === 'file_done') {
    done += 1;
    updateProgress();
    renderSnapshot(m);
    if (total && done >= total) setRunning(false);
  } else if (m.type === 'log') {
    detailEl.textContent = m.text || '';
    appendLog((source === 'reprocess' ? '[reprocess] ' : '') + (m.text || ''), m.level);
  }

  const headline = describe(m);
  if (headline) activityEl.textContent = headline;
}

function updateProgress() {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  barFill.style.width = pct + '%';
  progressTxt.textContent = `${done} / ${total}`;
}

// ── Session documents + extraction trace + OCR slice ──────────────────────────
const docSelect   = document.getElementById('doc-select');
const docCount    = document.getElementById('doc-count');
const traceEl     = document.getElementById('trace');
const traceToggle = document.getElementById('trace-toggle');
const sliceLabel      = document.getElementById('slice-label');
const sliceHint       = document.getElementById('slice-hint');
const sliceNote       = document.getElementById('slice-note');
const sliceAnchorList = document.getElementById('slice-anchor-list');
const sliceTargetList = document.getElementById('slice-target-list');

document.getElementById('trace-head').addEventListener('click', () => {
  const open = traceEl.classList.toggle('open');
  traceToggle.textContent = open ? 'Hide' : 'Show';
});

let selectedDoc  = null;
let autoFollow   = true;                 // follow the live doc until the user picks one
let docMetaByKey = new Map();
const traceFields  = new Map();          // field -> events[]
const traceFinal   = new Map();          // field -> final value
const slicesByField = new Map();         // field -> [sliceEvent, …] (every captured crop, never collapsed)
let selectedField  = null;

async function refreshDocs() {
  let docs = [];
  try { docs = (await window.docusnap.devGetSessionDocs()) || []; } catch {}
  docMetaByKey = new Map(docs.map(d => [d.key, d]));
  docSelect.innerHTML = '';
  if (!docs.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = '— none yet —';
    docSelect.appendChild(o);
  }
  for (const d of docs) {
    const o = document.createElement('option'); o.value = d.key;
    o.textContent = `${d.filename}${d.docType ? ' · ' + d.docType : ''}${d.status ? ' · ' + d.status : ''}`;
    docSelect.appendChild(o);
  }
  docCount.textContent = docs.length ? `(${docs.length})` : '';
  // Keep the user's pick; otherwise default to the most recent.
  const want = (selectedDoc && docMetaByKey.has(selectedDoc)) ? selectedDoc : (docs[0] && docs[0].key);
  if (want) { docSelect.value = want; if (want !== selectedDoc) selectDoc(want); }
}

docSelect.addEventListener('change', () => {
  if (!docSelect.value) return;
  autoFollow = false;                    // user took manual control
  selectDoc(docSelect.value);
});

async function selectDoc(key) {
  selectedDoc = key; selectedField = null;
  traceFields.clear(); traceFinal.clear(); slicesByField.clear();
  clearSlices();
  let events = [];
  try { events = (await window.docusnap.devGetSessionDoc(key)) || []; } catch {}
  for (const ev of events) applyTraceEvent(ev);
  renderTrace();
}

function applyTraceEvent(ev) {
  if (!ev) return;
  if (ev.event === 'final' && ev.field != null) traceFinal.set(ev.field, ev.value);
  if (ev.event === 'slice' && ev.field != null) {
    // Keep EVERY slice event (never collapse same-kind events from different
    // stages) so each pane item is backed by its own canonical event object.
    if (!slicesByField.has(ev.field)) slicesByField.set(ev.field, []);
    slicesByField.get(ev.field).push(ev);
    return;
  }
  if (ev.field != null && ev.event !== 'stage_start' && ev.event !== 'stage_end') {
    if (!traceFields.has(ev.field)) traceFields.set(ev.field, []);
    traceFields.get(ev.field).push(ev);
  }
}

function renderTrace() {
  const blocks = [];
  for (const [field, events] of traceFields) {
    const hasFinal = traceFinal.has(field);
    const finalVal = traceFinal.get(field);
    const rows = events.map(e => {
      let cls = 'tf-ev', tag = '';
      const meta = [];
      if (e.method) meta.push(e.method);
      if (e.confidence != null) meta.push(e.confidence + '%');
      let valTxt = e.value == null ? '—' : String(e.value);
      if (e.event === 'candidate') {
        tag = 'candidate';
      } else if (e.event === 'merge') {
        const won = e.decision === 'win';
        tag = won ? '✓ won' : '✗ lost'; cls += won ? ' win' : ' lose';
        if (e.vs && e.vs.value != null) meta.push(`vs ${e.vs.value}${e.vs.method ? '/' + e.vs.method : ''}`);
      } else if (e.event === 'validation') {
        tag = 'validated'; cls += ' valn';
        if (e.note) meta.push(e.note);
        if (e.corrected_to) meta.push('→ ' + e.corrected_to);
      } else if (e.event === 'transform') {
        tag = e.stage === '2.5_correct' ? 'corrected' : 'denoised'; cls += ' transform';
        valTxt = `${e.from} → ${e.to}`;
      } else if (e.event === 'reprocess_merge') {
        tag = e.decision === 'kept_existing' ? 'kept old' : 'used new'; cls += ' mergejs';
        valTxt = `old: ${e.old == null ? '—' : e.old}   new: ${e.new == null ? '—' : e.new}`;
      }
      if (hasFinal && (e.event === 'candidate' || e.event === 'merge')
          && String(e.value) !== String(finalVal)) cls += ' superseded';
      return `<div class="${cls}">`
        + `<span class="stage">${escapeHtml(e.stage || e.event)}</span>`
        + `<span class="tag">${escapeHtml(tag)}</span>`
        + `<span class="val">${escapeHtml(valTxt)}</span>`
        + `<span class="meta">${escapeHtml(meta.join(' · '))}</span></div>`;
    }).join('');
    const sl = slicesByField.get(field) || [];
    const kinds = [sl.some(s => s.kind === 'anchor') && 'anchor',
                   sl.some(s => s.kind !== 'anchor') && 'value'].filter(Boolean);
    const sliceTag = kinds.length
      ? ` <span class="fm" style="color:var(--accent2)">◧ ${kinds.join('+')}</span>` : '';
    const finalHtml = hasFinal
      ? `<span class="tf-final"><span class="fv">${escapeHtml(finalVal == null || finalVal === '' ? '—' : String(finalVal))}</span> <span class="fm">final</span></span>`
      : '<span class="tf-final fm">resolving…</span>';
    const sel = field === selectedField ? ' sel' : '';
    blocks.push(`<div class="tf${sel}" data-field="${escapeHtml(field)}">`
      + `<div class="tf-head"><span class="tf-field">${escapeHtml(field)}${sliceTag}</span>${finalHtml}</div>${rows}</div>`);
  }
  traceEl.innerHTML = blocks.join('')
    || '<div class="note">No trace captured for this document (the inspector may have been closed while it processed).</div>';
  traceEl.querySelectorAll('.tf').forEach(el =>
    el.addEventListener('click', () => showSlice(el.dataset.field)));
}

// ── OCR slice panes — every captured crop, each labeled from its own event ────
// Stage label comes ONLY from the slice event's `stage` (never inferred from the
// final winner or field method).
function shortStage(stage) {
  if (stage === 'template_mapping') return 'Stage 0.5';
  if (stage === 'anchor_crop')      return 'Stage 2';
  return stage || '?';
}
function stageSource(stage) {
  if (stage === 'template_mapping') return 'template mapping';
  if (stage === 'anchor_crop')      return 'learned anchor';
  return stage || 'unknown';
}

function clearSlices() {
  sliceAnchorList.innerHTML = '<div class="note">—</div>';
  sliceTargetList.innerHTML = '<div class="note">—</div>';
  if (sliceNote) { sliceNote.style.display = 'none'; sliceNote.textContent = ''; }
  if (sliceHint) sliceHint.style.display = '';
  sliceLabel.textContent = '';
}

// Build one labeled slice item. Label fields are read from `ev` itself — the
// SAME object whose `ev.path` supplies the image — so they can never disagree.
async function buildSliceItem(ev) {
  const item = document.createElement('div');
  item.className = 'slice-item';
  const bbox = Array.isArray(ev.bbox) ? ' · bbox ' + ev.bbox.map(n => (+n).toFixed(3)).join(', ') : '';
  const l1 = document.createElement('div'); l1.className = 'lbl1';
  l1.innerHTML = `<span class="k">${escapeHtml(shortStage(ev.stage))} · ${escapeHtml(ev.kind || 'target')}</span>`;
  const l2 = document.createElement('div'); l2.className = 'lbl2';
  l2.textContent = `${stageSource(ev.stage)} · ${ev.stage || '?'} · page ${ev.page ?? 0}${bbox}`;
  item.append(l1, l2);
  let uri = null;
  try { uri = await window.docusnap.devGetSlice(ev.path); } catch {}
  if (uri) {
    const img = document.createElement('img'); img.alt = (ev.kind || '') + ' crop'; img.src = uri;
    item.appendChild(img);
  } else {
    const n = document.createElement('div'); n.className = 'note';
    n.textContent = 'Slice file no longer available (cleaned up).';
    item.appendChild(n);
  }
  return item;
}

async function renderSliceList(container, evs, emptyText) {
  container.innerHTML = '';
  if (!evs.length) { container.innerHTML = `<div class="note">${escapeHtml(emptyText)}</div>`; return; }
  for (const ev of evs) container.appendChild(await buildSliceItem(ev));
}

async function showSlice(field) {
  selectedField = field; renderTrace();
  sliceLabel.textContent = '· ' + field;
  if (sliceHint) sliceHint.style.display = 'none';

  const all       = slicesByField.get(field) || [];
  const anchorEvs = all.filter(e => e.kind === 'anchor');
  const targetEvs = all.filter(e => e.kind !== 'anchor');

  // Anchor empty state, accurate to the field's actual captured path.
  let anchorEmpty = 'No anchor crop captured for this field/path.';
  if (!anchorEvs.length && targetEvs.some(e => e.stage === 'anchor_crop')) {
    anchorEmpty = 'Stage 2 learned-anchor path has no separate anchor-search image.';
  }

  // Non-winner note: derived only as extra context, NOT used for any stage label.
  const finalEv = (traceFields.get(field) || []).find(e => e.event === 'final');
  const finalMethod = (finalEv && finalEv.method) || '';
  if (all.length && /^keyword/i.test(finalMethod)) {
    sliceNote.style.display = '';
    sliceNote.textContent = `Final value came from "${finalMethod}" — the crops below are from a non-winning anchor/mapping candidate, not the source of the final value.`;
  } else {
    sliceNote.style.display = 'none'; sliceNote.textContent = '';
  }

  await renderSliceList(sliceAnchorList, anchorEvs, anchorEmpty);
  await renderSliceList(sliceTargetList, targetEvs, 'No value/target crop captured for this field.');
}

// Live trace: follow the in-flight doc (until the user picks one) and apply
// matching events incrementally.
function handleTrace(ev) {
  if (!ev || typeof ev !== 'object' || !ev.doc) return;
  if (autoFollow && ev.doc !== selectedDoc) {
    selectedDoc = ev.doc; selectedField = null;
    traceFields.clear(); traceFinal.clear(); slicesByField.clear(); clearSlices();
  }
  if (ev.doc === selectedDoc) { applyTraceEvent(ev); renderTrace(); }
}

// ── Subscribe to the mirrored telemetry (read-only) ───────────────────────────
window.docusnap.onProcessProgress((m)   => { handle(m, 'process');   if (m.type === 'file_done') refreshDocs(); });
window.docusnap.onReprocessProgress((m) => { handle(m, 'reprocess'); if (m.type === 'file_done') refreshDocs(); });
window.docusnap.onProcessTrace((ev)     => handleTrace(ev));

// Initial population: docs already processed earlier this session.
refreshDocs();
window.docusnap.devInspectorRunning?.().then((on) => { if (on) setRunning(true); }).catch(() => {});
