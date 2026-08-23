'use strict';
/*
 * Teach-a-new-document wizard (guided, non-technical).
 * Orchestrates EXISTING IPC only; mutations are deferred to the Commit step so
 * Back/Cancel are always safe. Region step saves a Stage 0.5 anchor→target
 * mapping per field (Oscar's recommendation): the user boxes only the VALUE and
 * the wizard auto-detects the nearby label as the anchor. Commit sequence:
 *   promoteToTemplate (creates template + pins sample → auto-landmarks)
 *   → saveTemplateMapping per field → confirmReview (files + learns).
 */
const D = window.docusnap;
const $ = (id) => document.getElementById(id);

const TYPE_MAP = { Text: 'text', Date: 'date', Currency: 'currency', Number: 'number' };

const state = {
  step: 0,
  maxStep: 5,
  minStep: 0,          // floor — 2 when launched at a known doc (skip welcome + doc-pick)
  docs: [],            // review-queue rows to choose from
  doc: null,           // chosen row {id, folder_path, original_filename, supplier_name}
  pageDataUrl: null,
  img: null,           // loaded Image (natural size) — the STRAIGHTENED render while deskew is on, else rawImg
  rawImg: null,        // the RAW page render (always) — boxes are STORED in this frame
  deskewImg: null,     // the straightened render (cached once fetched)
  deskewImgAngle: 0,   // the detected angle of deskewImg (fixed once fetched)
  deskewAngle: 0,      // angle CURRENTLY applied to state.img (deskewImgAngle when on, 0 when showing raw)
  // MULTI-PAGE (2026-08-08). The wizard used to resolve getDocumentPages(...) to pages[0] and hard-
  // code page_number:0 on commit — so a value on page 2 simply could not be taught. The hardcode was
  // TRUTHFUL rather than a bug (there was no way to reach another page), which is why it had to be
  // replaced in the SAME change as the navigation: replacing it alone would have been a no-op at
  // best. Every field remembers the page its box was drawn on, so one template can teach fields
  // spread across pages.
  pages: [],           // every rendered page data-URL for the chosen doc (was: only the first)
  pageIndex: 0,        // the page currently on the canvas
  pageCache: {},       // idx -> {rawImg, deskewImg, deskewImgAngle} so flipping back is instant
  docTypeSlug: null,
  docTypeName: null,
  fields: [],          // [{key,label,type,required}]
  newFields: [],       // for the create-type panel [{label,key,type}]
  fieldIndex: 0,
  results: {},         // key -> {value, target:{x,y,w,h}, anchor:{x,y,w,h}|null, anchor_text|null, status:'done'|'skip'}
  targetDocId: null,
};

// ── Titlebar ─────────────────────────────────────────────────────────────────
$('win-min').onclick   = () => D.windowMinimise();
$('win-close').onclick = () => confirmCancel();

// ── Help: user guide + contextual help mode ───────────────────────────────────
$('btn-help-guide')?.addEventListener('click', () => D.openHelpWindow('teach'));
window.initHelpMode?.('help-mode-toggle', {
  'next':      'Move to the next step. On the final step this is what saves the document type, the field map and files the document.',
  'back':      'Return to the previous step. Nothing is saved until the final step, so going back is always safe.',
  'cancel':    'Stop teaching and close. Nothing is saved unless you reach and complete the final step.',
  'user-guide':'Open the full user guide.',
  'teach-canvas':'Draw a box around a field’s value on the page. Scan Finder reads it back so you can check it’s right.',
  'teach-zoom':'Zoom the document in or out; Reset fits it to the pane. The page stays sharp.',
  'rg-skip':   'This document does not print this field — leave it untaught and carry on. Nothing is guessed, and no box is saved for it. If this sender NEVER shows the field, you can also hide it for this template in Settings → Templates.',
  'rg-fieldlist':'The fields for this document type, and which ones you’ve pointed out so far.',
  'help-mode': 'Help mode: click any control to see what it does. Press Esc to leave.',
  'teach-another':'Start again at the document list and teach the next one. This document is already filed.',
});
$('btn-cancel').onclick = () => confirmCancel();
function confirmCancel(){
  if (confirm('Stop teaching? Nothing is saved yet.')) D.windowClose();
}

// `ms` added 2026-08-11: the default 1600ms is right for a confirmation and far too short for
// a WARNING the operator has to read and act on (see finishIssuerField).
function toast(msg, ms){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), ms || 1600); }

// ── Step router ────────────────────────────────────────────────────────────
function setStep(n){
  state.step = Math.max(0, Math.min(state.maxStep, n));
  document.querySelectorAll('.step').forEach(s =>
    s.classList.toggle('active', Number(s.dataset.step) === state.step));
  renderFooter();
  onEnterStep(state.step);
}
function renderFooter(){
  const dots = $('dots'); dots.innerHTML='';
  for (let i=0;i<=state.maxStep;i++){ const d=document.createElement('span'); d.className='sd'+(i===state.step?' on':''); dots.appendChild(d); }
  $('btn-back').style.visibility = state.step<=state.minStep ? 'hidden' : 'visible';
  const next = $('btn-next');
  // The last button must say what it really does: SAVE THE TEACHING and file (Chris, both
  // rounds: "no mention of teaching" on the one button that commits it).
  const labels = ["Let's start →","Continue →","Continue →","Review →","Save teaching & file","Done"];
  next.textContent = labels[state.step];
  next.disabled = !canAdvance();
  $('btn-cancel').style.visibility = state.step===5 ? 'hidden' : 'visible';
}
function canAdvance(){
  switch(state.step){
    case 1: return !!state.doc;
    case 2: return !!$('type-grid').querySelector('.card.sel') &&
                   (!isNewTypeSelected() || newTypeReady());
    case 3: return state.fields.length>0 && state.fields.every(f => {
      const r=state.results[f.key]; return r && r.status !== 'pending';
    });
    default: return true;
  }
}
$('btn-back').onclick = () => { if (state.step>state.minStep) setStep(state.step-1); };
$('btn-next').onclick = onNext;

async function onNext(){
  if (!canAdvance()) return;
  if (state.step===2){ const ok = await commitTypeChoice(); if (!ok) return; }
  if (state.step===4){ await doCommit(); return; }
  setStep(state.step+1);
}

function onEnterStep(n){
  if (n===1) renderDocPicker();
  if (n===2) renderTypeStep();
  if (n===3) startRegionStep();
  if (n===4) renderSummary();
}

// ── Step 1: choose document ──────────────────────────────────────────────────
async function renderDocPicker(){
  const grid=$('doc-picker'); grid.innerHTML='';
  if (!state.docs.length){
    try { state.docs = await D.getReviewQueue() || []; } catch { state.docs=[]; }
  }
  $('doc-picker-empty').classList.toggle('hidden', state.docs.length>0);
  // Filter box — shown only when the queue is big enough to need one (Chris r2 2026-08-11:
  // 161 documents, no search). Matches file name, sender and type, case-insensitive.
  const search=$('doc-picker-search');
  if (search){
    search.style.display = state.docs.length>8 ? '' : 'none';
    if (!search._wired){ search._wired=true; search.addEventListener('input',()=>renderDocPicker()); }
  }
  const term=(search&&search.style.display!=='none'?search.value:'').trim().toLowerCase();
  const shown = term
    ? state.docs.filter(d => [d.original_filename, d.supplier_name, d.type_name]
        .some(v => String(v||'').toLowerCase().includes(term)))
    : state.docs;
  $('doc-picker-nomatch')?.classList.toggle('hidden', !(term && !shown.length && state.docs.length));
  for (const d of shown){
    const c=document.createElement('div'); c.className='card'+(state.doc&&state.doc.id===d.id?' sel':'');
    const name=d.original_filename||('Document #'+d.id);
    // 📄 emoji is the placeholder; the real page-1 thumbnail replaces it once
    // loaded. A doc with no renderable thumbnail keeps the emoji.
    c.innerHTML=`<div class="ic"><span class="ic-emoji">📄</span><img class="ic-thumb" alt=""></div>`+
      `<div class="nm" style="font-size:13px;word-break:break-all">${esc(name)}</div>`+
      `<div class="muted" style="font-size:12px">${esc(d.supplier_name||'Sender not identified')}</div>`;   // ONE phrase for the unknown-sender state everywhere (Chris r2 2026-08-11 saw four)
    if (window.Thumbs) window.Thumbs.lazy(c.querySelector('.ic-thumb'), d);
    // Toggle the selection IN PLACE. A full re-render rebuilt every card and re-ran the
    // lazy thumbnail loader on all of them, and left the enlarged state depending on a
    // clean rebuild every time. Toggling makes "exactly one card is big" true by
    // construction — no card can keep the big styling after another is picked.
    c.onclick=()=>{
      state.doc=d;
      _prefetchTeachPage();                // start the background page render the moment it's picked
      for (const el of grid.querySelectorAll('.card')) el.classList.toggle('sel', el===c);
      renderFooter();
    };
    grid.appendChild(c);
  }
  // Open with one card already big, so the step starts in the state a click produces
  // rather than with every card the same size and nothing to look at.
  if (!state.doc && shown.length){
    state.doc = shown[0];
    _prefetchTeachPage();                  // prefetch the default pick too, so accepting it is instant
    const first = grid.querySelector('.card');
    if (first) first.classList.add('sel');
    renderFooter();
  }
}

// Import a single PDF to teach (esp. when the queue is empty): stage it in a temp folder,
// run the normal import path, then pick the new doc from the refreshed queue.
$('btn-import-teach')?.addEventListener('click', async () => {
  const btn = $('btn-import-teach'), st = $('import-teach-status');
  let staged;
  try { staged = await D.stagePdfForTeach(); } catch { staged = null; }
  if (!staged) return;                              // cancelled
  if (staged.error) { if (st) st.textContent = 'Could not open that file.'; return; }
  const lbl = btn.textContent;
  btn.disabled = true; btn.textContent = 'Importing…';
  if (st) st.textContent = 'Reading the document…';
  const bar = $('teach-import-progress');
  if (bar) bar.classList.add('active');
  // Progress subscription (eric): remove-before-add so a 2nd import in the same session can't
  // double-register; window-scoped ipcRenderer, so removeAllListeners clears only this window's.
  D.removeProgress && D.removeProgress();
  D.onProgress && D.onProgress(teachProgress);
  try {
    await D.processFolder(staged.folder, { autoFile: false });  // same import path, but DON'T auto-file (keep it in Review to teach)
    state.docs = await D.getReviewQueue() || [];
    const match = state.docs.filter(d => d.original_filename === staged.filename).sort((a, b) => b.id - a.id)[0];
    if (match) { state.doc = match; _prefetchTeachPage(); }   // read done -> start the page render in the background
    await renderDocPicker(); renderFooter();
    if (st) st.textContent = match ? 'Imported — selected below.' : 'Imported. Pick it below.';
  } catch (e) {
    if (st) st.textContent = 'Import failed: ' + (e.message || 'unknown error');
  } finally {
    D.removeProgress && D.removeProgress();
    if (bar) bar.classList.remove('active');
    btn.disabled = false; btn.textContent = lbl;
  }
});

// Import read-progress readout. A single doc's OCR has no sub-% (start -> file_begin -> file_pages
// -> file_done), so the bar is indeterminate (animated) and only the TEXT is event-driven.
function teachProgress(msg) {
  const st = $('import-teach-status');
  if (!msg || !st) return;
  if (msg.type === 'file_begin')      st.textContent = 'Reading the document…';
  else if (msg.type === 'file_pages' && (msg.pages > 1))
                                       st.textContent = 'Multi-page document (' + msg.pages + ' pages)…';
  else if (msg.type === 'file_done')  st.textContent = 'Read complete.';
}

// ── Step 2: choose / create type ─────────────────────────────────────────────
async function renderTypeStep(){
  const grid=$('type-grid'); grid.innerHTML='';
  let types=[]; try{ types = await D.getAllDocTypes() || []; }catch{}
  for (const t of types){
    const c=document.createElement('div'); c.className='card';
    c.dataset.slug=t.slug; c.dataset.name=t.name;
    c.innerHTML=`<div class="ic">🗂️</div><div class="nm">${esc(t.name)}</div>`;
    c.onclick=()=>selectType(c,false);
    grid.appendChild(c);
  }
  const nu=document.createElement('div'); nu.className='card dashed'; nu.id='card-new';
  nu.innerHTML='<div class="ic">＋</div><div class="nm">It\'s something new</div>';
  nu.onclick=()=>selectType(nu,true);
  grid.appendChild(nu);
  // Wire the top hatch: expanding it IS choosing "It's something new" (selects the card, mounts
  // the create editor in the top slot, focuses the name box). Grid rebuilds drop every `.sel`,
  // so default to collapsed — EXCEPT while an EDIT editor owns the slot: the mid-teach edit flow
  // re-renders this grid on every change (onChange -> renderTypeStep) and must not have its
  // editor torn down or hidden under the cursor.
  const _head = $('nt-panel-head');
  if (_head) _head.onclick = () => {
    const host = $('nt-editor-host');
    if (dtEditorMode === 'edit') return;                     // the edit flow owns the slot
    if (host && !host.classList.contains('hidden') && isNewTypeSelected()){
      _setNtExpanded(false);                                 // second click folds it away
      const sel = $('type-grid').querySelector('.card.sel');
      if (sel && sel.id === 'card-new') sel.classList.remove('sel');
      renderFooter();
      return;
    }
    const nu = document.getElementById('card-new');
    if (nu) selectType(nu, true);
  };
  if (dtEditorMode !== 'edit') _setNtExpanded(false);
  // PARITY WITH SETTINGS (owner, 2026-08-10). The type EDITOR was already the shared component, so
  // fields and structural roles matched; the CATALOG was not, so a type built here started empty
  // while the same type built in Settings arrived with its fields AND its likely printed labels
  // already seeded. Re-render after adding so the new types are immediately pickable — the operator
  // is mid-teach with a document in front of them and must not have to restart the wizard.
  // Rebuilding the grid drops every `.sel`, so "Edit this type…" must go back to its
  // nothing-is-picked state with it — otherwise it would stay armed against a card that is no
  // longer selected (the onChange re-select path below re-arms it explicitly).
  setEditTypeEnabled(false);
  const cat=$('btn-teach-catalog');
  if (cat && window.DocTypeCatalog){
    cat.onclick=async()=>{
      await window.DocTypeCatalog.open({ api:D, onAdded: async()=>{
        await renderTypeStep();
        toast('Added. Now pick the one this document is.');
      }});
    };
  }
}
// "Edit this type…" is always ON SCREEN; only its enabled state changes. The description line is
// the explanation the owner asked for, and it does double duty — while disabled it says what to do
// first, and while enabled it names the SCOPE, because editing a type changes it everywhere that
// type is used, not just for the document being taught.
const EDIT_TYPE_DESC_OFF = 'Pick a type above first — then you can change its fields and the printed labels Scan Finder looks for.';
const EDIT_TYPE_DESC_ON  = 'Change its fields, or the printed labels Scan Finder looks for. Applies everywhere this type is used.';
function setEditTypeEnabled(on){
  const eb=$('btn-teach-edit-type'); if(!eb) return;
  eb.disabled = !on;
  const d=$('teach-edit-type-desc');
  if (d) d.textContent = on ? EDIT_TYPE_DESC_ON : EDIT_TYPE_DESC_OFF;
}

let dtEditor = null;   // shared DocTypeEditor, mounted in the ALWAYS-VISIBLE top panel
let dtEditorMode = null;   // 'create' | 'edit' — which flavour currently owns #nt-editor-host

// The top panel: COLLAPSED to a one-line hatch by default (owner screenshot 2026-08-11 — the
// always-open editor buried the existing-type cards); expands IN PLACE at the top of the step,
// so on lower-res displays the editor is visible the moment it exists. The create draft survives
// a collapse (the editor stays mounted, only hidden).
function _ensureCreateEditor(){
  if (dtEditor && dtEditorMode === 'create') return;         // keep the in-progress draft
  if (dtEditor){ try{ dtEditor.destroy(); }catch{} dtEditor=null; $('nt-editor-host').innerHTML=''; }
  if (!window.DocTypeEditor) return;
  dtEditor = window.DocTypeEditor.create($('nt-editor-host'), {
    mode:'create', api:D,
    onValidityChange: () => renderFooter(),   // live-enable the Continue button
  });
  dtEditorMode = 'create';
}
function _setNtExpanded(on){
  const host = $('nt-editor-host'); if (!host) return;
  host.classList.toggle('hidden', !on);
  const head = $('nt-panel-head');
  if (head && dtEditorMode !== 'edit'){
    head.textContent = on
      ? 'Name your new type below — or pick one of your existing types instead.'
      : 'It’s something new? Create a type here…';
  }
}

// EDIT AN EXISTING TYPE, MID-TEACH (owner parity request, 2026-08-10). Settings can change a
// type's fields, roles and "Also appears as" aliases; the wizard could only CREATE. That gap bites
// exactly when it is most annoying: you are holding the document, you can see the type is missing a
// field you are about to point at, and the only route was to abandon the teach and open Settings.
// Same shared component, `mode:'edit'` — so whatever Settings can change here, the wizard can too,
// and neither can drift from the other.
async function openTypeEditorFor(slug){
  let types=[]; try{ types=await D.getAllDocTypes()||[]; }catch{}
  const t=types.find(x=>x.slug===slug);
  if (!t) return;
  if (dtEditor){ try{ dtEditor.destroy(); }catch{} dtEditor=null; }
  $('nt-editor-host').innerHTML='';
  dtEditorMode = 'edit';
  const head = $('nt-panel-head');
  if (head) head.textContent = `Editing “${t.name}” — changes apply everywhere this type is used.`;
  $('nt-editor-host').classList.remove('hidden');
  dtEditor = window.DocTypeEditor.create($('nt-editor-host'), {
    mode:'edit', api:D, initial:t,
    // A field added here must reach the step the operator is walking through, or they would edit
    // the type, see nothing change, and reasonably conclude it had not saved.
    onChange: async () => {
      let fresh=[]; try{ fresh=await D.getAllDocTypes()||[]; }catch{}
      const u=fresh.find(x=>x.slug===slug);
      if (u){
        state.refFieldKey=u.ref_field_key||null; state.dateFieldKey=u.date_field_key||null;
        { const _sp=_splitListFields((u.fields||[]).filter(f=>f.enabled!==0)
            .map(f=>({key:f.key,label:f.label,type:f.type,required:!!f.required})));
          state.fields=_sp.teach; state.listFields=_sp.lists; }
      }
      await renderTypeStep();
      const again=$('type-grid').querySelector(`.card[data-slug="${slug}"]`);
      if (again) again.classList.add('sel');
      renderFooter();
    },
  });
}

function selectType(card,isNew,opts){
  document.querySelectorAll('#type-grid .card').forEach(c=>c.classList.remove('sel'));
  card.classList.add('sel');
  // "Edit this type…" belongs to an EXISTING selection only — there is nothing to edit before the
  // new type exists, and the create editor is already on screen in that case.
  // Visible-but-DISABLED rather than hidden: a control that only exists after you click something
  // else can't be discovered, and its absence explains nothing. The description line carries the
  // reason while it is off, and states the SCOPE once it is on.
  setEditTypeEnabled(!isNew);
  const eb=$('btn-teach-edit-type');
  if (eb) eb.onclick = () => { if (!eb.disabled) openTypeEditorFor(card.dataset.slug); };
  // The top hatch expands for "new", collapses for an existing pick. An EDIT-mode editor is torn
  // down when another card is chosen; a CREATE draft survives collapse (mounted, hidden).
  if (!isNew && dtEditorMode === 'edit'){
    try{ dtEditor.destroy(); }catch{} dtEditor=null; dtEditorMode=null; $('nt-editor-host').innerHTML='';
  }
  if (isNew){
    _ensureCreateEditor();
    _setNtExpanded(true);
    if (!opts || opts.focus !== false){
      const first = $('nt-editor-host').querySelector('input, select, textarea');
      if (first) try { first.focus(); } catch {}
    }
  } else {
    _setNtExpanded(false);
  }
  renderFooter();
}
function isNewTypeSelected(){ const s=$('type-grid').querySelector('.card.sel'); return s && s.id==='card-new'; }
function newTypeReady(){ return !!dtEditor && dtEditor.isReady(); }
// (The inline create-form — chips, key selectors, and their listeners — is gone;
//  the shared DocTypeEditor component now owns the new-type fields + role pickers.)

// Every install doc-type NAME + its "Also appears as" title_aliases (+ the just-created type):
// the pass-2 label re-read must never accept a TYPE HEADING as an anchor (the a666b83 class —
// a heading appears on every doc of that type, so the anchor re-locates wrongly everywhere).
// isTypeHeadingLabel is JSON-string tolerant, so title_aliases can ride raw.
function _collectTypeHeadingNames(types, extra){
  const names=[];
  for (const t of (types||[])){
    if (t && t.name) names.push(t.name);
    if (t && t.title_aliases) names.push(t.title_aliases);
  }
  if (extra) names.push(extra);
  return names;
}
// LIST fields are caption-collected, never box-taught (Oracle C1, 2026-08-11): a stored box for a
// list field would be silently dead — the scan owns the field — and a dead operator instruction is
// the inverse-of-"teaching must never hurt" class. They are pulled from the capture flow HERE, at
// teach time, with the reason on screen, rather than accepted and ignored.
function _splitListFields(fields){
  if (!window.__listFieldTypeOn) return { teach: fields, lists: [] };
  const lists = fields.filter(f => String(f.type || '').toLowerCase() === 'list');
  return { teach: fields.filter(f => !lists.includes(f)), lists };
}

async function commitTypeChoice(){
  if (!isNewTypeSelected()){
    const card=$('type-grid').querySelector('.card.sel');
    state.docTypeSlug=card.dataset.slug; state.docTypeName=card.dataset.name;
    let types=[]; try{ types=await D.getAllDocTypes()||[]; }catch{}
    state.typeHeadingNames=_collectTypeHeadingNames(types, state.docTypeName);
    const t=types.find(x=>x.slug===state.docTypeSlug);
    state.refFieldKey=(t&&t.ref_field_key)||null; state.dateFieldKey=(t&&t.date_field_key)||null;
    { const _sp=_splitListFields((t&&t.fields?t.fields:[]).filter(f=>f.enabled!==0)
        .map(f=>({key:f.key,label:f.label,type:f.type,required:!!f.required})));
      state.fields=_sp.teach; state.listFields=_sp.lists; }
    if (!state.fields.length){ toast('That type has no fields to teach.'); return false; }
    if (state.listFields.length){
      toast(`${state.listFields.map(f=>f.label).join(', ')}: collected automatically by label — nothing to draw for ${state.listFields.length===1?'it':'them'}.`, 4200);
    }
    return true;
  }
  // Create the new type via the shared editor (immediate commit; teach keeps its
  // original step-2 timing). The editor surfaces its own validation errors inline.
  if (!dtEditor) return false;
  const res=await dtEditor.commit();
  if (!res||!res.success) return false;
  const t=res.type;
  state.docTypeSlug = t ? t.slug : null;
  state.docTypeName = t ? t.name : '';
  { let types=[]; try{ types=await D.getAllDocTypes()||[]; }catch{}
    state.typeHeadingNames=_collectTypeHeadingNames(types, state.docTypeName); }
  state.refFieldKey=(t&&t.ref_field_key)||null; state.dateFieldKey=(t&&t.date_field_key)||null;
  { const _sp=_splitListFields((t&&t.fields?t.fields:[]).map(f=>({
      key:f.key, label:f.label, type:f.type,
      required:(f.key===t.ref_field_key || f.key===t.date_field_key),
    })));
    state.fields=_sp.teach; state.listFields=_sp.lists; }
  if (state.listFields && state.listFields.length){
    toast(`${state.listFields.map(f=>f.label).join(', ')}: collected automatically by label — nothing to draw for ${state.listFields.length===1?'it':'them'}.`, 4200);
  }
  return true;
}

// `ocrTypeFor` / OCR_TYPE_BY_FIELD_TYPE lived here until 2026-08-08 (owner decision: wire ocr_type
// or delete it — deleted). It computed a role-aware value for `template_field_mappings.ocr_type`,
// which NO production code reads: extraction's `val_type` comes from
// `engine._seed_field_patterns(base, field_defs)`, keyed on the document TYPE's field definitions,
// and the only consumers of the column were the dev CLI and a harness. Its own comment already
// said as much ("production-INERT for extraction"). The seeding was Oracle-signed in 2026-08-03 as
// a correctness improvement to a stored value, so removing it undoes nothing that ever affected a
// read — it removes the last reason to believe the column meant something.

// ── Step 3: region selection ─────────────────────────────────────────────────
// Two box kinds per field, drawn in the SAME normalised (0-1 of the page) coords
// the Template Manager + review Template Wizard use, so they line up everywhere:
//   value  (target) = GREEN  — what we read
//   label  (anchor) = BLUE   — the printed words we FOLLOW if the layout shifts
// drawMode routes the next drawn box; the value is required, the label is optional
// (auto-detected when not drawn).
let canvas, ctx, drag=null, drawnBox=null, drawMode='value';   // 'value' | 'anchor'
// Zoom/pan for the page canvas — same model as the review preview: a CSS transform
// (translate=pan, scale=zoom) on the canvas. Wiring + handlers live in bindCanvas.
let tzZoom=1, tzPanX=0, tzPanY=0, _tzPan=null, _fitW=0;
const TZ_MIN=1, TZ_MAX=4, TZ_STEP=0.25;
// Zoom by RE-SIZING the canvas (so the browser re-rasterises from the full-res backing
// store → crisp) rather than transform:scale (which magnifies the already-downscaled
// raster → blurry). Pan stays a translate. cpoint() normalises via getBoundingClientRect,
// so drawing coordinates remain correct at any zoom.
function tzApply(){
  if(!canvas) return;
  if (tzZoom<=1){
    canvas.style.maxWidth=''; canvas.style.maxHeight=''; canvas.style.width=''; canvas.style.height='';
    canvas.style.transform='translate(0px,0px)';
  } else {
    if(!_fitW){ _fitW = canvas.getBoundingClientRect().width || canvas.offsetWidth || 0; }
    if(_fitW){
      canvas.style.maxWidth='none'; canvas.style.maxHeight='none';
      canvas.style.width=(_fitW*tzZoom)+'px'; canvas.style.height='auto';
    }
    canvas.style.transform=`translate(${tzPanX}px,${tzPanY}px)`;
  }
  const lvl=$('tz-level'); if(lvl) lvl.textContent=Math.round(tzZoom*100)+'%';
}
function tzSet(z){ const nz=Math.max(TZ_MIN,Math.min(TZ_MAX,z)); if(nz>1 && tzZoom<=1) _fitW=0; tzZoom=nz; tzApply(); }
function tzReset(){ tzZoom=1; tzPanX=0; tzPanY=0; _fitW=0; tzApply(); }
// Park the INITIAL zoomed view at the TOP of the page rather than the vertical centre the
// flex-centred pane defaults to: the fields being taught (label/value) sit near the top, so the
// operator shouldn't have to scroll up on open. The pane centres the (over-tall) canvas, so its
// top sits (ch-ph)/2 above the pane; translate DOWN by that to bring the top flush. Panning is
// free afterwards; a no-op when the page fits (ch<=ph) or when not zoomed.
function tzShowTop(){
  if (!canvas || tzZoom<=1) return;
  const pane = canvas.parentElement; if (!pane) return;
  const ch = canvas.getBoundingClientRect().height, ph = pane.getBoundingClientRect().height;
  if (ch > ph){ tzPanY = (ch - ph) / 2; tzApply(); }
}
// Render the DISPLAY at a higher scale than the 1.5/108 DPI default so the page is crisp
// on a large/zoomed pane; the OCR crop is downscaled back to OCR_RENDER_SCALE in cropB64
// so read quality is unchanged. (Only applies to PDFs — an image file is returned at its
// native scan resolution, not re-rendered, so its OCR crop is left as-is.)
const TEACH_RENDER_SCALE = 4.0;   // 288 DPI display render (was 3.0/216) — crisper teach preview
// OCR reads degraded scans cleanest at a low resolution; a value line ~this many px tall
// is the sweet spot region.py reads well. The OCR crop is downscaled to land near here
// regardless of the (possibly much higher) DISPLAY render — see cropB64.
const OCR_TARGET_H = 28;
// Read the drawn box at NATIVE resolution, exactly as the Review window does. See cropB64.
const TEACH_NATIVE_CROP = true;
// Pick the anchor label by SCORE (the shared AnchorLabel.pickLabelCandidate the Review ⊕ tool uses)
// instead of by arrival order. See the block in autoLabel for the full rationale.
// Kill switch: TEACH_LABEL_PICK=false restores the left-first early return, byte-identical.
const TEACH_LABEL_PICK = true;
// The page fitted to the pane is too small to draw on accurately, so every user zoomed
// in by hand before their first box. Start where they were going anyway.
const TZ_DEFAULT = 1.5;
// ── Straighten (deskew) ──────────────────────────────────────────────────────
// Reuse the Review mechanism (get-page-deskew) + AnchorLabel's PROVEN coordinate transform. Boxes
// are STORED in the RAW frame (so doCommit → saveTemplateMapping registers to the raw scan, byte-
// identical to a non-straightened teach) and forward-transformed only for the on-screen overlay and
// a label re-read. get-page-deskew returns SAME pixel dims (expand=False) → canvas/zoom untouched.
const DESKEW_HARD_FLOOR = 0.2;
let _teachDeskewBusy = false;
let _teachReadBusy = false;                 // an OCR read is in flight → block a straighten toggle mid-read
function _teachBackBox(b){                 // display(straightened) -> raw, applied on STORE
  if (!b) return b;
  // Prefer the angle of the frame the box was DRAWN in (tagged at mouseup) so a straighten toggle
  // racing an in-flight read can't canonicalise a box with the wrong angle; fall back to the live angle.
  const a = (typeof b._ang === 'number') ? b._ang : (state.deskewAngle || 0);
  if (!a || !state.rawImg || !window.AnchorLabel) return { x:b.x, y:b.y, w:b.w, h:b.h };
  const W = state.rawImg.naturalWidth, H = state.rawImg.naturalHeight;
  const r = window.AnchorLabel.deskewedNormToRaw(b.x + b.w/2, b.y + b.h/2, a, W, H);   // +angle: display -> raw
  return { x: r.x - b.w/2, y: r.y - b.h/2, w: b.w, h: b.h };
}
function _teachFwdBox(n){                   // raw -> display(straightened), for OVERLAY + re-read
  if (!n) return n;
  const a = state.deskewAngle || 0; if (!a || !state.rawImg || !window.AnchorLabel) return { x:n.x, y:n.y, w:n.w, h:n.h };
  const W = state.rawImg.naturalWidth, H = state.rawImg.naturalHeight;
  const r = window.AnchorLabel.deskewedNormToRaw(n.x + n.w/2, n.y + n.h/2, -a, W, H);  // -angle: inverse (raw -> display)
  return { x: r.x - n.w/2, y: r.y - n.h/2, w: n.w, h: n.h };
}
async function toggleTeachDeskew(forceOn){
  if (_teachDeskewBusy || _teachReadBusy || drag || !state.rawImg || !state.pageDataUrl) return;
  const goOn = (typeof forceOn === 'boolean') ? forceOn : !state.deskewAngle;
  const btn = document.getElementById('tz-deskew');
  _teachDeskewBusy = true;
  try {
    if (goOn) {
      if (!state.deskewImg) {                              // fetch the straightened render ONCE
        let res = null; try { res = await window.docusnap.getPageDeskew?.(state.pageDataUrl.split(',')[1], DESKEW_HARD_FLOOR); } catch {}
        if (res && res.image && res.angle) {
          await new Promise(r => { const im = new Image(); im.onload = () => { state.deskewImg = im; state.deskewImgAngle = res.angle; r(); }; im.onerror = () => r(); im.src = 'data:image/png;base64,' + res.image; });
        }
        // Bank it against THIS page (multi-page): straighten is per page, and re-fetching a
        // straightened render every time the operator flips back would be a visible stall.
        const _pc = state.pageCache && state.pageCache[state.pageIndex];
        if (_pc) { _pc.deskewImg = state.deskewImg; _pc.deskewImgAngle = state.deskewImgAngle; }
      }
      if (state.deskewImg && state.deskewImgAngle) { state.img = state.deskewImg; state.deskewAngle = state.deskewImgAngle; }
      else if (typeof forceOn !== 'boolean') { try { toast('This page is already straight'); } catch {} }
    } else {
      state.img = state.rawImg; state.deskewAngle = 0;
    }
    redrawCanvas();
    if (btn) btn.classList.toggle('active', !!state.deskewAngle);
  } finally { _teachDeskewBusy = false; }
}

// Prefetch the (heavy, ~scale-4.0) page render as soon as a doc is chosen, so it renders in the
// BACKGROUND while the operator picks the type — the draw step then opens instantly (or shows the
// "Reading…" overlay until it's ready). Re-fires when the chosen doc changes, dropping the stale
// render + its cached image so a different doc can never show the previous one's page.
function _prefetchTeachPage(){
  const d = state.doc; if (!d || !D.getDocumentPages) return;
  if (state.pageFor === d.id && (state.pagePromise || state.img)) return;   // already in-flight / loaded for this doc
  state.pageFor = d.id;
  state.img = null; state.rawImg = null; state.deskewImg = null;
  state.deskewImgAngle = 0; state.deskewAngle = 0; state.pageDataUrl = null;
  state.pages = []; state.pageIndex = 0; state.pageCache = {};
  // Keep the WHOLE array — the wizard used to discard everything after pages[0]. The per-page
  // renders are already produced by the same call, so multi-page costs no extra work here.
  state.pagePromise = D.getDocumentPages(d.id, d.folder_path, d.original_filename, TEACH_RENDER_SCALE)
    .then(pages => (Array.isArray(pages) ? pages : []))
    .catch(() => []);
}

// Put page `idx` on the canvas. Caches each page's raw + straightened render so flipping back to a
// page the operator already visited is instant and does not re-run deskew detection.
async function showTeachPage(idx){
  const n = (state.pages || []).length;
  if (!n) return false;
  idx = Math.max(0, Math.min(n - 1, idx | 0));
  // Bank the page we are leaving, including whatever straighten state it had.
  if (state.rawImg && state.pageCache[state.pageIndex]) {
    Object.assign(state.pageCache[state.pageIndex], {
      deskewImg: state.deskewImg, deskewImgAngle: state.deskewImgAngle });
  }
  state.pageIndex = idx;
  state.pageDataUrl = state.pages[idx];
  const cached = state.pageCache[idx];
  if (cached && cached.rawImg) {
    state.rawImg = cached.rawImg;
    state.deskewImg = cached.deskewImg || null;
    state.deskewImgAngle = cached.deskewImgAngle || 0;
  } else {
    state.rawImg = null; state.deskewImg = null; state.deskewImgAngle = 0;
    if (!state.pageDataUrl) return false;
    await new Promise(res => {
      const im = new Image();
      im.onload = () => { state.rawImg = im; res(); };
      im.onerror = () => res();
      im.src = state.pageDataUrl;
    });
    if (!state.rawImg) return false;
    state.pageCache[idx] = { rawImg: state.rawImg, deskewImg: null, deskewImgAngle: 0 };
  }
  // Show the straightened render when we already have one, else the raw page; the deskew pass below
  // (or the toggle) fills it in. Straighten is per PAGE — page 2 can be crooked while page 1 is level.
  if (state.deskewImg && state.deskewImgAngle) {
    state.img = state.deskewImg; state.deskewAngle = state.deskewImgAngle;
  } else {
    state.img = state.rawImg; state.deskewAngle = 0;
  }
  return true;
}

// The page strip is hidden entirely for a single-page document, so nothing changes for the common
// case. Rendered as "‹ Page 2 of 3 ›" plus a dot per page the operator has already taught a field on.
function renderPageNav(){
  const el = $('rg-pagenav');
  if (!el) return;
  const n = (state.pages || []).length;
  if (n <= 1) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const taught = new Set(Object.values(state.results || {})
    .filter(r => r && r.target && Number.isInteger(r.page)).map(r => r.page));
  const dots = Array.from({ length: n }, (_, i) =>
    `<span class="pg-dot${i === state.pageIndex ? ' cur' : ''}${taught.has(i) ? ' has' : ''}" `
    + `data-pg="${i}" title="${taught.has(i) ? 'Page ' + (i + 1) + ' — has taught fields' : 'Page ' + (i + 1)}"></span>`).join('');
  el.innerHTML = `<button class="btn ghost pg-btn" id="pg-prev"${state.pageIndex <= 0 ? ' disabled' : ''}>‹</button>`
    + `<span class="pg-lbl">Page ${state.pageIndex + 1} of ${n}</span>`
    + `<span class="pg-dots">${dots}</span>`
    + `<button class="btn ghost pg-btn" id="pg-next"${state.pageIndex >= n - 1 ? ' disabled' : ''}>›</button>`;
  $('pg-prev').onclick = () => gotoTeachPage(state.pageIndex - 1);
  $('pg-next').onclick = () => gotoTeachPage(state.pageIndex + 1);
  for (const d of el.querySelectorAll('.pg-dot')) d.onclick = () => gotoTeachPage(Number(d.dataset.pg));
}

// Flip the canvas to another page. Any half-drawn box is dropped — a rectangle drawn on page 1
// means nothing on page 2, and silently carrying it would store geometry against the wrong page.
async function gotoTeachPage(idx){
  if (idx === state.pageIndex || _teachDeskewBusy || _teachReadBusy) return;
  drag = null; drawnBox = null;
  // Drop an UNCONFIRMED read-back before leaving the page (found by the sandbox smoke run): the
  // canvas switched but the panel kept offering "Value: Northgate Textiles — Looks right →" while
  // the operator was looking at the Larkspur page. The stored row was always correct — the box's own
  // page, not the displayed one — so this was never data corruption, but it invited someone to
  // confirm a value that is nowhere on the page in front of them.
  const _cf = curField();
  const _pending = _cf && state.results[_cf.key];
  if (_pending && _pending.status === 'pending') delete state.results[_cf.key];
  _setPageLoading(true);
  const ok = await showTeachPage(idx);
  if (ok) {
    fitCanvas(); tzReset(); redrawCanvas();
    if (state.rawImg && !state.deskewImg) await toggleTeachDeskew(true);
    if (TZ_DEFAULT > 1) requestAnimationFrame(() => { try { tzSet(TZ_DEFAULT); tzShowTop(); } catch {} });
  }
  _setPageLoading(false);
  // Reset the panel to "draw a box" for this page. renderFieldPrompt, never promptField — see the
  // note on the split; promptField would navigate straight back to the page we just left.
  renderFieldPrompt();
  renderPageNav(); redrawCanvas();
}
function _setPageLoading(on){ const el = $('rg-loading'); if (el) el.classList.toggle('hidden', !on); }

async function startRegionStep(){
  canvas=$('pageCanvas'); ctx=canvas.getContext('2d');
  const _loading = !state.img;
  if (_loading){
    // Prefer the background prefetch started when the doc was chosen; fetch now only if it's absent
    // or was for a different doc (e.g. the operator jumped straight here). The "Reading…" overlay
    // stays up until the page + deskew are ready.
    if (!(state.pagePromise && state.pageFor === state.doc.id)) _prefetchTeachPage();
    _setPageLoading(true);
    try{ state.pages = (await state.pagePromise) || []; }catch{ state.pages = []; }
    if (!state.pages.length){ _setPageLoading(false); $('rg-prompt').textContent="Couldn't load that page."; return; }
    // showTeachPage sets pageDataUrl/rawImg/img and banks the render — one path for the first page
    // and for every later flip, so the two cannot drift.
    if (!await showTeachPage(state.pageIndex || 0)){
      _setPageLoading(false); $('rg-prompt').textContent="Couldn't load that page."; return;
    }
  }
  renderPageNav();
  fitCanvas(); tzReset(); redrawCanvas();
  bindCanvas();
  // Straighten ON by default — training needs a level page so anchor↔target geometry registers cleanly.
  // Runs once (deskewImg unset); if the page is already straight it's a silent no-op.
  if (state.rawImg && !state.deskewImg) await toggleTeachDeskew(true);
  if (_loading) _setPageLoading(false);           // page + deskew ready — drop the "Reading…" overlay
  // Open at TZ_DEFAULT rather than fit-to-pane: the fitted page is too small to draw an
  // accurate box on, so this is where the user was going to zoom to anyway. Deferred to
  // the next frame and set AFTER any deskew re-render, so tzApply measures the true
  // fitted width (_fitW) instead of a stale or mid-layout one.
  if (TZ_DEFAULT > 1) requestAnimationFrame(() => { try { tzSet(TZ_DEFAULT); tzShowTop(); } catch {} });
  state.fieldIndex = state.fields.findIndex(f=>!state.results[f.key]);
  if (state.fieldIndex<0) state.fieldIndex=0;
  renderFieldRail(); promptField();
}
function fitCanvas(){
  if (!state.img) return;
  // Size the BUFFER at (capped) NATIVE resolution — not the fitted display size — so
  // the page stays sharp when zoomed and the preview auto-grows with the window. CSS
  // (#pageCanvas max-width/max-height) downscales it to fit the pane; the transform
  // handles zoom. Only ever downscale an oversized scan (memory guard); never upscale.
  const natW=state.img.naturalWidth, natH=state.img.naturalHeight;
  // Keep the full high-DPI render (was 2800, which downscaled a 4.0 render and softened it).
  const CAP=4000, s=Math.min(1, CAP/Math.max(natW,natH));
  canvas.width=Math.round(natW*s);
  canvas.height=Math.round(natH*s);
  _fitW=0;   // new buffer → re-measure the fit width on next zoom
}
let hideStoredBoxes=false;   // true while a state is REPLACING the value (TYPE/NO-HIT/PICK)
function redrawCanvas(){
  if (!state.img) return;
  // Draw only while a field is still being captured. At "Teaching complete" curField() is
  // undefined (fieldIndex parked past the last field) → lock the canvas: swap the crosshair
  // for the default pointer (.capture-done CSS) to match the disabled mousedown-draw gate.
  canvas.classList.toggle('capture-done', !curField());
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(state.img,0,0,canvas.width,canvas.height);
  // Show ONLY the field being taught right now (owner 2026-07-30) — the previously-confirmed fields'
  // boxes are no longer drawn, so a new box is drawn on a clean page and the LAST box clears once the
  // final field is confirmed (advanceField parks fieldIndex past the end → curField() is undefined
  // below → nothing drawn). The stored results (state.results) are untouched; this is display-only.
  // current field: its label (blue) + value (green) — same colours as Template Manager
  const cf=curField(); let cr=cf?state.results[cf.key]:null;
  // While the operator is REDOING the value (TYPE / NO-HIT / PICK states) the old stored boxes
  // must not linger on the page (owner screenshot 2026-08-11) — and in PICK they actively hid
  // the located ring (cr.target wins the else-if over drawnBox). Confirm states clear this so
  // the green/blue boxes show where the panel says they do.
  if (hideStoredBoxes) cr=null;
  // MULTI-PAGE: a stored box belongs to the page it was drawn on. Drawing page 1's rectangle over
  // page 2 would put a green box on unrelated content and invite the operator to "correct" it.
  if (cr && Number.isInteger(cr.page) && cr.page !== state.pageIndex) cr = null;
  if (cr&&cr.anchor) drawBox(_teachFwdBox(cr.anchor),'#4f8ef7',true);
  if (cr&&cr.target) drawBox(_teachFwdBox(cr.target),'#3ecf8e',true);
  else if (drawnBox) drawBox(drawnBox,'#3ecf8e',true);
  // live drag rectangle, coloured by what we're drawing
  if (drag) drawBox(drag, drawMode==='anchor'?'#4f8ef7':'#3ecf8e',true,true);
}
// High-visibility ring around a located box (display-only, cleared by any redraw): a
// word-sized 2px rectangle is invisible at page-fit zoom, and the locate pick step is
// the one screen whose entire job is showing where the value sits.
function emphasiseBox(n){
  if (!n) return;
  const x=n.x*canvas.width, y=n.y*canvas.height, w=n.w*canvas.width, h=n.h*canvas.height;
  const br=canvas.getBoundingClientRect(), k=br.width? canvas.width/br.width : 1;
  const pad=10*k;
  ctx.save();
  ctx.lineWidth=Math.max(2.5, 3*k);
  ctx.strokeStyle='#3ecf8e';
  ctx.shadowColor='rgba(62,207,142,.9)'; ctx.shadowBlur=14*k;
  ctx.strokeRect(x-pad, y-pad, w+pad*2, h+pad*2);
  ctx.restore();
}
function drawBox(n,color,solid,dashed){
  const x=n.x*canvas.width,y=n.y*canvas.height,w=n.w*canvas.width,h=n.h*canvas.height;
  // The buffer is full-res and CSS-downscaled, so scale the stroke to stay ~2px
  // on-screen at any fit/zoom (getBoundingClientRect already includes the transform).
  const br=canvas.getBoundingClientRect(), k=br.width? canvas.width/br.width : 1;
  ctx.lineWidth=Math.max(1.5, 2*k); ctx.strokeStyle=color; ctx.setLineDash(dashed?[6*k,4*k]:[]);
  ctx.strokeRect(x+.5,y+.5,w,h); ctx.setLineDash([]);
  ctx.fillStyle=color+'22'; ctx.fillRect(x,y,w,h);
}
function cpoint(e){ const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*(canvas.width/r.width)/canvas.width, y:(e.clientY-r.top)*(canvas.height/r.height)/canvas.height}; }
let _bound=false;
function bindCanvas(){
  if (_bound) return; _bound=true;
  // LEFT-drag draws the box; right-click is reserved for panning (below).
  // No field left to capture ("Teaching complete") → don't start a draw (cursor is locked too).
  canvas.addEventListener('mousedown',e=>{ if(e.button!==0 || !curField())return; const p=cpoint(e); drag={x:p.x,y:p.y,w:0,h:0,_sx:p.x,_sy:p.y}; });
  canvas.addEventListener('mousemove',e=>{ if(!drag)return; const p=cpoint(e); drag.x=Math.min(drag._sx,p.x);drag.y=Math.min(drag._sy,p.y);drag.w=Math.abs(p.x-drag._sx);drag.h=Math.abs(p.y-drag._sy); redrawCanvas(); });
  window.addEventListener('mouseup',async()=>{ if(!drag)return; const b={x:drag.x,y:drag.y,w:drag.w,h:drag.h,_ang:state.deskewAngle||0}; drag=null; if(b.w<0.01||b.h<0.008){redrawCanvas();return;}
    if (drawMode==='anchor'){ await captureAnchor(b); return; }
    drawnBox=b; redrawCanvas(); await readBack(b); });

  // ── Zoom / pan (same model as the review preview) ────────────────────────────
  // Zoom via +/−/reset; pan via RIGHT-drag only (left-drag stays for drawing).
  // cpoint() already maps through getBoundingClientRect(), so drawing stays correct
  // at any zoom/pan. dragstart is blocked so neither button grabs a ghost image.
  const wrap=canvas.parentElement;
  $('tz-in') ?.addEventListener('click',()=>tzSet(tzZoom+TZ_STEP));
  $('tz-out')?.addEventListener('click',()=>tzSet(tzZoom-TZ_STEP));
  $('tz-reset')?.addEventListener('click',tzReset);
  $('tz-deskew')?.addEventListener('click',()=>toggleTeachDeskew());
  // Scroll-wheel zoom (same step as the +/− buttons; matches the other preview panes).
  wrap.addEventListener('wheel',e=>{ if(!state.img)return; e.preventDefault(); tzSet(tzZoom+(e.deltaY<0?TZ_STEP:-TZ_STEP)); }, {passive:false});
  wrap.addEventListener('dragstart',e=>e.preventDefault());
  wrap.addEventListener('contextmenu',e=>{ if(state.img) e.preventDefault(); });
  wrap.addEventListener('mousedown',e=>{
    if(e.button!==2)return;                       // right-click only
    _tzPan={x:e.clientX,y:e.clientY,panX:tzPanX,panY:tzPanY};
    canvas.style.cursor='grabbing'; e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!_tzPan)return;
    tzPanX=_tzPan.panX+(e.clientX-_tzPan.x);
    tzPanY=_tzPan.panY+(e.clientY-_tzPan.y);
    tzApply();
  });
  window.addEventListener('mouseup',()=>{ if(_tzPan){ _tzPan=null; canvas.style.cursor=''; } });
  // CSS auto-fits the full-res buffer to the pane, so the page scales on maximise;
  // redraw so the overlay boxes (and their on-screen stroke width) track the new size.
  // When ZOOMED, the explicit canvas width is _fitW*zoom — _fitW is the OLD pane's fit,
  // so re-measure it against the resized pane (clear inline sizing → read fit → re-apply).
  window.addEventListener('resize',()=>{
    if(!state.img) return;
    if(tzZoom>1){
      canvas.style.maxWidth=''; canvas.style.maxHeight=''; canvas.style.width=''; canvas.style.height='';
      _fitW = canvas.getBoundingClientRect().width || 0;
      tzApply();
    }
    redrawCanvas();
  });
}
function curField(){ return state.fields[state.fieldIndex]; }

// ── The Document Issuer is taught POSITION-ONLY ──────────────────────────────
// Real letterheads print no caption above the company name, so asking the user to
// confirm a "label" for the issuer manufactures a PHANTOM anchor that never
// re-locates on a future scan — the teach then silently does nothing. The issuer is
// identified by its NAME (logo / keywords / letterhead) instead. This is the same
// rule Review applies (review/renderer.js RC2, Oracle-signed 2026-07-10), and the
// Stage 0.5 mapper supports a label-less mapping as a first-class case
// (template_mapper.py:405 — base 78 "no label" vs 90 "anchor located").
const ISSUER_KEYS = ['supplier_name'];               // COMPANY_KEYS since migration 44
function isIssuerField(f){ return !!f && ISSUER_KEYS.includes(f.key); }
function finishIssuerField(f){
  const r = state.results[f.key]; if (!r) return;
  r.anchor = null; r.anchor_text = null; r.anchor_dir = null; r.anchorSuspicious = false;
  r.status = 'done'; drawMode = 'value';
  // PLAUSIBILITY, not just capture (Chris round 2, 2026-08-11). This line used to congratulate the
  // operator whatever came back. In Review, the same message appeared over a read of '@a eens Ee'
  // and the value went on to become two output folders — the app guards an EMPTY issuer and says
  // nothing about a gibberish one. Asked asynchronously so the wizard never waits on it, and
  // warning-only: the field is already marked done above and nothing here blocks or rewrites it.
  // \u26a0 THE VERDICT MOVED EARLIER (2026-08-13). The check used to fire HERE \u2014 after the operator had
  // pressed "Looks right \u2192", concurrently with advanceField() \u2014 so its answer landed as a toast
  // over the NEXT field, and `.catch(_ok)` turned a FAILED check into "Captured the \u2026 position":
  // failure rendered as success. Both questions (shape, and near-match to a company already in
  // use) are now asked by _warnOnIssuerValue while the confirm panel is still on screen, BEFORE
  // this irreversible step. What is left here is a truthful acknowledgement naming the value.
  toast(`Captured "${r.value}" as the ${f.label} for this layout.`);
  advanceField();
}

// ── The ONE question zone (#rg-confirm-top) ──────────────────────────────────
// 2026-08-11 flow rework (Chris-lens spec): every question — readouts, buttons, and THE typing
// row — renders here and only here, directly under the instruction it belongs to. The banner's
// three slots have fixed jobs: #rg-prompt (truthful action + field title), #rg-sub (guidance,
// never contradicting the prompt), and this zone (the live question — incl. the DRAW state's
// "Or type it instead" ghost button). The old #rg-readback third panel and the top-right
// corner hatch are both gone.
const CONFIRM_SEL = (id) => `#rg-confirm-top [id="${id}"]`;
function onConfirm(id, handler){
  const el = document.querySelector(CONFIRM_SEL(id));
  if (el) el.onclick = handler;
}
function setConfirm(html){
  const top=$('rg-confirm-top'); if (top) top.innerHTML = html || '';
}
// The prompt is set in two parts so the FIELD BEING TAUGHT reads as a title rather
// than as words buried in a sentence — see the .pact/.ptitle rules in index.html.
// Every prompt goes through here, so the emphasis can't be lost by a future caller.
function setPrompt(action, title){
  $('rg-prompt').innerHTML =
    `<span class="pact">${esc(action)}</span><span class="ptitle">${esc(title)}</span>`;
}
function setValueBanner(f){
  const idx=state.fieldIndex+1, total=state.fields.length;
  setPrompt(`Field ${idx} of ${total} — draw a box around the value for`, f.label);
  $('rg-sub').textContent = isIssuerField(f)
    // The footer note is deliberate (owner, 2026-08-10): the issuer is often only selectable down
    // there, and an operator who thinks the letterhead is the only valid place will type the name
    // instead — losing the position that makes the next document of this layout match.
    ? `Drag a rectangle right over the company name — anywhere it's printed, including the footer. There's no label for this one; the company is recognised by its name.`
    // TRUTH FIX (Chris-lens spec 2026-08-11): the label is auto-found and merely CHECKED — the
    // old "you'll mark its label" promised work that never happens.
    : `Drag a rectangle right over the value on the page (not the label next to it). I'll read it back before anything is saved.`;
}
function promptField(){
  const f=curField(); if(!f) return;
  // MULTI-PAGE: selecting a field that was taught on another page FOLLOWS it there, so the operator
  // sees the box they drew instead of a blank-looking page with their work apparently missing.
  const _r = state.results[f.key];
  if (_r && Number.isInteger(_r.page) && _r.page !== state.pageIndex) gotoTeachPage(_r.page);
  renderFieldPrompt();
}
// The prompt/read-back panel, WITHOUT promptField's page-follow. Split out so a page change can
// reset the panel without bouncing the canvas back to the page it just left (promptField would see
// a pending result belonging to the old page and navigate straight back — an infinite flip).
function renderFieldPrompt(){
  const f=curField(); if(!f) return;
  drawMode='value';
  hideStoredBoxes=false;
  setValueBanner(f);
  // "Or type it instead" — a ghost button in the QUESTION ZONE (owner + Chris-lens 2026-08-11;
  // it was a corner link nobody saw, quiet by a 2026-08-10 rationale that typed-value locate
  // made obsolete — typing now teaches the spot too). Four words, an exit not a second question;
  // the TYPE state explains the locate behaviour the moment it's clicked. Mirrors the TYPE
  // state's "Draw it instead", which itself teaches that the two methods are equals. Because
  // every other state overwrites the zone via setConfirm, the button vanishes automatically
  // whenever a question is in progress — no visibility bookkeeping to forget.
  setConfirm(`<button type="button" class="btn ghost quiet" id="rg-manual-entry" data-help-key="teach-manual-entry">Or type it instead</button>`);
  onConfirm('rg-manual-entry', ()=>{ const cf=curField(); if (cf) showFixedInput(cf); });
  drawnBox=null; redrawCanvas();
  renderFieldRail();
}
// ONE typing row, one id, rendered by every state that needs typing (2026-08-11 flow rework —
// there used to be THREE differently-shaped inputs across two panels). Plain HTML builder; the
// caller wires the button/Enter after injecting.
function _typeRowHtml(caption, placeholder, btnLabel, prefill){
  return `<div style="display:flex;gap:8px;align-items:center;margin-top:8px">`+
      (caption ? `<span class="muted" style="font-size:12px;flex-shrink:0">${esc(caption)}</span>` : '')+
      `<input type="text" id="rb-input" value="${esc(prefill||'')}" style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit" placeholder="${esc(placeholder||'')}">`+
      `<button class="btn ${caption?'ghost':'primary'}" id="rb-input-go">${esc(btnLabel||'Use this')}</button>`+
    `</div>`;
}
function _wireTypeRow(handler, focus){
  const inp=$('rb-input'), go=$('rb-input-go');
  if (!inp || !go) return;
  const run=()=>{ const v=(inp.value||'').trim(); if(!v){ inp.style.borderColor='var(--err)'; return; } handler(v); };
  go.onclick=run;
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); run(); } });
  if (focus){
    // Programmatic focus goes through the shared repair (forward convention, owner 2026-08-02): a
    // bare .focus() can't trigger the preload pointerdown chokepoint.
    if (typeof focusField === 'function') focusField(inp).then(()=>{ try{ inp.select(); }catch{} });
    else { try{ inp.focus(); inp.select(); }catch{} }
  }
}
// TYPE state (the hatch). The old third-panel explainer card is now the sub-line; the input lives
// in the question zone like every other question (Chris-lens spec 2026-08-11).
function showFixedInput(f, prefill){
  drawMode='value';
  hideStoredBoxes=true;
  setPrompt('Type the value for', f.label);
  $('rg-sub').textContent = TYPED_LOCATE_ON
    ? `If it's printed on the page I'll find it and teach that spot, same as drawing. If it isn't printed anywhere, it's saved as typed and reused as-is on every document of this type.`
    : `A typed value records no position — it is reused as-is on every document of this type. If it appears anywhere on the page (the footer counts), draw it instead.`;
  const existing=state.results[f.key];
  const prev = prefill != null ? prefill : ((existing&&existing.status==='fixed')?existing.value||'':'');
  setConfirm(
    _typeRowHtml('', `${f.label} as printed…`, 'Save →', prev)+
    `<div style="margin-top:8px"><button class="btn ghost quiet" id="rb-type-cancel">Draw it instead</button></div>`);
  const saveAsFixed=(v)=>{
    state.results[f.key]={value:v,target:null,anchor:null,anchor_text:null,status:'fixed'};
    advanceField();
  };
  _wireTypeRow(async (v)=>{
    if(!TYPED_LOCATE_ON){ saveAsFixed(v); return; }   // kill switch: the old path, byte-identical
    // LOCATING — ONE indicator (the question zone), not a button relabel plus a second line.
    // Before accepting a position-less constant, look for the typed string in the page's own word
    // geometry. Measured 2026-08-10: 17 of 19 measurable fixed values are PRINTED on their own
    // sample page — they were typed because the READ was wrong, not because the value is absent.
    setConfirm('<span class="muted">Looking for that on the page…</span>');
    let hits=[];
    try{ hits=await locateTypedValue(v); }catch{}
    if(!hits.length){ showNoHit(f, v, saveAsFixed); return; }
    showLocatedPick(f,v,hits,0);
  }, /*focus*/true);
  const c=$('rb-type-cancel'); if (c) c.onclick=()=>promptField();
  drawnBox=null; redrawCanvas();
}
// NO-HIT state (2026-08-11 — was a SILENT commit-and-advance): the one moment typing genuinely
// loses the position, and the one moment a typo becomes a frozen wrong constant on every future
// document, now gets an acknowledgement and a way back.
function showNoHit(f, v, saveAsFixed){
  if (_freezeDiscouraged(f)) {
    // Card #4: an amount/date typed without a spot. Freezing it would stamp this figure on every
    // document, so make "Draw where it sits" the PRIMARY route and demote the freeze to a quiet,
    // deliberate choice (never removed — a genuinely-constant field is still reachable).
    setPrompt(`This looks like a value that changes on each document`, f.label);
    $('rg-sub').textContent = `Freezing "${v}" would fill it on every document of this type — but an amount or date usually changes each time. Draw where it sits so each document is read.`;
    setConfirm(
      `<div>Value: <span class="val mono">${esc(v)}</span></div>`+
      `<div class="rb-actions">`+
        `<button class="btn primary" id="rb-nohit-draw">Draw where it sits →</button>`+
        `<span class="rb-sep"></span>`+
        `<button class="btn ghost quiet" id="rb-nohit-edit">Edit the value</button>`+
        `<button class="btn ghost quiet" id="rb-nohit-save">Freeze it as typed anyway</button>`+
      `</div>`);
  } else {
    setPrompt(`That isn't printed on this page`, f.label);
    $('rg-sub').textContent = `No matching text found. I can still save it — it will be filled in as typed on every document of this type.`;
    setConfirm(
      `<div>Value: <span class="val mono">${esc(v)}</span></div>`+
      `<div class="rb-actions">`+
        `<button class="btn primary" id="rb-nohit-save">Save it as typed →</button>`+
        `<span class="rb-sep"></span>`+
        `<button class="btn ghost quiet" id="rb-nohit-edit">Edit the value</button>`+
        `<button class="btn ghost quiet" id="rb-nohit-draw">Draw it instead</button>`+
      `</div>`);
  }
  $('rb-nohit-save').onclick=()=>saveAsFixed(v);
  $('rb-nohit-edit').onclick=()=>showFixedInput(f, v);   // the typo recovery — input prefilled
  $('rb-nohit-draw').onclick=()=>promptField();
}
// ── Typed value → located position ───────────────────────────────────────────
// A typed value used to record WHAT it says and nothing about WHERE it sits: it becomes a frozen
// `fixed_value` re-asserted on every document of the type, whatever that document prints. The
// census (`stress_test/fixed_value_locatable.js`, 2026-08-10) measured 17 of 19 measurable fixed
// values as PRINTED on their own sample page — supplier_name 7/7, vat_no 6/6, account_no 3/3 — so
// they were typed because the READ was wrong, not because the value is absent. Searching the page's
// word geometry for the typed string turns most manual entries back into positioned teaches.
//
// A LOCATED BOX IS EVIDENCE ABOUT WHERE, NEVER ABOUT WHETHER. The same census found two of those
// 17 are values already known to be WRONG (`vat_no = 'VAT'` matches because the CAPTION is on the
// page). So nothing here raises the value's standing: the value committed for this document is
// still exactly what the operator typed, and no confidence is granted for having found it. What
// changes is that the template READS the position on each future document instead of repeating a
// constant — which is the risk the three frozen-value defects of this week all shared.
// Kill switch: setting `teach_typed_value_locate` = 'false' restores the old typed-value path
// byte-identically (the search never runs).
let TYPED_LOCATE_ON = true;
try { D.getSetting?.('teach_typed_value_locate').then(v => { TYPED_LOCATE_ON = v !== 'false'; }); } catch {}
// LIST field type (2026-08-11): unlocks 'List (several values)' in the shared doctype editor,
// and marks list-typed fields as caption-collected in the capture step (no box teach).
try { D.getSetting?.('list_field_scan').then(v => { window.__listFieldTypeOn = v === 'true'; }); } catch {}
// Page words are cached per (page, straighten angle): the operator may type several fields on one
// page, and a full-page OCR per field would be a visible stall for no new information.
let _pageWordsCache = { key:null, res:null };
async function locateTypedValue(value){
  const im = state.img; if (!im || !window.ValueLocate) return [];
  const key = state.pageIndex + '|' + (state.deskewAngle || 0);
  let res = _pageWordsCache.key === key ? _pageWordsCache.res : null;
  if (!res){
    _teachReadBusy = true;      // a page-wide read is in flight — block a straighten toggle mid-read
    try { res = await D.ocrPageWords?.(await cropB64({x:0,y:0,w:1,h:1})); }
    catch { res = null; }
    finally { _teachReadBusy = false; }
    // Only cache a real answer — caching a failure would make the retry silently impossible.
    if (res && res.words) _pageWordsCache = { key, res };
  }
  if (!res || !res.words) return [];
  // The words come back in the pixels of the image we submitted, which is `state.img` at native
  // resolution. Prefer the dims the backend reports; fall back to the image's own.
  const natW = res.w > 0 ? res.w : im.naturalWidth;
  const natH = res.h > 0 ? res.h : im.naturalHeight;
  const hits = window.ValueLocate.locateValueInWords(value, { words: res.words, natW, natH });
  // Tag the frame the box is in, exactly as a drawn box is tagged at mouseup, so _teachBackBox
  // canonicalises it to RAW with the right angle even if straighten is toggled afterwards.
  const a = state.deskewAngle || 0;
  hits.forEach(h => { h.box._ang = a; });
  return hits;
}
// The pick step IS the gate: the candidate box is drawn on the page and nothing is stored until the
// operator says that is the place. Same principle as the drawn-box word-snap — approved by being seen.
function showLocatedPick(f, typed, hits, idx){
  const h = hits[idx]; if (!h) return;
  // The pick step's whole job is SHOWING the box — Chris (r2 2026-08-11, finding 5) was asked
  // to approve a position he couldn't see. Reset zoom/pan so the full page (and therefore the
  // box) is in the viewport, scroll it into view, and ring the box so a word-sized rectangle
  // can't hide on an A4 page.
  tzReset();
  hideStoredBoxes=true;
  drawnBox = h.box; redrawCanvas();
  emphasiseBox(h.box);
  try {
    canvas.scrollIntoView({ block: 'nearest' });
  } catch {}
  setPrompt('Is this the right spot for', f.label);
  $('rg-sub').textContent = hits.length > 1
    ? `It's printed in ${hits.length} places. Step through until the green box sits on the right one.`
    : `Found it — the green box shows where. Teaching the spot means future documents are read from the page, even when the value changes.`;
  // PICK state (Chris-lens spec 2026-08-11): ONE panel, ONE voice. The explainer card is gone —
  // its substance is the sub-line; the n-of-N stepper is inline with the value, not two wide
  // buttons competing with the primary. "Seen = approved" stays the gate.
  setConfirm(
    `<div>Value: <span class="val mono">${esc(typed)}</span>`+
      (hits.length > 1
        ? `<span class="rb-step"><button class="btn ghost quiet" id="rb-loc-prev" title="Previous place">‹</button>`+
          `${idx+1} of ${hits.length}`+
          `<button class="btn ghost quiet" id="rb-loc-next" title="Next place">›</button></span>`
        : '')+
    `</div>`+
    `<div class="rb-actions">`+
      `<button class="btn primary" id="rb-loc-yes">Yes — teach this spot →</button>`+
      `<span class="rb-sep"></span>`+
      `<button class="btn ghost quiet" id="rb-loc-back">Back</button>`+
      `<button class="btn ghost quiet" id="rb-loc-fixed">Save without a spot</button>`+
    `</div>`);
  onConfirm('rb-loc-yes', ()=>useLocatedBox(f, typed, h.box));
  if (hits.length > 1){
    onConfirm('rb-loc-next', ()=>showLocatedPick(f, typed, hits, (idx+1) % hits.length));
    onConfirm('rb-loc-prev', ()=>showLocatedPick(f, typed, hits, (idx-1+hits.length) % hits.length));
  }
  onConfirm('rb-loc-back', ()=>showFixedInput(f, typed));   // back to TYPE, input prefilled
  onConfirm('rb-loc-fixed', ()=>{
    drawnBox=null;
    state.results[f.key]={value:typed,target:null,anchor:null,anchor_text:null,status:'fixed'};
    advanceField();
  });
}
// Accepted: detect the label the same way a drawn box does, then store through the SAME `store`
// the drawn path uses — so from here on a located field is indistinguishable from a drawn one and
// doCommit needs no special case (it takes the saveTemplateMapping branch, not setTemplateFieldFixed).
async function useLocatedBox(f, value, box){
  // ISSUER: commit DIRECTLY (Chris-lens spec 2026-08-11 — this deletes the incoherent screenshot
  // state: "Confirm the label for / Document Issuer" over "no label needed"). The pick step WAS
  // the approval — the value is operator-typed, the spot operator-approved, and there is no label
  // to check, so a second confirm carried zero new information. The plausibility warning still
  // fires inside finishIssuerField.
  if (isIssuerField(f)){
    store(f, box, { box:null, anchor_text:null, dir:null, suspicious:false }, value, /*pending*/true);
    state.results[f.key].located = true;
    state.results[f.key].valueSource = 'typed';
    return finishIssuerField(f);
  }
  setConfirm('<span class="muted">Reading the label…</span>');
  let anchor = { box:null, anchor_text:null, dir:null, suspicious:false };
  _teachReadBusy = true;
  try { anchor = await autoLabel(box); } catch {}
  _teachReadBusy = false;
  if (anchor && anchor.box) anchor.box._ang = box._ang;
  // The VALUE stays exactly what the operator typed — the page's own words are not substituted in.
  // They were typed because the read was wrong, so re-reading them here would undo the correction.
  store(f, box, anchor, value, /*pending*/true);
  state.results[f.key].located = true;
  state.results[f.key].valueSource = 'typed';
  showValueConfirm(f, state.results[f.key]);
}
function renderFieldRail(){
  // A field marked "not on this document" is NOT captured — counting it as done produced
  // "7 OF 7 DONE / All fields captured" over two skips (Chris r2 2026-08-11, tea item).
  const done=state.fields.filter(f=>state.results[f.key] && state.results[f.key].status!=='skip').length;
  const skipped=state.fields.filter(f=>state.results[f.key] && state.results[f.key].status==='skip').length;
  $('rg-progress').textContent=`Details — ${done} of ${state.fields.length} done`
    + (skipped ? ` · ${skipped} not on this document` : '');
  const list=$('rg-fieldlist'); list.innerHTML='';
  state.fields.forEach((f,i)=>{
    const r=state.results[f.key];
    const cls=i===state.fieldIndex?'cur':'';
    const dot=r? (r.status==='skip'?(r.hideForLayout?'hide':'skip'):(r.status==='fixed'?'fixed':(r.status==='pending'?'cur':'done'))) : (i===state.fieldIndex?'cur':'');
    const row=document.createElement('div'); row.className='fieldrow '+cls;
    if (r && r.hideForLayout) row.title="Won't be looked for on this sender's paperwork — Settings → Document Types → Field visibility to change.";
    row.innerHTML=`<span class="dot ${dot}"></span><span${r&&r.hideForLayout?' class="muted"':''}>${esc(f.label)}</span>`;
    // A DONE field re-opens its CONFIRM state (view what's stored, change it) — the old behaviour
    // showed "draw a box" over an existing box, which read as the work having vanished. A FIXED
    // (typed, no spot) field re-opens the typing panel prefilled; everything else prompts as before.
    row.onclick=()=>{
      state.fieldIndex=i;
      const rr=state.results[f.key];
      if (rr && rr.status==='done' && rr.target){
        if (Number.isInteger(rr.page) && rr.page !== state.pageIndex) gotoTeachPage(rr.page);
        drawnBox=null; redrawCanvas(); renderFieldRail();
              showValueConfirm(f, rr);
        return;
      }
      if (rr && rr.status==='fixed'){ renderFieldRail(); showFixedInput(f); return; }
      promptField();
    };
    list.appendChild(row);
  });
  renderFooter();
}
// ── Teach-time WORD-SNAP of the drawn value box (owner GO 2026-08-04; gary design, the
// Slice-B principle applied at the moment the box is STORED: teach geometry == read geometry).
// A human draws a generous-or-clipping rectangle; the words underneath know the truth. After
// the read-back OCR we re-read a slightly WIDER band, convert its word boxes to page coords,
// admit ONLY words the DRAWN box actually touches (the Slice-B core invariant — the snap
// FINISHES nicked words like 'Stu[dio]', it never reaches out to new tokens), cut anything at
// or left of a detected LEFT label's right edge (never re-absorb the label tail), and store
// the word-union as the box the template keeps. The owner SEES the snapped box on the canvas
// before confirming — the read-back is the review. Multi-row draws (address blocks) are left
// untouched (single-row scope). Kill: setting teach_box_word_snap = 'false' (default ON — the
// snapped box is displayed for approval on every use, which is the gate).
let TEACH_SNAP_ON = true;
try { D.getSetting?.('teach_box_word_snap').then(v => { TEACH_SNAP_ON = v !== 'false'; }); } catch {}
// The ALGORITHM now lives in shared/boxSnap.js so the Template Manager runs the SAME snap rather
// than a second copy that drifts (2026-08-10). This wrapper keeps the teach-specific parts: the
// wizard's own image + its native cropper, and the left-label cut, which applies only when a LEFT
// label was actually detected AND read — a label we couldn't read is not evidence of where the
// value starts.
async function snapDrawnBox(box, anchor){
  const im = state.img; if (!im || !window.BoxSnap) return null;
  const labelRightEdge = (anchor && anchor.box && anchor.dir === 'left' && anchor.anchor_text)
    ? anchor.box.x + anchor.box.w
    : undefined;
  return window.BoxSnap.snapBoxToWords(box, {
    natW: im.naturalWidth, natH: im.naturalHeight,
    // cropB64 here is the wizard's own (native when TEACH_NATIVE_CROP, which is the shipped
    // default and the resolution contract boxSnap depends on).
    cropB64: (b) => cropB64(b),
    ocrRegionBoxes: (b64) => D.ocrRegionBoxes(b64),
    labelRightEdge,
  });
}

async function readBack(box){
  const f=curField();
  setConfirm('<span class="muted">Reading…</span>');
  _teachReadBusy = true;
  // Read via --boxes first with a plain fallback — the SAME order Review's runZoneOcr uses
  // (review/renderer.js:3202-3203), so a box drawn here and a box drawn there resolve
  // through one recipe rather than two that can drift apart.
  let value='';
  try{
    const b64 = await cropB64(box);
    const res = await D.ocrRegionBoxes?.(b64);
    value = ((res && res.text) || (await D.ocrRegion(b64)) || '');
  }catch{}
  value=(value||'').trim();
  // The issuer never gets a label read — see isIssuerField above (also saves an OCR round trip).
  const anchor = isIssuerField(f)
    ? { box:null, anchor_text:null, dir:null, suspicious:false }
    : await autoLabel(box);
  _teachReadBusy = false;   // both reads done; the box carries its own _ang for a later manual store
  if (anchor && anchor.box) anchor.box._ang = box._ang;   // same frame as the value box (manual-store safe)
  // Teach-time word-snap: store (and SHOW) the word-union box, not the hand-drawn rectangle.
  let usedBox = box;
  try{
    if (value && TEACH_SNAP_ON){
      const sn = await snapDrawnBox(box, anchor);
      if (sn && sn.box){
        usedBox = sn.box; usedBox._ang = box._ang;
        if (sn.text) value = sn.text;             // the words' own text (finishes a nicked token)
        drawnBox = usedBox; redrawCanvas();       // the owner sees the snapped box before confirming
      }
    }
  }catch{}
  if (!value){
    // READ-FAILED state (Chris-lens spec 2026-08-11): truthful heading — nothing was read, so a
    // later confirm must never claim "what I read". A value typed HERE keeps the drawn box (the
    // position still teaches) and carries valueSource='typed', so the follow-up is the honest
    // label-check, not a value confirm — and the issuer commits directly (no label to check).
    setPrompt(`I couldn't read that clearly`, f.label);
    $('rg-sub').textContent = `Try a bigger box around the value — or type it in below.`;
    setConfirm(_typeRowHtml('', `${f.label} as printed…`, 'Use this →'));
    _wireTypeRow((v)=>{
      store(f, box, anchor, v, /*pending*/true);
      state.results[f.key].valueSource = 'typed';
      if (isIssuerField(f)) return finishIssuerField(f);
      showValueConfirm(f, state.results[f.key]);
    }, /*focus*/true);
    return;
  }
  store(f, usedBox, anchor, value, /*pending*/true);
  state.results[f.key].valueSource = 'read';
  showValueConfirm(f, state.results[f.key]);
}
// Value stored; ONE combined confirmation for the value read AND the detected label
// (owner 2026-07-31: one confirm for both, separate redraws — the old separate "Step 2"
// label panel cost a click per field). The label was already detected during readBack,
// so showing both here costs no extra OCR. Issuer stays value-only (no label — see
// isIssuerField above).
// `located` = the value was TYPED and then found on the page, so there is no read to confirm — only
// the label beside it. Saying "confirm what I read" there would be untrue: nothing was read.
// ── Date coherence for the read-back (owner, 2026-08-11) ─────────────────────────────────────
// The wizard accepted ANY read for a date field — the exhibit: 'verbeck Cleaning Supplies'
// offered as the Order Date under a green "Looks right →". Two-way, warn-only:
//   * a DATE field whose read does NOT parse as a date -> "that doesn't read like a date";
//   * a NON-date field whose read DOES parse as one -> "are you sure? that looks like a date"
//     (fires ONLY on a real parse — a ref code like NW-12-34 must never trip it).
function _isDateField(f){
  return String(f.type || '').toLowerCase() === 'date' || f.key === state.dateFieldKey
         || /(^|_)date($|_)/.test(String(f.key || '').toLowerCase());
}
// Chris round-10 card #4: freezing an AMOUNT or DATE as a constant stamps a single figure on every
// document (a typed balance "£4,142.35" filed onto every future statement). Names and codes
// (supplier_name, vat_no, account_no) are the LEGITIMATE fixed-value users (census
// stress_test/fixed_value_locatable.js) — never discourage those. Type-scoped, with a narrow money-
// name fallback for an amount field a user mis-typed as text. PINNED (test_valueLocate.js) so a future
// dev can't broaden it to swallow the genuine name/code fixed-value fields.
function _freezeDiscouraged(f){
  const t = String((f && f.type) || '').toLowerCase();
  if (t === 'currency' || t === 'number') return true;
  if (_isDateField(f)) return true;
  return /(^|_)(total|amount|balance|due|paid|subtotal|net|gross)($|_)/.test(String((f && f.key) || '').toLowerCase());
}
// Conservative "reads as a printed date": common numeric + written-month forms only, with real
// calendar bounds (either day/month order accepted — this is a plausibility test, not a parse).
function _parsesAsDate(s){
  const v = String(s || '').trim();
  if (!v || v.length > 24) return false;
  let d = null, m = null, y = null, mon = null, x;
  if ((x = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/)))      { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = v.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/)))       { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = v.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/))) { d = +x[1]; mon = x[2]; y = +x[3]; }
  else if ((x = v.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/))) { mon = x[1]; d = +x[2]; y = +x[3]; }
  else return false;
  if (mon){
    m = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
        .indexOf(mon.slice(0, 3).toLowerCase()) + 1;
    if (!m) return false;
  }
  if (y < 100) y += (y >= 70 ? 1900 : 2000);
  const plaus = (dd, mm) => dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12;
  return (plaus(d, m) || plaus(m, d)) && y >= 1990 && y <= 2099;
}
function _dateCoherenceWarn(f, value){
  // PLAIN TEXT — the caller escapes for HTML; the toast consumer uses it verbatim.
  if (isIssuerField(f)) return '';
  const isDate = _isDateField(f), reads = _parsesAsDate(value);
  if (isDate && !reads){
    return `⚠ That doesn't read like a date. If the box caught the wrong text, redraw it — or type the ${f.label} below.`;
  }
  if (!isDate && reads){
    const df = (state.fields || []).find(x => x.key === state.dateFieldKey);
    return `⚠ Are you sure? That looks like a DATE, not a ${f.label}` +
           (df ? ` — the ${df.label} is its own field.` : '.');
  }
  return '';
}

// ── Is this company name believable, and is it one we already use? ───────────────────────────
// Two questions, both answered while the confirm panel is still on screen:
//   * SHAPE — `check-issuer-read` (the 2026-08-11 plausibility warn), which catches '@a eens Ee';
//   * PROXIMITY — `check-identity-near-match`, which catches the one Chris actually paid for.
//     `B8ramblewood Joinery Ltd` passes every shape test by construction; what is wrong with it is
//     that the customer already files under `Bramblewood Joinery Ltd`.
// Advisory: the panel's buttons stay live throughout, nothing is blocked, and a failed lookup adds
// nothing rather than claiming success (the `.catch(_ok)` defect this replaces).
async function _warnOnIssuerValue(f, r){
  const v = String((r && r.value) || '').trim();
  if (!v) return;
  let implausible = false, nm = null;
  try { const res = await D.checkIssuerRead(v); implausible = !!(res && res.implausible); } catch {}
  try { if (D.checkIdentityNearMatch) nm = await D.checkIdentityNearMatch({ value: v, templateId: (state.doc && state.doc.template_id) || null }); } catch {}
  // The operator may have moved on (redraw, typed a different value, next field) while we waited.
  if (curField() !== f || String((state.results[f.key]||{}).value||'').trim() !== v) return;
  const host = $('rg-confirm-top'); if (!host) return;
  host.querySelector('.rb-idwarn')?.remove();
  let html = null, offer = null;
  if (nm && nm.near && nm.kind === 'subrun') {
    // Chris r17 card 3: the box caught ONE line of a stacked name — offer the full name FIRST.
    const where = nm.source === 'prefix-template' ? 'the name this layout already uses'
                : nm.source === 'template' ? `the name a saved layout already uses`
                : `which you already use on ${nm.confirms} document${nm.confirms === 1 ? '' : 's'}`;
    html = `&#9888; "${esc(v)}" is part of <span class="mono">${esc(nm.existing)}</span>, ${where} — a box over a two-line name often catches one line. Filing as "${esc(v)}" would start a second folder.`;
    offer = nm.existing;
  } else if (nm && nm.near) {
    // Tier B (a fresh install) knows the name only from the sender's own frozen layout, not a
    // confirm count — word it accordingly so the sentence is never "on null documents" (card 3).
    const known = nm.source === 'template'
      ? `<span class="mono">${esc(nm.existing)}</span>, the name this sender's saved layout already uses`
      : `<span class="mono">${esc(nm.existing)}</span>, which you already use on ${nm.confirms} document${nm.confirms === 1 ? '' : 's'}`;
    html = `&#9888; That is <strong>${nm.distance === 1 ? 'one character' : nm.distance + ' characters'}</strong> different from `
         + `${known}. Two spellings file this sender into two folders.`;
    offer = nm.existing;
  } else if (implausible) {
    html = `&#9888; That doesn't look like a company name. Redraw it, or type the name as printed below.`;
  }
  if (!html) return;
  const div = document.createElement('div');
  div.className = 'rb-idwarn';
  div.style.cssText = 'margin-top:6px;color:var(--warn);font-size:12.5px;font-weight:600';
  // Chris round 18 A2: when a known full name is on offer, USING IT is the primary action — the big
  // blue "Looks right →" directly under the warning was pressed "as I would at 5 pm" and started a
  // second folder. Swap the roles: Use "X" is primary; the old primary becomes a ghost
  // "Keep "v" anyway" (the deliberate second-company path stays one click away, just not the default).
  div.innerHTML = html + (offer
    ? ` <button type="button" class="btn primary" id="rb-use-known" style="margin-left:6px">Use "${esc(offer)}"</button>`
    : '');
  if (offer) {
    const yes = host.querySelector('#rb-yes');
    if (yes) { yes.classList.remove('primary'); yes.classList.add('ghost', 'quiet'); yes.textContent = `Keep "${v}" anyway`; yes.title = 'File this sender under its own folder, separate from ' + offer; }
  }
  // Below the value line, above the actions — where the eye already is. (Explicit if/else, not
  // `?.before(div) || appendChild(div)`: `before()` returns undefined, so the fallback would ALWAYS
  // run and the warning would render twice.)
  const _actions = host.querySelector('.rb-actions');
  if (_actions) _actions.before(div); else host.appendChild(div);
  if (offer) {
    div.querySelector('#rb-use-known')?.addEventListener('click', () => {
      r.value = offer; r.valueSource = 'known-name';
      showValueConfirm(f, r);          // re-render with the adopted name (and no warning)
    });
  }
}

function showValueConfirm(f, r){
  const issuer = isIssuerField(f);
  hideStoredBoxes=false; drawnBox=null; redrawCanvas();
  // PROVENANCE drives the whole panel (Chris-lens spec 2026-08-11, replacing the old `located`
  // heading flip): a READ value is checked as a read; a TYPED value is NEVER asked "confirm what
  // I read" — only its label is checked. Persisted on the result (like `located` before it) so
  // the Left/Above toggle and Redraw-label, which re-enter here, can't flip the heading.
  const typed = (r && r.valueSource === 'typed') || !!(r && r.located);
  // Point at the page: the confirm's boxes are drawn on the canvas — make sure they're in view.
  try { canvas.scrollIntoView({ block: 'nearest' }); } catch {}
  if (issuer){
    setPrompt('Check the company name', f.label);
    $('rg-sub').textContent = `This is how the sender will be filed. No label for this one — the name itself is what's recognised.`;
  } else if (typed){
    setPrompt('Check the label I found for', f.label);
    $('rg-sub').textContent = `The value is the one you typed. The blue box is the printed label that keeps this field findable when the page shifts.`;
  } else {
    setPrompt('Check what I read for', f.label);
    $('rg-sub').textContent = `The green box is the value; the blue box is the printed label I'll look for next time.`;
  }
  // A garbled (suspicious) label read is treated as UNREADABLE: the junk string is never
  // displayed or vouched for — the offer becomes position-only and the junk is dropped on
  // confirm. The user can still redraw the label or flip the direction.
  const suspicious = !!(r.anchor_text && r.anchorSuspicious);
  const hasLabel = !!r.anchor_text && !suspicious;
  const dir = r.anchor_dir || 'left';
  const labelBit = issuer ? '' :
    `<span class="muted" style="margin:0 8px">·</span>Label: ` + (hasLabel
      ? `<span class="lab mono">${esc(r.anchor_text)}</span> <span class="muted">(${dir==='above'?'above':'left of'} the value)</span>`
      : `<span class="muted">${suspicious ? "⚠ couldn't read it cleanly — I'll remember the spot instead" : "none found — I'll remember the spot instead"}</span>`);
  // The label DIRECTION is a setting, not an action — so it renders as a segmented control whose
  // selected side is an inset surface, never the accent fill (owner, 2026-08-02).
  const dirBtns = issuer ? '' :
    `<span class="spacer"></span>`+
    `<span class="rb-seg-lab">Label is</span>`+
    `<div class="segmented" role="group" aria-label="Where the label sits relative to the value">`+
      `<button class="seg-opt ${dir==='left'?'on':''}" id="rb-dir-left" aria-pressed="${dir==='left'}">← Left</button>`+
      `<button class="seg-opt ${dir==='above'?'on':''}" id="rb-dir-above" aria-pressed="${dir==='above'}">↑ Above</button>`+
    `</div>`;
  const _cohWarn = _dateCoherenceWarn(f, r.value);
  // THE typing row appears only where the VALUE is in question (a read, or the issuer's name) —
  // never on the typed-value label check, where the operator wrote the value themselves moments
  // ago (Chris r3 2026-08-09 finding 5 established the row for the dangerous confident-wrong
  // read; the Chris-lens spec removes it where it can only invite second-guessing their typing).
  // Never pre-filled: pre-filling with the read would invite a rubber-stamp of the very value
  // being questioned. The box keeps the geometry in `r` — only the VALUE changes.
  const typeRow = (issuer)
    ? _typeRowHtml('Name wrong? Type it as printed:', `${f.label} as printed…`, 'Use this →')
    : (typed ? '' : _typeRowHtml('Value wrong? Type it as printed:', `${f.label} as printed…`, 'Use this →'));
  setConfirm(
    `<div>${issuer ? 'Company name' : 'Value'}: <span class="val mono">${esc(r.value)}</span>${labelBit}</div>`+
    (_cohWarn ? `<div class="rb-warn" style="margin-top:6px;color:var(--warn);font-size:12.5px;font-weight:600">${esc(_cohWarn)}</div>` : '')+
    `<div class="rb-actions">`+
      `<button class="btn primary" id="rb-yes">${typed && !issuer ? 'Save this field →' : 'Looks right →'}</button>`+
      `<span class="rb-sep"></span>`+
      (typed && !issuer
        ? `<button class="btn ghost quiet" id="rb-redraw">Start this field over</button>`
        : `<button class="btn ghost quiet" id="rb-redraw">${issuer ? 'Redraw' : 'Redraw value'}</button>`)+
      (issuer ? '' : `<button class="btn ghost quiet" id="rb-redraw-label">Redraw label</button>`)+
      dirBtns+
    `</div>`+
    typeRow);
  // A typed correction TEACHES too (owner, 2026-08-11 — "the option to type a value here doesn't
  // teach"). Two distinct wrongs hide behind one typing row:
  //   * the BOX was on the wrong text → the typed value is printed SOMEWHERE ELSE. Keeping the
  //     drawn box would silently teach the wrong position on every future document. So the typed
  //     value goes through the SAME locate flow as the hatch: found → ring + approve the spot
  //     (re-targets the box, then the label re-detects beside the REAL position).
  //   * the OCR misread the RIGHT box → the printed word is garbled in the page's own word
  //     geometry too, so the locate MISSES — and keeping the drawn box is exactly correct.
  // The miss case is therefore the old behaviour byte-for-byte; the hit case is the new teach.
  const doTyped = async ()=>{
    const v = (($('rb-input')||{}).value||'').trim();
    if (!v) { const i=$('rb-input'); if(i) i.style.borderColor='var(--err)'; return; }
    if (TYPED_LOCATE_ON && v !== String(r.value||'').trim()){
      setConfirm('<span class="muted">Looking for that on the page…</span>');
      let hits=[]; try{ hits=await locateTypedValue(v); }catch{}
      if (hits.length){ showLocatedPick(f, v, hits, 0); return; }
    }
    r.value = v; r.valueSource = 'typed';
    if (issuer) return finishIssuerField(f);
    // Same two-way date check on the TYPED value — non-blocking (typed deliberately), but the
    // mix-up it catches is identical, so it must not pass silently.
    const _tw = _dateCoherenceWarn(f, v);
    if (_tw) toast(_tw.replace(/^⚠ /, ''), 4500);
    if (suspicious) r.anchor_text = null;
    r.status='done'; drawMode='value'; advanceField();
  };
  if (typeRow) _wireTypeRow(doTyped, /*focus*/false);
  // THE VERDICT ARRIVES BEFORE THE COMMIT, not after it (Oracle, 2026-08-13). The plausibility
  // check used to be fired inside finishIssuerField — i.e. AFTER "Looks right →", concurrently with
  // advanceField() — so its answer landed as a toast over the NEXT field, and its `.catch(_ok)`
  // mapped a FAILED check to the success message. Asked here instead, while the operator is still
  // looking at the name, and patched into this panel when it comes back.
  if (issuer) _warnOnIssuerValue(f, r);
  onConfirm('rb-yes', ()=>{
    if (issuer) return finishIssuerField(f);
    if (suspicious) r.anchor_text = null;   // junk never persists — position-only
    r.status='done'; drawMode='value'; advanceField();
  });
  onConfirm('rb-redraw', ()=>{ delete state.results[f.key]; promptField(); });
  if (!issuer){
    onConfirm('rb-redraw-label', enterLabelRedraw);
    onConfirm('rb-dir-left',  ()=>redetectAnchor('left'));
    onConfirm('rb-dir-above', ()=>redetectAnchor('above'));
  }
}
// "Redraw label": arm anchor-draw mode; captureAnchor below returns to the combined
// confirmation (it no longer auto-advances — one confirm covers both readings).
function enterLabelRedraw(){
  const f=curField(); if(!f) return;
  drawMode='anchor';
  setPrompt('Draw a box around the printed label for', f.label);
  $('rg-sub').textContent='Drag a rectangle over the printed caption on the page (e.g. "Invoice No."). You’ll confirm both readings after.';
  setConfirm('<span class="muted">Draw the label box on the page…</span>');
  redrawCanvas();
}
// Re-run label detection in the chosen direction (the Left/Above toggle) and refresh.
async function redetectAnchor(dir){
  const f=curField(), r=f&&state.results[f.key]; if(!r||!r.target) return;
  setConfirm('<span class="muted">Looking '+(dir==='left'?'to the left':'above the value')+'…</span>');
  _teachReadBusy = true;
  try{
    const a=await autoLabel(_teachFwdBox(r.target), dir);   // r.target RAW → crop from the DISPLAY image
    r.anchor=_teachBackBox(a.box); r.anchor_text=a.anchor_text; r.anchor_dir=a.dir||dir; r.anchorSuspicious=!!a.suspicious;
  }catch{ r.anchor_dir=dir; }
  _teachReadBusy = false;
  redrawCanvas();
  showValueConfirm(f, r);
}
async function captureAnchor(box){
  const f=curField(), r=f&&state.results[f.key]; if(!r){ drawMode='value'; return; }
  setConfirm('<span class="muted">Reading the label…</span>');
  _teachReadBusy = true;
  let text=''; try{ const res=await D.ocrRegionBoxes(await cropB64(box)); text=res&&res.text?String(res.text).trim():''; }catch{}
  _teachReadBusy = false;
  // Sanitize the manually-drawn label the same way (strip value-shaped tokens); if that empties
  // it, respect the operator's explicit pick with the raw first line.
  const A=window.AnchorLabel;
  const clean=A.sanitizeAnchorLabel(A.extractLabel(text) || '');
  text = clean || (text||'').split('\n')[0].slice(0,40);
  r.anchor=_teachBackBox({x:box.x,y:box.y,w:box.w,h:box.h,_ang:box._ang});   // store RAW (box is a display-frame draw; keep its frame angle)
  r.anchor_text = text || r.anchor_text || null;
  r.anchorSuspicious = r.anchor_text ? A.labelLooksSuspicious(r.anchor_text) : false;
  const v=r.target?_teachFwdBox(r.target):{};   // r.target is RAW — compare in the display frame the box was drawn in
  r.anchor_dir = (typeof v.y==='number' && (box.y+box.h) <= (v.y+(v.h||0)*0.5)) ? 'above' : 'left';
  r.anchorManual = true;
  drawMode='value';
  redrawCanvas();
  toast('Label captured');
  showValueConfirm(f, r);   // back to the combined confirm — the user OKs both together
}
function store(f,box,anchor,value,pending){
  // Canonicalise to the RAW frame (identity when straighten is off) so doCommit registers to the raw scan.
  // `page` is the page the operator actually drew on — it becomes the mapping's page_number at
  // commit. Recorded here, at the one place a box is stored, so no path can produce a box without
  // one (the old code hardcoded 0 downstream instead, which was only ever right because the wizard
  // could not leave page 1).
  state.results[f.key]={ value, target:_teachBackBox(box), anchor:_teachBackBox(anchor.box), anchor_text:anchor.anchor_text, anchor_dir:anchor.dir||'left', anchorSuspicious:!!anchor.suspicious, page:state.pageIndex, status:pending?'pending':'done' };
  if (!pending) advanceField();
  renderPageNav();          // the page dots show which pages already carry a taught field
}
function advanceField(){
  redrawCanvas();
  const firstMissing=state.fields.findIndex(f=>!state.results[f.key]);
  if (firstMissing>=0){ state.fieldIndex=firstMissing; promptField(); }
  else {
    // All captured: park the index PAST the last field so curField() is undefined and redrawCanvas
    // draws a CLEAN page (the last confirmed box is removed too — owner 2026-07-30). A dot-click or
    // Back re-selects a field (recomputes fieldIndex) so nothing is stranded.
    state.fieldIndex = state.fields.length;
    // Clear the last field's step header (owner 2026-07-30) — no lingering "confirm the printed label
    // for <field>" / per-field explanation. Show only the done-message + the Review pointer.
    setPrompt('Teaching complete', 'Ready to review');
    // Honest tally — "All fields captured" was false over skipped fields (Chris r2 2026-08-11).
    const _cap  = state.fields.filter(f=>state.results[f.key] && state.results[f.key].status!=='skip').length;
    const _skip = state.fields.filter(f=>state.results[f.key] && state.results[f.key].status==='skip').length;
    $('rg-sub').textContent = (_skip
      ? `${_cap} field${_cap===1?'':'s'} captured, ${_skip} marked as not on this document`
      : 'All fields captured') + ' — choose Review → below to save this document type.';
    renderFieldRail(); redrawCanvas();
    setConfirm('');
  }
}
// (The rail's duplicate Redraw button is GONE — 2026-08-11 flow rework. Redraw lives in the
// confirm states, and clicking a DONE field row re-opens its confirm state.)
// SKIP → one optional follow-up (Chris-lens design 2026-08-11, owner: "no option for not
// required for this doc"). The safe one-off skip is recorded IMMEDIATELY on the click — the
// follow-up question only decides whether the absence is DURABLE ("Never — stop looking for
// it" → template_hidden_fields at commit). Ignoring the question, clicking another rail row,
// or Back all leave the already-saved safe skip; the durable hide needs the explicit click.
$('rg-skip').onclick=()=>{
  const f=curField(); if(!f)return;
  state.results[f.key]={value:'',target:null,anchor:null,anchor_text:null,status:'skip'};
  renderFieldRail();
  // Only fields the hide can legally apply to get the question: setHiddenField refuses the
  // structural roles + identity keys server-side, so the wizard never offers "Never" there.
  const hideable = !isIssuerField(f) && f.key!==state.refFieldKey && f.key!==state.dateFieldKey
                   && f.key!=='customer_name';
  if (!hideable){ advanceField(); return; }
  showSkipFollowUp(f);
};
function showSkipFollowUp(f){
  drawMode='value'; hideStoredBoxes=true; drawnBox=null; redrawCanvas();
  setPrompt('OK — nothing saved for', f.label);
  $('rg-sub').textContent=`Does paperwork from this sender usually show a ${f.label}?`;
  setConfirm(
    `<div class="rb-actions" style="margin-top:0">`+
      `<button class="btn ghost" id="rb-skip-once">Usually — it's just missing here</button>`+
      `<button class="btn ghost" id="rb-skip-never">Never — stop looking for it</button>`+
    `</div>`+
    `<div class="muted" style="font-size:11.5px;margin-top:6px">If you choose “Never”, Scan Finder stops asking for the ${esc(f.label)} on this sender's paperwork. You can turn it back on any time in Settings → Document Types → Field visibility.</div>`);
  // NEITHER button is primary (Chris: the safe one first, the consequence in the label itself).
  onConfirm('rb-skip-once', ()=>advanceField());
  onConfirm('rb-skip-never', ()=>{
    const r=state.results[f.key]; if(r) r.hideForLayout=true;
    renderFieldRail(); advanceField();
  });
}

// crop a normalized box from the natural image → base64 PNG (no data: prefix).
// The DISPLAY render is high-DPI for crispness, but OCR reads cleanest at ~108 DPI, so
// for a PDF (re-rendered at TEACH_RENDER_SCALE) the crop is downscaled back to
// OCR_RENDER_SCALE before OCR — read quality matches the old behaviour exactly. An image
// file is at its native scan resolution (not re-rendered), so it's left untouched.
async function cropB64(box, pad){
  const im=state.img, natW=im.naturalWidth, natH=im.naturalHeight;
  const x=Math.max(0,(box.x-(pad?pad:0))*natW), y=Math.max(0,(box.y-(pad?pad:0))*natH);
  const w=Math.min(natW-x,(box.w+(pad?pad*2:0))*natW), h=Math.min(natH-y,(box.h+(pad?pad*2:0))*natH);
  // PARITY WITH REVIEW (owner-reported 2026-07-21: teach read "SO-51261" as "$00-51261"
  // where Review reads it correctly). Review's runZoneOcr crops at NATIVE resolution and
  // does not downscale at all (review/renderer.js:3188-3197). This wizard used to shrink
  // every crop to OCR_TARGET_H≈28px, which is roughly half a 1.5-scale line and enough to
  // collapse 'S'→'$' and 'O'→'0'. region.py's own light-first ladder handles scaling, so
  // the downscale was doing work the recipe already does — badly.
  // Kill switch: TEACH_NATIVE_CROP=false restores the old downscale.
  const ds = TEACH_NATIVE_CROP ? 1.0 : (h > OCR_TARGET_H ? (OCR_TARGET_H / h) : 1.0);
  const c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(w*ds)); c.height=Math.max(1,Math.round(h*ds));
  c.getContext('2d').drawImage(im,x,y,w,h,0,0,c.width,c.height);
  return c.toDataURL('image/png').split(',')[1];
}
// Auto-detect the label. Scans the WHOLE row to the LEFT of the value (not a narrow 20%
// window, which clipped a far-left label), then falls back to ABOVE — mirroring the Review
// ⊕ search. `forceDir` ('left'|'above') restricts the search to one direction (the toggle).
async function autoLabel(box, forceDir){
  const A = window.AnchorLabel;
  const leftW = Math.max(0, box.x);                                   // all the way to the left edge
  // LEFT band vertically CENTRE-EXPANDED to 1.8× the value height (oscar+007, 2026-07-10):
  // a one-line band at the value's own y decapitated a bolder/higher caption ("SO #"→'sok').
  // nearestRowTo below keeps only the row nearest the value's centre.
  const lPad  = box.h * 0.4;
  const lY    = Math.max(0, box.y - lPad);
  const left  = {x:Math.max(0,box.x-leftW), y:lY, w:leftW,
                 h:Math.min(1 - lY, box.h + 2 * lPad), dir:'left'};
  // The ABOVE band must be tall enough to CONTAIN the caption line: line spacing routinely
  // exceeds the value's own height, so the old one-line band (y-1.3h, h×1.1) clipped the
  // caption to its bottom pixel-tips and OCR hallucinated junk from the sliver (mirrors the
  // Review ⊕ fix, 2026-07-10). ~2.5 line-heights up, stopping 0.1h short of the value so the
  // band can never swallow the value's own ascenders; nearestAboveRow below keeps only the
  // bottom row of words, so a band catching two lines can't glue them together.
  // 0.028 page-height floor (oscar, 2026-07-10) ≈ two text lines (the Review ⊕'s 34px floor at
  // the 108-DPI preview): a tight x-height-only draw must still get a band tall enough to
  // contain a caption a blank half-line up, instead of re-clipping it to a sliver.
  const aH    = Math.min(Math.max(box.h*2.5, 0.028), Math.max(0, box.y - box.h*0.1));
  const above = {x:box.x, y:Math.max(0, box.y - box.h*0.1 - aH), w:box.w, h:aH, dir:'above'};
  const tries=[];
  if (forceDir==='left')        { if (leftW>0.02) tries.push(left); }
  else if (forceDir==='above')  { if (box.y>0.02) tries.push(above); }
  else                          { if (leftW>0.02) tries.push(left); if (box.y>0.02) tries.push(above); }
  // Read ONE band into a finished candidate ({box, anchor_text, dir, suspicious}) or null. Hoisted
  // out of the old `for (const band of tries)` loop so the two bands can be read and then COMPARED
  // (TEACH_LABEL_PICK, below) instead of the first non-empty one winning by arrival order. The body
  // is unchanged, including the clip-gated pass-2 re-read — a candidate is scored AFTER its own
  // pass-2, so the picker compares each side's best reading of itself.
  const _bandResult = async (band) => {
    try{
      const res=await D.ocrRegionBoxes(await cropB64(band));
      // SAME label-quality pipeline as the Review ⊕ tool (shared/anchorLabel.js): for a LEFT band
      // keep only the column NEAREST the value — so a wide two-column key/value row doesn't glue
      // the far-left caption onto the adjacent one (the "label spans to the left" bug) — then
      // strip value-shaped tokens (a code / date / ref is never a label). A bare-text fallback
      // keeps older region.py output (no per-word boxes) working.
      let cluster;
      if (band.dir==='left'){
        // Row nearest the VALUE's centre first (the band is taller than one line), then the
        // column nearest the value. Word boxes are in the DOWNSCALED crop px (cropB64's ds).
        const bandHpx = band.h*state.img.naturalHeight;
        // ds MUST match cropB64's actual downscale — which honours TEACH_NATIVE_CROP (sends the crop
        // NATIVE at ds=1.0). Recomputing OCR_TARGET_H/bandHpx here IGNORED that, so cY was scaled ~0.42×
        // against words that are in native crop px → nearestRowTo looked in the wrong place and returned
        // no row → "No label found here" even when the caption sits right beside the value (the Saltmarsh
        // "Order Date" miss). Now frame-consistent with the crop.
        const ds = TEACH_NATIVE_CROP ? 1.0 : (bandHpx>OCR_TARGET_H?(OCR_TARGET_H/bandHpx):1.0);
        const cY = ((box.y + box.h/2) - band.y) * state.img.naturalHeight * ds;
        const rowWords = A.nearestRowTo(res && res.words, cY);
        cluster = A.nearestLeftCluster(rowWords || (res && res.words));
      } else {
        cluster = A.nearestAboveRow(res && res.words);
      }
      const rawText = (cluster ? cluster.text : (res && res.text ? String(res.text) : '')).trim();
      const label   = A.sanitizeAnchorLabel(A.extractLabel(rawText) || '');
      if (label){
        let abox={x:band.x,y:band.y,w:band.w,h:band.h};
        // The cluster/word box is in the DOWNSCALED OCR-crop px (cropB64's height-target ds);
        // divide by naturalHeight*ds (from the band's own pixel height) to get page-norm coords.
        const srcBox = cluster ? cluster.box : (Array.isArray(res.box) ? res.box : null);
        let ds=1.0;
        if (srcBox){
          const bandHpx=band.h*state.img.naturalHeight;
          // Same frame fix as above: honour TEACH_NATIVE_CROP so the label word-box → page-norm
          // conversion divides by the SAME scale the crop was sent at (native = 1.0), not a phantom 0.42×.
          ds=TEACH_NATIVE_CROP?1.0:(bandHpx>OCR_TARGET_H?(OCR_TARGET_H/bandHpx):1.0);
          const nW=state.img.naturalWidth*ds, nH=state.img.naturalHeight*ds;
          const [l,t,w,h]=srcBox;
          if (nW>0&&nH>0&&w>0&&h>0){
            abox={x:band.x+l/nW, y:band.y+t/nH, w:w/nW, h:h/nH};
          }
        }
        // ── PASS-2: clip-gated tight re-read (2026-07-31, gary+Oracle signed; "oe ee No.") ──
        // The band's vertical extent is open-loop from the DRAWN value box, so a low/short draw
        // decapitates the caption and OCR reads half-glyph junk that sanitize/suspicious can't
        // always catch. Mechanism evidence — the picked cluster's box touching the band's
        // clipping edge (fragments sit AT the edge by construction; ABOVE bands only clip at
        // their top, their bottom abuts the value row by design) — or a suspicious pass-1 label
        // triggers ONE tight re-read anchored to the label's OWN glyph rows. A clean unclipped
        // draw never pays a second OCR and can never be degraded (the tight-draw PIN).
        let suspicious = A.labelLooksSuspicious(label);
        const cropHpx  = Math.round(band.h*state.img.naturalHeight*ds);
        const clipped  = !!(cluster && srcBox)
          && A.clusterTouchesClipEdge(srcBox, cropHpx, band.dir);
        if (clipped || suspicious){
          try{
            const up = await _rereadLabelTight(abox, box, band.dir);
            if (up) return {box:up.box, anchor_text:up.anchor_text, dir:band.dir, suspicious:false};
          }catch{}
          // Pass-2 unavailable or rejected (garble again / type heading / doc changed): keep
          // pass-1 but geometric clip evidence FORCES the suspicious flag, so the junk is never
          // shown as a legit label — it takes the existing suspicious→position-only downgrade.
          // Deliberate: a maybe-locatable garble label is discarded rather than vouched for.
          suspicious = suspicious || clipped;
        }
        return {box:abox, anchor_text:label, dir:band.dir, suspicious};
      }
    }catch{}
    return null;
  };

  // ── TEACH_LABEL_PICK — teach adopts the Review ⊕ tool's SCORED label pick (D1) ────────────────
  // THE GAP THIS CLOSES: this wizard picked the label by ARRIVAL ORDER — it read the LEFT band and
  // returned the moment that band produced any non-empty label, so a garbled left strip beat a clean
  // caption above. The Review ⊕ tool fixed exactly this on 2026-07-11 (renderer.js:3802-3940, the
  // 'esha, i' vs 'Customer' incident) by reading BOTH bands and scoring them through
  // AnchorLabel.pickLabelCandidate. That picker is shared, Oracle-signed and pinned in
  // shared/test_anchor_label.js — and its own comment records that teach did NOT share it
  // ("pre-existing gap, C5", anchorLabel.js:333-334). This is that gap, closed; no new judgement
  // is introduced, the same function decides on both surfaces.
  //
  // SCORING (unchanged, from the shared module): 2 = matches one of THIS field's own captions ·
  // 1 = clean · 0 = suspicious/empty. Higher wins; a score-1 tie consults the form-label word ratio;
  // any remaining tie stays LEFT (the status-quo direction); BOTH 0 -> position-only, which falls
  // through to the synthetic anchor below exactly as "no label found" always has.
  //
  // The caption bank is FIELD-SCOPED (this field's own display label), never a global bank — Oracle's
  // condition on the Review side, and it matters more here: a global bank would let a neighbouring
  // row's "Date" outscore the true unknown caption beside the value.
  //
  // COST: with the flag ON and no forceDir both bands are always read, where the old code often read
  // only the left. They are read CONCURRENTLY (the same Slice-2b reasoning as review/renderer.js:3808
  // — the two strips are independent), so the wall-clock cost is one OCR round-trip, not two.
  // A mis-steer is not silent and not sticky: the readout SHOWS the chosen label and direction before
  // anything is stored, and the existing [← Left]/[↑ Above] toggle re-runs the read pinned to one side.
  //
  // OFF is byte-identical BY CONSTRUCTION: the else-branch is the original sequential loop with the
  // original early return, so no extra OCR is issued and arrival order decides, exactly as before.
  if (!TEACH_LABEL_PICK || forceDir){
    for (const band of tries){
      const c = await _bandResult(band).catch(() => null);
      if (c) return c;
    }
  } else {
    const cands = await Promise.all(tries.map(b => _bandResult(b).catch(() => null)));
    const at = (d) => { const i = tries.findIndex(b => b.dir === d); return i >= 0 ? (cands[i] || null) : null; };
    const leftC = at('left'), aboveC = at('above');
    if (leftC && aboveC){
      const caps = [];
      try { const cf = curField(); if (cf && cf.label) caps.push(cf.label); } catch {}
      const pick = A.pickLabelCandidate(leftC.anchor_text || '', aboveC.anchor_text || '', caps);
      if (pick.direction === 'above') return aboveC;
      if (pick.direction === 'left')  return leftC;
      // direction null = both sides scored 0 (suspicious/empty). The label is discarded either way —
      // but KEEP THE LOCATED BOX (Oracle T1, 2026-08-08). Falling through to the synthetic strip
      // below would substitute a made-up 0.12-page-wide rectangle for a box we actually located,
      // which is worse geometry for the stored offset_dx/dy and for relocation — a real downgrade
      // against the pre-pick code, which stored the tight caption box with a null text. Tie default
      // is LEFT, so prefer the left band's box for the same reason the picker does.
      return { box: (leftC.box || aboveC.box), anchor_text: null, dir: (leftC.box ? leftC.dir : aboveC.dir) };
    } else {
      for (const c of cands) if (c) return c;   // only one band was readable — nothing to compare
    }
  }
  // No label found: synthetic anchor in the requested (or left) direction, no text.
  if (forceDir==='above' && box.y>0.02){
    return {box:{x:box.x,y:Math.max(0,box.y-box.h*1.2),w:box.w,h:box.h}, anchor_text:null, dir:'above'};
  }
  const ab={x:Math.max(0,box.x-Math.min(box.x,0.12)),y:box.y,w:Math.min(box.x,0.12)||box.w,h:box.h};
  return {box:ab, anchor_text:null, dir:'left'};
}

// PASS-2 of the label read: re-crop TIGHT around the pass-1 cluster's own word-box union
// (pads keyed to the larger of cluster/value height — the cluster height is the CLIPPED height)
// and re-read at native resolution, re-running the SAME picker chain on the fresh words (never
// raw res.text — the big type banner can share the OCR row, and the per-gap column split is what
// severs it). Returns {box, anchor_text} ONLY for a clean, non-suspicious, non-type-heading
// label with a usable word box — every other outcome is null (caller keeps pass-1 + forces
// suspicious). MUST never reject: fully try-wrapped by the caller; internal awaits are guarded
// against the doc changing mid-read (the ca90c73 stale-image class).
async function _rereadLabelTight(clusterNorm, valueBox, dir){
  const A = window.AnchorLabel;
  const imgRef = state.img;
  if (!imgRef) return null;
  const rect = A.labelRereadRect(clusterNorm, valueBox);
  if (!(rect.w > 0 && rect.h > 0)) return null;
  const res = await D.ocrRegionBoxes(await cropB64(rect));
  if (state.img !== imgRef) return null;          // doc changed mid-read — stale frame, drop
  let cluster;
  if (dir === 'above'){
    cluster = A.nearestAboveRow(res && res.words);
  } else {
    // Row nearest the VALUE's centre, in the pass-2 crop's own SENT pixels — same ds law as
    // cropB64 (native 1.0 under TEACH_NATIVE_CROP; the 1ef3e50 frame-math class otherwise).
    const rectHpx = rect.h * imgRef.naturalHeight;
    const ds = TEACH_NATIVE_CROP ? 1.0 : (rectHpx > OCR_TARGET_H ? (OCR_TARGET_H / rectHpx) : 1.0);
    const cY = ((valueBox.y + valueBox.h/2) - rect.y) * imgRef.naturalHeight * ds;
    const rowWords = A.nearestRowTo(res && res.words, cY);
    cluster = A.nearestLeftCluster(rowWords || (res && res.words));
  }
  if (!cluster || !Array.isArray(cluster.box)) return null;
  const text = A.sanitizeAnchorLabel(A.extractLabel(String(cluster.text || '').trim()) || '');
  if (!text || A.labelLooksSuspicious(text)) return null;
  if (A.isTypeHeadingLabel(text, state.typeHeadingNames)) return null;   // the a666b83 belt
  const rectHpx = rect.h * imgRef.naturalHeight;
  const ds = TEACH_NATIVE_CROP ? 1.0 : (rectHpx > OCR_TARGET_H ? (OCR_TARGET_H / rectHpx) : 1.0);
  const abox = A.cropBoxToPageNorm(rect, cluster.box, imgRef.naturalWidth, imgRef.naturalHeight, ds);
  if (!abox) return null;
  return { box: abox, anchor_text: text };
}

// ── Step 4: summary + commit ─────────────────────────────────────────────────
function renderSummary(){
  const s=$('commit-summary'); s.innerHTML='';
  addRow(s,'Document type',state.docTypeName,false,false);
  for (const f of state.fields){
    const r=state.results[f.key];
    const isFixed=r&&r.status==='fixed';
    // The durable hide is restated HERE, once more before anything commits (Chris-lens: the
    // review step is the second safety net for a decision that outlives this document).
    const val = r&&r.status==='skip'
      ? (r.hideForLayout
          ? "won't be looked for on this sender's paperwork — change any time in Settings → Document Types → Field visibility"
          : "— you'll fill this in when reviewing")
      : (r?r.value:'');
    addRow(s,f.label,val||'—', r&&(r.status==='skip'||!val), isFixed);
  }
}
function addRow(parent,k,v,empty,isFixed){
  const row=document.createElement('div'); row.className='srow';
  const badge=isFixed?` <span class="muted" style="font-size:11px;font-weight:400">(fixed)</span>`:'';
  row.innerHTML=`<span class="k">${esc(k)}</span><span class="v${empty?' empty':''}">${esc(v)}${badge}</span>`;
  parent.appendChild(row);
}
async function doCommit(){
  $('commit-err').textContent='';
  const next=$('btn-next'); next.disabled=true; next.textContent='Saving…';
  try{
    const allValues={};
    for (const f of state.fields){ const r=state.results[f.key]; if(r&&r.value) allValues[f.key]=r.value; }
    // The issuer the operator SEES in the wizard wins over the document row's first-pass read: the
    // row still carries the cold letterhead prefill (owner 2026-08-22: a template was named
    // "DOCUMENT OLUTIONS" from a 69% misread while the corrected "DOCUMENT SOLUTIONS" went into the
    // template's identity). The name is what Review shows as "Recognised by" — it must be the
    // corrected value, not the read the operator just fixed.
    const supplier = allValues.supplier_name || allValues.supplier || state.doc.supplier_name || null;
    // A3 (type-split arc, 2026-08-22; Oracle S2-js-a-1): ask BEFORE the template is born. The wizard
    // promotes before it confirms, so reviewService's own gate would fire too late (a half-born
    // template with no confirmed document). One question, once per sender-type split; advisory.
    if (!state.typeSplitAck && D.checkTypeSplit) {
      let ts = null;
      try { ts = await D.checkTypeSplit({ supplier_name: supplier, document_type_slug: state.docTypeSlug }); } catch {}
      if (ts && ts.split) {
        const est = esc(ts.established_name), typed = esc(ts.typed_name || state.docTypeSlug);
        $('commit-err').innerHTML = `<strong>${esc(ts.supplier || supplier || '')}</strong> files as <strong>${est}</strong> `
          + `(${Number(ts.count) || 0} so far). Teach this one as <strong>${typed}</strong>? `
          + `<button type="button" class="btn-sm" id="ts-keep">Yes, teach it as ${typed}</button> `
          + `<button type="button" class="btn-sm" id="ts-back">No — go back and change the type</button>`;
        next.disabled=false; next.textContent='Save';
        $('ts-keep')?.addEventListener('click', () => { state.typeSplitAck = true; $('commit-err').textContent=''; doCommit(); });
        $('ts-back')?.addEventListener('click', () => { $('commit-err').textContent=''; try { $('btn-back')?.click(); } catch {} });
        return;
      }
    }
    // Chris round 18 A2: the issuer-step warning is one click from being skipped; at SAVE — the last
    // door before the template is born with this name — ask ONCE more when the name on the summary is a
    // fragment / near-miss of a sender already in use. Same lookup the issuer step ran; advisory; the
    // "keep" path stays (a genuine second company) but is never the default button.
    if (!state.issuerNearMatchAck && supplier && D.checkIdentityNearMatch) {
      let nm = null;
      try { nm = await D.checkIdentityNearMatch({ value: supplier, templateId: (state.doc && state.doc.template_id) || null }); } catch {}
      if (nm && nm.near && nm.existing && String(nm.existing).trim().toLowerCase() !== String(supplier).trim().toLowerCase()) {
        const full = esc(nm.existing), frag = esc(supplier);
        $('commit-err').innerHTML = (nm.kind === 'subrun'
            ? `"<strong>${frag}</strong>" is part of <strong>${full}</strong>, a sender you already use — saving it would start a second folder. `
            : `"<strong>${frag}</strong>" is ${nm.distance === 1 ? 'one character' : (Number(nm.distance) || 'a few') + ' characters'} off <strong>${full}</strong>, a sender you already use — two spellings file into two folders. `)
          + `<button type="button" class="btn-sm" id="nm-use">Use "${full}"</button> `
          + `<button type="button" class="btn-sm" id="nm-keep">Keep "${frag}" anyway</button>`;
        next.disabled=false; next.textContent='Save';
        $('nm-use')?.addEventListener('click', () => {
          const isf = state.fields.find(f => isIssuerField(f));
          if (isf && state.results[isf.key]) { state.results[isf.key].value = nm.existing; state.results[isf.key].valueSource = 'known-name'; }
          state.issuerNearMatchAck = true; $('commit-err').textContent=''; doCommit();
        });
        $('nm-keep')?.addEventListener('click', () => { state.issuerNearMatchAck = true; $('commit-err').textContent=''; doCommit(); });
        return;
      }
    }
    // 1) create/refresh the template + pin this page as the sample (→ landmarks)
    const promo=await D.promoteToTemplate({
      document_id:state.doc.id, allValues, document_type_slug:state.docTypeSlug, supplier_name:supplier,
    });
    if (!promo||!promo.success){ throw new Error((promo&&promo.error)||'Could not create the template.'); }
    const templateId=promo.templateId;
    // 2a) save locked fixed values (admin override — survives confirmed-history rebuilds)
    let warnLandmarks=false;
    for (const f of state.fields){
      const r=state.results[f.key]; if(!r||r.status!=='fixed'||!r.value) continue;
      try{ await D.setTemplateFieldFixed(templateId, f.key, r.value); }
      catch(e){ console.warn('set fixed value failed:', e); }
    }
    // 2a') declared-absent fields ("Never — stop looking for it", Chris-lens design 2026-08-11):
    // written HERE, after promote-to-template, so Back/Cancel stay safe (the wizard's
    // deferred-commit principle). setHiddenField refuses structural roles server-side; the
    // wizard never offers "Never" for them, so a refusal here is belt-and-braces only.
    for (const f of state.fields){
      const r=state.results[f.key]; if(!r||r.status!=='skip'||!r.hideForLayout) continue;
      try{ await D.setTemplateHiddenField(templateId, f.key, true); }
      catch(e){ console.warn('hide field failed:', e); }
    }
    // 2b) save a Stage 0.5 mapping per captured (non-fixed) field
    for (const f of state.fields){
      const r=state.results[f.key]; if(!r||r.status==='skip'||r.status==='fixed'||!r.target) continue;
      // No anchor: the issuer is POSITION-ONLY, so its "anchor" box is the target itself —
      // never a synthesised box to the LEFT, which would be phantom geometry the mapper
      // could try to relocate against. Label-less mappings are supported (template_mapper.py).
      const a = r.anchor || (isIssuerField(f)
        ? { x:r.target.x, y:r.target.y, w:r.target.w, h:r.target.h }
        : { x:Math.max(0,r.target.x-0.1), y:r.target.y, w:0.1, h:r.target.h });
      await D.saveTemplateMapping(templateId,{
        // The page the operator drew on. Falls back to 0 for a result stored before this field
        // existed (an in-flight wizard across an app update), which is exactly the old behaviour.
        field_key:f.key, page_number:Number.isInteger(r.page)?r.page:0, anchor_text:r.anchor_text||null,
        anchor_x_norm:a.x, anchor_y_norm:a.y, anchor_w_norm:a.w, anchor_h_norm:a.h,
        target_x_norm:r.target.x, target_y_norm:r.target.y, target_w_norm:r.target.w, target_h_norm:r.target.h,
        search_expansion:0.04, enabled:1,
      });
    }
    // 3) file the document via the normal confirm path (runs learning)
    const conf=await D.confirmReview({
      acknowledgeTypeSplit: !!state.typeSplitAck,   // A3: the wizard already asked (pre-promote)
      acknowledgeIssuerNearMatch: !!state.issuerNearMatchAck,   // r18 A2: "Keep anyway" at Save is the deliberate second company
      document_id:state.doc.id, folder_path:state.doc.folder_path, original_filename:state.doc.original_filename,
      allValues, supplier_name:supplier, document_type:state.docTypeName, document_type_slug:state.docTypeSlug,
      corrections:[], taught_fields:state.fields.map(f=>f.key),
    });
    if (conf && conf.success===false){ throw new Error(conf.error||'Could not file the document.'); }
    // landmark heads-up
    try{ const det=await D.getTemplateDetail(templateId); if(det && (det.landmarks||[]).length<2) warnLandmarks=true; }catch{}
    $('done-warn').textContent = warnLandmarks
      ? 'Heads-up: this page didn\'t have many distinct printed words, so extraction may be less tolerant of crooked or rescaled scans. A cleaner/straighter example helps.' : '';
    setStep(5);
    renderTeachFollowup();   // "check a few more and this sender files itself" — advisory, navigation only
  }catch(e){
    $('commit-err').textContent=e.message||'Something went wrong while saving.';
    next.disabled=false; next.textContent='Save teaching & file';
  }
}

// ── Step 5: done ─────────────────────────────────────────────────────────────
// (footer Next = "Done" → close)
function finishDone(){ D.windowClose(); }

// POST-TEACH FOLLOW-UP CARD (gary+barry → Oracle SIGN-OFF-W/COND 2026-08-21). After a teach, tell the
// operator the TRUTH about how close this sender is to filing itself, and — when confirming a few
// queued siblings would get it there — offer a one-click route to Review. It NEVER confirms or files
// anything (all confirming stays in the guarded Review surface, C5); the number comes from the backend,
// which reads the learned format groups the gate reads (C1) and only promises when the queued siblings
// can actually reach the bar (C2). Reward-framed, never a naked "you owe N" quota. Fail-quiet: any
// error, or nothing to say, renders nothing.
async function renderTeachFollowup(){
  const el = $('teach-followup'); if(!el) return;
  el.style.display='none'; el.innerHTML='';
  const docId = state.doc && state.doc.id; if(!docId) return;
  let f=null; try{ f = await D.getTeachFollowup(docId); }catch{ f=null; }
  if(!f || f.ok===false || !f.supplier) return;
  const sender = esc(f.supplier), type = esc(f.typeName || 'documents');
  const box = 'display:block;margin:14px 0;padding:14px 16px;border:1px solid var(--border2);'
            + 'border-radius:var(--r);background:var(--surface2);line-height:1.5';
  if (f.ready){
    el.style.cssText = box;
    el.innerHTML = `<div style="color:var(--ok)">✓ <b>${sender}</b> now files itself — its ${type} go straight to their folder from now on.</div>`;
    return;
  }
  // What happens to the QUEUED siblings once the sender crosses the line (Chris r12 #4: "it will
  // start filing itself" over-promised for documents already in the queue). With the scope-local
  // auto-accept on they file by themselves after the confirms; otherwise they become one-click
  // ready and only FUTURE imports file with no click.
  const rest = f.autoAccept
    ? `the rest of their ${type} in the queue will file themselves`
    : `the rest of their ${type} become ready to file in one click — and future ones file themselves`;
  const reviewBtn = `<div style="margin-top:10px"><button class="btn primary" id="fu-review">Check them in Review</button></div>`;
  const wireBtn = () => { const btn=$('fu-review'); if(btn) btn.onclick=()=>{ try{ f.firstSibling ? D.openReviewWindowAt(f.firstSibling) : D.openReviewWindow(); }catch{} D.windowClose(); }; };
  if (f.canPromise){
    el.style.cssText = box;
    el.innerHTML =
        `<div style="font-weight:600;margin-bottom:4px"><b>${sender}</b> is learned, and this document is filed.</div>`
      + `<div class="muted">Confirm <b>${f.needed}</b> more ${sender} ${type} and ${rest} — `
      + `${f.siblingCount} are waiting that look just like this one. You still check every value; nothing files on a guess.</div>`
      + reviewBtn;
    wireBtn();
    return;
  }
  // Chris r12 #3: the number and the road back to Review were hidden whenever canPromise was false —
  // and it is false on a first teach precisely because the queued siblings were read BEFORE the
  // layout existed (blank references), not because the count is wrong. Show the real count and the
  // Review link whenever siblings exist; gate only the WORDING of the promise (barry/Oracle).
  if (f.siblingCount > 0 && f.needed > 0){
    el.style.cssText = box;
    const unread = f.siblingsUnread
      ? ` They were read before this layout existed, so their details fill in when they're re-read.`
      : ` Their details still need checking, so I can't promise the exact moment.`;
    el.innerHTML =
        `<div style="font-weight:600;margin-bottom:4px"><b>${sender}</b> is filed and its layout is saved.</div>`
      + `<div class="muted">Confirm <b>${f.needed}</b> more ${sender} ${type} and ${rest}. `
      + `<b>${f.siblingCount}</b> from ${sender} ${f.siblingCount === 1 ? 'is' : 'are'} waiting in Review.${unread}</div>`
      + reviewBtn;
    wireBtn();
    return;
  }
  // Nothing of theirs is queued: the honest reward, with no number we can't keep.
  el.style.cssText = box;
  el.innerHTML =
      `<div style="font-weight:600;margin-bottom:4px"><b>${sender}</b> is filed and its layout is saved.</div>`
    + `<div class="muted">I'll recognise ${sender} from now on. As you confirm a few more of their ${type} in the review queue, it will start filing itself.</div>`;
}

// TEACH ANOTHER — reload rather than reset. state carries ~20 keys (drawn boxes, per-field results,
// pendingAnchors, page cache, deskew renders, the chosen type); hand-clearing them would leave one
// behind eventually and a stale box silently taught onto the NEXT document is the worst possible
// failure for this wizard. A reload cannot leak. get-teach-target is consumed on first read
// (main.js), so the reloaded window has no target doc and boots at the document list — the flag
// below just skips the welcome card, which nobody needs twice.
const _againBtn = $('btn-teach-another');
if (_againBtn) _againBtn.onclick = () => {
  try { sessionStorage.setItem('teachAgain', '1'); } catch {}
  location.reload();
};

// ── Boot ─────────────────────────────────────────────────────────────────────
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
$('btn-next').addEventListener('click',()=>{ if(state.step===5) finishDone(); });

(async function init(){
  try{ state.targetDocId = await D.getTeachTarget(); }catch{}
  D.onTeachLoadDoc && D.onTeachLoadDoc(id=>{ state.targetDocId=id; });
  if (state.targetDocId){
    try{
      state.docs = await D.getReviewQueue() || [];
      const hit=state.docs.find(d=>d.id===state.targetDocId);
      if (hit) state.doc=hit;
    }catch{}
  }
  // Launched from Review with a known document → skip welcome + document-selection and
  // go straight to choosing the document type (we already know which doc this is). Floor
  // Back at the type step so it can't return to the skipped selection.
  if (state.targetDocId && state.doc) state.minStep = 2;
  // "Teach another" reload: go straight to the document list rather than the welcome card. Read
  // ONCE and cleared, so a later manual reopen still gets the normal welcome.
  let again = false;
  try { again = sessionStorage.getItem('teachAgain') === '1'; sessionStorage.removeItem('teachAgain'); } catch {}
  setStep(again && !state.targetDocId ? 1 : state.minStep);
})();
