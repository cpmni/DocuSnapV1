'use strict';
// Mailbox view for the enhanced (licensed) Search window. Toggles the results pane
// between search results and approval-route lists (Inbox/Sent/Assigned/Completed),
// reusing the workflow IPC. Selecting a route loads the document into the preview,
// where search-workflow's decision bar handles approve/reject/acknowledge.
// Inert unless the workflow add-on is licensed (SearchState.workflowEntitled).

let _active = false;
let _box = 'inbox';

function init() {
  if (!window.SearchState.workflowEntitled) return;
  const btn = document.getElementById('btn-mailbox');
  if (!btn) return;
  btn.style.display = '';
  btn.addEventListener('click', toggle);
  document.querySelectorAll('#mailbox-tabs .mb-tab').forEach(t =>
    t.addEventListener('click', () => setBox(t.dataset.box)));
}

function toggle() {
  _active = !_active;
  document.body.classList.toggle('mailbox-mode', _active);
  document.getElementById('mailbox-tabs').style.display = _active ? '' : 'none';
  document.getElementById('btn-mailbox').textContent = _active ? 'Back to search' : 'Mailbox';
  if (_active) setBox(_box);
  else window.SearchQuery.doSearch();
}

function setBox(box) {
  _box = box;
  document.querySelectorAll('#mailbox-tabs .mb-tab').forEach(t => t.classList.toggle('active', t.dataset.box === box));
  render();
}

async function render() {
  const scroll = document.getElementById('results-scroll');
  const empty  = document.getElementById('results-empty');
  scroll.querySelectorAll('.section-header, .result-item').forEach(el => el.remove());
  let routes = [];
  try { routes = await window.docusnap.workflow[_box](); } catch { routes = []; }
  if (!routes.length) { empty.style.display = ''; empty.textContent = `Nothing in ${_box}`; return; }
  empty.style.display = 'none';
  for (const r of routes) scroll.appendChild(_routeItem(r));
}

function _routeItem(r) {
  const el = document.createElement('div'); el.className = 'result-item'; el.dataset.id = r.document_id;
  const title = r.supplier_name || ('Document #' + r.document_id);
  const kind  = r.action_required === 'approve' ? 'Approval' : 'Acknowledgement';
  const who   = _box === 'sent' ? `to ${r.to_username}` : `from ${r.from_username}`;
  el.innerHTML = `
    <div class="result-header">
      <span class="result-supplier" title="${escHtml(title)}">${escHtml(title)}</span>
      <span class="wf-state ${escHtml(r.state)}">${escHtml(r.state)}</span>
    </div>
    <div class="result-filename">${escHtml(kind)} · ${escHtml(who)}</div>
    <div class="result-footer"><span class="result-date">${escHtml(r.doc_date || '')}</span></div>`;
  el.addEventListener('click', async () => {
    document.querySelectorAll('.result-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const full = await window.docusnap.getDocumentWithExtractions(r.document_id);
    if (full) window.SearchPreview.selectDoc(full);
  });
  return el;
}

// Called by search-workflow after an action resolves, so the list stays current.
function refreshIfActive() { if (_active) render(); }

window.SearchMailbox = { init, refreshIfActive };
