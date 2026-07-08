// First-run familiarisation tour — a short 6-card carousel. Read-only: it teaches
// the ideas and writes no settings; closing it sets the `welcome_seen` flag in main.
const D = window.docusnap;
const STEPS = 6;
let step = 0;

const cards   = [...document.querySelectorAll('.wcard')];
const dotsEl  = document.getElementById('dots');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
const skipBtn = document.getElementById('skip');

// A secondary "Import my documents" sits beside the primary CTA on the last card only.
// (The primary CTA on the last card offers the guided practice run instead.)
const exploreBtn = document.createElement('button');
exploreBtn.className = 'btn ghost';
exploreBtn.textContent = 'Import my documents';
exploreBtn.style.display = 'none';
nextBtn.parentNode.insertBefore(exploreBtn, nextBtn);

for (let i = 0; i < STEPS; i++) { const d = document.createElement('span'); d.className = 'dot'; dotsEl.appendChild(d); }
const dots = [...dotsEl.children];

function render() {
  cards.forEach(c => c.classList.toggle('on', +c.dataset.step === step));
  dots.forEach((d, i) => d.classList.toggle('on', i === step));
  backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
  const last = step === STEPS - 1;
  nextBtn.textContent = last ? 'Try a practice run' : 'Next';
  exploreBtn.style.display = last ? '' : 'none';
}

function finish(action) { try { D.welcomeDone(action); } catch {} }

backBtn.addEventListener('click', () => { if (step > 0) { step--; render(); } });
nextBtn.addEventListener('click', () => { if (step < STEPS - 1) { step++; render(); } else finish('practice'); });
exploreBtn.addEventListener('click', () => finish('import'));
skipBtn.addEventListener('click', () => finish('close'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' && step < STEPS - 1) { step++; render(); }
  else if (e.key === 'ArrowLeft' && step > 0) { step--; render(); }
  else if (e.key === 'Escape') finish('close');
});

render();
