'use strict';
// First-run setup wizard. Writes each choice straight to settings (immediate),
// validates the one required step (output folder), then signals main to flip the
// first_run_completed flag and open the app. Everything has a working default so
// a user can click through; "Skip setup" accepts the defaults.

const D = window.docusnap;
const STEPS = 7;               // welcome, output, organization, theme, performance, diagnostics, done
const OUTPUT_STEP = 1;
const NEXT_LABEL = ['Get started', 'Next', 'Next', 'Next', 'Next', 'Next', 'Open Scan Finder'];

const state = { step: 0, outputFolder: '', outputSaved: false,
                theme: 'dark', threads: 2, mode: 'smart',
                copyEnabled: false, copyFolder: '', diag: false,
                folderPattern: '{supplier}/{year}/{month}', filenamePattern: '{docType}.{date}.{ref}' };
let _obTokens = [];

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const panels  = $$('.panel');
const stepsEl = $('#steps');
const nextBtn = $('#nextBtn');
const backBtn = $('#backBtn');
const skipBtn = $('#skipBtn');

// Build the step dots.
for (let i = 0; i < STEPS; i++) {
  const d = document.createElement('div'); d.className = 'dot'; stepsEl.appendChild(d);
}

function paintSelections() {
  $$('[data-theme-choice]').forEach(c => c.classList.toggle('sel', c.dataset.themeChoice === state.theme));
  $$('[data-threads]').forEach(c => c.classList.toggle('sel', Number(c.dataset.threads) === state.threads));
  $$('.card[data-mode]').forEach(c => c.classList.toggle('sel', c.dataset.mode === state.mode));
  $('#outPath').textContent = state.outputFolder || '—';
  $$('[data-copy]').forEach(c => c.classList.toggle('sel', (c.dataset.copy === 'yes') === state.copyEnabled));
  $$('[data-diag]').forEach(c => c.classList.toggle('sel', (c.dataset.diag === 'yes') === state.diag));
  $('#copyPath').textContent = state.copyFolder || '—';
  $('#copyToWrap').style.display = state.copyEnabled ? '' : 'none';
}

function render() {
  panels.forEach(p => p.classList.toggle('show', Number(p.dataset.step) === state.step));
  $$('#steps .dot').forEach((d, i) => {
    d.classList.toggle('active', i === state.step);
    d.classList.toggle('done', i < state.step);
  });
  backBtn.style.display = state.step === 0 ? 'none' : '';
  skipBtn.style.display = state.step >= STEPS - 1 ? 'none' : '';
  nextBtn.textContent = NEXT_LABEL[state.step];
  paintSelections();
}

async function loadCurrent() {
  try { state.theme   = (await D.getSetting('theme')) || 'light'; } catch {}
  try {
    state.outputFolder = (await D.getSetting('output_folder')) || (await D.suggestedOutputFolder()) || '';
  } catch {}
  try { const c = parseInt(await D.getSetting('processing_concurrency'), 10); if (c >= 1) state.threads = c; } catch {}
  // The wizard only offers Thorough (smart) / Quick (fast); map any other stored
  // value (e.g. a legacy 'ai', or an unset/blank) to 'smart' so a card is always
  // selected — otherwise neither Accuracy card highlights and it looks unselectable.
  try { state.mode = (await D.getSetting('processing_mode')) === 'fast' ? 'fast' : 'smart'; } catch {}
  // Processed-scans (drain) folder — where each original is MOVED after it's filed.
  // The SAME `processed_folder` key Settings → Files & filing shows/uses (an explicit
  // value wins; empty → a "Processed" subfolder beside the scans). Reusing the
  // copyEnabled/copyFolder state fields (UI is unchanged) to keep the diff small.
  try { const pf = (await D.getSetting('processed_folder')) || ''; state.copyEnabled = !!pf; state.copyFolder = pf; } catch {}
  try { state.diag = (await D.getSetting('telemetry_enabled')) === 'true'; } catch {}
  try {
    const info = await D.getOutputStructureInfo();
    _obTokens = info.tokens || [];
    state.folderPattern   = (await D.getSetting('output_folder_pattern')) || info.defaultFolder   || state.folderPattern;
    state.filenamePattern = (await D.getSetting('filename_pattern'))       || info.defaultFilename || state.filenamePattern;
  } catch {}
  if (typeof applyTheme === 'function') applyTheme(state.theme);
  setupOrganization();
  render();
}

// ── Output organization (folder + file-name builders) ────────────────────────────
function obRenderTokens(listId, input) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  for (const t of _obTokens) {
    const chip = document.createElement('span');
    chip.className = 'ob-chip';
    chip.title = `Insert ${t.token}`;
    chip.innerHTML = `${t.token}<span class="ob-chip-lbl">${t.label}</span>`;
    chip.addEventListener('click', () => obInsert(input, t.token));
    list.appendChild(chip);
  }
}
function obInsert(input, token) {
  const s = input.selectionStart ?? input.value.length;
  const e = input.selectionEnd   ?? input.value.length;
  input.value = input.value.slice(0, s) + token + input.value.slice(e);
  input.focus();
  input.selectionStart = input.selectionEnd = s + token.length;
  obSaveAndPreview();
}
let _obPreviewDebounce = null;
async function obUpdatePreview() {
  const fEl = $('#ob-folder-pattern'), nEl = $('#ob-filename-pattern'), pEl = $('#ob-output-preview');
  if (!fEl || !nEl || !pEl) return;
  try {
    const root = (await D.getSetting('output_folder')) || state.outputFolder || 'Output folder';
    const r = await D.previewOutputPath(fEl.value.trim(), nEl.value.trim());
    pEl.textContent = [root, ...(r.segments || []), r.filename].join('  ›  ');
  } catch {}
}
async function obSaveAndPreview() {
  const fEl = $('#ob-folder-pattern'), nEl = $('#ob-filename-pattern');
  state.folderPattern   = (fEl.value || '').trim();
  state.filenamePattern = (nEl.value || '').trim();
  try { await D.setSetting('output_folder_pattern', state.folderPattern); } catch {}
  try { await D.setSetting('filename_pattern', state.filenamePattern); } catch {}
  clearTimeout(_obPreviewDebounce);
  _obPreviewDebounce = setTimeout(obUpdatePreview, 250);
}
function setupOrganization() {
  const fEl = $('#ob-folder-pattern'), nEl = $('#ob-filename-pattern');
  if (!fEl || !nEl) return;
  fEl.value = state.folderPattern;
  nEl.value = state.filenamePattern;
  obRenderTokens('ob-folder-tokens', fEl);
  obRenderTokens('ob-filename-tokens', nEl);
  fEl.addEventListener('input', obSaveAndPreview);
  nEl.addEventListener('input', obSaveAndPreview);
  obUpdatePreview();
}

// ── Output folder ──────────────────────────────────────────────────────────────
$('#browseBtn').addEventListener('click', async () => {
  try {
    const picked = await D.pickOutputFolder();
    if (picked) { state.outputFolder = picked; state.outputSaved = false; paintSelections();
      setHint('outHint', 'muted', 'A suggested location is filled in — change it if you like.'); }
  } catch {}
});

function setHint(id, kind, msg) { const el = $('#' + id); el.className = 'hint ' + kind; el.textContent = msg; }

async function commitOutputFolder() {
  if (state.outputSaved) return true;
  const folder = (state.outputFolder || '').trim();
  if (!folder) { setHint('outHint', 'err', 'Please choose a folder to file documents into.'); return false; }
  let res; try { res = await D.validateOutputFolder(folder); } catch { res = { ok: false }; }
  if (!res || !res.ok) {
    setHint('outHint', 'err', res && res.reason === 'not_writable'
      ? "That folder can't be written to — pick another location."
      : "That folder couldn't be used — pick another location.");
    return false;
  }
  try { await D.setSetting('output_folder', folder); } catch {}
  state.outputSaved = true;
  setHint('outHint', 'ok', 'Looks good ✓');
  return true;
}

// ── Processed-scans (drain) folder — where originals move after filing ──────────
$$('[data-copy]').forEach(c => c.addEventListener('click', () => {
  state.copyEnabled = c.dataset.copy === 'yes';
  if (!state.copyEnabled) setHint('copyHint', 'muted', '');
  paintSelections();
}));

$('#copyBrowseBtn').addEventListener('click', async () => {
  try {
    const picked = await D.pickOutputFolder();   // reuse the existing folder picker
    if (picked) { state.copyFolder = picked; setHint('copyHint', 'muted', ''); paintSelections(); }
  } catch {}
});

// Persist `processed_folder`; path required ONLY when enabled. strict=true blocks the
// wizard on a missing path; strict=false (skip / defaults) treats "enabled but no
// path" as disabled so it can never block completion.
async function saveCopySetting(strict) {
  const folder = (state.copyFolder || '').trim();
  if (state.copyEnabled && !folder) {
    if (strict) { setHint('copyHint', 'err', 'Choose a folder, or select Default.'); return false; }
    try { await D.setSetting('processed_folder', ''); } catch {}
    return true;
  }
  // "Choose a folder" → set the drain folder; "Default" → clear it (a "Processed"
  // subfolder beside the scans is used). Writes the real `processed_folder` key so the
  // choice is remembered and shows in Settings → Files & filing.
  try { await D.setSetting('processed_folder', state.copyEnabled ? folder : ''); } catch {}
  return true;
}

// ── Theme ────────────────────────────────────────────────────────────────────
$$('[data-theme-choice]').forEach(c => c.addEventListener('click', async () => {
  state.theme = c.dataset.themeChoice;
  if (typeof applyTheme === 'function') applyTheme(state.theme);
  try { await D.setSetting('theme', state.theme); } catch {}
  paintSelections();
}));

// ── Performance ────────────────────────────────────────────────────────────────
$$('[data-threads]').forEach(c => c.addEventListener('click', async () => {
  state.threads = Number(c.dataset.threads);
  try { await D.setSetting('processing_concurrency', String(state.threads)); } catch {}
  paintSelections();
}));
$$('.card[data-mode]').forEach(c => c.addEventListener('click', async () => {
  state.mode = c.dataset.mode;
  try { await D.setProcessingMode(state.mode); } catch {}
  paintSelections();
}));

// ── Diagnostics consent (opt-in, OFF by default) ────────────────────────────────
$$('[data-diag]').forEach(c => c.addEventListener('click', () => {
  state.diag = c.dataset.diag === 'yes';
  paintSelections();
}));

// ── Navigation ────────────────────────────────────────────────────────────────
async function persistDefaults() {
  // Make sure every default the user clicked past is actually saved.
  try { await D.setSetting('theme', state.theme); } catch {}
  try { await D.setSetting('processing_concurrency', String(state.threads)); } catch {}
  try { await D.setProcessingMode(state.mode); } catch {}
  try { await D.setSetting('output_folder_pattern', state.folderPattern || '{supplier}/{year}/{month}'); } catch {}
  try { await D.setSetting('filename_pattern', state.filenamePattern || '{docType}.{date}.{ref}'); } catch {}
  try { await D.setSetting('telemetry_enabled', state.diag ? 'true' : 'false'); } catch {}
  await saveCopySetting(false);
}

nextBtn.addEventListener('click', async () => {
  if (state.step === OUTPUT_STEP) {                       // required gate (+ copy validation)
    if (!(await commitOutputFolder())) return;
    if (!(await saveCopySetting(true))) return;
  }
  if (state.step >= STEPS - 1) { await persistDefaults(); D.onboardingComplete(); return; }
  state.step += 1; render();
});

backBtn.addEventListener('click', () => { if (state.step > 0) { state.step -= 1; render(); } });

skipBtn.addEventListener('click', async () => {
  // Skip = accept defaults, but the output folder is still required: commit the
  // suggested one; if it can't be used, drop the user on the output step.
  if (!(await commitOutputFolder())) { state.step = OUTPUT_STEP; render(); return; }
  await persistDefaults();
  D.onboardingComplete();
});

loadCurrent();
