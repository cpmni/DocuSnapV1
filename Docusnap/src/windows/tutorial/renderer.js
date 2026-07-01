'use strict';
// Practice-run flow (three-document batch) with a draw-a-box "teach" simulation.
// Everything is in-memory over window.TUTORIAL_FIXTURES; the ONLY call that touches
// disk is tutorialFileSample (copies a bundled sample into TEMP for the filing
// reveal). No real Review/confirm/process/OCR IPC is ever invoked — the box-draw is
// a faithful SIMULATION of the real ⊕ target tool, not a real OCR read.
const D = window.docusnap;
const DOCS = window.TUTORIAL_FIXTURES || [];

const stage     = document.getElementById('stage');
const backBtn   = document.getElementById('back');
const primary   = document.getElementById('primary');
const secondary = document.getElementById('secondary');
const coach     = document.getElementById('coach');
const toastEl   = document.getElementById('toast');
const layer     = document.getElementById('draw-layer');

let screen = 'intro';
let idx = 0;                 // current review doc
let filedList = [];          // { doc, path, folder, root }
let nudged = {};             // per-doc soft nudge state
let taught = {};             // taught[docId] = Set(fieldKey)
let overrides = {};          // overrides[docId][key] = corrected value + conf
let armedField = null;

const cur = () => [...stage.querySelectorAll('.screen')].find(s => s.classList.contains('on'))?.dataset.screen;
const doc = () => DOCS[idx];
const isTaught = (d, key) => !!(taught[d.id] && taught[d.id].has(key));

function show(name) {
  screen = name;
  [...stage.querySelectorAll('.screen')].forEach(s => s.classList.toggle('on', s.dataset.screen === name));
  backBtn.style.visibility = (name === 'import') ? 'visible' : 'hidden';
  secondary.style.display = 'none';
  primary.disabled = false;
  disarm();
  render();
}

function render() {
  if (screen === 'intro') { coach.textContent = 'A safe, repeatable walkthrough.'; primary.textContent = 'Start'; }
  else if (screen === 'import') { coach.textContent = 'Step 1 of 3 — import'; primary.textContent = 'Process'; }
  else if (screen === 'review') { coach.textContent = 'Step 2 of 3 — check each document, teach it, then confirm'; renderReview(); }
  else if (screen === 'done') {
    coach.textContent = 'Done — that’s import, review, teach, confirm.';
    primary.textContent = 'Import my documents';
    secondary.style.display = ''; secondary.textContent = 'Do it again';
  }
}

let toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

// ── Import ───────────────────────────────────────────────────────────────────
function renderImportList() {
  document.getElementById('im-list').innerHTML = DOCS.map(d => `
    <div class="filerow" data-file="${d.id}">
      <div class="fi"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>
      <span class="nm">${d.originalName}</span>
      <span class="st">Ready</span>
    </div>`).join('');
}

async function process() {
  primary.disabled = true;
  for (const d of DOCS) {
    const st = document.querySelector(`.filerow[data-file="${d.id}"] .st`);
    if (st) st.textContent = 'Reading…';
    await new Promise(r => setTimeout(r, 550));
    if (st) { st.textContent = 'Read'; st.classList.add('done'); }
  }
  await new Promise(r => setTimeout(r, 300));
  idx = 0;
  show('review');
}

// ── Field value helpers ──────────────────────────────────────────────────────
function confColour(c) { return c >= 85 ? 'var(--ok)' : c >= 60 ? 'var(--warn)' : 'var(--err)'; }
function correctValue(f) { return f.correct || f.value; }
function shownValue(d, f) { const o = overrides[d.id]?.[f.key]; return o ? o.value : f.value; }
function shownConf(d, f)  { const o = overrides[d.id]?.[f.key]; return o ? o.conf : f.confidence; }

// ── Review ───────────────────────────────────────────────────────────────────
function renderDoc(d) {
  const company = document.getElementById('doc-company');
  company.textContent = d.company; company.dataset.field = 'supplier_name';
  document.getElementById('doc-type-sub').textContent = d.docType.toUpperCase();
  document.getElementById('doc-rows').innerHTML = d.fields
    .filter(f => f.key !== 'supplier_name')
    .map(f => `<div class="doc-row"><span class="dl">${f.label}</span><span class="dv" data-field="${f.key}">${correctValue(f)}</span></div>`)
    .join('');
}

function renderFields(d) {
  document.getElementById('rv-fields').innerHTML = d.fields.map(f => {
    const v = shownValue(d, f), c = shownConf(d, f), t = isTaught(d, f.key);
    return `
    <div class="field${f.low && !t ? ' low' : ''}${t ? ' taught' : ''}" data-field="${f.key}">
      <label>${f.label}<span class="pc" style="color:${confColour(c)}">${c}%</span></label>
      <input data-key="${f.key}" value="${v}" readonly />
      <div class="cbar"><i style="width:${c}%;background:${confColour(c)}"></i></div>
      <div class="frow-actions">
        <button class="teach-btn" data-teach="${f.key}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          ${t ? 'Read from your box ✓' : 'Draw a box to read it'}
        </button>
      </div>
      ${t ? '<div class="cnote ok">✓ Read from the box you drew.</div>'
          : (f.low ? `<div class="cnote" data-note="${f.key}">${f.hint}</div>` : '')}
    </div>`;
  }).join('');
  document.querySelectorAll('#rv-fields .teach-btn').forEach(b =>
    b.addEventListener('click', () => arm(b.dataset.teach)));
}

const ICONS = {
  good: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
};

function setBanner(kind, text) {
  const b = document.getElementById('rv-banner');
  b.className = 'banner ' + kind;
  b.innerHTML = (ICONS[kind] || '') + '<span>' + text + '</span>';
}

function renderReview() {
  const d = doc();
  document.getElementById('rv-step').textContent = `Document ${idx + 1} of ${DOCS.length}`;
  document.getElementById('rv-type').textContent = d.docType;
  document.getElementById('rv-dots').innerHTML = DOCS.map((_, i) =>
    `<i class="${i < idx ? 'ok' : i === idx ? 'on' : ''}"></i>`).join('');
  const hasLow = d.fields.some(f => f.low && !isTaught(d, f.key));
  setBanner(hasLow ? 'warn' : 'good', d.coach);
  renderDoc(d);
  renderFields(d);
  primary.textContent = (idx === DOCS.length - 1) ? 'Confirm and finish' : 'Confirm and file';
}

// ── Draw-to-teach ────────────────────────────────────────────────────────────
function arm(key) {
  armedField = key;
  layer.classList.add('armed');
  document.querySelectorAll('#rv-fields .field').forEach(el =>
    el.classList.toggle('armed', el.dataset.field === key));
  document.querySelectorAll('#rv-doc .dv, #doc-company').forEach(el => el.classList.remove('target-pulse'));
  const tgt = targetEl(key);
  if (tgt) tgt.classList.add('target-pulse');
  const label = doc().fields.find(f => f.key === key)?.label || 'value';
  setBanner('draw', `Draw a box around the <b>${label}</b> on the document — click, drag across the value, and release.`);
}

function disarm() {
  armedField = null;
  layer.classList.remove('armed');
  document.querySelectorAll('.target-pulse').forEach(el => el.classList.remove('target-pulse'));
  document.querySelectorAll('#rv-fields .field.armed').forEach(el => el.classList.remove('armed'));
  const stray = layer.querySelector('.drawbox'); if (stray) stray.remove();
}

function targetEl(key) {
  return key === 'supplier_name'
    ? document.getElementById('doc-company')
    : document.querySelector(`#doc-rows .dv[data-field="${key}"]`);
}

let dstate = null, drawBox = null;
layer.addEventListener('mousedown', (e) => {
  if (!armedField) return;
  e.preventDefault();
  dstate = { x0: e.clientX, y0: e.clientY };
  drawBox = document.createElement('div'); drawBox.className = 'drawbox'; layer.appendChild(drawBox);
});
window.addEventListener('mousemove', (e) => {
  if (!dstate) return;
  const r = layer.getBoundingClientRect();
  const l = Math.min(dstate.x0, e.clientX) - r.left, t = Math.min(dstate.y0, e.clientY) - r.top;
  Object.assign(drawBox.style, { left: l + 'px', top: t + 'px',
    width: Math.abs(e.clientX - dstate.x0) + 'px', height: Math.abs(e.clientY - dstate.y0) + 'px' });
});
window.addEventListener('mouseup', (e) => {
  if (!dstate) return;
  const rect = { left: Math.min(dstate.x0, e.clientX), right: Math.max(dstate.x0, e.clientX),
                 top: Math.min(dstate.y0, e.clientY), bottom: Math.max(dstate.y0, e.clientY) };
  const key = armedField;
  if (drawBox) { drawBox.remove(); drawBox = null; }
  dstate = null;
  const area = (rect.right - rect.left) * (rect.bottom - rect.top);
  const tgt = targetEl(key);
  if (!tgt) return;
  const t = tgt.getBoundingClientRect();
  const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
  const hit = area > 250 && cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
  if (hit) teachSuccess(key);
  else toast('Draw a box that covers the highlighted value, then release.');
});

function teachSuccess(key) {
  const d = doc();
  const f = d.fields.find(x => x.key === key);
  (overrides[d.id] = overrides[d.id] || {})[key] = { value: correctValue(f), conf: 99 };
  (taught[d.id] = taught[d.id] || new Set()).add(key);
  disarm();
  renderReview();
  toast('Read “' + correctValue(f) + '” from your box.');
}

// ── Confirm one doc ──────────────────────────────────────────────────────────
async function confirm() {
  const d = doc();
  const lf = d.fields.find(f => f.low && !isTaught(d, f.key));
  if (lf) {                        // must teach the uncertain field by drawing first
    arm(lf.key);
    toast('Draw a box around the ' + lf.label + ' to correct it, then Confirm.');
    return;
  }
  primary.disabled = true;
  try {
    const res = await D.tutorialFileSample?.({
      sampleFile: d.sampleFile, company: d.company, year: d.year, month: d.month, filedName: d.filedName,
    });
    filedList.push({ doc: d, path: res?.path, folder: res?.folder, root: res?.root, ok: !!res?.success });
  } catch { filedList.push({ doc: d, ok: false }); }
  primary.disabled = false;

  if (idx < DOCS.length - 1) { idx++; disarm(); renderReview(); }
  else { renderDone(); show('done'); }
}

// ── Done ─────────────────────────────────────────────────────────────────────
function renderDone() {
  const list = document.getElementById('done-list');
  const ok = '<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  list.innerHTML = filedList.map(e => `
    <div class="done-row">
      ${ok}
      <span class="before">${e.doc.originalName}</span>
      <span class="arrow">→</span>
      <span class="after">${e.doc.filedName}.pdf</span>
      <span class="path">${e.doc.company} / ${e.doc.year} / ${e.doc.month}</span>
    </div>`).join('') +
    (filedList.some(e => e.root) ? '<div style="text-align:center;margin-top:14px"><button id="ba-open" class="btn">Open the practice folder</button></div>' : '');
  document.getElementById('ba-open')?.addEventListener('click', () => D.tutorialOpenFolder?.());
}

// ── Wiring ───────────────────────────────────────────────────────────────────
primary.addEventListener('click', () => {
  if (screen === 'intro') show('import');
  else if (screen === 'import') process();
  else if (screen === 'review') confirm();
  else if (screen === 'done') finish('import');
});
secondary.addEventListener('click', () => { if (screen === 'done') restart(); });
backBtn.addEventListener('click', () => { if (screen === 'import') show('intro'); });

function restart() {
  idx = 0; filedList = []; nudged = {}; taught = {}; overrides = {};
  renderImportList();
  show('intro');
}
function finish(action) {
  try { D.tutorialCleanup?.(); } catch {}
  try { D.tutorialDone?.(action); } catch {}
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (armedField) disarm(); else finish('close'); } });

if (!DOCS.length) { coach.textContent = 'No practice samples found.'; primary.disabled = true; }
else { renderImportList(); show('intro'); }
