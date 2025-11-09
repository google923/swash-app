/* Admin Tracking Dashboard
   Firestore structure usage:
   - repLocations: { repId, timestamp, gpsLat, gpsLng } (live every ~5 mins)
   - repLogs: doc id pattern: repId_date -> { repId, date, territoryId, logs: [] }
   - repShifts: { repId_date, totals, miles, pay, ... }
   - territories: used for overlays
*/
import { auth, db } from "./firebase-init.js";
import { collection, doc, getDocs, getDoc, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
  map: null,
  markerCluster: null,
  repMarkers: new Map(),
  logMarkers: [],
  territories: [],
  filters: { rep: "", date: "", territory: "" },
  shifts: [],
};

// DOM refs
const repSel = document.getElementById("filterRep");
const dateStartInput = document.getElementById("filterDateStart");
const dateEndInput = document.getElementById("filterDateEnd");
const terrSel = document.getElementById("filterTerritory");
const applyBtn = document.getElementById("applyFilters");
const exportBtn = document.getElementById("exportCsv");
const shiftHistoryEl = document.getElementById("shiftHistory");
const aTotal = document.getElementById("aTotal");
const aX = document.getElementById("aX");
const aO = document.getElementById("aO");
const aSales = document.getElementById("aSales");
const aConv = document.getElementById("aConv");
const aMiles = document.getElementById("aMiles");
const aDph = document.getElementById("aDph");

// Replay controls
const replayRange = document.getElementById('replayRange');
const replayPlay = document.getElementById('replayPlay');
const replayPause = document.getElementById('replayPause');
const replayReset = document.getElementById('replayReset');

let replayLogs = [];
let replayIndex = 0;
let replayTimer = null;
let replayActive = false;

function setupReplay(logs) {
  replayLogs = logs.slice();
  replayIndex = 0;
  replayRange.value = 0;
  replayRange.min = 0;
  replayRange.max = logs.length ? (logs.length - 1) : 0;
  const has = logs.length > 0;
  replayPlay.disabled = !has;
  replayPause.disabled = true;
  replayReset.disabled = !has;
  if (has) {
    // Pre-create markers for replay layering (we'll show incrementally)
    state.markerCluster.clearLayers();
    logs.forEach((l, i) => {
      const color = l.status === 'X' ? 'red' : l.status === 'O' ? 'orange' : l.status === 'SignUp' ? 'green' : 'gold';
      const icon = L.divIcon({ html: `<div style='width:14px;height:14px;border-radius:50%;background:${color};opacity:0.25;border:2px solid ${l.note && l.status!== 'SignUp' ? "#333" : "#fff"}'></div>` });
      const m = L.marker([l.gpsLat, l.gpsLng], { icon });
      m._replayMeta = { index: i };
      m.bindPopup(`<strong>${l.status}</strong><br>${new Date(l.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}${l.note?`<br>${l.note}`:''}`);
      state.markerCluster.addLayer(m);
    });
    if (logs.length) {
      const group = L.featureGroup(state.markerCluster.getLayers());
      state.map.fitBounds(group.getBounds(), { padding:[30,30] });
    }
    highlightReplayProgress(0);
  }
}

function highlightReplayProgress(idx) {
  // Increase opacity for markers up to idx, dim the rest
  state.markerCluster.getLayers().forEach(marker => {
    const i = marker._replayMeta?.index ?? 0;
    const el = marker.getElement();
    if (!el) return;
    if (i <= idx) {
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
    } else {
      el.style.opacity = '0.25';
      el.style.transform = 'scale(0.8)';
    }
  });
}

function startReplay() {
  if (!replayLogs.length) return;
  stopReplay();
  replayActive = true;
  replayPlay.disabled = true;
  replayPause.disabled = false;
  replayReset.disabled = false;
  replayTimer = setInterval(() => {
    if (replayIndex >= replayLogs.length - 1) {
      stopReplay();
      return;
    }
    replayIndex++;
    replayRange.value = replayIndex;
    highlightReplayProgress(replayIndex);
    // Pan gradually towards next marker
    const log = replayLogs[replayIndex];
    state.map.panTo([log.gpsLat, log.gpsLng], { animate:true, duration:0.5 });
  }, 600); // ~0.6s per log
}

function stopReplay(pauseOnly=false) {
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
  replayActive = false;
  replayPlay.disabled = !replayLogs.length ? true : false;
  replayPause.disabled = true;
  if (!pauseOnly) {
    // finished
    replayIndex = replayLogs.length ? replayLogs.length - 1 : 0;
    replayRange.value = replayIndex;
    highlightReplayProgress(replayIndex);
  }
}

function pauseReplay() {
  if (!replayActive) return;
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
  replayActive = false;
  replayPlay.disabled = false;
  replayPause.disabled = true;
}

function resetReplay() {
  stopReplay();
  replayIndex = 0;
  replayRange.value = 0;
  highlightReplayProgress(0);
  replayPlay.disabled = !replayLogs.length;
  replayPause.disabled = true;
}

replayPlay.addEventListener('click', startReplay);
replayPause.addEventListener('click', pauseReplay);
replayReset.addEventListener('click', resetReplay);
replayRange.addEventListener('input', (e) => {
  const val = parseInt(e.target.value,10) || 0;
  replayIndex = val;
  highlightReplayProgress(replayIndex);
  if (replayLogs[replayIndex]) {
    const log = replayLogs[replayIndex];
    state.map.panTo([log.gpsLat, log.gpsLng], { animate:true, duration:0.3 });
  }
});

function initMap() {
  state.map = L.map("adminMap");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(state.map);
  state.markerCluster = L.markerClusterGroup();
  state.map.addLayer(state.markerCluster);
  // Start zoomed in closer; we'll auto-fit when we have markers
  state.map.setView([52.5,-1.9], 12);
}

async function loadTerritories() {
  try {
    // First try to load from 'territories' collection
    const snap = await getDocs(collection(db, "territories"));
    let loaded = false;
    snap.forEach(d => {
      const data = d.data();
      state.territories.push({ id: d.id, ...data });
      const opt = document.createElement("option");
      opt.value = d.id; opt.textContent = data.name || d.id;
      terrSel.appendChild(opt);
      if (Array.isArray(data.geoBoundary)) {
        const latlngs = data.geoBoundary.map(p => [p[0], p[1]]);
        L.polygon(latlngs, { color: '#0078d7', weight:1, fillOpacity:0.05 }).addTo(state.map);
      }
      loaded = true;
    });

    // Fallback: try system/territories document
    if (!loaded) {
      const sysDoc = await getDoc(doc(db, "system", "territories"));
      if (sysDoc.exists() && sysDoc.data().data) {
        const territories = sysDoc.data().data;
        territories.forEach(t => {
          state.territories.push(t);
          const opt = document.createElement("option");
          opt.value = t.id; opt.textContent = t.name || t.id;
          terrSel.appendChild(opt);
          if (t.type === 'polygon' && Array.isArray(t.path)) {
            const latlngs = t.path.map(p => [p.lat, p.lng]);
            L.polygon(latlngs, { color: t.color || '#0078d7', weight:1, fillOpacity:0.05 }).addTo(state.map);
          } else if (t.type === 'circle' && t.center) {
            L.circle([t.center.lat, t.center.lng], { radius: t.radius || 1000, color: t.color || '#0078d7', weight:1, fillOpacity:0.05 }).addTo(state.map);
          }
        });
      }
    }
  } catch (err) {
    console.error("Error loading territories:", err);
  }
}

function loadRepShiftHistory() {
  // Simplified: fetch all repShifts docs
  getDocs(collection(db, "repShifts")).then(snap => {
    state.shifts = [];
    shiftHistoryEl.innerHTML = '';
    snap.forEach(d => { state.shifts.push({ id: d.id, ...d.data() }); });
    state.shifts.sort((a,b) => (a.date > b.date ? -1 : 1));
    state.shifts.forEach(s => {
      const div = document.createElement('div');
      div.className = 'recent-item';
      div.innerHTML = `<div>${s.date}</div><div>${s.repId}<br>${s.totals?.doors||0} doors / ${s.miles?.toFixed(1)||0} mi</div>`;
      div.addEventListener('click', () => replayShift(s));
      shiftHistoryEl.appendChild(div);
    });
  });
}

function replayShift(shift) {
  // Clear existing log markers
  state.markerCluster.clearLayers();
  // fetch logs from per-log collection
  getDocs(query(collection(db, 'repLogs', shift.repId, 'dates', shift.date, 'doorLogs'))).then(snap => {
    const logs = [];
    snap.forEach(d => logs.push(d.data()));
    logs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
    placeDoorMarkers(logs);
  });
}

function placeDoorMarkers(logs) {
  logs.forEach(l => {
    const color = l.status === 'X' ? 'red' : l.status === 'O' ? 'orange' : l.status === 'SignUp' ? 'green' : 'gold';
    const icon = L.divIcon({ html: `<div style='width:14px;height:14px;border-radius:50%;background:${color};border:2px solid ${l.note && l.status!=='SignUp'?"#333":"#fff"}'></div>` });
    const m = L.marker([l.gpsLat, l.gpsLng], { icon });
    m.bindPopup(`<strong>${l.status}</strong><br>${new Date(l.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}${l.note?`<br>${l.note}`:''}`);
    state.markerCluster.addLayer(m);
  });
  if (logs.length) {
    const group = L.featureGroup(state.markerCluster.getLayers());
    state.map.fitBounds(group.getBounds(), { padding:[20,20] });
  }
}

// Assign each rep a unique color
const repColors = ['#0078d7', '#1c9c5d', '#c43131', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
function getRepColor(repId) {
  const hash = Array.from(repId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return repColors[hash % repColors.length];
}

async function getRepName(repId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', repId));
    return userDoc.exists() ? (userDoc.data().name || repId) : repId;
  } catch(_) { return repId; }
}

function subscribeRepLocations() {
  onSnapshot(collection(db, 'repLocations'), snap => {
    const updatedMarkers = [];
    snap.docChanges().forEach(async change => {
      const data = change.doc.data();
      const repId = data.repId;
      const existing = state.repMarkers.get(repId);
      const color = getRepColor(repId);
      const repName = await getRepName(repId);
      
      // Create pin with tooltip showing name above marker
      const icon = L.divIcon({ 
        className: 'rep-live-marker',
        html: `<div style='display:flex;flex-direction:column;align-items:center;'>
          <div style='background:#fff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.3);margin-bottom:4px;border:2px solid ${color};'>${repName} • <span style='color:#10b981;font-weight:600;'>Online</span></div>
          <div style='width:20px;height:20px;background:${color};color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);'>📍</div>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 30]
      });
      
      if (existing) {
        existing.setLatLng([data.gpsLat, data.gpsLng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([data.gpsLat, data.gpsLng], { icon }).addTo(state.map);
        marker.bindPopup(`<strong>${repName}</strong><br>ID: ${repId}<br>Last Update: ${new Date(data.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}<br><button onclick="window._adminTrackingState.filters.rep='${repId}';document.getElementById('filterRep').value='${repId}';document.getElementById('applyFilters').click();">View Logs</button>`);
        marker.on('click', () => marker.openPopup());
        state.repMarkers.set(repId, marker);
      }
      updatedMarkers.push(repId);
    });
    // If first markers appear, auto-fit to roughly ~1 mile padding
    if (state.repMarkers.size) {
      const group = L.featureGroup(Array.from(state.repMarkers.values()));
      const bounds = group.getBounds();
      // Add ~1 mile (~1609m) padding by expanding bounds
      try {
        const padLat = 0.0145; // approx 1.6km in degrees latitude
        const padLng = 0.025;  // approx 1.6km in degrees longitude at mid-UK
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const padded = L.latLngBounds(
          L.latLng(sw.lat - padLat, sw.lng - padLng),
          L.latLng(ne.lat + padLat, ne.lng + padLng)
        );
        state.map.fitBounds(padded, { animate:true, padding:[20,20], maxZoom: 15 });
      } catch(_) {}
    }
  });
}

function applyFilters() {
  state.filters.rep = repSel.value;
  state.filters.dateStart = dateStartInput.value;
  state.filters.dateEnd = dateEndInput.value;
  state.filters.territory = terrSel.value;
  
  // If single date range and rep selected, show logs for that date
  if (state.filters.rep && state.filters.dateStart && !state.filters.dateEnd) {
    // Single date mode
    refreshStats();
    state.markerCluster.clearLayers();
    getDocs(query(collection(db, 'repLogs', state.filters.rep, 'dates', state.filters.dateStart, 'doorLogs'))).then(snap => {
      const logs = [];
      snap.forEach(d => logs.push(d.data()));
      logs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
      placeDoorMarkers(logs);
      setupReplay(logs);
    });
  } else if (state.filters.rep && state.filters.dateStart && state.filters.dateEnd) {
    // Date range mode: load all shifts in range, combine logs
    refreshStatsRange();
    state.markerCluster.clearLayers();
    loadLogsInRange(state.filters.rep, state.filters.dateStart, state.filters.dateEnd);
  } else {
    alert('Select a rep and at least a start date');
  }
}

async function loadLogsInRange(repId, startDate, endDate) {
  const allLogs = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().substring(0,10));
  }
  for (const dateStr of dates) {
    try {
      const snap = await getDocs(query(collection(db, 'repLogs', repId, 'dates', dateStr, 'doorLogs')));
      snap.forEach(d => allLogs.push(d.data()));
    } catch(_) {}
  }
  allLogs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
  placeDoorMarkers(allLogs);
  setupReplay(allLogs);
}

function refreshStatsRange() {
  // Aggregate stats across date range
  if (!state.filters.rep || !state.filters.dateStart || !state.filters.dateEnd) return;
  const start = new Date(state.filters.dateStart);
  const end = new Date(state.filters.dateEnd);
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().substring(0,10));
  }
  Promise.all(dates.map(dateStr => 
    getDoc(doc(db, 'repShifts', `${state.filters.rep}_${dateStr}`))
  )).then(docs => {
    let totalDoors = 0, totalX = 0, totalO = 0, totalSales = 0, totalMiles = 0, totalActiveMin = 0;
    docs.forEach(ds => {
      const d = ds.data();
      if (d) {
        totalDoors += d.totals?.doors || 0;
        totalX += d.totals?.x || 0;
        totalO += d.totals?.o || 0;
        totalSales += d.totals?.sales || 0;
        totalMiles += d.miles || 0;
        totalActiveMin += d.activeMinutes || 0;
      }
    });
    const conv = totalDoors ? ((totalSales/totalDoors)*100).toFixed(1) : 0;
    aTotal.textContent = totalDoors;
    aX.textContent = totalX;
    aO.textContent = totalO;
    aSales.textContent = totalSales;
    aConv.textContent = conv + '%';
    aMiles.textContent = totalMiles.toFixed(2);
    const dph = totalActiveMin ? (totalDoors / (totalActiveMin/60)) : 0;
    if (aDph) aDph.textContent = dph.toFixed(1);
  });
}

function refreshStats() {
  if (state.filters.rep && state.filters.dateStart) {
    getDoc(doc(db, 'repShifts', `${state.filters.rep}_${state.filters.dateStart}`)).then(ds => {
      const d = ds.data();
      if (!d) { aTotal.textContent = aX.textContent = aO.textContent = aSales.textContent = '0'; aConv.textContent='0%'; aMiles.textContent='0.0'; if (aDph) aDph.textContent='0.0'; return; }
      const total = d.totals?.doors || 0;
      const xCount = d.totals?.x || 0;
      const oCount = d.totals?.o || 0;
      const sales = d.totals?.sales || 0;
      const conv = total ? ((sales/total)*100).toFixed(1) : 0;
      aTotal.textContent = total;
      aX.textContent = xCount;
      aO.textContent = oCount;
      aSales.textContent = sales;
      aConv.textContent = conv + '%';
      aMiles.textContent = (d.miles || 0).toFixed(2);
      const activeMinutes = d.activeMinutes || 0;
      const dph = activeMinutes ? (total / (activeMinutes/60)) : 0;
      if (aDph) aDph.textContent = dph.toFixed(1);
    });
  }
}

function populateRepFilter() {
  // Load all users with role="rep" from users collection
  getDocs(query(collection(db, 'users'), where('role', '==', 'rep'))).then(snap => {
    repSel.innerHTML = '<option value="">(All)</option>';
    snap.forEach(d => {
      const data = d.data();
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = data.name || d.id;
      repSel.appendChild(opt);
    });
  }).catch(err => {
    console.warn('Failed to load rep users', err);
    repSel.innerHTML = '<option value="">(All)</option>';
  });
}

applyBtn.addEventListener('click', applyFilters);
exportBtn.addEventListener('click', () => exportCsv());

function exportCsv() {
  if (!state.filters.rep || !state.filters.dateStart) { alert('Select rep and start date'); return; }
  getDocs(query(collection(db, 'repLogs', state.filters.rep, 'dates', state.filters.dateStart, 'doorLogs'))).then(snap => {
    const logs = [];
    snap.forEach(d => logs.push(d.data()));
    if (!logs.length) { alert('No logs'); return; }
    logs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
    const rows = ['timestamp,status,gpsLat,gpsLng,note'];
    logs.forEach(l => rows.push(`${l.timestamp},${l.status},${l.gpsLat},${l.gpsLng},${(l.note||'').replace(/,/g,';')}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${state.filters.rep}_${state.filters.dateStart}_logs.csv`; a.click();
    URL.revokeObjectURL(url);
  });
}

// Init
initMap();
loadTerritories();
subscribeRepLocations();
populateRepFilter();
loadRepShiftHistory();

window._adminTrackingState = state;
