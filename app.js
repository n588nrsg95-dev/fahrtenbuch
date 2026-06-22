const $ = (id) => document.getElementById(id);
const storeKey = 'fahrtenbuch.v4';
let state = load();
let pendingKind = 'visit';
let pendingImageData = null;
let calibrationImageData = null;
let crop = state.calibration?.crop || {x:.25,y:.55,w:.50,h:.18};

function load(){
  try { return JSON.parse(localStorage.getItem(storeKey)) || {patients:[],entries:[],currentPatient:'',calibration:null}; }
  catch { return {patients:[],entries:[],currentPatient:'',calibration:null}; }
}
function save(){ localStorage.setItem(storeKey, JSON.stringify(state)); render(); }
function show(id){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); $(id).classList.add('active'); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){ const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }
function nowTime(){ return new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); }
function kindLabel(k){ return k==='first'?'Erster Patient':k==='last'?'Letzter Patient':'Patient'; }
function sortedEntries(){
  return [...state.entries].sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time));
}
function render(){
  $('currentPatient').textContent = state.currentPatient || 'Bitte auswählen';
  const count = state.entries.filter(e=>e.date===todayISO()).length;
  $('todayText').textContent = `Heute, ${fmtDate(todayISO())}`;
  $('todayCount').textContent = `${count} Einträge`;
  renderEntriesView();
}
function renderEntriesView(){
  const list = $('entryList'); if(!list) return;
  list.innerHTML='';
  const entries = sortedEntries();
  if(!entries.length){ list.innerHTML='<div class="hint">Noch keine Einträge vorhanden.</div>'; return; }
  let lastDate='';
  entries.forEach(e=>{
    if(e.date!==lastDate){
      lastDate=e.date;
      const h=document.createElement('div'); h.className='day-heading'; h.textContent=fmtDate(e.date);
      list.appendChild(h);
    }
    const div=document.createElement('div'); div.className='entry';
    div.innerHTML=`<div><b>${kindLabel(e.kind)}</b><small><br>${e.patient||'-'}<br>${e.time}</small></div><div><b>${e.km}</b><small><br>km</small></div>`;
    list.appendChild(div);
  });
}
function choosePatient(){
  const existing = state.patients.length ? '\nBekannte Patienten:\n' + state.patients.map((p,i)=>`${i+1}. ${p}`).join('\n') : '';
  const input = prompt('Patient auswählen oder neuen Namen eingeben:' + existing, state.currentPatient || '');
  if(!input) return;
  const n = input.trim(); if(!n) return;
  if(!state.patients.includes(n)) state.patients.push(n);
  state.currentPatient = n; save();
}
function startCapture(kind){
  pendingKind = kind;
  pendingImageData = null;
  $('kmInput').value=''; $('ocrStatus').textContent='Bereit';
  $('photoPreview').innerHTML='<span>Noch kein Foto</span>';
  show('captureView');
}
function openFile(inputId){ $(inputId).value=''; $(inputId).click(); }
function readFile(file, cb){
  if(!file) return;
  const r=new FileReader();
  r.onload=()=>cb(r.result);
  r.readAsDataURL(file);
}
function setPreview(id, data){ $(id).innerHTML=`<img src="${data}" alt="Foto" />`; }

async function imageToCanvas(dataUrl){
  const img = new Image();
  img.decoding='async';
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
  const max=1400; let w=img.width,h=img.height; const scale=Math.min(1,max/Math.max(w,h)); w=Math.round(w*scale); h=Math.round(h*scale);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  return c;
}
function cropCanvas(src, cr){
  const c=document.createElement('canvas');
  const sx=Math.max(0, Math.round(src.width*cr.x));
  const sy=Math.max(0, Math.round(src.height*cr.y));
  const sw=Math.min(src.width-sx, Math.round(src.width*cr.w));
  const sh=Math.min(src.height-sy, Math.round(src.height*cr.h));
  c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(src,sx,sy,sw,sh,0,0,sw,sh);
  return c;
}
function preprocess(c){
  const out=document.createElement('canvas'); out.width=c.width*2; out.height=c.height*2;
  const ctx=out.getContext('2d'); ctx.drawImage(c,0,0,out.width,out.height);
  const img=ctx.getImageData(0,0,out.width,out.height); const d=img.data;
  for(let i=0;i<d.length;i+=4){
    const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const v=g>120?255:0; d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0); return out;
}
function extractCandidates(text){
  const raw = (text||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[S]/g,'5');
  const chunks = raw.match(/\d[\d\s.,]{3,10}\d/g) || [];
  const nums=[];
  for(const ch of chunks){
    const compact=ch.replace(/[^0-9]/g,'');
    if(compact.length>=5 && compact.length<=7) nums.push(compact);
  }
  const all = raw.match(/\b\d{5,7}\b/g)||[]; nums.push(...all);
  const unique=[...new Set(nums)].map(Number).filter(n=>n>=10000 && n<=9999999);
  return unique.sort((a,b)=>{
    const sa = scoreKm(a), sb = scoreKm(b); return sb-sa;
  });
}
function scoreKm(n){
  let s=0; const str=String(n);
  if(str.length===6) s+=5; if(str.length===5) s+=3; if(str.length===7) s+=1;
  const last = state.entries[state.entries.length-1]?.km;
  if(last){ const diff=Math.abs(n-Number(last)); if(diff<500) s+=8; else if(diff<3000) s+=4; }
  const cal = Number(state.calibration?.km); if(cal){ const diff=Math.abs(n-cal); if(diff<50000) s+=2; }
  return s;
}
async function recognize(dataUrl){
  $('ocrStatus').textContent='Erkennung läuft...';
  if(!window.Tesseract){ $('ocrStatus').textContent='OCR konnte nicht geladen werden. Bitte manuell eintragen.'; return; }
  try{
    const base = await imageToCanvas(dataUrl);
    const tries=[];
    if(state.calibration?.crop) tries.push(cropCanvas(base,state.calibration.crop));
    tries.push(cropCanvas(base,{x:.18,y:.50,w:.55,h:.20})); // links unten/mittig wie Audi
    tries.push(cropCanvas(base,{x:.10,y:.45,w:.80,h:.35}));
    tries.push(base);
    let best=[];
    for(const t of tries){
      const p=preprocess(t);
      const res=await Tesseract.recognize(p,'eng',{logger:()=>{}});
      const candidates=extractCandidates(res.data.text);
      if(candidates.length){ best=candidates; break; }
    }
    if(best.length){
      $('kmInput').value=best[0];
      $('ocrStatus').textContent=`Vorschlag erkannt: ${best[0]} km. Bitte prüfen.`;
    } else {
      $('ocrStatus').textContent='Nicht sicher erkannt. Bitte Kilometerstand eintragen.';
    }
  }catch(e){
    console.error(e); $('ocrStatus').textContent='Erkennung fehlgeschlagen. Bitte manuell eintragen.';
  }
}
function handleCaptureFile(file){
  readFile(file, async (data)=>{ pendingImageData=data; setPreview('photoPreview',data); await recognize(data); });
}
function saveEntry(){
  const km=$('kmInput').value.replace(/[^0-9]/g,'');
  if(!km || km.length<4){ alert('Bitte Kilometerstand eintragen.'); return; }
  if(!state.currentPatient){ choosePatient(); if(!state.currentPatient) return; }
  state.entries.push({id:crypto.randomUUID?.()||String(Date.now()),kind:pendingKind,patient:state.currentPatient,km:Number(km),date:todayISO(),time:nowTime()});
  save(); show('homeView');
}
function escapeHtml(v){
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function excelDateName(){
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
function monthExcel(){
  const ym=excelDateName();
  const rows=sortedEntries().filter(e=>e.date.startsWith(ym));
  let html=`<!doctype html><html><head><meta charset="utf-8"><style>
    table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12pt}
    th{background:#e8ecff;font-weight:bold}
    th,td{border:1px solid #999;padding:6px 10px;vertical-align:top}
    .day td{background:#f4f4f4;font-weight:bold}
  </style></head><body>`;
  html+=`<h2>Monatsabrechnung ${escapeHtml(ym)}</h2>`;
  html+=`<table><thead><tr><th>Typ</th><th>Patient</th><th>Datum</th><th>Uhrzeit</th><th>KM</th></tr></thead><tbody>`;
  if(!rows.length){
    html+=`<tr><td colspan="5">Keine Einträge im aktuellen Monat vorhanden.</td></tr>`;
  } else {
    let lastDate='';
    rows.forEach(e=>{
      if(e.date!==lastDate){
        lastDate=e.date;
        html+=`<tr class="day"><td colspan="5">${escapeHtml(fmtDate(e.date))}</td></tr>`;
      }
      html+=`<tr><td>${escapeHtml(kindLabel(e.kind))}</td><td>${escapeHtml(e.patient||'')}</td><td>${escapeHtml(fmtDate(e.date))}</td><td>${escapeHtml(e.time)}</td><td>${escapeHtml(e.km)}</td></tr>`;
    });
  }
  html+=`</tbody></table></body></html>`;
  download('monatsabrechnung_'+ym+'.xls', html, 'application/vnd.ms-excel;charset=utf-8');
}
function download(name, content, type='text/plain;charset=utf-8'){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
function backup(){ download('fahrtenbuch-backup.json', JSON.stringify(state,null,2)); }
function clearData(){ if(confirm('Wirklich alle Patienten, Einträge und Kalibrierungen löschen?')){ localStorage.removeItem(storeKey); state=load(); save(); show('homeView'); } }

function loadCalibrationPhoto(file){
  readFile(file, data=>{ calibrationImageData=data; $('calPhotoPreview').innerHTML=`<img src="${data}" alt="Kalibrierung" /><div id="cropBox" class="crop-box"></div>`; attachCrop(); });
}
function attachCrop(){
  const box=$('cropBox'); if(!box) return;
  const host=$('calPhotoPreview');
  Object.assign(box.style,{left:(crop.x*100)+'%',top:(crop.y*100)+'%',width:(crop.w*100)+'%',height:(crop.h*100)+'%'});
  let start=null;
  box.onpointerdown=(ev)=>{ start={px:ev.clientX,py:ev.clientY,x:crop.x,y:crop.y}; box.setPointerCapture(ev.pointerId); };
  box.onpointermove=(ev)=>{ if(!start) return; const r=host.getBoundingClientRect(); crop.x=Math.min(.85,Math.max(0,start.x+(ev.clientX-start.px)/r.width)); crop.y=Math.min(.85,Math.max(0,start.y+(ev.clientY-start.py)/r.height)); box.style.left=(crop.x*100)+'%'; box.style.top=(crop.y*100)+'%'; };
  box.onpointerup=()=>{ start=null; };
}
function saveCalibration(){
  const vehicle=$('vehicleInput').value.trim() || 'Fahrzeug'; const km=$('calKmInput').value.replace(/[^0-9]/g,'');
  if(!calibrationImageData){ alert('Bitte ein Kalibrierungsfoto aufnehmen oder hochladen.'); return; }
  if(!km){ alert('Bitte Kilometerstand auf dem Foto eingeben.'); return; }
  state.calibration={vehicle,km:Number(km),crop}; save(); alert('Kalibrierung gespeichert.'); show('settingsView');
}

document.addEventListener('DOMContentLoaded',()=>{
  render(); if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  $('settingsBtn').onclick=()=>show('settingsView'); $('choosePatientBtn').onclick=choosePatient; $('patientCard').onclick=choosePatient;
  document.querySelectorAll('.backBtn').forEach(b=>b.onclick=()=>show('homeView'));
  document.querySelectorAll('.action').forEach(b=>b.onclick=()=>startCapture(b.dataset.kind));
  $('entriesBtn').onclick=()=>{render();show('entriesView')}; $('uploadBtn').onclick=()=>{startCapture('visit'); openFile('galleryInput');};
  $('takePhotoBtn').onclick=()=>openFile('cameraInput'); $('selectPhotoBtn').onclick=()=>openFile('galleryInput');
  $('cameraInput').onchange=e=>handleCaptureFile(e.target.files[0]); $('galleryInput').onchange=e=>handleCaptureFile(e.target.files[0]);
  $('saveEntryBtn').onclick=saveEntry;
  $('downloadMonthlyBtn').onclick=monthExcel; $('backupBtn').onclick=backup; $('clearDataBtn').onclick=clearData;
  $('calibrationBtn').onclick=()=>{ $('vehicleInput').value=state.calibration?.vehicle||''; $('calKmInput').value=state.calibration?.km||''; crop=state.calibration?.crop||crop; show('calibrationView'); attachCrop(); };
  $('calTakePhotoBtn').onclick=()=>openFile('calCameraInput'); $('calSelectPhotoBtn').onclick=()=>openFile('calGalleryInput');
  $('calCameraInput').onchange=e=>loadCalibrationPhoto(e.target.files[0]); $('calGalleryInput').onchange=e=>loadCalibrationPhoto(e.target.files[0]);
  $('saveCalibrationBtn').onclick=saveCalibration;
});
