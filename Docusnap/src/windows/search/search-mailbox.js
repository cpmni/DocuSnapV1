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
  if (!routes.length) {
    // Teaching empty states (Chris r4 card 6) — each pile explains what would appear in it.
    const EMPTY = {
      inbox:     'Nothing waiting on you — documents colleagues send you for approval or information appear here.',
      sent:      'You haven\'t sent anything — use "Send to a colleague" on a document to get an approval or share it.',
      assigned:  'Nothing claimed — items you\'ve claimed to work on sit here until you finish them.',
      completed: 'Nothing finished yet — approvals, rejections and seen items keep a permanent record here.',
    };
    empty.style.display = '';
    empty.textContent = EMPTY[_box] || `Nothing in ${_box}`;
    return;
  }
  empty.style.display = 'none';
  for (const r of routes) scroll.appendChild(_routeItem(r));
}

// Route timestamps arrive in TWO formats (created_at = SQLite datetime('now'), resolved_at =
// ISO from the service's now()) — normalise both to the app's DD-MM-YYYY.
function _wfDate(raw) {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// AGEING CHIP (the night-sized half of "workflow due dates + nudges"). No schema, no scheduler,
// no notification: just say out loud how long an OPEN item has been sitting, which is the part of
// a due date that actually changes behaviour. Deliberately silent under the threshold — a chip on
// everything is a chip on nothing, and the app's standing rule is minimal interaction.
//
// created_at is SQLite `datetime('now')`, i.e. UTC "YYYY-MM-DD HH:MM:SS" with no zone marker, so
// it is parsed as UTC EXPLICITLY. Letting the browser read it as local time would shift the age by
// the local offset and could show "waiting 4 days" on something sent three days ago.
const WF_AGE_DAYS = 3;
const WF_OPEN_STATES = ['pending', 'claimed'];
function _wfAgeDays(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  const ms = m
    ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    : Date.parse(s);                       // already ISO with a zone (resolved_at's format)
  if (!Number.isFinite(ms)) return null;
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days >= 0 ? days : null;          // a clock skew into the future is not an age
}
function _wfAgeChip(r) {
  if (!WF_OPEN_STATES.includes(r.state)) return '';   // only things still awaiting someone
  const d = _wfAgeDays(r.created_at);
  if (d == null || d < WF_AGE_DAYS) return '';
  const label = d >= 14 ? `waiting ${Math.floor(d / 7)} weeks` : `waiting ${d} days`;
  const tone  = d >= 7 ? ' overdue' : '';
  return `<span class="wf-age${tone}" title="Sent ${_wfDate(r.created_at)} — still waiting">${escHtml(label)}</span>`;
}

function _routeItem(r) {
  const el = document.createElement('div'); el.className = 'result-item'; el.dataset.id = r.document_id;
  // Chris r4 card 4: name the DOCUMENT (supplier — reference), show the sender's note, and
  // date the row by when it was SENT — the old footer printed the document's own date
  // unlabelled, which read as "this has sat here six months".
  const title = (r.supplier_name || ('Document #' + r.document_id))
              + (r.reference_number ? ` — ${r.reference_number}` : '');
  const kind  = r.action_required === 'approve' ? 'Approval' : 'For information';
  const who   = _box === 'sent' ? `to ${r.to_username}` : `from ${r.from_username}`;
  const sentWord = _box === 'inbox' ? 'received' : 'sent';
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
      <span class="wf-state ${escHtml(r.state)}">${escHtml(stateLabel)}</span>${_wfAgeChip(r)}
    </div>
    <div class="result-filename">${escHtml(kind)} · ${escHtml(who)}</div>${
      r.comment ? `
    <div class="result-filename wf-reason" title="${escHtml(r.comment)}">“${escHtml(r.comment)}”</div>` : ''}${
      r.resolution_comment ? `
    <div class="result-filename wf-reason" title="${escHtml(r.resolution_comment)}">Reason: ${escHtml(r.resolution_comment)}</div>` : ''}
    <div class="result-footer"><span class="result-date">${escHtml(sentWord)} ${escHtml(_wfDate(r.created_at))}</span>${rowActs}${
      r.has_stamped ? `<button class="wf-stamp-link wf-stamp" type="button">View stamped copy</button>` : ''}</div>`;
  el.addEventListener('click', () => {
    document.querySelectorAll('.result-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    // selectDoc fetches the detail itself (guarded) and shows an honest error on failure —
    // don't pre-fetch here (it was an unguarded double fetch: a rejection left the row
    // highlighted with nothing loading).
    window.SearchPreview.selectDoc({ id: r.document_id });
  });
  // Row buttons must never trigger the row's open-document click (stamp-link precedent).
  // SECURE VIEWER (owner 2026-08-02): the stamped copy opens in the in-app viewer by ROUTE
  // ID — the old shell-open put the real path in Edge's address bar (sequential filenames =
  // guessable browsing) and gave untracked Save/Print. Rows no longer even carry the path.
  el.querySelector('.wf-stamp')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.docusnap.workflow.openStampedViewer(r.id);
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

window.SearchMailbox = {
  init: _mbInit,
  refreshIfActive,
  // Deep-link entry (Home "Open Mailbox"): LAND on the mailbox view. Set-true, never a
  // toggle — a repeated deep-link must not flip it back off. No-op when the workflow
  // add-on is unlicensed. Defined as a method (not a top-level `function open`) so it
  // neither shadows window.open nor trips the global-collision pin.
  open() {
    if (!window.SearchState.workflowEntitled) return;
    if (!_active) toggle();
  },
};
