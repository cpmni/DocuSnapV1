'use strict';
// First-run setup wizard. Writes each choice straight to settings (immediate),
// validates the one required step (output folder), then signals main to flip the
// first_run_completed flag and open the app. Everything has a working default so
// a user can click through; "Skip setup" accepts the defaults.

const D = window.docusnap;
const STEPS = 5;               // welcome, output, theme, performance, done
const OUTPUT_STEP = 1;
const NEXT_LABEL = ['Get started', 'Next', 'Next', 'Next', 'Open Scan Finder'];

const state = { step: 0, outputFolder: '', outputSaved: false,
                theme: 'dark', threads: 2, mode: 'smart' };

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
  $$('[data-mode]').forEach(c => c.classList.toggle('sel', c.dataset.mode === state.mode));
  $('#outPath').textContent = state.outputFolder || '—';
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
  try { state.theme   = (await D.getSetting('theme')) || 'dark'; } catch {}
  try {
    state.outputFolder = (await D.getSetting('output_folder')) || (await D.suggestedOutputFolder()) || '';
  } catch {}
  try { const c = parseInt(await D.getSetting('processing_concurrency'), 10); if (c >= 1) state.threads = c; } catch {}
  try { state.mode = (await D.getSetting('processing_mode')) || 'smart'; } catch {}
  if (typeof applyTheme === 'function') applyTheme(state.theme);
  render();
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
$$('[data-mode]').forEach(c => c.addEventListener('click', async () => {
  state.mode = c.dataset.mode;
  try { await D.setProcessingMode(state.mode); } catch {}
  paintSelections();
}));

// ── Navigation ────────────────────────────────────────────────────────────────
async function persistDefaults() {
  // Make sure every default the user clicked past is actually saved.
  try { await D.setSetting('theme', state.theme); } catch {}
  try { await D.setSetting('processing_concurrency', String(state.threads)); } catch {}
  try { await D.setProcessingMode(state.mode); } catch {}
}

nextBtn.addEventListener('click', async () => {
  if (state.step === OUTPUT_STEP && !(await commitOutputFolder())) return;   // required gate
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
