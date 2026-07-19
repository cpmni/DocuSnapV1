const path=require('path'),fs=require('fs'),os=require('os');const {spawn}=require('child_process');
const REPO=__dirname+'/..';const Database=require(path.join(REPO,'node_modules','better-sqlite3'));
const learning=require(path.join(REPO,'database','modules','learning.js')),templates=require(path.join(REPO,'database','modules','templates.js'));
let lo=null;try{lo=require(path.join(REPO,'database','modules','label_overrides.js'));}catch{}
const safe=(fn,d)=>{try{return fn();}catch{return d;}};const w=d=>{const f=path.join(os.tmpdir(),`vv_${Math.random().toString(36).slice(2)}.json`);fs.writeFileSync(f,JSON.stringify(d));return f;};
const db=new Database(path.join(process.env.APPDATA,'ScanFinder','docusnap.db'),{readonly:true});
const dts=db.prepare('SELECT * FROM document_types').all();const by={};for(const f of db.prepare('SELECT * FROM fields').all())(by[f.document_type_id]||(by[f.document_type_id]=[])).push(f);for(const dt of dts)dt.fields=by[dt.id]||[];
const rows=db.prepare("SELECT id,original_filename,stored_path,working_path FROM documents WHERE original_filename LIKE 'Northgate%' AND status IN ('confirmed','needs_review') ORDER BY id LIMIT 10").all();
const snap=['--fields-file',w(dts.flatMap(d=>d.fields)),'--doc-types-file',w(dts),'--config-file',path.join(REPO,'config','keyword_patterns.json'),'--hints-file',w(safe(()=>learning.getAllHints(db),[])),'--logos-file',w(safe(()=>learning.getAllLogos(db),[])),'--templates-file',w(safe(()=>templates.getAll(db),[])),'--anchors-file',w(safe(()=>learning.getAllAnchors(db),[]))];
db.close();
const runP=(folder,file,veto)=>new Promise(res=>{const p=spawn('py',['-3.12',path.join(REPO,'python_backend','process_docs.py'),'--folder',folder,'--files-file',w([file]),'--mode','fast','--tesseract','C:/Program Files/Tesseract-OCR/tesseract.exe',...snap],{env:{...process.env,LOGO_DETAIL_VETO:veto}});let o='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',()=>{});p.on('close',()=>{for(const ln of o.split('\n')){const t=ln.trim();if(t[0]!=='{')continue;let m;try{m=JSON.parse(t);}catch{continue;}if(m.type==='file_done')return res(m.supplier_name||'(none)');}res('?');});});
(async()=>{console.log('| doc | supplier(veto OFF) | supplier(veto ON) |');let changed=0;
for(const r of rows){const src=(r.working_path&&fs.existsSync(r.working_path))?r.working_path:r.stored_path;if(!src||!fs.existsSync(src))continue;
  const off=await runP(path.dirname(src),path.basename(src),'0'),on=await runP(path.dirname(src),path.basename(src),'1');
  if(off!==on)changed++;console.log(`| ${r.id} | ${off} | ${on} |${off!==on?' ← CHANGED':''}`);}
console.log(`\nveto changed the outcome on ${changed} doc(s)`);})();
