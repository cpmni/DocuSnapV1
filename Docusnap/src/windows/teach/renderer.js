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
  'rg-redraw': 'Draw the box again if the read-back wasn’t quite right.',
  'rg-skip':   'Skip this field for now and carry on with the rest.',
  'rg-fieldlist':'The fields for this document type, and which ones you’ve pointed out so far.',
  'help-mode': 'Help mode: click any control to see what it does. Press Esc to leave.',
});
$('btn-cancel').onclick = () => confirmCancel();
function confirmCancel(){
  if (confirm('Stop teaching? Nothing is saved yet.')) D.windowClose();
}

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1600); }

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
  const labels = ["Let's start →","Continue →","Continue →","Review →","File this document","Done"];
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
  for (const d of state.docs){
    const c=document.createElement('div'); c.className='card'+(state.doc&&state.doc.id===d.id?' sel':'');
    const name=d.original_filename||('Document #'+d.id);
    // 📄 emoji is the placeholder; the real page-1 thumbnail replaces it once
    // loaded. A doc with no renderable thumbnail keeps the emoji.
    c.innerHTML=`<div class="ic"><span class="ic-emoji">📄</span><img class="ic-thumb" alt=""></div>`+
      `<div class="nm" style="font-size:13px;word-break:break-all">${esc(name)}</div>`+
      `<div class="muted" style="font-size:12px">${esc(d.supplier_name||'Unknown issuer')}</div>`;   // display name is "Document Issuer" (mig 38); supplier_name is only the internal key
    if (window.Thumbs) window.Thumbs.lazy(c.querySelector('.ic-thumb'), d);
    // Toggle the selection IN PLACE. A full re-render rebuilt every card and re-ran the
    // lazy thumbnail loader on all of them, and left the enlarged state depending on a
    // clean rebuild every time. Toggling makes "exactly one card is big" true by
    // construction — no card can keep the big styling after another is picked.
    c.onclick=()=>{
      state.doc=d;
      for (const el of grid.querySelectorAll('.card')) el.classList.toggle('sel', el===c);
      renderFooter();
    };
    grid.appendChild(c);
  }
  // Open with one card already big, so the step starts in the state a click produces
  // rather than with every card the same size and nothing to look at.
  if (!state.doc && state.docs.length){
    state.doc = state.docs[0];
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
    if (match) state.doc = match;
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
}
let dtEditor = null;   // shared DocTypeEditor (create mode); mounted lazily on "It's something new"

function selectType(card,isNew){
  document.querySelectorAll('#type-grid .card').forEach(c=>c.classList.remove('sel'));
  card.classList.add('sel');
  $('new-type-panel').classList.toggle('hidden', !isNew);
  // Mount the shared friendly creator lazily and keep it across toggles, so the
  // user's in-progress draft survives switching between cards. The component owns
  // the locked structural roles (Company/Date) + the removable Reference seed.
  if (isNew && !dtEditor && window.DocTypeEditor){
    dtEditor = window.DocTypeEditor.create($('nt-editor-host'), {
      mode:'create', api:D,
      onValidityChange: () => renderFooter(),   // live-enable the Continue button
    });
  }
  renderFooter();
}
function isNewTypeSelected(){ const s=$('type-grid').querySelector('.card.sel'); return s && s.id==='card-new'; }
function newTypeReady(){ return !!dtEditor && dtEditor.isReady(); }
// (The inline create-form — chips, key selectors, and their listeners — is gone;
//  the shared DocTypeEditor component now owns the new-type fields + role pickers.)

async function commitTypeChoice(){
  if (!isNewTypeSelected()){
    const card=$('type-grid').querySelector('.card.sel');
    state.docTypeSlug=card.dataset.slug; state.docTypeName=card.dataset.name;
    let types=[]; try{ types=await D.getAllDocTypes()||[]; }catch{}
    const t=types.find(x=>x.slug===state.docTypeSlug);
    state.fields=(t&&t.fields?t.fields:[]).filter(f=>f.enabled!==0).map(f=>({key:f.key,label:f.label,type:f.type,required:!!f.required}));
    if (!state.fields.length){ toast('That type has no fields to teach.'); return false; }
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
  state.fields=(t&&t.fields?t.fields:[]).map(f=>({
    key:f.key, label:f.label, type:f.type,
    required:(f.key===t.ref_field_key || f.key===t.date_field_key),
  }));
  return true;
}

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

async function startRegionStep(){
  canvas=$('pageCanvas'); ctx=canvas.getContext('2d');
  if (!state.img){
    try{
      const pages=await D.getDocumentPages(state.doc.id, state.doc.folder_path, state.doc.original_filename, TEACH_RENDER_SCALE);
      state.pageDataUrl=Array.isArray(pages)?pages[0]:null;
    }catch{ state.pageDataUrl=null; }
    if (!state.pageDataUrl){ $('rg-prompt').textContent="Couldn't load that page."; return; }
    await new Promise(res=>{ const im=new Image(); im.onload=()=>{state.img=im;res();}; im.onerror=()=>res(); im.src=state.pageDataUrl; });
    state.rawImg = state.img;        // canonical RAW frame — boxes are stored here (see store-raw note)
  }
  fitCanvas(); tzReset(); redrawCanvas();
  bindCanvas();
  // Straighten ON by default — training needs a level page so anchor↔target geometry registers cleanly.
  // Runs once (deskewImg unset); if the page is already straight it's a silent no-op.
  if (state.rawImg && !state.deskewImg) await toggleTeachDeskew(true);
  // Open at TZ_DEFAULT rather than fit-to-pane: the fitted page is too small to draw an
  // accurate box on, so this is where the user was going to zoom to anyway. Deferred to
  // the next frame and set AFTER any deskew re-render, so tzApply measures the true
  // fitted width (_fitW) instead of a stale or mid-layout one.
  if (TZ_DEFAULT > 1) requestAnimationFrame(() => { try { tzSet(TZ_DEFAULT); } catch {} });
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
function redrawCanvas(){
  if (!state.img) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(state.img,0,0,canvas.width,canvas.height);
  // Show ONLY the field being taught right now (owner 2026-07-30) — the previously-confirmed fields'
  // boxes are no longer drawn, so a new box is drawn on a clean page and the LAST box clears once the
  // final field is confirmed (advanceField parks fieldIndex past the end → curField() is undefined
  // below → nothing drawn). The stored results (state.results) are untouched; this is display-only.
  // current field: its label (blue) + value (green) — same colours as Template Manager
  const cf=curField(), cr=cf?state.results[cf.key]:null;
  if (cr&&cr.anchor) drawBox(_teachFwdBox(cr.anchor),'#4f8ef7',true);
  if (cr&&cr.target) drawBox(_teachFwdBox(cr.target),'#3ecf8e',true);
  else if (drawnBox) drawBox(drawnBox,'#3ecf8e',true);
  // live drag rectangle, coloured by what we're drawing
  if (drag) drawBox(drag, drawMode==='anchor'?'#4f8ef7':'#3ecf8e',true,true);
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
  canvas.addEventListener('mousedown',e=>{ if(e.button!==0)return; const p=cpoint(e); drag={x:p.x,y:p.y,w:0,h:0,_sx:p.x,_sy:p.y}; });
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
  toast(`Captured the ${f.label} position from this layout.`);
  advanceField();
}

// ── Read-back panel: ONE place, at the top ───────────────────────────────────
// The question used to sit at the BOTTOM of the page pane while the instruction sat
// at the top, so the eye had to ping-pong and you never knew which end the next
// thing would appear at. It now renders only in the banner, directly under the
// instruction it belongs to. Every write goes through setConfirm() so there is a
// single seam if it ever needs to move again.
const CONFIRM_SEL = (id) => `#rg-confirm-top [id="${id}"]`;
function eachConfirm(id, fn){ document.querySelectorAll(CONFIRM_SEL(id)).forEach(fn); }
function onConfirm(id, handler){ eachConfirm(id, el => { el.onclick = handler; }); }
function confirmValue(id){
  let v=''; eachConfirm(id, el => { if (!v) v = (el.value||'').trim(); }); return v;
}
function markConfirmInvalid(id){ eachConfirm(id, el => { el.style.borderColor='var(--err)'; }); }
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
    ? `Drag a rectangle right over the company name on the page. There's no label to mark — the issuer is recognised by its name and letterhead.`
    : `Drag a rectangle right over the value on the page (not the label next to it). After reading it you'll mark its label.`;
}
function promptField(){
  const f=curField(); if(!f) return;
  drawMode='value';
  setConfirm('');   // clear any prior read-back overlay
  setValueBanner(f);
  // Fixed-value alternative — presented as a prominent accent card (not a buried muted
  // link) so a first-time user can clearly see they DON'T have to draw a box for a field
  // whose value never changes (e.g. the company name).
  $('rg-readback').innerHTML=
    `<div style="margin-top:12px;padding:12px 14px;background:var(--accent-bg);border:1px solid var(--accent);`+
        `border-radius:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">`+
      `<div style="flex:1;min-width:170px">`+
        `<div style="font-weight:600;font-size:13px;color:var(--text)">📌 Always the same on every document?</div>`+
        `<div class="muted" style="font-size:12px;margin-top:3px">If the ${esc(f.label)} never changes (e.g. the `+
          `company name), you don't need to draw a box — just type it once.</div>`+
      `</div>`+
      `<button class="btn" id="rb-fixed" style="white-space:nowrap">Set a fixed value →</button>`+
    `</div>`;
  $('rb-fixed').onclick=()=>showFixedInput(f);
  drawnBox=null; redrawCanvas();
  renderFieldRail();
}
function showFixedInput(f){
  drawMode='value';
  setConfirm('');
  setPrompt('Type the fixed value for', f.label);
  $('rg-sub').textContent=`This value is always the same on every document of this type (e.g. the company name).`;
  const existing=state.results[f.key];
  const prev=(existing&&existing.status==='fixed')?existing.value||'':'';
  $('rg-readback').innerHTML=
    `<input type="text" id="rb-fixed-input" value="${esc(prev)}" placeholder="e.g. Acme Supplies Ltd" `+
    `style="width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;margin-bottom:10px">`+
    `<div style="display:flex;gap:8px">`+
      `<button class="btn primary" id="rb-fixed-save">Save →</button>`+
      `<button class="btn ghost" id="rb-fixed-cancel">Cancel</button>`+
    `</div>`;
  const inp=$('rb-fixed-input'); inp.focus(); inp.select();
  const save=()=>{
    const v=inp.value.trim();
    if(!v){ inp.style.borderColor='var(--err)'; return; }
    state.results[f.key]={value:v,target:null,anchor:null,anchor_text:null,status:'fixed'};
    advanceField();
  };
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();save();} });
  $('rb-fixed-save').onclick=save;
  $('rb-fixed-cancel').onclick=()=>promptField();
  drawnBox=null; redrawCanvas();
}
function renderFieldRail(){
  const done=state.fields.filter(f=>state.results[f.key]).length;
  $('rg-progress').textContent=`Details — ${done} of ${state.fields.length} done`;
  const list=$('rg-fieldlist'); list.innerHTML='';
  state.fields.forEach((f,i)=>{
    const r=state.results[f.key];
    const cls=i===state.fieldIndex?'cur':''; const dot=r? (r.status==='skip'?'skip':(r.status==='fixed'?'fixed':(r.status==='pending'?'cur':'done'))) : (i===state.fieldIndex?'cur':'');
    const row=document.createElement('div'); row.className='fieldrow '+cls;
    row.innerHTML=`<span class="dot ${dot}"></span><span>${esc(f.label)}</span>`;
    row.onclick=()=>{ state.fieldIndex=i; promptField(); };
    list.appendChild(row);
  });
  renderFooter();
}
async function readBack(box){
  const f=curField();
  $('rg-readback').innerHTML='';   // hide the per-field "fixed value?" card while confirming a read
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
  if (!value){
    setConfirm(
      `<div class="warn">Couldn't read that clearly. Try a bigger box, or type the value:</div>`+
      `<div style="margin-top:8px;display:flex;gap:8px;align-items:center">`+
        `<input type="text" id="rb-manual-input" style="flex:1;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit" placeholder="${esc(f.label)} value…">`+
        `<button class="btn ghost" id="rb-type">Use this</button>`+
      `</div>`);
    // Both copies are live: read whichever the user typed into, flag both if empty.
    const doManual=()=>{ const v=confirmValue('rb-manual-input'); if(!v){markConfirmInvalid('rb-manual-input');return;} store(f,box,anchor,v,true); showValueConfirm(f,state.results[f.key]); };
    onConfirm('rb-type', doManual);
    eachConfirm('rb-manual-input', el => el.addEventListener('keydown', e=>{ if(e.key==='Enter'){e.preventDefault();doManual();} }));
    { const mi=$('rb-manual-input'); if (mi) mi.focus(); }
    return;
  }
  store(f, box, anchor, value, /*pending*/true);
  showValueConfirm(f, state.results[f.key]);
}
// Value is stored; let the user confirm it before moving to the anchor step.
function showValueConfirm(f, r){
  setConfirm(
    `<div>I read: <span class="val mono">${esc(r.value)}</span> — is that right?</div>`+
    `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">`+
      `<button class="btn primary" id="rb-yes">Yes →</button>`+
      `<button class="btn ghost" id="rb-redraw">Redraw</button>`+
    `</div>`);
  // Issuer: the value confirmation is the LAST step — no label to confirm.
  onConfirm('rb-yes',   ()=> isIssuerField(f) ? finishIssuerField(f) : enterAnchorMode());
  onConfirm('rb-redraw',()=>{ delete state.results[f.key]; promptField(); });
}
// After confirming the value, auto-enter anchor mode so the user can mark (or skip)
// the printed label Scan Finder follows when the layout shifts.
function enterAnchorMode(){
  const f=curField(), r=f&&state.results[f.key]; if(!r) return;
  drawMode='anchor';
  setPrompt('Step 2 — confirm the printed label for', f.label);
  $('rg-sub').textContent=`Scan Finder follows a printed label so the field keeps reading when the layout shifts. Confirm the detected label and its direction, draw a different box, or continue without one.`;
  renderAnchorReadout();
  redrawCanvas();
}
// The anchor read-out + the Left/Above direction question. Factored out so the toggle
// re-renders after a re-detect. The primary button KEEPS the detected label (or accepts
// position-only) and advances — it never discards a detected label.
function renderAnchorReadout(){
  const f=curField(), r=f&&state.results[f.key]; if(!r) return;
  // A garbled (suspicious) read is treated as UNREADABLE: the junk string is never displayed
  // or offered as "Keep this label" — a garbled label never re-locates on future pages, and
  // the user must never be asked to vouch for text they can't find on the page. The offer
  // becomes position-only; the junk itself is dropped on advance (rb-skip-anchor below).
  const suspicious = !!(r.anchor_text && r.anchorSuspicious);
  const hasLabel = !!r.anchor_text && !suspicious;
  const dir = r.anchor_dir || 'left';
  const lbl = hasLabel
    ? `Detected label: <span class="mono">"${esc(r.anchor_text)}"</span>`
    : suspicious
      ? `⚠ Couldn't read the caption here cleanly — the position will be remembered instead. Draw a box round the printed label, try the other direction, or continue without one.`
      : 'No label found here — try the other direction, draw one, or continue without.';
  const keepText = hasLabel ? 'Keep this label →' : 'Continue without a label →';
  setConfirm(
    `<div class="muted" style="font-size:13px">${lbl}</div>`+
    `<div style="margin-top:9px;font-size:13px">Is the label to the <b>left</b> of the value, or <b>above</b> it?</div>`+
    `<div style="margin-top:6px;display:flex;gap:6px">`+
      `<button class="btn ${dir==='left'?'primary':'ghost'}" id="rb-dir-left">← Left</button>`+
      `<button class="btn ${dir==='above'?'primary':'ghost'}" id="rb-dir-above">↑ Above</button>`+
    `</div>`+
    `<div style="margin-top:11px;display:flex;gap:8px;flex-wrap:wrap">`+
      `<button class="btn primary" id="rb-skip-anchor">${keepText}</button>`+
      `<button class="btn ghost" id="rb-redraw-val">← Redraw value</button>`+
    `</div>`);
  onConfirm('rb-dir-left',   ()=>redetectAnchor('left'));
  onConfirm('rb-dir-above',  ()=>redetectAnchor('above'));
  onConfirm('rb-skip-anchor',()=>{ if (suspicious) r.anchor_text=null; r.status='done'; drawMode='value'; advanceField(); });
  onConfirm('rb-redraw-val', ()=>{ delete state.results[f.key]; promptField(); });
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
  renderAnchorReadout();
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
  r.status = 'done';
  drawMode='value';
  redrawCanvas();
  toast('Label captured');
  advanceField();
}
function store(f,box,anchor,value,pending){
  // Canonicalise to the RAW frame (identity when straighten is off) so doCommit registers to the raw scan.
  state.results[f.key]={ value, target:_teachBackBox(box), anchor:_teachBackBox(anchor.box), anchor_text:anchor.anchor_text, anchor_dir:anchor.dir||'left', anchorSuspicious:!!anchor.suspicious, status:pending?'pending':'done' };
  if (!pending) advanceField();
}
function advanceField(){
  redrawCanvas();
  const next=state.fields.findIndex((f,i)=>i>state.fieldIndex && !state.results[f.key] || (i>state.fieldIndex && state.results[f.key] && state.results[f.key].status==='pending'));
  const firstMissing=state.fields.findIndex(f=>!state.results[f.key]);
  if (firstMissing>=0){ state.fieldIndex=firstMissing; promptField(); }
  else {
    // All captured: park the index PAST the last field so curField() is undefined and redrawCanvas
    // draws a CLEAN page (the last confirmed box is removed too — owner 2026-07-30). A dot-click or
    // Back re-selects a field (recomputes fieldIndex) so nothing is stranded.
    state.fieldIndex = state.fields.length;
    renderFieldRail(); redrawCanvas();
    setConfirm('<div class="muted">All details captured — choose <b>Review →</b> below.</div>');
  }
}
$('rg-redraw').onclick=()=>{ const f=curField(); if(f) delete state.results[f.key]; promptField(); };
$('rg-skip').onclick=()=>{ const f=curField(); if(!f)return; state.results[f.key]={value:'',target:null,anchor:null,anchor_text:null,status:'skip'}; advanceField(); };

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
  for (const band of tries){
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
        const ds = bandHpx>OCR_TARGET_H?(OCR_TARGET_H/bandHpx):1.0;
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
        if (srcBox){
          const bandHpx=band.h*state.img.naturalHeight;
          const ds=bandHpx>OCR_TARGET_H?(OCR_TARGET_H/bandHpx):1.0;
          const nW=state.img.naturalWidth*ds, nH=state.img.naturalHeight*ds;
          const [l,t,w,h]=srcBox;
          if (nW>0&&nH>0&&w>0&&h>0){
            abox={x:band.x+l/nW, y:band.y+t/nH, w:w/nW, h:h/nH};
          }
        }
        return {box:abox, anchor_text:label, dir:band.dir, suspicious:A.labelLooksSuspicious(label)};
      }
    }catch{}
  }
  // No label found: synthetic anchor in the requested (or left) direction, no text.
  if (forceDir==='above' && box.y>0.02){
    return {box:{x:box.x,y:Math.max(0,box.y-box.h*1.2),w:box.w,h:box.h}, anchor_text:null, dir:'above'};
  }
  const ab={x:Math.max(0,box.x-Math.min(box.x,0.12)),y:box.y,w:Math.min(box.x,0.12)||box.w,h:box.h};
  return {box:ab, anchor_text:null, dir:'left'};
}

// ── Step 4: summary + commit ─────────────────────────────────────────────────
function renderSummary(){
  const s=$('commit-summary'); s.innerHTML='';
  addRow(s,'Document type',state.docTypeName,false,false);
  for (const f of state.fields){
    const r=state.results[f.key];
    const isFixed=r&&r.status==='fixed';
    const val = r&&r.status==='skip' ? "— you'll fill this in when reviewing" : (r?r.value:'');
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
    const supplier = state.doc.supplier_name || allValues.supplier || allValues.supplier_name || null;
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
        field_key:f.key, page_number:0, anchor_text:r.anchor_text||null,
        anchor_x_norm:a.x, anchor_y_norm:a.y, anchor_w_norm:a.w, anchor_h_norm:a.h,
        target_x_norm:r.target.x, target_y_norm:r.target.y, target_w_norm:r.target.w, target_h_norm:r.target.h,
        ocr_type: (f.type==='date'?'date':(f.type==='currency'?'currency':'text')),
        search_expansion:0.04, enabled:1,
      });
    }
    // 3) file the document via the normal confirm path (runs learning)
    const conf=await D.confirmReview({
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
  }catch(e){
    $('commit-err').textContent=e.message||'Something went wrong while saving.';
    next.disabled=false; next.textContent='File this document';
  }
}

// ── Step 5: done ─────────────────────────────────────────────────────────────
// (footer Next = "Done" → close)
function finishDone(){ D.windowClose(); }

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
  setStep(state.minStep);
})();
