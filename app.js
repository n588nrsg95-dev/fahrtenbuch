const storeKey='fb_v3';
const $=id=>document.getElementById(id);
let state=load();
let pendingType=null;
let pendingImage=null;
let calImage=null;
let calRect=null;
let drawing=false,startPt=null;

function load(){
  const s=JSON.parse(localStorage.getItem(storeKey)||'{}');
  return {patients:s.patients||[],vehicles:s.vehicles||[{name:'Standardfahrzeug',calibration:null}],entries:s.entries||[]};
}
function save(){localStorage.setItem(storeKey,JSON.stringify(state));render();}
function todayISO(){return new Date().toISOString().slice(0,10)}
function fmtDate(d){return new Date(d+'T00:00').toLocaleDateString('de-DE')}
function timeNow(){return new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}
function currentVehicle(){return state.vehicles[$('vehicleSelect').selectedIndex]||state.vehicles[0]}
function currentPatient(){return $('patientSelect').value||''}
function typeLabel(t){return t==='first'?'Erster Patient':t==='last'?'Letzter Patient':'Patient'}

function render(){
  $('vehicleSelect').innerHTML=state.vehicles.map(v=>`<option>${esc(v.name)}</option>`).join('');
  $('patientSelect').innerHTML=state.patients.length?state.patients.map(p=>`<option>${esc(p)}</option>`).join(''):'<option value="">Patient auswählen</option>';
  const v=currentVehicle();
  $('calibrationStatus').textContent=v?.calibration?'Kalibrierung vorhanden':'Noch nicht kalibriert - Erkennung nutzt Foto-Vorschlag';
  renderEntries();
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

$('addPatientBtn').onclick=()=>{const n=prompt('Name des neuen Patienten:'); if(n&&n.trim()){state.patients.push(n.trim()); save(); $('patientSelect').value=n.trim();}};
$('addVehicleBtn').onclick=()=>{const n=prompt('Name des Fahrzeugs:'); if(n&&n.trim()){state.vehicles.push({name:n.trim(),calibration:null}); save(); $('vehicleSelect').selectedIndex=state.vehicles.length-1; render();}};
$('vehicleSelect').onchange=render;
$('entriesBtn').onclick=()=>{$('entries').classList.toggle('hidden');renderEntries();};
$('clearBtn').onclick=()=>{if(confirm('Alle Einträge löschen? Patienten und Fahrzeuge bleiben erhalten.')){state.entries=[];save();}};
$('firstBtn').onclick=()=>startCapture('first');
$('normalBtn').onclick=()=>startCapture('normal');
$('lastBtn').onclick=()=>startCapture('last');
$('retryBtn').onclick=()=>{$('kmDialog').close(); startCapture(pendingType);};
$('saveKmBtn').onclick=saveKmEntry;
$('exportBtn').onclick=exportMonthly;
$('calibrateBtn').onclick=()=>{$('calDialog').showModal(); prepareCalCanvas();};
$('calPhotoBtn').onclick=()=>{pendingType='calibration'; $('photoInput').click();};
$('saveCalBtn').onclick=saveCalibration;

function startCapture(type){
  if(!currentPatient() && type!=='last' && type!=='first'){alert('Bitte zuerst Patient auswählen oder neu anlegen.');return;}
  if(!currentPatient() && (type==='first'||type==='last')){ if(!confirm('Ohne Patient speichern?')) return; }
  pendingType=type; $('photoInput').click();
}
$('photoInput').onchange=e=>{
  const file=e.target.files[0]; e.target.value=''; if(!file)return;
  const img=new Image(); img.onload=()=>{
    if(pendingType==='calibration'){calImage=img; drawCalImage(); return;}
    pendingImage=img; showKmDialog(img);
  };
  img.src=URL.createObjectURL(file);
};

function canvasFit(canvas,img,maxW=1000){
  const scale=Math.min(maxW/img.width,1);
  canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return scale;
}
async function showKmDialog(img){
  $('kmInput').value=''; $('ocrHint').textContent='Foto wird ausgewertet ...'; $('ocrHint').className='';
  $('dialogTitle').textContent=typeLabel(pendingType);
  $('kmDialog').showModal();
  const canvas=$('previewCanvas'); canvasFit(canvas,img);
  try{
    const cropped=makeOcrCanvas(img);
    const p=extractByImageHeuristic(cropped.canvas);
    if(p){$('kmInput').value=p; $('ocrHint').textContent='Vorschlag erkannt - bitte prüfen.'; $('ocrHint').className='ok'; return;}
    if(window.Tesseract){
      const result=await Tesseract.recognize(cropped.canvas,'eng',{logger:()=>{}});
      const val=pickKm(result.data.text);
      if(val){$('kmInput').value=val; $('ocrHint').textContent='Vorschlag erkannt - bitte prüfen.'; $('ocrHint').className='ok';}
      else {$('ocrHint').textContent='Nicht sicher erkannt, bitte Kilometerstand eintragen.'; $('ocrHint').className='warn';}
    } else {$('ocrHint').textContent='OCR nicht geladen, bitte Kilometerstand eintragen.'; $('ocrHint').className='warn';}
  }catch(err){$('ocrHint').textContent='Nicht sicher erkannt, bitte Kilometerstand eintragen.'; $('ocrHint').className='warn';}
}
function makeOcrCanvas(img){
  const v=currentVehicle(); const c=document.createElement('canvas'); const ctx=c.getContext('2d');
  let r=v?.calibration?.rect;
  if(!r){ r={x:0.33,y:0.50,w:0.34,h:0.18}; }
  const sx=Math.max(0,Math.round(r.x*img.width)), sy=Math.max(0,Math.round(r.y*img.height));
  const sw=Math.min(img.width-sx,Math.round(r.w*img.width)), sh=Math.min(img.height-sy,Math.round(r.h*img.height));
  c.width=900; c.height=Math.round(900*sh/sw);
  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  const data=ctx.getImageData(0,0,c.width,c.height); const d=data.data;
  for(let i=0;i<d.length;i+=4){const g=(d[i]+d[i+1]+d[i+2])/3; const v=g>120?255:0; d[i]=d[i+1]=d[i+2]=v;}
  ctx.putImageData(data,0,0);
  return {canvas:c};
}
function extractByImageHeuristic(canvas){return null;}
function pickKm(text){
  const cleaned=(text||'').replace(/[,.]/g,'').replace(/\s+/g,' ');
  const nums=[...cleaned.matchAll(/\b\d{5,7}\b/g)].map(m=>m[0]);
  if(!nums.length)return '';
  nums.sort((a,b)=>b.length-a.length || Number(b)-Number(a));
  return nums[0];
}
function saveKmEntry(){
  const km=Number($('kmInput').value); if(!km||km<1){alert('Bitte Kilometerstand eintragen.');return;}
  state.entries.push({id:Date.now(),date:todayISO(),time:timeNow(),type:pendingType,patient:currentPatient(),vehicle:currentVehicle()?.name||'',km});
  $('kmDialog').close(); save();
}
function renderEntries(){
  const list=$('entryList'); const items=[...state.entries].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  list.innerHTML=items.map(e=>`<div class="entry"><div><span class="pill">${typeLabel(e.type)}</span><b>${esc(e.patient||'-')}</b><small>${fmtDate(e.date)} ${e.time} · ${esc(e.vehicle)}</small></div><b>${e.km} km</b></div>`).join('')||'<p>Noch keine Einträge.</p>';
}
function exportMonthly(){
  if(!state.entries.length){alert('Keine Einträge vorhanden.');return;}
  const month=prompt('Monat exportieren im Format JJJJ-MM:', todayISO().slice(0,7)); if(!month)return;
  const entries=state.entries.filter(e=>e.date.startsWith(month)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const days={}; entries.forEach(e=>(days[e.date] ||= []).push(e));
  let lines=['Monatsabrechnung Fahrtenbuch','','Monat;'+month,'','Tagesuebersicht','Datum;Erster Patient KM;Letzter Patient KM;Verguetungsrelevante KM;Anzahl Besuche'];
  Object.keys(days).sort().forEach(d=>{
    const arr=days[d]; const first=arr.find(e=>e.type==='first')||arr[0]; const last=[...arr].reverse().find(e=>e.type==='last')||arr[arr.length-1];
    const km=Math.max(0,(last?.km||0)-(first?.km||0));
    lines.push([fmtDate(d),first?.km||'',last?.km||'',km,arr.length].join(';'));
  });
  lines.push('','','Einzelnachweise','Datum;Uhrzeit;Typ;Patient;Fahrzeug;Kilometerstand');
  entries.forEach(e=>lines.push([fmtDate(e.date),e.time,typeLabel(e.type),e.patient,e.vehicle,e.km].map(csv).join(';')));
  downloadText(`fahrtenbuch_${month}.csv`, lines.join('\n'));
}
function csv(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
function downloadText(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();}

function prepareCalCanvas(){ if(calImage) drawCalImage(); else {const c=$('calCanvas'); c.width=800; c.height=400; const ctx=c.getContext('2d'); ctx.fillStyle='#111'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='white'; ctx.font='24px sans-serif'; ctx.fillText('Bitte Foto wählen',40,80);} }
function drawCalImage(){
  const c=$('calCanvas'); canvasFit(c,calImage); if(calRect) drawRect(c,calRect);
}
function drawRect(c,r){const ctx=c.getContext('2d'); ctx.strokeStyle='#fff'; ctx.lineWidth=4; ctx.strokeRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height); ctx.strokeStyle='#4f46e5'; ctx.lineWidth=2; ctx.strokeRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height);}
function ptr(e,c){const rect=c.getBoundingClientRect(); const t=e.touches?e.touches[0]:e; return {x:(t.clientX-rect.left)/rect.width,y:(t.clientY-rect.top)/rect.height};}
['mousedown','touchstart'].forEach(ev=>$('calCanvas').addEventListener(ev,e=>{e.preventDefault(); drawing=true; startPt=ptr(e,$('calCanvas'));}));
['mousemove','touchmove'].forEach(ev=>$('calCanvas').addEventListener(ev,e=>{if(!drawing||!startPt)return; e.preventDefault(); const p=ptr(e,$('calCanvas')); calRect={x:Math.min(startPt.x,p.x),y:Math.min(startPt.y,p.y),w:Math.abs(p.x-startPt.x),h:Math.abs(p.y-startPt.y)}; drawCalImage();}));
['mouseup','mouseleave','touchend'].forEach(ev=>$('calCanvas').addEventListener(ev,()=>{drawing=false;}));
function saveCalibration(){
  if(!calImage){alert('Bitte zuerst ein Foto wählen.');return;}
  if(!calRect||calRect.w<0.05||calRect.h<0.03){alert('Bitte den Bereich des Kilometerstands markieren.');return;}
  const km=Number($('calKmInput').value); if(!km){alert('Bitte den Kilometerstand vom Kalibrierfoto eintragen.');return;}
  currentVehicle().calibration={rect:calRect,exampleKm:km,date:new Date().toISOString()};
  $('calDialog').close(); save(); alert('Kalibrierung gespeichert.');
}

if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
render();
