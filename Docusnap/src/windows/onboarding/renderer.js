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
let folderEditor = null, filenameEditor = null;   // shared/pattern-editor.js pill editors

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
  // Refresh the filing preview whenever its step shows — it must reflect a folder chosen
  // one step earlier (setupOrganization only ran once at boot).
  if (panels.some(p => Number(p.dataset.step) === state.step && p.querySelector('#ob-output-preview'))) {
    try { obUpdatePreview(); } catch { /* preview is best-effort */ }
  }
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
  // Map the three Speed cards to REAL concurrency for THIS PC: Gentle=1, Balanced≈half, Fast=the full
  // recommended (cores minus headroom). A hardcoded Fast=4 both under-used a powerful PC AND matched
  // NO card on a high-core box (recommended 14 != 1/2/4) so nothing highlighted — the "no blue
  // suggestion" report. DEFAULT = Fast (the suggested speed); a previously-stored choice wins, snapped
  // to the nearest tier so a card ALWAYS highlights. Click-handler + highlight both read data-threads,
  // so updating it here is enough.
  let _rec = 4;
  try { const info = await D.getConcurrencyInfo(); if (info && info.recommended >= 1) _rec = info.recommended; } catch {}
  const _fast = Math.max(4, _rec), _bal = Math.min(_fast - 1, Math.max(2, Math.round(_fast / 2)));
  const _speedCards = $$('[data-threads]');                 // DOM order: Gentle, Balanced, Fast
  if (_speedCards.length === 3) { _speedCards[1].dataset.threads = String(_bal); _speedCards[2].dataset.threads = String(_fast); }
  state.threads = _fast;                                    // default: Fast (the blue suggestion)
  try { const c = parseInt(await D.getSetting('processing_concurrency'), 10);
        if (c >= 1) state.threads = [1, _bal, _fast].reduce((a, b) => Math.abs(b - c) <= Math.abs(a - c) ? b : a); } catch {}
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
function obRenderTokens(listId, editor) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  for (const t of _obTokens) {
    const chip = document.createElement('span');
    chip.className = 'pe-chip';                     // a friendly "block" — no {token} code on screen
    chip.title = `Add ${t.label}`;
    chip.textContent = t.short || t.label;
    chip.addEventListener('mousedown', (e) => e.preventDefault());   // keep the caret in the field
    chip.addEventListener('click', () => editor.insertToken(t.token));
    list.appendChild(chip);
  }
}
let _obPreviewDebounce = null;
async function obUpdatePreview() {
  const pEl = $('#ob-output-preview');
  if (!pEl || !folderEditor || !filenameEditor) return;
  try {
    // The WIZARD'S chosen folder wins over the saved setting (which is only written at
    // finish) — the old order kept showing the stale saved root after the user changed
    // the folder on the previous step (Chris r5).
    const root = state.outputFolder || (await D.getSetting('output_folder')) || 'Output folder';
    const r = await D.previewOutputPath(folderEditor.getValue().trim(), filenameEditor.getValue().trim());
    pEl.textContent = [root, ...(r.segments || []), r.filename].join('  ›  ');
  } catch {}
}
async function obSaveAndPreview() {
  if (!folderEditor || !filenameEditor) return;
  state.folderPattern   = (folderEditor.getValue() || '').trim();
  state.filenamePattern = (filenameEditor.getValue() || '').trim();
  try { await D.setSetting('output_folder_pattern', state.folderPattern); } catch {}
  try { await D.setSetting('filename_pattern', state.filenamePattern); } catch {}
  clearTimeout(_obPreviewDebounce);
  _obPreviewDebounce = setTimeout(obUpdatePreview, 250);
}
// Swap the two raw "{token}/…" text inputs for pill editors (shared/pattern-editor.js):
// each known token renders as a friendly block; separators/custom text stay typed. The
// STORED value is still the same pattern string, so preview + filing are unchanged.
function setupOrganization() {
  const fEl = $('#ob-folder-pattern'), nEl = $('#ob-filename-pattern');
  if (!fEl || !nEl) return;
  if (typeof window.createPatternEditor !== 'function') return;   // widget missing → keep saved defaults
  if (!folderEditor) folderEditor = window.createPatternEditor(fEl,
    { tokens: _obTokens, onChange: obSaveAndPreview, placeholder: 'Click a block below, or type — use / for a new folder level' });
  if (!filenameEditor) filenameEditor = window.createPatternEditor(nEl,
    { tokens: _obTokens, onChange: obSaveAndPreview, placeholder: 'Click a block below, or type' });
  folderEditor.setValue(state.folderPattern);
  filenameEditor.setValue(state.filenamePattern);
  obRenderTokens('ob-folder-tokens', folderEditor);
  obRenderTokens('ob-filename-tokens', filenameEditor);
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

// ── Region (date order + number format) ────────────────────────────────────────
// Set at first-run so US/EU documents parse correctly from the very first import; both
// default to the historical UK/EU behaviour, changeable later in Settings → Processing.
const _obDateOrder = document.getElementById('ob-date-order');
const _obNumFmt    = document.getElementById('ob-number-format');
(async () => {
  try { const v = (await D.getSetting('region_date_order') || 'dmy'); if (_obDateOrder) _obDateOrder.value = ['dmy','mdy','ymd'].includes(v) ? v : 'dmy'; } catch {}
  try { const v = (await D.getSetting('region_number_format') || 'anglo'); if (_obNumFmt) _obNumFmt.value = ['anglo','continental','french','swiss','indian'].includes(v) ? v : 'anglo'; } catch {}
})();
_obDateOrder?.addEventListener('change', async () => { try { await D.setSetting('region_date_order', _obDateOrder.value); } catch {} });
_obNumFmt?.addEventListener('change', async () => { try { await D.setSetting('region_number_format', _obNumFmt.value); } catch {} });

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
