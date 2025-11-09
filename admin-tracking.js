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
// Shift summary modal elements
const shiftSummaryModal = document.getElementById('shiftSummaryModal');
const shiftSummaryBody = document.getElementById('shiftSummaryBody');
const shiftSummaryClose = document.getElementById('shiftSummaryClose');
const shiftSummaryReplay = document.getElementById('shiftSummaryReplay');

shiftSummaryClose?.addEventListener('click', () => shiftSummaryModal?.close());
shiftSummaryReplay?.addEventListener('click', () => {
  const repId = shiftSummaryReplay.getAttribute('data-rep-id');
  const date = shiftSummaryReplay.getAttribute('data-date');
  if (!repId || !date) return;
  getDocs(query(collection(db, 'repLogs', repId, 'dates', date, 'doorLogs'))).then(snap => {
    const logs = []; snap.forEach(d => logs.push(d.data()));
    logs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
    placeDoorMarkers(logs);
    setupReplay(logs);
    shiftSummaryModal.close();
  });
});

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
    // Insert an (All Territories) option if not present
    if (!terrSel.querySelector('option[value="__ALL__"]')) {
      const allOpt = document.createElement('option');
      allOpt.value = '__ALL__';
      allOpt.textContent = '(All Territories)';
      terrSel.appendChild(allOpt);
    }
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
  // Order by date descending if index exists; fallback to unordered
  getDocs(query(collection(db, "repShifts"), orderBy('date', 'desc'))).then(snap => {
    state.shifts = [];
    shiftHistoryEl.innerHTML = '';
    snap.forEach(d => { state.shifts.push({ id: d.id, ...d.data() }); });
    // Already ordered via query; if orderBy fails (rules/index), we would need manual sort.
    renderShiftHistory();
    // If current filter is All reps with a date range, auto-refresh stats now that shifts are loaded
    if (!repSel.value && dateStartInput.value && dateEndInput.value) {
      refreshStatsRangeAll();
    }
  });
}

function renderShiftHistory() {
  shiftHistoryEl.innerHTML = '';
  const repFilter = state.filters.rep || '';
  const terrFilter = state.filters.territory || '';
  state.shifts.forEach(s => {
    if (repFilter && s.repId !== repFilter) return;
    if (terrFilter && terrFilter !== '__ALL__' && terrFilter !== '' && s.territoryId && s.territoryId !== terrFilter) return;
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `<div>${s.date}</div><div>${s.repId}<br>${s.totals?.doors||0} doors / ${s.miles?.toFixed(1)||0} mi</div>`;
    div.addEventListener('click', () => openShiftSummary(s));
    shiftHistoryEl.appendChild(div);
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

function openShiftSummary(shift) {
  getDocs(query(collection(db, 'repLogs', shift.repId, 'dates', shift.date, 'doorLogs'))).then(snap => {
    const logs = []; snap.forEach(d => logs.push(d.data()));
    logs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
    const totalDoors = shift.totals?.doors || logs.length;
    const x = shift.totals?.x ?? logs.filter(l=>l.status==='X').length;
    const o = shift.totals?.o ?? logs.filter(l=>l.status==='O').length;
    const sales = shift.totals?.sales ?? logs.filter(l=>l.status==='SignUp').length;
    const conv = totalDoors ? ((sales/totalDoors)*100).toFixed(1) : '0.0';
    const miles = shift.miles || 0;
    const startMs = shift.startTime ? new Date(shift.startTime).getTime() : (logs[0]? new Date(logs[0].timestamp).getTime() : 0);
    const endMs = shift.endTime ? new Date(shift.endTime).getTime() : (logs[logs.length-1]? new Date(logs[logs.length-1].timestamp).getTime() : startMs);
    const totalSpanMs = Math.max(0, endMs - startMs);
    const activeMinutes = shift.activeMinutes ?? 0;
    const activeMs = activeMinutes * 60000;
  const manualPausedMs = (shift.pauses||[]).reduce((acc,p)=>{ if(!p || p.reason !== 'manual' || !p.start) return acc; const ps=new Date(p.start).getTime(); const pe=p.end?new Date(p.end).getTime():endMs; if(!isNaN(ps)&&!isNaN(pe)) acc+=Math.max(0,pe-ps); return acc; },0);
  // Since activeMinutes already excludes inactivity, compute inactivity as remainder of total span
  const inactivityDedMs = Math.max(0, totalSpanMs - manualPausedMs - activeMs);
    const payRate = 12.21, expenseRate = 0.45;
    const pay = (shift.pay != null) ? shift.pay : parseFloat(((activeMinutes/60)*payRate).toFixed(2));
    const mileageExpense = (shift.mileageExpense != null) ? shift.mileageExpense : parseFloat((miles*expenseRate).toFixed(2));
    const totalOwed = (shift.totalOwed != null) ? shift.totalOwed : parseFloat((pay + mileageExpense).toFixed(2));
    const dph = activeMinutes ? (totalDoors / (activeMinutes/60)) : 0;
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
    const toMin = ms => Math.round(ms/60000);
    shiftSummaryBody.innerHTML = `
      <table class="summary-table">
        <tr><td>Date</td><td>${shift.date}</td></tr>
        <tr><td>Rep</td><td>${shift.repId}</td></tr>
        <tr><td>Doors</td><td>${totalDoors}</td></tr>
        <tr><td>X</td><td>${x}</td></tr>
        <tr><td>O</td><td>${o}</td></tr>
        <tr><td>Sales</td><td>${sales}</td></tr>
        <tr><td>Conversion</td><td>${conv}%</td></tr>
        <tr><td>Start</td><td>${fmtTime(shift.startTime)}</td></tr>
        <tr><td>Finish</td><td>${fmtTime(shift.endTime)}</td></tr>
        <tr><td>Total span (min)</td><td>${toMin(totalSpanMs)}</td></tr>
        <tr><td>Manual pauses (min)</td><td>${toMin(manualPausedMs)}</td></tr>
        <tr><td>Inactivity deducted (min)</td><td>${toMin(inactivityDedMs)}</td></tr>
        <tr><td>Paid minutes</td><td>${activeMinutes}</td></tr>
        <tr><td>Miles</td><td>${miles.toFixed(2)}</td></tr>
        <tr><td>Pay (£${payRate}/hr)</td><td>£${pay.toFixed(2)}</td></tr>
        <tr><td>Mileage (45p/mi)</td><td>£${mileageExpense.toFixed(2)}</td></tr>
        <tr><td><strong>Total owed</strong></td><td><strong>£${totalOwed.toFixed(2)}</strong></td></tr>
        <tr><td>Doors / active hour</td><td>${dph.toFixed(1)}</td></tr>
      </table>
      <h4 style='margin-top:12px;'>Pauses</h4>
      <ul class='pause-list'>${(shift.pauses||[]).map(p=>`<li>${fmtTime(p.start)} - ${p.end?fmtTime(p.end):'ongoing'} (${p.reason||'inactive'})</li>`).join('') || '<li>None</li>'}</ul>
    `;
    shiftSummaryReplay.setAttribute('data-rep-id', shift.repId);
    shiftSummaryReplay.setAttribute('data-date', shift.date);
    shiftSummaryModal.showModal();
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
  } else if (!state.filters.rep && state.filters.dateStart && state.filters.dateEnd) {
    // Aggregate across ALL reps for the range – update stats only and leave map empty
    refreshStatsRangeAll();
    state.markerCluster.clearLayers();
  } else {
    alert('Select a rep and at least a start date');
  }
  renderShiftHistory();
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

function refreshStatsRangeAll() {
  // Aggregate stats across ALL reps for a date range
  const startStr = state.filters.dateStart;
  const endStr = state.filters.dateEnd;
  if (!startStr || !endStr) return;
  const terrFilter = state.filters.territory;
  const qAll = query(
    collection(db, 'repShifts'),
    where('date', '>=', startStr),
    where('date', '<=', endStr)
  );
  getDocs(qAll).then(snap => {
    let totalDoors = 0, totalX = 0, totalO = 0, totalSales = 0, totalMiles = 0, totalActiveMin = 0;
    snap.forEach(ds => {
      const d = ds.data();
      if (!d) return;
      if (terrFilter && terrFilter !== '' && terrFilter !== '__ALL__' && d.territoryId && d.territoryId !== terrFilter) return;
      totalDoors += d.totals?.doors || 0;
      totalX += d.totals?.x || 0;
      totalO += d.totals?.o || 0;
      totalSales += d.totals?.sales || 0;
      totalMiles += d.miles || 0;
      totalActiveMin += d.activeMinutes || 0;
    });
    // Fallback: if Firestore returned nothing, use already loaded state.shifts cache
    if (totalDoors === 0 && state.shifts.length) {
      state.shifts.forEach(s => {
        if (!s.date || s.date < startStr || s.date > endStr) return;
        if (terrFilter && terrFilter !== '' && terrFilter !== '__ALL__' && s.territoryId && s.territoryId !== terrFilter) return;
        totalDoors += s.totals?.doors || 0;
        totalX += s.totals?.x || 0;
        totalO += s.totals?.o || 0;
        totalSales += s.totals?.sales || 0;
        totalMiles += s.miles || 0;
        totalActiveMin += s.activeMinutes || 0;
      });
    }
    const conv = totalDoors ? ((totalSales/totalDoors)*100).toFixed(1) : 0;
    aTotal.textContent = totalDoors;
    aX.textContent = totalX;
    aO.textContent = totalO;
    aSales.textContent = totalSales;
    aConv.textContent = conv + '%';
    aMiles.textContent = totalMiles.toFixed(2);
    const dph = totalActiveMin ? (totalDoors / (totalActiveMin/60)) : 0;
    if (aDph) aDph.textContent = dph.toFixed(1);
  }).catch(err => {
    console.warn('Failed to aggregate stats for all reps', err);
    // Fallback aggregation if query fails
    let totalDoors = 0, totalX = 0, totalO = 0, totalSales = 0, totalMiles = 0, totalActiveMin = 0;
    state.shifts.forEach(s => {
      if (!s.date || s.date < startStr || s.date > endStr) return;
      if (terrFilter && terrFilter !== '' && terrFilter !== '__ALL__' && s.territoryId && s.territoryId !== terrFilter) return;
      totalDoors += s.totals?.doors || 0;
      totalX += s.totals?.x || 0;
      totalO += s.totals?.o || 0;
      totalSales += s.totals?.sales || 0;
      totalMiles += s.miles || 0;
      totalActiveMin += s.activeMinutes || 0;
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

// Auto-update Stats when filters change and Rep=(All)
;[repSel, dateStartInput, dateEndInput, terrSel].forEach(el => {
  el?.addEventListener('change', () => {
    if (!repSel.value && dateStartInput.value && dateEndInput.value) {
      refreshStatsRangeAll();
    }
  });
});

function exportCsv() {
  if (!state.filters.rep || !state.filters.dateStart) { alert('Select rep and start date'); return; }
  if (state.filters.dateEnd) {
    // Range export: per-shift summary rows
    const start = new Date(state.filters.dateStart);
    const end = new Date(state.filters.dateEnd);
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().substring(0,10));
    }
    Promise.all(dates.map(dateStr => getDoc(doc(db, 'repShifts', `${state.filters.rep}_${dateStr}`)))).then(shiftsDocs => {
      const header = 'date,repId,doors,x,o,sales,conversionPercent,miles,activeMinutes,manualPausedMinutes,inactivityDeductedMinutes,pay,mileageExpense,totalOwed,startTime,endTime';
      const rows = [header];
      shiftsDocs.forEach(ds => {
        const s = ds.data(); if (!s) return;
        const doors = s.totals?.doors || 0;
        const x = s.totals?.x || 0;
        const o = s.totals?.o || 0;
        const sales = s.totals?.sales || 0;
        const conv = doors ? ((sales/doors)*100).toFixed(1) : '0.0';
        const miles = s.miles || 0;
        const activeMinutes = s.activeMinutes || 0;
        const startMs = s.startTime ? new Date(s.startTime).getTime() : 0;
        const endMs = s.endTime ? new Date(s.endTime).getTime() : startMs;
    const totalSpanMs = Math.max(0, endMs - startMs);
    const manualPausedMs = (s.pauses||[]).reduce((acc,p)=>{ if(!p || p.reason !== 'manual' || !p.start) return acc; const ps=new Date(p.start).getTime(); const pe=p.end?new Date(p.end).getTime():endMs; if(!isNaN(ps)&&!isNaN(pe)) acc+=Math.max(0,pe-ps); return acc; },0);
    const inactivityDedMs = Math.max(0, totalSpanMs - manualPausedMs - (activeMinutes*60000));
        const pay = s.pay != null ? s.pay : parseFloat(((activeMinutes/60)*12.21).toFixed(2));
        const mileageExpense = s.mileageExpense != null ? s.mileageExpense : parseFloat((miles*0.45).toFixed(2));
        const totalOwed = s.totalOwed != null ? s.totalOwed : parseFloat((pay + mileageExpense).toFixed(2));
  rows.push(`${s.date},${s.repId},${doors},${x},${o},${sales},${conv},${miles.toFixed(2)},${activeMinutes},${Math.round(manualPausedMs/60000)},${Math.round(inactivityDedMs/60000)},${pay.toFixed(2)},${mileageExpense.toFixed(2)},${totalOwed.toFixed(2)},${s.startTime||''},${s.endTime||''}`);
      });
      if (rows.length === 1) { alert('No shifts found in range'); return; }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${state.filters.rep}_${state.filters.dateStart}_${state.filters.dateEnd}_shift-summary.csv`; a.click();
      URL.revokeObjectURL(url);
    });
  } else {
    // Single-day per-log export
    getDocs(query(collection(db, 'repLogs', state.filters.rep, 'dates', state.filters.dateStart, 'doorLogs'))).then(snap => {
      const logs = []; snap.forEach(d => logs.push(d.data()));
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
}

// Init
initMap();
loadTerritories();
subscribeRepLocations();
populateRepFilter();
loadRepShiftHistory();

window._adminTrackingState = state;

// Auto-fill pay period dates (20th cycle) if empty
(function autofillPayPeriod(){
  if (dateStartInput.value || dateEndInput.value) return;
  const today = new Date();
  let periodStart, periodEnd;
  if (today.getDate() >= 20) {
    periodStart = new Date(today.getFullYear(), today.getMonth(), 20);
    periodEnd = new Date(today.getFullYear(), today.getMonth()+1, 19);
  } else {
    periodStart = new Date(today.getFullYear(), today.getMonth()-1, 20);
    periodEnd = new Date(today.getFullYear(), today.getMonth(), 19);
  }
  dateStartInput.value = periodStart.toISOString().substring(0,10);
  dateEndInput.value = periodEnd.toISOString().substring(0,10);
  // If Rep=(All) is currently selected (default) trigger an initial aggregation
  // so the Stats section isn't left at 0s on first load.
  try {
    if (!repSel.value && dateStartInput.value && dateEndInput.value) {
      refreshStatsRangeAll();
    }
  } catch(_) {}
})();

// Expose helper for debugging
window._renderShiftHistory = renderShiftHistory;
