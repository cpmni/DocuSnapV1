'use strict';
// Practice-run flow — TEACH-FIRST protocol (2026-08-31, owner):
//   teach one document (mini wizard sim, draw a box per detail) → import the batch
//   → Review = the place you CORRECT (type over the uncertain value; drawing works too)
//   → confirm → filing reveal.
// Everything is in-memory over window.TUTORIAL_FIXTURES; the ONLY call that touches
// disk is tutorialFileSample (copies a bundled sample into TEMP for the filing
// reveal). No real Review/confirm/process/OCR IPC is ever invoked — the box-draw is
// a faithful SIMULATION of the real Teach wizard / ⊕ target tool, not a real OCR read.
const D = window.docusnap;
const DOCS = window.TUTORIAL_FIXTURES || [];
const TEACH_DOC = DOCS.find(d => d.teach) || DOCS[0];
const RDOCS = DOCS.filter(d => d !== TEACH_DOC);   // the imported batch

const stage     = document.getElementById('stage');
const backBtn   = document.getElementById('back');
const primary   = document.getElementById('primary');
const secondary = document.getElementById('secondary');
const coach     = document.getElementById('coach');
const toastEl   = document.getElementById('toast');
const rvLayer   = document.getElementById('draw-layer');
const thLayer   = document.getElementById('th-draw-layer');

let screen = 'intro';
let tIdx = 0;                // current teach detail (index into TEACH_DOC.fields)
let tSaved = false;          // teach doc filed
let idx = 0;                 // current review doc (index into RDOCS)
let filedList = [];          // { doc, path, folder, root }
let taught = {};             // taught[docId] = Set(fieldKey)  (review-side fixes)
let overrides = {};          // overrides[docId][key] = corrected value + conf
let armedField = null;       // { key, layer, scope: 'teach'|'review' }

const rdoc = () => RDOCS[idx];
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
  else if (screen === 'teach') { coach.textContent = 'Step 1 of 3 — teach one document'; renderTeach(); }
  else if (screen === 'import') { coach.textContent = 'Step 2 of 3 — import'; primary.textContent = 'Process'; }
  else if (screen === 'review') { coach.textContent = 'Step 3 of 3 — check what it read, fix anything wrong, then confirm'; renderReview(); }
  else if (screen === 'done') {
    coach.textContent = 'Done — that’s teach once, import, correct, confirm.';
    primary.textContent = 'Import my documents';
    secondary.style.display = ''; secondary.textContent = 'Do it again';
  }
}

let toastT;
// Clear the readout toast IMMEDIATELY (text + pending auto-hide timer + class) — not just the .on
// class. Chris R5 card 6: the "Read 'INV-1042' from your box" toast was still fading (its textContent
// + live timer intact) over the START of the next sample, because renderReview only dropped .on.
function hideToast() {
  clearTimeout(toastT); toastEl.textContent = ''; toastEl.classList.remove('on');
}
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

const ICONS = {
  good: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
};

function setBannerEl(id, kind, text) {
  const b = document.getElementById(id);
  b.className = 'banner ' + kind;
  b.innerHTML = (ICONS[kind] || '') + '<span>' + text + '</span>';
}

// ── Teach (the wizard sim) ───────────────────────────────────────────────────
function renderTeachDoc() {
  const d = TEACH_DOC;
  const company = document.getElementById('th-company');
  company.textContent = d.company; company.dataset.field = 'supplier_name';
  document.getElementById('th-type-sub').textContent = d.docType.toUpperCase();
  document.getElementById('th-rows').innerHTML = d.fields
    .filter(f => f.key !== 'supplier_name')
    .map(f => `<div class="doc-row"><span class="dl">${f.label}</span><span class="dv" data-field="${f.key}">${f.value}</span></div>`)
    .join('');
}

function renderTeach() {
  const d = TEACH_DOC;
  document.getElementById('th-type').textContent = d.docType;
  document.getElementById('th-step').textContent = 'Teach — one ' + d.docType.toLowerCase();
  renderTeachDoc();
  const doneAll = tIdx >= d.fields.length;
  document.getElementById('th-fields').innerHTML = d.fields.map((f, i) => {
    const st = i < tIdx ? 'done' : i === tIdx ? 'now' : 'todo';
    return `
    <div class="field${st === 'done' ? ' taught' : ''}${st === 'now' ? ' armed' : ''}" data-field="${f.key}">
      <label>${f.label}${st === 'done' ? '<span class="pc" style="color:var(--ok)">✓</span>' : ''}</label>
      ${st === 'done'
        ? `<input value="${f.value}" readonly />`
        : `<input value="" placeholder="${st === 'now' ? 'Draw a box on the document…' : 'Waiting…'}" readonly />`}
      ${st === 'done' ? '<div class="cnote ok">✓ Read from the box you drew.</div>' : ''}
    </div>`;
  }).join('');
  if (doneAll) {
    setBannerEl('th-banner', 'good', d.coachDone);
    primary.textContent = 'Save and file this one';
    primary.disabled = false;
    disarm();
  } else {
    const f = d.fields[tIdx];
    setBannerEl('th-banner', 'draw', f.ask || `Draw a box around the <b>${f.label}</b> on the document — click, drag across the value, and release.`);
    primary.textContent = 'Save and file this one';
    primary.disabled = true;
    armTeach(f.key);
  }
}

function teachTargetEl(key) {
  return key === 'supplier_name'
    ? document.getElementById('th-company')
    : document.querySelector(`#th-rows .dv[data-field="${key}"]`);
}

function armTeach(key) {
  armedField = { key, layer: thLayer, scope: 'teach' };
  thLayer.classList.add('armed');
  document.querySelectorAll('#th-doc .dv, #th-company').forEach(el => el.classList.remove('target-pulse'));
  const tgt = teachTargetEl(key);
  if (tgt) tgt.classList.add('target-pulse');
}

async function teachSave() {
  hideToast();
  primary.disabled = true;
  const d = TEACH_DOC;
  try {
    const res = await D.tutorialFileSample?.({
      sampleFile: d.sampleFile, company: d.company, year: d.year, month: d.month, filedName: d.filedName,
    });
    filedList.push({ doc: d, path: res?.path, folder: res?.folder, root: res?.root, ok: !!res?.success });
  } catch { filedList.push({ doc: d, ok: false }); }
  primary.disabled = false;
  toast('Taught and filed — ' + d.filedName + '.pdf');
  show('import');
}

// ── Import ───────────────────────────────────────────────────────────────────
function renderImportList() {
  document.getElementById('im-list').innerHTML = RDOCS.map(d => `
    <div class="filerow" data-file="${d.id}">
      <div class="fi"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>
      <span class="nm">${d.originalName}</span>
      <span class="st">Ready</span>
    </div>`).join('');
}

async function process() {
  primary.disabled = true;
  for (const d of RDOCS) {
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

// ── Review (the place you CORRECT) ───────────────────────────────────────────
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
    const editable = f.low && !t;   // Review = correction: the uncertain value is TYPE-OVER editable
    return `
    <div class="field${f.low && !t ? ' low' : ''}${t ? ' taught' : ''}" data-field="${f.key}">
      <label>${f.label}<span class="pc" style="color:${confColour(c)}">${c}%</span></label>
      <input data-key="${f.key}" value="${v}" ${editable ? '' : 'readonly'} />
      <div class="cbar"><i style="width:${c}%;background:${confColour(c)}"></i></div>
      ${editable ? `
      <div class="frow-actions">
        <button class="teach-btn" data-teach="${f.key}">
          ${ICONS.draw}
          Or draw a box around it on the page
        </button>
      </div>` : ''}
      ${t ? '<div class="cnote ok">✓ Corrected — Scan Finder learns from this too.</div>'
          : (f.low ? `<div class="cnote" data-note="${f.key}">${f.hint}</div>` : '')}
    </div>`;
  }).join('');
  document.querySelectorAll('#rv-fields .teach-btn').forEach(b =>
    b.addEventListener('click', () => armReview(b.dataset.teach)));
  // Type-over correction: accept the printed value as typed (case-insensitive)
  document.querySelectorAll('#rv-fields input:not([readonly])').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = d.fields.find(x => x.key === inp.dataset.key);
      if (!f) return;
      if (inp.value.trim().toUpperCase() === correctValue(f).toUpperCase()) fixSuccess(f.key, 'typed');
    });
  });
}

function renderReview() {
  const d = rdoc();
  document.getElementById('rv-step').textContent = `Document ${idx + 1} of ${RDOCS.length}`;
  document.getElementById('rv-type').textContent = d.docType;
  document.getElementById('rv-dots').innerHTML = RDOCS.map((_, i) =>
    `<i class="${i < idx ? 'ok' : i === idx ? 'on' : ''}"></i>`).join('');
  // A fixed field must not keep the "one field is uncertain" sentence beside a green tick
  // (Chris r2 2026-08-11, tea item) — switch to the done-copy once nothing is low. Also drop
  // any lingering per-action toast from the previous document (text + timer, not just the class).
  hideToast();
  const hasLow = d.fields.some(f => f.low && !isTaught(d, f.key));
  setBannerEl('rv-banner', hasLow ? 'warn' : 'good', hasLow ? d.coach : (d.coachDone || d.coach));
  renderDoc(d);
  renderFields(d);
  primary.textContent = (idx === RDOCS.length - 1) ? 'Confirm and finish' : 'Confirm and file';
  if (hasLow) {
    const inp = document.querySelector('#rv-fields input:not([readonly])');
    if (inp) { inp.focus(); inp.select(); }
  }
}

function reviewTargetEl(key) {
  return key === 'supplier_name'
    ? document.getElementById('doc-company')
    : document.querySelector(`#doc-rows .dv[data-field="${key}"]`);
}

function armReview(key) {
  armedField = { key, layer: rvLayer, scope: 'review' };
  rvLayer.classList.add('armed');
  document.querySelectorAll('#rv-fields .field').forEach(el =>
    el.classList.toggle('armed', el.dataset.field === key));
  document.querySelectorAll('#rv-doc .dv, #doc-company').forEach(el => el.classList.remove('target-pulse'));
  const tgt = reviewTargetEl(key);
  if (tgt) tgt.classList.add('target-pulse');
  const label = rdoc().fields.find(f => f.key === key)?.label || 'value';
  setBannerEl('rv-banner', 'draw', `Draw a box around the <b>${label}</b> on the document — click, drag across the value, and release.`);
}

function disarm() {
  armedField = null;
  [rvLayer, thLayer].forEach(l => l && l.classList.remove('armed'));
  document.querySelectorAll('.target-pulse').forEach(el => el.classList.remove('target-pulse'));
  document.querySelectorAll('.field.armed').forEach(el => el.classList.remove('armed'));
  document.querySelectorAll('.drawbox').forEach(el => el.remove());
}

function fixSuccess(key, how) {
  const d = rdoc();
  const f = d.fields.find(x => x.key === key);
  (overrides[d.id] = overrides[d.id] || {})[key] = { value: correctValue(f), conf: 99 };
  (taught[d.id] = taught[d.id] || new Set()).add(key);
  disarm();
  renderReview();
  toast(how === 'typed'
    ? '“' + correctValue(f) + '” — corrected.'
    : 'Read “' + correctValue(f) + '” from your box.');
}

// ── Draw handling (shared by the Teach sim and the Review ⊕ sim) ────────────
let dstate = null, drawBox = null;
function layerDown(e) {
  if (!armedField || armedField.layer !== e.currentTarget) return;
  e.preventDefault();
  dstate = { x0: e.clientX, y0: e.clientY, layer: e.currentTarget };
  drawBox = document.createElement('div'); drawBox.className = 'drawbox'; dstate.layer.appendChild(drawBox);
}
[rvLayer, thLayer].forEach(l => l && l.addEventListener('mousedown', layerDown));
window.addEventListener('mousemove', (e) => {
  if (!dstate) return;
  const r = dstate.layer.getBoundingClientRect();
  const l = Math.min(dstate.x0, e.clientX) - r.left, t = Math.min(dstate.y0, e.clientY) - r.top;
  Object.assign(drawBox.style, { left: l + 'px', top: t + 'px',
    width: Math.abs(e.clientX - dstate.x0) + 'px', height: Math.abs(e.clientY - dstate.y0) + 'px' });
});
window.addEventListener('mouseup', (e) => {
  if (!dstate) return;
  const rect = { left: Math.min(dstate.x0, e.clientX), right: Math.max(dstate.x0, e.clientX),
                 top: Math.min(dstate.y0, e.clientY), bottom: Math.max(dstate.y0, e.clientY) };
  const armed = armedField;
  if (drawBox) { drawBox.remove(); drawBox = null; }
  dstate = null;
  if (!armed) return;
  const area = (rect.right - rect.left) * (rect.bottom - rect.top);
  const tgt = armed.scope === 'teach' ? teachTargetEl(armed.key) : reviewTargetEl(armed.key);
  if (!tgt) return;
  const t = tgt.getBoundingClientRect();
  const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
  const hit = area > 250 && cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
  if (!hit) { toast('Draw a box that covers the highlighted value, then release.'); return; }
  if (armed.scope === 'teach') {
    const f = TEACH_DOC.fields[tIdx];
    disarm();
    toast('Read “' + f.value + '” from your box.');
    tIdx++;
    renderTeach();
  } else {
    fixSuccess(armed.key, 'drawn');
  }
});

// ── Confirm one doc ──────────────────────────────────────────────────────────
async function confirm() {
  const d = rdoc();
  const lf = d.fields.find(f => f.low && !isTaught(d, f.key));
  if (lf) {                        // must correct the uncertain field first
    const inp = document.querySelector(`#rv-fields input[data-key="${lf.key}"]`);
    if (inp) { inp.focus(); inp.select(); }
    toast('Type the ' + lf.label.toLowerCase() + ' as printed on the page — or draw a box around it.');
    return;
  }
  hideToast();   // card 6: drop the box-readout the instant we commit, before the file-copy await
  primary.disabled = true;
  try {
    const res = await D.tutorialFileSample?.({
      sampleFile: d.sampleFile, company: d.company, year: d.year, month: d.month, filedName: d.filedName,
    });
    filedList.push({ doc: d, path: res?.path, folder: res?.folder, root: res?.root, ok: !!res?.success });
  } catch { filedList.push({ doc: d, ok: false }); }
  primary.disabled = false;

  if (idx < RDOCS.length - 1) { idx++; disarm(); renderReview(); }
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
  if (screen === 'intro') show('teach');
  else if (screen === 'teach') { if (tIdx >= TEACH_DOC.fields.length) teachSave(); }
  else if (screen === 'import') process();
  else if (screen === 'review') confirm();
  else if (screen === 'done') finish('import');
});
secondary.addEventListener('click', () => { if (screen === 'done') restart(); });
backBtn.addEventListener('click', () => { if (screen === 'import') show('teach'); });

function restart() {
  tIdx = 0; tSaved = false; idx = 0; filedList = []; taught = {}; overrides = {};
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
