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
const _run = async (promise, okMsg) => {
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
  } else if (okMsg) {
    // Completion feedback (Chris r4 card 3 — every action "finished in silence"). SEPARATE
    // .wf-ok node, never the .wf-err slot (_err dedupes into it — a success must not
    // overwrite a shown error). Attached AFTER the re-render, same survival mechanics as
    // errMsg above; auto-fades; the next panel wipe self-cleans it. In mailbox-only
    // contexts with no selected doc there is no panel — the row/state chip refresh is the
    // feedback there, so the quiet drop is deliberate.
    const panel = document.querySelector('#preview-actions .wf-decision, #preview-actions .wf-assign, #preview-actions .wf-routed');
    if (panel) {
      const ok = document.createElement('div');
      ok.className = 'wf-ok';
      ok.textContent = okMsg;
      panel.appendChild(ok);
      setTimeout(() => { if (ok.isConnected) ok.remove(); }, 6000);
    }
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
  // Decision HISTORY rides every branch (Chris r4 card 2 — "who approved this and when?"):
  // its own container class (never wf-decision/wf-assign/wf-routed — _run's message
  // re-attach queries those), sync-created, async-filled with the staleness guards.
  const hist = _historyBlock(doc);
  const route = _myOpenRoutes[doc.id];
  if (route) return [{ node: _decisionBar(route) }, { node: hist }];
  if (pending && _recipients.length) {
    return [{ node: _assignForm(doc, pending.toUsername, {
      tag: 'previous recipient', title: 'Send again — the previous request was rejected',
      actionRequired: pending.actionRequired, resubmitOf: pending.resubmitOf }) }, { node: hist }];
  }
  if (_recipients.length) return [{ node: _routeOrAssign(doc) }, { node: hist }]; // recipients only returned to admin/edit
  return [{ node: hist }];
}

// Decision history block: closed routes for the doc, newest first, capped at 5 with a
// "Show all" expander. resolution_comment renders verbatim; 'recalled' rows never guess an
// actor (three producers share the state — OC2). Dates: resolved_at is ISO, created_at is
// SQLite format — _histDate handles both.
function _histDate(raw) {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function _historyBlock(doc) {
  const wrap = document.createElement('div'); wrap.className = 'wf-history';
  window.docusnap.workflow.docHistory(doc.id).then((rows) => {
    if (!wrap.isConnected || !window.SearchState.selectedDoc || window.SearchState.selectedDoc.id !== doc.id) return;
    const all = rows || [];
    if (!all.length) return;                       // no history → render nothing (no empty header)
    const hdr = document.createElement('div'); hdr.className = 'wf-sub'; hdr.textContent = 'History';
    wrap.appendChild(hdr);
    const renderRows = (n) => {
      wrap.querySelectorAll('.wf-hist-row, .wf-hist-more').forEach((x) => x.remove());
      for (const r of all.slice(0, n)) {
        const line = document.createElement('div'); line.className = 'wf-hist-row';
        const d = _histDate(r.resolved_at || r.created_at);
        let text;
        if (r.state === 'approved') text = `Approved by ${r.to_username} on ${d}`;
        else if (r.state === 'rejected') text = `Rejected by ${r.to_username} on ${d}`;
        else if (r.state === 'acknowledged') text = `Seen by ${r.to_username} on ${d}`;
        else text = `Recalled on ${d}`;
        if (r.resolution_comment) text += ` — “${r.resolution_comment}”`;
        line.textContent = text;
        if (r.has_stamped) {
          const b = document.createElement('button');
          b.className = 'wf-stamp-link'; b.type = 'button'; b.textContent = 'View stamped copy';
          b.addEventListener('click', () => window.docusnap.workflow.openStampedViewer(r.id));
          line.append(' ', b);
        }
        wrap.appendChild(line);
      }
      if (all.length > n) {
        const more = document.createElement('button');
        more.className = 'wf-stamp-link wf-hist-more'; more.type = 'button';
        more.textContent = `Show all ${all.length}`;
        more.addEventListener('click', () => renderRows(all.length));
        wrap.appendChild(more);
      }
    };
    renderRows(5);
  }).catch(() => { /* history is additive — a failed read renders nothing */ });
  return wrap;
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
  banner.textContent = `Sent to ${r.to_username} by ${r.from_username || 'Auto-filed'} — awaiting ${r.action_required === 'approve' ? 'their approval' : 'their acknowledgement'}`;
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
  const kind = route.action_required === 'approve' ? "they'd like your approval" : 'just for information';
  const banner = document.createElement('div'); banner.className = 'wf-banner';
  banner.textContent = `Sent to you by ${route.from_username} — ${kind}`
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
    if (decision === 'reject' && !n) {
      // NEVER a silent no-op (Chris r4 — "the Reject button silently does nothing"): the
      // note is required for a rejection, so SAY so where the user is looking.
      _err(wrap, 'Add a short note first — the sender needs to know why it was rejected.');
      note.focus();
      return;
    }
    _run(window.docusnap.workflow.resolve(route.id, decision, n || null, route.version),
         decision === 'approve'
           ? 'Approved — recorded against the document and moved to Completed.'
           : `Rejected — ${route.from_username} will see your reason in their Sent pile.`);
  };

  if (route.action_required === 'acknowledge') {
    // Display copy only — the resolve decision string stays 'acknowledge' (DB/IPC contract).
    acts.appendChild(_wfBtn('Got it', true, () =>
      _run(window.docusnap.workflow.resolve(route.id, 'acknowledge', null, route.version),
           'Noted — moved to Completed.')));
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
  sub.textContent = opts.title || (preselectUsername ? 'Send on to someone else' : 'Send to a colleague');
  const sel = document.createElement('select'); sel.className = 'search-input';
  for (const u of _recipients) {
    const o = document.createElement('option'); o.value = u.id;
    const pre = preselectUsername && u.username === preselectUsername;
    o.textContent = `${u.displayName || u.username} (${u.role})${pre ? ` — ${opts.tag || 'sender'}` : ''}`;
    if (pre) o.selected = true;
    sel.appendChild(o);
  }
  const act = document.createElement('select'); act.className = 'search-input';
  // Display labels ONLY — the decision VALUES ('approve'/'acknowledge') are the DB/IPC
  // contract (the "Got it" precedent). "Needs their approval" fixes the sender-side
  // "Approve" reading as if the SENDER were approving (Chris r4 card 5).
  [['approve', 'Needs their approval'], ['acknowledge', 'Just for information']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; act.appendChild(o); });
  if (opts.actionRequired) act.value = opts.actionRequired;
  const note = document.createElement('input'); note.className = 'search-input'; note.placeholder = 'Note (optional)';
  const go = _wfBtn('Send', true, () => {
    const rcpt = _recipients.find(u => u.id === Number(sel.value)) || {};
    const who = rcpt.displayName || rcpt.username || 'them';
    return _run(window.docusnap.workflow.assign(doc.id, Number(sel.value), act.value, note.value.trim() || undefined, opts.resubmitOf),
                `Sent to ${who} — it's in their Mailbox. You can recall it from your Sent pile while it's still pending.`);
  });
  wrap.append(sub, sel, act, note, go);
  return wrap;
}

// ── Mailbox-row actions (Slice 1) — called by search-mailbox.js ─────────────────
// Recall a still-pending sent route straight from its row.
function recallRoute(route) {
  return _run(window.docusnap.workflow.recall(route.id, route.version),
              'Recalled — removed from their Mailbox.');
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
