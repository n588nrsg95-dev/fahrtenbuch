const $ = (id) => document.getElementById(id);
const storeKey = 'fahrtenbuch.v4';
let state = load();
let pendingKind = 'visit';
let pendingImageData = null;
let calibrationImageData = null;
let crop = state.calibration?.crop || {x:.25,y:.55,w:.50,h:.18};

function load(){
  const defaults = {patients:[],entries:[],currentPatient:'',calibration:null,rate:0.30};
  try {
    const data = JSON.parse(localStorage.getItem(storeKey)) || defaults;
    return {...defaults, ...data, rate: Number(data.rate ?? 0.30) || 0.30};
  }
  catch { return defaults; }
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
  if($('rateInput')) $('rateInput').value = formatRate(state.rate ?? 0.30);
  const count = state.entries.filter(e=>e.date===todayISO()).length;
  $('todayText').textContent = `Heute, ${fmtDate(todayISO())}`;
  $('todayCount').textContent = `${count} Einträge`;
  renderPatientView();
  renderEntriesView();
}
function renderPatientView(){
  const sel=$('patientSelect'); const list=$('patientList');
  if(!sel || !list) return;
  const patients=[...new Set(state.patients)].sort((a,b)=>a.localeCompare(b,'de')); // gespeicherte Anschriften
  sel.innerHTML='<option value="">Bitte auswählen</option>'+patients.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  sel.value = patients.includes(state.currentPatient) ? state.currentPatient : '';
  list.innerHTML = patients.length ? '<div class="small-title">Schnellauswahl</div>' : '<div class="hint light">Noch keine Patienten gespeichert.</div>';
  patients.forEach(p=>{
    const b=document.createElement('button');
    b.type='button'; b.className='patient-chip'+(p===state.currentPatient?' active':'');
    b.textContent=p;
    b.onclick=()=>{ state.currentPatient=p; save(); show('homeView'); };
    list.appendChild(b);
  });
}
function openPatientView(){ renderPatientView(); show('patientView'); setTimeout(()=>$('newPatientInput')?.focus(),50); }
function addPatient(){
  const inp=$('newPatientInput');
  const name=(inp?.value||'').trim();
  if(!name){ alert('Bitte Anschrift eintragen.'); return; }
  if(!state.patients.includes(name)) state.patients.push(name);
  state.currentPatient=name;
  if(inp) inp.value='';
  save();
  show('homeView');
}
function selectPatient(){
  const name=$('patientSelect')?.value || '';
  if(!name){ alert('Bitte eine Anschrift auswählen oder neu anlegen.'); return; }
  state.currentPatient=name; save(); show('homeView');
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
function choosePatient(){ openPatientView(); }
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
  if(!state.currentPatient){ alert('Bitte zuerst eine Anschrift auswählen oder neu anlegen.'); openPatientView(); return; }
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
function formatRate(v){
  const n = Number(v ?? 0.30);
  return String(n.toFixed(2)).replace('.', ',');
}
function parseRate(v){
  const n = Number(String(v||'').replace(',', '.').replace(/[^0-9.]/g,''));
  return Number.isFinite(n) && n > 0 ? n : 0.30;
}
function updateRate(){
  state.rate = parseRate($('rateInput')?.value || '0,30');
  localStorage.setItem(storeKey, JSON.stringify(state));
}
function euro(v){ return Number(v||0).toFixed(2).replace('.', ','); }
function dayDistanceRows(rows){
  let lastDate='', prevKm=null;
  return rows.map(e=>{
    if(e.date !== lastDate){ lastDate=e.date; prevKm=null; }
    let dist = null;
    if(prevKm !== null){ const d = Number(e.km) - Number(prevKm); dist = d >= 0 ? d : null; }
    prevKm = Number(e.km);
    return {...e, distance: dist, reimbursement: dist === null ? null : dist * (Number(state.rate)||0.30)};
  });
}
function monthExcel(){
  updateRate();
  const ym=excelDateName();
  const rows=dayDistanceRows(sortedEntries().filter(e=>e.date.startsWith(ym)));
  const rate = Number(state.rate)||0.30;
  const totalKm = rows.reduce((sum,e)=>sum+(e.distance||0),0);
  const totalEuro = totalKm * rate;
  const vehicle = state.calibration?.vehicle || '';
  let html=`<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif}
    table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}
    h1{font-size:18pt;margin:0 0 18px}
    th,td{border:1px solid #777;padding:5px 8px;vertical-align:top;mso-number-format:"\\@"}
    .head{background:#dbe5f1;font-weight:bold;text-align:center}
    .sub{background:#eef3f8;font-weight:bold;text-align:center}
    .day td{background:#f3f4f6;font-weight:bold}
    .num{text-align:right;mso-number-format:"0"}.money{text-align:right;mso-number-format:"0.00"}
    .blank{border:0}.sum{font-weight:bold;background:#eaf7ea}
  </style></head><body>`;
  html+=`<h1>Fahrtenbuch / Monatsabrechnung ${escapeHtml(ym)}</h1>`;
  html+=`<table>`;
  html+=`<tr><td class="blank" colspan="10"></td></tr>`;
  html+=`<tr><td class="head">Fahrer</td><td colspan="2"></td><td class="head">Kilometergeld (€/km)</td><td></td><td></td><td class="head">Summe km</td><td></td><td class="head">Summe Euro</td><td class="head">Fahrzeug</td></tr>`;
  html+=`<tr><td>Inga Szelagowski</td><td colspan="2"></td><td class="money">${escapeHtml(euro(rate))}</td><td></td><td></td><td class="num sum">${escapeHtml(totalKm)}</td><td></td><td class="money sum">${escapeHtml(euro(totalEuro))}</td><td>${escapeHtml(vehicle)}</td></tr>`;
  html+=`<tr><td class="blank" colspan="10"></td></tr>`;
  html+=`<tr class="head"><th>Datum</th><th>Private Nutzung</th><th>Route</th><th>Anschrift</th><th colspan="2">Abgelesener Kilometerstand</th><th>Distanz</th><th></th><th>Reisekostenersatz</th><th>Notizen</th></tr>`;
  html+=`<tr class="sub"><th>Tag</th><th></th><th>Von - Bis</th><th>Einrichtung / Klient</th><th>Start</th><th>Ende</th><th>km</th><th></th><th>Euro</th><th>z. B. Fahrer, Tankung</th></tr>`;
  if(!rows.length){
    html+=`<tr><td colspan="10">Keine Einträge im aktuellen Monat vorhanden.</td></tr>`;
  } else {
    let lastDate='';
    rows.forEach(e=>{
      const showDate = e.date !== lastDate;
      if(showDate) lastDate = e.date;
      html+=`<tr>`+
        `<td>${showDate ? escapeHtml(fmtDate(e.date)) : ''}</td>`+
        `<td></td>`+
        `<td>${escapeHtml(kindLabel(e.kind))}</td>`+
        `<td>${escapeHtml(e.patient||'')}</td>`+
        `<td class="num">${escapeHtml(e.km)}</td>`+
        `<td></td>`+
        `<td class="num">${e.distance === null ? '' : escapeHtml(e.distance)}</td>`+
        `<td></td>`+
        `<td class="money">${e.reimbursement === null ? '' : escapeHtml(euro(e.reimbursement))}</td>`+
        `<td>${escapeHtml(e.time)}</td>`+
      `</tr>`;
    });
  }
  html+=`</table></body></html>`;
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
  $('settingsBtn').onclick=()=>show('settingsView');
  if($('rateInput')) { $('rateInput').onchange=()=>{ updateRate(); render(); }; $('rateInput').onblur=()=>{ updateRate(); render(); }; } $('choosePatientBtn').onclick=openPatientView; $('patientCard').onclick=openPatientView;
  $('selectPatientBtn').onclick=selectPatient; $('addPatientBtn').onclick=addPatient; $('patientSelect').onchange=selectPatient;
  $('newPatientInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addPatient(); });
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
