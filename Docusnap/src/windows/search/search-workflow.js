'use strict';
// Workflow actions for the enhanced (licensed) Search preview. Reuses the in-core
// workflow IPC (window.docusnap.workflow.* → workflowService). Registers an action
// provider with SearchActions that renders, for the selected document, either a
// DECISION BAR (when the doc is routed to me) or a ROUTE/ASSIGN form (admin/edit).
// Inert unless the workflow add-on is licensed (SearchState.workflowEntitled).

let _recipients = [];                 // active users (populated only for routers)
let _myOpenRoutes = {};               // document_id -> open route addressed to me
let _pendingResubmit = null;          // one-shot "Send again" prefill (consumed by the next render)

const _canDecide = () => window.SearchState.role === 'admin' || window.SearchState.role === 'edit';

async function init() {
  if (!window.SearchState.workflowEntitled) return;
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

// Strip Electron's unhelpful invoke prefix before showing a service error to the user.
const _stripIpc = (m) => String(m || 'Action failed.')
  .replace(/^Error invoking remote method '[^']+':\s*/, '')
  .replace(/^Error:\s*/, '');
// ALWAYS refresh after an action — success OR failure (eric, Slice 1): on a CAS CONFLICT
// the stale decision bar (old version) must not survive or the user retries into the same
// CONFLICT forever. The error is re-shown on the FRESH panel after the re-render.
const _run = async (promise) => {
  let errMsg = null;
  try { await promise; }
  catch (e) { errMsg = _stripIpc(e && e.message); }
  await refresh(); _rerender();
  if (window.SearchMailbox && window.SearchMailbox.refreshIfActive) window.SearchMailbox.refreshIfActive();
  if (errMsg) {
    // .wf-routed = the admin route-banner container — it carries the class FROM CREATION
    // (sync) and populates append-only, so an error attached here survives the async fill
    // (Oracle OC1: without both halves a cancel CONFLICT/INVALID would vanish silently).
    const panel = document.querySelector('#preview-actions .wf-decision, #preview-actions .wf-assign, #preview-actions .wf-routed');
    if (panel) _err(panel, errMsg);
  }
};
function _err(wrap, msg) {
  let n = wrap.querySelector('.wf-err');
  if (!n) { n = document.createElement('div'); n.className = 'wf-err'; wrap.appendChild(n); }
  n.textContent = msg;   // textContent, never innerHTML — the message can echo user input
}
// _wfBtn, NOT _btn: these are classic scripts sharing ONE global scope, and search-actions.js
// already owns _btn (different signature - container-appending). This file loading LAST meant
// its 3-arg _btn silently shadowed the panel's, and every Document-Actions button (Open in
// Explorer / Open File / Send back / Delete / Restore) appended NOTHING - the section-drop
// guard then hid the whole panel. Pinned by test_no_global_collisions.js - never redeclare
// another file's top-level helper name.
function _wfBtn(label, primary, onClick) {
  const b = document.createElement('button');
  b.className = 'action-btn' + (primary ? ' primary' : '');
  b.textContent = label; b.addEventListener('click', onClick);
  return b;
}

function _provide(doc) {
  if (!window.SearchState.workflowEntitled) return [];
  // One-shot resubmit prefill (Slice 1): consumed — or discarded — by the very next render.
  const pending = (_pendingResubmit && _pendingResubmit.docId === doc.id) ? _pendingResubmit : null;
  _pendingResubmit = null;
  const route = _myOpenRoutes[doc.id];
  if (route) return [{ node: _decisionBar(route) }];
  if (pending && _recipients.length) {
    return [{ node: _assignForm(doc, pending.toUsername, {
      tag: 'previous recipient', title: 'Send again — the previous request was rejected',
      actionRequired: pending.actionRequired, resubmitOf: pending.resubmitOf }) }];
  }
  if (_recipients.length) return [{ node: _routeOrAssign(doc) }]; // recipients only returned to admin/edit
  return [];
}

// E1 (docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md): the assign-form slot is now a
// SELF-POPULATING container — sync-returned (SearchActions providers are sync), then an async
// workflow-doc-routes read decides: open route(s) NOT mine → one banner per route ("Routed to
// <name> — awaiting …") with an admin-only two-step [Cancel route]; no open route → the
// existing assign form. Renders NOTHING until the IPC resolves (never swap a form under typing
// hands — eric). Class 'wf-routed' sits on the container FROM CREATION and population is
// APPEND-ONLY so a `.wf-err` attached by _run survives the fill (Oracle OC1).
function _routeOrAssign(doc) {
  const wrap = document.createElement('div'); wrap.className = 'wf-routed';
  window.docusnap.workflow.docRoutes(doc.id).then((routes) => {
    // Staleness guards: renderActions wipes the panel on re-render (isConnected), and a fast
    // re-selection during the invoke round-trip must not paint the wrong doc's routes.
    if (!wrap.isConnected || !window.SearchState.selectedDoc || window.SearchState.selectedDoc.id !== doc.id) return;
    const open = (routes || []).filter(r => r.state === 'pending' || r.state === 'claimed');
    if (!open.length) { wrap.appendChild(_assignForm(doc)); return; }
    for (const r of open) wrap.appendChild(_routedBanner(r));
  }).catch(() => {
    if (wrap.isConnected) wrap.appendChild(_assignForm(doc));   // read failed → fall back to the old behaviour
  });
  return wrap;
}

function _routedBanner(r) {
  const row = document.createElement('div'); row.className = 'wf-decision';
  const banner = document.createElement('div'); banner.className = 'wf-banner';
  banner.textContent = `Routed to ${r.to_username} by ${r.from_username || 'Auto-filed'} — awaiting ${r.action_required === 'approve' ? 'approval' : 'information'}`;
  row.appendChild(banner);
  if (window.SearchState.role === 'admin') {
    const acts = document.createElement('div'); acts.className = 'wf-acts'; row.appendChild(acts);
    // Two-step inline confirm (NO native confirm() — the Search window is an unarmed
    // focus-desync site). First click arms, ~5s auto-revert; second click cancels. A stale
    // cancel lands as a truthful INVALID/CONFLICT that _run re-shows on the fresh panel.
    const btn = _wfBtn('Cancel route', false, () => {
      if (btn.dataset.armed) { _run(window.docusnap.workflow.adminCancel(r.id, r.version)); return; }
      btn.dataset.armed = '1'; btn.textContent = `Confirm — remove from ${r.to_username}'s inbox`;
      btn.classList.add('danger');
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Cancel route'; btn.classList.remove('danger'); } }, 5000);
    });
    acts.appendChild(btn);
  }
  return row;
}

function _decisionBar(route) {
  const wrap = document.createElement('div'); wrap.className = 'wf-decision';
  const kind = route.action_required === 'approve' ? 'Approval requested' : 'For your information';
  const banner = document.createElement('div'); banner.className = 'wf-banner';
  banner.textContent = `Routed to you by ${route.from_username} — ${kind}`
    + (route.comment ? `: “${route.comment}”` : '');
  wrap.appendChild(banner);
  let note = null;
  if (route.action_required === 'approve' && _canDecide()) {
    note = document.createElement('input'); note.className = 'search-input wf-note';
    note.placeholder = 'Add a note (optional — required to reject)';
    wrap.appendChild(note);
  }
  const acts = document.createElement('div'); acts.className = 'wf-acts'; wrap.appendChild(acts);
  const decide = (decision) => {
    const n = note ? note.value.trim() : '';
    if (decision === 'reject' && !n) { note.focus(); return; }
    _run(window.docusnap.workflow.resolve(route.id, decision, n || null, route.version));
  };

  if (route.action_required === 'acknowledge') {
    // Display copy only — the resolve decision string stays 'acknowledge' (DB/IPC contract).
    acts.appendChild(_wfBtn('Got it', true, () =>
      _run(window.docusnap.workflow.resolve(route.id, 'acknowledge', null, route.version))));
  } else if (_canDecide()) {
    acts.appendChild(_wfBtn('Approve', true, () => decide('approve')));
    acts.appendChild(_wfBtn('Reject', false, () => decide('reject')));
  }
  // Disposition: route back to the sender or on to another user (reuses the assign form,
  // with the sender pre-selected for a route-back). Admin/edit only.
  if (_canDecide()) {
    acts.appendChild(_wfBtn('Forward…', false, () => {
      if (wrap.querySelector('.wf-assign')) return;
      wrap.appendChild(_assignForm({ id: route.document_id }, route.from_username));
    }));
  }
  return wrap;
}

// Generalised prefill (Slice 1, eric): `preselectUsername` marks + selects ANY recipient
// (Forward… passes the original SENDER for a route-back; Send-again passes the original
// RECIPIENT) — opts { tag, title, actionRequired, resubmitOf } label and prefill the rest.
function _assignForm(doc, preselectUsername, opts = {}) {
  const wrap = document.createElement('div'); wrap.className = 'wf-assign';
  const sub = document.createElement('div'); sub.className = 'wf-sub';
  sub.textContent = opts.title || (preselectUsername ? 'Forward / route onward' : 'Route for approval / for information');
  const sel = document.createElement('select'); sel.className = 'search-input';
  for (const u of _recipients) {
    const o = document.createElement('option'); o.value = u.id;
    const pre = preselectUsername && u.username === preselectUsername;
    o.textContent = `${u.displayName || u.username} (${u.role})${pre ? ` — ${opts.tag || 'sender'}` : ''}`;
    if (pre) o.selected = true;
    sel.appendChild(o);
  }
  const act = document.createElement('select'); act.className = 'search-input';
  [['approve', 'Approve'], ['acknowledge', 'For information']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; act.appendChild(o); });
  if (opts.actionRequired) act.value = opts.actionRequired;
  const note = document.createElement('input'); note.className = 'search-input'; note.placeholder = 'Note (optional)';
  const go = _wfBtn('Route…', true, () =>
    _run(window.docusnap.workflow.assign(doc.id, Number(sel.value), act.value, note.value.trim() || undefined, opts.resubmitOf)));
  wrap.append(sub, sel, act, note, go);
  return wrap;
}

// ── Mailbox-row actions (Slice 1) — called by search-mailbox.js ─────────────────
// Recall a still-pending sent route straight from its row.
function recallRoute(route) {
  return _run(window.docusnap.workflow.recall(route.id, route.version));
}
// "Send again" on a REJECTED sent route: load the doc into the preview; the next action
// panel render consumes the one-shot prefill (original recipient + action + lineage).
async function queueResubmit(route) {
  _pendingResubmit = {
    docId: route.document_id, toUsername: route.to_username,
    actionRequired: route.action_required, resubmitOf: route.id,
  };
  const full = await window.docusnap.getDocumentWithExtractions(route.document_id);
  if (full) window.SearchPreview.selectDoc(full);
}

window.SearchWorkflow = { init, refresh, recallRoute, queueResubmit };
