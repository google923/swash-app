/* Rep Log & Tracking System (offline-first)
   Firestore structure references:
   - territories: { id, name, geoBoundary: [[lat,lng],...], focusPeriodStart: ISO, focusPeriodEnd: ISO }
   - repLogs: /{repId}/{date}/doorLogs -> each doc: { timestamp, status, gpsLat, gpsLng, note? }
   - repShifts: { repId, date, territoryId, startTime, endTime?, pauses: [{start,end}], totals: {...}, miles }
   - repLocations: { repId, timestamp, gpsLat, gpsLng }
*/

import { auth, db } from "../public/firebase-init.js";
import { collection, doc, getDoc, setDoc, addDoc, getDocs, query, where, updateDoc, orderBy, collectionGroup, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { tenantCollection, tenantDoc } from "../lib/subscriber-paths.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initSubscriberHeader, setCompanyName } from "../public/header-template.js";
import { createQuoteCalculator } from "./components/quote-calculator.js";

// ---------- IndexedDB via localForage ----------
localforage.config({ name: "swash-rep-log", storeName: "repLogStore" });
const OFFLINE_SHIFT_KEY = "currentShift"; // stores entire shift state
const PENDING_PREFIX = "pendingLogs:"; // pendingLogs:YYYY-MM-DD
const SHIFT_QUEUE_KEY = "pendingShiftSummaries"; // array of { id: `${repId}_${date}`, data }
const LAST_SUBSCRIBER_KEY = "swash:lastSubscriberId";

// ---------- State ----------
const state = {
  shift: null, // { repId, territoryId, date, startTime, logs: [], pauses: [], drivingIntervals: [], lastActivityTs, mileageMiles: 0 }
  map: null,
  markerCluster: null,
  allPinsCluster: null,
  allPinsLayer: null,
  allPinsVisible: false,
  repNameCache: {},
  lastLocation: null,
  pauseActive: false,
  // Auto-pause after 2 minutes of inactivity
  autoPauseMs: 2 * 60 * 1000,
  gpsWatchId: null,
  locationTimerId: null,
  syncInProgress: false,
  territoryPolygon: null,
  territoryBoundary: null,
  territoryData: null, // full territory object chosen
  territoryOverlayGroup: null,
  territoryLayers: new Map(),
  territoryCircleMeta: null,
  territoriesInitialized: false,
  paidTimerId: null,
  userInTraining: false, // Training mode disables auto-pause
  drivingMode: false, // Driving mode: accumulates miles, disables auto-pause
  subscriberId: null,
};

// Territories cache (used pre-shift and during shift)
let loadedTerritories = [];
let repDisplayName = null;

// ---------- DOM Elements ----------
// Removed debug badge overlay
const startBtn = document.getElementById("startDayBtn");
const undoBtn = document.getElementById("undoBtn");
const submitBtn = document.getElementById("submitBtn");
const offlineBanner = document.getElementById("offlineBanner");
const shiftStatusEl = document.getElementById("shiftStatus");
const connectionBadge = document.getElementById("connectionBadge");
const recentListEl = document.getElementById("recentList");
const summaryModal = document.getElementById("summaryModal");
const summaryContent = document.getElementById("summaryContent");

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
const roadSuggestionsContainer = document.getElementById("nearbyRoadSuggestions");
const signupModal = document.getElementById("signupModal");
const signupForm = document.getElementById("signupForm");
const signupCancelBtn = document.getElementById("signupCancel");
const quoteCalculatorRoot = document.getElementById("quote-calculator-root");

let pendingAddress = null; // {houseNumber, roadName, notes}
let pendingStatus = null; // 'X' | 'O' | 'SignUp'
let quoteCalculatorInstance = null;
let pendingQuoteSummary = "";

// Recent road names (per rep) persisted in localStorage (12-hour TTL)
const RECENT_ROADS_TTL_MS = 12 * 60 * 60 * 1000;
function recentRoadsKey() {
  const uid = (auth && auth.currentUser && auth.currentUser.uid) || localStorage.getItem('swash:lastUid') || 'anon';
  return `swash:recentRoads:${uid}`;
}
function loadRecentRoadsRaw() {
  try {
    const raw = localStorage.getItem(recentRoadsKey());
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    // Backward compatibility: strings -> objects
    return arr.map(it => {
      if (typeof it === 'string') return { n: it, t: Date.now() };
      if (it && typeof it.n === 'string') return { n: it.n, t: Number(it.t) || Date.now() };
      return null;
    }).filter(Boolean);
  } catch(_) { return []; }
}
function saveRecentRoadsRaw(records) {
  try { localStorage.setItem(recentRoadsKey(), JSON.stringify((records || []).slice(0,25))); } catch(_) {}
}
function loadRecentRoads() {
  const now = Date.now();
  const recs = loadRecentRoadsRaw().filter(r => r && typeof r.n === 'string' && r.n.trim() && (now - (r.t || 0)) <= RECENT_ROADS_TTL_MS);
  // Dedupe by lowercase, preserve order
  const seen = new Set();
  const names = [];
  for (const r of recs) {
    const key = r.n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); names.push(r.n.trim());
  }
  return names;
}
function addRecentRoad(name) {
  const v = (name || '').trim();
  if (!v) return;
  const now = Date.now();
  const recs = loadRecentRoadsRaw();
  const idx = recs.findIndex(x => (x?.n || '').toLowerCase() === v.toLowerCase());
  if (idx >= 0) recs.splice(idx, 1);
  recs.unshift({ n: v, t: now });
  saveRecentRoadsRaw(recs);
}

function renderRecentRoadsDatalist() {
  const dl = document.getElementById('recentRoadNames');
  if (!dl) return;
  const names = loadRecentRoads();
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
}

function ensureQuoteCalculator() {
  if (quoteCalculatorInstance || !quoteCalculatorRoot) {
    return quoteCalculatorInstance;
  }
  // Embed the full add-new-customer page inside the modal via iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'signupIframe';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.setAttribute('allow', 'geolocation *; clipboard-write *');
  iframe.setAttribute('title', 'Sign Up Details');
  quoteCalculatorRoot.innerHTML = '';
  // Ensure container fills modal body height
  try { quoteCalculatorRoot.style.height = '100%'; } catch(_) {}
  quoteCalculatorRoot.appendChild(iframe);

  // Listen for completion messages from embedded form
  window.addEventListener('message', (ev) => {
    try {
      if (!ev || !ev.data || typeof ev.data !== 'object') return;
      if (ev.origin !== location.origin) return;
      if (ev.data.type === 'swash-signup-saved') {
        const d = ev.data || {};
        const salePrefix = d.price_per_clean ? `Sale - ${d.price_per_clean}` : 'Sale';
        const summary = [salePrefix, d.customer_name || 'Customer', d.address || '', d.ref_code ? `(${d.ref_code})` : '']
          .filter(Boolean).join(' ');
        pendingQuoteSummary = summary;
        completeSignupFromQuote(summary);
      }
    } catch(_) {}
  });

  quoteCalculatorInstance = {
    beginSession({ addressLine = '', notes = '' } = {}) {
      const rep = encodeURIComponent(state.repDisplayName || repDisplayName || '');
      const addr = encodeURIComponent(addressLine || '');
      const nts = encodeURIComponent(notes || '');
      iframe.src = `/rep/add-new-customer.html?embed=true&rep=${rep}&address=${addr}&notes=${nts}`;
    },
    setRepCode(_) { /* passed via URL on beginSession */ },
    resetForm() {},
    cancelSession() {},
  };
  console.log("Mounted: add-new-customer embedded form (iframe)");
  return quoteCalculatorInstance;
}

function handleQuoteComponentStatus(event) {
  if (!event || pendingStatus !== "SignUp") return;
  if (event.status === "submitted_online" || event.status === "submitted_offline") {
    // Store the summary but do NOT close modal - user must click "Save Sign Up" button
    pendingQuoteSummary = event.summary || "";
    console.log('[SignUp] Quote component status received, summary stored:', pendingQuoteSummary);
  } else if (event.status === "cancelled") {
    pendingQuoteSummary = "";
    signupModal.close();
    resetSignupState({ silentComponent: true });
  }
}

function completeSignupFromQuote(summaryText = "") {
  if (pendingStatus !== "SignUp") return;
  const finalSummary = summaryText || pendingQuoteSummary || "";
  createLog("SignUp", finalSummary, pendingAddress || null);
  signupModal.close();
  resetSignupState({ silentComponent: true });
}

function resetSignupState({ silentComponent = false } = {}) {
  pendingStatus = null;
  pendingAddress = null;
  pendingQuoteSummary = "";
  // iframe variant does not require resetting
}

function updateQuoteRepPrefill(name) {
  if (!name) return;
  quoteCalculatorInstance?.setRepCode?.(name);
}

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
  const online = isOnline();
  const tracking = !!(state.shift && state.shift.startTime && !state.shift.endTime);

  if (!online) {
    connectionBadge.textContent = "Offline";
    connectionBadge.className = "status-badge connection-pill badge-offline";
  } else if (tracking) {
    connectionBadge.textContent = "Online & Tracking";
    connectionBadge.className = "status-badge connection-pill badge-online";
  } else {
    connectionBadge.textContent = "Online Not Tracking";
    connectionBadge.className = "status-badge connection-pill badge-idle";
  }

  offlineBanner.style.display = online ? "none" : "block";
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
      state.subscriberId = saved.subscriberId || state.subscriberId || null;
      if (state.subscriberId) {
        try { localStorage.setItem(LAST_SUBSCRIBER_KEY, state.subscriberId); } catch(_) {}
      }
      if (!state.shift.subscriberId && state.subscriberId) {
        state.shift.subscriberId = state.subscriberId;
      }
      enableLoggingButtons();
      renderStats();
      renderRecent();
      shiftStatusEl.textContent = "Shift in progress (restored). Started: " + formatTime(state.shift.startTime);
      initMap();
      state.shift.logs.forEach(l => addMarker(l));
      
      // Get current GPS position to center map and add live marker
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        
        // Center map on current position
        if (state.map) state.map.setView([latitude, longitude], 16);
        
        // Add live location marker
        if (state.map) {
          if (state.liveMarker) {
            state.map.removeLayer(state.liveMarker);
          }
          const liveIcon = L.divIcon({ html: `<div style='width:18px;height:18px;border-radius:50%;background:#0078d7;border:3px solid #fff;box-shadow:0 0 8px #0078d7;'></div>` });
          state.liveMarker = L.marker([latitude, longitude], { icon: liveIcon }).addTo(state.map).bindPopup("<strong>Your current location</strong>");
        }
        
        // Load all historical pins
        if (typeof toggleAllPins === 'function') toggleAllPins(true);
      }, (err) => {
        console.warn('GPS error on resume:', err);
        // Fallback: center on last logged location if available
        if (state.shift.logs.length > 0) {
          const last = state.shift.logs[state.shift.logs.length - 1];
          if (state.map && last.gpsLat && last.gpsLng) {
            state.map.setView([last.gpsLat, last.gpsLng], 16);
          }
        }
        // Still load all pins even if GPS fails
        if (typeof toggleAllPins === 'function') toggleAllPins(true);
      }, { enableHighAccuracy: true });
      
      startLocationTracking();
      updateConnectionBadge(); // Update tracking status
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
  const online = isOnline();
  let user = auth.currentUser;
  // Offline fallback: use cached identity if Firebase hasn't restored currentUser
  if (!user && !online) {
    try {
      const cachedUid = localStorage.getItem('swash:lastUid');
      if (cachedUid) {
        user = { uid: cachedUid };
      }
    } catch(_) {}
  }
  if (!user) { alert("Not authenticated. Please sign in once when online to enable offline mode."); return; }

  // Fetch assigned territory from users profile and pre-load all territories
  let assignedTerritoryId = null;
  let assignedTerritory = null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const udata = userDoc.exists() ? userDoc.data() : {};
    assignedTerritoryId = udata.assignedTerritoryId || udata.territoryId || null;
    repDisplayName = udata.repName || udata.displayName || udata.name || null;
    updateQuoteRepPrefill(repDisplayName);
    state.userInTraining = !!udata.training; // Fetch training status
    state.subscriberId = udata.subscriberId || null;
    // Cache for offline use
    try {
      if (assignedTerritoryId) localStorage.setItem('swash:lastAssignedTerritoryId', assignedTerritoryId);
      if (repDisplayName) localStorage.setItem('swash:lastRepName', repDisplayName);
      localStorage.setItem('swash:userInTraining', state.userInTraining ? '1' : '0');
      if (state.subscriberId) {
        localStorage.setItem(LAST_SUBSCRIBER_KEY, state.subscriberId);
      } else {
        localStorage.removeItem(LAST_SUBSCRIBER_KEY);
      }
    } catch(_) {}
  } catch(_) {
    // Offline fallback to cached values
    try {
      assignedTerritoryId = localStorage.getItem('swash:lastAssignedTerritoryId') || null;
      repDisplayName = localStorage.getItem('swash:lastRepName') || null;
      updateQuoteRepPrefill(repDisplayName);
      state.userInTraining = localStorage.getItem('swash:userInTraining') === '1';
      const cachedSubscriber = localStorage.getItem(LAST_SUBSCRIBER_KEY);
      state.subscriberId = cachedSubscriber ? cachedSubscriber : null;
    } catch(_) {}
  }

  // Load territories from collection, with fallback to system/territories document
  // (loadedTerritories declared at top)
  try {
    const terrSnap = await getDocs(collection(db, "territories"));
    terrSnap.forEach(docu => {
      const data = docu.data();
      loadedTerritories.push({ id: docu.id, ...data });
    });
    // Cache for offline use
    try { localStorage.setItem('swash:lastTerritories', JSON.stringify(loadedTerritories)); } catch(_) {}
  } catch(_) {}
  if (!loadedTerritories.length) {
    try {
      const sysDoc = await getDoc(doc(db, "system", "territories"));
      if (sysDoc.exists() && Array.isArray(sysDoc.data().data)) {
        sysDoc.data().data.forEach(t => loadedTerritories.push(t));
      }
      if (loadedTerritories.length) {
        try { localStorage.setItem('swash:lastTerritories', JSON.stringify(loadedTerritories)); } catch(_) {}
      }
    } catch(_) {}
  }
  // Offline fallback to cached territories
  if (!loadedTerritories.length) {
    try {
      const cached = JSON.parse(localStorage.getItem('swash:lastTerritories') || '[]');
      if (Array.isArray(cached)) loadedTerritories = cached;
    } catch(_) {}
  }

  // Find assigned territory object
  if (assignedTerritoryId && loadedTerritories.length) {
    assignedTerritory = loadedTerritories.find(t => t.id === assignedTerritoryId);
  }

  const highlightTerritory = assignedTerritory || (loadedTerritories.length ? loadedTerritories[0] : null);
  renderTerritoryOverlays(loadedTerritories, highlightTerritory);
  state.territoryData = highlightTerritory || null;
  if (state.territoryPolygon) {
    try { await loadAllPins(); } catch(_) { toggleAllPins(true); }
  } else {
    toggleAllPins(true);
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
    if (territory && fpStart && fpEnd) {
      const d = today.toISOString().slice(0,10);
      const inWindow = (d >= String(fpStart).slice(0,10) && d <= String(fpEnd).slice(0,10));
      if (!inWindow) { console.warn("Outside focus period; continuing offline-friendly"); }
    }
    const dateStr = today.toISOString().substring(0,10);
    const startTimestamp = Date.now();
    const shiftId = `${user.uid}_${dateStr}_${startTimestamp}`;
    state.shift = {
      repId: user.uid,
      territoryId: territory ? (territory.id || territory.territoryId || null) : null,
      date: dateStr,
      startTime: nowIso(),
      shiftId: shiftId, // Unique ID for this shift
      logs: [],
      pauses: [],
      drivingIntervals: [],
      lastActivityTs: Date.now(),
      mileageMiles: 0,
      subscriberId: state.subscriberId,
    };
    // Store display name for per-door writes
    state.repDisplayName = repDisplayName || null;
    updateQuoteRepPrefill(state.repDisplayName);
    await persistShift();
    // Publish initial shift summary so admin dashboard recognises tracking immediately
    try {
      await setDoc(
        tenantDoc(db, state.subscriberId, "repShifts", shiftId),
        {
          repId: state.shift.repId,
          date: state.shift.date,
          territoryId: state.shift.territoryId,
          startTime: state.shift.startTime,
          endTime: null,
          pauses: [],
          drivingIntervals: [],
          totals: { doors: 0, x: 0, o: 0, sales: 0 },
          miles: 0,
          activeMinutes: 0,
          shiftId: shiftId,
          training: !!state.userInTraining,
          autoPauseMs: state.autoPauseMs,
          subscriberId: state.subscriberId || null,
        },
        { merge: true },
      );
    } catch (e) {
      console.warn('Initial shift summary write failed', e);
    }
    // Immediately publish initial live location so admin map sees rep without delay
    try {
      await setDoc(tenantDoc(db, state.subscriberId, "repLocations", state.shift.repId), {
        repId: state.shift.repId,
        timestamp: nowIso(),
        gpsLat: latitude,
        gpsLng: longitude,
      }, { merge: true });
    } catch(e) { console.warn("Initial live location write failed", e); }
    
    // Initialize lastLocation for mileage tracking
    state.lastLocation = { lat: latitude, lng: longitude, timestamp: Date.now() };
    
    console.log('[Shift Start] Location tracking initialized');
    
  const territoryName = territory && (territory.name || territory.id);
  shiftStatusEl.textContent = (state.shift.territoryId ? `Shift started (${territoryName}) at ` : "Shift started (no territory) at ") + formatTime(state.shift.startTime);
    enableLoggingButtons();
    initMap();
    // Center map on current starting position for clarity
    try { if (state.map) state.map.setView([latitude, longitude], 16); } catch(_) {}

    // Add rep's own live marker immediately
    if (state.map) {
      if (state.liveMarker) {
        state.map.removeLayer(state.liveMarker);
      }
      const liveIcon = L.divIcon({ html: `<div style='width:18px;height:18px;border-radius:50%;background:#0078d7;border:3px solid #fff;box-shadow:0 0 8px #0078d7;'></div>` });
      state.liveMarker = L.marker([latitude, longitude], { icon: liveIcon }).addTo(state.map).bindPopup("<strong>Your current location</strong>");
    }

    // Ensure all historical pins are loaded and visible
    if (typeof toggleAllPins === 'function') toggleAllPins(true);

    startLocationTracking(); // Start 30-second interval tracking
    updateConnectionBadge(); // Update tracking status
  }, (err) => alert("GPS error: " + err.message), { enableHighAccuracy: true });
}

function enableLoggingButtons() {
  [btnX, btnO, btnSign, undoBtn, submitBtn].forEach(b => b && (b.disabled = false));
  startBtn.disabled = true;
}

async function persistShift() { await localforage.setItem(OFFLINE_SHIFT_KEY, state.shift); }

// Write live shift summary to repShifts for admin tracking dashboard (non-blocking, merge mode)
async function writeLiveShiftSummary() {
  if (!state.shift || !state.shift.startTime) return;
  const activeMinutes = computeActiveMinutesSoFar();
  const shiftDocId = state.shift.shiftId || `${state.shift.repId}_${state.shift.date}`;
  const subscriberContext = state.shift.subscriberId || state.subscriberId || null;
  try {
    await setDoc(tenantDoc(db, subscriberContext, "repShifts", shiftDocId), {
      repId: state.shift.repId,
      date: state.shift.date,
      territoryId: state.shift.territoryId,
      startTime: state.shift.startTime,
      endTime: null, // still in progress
      pauses: state.shift.pauses,
      drivingIntervals: state.shift.drivingIntervals || [],
      totals: {
        doors: state.shift.logs.length,
        x: state.shift.logs.filter(l => l.status === 'X').length,
        o: state.shift.logs.filter(l => l.status === 'O').length,
        sales: state.shift.logs.filter(l => l.status === 'SignUp').length,
      },
      miles: state.shift.mileageMiles,
      activeMinutes,
      shiftId: shiftDocId,
      training: !!state.userInTraining,
      autoPauseMs: state.autoPauseMs,
      subscriberId: subscriberContext,
    }, { merge: true });
  } catch (e) {
    console.warn("Live shift summary write failed", e);
    // Queue summary for later sync
    try {
      const queued = (await localforage.getItem(SHIFT_QUEUE_KEY)) || [];
      queued.push({
        id: shiftDocId,
        subscriberId: subscriberContext,
        data: {
        repId: state.shift.repId,
        date: state.shift.date,
        territoryId: state.shift.territoryId,
        startTime: state.shift.startTime,
        endTime: null,
        pauses: state.shift.pauses,
        drivingIntervals: state.shift.drivingIntervals || [],
        totals: {
          doors: state.shift.logs.length,
          x: state.shift.logs.filter(l => l.status === 'X').length,
          o: state.shift.logs.filter(l => l.status === 'O').length,
          sales: state.shift.logs.filter(l => l.status === 'SignUp').length,
        },
          miles: state.shift.mileageMiles,
          activeMinutes,
          training: !!state.userInTraining,
          autoPauseMs: state.autoPauseMs,
          subscriberId: subscriberContext,
        },
      });
      await localforage.setItem(SHIFT_QUEUE_KEY, queued);
    } catch(_) {}
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
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const log = {
      timestamp: nowIso(),
      status,
      gpsLat: latitude,
      gpsLng: longitude,
      drivingMode: !!state.drivingMode,
      training: !!state.userInTraining,
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
  state.lastLocation = { lat: latitude, lng: longitude, accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null };

    state.shift.logs.push(log);
  state.shift.lastActivityTs = Date.now();
    // queue pending per-log for background sync (dedupe via id)
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const pendingKey = PENDING_PREFIX + state.shift.date;
    const pending = (await localforage.getItem(pendingKey)) || [];
    pending.push({
      id,
      repId: state.shift.repId,
      date: state.shift.date,
      territoryId: state.shift.territoryId,
      subscriberId: state.shift.subscriberId || state.subscriberId || null,
      ...log,
    });
    await localforage.setItem(pendingKey, pending);

    // Write flat per-door document to doorsknocked collection (for universal map rendering)
    try {
      const subscriberContext = state.shift.subscriberId || state.subscriberId || null;
      const doorDocId = `${state.shift.repId}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      await setDoc(
        tenantDoc(db, subscriberContext, 'doorsknocked', doorDocId),
        {
          repId: state.shift.repId,
          repName: state.repDisplayName || state.shift.repId,
          date: state.shift.date,
          territoryId: state.shift.territoryId || null,
          timestamp: log.timestamp,
          status: log.status,
          houseNumber: log.houseNumber || null,
          roadName: log.roadName || null,
          notes: log.note || log.addressNotes || null,
          gpsLat: log.gpsLat,
          gpsLng: log.gpsLng,
          accuracy: state.lastLocation?.accuracy || null,
          source: 'live',
          subscriberId: subscriberContext,
        },
        { merge: true },
      );
    } catch(e) { console.warn('[doorsknocked] write failed', e); }
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
    // Mirror to flat daily doc for redundancy
    try {
      const dailyId = `${state.shift.repId}_${state.shift.date}`;
      const dailyRef = tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, 'repLogs', dailyId);
      const existing = await getDoc(dailyRef);
      const arr = existing.exists() && Array.isArray(existing.data().logs) ? existing.data().logs.slice() : [];
      arr.push({ ...log });
      await setDoc(
        dailyRef,
        {
          repId: state.shift.repId,
          date: state.shift.date,
          subscriberId: state.shift.subscriberId || state.subscriberId || null,
          logs: arr,
        },
        { merge: true },
      );
    } catch(e) { console.warn('[Mirror] daily doc write failed', e); }
    // Update live location on every door to improve near real-time tracking
    try {
      await setDoc(tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, "repLocations", state.shift.repId), {
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
    
    // Auto-disable driving mode when any door is logged
    if (state.drivingMode) {
      state.drivingMode = false;
      updateDrivingModeUI();
      // Restore status text to Active (no longer driving)
      if (!state.pauseActive) {
        try { shiftStatusEl.textContent = "Active."; } catch(_) {}
      }
      console.log('[Driving Mode] Auto-disabled after door log');
    }
  }, (err) => console.warn("GPS log error", err), { enableHighAccuracy: true });
}

function undoLastLog() {
  if (!state.shift || !state.shift.logs.length) return;
  state.shift.logs.pop();
  renderStats();
  renderRecent();
  persistShift();
  // Map re-render simplest: clear + re-add markers
  // Refresh map markers
  if (state.markerLayer) { state.markerLayer.clearLayers(); state.shift.logs.forEach(l => addMarker(l)); }
}

function openQuoteCalculatorModal(address) {
  if (!signupModal) return;
  signupModal.showModal();
  requestAnimationFrame(() => {
    const instance = ensureQuoteCalculator();
    if (!instance) return;
    const formattedAddress = address ? [address.houseNumber, address.roadName].filter(Boolean).join(" ").trim() : '';
    instance.beginSession({ addressLine: formattedAddress, notes: address?.notes || '' });
    pendingQuoteSummary = "";
  });
}

function openAddressModalFor(status) {
  pendingStatus = status;
  addressStatusInput.value = status;
  houseNumberInput.value = "";
  roadNameInput.value = "";
  addrNotesInput.value = "";
  addressModal.showModal();
  // Load nearby roads when modal opens
  loadNearbyRoads();
  // Populate recent datalist immediately
  renderRecentRoadsDatalist();
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
  // Remember road name for quick reuse next time
  if (address.roadName) addRecentRoad(address.roadName);
  pendingAddress = address;
  addressModal.close();
  if (pendingStatus === "SignUp") {
    openQuoteCalculatorModal(address);
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
  const summary = (pendingQuoteSummary || "").trim();
  if (pendingStatus === "SignUp" && !summary) {
    alert("Please complete a quote before saving the sign-up.");
    return;
  }
  completeSignupFromQuote(summary);
});

signupCancelBtn.addEventListener("click", () => {
  signupModal.close();
  resetSignupState();
});

signupModal.addEventListener("close", () => {
  if (pendingStatus === "SignUp") {
    resetSignupState({ silentComponent: true });
  }
});
undoBtn.addEventListener("click", undoLastLog);

// ---------- Map ----------
function initMap() {
  if (state.map) return;
  state.map = L.map("repMap");
  const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
  tileLayer.addTo(state.map);
  state.territoryOverlayGroup = L.layerGroup();
  state.map.addLayer(state.territoryOverlayGroup);
  // Layer for current shift pins (kept separate from history)
  state.markerLayer = L.layerGroup(); // current shift markers (non-cluster)
  state.map.addLayer(state.markerLayer);
  state.allPinsLayer = L.layerGroup();
  state.map.addLayer(state.allPinsLayer);
  // Start with UK view as sensible default until we have rep location/territory
  state.map.setView([54.5, -3], 6);
  state.allPinsVisible = true;
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
  // Use markerLayer (non-cluster) since clustering removed
  if (!state.markerLayer) {
    state.markerLayer = L.layerGroup().addTo(state.map);
  }
  state.markerLayer.addLayer(marker);
}
// battery saver removed; map always visible

// ---------- All Pins (historical) layer ----------
async function getRepDisplay(repId) {
  if (!repId) return 'Unknown Rep';
  if (state.repNameCache[repId]) return state.repNameCache[repId];
  try {
    const snap = await getDoc(doc(db, 'users', repId));
    const name = snap.exists() ? (snap.data().name || snap.data().repName || repId) : repId;
    state.repNameCache[repId] = name;
    return name;
  } catch(_) {
    return repId;
  }
}

function formatDateTime(ts) {
  try { return new Date(ts).toLocaleString('en-GB', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric' }); } catch(_) { return String(ts||''); }
}

function toStatusLabel(s) {
  if (s === 'SignUp') return 'Sale';
  return s || '';
}

function updateAllPinsStatus(msg, warn=false) {
  const hint = document.getElementById('allPinsHint');
  if (hint) {
    hint.textContent = msg;
    hint.style.color = warn ? '#b45309' : '#64748b';
  }
}

// Load ALL historical pins (attempt collectionGroup, fallback to per-rep enumeration) filtered to territory if available
async function loadAllPins({ days = null } = {}) {
  // Wait for auth to be ready to avoid permission denials when request.auth == null
  if (!auth.currentUser) {
    console.log('[AllPins] Auth not ready yet; deferring pin load until signed in');
    await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, user => { if (user) { unsub(); resolve(); } });
    });
  }
  initMap();
  const loadingEl = document.getElementById('allPinsLoading');
  try { if (loadingEl) loadingEl.style.display = 'inline'; } catch(_) {}
  if (!state.allPinsLayer) {
    state.allPinsLayer = L.layerGroup().addTo(state.map);
  }
  try { state.allPinsLayer.clearLayers(); } catch(_) {}
  let count = 0;
  const boundary = Array.isArray(state.territoryBoundary) ? state.territoryBoundary : null;
  // New path: prefer doorsknocked collection for large historical range (6 months)
  // Fallback to daily docs for older code paths if doorsknocked query fails.
  let added = 0;
  try {
    added = await loadSixMonthPins(boundary);
  } catch(e) {
    console.warn('[AllPins] doorsknocked load failed, falling back to daily docs', e);
    added = await loadAllPinsFromDailyDocs(boundary, days || 60);
  }
  count += added;
  try { if (loadingEl) loadingEl.style.display = 'none'; } catch(_) {}
  updateAllPinsStatus(`Showing ${count} pins${boundary? ' (territory filtered)' : ''}`);
}

async function loadAllPinsFallbackDays(territoryReps, boundary, days) {
  // Debug overlay removed; keep console logs only
  const sinceMs = Date.now() - days*24*60*60*1000;
  let repIds = [];
  try {
    let userRef = collection(db, 'users');
    if (state.subscriberId) {
      userRef = query(userRef, where('subscriberId', '==', state.subscriberId));
    }
    const repsSnap = await getDocs(userRef);
    repsSnap.docs.forEach(d => {
      const data = d.data();
      const role = (data.role||'').toLowerCase();
      if (role === 'rep') {
        repIds.push(d.id);
      }
    });
  } catch(err) {
    console.warn('[AllPins Fallback] users collection read failed', err);
    // If user fetch fails, fallback to just current user
    if (auth.currentUser) repIds = [auth.currentUser.uid];
  }
  console.log('[DEBUG] Rep IDs used for fallback (ALL):', repIds);
  console.log('[DEBUG] Territory boundary:', boundary);
  for (const repId of repIds) {
    for (let d = new Date(); d.getTime() >= sinceMs; d.setDate(d.getDate()-1)) {
      const dateStr = d.toISOString().slice(0,10);
      const docId = `${repId}_${dateStr}`;
      try {
        const docRef = tenantDoc(db, state.subscriberId || null, 'repLogs', docId);
        console.log(`[DEBUG] Querying Firestore: repLogs/${docId}`);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          // No log for this rep/date
          continue;
        }
        const data = docSnap.data();
        if (!data.logs || !Array.isArray(data.logs)) {
          console.log(`[DEBUG] No logs array in doc repLogs/${docId}`);
          continue;
        }
        console.log(`[DEBUG] Found ${data.logs.length} logs for ${repId} on ${dateStr}`);
        data.logs.forEach((v, idx) => {
          console.log('[DEBUG] Pin log:', v);
          if (!v || typeof v.gpsLat !== 'number' || typeof v.gpsLng !== 'number') return;
          // TEMP: Disable boundary filter for debug
          // if (boundary && !isPointInPolygon(v.gpsLat, v.gpsLng, boundary)) return;
          const color = v.status === 'X' ? 'red' : v.status === 'O' ? 'orange' : v.status === 'SignUp' ? 'green' : 'gold';
          const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
          const m = L.marker([v.gpsLat, v.gpsLng], { icon });
          const addr = [v.houseNumber, v.roadName].filter(Boolean).join(' ');
          const repName = v.repId ? v.repId : repId;
          const dateStr2 = v.timestamp ? formatDateTime(v.timestamp) : dateStr;
          const noteLine = v.note || v.addressNotes ? `<br>${(v.note||v.addressNotes)}` : '';
          m.bindPopup(`<div style='font-size:12px;line-height:1.35;'><div><strong>${toStatusLabel(v.status)}</strong> • <span style='color:#64748b;'>${dateStr2}</span></div>${addr?`<div>${addr}</div>`:''}<div class='small' style='color:#475569;'>Rep: ${repName}</div>${noteLine}</div>`);
          state.allPinsLayer.addLayer(m);
        });
      } catch(e) {
        console.error(`[DEBUG] Error querying Firestore for ${docId}:`, e);
      }
    }
  }
  // End of fallback loader
}

// Fast path: read daily documents repLogs/{repId}_{date} across ALL reps for the last N days
async function loadAllPinsFromDailyDocs(boundary, days) {
  let added = 0;
  const perRepCounts = {};
  try {
    const cutoff = new Date(Date.now() - days*24*60*60*1000).toISOString().slice(0,10);
    console.log('[DEBUG] Querying ALL daily docs and filtering by ID date >=', cutoff);
    const snap = await getDocs(tenantCollection(db, state.subscriberId || null, 'repLogs'));
    console.log('[DEBUG] Total daily docs returned:', snap.size);
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const logs = Array.isArray(data.logs) ? data.logs : [];
      const [repIdFromDoc, idDate] = docSnap.id.split('_');
      if (!idDate || idDate < cutoff) return; // skip older than cutoff
      if (!perRepCounts[repIdFromDoc]) perRepCounts[repIdFromDoc] = { docs:0, pins:0 };
      perRepCounts[repIdFromDoc].docs += 1;
      logs.forEach(v => {
        if (!v || typeof v.gpsLat !== 'number' || typeof v.gpsLng !== 'number') return;
        // Optional territory filter
        if (boundary && !isPointInPolygon(v.gpsLat, v.gpsLng, boundary)) return;
        const color = v.status === 'X' ? 'red' : v.status === 'O' ? 'orange' : v.status === 'SignUp' ? 'green' : 'gold';
        const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
        const m = L.marker([v.gpsLat, v.gpsLng], { icon });
        const addr = [v.houseNumber, v.roadName].filter(Boolean).join(' ');
        const repName = v.repId || (docSnap.id.split('_')[0]);
        const dateStr2 = v.timestamp ? formatDateTime(v.timestamp) : (data.date || '');
        const noteLine = v.note || v.addressNotes ? `<br>${(v.note||v.addressNotes)}` : '';
        m.bindPopup(`<div style='font-size:12px;line-height:1.35;'><div><strong>${toStatusLabel(v.status)}</strong> • <span style='color:#64748b;'>${dateStr2}</span></div>${addr?`<div>${addr}</div>`:''}<div class='small' style='color:#475569;'>Rep: ${repName}</div>${noteLine}</div>`);
        state.allPinsLayer.addLayer(m);
        added++;
        perRepCounts[repIdFromDoc].pins += 1;
      });
    });
  console.log('[DEBUG] Per-rep daily doc summary:', perRepCounts);
    Object.entries(perRepCounts).forEach(([rep, stats]) => {
      console.log(`[DEBUG] Rep ${rep}: ${stats.pins} pins across ${stats.docs} daily docs`);
    });
  } catch (e) {
    console.warn('[AllPins] Daily docs query failed; falling back to per-rep enumeration', e);
    await loadAllPinsFallbackDays(null, boundary, days);
    added = state.allPinsLayer ? state.allPinsLayer.getLayers().length : 0;
  }
  // Debug overlay removed
  return added;
}

function toggleAllPins(checked) {
  // Always show all pins (full history) once loaded
  state.allPinsVisible = true;
  if (!state.map) {
    initMap();
  }
  if (!state._sixMonthLoaded && !state._sixMonthLoading) {
    state._sixMonthLoading = true;
    loadAllPins().then(() => {
      state._sixMonthLoading = false;
      state._sixMonthLoaded = true;
    }).catch(err => {
      console.error('toggleAllPins error:', err);
      state._sixMonthLoading = false;
    });
  }
}

function normaliseLatLngTuple(point) {
  if (!point) return null;
  if (Array.isArray(point) && point.length >= 2) {
    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return null;
  }
  if (typeof point.lat === "number" && typeof point.lng === "number") {
    return [point.lat, point.lng];
  }
  if (typeof point.latitude === "number" && typeof point.longitude === "number") {
    return [point.latitude, point.longitude];
  }
  return null;
}

function extractTerritoryBoundary(territory) {
  if (!territory) return null;
  const candidates = [territory.geoBoundary, territory.boundary, territory.path];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const tuples = candidate.map(normaliseLatLngTuple).filter(Boolean);
    if (tuples.length >= 3) {
      return tuples;
    }
  }
  return null;
}

function getTerritoryTooltip(territory) {
  if (!territory) return "";
  const name = territory.name || territory.territoryName || territory.id || territory.territoryId || "Territory";
  const reps = Array.isArray(territory.reps) ? territory.reps.filter(Boolean) : [];
  if (!reps.length) return String(name);
  return `${name} • ${reps.join(", ")}`;
}

function getTerritoryColor(territory) {
  if (territory && typeof territory.color === "string" && territory.color.trim()) {
    return territory.color.trim();
  }
  return "#0078d7";
}

function renderTerritoryOverlays(territories = [], highlightTerritory = null) {
  if (!state.map) return null;
  if (!state.territoryOverlayGroup) {
    state.territoryOverlayGroup = L.layerGroup().addTo(state.map);
  } else {
    state.territoryOverlayGroup.clearLayers();
  }
  state.territoryLayers = new Map();
  state.territoryPolygon = null;
  state.territoryBoundary = null;
  state.territoryCircleMeta = null;

  const highlightIdRaw = highlightTerritory ? (highlightTerritory.id || highlightTerritory.territoryId || highlightTerritory.slug || highlightTerritory.name || null) : null;
  const highlightId = highlightIdRaw != null ? String(highlightIdRaw) : null;
  let highlightOverlay = null;
  let fallbackOverlay = null;
  let fallbackBoundary = null;
  let fallbackCircleMeta = null;
  let fallbackTerritory = null;
  let unnamedIncrement = 0;

  territories.forEach((territory) => {
    if (!territory) return;
    const rawId = territory.id || territory.territoryId || territory.slug || territory.name;
    const id = rawId != null ? String(rawId) : `territory-${unnamedIncrement++}`;
    const boundary = extractTerritoryBoundary(territory);
    const isHighlight = highlightId ? (id === highlightId) : false;
    const color = getTerritoryColor(territory);
    const tooltip = getTerritoryTooltip(territory);

    let overlay = null;

    if (boundary && boundary.length >= 3) {
      overlay = L.polygon(boundary, {
        color,
        weight: isHighlight ? 3 : 1.5,
        fillOpacity: isHighlight ? 0.12 : 0.05,
        dashArray: isHighlight ? null : "6 8",
      });
    } else if (territory.center && typeof territory.center.lat === "number" && typeof territory.center.lng === "number" && typeof territory.radius === "number") {
      overlay = L.circle([territory.center.lat, territory.center.lng], {
        radius: territory.radius,
        color,
        weight: isHighlight ? 3 : 1.5,
        fillOpacity: isHighlight ? 0.12 : 0.05,
        dashArray: isHighlight ? null : "6 8",
      });
    }

    if (!overlay) return;

    overlay.addTo(state.territoryOverlayGroup);
    if (tooltip) {
      overlay.bindTooltip(tooltip, { sticky: true });
    }
    state.territoryLayers.set(id, overlay);

    if (!fallbackOverlay) {
      fallbackOverlay = overlay;
      fallbackBoundary = boundary ? boundary.slice() : null;
      fallbackCircleMeta = (!boundary && territory.center && typeof territory.center.lat === "number" && typeof territory.center.lng === "number" && typeof territory.radius === "number")
        ? { center: { lat: territory.center.lat, lng: territory.center.lng }, radius: territory.radius }
        : null;
      fallbackTerritory = territory;
    }

    if (isHighlight) {
      highlightOverlay = overlay;
      state.territoryPolygon = overlay;
      state.territoryData = territory;
      if (boundary) {
        state.territoryBoundary = boundary.slice();
        state.territoryCircleMeta = null;
      } else {
        state.territoryBoundary = null;
        state.territoryCircleMeta = {
          center: { lat: territory.center.lat, lng: territory.center.lng },
          radius: territory.radius,
        };
      }
    }
  });

  const overlayToFocus = highlightOverlay || fallbackOverlay;
  if (overlayToFocus) {
    try { overlayToFocus.bringToFront(); } catch (_) {}
    if (typeof overlayToFocus.getBounds === "function") {
      try { state.map.fitBounds(overlayToFocus.getBounds(), { maxZoom: 14 }); } catch (_) {}
    } else if (typeof overlayToFocus.getLatLng === "function") {
      state.map.setView(overlayToFocus.getLatLng(), 14);
    }
  }

  if (!highlightOverlay && fallbackOverlay) {
    state.territoryPolygon = fallbackOverlay;
    state.territoryData = fallbackTerritory || null;
    state.territoryBoundary = fallbackBoundary;
    state.territoryCircleMeta = fallbackCircleMeta;
  }

  state.territoriesInitialized = state.territoryLayers.size > 0;
  return highlightOverlay || overlayToFocus || null;
}

// ---------- Six-Month Pins Loader (doorsknocked) ----------
async function loadSixMonthPins(boundary) {
  const hint = document.getElementById('allPinsHint');
  if (hint) hint.textContent = 'Preparing six-month pins…';
  const today = new Date();
  const start = new Date(); start.setMonth(start.getMonth() - 6);
  const startStr = start.toISOString().slice(0,10); // YYYY-MM-DD
  // We'll batch by month windows to avoid huge single queries.
  const monthWindows = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth(), 1);
  while (cursor <= endDate) {
    const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mEnd = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0); // last day of month
    monthWindows.push({
      start: mStart.toISOString().slice(0,10),
      end: mEnd.toISOString().slice(0,10)
    });
    cursor.setMonth(cursor.getMonth()+1);
  }
  let totalAdded = 0;
  for (let i=0;i<monthWindows.length;i++) {
    const win = monthWindows[i];
    if (hint) hint.textContent = `Loading ${win.start.slice(0,7)}… (${i+1}/${monthWindows.length})`;
    const batch = await fetchDoorsKnockedWindow(win.start, win.end);
    batch.forEach(d => {
      if (!d || typeof d.gpsLat !== 'number' || typeof d.gpsLng !== 'number') return;
      if (boundary && !isPointInPolygon(d.gpsLat, d.gpsLng, boundary)) return;
      const color = d.status === 'X' ? 'red' : d.status === 'O' ? 'orange' : d.status === 'SignUp' ? 'green' : 'gold';
      const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
      const m = L.marker([d.gpsLat, d.gpsLng], { icon });
      const addr = [d.houseNumber, d.roadName].filter(Boolean).join(' ');
      const ts = d.timestamp ? new Date(d.timestamp).toLocaleString('en-GB',{ day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : d.date;
      const noteLine = d.notes ? `<br>${d.notes}` : '';
  const repLine = `<br><span style='color:#475569'>Rep: ${d.repName || d.repId || 'Unknown'}</span>`;
  m.bindPopup(`<strong>${d.status==='SignUp'?'Sale':d.status}</strong><br>${ts}${addr?`<br>${addr}`:''}${repLine}${noteLine}`);
      if (!state.allPinsLayer) {
        state.allPinsLayer = L.layerGroup().addTo(state.map);
      }
      state.allPinsLayer.addLayer(m);
      totalAdded++;
    });
    // Yield to UI
    await new Promise(r => setTimeout(r, 30));
  }
  state._sixMonthLoaded = true;
  if (hint) hint.textContent = `Showing ${totalAdded.toLocaleString()} pins (last 6 months)`;
  // Fit bounds once after load (avoid excessive recompute)
  if (totalAdded) {
    try { state.map.fitBounds(state.allPinsLayer.getBounds(), { padding:[20,20], maxZoom: 15 }); } catch(_) {}
  }
  return totalAdded;
}

async function fetchDoorsKnockedWindow(startStr, endStr) {
  // Uses range on 'date' field (string YYYY-MM-DD)
  // Firestore double inequality on same field is allowed; orderBy('date') required.
  try {
    const q = query(
      tenantCollection(db, state.subscriberId || null, 'doorsknocked'),
      where('date','>=', startStr),
      where('date','<=', endStr),
      orderBy('date'),
    );
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(docSnap => out.push(docSnap.data()));
    return out;
  } catch(e) {
    console.warn('[doorsknocked] window query failed', startStr, endStr, e);
    return [];
  }
}

// ---------- Stats calculation ----------
function computePausedByInactivity(shift, endMs) {
  // Skip inactivity deductions if user is in training mode
  if (state.userInTraining) return 0;
  
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

function formatHHMM(ms) {
  const totalMin = Math.floor(ms / 60000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------- Location tracking every 30 seconds (for all reps) ----------
function startLocationTracking() {
  if (state.locationTimerId) clearInterval(state.locationTimerId);
  
  console.log('[Location Tracking] Starting 30-second interval tracking');
  
  state.locationTimerId = setInterval(() => {
    // Only track location if shift is active (has startTime and no endTime)
    if (!state.shift || !state.shift.startTime || state.shift.endTime) {
      console.log('[Location Tracking] Skipping - shift inactive');
      return;
    }
    
    console.log('[Location Tracking] Requesting GPS position...');
    
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const speed = pos.coords.speed; // Speed in meters per second (may be null)
      
      console.log(`[Location Tracking] GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}, speed: ${speed}`);
      
      // Update last location and calculate distance if we have previous location
      if (state.lastLocation) {
        const distance = haversineMiles(
          { lat: state.lastLocation.lat, lng: state.lastLocation.lng },
          { lat: latitude, lng: longitude }
        );
        
        // Calculate speed in mph if browser doesn't provide it
        let speedMph = 0;
        if (speed !== null && speed !== undefined) {
          speedMph = speed * 2.23694; // Convert m/s to mph
        } else {
          // Calculate based on distance and time elapsed
          const timeElapsedHours = 30 / 3600; // 30 seconds in hours
          speedMph = distance / timeElapsedHours;
        }
        
        console.log(`[Location Tracking] Speed: ${speedMph.toFixed(1)} mph, Distance: ${distance.toFixed(4)} mi`);
        
        // Add distance to mileage automatically
        state.shift.mileageMiles += distance;
        await persistShift();
        renderStats();
        console.log(`[Location Tracking] Mileage updated: +${distance.toFixed(4)} mi (total: ${state.shift.mileageMiles.toFixed(2)} mi)`);
      }
      
  state.lastLocation = { lat: latitude, lng: longitude, accuracy: (typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null), timestamp: Date.now() };
      
      try {
        console.log(`[Location Tracking] Writing to repLocations/${state.shift.repId}...`);
        await setDoc(
          tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, "repLocations", state.shift.repId),
          {
            repId: state.shift.repId,
            timestamp: nowIso(),
            gpsLat: latitude,
            gpsLng: longitude,
            subscriberId: state.shift.subscriberId || state.subscriberId || null,
          },
          { merge: true },
        );
        console.log('[Location Tracking] ✓ repLocations write successful');
        // Opportunistic flush: if online, also mirror a heartbeat into daily doc (keeps doc alive)
        try {
          const dailyId = `${state.shift.repId}_${state.shift.date}`;
          const dailyRef = tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, 'repLogs', dailyId);
          const snap = await getDoc(dailyRef);
          if (!snap.exists()) {
            await setDoc(
              dailyRef,
              {
                repId: state.shift.repId,
                date: state.shift.date,
                subscriberId: state.shift.subscriberId || state.subscriberId || null,
                logs: [],
              },
              { merge: true },
            );
          }
        } catch(_) {}
      } catch (e) { 
        console.error("[Location Tracking] ✗ repLocations write failed:", e); 
      }
    }, (err) => {
      console.error('[Location Tracking] GPS error:', err.message, err);
    }, { 
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  }, 30 * 1000); // 30 seconds for all reps
}

async function stopLocationTracking() {
  if (state.locationTimerId) {
    clearInterval(state.locationTimerId);
    state.locationTimerId = null;
  }
  // Delete repLocation document so admin map no longer shows this rep as online
  if (state.shift?.repId) {
    try {
      // Mark inactive instead of deleting (rules may block deletes)
      await setDoc(
        tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, "repLocations", state.shift.repId),
        {
          active: false,
          offlineAt: nowIso(),
          subscriberId: state.shift.subscriberId || state.subscriberId || null,
        },
        { merge: true },
      );
      console.log('[Location Tracking] Marked repLocation inactive');
    } catch (e) {
      if (console.debug) console.debug('[Location Tracking] Could not mark inactive:', e);
    }
  }
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
  if (!auth.currentUser) return;
  state.syncInProgress = true;
  try {
    // Flush pending per-log docs to Firestore at repLogs/{repId}/dates/{date}/doorLogs/{logId}
    const pendingKey = PENDING_PREFIX + state.shift.date;
    let pending = (await localforage.getItem(pendingKey)) || [];
    if (pending.length) {
      for (const item of pending) {
          const ref = tenantDoc(
            db,
            item.subscriberId || state.subscriberId || null,
            'repLogs',
            item.repId,
            'dates',
            item.date,
            'doorLogs',
            item.id,
          );
          await setDoc(ref, item, { merge: true });
      }
      pending = [];
      await localforage.setItem(pendingKey, pending);
    }
    // Also mirror entire logs array to daily doc to ensure redundancy
    try {
      const dailyId = `${state.shift.repId}_${state.shift.date}`;
      const dailyRef = tenantDoc(db, state.shift.subscriberId || state.subscriberId || null, 'repLogs', dailyId);
      const arr = (state.shift.logs || []).map(l => ({ ...l }));
      await setDoc(
        dailyRef,
        {
          repId: state.shift.repId,
          date: state.shift.date,
          subscriberId: state.shift.subscriberId || state.subscriberId || null,
          logs: arr,
        },
        { merge: true },
      );
    } catch(e) { console.warn('[Mirror] autoSync daily doc failed', e); }
  } catch (e) { console.warn("sync failed", e); }
  state.syncInProgress = false;
}

// Scan and sync all pending logs across dates (works even if state.shift is null)
async function syncAllPendingLogs() {
  if (!isOnline()) return;
  if (!auth.currentUser) return;
  try {
    const keys = await localforage.keys();
    const pendingKeys = keys.filter(k => k.startsWith(PENDING_PREFIX));
    for (const key of pendingKeys) {
      let pending = (await localforage.getItem(key)) || [];
      if (!pending.length) continue;
      const failed = [];
      for (const item of pending) {
        try {
          const collectionRef = tenantCollection(
            db,
            item.subscriberId || state.subscriberId || null,
            'repLogs',
            item.repId,
            'dates',
            item.date,
            'doorLogs',
          );
          const ref = doc(collectionRef, item.id);
          await setDoc(ref, item, { merge: true });
        } catch (e) {
          failed.push(item);
          if (console.debug) console.debug('Pending log not synced yet (will retry later)', item.id, e?.code || e);
        }
      }
      // After flushing one day's pending, mirror that date's logs if we have a currentShift for it
      try {
        const shift = await localforage.getItem(OFFLINE_SHIFT_KEY);
        if (shift && shift.date && key.endsWith(shift.date)) {
          const dailyId = `${shift.repId}_${shift.date}`;
          await setDoc(
            tenantDoc(db, shift.subscriberId || state.subscriberId || null, 'repLogs', dailyId),
            {
              repId: shift.repId,
              date: shift.date,
              subscriberId: shift.subscriberId || state.subscriberId || null,
              logs: (shift.logs||[]).map(l=>({...l})),
            },
            { merge: true },
          );
        }
      } catch(_) {}
      await localforage.setItem(key, failed);
    }
  } catch (e) { console.warn('syncAllPendingLogs failed', e); }
}

// Sync queued shift summaries
async function syncQueuedShiftSummaries() {
  if (!isOnline()) return;
  try {
    let queued = (await localforage.getItem(SHIFT_QUEUE_KEY)) || [];
    if (!queued.length) return;
    const remaining = [];
    for (const entry of queued) {
      try {
        const subscriberContext = entry.subscriberId || entry.data?.subscriberId || state.subscriberId || null;
        const payload = { ...entry.data, subscriberId: subscriberContext };
        await setDoc(
          tenantDoc(db, subscriberContext, 'repShifts', entry.id),
          payload,
          { merge: true },
        );
      } catch (e) {
        console.warn('Failed to sync shift summary', entry.id, e);
        remaining.push(entry);
      }
    }
    await localforage.setItem(SHIFT_QUEUE_KEY, remaining);
  } catch (e) { console.warn('syncQueuedShiftSummaries failed', e); }
}

// ---------- Shift Submit ----------
async function endShift(showSummaryModal = true) {
  if (!state.shift) return;
  state.shift.endTime = nowIso();
  const activeMinutes = computeActiveMinutes();
  const payRate = 12.21;
  const expenseRate = 0.45;
  // Use paid minutes for pay calculation
  const paidMinutes = activeMinutes;
  const pay = (paidMinutes / 60) * payRate;
  const miles = state.shift.mileageMiles;
  const mileageExpense = miles * expenseRate;
  const totalOwed = pay + mileageExpense;
  await persistShift();
  await autoSyncLogs();
  const shiftDocId = state.shift.shiftId || `${state.shift.repId}_${state.shift.date}`;
  const subscriberContext = state.shift.subscriberId || state.subscriberId || null;
  const shiftData = {
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
    activeMinutes,
    shiftId: shiftDocId,
    subscriberId: subscriberContext,
  };
  console.log('[DEBUG] Writing shift summary to Firestore:', shiftData);
  try {
    await setDoc(tenantDoc(db, subscriberContext, "repShifts", shiftDocId), shiftData, { merge: true });
  } catch (e) {
    console.error("Shift summary write failed", e);
    alert('Shift summary write failed: ' + (e && e.message ? e.message : e));
  }
  // If offline, queue summary for later
  if (!isOnline()) {
    try {
      const queued = (await localforage.getItem(SHIFT_QUEUE_KEY)) || [];
      queued.push({
        id: shiftDocId,
        subscriberId: subscriberContext,
        data: {
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
          activeMinutes,
          subscriberId: subscriberContext,
        },
      });
      await localforage.setItem(SHIFT_QUEUE_KEY, queued);
    } catch(_) {}
  }
  
  // Stop location tracking when shift ends
  await stopLocationTracking();
  updateConnectionBadge(); // Update tracking status
  
  if (showSummaryModal) {
    renderSummary({ pay, mileageExpense, totalOwed, activeMinutes });
  }
  // Clear the saved shift from IndexedDB since it's now submitted and synced
  await localforage.removeItem(OFFLINE_SHIFT_KEY);
  // Lock editing
  [btnX, btnO, btnSign, undoBtn, submitBtn].forEach(b => b && (b.disabled = true));
  startBtn.disabled = true; shiftStatusEl.textContent = "Submitted.";
}

submitBtn.addEventListener("click", async () => {
  await endShift(true);
});

// Expose function for auth-check.js logout handler
window.endShiftBeforeLogout = async function() {
  if (state.shift && state.shift.startTime && !state.shift.endTime) {
    console.log('[Rep Log] Auto-ending active shift before logout');
    await endShift(false); // Don't show summary modal on logout
  } else {
    // Even if no active shift, ensure repLocation is cleaned up
    await stopLocationTracking();
  }
};

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
  const salesCount = logs.filter(l => l.status === "SignUp").length;
  
  // Commission calculation
  const signUpBonus = 15; // £15 per sign up
  const firstCleanCommission = salesCount * signUpBonus;
  const afterTwoCleansCommission = salesCount * signUpBonus * 2;
  const afterThreeCleansCommission = salesCount * signUpBonus * 3;
  
  // Get first and last door logged times
  const firstDoorTime = logs.length > 0 ? formatTime(logs[0].timestamp) : 'N/A';
  const lastDoorTime = logs.length > 0 ? formatTime(logs[logs.length - 1].timestamp) : 'N/A';
  
  summaryContent.innerHTML = `
    <table style='width:100%;border-collapse:collapse;'>
    <tr><td><strong>Total doors</strong></td><td><strong>${total}</strong></td></tr>
    <tr><td>Sales</td><td>${salesCount}</td></tr>
    <tr><td>First door logged</td><td>${firstDoorTime}</td></tr>
    <tr><td>Last door logged</td><td>${lastDoorTime}</td></tr>
    <tr style='border-top:2px solid #e5e7eb;'><td colspan='2' style='padding-top:12px;'><strong>Commission Breakdown</strong></td></tr>
    <tr><td>First clean (£15 per sign up)</td><td><strong>£${firstCleanCommission.toFixed(2)}</strong></td></tr>
    <tr><td>After 2 cleans</td><td><strong>£${afterTwoCleansCommission.toFixed(2)}</strong></td></tr>
    <tr><td>After 3 cleans</td><td><strong>£${afterThreeCleansCommission.toFixed(2)}</strong></td></tr>
    </table>
  `;
  summaryModal.showModal();
}

// ---------- Init ----------
startBtn.addEventListener("click", handleStartDay);
summaryModal.querySelector('#summaryClose').addEventListener('click', () => summaryModal.close());
updateConnectionBadge();
// When back online, attempt a sync
window.addEventListener('online', () => { autoSyncLogs(); syncAllPendingLogs(); syncQueuedShiftSummaries(); });
// Always initialize map at page load so it's never blank
initMap();
// Preload saved shift if present (will also call initMap internally if needed)
loadSavedShift();

// If user is authenticated and hasn't started a shift yet, draw their assigned territory
async function preloadTerritoryForViewing() {
  try {
    initMap();
    const online = isOnline();
    let user = auth.currentUser;
    if (!user && !online) {
      const cachedUid = localStorage.getItem('swash:lastUid');
      if (cachedUid) user = { uid: cachedUid };
    }
    if (!user) return;

    // Load assigned territory id and rep name from profile or cache
    let assignedTerritoryId = null;
    let repDisplayName = null;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const udata = userDoc.exists() ? userDoc.data() : {};
      assignedTerritoryId = udata.assignedTerritoryId || udata.territoryId || null;
      repDisplayName = udata.repName || udata.displayName || udata.name || user.email || null;
      if (assignedTerritoryId) localStorage.setItem('swash:lastAssignedTerritoryId', assignedTerritoryId);
      if (repDisplayName) localStorage.setItem('swash:lastRepName', repDisplayName);
    } catch (_) {
      assignedTerritoryId = localStorage.getItem('swash:lastAssignedTerritoryId') || null;
      repDisplayName = localStorage.getItem('swash:lastRepName') || null;
    }
    // Load territories list (online → system fallback → cache)
    loadedTerritories = [];
    try {
      const terrSnap = await getDocs(collection(db, 'territories'));
      terrSnap.forEach(d => loadedTerritories.push({ id: d.id, ...d.data() }));
      if (loadedTerritories.length) localStorage.setItem('swash:lastTerritories', JSON.stringify(loadedTerritories));
    } catch(_) {}
    if (!loadedTerritories.length) {
      try {
        const sysDoc = await getDoc(doc(db, 'system', 'territories'));
        if (sysDoc.exists() && Array.isArray(sysDoc.data().data)) {
          sysDoc.data().data.forEach(t => loadedTerritories.push(t));
        }
        if (loadedTerritories.length) localStorage.setItem('swash:lastTerritories', JSON.stringify(loadedTerritories));
      } catch(_) {}
    }
    if (!loadedTerritories.length) {
      try {
        const cached = JSON.parse(localStorage.getItem('swash:lastTerritories') || '[]');
        if (Array.isArray(cached)) loadedTerritories = cached;
      } catch(_) {}
    }
    // Decide territory: by explicit id first, then by rep membership
    let assigned = null;
    if (assignedTerritoryId && loadedTerritories.length) {
      assigned = loadedTerritories.find(t => t.id === assignedTerritoryId) || null;
    }
    if (!assigned && repDisplayName) {
      // Try membership match (case-insensitive) if territories have a reps array
      const needle = String(repDisplayName).trim().toLowerCase();
      const match = loadedTerritories.find(t => Array.isArray(t.reps) && t.reps.some(r => String(r).trim().toLowerCase() === needle));
      if (match) assigned = match;
    }
    if (!assigned && loadedTerritories.length) {
      // Last resort: pick the first territory to avoid blank state
      assigned = loadedTerritories[0];
    }

    state.territoryData = assigned || null;
    const overlay = renderTerritoryOverlays(loadedTerritories, assigned || null);
    // Always load pins when preloading territory view
    try {
      await loadAllPins();
    } catch (err) {
      console.warn('Failed to load pins during territory preload:', err);
    }
  } catch (_) {
    // As a fallback, still ensure pins try to load so map isn't empty
    toggleAllPins(true);
  }
}

// Run after auth is ready; also try immediately in case auth is already available
onAuthStateChanged(auth, () => { 
  preloadTerritoryForViewing(); 
});
preloadTerritoryForViewing();

// Auto-load pins when page loads (if map is visible and no shift in progress)
setTimeout(() => {
  if (state.map && !state.shift) {
    console.log('[Rep Log] Auto-loading historical pins on page load');
    loadAllPins().catch(err => console.warn('Auto-load pins failed:', err));
  }
}, 1000);

// Hook up All Pins toggle
const toggleAllPinsEl = document.getElementById('toggleAllPins');
if (toggleAllPinsEl) {
  toggleAllPinsEl.addEventListener('change', (e) => {
    toggleAllPins(!!e.target.checked);
  });
}

// Listen for SW sync message
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SYNC_REP_LOGS') {
      autoSyncLogs();
      syncAllPendingLogs();
      syncQueuedShiftSummaries();
    }
  });
}

// Expose for potential debugging
window._repLogState = state;

// ------------------ Nearby Road Suggestions ------------------
// Uses Overpass API to fetch highway names within ~15m of current location
// Falls back to a single reverse geocode (Nominatim) if none found.
let lastRoadFetch = 0;
let lastRoadPoint = null;
const ROAD_CACHE_KEY = 'swashRoadsCache';
const ROAD_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function roundCoord(n) {
  // ~55m buckets to improve cache hits while staying relevant
  return Math.round(n * 2000) / 2000;
}

function roadCacheKey(lat, lng) {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

function loadRoadCache() {
  try { return JSON.parse(localStorage.getItem(ROAD_CACHE_KEY) || '{}'); } catch(_) { return {}; }
}

function saveRoadCache(cache) {
  try { localStorage.setItem(ROAD_CACHE_KEY, JSON.stringify(cache)); } catch(_) {}
}

function escapeHtml(str="") {
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));
}

function setRoadSuggestionsLoading() {
  if (!roadSuggestionsContainer) return;
  const recent = loadRecentRoads();
  let html = `<div class="road-suggestions__loading">Finding nearby roads...</div>`;
  if (recent && recent.length) {
    const items = recent.slice(0, 10).map(n => `<button type="button" class="road-suggestion" data-road="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("");
    html += `<div class="road-suggestions__recent-title" style="margin-top:6px;color:#64748b;font-size:12px;">Recently used</div>`;
    html += `<div class="road-suggestions__recent" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">${items}</div>`;
  }
  roadSuggestionsContainer.innerHTML = html;
  // Also refresh datalist for native dropdown
  renderRecentRoadsDatalist();
}

function setRoadSuggestionsError(msg) {
  if (!roadSuggestionsContainer) return;
  roadSuggestionsContainer.innerHTML = `<div class="road-suggestions__error">${escapeHtml(msg)}</div>`;
}

function setRoadSuggestionsEmpty() {
  if (!roadSuggestionsContainer) return;
  roadSuggestionsContainer.innerHTML = `<div class="road-suggestions__empty">No nearby named roads found.</div>`;
}

function renderRoadSuggestions(names=[]) {
  if (!roadSuggestionsContainer) return;
  const recent = loadRecentRoads();
  const dedupe = new Set();
  const nearby = (names || []).filter(n => {
    const key = (n || '').toLowerCase();
    if (!key || dedupe.has(key)) return false; dedupe.add(key); return true;
  });
  const recentExtra = (recent || []).filter(n => {
    const key = (n || '').toLowerCase();
    if (!key || dedupe.has(key)) return false; dedupe.add(key); return true;
  }).slice(0, 10);

  if (!nearby.length && !recentExtra.length) { setRoadSuggestionsEmpty(); return; }

  let html = '';
  if (nearby.length) {
    const items = nearby.map(n => `<button type="button" class="road-suggestion" data-road="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("");
    html += `<div class="road-suggestions__nearby-title" style="color:#64748b;font-size:12px;margin-bottom:4px;">Nearby roads</div>`;
    html += `<div class="road-suggestions__nearby" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${items}</div>`;
  }
  if (recentExtra.length) {
    const items = recentExtra.map(n => `<button type="button" class="road-suggestion" data-road="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("");
    html += `<div class="road-suggestions__recent-title" style="color:#64748b;font-size:12px;margin:6px 0 4px;">Recently used</div>`;
    html += `<div class="road-suggestions__recent" style="display:flex;flex-wrap:wrap;gap:6px;">${items}</div>`;
  }
  roadSuggestionsContainer.innerHTML = html;
  // Also refresh datalist for native dropdown
  renderRecentRoadsDatalist();
}

// Distance helpers (meters)
function toRad(x){ return x * Math.PI / 180; }
function distanceMeters(a, b){
  const R = 6371000; // meters
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const s = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const d = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
  return R * d;
}
function polylineDistanceMeters(point, line){
  // line: array of {lat,lon} from Overpass geometry
  let best = Infinity;
  for (let i=0;i<line.length-1;i++){
    const p1 = { lat: line[i].lat, lng: line[i].lon };
    const p2 = { lat: line[i+1].lat, lng: line[i+1].lon };
    // approximate by sampling segment endpoints and midpoint (good enough at small radii)
    const mid = { lat: (p1.lat+p2.lat)/2, lng: (p1.lng+p2.lng)/2 };
    best = Math.min(best, distanceMeters(point, p1), distanceMeters(point, mid), distanceMeters(point, p2));
  }
  return best;
}

async function loadNearbyRoads() {
  if (!roadSuggestionsContainer) return;
  // Show loading + recent suggestions immediately (even offline)
  setRoadSuggestionsLoading();
  // Show cached nearby suggestions if available (even offline)
  try {
    const loc = state.lastLocation;
    if (loc) {
      const cache = loadRoadCache();
      const key = roadCacheKey(loc.lat, loc.lng);
      const entry = cache[key];
      if (entry && (Date.now() - entry.t) < ROAD_CACHE_TTL_MS && Array.isArray(entry.names) && entry.names.length) {
        renderRoadSuggestions(entry.names);
        // Soft refresh in background if online
        if (!navigator.onLine) return; // offline: use cache only
      }
    }
  } catch(_) {}
  if (!navigator.onLine) { return; }

  // Use last known location if available; otherwise request current position
  const useLocation = () => {
    const loc = state.lastLocation;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng };
  };
  const loc = useLocation();
  if (!loc) {
    setRoadSuggestionsLoading();
    navigator.geolocation.getCurrentPosition(pos => {
      state.lastLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: (typeof pos.coords.accuracy==='number'?pos.coords.accuracy:null), timestamp: Date.now() };
      fetchNearbyRoads(pos.coords.latitude, pos.coords.longitude);
    }, err => setRoadSuggestionsError("GPS error: " + err.message), { enableHighAccuracy: true, timeout: 8000 });
    return;
  }
  fetchNearbyRoads(loc.lat, loc.lng);
}

async function fetchNearbyRoads(lat, lng) {
  setRoadSuggestionsLoading();
  try {
    // Rate limit: avoid refetching if same point within 15s and <10m movement
    const now = Date.now();
    if (lastRoadPoint) {
      const moved = haversineMiles({lat:lastRoadPoint.lat,lng:lastRoadPoint.lng},{lat,lng});
      if ((now - lastRoadFetch) < 15000 && moved < 0.0062) { // ~10m in miles
        renderRoadSuggestions([]); return; // keep existing (will show empty message)
      }
    }
    lastRoadFetch = now; lastRoadPoint = { lat, lng };
    // Try progressively wider Overpass searches for named features
    const names = await tryOverpassForNames(lat, lng, 15);
    if (names.length) {
      // Sort by length (shorter first) for quick tap selection
      names.sort((a,b)=>a.length-b.length);
      renderRoadSuggestions(names.slice(0,8));
      // Persist to cache for 1 hour
      try {
        const cache = loadRoadCache();
        cache[roadCacheKey(lat,lng)] = { names: names.slice(0,8), t: Date.now() };
        saveRoadCache(cache);
      } catch(_) {}
      // Log lookup for diagnostics
      try { await logRoadLookup(lat, lng, names.slice(0,8)); } catch(_) {}
    } else {
      // Strict requirement: within 15m only
      setRoadSuggestionsError('No named roads within 15m.');
      if (typeof roadNameInput !== 'undefined' && roadNameInput && roadNameInput.focus) {
        roadNameInput.focus();
      }
    }
  } catch (e) {
    console.warn('Nearby roads fetch failed', e); setRoadSuggestionsError('Road lookup failed');
  }
}

// Nearby road name lookup via serverless proxy; gracefully fallback if 404
async function tryOverpassForNames(lat, lng, radiusMeters=15) {
  // Tiny helper: fetch with timeout and JSON parsing
  const fetchJsonTimeout = async (url, { timeoutMs = 6000, headers = {} } = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  };

  // 1) Try serverless aggregator if available on this origin (relative path works on Vercel; harmless 404 on Firebase)
  try {
    const url = `/api/nearby-roads?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=${encodeURIComponent(radiusMeters)}`;
    const data = await fetchJsonTimeout(url, { timeoutMs: 5000, headers: { 'Accept': 'application/json' } });
    const names = Array.isArray(data?.names) ? data.names : [];
    if (names.length) return names;
  } catch (_) { /* continue to public endpoints */ }

  // 2) Fallback to direct Overpass (CORS allowed). Try multiple mirrors with short timeouts.
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];
  for (const ep of endpoints) {
    try {
      const query = `
        [out:json][timeout:6];
        (
          way(around:${radiusMeters*4},${lat},${lng})["highway"]["name"];
          node(around:${radiusMeters*4},${lat},${lng})["addr:street"];
        );
        out tags geom;`;
      const url = `${ep}?data=${encodeURIComponent(query)}`;
      const data = await fetchJsonTimeout(url, { timeoutMs: 6000, headers: { 'Accept': 'application/json' } });
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      const here = { lat, lng };
      const candidates = [];
      for (const e of elements) {
        const t = e.tags || {};
        const label = t.name || t['addr:street'];
        if (!label) continue;
        let d = Infinity;
        if (Array.isArray(e.geometry) && e.type === 'way') {
          d = polylineDistanceMeters(here, e.geometry);
        } else if (typeof e.lat === 'number' && typeof e.lon === 'number') {
          d = distanceMeters(here, { lat: e.lat, lng: e.lon });
        }
        if (Number.isFinite(d)) candidates.push({ label, d });
      }
      const within = candidates.filter(c => c.d <= radiusMeters);
      within.sort((a,b)=>a.d-b.d);
      const names = Array.from(new Set(within.map(c => c.label)));
      if (names.length) return names;
    } catch(_) { /* try next endpoint */ }
  }

  // 3) Final fallback: Nominatim reverse geocode for a single street name
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=en`;
    const data = await fetchJsonTimeout(url, { timeoutMs: 5500, headers: { 'Accept': 'application/json' } });
    const a = data?.address || {};
    const candidates = [a.road, a.pedestrian, a.footway, a.neighbourhood, a.suburb].filter(Boolean);
    const deduped = Array.from(new Set(candidates.map(s => String(s))));
    if (deduped.length) return deduped;
  } catch (_) { /* give up */ }

  return [];
}

async function logRoadLookup(lat, lng, names=[]) {
  try {
    if (!auth.currentUser) return;
    const payload = {
      repId: auth.currentUser.uid,
      timestamp: nowIso(),
      gpsLat: lat,
      gpsLng: lng,
      names,
    };
    await addDoc(collection(db, 'repRoadLookups'), payload);
  } catch(_) {}
}

// Delegate click handling
if (roadSuggestionsContainer) {
  roadSuggestionsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.road-suggestion');
    if (!btn) return;
    const name = btn.getAttribute('data-road') || btn.textContent.trim();
    roadNameInput.value = name;
    // Toggle selected state (single selection)
    roadSuggestionsContainer.querySelectorAll('.road-suggestion').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
  });
}
