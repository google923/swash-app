/* Rep Log & Tracking System (offline-first)
   Firestore structure references:
   - territories: { id, name, geoBoundary: [[lat,lng],...], focusPeriodStart: ISO, focusPeriodEnd: ISO }
   - repLogs: /{repId}/{date}/doorLogs -> each doc: { timestamp, status, gpsLat, gpsLng, note? }
   - repShifts: { repId, date, territoryId, startTime, endTime?, pauses: [{start,end}], totals: {...}, miles }
   - repLocations: { repId, timestamp, gpsLat, gpsLng }
*/

import { auth, db } from "../firebase-init.js";
import { collection, doc, getDoc, setDoc, addDoc, getDocs, query, where, updateDoc, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ---------- IndexedDB via localForage ----------
localforage.config({ name: "swash-rep-log", storeName: "repLogStore" });
const OFFLINE_SHIFT_KEY = "currentShift"; // stores entire shift state
const PENDING_PREFIX = "pendingLogs:"; // pendingLogs:YYYY-MM-DD

// ---------- State ----------
const state = {
  shift: null, // { repId, territoryId, date, startTime, logs: [], pauses: [], lastActivityTs, mileageMiles: 0 }
  map: null,
  markerCluster: null,
  lastLocation: null,
  pauseActive: false,
  // Auto-pause after 2 minutes of inactivity
  autoPauseMs: 2 * 60 * 1000,
  gpsWatchId: null,
  locationTimerId: null,
  syncInProgress: false,
  territoryPolygon: null,
  paidTimerId: null,
};

// ---------- DOM Elements ----------
const startBtn = document.getElementById("startDayBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const undoBtn = document.getElementById("undoBtn");
const submitBtn = document.getElementById("submitBtn");
const offlineBanner = document.getElementById("offlineBanner");
const shiftStatusEl = document.getElementById("shiftStatus");
const connectionBadge = document.getElementById("connectionBadge");
const recentListEl = document.getElementById("recentList");
const summaryModal = document.getElementById("summaryModal");
const summaryContent = document.getElementById("summaryContent");
const paidTimerEl = document.getElementById("paidTimer");

// Stats outputs
const statTotal = document.getElementById("statTotal");
const statX = document.getElementById("statX");
const statO = document.getElementById("statO");
const statSales = document.getElementById("statSales");
const statConv = document.getElementById("statConv");
const statMiles = document.getElementById("statMiles");
const statDph = document.getElementById("statDph");

// Log buttons
const btnX = document.getElementById("btnX");
const btnO = document.getElementById("btnO");
const btnSign = document.getElementById("btnSignUp");
// Address & signup modals
const addressModal = document.getElementById("addressModal");
const addressForm = document.getElementById("addressForm");
const addressStatusInput = document.getElementById("addressStatus");
const addressCancelBtn = document.getElementById("addressCancel");
const houseNumberInput = document.getElementById("houseNumber");
const roadNameInput = document.getElementById("roadName");
const addrNotesInput = document.getElementById("addrNotes");
const signupModal = document.getElementById("signupModal");
const signupForm = document.getElementById("signupForm");
const signupCancelBtn = document.getElementById("signupCancel");

let pendingAddress = null; // {houseNumber, roadName, notes}
let pendingStatus = null; // 'X' | 'O' | 'SignUp'

// Utility: UK local time ISO
function nowIso() { return new Date().toISOString(); }
function formatTime(ts) { const d = new Date(ts); return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }

// Haversine miles
function haversineMiles(a, b) {
  if (!a || !b) return 0;
  const R = 3958.8; // miles
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  return R * c;
}

// Point in polygon (ray casting)
function isPointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isOnline() { return navigator.onLine; }

function updateConnectionBadge() {
  connectionBadge.textContent = isOnline() ? "Online" : "Offline";
  connectionBadge.className = "status-badge " + (isOnline() ? "badge-online" : "badge-offline");
  offlineBanner.style.display = isOnline() ? "none" : "block";
}
window.addEventListener("online", updateConnectionBadge);
window.addEventListener("offline", updateConnectionBadge);

// ---------- Load existing shift from IndexedDB ----------
async function loadSavedShift() {
  const saved = await localforage.getItem(OFFLINE_SHIFT_KEY);
  if (saved) {
    // Prompt user to resume or start fresh
    const resume = confirm(
      `You have a shift in progress from ${new Date(saved.startTime).toLocaleDateString('en-GB')} at ${formatTime(saved.startTime)}.\n\n` +
      `${saved.logs.length} doors logged so far.\n\n` +
      `Click OK to RESUME this shift, or Cancel to START FRESH (previous shift will be discarded).`
    );
    
    if (resume) {
      state.shift = saved;
      enableLoggingButtons();
      renderStats();
      renderRecent();
      shiftStatusEl.textContent = "Shift in progress (restored). Started: " + formatTime(state.shift.startTime);
      initMap();
      state.shift.logs.forEach(l => addMarker(l));
      scheduleAutoPauseCheck();
      startLocationTracking();
      startPaidTimer();
    } else {
      // User chose to start fresh - clear saved shift
      await localforage.removeItem(OFFLINE_SHIFT_KEY);
      shiftStatusEl.textContent = "Ready to start a new shift.";
    }
  }
}

// ---------- Start Day ----------
async function handleStartDay() {
  if (state.shift) return;
  const user = auth.currentUser;
  if (!user) { alert("Not authenticated"); return; }

  // Fetch assigned territory from users profile and pre-load all territories
  let assignedTerritoryId = null;
  let repDisplayName = null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const udata = userDoc.exists() ? userDoc.data() : {};
    assignedTerritoryId = udata.assignedTerritoryId || udata.territoryId || null;
    repDisplayName = udata.repName || udata.displayName || udata.name || null;
  } catch(_) {}

  // Load territories from collection, with fallback to system/territories document
  const loadedTerritories = [];
  try {
    const terrSnap = await getDocs(collection(db, "territories"));
    terrSnap.forEach(docu => {
      const data = docu.data();
      loadedTerritories.push({ id: docu.id, ...data });
    });
  } catch(_) {}
  if (!loadedTerritories.length) {
    try {
      const sysDoc = await getDoc(doc(db, "system", "territories"));
      if (sysDoc.exists() && Array.isArray(sysDoc.data().data)) {
        sysDoc.data().data.forEach(t => loadedTerritories.push(t));
      }
    } catch(_) {}
  }

  // Helper to test if a lat/lng is inside a territory shape
  function territoryContains(t, lat, lng) {
    if (!t) return false;
    if (Array.isArray(t.geoBoundary) && t.geoBoundary.length >= 3) {
      return isPointInPolygon(lat, lng, t.geoBoundary);
    }
    if (t.type === 'polygon' && Array.isArray(t.path) && t.path.length >= 3) {
      const poly = t.path.map(p => [p.lat, p.lng]);
      return isPointInPolygon(lat, lng, poly);
    }
    if (t.type === 'circle' && t.center && typeof t.radius === 'number') {
      const R = 6371000; // meters
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat - t.center.lat);
      const dLng = toRad(lng - t.center.lng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(t.center.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng/2)**2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const dist = R * c;
      return dist <= (t.radius || 0);
    }
    return false;
  }

  // Preselect from assigned id if present; refined after we have GPS
  let territory = null;
  if (assignedTerritoryId) {
    territory = loadedTerritories.find(t => t.id === assignedTerritoryId) || null;
  }
  // If nothing selected yet, default to first available so we always have a value if GPS fails
  if (!territory && loadedTerritories.length) {
    territory = loadedTerritories[0];
  }

  // Acquire current position
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    // If multiple territories are available, pick the one containing the current position; else fallback to one assigned to rep name.
    if (loadedTerritories.length) {
      const insideMatches = loadedTerritories.filter(t => territoryContains(t, latitude, longitude));
      if (insideMatches.length) {
        territory = insideMatches[0];
      } else if (repDisplayName) {
        const assignedMatches = loadedTerritories.filter(t => Array.isArray(t.reps) && t.reps.includes(repDisplayName));
        if (assignedMatches.length) territory = assignedMatches[0];
      }
    }
    if (territory && Array.isArray(territory.geoBoundary)) {
      const inside = isPointInPolygon(latitude, longitude, territory.geoBoundary);
      if (!inside) console.warn("Outside territory boundary; continuing");
    }
    const today = new Date();
    // Focus period validation (supports focusPeriod.start/end or focusPeriodStart/End)
    const fpStart = territory.focusPeriod?.start || territory.focusPeriodStart;
    const fpEnd = territory.focusPeriod?.end || territory.focusPeriodEnd;
    if (fpStart && fpEnd) {
      const d = today.toISOString().slice(0,10);
      const inWindow = (d >= String(fpStart).slice(0,10) && d <= String(fpEnd).slice(0,10));
      if (!inWindow) { alert("Today is outside the focus period for this territory."); return; }
    }
    const dateStr = today.toISOString().substring(0,10);
    state.shift = {
  repId: user.uid,
  territoryId: territory ? (territory.id || territory.territoryId || null) : null,
      date: dateStr,
      startTime: nowIso(),
      logs: [],
      pauses: [],
      lastActivityTs: Date.now(),
      mileageMiles: 0,
    };
    await persistShift();
    // Immediately publish initial live location so admin map sees rep without delay
    try {
      await setDoc(doc(db, "repLocations", state.shift.repId), {
        repId: state.shift.repId,
        timestamp: nowIso(),
        gpsLat: latitude,
        gpsLng: longitude,
      }, { merge: true });
    } catch(e) { console.warn("Initial live location write failed", e); }
  const territoryName = territory && (territory.name || territory.id);
  shiftStatusEl.textContent = (state.shift.territoryId ? `Shift started (${territoryName}) at ` : "Shift started (no territory) at ") + formatTime(state.shift.startTime);
    enableLoggingButtons();
    initMap();
    // Center map on current starting position for clarity
    try { if (state.map) state.map.setView([latitude, longitude], 16); } catch(_) {}
    scheduleAutoPauseCheck();
    startLocationTracking();
    startPaidTimer();
  }, (err) => alert("GPS error: " + err.message), { enableHighAccuracy: true });
}

function enableLoggingButtons() {
  [btnX, btnO, btnSign, undoBtn, submitBtn, pauseBtn].forEach(b => b && (b.disabled = false));
  startBtn.disabled = true;
}

async function persistShift() { await localforage.setItem(OFFLINE_SHIFT_KEY, state.shift); }

// Write live shift summary to repShifts for admin tracking dashboard (non-blocking, merge mode)
async function writeLiveShiftSummary() {
  if (!state.shift || !state.shift.startTime) return;
  const activeMinutes = computeActiveMinutesSoFar();
  try {
    await setDoc(doc(db, "repShifts", `${state.shift.repId}_${state.shift.date}`), {
      repId: state.shift.repId,
      date: state.shift.date,
      territoryId: state.shift.territoryId,
      startTime: state.shift.startTime,
      endTime: null, // still in progress
      pauses: state.shift.pauses,
      totals: {
        doors: state.shift.logs.length,
        x: state.shift.logs.filter(l => l.status === 'X').length,
        o: state.shift.logs.filter(l => l.status === 'O').length,
        sales: state.shift.logs.filter(l => l.status === 'SignUp').length,
      },
      miles: state.shift.mileageMiles,
      activeMinutes,
    }, { merge: true });
  } catch (e) {
    console.warn("Live shift summary write failed", e);
  }
}

function computeActiveMinutesSoFar() {
  if (!state.shift) return 0;
  const startMs = new Date(state.shift.startTime).getTime();
  const nowMs = Date.now();
  const total = Math.max(0, nowMs - startMs);
  const manualPaused = sumManualPausesMs(state.shift, nowMs);
  const inactivityPaused = computePausedByInactivity(state.shift, nowMs);
  const activeMs = Math.max(0, total - manualPaused - inactivityPaused);
  return Math.max(0, Math.round(activeMs / 60000));
}

// ---------- Logging ----------
function createLog(status, note, address) {
  if (!state.shift) return;
  // If paused due to inactivity, auto-resume on next log
  if (state.pauseActive) {
    const lastPause = state.shift.pauses[state.shift.pauses.length - 1];
    const wasInactivePause = lastPause && (!lastPause.reason || lastPause.reason === "inactive") && !lastPause.end;
    if (wasInactivePause) {
      // Close the inactivity pause block and resume shift
      lastPause.end = nowIso();
      state.pauseActive = false;
      shiftStatusEl.textContent = "Active.";
      pauseBtn.disabled = false;
      resumeBtn.disabled = true;
      updatePaidTimerDisplay();
    }
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const log = {
      timestamp: nowIso(),
      status,
      gpsLat: latitude,
      gpsLng: longitude,
    };
    if (note) log.note = note;
    if (address) {
      if (address.houseNumber) log.houseNumber = address.houseNumber;
      if (address.roadName) log.roadName = address.roadName;
      if (address.notes) log.addressNotes = address.notes;
    }

    // distance update
    if (state.lastLocation) {
      state.shift.mileageMiles += haversineMiles(state.lastLocation, { lat: latitude, lng: longitude });
    }
    state.lastLocation = { lat: latitude, lng: longitude };

    state.shift.logs.push(log);
  state.shift.lastActivityTs = Date.now();
    // queue pending per-log for background sync (dedupe via id)
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const pendingKey = PENDING_PREFIX + state.shift.date;
    const pending = (await localforage.getItem(pendingKey)) || [];
  pending.push({ id, repId: state.shift.repId, date: state.shift.date, territoryId: state.shift.territoryId, ...log });
    await localforage.setItem(pendingKey, pending);
    renderStats();
    renderRecent();
    addMarker(log);
    // Pan/zoom to latest logged door for immediate visual feedback
    try {
      if (state.map) {
        if (state.map.getZoom() < 15) {
          state.map.setView([latitude, longitude], 17);
        } else {
          state.map.panTo([latitude, longitude], { animate: true, duration: 0.4 });
        }
      }
    } catch(_) {}
  await persistShift();
    // Update live location on every door to improve near real-time tracking
    try {
      await setDoc(doc(db, "repLocations", state.shift.repId), {
        repId: state.shift.repId,
        timestamp: nowIso(),
        gpsLat: latitude,
        gpsLng: longitude,
      }, { merge: true });
    } catch(e) { console.warn("Live location update failed", e); }
    // Write live shift summary so admin can see real-time progress
    writeLiveShiftSummary();
    autoSyncLogs();
    // Attempt background sync via service worker
    try {
      if (navigator.serviceWorker?.ready) {
        const reg = await navigator.serviceWorker.ready;
        if ('sync' in reg) await reg.sync.register('sync-rep-logs');
      }
    } catch(_) {}
  }, (err) => console.warn("GPS log error", err), { enableHighAccuracy: true });
}

function undoLastLog() {
  if (!state.shift || !state.shift.logs.length) return;
  state.shift.logs.pop();
  renderStats();
  renderRecent();
  persistShift();
  // Map re-render simplest: clear + re-add markers
  if (state.markerCluster) { state.markerCluster.clearLayers(); state.shift.logs.forEach(l => addMarker(l)); }
}

function openAddressModalFor(status) {
  pendingStatus = status;
  addressStatusInput.value = status;
  houseNumberInput.value = "";
  roadNameInput.value = "";
  addrNotesInput.value = "";
  addressModal.showModal();
}

btnX.addEventListener("click", () => openAddressModalFor("X"));
btnO.addEventListener("click", () => openAddressModalFor("O"));
btnSign.addEventListener("click", () => openAddressModalFor("SignUp"));

addressForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const address = {
    houseNumber: houseNumberInput.value.trim(),
    roadName: roadNameInput.value.trim(),
    notes: addrNotesInput.value.trim(),
  };
  pendingAddress = address;
  addressModal.close();
  if (pendingStatus === "SignUp") {
    // Step 2: show sign-up form
    const planEl = document.getElementById("planDetails");
    if (planEl) planEl.value = ""; // backward compatibility when notes field exists
    signupModal.showModal();
  } else {
    createLog(pendingStatus, address.notes || "", address);
    pendingStatus = null;
    pendingAddress = null;
  }
});

addressCancelBtn.addEventListener("click", () => {
  pendingStatus = null; pendingAddress = null; addressModal.close();
});

signupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const planEl = document.getElementById("planDetails");
  const summaryEl = document.getElementById("signupQuoteSummary");
  const plan = (planEl?.value || summaryEl?.value || "").trim();
  createLog("SignUp", plan || "", pendingAddress || null);
  signupModal.close();
  pendingStatus = null; pendingAddress = null;
});

signupCancelBtn.addEventListener("click", () => { signupModal.close(); pendingStatus = null; pendingAddress = null; });
undoBtn.addEventListener("click", undoLastLog);

// ---------- Map ----------
function initMap() {
  if (state.map) return;
  state.map = L.map("repMap");
  const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
  tileLayer.addTo(state.map);
  state.markerCluster = L.markerClusterGroup();
  state.map.addLayer(state.markerCluster);
  state.map.setView([52.5, -1.9], 13); // default UK center
}

function addMarker(log) {
  if (!state.map) return;
  const color = log.status === "X" ? "red" : log.status === "O" ? "orange" : log.status === "SignUp" ? "green" : "gold";
  const icon = L.divIcon({ html: `<div style='width:14px;height:14px;border-radius:50%;background:${color};border:2px solid ${log.note && log.status!=="SignUp"?"#333":"#fff"}'></div>` });
  const marker = L.marker([log.gpsLat, log.gpsLng], { icon });
  const addrLine = (log.houseNumber || log.roadName) ? `${log.houseNumber||''} ${log.roadName||''}`.trim() : '';
  const noteLine = log.note ? `<br>${log.note}` : '';
  const addrNotesLine = log.addressNotes ? `<br>${log.addressNotes}` : '';
  marker.bindPopup(`<strong>${log.status}</strong><br>${formatTime(log.timestamp)}${addrLine?`<br>${addrLine}`:''}${noteLine}${addrNotesLine}`);
  state.markerCluster.addLayer(marker);
}
// battery saver removed; map always visible

// ---------- Auto Pause ----------
function scheduleAutoPauseCheck() {
  setInterval(() => {
    if (!state.shift || state.pauseActive) return;
    const since = Date.now() - state.shift.lastActivityTs;
    if (since > state.autoPauseMs) {
      // auto pause
      state.pauseActive = true;
      // Backdate pause start to the exact inactivity threshold moment for accurate paid time
      const startTs = new Date(state.shift.lastActivityTs + state.autoPauseMs).toISOString();
      const pause = { start: startTs, end: null, reason: "inactive" };
      state.shift.pauses.push(pause);
      shiftStatusEl.textContent = `Paused (inactive since ${Math.round(since/60000)}m)`;
      pauseBtn.disabled = true; resumeBtn.disabled = false;
      persistShift();
    }
  }, 60000);
}

// ---------- Paid Time Timer ----------
function computePausedByInactivity(shift, endMs) {
  // Pay grace = autoPauseMs; beyond that, time is unpaid unless a manual pause covers it
  const logsSorted = [...(shift.logs || [])]
    .map(l => new Date(l.timestamp).getTime())
    .filter(t => !isNaN(t))
    .sort((a,b) => a-b);
  let lastActive = new Date(shift.startTime).getTime();
  let inactive = 0;

  const considerGap = (fromMs, toMs) => {
    const gap = Math.max(0, toMs - fromMs);
    if (gap > state.autoPauseMs) inactive += (gap - state.autoPauseMs);
  };

  for (const ts of logsSorted) {
    considerGap(lastActive, ts);
    lastActive = ts;
  }
  considerGap(lastActive, endMs);
  return inactive;
}

function sumManualPausesMs(shift, endMs) {
  // Count ONLY explicit manual pauses to avoid double-counting inactivity
  let paused = 0;
  (shift.pauses || []).forEach(p => {
    if (!p || p.reason !== 'manual' || !p.start) return;
    const ps = new Date(p.start).getTime();
    const pe = p.end ? new Date(p.end).getTime() : endMs;
    if (!isNaN(ps) && !isNaN(pe)) paused += Math.max(0, pe - ps);
  });
  return paused;
}

function computeActiveMsSoFar() {
  if (!state.shift) return 0;
  const startMs = new Date(state.shift.startTime).getTime();
  const nowMs = Date.now();
  const total = Math.max(0, nowMs - startMs);
  const manualPaused = sumManualPausesMs(state.shift, nowMs);
  const inactivityPaused = computePausedByInactivity(state.shift, nowMs);
  const active = Math.max(0, total - manualPaused - inactivityPaused);
  return active;
}

function formatHHMM(ms) {
  const totalMin = Math.floor(ms / 60000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function updatePaidTimerDisplay() {
  if (!paidTimerEl || !state.shift) return;
  const ms = computeActiveMsSoFar();
  paidTimerEl.textContent = formatHHMM(ms);
}

function startPaidTimer() {
  if (state.paidTimerId) clearInterval(state.paidTimerId);
  updatePaidTimerDisplay();
  state.paidTimerId = setInterval(() => {
    updatePaidTimerDisplay();
  }, 15000); // update every 15s
}

function stopPaidTimer() {
  if (state.paidTimerId) { clearInterval(state.paidTimerId); state.paidTimerId = null; }
  updatePaidTimerDisplay();
}

pauseBtn.addEventListener("click", () => {
  if (!state.shift || state.pauseActive) return;
  state.pauseActive = true;
  state.shift.pauses.push({ start: nowIso(), end: null, reason: "manual" });
  shiftStatusEl.textContent = "Paused manually.";
  pauseBtn.disabled = true; resumeBtn.disabled = false;
  persistShift();
  writeLiveShiftSummary();
  updatePaidTimerDisplay();
});

resumeBtn.addEventListener("click", () => {
  if (!state.shift || !state.pauseActive) return;
  state.pauseActive = false;
  const lastPause = state.shift.pauses[state.shift.pauses.length - 1];
  if (lastPause && !lastPause.end) lastPause.end = nowIso();
  shiftStatusEl.textContent = "Active.";
  pauseBtn.disabled = false; resumeBtn.disabled = true;
  state.shift.lastActivityTs = Date.now();
  persistShift();
  writeLiveShiftSummary();
  updatePaidTimerDisplay();
});

// ---------- Location tracking every 5 mins ----------
function startLocationTracking() {
  if (state.locationTimerId) clearInterval(state.locationTimerId);
  state.locationTimerId = setInterval(() => {
    if (!state.shift || state.pauseActive) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        await setDoc(doc(db, "repLocations", state.shift.repId), { repId: state.shift.repId, timestamp: nowIso(), gpsLat: latitude, gpsLng: longitude }, { merge: true });
      } catch (e) { console.warn("repLocations write failed", e); }
    });
  }, 5 * 60 * 1000);
}

// ---------- Stats Rendering ----------
function renderStats() {
  if (!state.shift) return;
  const logs = state.shift.logs;
  const total = logs.length;
  const xCount = logs.filter(l => l.status === "X").length;
  const oCount = logs.filter(l => l.status === "O").length;
  const salesCount = logs.filter(l => l.status === "SignUp").length;
  const conv = total ? ((salesCount / total) * 100).toFixed(1) : 0;
  statTotal.textContent = total;
  statX.textContent = xCount;
  statO.textContent = oCount;
  statSales.textContent = salesCount;
  statConv.textContent = conv + "%";
  statMiles.textContent = state.shift.mileageMiles.toFixed(2);
  // trailing 60 minutes doors/hour
  const cutoff = Date.now() - (60 * 60 * 1000);
  const lastHour = logs.filter(l => new Date(l.timestamp).getTime() >= cutoff).length;
  statDph.textContent = (lastHour).toFixed(1);
}

function renderRecent() {
  const icon = (s) => s === 'X' ? '❌' : s === 'O' ? '⭕' : s === 'SignUp' ? '✅' : s;
  recentListEl.innerHTML = state.shift.logs.slice(-15).reverse().map(l => {
    const addr = [l.houseNumber, l.roadName].filter(Boolean).join(' ');
    const parts = [`${icon(l.status)}`];
    if (addr) parts.push(addr);
    if (l.note) parts.push(l.note);
    return `<div class='recent-item'><div>${formatTime(l.timestamp)}</div><div>${parts.join(' • ')}</div></div>`;
  }).join("");
}

// ---------- Sync ----------
async function autoSyncLogs() {
  if (!isOnline() || state.syncInProgress || !state.shift) return;
  state.syncInProgress = true;
  try {
    // Flush pending per-log docs to Firestore at repLogs/{repId}/dates/{date}/doorLogs/{logId}
    const pendingKey = PENDING_PREFIX + state.shift.date;
    let pending = (await localforage.getItem(pendingKey)) || [];
    if (pending.length) {
      for (const item of pending) {
        const ref = doc(collection(db, 'repLogs', item.repId, 'dates', item.date, 'doorLogs'), item.id);
        await setDoc(ref, item, { merge: true });
      }
      pending = [];
      await localforage.setItem(pendingKey, pending);
    }
  } catch (e) { console.warn("sync failed", e); }
  state.syncInProgress = false;
}

// ---------- Shift Submit ----------
submitBtn.addEventListener("click", async () => {
  if (!state.shift) return;
  state.shift.endTime = nowIso();
  const activeMinutes = computeActiveMinutes();
  const payRate = 12.21;
  const expenseRate = 0.45;
  const pay = (activeMinutes/60) * payRate;
  const miles = state.shift.mileageMiles;
  const mileageExpense = miles * expenseRate;
  const totalOwed = pay + mileageExpense;
  await persistShift();
  await autoSyncLogs();
  try {
    await setDoc(doc(db, "repShifts", `${state.shift.repId}_${state.shift.date}`), {
      repId: state.shift.repId,
      date: state.shift.date,
      territoryId: state.shift.territoryId,
      startTime: state.shift.startTime,
      endTime: state.shift.endTime,
      pauses: state.shift.pauses,
      totals: {
        doors: state.shift.logs.length,
        x: state.shift.logs.filter(l => l.status === 'X').length,
        o: state.shift.logs.filter(l => l.status === 'O').length,
        sales: state.shift.logs.filter(l => l.status === 'SignUp').length,
      },
      miles,
      pay: parseFloat(pay.toFixed(2)),
      mileageExpense: parseFloat(mileageExpense.toFixed(2)),
      totalOwed: parseFloat(totalOwed.toFixed(2)),
      activeMinutes
    }, { merge: true });
  } catch (e) { console.error("Shift summary write failed", e); }
  renderSummary({ pay, mileageExpense, totalOwed, activeMinutes });
  // Clear the saved shift from IndexedDB since it's now submitted and synced
  await localforage.removeItem(OFFLINE_SHIFT_KEY);
  // Lock editing
  [btnX, btnO, btnSign, undoBtn, submitBtn, pauseBtn, resumeBtn].forEach(b => b && (b.disabled = true));
  startBtn.disabled = true; shiftStatusEl.textContent = "Submitted.";
  stopPaidTimer();
});

function computeActiveMinutes() {
  if (!state.shift) return 0;
  const start = new Date(state.shift.startTime).getTime();
  const end = new Date(state.shift.endTime || nowIso()).getTime();
  const total = Math.max(0, end - start);
  const manualPaused = sumManualPausesMs(state.shift, end);
  const inactivityPaused = computePausedByInactivity(state.shift, end);
  const activeMs = Math.max(0, total - manualPaused - inactivityPaused);
  return Math.max(0, Math.round(activeMs / 60000));
}

function renderSummary(extra) {
  const logs = state.shift.logs;
  const total = logs.length;
  const xCount = logs.filter(l => l.status === "X").length;
  const oCount = logs.filter(l => l.status === "O").length;
  const salesCount = logs.filter(l => l.status === "SignUp").length;
  const conv = total ? ((salesCount/total)*100).toFixed(1) : 0;
  // Transparency on deductions
  const endMs = new Date(state.shift.endTime || nowIso()).getTime();
  const startMs = new Date(state.shift.startTime).getTime();
  const manualPausedMs = sumManualPausesMs(state.shift, endMs);
  const inactivityPausedMs = computePausedByInactivity(state.shift, endMs);
  const toMin = (ms) => Math.max(0, Math.round(ms/60000));
  const grossSpanMin = toMin(Math.max(0, endMs - startMs));
  summaryContent.innerHTML = `
    <table style='width:100%;border-collapse:collapse;'>
    <tr><td>Total doors</td><td>${total}</td></tr>
    <tr><td>Not interested (X)</td><td>${xCount}</td></tr>
    <tr><td>Out (O)</td><td>${oCount}</td></tr>
    <tr><td>Sales</td><td>${salesCount}</td></tr>
    <tr><td>Conversion</td><td>${conv}%</td></tr>
    <tr><td>Start</td><td>${formatTime(state.shift.startTime)}</td></tr>
    <tr><td>Finish</td><td>${formatTime(state.shift.endTime)}</td></tr>
  <tr><td>Total time (Start → Finish)</td><td>${grossSpanMin} min</td></tr>
    <tr><td>Inactivity deducted (>=2m gaps)</td><td>${toMin(inactivityPausedMs)} min</td></tr>
    <tr><td>Manual pauses deducted</td><td>${toMin(manualPausedMs)} min</td></tr>
    <tr><td>Paid minutes</td><td>${extra.activeMinutes}</td></tr>
    <tr><td>Pay (£12.21/hr)</td><td>£${extra.pay.toFixed(2)}</td></tr>
    <tr><td>Mileage</td><td>${state.shift.mileageMiles.toFixed(2)} mi</td></tr>
    <tr><td>Mileage (45p/mi)</td><td>£${extra.mileageExpense.toFixed(2)}</td></tr>
    <tr><td><strong>Total owed</strong></td><td><strong>£${extra.totalOwed.toFixed(2)}</strong></td></tr>
    </table>
    <h4 style='margin-top:12px;'>Pauses</h4>
    <ul style='padding-left:18px;'>${state.shift.pauses.map(p => `<li>${formatTime(p.start)} - ${p.end?formatTime(p.end):'ongoing'} (${p.reason})</li>`).join('') || '<li>None</li>'}</ul>
  `;
  summaryModal.showModal();
}

// ---------- Init ----------
startBtn.addEventListener("click", handleStartDay);
summaryModal.querySelector('#summaryClose').addEventListener('click', () => summaryModal.close());
updateConnectionBadge();
// When back online, attempt a sync
window.addEventListener('online', () => autoSyncLogs());
loadSavedShift();

// Listen for SW sync message
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SYNC_REP_LOGS') {
      autoSyncLogs();
    }
  });
}

// Expose for potential debugging
window._repLogState = state;
