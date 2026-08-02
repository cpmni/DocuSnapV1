'use strict';
// Stamped-copy secure viewer (owner 2026-08-02): page IMAGES fetched by ROUTE ID over
// workflow-stamped-pages — the main process resolves the file server-side; no path, no PDF
// bytes, and no shell handoff ever reach this window. "Save a copy…" is the single audited
// egress (main-process save dialog + audit row). Escape closes (the About-box precedent).

let _routeId = null;
let _zoom = 100;

const state = document.getElementById('state');
const pagesEl = document.getElementById('pages');

function showState(msg) { state.style.display = ''; state.textContent = msg; }
function hideState() { state.style.display = 'none'; }

async function load(routeId) {
  _routeId = Number(routeId) || null;
  pagesEl.innerHTML = '';
  if (!_routeId) { showState('Nothing to show — open a stamped copy from the Mailbox.'); return; }
  state.style.display = '';
  state.innerHTML = '<div class="spinner" style="margin:0 auto"></div>';
  let res = null;
  try { res = await window.docusnap.workflow.stampedPages(_routeId); }
  catch (e) {
    const m = String(e && e.message || '');
    showState(m.includes('FORBIDDEN') || m.includes('Not permitted')
      ? 'You don’t have access to this stamped copy.'
      : 'Couldn’t load the stamped copy.');
    return;
  }
  if (!res || !res.ok) {
    showState('The stamped copy for this decision is missing — it may have been moved or deleted on disk.');
    return;
  }
  hideState();
  document.getElementById('title').textContent =
    `Stamped copy — ${res.state === 'approved' ? 'Approved' : res.state === 'rejected' ? 'Rejected' : res.state}`;
  for (const p of (res.pages || [])) {
    const img = document.createElement('img');
    img.className = 'page';
    img.src = p;
    pagesEl.appendChild(img);
  }
  applyZoom();
  if (!pagesEl.children.length) showState('No pages could be rendered for this stamped copy.');
}

function applyZoom() {
  document.querySelectorAll('#pages .page').forEach((img) => {
    img.style.maxWidth = 'none';
    img.style.width = `${_zoom}%`;
  });
  document.getElementById('zoom-label').textContent = `${_zoom}%`;
}

document.getElementById('zoom-in').addEventListener('click', () => { _zoom = Math.min(300, _zoom + 20); applyZoom(); });
document.getElementById('zoom-out').addEventListener('click', () => { _zoom = Math.max(40, _zoom - 20); applyZoom(); });
document.getElementById('close').addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

document.getElementById('save').addEventListener('click', async () => {
  const btn = document.getElementById('save');
  btn.disabled = true;
  try {
    const r = await window.docusnap.workflow.exportStamped(_routeId);
    btn.textContent = r && r.ok ? '✓ Saved' : 'Save a copy…';
  } catch { btn.textContent = 'Save a copy…'; }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Save a copy…'; }, 2500);
});

// Open cold at the pending target, and follow retargets while already open.
window.docusnap.getStampedViewerTarget().then((id) => load(id)).catch(() => showState('Couldn’t load the stamped copy.'));
window.docusnap.onStampedViewerLoad((id) => load(id));
