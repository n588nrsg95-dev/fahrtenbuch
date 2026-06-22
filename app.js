const patientSelect = document.getElementById('patientSelect');
const addPatientBtn = document.getElementById('addPatientBtn');
const arrivalBtn = document.getElementById('arrivalBtn');
const cameraInput = document.getElementById('cameraInput');
const statusEl = document.getElementById('status');
const confirmBox = document.getElementById('confirmBox');
const preview = document.getElementById('preview');
const kmInput = document.getElementById('kmInput');
const saveEntryBtn = document.getElementById('saveEntryBtn');
const cancelBtn = document.getElementById('cancelBtn');
const entryList = document.getElementById('entryList');
const exportBtn = document.getElementById('exportBtn');
const patientDialog = document.getElementById('patientDialog');
const newPatientInput = document.getElementById('newPatientInput');
const savePatientBtn = document.getElementById('savePatientBtn');
const closeDialogBtn = document.getElementById('closeDialogBtn');

let pendingPhoto = null;
const store = {
  patients: JSON.parse(localStorage.getItem('patients') || '[]'),
  entries: JSON.parse(localStorage.getItem('entries') || '[]')
};

function persist() {
  localStorage.setItem('patients', JSON.stringify(store.patients));
  localStorage.setItem('entries', JSON.stringify(store.entries));
}

function renderPatients() {
  patientSelect.innerHTML = '';
  if (!store.patients.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Bitte Patient anlegen';
    patientSelect.appendChild(opt);
    return;
  }
  store.patients.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    patientSelect.appendChild(opt);
  });
}

function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function renderEntries() {
  const today = todayKey();
  const entries = store.entries.filter(e => e.date === today).reverse();
  entryList.innerHTML = entries.length ? '' : '<p>Noch keine Einträge heute.</p>';
  entries.forEach(e => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<strong>${escapeHtml(e.patient)}</strong>${formatDateTime(e.createdAt)}<br>Kilometerstand: ${escapeHtml(e.km)}`;
    entryList.appendChild(div);
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function openPatientDialog() {
  newPatientInput.value = '';
  if (typeof patientDialog.showModal === 'function') patientDialog.showModal();
  else {
    const name = prompt('Neuer Patient:');
    addPatient(name);
    return;
  }
  setTimeout(() => newPatientInput.focus(), 100);
}

function addPatient(rawName) {
  const name = (rawName || '').trim();
  if (!name) return;
  if (!store.patients.includes(name)) store.patients.push(name);
  store.patients.sort((a,b) => a.localeCompare(b, 'de'));
  persist();
  renderPatients();
  patientSelect.value = name;
}

addPatientBtn.addEventListener('click', openPatientDialog);
savePatientBtn.addEventListener('click', () => { addPatient(newPatientInput.value); patientDialog.close(); });
closeDialogBtn.addEventListener('click', () => patientDialog.close());
newPatientInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPatient(newPatientInput.value); patientDialog.close(); } });

arrivalBtn.addEventListener('click', () => {
  if (!patientSelect.value) { openPatientDialog(); return; }
  cameraInput.value = '';
  cameraInput.click();
});

cameraInput.addEventListener('change', async () => {
  const file = cameraInput.files && cameraInput.files[0];
  if (!file) return;
  pendingPhoto = file;
  preview.src = URL.createObjectURL(file);
  confirmBox.classList.remove('hidden');
  kmInput.value = '';
  statusEl.textContent = 'Foto wird gelesen...';
  try {
    if (window.Tesseract) {
      const result = await Tesseract.recognize(file, 'eng');
      const text = result?.data?.text || '';
      const km = extractKm(text);
      if (km) {
        kmInput.value = km;
        statusEl.textContent = 'Kilometerstand erkannt. Bitte prüfen und speichern.';
      } else {
        statusEl.textContent = 'Nicht sicher erkannt. Bitte Kilometerstand eintragen.';
      }
    } else {
      statusEl.textContent = 'OCR nicht geladen. Bitte Kilometerstand eintragen.';
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'OCR nicht möglich. Bitte Kilometerstand eintragen.';
  }
  kmInput.focus();
});

function extractKm(text) {
  const cleaned = String(text).replace(/\s/g, '');
  const matches = cleaned.match(/\d{4,7}/g);
  if (!matches || !matches.length) return '';
  return matches.sort((a,b) => b.length - a.length)[0];
}

saveEntryBtn.addEventListener('click', () => {
  const km = kmInput.value.replace(/\D/g, '');
  if (!patientSelect.value) { alert('Bitte Patient auswählen.'); return; }
  if (!km) { alert('Bitte Kilometerstand eintragen.'); kmInput.focus(); return; }
  const now = new Date();
  store.entries.push({ patient: patientSelect.value, km, date: todayKey(now), createdAt: now.toISOString() });
  persist();
  confirmBox.classList.add('hidden');
  pendingPhoto = null;
  statusEl.textContent = 'Eintrag gespeichert.';
  renderEntries();
});

cancelBtn.addEventListener('click', () => {
  confirmBox.classList.add('hidden');
  pendingPhoto = null;
  statusEl.textContent = 'Abgebrochen.';
});

exportBtn.addEventListener('click', () => {
  const rows = [['Datum','Uhrzeit','Patient','Kilometerstand']];
  store.entries.forEach(e => {
    const d = new Date(e.createdAt);
    rows.push([d.toLocaleDateString('de-DE'), d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'}), e.patient, e.km]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fahrtenbuch.csv';
  a.click();
  URL.revokeObjectURL(url);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}

renderPatients();
renderEntries();
