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
  docs: [],            // review-queue rows to choose from
  doc: null,           // chosen row {id, folder_path, original_filename, supplier_name}
  pageDataUrl: null,
  img: null,           // loaded Image (natural size)
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
  $('btn-back').style.visibility = state.step===0 ? 'hidden' : 'visible';
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
$('btn-back').onclick = () => { if (state.step>0) setStep(state.step-1); };
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
      `<div class="muted" style="font-size:12px">${esc(d.supplier_name||'Unknown supplier')}</div>`;
    if (window.Thumbs) window.Thumbs.lazy(c.querySelector('.ic-thumb'), d);
    c.onclick=()=>{ state.doc=d; renderDocPicker(); renderFooter(); };
    grid.appendChild(c);
  }
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
function selectType(card,isNew){
  document.querySelectorAll('#type-grid .card').forEach(c=>c.classList.remove('sel'));
  card.classList.add('sel');
  $('new-type-panel').classList.toggle('hidden', !isNew);
  if (isNew && !state.newFields.length){
    // Seed the structural roles. Company + Date are MANDATORY (the backend force-
    // creates them — ensureStructuralRoles) so they are LOCKED here (no delete/retype),
    // mirroring Settings. Company uses the canonical scope key `supplier_name` so the
    // backend recognises it and won't inject a duplicate — only the DISPLAY label is
    // "Company". Reference is a pre-filled DEFAULT but intentionally REMOVABLE: the
    // backend deliberately allows reference-less types (forcing a ref where there is
    // none poisons filename/reference learning — see document_types.ensureStructuralRoles).
    state.newFields=[
      {label:'Company',          key:'supplier_name', type:'text', locked:true},
      {label:'Reference number',                      type:'text'},
      {label:'Date',                                  type:'date', locked:true},
    ];
    renderNewFields();
  }
  renderFooter();
}
function isNewTypeSelected(){ const s=$('type-grid').querySelector('.card.sel'); return s && s.id==='card-new'; }
function newTypeReady(){
  return $('nt-name').value.trim() && state.newFields.length>=1;
}
function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/^_+|_+$/g,''); }
function renderNewFields(){
  const wrap=$('nt-fields'); wrap.innerHTML='';
  state.newFields.forEach((f,i)=>{
    f.key = f.key || slugify(f.label);   // preserve an explicit key (e.g. supplier_name)
    const chip=document.createElement('span'); chip.className='chip'+(f.locked?' locked':'');
    if (f.locked){
      // Structural role: fixed type, no delete (mirrors the Settings 🔒 lock).
      const tl = f.type==='date'?'Date':(f.type==='currency'?'Currency':(f.type==='number'?'Number':'Text'));
      chip.innerHTML=`<span>${esc(f.label)}</span><span class="ftype">${tl}</span>`+
        `<span class="lock" title="Required field — it can’t be removed or retyped">🔒</span>`;
    } else {
      chip.innerHTML=`<span>${esc(f.label)}</span>`+
        `<select data-i="${i}"><option value="text"${f.type==='text'?' selected':''}>Text</option>`+
        `<option value="date"${f.type==='date'?' selected':''}>Date</option>`+
        `<option value="currency"${f.type==='currency'?' selected':''}>Currency</option>`+
        `<option value="number"${f.type==='number'?' selected':''}>Number</option>`+
        `<option value="reference"${f.type==='reference'?' selected':''}>Reference number</option></select>`+
        `<span class="x" data-i="${i}">✕</span>`;
    }
    wrap.appendChild(chip);
  });
  wrap.querySelectorAll('select').forEach(sel=>sel.onchange=e=>{ state.newFields[+e.target.dataset.i].type=e.target.value; });
  wrap.querySelectorAll('.x').forEach(x=>x.onclick=e=>{ state.newFields.splice(+e.target.dataset.i,1); renderNewFields(); renderKeySelectors(); renderFooter(); });
  renderKeySelectors();
}
function renderKeySelectors(){
  const opts=`<option value="">— choose —</option>`+state.newFields.map(f=>`<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('');
  const ref=$('nt-ref'), date=$('nt-date');
  const prevR=ref.value, prevD=date.value;
  ref.innerHTML=opts; date.innerHTML=opts;
  // sensible pre-guesses
  const g=(re)=>{const m=state.newFields.find(f=>re.test(f.label)||re.test(f.key));return m?m.key:'';};
  ref.value = prevR || g(/number|no\b|ref|invoice|order/i) || '';
  date.value= prevD || g(/date/i) || (state.newFields.find(f=>f.type==='date')||{}).key || '';
}
$('nt-field-add').onclick=()=>{ const v=$('nt-field-input').value.trim(); if(!v)return; state.newFields.push({label:v,type:/date/i.test(v)?'date':(/total|amount|price|cost/i.test(v)?'currency':'text')}); $('nt-field-input').value=''; renderNewFields(); renderFooter(); };
$('nt-field-input').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();$('nt-field-add').click();}});
$('nt-name').addEventListener('input',renderFooter);

async function commitTypeChoice(){
  $('nt-err').textContent='';
  if (!isNewTypeSelected()){
    const card=$('type-grid').querySelector('.card.sel');
    state.docTypeSlug=card.dataset.slug; state.docTypeName=card.dataset.name;
    let types=[]; try{ types=await D.getAllDocTypes()||[]; }catch{}
    const t=types.find(x=>x.slug===state.docTypeSlug);
    state.fields=(t&&t.fields?t.fields:[]).filter(f=>f.enabled!==0).map(f=>({key:f.key,label:f.label,type:f.type,required:!!f.required}));
    if (!state.fields.length){ $('nt-err').textContent='That type has no fields to teach.'; return false; }
    return true;
  }
  // create new type transactionally
  const name=$('nt-name').value.trim();
  const fields=state.newFields.map(f=>({key:f.key||slugify(f.label),label:f.label,type:f.type}));
  const ref=$('nt-ref').value||null, date=$('nt-date').value||null;
  const res=await D.createDocTypeWithFields({name,fields,ref_field_key:ref,date_field_key:date});
  if (!res||!res.success){ $('nt-err').textContent=(res&&res.error)||'Could not create the type.'; return false; }
  state.docTypeSlug=res.type?res.type.slug:slugify(name);
  state.docTypeName=name;
  state.fields=fields.map(f=>({key:f.key,label:f.label,type:f.type,required:(f.key===slugify(ref)||f.key===slugify(date))}));
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
let tzZoom=1, tzPanX=0, tzPanY=0, _tzPan=null;
const TZ_MIN=1, TZ_MAX=4, TZ_STEP=0.25;
function tzApply(){
  if(!canvas) return;
  canvas.style.transform=`translate(${tzPanX}px,${tzPanY}px) scale(${tzZoom})`;
  const lvl=$('tz-level'); if(lvl) lvl.textContent=Math.round(tzZoom*100)+'%';
}
function tzSet(z){ tzZoom=Math.max(TZ_MIN,Math.min(TZ_MAX,z)); tzApply(); }
function tzReset(){ tzZoom=1; tzPanX=0; tzPanY=0; tzApply(); }
async function startRegionStep(){
  canvas=$('pageCanvas'); ctx=canvas.getContext('2d');
  if (!state.img){
    try{
      const pages=await D.getDocumentPages(state.doc.id, state.doc.folder_path, state.doc.original_filename);
      state.pageDataUrl=Array.isArray(pages)?pages[0]:null;
    }catch{ state.pageDataUrl=null; }
    if (!state.pageDataUrl){ $('rg-prompt').textContent="Couldn't load that page."; return; }
    await new Promise(res=>{ const im=new Image(); im.onload=()=>{state.img=im;res();}; im.onerror=()=>res(); im.src=state.pageDataUrl; });
  }
  fitCanvas(); tzReset(); redrawCanvas();
  state.fieldIndex = state.fields.findIndex(f=>!state.results[f.key]);
  if (state.fieldIndex<0) state.fieldIndex=0;
  renderFieldRail(); promptField();
  bindCanvas();
}
function fitCanvas(){
  if (!state.img) return;
  // Size the BUFFER at (capped) NATIVE resolution — not the fitted display size — so
  // the page stays sharp when zoomed and the preview auto-grows with the window. CSS
  // (#pageCanvas max-width/max-height) downscales it to fit the pane; the transform
  // handles zoom. Only ever downscale an oversized scan (memory guard); never upscale.
  const natW=state.img.naturalWidth, natH=state.img.naturalHeight;
  const CAP=2800, s=Math.min(1, CAP/Math.max(natW,natH));
  canvas.width=Math.round(natW*s);
  canvas.height=Math.round(natH*s);
}
function redrawCanvas(){
  if (!state.img) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(state.img,0,0,canvas.width,canvas.height);
  // other captured fields' values (faint green)
  for (const f of state.fields){ const r=state.results[f.key]; if(r&&r.target&&r.status==='done') drawBox(r.target,'#3ecf8e',false); }
  // current field: its label (blue) + value (green) — same colours as Template Manager
  const cf=curField(), cr=cf?state.results[cf.key]:null;
  if (cr&&cr.anchor) drawBox(cr.anchor,'#4f8ef7',true);
  if (cr&&cr.target) drawBox(cr.target,'#3ecf8e',true);
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
  window.addEventListener('mouseup',async()=>{ if(!drag)return; const b={x:drag.x,y:drag.y,w:drag.w,h:drag.h}; drag=null; if(b.w<0.01||b.h<0.008){redrawCanvas();return;}
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
  window.addEventListener('resize',()=>{ if(state.img) redrawCanvas(); });
}
function curField(){ return state.fields[state.fieldIndex]; }
function setValueBanner(f){
  const idx=state.fieldIndex+1, total=state.fields.length;
  $('rg-prompt').textContent=`Field ${idx} of ${total} — draw a box around the ${f.label}`;
  $('rg-sub').textContent=`Drag a rectangle right over the value on the page (not the label next to it). After reading it you'll mark its label.`;
}
function promptField(){
  const f=curField(); if(!f) return;
  drawMode='value';
  setValueBanner(f);
  $('rg-readback').innerHTML=`<div class="muted" style="margin-top:4px">Or, if this field is always the same on every document of this type: <button class="btn link" id="rb-fixed" style="padding:4px 8px">Fixed value</button></div>`;
  $('rb-fixed').onclick=()=>showFixedInput(f);
  drawnBox=null; redrawCanvas();
  renderFieldRail();
}
function showFixedInput(f){
  drawMode='value';
  $('rg-prompt').textContent=`${f.label} — type the fixed value`;
  $('rg-sub').textContent=`This value is always the same on every document of this type (e.g. the company name).`;
  const existing=state.results[f.key];
  const prev=(existing&&existing.status==='fixed')?existing.value||'':'';
  $('rg-readback').innerHTML=
    `<input type="text" id="rb-fixed-input" value="${esc(prev)}" placeholder="e.g. Document Solutions" `+
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
  $('rg-readback').innerHTML='<span class="muted">Reading…</span>';
  let value=''; try{ value=(await D.ocrRegion(await cropB64(box)))||''; }catch{}
  value=(value||'').trim();
  const anchor=await autoLabel(box);
  if (!value){
    $('rg-readback').innerHTML=
      `<div class="warn">Couldn't read that clearly. Try a bigger box, or type the value:</div>`+
      `<div style="margin-top:8px;display:flex;gap:8px;align-items:center">`+
        `<input type="text" id="rb-manual-input" style="flex:1;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit" placeholder="${esc(f.label)} value…">`+
        `<button class="btn ghost" id="rb-type">Use this</button>`+
      `</div>`;
    const mi=$('rb-manual-input'); mi.focus();
    const doManual=()=>{ const v=mi.value.trim(); if(!v){mi.style.borderColor='var(--err)';return;} store(f,box,anchor,v,true); showValueConfirm(f,state.results[f.key]); };
    $('rb-type').onclick=doManual;
    mi.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();doManual();} });
    return;
  }
  store(f, box, anchor, value, /*pending*/true);
  showValueConfirm(f, state.results[f.key]);
}
// Value is stored; let the user confirm it before moving to the anchor step.
function showValueConfirm(f, r){
  $('rg-readback').innerHTML=
    `<div>I read: <span class="val mono">${esc(r.value)}</span> — is that right?</div>`+
    `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">`+
      `<button class="btn primary" id="rb-yes">Yes →</button>`+
      `<button class="btn ghost" id="rb-redraw">Redraw</button>`+
    `</div>`;
  $('rb-yes').onclick=()=>enterAnchorMode();
  $('rb-redraw').onclick=()=>{ delete state.results[f.key]; promptField(); };
}
// After confirming the value, auto-enter anchor mode so the user can mark (or skip)
// the printed label Scan Finder follows when the layout shifts.
function enterAnchorMode(){
  const f=curField(), r=f&&state.results[f.key]; if(!r) return;
  drawMode='anchor';
  $('rg-prompt').textContent=`Step 2 — mark the label for ${f.label}`;
  $('rg-sub').textContent=`Draw a box around the printed label near the value (e.g. "${f.label}:"). You can draw it anywhere — the relative offset is remembered. Or skip if there's no clear label.`;
  const hasLabel = !!r.anchor_text;
  const lbl = hasLabel
    ?`Auto-detected: <span class="mono">"${esc(r.anchor_text)}"</span>`
    :'No label auto-detected — will use position only.';
  // The primary button KEEPS the auto-detected label (or accepts position-only) and
  // advances — it never discards a detected label, so it's named for what it does
  // ("Skip label" wrongly implied the detected anchor was being thrown away).
  const keepText = hasLabel ? 'Keep this label →' : 'Continue without a label →';
  $('rg-readback').innerHTML=
    `<div class="muted" style="font-size:13px">${lbl}</div>`+
    `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">`+
      `<button class="btn primary" id="rb-skip-anchor">${keepText}</button>`+
      `<button class="btn ghost" id="rb-redraw-val">← Redraw value</button>`+
    `</div>`;
  $('rb-skip-anchor').onclick=()=>{ r.status='done'; drawMode='value'; advanceField(); };
  $('rb-redraw-val').onclick=()=>{ delete state.results[f.key]; promptField(); };
  redrawCanvas();
}
async function captureAnchor(box){
  const f=curField(), r=f&&state.results[f.key]; if(!r){ drawMode='value'; return; }
  $('rg-readback').innerHTML='<span class="muted">Reading the label…</span>';
  let text=''; try{ const res=await D.ocrRegionBoxes(await cropB64(box)); text=res&&res.text?String(res.text).trim():''; }catch{}
  text=(text||'').split('\n')[0].slice(0,40);
  r.anchor={x:box.x,y:box.y,w:box.w,h:box.h};
  r.anchor_text = text || r.anchor_text || null;
  r.anchorManual = true;
  r.status = 'done';
  drawMode='value';
  redrawCanvas();
  toast('Label captured');
  advanceField();
}
function store(f,box,anchor,value,pending){
  state.results[f.key]={ value, target:box, anchor:anchor.box, anchor_text:anchor.anchor_text, status:pending?'pending':'done' };
  if (!pending) advanceField();
}
function advanceField(){
  redrawCanvas();
  const next=state.fields.findIndex((f,i)=>i>state.fieldIndex && !state.results[f.key] || (i>state.fieldIndex && state.results[f.key] && state.results[f.key].status==='pending'));
  const firstMissing=state.fields.findIndex(f=>!state.results[f.key]);
  if (firstMissing>=0){ state.fieldIndex=firstMissing; promptField(); }
  else { renderFieldRail(); $('rg-readback').innerHTML='<div class="muted">All details captured — choose <b>Review →</b> below.</div>'; }
}
$('rg-redraw').onclick=()=>{ const f=curField(); if(f) delete state.results[f.key]; promptField(); };
$('rg-skip').onclick=()=>{ const f=curField(); if(!f)return; state.results[f.key]={value:'',target:null,anchor:null,anchor_text:null,status:'skip'}; advanceField(); };

// crop a normalized box from the natural image → base64 PNG (no data: prefix)
async function cropB64(box, pad){
  const im=state.img, natW=im.naturalWidth, natH=im.naturalHeight;
  const x=Math.max(0,(box.x-(pad?pad:0))*natW), y=Math.max(0,(box.y-(pad?pad:0))*natH);
  const w=Math.min(natW-x,(box.w+(pad?pad*2:0))*natW), h=Math.min(natH-y,(box.h+(pad?pad*2:0))*natH);
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h));
  c.getContext('2d').drawImage(im,x,y,w,h,0,0,c.width,c.height);
  return c.toDataURL('image/png').split(',')[1];
}
// Auto-detect the label: OCR the band immediately LEFT of the value, then ABOVE.
async function autoLabel(box){
  const bandW=Math.min(box.x,0.20);
  const tries=[];
  if (bandW>0.02) tries.push({x:box.x-bandW,y:box.y,w:bandW,h:box.h, dir:'left'});
  if (box.y>0.02) tries.push({x:box.x,y:Math.max(0,box.y-box.h*1.3),w:box.w,h:box.h*1.1, dir:'above'});
  for (const band of tries){
    try{
      const res=await D.ocrRegionBoxes(await cropB64(band));
      const text=res&&res.text?String(res.text).trim():'';
      if (text && text.replace(/[^A-Za-z]/g,'').length>=3){
        let abox={x:band.x,y:band.y,w:band.w,h:band.h};
        if (Array.isArray(res.box)){ // tighten to the detected word (box in crop-original px)
          const cw=band.w*state.img.naturalWidth, ch=band.h*state.img.naturalHeight;
          const [l,t,w,h]=res.box;
          if (cw>0&&ch>0&&w>0&&h>0){
            abox={x:band.x+l/state.img.naturalWidth, y:band.y+t/state.img.naturalHeight,
                  w:w/state.img.naturalWidth, h:h/state.img.naturalHeight};
          }
        }
        return {box:abox, anchor_text:text.split('\n')[0].slice(0,40)};
      }
    }catch{}
  }
  // No label found: use a synthetic anchor just left of the value (no text).
  const ab={x:Math.max(0,box.x-Math.min(box.x,0.12)),y:box.y,w:Math.min(box.x,0.12)||box.w,h:box.h};
  return {box:ab, anchor_text:null};
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
      const a=r.anchor||{x:Math.max(0,r.target.x-0.1),y:r.target.y,w:0.1,h:r.target.h};
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
  setStep(0);
})();
