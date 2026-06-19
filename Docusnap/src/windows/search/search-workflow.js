'use strict';
// Workflow actions for the enhanced (licensed) Search preview. Reuses the in-core
// workflow IPC (window.docusnap.workflow.* → workflowService). Registers an action
// provider with SearchActions that renders, for the selected document, either a
// DECISION BAR (when the doc is routed to me) or a ROUTE/ASSIGN form (admin/edit).
// Inert unless the workflow add-on is licensed (SearchState.entitled).

let _recipients = [];                 // active users (populated only for routers)
let _myOpenRoutes = {};               // document_id -> open route addressed to me

const _canDecide = () => window.SearchState.role === 'admin' || window.SearchState.role === 'edit';

async function init() {
  if (!window.SearchState.entitled) return;
  await refresh();
  window.SearchActions.registerActionProvider(_provide);
}

async function refresh() {
  try {
    const [inbox, assigned] = await Promise.all([
      window.docusnap.workflow.inbox(), window.docusnap.workflow.assigned(),
    ]);
    const open = {};
    for (const r of [...(inbox || []), ...(assigned || [])]) {
      if (r.state === 'pending' || r.state === 'claimed') open[r.document_id] = r;
    }
    _myOpenRoutes = open; window.SearchState.myOpenRoutes = open;
  } catch { _myOpenRoutes = {}; }
  try { _recipients = await window.docusnap.workflow.recipients(); } catch { _recipients = []; }
}

// Re-render the action panel for the currently selected document.
function _rerender() {
  if (window.SearchState.selectedDoc) window.SearchActions.renderActions(window.SearchState.selectedDoc);
}

const _run = async (promise, wrap) => {
  try {
    await promise; await refresh(); _rerender();
    if (window.SearchMailbox && window.SearchMailbox.refreshIfActive) window.SearchMailbox.refreshIfActive();
  } catch (e) { _err(wrap, e); }
};
function _err(wrap, e) {
  let n = wrap.querySelector('.wf-err');
  if (!n) { n = document.createElement('div'); n.className = 'wf-err'; wrap.appendChild(n); }
  n.textContent = (e && e.message) || 'Action failed.';
}
function _btn(label, primary, onClick) {
  const b = document.createElement('button');
  b.className = 'action-btn' + (primary ? ' primary' : '');
  b.textContent = label; b.addEventListener('click', onClick);
  return b;
}

function _provide(doc) {
  if (!window.SearchState.entitled) return [];
  const route = _myOpenRoutes[doc.id];
  if (route) return [{ node: _decisionBar(route) }];
  if (_recipients.length) return [{ node: _assignForm(doc) }]; // recipients only returned to admin/edit
  return [];
}

function _decisionBar(route) {
  const wrap = document.createElement('div'); wrap.className = 'wf-decision';
  const kind = route.action_required === 'approve' ? 'Approval requested' : 'Acknowledgement requested';
  const banner = document.createElement('div'); banner.className = 'wf-banner';
  banner.textContent = `Routed to you by ${route.from_username} — ${kind}`
    + (route.comment ? `: “${route.comment}”` : '');
  wrap.appendChild(banner);
  const acts = document.createElement('div'); acts.className = 'wf-acts'; wrap.appendChild(acts);

  if (route.action_required === 'acknowledge') {
    acts.appendChild(_btn('Acknowledge', true, () =>
      _run(window.docusnap.workflow.resolve(route.id, 'acknowledge', null, route.version), wrap)));
  } else if (_canDecide()) {
    acts.appendChild(_btn('Approve', true, () =>
      _run(window.docusnap.workflow.resolve(route.id, 'approve', null, route.version), wrap)));
    acts.appendChild(_btn('Reject', false, () => _showReject(wrap, route)));
  }
  return wrap;
}

function _showReject(wrap, route) {
  if (wrap.querySelector('.wf-reason')) return;
  const box = document.createElement('div'); box.className = 'wf-reason';
  const inp = document.createElement('input'); inp.className = 'search-input'; inp.placeholder = 'Reason for rejecting (required)';
  const go = _btn('Confirm reject', true, () => {
    const reason = inp.value.trim(); if (!reason) { inp.focus(); return; }
    _run(window.docusnap.workflow.resolve(route.id, 'reject', reason, route.version), wrap);
  });
  box.append(inp, go); wrap.appendChild(box); inp.focus();
}

function _assignForm(doc) {
  const wrap = document.createElement('div'); wrap.className = 'wf-assign';
  const sub = document.createElement('div'); sub.className = 'wf-sub'; sub.textContent = 'Route for approval / acknowledgement';
  const sel = document.createElement('select'); sel.className = 'search-input';
  for (const u of _recipients) { const o = document.createElement('option'); o.value = u.id; o.textContent = `${u.displayName || u.username} (${u.role})`; sel.appendChild(o); }
  const act = document.createElement('select'); act.className = 'search-input';
  [['approve', 'Approve'], ['acknowledge', 'Acknowledge']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; act.appendChild(o); });
  const note = document.createElement('input'); note.className = 'search-input'; note.placeholder = 'Note (optional)';
  const go = _btn('Route…', true, () =>
    _run(window.docusnap.workflow.assign(doc.id, Number(sel.value), act.value, note.value.trim() || undefined), wrap));
  wrap.append(sub, sel, act, note, go);
  return wrap;
}

window.SearchWorkflow = { init, refresh };
