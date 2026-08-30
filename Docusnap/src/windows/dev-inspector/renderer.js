'use strict';

// Read-only developer inspector — "answer-first" provenance view.
// Subscribes to the mirrored process/reprocess telemetry and the structured
// extraction trace (both read-only IPC). For each field it reconstructs the
// WINNING LINEAGE — the chain of stages that produced the final value — instead
// of dumping raw events. No controls affect the pipeline. The ONE exception to
// "no DB writes" is the explicit "Erase data" fresh-install reset below: it does
// not write here either — it triggers the admin-gated reset-fresh-install handler
// in main, behind a typed confirmation. The delete logic lives in main, not here.
//
// Lineage is reconstructed client-side from candidate/merge/transform/validation
// /final events. Until the engine explicitly DECLARES a winner + per-decision
// reasons (separate, main-app work), the chain is a best-effort reconstruction
// and is labelled "approx" so it is never mistaken for ground truth.

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click',   () => window.docusnap.windowMinimise());
document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Fresh-install reset (typed-confirmation modal → admin-gated main handler) ──
(() => {
  const PHRASE  = 'ERASE ALL CUSTOM DATA';
  const modal   = document.getElementById('reset-modal');
  const phrase  = document.getElementById('reset-phrase');
  const confirm = document.getElementById('reset-confirm');
  const cancel  = document.getElementById('reset-cancel');
  const result  = document.getElementById('reset-result');

  const closeModal = () => {
    modal.classList.remove('open');
    phrase.value = ''; confirm.disabled = true;
    result.style.display = 'none'; result.textContent = '';
    confirm.textContent = 'Erase data'; confirm.disabled = true;
  };

  document.getElementById('btn-reset').addEventListener('click', () => {
    closeModal();
    modal.classList.add('open');
    setTimeout(() => phrase.focus(), 30);
  });
  cancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  phrase.addEventListener('input', () => { confirm.disabled = phrase.value.trim() !== PHRASE; });
  phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirm.disabled) confirm.click(); });

  confirm.addEventListener('click', async () => {
    if (phrase.value.trim() !== PHRASE) return;
    confirm.disabled = true; confirm.textContent = 'Erasing…';
    try {
      const res = await window.docusnap.resetFreshInstall();
      const counts = (res && res.counts) || {};
      const lines = Object.entries(counts).map(([k, v]) => `  ${k.padEnd(24)} ${v}`).join('\n');
      result.style.color = 'var(--ok)';
      result.textContent =
        'Done — reverted to a fresh install.\n' + lines +
        (res && res.backup ? `\n\nBackup: ${res.backup}` : '\n\n(Backup not taken — see logs)') +
        '\n\nRestart the app for a fully clean session.';
      result.style.display = 'block';
      confirm.textContent = 'Done';
      cancel.textContent  = 'Close';
    } catch (e) {
      result.style.color = 'var(--err)';
      result.textContent = 'Reset failed: ' + (e && e.message ? e.message : String(e));
      result.style.display = 'block';
      confirm.disabled = false; confirm.textContent = 'Retry';
    }
  });
})();

// ── Element refs ──────────────────────────────────────────────────────────────
const tbRun       = document.getElementById('tb-run');
const livePill    = document.getElementById('live-pill');
const liveFile    = document.getElementById('live-file');
const liveAct     = document.getElementById('live-activity');
const liveDetail  = document.getElementById('live-detail');
const liveBar     = document.getElementById('live-bar');
const liveProg    = document.getElementById('live-prog');
const docList     = document.getElementById('doc-list');
const docCount    = document.getElementById('doc-count');
const docEmpty    = document.getElementById('doc-empty');
const docFilter   = document.getElementById('doc-filter');
const followTgl   = document.getElementById('follow-toggle');
const centerEmpty = document.getElementById('center-empty');
const docHeader   = document.getElementById('doc-header');
const banner      = document.getElementById('banner');
const bannerIc    = document.getElementById('banner-ic');
const bannerText  = document.getElementById('banner-text');
const fieldsWrap  = document.getElementById('fields-wrap');
const fieldList   = document.getElementById('field-list');
const fieldCount  = document.getElementById('field-count');
const evField     = document.getElementById('ev-field');
const evBody      = document.getElementById('ev-body');
const logEl       = document.getElementById('log');
const logToggle   = document.getElementById('log-toggle');

// ── State ─────────────────────────────────────────────────────────────────────
let total = 0, done = 0;
let selectedDoc = null;
let selectedField = null;
let autoFollow = true;
let docMetaByKey = new Map();        // key -> session-doc meta
let docModels = new Map();           // field -> model, for the selected doc
let slicesByField = new Map();       // field -> [sliceEvent…]
const expanded = new Set();          // field keys the user explicitly toggled open

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function shownVal(v) { return (v == null || v === '') ? '—' : String(v); }

// Map a trace stage string to a colour class + human label.
function stageMeta(stage) {
  switch (stage) {
    case '0_template':       return { cls: 's0',  label: 'Stage 0 · template' };
    case '0.5_mapping':      return { cls: 's05', label: 'Stage 0.5 · mapping' };
    case 'template_mapping': return { cls: 's05', label: 'Stage 0.5 · mapping' };
    case '1_keyword':        return { cls: 's1',  label: 'Stage 1 · keyword' };
    case '2_anchor':         return { cls: 's2',  label: 'Stage 2 · anchor' };
    case 'anchor_crop':      return { cls: 's2',  label: 'Stage 2 · anchor' };
    case '2.5_denoise':      return { cls: 's25', label: 'Stage 2.5 · denoise' };
    case '2.5_correct':      return { cls: 's25', label: 'Stage 2.5 · OCR correct' };
    case '4_validate':       return { cls: 's4',  label: 'Stage 4 · validation' };
    default:                 return { cls: 's1',  label: stage || 'stage' };
  }
}

// Fixed pipeline order for the every-step ladder (slice 1 = the four core read
// stages; late 2.5/2.6 stages are deferred to slice 2). Every field renders a row
// per stage in THIS order, so a stage that produced nothing is visibly present
// (skipped / no_candidate), not silently absent — the point of the feature.
const LADDER_STAGES = ['0_template', '0.5_mapping', '1_keyword', '2_anchor'];

// Outcome → CSS class + label via an ALLOWLIST — a raw engine outcome string is
// NEVER interpolated into a class attribute (escapeHtml guards text nodes, not
// attributes). Unknown outcomes fall back to the neutral style.
const OUTCOME_META = {
  won:              { cls: 'oc-won',   label: 'won' },
  lost:             { cls: 'oc-lost',  label: 'lost' },
  no_candidate:     { cls: 'oc-none',  label: 'no candidate' },
  already_resolved: { cls: 'oc-prior', label: 'already resolved' },
  skipped:          { cls: 'oc-skip',  label: 'skipped' },
};
function outcomeMeta(o) { return OUTCOME_META[o] || { cls: 'oc-none', label: 'step' }; }

// The complete per-field ladder: every read stage with its ENGINE-DECLARED outcome.
// Unlike the "Winning lineage" chain below (a best-effort reconstruction), this is
// declared by the engine, so it carries no "approx" caveat and shows the stages
// that produced NOTHING. Stage-2 rung rejects (anchor_reject) nest under 2_anchor.
function ladderHtml(m) {
  const byStage = new Map((m.steps || []).map(s => [s.stage, s]));
  const rows = LADDER_STAGES.map(stage => {
    const sm = stageMeta(stage);
    const st = byStage.get(stage);
    if (!st) {
      return `<div class="lrow missing"><span class="sbadge ${sm.cls}">${escapeHtml(sm.label)}</span><span class="oc oc-none">—</span></div>`;
    }
    const om = outcomeMeta(st.outcome);
    let detail = '';
    if (st.outcome === 'won' || st.outcome === 'lost') {
      detail = `<span class="lval">${escapeHtml(shownVal(st.value))}</span>`
             + (st.method ? `<span class="conf">${escapeHtml(st.method)}</span>` : '')
             + captionHtml(st.caption)
             + (st.confidence != null ? confBar(st.confidence) : '')
             // A LOST rung names what currently holds the field (state, not a claimed cause) so
             // "the taught anchor read X but lost to Y" is visible without re-running.
             + (st.outcome === 'lost' && st.reason ? `<span class="lreason">${escapeHtml(st.reason)}</span>` : '');
    } else if (st.outcome === 'already_resolved') {
      detail = `<span class="lval muted">${escapeHtml(shownVal(st.value))}</span>`
             + (st.by ? `<span class="conf">by ${escapeHtml(st.by)}</span>` : '')
             + captionHtml(st.caption)
             + (st.reason ? `<span class="lreason">${escapeHtml(st.reason)}</span>` : '');
    } else { // no_candidate / skipped — the reason is the diagnostic datum
      detail = st.reason ? `<span class="lreason">${escapeHtml(st.reason)}</span>` : '';
    }
    let rejects = '';
    if (stage === '2_anchor' && m.rejects && m.rejects.length) {
      rejects = `<div class="lrejects">` + m.rejects.map(r =>
        `<div class="lreject">✗ <b>${escapeHtml(r.method || 'anchor')}</b>${captionHtml(r.caption)} read ${escapeHtml(shownVal(r.value))} — ${escapeHtml(r.reason || 'rejected')}</div>`
      ).join('') + `</div>`;
    }
    return `<div class="lrow"><span class="sbadge ${sm.cls}">${escapeHtml(sm.label)}</span>`
         + `<span class="oc ${om.cls}">${escapeHtml(om.label)}</span>${detail}${rejects}</div>`;
  }).join('');
  return `<div class="sec-label">Every step</div><div class="ladder">${rows}</div>`;
}

// The PRINTED CAPTION the rung matched (owner request 2026-08-09: "I would like to see the
// winning keyword so I know what the app used to derive the value"). Engine-supplied
// (`caption` on step / candidate / merge / anchor_reject), never re-derived here — and the
// engine already suppresses the Stage-0.5 field-key fallback, so anything that arrives is a
// caption the rung really answered. Absent on older traces and on rungs that match no label
// (a positional read), which is itself the datum: no caption means nothing was matched BY NAME.
function captionHtml(caption) {
  const c = (caption == null ? '' : String(caption)).trim();
  return c ? `<span class="lcap" title="the printed caption this rung matched">matched “${escapeHtml(c)}”</span>` : '';
}

function confBar(c) {
  if (c == null) return '';
  const pct = Math.max(0, Math.min(100, c));
  return `<span class="conf-bar"><i style="width:${pct}%"></i></span><span class="conf">${pct}%</span>`;
}

// Detect the reprocess temp-name (reprocess_<ms>.<ext>) so the picker can show a
// friendly label instead of an unrecognisable temp file. (The underlying stable
// identity fix lives in the main process; this is a read-only display nicety.)
function reprocessInfo(key) {
  const m = /^reprocess_(\d{10,})(\.[A-Za-z0-9]+)?$/.exec(key || '');
  if (!m) return null;
  const t = new Date(Number(m[1]));
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return { time: `${hh}:${mm}:${ss}`, ext: m[2] || '' };
}

// ── Doc picker ────────────────────────────────────────────────────────────────
async function refreshDocs() {
  let docs = [];
  try { docs = (await window.docusnap.devGetSessionDocs()) || []; } catch {}
  docMetaByKey = new Map(docs.map(d => [d.key, d]));
  renderDocList(docs);
  docCount.textContent = docs.length ? docs.length : '';
  docEmpty.style.display = docs.length ? 'none' : '';
  // Keep the user's selection; otherwise default to the most recent.
  if (!selectedDoc && docs[0]) selectDoc(docs[0].key);
  else if (selectedDoc && !docMetaByKey.has(selectedDoc) && docs[0]) selectDoc(docs[0].key);
}

function renderDocList(docs) {
  const q = (docFilter.value || '').toLowerCase().trim();
  docList.innerHTML = '';
  for (const d of docs) {
    const repr = reprocessInfo(d.key);
    const displayName = repr ? `Reprocess ${repr.time}${repr.ext}` : d.filename;
    const hay = (displayName + ' ' + (d.docType || '')).toLowerCase();
    if (q && !hay.includes(q)) continue;

    const card = document.createElement('div');
    card.className = 'doc-card' + (d.key === selectedDoc ? ' sel' : '') + (repr ? ' reprocess' : '');
    const conf = d.confidence;
    const statusCls = 'st-' + (d.status || 'pending');
    card.innerHTML =
      `<div class="doc-name">${repr ? '<span class="repico">↻ </span>' : ''}${escapeHtml(displayName)}</div>`
      + `<div class="doc-meta">`
      + (d.docType ? `<span class="chip type">${escapeHtml(d.docType)}</span>` : '')
      + (repr ? `<span class="chip repr">reprocess</span>` : '')
      + (d.status ? `<span class="chip ${statusCls}">${escapeHtml(d.status)}</span>` : '')
      + (conf != null ? `<span class="conf-mini"><span class="track"><span class="fill" style="width:${conf}%;background:${conf>=80?'var(--ok)':conf>=50?'var(--warn)':'var(--err)'}"></span></span><span class="num">${conf}%</span></span>` : '')
      + `</div>`;
    card.addEventListener('click', () => { autoFollow = false; setFollow(); selectDoc(d.key); });
    docList.appendChild(card);
  }
}

docFilter.addEventListener('input', () => renderDocList([...docMetaByKey.values()]));
followTgl.addEventListener('click', () => { autoFollow = !autoFollow; setFollow(); });
function setFollow() { followTgl.classList.toggle('on', autoFollow); }

// ── Load + model a document's trace ─────────────────────────────────────────
async function selectDoc(key) {
  selectedDoc = key;
  selectedField = null;
  await refreshSelectedDoc();
  clearEvidence();
  renderDocList([...docMetaByKey.values()]);
}

// Re-fetch + re-render the CURRENT doc WITHOUT resetting the field selection or the
// evidence pane. Used by the live trace tick so a 120ms refresh doesn't wipe the
// crop the user is inspecting (the every-step ladder invites more crop clicks; the
// old live path called selectDoc, which nulled selectedField + cleared evidence
// every tick). If a field is open, re-render its evidence in place.
async function refreshSelectedDoc() {
  let events = [];
  try { events = (await window.docusnap.devGetSessionDoc(selectedDoc)) || []; } catch {}
  buildModel(events);
  renderDoc();
  if (selectedField) showEvidence(selectedField);
}

// Reconstruct a per-field model from the ordered event stream.
function buildModel(events) {
  docModels = new Map();
  slicesByField = new Map();
  const get = (f) => {
    if (!docModels.has(f)) docModels.set(f, {
      field: f, wins: [], losers: [], transforms: [], validations: [],
      reprocess: [], final: null, reconcile: null,
      steps: [], rejects: [],
    });
    return docModels.get(f);
  };
  for (const ev of events) {
    if (!ev) continue;
    // reconcile is a cross-field TOTAL calc (keyed by total_key, no `field`) — attach to the total.
    if (ev.event === 'reconcile') { if (ev.total_key) get(ev.total_key).reconcile = ev; continue; }
    if (ev.field == null) {
      // stage_start / stage_end carry no field — ignored (structure only).
      continue;
    }
    const m = get(ev.field);
    switch (ev.event) {
      case 'merge':
        if (ev.decision === 'win') m.wins.push(ev);
        else m.losers.push(ev);
        break;
      case 'transform':   m.transforms.push(ev); break;
      case 'validation':  m.validations.push(ev); break;
      case 'reprocess_merge': m.reprocess.push(ev); break;
      case 'final':       m.final = ev; break;
      // Every-step ladder (slice 1): one 'step' per (stage, field) declared by the
      // engine; 'anchor_reject' = a Stage-2 rung read that a gate dropped (was
      // previously dropped here — now surfaced under the 2_anchor ladder row).
      case 'step':          m.steps.push(ev); break;
      case 'anchor_reject': m.rejects.push(ev); break;
      case 'slice':
        if (!slicesByField.has(ev.field)) slicesByField.set(ev.field, []);
        slicesByField.get(ev.field).push(ev);
        break;
      // 'candidate' events are folded into their merge (win/lose), so skipped.
    }
  }
}

function isFlagged(m) {
  if (m.final && m.final.note) return true;
  return m.validations.some(v => v.note || v.corrected_to);
}

// ── Render the selected document ────────────────────────────────────────────
function renderDoc() {
  const meta = docMetaByKey.get(selectedDoc);
  const hasEvents = docModels.size > 0;

  centerEmpty.style.display = (meta || hasEvents) ? 'none' : '';
  if (!meta && !hasEvents) { docHeader.classList.add('hidden'); fieldsWrap.style.display = 'none'; return; }

  // Header
  docHeader.classList.remove('hidden');
  const repr = reprocessInfo(selectedDoc);
  document.getElementById('dh-file').textContent =
    repr ? `Reprocess run · ${repr.time}` : (meta ? meta.filename : selectedDoc);
  document.getElementById('dh-type').textContent     = (meta && meta.docType) || '—';
  document.getElementById('dh-supplier').textContent = (meta && meta.supplier) || '—';
  const conf = meta && meta.confidence;
  const cEl = document.getElementById('dh-conf');
  cEl.textContent = conf != null ? conf + '%' : '—';
  cEl.className = 'dh-v ' + (conf == null ? 'muted' : conf >= 80 ? 'ok' : 'warn');
  const sEl = document.getElementById('dh-status');
  const status = (meta && meta.status) || '—';
  sEl.textContent = status;
  sEl.className = 'dh-v ' + (status === 'confirmed' ? 'ok' : status === 'needs_review' || status === 'error' ? 'warn' : 'muted');

  const runs = document.getElementById('dh-runs');
  runs.innerHTML = repr
    ? `<span class="run-tag repr">↻ reprocess run</span>`
    : `<span class="run-tag">① original run</span>`;

  // Banner: trace-not-captured vs live
  banner.classList.add('hidden');
  if (!hasEvents) {
    showBanner('warn', '!', 'Trace not captured — the inspector was not open when this document was processed. Reprocess it (with the inspector open) to capture full lineage. The summary above comes from the result snapshot.');
  } else if (selectedDoc === liveDocKey && total && done < total) {
    showBanner('live', '●', 'Live document — lineage is filling in as stages complete.');
  }

  if (!hasEvents) { fieldsWrap.style.display = 'none'; return; }
  fieldsWrap.style.display = '';

  // Auto-expand flagged fields the user hasn't explicitly collapsed.
  const blocks = [];
  let n = 0;
  for (const [field, m] of docModels) {
    n++;
    const flagged = isFlagged(m);
    const open = expanded.has(field) || (flagged && !expanded.has('!' + field));
    blocks.push(renderField(field, m, flagged, open));
  }
  fieldCount.textContent = n;
  fieldList.innerHTML = blocks.join('');
  wireFieldEvents();
}

function showBanner(cls, ic, text) {
  banner.className = 'banner ' + cls;
  bannerIc.textContent = ic;
  bannerText.textContent = text;
}

function renderField(field, m, flagged, open) {
  const finalVal = m.final ? m.final.value : null;
  const finalMethod = m.final ? m.final.method : null;
  const reviewForced = !!(m.final && m.final.note);

  // Winning chain nodes: each 'win' merge, then transforms, then value-changing
  // validations, then the final node.
  const nodes = [];
  for (const w of m.wins) {
    const sm = stageMeta(w.stage);
    nodes.push(chainNode(sm, escapeHtml(w.value == null ? '—' : String(w.value)),
      w.confidence, w.method, field, hasCrop(field, w.stage), false, captionHtml(w.caption)));
  }
  for (const t of m.transforms) {
    const sm = stageMeta(t.stage);
    nodes.push(chainNode(sm,
      `<span class="from">${escapeHtml(shownVal(t.from))}</span> <span class="arrow">→</span> <span class="to">${escapeHtml(shownVal(t.to))}</span>`,
      null, null, field, false, true));
  }
  for (const v of m.validations) {
    if (!v.note && !v.corrected_to && v.was === v.value) continue;
    const sm = stageMeta('4_validate');
    let val = escapeHtml(shownVal(v.value));
    if (v.corrected_to) val += ` <span class="arrow">→ candidate</span> <span class="to">${escapeHtml(v.corrected_to)}</span>`;
    const desc = v.note ? `<span class="desc">${escapeHtml(v.note)}</span>` : '';
    nodes.push(chainNode(sm, val, v.confidence, null, field, false, false, desc));
  }
  // Stage 4 TOTAL reconciliation maths (SFDEV): the exact sum + which component was MISSING.
  if (m.reconcile) {
    const rc = m.reconcile;
    const c = (lbl, val) => val === 'MISSING' ? `MISSING(${lbl})` : `${val}(${lbl})`;
    const calc = `${rc.subtotal} + ${c('tax', rc.tax)} + ${c('ship', rc.shipping)} − ${c('disc', rc.discount)} = ${rc.computed} vs total ${rc.total} (Δ ${rc.delta}, tol ${rc.tol}) → ${rc.reconciles ? 'reconciles' : "doesn't reconcile"}`;
    const desc = rc.verdict ? `<span class="desc">${escapeHtml(String(rc.verdict))}</span>` : '';
    nodes.push(chainNode(stageMeta('4_validate'), escapeHtml(calc), null, 'reconcile', field, false, false, desc));
  }
  // Final node — plus the CORROBORATION line (owner principle 2026-08-11: agreement between
  // INDEPENDENT method families is evidence; same-family agreement counts for nothing). Green
  // when an independent family agrees with the winner, amber when one read a DIFFERENT value —
  // the disagreement surfaces HERE first, deliberately, before it is allowed to move anything.
  if (m.final) {
    const cb = m.final.corrob;
    let corrobLine = '';
    if (cb && (cb.agree || []).length) {
      corrobLine = `<div class="desc" style="color:var(--ok)" title="independent method families that read the same value">✓ corroborated by ${escapeHtml(cb.agree.join(' + '))}</div>`;
    } else if (cb && (cb.disagree || []).length) {
      const d = cb.disagree.map(x => `${x.family}: “${shownVal(x.value)}”`).join(' · ');
      corrobLine = `<div class="desc" style="color:var(--warn)" title="an independent method family read a different value — nothing acts on this yet; it is recorded so it can be seen">⚠ uncorroborated — ${escapeHtml(d)}</div>`;
    } else if (cb) {
      corrobLine = `<div class="desc" style="color:var(--muted)">sole witness (${escapeHtml(cb.winner_family || '?')})</div>`;
    }
    // Oracle C9 (2026-08-30): a DISCOUNTED witness (a deterministically unreadable amount the record no
    // longer counts as a dissent — CORROB_DISCOUNT_INVALID_WITNESS) is shown beside the verdict so the
    // census stays auditable; the re-slice witness (RESLICE_WITNESS_SWEEP) likewise names its rung.
    if (cb && (cb.discounted || []).length) {
      const d = cb.discounted.map(x => `${x.family}: “${shownVal(x.value)}”`).join(' · ');
      corrobLine += `<div class="desc" style="color:var(--muted)" title="a candidate that cannot be an amount/date at all — noise, not a second opinion; recorded, never a dissent">∅ discounted (unreadable) — ${escapeHtml(d)}</div>`;
    }
    if (cb && cb.reslice_witness && cb.reslice_witness.value != null) {
      const rw = cb.reslice_witness;
      corrobLine += `<div class="desc" style="color:var(--muted)" title="the taught zone re-read under a different recipe agreed with the committed value (witness only — the signed arms decide)">↻ re-slice witness ${escapeHtml(String(rw.rung || ''))}: “${escapeHtml(shownVal(rw.value))}” @${escapeHtml(String(rw.confidence ?? '?'))}</div>`;
    }
    nodes.push(`<div class="node final"><div class="rail"><div class="dot"></div></div>`
      + `<div class="body"><div class="stage-line"><span class="sbadge s2" style="background:rgba(62,207,142,.16);color:var(--final)">★ FINAL</span>`
      + (reviewForced ? `<span class="desc" style="color:var(--warn)">held for review</span>` : '')
      + `</div><div class="val-line">${escapeHtml(shownVal(finalVal))} ${finalMethod ? `<span class="conf">${escapeHtml(finalMethod)}</span>` : ''}</div>`
      + corrobLine + `</div></div>`);
  }

  // Reprocess-merge node (post-pipeline JS decision) — shown first if present.
  let reprNode = '';
  for (const r of m.reprocess) {
    const kept = r.decision === 'kept_existing';
    reprNode += `<div class="node rm"><div class="rail"><div class="dot"></div></div><div class="body">`
      + `<div class="stage-line"><span class="sbadge rm">↻ reprocess merge</span>`
      + `<span class="desc">${kept ? 'kept existing value' : 'used reprocessed value'}</span></div>`
      + `<div class="val-line"><span class="from">old: ${escapeHtml(shownVal(r.old))}</span> &nbsp; <span class="to">new: ${escapeHtml(shownVal(r.new))}</span></div>`
      + `</div></div>`;
  }

  // Losers
  let othersHtml = '';
  if (m.losers.length) {
    const losers = m.losers.map(l => {
      const sm = stageMeta(l.stage);
      const winnerConf = l.vs ? l.vs.confidence : null;
      const reason = (winnerConf != null && l.confidence != null && l.confidence < winnerConf)
        ? `lower confidence (${l.confidence}% < ${winnerConf}%)`
        : 'superseded (reason not recorded)';
      const vs = l.vs && l.vs.value != null ? ` vs <b>${escapeHtml(String(l.vs.value))}</b>` : '';
      return `<div class="loser"><div class="stage-line"><span class="sbadge ${sm.cls}">${escapeHtml(sm.label)}</span>`
        + (l.method ? `<span class="conf">${escapeHtml(l.method)}</span>` : '')
        + captionHtml(l.caption) + `</div>`
        + `<div class="val-line">${escapeHtml(shownVal(l.value))} ${confBar(l.confidence)}</div>`
        + `<div class="reason">✗ lost${vs} — ${reason}</div></div>`;
    }).join('');
    othersHtml = `<div class="others"><div class="others-toggle"><span class="chev">▸</span>Other candidates (${m.losers.length})</div><div class="others-body">${losers}</div></div>`;
  }

  // Collapsed summary line
  const winStage = m.wins.length ? stageMeta(m.wins[m.wins.length - 1].stage)
                 : (m.final ? { cls: 's1', label: m.final.method || 'resolved' } : { cls: 's1', label: '—' });
  const summary = `<span class="sbadge ${winStage.cls}">${escapeHtml(winStage.label)}</span>`
    + (m.losers.length ? `<span class="others-hint">+${m.losers.length} other candidate${m.losers.length === 1 ? '' : 's'}</span>` : '')
    + (m.transforms.length ? `<span class="others-hint">· OCR-corrected</span>` : '');

  const finalClass = finalVal == null || finalVal === '' ? ' empty' : '';
  return `<div class="field${open ? ' open' : ''}${flagged ? ' flagged' : ''}" data-field="${escapeHtml(field)}">`
    + `<div class="field-head"><span class="chev">▸</span><span class="field-name">${escapeHtml(field)}</span>`
    + (flagged ? `<span class="flag-ic" title="validation-flagged / held for review">⚠</span>` : '')
    + `<span class="field-final-val${finalClass}">${escapeHtml(shownVal(finalVal))}</span></div>`
    + `<div class="field-summary">${summary}</div>`
    + `<div class="field-detail">`
    + `<div class="final-box${reviewForced ? ' review' : ''}"><span class="star">★</span><span class="fv">${escapeHtml(shownVal(finalVal))}</span>`
    + (m.final && m.final.confidence != null ? `<span class="fm">conf ${m.final.confidence}%</span>` : '')
    + `<span class="fm">${finalMethod ? escapeHtml(finalMethod) : ''}</span></div>`
    + (m.final && m.final.note ? `<div class="reason" style="color:var(--warn);margin:-6px 0 12px">⚠ ${escapeHtml(m.final.note)}</div>` : '')
    + ladderHtml(m)
    + `<div class="sec-label">Winning lineage <span class="approx" title="The Every-step ladder above is engine-declared. This lineage CHAIN (order + transforms) is still reconstructed from trace events — treat as best-effort.">approx</span></div>`
    + `<div class="chain">${reprNode}${nodes.join('')}</div>`
    + othersHtml
    + `</div></div>`;
}

function chainNode(sm, valHtml, conf, method, field, crop, isTransform, extraDesc) {
  return `<div class="node ${sm.cls}"><div class="rail"><div class="dot"></div></div><div class="body">`
    + `<div class="stage-line"><span class="sbadge ${sm.cls}">${escapeHtml(sm.label)}</span>`
    + (method ? `<span class="conf">${escapeHtml(method)}</span>` : '')
    + (crop ? `<span class="crop-chip" data-crop="${escapeHtml(field)}">▣ crop</span>` : '')
    + (extraDesc || '') + `</div>`
    + `<div class="val-line">${valHtml} ${conf != null ? confBar(conf) : ''}</div>`
    + `</div></div>`;
}

function hasCrop(field, stage) {
  const sl = slicesByField.get(field) || [];
  if (stage === '2_anchor' || stage === 'anchor_crop') return sl.some(s => s.stage === 'anchor_crop');
  if (stage === '0.5_mapping' || stage === 'template_mapping') return sl.some(s => s.stage === 'template_mapping');
  return sl.length > 0;
}

function wireFieldEvents() {
  fieldList.querySelectorAll('.field-head').forEach(h => {
    h.addEventListener('click', () => {
      const f = h.parentElement.dataset.field;
      const fieldEl = h.parentElement;
      const willOpen = !fieldEl.classList.contains('open');
      fieldEl.classList.toggle('open', willOpen);
      // Track explicit user intent so auto-expand of flagged fields is overridable.
      if (willOpen) { expanded.add(f); expanded.delete('!' + f); }
      else { expanded.delete(f); expanded.add('!' + f); }
      if (willOpen) showEvidence(f);
    });
  });
  fieldList.querySelectorAll('.others-toggle').forEach(t =>
    t.addEventListener('click', () => t.parentElement.classList.toggle('open')));
  fieldList.querySelectorAll('.crop-chip').forEach(c =>
    c.addEventListener('click', (e) => { e.stopPropagation(); showEvidence(c.dataset.crop); }));
}

// ── Page evidence pane ──────────────────────────────────────────────────────
function clearEvidence() {
  selectedField = null;
  evField.textContent = '';
  evBody.innerHTML = '<div class="ev-none">Select a field to view the OCR crop behind its value.</div>';
}

async function showEvidence(field) {
  selectedField = field;
  evField.textContent = '· ' + field;
  const all = slicesByField.get(field) || [];
  const m = docModels.get(field);
  const finalMethod = (m && m.final && m.final.method) || '';

  if (!all.length) {
    const kw = /keyword/i.test(finalMethod);
    evBody.innerHTML = `<div class="ev-none"><span class="pin">◌</span> No crop captured for this field.`
      + (kw ? ` Keyword/regex matches have no spatial anchor — the value came from the OCR text layer.` : ` This stage did not crop a region.`)
      + `</div>`;
    return;
  }

  // Value/target crops first (the region OCR'd for the value), then anchor crops.
  const targets = all.filter(s => s.kind !== 'anchor');
  const anchors = all.filter(s => s.kind === 'anchor');
  const parts = [];
  if (/keyword/i.test(finalMethod)) {
    parts.push(`<div class="ev-none" style="margin-bottom:10px">The final value came from <b>${escapeHtml(finalMethod)}</b>; the crops below are from a non-winning anchor/mapping candidate.</div>`);
  }
  for (const ev of [...targets, ...anchors]) parts.push(await sliceItem(ev));
  evBody.innerHTML = '';
  const wrap = document.createElement('div');
  for (const p of parts) {
    if (typeof p === 'string') { const d = document.createElement('div'); d.innerHTML = p; wrap.appendChild(d.firstChild || d); }
    else wrap.appendChild(p);
  }
  evBody.appendChild(wrap);
}

async function sliceItem(ev) {
  const sm = stageMeta(ev.stage);
  const item = document.createElement('div');
  item.className = 'slice-item';
  const bbox = Array.isArray(ev.bbox) ? ' · bbox ' + ev.bbox.map(n => (+n).toFixed(3)).join(', ') : '';
  const cap = document.createElement('div'); cap.className = 'cap';
  cap.innerHTML = `<span class="sbadge ${sm.cls}">${escapeHtml(sm.label)}</span> ${escapeHtml(ev.kind || 'target')}`;
  const sub = document.createElement('div'); sub.className = 'sub';
  sub.textContent = `page ${ev.page ?? 0}${bbox}`;
  item.append(cap, sub);
  let uri = null;
  try { uri = await window.docusnap.devGetSlice(ev.path); } catch {}
  if (uri) { const img = document.createElement('img'); img.alt = (ev.kind || '') + ' crop'; img.src = uri; item.appendChild(img); }
  else { const n = document.createElement('div'); n.className = 'ev-none'; n.textContent = 'Slice file no longer available (cleaned up).'; item.appendChild(n); }
  return item;
}

// ── Live telemetry (read-only mirror) ───────────────────────────────────────
let liveDocKey = null;

function describe(m) {
  switch (m.type) {
    case 'start':      return `Starting — ${m.total || 0} document${m.total === 1 ? '' : 's'} queued`;
    case 'file_begin': return `Reading "${m.filename || '…'}"`;
    case 'file_done': {
      const name = m.original_filename || m.filename || 'document';
      const type = m.document_type || 'unknown type';
      const conf = (m.overall_confidence != null) ? `, ${m.overall_confidence}%` : '';
      return `Finished "${name}" — ${type}${conf}${m.needs_review ? ' — needs review' : ''}`;
    }
    default: return null;
  }
}

function setRunning(on) {
  tbRun.textContent = on ? 'running' : 'idle'; tbRun.className = 'tb-pill ' + (on ? 'on' : 'off');
  livePill.textContent = on ? 'running' : 'idle'; livePill.className = on ? 'on' : 'off';
}

function handleTelemetry(m, source) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'start') { total = m.total || 0; done = 0; updateProgress(); setRunning(true); }
  else if (m.type === 'file_begin') { liveFile.textContent = m.filename || '—'; liveDocKey = m.filename || null; setRunning(true); }
  else if (m.type === 'file_done') { done += 1; updateProgress(); if (total && done >= total) setRunning(false); }
  else if (m.type === 'log') {
    liveDetail.textContent = m.text || '';
    appendLog((source === 'reprocess' ? '[reprocess] ' : '') + (m.text || ''), m.level);
  }
  const headline = describe(m);
  if (headline) liveAct.textContent = headline;
}

function updateProgress() {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  liveBar.style.width = pct + '%';
  liveProg.textContent = `${done} / ${total}`;
}

function appendLog(text, level) {
  const line = document.createElement('div');
  line.className = 'log-line' + (level ? ' ' + level : '');
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
document.getElementById('log-head').addEventListener('click', () => {
  const open = logEl.classList.toggle('open');
  logToggle.textContent = open ? 'Hide' : 'Show';
});

// ── Live trace: follow the in-flight document (until the user picks one) ──────
let liveRenderTimer = null;
function handleTrace(ev) {
  if (!ev || typeof ev !== 'object' || !ev.doc) return;
  if (autoFollow && ev.doc !== selectedDoc) { selectDoc(ev.doc); return; }
  if (ev.doc === selectedDoc) {
    // Re-fetch the full event list and re-render, debounced so a burst of stage
    // events during processing doesn't thrash the DOM (simple + correct — the
    // per-doc event volume is small).
    clearTimeout(liveRenderTimer);
    liveRenderTimer = setTimeout(() => refreshSelectedDoc(), 120);
  }
}

// ── Subscribe ────────────────────────────────────────────────────────────────
window.docusnap.onProcessProgress((m)   => { handleTelemetry(m, 'process');   if (m.type === 'file_done') refreshDocs(); });
window.docusnap.onReprocessProgress((m) => { handleTelemetry(m, 'reprocess'); if (m.type === 'file_done') refreshDocs(); });
window.docusnap.onProcessTrace((ev)     => handleTrace(ev));

setFollow();
refreshDocs();
window.docusnap.devInspectorRunning?.().then((on) => { if (on) setRunning(true); }).catch(() => {});
