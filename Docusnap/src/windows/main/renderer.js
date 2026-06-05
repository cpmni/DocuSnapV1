'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let selectedFolder = null;
let running        = false;
let results        = [];
let stats          = { total: 0, done: 0, ok: 0, err: 0 };

// ── Element refs ─────────────────────────────────────────────────────────────
const folderBox     = document.getElementById('folder-box');
const folderDisplay = document.getElementById('folder-display');
const btnRun        = document.getElementById('btn-run');
const btnClear      = document.getElementById('btn-clear');
const dropzone      = document.getElementById('dropzone');
const resultsPanel  = document.getElementById('results-panel');
const logPanel      = document.getElementById('log-panel');
const logOutput     = document.getElementById('log-output');
const logStatus     = document.getElementById('log-status');
const progressBar   = document.getElementById('progress-bar');
const tableBody     = document.getElementById('table-body');

// ── Stage indicator ───────────────────────────────────────────────────────────
const stageIndicator = document.getElementById('stage-indicator');
const stageFile      = document.getElementById('stage-file');
const stageOcr       = document.getElementById('stage-ocr');
const stageLlm       = document.getElementById('stage-llm');
const stageSave      = document.getElementById('stage-save');

function setStage(filename, stage) {
  // stage: null | 'ocr' | 'llm' | 'save' | 'done'
  if (!filename) { stageIndicator.classList.remove('visible'); return; }
  stageIndicator.classList.add('visible');
  stageFile.textContent = filename;

  const stages = { ocr: stageOcr, llm: stageLlm, save: stageSave };
  const order  = ['ocr', 'llm', 'save'];
  const idx    = order.indexOf(stage);

  for (let i = 0; i < order.length; i++) {
    const el = stages[order[i]];
    el.classList.remove('active', 'done');
    if (stage === 'done' || i < idx)  el.classList.add('done');
    else if (i === idx)               el.classList.add('active');
  }
}

function clearStage() {
  stageIndicator.classList.remove('visible');
  [stageOcr, stageLlm, stageSave].forEach(el => el.classList.remove('active','done'));
}


// ── Title bar controls ───────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click',   () => window.docusnap.windowMinimise());
document.getElementById('btn-max').addEventListener('click',   () => window.docusnap.windowMaximise());
document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Folder picker ────────────────────────────────────────────────────────────
folderBox.addEventListener('click', async () => {
  if (running) return;
  const folder = await window.docusnap.pickFolder();
  if (!folder) return;
  selectedFolder = folder;
  // Display a shortened path
  const parts = folder.replace(/\\/g, '/').split('/');
  const display = parts.length > 3
    ? '…/' + parts.slice(-2).join('/')
    : folder;
  folderDisplay.textContent = display;
  folderDisplay.title       = folder;
  folderDisplay.classList.add('set');
  btnRun.disabled = false;
});

// ── Run button ───────────────────────────────────────────────────────────────
btnRun.addEventListener('click', async () => {
  if (!selectedFolder || running) return;
  startProcessing();
});

// ── Clear button ─────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  results = [];
  stats   = { total: 0, done: 0, ok: 0, err: 0 };
  tableBody.innerHTML = '';
  updateStats();
  resultsPanel.classList.remove('visible');
  logPanel.classList.remove('visible');
  logOutput.innerHTML = '';
  dropzone.style.display = '';
  btnRun.disabled = !selectedFolder;
});

// ── Processing ───────────────────────────────────────────────────────────────
async function startProcessing() {
  running = true;
  btnRun.disabled = true;
  btnRun.textContent = '⏳ Processing…';

  // Reset stats for new run
  stats = { total: 0, done: 0, ok: 0, err: 0 };
  updateStats();

  // Show log panel
  dropzone.style.display = 'none';
  logPanel.classList.add('visible');
  logOutput.innerHTML = '';
  progressBar.style.width = '0';
  logStatus.textContent = 'Running…';

  // Wire up progress events
  window.docusnap.removeProgress();
  window.docusnap.onProgress((msg) => handleProgress(msg));

  await window.docusnap.processFolder(selectedFolder);

  // Done
  running = false;
  btnRun.disabled  = false;
  btnRun.innerHTML = '&#9654;&nbsp; Process Documents';
  clearStage();
  logStatus.textContent = 'Complete';
  progressBar.style.width = '100%';
  appendLog('✓ All documents processed.', 'ok');
}

function handleProgress(msg) {
  switch (msg.type) {

    case 'start':
      stats.total = msg.total;
      updateStats();
      appendLog(`Found ${msg.total} document(s) in folder.`);
      break;

    case 'file_begin':
      appendLog(`→ ${msg.filename}`);
      setStage(msg.filename, 'ocr');
      if (stats.total > 0) {
        progressBar.style.width = ((stats.done / stats.total) * 100) + '%';
      }
      break;

    case 'file_done':
      stats.done++;
      if (msg.success) { stats.ok++; } else { stats.err++; }
      updateStats();
      addTableRow(msg);
      if (stats.total > 0) {
        progressBar.style.width = ((stats.done / stats.total) * 100) + '%';
      }
      setStage(msg.original_filename || msg.new_filename, 'save');
      setTimeout(() => {
        if (stats.done >= stats.total) clearStage();
        else setStage(stageFile.textContent, 'done');
      }, 800);
      if (msg.success) {
        appendLog(`  ✓ → ${msg.new_filename}`, 'ok');
      } else {
        appendLog(`  ✗ Error: ${msg.error}`, 'err');
      }
      // Show results panel once we have at least one result
      resultsPanel.classList.add('visible');
      break;

    case 'log':
      appendLog(msg.text, msg.level || '');
      if (msg.text && msg.text.includes('Extracting fields')) {
        setStage(stageFile.textContent, 'llm');
      } else if (msg.text && msg.text.includes('OCR:')) {
        setStage(stageFile.textContent, 'ocr');
      }
      break;
  }
}

// ── Table row ────────────────────────────────────────────────────────────────
function addTableRow(msg) {
  const tr = document.createElement('tr');

  const statusBadge = msg.success
    ? (msg.needs_review
        ? `<span class="badge warn">⚠ Review</span>`
        : `<span class="badge ok">✓ OK</span>`)
    : `<span class="badge err">✗ Error</span>`;

  const conf = msg.overall_confidence;
  const confClass = !conf ? 'muted' : conf >= 70 ? 'ok' : conf >= 40 ? 'warn' : 'err';
  const confLabel = conf != null ? `<span style="color:var(--${confClass}); font-family:var(--mono); font-size:11px;">${conf}%</span>` : '<span class="muted">—</span>';

  const locationBtn = msg.output_path
    ? `<button class="link-btn" data-path="${escHtml(msg.output_path)}">Show in Explorer</button>`
    : '—';

  tr.innerHTML = `
    <td class="mono" style="${msg.needs_review ? 'color:var(--warn)' : ''}">${escHtml(msg.new_filename || msg.original_filename)}</td>
    <td class="mono">${escHtml(msg.invoice_number || '—')}</td>
    <td class="mono">${escHtml(msg.invoice_date   || '—')}</td>
    <td>${escHtml(msg.supplier_name || '—')}</td>
    <td class="mono">${escHtml(msg.total_amount || '—')} ${escHtml(msg.currency || '')}</td>
    ${confLabel}
      <td>${statusBadge}</td>
    <td>${locationBtn}</td>
  `;

  // Wire up explorer button
  const btn = tr.querySelector('.link-btn');
  if (btn) {
    btn.addEventListener('click', () => window.docusnap.showInExplorer(btn.dataset.path));
  }

  tableBody.prepend(tr);  // newest at top
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function appendLog(text, cls = '') {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateStats() {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-done').textContent  = stats.done;
  document.getElementById('stat-ok').textContent    = stats.ok;
  document.getElementById('stat-err').textContent   = stats.err;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}


// ── Review & settings buttons ─────────────────────────────────────────────────
document.getElementById('btn-review')?.addEventListener('click', () => {
  window.docusnap.openReviewWindow();
});
document.getElementById('btn-settings')?.addEventListener('click', () => {
  window.docusnap.openSettingsWindow();
});

// ── Review count badge ────────────────────────────────────────────────────────
async function refreshReviewBadge() {
  const count = await window.docusnap.getReviewCount();
  const badge = document.getElementById('review-badge');
  if (!badge) return;
  badge.textContent   = count;
  badge.style.display = count > 0 ? '' : 'none';
  document.getElementById('btn-review').style.color = count > 0 ? '#f7b84f' : '';
}
refreshReviewBadge();
window.docusnap.onReviewCountChanged((count) => {
  const badge = document.getElementById('review-badge');
  if (!badge) return;
  badge.textContent   = count;
  badge.style.display = count > 0 ? '' : 'none';
  document.getElementById('btn-review').style.color = count > 0 ? '#f7b84f' : '';
});

// ── Search button ─────────────────────────────────────────────────────────────
document.getElementById('btn-search')?.addEventListener('click', () => {
  window.docusnap.openSearchWindow();
});

// ── Processing mode badge ─────────────────────────────────────────────────────
const modeBadge = document.getElementById('mode-badge');

const MODE_LABELS = {
  fast:  { label: 'FAST',  bg: '#0d2e1e', color: '#3ecf8e', border: '#1a4a2e' },
  smart: { label: 'SMART', bg: '#0d1f3a', color: '#6ea8ff', border: '#1a3a6a' },
  ai:    { label: 'AI',    bg: '#2e1a00', color: '#f7b84f', border: '#4a2e00' },
};

async function updateModeBadge() {
  if (!modeBadge) return;
  const mode = await window.docusnap.getProcessingMode();
  const cfg  = MODE_LABELS[mode] || MODE_LABELS.smart;
  modeBadge.textContent        = cfg.label;
  modeBadge.style.background   = cfg.bg;
  modeBadge.style.color        = cfg.color;
  modeBadge.style.borderColor  = cfg.border;
  modeBadge.title = `Processing mode: ${mode}. Click to change in Settings.`;
}

updateModeBadge();
modeBadge?.addEventListener('click', () => window.docusnap.openSettingsWindow());

window.docusnap.onProcessingModeChanged?.((mode) => updateModeBadge());

// ── Fast Mode suggestion notification ────────────────────────────────────────
async function checkFastModeSuggestion(supplierName) {
  if (!supplierName) return;
  const suggestion = await window.docusnap.checkFastModeSuggestion(supplierName);
  if (!suggestion) return;

  // Show a subtle toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
    background: #13161f; border: 1px solid #3ecf8e; border-radius: 8px;
    padding: 12px 16px; max-width: 320px; font-size: 12px; color: #e2e6f0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  `;
  toast.innerHTML = `
    <div style="font-weight:500; color:#3ecf8e; margin-bottom:6px;">
      ⚡ Switch to Fast Mode?
    </div>
    <div style="color:#7a82a0; margin-bottom:10px; line-height:1.5;">
      You've confirmed ${suggestion.docCount} documents from
      <strong style="color:#e2e6f0">${suggestion.supplier}</strong>.
      Fast Mode will process these instantly without AI.
    </div>
    <div style="display:flex; gap:8px;">
      <button id="toast-fast" style="
        flex:1; padding:6px; border-radius:5px; border:1px solid #3ecf8e;
        background:#0d2e1e; color:#3ecf8e; cursor:pointer; font-size:11px;">
        Switch to Fast Mode
      </button>
      <button id="toast-dismiss" style="
        padding:6px 10px; border-radius:5px; border:1px solid #252836;
        background:transparent; color:#7a82a0; cursor:pointer; font-size:11px;">
        Not now
      </button>
    </div>
  `;
  document.body.appendChild(toast);

  toast.querySelector('#toast-fast').addEventListener('click', async () => {
    await window.docusnap.setProcessingMode('fast');
    updateModeBadge();
    toast.remove();
  });
  toast.querySelector('#toast-dismiss').addEventListener('click', () => toast.remove());

  // Auto-dismiss after 12 seconds
  setTimeout(() => toast.remove(), 12000);
}

// Hook into file_done messages to check Fast Mode suggestion
const _origHandleProgress = handleProgress;
// Override to also check Fast Mode after each confirmed document
window.docusnap.onProgress((msg) => {
  if (msg.type === 'file_done' && msg.success && msg.supplier_name) {
    checkFastModeSuggestion(msg.supplier_name);
  }
});
