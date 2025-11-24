/* Admin Tracking Dashboard
   Firestore structure usage:
   - repLocations: { repId, timestamp, gpsLat, gpsLng } (live every ~5 mins)
   - repLogs: doc id pattern: repId_date -> { repId, date, territoryId, logs: [] }
   - repShifts: { repId_date, totals, miles, pay, ... }
   - territories: used for overlays
*/
import { auth, db } from "./public/firebase-init.js";
import { collection, doc, getDocs, getDoc, onSnapshot, query, where, orderBy, deleteDoc, collectionGroup, limit, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const state = {
  map: null,
  markerCluster: null,
  repMarkers: new Map(),
  logMarkers: [],
  allPinsCluster: null,
  allPinsVisible: true, // always visible now (removed UI toggle)
  territories: [],
  filters: { rep: "", date: "", territory: "" },
  shifts: [],
  repNames: {}, // cache repId -> rep name for shift history rendering
  territoryBounds: null, // L.LatLngBounds covering all territories
};

let ensureDoorsReadyTriggered = false;

// DOM refs
const repSel = document.getElementById("filterRep");
const dateStartInput = document.getElementById("filterDateStart");
// End date input removed (single-day filtering). Provide stub so legacy references don't break.
const dateEndInput = { value: "" };
const quickDateRange = document.getElementById("quickDateRange");
const terrSel = document.getElementById("filterTerritory");
const applyBtn = document.getElementById("applyFilters");
const exportBtn = document.getElementById("exportCsv");
const backfillDoorsBtn = document.getElementById('backfillDoorsBtn');
const enrichRepNameBtn = document.getElementById('enrichRepNameBtn');
const seedDoorsKnockedBtn = document.getElementById('seedDoorsKnockedBtn');
const logoutBtn = document.getElementById('logoutBtn');
const shiftHistoryEl = document.getElementById("shiftHistory");
const mapOverlay = document.getElementById("mapOverlay");
const adminPinsLoadingEl = document.getElementById('adminPinsLoading');
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
  getLogsForRepDate(repId, date).then(logs => {
    placeDoorMarkers(logs);
    setupReplay(logs);
    shiftSummaryModal.close();
  });
});

// All Shifts Modal
const allShiftsModal = document.getElementById('allShiftsModal');
const allShiftsBody = document.getElementById('allShiftsBody');
const allShiftsClose = document.getElementById('allShiftsClose');
const viewAllShiftsBtn = document.getElementById('viewAllShiftsBtn');

allShiftsClose?.addEventListener('click', () => allShiftsModal?.close());
viewAllShiftsBtn?.addEventListener('click', () => openAllShiftsModal());

// Replay controls
const replayRange = document.getElementById('replayRange');
const replayPlay = document.getElementById('replayPlay');
const replayPause = document.getElementById('replayPause');
const replayReset = document.getElementById('replayReset');

let replayLogs = [];
let replayIndex = 0;
let replayTimer = null;
let replayActive = false;

// -------- Unified log fetcher (supports legacy nested doorLogs and flat daily docs) --------
async function fetchNestedDoorLogs(repId, dateStr) {
  try {
    const snap = await getDocs(query(collection(db, 'repLogs', repId, 'dates', dateStr, 'doorLogs')));
    const logs = [];
    snap.forEach(d => logs.push({ ...d.data(), _meta: { repId, dateStr, docId: d.id, source: 'nested' } }));
    return logs;
  } catch (_) { return []; }
}

async function fetchDailyDocLogs(repId, dateStr) {
  try {
    const dailyId = `${repId}_${dateStr}`;
    const ds = await getDoc(doc(db, 'repLogs', dailyId));
    if (!ds.exists()) return [];
    const data = ds.data();
    const arr = Array.isArray(data.logs) ? data.logs : [];
    // Normalize and annotate
    return arr.map((l, idx) => ({ ...l, _meta: { repId, dateStr, dailyDocId: dailyId, index: idx, source: 'daily' } }));
  } catch (_) { return []; }
}

async function getLogsForRepDate(repId, dateStr) {
  // Try legacy first for backwards compatibility, then daily doc
  const nested = await fetchNestedDoorLogs(repId, dateStr);
  if (nested && nested.length) return nested.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
  const daily = await fetchDailyDocLogs(repId, dateStr);
  return daily.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
}

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
  // Cluster for very large historical sets (up to ~90k)
  state.markerCluster = L.markerClusterGroup({
    maxClusterRadius: 60,
    disableClusteringAtZoom: 18,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    chunkedLoading: true,
    chunkInterval: 250,
    chunkDelay: 50
  }).addTo(state.map);
  state.map.setView([54.5, -3], 6);
  state.allPinsCluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 18,
    showCoverageOnHover: false,
    chunkedLoading: true,
    chunkInterval: 250,
    chunkDelay: 50
  }).addTo(state.map);
}

// ---------------- Client-side Backfill to doorsknocked (Admin Only) ----------------
async function clientSideBackfillDoors({ days = 180, skipPrompt = false, silent = false } = {}) {
  if (!auth.currentUser) { if (!silent) alert('Not signed in'); return; }
  const userDoc = await getDoc(doc(db,'users', auth.currentUser.uid)).catch(()=>null);
  const role = userDoc?.data()?.role || 'rep';
  if (role !== 'admin') { if (!silent) alert('Admin only'); return; }
  if (!skipPrompt && !window.confirm(`Backfill last ${days} days of door logs into doorsknocked? This may take several minutes.`)) return;

  const btn = backfillDoorsBtn;
  if (!silent && btn) {
    btn.disabled = true;
    btn.textContent = 'Backfilling…';
  }
  const startTs = Date.now();
  let written = 0, skipped = 0;
  try {
    const repsSnap = await getDocs(query(collection(db,'users'), where('role','==','rep'))).catch(()=>null);
    if (!repsSnap) throw new Error('Failed to list reps');
    const repIds = [];
    const repNames = {};
    repsSnap.forEach(d => {
      repIds.push(d.id);
      const data = d.data() || {};
      repNames[d.id] = data.name || data.repName || data.displayName || d.id;
    });
    const since = new Date(Date.now() - days*86400000);
    const today = new Date();
    const fmt = d => d.toISOString().substring(0,10);
    for (const repId of repIds) {
      for (let d = new Date(since); d <= today; d.setDate(d.getDate()+1)) {
        const dateKey = fmt(d);
        try {
          const snapNested = await getDocs(collection(db,'repLogs', repId, 'dates', dateKey, 'doorLogs'));
          for (const docSnap of snapNested.docs) {
            const data = docSnap.data();
            if (!data || typeof data.gpsLat !== 'number' || typeof data.gpsLng !== 'number') continue;
            const targetRef = doc(db,'doorsknocked', docSnap.id);
            const existing = await getDoc(targetRef);
            if (existing.exists()) { skipped++; continue; }
            const payload = {
              repId,
              repName: repNames[repId] || repId,
              date: dateKey,
              timestamp: data.timestamp || `${dateKey}T00:00:00.000Z`,
              gpsLat: data.gpsLat,
              gpsLng: data.gpsLng,
              status: data.status || 'Unknown',
              territoryId: data.territoryId || null,
              houseNumber: data.houseNumber || data.doorNumber || '',
              roadName: data.roadName || data.street || '',
              notes: data.note || data.addressNotes || '',
              accuracy: typeof data.accuracy === 'number' ? data.accuracy : null,
              source: 'backfill'
            };
            await setDoc(targetRef, payload, { merge: true });
            written++;
          }
        } catch(_) {}

        try {
          const dailyId = `${repId}_${dateKey}`;
          const dailySnap = await getDoc(doc(db,'repLogs', dailyId));
          if (dailySnap.exists()) {
            const dailyData = dailySnap.data();
            const arr = Array.isArray(dailyData.logs) ? dailyData.logs : [];
            for (let i=0;i<arr.length;i++) {
              const l = arr[i];
              if (!l || typeof l.gpsLat !== 'number' || typeof l.gpsLng !== 'number') continue;
              const genId = `${dailyId}_${i}`;
              const targetRef = doc(db,'doorsknocked', genId);
              const existing = await getDoc(targetRef);
              if (existing.exists()) { skipped++; continue; }
              const payload = {
                repId,
                repName: repNames[repId] || repId,
                date: dateKey,
                timestamp: l.timestamp || `${dateKey}T00:00:00.000Z`,
                gpsLat: l.gpsLat,
                gpsLng: l.gpsLng,
                status: l.status || 'Unknown',
                territoryId: l.territoryId || null,
                houseNumber: l.houseNumber || l.doorNumber || '',
                roadName: l.roadName || l.street || '',
                notes: l.note || l.addressNotes || '',
                accuracy: typeof l.accuracy === 'number' ? l.accuracy : null,
                source: 'backfill'
              };
              await setDoc(targetRef, payload, { merge: true });
              written++;
            }
          }
        } catch(_) {}
      }
      await new Promise(r=>setTimeout(r,25));
      if (!silent && btn) btn.textContent = `Backfilling… ${written} written`;
    }
    const secs = ((Date.now()-startTs)/1000).toFixed(1);
    if (!silent && btn) {
      btn.textContent = `Backfill done (${written} / skipped ${skipped})`;
      alert(`Backfill complete. Written: ${written}, skipped existing: ${skipped}, time: ${secs}s`);
    } else {
      console.log(`[Backfill] Complete in ${secs}s. Written ${written}, skipped ${skipped}`);
    }
  } catch (e) {
    console.error('Backfill failed', e);
    if (!silent) {
      alert('Backfill failed: ' + (e.message||e));
      if (btn) btn.textContent = 'Backfill failed';
    }
  } finally {
    if (!silent && btn) {
      btn.disabled = false;
      setTimeout(()=>{ btn.textContent = 'Backfill Doors → Flat'; }, 4000);
    }
  }
}

backfillDoorsBtn?.addEventListener('click', () => clientSideBackfillDoors({ days:180 }));

// ---------------- Client-side enrichment for repName (Admin Only) ----------------
async function clientSideEnrichRepNames({ skipPrompt = false, silent = false } = {}) {
  if (!auth.currentUser) { if (!silent) alert('Not signed in'); return; }
  const u = await getDoc(doc(db,'users', auth.currentUser.uid)).catch(()=>null);
  const role = u?.data()?.role || 'rep';
  if (role !== 'admin') { if (!silent) alert('Admin only'); return; }
  if (!skipPrompt && !window.confirm('Add missing rep names to existing doorsknocked docs? This may take time.')) return;
  const btn = enrichRepNameBtn;
  if (!silent && btn) { btn.disabled = true; btn.textContent = 'Enriching…'; }
  try {
    // Load repId -> name map
    const repMap = {};
    try {
      const usersSnap = await getDocs(query(collection(db,'users'), where('role','==','rep')));
      usersSnap.forEach(d => { const x=d.data()||{}; repMap[d.id] = x.name || x.repName || x.displayName || d.id; });
    } catch(_) {}
    // Scan all doorsknocked in pages (simple full scan; Firestore web SDK has no server cursor)
    const all = await getDocs(collection(db,'doorsknocked'));
    let updates = 0;
    for (const docSnap of all.docs) {
      const d = docSnap.data() || {};
      if (!d.repId) continue;
      if (typeof d.repName === 'string' && d.repName.trim() !== '') continue;
      const repName = repMap[d.repId] || d.repId;
      try { await updateDoc(doc(db,'doorsknocked', docSnap.id), { repName }); updates++; } catch(_) {}
      if (!silent && btn && updates % 100 === 0) { btn.textContent = `Enriching… ${updates}`; await new Promise(r=>setTimeout(r,20)); }
    }
    if (!silent && btn) {
      btn.textContent = `Enriched ${updates}`;
      alert(`Rep name enrichment complete. Updated ${updates} docs.`);
    } else {
      console.log(`[Enrich] Rep names updated for ${updates} docs.`);
    }
  } catch (e) {
    console.error('Enrichment failed', e);
    if (!silent) {
      alert('Enrichment failed: ' + (e.message||e));
      if (btn) btn.textContent = 'Enrich failed';
    }
  } finally {
    if (!silent && btn) {
      btn.disabled = false;
      setTimeout(()=>{ btn.textContent = 'Enrich Rep Names'; }, 4000);
    }
  }
}

enrichRepNameBtn?.addEventListener('click', () => clientSideEnrichRepNames());

// ---------------- Seed test write to doorsknocked (Admin Only) ----------------
async function seedDoorsKnockedTest({ silent = false } = {}) {
  try {
    if (!auth.currentUser) { if (!silent) alert('Not signed in'); return; }
    const u = await getDoc(doc(db,'users', auth.currentUser.uid)).catch(()=>null);
    const role = u?.data()?.role || 'rep';
    if (role !== 'admin') { if (!silent) alert('Admin only'); return; }
    const id = 'seed-'+Date.now();
    const payload = {
      repId: auth.currentUser.uid,
      repName: (u?.data()?.displayName || u?.data()?.name || 'Admin'),
      date: new Date().toISOString().slice(0,10),
      timestamp: new Date().toISOString(),
      status: 'X',
      houseNumber: '1',
      roadName: 'Seed Road',
      gpsLat: 51.507351,
      gpsLng: -0.127758,
      notes: 'Seed test',
      source: 'seed'
    };
    await setDoc(doc(db,'doorsknocked', id), payload, { merge: true });
    if (!silent) alert('Seed write OK. Refresh Firestore and check doorsknocked.'); else console.log('[DoorsKnocked] Seed doc written');
  } catch (e) {
    console.error('Seed write failed', e);
    if (!silent) alert('Seed write failed: '+(e.message||e));
  }
}

seedDoorsKnockedBtn?.addEventListener('click', () => seedDoorsKnockedTest());
logoutBtn?.addEventListener('click', async () => {
  try {
    if (typeof window.endShiftBeforeLogout === 'function') {
      await window.endShiftBeforeLogout();
    }
  } catch (e) {
    console.warn('[Logout] Failed to end shift before logout', e);
  }
  try {
    await signOut(auth);
  } catch (e) {
    console.error('[Logout] Sign out failed', e);
  }
});

async function ensureDoorsKnockedReady({ days = 180 } = {}) {
  if (ensureDoorsReadyTriggered) return;
  try {
    const user = auth.currentUser;
    if (!user) return;
    const profile = await getDoc(doc(db,'users', user.uid)).catch(()=>null);
    const role = profile?.data()?.role || 'rep';
    if (role !== 'admin') return;
    ensureDoorsReadyTriggered = true;

    const statusEl = adminPinsLoadingEl;
    if (statusEl) {
      statusEl.style.display = 'inline';
      statusEl.textContent = 'Preparing door history…';
    }

    const sample = await getDocs(query(collection(db,'doorsknocked'), limit(1))).catch(()=>null);
    if (!sample || sample.empty) {
      if (statusEl) statusEl.textContent = 'Seeding doorsknocked…';
      await seedDoorsKnockedTest({ silent: true });
    }

    const flagKey = `swash:doorsknocked:backfill:${days}`;
    let already = false;
    try { already = !!localStorage.getItem(flagKey); } catch(_) {}

    if (!already) {
      if (statusEl) statusEl.textContent = 'Backfilling door history…';
      await clientSideBackfillDoors({ days, skipPrompt: true, silent: true });
      if (statusEl) statusEl.textContent = 'Enriching rep names…';
      await clientSideEnrichRepNames({ skipPrompt: true, silent: true });
      try { localStorage.setItem(flagKey, new Date().toISOString()); } catch(_) {}
    }

    if (statusEl) {
      statusEl.textContent = 'Door history ready';
      setTimeout(() => { try { statusEl.style.display = 'none'; } catch(_) {} }, 4000);
    }
  } catch (e) {
    ensureDoorsReadyTriggered = true;
    console.warn('[DoorsKnocked] ensureDoorsKnockedReady failed', e);
    if (adminPinsLoadingEl) {
      adminPinsLoadingEl.style.display = 'inline';
      adminPinsLoadingEl.textContent = 'Door history error (see console)';
    }
  }
}

function scheduleEnsureDoorsReady() {
  try {
    if (typeof window.onAuthStateChange === 'function') {
      window.onAuthStateChange(async ({ user, role }) => {
        if (!ensureDoorsReadyTriggered && user && role === 'admin') {
          await ensureDoorsKnockedReady({ days: 180 });
        }
      });
    } else {
      const timer = setInterval(() => {
        if (ensureDoorsReadyTriggered) { clearInterval(timer); return; }
        if (auth.currentUser) {
          ensureDoorsKnockedReady({ days: 180 }).finally(() => clearInterval(timer));
        }
      }, 1500);
    }
  } catch (e) {
    console.warn('[DoorsKnocked] schedule ensure failed', e);
  }
}

scheduleEnsureDoorsReady();

function setOverlayVisible(visible) {
  if (!mapOverlay) return;
  if (visible) mapOverlay.classList.remove('hidden'); else mapOverlay.classList.add('hidden');
}

function fitToTerritories() {
  if (state.map && state.territoryBounds) {
    try { state.map.fitBounds(state.territoryBounds, { padding:[30,30], maxZoom: 13 }); } catch(_) {}
  }
}

function updateMapOverlay() {
  const hasReps = state.repMarkers.size > 0;
  setOverlayVisible(!hasReps);
  if (!hasReps) {
    // When no reps, show all territories by default
    fitToTerritories();
  }
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
    // Insert a (No territory assigned) option
    if (!terrSel.querySelector('option[value="__NONE__"]')) {
      const noneOpt = document.createElement('option');
      noneOpt.value = '__NONE__';
      noneOpt.textContent = '(No territory assigned)';
      terrSel.appendChild(noneOpt);
    }
    let bounds = null;
    snap.forEach(d => {
      const data = d.data();
      state.territories.push({ id: d.id, ...data });
      const opt = document.createElement("option");
      opt.value = d.id; opt.textContent = data.name || d.id;
      terrSel.appendChild(opt);
      const color = data.color || '#0078d7';
      if (Array.isArray(data.geoBoundary) && data.geoBoundary.length >= 3) {
        const latlngs = data.geoBoundary.map(p => [p[0], p[1]]);
        const poly = L.polygon(latlngs, { color, weight:1, fillOpacity:0.08 }).addTo(state.map);
        bounds = bounds ? bounds.extend(poly.getBounds()) : poly.getBounds();
      } else if (data.center && typeof data.radius === 'number') {
        // Handle circle territories stored in collection
        const cir = L.circle([data.center.lat, data.center.lng], { radius: data.radius, color, weight:1, fillOpacity:0.08 }).addTo(state.map);
        bounds = bounds ? bounds.extend(cir.getBounds()) : cir.getBounds();
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
          const color = t.color || '#0078d7';
          if (t.type === 'polygon' && Array.isArray(t.path) && t.path.length >= 3) {
            const latlngs = t.path.map(p => [p.lat, p.lng]);
            const poly = L.polygon(latlngs, { color, weight:1, fillOpacity:0.08 }).addTo(state.map);
            bounds = bounds ? bounds.extend(poly.getBounds()) : poly.getBounds();
          } else if (t.type === 'circle' && t.center && typeof t.radius === 'number') {
            const cir = L.circle([t.center.lat, t.center.lng], { radius: t.radius || 1000, color, weight:1, fillOpacity:0.08 }).addTo(state.map);
            bounds = bounds ? bounds.extend(cir.getBounds()) : cir.getBounds();
          }
        });
      }
    }
    // After loading, store and fit to all territories if available
    if (bounds) {
      state.territoryBounds = bounds;
      fitToTerritories();
    }
  } catch (err) {
    console.error("Error loading territories:", err);
  }
}

async function loadRepShiftHistory() {
  // Simplified: fetch all repShifts docs
  // Order by date descending if index exists; fallback to unordered
  try {
    const snap = await getDocs(query(collection(db, "repShifts"), orderBy('date', 'desc')));
    state.shifts = [];
    shiftHistoryEl.innerHTML = '';
    snap.forEach(d => { state.shifts.push({ id: d.id, ...d.data() }); });
    // Already ordered via query; if orderBy fails (rules/index), we would need manual sort.
    renderShiftHistory();
    // If current filter is All reps with a date range, auto-refresh stats now that shifts are loaded
    if (!repSel.value && dateStartInput.value && dateEndInput.value) {
      refreshStatsRangeAll();
    }
  } catch (err) {
    console.warn('Failed to load shift history', err);
  }
}

function renderShiftHistory() {
  shiftHistoryEl.innerHTML = '';
  const repFilter = state.filters.rep || '';
  const terrFilter = state.filters.territory || '';
  state.shifts.forEach(s => {
    if (repFilter && s.repId !== repFilter) return;
    // Territory filtering logic including explicit NONE option
    if (terrFilter && terrFilter !== '__ALL__') {
      if (terrFilter === '__NONE__') {
        if (s.territoryId) return; // only include those without a territory
      } else {
        if ((s.territoryId || null) !== terrFilter) return;
      }
    }
    const div = document.createElement('div');
    div.className = 'recent-item';
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
    const started = fmtTime(s.startTime);
    const finished = s.endTime ? fmtTime(s.endTime) : 'Still in progress';
    const doors = s.totals?.doors || 0;
    const miles = (s.miles != null) ? s.miles.toFixed(1) : '0.0';
    const cachedName = state.repNames[s.repId] || s.repId;
    div.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;gap:2px;">
      <strong>${s.date}</strong>
      <span>Rep: <span class="rep-name">${cachedName}</span></span>
      <span>Started: ${started}</span>
      <span>Finished: ${finished}</span>
      <span>${doors} doors / ${miles} mi</span>
    </div>`;
    if (!state.repNames[s.repId]) {
      getRepName(s.repId).then(name => {
        const nameSpan = div.querySelector('.rep-name');
        if (nameSpan) nameSpan.textContent = name;
      });
    }
    // Delete button (small X)
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'shift-del';
    delBtn.textContent = '×';
    delBtn.title = 'Delete shift';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteShift(s);
    });
    div.appendChild(delBtn);
    div.addEventListener('click', () => openShiftSummary(s));
    shiftHistoryEl.appendChild(div);
  });
}

async function confirmDeleteShift(shift) {
  try {
    const repName = await getRepName(shift.repId);
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
    const started = fmtTime(shift.startTime);
    const doors = shift.totals?.doors || 0;
    const miles = (shift.miles != null) ? shift.miles : 0;
    const ok = window.confirm(
      `Delete this shift for "${repName}" on ${shift.date}?
Start: ${started}
Doors: ${doors}
Miles: ${miles.toFixed(1)}

Note: This only deletes the shift summary record. Pins and door-by-door logs will remain.`
    );
    if (!ok) return;
    // Extra safeguard if shift shows activity
    if ((doors > 0 || miles > 0) && !window.confirm('This shift shows activity. Delete the summary anyway? (Pins/logs will not be deleted)')) {
      return;
    }
    // Delete repShifts summary doc - use shift.id (actual doc ID) instead of constructing it
    const shiftDocId = shift.id || shift.shiftId || `${shift.repId}_${shift.date}`;
    await deleteDoc(doc(db, 'repShifts', shiftDocId));
    // Remove from local state and re-render
    state.shifts = state.shifts.filter(s => !(s.repId === shift.repId && s.date === shift.date));
    renderShiftHistory();
    // If currently showing stats for that single day, refresh counters
    if (state.filters.rep === shift.repId && state.filters.dateStart === shift.date && !state.filters.dateEnd) {
      refreshStats();
    } else if (!state.filters.rep && state.filters.dateStart && state.filters.dateEnd) {
      refreshStatsRangeAll();
    }
  } catch (err) {
    alert('Failed to delete shift: ' + err.message);
  }
}

function replayShift(shift) {
  // Clear existing log markers
  state.markerCluster.clearLayers();
  // fetch logs (legacy or daily)
  getLogsForRepDate(shift.repId, shift.date).then(logs => {
    placeDoorMarkers(logs);
    setupReplay(logs);
  });
}

function openShiftSummary(shift) {
  getLogsForRepDate(shift.repId, shift.date).then(allLogs => {
    // CRITICAL: Filter logs to only include those from the specific date (in case of stale/cross-date data)
    const datePrefix = shift.date; // "2025-11-09"
    const filteredLogs = allLogs.filter(l => {
      if (!l.timestamp) return false;
      const logDate = new Date(l.timestamp).toISOString().substring(0,10);
      return logDate === datePrefix;
    });
    filteredLogs.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);
    // Always recalculate from today's logs to ensure accuracy for live shifts
    const totalDoors = filteredLogs.length;
    const x = filteredLogs.filter(l=>l.status==='X').length;
    const o = filteredLogs.filter(l=>l.status==='O').length;
    const sales = filteredLogs.filter(l=>l.status==='SignUp').length;
    const conv = totalDoors ? ((sales/totalDoors)*100).toFixed(1) : '0.0';
    // Recalculate miles from logs for live accuracy
    let miles = 0;
    if (filteredLogs.length > 1) {
      let prev = { lat: filteredLogs[0].gpsLat, lng: filteredLogs[0].gpsLng };
      for (let i = 1; i < filteredLogs.length; i++) {
        const cur = { lat: filteredLogs[i].gpsLat, lng: filteredLogs[i].gpsLng };
        miles += haversineMiles(prev, cur);
        prev = cur;
      }
    }
    const startMs = shift.startTime ? new Date(shift.startTime).getTime() : (filteredLogs[0]? new Date(filteredLogs[0].timestamp).getTime() : 0);
    const endMs = shift.endTime ? new Date(shift.endTime).getTime() : Date.now();
    const totalSpanMs = Math.max(0, endMs - startMs);
    const activeMinutes = shift.activeMinutes ?? 0;
    const activeMs = activeMinutes * 60000;
    const manualPausedMs = (shift.pauses||[]).reduce((acc,p)=>{ if(!p || p.reason !== 'manual' || !p.start) return acc; const ps=new Date(p.start).getTime(); const pe=p.end?new Date(p.end).getTime():endMs; if(!isNaN(ps)&&!isNaN(pe)) acc+=Math.max(0,pe-ps); return acc; },0);
    // Since activeMinutes already excludes inactivity, compute inactivity as remainder of total span
    // UNLESS user is in training mode - then no inactivity deduction
    const inactivityDedMs = shift.training ? 0 : Math.max(0, totalSpanMs - manualPausedMs - activeMs);
    // Paid minutes should ignore inactivity if training is enabled
    const paidMinutes = shift.training ? Math.max(0, Math.round((totalSpanMs - manualPausedMs)/60000)) : activeMinutes;
    const payRate = 12.21, expenseRate = 0.45;
    const pay = (shift.pay != null) ? shift.pay : parseFloat(((paidMinutes/60)*payRate).toFixed(2));
    const mileageExpense = (shift.mileageExpense != null) ? shift.mileageExpense : parseFloat((miles*expenseRate).toFixed(2));
    const totalOwed = (shift.totalOwed != null) ? shift.totalOwed : parseFloat((pay + mileageExpense).toFixed(2));
    const dph = paidMinutes ? (totalDoors / (paidMinutes/60)) : 0;
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
        <tr><td>Paid minutes</td><td>${paidMinutes}</td></tr>
        <tr><td>Miles</td><td>${miles.toFixed(2)}</td></tr>
        <tr><td>Pay (£${payRate}/hr)</td><td>£${pay.toFixed(2)}</td></tr>
        <tr><td>Mileage (45p/mi)</td><td>£${mileageExpense.toFixed(2)}</td></tr>
        <tr><td><strong>Total owed</strong></td><td><strong>£${totalOwed.toFixed(2)}</strong></td></tr>
        <tr><td>Doors / active hour</td><td>${dph.toFixed(1)}</td></tr>
      </table>
      <h4 style='margin-top:12px;'>Pauses</h4>
      <ul class='pause-list'>${(shift.pauses||[]).map(p=>`<li>${fmtTime(p.start)} - ${p.end?fmtTime(p.end):'ongoing'} (${p.reason||'inactive'})</li>`).join('') || '<li>None</li>'}</ul>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button id="fixTrainingBtn" class="btn btn-primary">Fix training: clear auto-pauses</button>
      </div>
    `;
    shiftSummaryReplay.setAttribute('data-rep-id', shift.repId);
    shiftSummaryReplay.setAttribute('data-date', shift.date);
    shiftSummaryModal.showModal();

    // Wire up Fix Training action
    const fixBtn = document.getElementById('fixTrainingBtn');
    fixBtn?.addEventListener('click', async () => {
      fixBtn.disabled = true;
      try {
        await fixTrainingForShift(shift);
        // Re-open summary with fresh data
        openShiftSummary(shift);
      } catch (e) {
        alert('Failed to apply training fix: ' + (e?.message||e));
      } finally {
        fixBtn.disabled = false;
      }
    });
  });
}

async function fixTrainingForShift(shift) {
  // Fetch logs to recompute miles and paid minutes without inactivity
  const dateStr = shift.date;
  const repId = shift.repId;
  const logs = await getLogsForRepDate(repId, dateStr);
  const filteredLogs = logs.filter(l => l && l.timestamp && new Date(l.timestamp).toISOString().substring(0,10) === dateStr)
                           .sort((a,b)=>a.timestamp<b.timestamp?-1:1);
  // Recompute miles
  let miles = 0;
  if (filteredLogs.length > 1) {
    let prev = { lat: filteredLogs[0].gpsLat, lng: filteredLogs[0].gpsLng };
    for (let i=1;i<filteredLogs.length;i++) {
      const cur = { lat: filteredLogs[i].gpsLat, lng: filteredLogs[i].gpsLng };
      miles += haversineMiles(prev, cur);
      prev = cur;
    }
  }
  const startMs = shift.startTime ? new Date(shift.startTime).getTime() : (filteredLogs[0]? new Date(filteredLogs[0].timestamp).getTime() : Date.now());
  const endMs = shift.endTime ? new Date(shift.endTime).getTime() : Date.now();
  const totalSpanMs = Math.max(0, endMs - startMs);
  const manualPausedMs = (shift.pauses||[]).reduce((acc,p)=>{ if(!p || p.reason !== 'manual' || !p.start) return acc; const ps=new Date(p.start).getTime(); const pe=p.end?new Date(p.end).getTime():endMs; if(!isNaN(ps)&&!isNaN(pe)) acc+=Math.max(0,pe-ps); return acc; },0);
  const paidMinutes = Math.max(0, Math.round((totalSpanMs - manualPausedMs)/60000));
  const pay = parseFloat(((paidMinutes/60)*12.21).toFixed(2));
  const mileageExpense = parseFloat((miles*0.45).toFixed(2));
  const totalOwed = parseFloat((pay + mileageExpense).toFixed(2));
  const manualOnlyPauses = (shift.pauses||[]).filter(p=>p && p.reason==='manual');

  // Update shift doc (do not end shift)
  const shiftDocId = shift.id || shift.shiftId || `${shift.repId}_${shift.date}`;
  await updateDoc(doc(db, 'repShifts', shiftDocId), {
    training: true,
    pauses: manualOnlyPauses,
    activeMinutes: paidMinutes,
    miles: parseFloat(miles.toFixed(2)),
    pay,
    mileageExpense,
    totalOwed
  });
  // Also update local cache/state to reflect changes immediately
  const s = state.shifts.find(s => s.id === shiftDocId || (s.repId===shift.repId && s.date===shift.date));
  if (s) {
    s.training = true;
    s.pauses = manualOnlyPauses;
    s.activeMinutes = paidMinutes;
    s.miles = parseFloat(miles.toFixed(2));
    s.pay = pay;
    s.mileageExpense = mileageExpense;
    s.totalOwed = totalOwed;
  }
  renderShiftHistory();
}

function placeDoorMarkers(logs) {
  // Clear previous markers in feature group
  try { state.markerCluster.clearLayers(); } catch(_) {}
  logs.forEach(l => {
    const color = l.status === 'X' ? 'red' : l.status === 'O' ? 'orange' : l.status === 'SignUp' ? 'green' : 'gold';
    const icon = L.divIcon({ html: `<div style='width:14px;height:14px;border-radius:50%;background:${color};border:2px solid ${l.note && l.status!=='SignUp'?"#333":"#fff"}'></div>` });
    const m = L.marker([l.gpsLat, l.gpsLng], { icon });
    const addr = [l.houseNumber, l.roadName].filter(Boolean).join(' ');
    const ts = new Date(l.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'});
    if (l._meta && l._meta.repId && l._meta.dateStr && (l._meta.docId || l._meta.dailyDocId != null)) {
      m._doorMeta = { ...l._meta };
      m.bindPopup(`<strong>${l.status==='SignUp'?'Sale':l.status}</strong><br>${ts}${addr?`<br>${addr}`:''}${l.note?`<br>${l.note}`:''}<br><button class="btn btn-danger" id="delete-pin-btn">Delete this pin</button>`);
      m.on('popupopen', (ev) => {
        const root = ev.popup?.getElement?.() || document.querySelector('.leaflet-popup-content');
        const btn = root?.querySelector('#delete-pin-btn');
        if (btn) {
          btn.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await handleDeleteDoorPin(m); }, { once: true });
        }
      });
    } else {
      m.bindPopup(`<strong>${l.status==='SignUp'?'Sale':l.status}</strong><br>${ts}${addr?`<br>${addr}`:''}${l.note?`<br>${l.note}`:''}`);
    }
    state.markerCluster.addLayer(m);
  });
  if (logs.length) {
    state.map.fitBounds(state.markerCluster.getBounds(), { padding:[20,20] });
  }
}

// ---------- All Pins (historical) layer (admin) ALWAYS ON ----------
async function loadAllPinsAdmin({ days = 7, sixMonths = false } = {}) {
  // New implementation: iterate rep users & last N days doorLogs; avoids collectionGroup permission issues
  const loadingEl = document.getElementById('adminPinsLoading');
  try { if (loadingEl) loadingEl.style.display = 'inline'; } catch(_) {}
  if (state.allPinsCluster) { try { state.allPinsCluster.clearLayers(); } catch(_) {} }
  const repsSnap = await getDocs(query(collection(db,'users'), where('role','==','rep'))).catch(()=>null);
  if (!repsSnap) { if (loadingEl) loadingEl.style.display='none'; return; }
  const repIds = []; repsSnap.forEach(d => repIds.push(d.id));
  const dates = [];
  const today = new Date();
  for (let i=0;i<days;i++) { const dt=new Date(today); dt.setDate(today.getDate()-i); dates.push(dt.toISOString().substring(0,10)); }
  const layers = [];
  if (!sixMonths) {
    for (const repId of repIds) {
      for (const dateStr of dates) {
      try {
        // Legacy nested pins
        const snap = await getDocs(query(collection(db,'repLogs', repId, 'dates', dateStr, 'doorLogs')));
        snap.forEach(docSnap => {
          const l = docSnap.data();
          if (!l || typeof l.gpsLat !== 'number' || typeof l.gpsLng !== 'number') return;
          const color = l.status === 'X' ? 'red' : l.status === 'O' ? 'orange' : l.status === 'SignUp' ? 'green' : 'gold';
          const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
          const m = L.marker([l.gpsLat, l.gpsLng], { icon });
          m._doorMeta = { repId, dateStr, docId: docSnap.id, source: 'nested' };
          const addr = [l.houseNumber, l.roadName].filter(Boolean).join(' ');
          const repName = state.repNames[repId] || repId;
          const dateStrHuman = l.timestamp ? new Date(l.timestamp).toLocaleString('en-GB',{ day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : dateStr;
          const noteLine = l.note || l.addressNotes ? `<br>${(l.note||l.addressNotes)}` : '';
          m.bindPopup(`<strong>${l.status==='SignUp'?'Sale':l.status}</strong><br>${dateStrHuman}${addr?`<br>${addr}`:''}<br><span style='color:#475569'>Rep: ${repName}</span>${noteLine}<br><button class="btn btn-danger" id="delete-pin-btn">Delete this pin</button>`);
          m.on('popupopen', (ev) => {
            const root = ev.popup?.getElement?.() || document.querySelector('.leaflet-popup-content');
            const btn = root?.querySelector('#delete-pin-btn');
            if (btn) {
              btn.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                await handleDeleteDoorPin(m);
              }, { once: true });
            }
          });
          layers.push(m);
        });
        // Flat daily doc pins
        const daily = await fetchDailyDocLogs(repId, dateStr);
        daily.forEach((l) => {
          if (!l || typeof l.gpsLat !== 'number' || typeof l.gpsLng !== 'number') return;
          const color = l.status === 'X' ? 'red' : l.status === 'O' ? 'orange' : l.status === 'SignUp' ? 'green' : 'gold';
          const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
          const m = L.marker([l.gpsLat, l.gpsLng], { icon });
          m._doorMeta = { repId, dateStr, dailyDocId: l._meta.dailyDocId, index: l._meta.index, source: 'daily' };
          const addr = [l.houseNumber, l.roadName].filter(Boolean).join(' ');
          const repName = state.repNames[repId] || repId;
          const dateStrHuman = l.timestamp ? new Date(l.timestamp).toLocaleString('en-GB',{ day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : dateStr;
          const noteLine = l.note || l.addressNotes ? `<br>${(l.note||l.addressNotes)}` : '';
          m.bindPopup(`<strong>${l.status==='SignUp'?'Sale':l.status}</strong><br>${dateStrHuman}${addr?`<br>${addr}`:''}<br><span style='color:#475569'>Rep: ${repName}</span>${noteLine}<br><button class="btn btn-danger" id="delete-pin-btn">Delete this pin</button>`);
          m.on('popupopen', (ev) => {
            const root = ev.popup?.getElement?.() || document.querySelector('.leaflet-popup-content');
            const btn = root?.querySelector('#delete-pin-btn');
            if (btn) {
              btn.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                await handleDeleteDoorPin(m);
              }, { once: true });
            }
          });
          layers.push(m);
        });
        } catch(e) { /* ignore per-date failures */ }
      }
    }
  } else {
    // Six-month loader via doorsknocked collection (flat) batching by month
    const hintEl = document.getElementById('adminPinsHint');
    const today = new Date();
    const start = new Date(); start.setMonth(start.getMonth() - 6);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthWindows = [];
    while (cursor <= endCursor) {
      const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const mEnd = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
      monthWindows.push({ start: mStart.toISOString().slice(0,10), end: mEnd.toISOString().slice(0,10), label: mStart.toISOString().slice(0,7) });
      cursor.setMonth(cursor.getMonth()+1);
    }
    let totalPins = 0;
    for (let i=0;i<monthWindows.length;i++) {
      const w = monthWindows[i];
      if (hintEl) hintEl.textContent = `Loading ${w.label}… (${i+1}/${monthWindows.length})`;
      try {
        const qWin = query(collection(db,'doorsknocked'), where('date','>=', w.start), where('date','<=', w.end), orderBy('date'));
        const snap = await getDocs(qWin);
        snap.forEach(docSnap => {
          const d = docSnap.data();
          if (!d || typeof d.gpsLat !== 'number' || typeof d.gpsLng !== 'number') return;
          const color = d.status === 'X' ? 'red' : d.status === 'O' ? 'orange' : d.status === 'SignUp' ? 'green' : 'gold';
          const icon = L.divIcon({ html: `<div style='width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;'></div>` });
          const m = L.marker([d.gpsLat, d.gpsLng], { icon });
          const addr = [d.houseNumber, d.roadName].filter(Boolean).join(' ');
          const ts = d.timestamp ? new Date(d.timestamp).toLocaleString('en-GB',{ day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : d.date;
          const repLine = `<br><span style='color:#475569'>Rep: ${d.repName || d.repId || 'Unknown'}</span>`;
          const noteLine = d.notes ? `<br>${d.notes}` : '';
          m.bindPopup(`<strong>${d.status==='SignUp'?'Sale':d.status}</strong><br>${ts}${addr?`<br>${addr}`:''}${repLine}${noteLine}`);
          state.allPinsCluster.addLayer(m);
          totalPins++;
        });
      } catch(e) { console.warn('[Admin Tracking] Month window failed', w, e); }
      await new Promise(r=>setTimeout(r,25));
    }
    if (hintEl) hintEl.textContent = `Showing ${totalPins.toLocaleString()} pins (last 6 months)`;
  }
  if (!sixMonths) {
    layers.forEach(m => state.allPinsCluster.addLayer(m));
    if (layers.length) {
      try { state.map.fitBounds(state.allPinsCluster.getBounds(), { padding:[20,20], maxZoom: 14 }); } catch(_) {}
    }
  } else {
    // Fit after six-month load completes (handled in loader)
    if (state.allPinsCluster && state.allPinsCluster.getLayers().length) {
      try { state.map.fitBounds(state.allPinsCluster.getBounds(), { padding:[20,20], maxZoom: 14 }); } catch(_) {}
    }
  }
  if (loadingEl) loadingEl.style.display='none';
}

// Assign each rep a unique color
const repColors = ['#0078d7', '#1c9c5d', '#c43131', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
function getRepColor(repId) {
  const hash = Array.from(repId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return repColors[hash % repColors.length];
}

// Small util to estimate miles from a sequence of lat/lng points
function haversineMiles(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371e3; // meters
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const s = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  const d = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return (R * d) / 1609.34;
}

async function getRepName(repId) {
  try {
    if (state.repNames[repId]) return state.repNames[repId];
    const userDoc = await getDoc(doc(db, 'users', repId));
    const name = userDoc.exists() ? (userDoc.data().name || repId) : repId;
    state.repNames[repId] = name;
    return name;
  } catch(_) { return repId; }
}

function subscribeRepLocations() {
  onSnapshot(collection(db, 'repLocations'), snap => {
    const updatedNow = new Set();
    const now = Date.now();
    const FRESH_MS = 5 * 60 * 1000; // consider online if updated within last 5 minutes

    snap.docChanges().forEach(async change => {
      const data = change.doc.data();
      const repId = data.repId;
      const ts = new Date(data.timestamp || data.offlineAt || Date.now()).getTime();
      const isFresh = (now - ts) <= FRESH_MS && data.active !== false;
      const existing = state.repMarkers.get(repId);

      if (!isFresh) {
        if (existing) { state.map.removeLayer(existing); state.repMarkers.delete(repId); }
        return;
      }

      const color = getRepColor(repId);
      const repName = await getRepName(repId);
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
      updatedNow.add(repId);
    });

    // Remove any stale markers not updated in this snapshot and older than FRESH_MS
    for (const [repId, marker] of state.repMarkers.entries()) {
      if (!updatedNow.has(repId)) {
        try {
          const d = marker.getLatLng(); // presence check
        } catch (_) {}
      }
    }

    if (state.repMarkers.size) {
      const group = L.featureGroup(Array.from(state.repMarkers.values()));
      const bounds = group.getBounds();
      try {
        const padLat = 0.0145; const padLng = 0.025;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const padded = L.latLngBounds(
          L.latLng(sw.lat - padLat, sw.lng - padLng),
          L.latLng(ne.lat + padLat, ne.lng + padLng)
        );
        state.map.fitBounds(padded, { animate:true, padding:[20,20], maxZoom: 15 });
      } catch(_) {}
    }
    updateMapOverlay();
  });
}

function applyFilters() {
  state.filters.rep = repSel.value;
  state.filters.dateStart = dateStartInput.value;
  state.filters.dateEnd = "";
  state.filters.territory = terrSel.value;
  
  // Update map marker visibility based on rep filter
  updateMarkerVisibility();
  
  const repOnlySelected = !!state.filters.rep && !state.filters.dateStart && !state.filters.dateEnd;
  // If only a rep is selected with no dates, don't alert — show their full shift history list,
  // clear map markers, and reset aggregate stats. Also ensure a live placeholder shift for today.
  if (repOnlySelected) {
    state.markerCluster.clearLayers();
    if (aTotal) { aTotal.textContent = '0'; }
    if (aX) { aX.textContent = '0'; }
    if (aO) { aO.textContent = '0'; }
    if (aSales) { aSales.textContent = '0'; }
    if (aConv) { aConv.textContent = '0%'; }
    if (aMiles) { aMiles.textContent = '0.0'; }
    if (aDph) { aDph.textContent = '0.0'; }
    // Try to surface today's live shift even if location isn't updating
    const today = new Date().toISOString().substring(0,10);
    ensureLiveShift(state.filters.rep, today).finally(() => {
      renderShiftHistory();
    });
    return;
  }

  // If single date range and rep selected, show logs for that date
  if (state.filters.rep && state.filters.dateStart && !state.filters.dateEnd) {
    // Single date mode
    refreshStats();
    state.markerCluster.clearLayers();
    getLogsForRepDate(state.filters.rep, state.filters.dateStart).then(logs => {
      placeDoorMarkers(logs);
      setupReplay(logs);
    });
  } else if (!state.filters.rep && state.filters.dateStart) {
    // Aggregate across ALL reps for the single day
    refreshStatsRangeAllSingleDay(state.filters.dateStart);
    state.markerCluster.clearLayers();
  } else {
    // No rep and no valid date range – keep UI as-is and avoid blocking alerts
    // Tip: select a rep for all-time history, or add a date (and optional end) to plot logs on the map.
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
      const dayLogs = await getLogsForRepDate(repId, dateStr);
      allLogs.push(...dayLogs);
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

function refreshStatsRangeAllSingleDay(dayStr) {
  // Aggregate stats across ALL reps for a single day
  const startStr = dayStr;
  const endStr = dayStr;
  if (!startStr) return;
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
      if (terrFilter && terrFilter !== '') {
        if (terrFilter === '__ALL__') {
          // no-op
        } else if (terrFilter === '__NONE__') {
          if (d.territoryId) return; // include only missing territory
        } else {
          if ((d.territoryId || null) !== terrFilter) return;
        }
      }
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
        if (terrFilter && terrFilter !== '') {
          if (terrFilter === '__ALL__') {
            // no-op
          } else if (terrFilter === '__NONE__') {
            if (s.territoryId) return;
          } else {
            if ((s.territoryId || null) !== terrFilter) return;
          }
        }
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
      if (terrFilter && terrFilter !== '') {
        if (terrFilter === '__ALL__') {
          // no-op
        } else if (terrFilter === '__NONE__') {
          if (s.territoryId) return;
        } else {
          if ((s.territoryId || null) !== terrFilter) return;
        }
      }
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

async function populateRepFilter() {
  // Load all users with role="rep" from users collection
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'rep')));
    repSel.innerHTML = '<option value="">(All)</option>';
    snap.forEach(d => {
      const data = d.data();
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = data.name || d.id;
      repSel.appendChild(opt);
    });
  } catch (err) {
    console.warn('Failed to load rep users', err);
    repSel.innerHTML = '<option value="">(All)</option>';
  }
}

applyBtn.addEventListener('click', applyFilters);
exportBtn.addEventListener('click', () => exportCsv());

// Auto-update Stats when filters change and Rep=(All)
;[repSel, dateStartInput, terrSel].forEach(el => {
  el?.addEventListener('change', () => {
    if (!repSel.value && dateStartInput.value) {
      refreshStatsRangeAllSingleDay(dateStartInput.value);
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
    getLogsForRepDate(state.filters.rep, state.filters.dateStart).then(logs => {
      if (!logs.length) { alert('No logs'); return; }
      const header = ['timestamp','status','gpsLat','gpsLng','houseNumber','roadName','note','drivingMode','training'];
      const rows = [header.join(',')];
      logs.forEach(l => {
        rows.push([
          l.timestamp,
          l.status,
          l.gpsLat,
          l.gpsLng,
          l.houseNumber||'',
          (l.roadName||'').replace(/,/g,';'),
          (l.note||l.addressNotes||'').replace(/,/g,';'),
          l.drivingMode?1:0,
          l.training?1:0
        ].join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${state.filters.rep}_${state.filters.dateStart}_logs.csv`; a.click();
      URL.revokeObjectURL(url);
    });
  }
}

function openAllShiftsModal() {
  // Filter shifts based on current dashboard filters
  const repFilter = state.filters.rep || '';
  const dateStart = state.filters.dateStart || '';
  const dateEnd = state.filters.dateEnd || '';
  const terrFilter = state.filters.territory || '';
  
  let filtered = state.shifts.filter(s => {
    if (repFilter && s.repId !== repFilter) return false;
    if (dateStart && s.date < dateStart) return false;
    if (dateEnd && s.date > dateEnd) return false;
    if (terrFilter && terrFilter !== '__ALL__') {
      if (terrFilter === '__NONE__') {
        if (s.territoryId) return false;
      } else {
        if ((s.territoryId || null) !== terrFilter) return false;
      }
    }
    return true;
  });
  
  // Sort by date desc, then by startTime
  filtered.sort((a,b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    const aStart = a.startTime || 0;
    const bStart = b.startTime || 0;
    return aStart > bStart ? -1 : 1;
  });
  
  if (!filtered.length) {
    allShiftsBody.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">No shifts found for current filters.</p>';
    allShiftsModal.showModal();
    return;
  }
  
  // Build expandable table
  const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
  const fmtDate = d => d || '-';
  
  let html = `<table class="shifts-table"><thead><tr>
    <th class="expand-cell"></th>
    <th>Date</th>
    <th>Rep</th>
    <th>Start</th>
    <th>End</th>
    <th>Doors</th>
    <th>Sales</th>
    <th>Miles</th>
    <th>Pay</th>
  </tr></thead><tbody>`;
  
  filtered.forEach((s, idx) => {
    const repName = state.repNames[s.repId] || s.repId;
    const doors = s.totals?.doors || 0;
    const sales = s.totals?.sales || 0;
    const miles = (s.miles != null) ? s.miles.toFixed(1) : '0.0';
    const pay = (s.pay != null) ? `£${s.pay.toFixed(2)}` : '-';
    const started = fmtTime(s.startTime);
    const finished = s.endTime ? fmtTime(s.endTime) : 'In progress';
    
    html += `<tr onclick="toggleShiftDetails(${idx})">
      <td class="expand-cell"><span id="expand-icon-${idx}">▶</span></td>
      <td>${fmtDate(s.date)}</td>
      <td>${repName}</td>
      <td>${started}</td>
      <td>${finished}</td>
      <td>${doors}</td>
      <td>${sales}</td>
      <td>${miles}</td>
      <td>${pay}</td>
    </tr>`;
    
    // Details row (hidden by default)
    const x = s.totals?.x || 0;
    const o = s.totals?.o || 0;
    const conv = doors ? ((sales/doors)*100).toFixed(1) : '0.0';
    const activeMin = s.activeMinutes || 0;
    const dph = activeMin ? (doors / (activeMin/60)).toFixed(1) : '0.0';
    const mileageExpense = (s.mileageExpense != null) ? `£${s.mileageExpense.toFixed(2)}` : '-';
    const totalOwed = (s.totalOwed != null) ? `£${s.totalOwed.toFixed(2)}` : '-';
    const pausesList = (s.pauses||[]).map(p => `${fmtTime(p.start)} - ${p.end?fmtTime(p.end):'ongoing'} (${p.reason||'inactive'})`).join('<br>') || 'None';
    
    html += `<tr class="details-row" id="details-row-${idx}">
      <td colspan="9">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div><strong>X:</strong> ${x}</div>
          <div><strong>O:</strong> ${o}</div>
          <div><strong>Conversion:</strong> ${conv}%</div>
          <div><strong>Active minutes:</strong> ${activeMin}</div>
          <div><strong>Doors/hr:</strong> ${dph}</div>
          <div><strong>Mileage:</strong> ${mileageExpense}</div>
          <div><strong>Total owed:</strong> ${totalOwed}</div>
          <div style="grid-column:span 2;"><strong>Pauses:</strong><br>${pausesList}</div>
        </div>
      </td>
    </tr>`;
  });
  
  html += `</tbody></table>`;
  allShiftsBody.innerHTML = html;
  allShiftsModal.showModal();
}

window.toggleShiftDetails = function(idx) {
  const detailsRow = document.getElementById(`details-row-${idx}`);
  const icon = document.getElementById(`expand-icon-${idx}`);
  if (!detailsRow || !icon) return;
  const isVisible = detailsRow.classList.contains('visible');
  if (isVisible) {
    detailsRow.classList.remove('visible');
    icon.textContent = '▶';
  } else {
    detailsRow.classList.add('visible');
    icon.textContent = '▼';
  }
};

// ---------- Loading Progress Tracking ----------
const loadingState = {
  progress: 0,
  overlay: null,
  progressBar: null,
  progressPercent: null,
  loadingStatus: null
};

function updateLoadingProgress(percent, status) {
  if (!loadingState.overlay) return;
  loadingState.progress = Math.min(100, percent);
  if (loadingState.progressBar) loadingState.progressBar.style.width = `${loadingState.progress}%`;
  if (loadingState.progressPercent) loadingState.progressPercent.textContent = Math.round(loadingState.progress);
  if (loadingState.loadingStatus && status) loadingState.loadingStatus.textContent = status;
}

function hideLoadingOverlay() {
  if (!loadingState.overlay) return;
  updateLoadingProgress(100, 'Done!');
  setTimeout(() => {
    loadingState.overlay.classList.add('fade-out');
    setTimeout(() => {
      loadingState.overlay.style.display = 'none';
    }, 600);
  }, 400);
}

function initLoadingOverlay() {
  loadingState.overlay = document.getElementById('loadingOverlay');
  loadingState.progressBar = document.getElementById('progressBar');
  loadingState.progressPercent = document.getElementById('progressPercent');
  loadingState.loadingStatus = document.getElementById('loadingStatus');
  updateLoadingProgress(0, 'Initializing map...');
}

// Init with progress tracking
initLoadingOverlay();
initMap();
updateLoadingProgress(10, 'Loading territories...');

loadTerritories().then(() => {
  updateLoadingProgress(25, 'Loading rep filters...');
  return populateRepFilter();
}).then(() => {
  updateLoadingProgress(40, 'Loading shift history...');
  return loadRepShiftHistory();
}).then(() => {
  updateLoadingProgress(60, 'Loading historical pins...');
  return loadAllPinsAdmin({ days: 7 });
}).then(() => {
  updateLoadingProgress(80, 'Connecting to live tracking...');
  // Give snapshot listener time to load initial markers
  return new Promise(resolve => setTimeout(resolve, 1200));
}).then(() => {
  updateLoadingProgress(95, 'Finalizing...');
  return new Promise(resolve => setTimeout(resolve, 300));
}).then(() => {
  hideLoadingOverlay();
}).catch(err => {
  console.error('Loading error:', err);
  updateLoadingProgress(100, 'Error loading - continuing anyway');
  setTimeout(hideLoadingOverlay, 1500);
});
// FIX: remove stray subscribeRepLocations(); and duplicate snapshot logic from erroneous merge
// subscribeRepLocations(); // original call; replaced by enhanced snapshot below
onSnapshot(collection(db, 'repLocations'), async snap => {
    const seen = new Set();
    let shouldFitBounds = false;
    
    // Process each change individually for efficient updates
    for (const change of snap.docChanges()) {
      const data = change.doc.data();
      if (!data) continue;
      const repId = data.repId || change.doc.id;
      
      // CRITICAL FIX: Ignore stale locations (older than 15 minutes)
      const locationAge = Date.now() - new Date(data.timestamp).getTime();
      const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
      if (locationAge > STALE_THRESHOLD_MS) {
        console.log(`[Admin Tracking] Ignoring stale location for ${repId} (${Math.round(locationAge/60000)} min old)`);
        // Remove marker if it exists
        const existing = state.repMarkers.get(repId);
        if (existing) {
          try { state.map.removeLayer(existing); } catch(_) {}
          state.repMarkers.delete(repId);
        }
        continue; // Skip this stale location
      }
      
      seen.add(repId);
      
      const color = getRepColor(repId);
      const repName = await getRepName(repId);
      
      // Check if rep has an active shift today
      const today = new Date().toISOString().substring(0,10);
      let isTracking = false;
      // Optimisation + accuracy: we derive tracking from a cached shift record stored in memory if available
      // Fallback to Firestore only if not cached OR cache stale (>60s)
      const cacheKey = `shiftCache:${repId}:${today}`;
      const nowTs = Date.now();
      try {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
            if (cached && cached.checkedAt && (nowTs - cached.checkedAt < 60000)) {
              isTracking = !!(cached.startTime && !cached.endTime);
            }
        }
        if (!cachedRaw || (nowTs - (JSON.parse(cachedRaw||'{}').checkedAt||0) >= 60000)) {
          const shiftsQuery = query(
            collection(db, 'repShifts'),
            where('repId', '==', repId),
            where('date', '==', today)
          );
          const shiftsSnap = await getDocs(shiftsQuery);
          let activeShift = null;
          shiftsSnap.forEach(shiftDoc => {
            const shiftData = shiftDoc.data();
            if (shiftData && shiftData.startTime && !shiftData.endTime) {
              activeShift = shiftData;
            }
          });
          isTracking = !!activeShift;
          sessionStorage.setItem(cacheKey, JSON.stringify({
            startTime: activeShift?.startTime || null,
            endTime: activeShift?.endTime || null,
            checkedAt: nowTs
          }));
        }
      } catch(e) {
        console.warn('Failed to check shift status for', repId, e);
      }
      
      const statusText = isTracking ? '<span style="color:#10b981;font-weight:600;font-size:10px;">Online & Tracking</span>' : '<span style="color:#94a3b8;font-weight:600;font-size:10px;">Online Not Tracking</span>';
      
      const icon = L.divIcon({
        className: 'rep-live-marker',
        html: `<div style='display:flex;flex-direction:column;align-items:center;'>
          <div class='rep-label' style='background:#fff;padding:3px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.3);margin-bottom:4px;border:2px solid ${color};'>${repName} • ${statusText}</div>
          <div style='width:20px;height:20px;background:${color};color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);'>📍</div>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 30]
      });
      
      if (change.type === 'added') {
        const marker = L.marker([data.gpsLat, data.gpsLng], { icon }).addTo(state.map);
        const hasCoords = typeof data.gpsLat === 'number' && typeof data.gpsLng === 'number';
        const navLink = hasCoords
          ? `<a class="btn btn-primary" style="margin-top:6px;display:inline-block;padding:4px 10px;font-size:11px;border-radius:6px;background:#0078d7;color:#fff;text-decoration:none;" href="https://www.google.com/maps/dir/?api=1&destination=${data.gpsLat},${data.gpsLng}" target="_blank" rel="noopener noreferrer">Navigate →</a>`
          : `<span style="color:#64748b;font-size:11px;display:inline-block;margin-top:6px;">No live coordinates</span>`;
        marker.bindPopup(`<strong>${repName}</strong><br>ID: ${repId}<br>Last Update: ${new Date(data.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}<br>${navLink}<br><button class="btn btn-secondary view-logs-btn" data-rep="${repId}">View Logs</button>`);
        marker.on('popupopen', (ev) => {
          const root = ev.popup?.getElement?.() || document.querySelector('.leaflet-popup-content');
          const btn = root?.querySelector('.view-logs-btn');
          if (btn) {
            btn.addEventListener('click', (e) => {
              e.preventDefault(); e.stopPropagation();
              const id = btn.getAttribute('data-rep');
              if (id) {
                const today = new Date().toISOString().substring(0,10);
                state.filters.rep = id;
                state.filters.dateStart = today;
                state.filters.dateEnd = '';
                repSel.value = id;
                dateStartInput.value = today;
                dateEndInput.value = '';
                applyFilters();
              }
              try { ev.popup?.remove?.(); } catch(_) {}
            }, { once: true });
          }
        });
        marker._repId = repId; // Store repId for filtering
        state.repMarkers.set(repId, marker);
        shouldFitBounds = true;
        await ensureLiveShift(repId, new Date().toISOString().substring(0,10));
      } else if (change.type === 'modified') {
        const existing = state.repMarkers.get(repId);
        if (existing) {
          existing.setLatLng([data.gpsLat, data.gpsLng]);
          existing.setIcon(icon);
          // Update popup content with new timestamp + navigation link
          const hasCoords = typeof data.gpsLat === 'number' && typeof data.gpsLng === 'number';
          const navLink = hasCoords
            ? `<a class="btn btn-primary" style="margin-top:6px;display:inline-block;padding:4px 10px;font-size:11px;border-radius:6px;background:#0078d7;color:#fff;text-decoration:none;" href="https://www.google.com/maps/dir/?api=1&destination=${data.gpsLat},${data.gpsLng}" target="_blank" rel="noopener noreferrer">Navigate →</a>`
            : `<span style="color:#64748b;font-size:11px;display:inline-block;margin-top:6px;">No live coordinates</span>`;
          existing.getPopup()?.setContent(`<strong>${repName}</strong><br>ID: ${repId}<br>Last Update: ${new Date(data.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}<br>${navLink}<br><button class="btn btn-secondary view-logs-btn" data-rep="${repId}">View Logs</button>`);
        }
      } else if (change.type === 'removed') {
        const existing = state.repMarkers.get(repId);
        if (existing) {
          try { state.map.removeLayer(existing); } catch(_) {}
          state.repMarkers.delete(repId);
        }
      }
    }
    
    // Remove markers for reps no longer in snapshot (cleanup for edge cases)
    snap.docs.forEach(doc => {
      const data = doc.data();
      if (data) seen.add(data.repId || doc.id);
    });
    Array.from(state.repMarkers.keys()).forEach(repId => {
      if (!seen.has(repId)) {
        const m = state.repMarkers.get(repId);
        try { state.map.removeLayer(m); } catch(_) {}
        state.repMarkers.delete(repId);
      }
    });
    
    // Apply rep filter to markers visibility
    updateMarkerVisibility();
    
    // Fit bounds only on initial load or when new rep added
    if (shouldFitBounds && state.repMarkers.size) {
      const visibleMarkers = Array.from(state.repMarkers.values()).filter(m => m._icon);
      if (visibleMarkers.length) {
        try {
          const TARGET_ZOOM = 17;
          if (visibleMarkers.length === 1) {
            // Single rep: center tightly
            state.map.setView(visibleMarkers[0].getLatLng(), TARGET_ZOOM, { animate: true });
          } else {
            const group = L.featureGroup(visibleMarkers);
            const bounds = group.getBounds();
            const padLat = 0.0145;
            const padLng = 0.025;
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const padded = L.latLngBounds(
              L.latLng(sw.lat - padLat, sw.lng - padLng),
              L.latLng(ne.lat + padLat, ne.lng + padLng)
            );
            state.map.fitBounds(padded, { animate:true, padding:[20,20], maxZoom: TARGET_ZOOM });
          }
        } catch(_) {}
      }
    }
    
    // Adjust labels & recenter
    adjustMarkerLabels();
    centerMapDynamic();
    updateMapOverlay();
}); // close onSnapshot listener

function updateMarkerVisibility() {
  // Show/hide markers based on current rep filter
  const repFilter = state.filters.rep || '';
  state.repMarkers.forEach((marker, repId) => {
    if (!repFilter || repFilter === repId) {
      // Show this marker
      if (!state.map.hasLayer(marker)) {
        marker.addTo(state.map);
      }
    } else {
      // Hide this marker
      if (state.map.hasLayer(marker)) {
        state.map.removeLayer(marker);
      }
    }
  });
}

async function ensureLiveShift(repId, dateStr) {
  try {
    // Query all repShifts docs for this rep+date (could be multiple if they started new shifts same day)
    // Use a composite query or fetch by pattern; Firestore doesn't support wildcard doc IDs, so we'll
    // query the collection filtering by repId and date fields
    const shiftsQuery = query(
      collection(db, 'repShifts'),
      where('repId', '==', repId),
      where('date', '==', dateStr)
    );
    const shiftsSnap = await getDocs(shiftsQuery);
    
    if (!shiftsSnap.empty) {
      // Add or update all shifts found for this rep+date
      shiftsSnap.forEach(shiftDoc => {
        const shiftData = { id: shiftDoc.id, ...shiftDoc.data() };
        const existing = state.shifts.find(s => s.id === shiftDoc.id);
        if (existing) {
          Object.assign(existing, shiftData);
        } else {
          state.shifts.unshift(shiftData);
        }
      });
      renderShiftHistory();
      return;
    }
    
  // Fallback: synthesize from logs (legacy or daily) if no repShifts doc exists
  const logs = await getLogsForRepDate(repId, dateStr);
    
    if (!logs.length) {
      // No doors yet; synthesize placeholder if not already present for this date
      const placeholderExists = state.shifts.some(s => s.repId === repId && s.date === dateStr && !s.id);
      if (!placeholderExists) {
        state.shifts.unshift({ repId, date: dateStr, startTime: null, endTime: null, pauses: [] });
        renderShiftHistory();
      }
      return;
    }
    
    const first = logs[0];
    // Create a minimal live shift object; openShiftSummary will recalculate everything from logs
    const shift = {
      repId,
      date: dateStr,
      startTime: first.timestamp,
      endTime: null,
      pauses: [], // No pause data until rep writes it
    };
    
    // Check if we already have a synthesized shift for this rep+date
    const existing = state.shifts.find(s => s.repId === repId && s.date === dateStr && !s.id);
    if (existing) {
      Object.assign(existing, shift);
      renderShiftHistory();
    } else {
      state.shifts.unshift(shift);
      renderShiftHistory();
    }
  } catch (err) {
    // Ignore failures; sidebar can remain empty until logs sync
    console.warn('ensureLiveShift failed', err);
  }
}

// Load historical pins immediately (always-on layer) – last 7 days to avoid collectionGroup permission errors
loadAllPinsAdmin({ days: 7 });

// Quick date range helper
function setQuickRange(value) {
  const today = new Date();
  const fmt = d => d.toISOString().substring(0,10);
  if (value === 'today') {
    dateStartInput.value = fmt(today);
    dateEndInput.value = '';
  } else if (value === 'yesterday') {
    const y = new Date(today); y.setDate(today.getDate()-1);
    dateStartInput.value = fmt(y);
    dateEndInput.value = '';
  } else if (value === 'last7') {
    const start = new Date(today); start.setDate(today.getDate()-6);
    dateStartInput.value = fmt(start);
    dateEndInput.value = fmt(today);
  }
}

// Default to today on load
try { 
  setQuickRange('today'); 
  // Auto-load stats for today on page load
  setTimeout(() => {
    if (!repSel.value && dateStartInput.value) {
      refreshStatsRangeAllSingleDay(dateStartInput.value);
    }
  }, 500);
} catch(_) {}
quickDateRange?.addEventListener('change', (e) => {
  setQuickRange(e.target.value);
  applyFilters();
});

// Always show admin marker & dynamic centering
async function addAdminMarker() {
  try {
    const me = auth.currentUser;
    if (!me) return;
    const uDoc = await getDoc(doc(db,'users', me.uid));
    if (!uDoc.exists()) return;
    const data = uDoc.data();
    const lat = data.adminLat, lng = data.adminLng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      const icon = L.divIcon({ html: `<div style='display:flex;flex-direction:column;align-items:center;'>
        <div class='rep-label' style='background:#fff;padding:3px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.3);margin-bottom:4px;border:2px solid #0078d7;'>Admin</div>
        <div style='width:22px;height:22px;background:#0078d7;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);'>★</div>
      </div>` });
      state._adminMarker = L.marker([lat,lng], { icon }).addTo(state.map);
    }
  } catch(e) { console.warn('addAdminMarker failed', e); }
}

function centerMapDynamic() {
  const reps = Array.from(state.repMarkers.values());
  if (reps.length) {
    try {
      const TARGET_ZOOM = 17;
      if (reps.length === 1) {
        state.map.setView(reps[0].getLatLng(), TARGET_ZOOM, { animate: true });
      } else {
        const grp = L.featureGroup(reps);
        state.map.fitBounds(grp.getBounds(), { padding:[30,30], maxZoom: TARGET_ZOOM });
      }
    } catch(_) {}
  } else if (state._adminMarker) {
    try { state.map.setView(state._adminMarker.getLatLng(), 7); } catch(_) {}
  } else {
    state.map.setView([54.5,-3], 6); // UK fallback
  }
}

function adjustMarkerLabels() {
  // Avoid overlapping labels by offsetting close pairs
  const markers = Array.from(state.repMarkers.values());
  for (let i=0;i<markers.length;i++) {
    for (let j=i+1;j<markers.length;j++) {
      const mi = markers[i]; const mj = markers[j];
      const pi = state.map.latLngToLayerPoint(mi.getLatLng());
      const pj = state.map.latLngToLayerPoint(mj.getLatLng());
      const dist = Math.hypot(pi.x - pj.x, pi.y - pj.y);
      if (dist < 50) { // threshold
        const li = mi._icon?.querySelector('.rep-label');
        const lj = mj._icon?.querySelector('.rep-label');
        if (li && lj) {
          li.style.marginBottom = '10px';
          lj.style.marginBottom = '0px';
          lj.style.transform = 'translateY(6px)';
        }
      }
    }
  }
}

setTimeout(() => { addAdminMarker().then(centerMapDynamic); }, 1200);

// Filter Shift History to show only today's active (in-progress) shifts
const originalRenderShiftHistory = renderShiftHistory;
renderShiftHistory = function() {
  shiftHistoryEl.innerHTML = '';
  const repFilter = state.filters.rep || '';
  const terrFilter = state.filters.territory || '';
  const todayStr = new Date().toISOString().substring(0,10);
  // Only include shifts for today that have not ended
  const activeToday = state.shifts.filter(s => {
    if (s.date !== todayStr) return false;
    if (s.endTime) return false; // only in-progress
    if (repFilter && s.repId !== repFilter) return false;
    if (terrFilter && terrFilter !== '__ALL__') {
      if (terrFilter === '__NONE__') { if (s.territoryId) return false; }
      else { if ((s.territoryId || null) !== terrFilter) return false; }
    }
    return true;
  });

  const header = document.createElement('div');
  header.className = 'shift-section-header';
  header.textContent = "Today's Active Shifts";
  shiftHistoryEl.appendChild(header);

  if (!activeToday.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 6px;color:#64748b;font-size:12px;';
    empty.textContent = 'No active shifts today.';
    shiftHistoryEl.appendChild(empty);
    return;
  }

  activeToday.forEach(s => {
    const div = document.createElement('div');
    div.className = 'recent-item active-shift';
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
    const started = fmtTime(s.startTime);
    const doors = s.totals?.doors || 0;
    const miles = (s.miles != null) ? s.miles.toFixed(1) : '0.0';
    const cachedName = state.repNames[s.repId] || s.repId;
    div.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;gap:2px;">
      <strong>${s.date}</strong>
      <span>Rep: <span class="rep-name">${cachedName}</span></span>
      <span>Started: ${started}</span>
      <span>Finished: Still in progress</span>
      <span>${doors} doors / ${miles} mi</span>
    </div>`;
    if (!state.repNames[s.repId]) {
      getRepName(s.repId).then(name => { const nameSpan = div.querySelector('.rep-name'); if (nameSpan) nameSpan.textContent = name; });
    }
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'shift-del'; delBtn.textContent = '×'; delBtn.title = 'Delete shift';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteShift(s); });
    div.appendChild(delBtn);
    div.addEventListener('click', () => openShiftSummary(s));
    shiftHistoryEl.appendChild(div);
  });
};

// Delete a specific door pin (doorLogs document) and remove its marker
async function handleDeleteDoorPin(marker) {
  try {
    const meta = marker._doorMeta;
    if (!meta || !meta.repId || !meta.dateStr) return;
    const repName = await getRepName(meta.repId);
    const ok = window.confirm(`Delete this pin for ${repName} on ${meta.dateStr}? This cannot be undone.`);
    if (!ok) return;
    if (meta.source === 'nested' && meta.docId) {
      await deleteDoc(doc(db, 'repLogs', meta.repId, 'dates', meta.dateStr, 'doorLogs', meta.docId));
    } else if (meta.source === 'daily' && meta.dailyDocId != null) {
      // Remove from daily doc logs array by index
      const ds = await getDoc(doc(db, 'repLogs', meta.dailyDocId));
      if (ds.exists()) {
        const data = ds.data();
        const arr = Array.isArray(data.logs) ? data.logs.slice() : [];
        if (typeof meta.index === 'number' && meta.index >= 0 && meta.index < arr.length) {
          arr.splice(meta.index, 1);
        }
        await updateDoc(doc(db, 'repLogs', meta.dailyDocId), { logs: arr });
      }
    }
    // Remove from map layers
    try { state.allPinsCluster?.removeLayer(marker); } catch(_) {}
    try { state.markerCluster?.removeLayer(marker); } catch(_) {}
    try { state.map?.removeLayer(marker); } catch(_) {}
  } catch (e) {
    alert('Failed to delete pin: ' + (e?.message || e));
  }
}
