// Slice 2 LIFT CEILING for the owner's scenario: for every held TYPED doc with a supplier, assume the
// scope reaches 3 confirms (formats exist for every required key) and ask whether base + boost crosses
// the bar — the most a Tier-1.5 recompute could ever deliver, independent of today's format state.
const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]);
const learning=require(ROOT+'/database/modules/learning');
const thr=parseInt(learning.getSetting(db,'auto_file_threshold','100'),10);
function fc(sig){const p=sig.length;if(!p)return 0;const m=sig.filter(s=>s.mismatch).length;if(m)return -Math.min(25,12+6*(m-1));const s=sig.filter(x=>x.supported).length;return (p>=3&&s>=2)?Math.min(10,3*s):0;}
const docs=db.prepare("SELECT d.*, t.slug FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='needs_review'").all();
const fq=db.prepare('SELECT key,required FROM fields WHERE document_type_id=? AND enabled=1');
const rq=db.prepare('SELECT field_key,display_value,confidence,validation_note FROM extractions WHERE document_id=?');
const H={untyped:0,noSupplier:0,noted:0,missingRole:0,alreadyAtBar:0,liftsWithBoost:0,stillBelow:0};
const lifts=[], still=[];
for(const d of docs){
  if(!d.document_type_id){H.untyped++;continue;}
  if(!String(d.supplier_name||'').trim()){H.noSupplier++;continue;}
  const f=fq.all(d.document_type_id); const keys=(f.filter(x=>x.required).length?f.filter(x=>x.required):f).map(x=>x.key);
  const rows=Object.fromEntries(rq.all(d.id).map(r=>[r.field_key,r]));
  let sc=[],sig=[],noted=false,missing=false;
  for(const k of keys){const r=rows[k];const v=r&&String(r.display_value||'').trim();if(v){sc.push(r.confidence||0);const m=!!String(r.validation_note||'').trim();noted=noted||m;sig.push({mismatch:m,supported:true});}else{sc.push(0);missing=true;}}
  if(noted){H.noted++;continue;}
  if(missing){H.missingRole++;continue;}
  const base=Math.floor(sc.reduce((a,b)=>a+b,0)/sc.length);
  if(base>=thr){H.alreadyAtBar++;continue;}
  const after=Math.min(99,Math.max(0,Math.min(100,base+fc(sig))));
  if(after>=thr){H.liftsWithBoost++;lifts.push(`#${d.id} ${d.original_filename} ${d.supplier_name}|${d.slug} base ${base} → ${after} [${keys.map(k=>k+'='+(rows[k]&&rows[k].confidence)).join(' ')}]`);}
  else{H.stillBelow++;still.push(`#${d.id} ${d.original_filename} ${d.supplier_name}|${d.slug} base ${base} → ${after} [${keys.map(k=>k+'='+(rows[k]&&rows[k].confidence)).join(' ')}]`);}
}
console.log(`threshold ${thr}; held ${docs.length}`); console.log(JSON.stringify(H,null,1));
console.log('\nWOULD LIFT (after 3 confirms, no note, all roles valued, base<bar):'); lifts.forEach(l=>console.log('  '+l));
console.log('\nSTILL BELOW even with the max boost:'); still.slice(0,25).forEach(l=>console.log('  '+l)); if(still.length>25) console.log(`  … ${still.length-25} more`);
