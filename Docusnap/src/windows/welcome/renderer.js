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

// A secondary "Explore on my own" sits beside the primary CTA on the last card only.
const exploreBtn = document.createElement('button');
exploreBtn.className = 'btn ghost';
exploreBtn.textContent = 'Explore on my own';
exploreBtn.style.display = 'none';
nextBtn.parentNode.insertBefore(exploreBtn, nextBtn);

for (let i = 0; i < STEPS; i++) { const d = document.createElement('span'); d.className = 'dot'; dotsEl.appendChild(d); }
const dots = [...dotsEl.children];

function render() {
  cards.forEach(c => c.classList.toggle('on', +c.dataset.step === step));
  dots.forEach((d, i) => d.classList.toggle('on', i === step));
  backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
  const last = step === STEPS - 1;
  nextBtn.textContent = last ? 'Go to Import' : 'Next';
  exploreBtn.style.display = last ? '' : 'none';
}

function finish(action) { try { D.welcomeDone(action); } catch {} }

backBtn.addEventListener('click', () => { if (step > 0) { step--; render(); } });
nextBtn.addEventListener('click', () => { if (step < STEPS - 1) { step++; render(); } else finish('import'); });
exploreBtn.addEventListener('click', () => finish('close'));
skipBtn.addEventListener('click', () => finish('close'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' && step < STEPS - 1) { step++; render(); }
  else if (e.key === 'ArrowLeft' && step > 0) { step--; render(); }
  else if (e.key === 'Escape') finish('close');
});

render();
