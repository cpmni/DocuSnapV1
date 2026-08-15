'use strict';

const api = window.docusnap;

// Keyboard-focus repair (Windows) — mirror of the Review window's wrapper. A native
// confirm()/alert() drops Blink's render-widget keyboard focus while the window still reports
// focused (document.hasFocus() lies TRUE), so the preload's pointerdown self-heal can't detect
// the desync on its own and the NEXT text-field click shows no caret until you alt-tab out and
// back. Settings' Learning Repair fires confirm() (Forget / Delete / clear-anchors), so wrap the
// native dialogs once: flag this window "focus suspect" in main whenever one returns, and the
// pointerdown repair (preload → ensure-window-focus → focusRepair.blurWebView) then does the real
// transition on the next field press. Single point, no call-site changes. Guarded so it never
// breaks a dialog.
(function instrumentNativeDialogsForFocusRepair() {
  const mark = () => { try { window.docusnap?.markFocusSuspect?.(); } catch {} };
  const _confirm = window.confirm.bind(window);
  const _alert = window.alert.bind(window);
  window.confirm = (...a) => { try { return _confirm(...a); } finally { mark(); } };
  window.alert = (...a) => { try { return _alert(...a); } finally { mark(); } };
})();

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    // Learning Recovery + Keyword Label Overrides live under the Learning tab; the
    // Audit log lives under the Audit tab; the Search client API lives under the
    // Search client tab — load each lazily on show.
    if (btn.dataset.tab === 'learning') { loadMemoryInventory(); loadGraduationRoster(); }
    if (btn.dataset.tab === 'repair') repairInit();
    if (btn.dataset.tab === 'audit' && !auditState.loaded) loadAudit();
    if (btn.dataset.tab === 'searchclient') initClientApiSection();
    // The Workflow add-on + client-seat sections live in the Licensing tab but are populated by
    // initClientApiSection/loadSeats — run them on Licensing open too, not just on Refresh (after the
    // Settings tab-reorg the sections moved here but their lazy-init trigger stayed on 'searchclient',
    // so the workflow toggle/chip/seat-count sat in their raw default until a manual Refresh).
    if (btn.dataset.tab === 'licensing') { initClientApiSection(); if (typeof loadSeats === 'function') loadSeats(); }
    if (btn.dataset.tab === 'workflow') initWorkflowPanel();
  });
});

// ── Workflow routing rules (admin; entitlement-gated, hidden while the add-on is dark) ──────────
let _wfWired = false;
let _wfEditId = null;
const _wfEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function applyWorkflowTabVisibility() {
  const tab = document.querySelector('.tab[data-tab="workflow"]');
  if (!tab) return;
  try {
    const e = await api.getEntitlement();
    tab.style.display = (e && e.workflow && e.workflow.entitled && !e.workflow.disabled) ? '' : 'none';
  } catch { tab.style.display = 'none'; }   // fail-closed
}

async function initWorkflowPanel() {
  if (_wfWired) { loadWorkflowRules(); loadWorkflowOpenRoutes(); return; }
  _wfWired = true;
  try {
    const types = (await api.getDocumentTypes()) || [];
    document.getElementById('wf-b-type').innerHTML =
      '<option value="">any document type</option>' + types.map(t => `<option value="${t.id}">${_wfEsc(t.name)}</option>`).join('');
  } catch {}
  try {
    const [usersRes, me] = await Promise.all([api.authListUsers(), api.authGetCurrentUser().catch(() => null)]);
    const meId = me && me.id;
    // auth-list-users returns { users: [...] } (see loadUsersList) — NOT a bare array; the
    // original array-shaped read threw inside this catch and left the dropdown EMPTY (found
    // in the owner's first live click-through of the rule builder).
    const users = (usersRes && usersRes.users) || [];
    document.getElementById('wf-b-person').innerHTML = users.filter(u => u.is_active)
      .map(u => `<option value="${u.id}">${_wfEsc(u.display_name || u.username)}${meId === u.id ? ' (me)' : ''}</option>`).join('');
  } catch {}
  const amtOn = document.getElementById('wf-b-amount-on');
  amtOn.addEventListener('change', () => {
    document.getElementById('wf-b-amount').style.display = amtOn.checked ? '' : 'none';
    document.getElementById('wf-b-amount-suffix').style.display = amtOn.checked ? '' : 'none';
  });
  document.getElementById('wf-b-save').addEventListener('click', wfSaveRule);
  document.getElementById('wf-b-dryrun').addEventListener('click', wfDryRun);
  document.getElementById('wf-b-cancel').addEventListener('click', wfResetBuilder);
  loadWorkflowRules();
  loadWorkflowOpenRoutes();
}

// E1 admin cancel-route: the "Open routes" list — the DISCOVERY surface for stuck routes
// (a NULL-sender auto-file route appears in NOBODY's Sent box; without this list a stuck doc
// is only found by per-doc luck in Search). Includes routes whose document was deleted
// ("(document deleted)") — those are legacy strands and this list is their only healing
// surface (Oracle OC3). Cancel = two-step inline confirm, same IPC as the Search banner.
async function loadWorkflowOpenRoutes() {
  const list = document.getElementById('wf-open-list');
  if (!list) return;
  try {
    const routes = (await api.workflow.openRoutes()) || [];
    if (!routes.length) { list.innerHTML = '<p style="color:var(--muted);">Nothing is waiting on anyone.</p>'; return; }
    list.innerHTML = routes.map(r => {
      const fname = r.stored_filename || r.original_filename || ('Document #' + r.document_id);
      const gone = r.doc_status === 'deleted' ? ' <span style="color:var(--err); font-size:11px;">(document deleted)</span>' : '';
      const await_ = r.action_required === 'approve' ? 'awaiting approval' : 'for information';
      const age = (r.created_at || '').slice(0, 10);
      return `<div class="card" style="display:flex; align-items:center; gap:12px; padding:10px 14px; margin-bottom:8px;">
        <div style="flex:1; min-width:0;">
          <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_wfEsc(fname)}${gone}</div>
          <div style="font-size:11px; color:var(--muted);">${_wfEsc(r.supplier_name || '')} · to ${_wfEsc(r.to_username)} · ${_wfEsc(await_)} · since ${_wfEsc(age)}</div>
        </div>
        <button class="btn" data-wf-cancel="${r.id}" data-wf-cancel-v="${r.version}" data-wf-cancel-to="${_wfEsc(r.to_username)}" style="padding:4px 10px;">Cancel</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-wf-cancel]').forEach(el => el.addEventListener('click', async () => {
      if (!el.dataset.armed) {
        el.dataset.armed = '1'; el.textContent = `Confirm — remove from ${el.dataset.wfCancelTo}'s inbox`;
        setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = 'Cancel'; } }, 5000);
        return;
      }
      el.disabled = true;
      try { await api.workflow.adminCancel(Number(el.dataset.wfCancel), Number(el.dataset.wfCancelV)); }
      catch (e) { el.disabled = false; el.textContent = 'Cancel'; delete el.dataset.armed; }
      loadWorkflowOpenRoutes();
    }));
  } catch { list.innerHTML = '<p style="color:var(--muted);">Couldn\'t load the open routes.</p>'; }
}

function _wfBuilderPayload() {
  const p = { documentTypeId: document.getElementById('wf-b-type').value || '', targetUserId: document.getElementById('wf-b-person').value || null,
    actionRequired: document.getElementById('wf-b-action').value || 'approve' };
  if (document.getElementById('wf-b-amount-on').checked) p.amountText = document.getElementById('wf-b-amount').value;
  if (_wfEditId) p.id = _wfEditId;
  return p;
}

async function wfSaveRule() {
  const msg = document.getElementById('wf-b-msg');
  msg.textContent = 'Saving…';
  try {
    const res = _wfEditId ? await api.workflow.ruleUpdate(_wfBuilderPayload()) : await api.workflow.ruleCreate(_wfBuilderPayload());
    if (res && res.error) { msg.textContent = res.error; return; }
    wfResetBuilder(); msg.textContent = 'Saved.'; loadWorkflowRules();
  } catch { msg.textContent = "Couldn't save the rule."; }
}

function wfResetBuilder() {
  _wfEditId = null;
  document.getElementById('wf-builder-title').textContent = 'Add a routing rule';
  document.getElementById('wf-b-save').textContent = 'Add rule';
  document.getElementById('wf-b-cancel').style.display = 'none';
  document.getElementById('wf-b-type').value = '';
  document.getElementById('wf-b-amount-on').checked = false;
  document.getElementById('wf-b-amount').value = '';
  document.getElementById('wf-b-amount').style.display = 'none';
  document.getElementById('wf-b-amount-suffix').style.display = 'none';
  document.getElementById('wf-b-action').value = 'approve';
  document.getElementById('wf-dryrun').innerHTML = '';
}

async function wfDryRun() {
  const box = document.getElementById('wf-dryrun');
  box.innerHTML = '<p style="color:var(--muted);">Checking your recent documents…</p>';
  try {
    const res = await api.workflow.ruleDryRun(_wfBuilderPayload());
    if (res && res.error) { box.innerHTML = `<p style="color:var(--muted);">${_wfEsc(res.error)}</p>`; return; }
    if (!res || res.count === 0) {
      box.innerHTML = `<p style="color:var(--muted);">None of your last ${res ? res.sampled : 0} filed documents would match — the rule may be too narrow.</p>`;
      return;
    }
    const rows = (res.matched || []).map(m => `<div style="padding:4px 0; border-top:1px solid var(--border); font-size:12px;">${_wfEsc(m.supplier)} · ${_wfEsc(m.total)} · ${_wfEsc(m.filename)}</div>`).join('');
    box.innerHTML = `<div style="margin-top:6px; padding:12px; background:var(--surface2); border-radius:8px;"><div style="font-weight:600; margin-bottom:6px;">This would have routed ${res.count} of your last ${res.sampled} filed documents:</div>${rows}<div style="font-size:11px; color:var(--muted); margin-top:8px;">Preview only — saving a rule doesn't route these; it applies to documents filed from now on.</div></div>`;
  } catch { box.innerHTML = '<p style="color:var(--muted);">Couldn\'t run the preview.</p>'; }
}

async function loadWorkflowRules() {
  const list = document.getElementById('wf-rules-list');
  try {
    const rules = (await api.workflow.rulesList()) || [];
    if (!rules.length) { list.innerHTML = '<p style="color:var(--muted);">No rules yet. Add one above.</p>'; return; }
    list.innerHTML = rules.map(r => `<div class="card" style="display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:8px; ${r.active ? '' : 'opacity:.55;'}">
        <div style="flex:1;">${_wfEsc(r.summary || 'Routing rule')}</div>
        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer;"><input type="checkbox" ${r.active ? 'checked' : ''} data-wf-toggle="${r.id}"> On</label>
        <button class="btn" data-wf-edit="${r.id}" style="padding:4px 10px;">Edit</button>
        <button class="btn" data-wf-del="${r.id}" style="padding:4px 10px;">Delete</button>
      </div>`).join('');
    list.querySelectorAll('[data-wf-toggle]').forEach(el => el.addEventListener('change', () => api.workflow.ruleToggle(Number(el.dataset.wfToggle), el.checked).then(loadWorkflowRules)));
    list.querySelectorAll('[data-wf-edit]').forEach(el => el.addEventListener('click', () => wfEditRule(Number(el.dataset.wfEdit), rules)));
    list.querySelectorAll('[data-wf-del]').forEach(el => el.addEventListener('click', () => { if (confirm('Delete this routing rule?')) api.workflow.ruleDelete(Number(el.dataset.wfDel)).then(loadWorkflowRules); }));
  } catch { list.innerHTML = '<p style="color:var(--muted);">Couldn\'t load your rules.</p>'; }
}

function wfEditRule(id, rules) {
  const r = rules.find(x => x.id === id);
  if (!r) return;
  _wfEditId = id;
  document.getElementById('wf-builder-title').textContent = 'Edit routing rule';
  document.getElementById('wf-b-save').textContent = 'Save changes';
  document.getElementById('wf-b-cancel').style.display = '';
  document.getElementById('wf-b-type').value = r.document_type_id != null ? String(r.document_type_id) : '';
  const hasAmt = Number(r.min_amount_pennies) > 0;
  document.getElementById('wf-b-amount-on').checked = hasAmt;
  document.getElementById('wf-b-amount').value = hasAmt ? (r.min_amount_pennies / 100).toFixed(2) : '';
  document.getElementById('wf-b-amount').style.display = hasAmt ? '' : 'none';
  document.getElementById('wf-b-amount-suffix').style.display = hasAmt ? '' : 'none';
  // Prefill the action — without this, editing a for-information rule and saving would
  // silently convert it to approval (eric's catch in the FYI slice review).
  document.getElementById('wf-b-action').value = r.action_required === 'acknowledge' ? 'acknowledge' : 'approve';
  if (r.target_user_id != null) document.getElementById('wf-b-person').value = String(r.target_user_id);
}

applyWorkflowTabVisibility();   // reveal the tab iff the add-on is entitled (dark today ⇒ stays hidden)

// ── Search client access (admin) — host the detached-client API ────────────────

// ── Search client access (admin) — host the detached-client API ────────────────
let _clientApiWired = false;
// Set/clear a status pill (theme .chip). cls = '' | 'ok' | 'warn' | 'err'; empty text hides it.
function setChip(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'chip' + (cls ? ' ' + cls : '');
  el.textContent = text || '';
  el.style.display = text ? '' : 'none';
}
async function initClientApiSection() {
  const tgl = document.getElementById('client-api-toggle');
  const statusEl = document.getElementById('client-api-status');
  if (!tgl || !statusEl) return;
  const host = document.getElementById('client-api-host');
  const port = document.getElementById('client-api-port');
  const cert = document.getElementById('client-api-tls-cert');
  const key  = document.getElementById('client-api-tls-key');

  const render = (s) => {
    if (!s) { statusEl.textContent = 'Unavailable (admin only)'; setChip('client-api-chip', '', ''); return; }
    tgl.checked = !!s.enabled;
    statusEl.textContent = s.running
      ? `Running · ${s.tls ? 'https' : 'http'}://${s.host}:${s.port}`
      : (s.enabled ? 'Enabled (starting…)' : 'Off');
    setChip('client-api-chip', s.running ? 'On' : (s.enabled ? 'Starting…' : 'Off'), s.running ? 'ok' : '');
  };

  try { render(await api.clientApiGetStatus()); }
  catch { statusEl.textContent = 'Unavailable (admin only)'; return; }

  // Managed certificate (Certificate Wizard) status + fingerprint.
  const certStatusEl = document.getElementById('client-api-cert-status');
  const certFpEl = document.getElementById('client-api-cert-fp');
  const renderCert = (cs) => {
    if (!certStatusEl) return;
    if (!cs) { certStatusEl.textContent = '—'; if (certFpEl) certFpEl.textContent = ''; return; }
    if (cs.loopback) {
      certStatusEl.textContent = 'Not needed — loopback host uses plain HTTP. Set a LAN host (e.g. 0.0.0.0) to auto-generate a certificate.';
      if (certFpEl) certFpEl.textContent = ''; return;
    }
    if (!cs.hasCert) {
      certStatusEl.textContent = 'None yet — generated automatically when you switch access on.';
      if (certFpEl) certFpEl.textContent = ''; return;
    }
    const exp = cs.notAfter ? new Date(cs.notAfter).toLocaleDateString() : '?';
    certStatusEl.textContent = cs.valid
      ? `Active · covers ${cs.sans.join(', ')} · expires ${exp}`
      : `Needs re-issue · ${cs.expired ? 'near/after expiry' : 'missing ' + (cs.missingSans || []).join(', ')} · expires ${exp}`;
    if (certFpEl) certFpEl.textContent = cs.caFingerprint ? ('CA fingerprint  ' + cs.caFingerprint) : '';
  };
  try { renderCert(await api.clientApiCertStatus()); } catch { /* ignore */ }

  // Workflow add-on entitlement — READ-ONLY. It is driven by the licence (the verified
  // token / backend per-feature counts), never a local setting. The old toggle wrote
  // `detached_client_licensed`, which nothing authoritative consumes, so it could mislead
  // an operator into thinking they had (un)licensed the feature. We now only REFLECT the
  // real entitlement from get-entitlement; this control cannot create it.
  const wfTgl = document.getElementById('wf-addon-toggle');
  const wfSub = document.getElementById('wf-addon-sub');
  if (wfTgl && wfSub) {
    wfTgl.disabled = true;
    const sec = document.getElementById('wf-section');
    try {
      const ent = await api.getEntitlement();
      // Pre-release: the workflow feature is master-disabled (entitlement returns workflow.disabled).
      // Hide the whole section so there's no mention of the unbuilt feature; un-hides automatically
      // when the WORKFLOW_FEATURE_ENABLED flag is flipped back on. #wf-section defaults hidden in the
      // HTML (so it never FLASHES visible before this async check resolves) — REVEAL it whenever the
      // feature is not master-disabled.
      // The stamp only exists for approvals, so its placement card follows the workflow section's
      // visibility exactly — one entitlement, one answer, no second gate to drift.
      const stampSec = document.getElementById('stamp-section');
      if (ent && ent.workflow && ent.workflow.disabled) {
        if (sec) sec.style.display = 'none';
        if (stampSec) stampSec.style.display = 'none';
      } else {
        if (sec) sec.style.display = '';
        if (stampSec) { stampSec.style.display = ''; initStampPlacement(); }
        const on = !!(ent && ent.workflow && ent.workflow.entitled);
        const seats = (ent && ent.workflow && ent.workflow.seats) || 0;
        wfTgl.checked = on;
        wfSub.textContent = on
          ? (seats > 0 ? `Licensed · ${seats} seat${seats === 1 ? '' : 's'}` : 'Licensed')
          : 'Not licensed';
        setChip('wf-chip', on ? 'On' : 'Off', on ? 'ok' : '');
      }
    } catch {
      if (sec) sec.style.display = '';
      const stampSec = document.getElementById('stamp-section');
      if (stampSec) { stampSec.style.display = ''; initStampPlacement(); }
      wfSub.textContent = 'Unknown'; setChip('wf-chip', 'Unknown', '');
    }
  }

  if (_clientApiWired) return; // bind listeners once
  _clientApiWired = true;

  try {
    host.value = (await api.getSetting('client_api_host')) || '';
    port.value = (await api.getSetting('client_api_port')) || '';
    cert.value = (await api.getSetting('client_api_tls_cert')) || '';
    key.value  = (await api.getSetting('client_api_tls_key')) || '';
    // Auto-open the managed-cert disclosure only when a LAN (non-loopback) host is set —
    // that's when a TLS cert actually matters; loopback stays collapsed.
    const cd = document.getElementById('cert-details');
    if (cd) { const h = (host.value || '').trim(); cd.open = !!h && h !== '127.0.0.1' && h !== 'localhost'; }
  } catch { /* ignore */ }

  tgl.addEventListener('change', async () => {
    try {
      render(await api.clientApiSetEnabled(tgl.checked));
      // The listener binds asynchronously, so re-poll shortly to flip "starting…" → "Running".
      setTimeout(async () => { try { render(await api.clientApiGetStatus()); } catch { /* ignore */ } }, 800);
    } catch (e) { statusEl.textContent = 'Error: ' + (e && e.message); tgl.checked = !tgl.checked; }
  });
  const saver = (el, k) => el.addEventListener('change', () => { try { api.setSetting(k, el.value.trim()); } catch {} });
  saver(host, 'client_api_host'); saver(port, 'client_api_port');
  saver(cert, 'client_api_tls_cert'); saver(key, 'client_api_tls_key');

  const certGenBtn = document.getElementById('client-api-cert-generate');
  if (certGenBtn) certGenBtn.addEventListener('click', async () => {
    const prev = certGenBtn.textContent; certGenBtn.disabled = true; certGenBtn.textContent = 'Generating…';
    try { renderCert(await api.clientApiCertGenerate()); render(await api.clientApiGetStatus()); }
    catch (e) { if (certStatusEl) certStatusEl.textContent = 'Error: ' + (e && e.message); }
    finally { certGenBtn.disabled = false; certGenBtn.textContent = prev; }
  });

  const certExportBtn = document.getElementById('client-api-cert-export');
  const exportStatusEl = document.getElementById('client-api-export-status');
  if (certExportBtn) certExportBtn.addEventListener('click', async () => {
    if (exportStatusEl) exportStatusEl.textContent = '';
    try {
      const r = await api.clientApiCertExport();
      if (!exportStatusEl) return;
      if (r && r.ok) exportStatusEl.textContent = 'Saved profile to ' + r.path + ' — share it with the client (one-click import).';
      else if (r && r.canceled) exportStatusEl.textContent = '';
      else if (r && r.error === 'no_managed_ca') exportStatusEl.textContent = 'Generate a managed certificate first, then export.';
      else exportStatusEl.textContent = 'Export failed' + (r && r.error ? ': ' + r.error : '.');
    } catch (e) { if (exportStatusEl) exportStatusEl.textContent = 'Error: ' + (e && e.message); }
  });
}

document.getElementById('btn-close').addEventListener('click', () => api.windowClose());

// ── Help: user guide + contextual help mode ───────────────────────────────────
document.getElementById('btn-help-guide')?.addEventListener('click', () => api.openHelpWindow('settings'));
// Self-contained "Set up the search client" walkthrough (lives with the cert settings).
document.getElementById('btn-client-setup-help')?.addEventListener('click', () => api.openHelpWindow('client-cert-setup'));

const HELP_TEXTS = {
  'tab-files':      'Where filed documents go — the output, processed-scans and watch folders — and how they are named (the subfolder layout and file-name pattern).',
  'tab-doctypes':   'Enable or disable document types and choose which field is each type’s main reference number and date.',
  'doctype-aliases':'Other titles the same document is printed with. Scan Finder recognises a document’s type from the title at the top of the page — matched to this type’s name OR any alias here. Add the spellings your documents actually use (e.g. “Work Sheet”, “Job Sheet”) so they’re filed correctly without renaming the type. Matching ignores capitals and spacing but is exact — a short form like “W-Sheet” only works if you add it.',
  'tab-fields':     'Add, edit, reorder or remove the fields a document type extracts. Built-in fields are locked.',
  'tab-processing': 'How documents are processed — import options (auto-file, wrap, auto-rotate), parallelism, the OCR engine, document separation, name checks and the review confidence threshold.',
  'tab-appearance': 'The colour theme, what happens when you close the window, and which cards appear on the Home screen.',
  'tab-templates':  'Browse the layouts Scan Finder has learned and map where each field sits on the page.',
  'tab-learning':   'Teach the keyword stage extra labels to look for, and review or clean up learned data (anchors, hints, corrections) if extraction drifts.',
  'tab-users':      'Manage the people who can sign in and what each is allowed to do (admin / edit / read-only), plus a record of recent account activity.',
  'tab-audit':      'A searchable record of sensitive actions — sign-ins, settings and document changes, review actions, licensing and denied access.',
  'tab-licensing':  'Your licence / activation status, the trial or paid-seat details for this device, and your client seats.',
  'tab-searchclient':'Let the separate Scan Finder Search client connect over your network, with its managed TLS certificate.',
  'tab-advanced':   'Re-run first-time setup, back up or restore your configuration, and toggle diagnostic logging.',
  'output-folder':  'Pick the folder where confirmed documents are filed. This must be set before any document can be confirmed.',
  'rerun-setup':    'Re-open the welcome wizard to revisit the essentials — theme, output folder and performance — without losing any data.',
  'add-type':       'Create a custom document type with its own fields (e.g. “Delivery Note”) alongside the built-in Invoice / Sales Order / Purchase Order.',
  'add-field':      'Add a custom field to the selected document type: a label, an auto-generated key, a value type and whether it’s required.',
  'add-catalog':    'Add a ready-made document type (Purchase/Sales Invoice, Credit Note, Statement, Receipt…) with its fields already set up.',
  'field-visibility':'Choose which fields each sender\'s layout shows. Untick a field a layout doesn\'t print so Review stops asking for it. The Issuer, Date and Reference are always shown.',
  'pick-output':    'Choose the folder where confirmed documents are filed. Must be set before any document can be confirmed.',
  'pick-processed': 'Choose where each original scan is moved after it’s filed. Leave blank to keep originals where they are.',
  'clear-processed':'Stop moving originals — leave them in the source folder after filing.',
  'pick-watch':     'Choose a folder to watch; scans dropped in are imported automatically.',
  'reset-folder':   'Reset the folder layout to the default: Company / Year / Month.',
  'reset-filename': 'Reset the file-name pattern to the default: Type.Date.Reference.',
  'new-template':   'Create a template by hand. Usually you don’t need to — templates appear on their own as you confirm documents.',
  'import-sample':  'Attach a clean sample document for this template to draw anchors and read fields against.',
  'regen-landmarks':'Re-work out the unique words used to line up shifted/skewed scans for this template.',
  'regen-fingerprint':'Rebuild the word “fingerprint” that recognises this layout, from its confirmed documents.',
  'tpl-enhance':    'Re-read the sample with stronger image cleanup — for faint or noisy scans.',
  'draw-anchor':    'Draw a box around a fixed label on the page (e.g. “Date:”) that Scan Finder can always find.',
  'draw-target':    'Draw a box around the value to read — the one that sits next to the anchor label.',
  'save-mapping':   'Save this field’s anchor + target so future documents of this layout read it automatically.',
  'test-mapping':   'Check what the current anchor/target reads on this sample before saving.',
  'delete-mapping': 'Remove this saved field mapping. The field falls back to normal reading.',
  'fixed-value':    'Always use the same value for this field on this layout (instead of reading it from the page).',
  'delete-template':'Delete this whole template. Scan Finder will re-learn the layout from future confirmations.',
  'lr-search':      'Find what Scan Finder has learned for a supplier or document type, so you can review or clear it.',
  'lr-reset-all':   'Erase ALL learned data (hints, anchors, templates). Your filed documents are not touched. Cannot be undone.',
  'lr-fresh':       'Wipe everything back to a clean install — settings, learning and document records. Cannot be undone.',
  'lr-clear-anchors':'Clear the learned field positions (anchors) for the chosen scope.',
  'lr-clear-hints':  'Clear the learned “fill empty fields” hints for the chosen scope.',
  'lr-clear-rules':  'Clear the learned field-cleanup rules for the chosen scope.',
  'lr-clear-corrections':'Clear the saved corrections history for the chosen scope.',
  'add-user':       'Add a person who can sign in, and set what they’re allowed to do (admin / edit / read-only).',
  'help-mode':      'Help mode: click any control to see what it does. Press Esc to leave.',
};
window.initHelpMode?.('help-mode-toggle', HELP_TEXTS);

// ══════════════════════════════════════════════════════════════════════════════
// GENERAL TAB
// ══════════════════════════════════════════════════════════════════════════════

// ── Output folder ─────────────────────────────────────────────────────────────
async function loadOutputFolder() {
  const val = await api.getSetting('output_folder');
  document.getElementById('output-folder-path').value = val || '';
}
loadOutputFolder();

document.getElementById('btn-pick-output').addEventListener('click', async () => {
  const folder = await api.pickOutputFolder();
  if (folder) {
    await api.setSetting('output_folder', folder);
    document.getElementById('output-folder-path').value = folder;
  }
});

// Re-run the first-time setup wizard (admin-gated in main).
document.getElementById('btn-rerun-setup')?.addEventListener('click', () => api.openOnboarding());
document.getElementById('btn-view-legal')?.addEventListener('click', () => api.openLegal?.());

// ── Processed folder ──────────────────────────────────────────────────────────
async function loadProcessedFolder() {
  const val = await api.getSetting('processed_folder');
  document.getElementById('processed-folder-path').value = val || '';
}
loadProcessedFolder();

document.getElementById('btn-pick-processed').addEventListener('click', async () => {
  const folder = await api.pickOutputFolder();
  if (folder) {
    await api.setSetting('processed_folder', folder);
    document.getElementById('processed-folder-path').value = folder;
  }
});

document.getElementById('btn-clear-processed').addEventListener('click', async () => {
  await api.setSetting('processed_folder', '');
  document.getElementById('processed-folder-path').value = '';
});

// ── Watch folder ──────────────────────────────────────────────────────────────
async function loadWatchFolder() {
  const cfg = await api.getWatchFolderConfig();
  document.getElementById('watch-folder-path').value = cfg.folder || '';
  document.getElementById('watch-folder-toggle').checked = !!cfg.enabled;
}
loadWatchFolder();

document.getElementById('btn-pick-watch').addEventListener('click', async () => {
  const folder = await api.pickWatchFolder();
  if (folder) {
    const res = await api.setWatchFolder(folder);
    if (res && res.ok === false) { alert(res.error || 'That folder can’t be used as a watch folder.'); return; }
    document.getElementById('watch-folder-path').value = folder;
  }
});

document.getElementById('watch-folder-toggle').addEventListener('change', async (e) => {
  await api.setWatchFolderEnabled(e.target.checked);
});

// ── Auto-file 100%-confidence documents (default ON) ──────────────────────────
(async () => {
  try {
    const v = await api.getSetting('auto_file_full_confidence');
    document.getElementById('auto-file-toggle').checked = (v !== 'false');   // unset → on
  } catch { document.getElementById('auto-file-toggle').checked = true; }
})();
document.getElementById('auto-file-toggle').addEventListener('change', async (e) => {
  await api.setSetting('auto_file_full_confidence', e.target.checked ? 'true' : 'false');
  _syncAutoFileThresholdEnabled(e.target.checked);
});

// ── Auto-file confidence threshold slider (default 100 = full confidence only) ────
function _syncAutoFileThresholdEnabled(on) {
  const row = document.getElementById('auto-file-threshold-row');
  if (row) row.style.opacity = on ? '' : '0.5';
  const sl = document.getElementById('auto-file-threshold');
  if (sl) sl.disabled = !on;
}
// Invariant: the Review confidence threshold must never exceed the auto-file threshold —
// you can't require review at a HIGHER confidence than the level you auto-file at (it would
// leave a contradictory band: above auto-file yet still "needs review"). Enforce it by capping
// the review slider's max at the auto-file value and clamping/persisting review if it was above.
function enforceAutoFileInvariant(persistReview) {
  const autoEl = document.getElementById('auto-file-threshold');
  const rev    = document.getElementById('global-threshold');
  if (!autoEl || !rev) return;
  const auto = parseInt(autoEl.value, 10) || 100;
  rev.max = String(auto);
  if ((parseInt(rev.value, 10) || 0) > auto) {
    rev.value = String(auto);
    const rl = document.getElementById('global-threshold-val'); if (rl) rl.textContent = auto + '%';
    if (persistReview) api.setSetting('confidence_threshold', String(auto));
  }
}
(async () => {
  try {
    const t = parseInt((await api.getSetting('auto_file_threshold')) || '100', 10) || 100;
    document.getElementById('auto-file-threshold').value = t;
    document.getElementById('auto-file-threshold-val').textContent = t + '%';
    _syncAutoFileThresholdEnabled((await api.getSetting('auto_file_full_confidence')) !== 'false');
    enforceAutoFileInvariant(true);
  } catch {}
})();
document.getElementById('auto-file-threshold').addEventListener('input', (e) => {
  document.getElementById('auto-file-threshold-val').textContent = e.target.value + '%';
  enforceAutoFileInvariant(false);   // lowering auto-file pulls the review cap (+ value) down with it
});
document.getElementById('auto-file-threshold').addEventListener('change', async (e) => {
  await api.setSetting('auto_file_threshold', String(e.target.value));
  enforceAutoFileInvariant(true);
});

// ── Graduation window (clean confirms before a sender is trusted; default 10) ───
// Read by trust.js scopeTrust via settings.graduation_window (clamped 3..50 server-side).
(async () => {
  try {
    const v = parseInt((await api.getSetting('graduation_window')) || '10', 10) || 10;
    document.getElementById('graduation-window').value = v;
    document.getElementById('graduation-window-val').textContent = String(v);
  } catch {}
})();
document.getElementById('graduation-window').addEventListener('input', (e) => {
  document.getElementById('graduation-window-val').textContent = e.target.value;
});
document.getElementById('graduation-window').addEventListener('change', async (e) => {
  await api.setSetting('graduation_window', String(e.target.value));
});

// ── Read values that wrap onto the next line (default ON) ──────────────────────
(async () => {
  try {
    const v = await api.getSetting('multiline_enabled');
    document.getElementById('multiline-toggle').checked = (v !== 'false');   // unset → on
  } catch { document.getElementById('multiline-toggle').checked = true; }
})();
document.getElementById('multiline-toggle').addEventListener('change', async (e) => {
  await api.setSetting('multiline_enabled', e.target.checked ? 'true' : 'false');
});

// ── Auto-rotate sideways/upside-down scans (default ON) ────────────────────────
(async () => {
  try {
    const v = await api.getSetting('auto_rotate_enabled');
    document.getElementById('auto-rotate-toggle').checked = (v !== 'false');   // unset → on
  } catch { document.getElementById('auto-rotate-toggle').checked = true; }
})();
document.getElementById('auto-rotate-toggle').addEventListener('change', async (e) => {
  await api.setSetting('auto_rotate_enabled', e.target.checked ? 'true' : 'false');
});

// ── Corroborated auto-file (corroboration_autofile, default OFF; Oracle-signed 2026-08-11) ──
(async () => {
  try {
    const v = await api.getSetting('corroboration_autofile');
    document.getElementById('corrob-autofile-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('corrob-autofile-toggle').checked = false; }
})();
document.getElementById('corrob-autofile-toggle').addEventListener('change', async (e) => {
  await api.setSetting('corroboration_autofile', e.target.checked ? 'true' : 'false');
});

// ── Post-reprocess consent offer (reprocess_autocommit_offer, default ON — Oracle-granted
// deviation 2026-08-12: the offer is consent-gated, hence fail-safe; the silent queue-wide
// sweep it replaced is REMOVED, not flag-preserved) ──
(async () => {
  try {
    const v = await api.getSetting('reprocess_autocommit_offer');
    document.getElementById('reprocess-autocommit-toggle').checked = (v !== 'false');   // unset → ON
  } catch { document.getElementById('reprocess-autocommit-toggle').checked = true; }
})();
document.getElementById('reprocess-autocommit-toggle').addEventListener('change', async (e) => {
  await api.setSetting('reprocess_autocommit_offer', e.target.checked ? 'true' : 'false');
});

// ── Recover long refs the crop cuts off (ANCHOR_VALUE_RIGHT_GROW, default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('anchor_value_right_grow');
    document.getElementById('right-grow-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('right-grow-toggle').checked = false; }
})();
document.getElementById('right-grow-toggle').addEventListener('change', async (e) => {
  await api.setSetting('anchor_value_right_grow', e.target.checked ? 'true' : 'false');
});

// ── Trim a label off the start of a read value (ANCHOR_LABEL_LEFT_CLAMP, default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('anchor_label_left_clamp');
    document.getElementById('left-clamp-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('left-clamp-toggle').checked = false; }
})();
document.getElementById('left-clamp-toggle').addEventListener('change', async (e) => {
  await api.setSetting('anchor_label_left_clamp', e.target.checked ? 'true' : 'false');
});

// ── Recover a misread reference prefix (PREFIX_GARBLE_ADOPT, default OFF) ──────
(async () => {
  try {
    const v = await api.getSetting('prefix_garble_adopt');
    document.getElementById('prefix-garble-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('prefix-garble-toggle').checked = false; }
})();
document.getElementById('prefix-garble-toggle').addEventListener('change', async (e) => {
  await api.setSetting('prefix_garble_adopt', e.target.checked ? 'true' : 'false');
});

// ── Correct a reference that lost a cross-check (CROSSCHECK_OUTLIER_RECONCILE, default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('crosscheck_outlier_reconcile');
    document.getElementById('crosscheck-reconcile-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('crosscheck-reconcile-toggle').checked = false; }
})();
document.getElementById('crosscheck-reconcile-toggle').addEventListener('change', async (e) => {
  await api.setSetting('crosscheck_outlier_reconcile', e.target.checked ? 'true' : 'false');
});

// ── Double-check references and dates against the whole document (Slice-2 stage 2a,
// UNIVERSAL_VERIFY_RESTORE, default OFF; numeric/text stages keep their own switches) ──
(async () => {
  try {
    const v = await api.getSetting('universal_verify_restore');
    document.getElementById('universal-verify-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('universal-verify-toggle').checked = false; }
})();
document.getElementById('universal-verify-toggle').addEventListener('change', async (e) => {
  await api.setSetting('universal_verify_restore', e.target.checked ? 'true' : 'false');
});

// ── Tidy stray marks from taught reference reads (Slice A edge-debris heal,
// TEMPLATE_CODE_EDGE_CLEAN, default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('template_code_edge_clean');
    document.getElementById('edge-clean-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('edge-clean-toggle').checked = false; }
})();
document.getElementById('edge-clean-toggle').addEventListener('change', async (e) => {
  await api.setSetting('template_code_edge_clean', e.target.checked ? 'true' : 'false');
});

// ── Snap taught boxes to the printed text (Slice B word-snap, TEMPLATE_TARGET_WORD_SNAP,
// default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('template_target_word_snap');
    document.getElementById('word-snap-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('word-snap-toggle').checked = false; }
})();
document.getElementById('word-snap-toggle').addEventListener('change', async (e) => {
  await api.setSetting('template_target_word_snap', e.target.checked ? 'true' : 'false');
});

// ── Remove label fragments / complete cut-short taught reads (NIGHT round 2026-08-03:
// TEMPLATE_CODE_FRAG_CLEAN + TEMPLATE_CLIP_COMMIT, both default OFF) + the jitter-crater
// arc trio (Oracle 2026-08-05, gates green: TEMPLATE_ABS_EDGE_GUARD word-edge grow ·
// TEMPLATE_DATE_CLIP_GATE cut-date reject · TEMPLATE_LABEL_DIGIT_EXACT locate digit
// exactness — all default OFF until the owner flip) ──
for (const [id, key] of [['frag-clean-toggle', 'template_code_frag_clean'],
                         ['clip-commit-toggle', 'template_clip_commit'],
                         ['edge-guard-toggle', 'template_abs_edge_guard'],
                         ['date-clip-toggle', 'template_date_clip_gate'],
                         ['label-digit-toggle', 'template_label_digit_exact'],
                         ['angle-compose-toggle', 'teach_angle_compose'],
                         ['edge-cut-relocate-toggle', 'template_edge_cut_relocate'],
                         ['clip-slack-toggle', 'template_clip_commit_edge_slack'],
                         ['date-invalid-yield-toggle', 'template_date_invalid_yield'],
                         ['date-future-yield-toggle', 'template_date_future_yield'],
                         ['pad-window-read-toggle', 'template_pad_window_read'],
                         ['heading-absent-reread-toggle', 'heading_absent_reread'],
                         // Type-election title-first (herald 2026-08-12): one switch → three
                         // keyword.py env flags via _reconcileEnv (the heading_absent_reread pattern).
                         ['type-election-title-toggle', 'type_election_title_first'],
                         ['xcheck-demote-toggle', 'xcheck_corrob_note_demote'],
                         // Corroboration step 3, slice 2 (Oracle W/COND 2026-08-13): adjusted-total
                         // note demote — crop witness (penny-exact + sign) AND arithmetic re-check.
                         ['recon-demote-toggle', 'recon_total_note_demote'],
                         // Corroboration step 3, slice 3 (Oracle W/COND B1-B3 2026-08-13): name
                         // note demote — crop + keyword witnesses, guard-rejected dissenters.
                         ['name-demote-toggle', 'name_corrob_note_demote'],
                         // Machine-feed arc slice 1 (Oracle W/COND C1-C6 2026-08-13): learning.js
                         // + templates.js read the key directly (setting-only, no env bridge).
                         ['machine-confirms-toggle', 'learning_exclude_machine_confirms'],
                         ['credit-sign-toggle', 'credit_sign_coherence'],
                         ['inline-row-overlap-toggle', 'template_inline_row_overlap'],
                         ['ref-role-digit-toggle', 'ref_role_digit_gate'],
                         ['inline-offset-veto-toggle', 'anchor_inline_taught_offset_veto'],
                         // The money slice (Oracle C1-C7 closed, `c027d86`). Independent switches:
                         // the row-pitch fix is standalone, but currency-edge-grow is INERT unless
                         // 'template_target_word_snap' or 'template_abs_edge_guard' is also on —
                         // both already true on this install, and both have their own rows above.
                         ['drift-row-pitch-toggle', 'template_drift_row_pitch'],
                         ['currency-edge-grow-toggle', 'template_currency_edge_grow'],
                         // NAME leg of the edge guard (2026-08-11 flush-edge clip class):
                         // right-edge cut only, last-token repair, page-present witness,
                         // FLAG-ONLY commit — inert unless template_abs_edge_guard is also on.
                         ['name-edge-grow-toggle', 'template_name_edge_grow'],
                         // Teach-side pair. 'angle-compose-scan' is the SIBLING of the
                         // 'angle-compose-toggle' row above and they are mutually exclusive in the
                         // extractor by construction, so both may be on; on the ordinary import
                         // path (no deskew) this is the one that actually fires.
                         ['angle-compose-scan-toggle', 'teach_angle_compose_scan'],
                         ['fixed-issuer-repair-toggle', 'template_fixed_issuer_repair'],
                         // The issuer cure: the registration arbiter may only override a taught
                         // read when the field's own caption was looked for AND failed. A mapping
                         // with no caption (every `supplier_name` mapping on this install) never
                         // had a test to fail, so it was being overridden on no local evidence.
                         ['reg-arbiter-anchor-evidence-toggle', 'template_reg_arbiter_anchor_evidence'],
                         // Its standing guard: keep a confirmed issuer when that name is
                         // actually printed in the taught region on THIS page. Confirm-only.
                         ['issuer-region-presence-toggle', 'template_issuer_region_presence'],
                         // Agreement is corroboration: an exact re-read of the confirmed issuer
                         // keeps the seed's 95 instead of demoting it to the mapping tier's 78.
                         ['fixed-seed-agreement-toggle', 'template_fixed_seed_agreement_keep'],
                         // The 2026-08-08 teach-side trio + the filing sanity flags: built
                         // and measured, then left env-only, so no install could reach them.
                         ['stage05-ref-code-toggle', 'stage05_ref_code_gate'],
                         ['generic-caption-exclusive-toggle', 'keyword_generic_caption_exclusive'],
                         ['type-title-owner-toggle', 'type_title_owner_precedence'],
                         ['filing-sanity-flags-toggle', 'filing_value_sanity_flags'],
                         // Cold start: read the sender off the letterhead on document #1 and
                         // OFFER it (never fill it in - a wrong assert plants a bad scope).
                         ['letterhead-issuer-toggle', 'letterhead_issuer'],
                         // A learned layout may only claim a document that names its company -
                         // the wrong-company misfile (2026-08-10).
                         ['identity-on-page-toggle', 'template_identity_on_page'],
                         // A confirmed taught label REPLACES the generic keyword bank for its
                         // field, scoped to the template it was taught on (migrations 61+62).
                         // JS-side setting read (both teach writers + the extraction payload);
                         // no env bridge needed.
                         ['teach-label-keyword-toggle', 'teach_label_becomes_keyword'],
                         // LIST field type: collect every occurrence of the field's label
                         // (serial numbers). Bridged to LIST_FIELD_SCAN in _reconcileEnv.
                         ['list-field-scan-toggle', 'list_field_scan'],
                         // Declared-absent fields stay EMPTY (engine drop + reprocess merge).
                         ['hidden-field-drop-toggle', 'template_hidden_field_drop'],
                         // Bridged 2026-08-10: both were built + measured on 08-09 and recorded as
                         // "awaiting the owner's flip", but neither had a bridge, so there was
                         // nothing to flip - env-only, and npm start injects no env.
                         ['format-fail-yield-toggle', 'template_format_fail_yield'],
                         ['customer-po-labels-toggle', 'customer_po_labels'],
                         // A printed separator inside a reference code is not an OCR artefact -
                         // 'PI/26/6000' was being committed as 'PI266000' (2026-08-10).
                         ['code-separator-guard-toggle', 'code_separator_structure_guard'],
                         // vat_no's shipped format is UK-only, so a non-UK supplier reads empty and
                         // a correctly typed number is warned against (2026-08-10).
                         ['vat-eu-formats-toggle', 'vat_eu_formats'],
                         ['deskew-import-toggle', 'deskew_on_import'],
                         // NOT an extraction switch and NOT bridged through _reconcileEnv: the
                         // auto-file gate is JS-side, so database/modules/trust.js reads this key
                         // itself, once per document. That also means it takes effect on the next
                         // filing decision rather than needing an app restart.
                         ['shadow-row-skip-toggle', 'trust_shadow_row_skip'],
                         // Gate-unify (Oracle W/COND 2026-08-12 NIGHT): JS-side reads — trust.js
                         // owns autofile_gate_unify (T1 import gate + T2 missing-required refusal
                         // + T3 via stamps share trust._gateUnifyEnabled); documents.js + the
                         // Review renderer own far_lowconf_valued_only. No _reconcileEnv leg.
                         ['autofile-gate-unify-toggle', 'autofile_gate_unify'],
                         ['far-valued-only-toggle', 'far_lowconf_valued_only'],
                         // Stale shadow-row drop on reprocess (2026-08-12 NIGHT, the Pelican
                         // re-poison exhibit): processing/handler.js reads the key at merge time.
                         ['shadow-stale-drop-toggle', 'reprocess_shadow_stale_drop'],
                         // A corroborated total is no longer capped when the only disagreeing
                         // operands are invisible shadow reads (Oracle W/COND ×5, 2026-08-12).
                         ['shadow-attrib-toggle', 'reconcile_shadow_attribution'],
                         // '@'-decorated rate annotations skipped to the amount column (2026-08-12).
                         ['vat-rate-at-toggle', 'vat_rate_at_skip'],
                         // Self-discharging operator pins (Oracle W/COND, 2026-08-12).
                         ['pin-discharge-toggle', 'supplier_pin_self_discharge'],
                         // Confirmed-dominant adoption (Oracle B1-B5, 2026-08-12).
                         ['confirmed-adopt-toggle', 'confirmed_dominant_adopt'],
                         // Raw-crop witness (Oracle C1-C6, 2026-08-12) — C4: flip WITH the
                         // separator guard, sep-guard AFTER; never the guard alone.
                         ['raw-witness-flag-toggle',  'raw_crop_witness_flag'],
                         ['raw-witness-adopt-toggle', 'raw_crop_witness_adopt'],
                         // Graduation issuer freeze (Oracle W/COND, 2026-08-12; C6 narrowed).
                         // FLIP CHECKLIST: record template_identity_on_page state — flipping this
                         // with identity-on-page OFF re-opens the wrong-company class with
                         // stronger stamps; flip them together.
                         ['graduation-freeze-issuer-toggle', 'graduation_freeze_issuer'],
                         // Filing-identity coherence (2026-08-14): the folder + learning scope key
                         // are taken from a supplier value captured BEFORE Stage 4.5 can repair it,
                         // so a healed name reaches the extraction row while the document files and
                         // learns under the unrepaired string. Flip needs the corpus arm — every
                         // moved document must move TOWARD the corroborated value, M=0.
                         ['identity-scope-post-repair-toggle', 'identity_scope_post_repair'],
                         // Identity-overwrite guard (2026-08-14, the Chris round-4 exhibit): a
                         // teach could replace a frozen company identity backed by 38 confirms
                         // with one draw-box OCR read. Read inside templates.js at the one upsert
                         // every writer passes through; a genuinely different company still wins.
                         ['identity-near-match-keep-toggle', 'teach_identity_near_match_keep'],
                         // Hold the siblings (2026-08-13, owner decision 4): a teach that replaces a
                         // frozen identity with a genuinely DIFFERENT company commits, but the
                         // layout's other documents ask for one more confirmation before the new
                         // name is used at full confidence. Read in BOTH places — templates.js marks
                         // the template, and the Python stamp yields via TEMPLATE_IDENTITY_HOLD_SIBLINGS.
                         ['identity-hold-siblings-toggle', 'template_identity_hold_siblings'],
                         // Buyer-issued type scope (2026-08-13): a layout taught on a purchase
                         // order the business ISSUED stops claiming inbound documents whose own
                         // printed title says they are something else.
                         ['buyer-issued-scope-toggle', 'template_buyer_issued_type_scope'],
                         // Name lexicon from a low-distinct scope (B5, 2026-08-13): the shipped
                         // name repair never saw the scopes with ONE dominant confirmed name.
                         // Suggest-and-review only — it can never silently rewrite a company name.
                         ['name-lex-low-distinct-toggle', 'name_lexicon_low_distinct'],
                         // Issuer near-match confirm gate (2026-08-14, Chris round 6): a typed OR drawn
                         // company name one/two chars off one you already use is held for a Use/Keep
                         // choice before filing. JS-side — reviewService.confirm reads the key. Seeded
                         // ON by migration 68 so the toggle renders truthfully.
                         ['issuer-near-match-confirm-toggle', 'issuer_near_match_confirm_guard'],
                         // Graduation-licensed fuzzy geometry shed (2026-08-14, the owner's Silverbeck
                         // class): drop the "please confirm" note on a heavily-graduated layout when the
                         // garbled letterhead still fuzzily names the graduated issuer. DEFAULT OFF —
                         // needs the corpus arm + Oracle flip conditions before it goes on.
                         ['identity-geom-fuzzy-toggle', 'template_identity_geom_fuzzy_graduate'],
                         // ── Corroboration-driven auto-file resolution (2026-08-15 held-queue arc, mig 69) ──
                         // Each lets the DB's own recorded corroboration resolve a note/floor that today
                         // holds a document whose value is already known-good. ALL DEFAULT OFF; Oracle
                         // owes a per-predicate ratification (B/D/E/G) before any defaults to ON.
                         // G (gate, JS): a licensed ref/date read clears the 88 critical-field floor when
                         // it matches the scope's dominant learned shape. Nested under corroboration_autofile.
                         ['critfield-corrob-relax-toggle', 'critfield_corrob_floor_relax'],
                         // B (gate, JS): a corrected_to equal to the committed value no longer flags.
                         ['vacuous-corrected-ignore-toggle', 'vacuous_corrected_to_ignore'],
                         // B (extraction): drop the 1/I rawwitness note when the ref already matches the
                         // scope's ≥90%-dominant learned prefix (the note was holding a correct value).
                         ['ref-dominant-format-demote-toggle', 'ref_dominant_format_note_demote'],
                         // A (extraction): shed "Company inferred… please confirm" from the persisted
                         // corroboration (geometry-free) on a graduated single-issuer layout.
                         ['identity-corrob-shed-toggle', 'template_identity_corrob_note_shed'],
                         // C (extraction): drop a doubly-corroborated total's shadow-attribution note on a
                         // penny-exact VAT re-verify — never changes the total value.
                         ['shadow-attrib-demote-toggle', 'recon_shadow_attrib_note_demote'],
                         // D (extraction): snap-and-adopt a symbol-misread of a single-canonical confirmed
                         // constant (ACC-229] → ACC-2291) when an independent hint family corroborates.
                         ['snap-confusable-adopt-toggle', 'snap_confusable_clean_autofile'],
                         // E (extraction): ADOPT a Stage-4.5 name suggestion (non-identity fields only) when
                         // it equals the scope's dominant confirmed literal AND the page's own keyword read.
                         ['name-corrob-adopt-toggle', 'name_corrob_suggestion_adopt'],
                         // The linchpin: after a note is cleared/demoted, recompute the format-consistency
                         // penalty so the document's confidence actually rises (else the demote is cosmetic).
                         ['corrob-recompute-fc-toggle', 'corrob_note_recompute_fc'],
                         // P (extraction, 2026-08-16): adopt the scope's ≥90%-dominant ref PREFIX over a
                         // single-confusable read head (P1/→PI/) — page witness required, both-forms refusal.
                         ['ref-prefix-confusable-adopt-toggle', 'ref_prefix_confusable_adopt'],
                         // Vacuous raw-witness suppression (2026-08-16): when the repair lands ON the wider
                         // reading, stop asking the operator to compare a value with itself.
                         ['raw-witness-vacuous-suppress-toggle', 'raw_witness_vacuous_suppress']]) {
  (async () => {
    try {
      const v = await api.getSetting(key);
      document.getElementById(id).checked = (v === 'true');   // unset → off
    } catch { document.getElementById(id).checked = false; }
  })();
  document.getElementById(id).addEventListener('change', async (e) => {
    await api.setSetting(key, e.target.checked ? 'true' : 'false');
  });
}

// ── Fix families where ONE owner-facing switch drives TWO stored settings. Each pair is
// always flipped together (the second is meaningless alone), so the UI shows one row and
// writes both keys. Read state from the FIRST key; both default OFF.
//  • curated sender name  — template_fixed_near_match (same name, misread) +
//    template_fixed_fragment (debris too short to be a company name). Both decline a bad
//    letterhead read in favour of the template's saved value.
//  • pad-window code read — template_pad_window_code (label-less taught boxes) +
//    template_pad_window_code_labelled (labelled ones; a STRICT SUBSET that the bridge
//    ignores unless the parent is also on).
//  • VAT registration vs VAT amount — vat_reg_not_amount + net_misread_total_flag. Paired because
//    removing the phantom tax also disarms the "total looks like the subtotal" note (that arm needs
//    a tax to be present), so a net-as-gross total would lose a TRUE flag. Measured over 288 docs:
//    false alarms 39 -> 0; true flags 16 -> 12 alone, 15 when paired, with zero false flags added.
for (const [id, keys] of [['template-fixed-supplier-toggle', ['template_fixed_near_match', 'template_fixed_fragment']],
                          ['pad-window-code-toggle', ['template_pad_window_code', 'template_pad_window_code_labelled']],
                          ['vat-reg-toggle', ['vat_reg_not_amount', 'net_misread_total_flag']]]) {
  (async () => {
    try {
      const v = await api.getSetting(keys[0]);
      document.getElementById(id).checked = (v === 'true');   // unset → off
    } catch { document.getElementById(id).checked = false; }
  })();
  document.getElementById(id).addEventListener('change', async (e) => {
    const val = e.target.checked ? 'true' : 'false';
    for (const k of keys) await api.setSetting(k, val);
  });
}

// ── ADVANCED READING SWITCHES gate (owner decision 2026-08-11) ───────────────────────────────
// The Processing tab grew ~50 kill-switch/experimental toggles a customer should never meet
// (Chris, both rounds: "58 switches, 46 ON"). They hide behind ONE persisted SFDEV unlock
// (`dev_switches_unlocked`; password checked in MAIN — dev-switches-unlock IPC). Hiding changes
// NO flag values — the rows still exist and the wiring pins still see them; only visibility
// moves. The visible set = genuine customer choices (auto-file, thresholds, straighten,
// watch/rotate/multiline, printing/slips, generic/title, name checks, telemetry/diag) plus the
// three switches the owner is actively evaluating (teach-label-keyword, list-field-scan,
// hidden-field-drop) — migrate those behind the gate once settled.
const DEV_SWITCH_IDS = [
  'right-grow-toggle', 'left-clamp-toggle', 'prefix-garble-toggle', 'crosscheck-reconcile-toggle',
  'universal-verify-toggle', 'edge-clean-toggle', 'word-snap-toggle', 'struct-code-read-toggle',
  'warm-ocr-toggle', 'parallel-reprocess-toggle',
  'template-fixed-supplier-toggle', 'pad-window-code-toggle', 'vat-reg-toggle',
  'frag-clean-toggle', 'clip-commit-toggle', 'edge-guard-toggle', 'date-clip-toggle',
  'label-digit-toggle', 'angle-compose-toggle', 'edge-cut-relocate-toggle', 'clip-slack-toggle',
  'date-invalid-yield-toggle', 'date-future-yield-toggle', 'pad-window-read-toggle',
  'heading-absent-reread-toggle', 'credit-sign-toggle', 'inline-row-overlap-toggle',
  'ref-role-digit-toggle', 'inline-offset-veto-toggle', 'drift-row-pitch-toggle',
  'currency-edge-grow-toggle', 'name-edge-grow-toggle', 'angle-compose-scan-toggle',
  'fixed-issuer-repair-toggle',
  'reg-arbiter-anchor-evidence-toggle', 'issuer-region-presence-toggle',
  'fixed-seed-agreement-toggle', 'stage05-ref-code-toggle', 'generic-caption-exclusive-toggle',
  'type-title-owner-toggle', 'filing-sanity-flags-toggle', 'letterhead-issuer-toggle',
  'identity-on-page-toggle', 'format-fail-yield-toggle', 'customer-po-labels-toggle',
  'code-separator-guard-toggle', 'vat-eu-formats-toggle', 'shadow-row-skip-toggle',
  'shadow-attrib-toggle', 'vat-rate-at-toggle', 'pin-discharge-toggle',
  'graduation-freeze-issuer-toggle', 'confirmed-adopt-toggle',
  'raw-witness-flag-toggle', 'raw-witness-adopt-toggle',
  // Corroboration-driven auto-file resolution (2026-08-15 arc) — technical reading internals, hidden
  // from customers per the owner's decision; they ship ON (migration 70) and work silently.
  'critfield-corrob-relax-toggle', 'vacuous-corrected-ignore-toggle', 'ref-dominant-format-demote-toggle',
  'identity-corrob-shed-toggle', 'shadow-attrib-demote-toggle', 'snap-confusable-adopt-toggle',
  'name-corrob-adopt-toggle', 'corrob-recompute-fc-toggle',
  // 2026-08-16 additions (Oracle S-O-W/C): the P prefix-adopt lane + the vacuous-witness suppression.
  'ref-prefix-confusable-adopt-toggle', 'raw-witness-vacuous-suppress-toggle',
];
function _applyDevSwitchVisibility(unlocked, revealGate){
  for (const id of DEV_SWITCH_IDS){
    const row = document.getElementById(id)?.closest('.threshold-row');
    if (row) row.classList.add('dev-switch');
  }
  const panel = document.getElementById('panel-processing');
  if (panel) panel.classList.toggle('dev-unlocked', !!unlocked);
  const lockRow = document.getElementById('dev-switches-lock-row');
  const openRow = document.getElementById('dev-switches-open-row');
  if (lockRow) lockRow.style.display = unlocked ? 'none' : '';
  if (openRow) openRow.style.display = unlocked ? '' : 'none';
  // The GATE ITSELF is invisible unless unlocked or explicitly summoned by the dev combo
  // (owner: a visible locked door "leads to curiosity"). Customers see nothing at all.
  const group = document.getElementById('dev-switches-group');
  if (group) group.style.display = (unlocked || revealGate) ? '' : 'none';
}
(async () => {
  let unlocked = false;
  try { unlocked = (await api.getSetting('dev_switches_unlocked')) === 'true'; } catch {}
  _applyDevSwitchVisibility(unlocked);
})();
document.getElementById('dev-switches-show')?.addEventListener('click', async () => {
  const inp = document.getElementById('dev-switches-pw');
  const msg = document.getElementById('dev-switches-msg');
  let r = null;
  try { r = await api.devSwitchesUnlock((inp?.value || '').trim()); } catch {}
  if (r && r.ok){ if (inp) inp.value = ''; if (msg) msg.textContent = ''; _applyDevSwitchVisibility(true); }
  else if (msg) msg.textContent = 'That password isn’t right.';
});
document.getElementById('dev-switches-hide')?.addEventListener('click', async () => {
  try { await api.setSetting('dev_switches_unlocked', 'false'); } catch {}
  _applyDevSwitchVisibility(false);
});
// The familiar dev combo (Ctrl+Shift+D then M — the main window's inspector / Review's trace
// console) is the ONLY way to summon the gate (owner, 2026-08-11): it reveals the hidden
// group on the Processing tab and puts the caret in the password box — or scrolls to the hide
// row when already unlocked. Same 3-second two-key window as the other surfaces.
let _devComboArmed = 0;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === 'd') { _devComboArmed = Date.now(); return; }
  if (String(e.key).toLowerCase() === 'm' && _devComboArmed && Date.now() - _devComboArmed < 3000) {
    _devComboArmed = 0;
    document.querySelector('.tab[data-tab="processing"]')?.click();
    const lockRow = document.getElementById('dev-switches-lock-row');
    const unlocked = !lockRow || lockRow.style.display === 'none';
    if (unlocked) {
      document.getElementById('dev-switches-open-row')?.scrollIntoView({ block: 'center' });
      return;
    }
    _applyDevSwitchVisibility(false, /*revealGate*/true);
    lockRow.scrollIntoView({ block: 'center' });
    const pw = document.getElementById('dev-switches-pw');
    if (pw) {
      if (typeof focusField === 'function') focusField(pw);
      else try { pw.focus(); } catch {}
    }
  }
});

// ── Read small reference/date print more clearly (STRUCT_CODE_READ, default OFF) ──
(async () => {
  try {
    const v = await api.getSetting('struct_code_read');
    document.getElementById('struct-code-read-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('struct-code-read-toggle').checked = false; }
})();
document.getElementById('struct-code-read-toggle').addEventListener('change', async (e) => {
  await api.setSetting('struct_code_read', e.target.checked ? 'true' : 'false');
});

// ── Faster field reads via a warm OCR helper pool (default ON) ─────────────────
(async () => {
  try {
    const v = await api.getSetting('ocr_warm_worker_enabled');
    document.getElementById('warm-ocr-toggle').checked = (v !== 'false');   // unset → on
  } catch { document.getElementById('warm-ocr-toggle').checked = true; }
})();
document.getElementById('warm-ocr-toggle').addEventListener('change', async (e) => {
  await api.setSetting('ocr_warm_worker_enabled', e.target.checked ? 'true' : 'false');
});

// ── Faster single-document reprocessing via multiple CPU cores (Option B/C; default OFF) ──────
(async () => {
  try {
    const v = await api.getSetting('ocr_parallel_reprocess_enabled');
    document.getElementById('parallel-reprocess-toggle').checked = (v === 'true');   // unset → off
  } catch { document.getElementById('parallel-reprocess-toggle').checked = false; }
})();
document.getElementById('parallel-reprocess-toggle').addEventListener('change', async (e) => {
  await api.setSetting('ocr_parallel_reprocess_enabled', e.target.checked ? 'true' : 'false');
});

// ── Home dashboard cards (show/hide) ───────────────────────────────────────────
// A toggle per Home card. Checked = shown, unchecked = hidden. Stored as a JSON list of HIDDEN
// card ids in `dashboard_hidden_cards`; the main window applies it live (dashboard-cards-changed).
// Grouped to mirror the Home screen's two tiers, so the toggles read in the same order/sections
// as the dashboard itself.
const DASH_CARD_SECTIONS = [
  ['Top', [
    ['dash-quickfind', 'Quick find'],
    ['dash-attention', 'Needs your attention'],
    ['dash-workflow',  'Waiting on you (approvals)'],
    ['dash-pulse',     'Documents filed'],
    ['dash-autofile',  'Filed automatically'],
    ['dash-learning',  'Getting smarter'],
    ['dash-tips',      'Did you know'],
    ['dash-practice',  'Practice run'],
    ['dash-recent',    'Recent activity'],
  ]],
  ['Files & folders', [
    ['dash-watch',   'Auto-import'],
    ['dash-import',  'Import documents'],
    ['dash-output',  'Where your files go'],
    ['dash-storage', 'Storage'],
    ['dash-backup',  'Backup'],
    ['dash-clients', 'Search clients'],
  ]],
];
async function _readHiddenCards() {
  try { const raw = await api.getSetting('dashboard_hidden_cards'); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
(async () => {
  const wrap = document.getElementById('dash-cards-toggles');
  if (!wrap) return;
  const hidden = await _readHiddenCards();
  wrap.innerHTML = '';
  for (const [section, cards] of DASH_CARD_SECTIONS) {
    const head = document.createElement('div'); head.className = 'dash-cards-subhead'; head.textContent = section;
    wrap.appendChild(head);
    const grid = document.createElement('div'); grid.className = 'dash-cards-grid';   // multi-column
    for (const [id, label] of cards) {
      const row = document.createElement('div'); row.className = 'threshold-row';
      row.innerHTML = `<div><div class="threshold-label">${label}</div></div>
        <label class="toggle"><input type="checkbox" data-card="${id}"${hidden.includes(id) ? '' : ' checked'}><span class="toggle-slider"></span></label>`;
      grid.appendChild(row);
    }
    wrap.appendChild(grid);
  }
  wrap.addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-card]');
    if (!cb) return;
    let h = await _readHiddenCards();
    h = h.filter((x) => x !== cb.dataset.card);
    if (!cb.checked) h.push(cb.dataset.card);   // unchecked = hidden
    await api.setSetting('dashboard_hidden_cards', JSON.stringify(h));
  });
})();

// Processing mode (Fast/Smart) was collapsed to one mode — the two became identical after
// the AI-mode removal — so there is no longer a user-facing selector here. The backend still
// stores `processing_mode` (default 'smart') and honours it for tolerance.

// ── Parallel document processing (worker count) ───────────────────────────────
const concurrencySelect = document.getElementById('processing-concurrency');
async function loadProcessingConcurrency() {
  // Size the picker to THIS PC's cores (core-aware cap in the processing handler), so a
  // powerful machine can go higher and a modest one can't oversubscribe.
  let cores = 4, cap = 4, recommended = 2;
  try { const info = await api.getConcurrencyInfo(); if (info) { cores = info.cores || cores; cap = info.maxConcurrency || cap; recommended = info.recommended || recommended; } } catch {}
  cap = Math.max(1, cap);
  concurrencySelect.innerHTML = Array.from({ length: cap }, (_, i) =>
    `<option value="${i + 1}">${i + 1}</option>`).join('');

  let n = parseInt(await api.getSetting('processing_concurrency'), 10);
  if (!Number.isFinite(n)) n = recommended;   // core-aware default when never set
  n = Math.max(1, Math.min(cap, n));   // clamp the stored value to this PC's ceiling
  concurrencySelect.value = String(n);

  const help = document.getElementById('concurrency-help');
  if (help) {
    help.textContent =
      `How many documents ScanFinder reads at the same time. This PC has ${cores} processor `
      + `core${cores === 1 ? '' : 's'}, so you can go up to ${cap}. Higher is faster on a powerful `
      + `PC with plenty of memory, but each extra document uses more CPU and RAM — on a modest or `
      + `busy PC, too many can actually slow things down or run low on memory. If unsure, 1–2 is safe.`;
  }
}
loadProcessingConcurrency();

concurrencySelect.addEventListener('change', async () => {
  await api.setSetting('processing_concurrency', concurrencySelect.value);
});

// ── Per-document safety timeout (file watchdog; seconds, 0 = off) ──────────────
const fileTimeoutSelect = document.getElementById('file-timeout-select');
if (fileTimeoutSelect) {
  (async () => {
    let n = parseInt(await api.getSetting('file_timeout_seconds'), 10);
    if (!Number.isFinite(n) || n < 0) n = 300;                 // default 5 min
    if (!['0', '120', '300', '600'].includes(String(n))) n = 300;   // snap to an offered option
    fileTimeoutSelect.value = String(n);
  })();
  fileTimeoutSelect.addEventListener('change', async () => {
    await api.setSetting('file_timeout_seconds', fileTimeoutSelect.value);
  });
}

// ── Scan reading detail (OCR render resolution) ───────────────────────────────
// Lower DPI = faster OCR + far better parallel scaling, traded against small-text accuracy.
// Default 300 (byte-identical to the old hardcoded render). Snaps a stored/legacy value to an
// offered option; the backend independently coerces anything out of [100,600] back to 300.
const ocrDpiSelect = document.getElementById('ocr-dpi-select');
if (ocrDpiSelect) {
  (async () => {
    let n = parseInt(await api.getSetting('ocr_dpi'), 10);
    if (!Number.isFinite(n)) n = 300;                                   // unset → default 300
    if (!['150', '200', '300'].includes(String(n))) n = 300;           // snap to an offered option
    ocrDpiSelect.value = String(n);
  })();
  ocrDpiSelect.addEventListener('change', async () => {
    await api.setSetting('ocr_dpi', ocrDpiSelect.value);
  });
}


// ── Date format (region) — how an ambiguous numeric date is read ──────────────
const dateOrderSelect = document.getElementById('date-order-select');
async function loadDateOrder() {
  if (!dateOrderSelect) return;
  const v = (await api.getSetting('region_date_order') || 'dmy').toLowerCase();
  dateOrderSelect.value = ['dmy', 'mdy', 'ymd'].includes(v) ? v : 'dmy';
}
loadDateOrder();
if (dateOrderSelect) dateOrderSelect.addEventListener('change', async () => {
  try { await api.setSetting('region_date_order', dateOrderSelect.value); }
  catch { /* non-fatal; reloads on next open */ }
});

// ── Number format (region) — how money amounts group thousands / mark the decimal ──
const numberFormatSelect = document.getElementById('number-format-select');
const _NUM_FMTS = ['anglo', 'continental', 'french', 'swiss', 'indian'];
async function loadNumberFormat() {
  if (!numberFormatSelect) return;
  const v = (await api.getSetting('region_number_format') || 'anglo').toLowerCase();
  numberFormatSelect.value = _NUM_FMTS.includes(v) ? v : 'anglo';
}
loadNumberFormat();
if (numberFormatSelect) numberFormatSelect.addEventListener('change', async () => {
  try { await api.setSetting('region_number_format', numberFormatSelect.value); }
  catch { /* non-fatal; reloads on next open */ }
});


// ── Auto document separation (split multi-document PDFs) ───────────────────────
// Defaults ON (the backend reads 'auto_separate_enabled' with a 'true' default), so an
// unset install behaves as separation-on; this only persists an explicit choice.
const autoSeparateToggle = document.getElementById('auto-separate-toggle');
async function loadAutoSeparate() {
  if (!autoSeparateToggle) return;
  autoSeparateToggle.checked = (await api.getSetting('auto_separate_enabled')) !== 'false';
}
loadAutoSeparate();
if (autoSeparateToggle) autoSeparateToggle.addEventListener('change', async () => {
  try { await api.setSetting('auto_separate_enabled', autoSeparateToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
});

// ── Filing Slips ("Separator sheets") ──────────────────────────────────────────
// Default OFF (backend reads 'filing_slips_enabled' with a 'false' default). The
// detection gate is INDEPENDENT of the auto-separation toggle above (Oracle C2,
// docs/designs/FILING_SLIPS_2026-07-18.md). C3: while a watch folder is configured,
// a persistent warning explains sheets are detected on manual Import only.
const slipsToggle = document.getElementById('filing-slips-toggle');
const slipsWatchWarn = document.getElementById('filing-slips-watch-warn');
const slipsCountInput = document.getElementById('filing-slips-count');
const slipsPrintBtn = document.getElementById('filing-slips-print');
const slipsResult = document.getElementById('filing-slips-result');
async function slipsWatchConfigured() {
  try {
    return (await api.getSetting('watch_folder_enabled')) === '1'
      && !!(await api.getSetting('watch_folder'));
  } catch { return false; }
}
async function refreshSlipsWatchWarn() {
  if (!slipsWatchWarn) return;
  slipsWatchWarn.style.display = (slipsToggle?.checked && await slipsWatchConfigured()) ? '' : 'none';
}
async function loadFilingSlips() {
  if (!slipsToggle) return;
  slipsToggle.checked = (await api.getSetting('filing_slips_enabled')) === 'true';
  refreshSlipsWatchWarn();
}
loadFilingSlips();
if (slipsToggle) slipsToggle.addEventListener('change', async () => {
  try { await api.setSetting('filing_slips_enabled', slipsToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
  refreshSlipsWatchWarn();
});
// ── Document printing (Print-Slice 1) ──────────────────────────────────────────
// Default OFF (backend reads 'printing_enabled' with a 'false' default). Adds the
// Review Print button + the driver-dialog print IPC when on.
const printingToggle = document.getElementById('printing-toggle');
async function loadPrinting() {
  if (!printingToggle) return;
  try { printingToggle.checked = (await api.getSetting('printing_enabled')) === 'true'; } catch {}
}
loadPrinting();
if (printingToggle) printingToggle.addEventListener('change', async () => {
  try { await api.setSetting('printing_enabled', printingToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
});

// ── Generic Document fallback + Auto-Title (docs/designs/GENERIC_DOCTYPE_2026-07-18.md) ──
// Defaults OFF (backend reads 'generic_fallback_enabled' / 'auto_title_enabled' with
// 'false' defaults). Enabling the fallback AUTO-CREATES the "General Document" preset
// first (transactional + idempotent via the existing add-doctype-presets IPC — owner Q5)
// so the insert-seam mapping always has a type to land on.
const genericToggle = document.getElementById('generic-fallback-toggle');
const autoTitleToggle = document.getElementById('auto-title-toggle');
async function loadGenericFallback() {
  try {
    if (genericToggle) genericToggle.checked = (await api.getSetting('generic_fallback_enabled')) === 'true';
    if (autoTitleToggle) autoTitleToggle.checked = (await api.getSetting('auto_title_enabled')) === 'true';
  } catch { /* defaults stay unchecked */ }
}
loadGenericFallback();
if (genericToggle) genericToggle.addEventListener('change', async () => {
  try {
    if (genericToggle.checked) { try { await api.addDoctypePresets(['general_document']); } catch { /* already present */ } }
    await api.setSetting('generic_fallback_enabled', genericToggle.checked ? 'true' : 'false');
  } catch { /* non-fatal; reloads on next open */ }
});
if (autoTitleToggle) autoTitleToggle.addEventListener('change', async () => {
  try { await api.setSetting('auto_title_enabled', autoTitleToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
});

if (slipsPrintBtn) slipsPrintBtn.addEventListener('click', async () => {
  slipsPrintBtn.disabled = true;
  if (slipsResult) { slipsResult.style.display = ''; slipsResult.textContent = 'Creating separator sheets…'; }
  try {
    const res = await api.generateFilingSlips(parseInt(slipsCountInput?.value, 10));
    if (res && res.success && slipsResult) {
      const pad = (n) => String(n).padStart(4, '0');
      slipsResult.textContent = '';
      slipsResult.append(`Created sheets ${pad(res.first)}–${pad(res.last)}. `);
      const openBtn = document.createElement('button');
      openBtn.className = 'btn'; openBtn.textContent = 'Open to print';
      openBtn.style.marginRight = '6px';
      openBtn.addEventListener('click', () => api.openFile(res.path));
      const showBtn = document.createElement('button');
      showBtn.className = 'btn'; showBtn.textContent = 'Show in folder';
      showBtn.addEventListener('click', () => api.showInExplorer(res.path));
      slipsResult.append(openBtn, showBtn);
      if (await slipsWatchConfigured()) {
        const w = document.createElement('div');
        w.style.color = 'var(--warn)';
        w.textContent = 'Note: sheets are detected on manual Import only — not yet in the auto-import folder.';
        slipsResult.append(w);
      }
    } else if (slipsResult) {
      slipsResult.textContent = `Could not create sheets: ${(res && res.error) || 'unknown error'}`;
    }
  } catch (e) {
    if (slipsResult) slipsResult.textContent = `Could not create sheets: ${e.message}`;
  }
  slipsPrintBtn.disabled = false;
});

// ── Name wordness review flag (flag odd supplier/customer names) ───────────────
// Defaults ON (backend reads 'name_wordness_flag' with a 'true' default); flag-only,
// so this only persists an explicit choice and never changes extracted values.
const nameWordnessToggle = document.getElementById('name-wordness-toggle');
async function loadNameWordness() {
  if (!nameWordnessToggle) return;
  nameWordnessToggle.checked = (await api.getSetting('name_wordness_flag')) !== 'false';
}
loadNameWordness();
if (nameWordnessToggle) nameWordnessToggle.addEventListener('change', async () => {
  try { await api.setSetting('name_wordness_flag', nameWordnessToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
});

// ── Supplier-identity conflict flag (letterhead reads a different known supplier) ──
// ON by default (backend reads 'identity_conflict_flag' with a 'true' default). Flag-only,
// so this only persists an explicit choice and never changes extracted values.
const identityConflictToggle = document.getElementById('identity-conflict-toggle');
async function loadIdentityConflict() {
  if (!identityConflictToggle) return;
  identityConflictToggle.checked = (await api.getSetting('identity_conflict_flag')) !== 'false';
}
loadIdentityConflict();
if (identityConflictToggle) identityConflictToggle.addEventListener('change', async () => {
  try { await api.setSetting('identity_conflict_flag', identityConflictToggle.checked ? 'true' : 'false'); }
  catch { /* non-fatal; reloads on next open */ }
});

// ── Output Structure (folder + file-name builders) ──────────────────────────────
// Click-to-insert token "blocks" + free-form custom text, for BOTH the subfolder
// pattern (output_folder_pattern; "/" = a subfolder level) and the file name
// (filename_pattern, the existing engine). Live "OutputRoot › subfolders › file".
const folderPatternInput   = document.getElementById('folder-pattern-input');
const filenamePatternInput = document.getElementById('filename-pattern-input');
const filenamePatternMsg   = document.getElementById('filename-pattern-msg');
const outputPathPreview    = document.getElementById('output-path-preview');

let _defaultFolderPattern   = '{supplier}/{year}/{month}';
let _defaultFilenamePattern = '{docType}.{date}.{ref}';
let _outPreviewDebounce = null;
let folderPatternEditor = null, filenamePatternEditor = null;   // shared/pattern-editor.js

async function loadOutputStructure() {
  if (!folderPatternInput || typeof window.createPatternEditor !== 'function') return;
  const info = await api.getOutputStructureInfo();
  _defaultFolderPattern   = info.defaultFolder   || _defaultFolderPattern;
  _defaultFilenamePattern = info.defaultFilename || _defaultFilenamePattern;

  // Swap the raw "{token}/..." text inputs for pill editors (shared/pattern-editor.js) -
  // each known token becomes a friendly block; the STORED value stays the same pattern
  // string, so preview + filing are unchanged.
  if (!folderPatternEditor) folderPatternEditor = window.createPatternEditor(folderPatternInput,
    { tokens: info.tokens, placeholder: 'Click a block below, or type - use / for a new folder level',
      onChange: () => { saveOutputSetting(folderPatternInput); scheduleOutputPreview(); } });
  if (!filenamePatternEditor) filenamePatternEditor = window.createPatternEditor(filenamePatternInput,
    { tokens: info.tokens, placeholder: 'Click a block below, or type',
      onChange: () => { saveOutputSetting(filenamePatternInput); scheduleOutputPreview(); } });

  renderOutputTokenList('folder-token-list',   info.tokens, folderPatternEditor);
  renderOutputTokenList('filename-token-list', info.tokens, filenamePatternEditor);

  folderPatternEditor.setValue((await api.getSetting('output_folder_pattern')) || _defaultFolderPattern);
  filenamePatternEditor.setValue((await api.getSetting('filename_pattern'))     || _defaultFilenamePattern);
  updateOutputPreview();
}
loadOutputStructure();

// ── Duplicate-file label (Settings → Files & filing) ─────────────────────────
// Stored setting `duplicate_suffix`: DUPLICATE (default) | COPY | number | date | any custom word.
// Default is byte-identical to the legacy "-DUPLICATE". Server-authoritative preview (no drift).
const dupSelect  = document.getElementById('dup-suffix-select');
const dupCustom  = document.getElementById('dup-suffix-custom');
const dupPreview = document.getElementById('dup-preview');
const DUP_KNOWN  = new Set(['DUPLICATE', 'COPY', 'NUMBER', 'DATE']);
let _dupDebounce = null;

function _dupEffectiveValue() {
  if (!dupSelect) return 'DUPLICATE';
  if (dupSelect.value === '__custom') return (dupCustom.value || '').trim();
  return dupSelect.value;
}
async function refreshDupPreview() {
  if (!dupPreview) return;
  try {
    const r = await api.previewDuplicateName(_dupEffectiveValue() || 'DUPLICATE');
    dupPreview.textContent = (r && r.example) ? r.example : '…';
  } catch { dupPreview.textContent = '…'; }
}
async function saveDupSuffix() {
  // A blank custom box falls back to the default so filing never receives an empty label.
  try { await api.setSetting('duplicate_suffix', _dupEffectiveValue() || 'DUPLICATE'); } catch { /* noop */ }
  refreshDupPreview();
}
async function loadDupSuffix() {
  if (!dupSelect) return;
  const stored = String((await api.getSetting('duplicate_suffix')) || 'DUPLICATE').trim();
  const up = stored.toUpperCase();
  if (DUP_KNOWN.has(up)) {
    dupSelect.value = (up === 'NUMBER' || up === 'DATE') ? up.toLowerCase() : up;
    dupCustom.style.display = 'none';
  } else {
    dupSelect.value = '__custom';
    dupCustom.value = stored;
    dupCustom.style.display = '';
  }
  refreshDupPreview();
}
if (dupSelect) {
  dupSelect.addEventListener('change', () => {
    const custom = dupSelect.value === '__custom';
    dupCustom.style.display = custom ? '' : 'none';
    if (custom) { dupCustom.focus(); refreshDupPreview(); } else saveDupSuffix();
  });
  dupCustom.addEventListener('input', () => { clearTimeout(_dupDebounce); _dupDebounce = setTimeout(saveDupSuffix, 400); });
  loadDupSuffix();
}

function renderOutputTokenList(listId, tokens, editor) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  for (const t of (tokens || [])) {
    const chip = document.createElement('span');
    chip.className = 'pe-chip';
    chip.title = `Insert ${t.token} — example: ${t.example}`;
    chip.textContent = t.short || t.label;
    chip.addEventListener('mousedown', (e) => e.preventDefault());   // keep the caret in the field
    chip.addEventListener('click', () => editor.insertToken(t.token));
    list.appendChild(chip);
  }
}
// (insertOutputToken removed - palette chips now call editor.insertToken, pattern-editor.js.)

function scheduleOutputPreview() {
  clearTimeout(_outPreviewDebounce);
  _outPreviewDebounce = setTimeout(updateOutputPreview, 300);
}

async function updateOutputPreview() {
  if (!folderPatternEditor || !filenamePatternEditor) return;
  const root   = (await api.getSetting('output_folder')) || 'Output folder';
  const result = await api.previewOutputPath(folderPatternEditor.getValue().trim(), filenamePatternEditor.getValue().trim());
  outputPathPreview.textContent = [root, ...(result.segments || []), result.filename].join('  ›  ');
  if (result.warning) {
    filenamePatternMsg.textContent   = `⚠ ${result.warning}`;
    filenamePatternMsg.className     = 'pattern-msg warn';
    filenamePatternMsg.style.display = '';
  } else {
    filenamePatternMsg.style.display = 'none';
  }
}

async function saveOutputSetting(input) {
  if (input === folderPatternInput)   await api.setSetting('output_folder_pattern', folderPatternEditor.getValue().trim());
  if (input === filenamePatternInput) await api.setSetting('filename_pattern',      filenamePatternEditor.getValue().trim());
}

// Save + live preview are driven by each editor's onChange (wired in loadOutputStructure).

document.getElementById('btn-reset-folder-pattern')?.addEventListener('click', async () => {
  folderPatternEditor?.setValue(_defaultFolderPattern);
  await saveOutputSetting(folderPatternInput);
  updateOutputPreview();
});
document.getElementById('btn-reset-filename-pattern')?.addEventListener('click', async () => {
  filenamePatternEditor?.setValue(_defaultFilenamePattern);
  await saveOutputSetting(filenamePatternInput);
  updateOutputPreview();
});

// ── Confidence threshold ──────────────────────────────────────────────────────
const thresholdSlider = document.getElementById('global-threshold');
const thresholdVal    = document.getElementById('global-threshold-val');

async function loadThreshold() {
  const val = await api.getSetting('confidence_threshold');
  const n   = val != null ? parseInt(val) : 70;
  thresholdSlider.value    = n;
  thresholdVal.textContent = n + '%';
  if (typeof enforceAutoFileInvariant === 'function') enforceAutoFileInvariant(true);   // review <= auto-file
}
loadThreshold();

thresholdSlider.addEventListener('input', () => {
  thresholdVal.textContent = thresholdSlider.value + '%';
});
thresholdSlider.addEventListener('change', async () => {
  await api.setSetting('confidence_threshold', thresholdSlider.value);
});

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT TYPES TAB
// ══════════════════════════════════════════════════════════════════════════════

let allTypesWithFields = [];

async function loadDocTypes() {
  // LIST field type gate: the shared editor offers 'List (several values)' only while
  // list_field_scan is armed (an existing list-typed field always keeps its option).
  try { window.__listFieldTypeOn = (await api.getSetting('list_field_scan')) === 'true'; } catch {}
  allTypesWithFields = await api.getAllDocTypesAll();
  renderDocTypesList();
}

// Combined Document Types tab = master (left list) + detail (right pane). The
// detail pane delegates the fields + filing-role editing to the shared
// DocTypeEditor component (also used by the Teach wizard) so there's one editor.
let selectedDocTypeId = null;
let dtEditor = null;            // active DocTypeEditor controller; destroy before re-mount

function renderDocTypesList() {
  const list = document.getElementById('doctypes-list');
  list.innerHTML = '';

  for (const dt of allTypesWithFields) {
    const row = document.createElement('div');
    row.className = 'doctype-row'
      + (dt.enabled ? '' : ' disabled')
      + (dt.id === selectedDocTypeId ? ' active' : '');
    row.dataset.tid = dt.id;
    row.draggable = true;
    const fieldCount = (dt.fields || []).length;
    row.innerHTML = `
      <span class="doctype-handle" title="Drag to reorder this type" aria-hidden="true">&#10303;</span>
      <div class="doctype-name">
        <span class="doctype-nametext" title="${escHtml(dt.name)}">${escHtml(dt.name)}</span>
        <span class="${dt.built_in ? 'badge-builtin' : 'badge-custom'}">${dt.built_in ? 'built-in' : 'custom'}</span>
      </div>
      <span class="doctype-count" title="${fieldCount} field${fieldCount === 1 ? '' : 's'}">${fieldCount}</span>
    `;
    row.addEventListener('click', () => selectDocType(dt.id));
    list.appendChild(row);
  }
  wireDocTypeListReorder(list);
}

// ── Drag-to-reorder the doc-type LIST (owner-requested; mirrors the field-row pattern) ──
// Handle-armed native DnD, exactly the d91da4b gesture: the row is draggable but a drag
// only STARTS from the ⠿ handle, so plain clicks still select. Live feedback moves the
// SAME node via insertBefore; the drop commits ONCE via the SHARED
// DocTypeEditor.planReorder math (gap-of-10 sort_order, minimal writes). Container
// listeners are attached once (the container survives re-renders; rows don't).
function wireDocTypeListReorder(list) {
  if (list.dataset.dndWired) return;
  list.dataset.dndWired = '1';
  let pressedHandle = false;
  let dragRow = null;
  const rowAfter = (y) => {
    const rows = Array.prototype.slice.call(list.querySelectorAll('.doctype-row')).filter(r => r !== dragRow);
    for (const r of rows) {
      const box = r.getBoundingClientRect();
      if (y < box.top + box.height / 2) return r;
    }
    return null;
  };
  list.addEventListener('pointerdown', (e) => { pressedHandle = !!e.target.closest('.doctype-handle'); });
  list.addEventListener('pointerup',   () => { pressedHandle = false; });
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.doctype-row');
    if (!row || !pressedHandle) { e.preventDefault(); return; }
    dragRow = row;
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.tid || ''); } catch (_) {}
  });
  list.addEventListener('dragend', () => {
    pressedHandle = false;
    if (dragRow) dragRow.classList.remove('dragging');
    dragRow = null;
  });
  list.addEventListener('dragover', (e) => {
    if (!dragRow) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    const after = rowAfter(e.clientY);
    if (after == null) { if (dragRow !== list.lastElementChild) list.appendChild(dragRow); }
    else if (after !== dragRow && after !== dragRow.nextSibling) list.insertBefore(dragRow, after);
  });
  list.addEventListener('drop', (e) => {
    if (!dragRow) return;
    e.preventDefault();
    dragRow.classList.remove('dragging');
    dragRow = null; pressedHandle = false;
    const ids = Array.prototype.slice.call(list.querySelectorAll('.doctype-row')).map(r => Number(r.dataset.tid));
    commitDocTypeOrder(ids);
  });
}

// Persist a new type-list order: renumber sort_order via the SHARED planReorder math and
// write only the changed rows (updateType whitelists sort_order; every fetch already
// ORDERs BY it, so Review/teach/search pickers follow this order automatically).
// Re-render FIRST so no click can act on a stale row mid-await; any write failure
// re-reads from the DB so the list snaps back to server truth.
async function commitDocTypeOrder(idsInNewOrder) {
  const byId = new Map(allTypesWithFields.map(t => [t.id, t]));
  const reordered = idsInNewOrder.map(id => byId.get(id)).filter(Boolean);
  if (reordered.length !== allTypesWithFields.length) { renderDocTypesList(); return; }   // DOM/state mismatch → repaint, don't persist
  const prevSort = new Map(allTypesWithFields.map(t => [t.id, t.sort_order]));
  const writes = window.DocTypeEditor.planReorder(reordered, prevSort);
  allTypesWithFields = reordered;
  renderDocTypesList();
  for (const w of writes) {
    try { await api.updateDocumentType(w.id, { sort_order: w.sort_order }); }
    catch (e) { await refreshDocTypesList(); return; }
  }
}

async function refreshDocTypesList() {
  allTypesWithFields = await api.getAllDocTypesAll();
  renderDocTypesList();
}

function showDetailEmpty() {
  if (dtEditor) { dtEditor.destroy(); dtEditor = null; }
  document.getElementById('dt-detail').innerHTML = '';
  document.getElementById('dt-detail-empty').style.display = '';
}

function selectDocType(id) {
  selectedDocTypeId = id;
  renderDocTypesList();
  const type = allTypesWithFields.find(t => t.id === id);
  if (!type) { showDetailEmpty(); return; }
  renderDocTypeDetail(type);
}

function renderDocTypeDetail(type) {
  if (dtEditor) { dtEditor.destroy(); dtEditor = null; }
  document.getElementById('dt-detail-empty').style.display = 'none';
  const detail = document.getElementById('dt-detail');
  detail.innerHTML = `
    <div class="dt-detail-header">
      <h3>${escHtml(type.name)}</h3>
      <span class="${type.built_in ? 'badge-builtin' : 'badge-custom'}">${type.built_in ? 'built-in' : 'custom'}</span>
      <span style="flex:1"></span>
      <label class="toggle" title="Enable or disable this type for filing">
        <input type="checkbox" id="dt-enable" ${type.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span id="dt-enable-lbl" class="field-label-small">${type.enabled ? 'Enabled' : 'Disabled'}</span>
      <button class="btn" id="dt-fix-type" title="Opens Learning Repair for this type — see what it's learned and send a badly-read document back to Review. Nothing changes until you choose there." style="padding:4px 10px; font-size:12px;">Repair learning…</button>
      ${type.built_in ? '' : '<button class="btn-icon" id="dt-hide" title="Hide this type">&#215;</button>'}
    </div>
    <div id="dt-editor-host"></div>`;

  document.getElementById('dt-fix-type')?.addEventListener('click', async () => {
    const repairTab = document.querySelector('.tab[data-tab="repair"]');
    if (repairTab) repairTab.click();             // activates the Learning Repair panel + repairInit()
    await repairInit();                           // idempotent — ensure the dropdown is populated
    const sel = document.getElementById('rp-doctype');
    if (sel && type.slug) {
      sel.value = type.slug;
      document.getElementById('rp-supplier').value = '';
      await rpLoad();
    }
  });

  document.getElementById('dt-enable').addEventListener('change', async (e) => {
    const enabled = e.target.checked ? 1 : 0;
    await api.updateDocumentType(type.id, { enabled });
    document.getElementById('dt-enable-lbl').textContent = enabled ? 'Enabled' : 'Disabled';
    await refreshDocTypesList();
  });
  const hideBtn = document.getElementById('dt-hide');
  if (hideBtn) {
    hideBtn.addEventListener('click', async () => {
      if (!confirm(`Hide "${type.name}"? It will be disabled and no longer offered when filing new documents. You can switch it back on anytime. Documents already filed are unaffected.`)) return;
      await api.updateDocumentType(type.id, { enabled: 0 });
      await refreshDocTypesList();
      selectDocType(type.id);
    });
  }

  dtEditor = window.DocTypeEditor.create(
    document.getElementById('dt-editor-host'),
    { mode: 'edit', api, initial: type, onChange: refreshDocTypesList }
  );
}

// ── New type (inline friendly creator, shared with the Teach wizard) ───────────
function openNewTypeForm() {
  selectedDocTypeId = null;
  renderDocTypesList();
  if (dtEditor) { dtEditor.destroy(); dtEditor = null; }
  document.getElementById('dt-detail-empty').style.display = 'none';
  const detail = document.getElementById('dt-detail');
  detail.innerHTML = `
    <div class="dt-detail-header"><h3>New document type</h3></div>
    <div id="dt-editor-host"></div>
    <div style="margin-top:16px; display:flex; gap:8px;">
      <button class="btn primary" id="dt-create-btn" disabled>Create type</button>
      <button class="btn" id="dt-cancel-btn">Cancel</button>
    </div>`;

  dtEditor = window.DocTypeEditor.create(
    document.getElementById('dt-editor-host'),
    {
      mode: 'create',
      api,
      onValidityChange: (ready) => {
        const b = document.getElementById('dt-create-btn');
        if (b) b.disabled = !ready;
      },
    }
  );

  document.getElementById('dt-create-btn').addEventListener('click', async () => {
    const res = await dtEditor.commit();
    if (res && res.success) {
      await refreshDocTypesList();
      const newId = res.type ? res.type.id : null;
      if (newId) selectDocType(newId);
      else showDetailEmpty();
    }
  });
  document.getElementById('dt-cancel-btn').addEventListener('click', showDetailEmpty);
}

document.getElementById('btn-add-type').addEventListener('click', openNewTypeForm);

// ── Preset catalog: tick ready-made document types to add ─────────────────────
// The picker itself now lives in shared/doctype-catalog.js, because the Teach wizard needs the
// SAME one: creating a type mid-teach offered less than creating one in Settings, which is the
// gap the owner reported. Extracted rather than copied — a second copy drifts, and then the two
// surfaces disagree in a way nobody notices until a customer says so.
function openCatalogModal() {
  return window.DocTypeCatalog.open({ api, onAdded: () => refreshDocTypesList() });
}

document.getElementById('btn-catalog').addEventListener('click', openCatalogModal);

// ── "Field visibility" — per-layout field masking (migration 54). The GENERAL-PURPOSE home for the
// hide/show control, moved OUT of the advanced Template Manager (owner, 2026-07-25): pick a learned
// layout, then tick the fields it actually shows. Unticking hides a field a supplier's layout doesn't
// print, so Review stops flagging it. Structural roles (Issuer/Date/Reference) are always shown +
// locked. Each toggle persists immediately (set-template-hidden-field, unticked => hide=true). Nothing
// is deleted; other layouts are unaffected. Mirrors openCatalogModal's overlay pattern.
async function openFieldVisibilityModal() {
  let tmpls;
  try { tmpls = await api.getTemplates(); }
  catch (e) { alert('Could not load layouts: ' + (e && e.message || e)); return; }
  tmpls = Array.isArray(tmpls)
    ? tmpls.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    : [];
  const opts = tmpls.map(t =>
    `<option value="${t.id}">${escHtml(t.name)}${t.document_type_slug ? ' · ' + escHtml(t.document_type_slug) : ''}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center;';
  overlay.innerHTML = `
    <div style="width:460px; max-height:80vh; background:var(--surface); border:1px solid var(--border2);
                border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                font-family:var(--sans); color:var(--text);">
      <div style="font-size:13px; font-weight:600;">Field visibility</div>
      <div style="font-size:11px; color:var(--muted); line-height:1.6;">
        Choose which fields each layout shows. Untick a field a sender's layout doesn't print — Review
        will stop asking for it on those documents. The Document Issuer, Date and Reference are always
        shown. Nothing is deleted, and other layouts are unaffected.</div>
      ${tmpls.length
        ? `<label style="font-size:11px; color:var(--muted);">Layout
             <select id="fv-template" style="width:100%; margin-top:4px; padding:7px; border-radius:6px;
                     border:1px solid var(--border2); background:var(--surface2); color:var(--text);
                     font-family:inherit; font-size:12px;">${opts}</select>
           </label>
           <div id="fv-fields" style="overflow-y:auto; border:1px solid var(--border); border-radius:8px;
                padding:4px; flex:1; min-height:120px;"></div>`
        : `<div style="font-size:12px; color:var(--muted); padding:22px 6px; text-align:center; line-height:1.6;">
             No layouts learned yet. A layout appears here once you've confirmed a few documents from a
             sender, so Scan Finder knows what that sender's paperwork looks like.</div>`}
      <div style="display:flex;">
        <button id="fv-close" style="flex:1; padding:9px; border-radius:6px; border:1px solid var(--border2);
                background:transparent; color:var(--muted); font-family:inherit; font-size:12px; cursor:pointer;">Done</button>
      </div>
    </div>`;
  overlay.setAttribute('data-help-ignore', '1');
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#fv-close').addEventListener('click', close);

  const sel  = overlay.querySelector('#fv-template');
  const list = overlay.querySelector('#fv-fields');
  if (!sel || !list) return;   // empty state — nothing to wire

  async function renderFor(id) {
    list.innerHTML = '<div style="font-size:11px; color:var(--muted); padding:12px;">Loading…</div>';
    let detail;
    try { detail = await api.getTemplateDetail(Number(id)); } catch { detail = null; }
    const fields = (detail && detail.type_fields) || [];
    if (!fields.length) {
      list.innerHTML = '<div style="font-size:11px; color:var(--muted); padding:12px;">No fields on this layout.</div>';
      return;
    }
    list.innerHTML = '';
    for (const f of fields) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex; gap:10px; align-items:center; padding:7px 8px; border-radius:8px; cursor:'
        + (f.structural ? 'default' : 'pointer') + ';';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !f.hidden;            // TICKED = shown (allowed); unticked = hidden
      cb.disabled = !!f.structural;
      cb.title = f.structural
        ? 'The Document Issuer / Date / Reference roles are always shown'
        : 'Untick to hide this field on this layout';
      if (!f.structural) cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          const r = await api.setTemplateHiddenField(Number(id), f.key, !cb.checked);   // unticked -> hide=true
          if (!r || r.ok === false) cb.checked = !cb.checked;   // revert on refusal
          else f.hidden = !cb.checked;
        } catch { cb.checked = !cb.checked; }
        cb.disabled = false;
      });
      const txt = document.createElement('span');
      txt.style.cssText = 'font-size:12px;' + (f.structural ? ' color:var(--muted);' : '');
      txt.textContent = (f.label || f.key) + (f.structural ? '  🔒' : '');
      row.appendChild(cb);
      row.appendChild(txt);
      list.appendChild(row);
    }
  }
  sel.addEventListener('change', () => renderFor(sel.value));
  renderFor(sel.value);
}
document.getElementById('btn-field-visibility')?.addEventListener('click', openFieldVisibilityModal);

// (FIELDS TAB removed — merged into the Document Types master-detail tab above.
//  Field add/edit/delete now happens in the shared DocTypeEditor component via the
//  same add-field / update-field / delete-field IPCs.)

// ── Helper ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatWhen(when) {
  if (!when) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const d = new Date(when.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? when : d.toLocaleString();
}

// ══════════════════════════════════════════════════════════════════════════════
// USERS TAB  (admin-only — this whole panel is unreachable for non-admins,
// since open-settings-window itself is gated to hasRole('admin') in main.js;
// every action below is also re-checked server-side in auth/handler.js)
// ══════════════════════════════════════════════════════════════════════════════

const ROLE_LABELS = { admin: 'Admin', edit: 'Edit', readonly: 'Read Only' };

const AUDIT_ACTION_LABELS = {
  login_success:      'Signed in',
  login_failure:      'Failed sign-in',
  logout:             'Signed out',
  user_created:       'User created',
  user_enabled:       'User enabled',
  user_disabled:      'User disabled',
  password_reset:     'Password reset',
  password_change:    'Password changed',
  recovery_code_used: 'Recovery code used',
  role_change:        'Role changed',
};

let allUsers      = [];
let currentUserId = null;

async function loadUsers() {
  const me = await api.authGetCurrentUser();
  currentUserId = me ? me.id : null;

  const result = await api.authListUsers();
  allUsers = (result && result.users) || [];
  renderUsersList();
}

function renderUsersList() {
  const list = document.getElementById('users-list');
  list.innerHTML = '';

  for (const u of allUsers) {
    const row = document.createElement('div');
    row.className = 'user-row' + (u.is_active ? '' : ' disabled');
    const isSelf = (u.id === currentUserId);
    const lastLogin = formatWhen(u.last_login_at);

    const roleOptions = Object.entries(ROLE_LABELS)
      .map(([val, label]) => `<option value="${val}" ${u.role === val ? 'selected' : ''}>${label}</option>`)
      .join('');

    row.innerHTML = `
      <div class="user-identity">
        <div class="user-display-name">
          ${escHtml(u.display_name)}
          <span class="role-badge" data-role="${escHtml(u.role)}">${escHtml(ROLE_LABELS[u.role] || u.role)}</span>
          ${isSelf ? '<span class="you-pill">You</span>' : ''}
          ${!u.is_active ? '<span class="you-pill">Disabled</span>' : ''}
          ${u.must_change_password ? '<span class="you-pill">Must set new password</span>' : ''}
        </div>
        <div class="user-username">@${escHtml(u.username)}</div>
        <div class="user-meta">${lastLogin ? 'Last sign-in ' + escHtml(lastLogin) : 'Never signed in'}</div>
      </div>
      <div class="user-actions">
        <select class="field-select user-role-select" data-id="${u.id}"
                ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
          ${roleOptions}
        </select>
        <button class="btn user-reset" data-id="${u.id}" style="font-size:11px; padding:5px 10px;">Reset password&hellip;</button>
        <label class="toggle" title="${isSelf ? 'You cannot disable your own account' : (u.is_active ? 'Disable account' : 'Enable account')}">
          <input type="checkbox" class="user-active-toggle" data-id="${u.id}" ${u.is_active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;

    // Role change — server re-validates the "at least one active Admin" rule;
    // we just relay its verdict and snap the dropdown back on rejection.
    const roleSelect = row.querySelector('.user-role-select');
    roleSelect.addEventListener('change', async () => {
      const newRole = roleSelect.value;
      const result = await api.authSetUserRole({ userId: u.id, role: newRole });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not change that user's role.");
        roleSelect.value = u.role;
        return;
      }
      await loadUsers();
    });

    // Enable / disable — same "server is the real guard" relationship.
    const activeToggle = row.querySelector('.user-active-toggle');
    activeToggle.addEventListener('change', async () => {
      const wantActive = activeToggle.checked;
      const result = await api.authSetUserActive({ userId: u.id, isActive: wantActive });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not change that user's status.");
        activeToggle.checked = !wantActive;
        return;
      }
      await loadUsers();
    });

    // Reset password — generates a one-time temp password, shown once here
    // (mirrors the login window's "shown once" recovery-code screen).
    row.querySelector('.user-reset').addEventListener('click', async () => {
      if (!confirm(`Reset the password for "${u.display_name}"?\n\nThey will need to sign in with a temporary password and immediately choose a new one.`)) return;
      const result = await api.authAdminResetPassword({ userId: u.id });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not reset that user's password.");
        return;
      }
      showSecretDialog('Temporary password', result.tempPassword,
        `Give this to <strong>${escHtml(u.display_name)}</strong> — it is shown only once and is not stored anywhere. ` +
        `They will be asked to set their own password the next time they sign in.`);
      await loadUsers();
    });

    list.appendChild(row);
  }
}

// ── Add user ──────────────────────────────────────────────────────────────────
const addUserForm = document.getElementById('add-user-form');

document.getElementById('btn-add-user').addEventListener('click', () => {
  addUserForm.classList.add('visible');
  document.getElementById('new-user-username').focus();
});

document.getElementById('btn-cancel-user').addEventListener('click', () => {
  addUserForm.classList.remove('visible');
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-display-name').value = '';
  document.getElementById('new-user-role').value = 'edit';
});

document.getElementById('btn-save-user').addEventListener('click', async () => {
  const username    = document.getElementById('new-user-username').value.trim();
  const displayName = document.getElementById('new-user-display-name').value.trim();
  const role        = document.getElementById('new-user-role').value;

  if (!username)    { alert('Please enter a username.'); return; }
  if (!displayName) { alert('Please enter a display name.'); return; }

  const result = await api.authCreateUser({ username, displayName, role });
  if (!result || !result.success) {
    alert((result && result.error) || 'Could not create that user.');
    return;
  }

  addUserForm.classList.remove('visible');
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-display-name').value = '';
  document.getElementById('new-user-role').value = 'edit';

  await loadUsers();
  showSecretDialog('Temporary password', result.tempPassword,
    `Give this to <strong>${escHtml(displayName)}</strong> — it is shown only once and is not stored anywhere. ` +
    `They will be asked to set their own password the first time they sign in.`);
});

// ── Recent activity (audit log) ───────────────────────────────────────────────
async function loadAuditLog() {
  const entries = await api.authGetAuditLog(100);
  renderAuditLog(entries || []);
}

function renderAuditLog(entries) {
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted); font-size:11px;">No activity recorded yet.</td></tr>';
    return;
  }

  for (const entry of entries) {
    const tr = document.createElement('tr');
    const who    = entry.actor_display_name || entry.actor_username || '—';
    const action = AUDIT_ACTION_LABELS[entry.action] || entry.action;
    const target = entry.target_type
      ? `${entry.target_type}${entry.target_id ? ' #' + entry.target_id : ''}`
      : '';
    const details = [target, entry.details].filter(Boolean).join(' — ');
    tr.innerHTML = `
      <td class="audit-when">${escHtml(formatWhen(entry.created_at) || entry.created_at)}</td>
      <td>${escHtml(who)}</td>
      <td class="audit-action">${escHtml(action)}</td>
      <td style="color:var(--muted);">${escHtml(details)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── "Shown once" secret dialog (temp passwords) ──────────────────────────────
// Same overlay convention as showChangePasswordDialog in main/renderer.js
// (cssText + innerHTML — this codebase has no global .modal/.overlay CSS).
// `note` is allowed light HTML (a <strong> around the name) because it is
// built entirely from escHtml()'d pieces; `title`/`value` are escaped here.
function showSecretDialog(title, value, note) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9998;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
  `;
  overlay.innerHTML = `
    <div style="width:340px; background:var(--surface); border:1px solid var(--border2);
                border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                font-family:var(--sans); color:var(--text);">
      <div style="font-size:13px; font-weight:500;">${escHtml(title)}</div>
      <div style="font-size:11px; color:var(--muted); line-height:1.6;">${note}</div>
      <div style="font-family:var(--mono); font-size:15px; letter-spacing:.08em; text-align:center;
                  padding:14px; border-radius:8px; background:var(--bg); border:1px solid var(--accent-border);
                  color:var(--accent2); user-select:text;">${escHtml(value)}</div>
      <button id="secret-ok" style="padding:9px; border-radius:6px; border:none; background:var(--accent);
              color:#fff; font-family:inherit; font-size:12px; font-weight:500; cursor:pointer;">Done</button>
    </div>
  `;
  overlay.setAttribute('data-help-ignore', '1');   // stay usable even if help mode is on
  document.body.appendChild(overlay);
  overlay.querySelector('#secret-ok').addEventListener('click', () => overlay.remove());
}

// ── Typed-name confirmation for extreme-use destructive actions ──────────────
// Electron does not implement window.prompt(), so the "type the exact name to
// confirm" pattern is built as a custom overlay (same convention as
// showSecretDialog above). Resolves true only when the user types `requiredText`
// exactly and clicks Confirm; cancel / backdrop / Escape resolve false.
function showTypedConfirmDialog({ title, warningHtml, requiredText, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
    `;
    overlay.innerHTML = `
      <div style="width:380px; background:var(--surface); border:1px solid var(--border2);
                  border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                  font-family:var(--sans); color:var(--text);">
        <div style="font-size:13px; font-weight:500; color:var(--err);">${escHtml(title)}</div>
        <div style="font-size:11px; color:var(--muted); line-height:1.6;">${warningHtml}</div>
        <div style="font-size:11px; color:var(--muted);">Type <strong style="color:var(--text); font-family:var(--mono);">${escHtml(requiredText)}</strong> to confirm:</div>
        <input id="tc-input" type="text" spellcheck="false" autocomplete="off" style="
          padding:9px; border-radius:6px; border:1px solid var(--border2); background:var(--bg);
          color:var(--text); font-family:var(--mono); font-size:13px;">
        <div style="display:flex; gap:8px;">
          <button id="tc-cancel" style="flex:1; padding:9px; border-radius:6px; border:1px solid var(--border2);
                  background:transparent; color:var(--muted); font-family:inherit; font-size:12px; cursor:pointer;">Cancel</button>
          <button id="tc-confirm" disabled style="flex:1; padding:9px; border-radius:6px; border:none;
                  background:var(--err); color:#fff; font-family:inherit; font-size:12px; font-weight:500;
                  cursor:pointer; opacity:.45;">${escHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    overlay.setAttribute('data-help-ignore', '1');   // stay usable even if help mode is on
    document.body.appendChild(overlay);

    const input    = overlay.querySelector('#tc-input');
    const btnOk     = overlay.querySelector('#tc-confirm');
    const close     = (result) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
    const matches  = () => input.value === requiredText;
    const sync     = () => { btnOk.disabled = !matches(); btnOk.style.opacity = matches() ? '1' : '.45'; };
    const onKey     = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && matches()) close(true);
    };

    input.addEventListener('input', sync);
    overlay.querySelector('#tc-cancel').addEventListener('click', () => close(false));
    btnOk.addEventListener('click', () => { if (matches()) close(true); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    // Clicking anywhere on the dialog card (not the backdrop) puts the caret in
    // the field — a reliable fallback if auto-focus was dropped.
    overlay.addEventListener('click', (e) => { if (e.target !== overlay) input.focus(); });
    document.addEventListener('keydown', onKey);
    // Give the auto-focused input a live caret. repairModalInputFocus defers past the current
    // event turn + a layout frame (double-rAF) so Chromium commits focus to the input instead
    // of dropping it (the "can't type / no flashing cursor" same-tick-focus symptom).
    (window.repairModalInputFocus || ((el) => { requestAnimationFrame(() => { el.focus(); el.select(); }); }))(input);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// THEME TOGGLE
// ══════════════════════════════════════════════════════════════════════════════

const THEME_VALUES = ['light', 'warm', 'slate', 'dark', 'midnight', 'graphite',
                      'spring', 'summer', 'autumn', 'winter', 'festive'];
async function loadThemeSelect() {
  const theme = await api.getSetting('theme') || 'warm';
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = THEME_VALUES.includes(theme) ? theme : 'warm';
}
loadThemeSelect();

document.getElementById('theme-select')?.addEventListener('change', async (e) => {
  const theme = e.target.value;
  applyTheme(theme);                       // live in this window
  await api.setSetting('theme', theme);    // persist + broadcast theme-changed to all windows
});

// "Close button minimises to the tray" — default ON (checked unless explicitly 'false').
async function loadCloseToTrayToggle() {
  const v = await api.getSetting('close_to_tray');
  document.getElementById('close-to-tray-toggle').checked = (v !== 'false');
}
loadCloseToTrayToggle();

document.getElementById('close-to-tray-toggle').addEventListener('change', async (e) => {
  await api.setSetting('close_to_tray', e.target.checked ? 'true' : 'false');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES TAB — Admin Template Viewer / Anchor Mapping
// Phase 1: list + sample-document viewer + read-only mapping overlay
// Phase 2: draw anchor/target boxes, edit mapping settings, save/test/delete
// ══════════════════════════════════════════════════════════════════════════════

let allTemplates     = [];
let allGroups        = [];
let selectedTemplate = null;
const collapsedGroups = new Set(); // group IDs currently collapsed in the tree
let tplPageImages    = [];
let tplCurrentPage   = 0;

// Phase 2 — mapping editor / drawing state
let tplEditingFieldKey = null;   // field_key currently loaded in the editor
let tplMapMode         = null;   // null | 'anchor' | 'target' — active drawing tool
let tplDraftAnchor     = null;   // {x_norm,y_norm,w_norm,h_norm,page_number} or null
let tplDraftTarget     = null;
let tplIsDragging      = false;
let tplDragStart       = null;
let tplDragRect        = null;
// Enhance-detection (manual landmark) draw state — independent of tplMapMode.
let tplLandmarkMode    = false;  // drawing manual registration landmarks
let tplLandmarkDraft   = [];     // [{label_text,x_norm,y_norm,w_norm,h_norm,ocr_conf,page_number}]
// Select / move state — left-click on an existing box selects it; dragging moves it.
let tplSelectedBox = null;   // { fieldKey, boxType:'anchor'|'target' } | null
let tplIsMoving    = false;
let tplMoveStart   = null;   // { pt:{x,y}, origNorm } when a move drag is in progress

// Zoom / pan state — applied to #tpl-img-wrap via CSS transform, independent
// of the canvas's internal pixel buffer (tplCanvas.width/height), which always
// stays at the unscaled rendered image size. Mouse-to-canvas coordinate maths
// in the drawing handlers below converts through the live bounding-rect ratio,
// so drawing stays accurate at any zoom level.
let tplZoom       = 1;
let tplPanX       = 0;
let tplPanY       = 0;
let tplIsPanning  = false;
let tplPanStart   = null;   // {x, y, panX, panY} — client coords + pan at drag start
const TPL_ZOOM_MIN  = 1;
const TPL_ZOOM_MAX  = 4;
const TPL_ZOOM_STEP = 0.25;

const tplImg     = document.getElementById('tpl-img');
const tplImgWrap = document.getElementById('tpl-img-wrap');
const tplViewer  = document.getElementById('tpl-doc-viewer');
const tplCanvas  = document.getElementById('tpl-overlay-canvas');
const tplCtx     = tplCanvas.getContext('2d');

// ── Straighten (Template Viewer) ─────────────────────────────────────────────
// A tilted sample makes anchor/target boxes almost impossible to place: the operator either
// draws a box big enough to swallow the tilt (which then admits the neighbouring row) or clips
// the value. Review and the teach wizard both let the page be levelled first; the Template
// Manager did not (owner, 2026-07-30).
//
// THE LOAD-BEARING PART IS NOT THE PICTURE, IT IS THE FRAME. Extraction reads the RAW scan, so a
// box drawn on the straightened image is in the WRONG COORDINATE FRAME and must be rotated back
// before it is persisted — the same problem the ⊕ teach solved in 2026-07-12 with
// `AnchorLabel.deskewedNormToRaw`, whose rotation SIGN was established empirically against real
// PIL.rotate and is pinned in shared/test_anchor_label.js. This reuses that primitive rather than
// re-deriving it (a wrong sign here silently mis-seats every box drawn while straightened).
//
// Each draft box drawn while straightened is stamped with the frame it was drawn on, and the save
// REFUSES if the displayed frame has changed since (page navigated, straighten toggled, a new
// sample loaded) — the Oracle C1 fail-safe from the teach path: never persist coords whose frame
// you can no longer vouch for.
const TPL_DESKEW_FLOOR = 0.35;      // below this a page is already level — don't re-render it
let tplDeskewOn     = false;        // is the straightened render currently displayed?
let tplDeskewAngle  = 0;            // CCW-positive angle of the DISPLAYED frame (0 when raw)
let tplDeskewBusy   = false;
let tplSuppressPreviewRerun = false;   // set across a straighten image swap (see tplImg.onload)
const tplDeskewCache = {};          // page index → { image (dataURL), angle, W, H } | { angle: 0 }

// The frame a box was drawn on. `angle: 0` means the raw page, which needs no transform.
function tplCurrentFrame() {
  const c = tplDeskewCache[tplCurrentPage];
  return {
    sampleId: selectedTemplate?.sample_document?.id ?? null,
    page:  tplCurrentPage,
    angle: tplDeskewOn ? tplDeskewAngle : 0,
    W: (c && c.W) || tplImg.naturalWidth || 0,
    H: (c && c.H) || tplImg.naturalHeight || 0,
  };
}
function tplStampFrame(norm) {
  if (norm) norm._frame = tplCurrentFrame();
  return norm;
}
// Rotate a box drawn on the straightened frame back onto the raw page. Mirrors the teach
// wizard's _teachBackBox: transform the CENTRE and keep the drawn size (the box is axis-aligned
// in both frames; at the angles a scanner produces, re-fitting the size buys nothing and would
// only grow the box).
function tplBoxToRaw(norm, live) {
  if (!norm || !norm._frame || !norm._frame.angle) return norm;      // drawn raw → already raw
  const f = norm._frame;
  const frameOk = live && live.sampleId === f.sampleId && live.page === f.page
                  && live.angle === f.angle && live.W === f.W && live.H === f.H
                  && !!f.W && !!f.H;
  if (!frameOk) return null;                                          // caller refuses the save
  const A = window.AnchorLabel;
  if (!A || typeof A.deskewedNormToRaw !== 'function') return null;   // no primitive → never guess
  const cx = norm.x_norm + norm.w_norm / 2, cy = norm.y_norm + norm.h_norm / 2;
  const r = A.deskewedNormToRaw(cx, cy, f.angle, f.W, f.H);
  return { ...norm, x_norm: r.x - norm.w_norm / 2, y_norm: r.y - norm.h_norm / 2 };
}

async function toggleTplStraighten(forceOff) {
  if (tplDeskewBusy || !tplPageImages.length) return;
  const btn = document.getElementById('tpl-btn-straighten');
  const goOn = forceOff === true ? false : !tplDeskewOn;
  tplDeskewBusy = true;
  if (btn) btn.disabled = true;
  try {
    if (!goOn) {
      tplDeskewOn = false; tplDeskewAngle = 0;
      tplSuppressPreviewRerun = true;
      tplImg.src = tplPageImages[tplCurrentPage];
    } else {
      let entry = tplDeskewCache[tplCurrentPage];
      if (!entry) {
        // Render once per page and bank it — re-fetching on every toggle is a visible stall.
        const src = tplPageImages[tplCurrentPage] || '';
        const b64 = src.includes(',') ? src.split(',')[1] : src;
        let res = null;
        try { res = await api.getPageDeskew?.(b64, TPL_DESKEW_FLOOR); } catch { /* treated as level */ }
        entry = (res && res.image && res.angle)
          ? { image: 'data:image/png;base64,' + res.image, angle: res.angle,
              W: tplImg.naturalWidth, H: tplImg.naturalHeight }
          : { angle: 0 };
        tplDeskewCache[tplCurrentPage] = entry;
      }
      if (entry.angle && entry.image) {
        tplDeskewOn = true; tplDeskewAngle = entry.angle;
        tplSuppressPreviewRerun = true;
        tplImg.src = entry.image;
      } else {
        setTplStraightenMsg('This page is already straight.');
      }
    }
  } finally {
    tplDeskewBusy = false;
    if (btn) { btn.disabled = false; btn.classList.toggle('active', tplDeskewOn); }
    updateTplStraightenUI();
    redrawTplCanvas();
  }
}

function setTplStraightenMsg(text) {
  const el = document.getElementById('tpl-mapping-msg');
  if (el) { el.textContent = text; el.style.color = 'var(--muted)'; }
}

// Landmark drawing is NOT frame-aware (it has its own save path, untouched here), so it is
// unavailable while straightened rather than silently storing display-frame coords.
function updateTplStraightenUI() {
  const btn = document.getElementById('tpl-btn-straighten');
  if (btn) {
    btn.classList.toggle('active', tplDeskewOn);
    btn.textContent = tplDeskewOn ? '∞ Straightened' : '∞ Straighten';
  }
  const lm = document.getElementById('tpl-btn-enhance');
  if (lm) {
    if (!lm.dataset.titleDefault) lm.dataset.titleDefault = lm.title || '';
    lm.disabled = tplDeskewOn;
    lm.title = tplDeskewOn
      ? 'Turn Straighten off to draw landmarks — landmarks are stored against the real page angle.'
      : lm.dataset.titleDefault;
  }
  if (tplDeskewOn && tplLandmarkMode) exitDrawMode();
}

document.getElementById('tpl-btn-straighten')?.addEventListener('click', () => toggleTplStraighten());

// ── Approval-stamp placement ─────────────────────────────────────────────────
// Stored as ONE settings row, `stamp_placement` = {x, y, w} normalised with a TOP-LEFT origin —
// the same convention as every other geometry in this app. pdfStamp owns the flip to pdf-lib's
// bottom-left origin and re-validates whatever it reads, so a hand-edited or stale setting can
// never place a stamp off the page (or stop a decision being stamped).
// An UNSET placement is meaningful: it means "the built-in top-right corner", which is why Reset
// deletes the value rather than writing a corner-shaped one.
const STAMP_DEFAULT = { x: 0.62, y: 0.04, w: 0.30 };
let _stampWired = false;
let _stampPlacement = { ...STAMP_DEFAULT };
let _stampIsSet = false;

function stampPreviewPaint() {
  const box = document.getElementById('stamp-preview-box');
  const pv  = document.getElementById('stamp-preview');
  if (!box || !pv) return;
  const { x, y, w } = _stampPlacement;
  // Height is the stamp's own aspect (a headline plus a few small lines), not a stored value —
  // the real stamp sizes its block from its content, and inventing a height here would show a
  // shape the PDF never produces.
  box.style.left   = (x * 100) + '%';
  box.style.top    = (y * 100) + '%';
  box.style.width  = (w * 100) + '%';
  box.style.height = Math.min(30, w * 62) + '%';
  box.style.opacity = _stampIsSet ? '1' : '.45';
  for (const c of document.querySelectorAll('#stamp-grid .stamp-cell')) {
    c.classList.toggle('sel', Math.abs(+c.dataset.x - x) < 0.02 && Math.abs(+c.dataset.y - y) < 0.02);
  }
}
function stampSetMsg(text, tone) {
  const el = document.getElementById('stamp-msg');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = tone === 'err' ? 'var(--err)' : tone === 'ok' ? 'var(--ok)' : 'var(--muted)';
}
async function initStampPlacement() {
  const sizeEl = document.getElementById('stamp-size');
  if (!sizeEl) return;
  try {
    const raw = await api.getSetting('stamp_placement');
    const v = raw ? JSON.parse(raw) : null;
    if (v && Number(v.w) > 0) { _stampPlacement = { x: +v.x, y: +v.y, w: +v.w }; _stampIsSet = true; }
    else { _stampPlacement = { ...STAMP_DEFAULT }; _stampIsSet = false; }
  } catch { _stampPlacement = { ...STAMP_DEFAULT }; _stampIsSet = false; }
  sizeEl.value = Math.round(_stampPlacement.w * 100);
  document.getElementById('stamp-size-val').textContent = sizeEl.value + '%';
  stampSetMsg(_stampIsSet ? '' : 'Not set — using the top-right corner.');
  stampPreviewPaint();

  if (_stampWired) return;
  _stampWired = true;
  for (const c of document.querySelectorAll('#stamp-grid .stamp-cell')) {
    c.addEventListener('click', () => {
      _stampPlacement.x = +c.dataset.x; _stampPlacement.y = +c.dataset.y;
      _stampIsSet = true; stampSetMsg('Not saved yet.'); stampPreviewPaint();
    });
  }
  sizeEl.addEventListener('input', (e) => {
    const pct = Math.max(12, Math.min(60, parseInt(e.target.value, 10) || 30));
    document.getElementById('stamp-size-val').textContent = pct + '%';
    _stampPlacement.w = pct / 100;
    _stampIsSet = true; stampSetMsg('Not saved yet.'); stampPreviewPaint();
  });
  document.getElementById('stamp-save')?.addEventListener('click', async () => {
    try {
      await api.setSetting('stamp_placement', JSON.stringify({
        x: +_stampPlacement.x.toFixed(4), y: +_stampPlacement.y.toFixed(4), w: +_stampPlacement.w.toFixed(4),
      }));
      _stampIsSet = true;
      stampSetMsg('Saved — new decisions use this placement.', 'ok');
      stampPreviewPaint();
    } catch (e) { stampSetMsg(`Couldn't save: ${e.message}`, 'err'); }
  });
  document.getElementById('stamp-reset')?.addEventListener('click', async () => {
    try {
      await api.setSetting('stamp_placement', '');     // empty ⇒ pdfStamp falls back to the corner
      _stampPlacement = { ...STAMP_DEFAULT }; _stampIsSet = false;
      sizeEl.value = Math.round(STAMP_DEFAULT.w * 100);
      document.getElementById('stamp-size-val').textContent = sizeEl.value + '%';
      stampSetMsg('Back to the built-in top-right corner.', 'ok');
      stampPreviewPaint();
    } catch (e) { stampSetMsg(`Couldn't reset: ${e.message}`, 'err'); }
  });
}

async function loadTemplates() {
  try {
    [allTemplates, allGroups] = await Promise.all([
      api.getTemplates().catch(() => []),
      api.getTemplateGroups().catch(() => []),
    ]);
    allTemplates = allTemplates || [];
    allGroups    = allGroups    || [];
  } catch (e) {
    console.warn('loadTemplates failed:', e.message);
    allTemplates = [];
    allGroups    = [];
  }
  renderTemplateList();
}

// ── M3 "Suggested cleanups" (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md) ────────────────
// Read-only scan for duplicate templates + a backup-first admin-confirmed merge, plus a
// non-destructive "re-link stray documents" backfill. Wired once at init (setupTemplateCleanups).
function setupTemplateCleanups() {
  const scanBtn   = document.getElementById('btn-scan-duplicates');
  const relinkBtn = document.getElementById('btn-relink-strays');
  const msg       = document.getElementById('tpl-cleanup-msg');
  const results   = document.getElementById('tpl-cleanup-results');
  if (!scanBtn || !relinkBtn || scanBtn.dataset.wired) return;
  scanBtn.dataset.wired = '1';

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true; msg.textContent = 'Scanning…'; results.innerHTML = '';
    try { renderMergeCandidates(await api.getMergeCandidates(), results, msg); }
    catch (e) { msg.textContent = 'Scan failed: ' + e.message; }
    finally { scanBtn.disabled = false; }
  });

  relinkBtn.addEventListener('click', async () => {
    relinkBtn.disabled = true; msg.textContent = 'Checking…';
    try {
      const plan = await api.planTemplateBackfill();
      if (!plan.count) { msg.textContent = 'No stray documents to re-link.'; return; }
      if (!confirm(`Re-link ${plan.count} document(s) that have no template to their matching template?\n\n`
        + `Documents are only linked (reversible) — nothing is deleted.`)) { msg.textContent = ''; return; }
      const r = await api.applyTemplateBackfill();
      msg.textContent = `Re-linked ${r.linked} document(s).`;
      await loadTemplates();
    } catch (e) { msg.textContent = 'Re-link failed: ' + e.message; }
    finally { relinkBtn.disabled = false; }
  });
}

// Plain-English name for a member's layout verdict (avoid the raw 'insufficient'/'divergent' jargon).
function _layoutPhrase(structure) {
  if (structure === 'compatible') return 'same layout';
  if (structure === 'divergent')  return 'different layout';
  return 'layout not verified';   // insufficient
}

function renderMergeCandidates(clusters, results, msg) {
  results.innerHTML = '';
  clusters = clusters || [];
  if (!clusters.length) { msg.textContent = 'No duplicate templates found.'; return; }
  // Both 'merge' (confident) and 'merge_review' (owner-verify) offer a merge button.
  const mergeable = clusters.filter(c => c.suggestedAction === 'merge' || c.suggestedAction === 'merge_review').length;
  msg.textContent = `${clusters.length} group(s) of possible duplicates (${mergeable} you can merge).`;

  // A clickable template name that opens that template (and its sample) in the viewer, so the owner can
  // actually compare two layouts before merging (Oracle #4c — the merge_review checkpoint must be real).
  const tplLink = (id, name) => {
    const a = document.createElement('a');
    a.href = '#'; a.textContent = name; a.style.cssText = 'color:var(--accent); text-decoration:underline; cursor:pointer;';
    a.title = 'Open this layout to view its sample';
    a.addEventListener('click', (e) => { e.preventDefault(); try { selectTemplate(id); } catch {} });
    return a;
  };

  for (const c of clusters) {
    const box = document.createElement('div');
    box.className = 'section';
    box.style.cssText = 'padding:10px; margin-top:8px;';
    const canon = c.canonical;
    const head = document.createElement('div');
    head.append(document.createTextNode('Keep: '));
    const strong = document.createElement('strong'); strong.appendChild(tplLink(canon.id, canon.name)); head.appendChild(strong);
    const meta = document.createElement('span');
    meta.className = 'field-key';
    meta.textContent = ` (${c.slug} · ${canon.liveConfirmed} confirmed)`;
    head.appendChild(meta);
    box.appendChild(head);

    const memberDiv = document.createElement('div');
    memberDiv.className = 'section-desc';
    memberDiv.style.margin = '4px 0';
    memberDiv.append(document.createTextNode(`Duplicate${c.members.length === 1 ? '' : 's'}: `));
    c.members.forEach((m, i) => {
      if (i) memberDiv.append(document.createTextNode(', '));
      memberDiv.appendChild(tplLink(m.id, m.name));
      const info = document.createElement('span');
      info.className = 'field-key';
      info.textContent = ` (${m.liveConfirmed}× · ${Math.round(m.jaccard * 100)}% branding · ${_layoutPhrase(m.structure)})`;
      memberDiv.appendChild(info);
    });
    box.appendChild(memberDiv);

    const action = c.suggestedAction;
    if (action === 'merge' || action === 'merge_review') {
      // merge_review = same supplier + type, near-identical branding, but the layout could NOT be verified
      // automatically (independent teaches rarely reuse the same anchor words). It is NOT a claim they
      // differ — but the owner must eyeball, because branding sameness never proves layout sameness.
      if (action === 'merge_review') {
        const hint = document.createElement('div');
        hint.className = 'section-desc';
        hint.style.cssText = 'margin:0 0 6px;';
        hint.textContent = 'Same sender and type with near-identical branding, but the field layout couldn\'t be '
          + 'auto-verified. Open a sample of each (click a name above) and merge only if the fields sit in the '
          + 'same places.';
        box.appendChild(hint);
      }
      const btn = document.createElement('button');
      btn.className = 'btn danger';
      btn.textContent = `Merge ${c.members.length} into "${canon.name}"`;
      btn.addEventListener('click', async () => {
        const geo = action === 'merge_review'
          ? `\n\nThese may be different LAYOUTS of the same supplier — merge only if you've checked the fields sit in the same places.`
          : '';
        if (!confirm(`Merge ${c.members.length} duplicate(s) INTO "${canon.name}" and DELETE them?${geo}\n\n`
          + `A database backup is taken first. "${canon.name}" gains all their documents plus any field `
          + `mappings / landmarks / sample it lacks. This is NOT reversible (the backup is your safety net).`)) return;
        btn.disabled = true; btn.textContent = 'Backing up + merging…';
        try {
          const r = await api.mergeTemplateCluster(canon.id, c.members.map(m => m.id));
          if (r && r.ok) { msg.textContent = `Merged ${r.merged} into "${canon.name}".`; box.remove(); }
          else { msg.textContent = 'Merge failed: ' + ((r && (r.error || r.reason)) || 'unknown'); btn.disabled = false; btn.textContent = `Merge ${c.members.length} into "${canon.name}"`; }
        } catch (e) { msg.textContent = 'Merge failed: ' + e.message; btn.disabled = false; btn.textContent = `Merge ${c.members.length} into "${canon.name}"`; }
        await loadTemplates();
      });
      box.appendChild(btn);
    } else if (action === 'group_or_review') {
      // Now ONLY genuinely-different geometry (a divergent landmark OR field-zone signal).
      const note = document.createElement('div');
      note.className = 'section-desc';
      note.style.cssText = 'color:var(--warn); margin:0;';
      note.textContent = 'These look like different layouts of the same supplier (their field positions differ), '
        + 'so an automatic merge could break extraction. Merge manually in Learning Recovery only if they really are duplicates.';
      box.appendChild(note);
    } else {
      // review — branding overlaps but not strongly enough to suggest a merge.
      const note = document.createElement('div');
      note.className = 'section-desc';
      note.style.cssText = 'margin:0;';
      note.textContent = 'Branding partly overlaps but not strongly enough to suggest a merge. Compare them and '
        + 'merge manually in Learning Recovery if they are the same template.';
      box.appendChild(note);
    }
    results.appendChild(box);
  }
}

function makeTplRow(t, isChild) {
  const mappingCount = (t.field_mappings || []).filter(m => m.enabled).length;
  const row = document.createElement('div');
  row.className = 'tpl-row' +
    (isChild ? ' tpl-child' : '') +
    (selectedTemplate && selectedTemplate.id === t.id ? ' active' : '');
  row.dataset.id = t.id;
  // Per-template (not per-group) scan-friendly indicator — mirrors the
  // detail-panel badge in renderOcrAutoStatus, so siblings in the same group
  // can be told apart at a glance without clicking into each one.
  const ocrAutoIcon = t.ocr_auto_enabled
    ? '<span class="tpl-row-ocr-icon" title="OCR auto-processing enabled">&#9889;</span>'
    : '';
  row.innerHTML = `
    <span class="tpl-row-name">${escHtml(t.name)}${ocrAutoIcon}</span>
    <span class="tpl-row-meta">${escHtml(t.document_type_slug || '—')} · confirmed ${t.confirmed_count}× · ${mappingCount} mapping${mappingCount === 1 ? '' : 's'}</span>
  `;
  row.addEventListener('click', () => selectTemplate(t.id));
  return row;
}

function renderTemplateList() {
  const list = document.getElementById('tpl-list');
  list.innerHTML = '';
  if (!allTemplates.length) {
    list.innerHTML = '<p class="section-desc">No templates learned yet — confirm a few documents to build the first one.</p>';
    return;
  }

  // Build group map from allGroups; assign templates to their group
  const groupMap = new Map();
  for (const g of allGroups) groupMap.set(g.id, { group: g, templates: [] });

  const ungrouped = [];
  for (const t of allTemplates) {
    if (t.group_id && groupMap.has(t.group_id)) {
      groupMap.get(t.group_id).templates.push(t);
    } else {
      ungrouped.push(t);
    }
  }

  // Render populated group nodes (alphabetical by group name)
  const populatedGroups = [...groupMap.values()]
    .filter(g => g.templates.length > 0)
    .sort((a, b) => a.group.name.localeCompare(b.group.name));

  for (const { group, templates } of populatedGroups) {
    const isCollapsed = collapsedGroups.has(group.id);
    const count = templates.length;

    const node = document.createElement('div');
    node.className = 'tpl-group-node' + (isCollapsed ? ' collapsed' : '');
    node.dataset.groupId = group.id;

    const hdr = document.createElement('div');
    hdr.className = 'tpl-group-hdr';
    hdr.innerHTML = `
      <span class="tpl-group-arrow">&#9660;</span>
      <span class="tpl-group-name">${escHtml(group.name)}</span>
      <span class="tpl-group-badge">${count} variant${count === 1 ? '' : 's'}</span>
    `;
    hdr.addEventListener('click', () => {
      if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id);
      else collapsedGroups.add(group.id);
      node.classList.toggle('collapsed');
    });
    node.appendChild(hdr);

    const children = document.createElement('div');
    children.className = 'tpl-group-children';
    for (const t of templates) children.appendChild(makeTplRow(t, true));
    node.appendChild(children);
    list.appendChild(node);
  }

  // Render ungrouped templates as flat top-level rows
  for (const t of ungrouped) list.appendChild(makeTplRow(t, false));
}

// ── Create template ───────────────────────────────────────────────────────────
// Mirrors the existing add-type-form pattern (toggle .visible, validate name,
// reload list). Doc-type dropdown reuses allTypesWithFields (loaded by
// loadDocTypes for the mapping-field selector) — no second source of truth —
// filtered to enabled types only, same set an admin can otherwise assign.
const newTemplateForm = document.getElementById('new-template-form');

document.getElementById('btn-new-template').addEventListener('click', async () => {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (for new template) failed:', e.message); }
  }
  const select = document.getElementById('new-template-doctype');
  select.innerHTML = '';
  for (const dt of allTypesWithFields.filter(t => t.enabled)) {
    const opt = document.createElement('option');
    opt.value = dt.slug;
    opt.textContent = dt.name;
    select.appendChild(opt);
  }
  newTemplateForm.classList.add('visible');
  document.getElementById('new-template-name').focus();
});

document.getElementById('btn-cancel-template').addEventListener('click', () => {
  newTemplateForm.classList.remove('visible');
  document.getElementById('new-template-name').value = '';
});

document.getElementById('btn-save-template').addEventListener('click', async () => {
  const name = document.getElementById('new-template-name').value.trim();
  if (!name) { alert('Please enter a template name.'); return; }
  const documentTypeSlug = document.getElementById('new-template-doctype').value || null;
  try {
    const created = await api.createTemplate({ name, document_type_slug: documentTypeSlug });
    newTemplateForm.classList.remove('visible');
    document.getElementById('new-template-name').value = '';
    await loadTemplates();
    if (created && created.id) await selectTemplate(created.id);
  } catch (e) {
    alert('Could not create template: ' + e.message);
  }
});

// ── Rename template ───────────────────────────────────────────────────────────
// Cosmetic/admin-facing metadata only — template_matcher.py identifies
// templates solely by logo_phash and keyword_fingerprint (never name/slug),
// and slug (the functional/derived identifier used for the debug-export
// filename) is left untouched by templates.rename, so editing this field
// cannot affect matching, identification, or existing joins.
const tplNameInput = document.getElementById('tpl-name-input');
const tplBtnRename = document.getElementById('tpl-btn-rename');

tplNameInput.addEventListener('input', () => {
  const trimmed = tplNameInput.value.trim();
  tplBtnRename.disabled = !selectedTemplate || !trimmed || trimmed === selectedTemplate.name;
});

tplBtnRename.addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const name = tplNameInput.value.trim();
  const msg  = document.getElementById('tpl-name-msg');
  if (!name || name === selectedTemplate.name) return;
  try {
    const updated = await api.renameTemplate(selectedTemplate.id, name);
    if (!updated) return;
    selectedTemplate = updated;
    const idx = allTemplates.findIndex(t => t.id === updated.id);
    if (idx !== -1) allTemplates[idx] = updated;
    renderTemplateList();
    tplBtnRename.disabled = true;
    msg.textContent = 'Renamed.';
    msg.style.color = 'var(--ok)';
  } catch (e) {
    msg.textContent = 'Rename failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// ── Delete template ───────────────────────────────────────────────────────────
// Scoped to this template's own record + its own field/mapping rows (cascade
// on template_id — see templates.remove); confirmed documents that reference
// it are merely unlinked, never touched otherwise. Does not affect other
// templates, document types, fields, learned anchors, supplier hints, logo
// fingerprints, or settings.
document.getElementById('tpl-btn-delete-template').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  if (!confirm(`Delete the template "${selectedTemplate.name}"? Its field mappings and selector anchors will be removed too. Confirmed documents that used it stay exactly as they are. This cannot be undone.`)) return;
  try {
    await api.deleteTemplate(selectedTemplate.id);
    const deletedId = selectedTemplate.id;
    selectedTemplate = null;
    allTemplates = allTemplates.filter(t => t.id !== deletedId);
    document.getElementById('tpl-detail').style.display = 'none';
    document.getElementById('tpl-empty').style.display  = '';
    renderTemplateList();
  } catch (e) {
    alert('Could not delete template: ' + e.message);
  }
});

// ── Template groups ───────────────────────────────────────────────────────────

async function renderGroupSection(detail) {
  try { allGroups = await api.getTemplateGroups() || []; } catch { allGroups = []; }
  const sel = document.getElementById('tpl-group-select');
  sel.innerHTML = '<option value="">— No group —</option>';
  for (const g of allGroups) {
    const opt = document.createElement('option');
    opt.value       = g.id;
    opt.textContent = g.name;
    if (detail.group_id === g.id) opt.selected = true;
    sel.appendChild(opt);
  }
  await renderSiblings(detail);
}

async function renderSiblings(detail) {
  const siblingsDiv = document.getElementById('tpl-siblings');
  const listDiv     = document.getElementById('tpl-siblings-list');
  if (!detail.group_id) { siblingsDiv.style.display = 'none'; return; }
  let siblings = [];
  try { siblings = await api.getTemplateSiblings(detail.id) || []; } catch {}
  if (!siblings.length) { siblingsDiv.style.display = 'none'; return; }
  siblingsDiv.style.display = '';
  listDiv.innerHTML = '';
  for (const s of siblings) {
    const el = document.createElement('span');
    el.className   = 'tpl-row-meta';
    el.style.cssText = 'cursor:pointer; color:var(--accent2); padding:1px 0; display:block;';
    el.textContent = `${s.name} (${s.document_type_slug || '—'})`;
    el.title       = 'Open this template';
    el.addEventListener('click', () => selectTemplate(s.id));
    listDiv.appendChild(el);
  }
}

document.getElementById('tpl-group-select').addEventListener('change', async (e) => {
  if (!selectedTemplate) return;
  const groupId = parseInt(e.target.value) || null;
  try {
    const updated = await api.setTemplateGroup(selectedTemplate.id, groupId);
    if (!updated) return;
    selectedTemplate = updated;
    const idx = allTemplates.findIndex(t => t.id === updated.id);
    if (idx !== -1) allTemplates[idx] = updated;
    renderTemplateList();
    await renderSiblings(updated);
  } catch (err) { console.warn('setTemplateGroup failed:', err.message); }
});

const tplNewGroupRow   = document.getElementById('tpl-new-group-row');
const tplNewGroupInput = document.getElementById('tpl-new-group-input');

document.getElementById('tpl-btn-new-group').addEventListener('click', () => {
  tplNewGroupRow.style.display = 'flex';
  tplNewGroupInput.value = '';
  tplNewGroupInput.focus();
});

document.getElementById('tpl-btn-cancel-group').addEventListener('click', () => {
  tplNewGroupRow.style.display = 'none';
  tplNewGroupInput.value = '';
});

async function saveNewGroup() {
  const name = tplNewGroupInput.value.trim();
  if (!name) { tplNewGroupInput.focus(); return; }
  try {
    allGroups = await api.createTemplateGroup(name) || [];
    tplNewGroupRow.style.display = 'none';
    tplNewGroupInput.value = '';
    await renderGroupSection(selectedTemplate);
  } catch (err) {
    console.error('createTemplateGroup failed:', err);
    alert('Could not create group: ' + err.message);
  }
}

document.getElementById('tpl-btn-save-group').addEventListener('click', saveNewGroup);
tplNewGroupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  saveNewGroup();
  if (e.key === 'Escape') { tplNewGroupRow.style.display = 'none'; tplNewGroupInput.value = ''; }
});

async function selectTemplate(id) {
  if (tplLandmarkMode) exitEnhanceMode();   // leave Enhance-detection before switching templates
  document.querySelectorAll('.tpl-row').forEach(r => r.classList.toggle('active', parseInt(r.dataset.id) === id));
  // If the selected row is inside a collapsed group node, expand it
  const activeRow = document.querySelector('.tpl-row.active');
  const parentNode = activeRow?.closest('.tpl-group-node');
  if (parentNode?.classList.contains('collapsed')) {
    collapsedGroups.delete(parseInt(parentNode.dataset.groupId));
    parentNode.classList.remove('collapsed');
  }
  document.getElementById('tpl-empty').style.display  = 'none';
  document.getElementById('tpl-detail').style.display = '';

  let detail = null;
  try {
    detail = await api.getTemplateDetail(id);
  } catch (e) {
    console.warn('getTemplateDetail failed:', e.message);
  }
  if (!detail) return;
  selectedTemplate = detail;

  const nameInput = document.getElementById('tpl-name-input');
  nameInput.value = detail.name;
  document.getElementById('tpl-btn-rename').disabled = true;
  document.getElementById('tpl-name-msg').textContent = '';
  document.getElementById('tpl-detail-meta').textContent =
    `${detail.document_type_slug || 'unknown type'} · confirmed ${detail.confirmed_count} time${detail.confirmed_count === 1 ? '' : 's'} · updated ${formatWhen(detail.updated_at) || '—'}`;
  renderDetectionMethod(detail);
  renderOcrAutoStatus(detail);

  await Promise.all([
    loadSampleCandidates(detail),
    renderGroupSection(detail),
  ]);
  renderMappingsTable(detail);
  renderSelectorAnchorsTable(detail);
  await loadSamplePages(detail);
  await populateMapFieldSelect(detail);
  await renderFixedFieldsTable(detail);
}

function renderDetectionMethod(detail) {
  const el = document.getElementById('tpl-detection-method');
  if (!el) return;
  el.innerHTML = '';

  const hasLogo  = !!detail.logo_phash;
  const hasKw    = Array.isArray(detail.keyword_fingerprint) && detail.keyword_fingerprint.length > 0;
  const mappingN = (detail.field_mappings || []).filter(m => m.enabled).length;

  let label, cls;
  if (hasLogo && hasKw)  { label = 'Logo & keyword fingerprint'; cls = 'ok'; }
  else if (hasLogo)      { label = 'Logo fingerprint';           cls = 'info'; }
  else if (hasKw)        { label = 'Keyword fingerprint';        cls = 'info'; }
  else                   { label = 'Not yet learned';            cls = 'warn'; }

  const pill = (text, c) => {
    const s = document.createElement('span');
    s.className   = `tpl-method-pill ${c}`;
    s.textContent = text;
    return s;
  };
  el.appendChild(pill(label, cls));
  if (mappingN > 0) el.appendChild(pill(`+ ${mappingN} admin mapping${mappingN === 1 ? '' : 's'}`, 'info'));
}

// OCR auto-processing rule indicator — shown only once a rule exists for this
// template (created via an OCR-Preview-active reprocess, see
// processing/handler.js reprocess-document / templates.setOcrAutoParams).
// The toggle lets an admin disable a rule that turns out to be harmful for
// this template, without affecting any other template's rule.
function renderOcrAutoStatus(detail) {
  const row    = document.getElementById('tpl-ocr-auto-row');
  const desc   = document.getElementById('tpl-ocr-auto-desc');
  const pill   = document.getElementById('tpl-ocr-auto-pill');
  const toggle = document.getElementById('tpl-ocr-auto-toggle');
  if (!row || !toggle) return;

  const hasRule = !!(detail.ocr_auto_params);
  // The titled "OCR auto-processing" section in the Advanced area only appears
  // once a rule exists for this template (matches the original behaviour of
  // showing nothing when there is no rule — now with a section label when there is).
  const section = document.getElementById('tpl-ocr-auto-section');
  if (section) section.style.display = hasRule ? 'block' : 'none';
  row.style.display  = hasRule ? 'flex' : 'none';
  desc.style.display = hasRule ? 'block' : 'none';
  if (!hasRule) return;

  toggle.checked = !!detail.ocr_auto_enabled;
  pill.classList.toggle('ok', !!detail.ocr_auto_enabled);
  pill.classList.toggle('warn', !detail.ocr_auto_enabled);
  pill.textContent = detail.ocr_auto_enabled
    ? 'OCR auto-processing active'
    : 'OCR auto-processing disabled';

  toggle.onchange = async () => {
    toggle.disabled = true;
    try {
      const updated = await api.setTemplateOcrAuto(detail.id, toggle.checked);
      if (updated) {
        selectedTemplate = updated;
        renderOcrAutoStatus(updated);
      }
    } catch (err) {
      console.error('setTemplateOcrAuto failed:', err);
      toggle.checked = !toggle.checked; // revert on failure
    } finally {
      toggle.disabled = false;
    }
  };
}

async function loadSampleCandidates(detail) {
  const select = document.getElementById('tpl-sample-select');
  select.innerHTML = '';

  let candidates = [];
  try {
    candidates = await api.getTemplateSampleCandidates(detail.id) || [];
  } catch (e) {
    console.warn('getTemplateSampleCandidates failed:', e.message);
  }

  // get-template-sample-candidates only returns confirmed documents already
  // linked to this template — an imported sample (status='template_sample',
  // attached via "Import Sample File…" before any document has ever matched)
  // won't be in that list. Prepend it so the dropdown still shows it as
  // selected instead of looking unset.
  const pinned = detail.sample_document;
  if (pinned && !candidates.some(c => c.id === pinned.id)) {
    candidates = [pinned, ...candidates];
  }

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = candidates.length ? '— Select a sample —' : 'No confirmed documents linked yet';
  select.appendChild(noneOpt);

  for (const c of candidates) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = [c.supplier_name, c.reference_number, c.doc_date].filter(Boolean).join(' · ') || c.original_filename;
    if (c.status === 'template_sample') opt.textContent += ' (imported sample)';
    if (detail.sample_document_id === c.id) opt.selected = true;
    select.appendChild(opt);
  }

  select.onchange = async () => {
    const docId = select.value ? parseInt(select.value, 10) : null;
    try {
      const updated = await api.setTemplateSample(detail.id, docId);
      if (!updated) return;
      selectedTemplate = updated;
      const idx = allTemplates.findIndex(t => t.id === updated.id);
      if (idx !== -1) allTemplates[idx] = updated;
      await loadSamplePages(updated);
    } catch (e) {
      console.warn('setTemplateSample failed:', e.message);
    }
  };
}

// New templates start with no confirmed documents — get-template-sample-
// candidates is necessarily empty, so there is nothing to pick from the
// dropdown above. This lets an admin attach an arbitrary file directly: it's
// referenced in place (no copy), registered as a minimal 'template_sample'
// document row (invisible to review/search/counts — see templates/handler.js),
// pinned as the sample, and immediately re-rendered through the same
// loadSamplePages/getDocumentPages preview path every other sample uses.
document.getElementById('tpl-btn-import-sample').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const msg = document.getElementById('tpl-sample-msg');
  msg.textContent = '';
  msg.style.color = '';

  let filePath = null;
  try {
    filePath = await api.pickTemplateSampleFile();
  } catch (e) {
    console.warn('pickTemplateSampleFile failed:', e.message);
    return;
  }
  if (!filePath) return;

  try {
    const res = await api.importTemplateSampleFile(selectedTemplate.id, filePath);
    if (!res || !res.success) {
      msg.textContent = (res && res.error) || 'Could not import that file.';
      msg.style.color = 'var(--err)';
      return;
    }
    selectedTemplate = res.template;
    const idx = allTemplates.findIndex(t => t.id === res.template.id);
    if (idx !== -1) allTemplates[idx] = res.template;
    await loadSampleCandidates(selectedTemplate);
    await loadSamplePages(selectedTemplate);
    msg.textContent = 'Sample file attached.';
  } catch (e) {
    console.warn('importTemplateSampleFile failed:', e.message);
    msg.textContent = 'Could not import that file.';
    msg.style.color = 'var(--err)';
  }
});

// Recompute registration landmarks from the CURRENT sample (no re-pin) — recovery
// for a template with no/poor landmarks so drifted scans register correctly.
document.getElementById('tpl-btn-regen-landmarks').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const msg = document.getElementById('tpl-sample-msg');
  msg.textContent = 'Regenerating landmarks…';
  msg.style.color = 'var(--muted)';
  try {
    const res = await api.regenerateTemplateLandmarks(selectedTemplate.id);
    if (res && res.success) {
      msg.textContent = `Registration landmarks regenerated (${res.count}).`;
      msg.style.color = res.count >= 2 ? 'var(--ok)' : 'var(--warn)';
    } else {
      msg.textContent = `Could not regenerate landmarks${res && res.reason ? ' — ' + res.reason : ''}. Try Import Sample… with a clean copy.`;
      msg.style.color = 'var(--err)';
    }
  } catch (e) {
    console.warn('regenerateTemplateLandmarks failed:', e.message);
    msg.textContent = 'Could not regenerate landmarks.';
    msg.style.color = 'var(--err)';
  }
});

// Recompute the keyword fingerprint from the template's documents (force) — recovery
// for a born-digital template that was born with an empty/unreliable fingerprint.
document.getElementById('tpl-btn-regen-fingerprint').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const msg = document.getElementById('tpl-sample-msg');
  msg.textContent = 'Regenerating fingerprint…';
  msg.style.color = 'var(--muted)';
  try {
    const res = await api.regenerateTemplateFingerprint(selectedTemplate.id);
    if (res && res.success) {
      msg.textContent = `Keyword fingerprint regenerated (${res.count} word${res.count === 1 ? '' : 's'} from ${res.docs} doc${res.docs === 1 ? '' : 's'}).`;
      msg.style.color = 'var(--ok)';
    } else {
      msg.textContent = `Could not regenerate fingerprint${res && res.reason ? ' — ' + res.reason : ''}.`;
      msg.style.color = 'var(--err)';
    }
  } catch (e) {
    console.warn('regenerateTemplateFingerprint failed:', e.message);
    msg.textContent = 'Could not regenerate fingerprint.';
    msg.style.color = 'var(--err)';
  }
});

// ── Enhance detection: manual registration landmarks ─────────────────────────
// Let the admin draw up to 5 STABLE landmarks (logo / title / fixed field labels)
// instead of relying on auto-derivation, which can latch onto document-variable
// text. Reuses the canvas draw gesture + the ocr-region recipe; saved source='manual'
// and protected from auto-regeneration. Global per-template — no per-document logic.
function landmarkMsg(text, kind) {
  const m = document.getElementById('tpl-landmark-msg');
  if (!m) return;
  m.textContent = text || '';
  m.style.color = kind === 'ok' ? 'var(--ok)' : kind === 'warn' ? 'var(--warn)'
                : kind === 'err' ? 'var(--err)' : 'var(--muted)';
}

function renderLandmarkList() {
  const list = document.getElementById('tpl-landmark-list');
  if (list) {
    list.innerHTML = '';
    tplLandmarkDraft.forEach((l, i) => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex; align-items:center; gap:7px; background:var(--surface2); '
        + 'border:1px solid var(--border2); border-radius:999px; padding:4px 11px; font-size:12px;';
      chip.innerHTML = `<span>${escHtml(l.label_text)}</span>`
        + `<span data-i="${i}" title="Remove" style="cursor:pointer; color:var(--muted); font-weight:700;">&#10005;</span>`;
      chip.querySelector('[data-i]').addEventListener('click', () => {
        tplLandmarkDraft.splice(i, 1); renderLandmarkList(); redrawTplCanvas();
      });
      list.appendChild(chip);
    });
  }
  const c = document.getElementById('tpl-landmark-count');
  if (c) c.textContent = `${tplLandmarkDraft.length} / 5 drawn`;
  const save = document.getElementById('tpl-btn-landmark-save');
  if (save) save.disabled = tplLandmarkDraft.length === 0;
}

function drawLandmarkDraft() {
  const w = tplCanvas.width, h = tplCanvas.height;
  const AMBER = '#e0a32e';
  for (const l of tplLandmarkDraft) {
    if ((l.page_number || 0) !== tplCurrentPage) continue;
    drawNormBox(l.x_norm, l.y_norm, l.w_norm, l.h_norm, w, h, AMBER, l.label_text, true);
  }
  if (tplDragRect) {
    const dx = Math.round(tplDragRect.x), dy = Math.round(tplDragRect.y);
    const dw = Math.round(tplDragRect.w), dh = Math.round(tplDragRect.h);
    tplCtx.lineWidth = 1; tplCtx.strokeStyle = AMBER; tplCtx.setLineDash([5, 4]);
    tplCtx.strokeRect(dx + 0.5, dy + 0.5, dw, dh); tplCtx.setLineDash([]);
    tplCtx.fillStyle = AMBER + '20'; tplCtx.fillRect(dx, dy, dw, dh);
  }
}

// OCR the drawn box (same crop->base64->ocr-region round trip the anchor auto-label
// uses) and add it as a landmark. Empty reads are rejected — a landmark needs text.
async function addLandmarkFromRect(rect, norm) {
  if (tplLandmarkDraft.length >= 5) { landmarkMsg('Up to 5 landmarks — remove one first.', 'warn'); redrawTplCanvas(); return; }
  landmarkMsg('Reading…', 'muted');
  let text = '';
  try {
    const scaleX = tplImg.naturalWidth  / tplImg.offsetWidth;
    const scaleY = tplImg.naturalHeight / tplImg.offsetHeight;
    const crop = document.createElement('canvas');
    crop.width  = Math.max(1, Math.round(rect.w * scaleX));
    crop.height = Math.max(1, Math.round(rect.h * scaleY));
    crop.getContext('2d').drawImage(
      tplImg, Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
      crop.width, crop.height, 0, 0, crop.width, crop.height);
    text = (await api.ocrRegion(crop.toDataURL('image/png').split(',')[1]) || '').trim();
  } catch (e) { console.warn('landmark OCR failed:', e.message); }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) { landmarkMsg("Couldn't read text there — draw a tighter box around printed words.", 'warn'); redrawTplCanvas(); return; }
  tplLandmarkDraft.push({
    label_text: text,
    x_norm: norm.x_norm, y_norm: norm.y_norm, w_norm: norm.w_norm, h_norm: norm.h_norm,
    ocr_conf: 95, page_number: tplCurrentPage,   // admin-asserted landmark (high trust)
  });
  landmarkMsg(`Added "${text}".`, 'ok');
  renderLandmarkList();
  redrawTplCanvas();
}

async function enterEnhanceMode() {
  if (!selectedTemplate) return;
  if (!tplPageImages.length) {
    const sm = document.getElementById('tpl-sample-msg');
    if (sm) { sm.textContent = 'Attach a sample document first (Import Sample…).'; sm.style.color = 'var(--warn)'; }
    return;
  }
  tplPreviewMode = false;                 // mutually exclusive with the registration preview
  const pcb = document.getElementById('tpl-preview-registration'); if (pcb) pcb.checked = false;
  const pstat = document.getElementById('tpl-preview-status'); if (pstat) pstat.textContent = '';
  exitDrawMode();                         // clear any mapping-draw arming
  let existing = [];
  try { existing = await api.getTemplateLandmarks(selectedTemplate.id) || []; } catch {}
  tplLandmarkDraft = existing.slice(0, 5).map(l => ({
    label_text: l.label_text,
    x_norm: l.x_norm, y_norm: l.y_norm, w_norm: l.w_norm, h_norm: l.h_norm,
    ocr_conf: l.ocr_conf == null ? null : l.ocr_conf, page_number: l.page_number || 0,
  }));
  tplLandmarkMode = true;
  tplCanvas.classList.add('drawing');
  document.getElementById('tpl-landmark-panel').style.display = '';
  document.getElementById('tpl-btn-enhance').classList.add('primary');
  landmarkMsg(existing.length ? 'Editing current landmarks — draw to add, ✕ to remove.'
                              : 'Draw a box around each stable landmark.', 'muted');
  renderLandmarkList();
  redrawTplCanvas();
}

function exitEnhanceMode() {
  tplLandmarkMode = false;
  tplIsDragging   = false;
  tplDragRect     = null;
  tplCanvas.classList.remove('drawing');
  const panel = document.getElementById('tpl-landmark-panel'); if (panel) panel.style.display = 'none';
  const btn = document.getElementById('tpl-btn-enhance'); if (btn) btn.classList.remove('primary');
  redrawTplCanvas();
}

document.getElementById('tpl-btn-enhance').addEventListener('click', () => {
  if (tplLandmarkMode) exitEnhanceMode(); else enterEnhanceMode();
});

document.getElementById('tpl-btn-landmark-cancel').addEventListener('click', exitEnhanceMode);

document.getElementById('tpl-btn-landmark-save').addEventListener('click', async () => {
  if (!selectedTemplate || !tplLandmarkDraft.length) return;
  landmarkMsg('Saving…', 'muted');
  try {
    const res = await api.setTemplateLandmarks(selectedTemplate.id, tplLandmarkDraft);
    if (res && res.success) {
      const n = res.count;
      await selectTemplate(selectedTemplate.id);
      exitEnhanceMode();
      const sm = document.getElementById('tpl-sample-msg');
      if (sm) {
        sm.textContent = `Saved ${n} manual landmark${n === 1 ? '' : 's'} — registration will use these (protected from auto-regeneration).`;
        sm.style.color = n >= 2 ? 'var(--ok)' : 'var(--warn)';
      }
    } else { landmarkMsg('Could not save landmarks.', 'err'); }
  } catch (e) { landmarkMsg('Error: ' + e.message, 'err'); }
});

document.getElementById('tpl-btn-landmark-auto').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  if (!confirm('Discard manual landmarks and let Scan Finder detect them automatically from the sample?')) return;
  landmarkMsg('Reverting to automatic…', 'muted');
  try {
    const res = await api.clearTemplateLandmarks(selectedTemplate.id);
    await selectTemplate(selectedTemplate.id);
    exitEnhanceMode();
    const sm = document.getElementById('tpl-sample-msg');
    if (sm) { sm.textContent = `Reverted to automatic landmarks${res && res.count ? ` (${res.count})` : ''}.`; sm.style.color = 'var(--muted)'; }
  } catch (e) { landmarkMsg('Error: ' + e.message, 'err'); }
});

// Mirrors fileArgs() in search/renderer.js — confirmed documents resolve their
// preview path from stored_path/stored_filename, everything else from
// folder_path/original_filename. Sample documents pinned here are always
// confirmed (see get-template-sample-candidates), but this keeps the helper
// correct even if that constraint loosens later.
function tplFileArgs(doc) {
  if (doc.status === 'confirmed' && doc.stored_path && doc.stored_filename) {
    const lastSep = Math.max(doc.stored_path.lastIndexOf('\\'), doc.stored_path.lastIndexOf('/'));
    return { folderPath: doc.stored_path.substring(0, lastSep), filename: doc.stored_filename };
  }
  return { folderPath: doc.folder_path, filename: doc.original_filename };
}

async function loadSamplePages(detail) {
  tplPageImages  = [];
  tplCurrentPage = 0;
  // Straightened renders belong to the sample that produced them — a new sample invalidates
  // every cached angle (and the frame stamped on any half-drawn box).
  for (const k of Object.keys(tplDeskewCache)) delete tplDeskewCache[k];
  tplDeskewOn = false; tplDeskewAngle = 0;

  const sample = detail.sample_document;
  if (sample) {
    const { folderPath, filename } = tplFileArgs(sample);
    if (folderPath && filename) {
      try {
        tplPageImages = await api.getDocumentPages(sample.id, folderPath, filename) || [];
      } catch (e) {
        console.warn('getDocumentPages (template sample) failed:', e.message);
      }
    }
  }
  renderTplPage();
}

// Show/hide the "Map a Field" editor body by MODE (anchor vs fixed value) and, in
// anchor mode, gate the draw controls on a usable sample. Drawing an anchor/target
// needs page images (enterDrawMode also hard-guards on tplPageImages); fixed values
// don't, so they stay available even without a sample. Driven from renderTplPage
// (the sample-load funnel), the Mode dropdown, and field selection.
function updateMapModeUI() {
  const anchorMode = (document.getElementById('tpl-map-mode')?.value || 'anchor') === 'anchor';
  const hasSample  = tplPageImages.length > 0;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('tpl-map-fixed-controls',  !anchorMode);
  show('tpl-map-anchor-controls',  anchorMode);
  show('tpl-map-anchor-draw',      anchorMode && hasSample);
  show('tpl-map-no-sample',        anchorMode && !hasSample);
  if (!anchorMode || !hasSample) exitDrawMode();
}

function renderTplPage() {
  updateMapModeUI();
  const placeholder = document.getElementById('tpl-doc-placeholder');
  const wrap        = document.getElementById('tpl-img-wrap');
  const indicator   = document.getElementById('tpl-page-indicator');

  if (!tplPageImages.length) {
    wrap.style.display        = 'none';
    placeholder.style.display = '';
    placeholder.textContent   = selectedTemplate?.sample_document
      ? 'No preview available for this sample document.'
      : 'No sample document pinned for this template yet — pick one above.';
    indicator.textContent = '—';
    return;
  }

  placeholder.style.display = 'none';
  wrap.style.display        = 'inline-block';
  resetTplView();
  // A page change always lands on the RAW frame. Straighten is per page (the tilt differs sheet to
  // sheet), and leaving the toggle "on" across a navigation would claim a frame this page has not
  // been measured for — which is exactly what the save-time frame guard exists to catch.
  tplDeskewOn = false; tplDeskewAngle = 0;
  updateTplStraightenUI();
  tplImg.onload = () => {
    tplCanvas.width  = tplImg.offsetWidth;
    tplCanvas.height = tplImg.offsetHeight;
    redrawTplCanvas();
    // A straighten toggle swaps the picture but changes NOTHING about where the mappings resolve
    // (that is computed against the raw page either way), so it must not re-run the resolver —
    // that is one Python call per mapping and would stall the toggle for no new information.
    if (tplSuppressPreviewRerun) { tplSuppressPreviewRerun = false; return; }
    if (tplPreviewMode) runRegistrationPreview();
  };
  tplImg.src = tplPageImages[tplCurrentPage];
  indicator.textContent = `Page ${tplCurrentPage + 1} / ${tplPageImages.length}`;
}

document.getElementById('tpl-btn-page-prev').addEventListener('click', () => {
  if (tplCurrentPage > 0) { tplCurrentPage--; renderTplPage(); }
});
document.getElementById('tpl-btn-page-next').addEventListener('click', () => {
  if (tplCurrentPage < tplPageImages.length - 1) { tplCurrentPage++; renderTplPage(); }
});

// ── Zoom / pan (Phase 2 layout pass) ─────────────────────────────────────────
// CSS-transform scale+translate on #tpl-img-wrap. Kept independent of the
// canvas's internal pixel buffer — see coordinate-conversion note on the
// drawing handlers below — so existing anchor/target drawing keeps working
// unchanged at any zoom level.

function applyTplTransform() {
  tplImgWrap.style.transform = `translate(${tplPanX}px, ${tplPanY}px) scale(${tplZoom})`;
  document.getElementById('tpl-zoom-level').textContent = Math.round(tplZoom * 100) + '%';
}

function setTplZoom(zoom) {
  tplZoom = Math.max(TPL_ZOOM_MIN, Math.min(TPL_ZOOM_MAX, zoom));
  applyTplTransform();
}

function resetTplView() {
  tplZoom = 1;
  tplPanX = 0;
  tplPanY = 0;
  applyTplTransform();
}

document.getElementById('tpl-btn-zoom-in').addEventListener('click', () => setTplZoom(tplZoom + TPL_ZOOM_STEP));
document.getElementById('tpl-btn-zoom-out').addEventListener('click', () => setTplZoom(tplZoom - TPL_ZOOM_STEP));
document.getElementById('tpl-btn-zoom-reset').addEventListener('click', resetTplView);

tplViewer.addEventListener('wheel', (e) => {
  if (!tplPageImages.length) return;
  e.preventDefault();
  setTplZoom(tplZoom + (e.deltaY < 0 ? TPL_ZOOM_STEP : -TPL_ZOOM_STEP));
}, { passive: false });

// Right-click pan — works in and out of draw mode so the user can always
// reposition without toggling tools. Left-click is reserved for drawing.
// contextmenu is suppressed so the right-click drag doesn't pop a menu.
tplViewer.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || !tplPageImages.length) return;
  tplIsPanning = true;
  tplPanStart  = { x: e.clientX, y: e.clientY, panX: tplPanX, panY: tplPanY };
  tplViewer.classList.add('panning');
});
tplViewer.addEventListener('contextmenu', e => { if (tplPageImages.length) e.preventDefault(); });
// Prevent the browser's native image-drag (ghost image follows cursor on left-click drag).
tplViewer.addEventListener('dragstart', e => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!tplIsPanning || !tplPanStart) return;
  tplPanX = tplPanStart.panX + (e.clientX - tplPanStart.x);
  tplPanY = tplPanStart.panY + (e.clientY - tplPanStart.y);
  applyTplTransform();
});
window.addEventListener('mouseup', () => {
  if (!tplIsPanning) return;
  tplIsPanning = false;
  tplPanStart  = null;
  tplViewer.classList.remove('panning');
});

// ── Canvas resize sync (Pass 2) ──────────────────────────────────────────────
// #tpl-img uses max-width/max-height so its CSS display size changes when the
// window is resized or maximised. The canvas buffer must stay in sync or the
// normalised-coordinate boxes drift off the landmarks they were placed on.
new ResizeObserver(() => {
  if (!tplPageImages.length) return;
  const w = tplImg.offsetWidth, h = tplImg.offsetHeight;
  if (!w || !h || (w === tplCanvas.width && h === tplCanvas.height)) return;
  tplCanvas.width  = w;
  tplCanvas.height = h;
  redrawTplCanvas();
}).observe(tplImg);

// ── Registration preview (admin verification) ────────────────────────────────
// "Does each mapping track THIS document?" For every enabled mapping on the page,
// run the SAME resolver reprocess uses (test-template-mapping -> resolve_geometry,
// fed the template's landmarks) and overlay where the anchor/value ACTUALLY land
// (solid, coloured) against where they were DRAWN (faint grey). Switching the
// sample doc re-runs it, so the admin watches the boxes follow each layout — the
// fast way to confirm registration/landmarks work (or spot a field that needs a
// better anchor). On-demand admin path; N Tesseract resolves run SEQUENTIALLY so
// the temp-file (Date.now()) handler stays collision-free.
let tplPreviewMode = false;
let tplPreviewBoxes = {};            // field_key -> {anchor_box,target_box,value,method}
let tplPreviewRunToken = 0;          // discards a run whose doc/page changed mid-resolve

// ALWAYS the RAW page, never the straightened render on screen. The whole point of the preview is
// "where will this mapping actually land when a document is processed", and processing reads the
// raw scan — resolving against a straightened picture would answer a question nobody asked and
// would quietly disagree with production. The resolved boxes come back in raw coordinates and are
// mapped into the displayed frame at DRAW time (tplArrToDisplay), not here.
function currentTplPageB64() {
  const raw = tplPageImages[tplCurrentPage];
  if (typeof raw === 'string' && raw.startsWith('data:')) return raw.split(',')[1];
  if (!tplImg || !tplImg.naturalWidth) return null;
  // Fallback for a non-data-URL source: only safe while the raw page is the one displayed.
  if (tplDeskewOn) return null;
  const c = document.createElement('canvas');
  c.width = tplImg.naturalWidth; c.height = tplImg.naturalHeight;
  c.getContext('2d').drawImage(tplImg, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}

async function runRegistrationPreview() {
  if (!tplPreviewMode || !selectedTemplate) return;
  const statusEl = document.getElementById('tpl-preview-status');
  const mappings = (selectedTemplate.field_mappings || [])
    .filter(m => m.enabled && (m.page_number || 0) === tplCurrentPage);
  if (!mappings.length) {
    tplPreviewBoxes = {}; redrawTplCanvas();
    if (statusEl) statusEl.textContent = 'No enabled mappings on this page to preview.';
    return;
  }
  const pageB64 = currentTplPageB64();
  if (!pageB64) return;
  const landmarks = selectedTemplate.landmarks || [];
  const token = ++tplPreviewRunToken;
  const results = {};
  let i = 0;
  for (const m of mappings) {
    if (statusEl) statusEl.textContent = `Resolving ${++i}/${mappings.length} — ${m.field_key}…`;
    try {
      const out = (await api.testTemplateMapping(pageB64, m, landmarks)) || {};
      if (token !== tplPreviewRunToken) return;          // doc/page changed — abandon stale run
      results[m.field_key] = {
        anchor_box: out.anchor_box || null, target_box: out.target_box || null,
        value: (out.value || '').trim() || null, method: out.method || null,
      };
    } catch { results[m.field_key] = { anchor_box: null, target_box: null, value: null }; }
  }
  if (token !== tplPreviewRunToken) return;
  tplPreviewBoxes = results;
  const located = Object.values(results).filter(r => r.target_box).length;
  // Per-field diagnostic: which rung resolved it (REG=global transform, map=anchor+offset,
  // anc=anchor) and how far the resolved box moved VERTICALLY from where it was drawn.
  const diag = mappings.map(m => {
    const r = results[m.field_key] || {};
    let where = 'not located';
    if (Array.isArray(r.target_box)) {
      const dyPct = Math.round((r.target_box[1] - (m.target_y_norm || 0)) * 1000) / 10;
      where = Math.abs(dyPct) < 1 ? 'at drawn position'
            : `moved ${dyPct > 0 ? 'DOWN' : 'UP'} ${Math.abs(dyPct)}%`;
    }
    return `${m.field_key}: ${shortMethod(r.method)} · ${where}`;
  });
  if (statusEl) statusEl.innerHTML =
    escHtml(`Resolved ${located}/${mappings.length} · ${landmarks.length} landmarks · REG=transform, map=anchor+offset`) +
    '<br>' + diag.map(d => escHtml(d)).join('<br>');
  redrawTplCanvas();
}

// Overlay: faint grey = the stored (drawn) boxes; solid colour = where each field
// RESOLVES on this page (anchor blue, value green); amber = located nothing.
function drawRegistrationPreview() {
  if (!selectedTemplate) return;
  const w = tplCanvas.width, h = tplCanvas.height;
  for (const m of (selectedTemplate.field_mappings || [])) {
    if (!m.enabled || (m.page_number || 0) !== tplCurrentPage) continue;
    // EVERY box in this overlay is in RAW page coordinates — the stored mapping, and the resolved
    // positions Python computed against the raw page. When the preview is straightened the picture
    // rotates under them, so each one is mapped into the displayed frame before it is drawn or
    // labelled. Display only: nothing here is persisted, and `resolve_geometry` still runs against
    // the raw page exactly as before.
    const dm = tplMapDisplay(m);
    drawNormBox(dm.anchor_x_norm, dm.anchor_y_norm, dm.anchor_w_norm, dm.anchor_h_norm, w, h, '#9aa3b2', null, false);
    drawNormBox(dm.target_x_norm, dm.target_y_norm, dm.target_w_norm, dm.target_h_norm, w, h, '#9aa3b2', null, false);
    const dTargetArr = [dm.target_x_norm, dm.target_y_norm, dm.target_w_norm, dm.target_h_norm];
    drawPreviewLabel(`${m.field_key} (drawn)`, dTargetArr, w, h, '#6b7280');
    const r = tplPreviewBoxes[m.field_key];
    if (!r) continue;
    const dAnchorBox = tplArrToDisplay(r.anchor_box);
    const dTargetBox = tplArrToDisplay(r.target_box);
    if (dAnchorBox) drawArrBox(dAnchorBox, w, h, '#4f8ef7');
    if (dTargetBox) {
      drawArrBox(dTargetBox, w, h, '#3ecf8e');
      // [rung] = which mechanism placed this box: REG=global transform, map=anchor+offset.
      drawPreviewLabel(`${m.field_key}${r.value ? ' = ' + r.value : ''} [${shortMethod(r.method)}]`,
        dTargetBox, w, h, '#2f9e63');
    } else {
      drawNormBox(dm.target_x_norm, dm.target_y_norm, dm.target_w_norm, dm.target_h_norm, w, h, '#e0a23c', null, true);
      drawPreviewLabel(`${m.field_key}: not located`, dTargetArr, w, h, '#b07816');
    }
  }
}

// Raw-frame mapping row → the frame on screen. Returns a shallow copy; the row is never mutated.
function tplMapDisplay(m) {
  const a = tplToDisplayBox({ x_norm: m.anchor_x_norm, y_norm: m.anchor_y_norm, w_norm: m.anchor_w_norm, h_norm: m.anchor_h_norm }, 0);
  const t = tplToDisplayBox({ x_norm: m.target_x_norm, y_norm: m.target_y_norm, w_norm: m.target_w_norm, h_norm: m.target_h_norm }, 0);
  return {
    anchor_x_norm: a.x_norm, anchor_y_norm: a.y_norm, anchor_w_norm: a.w_norm, anchor_h_norm: a.h_norm,
    target_x_norm: t.x_norm, target_y_norm: t.y_norm, target_w_norm: t.w_norm, target_h_norm: t.h_norm,
  };
}
// Same, for the [x, y, w, h] array form the resolver returns.
function tplArrToDisplay(arr) {
  if (!Array.isArray(arr) || arr.length < 4 || arr[0] == null) return arr;
  const d = tplToDisplayBox({ x_norm: arr[0], y_norm: arr[1], w_norm: arr[2], h_norm: arr[3] }, 0);
  return [d.x_norm, d.y_norm, d.w_norm, d.h_norm];
}

// Short rung code for the diagnostic overlay/status: which mechanism placed the box.
function shortMethod(m) {
  if (!m) return 'none';
  if (m.startsWith('template_registration')) return 'REG';
  if (m.startsWith('template_mapping')) return 'map';
  if (m.startsWith('anchor')) return 'anc';
  return m.slice(0, 8);
}
function drawArrBox(arr, w, h, color) {
  if (Array.isArray(arr) && arr.length >= 4) drawNormBox(arr[0], arr[1], arr[2], arr[3], w, h, color, null, true);
}
function drawPreviewLabel(text, arr, w, h, color) {
  if (!text || !Array.isArray(arr) || arr[0] == null) return;
  const x = Math.round(arr[0] * w), y = Math.round(arr[1] * h);
  tplCtx.font = '11px sans-serif';
  const tw = Math.ceil(tplCtx.measureText(text).width);
  const ly = Math.max(0, y - 14);
  tplCtx.fillStyle = color;
  tplCtx.fillRect(x, ly, tw + 6, 13);
  tplCtx.fillStyle = '#fff';
  tplCtx.fillText(text, x + 3, ly + 10);
}

document.getElementById('tpl-preview-registration').addEventListener('change', (e) => {
  tplPreviewMode = !!e.target.checked;
  const s = document.getElementById('tpl-preview-status');
  if (tplPreviewMode && tplLandmarkMode) exitEnhanceMode();   // mutually exclusive
  if (tplPreviewMode) { runRegistrationPreview(); }
  else { tplPreviewBoxes = {}; if (s) s.textContent = ''; redrawTplCanvas(); }
});

// Full redraw: saved (enabled) mappings underneath, then whatever the editor
// currently has in flight (draft anchor/target boxes, live drag rectangle) on
// top — so drawing a new box never has to fight the persisted overlay for
// visibility.
// Map a box into the frame currently ON SCREEN so the overlay keeps sitting on its words when the
// page is straightened. STORED mappings and mappings loaded into the editor are raw-frame
// (srcAngle 0); a box just drawn while straightened is already in the display frame. Purely
// cosmetic — nothing here is ever persisted; the save path uses tplBoxToRaw.
function tplToDisplayBox(n, srcAngle) {
  const dispAngle = tplDeskewOn ? tplDeskewAngle : 0;
  const src = srcAngle || 0;
  if (src === dispAngle) return n;                                   // same frame — nothing to do
  const A = window.AnchorLabel;
  const c = tplDeskewCache[tplCurrentPage];
  const W = (c && c.W) || tplImg.naturalWidth || 0;
  const H = (c && c.H) || tplImg.naturalHeight || 0;
  if (!A || typeof A.deskewedNormToRaw !== 'function' || !W || !H) return n;
  const cx = n.x_norm + n.w_norm / 2, cy = n.y_norm + n.h_norm / 2;
  // raw → straightened is the INVERSE rotation (negative angle); straightened → raw is positive.
  const r = A.deskewedNormToRaw(cx, cy, src ? src : -dispAngle, W, H);
  return { ...n, x_norm: r.x - n.w_norm / 2, y_norm: r.y - n.h_norm / 2 };
}

function redrawTplCanvas() {
  tplCtx.clearRect(0, 0, tplCanvas.width, tplCanvas.height);
  if (tplPreviewMode) { drawRegistrationPreview(); return; }
  if (tplLandmarkMode) { drawLandmarkDraft(); return; }
  drawSavedMappings();
  const w = tplCanvas.width, h = tplCanvas.height;
  if (tplDraftAnchor && (tplDraftAnchor.page_number || 0) === tplCurrentPage) {
    const sel = tplSelectedBox?.boxType === 'anchor';
    const d = tplToDisplayBox(tplDraftAnchor, tplDraftAnchor._frame?.angle);
    drawNormBox(d.x_norm, d.y_norm, d.w_norm, d.h_norm, w, h, '#4f8ef7', 'anchor (draft)', sel);
  }
  if (tplDraftTarget && (tplDraftTarget.page_number || 0) === tplCurrentPage) {
    const sel = tplSelectedBox?.boxType === 'target';
    const d = tplToDisplayBox(tplDraftTarget, tplDraftTarget._frame?.angle);
    drawNormBox(d.x_norm, d.y_norm, d.w_norm, d.h_norm, w, h, '#3ecf8e', 'target (draft)', sel);
  }
  if (tplDragRect) {
    const dragColor = tplMapMode === 'target' ? '#3ecf8e' : '#4f8ef7';
    const dx = Math.round(tplDragRect.x), dy = Math.round(tplDragRect.y);
    const dw = Math.round(tplDragRect.w), dh = Math.round(tplDragRect.h);
    tplCtx.lineWidth   = 1;
    tplCtx.strokeStyle = dragColor;
    tplCtx.setLineDash([5, 4]);
    tplCtx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
    tplCtx.setLineDash([]);
    tplCtx.fillStyle = dragColor + '18';
    tplCtx.fillRect(dx, dy, dw, dh);
  }
}

// Read-only layer: draws each OTHER enabled mapping's anchor box (blue) and
// target zone (green) at its stored normalised position — the same x/y/w/h_norm
// fractional coordinate system field_anchors already uses, so it scales
// correctly to whatever size the preview image renders at. The mapping
// currently open in the editor is skipped here — its (possibly edited) boxes
// are drawn as the draft layer in redrawTplCanvas() instead, so it isn't shown twice.
function drawSavedMappings() {
  if (!selectedTemplate) return;
  const w = tplCanvas.width, h = tplCanvas.height;

  for (const m of (selectedTemplate.field_mappings || [])) {
    if (!m.enabled) continue;
    if (m.field_key === tplEditingFieldKey) continue;
    if ((m.page_number || 0) !== tplCurrentPage) continue;
    const asel = tplSelectedBox?.fieldKey === m.field_key && tplSelectedBox?.boxType === 'anchor';
    const tsel = tplSelectedBox?.fieldKey === m.field_key && tplSelectedBox?.boxType === 'target';
    // Stored mappings are raw-frame; follow the page when it is straightened on screen.
    const a = tplToDisplayBox({ x_norm: m.anchor_x_norm, y_norm: m.anchor_y_norm, w_norm: m.anchor_w_norm, h_norm: m.anchor_h_norm }, 0);
    const t = tplToDisplayBox({ x_norm: m.target_x_norm, y_norm: m.target_y_norm, w_norm: m.target_w_norm, h_norm: m.target_h_norm }, 0);
    drawNormBox(a.x_norm, a.y_norm, a.w_norm, a.h_norm, w, h, '#4f8ef7', `${m.field_key} anchor`, asel);
    drawNormBox(t.x_norm, t.y_norm, t.w_norm, t.h_norm, w, h, '#3ecf8e', m.field_key, tsel);
  }
}

function drawNormBox(xN, yN, wN, hN, w, h, color, label, selected = false) {
  if ([xN, yN, wN, hN].some(v => v == null)) return;
  const x  = Math.round(xN * w);
  const y  = Math.round(yN * h);
  const bw = Math.round(wN * w);
  const bh = Math.round(hN * h);
  tplCtx.lineWidth   = selected ? 1.5 : 1;
  tplCtx.strokeStyle = color;
  tplCtx.setLineDash(selected ? [] : [5, 4]);
  tplCtx.strokeRect(x + 0.5, y + 0.5, bw, bh);
  tplCtx.setLineDash([]);
  tplCtx.fillStyle = color + (selected ? '26' : '12');
  tplCtx.fillRect(x, y, bw, bh);
}

// ── Hit testing ──────────────────────────────────────────────────────────────
// Returns { fieldKey, boxType:'anchor'|'target' } for the topmost box under
// the canvas-space point, or null. Draft boxes (current editing field) are
// checked first — they render on top.
function hitTestBoxes(pt) {
  const w = tplCanvas.width, h = tplCanvas.height;
  if (tplEditingFieldKey) {
    if (tplDraftAnchor && (tplDraftAnchor.page_number || 0) === tplCurrentPage && normHit(pt, tplDraftAnchor, w, h))
      return { fieldKey: tplEditingFieldKey, boxType: 'anchor' };
    if (tplDraftTarget && (tplDraftTarget.page_number || 0) === tplCurrentPage && normHit(pt, tplDraftTarget, w, h))
      return { fieldKey: tplEditingFieldKey, boxType: 'target' };
  }
  for (const m of (selectedTemplate?.field_mappings || [])) {
    if (!m.enabled || m.field_key === tplEditingFieldKey) continue;
    if ((m.page_number || 0) !== tplCurrentPage) continue;
    if (mappingBoxHit(pt, m, 'anchor', w, h)) return { fieldKey: m.field_key, boxType: 'anchor' };
    if (mappingBoxHit(pt, m, 'target', w, h)) return { fieldKey: m.field_key, boxType: 'target' };
  }
  return null;
}
function normHit(pt, n, w, h) {
  return pt.x >= n.x_norm * w && pt.x <= (n.x_norm + n.w_norm) * w &&
         pt.y >= n.y_norm * h && pt.y <= (n.y_norm + n.h_norm) * h;
}
function mappingBoxHit(pt, m, type, w, h) {
  const xN = m[`${type}_x_norm`], yN = m[`${type}_y_norm`];
  const wN = m[`${type}_w_norm`], hN = m[`${type}_h_norm`];
  if ([xN, yN, wN, hN].some(v => v == null)) return false;
  return pt.x >= xN * w && pt.x <= (xN + wN) * w &&
         pt.y >= yN * h && pt.y <= (yN + hN) * h;
}
// Get/set the normalised coords of a selected box (always via draft state after load).
function getBoxNorm(sel) {
  return sel.boxType === 'anchor' ? { ...tplDraftAnchor } : { ...tplDraftTarget };
}
function setBoxNorm(sel, norm) {
  // A MOVED box is re-staged against whatever frame is on screen right now, not the one it was
  // first drawn on — otherwise nudging a box while straightened would keep a stale angle.
  tplStampFrame(norm);
  if (sel.boxType === 'anchor') tplDraftAnchor = norm;
  else                          tplDraftTarget = norm;
}

// ── Drawing tools (Phase 2) ──────────────────────────────────────────────────
// Left-click in draw mode: drag to draw a new box.
// Left-click outside draw mode: click-to-select / drag-to-move an existing box.
// Right-click: pan (handled on tplViewer, not here).

function enterDrawMode(mode) {
  if (!selectedTemplate || !tplPageImages.length || !tplEditingFieldKey) return;
  tplMapMode = mode;
  tplCanvas.classList.add('drawing');
  document.getElementById('tpl-btn-draw-anchor').classList.toggle('primary', mode === 'anchor');
  document.getElementById('tpl-btn-draw-target').classList.toggle('primary', mode === 'target');
}

function exitDrawMode() {
  tplMapMode    = null;
  tplIsDragging = false;
  tplDragRect   = null;
  tplCanvas.style.cursor = 'default';
  tplCanvas.classList.remove('drawing');
  document.getElementById('tpl-btn-draw-anchor').classList.remove('primary');
  document.getElementById('tpl-btn-draw-target').classList.remove('primary');
}

document.getElementById('tpl-btn-draw-anchor').addEventListener('click', () => {
  if (tplMapMode === 'anchor') exitDrawMode();
  else enterDrawMode('anchor');
});
document.getElementById('tpl-btn-draw-target').addEventListener('click', () => {
  if (tplMapMode === 'target') exitDrawMode();
  else enterDrawMode('target');
});

// Mouse coordinates arrive in CSS (post-zoom) pixels via getBoundingClientRect,
// while tplCanvas.width/height stay at the unscaled rendered-image size — the
// canvas is never resized for zoom, only visually scaled along with #tpl-img-wrap.
// Multiplying by (canvas buffer size / bounding-rect size) converts back to
// canvas-pixel space, so drawn boxes land in the right place at any zoom level
// (ratio is 1 at zoom=1, leaving today's behaviour unchanged).
function tplCanvasPoint(e) {
  const r = tplCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (tplCanvas.width  / r.width),
    y: (e.clientY - r.top)  * (tplCanvas.height / r.height),
  };
}

tplCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !tplPageImages.length) return;
  const pt = tplCanvasPoint(e);

  if (tplMapMode || tplLandmarkMode) {
    // Draw mode — a mapping anchor/target box, OR an Enhance-detection landmark.
    tplIsDragging = true;
    tplDragStart  = pt;
    tplDragRect   = { x: pt.x, y: pt.y, w: 0, h: 0 };
    return;
  }

  // Normal mode: hit-test existing boxes
  const hit = hitTestBoxes(pt);
  if (hit) {
    // If a different field's box was clicked, load it into the editor first
    if (hit.fieldKey !== tplEditingFieldKey) {
      const sel = document.getElementById('tpl-map-field-select');
      if (sel) sel.value = hit.fieldKey;
      loadMappingIntoEditor(hit.fieldKey);
      // loadMappingIntoEditor clears tplSelectedBox; set it after
    }
    tplSelectedBox = { fieldKey: hit.fieldKey, boxType: hit.boxType };
    tplMoveStart   = { pt, origNorm: getBoxNorm(tplSelectedBox) };
    redrawTplCanvas();
  } else {
    // Empty space: clear selection
    if (tplSelectedBox) { tplSelectedBox = null; redrawTplCanvas(); }
  }
});

tplCanvas.addEventListener('mousemove', (e) => {
  if (tplIsDragging && tplDragRect) {
    // Drawing a new box
    const { x: cx, y: cy } = tplCanvasPoint(e);
    tplDragRect = {
      x: Math.min(tplDragStart.x, cx),
      y: Math.min(tplDragStart.y, cy),
      w: Math.abs(cx - tplDragStart.x),
      h: Math.abs(cy - tplDragStart.y),
    };
    redrawTplCanvas();
    return;
  }

  if (tplMoveStart && tplSelectedBox) {
    // Moving a selected box
    tplIsMoving  = true;
    const pt = tplCanvasPoint(e);
    const dx = (pt.x - tplMoveStart.pt.x) / tplCanvas.width;
    const dy = (pt.y - tplMoveStart.pt.y) / tplCanvas.height;
    const o  = tplMoveStart.origNorm;
    setBoxNorm(tplSelectedBox, {
      ...o,
      x_norm: Math.max(0, Math.min(1 - o.w_norm, o.x_norm + dx)),
      y_norm: Math.max(0, Math.min(1 - o.h_norm, o.y_norm + dy)),
    });
    redrawTplCanvas();
    return;
  }

  // Hover cursor: show move cursor when over an existing box
  if (!tplMapMode) {
    tplCanvas.style.cursor = hitTestBoxes(tplCanvasPoint(e)) ? 'move' : 'default';
  }
});

tplCanvas.addEventListener('mouseup', () => {
  if (tplIsDragging) {
    tplIsDragging = false;
    const rect = tplDragRect;
    tplDragRect  = null;
    if (!rect || rect.w < 8 || rect.h < 8) { redrawTplCanvas(); return; }
    const norm = {
      x_norm: rect.x / tplCanvas.width,   y_norm: rect.y / tplCanvas.height,
      w_norm: rect.w / tplCanvas.width,   h_norm: rect.h / tplCanvas.height,
      page_number: tplCurrentPage,
    };
    if (tplLandmarkMode) { addLandmarkFromRect(rect, norm); return; }   // stays armed for the next landmark
    if (!tplMapMode) { redrawTplCanvas(); return; }
    // Record WHICH FRAME this box was drawn on — raw, or the straightened render and its angle.
    // Save rotates it back and refuses if the frame has since changed (see tplBoxToRaw).
    tplStampFrame(norm);
    if (tplMapMode === 'anchor') { tplDraftAnchor = norm; autoDetectAnchorText(rect); }
    else                         { tplDraftTarget = norm; }
    exitDrawMode();
    updateMappingEditorState();
    redrawTplCanvas();
    // Word-snap runs AFTER the draft is staged and drawn, so the hand-drawn box appears
    // immediately and then tightens — a snap that blocked the first paint would read as lag.
    tplSnapDraft(tplMapMode === 'anchor' ? 'anchor' : 'target');
    return;
  }

  if (tplMoveStart) {
    tplIsMoving  = false;
    tplMoveStart = null;
    if (tplSelectedBox) updateMappingEditorState();
    redrawTplCanvas();
  }
});

// Keyboard nudge — arrow keys move the selected box by a small (or large with Shift) step.
// Ignored when focus is inside any text input, textarea, or select element.
window.addEventListener('keydown', (e) => {
  if (!tplSelectedBox) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!ARROWS.includes(e.key)) return;
  e.preventDefault();

  const step = e.shiftKey ? 0.01 : 0.002;
  const norm = getBoxNorm(tplSelectedBox);
  if (!norm || norm.x_norm == null) return;

  let dx = 0, dy = 0;
  if (e.key === 'ArrowLeft')  dx = -step;
  if (e.key === 'ArrowRight') dx =  step;
  if (e.key === 'ArrowUp')    dy = -step;
  if (e.key === 'ArrowDown')  dy =  step;

  setBoxNorm(tplSelectedBox, {
    ...norm,
    x_norm: Math.max(0, Math.min(1 - norm.w_norm, norm.x_norm + dx)),
    y_norm: Math.max(0, Math.min(1 - norm.h_norm, norm.y_norm + dy)),
  });
  redrawTplCanvas();
  updateMappingEditorState();
});

// Best-effort prefill — OCRs the box the admin just drew for the anchor and
// drops the recognised text into the label field, exactly the crop→base64→
// ocrRegion round trip the review window's zone-OCR tool uses (just without
// writing the result back into a document field).
// ── Word-snap a freshly drawn mapping box (owner 2026-08-10) ─────────────────
// The teach wizard has snapped drawn boxes to the printed words since 2026-08-04; the Template
// Manager never did, so the same hand-drawn rectangle produced a tight box in one surface and a
// loose one in the other — and a loose taught box is exactly what reads the neighbouring row on a
// shifted scan. Same shared implementation (shared/boxSnap.js), same gate: the snapped box is
// DRAWN on the canvas, so it is approved by being seen before it can be saved.
//
// Frame-safe by construction: the crop comes from `tplImg`, i.e. whatever is on screen, so with
// Straighten on the snap happens in the straightened frame — the same frame the drawn box is in,
// and the same frame `_frame` records. The existing save-time back-transform then rotates the
// SNAPPED box to raw. Re-stamping the frame afterwards keeps that chain honest.
//
// Kill: setting `template_box_word_snap` = 'false' (default ON, mirroring `teach_box_word_snap`).
let TPL_SNAP_ON = true;
try { api.getSetting?.('template_box_word_snap').then(v => { TPL_SNAP_ON = v !== 'false'; }); } catch { /* default ON */ }

async function tplSnapDraft(which) {
  if (!TPL_SNAP_ON || !window.BoxSnap || !tplImg || !tplImg.naturalWidth) return;
  const draft = which === 'anchor' ? tplDraftAnchor : tplDraftTarget;
  if (!draft) return;
  // Snapshot enough to prove, when the async OCR returns, that nothing moved underneath it. A
  // snap applied to a box the user has since redrawn/navigated away from would land on the wrong
  // words — the same fail-closed rule the save-time frame guard uses.
  const page = tplCurrentPage, angle = tplDeskewOn ? tplDeskewAngle : 0;
  const before = { ...draft };
  try {
    // The label cut only applies to the VALUE box, and only when the anchor sits to its LEFT —
    // an anchor above (or right of) the value says nothing about where the value starts.
    let labelRightEdge;
    if (which === 'target' && tplDraftAnchor) {
      const aRight = tplDraftAnchor.x_norm + tplDraftAnchor.w_norm;
      const sameRow = Math.abs((tplDraftAnchor.y_norm + tplDraftAnchor.h_norm / 2)
                             - (draft.y_norm + draft.h_norm / 2)) < Math.max(draft.h_norm, 1e-6);
      if (sameRow && aRight <= draft.x_norm + draft.w_norm / 2) labelRightEdge = aRight;
    }
    const res = await window.BoxSnap.snapBoxToWords(
      { x: draft.x_norm, y: draft.y_norm, w: draft.w_norm, h: draft.h_norm },
      {
        natW: tplImg.naturalWidth, natH: tplImg.naturalHeight,
        cropB64: window.BoxSnap.makeNativeCropper(tplImg),
        ocrRegionBoxes: (b64) => api.ocrRegionBoxes(b64),
        labelRightEdge,
      });
    if (!res || !res.box) return;                       // every guard failed closed to the drawn box
    const live = which === 'anchor' ? tplDraftAnchor : tplDraftTarget;
    if (!live || page !== tplCurrentPage || angle !== (tplDeskewOn ? tplDeskewAngle : 0)) return;
    if (live.x_norm !== before.x_norm || live.y_norm !== before.y_norm
        || live.w_norm !== before.w_norm || live.h_norm !== before.h_norm) return;   // redrawn since
    const snapped = tplStampFrame({
      x_norm: res.box.x, y_norm: res.box.y, w_norm: res.box.w, h_norm: res.box.h,
      page_number: live.page_number,
    });
    if (which === 'anchor') {
      tplDraftAnchor = snapped;
      // The words the snap admitted ARE the label text — better evidence than a separate OCR of
      // the hand-drawn rectangle, which is what autoDetectAnchorText read a moment ago.
      const el = document.getElementById('tpl-map-anchor-text');
      if (el && res.text) el.value = res.text;
    } else {
      tplDraftTarget = snapped;
    }
    redrawTplCanvas();                                   // the operator SEES the snapped box
  } catch { /* snapping is an improvement, never a requirement — keep the drawn box */ }
}

async function autoDetectAnchorText(rect) {
  try {
    const scaleX = tplImg.naturalWidth  / tplImg.offsetWidth;
    const scaleY = tplImg.naturalHeight / tplImg.offsetHeight;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width  = Math.max(1, Math.round(rect.w * scaleX));
    cropCanvas.height = Math.max(1, Math.round(rect.h * scaleY));
    cropCanvas.getContext('2d').drawImage(
      tplImg,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
      cropCanvas.width, cropCanvas.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );
    const text = (await api.ocrRegion(cropCanvas.toDataURL('image/png').split(',')[1]) || '').trim();
    if (text) document.getElementById('tpl-map-anchor-text').value = text;
  } catch (e) {
    console.warn('anchor auto-OCR failed:', e.message);
  }
}

// ── Mapping editor (Phase 2) ─────────────────────────────────────────────────

// The field's REAL declared data type, for the "Test" preview. This replaced the mapping's
// `ocr_type` when that column was deleted (2026-08-08, owner decision) — and it is strictly more
// correct than what it replaced: test_mapping.py feeds this into the SAME
// engine._seed_field_patterns the pipeline uses, so the preview now gates on the type the document
// type actually declares rather than on a per-mapping value three UI surfaces wrote with three
// different vocabularies and no production code ever read. Defensive: any lookup miss falls back
// to 'text', which is what an absent ocr_type resolved to anyway.
function tplFieldTypeFor(key) {
  try {
    const slug = (selectedTemplate && (selectedTemplate.document_type_slug || selectedTemplate.slug)) || null;
    const dt   = slug ? (allTypesWithFields || []).find(t => t.slug === slug) : null;
    const f    = dt && (dt.fields || []).find(x => x.key === key);
    return (f && f.type) ? f.type : 'text';
  } catch { return 'text'; }
}

async function populateMapFieldSelect(detail) {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (for mapping fields) failed:', e.message); }
  }
  const select = document.getElementById('tpl-map-field-select');
  select.innerHTML = '';

  const dt     = allTypesWithFields.find(t => t.slug === detail.document_type_slug);
  const fields = (dt ? dt.fields : []) || [];
  for (const f of fields) {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = `${f.label} (${f.key})`;
    select.appendChild(opt);
  }
  select.onchange = () => selectMapField(select.value || null);

  if (fields.length) { select.value = fields[0].key; selectMapField(fields[0].key); }
  else selectMapField(null);
}

// Selecting a field always returns the editor to ANCHOR mode (the default); the
// user opts a field into a Fixed value via the Mode dropdown. So a field change
// resets the mode, loads that field's anchor mapping, and re-applies mode visibility.
function selectMapField(fieldKey) {
  const modeSel = document.getElementById('tpl-map-mode');
  if (modeSel) modeSel.value = 'anchor';
  loadMappingIntoEditor(fieldKey);
  updateMapModeUI();
}

// Prefill the Fixed value input from the currently-selected field's stored fixed
// value (if any) and clear any stale status message. Called when switching to
// Fixed value mode and after a clear.
function syncFixedInput() {
  const fieldKey = document.getElementById('tpl-map-field-select')?.value;
  const input = document.getElementById('tpl-fixed-value-input');
  const ex = (selectedTemplate?.fields || []).find(
    f => f.field_key === fieldKey && !f.is_variable && f.fixed_value);
  if (input) input.value = ex ? ex.fixed_value : '';
  const msg = document.getElementById('tpl-fixed-msg');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
}

function loadMappingIntoEditor(fieldKey) {
  exitDrawMode();
  tplSelectedBox     = null;
  tplIsMoving        = false;
  tplMoveStart       = null;
  tplEditingFieldKey = fieldKey;

  const existing = fieldKey
    ? (selectedTemplate?.field_mappings || []).find(m => m.field_key === fieldKey)
    : null;

  if (existing) {
    tplDraftAnchor = {
      x_norm: existing.anchor_x_norm, y_norm: existing.anchor_y_norm,
      w_norm: existing.anchor_w_norm, h_norm: existing.anchor_h_norm,
      page_number: existing.page_number || 0,
    };
    tplDraftTarget = {
      x_norm: existing.target_x_norm, y_norm: existing.target_y_norm,
      w_norm: existing.target_w_norm, h_norm: existing.target_h_norm,
      page_number: existing.page_number || 0,
    };
    document.getElementById('tpl-map-anchor-text').value = existing.anchor_text || '';
    const pct = Math.round((existing.search_expansion ?? 0.04) * 100);
    document.getElementById('tpl-map-expansion').value     = pct;
    setTplExpansionUI(pct);
    document.getElementById('tpl-map-enabled').checked   = existing.enabled !== 0;
    document.getElementById('tpl-btn-delete-mapping').style.display = '';

    if ((existing.page_number || 0) !== tplCurrentPage) {
      tplCurrentPage = existing.page_number || 0;
      renderTplPage();
    }
  } else {
    tplDraftAnchor = null;
    tplDraftTarget = null;
    document.getElementById('tpl-map-anchor-text').value = '';
    document.getElementById('tpl-map-expansion').value     = 4;
    setTplExpansionUI(4);
    document.getElementById('tpl-map-enabled').checked   = true;
    document.getElementById('tpl-btn-delete-mapping').style.display = 'none';
  }

  document.getElementById('tpl-mapping-msg').textContent = '';
  updateMappingEditorState();
  redrawTplCanvas();
}

function updateMappingEditorState() {
  const anchorOk = !!tplDraftAnchor;
  const targetOk = !!tplDraftTarget;

  const aEl = document.getElementById('tpl-anchor-status');
  const tEl = document.getElementById('tpl-target-status');
  aEl.textContent = anchorOk ? 'Anchor: drawn ✓' : 'Anchor: not drawn';
  aEl.className   = 'mapping-status' + (anchorOk ? ' ok' : '');
  tEl.textContent = targetOk ? 'Target: drawn ✓' : 'Target: not drawn';
  tEl.className   = 'mapping-status' + (targetOk ? ' ok' : '');

  const ready = anchorOk && targetOk && !!tplEditingFieldKey;
  document.getElementById('tpl-btn-save-mapping').disabled = !ready;
  document.getElementById('tpl-btn-test-mapping').disabled = !ready;
}

// Name what each end of the slider actually DOES to a misfiring box. Too tight clips the value;
// too loose swallows the neighbouring row or column — and those are the two things an operator
// is looking at when they come here, so the hint reads as a diagnosis, not a definition.
function tplExpansionHint(pct) {
  const p = Number(pct) || 0;
  if (p === 0)  return 'No margin — the box is read exactly as drawn. Use when a neighbouring value keeps being picked up; risky if scans shift at all.';
  if (p <= 4)   return 'Tight. Best when the value sits close to other text. If reads come back clipped, raise this.';
  if (p <= 10)  return 'Roomy — tolerates a shifted or rescaled scan. If reads pick up the row above/below or the next column, lower this.';
  return 'Very loose. Only for a value that moves a lot on the page; at this width a neighbouring value can easily be read instead.';
}
function setTplExpansionUI(pct) {
  const v = document.getElementById('tpl-map-expansion-val');
  const h = document.getElementById('tpl-map-expansion-hint');
  if (v) v.textContent = pct + '%';
  if (h) h.textContent = tplExpansionHint(pct);
}
document.getElementById('tpl-map-expansion').addEventListener('input', (e) => {
  setTplExpansionUI(e.target.value);
});

document.getElementById('tpl-map-mode')?.addEventListener('change', (e) => {
  if (e.target.value === 'fixed') syncFixedInput();
  updateMapModeUI();
});

document.getElementById('tpl-btn-cancel-mapping').addEventListener('click', () => {
  if (tplEditingFieldKey) loadMappingIntoEditor(tplEditingFieldKey);
});

document.getElementById('tpl-btn-save-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey || !tplDraftAnchor || !tplDraftTarget) return;
  const msg = document.getElementById('tpl-mapping-msg');

  // Straighten: rotate anything drawn on the straightened render back onto the RAW page, which is
  // what extraction reads. FAIL-CLOSED — if either box's frame can no longer be vouched for, the
  // save is REFUSED with an explanation rather than persisting coords in the wrong frame (a
  // silently mis-seated mapping is far worse than a re-draw).
  const liveFrame = tplCurrentFrame();
  const rawAnchor = tplBoxToRaw(tplDraftAnchor, liveFrame);
  const rawTarget = tplBoxToRaw(tplDraftTarget, liveFrame);
  if (!rawAnchor || !rawTarget) {
    msg.textContent = 'The page changed after those boxes were drawn — please redraw the anchor and target, then save.';
    msg.style.color = 'var(--err)';
    return;
  }

  const mapping = {
    field_key:        tplEditingFieldKey,
    page_number:      rawAnchor.page_number || 0,
    anchor_text:      document.getElementById('tpl-map-anchor-text').value.trim() || null,
    anchor_x_norm: rawAnchor.x_norm, anchor_y_norm: rawAnchor.y_norm,
    anchor_w_norm: rawAnchor.w_norm, anchor_h_norm: rawAnchor.h_norm,
    target_x_norm: rawTarget.x_norm, target_y_norm: rawTarget.y_norm,
    target_w_norm: rawTarget.w_norm, target_h_norm: rawTarget.h_norm,
    search_expansion: parseInt(document.getElementById('tpl-map-expansion').value, 10) / 100,
    enabled:          document.getElementById('tpl-map-enabled').checked,
  };

  try {
    const res = await api.saveTemplateMapping(selectedTemplate.id, mapping);
    if (!res || !res.success) {
      msg.textContent = res?.error || 'Save failed.';
      msg.style.color = 'var(--err)';
      return;
    }
    msg.textContent = 'Mapping saved.';
    msg.style.color = 'var(--ok)';
    await refreshSelectedTemplate();
    loadMappingIntoEditor(tplEditingFieldKey);
  } catch (e) {
    msg.textContent = 'Save failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

document.getElementById('tpl-btn-delete-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey) return;
  if (!confirm(`Delete the mapping for "${tplEditingFieldKey}"? This cannot be undone.`)) return;

  const msg = document.getElementById('tpl-mapping-msg');
  try {
    await api.deleteTemplateMapping(selectedTemplate.id, tplEditingFieldKey);
    msg.textContent = 'Mapping deleted.';
    msg.style.color = 'var(--muted)';
    await refreshSelectedTemplate();
    loadMappingIntoEditor(tplEditingFieldKey);
  } catch (e) {
    msg.textContent = 'Delete failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// "Test extraction" — crops exactly the drawn target zone from the pinned
// sample and runs it through the same ocr-region primitive the review
// window's teaching tool uses, then persists the result so it survives a
// reload. This proves out the target geometry against real pixels without
// needing template_mapper.py / engine.py wiring (Phase 3) to exist yet.
document.getElementById('tpl-btn-test-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey || !tplDraftAnchor || !tplDraftTarget || !tplPageImages.length) return;
  const msg = document.getElementById('tpl-mapping-msg');
  msg.textContent = 'Testing…';
  msg.style.color = 'var(--muted)';

  try {
    const pageNum = tplDraftAnchor.page_number || 0;
    if (pageNum !== tplCurrentPage) {
      tplCurrentPage = pageNum;
      renderTplPage();
      await new Promise(resolve => { tplImg.onload = () => { tplCanvas.width = tplImg.offsetWidth; tplCanvas.height = tplImg.offsetHeight; redrawTplCanvas(); resolve(); }; });
    }

    // Build the SAME mapping the Save path persists (incl. the box→box offset
    // saveMapping records) and run it through the REAL Stage 0.5 extractor, so
    // this test reflects exactly what reprocess will produce — same anchor
    // relocation, target-crop derivation, OCR and normalisation. (Previously the
    // editor cropped the absolute drawn target itself, which silently diverged.)
    const mapping = {
      field_key:        tplEditingFieldKey,
      page_number:      pageNum,
      anchor_text:      document.getElementById('tpl-map-anchor-text').value.trim() || null,
      anchor_x_norm: tplDraftAnchor.x_norm, anchor_y_norm: tplDraftAnchor.y_norm,
      anchor_w_norm: tplDraftAnchor.w_norm, anchor_h_norm: tplDraftAnchor.h_norm,
      target_x_norm: tplDraftTarget.x_norm, target_y_norm: tplDraftTarget.y_norm,
      target_w_norm: tplDraftTarget.w_norm, target_h_norm: tplDraftTarget.h_norm,
      offset_dx_norm:   tplDraftTarget.x_norm - tplDraftAnchor.x_norm,
      offset_dy_norm:   tplDraftTarget.y_norm - tplDraftAnchor.y_norm,
      search_expansion: parseInt(document.getElementById('tpl-map-expansion').value, 10) / 100,
      enabled:          true,
      // Preview-only, never persisted: test_mapping.py seeds the credibility pattern from this.
      field_type:       tplFieldTypeFor(tplEditingFieldKey),
    };

    // The extractor relocates the anchor and derives the target itself, so send
    // the WHOLE full-resolution page, not a pre-cropped box.
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width  = tplImg.naturalWidth;
    pageCanvas.height = tplImg.naturalHeight;
    pageCanvas.getContext('2d').drawImage(tplImg, 0, 0);
    const pageB64 = pageCanvas.toDataURL('image/png').split(',')[1];

    const out  = (await api.testTemplateMapping(pageB64, mapping)) || {};
    const text = (out.value || '').trim();
    const status = text ? 'ok' : 'not_found';

    await api.recordTemplateMappingTest(selectedTemplate.id, tplEditingFieldKey, {
      value: text || null, confidence: text ? (out.confidence || 90) : 0, status,
    });

    if (text) {
      msg.textContent = `Test result: "${text}" (${out.method || 'mapping'})`;
      msg.style.color = 'var(--ok)';
    } else {
      msg.textContent = 'Test result: anchor not located or nothing read — this is exactly what reprocess will do.';
      msg.style.color = 'var(--warn)';
    }
    await refreshSelectedTemplate();
    renderMappingsTable(selectedTemplate);
  } catch (e) {
    msg.textContent = 'Test failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// Re-fetches the template detail after a mutation and keeps the list/cache in sync.
async function refreshSelectedTemplate() {
  if (!selectedTemplate) return;
  const refreshed = await api.getTemplateDetail(selectedTemplate.id);
  if (!refreshed) return;
  selectedTemplate = refreshed;
  const idx = allTemplates.findIndex(t => t.id === refreshed.id);
  if (idx !== -1) allTemplates[idx] = refreshed;
  renderTemplateList();
  renderMappingsTable(refreshed);
}

// "tested 3 days ago" from the stored SQLite datetime('now') stamp (UTC, no zone marker — parsed
// as UTC explicitly so the age can't be shifted by the local offset).
function tplTestAge(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(s);
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 0)  return '';
  if (days === 0) return 'tested today';
  if (days === 1) return 'tested yesterday';
  if (days < 30)  return `tested ${days} days ago`;
  return `tested ${m ? `${m[3]}-${m[2]}-${m[1]}` : 'a while ago'}`;
}

function renderMappingsTable(detail) {
  const tbody = document.getElementById('tpl-mappings-tbody');
  const empty = document.getElementById('tpl-mappings-empty');
  const mappings = detail.field_mappings || [];
  tbody.innerHTML = '';
  empty.style.display = mappings.length ? 'none' : '';

  for (const m of mappings) {
    let lastTest = '<span class="section-desc">never tested</span>';
    if (m.last_test_status) {
      const cls = m.last_test_status === 'ok' ? 'ok' : m.last_test_status === 'low_confidence' ? 'warn' : 'err';
      const conf = m.last_test_confidence != null ? ` · ${Math.round(m.last_test_confidence)}%` : '';
      // WHEN it was tested matters as much as the result: a green read from before the box was
      // last moved is not evidence that the box works now, and the table gave no way to tell.
      const when = tplTestAge(m.last_test_at);
      lastTest = `<span class="mapping-status ${cls}">${escHtml(m.last_test_value || m.last_test_status)}${conf}</span>`
               + (when ? `<span class="section-desc" style="display:block; margin-top:2px;">${escHtml(when)}</span>` : '');
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="field-key">${escHtml(m.field_key)}</span></td>
      <td>${escHtml(m.anchor_text || '—')}</td>
      <td>${Math.round((m.search_expansion || 0) * 100)}%</td>
      <td>${lastTest}</td>
      <td>${m.enabled ? 'Yes' : 'No'}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      const select = document.getElementById('tpl-map-field-select');
      select.value = m.field_key;
      selectMapField(m.field_key);   // resets to anchor mode + loads the mapping
    });
    tbody.appendChild(tr);
  }
}

// ── Fixed field values ─────────────────────────────────────────────────────────
// Admin-managed constant values for template fields, set via the Map a Field
// editor's "Fixed value" mode (the field selector + this table are shared with
// anchor mode). This renders only the list of fields currently fixed — so it's
// clear at a glance which fields are constant and which use normal extraction —
// plus a Clear button per row. The field selector is populated by
// populateMapFieldSelect; the input is prefilled by syncFixedInput.
async function renderFixedFieldsTable(detail) {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (fixed fields) failed:', e.message); }
  }
  const dt       = allTypesWithFields.find(t => t.slug === detail.document_type_slug);
  const dtFields = (dt ? dt.fields : []) || [];
  const labelFor = (key) => { const f = dtFields.find(f => f.key === key); return f ? f.label : key; };

  // Table of fields that are currently fixed
  const tbody = document.getElementById('tpl-fixed-tbody');
  const empty = document.getElementById('tpl-fixed-empty');
  const fixed = (detail.fields || []).filter(f => !f.is_variable && f.fixed_value);
  if (tbody) {
    tbody.innerHTML = '';
    for (const f of fixed) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="field-key">${escHtml(labelFor(f.field_key))}</span> <span class="section-desc">(${escHtml(f.field_key)})</span></td>
        <td>${escHtml(f.fixed_value)}</td>
        <td><button class="btn" style="padding:2px 9px; font-size:11px;">Clear</button></td>
      `;
      tr.querySelector('button').addEventListener('click', () => clearFixedFieldValue(f.field_key));
      tbody.appendChild(tr);
    }
  }
  if (empty) empty.style.display = fixed.length ? 'none' : '';
}

async function setFixedFieldValue() {
  if (!selectedTemplate) return;
  const select = document.getElementById('tpl-map-field-select');
  const input  = document.getElementById('tpl-fixed-value-input');
  const msg    = document.getElementById('tpl-fixed-msg');
  const fieldKey = select?.value;
  const value    = (input?.value || '').trim();
  if (!fieldKey) return;
  try {
    const res = await api.setTemplateFieldFixed(selectedTemplate.id, fieldKey, value);
    if (res?.success && res.template) {
      selectedTemplate = res.template;
      await renderFixedFieldsTable(res.template);
      if (msg) { msg.style.display = ''; msg.textContent = value
        ? `Fixed value set for "${fieldKey}".`
        : `Fixed value cleared for "${fieldKey}".`; }
    } else if (msg) {
      msg.style.display = ''; msg.textContent = res?.error || 'Could not set fixed value.';
    }
  } catch (e) {
    if (msg) { msg.style.display = ''; msg.textContent = 'Error: ' + e.message; }
  }
}

async function clearFixedFieldValue(fieldKey) {
  if (!selectedTemplate) return;
  try {
    const res = await api.setTemplateFieldFixed(selectedTemplate.id, fieldKey, '');
    if (res?.success && res.template) {
      selectedTemplate = res.template;
      await renderFixedFieldsTable(res.template);
      syncFixedInput();
    }
  } catch (e) {
    console.warn('clearFixedFieldValue failed:', e.message);
  }
}

document.getElementById('tpl-fixed-set-btn')?.addEventListener('click', setFixedFieldValue);

function renderSelectorAnchorsTable(detail) {
  const tbody  = document.getElementById('tpl-fields-tbody');
  const fields = detail.fields || [];
  tbody.innerHTML = '';

  if (!fields.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="section-desc">No selector anchors recorded for this template.</td></tr>';
    return;
  }
  for (const f of fields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="field-key">${escHtml(f.field_key)}</span></td>
      <td>${escHtml(f.anchor_label || '—')}</td>
      <td>${escHtml(f.direction)}</td>
      <td>${f.is_variable ? 'Yes' : 'No (fixed)'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LEARNING RECOVERY TAB
// ══════════════════════════════════════════════════════════════════════════════
// Read-only inspection + small targeted cleanup for the automatic-learning
// corpora (field anchors, supplier hints, corrections, logo fingerprints),
// scoped to a supplier name and optional document type. Managed templates are
// shown for context only — clearing here never touches the templates table.

let lrCurrentScope = null;

async function populateLearningDocTypes() {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (learning recovery) failed:', e.message); }
  }
  const select = document.getElementById('lr-doctype');
  for (const dt of allTypesWithFields) {
    const opt = document.createElement('option');
    opt.value = dt.slug;
    opt.textContent = dt.name;
    select.appendChild(opt);
  }
}

// "Suppliers handled automatically" — the graduation master switch + roster + per-supplier
// opt-outs (Slice 5 UX). Anti-black-box: the user can always SEE which suppliers auto-file and
// turn any (or all) off. Reads the shared trust predicate's roster via the /learning tab IPCs.
async function loadGraduationRoster() {
  const master = document.getElementById('grad-master');
  const roster = document.getElementById('grad-roster');
  if (!master || !roster) return;
  try { master.checked = (await api.getSetting('supplier_graduation_enabled')) !== 'false'; } catch {}
  master.onchange = async () => {
    try { await api.setSetting('supplier_graduation_enabled', master.checked ? 'true' : 'false'); } catch {}
    loadGraduationRoster();
  };
  if (!master.checked) { roster.innerHTML = '<em>Auto-filing from learned suppliers is off.</em>'; return; }
  let scopes = [];
  try { scopes = ((await api.getGraduatedSuppliers()) || {}).scopes || []; } catch {}
  if (!scopes.length) {
    roster.innerHTML = '<em>No suppliers have graduated yet — Scan Finder is still learning. Keep confirming and they’ll appear here.</em>';
    return;
  }
  roster.innerHTML = '';
  for (const s of scopes) {
    const row = document.createElement('label');
    row.className = 'row-flex';
    row.style.cssText = 'gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border); cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !s.opted_out;   // checked = auto-filing ON for this supplier
    cb.onchange = async () => {
      try { await api.setGraduationOptout({ supplier: s.supplier, slug: s.slug, optedOut: !cb.checked }); } catch {}
    };
    const txt = document.createElement('span');
    const strong = document.createElement('strong'); strong.textContent = s.supplier;
    txt.appendChild(strong);
    txt.appendChild(document.createTextNode(` · ${s.doctype || s.slug} `));
    const muted = document.createElement('span');
    muted.style.color = 'var(--muted)';
    muted.textContent = `(${s.confirmed_count} confirmed)`;
    txt.appendChild(muted);
    row.appendChild(cb); row.appendChild(txt);
    roster.appendChild(row);
  }
}

async function loadMemoryInventory() {
  const tbody = document.getElementById('lr-inventory-tbody');
  if (!tbody) return;
  let rows = [];
  try { rows = await api.getMemoryInventory(); }
  catch (e) { console.warn('getMemoryInventory failed:', e.message); return; }

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="section-desc">No learned memory recorded yet.</td></tr>';
    return;
  }
  const TYPE_LABEL = { hint: 'Supplier hint', anchor: 'Field anchor', correction: 'Correction', logo: 'Logo fingerprint', rule: 'Field cleanup rule' };
  for (const r of rows) {
    const parts = [r.supplier_name || '—'];
    if (r.document_type) parts.push(r.document_type);
    if (r.field_key) parts.push(r.field_key);
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><span class="field-key">${escHtml(parts.join(' · '))}</span></td>` +
      `<td>${escHtml(TYPE_LABEL[r.type] || r.type)}</td>` +
      `<td>${r.records}</td>` +
      `<td>${r.distinct_values == null ? '—' : r.distinct_values}</td>` +
      `<td>${escHtml(r.last_seen || '—')}</td>`;
    tbody.appendChild(tr);
  }
}

function renderLearningSummary(summary) {
  document.getElementById('lr-summary').textContent =
    `Field anchors: ${summary.anchors}    ·    Supplier hints: ${summary.hints}    ·    ` +
    `Corrections: ${summary.corrections}    ·    Logo fingerprints: ${summary.logos}` +
    (summary.rules != null ? `    ·    Field rules: ${summary.rules}` : '');
}

function renderLearningTemplates(rows, allTemplates) {
  const el = document.getElementById('lr-templates');
  el.innerHTML = '';
  if (!rows.length) { el.textContent = 'No managed templates match this name.'; return; }

  for (const t of rows) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:4px 0;';

    // Identity-less templates (no logo_phash) can never be MATCHED — they are
    // orphans to merge into the matched template (or regenerate identity for).
    // searchByName returns a thin projection, so read logo_phash from the full
    // getAll list (allTemplates) by id.
    const full = (allTemplates || []).find(o => o.id === t.id);
    const noIdentity = full && !full.logo_phash;
    const label = document.createElement('span');
    label.style.flex = '1 1 220px';
    label.innerHTML = `${escHtml(t.name)} <span class="field-key">(${escHtml(t.document_type_slug || '—')}, confirmed ${t.confirmed_count}×)</span>`
      + (noIdentity ? ` <span class="field-key" style="color:var(--warn)" title="No logo fingerprint — this template can't be matched. Merge it into the matched template, or pin/regenerate a sample to seed its identity.">⚠ unmatchable</span>` : '');
    row.appendChild(label);

    // Reassign target — every OTHER template (full list, not just the search
    // results, since the correct target usually has a different name).
    const sel = document.createElement('select');
    sel.className = 'field-select';
    sel.style.cssText = 'width:200px;';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Reassign / merge to…';
    sel.appendChild(ph);
    for (const o of (allTemplates || [])) {
      if (o.id === t.id) continue;
      const opt = document.createElement('option');
      opt.value = String(o.id);
      opt.textContent = o.name;
      sel.appendChild(opt);
    }
    row.appendChild(sel);

    const btnReassign = document.createElement('button');
    btnReassign.className = 'btn';
    btnReassign.textContent = 'Reassign';
    btnReassign.addEventListener('click', async () => {
      const toId = Number(sel.value);
      if (!toId) return;
      const toName = sel.options[sel.selectedIndex].textContent;
      if (!confirm(`Reassign all documents from "${t.name}" to "${toName}"?\n\nDocuments are only relinked (reversible) — no extraction data, hints, or anchors are deleted.`)) return;
      const r = await api.reassignTemplateDocuments(t.id, toId);
      document.getElementById('lr-msg').textContent =
        `Reassigned ${r.moved} document(s): "${t.name}" → "${toName}"${r.sampleAdopted ? ' (sample adopted by target)' : ''}.`;
      await runLearningSearch();
    });
    row.appendChild(btnReassign);

    // Merge: fold this template INTO the selected target and delete it
    // (irreversible — folds mappings/fields/landmarks/sample/identity the target
    // lacks, moves doc links, then removes this row). The cure for fragmentation.
    const btnMerge = document.createElement('button');
    btnMerge.className = 'btn';
    btnMerge.textContent = 'Merge into…';
    btnMerge.addEventListener('click', async () => {
      const toId = Number(sel.value);
      if (!toId) return;
      const toName = sel.options[sel.selectedIndex].textContent;
      if (!confirm(`Merge "${t.name}" INTO "${toName}" and DELETE "${t.name}"?\n\n`
        + `"${toName}" keeps its own data and GAINS anything it lacks (field mappings, `
        + `landmarks, sample, identity) plus all of "${t.name}"'s documents.\n\n`
        + `This is NOT reversible (unlike Reassign).`)) return;
      const r = await api.mergeTemplate(t.id, toId);
      document.getElementById('lr-msg').textContent = (r && r.ok)
        ? `Merged "${t.name}" → "${toName}": ${r.movedDocs} doc(s), +${r.mappingsAdded} mapping(s)`
          + `${r.landmarksAdopted ? ', landmarks adopted' : ''}${r.sampleAdopted ? ', sample adopted' : ''}.`
        : `Merge failed${r && r.reason ? ' — ' + r.reason : ''}.`;
      await runLearningSearch();
    });
    row.appendChild(btnMerge);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', async () => {
      if (!confirm(`Delete template "${t.name}"?\n\nLinked documents are unlinked (set to no template); their extractions and learned data are kept. This cannot be undone — reassign first if these documents belong to another template.`)) return;
      await api.deleteTemplate(t.id);
      document.getElementById('lr-msg').textContent = `Deleted template "${t.name}".`;
      await runLearningSearch();
    });
    row.appendChild(btnDelete);

    el.appendChild(row);
  }
}

function renderLearningDetail(detail) {
  const lines = [];

  if (detail.anchors.length) {
    lines.push('<div class="section-title" style="margin-top:0;">Field Anchors</div>');
    for (const a of detail.anchors) {
      lines.push(`<div>${escHtml(a.field_key)} — "${escHtml(a.anchor_label)}" (${escHtml(a.direction)}), ` +
        `type: ${escHtml(a.document_type || '—')}, used ${a.usage_count}×, conf ${(a.confidence ?? 0).toFixed(2)}, last ${escHtml(a.last_seen)}</div>`);
    }
  }
  if (detail.hints.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Supplier Hints</div>');
    for (const h of detail.hints) {
      lines.push(`<div>${escHtml(h.field_key)} = "${escHtml(h.hint_value)}", type: ${escHtml(h.document_type || '—')}, used ${h.usage_count}×, last ${escHtml(h.last_seen)}</div>`);
    }
  }
  if (detail.corrections.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Corrections</div>');
    for (const c of detail.corrections) {
      lines.push(`<div>${escHtml(c.field_key)}: "${escHtml(c.original_value || '')}" → "${escHtml(c.corrected_value)}", type: ${escHtml(c.document_type || '—')}, ${escHtml(c.corrected_at)}</div>`);
    }
  }
  if (detail.logos.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Logo Fingerprints</div>');
    for (const l of detail.logos) {
      lines.push(`<div>${escHtml(l.phash)}, matched ${l.match_count}×, last ${escHtml(l.last_seen)}</div>`);
    }
  }
  if ((detail.rules || []).length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Field Cleanup Rules</div>');
    for (const r of detail.rules) {
      const what = r.rule_type === 'keep_block'
        ? 'keep only the main value'
        : `remove "${escHtml(r.created_from || r.token_norm || '')}" (${escHtml(r.side || 'trailing')})`;
      lines.push(`<div>${escHtml(r.field_key)} — ${what}, type: ${escHtml(r.document_type || '—')}, used ${r.usage_count || 0}×, ${escHtml(r.created_at || '')}</div>`);
    }
  }

  document.getElementById('lr-detail').innerHTML = lines.length ? lines.join('') : '<div>No detail rows.</div>';
}

async function runLearningSearch() {
  const supplier_name = document.getElementById('lr-supplier').value.trim();
  const document_type = document.getElementById('lr-doctype').value || null;
  const resultsEl = document.getElementById('lr-results');
  const emptyEl   = document.getElementById('lr-empty');
  document.getElementById('lr-msg').textContent = '';

  if (!supplier_name) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'none';
    lrCurrentScope = null;
    return;
  }

  let data;
  try {
    data = await api.getLearningRecovery({ supplier_name, document_type });
  } catch (e) {
    console.warn('getLearningRecovery failed:', e.message);
    return;
  }

  lrCurrentScope = { supplier_name, document_type };

  const s = data?.summary;
  const hasData = s && (s.anchors || s.hints || s.corrections || s.logos || data.templates.length);

  if (!hasData) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';
  resultsEl.style.display = '';
  let allTemplates = [];
  try { allTemplates = await api.getTemplates(); } catch (e) { console.warn('getTemplates (reassign list) failed:', e.message); }
  renderLearningSummary(s);
  renderLearningTemplates(data.templates, allTemplates);
  renderLearningDetail(data.detail);

  // The results section (with the per-scope clear options) was hidden until now and
  // renders below the fold — jump to it so the user can see the newly-available
  // options. block:'end' keeps the action buttons in view. Deferred to next frame so
  // the just-shown section has laid out before we scroll.
  requestAnimationFrame(() => {
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

// ── Learning Repair tab ─────────────────────────────────────────────────────────
let _rpWired = false, _rpDocs = [], _rpSuspects = {}, _rpFilter = 'all', _rpSel = null, _rpPages = [], _rpPage = 0, _rpDismissed = new Set();
function _rpEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Preview zoom/pan — scroll-wheel to zoom, right-mouse-button drag to pan (no grab cursor),
// mirroring the Review window's preview. Left-drag is untouched.
let _rpZoom = 1, _rpPanX = 0, _rpPanY = 0, _rpPanStart = null;
const RP_ZOOM_MIN = 1, RP_ZOOM_MAX = 4, RP_ZOOM_STEP = 0.25;
function rpApplyView() {
  const img = document.getElementById('rp-img');
  if (img) img.style.transform = `translate(${_rpPanX}px, ${_rpPanY}px) scale(${_rpZoom})`;
}
function rpResetView() { _rpZoom = 1; _rpPanX = 0; _rpPanY = 0; rpApplyView(); }
function rpWirePreviewZoom() {
  const area = document.getElementById('rp-img-area');
  const img = document.getElementById('rp-img');
  if (!area || !img) return;
  img.style.transformOrigin = 'center center';
  img.setAttribute('draggable', 'false');
  area.addEventListener('contextmenu', (e) => { if (_rpPages.length) e.preventDefault(); });
  area.addEventListener('dragstart', (e) => e.preventDefault());
  area.addEventListener('wheel', (e) => {
    if (!_rpPages.length) return;
    e.preventDefault();
    _rpZoom = Math.max(RP_ZOOM_MIN, Math.min(RP_ZOOM_MAX, _rpZoom + (e.deltaY < 0 ? RP_ZOOM_STEP : -RP_ZOOM_STEP)));
    if (_rpZoom === 1) { _rpPanX = 0; _rpPanY = 0; }   // snap back to centred when fully zoomed out
    rpApplyView();
  }, { passive: false });
  area.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || !_rpPages.length) return;    // right button only
    _rpPanStart = { x: e.clientX, y: e.clientY, panX: _rpPanX, panY: _rpPanY };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!_rpPanStart) return;
    _rpPanX = _rpPanStart.panX + (e.clientX - _rpPanStart.x);
    _rpPanY = _rpPanStart.panY + (e.clientY - _rpPanStart.y);
    rpApplyView();
  });
  window.addEventListener('mouseup', () => { _rpPanStart = null; });
}

async function repairInit() {
  const sel = document.getElementById('rp-doctype');
  if (!sel) return;
  let types = [];
  try { types = (await api.getAllDocTypesAll()) || []; } catch {}
  const prev = sel.value;
  sel.innerHTML = types.map(t => `<option value="${_rpEsc(t.slug)}">${_rpEsc(t.name)}</option>`).join('');
  if (prev && types.some(t => t.slug === prev)) sel.value = prev;
  if (_rpWired) return;
  _rpWired = true;
  document.getElementById('rp-load').addEventListener('click', rpLoad);
  document.getElementById('rp-page-prev').addEventListener('click', () => rpShowPage(_rpPage - 1));
  document.getElementById('rp-page-next').addEventListener('click', () => rpShowPage(_rpPage + 1));
  rpWirePreviewZoom();
  document.getElementById('rp-send').addEventListener('click', rpSend);
  document.getElementById('rp-delete').addEventListener('click', rpDelete);
  document.getElementById('rp-fine').addEventListener('click', rpDismiss);
  document.getElementById('rp-forget').addEventListener('click', rpForget);
  document.querySelectorAll('#rp-filters .rp-chip').forEach(b => b.addEventListener('click', () => {
    _rpFilter = b.dataset.filter;
    document.querySelectorAll('#rp-filters .rp-chip').forEach(x => x.classList.toggle('active', x === b));
    rpRenderList();
  }));
  document.getElementById('rp-doclist').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = rpFiltered(); if (!list.length) return;
    let i = _rpSel ? list.findIndex(d => d.id === _rpSel) : -1;
    i = Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    rpSelect(list[i].id);
    const row = document.querySelector(`#rp-doclist .rp-row[data-id="${list[i].id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  });
}

async function rpLoad() {
  const slug = document.getElementById('rp-doctype').value;
  const supplier = document.getElementById('rp-supplier').value.trim();
  if (!slug) return;
  let ov = null;
  try { ov = await api.repairOverview({ document_type_slug: slug, supplier_name: supplier || null }); }
  catch (e) { alert('Could not load: ' + (e.message || e)); return; }
  if (!ov || ov.error) { alert(ov && ov.error || 'Could not load.'); return; }
  _rpDocs = ov.documents || [];
  _rpSuspects = (ov.suspects && ov.suspects.byId) || {};
  _rpDismissed = new Set(); _rpSel = null; _rpPages = []; _rpPage = 0; _rpFilter = 'all';
  document.querySelectorAll('#rp-filters .rp-chip').forEach(x => x.classList.toggle('active', x.dataset.filter === 'all'));
  document.getElementById('rp-count').textContent = `Learned from ${_rpDocs.length} document(s)`;
  document.getElementById('rp-worklist').style.display = _rpDocs.length ? '' : 'none';
  document.getElementById('rp-advanced-wrap').style.display = _rpDocs.length ? '' : 'none';
  document.getElementById('rp-preview').style.display = 'none';
  document.getElementById('rp-preview-empty').style.display = '';
  document.getElementById('rp-preview-empty').textContent = 'Select a document on the left, or click the list and use ↑/↓ to move through them.';
  rpRenderSuspectStrip();
  rpRenderList();
}

function rpSuspectKinds(id) { const s = _rpSuspects[id]; if (!s || _rpDismissed.has(id)) return new Set(); return new Set((s.reasons || []).map(r => r.kind)); }
function rpFiltered() { return _rpFilter === 'all' ? _rpDocs : _rpDocs.filter(d => rpSuspectKinds(d.id).has(_rpFilter)); }

function rpRenderSuspectStrip() {
  const ids = Object.keys(_rpSuspects).map(Number).filter(id => !_rpDismissed.has(id) && _rpDocs.some(d => d.id === id));
  const strip = document.getElementById('rp-suspects-strip');
  if (!ids.length) { strip.style.display = 'none'; return; }
  strip.style.display = '';
  document.getElementById('rp-suspects-list').innerHTML = ids.slice(0, 12).map(id => {
    const d = _rpDocs.find(x => x.id === id); if (!d) return '';
    const reason = (_rpSuspects[id].reasons || [])[0] || {};
    const chip = reason.kind === 'belong' ? '<span style="color:var(--accent2);">Might not belong</span>' : '<span style="color:var(--warn);">Data looks off</span>';
    return `<div class="rp-suspect" data-id="${id}" style="cursor:pointer; padding:3px 2px;">• ${chip} — <span style="font-family:var(--mono);">${_rpEsc(d.original_filename)}</span> <span style="color:var(--muted);">${_rpEsc(reason.text || '')}</span></div>`;
  }).join('');
  document.querySelectorAll('#rp-suspects-list .rp-suspect').forEach(el => el.addEventListener('click', () => rpSelect(Number(el.dataset.id))));
}

// Repair docs are all confirmed — resolve the FILED copy (stored_path/stored_filename),
// falling back to the source. Mirrors tplFileArgs / search's fileArgs so the preview +
// thumbnail render the real file instead of relying on a relative-path recovery.
function rpFileArgs(doc) {
  if (doc && doc.stored_path && doc.stored_filename) {
    const lastSep = Math.max(doc.stored_path.lastIndexOf('\\'), doc.stored_path.lastIndexOf('/'));
    return { folderPath: doc.stored_path.substring(0, lastSep), filename: doc.stored_filename };
  }
  return { folderPath: (doc && doc.folder_path) || '', filename: (doc && doc.original_filename) || '' };
}

function rpRenderList() {
  const list = rpFiltered();
  const el = document.getElementById('rp-doclist');
  el.innerHTML = list.length ? list.map(d => {
    const kinds = rpSuspectKinds(d.id);
    const tag = kinds.has('belong') ? '<span style="color:var(--accent2); font-size:10px;">◆ different</span>'
              : kinds.has('data') ? '<span style="color:var(--warn); font-size:10px;">⚠ data</span>' : '';
    const meta = [d.supplier_name, d.reference_number, d.doc_date].filter(Boolean).join(' · ');
    return `<div class="doctype-row rp-row${d.id === _rpSel ? ' active' : ''}" data-id="${d.id}" style="cursor:pointer; align-items:center; gap:8px;">
      <img class="rp-thumb" data-id="${d.id}" alt="" style="width:32px;height:42px;object-fit:cover;border-radius:4px;flex-shrink:0;background:var(--surface3);">
      <div style="flex:1; min-width:0;"><div style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_rpEsc(d.original_filename)}</div><div style="font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_rpEsc(meta)} ${tag}</div></div>
    </div>`;
  }).join('') : '<div class="section-desc" style="padding:16px; text-align:center;">No documents in this view.</div>';
  el.querySelectorAll('.rp-row').forEach(r => r.addEventListener('click', () => rpSelect(Number(r.dataset.id))));
  if (window.Thumbs) el.querySelectorAll('.rp-thumb').forEach(img => { const d = _rpDocs.find(x => x.id === Number(img.dataset.id)); if (d) { const fa = rpFileArgs(d); window.Thumbs.lazy(img, { id: d.id, folder_path: fa.folderPath, original_filename: fa.filename }); } });
}

async function rpSelect(id) {
  const doc = _rpDocs.find(d => d.id === id); if (!doc) return;
  _rpSel = id;
  rpResetView();   // start each document at fit (100%), centred
  document.querySelectorAll('#rp-doclist .rp-row').forEach(r => r.classList.toggle('active', Number(r.dataset.id) === id));
  document.getElementById('rp-preview-empty').style.display = 'none';
  document.getElementById('rp-preview').style.display = '';
  document.getElementById('rp-action-msg').textContent = '';
  document.getElementById('rp-fine').style.display = rpSuspectKinds(id).size ? '' : 'none';
  rpRenderFields(id);
  document.getElementById('rp-img-loading').style.display = ''; document.getElementById('rp-img-loading').textContent = 'Loading…';
  document.getElementById('rp-img').style.display = 'none';
  _rpPages = []; _rpPage = 0;
  let pages = [];
  { const fa = rpFileArgs(doc); try { pages = await api.getDocumentPages(id, fa.folderPath, fa.filename) || []; } catch { pages = []; } }
  if (_rpSel !== id) return;   // selection moved while loading
  _rpPages = pages;
  if (pages.length) rpShowPage(0);
  else { document.getElementById('rp-img-loading').textContent = 'Preview unavailable for this document.'; }
}

function rpShowPage(idx) {
  if (!_rpPages.length) return;
  _rpPage = Math.max(0, Math.min(_rpPages.length - 1, idx));
  const img = document.getElementById('rp-img');
  img.src = _rpPages[_rpPage]; img.style.display = '';
  document.getElementById('rp-img-loading').style.display = 'none';
  document.getElementById('rp-page-label').textContent = `${_rpPage + 1} / ${_rpPages.length}`;
}

async function rpRenderFields(id) {
  const el = document.getElementById('rp-fields');
  const reasons = (_rpSuspects[id] && _rpSuspects[id].reasons) || [];
  const docReasons = reasons.filter(r => r.kind === 'belong');
  const fieldReason = {};
  for (const r of reasons) if (r.field) fieldReason[r.field] = r;

  // Top box: whole-document "might not belong" reasons (if any).
  let top = '';
  if (docReasons.length) {
    top = '<div style="border:1px solid var(--accent2); border-radius:8px; padding:8px 10px; background:var(--surface2); margin-bottom:8px;">' +
      docReasons.map(r => `<div>◆ ${_rpEsc(r.text)}</div>`).join('') + '</div>';
  }
  el.innerHTML = top + '<div class="section-desc" style="margin:0;">Loading fields…</div>';

  // Confirmed values (correction wins over the raw OCR read), so a superseded misread like
  // "St" shows as the confirmed "152888" — agreeing with the suspect reason.
  let res = null;
  try { res = await api.repairDocFields(id); } catch { res = null; }
  if (_rpSel !== id) return;   // selection moved while loading

  const exs = (res && Array.isArray(res.fields)) ? res.fields.filter(e => e.value) : [];
  const titleCase = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  let body = '';
  if (exs.length) {
    body = '<div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">';
    for (const e of exs) {
      const fr = fieldReason[e.field_key];
      body += `<div style="display:flex; gap:8px; padding:5px 10px; ${fr ? 'background:var(--surface2);' : ''} border-bottom:1px solid var(--border);">` +
        `<span style="color:var(--muted); min-width:130px; flex-shrink:0;">${_rpEsc(titleCase(e.field_key))}</span>` +
        `<span style="flex:1; ${fr ? 'color:var(--warn); font-weight:600;' : ''}">${_rpEsc(e.value)}${fr ? ' ⚠' : ''}</span></div>`;
      if (fr) body += `<div style="padding:2px 10px 6px 138px; font-size:11px; color:var(--warn); border-bottom:1px solid var(--border);">${_rpEsc(fr.text)}</div>`;
    }
    body += '</div>';
  } else if (!docReasons.length) {
    body = '<div class="section-desc" style="margin:0;">Nothing looks off with this document — it matches the others.</div>';
  } else {
    body = '<div class="section-desc" style="margin:0;">No extracted field values recorded for this document.</div>';
  }
  el.innerHTML = top + body;
}

function rpRemoveCurrent(msg) {
  _rpDocs = _rpDocs.filter(d => d.id !== _rpSel);
  delete _rpSuspects[_rpSel];
  _rpSel = null;
  document.getElementById('rp-count').textContent = `Learned from ${_rpDocs.length} document(s)`;
  rpRenderSuspectStrip(); rpRenderList();
  document.getElementById('rp-preview').style.display = 'none';
  document.getElementById('rp-preview-empty').style.display = '';
  document.getElementById('rp-preview-empty').textContent = msg + ' Pick another document to continue.';
}

async function rpSend() {
  if (!_rpSel) return;
  const doc = _rpDocs.find(d => d.id === _rpSel);
  if (!confirm(`Send “${doc.original_filename}” back to Review?\n\nThis just moves it to your Review list — nothing is deleted. If it was fine, confirm it there and it goes right back to where it was.`)) return;
  // Thread the SUSPECT context so the un-plant can flag the exact field(s) that brought the
  // operator here — the doc returns to Review visibly suspect (note + flag + File-All-Ready
  // exclusion) instead of clean-looking (the rubber-stamp gap). Empty reasons ⇒ the service
  // stamps its generic doc-level note.
  const _reasons = (_rpSuspects[_rpSel] && _rpSuspects[_rpSel].reasons) || [];
  const suspects = _reasons.map(rr => ({ field: rr.field || null, note: String(rr.text || rr.kind || '') }));
  let r = null;
  try { r = await api.repairDeconfirm(_rpSel, { suspects }); } catch (e) { alert('Failed: ' + (e.message || e)); return; }
  if (!r || !r.ok) { document.getElementById('rp-action-msg').textContent = (r && r.error) || 'Could not send this document back (it may be locked by an approval route).'; return; }
  rpRemoveCurrent('Sent back to Review.');
}

async function rpDelete() {
  if (!_rpSel) return;
  const doc = _rpDocs.find(d => d.id === _rpSel);
  if (!confirm(`Delete “${doc.original_filename}”?\n\nIt goes to the recycle bin (recoverable) and stops teaching this type.`)) return;
  let r = null;
  try { r = await api.repairDelete(_rpSel); } catch (e) { alert('Failed: ' + (e.message || e)); return; }
  if (!r || !r.ok) { document.getElementById('rp-action-msg').textContent = 'Could not delete this document.'; return; }
  rpRemoveCurrent('Moved to the recycle bin.');
}

function rpDismiss() {
  if (!_rpSel) return;
  _rpDismissed.add(_rpSel);
  document.getElementById('rp-fine').style.display = 'none';
  document.getElementById('rp-action-msg').textContent = 'Dismissed — this one won’t be flagged again for now.';
  rpRenderFields(_rpSel); rpRenderSuspectStrip(); rpRenderList();
}

async function rpForget() {
  const slug = document.getElementById('rp-doctype').value;
  const supplier = document.getElementById('rp-supplier').value.trim();
  if (!confirm(`Forget everything Scan Finder has learned for this type${supplier ? ` from “${supplier}”` : ''}?\n\nA backup is taken first; the documents you keep will teach it again on the next reprocess.`)) return;
  let r = null;
  try { r = await api.recoveryApply({ document_type_slug: slug, supplier_name: supplier || null, forgetLearning: true }); }
  catch (e) { alert('Failed: ' + (e.message || e)); return; }
  const s = (r && r.summary) || {};
  document.getElementById('rp-forget-msg').textContent = (r && r.ok)
    ? `Forgot ${s.anchors || 0} field position(s), ${s.hints || 0} hint(s), ${s.fieldRules || 0} rule(s).${r.backup ? ' Backup saved.' : ''} Reprocess this type's documents to relearn.`
    : ((r && r.error) || 'Could not forget the learning.');
}

document.getElementById('lr-inv-refresh').addEventListener('click', loadMemoryInventory);

document.getElementById('lr-btn-reset-all').addEventListener('click', async () => {
  const devMsg = document.getElementById('lr-dev-msg');
  const confirmed = await showTypedConfirmDialog({
    title: 'Clear ALL learning memory — developer reset',
    warningHtml:
      'This permanently deletes <strong style="color:var(--text);">all</strong> learning memory: ' +
      'supplier hints, field anchors, logo fingerprints, corrections, and every managed template ' +
      '(fields and mappings included). Documents remain but lose their template link; core settings ' +
      'are untouched. This cannot be undone.',
    requiredText: 'CLEAR ALL LEARNING',
    confirmLabel: 'Wipe learning memory',
  });
  if (!confirmed) return;
  try {
    const c = await api.resetAllLearning();
    devMsg.style.color = 'var(--muted)';
    devMsg.textContent =
      `Cleared — hints ${c.supplier_hints}, anchors ${c.field_anchors}, logos ${c.logo_fingerprints}, ` +
      `corrections ${c.corrections}, templates ${c.templates} (mappings ${c.template_field_mappings}, ` +
      `groups ${c.template_groups}); ${c.documents_unlinked} document link(s) cleared.`;
    await loadMemoryInventory();
    await runLearningSearch();
  } catch (e) {
    devMsg.style.color = 'var(--err)';
    devMsg.textContent = 'Reset failed: ' + e.message;
  }
});

// Dev-only "Erase ALL data → fresh install" (superset of the learning wipe above).
// The block is hidden in packaged builds and revealed only when the main process
// reports dev mode (app-is-dev). The backend handler stays admin-gated regardless.
(async () => {
  try {
    if (await api.appIsDev()) {
      const block = document.getElementById('lr-fresh-install-block');
      if (block) block.style.display = '';
    }
  } catch { /* fail safe: leave the dev-only control hidden */ }
})();

document.getElementById('lr-btn-fresh-install').addEventListener('click', async () => {
  const msg = document.getElementById('lr-fresh-msg');
  const confirmed = await showTypedConfirmDialog({
    title: 'Erase ALL data — revert to a fresh install',
    warningHtml:
      'This <strong style="color:var(--text);">erases all custom data</strong> and reverts to a fresh ' +
      'install: every bit of learning memory AND the custom schema (document types, fields, mappings), ' +
      'and it strips learned identity off your documents. Your files are kept. A timestamped database ' +
      'backup is taken first. This cannot be undone.',
    requiredText: 'ERASE ALL DATA',
    confirmLabel: 'Erase all data',
  });
  if (!confirmed) return;
  try {
    const res = await api.resetFreshInstall();
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Reverted to a fresh install.' +
      (res && res.backup ? ` Backup saved: ${res.backup}` : ' (database backup was not created)');
    await loadMemoryInventory();
    await runLearningSearch();
  } catch (e) {
    msg.style.color = 'var(--err)';
    msg.textContent = 'Erase failed: ' + e.message;
  }
});

document.getElementById('lr-btn-search').addEventListener('click', runLearningSearch);
document.getElementById('lr-supplier').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runLearningSearch();
});

document.getElementById('lr-btn-clear-anchors').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  if (!confirm(`Clear all field anchors learned for "${scopeLabel}"? This cannot be undone.`)) return;
  const result = await api.clearLearningAnchors(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} field anchor(s).`;
  await loadMemoryInventory();   // refresh the inventory counts, not just the scope search
  await runLearningSearch();
});

document.getElementById('lr-btn-clear-hints').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  if (!confirm(`Clear all supplier hints learned for "${scopeLabel}"? This cannot be undone.`)) return;
  const result = await api.clearLearningHints(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} supplier hint(s).`;
  await loadMemoryInventory();
  await runLearningSearch();
});

// ── Senders that look like duplicates (report-only) ──────────────────────────────────────────
// The B9 census as a screen. Every preventive fix in the teach-poisoning arc leaves a customer
// whose filing tree is ALREADY split with nothing telling them; this is what tells them. It never
// merges — picking a row only PREFILLS the audited rename below, which still has to be confirmed
// by typing the old name.
document.getElementById('lr-btn-find-duplicates')?.addEventListener('click', async () => {
  const msg  = document.getElementById('lr-dupe-msg');
  const host = document.getElementById('lr-dupe-list');
  msg.textContent = 'Checking…';
  host.innerHTML  = '';
  let pairs = [];
  try { pairs = await api.findDuplicateSuppliers(); }
  catch (e) { msg.textContent = 'Could not check: ' + e.message; return; }
  if (!pairs.length) {
    msg.textContent = 'No senders differ by only a character or two — nothing looks split.';
    return;
  }
  msg.textContent = `${pairs.length} pair${pairs.length === 1 ? '' : 's'} to look at.`;
  host.innerHTML = pairs.map((p, i) => {
    const scope = p.otherScope || {};
    const extra = [scope.supplier_hints ? `${scope.supplier_hints} hint(s)` : '',
                   scope.field_anchors ? `${scope.field_anchors} taught spot(s)` : '']
      .filter(Boolean).join(', ');
    return `<div class="row-flex" style="gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--border)">
      <div style="flex:1">
        <div><strong>${escHtml(p.likelyCorrect)}</strong> <span class="muted">— ${p.likelyCorrectDocs} document(s)</span></div>
        <div><strong>${escHtml(p.other)}</strong> <span class="muted">— ${p.otherDocs} document(s)${extra ? ', ' + escHtml(extra) : ''}</span></div>
        <div class="muted" style="font-size:11.5px">${p.distance === 1 ? 'one character' : p.distance + ' characters'} different</div>
      </div>
      <button class="btn" data-dupe-fix="${i}">Use "${escHtml(p.likelyCorrect)}"</button>
    </div>`;
  }).join('');
  host.querySelectorAll('[data-dupe-fix]').forEach(btn => btn.addEventListener('click', () => {
    const p = pairs[Number(btn.dataset.dupeFix)];
    // Prefill BOTH sides of the existing rename tool and hand the operator straight to it — the
    // rename itself stays exactly as audited and still demands the typed confirmation.
    document.getElementById('lr-supplier').value   = p.other;
    document.getElementById('lr-rename-new').value = p.likelyCorrect;
    document.getElementById('lr-btn-search')?.click();
    document.getElementById('lr-rename-new').scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.getElementById('lr-dupe-msg').textContent =
      `Ready: rename "${p.other}" to "${p.likelyCorrect}" below, if that is the right way round.`;
  }));
});

document.getElementById('lr-btn-rename-supplier').addEventListener('click', async () => {
  const msg = document.getElementById('lr-msg');
  if (!lrCurrentScope || !lrCurrentScope.supplier_name) {
    msg.textContent = 'Search a supplier first, then enter the corrected name.'; return;
  }
  const from = lrCurrentScope.supplier_name;
  const to   = document.getElementById('lr-rename-new').value.trim();
  if (!to)         { msg.textContent = 'Enter the corrected supplier name.'; return; }
  if (to === from) { msg.textContent = 'The corrected name is the same as the current name.'; return; }
  // Blast-radius preview so the operator sees what the rename touches before confirming.
  let counts = null;
  try { counts = await api.getSupplierScopeCounts(from); } catch {}
  const blast = counts
    ? `${counts.documents} document(s), ${counts.supplier_hints} hint(s), ${counts.field_anchors} anchor(s), `
      + `${counts.logo_fingerprints} logo(s), ${counts.corrections} correction(s)`
    : 'all learning rows';
  const confirmed = await showTypedConfirmDialog({
    title: 'Rename supplier everywhere',
    warningHtml:
      `Rename <strong style="color:var(--text);">${escHtml(from)}</strong> to ` +
      `<strong style="color:var(--text);">${escHtml(to)}</strong> across ${escHtml(blast)}. ` +
      `The stored Document Issuer value on those documents is updated too. Filed documents keep ` +
      `their files (folders are not moved). This cannot be automatically undone.`,
    requiredText: from,
    confirmLabel: 'Rename supplier',
  });
  if (!confirmed) return;
  try {
    const res = await api.renameSupplier({ oldName: from, newName: to });
    msg.textContent = res.renamed ? `Renamed "${from}" → "${to}".` : 'Nothing to rename.';
    document.getElementById('lr-rename-new').value = '';
    document.getElementById('lr-supplier').value = to;   // re-point the panel at the new name
    await loadMemoryInventory();
    await runLearningSearch();
  } catch (e) {
    msg.textContent = 'Rename failed: ' + e.message;
  }
});

document.getElementById('lr-btn-clear-field-rules').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  if (!confirm(`Clear all field cleanup rules learned for "${scopeLabel}"? This cannot be undone.`)) return;
  const result = await api.clearLearningFieldRules(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} field cleanup rule(s).`;
  await loadMemoryInventory();
  await runLearningSearch();
});

document.getElementById('lr-btn-clear-corrections').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  const confirmed = await showTypedConfirmDialog({
    title: 'Clear corrections — extreme-use recovery',
    warningHtml:
      `This permanently removes all confirmed correction history for ` +
      `<strong style="color:var(--text);">${escHtml(scopeLabel)}</strong>. ` +
      `Corrections are the audit trail behind format-anomaly learning and cannot be recovered. ` +
      `Use only when learning has become polluted and narrower cleanup has failed.`,
    requiredText: supplier_name,
    confirmLabel: 'Clear corrections',
  });
  if (!confirmed) return;
  const result = await api.clearLearningCorrections(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} correction(s).`;
  await loadMemoryInventory();
  await runLearningSearch();
});

populateLearningDocTypes();

// ── Init ──────────────────────────────────────────────────────────────────────
loadDocTypes().then(() => {
  if (allTypesWithFields.length) selectDocType(allTypesWithFields[0].id);
});
// A doc type created/changed elsewhere (e.g. the Teach wizard) — reload the list.
api.onDocTypesChanged?.(() => { loadDocTypes().catch(() => {}); });
loadUsers();
loadAuditLog();

// Open the editor on a specific template when launched from Review's "Add to
// Template Manager" — switch to the Templates tab and select it (loads its
// sample preview via the normal selectTemplate path). Handles both a fresh
// window (pull the target after the list loads) and an already-open one.
function openTemplateInEditor(id) {
  if (!id) return;
  const tab = document.querySelector('.tab[data-tab="templates"]');
  if (tab) tab.click();
  selectTemplate(id);
}
loadTemplates().then(async () => {
  try {
    const targetId = await api.getSettingsTemplateTarget();
    if (targetId) openTemplateInEditor(targetId);
  } catch (e) { console.warn('settings template target failed:', e.message); }
});
setupTemplateCleanups();   // M3 "Suggested cleanups" — wire the scan/merge/re-link buttons (idempotent)
api.onNavigateToTemplate(openTemplateInEditor);

// Section/tab deep-link (e.g. Home "Activate" → 'licensing'): click the matching tab. The target
// may be a bare section string, or { section, docTypeSlug } to ALSO open a specific document type
// in the editor (Review's "Edit type" shortcut lands on the type the operator had selected).
async function gotoSettingsSection(target) {
  if (!target) return;
  const section = typeof target === 'string' ? target : target.section;
  const docTypeSlug = (typeof target === 'object' && target) ? target.docTypeSlug : null;
  const tab = section && document.querySelector(`.tab[data-tab="${section}"]`);
  if (tab) tab.click();
  if (docTypeSlug) {
    if (!allTypesWithFields || !allTypesWithFields.length) {
      try { await refreshDocTypesList(); } catch {}
    }
    const t = (allTypesWithFields || []).find(x => x && x.slug === docTypeSlug);
    if (t) selectDocType(t.id);
  }
}
(async () => {
  try { await gotoSettingsSection(await api.getSettingsSectionTarget()); }
  catch (e) { console.warn('settings section target failed:', e.message); }
})();
api.onNavigateToSection?.(gotoSettingsSection);

// ══════════════════════════════════════════════════════════════════════════════
// LICENSING TAB  (admin-only — the whole Settings window is gated to
// hasRole('admin') in main.js). Read-only display of the licence currently in
// force on this device — no network call, no state change. The dev-only
// activation-test and enforcement-toggle tooling was removed for live
// deployment; enforcement is driven by the packaged build, with the
// DOCUSNAP_LICENSE_ENFORCEMENT env override left as the recovery hatch.
// ══════════════════════════════════════════════════════════════════════════════
const licStatusEl   = document.getElementById('lic-status');
const licRefreshBtn = document.getElementById('lic-refresh');

const COLOR = { ok: 'var(--ok)', err: 'var(--err)', warn: 'var(--warn)', muted: 'var(--muted)' };
function colorSpan(cls, text) {
  return `<span style="color:${COLOR[cls] || 'var(--text)'}">${escHtml(String(text))}</span>`;
}

// Show only what pertains to the CURRENT licence: kind, state, time left, seats.
// No cached/valid licence → one clear line, matching the wording used on the
// activation screen so the two never disagree.
function renderLicenseStatus(s) {
  const t = (s && s.token) || {};
  if (!s || !t.hasToken || t.state === 'invalid' || t.state === 'unknown') {
    licStatusEl.innerHTML = colorSpan('warn', 'No valid license found.');
    return;
  }
  const lines = [];
  const kind = t.kind === 'seat' ? 'Paid licence' : (t.kind === 'trial' ? 'Trial' : (t.kind || 'Licence'));
  let lic = `${escHtml(String(kind))} — ` + colorSpan(t.state === 'active' ? 'ok' : 'err', t.state);
  if (t.days_remaining != null) lic += ` · ${escHtml(String(t.days_remaining))} day(s) remaining`;
  if (t.entitlement_end) lic += ` · ends ${escHtml(String(t.entitlement_end))}`;
  lines.push(lic);
  if (t.kind === 'seat' && t.seats_total != null) {
    lines.push(`Seats — ${t.seats_used != null ? escHtml(String(t.seats_used)) : '?'} / ${escHtml(String(t.seats_total))} in use`);
  }
  licStatusEl.innerHTML = lines.join('<br>');
}

async function loadLicenseStatus() {
  if (!licStatusEl) return;
  licStatusEl.textContent = 'Loading…';
  try {
    const s = await api.licenseGetDiagnostics();
    renderLicenseStatus(s);
    await applyLicenseMode(s);
  } catch (e) {
    licStatusEl.innerHTML = colorSpan('err', 'Could not read licence status: ' + (e.message || 'error'));
  }
}

// Registered vs unregistered presentation. With an ACTIVE PAID SEAT we show the registered
// device name + masked activation key and COLLAPSE the entry form (a "Activate a different
// key…" button re-opens it to add new entitlements / re-key). Trial/none → show the form.
async function applyLicenseMode(s) {
  const t = (s && s.token) || {};
  const licensed = !!(t.hasToken && t.kind === 'seat' && t.state === 'active');
  // Status pill in the License card header.
  if (t.hasToken && t.state === 'active') setChip('lic-chip', t.kind === 'trial' ? 'Trial' : 'Active', t.kind === 'trial' ? 'warn' : 'ok');
  else if (t.hasToken && t.state === 'grace') setChip('lic-chip', 'Grace period', 'warn');
  else setChip('lic-chip', 'Not activated', 'err');
  const reg     = document.getElementById('lic-registered');
  const actSec  = document.getElementById('lic-activate-section');
  const showBtn = document.getElementById('lic-show-activate');
  if (licensed) {
    try {
      const dev = await api.getSetting('license_device_label');
      const key = await api.getSetting('license_key_masked');
      const dEl = document.getElementById('lic-device'); if (dEl) dEl.textContent = dev || 'This device';
      const kEl = document.getElementById('lic-key');    if (kEl) kEl.textContent = key || '— (re-activate to record)';
    } catch { /* settings unavailable */ }
    if (reg) reg.style.display = '';
    if (actSec) actSec.style.display = 'none';   // collapse the entry form
    if (showBtn) showBtn.style.display = '';
  } else {
    if (reg) reg.style.display = 'none';
    if (actSec) actSec.style.display = '';       // not licensed → keep the form visible
    if (showBtn) showBtn.style.display = 'none';
  }
}
// "Activate a different key…" — re-open the (collapsed) entry form to add a new entitlement.
const licShowActivateBtn = document.getElementById('lic-show-activate');
if (licShowActivateBtn) licShowActivateBtn.addEventListener('click', () => {
  const actSec = document.getElementById('lic-activate-section');
  if (actSec) actSec.style.display = '';
  const k = document.getElementById('lic-activate-key'); if (k) k.focus();
});
if (licRefreshBtn) licRefreshBtn.addEventListener('click', async () => {
  // Re-check the licence against the server NOW (locks the app if it was revoked/expired
  // server-side), then re-render status + seats from the refreshed cache. Offline → cached.
  licRefreshBtn.disabled = true;
  try { await api.licenseRecheck(); } catch { /* offline — show cached */ }
  await loadLicenseStatus();
  try { if (typeof loadSeats === 'function') await loadSeats(); } catch { /* best-effort */ }
  // Also re-render the entitlement-driven UI (workflow add-on toggle + client-api/cert),
  // so a server-side seat/feature change shows right after a re-check — not just the licence
  // status. initClientApiSection re-reads get-entitlement and is guarded against re-binding.
  try { if (typeof initClientApiSection === 'function') await initClientApiSection(); } catch { /* best-effort */ }
  licRefreshBtn.disabled = false;
});
loadLicenseStatus();

// ── Activate a licence key (enter key → confirm with server → license this device) ──
// Reuses the SAME license-activate IPC the gate window uses; on success the seat token is
// cached and enforcement picks it up immediately, so we just re-render status (no app
// re-gate needed since Settings is open inside an already-allowed session).
const ACTIVATE_ERRORS = {
  unknown_account:    'That licence key was not recognised. Check it and try again.',
  activation_failed:  'Activation failed. Check the key and try again.',
  seat_limit_reached: 'All seats for this licence are already in use — release a device first.',
  offline:            'Could not reach the licensing server. Check your connection and try again.',
};
const licActKey   = document.getElementById('lic-activate-key');
const licActLabel = document.getElementById('lic-activate-label');
const licActBtn   = document.getElementById('lic-activate-btn');
const licActMsg   = document.getElementById('lic-activate-msg');
if (licActBtn) licActBtn.addEventListener('click', async () => {
  const accountKey  = (licActKey.value || '').trim();
  const deviceLabel = (licActLabel.value || '').trim();
  if (!accountKey) { licActMsg.innerHTML = colorSpan('err', 'Enter a licence key.'); return; }
  licActBtn.disabled = true;
  licActMsg.innerHTML = colorSpan('muted', 'Activating…');
  try {
    const res = await api.licenseActivate({ accountKey, deviceLabel });
    if (res && res.ok) {
      licActMsg.innerHTML = colorSpan('ok', 'Activated — this device is now licensed.');
      licActKey.value = '';
      await loadLicenseStatus();
      try { if (typeof loadSeats === 'function') await loadSeats(); } catch { /* best-effort */ }
      try { if (typeof initClientApiSection === 'function') await initClientApiSection(); } catch { /* best-effort */ }
    } else {
      licActMsg.innerHTML = colorSpan('err', ACTIVATE_ERRORS[res && res.code] || 'Activation failed.');
    }
  } catch {
    licActMsg.innerHTML = colorSpan('err', ACTIVATE_ERRORS.offline);
  }
  licActBtn.disabled = false;
});

// ── Search client seats (concurrent floating pool) ─────────────────────────────
const seatsTbody   = document.getElementById('seats-tbody');
const seatsSummary = document.getElementById('seats-summary');
const seatsCountIn = document.getElementById('seats-count');
const seatsEmpty   = document.getElementById('seats-empty');

function _seatAgo(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

async function loadSeats() {
  if (!seatsTbody) return;
  try {
    const s = await api.licenseSeatsStatus();
    const sf = s.search   || { seats: s.seats || 0, inUse: s.inUse || 0, free: s.free || 0 };
    const wf = s.workflow || { seats: 0, inUse: 0, free: 0 };
    if (seatsCountIn && document.activeElement !== seatsCountIn) seatsCountIn.value = sf.seats;
    if (seatsSummary) {
      const part = (label, f) => f.seats > 0
        ? colorSpan(f.free > 0 ? 'ok' : 'warn', `${label} ${f.inUse}/${f.seats}`)
        : colorSpan('muted', `${label} — not licensed`);
      seatsSummary.innerHTML = `${part('Search', sf)} &nbsp;·&nbsp; ${part('Workflow', wf)}`;
    }
    const rows = s.leases || [];
    if (seatsEmpty) seatsEmpty.textContent = rows.length ? '' : 'No clients are currently holding a seat.';
    seatsTbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.username || '—')}</td>
        <td>
          <div>${escHtml(r.hostname || r.ip || '—')}${r.workflowEnabled ? ' <span style="font-size:10px; background:var(--accent-bg); color:var(--accent); padding:1px 6px; border-radius:8px; margin-left:6px; vertical-align:middle;">workflow</span>' : ''}</div>
          ${r.hostname && r.ip ? `<div style="color:var(--muted); font-size:11px; font-family:var(--mono)">${escHtml(r.ip)}</div>` : ''}
        </td>
        <td title="${escHtml(r.lastSeen ? new Date(r.lastSeen).toLocaleString() : '')}">${escHtml(_seatAgo(r.lastSeen))}</td>
        <td><button class="btn danger" data-seat="${escHtml(r.id)}">Release</button></td>
      </tr>`).join('');
    seatsTbody.querySelectorAll('button[data-seat]').forEach(b => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api.licenseSeatRelease(b.dataset.seat); } catch { /* surfaced on reload */ }
        await loadSeats();
      });
    });
  } catch (e) {
    if (seatsSummary) seatsSummary.innerHTML = colorSpan('err', 'Could not read seats: ' + (e.message || 'error'));
  }
}

document.getElementById('seats-refresh')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget; if (btn) btn.disabled = true;
  // Re-check the licence against the server (locks the app if it was revoked/expired), then
  // re-render seats + licence status from the refreshed cache. Offline → cached counts.
  try { await api.licenseRecheck(); } catch { /* offline — show cached */ }
  await loadSeats();
  try { if (typeof loadLicenseStatus === 'function') await loadLicenseStatus(); } catch { /* best-effort */ }
  if (btn) btn.disabled = false;
});
// The search-seat count is READ-ONLY: it comes from the licence (the backend-cached,
// token-verified per-feature count that loadSeats displays), not a local override. The old
// "Save" path wrote `detached_client_seats`, which entitlement could fall back to — a local
// self-grant. That write path is removed; the field below is display-only.
if (seatsCountIn) seatsCountIn.readOnly = true;
loadSeats();

// ══════════════════════════════════════════════════════════════════════════════
// ADVANCED TAB — keyword label overrides (admin-only; whole window is admin).
// Add extra label words for a (doc-type, field) so the keyword stage catches the
// field on import. Stored per-installation in the DB (never packaged); merged
// onto the shipped keyword_patterns.json at processing time.
// ══════════════════════════════════════════════════════════════════════════════
const loDocType = document.getElementById('lo-doctype');
const loField   = document.getElementById('lo-field');
const loLabel   = document.getElementById('lo-label');
const loAddBtn  = document.getElementById('lo-add');
const loMsg     = document.getElementById('lo-msg');
const loList    = document.getElementById('lo-list');
let _loTypes = [];
let _loFieldPatterns = null;   // { field_key: [built-in label, …] } — shipped defaults (read-only)

function loSetMsg(kind, text) {
  if (!loMsg) return;
  loMsg.style.display = text ? 'block' : 'none';
  loMsg.style.color = { err: 'var(--err)', ok: 'var(--ok)', warn: 'var(--warn)' }[kind] || 'var(--muted)';
  loMsg.textContent = text || '';
}

// ── Backup & Restore (Advanced) ─────────────────────────────────────────────────
// Export: validate + confirm the password, then main encrypts & writes the file.
// Restore: preview (decrypt + counts — proves password) -> explicit confirm ->
// apply (sectioned replace in a transaction). Restart recommended afterwards.
(function setupBackupRestore() {
  const $ = (id) => document.getElementById(id);
  const expPw = $('bk-exp-pw'), expPw2 = $('bk-exp-pw2'), expBtn = $('bk-export'), expMsg = $('bk-exp-msg');
  const resPw = $('bk-res-pw'), resBtn = $('bk-restore'), resMsg = $('bk-res-msg');
  if (!expBtn || !resBtn) return;

  const msg = (el, kind, text) => {
    el.style.display = text ? 'block' : 'none';
    el.style.color = { err: 'var(--err)', ok: 'var(--ok)', warn: 'var(--warn)' }[kind] || 'var(--muted)';
    el.textContent = text || '';
  };

  expBtn.addEventListener('click', async () => {
    const pw = expPw.value || '', pw2 = expPw2.value || '';
    if (!pw.trim()) { msg(expMsg, 'err', 'Choose a password for the backup.'); return; }
    if (pw !== pw2)  { msg(expMsg, 'err', 'The two passwords do not match.'); return; }
    expBtn.disabled = true; msg(expMsg, 'muted', 'Creating encrypted backup…');
    try {
      const r = await api.backupExport(pw);
      if (r && r.ok) { msg(expMsg, 'ok', 'Backup saved ✓  Keep the password safe — it is required to restore.'); expPw.value = expPw2.value = ''; }
      else if (r && r.canceled) msg(expMsg, 'muted', '');
      else msg(expMsg, 'err', (r && r.error) || 'Could not create the backup.');
    } catch (e) { msg(expMsg, 'err', e.message || 'Could not create the backup.'); }
    finally { expBtn.disabled = false; }
  });

  resBtn.addEventListener('click', async () => {
    const pw = resPw.value || '';
    if (!pw.trim()) { msg(resMsg, 'err', 'Enter the password for the backup file.'); return; }
    resBtn.disabled = true; msg(resMsg, 'muted', 'Opening backup…');
    let preview;
    try { preview = await api.backupPreview(pw); }
    catch (e) { msg(resMsg, 'err', e.message || 'Could not read the backup.'); resBtn.disabled = false; return; }
    if (!preview || (!preview.ok && preview.canceled)) { msg(resMsg, 'muted', ''); resBtn.disabled = false; return; }
    if (!preview.ok) { msg(resMsg, 'err', preview.error || 'Could not read the backup.'); resBtn.disabled = false; return; }

    const s = preview.summary || {};
    const when = preview.meta && preview.meta.exported_at ? new Date(preview.meta.exported_at).toLocaleString() : 'unknown date';
    const ver  = (preview.meta && preview.meta.app_version) ? ` (app ${preview.meta.app_version})` : '';
    const counts = `${s.document_types || 0} document type(s), ${s.templates || 0} template(s), ${s.field_anchors || 0} learned anchor(s)`;
    const confirmed = window.confirm(
      `Restore this backup?\n\nExported: ${when}${ver}\nContains: ${counts}.\n\n` +
      `This REPLACES your current document types, templates and learned data, and merges app settings. It cannot be undone.`
    );
    if (!confirmed) { msg(resMsg, 'muted', 'Restore cancelled.'); resBtn.disabled = false; return; }

    msg(resMsg, 'muted', 'Restoring…');
    try {
      const r = await api.backupApply(preview.path, pw);
      if (r && r.ok) { msg(resMsg, 'ok', 'Restore complete ✓  Please close and reopen Scan Finder for all changes to take effect.'); resPw.value = ''; }
      else msg(resMsg, 'err', (r && r.error) || 'Restore failed.');
    } catch (e) { msg(resMsg, 'err', e.message || 'Restore failed.'); }
    finally { resBtn.disabled = false; }
  });
})();

function loPopulateFields() {
  const t = _loTypes.find(x => x.slug === loDocType.value);
  loField.innerHTML = '';
  for (const f of (t && t.fields ? t.fields : [])) {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = `${f.label} (${f.key})`;
    loField.appendChild(opt);
  }
}

async function loLoadTypes() {
  try { _loTypes = (await api.getAllDocTypesAll()) || []; } catch { _loTypes = []; }
  loDocType.innerHTML = '';
  for (const t of _loTypes) {
    const opt = document.createElement('option');
    opt.value = t.slug;
    opt.textContent = t.name;
    loDocType.appendChild(opt);
  }
  loPopulateFields();
}

// Show the selected document type's labels (the doc-type dropdown picks the "block"
// to view/edit), one section per field in the type's own field order. Each field lists
// its BUILT-IN words (shipped field_patterns — read-only, always active) AND any custom
// overrides this install added (removable). Canonical types (invoice/sales order/etc.)
// carry no overrides by design but DO have rich built-in words, so they're no longer
// shown as empty.
async function loLoadList() {
  let rows = [];
  try { rows = (await api.getLabelOverrides()) || []; } catch {}
  if (_loFieldPatterns === null) {
    try { _loFieldPatterns = (await api.getFieldPatterns()) || {}; } catch { _loFieldPatterns = {}; }
  }
  const slug = loDocType ? loDocType.value : '';
  const t = _loTypes.find(x => x.slug === slug);
  const typeName = (t && t.name) || slug || '';
  const fields = (t && t.fields) || [];
  const fieldLabel = (k) => (fields.find(f => f.key === k) || {}).label || k;

  const ovByField = {};
  for (const r of rows.filter(r => r.doc_type_slug === slug)) {
    (ovByField[r.field_key] = ovByField[r.field_key] || []).push(r);
  }
  // Every field of the type, in order, then any override-only keys not in the type.
  const order = fields.map(f => f.key);
  for (const k of Object.keys(ovByField)) if (!order.includes(k)) order.push(k);

  let html = `<div style="margin-bottom:8px; font-weight:600; color:var(--text);">Labels for ${escHtml(typeName)}</div>`;
  if (!order.length) {
    html += '<span style="color:var(--muted)">This document type has no fields.</span>';
    loList.innerHTML = html;
    return;
  }
  for (const k of order) {
    const builtin = _loFieldPatterns[k] || [];
    const overrides = ovByField[k] || [];
    html += `<div style="margin-top:12px; font-weight:600; color:var(--text);">${escHtml(fieldLabel(k))}
      <span style="font-family:var(--mono); color:var(--muted); font-weight:400;">(${escHtml(k)})</span></div>`;
    if (builtin.length) {
      html += `<div style="font-size:11px; color:var(--muted); margin:2px 0 1px;">Built-in (always active): `
        + builtin.map(b => `<span style="font-family:var(--mono); color:var(--muted);">${escHtml(b)}</span>`).join(', ')
        + '</div>';
    }
    for (const r of overrides) {
      // Oracle C3 (2026-08-11): teach-written rows must be VISIBLE here — deletion in this list
      // is the only remediation once teach_label_becomes_keyword has written them (turning the
      // flag off gates writes, never retires rows). "replaces built-ins" = exclusive; the layout
      // tag names the template scope (migration 62); nothing = a plain additive admin row.
      const tags = [];
      if (r.exclusive) tags.push('<span style="font-size:10px; padding:1px 6px; border-radius:var(--r-pill); background:var(--accent-bg); color:var(--accent2);" title="Taught label — replaces the built-in labels for this field (instead of adding to them)">replaces built-ins</span>');
      if (r.template_id > 0) tags.push(`<span style="font-size:10px; padding:1px 6px; border-radius:var(--r-pill); background:var(--surface3); color:var(--muted);" title="Applies only to documents matching this learned layout">${escHtml(r.template_name || 'layout #' + r.template_id)} only</span>`);
      html += `<div class="row-flex" style="gap:8px; align-items:center; padding:3px 0;">
        <span style="font-family:var(--mono); color:var(--accent2);">&ldquo;${escHtml(r.label)}&rdquo;</span>
        ${tags.join(' ')}
        <button class="btn" data-lo-del="${r.id}" style="padding:2px 8px; font-size:11px;">Remove</button>
      </div>`;
    }
    if (!builtin.length && !overrides.length) {
      html += '<div style="font-size:11px; color:var(--muted); margin:2px 0;">No words yet — add some above (built-in detection still applies).</div>';
    }
  }
  loList.innerHTML = html;
  loList.querySelectorAll('[data-lo-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await api.deleteLabelOverride(parseInt(btn.dataset.loDel, 10)); } catch {}
      loLoadList();
    });
  });
}

if (loDocType && loField && loAddBtn) {
  loDocType.addEventListener('change', () => { loPopulateFields(); loLoadList(); });
  loAddBtn.addEventListener('click', async () => {
    const data = {
      doc_type_slug: loDocType.value,
      field_key:     loField.value,
      labels:        loLabel.value || '',   // backend splits on comma/newline
    };
    if (!data.doc_type_slug || !data.field_key || !data.labels.trim()) {
      loSetMsg('err', 'Pick a document type and field, and enter at least one label.');
      return;
    }
    let r;
    try { r = await api.addLabelOverrides(data); } catch (e) { r = { ok: false, code: e.message }; }
    if (!(r && r.ok)) {
      loSetMsg('err', 'Could not add labels' + (r && r.code ? ` (${r.code})` : '') + '.');
      return;
    }
    const parts = [];
    if (r.inserted)       parts.push(`Added ${r.inserted} label${r.inserted !== 1 ? 's' : ''}.`);
    if (r.alreadyExisted) parts.push(`${r.alreadyExisted} already existed.`);
    const cap  = (r.rejected || []).filter(x => x.code === 'cap_reached').length;
    const long = (r.rejected || []).filter(x => x.code === 'too_long').length;
    if (cap)  parts.push(`${cap} skipped (25-label limit).`);
    if (long) parts.push(`${long} skipped (too long).`);
    let kind = r.inserted ? 'ok' : 'muted';
    let text = parts.join(' ') || 'Nothing to add.';
    if (r.warnings && r.warnings.length) {
      kind = 'warn';
      text += '  ⚠ ' + r.warnings
        .map(w => `"${w.label}" is also a label for field "${w.field_key}" — the first field extracted wins`)
        .join('; ');
    }
    loSetMsg(kind, text);
    if (r.inserted) loLabel.value = '';
    loLoadList();
  });
  loLoadTypes().then(loLoadList);
}

// ── Diagnostic logging toggle ─────────────────────────────────────────────────
const diagToggle = document.getElementById('diag-toggle');
const diagSub    = document.getElementById('diag-sub');
if (diagToggle) {
  (async () => {
    try { diagToggle.checked = (await api.getSetting('diagnostic_logging')) === 'true'; } catch {}
  })();
  diagToggle.addEventListener('change', async () => {
    const on = diagToggle.checked;
    try {
      await api.setSetting('diagnostic_logging', on ? 'true' : 'false');
      if (diagSub) diagSub.textContent = on
        ? 'On — writes to the app debug folder on the next processing/reprocess run.'
        : "Saved to the app's debug folder.";
    } catch {
      diagToggle.checked = !on;
    }
  });
}

// ── Help improve Scan Finder (opt-in diagnostics) ──────────────────────────────
const telToggle = document.getElementById('telemetry-toggle');
if (telToggle) {
  (async () => { try { telToggle.checked = (await api.getSetting('telemetry_enabled')) === 'true'; } catch {} })();
  telToggle.addEventListener('change', async () => {
    const on = telToggle.checked;
    try { await api.setSetting('telemetry_enabled', on ? 'true' : 'false'); }
    catch { telToggle.checked = !on; }
  });
}
document.getElementById('telemetry-view-btn')?.addEventListener('click', async () => {
  let info = { enabled: false, events: {}, queued: [] };
  try { info = await api.getTelemetryInfo(); } catch {}
  showTelemetryDialog(info);
});

// Read-only "see exactly what's sent" modal: the master state, the full event
// allowlist (what CAN be sent), and the events buffered on THIS machine right now.
function showTelemetryDialog(info) {
  const names = Object.keys(info.events || {}).sort();
  const allowRows = names.map(n =>
    `<div style="font-family:var(--mono);font-size:11px;margin:2px 0;">${escHtml(n)}
       <span style="color:var(--muted);">${escHtml((info.events[n] || []).join(', ') || '—')}</span></div>`).join('');
  const q = info.queued || [];
  const queuedRows = q.length
    ? q.map(e => `<div style="font-family:var(--mono);font-size:11px;margin:2px 0;">
         <span style="color:${e.sent ? 'var(--muted)' : 'var(--accent2)'};">${e.sent ? '✓ sent' : '• waiting'}</span>
         ${escHtml(e.name)} <span style="color:var(--muted);">${escHtml(JSON.stringify(e.props))}</span></div>`).join('')
    : '<div style="font-size:12px;color:var(--muted);">Nothing is queued.</div>';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="width:560px;max-width:92vw;max-height:84vh;overflow:auto;background:var(--surface);border:1px solid var(--border2);
                border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px;color:var(--text);">
      <div style="font-size:15px;font-weight:600;">Diagnostics — exactly what's sent</div>
      <div style="font-size:12.5px;line-height:1.6;">Diagnostics is currently <b>${info.enabled ? 'ON' : 'OFF'}</b>.
        Only the structured events below are ever sent — tied only to an anonymous device id.</div>
      <div><div style="font-size:12px;font-weight:600;margin-bottom:6px;">What can be sent (event → fields)</div>${allowRows}</div>
      <div><div style="font-size:12px;font-weight:600;margin:4px 0 6px;">Waiting on this PC right now</div>${queuedRows}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.6;"><b>Never sent:</b> your documents, scans, OCR text,
        supplier/customer names, invoice/reference numbers, totals, dates, file paths, your name, email or licence key.</div>
      <button id="tel-ok" style="align-self:flex-end;padding:9px 18px;border-radius:8px;border:none;background:var(--accent);
              color:#fff;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;">Done</button>
    </div>`;
  overlay.setAttribute('data-help-ignore', '1');
  document.body.appendChild(overlay);
  overlay.querySelector('#tel-ok').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT TAB (admin-only — server enforces requireRole('admin'))
// ══════════════════════════════════════════════════════════════════════════════
const auditState = { offset: 0, limit: 50, total: 0, loaded: false, lastFilters: {} };

function auditFilters() {
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const f = {};
  if (v('aud-user')) f.username = v('aud-user');
  if (v('aud-doc')) f.document_id = v('aud-doc');
  if (v('aud-cat')) f.category = v('aud-cat');
  if (v('aud-outcome')) f.outcome = v('aud-outcome');
  // <input type=date> gives YYYY-MM-DD; widen the upper bound to end-of-day.
  if (v('aud-from')) f.dateFrom = v('aud-from') + ' 00:00:00';
  if (v('aud-to')) f.dateTo = v('aud-to') + ' 23:59:59';
  if (v('aud-text')) f.text = v('aud-text');
  return f;
}

async function loadAudit(resetOffset = true) {
  if (resetOffset) auditState.offset = 0;
  const tbody = document.getElementById('aud-tbody');
  if (!tbody) return;
  const filters = auditState.lastFilters = auditFilters();
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Loading…</td></tr>';
  let res;
  try {
    res = await api.auditQuery({ ...filters, limit: auditState.limit, offset: auditState.offset });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--err)">${escHtml(e.message || 'Failed to load audit log')}</td></tr>`;
    return;
  }
  auditState.loaded = true;
  auditState.total = res.total || 0;
  renderAuditRows(res.rows || []);
  updateAuditPager();
}

function auditOutcomeClass(o) {
  if (o === 'success') return 'success';
  if (o === 'denied') return 'denied';
  if (o === 'failure' || o === 'error') return 'failure';
  return '';
}

function renderAuditRows(rows) {
  const tbody = document.getElementById('aud-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No matching events.</td></tr>';
    return;
  }
  const html = [];
  for (const r of rows) {
    const when = formatWhen(r.created_at) || escHtml(r.created_at || '');
    const user = escHtml(r.actor_display_name || r.actor_username || r.actor_username_live || (r.user_id ? `#${r.user_id}` : 'system'));
    const cat = escHtml(r.action_category || '');
    const outcome = escHtml(r.outcome || '');
    const oclass = auditOutcomeClass(r.outcome);
    // Document targets show the FILENAME + a "View" link (opens the doc in Review, full zoom/pan)
    // instead of "document:111"; a deleted/missing doc shows as unavailable. Other target types unchanged.
    const auditDocId = (r.target_type === 'document' && r.target_id) ? r.target_id : (r.document_id || null);
    let target;
    if (auditDocId) {
      const gone = !r.doc_filename || r.doc_status === 'deleted';
      const fname = r.doc_filename ? escHtml(r.doc_filename) : `document #${auditDocId}`;
      target = `<span title="document #${auditDocId}">${fname}</span>`
        + (gone
            ? ` <span style="color:var(--muted)" title="This document is no longer available">(unavailable)</span>`
            : ` <button type="button" class="aud-view-btn" data-doc="${auditDocId}" title="Open this document in Review">View</button>`);
    } else {
      target = r.target_type ? escHtml(r.target_id ? `${r.target_type}:${r.target_id}` : r.target_type) : '';
    }
    html.push(`<tr class="aud-row" data-id="${r.id}">
      <td>${when}</td>
      <td>${user}${r.actor_role ? ` <span style="color:var(--muted)">(${escHtml(r.actor_role)})</span>` : ''}</td>
      <td style="font-family:var(--mono)">${escHtml(r.action || '')}</td>
      <td>${cat}</td>
      <td>${outcome ? `<span class="aud-pill ${oclass}">${outcome}</span>` : ''}</td>
      <td style="font-family:var(--mono)">${target}</td>
    </tr>`);
    // Expandable detail row (hidden until the summary row is clicked).
    const details = [];
    if (r.details) details.push(`details: ${r.details}`);
    if (r.session_id) details.push(`session: ${r.session_id}`);
    if (r.source) details.push(`source: ${r.source}`);
    if (r.metadata_json) {
      let meta = r.metadata_json;
      try { meta = JSON.stringify(JSON.parse(r.metadata_json), null, 2); } catch {}
      details.push(`metadata: ${meta}`);
    }
    const detailText = details.length ? details.join('\n') : '(no additional detail)';
    html.push(`<tr class="aud-detail" data-detail="${r.id}" style="display:none"><td colspan="6">${escHtml(detailText)}</td></tr>`);
  }
  tbody.innerHTML = html.join('');
  tbody.querySelectorAll('tr.aud-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const d = tbody.querySelector(`tr.aud-detail[data-detail="${tr.dataset.id}"]`);
      if (d) d.style.display = d.style.display === 'none' ? '' : 'none';
    });
  });
  // "View" opens the audited document in Review (full zoom/pan); stop the click from also toggling the
  // detail row. openReviewWindowAt is admin/edit-gated in main.js (the Audit tab is itself admin-only).
  tbody.querySelectorAll('.aud-view-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.doc);
      if (id) api.openReviewWindowAt(id);
    });
  });
}

function updateAuditPager() {
  const from = auditState.total === 0 ? 0 : auditState.offset + 1;
  const to = Math.min(auditState.offset + auditState.limit, auditState.total);
  const sum = document.getElementById('aud-summary');
  if (sum) sum.textContent = `${auditState.total} event${auditState.total === 1 ? '' : 's'} matched`;
  const page = document.getElementById('aud-page');
  if (page) page.textContent = auditState.total ? `${from}–${to} of ${auditState.total}` : '—';
  const prev = document.getElementById('aud-prev');
  const next = document.getElementById('aud-next');
  if (prev) prev.disabled = auditState.offset <= 0;
  if (next) next.disabled = auditState.offset + auditState.limit >= auditState.total;
}

document.getElementById('aud-apply')?.addEventListener('click', () => loadAudit(true));
document.getElementById('aud-text')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAudit(true); });
document.getElementById('aud-user')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAudit(true); });
document.getElementById('aud-clear')?.addEventListener('click', () => {
  ['aud-user', 'aud-doc', 'aud-from', 'aud-to', 'aud-text'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['aud-cat', 'aud-outcome'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadAudit(true);
});
document.getElementById('aud-prev')?.addEventListener('click', () => {
  if (auditState.offset <= 0) return;
  auditState.offset = Math.max(0, auditState.offset - auditState.limit);
  loadAudit(false);
});
document.getElementById('aud-next')?.addEventListener('click', () => {
  if (auditState.offset + auditState.limit >= auditState.total) return;
  auditState.offset += auditState.limit;
  loadAudit(false);
});
document.getElementById('aud-csv')?.addEventListener('click', async () => {
  const btn = document.getElementById('aud-csv');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Exporting…';
  try {
    const r = await api.auditExportCsv(auditState.lastFilters || auditFilters());
    btn.textContent = r && r.saved ? `Saved ${r.count} rows` : 'Export CSV';
  } catch (e) {
    btn.textContent = 'Export failed';
  }
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
});

// Stage 5b — re-walk the tamper-evident audit hash chain (live + archives) and report the result.
document.getElementById('aud-verify')?.addEventListener('click', async () => {
  const btn = document.getElementById('aud-verify');
  const out = document.getElementById('aud-verify-result');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const r = await api.verifyAuditChain();
    let msg, colour;
    if (r && r.ok) {
      msg = `✓ Integrity OK — ${r.checked || 0} record(s) verified, chain unbroken.`;
      if (r.archivesPartial) msg += ' (Note: some archived months exceeded the attach limit and were not all checked.)';
      colour = 'var(--ok)';
    } else if (r && r.reason === 'no_key') {
      msg = 'Integrity checking is not active on this install (no audit key set).'; colour = 'var(--muted)';
    } else if (r && r.reason === 'no_chain_columns') {
      msg = 'This log predates tamper-evidence — no chain to verify.'; colour = 'var(--muted)';
    } else {
      const at = r && r.brokenAt != null ? ` at record #${r.brokenAt}` : '';
      msg = `⚠ Integrity FAILED${at} — the audit log has been altered, reordered, or truncated (${(r && r.reason) || 'unknown'}).`;
      colour = 'var(--err)';
    }
    out.textContent = msg; out.style.color = colour; out.style.display = 'block';
  } catch (e) {
    out.textContent = 'Verify failed: ' + (e && e.message ? e.message : 'unknown error');
    out.style.color = 'var(--err)'; out.style.display = 'block';
  }
  btn.textContent = orig; btn.disabled = false;
});
