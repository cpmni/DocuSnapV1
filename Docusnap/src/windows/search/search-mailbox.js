'use strict';
// Mailbox view for the enhanced (licensed) Search window. Toggles the results pane
// between search results and approval-route lists (Inbox/Sent/Assigned/Completed),
// reusing the workflow IPC. Selecting a route loads the document into the preview,
// where search-workflow's decision bar handles approve/reject/acknowledge.
// Inert unless the workflow add-on is licensed (SearchState.workflowEntitled).

let _active = false;
let _box = 'inbox';

// _mbInit, not `init`: search-workflow.js also declares a top-level `init` in this window's
// shared global scope — benign today only because each namespace export captures its own
// binding at eval time, but one bare call or load-order change flips it. Unique names only
// (pinned by test_no_global_collisions.js).
function _mbInit() {
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
  scroll.querySelectorAll('.section-header, .result-item, .section-capped-note').forEach(el => el.remove());   // capped-note too — a leftover "first 200 matches" line above a 4-item Inbox (Chris r4)
  let routes = [];
  try { routes = await window.docusnap.workflow[_box](); } catch { routes = []; }
  if (!routes.length) { empty.style.display = ''; empty.textContent = `Nothing in ${_box}`; return; }
  empty.style.display = 'none';
  for (const r of routes) scroll.appendChild(_routeItem(r));
}

function _routeItem(r) {
  const el = document.createElement('div'); el.className = 'result-item'; el.dataset.id = r.document_id;
  const title = r.supplier_name || ('Document #' + r.document_id);
  const kind  = r.action_required === 'approve' ? 'Approval' : 'For information';
  const who   = _box === 'sent' ? `to ${r.to_username}` : `from ${r.from_username}`;
  // Chip LABEL only — the CSS class keeps the raw state (styling keys off it). 'seen' is the
  // human word for a resolved FYI (Barry, FYI slice).
  const stateLabel = r.state === 'acknowledged' ? 'seen' : r.state;
  // Sender-side row actions (Slice 1). listSent is sender-scoped BY QUERY, so these are
  // safe to show without knowing the current user id. (A rejected route in Completed gets
  // its actions via its Sent twin — listSent has no state filter.)
  const rowActs = _box === 'sent'
    ? (r.state === 'pending'  ? `<button class="wf-stamp-link wf-recall" type="button">Recall</button>` : '')
      + (r.state === 'rejected' ? `<button class="wf-stamp-link wf-resend" type="button">Send again</button>` : '')
    : '';
  el.innerHTML = `
    <div class="result-header">
      <span class="result-supplier" title="${escHtml(title)}">${escHtml(title)}</span>
      <span class="wf-state ${escHtml(r.state)}">${escHtml(stateLabel)}</span>
    </div>
    <div class="result-filename">${escHtml(kind)} · ${escHtml(who)}</div>${
      r.resolution_comment ? `
    <div class="result-filename wf-reason" title="${escHtml(r.resolution_comment)}">Reason: ${escHtml(r.resolution_comment)}</div>` : ''}
    <div class="result-footer"><span class="result-date">${escHtml(r.doc_date || '')}</span>${rowActs}${
      r.stamped_path ? `<button class="wf-stamp-link wf-stamp" type="button">View stamped copy</button>` : ''}</div>`;
  el.addEventListener('click', async () => {
    document.querySelectorAll('.result-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const full = await window.docusnap.getDocumentWithExtractions(r.document_id);
    if (full) window.SearchPreview.selectDoc(full);
  });
  // Row buttons must never trigger the row's open-document click (stamp-link precedent).
  // The stamped decision copy lives locally on this PC — open it directly.
  el.querySelector('.wf-stamp')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.docusnap.openFile(r.stamped_path);
  });
  el.querySelector('.wf-recall')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.SearchWorkflow.recallRoute(r);   // _run refreshes the open mailbox itself
  });
  el.querySelector('.wf-resend')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.result-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    window.SearchWorkflow.queueResubmit(r);
  });
  return el;
}

// Called by search-workflow after an action resolves, so the list stays current.
function refreshIfActive() { if (_active) render(); }

window.SearchMailbox = { init: _mbInit, refreshIfActive };
